# CLAUDE.md — claude-code-releases

## 项目概述

自动归档 Claude Code 官方二进制文件的 GitHub Actions 工作流。
每小时从 Anthropic GCS 存储桶拉取最新版本，下载所有平台二进制，计算 SHA-256，发布到 GitHub Releases。

## 架构

```
check-version.js → download-installers.js → verify-checksums.js → create-release.js
```

四个脚本串联为一条 pipeline，通过 GitHub Actions artifact 在 job 间传递文件。
`verify-checksums.js` 写入 `checksums.json`，`create-release.js` 读取它生成 Release。

## 关键文件

| 文件 | 职责 |
|------|------|
| `scripts/check-version.js` | 从 GCS `latest` 频道获取最新版本号，检查是否已归档 |
| `scripts/download-installers.js` | 下载所有平台二进制 + manifest.json |
| `scripts/verify-checksums.js` | 计算 SHA-256，写入 `checksums.json` |
| `scripts/create-release.js` | 读取 `checksums.json`，创建 Release，上传二进制和 `sha256sums.txt` |
| `.github/workflows/archive-versions.yml` | 完整 CI pipeline 定义 |

## 注意事项

- 版本来源使用 GCS `latest` 频道（非 `stable`，两者版本号可能不同）
- 并发触发时 create-release 自动处理 `already_exists` 冲突，不会报错退出

## 常用命令

```bash
# 运行测试
npm test

# 手动触发归档（最新版本）
gh workflow run archive-versions.yml --repo ProjectAILeap/claude-code-releases

# 手动触发归档（指定版本）
gh workflow run archive-versions.yml \
  --repo ProjectAILeap/claude-code-releases \
  --field version=2.1.77

# 查看运行状态
gh run list --repo ProjectAILeap/claude-code-releases --limit 5
```
