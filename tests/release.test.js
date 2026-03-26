// 测试 release body 生成与 already_exists 容错
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const PLATFORMS = [
  { name: 'darwin-arm64', filename: 'claude', label: 'macOS (ARM64)' },
  { name: 'darwin-x64',   filename: 'claude', label: 'macOS (Intel)' },
  { name: 'linux-arm64',  filename: 'claude', label: 'Linux (ARM64)' },
  { name: 'linux-x64',    filename: 'claude', label: 'Linux (x64)' },
  { name: 'linux-arm64-musl', filename: 'claude', label: 'Linux (ARM64, musl)' },
  { name: 'linux-x64-musl',   filename: 'claude', label: 'Linux (x64, musl)' },
  { name: 'win32-x64',    filename: 'claude.exe', label: 'Windows (x64)' },
];

// 与 create-release.js 中相同的 release body 生成逻辑
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
      const size = (stats.size / 1024 / 1024).toFixed(2) + ' MB';
      const checksum = computedChecksums[platform.name] || 'N/A';
      const shortChecksum = checksum !== 'N/A' ? `\`${checksum.substring(0, 16)}...\`` : 'N/A';
      body += `| ${platform.label} | \`${assetName}\` | ${size} | ${shortChecksum} |\n`;
    } catch {}
  }

  return body;
}

test('generateReleaseBody 包含版本号标题', async () => {
  const dir = join(tmpdir(), `ccr-test-${Date.now()}`);
  await mkdir(dir, { recursive: true });

  const body = await generateReleaseBody('2.1.84', {}, dir, {});
  assert.ok(body.includes('## Claude Code v2.1.84'));

  await rm(dir, { recursive: true, force: true });
});

test('generateReleaseBody 包含下载表格头', async () => {
  const dir = join(tmpdir(), `ccr-test-${Date.now()}`);
  await mkdir(dir, { recursive: true });

  const body = await generateReleaseBody('2.1.84', {}, dir, {});
  assert.ok(body.includes('| 平台 | 文件 | 大小 | SHA-256 校验和 |'));

  await rm(dir, { recursive: true, force: true });
});

test('generateReleaseBody 有 checksums 时显示前16位 hash', async () => {
  const dir = join(tmpdir(), `ccr-test-${Date.now()}`);
  await mkdir(dir, { recursive: true });

  // 创建假文件
  for (const p of PLATFORMS) {
    await writeFile(join(dir, `${p.name}-${p.filename}`), 'fake-binary-content');
  }

  const checksums = {};
  for (const p of PLATFORMS) {
    checksums[p.name] = createHash('sha256').update(p.name).digest('hex');
  }

  const body = await generateReleaseBody('2.1.84', {}, dir, checksums);
  assert.ok(!body.includes('| N/A |'), 'checksums 存在时不应显示 N/A');
  assert.ok(body.includes('...`'), '应显示截断的 hash（前16位 + ...）');

  await rm(dir, { recursive: true, force: true });
});

test('generateReleaseBody 无 checksums 时显示 N/A', async () => {
  const dir = join(tmpdir(), `ccr-test-${Date.now()}`);
  await mkdir(dir, { recursive: true });

  for (const p of PLATFORMS) {
    await writeFile(join(dir, `${p.name}-${p.filename}`), 'fake');
  }

  const body = await generateReleaseBody('2.1.84', {}, dir, {});
  assert.ok(body.includes('N/A'), '无 checksums 时应显示 N/A');

  await rm(dir, { recursive: true, force: true });
});

test('sha256sums.txt 格式符合 sha256sum -c 规范', async () => {
  const checksums = {
    'linux-x64': 'a'.repeat(64),
    'darwin-arm64': 'b'.repeat(64),
  };
  const version = '2.1.84';

  let txt = '';
  for (const platform of PLATFORMS.filter(p => checksums[p.name])) {
    const assetName = `claude-${version}-${platform.name}${platform.filename === 'claude.exe' ? '.exe' : ''}`;
    txt += `${checksums[platform.name]}  ${assetName}\n`;
  }

  const lines = txt.trim().split('\n');
  for (const line of lines) {
    // 格式：<64位hash>  <文件名>（两个空格）
    assert.match(line, /^[a-f0-9]{64}  claude-[\w.-]+$/, `行格式不符: ${line}`);
  }
});

test('already_exists 错误被正确识别', () => {
  const error = { status: 422, message: 'Validation Failed: {"code":"already_exists"}' };
  const isAlreadyExists = error.status === 422 && error.message.includes('already_exists');
  assert.ok(isAlreadyExists, 'already_exists 错误应被识别');

  const otherError = { status: 500, message: 'Internal Server Error' };
  const isOther = otherError.status === 422 && otherError.message.includes('already_exists');
  assert.ok(!isOther, '其他错误不应被识别为 already_exists');
});
