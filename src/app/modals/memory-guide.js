/* ================= 工作记忆 v0：沉淀引导启用流程（notes-memory-guide；裁决 A——约定笔记方案，无独立注入管线；r3 车道模型） =================
   启用 = 创建预填约定笔记（inject=true + 作用域 injectTo，contractType: memory-guide 身份标记，tag memory-guide 兼容发现键）；状态不落 settings.json（存在且注入=启用）。
   r3 车道模型：记忆车道与约定车道并行——无冲突确认闸门、无跨车道重叠检测（产物重复是设计意图）；enable 幂等直建。
   作用域档（全局视角多选，不以「当前」为基准）= 所有会话（缺省，injectTo=[]）/ 指定工作区（多选，展开为所选工作区全部会话短 id 并集）/ 指定会话（多选会话短 id 清单）。 */
var memStatus = null;   /* { enabled, noteId }（null=未探测） */
var memEnableState = null;  /* 启用对话框状态：{ scope:'global'|'workspace'|'session', sess:null=未加载|会话清单, wss:{工作区:true}, sids:{short:true}, pending } */
function renderMemoryStatus(st) {
  memStatus = st;
  var host = $('setMemoryCtrl'); if (!host) return;
  /* i18n 覆盖卡D：状态行文案复用设置卡既有 settings.mem* key（同文案不重复建） */
  if (!st) { host.innerHTML = '<span class="s">' + t('settings.memProbing') + '</span>'; return }
  if (st.enabled) {
    host.innerHTML = '<span class="s">' + t('settings.memEnabled') + ' </span>'
      + '<button class="mbtn" id="memView">' + t('settings.memView') + '</button>'
      + '<button class="mbtn" id="memDisable">' + t('settings.memDisable') + '</button>';
    $('memView').onclick = function () { closeModal(); if (st.noteId) jumpToWikiTarget(st.noteId) };
    $('memDisable').onclick = function () { doMemDisable() };
  } else {
    host.innerHTML = '<button class="mbtn" id="memEnable">' + t('settings.memEnable') + '</button>';
    $('memEnable').onclick = function () { openMemEnable('settings') };   /* from=settings：单层返回栈（notes-041-settings-back），关闭/启用成功后回本卡 */
  }
}
function doMemDisable() {
  rpc('notes-memory-guide', { op: 'disable' }).then(function (res) {
    if (res && res.error) { modalErr(res.error); return }
    toast(res && res.disabled ? t('mem.disabledToast') : t('mem.notEnabled'));
    renderMemoryStatus({ enabled: false, noteId: (memStatus && memStatus.noteId) || '' });
    loadNotes(true);
  }).catch(function (e) { modalErr(t('mem.disableFailed', { msg: e && e.message || e })) });
}
function openMemEnable(from) {
  /* 单层返回栈（notes-041-settings-back）：from='settings'（设置卡「启用沉淀引导…」入口）时存档来源 + 当前 .modal 滚动位置，取消/启用成功后自动回设置卡 */
  var backScroll = from === 'settings' && $('modal') ? $('modal').scrollTop : 0;
  memEnableState = { scope: 'global', sess: null, wss: {}, sids: {}, pending: false };
  openModal(
    '<div class="modal-t">' + icon('i-bolt', 13) + ' ' + t('mem.enableTitle') + '<span class="sub">' + t('mem.enableSub') + '</span></div>'
    + '<div class="modal-hint">' + t('mem.enableHint') + '</div>'
    + '<div class="sg-sec"><div class="sg-sec-t">' + t('mem.scopeTitle') + '</div>'
    + '<label class="fg-item"><input type="radio" name="memScope" value="global" checked><span class="fl">' + t('mem.scopeGlobal') + '</span></label>'
    + '<label class="fg-item"><input type="radio" name="memScope" value="workspace"><span class="fl">' + t('mem.scopeWsPick') + '</span></label>'
    + '<div id="memWsList" style="display:none;max-height:120px;overflow:auto;margin:2px 0 4px 20px"></div>'
    + '<label class="fg-item"><input type="radio" name="memScope" value="session"><span class="fl">' + t('mem.scopeSessPick') + '</span></label>'
    + '<div id="memSessList" style="display:none;max-height:160px;overflow:auto;margin:2px 0 4px 20px"></div></div>'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="memCancel">' + t('common.cancel') + '</button><button class="mbtn primary" id="memOk">' + t('mem.confirmEnable') + '</button></div>'
  );
  if (from === 'settings') { modalBackTo = 'settings'; modalBackScroll = backScroll }   /* 挂载单层返回栈（openModal 已清零，此处按来源回填） */
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
          if (res && res.error) throw new Error(res.error);   /* 显式抛错进 catch（读路径静默群修复） */
          var ss = ((res && res.sessions) || []).concat((res && res.pendingSessions) || []);
          memEnableState.sess = ss;
          /* 工作区清单 = 会话 workspace 字段去重（附会话计数）；会话清单 = 全部会话（短 id · 名称（工作区）） */
          var ws = [];
          ss.forEach(function (s) { if (s && s.workspace && ws.indexOf(s.workspace) < 0) ws.push(s.workspace) });
          var wsBox = $('memWsList');
          if (wsBox) {
            wsBox.innerHTML = ws.length
              ? ws.map(function (w) { return '<label class="fg-item"><input type="checkbox" data-memws="' + esc(w) + '"><span class="fl">' + esc(t('mem.wsLabel', { name: w, n: ss.filter(function (s) { return s.workspace === w }).length })) + '</span></label>' }).join('')
              : '<div class="modal-hint">' + t('mem.noWorkspace') + '</div>';
            wsBox.querySelectorAll('input[data-memws]').forEach(function (cb) {
              cb.onchange = function () { if (cb.checked) memEnableState.wss[cb.dataset.memws] = true; else delete memEnableState.wss[cb.dataset.memws] };
            });
          }
          var box = $('memSessList');
          if (box) {
            box.innerHTML = ss.length
              ? ss.map(function (s) { return '<label class="fg-item"><input type="checkbox" data-memsid="' + esc(s.short || '') + '"><span class="fl">' + esc((s.short || '') + (s.name ? t('mem.sessNameSeg', { name: s.name }) : '') + (s.workspace ? t('mem.sessWsSeg', { ws: s.workspace }) : '')) + '</span></label>' }).join('')
              : '<div class="modal-hint">' + t('mem.noSessions') + '</div>';
            box.querySelectorAll('input[data-memsid]').forEach(function (cb) {
              cb.onchange = function () { if (cb.checked) memEnableState.sids[cb.dataset.memsid] = true; else delete memEnableState.sids[cb.dataset.memsid] };
            });
          }
        }).catch(function (e) { modalErr(t('mem.sessLoadFailed', { msg: e && e.message || e })) });   /* 弹窗内反馈（modalErr 自带 mErr 缺位守卫） */
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
    if (!Object.keys(wss).length) { modalErr(t('mem.needWorkspace')); return }
    (memEnableState.sess || []).forEach(function (s) { if (s && s.workspace && wss[s.workspace] && s.short && scope.indexOf(s.short) < 0) scope.push(s.short) });
    if (!scope.length) { modalErr(t('mem.noSessInWs')); return }
  } else if (memEnableState.scope === 'session') {
    scope = Object.keys(memEnableState.sids);
    if (!scope.length) { modalErr(t('mem.needSession')); return }
  }
  memEnableState.pending = true; $('memOk').disabled = true;
  rpc('notes-memory-guide', { op: 'enable', scope: scope }).then(function (res) {
    if (!memEnableState) return;
    if (res && res.error) { modalErr(res.error); memEnableState.pending = false; $('memOk').disabled = false; return }
    closeModal(); memEnableState = null;
    toast(res && res.already ? t('mem.alreadyToast') : (res && res.revived ? t('mem.revivedToast') : t('mem.enabledToast')));
    renderMemoryStatus({ enabled: true, noteId: res && res.id || '' });
    loadNotes(true);
  }).catch(function (e) { if (memEnableState) { modalErr(t('mem.enableFailed', { msg: e && e.message || e })); memEnableState.pending = false; $('memOk').disabled = false } });
}
