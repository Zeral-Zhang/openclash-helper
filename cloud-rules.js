const APP_THEME_STORAGE_KEY = 'appTheme';
const appThemeQuery = window.matchMedia('(prefers-color-scheme: light)');

function resolveAppTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  return appThemeQuery.matches ? 'light' : 'dark';
}

async function applyStoredAppTheme() {
  const stored = await chrome.storage.local.get([APP_THEME_STORAGE_KEY, 'popupTheme']);
  document.documentElement.dataset.theme = resolveAppTheme(stored[APP_THEME_STORAGE_KEY] || stored.popupTheme || 'system');
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

let directRules = '';
let proxyRules = '';
let api = null;
let currentTab = 'all';
const copyYamlButton = document.getElementById('copyYaml');
const addRuleForm = document.getElementById('addRuleForm');
const addRuleButton = document.getElementById('addRuleButton');

// 初始化
async function init() {
  const { cloudflareConfig } = await chrome.storage.local.get(['cloudflareConfig']);
  
  if (!cloudflareConfig || !cloudflareConfig.workerUrl) {
    showError('请先配置 Cloudflare Worker');
    return;
  }
  
  api = new CloudflareAPI(cloudflareConfig);
  await loadRules();
  
  // 绑定Tab切换事件
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      currentTab = this.dataset.tab;
      displayRules();
    });
  });
}

// 加载规则
async function loadRules() {
  try {
    const rules = await api.getAllRules();
    directRules = rules.direct || 'payload: []';
    proxyRules = rules.proxy || 'payload: []';
    
    displayRules();
    updateStats();
  } catch (e) {
    showError('加载规则失败: ' + e.message);
  }
}

