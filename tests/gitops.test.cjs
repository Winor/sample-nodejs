const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { promotionValues } = require('../scripts/promote-image.cjs');

const root = path.resolve(__dirname, '..');
const initial = require('../gitops/image.json');
const validEnv = {
  REPOSITORY: 'Winor/sample-nodejs',
  IMAGE: initial.image.repository,
  DIGEST: initial.image.digest,
  TAG: initial.image.tag,
  SOURCE_SHA: initial.promotion.sourceCommit,
  RUN_URL: initial.promotion.pipelineRun,
};

function helm(...args) {
  const result = spawnSync('helm', ['template', 'sample-nodejs', './chart', ...args], {
    cwd: root, encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return result;
}

test('promotion records the published image and pipeline provenance', () => {
  assert.deepEqual(promotionValues(validEnv), initial);
});

for (const [field, value] of [
  ['REPOSITORY', '../other'],
  ['IMAGE', 'ghcr.io/other/application'],
  ['DIGEST', ''],
  ['DIGEST', 'sha256:not-a-digest'],
  ['SOURCE_SHA', 'main'],
  ['SOURCE_SHA', 'a'.repeat(40)],
  ['TAG', 'latest'],
  ['RUN_URL', 'https://example.com/untrusted'],
  ['RUN_URL', 'https://github.com/Winor/sample-nodejs/actions/runs/123/extra'],
]) {
  test(`promotion rejects invalid ${field}: ${value || '(empty)'}`, () => {
    assert.throws(() => promotionValues({ ...validEnv, [field]: value }));
  });
}

test('promotion CLI only writes the designated deployment values', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-nodejs-promotion-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'gitops'));
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/promote-image.cjs')], {
    cwd: directory, encoding: 'utf8', env: { ...process.env, ...validEnv },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'gitops/image.json'))), initial);
  assert.deepEqual(fs.readdirSync(directory), ['gitops']);
});

test('default Helm installs retain tag-based images', () => {
  const result = helm();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /image: "sample-nodejs:latest"/);
  assert.doesNotMatch(result.stdout, /argocd.argoproj.io\/hook: PostSync/);
});

test('GitOps renders the same immutable image in Deployment and PostSync Job', () => {
  const result = helm('-f', 'gitops/values.yaml', '-f', 'gitops/image.json', '--skip-tests');
  assert.equal(result.status, 0, result.stderr);
  const image = `${initial.image.repository}@${initial.image.digest}`;
  assert.equal(result.stdout.split(`image: "${image}"`).length - 1, 2);
  assert.match(result.stdout, /host: "?nodejs\.bnjmn\.deb"?/);
  assert.match(result.stdout, /name: ghcr-pull/);
  assert.match(result.stdout, /argocd.argoproj.io\/hook: PostSync/);
  assert.doesNotMatch(result.stdout, /image: .*:latest/);
  // Test pods must not match the Service selector and receive application traffic.
  const job = result.stdout.split('kind: Job\n')[1];
  assert.ok(job);
  assert.match(job, /app.kubernetes.io\/name: "sample-nodejs-smoke"/);
});

test('digest overrides a conflicting tag and malformed digests fail rendering', () => {
  const result = helm('--set-string', `image.digest=${initial.image.digest}`, '--set-string', 'image.tag=untrusted');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`sample-nodejs@${initial.image.digest}`));
  assert.ok(!result.stdout.includes('sample-nodejs:untrusted'));
  const invalid = helm('--set-string', 'image.digest=sha256:invalid');
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /image.digest must be/);
});

test('PostSync probe code has valid module syntax', () => {
  const source = fs.readFileSync(path.join(root, 'chart/templates/postsync-check.yaml'), 'utf8');
  const code = source.split('            - |\n')[1].split('          resources:')[0]
    .split('\n').map(line => line.replace(/^              /, '')).join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: code, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('workflow gates promotion and prevents recursive promotion-only push runs', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci-cd.yml'), 'utf8');
  const push = workflow.split('\n  push:\n')[1].split('\n  workflow_dispatch:')[0];
  assert.match(push, /paths-ignore:\s+- gitops\/image\.json/);
  const pr = workflow.split('\n  pull_request:\n')[1].split('\n  push:')[0];
  assert.doesNotMatch(pr, /paths/);
  const promotion = workflow.split('\n  promote:\n')[1].split('\n  release:\n')[0];
  assert.match(promotion, /needs: build/);
  assert.match(promotion, /github.ref == 'refs\/heads\/main' && github.event_name == 'push'/);
  assert.match(promotion, /add-paths: gitops\/image\.json/);
  assert.match(promotion, /git rev-parse HEAD/);
  assert.doesNotMatch(promotion, /continue-on-error|kubectl|argocd app sync/);
});

test('Argo CD follows reviewed main values within a restricted project', () => {
  const application = fs.readFileSync(path.join(root, 'gitops/argocd/application.yaml'), 'utf8');
  const project = fs.readFileSync(path.join(root, 'gitops/argocd/project.yaml'), 'utf8');
  assert.match(application, /targetRevision: main/);
  assert.match(application, /\.\.\/gitops\/values.yaml\s+- \.\.\/gitops\/image.json/);
  assert.match(application, /namespace: sample-nodejs/);
  assert.match(application, /skipTests: true/);
  assert.match(project, /clusterResourceWhitelist: \[\]/);
  assert.match(project, /namespaceResourceWhitelist:/);
  assert.ok(!project.includes("kind: '*'"));
});