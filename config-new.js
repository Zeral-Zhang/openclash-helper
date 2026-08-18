const APP_THEME_STORAGE_KEY = 'appTheme';
const appThemeQuery = window.matchMedia('(prefers-color-scheme: light)');
const OPENCLASH_CUSTOM_RULES_PATH = '/etc/openclash/custom/openclash_custom_rules.list';
const HELPER_PROVIDER_BLOCK_START = '## BEGIN openclash-helper worker rule-providers';
const HELPER_PROVIDER_BLOCK_END = '## END openclash-helper worker rule-providers';
const HELPER_RULE_BLOCK_START = '## BEGIN openclash-helper worker rules';
const HELPER_RULE_BLOCK_END = '## END openclash-helper worker rules';

function resolveAppTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  return appThemeQuery.matches ? 'light' : 'dark';
}

// 把主题偏好镜像到同步的 localStorage，供 theme-init.js 在首屏前读取，避免闪烁
function mirrorThemePreference(theme) {
  try {
    localStorage.setItem(APP_THEME_STORAGE_KEY, theme);
    localStorage.setItem('popupTheme', theme);
  } catch (e) {
    // 忽略 localStorage 不可用的情况
  }
}

async function applyStoredAppTheme() {
  const stored = await chrome.storage.local.get([APP_THEME_STORAGE_KEY, 'popupTheme']);
  const theme = stored[APP_THEME_STORAGE_KEY] || stored.popupTheme || 'system';
  mirrorThemePreference(theme);
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
  mirrorThemePreference(nextTheme);
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
    mirrorThemePreference(nextTheme);
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
function getRuleSourceFromSyncMode(mode) {
  return mode === 'remote' ? 'openclashLocal' : 'worker';
}

function getSyncModeFromRuleSource(ruleSource) {
  return ruleSource === 'openclashLocal' ? 'remote' : 'cloudflare';
}

function updateModeUI(mode) {
  const ruleSource = getRuleSourceFromSyncMode(mode);
  const ruleSourceSelect = document.getElementById('ruleSource');
  if (ruleSourceSelect && ruleSourceSelect.value !== ruleSource) {
    ruleSourceSelect.value = ruleSource;
  }

  const isLocalRouterMode = ruleSource === 'openclashLocal';
  const modeBadge = document.getElementById('overviewModeBadge');
  if (modeBadge) {
    modeBadge.textContent = isLocalRouterMode ? '高级本地模式' : 'Worker 主路径';
    modeBadge.className = isLocalRouterMode ? 'status-pill warning' : 'status-pill success';
  }

  const remoteSection = document.getElementById('remoteSection');
  if (remoteSection) {
    remoteSection.style.display = 'block';
  }
}

function setRuleSource(ruleSource) {
  const syncMode = document.getElementById('syncMode');
  if (!syncMode) return;
  const nextMode = getSyncModeFromRuleSource(ruleSource);
  if (syncMode.value !== nextMode) {
    syncMode.value = nextMode;
  }
  updateModeUI(syncMode.value);
  updateOverviewStatus().catch(() => {});
}

document.getElementById('syncMode')?.addEventListener('change', function() {
  updateModeUI(this.value);
  updateOverviewStatus().catch(() => {});
});

document.getElementById('ruleSource')?.addEventListener('change', function() {
  setRuleSource(this.value);
});


function normalizeAccessType(value) {
  return value === 'openClash' || value === 'openclash' ? 'openClash' : 'localClash';
}

function getCurrentSetupMode() {
  return normalizeAccessType(document.querySelector('.setup-choice.active')?.dataset.setupMode || 'localClash');
}

function getCloudProxyGroupFromForm(mode = getCurrentSetupMode()) {
  const isOpenClash = normalizeAccessType(mode) === 'openClash';
  if (isOpenClash) {
    return document.getElementById('openclashControllerGroup')?.value ||
      document.getElementById('cfProxyGroup')?.value ||
      document.getElementById('clashProxyGroupCf')?.value ||
      'Proxy';
  }

  return document.getElementById('clashProxyGroupCf')?.value ||
    document.getElementById('cfProxyGroup')?.value ||
    document.getElementById('openclashControllerGroup')?.value ||
    'Proxy';
}

function setSetupMode(mode = 'localClash', options = {}) {
  const nextMode = normalizeAccessType(mode);
  const isOpenClash = nextMode === 'openClash';

  document.querySelectorAll('.setup-choice[data-setup-mode]').forEach(button => {
    button.classList.toggle('active', normalizeAccessType(button.dataset.setupMode) === nextMode);
  });

  document.querySelectorAll('[data-local-only]').forEach(element => {
    element.style.display = isOpenClash ? 'none' : '';
  });

  document.querySelectorAll('[data-openclash-only]').forEach(element => {
    element.style.display = isOpenClash ? '' : 'none';
  });

  const badge = document.getElementById('overviewModeBadge');
  if (badge) {
    badge.textContent = isOpenClash ? 'OpenClash' : '本地 Clash';
    badge.className = isOpenClash ? 'status-pill warning' : 'status-pill success';
  }

  const activeNav = document.querySelector('.nav-item.active');
  if (activeNav?.dataset.target) {
    const hiddenByMode = (!isOpenClash && ['section-openclash', 'section-remote'].includes(activeNav.dataset.target)) ||
      (isOpenClash && activeNav.dataset.target === 'section-cloud');
    if (hiddenByMode) {
      activeNav.classList.remove('active');
      document.querySelector('.nav-item[data-target="section-overview"]')?.classList.add('active');
    }
  }

  if (options.persist !== false) {
    chrome.storage.local.set({ activeAccessType: nextMode }).catch(() => {});
  }

  const workerUrl = document.getElementById('workerUrl')?.value || '';
  const proxyGroup = getCloudProxyGroupFromForm(nextMode);
  if (workerUrl) showClashVergeMerge(workerUrl, proxyGroup);
}

document.querySelectorAll('.setup-choice[data-setup-mode]').forEach(button => {
  button.addEventListener('click', () => setSetupMode(button.dataset.setupMode));
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
document.getElementById('toggleOpenclashControllerSecret')?.addEventListener('click', togglePasswordVisibility);
document.getElementById('toggleWebdavPassword')?.addEventListener('click', togglePasswordVisibility);

// 加载配置
chrome.storage.local.get(['config', 'cloudflareConfig', 'syncMode', 'ruleSource', 'activeAccessType', 'setupTarget', 'enabledDevices', 'localClientConfig', 'webdavConfig', 'backupState', 'syncTestState'], (result) => {
  const ruleSource = result.ruleSource || getRuleSourceFromSyncMode(result.syncMode || 'cloudflare');
  const syncMode = getSyncModeFromRuleSource(ruleSource);
  document.getElementById('syncMode').value = syncMode;
  document.getElementById('ruleSource').value = ruleSource;
  updateModeUI(syncMode);
  setSetupMode(result.activeAccessType || result.setupTarget || 'localClash', { persist: false });
  
  const config = result.config || {};
  document.getElementById('host').value = config.host || '';
  document.getElementById('username').value = config.username || 'root';
  document.getElementById('password').value = config.password || '';
  // 迁移旧版规则文件路径名到统一命名
  const migrateRuleFilePath = (val, fallback) => {
    if (!val) return fallback;
    return val.replace('Custom_Proxy.yaml', 'openclash-helper-proxy.yaml')
              .replace('Custom_Direct.yaml', 'openclash-helper-direct.yaml');
  };
  document.getElementById('proxyFile').value = migrateRuleFilePath(config.proxyFile, '/etc/openclash/rule_provider/openclash-helper-proxy.yaml');
  document.getElementById('directFile').value = migrateRuleFilePath(config.directFile, '/etc/openclash/rule_provider/openclash-helper-direct.yaml');
  document.getElementById('clashHost').value = config.clashHost || '';
  document.getElementById('clashPort').value = config.clashPort || '9090';
  document.getElementById('clashSecret').value = config.clashSecret || '';
  document.getElementById('clashUI').value = config.clashUI || 'zashboard';
  document.getElementById('openclashControllerHost').value = config.clashHost || '';
  document.getElementById('openclashControllerPort').value = config.clashPort || '9090';
  document.getElementById('openclashControllerSecret').value = config.clashSecret || '';
  document.getElementById('openclashControllerUI').value = config.clashUI || 'zashboard';
  
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

  const savedOpenClashProxyGroup = config.proxyGroup || cloudflareConfig.proxyGroup || '';
  if (savedOpenClashProxyGroup) {
    const openclashSelect = document.getElementById('openclashControllerGroup');
    openclashSelect.innerHTML = `<option value="${savedOpenClashProxyGroup}">${savedOpenClashProxyGroup}</option>`;
    openclashSelect.value = savedOpenClashProxyGroup;
    openclashSelect.disabled = false;
    const cfGroupSelect = document.getElementById('cfProxyGroup');
    cfGroupSelect.innerHTML = `<option value="${savedOpenClashProxyGroup}">${savedOpenClashProxyGroup}</option>`;
    cfGroupSelect.value = savedOpenClashProxyGroup;
    cfGroupSelect.disabled = false;
  }

  // 如果已配置 Cloudflare，显示 Clash Verge 配置
  if (cloudflareConfig.workerUrl) {
    const proxyGroup = getCloudProxyGroupFromForm(result.activeAccessType || result.setupTarget || 'localClash');
    showClashVergeMerge(cloudflareConfig.workerUrl, proxyGroup);
  }

  const webdavConfig = OpenClashBackup.buildWebDAVConfig(result.webdavConfig);
  document.getElementById('webdavUrl').value = webdavConfig.baseUrl || webdavConfig.fileUrl || '';
  document.getElementById('webdavUsername').value = webdavConfig.username || '';
  document.getElementById('webdavPassword').value = webdavConfig.password || '';
  document.getElementById('webdavAutoSync').checked = Boolean(webdavConfig.autoSync);
  document.getElementById('webdavAutoSyncInterval').value = webdavConfig.autoSyncInterval || OpenClashBackup.DEFAULT_AUTO_SYNC_INTERVAL;

  updateWebDAVMeta(result.backupState || {});
  updateOverviewStatus(result).catch(() => {});
  restoreOpenClashProxyGroupFromUci().catch(error => {
    console.log('读取 OpenClash 当前代理组失败:', error.message);
  });
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


function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function updateOverviewStatus(state) {
  const data = state || await chrome.storage.local.get(['cloudflareConfig', 'config', 'localClientConfig', 'webdavConfig', 'backupState', 'syncTestState', 'ruleSource', 'syncMode']);
  const ruleSource = data.ruleSource || getRuleSourceFromSyncMode(data.syncMode || 'cloudflare');
  const workerUrl = data.cloudflareConfig?.workerUrl || document.getElementById('workerUrl')?.value || '';
  const routerHost = data.config?.host || document.getElementById('hostCf')?.value || document.getElementById('host')?.value || '';
  const localHost = data.localClientConfig?.host || document.getElementById('clashHostCf')?.value || '';
  const webdavReady = Boolean(data.webdavConfig?.baseUrl || data.webdavConfig?.fileUrl || document.getElementById('webdavUrl')?.value);

  setText('overviewRuleSource', ruleSource === 'openclashLocal' ? 'OpenClash 本地规则' : (workerUrl ? workerUrl : '未配置 Worker'));
  setText('overviewOpenClash', data.syncTestState?.cloudRouter?.ready || data.syncTestState?.remoteRouter?.ready ? '已连接' : (routerHost ? '已填写，待测试' : '未接入'));
  setText('overviewLocalClient', data.syncTestState?.cloudExternal?.ready || data.syncTestState?.remoteExternal?.ready ? '控制已连接' : (localHost ? '已填写，待测试' : '未配置控制')); 
  setText('overviewWebdav', data.backupState?.lastSyncedAt ? '上次同步 ' + new Date(data.backupState.lastSyncedAt).toLocaleString() : (webdavReady ? '已配置，未同步' : '未配置'));
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
      await chrome.storage.local.set({ ruleSource: 'worker', syncMode: 'cloudflare' });
      await updateOverviewStatus().catch(() => {});
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
  const safeWorkerUrl = (workerUrl || '').replace(/\/$/, '');
  const safeProxyGroup = proxyGroup || 'Proxy';
  const merge = [
    'const prependRule = [',
    '];',
    '',
    'function main(config) {',
    '  const selectedProxyGroup = ' + JSON.stringify(safeProxyGroup) + ';',
    '  const groups = Array.isArray(config["proxy-groups"]) ? config["proxy-groups"] : [];',
    '  const groupNames = groups.map(group => group && group.name).filter(Boolean);',
    '  const fallbackGroup = groupNames.find(name => !["DIRECT", "REJECT", "GLOBAL"].includes(name)) || groupNames[0] || "DIRECT";',
    '  const proxyTarget = groupNames.includes(selectedProxyGroup) ? selectedProxyGroup : fallbackGroup;',
    '',
    '  config["rule-providers"] = config["rule-providers"] || {};',
    '  config["rule-providers"]["OpenClashHelper_Direct"] = {',
    '    type: "http",',
    '    behavior: "classical",',
    '    format: "yaml",',
    '    url: "' + safeWorkerUrl + '/direct.yaml",',
    '    path: "./ruleset/openclash-helper-direct.yaml",',
    '    interval: 3600',
    '  };',
    '  config["rule-providers"]["OpenClashHelper_Proxy"] = {',
    '    type: "http",',
    '    behavior: "classical",',
    '    format: "yaml",',
    '    url: "' + safeWorkerUrl + '/proxy.yaml",',
    '    path: "./ruleset/openclash-helper-proxy.yaml",',
    '    interval: 3600',
    '  };',
    '',
    '  config.rules = Array.isArray(config.rules) ? config.rules : [];',
    '  const helperRules = [',
    '    "RULE-SET,OpenClashHelper_Direct,DIRECT",',
    '    "RULE-SET,OpenClashHelper_Proxy," + proxyTarget',
    '  ];',
    '  const reservedRules = new Set(prependRule.concat(helperRules));',
    '  const originalRules = config.rules.filter(rule => !String(rule).includes("OpenClashHelper_") && !reservedRules.has(rule));',
    '  config.rules = prependRule.concat(helperRules, originalRules);',
    '  return config;',
    '}',
  ].join('\n');

  const target = document.getElementById('clashVergeMerge');
  if (target) target.value = merge;
  updateOpenClashManualConfig(safeWorkerUrl, safeProxyGroup);
}

function updateOpenClashManualConfig(workerUrl, proxyGroup = 'Proxy') {
  const target = document.getElementById('openclashManualConfig');
  if (!target) return;
  const safeWorkerUrl = (workerUrl || document.getElementById('workerUrl')?.value || '').replace(/\/$/, '');
  const safeProxyGroup = proxyGroup || document.getElementById('cfProxyGroup')?.value || document.getElementById('clashProxyGroupCf')?.value || 'Proxy';
  target.value = [
    'OpenClash 手动配置要点',
    '',
    '1. 规则集一：OpenClashHelper_Direct',
    '   类型: http',
    '   Behavior: classical',
    '   Format: yaml',
    '   URL: ' + safeWorkerUrl + '/direct.yaml',
    '   Path: ./rule_provider/openclash-helper-direct.yaml',
    '   策略组: DIRECT',
    '   更新间隔: 3600',
    '',
    '2. 规则集二：OpenClashHelper_Proxy',
    '   类型: http',
    '   Behavior: classical',
    '   Format: yaml',
    '   URL: ' + safeWorkerUrl + '/proxy.yaml',
    '   Path: ./rule_provider/openclash-helper-proxy.yaml',
    '   策略组: ' + safeProxyGroup,
    '   更新间隔: 3600',
    '',
    '3. 保存并应用配置后，刷新规则集。'
  ].join('\n');
}

function buildOpenClashWorkerCustomRules(workerUrl, proxyGroup) {
  const safeWorkerUrl = (workerUrl || '').replace(/\/$/, '');
  const safeProxyGroup = proxyGroup || 'Proxy';

  return {
    providers: [
      HELPER_PROVIDER_BLOCK_START,
      '  "OpenClashHelper_Direct":',
      '    type: http',
      '    behavior: classical',
      '    format: yaml',
      `    url: "${safeWorkerUrl}/direct.yaml"`,
      '    path: ./rule_provider/openclash-helper-direct.yaml',
      '    interval: 3600',
      '  "OpenClashHelper_Proxy":',
      '    type: http',
      '    behavior: classical',
      '    format: yaml',
      `    url: "${safeWorkerUrl}/proxy.yaml"`,
      '    path: ./rule_provider/openclash-helper-proxy.yaml',
      '    interval: 3600',
      HELPER_PROVIDER_BLOCK_END
    ],
    rules: [
      HELPER_RULE_BLOCK_START,
      '  - RULE-SET,OpenClashHelper_Direct,DIRECT',
      `  - RULE-SET,OpenClashHelper_Proxy,${safeProxyGroup}`,
      HELPER_RULE_BLOCK_END
    ]
  };
}

function removeManagedBlock(content, startMarker, endMarker) {
  const lines = String(content || '').split(/\r?\n/);
  const result = [];
  let skipping = false;

  lines.forEach(line => {
    if (line.trim() === startMarker) {
      skipping = true;
      return;
    }
    if (line.trim() === endMarker) {
      skipping = false;
      return;
    }
    if (!skipping) result.push(line);
  });

  return result.join('\n');
}

function ensureYamlSection(content, sectionName) {
  const sectionPattern = new RegExp(`^${sectionName}:\\s*$`, 'm');
  if (sectionPattern.test(content)) {
    return content;
  }

  const normalized = content.trimEnd();
  return `${normalized}${normalized ? '\n\n' : ''}${sectionName}:\n`;
}

function insertBlockAfterSection(content, sectionName, blockLines) {
  const lines = ensureYamlSection(content, sectionName).split(/\r?\n/);
  const sectionIndex = lines.findIndex(line => line.trim() === `${sectionName}:`);
  if (sectionIndex === -1) {
    return `${lines.join('\n').trimEnd()}\n\n${sectionName}:\n${blockLines.join('\n')}\n`;
  }

  lines.splice(sectionIndex + 1, 0, ...blockLines);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function mergeOpenClashWorkerCustomRules(content, workerUrl, proxyGroup) {
  let nextContent = removeManagedBlock(content, HELPER_PROVIDER_BLOCK_START, HELPER_PROVIDER_BLOCK_END);
  nextContent = removeManagedBlock(nextContent, HELPER_RULE_BLOCK_START, HELPER_RULE_BLOCK_END);

  const blocks = buildOpenClashWorkerCustomRules(workerUrl, proxyGroup);
  nextContent = insertBlockAfterSection(nextContent, 'rule-providers', blocks.providers);
  nextContent = insertBlockAfterSection(nextContent, 'rules', blocks.rules);
  return nextContent;
}

async function writeOpenClashWorkerCustomRules(api, workerUrl, proxyGroup) {
  await api.exec('mkdir -p /etc/openclash/custom');
  let currentContent = '';
  try {
    currentContent = await api.readFile(OPENCLASH_CUSTOM_RULES_PATH);
  } catch (error) {
    currentContent = 'rule-providers:\nrules:\n';
  }

  const nextContent = mergeOpenClashWorkerCustomRules(currentContent, workerUrl, proxyGroup);
  if (nextContent !== currentContent) {
    await api.writeFile(OPENCLASH_CUSTOM_RULES_PATH, nextContent);
    return true;
  }
  return false;
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

async function setUciOptionIfChanged(api, sectionRef, option, value) {
  const current = await api.exec(`uci get ${sectionRef}.${option} 2>/dev/null || echo ""`);
  if (current.trim() === String(value)) {
    return false;
  }

  await api.exec(`uci set ${sectionRef}.${option}=${shellSingleQuote(value)}`);
  return true;
}

async function ensureRuleProviderOptions(api, sectionRef, options) {
  let changed = false;
  for (const [option, value] of Object.entries(options)) {
    if (await setUciOptionIfChanged(api, sectionRef, option, value)) {
      changed = true;
    }
  }
  return changed;
}

async function getExistingProxyGroup(api) {
  try {
    const existingProviders = await api.exec(`uci show openclash | grep rule_providers | grep name`);
    const proxyIndex = existingProviders.match(/openclash\.@rule_providers\[(\d+)\]\.name='OpenClashHelper_Proxy'/);
    if (!proxyIndex) {
      return '';
    }

    const group = await api.exec(`uci get openclash.@rule_providers[${proxyIndex[1]}].group 2>/dev/null || echo ""`);
    return group.trim();
  } catch (error) {
    return '';
  }
}

function populateSelectOptions(select, options, selectedValue = '') {
  select.replaceChildren(...options.map(value => new Option(value, value)));
  select.disabled = false;
  if (selectedValue && options.includes(selectedValue)) {
    select.value = selectedValue;
  }
  return select.value;
}

function setSelectValue(select, value) {
  if (!select || !value) {
    return;
  }

  if (![...select.options].some(option => option.value === value)) {
    select.appendChild(new Option(value, value));
  }
  select.value = value;
  select.disabled = false;
}

async function restoreOpenClashProxyGroupFromUci() {
  const host = document.getElementById('hostCf')?.value;
  const username = document.getElementById('usernameCf')?.value;
  const password = document.getElementById('passwordCf')?.value;
  if (!host || !password || getCurrentSetupMode() !== 'openClash') {
    return;
  }

  const api = new OpenClashAPI({ host, username, password });
  const proxyGroup = await getExistingProxyGroup(api);
  if (!proxyGroup) {
    return;
  }

  setSelectValue(document.getElementById('openclashControllerGroup'), proxyGroup);
  setSelectValue(document.getElementById('cfProxyGroup'), proxyGroup);

  const { cloudflareConfig, config } = await chrome.storage.local.get(['cloudflareConfig', 'config']);
  await chrome.storage.local.set({
    cloudflareConfig: { ...(cloudflareConfig || {}), proxyGroup },
    config: { ...(config || {}), proxyGroup }
  });
  refreshGeneratedConfigs();
}

function refreshGeneratedConfigs() {
  const workerUrl = document.getElementById('workerUrl')?.value || '';
  const proxyGroup = getCloudProxyGroupFromForm();
  if (workerUrl) showClashVergeMerge(workerUrl, proxyGroup);
  else updateOpenClashManualConfig('', proxyGroup);
}

['workerUrl', 'clashProxyGroupCf', 'cfProxyGroup', 'openclashControllerGroup'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', refreshGeneratedConfigs);
  document.getElementById(id)?.addEventListener('input', refreshGeneratedConfigs);
});

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
      hostFieldId: 'openclashControllerHost',
      portFieldId: 'openclashControllerPort',
      secretFieldId: 'openclashControllerSecret'
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
    await chrome.storage.local.set({ ruleSource: 'worker', syncMode: 'cloudflare' });
    await updateOverviewStatus().catch(() => {});
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


async function testControllerConnection({ hostId, portId, secretId, statusId, stateKey }) {
  let clashHost = document.getElementById(hostId).value.trim();
  let clashPort = document.getElementById(portId).value || '9090';
  let clashSecret = document.getElementById(secretId).value;
  if (!clashHost) {
    showStatus(statusId, '请填写控制地址', 'error');
    return;
  }
  const parsed = parseClashAddress(clashHost);
  if (!parsed) {
    showStatus(statusId, '地址格式错误', 'error');
    return;
  }
  const host = parsed.host;
  const port = parsed.port || clashPort;
  showStatus(statusId, '正在测试控制连接...', 'success');
  try {
    const headers = {};
    if (clashSecret) headers.Authorization = 'Bearer ' + clashSecret;
    const response = await fetch('http://' + host + ':' + port + '/version', { headers, signal: AbortSignal.timeout(5000) });
    if (response.status === 401) {
      await updateSyncTestState({ [stateKey]: { ready: false, target: { host, port, secret: clashSecret || '' }, testedAt: new Date().toISOString() } });
      showStatus(statusId, '认证失败，Secret 错误', 'error');
      return;
    }
    if (!response.ok) {
      await updateSyncTestState({ [stateKey]: { ready: false, target: { host, port, secret: clashSecret || '' }, testedAt: new Date().toISOString() } });
      showStatus(statusId, '连接失败 (HTTP ' + response.status + ')', 'error');
      return;
    }
    const data = await response.json();
    const versionInfo = data.version || (data.premium ? 'Premium' : 'Unknown');
    const clientType = data.meta ? 'Mihomo/Clash.Meta' : 'Clash';
    await updateSyncTestState({ [stateKey]: buildSyncTargetRecord({ host, port, secret: clashSecret || '' }, { clientType }) });
    showStatus(statusId, '✅ 连接成功！' + clientType + ' 版本: ' + versionInfo, 'success');
    await updateOverviewStatus().catch(() => {});
  } catch (e) {
    await updateSyncTestState({ [stateKey]: { ready: false, target: { host, port, secret: clashSecret || '' }, testedAt: new Date().toISOString() } });
    showStatus(statusId, e.name === 'TimeoutError' || e.name === 'AbortError' ? '连接超时，请检查地址和端口' : '测试失败: ' + e.message, 'error');
  }
}

async function fetchControllerGroups({ hostId, portId, secretId, selectId, statusId, storageKey }) {
  let clashHost = document.getElementById(hostId).value.trim();
  let clashPort = document.getElementById(portId).value || '9090';
  let clashSecret = document.getElementById(secretId).value;
  if (!clashHost) {
    showStatus(statusId, '请先填写控制地址', 'error');
    return;
  }
  const parsed = parseClashAddress(clashHost);
  if (!parsed) {
    showStatus(statusId, '地址格式错误', 'error');
    return;
  }
  const host = parsed.host;
  const port = parsed.port || clashPort;
  showStatus(statusId, '正在获取代理组...', 'success');
  try {
    const headers = {};
    if (clashSecret) headers.Authorization = 'Bearer ' + clashSecret;
    const response = await fetch('http://' + host + ':' + port + '/proxies', { headers, signal: AbortSignal.timeout(5000) });
    if (response.status === 401) {
      showStatus(statusId, '认证失败，请检查 Secret', 'error');
      return;
    }
    if (!response.ok) throw new Error('无法连接 Clash API');
    const data = await response.json();
    const groups = Object.entries(data.proxies)
      .filter(([name, p]) => !['DIRECT', 'REJECT', 'GLOBAL'].includes(name) &&
        (p.type === 'Selector' || p.type === 'URLTest' || p.type === 'Fallback' || p.type === 'Smart'))
      .map(([name]) => name);
    if (groups.length === 0) throw new Error('未找到代理组');
    const select = document.getElementById(selectId);
    select.innerHTML = groups.map(g => '<option value="' + g + '">' + g + '</option>').join('');
    select.disabled = false;
    const stored = await chrome.storage.local.get([storageKey]);
    const savedGroup = stored[storageKey]?.proxyGroup;
    if (savedGroup && groups.includes(savedGroup)) select.value = savedGroup;
    showStatus(statusId, '✅ 找到 ' + groups.length + ' 个代理组', 'success');
    refreshGeneratedConfigs();
  } catch (e) {
    showStatus(statusId, '获取失败: ' + e.message, 'error');
  }
}

document.getElementById('testOpenclashController')?.addEventListener('click', () => testControllerConnection({
  hostId: 'openclashControllerHost',
  portId: 'openclashControllerPort',
  secretId: 'openclashControllerSecret',
  statusId: 'statusOpenclashController',
  stateKey: 'cloudRouter'
}));

document.getElementById('fetchOpenclashControllerGroups')?.addEventListener('click', () => fetchControllerGroups({
  hostId: 'openclashControllerHost',
  portId: 'openclashControllerPort',
  secretId: 'openclashControllerSecret',
  selectId: 'openclashControllerGroup',
  statusId: 'statusOpenclashController',
  storageKey: 'config'
}));

// 测试 Clash API 连接（云端模式）
document.getElementById('testClashApiCf').onclick = async () => {
  let clashHost = document.getElementById('clashHostCf').value.trim();
  let clashPort = document.getElementById('clashPortCf').value || '9090';
  let clashSecret = document.getElementById('clashSecretCf').value;

  if (!clashHost) {
    showStatus('statusClashApiCf', '请填写本地 Clash 控制地址', 'error');
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
    await updateOverviewStatus().catch(() => {});
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
    
    const existingOpenClashGroup = await getExistingProxyGroup(api);
    const { cloudflareConfig, config } = await chrome.storage.local.get(['cloudflareConfig', 'config']);
    const selectedGroup = groups.includes(existingOpenClashGroup)
      ? existingOpenClashGroup
      : groups.includes(cloudflareConfig?.proxyGroup)
        ? cloudflareConfig.proxyGroup
        : groups.includes(config?.proxyGroup)
          ? config.proxyGroup
          : '';

    const select = document.getElementById('cfProxyGroup');
    populateSelectOptions(select, groups, selectedGroup);
    const openclashSelect = document.getElementById('openclashControllerGroup');
    populateSelectOptions(openclashSelect, groups, select.value);
    document.getElementById('autoConfigCf').disabled = false;

    if (select.value) {
      await chrome.storage.local.set({
        cloudflareConfig: { ...(cloudflareConfig || {}), proxyGroup: select.value },
        config: { ...(config || {}), proxyGroup: select.value }
      });
    }
    
    const sourceText = existingOpenClashGroup && groups.includes(existingOpenClashGroup) ? '，已读取 OpenClash 当前代理组' : '';
    showStatus('statusCf', `✅ 找到 ${groups.length} 个代理组${sourceText}`, 'success');
    
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

document.getElementById('openclashControllerGroup')?.addEventListener('change', function() {
  const cfSelect = document.getElementById('cfProxyGroup');
  if (cfSelect) {
    if (![...cfSelect.options].some(option => option.value === this.value)) {
      cfSelect.innerHTML = this.innerHTML;
    }
    cfSelect.value = this.value;
    cfSelect.disabled = false;
  }
  refreshGeneratedConfigs();
});

document.getElementById('cfProxyGroup')?.addEventListener('change', function() {
  const workerUrl = document.getElementById('workerUrl').value;
  if (workerUrl) {
    showClashVergeMerge(workerUrl, this.value);
  }
});

// 自动配置 OpenClash UCI（云端同步）
// 一次性清理旧版 provider 名（Cloud_*/Custom_*），避免统一后留下孤儿 UCI 段
async function cleanupLegacyRuleProviders(api) {
  const legacyNames = [
    "Rule-provider - Cloud_Proxy",
    "Rule-provider - Cloud_Direct",
    "Rule-provider - Custom_Proxy",
    "Rule-provider - Custom_Direct"
  ];
  try {
    const existing = await api.exec(`uci show openclash | grep rule_providers | grep name`);
    for (const legacy of legacyNames) {
      const needle = `.name='${legacy}'`;
      const indices = [];
      let pos = 0;
      while ((pos = existing.indexOf(needle, pos)) !== -1) {
        const lineStart = existing.lastIndexOf('\n', pos) + 1;
        const lineEnd = existing.indexOf('\n', pos);
        const line = existing.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
        const m = line.match(/@rule_providers\[(\d+)\]/);
        if (m) indices.push(Number(m[1]));
        pos += needle.length;
      }
      for (const idx of indices.sort((a, b) => b - a)) {
        await api.exec(`uci delete openclash.@rule_providers[${idx}]`);
      }
    }
  } catch (e) {
    console.log('清理旧 rule_providers 段失败:', e.message);
  }
}

document.getElementById('autoConfigCf').onclick = async () => {
  const host = document.getElementById('hostCf').value;
  const username = document.getElementById('usernameCf').value;
  const password = document.getElementById('passwordCf').value;
  const workerUrl = document.getElementById('workerUrl').value;
  const apiSecret = document.getElementById('apiSecret').value;
  const proxyGroup = getCloudProxyGroupFromForm('openClash');
  
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
    await cleanupLegacyRuleProviders(api);
    
    // 检查是否已存在配置
    const existingProviders = await api.exec(`uci show openclash | grep rule_providers | grep name`);
    const hasDirect = existingProviders.includes("name='OpenClashHelper_Direct'");
    const hasProxy = existingProviders.includes("name='OpenClashHelper_Proxy'");
    
    let needRestart = false;
    
    // 检查并更新 OpenClashHelper_Proxy
    if (hasProxy) {
      const proxyIndex = existingProviders.match(/openclash\.@rule_providers\[(\d+)\]\.name='OpenClashHelper_Proxy'/);
      if (proxyIndex) {
        const idx = proxyIndex[1];
        const changed = await ensureRuleProviderOptions(api, `openclash.@rule_providers[${idx}]`, {
          enabled: '1',
          config: 'all',
          name: 'OpenClashHelper_Proxy',
          type: 'http',
          behavior: 'classical',
          format: 'yaml',
          position: '0',
          group: proxyGroup,
          url: `${workerUrl}/proxy.yaml`,
          interval: '3600',
          path: './rule_provider/openclash-helper-proxy.yaml'
        });
        if (changed) {
          needRestart = true;
          showStatus('statusAutoConfigCf', '✓ 已更新代理规则源配置', 'success');
        }
      }
    } else {
      await api.exec(`uci add openclash rule_providers`);
      await api.exec(`uci set openclash.@rule_providers[-1].enabled='1'`);
      await api.exec(`uci set openclash.@rule_providers[-1].config='all'`);
      await api.exec(`uci set openclash.@rule_providers[-1].name='OpenClashHelper_Proxy'`);
      await api.exec(`uci set openclash.@rule_providers[-1].type='http'`);
      await api.exec(`uci set openclash.@rule_providers[-1].behavior='classical'`);
      await api.exec(`uci set openclash.@rule_providers[-1].format='yaml'`);
      await api.exec(`uci set openclash.@rule_providers[-1].position='0'`);
      await api.exec(`uci set openclash.@rule_providers[-1].group=${shellSingleQuote(proxyGroup)}`);
      await api.exec(`uci set openclash.@rule_providers[-1].url=${shellSingleQuote(`${workerUrl}/proxy.yaml`)}`);
      await api.exec(`uci set openclash.@rule_providers[-1].interval='3600'`);
      await api.exec(`uci set openclash.@rule_providers[-1].path='./rule_provider/openclash-helper-proxy.yaml'`);
      needRestart = true;
    }
    
    // 检查并更新 OpenClashHelper_Direct
    if (hasDirect) {
      const directIndex = existingProviders.match(/openclash\.@rule_providers\[(\d+)\]\.name='OpenClashHelper_Direct'/);
      if (directIndex) {
        const idx = directIndex[1];
        const changed = await ensureRuleProviderOptions(api, `openclash.@rule_providers[${idx}]`, {
          enabled: '1',
          config: 'all',
          name: 'OpenClashHelper_Direct',
          type: 'http',
          behavior: 'classical',
          format: 'yaml',
          position: '0',
          group: 'DIRECT',
          url: `${workerUrl}/direct.yaml`,
          interval: '3600',
          path: './rule_provider/openclash-helper-direct.yaml'
        });
        if (changed) {
          needRestart = true;
          showStatus('statusAutoConfigCf', '✓ 已更新直连规则源配置', 'success');
        }
      }
    } else {
      await api.exec(`uci add openclash rule_providers`);
      await api.exec(`uci set openclash.@rule_providers[-1].enabled='1'`);
      await api.exec(`uci set openclash.@rule_providers[-1].config='all'`);
      await api.exec(`uci set openclash.@rule_providers[-1].name='OpenClashHelper_Direct'`);
      await api.exec(`uci set openclash.@rule_providers[-1].type='http'`);
      await api.exec(`uci set openclash.@rule_providers[-1].behavior='classical'`);
      await api.exec(`uci set openclash.@rule_providers[-1].format='yaml'`);
      await api.exec(`uci set openclash.@rule_providers[-1].position='0'`);
      await api.exec(`uci set openclash.@rule_providers[-1].group='DIRECT'`);
      await api.exec(`uci set openclash.@rule_providers[-1].url=${shellSingleQuote(`${workerUrl}/direct.yaml`)}`);
      await api.exec(`uci set openclash.@rule_providers[-1].interval='3600'`);
      await api.exec(`uci set openclash.@rule_providers[-1].path='./rule_provider/openclash-helper-direct.yaml'`);
      needRestart = true;
    }
    
    showStatus('statusAutoConfigCf', '正在写入 OpenClash 自定义规则...', 'success');
    const customRulesChanged = await writeOpenClashWorkerCustomRules(api, workerUrl, proxyGroup);
    if (customRulesChanged) {
      needRestart = true;
    }

    if (!needRestart) {
      showStatus('statusAutoConfigCf', '✅ UCI 配置已是最新，无需更新', 'success');
      // 仍然保存配置
      const cloudflareConfig = { workerUrl, apiSecret, proxyGroup };
      await chrome.storage.local.set({ cloudflareConfig, syncMode: 'cloudflare', ruleSource: 'worker', enabledDevices: { openclash: true, clashController: Boolean(document.getElementById('clashHostCf')?.value) } });
      await updateOverviewStatus().catch(() => {});
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
    await chrome.storage.local.set({ cloudflareConfig, syncMode: 'cloudflare', ruleSource: 'worker', enabledDevices: { openclash: true, clashController: Boolean(document.getElementById('clashHostCf')?.value) } });
      await updateOverviewStatus().catch(() => {});
  } catch (e) {
    showStatus('statusAutoConfigCf', '配置失败: ' + formatRouterError(e), 'error');
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
    await chrome.storage.local.set({ ruleSource: 'openclashLocal', syncMode: 'remote' });
    await updateOverviewStatus().catch(() => {});
    saveAllSettings('remote_tested', null).catch(error => {
      console.log('保存远程测试结果失败:', error.message);
    });
  } catch (e) {
    await updateSyncTestState({ remoteRouter: { ready: false, testedAt: new Date().toISOString() } });
    showStatus('statusRemote', '连接失败: ' + formatRouterError(e), 'error');
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
    await updateOverviewStatus().catch(() => {});
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
    await cleanupLegacyRuleProviders(api);
    
    // 检查是否已存在配置
    const existingProviders = await api.exec(`uci show openclash | grep rule_providers | grep name`);
    const hasProxy = existingProviders.includes("name='OpenClashHelper_Proxy'");
    const hasDirect = existingProviders.includes("name='OpenClashHelper_Direct'");
    
    let needRestart = false;
    
    // 检查并更新 OpenClashHelper_Proxy
    if (hasProxy) {
      const proxyIndex = existingProviders.match(/openclash\.@rule_providers\[(\d+)\]\.name='OpenClashHelper_Proxy'/);
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
      await api.exec(`uci set openclash.@rule_providers[-1].name='OpenClashHelper_Proxy'`);
      await api.exec(`uci set openclash.@rule_providers[-1].type='file'`);
      await api.exec(`uci set openclash.@rule_providers[-1].behavior='classical'`);
      await api.exec(`uci set openclash.@rule_providers[-1].format='yaml'`);
      await api.exec(`uci set openclash.@rule_providers[-1].position='0'`);
      await api.exec(`uci set openclash.@rule_providers[-1].group='${proxyGroup}'`);
      await api.exec(`uci set openclash.@rule_providers[-1].path='${proxyFile}'`);
      needRestart = true;
    }
    
    // 添加 OpenClashHelper_Direct（直连组不需要检查更新）
    if (!hasDirect) {
      await api.exec(`uci add openclash rule_providers`);
      await api.exec(`uci set openclash.@rule_providers[-1].enabled='1'`);
      await api.exec(`uci set openclash.@rule_providers[-1].config='all'`);
      await api.exec(`uci set openclash.@rule_providers[-1].name='OpenClashHelper_Direct'`);
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
    showStatus('statusAutoConfig', '配置失败: ' + formatRouterError(e), 'error');
  }
};

function collectAllSettings() {
  const ruleSource = document.getElementById('ruleSource')?.value || getRuleSourceFromSyncMode(document.getElementById('syncMode').value);
  const syncMode = getSyncModeFromRuleSource(ruleSource);
  const activeAccessType = getCurrentSetupMode();
  const openClashProxyGroup = getCloudProxyGroupFromForm('openClash');
  const localClashProxyGroup = getCloudProxyGroupFromForm('localClash');
  document.getElementById('syncMode').value = syncMode;

  const config = {
    host: document.getElementById(syncMode === 'remote' ? 'host' : 'hostCf').value,
    username: document.getElementById(syncMode === 'remote' ? 'username' : 'usernameCf').value,
    password: document.getElementById(syncMode === 'remote' ? 'password' : 'passwordCf').value,
    proxyFile: document.getElementById('proxyFile').value,
    directFile: document.getElementById('directFile').value,
    clashHost: document.getElementById('openclashControllerHost').value || document.getElementById('clashHost').value,
    clashPort: document.getElementById('openclashControllerPort').value || document.getElementById('clashPort').value || '9090',
    clashSecret: document.getElementById('openclashControllerSecret').value || document.getElementById('clashSecret').value,
    clashUI: document.getElementById('openclashControllerUI').value || document.getElementById('clashUI').value,
    proxyGroup: syncMode === 'remote'
      ? document.getElementById('proxyGroup').value
      : openClashProxyGroup
  };

  const cloudflareConfig = {
    workerUrl: document.getElementById('workerUrl').value,
    apiSecret: document.getElementById('apiSecret').value,
    proxyGroup: activeAccessType === 'openClash' ? openClashProxyGroup : localClashProxyGroup
  };

  const localClientConfig = {
    host: document.getElementById('clashHostCf').value,
    port: document.getElementById('clashPortCf').value || '9090',
    secret: document.getElementById('clashSecretCf').value,
    ui: document.getElementById('clashUICf').value,
    proxyGroup: localClashProxyGroup
  };

  const webdavConfig = getWebDAVConfigFromForm();
  const enabledDevices = {
    openclash: Boolean(config.host || document.getElementById('hostCf').value),
    clashController: Boolean(localClientConfig.host)
  };

  return { config, cloudflareConfig, localClientConfig, webdavConfig, syncMode, ruleSource, enabledDevices };
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
  await updateOverviewStatus(payload).catch(() => {});
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

// 把 api.js 抛出的错误转成更友好的提示
function formatRouterError(e) {
  if (e && e.code === 'LUCI_RPC_MISSING') {
    return '路由器缺少 luci-mod-rpc 包，请先在路由器上安装 luci-mod-rpc';
  }
  if (e && e.code === 'NETWORK_ERROR') {
    return `无法连接路由器：${e.message}`;
  }
  return (e && e.message) ? e.message : String(e);
}

function initSidebarNavigation() {
  const navItems = Array.from(document.querySelectorAll('.nav-item[data-target]'));
  const sections = navItems
    .map(item => document.getElementById(item.dataset.target))
    .filter(Boolean);

  const setActive = (targetId) => {
    navItems.forEach(nav => nav.classList.toggle('active', nav.dataset.target === targetId));
  };

  // 点击跳转期间暂停滚动监听，避免观察器把高亮改回上一个
  let clickScrolling = false;
  let clickScrollTimer = null;

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = document.getElementById(item.dataset.target);
      if (!target) return;

      clickScrolling = true;
      if (clickScrollTimer) clearTimeout(clickScrollTimer);
      setActive(item.dataset.target);
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      clickScrollTimer = setTimeout(() => { clickScrolling = false; }, 700);
    });
  });

  if (!sections.length || !('IntersectionObserver' in window)) {
    return;
  }

  // 记录每个 section 的最新可见比例，取全局最大者高亮
  // （IntersectionObserver 每次只回传发生变化的条目，不能只看本批次）
  const ratios = new Map();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      ratios.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
    });

    if (clickScrolling) return;

    let bestId = null;
    let bestRatio = 0;
    ratios.forEach((ratio, id) => {
      if (ratio > bestRatio) { bestRatio = ratio; bestId = id; }
    });

    if (bestId) setActive(bestId);
  }, {
    rootMargin: '-15% 0px -65% 0px',
    threshold: [0, 0.2, 0.4, 0.6]
  });

  sections.forEach(section => observer.observe(section));
}

initSidebarNavigation();
initAutoSave();


document.getElementById('openCloudRules')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('cloud-rules.html') });
});

document.getElementById('openLocalRules')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('rules.html') });
});


document.getElementById('copyOpenClashManualConfig')?.addEventListener('click', async () => {
  const text = document.getElementById('openclashManualConfig')?.value || '';
  await navigator.clipboard.writeText(text);
  const btn = document.getElementById('copyOpenClashManualConfig');
  const originalText = btn.textContent;
  btn.textContent = '✅ 已复制';
  setTimeout(() => { btn.textContent = originalText; }, 2000);
});
