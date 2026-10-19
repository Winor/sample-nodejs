# DevOps Sample Node.js App

## Overview

A lightweight Node.js application. It features basic web endpoints, Prometheus metrics integration, and is designed for Kubernetes deployment and CI/CD pipeline demonstrations.

## Features

- Express.js web server
- Prometheus metrics integration
- Readiness and liveness probe endpoints
- Customizable port via environment variable

## Prerequisites

- Node.js (v22.1.0)

## Trunk-based CI/CD

The [GitHub Actions workflow](.github/workflows/ci-cd.yml) validates, publishes and
proposes releases/deployments through Git:

| Stage | Purpose | When |
| --- | --- | --- |
| SAST | Scan application source with njsscan | Every run, in parallel with audit |
| Dependency audit | Block high/critical dependency vulnerabilities | Every run, in parallel with SAST |
| Build | Build, Trivy-scan, smoke-test, and optionally publish the exact tested image | After both source security gates pass |
| Release | Maintain a release PR or publish a merged release | After a successful build on pushes to `main` |
| GitOps promotion | Propose the released image digest in a deployment PR | Only after Release Please creates a matching release |

Trivy runs inside the build job **before registry login or publication**. Argo CD
configuration follows reviewed deployment values on `main`; see the
[GitOps bootstrap and verification runbook](gitops/README.md). This is repository
setup only: no cluster has been bootstrapped and no live deployment is claimed.

Use short-lived branches and pull requests into `main`. Pull requests build and
smoke-test the image without publishing it. Pushes to `main` (and manual runs on
`main`) publish the tested image to `ghcr.io/<owner>/<repository>`. Manual runs on
other branches only validate the build. There are no environment branches or
direct Kubernetes deployments from CI. A promotion-only push changing
[gitops/image.json](gitops/image.json) skips CI to prevent a build/promotion loop;
all pull requests still run the checks.

### Security gates

Both source security checks must pass before the image can be built:

- **SAST (njsscan)** scans [app.js](app.js) for insecure Node.js patterns. Error-level
	findings and scanner failures block the build; warnings remain advisory. Expand
	the scan paths when adding application source files. The action is SHA-pinned,
	but its upstream Dockerfile installs njsscan without a version pin, so the scanner
	and its dependencies are not fully reproducible.
- **Dependency audit (npm)** runs `npm audit --package-lock-only --audit-level=high`
	against the committed lockfile, including development dependencies. High and
	critical vulnerabilities block the build; lower-severity findings are reported.
	No packages are installed and no package lifecycle scripts are executed. Registry
	errors also fail the gate rather than silently skipping the audit.

The built image must then pass **Trivy** before smoke tests and publication:

- The SHA-pinned action runs the explicitly selected Trivy `v0.76.0` scanner against
	the exact image loaded by Buildx, using the local Docker image source only. No
	candidate image is pushed or pulled from the application registry for scanning.
- Both OS packages and application libraries are scanned. **HIGH and CRITICAL**
	findings return exit code `1`, including vulnerabilities with no available fix.
	No `continue-on-error` or failure-suppression command is used.
- Installation failures, vulnerability database errors, image lookup failures and
	timeouts fail the build rather than allowing publication. Registry login and push
	explicitly require successful Trivy and smoke-test outcomes.
- The gate runs for PRs, pushes to `main`, and manual runs. PRs still never publish.
	Findings appear as a table in the action logs; the build summary records the scan
	outcome. The action caches its vulnerability database but does not disable updates.

Findings are available in the job logs. CI does **not** automatically open issues:
failed PR checks provide immediate feedback without duplicate tickets or additional
write permissions. If issue tracking is added later, create or update deduplicated
issues from trusted `main` or scheduled runs only, not from fork PRs. Configure
branch protection to require both security checks as well as the build check.
Helm/manifest validation and GitOps contract tests are not run in CI; they remain
optional local checks described in the GitOps runbook.

These checks do not replace dependency remediation or authorization review.
Scan and audit results reflect advisory data available at scan time; the
workflow currently runs on PRs, pushes to `main`, and manual dispatch, not a schedule.

