#!/usr/bin/env node

import { Octokit } from '@octokit/rest';
import chalk from 'chalk';

const GCS_BUCKET = 'https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases';

async function fetchStableVersion() {
  try {
    const response = await fetch(`${GCS_BUCKET}/latest`);
    if (!response.ok) {
      throw new Error(`Failed to fetch latest version: ${response.statusText}`);
    }
    const version = (await response.text()).trim();
    console.log(chalk.blue(`📦 Current  version: ${version}`));
    return version;
  } catch (error) {
    console.error(chalk.red(`❌ Error fetching latest version: ${error.message}`));
    process.exit(1);
  }
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
      tag: `v${version}`,
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
  console.log(chalk.bold('\n🔍 Checking for new Claude Code version...\n'));

  const version = await fetchStableVersion();
  const exists = await checkReleaseExists(version);

  if (process.env.GITHUB_OUTPUT) {
    const fs = await import('fs');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `needs-archive=${!exists}\n`);
  }

  console.log(chalk.bold(`\n📋 Summary:`));
  console.log(`   Version: ${version}`);
  console.log(`   Needs Archive: ${!exists ? chalk.green('Yes') : chalk.gray('No')}`);

  // 始终以 exit 0 退出，通过 GITHUB_OUTPUT 的 needs-archive 字段传递状态
  // 避免 exit 1 触发 continue-on-error 导致语义混乱
  process.exit(0);
}

main();
