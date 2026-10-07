/* ================= 数据层：/dsh-notes RPC（与 lib/client.js 同模式） ================= */
/* 0.4.6-B 韧性层（notes-046-rpc-resilience，巡检三角色同族证据 n-mux88x3knpsv/n-mux89mdj6tty/n-mux8a1l4k2nv）：
   裸 fetch 包装（无超时/无错误处理/挂起=空白假死）→ 三件套：
   ① 超时：AbortController，缺省 RPC_TIMEOUT_MS；LLM 类长调用（host 侧 8s 级起）经 RPC_LLM_METHODS 显式放宽；
   ② 超时/网络错误 → 结构化 {error} 返回（与 host error 形态一致，调用点零改动兼容）+ toast 显式告知（不静默）；
   ③ 挂起 > RPC_SLOW_MS → 非阻塞「连接慢」提示条（#rpcSlowBar，CSS pointer-events:none 不遮罩不阻断），全部落定后消失。
   红线：不改 host 协议形态；超时值集中本块常量可改；不引入第三方库；UI 提示不阻断操作。 */
var RPC_TIMEOUT_MS = 20000;        /* 缺省超时（普通 RPC） */
var RPC_TIMEOUT_LLM_MS = 120000;   /* LLM 类长调用超时（✨整理/选区指令/挂载建议/约定体检） */
var RPC_SLOW_MS = 3000;            /* 挂起提示条阈值：超过即显示「连接慢」非阻塞条 */
var RPC_LLM_METHODS = { 'notes-ai-organize': 1, 'notes-quick-instruct': 1, 'notes-when-suggest': 1, 'notes-conflict-check': 1 };
var rpcSlowShown = 0;              /* 已升条的慢请求在途计数（>0 → 提示条可见；并发归并同一条） */
function rpcSlowBar(show) {
  var bar = $('rpcSlowBar');
  if (!bar) return;
  if (show === true) { bar.textContent = t('rpc.slowBar'); bar.style.display = 'block' }
  else bar.style.display = 'none';
}
function rpc(method, args) {
  var timeoutMs = RPC_LLM_METHODS[method] ? RPC_TIMEOUT_LLM_MS : RPC_TIMEOUT_MS;
  var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timedOut = false, slowUp = false;
  var toTimer = setTimeout(function () { timedOut = true; if (ctrl) { try { ctrl.abort() } catch (e) {} } }, timeoutMs);
  var slowTimer = setTimeout(function () { slowUp = true; rpcSlowShown++; rpcSlowBar(true) }, RPC_SLOW_MS);
  function settled() {
    clearTimeout(toTimer); clearTimeout(slowTimer);
    if (slowUp) { slowUp = false; rpcSlowShown--; if (rpcSlowShown <= 0) { rpcSlowShown = 0; rpcSlowBar(false) } }
  }
  return fetch('/dsh-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: method, args: args || {} }),
    signal: ctrl ? ctrl.signal : undefined
  }).then(function (r) { return r.json() })
    .then(function (res) { settled(); return res })
    .catch(function (e) {
      settled();
      var msg = timedOut ? t('rpc.timeout', { s: Math.round(timeoutMs / 1000) }) : t('rpc.network', { msg: e && e.message || String(e) });
      toast(msg);   /* 错误不静默：韧性层显式 toast（调用点的业务横幅/错误条语义照旧） */
      return { error: msg };
    })
}
