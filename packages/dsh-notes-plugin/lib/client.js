/* global window, document, fetch, localStorage, performance, PerformanceObserver, console */
// dsh-notes — Browser 侧 bundle（CJS 工厂，供 dsh web 客户端 ModuleLoader 注入）。
//
// 本文件是发布版静态包的 **最终源码**（P3）：由 scripts/build-dist.cjs 从开发版 client-impl.js
// 机械转换而来，转换规则见 task-board-plugin/docs/PACKAGING.md 第 4 节：
//   · React        ：require('react')（静态包无全局 React）
//   · RPC          ：fetch('/dsh-notes', POST {method, args}) —— index.mjs 的 webServer exact 路由
//                    （动态插件的 host 调用桥在静态包中不存在）
//   · 样式         ：fetch notes-css + document.createElement('style') 注入（doc 级，进程单例）
//                    （动态插件的 styles 服务在静态包中不存在）
//   · 定时器        ：动态插件的 ctx.interval 快捷方式不存在，用 ctx.get('timer') + ctx.effect
//   · inject       ：声明全部服务（slots/timer/sessions/workspaces），保证就绪后才 apply
//
// 要改 client 行为：改开发版 client-impl.js，然后 `node scripts/build-dist.cjs` 重新生成。
window.__ModuleLoader__.load({
  id: 'dsh-notes-plugin',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    'use strict'
    const React = require('react')

    function apply(ctx) {
    const slots = ctx.get('slots')
    if (!slots) { console.error('[dsh-notes] slots service unavailable'); return }
    const timer = ctx.get('timer')
    if (!timer) { console.error('[dsh-notes] timer service unavailable'); return }
    const sessions = ctx.get('sessions')
    const workspaces = ctx.get('workspaces')
    const disposers = []
    const listeners = new Set()
    const noteRefreshListeners = new Set()
    let panelOpen = false
    let currentSessionId = ''
    let toastEmit = null
    // toast 支持动作按钮：act = { label, fn }（先例 = app.html toast(m, act)；归档「撤销」用它）
    function showToast(msg, act) { try { if (toastEmit) toastEmit(act && act.label ? { msg: msg, act: act } : msg) } catch (e) {} }
    // 入口双模式：'header'（会话头部按钮）| 'fab'（可拖拽悬浮气泡）；互斥、可持久化
    let entryMode = 'header'
    let fabPos = { x: 16, y: 80 }   // 悬浮气泡默认位置（左上角）
    const entryListeners = new Set()
    function loadEntryState() {
      try {
        const saved = localStorage.getItem('dsh-notes-entry')
        if (saved) {
          const s = JSON.parse(saved)
          if (s.mode === 'header' || s.mode === 'fab') entryMode = s.mode
          if (typeof s.fabX === 'number' && typeof s.fabY === 'number') fabPos = { x: s.fabX, y: s.fabY }
        }
      } catch (err) {}
    }
    function saveEntryState() { try { localStorage.setItem('dsh-notes-entry', JSON.stringify({ mode: entryMode, fabX: fabPos.x, fabY: fabPos.y })) } catch (err) {} }
    function notifyEntry() { entryListeners.forEach(fn => fn({ entryMode })) }
    function setEntryMode(m) { entryMode = m; saveEntryState(); notifyEntry() }
    // 文件夹折叠态持久化：JSON 数组记录「展开中」的文件夹 id（'__pinned__' 是置顶折叠组固定 key）；null/缺省 = 全部展开
    const PINNED_KEY = '__pinned__'
    function loadFoldersExpanded() { try { const v = localStorage.getItem('dsh-notes-folders-expanded'); if (!v) return null; const arr = JSON.parse(v); return Array.isArray(arr) ? arr : null } catch (err) { return null } }
    function saveFoldersExpanded(arr) { try { localStorage.setItem('dsh-notes-folders-expanded', JSON.stringify(arr)) } catch (err) {} }
    // 陈旧 id 清洗：按当前文件夹清单过滤失效 id（PINNED_KEY 保留）；过滤后为空 → null（回缺省全展开），并回写持久化
    // （文件夹删除重建后旧 id 残留会让「非 null 数组 = 只展开集合内 id」语义错乱：老 id 占位、新文件夹默认折叠——观感即点哪个都不展开）
    function pruneFoldersExpanded(prev, folderList) {
      if (!prev) return prev
      const next = prev.filter(id => id === PINNED_KEY || folderList.some(f => f.id === id))
      if (next.length === prev.length) return prev
      const fixed = next.length ? next : null
      saveFoldersExpanded(fixed)
      return fixed
    }
    // ===== 侧栏宽度（两栏分隔条拖拽调整；localStorage 记忆；双击分隔条重置缺省）=====
    // clamp：200px ≤ w ≤ 60% 面板宽；key 与 app.html 独立（app.html 侧为 dsh-notes-app-sidebar-w）
    const SIDE_W_KEY = 'dsh-notes-sidebar-w'
    const SIDE_W_DEFAULT = 300   // 与 styles.css .dsh-notes-side 缺省宽一致
    function clampSideW(w, panelW) { return Math.max(200, Math.min(Math.round(panelW * 0.6), Math.round(w))) }
    function loadSideW() { try { const v = parseInt(localStorage.getItem(SIDE_W_KEY), 10); return v >= 200 ? v : null } catch (err) { return null } }
    function saveSideW(w) { try { if (w == null) localStorage.removeItem(SIDE_W_KEY); else localStorage.setItem(SIDE_W_KEY, String(w)) } catch (err) {} }
    loadEntryState()
    const PAGE_SIZE = 50
    const KIND_LABELS = { note: '笔记', decision: '决策', todo: '待办', link: '链接', quote: '引用' }
    // ---- 二期：kind 模板骨架（新建笔记预填）——与 host-impl.js / index.mjs / app.html / 原型同一份（check.js 断言一致）----
    // note 为自由格式（空骨架）；机器/运维信息类由 ✨整理按内容套用机器模板（建时无法预判内容，不进 KIND_TEMPLATES）
    const KIND_TEMPLATES = {
      note: '',
      decision: '## 背景\n\n（问题与上下文）\n\n## 结论\n\n（最终选择）\n\n## 理由\n\n（权衡与依据）\n',
      todo: '- [ ] （待办事项）\n',
      link: '## 链接\n\n（URL）\n\n## 说明\n\n（用途与要点）\n',
      quote: '> （引用原文）\n\n—— （出处）\n'
    }
    // ===== 筛选中心（design/notes-filter-center.html 落地）：状态组/类型组多选，组内 OR / 跨组 AND =====
    // 与 app.html / 原型 notes-ui-v2.html 同一份条件模型（check.js 断言一致）；injectEver 字段由 notes-inject-filter 任务提供，feature-detect（slim 有该字段才显示选项）
    const FILTER_STATUS = [
      { id: 'pinned', label: '置顶', icon: 'pin', pred: n => n.status === 'pinned' },
      { id: 'injected', label: '已注入', icon: 'bolt', pred: n => n.inject === true },
      { id: 'injectEver', label: '曾注入', icon: 'clock', pred: n => n.injectEver === true },
      { id: 'sensitive', label: '敏感', icon: 'lock', pred: n => n.sensitive === true },
    ]
    const FILTER_KINDS = ['note', 'decision', 'todo', 'link', 'quote']
    const FILTER_SORTS = [
      { id: 'time', label: '时间', desc: '置顶优先 · 更新降序（默认）' },
      { id: 'use', label: '引用', desc: '被引用次数降序' },
      { id: 'rel', label: '相关度', desc: '搜索打分（搜索时生效）' },
    ]
    const FILTERS0 = () => ({ pinned: false, injected: false, injectEver: false, sensitive: false, kinds: [] })
    // 筛选条件 + 排序档位持久化（dsh-notes-filters；kinds 按已知 kind 校验，sortBy 非法值回退 time）
    function loadFiltersState() {
      const F = FILTERS0()
      try {
        const v = localStorage.getItem('dsh-notes-filters')
        if (!v) return { filters: F, sortBy: 'time' }
        const s = JSON.parse(v) || {}
        if (s.filters) {
          ['pinned', 'injected', 'injectEver', 'sensitive'].forEach(k => { F[k] = s.filters[k] === true })
          if (Array.isArray(s.filters.kinds)) F.kinds = s.filters.kinds.filter(k => !!KIND_LABELS[k])
        }
        return { filters: F, sortBy: (s.sortBy === 'use' || s.sortBy === 'rel') ? s.sortBy : 'time' }
      } catch (err) { return { filters: F, sortBy: 'time' } }
    }
    // 筛选谓词（纯函数，check.js 提取做语义回归）：状态组组内 OR、类型组组内 OR、跨组 AND
    function matchFilters(n, F) {
      const st = []
      if (F.pinned) st.push(n.status === 'pinned')
      if (F.injected) st.push(n.inject === true)
      if (F.injectEver) st.push(n.injectEver === true)
      if (F.sensitive) st.push(n.sensitive === true)
      if (st.length && st.indexOf(true) < 0) return false
      if (F.kinds.length && F.kinds.indexOf(n.kind || 'note') < 0) return false
      return true
    }
    const shortSid = (sid) => sid ? String(sid).replace(/^session-/, '').slice(0, 8) : ''
    // P3 派发闭环：单条派发完成判定（dispatchStatus==='done' 或存量 done===true 向后兼容）——host 三通道回执：idle 事件 / resolved 联动 / 手动标记
    const isDispatchDone = (d) => !!(d && (d.dispatchStatus === 'done' || d.done === true))
    // 字节数人性化（归档预览组的 totalBytes 展示用）
    const fmtBytes = (n) => { n = +n || 0; return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB' }
    const notify = () => listeners.forEach(fn => fn({ panelOpen }))
    const notifyNotesChanged = () => noteRefreshListeners.forEach(fn => fn())
    const e = React.createElement
    // ===== SVG 图标集（UI v2：全部图标走 SVG，零 emoji）=====
    // 原型 design/notes-ui-v2.html 的 15 个 symbol 内联化为 e() createElement 结构
    // （check.js 断言这些 path d 串；图标渲染不经过 innerHTML，天然无注入面）
    const IC = {
      search: [e('circle', { key: 'c', cx: 11, cy: 11, r: 7 }), e('path', { key: 'p', d: 'm20 20-3.5-3.5' })],
      plus: [e('path', { key: 'p', d: 'M12 5v14M5 12h14' })],
      chev: [e('path', { key: 'p', d: 'm9 6 6 6-6 6' })],
      pin: [e('path', { key: 'p', d: 'M12 17v5M7 4h10l-1.5 6.5 3 4.5h-13l3-4.5Z' })],
      folder: [e('path', { key: 'p', d: 'M4 7a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z' })],
      topic: [e('path', { key: 'p', d: 'M12 3l2.2 5.6L20 11l-5.8 2.4L12 19l-2.2-5.6L4 11l5.8-2.4Z' })],
      bolt: [e('path', { key: 'p', d: 'M13 3 5 13.5h6L11 21l8-10.5h-6Z' })],
      eye: [e('path', { key: 'p', d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z' }), e('circle', { key: 'c', cx: 12, cy: 12, r: 3 })],
      play: [e('path', { key: 'p', d: 'M7 5.5v13l11-6.5Z' })],
      ext: [e('path', { key: 'p', d: 'M14 5h5v5M19 5l-8 8M11 5H6a1.5 1.5 0 0 0-1.5 1.5V18A1.5 1.5 0 0 0 6 19.5h11.5A1.5 1.5 0 0 0 19 18v-5' })],
      trash: [e('path', { key: 'p', d: 'M4.5 6.5h15M9 6V4.5h6V6M7 6.5 8 20h8l1-13.5M10 10v6M14 10v6' })],
      gear: [e('circle', { key: 'c', cx: 12, cy: 12, r: 3.2 }), e('path', { key: 'p', d: 'M12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18' })],
      up: [e('path', { key: 'p', d: 'M12 19V6M6.5 11.5 12 6l5.5 5.5M5 20h14' })],
      down: [e('path', { key: 'p', d: 'M12 5v13M6.5 12.5 12 18l5.5-5.5M5 20h14' })],
      note: [e('path', { key: 'p1', d: 'M6 4h9l4 4v12H6Z' }), e('path', { key: 'p2', d: 'M14.5 4v4.5H19' })],
      filter: [e('path', { key: 'p', d: 'M4 5h16l-6.5 7.5V19l-3-1.5v-5Z' })],
      // 原型 defs 遗漏了 i-check（capSave 引用），补上；tag/swap 为 v2 新增（标签 chip / 入口模式切换）
      check: [e('path', { key: 'p', d: 'M4.5 12.5 10 18 19.5 6.5' })],
      tag: [e('path', { key: 'p', d: 'M4 4h7l9 9-7 7-9-9Z' }), e('circle', { key: 'c', cx: 8, cy: 8, r: 1.6 })],
      swap: [e('path', { key: 'p', d: 'M7 4 3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8' })],
      // v3 双模式编辑器工具栏图标（原型 notes-editor-v3.html defs 内联化）
      codeblock: [e('path', { key: 'p', d: 'm8 6-6 6 6 6M16 6l6 6-6 6' })],
      bold: [e('path', { key: 'p1', d: 'M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z' }), e('path', { key: 'p2', d: 'M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z' })],
      italic: [e('path', { key: 'p', d: 'M19 4h-9M14 20H5M15 4 9 20' })],
      link: [e('path', { key: 'p1', d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }), e('path', { key: 'p2', d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' })],
      ul: [e('path', { key: 'p', d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' })],
      ol: [e('path', { key: 'p', d: 'M11 6h10M11 12h10M11 18h10M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1' })],
      quote: [e('path', { key: 'p1', d: 'M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z' }), e('path', { key: 'p2', d: 'M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z' })],
      image: [e('rect', { key: 'r', x: 3, y: 3, width: 18, height: 18, rx: 2 }), e('circle', { key: 'c', cx: 9, cy: 9, r: 2 }), e('path', { key: 'p', d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' })],
      warn: [e('path', { key: 'p1', d: 'M12 3 2.5 20h19Z' }), e('path', { key: 'p2', d: 'M12 10v4M12 17.5v.01' })],
      // 二期 ✨整理（AI 按 kind 模板重写正文）图标：双星
      sparkle: [e('path', { key: 'p1', d: 'M10 3l1.7 4.8 4.8 1.7-4.8 1.7L10 16l-1.7-4.8-4.8-1.7 4.8-1.7Z' }), e('path', { key: 'p2', d: 'M17.5 14.5l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9Z' })],
      // 敏感标记（sensitive 字段 toggle）：锁形图标
      lock: [e('rect', { key: 'r', x: 4.5, y: 10.5, width: 15, height: 9.5, rx: 1.5 }), e('path', { key: 'p', d: 'M8 10.5V7.5a4 4 0 0 1 8 0v3' })],
      // 筛选中心新增（design/notes-filter-center.html）：曾注入时钟 / 排序 / 激活 chip × 移除
      clock: [e('circle', { key: 'c', cx: 12, cy: 12, r: 8.5 }), e('path', { key: 'p', d: 'M12 7.5V12l3 2' })],
      sort: [e('path', { key: 'p', d: 'M8 5v14M8 5 4.5 8.5M8 5l3.5 3.5M16 19V5M16 19l3.5-3.5M16 19l-3.5-3.5' })],
      x: [e('path', { key: 'p', d: 'M6 6l12 12M18 6 6 18' })],
    }
    // I(name, size?, cls?)：图标 helper——返回 e('svg') 结构（stroke=currentColor 由 CSS 统一，尺寸默认 15px）
    function I(name, size, cls) {
      return e('svg', { className: 'dsh-ic' + (cls ? ' ' + cls : ''), viewBox: '0 0 24 24', style: size ? { width: size + 'px', height: size + 'px' } : undefined, 'aria-hidden': 'true' }, IC[name])
    }
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
    // Markdown → 富文本 HTML（受限 WYSIWYG 渲染方向）。白名单：h1-h3/段落/ul/ol/引用/围栏代码块/分隔线；行内 粗体/斜体/行内码/链接(仅 http/https)/图片(仅 assets/ 前缀)/双链 [[id或标题]]（wikiResolve 解析，不中按纯文本）
    // L1：行内原始 HTML 不解释——esc() 先行转为字面文本（<input type="date"> 原样显示，零注入面），序列化逐字还原
    // L2：GFM 表格（表头行+对齐分隔行）只读渲染为 <table contenteditable="false">，原始源码逐字记 data-md-src，序列化原样回吐
    function renderMarkdown(md, wikiResolve) {
      var src = String(md || '')
      if (!src.trim()) return ''
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
        // 围栏代码块
        if (/^\x60\x60\x60/.test(line)) {
          closeLists()
          var lang = line.replace(/^\x60\x60\x60/, '').trim()
          var codeLines = []
          i++
          while (i < lines.length && !/^\x60\x60\x60/.test(lines[i])) { codeLines.push(lines[i]); i++ }
          i++
          out.push('<pre' + (lang ? ' data-lang="' + esc(lang) + '"' : '') + '><code>' + esc(codeLines.join('\n')) + '</code></pre>')
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
          var code = el.textContent.replace(/\n+$/, '')
          out.push('```' + lang + '\n' + code + '\n```')
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
    // ===== end 双模式编辑器内核 v3 =====
    // 性能自检计数器：浏览器控制台执行 JSON.stringify(window.__dshNotesPerf) 可取数诊断
    const now = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now()
    const perf = { selChange: 0, selCollapsedSkip: 0, selChangeMs: 0, selShowEval: 0, selShowMs: 0, mousemoveTracked: 0, hostCall: 0, hostCallMs: 0, panelRender: 0, selRender: 0, hdrRender: 0, longTasks: 0, longTaskMs: 0, worstTaskMs: 0 }
    try { window.__dshNotesPerf = perf } catch (e2) {}
    // client → host RPC：静态包走 webServer exact 路由（PACKAGING.md 第 4 节），
    // 与 index.mjs 的 RPC_PATH = '/dsh-notes' 对应。
    function rpc(method, args) {
      perf.hostCall++
      var t0 = now()
      return fetch('/dsh-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: method, args: args || {} })
      }).then(
        function (r) { perf.hostCallMs += now() - t0; return r.json() },
        function (err) { perf.hostCallMs += now() - t0; throw err }
      )
    }
    // 性能计数器在 rpc() helper 内部累加（hostCall/hostCallMs），不再改写全局 host 桥
    // 长任务观察器：主线程阻塞（>50ms）的直接证据
    try {
      if (typeof PerformanceObserver !== 'undefined') {
        const po = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          for (let i = 0; i < entries.length; i++) { const en = entries[i]; perf.longTasks++; perf.longTaskMs += en.duration; if (en.duration > perf.worstTaskMs) perf.worstTaskMs = Math.round(en.duration) }
        })
        po.observe({ type: 'longtask' })
        disposers.push(() => po.disconnect())
      }
    } catch (e2) {}
    // 每 30s 把计数器推给 host，汇总写入 perf-report.json（timer 经 ctx.get + ctx.effect）
    try {
      var pd = typeof timer.interval === 'function' ? timer.interval(function () { try { rpc('notes-perf', { perf: JSON.parse(JSON.stringify(perf)) }) } catch (e2) {} }, 30000) : null
      if (typeof pd === 'function') ctx.effect(function () { return pd })
    } catch (e2) {}
    // 样式从 host 拉取（doc 级 <style> 注入，替代动态插件的 styles 服务）
    // PACKAGING.md 坑5：args 里不能出现值为 undefined 的字段，故 notes-css 不传参
    let cssLoaded = false
    let cssTries = 0
    function loadCss() {
      rpc('notes-css').then(function (res) {
        if (res && res.css) {
          cssLoaded = true
          // 进程单例：样式注入 document.head 一次，卸载时移除
          var tag = document.createElement('style')
          tag.dataset.dshNotes = '1'
          tag.textContent = res.css
          document.head.append(tag)
          disposers.push(function () { try { tag.remove() } catch (e2) {} })
        } else scheduleCssRetry()
      }).catch(scheduleCssRetry)
    }
    function scheduleCssRetry() { if (!cssLoaded && ++cssTries <= 10) { var d = timer.timeout(loadCss, 1200); disposers.push(d) } }
    loadCss()
    // 通用拖拽：move(ev) 在 mousemove 时调用，done() 在 mouseup 时调用
    function drag(move, done) {
      const onMove = (ev) => move(ev)
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); if (done) done() }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }
    const d1 = slots.inject('conversation.session.header.actions', () => {
      function HeaderBtn(props) {
        perf.hdrRender++
        const [, force] = React.useState(0)
        if (props && props.sessionId) currentSessionId = props.sessionId
        React.useEffect(() => { const fn = () => force(v => v + 1); entryListeners.add(fn); listeners.add(fn); return () => { entryListeners.delete(fn); listeners.delete(fn) } }, [])
        // 模式互斥：fab 模式时隐藏会话头部按钮
        if (entryMode !== 'header') return null
        return e('button', { className: 'dsh-notes-hdr-btn dsh-nt' + (panelOpen ? ' active' : ''), onClick: () => { panelOpen = !panelOpen; notify() }, 'data-tooltip': '智能笔记' }, e('span', { className: 'dsh-notes-hdr-ic' }, I('note', 13)), e('span', null, '智能笔记'))
      }
      slots.register({ name: 'conversation.session.header.actions', id: 'dsh-notes-btn', order: 40 }, (props) => e(HeaderBtn, props))
    })
    if (typeof d1 === 'function') disposers.push(d1)
    const d2 = slots.inject('shell.overlay', () => {
      // 悬浮气泡入口（可拖拽；点击展开面板；位置持久化；与会话头部按钮互斥）
      function FabEntry() {
        const [, force] = React.useState(0)
        const [pos, setPos] = React.useState({ x: fabPos.x, y: fabPos.y })
        const posRef = React.useRef(pos)
        React.useEffect(() => { posRef.current = pos }, [pos])
        React.useEffect(() => { const fn = () => force(v => v + 1); entryListeners.add(fn); listeners.add(fn); return () => { entryListeners.delete(fn); listeners.delete(fn) } }, [])
        React.useEffect(() => {
          // 窗口尺寸变化时把气泡 clamp 进视口
          function onResize() {
            const p = posRef.current, nx = Math.max(0, Math.min(window.innerWidth - 44, p.x)), ny = Math.max(0, Math.min(window.innerHeight - 44, p.y))
            if (nx !== p.x || ny !== p.y) { posRef.current = { x: nx, y: ny }; setPos({ x: nx, y: ny }) }
          }
          window.addEventListener('resize', onResize)
          return () => window.removeEventListener('resize', onResize)
        }, [])
        // 模式互斥：header 模式时隐藏悬浮气泡
        if (entryMode !== 'fab') return null
        const SIZE = 44
        function onMouseDown(ev) {
          ev.preventDefault()
          const sx = ev.clientX, sy = ev.clientY, px = pos.x, py = pos.y
          let moved = false
          drag(
            (ev2) => {
              const dx = ev2.clientX - sx, dy = ev2.clientY - sy
              if (!moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) moved = true
              if (moved) {
                const nx = Math.max(0, Math.min(window.innerWidth - SIZE, px + dx))
                const ny = Math.max(0, Math.min(window.innerHeight - SIZE, py + dy))
                posRef.current = { x: nx, y: ny }
                setPos({ x: nx, y: ny })
              }
            },
            () => {
              // 区分点击与拖拽：未移动视为点击 → 展开面板；移动则持久化最终位置
              if (!moved) { panelOpen = true; notify() }
              else { fabPos = { x: posRef.current.x, y: posRef.current.y }; saveEntryState() }
            }
          )
        }
        // v2 卡片式 FAB（G 大图标版）：中央 note 22px + 右下 kind 三色点（todo/decision/quote），无计数角标
        return e('button', { className: 'dsh-notes-fab dsh-nt' + (panelOpen ? ' active' : ''), style: { left: pos.x + 'px', top: pos.y + 'px' }, onMouseDown, 'data-tooltip': '笔记' },
          e('span', { className: 'dsh-notes-fab-ic' }, I('note', 22)),
          e('span', { className: 'dsh-notes-fab-tridots', 'aria-hidden': 'true' },
            e('i', { style: { background: 'var(--nkind-todo)' } }),
            e('i', { style: { background: 'var(--nkind-decision)' } }),
            e('i', { style: { background: 'var(--nkind-quote)' } })))
      }
      slots.register({ name: 'shell.overlay', id: 'dsh-notes-fab', order: 199 }, (props) => e(FabEntry, props))
    })
    if (typeof d2 === 'function') disposers.push(d2)
    const d3 = slots.inject('shell.overlay', () => {
      function FloatingPanel() {
        perf.panelRender++
        const [open, setOpen] = React.useState(panelOpen)
        const [notes, setNotes] = React.useState([])
        const [selected, setSelected] = React.useState(null)
        const [edTitle, setEdTitle] = React.useState('')
        const [edTopic, setEdTopic] = React.useState('')
        const [edTags, setEdTags] = React.useState('')
        const [edBody, setEdBody] = React.useState('')
        const [edKind, setEdKind] = React.useState('note')
        const [edStatus, setEdStatus] = React.useState('active')
        const [edRole, setEdRole] = React.useState('off')   // 注入三态：off=不注入 / convention=约定（须遵守）/ reference=资料（按需取用）
        const [edRecall, setEdRecall] = React.useState(true)   // 目录可见（recall 字段，缺省 true=进目录；与 inject 正交）
        const [edSens, setEdSens] = React.useState(false)   // 敏感标记（sensitive 字段，缺省 false；开启后注入系统提示时正文按行打码）
        const [edScope, setEdScope] = React.useState([])
        const [savedAt, setSavedAt] = React.useState(0)
        const [searchText, setSearchText] = React.useState('')
        const [searchIds, setSearchIds] = React.useState(null)
        const [loading, setLoading] = React.useState(false)
        const [error, setError] = React.useState('')
        const [pos, setPos] = React.useState({ x: null, y: null })
        const [size, setSize] = React.useState({ width: 920, height: 640 })
        // 侧栏宽度：分隔条拖拽调整（clamp 200px–60% 面板宽），localStorage 记忆（SIDE_W_KEY），双击分隔条重置缺省
        const [sideW, setSideW] = React.useState(() => loadSideW() || SIDE_W_DEFAULT)
        const [sideDrag, setSideDrag] = React.useState(false)   // 拖拽中：分隔条高亮 + body 禁文本选择
        const sideWRef = React.useRef(0)   // 拖拽期间最新宽镜像（mouseup 持久化读 ref，防闭包过期）
        // UI v2 视图单选（原型 view）：all=全部 / folder=文件夹视图 / topic=主题全局过滤（跨文件夹）
        const [view, setView] = React.useState({ type: 'all', id: '' })
        const [showHelp, setShowHelp] = React.useState(false)
        const [flashId, setFlashId] = React.useState(null)
        const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE)
        const [focusId, setFocusId] = React.useState(null)
        // ===== 筛选中心（design/notes-filter-center.html 落地）：filters 状态 {pinned, injected, injectEver, sensitive, kinds[]} =====
        // 组内 OR / 跨组 AND，与文件夹/主题视图/搜索 AND 叠加；localStorage 持久化（dsh-notes-filters，含 sortBy）
        const [filters, setFilters] = React.useState(() => loadFiltersState().filters)
        // P2 使用遥测：列表排序方式（'time'=按更新（缺省，与 host _list 一致）| 'use'=按被引用次数降序 | 'rel'=相关度（搜索时：标题命中>标签>正文，同级 updatedAt 降序））
        // 筛选中心口径：排序是独立控件，与筛选条件正交（互不重置）
        const [sortBy, setSortBy] = React.useState(() => loadFiltersState().sortBy)
        // 筛选 popover（分组面板：状态组/类型组多选）+ 排序菜单浮层开关
        const [filterOpen, setFilterOpen] = React.useState(false)
        const [sortOpen, setSortOpen] = React.useState(false)
        // 筛选条件/排序变化即持久化（与 folders-expanded 等现有 localStorage 记忆同口径）
        React.useEffect(() => { try { localStorage.setItem('dsh-notes-filters', JSON.stringify({ filters, sortBy })) } catch (err) {} }, [filters, sortBy])
        // host notes-search 返回的命中字段（noteId → ['title'|'tags'|'body']）：「相关度」排序数据源；本地即时命中/旧 host 无该字段时按本地字段估算
        const [searchMatches, setSearchMatches] = React.useState({})
        // 虚拟文件夹树：清单走 notes-folders RPC（list/create/rename/delete/reorder）；折叠态持久化 localStorage
        const [folders, setFolders] = React.useState([])
        const [foldersExpanded, setFoldersExpanded] = React.useState(loadFoldersExpanded)
        // 主题过滤行原地展开态（点行主体=展开/收起该主题子列表；object map，session 内有效，不持久化；缺省折叠）
        const [topicExpanded, setTopicExpanded] = React.useState({})
        const [folderInputOpen, setFolderInputOpen] = React.useState(false)   // 文件夹分组头 ＋ → 内联输入
        const [folderInputText, setFolderInputText] = React.useState('')
        const [folderMenu, setFolderMenu] = React.useState(null)   // 文件夹项右键菜单：{ x, y, folder }（面板内坐标）或 null
        const [renamingId, setRenamingId] = React.useState(null)   // 树内内联重命名中的文件夹 id
        const [renameText, setRenameText] = React.useState('')
        const [ctxNewFolderText, setCtxNewFolderText] = React.useState('')   // 笔记行右键菜单「新建文件夹…」内联输入
        // 新建笔记 modal（侧栏「新建」chip / Ctrl+N 打开，输标题创建）
        const [newNoteOpen, setNewNoteOpen] = React.useState(false)
        const [newNoteTitle, setNewNoteTitle] = React.useState('')
        const [newNotePending, setNewNotePending] = React.useState(false)
        const [newNoteKind, setNewNoteKind] = React.useState('note')   // 二期：新建选类型，按 KIND_TEMPLATES 预填骨架
        const [sessList, setSessList] = React.useState([])
        const [sessPending, setSessPending] = React.useState([])   // 注入范围浮层：标题后台补齐中的占位会话 [{id, short, workspace}]（0.1.7 首屏提速）
        const [scopeOpen, setScopeOpen] = React.useState(false)
        const [dispatchOpen, setDispatchOpen] = React.useState(false)
        const [activeSessions, setActiveSessions] = React.useState([])
        const [dispatchPending, setDispatchPending] = React.useState([])   // 派发对话框：标题后台补齐中的占位会话 [{id, short, workspace}]（0.1.7 首屏提速）
        const [dispatching, setDispatching] = React.useState(false)
        const [dispatchMode, setDispatchMode] = React.useState('existing')  // existing=派发到活跃会话 / new=新建会话派发
        const [dispatchInstr, setDispatchInstr] = React.useState('')
        // ===== 双模式编辑器 v3（原型 design/notes-editor-v3.html）：源码 textarea ⇄ 富文本受限 WYSIWYG =====
        // editorMode：'source' 源码 | 'rich' 富文本；默认源码；Ctrl+/ 或 meta 行两段开关切换
        const [editorMode, setEditorModeState] = React.useState('source')
        const editorModeRef = React.useRef('source')
        // 白名单降级分析（analyzeMarkdown 内核）：正文含嵌套引用/h4+/任务列表/多行 HTML 块 → 富文本入口置灰（行内 HTML 自 L1、表格自 L2 起不再降级——表格只读渲染 + 序列化逐字回吐）
        const [degraded, setDegraded] = React.useState({ ok: true, reasons: [] })
        const degradedRef = React.useRef({ ok: true, reasons: [] })
        // 图片插入弹窗：null | { name, dataURL, mime, size, alt, uploading, error }（三入口共用：粘贴/拖拽/工具栏按钮）
        const [imgModal, setImgModal] = React.useState(null)
        const imgModalRef = React.useRef(null)
        // 链接插入弹窗：null | { text, url }
        const [linkModal, setLinkModal] = React.useState(null)
        const linkModalRef = React.useRef(null)
        // 富文本同步态徽标（工具栏右侧）：false=已同步源码 / true=编辑中（防抖未回写）；同值 setState React 自动 bail，逐击键调无重渲染开销
        const [richSyncing, setRichSyncing] = React.useState(false)
        const [ctxMenu, setCtxMenu] = React.useState(null)   // 笔记行右键菜单：{ x, y, note }（面板内坐标）或 null
        const [dispatchWsId, setDispatchWsId] = React.useState('')       // new 模式：选中的工作区 id
        const [dispatchSessWs, setDispatchSessWs] = React.useState('')   // existing 模式：选中的工作区名
        const [dispatchSessId, setDispatchSessId] = React.useState('')   // existing 模式：选中的会话 id
        const [wsList, setWsList] = React.useState([])
        const [dispatchHistoryOpen, setDispatchHistoryOpen] = React.useState(false)   // 派发历史折叠态：默认折叠，点标题行展开
        // 设置卡片（通用结构：标题「设置」+ 设置项行列表；选择即保存，点遮罩/Esc 关闭）
        const [settingsOpen, setSettingsOpen] = React.useState(false)
        const [settingsData, setSettingsData] = React.useState(null)   // notes-settings-get 返回：{ settings, models }
        const [setLlmProvider, setSetLlmProvider] = React.useState('')
        const [setLlmModel, setSetLlmModel] = React.useState('')
        const [setCatalog, setSetCatalog] = React.useState(true)   // 笔记目录注入总开关（catalogEnabled，缺省开）
        const [setStale, setSetStale] = React.useState('90')   // P1 时效衰减提醒阈值（天；0=关闭，缺省 90）
        const [setBudget, setSetBudget] = React.useState('0')   // P1 注入体积预算（约，字符数；0=不限）
        // 数据导入/导出（设置卡片「数据」区入口）
        const [exportOpen, setExportOpen] = React.useState(false)
        const [exportDir, setExportDir] = React.useState('')
        const [exportPending, setExportPending] = React.useState(false)
        // P3 单文件导出（设置卡片「数据」区「导出单文件…」入口）：scope 三选一（全部/文件夹/标签）+ 目标目录 + 目录页开关
        const [sExportOpen, setSExportOpen] = React.useState(false)
        const [sExportDir, setSExportDir] = React.useState('')
        const [sExportScope, setSExportScope] = React.useState('all')   // 'all' | 'folder' | 'tag'
        const [sExportFolder, setSExportFolder] = React.useState('')    // 文件夹 id（host resolveFolderRef 兼容名称）
        const [sExportTag, setSExportTag] = React.useState('')
        const [sExportToc, setSExportToc] = React.useState(true)        // 目录页开关（缺省开）
        const [sExportPending, setSExportPending] = React.useState(false)
        const [importOpen, setImportOpen] = React.useState(false)
        const [importDir, setImportDir] = React.useState('')
        const [importPreview, setImportPreview] = React.useState(null)   // notes-import-preview 返回：{ total, same, diff, added, detail, folders, unreadable }
        const [importOverwrite, setImportOverwrite] = React.useState(false)   // 「覆盖内容不同的笔记」勾选（默认不勾 = diff 跳过）
        const [importPending, setImportPending] = React.useState(false)   // 预览中 / 执行中共用（按钮禁用防重入）
        // ===== 显式归档 UI：预览对话框（速记组勾选 → 确认执行 → toast 可撤销）+ 手动笔记多选合并 =====
        const [archOpen, setArchOpen] = React.useState(false)      // 归档预览对话框
        const [archGroups, setArchGroups] = React.useState(null)   // notes-archive-preview 返回的速记组（null=加载中）
        const [archChecked, setArchChecked] = React.useState({})   // sessionId → false 取消勾选（缺省全勾）
        const [archExpand, setArchExpand] = React.useState({})     // sessionId → true 展开成员明细
        const [archPending, setArchPending] = React.useState(false)   // 归档执行中（按钮禁用防重入）
        const [selMode, setSelMode] = React.useState(false)        // 列表多选态（复选框勾选，与搜索/过滤共存）
        const [selIds, setSelIds] = React.useState({})             // 多选勾选集合：noteId → true
        const [mergeOpen, setMergeOpen] = React.useState(false)    // 多选合并标题输入小对话框
        const [mergeTitle, setMergeTitle] = React.useState('')
        const [mergePending, setMergePending] = React.useState(false)
        // ===== 二期 ✨整理：notes-ai-organize 按 kind 模板重写正文；organizeUndoRef = 一次撤销栈（toast「撤销」恢复）=====
        const [organizing, setOrganizing] = React.useState(false)
        const organizeUndoRef = React.useRef(null)   // { body } | null
        // ===== 二期 孤儿资产清理：设置卡片「资产清理」→ 预览对话框（dry-run 零写入）→ 勾选删除 =====
        const [pruneOpen, setPruneOpen] = React.useState(false)
        const [pruneData, setPruneData] = React.useState(null)     // notes-assets-prune dryRun 返回：{ orphans:[{name,bytes}], totalBytes, referenced, tombstoned, notes }
        const [pruneChecked, setPruneChecked] = React.useState({}) // name → false 取消勾选（缺省全勾，归档预览同款口径）
        const [prunePending, setPrunePending] = React.useState(false)
        // ===== P1 回收站：侧栏底部「回收站」→ 已删笔记列表（notes-list {includeDeleted:true}）→ 恢复 / 彻底删除（notes-purge）=====
        const [trashOpen, setTrashOpen] = React.useState(false)
        const [trashList, setTrashList] = React.useState(null)     // 回收站列表（null=加载中；[]=空）
        const [trashPending, setTrashPending] = React.useState('') // 执行中的笔记 id（按钮禁用防重入）
        // ===== 整理建议（设置卡片「整理建议」行入口）：notes-suggest 三类候选（速记组/过期未引用/孤儿）——只提名不自动执行 =====
        const [suggestOpen, setSuggestOpen] = React.useState(false)
        const [suggestData, setSuggestData] = React.useState(null)     // notes-suggest 返回：{ archiveCandidates, staleCandidates, orphanCandidates, generatedAt }（null=加载中）
        const [suggestPending, setSuggestPending] = React.useState(false)   // 批量软删执行中（confirm 后才执行；按钮禁用防重入）
        // ===== 注入预览（设置卡片「注入预览」入口）：notes-inject-preview 纯复用 host 注入渲染——双 tab + 会话过滤 + 统计条 =====
        const [injectPreviewOpen, setInjectPreviewOpen] = React.useState(false)
        const [injectPreviewData, setInjectPreviewData] = React.useState(null)   // notes-inject-preview 返回：{ conventions, catalog, stats }（null=加载中）
        const [injectPreviewTab, setInjectPreviewTab] = React.useState('conv')   // 'conv' 约定 | 'cat' 目录
        const [injectPreviewSid, setInjectPreviewSid] = React.useState('')       // 会话短 id 过滤（injectTo 命中口径）；'' = 全局
        // ===== P2 笔记双链：全库正文惰性索引（列表瘦身不含 body；后台 notes-get 小批量补齐，驱动行尾双链标记与反向链接面板；host 不改）=====
        const [wikiVer, setWikiVer] = React.useState(0)      // 索引版本号：索引推进触发重渲染（行尾标记/反向链接随缓存刷新）
        const wikiBodiesRef = React.useRef({})               // noteId → { body, updatedAt }
        const wikiIdxGenRef = React.useRef(0)                // 索引构建代际：列表刷新作废旧任务
        const jumpWikiRef = React.useRef(null)               // 富文本 click 委托调最新 jumpToWikiTarget（监听器挂一次，读 ref 防闭包过期）
        const keepQuickRef = React.useRef(false)
        const newNoteInputRef = React.useRef(null)   // 新建笔记 modal 标题输入框（打开自动聚焦）
        const edBodyDomRef = React.useRef(null)      // 正文 textarea DOM（新建笔记创建后聚焦）
        const edLoadingRef = React.useRef(false)     // 正文异步加载中（notes-get 未返回）：期间 doSave 省略 body 字段，防改名触发保存把空正文写盘
        // 双模式编辑器 DOM/运行时 ref（富文本非受控：编辑期间 React 不重渲染其内容，防 IME 打断/光标丢失）
        const richRef = React.useRef(null)           // 富文本 contenteditable DOM
        const richWrapRef = React.useRef(null)       // 富文本滚动容器（拖拽图片 drop 目标 + 工具栏宿主）
        const richDirtyRef = React.useRef(false)     // 富文本编辑中（未序列化回源码）
        const composingRef = React.useRef(false)     // IME 组合输入中（期间不序列化）
        const savedRangeRef = React.useRef(null)     // 富文本选区缓存（工具栏/弹窗操作后恢复）
        const richSyncTimerRef = React.useRef(null)  // 富文本→源码 900ms 防抖 timer 句柄（disposer）
        const degTimerRef = React.useRef(null)       // 源码→降级分析 450ms 防抖 timer 句柄
        const imgFileInputRef = React.useRef(null)   // 图片弹窗隐藏 file input
        const timersRef = React.useRef([])
        const selectedRef = React.useRef(null)
        const dragNoteIdRef = React.useRef(null)   // 笔记拖拽状态：dragstart 记录 noteId（ref 防闭包过期），dragend 清空
        // 键盘导航所需的 ref（keydown 监听挂一次，回调读最新值）
        const focusIdRef = React.useRef(null)
        const openRef = React.useRef(false)
        const pagedIdsRef = React.useRef([])
        const notesRef = React.useRef([])
        const selectNoteRef = React.useRef(null)
        const closeRef = React.useRef(null)
        const searchInputRef = React.useRef(null)
        const moveFocusRef = React.useRef(null)
        const openNewNoteRef = React.useRef(null)   // Ctrl+N 调最新 openNewNote（keydown 闭包挂一次）
        // 展开态镜像到 ref（keydown 闭包挂一次，需读最新值避免过期）
        const newNoteOpenRef = React.useRef(false)   // 新建笔记 modal 镜像（Esc 优先关 modal）
        const ctxMenuRef = React.useRef(null)   // 右键菜单镜像（keydown 闭包读最新值）
        const folderMenuRef = React.useRef(null)   // 文件夹右键菜单镜像
        const renamingIdRef = React.useRef(null)   // 文件夹重命名输入镜像（Esc 取消）
        const folderInputOpenRef = React.useRef(false)   // 文件夹新建输入镜像（Esc 取消）
        const settingsOpenRef = React.useRef(false)   // 设置卡片镜像（Esc 优先关设置卡片）
        const dispatchOpenRef = React.useRef(false)   // 派发对话框镜像（titlesPending 轮询重拉的终止条件）
        const exportOpenRef = React.useRef(false)   // 导出对话框镜像（Esc 优先关）
        const sExportOpenRef = React.useRef(false)  // P3 单文件导出对话框镜像（Esc 优先关）
        const importOpenRef = React.useRef(false)   // 导入对话框镜像（Esc 优先关）
        const archOpenRef = React.useRef(false)     // 归档预览对话框镜像（Esc 优先关）
        const pruneOpenRef = React.useRef(false)    // 资产清理对话框镜像（Esc 优先关）
        const trashOpenRef = React.useRef(false)    // 回收站对话框镜像（Esc 优先关）
        const suggestOpenRef = React.useRef(false)  // 整理建议对话框镜像（Esc 优先关）
        const injectPreviewOpenRef = React.useRef(false)   // 注入预览对话框镜像（Esc 优先关）
        const mergeOpenRef = React.useRef(false)    // 多选合并对话框镜像（Esc 优先关）
        const selModeRef = React.useRef(false)      // 多选态镜像（Esc 退出多选）
        // 自动保存：编辑字段的最新值 ref（debounce 回调读 ref 而非闭包 state，避免过期）
        const edTitleRef = React.useRef('')
        const edTopicRef = React.useRef('')
        const edTagsRef = React.useRef('')
        const edBodyRef = React.useRef('')
        const edKindRef = React.useRef('note')
        const edStatusRef = React.useRef('active')
        const edRoleRef = React.useRef('off')
        const edRecallRef = React.useRef(true)
        const edSensRef = React.useRef(false)
        const edScopeRef = React.useRef([])
        const autoSaveRef = React.useRef(null)
        React.useEffect(() => { selectedRef.current = selected }, [selected])
        function later(fn, ms) { try { const d = timer.timeout(fn, ms); timersRef.current.push(d); return d } catch (err) { return null } }
        React.useEffect(() => {
          const arr = timersRef.current
          timersRef.current = []
          for (const d of arr) { try { d() } catch (err) {} }
        }, [])
        React.useEffect(() => { try { const saved = localStorage.getItem('dsh-notes-panel-state'); if (saved) { const s = JSON.parse(saved); if (s.x !== undefined && s.y !== undefined) setPos({ x: s.x, y: s.y }); if (s.width !== undefined && s.height !== undefined) setSize({ width: s.width, height: s.height }) } } catch (err) {} }, [])
        function saveState() { try { localStorage.setItem('dsh-notes-panel-state', JSON.stringify({ x: pos.x, y: pos.y, width: size.width, height: size.height })) } catch (err) {} }
        React.useEffect(() => { const fn = (s) => { if (s.panelOpen !== undefined) setOpen(s.panelOpen) }; listeners.add(fn); return () => listeners.delete(fn) }, [])
        // 注入范围下拉的会话列表：面板打开时 + 笔记数变化时刷新（新会话可能出现）
        // 0.1.7 首屏提速：响应带 titlesPending 说明有会话标题在后台读盘补齐——立即渲染已 resolve 条目 +
        // 占位条目（「短id · 标题加载中…」），1.5s 轮询重拉直到补齐或面板关闭（冷缓存首读可能上百秒，轮询成本≈0）
        React.useEffect(() => {
          if (!open) return
          let stopped = false
          let pendingTimer = null
          function pullSessList() {
            rpc('notes-sessions', {}).then(res => {
              if (stopped || !res) return
              if (res.sessions) setSessList(res.sessions)
              setSessPending(res.titlesPending && Array.isArray(res.pendingSessions) ? res.pendingSessions : [])
              if (res.titlesPending && !stopped) pendingTimer = timer.timeout(pullSessList, 1500)
            }).catch(() => {})
          }
          pullSessList()
          return () => { stopped = true; if (typeof pendingTimer === 'function') pendingTimer() }
        }, [open, notes.length])
        // 范围浮层：点击外部关闭
        React.useEffect(() => {
          if (!scopeOpen) return
          const onDown = (ev) => { if (!(ev.target && ev.target.closest && ev.target.closest('.dsh-notes-ed-scope-wrap'))) setScopeOpen(false) }
          document.addEventListener('mousedown', onDown)
          return () => document.removeEventListener('mousedown', onDown)
        }, [scopeOpen])
        // 筛选中心浮层：点击外部关闭（popover + 排序菜单均在 .dsh-notes-filterbar 内，同一选择器覆盖）
        React.useEffect(() => {
          if (!filterOpen && !sortOpen) return
          const onDown = (ev) => { if (!(ev.target && ev.target.closest && ev.target.closest('.dsh-notes-filterbar'))) { setFilterOpen(false); setSortOpen(false) } }
          document.addEventListener('mousedown', onDown)
          return () => document.removeEventListener('mousedown', onDown)
        }, [filterOpen, sortOpen])
        // 派发对话框是 modal（自带 mask 点击外部关闭），无需 document 监听
        React.useEffect(() => { const fn = () => loadNotes(true); noteRefreshListeners.add(fn); return () => noteRefreshListeners.delete(fn) }, [])
        React.useEffect(() => { if (open) loadNotes() }, [open])
        React.useEffect(() => { if (open && pos.x === null) { const w = window.innerWidth; const h = window.innerHeight; setPos({ x: Math.max(w - 980, w * 0.3), y: Math.max(48, (h - 640) / 2) }) } }, [open])
        // 搜索两段式：输入即本地过滤（标题/主题/标签/预览），250ms 防抖后 host 全文检索（含正文）补充
        // 用一次性注册的 timer.debounce：每击键调 timer.timeout 等于每击键在 fiber 上注册一次 ctx.effect，是持续簿记开销
        const searchRef = React.useRef('')
        const searchDebRef = React.useRef(null)
        // 搜索防抖闭包只注册一次，过滤条件经 ref 镜像供其读取（避免闭包过期）
        const filtersRef = React.useRef(filters)
        const filterOpenRef = React.useRef(false)
        const sortOpenRef = React.useRef(false)
        React.useEffect(() => {
          const d = timer.debounce(() => {
            const qq = searchRef.current.trim()
            if (!qq) { setSearchIds(null); setSearchMatches({}); return }
            // 筛选中心组合过滤同步 host：类型组恰选 1 个时可传 kind；状态组仅单条件独活时可传 sensitive/inject
            // （多选 OR / 曾注入 语义 host 无法表达，由本地 matchFilters 兜底全量语义）；matches 命中字段供「相关度」排序
            const sArgs = { query: qq }
            const F = filtersRef.current
            if (F.kinds.length === 1) sArgs.kind = F.kinds[0]
            const stOn = FILTER_STATUS.filter(s => F[s.id]).map(s => s.id)
            if (stOn.length === 1 && stOn[0] === 'sensitive') sArgs.sensitive = true
            if (stOn.length === 1 && stOn[0] === 'injected') sArgs.inject = true
            rpc('notes-search', sArgs).then(res => {
              const ns = (res && res.notes) || []
              setSearchIds(ns.map(n => n.id))
              const mm = {}
              ns.forEach(n => { if (Array.isArray(n.matches)) mm[n.id] = n.matches })
              setSearchMatches(mm)
            }).catch(() => {})
          }, 250)
          searchDebRef.current = d
          return () => { if (d && d.dispose) d.dispose() }
        }, [])
        // 搜索/视图/筛选中心条件变化时重置分页（新结果从头开始）
        React.useEffect(() => { setVisibleCount(PAGE_SIZE) }, [searchText, searchIds, view, filters])
        // 展开态同步到 ref（keydown 闭包读 ref 避免过期）
        React.useEffect(() => { newNoteOpenRef.current = newNoteOpen }, [newNoteOpen])
        React.useEffect(() => { filtersRef.current = filters }, [filters])
        React.useEffect(() => { filterOpenRef.current = filterOpen }, [filterOpen])
        React.useEffect(() => { sortOpenRef.current = sortOpen }, [sortOpen])
        React.useEffect(() => { ctxMenuRef.current = ctxMenu }, [ctxMenu])
        React.useEffect(() => { folderMenuRef.current = folderMenu }, [folderMenu])
        React.useEffect(() => { renamingIdRef.current = renamingId }, [renamingId])
        React.useEffect(() => { folderInputOpenRef.current = folderInputOpen }, [folderInputOpen])
        React.useEffect(() => { settingsOpenRef.current = settingsOpen }, [settingsOpen])
        React.useEffect(() => { exportOpenRef.current = exportOpen }, [exportOpen])
        React.useEffect(() => { sExportOpenRef.current = sExportOpen }, [sExportOpen])
        React.useEffect(() => { importOpenRef.current = importOpen }, [importOpen])
        React.useEffect(() => { archOpenRef.current = archOpen }, [archOpen])
        React.useEffect(() => { pruneOpenRef.current = pruneOpen }, [pruneOpen])
        React.useEffect(() => { trashOpenRef.current = trashOpen }, [trashOpen])
        React.useEffect(() => { suggestOpenRef.current = suggestOpen }, [suggestOpen])
        React.useEffect(() => { injectPreviewOpenRef.current = injectPreviewOpen }, [injectPreviewOpen])
        React.useEffect(() => { mergeOpenRef.current = mergeOpen }, [mergeOpen])
        React.useEffect(() => { selModeRef.current = selMode }, [selMode])
        React.useEffect(() => { dispatchOpenRef.current = dispatchOpen }, [dispatchOpen])
        // 新建 modal 打开时自动聚焦标题输入框（Ctrl+N / 侧栏「新建」chip 均由此聚焦）
        React.useEffect(() => { if (newNoteOpen && newNoteInputRef.current) newNoteInputRef.current.focus() }, [newNoteOpen])
        // 键盘导航：j/k 或 ↑/↓ 移动高亮，Enter 打开，Esc 关闭，Ctrl+K 聚焦搜索，Ctrl+N 新建笔记
        React.useEffect(() => {
          function onKeyDown(ev) {
            if (!openRef.current) return
            const t = ev.target
            const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
            const mod = ev.ctrlKey || ev.metaKey
            // UI v2：搜索框在侧栏常显，Ctrl+K 直接聚焦（不再走展开态）
            if (mod && (ev.key === 'k' || ev.key === 'K')) { ev.preventDefault(); if (searchInputRef.current) searchInputRef.current.focus(); return }
            if (mod && (ev.key === 'n' || ev.key === 'N')) { ev.preventDefault(); openNewNoteRef.current(); return }
            // v3：Ctrl+/ 双模式切换（源码⇄富文本）；降级时 switchMode 内部拦截并 toast（弹窗打开时不切）
            if (mod && ev.key === '/') { ev.preventDefault(); if (!imgModalRef.current && !linkModalRef.current && switchModeRef.current) switchModeRef.current(editorModeRef.current === 'source' ? 'rich' : 'source'); return }
            if (ev.key === 'Escape') { ev.preventDefault(); const cm = ctxMenuRef.current; if (imgModalRef.current) { setImgModal(null); return } if (linkModalRef.current) { setLinkModal(null); return } if (renamingIdRef.current) { setRenamingId(null); return } if (folderInputOpenRef.current) { setFolderInputOpen(false); return } if (cm && cm.newFolder) { setCtxMenu({ x: cm.x, y: cm.y, note: cm.note, moveOpen: true }); return } if (folderMenuRef.current) { setFolderMenu(null); return } if (sortOpenRef.current) { setSortOpen(false); return } if (filterOpenRef.current) { setFilterOpen(false); return } if (newNoteOpenRef.current) { setNewNoteOpen(false); return } if (exportOpenRef.current) { setExportOpen(false); return } if (sExportOpenRef.current) { setSExportOpen(false); return } if (importOpenRef.current) { setImportOpen(false); return } if (pruneOpenRef.current) { setPruneOpen(false); return } if (trashOpenRef.current) { setTrashOpen(false); return } if (suggestOpenRef.current) { setSuggestOpen(false); return } if (injectPreviewOpenRef.current) { setInjectPreviewOpen(false); return } if (mergeOpenRef.current) { setMergeOpen(false); return } if (archOpenRef.current) { setArchOpen(false); return } if (settingsOpenRef.current) { setSettingsOpen(false); return } if (cm) { setCtxMenu(null); return } if (selModeRef.current) { setSelMode(false); setSelIds({}); return } if (searchRef.current) { searchRef.current = ''; setSearchText(''); setSearchIds(null); setSearchMatches({}); return } closeRef.current(); return }
            if (inField) return
            if (ctxMenuRef.current) return   // 右键菜单打开时暂停列表导航/打开
            const ids = pagedIdsRef.current
            if (!ids.length) return
            if (ev.key === 'j' || ev.key === 'ArrowDown') { ev.preventDefault(); moveFocusRef.current(ids, 1) }
            else if (ev.key === 'k' || ev.key === 'ArrowUp') { ev.preventDefault(); moveFocusRef.current(ids, -1) }
            else if (ev.key === 'Enter') {
              const fid = focusIdRef.current
              if (fid && ids.indexOf(fid) >= 0) { const n = notesRef.current.find(x => x.id === fid); if (n) selectNoteRef.current(n) }
            }
          }
          document.addEventListener('keydown', onKeyDown)
          return () => document.removeEventListener('keydown', onKeyDown)
        }, [])
        function onTitlebarMouseDown(ev) {
          if (ev.target.closest('.dsh-notes-titlebar-btn')) return
          const sx = ev.clientX, sy = ev.clientY, px = pos.x || 0, py = pos.y || 0
          drag((ev2) => setPos({ x: Math.max(0, Math.min(window.innerWidth - 200, px + ev2.clientX - sx)), y: Math.max(0, Math.min(window.innerHeight - 100, py + ev2.clientY - sy)) }), saveState)
        }
        function onResizeMouseDown(direction, ev) {
          ev.stopPropagation(); ev.preventDefault()
          const sx = ev.clientX, sy = ev.clientY, ox = pos.x || 0, oy = pos.y || 0, sw = size.width, sh = size.height
          drag((ev2) => {
            const dx = ev2.clientX - sx, dy = ev2.clientY - sy
            let nw = sw, nh = sh, nx = ox, ny = oy
            if (direction.indexOf('e') >= 0) nw = sw + dx
            if (direction.indexOf('s') >= 0) nh = sh + dy
            if (direction.indexOf('w') >= 0) nw = sw - dx
            if (direction.indexOf('n') >= 0) nh = sh - dy
            nw = Math.max(680, Math.min(window.innerWidth - 40, nw)); nh = Math.max(420, Math.min(window.innerHeight - 40, nh))
            if (direction.indexOf('w') >= 0) nx = ox + sw - nw
            if (direction.indexOf('n') >= 0) ny = oy + sh - nh
            setSize({ width: nw, height: nh }); setPos({ x: nx, y: ny })
          }, saveState)
        }
        // ===== 侧栏分隔条拖拽：mousedown 起拖 → drag() 内 document mousemove 按面板内相对坐标增量算宽 → mouseup 卸监听防泄漏 =====
        // 拖拽期间 body 挂 .dsh-notes-split-drag（禁文本选择 + 强制 col-resize）；mouseup 持久化（读 ref 防闭包过期）
        function onSplitterMouseDown(ev) {
          ev.preventDefault(); ev.stopPropagation()
          const appEl = ev.currentTarget.parentElement   // .dsh-notes-app（分隔条是两栏间的 flex 子项）
          const sx = ev.clientX, sw = sideW
          sideWRef.current = 0
          setSideDrag(true); document.body.classList.add('dsh-notes-split-drag')
          drag((ev2) => {
            const nw = clampSideW(sw + ev2.clientX - sx, appEl ? appEl.getBoundingClientRect().width : size.width)
            sideWRef.current = nw; setSideW(nw)
          }, () => {
            setSideDrag(false); document.body.classList.remove('dsh-notes-split-drag')
            if (sideWRef.current) saveSideW(sideWRef.current)
          })
        }
        // 双击分隔条 = 重置缺省宽度（清除持久化，回 styles.css 缺省 300px）
        function resetSideW() { sideWRef.current = SIDE_W_DEFAULT; setSideW(SIDE_W_DEFAULT); saveSideW(null) }
        // silent=true 时不显 loading（后台静默刷新，避免闪烁）
        async function loadNotes(silent) { if (!silent) setLoading(true); setError(''); let list = []; try { const res = await rpc('notes-list'); list = res.notes || []; setNotes(list) } catch (err) { setError(String(err.message || err)) } loadFolders(); ensureWikiIndex(list); if (!silent) setLoading(false); return list }
        // 文件夹清单（含各文件夹计数）：与列表同链路刷新（不 await，不阻塞列表链路）；
        // 文件夹异步到达后顺手清洗展开态陈旧 id（pruneFoldersExpanded：失效 id 剔除 + 空集回 null 缺省全展开）
        async function loadFolders() {
          try {
            const res = await rpc('notes-folders')
            if (res && res.folders) {
              setFolders(res.folders)
              setFoldersExpanded(prev => pruneFoldersExpanded(prev, res.folders))
            }
          } catch (err) {}
        }
        // ===== P2 笔记双链：解析 / 索引 / 跳转（内核 extractWikiTargets/wikiLinksTo 同一口径；库已在内存，host 不改）=====
        // 渲染时解析：[[n-xxx]] 精确 id 优先，其次 [[标题]] 全库标题精确匹配；均不中 → null（渲染为纯文本）
        function resolveWikiTarget(target) {
          const t = String(target || '')
          if (!t) return null
          const list = notesRef.current || []
          return list.find(n => n.id === t) || list.find(n => (n.title || '') === t) || null
        }
        // 渲染器行内扩展入参（renderMarkdown 第二参）：命中 → {id,title}（锚显示标题）；不中 → null（纯文本）
        function wikiResolve(w) { const n = resolveWikiTarget(w); return n ? { id: n.id, title: n.title || '' } : null }
        // 全库正文索引：补缺/过期（updatedAt 漂移）条目，4 路并发后台拉取；整批完成一次性推进版本号（防逐条重渲染闪烁/滚动跳动）
        function ensureWikiIndex(list) {
          const gen = ++wikiIdxGenRef.current
          const cache = wikiBodiesRef.current
          const stale = (list || []).filter(n => { const c = cache[n.id]; return !c || c.updatedAt !== (n.updatedAt || '') })
          if (!stale.length) return
          let idx = 0
          async function worker() {
            while (idx < stale.length) {
              if (gen !== wikiIdxGenRef.current) return
              const n = stale[idx++]
              try {
                const res = await rpc('notes-get', { id: n.id })
                if (gen !== wikiIdxGenRef.current) return
                if (res && res.note) cache[n.id] = { body: res.note.body || '', updatedAt: res.note.updatedAt || n.updatedAt || '' }
              } catch (err) {}
            }
          }
          Promise.all([worker(), worker(), worker(), worker()]).then(() => { if (gen === wikiIdxGenRef.current) setWikiVer(v => v + 1) }).catch(() => {})
        }
        // 单条正文写缓存（选中加载/保存后即时新鲜；updatedAt 缺省 '' → 下轮索引复核 reconcile）
        function bumpWikiBody(id, body, updatedAt) { if (!id) return; wikiBodiesRef.current[id] = { body: body || '', updatedAt: updatedAt || '' }; setWikiVer(v => v + 1) }
        // 行尾双链标记：缓存正文优先，索引未到时 preview（host slim 前 200 字符）兜底
        function hasWikiLinks(n) { const c = wikiBodiesRef.current[n.id]; return extractWikiTargets(c ? c.body : (n.preview || '')).length > 0 }
        // 双链跳转：解析 → 选中；目标被当前视图/筛选中心条件藏掉时退回「全部」（搜索词不动，保留用户上下文）
        function jumpToWikiTarget(target) {
          const n = resolveWikiTarget(target)
          if (!n) { showToast('未找到链接目标：' + target); return }
          const vis = (view.type === 'all' || (view.type === 'folder' && (n.folder || '') === view.id) || (view.type === 'topic' && (n.topic || '') === view.id))
            && matchFilters(n, filters)
          if (!vis) { setView({ type: 'all', id: '' }); setFilters(FILTERS0()) }
          selectNote(n)
        }
        function selectNote(n) {
          // 双模式：切换笔记前把富文本在途编辑序列化落回 edBody 并立即保存（防 900ms debounce 打到新笔记上）
          if (editorModeRef.current === 'rich' && richDirtyRef.current) { syncFromRich('切换笔记'); doSave() }
          // 选中笔记所在文件夹自动展开（保证选中笔记在树中可见）
          if (n.folder) expandFolder(n.folder)
          setSelected(n.id); setFocusId(n.id); setEdTitle(n.title); setEdTopic(n.topic && n.topic !== '分类中' ? n.topic : '')
          keepQuickRef.current = (n.tags || []).indexOf('quick') >= 0
          setEdTags((n.tags || []).filter(t => t !== 'quick').join(', '))
          setEdKind(n.kind || 'note'); setEdStatus(n.status || 'active'); setEdRole(n.inject ? (n.injectRole || 'convention') : 'off'); setEdScope(n.injectTo || []); setEdRecall(n.recall !== false); setEdSens(n.sensitive === true)
          setEdBody('')
          setDegraded({ ok: true, reasons: [] })   // 正文未加载前降级态复位（横幅不残留上一条笔记的分析结果）
          // 列表是瘦身数据，正文按需加载；加载期间 edLoadingRef=true，doSave 省略 body（防改名等保存把空正文写盘）
          edLoadingRef.current = true
          const id = n.id
          rpc('notes-get', { id: id }).then(res => {
            if (res && res.note && selectedRef.current === id) {
              const body = res.note.body || ''
              setEdBody(body)
              bumpWikiBody(id, body, res.note.updatedAt)   // 双链索引即时新鲜（不等后台补缺）
              // 正文到达后跑降级分析；富文本模式下新正文含白名单外语法 → 回落源码模式，否则重渲染富文本
              const a = analyzeMarkdown(body)
              setDegraded(a)
              if (editorModeRef.current === 'rich') {
                if (!a.ok) { setEditorModeState('source'); showToast('含高级语法（' + a.reasons.map(r => r.label).join('、') + '），请在源码模式编辑') }
                else { richDirtyRef.current = false; try { if (richRef.current) richRef.current.innerHTML = renderMarkdown(body, wikiResolve) } catch (err) {} }
              }
            }
            edLoadingRef.current = false
          }).catch(() => { edLoadingRef.current = false })
        }
        // 新建笔记 modal：侧栏「新建」chip / Ctrl+N 打开（清空上次标题，类型复位 note）
        function openNewNote() { setNewNoteTitle(''); setNewNoteKind('note'); setNewNotePending(false); setError(''); setNewNoteOpen(true) }
        openNewNoteRef.current = openNewNote
        // 创建流程：notes-create → 静默刷新列表 → 选中新笔记 → 聚焦正文 textarea → toast
        // 落位规则（原型 btnNew）：文件夹视图落当前文件夹；主题视图带当前主题；否则落选中笔记所在文件夹/未分类
        async function doCreateNote() {
          const title = newNoteTitle.trim()
          if (!title || newNotePending) return
          setNewNotePending(true); setError('')
          try {
            const selNote = notes.find(n => n.id === selected)
            const createFolder = view.type === 'folder' ? view.id : ((selNote && selNote.folder) || '')
            // 二期 kind 模板骨架：按所选类型预填（note=空自由格式；机器信息类由 ✨整理按内容适配，建时不预判）
            const payload = { title: title, body: KIND_TEMPLATES[newNoteKind] || '', kind: newNoteKind }
            if (createFolder) payload.folder = createFolder
            if (view.type === 'topic' && view.id) payload.topic = view.id
            const res = await rpc('notes-create', payload)
            if (res && res.error) { setError(res.error); return }
            setNewNoteOpen(false); setNewNoteTitle('')
            showToast('已创建')
            // 立即用创建返回值选中新笔记（不等列表刷新，避免列表时序影响选中链路）
            if (res && res.id) {
              selectNote({ id: res.id, title: res.title || title, topic: res.topic || payload.topic || '', kind: res.kind || 'note', status: res.status || 'active', folder: createFolder, tags: [], inject: false, injectTo: [], sensitive: false })
              setFlashId(res.id); later(() => setFlashId(null), 1800)
              // 聚焦正文：等选中态渲染出 textarea 再 focus（富文本态先切回源码态，否则没有 textarea 可聚焦）
              setEditorModeState('source')
              later(() => { try { if (edBodyDomRef.current) edBodyDomRef.current.focus() } catch (err) {} }, 300)
              later(() => { try { if (edBodyDomRef.current && document.activeElement !== edBodyDomRef.current) edBodyDomRef.current.focus() } catch (err) {} }, 700)
            }
            notifyNotesChanged()
            loadNotes(true)  // 后台刷新列表（不 await，不阻塞选中/聚焦链路）
          } catch (err) { setError(String(err.message || err)) } finally { setNewNotePending(false) }
        }
        async function doSave() {
          const id = selectedRef.current
          if (!id) return
          setError('')
          const tags = (edTagsRef.current || '').split(/[,，;；]/).map(s => s.trim()).filter(Boolean)
          if (keepQuickRef.current && tags.indexOf('quick') < 0) tags.push('quick')
          const upd = { id: id, title: edTitleRef.current, tags: tags, kind: edKindRef.current, status: edStatusRef.current, inject: edRoleRef.current !== 'off', injectTo: edScopeRef.current, recall: edRecallRef.current, sensitive: edSensRef.current === true }
          if (!edLoadingRef.current) upd.body = edBodyRef.current   // 正文加载中省略 body（host 对 undefined 保留原内容，防竞态清空正文）
          if (upd.inject) upd.injectRole = edRoleRef.current   // 非 off 才带 injectRole（off 态不带，payload 禁 undefined；host 仅 inject=true 落盘）
          if ((edTopicRef.current || '').trim()) upd.topic = edTopicRef.current.trim()
          try {
            const res = await rpc('notes-update', upd)
            if (res && res.error) { setError(res.error); return }
            setSavedAt(Date.now())
            bumpWikiBody(id, edBodyRef.current, '')   // 双链索引：自有正文即时新鲜（updatedAt 置空 → loadNotes 后索引复核 reconcile）
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        async function doDelete(id) {
          if (!id) return
          setError('')
          try {
            const res = await rpc('notes-delete', { id: id })
            if (res.error) { setError(res.error); return }
            if (selected === id) { setSelected(null); setEdTitle(''); setEdTopic(''); setEdTags(''); setEdBody('') }
            showToast('已删除（可由 Agent 恢复）')
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // ===== 二期 ✨整理：当前草稿经 notes-ai-organize（notes-quick-instruct 同款 LLM 通道）按 kind 模板结构化重写 =====
        // 契约：host 只返回重写正文不落盘；client 替换编辑器内容后走既有自动保存；原正文进一次撤销栈（toast「撤销」恢复）。
        // 容错：正文为空/加载中/整理中不重入；error 或空返回一律不动原文。
        async function doAiOrganize() {
          if (organizing) return
          if (!selectedRef.current) { showToast('先选择一条笔记'); return }
          if (edLoadingRef.current) { showToast('正文加载中，稍后再整理'); return }
          // 富文本在途编辑先序列化落回源码（整理对象是 edBody 源码文本）
          if (editorModeRef.current === 'rich' && richDirtyRef.current) syncFromRich('整理前同步')
          const body = edBodyRef.current
          if (!body || !body.trim()) { showToast('正文为空，无可整理内容'); return }
          setOrganizing(true); setError('')
          try {
            const res = await rpc('notes-ai-organize', { body: body, kind: edKindRef.current, title: edTitleRef.current })
            if (res && res.error) { showToast('整理失败：' + res.error); return }
            if (!res || !res.body || !res.body.trim()) { showToast('整理返回为空，原文未动'); return }
            organizeUndoRef.current = { body: body }   // 一次撤销栈：只保留最近一次整理前的正文
            applyOrganizedBody(res.body)
            showToast('已按「' + (KIND_LABELS[edKindRef.current] || '笔记') + '」模板整理', { label: '撤销', fn: undoAiOrganize })
          } catch (err) { showToast('整理失败：' + String(err.message || err)) } finally { setOrganizing(false) }
        }
        // 重写正文落进编辑器双模式：源码 textarea 受控随 edBody 更新；富文本重渲染内核产物（白名单外语法则回落源码模式）
        function applyOrganizedBody(text) {
          edBodyRef.current = text; setEdBody(text)
          const a = analyzeMarkdown(text)
          setDegraded(a)
          if (editorModeRef.current === 'rich') {
            if (!a.ok) setEditorModeState('source')   // 如 todo 模板含任务列表语法 → 自动落源码模式（横幅给出原因）
            else { richDirtyRef.current = false; try { if (richRef.current) richRef.current.innerHTML = renderMarkdown(text, wikiResolve) } catch (err) {} }
          }
          triggerAutoSave()   // 走既有 900ms 防抖自动保存（notes-update）
        }
        // 撤销最近一次整理（一次撤销栈，用后即清）
        function undoAiOrganize() {
          const u = organizeUndoRef.current
          if (!u) { showToast('没有可撤销的整理'); return }
          organizeUndoRef.current = null
          applyOrganizedBody(u.body)
          showToast('已恢复整理前正文')
        }
        // 笔记行右键菜单（面板内绝对定位；与文件夹菜单互斥）
        function openCtxMenu(ev, n) {
          ev.preventDefault(); ev.stopPropagation()
          const floatEl = ev.currentTarget.closest('.dsh-notes-floating')
          const rect = floatEl ? floatEl.getBoundingClientRect() : { left: 0, top: 0, width: 600, height: 500 }
          const mw = 172, mh = 148
          let x = ev.clientX - rect.left, y = ev.clientY - rect.top
          x = Math.max(4, Math.min(x, rect.width - mw - 4))
          y = Math.max(4, Math.min(y, rect.height - mh - 4))
          setCtxMenu({ x: x, y: y, note: n })
          setFolderMenu(null); setCtxNewFolderText('')   // 互斥：关文件夹菜单；清空上次的内联新建输入
          selectNote(n)
        }
        async function ctxSetStatus(n, status) {
          setCtxMenu(null); setError('')
          try {
            const res = await rpc('notes-update', { id: n.id, status: status })
            if (res && res.error) { setError(res.error); return }
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // ===== 虚拟文件夹树交互：折叠切换/自动展开/新建/重命名/删除/排序 + 笔记移动（管理走 notes-folders RPC，移动走 notes-update 的 folder 字段）=====
        // 折叠判定：foldersExpanded=null 表示缺省全展开；否则数组为展开中的 id 集合（含置顶组 PINNED_KEY）
        function isFolderExpanded(id) { return foldersExpanded === null ? true : foldersExpanded.indexOf(id) >= 0 }
        // 折叠/展开切换（缺省全展开时先物化全量展开集合再切换，保证其余文件夹保持展开）
        function toggleFolder(id) {
          setFoldersExpanded(prev => {
            const base = prev === null ? folders.map(f => f.id).concat([PINNED_KEY]) : prev
            const next = base.indexOf(id) >= 0 ? base.filter(x => x !== id) : base.concat([id])
            saveFoldersExpanded(next)
            return next
          })
        }
        // 主题过滤行原地展开切换（与文件夹 toggleFolder 同义「点哪个展开哪个」；不持久化）
        function toggleTopicExpanded(tn) { setTopicExpanded(prev => { const next = Object.assign({}, prev); next[tn] = !next[tn]; return next }) }
        // 自动展开目标文件夹（选中笔记/新建文件夹/移入笔记时调用；已展开或缺省全展开时不动）
        function expandFolder(id) {
          if (!id) return
          setFoldersExpanded(prev => {
            if (prev === null || prev.indexOf(id) >= 0) return prev
            const next = prev.concat([id])
            saveFoldersExpanded(next)
            return next
          })
        }
        // 文件夹项右键菜单：与笔记行菜单同坐标换算（面板内绝对定位；两菜单互斥）
        function openFolderMenu(ev, f) {
          ev.preventDefault(); ev.stopPropagation()
          const floatEl = ev.currentTarget.closest('.dsh-notes-floating')
          const rect = floatEl ? floatEl.getBoundingClientRect() : { left: 0, top: 0, width: 600, height: 500 }
          const mw = 190, mh = 190
          let x = ev.clientX - rect.left, y = ev.clientY - rect.top
          x = Math.max(4, Math.min(x, rect.width - mw - 4))
          y = Math.max(4, Math.min(y, rect.height - mh - 4))
          setFolderMenu({ x: x, y: y, folder: f })
          setCtxMenu(null)
        }
        // 文件夹分组头 ＋ → 内联输入：Enter 提交（空串=取消）；建成即展开该文件夹并进入文件夹视图
        async function doCreateFolder() {
          const name = folderInputText.trim()
          if (!name) { setFolderInputOpen(false); return }
          setFolderInputOpen(false); setFolderInputText(''); setError('')
          try {
            const res = await rpc('notes-folders', { op: 'create', name: name })
            if (res && res.error) { setError(res.error); return }
            showToast('已建文件夹「' + name + '」')
            if (res.folder && res.folder.id) { expandFolder(res.folder.id); setView({ type: 'folder', id: res.folder.id }) }
            await loadFolders()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 栏内内联重命名：Enter 提交 / Esc 或失焦取消；名字未变时不发 RPC
        async function doRenameFolder() {
          const id = renamingId, name = renameText.trim()
          setRenamingId(null)
          if (!id || !name) return
          const cur = folders.find(f => f.id === id)
          if (cur && cur.name === name) return
          setError('')
          try {
            const res = await rpc('notes-folders', { op: 'rename', id: id, name: name })
            if (res && res.error) { setError(res.error); return }
            showToast('已重命名为「' + name + '」')
            await loadFolders()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 右键删除：确认后删清单（其下笔记由 host 回退未分类）；展开态残留由 loadFolders 清理
        async function doDeleteFolder(f) {
          setFolderMenu(null)
          if (!window.confirm('删除文件夹「' + f.name + '」？其下 ' + (f.count || 0) + ' 条笔记将移回未分类。')) return
          setError('')
          try {
            const res = await rpc('notes-folders', { op: 'delete', id: f.id })
            if (res && res.error) { setError(res.error); return }
            showToast('已删除文件夹「' + f.name + '」')
            if (view.type === 'folder' && view.id === f.id) setView({ type: 'all', id: '' })
            await loadFolders(); await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 右键上移/下移：按当前顺序换位后整体提交 reorder（ids 全量，host 归一化 order）
        async function doReorderFolder(f, delta) {
          setFolderMenu(null)
          const ids = folders.map(x => x.id)
          const i = ids.indexOf(f.id)
          const j = i + delta
          if (i < 0 || j < 0 || j >= ids.length) return
          ids.splice(i, 1); ids.splice(j, 0, f.id)
          setError('')
          try {
            const res = await rpc('notes-folders', { op: 'reorder', ids: ids })
            if (res && res.error) { setError(res.error); return }
            await loadFolders()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 笔记行右键「移动到文件夹」：notes-update 只改 folder 字段；'' = 移出到未分类
        async function ctxMoveToFolder(n, folderId) {
          setCtxMenu(null); setCtxNewFolderText(''); setError('')
          const fname = folderId ? ((folders.find(f => f.id === folderId) || {}).name || '') : ''
          try {
            const res = await rpc('notes-update', { id: n.id, folder: folderId })
            if (res && res.error) { setError(res.error); return }
            showToast(folderId ? '已移动到「' + fname + '」' : '已移出文件夹')
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // ===== 拖拽挪入/挪出文件夹（HTML5 DnD；与右键「移动到文件夹」共用 ctxMoveToFolder 移动逻辑）=====
        // dragstart：noteId 记到 ref + dataTransfer（Firefox 需 setData 才能起拖），源行加 .dragging 半透明
        function onNoteDragStart(ev, n) {
          if (selModeRef.current) { ev.preventDefault(); return }   // 多选态禁用拖拽（点击=勾选，不挪文件夹）
          dragNoteIdRef.current = n.id
          try { ev.dataTransfer.setData('text/dsh-note-id', n.id); ev.dataTransfer.effectAllowed = 'move' } catch (err) {}
          try { ev.currentTarget.classList.add('dragging') } catch (err) {}
        }
        // dragend 兜底清理：无论 drop 成功与否（含拖到面板外），摘掉 .dragging 与面板内所有残留 .drop-hint
        function onNoteDragEnd(ev) {
          dragNoteIdRef.current = null
          try { ev.currentTarget.classList.remove('dragging') } catch (err) {}
          try { const els = document.querySelectorAll('.dsh-notes-floating .drop-hint'); for (let i = 0; i < els.length; i++) els[i].classList.remove('drop-hint') } catch (err) {}
        }
        // 文件夹行 drop 目标：仅本插件笔记拖拽（ref 有值）才接管——dragover preventDefault + .drop-hint 高亮；非法目标不高亮不 preventDefault（浏览器显示禁止光标，drop 无动作）
        function onFolderDragOver(ev) {
          if (!dragNoteIdRef.current) return
          ev.preventDefault()
          try { ev.dataTransfer.dropEffect = 'move' } catch (err) {}
          ev.currentTarget.classList.add('drop-hint')
        }
        function onFolderDragLeave(ev) { ev.currentTarget.classList.remove('drop-hint') }
        // drop 到文件夹行 = 移入该夹（已在该夹则静默无动作，不重复弹 toast）
        function onFolderDrop(ev, f) {
          if (!dragNoteIdRef.current) return
          ev.preventDefault()
          ev.currentTarget.classList.remove('drop-hint')
          const id = dragNoteIdRef.current
          const noteObj = notes.find(x => x.id === id)
          if (noteObj && (noteObj.folder || '') !== f.id) ctxMoveToFolder({ id: id }, f.id)
        }
        // 未分类区 drop 目标：拖入本区 = 移出文件夹（仅对当前在文件夹内的笔记生效；已未分类则静默）
        function onUnfiledDragOver(ev) {
          if (!dragNoteIdRef.current) return
          ev.preventDefault()
          try { ev.dataTransfer.dropEffect = 'move' } catch (err) {}
          ev.currentTarget.classList.add('drop-hint')
        }
        function onUnfiledDragLeave(ev) { ev.currentTarget.classList.remove('drop-hint') }
        function onUnfiledDrop(ev) {
          if (!dragNoteIdRef.current) return
          ev.preventDefault()
          ev.currentTarget.classList.remove('drop-hint')
          const id = dragNoteIdRef.current
          const noteObj = notes.find(x => x.id === id)
          if (noteObj && (noteObj.folder || '')) ctxMoveToFolder({ id: id }, '')
        }
        // 笔记行右键「新建文件夹…」：建文件夹并把笔记移入（不切换当前视图）
        async function ctxCreateFolderMove(n) {
          const name = ctxNewFolderText.trim()
          if (!name) return
          setError('')
          try {
            const res = await rpc('notes-folders', { op: 'create', name: name })
            if (res && res.error) { setError(res.error); return }
            setCtxNewFolderText('')
            if (res.folder && res.folder.id) {
              expandFolder(res.folder.id)
              const u = await rpc('notes-update', { id: n.id, folder: res.folder.id })
              if (u && u.error) { setError(u.error); return }
              showToast('已移动到「' + res.folder.name + '」')
            }
            setCtxMenu(null)
            await loadFolders(); await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 点击菜单外部关闭（Esc 在全局 keydown 里处理）
        React.useEffect(() => {
          if (!ctxMenu) return
          const onDown = (ev) => { if (!(ev.target && ev.target.closest && ev.target.closest('.dsh-notes-ctxmenu'))) setCtxMenu(null) }
          document.addEventListener('mousedown', onDown)
          return () => document.removeEventListener('mousedown', onDown)
        }, [ctxMenu])
        // 文件夹右键菜单：点击菜单外部关闭（与笔记行菜单共用 .dsh-notes-ctxmenu 样式）
        React.useEffect(() => {
          if (!folderMenu) return
          const onDown = (ev) => { if (!(ev.target && ev.target.closest && ev.target.closest('.dsh-notes-ctxmenu'))) setFolderMenu(null) }
          document.addEventListener('mousedown', onDown)
          return () => document.removeEventListener('mousedown', onDown)
        }, [folderMenu])
        function close() { panelOpen = false; notify() }
        function jumpToSession(sessionId) { if (sessions && sessionId) { try { sessions.open(sessionId) } catch (err) {} } }
        // 注入三态切换：独立字段 inject + injectRole（off→inject:false；约定/资料→inject:true+injectRole），不碰标签
        // off→非off 时自动展开范围浮层（与原 toggle 开启行为一致）；切到 off 收起浮层
        function setRoleSeg(r) {
          if (r === edRole) return
          const wasOff = edRole === 'off'
          setEdRole(r)
          if (r === 'off') setScopeOpen(false)
          else if (wasOff) setScopeOpen(true)
          triggerAutoSave()
        }
        // 目录可见开关：独立字段 recall（缺省 true=进目录；false 逐条排除，与 inject 正交）
        function toggleRecall() { setEdRecall(!edRecall); triggerAutoSave() }
        // 敏感开关：独立字段 sensitive（缺省 false；开启后注入系统提示时正文按行打码，键保留值遮蔽，Agent 用 note_get 取原文）
        function toggleSens() { setEdSens(!edSens); triggerAutoSave() }
        // 范围多选：切换某个会话短 id 的选中态（缺省=所有会话；存量 'global'/'workspace' 值在首次勾选时规范化掉，host 端仍容错）
        function toggleScope(key) {
          const cur = (edScopeRef.current || []).filter(t => t !== 'global' && t !== 'workspace')
          const next = cur.indexOf(key) >= 0 ? cur.filter(t => t !== key) : cur.concat([key])
          setEdScope(next)
          triggerAutoSave()
        }
        // ===== 双模式编辑器 v3：模式切换 / 序列化同步 / 工具栏 / 图片三入口（规格：design/notes-editor-v3.html）=====
        const switchModeRef = React.useRef(null)   // 全局 keydown（闭包挂一次）经 ref 调最新 switchMode
        // 模式切换（原型 setMode）：进富文本前跑降级分析；离开富文本先把在途编辑序列化落回源码
        function switchMode(m) {
          if (m === editorModeRef.current) return
          if (m === 'rich') {
            const a = analyzeMarkdown(edBodyRef.current)
            setDegraded(a)
            if (!a.ok) { showToast('含高级语法（' + a.reasons.map(r => r.label).join('、') + '），请在源码模式编辑'); return }
            richDirtyRef.current = false
            setEditorModeState('rich')
          } else {
            if (richDirtyRef.current) syncFromRich('切换模式')
            setEditorModeState('source')
          }
        }
        // 富文本 → 源码序列化（原型 syncFromRich）：内容无损最高优先——序列化结果有变化才写 edBody 并走既有 doSave 自动保存
        function syncFromRich(why) {
          const el = richRef.current
          if (!el || editorModeRef.current !== 'rich') return
          const md2 = serializeRich(el)
          richDirtyRef.current = false
          setRichSyncing(false)
          if (md2 !== edBodyRef.current) { edBodyRef.current = md2; setEdBody(md2); triggerAutoSave() }
        }
        // 富文本编辑防抖：900ms 未输入即序列化回源码（IME 组合输入期间绝不序列化）
        function scheduleRichSync() {
          if (composingRef.current) return
          if (richSyncTimerRef.current) { try { richSyncTimerRef.current() } catch (err) {} }
          richSyncTimerRef.current = later(() => { richSyncTimerRef.current = null; if (richDirtyRef.current) syncFromRich('防抖') }, 900)
        }
        // 源码模式编辑后 450ms 防抖降级分析（原型 onSourceInput）：降级态翻转时 toast 告知
        function scheduleDegAnalyze() {
          if (degTimerRef.current) { try { degTimerRef.current() } catch (err) {} }
          degTimerRef.current = later(() => {
            degTimerRef.current = null
            const a = analyzeMarkdown(edBodyRef.current)
            const was = degradedRef.current.ok
            setDegraded(a)
            if (was !== a.ok) showToast(a.ok ? '富文本模式已恢复可用' : '检测到白名单外语法 → 富文本入口置灰')
          }, 450)
        }
        // 富文本选区缓存/恢复（工具栏 mousedown 阻止默认保住选区；弹窗关闭后恢复）
        function keepSel() { const sel = window.getSelection(); if (sel && sel.rangeCount > 0) { try { savedRangeRef.current = sel.getRangeAt(0).cloneRange() } catch (err) {} } }
        function restoreSel() {
          const sel = window.getSelection(); if (!sel) return
          sel.removeAllRanges()
          if (savedRangeRef.current) { try { sel.addRange(savedRangeRef.current); return } catch (err) {} }
          const r = document.createRange(); const el = richRef.current
          if (el) { r.selectNodeContents(el); r.collapse(false); sel.addRange(r) }
        }
        // 富文本工具栏（原型 toolbarAction）：execCommand 语义标签（styleWithCSS:false → <b>/<i>，序列化器可识别）
        function toolbarAction(a) {
          restoreSel()
          const el = richRef.current; if (el) el.focus()
          if (a === 'bold') document.execCommand('bold')
          else if (a === 'italic') document.execCommand('italic')
          else if (a === 'ul') document.execCommand('insertUnorderedList')
          else if (a === 'ol') document.execCommand('insertOrderedList')
          else if (a === 'quote') document.execCommand('formatBlock', false, 'blockquote')
          else if (a === 'code') {
            const sel = window.getSelection(), txt = sel && !sel.isCollapsed ? String(sel) : ''
            if (!txt) { showToast('先选中要设为行内码的文字'); return }
            document.execCommand('insertHTML', false, '<code>' + esc(txt) + '</code>')
          }
          else if (a === 'link') {
            const sel2 = window.getSelection()
            if (!sel2 || sel2.isCollapsed) { showToast('先选中要加链接的文字'); return }
            keepSel(); setLinkModal({ text: String(sel2), url: 'https://' }); return
          }
          else if (a === 'image') { keepSel(); openImgModal(null); return }
          keepSel(); richDirtyRef.current = true; scheduleRichSync(); updateToolbarState()
        }
        // 工具栏激活态（原型 updateToolbarState）：直接拨 className，不走 React setState（selectionchange 高频）
        function updateToolbarState() {
          const wrap = richWrapRef.current
          if (!wrap || editorModeRef.current !== 'rich') return
          const map = { bold: 'bold', italic: 'italic', ul: 'insertUnorderedList', ol: 'insertOrderedList' }
          const btns = wrap.querySelectorAll('.dsh-notes-rtb-btn')
          for (let i = 0; i < btns.length; i++) {
            const b = btns[i], a = b.getAttribute('data-a')
            let on = false
            try { if (map[a]) on = document.queryCommandState(map[a]) } catch (err) {}
            if (a === 'quote' || a === 'code') {
              const sel = window.getSelection()
              let n = sel && sel.rangeCount ? sel.anchorNode : null
              if (n && n.nodeType === 3) n = n.parentNode
              on = !!(n && n.closest && n.closest(a === 'quote' ? 'blockquote' : 'code'))
            }
            b.classList.toggle('on', !!on)
          }
        }
        // 富文本粘贴 HTML 白名单清洗插入（原型 insertSanitizedHtml；清洗规则见内核 sanitizeFragment）
        function insertSanitizedHtml(html) {
          const doc = new DOMParser().parseFromString(html, 'text/html')
          const clean = sanitizeFragment(doc.body)
          const sel = window.getSelection()
          if (sel && sel.rangeCount) {
            const r = sel.getRangeAt(0); r.deleteContents()
            const frag = document.createDocumentFragment()
            let n; const nodes = []
            while ((n = clean.firstChild)) nodes.push(n)
            nodes.forEach(x => frag.appendChild(x))
            r.insertNode(frag)
          }
          richDirtyRef.current = true; scheduleRichSync()
        }
        // ---- 二期 图片压缩：>1MB 的 PNG/JPEG 上传前前端 canvas 降质转 JPEG（GIF/WebP 不动，保动画/透明语义）----
        // 策略：长边封顶 2560px → 质量阶梯 0.85→0.45 逐档试；仍超 1MB 则长边 0.8 递减（下限 800px）；
        // PNG 透明底刷白（JPEG 无 alpha）；任何一步失败 → cb(null) 回退原图上传。压缩产物 <1MB 即收。
        const IMG_COMPRESS_THRESHOLD = 1024 * 1024
        function compressImageData(dataURL, cb) {
          try {
            const img = new Image()
            img.onload = () => {
              try {
                let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
                if (!w || !h) { cb(null); return }
                const MAX_DIM = 2560
                if (Math.max(w, h) > MAX_DIM) { const r = MAX_DIM / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r) }
                const canvas = document.createElement('canvas')
                const c2d = canvas.getContext('2d')
                if (!c2d) { cb(null); return }
                const qs = [0.85, 0.75, 0.65, 0.55, 0.45]
                let out = '', bytes = 0, round = 0
                while (round < 8) {
                  canvas.width = w; canvas.height = h
                  c2d.fillStyle = '#ffffff'; c2d.fillRect(0, 0, w, h)
                  c2d.drawImage(img, 0, 0, w, h)
                  out = canvas.toDataURL('image/jpeg', qs[Math.min(round, qs.length - 1)])
                  bytes = Math.max(0, Math.round((out.length - 23) * 3 / 4))   // 去掉 data:image/jpeg;base64, 头估算字节
                  if (bytes <= IMG_COMPRESS_THRESHOLD) { cb({ dataURL: out, bytes: bytes }); return }
                  round++
                  if (round >= qs.length && (w > 800 || h > 800)) { w = Math.max(800, Math.round(w * 0.8)); h = Math.max(800, Math.round(h * 0.8)); round = qs.length - 1 }
                }
                cb(out ? { dataURL: out, bytes: bytes } : null)   // 兜底：尽力压缩产物（可能仍 >1MB，5MB 上限内可用）
              } catch (err) { cb(null) }
            }
            img.onerror = () => cb(null)
            img.src = dataURL
          } catch (err) { cb(null) }
        }
        // 图片文件校验 + 读 dataURL → 打开插入弹窗（mime 白名单 png/jpeg/gif/webp、≤5MB，与 host 口径一致）
        // 二期：>1MB 的 PNG/JPEG 先走 compressImageData 压缩转 JPEG 再进弹窗（弹窗大小行显示「已压缩 原 → 现」）
        function pickImageFile(f) {
          if (!f) return
          const MIME_OK = { 'image/png': 1, 'image/jpeg': 1, 'image/gif': 1, 'image/webp': 1 }
          if (!MIME_OK[f.type]) { showToast('仅支持 PNG/JPEG/GIF/WebP 图片'); return }
          if (f.size > 5 * 1024 * 1024) { showToast('图片超过 5MB 上限'); return }
          const rd = new FileReader()
          rd.onload = () => {
            const base = { name: f.name || ('pasted-' + Date.now() + '.png'), dataURL: String(rd.result), mime: f.type, size: f.size, alt: (f.name || '').replace(/\.[^.]+$/, ''), uploading: false, error: '' }
            if (f.size > IMG_COMPRESS_THRESHOLD && (f.type === 'image/png' || f.type === 'image/jpeg')) {
              compressImageData(base.dataURL, (res) => {
                if (res && res.dataURL) setImgModal(Object.assign({}, base, { name: base.name.replace(/\.[^.]+$/, '') + '.jpg', dataURL: res.dataURL, mime: 'image/jpeg', size: res.bytes, origSize: f.size }))
                else setImgModal(base)   // 压缩失败回退原图（不阻塞上传）
              })
            } else setImgModal(base)
          }
          rd.onerror = () => showToast('图片读取失败')
          rd.readAsDataURL(f)
        }
        // 图片入口③：工具栏按钮 → 弹窗选文件（draft=null 时打开空弹窗）
        function openImgModal(draft) { setImgModal(draft || { name: '', dataURL: '', mime: '', size: 0, alt: '', uploading: false, error: '' }) }
        // 上传并插入：notes-asset-upload RPC → assets/<ts>-<安全名>；成功 → 光标处插入 ![](assets/…)；失败留在弹窗内报错可重试 + toast
        function doUploadImage() {
          const m = imgModalRef.current
          if (!m || !m.dataURL || m.uploading) return
          setImgModal(Object.assign({}, m, { uploading: true, error: '' }))
          rpc('notes-asset-upload', { name: m.name, data: m.dataURL, mime: m.mime }).then(res => {
            if (res && res.error) {
              showToast('图片上传失败：' + res.error)
              const cur = imgModalRef.current
              if (cur) setImgModal(Object.assign({}, cur, { uploading: false, error: res.error }))
              return
            }
            const file = res && res.file
            if (!file) {
              const cur2 = imgModalRef.current
              if (cur2) setImgModal(Object.assign({}, cur2, { uploading: false, error: '上传返回异常（缺 file 字段）' }))
              return
            }
            const alt = (m.alt || '').trim()
            setImgModal(null)
            insertImageMd(file, alt)
            showToast('已插入图片：' + file)
          }).catch(err => {
            showToast('图片上传失败：' + String(err.message || err))
            const cur = imgModalRef.current
            if (cur) setImgModal(Object.assign({}, cur, { uploading: false, error: String(err.message || err) }))
          })
        }
        // 光标处插入图片（原型 applyInsertImage）：源码模式插 Markdown 文本，富文本模式插 img 节点（随后序列化同步回源码）
        function insertImageMd(mdSrc, alt) {
          if (editorModeRef.current === 'rich') {
            restoreSel()
            const el = richRef.current; if (!el) return
            el.focus()
            const img = document.createElement('img')
            img.src = assetDisplaySrc(mdSrc); img.setAttribute('data-md-src', mdSrc); img.alt = alt
            const sel = window.getSelection(), range = sel && sel.rangeCount ? sel.getRangeAt(0) : null
            let blk = range ? range.startContainer : null
            if (blk && blk.nodeType === 3) blk = blk.parentNode
            const p = blk && blk.closest ? blk.closest('p') : null
            if (p && !p.textContent.trim() && !p.querySelector('img')) p.appendChild(img)   // 空段落 → 直接放入
            else if (range) { range.deleteContents(); range.insertNode(img) }               // 光标处内联插入
            else el.appendChild(img)
            richDirtyRef.current = true
            syncFromRich('插入图片')
          } else {
            const ta = edBodyDomRef.current
            const cur = edBodyRef.current
            const pos = ta && ta.selectionStart != null ? ta.selectionStart : cur.length
            const ins = '![' + alt + '](' + mdSrc + ')'
            const next = cur.slice(0, pos) + ins + cur.slice(pos)
            edBodyRef.current = next; setEdBody(next); triggerAutoSave(); scheduleDegAnalyze()
            later(() => { try { const t2 = edBodyDomRef.current; if (t2) { t2.focus(); t2.setSelectionRange(pos + ins.length, pos + ins.length) } } catch (err) {} }, 60)
          }
        }
        // 链接弹窗确认（原型 openLinkModal 的确定分支）：仅 http/https
        function doInsertLink() {
          const m = linkModalRef.current
          const url = m ? String(m.url || '').trim() : ''
          if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) { showToast('仅支持 http/https 链接'); return }
          setLinkModal(null)
          restoreSel()
          const el = richRef.current; if (el) el.focus()
          document.execCommand('createLink', false, url)
          keepSel(); richDirtyRef.current = true; scheduleRichSync()
        }
        // 进入富文本 / 切换笔记：渲染内核产物进 contenteditable + 绑定编辑事件（编辑期间不重渲染，防 IME 打断）
        React.useEffect(() => {
          if (editorMode !== 'rich') return
          const el = richRef.current, wrap = richWrapRef.current
          if (!el || !wrap) return
          if (!richDirtyRef.current) el.innerHTML = renderMarkdown(edBodyRef.current, wikiResolve)
          try { document.execCommand('styleWithCSS', false, false) } catch (err) {}
          const onInput = () => { richDirtyRef.current = true; setRichSyncing(true); scheduleRichSync(); keepSel() }
          const onCompStart = () => { composingRef.current = true; if (richSyncTimerRef.current) { try { richSyncTimerRef.current() } catch (e2) {} richSyncTimerRef.current = null } }
          const onCompEnd = () => { composingRef.current = false; richDirtyRef.current = true; setRichSyncing(true); scheduleRichSync() }
          const onBlur = () => { if (richDirtyRef.current) syncFromRich('失焦') }
          const onKeyUp = () => updateToolbarState()
          const onMouseUp = () => { keepSel(); updateToolbarState() }
          const onSelChange = () => { const sel = window.getSelection(); if (sel && sel.rangeCount && el.contains(sel.anchorNode)) { keepSel(); updateToolbarState() } }
          // P2 双链：富文本内点击 [[..]] 锚 → 跳转选中目标笔记（阻止默认 #wiki 哈希跳转；跳前序列化在途编辑落回源码）
          // L2 只读表格：点击表格区块 → toast 提示（contenteditable=false 原子岛屿，富文本内不做表格编辑）
          const onWikiClick = (ev) => {
            const a = ev.target && ev.target.closest ? ev.target.closest('a[data-wiki]') : null
            if (a && el.contains(a)) {
              ev.preventDefault(); ev.stopPropagation()
              if (jumpWikiRef.current) jumpWikiRef.current(a.getAttribute('data-wiki') || '')
              return
            }
            const tb = ev.target && ev.target.closest ? ev.target.closest('table.dsh-notes-table') : null
            if (tb && el.contains(tb)) showToast('表格为只读，请切换源码模式编辑该区域')
          }
          // 图片入口①：Ctrl+V 粘贴（clipboardData.files）；其余粘贴：HTML → 白名单清洗，纯文本 → 纯文本插入
          const onPaste = (ev) => {
            const cd = ev.clipboardData
            // 注：mime 判定用 indexOf 而非正则 /^image\//——build-dist 抽取器不识正则字面量，`\/`+`/` 相邻会被误当行注释
            if (cd && cd.files && cd.files.length && cd.files[0].type.indexOf('image/') === 0) {
              ev.preventDefault(); keepSel(); pickImageFile(cd.files[0]); return
            }
            const html = cd ? cd.getData('text/html') : ''
            if (html) { ev.preventDefault(); insertSanitizedHtml(html); return }
            const txt = cd ? cd.getData('text/plain') : ''
            if (txt) { ev.preventDefault(); document.execCommand('insertText', false, txt) }
          }
          // 图片入口②：拖拽文件进富文本
          const onDragOver = (ev) => { ev.preventDefault(); wrap.classList.add('drop') }
          const onDragLeave = () => wrap.classList.remove('drop')
          const onDrop = (ev) => {
            ev.preventDefault(); wrap.classList.remove('drop')
            const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]
            if (!f) return
            if (!f.type || f.type.indexOf('image/') !== 0) { showToast('仅支持图片文件'); return }
            keepSel(); pickImageFile(f)
          }
          el.addEventListener('input', onInput)
          el.addEventListener('compositionstart', onCompStart)
          el.addEventListener('compositionend', onCompEnd)
          el.addEventListener('blur', onBlur)
          el.addEventListener('keyup', onKeyUp)
          el.addEventListener('mouseup', onMouseUp)
          el.addEventListener('paste', onPaste)
          el.addEventListener('click', onWikiClick)
          wrap.addEventListener('dragover', onDragOver)
          wrap.addEventListener('dragleave', onDragLeave)
          wrap.addEventListener('drop', onDrop)
          document.addEventListener('selectionchange', onSelChange)
          return () => {
            el.removeEventListener('input', onInput)
            el.removeEventListener('compositionstart', onCompStart)
            el.removeEventListener('compositionend', onCompEnd)
            el.removeEventListener('blur', onBlur)
            el.removeEventListener('keyup', onKeyUp)
            el.removeEventListener('mouseup', onMouseUp)
            el.removeEventListener('paste', onPaste)
            el.removeEventListener('click', onWikiClick)
            wrap.removeEventListener('dragover', onDragOver)
            wrap.removeEventListener('dragleave', onDragLeave)
            wrap.removeEventListener('drop', onDrop)
            document.removeEventListener('selectionchange', onSelChange)
          }
        }, [editorMode, selected])
        // 任务派发：加载活跃会话/工作区 + 打开对话框 + 确认派发
        // 0.1.7 首屏提速：host 对缓存未命中会话先返回占位（titlesPending + pendingSessions），对话框立即渲染
        // （占位条目显示「短id · 标题加载中…」）；仍 pending 则 1.5s 轮询重拉，直到标题补齐或对话框关闭。
        async function loadActiveSessions() {
          try {
            const res = await rpc('notes-active-sessions', {})
            if (!res) return
            if (res.sessions) setActiveSessions(res.sessions)
            setDispatchPending(res.titlesPending && Array.isArray(res.pendingSessions) ? res.pendingSessions : [])
            if (res.titlesPending && dispatchOpenRef.current) later(loadActiveSessions, 1500)
          } catch (e) {}
        }
        async function loadWorkspaces() {
          try { const res = await rpc('notes-workspaces', {}); if (res && res.workspaces) setWsList(res.workspaces) } catch (e) {}
        }
        function openDispatch() {
          setDispatchInstr(''); setDispatchSessId(''); setDispatchSessWs(''); setDispatchWsId(''); setDispatchMode('existing'); setError('')
          loadActiveSessions(); loadWorkspaces(); setDispatchOpen(true)
        }
        // 设置卡片：打开即拉取 settings + 可用模型列表（host 探 llm 服务目录；探不到时 models=[]，控件退化为手输）
        function openSettings() {
          setSetLlmProvider(''); setSetLlmModel(''); setSettingsData(null); setError(''); setSettingsOpen(true)
          rpc('notes-settings-get', {}).then(res => {
            if (!res) return
            setSettingsData(res)
            const l = res.settings && res.settings.llm
            if (l && l.provider && l.model) { setSetLlmProvider(l.provider); setSetLlmModel(l.model) }
            setSetCatalog(!res.settings || res.settings.catalogEnabled !== false)   // 目录注入总开关：缺省开
            setSetStale(String(res.settings && typeof res.settings.staleDays === 'number' ? res.settings.staleDays : 90))   // 时效提醒阈值：缺省 90
            setSetBudget(String(res.settings && typeof res.settings.injectBudgetChars === 'number' ? res.settings.injectBudgetChars : 0))   // 注入预算：缺省 0=不限
          }).catch(() => {})
        }
        // 选择即保存：llm=null 恢复跟随当前会话（默认）；否则保存 { provider, model }
        function saveSettingsLlm(llm) {
          rpc('notes-settings-set', { llm: llm }).then(res => {
            if (res && res.error) { setError(res.error); return }
            if (res && res.settings) setSettingsData(prev => Object.assign({}, prev || {}, { settings: res.settings }))
            showToast(llm ? ('已保存：笔记 LLM = ' + llm.provider + ' / ' + llm.model) : '已恢复跟随当前会话（默认）')
          }).catch(err => setError(String(err.message || err)))
        }
        // 目录注入总开关：勾选即保存（只传布尔 catalogEnabled；host 侧 null 才是恢复默认开，这里不用）
        function saveSettingsCatalog(enabled) {
          rpc('notes-settings-set', { catalogEnabled: enabled }).then(res => {
            if (res && res.error) { setError(res.error); return }
            if (res && res.settings) setSettingsData(prev => Object.assign({}, prev || {}, { settings: res.settings }))
            showToast(enabled ? '已开启笔记目录注入' : '已关闭笔记目录注入')
          }).catch(err => setError(String(err.message || err)))
        }
        // P1 时效衰减提醒阈值：失焦/Enter 即保存（非负整数；0 = 关闭；非法输入报错不落盘）
        function saveSettingsStale() {
          const raw = setStale.trim()
          if (!/^\d+$/.test(raw)) { setError('时效提醒阈值需为非负整数（0 = 关闭）'); return }
          const v = parseInt(raw, 10)
          rpc('notes-settings-set', { staleDays: v }).then(res => {
            if (res && res.error) { setError(res.error); return }
            if (res && res.settings) setSettingsData(prev => Object.assign({}, prev || {}, { settings: res.settings }))
            showToast(v === 0 ? '已关闭时效衰减提醒' : '已保存：超过 ' + v + ' 天未更新的资料将在目录标注 ⚠')
          }).catch(err => setError(String(err.message || err)))
        }
        // P1 注入体积预算（约，字符数）：失焦/Enter 即保存（非负整数；0 = 不限；约定条目永不截断）
        function saveSettingsBudget() {
          const raw = setBudget.trim()
          if (!/^\d+$/.test(raw)) { setError('注入体积预算需为非负整数（0 = 不限）'); return }
          const v = parseInt(raw, 10)
          rpc('notes-settings-set', { injectBudgetChars: v }).then(res => {
            if (res && res.error) { setError(res.error); return }
            if (res && res.settings) setSettingsData(prev => Object.assign({}, prev || {}, { settings: res.settings }))
            showToast(v === 0 ? '已关闭注入体积预算（不限）' : '已保存：注入预算约 ' + v + ' 字符')
          }).catch(err => setError(String(err.message || err)))
        }
        // 手输模式（探不到模型列表时）：provider/model 两框齐备才保存；清除按钮恢复跟随会话
        function saveSettingsLlmManual() {
          const p = setLlmProvider.trim(), m = setLlmModel.trim()
          if (!p || !m) return
          saveSettingsLlm({ provider: p, model: m })
        }
        // ===== 数据导入/导出（设置卡片「数据」区入口）=====
        // 导出：打开对话框时回填上次导出目录（localStorage 记忆）；确认 → notes-export → toast 含快照目录路径
        function openExport() {
          let last = ''
          try { last = localStorage.getItem('dsh-notes-last-export-dir') || '' } catch (err) {}
          setExportDir(last); setExportPending(false); setError('')
          setSettingsOpen(false); setExportOpen(true)   // 与设置卡片互斥：modal 不叠 modal
        }
        async function doExport() {
          const dir = exportDir.trim()
          if (!dir || exportPending) return
          setExportPending(true); setError('')
          try {
            const res = await rpc('notes-export', { dir: dir })   // payload 不传 undefined 字段
            if (res && res.error) { setError(res.error); return }
            try { localStorage.setItem('dsh-notes-last-export-dir', dir) } catch (err) {}
            setExportOpen(false)
            showToast('已导出 ' + (res.exported || 0) + ' 条笔记到 ' + (res.target || dir))
          } catch (err) { setError(String(err.message || err)) } finally { setExportPending(false) }
        }
        // P3 单文件导出（设置卡片「数据」区入口；复用导出 modal 模式）：选 scope（全部/文件夹/标签）+ 目录 → notes-export-single → toast 含文件路径（>20MB 带 warning）
        function openSExport() {
          let last = ''
          try { last = localStorage.getItem('dsh-notes-last-export-single-dir') || '' } catch (err) {}
          setSExportDir(last); setSExportScope('all'); setSExportFolder(''); setSExportTag(''); setSExportToc(true); setSExportPending(false); setError('')
          setSettingsOpen(false); setSExportOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入同款）
        }
        async function doSExport() {
          const dir = sExportDir.trim()
          if (!dir || sExportPending) return
          if (sExportScope === 'folder' && !sExportFolder) { setError('请选择文件夹'); return }
          if (sExportScope === 'tag' && !sExportTag) { setError('请选择标签'); return }
          setSExportPending(true); setError('')
          try {
            const scope = sExportScope === 'folder' ? { folder: sExportFolder } : (sExportScope === 'tag' ? { tag: sExportTag } : { all: true })
            const res = await rpc('notes-export-single', { dir: dir, scope: scope, format: 'md', toc: sExportToc })   // payload 不传 undefined 字段
            if (res && res.error) { setError(res.error); return }
            try { localStorage.setItem('dsh-notes-last-export-single-dir', dir) } catch (err) {}
            setSExportOpen(false)
            showToast('已导出 ' + (res.exported || 0) + ' 篇到 ' + (res.target || dir) + (res.warning ? '；⚠ ' + res.warning : ''))
          } catch (err) { setError(String(err.message || err)) } finally { setSExportPending(false) }
        }
        // 导入两步式：第一步选目录 → notes-import-preview 出预览；第二步勾选覆盖 → notes-import 执行
        function openImport() {
          setImportDir(''); setImportPreview(null); setImportOverwrite(false); setImportPending(false); setError('')
          setSettingsOpen(false); setImportOpen(true)
        }
        async function doImportPreview() {
          const dir = importDir.trim()
          if (!dir || importPending) return
          setImportPending(true); setError('')
          try {
            const res = await rpc('notes-import-preview', { dir: dir })
            if (res && res.error) { setError(res.error); return }
            if (!res.total) { setError('该目录没有可导入的笔记：' + dir); return }
            setImportPreview(res); setImportOverwrite(false)   // 每次新预览重置覆盖勾选（默认不勾）
          } catch (err) { setError(String(err.message || err)) } finally { setImportPending(false) }
        }
        async function doImportExecute() {
          const dir = importDir.trim()
          if (!dir || !importPreview || importPending) return
          setImportPending(true); setError('')
          try {
            const res = await rpc('notes-import', { dir: dir, overwrite: !!importOverwrite })
            if (res && res.error) { setError(res.error); return }
            setImportOpen(false); setImportPreview(null)
            const got = (res.imported || 0) + (res.overwritten || 0)
            const skipped = (res.skippedSame || 0) + (res.skippedDiff || 0)
            const bak = String(res.backupDir || '').split(/[\\/]/).filter(Boolean).pop() || ''   // toast 只带备份目录名（全路径过长）
            showToast('已导入 ' + got + ' 条（跳过 ' + skipped + ' 条）' + (res.foldersMerged ? '，合并文件夹 ' + res.foldersMerged + ' 个' : '') + (bak ? '，已自动备份到 ' + bak : ''))
            await loadNotes(true); loadFolders(); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) } finally { setImportPending(false) }
        }
        async function doDispatchConfirm() {
          if (!selected || dispatching) return
          setDispatching(true); setError('')
          try {
            if (dispatchMode === 'new') {
              // 新建会话派发：client connectWorkspace 复用/新建一个 live 会话，再注入上下文+触发工作
              if (!dispatchWsId) { setError('请选择工作区'); setDispatching(false); return }
              if (!workspaces || !workspaces.connectWorkspace) { setError('workspaces 服务不可用'); setDispatching(false); return }
              const ws = wsList.find(w => w.id === dispatchWsId)
              const newSid = await workspaces.connectWorkspace(dispatchWsId)
              const res = await rpc('notes-dispatch', { id: selected, sessionId: newSid, sessionName: (ws ? ws.title : '新会话'), workspace: ws ? ws.title : '', mode: 'new', instruction: dispatchInstr })
              if (res && res.error) { setError(res.error); setDispatching(false); return }
              if (sessions && newSid) { try { sessions.open(newSid) } catch (e) {} }
              showToast('已新建会话，待办已注入并开始处理')
            } else {
              // 已有会话派发
              if (!dispatchSessId) { setError('请选择目标会话'); setDispatching(false); return }
              const sess = activeSessions.find(s => s.id === dispatchSessId)
              // 目标未打开（不 live）：先打开激活，等它上线后再注入触发
              if (sess && !sess.live && sessions && sessions.open) {
                try { sessions.open(sess.id) } catch (e) {}
                await timer.timeout(1200)
              }
              const res = await rpc('notes-dispatch', { id: selected, sessionId: dispatchSessId, sessionName: sess ? sess.name : '', workspace: sess ? sess.workspace : '', mode: 'existing', instruction: dispatchInstr })
              if (res && res.error) { setError(res.error); setDispatching(false); return }
              showToast((sess && !sess.live ? '已打开并派发待办到「' : '已派发待办到「') + (sess ? sess.name : '') + '」（开始处理）')
            }
            setDispatchOpen(false); setDispatchInstr('')
            const g = await rpc('notes-get', { id: selected }); if (g && g.note) setEdBody(g.note.body || '')
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) } finally { setDispatching(false) }
        }
        // 标记一条派发待办为完成（停止注入目标会话系统提示）
        async function doDispatchDone(origIndex) {
          try {
            const r = await rpc('notes-dispatch-done', { id: selected, dispatchIndex: origIndex })
            if (r && r.error) { setError(r.error); return }
            showToast('已标记完成'); await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // ===== 显式归档：预览 → 勾选 → 执行 → toast 撤销 =====
        // 归档后清理：被合并的笔记从列表消失——清掉多选残留；若正打开的笔记被合并则退出编辑器选中态
        function afterArchiveCleanup(mergedMemberIds) {
          const gone = {}
          for (const id of mergedMemberIds) gone[id] = true
          setSelIds(prev => { const next = {}; let dirty = false; for (const k of Object.keys(prev)) { if (gone[k]) dirty = true; else next[k] = true } return dirty ? next : prev })
          if (selected && gone[selected]) { setSelected(null); setEdTitle(''); setEdTopic(''); setEdTags(''); setEdBody('') }
        }
        // 打开归档预览（替代旧的直接执行）：dry-run 拉速记组（notes-archive-preview 零写入），默认全勾
        async function openArchive() {
          setError(''); setArchOpen(true); setArchGroups(null); setArchChecked({}); setArchExpand({}); setArchPending(false)
          try {
            const res = await rpc('notes-archive-preview')
            if (res && res.error) { setError(res.error); setArchGroups([]); return }
            setArchGroups((res && res.quickGroups) || [])
          } catch (err) { setError(String(err.message || err)); setArchGroups([]) }
        }
        // 确认归档：勾选组 → notes-archive 白名单组（host 先全量校验再动手）→ toast「已合并 N 组」+ 撤销按钮
        async function doArchiveConfirm() {
          const gs = (archGroups || []).filter(g => archChecked[g.sessionId] !== false)
          if (!gs.length || archPending) return
          setArchPending(true)
          try {
            // payload 禁 undefined：白名单组不带 title（用 host 默认标题规则）
            const res = await rpc('notes-archive', { groups: gs.map(g => ({ memberIds: g.members.map(m => m.id) })) })
            if (res && res.error) { setError(res.error); setArchPending(false); return }
            setArchOpen(false); setArchPending(false)
            showToast('已合并 ' + (res.merged || 0) + ' 组', { label: '撤销', fn: doArchiveUndo })
            afterArchiveCleanup(gs.reduce((acc, g) => acc.concat(g.members.map(m => m.id)), []))
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)); setArchPending(false) }
        }
        // 撤销最近一次归档（undo 事务文件）：归档笔记软删 + 成员批量恢复
        async function doArchiveUndo() {
          try {
            const res = await rpc('notes-archive-undo')
            if (res && res.error) { setError(res.error); return }
            showToast(res && res.undone ? '已撤销归档' : '没有可撤销的归档')
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // ===== 二期 孤儿资产清理（设置卡片「资产清理」入口）：dry-run 预览（零写入）→ 勾选 → 白名单执行 =====
        // 契约：notes-assets-prune 缺省 dryRun=true 返回 { orphans:[{name,bytes}], totalBytes, referenced, tombstoned, notes }；
        // 执行 dryRun:false + files 白名单（host 调用内重扫实时孤儿防漂移；软删除笔记的引用也计入保护，宁留勿删）。
        function openPrune() {
          setPruneData(null); setPruneChecked({}); setPrunePending(false); setError('')
          setSettingsOpen(false); setPruneOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入同款）
          rpc('notes-assets-prune', { dryRun: true }).then(res => {
            if (res && res.error) { setError(res.error); setPruneData({ orphans: [], totalBytes: 0 }); return }
            setPruneData(res || { orphans: [], totalBytes: 0 })
          }).catch(err => { setError(String(err.message || err)); setPruneData({ orphans: [], totalBytes: 0 }) })
        }
        async function doPruneConfirm() {
          const orphans = (pruneData && pruneData.orphans) || []
          const files = orphans.filter(o => pruneChecked[o.name] !== false).map(o => o.name)
          if (!files.length || prunePending) return
          setPrunePending(true)
          try {
            const res = await rpc('notes-assets-prune', { dryRun: false, files: files })
            if (res && res.error) { setError(res.error); setPrunePending(false); return }
            setPruneOpen(false); setPrunePending(false)
            showToast('已清理 ' + ((res.deleted || []).length) + ' 个孤儿资产，释放 ' + fmtBytes(res.freedBytes || 0) + ((res.modes && res.modes.tombstoned) ? '（开发版为清空占位）' : ''))
          } catch (err) { setError(String(err.message || err)); setPrunePending(false) }
        }
        // ===== P1 回收站（侧栏底部「回收站」入口）：notes-list {includeDeleted:true} 过滤 deleted → 恢复（notes-restore）/ 彻底删除（notes-purge）=====
        // 彻底删除双确认：点「彻底删除」→ window.confirm「彻底删除不可恢复」确认才执行；host 侧安全闸只接受已软删除的笔记
        function openTrash() {
          setTrashList(null); setTrashPending(''); setError('')
          setSettingsOpen(false); setTrashOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入同款）
          loadTrash()
        }
        function loadTrash() {
          rpc('notes-list', { includeDeleted: true }).then(res => {
            if (res && res.error) { setError(res.error); setTrashList([]); return }
            const del = ((res && res.notes) || []).filter(n => n.deleted === true)
            del.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))   // 删除时间（updatedAt 近似）降序
            setTrashList(del)
          }).catch(err => { setError(String(err.message || err)); setTrashList([]) })
        }
        async function doTrashRestore(id) {
          if (!id || trashPending) return
          setTrashPending(id); setError('')
          try {
            const res = await rpc('notes-restore', { id: id })
            if (res && res.error) { setError(res.error); return }
            showToast('已恢复')
            loadTrash(); await loadNotes(true); loadFolders(); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) } finally { setTrashPending('') }
        }
        async function doTrashPurge(id, title) {
          if (!id || trashPending) return
          if (!window.confirm('彻底删除不可恢复：「' + (title || id) + '」\n删除后正文与归档备份将一并移除，确认彻底删除？')) return
          setTrashPending(id); setError('')
          try {
            const res = await rpc('notes-purge', { id: id })
            if (res && res.error) { setError(res.error); return }
            showToast('已彻底删除')
            loadTrash(); await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) } finally { setTrashPending('') }
        }
        // ===== 注入预览（设置卡片「注入预览」入口）：notes-inject-preview 纯复用 host 注入渲染（约定桶 + 目录桶），
        // 双 tab 只读等宽展示 + 会话过滤下拉（sessList，含「全局」）+ 底部统计条（总字符/打码/时效标注/预算截断）=====
        function openInjectPreview() {
          setInjectPreviewData(null); setInjectPreviewTab('conv'); setInjectPreviewSid(''); setError('')
          setSettingsOpen(false); setInjectPreviewOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入同款）
          loadInjectPreview('')
        }
        function loadInjectPreview(sid) {
          rpc('notes-inject-preview', sid ? { sessionId: sid } : {}).then(res => {
            if (res && res.error) { setError(res.error); setInjectPreviewData({ conventions: '', catalog: '', stats: null }); return }
            setInjectPreviewData(res || { conventions: '', catalog: '', stats: null })
          }).catch(err => { setError(String(err.message || err)); setInjectPreviewData({ conventions: '', catalog: '', stats: null }) })
        }
        // ===== 整理建议（设置卡片「整理建议」行入口）：notes-suggest（dry-run 零写入）三段式 modal =====
        // 契约：{ archiveCandidates:速记组（结构与 notes-archive-preview 同源）, staleCandidates:过期未引用, orphanCandidates:孤儿（仅展示）, generatedAt }
        // 红线：只提名不自动执行——速记组「去归档」直达归档预览对话框；过期未引用「一键批量软删除」window.confirm 后才逐条 notes-delete（软删可恢复）；
        // 孤儿候选是启发式判定（可能误伤），不提供批量操作，逐条跳转人工过目。
        function openSuggest() {
          setSuggestData(null); setSuggestPending(false); setError('')
          setSettingsOpen(false); setSuggestOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入同款）
          loadSuggest()
        }
        function loadSuggest() {
          rpc('notes-suggest', {}).then(res => {
            if (res && res.error) { setError(res.error); setSuggestData({ archiveCandidates: [], staleCandidates: [], orphanCandidates: [] }); return }
            setSuggestData(res || { archiveCandidates: [], staleCandidates: [], orphanCandidates: [] })
          }).catch(err => { setError(String(err.message || err)); setSuggestData({ archiveCandidates: [], staleCandidates: [], orphanCandidates: [] }) })
        }
        // 速记组「去归档」：关建议框 → 复用归档预览对话框（数据同源，勾选/执行/撤销链路不变）
        function suggestGoArchive() { setSuggestOpen(false); openArchive() }
        // 孤儿「查看」：关建议框 → 双链跳转同款（目标被当前视图/kind/置顶过滤藏掉时退回「全部」再选中）
        function suggestViewNote(id) { setSuggestOpen(false); jumpToWikiTarget(id) }
        // 过期未引用一键批量软删：confirm 确认后才执行；逐条 notes-delete（host 软删，回收站可恢复）；
        // 删后刷新建议数据（三段联动，全空 → 空态文案）+ 列表
        async function doSuggestBatchDelete() {
          const list = (suggestData && suggestData.staleCandidates) || []
          if (!list.length || suggestPending) return
          if (!window.confirm('一键批量软删除：' + list.length + ' 条过期且从未被引用的笔记将移入回收站（可恢复）。\n确认删除？')) return
          setSuggestPending(true); setError('')
          let ok = 0, fail = 0
          for (const n of list) {
            try { const res = await rpc('notes-delete', { id: n.id }); if (res && res.error) fail++; else ok++ }
            catch (err) { fail++ }
          }
          setSuggestPending(false)
          showToast('已软删除 ' + ok + ' 条（回收站可恢复）' + (fail ? '，失败 ' + fail + ' 条' : ''))
          afterArchiveCleanup(list.map(n => n.id))   // 正打开的笔记在被删集合中则退出选中态（归档收尾同款语义）
          await loadNotes(true); notifyNotesChanged()
          loadSuggest()
        }
        // ===== 手动笔记多选合并：「选择」chip / 右键「合并为一篇」进多选态 → 底部操作条 → 标题输入 → notes-archive =====
        function toggleSelMode() { setSelMode(!selMode); setSelIds({}) }
        function toggleSelId(id) { setSelIds(prev => { const next = Object.assign({}, prev); if (next[id]) delete next[id]; else next[id] = true; return next }) }
        // 打开合并标题输入框：默认标题 = 所选笔记中最早更新者的 topic（原型口径）
        function openMerge() {
          const ids = Object.keys(selIds)
          if (ids.length < 2) { showToast('至少选择 2 条笔记'); return }
          const sel = notes.filter(n => selIds[n.id]).sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')))
          setMergeTitle((sel[0] && sel[0].topic) || '合并笔记'); setMergePending(false); setError(''); setMergeOpen(true)
        }
        async function doMergeConfirm() {
          const ids = Object.keys(selIds)
          const t = mergeTitle.trim()
          if (ids.length < 2 || mergePending || !t) return
          setMergePending(true)
          try {
            const g = { memberIds: ids }; if (t) g.title = t   // payload 禁 undefined：空标题不传 title 字段
            const res = await rpc('notes-archive', { groups: [g] })
            if (res && res.error) { setError(res.error); setMergePending(false); return }
            setMergeOpen(false); setMergePending(false); setSelMode(false)
            showToast('已合并所选 ' + ids.length + ' 条', { label: '撤销', fn: doArchiveUndo })
            afterArchiveCleanup(ids)
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)); setMergePending(false) }
        }
        // 同步键盘导航所需 ref（keydown 监听挂一次，每次渲染刷新最新值）
        openRef.current = open
        focusIdRef.current = focusId
        notesRef.current = notes
        selectNoteRef.current = selectNote
        closeRef.current = close
        moveFocusRef.current = (ids, delta) => {
          setFocusId(prev => {
            const idx = prev ? ids.indexOf(prev) : -1
            const next = idx < 0 ? (delta > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, idx + delta))
            return (ids[next] != null) ? ids[next] : null
          })
        }
        // 同步编辑字段 ref（供自动保存 debounce 读最新值）
        edTitleRef.current = edTitle
        edTopicRef.current = edTopic
        edTagsRef.current = edTags
        edBodyRef.current = edBody
        edKindRef.current = edKind
        edStatusRef.current = edStatus
        edRoleRef.current = edRole
        edRecallRef.current = edRecall
        edSensRef.current = edSens
        edScopeRef.current = edScope
        // 双模式编辑器 ref 镜像（keydown/effect 闭包读最新值）
        editorModeRef.current = editorMode
        degradedRef.current = degraded
        imgModalRef.current = imgModal
        linkModalRef.current = linkModal
        switchModeRef.current = switchMode
        jumpWikiRef.current = jumpToWikiTarget   // P2 双链跳转（富文本 click 委托读最新闭包）
        // 自动保存：debounce 只注册一次（null 时赋值），回调读 ref 避免闭包过期
        if (!autoSaveRef.current) autoSaveRef.current = timer.debounce(() => { if (selectedRef.current) doSave() }, 900)
        function triggerAutoSave() { if (autoSaveRef.current) autoSaveRef.current() }
        if (!open) return null
        function groupByTopic(list) { const map = new Map(); for (const n of list) { const t = n.topic || '未分类'; if (!map.has(t)) map.set(t, []); map.get(t).push(n) } return Array.from(map.entries()) }
        // 搜索关键词 <mark> 高亮（防 XSS）：q 先做正则元字符转义，split 片段全是纯文本、经 React 转义渲染后再包 mark 元素——绝不用 innerHTML 拼原文
        function highlight(text, q) { if (!q || !text) return text; const s = String(text); const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const parts = s.split(new RegExp('(' + esc + ')', 'gi')); if (parts.length === 1) return s; return parts.map((p, i) => i % 2 === 1 ? e('mark', { key: i, className: 'dsh-notes-mark' }, p) : p) }
        function folderName(fid) { const f = folders.find(x => x.id === fid); return f ? f.name : '' }
        const q = searchText.trim().toLowerCase()
        const localFiltered = q ? notes.filter(n => { const hay = ((n.title || '') + ' ' + (n.preview || '') + ' ' + (n.topic || '') + ' ' + (n.tags || []).join(' ') + ' ' + folderName(n.folder)).toLowerCase(); return hay.indexOf(q) >= 0 }) : notes
        // 搜索结果取 host 全文 + 本地即时的并集，RPC 失败/延迟时本地结果保底
        let filtered = searchIds ? notes.filter(n => searchIds.indexOf(n.id) >= 0 || localFiltered.indexOf(n) >= 0) : localFiltered
        // 视图求值（原型 matches）：view 单选（all/folder/topic）∩ 筛选中心（状态组/类型组，组内 OR 跨组 AND）∩ 搜索
        if (view.type === 'topic') filtered = filtered.filter(n => (n.topic || '') === view.id)
        else if (view.type === 'folder') filtered = filtered.filter(n => (n.folder || '') === view.id)
        filtered = filtered.filter(n => matchFilters(n, filters))
        // 相关度档位（搜索体验升级）：标题命中(3) > 标签命中(2) > 正文命中(1) > 其他(0，如仅 topic 命中)，同级 updatedAt 降序；
        // 命中字段优先取 host notes-search 返回的 matches（全文口径），无则按本地字段估算（preview 仅前 200 字，正文命中可能低估）；无搜索词时退化为 host 序
        function relRank(n) {
          const m = searchMatches[n.id]
          if (m && m.length) { if (m.indexOf('title') >= 0) return 3; if (m.indexOf('tags') >= 0) return 2; if (m.indexOf('body') >= 0) return 1; return 0 }
          if ((n.title || '').toLowerCase().indexOf(q) >= 0) return 3
          if ((n.tags || []).join(' ').toLowerCase().indexOf(q) >= 0) return 2
          if ((n.preview || '').toLowerCase().indexOf(q) >= 0) return 1
          return 0
        }
        // 排序（P2 使用遥测 + 相关度档位）：缺省保持 host 序（pinned → updatedAt 降序）；「按引用」= useCount 降序（同数按 updatedAt 兜底），分组内顺序随过滤数组
        if (sortBy === 'use') filtered = filtered.slice().sort((a, b) => ((b.useCount || 0) - (a.useCount || 0)) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        else if (sortBy === 'rel' && q) filtered = filtered.slice().sort((a, b) => (relRank(b) - relRank(a)) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        // 懒加载分页：只渲染前 visibleCount 条笔记行，滚动到底再加载更多（避免笔记多时全量渲染 + 每条跑 highlight）
        const paged = filtered.slice(0, visibleCount)
        const hasMore = filtered.length > visibleCount
        function onListScroll(ev) {
          const el = ev.target
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) { setVisibleCount(c => c + PAGE_SIZE) }
        }
        // 注入范围文字（injectTo 是多选数组）：缺省 = 所有会话（存量 global/workspace 值同样视为所有会话）；否则列出所选会话名
        function injectScopeLabel(injectTo) {
          const arr = (injectTo || []).filter(t => t !== 'global' && t !== 'workspace')
          if (arr.length === 0) return '所有会话'
          const names = arr.map(t => {
            const s = sessList.find(x => x.short === t)
            return s ? s.name : ('会话 ' + t)
          })
          return names.join('、')
        }
        // ===== 侧栏笔记行（原型 note-row）：kind 色点 + 标题(+置顶 pin) + 注入 bolt + 行尾 =====
        // 行尾（原型 noteRow）：主题视图内显示所属文件夹徽章；文件夹上下文内显示淡灰主题字（方案A）；其余显示日期
        function renderNoteRow(n, inFolderCtx) {
          let tail
          if (view.type === 'topic' && (n.folder || '')) tail = e('span', { className: 'dsh-notes-fbadge' }, I('folder', 9), folderName(n.folder))
          else if (inFolderCtx && n.topic && n.topic !== '分类中') tail = e('span', { className: 'dsh-notes-note-tp', title: '主题：' + n.topic }, n.topic)
          else tail = e('span', { className: 'dsh-notes-note-dt' }, n.updatedAt ? n.updatedAt.slice(5, 10) : '')
          // 多选态：行点击=勾选/取消（不再打开笔记），行首渲染复选框；与搜索/过滤共存（勾选按 noteId 记账，过滤不清选）
          return e('div', { key: n.id, className: 'dsh-notes-note-row' + (selected === n.id ? ' sel' : '') + (focusId === n.id ? ' focused' : '') + (flashId === n.id ? ' flash' : '') + (n.status === 'resolved' ? ' resolved' : '') + (n.status === 'superseded' ? ' superseded' : '') + (selMode && selIds[n.id] ? ' pick' : ''), onClick: () => { if (selMode) { toggleSelId(n.id); return } selectNote(n) }, onContextMenu: (ev) => openCtxMenu(ev, n), draggable: true, onDragStart: (ev) => onNoteDragStart(ev, n), onDragEnd: (ev) => onNoteDragEnd(ev) },
            selMode ? e('input', { type: 'checkbox', className: 'dsh-notes-pick-check', checked: !!selIds[n.id], onChange: () => toggleSelId(n.id), onClick: (ev) => ev.stopPropagation() }) : null,
            e('span', { className: 'dsh-notes-kind-dot', style: { background: 'var(--nkind-' + (n.kind || 'note') + ')' } }),
            e('span', { className: 'dsh-notes-note-ti' }, n.status === 'pinned' ? I('pin', 10, 'dsh-notes-note-pin') : null, highlight(n.title || '无标题', q)),
            n.inject === true ? e('span', { className: 'dsh-notes-note-inj dsh-nt', 'data-tooltip': '注入为上下文 · ' + (n.injectRole === 'reference' ? '资料' : '约定') + ' · 范围：' + injectScopeLabel(n.injectTo) }, I('bolt', 10)) : null,
            // 曾注入徽章（injectEver 粘性标记：历史上开启过注入、现已关闭；已注入时由 bolt 徽章表达，不重复显示；不满足不渲染）
            n.inject !== true && n.injectEver === true ? e('span', { className: 'dsh-notes-note-injevr dsh-nt', 'data-tooltip': '曾注入：历史上开启过上下文注入（现已关闭）' }, I('clock', 9)) : null,
            // 使用遥测（P2）：被引用徽章（0 次不显示）
            (n.useCount || 0) > 0 ? e('span', { className: 'dsh-notes-note-use dsh-nt', 'data-tooltip': '被 Agent 引用（note_get 命中）' + n.useCount + ' 次' }, I('quote', 9), String(n.useCount)) : null,
            // 双链标记（P2）：正文含 [[..]] 时行尾显示链接图标（缓存正文优先，preview 兜底）
            hasWikiLinks(n) ? e('span', { className: 'dsh-notes-note-wiki dsh-nt', 'data-tooltip': '含双链 [[…]]（详情富文本中可点击跳转）' }, I('link', 9)) : null,
            tail)
        }
        // ===== 侧栏树（原型 renderTree 翻译）：视图头 → 置顶组 → 文件夹组（nested 子笔记）→ 未分类（主题二级分组）→ 主题全局过滤 =====
        const treeIds = []
        const treeEls = []
        // 筛选中心：激活条件数 = 状态组勾选数 + 类型组勾选数（排序档位不计入）
        const filterCount = FILTER_STATUS.reduce((s, f) => s + (filters[f.id] ? 1 : 0), 0) + filters.kinds.length
        const filtersActive = view.type !== 'all' || filterCount > 0 || !!q
        // 曾注入条件 feature-detect：列表 slim 含 injectEver 字段才显示该选项（host 未提供时隐藏；存量激活条件仍渲染 chip 可 × 移除）
        const hasInjectEver = notes.some(n => n.injectEver !== undefined)
        const sortLabel = (FILTER_SORTS.find(s => s.id === sortBy) || FILTER_SORTS[0]).label
        const viewTitle = view.type === 'topic' ? ('主题 · ' + view.id) : view.type === 'folder' ? ('文件夹 · ' + folderName(view.id)) : '全部笔记'
        treeEls.push(e('div', { key: 'sec-view', className: 'dsh-notes-sec-h' },
          I('filter', 11),
          e('span', { className: 'dsh-notes-sec-h-t' }, viewTitle),
          view.type === 'topic' ? e('span', { className: 'dsh-notes-sec-h-sub' }, '（跨文件夹 ' + filtered.length + ' 条）') : null,
          view.type !== 'all' ? e('span', { className: 'dsh-notes-sec-h-clear dsh-nt', 'data-tooltip': '清除视图过滤', onClick: (ev) => { ev.stopPropagation(); setView({ type: 'all', id: '' }) } }, '×') : null))
        // 置顶组：置顶笔记仍在其所属位置显示（带 pin 视觉），本组是跨文件夹的置顶聚合视图（可折叠，PINNED_KEY 持久化）
        const pinnedAll = filtered.filter(n => n.status === 'pinned')
        if (pinnedAll.length > 0) {
          const pinOpen = isFolderExpanded(PINNED_KEY)
          treeEls.push(e('div', { key: 'sec-pinned', className: 'dsh-notes-sec-h dsh-notes-sec-toggle', onClick: () => toggleFolder(PINNED_KEY) },
            e('span', { className: 'dsh-notes-caret' + (pinOpen ? ' open' : '') }, I('chev', 10)),
            I('pin', 11),
            e('span', { className: 'dsh-notes-sec-h-t' }, '置顶'),
            e('span', { className: 'dsh-notes-sec-h-n' }, pinnedAll.length)))
          if (pinOpen) {
            const pinRows = []
            paged.filter(n => n.status === 'pinned').forEach(n => { treeIds.push(n.id); pinRows.push(renderNoteRow(n, false)) })
            if (pinRows.length) treeEls.push(e('div', { key: 'pinned-kids', className: 'dsh-notes-nested' }, pinRows))
          }
        }
        // 文件夹组：行 = caret + folder 图标 + 名称 + 计数 + 行尾过滤图标；点行主体 = 原地展开/折叠（与 caret 同义，「点哪个展开哪个」）；
        // 进入/退出文件夹视图降级为行尾过滤图标按钮（不抢占单击）+ 右键菜单项；右键管理
        treeEls.push(e('div', { key: 'sec-folders', className: 'dsh-notes-sec-h' },
          I('folder', 11),
          e('span', { className: 'dsh-notes-sec-h-t' }, '文件夹'),
          e('span', { className: 'dsh-notes-sec-h-add dsh-nt', 'data-tooltip': '新建文件夹', onClick: (ev) => { ev.stopPropagation(); setFolderInputText(''); setFolderInputOpen(true) } }, I('plus', 12))))
        for (const f of folders) {
          const fOpen = isFolderExpanded(f.id)
          const kidsAll = filtered.filter(n => (n.folder || '') === f.id)
          const kids = paged.filter(n => (n.folder || '') === f.id)
          // 计数口径（原型）：主题视图下显示命中数；其余显示文件夹总数
          const cnt = view.type === 'topic' ? kidsAll.length : (f.count || 0)
          treeEls.push(renamingId === f.id
            ? e('div', { key: 'folder-' + f.id, className: 'dsh-notes-folder-row' },
                e('span', { className: 'dsh-notes-caret' }, I('chev', 10)),
                e('span', { className: 'dsh-notes-ic-slot' }, I('folder', 13)),
                e('input', { className: 'dsh-notes-folder-rename', value: renameText, autoFocus: true, onChange: (ev) => setRenameText(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doRenameFolder() } else if (ev.key === 'Escape') { ev.preventDefault(); setRenamingId(null) } }, onBlur: () => setRenamingId(null) }))
            : e('div', { key: 'folder-' + f.id, className: 'dsh-notes-folder-row' + (view.type === 'folder' && view.id === f.id ? ' on' : ''), onClick: () => toggleFolder(f.id), onContextMenu: (ev) => openFolderMenu(ev, f), onDragOver: onFolderDragOver, onDragLeave: onFolderDragLeave, onDrop: (ev) => onFolderDrop(ev, f) },
                e('span', { className: 'dsh-notes-caret' + (fOpen ? ' open' : '') }, I('chev', 10)),
                e('span', { className: 'dsh-notes-ic-slot' }, I('folder', 13)),
                e('span', { className: 'dsh-notes-row-nm' }, f.name),
                e('span', { className: 'dsh-notes-row-n' }, cnt),
                e('span', { className: 'dsh-notes-row-vfilter dsh-nt' + (view.type === 'folder' && view.id === f.id ? ' on' : ''), 'data-tooltip': '文件夹视图（仅看此文件夹）', onClick: (ev) => { ev.stopPropagation(); setView(view.type === 'folder' && view.id === f.id ? { type: 'all', id: '' } : { type: 'folder', id: f.id }) } }, I('filter', 11))))
          if (fOpen && kids.length) { kids.forEach(n => { treeIds.push(n.id) }); treeEls.push(e('div', { key: 'kids-' + f.id, className: 'dsh-notes-nested' }, kids.map(n => renderNoteRow(n, true)))) }
        }
        // 新建文件夹内联输入行（分组头 ＋ 展开；Enter 提交 / Esc 或空串失焦取消）
        if (folderInputOpen) {
          treeEls.push(e('div', { key: 'folder-add', className: 'dsh-notes-folder-row' },
            e('span', { className: 'dsh-notes-caret' }, I('chev', 10)),
            e('span', { className: 'dsh-notes-ic-slot' }, I('folder', 13)),
            e('input', { className: 'dsh-notes-folder-rename', placeholder: '文件夹名…', value: folderInputText, autoFocus: true, onChange: (ev) => setFolderInputText(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doCreateFolder() } else if (ev.key === 'Escape') { ev.preventDefault(); setFolderInputOpen(false) } }, onBlur: () => { if (!folderInputText.trim()) setFolderInputOpen(false) } })))
        }
        // 未分类：整区包一层 .dsh-notes-unfiled-drop 容器作为「移出」drop 目标（拖到本区任意位置 = 移出文件夹）；
        // 内部按主题二级分组（原型：分组头 + nested 子笔记）；为空时仍渲染容器，保证任何时刻都有可拖出的落点
        const unfiled = paged.filter(n => !(n.folder || ''))
        const unfiledKids = []
        for (const [topic, topicNotes] of groupByTopic(unfiled)) {
          unfiledKids.push(e('div', { key: 'tg-' + topic, className: 'dsh-notes-row head dsh-notes-topic-g' },
            e('span', { className: 'dsh-notes-ic-slot' }, I('topic', 11)),
            e('span', { className: 'dsh-notes-row-nm' }, topic === '分类中' ? '识别中' : topic),
            e('span', { className: 'dsh-notes-row-n' }, topicNotes.length)))
          topicNotes.forEach(n => { treeIds.push(n.id) })
          unfiledKids.push(e('div', { key: 'tgk-' + topic, className: 'dsh-notes-nested' }, topicNotes.map(n => renderNoteRow(n, false))))
        }
        if (!unfiled.length) unfiledKids.push(e('div', { key: 'empty-u', className: 'dsh-notes-row dsh-notes-tree-empty' }, '（空）'))
        treeEls.push(e('div', { key: 'unfiled-drop', className: 'dsh-notes-unfiled-drop', onDragOver: onUnfiledDragOver, onDragLeave: onUnfiledDragLeave, onDrop: onUnfiledDrop },
          e('div', { className: 'dsh-notes-sec-h' }, e('span', { className: 'dsh-notes-sec-h-t' }, '未分类')),
          unfiledKids))
        // 主题全局过滤（原型底部区）：全库主题 + 计数；点行主体 = 原地展开/收起该主题的笔记子列表（topicExpanded，不持久化）；
        // 主题视图（跨文件夹过滤）降级为行尾过滤图标按钮（不抢占单击）
        const allTopics = {}
        notes.forEach(n => { if (n.topic) allTopics[n.topic] = (allTopics[n.topic] || 0) + 1 })
        const topicNames = Object.keys(allTopics).sort()
        if (topicNames.length) {
          treeEls.push(e('div', { key: 'sec-topics', className: 'dsh-notes-sec-h' },
            I('topic', 11),
            e('span', { className: 'dsh-notes-sec-h-t' }, '主题过滤'),
            e('span', { className: 'dsh-notes-sec-h-sub' }, '跨文件夹')))
          topicNames.forEach(tn => {
            const tOpen = !!topicExpanded[tn]
            treeEls.push(e('div', { key: 'tp-' + tn, className: 'dsh-notes-row dsh-notes-topic-row' + (view.type === 'topic' && view.id === tn ? ' on' : ''), onClick: () => toggleTopicExpanded(tn) },
              e('span', { className: 'dsh-notes-caret' + (tOpen ? ' open' : '') }, I('chev', 10)),
              e('span', { className: 'dsh-notes-ic-slot' }, I('topic', 12)),
              e('span', { className: 'dsh-notes-row-nm' }, tn === '分类中' ? '识别中' : tn),
              e('span', { className: 'dsh-notes-row-n' }, allTopics[tn]),
              e('span', { className: 'dsh-notes-row-vfilter dsh-nt' + (view.type === 'topic' && view.id === tn ? ' on' : ''), 'data-tooltip': '主题视图（跨文件夹过滤）', onClick: (ev) => { ev.stopPropagation(); setView(view.type === 'topic' && view.id === tn ? { type: 'all', id: '' } : { type: 'topic', id: tn }) } }, I('filter', 11))))
            if (tOpen) {
              const tkids = paged.filter(n => (n.topic || '') === tn)
              if (tkids.length) { tkids.forEach(n => { treeIds.push(n.id) }); treeEls.push(e('div', { key: 'tpk-' + tn, className: 'dsh-notes-nested' }, tkids.map(n => renderNoteRow(n, false)))) }
            }
          })
        }
        // 空态：全库为空 → 引导新建；有库但过滤为空 → 无匹配提示
        if (notes.length === 0 && !loading) {
          treeEls.push(e('div', { key: 'empty', className: 'dsh-notes-empty-state' },
            e('div', { className: 'dsh-notes-empty-ic' }, I('note', 30)),
            e('div', { className: 'dsh-notes-empty-t' }, '还没有笔记'),
            e('div', { className: 'dsh-notes-empty-s' }, '点侧栏「新建」输入标题，创建第一条笔记'),
            e('button', { className: 'dsh-notes-empty-btn', onClick: openNewNote }, '记第一条')))
        } else if (filtered.length === 0 && filtersActive) {
          // 空结果态：提示 + 筛选中心条件激活时附「清空筛选」快捷动作（设计稿口径⑦）
          treeEls.push(e('div', { key: 'no-match', className: 'dsh-notes-sec-h' }, e('span', { className: 'dsh-notes-sec-h-t' }, '无匹配笔记'),
            filterCount > 0 ? e('span', { className: 'dsh-notes-sec-h-clear dsh-nt', 'data-tooltip': '清空全部筛选条件', onClick: () => { setFilters(FILTERS0()); if (searchDebRef.current) searchDebRef.current() } }, '清空筛选') : null))
        }
        if (loading && notes.length === 0) treeEls.unshift(e('div', { key: 'loading', className: 'dsh-notes-loading' }, '加载中...'))
        // 键盘导航顺序 = 树渲染顺序（置顶组与所属位置重复出现的笔记去重）
        pagedIdsRef.current = Array.from(new Set(treeIds))
        // 是否注入为上下文：由 inject + injectRole 双字段推出的三态决定（off 之外即注入中，不依赖标签）
        const isInjected = edRole !== 'off'
        // 当前选中笔记（编辑器区多处用）
        const curNote = notes.find(n => n.id === selected) || null
        const curFolderName = curNote && curNote.folder ? folderName(curNote.folder) : ''
        const curTopicName = curNote && curNote.topic && curNote.topic !== '分类中' ? curNote.topic : ''
        // 主题全局过滤跳转（面包屑主题段 + 主题 chip 跳钮共用）：未识别主题时提示不跳转
        function jumpToTopicFilter() {
          if (!curTopicName) { showToast('该笔记尚未识别主题'); return }
          setView({ type: 'topic', id: curTopicName })
          showToast('已按主题过滤：' + curTopicName)
        }
        // 文件夹右键菜单的上移/下移边界（首项不可上移、末项不可下移）
        const folderMenuIdx = folderMenu ? folders.findIndex(f => f.id === folderMenu.folder.id) : -1
        const curDispatches = (curNote && curNote.dispatches) || []
        // P3 派发闭环：待回执条数（驱动详情 meta 徽章）
        const dispatchOpenCount = curDispatches.filter(d => !isDispatchDone(d)).length
        // ===== P2 反向链接：全库正文索引扫描（extractWikiTargets/wikiLinksTo 与内核同一口径）；索引未到的条目暂不计，标题行提示「索引中…」=====
        void wikiVer   // 索引版本号驱动本区重算（索引推进 → setWikiVer → 重渲染）
        const wikiWarm = notes.every(n => !!wikiBodiesRef.current[n.id])
        const backlinks = (() => {
          if (!curNote) return []
          const out = []
          for (const n of notes) {
            if (n.id === curNote.id) continue   // 自链不算反向链接
            const c = wikiBodiesRef.current[n.id]
            if (!c) continue
            if (wikiLinksTo(c.body, curNote.id, curNote.title || '')) out.push(n)
          }
          return out
        })()
        // 范围浮层：会话按工作区分组（两级：工作区 → 会话）
        const scopeByWs = {}
        for (const s of sessList) { const w = s.workspace || '其他'; if (!scopeByWs[w]) scopeByWs[w] = []; scopeByWs[w].push(s) }
        // 标题后台补齐中的占位会话（0.1.7）：禁用态占位「短id · 标题加载中…」，补齐后轮询重拉自动替换为真名
        for (const p of sessPending) { const w = p.workspace || '其他'; if (!scopeByWs[w]) scopeByWs[w] = []; scopeByWs[w].push({ id: p.id, short: p.short, name: '', pending: true }) }
        const scopeWsKeys = Object.keys(scopeByWs).sort()
        // 派发对话框：已有会话模式按工作区过滤活跃会话；新建会话模式选工作区
        const dispatchWsKeys = []
        const dispatchSessByWs = {}
        for (const s of activeSessions) { const w = s.workspace || '其他'; if (!dispatchSessByWs[w]) { dispatchSessByWs[w] = []; dispatchWsKeys.push(w) } dispatchSessByWs[w].push(s) }
        // 标题后台补齐中的占位会话（0.1.7）：同一下拉按工作区分组，禁用态显示「短id · 标题加载中…」
        for (const p of dispatchPending) { const w = p.workspace || '其他'; if (!dispatchSessByWs[w]) { dispatchSessByWs[w] = []; dispatchWsKeys.push(w) } dispatchSessByWs[w].push({ id: p.id, short: p.short, name: '', pending: true }) }
        // ===== 编辑器区（原型 .ed）：面包屑 + 大标题 + meta chips 行 + 正文 + 底部状态 =====
        const editorEl = curNote ? e('section', { className: 'dsh-notes-ed' },
          e('div', { className: 'dsh-notes-ed-h' },
            e('div', { className: 'dsh-notes-ed-crumb' },
              curFolderName ? e('span', { className: 'dsh-notes-crumb-cur' }, curFolderName) : null,
              curFolderName ? e('span', { className: 'dsh-notes-crumb-sep' }, '/') : null,
              e('span', { className: 'dsh-notes-crumb-lnk dsh-nt', 'data-tooltip': '查看同主题全部笔记', onClick: jumpToTopicFilter }, curTopicName || '未分类'),
              e('span', { className: 'dsh-notes-crumb-sep' }, '/'),
              e('span', null, curNote.id)),
            e('input', { className: 'dsh-notes-ed-title', placeholder: '无标题', value: edTitle, onChange: (ev) => { setEdTitle(ev.target.value); triggerAutoSave() } }),
            e('div', { className: 'dsh-notes-ed-meta' },
              e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': '笔记类型' },
                e('span', { className: 'dsh-notes-meta-dot', style: { background: 'var(--nkind-' + edKind + ')' } }),
                e('select', { className: 'dsh-notes-meta-select', value: edKind, onChange: (ev) => { setEdKind(ev.target.value); triggerAutoSave() } },
                  e('option', { value: 'note' }, '笔记'),
                  e('option', { value: 'decision' }, '决策'),
                  e('option', { value: 'todo' }, '待办'),
                  e('option', { value: 'link' }, '链接'),
                  e('option', { value: 'quote' }, '引用'))),
              e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': '主题（可直接编辑；点右侧按钮按主题全局过滤）' },
                I('topic', 11),
                e('input', { className: 'dsh-notes-meta-topic-input', placeholder: '主题', value: edTopic, onChange: (ev) => { setEdTopic(ev.target.value); triggerAutoSave() } }),
                e('span', { className: 'dsh-notes-meta-jump dsh-nt', 'data-tooltip': '按主题全局过滤', onClick: jumpToTopicFilter }, I('filter', 10))),
              curFolderName ? e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': '所在文件夹' }, I('folder', 11), curFolderName) : null,
              // 使用遥测（P2）：详情 meta chip「被引用 N 次」（0 次不显示）
              (curNote.useCount || 0) > 0 ? e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': '使用遥测：被 Agent 引用（note_get 命中）次数' }, I('quote', 11), '被引用 ' + curNote.useCount + ' 次') : null,
              // P3 派发闭环徽章：有派发记录时聚合显示（pending=有待回执 / done=全部已回执），点击展开派发历史
              curDispatches.length ? e('span', { className: 'dsh-notes-meta-chip dsh-notes-dispatch-badge ' + (dispatchOpenCount ? 'pending' : 'done'), onClick: () => setDispatchHistoryOpen(true), 'data-tooltip': dispatchOpenCount ? ('派发中：' + dispatchOpenCount + ' 条待回执（共 ' + curDispatches.length + ' 条）· 目标会话处理完转 idle 或笔记置 resolved 时自动回执；点击查看派发历史') : ('全部 ' + curDispatches.length + ' 条派发已回执 · 点击查看派发历史') },
                I(dispatchOpenCount ? 'play' : 'check', 11),
                dispatchOpenCount ? ' 派发中 ' + dispatchOpenCount + '/' + curDispatches.length : ' 派发已回执') : null,
              e('span', { className: 'dsh-notes-meta-chip dsh-notes-role-seg' },
                I('bolt', 11),
                e('span', { className: 'dsh-notes-role-opt dsh-nt' + (edRole === 'off' ? ' on' : ''), onClick: () => setRoleSeg('off'), 'data-tooltip': '不注入系统提示' }, '关闭'),
                e('span', { className: 'dsh-notes-role-opt dsh-nt' + (edRole === 'convention' ? ' on' : ''), onClick: () => setRoleSeg('convention'), 'data-tooltip': '须遵守的行为规则' }, '约定'),
                e('span', { className: 'dsh-notes-role-opt dsh-nt' + (edRole === 'reference' ? ' on' : ''), onClick: () => setRoleSeg('reference'), 'data-tooltip': '事实性补充信息，Agent 按需取用' }, '资料')),
              isInjected ? e('span', { className: 'dsh-notes-ed-scope-wrap' },
                e('button', { className: 'dsh-notes-meta-chip dsh-notes-scope-trigger dsh-nt', onClick: (ev) => { ev.stopPropagation(); setScopeOpen(!scopeOpen) }, 'data-tooltip': '选择注入范围（可多选）' },
                  injectScopeLabel(edScope), e('span', { className: 'dsh-notes-scope-caret' }, '▾')),
                scopeOpen ? e('div', { className: 'dsh-notes-scope-panel' },
                  // 默认提示行：注入无「工作区/全局」维度——缺省注入所有会话，勾选会话则仅限这些会话
                  e('div', { className: 'dsh-notes-scope-hint' }, '默认注入到所有会话；勾选会话则仅限这些会话'),
                  scopeWsKeys.map(ws => e('div', { key: ws, className: 'dsh-notes-scope-group' },
                    e('div', { className: 'dsh-notes-scope-ws' }, ws),
                    scopeByWs[ws].map(s => e('label', { key: s.id, className: 'dsh-notes-scope-item dsh-notes-scope-sess' },
                      e('input', { type: 'checkbox', checked: s.pending ? false : edScope.indexOf(s.short) >= 0, onChange: () => { if (!s.pending) toggleScope(s.short) }, disabled: !!s.pending }),
                      ' ' + (s.pending ? (s.short + ' · 标题加载中…') : s.name))))))
                : null)
              : null,
              // 曾注入徽章（injectEver 粘性标记：单向只升不降，不随关闭回退；当前已注入时由上方注入角色段表达，不重复显示）
              curNote.injectEver === true && !isInjected ? e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': '曾注入：历史上开启过上下文注入（现已关闭；injectEver 为粘性标记，不随关闭回退）' }, I('clock', 11), '曾注入') : null,
              e('span', { className: 'dsh-notes-meta-chip tgl' + (edRecall ? ' on' : ''), onClick: toggleRecall, 'data-tooltip': '关闭后该笔记不出现在注入给 Agent 的目录中' }, I('eye', 11), '目录可见'),
              e('span', { className: 'dsh-notes-meta-chip tgl' + (edSens ? ' on' : ''), onClick: toggleSens, 'data-tooltip': '敏感内容：注入系统提示时正文按行打码（键保留值遮蔽），Agent 用 note_get 取原文' }, I('lock', 11), '敏感'),
              e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': '标签（逗号分隔；convention 标签已由注入开关替代）' },
                I('tag', 11),
                e('input', { className: 'dsh-notes-meta-tags-input', placeholder: '标签，逗号分隔', value: edTags, onChange: (ev) => { setEdTags(ev.target.value); triggerAutoSave() } })),
              e('span', { className: 'dsh-notes-meta-sp' }),
              // 双模式两段开关（原型 .modeseg）：源码 ⇄ 富文本；降级态富文本段置灰 + tooltip 给出原因
              e('span', { className: 'dsh-notes-modeseg', role: 'group', 'aria-label': '编辑器模式（Ctrl+/ 切换）' },
                e('button', { className: 'dsh-notes-modeseg-seg' + (editorMode === 'source' ? ' on' : '') + ' dsh-nt', 'data-tooltip': 'Markdown 源码编辑', onClick: () => switchMode('source') }, I('codeblock', 12), '源码'),
                e('button', { className: 'dsh-notes-modeseg-seg' + (editorMode === 'rich' ? ' on' : '') + (!degraded.ok ? ' dis' : '') + ' dsh-nt', 'data-tooltip': !degraded.ok ? ('含高级语法（' + degraded.reasons.map(r => r.label).join('、') + '），请在源码模式编辑') : '富文本（受限 WYSIWYG）', onClick: () => switchMode('rich') }, I('eye', 12), '富文本')),
              e('span', { className: 'dsh-notes-kbd dsh-notes-modeseg-kbd' }, 'Ctrl+/'),
              // 二期 ✨整理：AI 按当前 kind 模板重写正文（notes-ai-organize；替换后 toast 可撤销一次）
              e('span', { className: 'dsh-notes-meta-act dsh-notes-organize-btn' + (organizing ? ' busy' : '') + ' dsh-nt', onClick: (ev) => { ev.stopPropagation(); if (!organizing) doAiOrganize() }, 'data-tooltip': organizing ? 'AI 整理中…' : 'AI 整理：按「' + (KIND_LABELS[edKind] || '笔记') + '」模板重写正文（替换后可撤销）' }, I('sparkle', 12), organizing ? '整理中…' : '整理'),
              e('span', { className: 'dsh-notes-meta-act dsh-nt', onClick: (ev) => { ev.stopPropagation(); openDispatch() }, 'data-tooltip': '派发待办到会话（可补充具体要求）' }, I('play', 12), dispatching ? '…' : '派发'),
              curNote.sessionId ? e('span', { className: 'dsh-notes-meta-act dsh-nt', onClick: () => jumpToSession(curNote.sessionId), 'data-tooltip': '跳转到来源会话' }, I('ext', 12), '来源') : null,
              e('span', { className: 'dsh-notes-meta-act' + (edStatus === 'pinned' ? ' on' : '') + ' dsh-nt', onClick: () => { setEdStatus(edStatus === 'pinned' ? 'active' : 'pinned'); triggerAutoSave() }, 'data-tooltip': edStatus === 'pinned' ? '取消置顶' : '置顶' }, I('pin', 12)),
              e('span', { className: 'dsh-notes-meta-act danger dsh-nt', onClick: () => doDelete(selected), 'data-tooltip': '删除（软删除，可恢复）' }, I('trash', 12)))),
          curDispatches.length ? e('div', { className: 'dsh-notes-dispatch-history' + (dispatchHistoryOpen ? ' open' : ' collapsed') },
            e('div', { className: 'dsh-notes-dispatch-history-t', onClick: () => setDispatchHistoryOpen(!dispatchHistoryOpen), role: 'button', 'aria-expanded': dispatchHistoryOpen ? 'true' : 'false' },
              I('chev', 9, 'dsh-notes-hist-caret' + (dispatchHistoryOpen ? ' open' : '')), '派发历史（' + curDispatches.length + '）'),
            dispatchHistoryOpen ? curDispatches.map((d, origIdx) => ({ d: d, origIdx: origIdx })).reverse().map(({ d, origIdx }) => e('div', { key: origIdx, className: 'dsh-notes-dispatch-rec' + (isDispatchDone(d) ? ' done' : '') },
              e('div', { className: 'dsh-notes-dispatch-rec-top' },
                e('span', { className: 'dsh-notes-dispatch-rec-t' }, isDispatchDone(d) ? [I('check', 10, 'dsh-notes-hist-done'), ' ' + (d.sessionName || d.sessionId)] : [e('span', { key: 'dot', className: 'dsh-notes-dispatch-dot' }), ' ' + (d.sessionName || d.sessionId)]),
                e('span', { className: 'dsh-notes-dispatch-rec-m' }, (isDispatchDone(d) ? '已完成 · ' : '待处理 · ') + (d.mode === 'new' ? '新会话' : (d.workspace || '已有会话')) + (d.at ? ' · ' + String(d.at).slice(5, 16).replace('T', ' ') : ''))),
              d.instruction ? e('div', { className: 'dsh-notes-dispatch-rec-i' }, '要求：' + d.instruction) : null,
              !isDispatchDone(d) ? e('button', { className: 'dsh-notes-dispatch-done-btn', onClick: () => doDispatchDone(origIdx) }, '标记完成') : null)) : null)
          : null,
          // 降级横幅（原型 .deg）：检测到白名单外语法时提示（富文本入口同步置灰），删净后实时恢复
          !degraded.ok ? e('div', { className: 'dsh-notes-deg' },
            I('warn', 13),
            e('div', null,
              e('div', null, '检测到', e('b', null, '白名单外语法'), '，富文本编辑不可用（仍可源码编辑）：'),
              e('div', { className: 'dsh-notes-deg-rs' }, degraded.reasons.map(r => r.label + '（第 ' + r.line + ' 行：' + r.sample + '）').join('、')))) : null,
          // 正文双模式（原型 .src / .rich-scroll）：源码 textarea ⇄ 富文本 contenteditable（非受控，编辑期间不重渲染）
          editorMode === 'source'
            ? e('textarea', {
                ref: edBodyDomRef, className: 'dsh-notes-ed-body', placeholder: '正文…（Markdown）', value: edBody,
                onChange: (ev) => { setEdBody(ev.target.value); triggerAutoSave(); scheduleDegAnalyze() },
                // 图片入口①/②（源码模式）：粘贴/拖拽图片文件 → 同一上传弹窗 → 光标处插 Markdown 文本
                onPaste: (ev) => { const cd = ev.clipboardData; if (cd && cd.files && cd.files.length && cd.files[0].type.indexOf('image/') === 0) { ev.preventDefault(); pickImageFile(cd.files[0]) } },
                onDragOver: (ev) => { ev.preventDefault() },
                onDrop: (ev) => { const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]; if (!f) return; ev.preventDefault(); if (!f.type || f.type.indexOf('image/') !== 0) { showToast('仅支持图片文件'); return } pickImageFile(f) }
              })
            : e('div', { ref: richWrapRef, className: 'dsh-notes-rich-scroll dsh-notes-rich-wrap' },
                e('div', { className: 'dsh-notes-rtb' },
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'bold', 'data-tooltip': '加粗 **text**', onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('bold') } }, I('bold', 14)),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'italic', 'data-tooltip': '斜体 *text*', onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('italic') } }, I('italic', 14)),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'code', 'data-tooltip': '行内码 `text`', onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('code') } }, I('codeblock', 14)),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'link', 'data-tooltip': '链接 [text](url)', onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('link') } }, I('link', 14)),
                  e('span', { className: 'dsh-notes-rtb-sep' }),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'ul', 'data-tooltip': '无序列表', onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('ul') } }, I('ul', 14)),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'ol', 'data-tooltip': '有序列表', onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('ol') } }, I('ol', 14)),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'quote', 'data-tooltip': '引用块', onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('quote') } }, I('quote', 14)),
                  e('span', { className: 'dsh-notes-rtb-sep' }),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'image', 'data-tooltip': '插入图片 ![](assets/..)（也可 Ctrl+V 粘贴 / 拖拽文件）', onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('image') } }, I('image', 14)),
                  e('span', { className: 'dsh-notes-rtb-sync' + (richSyncing ? '' : ' ok') }, e('span', { className: 'dsh-notes-rtb-sync-sd' }), richSyncing ? '编辑中…' : '已同步源码')),
                e('div', { ref: richRef, className: 'dsh-notes-rich', contentEditable: true, spellCheck: false, suppressContentEditableWarning: true })),
          // P2 反向链接面板：全库正文含 [[当前id]]/[[当前标题]] 的其他笔记（点击跳转；索引未热提示「索引中…」）
          e('div', { className: 'dsh-notes-backlinks' },
            e('div', { className: 'dsh-notes-backlinks-t' }, I('link', 11), '反向链接' + (wikiWarm ? '（' + backlinks.length + '）' : '（索引中…）')),
            backlinks.length
              ? e('div', { className: 'dsh-notes-backlinks-list' }, backlinks.map(n => e('span', { key: n.id, className: 'dsh-notes-backlink dsh-nt', 'data-tooltip': '跳转到「' + (n.title || '无标题') + '」', onClick: () => jumpToWikiTarget(n.id) },
                  e('span', { className: 'dsh-notes-kind-dot', style: { background: 'var(--nkind-' + (n.kind || 'note') + ')' } }), n.title || '无标题')))
              : (wikiWarm ? e('div', { className: 'dsh-notes-backlinks-empty' }, '暂无其他笔记用 [[…]] 链接到这里') : null)),
          e('div', { className: 'dsh-notes-ed-foot' },
            e('span', { className: 'dsh-notes-ed-foot-i' }, editorMode === 'source' ? '源码模式' : '富文本模式'),
            e('span', { className: 'dsh-notes-ed-foot-i' }, '创建 ' + (curNote.createdAt ? String(curNote.createdAt).slice(0, 10) : '—')),
            e('span', { className: 'dsh-notes-ed-foot-i' }, '更新 ' + (curNote.updatedAt ? String(curNote.updatedAt).slice(0, 10) : '—')),
            curNote.sessionId ? e('span', { className: 'dsh-notes-ed-foot-i' }, '来源 会话 ' + shortSid(curNote.sessionId)) : null,
            e('span', { className: 'dsh-notes-ed-saved' + (savedAt ? ' show' : '') }, savedAt ? '已自动保存 ' + new Date(savedAt).toTimeString().slice(0, 5) : ''),
            e('span', { className: 'dsh-notes-ed-foot-i' }, (edBody || '').length + ' 字')))
        : e('section', { className: 'dsh-notes-ed' },
            e('div', { className: 'dsh-notes-ed-empty' },
              e('div', { className: 'dsh-notes-ed-empty-ic' }, I('note', 26)),
              e('div', { className: 'dsh-notes-ed-empty-t' }, '选择一条笔记查看和编辑'),
              e('div', { className: 'dsh-notes-ed-empty-s' }, '点侧栏「新建」输入标题，新建一条笔记')))
        // ===== 面板根：标题栏（拖拽/入口切换/归档/帮助/关闭）+ 两栏 app 区 + 浮层 =====
        return e('div', { className: 'dsh-notes-floating', style: { left: (pos.x || 0) + 'px', top: (pos.y || 0) + 'px', width: size.width + 'px', height: size.height + 'px' } },
          e('div', { className: 'dsh-notes-titlebar dsh-nt', onMouseDown: onTitlebarMouseDown, 'data-tooltip': '拖拽移动窗口' },
            e('span', { className: 'dsh-notes-titlebar-title' }, I('note', 14), '笔记'),
            e('div', { className: 'dsh-notes-titlebar-actions' },
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: () => setEntryMode(entryMode === 'header' ? 'fab' : 'header'), 'data-tooltip': '切换入口模式：会话头部 / 悬浮气泡' }, I('swap', 13)),
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: openArchive, 'data-tooltip': '归档：把同一会话的速记合并成一篇；点按弹出预览，勾选后才执行（可撤销）' }, '归档'),
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: () => setShowHelp(!showHelp), 'data-tooltip': '使用说明' }, '?'),
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: close, 'data-tooltip': '关闭' }, '×'))),
          showHelp ? e('div', { className: 'dsh-notes-help-bubble' },
            e('button', { className: 'dsh-notes-help-close', onClick: () => setShowHelp(false) }, '×'),
            e('h4', null, '使用说明'),
            e('ul', null,
              e('li', null, '点侧栏「新建」或按 ', e('kbd', null, 'Ctrl+N'), ' 输入标题新建笔记，创建后直接编辑正文'),
              e('li', null, '在页面划选文字松手，弹出快速记录卡片（自动识别为引用）'),
              e('li', null, '同一会话 10 分钟内的速记自动合并'),
              e('li', null, '点面包屑/编辑器里的主题可按主题全局过滤（跨文件夹）'),
              e('li', null, '拖笔记到文件夹行移入，拖到「未分类」区移出'),
              e('li', null, '快捷键：', e('kbd', null, 'Ctrl+K'), ' 搜索、', e('kbd', null, 'Ctrl+N'), ' 新建、', e('kbd', null, 'j/k'), ' 或 ', e('kbd', null, '↑↓'), ' 移动、', e('kbd', null, 'Enter'), ' 打开、', e('kbd', null, 'Esc'), ' 关闭'),
              e('li', null, '「归档」：弹出预览，勾选速记组后才合并（可撤销）；手动笔记点「选择」多选合并'),
              e('li', null, '编辑器「整理」：AI 按类型模板重写正文（替换后可撤销一次）；新建笔记按类型预填模板骨架'),
              e('li', null, '图片超过 1MB 自动压缩转 JPEG；设置卡片「资产清理」清理未被引用的孤儿文件'),
              e('li', null, '删除是软删除：侧栏底部「回收站」可恢复或彻底删除（彻底删除不可恢复）'))) : null,
          e('div', { className: 'dsh-notes-app' },
            e('aside', { className: 'dsh-notes-side', style: { width: clampSideW(sideW, size.width) + 'px' } },
              e('div', { className: 'dsh-notes-brand' },
                e('span', { className: 'dsh-notes-brand-logo' }, I('note', 13)),
                e('b', null, '笔记'),
                e('span', { className: 'dsh-notes-brand-cnt' }, (filtersActive ? filtered.length : notes.length) + ' 条'),
                // 新建入口（自旧 chips 行迁入 brand 行右侧，筛选中心口径⑥）
                e('span', { className: 'dsh-notes-brand-add dsh-nt', onClick: openNewNote, 'data-tooltip': '新建笔记（Ctrl+N）' }, I('plus', 13))),
              e('div', { className: 'dsh-notes-quick' },
                I('search', 14),
                e('input', { ref: searchInputRef, className: 'dsh-notes-quick-input', placeholder: '搜索笔记、标签、内容…', value: searchText, onChange: (ev) => { searchRef.current = ev.target.value; setSearchText(ev.target.value); setSearchIds(null); setVisibleCount(PAGE_SIZE); if (searchDebRef.current) searchDebRef.current() } }),
                e('span', { className: 'dsh-notes-kbd' }, 'Ctrl K')),
              // ===== 筛选中心控制行（design/notes-filter-center.html）：筛选按钮(N) + 激活条件 chips（单行横滚，× 单条移除）+ 独立排序控件 =====
              // 常态度 UI 只有 筛选按钮 + 排序控件（+ 激活 chips）；popover 是唯一条件编辑入口（浮层，不挤压树区）
              e('div', { className: 'dsh-notes-filterbar' },
                e('button', { className: 'dsh-notes-fbtn-filter' + (filterCount > 0 || filterOpen ? ' on' : '') + ' dsh-nt', onClick: () => { setFilterOpen(!filterOpen); if (!filterOpen) setSortOpen(false) }, 'aria-expanded': filterOpen ? 'true' : 'false', 'data-tooltip': '筛选中心：分组勾选条件（组内 OR / 跨组 AND）' }, I('filter', 11), '筛选', filterCount > 0 ? e('span', { className: 'dsh-notes-fcnt' }, String(filterCount)) : null),
                e('div', { className: 'dsh-notes-fchips' },
                  FILTER_STATUS.filter(f => filters[f.id]).map(f => e('span', { key: f.id, className: 'dsh-notes-fchip dsh-nt', 'data-tooltip': '筛选条件：状态 / ' + f.label + '（点 × 移除）' }, I(f.icon, 10), f.label, e('span', { className: 'dsh-notes-fchip-x', onClick: () => setFilters(Object.assign({}, filters, { [f.id]: false })) }, I('x', 9)))),
                  filters.kinds.map(k => e('span', { key: 'k-' + k, className: 'dsh-notes-fchip dsh-nt', 'data-tooltip': '筛选条件：类型 / ' + KIND_LABELS[k] + '（点 × 移除）' }, e('span', { className: 'dsh-notes-fchip-dot', style: { background: 'var(--nkind-' + k + ')' } }), KIND_LABELS[k], e('span', { className: 'dsh-notes-fchip-x', onClick: () => setFilters(Object.assign({}, filters, { kinds: filters.kinds.filter(x => x !== k) })) }, I('x', 9))))),
                e('div', { className: 'dsh-notes-fsort-wrap' },
                  e('button', { className: 'dsh-notes-fsort-btn' + (sortBy !== 'time' || sortOpen ? ' on' : '') + ' dsh-nt', onClick: () => { setSortOpen(!sortOpen); if (!sortOpen) setFilterOpen(false) }, 'data-tooltip': '排序（与筛选正交，互不重置）' }, I('sort', 11), sortLabel),
                  sortOpen ? e('div', { className: 'dsh-notes-fsort-menu' },
                    FILTER_SORTS.map(s => e('div', { key: s.id, className: 'dsh-notes-fsort-item' + (sortBy === s.id ? ' on' : ''), onClick: () => { setSortBy(s.id); setSortOpen(false) } }, e('span', { className: 'dsh-notes-fsort-tick' }, I('check', 11)), s.label, e('span', { className: 'dsh-notes-fsort-sd' }, s.desc)))) : null),
                filterOpen ? e('div', { className: 'dsh-notes-fpop' },
                  e('div', { className: 'dsh-notes-fg-h' }, e('span', null, '状态'), e('span', { className: 'dsh-notes-fg-rule' }, '组内多选 = OR')),
                  FILTER_STATUS.filter(f => f.id !== 'injectEver' || hasInjectEver).map(f => e('label', { key: f.id, className: 'dsh-notes-fg-item' },
                    e('input', { type: 'checkbox', checked: filters[f.id] === true, onChange: (ev) => { setFilters(Object.assign({}, filters, { [f.id]: ev.target.checked })); if (searchDebRef.current) searchDebRef.current() } }),
                    I(f.icon, 11), e('span', { className: 'dsh-notes-fg-fl' }, f.label), e('span', { className: 'dsh-notes-fg-cnt' }, String(notes.filter(f.pred).length)))),
                  e('div', { className: 'dsh-notes-fg-h' }, e('span', null, '类型'), e('span', { className: 'dsh-notes-fg-rule' }, '组内 OR · 与状态组 = AND')),
                  FILTER_KINDS.map(k => e('label', { key: k, className: 'dsh-notes-fg-item' },
                    e('input', { type: 'checkbox', checked: filters.kinds.indexOf(k) >= 0, onChange: (ev) => { setFilters(Object.assign({}, filters, { kinds: ev.target.checked ? filters.kinds.concat(k) : filters.kinds.filter(x => x !== k) })); if (searchDebRef.current) searchDebRef.current() } }),
                    e('span', { className: 'dsh-notes-fg-dot', style: { background: 'var(--nkind-' + k + ')' } }), e('span', { className: 'dsh-notes-fg-fl' }, KIND_LABELS[k]), e('span', { className: 'dsh-notes-fg-cnt' }, String(notes.filter(n => (n.kind || 'note') === k).length)))),
                  e('div', { className: 'dsh-notes-fpop-foot' },
                    e('span', { className: 'dsh-notes-fpop-pcnt' }, '命中 ' + filtered.length + ' 条'),
                    e('button', { className: 'dsh-notes-pbtn', onClick: () => { setFilters(FILTERS0()); if (searchDebRef.current) searchDebRef.current() } }, '清空'),
                    e('button', { className: 'dsh-notes-pbtn primary', onClick: () => setFilterOpen(false) }, '完成'))) : null),
              e('div', { className: 'dsh-notes-tree', onScroll: onListScroll },
                treeEls,
                hasMore ? e('div', { className: 'dsh-notes-more' }, '继续滚动加载更多（已显示 ' + paged.length + ' / ' + filtered.length + '）') : null),
              // 底部：回收站 + 选择（多选合并，自旧 chips 行迁入）+ 设置；导出/导入 → 设置卡片「数据」区，整理建议 → 设置卡片「整理建议」行（open* 逻辑不变）
              e('div', { className: 'dsh-notes-side-foot' },
                e('span', { className: 'dsh-notes-fbtn dsh-nt', onClick: openTrash, 'data-tooltip': '回收站：查看已删除的笔记，可恢复或彻底删除' }, I('trash', 12), '回收站'),
                e('span', { className: 'dsh-notes-fbtn' + (selMode ? ' on' : '') + ' dsh-nt', onClick: toggleSelMode, 'data-tooltip': '多选笔记：勾选后可合并为一篇（Esc 退出）' }, I('check', 12), '选择'),
                e('span', { className: 'dsh-notes-fbtn dsh-nt', onClick: openSettings, 'data-tooltip': '设置' }, I('gear', 12), '设置'))),
            // ===== 侧栏分隔条：4px 拖拽条，叠加在两栏 10px 间隙上不占位（负 margin 抵消 gap）；hover/拖拽中高亮；双击重置 =====
            e('div', { className: 'dsh-notes-splitter dsh-nt' + (sideDrag ? ' on' : ''), onMouseDown: onSplitterMouseDown, onDoubleClick: resetSideW, 'data-tooltip': '拖拽调整侧栏宽度（双击重置）' }),
            editorEl),
          e('div', { className: 'dsh-notes-resize-handle dsh-nt', style: { position: 'absolute', bottom: 0, right: 0 }, onMouseDown: (ev) => onResizeMouseDown('se', ev), 'data-tooltip': '拖拽调整' }),
          error && !dispatchOpen && !exportOpen && !sExportOpen && !importOpen && !pruneOpen && !trashOpen && !injectPreviewOpen && !suggestOpen ? e('div', { className: 'dsh-notes-error' }, error) : null,
          // 派发对话框（modal）：todo 上下文预览 + 补充具体要求 + 已有/新建会话（级联下拉）
          (dispatchOpen && curNote) ? e('div', { className: 'dsh-notes-dispatch-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setDispatchOpen(false) } },
            e('div', { className: 'dsh-notes-dispatch-modal' },
              e('div', { className: 'dsh-notes-dispatch-modal-t' }, I('play', 13), ' 派发待办', e('span', { style: { fontSize: '10px', color: 'var(--nt3)', fontWeight: 400, marginLeft: '8px' } }, '工作区' + wsList.length + ' / 活跃会话' + activeSessions.length + (dispatchPending.length ? '（+' + dispatchPending.length + ' 标题加载中…）' : ''))),
              e('div', { className: 'dsh-notes-dispatch-todo' },
                e('div', { className: 'dsh-notes-dispatch-todo-t' }, curNote.title || 'Untitled'),
                e('div', { className: 'dsh-notes-dispatch-todo-b' }, String(curNote.preview || '').trim() || '（无正文）')),
              e('textarea', { className: 'dsh-notes-dispatch-instr', placeholder: '补充具体要求 / 指令（可选）…', value: dispatchInstr, onChange: (ev) => setDispatchInstr(ev.target.value), rows: 3 }),
              e('div', { className: 'dsh-notes-dispatch-modes' },
                e('button', { className: 'dsh-notes-dispatch-mode' + (dispatchMode === 'existing' ? ' on' : ''), onClick: () => setDispatchMode('existing') }, '已有会话'),
                e('button', { className: 'dsh-notes-dispatch-mode' + (dispatchMode === 'new' ? ' on' : ''), onClick: () => setDispatchMode('new') }, '新建会话')),
              dispatchMode === 'existing' ? e(React.Fragment, null,
                e('select', { className: 'dsh-notes-dispatch-select', value: dispatchSessWs, onChange: (ev) => { setDispatchSessWs(ev.target.value); setDispatchSessId('') } },
                  e('option', { value: '' }, '选择工作区…'),
                  wsList.map(w => e('option', { key: w.id, value: w.title }, w.title))),
                e('select', { className: 'dsh-notes-dispatch-select', value: dispatchSessId, onChange: (ev) => setDispatchSessId(ev.target.value), disabled: !dispatchSessWs },
                  e('option', { value: '' }, dispatchSessWs ? ((dispatchSessByWs[dispatchSessWs] || []).length ? '选择会话…' : '该工作区暂无会话') : '先选工作区'),
                  (dispatchSessByWs[dispatchSessWs] || []).map(s => e('option', { key: s.id, value: s.id, disabled: !!s.pending }, s.pending ? (s.short + ' · 标题加载中…') : (s.name + (s.live ? '' : '（未打开）'))))))
              : e('select', { className: 'dsh-notes-dispatch-select', value: dispatchWsId, onChange: (ev) => setDispatchWsId(ev.target.value) },
                  e('option', { value: '' }, '选择工作区（在其下新建会话）…'),
                  wsList.map(w => e('option', { key: w.id, value: w.id }, w.title))),
              error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
              e('div', { className: 'dsh-notes-dispatch-actions' },
                e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setDispatchOpen(false) }, '取消'),
                e('button', { className: 'dsh-notes-dispatch-ok', onClick: doDispatchConfirm, disabled: dispatching }, dispatching ? '派发中…' : '派发'))))
          : null,
          // 设置卡片（modal，居中，复用派发 modal 的 mask/modal 风格）：通用结构——标题「设置」+ 设置项行列表
          // （每行：左 label + 右控件）。以后加设置项只需往 settingsRows 数组加行，结构不变。
          // 交互：选择即保存（notes-settings-set）；点遮罩 / Esc 关闭（Esc 在全局 keydown 里优先关本卡片）。
          settingsOpen ? (() => {
            const modelList = (settingsData && settingsData.models) || []
            // 下拉选项 = provider/model 组合，第一项「跟随当前会话（默认）」；
            // 已保存值不在列表中（如模型已下线）时追加一项保证回显正确
            const selIdx = modelList.findIndex(m => m.provider === setLlmProvider && m.model === setLlmModel)
            const opts = (setLlmProvider && setLlmModel && selIdx < 0)
              ? modelList.concat([{ provider: setLlmProvider, model: setLlmModel, label: setLlmProvider + ' / ' + setLlmModel + '（已保存）' }])
              : modelList
            const curVal = selIdx >= 0 ? String(selIdx) : (opts.length > modelList.length ? String(opts.length - 1) : '')
            const llmControl = modelList.length
              ? e('select', { className: 'dsh-notes-settings-select', value: curVal, 'data-tooltip': '笔记自动分类 / 指令提取使用的模型', onChange: (ev) => {
                    const v = ev.target.value
                    if (v === '') { setSetLlmProvider(''); setSetLlmModel(''); saveSettingsLlm(null) }
                    else { const m = opts[+v]; if (m) { setSetLlmProvider(m.provider); setSetLlmModel(m.model); saveSettingsLlm({ provider: m.provider, model: m.model }) } }
                  } },
                  e('option', { value: '' }, '跟随当前会话（默认）'),
                  opts.map((m, i) => e('option', { key: m.provider + '/' + m.model + '-' + i, value: String(i) }, m.label || (m.provider + ' / ' + m.model))))
              : e(React.Fragment, null,
                  e('input', { className: 'dsh-notes-settings-input', placeholder: 'provider', value: setLlmProvider, onChange: (ev) => setSetLlmProvider(ev.target.value), onBlur: saveSettingsLlmManual, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsLlmManual() } }),
                  e('input', { className: 'dsh-notes-settings-input', placeholder: 'model', value: setLlmModel, onChange: (ev) => setSetLlmModel(ev.target.value), onBlur: saveSettingsLlmManual, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsLlmManual() } }),
                  (setLlmProvider || setLlmModel) ? e('button', { className: 'dsh-notes-settings-clear', onClick: () => { setSetLlmProvider(''); setSetLlmModel(''); saveSettingsLlm(null) } }, '跟随当前会话（默认）') : null)
            // 目录注入总开关控件：checkbox 勾选即保存（catalogEnabled，缺省开）；label 挂 tooltip 说明注入形态
            const catalogControl = e('label', { className: 'dsh-notes-settings-checkwrap dsh-nt', 'data-tooltip': '向 Agent 系统提示注入笔记目录（一行一条），供其规划时参考并按需 note_get 取全文' },
              e('input', { type: 'checkbox', className: 'dsh-notes-settings-check', checked: setCatalog, onChange: (ev) => { const v = !!ev.target.checked; setSetCatalog(v); saveSettingsCatalog(v) } }),
              setCatalog ? '已开启' : '已关闭')
            // P1 时效衰减提醒控件：数值输入（天），失焦/Enter 即保存；0 = 关闭
            const staleControl = e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 1, value: setStale, 'data-tooltip': '目录行对超过 N 天未更新的笔记/链接追加「 ⚠ N 天未更新」标注；0 = 关闭', onChange: (ev) => setSetStale(ev.target.value), onBlur: saveSettingsStale, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsStale() } })
            // P1 注入体积预算控件：数值输入（约，字符数）+ 仪表（最近一次注入体积 vs 预算，超预算变红）；约定条目永不截断
            const lastChars = (settingsData && typeof settingsData.lastInjectChars === 'number') ? settingsData.lastInjectChars : 0
            const budgetNum = /^\d+$/.test(setBudget.trim()) ? parseInt(setBudget.trim(), 10) : 0
            const gaugePct = budgetNum > 0 ? Math.min(100, Math.round(lastChars / budgetNum * 100)) : 0
            const budgetControl = e('div', { style: { width: '100%' } },
              e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 100, value: setBudget, 'data-tooltip': '单次注入笔记全文的上限（约，按字符数近似）；约定条目永不截断，资料条目从最旧开始省略；0 = 不限', onChange: (ev) => setSetBudget(ev.target.value), onBlur: saveSettingsBudget, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsBudget() } }),
              e('div', { className: 'dsh-notes-inject-gauge dsh-nt', 'data-tooltip': '最近一次注入的笔记全文体积（约，按字符数）' },
                e('div', { className: 'dsh-notes-inject-gauge-bar' + (budgetNum > 0 && lastChars > budgetNum ? ' over' : ''), style: { width: gaugePct + '%' } })),
              e('span', { className: 'dsh-notes-inject-gauge-t' }, '当前注入约 ' + lastChars + ' 字符' + (budgetNum > 0 ? ' / 预算约 ' + budgetNum + ' 字符' : '（不限）')))
            // 数据区控件：导出全部（目录快照）/ 导出单文件…（P3 scope 拼接 + 图片内联）/ 导入…（两步式预览后执行）/ 回收站（底部收敛后的兜底入口）；点击即关设置卡片、开各自对话框
            const dataControl = e(React.Fragment, null,
              e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': '把整个笔记库（含 folders.json）快照到目标目录', onClick: openExport }, '导出全部'),
              e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': '按范围（全部/文件夹/标签）拼接为单个 Markdown 文件：图片 base64 内联，可直接分享；超 20MB 告警仍导出', onClick: openSExport }, '导出单文件…'),
              e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': '从目录快照导入：先预览明细再执行，只增改不删、自动备份', onClick: openImport }, '导入…'),
              e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': '回收站：查看已删除的笔记，可恢复或彻底删除', onClick: openTrash }, '回收站'))
            // 二期 资产清理控件：notes-assets-prune dry-run 预览 → 勾选删除（点击即关设置卡片、开预览对话框）
            const assetsControl = e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': '预览 assets/ 中未被任何笔记引用的孤儿文件，勾选后删除（dry-run 先行，零写入）', onClick: openPrune }, '清理…')
            // 整理建议控件：打开三段式建议 modal（点击即关设置卡片、modal 不叠 modal）——底部「整理」按钮收敛后此处为入口
            const suggestControl = e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': '整理建议：速记组归档 / 过期未引用清理 / 孤儿笔记候选（只提名不自动执行）', onClick: openSuggest }, '打开')
            // 注入预览控件：打开预览 modal（点击即关设置卡片、modal 不叠 modal）——agent 实际收到的注入文本即所见
            const injPrevControl = e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': '预览 Agent 系统提示中实际注入的笔记文本（约定桶 + 目录桶），含敏感打码 / 时效标注 / 预算截断效果；可按会话过滤', onClick: openInjectPreview }, '预览…')
            // 通用设置项行列表：以后加设置项只需往这里加行
            const settingsRows = [
              { key: 'llm', label: 'LLM 模型', sub: '笔记自动分类 / 指令提取使用的模型', control: llmControl },
              { key: 'catalog', label: '笔记目录注入', sub: '向 Agent 系统提示注入笔记目录（一行一条），供其规划时参考并按需 note_get 取全文', control: catalogControl },
              { key: 'stale', label: '时效衰减提醒', sub: '目录行对超过 N 天未更新的笔记/链接追加「 ⚠ N 天未更新」标注（提醒参考资料可能过期）；0 = 关闭', control: staleControl },
              { key: 'budget', label: '注入体积预算', sub: '单次注入笔记全文的上限（约，按字符数近似）；约定条目永不截断，资料条目从最旧开始省略；0 = 不限', control: budgetControl },
              { key: 'injprev', label: '注入预览', sub: '查看 Agent 实际收到的注入文本（约定 + 目录）：敏感打码 / 时效标注 / 预算截断效果即所见；可按会话过滤', control: injPrevControl },
              { key: 'data', label: '数据', sub: '全库目录快照导出 / 单文件拼接导出（图片内联，可分享）/ 从快照目录导入（只增改不删，导入前自动全量备份）/ 回收站兜底（恢复或彻底删除）', control: dataControl },
              { key: 'assets', label: '资产清理', sub: '扫描 assets/ 中未被任何笔记引用的孤儿文件（已删除笔记的引用仍计入保护，宁留勿删）', control: assetsControl },
              { key: 'suggest', label: '整理建议', sub: '速记组归档 / 过期未引用清理 / 孤儿笔记候选（只提名不自动执行）', control: suggestControl },
            ]
            return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setSettingsOpen(false) } },
              e('div', { className: 'dsh-notes-settings-modal' },
                e('div', { className: 'dsh-notes-settings-modal-t' }, I('gear', 14), ' 设置'),
                e('div', { className: 'dsh-notes-settings-list' },
                  settingsRows.map(row => e('div', { key: row.key, className: 'dsh-notes-settings-row' },
                    e('div', { className: 'dsh-notes-settings-label' }, row.label, row.sub ? e('span', { className: 'dsh-notes-settings-label-s' }, row.sub) : null),
                    e('div', { className: 'dsh-notes-settings-control' }, row.control)))),
                error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null))
          })()
          : null,
          // 导出对话框（设置卡片「数据」区入口；mask/modal 复用设置卡片风格）：选目标目录 → notes-export → 成功 toast 含快照路径
          exportOpen ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setExportOpen(false) } },
            e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
              e('div', { className: 'dsh-notes-settings-modal-t' }, I('up', 14), ' 导出全部笔记'),
              e('div', { className: 'dsh-notes-data-hint' }, '把整个笔记库（含 folders.json）完整快照到目标目录下的 dsh-notes-export-<时间戳> 子目录，不打包不压缩，目录即格式。'),
              e('input', { className: 'dsh-notes-data-input', placeholder: '目标目录，如 D:\\backup 或桌面路径…', value: exportDir, autoFocus: true, onChange: (ev) => setExportDir(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doExport() } } }),
              error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
              e('div', { className: 'dsh-notes-dispatch-actions' },
                e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setExportOpen(false) }, '取消'),
                e('button', { className: 'dsh-notes-dispatch-ok', onClick: doExport, disabled: exportPending || !exportDir.trim() }, exportPending ? '导出中…' : '导出'))))
          : null,
          // P3 单文件导出对话框（设置卡片「数据」区「导出单文件…」入口；mask/modal 复用导出对话框风格）：
          // scope 三选一（全部/文件夹/标签，联动下拉）+ 目录页开关 + 目标目录 → notes-export-single → toast 含文件路径（>20MB 带 warning）
          sExportOpen ? (() => {
            const tagSet = {}
            for (const n of notes) for (const tg of (n.tags || [])) tagSet[tg] = true
            const tagOptions = Object.keys(tagSet).sort()
            return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setSExportOpen(false) } },
              e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
                e('div', { className: 'dsh-notes-settings-modal-t' }, I('note', 14), ' 导出单文件'),
                e('div', { className: 'dsh-notes-data-hint' }, '把所选范围的笔记拼接为单个 Markdown 文件（每篇 = 标题 + 元信息 + 正文，篇间分隔线）：图片 base64 内联、零外部依赖，可直接分享。超过 20MB 会告警但仍照常导出。'),
                e('div', { className: 'dsh-notes-dispatch-modes' },
                  [['all', '全部'], ['folder', '按文件夹'], ['tag', '按标签']].map(pair => e('button', { key: pair[0], className: 'dsh-notes-dispatch-mode' + (sExportScope === pair[0] ? ' on' : ''), onClick: () => setSExportScope(pair[0]) }, pair[1]))),
                sExportScope === 'folder' ? e('select', { className: 'dsh-notes-dispatch-select', value: sExportFolder, onChange: (ev) => setSExportFolder(ev.target.value) },
                  e('option', { value: '' }, '选择文件夹…'),
                  folders.map(f => e('option', { key: f.id, value: f.id }, f.name + '（' + (f.count || 0) + '）')))
                : null,
                sExportScope === 'tag' ? e('select', { className: 'dsh-notes-dispatch-select', value: sExportTag, onChange: (ev) => setSExportTag(ev.target.value) },
                  e('option', { value: '' }, tagOptions.length ? '选择标签…' : '（笔记暂无标签）'),
                  tagOptions.map(tg => e('option', { key: tg, value: tg }, tg)))
                : null,
                e('label', { className: 'dsh-notes-settings-checkwrap dsh-nt', 'data-tooltip': '在文档头部生成目录页（篇名 + id 清单）' },
                  e('input', { type: 'checkbox', className: 'dsh-notes-settings-check', checked: sExportToc, onChange: (ev) => setSExportToc(!!ev.target.checked) }),
                  '生成目录页'),
                e('input', { className: 'dsh-notes-data-input', placeholder: '目标目录，如 D:\\backup 或桌面路径…', value: sExportDir, autoFocus: true, onChange: (ev) => setSExportDir(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doSExport() } } }),
                error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
                e('div', { className: 'dsh-notes-dispatch-actions' },
                  e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setSExportOpen(false) }, '取消'),
                  e('button', { className: 'dsh-notes-dispatch-ok', onClick: doSExport, disabled: sExportPending || !sExportDir.trim() || (sExportScope === 'folder' && !sExportFolder) || (sExportScope === 'tag' && !sExportTag) }, sExportPending ? '导出中…' : '导出'))))
          })()
          : null,
          // 导入对话框（两步式）：第一步选目录 → notes-import-preview 预览明细（新增/相同/不同 + 文件夹合并统计）；
          // 第二步勾选「覆盖内容不同的笔记」（默认不勾）→ danger 按钮执行 notes-import → toast 含备份目录提示 → 刷新列表/文件夹
          importOpen ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setImportOpen(false) } },
            e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
              e('div', { className: 'dsh-notes-settings-modal-t' }, I('down', 14), ' 导入笔记'),
              e('div', { className: 'dsh-notes-data-hint' }, '从目录快照导入（只增改不删）：库中不存在的直接入库，内容相同的跳过，内容不同的默认跳过；执行前自动全量备份当前库。'),
              e('input', { className: 'dsh-notes-data-input', placeholder: '来源目录（dsh-notes-export-… 或 notes-backup-… 目录）…', value: importDir, autoFocus: true, onChange: (ev) => { setImportDir(ev.target.value); if (importPreview) setImportPreview(null) }, onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doImportPreview() } } }),
              importPreview ? (() => {
                const IMP_STATUS_LABELS = { added: '新增', same: '相同', diff: '不同' }
                const folders = importPreview.folders || { total: 0, new: 0 }
                return e(React.Fragment, null,
                  e('div', { className: 'dsh-notes-data-summary' },
                    e('span', { className: 'added' }, '新增 ', e('b', null, importPreview.added)),
                    e('span', null, '相同 ', e('b', null, importPreview.same)),
                    e('span', { className: importPreview.diff ? 'diff' : '' }, '不同 ', e('b', null, importPreview.diff)),
                    folders.total ? e('span', null, '文件夹新增 ', e('b', null, folders.new), ' / 共 ' + folders.total) : null),
                  importPreview.unreadable ? e('div', { className: 'dsh-notes-data-warn' }, '⚠ ' + importPreview.unreadable + ' 个文件无法读取，已跳过') : null,
                  e('div', { className: 'dsh-notes-imp-list' },
                    (importPreview.detail || []).map(d => e('div', { key: d.id, className: 'dsh-notes-imp-row' },
                      e('span', { className: 'dsh-notes-imp-badge ' + d.status }, IMP_STATUS_LABELS[d.status] || d.status),
                      e('span', { className: 'dsh-notes-imp-title', title: d.title || 'Untitled' }, d.title || 'Untitled'),
                      d.deleted ? e('span', { className: 'dsh-notes-imp-deltag' }, '已删除') : null))),
                  e('label', { className: 'dsh-notes-settings-checkwrap dsh-notes-imp-overwrite' + (importPreview.diff ? '' : ' off') },
                    e('input', { type: 'checkbox', className: 'dsh-notes-settings-check', checked: importOverwrite, disabled: !importPreview.diff, onChange: (ev) => setImportOverwrite(!!ev.target.checked) }),
                    '覆盖内容不同的笔记（' + importPreview.diff + ' 条，不勾则跳过）'),
                  error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
                  e('div', { className: 'dsh-notes-dispatch-actions' },
                    e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setImportOpen(false) }, '取消'),
                    e('button', { className: 'dsh-notes-data-danger', onClick: doImportExecute, disabled: importPending }, importPending ? '导入中…' : '执行导入')))
              })()
              : e(React.Fragment, null,
                  error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
                  e('div', { className: 'dsh-notes-dispatch-actions' },
                    e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setImportOpen(false) }, '取消'),
                    e('button', { className: 'dsh-notes-dispatch-ok', onClick: doImportPreview, disabled: importPending || !importDir.trim() }, importPending ? '检查中…' : '预览')))))
          : null,
          // 图片插入弹窗（v3 三入口共用：粘贴/拖拽/工具栏按钮）：选文件 → 预览 + alt → 上传（notes-asset-upload）→ 光标处插入
          imgModal ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget && !imgModal.uploading) setImgModal(null) } },
            e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
              e('div', { className: 'dsh-notes-settings-modal-t' }, I('image', 14), ' 插入图片', e('span', { className: 'dsh-notes-imgup-sub' }, '上传到笔记库 assets/（PNG/JPEG/GIF/WebP，≤5MB；>1MB 的 PNG/JPG 自动压缩转 JPEG）')),
              imgModal.dataURL
                ? e(React.Fragment, null,
                    e('div', { className: 'dsh-notes-imgup-pv' },
                      e('img', { src: imgModal.dataURL, alt: '' }),
                      e('div', null,
                        e('div', { className: 'dsh-notes-imgup-nm' }, imgModal.name),
                        e('div', { className: 'dsh-notes-imgup-sz' }, (imgModal.origSize ? '已压缩 ' + fmtBytes(imgModal.origSize) + ' → ' : '') + (imgModal.size ? fmtBytes(imgModal.size) + ' · ' : '') + (imgModal.mime || '')))),
                    e('input', { className: 'dsh-notes-data-input', placeholder: '替代文本 alt（可留空）', value: imgModal.alt, autoFocus: true, onChange: (ev) => setImgModal(Object.assign({}, imgModal, { alt: ev.target.value })), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doUploadImage() } } }))
                : e('div', { className: 'dsh-notes-imgup-zone', onClick: () => { if (imgFileInputRef.current) imgFileInputRef.current.click() } },
                    '点击选择本地图片文件（也可直接把图片文件拖进编辑区，或 Ctrl+V 粘贴）',
                    e('input', { ref: imgFileInputRef, type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', style: { display: 'none' }, onChange: (ev) => { const f = ev.target.files && ev.target.files[0]; if (f) pickImageFile(f); ev.target.value = '' } })),
              imgModal.uploading ? e('div', { className: 'dsh-notes-imgup-prog on' }, e('i', null)) : null,
              imgModal.error ? e('div', { className: 'dsh-notes-dispatch-err' }, imgModal.error) : null,
              e('div', { className: 'dsh-notes-dispatch-actions' },
                e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setImgModal(null), disabled: imgModal.uploading }, '取消'),
                e('button', { className: 'dsh-notes-dispatch-ok', onClick: doUploadImage, disabled: !imgModal.dataURL || imgModal.uploading }, imgModal.uploading ? '上传中…' : '上传并插入'))))
          : null,
          // 链接插入弹窗（富文本工具栏「链接」按钮，需先选中文字）：URL 仅 http/https
          linkModal ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setLinkModal(null) } },
            e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
              e('div', { className: 'dsh-notes-settings-modal-t' }, I('link', 14), ' 插入链接', e('span', { className: 'dsh-notes-imgup-sub' }, '选中文字：' + (linkModal.text.length > 24 ? linkModal.text.slice(0, 24) + '…' : linkModal.text))),
              e('input', { className: 'dsh-notes-data-input', placeholder: 'https://…', value: linkModal.url, autoFocus: true, onChange: (ev) => setLinkModal(Object.assign({}, linkModal, { url: ev.target.value })), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doInsertLink() } } }),
              e('div', { className: 'dsh-notes-dispatch-actions' },
                e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setLinkModal(null) }, '取消'),
                e('button', { className: 'dsh-notes-dispatch-ok', onClick: doInsertLink }, '插入'))))
          : null,
          // 归档预览对话框（标题栏「归档」→ notes-archive-preview dry-run，零写入）：速记组列表默认全勾——
          // 组行 = 复选框 + 展开 caret + 组标题 + dateSpan · N 条 · totalBytes；caret 展开成员明细（标题+日期）；
          // 底部提示手动笔记走多选合并；「归档所选（N 组）」确认才执行（notes-archive 白名单组）
          archOpen ? (() => {
            const groups = archGroups || []
            const checkedCount = groups.filter(g => archChecked[g.sessionId] !== false).length
            return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setArchOpen(false) } },
              e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal dsh-notes-arch-modal' },
                e('div', { className: 'dsh-notes-settings-modal-t' }, I('check', 14), ' 归档预览', e('span', { className: 'dsh-notes-imgup-sub' }, '勾选后才执行 · 合并可撤销')),
                e('div', { className: 'dsh-notes-data-hint' }, '速记按会话分组，勾选的组合并成一篇归档笔记（原笔记 .bak 备份后软删除）。'),
                archGroups === null
                  ? e('div', { className: 'dsh-notes-data-hint' }, '加载中…')
                  : groups.length === 0
                    ? e('div', { className: 'dsh-notes-data-hint' }, '没有可归档的速记组（同一会话 ≥2 条速记才会成组）。')
                    : e('div', { className: 'dsh-notes-arch-list' },
                        groups.map(g => {
                          const checked = archChecked[g.sessionId] !== false
                          const expanded = archExpand[g.sessionId] === true
                          const span = g.dateSpan && g.dateSpan.from ? (g.dateSpan.from === g.dateSpan.to ? g.dateSpan.from : g.dateSpan.from + ' ~ ' + g.dateSpan.to) : ''
                          return e('div', { key: g.sessionId, className: 'dsh-notes-arch-group' + (checked ? '' : ' off') },
                            e('div', { className: 'dsh-notes-arch-row' },
                              e('input', { type: 'checkbox', className: 'dsh-notes-settings-check', checked: checked, onChange: () => setArchChecked(Object.assign({}, archChecked, { [g.sessionId]: !checked })) }),
                              e('span', { className: 'dsh-notes-caret' + (expanded ? ' open' : ''), onClick: () => setArchExpand(Object.assign({}, archExpand, { [g.sessionId]: !expanded })) }, I('chev', 10)),
                              e('span', { className: 'dsh-notes-arch-ti', title: g.title }, g.title),
                              e('span', { className: 'dsh-notes-arch-meta' }, span + ' · ' + g.members.length + ' 条 · ' + fmtBytes(g.totalBytes) + ((g.totalUseCount || 0) > 0 ? ' · 被引用 ' + g.totalUseCount + ' 次' : ''))),
                            expanded ? e('div', { className: 'dsh-notes-arch-members' },
                              g.members.map(m => e('div', { key: m.id, className: 'dsh-notes-arch-member' },
                                e('span', { className: 'dsh-notes-arch-member-ti' }, m.title || '无标题'),
                                e('span', { className: 'dsh-notes-arch-member-dt' }, (m.updatedAt || '').slice(0, 10))))) : null)
                        })),
                e('div', { className: 'dsh-notes-data-hint' }, '手动笔记不受影响；如需合并手动笔记，请在列表多选后右键合并。'),
                error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
                e('div', { className: 'dsh-notes-dispatch-actions' },
                  e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setArchOpen(false) }, '取消'),
                  e('button', { className: 'dsh-notes-dispatch-ok', onClick: doArchiveConfirm, disabled: archPending || checkedCount === 0 }, archPending ? '归档中…' : '归档所选（' + checkedCount + ' 组）'))))
          })()
          : null,
          // 资产清理对话框（设置卡片「资产清理」入口；复用归档预览的列表样式）：dry-run 孤儿清单默认全勾，
          // 行 = 复选框 + 文件名 + 字节数；底部统计扫描笔记数/引用中/墓碑；「删除所选（N 项 · x KB）」danger 确认才执行
          pruneOpen ? (() => {
            const orphans = (pruneData && pruneData.orphans) || []
            const checked = orphans.filter(o => pruneChecked[o.name] !== false)
            const checkedBytes = checked.reduce((s, o) => s + (o.bytes || 0), 0)
            return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget && !prunePending) setPruneOpen(false) } },
              e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal dsh-notes-arch-modal' },
                e('div', { className: 'dsh-notes-settings-modal-t' }, I('trash', 14), ' 资产清理', e('span', { className: 'dsh-notes-imgup-sub' }, '预览勾选后才删除 · 宁留勿删')),
                e('div', { className: 'dsh-notes-data-hint' }, 'assets/ 中未被任何笔记正文引用的文件（已删除笔记的引用仍计入保护）。' + (pruneData && pruneData.notes != null ? '已扫描 ' + pruneData.notes + ' 条笔记：引用中 ' + (pruneData.referenced || 0) + ' 个，历史清理占位 ' + (pruneData.tombstoned || 0) + ' 个。' : '')),
                pruneData === null
                  ? e('div', { className: 'dsh-notes-data-hint' }, '扫描中…')
                  : orphans.length === 0
                    ? e('div', { className: 'dsh-notes-data-hint' }, '没有孤儿资产（assets/ 全部文件均被引用）。')
                    : e('div', { className: 'dsh-notes-arch-list' },
                        orphans.map(o => e('div', { key: o.name, className: 'dsh-notes-arch-row' },
                          e('input', { type: 'checkbox', className: 'dsh-notes-settings-check', checked: pruneChecked[o.name] !== false, onChange: () => setPruneChecked(Object.assign({}, pruneChecked, { [o.name]: pruneChecked[o.name] === false })) }),
                          e('span', { className: 'dsh-notes-arch-ti', title: o.name }, o.name),
                          e('span', { className: 'dsh-notes-arch-meta' }, fmtBytes(o.bytes))))),
                error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
                e('div', { className: 'dsh-notes-dispatch-actions' },
                  e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setPruneOpen(false), disabled: prunePending }, '取消'),
                  e('button', { className: 'dsh-notes-data-danger', onClick: doPruneConfirm, disabled: prunePending || checked.length === 0 }, prunePending ? '删除中…' : '删除所选（' + checked.length + ' 项 · ' + fmtBytes(checkedBytes) + '）'))))
          })()
          : null,
          // P1 回收站对话框（侧栏底部「回收站」入口；复用归档预览的列表样式）：
          // 行 = 标题 + 删除时间（updatedAt 近似）+「恢复」/「彻底删除」按钮；彻底删除 confirm 双确认（不可恢复）
          trashOpen ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget && !trashPending) setTrashOpen(false) } },
            e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal dsh-notes-arch-modal' },
              e('div', { className: 'dsh-notes-settings-modal-t' }, I('trash', 14), ' 回收站', e('span', { className: 'dsh-notes-imgup-sub' }, '软删除的笔记 · 恢复可找回 · 彻底删除不可恢复')),
              trashList === null
                ? e('div', { className: 'dsh-notes-data-hint' }, '加载中…')
                : trashList.length === 0
                  ? e('div', { className: 'dsh-notes-data-hint' }, '回收站为空（删除的笔记会出现在这里）。')
                  : e('div', { className: 'dsh-notes-arch-list' },
                      trashList.map(n => e('div', { key: n.id, className: 'dsh-notes-arch-row' },
                        e('span', { className: 'dsh-notes-arch-ti', title: n.title || 'Untitled' }, n.title || 'Untitled'),
                        e('span', { className: 'dsh-notes-arch-meta' }, '删于 ' + (n.updatedAt ? String(n.updatedAt).slice(0, 10) : '—')),
                        e('button', { className: 'dsh-notes-trash-act', onClick: () => doTrashRestore(n.id), disabled: !!trashPending }, '恢复'),
                        e('button', { className: 'dsh-notes-trash-act danger', onClick: () => doTrashPurge(n.id, n.title), disabled: !!trashPending }, '彻底删除')))),
              error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
              e('div', { className: 'dsh-notes-dispatch-actions' },
                e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setTrashOpen(false), disabled: !!trashPending }, '关闭'))))
          : null,
          // 整理建议对话框（设置卡片「整理建议」行入口；复用归档预览的列表样式）：
          // 三段式——① 可整理的速记组（「去归档」直达归档预览对话框，数据与 notes-archive-preview 同源）
          //          ② 过期未引用（超 staleDays 且 useCount=0；「一键批量软删除」confirm 后才逐条 notes-delete）
          //          ③ 可能无用（孤儿候选：启发式判定可能误伤，仅展示逐条「查看」跳转，不提供批量操作）
          suggestOpen ? (() => {
            const d = suggestData
            const arch = (d && d.archiveCandidates) || []
            const stale = (d && d.staleCandidates) || []
            const orphans = (d && d.orphanCandidates) || []
            const allEmpty = d !== null && arch.length === 0 && stale.length === 0 && orphans.length === 0
            return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget && !suggestPending) setSuggestOpen(false) } },
              e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal dsh-notes-arch-modal dsh-notes-suggest-modal' },
                e('div', { className: 'dsh-notes-settings-modal-t' }, I('sparkle', 14), ' 整理建议', e('span', { className: 'dsh-notes-imgup-sub' }, '只提名不自动执行 · 软删除可恢复')),
                d === null
                  ? e('div', { className: 'dsh-notes-data-hint' }, '分析中…')
                  : allEmpty
                    ? e('div', { className: 'dsh-notes-data-hint' }, '库很干净，无需整理。')
                    : e(React.Fragment, null,
                        e('div', { className: 'dsh-notes-suggest-sec' },
                          e('div', { className: 'dsh-notes-suggest-sec-t' }, '可整理的速记组', e('span', { className: 'dsh-notes-suggest-sec-n' }, arch.length + ' 组'),
                            arch.length ? e('button', { className: 'dsh-notes-trash-act', onClick: suggestGoArchive }, '去归档') : null),
                          arch.length
                            ? e('div', { className: 'dsh-notes-arch-list' },
                                arch.map(g => {
                                  const span = g.dateSpan && g.dateSpan.from ? (g.dateSpan.from === g.dateSpan.to ? g.dateSpan.from : g.dateSpan.from + ' ~ ' + g.dateSpan.to) : ''
                                  return e('div', { key: g.sessionId, className: 'dsh-notes-arch-row' },
                                    e('span', { className: 'dsh-notes-arch-ti', title: g.title }, g.title),
                                    e('span', { className: 'dsh-notes-arch-meta' }, span + ' · ' + g.members.length + ' 条 · ' + fmtBytes(g.totalBytes) + ((g.totalUseCount || 0) > 0 ? ' · 被引用 ' + g.totalUseCount + ' 次' : '')))
                                }))
                            : e('div', { className: 'dsh-notes-data-hint' }, '没有可归档的速记组（同一会话 ≥2 条速记才会成组）。')),
                        e('div', { className: 'dsh-notes-suggest-sec' },
                          e('div', { className: 'dsh-notes-suggest-sec-t' }, '过期未引用', e('span', { className: 'dsh-notes-suggest-sec-n' }, stale.length + ' 条'),
                            stale.length ? e('button', { className: 'dsh-notes-trash-act danger', onClick: doSuggestBatchDelete, disabled: suggestPending }, suggestPending ? '删除中…' : '一键批量软删除') : null),
                          stale.length
                            ? e('div', { className: 'dsh-notes-arch-list' },
                                stale.map(n => e('div', { key: n.id, className: 'dsh-notes-arch-row' },
                                  e('span', { className: 'dsh-notes-arch-ti', title: n.title || 'Untitled' }, n.title || 'Untitled'),
                                  e('span', { className: 'dsh-notes-arch-meta' }, (n.topic || '未分类') + ' · ' + n.staleDays + ' 天未更新'))))
                            : e('div', { className: 'dsh-notes-data-hint' }, '没有过期且从未被引用的笔记。')),
                        e('div', { className: 'dsh-notes-suggest-sec' },
                          e('div', { className: 'dsh-notes-suggest-sec-t' }, '可能无用', e('span', { className: 'dsh-notes-suggest-sec-n' }, orphans.length + ' 条')),
                          orphans.length
                            ? e('div', { className: 'dsh-notes-arch-list' },
                                orphans.map(n => e('div', { key: n.id, className: 'dsh-notes-arch-row' },
                                  e('span', { className: 'dsh-notes-arch-ti', title: n.title || 'Untitled' }, n.title || 'Untitled'),
                                  e('span', { className: 'dsh-notes-arch-meta' }, (n.topic || '未分类') + ' · ' + (n.updatedAt ? String(n.updatedAt).slice(0, 10) : '—')),
                                  e('button', { className: 'dsh-notes-trash-act', onClick: () => suggestViewNote(n.id) }, '查看'))))
                            : e('div', { className: 'dsh-notes-data-hint' }, '没有孤儿笔记（无双链关联且从未被引用）。')),
                        e('div', { className: 'dsh-notes-data-hint' }, '判定口径：过期 = 超过时效阈值（设置卡片可调）且从未被引用；可能无用 = 无 [[双链]] 关联、未注入、从未被引用的进行中普通笔记（启发式，请逐条过目）。')),
                error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
                e('div', { className: 'dsh-notes-dispatch-actions' },
                  e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setSuggestOpen(false), disabled: suggestPending }, '关闭'))))
          })()
          : null,
          // 注入预览对话框（设置卡片「注入预览」入口；mask/modal 复用设置卡片风格）：
          // 双 tab（约定/目录）+ 会话过滤下拉（sessList，含「全局」）+ 只读等宽文本区 + 底部统计条（总字符/打码/时效标注/预算截断）
          injectPreviewOpen ? (() => {
            const d = injectPreviewData
            const stats = d && d.stats ? d.stats : null
            const text = !d ? '' : (injectPreviewTab === 'cat' ? (d.catalog || '') : (d.conventions || ''))
            // 会话下拉 = 全局 + sessList（注入范围浮层同数据源）；已选值不在列表时追加一项保证回显
            const sidOpts = sessList.slice()
            if (injectPreviewSid && !sidOpts.find(s => s.short === injectPreviewSid)) sidOpts.push({ short: injectPreviewSid, name: '' })
            return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setInjectPreviewOpen(false) } },
              e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal dsh-notes-injprev-modal' },
                e('div', { className: 'dsh-notes-settings-modal-t' }, I('eye', 14), ' 注入预览', e('span', { className: 'dsh-notes-imgup-sub' }, 'Agent 实际收到的注入文本 · 只读')),
                e('div', { className: 'dsh-notes-injprev-bar' },
                  e('div', { className: 'dsh-notes-injprev-tabs' },
                    e('button', { className: 'dsh-notes-injprev-tab' + (injectPreviewTab === 'conv' ? ' on' : ''), onClick: () => setInjectPreviewTab('conv') }, '约定'),
                    e('button', { className: 'dsh-notes-injprev-tab' + (injectPreviewTab === 'cat' ? ' on' : ''), onClick: () => setInjectPreviewTab('cat') }, '目录')),
                  e('select', { className: 'dsh-notes-settings-select dsh-notes-injprev-sess', value: injectPreviewSid, 'data-tooltip': '按会话过滤注入范围（injectTo 命中口径）；全局 = 所有会话共享的笔记', onChange: (ev) => { const v = ev.target.value; setInjectPreviewSid(v); loadInjectPreview(v) } },
                    e('option', { value: '' }, '全局'),
                    sidOpts.map(s => e('option', { key: s.short, value: s.short }, s.short + (s.name ? ' · ' + s.name : ''))))),
                d === null
                  ? e('div', { className: 'dsh-notes-data-hint' }, '加载中…')
                  : e('pre', { className: 'dsh-notes-injprev-text' }, text || (injectPreviewTab === 'cat' ? '（无目录内容）' : '（无约定内容）')),
                stats ? e('div', { className: 'dsh-notes-injprev-stats' },
                  '总字符 ' + stats.totalChars + '（约定 ' + stats.conventionsChars + ' / 目录 ' + stats.catalogChars + '）· 打码 ' + stats.maskedNotes + ' 条 · 时效标注 ' + stats.staleMarked + ' 条 · 预算截断 ' + (stats.budgetTruncated ? '是' : '否')) : null,
                error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
                e('div', { className: 'dsh-notes-dispatch-actions' },
                  e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setInjectPreviewOpen(false) }, '关闭'))))
          })()
          : null,
          // 多选合并标题输入框（多选操作条「合并」入口）：默认标题 = 所选最早更新笔记的 topic，可改；Enter 确认
          mergeOpen ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setMergeOpen(false) } },
            e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
              e('div', { className: 'dsh-notes-settings-modal-t' }, I('note', 14), ' 合并所选笔记'),
              e('div', { className: 'dsh-notes-data-hint' }, '把所选的 ' + Object.keys(selIds).length + ' 条笔记合并为一篇（正文按更新时间分节拼接，原笔记软删除，可撤销）。'),
              e('input', { className: 'dsh-notes-data-input', placeholder: '合并后标题…', value: mergeTitle, autoFocus: true, onChange: (ev) => setMergeTitle(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doMergeConfirm() } } }),
              error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
              e('div', { className: 'dsh-notes-dispatch-actions' },
                e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setMergeOpen(false) }, '取消'),
                e('button', { className: 'dsh-notes-dispatch-ok', onClick: doMergeConfirm, disabled: mergePending || !mergeTitle.trim() }, mergePending ? '合并中…' : '合并'))))
          : null,
          // 新建笔记 modal（侧栏「新建」chip / Ctrl+N）：输标题 + 选类型（二期：按类型预填模板骨架）创建 → 选中 → 聚焦正文
          newNoteOpen ? e('div', { className: 'dsh-notes-newnote-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setNewNoteOpen(false) } },
            e('div', { className: 'dsh-notes-newnote-modal' },
              e('div', { className: 'dsh-notes-newnote-t' }, '新建笔记'),
              e('input', { ref: newNoteInputRef, className: 'dsh-notes-newnote-input', placeholder: '笔记标题…', value: newNoteTitle, onChange: (ev) => setNewNoteTitle(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doCreateNote() } } }),
              e('div', { className: 'dsh-notes-newnote-kind-row' },
                e('span', { className: 'dsh-notes-newnote-kind-lb' }, '类型'),
                e('select', { className: 'dsh-notes-newnote-select', value: newNoteKind, onChange: (ev) => setNewNoteKind(ev.target.value) },
                  ['note', 'decision', 'todo', 'link', 'quote'].map(k => e('option', { key: k, value: k }, KIND_LABELS[k]))),
                e('span', { className: 'dsh-notes-newnote-kind-hint' }, KIND_TEMPLATES[newNoteKind] ? '将预填模板骨架' : '自由格式（空正文）')),
              error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
              e('div', { className: 'dsh-notes-newnote-actions' },
                e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setNewNoteOpen(false) }, '取消'),
                e('button', { className: 'dsh-notes-dispatch-ok', onClick: doCreateNote, disabled: newNotePending || !newNoteTitle.trim() }, newNotePending ? '创建中…' : '创建'))))
          : null,
          // 笔记行右键菜单：置顶/已解决/移动到文件夹/删除（纯文字标签 + SVG 图标面板内统一风格）
          ctxMenu ? e('div', { className: 'dsh-notes-ctxmenu', style: { left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' } },
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => ctxSetStatus(ctxMenu.note, ctxMenu.note.status === 'pinned' ? 'active' : 'pinned') }, I('pin', 12), ctxMenu.note.status === 'pinned' ? '取消置顶' : '置顶'),
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => ctxSetStatus(ctxMenu.note, ctxMenu.note.status === 'resolved' ? 'active' : 'resolved') }, I('check', 12), ctxMenu.note.status === 'resolved' ? '重开' : '标记已解决'),
            // 移动到文件夹：点击内联展开子菜单（文件夹列表 + 移出 + 新建），避免二级浮层被面板 overflow:hidden 裁切
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => setCtxMenu({ x: ctxMenu.x, y: ctxMenu.y, note: ctxMenu.note, moveOpen: !ctxMenu.moveOpen }) }, I('folder', 12), '移动到文件夹' + (ctxMenu.moveOpen ? ' ▾' : ' ▸')),
            ctxMenu.moveOpen ? e(React.Fragment, null,
              folders.map(f => e('button', { key: f.id, className: 'dsh-notes-ctxmenu-item dsh-notes-ctxmenu-sub', onClick: () => ctxMoveToFolder(ctxMenu.note, f.id) }, ((ctxMenu.note.folder || '') === f.id ? '✓ ' : '') + f.name)),
              (ctxMenu.note.folder || '') ? e('button', { className: 'dsh-notes-ctxmenu-item dsh-notes-ctxmenu-sub', onClick: () => ctxMoveToFolder(ctxMenu.note, '') }, '移出文件夹（未分类）') : null,
              ctxMenu.newFolder
                ? e('input', { className: 'dsh-notes-ctxmenu-input', placeholder: '新文件夹名…', value: ctxNewFolderText, autoFocus: true, onChange: (ev) => setCtxNewFolderText(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ctxCreateFolderMove(ctxMenu.note) } } })
                : e('button', { className: 'dsh-notes-ctxmenu-item dsh-notes-ctxmenu-sub', onClick: () => setCtxMenu({ x: ctxMenu.x, y: ctxMenu.y, note: ctxMenu.note, moveOpen: true, newFolder: true }) }, '新建文件夹…'))
            : null,
            // 合并为一篇：进多选态并预勾当前笔记（再到列表勾选其余 ≥1 条，底部操作条合并）
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => { const nid = ctxMenu.note.id; setCtxMenu(null); setSelMode(true); setSelIds({ [nid]: true }) } }, I('check', 12), '合并为一篇'),
            e('button', { className: 'dsh-notes-ctxmenu-item danger', onClick: () => { setCtxMenu(null); doDelete(ctxMenu.note.id) } }, I('trash', 12), '删除'))
          : null,
          // 文件夹项右键菜单：进入文件夹视图（视图过滤的显式入口，单击行主体已让位给原地展开）/ 重命名 / 上移 / 下移 / 删除
          folderMenu ? e('div', { className: 'dsh-notes-ctxmenu', style: { left: folderMenu.x + 'px', top: folderMenu.y + 'px' } },
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => { const mf = folderMenu.folder; setFolderMenu(null); expandFolder(mf.id); setView({ type: 'folder', id: mf.id }) } }, I('filter', 12), '进入文件夹视图'),
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => { setRenamingId(folderMenu.folder.id); setRenameText(folderMenu.folder.name); setFolderMenu(null) } }, '重命名'),
            e('button', { className: 'dsh-notes-ctxmenu-item', disabled: folderMenuIdx <= 0, onClick: () => doReorderFolder(folderMenu.folder, -1) }, '上移'),
            e('button', { className: 'dsh-notes-ctxmenu-item', disabled: folderMenuIdx < 0 || folderMenuIdx >= folders.length - 1, onClick: () => doReorderFolder(folderMenu.folder, 1) }, '下移'),
            e('div', { className: 'dsh-notes-ctxmenu-sep' }),
            e('button', { className: 'dsh-notes-ctxmenu-item danger', onClick: () => doDeleteFolder(folderMenu.folder) }, '删除文件夹'))
          : null,
          // 多选操作条（「选择」chip / 右键「合并为一篇」进多选态后浮于侧栏底部）：已选 N 条 | 合并 | 取消
          selMode ? e('div', { className: 'dsh-notes-selbar' },
            e('span', { className: 'dsh-notes-selbar-n' }, '已选 ' + Object.keys(selIds).length + ' 条'),
            e('button', { className: 'dsh-notes-dispatch-ok', onClick: openMerge, disabled: Object.keys(selIds).length < 2 }, '合并'),
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: toggleSelMode }, '取消'))
          : null)
      }
      slots.register({ name: 'shell.overlay', id: 'dsh-notes-panel', order: 200 }, (props) => e(FloatingPanel, props))
    })
    if (typeof d3 === 'function') disposers.push(d3)
    const d4 = slots.inject('shell.overlay', () => {
      // ===== 快速记录卡片 v2（原型 SelectionCapture 重做）：头部（选区速记 + 识别为引用徽章）→ 选区预览 → 补充输入 → 复制/记录/取消 =====
      // 触发链路不变：selectionchange + mouseup；提交链路不变：notes-quick-instruct（备注非空）/ notes-quick（kind=quote）
      function SelectionCapture() {
        perf.selRender++
        const [cap, setCap] = React.useState(null)   // 卡片位置（null=隐藏）
        const [toast, setToast] = React.useState('')
        const [instrText, setInstrText] = React.useState('')
        const selTextRef = React.useRef('')
        const visibleRef = React.useRef(false)
        const instrRef = React.useRef(null)
        React.useEffect(() => { toastEmit = setToast; return () => { if (toastEmit === setToast) toastEmit = null } }, [])
        React.useEffect(() => {
          let mx = -1, my = -1, watchMouse = false, mouseDown = false
          function hide() { if (visibleRef.current) { visibleRef.current = false; setCap(null) } }
          function onMouseMove(ev) { if (!watchMouse) return; mx = ev.clientX; my = ev.clientY; perf.mousemoveTracked++ }
          function showFromSelection() {
            perf.selShowEval++
            const s0 = now()
            try {
              const sel = window.getSelection()
              const text = sel ? sel.toString().trim() : ''
              // 卡片已展开时，选区被点击清空（如点输入框）不关闭——只有卡片未展开且无选区才 hide
              if (!text || text.length < 2) { if (!visibleRef.current) hide(); return }
              let x, y
              if (mx >= 0) {
                x = mx - 150
                y = my + 14
              } else {
                let rect
                try { if (sel.rangeCount > 0) rect = sel.getRangeAt(0).getBoundingClientRect() } catch (err) {}
                if (rect && !(rect.width === 0 && rect.height === 0)) {
                  x = rect.left + rect.width / 2 - 150
                  y = rect.bottom + 8
                } else { hide(); return }
              }
              // 位置就近 + 视口内夹紧（卡片宽 300）
              x = Math.min(Math.max(8, x), Math.max(60, window.innerWidth - 314))
              y = Math.min(Math.max(8, y), Math.max(60, window.innerHeight - 220))
              selTextRef.current = text
              visibleRef.current = true
              // 位置没有实质变化时不触发重渲染
              setCap(prev => (prev && Math.abs(prev.x - x) < 2 && Math.abs(prev.y - y) < 2) ? prev : { x, y })
            } catch (err) {}
            finally { perf.selShowMs += now() - s0 }
          }
          // 一次性注册的防抖器：timer.timeout 每次调用都会在 fiber 上注册 ctx.effect，击键频率下是持续簿记开销
          const debouncedShow = timer.debounce(showFromSelection, 140)
          // v3：富文本编辑器内的划选归编辑器工具栏所有（加粗/链接等），不弹速记卡
          function inRichEditor() {
            try {
              const sel = window.getSelection()
              const an = sel && sel.rangeCount ? sel.anchorNode : null
              const el = an ? (an.nodeType === 1 ? an : an.parentNode) : null
              return !!(el && el.closest && el.closest('.dsh-notes-rich, .dsh-notes-rtb'))
            } catch (err) { return false }
          }
          function onSelectionChange() {
            perf.selChange++
            const sc0 = now()
            try {
              // 卡片已展开时保持稳定：避免聚焦输入框导致选区收起而误关（文本已在 selTextRef）
              if (visibleRef.current) return
              // 快速路径：光标态（无选区）直接跳过，不创建任何定时器——聊天输入框每次击键都触发本事件
              let collapsed = true
              let sel = null
              try { sel = window.getSelection(); collapsed = !sel || sel.isCollapsed } catch (err) {}
              if (collapsed) { perf.selCollapsedSkip++; watchMouse = false; hide(); return }
              if (inRichEditor()) { watchMouse = false; hide(); return }
              // 记录当前选区文本（供 mouseup 弹卡片预览与提交使用，提交不依赖实时选区）
              try { selTextRef.current = sel ? sel.toString().trim() : '' } catch (err) {}
              watchMouse = true
              // 鼠标拖拽中：只记录选区文本与跟踪坐标，等 mouseup 才弹卡片（避免拖拽中途弹出打断选区）
              if (mouseDown) return
              // 键盘选择（无鼠标按下）：正常防抖弹卡片
              debouncedShow()
            } finally { perf.selChangeMs += now() - sc0 }
          }
          function onMouseDown(ev) {
            if (ev.target.closest && ev.target.closest('.dsh-notes-cap')) return
            // 开始新一次拖拽：置位 mouseDown、停止旧坐标跟踪、隐藏旧卡片
            mouseDown = true; watchMouse = false; hide()
          }
          function onMouseUp(ev) {
            // 拖拽结束：清除 mouseDown；选区非折叠且文本≥2字符时弹卡片（校验在 showFromSelection 内部）
            mouseDown = false
            // 点击卡片内部（输入框/按钮）的 mouseup 不重新评估选区——否则点输入框清空选区后会误关卡片
            if (ev && ev.target && ev.target.closest && ev.target.closest('.dsh-notes-cap')) return
            if (inRichEditor()) return   // v3：富文本编辑器划选不弹速记卡
            showFromSelection()
          }
          document.addEventListener('selectionchange', onSelectionChange)
          document.addEventListener('mousemove', onMouseMove, { passive: true })
          document.addEventListener('mousedown', onMouseDown)
          document.addEventListener('mouseup', onMouseUp)
          return () => {
            document.removeEventListener('selectionchange', onSelectionChange)
            document.removeEventListener('mousemove', onMouseMove)
            document.removeEventListener('mousedown', onMouseDown)
            document.removeEventListener('mouseup', onMouseUp)
            if (debouncedShow && debouncedShow.dispose) debouncedShow.dispose()
          }
        }, [])
        // toast 自动消失：带动作按钮（如归档「撤销」）时延长展示（先例 = app.html toast(m, act) 的 4200ms）
        React.useEffect(() => { if (!toast) return; const d = timer.timeout(() => setToast(''), typeof toast === 'object' && toast.act ? 4200 : 2600); return () => d() }, [toast])
        // 弹卡片后不自动 focus 输入框：focus 会清除页面选区，打断拖拽并使选区丢失。
        // 选区文本已存于 selTextRef，提交不依赖实时选区；用户需备注时手动点击输入框（自然 focus）。
        // 选区预览：截断至 3 行 / 160 字符（原型上限），配合渐隐避免卡片过高
        function previewText(text) { if (!text) return ''; const lines = String(text).split(/\n/).slice(0, 3).join(' '); return lines.length > 160 ? lines.slice(0, 160) + '…' : lines }
        async function submit() {
          const text = selTextRef.current
          const note = instrText.trim()
          visibleRef.current = false; setCap(null); setInstrText('')
          if (window.getSelection()) window.getSelection().removeAllRanges()
          if (!text) return
          try {
            if (!note) {
              // 备注为空 → 现有逻辑（行为不变）
              const res = await rpc('notes-quick', { text: text, sessionId: currentSessionId, kind: 'quote' })
              if (res.error) { setToast('记录失败：' + res.error) }
              // 敏感命中：host 已直接落 sensitive=true（注入自动脱敏），toast 追加标注告知
              else { setToast((res.merged ? '已合并到本次速记' : '已记录，正在识别主题…') + (res.sensitiveSuggested ? '，已标记敏感（注入自动脱敏）' : '')); notifyNotesChanged() }
            } else {
              // 备注非空 → LLM 提取元数据，按返回结果 toast
              const res = await rpc('notes-quick-instruct', { text: text, note: note, sessionId: currentSessionId })
              if (res.error) { setToast('记录失败：' + res.error) }
              else if (res.ok && res.applied) {
                const a = res.applied
                let msg = '已记录'
                if (a.inject) msg = '已记录并注入为上下文（' + (a.injectRole === 'reference' ? '资料' : '约定') + '）'
                else if (a.tags && a.tags.length) msg = '已记录并标记 #' + a.tags.join(' #')
                else if (a.kind && a.kind !== 'note' && a.kind !== 'quote') msg = '已记录为' + (KIND_LABELS[a.kind] || a.kind)
                else msg = res.merged ? '已合并到本次速记' : '已记录，正在识别主题…'
                if (res.sensitiveSuggested) msg += '，已标记敏感（注入自动脱敏）'
                setToast(msg); notifyNotesChanged()
              } else {
                setToast((res.merged ? '已合并到本次速记' : '已记录，正在识别主题…') + (res.sensitiveSuggested ? '，已标记敏感（注入自动脱敏）' : '')); notifyNotesChanged()
              }
            }
          } catch (err) { setToast('记录失败：' + String(err.message || err)) }
        }
        function cancel() { visibleRef.current = false; setCap(null); setInstrText(''); if (window.getSelection()) window.getSelection().removeAllRanges() }
        // 复制选区文本到剪贴板：优先 navigator.clipboard，不可用/失败时降级 execCommand；
        // 复制成功后与记录/取消一致关闭卡片并清选区（cancel 同款逻辑）；失败/无选区时保持卡片
        function fallbackCopy(text) {
          try {
            var ta = document.createElement('textarea')
            ta.value = text
            ta.style.position = 'fixed'
            ta.style.opacity = '0'
            ta.style.pointerEvents = 'none'
            document.body.appendChild(ta)
            ta.select()
            document.execCommand('copy')
            document.body.removeChild(ta)
            setToast('已复制选区')
            visibleRef.current = false; setCap(null); setInstrText(''); if (window.getSelection()) window.getSelection().removeAllRanges()
          } catch (err) { setToast('复制失败') }
        }
        function copySelection() {
          var text = selTextRef.current
          if (!text) { setToast('无选区可复制'); return }
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(function () {
                setToast('已复制选区')
                visibleRef.current = false; setCap(null); setInstrText(''); if (window.getSelection()) window.getSelection().removeAllRanges()
              }, function () { fallbackCopy(text) })
              return
            }
          } catch (err) {}
          fallbackCopy(text)
        }
        return e('div', null, cap ? e('div', { className: 'dsh-notes-cap', style: { left: cap.x + 'px', top: cap.y + 'px' } },
          e('div', { className: 'dsh-notes-cap-h' },
            e('span', { className: 'dsh-notes-cap-src' }, I('note', 11), '选区速记'),
            e('span', { className: 'dsh-notes-cap-auto' }, e('span', { className: 'dot' }), '识别为 引用')),
          e('div', { className: 'dsh-notes-cap-pv' }, previewText(selTextRef.current)),
          e('div', { className: 'dsh-notes-cap-in' },
            I('plus', 12),
            e('input', { ref: instrRef, className: 'dsh-notes-cap-input', type: 'text', placeholder: '可补充：打标签/引导标题/定类型/注入为上下文…直接回车则仅记录', value: instrText, onChange: function (ev) { setInstrText(ev.target.value) }, onKeyDown: function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); submit() } else if (ev.key === 'Escape') { ev.preventDefault(); cancel() } } }),
            e('span', { className: 'dsh-notes-kbd' }, 'Enter 记录')),
          e('div', { className: 'dsh-notes-cap-acts' },
            e('button', { className: 'dsh-notes-cbtn', onClick: copySelection }, I('note', 12), '复制'),
            e('button', { className: 'dsh-notes-cbtn primary', onClick: submit }, I('check', 12), '记录'),
            e('button', { className: 'dsh-notes-cbtn', onClick: cancel }, '取消')
          )
        ) : null, e('div', { className: 'dsh-notes-toast' + (toast ? ' show' : '') + (toast && toast.act ? ' has-act' : '') },
          typeof toast === 'string' ? toast : (toast ? toast.msg : ''),
          toast && toast.act ? e('a', { className: 'dsh-notes-toast-act', onClick: () => { const fn = toast.act && toast.act.fn; setToast(''); try { if (fn) fn() } catch (err) {} } }, toast.act.label) : null))
      }
      slots.register({ name: 'shell.overlay', id: 'dsh-notes-selection', order: 201 }, () => e(SelectionCapture))
    })
    if (typeof d4 === 'function') disposers.push(d4)
    ctx.effect(() => () => { for (const d of disposers) { try { d() } catch (e2) {} } })
    console.log('notes plugin: client ready')
    }

    // inject 声明 apply 用到的全部服务（slots/timer/sessions/workspaces），
    // 保证 Cordis 在服务就绪后才激活 apply；apply 内仍保留 ctx.get + 存在性守卫做双保险。
    module.exports = { name: 'dsh-notes-plugin', inject: ['slots', 'timer', 'sessions', 'workspaces'], apply: apply }
    return module.exports
  }
})