// 显示规则列表
function displayRules() {
  const ruleList = document.getElementById('ruleList');
  const emptyState = document.getElementById('emptyState');
  
  let allRules = parseRules();
  
  // 根据Tab过滤
  if (currentTab === 'proxy') {
    allRules = allRules.filter(r => r.type === 'PROXY');
  } else if (currentTab === 'direct') {
    allRules = allRules.filter(r => r.type === 'DIRECT');
  }
  
  if (allRules.length === 0) {
    ruleList.style.display = 'none';
    emptyState.style.display = 'block';
    emptyState.textContent = currentTab === 'all' ? '暂无规则' : `暂无${currentTab === 'proxy' ? '代理' : '直连'}规则`;
    return;
  }
  
  ruleList.style.display = 'block';
  emptyState.style.display = 'none';
  
  ruleList.innerHTML = allRules.map((rule) => `
    <div class="rule-item">
      <div class="rule-info">
        <div class="rule-domain">${escapeHtml(rule.domain)}</div>
        <div class="rule-meta">
          <span class="badge ${rule.type === 'PROXY' ? 'proxy' : 'direct'}">
            ${rule.type === 'PROXY' ? '代理' : '直连'}
          </span>
          <span class="badge ${rule.matchType === 'DOMAIN-SUFFIX' ? 'suffix' : 'domain'}">
            ${rule.matchType === 'DOMAIN-SUFFIX' ? '后缀匹配' : rule.matchType === 'DOMAIN' ? '完整匹配' : rule.matchType}
          </span>
        </div>
      </div>
      <button class="btn-danger" data-type="${rule.type}" data-match="${rule.matchType}" data-domain="${escapeAttribute(rule.domain)}" style="padding: 6px 12px; font-size: 12px;">删除</button>
    </div>
  `).join('');
  
  // 绑定删除按钮事件
  document.querySelectorAll('.rule-item button').forEach(btn => {
    btn.addEventListener('click', function() {
      deleteRule(this.dataset.type, this.dataset.match, this.dataset.domain);
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

// 解析规则
function parseRules() {
  const rules = [];
  
  // 解析代理规则
  const proxyLines = proxyRules.split('\n');
  proxyLines.forEach(line => {
    const match = line.match(/^\s*-\s*([A-Z-]+),(.+)$/);
    if (match) {
      rules.push({
        type: 'PROXY',
        matchType: match[1],
        domain: match[2].trim()
      });
    }
  });
  
  // 解析直连规则
  const directLines = directRules.split('\n');
  directLines.forEach(line => {
    const match = line.match(/^\s*-\s*([A-Z-]+),(.+)$/);
    if (match) {
      rules.push({
        type: 'DIRECT',
        matchType: match[1],
        domain: match[2].trim()
      });
    }
  });
  
  return rules;
}

// 更新统计
function updateStats() {
  const rules = parseRules();
  document.getElementById('totalCount').textContent = rules.length;
  document.getElementById('proxyCount').textContent = rules.filter(r => r.type === 'PROXY').length;
  document.getElementById('directCount').textContent = rules.filter(r => r.type === 'DIRECT').length;
}

function normalizeRuleValue(matchType, rawValue) {
  let value = String(rawValue || '').trim();
  if (!value) {
    throw new Error('请输入规则内容');
  }

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      value = url.hostname || value;
    } catch (error) {}
  }

  if (matchType === 'DST-PORT') {
    value = value.replace(/[^\d]/g, '');
    if (!value) throw new Error('目标端口必须是数字');
    const port = Number(value);
    if (port < 1 || port > 65535) throw new Error('端口范围应为 1-65535');
    return String(port);
  }

  if (matchType === 'IP-CIDR') {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
      return `${value}/32`;
    }
    if (!/^[0-9a-fA-F:.]+\/\d+$/.test(value)) {
      throw new Error('IP-CIDR 需要形如 1.1.1.1/32');
    }
    return value;
  }

  value = value
    .replace(/^www\./i, matchType === 'DOMAIN-SUFFIX' ? '' : 'www.')
    .replace(/^\*\./, '')
    .replace(/^\./, '')
    .replace(/\/.*$/, '')
    .toLowerCase();

  if (!/^[a-z0-9*_.-]+$/.test(value)) {
    throw new Error('域名规则内容格式不正确');
  }

  return value;
}

function hasRuleLine(content, line) {
  const target = line.trim();
  return String(content || '').split('\n').some(item => item.trim() === target);
}

function removeRuleLine(content, line) {
  const target = line.trim();
  const nextLines = String(content || '')
    .split('\n')
    .filter(item => item.trim() !== target);
  const nextContent = nextLines.join('\n').trimEnd();
  return nextContent || 'payload: []';
}

function appendRuleLine(content, line) {
  const current = String(content || '').trimEnd();
  if (!current || current === 'payload: []' || !current.includes('payload:')) {
    return `payload:\n${line}\n`;
  }
  return `${current}\n${line}\n`;
}

async function addManualRule(event) {
  event.preventDefault();
  if (!api) {
    showStatus('请先完成 Cloudflare Worker 配置', 'error');
    return;
  }

  const type = document.getElementById('newRuleType').value;
  const matchType = document.getElementById('newMatchType').value;
  const valueInput = document.getElementById('newRuleValue');
  const originalLabel = addRuleButton.textContent;

  try {
    const value = normalizeRuleValue(matchType, valueInput.value);
    const line = `  - ${matchType},${value}`;
    const targetContent = type === 'PROXY' ? proxyRules : directRules;

    if (hasRuleLine(targetContent, line)) {
      showStatus('该规则已存在', 'error');
      return;
    }

    addRuleButton.disabled = true;
    addRuleButton.textContent = '添加中...';

    let removedOpposite = false;
    if (type === 'PROXY') {
      if (hasRuleLine(directRules, line)) {
        directRules = removeRuleLine(directRules, line);
        removedOpposite = true;
      }
      proxyRules = appendRuleLine(proxyRules, line);
    } else {
      if (hasRuleLine(proxyRules, line)) {
        proxyRules = removeRuleLine(proxyRules, line);
        removedOpposite = true;
      }
      directRules = appendRuleLine(directRules, line);
    }

    await api.saveRules(directRules, proxyRules);
    await notifyBackupChanged('cloud_rules_added');
    await loadRules();
    valueInput.value = '';

    await refreshRuleProvider(type);
    if (removedOpposite) {
      await refreshRuleProvider(type === 'PROXY' ? 'DIRECT' : 'PROXY');
    }

    showStatus(`已添加到${type === 'PROXY' ? '代理' : '直连'}规则`);
  } catch (error) {
    showStatus('添加失败: ' + error.message, 'error');
  } finally {
    addRuleButton.disabled = false;
    addRuleButton.textContent = originalLabel;
  }
}

addRuleForm.addEventListener('submit', addManualRule);

// 刷新规则
document.getElementById('refreshRules').addEventListener('click', async () => {
  showStatus('正在刷新...');
  await loadRules();
  showStatus('刷新完成');
});

// 手动刷新代理与直连规则集（触发 Clash controller 重新拉取）
document.getElementById('refreshProviders').addEventListener('click', async () => {
  const button = document.getElementById('refreshProviders');
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = '刷新中...';
  try {
    const proxyResults = await refreshConfiguredRuleProviders('PROXY');
    const directResults = await refreshConfiguredRuleProviders('DIRECT');
    const all = [...proxyResults, ...directResults];
    if (all.length === 0) {
      showStatus('未检测到可刷新的控制器，请先在配置页测试控制器', 'error');
    } else {
      const failed = all.filter(r => !r.ok);
      if (failed.length === 0) {
        showStatus('代理与直连规则集已刷新');
      } else {
        const labels = [...new Set(all.map(r => r.label))].join('、');
        showStatus('部分刷新失败（' + labels + '）: ' + failed.map(r => r.error).join('; '), 'error');
      }
    }
  } catch (error) {
    showStatus('刷新规则集失败: ' + error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
});

// 导出为文件
document.getElementById('exportYaml').addEventListener('click', () => {
  const yaml = buildYamlPreview();
  const blob = new Blob([yaml], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `openclash-rules-${Date.now()}.yaml`;
  a.click();
  URL.revokeObjectURL(url);
  
  showYaml(yaml);
  showStatus('已导出文件');
});

// 复制 YAML
copyYamlButton.addEventListener('click', async () => {
  const originalLabel = copyYamlButton.textContent;
  copyYamlButton.disabled = true;
  copyYamlButton.textContent = '复制中...';

  try {
    const yaml = buildYamlPreview();
    await navigator.clipboard.writeText(yaml);
    showYaml(yaml);
    showStatus('已复制到剪贴板');
    copyYamlButton.textContent = '✅ 已复制';
  } catch (error) {
    showStatus(`复制失败: ${error.message || '请检查剪贴板权限'}`, 'error');
    copyYamlButton.textContent = '复制失败';
  } finally {
    setTimeout(() => {
      copyYamlButton.disabled = false;
      copyYamlButton.textContent = originalLabel;
    }, 1800);
  }
});

// 显示 YAML
function showYaml(yaml) {
  document.getElementById('yamlCard').style.display = 'block';
  document.getElementById('yamlOutput').value = yaml;
}

// 显示状态
function showStatus(msg, type = 'success') {
  const status = document.getElementById('status');
  status.textContent = msg;
  status.className = `status ${type}`;
  setTimeout(() => status.className = 'status', 3000);
}

function buildPayloadYaml(rules) {
  if (!rules.length) {
    return 'payload: []';
  }

  return `payload:\n${rules.map((rule) => `  - ${rule.matchType},${rule.domain}`).join('\n')}`;
}

function buildYamlPreview() {
  const allRules = parseRules();
  const proxy = allRules.filter((rule) => rule.type === 'PROXY');
  const direct = allRules.filter((rule) => rule.type === 'DIRECT');
  return `# 代理规则\n${buildPayloadYaml(proxy)}\n\n# 直连规则\n${buildPayloadYaml(direct)}`;
}

// 显示错误
function showError(msg) {
  const emptyState = document.getElementById('emptyState');
  emptyState.innerHTML = `
    <div style="color: #dc2626; text-align: center;">
      <p style="font-size: 16px; margin-bottom: 8px;">⚠️ ${msg}</p>
      <button id="goToConfig" style="
        padding: 8px 16px;
        background: #667eea;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
      ">前往配置</button>
    </div>
  `;
  emptyState.style.display = 'block';
  document.getElementById('goToConfig').addEventListener('click', () => {
    location.href = 'config-new.html';
  });
}

function parseClashAddress(address) {
  if (!address) {
    return null;
  }

  const value = address.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return { host: url.hostname, port: url.port || null };
    } catch (error) {
      return null;
    }
  }

  const normalized = value.replace(/\/$/, '');
  const parts = normalized.split(':');
  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    return { host: parts[0], port: parts[1] };
  }

  return { host: normalized, port: null };
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
  const { config, localClientConfig, syncMode, syncTestState, activeAccessType } = await chrome.storage.local.get([
    'config',
    'localClientConfig',
    'syncMode',
    'syncTestState',
    'activeAccessType'
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

  const activeType = activeAccessType === 'openClash' || activeAccessType === 'openclash'
    ? 'openClash'
    : 'localClash';

  if (activeType === 'openClash') {
    const routerTarget = resolveControllerTarget(
      syncTestState?.cloudRouter?.ready
        ? syncTestState.cloudRouter.target
        : {
            host: config?.clashHost || config?.host?.split(':')[0],
            port: config?.clashPort || '9090',
            secret: config?.clashSecret || ''
          }
    );
    return routerTarget ? [{ target: routerTarget, mode: 'cloudflare', label: 'OpenClash' }] : [];
  }

  const externalTarget = resolveControllerTarget(
    syncTestState?.cloudExternal?.ready ? syncTestState.cloudExternal.target : localClientConfig
  );
  return externalTarget ? [{ target: externalTarget, mode: 'localClash', label: '本地 Clash' }] : [];
}

async function refreshConfiguredRuleProviders(type) {
  const targets = await getProviderRefreshTargets();
  const results = await Promise.all(targets.map(async ({ target, mode, label }) => {
    try {
      await refreshRuleProviders(target, type, mode);
      return { label, ok: true };
    } catch (error) {
      console.log(`刷新${label}规则集失败:`, error.message);
      return { label, ok: false, error: error.message };
    }
  }));
  return results;
}

async function refreshRuleProviders(targetConfig, type, mode) {
  const target = resolveControllerTarget(targetConfig);
  if (!target) {
    return;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (target.secret) {
    headers.Authorization = `Bearer ${target.secret}`;
  }

  const providerName = type === 'PROXY' ? 'OpenClashHelper_Proxy' : 'OpenClashHelper_Direct';

  const response = await fetch(`http://${target.host}:${target.port}/providers/rules/${providerName}`, {
    method: 'PUT',
    headers,
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

// 删除规则
async function deleteRule(type, matchType, domain) {
  if (!confirm('确定删除这条规则？')) return;
  
  try {
    const line = `  - ${matchType},${domain}`;
    
    if (type === 'PROXY') {
      proxyRules = proxyRules.replace(line + '\n', '').replace(line, '');
    } else {
      directRules = directRules.replace(line + '\n', '').replace(line, '');
    }

    await api.saveRules(directRules, proxyRules);
    await notifyBackupChanged('cloud_rules_deleted');
    await loadRules();
    
    // 刷新规则集
    await refreshRuleProvider(type);
    
    showStatus('删除成功');
  } catch (e) {
    showStatus('删除失败: ' + e.message);
  }
}

// 刷新规则集
async function refreshRuleProvider(type) {
  await refreshConfiguredRuleProviders(type);
}

// 清空所有
document.getElementById('clearAll').addEventListener('click', async () => {
  if (!confirm('确定清空所有规则？此操作不可恢复！')) return;
  
  try {
    directRules = 'payload: []';
    proxyRules = 'payload: []';
    await api.saveRules(directRules, proxyRules);
    await notifyBackupChanged('cloud_rules_cleared');
    await loadRules();
    document.getElementById('yamlCard').style.display = 'none';
    
    // 刷新两个规则集
    await refreshRuleProvider('PROXY');
    await refreshRuleProvider('DIRECT');
    
    showStatus('已清空所有规则');
  } catch (e) {
    showStatus('清空失败: ' + e.message);
  }
});

// 初始化
async function notifyBackupChanged(reason) {
  try {
    await chrome.runtime.sendMessage({ type: 'backup-data-changed', reason });
  } catch (error) {
    console.log('自动同步未执行:', error.message);
  }
}

init();
