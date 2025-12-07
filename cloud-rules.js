let directRules = '';
let proxyRules = '';
let api = null;
let currentTab = 'all';

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
        <div class="rule-domain">${rule.domain}</div>
        <div class="rule-meta">
          <span class="badge ${rule.type === 'PROXY' ? 'proxy' : 'direct'}">
            ${rule.type === 'PROXY' ? '代理' : '直连'}
          </span>
          <span class="badge ${rule.matchType === 'DOMAIN-SUFFIX' ? 'suffix' : 'domain'}">
            ${rule.matchType === 'DOMAIN-SUFFIX' ? '后缀匹配' : rule.matchType === 'DOMAIN' ? '完整匹配' : rule.matchType}
          </span>
        </div>
      </div>
      <button class="btn-danger" data-type="${rule.type}" data-match="${rule.matchType}" data-domain="${rule.domain}" style="padding: 6px 12px; font-size: 12px;">删除</button>
    </div>
  `).join('');
  
  // 绑定删除按钮事件
  document.querySelectorAll('.rule-item button').forEach(btn => {
    btn.addEventListener('click', function() {
      deleteRule(this.dataset.type, this.dataset.match, this.dataset.domain);
    });
  });
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

// 刷新规则
document.getElementById('refreshRules').addEventListener('click', async () => {
  showStatus('正在刷新...');
  await loadRules();
  showStatus('刷新完成');
});

// 导出为文件
document.getElementById('exportYaml').addEventListener('click', () => {
  const yaml = `# 代理规则\n${proxyRules}\n\n# 直连规则\n${directRules}`;
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
document.getElementById('copyYaml').addEventListener('click', async () => {
  const yaml = `# 代理规则\n${proxyRules}\n\n# 直连规则\n${directRules}`;
  await navigator.clipboard.writeText(yaml);
  showYaml(yaml);
  showStatus('已复制到剪贴板');
});

// 显示 YAML
function showYaml(yaml) {
  document.getElementById('yamlCard').style.display = 'block';
  document.getElementById('yamlOutput').value = yaml;
}

// 显示状态
function showStatus(msg) {
  const status = document.getElementById('status');
  status.textContent = msg;
  status.className = 'status success';
  setTimeout(() => status.className = 'status', 3000);
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
  try {
    const { config } = await chrome.storage.local.get(['config']);
    if (!config || !config.host) return;
    
    const [hostPart] = config.host.split(':');
    const port = config.clashPort || '9090';
    const secret = config.clashSecret || '';
    const headers = { 'Content-Type': 'application/json' };
    if (secret) headers['Authorization'] = `Bearer ${secret}`;
    
    const providerName = type === 'PROXY' ? 'Rule-provider%20-%20Cloud_Proxy' : 'Rule-provider%20-%20Cloud_Direct';
    await fetch(`http://${hostPart}:${port}/providers/rules/${providerName}`, {
      method: 'PUT',
      headers
    });
  } catch (e) {
    console.log('刷新规则集失败:', e.message);
  }
}

// 清空所有
document.getElementById('clearAll').addEventListener('click', async () => {
  if (!confirm('确定清空所有规则？此操作不可恢复！')) return;
  
  try {
    directRules = 'payload: []';
    proxyRules = 'payload: []';
    await api.saveRules(directRules, proxyRules);
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
init();
