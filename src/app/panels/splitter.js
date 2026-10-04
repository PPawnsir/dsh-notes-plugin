/* ================= 侧栏宽度拖拽条（4px 分隔条：拖拽调整 / localStorage 记忆 / 双击重置缺省） ================= */
/* clamp 200px–60%（相对 .app 容器宽）；localStorage key 独立于浮动面板 */
var SIDE_W_KEY = 'dsh-notes-app-sidebar-w', SIDE_W_DEFAULT = 342;
var sideEl = document.querySelector('.app .side'), splitterEl = $('splitter');
function clampSideW(w) { return Math.max(200, Math.min(Math.round(document.querySelector('.app').getBoundingClientRect().width * 0.6), Math.round(w))) }
function applySideW(w) { sideEl.style.width = clampSideW(w) + 'px' }
function loadSideW() { try { var v = parseInt(localStorage.getItem(SIDE_W_KEY), 10); if (v >= 200) applySideW(v) } catch (e) {} }
function saveSideW(w) { try { if (w == null) localStorage.removeItem(SIDE_W_KEY); else localStorage.setItem(SIDE_W_KEY, String(w)) } catch (e) {} }
splitterEl.addEventListener('mousedown', function (ev) {
  ev.preventDefault();
  var sx = ev.clientX, sw = sideEl.getBoundingClientRect().width;
  splitterEl.classList.add('on'); document.body.classList.add('split-drag');   /* 拖拽期间禁文本选择 + 强制 col-resize */
  /* mousemove 挂 document、mouseup 移除监听防泄漏 */
  function onMove(ev2) { applySideW(sw + ev2.clientX - sx) }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    splitterEl.classList.remove('on'); document.body.classList.remove('split-drag');
    saveSideW(sideEl.getBoundingClientRect().width);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});
/* 双击分隔条 = 重置缺省宽度（并清除持久化） */
splitterEl.addEventListener('dblclick', function () { applySideW(SIDE_W_DEFAULT); saveSideW(null) });
/* 窗口 resize 按新 60% 上限复核（不回写持久化，窗口放大后恢复原宽） */
window.addEventListener('resize', function () { applySideW(sideEl.getBoundingClientRect().width) });
loadSideW();
function applyTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('dsh-notes-app-theme', t) } catch (e) {} }
$('btnTheme').addEventListener('click', function () { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') });
try { var savedTheme = localStorage.getItem('dsh-notes-app-theme'); if (savedTheme === 'light' || savedTheme === 'dark') applyTheme(savedTheme) } catch (e) {}

