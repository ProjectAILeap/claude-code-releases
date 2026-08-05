// 测试 release body 生成（官方 changelog 注入）、CHANGELOG 段落提取与 already_exists 容错
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  generateReleaseBody,
  extractChangelogSection,
  PLATFORMS,
} from '../scripts/create-release.js';

const SAMPLE_CHANGELOG = `# Changelog

## 2.1.100

- Fixed a bug
- Improved performance

### Subsection

- Extra item

## 2.1.99

- Older item
`;

test('generateReleaseBody 注入官方 changelog', () => {
  const body = generateReleaseBody('2.1.100', {
    content: "## What's changed\n\n- Fixed a bug\n- Improved performance",
    sourceUrl: 'https://github.com/anthropics/claude-code/releases/tag/v2.1.100',
  });

  assert.ok(body.includes('**CLI** | Claude Code v2.1.100 更新内容'));
  assert.ok(body.includes('https://github.com/anthropics/claude-code/releases/tag/v2.1.100'));
  assert.ok(body.includes('- Fixed a bug'));
  assert.ok(body.includes('- Improved performance'));
});

test('generateReleaseBody 不再包含下载表和安装方法', () => {
  const body = generateReleaseBody('2.1.100', {
    content: '- Fixed a bug',
    sourceUrl: 'https://github.com/anthropics/claude-code/releases/tag/v2.1.100',
  });

  assert.ok(!body.includes('| 平台 | 文件 | 大小 | SHA-256 校验和 |'));
  assert.ok(!body.includes('### 安装方法'));
  assert.ok(!body.includes('构建日期'));
});

test('generateReleaseBody 无 changelog 时给出占位说明', () => {
  const body = generateReleaseBody('2.1.100', null);

  assert.ok(body.includes('**CLI** | Claude Code v2.1.100 更新内容'));
  assert.ok(body.includes('暂未发布'));
});

test('extractChangelogSection 提取对应版本段落并保留子标题', () => {
  const section = extractChangelogSection(SAMPLE_CHANGELOG, '2.1.100');

  assert.ok(section.includes('- Fixed a bug'));
  assert.ok(section.includes('- Improved performance'));
  assert.ok(section.includes('### Subsection'));
  assert.ok(section.includes('- Extra item'));
  assert.ok(!section.includes('2.1.99'), '不应包含下一个版本的内容');
});

test('extractChangelogSection 版本不存在时返回 null', () => {
  assert.equal(extractChangelogSection(SAMPLE_CHANGELOG, '9.9.9'), null);
});

test('sha256sums.txt 格式符合 sha256sum -c 规范', () => {
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
