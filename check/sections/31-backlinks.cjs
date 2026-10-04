// 节 31. P2 笔记双链（[[..]] + 反向链接）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "31",
  title: "31. P2 笔记双链（[[..]] + 反向链接）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { appSrc, clientPkgSrc, kernelFn, plugin, v3ParseHtml } = S
  // ===== 31. P2 笔记双链（[[id/标题]] 渲染跳转 + 反向链接面板 + 行尾标记；host 不改，解析在 client）=====
  section('31. P2 笔记双链（[[..]] + 反向链接）')

  // ---- 31.1 内核行为级（renderMarkdown 第二参 wikiResolve；kernelFn 在 19 节已用 MiniDOM 装配，三端字节一致在 25 节锁定）----
  await t('双链渲染：id/标题精确命中 → 可点击锚（data-wiki 记原始 target，显示标题）；解析不到/无 resolver → 纯文本', () => {
    assert(kernelFn, 'kernelFn 可用（19 节装配）')
    const resolver = (w) => (w === 'n-abc123' || w === '发布清单') ? { id: 'n-abc123', title: '发布清单' } : null
    const h = kernelFn.renderMarkdown('见 [[n-abc123]] 与 [[发布清单]] 与 [[不存在]]', resolver)
    assert(h.indexOf('<a class="dsh-notes-wikilink" data-wiki="n-abc123" href="#wiki" title="发布清单">发布清单</a>') >= 0, '[[id]] 命中 → 锚（显示标题，data-wiki 记原始 target）')
    assert(h.indexOf('data-wiki="发布清单"') >= 0, '[[标题]] 命中 → data-wiki 记原始 target')
    assert(h.indexOf('[[不存在]]') >= 0 && h.indexOf('data-wiki="不存在"') < 0, '解析不到 → 纯文本')
    const h2 = kernelFn.renderMarkdown('见 [[n-abc123]]')
    assert(h2.indexOf('[[n-abc123]]') >= 0 && h2.indexOf('dsh-notes-wikilink') < 0, '不传 wikiResolve → 纯文本（向后兼容存量调用）')
  })
  await t('双链 XSS 红线：target/标题全量转义（esc/unesc 互逆，含 & 标题可命中且不成注入）', () => {
    assert(kernelFn, 'kernelFn 可用')
    const resolver = (w) => w === 'A & B' ? { id: 'n-x', title: 'A & B <img onerror=alert(1)>' } : null
    const h = kernelFn.renderMarkdown('链 [[A & B]]', resolver)
    assert(h.indexOf('dsh-notes-wikilink') >= 0, '含 & 标题经 unesc 还原后命中')
    assert(h.indexOf('<img') < 0 && h.indexOf('&lt;img') >= 0, 'resolver 返回的标题经 esc 转义（不成注入）')
    assert(h.indexOf('data-wiki="A &amp; B"') >= 0, 'data-wiki 属性值转义形态')
  })
  await t('双链往返保真：[[target]] → 锚 → 序列化回 [[target]]（显示标题不进 Markdown；二轮渲染逐字节一致）', () => {
    assert(kernelFn, 'kernelFn 可用')
    const resolver = (w) => w === 'n-abc123' ? { id: 'n-abc123', title: '发布清单' } : null
    const h1 = kernelFn.renderMarkdown('见 [[n-abc123]] 收尾', resolver)
    const md2 = kernelFn.serializeRich(v3ParseHtml(h1))
    assert.strictEqual(md2, '见 [[n-abc123]] 收尾', '序列化还原 [[原始 target]]，显示标题不泄漏进 Markdown')
    const h2 = kernelFn.renderMarkdown(md2, resolver)
    assert.strictEqual(h2, h1, '二轮渲染逐字节一致（定点稳定）')
    // 未解析双链（纯文本形态）：与 a[b] 同款——escapeMd 转义 [[ → md2 加反斜杠，定点稳定（render∘serialize∘render 逐字节一致）
    const h3 = kernelFn.renderMarkdown('见 [[没人]]', resolver)
    const mdU = kernelFn.serializeRich(v3ParseHtml(h3))
    assert.strictEqual(kernelFn.renderMarkdown(mdU, resolver), h3, '未解析双链二轮渲染逐字节一致')
    assert.strictEqual(kernelFn.serializeRich(v3ParseHtml(kernelFn.renderMarkdown(mdU, resolver))), mdU, '未解析双链序列化定点稳定')
  })
  await t('extractWikiTargets / wikiLinksTo 口径：多目标提取 + 转义括号豁免 + 反向链接精确匹配（[[该id]] 或 [[该标题]]）', () => {
    assert(kernelFn, 'kernelFn 可用')
    assert.deepStrictEqual(kernelFn.extractWikiTargets('a [[n-1]] b [[标题]] c [[n-1]]'), ['n-1', '标题', 'n-1'], '多目标按序提取（不去重）')
    assert.deepStrictEqual(kernelFn.extractWikiTargets('\\[\\[x\\]\\] 转义'), [], '反斜杠转义括号不算双链')
    assert.deepStrictEqual(kernelFn.extractWikiTargets('[[含[括号]]]'), [], 'target 含方括号不匹配（防嵌套歧义）')
    assert(kernelFn.wikiLinksTo('正文 [[n-abc]]', 'n-abc', '别的') === true, '[[id]] 命中反向链接')
    assert(kernelFn.wikiLinksTo('正文 [[发布清单]]', 'n-abc', '发布清单') === true, '[[标题]] 命中反向链接')
    assert(kernelFn.wikiLinksTo('正文 [[发布清单2]]', 'n-abc', '发布清单') === false, '标题前缀不算（精确匹配）')
    assert(kernelFn.wikiLinksTo('正文 [[n-ab]]', 'n-abc', '') === false, 'id 前缀不算')
    assert(kernelFn.wikiLinksTo('无链正文', 'n-abc', '发布清单') === false, '无链不命中')
  })
  await t('粘贴清洗保留双链锚（data-wiki 重建），非 http 普通链接仍拆壳', () => {
    assert(kernelFn, 'kernelFn 可用')
    const frag = v3ParseHtml('<p><a class="dsh-notes-wikilink" data-wiki="n-1" href="#wiki">标题甲</a></p><p><a href="javascript:alert(1)">坏</a></p>')
    const clean = kernelFn.sanitizeFragment(frag)
    const as = clean.querySelectorAll('a')
    assert.strictEqual(as.length, 1, '仅双链锚保留（javascript: 拆壳；实得 ' + as.length + '）')
    assert.strictEqual(as[0].getAttribute('data-wiki'), 'n-1', 'data-wiki 保留')
    const md = kernelFn.serializeRich(clean)
    assert(md.indexOf('[[n-1]]') >= 0 && md.indexOf('javascript') < 0, '清洗后序列化回 [[target]]，无脚本残留')
  })

  // ---- 31.2 双端落地结构（面板 client-impl / 发布包 lib/client.js / app.html / 样式双端 / host 不改）----
  await t('面板双链结构：解析 + 索引 + 跳转 + 行尾标记 + 反向链接面板 + 富文本点击委托（开发版 + 发布包）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('function resolveWikiTarget(target)') >= 0, label + ' resolveWikiTarget 存在')
      assert(s.indexOf("list.find(n => n.id === t) || list.find(n => (n.title || '') === t)") >= 0, label + ' 解析口径：id 精确优先、标题精确匹配')
      assert(s.indexOf('function wikiResolve(w)') >= 0, label + ' wikiResolve（renderMarkdown 第二参）')
      assert(s.indexOf('function ensureWikiIndex(list)') >= 0 && s.indexOf('wikiIdxGenRef') >= 0, label + ' 全库正文惰性索引（代际作废旧任务）')
      assert(s.indexOf('function bumpWikiBody(id, body, updatedAt)') >= 0, label + ' bumpWikiBody（选中/保存即时新鲜）')
      assert(s.indexOf('bumpWikiBody(id, body, res.note.updatedAt)') >= 0, label + ' 选中加载写索引缓存')
      assert(s.indexOf("bumpWikiBody(id, edBodyRef.current, '')") >= 0, label + ' 保存后写索引缓存（updatedAt 置空复核）')
      assert(s.indexOf('function hasWikiLinks(n)') >= 0, label + ' hasWikiLinks（缓存正文优先，preview 兜底）')
      /* i18n 覆盖卡F：跳转未命中 toast 走 t() 字典（wiki.targetNotFound，zh 原串在 src/i18n/zh.js） */
      assert(s.indexOf('function jumpToWikiTarget(target)') >= 0 && s.indexOf("t('wiki.targetNotFound', { target: target })") >= 0, label + ' 跳转 + 未命中 toast（覆盖卡F 起走 t()）')
      assert(s.indexOf("className: 'dsh-notes-note-wiki dsh-nt'") >= 0 && s.indexOf("I('link', 9)") >= 0, label + ' 行尾双链标记（SVG 图标，零 emoji）')
      assert(s.indexOf("className: 'dsh-notes-backlinks'") >= 0 && s.indexOf("className: 'dsh-notes-backlink dsh-nt'") >= 0, label + ' 反向链接面板结构')
      assert(s.indexOf("tt('editor.backlinks') + (wikiWarm ? tt('editor.backlinksCount', { n: backlinks.length }) : tt('editor.backlinksWarming'))") >= 0, label + ' 反向链接标题（索引中…提示；i18n 覆盖卡B 起走 tt() 字典）')
      assert(s.indexOf("if (wikiLinksTo(c.body, curNote.id, curNote.title || '')) out.push(n)") >= 0, label + ' 反向链接扫描口径（[[该id]] 或 [[该标题]]，自链除外）')
      assert(s.indexOf("ev.target.closest('a[data-wiki]')") >= 0 && s.indexOf("el.addEventListener('click', onWikiClick)") >= 0 && s.indexOf("el.removeEventListener('click', onWikiClick)") >= 0, label + ' 富文本 click 委托绑定/卸绑')
      assert(s.indexOf('jumpWikiRef.current = jumpToWikiTarget') >= 0, label + ' 跳转函数 ref 镜像（防闭包过期）')
      assert(s.indexOf('renderMarkdown(edBodyRef.current, wikiResolve)') >= 0 && s.indexOf('renderMarkdown(body, wikiResolve)') >= 0 && s.indexOf('renderMarkdown(text, wikiResolve)') >= 0, label + ' 三处 renderMarkdown 调用点带 wikiResolve')
    }
    assert(clientSrc.indexOf("host.call('notes-get-batch', { ids: stale.map(n => n.id) })") >= 0, 'client-impl 索引拉取走 notes-get-batch 批量端点（N+1 整治 notes-034-batch3）')
    assert(clientPkgSrc.indexOf("rpc('notes-get-batch', { ids: stale.map(n => n.id) })") >= 0, '发布包索引拉取走 notes-get-batch（build-dist rpc 形态）')
    assert(clientSrc.indexOf('loadFolders(); ensureWikiIndex(list)') >= 0 && clientPkgSrc.indexOf('loadFolders(); ensureWikiIndex(list)') >= 0, 'loadNotes 链路桥接索引构建（双端）')
  })
  await t('app.html 双链结构：解析 + 索引 + 跳转 + 行尾标记 + 反向链接面板 + 富文本点击（与面板同款，双端同步）', () => {
    const s = appSrc
    assert(s.indexOf('function resolveWikiTarget(target)') >= 0 && s.indexOf('function wikiResolve(w)') >= 0, 'app.html 解析函数存在')
    assert(s.indexOf("notes.find(function (n) { return n.id === t; }) || notes.find(function (n) { return (n.title || '') === t; })") >= 0, 'app.html 解析口径：id 精确优先、标题精确匹配')
    assert(s.indexOf('function ensureWikiIndex()') >= 0 && s.indexOf('wikiIdxGen') >= 0, 'app.html 全库正文惰性索引（代际作废）')
    assert(s.indexOf('function hasWikiLinks(n)') >= 0 && s.indexOf('class="wikimark"') >= 0, 'app.html 行尾双链标记')
    assert(s.indexOf('function jumpToWikiTarget(target)') >= 0 && s.indexOf("toast(t('wiki.targetNotFound', { target: target }))") >= 0, 'app.html 跳转 + 未命中 toast（覆盖卡F 起走 t()）')
    assert(s.indexOf('function renderBacklinks()') >= 0 && s.indexOf('id="backlinksHost"') >= 0, 'app.html 反向链接面板 + 宿主 div')
    /* i18n 覆盖卡F：app 反向链接标题走 t()（复用 B 卡 editor.backlinks/backlinksCount/backlinksWarming，与 client 同口径） */
    assert(s.indexOf("t('editor.backlinks') + (warm ? t('editor.backlinksCount', { n: bl.length }) : t('editor.backlinksWarming'))") >= 0, 'app.html 反向链接标题（索引中…提示；覆盖卡F 起走 t()）')
    assert(s.indexOf("if (wikiLinksTo(c.body, edNote.id, edNote.title || '')) bl.push(n);") >= 0, 'app.html 反向链接扫描口径（[[该id]] 或 [[该标题]]，自链除外）')
    assert(s.indexOf("ev.target.closest('a[data-wiki]')") >= 0 && s.indexOf("jumpToWikiTarget(a.getAttribute('data-wiki') || '')") >= 0, 'app.html 富文本 click 委托（data-wiki 锚 → 跳转）')
    assert(s.indexOf('_wikiBound') >= 0, 'app.html 富文本点击绑定防重复（_wikiBound 守卫）')
    assert(s.indexOf('renderMarkdown(body, wikiResolve)') >= 0 && s.indexOf("renderMarkdown(edNote ? edNote.body || '' : '', wikiResolve)") >= 0, 'app.html renderMarkdown 调用点带 wikiResolve')
    assert(s.indexOf("wikiBodies[id] = { body: edNote.body || '', updatedAt: res.note.updatedAt || '' }") >= 0, 'app.html 选中加载写索引缓存')
    assert(s.indexOf("wikiBodies[selId] = { body: edNote.body || '', updatedAt: '' }") >= 0, 'app.html 保存后写索引缓存（复核 reconcile）')
    assert(s.indexOf('ensureWikiIndex(); renderTree();') >= 0, 'app.html loadNotes 链路桥接索引构建')
  })
  await t('双链样式双端：styles.css ⇄ 发布包 lib/styles.css + app.html 内嵌样式', () => {
    const cssDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev], ['发布包 lib/styles.css', cssPkg]]) {
      for (const cls of ['.dsh-notes-rich a.dsh-notes-wikilink{', '.dsh-notes-note-wiki{', '.dsh-notes-backlinks{', '.dsh-notes-backlinks-t{', '.dsh-notes-backlink{', '.dsh-notes-backlinks-empty{']) {
        assert(pair[1].indexOf(cls) >= 0, pair[0] + ' 缺双链样式：' + cls)
      }
    }
    for (const cls of ['.rich a.dsh-notes-wikilink{', '.note-row .wikimark{', '.backlinks{', '.backlinks .bl-item{', '.backlinks .bl-empty{']) {
      assert(appSrc.indexOf(cls) >= 0, 'app.html 缺双链样式：' + cls)
    }
  })
  await t('host 不改契约：双链解析/扫描全在 client（host-impl / index.mjs 零双链逻辑）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      assert(pair[1].indexOf('data-wiki') < 0 && pair[1].indexOf('WIKI_RE') < 0 && pair[1].indexOf('wikiLinksTo') < 0 && pair[1].indexOf('extractWikiTargets') < 0, pair[0] + ' 不含双链逻辑（解析放 client，库已在内存）')
    }
  })
  }
}
