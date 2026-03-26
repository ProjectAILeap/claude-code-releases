# Claude Code Releases

自动归档 Claude Code 官方二进制文件，供无法直接访问官方源的用户下载使用。

每小时自动检测新版本，发现更新后自动下载、校验并发布到 GitHub Releases。

## 功能特性

- 自动追踪 Claude Code 官方最新版本（每小时检查）
- 支持全平台：macOS (ARM64/Intel)、Linux (x64/ARM64/musl)、Windows (x64/ARM64)
- 计算并发布每个二进制文件的 SHA-256 校验和
- 提供 `sha256sums.txt` 供一键校验文件完整性

## 下载

前往 [Releases](../../releases) 页面，选择对应版本和平台下载。

文件命名规则：

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

## 安装方法

### 推荐：官方安装器

如果能访问官方源，优先使用官方安装器：

```bash
curl -fsSL https://claude.ai/install.sh | bash -s -- <版本号>
```

### 备用：手动安装

**macOS / Linux：**

```bash
# 下载对应平台的二进制文件后
chmod +x claude-<版本>-<平台>
./claude-<版本>-<平台> install
```

**Windows（PowerShell）：**

```powershell
.\claude-<版本>-win32-x64.exe install
```

## 验证文件完整性

每个 Release 包含 `sha256sums.txt`，可用于校验下载文件是否完整：

**Linux / macOS：**

```bash
sha256sum -c sha256sums.txt
```

**Windows（PowerShell）：**

```powershell
Get-FileHash claude-<版本>-win32-x64.exe -Algorithm SHA256
```

将输出的 Hash 值与 Release 说明或 `sha256sums.txt` 中的值对比即可。

## 工作原理

```
每小时触发
    │
    ▼
check-version.js     检查 GCS 官方源是否有新版本
    │ 有新版本
    ▼
download-installers.js   下载所有平台二进制 + manifest.json
    │
    ▼
verify-checksums.js   计算 SHA-256，保存到 checksums.json
    │
    ▼
create-release.js    创建 GitHub Release，上传二进制和 sha256sums.txt
```

## 数据来源

二进制文件直接从 Anthropic 官方 GCS 存储桶下载，未经任何修改。

## 免责声明

本仓库仅作镜像备份用途，与 Anthropic 官方无关。Claude Code 版权归 Anthropic 所有。

## License

MIT
