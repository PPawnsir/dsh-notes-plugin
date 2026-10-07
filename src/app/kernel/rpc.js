/* ================= 数据层：/dsh-notes RPC（与 lib/client.js 同模式） ================= */
/* 0.4.6-B 韧性层（notes-046-rpc-resilience，巡检三角色同族证据 n-mux88x3knpsv/n-mux89mdj6tty/n-mux8a1l4k2nv）：
   裸 fetch 包装（无超时/无错误处理/挂起=空白假死）→ 三件套：
   ① 超时：AbortController，缺省 RPC_TIMEOUT_MS；LLM 类长调用（host 侧 8s~120s 级：when-suggest 草稿 8s / 约定体检 120s——0.4.7-A⑨）经 RPC_LLM_METHODS 显式放宽；
   ② 超时/网络错误 → 结构化 {error} 返回（与 host error 形态一致，调用点零改动兼容）+ toast 显式告知（不静默）；
   ③ 挂起 > RPC_SLOW_MS → 非阻塞「连接慢」提示条（#rpcSlowBar，CSS pointer-events:none 不遮罩不阻断），全部落定后消失。
   红线：不改 host 协议形态；超时值集中本块常量可改；不引入第三方库；UI 提示不阻断操作。 */
/* 0.4.8-A 同构面核查结论（notes-048-perf-backoff ②）：app 端无性能遥测周期上报——perf 埋点仅 client 面板有
   （src/client/kernel/perf.js 的 30s 计数器推数入 perf-report.json；其 rejection 吞掉 + 连败指数退避 + warn 降级三件套在本卡同修）。
   本层 rpc() 只服务用户操作触发的请求，无点火即发的定时上报调用，无同款 unhandled rejection 面；
   若日后 app 端新增遥测上报，必须带同款三件套并同步 check 节 107 断言。 */
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
/* 0.4.7-C（notes-047-stability ①）：卸载兜底专用直发——页面拆毁期普通 fetch 常被取消，keepalive/sendBeacon 是卸载可靠通道。
   自包含（不走 rpc() 超时/慢条三件套：卸载期计时器无意义）；sendBeacon 优先（浏览器保证投递尝试），
   不支持/排队满回退 fetch keepalive；64KB keepalive 预算守卫——超预算回退普通 rpc() 尽力送达（宁可尽力不可硬失败）。
   火忘语义：响应体无人消费，返回 Promise 仅为调用点形态兼容 */
function rpcKeepalive(method, args) {
  try {
    var body = JSON.stringify({ method: method, args: args || {} });
    if (body.length < 60000 && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon('/dsh-notes', new Blob([body], { type: 'application/json' }))) return Promise.resolve({ ok: true });
    }
    if (typeof fetch !== 'undefined') {
      return fetch('/dsh-notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body,
        keepalive: body.length < 60000,
      }).then(function (r) { return r.json() }).catch(function () { return {} });
    }
  } catch (e) {}
  return Promise.resolve({});
}
