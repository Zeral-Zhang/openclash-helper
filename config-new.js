const APP_THEME_STORAGE_KEY = 'appTheme';
const appThemeQuery = window.matchMedia('(prefers-color-scheme: light)');

function resolveAppTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  return appThemeQuery.matches ? 'light' : 'dark';
}

async function applyStoredAppTheme() {
  const stored = await chrome.storage.local.get([APP_THEME_STORAGE_KEY, 'popupTheme']);
  const theme = stored[APP_THEME_STORAGE_KEY] || stored.popupTheme || 'system';
  document.documentElement.dataset.theme = resolveAppTheme(theme);
  updateThemeToggleButton(theme);
}

function createThemeIcon(theme) {
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const addNode = (tag, attrs) => {
    const node = document.createElementNS(svgNs, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    svg.appendChild(node);
  };

  if (theme === 'dark') {
    addNode('path', { d: 'M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z' });
    return svg;
  }

  if (theme === 'light') {
    addNode('circle', { cx: '12', cy: '12', r: '4' });
    addNode('path', { d: 'M12 2v2.2M12 19.8V22M4.93 4.93l1.56 1.56M17.51 17.51l1.56 1.56M2 12h2.2M19.8 12H22M4.93 19.07l1.56-1.56M17.51 6.49l1.56-1.56' });
    return svg;
  }

  addNode('path', { d: 'M12 3v18' });
  addNode('path', { d: 'M12 5a7 7 0 1 0 0 14Z' });
  return svg;
}

function updateThemeToggleButton(theme) {
  const button = document.getElementById('globalThemeToggle');
  if (!button) return;

  const labelMap = {
    system: '主题：跟随系统',
    dark: '主题：深色',
    light: '主题：浅色'
  };

  button.replaceChildren(createThemeIcon(theme));
  button.title = labelMap[theme] || labelMap.system;
  button.setAttribute('aria-label', labelMap[theme] || labelMap.system);
}

async function cycleGlobalTheme() {
  const stored = await chrome.storage.local.get([APP_THEME_STORAGE_KEY, 'popupTheme']);
  const currentTheme = stored[APP_THEME_STORAGE_KEY] || stored.popupTheme || 'system';
  const themeOrder = ['system', 'dark', 'light'];
  const nextTheme = themeOrder[(themeOrder.indexOf(currentTheme) + 1) % themeOrder.length];
  await chrome.storage.local.set({ [APP_THEME_STORAGE_KEY]: nextTheme, popupTheme: nextTheme });
  document.documentElement.dataset.theme = resolveAppTheme(nextTheme);
  updateThemeToggleButton(nextTheme);
}


appThemeQuery.addEventListener('change', async () => {
  const stored = await chrome.storage.local.get([APP_THEME_STORAGE_KEY, 'popupTheme']);
  const theme = stored[APP_THEME_STORAGE_KEY] || stored.popupTheme || 'system';
  if (theme === 'system') {
    document.documentElement.dataset.theme = resolveAppTheme('system');
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[APP_THEME_STORAGE_KEY] || changes.popupTheme) {
    const nextTheme = changes[APP_THEME_STORAGE_KEY]?.newValue || changes.popupTheme?.newValue || 'system';
    document.documentElement.dataset.theme = resolveAppTheme(nextTheme);
  }
});

applyStoredAppTheme().catch(() => {});
document.getElementById('globalThemeToggle')?.addEventListener('click', () => {
  cycleGlobalTheme().catch(() => {});
});

// Worker 代码
const WORKER_CODE = `// Cloudflare Worker for OpenClash Rules
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    const authHeader = request.headers.get('Authorization');
    if (path !== '/direct.yaml' && path !== '/proxy.yaml') {
      if (!authHeader || authHeader !== \`Bearer \${env.API_SECRET}\`) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }
    }
    try {
      if (request.method === 'GET' && (path === '/direct.yaml' || path === '/proxy.yaml')) {
        const type = path === '/direct.yaml' ? 'direct' : 'proxy';
        const rules = await env.RULES.get(type) || 'payload: []';
        return new Response(rules, { headers: { ...corsHeaders, 'Content-Type': 'text/yaml; charset=utf-8' } });
      }
      if (request.method === 'GET' && path === '/api/rules') {
        const direct = await env.RULES.get('direct') || 'payload: []';
        const proxy = await env.RULES.get('proxy') || 'payload: []';
        return new Response(JSON.stringify({ direct, proxy }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (request.method === 'POST' && path === '/api/rules') {
        const { domain, type, matchType } = await request.json();
        const ruleType = type === 'PROXY' ? 'proxy' : 'direct';
        let content = await env.RULES.get(ruleType) || 'payload:';
        const rule = \`  - \${matchType},\${domain}\`;
        if (content.includes(rule)) {
          return new Response(JSON.stringify({ error: 'RULE_EXISTS' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        content += \`\\n\${rule}\`;
        await env.RULES.put(ruleType, content);
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (request.method === 'PUT' && path === '/api/rules') {
        const { direct, proxy } = await request.json();
        await env.RULES.put('direct', direct);
        await env.RULES.put('proxy', proxy);
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }
};`;

// 教程浮框
document.getElementById('showTutorial')?.addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('tutorialModal').style.display = 'block';
  document.getElementById('workerCode').textContent = WORKER_CODE;
});

document.getElementById('closeTutorial')?.addEventListener('click', () => {
  document.getElementById('tutorialModal').style.display = 'none';
});

document.getElementById('closeTutorialBtn')?.addEventListener('click', () => {
  document.getElementById('tutorialModal').style.display = 'none';
});

document.getElementById('tutorialModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'tutorialModal') {
    document.getElementById('tutorialModal').style.display = 'none';
  }
});

document.getElementById('copyWorkerCode')?.addEventListener('click', async () => {
  await navigator.clipboard.writeText(WORKER_CODE);
  const btn = document.getElementById('copyWorkerCode');
  btn.textContent = '✅ 已复制';
  setTimeout(() => btn.textContent = '📋 复制代码', 2000);
});

// 模式切换
function updateModeUI(mode) {
  const showCloud = mode === 'cloudflare';
  document.getElementById('cloudflareConfig').style.display = showCloud ? 'block' : 'none';
  document.getElementById('remoteConfig').style.display = showCloud ? 'none' : 'block';
  document.getElementById('cloudflareSection').style.display = showCloud ? 'block' : 'none';
  document.getElementById('remoteSection').style.display = showCloud ? 'none' : 'block';
  document.getElementById('section-cloud').style.display = showCloud ? 'block' : 'none';
  document.getElementById('section-remote').style.display = showCloud ? 'none' : 'block';
  document.getElementById('navCloud').style.display = showCloud ? 'flex' : 'none';
  document.getElementById('navRemote').style.display = showCloud ? 'none' : 'flex';
}

document.getElementById('syncMode').addEventListener('change', function() {
  updateModeUI(this.value);
});

// 密码显示切换
function togglePasswordVisibility(e) {
  const button = e.currentTarget;
  const wrapper = button.closest('.password-wrapper');
  const input = wrapper?.querySelector('input');
  if (!input) return;

  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  button.classList.toggle('is-visible', isPassword);
  button.setAttribute('aria-label', isPassword ? '隐藏密码' : '显示密码');
}

