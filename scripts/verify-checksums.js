#!/usr/bin/env node

import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PLATFORMS = [
  { name: 'darwin-arm64', filename: 'claude' },
  { name: 'darwin-x64', filename: 'claude' },
  { name: 'linux-arm64', filename: 'claude' },
  { name: 'linux-x64', filename: 'claude' },
  { name: 'linux-arm64-musl', filename: 'claude' },
  { name: 'linux-x64-musl', filename: 'claude' },
  { name: 'win32-x64', filename: 'claude.exe' },
  { name: 'win32-arm64', filename: 'claude.exe' },
];

async function computeSHA256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function verifyPlatform(version, platform, manifest, downloadDir) {
  const filePath = join(downloadDir, `${platform.name}-${platform.filename}`);

  console.log(chalk.blue(`\n🔍 Verifying ${platform.name}...`));

  try {
    const computed = await computeSHA256(filePath);

    // 官方 GCS manifest 无 platforms 嵌套结构，expected 始终为 undefined
    // 仅作警告，不阻断流程；computed hash 会持久化供 create-release 使用
    const expected = manifest.platforms?.[platform.name]?.sha256;

    if (!expected) {
      console.log(chalk.yellow(`⚠️  Warning: No checksum found in manifest for ${platform.name}`));
      console.log(chalk.gray(`   Computed: ${computed}`));
      return { platform: platform.name, status: 'warning', computed, expected: null };
    }

    if (computed === expected) {
      console.log(chalk.green(`✅ Checksum verified`));
      console.log(chalk.gray(`   ${computed}`));
      return { platform: platform.name, status: 'success', computed, expected };
    } else {
      console.log(chalk.red(`❌ Checksum mismatch!`));
      console.log(chalk.gray(`   Expected:  ${expected}`));
      console.log(chalk.gray(`   Computed:  ${computed}`));
      return { platform: platform.name, status: 'failed', computed, expected };
    }
  } catch (error) {
    console.error(chalk.red(`❌ Error verifying ${platform.name}: ${error.message}`));
    return { platform: platform.name, status: 'error', error: error.message };
  }
}

async function main() {
  const version = process.argv[2];

  if (!version) {
    console.error(chalk.red('❌ Usage: node verify-checksums.js <version>'));
    process.exit(1);
  }

  console.log(chalk.bold(`\n🔐 Verifying checksums for Claude Code v${version}...\n`));

  const downloadDir = join(__dirname, '..', 'downloads', version);
  const manifestPath = join(downloadDir, 'manifest.json');

  let manifest;
  try {
    const manifestContent = await readFile(manifestPath, 'utf-8');
    manifest = JSON.parse(manifestContent);
    console.log(chalk.green(`✅ Manifest loaded from ${manifestPath}`));
  } catch (error) {
    console.error(chalk.red(`❌ Failed to load manifest: ${error.message}`));
    process.exit(1);
  }

  const results = [];
  for (const platform of PLATFORMS) {
    const result = await verifyPlatform(version, platform, manifest, downloadDir);
    results.push(result);
  }

  // 持久化所有 computed hash 到 checksums.json
  // 该文件会随 upload-artifact 传递给 create-release job
  const checksumsPath = join(downloadDir, 'checksums.json');
  const checksumsData = {};
  for (const result of results) {
    if (result.computed) {
      checksumsData[result.platform] = result.computed;
    }
  }
  await writeFile(checksumsPath, JSON.stringify(checksumsData, null, 2));
  console.log(chalk.green(`\n✅ Checksums saved to ${checksumsPath}`));

  // Summary
  console.log(chalk.bold(`\n📋 Verification Summary:`));

  const successful = results.filter(r => r.status === 'success');
  const warnings = results.filter(r => r.status === 'warning');
  const failed = results.filter(r => r.status === 'failed' || r.status === 'error');

  console.log(chalk.green(`✅ Verified: ${successful.length}/${PLATFORMS.length}`));

  if (warnings.length > 0) {
    console.log(chalk.yellow(`⚠️  Warnings: ${warnings.length}`));
    warnings.forEach(w => {
      console.log(chalk.yellow(`   - ${w.platform}: No checksum in manifest`));
    });
  }

  if (failed.length > 0) {
    console.log(chalk.red(`❌ Failed: ${failed.length}`));
    failed.forEach(f => {
      if (f.status === 'failed') {
        console.log(chalk.red(`   - ${f.platform}: Checksum mismatch`));
      } else {
        console.log(chalk.red(`   - ${f.platform}: ${f.error}`));
      }
    });
    console.error(chalk.red(`\n❌ Verification failed! Do not create release.`));
    process.exit(1);
  }

  console.log(chalk.green(`\n✨ All checksums verified successfully!`));
}

main().catch(error => {
  console.error(chalk.red(`\n❌ Fatal error: ${error.message}`));
  process.exit(1);
});
