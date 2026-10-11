// 节 133. 文档安全 S5（notes-052-source-mask）：源码模式遮蔽 + 预览面补漏
// 背景裁决修订：用户实测推翻「源码见真相」（反馈 n-mv38ikn332ir）——屏幕泄露威胁在源码面同样成立，
//   新口径 = 机密块在任何默认视图都不裸露，揭示是临时动作。
// 覆盖面：
//   ① 内核显示面打码：maskSecretPreview(body, label) 行为级（span → 调用侧注入占位文案；零 span 逐字节恒等；
//      物理单源 parseSecretSpans 零私有围栏正则）+ 派发弹窗预览打码静态锚双端（app：n.preview||n.body 兜底原文路径；
//      client：显示面同形兜底——host persist 源头已打码，弹窗只管显示面）。
//   ② persist preview 源头打码（行为级 + 静态锚双包）：slim preview = maskSecretSpans(body) 后再 slice(0,200)——
//      一处修，列表预览/面板本地过滤/派发弹窗预览全消费方受益；span 开头场景 preview 变占位行（本地过滤与 host
//      全文检索口径对齐——span 内词两面都搜不到）；零 span 逐字节恒等；落盘 .md 原文零触碰（打码只在 RPC 瘦身面）。
//   ③ app 源码遮蔽静态锚：镜像层抬 z-index 2 盖住 textarea（z1）+ 机密 span 连续行 → 不透明遮蔽块（量高铺行
//      break-word 对齐 textarea 换行策略——遮蔽块高度 ≥ 底层真实渲染高度，防露机密尾巴）+ 点击揭示/自动回蔽链
//      （与富文本岛共用计时器单飞）+ **遮蔽永不写回红线**（refreshSecretMirror 函数体零 .value/.body 写入——
//      写回 = 把用户凭据替换成遮挡文本 = 数据事故；行为级由 e2e 用例 64 保存往返逐字节断言看守）。
//   ④ 面板源码模式同款遮蔽（client editor.js）：rebuildPanelSrcVeil（app 同构两遍法）+ 常驻层挂载（非源码态/无 span
//      空层零开销）+ 点击委托/resize 跟随 + 样式双端（styles.css .dsh-notes-src-veil ⇄ app head.html .src-mirror）。
//   ⑤ e2e 在案锚：用例 64 全链（遮蔽→揭示→编辑→自动回蔽→保存往返零写回）+ 用例 62 源码面断言翻转为遮蔽语义
//      （textarea.value 存真原文 + 渲染文本层零机密——S1 旧断言 mirror.textContent 含机密作废，等价守卫在 129 节内注明）。
// 红线：遮蔽纯渲染层（textarea.value 永存真原文）；富文本岛/揭示计时器语义不动；preview 打码只动 persist 一处；
//   行级 sensitive 打码与篇级语义不动（S2 断言 130 节看守）。
module.exports = {
  id: "133",
  title: "133. 文档安全 S5：源码模式遮蔽 + 预览面补漏（notes-052-source-mask）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, clientSrc } = H
  const { llmMock, admMock, agentsMock, sessionPersistenceMock, workspaceRegistryMock, sessionTitleMock, sessionQueryMock, NOTES_DIR } = S
  section('133. 文档安全 S5：源码模式遮蔽 + 预览面补漏（notes-052-source-mask）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')
  const FENCE = '```secret'

  // ===== 133.1 内核显示面打码 maskSecretPreview 行为级 + 派发弹窗静态锚双端 =====
  const ekSrc = read('src/shared/editor-kernel.js')
  const K133 = new Function('document', ekSrc + '\nreturn { parseSecretSpans: parseSecretSpans, maskSecretPreview: maskSecretPreview }')({})
  await t('S5 内核显示面打码：maskSecretPreview 行为级（span→占位/零 span 恒等）+ 派发弹窗预览打码静态锚双端（app n.body 兜底 + client 显示面）', () => {
    const body = '派发良性行\n\n' + FENCE + '\nDISPMASK99\n第二机密行\n```\n\n派发收尾行'
    const m = K133.maskSecretPreview(body, '🔒 机密区（已打码）')
    assert(m.indexOf('DISPMASK99') < 0 && m.indexOf('第二机密行') < 0, 'span 明文消失')
    assert(m.indexOf('派发良性行') >= 0 && m.indexOf('派发收尾行') >= 0, '良性行保留')
    assert(m.indexOf('🔒 机密区（已打码）') >= 0, '调用侧注入占位文案在案（内核零硬编码文案纪律）')
    assert.strictEqual(K133.maskSecretPreview(body, ''), '派发良性行\n\n\n\n派发收尾行', '空标签 = 空占位（不硬编码中文——i18n 键纪律由调用侧承担）')
    assert.strictEqual(K133.maskSecretPreview('普通正文', 'L'), '普通正文', '零 span 逐字节恒等（无打码面零扰动）')
    // 多块 + span 开头（preview 常见形态）
    const m2 = K133.maskSecretPreview(FENCE + '\nA\n```\n中段\n' + FENCE + '\nB\n```', 'P')
    assert(m2.indexOf('A') < 0 && m2.indexOf('B') < 0 && m2 === 'P\n中段\nP', '多块各自占位（span 开头场景 preview 变占位文本）')
    // 派发弹窗静态锚双端：app（n.preview || n.body 兜底原文路径必须过 mask）+ client（显示面同形兜底）
    const appDisp = read('src/app/modals/dispatch.js')
    const cliDisp = read('src/client/modals/dispatch.js')
    assert(appDisp.indexOf('function dispPreviewText(n)') >= 0 && appDisp.indexOf("maskSecretPreview(raw, t('disp.secretMasked'))") >= 0, 'app 派发弹窗预览经 maskSecretPreview（占位行内联形态）再 slice')
    assert(appDisp.indexOf('String((n && (n.preview || n.body)) || \'\')') >= 0, 'app 兜底口径：preview 缺席走 body 原文——必须过打码（S3 已管派发载荷，本面只管弹窗显示）')
    assert(cliDisp.indexOf('function dispPreviewText(n, label)') >= 0 && cliDisp.indexOf('maskSecretPreview(raw, label)') >= 0, 'client 派发弹窗显示面同形兜底（host persist 源头已打码，此处幂等）')
    assert(cliDisp.indexOf("dispPreviewText(showNote, tt('disp.secretMasked'))") >= 0, 'client 弹窗渲染接线走 tt() i18n 键')
    // 内核零私有围栏正则红线：maskSecretPreview 消费 parseSecretSpans（单一事实源）
    assert(ekSrc.indexOf('function maskSecretPreview(body, label)') >= 0 && ekSrc.slice(ekSrc.indexOf('function maskSecretPreview'), ekSrc.indexOf('function maskSecretPreview') + 900).indexOf('parseSecretSpans') >= 0, 'maskSecretPreview 消费 parseSecretSpans（零私有 span 围栏正则）')
    assert(ekSrc.indexOf('===== secret-span END =====') < ekSrc.indexOf('function maskSecretPreview(body, label)'), 'maskSecretPreview 在切片标记外（host 切片不含——host 显示面走 sensitive-helpers，S2 同源锚 130.0 不破）')
  })

  // ===== 133.2 persist preview 源头打码（行为级 + 静态锚双包）=====
  function mk133() {
    const store = new Map()
    const fsMock = {
      resolve: async (p) => p,
      stat: async (p) => {
        if (p === NOTES_DIR) return { dir: true }
        if (store.has(p)) return { file: true }
        const prefix = p + '\\'
        for (const k of store.keys()) if (k.startsWith(prefix)) return { dir: true }
        return null
      },
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        const seen = {}
        for (const k of store.keys()) {
          if (!k.startsWith(prefix)) continue
          const rest = k.slice(prefix.length)
          const cut = rest.indexOf('\\')
          if (cut < 0) { if (!seen[rest]) { seen[rest] = true; out.push({ name: rest }) } }
          else { const d = rest.slice(0, cut); if (d && !seen[d]) { seen[d] = true; out.push({ name: d, type: 'dir' }) } }
        }
        return out
      },
      readText: async (p) => { if (!store.has(p)) throw new Error('ENOENT: ' + p); return store.get(p) },
      writeText: async (p, c) => { store.set(p, c) },
    }
    const handlers = {}
    const tools = []
    const contexts = []
    const harnessMock = { handle: (name, fn) => { handlers[name] = fn; return () => { delete handlers[name] } }, defineTool: (d) => d, registerTool: (c, d) => { tools.push(d); return () => {} } }
    new Function('harness', 'pluginDir', hostSrc)(harnessMock, DIR).apply({
      fs: fsMock, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contexts.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    return { store, handlers, tools, contexts }
  }
  await t('S5 persist preview 源头打码：span 开头笔记 preview 零机密（占位行）+ 零 span 逐字节恒等 + 落盘 .md 原文零触碰 + persist 双包静态锚', async () => {
    const inst = mk133()
    const spanBody = '开头良行133\n\n' + FENCE + '\nPERSISTSEC99\n机密第二行\n```\n\n收尾良行'
    const spanFirst = FENCE + '\nFIRSTSEC99\n```\n\n机密开头笔记的良性收尾'
    const c1 = await inst.handlers['notes-create']({ title: 'S5 预览机密', body: spanBody })
    const c2 = await inst.handlers['notes-create']({ title: 'S5 预览普通', body: '普通正文133全量' })
    const c3 = await inst.handlers['notes-create']({ title: 'S5 预览机密开头', body: spanFirst })
    const r = await inst.handlers['notes-list']({})
    const p1 = r.notes.find(n => n.id === c1.id).preview
    const p2 = r.notes.find(n => n.id === c2.id).preview
    const p3 = r.notes.find(n => n.id === c3.id).preview
    assert(p1.indexOf('PERSISTSEC99') < 0 && p1.indexOf('机密第二行') < 0, '含机密笔记 preview 零机密')
    assert(p1.indexOf('开头良行133') === 0 && p1.indexOf('🔒 机密区（4 行，note_get reveal 获取）') >= 0 && p1.indexOf('收尾良行') >= 0, '占位行内联形态（maskSecretSpans 同源）+ 良性段保留')
    assert(p3.indexOf('FIRSTSEC99') < 0 && p3.indexOf('🔒 机密区（3 行，note_get reveal 获取）') === 0, 'span 开头笔记 preview 变占位行（零位置泄漏）')
    assert.strictEqual(p2, '普通正文133全量', '零 span 笔记 preview 逐字节恒等（无打码面零回归）')
    // 更新路径同打码（body 换代后 preview 重算）
    await inst.handlers['notes-update']({ id: c2.id, body: '更新后\n\n' + FENCE + '\nUPDSEC99\n```' })
    const r2 = await inst.handlers['notes-list']({})
    const p2b = r2.notes.find(n => n.id === c2.id).preview
    assert(p2b.indexOf('UPDSEC99') < 0 && p2b.indexOf('更新后') === 0 && p2b.indexOf('🔒 机密区（3 行') >= 0, 'update 换代后 preview 重算同打码')
    // 落盘红线：preview 打码只在 RPC 瘦身面——盘上 .md 原文零触碰（遮蔽永不写回的 host 面）
    const raw = String(inst.store.get(NOTES_DIR + '\\' + c1.id + '.md') || '')
    assert(raw.indexOf('PERSISTSEC99') >= 0 && raw.indexOf('开头良行133') >= 0, '落盘 .md 含机密原文（preview 打码绝不写回文件）')
    const g = await inst.handlers['notes-get']({ id: c1.id })
    assert(g.note.body.indexOf('PERSISTSEC99') >= 0, 'notes-get RPC 明文红线不动（S2 面二契约原样）')
    // 双包静态锚：persist.js ⇄ persist.dist.js 同形调用（节 76 归一一致由既有断言看守，此处锁打码形态在案）
    const MASK_LINE = "preview: (typeof maskSecretSpans === 'function' ? maskSecretSpans(String(n.body || '')) : String(n.body || '')).slice(0, 200)"
    for (const [pf, tag] of [['src/host/kernel/persist.js', 'persist.js'], ['src/host/kernel/persist.dist.js', 'persist.dist.js'], ['packages/dsh-notes-plugin/index.mjs', 'index.mjs（需先跑 build-dist）']]) {
      assert(read(pf).indexOf(MASK_LINE) >= 0, tag + ' preview 源头打码形态在案（mask 后再 slice）')
    }
  })

  // ===== 133.3 app 源码遮蔽静态锚 + 遮蔽永不写回红线 =====
  const appEd = read('src/app/panels/editor.js')
  const appHead = read('src/app/shell/head.html')
  await t('S5 app 源码遮蔽静态锚：镜像层 z-index 2 盖住 textarea + 遮蔽块/揭示/回蔽链 + 量高铺行 break-word 对齐 + 遮蔽永不写回红线（refreshSecretMirror 零 .value/.body 写入）', () => {
    // 层序：镜像必须抬到 textarea(z1) 之上——否则遮蔽块在文本下方盖不住真实凭据
    assert(appHead.indexOf('color:transparent;z-index:2}') >= 0 && appHead.indexOf('#edSrc{position:relative;z-index:1}') >= 0, 'head.html 镜像层 z-index 2 盖住 textarea（z1）——S1 旧 z0 作废')
    // 遮蔽块样式：不透明实底 + 揭示态 visibility:hidden（保留占位 + 点击穿透编辑）
    assert(appHead.indexOf('.src-mirror .src-secret-veil{') >= 0 && appHead.indexOf('background:var(--npanel)') >= 0, '遮蔽块不透明实底（同色板不透明 token）')
    assert(appHead.indexOf('.src-mirror .src-secret-veil.revealed{visibility:hidden;pointer-events:none}') >= 0, '揭示态 visibility:hidden（占位保留 + 点击穿透）')
    // 量高铺行：机密行内联 break-word（textarea 换行策略）——遮蔽块高度 ≥ 底层真实渲染高度（短一截露机密尾巴）
    assert(appEd.indexOf("'<div' + (lineSpan[i] != null ? ' class=\"src-secret\" style=\"overflow-wrap:break-word\"' : '') + '>' + (ln2 ? esc(ln2) : '') + '</div>'") >= 0, '量高铺行（真实文本 + 机密行 break-word 对齐换行）——两遍法第一遍')
    assert(appEd.indexOf('var r0 = kids[i2].getBoundingClientRect(), r1 = kids[i2 + n2 - 1].getBoundingClientRect();') >= 0, 'span 连续行段实测高度（首行 top 至末行 bottom）')
    assert(appEd.indexOf("'<div class=\"src-secret src-secret-veil' + (revealed ? ' revealed' : '') + '\" data-sec=\"' + si + '\" style=\"height:' + h + 'px\">' + esc(t('editor.secretVeil')) + '</div>'") >= 0, '遮蔽块组装（实底高度 + 揭示态续态 + i18n 标签）')
    // 揭示/回蔽链：与富文本岛共用计时器单飞；揭示偏移续态（span 内打字持续揭示）
    assert(appEd.indexOf('var srcRevealedStart = null;') >= 0 && appEd.indexOf('srcRevealedStart = sp.start;') >= 0, '揭示偏移态（revealSrcSecret）')
    assert(appEd.indexOf('if (srcRevealedStart != null) { srcRevealedStart = null; refreshSecretMirror(); }') >= 0, '计时器回调源码面同步回蔽（共用单飞）')
    assert(appEd.indexOf("ev.target.closest('.src-secret-veil')") >= 0, '遮蔽块点击委托挂镜像节点（innerHTML 频繁重建不脱钩）')
    for (const anchor of ['srcRevealedStart = null;   /* 文档安全 S5：新内容到达回填', 'srcRevealedStart = null;   /* 文档安全 S5：源码揭示态随切换收编', 'srcRevealedStart = null;   /* 文档安全 S5：取消机密后 span 序全变', 'srcRevealedStart = null;   /* 文档安全 S5：新 span 序落位']) {
      assert(appEd.indexOf(anchor) >= 0, '揭示态收编点在案：' + anchor.slice(0, 40))
    }
    // 遮蔽永不写回红线（本卡命门）：refreshSecretMirror 函数体零 .value/.body 写入（写回 = 把凭据替换成遮挡文本 = 数据事故）
    const fm = appEd.slice(appEd.indexOf('function refreshSecretMirror()'), appEd.indexOf('function revealSrcSecret'))
    assert(fm.indexOf('ta.value') >= 0 && fm.indexOf('edNote.body') >= 0, '函数体读口径在案（真原文数据源——只读）')
    assert(!/(\.value|\.body)\s*=[^=]/.test(fm), 'refreshSecretMirror 零 .value/.body 写入（遮蔽纯渲染层红线）')
  })

  // ===== 133.4 面板源码模式同款遮蔽（client editor.js + styles.css）=====
  const cliEd = read('src/client/panels/panel/editor.js')
  const stylesCss = read('src/styles.css')
  await t('S5 面板源码遮蔽静态锚：rebuildPanelSrcVeil 同构（零 .value/.body 写入）+ 常驻层/点击委托/resize 跟随 + 样式双端', () => {
    assert(cliEd.indexOf('function rebuildPanelSrcVeil()') >= 0 && cliEd.indexOf('function revealPanelSrcSecret(veil)') >= 0, '面板遮蔽两件套（重建执行体 + 揭示入口）')
    assert(cliEd.indexOf('const srcVeilRef = React.useRef(null)') >= 0 && cliEd.indexOf("const srcRevealStartRef = React.useRef(null)") >= 0, '面板遮蔽 ref（层 DOM + 揭示偏移态）')
    assert(cliEd.indexOf('React.useEffect(() => { rebuildPanelSrcVeil() })') >= 0, '重建接线（每渲染后重建——键入/切语言随行，无 span 空层零开销）')
    assert(cliEd.indexOf("e('div', { ref: srcVeilRef, className: 'dsh-notes-src-veil', 'aria-hidden': 'true' })") >= 0, '常驻层挂载（非源码态/无 span 空层零开销）')
    assert(cliEd.indexOf("layer.addEventListener('click', onClick)") >= 0 && cliEd.indexOf("ev.target.closest ? ev.target.closest('.src-secret-veil') : null") >= 0, '点击委托挂层节点（常驻不脱钩）')
    assert(cliEd.indexOf('window.addEventListener(\'resize\', onRz)') >= 0, 'resize 换行点漂移跟随（app 同款纪律）')
    assert(cliEd.indexOf('srcRevealStartRef.current = null   // 文档安全 S5：源码遮蔽同步回蔽') >= 0, '计时器回调源码面同步回蔽（与富文本岛共用单飞）')
    assert(cliEd.indexOf('esc(tt(\'editor.secretVeil\'))') >= 0, '遮蔽块标签走 tt() i18n 键（双端同键）')
    // 样式双端：styles.css 面板层 ⇄ app head.html 同构（同字体/行距/内边距/换行策略 + 揭示态 visibility:hidden）
    assert(stylesCss.indexOf('.dsh-notes-src-veil{position:absolute;inset:0;') >= 0 && stylesCss.indexOf('.dsh-notes-src-veil .src-secret-veil.revealed{visibility:hidden;pointer-events:none}') >= 0, 'styles.css 面板遮蔽层 + 揭示态（app 同构）')
    // 遮蔽永不写回红线（面板同构）：rebuildPanelSrcVeil 函数体零 .value/.body 写入
    const fm2 = cliEd.slice(cliEd.indexOf('function rebuildPanelSrcVeil()'), cliEd.indexOf('// 遮蔽块点击揭示'))
    assert(fm2.indexOf('layer.innerHTML') >= 0 && fm2.indexOf('parseSecretSpans') >= 0, '函数体只操作镜像层 DOM（受控 textarea 真原文由 React 持有）')
    assert(!/(\.value|\.body)\s*=[^=]/.test(fm2), 'rebuildPanelSrcVeil 零 .value/.body 写入（遮蔽纯渲染层红线——双端同守）')
  })

  // ===== 133.5 e2e 在案锚 + i18n 双语键 =====
  const e2e64 = read('scripts/e2e/cases/64-secret-source-mask.cjs')
  const e2e62 = read('scripts/e2e/cases/62-secret-span.cjs')
  const zhDict = new Function(read('src/i18n/zh.js') + '\nreturn I18N_ZH')()
  const enDict = new Function(read('src/i18n/en.js') + '\nreturn I18N_EN')()
  await t('S5 e2e 在案锚：用例 64 全链（遮蔽→揭示→编辑→自动回蔽→保存往返零写回）+ 用例 62 源码面断言翻转（渲染文本层零机密）', () => {
    assert(e2e64.indexOf('64-secret-source-mask') >= 0 && e2e64.indexOf('SRCMASK-9931') >= 0 && e2e64.indexOf('src-secret-veil') >= 0, '用例 64 覆盖遮蔽块与机密锚词')
    assert(e2e64.indexOf("ta.value === b") >= 0 && e2e64.indexOf("mi.textContent.indexOf('SRCMASK-9931') < 0") >= 0, '用例 64 断言 textarea.value 逐字节恒等 + 渲染文本层零机密')
    assert(e2e64.indexOf('getComputedStyle(mi).zIndex') >= 0, '用例 64 断言镜像层在 textarea 之上（层序覆盖保证）')
    assert(e2e64.indexOf('13000') >= 0 && e2e64.indexOf('自动回蔽') >= 0, '用例 64 覆盖 ~10s 自动回蔽节拍')
    assert(e2e64.indexOf('切回落定（重载正文逐字节真原文') >= 0, '用例 64 覆盖保存往返零写回（红线行为级）')
    // 用例 62 翻转：S1 旧断言（mirror.textContent 含机密）作废——新语义 = 遮蔽块在案 + 渲染文本层零机密 + 值存真
    assert(e2e62.indexOf("mi.textContent.indexOf('TOPSECRET-4242') < 0") >= 0 && e2e62.indexOf('src-secret-veil') >= 0 && e2e62.indexOf('.src-secret-veil') >= 0, '用例 62 源码面断言翻转为遮蔽语义（129 节等价守卫注明）')
    assert(e2e62.indexOf('textarea 值存真围栏原文') >= 0, '用例 62 保留等价守卫：值存真原文（遮蔽纯渲染层）')
    // i18n 双语键（S5 新增 2 键；secretPlaceholder 翻转口径在 129 节看守）
    for (const k of ['editor.secretVeil', 'disp.secretMasked']) assert(typeof zhDict[k] === 'string' && zhDict[k] && typeof enDict[k] === 'string' && enDict[k], k + ' 双字典齐备且非空')
    assert(zhDict['editor.secretVeil'] === '🔒 机密区 · 点击揭示' && enDict['editor.secretVeil'] === '🔒 Secret area · click to reveal', '遮蔽块标签口径（zh/en）')
    assert(zhDict['disp.secretMasked'] === '🔒 机密区（已打码）' && enDict['disp.secretMasked'] === '🔒 Secret area (masked)', '派发弹窗占位口径（zh/en）')
    // 双端标签同键：app（t）与 client（tt）消费同一键
    assert(appEd.indexOf("esc(t('editor.secretVeil'))") >= 0 && cliEd.indexOf("esc(tt('editor.secretVeil'))") >= 0, '双端遮蔽块标签同键（app t() / client tt()）')
  })
  }
}