document.getElementById('togglePassword')?.addEventListener('click', togglePasswordVisibility);
document.getElementById('togglePasswordCf')?.addEventListener('click', togglePasswordVisibility);
document.getElementById('toggleApiSecret')?.addEventListener('click', togglePasswordVisibility);
document.getElementById('toggleSecret')?.addEventListener('click', togglePasswordVisibility);
document.getElementById('toggleSecretCf')?.addEventListener('click', togglePasswordVisibility);
document.getElementById('toggleWebdavPassword')?.addEventListener('click', togglePasswordVisibility);

// 加载配置
chrome.storage.local.get(['config', 'cloudflareConfig', 'syncMode', 'localClientConfig', 'webdavConfig', 'backupState'], (result) => {
  const syncMode = result.syncMode || 'cloudflare';
  document.getElementById('syncMode').value = syncMode;
  updateModeUI(syncMode);
  
  const config = result.config || {};
  document.getElementById('host').value = config.host || '';
  document.getElementById('username').value = config.username || 'root';
  document.getElementById('password').value = config.password || '';
  document.getElementById('proxyFile').value = config.proxyFile || '/etc/openclash/rule_provider/Custom_Proxy.yaml';
  document.getElementById('directFile').value = config.directFile || '/etc/openclash/rule_provider/Custom_Direct.yaml';
  document.getElementById('clashHost').value = config.clashHost || '';
  document.getElementById('clashPort').value = config.clashPort || '9090';
  document.getElementById('clashSecret').value = config.clashSecret || '';
  document.getElementById('clashUI').value = config.clashUI || 'zashboard';
  
  const cloudflareConfig = result.cloudflareConfig || {};
  document.getElementById('workerUrl').value = cloudflareConfig.workerUrl || '';
  document.getElementById('apiSecret').value = cloudflareConfig.apiSecret || '';
  
  // 分离的路由器和本地客户端配置
  document.getElementById('hostCf').value = config.host || '';
  document.getElementById('usernameCf').value = config.username || 'root';
  document.getElementById('passwordCf').value = config.password || '';

  const localClientConfig = result.localClientConfig || {};
  document.getElementById('clashHostCf').value = localClientConfig.host || '127.0.0.1';
  document.getElementById('clashPortCf').value = localClientConfig.port || '9090';
  document.getElementById('clashSecretCf').value = localClientConfig.secret || '';
  document.getElementById('clashUICf').value = localClientConfig.ui || 'zashboard';

  // 如果有保存的代理组，需要先填充选项才能设置值
  if (localClientConfig.proxyGroup) {
    const select = document.getElementById('clashProxyGroupCf');
    select.innerHTML = `<option value="${localClientConfig.proxyGroup}">${localClientConfig.proxyGroup}</option>`;
    select.value = localClientConfig.proxyGroup;
    select.disabled = false;
  }

  // 如果已配置 Cloudflare，显示 Clash Verge 配置
  if (cloudflareConfig.workerUrl) {
    const proxyGroup = localClientConfig.proxyGroup || cloudflareConfig.proxyGroup || 'Proxy';
    showClashVergeMerge(cloudflareConfig.workerUrl, proxyGroup);
  }

  const webdavConfig = OpenClashBackup.buildWebDAVConfig(result.webdavConfig);
  document.getElementById('webdavUrl').value = webdavConfig.baseUrl || webdavConfig.fileUrl || '';
  document.getElementById('webdavUsername').value = webdavConfig.username || '';
  document.getElementById('webdavPassword').value = webdavConfig.password || '';
  document.getElementById('webdavAutoSync').checked = Boolean(webdavConfig.autoSync);
  document.getElementById('webdavAutoSyncInterval').value = webdavConfig.autoSyncInterval || OpenClashBackup.DEFAULT_AUTO_SYNC_INTERVAL;

  updateWebDAVMeta(result.backupState || {});
});

function getWebDAVConfigFromForm() {
  return OpenClashBackup.buildWebDAVConfig({
    baseUrl: document.getElementById('webdavUrl').value,
    username: document.getElementById('webdavUsername').value,
    password: document.getElementById('webdavPassword').value,
    autoSync: document.getElementById('webdavAutoSync').checked,
    autoSyncInterval: document.getElementById('webdavAutoSyncInterval').value
  });
}

function updateWebDAVMeta(backupState = {}) {
  const meta = document.getElementById('webdavMeta');
  const syncBadge = document.getElementById('webdavSyncBadge');
  const autoSyncBadge = document.getElementById('webdavAutoSyncBadge');
  const autoSyncEnabled = document.getElementById('webdavAutoSync')?.checked;
  if (!meta) return;

  if (!backupState.lastSyncedAt) {
    meta.textContent = `尚未执行 WebDAV 同步，备份文件将保存到 ${OpenClashBackup.BACKUP_FOLDER_NAME}/${OpenClashBackup.BACKUP_FILE_NAME}`;
    if (syncBadge) {
      syncBadge.textContent = '未同步';
      syncBadge.className = 'status-pill warning';
    }
  } else {
    const actionMap = {
      push: '上传到 WebDAV',
      pull: '从 WebDAV 拉取',
      noop: '无需同步'
    };

    const actionText = actionMap[backupState.lastSyncAction] || '已同步';
    const statusText = backupState.lastSyncStatus === 'error' ? '失败' : '成功';
    const message = backupState.lastSyncMessage ? `，${backupState.lastSyncMessage}` : '';
    const syncTime = backupState.lastSyncedAt ? new Date(backupState.lastSyncedAt).toLocaleString() : backupState.lastSyncedAt;
    meta.textContent = `上次同步：${syncTime}，动作：${actionText}，状态：${statusText}${message}`;

    if (syncBadge) {
      syncBadge.textContent = backupState.lastSyncStatus === 'error' ? '同步失败' : '已同步';
      syncBadge.className = backupState.lastSyncStatus === 'error' ? 'status-pill warning' : 'status-pill success';
    }
  }

  if (autoSyncBadge) {
    autoSyncBadge.textContent = autoSyncEnabled ? '已启用' : '已禁用';
    autoSyncBadge.className = autoSyncEnabled ? 'status-pill success' : 'status-pill';
  }
}

async function refreshWebDAVMeta() {
  const { backupState } = await chrome.storage.local.get(['backupState']);
  updateWebDAVMeta(backupState || {});
}

async function notifyBackupChanged(reason) {
  try {
    await chrome.runtime.sendMessage({ type: 'backup-data-changed', reason });
  } catch (error) {
    console.log('后台自动同步未响应:', error.message);
  }
  await refreshWebDAVMeta();
}

function buildBackupStatusMessage(prefix, result) {
  if (!result || !result.warnings || result.warnings.length === 0) {
    return prefix;
  }
  return `${prefix}（${result.warnings.join('；')}）`;
}

// 测试 Cloudflare 连接
document.getElementById('testCloudflare').onclick = async () => {
  let workerUrl = document.getElementById('workerUrl').value.trim();
  const apiSecret = document.getElementById('apiSecret').value;
  
  if (!workerUrl) {
    showStatus('statusCloudflare', '请输入 Worker URL', 'error');
    return;
  }
  
  // 自动补全 https://
  if (!workerUrl.startsWith('http://') && !workerUrl.startsWith('https://')) {
    workerUrl = 'https://' + workerUrl;
    document.getElementById('workerUrl').value = workerUrl;
  }
  
  try {
    const publicResponse = await fetch(`${workerUrl}/direct.yaml`);
    if (!publicResponse.ok) {
      showStatus('statusCloudflare', 'Worker URL 无法访问', 'error');
      return;
    }
    
    const apiResponse = await fetch(`${workerUrl}/api/rules`, {
      headers: { 'Authorization': `Bearer ${apiSecret}` }
    });
    
    if (apiResponse.ok) {
      showStatus('statusCloudflare', '✅ 连接成功！', 'success');
      const proxyGroup = document.getElementById('cfProxyGroup').value || 'Proxy';
      showClashVergeMerge(workerUrl, proxyGroup);
    } else if (apiResponse.status === 401) {
      showStatus('statusCloudflare', 'API Secret 错误', 'error');
    } else {
      showStatus('statusCloudflare', '连接失败', 'error');
    }
  } catch (e) {
    showStatus('statusCloudflare', '连接失败: ' + e.message, 'error');
  }
};

