// 首屏渲染前同步设置主题，消除"暗→亮"闪烁。
// chrome.storage 是异步的，会晚于首屏绘制；这里改用同步的 localStorage 镜像 + matchMedia。
// 扩展页 CSP 为 script-src 'self'，禁止内联脚本，故独立成文件并在 <head> 同步（阻塞）加载。
(function () {
  try {
    var stored = localStorage.getItem('appTheme') || localStorage.getItem('popupTheme') || 'system';
    var resolved = (stored === 'light' || stored === 'dark')
      ? stored
      : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.dataset.theme = resolved;
  } catch (e) {
    // 忽略，回退到 CSS 默认主题
  }
})();
