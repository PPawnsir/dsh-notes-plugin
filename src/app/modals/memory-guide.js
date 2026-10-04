/* ================= 工作记忆 v0：沉淀引导启用流程（notes-memory-guide；裁决 A——约定笔记方案，无独立注入管线；r3 车道模型） =================
   启用 = 创建预填约定笔记（inject=true + 作用域 injectTo，contractType: memory-guide 身份标记，tag memory-guide 兼容发现键）；状态不落 settings.json（存在且注入=启用）。
   r3 车道模型：记忆车道与约定车道并行——无冲突确认闸门、无跨车道重叠检测（产物重复是设计意图）；enable 幂等直建。
   作用域档（全局视角多选，不以「当前」为基准）= 所有会话（缺省，injectTo=[]）/ 指定工作区（多选，展开为所选工作区全部会话短 id 并集）/ 指定会话（多选会话短 id 清单）。 */
var memStatus = null;   /* { enabled, noteId }（null=未探测） */
var memEnableState = null;  /* 启用对话框状态：{ scope:'global'|'workspace'|'session', sess:null=未加载|会话清单, wss:{工作区:true}, sids:{short:true}, pending } */
function renderMemoryStatus(st) {
  memStatus = st;
  var host = $('setMemoryCtrl'); if (!host) return;
  if (!st) { host.innerHTML = '<span class="s">探测中…</span>'; return }
  if (st.enabled) {
    host.innerHTML = '<span class="s">已启用 </span>'
      + '<button class="mbtn" id="memView">查看约定</button>'
      + '<button class="mbtn" id="memDisable">停用</button>';
    $('memView').onclick = function () { closeModal(); if (st.noteId) jumpToWikiTarget(st.noteId) };
    $('memDisable').onclick = function () { doMemDisable() };
  } else {
    host.innerHTML = '<button class="mbtn" id="memEnable">启用沉淀引导…</button>';
    $('memEnable').onclick = function () { openMemEnable() };
  }
}
function doMemDisable() {
  rpc('notes-memory-guide', { op: 'disable' }).then(function (res) {
    if (res && res.error) { modalErr(res.error); return }
    toast(res && res.disabled ? '已停用沉淀引导（约定笔记保留，inject 已关闭）' : '当前未启用沉淀引导');
    renderMemoryStatus({ enabled: false, noteId: (memStatus && memStatus.noteId) || '' });
    loadNotes(true);
  }).catch(function (e) { modalErr('停用失败：' + (e && e.message || e)) });
}
function openMemEnable() {
  memEnableState = { scope: 'global', sess: null, wss: {}, sids: {}, pending: false };
  openModal(
    '<div class="modal-t">' + icon('i-bolt', 13) + ' 启用沉淀引导<span class="sub">工作记忆 v0 · 约定笔记方案</span></div>'
    + '<div class="modal-hint">将创建一条预填约定笔记「约定：工作日志沉淀（工作记忆 v0）」（inject=true，contractType: memory-guide），引导 Agent 在任务收尾/你示意时把会话结论写为工作日志（kind=log）。工作记忆是独立于笔记约定的并行通道——约定管你怎么记（给人看），记忆管 Agent 自己沉淀什么（自用召回），两者可同时对同一事件生效，产物重复是设计意图而非冲突。日志默认隐身：不进系统提示、不进目录、不出现在默认列表与默认搜索；筛选中心类型「日志」为专入口。该约定可见/可改/可停用/可删除。</div>'
    + '<div class="sg-sec"><div class="sg-sec-t">注入范围（作用域）</div>'
    + '<label class="fg-item"><input type="radio" name="memScope" value="global" checked><span class="fl">所有会话（缺省）</span></label>'
    + '<label class="fg-item"><input type="radio" name="memScope" value="workspace"><span class="fl">指定工作区（多选，下方勾选）</span></label>'
    + '<div id="memWsList" style="display:none;max-height:120px;overflow:auto;margin:2px 0 4px 20px"></div>'
    + '<label class="fg-item"><input type="radio" name="memScope" value="session"><span class="fl">指定会话（多选，下方勾选）</span></label>'
    + '<div id="memSessList" style="display:none;max-height:160px;overflow:auto;margin:2px 0 4px 20px"></div></div>'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="memCancel">取消</button><button class="mbtn primary" id="memOk">确认启用</button></div>'
  );
  $('memCancel').onclick = function () { closeModal(); memEnableState = null };
  $('memOk').onclick = function () { doMemEnable() };
  /* 作用域档切换：workspace/session 档展开多选清单（notes-sessions 数据源，与注入预览同 RPC；全局视角：可挑任意工作区/会话） */
  Array.prototype.forEach.call(document.getElementsByName('memScope'), function (r) {
    r.onchange = function () {
      memEnableState.scope = r.value;
      $('memWsList').style.display = r.value === 'workspace' ? 'block' : 'none';
      $('memSessList').style.display = r.value === 'session' ? 'block' : 'none';
      if (r.value !== 'global' && !memEnableState.sess) {
        rpc('notes-sessions', {}).then(function (res) {
          if (!memEnableState) return;
          var ss = ((res && res.sessions) || []).concat((res && res.pendingSessions) || []);
          memEnableState.sess = ss;
          /* 工作区清单 = 会话 workspace 字段去重（附会话计数）；会话清单 = 全部会话（短 id · 名称（工作区）） */
          var ws = [];
          ss.forEach(function (s) { if (s && s.workspace && ws.indexOf(s.workspace) < 0) ws.push(s.workspace) });
          var wsBox = $('memWsList');
          if (wsBox) {
            wsBox.innerHTML = ws.length
              ? ws.map(function (w) { return '<label class="fg-item"><input type="checkbox" data-memws="' + esc(w) + '"><span class="fl">' + esc(w + '（' + ss.filter(function (s) { return s.workspace === w }).length + ' 个会话）') + '</span></label>' }).join('')
              : '<div class="modal-hint">没有可选工作区</div>';
            wsBox.querySelectorAll('input[data-memws]').forEach(function (cb) {
              cb.onchange = function () { if (cb.checked) memEnableState.wss[cb.dataset.memws] = true; else delete memEnableState.wss[cb.dataset.memws] };
            });
          }
          var box = $('memSessList');
          if (box) {
            box.innerHTML = ss.length
              ? ss.map(function (s) { return '<label class="fg-item"><input type="checkbox" data-memsid="' + esc(s.short || '') + '"><span class="fl">' + esc((s.short || '') + (s.name ? ' · ' + s.name : '') + (s.workspace ? '（' + s.workspace + '）' : '')) + '</span></label>' }).join('')
              : '<div class="modal-hint">没有可选会话</div>';
            box.querySelectorAll('input[data-memsid]').forEach(function (cb) {
              cb.onchange = function () { if (cb.checked) memEnableState.sids[cb.dataset.memsid] = true; else delete memEnableState.sids[cb.dataset.memsid] };
            });
          }
        }).catch(function () {});
      }
    };
  });
  /* r3 车道模型：无 op:'check' 重叠扫描与冲突确认——对话框打开即可确认启用（enable 幂等：已启用返回 already:true） */
}
function doMemEnable() {
  if (!memEnableState || memEnableState.pending) return;
  var scope = [];
  if (memEnableState.scope === 'workspace') {
    /* 指定工作区 → 展开为所选工作区全部会话短 id 并集（injectTo 无工作区维度，落值语义同会话多选） */
    var wss = memEnableState.wss;
    if (!Object.keys(wss).length) { modalErr('「指定工作区」需至少勾选 1 个工作区（或改选所有会话）'); return }
    (memEnableState.sess || []).forEach(function (s) { if (s && s.workspace && wss[s.workspace] && s.short && scope.indexOf(s.short) < 0) scope.push(s.short) });
    if (!scope.length) { modalErr('所选工作区暂无可注入会话（请先在其中打开会话）'); return }
  } else if (memEnableState.scope === 'session') {
    scope = Object.keys(memEnableState.sids);
    if (!scope.length) { modalErr('「指定会话」需至少勾选 1 个会话（或改选所有会话）'); return }
  }
  memEnableState.pending = true; $('memOk').disabled = true;
  rpc('notes-memory-guide', { op: 'enable', scope: scope }).then(function (res) {
    if (!memEnableState) return;
    if (res && res.error) { modalErr(res.error); memEnableState.pending = false; $('memOk').disabled = false; return }
    closeModal(); memEnableState = null;
    toast(res && res.already ? '沉淀引导已启用（约定笔记已存在）' : '已启用沉淀引导：约定笔记已创建并注入');
    renderMemoryStatus({ enabled: true, noteId: res && res.id || '' });
    loadNotes(true);
  }).catch(function (e) { if (memEnableState) { modalErr('启用失败：' + (e && e.message || e)); memEnableState.pending = false; $('memOk').disabled = false } });
}
