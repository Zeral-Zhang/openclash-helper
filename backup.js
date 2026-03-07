(function(global) {
  const BACKUP_SCHEMA_VERSION = 1;
  const AUTO_SYNC_ALARM_NAME = 'webdavAutoSync';
  const DEFAULT_AUTO_SYNC_INTERVAL = 30;
  const BACKUP_FOLDER_NAME = 'open-clash-helper';
  const BACKUP_FILE_NAME = 'open-clash-helper-backup.json';
  const STORAGE_KEYS = [
    'config',
    'cloudflareConfig',
    'localClientConfig',
    'syncMode',
    'useBase64',
    'webdavConfig',
    'backupState'
  ];

  function nowIso() {
    return new Date().toISOString();
  }

  function createDefaultBackupState() {
    return {
      localUpdatedAt: '',
      lastChangeReason: 'initial'
    };
  }

  function normalizeYaml(content, emptyValue) {
    if (typeof content === 'string' && content.trim()) {
      return content;
    }
    return emptyValue;
  }

  function encodeBasicAuth(username, password) {
    return btoa(unescape(encodeURIComponent(`${username}:${password}`)));
  }

  function trimTrailingSlash(value) {
    return value.replace(/\/+$/, '');
  }

  function joinUrl(baseUrl, segment) {
    return `${trimTrailingSlash(baseUrl)}/${segment.replace(/^\/+/, '')}`;
  }

  function normalizeWebDAVBaseUrl(rawUrl = '') {
    let value = (rawUrl || '').trim();
    if (!value) {
      return '';
    }

    value = trimTrailingSlash(value);

    if (value.endsWith('.json')) {
      value = value.slice(0, value.lastIndexOf('/'));
    }

    if (value.endsWith(`/${BACKUP_FOLDER_NAME}`)) {
      value = value.slice(0, -(`/${BACKUP_FOLDER_NAME}`).length);
    }

    return value;
  }

  function buildWebDAVConfig(config = {}) {
    const baseUrl = normalizeWebDAVBaseUrl(config.baseUrl || config.fileUrl || '');
    return {
      baseUrl,
      fileUrl: baseUrl,
      username: config.username || '',
      password: config.password || '',
      autoSync: Boolean(config.autoSync),
      autoSyncInterval: Number(config.autoSyncInterval) || DEFAULT_AUTO_SYNC_INTERVAL
    };
  }

  function ensureSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error('备份文件格式无效');
    }

    if (snapshot.source !== 'openclash-helper') {
      throw new Error('不是 OpenClash 助手备份文件');
    }

    if (!snapshot.data || typeof snapshot.data !== 'object') {
      throw new Error('备份文件缺少数据内容');
    }

    return snapshot;
  }

  async function getStoredState() {
    const stored = await chrome.storage.local.get(STORAGE_KEYS);
    return {
      config: stored.config || {},
      cloudflareConfig: stored.cloudflareConfig || {},
      localClientConfig: stored.localClientConfig || {},
      syncMode: stored.syncMode || 'cloudflare',
      useBase64: stored.useBase64,
      webdavConfig: buildWebDAVConfig(stored.webdavConfig),
      backupState: stored.backupState || createDefaultBackupState()
    };
  }

  async function getRemoteRuleSnapshot(state) {
    const rules = {};

    if (state.config && state.config.host && state.config.proxyFile && state.config.directFile) {
      try {
        const remoteApi = new OpenClashAPI(state.config);
        const remoteRules = await remoteApi.getAllRules();
        rules.remote = {
          available: true,
          fetchedAt: nowIso(),
          proxy: normalizeYaml(remoteRules.proxy, 'payload:\n'),
          direct: normalizeYaml(remoteRules.direct, 'payload:\n')
        };
      } catch (error) {
        rules.remote = {
          available: false,
          fetchedAt: nowIso(),
          error: error.message
        };
      }
    }

    if (state.cloudflareConfig && state.cloudflareConfig.workerUrl && state.cloudflareConfig.apiSecret) {
      try {
        const cloudApi = new CloudflareAPI(state.cloudflareConfig);
        const cloudRules = await cloudApi.getAllRules();
        rules.cloudflare = {
          available: true,
          fetchedAt: nowIso(),
          proxy: normalizeYaml(cloudRules.proxy, 'payload: []'),
          direct: normalizeYaml(cloudRules.direct, 'payload: []')
        };
      } catch (error) {
        rules.cloudflare = {
          available: false,
          fetchedAt: nowIso(),
          error: error.message
        };
      }
    }

    return rules;
  }

  class WebDAVClient {
    constructor(config) {
      this.config = buildWebDAVConfig(config);
      if (!this.config.baseUrl) {
        throw new Error('请先填写 WebDAV 目录地址');
      }

      this.baseUrl = this.config.baseUrl;
      this.backupDirUrl = joinUrl(this.baseUrl, BACKUP_FOLDER_NAME);
      this.backupFileUrl = joinUrl(this.backupDirUrl, BACKUP_FILE_NAME);
    }

    createHeaders(extraHeaders = {}) {
      const headers = new Headers(extraHeaders);
      if (this.config.username || this.config.password) {
        headers.set('Authorization', `Basic ${encodeBasicAuth(this.config.username, this.config.password)}`);
      }
      return headers;
    }

    async requestTo(url, method, options = {}) {
      return fetch(url, {
        method,
        headers: this.createHeaders(options.headers),
        body: options.body,
        cache: 'no-store'
      });
    }

    async request(method, options = {}) {
      return this.requestTo(this.backupFileUrl, method, options);
    }

    async checkBaseDirectory() {
      const response = await this.requestTo(this.baseUrl, 'GET', {
        headers: { Accept: 'text/plain,application/json,*/*' }
      });

      if (response.ok || response.status === 207 || response.status === 405) {
        return true;
      }

      throw new Error(`WebDAV 目录不可访问 (${response.status})`);
    }

    async ensureBackupDirectory() {
      const existing = await this.requestTo(this.backupDirUrl, 'GET', {
        headers: { Accept: 'text/plain,application/json,*/*' }
      });

      if (existing.ok || existing.status === 207 || existing.status === 405) {
        return { created: false };
      }

      if (existing.status !== 404) {
        throw new Error(`检查备份目录失败 (${existing.status})`);
      }

      const created = await this.requestTo(this.backupDirUrl, 'MKCOL');
      if (created.ok || created.status === 201) {
        return { created: true };
      }

      if (created.status === 405) {
        return { created: false };
      }

      if (created.status === 409) {
        throw new Error('WebDAV 基础目录不存在，无法创建 open-clash-helper 子目录');
      }

      throw new Error(`创建备份目录失败 (${created.status})`);
    }

    async testConnection() {
      await this.checkBaseDirectory();

      let folderReady = false;
      let fileExists = false;

      try {
        await this.ensureBackupDirectory();
        folderReady = true;
      } catch (error) {
        throw error;
      }

      const fileResponse = await this.request('GET', {
        headers: { Accept: 'application/json' }
      });

      if (fileResponse.ok) {
        fileExists = true;
      } else if (fileResponse.status !== 404) {
        throw new Error(`检测备份文件失败 (${fileResponse.status})`);
      }

      return {
        ok: true,
        exists: fileExists,
        folderReady,
        backupDirUrl: this.backupDirUrl,
        backupFileUrl: this.backupFileUrl
      };
    }

    async downloadSnapshot() {
      await this.ensureBackupDirectory();

      const response = await this.request('GET', {
        headers: { Accept: 'application/json' }
      });

      if (response.status === 404) {
        const error = new Error('WEBDAV_FILE_NOT_FOUND');
        error.code = 'WEBDAV_FILE_NOT_FOUND';
        throw error;
      }

      if (!response.ok) {
        throw new Error(`下载 WebDAV 备份失败 (${response.status})`);
      }

      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new Error('WebDAV 备份文件不是合法 JSON');
      }
    }

    async uploadSnapshot(snapshot) {
      await this.ensureBackupDirectory();

      const response = await this.request('PUT', {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(snapshot, null, 2)
      });

      if (!response.ok) {
        throw new Error(`上传 WebDAV 备份失败 (${response.status})`);
      }

      return {
        ok: true,
        backupDirUrl: this.backupDirUrl,
        backupFileUrl: this.backupFileUrl
      };
    }
  }

  async function createSnapshot(options = {}) {
    const state = await getStoredState();
    const exportedAt = nowIso();
    const snapshot = {
      source: 'openclash-helper',
      version: BACKUP_SCHEMA_VERSION,
      exportedAt,
      updatedAt: state.backupState.localUpdatedAt || exportedAt,
      syncMode: state.syncMode,
      data: {
        config: state.config,
        cloudflareConfig: state.cloudflareConfig,
        localClientConfig: state.localClientConfig,
        syncMode: state.syncMode,
        useBase64: state.useBase64,
        webdavConfig: state.webdavConfig
      },
      rules: {}
    };

    if (options.includeRules !== false) {
      snapshot.rules = await getRemoteRuleSnapshot(state);
    }

    return snapshot;
  }

  async function applySnapshot(snapshot, options = {}) {
    const validSnapshot = ensureSnapshot(snapshot);
    const currentState = await getStoredState();
    const appliedAt = nowIso();
    const nextWebDAVConfig = options.preserveWebDAVConfig
      ? currentState.webdavConfig
      : buildWebDAVConfig(validSnapshot.data.webdavConfig);

    const storagePayload = {
      config: validSnapshot.data.config || {},
      cloudflareConfig: validSnapshot.data.cloudflareConfig || {},
      localClientConfig: validSnapshot.data.localClientConfig || {},
      syncMode: validSnapshot.data.syncMode || validSnapshot.syncMode || 'cloudflare',
      webdavConfig: nextWebDAVConfig,
      backupState: {
        ...(currentState.backupState || {}),
        localUpdatedAt: validSnapshot.updatedAt || appliedAt,
        lastImportedAt: appliedAt,
        lastChangeReason: options.changeReason || 'snapshot_imported'
      }
    };

    if (typeof validSnapshot.data.useBase64 !== 'undefined') {
      storagePayload.useBase64 = validSnapshot.data.useBase64;
    }

    await chrome.storage.local.set(storagePayload);

    const summary = {
      restored: [],
      warnings: []
    };

    if (options.restoreRules === false) {
      return summary;
    }

    if (validSnapshot.rules?.remote?.available) {
      const remoteConfig = validSnapshot.data.config || {};
      if (remoteConfig.host && remoteConfig.proxyFile && remoteConfig.directFile) {
        try {
          const remoteApi = new OpenClashAPI(remoteConfig);
          await remoteApi.saveRules(
            normalizeYaml(validSnapshot.rules.remote.proxy, 'payload:\n'),
            normalizeYaml(validSnapshot.rules.remote.direct, 'payload:\n')
          );
          summary.restored.push('remote');
        } catch (error) {
          summary.warnings.push(`恢复路由器规则失败: ${error.message}`);
        }
      } else {
        summary.warnings.push('备份中缺少可用的路由器连接信息，已跳过路由器规则恢复');
      }
    }

    if (validSnapshot.rules?.cloudflare?.available) {
      const cloudConfig = validSnapshot.data.cloudflareConfig || {};
      if (cloudConfig.workerUrl && cloudConfig.apiSecret) {
        try {
          const cloudApi = new CloudflareAPI(cloudConfig);
          await cloudApi.saveRules(
            normalizeYaml(validSnapshot.rules.cloudflare.direct, 'payload: []'),
            normalizeYaml(validSnapshot.rules.cloudflare.proxy, 'payload: []')
          );
          summary.restored.push('cloudflare');
        } catch (error) {
          summary.warnings.push(`恢复 Cloudflare 规则失败: ${error.message}`);
        }
      } else {
        summary.warnings.push('备份中缺少可用的 Cloudflare 配置，已跳过云端规则恢复');
      }
    }

    return summary;
  }

  async function updateBackupState(patch) {
    const state = await getStoredState();
    const nextState = {
      ...(state.backupState || createDefaultBackupState()),
      ...patch
    };
    await chrome.storage.local.set({ backupState: nextState });
    return nextState;
  }

  async function markLocalChange(reason) {
    return updateBackupState({
      localUpdatedAt: nowIso(),
      lastChangeReason: reason || 'manual_change'
    });
  }

  async function configureAutoSyncAlarm() {
    if (!chrome.alarms) {
      return;
    }

    const state = await getStoredState();
    const { autoSync, autoSyncInterval } = state.webdavConfig;

    await chrome.alarms.clear(AUTO_SYNC_ALARM_NAME);

    if (!autoSync || !state.webdavConfig.baseUrl) {
      return;
    }

    chrome.alarms.create(AUTO_SYNC_ALARM_NAME, {
      periodInMinutes: Math.max(5, Number(autoSyncInterval) || DEFAULT_AUTO_SYNC_INTERVAL)
    });
  }

  async function pushToWebDAV(webdavConfigOverride) {
    const state = await getStoredState();
    state.webdavConfig = buildWebDAVConfig(webdavConfigOverride || state.webdavConfig);
    const client = new WebDAVClient(state.webdavConfig);
    const snapshot = await createSnapshot({ includeRules: true });
    const uploadResult = await client.uploadSnapshot(snapshot);
    await updateBackupState({
      lastSyncedAt: nowIso(),
      lastSyncAction: 'push',
      lastSyncStatus: 'success',
      lastSyncMessage: `已上传到 ${uploadResult.backupFileUrl}`
    });
    return snapshot;
  }

  async function pullFromWebDAV(options = {}) {
    const state = await getStoredState();
    state.webdavConfig = buildWebDAVConfig(options.webdavConfig || state.webdavConfig);
    const client = new WebDAVClient(state.webdavConfig);
    const remoteSnapshot = ensureSnapshot(await client.downloadSnapshot());
    const result = await applySnapshot(remoteSnapshot, {
      restoreRules: options.restoreRules !== false,
      preserveWebDAVConfig: options.preserveWebDAVConfig === true,
      changeReason: 'webdav_pull'
    });
    await updateBackupState({
      lastSyncedAt: nowIso(),
      lastSyncAction: 'pull',
      lastSyncStatus: 'success',
      lastSyncMessage: `已从 ${client.backupFileUrl} 恢复`
    });
    return {
      snapshot: remoteSnapshot,
      result
    };
  }

  function getSnapshotTimestamp(snapshot) {
    const timestamp = Date.parse(snapshot?.updatedAt || snapshot?.exportedAt || '');
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  async function syncWithWebDAV(webdavConfigOverride) {
    const state = await getStoredState();
    state.webdavConfig = buildWebDAVConfig(webdavConfigOverride || state.webdavConfig);
    const client = new WebDAVClient(state.webdavConfig);
    const localSnapshot = await createSnapshot({ includeRules: true });
    const localTimestamp = Date.parse(state.backupState?.localUpdatedAt || '') || 0;

    let remoteSnapshot = null;
    try {
      remoteSnapshot = ensureSnapshot(await client.downloadSnapshot());
    } catch (error) {
      if (error.code !== 'WEBDAV_FILE_NOT_FOUND' && error.message !== 'WEBDAV_FILE_NOT_FOUND') {
        throw error;
      }
    }

    if (!remoteSnapshot) {
      await client.uploadSnapshot(localSnapshot);
      await updateBackupState({
        lastSyncedAt: nowIso(),
        lastSyncAction: 'push',
        lastSyncStatus: 'success',
        lastSyncMessage: `未发现备份，已在 ${client.backupFileUrl} 创建新备份`
      });
      return { action: 'push', snapshot: localSnapshot };
    }

    const remoteTimestamp = getSnapshotTimestamp(remoteSnapshot);

    if (remoteTimestamp > localTimestamp) {
      const result = await applySnapshot(remoteSnapshot, {
        restoreRules: true,
        preserveWebDAVConfig: false,
        changeReason: 'webdav_sync_pull'
      });
      await updateBackupState({
        lastSyncedAt: nowIso(),
        lastSyncAction: 'pull',
        lastSyncStatus: 'success',
        lastSyncMessage: '检测到 WebDAV 更新，已同步到本地'
      });
      return { action: 'pull', snapshot: remoteSnapshot, result };
    }

    if (localTimestamp > remoteTimestamp) {
      await client.uploadSnapshot(localSnapshot);
      await updateBackupState({
        lastSyncedAt: nowIso(),
        lastSyncAction: 'push',
        lastSyncStatus: 'success',
        lastSyncMessage: '本地数据较新，已同步到 WebDAV'
      });
      return { action: 'push', snapshot: localSnapshot };
    }

    await updateBackupState({
      lastSyncedAt: nowIso(),
      lastSyncAction: 'noop',
      lastSyncStatus: 'success',
      lastSyncMessage: '本地与 WebDAV 已是最新'
    });
    return { action: 'noop', snapshot: localSnapshot };
  }

  async function autoSyncIfEnabled(trigger) {
    const state = await getStoredState();
    if (!state.webdavConfig.autoSync || !state.webdavConfig.baseUrl) {
      return { skipped: true, reason: 'disabled' };
    }

    try {
      const result = await syncWithWebDAV();
      return { skipped: false, trigger, ...result };
    } catch (error) {
      await updateBackupState({
        lastSyncedAt: nowIso(),
        lastSyncStatus: 'error',
        lastSyncMessage: error.message
      });
      throw error;
    }
  }

  async function testWebDAV(config) {
    const client = new WebDAVClient(config);
    return client.testConnection();
  }

  function createDownloadFile(snapshot) {
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `openclash-helper-backup-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function exportToFile() {
    const snapshot = await createSnapshot({ includeRules: true });
    createDownloadFile(snapshot);
    return snapshot;
  }

  global.OpenClashBackup = {
    AUTO_SYNC_ALARM_NAME,
    BACKUP_FILE_NAME,
    BACKUP_FOLDER_NAME,
    DEFAULT_AUTO_SYNC_INTERVAL,
    WebDAVClient,
    applySnapshot,
    autoSyncIfEnabled,
    buildWebDAVConfig,
    configureAutoSyncAlarm,
    createSnapshot,
    exportToFile,
    getStoredState,
    markLocalChange,
    pullFromWebDAV,
    pushToWebDAV,
    syncWithWebDAV,
    testWebDAV,
    updateBackupState
  };
})(typeof self !== 'undefined' ? self : window);
