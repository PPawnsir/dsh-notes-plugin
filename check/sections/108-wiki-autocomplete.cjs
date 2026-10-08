// 节 108. 0.4.8 双链 [[ 输入补全（notes-048-wiki-autocomplete）：源码模式 [[ 触发补全下拉
// 规格：源码 textarea 输入「[[」开下拉（query 到 ]] 或换行止）；内存过滤零 RPC（标题子串+id 前缀双匹配，剔除软删/sys，
//   updatedAt 倒序前 8）；↑↓ 导航、Enter/Tab 选中插入 [[id]] 闭合并复位光标、Esc/点外/失配关闭；零命中空态行不可选；
//   mirror-div 光标跟随定位（视口夹紧）；双端同构（app panels/wiki-ac.js + client panel/editor.js）+ 原型回写 + i18n 双语。
// 红线看守：wikiResolve 解析契约不动 / 自动保存 900ms 口径不动 / 富文本模式零改动 / 插入后光标落闭合括号后。
// 行为级主战场：内核纯函数 wikiAcTrigger/wikiAcFilter 提取 eval 全矩阵；交互级归 e2e ㊵（app）/ ㊶（面板 harness）。
module.exports = {
  id: "108",
  title: "108. 0.4.8 双链 [[ 输入补全（notes-048-wiki-autocomplete）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('108. 0.4.8 双链 [[ 输入补全（notes-048-wiki-autocomplete）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const kernelSrc = read('src/shared/editor-kernel.js')
  const appWikiAc = read('src/app/panels/wiki-ac.js')
  const appEditor = read('src/app/panels/editor.js')
  const appManifest = read('src/app/manifest.js')
  const cliEditor = read('src/client/panels/panel/editor.js')
  const stylesSrc = read('src/styles.css')
  const appHead = read('src/app/shell/head.html')
  const protoV3 = read('design/notes-editor-v3.html')
  const appWiki = read('src/app/panels/wiki.js')
  const appHtml = read('packages/dsh-notes-plugin/app.html')
  const clientPkgSrc = read('packages/dsh-notes-plugin/lib/client.js')
  const grab = (f, v) => new Function(read('src/i18n/' + f) + '\nreturn ' + v)()
  const ZH = grab('zh.js', 'I18N_ZH'), EN = grab('en.js', 'I18N_EN')

  // ===== 108.1 内核纯函数行为级 eval（从内核标记块提取 wikiAcTrigger/wikiAcFilter/WIKI_AC_MAX 跑全矩阵）=====
  function grabWikiAc(src, label) {
    const i0 = src.indexOf('// ===== 0.4.8 双链 [[ 输入补全')
    const i1 = src.indexOf('// ===== end 双模式编辑器内核 v3 =====')
    assert(i0 >= 0 && i1 > i0, label + ' 含 0.4.8 wiki-ac 内核标记区间')
    return new Function(src.slice(i0, i1) + '\nreturn { wikiAcTrigger: wikiAcTrigger, wikiAcFilter: wikiAcFilter, WIKI_AC_MAX: WIKI_AC_MAX }')()
  }
  await t('0.4.8 双链 [[ 补全内核纯函数行为级：wikiAcTrigger 窗口开合 + wikiAcFilter 双匹配/剔除/倒序/上限', () => {
    const ac = grabWikiAc(kernelSrc, 'editor-kernel.js')
    // wikiAcTrigger 触发窗口矩阵
    const a1 = ac.wikiAcTrigger('见 [[ab', 6)
    assert(a1 && a1.start === 2 && a1.query === 'ab', '[[ 开窗：start 指「[[」首字符 + query 为窗口内字符（实得 ' + JSON.stringify(a1) + '）')
    assert(ac.wikiAcTrigger('[[', 2) && ac.wikiAcTrigger('[[', 2).query === '', '裸 [[ 开窗（空 query = 全量候选）')
    assert(ac.wikiAcTrigger('见 [[a]]', 7) === null, '窗口内含 ]] → 闭合失配（null）')
    assert(ac.wikiAcTrigger('见 [[a\nb', 7) === null, '窗口内换行 → 失配（null）')
    assert(ac.wikiAcTrigger('x[', 2) === null && ac.wikiAcTrigger('x', 1) === null, '无 [[ / caret<2 → null')
    assert(ac.wikiAcTrigger('前 [[x]] 后 [[y', 13) && ac.wikiAcTrigger('前 [[x]] 后 [[y', 13).query === 'y', '多窗取 caret 前最后一个 [[')
    // wikiAcFilter 过滤矩阵
    const fix = [
      { id: 'n-a1', title: '发布清单', kind: 'note', updatedAt: '2026-10-02T00:00:00.000Z' },
      { id: 'n-b2', title: '面板归档', kind: 'note', updatedAt: '2026-10-04T00:00:00.000Z' },
      { id: 'n-c3', title: '发布记录', kind: 'log', updatedAt: '2026-10-03T00:00:00.000Z' },
      { id: 'n-d4', title: '已删笔记', kind: 'note', updatedAt: '2026-10-05T00:00:00.000Z', deleted: true },
      { id: 'n-s5', title: '机器索引', kind: 'sys', updatedAt: '2026-10-06T00:00:00.000Z' },
    ]
    const hitPub = ac.wikiAcFilter(fix, '发布')
    assert(hitPub.length === 2 && hitPub[0].id === 'n-c3' && hitPub[1].id === 'n-a1', '标题子串（小写折叠）命中 + updatedAt 倒序（实得 ' + hitPub.map(n => n.id).join(',') + '）')
    const hitId = ac.wikiAcFilter(fix, 'N-B')
    assert(hitId.length === 1 && hitId[0].id === 'n-b2', 'id 前缀匹配（大小写折叠）')
    assert(ac.wikiAcFilter(fix, '机器').length === 0 && ac.wikiAcFilter(fix, '已删').length === 0, 'sys/软删剔除（组件侧兜底双闸）')
    const all = ac.wikiAcFilter(fix, '')
    assert(all.length === 3 && all[0].id === 'n-b2', '空 query = 存活全量按 updatedAt 倒序')
    const many = []
    for (let i = 0; i < 12; i++) many.push({ id: 'n-m' + i, title: '批量' + i, kind: 'note', updatedAt: '2026-10-' + String(i + 1).padStart(2, '0') + 'T00:00:00.000Z' })
    const capped = ac.wikiAcFilter(many, '批量')
    assert(capped.length === ac.WIKI_AC_MAX && capped[0].id === 'n-m11', '上限 WIKI_AC_MAX=8 截断（最新优先）')
  })

  // ===== 108.2 内核三端产物同步（物理单份共源；本断言锁「改内核须重拼产物」）=====
  await t('0.4.8 wiki-ac 内核三端产物同步：client 拼接/app.html/发布包 lib/client.js 同含 wikiAcTrigger+wikiAcFilter', () => {
    for (const [label, src] of [['client 拼接产物', clientSrc], ['app.html', appHtml], ['发布包 lib/client.js', clientPkgSrc]]) {
      assert(src.indexOf('function wikiAcTrigger(text, caret)') >= 0, label + ' 含 wikiAcTrigger')
      assert(src.indexOf('function wikiAcFilter(notes, query)') >= 0, label + ' 含 wikiAcFilter')
      assert(src.indexOf('var WIKI_AC_MAX = 8') >= 0, label + ' 含 WIKI_AC_MAX=8')
    }
  })

  // ===== 108.3 app 端接线（wiki-ac.js 模块 + manifest 序位 + editor.js 挂点/收编）=====
  await t('0.4.8 app 端接线：wiki-ac.js 模块登记 + bindWikiAc 四挂点 + renderEd/switchMode 收编 + 插入闭合锚', () => {
    assert(appManifest.indexOf("'panels/wiki-ac.js'") >= 0, 'app manifest 登记 panels/wiki-ac.js')
    assert(appManifest.indexOf("'panels/wiki.js'") < appManifest.indexOf("'panels/wiki-ac.js'") && appManifest.indexOf("'panels/wiki-ac.js'") < appManifest.indexOf("'panels/editor.js'"), '序位：wiki.js 之后、editor.js 之前（bindEditorArea 调用点可见）')
    for (const k of ['function wikiAcRefresh()', 'function wikiAcRender(ta)', 'function wikiAcPosition(ta)', 'function wikiAcMove(delta)', 'function wikiAcApply(n)', 'function wikiAcKeydown(ev)', 'function wikiAcClose()', 'function bindWikiAc(ta)']) {
      assert(appWikiAc.indexOf(k) >= 0, 'wiki-ac.js 缺 ' + k)
    }
    assert(appWikiAc.indexOf("addEventListener('input', wikiAcRefresh)") >= 0 && appWikiAc.indexOf("addEventListener('keydown', wikiAcKeydown)") >= 0
      && appWikiAc.indexOf("addEventListener('blur', wikiAcClose)") >= 0 && appWikiAc.indexOf("addEventListener('scroll'") >= 0, 'bindWikiAc 四挂点（input/keydown/blur/scroll）')
    assert(appWikiAc.indexOf("addEventListener('keyup'") >= 0 && appWikiAc.indexOf("addEventListener('click'") >= 0, '方向键/鼠标挪光标重估挂点（开态重估、关态绝不自开）')
    assert(appWikiAc.indexOf("el.addEventListener('mousedown', function (ev) { ev.preventDefault(); })") >= 0, '弹层 mousedown 拦默认保焦点（点外关闭由 blur 承担）')
    assert(appWikiAc.indexOf("var ins = '[[' + n.id + ']]'") >= 0, '插入产物 = [[id]]（id 最稳，渲染层 wikiResolve 显示标题）')
    assert(appWikiAc.indexOf('ta.setSelectionRange(pos, pos)') >= 0 && appWikiAc.indexOf('var pos = start + ins.length') >= 0, '红线：插入后光标落闭合括号后')
    assert(appWikiAc.indexOf("ta.value.slice(0, start) + ins + ta.value.slice(caret)") >= 0, '[[query 窗口整体替换为 [[id]]（闭合）')
    assert(appWikiAc.indexOf("t('editor.wikiAcEmpty')") >= 0, '零命中空态行走 i18n 字典')
    assert(appEditor.indexOf('bindWikiAc(ta)') >= 0, 'editor.js bindEditorArea 挂 bindWikiAc')
    assert(appEditor.indexOf('function renderEd()') >= 0 && appEditor.indexOf('wikiAcClose();   /* 0.4.8：重建编辑器 DOM 前收编') >= 0, 'renderEd 重建前收编弹层')
    assert(appEditor.indexOf('wikiAcClose();   /* 0.4.8：离开源码模式收编') >= 0, 'switchMode 切富文本收编弹层')
    assert(appHtml.indexOf('function bindWikiAc(ta)') >= 0, 'app.html 产物含 wiki-ac 模块（改后须 concat-app/build-dist）')
  })

  // ===== 108.4 client 端接线（panel/editor.js + 发布包同步）=====
  await t('0.4.8 client 端接线：panel/editor.js 同构挂点（onKeyDown/onBlur/onScroll/onChange）+ 三路收编 + 发布包同步', () => {
    for (const k of ['function wikiAcRefresh()', 'function wikiAcRender(ta)', 'function wikiAcPosition(ta)', 'function wikiAcMove(delta)', 'function wikiAcApply(n)', 'function wikiAcKeydown(ev)', 'function wikiAcClose()', 'const wikiAcRef = React.useRef(null)']) {
      assert(cliEditor.indexOf(k) >= 0, 'client editor.js 缺 ' + k)
    }
    assert(cliEditor.indexOf('onKeyDown: (ev) => wikiAcKeydown(ev)') >= 0, 'textarea onKeyDown 挂点')
    assert(cliEditor.indexOf('onBlur: () => wikiAcClose()') >= 0 && cliEditor.indexOf('onScroll: () =>') >= 0, 'blur 点外关闭 + scroll 跟随重定位挂点')
    assert(cliEditor.indexOf('onKeyUp: (ev) =>') >= 0 && cliEditor.indexOf('onClick: () =>') >= 0, '方向键/鼠标挪光标重估挂点（开态重估、关态绝不自开）')
    assert(cliEditor.indexOf('if (t2 && t2.value === next)') >= 0, '延时复位光标的值不变守卫（timer 漂移竞态根修：打字在途即放弃复位）')
    assert(cliEditor.indexOf('scheduleDegAnalyze(); wikiAcRefresh() }') >= 0, 'onChange 链路尾部重估触发窗')
    assert(cliEditor.indexOf('if (!open) wikiAcClose()') >= 0 && cliEditor.indexOf("if (editorMode !== 'source') wikiAcClose()") >= 0, '面板关闭/切富文本/卸载三路收编')
    assert(cliEditor.indexOf("const ins = '[[' + n.id + ']]'") >= 0 && cliEditor.indexOf('t2.setSelectionRange(pos, pos)') >= 0, '插入 [[id]] 闭合 + 光标落括号后（红线）')
    assert(cliEditor.indexOf("tt('editor.wikiAcEmpty')") >= 0, '零命中空态行走 i18n 字典')
    assert(cliEditor.indexOf('wikiAcFilter(notesRef.current, trig.query)') >= 0, '数据源 = notesRef 内存缓存镜像（零 RPC）')
    assert(clientPkgSrc.indexOf('function wikiAcKeydown(ev)') >= 0 && clientPkgSrc.indexOf('dsh-notes-wiki-ac') >= 0, '发布包 lib/client.js 同步含 wiki-ac（改后须 build-dist）')
  })

  // ===== 108.5 事件边界 + 弹层纪律（双端同构锚）=====
  await t('0.4.8 事件边界双端同构：↑↓/Enter/Tab/Esc preventDefault+stopPropagation + IME 让位 + 零命中空态不可选', () => {
    for (const [label, s] of [['app', appWikiAc], ['client', cliEditor]]) {
      assert(s.indexOf("if (ev.key === 'ArrowDown') { ev.preventDefault(); ev.stopPropagation();") >= 0, label + ' ↓ 归下拉（拦冒泡）')
      assert(s.indexOf("if (ev.key === 'ArrowUp') { ev.preventDefault(); ev.stopPropagation();") >= 0, label + ' ↑ 归下拉（拦冒泡）')
      assert(s.indexOf("if (ev.key === 'Escape')") >= 0 && s.indexOf('ev.preventDefault(); ev.stopPropagation(); wikiAcClose(); return') >= 0, label + ' Esc 零副作用关闭（stopPropagation 防误触 Esc 分层栈）')
      assert(s.indexOf('isComposing') >= 0, label + ' IME 组合中让位输入法')
      assert(s.indexOf('wiki-ac-empty') >= 0 && s.indexOf('else wikiAcClose()') >= 0, label + ' 零命中空态行（不可选，Enter/Tab 穿透仅关下拉）')
      assert(s.indexOf('mirror-div') >= 0, label + ' 弹层定位选型注释在案（mirror-div 光标跟随，弃 textarea 底部固定）')
      assert(s.indexOf('window.innerWidth - pw - 8') >= 0 && s.indexOf('window.innerHeight - ph - 8') >= 0, label + ' 视口夹紧不溢出')
    }
  })

  // ===== 108.6 CSS 三端 + 原型回写 =====
  await t('0.4.8 补全下拉样式三端 + 原型回写（app head.html / client styles.css / notes-editor-v3.html）', () => {
    for (const [label, src, sel] of [['app head.html', appHead, '.wiki-ac{'], ['client styles.css', stylesSrc, '.dsh-notes-wiki-ac{'], ['原型', protoV3, '.wiki-ac{']]) {
      const i = src.indexOf(sel)
      assert(i >= 0, label + ' 缺选择器 ' + sel)
      const rule = src.slice(i, src.indexOf('}', i))
      assert(rule.indexOf('position:fixed') >= 0 && rule.indexOf('overflow-y:auto') >= 0, label + ' 弹层 fixed + 纵向滚动')
    }
    assert(appHead.indexOf('.wiki-ac-item.on{') >= 0 && appHead.indexOf('.wiki-ac-empty{') >= 0, 'app 选中态/空态样式')
    assert(stylesSrc.indexOf('.dsh-notes-wiki-ac-item.on{') >= 0 && stylesSrc.indexOf('.dsh-notes-wiki-ac-empty{') >= 0, 'client 选中态/空态样式')
    assert(protoV3.indexOf('.wiki-ac-item.on{') >= 0 && protoV3.indexOf('.wiki-ac-empty{') >= 0, '原型选中态/空态样式')
    // 原型回写：纯函数演示副本 + mock 候选源（含已删剔除演示）+ srcTa 绑定 + selftest 用例
    assert(protoV3.indexOf('function wikiAcTrigger(text,caret)') >= 0 && protoV3.indexOf('function wikiAcFilter(notes,query)') >= 0, '原型纯函数演示副本')
    assert(protoV3.indexOf('var WIKI_AC_NOTES=[') >= 0 && protoV3.indexOf('已删演示（不应出现）') >= 0, '原型 mock 候选源（含已删剔除演示行）')
    assert(protoV3.indexOf("addEventListener('input',wikiAcRefresh)") >= 0 && protoV3.indexOf("addEventListener('keydown',wikiAcKeydown)") >= 0, '原型 srcTa 绑定（input/keydown）')
    assert(protoV3.indexOf('0.4.8 wikiAcTrigger：') >= 0 && protoV3.indexOf('0.4.8 wikiAcFilter：') >= 0, '原型 selftest 含 wiki-ac 用例')
  })

  // ===== 108.7 i18n 双语 =====
  await t('0.4.8 i18n：editor.wikiAcEmpty 双字典非空 + 双端代码引用', () => {
    assert(ZH['editor.wikiAcEmpty'] === '无匹配笔记', 'zh 字典空态文案')
    assert(EN['editor.wikiAcEmpty'] === 'No matching notes', 'en 字典空态文案')
    assert(appWikiAc.indexOf("'editor.wikiAcEmpty'") >= 0 && cliEditor.indexOf("'editor.wikiAcEmpty'") >= 0, '双端代码引用（节 68 双向覆盖兜底）')
  })

  // ===== 108.8 红线 =====
  await t('0.4.8 双链 [[ 补全红线：wikiResolve 契约/900ms 自动保存/富文本零改动', () => {
    // wikiResolve 解析契约逐字不动（[[id]] 精确 id 优先、[[标题]] 精确匹配）
    assert(appWiki.indexOf("return notes.find(function (n) { return n.id === t; }) || notes.find(function (n) { return (n.title || '') === t; }) || null;") >= 0, 'wikiResolve 解析契约原文不动')
    // 900ms 自动保存口径不动（app doSave 防抖 / client debounce）
    assert(appEditor.indexOf('saveTimer = setTimeout(doSave, 900)') >= 0, 'app 自动保存 900ms 口径不动')
    assert(cliEditor.indexOf('if (selectedRef.current) doSave() }, 900)') >= 0, 'client 自动保存 900ms 防抖口径不动')
    // 富文本零改动：app bindRich 函数体与 client 富文本 effect 不含 wikiAc
    const bindRichBody = appEditor.slice(appEditor.indexOf('function bindRich(rich, wrap)'), appEditor.indexOf('/* 同步态徽标'))
    assert(bindRichBody.indexOf('wikiAc') < 0, 'app 富文本 bindRich 零改动（不含 wikiAc）')
    const richEffect = cliEditor.slice(cliEditor.indexOf('// 进入富文本 / 切换笔记 / 面板重开'), cliEditor.indexOf('// 关联调度兜底'))
    assert(richEffect.indexOf('wikiAc') < 0, 'client 富文本绑定 effect 零改动（不含 wikiAc）')
    // v2 挂点注释在案（富文本补全后续批次挂载点）
    assert(appWikiAc.indexOf('v2 挂点') >= 0 && cliEditor.indexOf('v2 挂点') >= 0, '富文本 v2 挂点注释双端在案')
  })
  }
}
