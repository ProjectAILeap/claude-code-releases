# CLAUDE.md — claude-code-releases

## 项目概述

自动归档 Claude Code 官方二进制文件的 GitHub Actions 工作流。
每小时从 Anthropic GCS 存储桶拉取最新版本，下载所有平台二进制，计算 SHA-256，发布到 GitHub Releases。

## 架构

```
check-version.js → download-installers.js → verify-checksums.js → create-release.js
```

四个脚本串联为一条 GitHub Actions pipeline，通过 artifact 传递文件。

## 关键文件

| 文件 | 职责 |
|------|------|
| `scripts/check-version.js` | 从 GCS `latest` 频道获取最新版本号，检查是否已归档 |
| `scripts/download-installers.js` | 下载所有平台二进制 + manifest.json 到 `downloads/<version>/` |
| `scripts/verify-checksums.js` | 计算 SHA-256，写入 `checksums.json`（Bug 修复点） |
| `scripts/create-release.js` | 读取 `checksums.json`，创建 Release，上传二进制和 `sha256sums.txt` |
| `.github/workflows/archive-versions.yml` | 定义完整 CI pipeline |
| `tests/` | Node 内置 test runner 测试，覆盖核心逻辑 |

## 重要决策与 Bug 修复记录

### Bug 1（已修复）：verify-checksums.js 不持久化 hash

原代码计算完 hash 只 `console.log`，未写文件。create-release job 拿不到数据，SHA-256 列显示 N/A。

**修复**：`verify-checksums.js` 末尾写入 `checksums.json`，随 artifact 传给 create-release job。

### Bug 2（已修复）：manifest 字段路径错误

原代码用 `manifest.platforms?.[platform.name]?.sha256`，但 GCS manifest 无 `platforms` 嵌套结构。

**修复**：不依赖 manifest 的 checksum，改用 verify job 自行计算的 `checksums.json`。

### check-version.js exit code 语义

原代码用 `process.exit(1)` 表示"已存在"，与 workflow 的 `continue-on-error` 配合语义混乱。

**修复**：始终 `process.exit(0)`，通过 `GITHUB_OUTPUT` 的 `needs-archive` 字段传递状态。

### create-release.js 并发容错

push 触发与 schedule/手动触发并发时，两个 job 都可能检测到同一版本需要归档。

**修复**：捕获 `already_exists`（HTTP 422），自动改为获取已有 release 继续上传。

### GCS 频道选择

使用 `latest` 频道而非 `stable`（两者版本号可能不同，`latest` 跟踪 npm 发布节奏）。

## 常用命令

```bash
# 运行测试
npm test

# 手动触发归档（当前最新版本）
gh workflow run archive-versions.yml --repo ProjectAILeap/claude-code-releases

# 手动触发归档（指定版本）
gh workflow run archive-versions.yml \
  --repo ProjectAILeap/claude-code-releases \
  --field version=2.1.77

# 查看最新运行状态
gh run list --repo ProjectAILeap/claude-code-releases --limit 5

# 实时监控运行
gh run watch <run-id> --repo ProjectAILeap/claude-code-releases
```

## 数据流

```
GCS /latest          → 版本号（如 2.1.84）
GCS /<ver>/manifest.json → 构建元数据（buildDate 等）
GCS /<ver>/<platform>/claude[.exe] → 二进制文件（7 个平台）

本地 downloads/<version>/
  ├── manifest.json
  ├── checksums.json        ← verify 写入，create-release 读取
  ├── darwin-arm64-claude
  ├── darwin-x64-claude
  ├── linux-arm64-claude
  ├── linux-x64-claude
  ├── linux-arm64-musl-claude
  ├── linux-x64-musl-claude
  ├── win32-x64-claude.exe
  └── sha256sums.txt        ← create-release 生成并上传
```

## 支持平台

| 平台标识 | 说明 |
|----------|------|
| `darwin-arm64` | macOS Apple Silicon |
| `darwin-x64` | macOS Intel |
| `linux-arm64` | Linux ARM64 (glibc) |
| `linux-x64` | Linux x64 (glibc) |
| `linux-arm64-musl` | Linux ARM64 (Alpine/musl) |
| `linux-x64-musl` | Linux x64 (Alpine/musl) |
| `win32-x64` | Windows x64 |

## 测试

使用 Node.js 内置 `node:test`，无需额外依赖。

```bash
npm test
```

测试覆盖：
- SHA-256 计算正确性（含空文件边界情况）
- `checksums.json` 格式与内容
- Release body 生成（有/无 checksums 两种情况）
- `sha256sums.txt` 符合 `sha256sum -c` 规范
- `already_exists` 并发容错逻辑
- 版本号获取与解析（mock fetch）

## 注意事项

- `downloads/` 目录已在 `.gitignore`，不会提交二进制文件
- workflow 需要仓库的 `GITHUB_TOKEN`，已在 `permissions` 中声明 `contents: write`
- 新仓库首次运行需手动触发一次，之后定时任务才会激活
- 代理环境下 git 使用 HTTPS，SSH 不可用（代理服务端过滤原始 TCP）
