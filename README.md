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

The [GitHub Actions workflow](.github/workflows/ci-cd.yml) implements **only the
build and Dockerize stage**. SemVer release automation, SAST/dependency checks,
image vulnerability scanning, and Argo CD deployment are clearly marked
placeholders; their successful status does not mean those checks were performed.

Use short-lived branches and pull requests into `main`. Pull requests build and
smoke-test the image without publishing it. Pushes to `main` (and manual runs on
`main`) publish the tested image to `ghcr.io/<owner>/<repository>`. Manual runs on
other branches only validate the build. There are no environment branches or
direct Kubernetes deployments.

### Implemented build stage

- Checks JavaScript syntax with Node.js 22.
- Builds the single-stage Dockerfile using Buildx and GitHub Actions layer cache.
	Production dependencies are installed using `npm ci --omit=dev` and the committed
	lockfile; this application has no compilation step.
- Starts the built Linux/amd64 image as UID/GID 1000 with a read-only filesystem
	and checks `/ready`, `/live`, `/my-app`, and `/metrics`. The existing `npm test`
	script is a failing scaffold, so it is not run; these are smoke tests, not unit tests.
- Publishes the exact tested local image only from `main`, using the built-in
	`GITHUB_TOKEN` with job-scoped `packages: write` permission. PRs never log in.
- Exposes image repository, tag, and published digest as job outputs for the future
	GitOps handoff. A build summary records the result.

The workflow's actions are pinned to commit hashes. The Docker build context is
allowlisted in [.dockerignore](.dockerignore), excluding Git history, local
dependencies, credentials, and unrelated files. Add explicit allowlist entries
if the app later gains other runtime files.

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

1. Configure a ruleset protecting `main`: require pull requests and the build job
	 status check. Branch protection itself is not configured by this repository.
2. Allow GitHub Actions to publish packages. For an existing GHCR package, grant
	 this repository Actions access. Set package visibility/access as required;
	 private image pulls from Kubernetes will need registry credentials.
3. Replace the security placeholders with real policy-enforcing checks. Images
	 are currently published **without SAST or vulnerability scanning**. Implement
	 the image scan before publication (or use a quarantine registry). Image
	 attestations/SBOM generation are also not implemented in the local load/push path.
4. Implement release version calculation on `main` and immutable release tags.
5. Implement a GitOps change to Helm image values in Git, then let Argo CD reconcile
	 the [chart](chart/README.md). The deployment placeholder makes no changes and
	 needs no cluster credentials. The Helm image defaults are not updated by CI yet.
