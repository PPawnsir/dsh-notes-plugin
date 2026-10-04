/* ================= modal 框架 ================= */
/* 设置卡交互反馈（notes-settings-feedback）：modalCloseHook = 关闭前兜底 flush 钩子（仅设置卡挂载；其余 modal 为 null，行为不变） */
var modalCloseHook = null;
function openModal(html) {
  modalCloseHook = null;   /* 换 modal 即清钩子（设置卡在 openModal 后自行挂载） */
  $('modalHost').innerHTML = '<div class="mask" id="mask"><div class="modal" id="modal">' + html + '</div></div>';
  $('mask').addEventListener('mousedown', function (ev) { if (ev.target === ev.currentTarget) closeModalFlushed() });
}
function closeModal() { $('modalHost').innerHTML = ''; modalCloseHook = null }
/* ✕/Esc/点遮罩统一入口：先跑兜底 flush 钩子（读控件 DOM 需在清空前），再关 modal；无钩子 ≡ closeModal */
function closeModalFlushed() { var h = modalCloseHook; if (h) h(); closeModal() }
function modalErr(m) { var e = $('mErr'); if (e) { e.textContent = m; e.style.display = 'block' } }

