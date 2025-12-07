# Cloudflare Worker 部署指南

本指南将帮助你在 5 分钟内部署 OpenClash 规则同步服务。

## 前置要求

- 一个 Cloudflare 账号（免费）
- 浏览器

## 部署步骤

### 1. 注册 Cloudflare 账号

访问 https://dash.cloudflare.com/sign-up 注册账号（如已有账号可跳过）

### 2. 创建 KV 命名空间

1. 登录 Cloudflare Dashboard
2. 左侧菜单选择 **Workers & Pages**
3. 点击 **KV** 标签
4. 点击 **Create a namespace**
5. 命名为 `RULES`，点击 **Add**

### 3. 创建 Worker

1. 在 **Workers & Pages** 页面，点击 **Create application**
2. 选择 **Create Worker**
3. 输入名称（如 `openclash-rules`），点击 **Deploy**
4. 部署完成后，点击 **Edit code**

### 4. 粘贴代码

1. 删除编辑器中的所有代码
2. 打开项目中的 `cloudflare-worker.js` 文件
3. 复制所有内容并粘贴到编辑器
4. 点击右上角 **Save and Deploy**

### 5. 绑定 KV 命名空间

1. 返回 Worker 详情页
2. 点击 **Settings** 标签
3. 找到 **Variables and Secrets** 部分
4. 点击 **Add** → **KV Namespace Binding**
5. Variable name 填写: `RULES`
6. KV namespace 选择刚才创建的 `RULES`
7. 点击 **Save**

### 6. 设置 API Secret

1. 在 **Variables and Secrets** 部分
2. 点击 **Add** → **Environment Variable**
3. Variable name 填写: `API_SECRET`
4. Value 填写一个强密码（如 `your-secret-key-123`）
5. 选择 **Encrypt**
6. 点击 **Save**

### 7. 获取 Worker URL

1. 返回 Worker 详情页
2. 复制 **Preview** 下方的 URL（如 `https://openclash-rules.your-name.workers.dev`）

### 8. 配置插件

1. 打开浏览器插件
2. 点击 **配置**
3. 在 **Cloudflare Worker 配置** 部分：
   - Worker URL: 粘贴刚才复制的 URL
   - API Secret: 填写第 6 步设置的密码
4. 点击 **测试 Cloudflare 连接**
5. 测试成功后，点击 **保存配置**

## 配置 OpenClash/Clash Verge

### OpenClash 配置

1. SSH 登录路由器
2. 编辑配置文件: `vi /etc/openclash/config/config.yaml`
3. 添加以下内容:

```yaml
rule-providers:
  my-direct:
    type: http
    behavior: classical
    url: "https://your-worker.workers.dev/direct.yaml"
    interval: 3600
    path: ./ruleset/my-direct.yaml
  
  my-proxy:
    type: http
    behavior: classical
    url: "https://your-worker.workers.dev/proxy.yaml"
    interval: 3600
    path: ./ruleset/my-proxy.yaml

rules:
  - RULE-SET,my-direct,DIRECT
  - RULE-SET,my-proxy,Proxy
  # ... 其他规则
```

4. 重启 OpenClash

### Clash Verge 配置

1. 打开 Clash Verge
2. 进入 **配置** → **全局扩展配置**
3. 添加以下内容:

```yaml
prepend-rule-providers:
  my-direct:
    type: http
    behavior: classical
    url: "https://your-worker.workers.dev/direct.yaml"
    interval: 3600
    path: ./ruleset/my-direct.yaml
  
  my-proxy:
    type: http
    behavior: classical
    url: "https://your-worker.workers.dev/proxy.yaml"
    interval: 3600
    path: ./ruleset/my-proxy.yaml

prepend-rules:
  - RULE-SET,my-direct,DIRECT
  - RULE-SET,my-proxy,Proxy
```

4. 保存并重启配置

## 使用方法

1. 在任意网页，点击插件图标
2. 选择 **本地存储** 模式
3. 点击 **添加直连** 或 **添加代理**
4. 规则会自动同步到 Cloudflare
5. OpenClash/Clash Verge 会定时自动更新规则

## 验证部署

访问以下 URL 验证部署是否成功:

- `https://your-worker.workers.dev/direct.yaml` - 应该返回 YAML 格式的规则
- `https://your-worker.workers.dev/proxy.yaml` - 应该返回 YAML 格式的规则

## 免费额度

- Workers: 每天 10 万次请求
- KV: 每天 10 万次读取 + 1000 次写入
- 存储: 1 GB

对于个人使用完全足够！

## 故障排查

**连接失败:**
- 检查 Worker URL 是否正确
- 确认 API Secret 是否匹配
- 检查 KV 命名空间是否正确绑定

**规则未更新:**
- 检查 OpenClash/Clash Verge 的 rule-provider URL 是否正确
- 手动刷新 rule-provider
- 查看 Worker 日志（Dashboard → Workers → 你的 Worker → Logs）

## 安全建议

- 定期更换 API Secret
- 不要在公开场合分享 Worker URL 和 API Secret
- 可以在 Worker 中添加 IP 白名单限制