// 显示 Clash Verge Merge 配置
function showClashVergeMerge(workerUrl, proxyGroup = 'Proxy') {
  const merge = `// OpenClash Helper 自定义规则
// 规则集通用配置
const ruleProviderCommon = {
  "type": "http",
  "format": "yaml",
  "interval": 3600
};

// 程序入口
function main(config) {
  // 添加自定义规则集
  config["rule-providers"] = config["rule-providers"] || {};
  config["rule-providers"]["Rule-provider - Cloud_Direct"] = {
    ...ruleProviderCommon,
    "behavior": "classical",
    "url": "${workerUrl}/direct.yaml",
    "path": "./ruleset/cloud-direct.yaml"
  };
  config["rule-providers"]["Rule-provider - Cloud_Proxy"] = {
    ...ruleProviderCommon,
    "behavior": "classical",
    "url": "${workerUrl}/proxy.yaml",
    "path": "./ruleset/cloud-proxy.yaml"
  };

  // 在规则列表开头添加自定义规则
  config["rules"] = config["rules"] || [];
  config["rules"].unshift(
    "RULE-SET,Rule-provider - Cloud_Direct,DIRECT",
    "RULE-SET,Rule-provider - Cloud_Proxy,${proxyGroup}"
  );

  return config;
}`;
  
  document.getElementById('clashVergeMerge').value = merge;
}

// 复制 Clash Verge 配置
document.getElementById('copyClashVergeMerge').onclick = async () => {
  const text = document.getElementById('clashVergeMerge').value;
  await navigator.clipboard.writeText(text);
  const btn = document.getElementById('copyClashVergeMerge');
  const originalText = btn.textContent;
  btn.textContent = '✅ 已复制';
  btn.style.background = '#10b981';
  btn.style.color = 'white';
  setTimeout(() => {
    btn.textContent = originalText;
    btn.style.background = '';
    btn.style.color = '';
  }, 2000);
};

function getRouterHostForController(address) {
  const parsed = parseClashAddress(address || '');
  return parsed?.host || (address || '').trim().split(':')[0] || '';
}

async function ensureRouterRpcReady(api) {
  const probeResult = await api.exec(`printf 'openclash-helper-ok'`);
  if (!probeResult || !probeResult.trim()) {
    throw new Error('路由器接口响应异常：rpc/sys 未返回有效 result');
  }
}

async function fillRouterControllerFields({ api, routerAddress, hostFieldId, portFieldId, secretFieldId }) {
  const routerHost = getRouterHostForController(routerAddress);
  if (routerHost) {
    document.getElementById(hostFieldId).value = routerHost;
  }

  let clashSecret = document.getElementById(secretFieldId).value.trim();
  let clashPort = document.getElementById(portFieldId).value || '9090';

  try {
    const secretResult = await api.exec(`uci get openclash.config.dashboard_password 2>/dev/null || echo ""`);
    if (secretResult && secretResult.trim()) {
      clashSecret = secretResult.trim();
      document.getElementById(secretFieldId).value = clashSecret;
    }
  } catch (error) {}

  try {
    const portResult = await api.exec(`uci get openclash.config.cn_port 2>/dev/null || echo "9090"`);
    if (portResult && portResult.trim()) {
      clashPort = portResult.trim();
      document.getElementById(portFieldId).value = clashPort;
    }
  } catch (error) {}

  return {
    host: routerHost,
    port: clashPort,
    secret: clashSecret
  };
}


async function updateSyncTestState(patch) {
  const { syncTestState } = await chrome.storage.local.get(['syncTestState']);
  await chrome.storage.local.set({
    syncTestState: {
      ...(syncTestState || {}),
      ...patch
    }
  });
}

function buildSyncTargetRecord(target, extra = {}) {
  return {
    ready: true,
    target,
    testedAt: new Date().toISOString(),
    ...extra
  };
}

// 测试 Cloudflare 路由器连接（同时自动获取并回填外部控制配置）
document.getElementById('testCf').onclick = async () => {
  const host = document.getElementById('hostCf').value;
  const username = document.getElementById('usernameCf').value;
  const password = document.getElementById('passwordCf').value;

  if (!host || !password) {
    showStatus('statusCf', '请填写完整信息', 'error');
    return;
  }

  try {
    showStatus('statusCf', '正在测试连接...', 'success');
    const api = new OpenClashAPI({ host, username, password });
    await api.login();
    await ensureRouterRpcReady(api);

    showStatus('statusCf', '正在读取 OpenClash 配置...', 'success');
    const controllerFields = await fillRouterControllerFields({
      api,
      routerAddress: host,
      hostFieldId: 'clashHostCf',
      portFieldId: 'clashPortCf',
      secretFieldId: 'clashSecretCf'
    });

    const statusParts = ['✅ 连接成功'];
    if (controllerFields.host) {
      statusParts.push(`已自动填充外部控制地址 ${controllerFields.host}`);
    }
    if (controllerFields.port) {
      statusParts.push(`端口 ${controllerFields.port}`);
    }
    if (controllerFields.secret) {
      statusParts.push('已自动获取密钥');
    }

    await updateSyncTestState({
      cloudRouter: buildSyncTargetRecord({
        host: controllerFields.host,
        port: controllerFields.port,
        secret: controllerFields.secret
      })
    });
    showStatus('statusCf', statusParts.join('，'), 'success');
    saveAllSettings('cloud_router_tested', null).catch(error => {
      console.log('保存云端路由器测试结果失败:', error.message);
    });
  } catch (e) {
    await updateSyncTestState({ cloudRouter: { ready: false, testedAt: new Date().toISOString() } });
    showStatus('statusCf', '连接失败: ' + e.message, 'error');
  }
};

// 智能解析 Clash API 地址
function parseClashAddress(address) {
  if (!address) return null;

  address = address.trim();

  // 移除协议前缀 (http:// 或 https://)
  address = address.replace(/^https?:\/\//, '');

  // 移除尾部斜杠
  address = address.replace(/\/$/, '');

  // 如果包含端口，分离出来
  const parts = address.split(':');
  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    return {
      host: parts[0],
      port: parts[1]
    };
  }

  return {
    host: address,
    port: null
  };
}

