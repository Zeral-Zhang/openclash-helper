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
document.getElementById('syncMode').addEventListener('change', function() {
  const mode = this.value;
  document.getElementById('cloudflareConfig').style.display = mode === 'cloudflare' ? 'block' : 'none';
  document.getElementById('remoteConfig').style.display = mode === 'remote' ? 'block' : 'none';
});

// 密码显示切换
function togglePasswordVisibility(e) {
  const input = e.target.previousElementSibling;
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  e.target.textContent = isPassword ? '🙈' : '👁️';
}

document.getElementById('togglePassword')?.addEventListener('click', togglePasswordVisibility);
document.getElementById('togglePasswordCf')?.addEventListener('click', togglePasswordVisibility);
document.getElementById('toggleApiSecret')?.addEventListener('click', togglePasswordVisibility);
document.getElementById('toggleSecret')?.addEventListener('click', togglePasswordVisibility);
document.getElementById('toggleSecretCf')?.addEventListener('click', togglePasswordVisibility);

// 加载配置
chrome.storage.local.get(['config', 'cloudflareConfig', 'syncMode'], (result) => {
  const syncMode = result.syncMode || 'cloudflare';
  document.getElementById('syncMode').value = syncMode;
  document.getElementById('cloudflareConfig').style.display = syncMode === 'cloudflare' ? 'block' : 'none';
  document.getElementById('remoteConfig').style.display = syncMode === 'remote' ? 'block' : 'none';
  
  const config = result.config || {};
  document.getElementById('host').value = config.host || '';
  document.getElementById('username').value = config.username || 'root';
  document.getElementById('password').value = config.password || '';
  document.getElementById('proxyFile').value = config.proxyFile || '/etc/openclash/rule_provider/Custom_Proxy.yaml';
  document.getElementById('directFile').value = config.directFile || '/etc/openclash/rule_provider/Custom_Direct.yaml';
  document.getElementById('clashPort').value = config.clashPort || '9090';
  document.getElementById('clashSecret').value = config.clashSecret || '';
  document.getElementById('clashUI').value = config.clashUI || 'zashboard';
  
  const cloudflareConfig = result.cloudflareConfig || {};
  document.getElementById('workerUrl').value = cloudflareConfig.workerUrl || '';
  document.getElementById('apiSecret').value = cloudflareConfig.apiSecret || '';
  document.getElementById('hostCf').value = config.host || '';
  document.getElementById('usernameCf').value = config.username || 'root';
  document.getElementById('passwordCf').value = config.password || '';
  document.getElementById('clashPortCf').value = config.clashPort || '9090';
  document.getElementById('clashSecretCf').value = config.clashSecret || '';
  document.getElementById('clashUICf').value = config.clashUI || 'zashboard';
  
  // 如果已配置 Cloudflare，显示 Clash Verge 配置
  if (cloudflareConfig.workerUrl) {
    showClashVergeMerge(cloudflareConfig.workerUrl, cloudflareConfig.proxyGroup || 'Proxy');
  }
});

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
  showStatus('statusCloudflare', '✅ 已复制到剪贴板', 'success');
};

// 测试 Cloudflare 路由器连接（同时自动获取Secret）
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

    // 自动从UCI获取Secret和端口
    showStatus('statusCf', '正在读取 OpenClash 配置...', 'success');
    let clashSecret = document.getElementById('clashSecretCf').value;
    let clashPort = document.getElementById('clashPortCf').value || '9090';

    if (!clashSecret) {
      try {
        const secretResult = await api.exec(`uci get openclash.config.dashboard_password 2>/dev/null || echo ""`);
        if (secretResult && secretResult.trim()) {
          clashSecret = secretResult.trim();
          document.getElementById('clashSecretCf').value = clashSecret;
        }
      } catch (e) {}
    }

    try {
      const portResult = await api.exec(`uci get openclash.config.cn_port 2>/dev/null || echo "9090"`);
      if (portResult && portResult.trim()) {
        clashPort = portResult.trim();
        document.getElementById('clashPortCf').value = clashPort;
      }
    } catch (e) {}

    showStatus('statusCf', clashSecret ? '✅ 连接成功，已自动获取 Secret' : '✅ 连接成功', 'success');
  } catch (e) {
    showStatus('statusCf', '连接失败: ' + e.message, 'error');
  }
};

