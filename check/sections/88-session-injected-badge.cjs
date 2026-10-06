// 节 88. 0.4.5-H 会话侧注入反向视图（notes-045-session-injected-view：会话头部注入清单徽标 📎N + 明细浮层 + 点击直达笔记）
// 设计面：同槽位（conversation.session.header.actions）第二组件 id=dsh-notes-injected-badge order=41（排既有笔记按钮 #40 旁，
//   独立 id 共存不抢槽位）；数据源零新增 RPC（notes-list inject=true 过滤 + notes-mount-list §1 挂载行组合）；
//   命中规则与 host conventionHit 同口径（injectTo 空/global/workspace 容错 = 全局；含当前会话短 id shortSid 归一 = 命中）；
//   挂载行 = 目录段载荷 host 不按会话过滤 → 资料区全量列出；sys/软删排除（host 缺省口径 + 组件侧兜底双闸）；
//   拿不到 sid / 拉取失败 / 零命中 → 徽标不渲染（静默降级红线）；行点击 = 开面板 + selectNote/notes-get 兜底（openExecLog 同款）；
//   只读会话状态零写入；原型 notes-ui-v2.html 不同步（会话头部是宿主壳区域，非本插件原型面）。
// 测试策略：注册锚/降级/链路 = 产物文本静态锚（开发版 clientSrc + 发布包 lib/client.js 双端）；命中规则/排除 = 提取
//   injSessionHit/injBadgeCompute 真码行为级 eval；i18n 双语取值锚定；样式产物同步锚。会话头是宿主壳无 e2e 通道，活机冒烟交用户。
module.exports = {
  id: "88",
  title: "88. 0.4.5-H 会话头部注入清单徽标（📎N + 明细浮层 + 直达笔记）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('88. 0.4.5-H 会话头部注入清单徽标（📎N + 明细浮层 + 直达笔记）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')   // LF 归一：Windows CRLF 源文件的多行锚可比
  const badgeSrc = read(path.join('src', 'client', 'panels', 'entries', 'injected-badge.js'))
  const manifestSrc = read(path.join('src', 'client', 'manifest.js'))
  const zhSrc = read(path.join('src', 'i18n', 'zh.js')), enSrc = read(path.join('src', 'i18n', 'en.js'))
  const stylesSrc = read(path.join('src', 'styles.css'))
  const cliPkg = read(path.join('packages', 'dsh-notes-plugin', 'lib', 'client.js'))
  const cssPkg = read(path.join('packages', 'dsh-notes-plugin', 'lib', 'styles.css'))
  // 模块在拼接产物中以 4 空格基座缩进存在：收尾行 = \n + 4 空格 + }
  const grabFn4 = (s, name, tag) => { const m = s.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}')); assert(m, tag + ' 缺 ' + name + '()（结构变更需同步本断言）'); return m && m[0] }

  // ===== ① 组件注册锚：同槽位独立 id 共存 + order 排笔记按钮旁 + manifest 登记 + 双端产物 =====
  await t('徽标注册锚：conversation.session.header.actions 槽 id=dsh-notes-injected-badge order=41（与 dsh-notes-btn #40 共存）+ manifest 登记 + 双端产物', () => {
    assert(manifestSrc.indexOf("'panels/entries/injected-badge.js'") >= 0, 'client manifest 登记 injected-badge.js')
    const REG = "slots.register({ name: 'conversation.session.header.actions', id: 'dsh-notes-injected-badge', order: 41 }"
    assert(badgeSrc.indexOf(REG) >= 0, '模块源 slots.register 锚（id/order）')
    assert(clientSrc.indexOf(REG) >= 0, '开发版拼接产物 slots.register 锚')
    assert(cliPkg.indexOf(REG) >= 0, '发布包 lib/client.js slots.register 锚（需先跑 build-dist）')
    // 独立 id 共存红线：既有笔记按钮注册原样保留（order 40 不动），同槽位两组件
    assert(clientSrc.indexOf("slots.register({ name: 'conversation.session.header.actions', id: 'dsh-notes-btn', order: 40 }") >= 0, '既有 dsh-notes-btn #40 注册原样保留（不抢槽位）')
    // 槽位缺席静默红线：slots.inject 返回值守卫 disposer 挂载（bootstrap slots 缺守卫在先，本模块注册体在 inject 回调内）
    assert(badgeSrc.indexOf("slots.inject('conversation.session.header.actions'") >= 0 && badgeSrc.indexOf("if (typeof d5 === 'function') disposers.push(d5)") >= 0, 'slots.inject + disposer 守卫锚')
  })

  // ===== ② 命中规则行为级 eval（全局 / 指定会话 / 非本会话三态 + 存量容错 + 长 id 归一）=====
  await t('injSessionHit 行为级 eval：injectTo 空=全局命中 / 含当前会话短id=命中 / 非本会话=不命中（+global/workspace 存量容错 + shortSid 归一）', () => {
    const fnSrc = grabFn4(clientSrc, 'injSessionHit', 'clientSrc')
    const shortSid = (sid) => sid ? String(sid).replace(/^session-/, '').slice(0, 8) : ''
    const injSessionHit = new Function('shortSid', fnSrc + '\nreturn injSessionHit')(shortSid)
    const sid = 'cc24eb5c'
    assert.strictEqual(injSessionHit([], sid), true, 'injectTo=[] 全局命中')
    assert.strictEqual(injSessionHit(undefined, sid), true, 'injectTo 缺省（undefined）全局命中')
    assert.strictEqual(injSessionHit(['cc24eb5c'], sid), true, '含当前会话短 id 命中')
    assert.strictEqual(injSessionHit(['99f2b674'], sid), false, '非本会话不命中')
    assert.strictEqual(injSessionHit(['99f2b674', 'cc24eb5c'], sid), true, '多选含本会话命中')
    assert.strictEqual(injSessionHit(['global'], sid), true, '存量 global 值容错 = 全局命中')
    assert.strictEqual(injSessionHit(['workspace'], sid), true, '存量 workspace 值容错 = 全局命中')
    assert.strictEqual(injSessionHit(['session-cc24eb5c-702c-4bb8'], sid), true, '存量长 id 经 shortSid 归一命中（notes-034 同口径）')
    assert.strictEqual(injSessionHit(['cc24eb5c'], ''), false, 'sid 为空时指定会话笔记不命中（徽标侧 sid 缺失整体不渲染，此为函数口径钉死）')
  })

  // ===== ③ sys/删除笔记排除 + 资料区求值行为级（convs 过滤 / refs 标题解析 / 死行兜底）=====
  await t('injBadgeCompute 行为级 eval：sys/软删/未开注入/资料档 排除出约定区 + 非本会话过滤 + 挂载行标题解析与 id 兜底 + 死行/机器行不回显', () => {
    const hitSrc = grabFn4(clientSrc, 'injSessionHit', 'clientSrc')
    const cmpSrc = grabFn4(clientSrc, 'injBadgeCompute', 'clientSrc')
    const shortSid = (sid) => sid ? String(sid).replace(/^session-/, '').slice(0, 8) : ''
    const injSessionHit = new Function('shortSid', hitSrc + '\nreturn injSessionHit')(shortSid)
    const injBadgeCompute = new Function('injSessionHit', cmpSrc + '\nreturn injBadgeCompute')(injSessionHit)
    const sid = 'cc24eb5c'
    const notes = [
      { id: 'n-c1', title: '工作日志约定', inject: true, injectRole: 'convention', kind: 'note', injectTo: [] },
      { id: 'n-c2', title: '本会话专属约定', inject: true, injectRole: 'convention', kind: 'decision', injectTo: ['cc24eb5c'] },
      { id: 'n-other', title: '别会话约定', inject: true, injectRole: 'convention', kind: 'note', injectTo: ['99f2b674'] },
      { id: 'n-sys', title: '注入索引根笔记', inject: true, injectRole: 'convention', kind: 'sys', injectTo: [] },
      { id: 'n-del', title: '已删约定', inject: true, injectRole: 'convention', kind: 'note', deleted: true, injectTo: [] },
      { id: 'n-off', title: '未开注入', inject: false, kind: 'note', injectTo: [] },
      { id: 'n-ref', title: '笔记面板架构', inject: true, injectRole: 'reference', kind: 'note', injectTo: [] },
    ]
    const lines = [
      { id: 'n-ref', when: '改面板结构时查我', raw: '- [[n-ref]] 笔记面板架构 何时查我：改面板结构时查我' },
      { id: 'n-ghost', when: '', raw: '- [[n-ghost]]' },   // 清单外（瞬态/在途）——id 兜底回显（host 目录段仍注入该行）
      { id: 'n-sys', when: 'x', raw: '- [[n-sys]] x' },     // 机器行不回显（组件侧兜底）
      { id: '', when: 'bad', raw: '- [[]] bad' },           // 空 id 坏行不回显
    ]
    const r = injBadgeCompute(notes, lines, sid)
    assert.deepStrictEqual(r.convs.map(n => n.id), ['n-c1', 'n-c2'], '约定区 = inject=true 且非资料档且命中（sys/软删/未开/非本会话全排除）')
    assert.deepStrictEqual(r.refs.map(x => x.id), ['n-ref', 'n-ghost'], '资料区 = 挂载行全量（目录段不按会话过滤）+ 死行/机器行/坏行不回显')
    assert.strictEqual(r.refs[0].title, '笔记面板架构', '挂载行标题自 notes 清单解析')
    assert.strictEqual(r.refs[0].when, '改面板结构时查我', 'whenToUse 行随行下发')
    assert.strictEqual(r.refs[1].title, 'n-ghost', '清单外挂载行标题回退 id')
    // 资料档笔记不重复进约定区（零双计红线：N = 约定 M + 挂载 K）
    assert(r.convs.every(n => n.injectRole !== 'reference'), '约定区零资料档（挂载行单源，不双计）')
  })

  // ===== ④ 数据拉取失败/缺 sid/零命中 静默降级锚（徽标不渲染）=====
  await t('静默降级锚：缺 sid 不渲染 + 拉取失败/异常响应置 null 不渲染 + 零命中不占位 + 失效监听（notifyNotesChanged）挂/卸成对', () => {
    assert(badgeSrc.indexOf('if (!sid) return null') >= 0, '拿不到 sessionId → 徽标不渲染')
    assert(badgeSrc.indexOf(".catch(() => { if (!stopped) setData(null) })") >= 0, '拉取 Promise 拒绝 → setData(null) 静默')
    assert(badgeSrc.indexOf("if (!nl || nl.error || !Array.isArray(nl.notes) || !ml || ml.error || !Array.isArray(ml.lines)) { setData(null); return }") >= 0, '异常响应形态（error/缺字段）→ setData(null) 静默')
    assert(badgeSrc.indexOf('if (!data) return null') >= 0, '数据 null → 徽标不渲染')
    assert(badgeSrc.indexOf('if (N === 0) return null') >= 0, '零命中（无注入常态）→ 徽标不占位')
    assert(badgeSrc.indexOf('noteRefreshListeners.add(fn)') >= 0 && badgeSrc.indexOf('noteRefreshListeners.delete(fn)') >= 0, 'notifyNotesChanged 失效重拉（挂/卸成对，stopped 闸防迟到回写）')
    assert(badgeSrc.indexOf("Promise.all([host.call('notes-list', {}), host.call('notes-mount-list', {})])") >= 0, '数据源 = 既有 notes-list + notes-mount-list 组合（零新增 RPC 红线）')
  })

  // ===== ⑤ 行点击打开面板链路锚（开面板 + 缓存命中 selectNote + notes-get 兜底 + 能力桥缺席降级）=====
  await t('行点击直达链路锚：开面板（panelOpen+notify）→ 缓存命中 selectNote → notes-get 兜底（openExecLog 同款）→ 能力桥缺席只开面板', () => {
    assert(badgeSrc.indexOf('panelOpen = true; notify()') >= 0, '行点击先开面板（panel/index.js listeners 通道）')
    assert(badgeSrc.indexOf("(panelBridge.notes || []).find") >= 0 && badgeSrc.indexOf('panelBridge.selectNote(hit)') >= 0, '面板缓存命中 → selectNote 直达')
    assert(badgeSrc.indexOf("host.call('notes-get', { id: id })") >= 0 && badgeSrc.indexOf('panelBridge.selectNote(res.note)') >= 0, '缓存未命中 → notes-get 直开（open-by-id 通道复用）')
    assert(badgeSrc.indexOf("typeof panelBridge.selectNote === 'function'") >= 0, '面板能力桥缺席守卫（只开面板不选中，静默降级）')
    assert(badgeSrc.indexOf('wiki.targetNotFound') >= 0, '直达失败 toast（复用既有 key 红线）')
    assert(cliPkg.indexOf('panelOpen = true; notify()') >= 0 && cliPkg.indexOf("rpc('notes-get', { id: id })") >= 0, '发布包链路锚同步（需先跑 build-dist）')
  })

  // ===== ⑥ i18n 双语键（injBadge.* 五键取值锚定 + 代码引用 + 产物字典同步）=====
  await t('injBadge.* 双语在案：tip/title/convSec/refSec/openTip 五键 zh/en 取值锚 + 组件引用 + 产物字典行数同步', () => {
    const grab = (s, v) => new Function(s + '\nreturn ' + v)()
    const zh = grab(zhSrc, 'I18N_ZH'), en = grab(enSrc, 'I18N_EN')
    const PAIRS = {
      'injBadge.tip': ['本会话注入：约定 {m} · 资料 {k}（点击查看明细）', 'Injected here: {m} conventions · {k} references (click for details)'],
      'injBadge.title': ['本会话注入清单', 'Injected into this session'],
      'injBadge.convSec': ['约定 · 须遵守（{n}）', 'Conventions · always injected ({n})'],
      'injBadge.refSec': ['挂载资料 · 按需取用（{n}）', 'Mounted references · on demand ({n})'],
      'injBadge.openTip': ['在笔记面板中打开', 'Open in the notes panel'],
    }
    for (const k of Object.keys(PAIRS)) {
      assert.strictEqual(zh[k], PAIRS[k][0], k + ' zh 文案锚定')
      assert.strictEqual(en[k], PAIRS[k][1], k + ' en 文案锚定')
      assert(badgeSrc.indexOf("'" + k + "'") >= 0, k + ' 组件引用在位')
    }
    // 徽标文案零内联中文（会话头部组件，去注释口径；📎 为 emoji 非 CJK）。本文件字符串/正则内无 // 形态，行注释可整行剥离
    const noComments = badgeSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    assert(!/[一-鿿]/.test(noComments), '徽标组件去注释后零内联中文（文案全走 t()/tt()）')
    // 产物字典同步（68 节③行数断言同源复查两个新键即可，全量行数由 68 节看守）
    assert(cliPkg.indexOf("'injBadge.tip'") >= 0 && cliPkg.indexOf('Injected here: {m} conventions') >= 0, 'lib/client.js 产物字典同步（需先跑 build-dist）')
  })

  // ===== ⑦ 样式双端同步 + 令牌域扩列锚 =====
  await t('样式锚：injbadge 令牌域扩列（明暗两组 + color-mix 组）+ 徽标/浮层类齐备 + lib/styles.css 产物同步', () => {
    for (const sel of [
      '.dsh-notes-floating,.dsh-notes-fab,.dsh-notes-hdr-btn,.dsh-notes-injbadge{',
      'body[data-ds-dark-theme] .dsh-notes-hdr-btn,\nbody[data-ds-dark-theme] .dsh-notes-injbadge{',
      'body:not([data-ds-dark-theme]) .dsh-notes-hdr-btn,\n  body:not([data-ds-dark-theme]) .dsh-notes-injbadge,',
    ]) assert(stylesSrc.indexOf(sel) >= 0, '令牌域扩列锚：' + sel.slice(0, 40) + '…')
    for (const cls of ['.dsh-notes-injbadge{', '.dsh-notes-injbadge-btn', '.dsh-notes-injbadge-pop{', '.dsh-notes-injbadge-sec', '.dsh-notes-injbadge-row{', '.dsh-notes-injbadge-row-t', '.dsh-notes-injbadge-row-s']) {
      assert(stylesSrc.indexOf(cls) >= 0, 'styles.css 含 ' + cls)
      assert(cssPkg.indexOf(cls) >= 0, 'lib/styles.css 产物含 ' + cls + '（需先跑 build-dist）')
    }
  })
  }
}
