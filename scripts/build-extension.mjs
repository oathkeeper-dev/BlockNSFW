#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';

const DEFAULT_SOURCE_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const RUNTIME_FOLDERS = [
  'icons',
  'shared',
  'vendor',
  'nsfwjs'
];

const COMMON_RUNTIME_FILES = [
  'background.js',
  'content.js',
  'ai-image-blocker-core.js',
  'ai-image-blocker.js',
  'classify.worker.js',
  'popup.html',
  'popup.js',
  'options.html',
  'options.js',
  'blocked.html',
  'blocked.js',
  'onboarding.html',
  'onboarding.js',
  'audit.html',
  'audit.js',
  'stats.html',
  'stats.js',
  'community.html',
  'community.js',
  'appwrite-client.js',
  'blocklist.json',
  'text-model.json',
  'LICENSE'
];

const TARGETS = {
  chrome: {
    manifest: 'manifest.json',
    runtimeFiles: ['offscreen.html', 'offscreen.js', ...COMMON_RUNTIME_FILES]
  },
  firefox: {
    manifest: 'manifest.firefox.json',
    runtimeFiles: COMMON_RUNTIME_FILES
  }
};

const REQUIRED_ASSETS = [
  'vendor/tfjs/tf.es2017.js',
  'vendor/nsfwjs/nsfwjs.runtime.js',
  'nsfwjs/model.json',
  'nsfwjs/group1-shard1of1.bin',
  'text-model.json'
];

export function parseArgs(argv) {
  let target = 'all';
  let zip = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--zip') {
      zip = true;
      continue;
    }

    if (argument === '--target') {
      if (index + 1 >= argv.length) {
        throw new Error('--target requires chrome, firefox, or all');
      }
      target = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument.startsWith('--target=')) {
      target = argument.slice('--target='.length);
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (![...Object.keys(TARGETS), 'all'].includes(target)) {
    throw new Error(`Unsupported target: ${target}`);
  }

  return { target, zip };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function addDirectoryToZip(zip, rootDirectory, currentDirectory = rootDirectory) {
  const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const absolutePath = path.join(currentDirectory, entry.name);
    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, rootDirectory, absolutePath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const relativePath = path.relative(rootDirectory, absolutePath).split(path.sep).join('/');
    zip.file(relativePath, await fs.readFile(absolutePath));
  }
}

async function createZip(sourceDirectory, zipPath) {
  const zip = new JSZip();
  await addDirectoryToZip(zip, sourceDirectory);
  const contents = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX'
  });

  await fs.rm(zipPath, { force: true });
  await fs.writeFile(zipPath, contents);
}

export async function buildTarget(target, options = {}) {
  const configuration = TARGETS[target];
  if (!configuration) {
    throw new Error(`Unsupported target: ${target}`);
  }

  const sourceDirectory = path.resolve(options.sourceDirectory ?? DEFAULT_SOURCE_DIRECTORY);
  const distDirectory = path.resolve(options.distDirectory ?? path.join(sourceDirectory, 'dist'));
  const outputDirectory = path.join(distDirectory, target);

  console.log(`==> Cleaning ${outputDirectory}`);
  await fs.rm(outputDirectory, { recursive: true, force: true });
  await fs.mkdir(outputDirectory, { recursive: true });

  console.log(`==> Copying ${target} manifest and runtime files`);
  await fs.copyFile(
    path.join(sourceDirectory, configuration.manifest),
    path.join(outputDirectory, 'manifest.json')
  );

  for (const folder of RUNTIME_FOLDERS) {
    const source = path.join(sourceDirectory, folder);
    if (await pathExists(source)) {
      await fs.cp(source, path.join(outputDirectory, folder), { recursive: true });
    }
  }

  for (const file of configuration.runtimeFiles) {
    const source = path.join(sourceDirectory, file);
    if (await pathExists(source)) {
      await fs.copyFile(source, path.join(outputDirectory, file));
    }
  }

  console.log('==> Verifying AI runtime assets');
  for (const asset of REQUIRED_ASSETS) {
    if (!(await pathExists(path.join(outputDirectory, ...asset.split('/'))))) {
      throw new Error(`Missing required asset in ${target} build: ${asset}`);
    }
  }

  let zipPath;
  if (options.zip) {
    zipPath = path.join(distDirectory, `blocknsfw-${target}.zip`);
    console.log(`==> Creating ${zipPath}`);
    await createZip(outputDirectory, zipPath);
  }

  console.log(`==> ${target} build complete: ${outputDirectory}`);
  if (zipPath) {
    console.log(`==> Zip: ${zipPath}`);
  }

  return { outputDirectory, zipPath };
}

export async function runBuild({ target = 'all', zip = false, sourceDirectory, distDirectory } = {}) {
  const targets = target === 'all' ? Object.keys(TARGETS) : [target];
  const results = [];
  for (const currentTarget of targets) {
    results.push(await buildTarget(currentTarget, {
      zip,
      sourceDirectory,
      distDirectory
    }));
  }
  return results;
}

async function main() {
  try {
    await runBuild(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`Build failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
