#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const REQUIRED_OUTPUTS = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'options.html',
  'blocklist.json',
  'vendor/tfjs/tf.es2017.js',
  'nsfwjs/group1-shard1of1.bin'
];

async function assertFile(filePath) {
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) {
    throw new Error(`Expected a file: ${filePath}`);
  }
}

async function validateTarget(repositoryRoot, target) {
  const outputDirectory = path.join(repositoryRoot, 'dist', target);
  for (const relativePath of REQUIRED_OUTPUTS) {
    await assertFile(path.join(outputDirectory, ...relativePath.split('/')));
  }

  try {
    await fs.access(path.join(outputDirectory, 'content1.js'));
    throw new Error(`Legacy file should not be shipped: dist/${target}/content1.js`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const zipPath = path.join(repositoryRoot, 'dist', `blocknsfw-${target}.zip`);
  const archive = await JSZip.loadAsync(await fs.readFile(zipPath));
  const entryNames = Object.keys(archive.files);
  for (const relativePath of REQUIRED_OUTPUTS) {
    if (!entryNames.includes(relativePath)) {
      throw new Error(`Missing archive entry in ${path.basename(zipPath)}: ${relativePath}`);
    }
  }
  if (entryNames.some((entry) => entry.includes('\\'))) {
    throw new Error(`Archive contains a non-portable entry path: ${path.basename(zipPath)}`);
  }

  const sourceManifestName = target === 'firefox' ? 'manifest.firefox.json' : 'manifest.json';
  const sourceManifest = JSON.parse(await fs.readFile(path.join(repositoryRoot, sourceManifestName), 'utf8'));
  const folderManifest = JSON.parse(await fs.readFile(path.join(outputDirectory, 'manifest.json'), 'utf8'));
  const archiveManifest = JSON.parse(await archive.file('manifest.json').async('string'));
  if (folderManifest.version !== sourceManifest.version || archiveManifest.version !== sourceManifest.version) {
    throw new Error(`Manifest version mismatch in ${target} build`);
  }
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  await Promise.all(['chrome', 'firefox'].map((target) => validateTarget(repositoryRoot, target)));
  console.log('Build outputs are valid.');
} catch (error) {
  console.error(`Build validation failed: ${error.message}`);
  process.exitCode = 1;
}
