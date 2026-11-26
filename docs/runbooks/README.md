# Runbooks

Operational steps for `moliveda_web`. Every command that changes cloud resources, GitHub settings or Git history is the owner's to run (`AGENTS.md`, Mandatory Rules 1 and 4).

| Runbook                                    | When                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| [GCP bootstrap](../../infra/gcp/README.md) | Once per project, and `check.sh all` before every release                       |
| [First deploy](first-deploy.md)            | Setting up GitHub, the first preview and development deploys, the gate IP check |
| [Rollback](rollback.md)                    | A deploy is broken                                                              |
| [Secret rotation](secret-rotation.md)      | Rotating the origin secret or the gate credentials                              |
| [Cost](cost.md)                            | What runs, what it costs, and how to keep it low                                |

Later phases add runbooks for contact delivery (Phase 5) and the domain and Cloudflare (Phase 7).
