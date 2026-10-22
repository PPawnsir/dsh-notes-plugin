// 节 138. 反链超限折叠（notes-065-backlinks-collapse；反馈 n-mviwazwi6gia 用户实测：枢纽笔记反链几十条把编辑器内容区挤没）
// 形态（双端同构）：默认最多渲染前 8 条（BACKLINKS_VISIBLE_CAP=8，常量注释放双端），超出时列表尾追加一行切换钮
//   「展开其余 {n} 条 ▾」（editor.backlinksMore）→ 点击展全量、文案翻「收起 ▴」（editor.backlinksLess）→ 再点收回（弱化 bl-item 行视觉）；
//   折叠态不持久化——app blOpenFor 局部变量 / 面板 blOpenFor 局部 state，均锚定笔记 id：切笔记/重开恒回默认折叠（枢纽笔记默认必须收敛）；
//   总数口径不动（标题行 editor.backlinksCount 既有）。红线：反链计算逻辑（wikiLinksTo 扫描/索引热身）零改动；不做分页/虚拟滚动。
// 锁面：①app 静态锚（CAP+局部变量+slice+data-bl-more 锚+i18n 双键+绑定同区+产物同步）②面板同锚（editor.js+产物 lib/client.js）
//   ③行为级（app renderBacklinks 真函数 eval，116 同款 with(Proxy) 沙箱：10 条→默认 8+切换行计数 2→点开展 10→再点收 8+切笔记回默认+EN 翻转）
//   ④回归锚（≤8 条零切换行+既有 bl-item 跳转不破+标题总数口径）⑤样式双端 ⑥i18n 双键双语 ⑦红线（扫描口径/标题行原样）。
module.exports = {
  id: "138",
  title: "138. 反链超限折叠（默认前 8 条 + 「展开其余 N 条」切换，双端同构，折叠态不持久化）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR } = H
  section('138. 反链超限折叠（notes-065-backlinks-collapse，默认 8 条 + 展开切换，双端同构）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const zhSrc = read('src/i18n/zh.js'), enSrc = read('src/i18n/en.js')
  const helpersSrc = read('src/app/kernel/helpers.js')
  const kernelSrc = read('src/shared/editor-kernel.js')
  const appWiki = read('src/app/panels/wiki.js')
  const cliEd = read('src/client/panels/panel/editor.js')
  const appHtml = read('packages/dsh-notes-plugin/app.html')
  const clientPkgSrc = read('packages/dsh-notes-plugin/lib/client.js')
  const headHtml = read('src/app/shell/head.html')
  const cssDev = read('src/styles.css')
  const cssPkg = read('packages/dsh-notes-plugin/lib/styles.css')
  const i18nBlock = helpersSrc.match(/\/\* ==== i18n-mech BEGIN ====[\s\S]*?\/\* ==== i18n-mech END ==== \*\//)[0]
  const grabDict = (f, v) => new Function(read('src/i18n/' + f) + '\nreturn ' + v)()
  const ZH = grabDict('zh.js', 'I18N_ZH'), EN = grabDict('en.js', 'I18N_EN')
  const grabFn = (src, head, label) => {   /* 多行函数：截到列 0 '\n}'（116 节同款） */
    const i = src.indexOf(head)
    assert(i >= 0, label + ' 缺 ' + head)
    const j = src.indexOf('\n}', i)
    assert(j > i, label + ' ' + head + ' 闭花括号定位失败')
    return src.slice(i, j + 2)
  }
  const grabLine = (src, head, label) => { /* 单行函数：截到行尾 */
    const i = src.indexOf(head)
    assert(i >= 0, label + ' 缺 ' + head)
    return src.slice(i, src.indexOf('\n', i))
  }
  // ===== 138.1 app 静态锚：CAP 常量 + 折叠态局部变量 + slice + 切换行锚/双键 + 点击绑定同区（+ 产物同步） =====
  await t('138 ①app 静态锚：BACKLINKS_VISIBLE_CAP=8 + blOpenFor 局部变量 + 切换行 data-bl-more 锚 + i18n 双键 + 绑定同区（产物同步）', () => {
    assert(appWiki.indexOf('BACKLINKS_VISIBLE_CAP = 8') >= 0, 'app wiki.js 缺 BACKLINKS_VISIBLE_CAP=8 常量（注释放双端）')
    assert(appWiki.indexOf("var blOpenFor = '';") >= 0, 'app 折叠态局部变量 blOpenFor 缺失（不持久化契约载体：局部变量即可，禁入存储）')
    assert(appWiki.indexOf('blOpen ? bl : bl.slice(0, BACKLINKS_VISIBLE_CAP)') >= 0, 'app 默认截前 CAP 条（展开态全量）')
    assert(appWiki.indexOf('bl.length > BACKLINKS_VISIBLE_CAP') >= 0, 'app 超限判定缺失')
    assert(appWiki.indexOf('data-bl-more="1"') >= 0, 'app 切换行 data-bl-more 锚缺失')
    assert(appWiki.indexOf("t('editor.backlinksMore', { n: bl.length - BACKLINKS_VISIBLE_CAP })") >= 0, 'app 切换行「展开其余 N 条」走 i18n')
    assert(appWiki.indexOf("t('editor.backlinksLess')") >= 0, 'app 切换行「收起」走 i18n')
    assert(appWiki.indexOf("host.querySelector('[data-bl-more]')") >= 0, 'app 切换行点击绑定与 bl-item 跳转同区')
    /* 产物同步锚（改 src/app/** 后须跑 build-dist） */
    assert(appHtml.indexOf('BACKLINKS_VISIBLE_CAP = 8') >= 0 && appHtml.indexOf('data-bl-more="1"') >= 0, 'app.html 产物缺折叠锚（需先跑 node scripts/build-dist.cjs）')
    assert(appHtml.indexOf('.backlinks .bl-more{') >= 0, 'app.html 产物缺切换行样式（head.html 内嵌 CSS 同步）')
  })
  // ===== 138.2 面板静态锚：同构（editor.js + 产物 lib/client.js） =====
  await t('138 ②面板静态锚：CAP 常量 + blOpenFor 局部 state + slice + backlink-more 切换行 + i18n 双键（产物同步）', () => {
    assert(cliEd.indexOf('BACKLINKS_VISIBLE_CAP = 8') >= 0, 'panel editor.js 缺 BACKLINKS_VISIBLE_CAP=8 常量（与 app 同值同构）')
    assert(cliEd.indexOf("const [blOpenFor, setBlOpenFor] = React.useState('')") >= 0, 'panel 折叠态局部 state 缺失（原则=不引全局状态）')
    assert(cliEd.indexOf('blOpen ? backlinks : backlinks.slice(0, BACKLINKS_VISIBLE_CAP)') >= 0, 'panel 默认截前 CAP 条（展开态全量）')
    assert(cliEd.indexOf('backlinks.length > BACKLINKS_VISIBLE_CAP') >= 0, 'panel 超限判定缺失')
    assert(cliEd.indexOf("'dsh-notes-backlink-more dsh-nt'") >= 0, 'panel 切换行 class 锚缺失')
    assert(cliEd.indexOf("tt('editor.backlinksMore', { n: backlinks.length - BACKLINKS_VISIBLE_CAP })") >= 0, 'panel 切换行「展开其余 N 条」走 i18n')
    assert(cliEd.indexOf("tt('editor.backlinksLess')") >= 0, 'panel 切换行「收起」走 i18n')
    assert(clientPkgSrc.indexOf('BACKLINKS_VISIBLE_CAP = 8') >= 0 && clientPkgSrc.indexOf('dsh-notes-backlink-more') >= 0, 'lib/client.js 产物缺折叠锚（需先跑 node scripts/build-dist.cjs）')
  })
  // ===== 行为级装配：真 renderBacklinks（app wiki.js 逐字节 eval）+ 真 i18n 块（116 节同款 with(Proxy) 沙箱） =====
  function mkClickable(attrs) {
    const listeners = {}
    return {
      attrs: attrs,
      addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn) },
      getAttribute(k) { return attrs[k] != null ? attrs[k] : null },
      fire(ev) { (listeners[ev] || []).forEach((fn) => fn()) },
    }
  }
  function bootBL(nRefs) {   /* 造双枢纽各 nRefs 条反链：引用页正文同时 [[n1]] [[n2]]（切笔记用例需第二枢纽同量级反链） */
    const notes = [
      { id: 'n1', title: '枢纽甲', kind: 'note', updatedAt: 'u1' },
      { id: 'n2', title: '枢纽乙', kind: 'note', updatedAt: 'u2' },
    ]
    const wikiBodies = { n1: { body: '甲正文', updatedAt: 'u1' }, n2: { body: '乙正文', updatedAt: 'u2' } }
    for (let k = 1; k <= nRefs; k++) {
      notes.push({ id: 'r' + k, title: '引用页' + k, kind: 'note', updatedAt: 'u' + k })
      wikiBodies['r' + k] = { body: '见 [[n1]] 与 [[n2]]', updatedAt: 'u' + k }
    }
    const host = {   /* 极简 DOM：innerHTML 写入即解析出稳定元素集（真实 DOM 语义——监听器绑在解析出的节点上，后续查询返回同一批节点） */
      _html: '', _items: [], _moreEl: null,
      querySelectorAll(sel) { return sel === '.bl-item' ? host._items : [] },
      querySelector(sel) { return sel === '[data-bl-more]' ? host._moreEl : null },
    }
    Object.defineProperty(host, 'innerHTML', {
      get() { return host._html },
      set(v) {
        host._html = v
        const out = []
        const re = /<span class="bl-item" data-bl="([^"]+)"/g
        let m
        while ((m = re.exec(v))) out.push(mkClickable({ 'data-bl': m[1] }))
        host._items = out
        host._moreEl = v.indexOf('data-bl-more="1"') >= 0 ? mkClickable({ 'data-bl-more': '1' }) : null
      },
    })
    const jumps = []
    const target = {
      setTimeout: setTimeout, clearTimeout: clearTimeout,
      notes: notes, wikiBodies: wikiBodies,
      edNote: notes[0],
      KCOLOR: { note: '#999' },
      blOpenFor: '',
      $: (id) => (id === 'backlinksHost' ? host : null),
      toast() {},
      jumpToWikiTarget: (id) => jumps.push(id),
      localStorage: { getItem: () => null, setItem: () => {} },
    }
    const proxy = new Proxy(target, {
      has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
      get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
      set(t2, k, v) { t2[k] = v; return true }
    })
    const body = zhSrc + '\n' + enSrc + '\n' + i18nBlock + '\n'
      + grabLine(helpersSrc, 'function icon(id, sz) {', 'helpers.js') + '\n'
      + grabFn(kernelSrc, 'function esc(s) {', 'editor-kernel.js') + '\n'
      + grabLine(kernelSrc, 'var WIKI_RE =', 'editor-kernel.js') + '\n'
      + grabLine(kernelSrc, 'function extractWikiTargets(text) {', 'editor-kernel.js') + '\n'
      + grabLine(kernelSrc, 'function wikiLinksTo(body, id, title) {', 'editor-kernel.js') + '\n'
      + grabFn(appWiki, 'function renderBacklinks() {', 'wiki.js') + '\n'
    new Function('scope', 'with (scope) {\n' + body + '\n; __api = { renderBacklinks: renderBacklinks, setLang: setLang, t: t } }')(proxy)
    return { target: target, host: host, jumps: jumps, api: target.__api }
  }
  // ===== 138.3 行为级：10 条反链 → 默认 8 + 切换行计数 2 → 点开展 10 → 再点收回 8 + 切笔记恒回默认折叠 =====
  await t('138 ③行为级：10 条反链 → 默认 8+切换行「展开其余 2 条」→ 点开展 10「收起」→ 再点收回 8 + 切笔记恒回默认折叠', () => {
    const env = bootBL(10)
    const countItems = () => (env.host.innerHTML.match(/<span class="bl-item" data-bl=/g) || []).length
    env.api.renderBacklinks()
    assert.strictEqual(countItems(), 8, '默认只渲染前 8 条（实得 ' + countItems() + '）')
    assert(env.host.innerHTML.indexOf('data-bl-more="1"') >= 0, '超限出现切换行锚')
    assert(env.host.innerHTML.indexOf(ZH['editor.backlinksMore'].replace('{n}', '2')) >= 0, '切换行计数 2（实得尾部 ' + env.host.innerHTML.slice(-120) + '）')
    assert(env.host.innerHTML.indexOf('▾') >= 0 && env.host.innerHTML.indexOf('▴') < 0, '折叠态箭头 ▾')
    /* 点击展开 → 全量 10 + 文案翻「收起 ▴」 */
    env.host.querySelector('[data-bl-more]').fire('click')
    assert.strictEqual(countItems(), 10, '点开展全 10 条（实得 ' + countItems() + '）')
    assert.strictEqual(env.target.blOpenFor, 'n1', '展开态锚定当前笔记 id（blOpenFor=n1）')
    assert(env.host.innerHTML.indexOf(ZH['editor.backlinksLess']) >= 0 && env.host.innerHTML.indexOf('▴') >= 0, '展开后切换行翻「收起 ▴」')
    /* 再点收回 → 8 */
    env.host.querySelector('[data-bl-more]').fire('click')
    assert.strictEqual(countItems(), 8, '再点收回 8 条（实得 ' + countItems() + '）')
    assert.strictEqual(env.target.blOpenFor, '', '收回后折叠态复位（blOpenFor 回空）')
    /* 切笔记恒回默认折叠：n1 展开态下切到同有 10 条反链的 n2 → 默认折叠 8 条 */
    env.host.querySelector('[data-bl-more]').fire('click')
    assert.strictEqual(countItems(), 10, 'n1 再次展开 10 条')
    env.target.edNote = env.target.notes[1]   /* 切到 n2（同量级 10 条反链枢纽） */
    env.api.renderBacklinks()
    assert.strictEqual(countItems(), 8, '切笔记恒回默认折叠（n2 默认 8 条，实得 ' + countItems() + '）')
    assert(env.host.innerHTML.indexOf('data-bl-more="1"') >= 0, 'n2 同样有切换行（超限判定按当前笔记）')
  })
  await t('138 ③b 行为级·EN：切 en 切换行「Show 2 more ▾ / Show less ▴」翻转（i18n 双键行为锁）', () => {
    const env = bootBL(10)
    env.api.setLang('en')
    env.api.renderBacklinks()
    assert(env.host.innerHTML.indexOf(EN['editor.backlinksMore'].replace('{n}', '2')) >= 0, 'en 切换行计数翻转（实得尾部 ' + env.host.innerHTML.slice(-120) + '）')
    assert(env.host.innerHTML.indexOf(ZH['editor.backlinksMore'].replace('{n}', '2')) < 0, 'en 态零中文滞留')
    env.host.querySelector('[data-bl-more]').fire('click')
    assert(env.host.innerHTML.indexOf(EN['editor.backlinksLess']) >= 0, 'en 展开后翻「Show less」')
  })
  // ===== 138.4 回归锚：≤8 条零切换行 + 既有反链跳转不破 =====
  await t('138 ④回归锚：≤8 条零切换行 + 既有 bl-item 跳转不破（3 条全渲染，点击透传 data-bl id）+ 标题总数口径不动', () => {
    const env = bootBL(3)
    env.api.renderBacklinks()
    const items = env.host.querySelectorAll('.bl-item')
    assert.strictEqual(items.length, 3, '3 条反链全渲染（无截断）')
    assert(env.host.innerHTML.indexOf('data-bl-more') < 0, '≤8 条零切换行')
    assert.strictEqual(env.host.querySelector('[data-bl-more]'), null, '≤8 条切换行元素不存在')
    items[1].fire('click')
    assert.deepStrictEqual(env.jumps, ['r2'], 'bl-item 点击跳转绑定同区不破（data-bl id 透传 jumpToWikiTarget）')
    assert(env.host.innerHTML.indexOf(ZH['editor.backlinksCount'].replace('{n}', '3')) >= 0, '标题行总数口径不动（（3））')
  })
  // ===== 138.5 样式双端：切换行=弱化 bl-item 行（虚线描边+弱化色），既有条目样式不动 =====
  await t('138 ⑤样式双端：app head.html .bl-more + styles.css .dsh-notes-backlink-more（产物 lib/styles.css 同步，既有条目样式不破）', () => {
    assert(headHtml.indexOf('.backlinks .bl-more{') >= 0 && headHtml.indexOf('.backlinks .bl-more:hover{') >= 0, 'app head.html 缺切换行样式（弱化 bl-item 行）')
    assert(cssDev.indexOf('.dsh-notes-backlink-more{') >= 0 && cssDev.indexOf('.dsh-notes-backlink-more:hover{') >= 0, 'styles.css 缺切换行样式')
    assert(cssPkg.indexOf('.dsh-notes-backlink-more{') >= 0, '产物 lib/styles.css 缺切换行样式（需先跑 node scripts/build-dist.cjs）')
    assert(headHtml.indexOf('.backlinks .bl-item{') >= 0 && cssDev.indexOf('.dsh-notes-backlink{') >= 0, '既有 bl-item/backlink 条目样式不动（布局回归红线）')
  })
  // ===== 138.6 i18n 双键双语：backlinksMore/backlinksLess 双字典在案 + {n} 占位同形 =====
  await t('138 ⑥i18n 双键双语：backlinksMore/backlinksLess 双字典在案 + {n} 占位同形（68 节 parity 全域锁）', () => {
    assert(ZH['editor.backlinksMore'] === '展开其余 {n} 条' && EN['editor.backlinksMore'] === 'Show {n} more', 'backlinksMore 双语文案锚')
    assert(ZH['editor.backlinksLess'] === '收起' && EN['editor.backlinksLess'] === 'Show less', 'backlinksLess 双语文案锚')
    const pz = (ZH['editor.backlinksMore'].match(/\{\w+\}/g) || []).join(','), pe = (EN['editor.backlinksMore'].match(/\{\w+\}/g) || []).join(',')
    assert.strictEqual(pz, pe, 'backlinksMore 占位符双端同形（{n}）')
    /* 代码引用锚（68 节②方向二兜底：双键必须被双端代码引用） */
    assert(appWiki.indexOf("'editor.backlinksMore'") >= 0 && cliEd.indexOf("'editor.backlinksMore'") >= 0, 'backlinksMore 双端代码引用')
    assert(appWiki.indexOf("'editor.backlinksLess'") >= 0 && cliEd.indexOf("'editor.backlinksLess'") >= 0, 'backlinksLess 双端代码引用')
  })
  // ===== 138.7 红线：反链计算逻辑零改动（扫描口径/标题行总数/索引热身原样） =====
  await t('138 ⑦红线：反链计算逻辑零改动（wikiLinksTo 扫描口径 + 标题行总数口径双端原样）', () => {
    assert(appWiki.indexOf("if (wikiLinksTo(c.body, edNote.id, edNote.title || '')) bl.push(n);") >= 0, 'app 扫描口径原样（[[该id]] 或 [[该标题]]，自链除外）')
    assert(appWiki.indexOf("t('editor.backlinks') + (warm ? t('editor.backlinksCount', { n: bl.length }) : t('editor.backlinksWarming'))") >= 0, 'app 标题行总数口径原样')
    assert(cliEd.indexOf("if (wikiLinksTo(c.body, curNote.id, curNote.title || '')) out.push(n)") >= 0, 'panel 扫描口径原样')
    assert(cliEd.indexOf("tt('editor.backlinks') + (wikiWarm ? tt('editor.backlinksCount', { n: backlinks.length }) : tt('editor.backlinksWarming'))") >= 0, 'panel 标题行总数口径原样')
  })
  }
}
