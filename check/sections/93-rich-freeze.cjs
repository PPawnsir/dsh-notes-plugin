// 节 93. 富文本重开假死根修（0.4.6-A，notes-046-rich-freeze；UX 巡检 R2 反馈 n-mux892tew6bf，严重级 P0）
// 事故链：富文本模式重开「assets 图引用 + 表格」笔记 → 正文空白（假绿点「已同步源码」）→ 整页假死。
// 实证结论（mock + 真机 115 条库双环境，探针 scratch/probe-046-*.cjs）：
//   ① 渲染内核无罪 —— renderMarkdown/analyzeMarkdown 对归档素材与 17 组病态语料（星号/括号/管道/双链/反引号风暴、
//      素材×200、183KB 50 表 50 图大正文）全量 ≤36ms（大正文含布局 407ms），排除「正则灾难回溯/同步死循环」假设；
//   ② 结构复现真缺陷 = 「正文在途窗假同步」：selectNote 把 edNote.body 置 '' → renderEd 即刻渲染富文本空 div +
//      绿点「已同步源码」，notes-get 尖刺期（同场巡检实测 get 12s）窗口秒级可见——即现象①「正文空白 + 假绿点」，
//      且窗内空态可编辑（打字→失焦序列化空 div 的次生错觉链）。整页冻结②为同场并发巡检 Worker 打满宿主的环境共因
//      （旁证 n-mux89mdj6tty ④），本卡把窗口感知闸 + 内核性能闸钉死为常驻断言，防任何未来渲染路径回归冻页。
// 修复（红线：存储层零改动；R-1 提交闸/迟到守卫不动；degBanner 降级语义不动）：
//   双端同构——在途窗（edNote 在 && !edBodyLoaded && !edBodyErr，草稿天然豁免）内：
//   富文本锁编辑（contentEditable=false）+ 不填内核产物 + 同步点转「加载中…」橙点（不冒绿）；落定由 loadEdBody 链回填解锁。
module.exports = {
  id: "93",
  title: "93. 富文本重开假死根修（0.4.6-A：正文在途窗锁编辑 + 同步点不冒绿 + 内核性能闸，notes-046-rich-freeze）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('93. 富文本重开假死根修（0.4.6-A：在途窗锁编辑 + 同步点不冒绿 + 内核性能闸）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const appEd = read(path.join('src', 'app', 'panels', 'editor.js'))
  const cliEd = read(path.join('src', 'client', 'panels', 'panel', 'editor.js'))
  const appHtml = read(path.join('packages', 'dsh-notes-plugin', 'app.html'))
  const clientPkgSrc = read(path.join('packages', 'dsh-notes-plugin', 'lib', 'client.js'))

  // ===== ① app 端修复锚：在途窗判定 + 填充/同步点/安全态/模式切换四点位 =====
  await t('0.4.6-A app：edBodyPending 在途窗判定助手（草稿 edBodyLoaded=true 天然豁免）', () => {
    assert(appEd.indexOf('function edBodyPending() { return !!(edNote && !edBodyLoaded && !edBodyErr) }') >= 0, 'app editor.js 缺 edBodyPending 判定')
  })
  await t('0.4.6-A app：fillEdBody 在途窗不填内核产物 + 锁编辑（落定回填链不动）', () => {
    assert(appEd.indexOf("var pend = edBodyPending();") >= 0, 'fillEdBody 缺在途窗判定')
    assert(appEd.indexOf("$('edRich').innerHTML = pend ? '' : renderMarkdown(body, wikiResolve);") >= 0, 'fillEdBody 在途窗空态守卫缺失')
    assert(appEd.indexOf("$('edRich').contentEditable = pend ? 'false' : 'true';") >= 0, 'fillEdBody 在途窗锁编辑缺失')
  })
  await t('0.4.6-A app：同步点在途窗转「加载中」不冒绿（setSyncStatus + renderEd 初态双点位）', () => {
    /* 0.4.7-C ②a 同构扩展：edBodyErr 在窗时统一红点「加载失败」分支优先于在途/绿态（锚文本含 err 分支前缀，在途语义不变） */
    assert(appEd.indexOf("pill.className = 'sync' + (edBodyErr ? ' err' : (pend || editing ? '' : ' ok'));") >= 0, 'setSyncStatus 在途窗去绿缺失（0.4.7-C err 分支前缀须在）')
    assert(appEd.indexOf("$('syncTxt').textContent = edBodyErr ? t('editor.syncFailed') : pend ? t('editor.bodySyncing')") >= 0, 'setSyncStatus 加载中文案缺失（0.4.7-C 失败文案分支须在）')
    assert(appEd.indexOf("'<span class=\"sync' + (edBodyErr ? ' err' : ((edBodyPending() || richDirty) ? '' : ' ok'))") >= 0, 'renderEd 同步点初态在途窗判定缺失（0.4.7-C err 初态分支须在）')
  })
  await t('0.4.6-A app：refreshLoadErrUI 富文本在途窗同步锁编辑（R-1 错误锁定语义不动）+ switchMode 在途窗守卫', () => {
    assert(appEd.indexOf("rich.contentEditable = (locked || edBodyPending()) ? 'false' : 'true';") >= 0, 'refreshLoadErrUI 在途窗锁定缺失')
    assert(appEd.indexOf("var locked = !!edBodyErr;") >= 0, 'R-1 错误锁定原语义锚零改动')
    assert(appEd.indexOf("rich.innerHTML = pend ? '' : renderMarkdown(edNote ? edNote.body || '' : '', wikiResolve);") >= 0, 'switchMode 在途窗守卫缺失')
  })

  // ===== ② client 端同构锚：在途窗反应式镜像 + 同步点/锁编辑 =====
  await t('0.4.6-A client：在途窗反应式镜像 state + loadEdBody 起止点写入（成功/失败/异常三出路均出窗）', () => {
    assert(cliEd.indexOf('const [edBodyPending, setEdBodyPending] = React.useState(false)') >= 0, 'client 缺 edBodyPending state')
    assert(cliEd.indexOf("setEdBodyPending(true)   // 0.4.6-A：进入在途窗") >= 0, 'loadEdBody 进窗写入缺失')
    const exits = cliEd.split('setEdBodyPending(false)').length - 1
    assert(exits >= 2, 'loadEdBody 出窗写入须 ≥2 处（then 落定 + catch 异常；实得 ' + exits + '）')
  })
  await t('0.4.6-A client：同步点在途窗不冒绿 + 富文本在途窗锁编辑', () => {
    /* 0.4.7-C ②a 同构扩展：edLoadErr 在窗时统一红点「加载失败」分支优先（锚文本含 err 分支前缀，在途语义不变） */
    assert(cliEd.indexOf("className: 'dsh-notes-rtb-sync' + (edLoadErr ? ' err' : ((edBodyPending || richSyncing) ? '' : ' ok'))") >= 0, 'client 同步点在途窗去绿缺失（0.4.7-C err 分支前缀须在）')
    assert(cliEd.indexOf("edBodyPending ? tt('editor.bodySyncing')") >= 0, 'client 同步点加载中文案缺失')
    assert(cliEd.indexOf("contentEditable: (edLoadErr || edBodyPending) ? false : true") >= 0, 'client 富文本在途窗锁编辑缺失')
  })

  // ===== ③ 产物同步锚（改 src 后须跑 concat-app + build-dist） =====
  await t('0.4.6-A 产物同步：app.html + 发布包 lib/client.js 双端含在途窗锚（i18n 键随产物下发）', () => {
    for (const k of ['function edBodyPending()', 'editor.bodySyncing']) {
      assert(appHtml.indexOf(k) >= 0, 'app.html 缺锚：' + k + '（改 src/app/** 后需跑 node scripts/concat-app.cjs）')
    }
    for (const k of ['edBodyPending', 'editor.bodySyncing']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺锚：' + k + '（改 src/client/** 后需跑 node scripts/build-dist.cjs）')
    }
    assert(clientSrc.indexOf('setEdBodyPending(true)') >= 0, 'client 拼接产物含在途窗写入（src/client/** 拼接直出）')
  })

  // ===== ④ i18n 键双字典 parity（editor.bodySyncing 新键；editor.bodyLoading 系整理链路既有键，不复用） =====
  await t('0.4.6-A i18n：editor.bodySyncing 双字典同键（zh 正文加载中… / en Loading body…）', () => {
    const zh = read(path.join('src', 'i18n', 'zh.js')), en = read(path.join('src', 'i18n', 'en.js'))
    assert(zh.indexOf("'editor.bodySyncing': '正文加载中…'") >= 0, 'zh 字典缺 editor.bodySyncing')
    assert(en.indexOf("'editor.bodySyncing': 'Loading body…'") >= 0, 'en 字典缺 editor.bodySyncing')
  })

  // ===== ⑤ 内核性能闸（渲染超时护栏·可行形态）：病态语料 renderMarkdown/analyzeMarkdown 全量 < 500ms =====
  // 同步函数无法被运行期看门狗打断——护栏落点 = 常驻性能断言：任何未来改动引入灾难回溯/死循环，本闸即时红
  await t('0.4.6-A 内核性能闸：病态语料 renderMarkdown 全量 < 500ms（正则灾难回溯常驻防线）', () => {
    const kern = read(path.join('src', 'shared', 'editor-kernel.js'))
    const api = new Function(kern + '\nreturn { renderMarkdown: renderMarkdown, analyzeMarkdown: analyzeMarkdown }')()
    const UXR2 = '# UXR2 自动保存测试\n\n第一段：验证自动保存延迟与反馈。\n\n第二段：追加输入，观察防抖与连续保存。\n\n![测试图](assets/uxr2-fake.png)\n\na\n\n| 列A | 列B |\n| --- | --- |\n| 1 | 2 |'
    const corpus = [
      ['UXR2 归档素材（逐字）', UXR2],
      ['素材×200', Array(200).fill(UXR2).join('\n\n')],
      ['星号风暴', '*'.repeat(10000)],
      ['感叹中括号风暴', '!['.repeat(5000)],
      ['管道风暴', '| '.repeat(8000)],
      ['双链风暴', '[['.repeat(4000)],
      ['未闭合链接风暴', '[x]('.repeat(4000)],
      ['反引号风暴', '`'.repeat(8000)],
      ['转义管道风暴', '\\|'.repeat(5000)],
      ['50 图 50 表', Array(50).fill('![图](assets/f.png)\n\n| A | B |\n| --- | --- |\n| 1 | 2 |').join('\n\n')],
    ]
    corpus.forEach(function (kv) {
      const t0 = Date.now()
      const html = api.renderMarkdown(kv[1], function () { return null })
      const ms = Date.now() - t0
      assert(ms < 500, 'renderMarkdown「' + kv[0] + '」耗时 ' + ms + 'ms 超闸（>=500ms，疑灾难回溯）')
      assert(typeof html === 'string', 'renderMarkdown「' + kv[0] + '」应返回字符串')
    })
    const t1 = Date.now(); api.analyzeMarkdown(Array(200).fill(UXR2).join('\n\n'))
    assert(Date.now() - t1 < 500, 'analyzeMarkdown 素材×200 超闸')
  })

  // ===== ⑥ app 编辑器在途窗行为仿真（46 节同款 with(Proxy) 沙箱：notes-get 挂起 → 窗口三态断言 → 落定解锁回填） =====
  const ZH93 = new Function(read(path.join('src', 'i18n', 'zh.js')) + '\nreturn I18N_ZH')()
  function bootAppEditor93(rpcImpl) {
    const els = {}
    const mkEl = () => ({ style: {}, classList: { toggle() {}, add() {}, remove() {}, contains() { return false } }, value: '', textContent: '', innerHTML: '', className: '', readOnly: false, contentEditable: 'true', addEventListener() {}, removeEventListener() {}, querySelectorAll() { return [] }, closest() { return null }, focus() {}, _bound: false })
    const target = {
      setTimeout: setTimeout, clearTimeout: clearTimeout,
      notes: [{ id: 'n1', title: '含图表笔记', tags: [], folder: '', kind: 'note', status: 'active', topic: '' }],
      selId: null, edNote: null, edLoading: false, edBodyLoaded: false, edBodyErr: '',
      edMode: 'rich', richDirty: false, composing: false, degraded: { ok: true, reasons: [] },
      wikiBodies: {}, foldOpen: {}, histCount: null, saveTimer: null, scopeOpen: false, savedRange: null,
      richSyncTimer: null, degTimer: null,
      draftNote: null, draftCreating: false,
      rpc: (m, a) => rpcImpl(m, a),
      $: (id) => (els[id] = els[id] || mkEl()),
      t: (k, vars) => { let s = ZH93[k]; if (s == null) return k; if (vars) s = s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? String(vars[n]) : m)); return s },
      toast: () => {}, analyzeMarkdown: () => ({ ok: true, reasons: [] }),
      renderMarkdown: (s) => 'HTML:' + s,   /* 内核打桩：窗口判定只看填/不填 */
      renderTree() {}, renderCrumb() {}, renderMeta() {}, renderDispatches() {}, renderEdFoot() {}, renderBacklinks() {},
      loadNotes() { return Promise.resolve() }, probeHistCount() {}, saveFoldOpen() {},
      icon: () => '', esc: (s) => String(s), wikiResolve: (s) => s,
    }
    const proxy = new Proxy(target, {
      has(t, k) { if (typeof k === 'symbol') return false; return (k in t) || !(k in globalThis) },
      get(t, k) { if (typeof k === 'symbol') return undefined; if (k in t) return t[k]; const f = function () {}; t[k] = f; return f },
      set(t, k, v) { t[k] = v; return true }
    })
    new Function('scope', 'with (scope) {\n' + appEd + '\n; __api = { selectNote: selectNote, loadEdBody: loadEdBody, switchMode: switchMode } }')(proxy)
    return { target: target, els: els, api: target.__api }
  }
  const tick93 = () => new Promise(r => setTimeout(r, 0))
  await t('0.4.6-A app 在途窗（行为）：notes-get 挂起期富文本空态锁编辑 + 同步点橙点「正文加载中…」（不冒绿）', async () => {
    let resolveGet = null
    const env = bootAppEditor93((m) => m === 'notes-get' ? new Promise(r => { resolveGet = r }) : Promise.resolve({}))
    env.api.selectNote('n1')
    /* notes-get 挂起（在途窗）：富文本空 + 锁 + 橙点加载中 */
    assert(env.target.edBodyLoaded === false && env.target.edBodyErr === '', '在途窗前提：未加载且无错误')
    assert(env.els.edRich.contentEditable === 'false', '在途窗富文本须锁编辑（实得 ' + env.els.edRich.contentEditable + '）')
    assert(env.els.edRich.innerHTML === '', '在途窗富文本不填内核产物（实得长度 ' + env.els.edRich.innerHTML.length + '）')
    assert(env.els.syncPill.className === 'sync', '在途窗同步点不得带 .ok 绿态（实得 ' + env.els.syncPill.className + '）')
    assert(env.els.syncTxt.textContent === ZH93['editor.bodySyncing'], '在途窗同步点文案须为「正文加载中…」（实得 ' + env.els.syncTxt.textContent + '）')
    /* 落定：回填 + 解锁 + 绿点 */
    resolveGet({ note: { id: 'n1', title: '含图表笔记', body: '真实正文', tags: [], kind: 'note', status: 'active' } })
    await tick93(); await tick93()
    assert(env.els.edRich.innerHTML === 'HTML:真实正文', '落定后富文本回填内核产物（实得 ' + env.els.edRich.innerHTML + '）')
    assert(env.els.edRich.contentEditable === 'true', '落定后富文本解锁')
    assert(env.els.syncPill.className === 'sync ok', '落定后同步点回绿（实得 ' + env.els.syncPill.className + '）')
    assert(env.els.syncTxt.textContent === ZH93['editor.synced'], '落定后同步点文案回「已同步源码」')
  })
  await t('0.4.6-A app 在途窗（行为）：窗内切富文本不重演空白假绿（switchMode 守卫）+ 草稿态豁免', async () => {
    let resolveGet = null
    const env = bootAppEditor93((m) => m === 'notes-get' ? new Promise(r => { resolveGet = r }) : Promise.resolve({}))
    env.target.edMode = 'source'   /* 源码态选中 → 在途窗内切富文本 */
    env.api.selectNote('n1')
    env.api.switchMode('rich')
    assert(env.els.edRich.innerHTML === '' && env.els.edRich.contentEditable === 'false', '在途窗切富文本：空态 + 锁编辑')
    assert(env.els.syncPill.className === 'sync' && env.els.syncTxt.textContent === ZH93['editor.bodySyncing'], '在途窗切富文本：橙点加载中不冒绿')
    resolveGet({ note: { id: 'n1', title: '含图表笔记', body: '真实正文', tags: [], kind: 'note', status: 'active' } })
    await tick93(); await tick93()
    assert(env.els.edRich.innerHTML === 'HTML:真实正文' && env.els.edRich.contentEditable === 'true', '落定回填解锁')
    /* 草稿豁免：doNewNote 语义 = edBodyLoaded:true（本地全量持有）→ 不在窗内、可编辑、同步点直绿 */
    const env2 = bootAppEditor93(() => Promise.resolve({}))
    env2.target.draftNote = { id: '', title: '', body: '草稿正文', kind: 'note', status: 'active', tags: [], topic: '', folder: '', inject: false, injectTo: [], recall: true, sensitive: false, injectRole: 'convention', dispatches: [], useCount: 0, createdAt: '', updatedAt: '', sessionId: '', _tagsStr: null }
    env2.target.edNote = env2.target.draftNote
    env2.target.edBodyLoaded = true   /* doNewNote 原语义（newnote.js：草稿正文本地全量持有、无 get 链路） */
    env2.target.selId = null
    env2.api.switchMode('source'); env2.api.switchMode('rich')
    assert(env2.els.edRich.innerHTML === 'HTML:草稿正文' && env2.els.edRich.contentEditable === 'true', '草稿态富文本正常填充可编辑（在途窗不误伤）')
    assert(env2.els.syncPill.className === 'sync ok', '草稿态同步点直绿')
  })
  }
}
