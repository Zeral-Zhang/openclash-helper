importScripts('api.js', 'cloudflare-api.js', 'backup.js');

function extractRootDomain(domain) {
  const parts = domain.split('.');
  if (parts.length < 2) {
    return domain;
  }

  const secondLevelTLDs = ['co', 'com', 'net', 'org', 'gov', 'edu', 'ac'];
  if (parts.length >= 3 && secondLevelTLDs.includes(parts[parts.length - 2])) {
    return parts.slice(-3).join('.');
  }

  return parts.slice(-2).join('.');
}

function ensureContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'addDirect',
      title: '添加到直连规则',
      contexts: ['page']
    });

    chrome.contextMenus.create({
      id: 'addProxy',
      title: '添加到代理规则',
      contexts: ['page']
    });
  });
}

async function showNotification(message) {
  try {
    if (!chrome.notifications) {
      return;
    }

    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'OpenClash 规则助手',
      message
    });
  } catch (error) {
    console.log('通知发送失败:', error.message);
  }
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
  await Promise.all(targets.map(({ target, mode, label }) =>
    refreshRuleProviders(target, type, mode).catch(error => {
      console.log(`刷新${label}规则集失败:`, error.message);
    })
  ));
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

  const providerName = mode === 'remote'
    ? (type === 'PROXY' ? 'Rule-provider%20-%20Custom_Proxy' : 'Rule-provider%20-%20Custom_Direct')
    : mode === 'localClash'
      ? (type === 'PROXY' ? 'OpenClashHelper_Proxy' : 'OpenClashHelper_Direct')
      : (type === 'PROXY' ? 'Rule-provider%20-%20Cloud_Proxy' : 'Rule-provider%20-%20Cloud_Direct');

  const response = await fetch(`http://${target.host}:${target.port}/providers/rules/${providerName}`, {
    method: 'PUT',
    headers,
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

function normalizeConnectionValue(value) {
  return String(value || '').trim().toLowerCase().replace(/\.$/, '');
}

function connectionMatchesRule(connection, ruleContext) {
  const metadata = connection?.metadata || {};
  const host = normalizeConnectionValue(metadata.host);
  const destinationIP = normalizeConnectionValue(metadata.destinationIP);
  const destinationPort = String(metadata.destinationPort || '');
  const rulePayload = normalizeConnectionValue(connection?.rulePayload);
  const value = normalizeConnectionValue(ruleContext?.value);

  if (!value) return false;

  if (ruleContext.matchType === 'IP-CIDR') {
    const targetIP = value.split('/')[0];
    return destinationIP === targetIP || host === targetIP;
  }

  if (ruleContext.matchType === 'DST-PORT') {
    return destinationPort === value;
  }

  if (ruleContext.matchType === 'DOMAIN') {
    return host === value || rulePayload === value;
  }

  const matchesDomainSuffix = candidate =>
    candidate === value || candidate.endsWith(`.${value}`);

  return matchesDomainSuffix(host) || matchesDomainSuffix(rulePayload);
}

// 只断开与刚添加规则匹配的连接，确保后续请求按最新规则重新建连
async function closeMatchingClashConnections(ruleContext) {
  const targets = await getProviderRefreshTargets();
  const counts = await Promise.all(targets.map(async ({ target, label }) => {
    const resolvedTarget = resolveControllerTarget(target);
    if (!resolvedTarget) return 0;

    const headers = {};
    if (resolvedTarget.secret) headers['Authorization'] = `Bearer ${resolvedTarget.secret}`;

    try {
      const response = await fetch(`http://${resolvedTarget.host}:${resolvedTarget.port}/connections`, {
        headers,
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const connections = (data.connections || []).filter(connection =>
        connection.id && connectionMatchesRule(connection, ruleContext)
      );

      await Promise.all(connections.map(connection =>
        fetch(`http://${resolvedTarget.host}:${resolvedTarget.port}/connections/${encodeURIComponent(connection.id)}`, {
          method: 'DELETE',
          headers,
          signal: AbortSignal.timeout(5000)
        }).then(deleteResponse => {
          if (!deleteResponse.ok) {
            throw new Error(`HTTP ${deleteResponse.status}`);
          }
        })
      ));

      return connections.length;
    } catch (error) {
      console.log(`断开${label}匹配连接失败:`, error.message);
      return 0;
    }
  }));

  return counts.reduce((total, count) => total + count, 0);
}

async function addRuleByMode(domain, type) {
  const rootDomain = extractRootDomain(domain);
  const { config, cloudflareConfig, localClientConfig, syncMode } = await chrome.storage.local.get([
    'config',
    'cloudflareConfig',
    'localClientConfig',
    'syncMode'
  ]);

  const mode = syncMode || 'cloudflare';

  if (mode === 'remote') {
    if (!config?.host) {
      throw new Error('请先配置路由器信息');
    }

    const remoteApi = new OpenClashAPI(config);
    await remoteApi.addRule(rootDomain, type, 'DOMAIN-SUFFIX');
    await refreshConfiguredRuleProviders(type);
  } else {
    if (!cloudflareConfig?.workerUrl) {
      throw new Error('请先配置 Cloudflare Worker');
    }

    const cloudApi = new CloudflareAPI(cloudflareConfig);
    await cloudApi.addRule(rootDomain, type, 'DOMAIN-SUFFIX');
    await refreshConfiguredRuleProviders(type);
  }

  await closeMatchingClashConnections({
    matchType: 'DOMAIN-SUFFIX',
    value: rootDomain
  });

  await OpenClashBackup.markLocalChange('context_menu_add_rule');
  await OpenClashBackup.autoSyncIfEnabled('context_menu_add_rule').catch(error => {
    console.log('自动同步失败:', error.message);
  });

  return rootDomain;
}

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenus();
  OpenClashBackup.configureAutoSyncAlarm().catch(error => {
    console.log('初始化自动同步失败:', error.message);
  });
});

chrome.runtime.onStartup.addListener(() => {
  OpenClashBackup.configureAutoSyncAlarm().catch(error => {
    console.log('启动自动同步失败:', error.message);
  });
  OpenClashBackup.autoSyncIfEnabled('startup').catch(error => {
    console.log('启动同步失败:', error.message);
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.webdavConfig) {
    OpenClashBackup.configureAutoSyncAlarm().catch(error => {
      console.log('更新自动同步定时器失败:', error.message);
    });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== OpenClashBackup.AUTO_SYNC_ALARM_NAME) {
    return;
  }

  OpenClashBackup.autoSyncIfEnabled('alarm').catch(error => {
    console.log('定时同步失败:', error.message);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'backup-data-changed') {
    return false;
  }

  (async () => {
    await OpenClashBackup.markLocalChange(message.reason || 'manual_change');
    const result = await OpenClashBackup.autoSyncIfEnabled(message.reason || 'manual_change').catch(error => ({
      skipped: false,
      error: error.message
    }));
    sendResponse({ ok: true, result });
  })().catch((error) => {
    sendResponse({ ok: false, error: error.message });
  });

  return true;
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.url || !info.menuItemId) {
    return;
  }

  try {
    const domain = new URL(tab.url).hostname;
    const type = info.menuItemId === 'addDirect' ? 'DIRECT' : 'PROXY';
    const addedDomain = await addRuleByMode(domain, type);
    await showNotification(`已添加 ${addedDomain} 到${type === 'PROXY' ? '代理' : '直连'}规则`);
  } catch (error) {
    if (error.message === 'RULE_EXISTS') {
      await showNotification('该规则已存在');
      return;
    }

    console.error('右键添加规则失败:', error);
    await showNotification(`添加失败: ${error.message}`);
  }
});