// 测试 Clash API 连接（云端模式）
document.getElementById('testClashApiCf').onclick = async () => {
  let clashHost = document.getElementById('clashHostCf').value.trim();
  let clashPort = document.getElementById('clashPortCf').value || '9090';
  let clashSecret = document.getElementById('clashSecretCf').value;

  // 如果没有填写 Clash 地址，尝试使用路由器地址
  if (!clashHost) {
    const routerHost = document.getElementById('hostCf').value;
    if (routerHost) {
      clashHost = routerHost;
      showStatus('statusClashApiCf', 'ℹ️ 使用路由器地址进行测试...', 'success');
    } else {
      showStatus('statusClashApiCf', '请填写 Clash API 地址（如 127.0.0.1 或路由器 IP）', 'error');
      return;
    }
  }

  // 智能解析地址
  const parsed = parseClashAddress(clashHost);
  if (!parsed) {
    showStatus('statusClashApiCf', '地址格式错误', 'error');
    return;
  }

  const host = parsed.host;
  const port = parsed.port || clashPort;

  showStatus('statusClashApiCf', '正在测试 Clash API...', 'success');

  try {
    const headers = {};
    if (clashSecret) {
      headers['Authorization'] = `Bearer ${clashSecret}`;
    }

    const isLocal = host === '127.0.0.1' || host === 'localhost';
    console.log('[测试 Clash API] 请求信息:', {
      url: `http://${host}:${port}/version`,
      hasSecret: !!clashSecret,
      client: isLocal ? 'Local Clash' : 'Remote Clash'
    });

    const response = await fetch(`http://${host}:${port}/version`, {
      headers,
      signal: AbortSignal.timeout(5000)
    });

    if (response.status === 401) {
      await updateSyncTestState({
        cloudExternal: {
          ready: false,
          target: { host, port, secret: clashSecret || '' },
          testedAt: new Date().toISOString()
        }
      });
      showStatus('statusClashApiCf', '❌ 认证失败，Secret（密钥）错误', 'error');
      return;
    }

    if (!response.ok) {
      await updateSyncTestState({
        cloudExternal: {
          ready: false,
          target: { host, port, secret: clashSecret || '' },
          testedAt: new Date().toISOString()
        }
      });
      showStatus('statusClashApiCf', `❌ 连接失败 (HTTP ${response.status})`, 'error');
      return;
    }

    const data = await response.json();
    const versionInfo = data.version || (data.premium ? 'Premium' : 'Unknown');
    const clientType = isLocal ? '本地 Clash' : '远程 Clash';
    await updateSyncTestState({
      cloudExternal: buildSyncTargetRecord({ host, port, secret: clashSecret || '' }, { clientType })
    });
    showStatus('statusClashApiCf', `✅ 连接成功！${clientType} 版本: ${versionInfo}`, 'success');
  } catch (e) {
    await updateSyncTestState({
      cloudExternal: {
        ready: false,
        target: { host, port, secret: clashSecret || '' },
        testedAt: new Date().toISOString()
      }
    });
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      showStatus('statusClashApiCf', '❌ 连接超时，请检查地址和端口，或确认 Clash 正在运行', 'error');
    } else if (e.message.includes('fetch') || e.message.includes('NetworkError')) {
      showStatus('statusClashApiCf', '❌ 网络错误，无法连接到 Clash API（OpenClash/Clash Verge 等）', 'error');
    } else {
      showStatus('statusClashApiCf', '❌ 测试失败: ' + e.message, 'error');
    }
    console.error('[测试 Clash API] 失败:', e);
  }
};

// 获取 Clash 代理组（云端模式 - 用于 Clash Verge 配置）
document.getElementById('fetchClashGroupsCf')?.addEventListener('click', async () => {
  let clashHost = document.getElementById('clashHostCf').value.trim();
  let clashPort = document.getElementById('clashPortCf').value || '9090';
  let clashSecret = document.getElementById('clashSecretCf').value;

  if (!clashHost) {
    showStatus('statusClashApiCf', '请先填写 Clash API 地址', 'error');
    return;
  }

  // 智能解析地址
  const parsed = parseClashAddress(clashHost);
  if (!parsed) {
    showStatus('statusClashApiCf', '地址格式错误', 'error');
    return;
  }

  const host = parsed.host;
  const port = parsed.port || clashPort;

  showStatus('statusClashApiCf', '正在获取代理组...', 'success');

  try {
    const headers = {};
    if (clashSecret) {
      headers['Authorization'] = `Bearer ${clashSecret}`;
    }

    const response = await fetch(`http://${host}:${port}/proxies`, {
      headers,
      signal: AbortSignal.timeout(5000)
    });

    if (response.status === 401) {
      showStatus('statusClashApiCf', '❌ Clash API 认证失败，请检查外部控制密钥（Secret）', 'error');
      return;
    }

    if (!response.ok) {
      throw new Error('无法连接 Clash API');
    }

    const data = await response.json();
    const groups = Object.entries(data.proxies)
      .filter(([name, p]) => !['DIRECT', 'REJECT', 'GLOBAL'].includes(name) &&
        (p.type === 'Selector' || p.type === 'URLTest' || p.type === 'Fallback' || p.type === 'Smart'))
      .map(([name]) => name);

    if (groups.length === 0) {
      throw new Error('未找到代理组');
    }

    const select = document.getElementById('clashProxyGroupCf');
    select.innerHTML = groups.map(g => `<option value="${g}">${g}</option>`).join('');
    select.disabled = false;

    // 恢复之前保存的选择
    const { localClientConfig } = await chrome.storage.local.get(['localClientConfig']);
    if (localClientConfig?.proxyGroup && groups.includes(localClientConfig.proxyGroup)) {
      select.value = localClientConfig.proxyGroup;
    }

    showStatus('statusClashApiCf', `✅ 找到 ${groups.length} 个代理组`, 'success');

    // 更新 Clash Verge 配置
    const workerUrl = document.getElementById('workerUrl').value;
    if (workerUrl) {
      showClashVergeMerge(workerUrl, select.value);
    }
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      showStatus('statusClashApiCf', '❌ 连接超时，请检查地址和端口', 'error');
    } else {
      showStatus('statusClashApiCf', '获取失败: ' + e.message, 'error');
    }
  }
});

// 代理组选择变化时更新 Clash Verge 配置
document.getElementById('clashProxyGroupCf')?.addEventListener('change', function() {
  const workerUrl = document.getElementById('workerUrl').value;
  if (workerUrl) {
    showClashVergeMerge(workerUrl, this.value);
  }
});

// 获取代理组列表（云端同步模式）
document.getElementById('fetchGroupsCf').onclick = async () => {
  const host = document.getElementById('hostCf').value;
  const username = document.getElementById('usernameCf').value;
  const password = document.getElementById('passwordCf').value;
  
  if (!host || !password) {
    showStatus('statusCf', '请先填写路由器信息并测试连接', 'error');
    return;
  }
  
  showStatus('statusCf', '正在获取代理组...', 'success');
  
  try {
    const api = new OpenClashAPI({ host, username, password });
    
    // 从UCI获取Secret和端口
    let clashSecret = '';
    let clashPort = '9090';
    
    try {
      const secretResult = await api.exec(`uci get openclash.config.dashboard_password 2>/dev/null || echo ""`);
      if (secretResult && secretResult.trim()) clashSecret = secretResult.trim();
      const portResult = await api.exec(`uci get openclash.config.cn_port 2>/dev/null || echo "9090"`);
      if (portResult && portResult.trim()) clashPort = portResult.trim();
    } catch (e) {}
    
    const [hostPart] = host.split(':');
    const headers = {};
    if (clashSecret) headers['Authorization'] = `Bearer ${clashSecret}`;
    
    const response = await fetch(`http://${hostPart}:${clashPort}/proxies`, { headers });
    
    if (response.status === 401) {
      showStatus('statusCf', '❌ Clash API 认证失败，请检查外部控制密钥（Secret）', 'error');
      return;
    }

    if (!response.ok) throw new Error('无法连接 Clash API');
    
    const data = await response.json();
    const groups = Object.entries(data.proxies)
      .filter(([name, p]) => !['DIRECT', 'REJECT', 'GLOBAL'].includes(name) && 
        (p.type === 'Selector' || p.type === 'URLTest' || p.type === 'Fallback' || p.type === 'Smart'))
      .map(([name]) => name);
    
    if (groups.length === 0) throw new Error('未找到代理组');
    
    const select = document.getElementById('cfProxyGroup');
    select.innerHTML = groups.map(g => `<option value="${g}">${g}</option>`).join('');
    select.disabled = false;
    document.getElementById('autoConfigCf').disabled = false;
    
    // 恢复之前保存的选择
    const { cloudflareConfig } = await chrome.storage.local.get(['cloudflareConfig']);
    if (cloudflareConfig?.proxyGroup && groups.includes(cloudflareConfig.proxyGroup)) {
      select.value = cloudflareConfig.proxyGroup;
    }
    
    showStatus('statusCf', `✅ 找到 ${groups.length} 个代理组`, 'success');
    
    // 更新 Clash Verge 配置
    const workerUrl = document.getElementById('workerUrl').value;
    if (workerUrl) {
      showClashVergeMerge(workerUrl, select.value);
    }
  } catch (e) {
    showStatus('statusCf', '获取失败: ' + e.message, 'error');
  }
};