### Implemented build stage

- Checks JavaScript syntax with Node.js 22 and verifies the package and lockfile
	versions agree. Image versions come directly from the checked-out package.
- Builds the single-stage Dockerfile using Buildx and GitHub Actions layer cache.
	Production dependencies are installed using `npm ci --omit=dev` and the committed
	lockfile; this application has no compilation step. After installation, npm,
	Corepack and Yarn (including their bundled dependencies and command shims) are
	removed from the runtime filesystem. The container starts directly with
	`node app.js`; package managers are build-time tools, not runtime requirements.
- Scans the loaded image with Trivy before any registry login or publication.
- Uses [Docker Compose](compose.smoke.yml) to start the built Linux/amd64 image
	as UID/GID 1000 with a read-only filesystem. A test service waits for the app's
	readiness health check and checks `/ready`, `/live`, `/my-app`, and `/metrics`. The existing `npm test`
	script is a failing scaffold, so it is not run; these are smoke tests, not unit tests.
- Publishes the exact tested local image only from `main`, using the built-in
	`GITHUB_TOKEN` with job-scoped `packages: write` permission. PRs never log in.
- Exposes image repository, version, tag, and published digest as job outputs for
	the GitOps promotion PR. A summary table records Trivy/smoke/publication outcomes,
	including failures, rather than always claiming success.

The workflow's actions are pinned to commit hashes. The Docker build context is
allowlisted in [.dockerignore](.dockerignore), excluding Git history, local
dependencies, credentials, and unrelated files. Add explicit allowlist entries
if the app later gains other runtime files.

### Compose smoke tests

[compose.smoke.yml](compose.smoke.yml) runs both services from the exact image
specified by `IMAGE_REF`; it never pulls or rebuilds it. The app and test service
share an isolated internal network, without publishing host ports. The test
service reuses Node.js from the image, so no separate testing image is required.
Its exit code determines whether CI may continue to publication. Logs are
collected and Compose resources are cleaned up even when the test fails.

To run locally, first build the image with `npm run docker:build`, then set
`IMAGE_REF=sample-nodejs:latest` and run Compose with the same arguments used by
the workflow. Docker Compose v2 is required. Run Compose `down` afterward to
remove the test containers and network.

### Release PRs and package versions

