#!/usr/bin/env node

import { Octokit } from '@octokit/rest';
import { readFile, stat, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PLATFORMS = [
  { key: 'darwin-universal', label: 'macOS (Universal)', assetName: 'Claude', assetExt: '.dmg' },
  { key: 'win32-x64', label: 'Windows (x64)', assetName: 'ClaudeSetup', assetExt: '.exe' },
  { key: 'win32-arm64', label: 'Windows (ARM64)', assetName: 'ClaudeSetup', assetExt: '.exe' },
];

function formatBytes(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function assetFilename(version, platform) {
  return `${platform.assetName}-${version}-${platform.key}${platform.assetExt}`;
}

async function generateReleaseBody(version, downloadDir, computedChecksums) {
  let body = `## Claude Desktop v${version}\n\n`;

  body += `### 下载\n\n`;
  body += `| 平台 | 文件 | 大小 | SHA-256 校验和 |\n`;
  body += `|------|------|------|----------------|\n`;

  for (const platform of PLATFORMS) {
    const filename = assetFilename(version, platform);
    const filePath = join(downloadDir, filename);

    try {
      const stats = await stat(filePath);
      const size = formatBytes(stats.size);
      const checksum = computedChecksums[platform.key] || 'N/A';
      const shortChecksum = checksum !== 'N/A' ? `\`${checksum.substring(0, 16)}...\`` : 'N/A';

      body += `| ${platform.label} | \`${filename}\` | ${size} | ${shortChecksum} |\n`;
    } catch {
      console.log(chalk.yellow(`⚠️  Warning: Could not stat ${platform.key}`));
    }
  }

  body += `\n### 安装方法\n\n`;
  body += `**macOS：**\n`;
  body += `\`\`\`bash\n`;
  body += `# 下载 DMG 后双击安装，或命令行挂载\n`;
  body += `hdiutil attach Claude-${version}-darwin-universal.dmg\n`;
  body += `cp -R "/Volumes/Claude/Claude.app" /Applications/\n`;
  body += `hdiutil detach "/Volumes/Claude"\n`;
  body += `\`\`\`\n\n`;
  body += `**Windows：**\n`;
  body += `\`\`\`powershell\n`;
  body += `# 下载 EXE 后直接运行安装\n`;
  body += `.\\ClaudeSetup-${version}-win32-x64.exe\n`;
  body += `\`\`\`\n\n`;
  body += `#### 🔐 校验文件完整性\n\n`;
  body += `下载 \`sha256sums.txt\` 后：\n\n`;
  body += `\`\`\`bash\n`;
  body += `# Linux / macOS\n`;
  body += `sha256sum -c sha256sums.txt\n\n`;
  body += `# Windows (PowerShell)\n`;
  body += `Get-FileHash ClaudeSetup-${version}-win32-x64.exe -Algorithm SHA256\n`;
  body += `\`\`\`\n\n`;
  body += `---\n`;
  body += `*本仓库为 Claude Desktop v${version} 的永久备份，供无法直接访问官方源的用户使用。最新版本请访问 [claude.com/download](https://claude.com/download)*\n`;

  return body;
}

async function createRelease(octokit, owner, repo, version, body) {
  console.log(chalk.blue(`\n📝 Creating release desktop-v${version}...`));

  try {
    const response = await octokit.rest.repos.createRelease({
      owner,
      repo,
      tag_name: `desktop-v${version}`,
      name: `Claude Desktop v${version}`,
      body,
      draft: false,
      prerelease: false,
    });

    console.log(chalk.green(`✅ Release created: ${response.data.html_url}`));
    return response.data;
  } catch (error) {
    if (error.status === 422 && error.message.includes('already_exists')) {
      console.log(chalk.yellow(`⚠️  Release desktop-v${version} already exists, updating release body...`));
      const existing = await octokit.rest.repos.getReleaseByTag({ owner, repo, tag: `desktop-v${version}` });
      await octokit.rest.repos.updateRelease({
        owner,
        repo,
        release_id: existing.data.id,
        body,
      });
      console.log(chalk.green(`✅ Updated existing release: ${existing.data.html_url}`));
      return existing.data;
    }
    console.error(chalk.red(`❌ Error creating release: ${error.message}`));
    throw error;
  }
}

async function uploadAsset(octokit, owner, repo, releaseId, filePath, assetName) {
  console.log(chalk.blue(`📤 Uploading ${assetName}...`));

  try {
    const data = await readFile(filePath);

    const response = await octokit.rest.repos.uploadReleaseAsset({
      owner,
      repo,
      release_id: releaseId,
      name: assetName,
      data,
    });

    console.log(chalk.green(`✅ Uploaded ${assetName} (${formatBytes(data.length)})`));
    return { status: 'uploaded', data: response.data };
  } catch (error) {
    if (error.status === 422 && error.message.includes('already_exists')) {
      console.log(chalk.yellow(`⏭️  ${assetName} already exists, skipping`));
      return { status: 'skipped' };
    }
    console.error(chalk.red(`❌ Error uploading ${assetName}: ${error.message}`));
    throw error;
  }
}

async function main() {
  const version = process.argv[2];

  if (!version) {
    console.error(chalk.red('❌ Usage: node create-release.js <version>'));
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error(chalk.red('❌ GITHUB_TOKEN environment variable not set'));
    process.exit(1);
  }

  const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
  if (!owner || !repo) {
    console.error(chalk.red('❌ GITHUB_REPOSITORY environment variable not set'));
    process.exit(1);
  }

  console.log(chalk.bold(`\n🚀 Creating GitHub Release for Claude Desktop v${version}...\n`));
  console.log(chalk.gray(`   Repository: ${owner}/${repo}\n`));

  const downloadDir = join(__dirname, '..', '..', 'downloads', `desktop-${version}`);

  const checksumsPath = join(downloadDir, 'checksums.json');
  let computedChecksums = {};
  try {
    const content = await readFile(checksumsPath, 'utf-8');
    computedChecksums = JSON.parse(content);
    console.log(chalk.green(`✅ Loaded computed checksums (${Object.keys(computedChecksums).length} platforms)`));
  } catch {
    console.log(chalk.yellow(`⚠️  No checksums.json found, SHA-256 will show N/A`));
  }

  const octokit = new Octokit({ auth: token });

  const body = await generateReleaseBody(version, downloadDir, computedChecksums);
  const release = await createRelease(octokit, owner, repo, version, body);

  console.log(chalk.bold(`\n📦 Uploading assets...\n`));

  const uploads = [];
  for (const platform of PLATFORMS) {
    const filename = assetFilename(version, platform);
    const filePath = join(downloadDir, filename);

    try {
      const result = await uploadAsset(octokit, owner, repo, release.id, filePath, filename);
      uploads.push({ platform: platform.key, success: true, status: result.status });
    } catch (error) {
      uploads.push({ platform: platform.key, success: false, error: error.message });
    }
  }

  // Upload version-info.json
  const versionInfoPath = join(downloadDir, 'version-info.json');
  try {
    await uploadAsset(octokit, owner, repo, release.id, versionInfoPath, `version-info-${version}.json`);
    uploads.push({ platform: 'version-info', success: true });
  } catch (error) {
    uploads.push({ platform: 'version-info', success: false, error: error.message });
  }

  // Generate and upload sha256sums.txt
  if (Object.keys(computedChecksums).length > 0) {
    let txt = '';
    for (const platform of PLATFORMS) {
      const filename = assetFilename(version, platform);
      const hash = computedChecksums[platform.key] || 'UNAVAILABLE';
      txt += `${hash}  ${filename}\n`;
    }
    const sha256FilePath = join(downloadDir, 'sha256sums.txt');
    await writeFile(sha256FilePath, txt);

    try {
      const existingAssets = await octokit.rest.repos.listReleaseAssets({
        owner, repo, release_id: release.id, per_page: 100,
      });
      const oldSha = existingAssets.data.find(a => a.name === 'sha256sums.txt');
      if (oldSha) {
        await octokit.rest.repos.deleteReleaseAsset({ owner, repo, asset_id: oldSha.id });
        console.log(chalk.yellow(`🔄 Replaced existing sha256sums.txt`));
      }
    } catch { /* ignore */ }

    try {
      await uploadAsset(octokit, owner, repo, release.id, sha256FilePath, 'sha256sums.txt');
      uploads.push({ platform: 'sha256sums.txt', success: true });
    } catch (error) {
      uploads.push({ platform: 'sha256sums.txt', success: false, error: error.message });
    }
  }

  console.log(chalk.bold(`\n📋 Upload Summary:`));
  const successful = uploads.filter(u => u.success);
  const failed = uploads.filter(u => !u.success);
  const uploaded = successful.filter(u => u.status === 'uploaded');
  const skipped = successful.filter(u => u.status === 'skipped');

  if (uploaded.length > 0) console.log(chalk.green(`✅ Uploaded: ${uploaded.length}`));
  if (skipped.length > 0) console.log(chalk.yellow(`⏭️  Skipped (already exist): ${skipped.length}`));

  if (failed.length > 0) {
    console.log(chalk.red(`❌ Failed: ${failed.length}`));
    failed.forEach(f => {
      console.log(chalk.red(`   - ${f.platform}: ${f.error}`));
    });
    console.error(chalk.red(`\n❌ Some uploads failed!`));
    process.exit(1);
  }

  console.log(chalk.green(`\n✨ Release created successfully!`));
  console.log(chalk.blue(`🔗 ${release.html_url}`));
}

main().catch(error => {
  console.error(chalk.red(`\n❌ Fatal error: ${error.message}`));
  process.exit(1);
});
