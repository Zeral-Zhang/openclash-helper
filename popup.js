let currentDomain = '';
let currentPort = '';
let isIP = false;
let syncMode = 'cloudflare';

let popupTheme = 'system';
const THEME_STORAGE_KEY = 'appTheme';
const systemThemeQuery = window.matchMedia('(prefers-color-scheme: light)');

function getEffectiveTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    return theme;
  }
  return systemThemeQuery.matches ? 'light' : 'dark';
}

function updateThemeToggle(theme) {
  const button = document.getElementById('themeToggle');
  if (!button) return;

  const labelMap = {
    system: '主题：跟随系统',
    dark: '主题：深色',
    light: '主题：浅色'
  };
  const iconMap = {
    system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18"/><path d="M12 5a7 7 0 1 0 0 14Z"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2.2M12 19.8V22M4.93 4.93l1.56 1.56M17.51 17.51l1.56 1.56M2 12h2.2M19.8 12H22M4.93 19.07l1.56-1.56M17.51 6.49l1.56-1.56"/></svg>'
  };

  button.innerHTML = iconMap[theme] || iconMap.system;
  button.dataset.tooltip = labelMap[theme] || labelMap.system;
  button.setAttribute('aria-label', labelMap[theme] || labelMap.system);
  button.title = labelMap[theme] || labelMap.system;
}

function applyPopupTheme(theme) {
  popupTheme = theme || 'system';
  document.documentElement.dataset.theme = getEffectiveTheme(popupTheme);
  updateThemeToggle(popupTheme);
}

async function initPopupTheme() {
  const stored = await chrome.storage.local.get([THEME_STORAGE_KEY, 'popupTheme']);
  applyPopupTheme(stored[THEME_STORAGE_KEY] || stored.popupTheme || 'system');
}

async function cyclePopupTheme() {
  const themeOrder = ['system', 'dark', 'light'];
  const currentIndex = themeOrder.indexOf(popupTheme);
  const nextTheme = themeOrder[(currentIndex + 1) % themeOrder.length];
  applyPopupTheme(nextTheme);
  await chrome.storage.local.set({ [THEME_STORAGE_KEY]: nextTheme, popupTheme: nextTheme });
}

function renderAccessStatus(kind, message, quickProxy = false) {
  const statusEl = document.getElementById('accessStatus');
  if (!statusEl) return;

  if (quickProxy) {
    statusEl.innerHTML = `
      <div class="proxy-hint">
        <div>⚠️ ${message}</div>
        <button class="quick-proxy-btn" id="quickProxy">一键添加到代理规则</button>
      </div>
    `;
    document.getElementById('quickProxy')?.addEventListener('click', () => addRule('PROXY'));
    return;
  }

  statusEl.innerHTML = `<div class="status-note ${kind}">${message}</div>`;
}

systemThemeQuery.addEventListener('change', () => {
  if (popupTheme === 'system') {
    applyPopupTheme('system');
  }
});

// 检查是否为 IP 地址
function isIPAddress(str) {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  return ipv4Regex.test(str) || ipv6Regex.test(str);
}

// 提取根域名
function extractRootDomain(domain) {
  const parts = domain.split('.');
  if (parts.length < 2) return domain;
  const secondLevelTLDs = ['co', 'com', 'net', 'org', 'gov', 'edu', 'ac'];
  if (parts.length >= 3 && secondLevelTLDs.includes(parts[parts.length - 2])) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

// 获取当前网站信息
(async function initPopup() {
  await initPopupTheme();
  document.getElementById('themeToggle')?.addEventListener('click', cyclePopupTheme);
  document.getElementById('versionBadge').textContent = `v${chrome.runtime.getManifest().version}`;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    document.getElementById('current').textContent = '无法读取当前页面';
    document.getElementById('currentMeta').textContent = '请切换到普通网页后再使用';
    renderAccessStatus('warning', '当前页面不支持规则添加');
    return;
  }

  const url = new URL(tab.url);
  currentDomain = url.hostname;
  currentPort = url.port;
  isIP = isIPAddress(currentDomain);

  const { syncMode: savedMode } = await chrome.storage.local.get(['syncMode']);
  syncMode = savedMode || 'cloudflare';

  document.getElementById('current').textContent = `${currentDomain}${currentPort ? ':' + currentPort : ''}`;
  document.getElementById('currentLabel').textContent = isIP ? '当前 IP' : '当前域名';
  document.getElementById('currentMeta').textContent = isIP
    ? `页面类型：IP 地址${currentPort ? ` · 端口：${currentPort}` : ''}`
    : `页面类型：域名${currentPort ? ` · 端口：${currentPort}` : ' · 默认端口'}`;

  renderRuleTypes();
  await checkAccessibility(tab);
})();

