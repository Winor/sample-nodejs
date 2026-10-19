const assert = require('node:assert/strict');
const fs = require('node:fs');

// This only records the build job's outputs. It never rebuilds, pushes, or deploys.
function promotionValues(env) {
  const { REPOSITORY, IMAGE, DIGEST, TAG, SOURCE_SHA, RUN_URL } = env;
  assert.match(REPOSITORY || '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'Invalid repository');
  assert.equal(IMAGE, `ghcr.io/${REPOSITORY.toLowerCase()}`, 'Unexpected image repository');
  assert.match(DIGEST || '', /^sha256:[a-f0-9]{64}$/, 'A published sha256 digest is required');
  assert.match(SOURCE_SHA || '', /^[a-f0-9]{40}$/, 'Invalid source commit');
  assert.match(TAG || '', /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-ci\.sha[a-f0-9]{40}$/, 'Invalid CI image tag');
  assert.ok(TAG.endsWith(`-ci.sha${SOURCE_SHA}`), 'Image tag must match the validated commit');
  const prefix = `https://github.com/${REPOSITORY}/actions/runs/`;
  assert.ok((RUN_URL || '').startsWith(prefix), 'Unexpected pipeline URL');
  assert.match(RUN_URL.slice(prefix.length), /^[0-9]+$/, 'Invalid pipeline run');

  return {
    image: { repository: IMAGE, tag: TAG, digest: DIGEST },
    promotion: { sourceCommit: SOURCE_SHA, pipelineRun: RUN_URL },
  };
}

if (require.main === module) {
  const values = promotionValues(process.env);
  fs.writeFileSync('gitops/image.json', `${JSON.stringify(values, null, 2)}\n`);
  console.log(`Prepared GitOps image ${values.image.repository}@${values.image.digest}`);
}

module.exports = { promotionValues };