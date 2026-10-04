/* ================= 快速记录卡片（v2）：正文划选松手触发 ================= */
var capEl = null, capText = '';
document.addEventListener('mouseup', function (ev) {
  if (capEl && capEl.contains(ev.target)) return;
  /* .rich/.rtb 排除：富文本编辑器的划选归工具栏所有（加粗/链接等），不弹速记卡（v3） */
  if (ev.target.closest && ev.target.closest('input,textarea,select,.modal,.ctxmenu,.rich,.rtb')) return;
  var sel = window.getSelection();
  var txt = sel && !sel.isCollapsed ? String(sel).trim() : '';
  if (!txt || txt.length < 2) return;
  var rect = sel.getRangeAt(0).getBoundingClientRect();
  showCap(txt.slice(0, 500), rect.right + 8, rect.bottom + 6);
});
function showCap(text, x, y) {
  closeCap(); capText = text;
  capEl = document.createElement('div'); capEl.className = 'cap';
  capEl.innerHTML =
    '<div class="cap-h"><span class="src">' + icon('i-note', 11) + '选区速记</span>'
    + '<span class="auto"><span class="dot"></span>记录为 引用</span></div>'
    + '<div class="cap-pv">' + esc(text.length > 160 ? text.slice(0, 160) + '…' : text) + '</div>'
    + '<div class="cap-in">' + icon('i-plus', 12) + '<input id="capInput" placeholder="可补充：打标签 / 引导标题 / 定类型…"><span class="kbd">Enter 记录</span></div>'
    + '<div class="cap-acts">'
    + '<button class="cbtn" id="capCopy">' + icon('i-note') + '复制</button>'
    + '<button class="cbtn primary" id="capSave">' + icon('i-check', 12) + '记录</button>'
    + '<button class="cbtn" id="capCancel">取消</button></div>';
  $('capHost').appendChild(capEl);
  var pw = capEl.offsetWidth || 300, ph = capEl.offsetHeight || 180;
  capEl.style.left = Math.max(8, Math.min(x, innerWidth - pw - 14)) + 'px';
  capEl.style.top = Math.max(8, Math.min(y, innerHeight - ph - 14)) + 'px';
  $('capInput').focus();
  $('capCopy').onclick = function () {
    var done = function () { toast('已复制选区'); closeCap() };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(capText).then(done, done);
    else done();
  };
  $('capSave').onclick = saveCap;
  $('capCancel').onclick = closeCap;
  capEl.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && ev.target.id === 'capInput') { ev.preventDefault(); saveCap() }
    if (ev.key === 'Escape') { ev.stopPropagation(); closeCap() }
  });
}
function saveCap() {
  var input = $('capInput');
  var hint = input ? input.value.trim() : '';
  var text = capText;
  closeCap();
  if (!text) return;
  /* 有备注 → notes-quick-instruct（LLM 提取 tags/titleHint/kind/inject）；无备注 → notes-quick（合并窗口 + 异步分类）。
     sessionId/cwd 传空：页面无会话上下文，标题回退由 host 兜底。 */
  var call = hint
    ? rpc('notes-quick-instruct', { text: text, note: hint, sessionId: '', cwd: '' })
    : rpc('notes-quick', { text: text, sessionId: '', cwd: '', kind: 'quote' });
  call.then(function (res) {
    if (res && res.error) { toast(res.error); return }
    /* 敏感命中：host 已直接落 sensitive=true（注入自动脱敏），toast 追加标注告知 */
    toast((res && res.merged ? '已合并进今日速记' : '已记录为引用（主题分类由 host LLM 异步回填）') + (res && res.sensitiveSuggested ? '，已标记敏感（注入自动脱敏）' : ''));
    loadNotes(true).then(function () { if (res && res.id && !res.merged) selectNote(res.id) });
    /* 分类异步回填：延迟静默重拉两次，标题/主题自动刷新可见 */
    setTimeout(function () { loadNotes(true) }, 4000);
    setTimeout(function () { loadNotes(true) }, 10000);
  }).catch(function (e) { toast('记录失败：' + (e && e.message || e)) });
}
function closeCap() { if (capEl) { capEl.remove(); capEl = null } if (window.getSelection) window.getSelection().removeAllRanges() }

