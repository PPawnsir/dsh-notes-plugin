/* ================= 设置 / 导出 / 导入 ================= */
/* 设置卡交互反馈（notes-settings-feedback）：✕ 常驻关闭 + dirty 跟踪「保存」（显式确认 + 兜底 flush）+「还原」回滚。
   dirty 判定口径 = 在途待写（setInflight>0）或 任一控件值 ≠ 打开时快照（setSnap）；
   自动保存（失焦/Enter/选择即存）零改动——「保存」按钮是显式确认 + 未落盘改动的兜底 flush，两者并存 */
var setSnap = null;      /* 打开时快照 {llmP,llmM,stale,maxDepth,budget,usageBudget,logWeek,logMonth,orgMax}（字符串口径同控件值；0.4.4-E：catalog 目录补充行开关随功能整体拆除；0.4.7-B⑦ +orgMax 整理长度上限） */
var setPersist = null;   /* 已落盘镜像（兜底 flush/还原只写真不同的键） */
var setInflight = 0;     /* 在途设置写数（>0 = 存在尚未落盘的待写） */
var setSaving = false;   /* 保存/还原执行中（按钮防重入） */
var semState = null;     /* 0.5.0④ 语义检索节运行时态 { enabled, backend, model, status, building }（openSettings 加载后初始化） */
/* 0.4.7-B①b（notes-047-ux）：设置行 label 生成器——说明文字 >60 字时限 2 行收折（.s.cl），行名旁出 ⓘ 钮点击展开/收拢；
   extraHtml = 说明后的追加块（如注入预算仪表），收折只作用说明段 */
function setLabelHtml(label, tip, extraHtml) {
  var long = typeof tip === 'string' && tip.length > 60;
  return '<div class="set-label">' + label
    + (long ? '<button class="sx" type="button" title="' + t('settings.descExpandTip') + '" aria-label="' + t('settings.descExpandTip') + '">ⓘ</button>' : '')
    + '<span class="s' + (long ? ' cl' : '') + '">' + tip + '</span>' + (extraHtml || '') + '</div>';
}
/* ================= 0.4.8 设置分组导航（notes-048-settings-groups；UX候选D n-mus81ly6hvh2）=================
   七组分类常量表（冻结）+ 新节登记处：
     rows = 节 id（app/原型 = setSecs 键 = 行壳 data-sec 锚；client = settingsRows key）。
     新增节须三端同登记进对应组 rows；登记遗漏由 check 111「常量表 ⇄ 节 id 集双向一致」断言兜底（漏登记即红）。
     空组（rows 空或全部缺渲染）整组隐身——组定义保留为登记槽，有节入驻即自动出现在 rail/chips/组壳。
     红线：节内内容与组内节相对顺序不动（0.4.7-B sticky 标题/描述收折/LLM 区零回归）；组块按本表序渲染。 */
var SET_GROUPS = [
  { id: 'general',  icon: 'i-gear',    labelKey: 'settings.group.general',  rows: [] },                                                  /* 常规：主题/语言/面板入口类（0.4.8 notes-048-lang-topbar：语言节随切换上顶栏下线——空组登记槽保留） */
  { id: 'editor',   icon: 'i-note',    labelKey: 'settings.group.editor',   rows: [] },                                                  /* 编辑器：自动保存/富文本/双链类（待新节登记） */
  { id: 'inject',   icon: 'i-bolt',    labelKey: 'settings.group.inject',   rows: ['stale', 'budget', 'injprev', 'injmgr', 'semantic'] },            /* 检索与注入：搜索/注入/挂载类 */
  { id: 'dispatch', icon: 'i-clock',   labelKey: 'settings.group.dispatch', rows: [] },                                                  /* 派发与调度（待新节登记） */
  { id: 'ai',       icon: 'i-sparkle', labelKey: 'settings.group.ai',       rows: ['llm', 'organizemax', 'usage', 'usagebudget', 'suggest'] },  /* AI：LLM 配置/整理上限类 */
  { id: 'data',     icon: 'i-folder',  labelKey: 'settings.group.data',     rows: ['maxdepth', 'data', 'assets', 'memory', 'logweek', 'logmonth'] },  /* 数据与存储：遥测/备份/存储路径类 */
  { id: 'about',    icon: 'i-info',    labelKey: 'settings.group.about',    rows: ['cheatsheet'] },                                      /* 关于：版本/计数/文档链接类 */
];
/* 可见组 = 至少含一个已渲染节的组（按表序；空组隐身） */
function setGroupsVisible(secs) {
  var out = [];
  for (var i = 0; i < SET_GROUPS.length; i++) {
    var g = SET_GROUPS[i], ids = [];
    for (var j = 0; j < g.rows.length; j++) if (secs[g.rows[j]]) ids.push(g.rows[j]);
    if (ids.length) out.push({ g: g, ids: ids });
  }
  return out;
}
/* 分组壳 + 导航渲染（纯字符串拼装，check 111 可提取 eval）：rail = 左窄栏（图标+组名，sticky 随滚）；
   chips = 窄宽（<560px 视口）顶部横条退化（CSS 媒体查询切换显隐）；组头 .set-group-t + 行壳原样入组 */
function setGroupsHtml(secs) {
  var vis = setGroupsVisible(secs);
  var rail = '', chips = '', main = '';
  for (var i = 0; i < vis.length; i++) {
    var g = vis[i].g, name = t(g.labelKey);
    rail += '<button type="button" class="set-rail-item" data-g="' + g.id + '">' + icon(g.icon, 12) + '<span>' + esc(name) + '</span></button>';
    chips += '<button type="button" class="set-chip" data-g="' + g.id + '">' + esc(name) + '</button>';
    main += '<div class="set-group" data-g="' + g.id + '"><div class="set-group-t">' + esc(name) + '</div>';
    for (var j = 0; j < vis[i].ids.length; j++) main += secs[vis[i].ids[j]];
    main += '</div>';
  }
  return '<div class="set-layout">'
    + '<div class="set-rail" role="navigation" aria-label="' + t('settings.group.nav') + '">' + rail + '</div>'
    + '<div class="set-main"><div class="set-chips">' + chips + '</div>' + main + '</div></div>';
}
/* 分组导航接线（openSettings 渲染后调用）：点击定位（滚动容器 = #modal——与 0.4.7-B sticky 标题同容器，
   吸顶标题补偿 48px）+ 滚动监听反高亮当前组（视口顶缘 56px 阈值内末命中组 = 当前组，rail/chips 同步 .on + aria-current） */
