#!/usr/bin/env node

import { Octokit } from '@octokit/rest';
import { readFile, stat, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PLATFORMS = [
  { name: 'darwin-arm64', filename: 'claude', label: 'macOS (ARM64)' },
  { name: 'darwin-x64', filename: 'claude', label: 'macOS (Intel)' },
  { name: 'linux-arm64', filename: 'claude', label: 'Linux (ARM64)' },
  { name: 'linux-x64', filename: 'claude', label: 'Linux (x64)' },
  { name: 'linux-arm64-musl', filename: 'claude', label: 'Linux (ARM64, musl)' },
  { name: 'linux-x64-musl', filename: 'claude', label: 'Linux (x64, musl)' },
  { name: 'win32-x64', filename: 'claude.exe', label: 'Windows (x64)' },
];

function formatBytes(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

async function generateReleaseBody(version, manifest, downloadDir, computedChecksums) {
  let body = `## Claude Code v${version}\n\n`;

  if (manifest.buildDate || manifest.timestamp) {
    const date = new Date(manifest.buildDate || manifest.timestamp).toISOString().split('T')[0];
    body += `**构建日期：** ${date}\n\n`;
  }

  body += `### 下载\n\n`;
  body += `| 平台 | 文件 | 大小 | SHA-256 校验和 |\n`;
  body += `|------|------|------|----------------|\n`;

  for (const platform of PLATFORMS) {
    const filePath = join(downloadDir, `${platform.name}-${platform.filename}`);
    const assetName = `claude-${version}-${platform.name}${platform.filename === 'claude.exe' ? '.exe' : ''}`;

    try {
      const stats = await stat(filePath);
      const size = formatBytes(stats.size);
      const checksum = computedChecksums[platform.name] || 'N/A';
      const shortChecksum = checksum !== 'N/A' ? `\`${checksum.substring(0, 16)}...\`` : 'N/A';

      body += `| ${platform.label} | \`${assetName}\` | ${size} | ${shortChecksum} |\n`;
    } catch (error) {
      console.log(chalk.yellow(`⚠️  Warning: Could not stat ${platform.name}`));
    }
  }

  body += `\n### 安装方法\n\n`;
  body += `#### ✅ 推荐：使用官方安装器\n\n`;
  body += `\`\`\`bash\n`;
  body += `curl -fsSL https://claude.ai/install.sh | bash -s -- ${version}\n`;
  body += `\`\`\`\n\n`;
  body += `#### 📦 备用：从归档手动安装\n\n`;
  body += `**macOS / Linux：**\n`;
  body += `\`\`\`bash\n`;
  body += `chmod +x claude-${version}-<platform>\n`;
  body += `./claude-${version}-<platform> install\n`;
  body += `\`\`\`\n\n`;
  body += `**Windows：**\n`;
  body += `\`\`\`powershell\n`;
  body += `.\\claude-${version}-win32-x64.exe install\n`;
  body += `\`\`\`\n\n`;
  body += `#### 🔐 校验文件完整性\n\n`;
  body += `下载 \`sha256sums.txt\` 后：\n\n`;
  body += `\`\`\`bash\n`;
  body += `# Linux / macOS\n`;
  body += `sha256sum -c sha256sums.txt\n\n`;
  body += `# Windows (PowerShell)\n`;
  body += `Get-FileHash claude-${version}-win32-x64.exe -Algorithm SHA256\n`;
  body += `\`\`\`\n\n`;
  body += `---\n`;
  body += `*本仓库为 Claude Code v${version} 的永久备份，供无法直接访问官方源的用户使用。最新版本请访问 [claude.ai](https://claude.ai)*\n`;

  return body;
}

async function createRelease(octokit, owner, repo, version, body) {
  console.log(chalk.blue(`\n📝 Creating release v${version}...`));

  try {
    const response = await octokit.rest.repos.createRelease({
      owner,
      repo,
      tag_name: `v${version}`,
      name: `Claude Code v${version}`,
      body,
      draft: false,
      prerelease: false,
    });

    console.log(chalk.green(`✅ Release created: ${response.data.html_url}`));
    return response.data;
  } catch (error) {
    // 并发触发时可能已被其他 run 创建，直接获取已有 release
    if (error.status === 422 && error.message.includes('already_exists')) {
      console.log(chalk.yellow(`⚠️  Release v${version} already exists, fetching existing release...`));
      const existing = await octokit.rest.repos.getReleaseByTag({ owner, repo, tag: `v${version}` });
      console.log(chalk.green(`✅ Using existing release: ${existing.data.html_url}`));
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
    return response.data;
  } catch (error) {
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

  console.log(chalk.bold(`\n🚀 Creating GitHub Release for Claude Code v${version}...\n`));
  console.log(chalk.gray(`   Repository: ${owner}/${repo}\n`));

  const downloadDir = join(__dirname, '..', 'downloads', version);
  const manifestPath = join(downloadDir, 'manifest.json');

  let manifest;
  try {
    const manifestContent = await readFile(manifestPath, 'utf-8');
    manifest = JSON.parse(manifestContent);
  } catch (error) {
    console.error(chalk.red(`❌ Failed to load manifest: ${error.message}`));
    process.exit(1);
  }

  // 读取 verify 步骤写入的 checksums.json
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

  const body = await generateReleaseBody(version, manifest, downloadDir, computedChecksums);
  const release = await createRelease(octokit, owner, repo, version, body);

  console.log(chalk.bold(`\n📦 Uploading assets...\n`));

  const uploads = [];
  for (const platform of PLATFORMS) {
    const filePath = join(downloadDir, `${platform.name}-${platform.filename}`);
    const assetName = `claude-${version}-${platform.name}${platform.filename === 'claude.exe' ? '.exe' : ''}`;

    try {
      await uploadAsset(octokit, owner, repo, release.id, filePath, assetName);
      uploads.push({ platform: platform.name, success: true });
    } catch (error) {
      uploads.push({ platform: platform.name, success: false, error: error.message });
    }
  }

  // 上传 manifest
  try {
    await uploadAsset(octokit, owner, repo, release.id, manifestPath, `manifest-${version}.json`);
    uploads.push({ platform: 'manifest', success: true });
  } catch (error) {
    uploads.push({ platform: 'manifest', success: false, error: error.message });
  }

  // 生成并上传 sha256sums.txt（标准格式，兼容 sha256sum -c）
  if (Object.keys(computedChecksums).length > 0) {
    let txt = '';
    for (const platform of PLATFORMS) {
      const assetName = `claude-${version}-${platform.name}${platform.filename === 'claude.exe' ? '.exe' : ''}`;
      const hash = computedChecksums[platform.name] || 'UNAVAILABLE';
      txt += `${hash}  ${assetName}\n`;
    }
    const sha256FilePath = join(downloadDir, 'sha256sums.txt');
    await writeFile(sha256FilePath, txt);
    try {
      await uploadAsset(octokit, owner, repo, release.id, sha256FilePath, 'sha256sums.txt');
      uploads.push({ platform: 'sha256sums.txt', success: true });
    } catch (error) {
      uploads.push({ platform: 'sha256sums.txt', success: false, error: error.message });
    }
  }

  // Summary
  console.log(chalk.bold(`\n📋 Upload Summary:`));
  const successful = uploads.filter(u => u.success);
  const failed = uploads.filter(u => !u.success);

  console.log(chalk.green(`✅ Successful: ${successful.length}/${uploads.length}`));

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
