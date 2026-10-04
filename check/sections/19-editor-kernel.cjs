// 节 19. 双模式编辑器 v3 内核（往返保真 + XSS + 降级）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "19",
  title: "19. 双模式编辑器 v3 内核（往返保真 + XSS + 降级）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { g, m2, t2 } = S
  // ===== 19. 双模式编辑器 v3 内核（renderMarkdown⇄serializeRich 往返保真 + XSS + 降级分析；规格 design/notes-editor-v3.html）=====
  // （v3 起替代原「预览/编辑双态」：预览容器改为可编辑富文本 contenteditable；序列化器是其逆函数，本节用 Node MiniDOM 跑真内核锁定往返）
  section('19. 双模式编辑器 v3 内核（往返保真 + XSS + 降级）')
  // 从开发版 client-impl.js 提取「双模式编辑器内核 v3」标记区间（app.html / 发布包 lib/client.js 同块，字节一致断言在 25 节）
  const KERNEL_MARKER_START = '// ===== 双模式编辑器内核 v3'
  const KERNEL_MARKER_END = '// ===== end 双模式编辑器内核 v3 ====='
  function grabKernelBlock(src, label) {
    const ps = src.indexOf(KERNEL_MARKER_START), pe = src.indexOf(KERNEL_MARKER_END)
    assert(ps >= 0 && pe > ps, label + ' 含双模式内核标记区间')
    return src.slice(src.lastIndexOf('\n', ps) + 1, pe + KERNEL_MARKER_END.length)
  }
  const kernelBlock = grabKernelBlock(clientSrc, 'client-impl.js')
  // Node 侧 MiniDOM：serializeRich/sanitizeFragment 依赖的 DOM 子集（childNodes/nodeType/tagName/nodeValue/textContent/getAttribute/setAttribute/cloneNode/appendChild/querySelectorAll）
  // + 白名单 HTML 解析器（只解析 renderMarkdown 的机器产出：h1-3/p/ul/ol/li/blockquote/pre/code/hr/img/a/strong/em + 转义实体；img/hr/br void）
  function v3DecodeEnt(s) { return String(s).replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => k === 'amp' ? '&' : k === 'lt' ? '<' : k === 'gt' ? '>' : k === 'quot' ? '"' : "'") }
  class V3Text {
    constructor(v) { this.nodeType = 3; this.nodeValue = v; this.childNodes = [] }
    get textContent() { return this.nodeValue }
    cloneNode() { return new V3Text(this.nodeValue) }
  }
  class V3El {
    constructor(tag) { this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.attributes = {}; this.childNodes = [] }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null }
    setAttribute(k, v) { this.attributes[k] = String(v) }
    appendChild(c) { this.childNodes.push(c); return c }
    get textContent() { return this.childNodes.map(c => c.textContent).join('') }
    cloneNode(deep) { const c = new V3El(this.tagName); c.attributes = Object.assign({}, this.attributes); if (deep) this.childNodes.forEach(ch => c.appendChild(ch.cloneNode(true))); return c }
    querySelectorAll(sel) { const tags = sel.split(',').map(s => s.trim().toUpperCase()); const out = []; (function walk(n) { n.childNodes.forEach(c => { if (c.nodeType === 1) { if (tags.indexOf(c.tagName) >= 0) out.push(c); walk(c) } }) })(this); return out }
    set href(v) { this.attributes.href = String(v) }   // sanitizeFragment 的 A 分支 a.href=href（DOM 属性≈attribute 桥）
    set src(v) { this.attributes.src = String(v) }     // sanitizeFragment 的 IMG 分支 im.src=...
  }
  const V3_VOID = { IMG: 1, HR: 1, BR: 1 }
  function v3ParseHtml(html) {
    const root = new V3El('div'); const stack = [root]
    const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=\/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g
    let m
    while ((m = re.exec(html))) {
      if (m[5] !== undefined) { stack[stack.length - 1].appendChild(new V3Text(v3DecodeEnt(m[5]))); continue }
      const tag = m[2].toUpperCase()
      if (m[1] === '/') { for (let i = stack.length - 1; i > 0; i--) { if (stack[i].tagName === tag) { stack.length = i; break } } continue }
      const el = new V3El(tag)
      const attrRe = /([^\s=\/>]+)\s*=\s*"([^"]*)"/g
      let a
      while ((a = attrRe.exec(m[3] || ''))) el.setAttribute(a[1], v3DecodeEnt(a[2]))
      stack[stack.length - 1].appendChild(el)
      if (!V3_VOID[tag] && m[4] !== '/') stack.push(el)
    }
    return root
  }
  const v3MiniDocument = { createElement: t2 => new V3El(t2), createTextNode: v => new V3Text(v) }
  let kernelFn = null
  await t('内核函数可提取（esc/renderMarkdown/serializeRich/analyzeMarkdown/sanitizeFragment）', () => {
    kernelFn = new Function('document', kernelBlock + '\nreturn { esc: esc, assetDisplaySrc: assetDisplaySrc, renderMarkdown: renderMarkdown, serializeRich: serializeRich, serializeInline: serializeInline, escapeMd: escapeMd, normMd: normMd, analyzeMarkdown: analyzeMarkdown, DEG_RULES: DEG_RULES, HTML_BLOCK_LINE: HTML_BLOCK_LINE, sanitizeFragment: sanitizeFragment, WIKI_RE: WIKI_RE, extractWikiTargets: extractWikiTargets, wikiLinksTo: wikiLinksTo, unesc: unesc }')(v3MiniDocument)
    for (const fn of ['esc', 'renderMarkdown', 'serializeRich', 'analyzeMarkdown', 'sanitizeFragment', 'assetDisplaySrc', 'extractWikiTargets', 'wikiLinksTo', 'unesc']) assert(typeof kernelFn[fn] === 'function', fn + ' 可调用')
  })
  // 往返自检（与原型 roundtripCheck 同一不变量）：① 显示保真 render∘serialize∘render 逐字节一致 ② 定点稳定（md2===md3）
  function v3Roundtrip(md) {
    const h1 = kernelFn.renderMarkdown(md)
    const md2 = kernelFn.serializeRich(v3ParseHtml(h1))
    const h2 = kernelFn.renderMarkdown(md2)
    const md3 = kernelFn.serializeRich(v3ParseHtml(h2))
    return { same: h1 === h2 && md2 === md3, md2: md2, md3: md3, h1: h1, h2: h2 }
  }
  await t('往返保真：白名单 Markdown render→serialize→render 不变（10 用例，含原型自测 7 条 + 场景 A/C 正文）', () => {
    assert(kernelFn, 'kernelFn 可用')
    // 原型 design/notes-editor-v3.html runSelfTest 同款 7 用例 + 图片 alt 尖括号 + 场景 A/C 整文
    const SCEN_A = '# DSH 插件发布清单\n\n发布前按顺序走完 **四个阶段**，任何一步 *失败* 都不要继续往下走。\n\n## 1. 版本对齐\n\n- 根 package.json 与包内 version 一致\n- README 表格同步到 *最新行*\n- 运行 `node scripts/sync-pkg-readme.cjs` 更新 npm 页面文档\n\n## 2. 验证\n\n1. npm pack 干跑检查 files 白名单\n2. 实测基线版本加载通过\n3. CI publish.yml 绿灯\n\n> 可用性是底线：上下文切换后的在途响应覆盖、渲染 bailout、时区偏移都要回归。\n\n### 3. 参考命令\n\n```bash\nnpm pack --dry-run\nnode scripts/sync-pkg-readme.cjs\n```\n\n发布记录见 [插件仓库](https://example.com/dsh-notes)，配图：\n\n![发布流程示意](assets/release-flow.svg)\n\n## 4. 发布记录\n\n| 版本 | 日期 | 状态 |\n| --- | :---: | ---: |\n| 0.1.6 | 2026-09-15 | 已发布 |\n| 0.1.7 | 2026-09-28 | 当前 |\n\n---\n\n*完成于 2026-09-30 · 下次发版前复核*'
    const SCEN_C = '# 面板截图归档\n\nv2 面板三视图，**选中态**配色已按实机 token 校准：\n\n![面板-列表态](assets/panel-list.png)\n\n![面板-编辑态](assets/panel-edit.png)\n\n> 后续截图统一走 `assets/` 目录，命名 panel-*.png。\n\n用工具栏「图片」按钮、Ctrl+V 粘贴或拖拽文件到富文本区即可插入新图。'
    const cases = [
      ['标题/粗体/斜体/行内码', '# 标题 A\n\n带 **粗体** 和 *斜体* 还有 `code` 的段落。'],
      ['无序+有序列表', '- 甲\n- 乙\n\n1. 一\n2. 二'],
      ['引用/代码块/分隔线', '> 引用一行\n\n```js\nconst a = 1\nconsole.log(a)\n```\n\n---\n\n收尾'],
      ['链接', '见 [插件仓库](https://example.com/dsh) 说明。'],
      ['图片（资产路径还原）', '![发布流程](assets/release-flow.svg)\n\n文字 ![内联图](assets/panel-list.png) 混排。'],
      ['特殊字符转义往返', '计算 2*3 和 a[b] 以及 `x\\`y` 与 C:\\path 不走格式。'],
      ['h2/h3', '## 二级\n\n### 三级'],
      ['图片 alt 含尖括号', '![a<b>c](assets/x.png)'],
      ['场景A 正文', SCEN_A],
      ['场景C 正文', SCEN_C],
    ]
    for (const [name, md] of cases) {
      const rt = v3Roundtrip(md)
      assert(rt.same, '往返差异 @' + name + '\n--- 序列化 ---\n' + rt.md2 + '\n--- 二轮 ---\n' + rt.md3 + (rt.h1 !== rt.h2 ? '\n--- h1 ---\n' + rt.h1 + '\n--- h2 ---\n' + rt.h2 : ''))
    }
  })
  await t('L1 行内 HTML：转义字面量渲染（无 XSS）+ 序列化逐字还原 + 不再降级（真实样本锁死）', () => {
    assert(kernelFn, 'kernelFn 可用')
    // 首条 = 实战样本 n-muc4p3jdydlc 第 69 行原文（行内代码含 <input type="date">，旧门禁下整篇降级锁源码）
    const cases = [
      '**根因**：混用 UTC 表示和本地日期——`iso.slice(0,10)` 切出来是 UTC 日期，`toISOString()` 也是 UTC，而 `<input type="date">` 给的是本地日期。',
      '使用 <input type="date"> 与 <div class="x"> 标签。',
      '属性双引号与 &：<input type="text" value="a&b"> 原样呈现。',
      "属性单引号 <input type='text'> 与收尾 </div>。",
      '# 标题里的 <span> 标签',
      '- 列表项里的 <input> 标签',
      '> 引用里的 <br> 标签',
      '<div>独占一行的裸标签</div>',
      'a < b 且 c > d（比较运算不是标签）'
    ]
    for (const md of cases) {
      const h1 = kernelFn.renderMarkdown(md)
      // 字面量渲染：产物中用户输入的 < 全部转为 &lt; 实体，无可解析裸标签（XSS 面为零）
      assert(!/<(input|div|span|br)\b/.test(h1.replace(/&lt;/g, '')), '渲染产物不含裸 HTML 标签 @' + md.slice(0, 24))
      assert(h1.indexOf('&lt;') >= 0, '渲染产物为转义字面量 @' + md.slice(0, 24))
      // 逐字往返：源码 → 渲染 → 序列化 === 源码（escapeMd 不动 <>，文本节点逐字还原）
      const md2 = kernelFn.serializeRich(v3ParseHtml(h1))
      assert.strictEqual(md2, md, '逐字往返一致 @' + md.slice(0, 24) + '\n--- 序列化 ---\n' + md2)
      // 显示保真 + 定点稳定
      const h2 = kernelFn.renderMarkdown(md2)
      assert.strictEqual(h2, h1, '二轮渲染逐字节一致 @' + md.slice(0, 24))
      assert.strictEqual(kernelFn.serializeRich(v3ParseHtml(h2)), md2, '序列化定点稳定 @' + md.slice(0, 24))
      // 不再降级
      assert(kernelFn.analyzeMarkdown(md).ok, '行内 HTML 不再触发降级 @' + md.slice(0, 24))
    }
  })
  await t('L2 GFM 表格：只读渲染（th/td/对齐/contenteditable=false）+ 序列化逐字回吐 + 混合内容/异形/转义管道/XSS + 不再降级', () => {
    assert(kernelFn, 'kernelFn 可用')
    // ① 渲染断言：table.dsh-notes-table 只读岛屿 + th/td + 三向对齐样式 + data-md-src 记原始源码
    const TBL = '| 机器 | IP | 状态 |\n| :--- | :---: | ---: |\n| **主**节点 | 10.102.90.138 | 在线 |\n| a\\|b 转义管 | x | y |'
    const h1 = kernelFn.renderMarkdown(TBL)
    assert(h1.indexOf('<table class="dsh-notes-table" contenteditable="false" data-md-src="') >= 0, '只读表格容器（contenteditable=false + data-md-src 记源码）')
    assert(h1.indexOf('<th style="text-align:left">机器</th>') >= 0 && h1.indexOf('<th style="text-align:center">IP</th>') >= 0 && h1.indexOf('<th style="text-align:right">状态</th>') >= 0, '表头三向对齐样式（:---/ :---: /---:）')
    assert(h1.indexOf('<td style="text-align:left"><strong>主</strong>节点</td>') >= 0, '单元格行内渲染（粗体进单元格）')
    assert(h1.indexOf('a|b 转义管') >= 0 && (h1.match(/<td/g) || []).length === 6, '\\| 转义管道不切列（2 行 × 3 列 = 6 个 td）、显示还原为 |')
    // ② round-trip 逐字一致（硬约束）：序列化 = data-md-src 逐字回吐（含对齐分隔行）
    const md2 = kernelFn.serializeRich(v3ParseHtml(h1))
    assert.strictEqual(md2, TBL, '表格源码逐字回吐（含对齐分隔行）\n--- 序列化 ---\n' + md2)
    // 显示保真 + 定点稳定
    const h2 = kernelFn.renderMarkdown(md2)
    assert.strictEqual(h2, h1, '二轮渲染逐字节一致')
    assert.strictEqual(kernelFn.serializeRich(v3ParseHtml(h2)), md2, '序列化定点稳定')
    // ③ 混合内容：表格嵌在标题/段落/列表之间，整篇逐字一致
    const MIX = '# 发布记录\n\n开头段落 **粗**。\n\n| 版本 | 日期 |\n| --- | --- |\n| 0.1.6 | 2026-09-15 |\n| 0.1.7 | 2026-09-28 |\n\n- 收尾项\n\n> 引用收尾'
    const m2 = kernelFn.serializeRich(v3ParseHtml(kernelFn.renderMarkdown(MIX)))
    assert.strictEqual(m2, MIX, '表格+周边混合内容逐字一致\n--- 序列化 ---\n' + m2)
    // ④ 不再降级（黑名单已移除「表格」）
    assert(kernelFn.analyzeMarkdown(TBL).ok && kernelFn.analyzeMarkdown(MIX).ok, '表格不再触发降级')
    // ⑤ 异形表格（无外框管道、表头/分隔行格数不齐、表体多格）同样只读渲染且源码逐字（补齐/截尾仅影响显示）
    const WEIRD = 'a | b | c\n- | -\n1 | 2 | 3 | 4'
    assert.strictEqual(kernelFn.serializeRich(v3ParseHtml(kernelFn.renderMarkdown(WEIRD))), WEIRD, '异形表格逐字回吐')
    assert(kernelFn.analyzeMarkdown(WEIRD).ok, '异形表格不降级')
    // ⑥ XSS：单元格内容与源码记录全量转义，恶意内容也逐字回吐
    const EVIL = '| a |\n| --- |\n| <img onerror=alert(1)> |'
    const eh = kernelFn.renderMarkdown(EVIL)
    assert(eh.indexOf('<img onerror') < 0 && eh.indexOf('&lt;img') >= 0, '单元格恶意 HTML 转义为字面量')
    assert(v3ParseHtml(eh).querySelectorAll('img').length === 0, '渲染产物零 img 节点（data-md-src 只是字符串属性）')
    assert.strictEqual(kernelFn.serializeRich(v3ParseHtml(eh)), EVIL, '恶意内容表格逐字回吐')
  })
  await t('降级分析：白名单外结构检出（嵌套引用/h4/任务列表/多行 HTML 块）+ L2 表格放行 + 行内 HTML 放行 + 围栏代码块豁免', () => {
    assert(kernelFn, 'kernelFn 可用')
    // 原型场景 B 同款：正文仍含 GFM 表格（L2 起只读渲染、不再降级），降级检出 4 类（不含表格）
    const dB = kernelFn.analyzeMarkdown('# o2oa 环境机器清单\n\n| 机器 | IP |\n| --- | --- |\n\n> a\n> > b\n\n#### 附\n\n- [ ] x\n- [x] y\n\n<div class="legacy">\n<span>旧系统拷贝的标记</span>\n</div>')
    assert(!dB.ok && dB.reasons.length === 4, '场景B 检出 4 类（表格不再计入；实得 ' + JSON.stringify(dB.reasons) + '）')
    assert(dB.reasons.map(r => r.label).join(',') === '嵌套引用,四级及以下标题,任务列表,多行 HTML 块', '检出标签与顺序')
    // L2：表格放行（只读渲染 + 序列化逐字回吐，行为级断言见 L2 专项用例）
    assert(kernelFn.analyzeMarkdown('| 机器 | IP |\n| --- | --- |\n| A | 10.0.0.1 |').ok, 'GFM 表格不再降级（L2）')
    // L1：行内/单行 HTML 放行（从黑名单移除「行内 HTML」）
    assert(kernelFn.analyzeMarkdown('# t\n\n<div>html</div>').ok, '单行裸标签独占一行放行')
    assert(kernelFn.analyzeMarkdown('而 `<input type="date">` 给的是本地日期。').ok, '行内代码含 HTML 放行（实战样本）')
    assert(kernelFn.analyzeMarkdown('<div>a</div>\n\n<div>b</div>').ok, '空行隔开的单行标签放行')
    // 多行 HTML 块仍降级：连续 ≥2 行以 <tag>/</tag> 开头（段落合并丢换行、逐字往返不保）
    const dH = kernelFn.analyzeMarkdown('<div class="legacy">\n<span>旧系统拷贝的标记</span>\n</div>')
    assert(!dH.ok && dH.reasons.length === 1 && dH.reasons[0].label === '多行 HTML 块' && dH.reasons[0].line === 1, '多行 HTML 块检出（记段首行号）')
    assert(!kernelFn.analyzeMarkdown('<div>a</div>\n<div>b</div>').ok, '连续两行裸标签构成多行 HTML 块')
    assert(kernelFn.analyzeMarkdown('```html\n<div>\n<span>x</span>\n</div>\n```').ok, '围栏代码块内多行 HTML 豁免')
    assert(kernelFn.analyzeMarkdown('```\n| a | b |\n```\n\n> > 在代码块外才算\n```\n正文').ok === false, '代码块外的嵌套引用仍检出')
    assert(kernelFn.analyzeMarkdown('```\n| a | b |\n> > 嵌套引用\n#### h4\n```').ok, '围栏代码块内容不参与判定（豁免）')
    assert(kernelFn.analyzeMarkdown('# 标题\n\n正常 **段落**').ok, '白名单正文通过')
  })
  await t('XSS 红线：渲染全量转义 + 图片仅 assets/ 前缀放行（javascript:/外链/引号注入全拒绝）', () => {
    assert(kernelFn, 'kernelFn 可用')
    const evil = '<img onerror=alert(1) src=x><script>alert(2)</script>'
    const escaped = kernelFn.esc(evil)
    assert(escaped.indexOf('<img') < 0 && escaped.indexOf('<script') < 0, 'esc 后不含裸 <img / <script')
    assert(escaped.indexOf('&lt;img') >= 0 && escaped.indexOf('&#39;') < 0, 'esc 转义形态')
    assert(kernelFn.renderMarkdown('```\n' + evil + '\n```').indexOf('<script') < 0, '代码块内恶意 HTML 被转义')
    assert(kernelFn.renderMarkdown(evil).indexOf('<img') < 0, '段落内恶意 HTML 被转义')
    // 图片 src 白名单：仅 assets/ 前缀 → 资产路由；javascript:/外链/引号注入均不成 <img>
    assert(kernelFn.renderMarkdown('![x](javascript:alert(1))').indexOf('<img') < 0, 'javascript: 图片拒绝')
    assert(kernelFn.renderMarkdown('![x](https://evil.com/x.png)').indexOf('<img') < 0, '外链图片拒绝（仅 assets/）')
    assert(kernelFn.renderMarkdown('![x](assets/evil.png" onerror="alert(1))').indexOf('<img') < 0, '引号注入不成 img（转义纯文本）')
    const okImg = kernelFn.renderMarkdown('![发布流程](assets/release-flow.svg)')
    assert(okImg.indexOf('<img src="/dsh-notes/asset?file=') >= 0 && okImg.indexOf('data-md-src="assets/release-flow.svg"') >= 0, 'assets 图片放行：src=资产路由 + data-md-src 记原始路径')
    // 正常渲染回归（h1/strong/em/ul）
    const html = kernelFn.renderMarkdown('# Title\n\nSome **bold** and *italic* text.\n\n- item 1\n- item 2\n')
    assert(html.indexOf('<h1') >= 0 && html.indexOf('<strong>bold</strong>') >= 0 && html.indexOf('<em>italic</em>') >= 0 && html.indexOf('<li>item 1</li>') >= 0, '基础渲染回归')
  })
  await t('粘贴清洗 sanitizeFragment：script/style 丢弃 + h4-6 降段落 + table 拆壳 + 非 assets 图片丢弃', () => {
    assert(kernelFn, 'kernelFn 可用')
    const frag = v3ParseHtml('<div><h4>深标题</h4><script>alert(1)</script><table><tr><td>格</td></tr></table><p>正文<strong>粗</strong></p><img src="https://evil.com/x.png"><img data-md-src="assets/ok.png" alt="ok"></div>')
    const clean = kernelFn.sanitizeFragment(frag)
    const tags = []
    ;(function walk(n) { n.childNodes.forEach(c => { if (c.nodeType === 1) { tags.push(c.tagName); walk(c) } }) })(clean)
    assert(tags.indexOf('SCRIPT') < 0 && tags.indexOf('TABLE') < 0, 'script/table 不保留')
    assert(tags.indexOf('P') >= 0 && tags.indexOf('H4') < 0, 'h4 降为 p')
    assert(tags.indexOf('STRONG') >= 0, '粗体保留')
    assert(tags.filter(x => x === 'IMG').length === 1, '仅 assets/ 图片保留（实得 ' + tags.join(',') + '）')
    // 序列化回 Markdown：js 脚本内容不得出现
    const md = kernelFn.serializeRich(clean)
    assert(md.indexOf('alert') < 0 && md.indexOf('assets/ok.png') >= 0, '清洗后序列化无脚本内容、保留资产图')
  })
  await t('内核纯净性：不碰 edBody/自动保存/RPC（纯函数集合，副作用全在调用侧）', () => {
    assert(!/setEdBody|triggerAutoSave|doSave|triggerSave/.test(kernelBlock), '内核不触发保存')
    assert(kernelBlock.indexOf('host' + '.call') < 0 && kernelBlock.indexOf('fetch(') < 0, '内核不发 RPC/网络请求')
    assert(!/\.innerHTML\s*=[^=]/.test(kernelBlock), '内核不直写 innerHTML（渲染产物由调用侧赋值；注释提及不算）')
  })
  Object.assign(S, { grabKernelBlock, kernelFn, v3ParseHtml })
  }
}