function setNavWire() {
  var modal = $('modal');
  if (!modal) return;
  var items = modal.querySelectorAll('.set-rail-item, .set-chip');
  var jump = function (gid) {
    var g = modal.querySelector('.set-group[data-g="' + gid + '"]');
    if (g) modal.scrollTop = modal.scrollTop + (g.getBoundingClientRect().top - modal.getBoundingClientRect().top) - 48;
  };
  items.forEach(function (el) { el.onclick = function () { jump(el.getAttribute('data-g')) } });
  var spy = function () {
    var top = modal.getBoundingClientRect().top, cur = '';
    var gs = modal.querySelectorAll('.set-group');
    for (var i = 0; i < gs.length; i++) if (gs[i].getBoundingClientRect().top - top <= 56) cur = gs[i].getAttribute('data-g');
    if (!cur && gs.length) cur = gs[0].getAttribute('data-g');   /* 顶部落首组（概念速览块压在首组上方，滚顶时首组未过 56px 阈值——首组兜底=当前组） */
    if (gs.length && modal.scrollTop + modal.clientHeight >= modal.scrollHeight - 2) cur = gs[gs.length - 1].getAttribute('data-g');   /* 触底锁末组（末组高度不足上顶 56px 阈值时的归宿——scroll-spy 标准兜底） */
    items.forEach(function (el) {
      var on = el.getAttribute('data-g') === cur;
      el.classList.toggle('on', on);
      if (el.classList.contains('set-rail-item')) { if (on) el.setAttribute('aria-current', 'true'); else el.removeAttribute('aria-current') }
    });
  };
  modal.addEventListener('scroll', spy, { passive: true });
  spy();
}
function openSettings() {
  openModal('<div class="modal-t">' + icon('i-gear', 13) + ' ' + t('common.settings') + '<span class="set-t-acts"><button class="mbtn" id="setRestore" disabled>' + t('common.restore') + '</button><button class="mbtn primary" id="setSave" disabled>' + t('common.save') + '</button><button class="mbtn set-x" id="setClose" title="' + t('settings.closeTip') + '">' + icon('i-x', 11) + '</button></span></div><div class="modal-err" id="mErr" style="display:none"></div><div id="setBody"><div class="modal-hint">' + t('common.loading') + '</div></div>');   /* 0.4.6-H（R2 n-mux9svn0vhkz）：错误区自弹窗底部移到标题栏下——校验失败即刻可见（原渲染在弹窗最底部需滚动，「保存看似没反应」）；modalErr 带 scrollIntoView 兜底 */
  modalCloseHook = flushSettingsPending;   /* ✕/Esc/点遮罩关闭前兜底 flush */
  setSnap = null; setPersist = null; setSaving = false;   /* dirty 基准复位（settings-get 返回后再捕获快照） */
  $('setClose').onclick = closeModalFlushed;
  $('setSave').onclick = doSettingsSaveAll;
  $('setRestore').onclick = doSettingsRestoreAll;
  rpc('notes-settings-get', {}).then(function (res) {
    if (!res || !$('setBody')) return;
    var settings = res.settings || {};
    var models = res.models || [];
    var l = settings.llm || null;
    /* 0.4.4-E：catalog 目录补充行总开关随功能整体拆除——设置卡无此控件（host 侧对旧设置键静默忽略，存量不迁移） */
    /* P1 注入增强：时效衰减提醒阈值（天，缺省 90，0=关闭）+ 注入体积预算（约/字符数，缺省 0=不限）+ 仪表（lastInjectChars） */
    var staleDays = typeof settings.staleDays === 'number' ? settings.staleDays : 90;
    /* 文件夹嵌套深度上限（maxFolderDepth，层；根级=第 1 层，缺省 3，0=不限） */
    var maxDepth = typeof settings.maxFolderDepth === 'number' ? settings.maxFolderDepth : 3;
    var budgetNum = typeof settings.injectBudgetChars === 'number' ? settings.injectBudgetChars : 0;
    /* LLM 月度用量预算提醒阈值（tokens/月，缺省 0=关闭；超预算仅 toast 不阻断） */
    var usageBudget = typeof settings.usageBudgetMonthly === 'number' ? settings.usageBudgetMonthly : 0;
    /* 工作记忆 v0 日志卫生窗口（天）：logWeekAfterDays 周聚合（缺省 7）/ logRetentionDays 月聚合（缺省 90，0=关闭本级） */
    var logWeekDays = typeof settings.logWeekAfterDays === 'number' ? settings.logWeekAfterDays : 7;
    var logRetentionDays = typeof settings.logRetentionDays === 'number' ? settings.logRetentionDays : 90;
    var lastChars = typeof res.lastInjectChars === 'number' ? res.lastInjectChars : 0;
    var gaugePct = budgetNum > 0 ? Math.min(100, Math.round(lastChars / budgetNum * 100)) : 0;
    /* 0.4.7-B⑦（notes-047-ux）：整理长度上限——控件回显用户覆盖值（0=按所配模型自动）；生效值读 settings-get 增带的 organizeMaxChars（host 已按 用户||模型表||12000 解析） */
    var orgMaxRaw = typeof settings.organizeMaxChars === 'number' && settings.organizeMaxChars > 0 ? settings.organizeMaxChars : 0;
    var orgMaxEff = typeof res.organizeMaxChars === 'number' && res.organizeMaxChars > 0 ? res.organizeMaxChars : 12000;
    /* dirty/还原基准（notes-settings-feedback）：打开时快照 + 已落盘镜像初始化（字符串口径同控件值） */
    setSnap = { llmP: l ? l.provider : '', llmM: l ? l.model : '', stale: String(staleDays), maxDepth: String(maxDepth), budget: String(budgetNum), usageBudget: String(usageBudget), logWeek: String(logWeekDays), logMonth: String(logRetentionDays), orgMax: String(orgMaxRaw) };
    setPersist = setSnap;
    var llmCtrl;
    if (models.length) {
      llmCtrl = '<select class="minput" id="setLlmSel">'
        + '<option value="">' + t('settings.followSession') + '</option>'
        + models.map(function (m) {
            var v = m.provider + '/' + m.model;
            return '<option value="' + esc(v) + '"' + (l && l.provider === m.provider && l.model === m.model ? ' selected' : '') + '>' + esc(m.label || v) + '</option>'
          }).join('') + '</select>';
    } else {
      llmCtrl = '<input class="minput" id="setLlmP" size="10" placeholder="provider" value="' + esc(l ? l.provider : '') + '">'
        + '<input class="minput" id="setLlmM" size="12" placeholder="model" value="' + esc(l ? l.model : '') + '">'
        + '<button class="mbtn" id="setLlmSave">' + t('common.save') + '</button>'
        + (l ? '<button class="mbtn" id="setLlmClear">' + t('settings.followBtn') + '</button>' : '');
    }
    /* 0.4.8：节登记表（键 = 节 id = SET_GROUPS.rows 登记键 = 行壳 data-sec 锚）；节内 HTML 保持 0.4.7-B 原文零改动（仅行壳补 data-sec）。
       渲染顺序不再由本登记顺序决定——组块按 SET_GROUPS 表序输出（组内节相对顺序不动） */
    var setSecs = {};
    /* 0.4.8（notes-048-lang-topbar）：语言设置项下线——切换入口上顶栏（#btnLang 两态直切，panels/topbar.js）；
       setLang 机制本身不动（kernel/helpers.js i18n-mech 块：localStorage 持久化 + 全量 render），语言态仍不走 settings.json、不参与 dirty */
    setSecs.llm = '<div class="set-row" data-sec="llm">' + setLabelHtml(t('settings.llm'), t('settings.llmTip')) + '<div class="set-ctrl">' + llmCtrl + '</div></div>';
    /* 0.4.7-B⑦：整理长度上限行（LLM 区紧随模型行；0 = 按所配模型自动，说明文字带生效值） */
    setSecs.organizemax = '<div class="set-row" data-sec="organizemax">' + setLabelHtml(t('settings.organizeMax'), t('settings.organizeMaxTip', { eff: orgMaxEff })) + '<div class="set-ctrl"><input class="minput" id="setOrgMax" type="number" min="0" step="1000" style="width:110px" value="' + orgMaxRaw + '"></div></div>';
    setSecs.usage = '<div class="set-row" data-sec="usage">' + setLabelHtml(t('settings.usage'), t('settings.usageTip')) + '<div class="set-ctrl usage" id="setUsageBody"><span class="s">' + t('common.loading') + '</span></div></div>';
    setSecs.usagebudget = '<div class="set-row" data-sec="usagebudget">' + setLabelHtml(t('settings.usageBudget'), t('settings.usageBudgetTip')) + '<div class="set-ctrl"><input class="minput" id="setUsageBudget" type="number" min="0" step="1000" style="width:110px" value="' + usageBudget + '"></div></div>';
    setSecs.stale = '<div class="set-row" data-sec="stale">' + setLabelHtml(t('settings.stale'), t('settings.staleTip')) + '<div class="set-ctrl"><input class="minput" id="setStale" type="number" min="0" step="1" style="width:90px" value="' + staleDays + '"></div></div>';
    setSecs.maxdepth = '<div class="set-row" data-sec="maxdepth">' + setLabelHtml(t('settings.maxDepth'), t('settings.maxDepthTip')) + '<div class="set-ctrl"><input class="minput" id="setMaxDepth" type="number" min="0" step="1" style="width:90px" value="' + maxDepth + '"></div></div>';
    setSecs.budget = '<div class="set-row" data-sec="budget">' + setLabelHtml(t('settings.budget'), t('settings.budgetTip'),
        '<span class="s" id="setGaugeT">' + t('settings.gaugeCurrent', { last: lastChars }) + (budgetNum > 0 ? ' / ' + t('settings.gaugeBudget', { budget: budgetNum }) : t('settings.gaugeUnlimited')) + '</span>'
        + '<div style="height:6px;background:var(--nbg-raise);border:1px solid var(--nbd-soft);border-radius:4px;overflow:hidden;margin-top:4px"><div id="setGaugeBar" style="height:100%;width:' + gaugePct + '%;background:var(' + (budgetNum > 0 && lastChars > budgetNum ? '--ndanger' : '--nacc') + ');transition:width .3s"></div></div>')
      + '<div class="set-ctrl"><input class="minput" id="setBudget" type="number" min="0" step="100" style="width:110px" value="' + budgetNum + '"></div></div>';
    setSecs.injprev = '<div class="set-row" data-sec="injprev">' + setLabelHtml(t('settings.injPreview'), t('settings.injPreviewTip')) + '<div class="set-ctrl"><button class="mbtn" id="setInjectPreview">' + t('settings.previewBtn') + '</button></div></div>';
    setSecs.injmgr = '<div class="set-row" data-sec="injmgr">' + setLabelHtml(t('settings.injManager'), t('settings.injManagerTip')) + '<div class="set-ctrl"><button class="mbtn" id="setInjectManager">' + t('settings.manageBtn') + '</button></div></div>';
    /* 0.5.0④（notes-050-sem-settings）：语义检索节（检索与注入组尾）——总开关 + 后端下拉 + 索引状态行 + 构建按钮 + 模型管理。
       消费①的 notes-vectors-status/rebuild 通道 + ②的 wasm-embedder（模型下载/删除/状态）；缺省关闭零成本（开关 off 即文本检索逐字节旧行为）。 */
    setSecs.semantic = '<div class="set-row" data-sec="semantic">' + setLabelHtml(t('settings.semantic'), t('settings.semanticTip'))
      + '<div class="set-ctrl sem-ctrl">'
      + '<label class="set-check"><input type="checkbox" id="setSemEnabled"> ' + t('settings.semanticEnabled') + '</label>'
      + '<div class="sem-row"><select class="minput" id="setSemBackend">'
      + '<option value="">' + t('settings.semanticBackendOff') + '</option>'
      + '<option value="bge-small-zh-q8">' + t('settings.semanticBackendLocal') + '</option>'
      + '<option value="custom-endpoint" disabled>' + t('settings.semanticBackendCustom') + '</option>'
      + '</select></div>'
      + '<div class="s" id="setSemStatus">' + t('common.loading') + '</div>'
      + '<div class="sem-row"><button class="mbtn" id="setSemBuild" disabled>' + t('settings.semanticBuild') + '</button><span class="s" id="setSemModel"></span></div>'
      + '</div></div>';
    setSecs.data = '<div class="set-row" data-sec="data">' + setLabelHtml(t('settings.data'), t('settings.dataTip')) + '<div class="set-ctrl"><button class="mbtn" id="setExport">' + t('settings.exportAll') + '</button><button class="mbtn" id="setImport">' + t('settings.importBtn') + '</button><button class="mbtn" id="setTrash">' + t('topbar.trash') + '</button></div></div>';
    setSecs.assets = '<div class="set-row" data-sec="assets">' + setLabelHtml(t('settings.assets'), t('settings.assetsTip')) + '<div class="set-ctrl"><button class="mbtn" id="setPrune">' + t('settings.pruneBtn') + '</button></div></div>';
    setSecs.suggest = '<div class="set-row" data-sec="suggest">' + setLabelHtml(t('settings.suggest'), t('settings.suggestTip')) + '<div class="set-ctrl"><button class="mbtn" id="setSuggest">' + t('settings.openBtn') + '</button></div></div>';
    /* 工作记忆 v0「工作记忆」区：启用沉淀引导（约定笔记方案）+ 日志卫生两级窗口 */
    setSecs.memory = '<div class="set-row" data-sec="memory">' + setLabelHtml(t('settings.memory'), t('settings.memoryTip')) + '<div class="set-ctrl" id="setMemoryCtrl"><span class="s">' + t('settings.memProbing') + '</span></div></div>';
    setSecs.logweek = '<div class="set-row" data-sec="logweek">' + setLabelHtml(t('settings.logWeek'), t('settings.logWeekTip')) + '<div class="set-ctrl"><input class="minput" id="setLogWeek" type="number" min="0" step="1" style="width:90px" value="' + logWeekDays + '"></div></div>';
    setSecs.logmonth = '<div class="set-row" data-sec="logmonth">' + setLabelHtml(t('settings.logMonth'), t('settings.logMonthTip')) + '<div class="set-ctrl"><input class="minput" id="setLogMonth" type="number" min="0" step="1" style="width:90px" value="' + logRetentionDays + '"></div></div>';
    /* 键盘流速查表入口（notes-034-f-cheatsheet）：内容与 panels/keyboard.js 逐键核对；? 键为直达通道 */
    setSecs.cheatsheet = '<div class="set-row" data-sec="cheatsheet">' + setLabelHtml(t('settings.cheatsheet'), t('settings.cheatsheetTip')) + '<div class="set-ctrl"><button class="mbtn" id="setCheatsheet">' + t('settings.viewBtn') + '</button></div></div>';
    /* onboarding 轻量（notes-034-batch3）：四概念一行一条前置解释（注入/约定·资料/目录注入/派发）——新用户先懂「为什么要配这些」再看字段；
       0.4.7-B①c：bullet 逐条 div.onb-li 悬挂缩进（续行对齐文字起点，<br> 连排折行参差消除）；0.4.8：速览独立于分组导航之上（不归组） */
    var setOnb = '<div class="modal-hint onb"><b>' + t('settings.onboardTitle') + '</b>'
      + '<div class="onb-li">' + t('settings.onboardInject') + '</div>'
      + '<div class="onb-li">' + t('settings.onboardRoles') + '</div>'
      + '<div class="onb-li">' + t('settings.onboardCatalog') + '</div>'
      + '<div class="onb-li">' + t('settings.onboardDispatch') + '</div></div>';
    $('setBody').innerHTML = setOnb + setGroupsHtml(setSecs);
    /* 0.4.7-B①b：说明 ⓘ 展开/收拢接线（长说明初态 .cl 收折两行；点击切换，按钮原生可聚焦） */
    $('setBody').querySelectorAll('.sx').forEach(function (el) { el.onclick = function () { var s = el.parentElement.querySelector('.s'); if (s) s.classList.toggle('cl') } });
    setNavWire();   /* 0.4.8（notes-048-settings-groups）：分组导航接线（rail/chips 点击定位 + 滚动反高亮） */
    /* 0.4.8（notes-048-lang-topbar）：语言项下线——原 #setLang onchange 就地重渲染链路（setLang+flush+重跑 openSettings+滚动还原）
       随切换入口上顶栏撤除（顶栏钮点击时设置卡必已关闭——modal 遮罩挡住顶栏，打开态切语言场景消失） */
    var sel = $('setLlmSel');
    if (sel) sel.onchange = function () {
      var v = this.value;
      var p = v ? { provider: v.split('/')[0], model: v.split('/').slice(1).join('/') } : null;
      saveSettings({ llm: p }, p ? t('settings.savedLlm', { name: v }) : t('settings.restoredFollow'));
    };
    var sp = $('setLlmSave');
    if (sp) sp.onclick = function () {
      var pv = $('setLlmP').value.trim(), mv = $('setLlmM').value.trim();
      if (!pv || !mv) { modalErr(t('settings.llmRequired')); return }
      saveSettings({ llm: { provider: pv, model: mv } }, t('settings.savedLlm', { name: pv + ' / ' + mv }));
    };
    var sc = $('setLlmClear');
    if (sc) sc.onclick = function () { saveSettings({ llm: null }, t('settings.restoredFollow')); openSettings() };
    /* P1 时效衰减提醒阈值：失焦/Enter 即保存（非负整数；0 = 关闭；非法输入报错不落盘） */
    $('setStale').onchange = function () {
      var v = String(this.value).trim();
      if (!/^\d+$/.test(v)) { modalErr(t('settings.staleInvalid')); return }
      saveSettings({ staleDays: parseInt(v, 10) }, +v === 0 ? t('settings.staleOff') : t('settings.savedStale', { v: v }));
    };
    /* 文件夹嵌套深度上限：失焦/Enter 即保存（非负整数；0 = 不限层数；非法输入报错不落盘） */
    $('setMaxDepth').onchange = function () {
      var v = String(this.value).trim();
      if (!/^\d+$/.test(v)) { modalErr(t('settings.maxDepthInvalid')); return }
      saveSettings({ maxFolderDepth: parseInt(v, 10) }, +v === 0 ? t('settings.maxDepthUnlimited') : t('settings.savedMaxDepth', { v: v }));
    };
    /* P1 注入体积预算（约，字符数）：失焦/Enter 即保存（非负整数；0 = 不限） */
    $('setBudget').onchange = function () {
      var v = String(this.value).trim();
      if (!/^\d+$/.test(v)) { modalErr(t('settings.budgetInvalid')); return }
      saveSettings({ injectBudgetChars: parseInt(v, 10) }, +v === 0 ? t('settings.budgetOff') : t('settings.savedBudget', { v: v }));
    };
    $('setExport').onclick = function () { openExport() };
    $('setImport').onclick = function () { openImport() };
    $('setTrash').onclick = function () { openTrash() };
    $('setPrune').onclick = function () { openPrune() };
    $('setInjectPreview').onclick = function () { openInjectPreview() };
    $('setInjectManager').onclick = function () { openInjectManager('settings') };   /* from=settings：单层返回栈（notes-041-settings-back），关闭二级面板自动回本卡 */
    $('setSuggest').onclick = function () { openSuggest() };
    $('setCheatsheet').onclick = function () { openCheatsheet() };
    /* ===== 0.5.0④ 语义检索节接线（notes-050-sem-settings）：总开关/后端下拉/状态行/构建按钮/模型管理 =====
       红线：①UI 写 settings.semantic 必须 enabled+backend 双键整写（settings-set 整对象替换口径，单写 backend 丢 enabled）；
         ②打开总开关后自动触发 notes-vectors-rebuild 回填存量笔记（否则 enabled 打开后存量不入队，indexed<indexable 静默漏历史）；
         ③模型/后端删除/切换只撤激活后端命名空间、旧后端残留——切换后端后由重建承接（见 semDoBuild）。 */
    var semantic0 = settings.semantic || {};
    semState = {
      enabled: semantic0.enabled === true,
      backend: (typeof semantic0.backend === 'string' && semantic0.backend) ? semantic0.backend : 'bge-small-zh-q8',
      model: (semantic0.model && typeof semantic0.model === 'object') ? semantic0.model : null,
      status: null, building: false
    };
    var semChk = $('setSemEnabled'), semSel = $('setSemBackend'), semBuildBtn = $('setSemBuild');
    if (semChk) semChk.checked = semState.enabled;
    if (semSel) semSel.value = (semState.backend === 'bge-small-zh-q8') ? 'bge-small-zh-q8' : (semState.backend || '');
    if (semBuildBtn) semBuildBtn.disabled = !semState.enabled || semState.building;
    semRenderStatus();
    semRenderModel();
    if (semChk) semChk.onchange = function () { semDoToggle(this.checked) };
    if (semSel) semSel.onchange = function () {
      var v = this.value;
      if (v === 'bge-small-zh-q8') {
        semWrite(semState.enabled, v).then(function () { toast(t('settings.semanticBackendSaved', { name: 'bge-small-zh' })); semRenderStatus(); });
      } else if (v === '') {
        semWrite(false, '').then(function () { if (semChk) semChk.checked = false; toast(t('settings.semanticEnabledOff')); semRenderStatus(); });
      }
      /* 'custom' 自定义端点占位 = disabled 禁用态（不可选，无分支） */
      var b = $('setSemBuild'); if (b) b.disabled = !semState.enabled || semState.building;
    };
    if (semBuildBtn) semBuildBtn.onclick = function () { semDoBuild() };
    /* 工作记忆 v0：日志卫生窗口失焦即保存（非负整数；月聚合 0=关闭本级；非法输入报错不落盘） */
    $('setLogWeek').onchange = function () {
      var v = String(this.value).trim();
      if (!/^\d+$/.test(v)) { modalErr(t('settings.logWeekInvalid')); return }
      saveSettings({ logWeekAfterDays: parseInt(v, 10) }, t('settings.savedLogWeek', { v: v }));
    };
    $('setLogMonth').onchange = function () {
      var v = String(this.value).trim();
      if (!/^\d+$/.test(v)) { modalErr(t('settings.logMonthInvalid')); return }
      saveSettings({ logRetentionDays: parseInt(v, 10) }, +v === 0 ? t('settings.logMonthOff') : t('settings.savedLogMonth', { v: v }));
    };
    /* 工作记忆 v0 r3：沉淀引导状态行（单一事实源 = contractType: memory-guide（tag 兼容发现键）且 inject=true 的笔记；停用=关 inject，查看=跳转约定笔记） */
    rpc('notes-memory-guide', { op: 'status' }).then(function (st) { renderMemoryStatus(st && !st.error ? st : { enabled: false, noteId: '' }) }).catch(function () { renderMemoryStatus({ enabled: false, noteId: '' }) });
    /* LLM 月度用量预算提醒：失焦/Enter 即保存（非负整数；0 = 关闭） */
    $('setUsageBudget').onchange = function () {
      var v = String(this.value).trim();
      if (!/^\d+$/.test(v)) { modalErr(t('settings.usageBudgetInvalid')); return }
      usageBudget = parseInt(v, 10);
      saveSettings({ usageBudgetMonthly: usageBudget }, +v === 0 ? t('settings.usageBudgetOff') : t('settings.savedUsageBudget', { v: fmtTok(+v) }));
    };
    /* 0.4.7-B⑦：整理长度上限失焦/Enter 即保存（非负整数；0 = 按所配模型自动——host 侧删 override 回落模型表） */
    $('setOrgMax').onchange = function () {
      var v = String(this.value).trim();
      if (!/^\d+$/.test(v)) { modalErr(t('settings.organizeMaxInvalid')); return }
      saveSettings({ organizeMaxChars: parseInt(v, 10) }, +v === 0 ? t('settings.organizeMaxAuto') : t('settings.savedOrganizeMax', { v: v }));
    };
    /* dirty 跟踪（notes-settings-feedback）：输入即刷新 保存/还原 按钮态（oninput 只刷新不落盘；失焦/Enter 即存的 onchange 链路不变） */
    ['setStale', 'setMaxDepth', 'setBudget', 'setUsageBudget', 'setLogWeek', 'setLogMonth', 'setOrgMax', 'setLlmP', 'setLlmM'].forEach(function (id) { var el = $(id); if (el) el.oninput = setDirtyRefresh });
    setDirtyRefresh();
    /* 单层返回栈（notes-041-settings-back）：二级面板返回重开时还原离开时的滚动位置（一次性消费，随后清零防串档） */
    if (modalBackScroll > 0 && $('modal')) $('modal').scrollTop = modalBackScroll;
    modalBackScroll = 0;
    /* LLM 用量统计（notes-token-stats）：独立 RPC 填充用量区；超月度预算 toast 提醒（不阻断） */
    rpc('notes-usage-get', {}).then(function (u) {
      var ub = $('setUsageBody');
      if (!ub) return;
      if (!u || u.error) { ub.innerHTML = '<span class="s">' + t('settings.usageLoadFailed') + '</span>'; return }
      ub.innerHTML = '<span class="usage-line">' + t('settings.usageLine', { today: fmtTok(u.today.total), week: fmtTok(u.week.total), month: fmtTok(u.month.total), all: fmtTok(u.allTime.total) }) + (u.calls > 0 ? t('settings.usageCalls', { n: u.calls }) : '') + '</span>'
        + '<span class="s">' + t('settings.usageByFeature', { classify: fmtTok(u.byFeature.classify.allTime), organize: fmtTok(u.byFeature.organize.allTime), summarize: fmtTok(u.byFeature.summarize.allTime) }) + (u.estimatedTokens > 0 ? t('settings.usageEstimated') : '') + '</span>';
      if (usageBudget > 0 && u.month && u.month.total > usageBudget) toast(t('settings.usageOverBudget', { used: fmtTok(u.month.total), budget: fmtTok(usageBudget) }));
    }).catch(function () { var ub = $('setUsageBody'); if (ub) ub.innerHTML = '<span class="s">' + t('settings.usageLoadFailed') + '</span>' });
  }).catch(function (e) { modalErr(t('settings.loadFailed', { msg: e && e.message || e })) });
}
function saveSettings(patch, okMsg) {
  setInflight++; setDirtyRefresh();
  rpc('notes-settings-set', patch).then(function (res) {
    if (res && res.error) { modalErr(res.error); return }
    setPersistMerge(patch);
    if ('organizeMaxChars' in patch || 'llm' in patch) { if (typeof orgMaxCacheReset === 'function') orgMaxCacheReset() }   /* 0.4.7-B⑦：整理上限/模型变更 → 引导卡生效值缓存失效（organize.js 全局互通） */
    if (okMsg) toast(okMsg);
  }).catch(function (e) { modalErr(t('common.saveFailed', { msg: e && e.message || e })) }).then(function () { setInflight--; setDirtyRefresh() });
}
/* ===== 设置卡交互反馈（notes-settings-feedback）：dirty 状态机 + 显式保存 / 还原 / 关闭兜底 flush ===== */
/* dirty 判定：在途待写 > 0 或 任一控件值 ≠ 打开时快照 */
function setDirtyCompute() {
  if (!setSnap) return false;
  if (setInflight > 0) return true;
  if ($('setLlmSel') && $('setLlmSel').value !== (setSnap.llmP && setSnap.llmM ? setSnap.llmP + '/' + setSnap.llmM : '')) return true;
  if ($('setLlmP') && ($('setLlmP').value.trim() !== setSnap.llmP || $('setLlmM').value.trim() !== setSnap.llmM)) return true;
  var nums = [['setStale', 'stale'], ['setMaxDepth', 'maxDepth'], ['setBudget', 'budget'], ['setUsageBudget', 'usageBudget'], ['setLogWeek', 'logWeek'], ['setLogMonth', 'logMonth'], ['setOrgMax', 'orgMax']];
  for (var i = 0; i < nums.length; i++) { var el = $(nums[i][0]); if (el && String(el.value).trim() !== setSnap[nums[i][1]]) return true }
  return false;
}
/* dirty 状态机出口：保存（accent 实心主按钮）/还原（次按钮）enabled ⇄ disabled 灰显 */
function setDirtyRefresh() {
  var d = setDirtyCompute();
  var sv = $('setSave'), rs = $('setRestore');
  if (sv) sv.disabled = !d || setSaving;
  if (rs) rs.disabled = !d || setSaving;
}
/* 已落盘镜像逐键跟进（settings-set 成功后才调） */
function setPersistMerge(patch) {
  if (!setPersist) return;
  var n = {}, k;
  for (k in setPersist) n[k] = setPersist[k];
  if ('llm' in patch) { n.llmP = patch.llm ? patch.llm.provider : ''; n.llmM = patch.llm ? patch.llm.model : '' }
  if ('staleDays' in patch) n.stale = String(patch.staleDays);
  if ('maxFolderDepth' in patch) n.maxDepth = String(patch.maxFolderDepth);
  if ('injectBudgetChars' in patch) n.budget = String(patch.injectBudgetChars);
  if ('usageBudgetMonthly' in patch) n.usageBudget = String(patch.usageBudgetMonthly);
  if ('logWeekAfterDays' in patch) n.logWeek = String(patch.logWeekAfterDays);
  if ('logRetentionDays' in patch) n.logMonth = String(patch.logRetentionDays);
  if ('organizeMaxChars' in patch) n.orgMax = String(patch.organizeMaxChars > 0 ? patch.organizeMaxChars : 0);   /* 0.4.7-B⑦：0 = 自动（host 删 override），镜像口径同控件 */
  setPersist = n;
}
/* 低层写通道（保存/还原/关闭兜底 flush 共用）：不逐键 toast，错误 reject 透传；在途计数 + 已落盘镜像跟进 */
function settingsSetQuiet(patch) {
  setInflight++; setDirtyRefresh();
  return rpc('notes-settings-set', patch).then(function (res) {
    if (res && res.error) throw new Error(res.error);
    setPersistMerge(patch);
    return res;
  }).then(function (r) { setInflight--; setDirtyRefresh(); return r }, function (e) { setInflight--; setDirtyRefresh(); throw e });
}
/* 数值字段登记表（DOM id ↔ 快照键 ↔ 设置 RPC 键 ↔ 校验文案 i18n key）：保存校验/兜底 flush/还原回滚共用同一份口径；
   第 4 列为字典 key（用时 t() 取当下语言——模块级登记表在加载期求值，不能直接存译文） */
