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

The [GitHub Actions workflow](.github/workflows/ci-cd.yml) implements **SAST,
dependency auditing, and the build and Dockerize stage**. SemVer release automation,
image vulnerability scanning, and Argo CD deployment remain clearly marked
placeholders; their successful status does not mean those checks were performed.

Use short-lived branches and pull requests into `main`. Pull requests build and
smoke-test the image without publishing it. Pushes to `main` (and manual runs on
`main`) publish the tested image to `ghcr.io/<owner>/<repository>`. Manual runs on
other branches only validate the build. There are no environment branches or
direct Kubernetes deployments.

### Security gates

Two independent jobs must pass before the image can be built or published:

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

Findings are available in the job logs. CI does **not** automatically open issues:
failed PR checks provide immediate feedback without duplicate tickets or additional
write permissions. If issue tracking is added later, create or update deduplicated
issues from trusted `main` or scheduled runs only, not from fork PRs. Configure
branch protection to require both security checks as well as the build check.

These checks do not replace dependency remediation, authorization review, or image
scanning. Audit results reflect the registry's advisory data at scan time; the
workflow currently runs on PRs, pushes to `main`, and manual dispatch, not a schedule.

### Implemented build stage

- Checks JavaScript syntax with Node.js 22.
- Builds the single-stage Dockerfile using Buildx and GitHub Actions layer cache.
	Production dependencies are installed using `npm ci --omit=dev` and the committed
	lockfile; this application has no compilation step.
- Uses [Docker Compose](compose.smoke.yml) to start the built Linux/amd64 image
	as UID/GID 1000 with a read-only filesystem. A test service waits for the app's
	readiness health check and checks `/ready`, `/live`, `/my-app`, and `/metrics`. The existing `npm test`
	script is a failing scaffold, so it is not run; these are smoke tests, not unit tests.
- Publishes the exact tested local image only from `main`, using the built-in
	`GITHUB_TOKEN` with job-scoped `packages: write` permission. PRs never log in.
- Exposes image repository, tag, and published digest as job outputs for the future
	GitOps handoff. A build summary records the result.

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

### SemVer convention and future stages

The current stable `package.json` version (`X.Y.Z`) is the base for SemVer-valid
**prerelease image tags**, not automatically calculated releases:

- Main/manual builds: `1.0.0-ci.sha<full-commit-sha>`
- PR builds: `1.0.0-pr.<number>.sha<full-commit-sha>`

The full SHA identifies the build; for PRs it is GitHub's synthetic merge commit.
No mutable `latest` tag, bare release tag, Git tag, package version bump, or GitHub
release is created. A rerun may overwrite the same commit tag, so use the published
digest when exact image identity matters. Automatic major/minor/patch selection
and release creation belong to the SemVer placeholder and remain unimplemented.

Before production use:

1. Configure a ruleset protecting `main`: require pull requests, both security checks,
	 and the build job status check. Branch protection itself is not configured by this repository.
2. Allow GitHub Actions to publish packages. For an existing GHCR package, grant
	 this repository Actions access. Set package visibility/access as required;
	 private image pulls from Kubernetes will need registry credentials.
3. Replace the image security placeholder with a real policy-enforcing check. Images
	 pass SAST and dependency auditing but are published **without image vulnerability
	 scanning**. Implement the image scan before publication (or use a quarantine registry). Image
	 attestations/SBOM generation are also not implemented in the local load/push path.
4. Implement release version calculation on `main` and immutable release tags.
5. Implement a GitOps change to Helm image values in Git, then let Argo CD reconcile
	 the [chart](chart/README.md). The deployment placeholder makes no changes and
	 needs no cluster credentials. The Helm image defaults are not updated by CI yet.
