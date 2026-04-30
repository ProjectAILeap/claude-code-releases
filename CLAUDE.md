# CLAUDE.md — claude-code-releases

## 项目概述

自动归档 Claude Code 官方二进制文件和 Claude Desktop App 安装包的 GitHub Actions 工作流。
每 4 小时检查最新版本，下载所有平台二进制，计算 SHA-256，发布到 GitHub Releases。

## 架构

项目包含两条独立 pipeline：

### CLI Pipeline（`scripts/`）
```
check-version.js → download-installers.js → verify-checksums.js → create-release.js
```
- 版本源：GCS `latest` 频道
- 平台：8 个（macOS/Linux/Windows × 多架构）
- Release tag：`v{version}`（如 `v2.1.84`）

### Desktop App Pipeline（`scripts/desktop/`）
```
check-version.js → download-installers.js → verify-checksums.js → create-release.js
```
- 版本源：`claude.ai/api/desktop` JSON API（需 `User-Agent: Claude/0.0.0`）
- 平台：3 个（macOS Universal、Windows x64、Windows ARM64）
- Release tag：`desktop-v{version}`（如 `desktop-v1.5354.0`）
- 下载 CDN：`downloads.claude.ai`（Google Cloud Storage 托管，无需认证）

两条 pipeline 通过 GitHub Actions artifact 在 job 间传递文件。
`verify-checksums.js` 写入 `checksums.json`，`create-release.js` 读取它生成 Release。

## 关键文件

| 文件 | 职责 |
|------|------|
| `scripts/check-version.js` | 从 GCS `latest` 频道获取 CLI 最新版本号 |
| `scripts/download-installers.js` | 下载 CLI 所有平台二进制 + manifest.json |
| `scripts/verify-checksums.js` | 计算 CLI 二进制 SHA-256 |
| `scripts/create-release.js` | 创建 CLI Release，上传二进制和 `sha256sums.txt` |
| `scripts/desktop/check-version.js` | 通过 API 获取 Desktop App 最新版本号 |
| `scripts/desktop/download-installers.js` | 下载 Desktop App 3 个平台安装包 |
| `scripts/desktop/verify-checksums.js` | 计算 Desktop App SHA-256 |
| `scripts/desktop/create-release.js` | 创建 Desktop App Release |
| `.github/workflows/archive-versions.yml` | CLI pipeline（每 4 小时触发） |
| `.github/workflows/archive-desktop.yml` | Desktop App pipeline（每 4 小时触发） |
| `.github/workflows/keepalive.yml` | 每月 1 日 push 一次，防止 GitHub 挂起计划任务 |

## 注意事项

- CLI 版本来源使用 GCS `latest` 频道（非 `stable`，两者版本号可能不同）
- Desktop App 版本检测必须携带 `User-Agent: Claude/0.0.0`，否则被 Cloudflare 拦截
- Desktop App 无 Linux 版本（API 明确拒绝）
- 并发触发时 create-release 自动处理 `already_exists` 冲突，不会报错退出
- GitHub 会在仓库长期无 push 活动后自动挂起 scheduled workflow，keepalive.yml 每月提交一次规避此问题

## 常用命令

```bash
# 运行测试
npm test

# --- CLI ---

# 手动触发 CLI 归档（最新版本）
gh workflow run archive-versions.yml --repo ProjectAILeap/claude-code-releases

# 手动触发 CLI 归档（指定版本）
gh workflow run archive-versions.yml \
  --repo ProjectAILeap/claude-code-releases \
  --field version=2.1.77

# --- Desktop App ---

# 手动触发 Desktop App 归档（最新版本）
gh workflow run archive-desktop.yml --repo ProjectAILeap/claude-code-releases

# 手动触发 Desktop App 归档（指定版本）
gh workflow run archive-desktop.yml \
  --repo ProjectAILeap/claude-code-releases \
  --field version=1.5354.0

# 查看运行状态
gh run list --repo ProjectAILeap/claude-code-releases --limit 5
```
