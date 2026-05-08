# Claude Code Releases

自动归档 Claude 官方二进制文件，供无法直接访问官方源的用户下载使用。

本仓库归档两类产品：

| 产品 | 说明 | Tag 前缀 | 检查频率 |
|------|------|----------|----------|
| **Claude Code CLI** | 命令行开发工具 | `v` | 每 4 小时 |
| **Claude Desktop App** | 桌面客户端（Electron） | `desktop-v` | 每 4 小时 |

## 最新版本

<!-- LATEST_VERSIONS_START -->
| 产品 | 最新版本 | 发布日期 | 下载 |
|------|---------|----------|------|
| **Claude Code CLI** | `v2.1.133` | 2026-05-08 | [Release](../../releases/tag/v2.1.133) |
| **Claude Desktop App** | `v1.6608.0` | 2026-05-07 | [Release](../../releases/tag/desktop-v1.6608.0) |
<!-- LATEST_VERSIONS_END -->

前往 [Releases](../../releases) 页面查看所有历史版本。按 Tag 前缀区分：`v*` 为 CLI，`desktop-v*` 为 Desktop。

### Claude Code CLI

| 平台 | 文件名 |
|------|--------|
| macOS (ARM64) | `claude-<版本>-darwin-arm64` |
| macOS (Intel) | `claude-<版本>-darwin-x64` |
| Linux (x64) | `claude-<版本>-linux-x64` |
| Linux (ARM64) | `claude-<版本>-linux-arm64` |
| Linux (x64, musl) | `claude-<版本>-linux-x64-musl` |
| Linux (ARM64, musl) | `claude-<版本>-linux-arm64-musl` |
| Windows (x64) | `claude-<版本>-win32-x64.exe` |
| Windows (ARM64) | `claude-<版本>-win32-arm64.exe` |

### Claude Desktop App

| 平台 | 文件名 |
|------|--------|
| macOS (Universal) | `Claude-<版本>-darwin-universal.dmg` |
| Windows (x64) | `ClaudeSetup-<版本>-win32-x64.exe` |
| Windows (ARM64) | `ClaudeSetup-<版本>-win32-arm64.exe` |

> Desktop App 目前无 Linux 版本。

## 安装方法

### Claude Code CLI

**推荐：官方安装器**

```bash
curl -fsSL https://claude.ai/install.sh | bash -s -- <版本号>
```

**备用：手动安装**

```bash
# macOS / Linux
chmod +x claude-<版本>-<平台>
./claude-<版本>-<平台> install

# Windows (PowerShell)
.\claude-<版本>-win32-x64.exe install
```

### Claude Desktop App

**macOS：**

```bash
# 下载 DMG 后双击安装，或命令行挂载
hdiutil attach Claude-<版本>-darwin-universal.dmg
cp -R "/Volumes/Claude/Claude.app" /Applications/
hdiutil detach "/Volumes/Claude"
```

**Windows：**

```powershell
.\ClaudeSetup-<版本>-win32-x64.exe
```

## 验证文件完整性

每个 Release 包含 `sha256sums.txt`，可用于校验下载文件是否完整：

```bash
# Linux / macOS
sha256sum -c sha256sums.txt

# Windows (PowerShell)
Get-FileHash <文件名> -Algorithm SHA256
```

将输出的 Hash 值与 Release 说明或 `sha256sums.txt` 中的值对比即可。

## 工作原理

两条独立 pipeline，每 4 小时各自检查一次：

```
Claude Code CLI                           Claude Desktop App
──────────────                             ──────────────────
check-version.js                           desktop/check-version.js
  │ 查询 GCS latest 频道                      │ 查询 claude.ai/api/desktop
  ▼                                            ▼
download-installers.js                     desktop/download-installers.js
  │ 下载 8 平台二进制                          │ 下载 3 平台安装包
  ▼                                            ▼
verify-checksums.js                        desktop/verify-checksums.js
  │ 计算 SHA-256                               │ 计算 SHA-256
  ▼                                            ▼
create-release.js                          desktop/create-release.js
  │ 发布 Release (tag: v*)                     │ 发布 Release (tag: desktop-v*)
```

## 数据来源

- **CLI**：二进制文件直接从 Anthropic 官方 GCS 存储桶下载，未经任何修改。
- **Desktop App**：安装包通过 `downloads.claude.ai` CDN 下载，未经任何修改。

## 免责声明

本仓库仅作镜像备份用途，与 Anthropic 官方无关。Claude 版权归 Anthropic 所有。

## License

MIT