// 智能渲染规则类型
function renderRuleTypes() {
  const group = document.getElementById('ruleTypeGroup');
  let html = '';
  
  if (isIP && currentPort && !['80', '443', ''].includes(currentPort)) {
    // IP + 非标端口：显示 IP-CIDR 和 DST-PORT
    html = `
      <label class="radio-label">
        <input type="radio" name="matchType" value="IP-CIDR" checked>
        <span>IP-CIDR</span>
      </label>
      <label class="radio-label">
        <input type="radio" name="matchType" value="DST-PORT">
        <span>端口匹配</span>
      </label>
    `;
  } else if (isIP) {
    // IP 地址只显示 IP-CIDR
    html = `
      <label class="radio-label">
        <input type="radio" name="matchType" value="IP-CIDR" checked>
        <span>IP-CIDR</span>
      </label>
    `;
  } else if (currentPort && !['80', '443', ''].includes(currentPort)) {
    // 非标端口显示域名 + 端口规则
    html = `
      <label class="radio-label">
        <input type="radio" name="matchType" value="DOMAIN-SUFFIX" checked>
        <span>后缀匹配</span>
      </label>
      <label class="radio-label">
        <input type="radio" name="matchType" value="DOMAIN">
        <span>完整匹配</span>
      </label>
      <label class="radio-label">
        <input type="radio" name="matchType" value="DST-PORT">
        <span>端口匹配</span>
      </label>
    `;
  } else {
    // 普通域名
    html = `
      <label class="radio-label">
        <input type="radio" name="matchType" value="DOMAIN-SUFFIX" checked>
        <span>后缀匹配</span>
      </label>
      <label class="radio-label">
        <input type="radio" name="matchType" value="DOMAIN">
        <span>完整匹配</span>
      </label>
    `;
  }
  
  group.innerHTML = html;
  
  // 绑定事件
  document.querySelectorAll('input[name="matchType"]').forEach(radio => {
    radio.addEventListener('change', updateDomainPreview);
  });
  
  updateDomainPreview();
}

// 更新域名预览
function updateDomainPreview() {
  const matchType = document.querySelector('input[name="matchType"]:checked')?.value;
  const preview = document.getElementById('domainPreview');
  
  if (!matchType) return;
  
  if (matchType === 'IP-CIDR') {
    preview.textContent = `将添加：${currentDomain}/32`;
  } else if (matchType === 'DST-PORT') {
    preview.textContent = `将添加：端口 ${currentPort}`;
  } else if (matchType === 'DOMAIN-SUFFIX') {
    const rootDomain = extractRootDomain(currentDomain);
    preview.textContent = rootDomain !== currentDomain
      ? `将添加：${rootDomain}（从 ${currentDomain} 提取）`
      : `将添加：${currentDomain}`;
  } else {
    preview.textContent = `将添加：${currentDomain}`;
  }
}

