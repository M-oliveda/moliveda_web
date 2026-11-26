# Rollback

Every deploy creates a new Cloud Run revision named `moliveda-web[-pr-<n>]-<sha>-<run id>-<attempt>`. Rolling back means sending traffic to an earlier revision. Nothing is rebuilt.

## Production

A production deploy that fails its smoke test never moved traffic, so there's nothing to roll back. Fix the cause and release a patch.

If a release is live and broken:

```bash
gcloud run revisions list --service moliveda-web \
  --project moliveda-gcloudprojects-prod --region us-central1
gcloud run services update-traffic moliveda-web --to-revisions <previous-revision>=100 \
  --project moliveda-gcloudprojects-prod --region us-central1
```

1. Check `https://moliveda.dev` (from Phase 7) and `/ready`.
2. Purge the Cloudflare cache for the affected pages if they served broken content (Phase 7).
3. Ship the fix as a patch release (`MASTERPLAN.md` 10.7). Its deploy pins traffic on the current revision until its own smoke test passes, then routes to latest.

The production deployer can't delete the service (custom role `molivedaWebDeployer`). Deleting it is a manual owner action and isn't part of any rollback.

## Development and staging

The same `update-traffic --to-revisions` command works with `--project moliveda-gcloudprojects-dev` or `-stg`. The next push to `develop` or the release branch routes traffic to its new revision again.

## Preview

Push a fix to the pull request. Previews are disposable: closing the pull request deletes the service.