// 代理组选择变化时更新 Clash Verge 配置
document.getElementById('cfProxyGroup')?.addEventListener('change', function() {
  const workerUrl = document.getElementById('workerUrl').value;
  if (workerUrl) {
    showClashVergeMerge(workerUrl, this.value);
  }
});

// 自动配置 OpenClash UCI（云端同步）
document.getElementById('autoConfigCf').onclick = async () => {
  const host = document.getElementById('hostCf').value;
  const username = document.getElementById('usernameCf').value;
  const password = document.getElementById('passwordCf').value;
  const workerUrl = document.getElementById('workerUrl').value;
  const apiSecret = document.getElementById('apiSecret').value;
  const proxyGroup = document.getElementById('cfProxyGroup').value;
  
  if (!host || !password) {
    showStatus('statusAutoConfigCf', '请填写路由器信息', 'error');
    return;
  }
  
  if (!workerUrl || !apiSecret) {
    showStatus('statusAutoConfigCf', '请先配置并测试 Cloudflare Worker', 'error');
    return;
  }
  
  if (!proxyGroup) {
    showStatus('statusAutoConfigCf', '请先获取并选择代理组', 'error');
    return;
  }
  
  showStatus('statusAutoConfigCf', '正在配置 OpenClash UCI...', 'success');
  
  try {
    const api = new OpenClashAPI({ host, username, password });
    
    // 检查是否已存在配置
    const existingProviders = await api.exec(`uci show openclash | grep rule_providers | grep name`);
    const hasCloudDirect = existingProviders.includes("name='Rule-provider - Cloud_Direct'");
    const hasCloudProxy = existingProviders.includes("name='Rule-provider - Cloud_Proxy'");
    
    let needRestart = false;
    
    // 检查并更新 Cloud_Proxy
    if (hasCloudProxy) {
      const proxyIndex = existingProviders.match(/openclash\.@rule_providers\[(\d+)\]\.name='Rule-provider - Cloud_Proxy'/);
      if (proxyIndex) {
        const idx = proxyIndex[1];
        const existingGroup = await api.exec(`uci get openclash.@rule_providers[${idx}].group 2>/dev/null || echo ""`);
        if (existingGroup.trim() !== proxyGroup) {
          await api.exec(`uci set openclash.@rule_providers[${idx}].group='${proxyGroup}'`);
          needRestart = true;
          showStatus('statusAutoConfigCf', '✓ 已更新代理组配置', 'success');
        }
      }
    } else {
      await api.exec(`uci add openclash rule_providers`);
      await api.exec(`uci set openclash.@rule_providers[-1].enabled='1'`);
      await api.exec(`uci set openclash.@rule_providers[-1].config='all'`);
      await api.exec(`uci set openclash.@rule_providers[-1].name='Rule-provider - Cloud_Proxy'`);
      await api.exec(`uci set openclash.@rule_providers[-1].type='http'`);
      await api.exec(`uci set openclash.@rule_providers[-1].behavior='classical'`);
      await api.exec(`uci set openclash.@rule_providers[-1].format='yaml'`);
      await api.exec(`uci set openclash.@rule_providers[-1].position='0'`);
      await api.exec(`uci set openclash.@rule_providers[-1].group='${proxyGroup}'`);
      await api.exec(`uci set openclash.@rule_providers[-1].url='${workerUrl}/proxy.yaml'`);
      await api.exec(`uci set openclash.@rule_providers[-1].interval='3600'`);
      await api.exec(`uci set openclash.@rule_providers[-1].path='./ruleset/cloud-proxy.yaml'`);
      needRestart = true;
    }
    
    // 添加 Cloud_Direct（直连组不需要检查更新）
    if (!hasCloudDirect) {
      await api.exec(`uci add openclash rule_providers`);
      await api.exec(`uci set openclash.@rule_providers[-1].enabled='1'`);
      await api.exec(`uci set openclash.@rule_providers[-1].config='all'`);
      await api.exec(`uci set openclash.@rule_providers[-1].name='Rule-provider - Cloud_Direct'`);
      await api.exec(`uci set openclash.@rule_providers[-1].type='http'`);
      await api.exec(`uci set openclash.@rule_providers[-1].behavior='classical'`);
      await api.exec(`uci set openclash.@rule_providers[-1].format='yaml'`);
      await api.exec(`uci set openclash.@rule_providers[-1].position='0'`);
      await api.exec(`uci set openclash.@rule_providers[-1].group='DIRECT'`);
      await api.exec(`uci set openclash.@rule_providers[-1].url='${workerUrl}/direct.yaml'`);
      await api.exec(`uci set openclash.@rule_providers[-1].interval='3600'`);
      await api.exec(`uci set openclash.@rule_providers[-1].path='./ruleset/cloud-direct.yaml'`);
      needRestart = true;
    }
    
    if (!needRestart) {
      showStatus('statusAutoConfigCf', '✅ UCI 配置已是最新，无需更新', 'success');
      // 仍然保存配置
      const cloudflareConfig = { workerUrl, apiSecret, proxyGroup };
      await chrome.storage.local.set({ cloudflareConfig, syncMode: 'cloudflare' });
      return;
    }
    
    await api.exec(`uci commit openclash`);
    
    showStatus('statusAutoConfigCf', '✅ UCI 配置成功！正在重启 OpenClash...', 'success');
    
    // 获取 secret
    let clashSecret = '';
    try {
      const secretResult = await api.exec(`uci get openclash.config.dashboard_password 2>/dev/null || echo ""`);
      clashSecret = secretResult.trim();
    } catch (e) {}
    
    // 重启 OpenClash
    await api.exec('/etc/init.d/openclash restart');
    
    // 等待重启完成
    showStatus('statusAutoConfigCf', '⏳ 等待 OpenClash 重启...', 'success');
    await waitForOpenClashRestart(host, clashSecret, 30);
    
    showStatus('statusAutoConfigCf', '✅ OpenClash 配置完成并已重启！', 'success');
    
    // 保存配置
    const cloudflareConfig = { workerUrl, apiSecret, proxyGroup };
    await chrome.storage.local.set({ cloudflareConfig, syncMode: 'cloudflare' });
  } catch (e) {
    showStatus('statusAutoConfigCf', '配置失败: ' + e.message, 'error');
  }
};