var SET_NUM_FIELDS = [
  ['setStale', 'stale', 'staleDays', 'settings.staleInvalid'],
  ['setMaxDepth', 'maxDepth', 'maxFolderDepth', 'settings.maxDepthInvalid'],
  ['setBudget', 'budget', 'injectBudgetChars', 'settings.budgetInvalid'],
  ['setUsageBudget', 'usageBudget', 'usageBudgetMonthly', 'settings.usageBudgetInvalid'],
  ['setLogWeek', 'logWeek', 'logWeekAfterDays', 'settings.logWeekInvalid'],
  ['setLogMonth', 'logMonth', 'logRetentionDays', 'settings.logMonthInvalid'],
  ['setOrgMax', 'orgMax', 'organizeMaxChars', 'settings.organizeMaxInvalid'],
];
/* 当前控件值 → 快照对象（保存成功后快照跟进用） */
function setSnapFromControls() {
  var s = { llmP: '', llmM: '', stale: '', maxDepth: '', budget: '', usageBudget: '', logWeek: '', logMonth: '', orgMax: '' };
  if ($('setLlmSel')) { var v = $('setLlmSel').value; s.llmP = v ? v.split('/')[0] : ''; s.llmM = v ? v.split('/').slice(1).join('/') : '' }
  if ($('setLlmP')) { s.llmP = $('setLlmP').value.trim(); s.llmM = $('setLlmM').value.trim() }
  for (var i = 0; i < SET_NUM_FIELDS.length; i++) { var el = $(SET_NUM_FIELDS[i][0]); if (el) s[SET_NUM_FIELDS[i][1]] = String(el.value).trim() }
  return s;
}
/* 「保存」：显式确认 + 兜底 flush——先校验全部数值字段（任一非法即中止并报错，改动保留继续编辑），
   再串行落盘全部「控件值 ≠ 已落盘」的键（串行防写竞态），全部成功后快照跟进 + toast「设置已保存」+ dirty 复位 */
