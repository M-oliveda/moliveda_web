#!/bin/sh
# shellcheck source-path=SCRIPTDIR
# Read-only drift check for the moliveda-web GCP projects (MASTERPLAN 10.5). Compares the live
# configuration with infra/gcp/config.sh and exits non-zero on drift. It never changes anything:
# infra/gcp/gcp.test.ts fails if it calls a mutating gcloud command. Run it before each release.
#
#   infra/gcp/check.sh <dev|prev|stg|prod|all>
#
# Exit codes: 0 no drift, 1 drift, 2 usage error. Monitoring and the domain mapping are added
# in Phase 7, when they exist.

set -eu

GCP_DIR="$(cd "$(dirname "$0")" && pwd)"
ROLE_FILE="$GCP_DIR/roles/deployer-production.yaml"
. "$GCP_DIR/config.sh"
. "$GCP_DIR/lib.sh"

usage() {
    echo "usage: infra/gcp/check.sh <dev|prev|stg|prod|all>" >&2
    exit 2
}

# Lists the pools and providers of the project, so the owner can fill in config.sh.
list_identity_names() {
    for pool in $(gcloud iam workload-identity-pools list --location global \
        --project "$PROJECT_ID" --format='value(name.basename())' 2> /dev/null || true); do
        providers="$(gcloud iam workload-identity-pools providers list \
            --workload-identity-pool "$pool" --location global --project "$PROJECT_ID" \
            --format='value(name.basename())' 2> /dev/null | tr '\n' ' ' || true)"
        info "         found pool '$pool', providers: ${providers:-none}"
    done
    if [ "$GITHUB_ENVIRONMENT" != "production" ] && [ -z "$SHARED_DEPLOYER_SA" ]; then
        for account in $(gcloud iam service-accounts list --project "$PROJECT_ID" \
            --format='value(email)' 2> /dev/null || true); do
            info "         found service account $account"
        done
    fi
}

check_billing() {
    billing="$(gcloud billing projects describe "$PROJECT_ID" \
        --format='value(billingEnabled,billingAccountName)' 2> /dev/null || true)"
    enabled="$(printf '%s' "$billing" | awk '{ print $1 }')"
    account="$(printf '%s' "$billing" | awk '{ print $2 }' | sed 's#^billingAccounts/##')"
    if [ "$enabled" != "True" ]; then
        drift "billing is not enabled"
        return
    fi
    ok "billing enabled"
    if budgets="$(gcloud billing budgets list --billing-account "$account" \
        --format='value(budgetFilter.projects)' 2> /dev/null)"; then
        if printf '%s\n' "$budgets" | tr ';' '\n' | grep -Fxq "projects/$PROJECT_NUMBER"; then
            ok "a budget covers the project"
        else
            drift "no budget is scoped to projects/$PROJECT_NUMBER"
        fi
    else
        warn "cannot read the budgets (needs billing.budgets.list and billingbudgets.googleapis.com on your gcloud quota project)"
    fi
}

check_apis() {
    if ! enabled="$(enabled_apis 2> /dev/null)"; then
        drift "cannot list the enabled APIs"
        return
    fi
    for api in $REQUIRED_APIS; do
        if printf '%s\n' "$enabled" | grep -Fxq "$api"; then
            ok "API $api"
        else
            drift "API $api is not enabled"
        fi
    done
}

check_runtime_sa() {
    if ! sa_exists "$RUNTIME_SA"; then
        drift "runtime service account $RUNTIME_SA is missing"
        return
    fi
    ok "runtime service account exists"
    roles="$(roles_of "$POLICY" "serviceAccount:$RUNTIME_SA")"
    if [ -n "$roles" ]; then
        drift "runtime service account has project roles: $(printf '%s' "$roles" | tr '\n' ' ')"
    else
        ok "runtime service account has no project roles"
    fi
}

check_prod_deployer() {
    if ! role_exists; then
        drift "custom role $PROD_DEPLOYER_ROLE_ID is missing"
    elif [ "$(role_permissions)" != "$(expected_role_permissions)" ]; then
        drift "custom role $PROD_DEPLOYER_ROLE_ID differs from roles/deployer-production.yaml"
    else
        ok "custom role $PROD_DEPLOYER_ROLE_ID matches"
    fi
    if ! sa_exists "$DEPLOYER_SA"; then
        drift "production deployer $DEPLOYER_SA is missing"
        return
    fi
    expected="projects/$PROJECT_ID/roles/$PROD_DEPLOYER_ROLE_ID"
    roles="$(roles_of "$POLICY" "serviceAccount:$DEPLOYER_SA")"
    if [ "$roles" = "$expected" ]; then
        ok "production deployer holds only $expected"
    else
        drift "production deployer roles are '$(printf '%s' "$roles" | tr '\n' ' ')', expected only $expected"
    fi
}

check_shared_deployer() {
    if ! sa_exists "$DEPLOYER_SA"; then
        drift "shared deployer $DEPLOYER_SA is missing"
        return
    fi
    if roles_of "$POLICY" "serviceAccount:$DEPLOYER_SA" | grep -Eq '^roles/run\.(admin|developer)$'; then
        ok "shared deployer can deploy Cloud Run services"
    else
        # It may hold the permissions through a custom role or a group, so this is not drift.
        warn "shared deployer holds neither roles/run.admin nor roles/run.developer directly"
    fi
}

