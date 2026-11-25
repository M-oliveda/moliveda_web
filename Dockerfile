# syntax=docker/dockerfile:1

# Planned stages (MASTERPLAN §8): base → deps → dev → builder → runner, plus gate.
# Only `gate` exists yet; the Node.js stages are added in Phase 1 with the Next.js scaffold.
#   docker build --target gate -t moliveda-web-gate .

# Exact tag plus digest: the tag documents the version, the digest makes the build reproducible.
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30.6-alpine3.24@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03

# ──────────────────────────────────────────────
# gate: NGINX basic-auth sidecar (development, preview, staging)
# ──────────────────────────────────────────────
FROM ${NGINX_IMAGE} AS gate

# The upstream defaults to the app container in the same Cloud Run service. The entrypoint builds
# the htpasswd file from BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD, which are injected at run
# time and never baked into the image. NGINX_ENVSUBST_FILTER limits template substitution to the
# two variables below so NGINX runtime variables such as $host are never touched.
ENV UPSTREAM=127.0.0.1:3000 \
    BASIC_AUTH_HTPASSWD_FILE=/etc/nginx/auth/htpasswd \
    NGINX_ENVSUBST_FILTER="^(UPSTREAM|BASIC_AUTH_HTPASSWD_FILE)$"

USER root
# apache2-utils provides `htpasswd`, which the entrypoint uses to bcrypt-hash the password.
RUN apk upgrade --no-cache \
    && apk add --no-cache apache2-utils \
    && mkdir -p /etc/nginx/auth \
    && chown nginx:nginx /etc/nginx/auth \
    && chmod 0700 /etc/nginx/auth
USER nginx

# The official entrypoint runs /docker-entrypoint.d/* in order (10- before its own 20-envsubst),
# then renders /etc/nginx/templates/*.template into /etc/nginx/conf.d/.
COPY --chown=nginx:nginx --chmod=0555 docker/nginx/entrypoint.sh /docker-entrypoint.d/10-write-htpasswd.sh
COPY --chown=nginx:nginx docker/nginx/nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 8080

# Used by Docker only; Cloud Run ignores HEALTHCHECK and uses its own probes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["wget", "-qO-", "http://127.0.0.1:8080/health"]
