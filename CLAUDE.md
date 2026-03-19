# OpenClash 助手 — CLAUDE.md

## 项目概述
Chrome 扩展，快速将网站添加到 OpenClash 路由规则。支持路由器直连模式和 Cloudflare Workers 云端同步模式，带 WebDAV 备份/同步。

## 关键文件

| 文件 | 用途 |
|------|------|
| `popup.html` / `popup.js` | 主弹窗 UI 及逻辑，宽度 430px |
| `config-new.html` / `config-new.js` | 配置页面（路由器/Cloudflare/WebDAV） |
| `cloud-rules.html` / `cloud-rules.js` | 云端规则管理页（查看/删除/搜索） |
| `rules.html` / `rules.js` | 路由器模式规则管理页 |
| `cloudflare-api.js` | `CloudflareAPI` 类：`addRule()` / `getAllRules()` / `saveRules()` |
| `api.js` | `OpenClashAPI` 类：路由器 LuCI API |
| `background.js` | Service Worker：WebDAV 自动同步、右键菜单 |
| `backup.js` | `nowIso()` / `notifyBackupChanged()` / WebDAV 同步逻辑 |
| `manifest.json` | 扩展清单，MV3 |

## 核心架构

### 同步模式（syncMode）
- `cloudflare`（默认）：规则存 Cloudflare Worker KV，`cloudflareConfig.workerUrl/apiSecret`
- `remote`：直接操作路由器 LuCI API，`config.host/port/secret`

### 规则类型
- `PROXY`：代理规则列表（proxy.yaml）
- `DIRECT`：直连规则列表（direct.yaml）
- 规则格式：YAML payload，每行 `  - MATCH_TYPE,domain`

### Clash 外部控制
- `localClientConfig`：本地 Clash，`host/port/secret`
- `config`：路由器 OpenClash，`host/port/secret`
- `parseClashAddress()` / `resolveControllerTarget()` 解析地址

## 重要函数

### popup.js
- `checkAccessibility(tab)` — line ~218：检测网站可达性
- `checkClashConnection(domain)` — line ~286：查询 `/connections` API，结果写入 `#clashInfo`
- `addRule(type)` — line ~322：添加规则，cloudflare 模式下先删除对立列表相同条目
- `renderAccessStatus(type, msg, showHint?)` — line ~60：渲染可达性状态卡片
- `resolveControllerTarget(targetConfig)` — line ~469：解析 host/port/secret

### cloud-rules.js
- `deleteRule(type, matchType, domain)` — line ~328：字符串替换删除 YAML 行
- `getProviderRefreshTargets()` — line ~258：返回需刷新规则集的控制器列表

### config-new.js
- `updateWebDAVMeta(backupState)` — line ~280：`lastSyncedAt` 用 `new Date(iso).toLocaleString()` 本地化

## 近期变更（2025-03）

### 1. Clash 连接信息显示
- `popup.html`：`#accessStatus` 下方新增 `#clashInfo` div
- `popup.js`：新增 `checkClashConnection(domain)`，popup 加载后异步调用，失败静默
- 格式：`规则：RULE,payload · 代理组：节点选择`

### 2. 同步时间本地化
- `config-new.js` line 306：`lastSyncedAt` ISO 字符串改用 `new Date(iso).toLocaleString()` 显示

### 3. 添加规则时自动删除对立规则
- `popup.js addRule()`：cloudflare 模式下添加前先 `getAllRules()` 找对立列表并删除相同行，再 `saveRules()`，失败静默
