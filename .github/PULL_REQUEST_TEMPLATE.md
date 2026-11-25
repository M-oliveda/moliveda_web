## Summary

<!-- What changed and why, in one or two sentences. -->

## MASTERPLAN task

<!-- The section 12 phase and task(s) this closes, and any decision (D*) or open item (A*) it touches. -->

## Verification

<!-- Each check, where it ran (container or host) and its result. Tick only what was actually run. -->

- [ ] `npm run verify` passes in the container, with 100% coverage; new behavior has tests
- [ ] `docker build --target runner` succeeds and the container answers `/health`
- [ ] `scripts/test-gate.sh` passes (when `docker/` or the `Dockerfile` changed)
- [ ] End-to-end tests pass (when UI, routes or messages changed)
- [ ] UI checked keyboard-only, with reduced motion, in both themes, in all four locales, and at 320, 390, 768, 1024, 1440 and 1920 px
- [ ] `reuse lint` passes (when files were added, moved or relicensed)

## Hygiene

- [ ] No secrets, `.env` content, `console.log` or stray artifacts
- [ ] French copy flagged in `messages/REVIEW.md` (when French text changed)
- [ ] `MASTERPLAN.md` section 12 boxes and the README updated (when status, commands, environment variables or decisions changed)
- [ ] Labelled for the release notes (`feature`, `fix`, `security`, `accessibility`, `docs`, `ci` or `dependencies`)