// 等待 OpenClash 重启
async function waitForOpenClashRestart(host, secret, maxWaitSeconds) {
  const startTime = Date.now();
  const [hostPart] = host.split(':');
  const port = host.includes(':') ? host.split(':')[1] : '9090';
  
  while (Date.now() - startTime < maxWaitSeconds * 1000) {
    try {
      const headers = {};
      if (secret) {
        headers['Authorization'] = `Bearer ${secret}`;
      }
      
      const response = await fetch(`http://${hostPart}:${port}/version`, { 
        headers,
        signal: AbortSignal.timeout(2000)
      });
      
      if (response.ok) {
        return true;
      }
    } catch (e) {
      // 继续等待
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('OpenClash 重启超时');
}

// 测试远程连接（同时自动获取Secret）
document.getElementById('testRemote').onclick = async () => {
  const host = document.getElementById('host').value;
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  if (!host || !password) {
    showStatus('statusRemote', '请填写完整信息', 'error');
    return;
  }

  try {
    showStatus('statusRemote', '正在测试连接...', 'success');
    const api = new OpenClashAPI({ host, username, password });
    await api.login();
    await ensureRouterRpcReady(api);

    showStatus('statusRemote', '正在读取 OpenClash 配置...', 'success');
    const controllerFields = await fillRouterControllerFields({
      api,
      routerAddress: host,
      hostFieldId: 'clashHost',
      portFieldId: 'clashPort',
      secretFieldId: 'clashSecret'
    });

    const statusParts = ['✅ 连接成功'];
    if (controllerFields.host) {
      statusParts.push(`已自动填充外部控制地址 ${controllerFields.host}`);
    }
    if (controllerFields.port) {
      statusParts.push(`端口 ${controllerFields.port}`);
    }
    if (controllerFields.secret) {
      statusParts.push('已自动获取密钥');
    }

    await updateSyncTestState({
      remoteRouter: buildSyncTargetRecord({
        host: controllerFields.host,
        port: controllerFields.port,
        secret: controllerFields.secret
      })
    });
    showStatus('statusRemote', statusParts.join('，'), 'success');
    saveAllSettings('remote_tested', null).catch(error => {
      console.log('保存远程测试结果失败:', error.message);
    });
  } catch (e) {
    await updateSyncTestState({ remoteRouter: { ready: false, testedAt: new Date().toISOString() } });
    showStatus('statusRemote', '连接失败: ' + e.message, 'error');
  }
};

// 测试 Clash API 连接（远程模式）
document.getElementById('testClashApi').onclick = async () => {
  let clashHost = document.getElementById('clashHost').value.trim();
  let clashPort = document.getElementById('clashPort').value || '9090';
  let clashSecret = document.getElementById('clashSecret').value;

  // 如果没有填写 Clash 地址，尝试使用路由器地址
  if (!clashHost) {
    const routerHost = document.getElementById('host').value;
    if (routerHost) {
      clashHost = routerHost;
      showStatus('statusClashApi', 'ℹ️ 使用路由器地址进行测试...', 'success');
    } else {
      showStatus('statusClashApi', '请填写 Clash API 地址（如 127.0.0.1 或路由器 IP）', 'error');
      return;
    }
  }

  // 智能解析地址
  const parsed = parseClashAddress(clashHost);
  if (!parsed) {
    showStatus('statusClashApi', '地址格式错误', 'error');
    return;
  }

  const host = parsed.host;
  const port = parsed.port || clashPort;

  showStatus('statusClashApi', '正在测试 Clash API...', 'success');

  try {
    const headers = {};
    if (clashSecret) {
      headers['Authorization'] = `Bearer ${clashSecret}`;
    }

    const isLocal = host === '127.0.0.1' || host === 'localhost';
    console.log('[测试 Clash API] 请求信息:', {
      url: `http://${host}:${port}/version`,
      hasSecret: !!clashSecret,
      client: isLocal ? 'Local Clash' : 'Remote Clash'
    });

    const response = await fetch(`http://${host}:${port}/version`, {
      headers,
      signal: AbortSignal.timeout(5000)
    });

    if (response.status === 401) {
      await updateSyncTestState({
        remoteExternal: {
          ready: false,
          target: { host, port, secret: clashSecret || '' },
          testedAt: new Date().toISOString()
        }
      });
      showStatus('statusClashApi', '❌ 认证失败，Secret（密钥）错误', 'error');
      return;
    }

    if (!response.ok) {
      await updateSyncTestState({
        remoteExternal: {
          ready: false,
          target: { host, port, secret: clashSecret || '' },
          testedAt: new Date().toISOString()
        }
      });
      showStatus('statusClashApi', `❌ 连接失败 (HTTP ${response.status})`, 'error');
      return;
    }

    const data = await response.json();
    const versionInfo = data.version || (data.premium ? 'Premium' : 'Unknown');
    const clientType = isLocal ? '本地 Clash' : '远程 Clash';
    await updateSyncTestState({
      remoteExternal: buildSyncTargetRecord({ host, port, secret: clashSecret || '' }, { clientType })
    });
    showStatus('statusClashApi', `✅ 连接成功！${clientType} 版本: ${versionInfo}`, 'success');
  } catch (e) {
    await updateSyncTestState({
      remoteExternal: {
        ready: false,
        target: { host, port, secret: clashSecret || '' },
        testedAt: new Date().toISOString()
      }
    });
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      showStatus('statusClashApi', '❌ 连接超时，请检查地址和端口，或确认 Clash 正在运行', 'error');
    } else if (e.message.includes('fetch') || e.message.includes('NetworkError')) {
      showStatus('statusClashApi', '❌ 网络错误，无法连接到 Clash API（OpenClash/Clash Verge 等）', 'error');
    } else {
      showStatus('statusClashApi', '❌ 测试失败: ' + e.message, 'error');
    }
    console.error('[测试 Clash API] 失败:', e);
  }
};

// 获取代理组列表（远程模式）
document.getElementById('fetchGroups').onclick = async () => {
  const host = document.getElementById('host').value;
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  let clashPort = document.getElementById('clashPort').value || '9090';
  let clashSecret = document.getElementById('clashSecret').value;
  
  if (!host || !password) {
    showStatus('statusAutoConfig', '请先填写路由器信息并测试连接', 'error');
    return;
  }
  
  showStatus('statusAutoConfig', '正在获取代理组...', 'success');
  
  try {
    // 如果没有Secret，先尝试从UCI获取
    if (!clashSecret) {
      const api = new OpenClashAPI({ host, username, password });
      try {
        const secretResult = await api.exec(`uci get openclash.config.dashboard_password 2>/dev/null || echo ""`);
        if (secretResult && secretResult.trim()) {
          clashSecret = secretResult.trim();
          document.getElementById('clashSecret').value = clashSecret;
        }
      } catch (e) {}
    }
    
    const [hostPart] = host.split(':');
    const headers = {};
    if (clashSecret) headers['Authorization'] = `Bearer ${clashSecret}`;
    
    const response = await fetch(`http://${hostPart}:${clashPort}/proxies`, { headers });
    
    if (response.status === 401) {
      showStatus('statusAutoConfig', '❌ 认证失败，请在上方填写正确的 Secret（外部控制密钥）', 'error');
      return;
    }
    
    if (!response.ok) throw new Error('无法连接 Clash API，请确认 Clash 已启动');
    
    const data = await response.json();
    const groups = Object.entries(data.proxies)
      .filter(([name, p]) => !['DIRECT', 'REJECT', 'GLOBAL'].includes(name) && 
        (p.type === 'Selector' || p.type === 'URLTest' || p.type === 'Fallback' || p.type === 'Smart'))
      .map(([name]) => name);
    
    if (groups.length === 0) throw new Error('未找到代理组');
    
    const select = document.getElementById('proxyGroup');
    select.innerHTML = groups.map(g => `<option value="${g}">${g}</option>`).join('');
    select.disabled = false;
    document.getElementById('autoConfigRemote').disabled = false;
    
    // 恢复之前保存的选择
    const { config } = await chrome.storage.local.get(['config']);
    if (config?.proxyGroup && groups.includes(config.proxyGroup)) {
      select.value = config.proxyGroup;
    }
    
    showStatus('statusAutoConfig', `✅ 找到 ${groups.length} 个代理组`, 'success');
  } catch (e) {
    if (e.message.includes('fetch') || e.message.includes('NetworkError')) {
      showStatus('statusAutoConfig', '❌ 无法连接 Clash API，请确认 Clash 已启动且端口正确', 'error');
    } else {
      showStatus('statusAutoConfig', '获取失败: ' + e.message, 'error');
    }
  }
};

// 自动配置 UCI（远程模式）
document.getElementById('autoConfigRemote').onclick = async () => {
  const host = document.getElementById('host').value;
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const proxyFile = document.getElementById('proxyFile').value;
  const directFile = document.getElementById('directFile').value;
  const proxyGroup = document.getElementById('proxyGroup').value;
  const clashSecret = document.getElementById('clashSecret').value;
  
  if (!host || !password) {
    showStatus('statusAutoConfig', '请填写路由器信息', 'error');
    return;
  }
  
  if (!proxyGroup) {
    showStatus('statusAutoConfig', '请选择代理组', 'error');
    return;
  }
  
  showStatus('statusAutoConfig', '正在配置 OpenClash UCI...', 'success');
  
  try {
    const api = new OpenClashAPI({ host, username, password, proxyFile, directFile });
    
    // 检查是否已存在配置
    const existingProviders = await api.exec(`uci show openclash | grep rule_providers | grep name`);
    const hasCustomProxy = existingProviders.includes("name='Rule-provider - Custom_Proxy'");
    const hasCustomDirect = existingProviders.includes("name='Rule-provider - Custom_Direct'");
    
    let needRestart = false;
    
    // 检查并更新 Custom_Proxy
    if (hasCustomProxy) {
      const proxyIndex = existingProviders.match(/openclash\.@rule_providers\[(\d+)\]\.name='Rule-provider - Custom_Proxy'/);
      if (proxyIndex) {
        const idx = proxyIndex[1];
        const existingGroup = await api.exec(`uci get openclash.@rule_providers[${idx}].group 2>/dev/null || echo ""`);
        if (existingGroup.trim() !== proxyGroup) {
          await api.exec(`uci set openclash.@rule_providers[${idx}].group='${proxyGroup}'`);
          needRestart = true;
          showStatus('statusAutoConfig', '✓ 已更新代理组配置', 'success');
        }
      }
    } else {
      await api.exec(`uci add openclash rule_providers`);
      await api.exec(`uci set openclash.@rule_providers[-1].enabled='1'`);
      await api.exec(`uci set openclash.@rule_providers[-1].config='all'`);
      await api.exec(`uci set openclash.@rule_providers[-1].name='Rule-provider - Custom_Proxy'`);
      await api.exec(`uci set openclash.@rule_providers[-1].type='file'`);
      await api.exec(`uci set openclash.@rule_providers[-1].behavior='classical'`);
      await api.exec(`uci set openclash.@rule_providers[-1].format='yaml'`);
      await api.exec(`uci set openclash.@rule_providers[-1].position='0'`);
      await api.exec(`uci set openclash.@rule_providers[-1].group='${proxyGroup}'`);
      await api.exec(`uci set openclash.@rule_providers[-1].path='${proxyFile}'`);
      needRestart = true;
    }
    
    // 添加 Custom_Direct（直连组不需要检查更新）
    if (!hasCustomDirect) {
      await api.exec(`uci add openclash rule_providers`);
      await api.exec(`uci set openclash.@rule_providers[-1].enabled='1'`);
      await api.exec(`uci set openclash.@rule_providers[-1].config='all'`);
      await api.exec(`uci set openclash.@rule_providers[-1].name='Rule-provider - Custom_Direct'`);
      await api.exec(`uci set openclash.@rule_providers[-1].type='file'`);
      await api.exec(`uci set openclash.@rule_providers[-1].behavior='classical'`);
      await api.exec(`uci set openclash.@rule_providers[-1].format='yaml'`);
      await api.exec(`uci set openclash.@rule_providers[-1].position='0'`);
      await api.exec(`uci set openclash.@rule_providers[-1].group='DIRECT'`);
      await api.exec(`uci set openclash.@rule_providers[-1].path='${directFile}'`);
      needRestart = true;
    }
    
    if (!needRestart) {
      showStatus('statusAutoConfig', '✅ UCI 配置已是最新，无需更新', 'success');
      return;
    }
    
    await api.exec(`uci commit openclash`);
    
    showStatus('statusAutoConfig', '✅ UCI 配置成功！正在重启 OpenClash...', 'success');
    
    // 重启 OpenClash
    await api.exec('/etc/init.d/openclash restart');
    
    // 等待重启完成
    showStatus('statusAutoConfig', '⏳ 等待 OpenClash 重启...', 'success');
    await waitForOpenClashRestart(host, clashSecret, 30);
    
    showStatus('statusAutoConfig', '✅ OpenClash 配置完成并已重启！', 'success');
  } catch (e) {
    showStatus('statusAutoConfig', '配置失败: ' + e.message, 'error');
  }
};

function collectAllSettings() {
  const syncMode = document.getElementById('syncMode').value;

  const config = {
    host: document.getElementById(syncMode === 'remote' ? 'host' : 'hostCf').value,
    username: document.getElementById(syncMode === 'remote' ? 'username' : 'usernameCf').value,
    password: document.getElementById(syncMode === 'remote' ? 'password' : 'passwordCf').value,
    proxyFile: document.getElementById('proxyFile').value,
    directFile: document.getElementById('directFile').value,
    clashHost: document.getElementById('clashHost').value,
    clashPort: document.getElementById('clashPort').value || '9090',
    clashSecret: document.getElementById('clashSecret').value,
    clashUI: document.getElementById('clashUI').value,
    proxyGroup: document.getElementById('proxyGroup').value
  };

  const cloudflareConfig = {
    workerUrl: document.getElementById('workerUrl').value,
    apiSecret: document.getElementById('apiSecret').value,
    proxyGroup: document.getElementById('cfProxyGroup').value || ''
  };

  const localClientConfig = {
    host: document.getElementById('clashHostCf').value,
    port: document.getElementById('clashPortCf').value || '9090',
    secret: document.getElementById('clashSecretCf').value,
    ui: document.getElementById('clashUICf').value,
    proxyGroup: document.getElementById('clashProxyGroupCf').value || ''
  };

  const webdavConfig = getWebDAVConfigFromForm();

  return { config, cloudflareConfig, localClientConfig, webdavConfig, syncMode };
}

async function saveAllSettings(reason = 'config_saved', message = '✅ 已自动保存') {
  const payload = collectAllSettings();
  const { webdavConfig: storedWebDAVConfig } = await chrome.storage.local.get(['webdavConfig']);
  payload.webdavConfig = OpenClashBackup.buildWebDAVConfig(storedWebDAVConfig || {});
  await chrome.storage.local.set(payload);
  await OpenClashBackup.markLocalChange(reason);
  await notifyBackupChanged(reason);
  if (message) {
    showStatus('statusSave', message, 'success');
  }
}

let autoSaveTimer = null;

function queueAutoSave(reason = 'config_autosave') {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    try {
      await saveAllSettings(reason);
    } catch (error) {
      showStatus('statusSave', '自动保存失败: ' + error.message, 'error');
    }
  }, 300);
}

