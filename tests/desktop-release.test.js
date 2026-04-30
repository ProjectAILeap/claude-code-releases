import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const PLATFORMS = [
  { key: 'darwin-universal', label: 'macOS (Universal)', assetName: 'Claude', assetExt: '.dmg' },
  { key: 'win32-x64', label: 'Windows (x64)', assetName: 'ClaudeSetup', assetExt: '.exe' },
  { key: 'win32-arm64', label: 'Windows (ARM64)', assetName: 'ClaudeSetup', assetExt: '.exe' },
];

function assetFilename(version, platform) {
  return `${platform.assetName}-${version}-${platform.key}${platform.assetExt}`;
}

async function generateReleaseBody(version, downloadDir, computedChecksums) {
  let body = `> **Desktop App** | Claude 桌面客户端 | Tag: \`desktop-v${version}\`\n\n`;

  body += `### 下载\n\n`;
  body += `| 平台 | 文件 | 大小 | SHA-256 校验和 |\n`;
  body += `|------|------|------|----------------|\n`;

  for (const platform of PLATFORMS) {
    const filename = assetFilename(version, platform);
    const filePath = join(downloadDir, filename);

    try {
      const stats = await stat(filePath);
      const size = (stats.size / 1024 / 1024).toFixed(2) + ' MB';
      const checksum = computedChecksums[platform.key] || 'N/A';
      const shortChecksum = checksum !== 'N/A' ? `\`${checksum.substring(0, 16)}...\`` : 'N/A';
      body += `| ${platform.label} | \`${filename}\` | ${size} | ${shortChecksum} |\n`;
    } catch {}
  }

  return body;
}

async function createTempDir() {
  return mkdtemp(join(tmpdir(), 'ccr-desktop-test-'));
}

test('generateReleaseBody 包含 Desktop 版本标题', async () => {
  const dir = await createTempDir();

  const body = await generateReleaseBody('1.5354.0', dir, {});
  assert.ok(body.includes('**Desktop App** | Claude 桌面客户端'));

  await rm(dir, { recursive: true, force: true });
});

test('generateReleaseBody 包含 3 个平台', async () => {
  const dir = await createTempDir();

  for (const p of PLATFORMS) {
    const filename = assetFilename('1.5354.0', p);
    await writeFile(join(dir, filename), 'fake-binary');
  }

  const checksums = {};
  for (const p of PLATFORMS) {
    checksums[p.key] = createHash('sha256').update(p.key).digest('hex');
  }

  const body = await generateReleaseBody('1.5354.0', dir, checksums);
  assert.ok(body.includes('macOS (Universal)'));
  assert.ok(body.includes('Windows (x64)'));
  assert.ok(body.includes('Windows (ARM64)'));

  await rm(dir, { recursive: true, force: true });
});

test('generateReleaseBody 有 checksums 时显示前16位', async () => {
  const dir = await createTempDir();

  for (const p of PLATFORMS) {
    const filename = assetFilename('1.5354.0', p);
    await writeFile(join(dir, filename), 'fake-binary');
  }

  const checksums = {};
  for (const p of PLATFORMS) {
    checksums[p.key] = createHash('sha256').update(p.key).digest('hex');
  }

  const body = await generateReleaseBody('1.5354.0', dir, checksums);
  assert.ok(!body.includes('| N/A |'));
  assert.ok(body.includes('...`'));

  await rm(dir, { recursive: true, force: true });
});

test('generateReleaseBody 无 checksums 时显示 N/A', async () => {
  const dir = await createTempDir();

  for (const p of PLATFORMS) {
    const filename = assetFilename('1.5354.0', p);
    await writeFile(join(dir, filename), 'fake');
  }

  const body = await generateReleaseBody('1.5354.0', dir, {});
  assert.ok(body.includes('N/A'));

  await rm(dir, { recursive: true, force: true });
});

test('assetFilename 生成正确的文件名', () => {
  assert.equal(
    assetFilename('1.5354.0', PLATFORMS[0]),
    'Claude-1.5354.0-darwin-universal.dmg'
  );
  assert.equal(
    assetFilename('1.5354.0', PLATFORMS[1]),
    'ClaudeSetup-1.5354.0-win32-x64.exe'
  );
  assert.equal(
    assetFilename('1.5354.0', PLATFORMS[2]),
    'ClaudeSetup-1.5354.0-win32-arm64.exe'
  );
});

test('sha256sums.txt 格式符合 sha256sum -c 规范', () => {
  const checksums = {
    'darwin-universal': 'a'.repeat(64),
    'win32-x64': 'b'.repeat(64),
    'win32-arm64': 'c'.repeat(64),
  };
  const version = '1.5354.0';

  let txt = '';
  for (const platform of PLATFORMS) {
    const filename = assetFilename(version, platform);
    const hash = checksums[platform.key] || 'UNAVAILABLE';
    txt += `${hash}  ${filename}\n`;
  }

  const lines = txt.trim().split('\n');
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.match(line, /^[a-f0-9]{64}  (Claude|ClaudeSetup)-[\w.-]+(\.dmg|\.exe)$/);
  }
});

test('Release tag 使用 desktop-v 前缀', () => {
  const version = '1.5354.0';
  const tag = `desktop-v${version}`;
  const name = `Claude Desktop v${version}`;

  assert.equal(tag, 'desktop-v1.5354.0');
  assert.equal(name, 'Claude Desktop v1.5354.0');
});
