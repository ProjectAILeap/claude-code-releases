#!/usr/bin/env node

import { createWriteStream } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_BASE = 'https://claude.ai/api/desktop';
const USER_AGENT = 'Claude/0.0.0';

const PLATFORMS = [
  { os: 'darwin', arch: 'universal', format: 'dmg', label: 'macOS (Universal)', assetName: 'Claude', assetExt: '.dmg' },
  { os: 'win32', arch: 'x64', format: 'setup', label: 'Windows (x64)', assetName: 'ClaudeSetup', assetExt: '.exe' },
  { os: 'win32', arch: 'arm64', format: 'setup', label: 'Windows (ARM64)', assetName: 'ClaudeSetup', assetExt: '.exe' },
];

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

function platformKey(p) {
  return `${p.os}-${p.arch}`;
}

function assetFilename(version, platform) {
  return `${platform.assetName}-${version}-${platformKey(platform)}${platform.assetExt}`;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchDownloadUrl(platform) {
  const url = `${API_BASE}/${platform.os}/${platform.arch}/${platform.format}/latest`;
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  return data.url;
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

async function downloadPlatform(version, platform, downloadDir, cachedUrl) {
  const filename = assetFilename(version, platform);
  const outputPath = join(downloadDir, filename);

  console.log(chalk.blue(`\n📥 Downloading ${platform.label}...`));

  let url = cachedUrl;
  if (!url) {
    try {
      url = await fetchDownloadUrl(platform);
    } catch (error) {
      console.error(chalk.red(`❌ Failed to get download URL for ${platform.label}: ${error.message}`));
      return { platform: platformKey(platform), success: false, error: error.message };
    }
  }

  console.log(chalk.gray(`   URL: ${url}`));

  try {
    const result = await downloadFile(url, outputPath);
    console.log(chalk.green(`✅ Downloaded ${platform.label} (${(result.size / 1024 / 1024).toFixed(2)} MB)`));
    return { platform: platformKey(platform), success: true, size: result.size };
  } catch (error) {
    console.error(chalk.red(`❌ Failed to download ${platform.label}: ${error.message}`));
    return { platform: platformKey(platform), success: false, error: error.message };
  }
}

async function main() {
  const version = process.argv[2];

  if (!version) {
    console.error(chalk.red('❌ Usage: node download-installers.js <version>'));
    process.exit(1);
  }

  console.log(chalk.bold(`\n📦 Downloading Claude Desktop v${version} installers...\n`));

  const downloadDir = join(__dirname, '..', '..', 'downloads', `desktop-${version}`);
  await mkdir(downloadDir, { recursive: true });
  console.log(chalk.gray(`📁 Download directory: ${downloadDir}\n`));

  // Try to load cached URLs from check-version step
  let cachedUrls = {};
  try {
    const infoPath = join(downloadDir, 'version-info.json');
    const info = JSON.parse(await readFile(infoPath, 'utf-8'));
    if (info.version === version && info.platforms) {
      for (const p of info.platforms) {
        cachedUrls[`${p.os}-${p.arch}`] = p.downloadUrl;
      }
      console.log(chalk.green(`✅ Loaded cached download URLs from version-info.json\n`));
    }
  } catch {
    console.log(chalk.gray(`ℹ️  No cached URLs found, will fetch from API\n`));
  }

  const results = [];
  for (const platform of PLATFORMS) {
    const key = platformKey(platform);
    const result = await downloadPlatform(version, platform, downloadDir, cachedUrls[key]);
    results.push(result);
  }

  // Save version-info.json if not already present
  const versionInfoPath = join(downloadDir, 'version-info.json');
  try {
    await readFile(versionInfoPath);
  } catch {
    await writeFile(versionInfoPath, JSON.stringify({ version, timestamp: new Date().toISOString() }, null, 2));
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
