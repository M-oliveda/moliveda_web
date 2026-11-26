# Secret rotation

Every runtime secret is a GitHub Environment secret written into the Cloud Run manifest at deploy time (D13, D28). Changing a secret in GitHub does nothing until the next deploy of that environment. Set values with `gh secret set NAME --env ENV`, which prompts for the value, and never print or paste them anywhere else.

## Origin secret (production, D34)

The app accepts `ORIGIN_VERIFY_SECRET` and, while rotating, `ORIGIN_VERIFY_SECRET_PREVIOUS`, so rotating causes no downtime:

1. In the `production` environment, set `ORIGIN_VERIFY_SECRET_PREVIOUS` to the **current** value and `ORIGIN_VERIFY_SECRET` to a new one (`openssl rand -hex 32`).
2. Deploy production (a patch release). Both values are now accepted, and the candidate smoke test uses the new one.
3. Update the Cloudflare Transform Rule that sets `X-Origin-Verify` to the new value (Phase 7, `MASTERPLAN.md` 10.6 step 7).
4. Delete `ORIGIN_VERIFY_SECRET_PREVIOUS` and deploy again.

## Gate credentials (development, preview, staging)

1. Set new `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD`. All three gated environments share one login, so update `develop`, `preview` and `staging` together (the loop in `first-deploy.md`).
2. Redeploy. For `develop` and `staging`, re-run the last deploy workflow run, or push. Previews pick them up on their next push.

The old credentials stop working when the new revision takes traffic. Share the new ones only with the people who review that environment.

## If a secret leaked

Rotate it first, as above, then check where it went. Secrets are injected at deploy time and are visible to anyone with view access to the Cloud Run service (`README.md`, "Known gaps"), so review that project's IAM members too.
