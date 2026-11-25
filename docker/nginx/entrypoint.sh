#!/bin/sh
# Builds the htpasswd file for the NGINX gate from BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD and
# writes the auth directives that nginx.conf.template includes. Runs from /docker-entrypoint.d/
# before the official entrypoint renders the templates and starts NGINX. The password is
# bcrypt-hashed, read by htpasswd from stdin (never from argv), and neither value is ever printed.
#
# Credentials are required everywhere except when APP_ENV=local, where leaving both unset (or
# empty) starts the gate open. The opt-out is explicit so a deployed gate whose secrets are missing
# fails closed instead of serving the site without a password. Providing only one of the two
# values is always an error.
set -eu

target="${BASIC_AUTH_HTPASSWD_FILE:-/etc/nginx/auth/htpasswd}"
# Fixed path: nginx.conf.template includes it. Same directory as the htpasswd file (0700, nginx).
auth_conf="/etc/nginx/auth/gate-auth.conf"

username="${BASIC_AUTH_USERNAME:-}"
password="${BASIC_AUTH_PASSWORD:-}"

# The file is created read-only (0400), so a container restart must remove the old ones first.
umask 0377
rm -f "$target" "$auth_conf"

if [ -z "$username" ] && [ -z "$password" ]; then
  if [ "${APP_ENV:-}" != "local" ]; then
    echo "gate: BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD are empty or unset (they may only be" \
      "omitted when APP_ENV=local)" >&2
    exit 1
  fi
  echo "auth_basic off;" > "$auth_conf"
  echo "gate: WARNING no credentials and APP_ENV=local, basic auth is DISABLED" >&2
  exit 0
fi

# `:?` aborts when only one of the two values is set.
: "${username:?gate: BASIC_AUTH_USERNAME is empty or unset}"
: "${password:?gate: BASIC_AUTH_PASSWORD is empty or unset}"

if ! printf '%s\n' "$password" | htpasswd -niB "$username" > "$target"; then
  rm -f "$target"
  echo "gate: could not hash the credentials (the username must not contain ':' and the password" \
    "must be at most 72 bytes)" >&2
  exit 1
fi

{
  echo 'auth_basic "Restricted";'
  echo "auth_basic_user_file ${target};"
} > "$auth_conf"

echo "gate: htpasswd file written to $target"
