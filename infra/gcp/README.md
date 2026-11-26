# GCP bootstrap

Idempotent setup and a read-only drift check for the four GCP projects (`MASTERPLAN.md` 10.5). The owner runs these with their own `gcloud` login. CI never runs them, and neither do AI agents (`AGENTS.md`, Mandatory Rule 4), except `check.sh` when the owner asks.

| File                             | Purpose                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `config.sh`                      | Expected values: projects, APIs, account names, the repository name and owner. Names only, no secrets.                                                 |
| `bootstrap.sh <env>`             | Enables the APIs, creates the runtime account, the production deployer and its role, the image repository with its cleanup policies, and the bindings. |
| `check.sh <env\|all>`            | Read-only. Compares the live configuration with `config.sh` and exits `1` on drift.                                                                    |
| `roles/deployer-production.yaml` | The production deployer's custom role. It can deploy and route traffic but never delete the service.                                                   |
| `cleanup/*.json`                 | Artifact Registry cleanup policies: `non-production.json` (dev, prev, stg) and `production.json`.                                                      |
| `gcp.test.ts`, `test/gcloud`     | Vitest runs both scripts against a fake `gcloud`. `check.sh` must never call a mutating command.                                                       |

Environment keys: `dev`, `prev`, `stg`, `prod` (projects `moliveda-gcloudprojects-<key>`).

## What the scripts touch

| Resource                                                                                              | dev, prev, stg                                                                     | prod                                                                                     |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| APIs (Run, Artifact Registry, IAM, IAM Credentials, STS, Logging, Monitoring, Trace, Error Reporting) | enabled                                                                            | enabled                                                                                  |
| Artifact Registry repository `moliveda-web` (Docker, `us-central1`)                                   | created, `cleanup/non-production.json` applied                                     | created, `cleanup/production.json` applied                                               |
| `roles/artifactregistry.writer` for the deployer                                                      | not added: the shared deployer holds it at project level (`check.sh` warns if not) | added **on the repository only**                                                         |
| `moliveda-web-runtime` service account, **no project roles**                                          | created                                                                            | created                                                                                  |
| Deployer                                                                                              | the project's **shared** deployer (unchanged)                                      | **`moliveda-web-deployer`**, created, holding only the custom role `molivedaWebDeployer` |
| `roles/iam.serviceAccountUser` for the deployer on the runtime account                                | added                                                                              | added                                                                                    |
| `roles/iam.workloadIdentityUser` for this repository on the deployer                                  | added                                                                              | added                                                                                    |
| Shared Workload Identity pool and provider                                                            | **never changed**                                                                  | **never changed**                                                                        |

The repository's binding is `principalSet://…/workloadIdentityPools/github-pool/attribute.repository/M-oliveda/moliveda_web`. It's bound by name, like the owner's other repositories, because the shared providers map `attribute.repository` and not the numeric id. Their condition (`assertion.repository_owner == 'M-oliveda'`) means only this owner's repositories can match. Renaming the repository breaks deploys until `GITHUB_REPOSITORY` in `config.sh` is updated and `bootstrap.sh` runs again. `bootstrap.sh` stops if a provider doesn't map `attribute.repository`. The providers are shared, so it never changes them.

## Run order

1. **Find the shared names.** Run `infra/gcp/check.sh dev`. While the pool, provider or shared deployer aren't set, it lists the pools and providers it finds. Write them into `load_environment` in `config.sh` as defaults, for example `WIF_POOL="${WIF_POOL:-github}"`. Repeat for `prev`, `stg` and `prod`. Production needs the pool and provider only.
2. **Dry run.** `infra/gcp/bootstrap.sh dev --dry-run` prints every command it would run.
3. **Apply.** `infra/gcp/bootstrap.sh dev`. Running it again changes nothing.
4. **Check.** `infra/gcp/check.sh dev` should end with `No drift`. It also prints the project number, which goes into the `GCP_PROJECT_NUMBER` variable of the matching GitHub Environment.
5. Repeat for `prev` (needed for previews), then `stg` and `prod` before the first release.

Run `infra/gcp/check.sh all` before each release.

## Cleanup policies

The repository of each project keeps only its newest images, so storage stays near the free tier (`MASTERPLAN.md` 10.4). Artifact Registry runs the policies in a background job, about once a day. A Keep policy always wins over a Delete policy.

| File                  | Keep                                | Delete                       |
| --------------------- | ----------------------------------- | ---------------------------- |
| `non-production.json` | the newest version of each image    | everything else after 1 day  |
| `production.json`     | the 2 newest versions of each image | everything else after 7 days |

Deleting an image never stops a Cloud Run revision, because Cloud Run imports the image when it deploys. Old revisions stay deployable for rollback.

To change a policy, edit its file **and bump the version in its `name`** (`keep-newest-1-v1` to `-v2`). `check.sh` compares policy names, so a renamed policy shows as drift, and `bootstrap.sh` removes the old names and applies the file. To preview a change first, apply it by hand with `gcloud artifacts repositories set-cleanup-policies moliveda-web --policy <file> --dry-run --location us-central1 --project <id>`; `check.sh` reports the dry run as drift until `bootstrap.sh` turns it off.

## Warnings

- **"provider condition does not restrict the owner".** The provider would accept tokens from any GitHub owner, so a repository with the same name under another owner could match the binding. All four current providers restrict the owner to `M-oliveda`. If this warning appears, fixing the shared provider's condition is your call.
- **The binding isn't scoped by GitHub Environment.** Any job in this repository with `id-token: write` could impersonate the deployer. Only the deploy jobs get that permission, and the environment branch policies and the production reviewer gate them. Scoping by environment as well would need a combined attribute on the shared provider (see `MASTERPLAN.md` 10.3).
- **"shared deployer holds no Artifact Registry writer role directly".** The shared deployer could not push images unless it gets the permission another way (a custom role or a group). All four shared deployers hold `roles/artifactregistry.writer` today.
- **"cannot read the budgets".** Your login needs `billing.budgets.list` on the billing account. The check isn't counted as drift.

Monitoring (uptime checks, SLOs, alerts, dashboard) and the domain mapping are Phase 7. `check.sh` will verify them once they exist.