The SHA-pinned [Release Please action](https://github.com/googleapis/release-please-action)
replaces the separate version calculator. Its Node strategy is declared in
[release-please-config.json](release-please-config.json).

1. Merge short-lived feature/fix branches into `main` using Conventional Commits.
2. After source checks, the Trivy image scan, smoke tests, and image publication pass, Release Please
	opens or updates a release PR. It updates [package.json](package.json),
	[package-lock.json](package-lock.json), the release manifest, and a generated changelog.
3. Review the release PR and let the same PR checks validate its proposed version.
4. Merge it when ready. After the merged commit passes the main pipeline, Release
	Please creates the matching `vX.Y.Z` Git tag and GitHub release with release notes.

No version-bump commits are pushed directly to `main`. Regular feature PRs do not
need competing version bumps. Release automation never runs on PR events or manual
dispatch; manually rebuilding `main` still publishes a CI image but does not create
a release PR/tag. The action uses GitHub APIs, so no full-history checkout or custom
version-normalization shell is needed.

Use `fix:` for patches, `feat:` for minor changes, and `feat!:` / a `BREAKING CHANGE:`
footer for major changes. `perf:` is also release-relevant. Use standard Conventional
Commit types rather than the old action's `feature:` / `bugfix:` aliases. Changes
such as `docs:`, `test:` and `chore:` without breaking changes do not normally warrant
a release on their own. No release PR is needed when there are no releasable changes.
Commit/PR-title lint enforcement is not implemented here. For squash merges, preserve
the conventional subject and breaking-change footer in the resulting commit.

#### Bootstrap and credentials

[.release-please-manifest.json](.release-please-manifest.json) tracks the accepted
package version (currently `1.0.1`). It was initialized at `1.0.0` with bootstrap
commit `45b35ff192e78b67e3fc5adfe7bbc9514da1fec5`, so the first release considered
subsequent commits rather than the repository's entire history. No initial tag
needed to be created manually. The bootstrap boundary is ignored after the first
Release Please release and can now be removed. Release Please maintains the
manifest after initialization; do not bump it independently.

Set the repository secret **`RELEASE_PLEASE_TOKEN`** to a fine-grained PAT or GitHub
App installation token with repository Contents, Issues and Pull requests write
access. Prefer a dedicated bot/App identity. An installation token must be minted
and refreshed before use; a static secret containing one expires quickly. Enable
"Allow GitHub Actions to create and approve pull requests" where required by the
repository/organization's Actions policy. Automation opens PRs; it does not approve
them or bypass branch protection.

Without the custom token, the action falls back to `GITHUB_TOKEN` and warns in its
summary. **PRs created/updated with `GITHUB_TOKEN` do not automatically trigger PR
workflows.** Required checks may remain pending: configure the custom token before
relying on unattended release PRs. Do not bypass required checks to merge them.
The release job gets Contents, Issues and Pull requests write permissions. The
promotion job gets Contents and Pull requests write and reuses the custom token
so its PR checks run too. The PR security jobs retain read-only permissions.

#### Image identity

All builds use the checked-out package version, including the proposed version on
release PRs. The OCI version label contains this stable version. Commit-specific
image tags remain:

- Main/manual builds: `1.2.4-ci.sha<full-commit-sha>`
- PR builds: `1.2.4-pr.<number>.sha<full-commit-sha>`

For PRs, the SHA is GitHub's synthetic merge commit. Main images are still published
for ordinary commits, not just releases. Release Please creates Git tags and GitHub
releases; it does not add bare version or `latest` container tags, publish to npm,
or deploy Kubernetes resources. A rerun may overwrite the same commit image tag;
use the published digest for exact image identity.

### GitOps delivery

Argo CD reads this public repository, renders [the chart](chart/README.md) with
[deployment settings](gitops/values.yaml) and [a digest-pinned image](gitops/image.json),
and reconciles only reviewed state on `main`. The GitOps project is restricted to
the application's namespace and resource types. No kubeconfig or cluster-write
credential is stored in GitHub Actions.

Ordinary feature merges build/scan/publish CI images and update the release PR,
but do not propose deployment. After the release PR merges, its main build must
pass Trivy/smoke tests and publication, and Release Please must create the release.
Only then does the promotion job open/update a deployment PR. It fails closed if
the release SHA or version differs from that run's scanned image, and records the
accepted release tag in the deployment provenance.

Merging the deployment PR is a separate approval; it does not rebuild
or re-tag the image. Argo CD then syncs and runs a PostSync service smoke test using
the same application image. The requested ingress host is `nodejs.bnjmn.dev` at
`/my-app`; controller, DNS, TLS, registry pull credentials and Argo CD installation
must be provisioned on the target cluster.

See [gitops/README.md](gitops/README.md) for the same-repository choice, bootstrap,
credentials, rollback and deployment evidence checklist. No cluster was changed
while adding this repository configuration.

Before production use:

1. Configure a ruleset protecting `main`: require pull requests, both security checks,
	 and the build job status check. Branch protection itself is not configured by this repository.
2. Allow GitHub Actions to publish packages. For an existing GHCR package, grant
	 this repository Actions access. Set package visibility/access as required;
	 private image pulls from Kubernetes will need registry credentials.
3. Keep base images, dependencies and scanner versions maintained. Trivy blocks
	high/critical findings, including unfixed ones; resolve findings rather than
	bypassing the gate. Image attestations/SBOM generation are not implemented in
	the local load/push path.
4. Configure Release Please credentials and require CI on its release PRs. Protect
	release tags against changes and keep package/lockfile versions synchronized.
5. Bootstrap Argo CD using the [GitOps runbook](gitops/README.md), configure private
	image pulls, ingress/DNS/TLS, and verify Synced/Healthy state, PostSync success,
	the deployed digest and browser access. These live checks remain outstanding.