// 检测访问状态
async function checkAccessibility(tab) {
  if (tab.url.startsWith('chrome-error://')) {
    showProxyHint('网站无法访问');
    return;
  }

  if (tab.title && (tab.title.includes('无法访问') || tab.title.includes('ERR_'))) {
    showProxyHint('页面加载失败');
    return;
  }

  if (isIP) {
    renderAccessStatus('info', 'ℹ️ 当前页面是 IP 地址，将优先使用 IP-CIDR 规则。');
    return;
  }

  renderAccessStatus('info', '🔍 正在检测当前站点的访问状态...');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    await fetch(`https://${currentDomain}`, {
      method: 'HEAD',
      mode: 'no-cors',
      signal: controller.signal
    });

    clearTimeout(timeout);
    renderAccessStatus('success', '✓ 网站可正常访问');
  } catch (e) {
    console.log('[可达性检测] fetch 失败:', {
      domain: currentDomain,
      error: e.message,
      errorType: e.name,
      errorStack: e.stack
    });

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          loaded: document.readyState === 'complete' || document.readyState === 'interactive',
          hasContent: document.body && document.body.children.length > 0
        })
      }).catch(() => null);

      if (results && results[0]?.result?.loaded && results[0]?.result?.hasContent) {
        renderAccessStatus('success', '✓ 网站可正常访问');
      } else {
        showProxyHint(e.name === 'AbortError' ? '连接超时，建议使用代理' : '网络错误，建议使用代理');
      }
    } catch (scriptError) {
      console.log('[可达性检测] 备用方案执行失败:', scriptError.message);
      if (tab.status === 'complete') {
        renderAccessStatus('warning', '⚠️ 无法准确检测访问状态，可按需手动添加规则');
      } else {
        showProxyHint('页面加载失败，建议使用代理');
      }
    }
  }
}

function showProxyHint(reason) {
  renderAccessStatus('warning', reason, true);
}

// 添加规则
async function addRule(type) {
  const matchType = document.querySelector('input[name="matchType"]:checked')?.value;
  if (!matchType) {
    showStatus('请选择规则类型', 'error');
    return;
  }
  
  let domainToAdd = currentDomain;
  
  if (matchType === 'IP-CIDR') {
    domainToAdd = currentDomain + '/32';
  } else if (matchType === 'DST-PORT') {
    domainToAdd = currentPort;
  } else if (matchType === 'DOMAIN-SUFFIX') {
    domainToAdd = extractRootDomain(currentDomain);
  }
  
  try {
    const { config, cloudflareConfig, localClientConfig, syncMode } = await chrome.storage.local.get(['config', 'cloudflareConfig', 'localClientConfig', 'syncMode']);
    const mode = syncMode || 'cloudflare';

    showStatus(mode === 'cloudflare' && localClientConfig?.host
      ? '✓ 已添加，正在刷新本地 Clash 规则集...'
      : '✓ 已添加', 'success');

    if (mode === 'remote') {
      if (!config || !config.host) {
        showStatus('请先配置路由器信息', 'error');
        setTimeout(() => chrome.runtime.openOptionsPage(), 1500);
        return;
      }

      const api = new OpenClashAPI(config);
      await api.addRule(domainToAdd, type, matchType);
      await refreshConfiguredRuleProviders(type);
    } else {
      if (!cloudflareConfig || !cloudflareConfig.workerUrl) {
        showStatus('请先配置 Cloudflare Worker', 'error');
        setTimeout(() => chrome.runtime.openOptionsPage(), 1500);
        return;
      }

      const api = new CloudflareAPI(cloudflareConfig);
      await api.addRule(domainToAdd, type, matchType);
      await refreshConfiguredRuleProviders(type);
    }
    
    await notifyBackupChanged('popup_add_rule');
    startCountdownRefresh();

  } catch (e) {
    if (e.message === 'RULE_EXISTS') {
      showStatus('该规则已存在', 'error');
    } else {
      showStatus('添加失败: ' + e.message, 'error');
    }
  }
}

// 通用刷新规则集函数
async function refreshRuleProviders(targetConfig, type, mode) {
  const target = resolveControllerTarget(targetConfig);
  if (!target) {
    console.log('Refresh skipped: target configuration not found.');
    return;
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (target.secret) headers['Authorization'] = `Bearer ${target.secret}`;
    
    let providerName;
    if (mode === 'remote') {
      providerName = type === 'PROXY' ? 'Rule-provider%20-%20Custom_Proxy' : 'Rule-provider%20-%20Custom_Direct';
    } else {
      providerName = type === 'PROXY' ? 'Rule-provider%20-%20Cloud_Proxy' : 'Rule-provider%20-%20Cloud_Direct';
    }
    
    const url = `http://${target.host}:${target.port}/providers/rules/${providerName}`;
    console.log(`Attempting to refresh rule provider at: ${url}`);

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    console.log(`Successfully triggered rule refresh on ${target.host}:${target.port}`);
    showStatus(`✓ ${target.host} 规则集已刷新`, 'success');
  } catch (e) {
    console.error(`刷新 ${targetConfig.host} 规则集失败:`, e);
    showStatus(`刷新 ${targetConfig.host} 失败: ${e.message}`, 'error');
  }
}

