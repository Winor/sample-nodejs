const assert = require('node:assert/strict');
const fs = require('node:fs');

// Only promote a newly accepted release matching this run's validated image.
// This records outputs; it never rebuilds, pushes, creates a release, or deploys.
function promotionValues(env) {
  const {
    REPOSITORY, IMAGE, DIGEST, TAG, SOURCE_SHA, RUN_URL,
    RELEASE_CREATED, RELEASE_SHA, RELEASE_VERSION, RELEASE_TAG,
  } = env;
  assert.equal(RELEASE_CREATED, 'true', 'A newly created release is required for promotion');
  assert.match(REPOSITORY || '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'Invalid repository');
  assert.equal(IMAGE, `ghcr.io/${REPOSITORY.toLowerCase()}`, 'Unexpected image repository');
  assert.match(DIGEST || '', /^sha256:[a-f0-9]{64}$/, 'A published sha256 digest is required');
  assert.match(SOURCE_SHA || '', /^[a-f0-9]{40}$/, 'Invalid source commit');
  assert.match(TAG || '', /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-ci\.sha[a-f0-9]{40}$/, 'Invalid CI image tag');
  assert.ok(TAG.endsWith(`-ci.sha${SOURCE_SHA}`), 'Image tag must match the validated commit');
  assert.equal(RELEASE_SHA, SOURCE_SHA, 'Release commit must match the scanned image commit');
  assert.equal(RELEASE_VERSION, TAG.split('-ci.sha')[0], 'Release version must match the image version');
  assert.equal(RELEASE_TAG, `v${RELEASE_VERSION}`, 'Release tag must match the image version');
  const prefix = `https://github.com/${REPOSITORY}/actions/runs/`;
  assert.ok((RUN_URL || '').startsWith(prefix), 'Unexpected pipeline URL');
  assert.match(RUN_URL.slice(prefix.length), /^[0-9]+$/, 'Invalid pipeline run');

  return {
    image: { repository: IMAGE, tag: TAG, digest: DIGEST },
    promotion: { sourceCommit: SOURCE_SHA, pipelineRun: RUN_URL, releaseTag: RELEASE_TAG },
  };
}

if (require.main === module) {
  const values = promotionValues(process.env);
  fs.writeFileSync('gitops/image.json', `${JSON.stringify(values, null, 2)}\n`);
  console.log(`Prepared GitOps image ${values.image.repository}@${values.image.digest}`);
}

module.exports = { promotionValues };