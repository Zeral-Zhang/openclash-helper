class OpenClashAPI {
  constructor(config) {
    this.config = config;
    this.token = null;
    this.useBase64 = null; // null=未检测, true=可用, false=不可用
  }

  async login() {
    const response = await fetch(`http://${this.config.host}/cgi-bin/luci/rpc/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        method: 'login',
        params: [this.config.username, this.config.password]
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(`登录失败: ${data.error.message}`);
    this.token = data.result;
    
    // 首次登录时检查 Base64 支持
    if (this.useBase64 === null) {
      const stored = await chrome.storage.local.get(['useBase64']);
      this.useBase64 = stored.useBase64 !== false; // 默认 true
    }
    
    return this.token;
  }

  async readFile(path) {
    if (!this.token) await this.login();
    
    if (this.useBase64) {
      try {
        return await this.readFileBase64(path);
      } catch (e) {
        if (e.isBase64Error) {
          console.log('Base64 不可用，降级到 shell 方式');
          this.useBase64 = false;
          await chrome.storage.local.set({ useBase64: false });
          return await this.readFileShell(path);
        }
        throw e;
      }
    }
    return await this.readFileShell(path);
  }

  async readFileBase64(path) {
    const response = await fetch(`http://${this.config.host}/cgi-bin/luci/rpc/fs?auth=${this.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        method: 'readfile',
        params: [path]
      })
    });
    const data = await response.json();
    if (data.error) {
      const error = new Error(data.error.message || '读取文件失败');
      if (data.error.data && data.error.data.includes('Base64')) {
        error.isBase64Error = true;
      }
      throw error;
    }
    return data.result ? atob(data.result) : '';
  }

  async readFileShell(path) {
    const response = await fetch(`http://${this.config.host}/cgi-bin/luci/rpc/sys?auth=${this.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        method: 'exec',
        params: [`cat ${path}`]
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || '读取文件失败');
    return data.result || '';
  }

  async writeFile(path, content) {
    if (!this.token) await this.login();
    
    if (this.useBase64) {
      try {
        return await this.writeFileBase64(path, content);
      } catch (e) {
        if (e.isBase64Error) {
          console.log('Base64 不可用，降级到 shell 方式');
          this.useBase64 = false;
          await chrome.storage.local.set({ useBase64: false });
          return await this.writeFileShell(path, content);
        }
        throw e;
      }
    }
    return await this.writeFileShell(path, content);
  }

  async writeFileBase64(path, content) {
    const response = await fetch(`http://${this.config.host}/cgi-bin/luci/rpc/fs?auth=${this.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        method: 'writefile',
        params: [path, btoa(content)]
      })
    });
    const data = await response.json();
    if (data.error) {
      const error = new Error(data.error.message || '写入文件失败');
      if (data.error.data && data.error.data.includes('Base64')) {
        error.isBase64Error = true;
      }
      throw error;
    }
    return data.result;
  }

  async writeFileShell(path, content) {
    const escapedContent = content.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
    const response = await fetch(`http://${this.config.host}/cgi-bin/luci/rpc/sys?auth=${this.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        method: 'exec',
        params: [`printf '%s' '${escapedContent}' > ${path}`]
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || '写入文件失败');
    return data.result;
  }

  async addRule(domain, type, matchType = 'DOMAIN-SUFFIX') {
    const filePath = type === 'PROXY' ? this.config.proxyFile : this.config.directFile;
    let content = await this.readFile(filePath);
    
    if (!content.includes('payload:')) {
      content = 'payload:\n';
    }
    
    const rule = `  - ${matchType},${domain}`;
    
    // 检查规则是否已存在
    if (content.includes(rule)) {
      throw new Error('RULE_EXISTS');
    }
    
    content += `${rule}\n`;
    await this.writeFile(filePath, content);
    return true;
  }

  // 获取所有规则
  async getAllRules() {
    const rules = { proxy: '', direct: '' };
    
    try {
      rules.proxy = await this.readFile(this.config.proxyFile);
    } catch (e) {
      console.error('读取代理规则失败:', e);
    }
    
    try {
      rules.direct = await this.readFile(this.config.directFile);
    } catch (e) {
      console.error('读取直连规则失败:', e);
    }
    
    return rules;
  }

  // 保存规则
  async saveRules(proxyContent, directContent) {
    await this.writeFile(this.config.proxyFile, proxyContent);
    await this.writeFile(this.config.directFile, directContent);
  }

  // 执行 shell 命令
  async exec(command) {
    if (!this.token) await this.login();
    
    const response = await fetch(`http://${this.config.host}/cgi-bin/luci/rpc/sys?auth=${this.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        method: 'exec',
        params: [command]
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || '执行命令失败');
    return data.result;
  }
}
