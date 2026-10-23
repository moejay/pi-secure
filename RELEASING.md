# Releasing

## Current state

The npm workflow is deliberately disabled by default. No npm credential belongs in this repo, GitHub secrets, chat, or an agent tool argument.

- Package: `@moejay/pi-secure`
- Repository: `moejay/pi-secure`
- Workflow: `publish.yml`
- GitHub environment: `npm`

## First release (human checkpoint)

1. Confirm ownership of the npm `moejay` scope and enable 2FA.
2. Run `npm ci --ignore-scripts && npm run check` and inspect `npm pack --dry-run --ignore-scripts`. Smoke-test the dialogs and native clipboard on your platform.
3. Bootstrap the package if npm requires it before trusted publisher configuration: use interactive `npm login` and `npm publish --access public` locally with 2FA. Do not give the agent a token or OTP. This first manual upload may not have provenance.
4. In npm package settings, configure GitHub Actions trusted publishing: owner `moejay`, repo `pi-secure`, workflow filename `publish.yml`, environment `npm`. Allow direct `npm publish` (staged-only permissions will not work with this workflow).
5. In GitHub, protect the `npm` environment with a required human reviewer; restrict its deployment branch to `main`. Protect main and release tags with rulesets. Require CI and review for workflow/code changes.
6. Set package publishing access to **Require two-factor authentication and disallow tokens**. Revoke obsolete publishing tokens. Do not add an npm token to Actions.
7. Set repository Actions variable `NPM_PUBLISH_ENABLED=true` only once the above is complete. Newly configured npm trust must be used within its documented expiry window (currently 2 days). If you bootstrapped 0.1.0, use a new version for the first OIDC release—npm versions cannot be overwritten.

## Subsequent releases

1. Update version and lockfile in a reviewed commit; merge into main after CI.
2. Create and push the matching `vX.Y.Z` tag at the reviewed main commit.
3. Run **Publish npm** from main, supplying the existing tag.
4. Approve the `npm` environment deployment after reviewing the tag.
5. Verify npm version, tarball files, and provenance before creating a GitHub release.

The workflow uses GitHub-hosted Node 24 (npm >=11.5.1 required), SHA-pinned Actions, read-only repository permissions, no dependency caching, no install lifecycle scripts, exact tag/version checks, and OIDC only. Publish permission is scoped to the protected job. It is manual, not triggered by PRs, tags, or GitHub releases.

Reference: https://docs.npmjs.com/trusted-publishers/
