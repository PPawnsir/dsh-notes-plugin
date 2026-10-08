// 节 89. 0.4.5-E @ 引用笔记（notes-045-at-mention：DSH 输入框 @ 菜单注册「笔记」候选源——chip 落文 + 提交时 serialize 内联正文直达 Agent）
// 设计面：契约照 @deepseek-ai/dsh-client-ui-input-trigger lib/types/types.d.ts——InputTriggerSource
//   { trigger:'@', name:'notes', order:40 置后, candidates/onPick/warm/codec{clipboardText,serialize} }；
//   独立 name 分组不劫持宿主 reference 源；inputTriggers 服务缺席静默不注册；
//   数据面 = 独立轻缓存（mentionCache：首拉 notes-list + notifyNotesChanged 失效重拉，不依赖面板打开状态）；
//   serialize 走 notes-get 内联 `【笔记 · 标题 · id】\n正文`；失败透明降级 `@标题（内容拉取失败）`（契约原文=失败阻塞发送，
//   此处裁决透明降级优于阻塞，mentions.js 文件头注释注明）。
// 测试策略：结构/注册/产物同步 = 文本静态锚（开发版 clientSrc + 发布包 lib/client.js 双端）；过滤/candidates/onPick/serialize/
//   守卫 = 提取标记块（notes-mention-source / notes-mention-register BEGIN⇄END）真码行为级 eval（mock host.call/ctx）；
//   i18n 双语取值锚定。e2e 无 DSH composer 驱动面（harness 只伺服 app.html），活机冒烟交主窗口/用户。
module.exports = {
  id: "89",
  title: "89. 0.4.5-E @ 引用笔记（输入框 @ 菜单笔记源：chip + serialize 内联正文）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('89. 0.4.5-E @ 引用笔记（输入框 @ 菜单笔记源：chip + serialize 内联正文）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')   // LF 归一：Windows CRLF 源文件的多行锚可比
  const mentionSrc = read(path.join('src', 'client', 'triggers', 'mentions.js'))
  const manifestSrc = read(path.join('src', 'client', 'manifest.js'))
  const zhSrc = read(path.join('src', 'i18n', 'zh.js')), enSrc = read(path.join('src', 'i18n', 'en.js'))
  const cliPkg = read(path.join('packages', 'dsh-notes-plugin', 'lib', 'client.js'))
  // 标记块提取（host 侧 BEGIN/END 标记块同规）：拼接产物中模块以 4 空格基座缩进存在
  const grabBlock = (s, tag) => { const m = s.match(new RegExp('// ==== ' + tag + ' BEGIN ====[\\s\\S]*?// ==== ' + tag + ' END ====')); assert(m, 'clientSrc 缺标记块 ' + tag + '（结构变更需同步本断言）'); return m && m[0] }
  const grab = (s, v) => new Function(s + '\nreturn ' + v)()
  const zh = grab(zhSrc, 'I18N_ZH'), en = grab(enSrc, 'I18N_EN')
  // 真字典 t()：与 kernel/i18n.js tLookup 同口径（当前语言 → zh 基准 → key；{name} 插值）
  const mkT = (dict) => (key, vars) => { let s = dict[key]; if (s == null) s = zh[key]; if (s == null) return key; if (vars) s = s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? String(vars[n]) : m)); return s }
  const mkKindLabel = (tFn) => (k) => tFn('meta.kind' + String(k || '').charAt(0).toUpperCase() + String(k || '').slice(1))
  // 0.4.8（notes-048-topic-tag-merge）：mentionFilter/mentionCandidate 改吃内核 effTags/effTagsUi（主题并入标签）——eval 沙箱注入内核真码
  const kernelSrc89 = read(path.join('src', 'shared', 'editor-kernel.js'))
  const k0 = kernelSrc89.indexOf('// ===== 0.4.8 三重分类收敛'), k1 = kernelSrc89.indexOf('// ===== end 双模式编辑器内核 v3 =====')
  assert(k0 >= 0 && k1 > k0, 'editor-kernel.js 含 0.4.8 effTags 标记区间')
  const effFns89 = new Function(kernelSrc89.slice(k0, k1) + '\nreturn { effTags: effTags, effTagsUi: effTagsUi }')()
  // 行为级 eval 环境：提取 notes-mention-source 标记块真码，注入 mock host/t/kindLabel/noteRefreshListeners + 内核 effTags/effTagsUi
  const mkEnv = (opts) => {
    const o = opts || {}
    const calls = []
    const host = { call: (m, a) => { calls.push([m, a]); return o.call ? o.call(m, a) : Promise.resolve({ notes: [] }) } }
    const listeners = new Set()
    const noteRefreshListeners = { add: (fn) => listeners.add(fn), delete: (fn) => listeners.delete(fn), has: (fn) => listeners.has(fn) }
    const tFn = mkT(o.lang === 'en' ? en : zh)
    const block = grabBlock(clientSrc, 'notes-mention-source')
    const api = new Function('host', 't', 'kindLabel', 'noteRefreshListeners', 'effTags', 'effTagsUi',
      block + '\nreturn { createNotesMentionSource: createNotesMentionSource, mentionFilter: mentionFilter, mentionCandidate: mentionCandidate, mentionFallbackText: mentionFallbackText, mentionNotesInvalidate: mentionNotesInvalidate, ensureMentionNotes: ensureMentionNotes, mentionCache: mentionCache }'
    )(host, tFn, mkKindLabel(tFn), noteRefreshListeners, effFns89.effTags, effFns89.effTagsUi)
    return Object.assign({ calls: calls, listeners: listeners, noteRefreshListeners: noteRefreshListeners, t: tFn }, api)
  }

  // ===== ① source 结构锚：契约字段齐备（types.d.ts 照抄）+ manifest 登记 + 双端产物 =====
  await t('@ 笔记源结构锚：trigger=@/name=notes/order 置后/codec 双方法/warm 齐备 + manifest 登记 + 双端产物同步', () => {
    assert(manifestSrc.indexOf("'triggers/mentions.js'") >= 0, 'client manifest 登记 triggers/mentions.js')
    for (const [s, tag] of [[clientSrc, '开发版拼接产物'], [cliPkg, '发布包 lib/client.js']]) {
      assert(s.indexOf("trigger: '@'") >= 0 && s.indexOf("name: 'notes'") >= 0, tag + ' source trigger/name 锚')
      assert(s.indexOf('order: 40') >= 0, tag + ' order=40 置后锚（reference 缺省 0，不抢序）')
      assert(s.indexOf('codec: {') >= 0 && s.indexOf('serialize: (ref) =>') >= 0 && s.indexOf('clipboardText: (ref) =>') >= 0, tag + ' codec 双方法锚')
      assert(s.indexOf('async candidates(session, req)') >= 0 && s.indexOf('onPick(pick)') >= 0, tag + ' candidates/onPick 契约方法锚')
    }
    // 行为级：工厂产物结构钉死（字段名严格照 types.d.ts）
    const src0 = mkEnv().createNotesMentionSource()
    assert.strictEqual(src0.trigger, '@', 'trigger = @')
    assert.strictEqual(src0.name, 'notes', 'name = notes（独立分组，不劫持 reference 既有源）')
    assert.strictEqual(src0.order, 40, 'order = 40 置后')
    assert.strictEqual(typeof src0.candidates, 'function', 'candidates 在案')
    assert.strictEqual(typeof src0.onPick, 'function', 'onPick 在案')
    assert.strictEqual(typeof src0.warm, 'function', 'warm 预热钩子在案')
    assert.strictEqual(typeof src0.codec.serialize, 'function', 'codec.serialize 在案')
    assert.strictEqual(typeof src0.codec.clipboardText, 'function', 'codec.clipboardText 在案')
  })

  // ===== ② 候选过滤行为级 eval：sys/软删排除 + query 命中标题/标签（0.4.8 effTags 虚拟合并：存量 topic 并入标签面）+ 上限 8 条 =====
  await t('mentionFilter 行为级 eval：sys/软删组件侧双闸排除 + query 命中标题/标签（0.4.8 主题并入标签·effTags；小写折叠）+ 上限 8 条', () => {
    const env = mkEnv()
    const mk = (i, over) => Object.assign({ id: 'n-' + i, title: '笔记' + i, kind: 'note', tags: [] }, over)
    const notes = [
      mk(1, { title: '发布检查单', topic: '运维', tags: ['release'] }),
      mk(2, { kind: 'sys', title: '注入索引根笔记' }),
      mk(3, { deleted: true, title: '已删条目' }),
      mk(4, { kind: 'log', title: '工作日志 2026-10-09', topic: '工作日志' }),
      mk(5, { title: '周报模板', tags: ['weekly', '报告'] }),
    ]
    assert.deepStrictEqual(env.mentionFilter(notes, '').map((n) => n.id), ['n-1', 'n-4', 'n-5'], '缺省排除 sys + 软删（log 同权保留）')
    assert.deepStrictEqual(env.mentionFilter(notes, '发布').map((n) => n.id), ['n-1'], 'query 命中标题')
    assert.deepStrictEqual(env.mentionFilter(notes, '运维').map((n) => n.id), ['n-1'], 'query 命中主题')
    assert.deepStrictEqual(env.mentionFilter(notes, 'weekly').map((n) => n.id), ['n-5'], 'query 命中标签')
    assert.deepStrictEqual(env.mentionFilter(notes, 'WEEKLY').map((n) => n.id), ['n-5'], 'query 大小写折叠')
    assert.deepStrictEqual(env.mentionFilter(notes, '不存在的词'), [], '零命中返回空数组')
    const big = []
    for (let i = 0; i < 12; i++) big.push(mk('x' + i))
    assert.strictEqual(env.mentionFilter(big, '').length, 8, '上限 8 条（MENTION_MAX 闸口）')
    assert.deepStrictEqual(env.mentionFilter(null, 'x'), [], 'null 清单容错')
    assert.deepStrictEqual(env.mentionFilter(undefined), [], '缺省入参容错')
  })

  // ===== ③ candidates→onPick→serialize 链路行为级 eval（chip 契约 + 内联正文 + 失败透明降级）=====
  await t('candidates/onPick/serialize 链路 eval：候选行投影 + insert chip 契约 + serialize 内联正文 / 失败透明降级 / 失效重拉', async () => {
    const noteBody = '## 结论\n\n采用方案 A\n'
    const env = mkEnv({ call: (m, a) => {
      if (m === 'notes-list') return Promise.resolve({ notes: [
        { id: 'n-a1', title: '架构决策', topic: '架构', tags: ['dsh'], kind: 'decision' },
        { id: 'n-b2', title: '', kind: 'note' },
      ] })
      if (m === 'notes-get') return Promise.resolve({ note: { id: a.id, title: '架构决策', body: noteBody } })
      return Promise.resolve({})
    } })
    const src = env.createNotesMentionSource()
    const REQ = { query: '', position: 'inline', drilled: false, signal: { aborted: false } }
    const cands = await src.candidates({ sessionId: 'session-x' }, REQ)
    assert.strictEqual(cands.length, 2, '候选行数 = 清单全量（未超限）')
    assert.strictEqual(cands[0].name, '架构决策', 'name = 标题（pick 载荷/检索键）')
    assert.strictEqual(cands[0].section, '笔记', 'section = mention.section（zh）')
    assert.strictEqual(cands[0].description, 'dsh · 决策', 'description = 首枚有效标签 · 类型（0.4.8 effTagsUi：tags 先于 topic——实得 ' + cands[0].description + '）')
    assert.strictEqual(cands[0].icon, 'file', 'icon = file 字形令牌')
    assert.strictEqual(cands[0].value, 'n-a1', 'value = 笔记 id（onPick 不透明载荷）')
    assert.strictEqual(cands[1].name, '无标题', '空标题回退 tree.untitled')
    assert.strictEqual(cands[1].description, '笔记', '无标签行 description 只剩类型词（0.4.8 主题并入标签）')
    assert(env.mentionCache.notes !== null, '首拉后缓存暖（warm 数据源）')
    // signal aborted（查询更迭/菜单关闭）→ 空
    assert.deepStrictEqual(await src.candidates({ sessionId: 'session-x' }, { query: '', position: 'inline', drilled: false, signal: { aborted: true } }), [], 'signal aborted 返回空')
    // onPick → insert chip 契约（ReferenceInsert 五字段）
    const out = src.onPick({ candidate: cands[0], session: { sessionId: 'session-x' }, position: 'inline', via: 'menu', action: 'pick', span: { start: 0, end: 1, draftRev: 1 } })
    assert.deepStrictEqual(out, { insert: { source: 'notes', ref: 'n-a1', label: '架构决策', appearance: 'file', clipboardText: '@架构决策' } }, 'insert 契约五字段（source/ref/label/appearance/clipboardText）')
    assert.strictEqual(src.onPick({ candidate: { name: 'x' } }), undefined, '缺 value 候选不产出（守卫）')
    assert.strictEqual(src.onPick(null), undefined, '空 pick 不抛')
    // serialize 成功：内联【笔记 · 标题 · id】+ 正文（zh）
    assert.strictEqual(await src.codec.serialize('n-a1', { aborted: false }), '【笔记 · 架构决策 · n-a1】\n' + noteBody, 'serialize 内联格式（zh：标题/id/正文）')
    // serialize 成功（en）：inlineHead 走字典英文形态
    const envEn = mkEnv({ lang: 'en', call: (m, a) => m === 'notes-get' ? Promise.resolve({ note: { id: a.id, title: '架构决策', body: noteBody } }) : Promise.resolve({ notes: [] }) })
    assert.strictEqual((await envEn.createNotesMentionSource().codec.serialize('n-a1', { aborted: false })).split('\n')[0], '[Note · 架构决策 · n-a1]', 'serialize 内联格式（en）')
    // serialize 失败：notes-get 拒绝 → 透明降级（标题自暖缓存解析；不阻塞发送不静默吞错）
    const envFail = mkEnv({ call: (m) => m === 'notes-list' ? Promise.resolve({ notes: [{ id: 'n-a1', title: '架构决策', kind: 'note' }] }) : Promise.reject(new Error('boom')) })
    await envFail.createNotesMentionSource().candidates({ sessionId: 's' }, REQ)   // 暖缓存
    assert.strictEqual(await envFail.createNotesMentionSource().codec.serialize('n-a1', { aborted: false }), '@架构决策（内容拉取失败）', '失败透明降级（含标题注记）')
    // serialize 失败：error 形态响应同样降级；缓存冷时标题回退 id
    const envCold = mkEnv({ call: (m) => m === 'notes-get' ? Promise.resolve({ error: 'Note has been deleted' }) : Promise.resolve({ notes: [] }) })
    assert.strictEqual(await envCold.createNotesMentionSource().codec.serialize('n-g9', { aborted: false }), '@n-g9（内容拉取失败）', 'error 响应降级 + 缓存冷回退 id')
    // codec.clipboardText 投影：缓存命中 '@标题'，缓存冷 '@'+id
    assert.strictEqual(src.codec.clipboardText('n-a1'), '@架构决策', 'clipboardText 缓存命中投影')
    assert.strictEqual(envCold.createNotesMentionSource().codec.clipboardText('n-g9'), '@n-g9', 'clipboardText 缓存冷回退')
    // 失效重拉：notifyNotesChanged → 缓存清空 → 下次 candidates 重新 notes-list
    const before = env.calls.filter((c) => c[0] === 'notes-list').length
    env.mentionNotesInvalidate()
    assert.strictEqual(env.mentionCache.notes, null, '失效清空缓存')
    await src.candidates({ sessionId: 'session-x' }, REQ)
    assert.strictEqual(env.calls.filter((c) => c[0] === 'notes-list').length, before + 1, '失效后惰性重拉')
    // notes-list 拉取失败 → 空候选静默降级（不抛给菜单管线）+ 缓存不污染（下次重试）
    const envDown = mkEnv({ call: () => Promise.reject(new Error('netdown')) })
    assert.deepStrictEqual(await envDown.createNotesMentionSource().candidates({ sessionId: 's' }, REQ), [], '拉取失败 → 空候选静默降级')
    assert.strictEqual(envDown.mentionCache.notes, null, '失败不污染缓存')
    // warm 预热：scope 诞生即首拉（fire-and-forget）
    const envW = mkEnv()
    envW.createNotesMentionSource().warm({ sessionId: 'session-w' })
    assert.strictEqual(envW.calls.length, 1, 'warm 首拉一次')
    assert.strictEqual(envW.calls[0][0], 'notes-list', 'warm 拉取 notes-list')
  })

  // ===== ④ 服务缺席守卫行为级 eval：inputTriggers 缺席静默不注册；在场注册 + 失效监听成对挂载/卸载 =====
  await t('服务缺席守卫 eval：ctx.get(inputTriggers)=undefined/残缺 不抛不注册；在场时 registerSource + 监听成对挂卸', () => {
    const srcBlock = grabBlock(clientSrc, 'notes-mention-source')
    const regBlock = grabBlock(clientSrc, 'notes-mention-register')
    const run = (svc) => {
      const registered = []
      const offCalls = []
      const disposers = []
      const listeners = new Set()
      const noteRefreshListeners = { add: (fn) => listeners.add(fn), delete: (fn) => listeners.delete(fn) }
      const tFn = mkT(zh)
      const host = { call: () => Promise.resolve({ notes: [] }) }
      const srcApi = new Function('host', 't', 'kindLabel', 'noteRefreshListeners', srcBlock + '\nreturn { createNotesMentionSource: createNotesMentionSource, mentionNotesInvalidate: mentionNotesInvalidate }')(host, tFn, mkKindLabel(tFn), noteRefreshListeners)
      // 有 registerSource 方法的服务包装录制（注册载荷 + 卸载调用）；残缺/缺席原样透传走守卫分支
      const svcWrap = svc && typeof svc.registerSource === 'function' ? { registerSource: (s) => { registered.push(s); return () => offCalls.push(s.name) } } : svc
      const ctx = { get: (n) => n === 'inputTriggers' ? svcWrap : undefined, effect: (fn, label) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d } }
      new Function('ctx', 'noteRefreshListeners', 'createNotesMentionSource', 'mentionNotesInvalidate', regBlock)(ctx, noteRefreshListeners, srcApi.createNotesMentionSource, srcApi.mentionNotesInvalidate)
      return { registered: registered, offCalls: offCalls, disposers: disposers, listeners: listeners }
    }
    // 缺席：undefined → 零注册零抛错（静默红线）
    const absent = run(undefined)
    assert.strictEqual(absent.registered.length, 0, '服务缺席零注册')
    assert.strictEqual(absent.disposers.length, 0, '服务缺席零 effect disposer')
    assert.strictEqual(absent.listeners.size, 0, '服务缺席零监听挂载')
    // 残缺：服务对象无 registerSource 方法 → 同样不注册（守卫 typeof 闸）
    const broken = run({})
    assert.strictEqual(broken.registered.length, 0, '残缺服务（无 registerSource）零注册')
    // 在场：注册 1 个 source（name=notes）+ 失效监听挂载；disposer 摘除成对
    const live = run({ registerSource: (s) => s })
    assert.strictEqual(live.registered.length, 1, '在场注册 1 个 source')
    assert.strictEqual(live.registered[0].name, 'notes', '注册 source name=notes')
    assert.strictEqual(live.registered[0].trigger, '@', '注册 source trigger=@')
    assert.strictEqual(live.listeners.size, 1, 'notifyNotesChanged 失效监听已挂载')
    assert.strictEqual(live.disposers.length, 1, 'effect 返回 disposer')
    live.disposers[0]()
    assert.deepStrictEqual(live.offCalls, ['notes'], 'disposer 调用 registerSource 卸载函数')
    assert.strictEqual(live.listeners.size, 0, 'disposer 摘除失效监听（挂/卸成对）')
  })

  // ===== ⑤ i18n 双语键（mention.* 三键取值锚 + 模块引用 + 零内联中文 + 产物字典同步）=====
  await t('mention.* 双语在案：section/inlineHead/fetchFailed 三键 zh/en 取值锚 + 模块引用 + 零内联中文 + 产物字典同步', () => {
    const PAIRS = {
      'mention.section': ['笔记', 'Notes'],
      'mention.inlineHead': ['【笔记 · {title} · {id}】', '[Note · {title} · {id}]'],
      'mention.fetchFailed': ['@{title}（内容拉取失败）', '@{title} (content fetch failed)'],
    }
    for (const k of Object.keys(PAIRS)) {
      assert.strictEqual(zh[k], PAIRS[k][0], k + ' zh 文案锚定')
      assert.strictEqual(en[k], PAIRS[k][1], k + ' en 文案锚定')
      assert(mentionSrc.indexOf("'" + k + "'") >= 0, k + ' 模块引用在位')
    }
    // 模块零内联中文（去注释口径；序列化标记/降级文案全部走 t() 字典）。本文件字符串/正则内无 // 形态，行注释可整行剥离
    const noComments = mentionSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    assert(!/[一-鿿]/.test(noComments), 'mentions.js 去注释后零内联中文（文案全走 t()）')
    // 产物字典同步（68 节③行数断言同源复查新键即可，全量行数由 68 节看守）
    assert(cliPkg.indexOf("'mention.section': '笔记'") >= 0 && cliPkg.indexOf("'mention.section': 'Notes'") >= 0, 'lib/client.js 产物字典同步（需先跑 build-dist）')
  })
  }
}
