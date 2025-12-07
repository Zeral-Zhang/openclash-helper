// 使用 CDN 加载 CodeMirror 6
import { EditorView, basicSetup } from 'https://cdn.jsdelivr.net/npm/codemirror@6.0.1/+esm';
import { EditorState } from 'https://cdn.jsdelivr.net/npm/@codemirror/state@6.4.1/+esm';
import { yaml } from 'https://cdn.jsdelivr.net/npm/@codemirror/legacy-modes@6.3.3/mode/yaml.js';
import { StreamLanguage } from 'https://cdn.jsdelivr.net/npm/@codemirror/language@6.10.1/+esm';
import { autocompletion, CompletionContext } from 'https://cdn.jsdelivr.net/npm/@codemirror/autocomplete@6.15.0/+esm';
import { keymap } from 'https://cdn.jsdelivr.net/npm/@codemirror/view@6.26.0/+esm';

let currentTab = 'proxy';
let rules = { proxy: '', direct: '' };
let api = null;
let editorView = null;

// 规则补全数据
const ruleTypes = [
  { label: 'DOMAIN', detail: '完整域名匹配', info: '例: DOMAIN,google.com,PROXY' },
  { label: 'DOMAIN-SUFFIX', detail: '域名后缀匹配', info: '例: DOMAIN-SUFFIX,google.com,PROXY' },
  { label: 'DOMAIN-KEYWORD', detail: '域名关键词匹配', info: '例: DOMAIN-KEYWORD,google,PROXY' },
  { label: 'IP-CIDR', detail: 'IP 地址范围', info: '例: IP-CIDR,127.0.0.0/8,DIRECT' },
  { label: 'PROCESS-NAME', detail: '进程名称匹配', info: '例: PROCESS-NAME,chrome.exe,PROXY' },
  { label: 'GEOIP', detail: 'IP 所属国家', info: '例: GEOIP,CN,DIRECT' },
  { label: 'GEOSITE', detail: 'Geosite 域名集', info: '例: GEOSITE,youtube,PROXY' }
];

const policies = [
  { label: 'PROXY', detail: '代理' },
  { label: 'DIRECT', detail: '直连' },
  { label: 'REJECT', detail: '拒绝' }
];

// 自动补全函数
function yamlCompletion(context) {
  const line = context.state.doc.lineAt(context.pos);
  const lineText = line.text;
  const beforeCursor = lineText.slice(0, context.pos - line.from);
  
  // 检测是否在规则行
  const isRuleLine = /^\s*-\s*/.test(lineText);
  
  if (!isRuleLine) return null;
  
  // 提取当前输入
  const match = beforeCursor.match(/^\s*-\s*([A-Z-]*)/);
  if (!match) return null;
  
  const typed = match[1];
  const from = line.from + match.index + match[0].length - typed.length;
  
  // 如果已经输入了规则类型，检查是否需要补全策略
  const fullMatch = lineText.match(/^\s*-\s*([A-Z-]+),([^,]+),?([A-Z]*)?/);
  if (fullMatch && fullMatch[3] !== undefined) {
    // 补全策略
    return {
      from: line.from + lineText.lastIndexOf(fullMatch[3]),
      options: policies.map(p => ({
        label: p.label,
        detail: p.detail,
        apply: p.label
      }))
    };
  }
  
  // 补全规则类型
  const options = ruleTypes
    .filter(r => r.label.startsWith(typed))
    .map(r => ({
      label: r.label,
      detail: r.detail,
      info: r.info,
      apply: (view, completion, from, to) => {
        // 插入完整的规则模板
        const template = r.info.split(':')[1].trim();
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: `  - ${template}` }
        });
      }
    }));
  
  return options.length > 0 ? { from, options } : null;
}

// 初始化编辑器
function initEditor(content = '') {
  const startState = EditorState.create({
    doc: content,
    extensions: [
      basicSetup,
      StreamLanguage.define(yaml),
      autocompletion({
        override: [yamlCompletion],
        activateOnTyping: true
      }),
      keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            saveRules();
            return true;
          }
        }
      ]),
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { overflow: 'auto' }
      })
    ]
  });

  if (editorView) {
    editorView.destroy();
  }

  editorView = new EditorView({
    state: startState,
    parent: document.getElementById('editor')
  });
}

// 初始化
(async function init() {
  const { config } = await chrome.storage.local.get(['config']);
  
  if (!config || !config.host) {
    initEditor('# 请先在配置页面设置路由器信息');
    showStatus('请先配置路由器信息', 'error');
    return;
  }
  
  api = new OpenClashAPI(config);
  await loadRules();
})();

// 加载规则
async function loadRules() {
  try {
    rules = await api.getAllRules();
    displayCurrentTab();
  } catch (e) {
    showStatus('加载失败: ' + e.message, 'error');
    initEditor('# 加载失败');
  }
}

// 显示当前标签页的内容
function displayCurrentTab() {
  const content = currentTab === 'proxy' ? rules.proxy : rules.direct;
  initEditor(content);
  
  // 更新标题
  document.getElementById('editorTitle').textContent = 
    currentTab === 'proxy' ? '代理规则' : '直连规则';
  
  // 统计信息
  updateStats(content);
}

// 更新统计信息
function updateStats(content) {
  const lines = content.split('\n').filter(l => l.trim().startsWith('- '));
  const domainCount = lines.filter(l => l.includes('DOMAIN,')).length;
  const suffixCount = lines.filter(l => l.includes('DOMAIN-SUFFIX,')).length;
  const keywordCount = lines.filter(l => l.includes('DOMAIN-KEYWORD,')).length;
  
  document.getElementById('stats').innerHTML = `
    <div class="stat-item">总计: ${lines.length} 条</div>
    <div class="stat-item">完整匹配: ${domainCount}</div>
    <div class="stat-item">后缀匹配: ${suffixCount}</div>
    <div class="stat-item">关键词: ${keywordCount}</div>
  `;
}

// 保存规则
async function saveRules() {
  try {
    const content = editorView.state.doc.toString();
    
    // 更新当前标签的内容
    if (currentTab === 'proxy') {
      rules.proxy = content;
    } else {
      rules.direct = content;
    }
    
    // 保存到服务器
    await api.saveRules(rules.proxy, rules.direct);
    showStatus('保存成功', 'success');
    
    // 更新统计
    updateStats(content);
  } catch (e) {
    showStatus('保存失败: ' + e.message, 'error');
  }
}

// 显示状态
function showStatus(msg, type) {
  const status = document.getElementById('status');
  status.textContent = msg;
  status.className = 'status ' + type;
  setTimeout(() => status.className = 'status', 3000);
}

// 标签切换
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    // 保存当前编辑内容
    const content = editorView.state.doc.toString();
    if (currentTab === 'proxy') {
      rules.proxy = content;
    } else {
      rules.direct = content;
    }
    
    // 切换标签
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    
    // 显示新标签内容
    displayCurrentTab();
  });
});

// 按钮事件
document.getElementById('save').addEventListener('click', saveRules);
document.getElementById('reload').addEventListener('click', loadRules);

// OpenClashAPI 类（从 api.js 复制）
class OpenClashAPI {
  constructor(config) {
    this.config = config;
    this.token = null;
    this.useBase64 = null;
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
    
    if (this.useBase64 === null) {
      const stored = await chrome.storage.local.get(['useBase64']);
      this.useBase64 = stored.useBase64 !== false;
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

  async saveRules(proxyContent, directContent) {
    await this.writeFile(this.config.proxyFile, proxyContent);
    await this.writeFile(this.config.directFile, directContent);
  }
}