// 测试 Clash API 连接（云端模式）
document.getElementById('testClashApiCf').onclick = async () => {
  const host = document.getElementById('hostCf').value;
  let clashPort = document.getElementById('clashPortCf').value || '9090';
  let clashSecret = document.getElementById('clashSecretCf').value;

  if (!host) {
    showStatus('statusClashApiCf', '请先填写路由器地址', 'error');
    return;
  }

  showStatus('statusClashApiCf', '正在测试 Clash API...', 'success');

  try {
    const [hostPart] = host.split(':');
    const headers = {};
    if (clashSecret) {
      headers['Authorization'] = `Bearer ${clashSecret}`;
    }

    console.log('[测试 Clash API] 请求信息:', {
      url: `http://${hostPart}:${clashPort}/version`,
      hasSecret: !!clashSecret
    });

    const response = await fetch(`http://${hostPart}:${clashPort}/version`, {
      headers,
      signal: AbortSignal.timeout(5000)
    });

    if (response.status === 401) {
      showStatus('statusClashApiCf', '❌ 认证失败，Secret（密钥）错误', 'error');
      return;
    }

    if (!response.ok) {
      showStatus('statusClashApiCf', `❌ 连接失败 (HTTP ${response.status})`, 'error');
      return;
    }

    const data = await response.json();
    showStatus('statusClashApiCf', `✅ 连接成功！Clash 版本: ${data.version || data.premium ? 'Premium' : 'Unknown'}`, 'success');
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      showStatus('statusClashApiCf', '❌ 连接超时，请检查路由器地址和端口', 'error');
    } else if (e.message.includes('fetch') || e.message.includes('NetworkError')) {
      showStatus('statusClashApiCf', '❌ 网络错误，无法连接到 Clash API', 'error');
    } else {
      showStatus('statusClashApiCf', '❌ 测试失败: ' + e.message, 'error');
    }
    console.error('[测试 Clash API] 失败:', e);
  }
};

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
      showStatus('statusCf', '❌ Clash API 认证失败，请检查 OpenClash 外部控制密钥', 'error');
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

    // 自动从UCI获取Secret和端口
    showStatus('statusRemote', '正在读取 OpenClash 配置...', 'success');
    let clashSecret = document.getElementById('clashSecret').value;
    let clashPort = document.getElementById('clashPort').value || '9090';

    if (!clashSecret) {
      try {
        const secretResult = await api.exec(`uci get openclash.config.dashboard_password 2>/dev/null || echo ""`);
        if (secretResult && secretResult.trim()) {
          clashSecret = secretResult.trim();
          document.getElementById('clashSecret').value = clashSecret;
        }
      } catch (e) {}
    }

    try {
      const portResult = await api.exec(`uci get openclash.config.cn_port 2>/dev/null || echo "9090"`);
      if (portResult && portResult.trim()) {
        clashPort = portResult.trim();
        document.getElementById('clashPort').value = clashPort;
      }
    } catch (e) {}

    showStatus('statusRemote', clashSecret ? '✅ 连接成功，已自动获取 Secret' : '✅ 连接成功', 'success');
  } catch (e) {
    showStatus('statusRemote', '连接失败: ' + e.message, 'error');
  }
};

// 测试 Clash API 连接（远程模式）
document.getElementById('testClashApi').onclick = async () => {
  const host = document.getElementById('host').value;
  let clashPort = document.getElementById('clashPort').value || '9090';
  let clashSecret = document.getElementById('clashSecret').value;

  if (!host) {
    showStatus('statusClashApi', '请先填写路由器地址', 'error');
    return;
  }

  showStatus('statusClashApi', '正在测试 Clash API...', 'success');

  try {
    const [hostPart] = host.split(':');
    const headers = {};
    if (clashSecret) {
      headers['Authorization'] = `Bearer ${clashSecret}`;
    }

    console.log('[测试 Clash API] 请求信息:', {
      url: `http://${hostPart}:${clashPort}/version`,
      hasSecret: !!clashSecret
    });

    const response = await fetch(`http://${hostPart}:${clashPort}/version`, {
      headers,
      signal: AbortSignal.timeout(5000)
    });

    if (response.status === 401) {
      showStatus('statusClashApi', '❌ 认证失败，Secret（密钥）错误', 'error');
      return;
    }

    if (!response.ok) {
      showStatus('statusClashApi', `❌ 连接失败 (HTTP ${response.status})`, 'error');
      return;
    }

    const data = await response.json();
    showStatus('statusClashApi', `✅ 连接成功！Clash 版本: ${data.version || data.premium ? 'Premium' : 'Unknown'}`, 'success');
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      showStatus('statusClashApi', '❌ 连接超时，请检查路由器地址和端口', 'error');
    } else if (e.message.includes('fetch') || e.message.includes('NetworkError')) {
      showStatus('statusClashApi', '❌ 网络错误，无法连接到 Clash API', 'error');
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
    
    if (!response.ok) throw new Error('无法连接 Clash API，请确认 OpenClash 已启动');
    
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
      showStatus('statusAutoConfig', '❌ 无法连接 Clash API，请确认 OpenClash 已启动且端口正确', 'error');
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

// 保存配置
document.getElementById('save').onclick = async () => {
  const syncMode = document.getElementById('syncMode').value;
  
  if (syncMode === 'cloudflare') {
    const cloudflareConfig = {
      workerUrl: document.getElementById('workerUrl').value,
      apiSecret: document.getElementById('apiSecret').value,
      proxyGroup: document.getElementById('cfProxyGroup').value || ''
    };
    const config = {
      host: document.getElementById('hostCf').value,
      username: document.getElementById('usernameCf').value,
      password: document.getElementById('passwordCf').value,
      clashPort: document.getElementById('clashPortCf').value || '9090',
      clashSecret: document.getElementById('clashSecretCf').value,
      clashUI: document.getElementById('clashUICf').value
    };
    await chrome.storage.local.set({ cloudflareConfig, config, syncMode });
  } else {
    const config = {
      host: document.getElementById('host').value,
      username: document.getElementById('username').value,
      password: document.getElementById('password').value,
      proxyFile: document.getElementById('proxyFile').value,
      directFile: document.getElementById('directFile').value,
      clashPort: document.getElementById('clashPort').value || '9090',
      clashSecret: document.getElementById('clashSecret').value,
      clashUI: document.getElementById('clashUI').value,
      proxyGroup: document.getElementById('proxyGroup').value
    };
    await chrome.storage.local.set({ config, syncMode });
  }
  
  showStatus('statusSave', '✅ 配置已保存', 'success');
};

function showStatus(elementId, msg, type) {
  const status = document.getElementById(elementId);
  status.textContent = msg;
  status.className = 'status ' + type;
  if (type === 'success' && !msg.includes('⏳') && !msg.includes('正在')) {
    setTimeout(() => status.className = 'status', 5000);
  }
}
