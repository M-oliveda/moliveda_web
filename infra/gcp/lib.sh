# shellcheck shell=sh
# Helpers shared by bootstrap.sh and check.sh. POSIX sh, so the scripts run on macOS and in the
# Alpine container that runs their tests (infra/gcp/gcp.test.ts).

# gcloud must never ask a question: a prompt such as "enable this API and retry?" would hide
# behind the redirected stderr, look like a hang, and could change a project from check.sh.
# With prompts disabled gcloud takes the safe default (no) and the call fails instead.
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

DRY_RUN="${DRY_RUN:-0}"
DRIFT=0
WARNINGS=0

info() { printf '%s\n' "$*"; }
ok() { printf '  ok     %s\n' "$*"; }
drift() {
    printf '  DRIFT  %s\n' "$*"
    DRIFT=$((DRIFT + 1))
}
warn() {
    printf '  warn   %s\n' "$*"
    WARNINGS=$((WARNINGS + 1))
}
die() {
    printf 'error: %s\n' "$*" >&2
    exit 2
}

# Runs a mutating gcloud command, or prints it with --dry-run.
mutate() {
    if [ "$DRY_RUN" = 1 ]; then
        printf '  would  gcloud %s\n' "$*"
    else
        printf '  run    gcloud %s\n' "$*"
        gcloud "$@"
    fi
}

require_gcloud() {
    command -v gcloud > /dev/null 2>&1 || die "gcloud is not installed or not on PATH"
}

# ── Read-only queries ────────────────────────────────────────────────────────────────────────

project_number() {
    gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)'
}

enabled_apis() {
    gcloud services list --enabled --project "$PROJECT_ID" --format='value(config.name)'
}

sa_exists() {
    gcloud iam service-accounts describe "$1" --project "$PROJECT_ID" \
        --format='value(email)' > /dev/null 2>&1
}

# One "role member" line per binding member, or nothing when the account does not exist yet.
sa_policy() {
    gcloud iam service-accounts get-iam-policy "$1" --project "$PROJECT_ID" \
        --flatten='bindings[].members' --format='value(bindings.role,bindings.members)' \
        2> /dev/null || true
}

project_policy() {
    gcloud projects get-iam-policy "$PROJECT_ID" \
        --flatten='bindings[].members' --format='value(bindings.role,bindings.members)'
}

# has_binding "<policy lines>" <role> <member>
has_binding() {
    printf '%s\n' "$1" | awk -v role="$2" -v member="$3" \
        '$1 == role && $2 == member { found = 1 } END { exit found ? 0 : 1 }'
}

# Roles held by <member> in "<policy lines>", one per line.
roles_of() {
    printf '%s\n' "$1" | awk -v member="$2" '$2 == member { print $1 }'
}

role_exists() {
    gcloud iam roles describe "$PROD_DEPLOYER_ROLE_ID" --project "$PROJECT_ID" \
        --format='value(name)' > /dev/null 2>&1
}

# Live permissions of the custom role, sorted, one per line.
role_permissions() {
    gcloud iam roles describe "$PROD_DEPLOYER_ROLE_ID" --project "$PROJECT_ID" \
        --format='value(includedPermissions)' | tr ';' '\n' | sed '/^$/d' | sort
}

# Permissions listed in the role file, sorted, one per line.
expected_role_permissions() {
    sed -n 's/^  - \(.*\)$/\1/p' "$ROLE_FILE" | sort
}

repository_exists() {
    gcloud artifacts repositories describe "$REGISTRY_REPOSITORY" --location "$REGION" \
        --project "$PROJECT_ID" --format='value(name)' > /dev/null 2>&1
}

# "<format> <dry run>" of the repository, for example "DOCKER False".
repository_settings() {
    gcloud artifacts repositories describe "$REGISTRY_REPOSITORY" --location "$REGION" \
        --project "$PROJECT_ID" --format='value(format,cleanupPolicyDryRun)'
}

# Names of the live cleanup policies, sorted, one per line.
cleanup_policy_names() {
    gcloud artifacts repositories describe "$REGISTRY_REPOSITORY" --location "$REGION" \
        --project "$PROJECT_ID" --format='json(cleanupPolicies)' |
        sed -n 's/^ *"id": "\(.*\)",*$/\1/p' | sort
}

# Names of the cleanup policies in the environment's file, sorted, one per line.
expected_cleanup_policy_names() {
    sed -n 's/^ *"name": "\(.*\)",*$/\1/p' "$(cleanup_policy_file)" | sort
}

# True when the live policies match the file and are applied, not only logged (dry run).
cleanup_policies_current() {
    dry_run="$(repository_settings | awk '{ print $2 }')"
    [ "$dry_run" != "True" ] && [ "$(cleanup_policy_names)" = "$(expected_cleanup_policy_names)" ]
}

repository_policy() {
    gcloud artifacts repositories get-iam-policy "$REGISTRY_REPOSITORY" --location "$REGION" \
        --project "$PROJECT_ID" --flatten='bindings[].members' \
        --format='value(bindings.role,bindings.members)' 2> /dev/null || true
}

# True when the provider JSON maps `attribute.repository` (the key itself, not a longer one).
provider_maps_repository() {
    printf '%s' "$1" | grep -q '"attribute\.repository"'
}

provider_json() {
    gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER" \
        --workload-identity-pool "$WIF_POOL" --location global --project "$PROJECT_ID" \
        --format=json
}

# The principal set this repository's workflows authenticate as (10.3).
wif_member() {
    printf 'principalSet://iam.googleapis.com/projects/%s/locations/global/workloadIdentityPools/%s/attribute.repository/%s' \
        "$1" "$WIF_POOL" "$GITHUB_REPOSITORY"
}

# Exits with a usage error unless the shared Workload Identity names are configured.
require_identity_names() {
    [ -n "$WIF_POOL" ] || die "WIF_POOL is not set for '$ENV_KEY' (see infra/gcp/config.sh)"
    [ -n "$WIF_PROVIDER" ] || die "WIF_PROVIDER is not set for '$ENV_KEY' (see infra/gcp/config.sh)"
    if [ "$GITHUB_ENVIRONMENT" != "production" ] && [ -z "$SHARED_DEPLOYER_SA" ]; then
        die "SHARED_DEPLOYER_SA is not set for '$ENV_KEY' (see infra/gcp/config.sh)"
    fi
}