function initAutoSave() {
  const fields = Array.from(document.querySelectorAll('input, select, textarea')).filter(element => {
    if (!element.id) return false;
    if (element.readOnly) return false;
    if (element.type === 'file') return false;
    if (element.id.startsWith('webdav')) return false;
    return true;
  });

  fields.forEach(field => {
    const eventName = field.type === 'checkbox' || field.tagName === 'SELECT' ? 'change' : 'input';
    field.addEventListener(eventName, () => {
      const reason = field.id.startsWith('webdav') ? 'webdav_autosave' : 'config_autosave';
      queueAutoSave(reason);
    });
  });
}

async function persistWebDAVConfig(statusMessage) {
  await chrome.storage.local.set({ webdavConfig: getWebDAVConfigFromForm() });
  await OpenClashBackup.configureAutoSyncAlarm();
  await refreshWebDAVMeta();
  if (statusMessage) {
    showStatus('statusWebdav', statusMessage, 'success');
  }
}

document.getElementById('exportBackup').addEventListener('click', async () => {
  try {
    showStatus('statusBackup', '正在生成完整备份...', 'success');
    await OpenClashBackup.exportToFile();
    showStatus('statusBackup', '✅ 备份文件已导出', 'success');
  } catch (error) {
    showStatus('statusBackup', '导出失败: ' + error.message, 'error');
  }
});