check_registry() {
    if ! repository_exists; then
        drift "Artifact Registry repository $REGISTRY_REPOSITORY is missing in $REGION"
        return
    fi
    format="$(repository_settings | awk '{ print $1 }')"
    if [ "$format" = "DOCKER" ]; then
        ok "repository $REGISTRY_REPOSITORY exists"
    else
        drift "repository $REGISTRY_REPOSITORY has format '$format', expected DOCKER"
    fi
    if cleanup_policies_current; then
        ok "cleanup policies match $(basename "$(cleanup_policy_file)") and delete images"
    else
        drift "cleanup policies are '$(cleanup_policy_names | tr '\n' ' ')' (dry run: $(repository_settings | awk '{ print $2 }')), expected '$(expected_cleanup_policy_names | tr '\n' ' ')' applied"
    fi
}

# The deployer must be able to push images. Production: on the repository only (bootstrap.sh).
check_registry_writer() {
    if has_binding "$(repository_policy)" roles/artifactregistry.writer "serviceAccount:$DEPLOYER_SA"; then
        ok "deployer may push to $REGISTRY_REPOSITORY"
    elif [ "$GITHUB_ENVIRONMENT" = "production" ]; then
        drift "production deployer lacks roles/artifactregistry.writer on $REGISTRY_REPOSITORY"
    elif roles_of "$POLICY" "serviceAccount:$DEPLOYER_SA" | grep -Eq '^roles/artifactregistry\.(writer|repoAdmin|admin)$'; then
        ok "shared deployer may push images (project role)"
    else
        # It may hold the permission through a custom role or a group, so this is not drift.
        warn "shared deployer holds no Artifact Registry writer role directly"
    fi
}

check_deployer_bindings() {
    if has_binding "$(sa_policy "$RUNTIME_SA")" roles/iam.serviceAccountUser "serviceAccount:$DEPLOYER_SA"; then
        ok "deployer may act as the runtime service account"
    else
        drift "deployer lacks roles/iam.serviceAccountUser on $RUNTIME_SA"
    fi

    if ! provider="$(provider_json 2> /dev/null)"; then
        drift "cannot read provider $WIF_POOL/$WIF_PROVIDER"
        return
    fi
    if provider_maps_repository "$provider"; then
        ok "provider maps attribute.repository"
    else
        drift "provider does not map attribute.repository"
    fi
    if printf '%s' "$provider" | grep -Eq 'repository_owner_id|repository_owner'; then
        ok "provider condition restricts the repository owner"
    else
        warn "provider condition does not restrict the owner (expected assertion.repository_owner == '$GITHUB_REPOSITORY_OWNER'; shared resource, owner decision)"
    fi
    if has_binding "$(sa_policy "$DEPLOYER_SA")" roles/iam.workloadIdentityUser "$(wif_member "$PROJECT_NUMBER")"; then
        ok "$GITHUB_REPOSITORY may impersonate the deployer"
    else
        drift "Workload Identity binding for $GITHUB_REPOSITORY is missing"
    fi
}

check_environment() {
    ENV_KEY="$1"
    load_environment "$ENV_KEY" || usage
    info "== $ENV_KEY: $PROJECT_ID (GitHub Environment '$GITHUB_ENVIRONMENT')"

    if ! PROJECT_NUMBER="$(project_number 2> /dev/null)" || [ -z "$PROJECT_NUMBER" ]; then
        drift "cannot read project $PROJECT_ID (missing, or no access)"
        return
    fi
    ok "project number $PROJECT_NUMBER (set GCP_PROJECT_NUMBER to this value)"
    if ! POLICY="$(project_policy 2> /dev/null)"; then
        drift "cannot read the IAM policy of $PROJECT_ID"
        return
    fi
    RUNTIME_SA="$(runtime_sa)"

    check_billing
    check_apis
    check_runtime_sa
    check_registry

    if [ -z "$WIF_POOL" ] || [ -z "$WIF_PROVIDER" ] || {
        [ "$GITHUB_ENVIRONMENT" != "production" ] && [ -z "$SHARED_DEPLOYER_SA" ]
    }; then
        drift "Workload Identity pool, provider or shared deployer not set in infra/gcp/config.sh"
        list_identity_names
        return
    fi
    DEPLOYER_SA="$(deployer_sa)"
    if [ "$GITHUB_ENVIRONMENT" = "production" ]; then
        check_prod_deployer
    else
        check_shared_deployer
    fi
    check_registry_writer
    check_deployer_bindings
}

[ $# -eq 1 ] || usage
require_gcloud
case "$1" in
    all) ENVIRONMENTS="dev prev stg prod" ;;
    dev | prev | stg | prod) ENVIRONMENTS="$1" ;;
    *) usage ;;
esac

for environment in $ENVIRONMENTS; do
    check_environment "$environment"
done

info ""
if [ "$DRIFT" -gt 0 ]; then
    info "Drift: $DRIFT finding(s), $WARNINGS warning(s). Fix them with infra/gcp/bootstrap.sh or by hand."
    exit 1
fi
info "No drift ($WARNINGS warning(s))."
