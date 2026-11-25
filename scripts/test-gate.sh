#!/usr/bin/env bash
# Behavior test for the NGINX basic-auth gate (Dockerfile `gate` stage, docker/nginx/).
# Builds the image, puts it in front of a stub upstream on a private Docker network and checks
# auth, probes, headers, limits and logs. Runs on the host and needs Docker, curl and python3.
# Used locally and by the CI `docker` job.
#
#   scripts/test-gate.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="moliveda-web-gate:test"
NETWORK="gate-test-$$"
UPSTREAM="gate-test-upstream-$$"
GATE="gate-test-gate-$$"
PORT="${GATE_TEST_PORT:-18080}"
URL="http://127.0.0.1:${PORT}"
OPEN_PORT="${GATE_TEST_OPEN_PORT:-18081}"
OPEN_URL="http://127.0.0.1:${OPEN_PORT}"
USERNAME="reviewer"
# A `$`, a space and a `:` prove the password reaches htpasswd untouched.
PASSWORD='pa$$ w0rd:gate'
WORK="$(mktemp -d)"
failures=0

cleanup() {
    docker rm -f "$GATE" "$UPSTREAM" "${GATE}-empty" "${GATE}-open" > /dev/null 2>&1 || true
    docker network rm "$NETWORK" > /dev/null 2>&1 || true
    rm -rf "$WORK"
}
trap cleanup EXIT

pass() { echo "  ok   $1"; }
fail() {
    echo "  FAIL $1"
    failures=$((failures + 1))
}
expect_eq() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (got '$2', expected '$3')"; fi; }
status() { curl --silent --output /dev/null --write-out '%{http_code}' "$@"; }
auth=(--user "${USERNAME}:${PASSWORD}")

echo "==> Building ${IMAGE}"
docker build --quiet --target gate --tag "$IMAGE" "$ROOT" > /dev/null

docker network create "$NETWORK" > /dev/null

# Stub upstream: echoes the Authorization header it receives, so the test can prove the gate
# strips it. Same base image as the gate, so no extra pull.
cat > "${WORK}/upstream.conf" << 'EOF'
server {
    listen 3000;
    location / {
        default_type text/plain;
        return 200 "upstream ok auth=[$http_authorization]\n";
    }
}
EOF
docker run --detach --name "$UPSTREAM" --network "$NETWORK" \
    --volume "${WORK}/upstream.conf:/etc/nginx/conf.d/default.conf:ro" \
    --entrypoint nginx "$IMAGE" -g "daemon off;" > /dev/null

echo "==> Startup without credentials"
# Everything except APP_ENV=local must fail closed.
if docker run --name "${GATE}-empty" --network "$NETWORK" --env UPSTREAM="${UPSTREAM}:3000" \
    "$IMAGE" > "${WORK}/empty.log" 2>&1; then
    fail "the gate starts without credentials"
else
    pass "the gate refuses to start without credentials"
fi
if grep -q "BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD are empty or unset" "${WORK}/empty.log"; then
    pass "the refusal names the missing variables"
else
    fail "the refusal names the missing variables"
fi
docker rm -f "${GATE}-empty" > /dev/null 2>&1 || true

if docker run --name "${GATE}-empty" --network "$NETWORK" --env UPSTREAM="${UPSTREAM}:3000" \
    --env APP_ENV=staging "$IMAGE" > /dev/null 2>&1; then
    fail "the gate starts without credentials when APP_ENV is not local"
else
    pass "the gate refuses to start without credentials when APP_ENV is not local"
fi
docker rm -f "${GATE}-empty" > /dev/null 2>&1 || true

if docker run --name "${GATE}-empty" --network "$NETWORK" --env UPSTREAM="${UPSTREAM}:3000" \
    --env APP_ENV=local --env BASIC_AUTH_USERNAME="$USERNAME" \
    "$IMAGE" > "${WORK}/partial.log" 2>&1; then
    fail "the gate starts with only a user name, even when APP_ENV=local"
else
    pass "the gate refuses a user name without a password, even when APP_ENV=local"
fi
if grep -q "BASIC_AUTH_PASSWORD is empty or unset" "${WORK}/partial.log"; then
    pass "the partial-credentials refusal names the missing variable"
else
    fail "the partial-credentials refusal names the missing variable"
fi
docker rm -f "${GATE}-empty" > /dev/null 2>&1 || true

echo "==> Open gate (APP_ENV=local, no credentials)"
docker run --detach --name "${GATE}-open" --network "$NETWORK" --publish "${OPEN_PORT}:8080" \
    --env UPSTREAM="${UPSTREAM}:3000" --env APP_ENV=local \
    "$IMAGE" > /dev/null
for _ in $(seq 1 30); do
    [ "$(status "${OPEN_URL}/health")" = "200" ] && break
    sleep 1
