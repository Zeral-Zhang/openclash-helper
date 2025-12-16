let currentDomain = '';
let currentPort = '';
let isIP = false;
let syncMode = 'cloudflare';

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
chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  const tab = tabs[0];
  const url = new URL(tab.url);
  currentDomain = url.hostname;
  currentPort = url.port;
  isIP = isIPAddress(currentDomain);
  
  // 加载保存的模式
  const { syncMode: savedMode } = await chrome.storage.local.get(['syncMode']);
  syncMode = savedMode || 'cloudflare';
  
  // 显示当前网站信息
  if (isIP) {
    document.getElementById('current').textContent = `当前 IP: ${currentDomain}${currentPort ? ':' + currentPort : ''}`;
  } else {
    document.getElementById('current').textContent = `当前域名: ${currentDomain}${currentPort ? ':' + currentPort : ''}`;
  }
  
  // 智能显示规则类型
  renderRuleTypes();
  
  // 检测访问状态
  await checkAccessibility(tab);
});

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
    preview.textContent = `将添加: ${currentDomain}/32`;
    preview.style.color = '#6366f1';
  } else if (matchType === 'DST-PORT') {
    preview.textContent = `将添加: ${currentPort}`;
    preview.style.color = '#8b5cf6';
  } else if (matchType === 'DOMAIN-SUFFIX') {
    const rootDomain = extractRootDomain(currentDomain);
    if (rootDomain !== currentDomain) {
      preview.textContent = `将添加: ${rootDomain} (从 ${currentDomain} 提取)`;
      preview.style.color = '#f59e0b';
    } else {
      preview.textContent = `将添加: ${currentDomain}`;
      preview.style.color = '#6b7280';
    }
  } else {
    preview.textContent = `将添加: ${currentDomain}`;
    preview.style.color = '#6b7280';
  }
}

// 检测访问状态
async function checkAccessibility(tab) {
  const statusEl = document.getElementById('accessStatus');

  // 检查错误页面
  if (tab.url.startsWith('chrome-error://')) {
    showProxyHint('网站无法访问');
    return;
  }

  // 检查页面标题中的错误信息
  if (tab.title && (tab.title.includes('无法访问') || tab.title.includes('ERR_'))) {
    showProxyHint('页面加载失败');
    return;
  }

  // IP 地址提示
  if (isIP) {
    statusEl.innerHTML = `
      <div style="background: #e0e7ff; color: #3730a3; font-size: 12px; margin-top: 8px; padding: 8px 10px; border-radius: 4px; border-left: 3px solid #6366f1; font-weight: 500;">
        ℹ️ IP 地址将使用 IP-CIDR 规则
      </div>
    `;
    return;
  }

  statusEl.innerHTML = '<div style="background: #f3f4f6; color: #6b7280; font-size: 12px; margin-top: 8px; padding: 8px 10px; border-radius: 4px; border-left: 3px solid #9ca3af; font-weight: 500;">🔍 检测连接状态...</div>';

  try {
    // 方案1: 先尝试使用 fetch 快速检测 (更快但可能遇到 CORS)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    await fetch(`https://${currentDomain}`, {
      method: 'HEAD',
      mode: 'no-cors',
      signal: controller.signal
    });

    clearTimeout(timeout);
    statusEl.innerHTML = `
      <div style="background: #d1fae5; color: #065f46; font-size: 12px; margin-top: 8px; padding: 8px 10px; border-radius: 4px; border-left: 3px solid #10b981; font-weight: 500;">
        ✓ 网站可正常访问
      </div>
    `;
  } catch (e) {
    // 如果 fetch 失败,输出错误到控制台方便排查
    console.log('[可达性检测] fetch 失败:', {
      domain: currentDomain,
      error: e.message,
      errorType: e.name,
      errorStack: e.stack
    });

    // 使用备用方案: Chrome API 检测页面状态
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          return {
            loaded: document.readyState === 'complete' || document.readyState === 'interactive',
            hasContent: document.body && document.body.children.length > 0
          };
        }
      }).catch(() => null);

      if (results && results[0]?.result?.loaded && results[0]?.result?.hasContent) {
        // 页面已正常加载,但 fetch 失败,可能是 CORS 限制
        console.log('[可达性检测] 备用方案检测成功,页面已正常加载');
        statusEl.innerHTML = `
          <div style="background: #d1fae5; color: #065f46; font-size: 12px; margin-top: 8px; padding: 8px 10px; border-radius: 4px; border-left: 3px solid #10b981; font-weight: 500;">
            ✓ 网站可正常访问
          </div>
        `;
      } else {
        // 页面加载失败
        console.log('[可达性检测] 备用方案检测失败,页面未正常加载');
        showProxyHint(e.name === 'AbortError' ? '连接超时' : '网络错误');
      }
    } catch (scriptError) {
      // 如果两种方法都失败,根据 tab 状态判断
      console.log('[可达性检测] 备用方案执行失败:', scriptError.message);
      if (tab.status === 'complete') {
        statusEl.innerHTML = `
          <div style="background: #fef3c7; color: #92400e; font-size: 12px; margin-top: 8px; padding: 8px 10px; border-radius: 4px; border-left: 3px solid #f59e0b; font-weight: 500;">
            ⚠️ 无法检测访问状态
          </div>
        `;
      } else {
        showProxyHint('页面加载失败');
      }
    }
  }
}

