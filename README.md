# OpenClash 规则助手

快速添加网站到 OpenClash 规则的浏览器插件，支持远程同步和云端同步两种模式。

## 功能特性

- 🚀 **远程同步模式**: 直接通过 LuCI API 添加规则到路由器本地文件
- ☁️ **云端同步模式**: 通过 Cloudflare Workers 实现跨设备规则同步
- 🎯 **多种匹配方式**: 支持 DOMAIN、DOMAIN-SUFFIX、DOMAIN-KEYWORD、IP-CIDR、DST-PORT
- 🔍 **智能域名提取**: 自动提取根域名（如 clash.gitbook.io → gitbook.io）
- 🖱️ **右键菜单**: 快速添加规则
- 🔄 **自动刷新**: 添加规则后自动刷新规则集并倒计时刷新页面
- 🤖 **自动配置 UCI**: 一键配置 OpenClash 规则提供者
- 📊 **可视化管理**: 规则列表、搜索、分组显示、导出
- 🎨 **Clash 面板**: 一键打开 Yacd/Zashboard/Dashboard/Razord
- 🌐 **可达性检测**: 自动检测网站连接状态，智能推荐代理

## 安装方法

### 方式 1: Chrome Web Store (推荐)
*即将上架*

### 方式 2: 手动安装

1. 下载或克隆本仓库
2. 打开 Chrome/Edge 扩展管理页面
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
3. 开启"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择 `openclash-helper` 文件夹

### 路由器配置（两种模式都需要）

SSH 登录路由器，安装必要的包：

```bash
opkg update
opkg install luci-mod-rpc luci-compat
/etc/init.d/uhttpd restart
```

### Cloudflare Worker 部署（云端同步模式需要）

云端同步模式使用 Cloudflare Workers 实现规则同步，支持跨设备使用（家里的 OpenClash + 公司的 Clash Verge）。

详细部署步骤请查看: [Cloudflare Worker 部署指南](CLOUDFLARE_SETUP.md)

**快速步骤:**
1. 注册 Cloudflare 账号（免费）
2. 创建 KV 命名空间
3. 部署 Worker 脚本
4. 配置插件和 Clash 客户端

**优势:**
- ✅ 完全免费（每天 10 万次请求）
- ✅ 全球 CDN 加速
- ✅ 支持多设备同步
- ✅ 无需自建服务器

## 使用方法

### 首次配置

1. 点击插件图标 → 配置
2. 选择同步模式：
   - **云端同步（推荐）**: 支持多设备，家里 OpenClash + 公司 Clash Verge
   - **远程同步**: 仅路由器本地文件

#### 云端同步模式配置

1. **配置 Cloudflare Worker**
   - 填写 Worker URL 和 API Secret
   - 点击"测试连接"验证

2. **配置路由器连接**
   - 填写路由器地址、用户名、密码
   - 点击"测试连接"（会自动获取 Secret）
   - 点击"获取代理组"选择规则使用的代理组

3. **自动配置 UCI**
   - 点击"自动配置 UCI"
   - 自动添加规则提供者到 OpenClash
   - 自动重启 OpenClash 并等待上线

4. **配置 Clash Verge（可选）**
   - 复制生成的 Merge 配置
   - 粘贴到 Clash Verge → 配置 → 全局扩展配置

#### 远程同步模式配置

1. **配置路由器连接**
   - 填写路由器地址、用户名、密码
   - 配置规则文件路径
   - 点击"测试连接"（会自动获取 Secret 和端口）

2. **获取代理组**
   - 点击"获取代理组"
   - 选择规则使用的代理组

3. **自动配置 UCI**
   - 点击"自动配置 UCI"
   - 自动添加规则提供者到 OpenClash
   - 自动重启 OpenClash 并等待上线

### 添加规则

**方式 1: 点击插件图标**
1. 自动检测当前网站连接状态
2. 智能显示适合的规则类型：
   - 普通域名：后缀匹配、完整匹配
   - IP 地址：IP-CIDR
   - 非标端口：额外显示端口匹配（DST-PORT）
3. 选择规则类型
4. 点击"添加直连"或"添加代理"
5. 自动刷新规则集，3秒后刷新页面验证效果

**方式 2: 右键菜单**
- 在任意网页右键
- 选择"添加到直连规则"或"添加到代理规则"

