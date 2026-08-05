#!/usr/bin/env node

import { Octokit } from '@octokit/rest';
import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));

const OFFICIAL_REPO = 'anthropics/claude-code';
const OFFICIAL_CHANGELOG_URL = 'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md';

export const PLATFORMS = [
  { name: 'darwin-arm64', filename: 'claude', label: 'macOS (ARM64)' },
  { name: 'darwin-x64', filename: 'claude', label: 'macOS (Intel)' },
  { name: 'linux-arm64', filename: 'claude', label: 'Linux (ARM64)' },
  { name: 'linux-x64', filename: 'claude', label: 'Linux (x64)' },
  { name: 'linux-arm64-musl', filename: 'claude', label: 'Linux (ARM64, musl)' },
  { name: 'linux-x64-musl', filename: 'claude', label: 'Linux (x64, musl)' },
  { name: 'win32-x64', filename: 'claude.exe', label: 'Windows (x64)' },
  { name: 'win32-arm64', filename: 'claude.exe', label: 'Windows (ARM64)' },
];

function formatBytes(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

// 从官方 CHANGELOG.md 提取指定版本段落（`## {version}` 到下一个 `## ` 之间，保留 `###` 子标题）
export function extractChangelogSection(text, version) {
  const lines = text.split('\n');
  const heading = `## ${version}`;
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return null;

  const section = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    // 下一个同级别 `## ` 标题即本段结束（`###` 子标题不属于此条件）
    if (/^##\s/.test(line)) break;
    section.push(line);
  }
  const content = section.join('\n').trim();
  return content || null;
}

// 拉取官方更新内容：优先官方 GitHub Release body，回退到 CHANGELOG.md 对应段落
export async function fetchOfficialChangelog(version, token) {
  const releaseUrl = `https://api.github.com/repos/${OFFICIAL_REPO}/releases/tags/v${version}`;
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;

  // 官方 Release 可能晚于 GCS latest 发布，稍作等待后重试
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(releaseUrl, { headers });
      if (response.ok) {
        const data = await response.json();
        if (data.body && data.body.trim()) {
          return {
            content: data.body.trim(),
            sourceUrl: `https://github.com/${OFFICIAL_REPO}/releases/tag/v${version}`,
          };
        }
      }
    } catch { /* 网络抖动，重试 */ }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(OFFICIAL_CHANGELOG_URL);
      if (response.ok) {
        const content = extractChangelogSection(await response.text(), version);
        if (content) {
          return {
            content,
            sourceUrl: `https://github.com/${OFFICIAL_REPO}/blob/main/CHANGELOG.md`,
          };
        }
      }
    } catch { /* 网络抖动，重试 */ }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return null;
}

// Release body 只保留官方更新内容（下载表/安装方法在 README 中，不再重复）
export function generateReleaseBody(version, changelog) {
  const releaseUrl = `https://github.com/${OFFICIAL_REPO}/releases/tag/v${version}`;
  const sourceUrl = changelog?.sourceUrl || releaseUrl;

  let body = `> **CLI** | Claude Code v${version} 更新内容\n`;
  body += `> 来源：[anthropics/claude-code](${sourceUrl})\n\n`;

  if (changelog?.content) {
    body += changelog.content.trim() + '\n';
  } else {
    body += `官方更新日志暂未发布，可稍后重新触发本工作流自动补齐。\n`;
  }

  return body;
}

async function createRelease(octokit, owner, repo, version, body) {
  console.log(chalk.blue(`\n📝 Creating release v${version}...`));

  try {
    const response = await octokit.rest.repos.createRelease({
      owner,
      repo,
      tag_name: `v${version}`,
      name: `[CLI] Claude Code v${version}`,
      body,
      draft: false,
      prerelease: false,
    });

    console.log(chalk.green(`✅ Release created: ${response.data.html_url}`));
    return response.data;
  } catch (error) {
    // 并发触发时可能已被其他 run 创建，直接获取已有 release 并更新 body
    if (error.status === 422 && error.message.includes('already_exists')) {
      console.log(chalk.yellow(`⚠️  Release v${version} already exists, updating release body...`));
      const existing = await octokit.rest.repos.getReleaseByTag({ owner, repo, tag: `v${version}` });
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
    // 已存在的 asset 视为成功（跳过），不阻断流程
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

  console.log(chalk.bold(`\n🚀 Creating GitHub Release for Claude Code v${version}...\n`));
  console.log(chalk.gray(`   Repository: ${owner}/${repo}\n`));

  const downloadDir = join(__dirname, '..', 'downloads', version);
  const manifestPath = join(downloadDir, 'manifest.json');

  // 校验 downloads 目录完整性（manifest.json 由 download 步骤生成，随后作为 asset 上传）
  try {
    await readFile(manifestPath, 'utf-8');
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

  // 拉取官方更新内容并写入 Release body
  console.log(chalk.blue(`\n📝 Fetching official changelog for v${version}...`));
  const changelog = await fetchOfficialChangelog(version, token);
  if (changelog) {
    console.log(chalk.green(`✅ Official changelog found (${changelog.content.length} chars)`));
  } else {
    console.log(chalk.yellow(`⚠️  Official changelog not available yet, writing placeholder note`));
  }

  const octokit = new Octokit({ auth: token });
  const body = generateReleaseBody(version, changelog);
  const release = await createRelease(octokit, owner, repo, version, body);

  console.log(chalk.bold(`\n📦 Uploading assets...\n`));

  const uploads = [];
  for (const platform of PLATFORMS) {
    const filePath = join(downloadDir, `${platform.name}-${platform.filename}`);
    const assetName = `claude-${version}-${platform.name}${platform.filename === 'claude.exe' ? '.exe' : ''}`;

    try {
      const result = await uploadAsset(octokit, owner, repo, release.id, filePath, assetName);
      uploads.push({ platform: platform.name, success: true, status: result.status });
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

    // 如果 sha256sums.txt 已存在，先删除再上传（确保包含最新平台列表）
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

  // Summary
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

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(error => {
    console.error(chalk.red(`\n❌ Fatal error: ${error.message}`));
    process.exit(1);
  });
}
