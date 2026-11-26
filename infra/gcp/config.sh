# shellcheck shell=sh disable=SC2034 # The variables are read by the scripts that source this file.
# Expected GCP configuration for moliveda-web (MASTERPLAN 10.1, 10.3 and 10.5). Sourced by
# bootstrap.sh and check.sh. Names and public ids only: never put a secret in this file.
#
# The shared Workload Identity pool, provider and deployer are owned by the projects, not by this
# repository (D21). Write their names once per project as the defaults below, for example
# `WIF_POOL="${OVERRIDE_WIF_POOL:-github}"`; `check.sh <env>` lists the pools and providers it finds while
# a value is missing.

REGION="us-central1"

# This repository, bound by name like the owner's other repositories (the shared providers map
# `attribute.repository`, and their condition accepts only this owner). Renaming the repository
# means updating these values and running bootstrap.sh again (MASTERPLAN 10.3).
GITHUB_REPOSITORY="M-oliveda/moliveda_web"
GITHUB_REPOSITORY_OWNER="M-oliveda"

RUNTIME_SA_NAME="moliveda-web-runtime"

# Production only: a dedicated deployer with a custom role that cannot delete services, so the
# shared deployer of the production project is never changed (Phase 2 owner decision).
PROD_DEPLOYER_SA_NAME="moliveda-web-deployer"
PROD_DEPLOYER_ROLE_ID="molivedaWebDeployer"

# APIs the services and the deploys use.
REQUIRED_APIS="run.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com logging.googleapis.com monitoring.googleapis.com cloudtrace.googleapis.com clouderrorreporting.googleapis.com"

# Overrides from the caller's environment, captured once: load_environment sets the same names,
# so reading them there would carry one environment's values into the next (`check.sh all`).
OVERRIDE_WIF_POOL="${WIF_POOL:-}"
OVERRIDE_WIF_PROVIDER="${WIF_PROVIDER:-}"
OVERRIDE_SHARED_DEPLOYER_SA="${SHARED_DEPLOYER_SA:-}"

# Sets PROJECT_ID, GITHUB_ENVIRONMENT, WIF_POOL, WIF_PROVIDER and SHARED_DEPLOYER_SA for an
# environment key (dev, prev, stg, prod). Returns 1 for an unknown key.
# Each value can be overridden from the caller's environment, for example
# `WIF_POOL=github-pool infra/gcp/check.sh dev`.
load_environment() {
    case "$1" in
        dev)
            PROJECT_ID="moliveda-gcloudprojects-dev"
            GITHUB_ENVIRONMENT="develop"
            WIF_POOL="${OVERRIDE_WIF_POOL:-github-pool}"
            WIF_PROVIDER="${OVERRIDE_WIF_PROVIDER:-github-provider}"
            SHARED_DEPLOYER_SA="${OVERRIDE_SHARED_DEPLOYER_SA:-cicd-deployer-dev@moliveda-gcloudprojects-dev.iam.gserviceaccount.com}"
            ;;
        prev)
            PROJECT_ID="moliveda-gcloudprojects-prev"
            GITHUB_ENVIRONMENT="preview"
            WIF_POOL="${OVERRIDE_WIF_POOL:-github-pool}"
            WIF_PROVIDER="${OVERRIDE_WIF_PROVIDER:-github-provider}"
            SHARED_DEPLOYER_SA="${OVERRIDE_SHARED_DEPLOYER_SA:-cicd-deployer-prev@moliveda-gcloudprojects-prev.iam.gserviceaccount.com}"
            ;;
        stg)
            PROJECT_ID="moliveda-gcloudprojects-stg"
            GITHUB_ENVIRONMENT="staging"
            WIF_POOL="${OVERRIDE_WIF_POOL:-github-pool}"
            WIF_PROVIDER="${OVERRIDE_WIF_PROVIDER:-github-provider}"
            SHARED_DEPLOYER_SA="${OVERRIDE_SHARED_DEPLOYER_SA:-cicd-deployer-stg@moliveda-gcloudprojects-stg.iam.gserviceaccount.com}"
            ;;
        prod)
            PROJECT_ID="moliveda-gcloudprojects-prod"
            GITHUB_ENVIRONMENT="production"
            WIF_POOL="${OVERRIDE_WIF_POOL:-github-pool}"
            WIF_PROVIDER="${OVERRIDE_WIF_PROVIDER:-github-provider}"
            # Not used: production deploys with PROD_DEPLOYER_SA_NAME.
            SHARED_DEPLOYER_SA=""
            ;;
        *)
            return 1
            ;;
    esac
}

# The deployer this repository impersonates in the loaded environment.
deployer_sa() {
    if [ "$GITHUB_ENVIRONMENT" = "production" ]; then
        echo "${PROD_DEPLOYER_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
    else
        echo "$SHARED_DEPLOYER_SA"
    fi
}

runtime_sa() {
    echo "${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
}
