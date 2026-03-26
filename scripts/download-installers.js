#!/usr/bin/env node

import { createWriteStream } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GCS_BUCKET = 'https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases';

const PLATFORMS = [
  { name: 'darwin-arm64', filename: 'claude' },
  { name: 'darwin-x64', filename: 'claude' },
  { name: 'linux-arm64', filename: 'claude' },
  { name: 'linux-x64', filename: 'claude' },
  { name: 'linux-arm64-musl', filename: 'claude' },
  { name: 'linux-x64-musl', filename: 'claude' },
  { name: 'win32-x64', filename: 'claude.exe' },
];

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchManifest(version) {
  const url = `${GCS_BUCKET}/${version}/manifest.json`;
  console.log(chalk.blue(`📄 Fetching manifest from ${url}`));

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const manifest = await response.json();
    console.log(chalk.green(`✅ Manifest fetched successfully`));
    return manifest;
  } catch (error) {
    console.error(chalk.red(`❌ Error fetching manifest: ${error.message}`));
    throw error;
  }
}

async function downloadFile(url, outputPath, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (attempt > 1) {
        console.log(chalk.yellow(`   Retry ${attempt}/${retries}...`));
        await sleep(RETRY_DELAY * attempt);
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentLength = response.headers.get('content-length');
      const totalSize = contentLength ? parseInt(contentLength, 10) : 0;

      const fileStream = createWriteStream(outputPath);

      let downloaded = 0;
      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        downloaded += value.length;
        fileStream.write(value);

        if (totalSize > 0) {
          const percent = ((downloaded / totalSize) * 100).toFixed(1);
          const mb = (downloaded / 1024 / 1024).toFixed(2);
          const totalMb = (totalSize / 1024 / 1024).toFixed(2);
          process.stdout.write(`\r   Progress: ${percent}% (${mb}/${totalMb} MB)`);
        }
      }

      fileStream.end();
      process.stdout.write('\n');

      return { size: downloaded };
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      console.log(chalk.yellow(`   Attempt ${attempt} failed: ${error.message}`));
    }
  }
}

async function downloadPlatform(version, platform, downloadDir) {
  const url = `${GCS_BUCKET}/${version}/${platform.name}/${platform.filename}`;
  const outputPath = join(downloadDir, `${platform.name}-${platform.filename}`);

  console.log(chalk.blue(`\n📥 Downloading ${platform.name}...`));
  console.log(chalk.gray(`   URL: ${url}`));

  try {
    const result = await downloadFile(url, outputPath);
    console.log(chalk.green(`✅ Downloaded ${platform.name} (${(result.size / 1024 / 1024).toFixed(2)} MB)`));
    return { platform: platform.name, success: true, size: result.size };
  } catch (error) {
    console.error(chalk.red(`❌ Failed to download ${platform.name}: ${error.message}`));
    return { platform: platform.name, success: false, error: error.message };
  }
}

async function main() {
  const version = process.argv[2];

  if (!version) {
    console.error(chalk.red('❌ Usage: node download-installers.js <version>'));
    process.exit(1);
  }

  console.log(chalk.bold(`\n📦 Downloading Claude Code v${version} installers...\n`));

  const downloadDir = join(__dirname, '..', 'downloads', version);
  await mkdir(downloadDir, { recursive: true });
  console.log(chalk.gray(`📁 Download directory: ${downloadDir}\n`));

  let manifest;
  try {
    manifest = await fetchManifest(version);
    const manifestPath = join(downloadDir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(chalk.green(`✅ Manifest saved to ${manifestPath}\n`));
  } catch (error) {
    console.error(chalk.red(`❌ Failed to fetch manifest. Exiting.`));
    process.exit(1);
  }

  const results = [];
  for (const platform of PLATFORMS) {
    const result = await downloadPlatform(version, platform, downloadDir);
    results.push(result);
  }

  console.log(chalk.bold(`\n📋 Download Summary:`));
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(chalk.green(`✅ Successful: ${successful.length}/${PLATFORMS.length}`));
  if (failed.length > 0) {
    console.log(chalk.red(`❌ Failed: ${failed.length}`));
    failed.forEach(f => {
      console.log(chalk.red(`   - ${f.platform}: ${f.error}`));
    });
    process.exit(1);
  }

  const totalSize = successful.reduce((sum, r) => sum + r.size, 0);
  console.log(chalk.blue(`📊 Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`));
  console.log(chalk.green(`\n✨ All downloads completed successfully!`));
}

main().catch(error => {
  console.error(chalk.red(`\n❌ Fatal error: ${error.message}`));
  process.exit(1);
});
