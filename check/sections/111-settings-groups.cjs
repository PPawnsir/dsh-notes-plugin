// 节 111. 0.4.8 设置弹窗分组导航（notes-048-settings-groups；UX候选D n-mus81ly6hvh2：16+ 节平铺缺分组导航）
// 覆盖：① 七组分类常量表冻结（常规/编辑器/检索与注入/派发与调度/AI/数据与存储/关于，三端同构同序）；
//   ② 全覆盖一致性（常量表 rows ⇄ 三端实际节 id 集双向相等——新节漏登记/幽灵登记即红，登记处纪律的常驻闸）；
//   ③ 渲染行为级（setGroupsHtml 纯函数 eval：空组隐身/表序输出/rail+chips+组壳齐全）；
//   ④ 导航结构三端锚（rail 图标+组名 role=navigation / chips 窄宽退化 / 点击定位 48px 吸顶补偿 / 滚动反高亮 56px 阈值 / aria-current）；
//   ⑤ 样式三端（sticky rail + chips 横条 + 559px 媒体查询）+ i-info 图标三端 + i18n 双语七组名；
//   ⑥ 零回归锁（0.4.7-B sticky 标题/描述收折/LLM 区邻接/dirty 链路/22 控件 id）。
// 0.4.8 联动（notes-048-lang-topbar）：语言节随切换上顶栏下线——17 节（0.5.0④ 语义检索节入驻）/ 非空 4 组（常规转空组登记槽），计数断言同步。
// 交互级主战场（真机点击定位/反高亮/窄宽 chips）：e2e ㊺（app）+ ㊻（panel）。
module.exports = {
  id: "111",
  title: "111. 0.4.8 设置弹窗分组导航（七组常量表 + rail/chips + 滚动反高亮 + 窄宽退化）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR } = H
  section('111. 0.4.8 设置弹窗分组导航（七组常量表 + rail/chips + 滚动反高亮 + 窄宽退化）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const appSettings = read('src/app/modals/settings.js')
  const appHead = read('src/app/shell/head.html')
  const appBody = read('src/app/shell/body.html')
  const cliSettings = read('src/client/modals/settings.js')
  const cliIcons = read('src/client/kernel/icons.js')
  const stylesSrc = read('src/styles.css')
  const protoV2Src = read('design/notes-ui-v2.html')
  const appSrc = read('packages/dsh-notes-plugin/app.html')
  const clientPkgSrc = read('packages/dsh-notes-plugin/lib/client.js')
  const grab = (f, v) => new Function(read('src/i18n/' + f) + '\nreturn ' + v)()
  const ZH = grab('zh.js', 'I18N_ZH'), EN = grab('en.js', 'I18N_EN')

  const GROUP_IDS = ['general', 'editor', 'inject', 'dispatch', 'ai', 'data', 'about']   /* 七组冻结序 */
  const GROUP_ZH = { general: '常规', editor: '编辑器', inject: '检索与注入', dispatch: '派发与调度', ai: 'AI', data: '数据与存储', about: '关于' }
  const GROUP_ICONS_APP = ['i-gear', 'i-note', 'i-bolt', 'i-clock', 'i-sparkle', 'i-folder', 'i-info']   /* client 无前缀同族 */
  /* 常量表提取（app/原型 var、client const；对象字面量数组直接 eval——表内只许字面量） */
  const grabGroups = (src, label) => {
    const m = src.match(/SET_GROUPS = \[([\s\S]*?)\n\s*\];?/)
    assert(m, label + ' SET_GROUPS 常量表可提取（须以 \\n]; 收尾）')
    return new Function('return [' + m[1] + ']')()
  }

  // ===== 111.1 七组冻结 + 三端同构 =====
  await t('0.4.8 分组常量表七组冻结：id/序/图标/labelKey 三端同构（常规/编辑器/派发与调度=空组登记槽）', () => {
    const gA = grabGroups(appSettings, 'app'), gC = grabGroups(cliSettings, 'client'), gP = grabGroups(protoV2Src, '原型')
    for (const [label, gs] of [['app', gA], ['client', gC], ['原型', gP]]) {
      assert.deepStrictEqual(gs.map(g => g.id), GROUP_IDS, label + ' 七组 id + 冻结序')
      assert.deepStrictEqual(gs.map(g => g.rows), gA.map(g => g.rows), label + ' rows 映射与 app 表逐组一致')
    }
    assert.deepStrictEqual(gA.map(g => g.icon), GROUP_ICONS_APP, 'app 组图标（i-* 族）')
    assert.deepStrictEqual(gP.map(g => g.icon), GROUP_ICONS_APP, '原型组图标与 app 一致')
    assert.deepStrictEqual(gC.map(g => g.icon), GROUP_ICONS_APP.map(s => s.slice(2)), 'client 组图标去 i- 前缀同族')
    for (const g of gA.concat(gC)) assert(g.labelKey === 'settings.group.' + g.id, 'labelKey = settings.group.<id> 命名纪律（' + g.id + '）')
    for (const g of gP) assert(g.label === GROUP_ZH[g.id], '原型组名静态中文与 zh 字典逐字一致（' + g.id + '：' + g.label + '）')
    // 空组登记槽在案（0.4.8 盘点：无编辑器/派发与调度类设置项；常规组语言节随 notes-048-lang-topbar 上顶栏下线——组定义保留待登记）
    assert.deepStrictEqual(gA.find(g => g.id === 'general').rows, [], '常规组=空组登记槽（0.4.8 语言节下线，notes-048-lang-topbar）')
    assert.deepStrictEqual(gA.find(g => g.id === 'editor').rows, [], '编辑器组=空组登记槽')
    assert.deepStrictEqual(gA.find(g => g.id === 'dispatch').rows, [], '派发与调度组=空组登记槽')
  })

  // ===== 111.2 全覆盖一致性（登记处纪律核心闸）=====
  await t('0.4.8 分组全覆盖一致：节 id 集 ⇄ 常量表 rows 双向相等（app/原型 data-sec + client settingsRows key 三端，漏登记即红）', () => {
    const gA = grabGroups(appSettings, 'app'), gP = grabGroups(protoV2Src, '原型')
    const flat = gA.reduce((a, g) => a.concat(g.rows), [])
    assert.strictEqual(new Set(flat).size, flat.length, '常量表 rows 无重复登记（实得 ' + flat.length + ' 节）')
    assert.strictEqual(flat.length, 17, '常量表登记 17 节（0.5.0④ 语义检索节入驻；notes-048-lang-topbar 语言节下线 -1；新增节须登记，此处同步改数）')
    /* app/原型：行壳 data-sec 锚全集 ⇄ 常量表 */
    for (const [label, src] of [['app', appSettings], ['原型', protoV2Src]]) {
      const ids = []; let m
      const re = /data-sec="([a-z]+)"/g
      while ((m = re.exec(src))) ids.push(m[1])
      assert.strictEqual(ids.length, 17, label + ' 行壳 data-sec 共 17 节（实得 ' + ids.length + '）')
      assert.strictEqual(new Set(ids).size, 17, label + ' data-sec 无重复')
      assert.deepStrictEqual(ids.slice().sort(), flat.slice().sort(), label + ' 节 id 集 ⇄ 常量表双向相等（漏登记/幽灵 id 即红）')
    }
    /* client：settingsRows key 全集 ⇄ 常量表 */
    const keys = []; let m2
    const re2 = /key: '([a-z]+)', label: tt\('settings\./g
    while ((m2 = re2.exec(cliSettings))) keys.push(m2[1])
    assert.strictEqual(keys.length, 17, 'client settingsRows 共 17 行（实得 ' + keys.length + '）')
    assert.strictEqual(new Set(keys).size, 17, 'client settingsRows key 无重复')
    assert.deepStrictEqual(keys.slice().sort(), flat.slice().sort(), 'client 行 key 集 ⇄ 常量表双向相等')
    assert(cliSettings.indexOf('g.rows.map(k => settingsRowByKey[k]).filter(Boolean)') >= 0, 'client 组壳行渲染走常量表 rows（key→行索引）')
    /* 三端节 id 集互等（app=原型=client） */
    const protoIds = []; const re3 = /data-sec="([a-z]+)"/g; let m3
    while ((m3 = re3.exec(protoV2Src))) protoIds.push(m3[1])
    assert.deepStrictEqual(protoIds.slice().sort(), keys.slice().sort(), '原型 ⇄ client 节 id 集一致（0.4.8 语言行随顶栏化同步摘除）')
  })

  // ===== 111.3 渲染行为级：setGroupsHtml/setGroupsVisible 纯函数 eval =====
  await t('0.4.8 分组渲染行为级：setGroupsHtml eval——空组隐身/表序输出/rail+chips+组壳齐全/缺节组整体消失', () => {
    const fn = (name) => {
      const m = appSettings.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n\\}'))
      assert(m, name + ' 可提取（app）')
      return m[0]
    }
    const src = 'var SET_GROUPS = [' + appSettings.match(/SET_GROUPS = \[([\s\S]*?)\n\s*\];?/)[1] + '\n];\n'
      + fn('setGroupsVisible') + '\n' + fn('setGroupsHtml') + '\nreturn { vis: setGroupsVisible, html: setGroupsHtml }'
    const tStub = (k) => ZH[k] || k
    const factory = new Function('t', 'icon', 'esc', src)
    const full = {}
    grabGroups(appSettings, 'app').forEach(g => g.rows.forEach(id => { full[id] = '<div class="set-row" data-sec="' + id + '">R</div>' }))
    const api = factory(tStub, () => '', (s) => s)
    const html = api.html(full)
    /* 空组隐身：general（0.4.8 语言节下线转空槽）/editor/dispatch 组壳与 rail/chips 项全不出现 */
    assert(html.indexOf('data-g="general"') < 0 && html.indexOf('data-g="editor"') < 0 && html.indexOf('data-g="dispatch"') < 0, '空组整组隐身（general/editor/dispatch 零渲染）')
    /* 表序输出：inject < ai < data < about（组壳 + rail 同序；0.4.8 常规组隐身，首可见组=检索与注入） */
    const ord = ['inject', 'ai', 'data', 'about']
    const pos = ord.map(id => html.indexOf('<div class="set-group" data-g="' + id + '">'))
    assert(pos.every(p => p >= 0) && pos.every((p, i) => i === 0 || p > pos[i - 1]), '组壳按常量表序输出（' + ord.join('<') + '）')
    /* rail/chips/组头/导航语义齐全 + 17 节各出现一次 */
    assert((html.match(/set-rail-item"/g) || []).length === 4 && (html.match(/set-chip"/g) || []).length === 4, 'rail/chips 各 4 项（非空组数；引号收尾口径防 .set-chips 容器误计）')
    assert((html.match(/set-group-t/g) || []).length === 4, '组头 4 个')
    assert(html.indexOf('role="navigation"') >= 0 && html.indexOf('aria-label="设置分组"') >= 0, 'rail 导航语义 + aria-label（zh 态）')
    assert((html.match(/data-sec="/g) || []).length === 17, '17 节各渲染一次')
    /* 组内节相对顺序不动：ai 组 llm<organizemax<usage<usagebudget<suggest（LLM 区邻接保留；组壳锚定带 class 前缀防 rail 项 data-g 误中） */
    const aiBlock = html.slice(html.indexOf('<div class="set-group" data-g="ai"'), html.indexOf('<div class="set-group" data-g="data"'))
    const aiOrd = ['llm', 'organizemax', 'usage', 'usagebudget', 'suggest'].map(id => aiBlock.indexOf('data-sec="' + id + '"'))
    assert(aiOrd.every(p => p >= 0) && aiOrd.every((p, i) => i === 0 || p > aiOrd[i - 1]), 'ai 组内节序不动（llm→organizemax 邻接）')
    /* 缺节组整体消失：摘除 cheatsheet → about 组（唯一节）整组隐身（0.4.8 前本断言用 language/general，语言节下线后改锚 about） */
    const partial = Object.assign({}, full); delete partial.cheatsheet
    const html2 = factory(tStub, () => '', (s) => s).html(partial)
    assert(html2.indexOf('data-g="about"') < 0 && html2.indexOf('data-sec="cheatsheet"') < 0, '组唯一节缺席 → 整组隐身')
    assert((html2.match(/data-sec="/g) || []).length === 16, '其余 16 节不受影响')
    /* 原型同构锚：同名函数 + 同表（label 静态中文口径由 111.1 锁） */
    assert(protoV2Src.indexOf('function setGroupsVisible(secs)') >= 0 && protoV2Src.indexOf('function setGroupsHtml(secs)') >= 0, '原型 setGroupsVisible/setGroupsHtml 同构')
  })

  // ===== 111.4 导航结构三端锚 =====
  await t('0.4.8 分组导航结构三端：rail(nav+aria)+chips+组壳+点击定位 48 补偿+滚动反高亮 56 阈值+aria-current', () => {
    for (const [label, s] of [['app', appSettings], ['原型', protoV2Src]]) {
      assert(s.indexOf("class=\"set-rail\" role=\"navigation\"") >= 0, label + ' rail 容器 role=navigation')
      assert(s.indexOf('class="set-rail-item"') >= 0 && s.indexOf('class="set-chip"') >= 0, label + ' rail-item + chip 项')
      assert(s.indexOf('class="set-group" data-g=') >= 0 && s.indexOf('class="set-group-t"') >= 0, label + ' 组壳 + 组头')
      assert(s.indexOf('function setNavWire()') >= 0 && s.indexOf("modal.addEventListener('scroll', spy, { passive: true })") >= 0, label + ' 滚动监听接线（滚动容器=#modal，0.4.7-B sticky 同容器）')
      assert(s.indexOf('- 48') >= 0 && s.indexOf('<= 56') >= 0, label + ' 点击定位吸顶补偿 48px + 反高亮阈值 56px')
      assert(s.indexOf("setAttribute('aria-current', 'true')") >= 0, label + ' 当前组 aria-current')
      assert(s.indexOf('setNavWire();') >= 0, label + ' openSettings 渲染后接线')
    }
    /* client（React）：同款结构 + scroll-spy effect */
    assert(cliSettings.indexOf("className: 'dsh-notes-settings-rail', role: 'navigation'") >= 0, 'client rail 容器 role=navigation')
    assert(cliSettings.indexOf("'aria-label': tt('settings.group.nav')") >= 0, 'client rail aria-label 走字典')
    assert(cliSettings.indexOf("className: 'dsh-notes-settings-rail-item'") >= 0 && cliSettings.indexOf("className: 'dsh-notes-settings-chip'") >= 0, 'client rail-item + chip')
    assert(cliSettings.indexOf("className: 'dsh-notes-settings-group', 'data-g': x.g.id") >= 0 && cliSettings.indexOf("className: 'dsh-notes-settings-group-t'") >= 0, 'client 组壳 + 组头')
    assert(cliSettings.indexOf('function settingsGroupJump(gid)') >= 0 && cliSettings.indexOf('- 48') >= 0, 'client 点击定位 48px 补偿')
    assert(cliSettings.indexOf("modal.addEventListener('scroll', spy, { passive: true })") >= 0 && cliSettings.indexOf('<= 56') >= 0, 'client scroll-spy effect（56px 阈值）')
    assert(cliSettings.indexOf("setGroupCur === x.g.id ? ' on' : ''") >= 0 && cliSettings.indexOf("'aria-current': setGroupCur === x.g.id ? 'true' : undefined") >= 0, 'client 当前组 on + aria-current')
    assert((cliSettings.match(/type: 'button', 'data-g': x\.g\.id/g) || []).length === 2, 'client rail-item + chip 均带 data-g 锚（点击定位/高亮对齐锚）')
    /* 产物同步（防忘跑 concat-app/build-dist） */
    assert(appSrc.indexOf('set-rail-item') >= 0 && appSrc.indexOf('SET_GROUPS') >= 0, 'app.html 产物同步（需先跑 concat-app/build-dist）')
    assert(clientPkgSrc.indexOf('dsh-notes-settings-rail-item') >= 0 && clientPkgSrc.indexOf('SET_GROUPS') >= 0 && clientPkgSrc.indexOf('settingsGroupJump') >= 0, '发布包 lib/client.js 同步（需先跑 build-dist）')
  })

  // ===== 111.5 样式三端 + 图标三端 =====
  await t('0.4.8 分组导航样式三端：sticky rail + chips 横条 + 559px 媒体查询退化 + i-info 图标三端', () => {
    for (const [label, css] of [['app head.html', appHead], ['原型', protoV2Src]]) {
      assert(css.indexOf('.set-rail{position:sticky') >= 0, label + ' rail sticky 随滚')
      assert(css.indexOf('.set-chips{') >= 0 && css.indexOf('overflow-x:auto') >= 0, label + ' chips 横条（横向滚动）')
      assert(css.indexOf('@media (max-width:559px){.set-rail{display:none}.set-chips{display:flex}}') >= 0, label + ' <560px 媒体查询退化（rail 隐 chips 显）')
      assert(css.indexOf('.set-rail-item.on{') >= 0 && css.indexOf('.set-group-t{') >= 0, label + ' 当前组高亮 + 组头样式')
    }
    assert(stylesSrc.indexOf('.dsh-notes-settings-rail{position:sticky') >= 0, 'client rail sticky')
    assert(stylesSrc.indexOf('@media (max-width:559px){.dsh-notes-settings-rail{display:none}.dsh-notes-settings-chips{display:flex}}') >= 0, 'client <560px 媒体查询退化')
    assert(stylesSrc.indexOf('.dsh-notes-settings-rail-item.on{') >= 0 && stylesSrc.indexOf('.dsh-notes-settings-group-t{') >= 0, 'client 当前组高亮 + 组头样式')
    /* i-info 图标三端同形（「关于」组） */
    assert(appBody.indexOf('id="i-info"') >= 0 && protoV2Src.indexOf('id="i-info"') >= 0 && cliIcons.indexOf('info: [') >= 0, 'i-info/info 图标三端')
    assert(appBody.indexOf('M12 11v5M12 7.5v.01') >= 0 && cliIcons.indexOf('M12 11v5M12 7.5v.01') >= 0 && protoV2Src.indexOf('M12 11v5M12 7.5v.01') >= 0, 'i-info path 三端同形')
  })

  // ===== 111.6 i18n 双语 =====
  await t('0.4.8 组名 i18n 双语：settings.group.* 七组 zh 精确值/en 非空 + nav aria 键', () => {
    for (const id of GROUP_IDS) {
      assert(ZH['settings.group.' + id] === GROUP_ZH[id], 'zh settings.group.' + id + ' = ' + GROUP_ZH[id])
      assert(typeof EN['settings.group.' + id] === 'string' && EN['settings.group.' + id].length > 0, 'en settings.group.' + id + ' 非空')
    }
    assert(ZH['settings.group.nav'] === '设置分组' && EN['settings.group.nav'] === 'Settings groups', 'settings.group.nav 双语在案')
  })

  // ===== 111.7 零回归锁（0.4.7-B 成果 + dirty/保存/还原链路 + 控件 id 全在案）=====
  await t('0.4.8 零回归锁：sticky 标题/描述收折/LLM 区邻接/dirty 链路/22 控件 id 全在案（分组=包裹层）', () => {
    /* 0.4.7-B①a sticky 标题三端（106 节主锁，此处轻锁防分组壳误伤） */
    assert(appHead.indexOf('.modal-t{') >= 0 && /position:sticky/.test(appHead.slice(appHead.indexOf('.modal-t{'), appHead.indexOf('}', appHead.indexOf('.modal-t{')))), 'app 标题栏 sticky 在案')
    assert(stylesSrc.indexOf('.dsh-notes-settings-modal-t{') >= 0 && stylesSrc.indexOf('top:-16px') >= 0, 'client 标题栏 sticky 在案')
    /* 0.4.7-B①b 描述收折双端 */
    assert(appSettings.indexOf("s.classList.toggle('cl')") >= 0 && cliSettings.indexOf('function SettingsRowLabel(props)') >= 0, '描述收折 ⓘ 双端在案')
    /* 概念速览不归组（独立于分组导航之上） */
    assert(appSettings.indexOf("$('setBody').innerHTML = setOnb + setGroupsHtml(setSecs);") >= 0, 'app 速览 + 分组壳拼装锚')
    assert(cliSettings.indexOf("className: 'dsh-notes-data-hint'") >= 0 && cliSettings.indexOf("className: 'dsh-notes-settings-layout'") >= 0, 'client 速览不归组 + layout 锚')
    /* dirty/保存/还原/兜底 flush 链路零改动（函数面原样） */
    for (const k of ['SET_NUM_FIELDS', 'setDirtyCompute', 'setDirtyRefresh', 'setPersistMerge', 'settingsSetQuiet', 'setSnapFromControls', 'doSettingsSaveAll', 'doSettingsRestoreAll', 'flushSettingsPending', 'closeModalFlushed']) {
      assert(appSettings.indexOf(k) >= 0, 'app dirty 链路在案：' + k)
    }
    for (const k of ['SET_NUM_FIELDS', 'settingsSetQuiet', 'setPersistMerge', 'saveSettingsAll', 'restoreSettingsAll', 'flushSettingsPending', 'closeSettings']) {
      assert(cliSettings.indexOf(k) >= 0, 'client dirty 链路在案：' + k)
    }
    /* 22 控件 id 全在案（节内容零改动锚；0.4.8 notes-048-lang-topbar：setLang 随语言节下线出列） */
    for (const id of ['setLlmSel', 'setLlmP', 'setLlmM', 'setOrgMax', 'setUsageBody', 'setUsageBudget', 'setStale', 'setMaxDepth', 'setBudget', 'setGaugeT', 'setGaugeBar', 'setInjectPreview', 'setInjectManager', 'setExport', 'setImport', 'setTrash', 'setPrune', 'setSuggest', 'setMemoryCtrl', 'setLogWeek', 'setLogMonth', 'setCheatsheet']) {
      assert(appSettings.indexOf('id="' + id + '"') >= 0, 'app 控件 #' + id + ' 在案')
    }
    assert(appSettings.indexOf('id="setLang"') < 0, 'app #setLang 已随语言节下线（0.4.8 notes-048-lang-topbar）')
    /* 组内节相对顺序不动（常量表 rows 组内序 ⇄ 0.4.7 渲染序）：ai 组 llm→organizemax 邻接 + data 组 memory→logweek→logmonth 邻接 */
    const gA = grabGroups(appSettings, 'app')
    assert.deepStrictEqual(gA.find(g => g.id === 'ai').rows, ['llm', 'organizemax', 'usage', 'usagebudget', 'suggest'], 'ai 组内序（LLM 区邻接）')
    assert.deepStrictEqual(gA.find(g => g.id === 'data').rows, ['maxdepth', 'data', 'assets', 'memory', 'logweek', 'logmonth'], 'data 组内序（工作记忆区邻接）')
  })
  },
}
