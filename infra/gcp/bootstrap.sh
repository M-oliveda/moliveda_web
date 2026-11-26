#!/bin/sh
# shellcheck source-path=SCRIPTDIR
# One-time, idempotent setup of a moliveda-web GCP project (MASTERPLAN 10.5). Run by the owner
# with their own gcloud login, never by CI. Every step checks before it changes anything, so a
# second run changes nothing. The shared Workload Identity provider is never modified.
#
#   infra/gcp/bootstrap.sh <dev|prev|stg|prod> [--dry-run]
#
# Steps: enable the APIs; create the runtime service account (no roles); in production, create
# the deployer and its custom role; create the Artifact Registry repository and apply its
# cleanup policies (in production, let the deployer push to it); let the deployer act as the
# runtime account; let this repository impersonate the deployer through Workload Identity
# Federation.

set -eu

GCP_DIR="$(cd "$(dirname "$0")" && pwd)"
ROLE_FILE="$GCP_DIR/roles/deployer-production.yaml"
. "$GCP_DIR/config.sh"
. "$GCP_DIR/lib.sh"

usage() {
    echo "usage: infra/gcp/bootstrap.sh <dev|prev|stg|prod> [--dry-run]" >&2
    exit 2
}

[ $# -ge 1 ] || usage
ENV_KEY="$1"
shift
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        *) usage ;;
    esac
done
load_environment "$ENV_KEY" || usage
require_gcloud
require_identity_names

DEPLOYER_SA="$(deployer_sa)"
RUNTIME_SA="$(runtime_sa)"

info "Bootstrapping $PROJECT_ID ($GITHUB_ENVIRONMENT)$([ "$DRY_RUN" = 1 ] && echo ', dry run')"
PROJECT_NUMBER="$(project_number)"
[ -n "$PROJECT_NUMBER" ] || die "cannot read the project number of $PROJECT_ID"

info "APIs"
ENABLED="$(enabled_apis)"
for api in $REQUIRED_APIS; do
    if printf '%s\n' "$ENABLED" | grep -Fxq "$api"; then
        ok "$api"
    else
        mutate services enable "$api" --project "$PROJECT_ID"
    fi
done

info "Runtime service account"
if sa_exists "$RUNTIME_SA"; then
    ok "$RUNTIME_SA"
else
    mutate iam service-accounts create "$RUNTIME_SA_NAME" --project "$PROJECT_ID" \
        --display-name "moliveda-web runtime (no roles)"
fi

if [ "$GITHUB_ENVIRONMENT" = "production" ]; then
    info "Production deployer"
    if ! role_exists; then
        mutate iam roles create "$PROD_DEPLOYER_ROLE_ID" --project "$PROJECT_ID" --file "$ROLE_FILE"
    elif [ "$(role_permissions)" != "$(expected_role_permissions)" ]; then
        mutate iam roles update "$PROD_DEPLOYER_ROLE_ID" --project "$PROJECT_ID" --file "$ROLE_FILE" --quiet
    else
        ok "role $PROD_DEPLOYER_ROLE_ID"
    fi
    if sa_exists "$DEPLOYER_SA"; then
        ok "$DEPLOYER_SA"
    else
        mutate iam service-accounts create "$PROD_DEPLOYER_SA_NAME" --project "$PROJECT_ID" \
            --display-name "moliveda-web deployer (GitHub Actions)"
    fi
    ROLE="projects/$PROJECT_ID/roles/$PROD_DEPLOYER_ROLE_ID"
    if has_binding "$(project_policy)" "$ROLE" "serviceAccount:$DEPLOYER_SA"; then
        ok "deployer holds $ROLE"
    else
        mutate projects add-iam-policy-binding "$PROJECT_ID" \
            --member "serviceAccount:$DEPLOYER_SA" --role "$ROLE" --condition None
    fi
fi

info "Artifact Registry repository $REGISTRY_REPOSITORY"
if repository_exists; then
    ok "$REGISTRY_REPOSITORY in $REGION"
else
    mutate artifacts repositories create "$REGISTRY_REPOSITORY" --repository-format docker \
        --location "$REGION" --project "$PROJECT_ID" \
        --description "moliveda-web images (app, gate), cleaned up by policy"
fi
if [ "$DRY_RUN" = 1 ] && ! repository_exists; then
    info "  would  apply $(cleanup_policy_file)"
elif cleanup_policies_current; then
    ok "cleanup policies match $(basename "$(cleanup_policy_file)")"
else
    # Remove the policies the file no longer lists, then apply the file.
    expected="$(expected_cleanup_policy_names)"
    stale="$(cleanup_policy_names | while read -r name; do
        printf '%s\n' "$expected" | grep -Fxq "$name" || printf '%s\n' "$name"
    done | paste -sd ',' -)"
    if [ -n "$stale" ]; then
        mutate artifacts repositories delete-cleanup-policies "$REGISTRY_REPOSITORY" \
            --policynames "$stale" --location "$REGION" --project "$PROJECT_ID"
    fi
    mutate artifacts repositories set-cleanup-policies "$REGISTRY_REPOSITORY" \
        --policy "$(cleanup_policy_file)" --no-dry-run --location "$REGION" --project "$PROJECT_ID"
fi
if [ "$GITHUB_ENVIRONMENT" = "production" ]; then
    # Push rights on this repository only. The shared deployers hold them at project level.
    if has_binding "$(repository_policy)" roles/artifactregistry.writer "serviceAccount:$DEPLOYER_SA"; then
        ok "deployer may push to $REGISTRY_REPOSITORY"
    else
        mutate artifacts repositories add-iam-policy-binding "$REGISTRY_REPOSITORY" \
            --location "$REGION" --project "$PROJECT_ID" \
            --member "serviceAccount:$DEPLOYER_SA" --role roles/artifactregistry.writer
    fi
fi

info "Deployer may act as the runtime service account"
if has_binding "$(sa_policy "$RUNTIME_SA")" roles/iam.serviceAccountUser "serviceAccount:$DEPLOYER_SA"; then
    ok "roles/iam.serviceAccountUser for $DEPLOYER_SA"
else
    mutate iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --project "$PROJECT_ID" \
        --member "serviceAccount:$DEPLOYER_SA" --role roles/iam.serviceAccountUser
fi

info "Workload Identity binding for $GITHUB_REPOSITORY"
if ! provider_maps_repository "$(provider_json 2> /dev/null || true)"; then
    die "cannot read provider $WIF_PROVIDER, or it does not map attribute.repository. It is shared, so this script does not change it: add the mapping yourself, then run again."
fi
MEMBER="$(wif_member "$PROJECT_NUMBER")"
if has_binding "$(sa_policy "$DEPLOYER_SA")" roles/iam.workloadIdentityUser "$MEMBER"; then
    ok "roles/iam.workloadIdentityUser for $GITHUB_REPOSITORY"
else
    mutate iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" --project "$PROJECT_ID" \
        --member "$MEMBER" --role roles/iam.workloadIdentityUser
fi

info "Done. Run infra/gcp/check.sh $ENV_KEY to confirm there is no drift."