// 倒计时刷新页面
function startCountdownRefresh() {
  let countdown = 3;
  const interval = setInterval(() => {
    showStatus(`✓ 添加成功，${countdown}秒后刷新页面...`, 'success');
    countdown--;
    if (countdown < 0) {
      clearInterval(interval);
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        await chrome.tabs.reload(tabs[0].id);
        // 等待页面加载后重新检测可达性
        setTimeout(async () => {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          await checkAccessibility(tab);
        }, 1000);
      });
    }
  }, 1000);
}

function showStatus(msg, type) {
  const status = document.getElementById('status');
  status.textContent = msg;
  status.className = 'status ' + type;
  setTimeout(() => status.className = 'status', 3000);
}

function parseClashAddress(address) {
  if (!address) return null;
  let value = address.trim();

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return { host: url.hostname, port: url.port || null };
    } catch (error) {
      return null;
    }
  }

  value = value.replace(/\/$/, '');
  const parts = value.split(':');
  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    return { host: parts[0], port: parts[1] };
  }
  return { host: value, port: null };
}

function resolveControllerTarget(targetConfig) {
  const parsed = parseClashAddress(targetConfig?.host || '');
  if (!parsed?.host) {
    return null;
  }

  return {
    host: parsed.host,
    port: parsed.port || targetConfig.port || '9090',
    secret: targetConfig.secret || ''
  };
}


function sameControllerTarget(left, right) {
  if (!left || !right) {
    return false;
  }

  return left.host === right.host && String(left.port || '9090') === String(right.port || '9090');
}

async function getProviderRefreshTargets() {
  const { config, localClientConfig, syncMode, syncTestState } = await chrome.storage.local.get([
    'config',
    'localClientConfig',
    'syncMode',
    'syncTestState'
  ]);

  const mode = syncMode || 'cloudflare';
  if (mode === 'remote') {
    const routerTarget = resolveControllerTarget(
      syncTestState?.remoteRouter?.target || {
        host: config?.clashHost || config?.host?.split(':')[0],
        port: config?.clashPort || '9090',
        secret: config?.clashSecret || ''
      }
    );

    return routerTarget ? [{ target: routerTarget, mode: 'remote', label: '路由器' }] : [];
  }

  const routerReady = Boolean(syncTestState?.cloudRouter?.ready);
  const externalReady = Boolean(syncTestState?.cloudExternal?.ready);
  const routerTarget = routerReady ? resolveControllerTarget(syncTestState?.cloudRouter?.target) : null;
  const externalTarget = resolveControllerTarget(
    externalReady ? syncTestState?.cloudExternal?.target : localClientConfig
  );

  const targets = [];
  if (routerTarget) {
    targets.push({ target: routerTarget, mode: 'cloudflare', label: '路由器' });
  }

  if (!routerReady && externalTarget) {
    targets.push({ target: externalTarget, mode: 'cloudflare', label: '本地 Clash' });
  } else if (routerReady && externalReady && routerTarget && externalTarget && !sameControllerTarget(routerTarget, externalTarget)) {
    targets.push({ target: externalTarget, mode: 'cloudflare', label: '本地 Clash' });
  }

  return targets;
}

async function refreshConfiguredRuleProviders(type) {
  const targets = await getProviderRefreshTargets();
  await Promise.all(targets.map(({ target, mode, label }) =>
    refreshRuleProviders(target, type, mode).catch(error => {
      console.log(`刷新${label}规则集失败:`, error.message);
    })
  ));
}

function isHostedDashboardTarget(host) {
  return host === '127.0.0.1' || host === 'localhost';
}

