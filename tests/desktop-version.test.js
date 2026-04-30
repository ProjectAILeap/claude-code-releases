import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const API_BASE = 'https://claude.ai/api/desktop';
const USER_AGENT = 'Claude/0.0.0';

const PLATFORMS = [
  { os: 'darwin', arch: 'universal', format: 'dmg' },
  { os: 'win32', arch: 'x64', format: 'setup' },
  { os: 'win32', arch: 'arm64', format: 'setup' },
];

function buildApiUrl(platform) {
  return `${API_BASE}/${platform.os}/${platform.arch}/${platform.format}/latest`;
}

async function fetchLatestVersion(fetchFn = fetch) {
  const results = [];

  for (const platform of PLATFORMS) {
    const url = buildApiUrl(platform);
    const response = await fetchFn(url, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    results.push({ ...platform, version: data.version, downloadUrl: data.url });
  }

  const versions = [...new Set(results.map(r => r.version))];
  if (versions.length !== 1) {
    throw new Error(`Version mismatch: ${versions.join(', ')}`);
  }

  return { version: versions[0], platforms: results };
}

test('buildApiUrl 生成正确的 API URL', () => {
  assert.equal(
    buildApiUrl({ os: 'darwin', arch: 'universal', format: 'dmg' }),
    'https://claude.ai/api/desktop/darwin/universal/dmg/latest'
  );
  assert.equal(
    buildApiUrl({ os: 'win32', arch: 'x64', format: 'setup' }),
    'https://claude.ai/api/desktop/win32/x64/setup/latest'
  );
  assert.equal(
    buildApiUrl({ os: 'win32', arch: 'arm64', format: 'setup' }),
    'https://claude.ai/api/desktop/win32/arm64/setup/latest'
  );
});

test('fetchLatestVersion 正确解析 API JSON 响应', async () => {
  const mockFetch = mock.fn(async (url) => ({
    ok: true,
    json: async () => ({
      version: '1.5354.0',
      url: `https://downloads.claude.ai/releases/test/Claude-abc123.dmg`,
    }),
  }));

  const result = await fetchLatestVersion(mockFetch);
  assert.equal(result.version, '1.5354.0');
  assert.equal(result.platforms.length, 3);
  assert.equal(mockFetch.mock.calls.length, 3);
});

test('fetchLatestVersion 在平台版本不一致时抛出异常', async () => {
  let callCount = 0;
  const mockFetch = mock.fn(async () => {
    callCount++;
    return {
      ok: true,
      json: async () => ({
        version: callCount === 1 ? '1.5354.0' : '1.5355.0',
        url: 'https://downloads.claude.ai/releases/test/Claude.dmg',
      }),
    };
  });

  await assert.rejects(
    () => fetchLatestVersion(mockFetch),
    /Version mismatch/
  );
});

test('fetchLatestVersion 在 HTTP 错误时抛出异常', async () => {
  const mockFetch = mock.fn(async () => ({
    ok: false,
    status: 403,
    statusText: 'Forbidden',
  }));

  await assert.rejects(
    () => fetchLatestVersion(mockFetch),
    /HTTP 403/
  );
});

test('Desktop tag 前缀为 desktop-v', () => {
  const version = '1.5354.0';
  const tag = `desktop-v${version}`;
  assert.equal(tag, 'desktop-v1.5354.0');
  assert.ok(tag.startsWith('desktop-v'));
  assert.ok(!tag.startsWith('v1')); // 不与 CLI 的 v 前缀冲突
});

test('Desktop 版本号格式验证', () => {
  const versions = ['1.5354.0', '1.0.0', '2.100.3'];
  const pattern = /^\d+\.\d+\.\d+$/;
  for (const v of versions) {
    assert.match(v, pattern, `${v} 应符合版本号格式`);
  }
});

test('请求 headers 包含正确的 User-Agent', async () => {
  let capturedHeaders = null;
  const mockFetch = mock.fn(async (url, options) => {
    capturedHeaders = options?.headers;
    return {
      ok: true,
      json: async () => ({ version: '1.0.0', url: 'https://example.com/file' }),
    };
  });

  await fetchLatestVersion(mockFetch);
  assert.equal(capturedHeaders?.['User-Agent'], 'Claude/0.0.0');
});
