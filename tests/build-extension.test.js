const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');

const repositoryRoot = path.join(__dirname, '..');

async function loadBuilder() {
  return import('../scripts/build-extension.mjs');
}

async function makeTemporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'blocknsfw-build-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('build arguments select targets and zip output', async () => {
  const { parseArgs } = await loadBuilder();

  assert.deepEqual(parseArgs([]), { target: 'all', zip: false });
  assert.deepEqual(parseArgs(['--target', 'chrome', '--zip']), { target: 'chrome', zip: true });
  assert.deepEqual(parseArgs(['--target=firefox']), { target: 'firefox', zip: false });
  assert.throws(() => parseArgs(['--target', 'safari']), /Unsupported target/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/);
});

test('builds clean Chrome and Firefox folders and portable release archives', async (t) => {
  const { runBuild } = await loadBuilder();
  const temporaryDirectory = await makeTemporaryDirectory(t);
  const distDirectory = path.join(temporaryDirectory, 'dist');

  await fs.mkdir(path.join(distDirectory, 'chrome'), { recursive: true });
  await fs.writeFile(path.join(distDirectory, 'chrome', 'content1.js'), 'stale');

  await runBuild({
    distDirectory,
    target: 'all',
    zip: true
  });

  const chromeManifest = JSON.parse(await fs.readFile(path.join(distDirectory, 'chrome', 'manifest.json')));
  const firefoxManifest = JSON.parse(await fs.readFile(path.join(distDirectory, 'firefox', 'manifest.json')));
  const sourceChromeManifest = require('../manifest.json');
  const sourceFirefoxManifest = require('../manifest.firefox.json');

  assert.deepEqual(chromeManifest, sourceChromeManifest);
  assert.deepEqual(firefoxManifest, sourceFirefoxManifest);
  await assert.rejects(fs.access(path.join(distDirectory, 'chrome', 'content1.js')));
  await fs.access(path.join(distDirectory, 'chrome', 'offscreen.js'));
  await assert.rejects(fs.access(path.join(distDirectory, 'firefox', 'offscreen.js')));

  for (const target of ['chrome', 'firefox']) {
    for (const expectedPath of [
      'background.js',
      'content.js',
      'popup.html',
      'options.html',
      'text-model.json',
      'vendor/tfjs/tf.es2017.js',
      'vendor/nsfwjs/nsfwjs.runtime.js',
      'nsfwjs/model.json',
      'nsfwjs/group1-shard1of1.bin'
    ]) {
      await fs.access(path.join(distDirectory, target, ...expectedPath.split('/')));
    }

    const archivePath = path.join(distDirectory, `blocknsfw-${target}.zip`);
    const archive = await JSZip.loadAsync(await fs.readFile(archivePath));
    const entryNames = Object.keys(archive.files);
    assert.ok(entryNames.includes('manifest.json'));
    assert.ok(entryNames.includes('nsfwjs/group1-shard1of1.bin'));
    assert.equal(entryNames.some((entry) => entry.includes('\\')), false);
    assert.equal(entryNames.some((entry) => entry.startsWith(`${target}/`)), false);
  }
});

test('fails when a required AI runtime asset is missing', async (t) => {
  const { buildTarget } = await loadBuilder();
  const temporaryDirectory = await makeTemporaryDirectory(t);
  await fs.writeFile(path.join(temporaryDirectory, 'manifest.json'), '{}');

  await assert.rejects(
    buildTarget('chrome', {
      sourceDirectory: temporaryDirectory,
      distDirectory: path.join(temporaryDirectory, 'dist')
    }),
    /Missing required asset in chrome build: vendor\/tfjs\/tf\.es2017\.js/
  );
});