// 显示代理建议
function showProxyHint(reason) {
  const statusEl = document.getElementById('accessStatus');
  statusEl.innerHTML = `
    <div style="background: #fef2f2; padding: 10px; border-radius: 6px; margin-top: 8px;">
      <div style="color: #dc2626; font-size: 12px; margin-bottom: 8px;">
        ⚠️ ${reason}，建议使用代理
      </div>
      <button id="quickProxy" style="width: 100%; padding: 8px; background: #10b981; color: white; border: none; border-radius: 4px; font-size: 12px; font-weight: 500; cursor: pointer;">
        一键添加到代理规则
      </button>
    </div>
  `;
  
  document.getElementById('quickProxy').onclick = () => addRule('PROXY');
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

    showStatus(`✓ 已添加，正在刷新规则集...`, 'success');

    if (mode === 'remote') {
      if (!config || !config.host) {
        showStatus('请先配置路由器信息', 'error');
        setTimeout(() => chrome.runtime.openOptionsPage(), 1500);
        return;
      }
      // 1. Add rule to router file
      const api = new OpenClashAPI(config);
      await api.addRule(domainToAdd, type, matchType);
      
      // 2. Refresh OpenClash on router
      const routerClashTarget = {
        host: config.host.split(':')[0],
        port: config.clashPort,
        secret: config.clashSecret,
      };
      await refreshRuleProviders(routerClashTarget, type, 'remote');
      
    } else { // cloudflare mode
      if (!cloudflareConfig || !cloudflareConfig.workerUrl) {
        showStatus('请先配置 Cloudflare Worker', 'error');
        setTimeout(() => chrome.runtime.openOptionsPage(), 1500);
        return;
      }

      // 1. Add rule to Cloudflare
      const api = new CloudflareAPI(cloudflareConfig);
      await api.addRule(domainToAdd, type, matchType);

      // 2. Refresh all configured Clash clients (OpenClash + Clash Verge)
      const refreshPromises = [];

      // Refresh local Clash client (Clash Verge)
      if (localClientConfig && localClientConfig.host) {
        refreshPromises.push(
          refreshRuleProviders(localClientConfig, type, 'cloudflare').catch(e =>
            console.log('Clash Verge 刷新失败:', e.message)
          )
        );
      }

      // Refresh OpenClash on router (if configured)
      if (config && config.host) {
        const routerClashTarget = {
          host: config.host.split(':')[0],
          port: config.clashPort,
          secret: config.clashSecret,
        };
        refreshPromises.push(
          refreshRuleProviders(routerClashTarget, type, 'cloudflare').catch(e =>
            console.log('OpenClash 刷新失败:', e.message)
          )
        );
      }

      // Wait for all refresh operations
      await Promise.all(refreshPromises);
    }
    
    // 3. Start countdown to refresh the page
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
  if (!targetConfig || !targetConfig.host) {
    console.log('Refresh skipped: target configuration not found.');
    return;
  }

  try {
    const { host, port, secret } = targetConfig;
    const headers = { 'Content-Type': 'application/json' };
    if (secret) headers['Authorization'] = `Bearer ${secret}`;
    
    // 根据模式使用不同的规则集名称
    let providerName;
    if (mode === 'remote') {
      providerName = type === 'PROXY' ? 'Rule-provider%20-%20Custom_Proxy' : 'Rule-provider%20-%20Custom_Direct';
    } else { // cloudflare
      providerName = type === 'PROXY' ? 'Rule-provider%20-%20Cloud_Proxy' : 'Rule-provider%20-%20Cloud_Direct';
    }
    
    const url = `http://${host}:${port}/providers/rules/${providerName}`;
    console.log(`Attempting to refresh rule provider at: ${url}`);

    await fetch(url, {
      method: 'PUT',
      headers,
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });
    
    console.log(`Successfully triggered rule refresh on ${host}:${port}`);
    showStatus(`✓ ${host} 规则集已刷新`, 'success');
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
  const { config } = await chrome.storage.local.get(['config']);
  if (!config || !config.host) {
    showStatus('请先配置路由器信息', 'error');
    return;
  }
  
  const [hostPart] = config.host.split(':');
  const port = config.clashPort || '9090';
  const ui = config.clashUI || 'zashboard';
  const secret = config.clashSecret || '';
  
  let url = '';
  switch (ui) {
    case 'yacd':
      url = `http://${hostPart}:${port}/ui/yacd/?hostname=${hostPart}&port=${port}&secret=${secret}`;
      break;
    case 'dashboard':
      url = `http://${hostPart}:${port}/ui/dashboard/?hostname=${hostPart}&port=${port}&secret=${secret}`;
      break;
    case 'razord':
      url = `http://${hostPart}:${port}/ui/razord/?host=${hostPart}&port=${port}&secret=${secret}`;
      break;
    case 'zashboard':
    default:
      url = `http://${hostPart}:${port}/ui/zashboard/?hostname=${hostPart}&port=${port}&secret=${secret}`;
      break;
  }
  
  chrome.tabs.create({ url });
};
