#!/usr/bin/env node

import { Octokit } from '@octokit/rest';
import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_BASE = 'https://claude.ai/api/desktop';
const USER_AGENT = 'Claude/0.0.0';

const PLATFORMS = [
  { os: 'darwin', arch: 'universal', format: 'dmg' },
  { os: 'win32', arch: 'x64', format: 'setup' },
  { os: 'win32', arch: 'arm64', format: 'setup' },
];

async function fetchLatestVersion() {
  const results = [];

  for (const platform of PLATFORMS) {
    const url = `${API_BASE}/${platform.os}/${platform.arch}/${platform.format}/latest`;
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      console.log(chalk.gray(`   ${platform.os}/${platform.arch}: v${data.version}`));
      results.push({ ...platform, version: data.version, downloadUrl: data.url });
    } catch (error) {
      console.error(chalk.red(`❌ Failed to fetch ${platform.os}/${platform.arch}: ${error.message}`));
      process.exit(1);
    }
  }

  const versions = [...new Set(results.map(r => r.version))];
  if (versions.length !== 1) {
    console.error(chalk.red(`❌ Version mismatch across platforms: ${versions.join(', ')}`));
    process.exit(1);
  }

  return { version: versions[0], platforms: results };
}

async function checkReleaseExists(version) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error(chalk.red('❌ GITHUB_TOKEN environment variable not set'));
    process.exit(1);
  }

  const [owner, repo] = (process.env.GITHUB_REPOSITORY || 'owner/repo').split('/');
  const octokit = new Octokit({ auth: token });

  try {
    await octokit.rest.repos.getReleaseByTag({
      owner,
      repo,
      tag: `desktop-v${version}`,
    });
    console.log(chalk.yellow(`⏭️  Version ${version} already archived`));
    return true;
  } catch (error) {
    if (error.status === 404) {
      console.log(chalk.green(`✨ Version ${version} needs archiving`));
      return false;
    }
    console.error(chalk.red(`❌ Error checking release: ${error.message}`));
    process.exit(1);
  }
}

async function main() {
  console.log(chalk.bold('\n🔍 Checking for new Claude Desktop version...\n'));

  const { version, platforms } = await fetchLatestVersion();
  console.log(chalk.blue(`\n📦 Current version: ${version}`));

  const exists = await checkReleaseExists(version);

  // Save download URLs for use by download-installers.js
  const urlsPath = join(__dirname, '..', '..', 'downloads', `desktop-${version}`);
  const { mkdir } = await import('fs/promises');
  await mkdir(urlsPath, { recursive: true });
  await writeFile(
    join(urlsPath, 'version-info.json'),
    JSON.stringify({ version, platforms }, null, 2)
  );

  if (process.env.GITHUB_OUTPUT) {
    const fs = await import('fs');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `needs-archive=${!exists}\n`);
  }

  console.log(chalk.bold(`\n📋 Summary:`));
  console.log(`   Version: ${version}`);
  console.log(`   Needs Archive: ${!exists ? chalk.green('Yes') : chalk.gray('No')}`);

  process.exit(0);
}

main();
