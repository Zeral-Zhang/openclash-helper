class CloudflareAPI {
  constructor(config) {
    this.workerUrl = config.workerUrl;
    this.apiSecret = config.apiSecret;
  }

  async addRule(domain, type, matchType = 'DOMAIN-SUFFIX') {
    const response = await fetch(`${this.workerUrl}/api/rules`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiSecret}`
      },
      body: JSON.stringify({ domain, type, matchType })
    });

    const data = await response.json();
    
    if (!response.ok) {
      if (data.error === 'RULE_EXISTS') {
        throw new Error('RULE_EXISTS');
      }
      throw new Error(data.error || '添加规则失败');
    }
    
    return true;
  }

  async getAllRules() {
    const response = await fetch(`${this.workerUrl}/api/rules`, {
      headers: {
        'Authorization': `Bearer ${this.apiSecret}`
      }
    });

    if (!response.ok) {
      throw new Error('获取规则失败');
    }

    return await response.json();
  }

  async saveRules(directContent, proxyContent) {
    const response = await fetch(`${this.workerUrl}/api/rules`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiSecret}`
      },
      body: JSON.stringify({ direct: directContent, proxy: proxyContent })
    });

    if (!response.ok) {
      throw new Error('保存规则失败');
    }

    return true;
  }

  // 测试连接
  async testConnection() {
    try {
      const response = await fetch(`${this.workerUrl}/direct.yaml`);
      return response.ok;
    } catch (e) {
      return false;
    }
  }
}
