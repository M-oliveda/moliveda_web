# syntax=docker/dockerfile:1

# Stages (MASTERPLAN §8): base → deps → dev → builder → runner, plus gate.
#   docker build --target runner -t moliveda-web .
#   docker build --target gate -t moliveda-web-gate .
# The `dev` target is used by docker-compose.yaml only.

# Exact tag plus digest: the tag documents the version, the digest makes the build reproducible.
# NGINX is on the mainline line (1.31.x): the stable 1.30.6 image carries critical CVEs fixed only in 1.30.7+.
ARG NODE_IMAGE=node:26.13.1-alpine3.24@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.31.7-alpine3.24@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e

# ──────────────────────────────────────────────
# base: settings shared by every Node.js stage
# ──────────────────────────────────────────────
FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ──────────────────────────────────────────────
# deps: dependencies from the lockfile only
# ──────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
# No dependency needs an install script (only the macOS-only fsevents has one), and skipping them
# also skips the Husky `prepare` script, which has no Git repository to configure here.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

# ──────────────────────────────────────────────
# dev: local development with docker compose (source bind-mounted, hot reload)
# ──────────────────────────────────────────────
FROM base AS dev
# No NODE_ENV here: `next dev` sets it, and `next build` (run by `verify`) fails under
# NODE_ENV=development.
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]

# ──────────────────────────────────────────────
# builder: production build
# ──────────────────────────────────────────────
FROM base AS builder
# NEXT_PUBLIC_* values are inlined at build time, so CI builds one image per environment
# (MASTERPLAN 4.7). Server secrets are never build arguments.
ARG APP_ENV=local
ARG NEXT_PUBLIC_SITE_URL=
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
ARG NEXT_PUBLIC_CF_BEACON_TOKEN=
ENV APP_ENV=${APP_ENV} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY} \
    NEXT_PUBLIC_CF_BEACON_TOKEN=${NEXT_PUBLIC_CF_BEACON_TOKEN}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `public/` holds content added in later phases; create it so the runner copy never fails.
RUN mkdir -p public && npm run build

# ──────────────────────────────────────────────
# runner: minimal production image (Cloud Run)
# ──────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    PORT=8080 \
    HOSTNAME=0.0.0.0
RUN apk upgrade --no-cache
# The traced standalone server plus the assets it does not copy itself. Only `.next` is writable
# by the runtime user (Next.js writes its cache there); the code stays owned by root.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
RUN chown -R node:node .next
USER node
EXPOSE 8080
# Used by Docker only; Cloud Run ignores HEALTHCHECK and uses its own probes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["wget", "-qO-", "http://127.0.0.1:8080/health"]
CMD ["node", "server.js"]

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
