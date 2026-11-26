# First deploy

Sets up GitHub for the deploy workflows (`MASTERPLAN.md` 10.2 to 10.4), then proves Phase 2's "done when": a pull request gets a gated preview that is deleted when it closes, and a push to `develop` deploys development behind the gate.

## 1. GCP

Follow [the GCP bootstrap](../../infra/gcp/README.md) for `dev` and `prev`, at least. It also creates each project's Artifact Registry repository and its cleanup policies, so images need no other account or token. Keep each project number from `check.sh`.

## 2. GitHub settings

Use `gh secret set NAME [--env ENV]` without `--body`, so it prompts for the value and nothing lands in your shell history. Never paste a value into an issue, a pull request or a chat.

**Repository variables:** `GCP_REGION` = `us-central1`.

There are no repository secrets: image pushes use the Workload Identity login. If `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` or `DOCKERHUB_CLEANUP_TOKEN` still exist from the Docker Hub setup, delete them (`gh variable delete`, `gh secret delete`) and revoke the tokens on Docker Hub.

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

**Branch policy of `preview`:** allow `refs/pull/*/merge`, `develop` and `main` (10.3). GitHub matches the rule against `GITHUB_REF`, not the pull request's head branch. An open pull request's run has `refs/pull/<number>/merge`, the closing event of a merged pull request has the base branch (`develop`), and `scheduled.yml` deletes stale previews from `main`. A `feature/*` rule alone fails with `Branch "refs/pull/<number>/merge" is not allowed to deploy to preview due to environment protection rules`.

```sh
gh api -X POST repos/M-oliveda/moliveda_web/environments/preview/deployment-branch-policies \
  -f name='refs/pull/*/merge' -f type=branch
```

## 3. First preview

1. Open the Phase 2 pull request into `develop`. CI runs, then `deploy-preview`.
2. The run summary and a pull request comment show `https://moliveda-web-pr-<n>-<number>.us-central1.run.app`.
3. Open it. The browser asks for the `preview` credentials, and the page loads after you log in. `/health` and `/ready` answer without credentials.

## 4. Confirm the gate's client-IP key (MASTERPLAN 13)

The gate rate-limits by the rightmost `X-Forwarded-For` entry and logs it as `httpRequest.remoteIp`. After loading the preview a few times, open Cloud Logging in `moliveda-gcloudprojects-prev`:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="moliveda-web-pr-<n>"
jsonPayload.component="gate"
```

- If `remoteIp` is **your public IP**, the key is right. Record that in `MASTERPLAN.md` section 13.
- If it's a **Google address** (for example `35.191.x.x` or `130.211.x.x`), the client is one entry further left. Change the `map $http_x_forwarded_for $client_ip` block in `docker/nginx/nginx.conf.template`, then run `scripts/test-gate.sh` before shipping the fix.

## 5. Development, then cleanup

1. Merge the pull request. The `develop` push deploys `moliveda-web` to `moliveda-gcloudprojects-dev`, and the run prints the URL.
2. `cleanup-preview.yml` runs on the close: `gcloud run services list --project moliveda-gcloudprojects-prev --region us-central1` no longer lists `moliveda-web-pr-<n>`. Its images are left to the preview repository's cleanup policy, which deletes all but the newest within about a day (`gcloud artifacts docker images list us-central1-docker.pkg.dev/moliveda-gcloudprojects-prev/moliveda-web --include-tags`).

## Troubleshooting

| Symptom                                                             | Cause and fix                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `google-github-actions/auth`: `unauthorized` or `permission denied` | The Workload Identity binding or the provider's `attribute.repository` mapping is missing, or the repository was renamed (update `GITHUB_REPOSITORY` in `infra/gcp/config.sh` and run `bootstrap.sh` again). Run `infra/gcp/check.sh <env>`.                                                                                           |
| `Permission 'iam.serviceaccounts.actAs' denied`                     | The deployer lacks `roles/iam.serviceAccountUser` on `moliveda-web-runtime`. Run `bootstrap.sh <env>`.                                                                                                                                                                                                                                 |
| The deploy is refused on `invoker-iam-disabled`                     | An organization policy (`constraints/run.requireInvokerIam`) forbids public services. It has to be lifted for the project, because the gate does the authentication.                                                                                                                                                                   |
| `Image '…' not found` on `Deploy`                                   | The image is not in the project's own repository. Check that `bootstrap.sh <env>` created `moliveda-web` there, that the push step pushed to `us-central1-docker.pkg.dev/<project>/moliveda-web`, and that `GCP_PROJECT_ID` is the environment's project. An image from Docker Hub fails through `mirror.gcr.io`'s shared quota (D20). |
| Push fails with `denied` or `unauthenticated`                       | The deployer cannot write to the repository. Production: `bootstrap.sh prod` grants `roles/artifactregistry.writer` on it. Elsewhere the shared deployer needs that role at project level. Run `infra/gcp/check.sh <env>`.                                                                                                             |
| The deploy says the image platform is unsupported                   | Cloud Run rejected the image index (the provenance and SBOM attestations). Deploy the `linux/amd64` manifest digest instead (`docker buildx imagetools inspect`).                                                                                                                                                                      |
| The app container never becomes ready                               | Read its logs: `env.ts` lists missing keys by name. `APP_ENV` comes from the manifest, so a missing value means a missing GitHub variable or secret.                                                                                                                                                                                   |
| `Verify image digests` fails with `runs sha256:…, expected …`       | A container runs another build than the one this run pushed, for example through a reused tag. Check the tags in the plan output, then re-run the job.                                                                                                                                                                                 |
| The smoke test fails on `401`                                       | The gate didn't start with credentials. Check both `BASIC_AUTH_*` secrets exist in that environment.                                                                                                                                                                                                                                   |