done
expect_eq "open gate: GET / without credentials" "$(status "${OPEN_URL}/")" 200
expect_eq "open gate: GET /health without credentials" "$(status "${OPEN_URL}/health")" 200
expect_eq "open gate: the Authorization header never reaches the app" \
    "$(curl --silent --header 'Authorization: Basic Zm9vOmJhcg==' "${OPEN_URL}/")" \
    "upstream ok auth=[]"
if curl --silent --head "${OPEN_URL}/" | tr -d '\r' | grep -qi '^x-robots-tag: noindex, nofollow$'; then
    pass "open gate: responses carry X-Robots-Tag"
else
    fail "open gate: responses carry X-Robots-Tag"
fi
docker logs "${GATE}-open" > "${WORK}/open.log" 2>&1
if grep -q "basic auth is DISABLED" "${WORK}/open.log"; then
    pass "open gate: startup logs a warning that auth is disabled"
else
    fail "open gate: startup logs a warning that auth is disabled"
fi
docker rm -f "${GATE}-open" > /dev/null 2>&1 || true

echo "==> Gate in front of the upstream"
docker run --detach --name "$GATE" --network "$NETWORK" --publish "${PORT}:8080" \
    --env UPSTREAM="${UPSTREAM}:3000" \
    --env BASIC_AUTH_USERNAME="$USERNAME" \
    --env BASIC_AUTH_PASSWORD="$PASSWORD" \
    "$IMAGE" > /dev/null

for _ in $(seq 1 30); do
    [ "$(status "${URL}/health")" = "200" ] && break
    sleep 1
done

expect_eq "GET /health without credentials" "$(status "${URL}/health")" 200
expect_eq "GET /ready without credentials" "$(status "${URL}/ready")" 200
expect_eq "GET / without credentials" "$(status "${URL}/")" 401
expect_eq "GET / with a wrong password" "$(status --user "${USERNAME}:wrong" "${URL}/")" 401
expect_eq "GET / with the right credentials" "$(status "${auth[@]}" "${URL}/")" 200

body="$(curl --silent "${auth[@]}" "${URL}/en/experience")"
expect_eq "the Authorization header never reaches the app" "$body" "upstream ok auth=[]"

headers="$(curl --silent --head "${URL}/" | tr -d '\r')"
if grep -qi '^x-robots-tag: noindex, nofollow$' <<< "$headers"; then
    pass "a 401 response carries X-Robots-Tag"
else
    fail "a 401 response carries X-Robots-Tag"
fi
if grep -qi '^www-authenticate: basic realm="Restricted"$' <<< "$headers"; then
    pass "a 401 response asks for basic auth"
else
    fail "a 401 response asks for basic auth"
fi
if grep -qi '^server: nginx$' <<< "$headers"; then
    pass "the Server header hides the NGINX version"
else
    fail "the Server header hides the NGINX version"
fi
probe_headers="$(curl --silent --head "${URL}/health" | tr -d '\r')"
if grep -qi '^x-robots-tag:' <<< "$probe_headers"; then
    pass "a proxied 200 response carries X-Robots-Tag"
else
    fail "a proxied 200 response carries X-Robots-Tag"
fi

head -c 40000 /dev/zero | tr '\0' 'a' > "${WORK}/large.txt"
expect_eq "a body over 32 KiB is rejected" \
    "$(status "${auth[@]}" --data-binary "@${WORK}/large.txt" "${URL}/api/v1/contact")" 413

# 40 requests at once from one client: the per-client burst (20) must turn some into 429.
codes="$(for _ in $(seq 1 40); do status "${auth[@]}" "${URL}/" & done; wait)"
if grep -q 429 <<< "$codes"; then
    pass "a burst from one client is rate limited (429)"
else
    fail "a burst from one client is rate limited (429)"
fi

echo "==> Access logs"
docker logs "$GATE" 2> /dev/null | grep '"component":"gate"' > "${WORK}/access.log" || true
if [ -s "${WORK}/access.log" ] && python3 -I -c '
import json, sys
for line in open(sys.argv[1]):
    entry = json.loads(line)
    assert entry["httpRequest"]["latency"].endswith("s"), entry
' "${WORK}/access.log"; then
    pass "every access log line is JSON in the httpRequest shape"
else
    fail "every access log line is JSON in the httpRequest shape"
fi
if grep -q '/health' "${WORK}/access.log"; then
    fail "probes are not logged"
else
    pass "probes are not logged"
fi
if docker logs "$GATE" 2>&1 | grep -qF -e "$PASSWORD" -e "w0rd" -e "$USERNAME"; then
    fail "logs never contain the credentials"
else
    pass "logs never contain the credentials"
fi

echo
if [ "$failures" -gt 0 ]; then
    echo "❌ ${failures} gate check(s) failed"
    exit 1
fi
echo "✅ All gate checks passed"
