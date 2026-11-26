# Cost

What runs and what it costs (`MASTERPLAN.md` 10.1 and 10.6). Each project already has a budget cap, and `infra/gcp/check.sh` verifies a budget covers it.

| Item                 | Setting                                                        | Cost driver                                                                  |
| -------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Development, staging | `min 0`, `max 2`; gate 1 vCPU / 128 MiB + app 1 vCPU / 512 MiB | Billed only while handling requests (scale to zero)                          |
| Previews             | `min 0`, `max 1`, one service per open pull request            | Same. Deleted when the pull request closes, and weekly if older than 14 days |
| Production           | `min 1`, `max 3`, app only, 1 vCPU / 512 MiB                   | **One instance always warm** (from the first release, Phase 7)               |
| Images               | Docker Hub public repositories                                 | Free. `scheduled.yml` prunes old tags                                        |
| Logs                 | Cloud Logging                                                  | Within the free tier at this traffic. The gate doesn't log probes            |
| Edge                 | Cloudflare free plan (Phase 7)                                 | Free                                                                         |

Not used, so not paid for: Secret Manager, Artifact Registry, load balancers.

## Keeping it low

- Close stale pull requests: each open one keeps a preview service. It costs nothing while idle, but it still counts toward the project's service quota.
- If a budget alert fires, list the services in each project (`gcloud run services list --project <id> --region us-central1`) and look for an unexpected `min-instances` or a preview that wasn't deleted.
- Production's `min-instances 1` is a deliberate choice (D23). Changing it means editing `ENVIRONMENT_SETTINGS` in `scripts/deploy/deploy-plan.ts` and the plan.
