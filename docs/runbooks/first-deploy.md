# First deploy

Sets up GitHub and Docker Hub for the deploy workflows (`MASTERPLAN.md` 10.2 to 10.4), then proves Phase 2's "done when": a pull request gets a gated preview that is deleted when it closes, and a push to `develop` deploys development behind the gate.

## 1. Docker Hub

1. Create two **public** repositories under your namespace: `moliveda-web` and `moliveda-web-gate`. Creating them first avoids a push creating them private.
2. Create two personal access tokens:
   - `DOCKERHUB_TOKEN` with **Read & Write**, used to push.
   - `DOCKERHUB_CLEANUP_TOKEN` with **Read, Write & Delete**, used only by `cleanup-preview.yml` and `scheduled.yml`.

## 2. GCP

Follow [the GCP bootstrap](../../infra/gcp/README.md) for `dev` and `prev`, at least. Keep each project number from `check.sh`.

## 3. GitHub settings

Use `gh secret set NAME [--env ENV]` without `--body`, so it prompts for the value and nothing lands in your shell history. Never paste a value into an issue, a pull request or a chat.

**Repository variables:** `DOCKERHUB_USERNAME`, `GCP_REGION` = `us-central1`.

**Repository secrets:** `DOCKERHUB_TOKEN`, `DOCKERHUB_CLEANUP_TOKEN`.

**Per environment** (`develop`, `preview`, `staging`, `production`):

| Kind     | Name                                         | Value                                                                                                                                      |
| -------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Variable | `GCP_PROJECT_ID`                             | `moliveda-gcloudprojects-{dev,prev,stg,prod}`                                                                                              |
| Variable | `GCP_PROJECT_NUMBER`                         | from `infra/gcp/check.sh <env>`                                                                                                            |
| Variable | `GCP_WORKLOAD_IDENTITY_PROVIDER`             | `projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`                                                     |
| Variable | `GCP_SERVICE_ACCOUNT`                        | the shared deployer's email; in `production`, `moliveda-web-deployer@moliveda-gcloudprojects-prod.iam.gserviceaccount.com`                 |
| Variable | `EMAIL_DRIVER`                               | `fake` in `develop` and `preview` (D24). Not read until Phase 5.                                                                           |
| Secret   | `BASIC_AUTH_USERNAME`, `BASIC_AUTH_PASSWORD` | `develop`, `preview`, `staging` only. The owner uses **the same login in all three** (Phase 2 decision). The password is at most 72 bytes. |
| Secret   | `ORIGIN_VERIFY_SECRET`                       | `production` only: `openssl rand -hex 32`                                                                                                  |
| Variable | `NEXT_PUBLIC_SITE_URL`                       | `production` only: `https://moliveda.dev`. Other environments use their `run.app` URL automatically.                                       |

To set the shared gate login in all three gated environments, run this in zsh. It asks for each value once and nothing is echoed or saved in history:

```zsh
read -r "gate_user?Gate username: "
read -rs "gate_pass?Gate password: "; echo
for env in develop preview staging; do
  printf '%s' "$gate_user" | gh secret set BASIC_AUTH_USERNAME --repo M-oliveda/moliveda_web --env "$env"
  printf '%s' "$gate_pass" | gh secret set BASIC_AUTH_PASSWORD --repo M-oliveda/moliveda_web --env "$env"
done
unset gate_user gate_pass
```

The Turnstile, Resend, contact and analytics values in `MASTERPLAN.md` 10.3 come with Phases 5 and 7.

**Branch policy of `preview`:** allow `feature/*` and `hotfix/*` (the pull request branches, 10.3), plus `develop` and `main`. GitHub may match the closing event of a merged pull request against the base branch (`develop`), and `scheduled.yml` deletes stale previews from `main`. Check the first merged pull request's cleanup run. If it ran under `feature/*` alone, you can remove `develop` again.

## 4. First preview

1. Open the Phase 2 pull request into `develop`. CI runs, then `deploy-preview`.
2. The run summary and a pull request comment show `https://moliveda-web-pr-<n>-<number>.us-central1.run.app`.
3. Open it. The browser asks for the `preview` credentials, and the page loads after you log in. `/health` and `/ready` answer without credentials.

## 5. Confirm the gate's client-IP key (MASTERPLAN 13)

The gate rate-limits by the rightmost `X-Forwarded-For` entry and logs it as `httpRequest.remoteIp`. After loading the preview a few times, open Cloud Logging in `moliveda-gcloudprojects-prev`:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="moliveda-web-pr-<n>"
jsonPayload.component="gate"
```

- If `remoteIp` is **your public IP**, the key is right. Record that in `MASTERPLAN.md` section 13.
- If it's a **Google address** (for example `35.191.x.x` or `130.211.x.x`), the client is one entry further left. Change the `map $http_x_forwarded_for $client_ip` block in `docker/nginx/nginx.conf.template`, then run `scripts/test-gate.sh` before shipping the fix.

## 6. Development, then cleanup

1. Merge the pull request. The `develop` push deploys `moliveda-web` to `moliveda-gcloudprojects-dev`, and the run prints the URL.
2. `cleanup-preview.yml` runs on the close: `gcloud run services list --project moliveda-gcloudprojects-prev --region us-central1` no longer lists `moliveda-web-pr-<n>`, and the `pr-<n>-*` tags are gone from Docker Hub.

## Troubleshooting

| Symptom                                                             | Cause and fix                                                                                                                                                                                                                                |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `google-github-actions/auth`: `unauthorized` or `permission denied` | The Workload Identity binding or the provider's `attribute.repository` mapping is missing, or the repository was renamed (update `GITHUB_REPOSITORY` in `infra/gcp/config.sh` and run `bootstrap.sh` again). Run `infra/gcp/check.sh <env>`. |
| `Permission 'iam.serviceaccounts.actAs' denied`                     | The deployer lacks `roles/iam.serviceAccountUser` on `moliveda-web-runtime`. Run `bootstrap.sh <env>`.                                                                                                                                       |
| The deploy is refused on `invoker-iam-disabled`                     | An organization policy (`constraints/run.requireInvokerIam`) forbids public services. It has to be lifted for the project, because the gate does the authentication.                                                                         |
| The deploy says the image platform is unsupported                   | Cloud Run rejected the image index (the provenance and SBOM attestations). Deploy the `linux/amd64` manifest digest instead (`docker buildx imagetools inspect`).                                                                            |
| The app container never becomes ready                               | Read its logs: `env.ts` lists missing keys by name. `APP_ENV` comes from the manifest, so a missing value means a missing GitHub variable or secret.                                                                                         |
| The smoke test fails on `401`                                       | The gate didn't start with credentials. Check both `BASIC_AUTH_*` secrets exist in that environment.                                                                                                                                         |