document.getElementById('importBackup').addEventListener('click', () => {
  document.getElementById('backupFileInput').click();
});

document.getElementById('backupFileInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!confirm('导入备份会覆盖当前本地配置，并尝试恢复备份内的规则，确定继续吗？')) {
    event.target.value = '';
    return;
  }

  try {
    const text = await file.text();
    const snapshot = JSON.parse(text);
    const result = await OpenClashBackup.applySnapshot(snapshot, { restoreRules: true });
    showStatus('statusBackup', buildBackupStatusMessage('✅ 备份已导入', result), 'success');
    await refreshWebDAVMeta();
    setTimeout(() => location.reload(), 800);
  } catch (error) {
    showStatus('statusBackup', '导入失败: ' + error.message, 'error');
  } finally {
    event.target.value = '';
  }
});

document.getElementById('testWebdav').addEventListener('click', async () => {
  try {
    const webdavConfig = getWebDAVConfigFromForm();
    const result = await OpenClashBackup.testWebDAV(webdavConfig);
    await persistWebDAVConfig(result.exists
      ? `✅ 连接成功，已检测到 ${result.backupFileUrl}，配置已自动保存`
      : `✅ 连接成功，目录已就绪，备份将保存到 ${result.backupFileUrl}，配置已自动保存`);
  } catch (error) {
    showStatus('statusWebdav', '连接失败: ' + error.message, 'error');
  }
});

document.getElementById('backupToWebdav').addEventListener('click', async () => {
  try {
    const webdavConfig = getWebDAVConfigFromForm();
    showStatus('statusWebdav', '正在上传完整备份到 WebDAV...', 'success');
    await OpenClashBackup.pushToWebDAV(webdavConfig);
    await persistWebDAVConfig('✅ 备份已上传到 WebDAV，配置已自动保存');
  } catch (error) {
    showStatus('statusWebdav', '上传失败: ' + error.message, 'error');
  }
});

document.getElementById('restoreFromWebdav').addEventListener('click', async () => {
  if (!confirm('将从 WebDAV 恢复备份并覆盖当前本地配置，确定继续吗？')) {
    return;
  }

  try {
    const webdavConfig = getWebDAVConfigFromForm();
    showStatus('statusWebdav', '正在从 WebDAV 恢复备份...', 'success');
    const { result } = await OpenClashBackup.pullFromWebDAV({ restoreRules: true, webdavConfig });
    await persistWebDAVConfig(buildBackupStatusMessage('✅ 已从 WebDAV 恢复，配置已自动保存', result));
    setTimeout(() => location.reload(), 800);
  } catch (error) {
    showStatus('statusWebdav', '恢复失败: ' + error.message, 'error');
  }
});

document.getElementById('syncWebdav').addEventListener('click', async () => {
  try {
    const webdavConfig = getWebDAVConfigFromForm();
    showStatus('statusWebdav', '正在执行双向同步...', 'success');
    const result = await OpenClashBackup.syncWithWebDAV(webdavConfig);

    if (result.action === 'pull') {
      await persistWebDAVConfig('✅ 检测到 WebDAV 更新，已同步到本地，配置已自动保存');
      setTimeout(() => location.reload(), 800);
      return;
    }

    if (result.action === 'push') {
      await persistWebDAVConfig('✅ 本地数据较新，已同步到 WebDAV，配置已自动保存');
      return;
    }

    await persistWebDAVConfig('✅ 本地与 WebDAV 已是最新，配置已自动保存');
  } catch (error) {
    showStatus('statusWebdav', '同步失败: ' + error.message, 'error');
  }
});

document.getElementById('webdavAutoSync').addEventListener('change', async () => {
  try {
    await persistWebDAVConfig();
  } catch (error) {
    showStatus('statusWebdav', '保存自动同步开关失败: ' + error.message, 'error');
  }
});
document.getElementById('webdavAutoSyncInterval').addEventListener('change', async () => {
  try {
    await persistWebDAVConfig();
  } catch (error) {
    showStatus('statusWebdav', '保存同步间隔失败: ' + error.message, 'error');
  }
});

function showStatus(elementId, msg, type) {
  const status = document.getElementById(elementId);
  status.textContent = msg;
  status.className = 'status ' + type;
  if (type === 'success' && !msg.includes('⏳') && !msg.includes('正在')) {
    setTimeout(() => status.className = 'status', 5000);
  }
}

function initSidebarNavigation() {
  const navItems = Array.from(document.querySelectorAll('.nav-item[data-target]'));
  const sections = navItems
    .map(item => document.getElementById(item.dataset.target))
    .filter(Boolean);

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      if (item.dataset.target === 'section-cloud') {
        const syncMode = document.getElementById('syncMode');
        if (syncMode.value !== 'cloudflare') {
          syncMode.value = 'cloudflare';
          syncMode.dispatchEvent(new Event('change'));
        }
      }

      if (item.dataset.target === 'section-remote') {
        const syncMode = document.getElementById('syncMode');
        if (syncMode.value !== 'remote') {
          syncMode.value = 'remote';
          syncMode.dispatchEvent(new Event('change'));
        }
      }

      const target = document.getElementById(item.dataset.target);
      if (!target) return;

      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  if (!sections.length || !('IntersectionObserver' in window)) {
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    const visibleEntry = entries
      .filter(entry => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

    if (!visibleEntry) return;

    navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.target === visibleEntry.target.id);
    });
  }, {
    rootMargin: '-15% 0px -65% 0px',
    threshold: [0.2, 0.4, 0.6]
  });

  sections.forEach(section => observer.observe(section));
}

initSidebarNavigation();
initAutoSave();
