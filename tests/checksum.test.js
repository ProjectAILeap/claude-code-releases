// 测试 SHA-256 计算与 checksums.json 持久化
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 与 verify-checksums.js 中相同的 computeSHA256 实现
function computeSHA256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

test('computeSHA256 对已知内容返回正确 hash', async () => {
  const dir = join(tmpdir(), `ccr-test-${Date.now()}`);
  await mkdir(dir, { recursive: true });

  const content = Buffer.from('hello claude');
  const filePath = join(dir, 'test.bin');
  await writeFile(filePath, content);

  const expected = createHash('sha256').update(content).digest('hex');
  const actual = await computeSHA256(filePath);

  assert.equal(actual, expected);
  await rm(dir, { recursive: true, force: true });
});

test('computeSHA256 对空文件返回确定性 hash', async () => {
  const dir = join(tmpdir(), `ccr-test-${Date.now()}`);
  await mkdir(dir, { recursive: true });

  const filePath = join(dir, 'empty.bin');
  await writeFile(filePath, Buffer.alloc(0));

  const hash = await computeSHA256(filePath);
  // sha256('') 是固定值
  assert.equal(hash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  await rm(dir, { recursive: true, force: true });
});

test('checksums.json 包含所有平台且格式正确', async () => {
  const dir = join(tmpdir(), `ccr-test-${Date.now()}`);
  await mkdir(dir, { recursive: true });

  // 模拟 verify-checksums.js 写入 checksums.json 的逻辑
  const platforms = ['darwin-arm64', 'linux-x64', 'win32-x64'];
  const data = {};
  for (const p of platforms) {
    data[p] = createHash('sha256').update(p).digest('hex');
  }

  const checksumsPath = join(dir, 'checksums.json');
  await writeFile(checksumsPath, JSON.stringify(data, null, 2));

  const loaded = JSON.parse(await readFile(checksumsPath, 'utf-8'));
  assert.equal(Object.keys(loaded).length, 3);
  for (const p of platforms) {
    assert.match(loaded[p], /^[a-f0-9]{64}$/, `${p} hash 应为 64 位十六进制`);
  }

  await rm(dir, { recursive: true, force: true });
});

test('不同内容的文件产生不同 hash', async () => {
  const dir = join(tmpdir(), `ccr-test-${Date.now()}`);
  await mkdir(dir, { recursive: true });

  const file1 = join(dir, 'a.bin');
  const file2 = join(dir, 'b.bin');
  await writeFile(file1, Buffer.from('content-a'));
  await writeFile(file2, Buffer.from('content-b'));

  const hash1 = await computeSHA256(file1);
  const hash2 = await computeSHA256(file2);
  assert.notEqual(hash1, hash2);

  await rm(dir, { recursive: true, force: true });
});
