# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述
Chrome 扩展（Manifest V3，纯原生 JS，无构建/打包框架），快速将网站添加到 OpenClash 路由规则。支持路由器直连模式和 Cloudflare Workers 云端同步模式，带 WebDAV 备份/同步。

## 开发命令
无 `package.json`、无测试、无 lint、无打包器 —— 全部原生 JS + MV3。
- **加载调试**：Chrome/Edge 扩展页 → 开发者模式 → "加载已解压的扩展程序" → 选本目录；改动后在扩展页点"重新加载"。
- **打包发布**：`./scripts/build.sh` → 生成 `openclash-helper.zip`（排除 `.git`/`scripts`/`*.md`）。
- **生成图标**：`./scripts/generate-icon.sh`（需 ImageMagick）。
- 调试：popup 右键"检查"；Service Worker 日志在扩展页 "Service Worker" 链接。

## 核心架构

### 三个运行上下文（都读写同一份 `chrome.storage.local`）
- **popup.html/js**：主弹窗 UI，加载 `api.js` + `cloudflare-api.js`
- **config-new.html/js**：配置页（options_page），额外加载 `backup.js`
- **background.js**：Service Worker，`importScripts('api.js','cloudflare-api.js','backup.js')`；负责右键菜单、WebDAV 定时/事件同步、规则集刷新
- 其它：`cloud-rules.*`（云端规则管理）、`rules.*`（路由器模式 ACE 编辑器）

### chrome.storage.local 键（唯一配置来源）
| 键 | 内容 |
|----|------|
| `syncMode` | `'cloudflare'`（默认）或 `'remote'` |
| `config` | 路由器 LuCI/OpenClash：`host/port/username/password/secret/proxyFile/directFile` |
| `cloudflareConfig` | `workerUrl` / `apiSecret` |
| `localClientConfig` | 本地 Clash 外部控制：`host/port/secret` |
| `webdavConfig` | WebDAV 目录地址、账号、自动同步开关与间隔 |
| `backupState` | 备份元数据（`lastSyncedAt` 等） |
| `syncTestState` | 各控制器"测试连接"结果：`cloudRouter/cloudExternal/remoteRouter`，各含 `.ready` 与 `.target`，决定刷新哪些规则集 |
| `useBase64` | LuCI 文件读写是否走 Base64（见 Gotchas） |

### 同步模式（syncMode）
- `cloudflare`（默认）：规则存 Cloudflare Worker KV（`CloudflareAPI`）
- `remote`：直接操作路由器 LuCI JSON-RPC（`OpenClashAPI`）

### 规则类型与格式
- `PROXY` → proxy.yaml；`DIRECT` → direct.yaml
- classical YAML payload，每行 `  - MATCH_TYPE,domain`（DOMAIN / DOMAIN-SUFFIX / DOMAIN-KEYWORD / IP-CIDR / DST-PORT）

### 规则集刷新
添加/删除规则后向 Clash 外部控制器 `PUT /providers/rules/<name>` 热重载。provider 名按模式区分：
- cloudflare：`Rule-provider - Cloud_Proxy` / `Cloud_Direct`
- remote：`Rule-provider - Custom_Proxy` / `Custom_Direct`
目标控制器由 `getProviderRefreshTargets()` 依据 `syncTestState` 计算（路由器 + 可选本地 Clash）。

## 关键文件
| 文件 | 用途 |
|------|------|
| `popup.html` / `popup.js` | 主弹窗 UI 及逻辑，宽度 430px |
| `config-new.html` / `config-new.js` | 配置页（路由器/Cloudflare/WebDAV/备份），~1500 行 |
| `cloud-rules.html` / `cloud-rules.js` | 云端规则管理页（查看/删除/搜索） |
| `rules.html` / `rules.js` | 路由器模式规则编辑（ACE：`ace.js`/`mode-yaml.js`/`ext-language_tools.js`） |
| `api.js` | `OpenClashAPI`：路由器 LuCI JSON-RPC（登录取 token → fs/sys） |
| `cloudflare-api.js` | `CloudflareAPI`：`addRule()`/`getAllRules()`/`saveRules()` |
| `backup.js` | `OpenClashBackup` 命名空间：WebDAV 备份/同步、快照、`nowIso()`、定时 alarm |
| `background.js` | Service Worker：右键菜单、WebDAV 自动同步、规则集刷新 |
| `manifest.json` | MV3 清单 |

## 重要函数（行号为近似值，易漂移，改动前用 grep 定位）
### popup.js
- `renderAccessStatus(kind, message, quickProxy)` ~57：渲染可达性状态卡片
- `checkAccessibility(tab)` ~219：检测网站可达性
- `checkClashConnection(domain)` ~287：查 `/connections`，写入 `#clashInfo`
- `addRule(type)` ~322：添加规则；cloudflare 模式下先删对立列表相同条目再 `saveRules()`

### cloud-rules.js
- `getProviderRefreshTargets()` ~307：返回需刷新规则集的控制器列表
- `deleteRule(type, matchType, domain)` ~359：字符串替换删除 YAML 行

### config-new.js
- `updateWebDAVMeta(backupState)` ~283：`lastSyncedAt` 用 `new Date(iso).toLocaleString()` 本地化
- `showClashVergeMerge(workerUrl, proxyGroup)` ~384：生成 Clash Verge Merge 配置
- `waitForOpenClashRestart(host, secret, maxWaitSeconds)` ~966：自动配置 UCI 后等 OpenClash 上线

## Gotchas
1. **跨文件复制的辅助函数**：`parseClashAddress` / `resolveControllerTarget` / `sameControllerTarget` / `getProviderRefreshTargets` / `notifyBackupChanged` 在 `popup.js`、`cloud-rules.js`、`config-new.js`、`rules.js`、`background.js` 各有一份副本（SW 无法共享模块）。**改逻辑要同步改所有副本。**
2. **`notifyBackupChanged(reason)` 是页面侧助手**：向 SW 发 `backup-data-changed` 消息，由 `background.js` 触发 `OpenClashBackup.markLocalChange()` + `autoSyncIfEnabled()`。它**不在** `backup.js` 里。
3. **`saveRules()` 两个类参数顺序相反**：`CloudflareAPI.saveRules(direct, proxy)` vs `OpenClashAPI.saveRules(proxy, direct)`。
4. **LuCI 读写有 Base64/shell 双通道**：`OpenClashAPI` 优先 `fs.readfile/writefile`（Base64），失败降级 `sys.exec`（`cat`/`printf`），结果缓存于 `storage.local.useBase64`。
5. **文件加密**：见全局 CLAUDE.md —— Edit/Write 直接用并忽略 "Write verification failed" 误报；勿用 powershell 读这些文件。

## 参考
- `README.md`：功能、安装、模式对比、故障排查
- `CLOUDFLARE_SETUP.md`：Cloudflare Worker 部署步骤