function doSettingsSaveAll() {
  if (setSaving || !setSnap || !setPersist) return;
  var i, el, v;
  for (i = 0; i < SET_NUM_FIELDS.length; i++) { el = $(SET_NUM_FIELDS[i][0]); if (el && !/^\d+$/.test(String(el.value).trim())) { modalErr(t(SET_NUM_FIELDS[i][3])); return } }
  var patches = [];
  /* 手输 LLM 两框齐备且 ≠ 已落盘才补写（下拉选择/开关变更即存无待写；单框不齐 = 存量失焦口径静默跳过） */
  if ($('setLlmP')) {
    var pv = $('setLlmP').value.trim(), mv = $('setLlmM').value.trim();
    if (pv && mv && (pv !== setPersist.llmP || mv !== setPersist.llmM)) patches.push({ llm: { provider: pv, model: mv } });
  }
  for (i = 0; i < SET_NUM_FIELDS.length; i++) {
    el = $(SET_NUM_FIELDS[i][0]); if (!el) continue;
    v = String(el.value).trim();
    if (v !== setPersist[SET_NUM_FIELDS[i][1]]) { var o = {}; o[SET_NUM_FIELDS[i][2]] = parseInt(v, 10); patches.push(o) }
  }
  setSaving = true; setDirtyRefresh();
  var seq = Promise.resolve();
  patches.forEach(function (p) { seq = seq.then(function () { return settingsSetQuiet(p) }) });
  seq.then(function () {
    setSaving = false;
    setSnap = setSnapFromControls();   /* 快照跟进到当前控件值（显式确认完成 → dirty 复位，保存按钮回禁用态） */
    toast(t('settings.savedAll'));
    setDirtyRefresh();
  }, function (e) { setSaving = false; modalErr(t('common.saveFailed', { msg: e && e.message || e })); setDirtyRefresh() });
}
/* 「还原」：回滚到打开时快照——已落盘 ≠ 快照的键逐键串行写回（逐键恢复），全部控件复位到快照值 */
function doSettingsRestoreAll() {
  if (setSaving || !setSnap || !setPersist) return;
  var s = setSnap, p = setPersist;
  var patches = [];
  if (p.llmP !== s.llmP || p.llmM !== s.llmM) patches.push({ llm: (s.llmP && s.llmM) ? { provider: s.llmP, model: s.llmM } : null });
  for (var i = 0; i < SET_NUM_FIELDS.length; i++) { if (p[SET_NUM_FIELDS[i][1]] !== s[SET_NUM_FIELDS[i][1]]) { var o = {}; o[SET_NUM_FIELDS[i][2]] = parseInt(s[SET_NUM_FIELDS[i][1]], 10); patches.push(o) } }
  setSaving = true; setDirtyRefresh();
  var seq = Promise.resolve();
  patches.forEach(function (pt) { seq = seq.then(function () { return settingsSetQuiet(pt) }) });
  seq.then(function () {
    setSaving = false;
    /* UI 复位到打开时快照 */
    if ($('setLlmSel')) $('setLlmSel').value = (s.llmP && s.llmM) ? s.llmP + '/' + s.llmM : '';
    if ($('setLlmP')) { $('setLlmP').value = s.llmP; $('setLlmM').value = s.llmM }
    for (var i = 0; i < SET_NUM_FIELDS.length; i++) { var el = $(SET_NUM_FIELDS[i][0]); if (el) el.value = s[SET_NUM_FIELDS[i][1]] }
    toast(t('settings.restoredAll'));
    setDirtyRefresh();
  }, function (e) { setSaving = false; modalErr(t('settings.restoreFailed', { msg: e && e.message || e })); setDirtyRefresh() });
}
/* 关闭兜底 flush（✕/Esc/点遮罩同口径，modalCloseHook 挂接）：「控件值 ≠ 已落盘」的有效改动串行静默落盘；
   非法输入按存量口径丢弃（同关闭即弃）；≥1 项落盘则 toast 一次确认 */
