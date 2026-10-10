// ===== 双模式编辑器内核 v3（规格：design/notes-editor-v3.html；app.html/发布包 lib/client.js 同块同步，check.js 断言三端一致）=====
// 安全红线：esc() 先把 & < > " ' 转为实体，绝不用 innerHTML 直插原文；代码块内容同样转义
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\x22/g, '&quot;').replace(/\x27/g, '&#39;')
}
// 资产显示路由：正文相对路径 ![](assets/xxx) → GET /dsh-notes/asset?file=assets/xxx（静态包 index.mjs 路由下发二进制）；
// img 用 data-md-src 记原始相对路径，序列化时还原（显示 URL 不进 Markdown）
function assetDisplaySrc(mdSrc) { return '/dsh-notes/asset?file=' + encodeURIComponent(mdSrc) }
// ===== P2 双链 [[target]]：target 不含方括号/换行。解析放 client（渲染时按当前库匹配；host 不改）=====
// 口径：[[n-xxx]] 精确 id 优先，其次 [[标题]] 全库标题精确匹配；解析不到 → 纯文本。反向链接扫描复用同一正则口径
var WIKI_RE = /\[\[([^\[\]\n]+)\]\]/g
function extractWikiTargets(text) { var out = [], m; WIKI_RE.lastIndex = 0; while ((m = WIKI_RE.exec(String(text == null ? '' : text)))) { out.push(m[1]); if (out.length >= 500) break } return out }
function wikiLinksTo(body, id, title) { var ts = extractWikiTargets(body); return ts.indexOf(id) >= 0 || (!!title && ts.indexOf(title) >= 0) }
// 反转义（esc 的逆）：行内文本已转义，双链 target 解析前须还原（否则含 & 的标题永不命中）
function unesc(s) { return String(s).replace(/&(amp|lt|gt|quot|#39);/g, function (m, k) { return k === 'amp' ? '&' : k === 'lt' ? '<' : k === 'gt' ? '>' : k === 'quot' ? '"' : "'" }) }
// ===== 文档安全 S1（notes-052-span-kernel2）：```secret 机密 fence span 纯函数（host 侧 S2 复用同款可达路径——零 DOM 依赖）=====
// ===== secret-span BEGIN =====（文档安全 S2 notes-052-pipeline-mask：本标记区间 = host 消费管线切片——host manifest 的 @shared 条目
//   按此标记逐字节纳入 host 作用域（物理单源：host 六面消费与编辑器渲染共用下方唯一 parseSecretSpans，零私有拷贝零私有正则））=====
// 口径与 renderMarkdown 围栏扫描互为镜像（双函数一致性由 check 节 129 锁定）：
//   · 仅顶格（列 0）```secret 是机密 span；缩进的 ```secret 不算（按普通正文解析，渲染面无模糊——字面量保守口径）
//   · 闭合围栏 = 后续首个顶格 ``` 行（语言位任意）；无闭合行 → EOF 兜底（span 延伸至文末）
//   · 普通 fence 内出现的列 0 ```secret 行只作该 fence 的闭合行（不另开 span）——与渲染器同纪律
//   · 返回 [{start,end}]：start = 开栏行首字符偏移；end = 闭栏行行尾偏移（不含行终结符；EOF 兜底 = body.length）
//     body.slice(start,end) = 完整 fence 源（含开闭栏行）——host 侧 S2 注入脱敏的掩蔽区间数据源
function parseSecretSpans(body) {
  var src = String(body == null ? '' : body), out = [], n = src.length
  function fenceLineAt(p) {   // 该行是顶格 ``` 行则返回行内容（去行尾 \r），否则 null
    if (p + 3 > n || src.charCodeAt(p) !== 0x60 || src.charCodeAt(p + 1) !== 0x60 || src.charCodeAt(p + 2) !== 0x60) return null
    var q = src.indexOf('\n', p)
    return src.slice(p, q < 0 ? n : q).replace(/\r$/, '')
  }
  var p = 0
  while (p < n) {
    var ln = fenceLineAt(p)
    if (ln === null) { var nl0 = src.indexOf('\n', p); p = nl0 < 0 ? n : nl0 + 1; continue }
    var lang = ln.replace(/^\x60{3}/, '').trim()
    // 找闭合围栏行：首个后续顶格 ``` 行；找不到 = EOF 兜底
    var q2 = src.indexOf('\n', p), k = q2 < 0 ? n : q2 + 1, closeEnd = -1
    while (k < n) {
      if (fenceLineAt(k) !== null) { var q3 = src.indexOf('\n', k); closeEnd = q3 < 0 ? n : q3; break }
      var nl1 = src.indexOf('\n', k); k = nl1 < 0 ? n : nl1 + 1
    }
    // span 终点 = 行尾字符偏移（不含行终结符）：CRLF 的 \r 属终结符一并剔除（与渲染器 LF 归一口径对齐——
    // data-md-src 镜像不变量在 LF 正文逐字节成立）；EOF 兜底同理剥尾随 \r
    var spanEnd = closeEnd >= 0 ? closeEnd : n
    if (spanEnd > p && src.charCodeAt(spanEnd - 1) === 13) spanEnd--
    if (lang === 'secret') out.push({ start: p, end: spanEnd })
    // 普通 fence 照常跳过闭合行继续扫描；secret span 同口径（闭合行之后是新的扫描起点）
    // closeEnd = 闭合行行尾终结符偏移（或文末 n）：终结符存在则下一行从 closeEnd+1 起，否则扫描结束
    p = closeEnd >= 0 ? (closeEnd < n ? closeEnd + 1 : n) : n
  }
  return out
}
// ===== secret-span END =====
// Markdown → 富文本 HTML（受限 WYSIWYG 渲染方向）。白名单：h1-h3/段落/ul/ol/引用/围栏代码块/分隔线；行内 粗体/斜体/行内码/链接(仅 http/https)/图片(仅 assets/ 前缀)/双链 [[id或标题]]（wikiResolve 解析，不中按纯文本）
// L1：行内原始 HTML 不解释——esc() 先行转为字面文本（<input type="date"> 原样显示，零注入面），序列化逐字还原
// L2：GFM 表格（表头行+对齐分隔行）只读渲染为 <table contenteditable="false">，原始源码逐字记 data-md-src，序列化原样回吐
// 文档安全 S1：顶格 ```secret fence 渲染为机密岛——缺省 = 模糊岛（contenteditable=false + CSS blur + 🔒 角标；序列化经 data-md-src 逐字回吐，往返恒等）；
//   secretOpts = { secretStatic:true, secretLabel:'…' }（只读预览/无交互面）→ 静态占位（正文不进 DOM，保守面）——标签文案由调用侧注入（i18n t() 键，内核零硬编码文案）
function renderMarkdown(md, wikiResolve, secretOpts) {
  var src = String(md || '')
  if (!src.trim()) return ''
  var secretStatic = !!(secretOpts && (secretOpts === true || secretOpts.secretStatic === true))
  var secretLabel = secretOpts && secretOpts.secretLabel != null ? String(secretOpts.secretLabel) : ''
  var lines = src.replace(/\r\n/g, '\n').split('\n')
  var out = []
  var i = 0
  var inUl = false, inOl = false
  function closeLists() { if (inUl) { out.push('</ul>'); inUl = false } if (inOl) { out.push('</ol>'); inOl = false } }
  // 行内：反斜杠转义（占位符法，与序列化器 escapeMd 互逆）→ 图片（先于链接；仅 assets/ 前缀放行，其余原样呈现纯文本）→ 行内码 → 粗体 → 斜体 → 链接 → 双链 [[..]]
  function inline(s) {
    var t = esc(s), ph = []
    t = t.replace(/\\([\\\x60*\[\]])/g, function (m, c) { ph.push(c); return '\uE000' + (ph.length - 1) + '\uE001' })
    t = t.replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, function (m, alt, isrc) {
      if (!/^assets\/[^\s?#]+$/.test(isrc)) return m
      return '<img src="' + esc(assetDisplaySrc(isrc)) + '" data-md-src="' + isrc + '" alt="' + alt + '">'
    })
    t = t.replace(/\x60([^\x60]+)\x60/g, function (m, c) { return '<code>' + c + '</code>' })
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>')
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    // P2 双链：[[target]] → 可点击锚（data-wiki 记原始 target 供序列化还原；点击跳转由调用侧委托绑定）；wikiResolve 解析不到 → 纯文本
    t = t.replace(/\[\[([^\[\]\n]+)\]\]/g, function (m, w) {
      var r = typeof wikiResolve === 'function' ? wikiResolve(unesc(w)) : null
      if (!r) return m
      var label = r.title ? esc(r.title) : w
      return '<a class="dsh-notes-wikilink" data-wiki="' + w + '" href="#wiki" title="' + label + '">' + label + '</a>'
    })
    t = t.replace(/\uE000(\d+)\uE001/g, function (m, n) { return esc(ph[+n]) })
    return t
  }
  var HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
  var STOP = /^(#{1,3}\s|\x60\x60\x60|>\s?|[-*+]\s|\d+\.\s|\s*(?:-{3,}|\*{3,}|_{3,})\s*$)/
  // L2 GFM 表格：表头行（含 |）+ 紧跟对齐分隔行（每格 :?-+:?，行内至少一个 |）→ 只读 <table>；
  // 原始源码逐字记 data-md-src（含对齐分隔行），serializeRich 原样回吐——渲染只影响显示，round-trip 逐字一致是硬约束
  // 单元格切分：\| 转义管道不切列（私用区占位 \uE002 防误切，显示还原为 |；原始源码只经 data-md-src 回吐）
  function splitTblRow(line) {
    var t = String(line).trim().replace(/\\\|/g, '\uE002').replace(/^\|/, '').replace(/\|$/, '')
    return t.split('|').map(function (c) { return c.replace(/\uE002/g, '|').trim() })
  }
  // 对齐分隔行判定：命中返回逐列对齐（left/center/right/'' 数组），否则 null
  function parseTblDelims(line) {
    var l = String(line)
    if (l.indexOf('|') < 0 || !/^\s*\|?[\s:|-]*$/.test(l)) return null
    var cells = splitTblRow(l), aligns = []
    for (var k = 0; k < cells.length; k++) {
      var m = cells[k].match(/^(:?)-+(:?)$/)
      if (!m) return null
      aligns.push(m[1] && m[2] ? 'center' : m[1] ? 'left' : m[2] ? 'right' : '')
    }
    return aligns.length ? aligns : null
  }
  // 表格起点：当前行含 | 且下一行是对齐分隔行（段落累积遇此同样断开，防表格被段落吞并丢换行）
  function isTblStart(idx) { return lines[idx].indexOf('|') >= 0 && idx + 1 < lines.length && !!parseTblDelims(lines[idx + 1]) }
  while (i < lines.length) {
    var line = lines[i]
    // 围栏代码块（文档安全 S1：lang === 'secret' 走机密岛分支——原始 fence 源逐字记 data-md-src，序列化原样回吐）
    if (/^\x60\x60\x60/.test(line)) {
      closeLists()
      var lang = line.replace(/^\x60\x60\x60/, '').trim()
      var codeLines = []
      var fenceOpen = i   // 开栏行号（data-md-src 原始区间起点）
      i++
      while (i < lines.length && !/^\x60\x60\x60/.test(lines[i])) { codeLines.push(lines[i]); i++ }
      var fenceClosed = i < lines.length
      var fenceClose = i   // 闭栏行号（fenceClosed 为真时有效）
      i++
      if (lang === 'secret') {
        // 原始 fence 源 = 开栏行 + 内容行 +（有则）闭栏行——LF 归一后的逐字源；serializeRich 原样回吐（fence 字面量原则：
        // 内含 [[..]]/URL/星号/HTML 形文本不解析不归一化——内容仅经 esc 转义呈现，无任何行内加工）
        var rawLines = [lines[fenceOpen]].concat(codeLines)
        if (fenceClosed) rawLines.push(lines[fenceClose])
        var rawSrc = rawLines.join('\n')
        if (secretStatic) {
          // 降级/只读面（历史/回收站预览等无揭示交互面）：静态占位——正文不进 DOM（保守面），机密与否仅剩 🔒 与调用侧注入的标签文案
          out.push('<pre class="dsh-notes-secret dsh-secret-static" data-lang="secret" contenteditable="false" data-md-src="' + esc(rawSrc) + '"><span class="secret-lock" aria-hidden="true">\uD83D\uDD12</span><span class="secret-ph">' + esc(secretLabel) + '</span></pre>')
        } else {
          // 编辑器富文本模式：模糊岛（blur 纯 CSS——DOM 内容已全量 esc 先行转义，零注入面）；contenteditable=false 原子岛屿（同表格先例）；
          // 揭示/取消机密交互与 🔒 tooltip 由调用侧绑定（app editor.js bindSecretBlocks——内核零 DOM 行为）
          out.push('<pre class="dsh-notes-secret" data-lang="secret" contenteditable="false" data-md-src="' + esc(rawSrc) + '"><span class="secret-lock" aria-hidden="true">\uD83D\uDD12</span><code>' + esc(codeLines.join('\n')) + '</code></pre>')
        }
      } else {
        out.push('<pre' + (lang ? ' data-lang="' + esc(lang) + '"' : '') + '><code>' + esc(codeLines.join('\n')) + '</code></pre>')
      }
      continue
    }
    // 分隔线
    if (HR.test(line)) { closeLists(); out.push('<hr>'); i++; continue }
    // 标题 # ~ ###
    var hm = line.match(/^(#{1,3})\s+(.*)$/)
    if (hm) {
      closeLists()
      var lvl = hm[1].length
      out.push('<h' + lvl + '>' + inline(hm[2]) + '</h' + lvl + '>')
      i++
      continue
    }
    // 引用块
    if (/^>\s?/.test(line)) {
      closeLists()
      var quoteLines = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { quoteLines.push(lines[i].replace(/^>\s?/, '')); i++ }
      out.push('<blockquote>' + inline(quoteLines.join(' ')) + '</blockquote>')
      continue
    }
    // 无序列表
    if (/^[-*+]\s+/.test(line)) {
      if (inOl) { out.push('</ol>'); inOl = false }
      if (!inUl) { out.push('<ul>'); inUl = true }
      out.push('<li>' + inline(line.replace(/^[-*+]\s+/, '')) + '</li>')
      i++
      continue
    }
    // 有序列表
    if (/^\d+\.\s+/.test(line)) {
      if (inUl) { out.push('</ul>'); inUl = false }
      if (!inOl) { out.push('<ol>'); inOl = true }
      out.push('<li>' + inline(line.replace(/^\d+\.\s+/, '')) + '</li>')
      i++
      continue
    }
    // L2 GFM 表格（只读渲染）：表头 + 对齐分隔行 + 表体（连续含 | 的非空白行；格数不齐补空/截尾仅影响显示，源码不动）
    if (isTblStart(i)) {
      closeLists()
      var tblRaw = [lines[i], lines[i + 1]]
      var aligns = parseTblDelims(lines[i + 1])
      var headCells = splitTblRow(lines[i])
      i += 2
      var bodyRows = []
      while (i < lines.length && lines[i].trim() !== '' && lines[i].indexOf('|') >= 0 && !STOP.test(lines[i])) { tblRaw.push(lines[i]); bodyRows.push(splitTblRow(lines[i])); i++ }
      var cols = Math.max(headCells.length, aligns.length)
      var alAt = function (k2) { var al = aligns[k2] || ''; return al ? ' style="text-align:' + al + '"' : '' }
      var ths = []
      for (var hk = 0; hk < cols; hk++) ths.push('<th' + alAt(hk) + '>' + inline(headCells[hk] || '') + '</th>')
      var trs = ''
      bodyRows.forEach(function (r) { var tds = []; for (var bk = 0; bk < cols; bk++) tds.push('<td' + alAt(bk) + '>' + inline(r[bk] || '') + '</td>'); trs += '<tr>' + tds.join('') + '</tr>' })
      out.push('<table class="dsh-notes-table" contenteditable="false" data-md-src="' + esc(tblRaw.join('\n')) + '"><thead><tr>' + ths.join('') + '</tr></thead><tbody>' + trs + '</tbody></table>')
      continue
    }
    // 空行
    if (line.trim() === '') { closeLists(); i++; continue }
    // 段落（连续非空非特殊行合并；表格起点同样断开）
    closeLists()
    var paraLines = []
    while (i < lines.length && lines[i].trim() !== '' && !STOP.test(lines[i]) && !isTblStart(i)) { paraLines.push(lines[i]); i++ }
    out.push('<p>' + inline(paraLines.join(' ')) + '</p>')
  }
  closeLists()
  return out.join('\n')
}
// ===== 序列化器（富文本 DOM → Markdown）：renderMarkdown 的逆函数，只产出白名单语法 =====
// 行内：escapeMd 与渲染器占位符转义互逆（2*3、a[b]、反引号均可无损往返）
function escapeMd(t) { return String(t).replace(/\\/g, '\\\\').replace(/([\x60*\[\]])/g, '\\$1') }
function serializeInline(node) {
  var s = ''
  node.childNodes.forEach(function (ch) {
    if (ch.nodeType === 3) { s += escapeMd(ch.nodeValue); return }
    if (ch.nodeType !== 1) return
    var tag = ch.tagName
    if (tag === 'BR') { s += ' '; return }
    if (tag === 'STRONG' || tag === 'B') { var b = serializeInline(ch); if (b.trim()) s += '**' + b + '**'; return }
    if (tag === 'EM' || tag === 'I') { var em = serializeInline(ch); if (em.trim()) s += '*' + em + '*'; return }
    if (tag === 'CODE') { var c = ch.textContent.replace(/\x60/g, '\\\x60'); s += '`' + c + '`'; return }
    // P2 双链：data-wiki 锚序列化回 [[原始 target]]（显示标题不进 Markdown，目标改名后 target 不漂移）
    if (tag === 'A') { var wk = ch.getAttribute('data-wiki'); if (wk != null) { s += '[[' + wk + ']]'; return } var href = ch.getAttribute('href') || ''; s += '[' + serializeInline(ch) + '](' + href + ')'; return }
    if (tag === 'IMG') { s += '![' + (ch.getAttribute('alt') || '') + '](' + (ch.getAttribute('data-md-src') || ch.getAttribute('src') || '') + ')'; return }
    if (tag === 'SCRIPT' || tag === 'STYLE') return
    s += serializeInline(ch) // SPAN/FONT/MARK 等未知行内 → 拆壳保留文本
  })
  return s
}
// 列表序列化：一个列表 = 一个块（item 间单换行，块间才空行）；嵌套列表拍平为同级（白名单只承诺一级）
function serializeList(listEl) {
  var items = [], ordered = listEl.tagName === 'OL', idx = 0
  listEl.childNodes.forEach(function (li) {
    if (li.nodeType !== 1 || li.tagName !== 'LI') return
    idx++
    var marker = ordered ? (idx + '. ') : '- '
    var inlineParts = '', nested = []
    li.childNodes.forEach(function (c) {
      if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) nested.push(c)
      else inlineParts += (c.nodeType === 3 ? escapeMd(c.nodeValue) : serializeInlineWrap(c))
    })
    items.push(marker + inlineParts.trim())
    nested.forEach(function (nl) { items.push(serializeList(nl)) })
  })
  return items.join('\n')
}
function serializeInlineWrap(node) { var d = document.createElement('span'); d.appendChild(node.cloneNode(true)); return serializeInline(d) }
function serializeRich(root) {
  var out = []
  root.childNodes.forEach(function (el) {
    if (el.nodeType === 3) { var t0 = escapeMd(el.nodeValue).trim(); if (t0) out.push(t0); return }
    if (el.nodeType !== 1) return
    var tag = el.tagName
    if (tag === 'H1' || tag === 'H2' || tag === 'H3') { var t1 = serializeInline(el).trim(); if (t1) out.push('#'.repeat(+tag[1]) + ' ' + t1) }
    else if (tag === 'P' || tag === 'DIV') {
      var imgs = el.querySelectorAll('img'), onlyImg = imgs.length === 1 && !el.textContent.trim()
      if (onlyImg) { out.push(serializeInline(el).trim()) }
      else { var t2 = serializeInline(el).trim(); if (t2) out.push(t2) }
    }
    else if (tag === 'UL' || tag === 'OL') { var lst = serializeList(el); if (lst) out.push(lst) }
    else if (tag === 'BLOCKQUOTE') {
      var blocks = el.querySelectorAll('p,div')
      if (blocks.length) { blocks.forEach(function (b) { var t3 = serializeInline(b).trim(); if (t3) out.push('> ' + t3) }) }
      else { var t4 = serializeInline(el).trim(); if (t4) out.push('> ' + t4) }
    }
    else if (tag === 'PRE') {
      var lang = el.getAttribute('data-lang') || ''
      // 文档安全 S1：机密 fence 块（renderMarkdown 机密岛产物）经 data-md-src 逐字回吐——往返恒等硬约束
      //（富文本序列化回源码逐字节一致；fence 字面量原则：内容不解析不归一化）。data-md-src 缺失（外来手写 DOM）按普通 code fence 兜底重建。
      var secretRaw = lang === 'secret' ? el.getAttribute('data-md-src') : null
      if (lang === 'secret' && secretRaw) out.push(secretRaw)
      else {
        var code = el.textContent.replace(/\n+$/, '')
        out.push('```' + lang + '\n' + code + '\n```')
      }
    }
    // L2 只读表格：data-md-src 逐字回吐原始表格源码（含对齐分隔行）；无源码记录的外来表格按文本拆壳兜底
    else if (tag === 'TABLE') { var tsrc = el.getAttribute('data-md-src'); if (tsrc) out.push(tsrc); else { var t6 = serializeInline(el).trim(); if (t6) out.push(t6) } }
    else if (tag === 'HR') { out.push('---') }
    else if (tag === 'IMG') { out.push(serializeInlineWrap(el)) }
    else { var t5 = serializeInline(el).trim(); if (t5) out.push(t5) }
  })
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}
// 往返自检归一化：行尾空白/多余空行不视为差异
function normMd(s) { return String(s || '').replace(/\r\n/g, '\n').split('\n').map(function (l) { return l.replace(/\s+$/, '') }).join('\n').replace(/\n{3,}/g, '\n\n').trim() }
// ===== 白名单降级分析：正文含白名单外结构 → 富文本入口置灰；围栏代码块内容不参与判定 =====
// L1 放宽：行内原始 HTML 不再降级——inline() 首步 esc() 已把它渲染成转义字面文本（无注入面），序列化经文本节点逐字还原，
// 单行往返逐字一致；保留降级的只剩「多行 HTML 块」（段落合并会丢换行、逐字往返不保）与下方歧义结构
// L2 放宽：GFM 表格不再降级——renderMarkdown 只读渲染（contenteditable=false + 对齐样式），serializeRich 经 data-md-src 逐字回吐
var DEG_RULES = [
  { key: 'nestedQuote', label: '嵌套引用', re: /^\s*>(?:\s*>)+/ },
  { key: 'h4', label: '四级及以下标题', re: /^\s*#{4,6}\s/ },
  { key: 'task', label: '任务列表', re: /^\s*[-*+]\s+\[[ xX]\]/ }
]
// 多行 HTML 块判定行：行首（可缩进）即 <tag>/</tag>。单行 <tag> 行（含行内代码里的标签）按字面量渲染、逐字往返，放行；
// 连续 ≥2 个此类行才构成多行 HTML 块 → 降级（记段首行号/样本）
var HTML_BLOCK_LINE = /^\s*<\/?[a-zA-Z][^>\n]*>/
function analyzeMarkdown(md) {
  var found = {}, order = []
  var htmlRun = 0, htmlRunStart = -1, htmlRunSample = ''
  String(md || '').split('\n').forEach(function (ln, idx) {
    if (/^\x60\x60\x60/.test(ln)) { analyzeMarkdown._in = !analyzeMarkdown._in; htmlRun = 0; htmlRunStart = -1; return }
    if (analyzeMarkdown._in) return
    if (HTML_BLOCK_LINE.test(ln)) {
      if (htmlRun === 0) { htmlRunStart = idx; htmlRunSample = ln.trim().slice(0, 36) }
      htmlRun++
      if (htmlRun === 2 && !found.htmlBlock) { found.htmlBlock = { label: '多行 HTML 块', line: htmlRunStart + 1, sample: htmlRunSample }; order.push(found.htmlBlock) }
    } else { htmlRun = 0; htmlRunStart = -1 }
    DEG_RULES.forEach(function (r) {
      if (!found[r.key] && r.re.test(ln)) { found[r.key] = { label: r.label, line: idx + 1, sample: ln.trim().slice(0, 36) }; order.push(found[r.key]) }
    })
  })
  analyzeMarkdown._in = false
  return { ok: order.length === 0, reasons: order }
}
// ===== 粘贴 HTML 白名单清洗：h4-6 降为段落，table/div 拆壳，script/style 丢弃，链接仅 http/https =====
function sanitizeFragment(frag) {
  var KEEP_B = { P: 1, H1: 1, H2: 1, H3: 1, UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1, PRE: 1, BR: 1, HR: 1, STRONG: 1, B: 1, EM: 1, I: 1, CODE: 1, IMG: 1 }
  function walk(node, out) {
    node.childNodes.forEach(function (ch) {
      if (ch.nodeType === 3) { out.appendChild(document.createTextNode(ch.nodeValue)); return }
      if (ch.nodeType !== 1) return
      var tag = ch.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE') return
      if (tag === 'A') { var wk = ch.getAttribute('data-wiki'); if (wk != null) { var wa = document.createElement('a'); wa.setAttribute('class', 'dsh-notes-wikilink'); wa.setAttribute('data-wiki', wk); wa.setAttribute('href', '#wiki'); walk(ch, wa); out.appendChild(wa); return } var href = ch.getAttribute('href') || ''; if (/^https?:/.test(href)) { var a = document.createElement('a'); a.href = href; walk(ch, a); out.appendChild(a) } else walk(ch, out); return }
      if (tag === 'IMG') { var isrc = ch.getAttribute('data-md-src') || ''; if (!/^assets\/[^\s?#]+$/.test(isrc)) return; var im = document.createElement('img'); im.src = assetDisplaySrc(isrc); im.setAttribute('data-md-src', isrc); im.alt = ch.alt || ''; out.appendChild(im); return }
      if (/^H[4-6]$/.test(tag)) { var p = document.createElement('p'); walk(ch, p); out.appendChild(p); return }
      if (KEEP_B[tag]) { var el = document.createElement(tag.toLowerCase()); walk(ch, el); out.appendChild(el); return }
      walk(ch, out) // 其他标签拆壳
    })
  }
  var box = document.createElement('div'); walk(frag, box); return box
}
// ===== 0.4.8 双链 [[ 输入补全（源码模式，notes-048-wiki-autocomplete）：纯函数层（双端同构单一事实源）=====
// 触发窗口解析：caret 前最后一个「[[」起至 caret 止为活跃窗口，窗口内已敲字符 = query；
// 窗口内含 ] 或换行 → null（闭合/换行即失配关闭，调用侧关下拉）。返回 { start, query } 或 null；纯字符串口径，零 DOM 依赖
function wikiAcTrigger(text, caret) {
  text = String(text == null ? '' : text)
  caret = Math.max(0, Math.min(text.length, caret == null ? text.length : caret))
  if (caret < 2) return null
  var open = text.lastIndexOf('[[', caret - 2)
  if (open < 0) return null
  var q = text.slice(open + 2, caret)
  if (q.indexOf(']') >= 0 || q.indexOf('\n') >= 0 || q.indexOf('\r') >= 0) return null
  return { start: open, query: q }
}
// 候选过滤（数据源零 RPC：调用侧传内存 notes 缓存）：标题小写折叠子串 + id 前缀双匹配；
// 剔除软删/sys 墓碑（host 缺省口径已排，组件侧兜底双闸——mentionFilter 同纪律）；updatedAt 倒序取前 WIKI_AC_MAX
var WIKI_AC_MAX = 8
function wikiAcFilter(notes, query) {
  var q = String(query == null ? '' : query).toLowerCase()
  var list = notes || [], out = []
  for (var i = 0; i < list.length; i++) {
    var n = list[i]
    if (!n || n.deleted === true || (n.kind || 'note') === 'sys') continue
    if (q) {
      var hit = String(n.title || '').toLowerCase().indexOf(q) >= 0
      if (!hit) hit = String(n.id || '').toLowerCase().indexOf(q) === 0
      if (!hit) continue
    }
    out.push(n)
  }
  out.sort(function (a, b) { var x = String(a.updatedAt || ''), y = String(b.updatedAt || ''); return x < y ? 1 : x > y ? -1 : 0 })
  return out.slice(0, WIKI_AC_MAX)
}
// ===== 0.4.8 三重分类收敛 B 方案（notes-048-topic-tag-merge）：主题废弃并入标签——读侧虚拟合并单一事实源 =====
// effTags(note) = tags ∪ {topic}：tags 元素 trim 去空 + 精确去重保序；topic trim 后非空且≠「未分类」才追加（tags 已含同名不重复）。
// 大小写敏感（与 host tag 精确过滤同口径：'Dev' ≠ 'dev' 各自成组）；「分类中」占位主题照常并入
// （侧栏标签树显示映射 tree.classifying「识别中」，编辑器标签控件/面包屑自行剔除该占位）。
// 纯读侧口径：磁盘 .md 零改动（懒迁移红线——写侧惰性落盘在保存路径：app 编辑器保存载荷 / client 面板自动保存 / host note_manage 工具面，
// 存量 topic 笔记首次保存即合并进 tags 并清空 topic；本函数永不写盘）。
function effTags(n) {
  var out = []
  var tags = (n && n.tags) || []
  for (var i = 0; i < tags.length; i++) { var v = String(tags[i] == null ? '' : tags[i]).trim(); if (v && out.indexOf(v) < 0) out.push(v) }
  var tp = String(n && n.topic != null ? n.topic : '').trim()
  if (tp && tp !== '未分类' && out.indexOf(tp) < 0) out.push(tp)
  return out
}
// effTagsUi(n)：UI 呈现面（行尾标签字/面包屑标签段/编辑器标签控件 chips）——effTags 剔除「分类中」瞬态占位
// （分类回填完成前不成 chip/ crumb 段；侧栏标签树的「识别中」分组仍由 effTags 原始口径承担，不在本函数剔除）
function effTagsUi(n) { return effTags(n).filter(function (x) { return x !== '分类中' }) }
// ===== end 双模式编辑器内核 v3 =====