### 规则管理

点击"规则管理"按钮，根据模式打开不同页面：

**云端同步模式:**
- 显示 Cloudflare KV 中的规则
- 支持分组查看（全部/代理规则/直连规则）
- 支持刷新、删除、清空、导出
- 删除或清空后自动刷新规则集

**远程同步模式:**
- 显示代码编辑器，直接编辑路由器规则文件
- 支持语法高亮、自动补全
- 保存后立即生效

### 控制面板

点击"控制面板"按钮，根据配置的 UI 类型打开：
- Zashboard（推荐）
- Yacd
- Dashboard
- Razord

## 模式对比

| 特性 | 云端同步 | 远程同步 |
|------|---------|---------|
| 跨设备同步 | ✅ 支持 | ❌ 不支持 |
| 多客户端 | ✅ OpenClash + Clash Verge | ❌ 仅 OpenClash |
| 规则存储 | Cloudflare KV | 路由器本地文件 |
| 配置复杂度 | 中等（需部署 Worker） | 简单 |
| 访问速度 | 全球 CDN | 局域网 |
| 成本 | 免费 | 免费 |
| UCI 配置名称 | Cloud_Proxy / Cloud_Direct | Custom_Proxy / Custom_Direct |

## 规则文件格式

插件使用 classical 格式的 YAML 规则：

```yaml
payload:
  - DOMAIN-SUFFIX,google.com
  - DOMAIN,www.youtube.com
  - DOMAIN-KEYWORD,github
  - IP-CIDR,1.1.1.1/32
  - DST-PORT,8080
```

## 注意事项

- 两种模式都需要路由器安装 `luci-mod-rpc` 和 `luci-compat` 包
- 确保浏览器可以访问路由器地址
- 云端同步需要先部署 Cloudflare Worker
- 自动配置 UCI 会检测已有配置，如果代理组不同会自动更新
- 添加规则后会自动刷新规则集并倒计时刷新页面

## 故障排查

**连接失败:**
- 检查路由器地址是否正确
- 确认已安装 `luci-mod-rpc` 和 `luci-compat` 包
- 检查用户名密码是否正确
- 尝试重启 uhttpd: `/etc/init.d/uhttpd restart`

**获取代理组失败（401 错误）:**
- 在配置页面填写正确的 Secret（外部控制密钥）
- 或者让插件自动从 UCI 获取（点击"测试连接"）

**规则未生效:**
- 检查规则文件路径是否正确
- 确认 OpenClash 已加载该规则提供者
- 查看规则管理页面确认规则已添加
- 尝试手动刷新规则集或重启 OpenClash

**云端同步规则不显示:**
- 检查 Cloudflare Worker 配置是否正确
- 测试 Worker URL 是否可访问
- 检查 API Secret 是否正确

## 技术架构

- Manifest V3 规范
- LuCI JSON-RPC API
- UCI 配置系统
- Cloudflare Workers + KV
- ACE 代码编辑器
- 最小权限原则（仅 activeTab、contextMenus、storage）

## 隐私说明

本扩展不收集任何用户数据，所有配置和规则均存储在本地浏览器或您自己的 Cloudflare 账户中。详见 [隐私政策](PRIVACY.md)。

## 开发

### 构建脚本

```bash
# Git 初始化
./scripts/git-init.sh

# 打包发布
./scripts/build.sh

# 生成图标
./scripts/generate-icon.sh
```

详见 [scripts/README.md](scripts/README.md)

## 更新日志

### v2.0
- ✨ 新增云端同步模式（Cloudflare Workers）
- ✨ 支持跨设备规则同步
- ✨ 自动配置 UCI 规则提供者
- ✨ 自动获取路由器 Secret 和代理组
- ✨ 添加规则后自动刷新规则集
- ✨ 支持 DST-PORT 端口匹配规则
- ✨ 网站可达性自动检测
- ✨ 规则列表分组显示
- 🔧 优化权限配置，移除不必要的权限警告
- 🔧 改进 UI 交互和状态提示
- 🔧 统一配置页面

## 开发计划

- [ ] 上架 Chrome Web Store
- [ ] 支持更多规则类型（GEOIP、PROCESS-NAME 等）
- [ ] 规则导入/导出优化
- [ ] 多语言支持
- [ ] 规则冲突检测
- [ ] 批量操作

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request!
