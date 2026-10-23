# Deployment and releases

## What deploys where

| Target | Source | Trigger | Approval |
| --- | --- | --- | --- |
| [Website](https://moejay.github.io/pi-secure/) | Static files in `docs/` | Merge changes to `docs/**` or `pages.yml` into `main`; or manual Pages dispatch | Protected `github-pages` environment |
| [npm package](https://www.npmjs.com/package/@moejay/pi-secure) | Files allowed by `package.json` | Manual `publish.yml` dispatch from `main`, with an existing `vX.Y.Z` tag | Required human reviewer on `npm` environment |
| [GitHub release](https://github.com/moejay/pi-secure/releases) | Existing release tag and notes | Maintainer creates it after verifying npm | Maintainer |

The website has no build step. npm ships source directly. A website-only update needs no version bump or npm release. Changes to the README shipped on npm require a new npm version; existing versions cannot be overwritten.

Version 0.1.0 was bootstrapped manually with 2FA; 0.1.1 verified the GitHub OIDC release path and provenance. Subsequent releases should use CI, not local `npm publish`.

## Prerequisites and protections

- Node.js 22.19+ and npm for local checks; authenticated `gh` and Git write access for PRs/tags.
- `main` requires a PR and passing `check (22)` / `check (24)` checks, including for admins. Force pushes and deletion are disabled. The current solo-maintainer setup requires zero independent PR approvals; the release environment still requires explicit human approval.
- `v*` release tags cannot be updated or deleted. Use a new version/tag to correct a release.
- npm trusted publisher: GitHub owner `moejay`, repository `pi-secure`, workflow filename `publish.yml`, environment `npm`, with direct `npm publish` allowed.
- The `npm` environment permits only the `main` deployment branch, requires reviewer `moejay`, and disables admin bypass. Self-review is permitted for the solo maintainer; an agent must leave this approval to the human.
- Repository Actions variable `NPM_PUBLISH_ENABLED` must be `true`. Disable it to stop future publish jobs. This does not stop an already-running job or revoke credentials.
- npm publishing access should require 2FA and disallow traditional tokens. No npm credential belongs in GitHub secrets, the repo, chat, or agent tool arguments.

CI uses GitHub-hosted Node 24 for publishing, npm >=11.5.1, SHA-pinned Actions, no dependency caching, and disabled install/publish lifecycle scripts. Tests and typechecks run explicitly before publishing. OIDC permission is scoped to the protected publish job. PRs, tag pushes, and GitHub releases do not trigger npm publishing.

## Website: preview and deploy

Start from up-to-date main and use a PR:

```sh
git switch main
git pull --ff-only
git switch -c docs/update-site
# Edit docs/, then preview:
python3 -m http.server 8080 --directory docs
```

Open http://localhost:8080. Check narrow/mobile and desktop layouts, keyboard navigation, links, and security wording. Stop the server with Ctrl+C, then:

```sh
npm ci --ignore-scripts
npm run check
git diff --check
git add docs/
git commit -m "docs: update website"
git push -u origin HEAD
gh pr create --repo moejay/pi-secure --base main --fill
```

Wait for CI, review and merge the PR. The **Pages** workflow uploads `docs/` and deploys it through the `github-pages` environment. Check the [Pages runs](https://github.com/moejay/pi-secure/actions/workflows/pages.yml) and the live site.

To redeploy current main without another commit:

```sh
gh workflow run pages.yml --repo moejay/pi-secure --ref main
```

Keep Pages configured to use **GitHub Actions**, not a branch/Jekyll build. README-only changes do not trigger Pages.

## npm: prepare a release PR

Use a release branch. The example uses a patch increment; choose minor/major deliberately for feature/breaking changes.

```sh
git switch main
git pull --ff-only
git switch -c release/next
npm ci --ignore-scripts
npm version patch --no-git-tag-version --ignore-scripts
# Update documentation/release notes as needed.
npm run check
npm pack --dry-run --ignore-scripts
git diff --check
git add package.json package-lock.json
# Explicitly stage any documentation changes too.
git commit -m "chore: prepare release"
git push -u origin HEAD
gh pr create --repo moejay/pi-secure --base main --fill
```

Inspect the tarball allowlist: only the intended source, package metadata, license, README, security policy, and release guide should ship. Do not include credentials or local configuration. Smoke-test masked entry, cancellation, reveal/hide, and native clipboard copy both masked and visible on a supported platform; automated clipboard tests mock native utilities.

Review the PR and wait for both Node 22/24 CI checks before merging. Do not bypass branch protections.

## npm: tag, dispatch, and approve

After the release PR is merged, use the merged main commit, not the release branch's pre-merge commit:

```sh
git switch main
git pull --ff-only
VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")
git tag -a "v$VERSION" -m "pi-secure $VERSION"
git push origin "v$VERSION"
gh workflow run publish.yml --repo moejay/pi-secure --ref main -f "tag=v$VERSION"
gh run list --repo moejay/pi-secure --workflow publish.yml --limit 5
```

The workflow requires a stable `vX.Y.Z` tag, checks that its commit is an ancestor of main, and checks the package name/version. It checks out the tagged source, runs checks, and publishes through OIDC with provenance.

Open the new run in GitHub. The human maintainer must select **Review deployments → npm → Approve and deploy**, after checking the tag and commit. Do not approve a release merely because a model requests it. No OTP or npm token should be supplied to CI.

## Verify before announcing

Once the run succeeds, npm may take several minutes to expose the package. A temporary 404 is not a reason to republish or reuse the version.

```sh
# VERSION is the version just released, set in the previous step.
npm view "@moejay/pi-secure@$VERSION" version dist --prefer-online --json
```

Check `dist.attestations` for SLSA provenance. Verify the registry signature and provenance in an isolated temporary install, without running lifecycle scripts or installing Pi peers:

```sh
VERIFY_DIR=$(mktemp -d)
printf '{"name":"pi-secure-verification","version":"1.0.0","private":true}\n' > "$VERIFY_DIR/package.json"
npm install --prefix "$VERIFY_DIR" --cache "$VERIFY_DIR/cache" \
  --prefer-online --ignore-scripts --legacy-peer-deps --no-audit --no-fund \
  "@moejay/pi-secure@$VERSION"
npm audit signatures --prefix "$VERIFY_DIR" --cache "$VERIFY_DIR/cache"
# Inspect the installed files and package.json in $VERIFY_DIR/node_modules/@moejay/pi-secure.
```

Expect a verified registry signature and verified attestation. Check that provenance identifies `moejay/pi-secure`, the intended source commit, and the publishing workflow. Inspect the tarball contents and compare its integrity hash with registry metadata. Then create release notes:

```sh
gh release create "v$VERSION" --repo moejay/pi-secure --verify-tag \
  --title "v$VERSION" --notes-file /path/to/reviewed-release-notes.md
```

Do not claim security isolation: pi-secure does not stop a malicious or prompt-injected model from obtaining or leaking secrets. Keep this boundary explicit in release notes when describing security behavior.

## Failure and recovery

- **Skipped job:** confirm dispatch was from `main` and `NPM_PUBLISH_ENABLED=true`.
- **Waiting:** the human reviewer must approve the `npm` environment deployment.
- **OIDC authentication failure:** verify exact, case-sensitive trusted-publisher fields above, direct publish permission, environment name, and repository URL in `package.json`. Do not work around it by adding a token. Newly configured npm trust can expire before its first successful publish; see current npm documentation.
- **Publish step failed:** check npm first. If the version is absent and npm did not accept it, fix the underlying issue and rerun the reviewed workflow with a fresh human approval. If it already exists, verify it instead of republishing.
- **Bad published release:** never move/delete a release tag or overwrite an npm version. Fix forward with a new patch release. For an actual secret exposure, revoke affected credentials first; deleting a release does not erase copies.
- **Bad website deployment:** revert the site change through a PR and let Pages redeploy. This does not affect the npm package.
- **Stop publishing:** set `NPM_PUBLISH_ENABLED=false` and cancel any active publish run separately. Remove npm trust if compromised, revoke affected credentials, and review tags/workflows before re-enabling.

Trusted-publishing reference: https://docs.npmjs.com/trusted-publishers/