function flushSettingsPending() {
  if (!setPersist || !$('setBody')) return;
  var patches = [];
  if ($('setLlmP')) {
    var pv = $('setLlmP').value.trim(), mv = $('setLlmM').value.trim();
    if (pv && mv && (pv !== setPersist.llmP || mv !== setPersist.llmM)) patches.push({ llm: { provider: pv, model: mv } });
  }
  for (var i = 0; i < SET_NUM_FIELDS.length; i++) {
    var el = $(SET_NUM_FIELDS[i][0]); if (!el) continue;
    var v = String(el.value).trim();
    if (/^\d+$/.test(v) && v !== setPersist[SET_NUM_FIELDS[i][1]]) { var o = {}; o[SET_NUM_FIELDS[i][2]] = parseInt(v, 10); patches.push(o) }
  }
  if (!patches.length) return;
  var seq = Promise.resolve();
  patches.forEach(function (p) { seq = seq.then(function () { return settingsSetQuiet(p) }) });
  seq.then(function () { toast(t('settings.savedAll')) }, function (e) { toast(t('settings.flushSaveFailed', { msg: e && e.message || e })) });
}
/* ================= 0.5.0④ 语义检索节 helper（notes-050-sem-settings）：状态行/开关翻转/构建编排/模型管理 ================= */
/* 后端显示名：bge-small-zh-q8 → bge-small-zh；其余直显 id */
function semBackendLabel(id) { return id === 'bge-small-zh-q8' ? 'bge-small-zh' : (id || '—'); }
/* 字节数人话（B/KB/MB） */
function semFmtBytes(n) {
  n = Math.max(0, Number(n) || 0);
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
/* ISO 时间 → YYYY-MM-DD HH:MM（本地态） */
function semFmtTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  var p = function (x) { return (x < 10 ? '0' : '') + x };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
/* 语义设置整写：enabled+backend 双键恒同写（红线①：settings-set 整对象替换口径，单写 backend 丢 enabled）；model 传 null 才清下载状态 */
function semWrite(enabled, backend, model) {
  var s = { enabled: !!enabled, backend: backend || 'bge-small-zh-q8' };
  if (model === null) s.model = null;
  return rpc('notes-settings-set', { semantic: s }).then(function (res) {
    if (res && res.error) { modalErr(res.error); throw new Error(res.error); }
    if (semState) { semState.enabled = s.enabled; semState.backend = s.backend; if (model === null) semState.model = null; }
    return res;
  });
}
/* 索引状态行渲染（消费① notes-vectors-status）：关=未启用 / 报错=降级态 / bge 无模型=未下载 / 有 lastBuiltAt=N/M 篇 / 否则=尚未构建 */
function semRenderStatus() {
  var el = $('setSemStatus');
  if (!el || !semState) return;
  rpc('notes-vectors-status', {}).then(function (st) {
    var el2 = $('setSemStatus');
    if (!el2 || !semState) return;
    var html;
    if (!semState.enabled) html = t('settings.semanticStatusOff');
    else if (st && st.error) html = t('settings.semanticStatusError', { msg: st.error });
    else if (!st || st.ok !== true) html = t('settings.semanticStatusError', { msg: 'unknown' });
    else if (semState.backend === 'bge-small-zh-q8' && !(semState.model && semState.model.bytes > 0) && !st.lastBuiltAt) html = t('settings.semanticStatusNoModel');
    else if (st.lastBuiltAt) html = t('settings.semanticStatus', { indexed: st.indexed || 0, indexable: st.indexable || 0, backend: semBackendLabel(st.backend), time: semFmtTime(st.lastBuiltAt) });
    else html = t('settings.semanticStatusNever');
    el2.innerHTML = esc(html);
  }).catch(function (e) {
    var el3 = $('setSemStatus');
    if (el3) el3.innerHTML = esc(t('settings.semanticStatusError', { msg: (e && e.message) || e }));
  });
}
/* 模型管理行渲染（消费② wasm 模型状态：settings.semantic.model 记录；app 页提供删除/重下，面板只读） */
function semRenderModel() {
  var el = $('setSemModel');
  if (!el || !semState) return;
  var m = semState.model;
  var html = esc(t('settings.semanticModel')) + (m && m.bytes > 0 ? esc(t('settings.semanticModelSize', { size: semFmtBytes(m.bytes) })) : esc(t('settings.semanticModelNone')));
  if (typeof wasmModelDelete === 'function') {
    html += ' <button class="mbtn" id="setSemModelDel">' + t('settings.semanticModelDelete') + '</button>';
    html += ' <button class="mbtn" id="setSemModelRe">' + t('settings.semanticModelRedownload') + '</button>';
  }
  el.innerHTML = html;
  var del = $('setSemModelDel'), re = $('setSemModelRe');
  if (del) del.onclick = function () { semDoModelDelete() };
  if (re) re.onclick = function () { semDoModelRedownload() };
}
/* 模型删除（消费② wasmModelDelete）：清 Cache API → 清 settings.semantic.model → 状态回落（未下载） */
function semDoModelDelete() {
  var doDel = (typeof wasmModelDelete === 'function') ? wasmModelDelete() : Promise.resolve(0);
  doDel.then(function () {
    return semWrite(semState.enabled, semState.backend, null);
  }).then(function () { semRenderModel(); semRenderStatus(); })
    .catch(function () { semRenderModel(); semRenderStatus(); });
}
/* 模型重下（消费② wasmModelEnsureDownloaded）：显式带进度下载 → 记录状态 → 状态行/模型行刷新 */
function semDoModelRedownload() {
  var p = (typeof wasmModelEnsureDownloaded === 'function')
    ? wasmModelEnsureDownloaded(function (i, n, loaded, total) { var s = $('setSemStatus'); if (s) s.innerHTML = t('settings.semanticDownloading', { pct: total > 0 ? Math.round(loaded / total * 100) : 0 }); })
    : Promise.reject(new Error('wasm 不可用'));
  p.then(function () { return (typeof wasmModelRecordState === 'function') ? wasmModelRecordState() : null; })
   .then(function () { semRenderModel(); semRenderStatus(); })
   .catch(function () { semRenderModel(); semRenderStatus(); });
}
/* 构建索引（0.5.0 R2 notes-051-save-embed：恒走 host notes-vectors-rebuild）——R1 起 bge 嵌入已迁回 host 进程
   （onnxruntime-web 纯 wasm 在宿主跑），浏览器 wasm 编排（模型下载→嵌入→put 全量回写）退役不再被调用（R3 才删码，本卡只改路由）；
   rebuild 快速失败闸已拆，存量回填真跑（分段嵌入+replace put），进度经轮询 status（计数涨）。
   0.5.0 P0（notes-050-model-proxy）失败驻留报错：「构建索引」是用户显式动作——失败必须 sticky 报错条（含原因：下载失败/网络/镜像错误），
   不准静默跳回按钮态（静默降级只适用于后台预取，不适用显式点击）。 */
function semDoBuild() {
  if (!semState || semState.building) return;
  semState.building = true;
  var btn = $('setSemBuild');
  if (btn) { btn.disabled = true; btn.textContent = t('settings.semanticBuilding'); }
  semClearBuildError();
  var backend = semState.backend;
  var finish = function () {
    if (!semState) return;
    semState.building = false;
    var b2 = $('setSemBuild');
    if (b2) { b2.disabled = !semState.enabled; b2.textContent = t('settings.semanticBuild'); }
    // 0.5.0 P0-2（notes-050-wasm-shape）：构建完成后刷模型行——wasmModelRecordState 已写 settings，但 semState.model 是
    //   打开时快照，不刷新会滞留「未下载」；bge 构建后读 wasmModelStatus 回填 bytes 再渲染（fake 后端无模型，跳过）。
    var refresh = (backend === 'bge-small-zh-q8' && typeof wasmModelStatus === 'function') ? wasmModelStatus() : Promise.resolve(null);
    refresh.then(function (st) {
      if (st && semState && backend === 'bge-small-zh-q8') semState.model = { backend: st.backend, bytes: st.downloadedBytes, downloadedAt: new Date().toISOString(), source: 'cache-api' };
      semRenderStatus(); semRenderModel();
    }, function () {
      semRenderStatus(); semRenderModel();
    });
  };
  var fail = function (err) {
    var msg = (err && err.message) ? String(err.message) : String(err);
    semShowBuildError(msg);
    finish();
  };
  /* 0.5.0 R2：双端构建按钮同路由——恒调 host rebuild（浏览器 wasm 编排不再被调用，R3 删码） */
  rpc('notes-vectors-rebuild', { backend: backend }).then(function (r) {
    if (r && r.error) { fail(new Error(r.error)); return; }
    finish();
  }, fail);
}
/* 构建失败 sticky 报错条（0.5.0 P0）：原因驻留（复用设置卡 #mErr 错误区），再次构建/成功才清除 */
function semShowBuildError(msg) { modalErr(t('settings.semanticBuildFailed', { msg: msg })); }
function semClearBuildError() { var e = $('mErr'); if (e) { e.textContent = ''; e.style.display = 'none'; } }
/* 总开关翻转：打开 → 写 enabled+backend 双键 + 自动触发 notes-vectors-rebuild 回填存量（红线②：存量不入队则静默漏历史）；
   关闭 → 仅写双键（关=文本检索逐字节旧行为），零重建 */
function semDoToggle(on) {
  if (!semState) return;
  var el = $('setSemEnabled');
  if (on) {
    semWrite(true, semState.backend).then(function () {
      toast(t('settings.semanticEnabledOn'));
      var b = $('setSemBuild'); if (b) b.disabled = semState.building;
      semRenderStatus();
      semDoBuild();   /* 激活流程自动回填：打开总开关即 rebuild（notes-vectors-rebuild） */
    }).catch(function () {
      if (semState) semState.enabled = false;
      if (el) el.checked = false;
      semRenderStatus();
    });
  } else {
    semWrite(false, semState.backend).then(function () {
      toast(t('settings.semanticEnabledOff'));
      var b = $('setSemBuild'); if (b) b.disabled = true;
      semRenderStatus();
    }).catch(function () { if (el) el.checked = true; });
  }
}
