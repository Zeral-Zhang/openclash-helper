let currentTab = 'proxy';
let rules = { proxy: '', direct: '' };
let api = null;
let editor = null;

// 规则补全数据
const ruleCompletions = [
  { caption: 'DOMAIN', value: '- DOMAIN,example.com,PROXY', meta: '完整域名匹配', docHTML: '<b>DOMAIN</b><br>完整域名匹配<br>例: DOMAIN,google.com,PROXY' },
  { caption: 'DOMAIN-SUFFIX', value: '- DOMAIN-SUFFIX,example.com,PROXY', meta: '域名后缀匹配', docHTML: '<b>DOMAIN-SUFFIX</b><br>域名后缀匹配<br>例: DOMAIN-SUFFIX,google.com,PROXY' },
  { caption: 'DOMAIN-KEYWORD', value: '- DOMAIN-KEYWORD,google,PROXY', meta: '域名关键词', docHTML: '<b>DOMAIN-KEYWORD</b><br>域名关键词匹配<br>例: DOMAIN-KEYWORD,google,PROXY' },
  { caption: 'IP-CIDR', value: '- IP-CIDR,127.0.0.0/8,DIRECT', meta: 'IP 地址范围', docHTML: '<b>IP-CIDR</b><br>IP 地址范围匹配<br>例: IP-CIDR,127.0.0.0/8,DIRECT' },
  { caption: 'PROCESS-NAME', value: '- PROCESS-NAME,chrome.exe,PROXY', meta: '进程名称', docHTML: '<b>PROCESS-NAME</b><br>进程名称匹配<br>例: PROCESS-NAME,chrome.exe,PROXY' },
  { caption: 'GEOIP', value: '- GEOIP,CN,DIRECT', meta: 'IP 所属国家', docHTML: '<b>GEOIP</b><br>IP 所属国家代码<br>例: GEOIP,CN,DIRECT' },
  { caption: 'GEOSITE', value: '- GEOSITE,youtube,PROXY', meta: 'Geosite 域名集', docHTML: '<b>GEOSITE</b><br>Geosite 域名集合<br>例: GEOSITE,youtube,PROXY' }
];

// 自定义补全器
const customCompleter = {
  getCompletions: function(editor, session, pos, prefix, callback) {
    const line = session.getLine(pos.row);
    const beforeCursor = line.substring(0, pos.column);
    
    // 检测是否输入了 - 或在规则行
    const match = beforeCursor.match(/^\s*-\s*([A-Z-]*)$/);
    if (!match) {
      callback(null, []);
      return;
    }
    
    const typed = match[1] || '';
    const indent = line.match(/^\s*/)[0];
    
    const completions = ruleCompletions
      .filter(c => c.caption.startsWith(typed) || typed === '')
      .map(c => {
        // 提取规则内容（去掉模板中的 "- "）
        const ruleContent = c.value.replace(/^\s*-\s*/, '');
        
        return {
          caption: c.caption,
          value: ruleContent,
          meta: c.meta,
          docHTML: c.docHTML,
          score: 1000,
          completer: {
            insertMatch: function(editor, data) {
              const pos = editor.getCursorPosition();
              const line = editor.session.getLine(pos.row);
              const indent = line.match(/^\s*/)[0];
              
              // 完整的规则行：缩进 + "- " + 规则内容
              const fullRule = indent + '- ' + data.value;
              
              // 替换整行
              editor.session.replace({
                start: { row: pos.row, column: 0 },
                end: { row: pos.row, column: line.length }
              }, fullRule);
              
              // 移动光标到行尾
              editor.moveCursorTo(pos.row, fullRule.length);
            }
          }
        };
      });
    
    callback(null, completions);
  }
};

// 初始化编辑器
function initEditor(content = '') {
  if (!editor) {
    // 配置 Ace 使用本地文件
    ace.config.set('basePath', './');
    ace.config.set('modePath', './');
    ace.config.set('themePath', './');
    
    editor = ace.edit('editor');
    editor.setTheme('ace/theme/github');
    editor.session.setMode('ace/mode/yaml');
    editor.setOptions({
      enableBasicAutocompletion: true,
      enableLiveAutocompletion: true,
      enableSnippets: false,
      showPrintMargin: false,
      fontSize: 14,
      tabSize: 2,
      useSoftTabs: true
    });
    
    // 添加自定义补全器
    editor.completers = [customCompleter];
    
    // 快捷键
    editor.commands.addCommand({
      name: 'save',
      bindKey: { win: 'Ctrl-S', mac: 'Cmd-S' },
      exec: function() {
        saveRules();
      }
    });
  }
  
  editor.setValue(content, -1);
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
    const content = editor.getValue();
    
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

// 格式化规则
function formatRules() {
  const content = editor.getValue();
  const lines = content.split('\n');
  
  const formatted = lines.map(line => {
    const trimmed = line.trim();
    
    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith('#')) {
      return line;
    }
    
    // 格式化 payload:
    if (trimmed === 'payload:') {
      return 'payload:';
    }
    
    // 格式化规则行
    if (trimmed.startsWith('-')) {
      // 移除多余空格
      const cleaned = trimmed.replace(/^-\s*/, '').replace(/\s+/g, '');
      const parts = cleaned.split(',');
      
      if (parts.length >= 2) {
        // 确保格式: - TYPE,value,policy
        return `  - ${parts.join(',')}`;
      }
    }
    
    return line;
  }).join('\n');
  
  editor.setValue(formatted, -1);
  showStatus('格式化完成', 'success');
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
    const content = editor.getValue();
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
document.getElementById('format').addEventListener('click', formatRules);
