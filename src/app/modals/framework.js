/* ================= modal 框架 ================= */
/* 设置卡交互反馈（notes-settings-feedback）：modalCloseHook = 关闭前兜底 flush 钩子（仅设置卡挂载；其余 modal 为 null，行为不变） */
var modalCloseHook = null;
/* 单层返回栈（notes-041-settings-back）：二级面板（注入管理/启用引导）从设置卡进入（from='settings'）时挂载来源，
   关闭（✕/取消/Esc/点遮罩同口径）后自动重开设置卡；modalBackScroll = 离开设置卡时的 .modal 滚动位置（重开后由 openSettings 一次性还原消费）。
   红线：单层够用，不引入多层通用栈（YAGNI）；Esc 语义保持「关当前层」（返回栈是关闭后的去向，不是新增层级） */
var modalBackTo = null;
var modalBackScroll = 0;
function openModal(html) {
  modalCloseHook = null;   /* 换 modal 即清钩子（设置卡在 openModal 后自行挂载） */
  modalBackTo = null;      /* 换 modal 即清返回来源（二级面板在 openModal 后按 from 自行挂载） */
  $('modalHost').innerHTML = '<div class="mask" id="mask"><div class="modal" id="modal">' + html + '</div></div>';
  $('mask').addEventListener('mousedown', function (ev) { if (ev.target === ev.currentTarget) closeModalFlushed() });
}
function closeModal() {
  var back = modalBackTo; modalBackTo = null;
  $('modalHost').innerHTML = ''; modalCloseHook = null;
  /* 单层返回：来源为设置卡的二级面板关闭后自动重开设置卡（滚动存档由 openSettings 消费还原）；非返回路径清滚动存档防串档 */
  if (back === 'settings') openSettings(); else modalBackScroll = 0;
}
/* ✕/Esc/点遮罩统一入口：先跑兜底 flush 钩子（读控件 DOM 需在清空前），再关 modal；无钩子 ≡ closeModal */
function closeModalFlushed() { var h = modalCloseHook; if (h) h(); closeModal() }
function modalErr(m) { var e = $('mErr'); if (e) { e.textContent = m; e.style.display = 'block' } }

