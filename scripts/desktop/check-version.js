#!/usr/bin/env node

import { Octokit } from '@octokit/rest';
import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_BASE = 'https://claude.ai/api/desktop';
const USER_AGENT = 'Claude/1.0.0';

const PLATFORMS = [
  { os: 'darwin', arch: 'universal', format: 'dmg' },
  { os: 'win32', arch: 'x64', format: 'setup' },
  { os: 'win32', arch: 'arm64', format: 'setup' },
];

async function fetchPlatformInfo(platform) {
  const jsonUrl = `${API_BASE}/${platform.os}/${platform.arch}/${platform.format}/latest`;

  // Strategy 1: JSON API endpoint
  try {
    const response = await fetch(jsonUrl, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    });
    if (response.ok) {
      const data = await response.json();
      return { version: data.version, downloadUrl: data.url };
    }
  } catch { /* fall through to redirect strategy */ }

  // Strategy 2: redirect endpoint — parse version from Location header
  const redirectUrl = `${jsonUrl}/redirect`;
  const response = await fetch(redirectUrl, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'manual',
  });

  const location = response.headers.get('location');
  if (!location) {
    throw new Error(`No redirect location from ${redirectUrl} (HTTP ${response.status})`);
  }

  // URL pattern: https://downloads.claude.ai/releases/{os}/{arch}/{version}/{filename}
  const match = location.match(/\/releases\/[^/]+\/[^/]+\/([^/]+)\//);
  if (!match) {
    throw new Error(`Cannot parse version from redirect URL: ${location}`);
  }

  return { version: match[1], downloadUrl: location };
}

async function fetchLatestVersion() {
  const results = [];
  const failures = [];

  for (const platform of PLATFORMS) {
    try {
      const info = await fetchPlatformInfo(platform);
      console.log(chalk.gray(`   ${platform.os}/${platform.arch}: v${info.version}`));
      results.push({ ...platform, ...info });
    } catch (error) {
      console.log(chalk.yellow(`⚠️  ${platform.os}/${platform.arch}: ${error.message}`));
      failures.push(platform);
    }
  }

  if (results.length === 0) {
    console.error(chalk.red(`❌ Failed to fetch version from any platform`));
    process.exit(1);
  }

  const versions = [...new Set(results.map(r => r.version))];
  if (versions.length !== 1) {
    console.error(chalk.red(`❌ Version mismatch across platforms: ${versions.join(', ')}`));
    process.exit(1);
  }

  if (failures.length > 0) {
    console.log(chalk.yellow(`⚠️  ${failures.length} platform(s) failed API check, will use redirect at download time`));
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