function buildDashboardUrl(target) {
  const parsed = parseClashAddress(target.host || '');
  if (!parsed?.host) {
    return '';
  }

  const host = parsed.host;
  const port = parsed.port || target.port || '9090';
  const secret = target.secret || '';
  const ui = target.ui || 'zashboard';
  const encodedHost = encodeURIComponent(host);
  const encodedPort = encodeURIComponent(port);
  const encodedSecret = encodeURIComponent(secret);

  if (isHostedDashboardTarget(host)) {
    switch (ui) {
      case 'yacd':
        return `https://yacd.metacubex.one/?hostname=${encodedHost}&port=${encodedPort}&secret=${encodedSecret}`;
      case 'dashboard':
        return `https://metacubex.github.io/metacubexd/#/setup?http=true&hostname=${encodedHost}&port=${encodedPort}&secret=${encodedSecret}`;
      case 'zashboard':
      default:
        return `https://board.zash.run.place/#/setup?http=true&hostname=${encodedHost}&port=${encodedPort}&secret=${encodedSecret}`;
    }
  }

  switch (ui) {
    case 'yacd':
      return `http://${host}:${port}/ui/yacd/?hostname=${encodedHost}&port=${encodedPort}&secret=${encodedSecret}`;
    case 'dashboard':
      return `http://${host}:${port}/ui/dashboard/?hostname=${encodedHost}&port=${encodedPort}&secret=${encodedSecret}`;
    case 'razord':
      return `http://${host}:${port}/ui/razord/?host=${encodedHost}&port=${encodedPort}&secret=${encodedSecret}`;
    case 'zashboard':
    default:
      return `http://${host}:${port}/ui/zashboard/?hostname=${encodedHost}&port=${encodedPort}&secret=${encodedSecret}`;
  }
}

async function notifyBackupChanged(reason) {
  try {
    await chrome.runtime.sendMessage({ type: 'backup-data-changed', reason });
  } catch (error) {
    console.log('自动同步未执行:', error.message);
  }
}

// 打开页面
async function openPage(url) {
  const fullUrl = chrome.runtime.getURL(url);
  const tabs = await chrome.tabs.query({ url: fullUrl });
  const existingTab = tabs.find(tab => tab.url === fullUrl);
  
  if (existingTab) {
    await chrome.tabs.update(existingTab.id, { active: true });
    await chrome.windows.update(existingTab.windowId, { focused: true });
  } else {
    chrome.tabs.create({ url });
  }
}

document.getElementById('addDirect').onclick = () => addRule('DIRECT');
document.getElementById('addProxy').onclick = () => addRule('PROXY');
document.getElementById('config').onclick = () => chrome.runtime.openOptionsPage();
document.getElementById('viewRules').onclick = async () => {
  // 根据模式打开不同页面
  const { syncMode: mode } = await chrome.storage.local.get(['syncMode']);
  if (mode === 'remote') {
    openPage('rules.html');  // 远程模式：代码编辑器
  } else {
    openPage('cloud-rules.html');  // 云端模式：KV管理页面
  }
};

// 打开控制面板
document.getElementById('openDashboard').onclick = async () => {
  const { config, localClientConfig, syncMode } = await chrome.storage.local.get(['config', 'localClientConfig', 'syncMode']);
  const mode = syncMode || 'cloudflare';

  let target = null;
  if (mode === 'cloudflare' && localClientConfig?.host) {
    target = {
      host: localClientConfig.host,
      port: localClientConfig.port || '9090',
      secret: localClientConfig.secret || '',
      ui: localClientConfig.ui || 'zashboard'
    };
  } else if (config?.host) {
    target = {
      host: config.clashHost || config.host.split(':')[0],
      port: config.clashPort || '9090',
      secret: config.clashSecret || '',
      ui: config.clashUI || 'zashboard'
    };
  }

  if (!target?.host) {
    showStatus('请先配置控制面板 API 地址', 'error');
    return;
  }

  const url = buildDashboardUrl(target);
  if (!url) {
    showStatus('控制面板地址无效', 'error');
    return;
  }

  chrome.tabs.create({ url });
};
