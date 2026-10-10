// 节 129. 文档安全 S1（notes-052-span-kernel2）：parseSecretSpans 内核 + secret fence 双模渲染
// 覆盖面：
//   ① parseSecretSpans 行为级（顶格识别/闭合/EOF 兜底/缩进不算/多块/嵌套退化/普通围栏内不另开 + 偏移 slice = 完整 fence 源）
//     + 与 renderMarkdown 扫描一致性（span 数 = 渲染机密岛数；单 span 用例 data-md-src === body.slice(start,end) 镜像不变量）；
//   ② 往返恒等：serializeRich(parse(render(body))) === body 逐字节（特殊字符/[[..]]/URL/星号/HTML 形文本/多块/EOL(EOF)兜底/普通 fence 混排）
//     —— fence 字面量原则：内容不解析不归一化（渲染产物零 <a>/<strong> 侵入）；
//   ③ blur markup 静态锚（先 esc 后渲染 + contenteditable=false + data-md-src）+ 静态占位（正文不进 DOM + 标签调用侧注入，内核零硬编码文案）；
//   ④ DEG 红线：secret fence 永不触发降级（fence 内容豁免照旧，围栏外规则照常检出）；
//   ⑤ 三入口静态锚（工具栏🛡/右键菜单（0.4.8 ctxmenu 基建）/Ctrl+Shift+S）+ 揭示/取消机密/dirty 保护/源码染色镜像 + 预览四端静态占位 + i18n 双语键。
// 红线：不改篇级 sensitive 语义（host sensitive-helpers 零触碰）；不动 0.4.9 既有断言（116 节 chrome 行原样）。
module.exports = {
  id: "129",
  title: "129. 文档安全 S1：secret span 内核与编辑器双模渲染（notes-052-span-kernel2）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('129. 文档安全 S1：secret span 内核与编辑器双模渲染（notes-052-span-kernel2）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')
  const appEd = read('src/app/panels/editor.js')
  const appKb = read('src/app/panels/keyboard.js')
  const appHead = read('src/app/shell/head.html')
  const stylesCss = read('src/styles.css')
  const appHist = read('src/app/modals/history.js')
  const appTrash = read('src/app/modals/trash.js')
  const cliHist = read('src/client/modals/history.js')
  const cliTrash = read('src/client/modals/trash.js')
  const e2eCase = read('scripts/e2e/cases/62-secret-span.cjs')
  const zhDict = new Function(read('src/i18n/zh.js') + '\nreturn I18N_ZH')()
  const enDict = new Function(read('src/i18n/en.js') + '\nreturn I18N_EN')()

  // ===== 内核块提取（clientSrc = concatClient 产物，与 app.html/lib-client.js 字节一致——三端同步由 25 节常驻锁）=====
  const KS = '// ===== 双模式编辑器内核 v3', KE = '// ===== end 双模式编辑器内核 v3 ====='
  const ps = clientSrc.indexOf(KS), pe = clientSrc.indexOf(KE)
  assert(ps >= 0 && pe > ps, 'client 拼接产物含内核标记区间')
  const kernelBlock = clientSrc.slice(clientSrc.lastIndexOf('\n', ps) + 1, pe + KE.length)
  // MiniDOM（节 19 同款子集：serializeRich 依赖的 DOM 面 + 白名单 HTML 解析器）
  function decodeEnt(s) { return String(s).replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => k === 'amp' ? '&' : k === 'lt' ? '<' : k === 'gt' ? '>' : k === 'quot' ? '"' : "'") }
  class MT { constructor(v) { this.nodeType = 3; this.nodeValue = v; this.childNodes = []; this.textContent = v } cloneNode() { return new MT(this.nodeValue) } }
  class ME {
    constructor(tag) { this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.attributes = {}; this.childNodes = [] }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null }
    setAttribute(k, v) { this.attributes[k] = String(v) }
    appendChild(c) { this.childNodes.push(c); return c }
    get textContent() { return this.childNodes.map(c => c.textContent).join('') }
    cloneNode(deep) { const c = new ME(this.tagName); c.attributes = Object.assign({}, this.attributes); if (deep) this.childNodes.forEach(ch => c.appendChild(ch.cloneNode(true))); return c }
    querySelectorAll(sel) { const tags = sel.split(',').map(s => s.trim().toUpperCase()); const out = []; (function walk(n) { n.childNodes.forEach(c => { if (c.nodeType === 1) { if (tags.indexOf(c.tagName) >= 0) out.push(c); walk(c) } }) })(this); return out }
    set href(v) { this.attributes.href = String(v) } set src(v) { this.attributes.src = String(v) }
  }
  const VOID = { IMG: 1, HR: 1, BR: 1 }
  function parseHtml(html) {
    const root = new ME('div'); const stack = [root]
    const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=\/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g
    let m
    while ((m = re.exec(html))) {
      if (m[5] !== undefined) { stack[stack.length - 1].appendChild(new MT(decodeEnt(m[5]))); continue }
      const tag = m[2].toUpperCase()
      if (m[1] === '/') { for (let i = stack.length - 1; i > 0; i--) { if (stack[i].tagName === tag) { stack.length = i; break } } continue }
      const el = new ME(tag)
      const attrRe = /([^\s=\/>]+)\s*=\s*"([^"]*)"/g
      let a
      while ((a = attrRe.exec(m[3] || ''))) el.setAttribute(a[1], decodeEnt(a[2]))
      stack[stack.length - 1].appendChild(el)
      if (!VOID[tag] && m[4] !== '/') stack.push(el)
    }
    return root
  }
  const miniDoc = { createElement: (x) => new ME(x), createTextNode: (v) => new MT(v) }
  const K = new Function('document', kernelBlock + '\nreturn { esc: esc, renderMarkdown: renderMarkdown, serializeRich: serializeRich, serializeInline: serializeInline, escapeMd: escapeMd, normMd: normMd, analyzeMarkdown: analyzeMarkdown, DEG_RULES: DEG_RULES, parseSecretSpans: parseSecretSpans }')(miniDoc)
  const secretIslands = (html) => parseHtml(html).querySelectorAll('PRE').filter(p => p.getAttribute('data-lang') === 'secret')

  // ===== 129.1 parseSecretSpans 行为级（扫描纪律 + 偏移口径 + 与渲染器一致性）=====
  await t('parseSecretSpans 行为级：顶格识别/闭合/EOF 兜底/缩进不算/多块/嵌套退化/普通围栏内不另开（偏移 slice = 完整 fence 源）', () => {
    // 顶格 + 闭合：slice(start,end) = 完整 fence 源（含开闭栏行，不含行终结符）
    const b1 = '前文\n\n```secret\nA\nB\n```\n后文'
    const s1 = K.parseSecretSpans(b1)
    assert(s1.length === 1 && b1.slice(s1[0].start, s1[0].end) === '```secret\nA\nB\n```', '顶格 fence 完整区间（实得 ' + JSON.stringify(s1) + '）')
    // 多块
    const b2 = '一\n\n```secret\nS1\n```\n\n中\n\n```secret\nS2\n```\n\n尾'
    const s2 = K.parseSecretSpans(b2)
    assert(s2.length === 2 && b2.slice(s2[0].start, s2[0].end) === '```secret\nS1\n```' && b2.slice(s2[1].start, s2[1].end) === '```secret\nS2\n```', '多块各自完整区间')
    // EOF 兜底：无闭合行 → span 至文末
    const b3 = '```secret\n未闭合\n内容'
    const s3 = K.parseSecretSpans(b3)
    assert(s3.length === 1 && s3[0].end === b3.length && b3.slice(s3[0].start, s3[0].end) === b3, 'EOF 兜底至文末')
    // 缩进不算（按普通正文/代码块解析——渲染面无模糊）
    assert(K.parseSecretSpans('  ```secret\n  x\n  ```').length === 0, '缩进 fence 不算 span')
    // 普通围栏内的列 0 ```secret 行只是闭合行（不另开 span）
    assert(K.parseSecretSpans('```\n```secret\nx\n```').length === 0, '普通围栏内 ```secret 不另开（渲染器同纪律）')
    // 嵌套退化：首个顶格 ```secret 之后的 ```secret 行是闭合行
    const b4 = '```secret\n```secret\nZ\n```'
    const s4 = K.parseSecretSpans(b4)
    assert(s4.length === 1 && b4.slice(s4[0].start, s4[0].end) === '```secret\n```secret', '嵌套退化只取首层（内层为闭合行）')
    // 空内容 / 仅开栏行
    assert(K.parseSecretSpans('```secret\n```').length === 1, '空内容闭合 span 在案')
    assert(K.parseSecretSpans('```secret').length === 1, '仅开栏行 = EOF 兜底空内容 span')
    // CRLF：行尾 \r 不影响顶栏/闭合识别（偏移仍为原始串口径）
    const b5 = 'a\r\n```secret\r\nX\r\n```\r\nb'
    const s5 = K.parseSecretSpans(b5)
    assert(s5.length === 1 && b5.slice(s5[0].start, s5[0].end) === '```secret\r\nX\r\n```', 'CRLF 兼容（\r 归入行内容不破识别）')
    // 无机密 = 空
    assert(K.parseSecretSpans('# 普通正文\n\n```js\ncode\n```\n').length === 0, '无机密返回空数组')
    // 语言位精确：```secrets / ``` secret2 不算（lang 提取后必须恰为 secret——与渲染器同口径）
    assert(K.parseSecretSpans('```secrets\nx\n```').length === 0 && K.parseSecretSpans('``` secret \nx\n```').length === 1, '语言位口径（trim 后恰为 secret；secrets 不算）')
  })
  await t('parseSecretSpans ⇄ renderMarkdown 一致性：span 数 = 渲染机密岛数 + 单 span 用例 data-md-src === body.slice(start,end)（镜像不变量）', () => {
    for (const md of [
      '前文\n\n```secret\nA\nB\n```\n后文',
      '一\n\n```secret\nS1\n```\n\n中\n\n```secret\nS2\n```\n\n尾',
      '```secret\n未闭合\n内容',
      '```secret\n```secret\nZ\n```',
      '```secret\n```',
      '```js\ncode\n```\n\n```secret\n邻接\n```',
    ]) {
      const html = K.renderMarkdown(md)
      assert(secretIslands(html).length === K.parseSecretSpans(md).length, 'span 数 = 机密岛数 @' + JSON.stringify(md.slice(0, 24)))
      const spans = K.parseSecretSpans(md)
      if (spans.length === 1) {
        const island = secretIslands(html)[0]
        assert.strictEqual(island.getAttribute('data-md-src'), md.slice(spans[0].start, spans[0].end), 'data-md-src = 偏移区间源 @' + JSON.stringify(md.slice(0, 24)))
      }
    }
  })

  // ===== 129.2 往返恒等（byte-identity）=====
  const rt = (md) => K.serializeRich(parseHtml(K.renderMarkdown(md)))
  await t('secret 往返恒等：特殊字符/[[..]]/URL/星号/HTML 形文本/多块/EOL(EOF)兜底/普通 fence 混排 serialize(render(body)) 逐字节一致（fence 字面量原则）', () => {
    const F_SPEC = '开头段\n\n```secret\nTOKEN = 2*3 与 [[双链目标]] 与 https://example.com/x?a=1&b=2 与 *星号* 与 <tag attr="x"> 与 a\\|b\n```\n\n结尾段'
    const F_MULTI = '第一段\n\n```secret\nS1 内容\n```\n\n中间段\n\n```secret\nS2 内容\n```\n\n收尾段'
    const F_EOF = '```secret\n未闭合机密\n第二行'
    const F_EMPTY = '```secret\n```'
    const F_MIX = '```js\nvar x = 1\n```\n\n```secret\n邻接机密\n```'
    for (const [name, md] of [['特殊字符+双链+URL+星号+HTML 形文本', F_SPEC], ['多块', F_MULTI], ['EOL(EOF) 兜底', F_EOF], ['空内容', F_EMPTY], ['普通 fence 混排', F_MIX]]) {
      assert.strictEqual(rt(md), md, '往返逐字节一致 @' + name + '\n--- 序列化 ---\n' + rt(md))
    }
    // fence 字面量：内容不解析不归一化——渲染产物零 <a>/<strong> 侵入（[[..]] 不成锚、** 不成粗体）
    const h = K.renderMarkdown(F_SPEC)
    assert(h.indexOf('<strong>') < 0 && h.indexOf('<a ') < 0 && h.indexOf('data-wiki') < 0, '机密内容零行内解析（字面量原则）')
  })

  // ===== 129.3 blur markup 静态锚 + 静态占位 =====
  await t('secret blur markup 静态锚：交互岛 esc 先行 + contenteditable=false + data-md-src + code 子；静态占位正文不进 DOM + 标签调用侧注入（内核零硬编码文案）', () => {
    const F = '```secret\nTOKEN = 2*3 <tag attr="x">\n```'
    const hLive = K.renderMarkdown(F)
    assert(hLive.indexOf('<pre class="dsh-notes-secret"') >= 0 && hLive.indexOf('data-lang="secret"') >= 0, '机密岛容器类与语言位')
    assert(hLive.indexOf('contenteditable="false"') >= 0, '原子岛屿（contenteditable=false，同表格先例）')
    assert(hLive.indexOf('data-md-src="```secret') >= 0, 'data-md-src 逐字源在案')
    assert(hLive.indexOf('<code>TOKEN = 2*3 &lt;tag attr=&quot;x&quot;&gt;</code>') >= 0, '内容 esc 先行（<tag> 转义字面量，零注入面）')
    assert(hLive.indexOf('secret-lock') >= 0, '🔒 角标在案')
    // 静态占位：正文不进 DOM 文本节点 + 标签注入 + 缺省零文案（内核不硬编码中文）
    //（data-md-src 按往返保真纪律保留——序列化面无 garbage 通道；占位保守面 = 渲染产物零 code 文本节点、内容不出现在可见文本层）
    const hStatic = K.renderMarkdown(F, null, { secretStatic: true, secretLabel: '机密区占位文案' })
    assert(hStatic.indexOf('dsh-secret-static') >= 0 && hStatic.indexOf('secret-ph') >= 0 && hStatic.indexOf('机密区占位文案') >= 0, '静态占位 + 调用侧注入标签')
    const domStatic = parseHtml(hStatic)
    assert(domStatic.querySelectorAll('CODE').length === 0 && domStatic.textContent.indexOf('TOKEN') < 0, '静态占位零 code 文本节点、内容不在可见文本层（保守面）')
    assert(K.serializeRich(domStatic) === F, '静态占位序列化恒等（data-md-src 统一回吐——保守面不破往返）')
    const hNoLabel = K.renderMarkdown(F, null, { secretStatic: true })
    assert(!/[\u4e00-\u9fff]/.test(hNoLabel), '无标签时零硬编码中文（i18n 键纪律——文案只在调用侧）')
  })

  // ===== 129.4 DEG 红线 =====
  await t('DEG 红线：secret fence 永不触发降级（fence 内容豁免照旧）+ 围栏外规则照常检出 + DEG_RULES 表无 secret 检出项', () => {
    assert(K.analyzeMarkdown('```secret\n> > 嵌套引用\n#### h4\n- [ ] 任务\n<div>\n<span>x</span>\n</div>\n```').ok === true, '机密 fence 内容不参与降级判定')
    assert(K.analyzeMarkdown('正文\n\n```secret\nS\n```\n\n> > 外部嵌套引用').ok === false, '围栏外降级规则照常检出（不因机密块豁免）')
    assert(K.DEG_RULES.every(r => r.key !== 'secret'), 'DEG_RULES 无 secret 检出项（永不触发降级红线）')
  })

  // ===== 129.5 三入口 + 揭示/取消机密/染色镜像/dirty 保护 静态锚 =====
  await t('三入口静态锚：工具栏🛡（有选区才亮）+ 右键菜单（0.4.8 ctxmenu 基建）+ Ctrl+Shift+S（有选区才亮）；揭示计时器单飞（重击重置）', () => {
    // 入口①：工具栏
    assert(appEd.indexOf("data-a=\"secret\" title=\"' + t('editor.tbSecret')") >= 0, '工具栏 🛡 钮（title 走 i18n 键）')
    assert(appEd.indexOf("else if (a === 'secret') { markSelectionSecret(); return; }") >= 0, 'toolbarAction secret 分支')
    assert(appEd.indexOf("if (a === 'secret') {") >= 0 && appEd.indexOf("sn.closest && sn.closest('#edRich')") >= 0, 'updateToolbarState 有选区才亮（选区落 #edRich 内）')
    // 入口②：右键菜单（#ctxHost + .ctxmenu/.mi + closeCtx——0.4.8 笔记右键菜单基建复用）
    assert(appEd.indexOf('function openSecretCtxMenu(x, y, snap)') >= 0 && appEd.indexOf("'<div class=\"ctxmenu\" id=\"ctxMenu\"><div class=\"mi\" data-a=\"secret\">") >= 0, '右键菜单体（ctxmenu 基建）')
    assert(appEd.indexOf("ta.addEventListener('contextmenu'") >= 0 && appEd.indexOf('rich.addEventListener(\'contextmenu\'') >= 0, '源码/富文本双面 contextmenu 挂点')
    assert(appEd.indexOf('this.selectionStart === this.selectionEnd) return') >= 0, '无选区不拦截原生菜单（有选区才亮口径）')
    // 入口③：Ctrl+Shift+S
    assert(appKb.indexOf("ev.shiftKey && !ev.altKey && (ev.key === 'S' || ev.key === 's')") >= 0 && appKb.indexOf('markSelectionSecret(); return }') >= 0, 'Ctrl+Shift+S 分支在案（before inField 早退——输入域内可达）')
    // 揭示/回糊/取消机密
    assert(appEd.indexOf('var SECRET_REVEAL_MS = 10000;') >= 0, '揭示驻留 ~10s 常量')
    assert(appEd.indexOf('function armSecretReveal()') >= 0 && appEd.indexOf('clearTimeout(secretRevealTimer);') >= 0 && appEd.indexOf('secretRevealTimer = setTimeout') >= 0, '揭示计时器单飞（模块级唯一句柄）')
    assert(appEd.indexOf("if (pre.classList.contains('revealed')) armSecretReveal()") >= 0, '重击重置计时')
    assert(appEd.indexOf("p2 !== pre) p2.classList.remove('revealed')") >= 0, '跨块揭示先回糊（单飞）')
    assert(appEd.indexOf('function unmarkSecretBlock(pre)') >= 0 && appEd.indexOf('function secretSpanInner(body, sp)') >= 0, '取消机密执行体（剥 fence 行回明文）')
    // 选区快照（菜单点击时 textarea/富文本选区已被点击吞掉——快照口径）
    assert(appEd.indexOf('function snapshotSecretSel()') >= 0 && appEd.indexOf('range: sel.getRangeAt(0).cloneRange()') >= 0, '选区快照（contextmenu 时刻入闭包）')
  })
  await t('模式切换 dirty 保护 + 源码行染色镜像静态锚：切换收编揭示计时器/取消机密先收编在途编辑（0.4.9 同款纪律）+ src-mirror 滚动/resize 跟随 + 样式双端', () => {
    assert(appEd.indexOf('<div class="src-wrap" id="srcWrap"') >= 0, 'src-wrap 携 id（驳回修复：v1 漏 id 致 renderModeUI $(\u0027srcWrap\u0027) 恒 null——富文本态重渲染后切回源码 wrapper 恒 display:none，编辑区空白）')
    assert(appEd.indexOf("$('srcWrap').style.display = edMode === 'source' ? 'flex' : 'none'") >= 0, 'renderModeUI 随模式切 srcWrap 整体显隐（与 richScroll 同款开关）')
    assert(appEd.indexOf("clearTimeout(secretRevealTimer); secretRevealTimer = null;   /* 文档安全 S1：揭示计时器随切换收编") >= 0, 'switchMode 收编揭示计时器（不留跨模式悬挂揭示）')
    assert(appEd.indexOf("if (edMode === 'rich' && richDirty) syncFromRich('取消机密');") >= 0, '取消机密先收编富文本在途编辑（dirty 保护——揭示态下别处编辑不被重建吃掉）')
    assert(appEd.indexOf('refreshSecretBlockText(sb)') >= 0, 'renderEdLang 机密岛 chrome 文案随语言翻转（零正文重建）')
    assert(appEd.indexOf('function refreshSecretMirror()') >= 0 && appEd.indexOf("mi.style.right = sb > 0 ? sb + 'px' : ''") >= 0, '源码染色镜像 + 滚动条补偿')
    assert(appEd.indexOf("ta.addEventListener('scroll'") >= 0 && appEd.indexOf("mi.scrollTop = this.scrollTop") >= 0, '镜像滚动同步')
    assert(appEd.indexOf("window.addEventListener('resize', function () { refreshSecretMirror() })") >= 0, 'resize 换行点漂移重建')
    // 样式：app head.html（源码镜像色带 + 富文本 blur/揭示/取消机密/静态占位）+ 客户端 styles.css
    assert(appHead.indexOf('.src-mirror{position:absolute;inset:0;') >= 0 && appHead.indexOf('.src-mirror .src-secret{') >= 0, 'head.html 源码镜像样式（同字体/行距/换行策略 + 色带）')
    assert(appHead.indexOf('.rich pre.dsh-notes-secret > code{filter:blur(5px)') >= 0 && appHead.indexOf('.rich pre.dsh-notes-secret.revealed > code{filter:none') >= 0, 'head.html 富文本 blur/揭示回糊（纯 CSS）')
    assert(appHead.indexOf('.rich pre.dsh-notes-secret.revealed .secret-unmark{display:inline-block}') >= 0 && appHead.indexOf('.dsh-secret-static') >= 0, 'head.html 取消机密钮揭示态浮现 + 静态占位样式')
    assert(stylesCss.indexOf('.dsh-notes-rich pre.dsh-notes-secret > code{filter:blur(5px)}') >= 0 && stylesCss.indexOf('.dsh-notes-rich pre.dsh-notes-secret .secret-ph{') >= 0, 'styles.css 面板端机密岛样式（blur + 占位）')
  })

  // ===== 129.6 预览静态占位四端 + i18n 双语键 =====
  await t('只读预览四端静态占位 + i18n 双语键就地落（锁 tooltip/取消机密/降级占位/右键项等 8 键）', () => {
    assert(appHist.indexOf("renderMarkdown(histState.preview.body || '', wikiResolve, { secretStatic: true, secretLabel: t('editor.secretPlaceholder') })") >= 0, 'app 历史预览静态占位')
    assert(appTrash.indexOf("renderMarkdown(pv.body, wikiResolve, { secretStatic: true, secretLabel: t('editor.secretPlaceholder') })") >= 0, 'app 回收站预览静态占位')
    assert(cliHist.indexOf("renderMarkdown(histPreview.body, wikiResolve, { secretStatic: true, secretLabel: tt('editor.secretPlaceholder') })") >= 0, 'client 历史预览静态占位')
    assert(cliTrash.indexOf("renderMarkdown(trashPreview.body, wikiResolve, { secretStatic: true, secretLabel: tt('editor.secretPlaceholder') })") >= 0, 'client 回收站预览静态占位')
    const KEYS = ['editor.tbSecret', 'editor.ctxSecret', 'editor.secretNeedSelection', 'editor.secretRevealTip', 'editor.secretUnmark', 'editor.secretUnmarkFailed', 'editor.secretPlaceholder', 'editor.secretMarked']
    for (const k of KEYS) assert(typeof zhDict[k] === 'string' && zhDict[k] && typeof enDict[k] === 'string' && enDict[k], k + ' 双字典齐备且非空')
    assert(zhDict['editor.secretPlaceholder'] === '机密区（源码模式查看）', '降级占位文案口径（zh）')
    assert(enDict['editor.secretPlaceholder'] === 'Secret area (view in source mode)', '降级占位文案口径（en）')
  })

  // ===== 129.7 e2e 用例在案锚 =====
  await t('e2e 用例 62 在案：敲 fence → 模糊块 → 揭示 → 回糊 → 取消机密 → 明文 全链（含 Ctrl+Shift+S 入口 + 模式切换可见性回归锁）', () => {
    assert(e2eCase.indexOf('62-secret-span') >= 0 && e2eCase.indexOf('dsh-notes-secret') >= 0 && e2eCase.indexOf('secret-unmark') >= 0, '用例 62 覆盖机密岛选择器')
    assert(e2eCase.indexOf('revealed') >= 0 && e2eCase.indexOf('Control+Shift+s') >= 0, '用例 62 覆盖揭示态与 Ctrl+Shift+S 入口')
    assert(e2eCase.indexOf("waitForSelector('#srcWrap', { state: 'visible'") >= 0 && e2eCase.indexOf("waitForSelector('#edSrc', { state: 'visible'") >= 0, '用例 62 覆盖富文本态换笔记→切回源码可见性回归锁（Playwright-visible 实测 + page.click actionability，非 evaluate 读值——v1 漏 id 漏检面封堵）')
  })
  }
}
