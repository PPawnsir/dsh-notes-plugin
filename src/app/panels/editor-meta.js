function renderCrumb() {
  var n = edNote; if (!n) return;
  /* 面包屑文件夹段（notes-nested-folder-ui）：单文件夹名升级为「父/子/孙」路径，每段可点击 = 切到该文件夹视图 */
  var fhtml = '';
  if (n.folder) folderPath(n.folder).forEach(function (pf) { fhtml += '<span class="lnk crumb-f" data-fid="' + pf.id + '" title="切换到文件夹视图：' + esc(pf.name) + '">' + esc(pf.name) + '</span><span class="sep">/</span>' });
  $('edCrumb').innerHTML = fhtml
    + '<span class="lnk" id="crumbTopic" title="按主题全局过滤（跨文件夹）">' + esc(n.topic || '未分类') + '</span><span class="sep">/</span><span>' + esc(n.id) + '</span>';
  $('crumbTopic').onclick = function () { view = { type: 'topic', id: n.topic || '未分类' }; render(); toast('已按主题过滤：' + (n.topic || '未分类')) };
  $('edCrumb').querySelectorAll('.crumb-f').forEach(function (el) {
    el.onclick = function () { var fid = el.getAttribute('data-fid'); view = { type: 'folder', id: fid }; foldOpen[fid] = true; saveFoldOpen(); render() };
  });
}
function renderMeta() {
  var n = edNote; if (!n) return;
  var tagsStr = n._tagsStr != null ? n._tagsStr : (n.tags || []).filter(function (t) { return t !== 'quick' }).join(', ');
  /* 注入三态：off=不注入 / convention=约定（须遵守）/ reference=资料（按需取用）；存量 inject=true 无 role 缺省 convention */
  var role = n.inject ? (n.injectRole === 'reference' ? 'reference' : 'convention') : 'off';
  $('edMeta').innerHTML =
    '<span class="meta-chip" title="类型"><span class="dot" style="background:' + (KCOLOR[n.kind] || KCOLOR.note) + '"></span><select id="kindSel">'
    + Object.keys(KIND).map(function (k) { return '<option value="' + k + '"' + (k === (n.kind || 'note') ? ' selected' : '') + '>' + KIND[k] + '</option>' }).join('') + '</select></span>'
    + '<span class="meta-chip" title="状态"><select id="statusSel">'
    + ['active', 'resolved', 'superseded'].map(function (s) { return '<option value="' + s + '"' + (s === (isPinned(n) ? 'active' : n.status || 'active') ? ' selected' : '') + '>' + STATUS_LABEL[s] + '</option>' }).join('') + '</select></span>'
    + '<span class="meta-chip" title="主题（host LLM 可异步回填；改后自动保存）">' + icon('i-topic') + '<input id="mTopicInput" size="8" placeholder="主题" value="' + esc(n.topic === '分类中' ? '' : (n.topic || '')) + '"></span>'
    + '<span class="meta-chip" title="标签，逗号分隔">' + icon('i-filter') + '<input id="mTagsInput" size="10" placeholder="标签…" value="' + esc(tagsStr) + '"></span>'
    + (fname(n.folder) ? '<span class="meta-chip">' + icon('i-folder') + esc(fname(n.folder)) + '</span>' : '')
    /* 使用遥测（P2）：详情 meta chip「被引用 N 次」（0 次不显示） */
    + ((n.useCount || 0) > 0 ? '<span class="meta-chip" title="使用遥测：被 Agent 引用（note_get 命中）次数">' + icon('i-quote') + '被引用 ' + n.useCount + ' 次</span>' : '')
    /* P3 派发闭环徽章：有派发记录时聚合显示（pending=有待回执 / done=全部已回执），点击展开派发历史 */
    + (function () { var ds = n.dispatches || []; if (!ds.length) return ''; var openN = ds.filter(function (d) { return !isDispDone(d) }).length; return '<span class="meta-chip disp-badge ' + (openN ? 'pending' : 'done') + '" id="mDispBadge" title="' + (openN ? ('派发中：' + openN + ' 条待回执（共 ' + ds.length + ' 条）· 目标会话处理完转 idle 或笔记置 resolved 时自动回执；点击查看派发历史') : ('全部 ' + ds.length + ' 条派发已回执 · 点击查看派发历史')) + '">' + icon(openN ? 'i-play' : 'i-check') + esc(openN ? ('派发中 ' + openN + '/' + ds.length) : '派发已回执') + '</span>' })()
    + '<span class="meta-chip role-seg" id="mRole">' + icon('i-bolt')
    + '<span class="seg' + (role === 'off' ? ' on' : '') + '" data-role="off" title="不注入系统提示">关闭</span>'
    + '<span class="seg' + (role === 'convention' ? ' on' : '') + '" data-role="convention" title="须遵守的行为规则">约定</span>'
    + '<span class="seg' + (role === 'reference' ? ' on' : '') + '" data-role="reference" title="事实性补充信息，Agent 按需取用">资料</span></span>'
    + (role !== 'off' ? '<span class="scope-wrap" id="scopeWrap"><span class="meta-chip" id="scopeTrig" title="选择注入范围（可多选）">' + esc(injectScopeLabel(n.injectTo)) + ' ▾</span><div id="scopePanelHost"></div></span>' : '')
    + '<span class="meta-chip tgl' + (n.recall !== false ? ' on' : '') + '" id="mRecall" title="关闭后不出现在注入给 Agent 的目录中">' + icon('i-eye') + '目录可见</span>'
    + '<span class="meta-chip tgl' + (n.sensitive === true ? ' on' : '') + '" id="mSens" title="敏感内容：注入系统提示时正文按行打码（键保留值遮蔽），Agent 用 note_get 取原文">' + icon('i-lock') + '敏感</span>'
    /* 曾注入徽章（injectEver 粘性标记：单向只升不降，不随关闭回退；当前已注入时由上方注入角色段表达，不重复显示） */
    + (n.injectEver === true && !n.inject ? '<span class="meta-chip" title="曾注入：历史上开启过上下文注入（现已关闭；injectEver 为粘性标记，不随关闭回退）">' + icon('i-clock') + '曾注入</span>' : '')
    + '<span class="meta-sp"></span>'
    /* 双模式两段开关（原型 .modeseg + tipwrap 降级 tooltip）：源码 ⇄ 富文本；降级态富文本段置灰 */
    + '<span class="tipwrap' + (degraded.ok ? '' : ' deg') + '">'
    + '<span class="modeseg" id="modeSeg">'
    + '<button class="seg' + (edMode === 'source' ? ' on' : '') + '" data-m="source" title="Markdown 源码编辑">' + icon('i-code-block', 12) + '源码</button>'
    + '<button class="seg' + (edMode === 'rich' ? ' on' : '') + (degraded.ok ? '' : ' dis') + '" data-m="rich" id="segRich" title="富文本（受限 WYSIWYG，Ctrl+/ 切换）">' + icon('i-eye', 12) + '富文本</button>'
    + '</span>'
    + '<span class="tip" id="richTip">含高级语法，请在源码模式编辑</span>'
    + '</span>'
    + '<span class="kbd">Ctrl+/</span>'
    /* 二期 ✨整理：AI 按当前 kind 模板重写正文（notes-ai-organize；替换后 toast 可撤销一次） */
    + '<span class="meta-act organize-btn' + (organizing ? ' busy' : '') + '" id="mOrganize" title="' + (organizing ? 'AI 整理中…' : 'AI 整理：按「' + (KIND[edNote.kind] || KIND.note) + '」模板重写正文（替换后可撤销）') + '">' + icon('i-sparkle') + (organizing ? '整理中…' : '整理') + '</span>'
    + '<span class="meta-act" id="mDispatch" title="派发待办到活跃会话">' + icon('i-play') + '派发</span>'
    + (n.sessionId ? '<span class="meta-act" id="mSrc" title="来源会话">' + icon('i-ext') + '来源</span>' : '')
    /* 历史版本面板入口（notes-history-ui）：有版本时才显示（选中笔记后 notes-history 探测计数） */
    + ((histCount || 0) > 0 ? '<span class="meta-act" id="mHist" title="历史版本（' + histCount + ' 个快照）：预览 / 一键恢复（恢复前当前版自动快照，可再撤销）">' + icon('i-clock') + '历史</span>' : '')
    + '<span class="meta-act' + (isPinned(n) ? ' on' : '') + '" id="mPin" title="' + (isPinned(n) ? '取消置顶' : '置顶') + '">' + icon('i-pin') + '</span>'
    + '<span class="meta-act danger" id="mDel" title="删除（软删除，可撤销/由 Agent 恢复）">' + icon('i-trash') + '</span>';
  $('kindSel').onchange = function () { edNote.kind = this.value; triggerSave(); renderMeta(); renderTree() };
  $('statusSel').onchange = function () { edNote.status = this.value; triggerSave(); renderMeta(); renderTree() };
  $('mTopicInput').oninput = function () { edNote.topic = this.value; triggerSave() };
  $('mTagsInput').oninput = function () { edNote._tagsStr = this.value; triggerSave() };
  $('mRole').querySelectorAll('.seg').forEach(function (seg) {
    seg.onclick = function () {
      var r = seg.getAttribute('data-role');
      if (r === role) return;
      if (r === 'off') { edNote.inject = false; scopeOpen = false }
      else { edNote.inject = true; edNote.injectRole = r; if (!sessList.length) pullSessions(); scopeOpen = true }
      triggerSave(); renderMeta();
      toast(r === 'off' ? '已关闭上下文注入' : '已注入为上下文 · ' + (r === 'reference' ? '资料' : '约定') + '（范围见右侧下拉）');
    };
  });
  var trig = $('scopeTrig');
  if (trig) trig.onclick = function (ev) { ev.stopPropagation(); scopeOpen = !scopeOpen; if (scopeOpen && !sessList.length) pullSessions(); renderScopePanel() };
  $('mRecall').onclick = function () { edNote.recall = edNote.recall === false; triggerSave(); renderMeta(); toast(edNote.recall !== false ? '已加入 Agent 目录' : '已从 Agent 目录隐藏') };
  $('mSens').onclick = function () { edNote.sensitive = edNote.sensitive !== true; triggerSave(); renderMeta(); toast(edNote.sensitive === true ? '已标记敏感（注入时自动脱敏）' : '已取消敏感标记') };
  $('mDispatch').onclick = function () { openDispatch() };
  /* P3 派发闭环徽章：点击展开派发历史并滚动到位 */
  var dBadge = $('mDispBadge');
  if (dBadge) dBadge.onclick = function () { var host = $('dispHost'); if (!host) return; host.dataset.open = '1'; renderDispatches(); try { host.scrollIntoView({ block: 'nearest' }) } catch (e) {} };
  $('mOrganize').onclick = function () { if (!organizing) doAiOrganize() };
  var src = $('mSrc');
  if (src) src.onclick = function () { toast('来源会话 ' + shortSid(edNote.sessionId) + '（' + edNote.sessionId + '）· 页面无跳转能力，请回 DSH 主界面打开') };
  /* 历史版本面板入口（无版本时入口不渲染，需守卫） */
  var mH = $('mHist');
  if (mH) mH.onclick = function () { openHistory() };
  $('mPin').onclick = function () { edNote.status = isPinned(edNote) ? 'active' : 'pinned'; triggerSave(); renderMeta(); renderTree(); toast(isPinned(edNote) ? '已置顶' : '已取消置顶') };
  $('mDel').onclick = function () { doDeleteNote(edNote.id) };
  /* 双模式两段开关点击（降级态点富文本段 → toast 原因，不切换） */
  var ms = $('modeSeg');
  if (ms) ms.querySelectorAll('.seg').forEach(function (seg) {
    seg.onclick = function () {
      var m = seg.getAttribute('data-m');
      if (m === 'rich' && seg.classList.contains('dis')) { toast(($('richTip') && $('richTip').textContent) || '含高级语法，请在源码模式编辑'); return; }
      switchMode(m);
    };
  });
  renderScopePanel();
}
/* 注入范围浮层（指定会话多选；缺省=所有会话，契约同面板 toggleScope） */
function renderScopePanel() {
  var hostEl = $('scopePanelHost');
  if (!hostEl) return;
  if (!scopeOpen || !edNote || !edNote.inject) { hostEl.innerHTML = ''; return }
  var scope = edNote.injectTo || [];
  var byWs = {};
  sessList.forEach(function (s) { var w = s.workspace || '其他'; (byWs[w] = byWs[w] || []).push(s) });
  sessPending.forEach(function (p) { var w = p.workspace || '其他'; (byWs[w] = byWs[w] || []).push({ id: p.id, short: p.short, name: '', pending: true }) });
  var wsKeys = Object.keys(byWs).sort();
  var h = '<div class="scope-panel">'
    + '<div class="scope-hint">默认注入到所有会话；勾选会话则仅限这些会话</div>';
  wsKeys.forEach(function (ws) {
    h += '<div class="scope-ws">' + esc(ws) + '</div>';
    byWs[ws].forEach(function (s) {
      h += '<label class="scope-item' + (s.pending ? ' dis' : '') + '"><input type="checkbox" data-scope="' + esc(s.short) + '"' + (!s.pending && scope.indexOf(s.short) >= 0 ? ' checked' : '') + (s.pending ? ' disabled' : '') + '> ' + (s.pending ? esc(s.short) + ' · 标题加载中…' : esc(s.name || s.short)) + '</label>';
    });
  });
  hostEl.innerHTML = h + '</div>';
  hostEl.querySelectorAll('input[data-scope]').forEach(function (cb) {
    cb.onchange = function () { toggleScope(cb.dataset.scope) };
  });
}
function toggleScope(key) {
  var cur = (edNote.injectTo || []).filter(function (t) { return t !== 'global' && t !== 'workspace' });
  var next = cur.indexOf(key) >= 0 ? cur.filter(function (t) { return t !== key }) : cur.concat([key]);
  edNote.injectTo = next;
  triggerSave(); renderMeta(); scopeOpen = true; renderScopePanel();
}
function renderDispatches() {
  var host = $('dispHost'); if (!host || !edNote) return;
  var ds = edNote.dispatches || [];
  if (!ds.length) { host.innerHTML = ''; return }
  var open = host.dataset.open === '1';
  var h = '<div class="disp-t" id="dispT">' + (open ? '▼' : '▶') + ' 派发历史（' + ds.length + '）</div>';
  if (open) {
    ds.map(function (d, i) { return { d: d, i: i } }).reverse().forEach(function (r) {
      var d = r.d;
      h += '<div class="disp-rec' + (isDispDone(d) ? ' done' : '') + '"><div class="disp-rec-top">'
        + (isDispDone(d) ? '✓ ' : '<span class="dot"></span>') + esc(d.sessionName || d.sessionId)
        + '<span class="disp-rec-m">' + (isDispDone(d) ? '已完成 · ' : '待处理 · ') + (d.mode === 'new' ? '新会话' : (d.workspace || '已有会话')) + (d.at ? ' · ' + fmtDT(d.at) : '') + '</span></div>'
        + (d.instruction ? '<div class="disp-rec-i">要求：' + esc(d.instruction) + '</div>' : '')
        + (!isDispDone(d) ? '<button class="disp-done-btn" data-di="' + r.i + '">标记完成</button>' : '') + '</div>';
    });
  }
  host.innerHTML = h;
  $('dispT').onclick = function () { host.dataset.open = open ? '0' : '1'; renderDispatches() };
  host.querySelectorAll('.disp-done-btn').forEach(function (b) {
    b.onclick = function () {
      rpc('notes-dispatch-done', { id: edNote.id, dispatchIndex: Number(b.dataset.di) }).then(function (res) {
        if (res && res.error) { toast(res.error); return }
        toast('已标记完成'); refreshSelected(); loadNotes(true);
      }).catch(function (e) { toast('操作失败：' + (e && e.message || e)) });
    };
  });
}
function renderEdFoot() {
  var n = edNote; if (!n || !$('edCreated')) return;
  $('edCreated').textContent = '创建 ' + fmtDT(n.createdAt);
  $('edUpdated').textContent = '更新 ' + fmtDT(n.updatedAt);
  $('edSource').textContent = n.sessionId ? ('来源 会话 ' + shortSid(n.sessionId)) : '来源 页面';
}
function refreshSelected() {
  if (!selId) return;
  /* 双模式：重建前先落盘富文本在途编辑（renderEd 会重建编辑器 DOM，不序列化则丢未回写内容） */
  if (edMode === 'rich' && richDirty) syncFromRich('刷新回填');
  var id = selId;
  rpc('notes-get', { id: id }).then(function (res) {
    if (res && res.note && selId === id) {
      var editing = document.activeElement && (document.activeElement === $('edSrc') || document.activeElement === $('edRich') || document.activeElement === $('edTitle'));
      var body = edNote ? edNote.body : '';
      edNote = res.note;
      if (editing) edNote.body = body;   /* 编辑中不覆盖正文（防焦点内回填顶掉击键） */
      degraded = analyzeMarkdown(edNote.body || '');
      renderEd();
    }
  }).catch(function () {})
}
function doDeleteNote(id) {
  if (!id) return;
  rpc('notes-delete', { id: id }).then(function (res) {
    if (res && res.error) { toast(res.error); return }
    if (selId === id) { selId = null; edNote = null; renderEd() }
    loadNotes(true);
    toast('已删除（软删除）', {
      label: '撤销', fn: function () {
        rpc('notes-restore', { id: id }).then(function (r) {
          if (r && r.error) { toast(r.error); return }
          toast('已恢复'); loadNotes(true);
        }).catch(function (e) { toast('恢复失败：' + (e && e.message || e)) });
      }
    });
  }).catch(function (e) { toast('删除失败：' + (e && e.message || e)) });
}

