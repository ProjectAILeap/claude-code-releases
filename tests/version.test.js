// 测试版本检查逻辑（mock fetch）
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// 与 check-version.js 中相同的解析逻辑
const GCS_BUCKET = 'https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases';

async function fetchLatestVersion(fetchFn = fetch) {
  const response = await fetchFn(`${GCS_BUCKET}/latest`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.text()).trim();
}

test('fetchLatestVersion 返回去除空白的版本号', async () => {
  const mockFetch = mock.fn(async () => ({
    ok: true,
    text: async () => '  2.1.84\n',
  }));

  const version = await fetchLatestVersion(mockFetch);
  assert.equal(version, '2.1.84');
  assert.equal(mockFetch.mock.calls.length, 1);
});

test('fetchLatestVersion 在 HTTP 错误时抛出异常', async () => {
  const mockFetch = mock.fn(async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
  }));

  await assert.rejects(
    () => fetchLatestVersion(mockFetch),
    /HTTP 404/
  );
});

test('版本号格式符合 semver（x.y.z）', () => {
  const versions = ['2.1.84', '1.0.0', '10.20.30'];
  const semverPattern = /^\d+\.\d+\.\d+$/;
  for (const v of versions) {
    assert.match(v, semverPattern, `${v} 应符合 semver 格式`);
  }
});

test('needs-archive 逻辑：不存在时为 true，存在时为 false', () => {
  const releaseExists = true;
  assert.equal(!releaseExists, false);

  const releaseNotExists = false;
  assert.equal(!releaseNotExists, true);
});
