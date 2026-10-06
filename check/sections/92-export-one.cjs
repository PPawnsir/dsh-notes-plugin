// 节 92. 0.4.5-F 详情页一键导出单篇 MD（notes-045-export-one）
// 笔记详情 meta 动作区「导出」按钮（down 图标，与历史/派发同排）→ 纯前端 Blob 浏览器下载 <标题>.md：
//   ① 按钮双端（client editor.js + app editor-meta.js）+ 原型镜像结构锚 + 双产物同步；
//   ② 文件名清洗行为级 eval：非法字符 /\:*?"<>| → -；空/空白标题回退「无标题」；中文标题原样；
//   ③ 下载链路 eval 模拟（Blob 正文原样 / a.download 文件名 / click 触发 / revoke 收尾）+
//      图片引用提示分支（含/不含 ![](assets/…) 两态；不阻塞下载）；
//   ④ 富文本同步守卫（0.4.4-F 整理同款）：app 端 edMode='rich' && richDirty 时先 syncFromRich('导出前同步') 再取正文（行为级实证导出的是同步后源码）。
// 红线：零新 RPC（无 notes-export-one 之类注册）；不动 notes-export-single 链路；正文原样不改写（不加 front-matter/不擅自加 H1）。
// 测试策略：双端+原型+双产物静态锚；i18n 双语四键取值锚定；exportFileName/doExportOne 双端可 eval 行为断言；e2e 用例㉕ 真实下载事件收口。
module.exports = {
  id: "92",
  title: "92. 0.4.5-F 详情页一键导出单篇 MD（meta 导出按钮 + Blob 下载 + 文件名清洗 + 图片引用提示）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR } = H
  section('92. 0.4.5-F 详情页一键导出单篇 MD（meta 导出 + Blob 下载）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const zhSrc = read(path.join('src', 'i18n', 'zh.js')), enSrc = read(path.join('src', 'i18n', 'en.js'))
  const cliEditor = read(path.join('src', 'client', 'panels', 'panel', 'editor.js'))
  const appMeta = read(path.join('src', 'app', 'panels', 'editor-meta.js'))
  const protoSrc = read(path.join('design', 'notes-ui-v2.html'))
  const appPkg = read(path.join('packages', 'dsh-notes-plugin', 'app.html'))
  const cliPkg = read(path.join('packages', 'dsh-notes-plugin', 'lib', 'client.js'))
  const hostTransfer = read(path.join('src', 'host', 'transfer.js'))

  // 大括号配平函数体提取（client 钩内 8 空格缩进 / app 列 0 通吃；本卡函数串内无裸括号干扰）
  function grabFn(src, name, tag) {
    const start = src.indexOf('function ' + name + '(')
    assert(start >= 0, tag + ' 缺 function ' + name + '()')
    const braceStart = src.indexOf('{', start)
    let depth = 0, i = braceStart
    for (; i < src.length; i++) {
      const ch = src[i]
      if (ch === '{') depth++
      else if (ch === '}') { depth--; if (depth === 0) break }
    }
    assert(depth === 0, tag + ' ' + name + '() 括号不配平')
    return src.slice(start, i + 1)
  }
  // 浏览器环境打桩 + with 域 eval（同 87 节④口径）：录制 Blob 内容/a.download/click/revoke/toast
  function mkWorld(extra) {
    const rec = { toasts: [], blobs: [], downloads: [], clicks: 0, revoked: [], syncs: [] }
    const ctx = {
      Blob: function (parts, opts) { rec.blobs.push({ parts: parts, opts: opts }) },
      URL: { createObjectURL: function () { return 'blob:mock-' + (rec.blobs.length) }, revokeObjectURL: function (u) { rec.revoked.push(u) } },
      document: {
        createElement: function () { var el = { href: '', download: '', click: function () { rec.clicks++; rec.downloads.push(el.download) }, remove: function () {} }; return el },
        body: { appendChild: function () {} }
      },
      setTimeout: function (fn) { try { fn() } catch (e) {} return 0 },
    }
    Object.assign(ctx, extra || {})
    const proxy = new Proxy(ctx, {
      has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
      get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
      set(t2, k, v) { t2[k] = v; return true }
    })
    return { rec: rec, ctx: ctx, proxy: proxy }
  }
  function evalFns(world, srcs) {
    return new Function('scope', 'with (scope) {\n' + srcs.join('\n') + '\nreturn { exportFileName: exportFileName, doExportOne: doExportOne }\n}')(world.proxy)
  }
  const zhT = (k, vars) => { const m = zhSrc.match(new RegExp("'" + k.replace('.', '\\.') + "': '([^']*)'")); let s = m ? m[1] : k; if (vars) s = s.replace(/\{(\w+)\}/g, (mm, n) => vars[n] != null ? String(vars[n]) : mm); return s }

  // ===== ① 按钮双端 + 原型结构锚 + 双产物同步 + 零新 RPC 红线 =====
  await t('导出按钮双端+原型结构锚：meta 动作区 down 图标同排 + 接线齐 + 产物同步 + 零新 RPC', () => {
    // client（React e() 结构，与历史/派发同排 meta-act）
    assert(cliEditor.indexOf("I('down', 12), tt('meta.export')") >= 0, 'client meta 动作区导出按钮（down 图标 + meta.export）')
    assert(cliEditor.indexOf("'data-tooltip': tt('meta.exportTip')") >= 0 && cliEditor.indexOf('onClick: (ev) => { ev.stopPropagation(); doExportOne() }') >= 0, 'client 导出按钮 tooltip + onClick 接线')
    assert(cliEditor.indexOf("syncFromRich('导出前同步')") >= 0, 'client 富文本在途编辑同步守卫（0.4.4-F 整理同款）')
    // app（模板串 + id 接线）
    assert(appMeta.indexOf('id="mExport"') >= 0 && appMeta.indexOf("icon('i-down') + t('meta.export')") >= 0, 'app meta 动作区 mExport 按钮')
    assert(appMeta.indexOf("$('mExport').onclick = function () { doExportOne() }") >= 0, 'app mExport 接线')
    assert(appMeta.indexOf("syncFromRich('导出前同步')") >= 0, 'app 富文本在途编辑同步守卫')
    // 序位锚：导出在历史之后、置顶之前（双端同位）
    assert(appMeta.indexOf('id="mHist"') < appMeta.indexOf('id="mExport"') && appMeta.indexOf('id="mExport"') < appMeta.indexOf('id="mPin"'), 'app 导出按钮序位：历史 < 导出 < 置顶')
    assert(cliEditor.indexOf("tt('meta.history')) : null") < cliEditor.indexOf("tt('meta.export')") && cliEditor.indexOf("tt('meta.export')") < cliEditor.indexOf("tt('meta.unpin')"), 'client 导出按钮序位：历史 < 导出 < 置顶')
    // 原型镜像（不双语红线：静态中文）
    assert(protoSrc.indexOf('id="mExport"') >= 0 && protoSrc.indexOf('function doExportOne()') >= 0 && protoSrc.indexOf("$('mExport').onclick = function () { doExportOne() }") >= 0, '原型导出按钮 + 函数 + 接线')
    assert(protoSrc.indexOf('function exportFileName(') >= 0, '原型文件名清洗函数')
    // 双产物同步（需先跑 build-dist）
    assert(appPkg.indexOf('id="mExport"') >= 0 && appPkg.indexOf('function doExportOne()') >= 0, 'app.html 产物含导出按钮与函数（需先跑 build-dist）')
    assert(cliPkg.indexOf("tt('meta.export')") >= 0 && cliPkg.indexOf('function doExportOne()') >= 0, 'lib/client.js 产物含导出按钮与函数（需先跑 build-dist）')
    // 红线①：零新 RPC——host 未注册 notes-export-one 类端点（纯前端 Blob 下载）
    assert(hostTransfer.indexOf('notes-export-one') < 0, '零新 RPC 红线：host 无 notes-export-one')
    // 红线②：export-single 链路不动（拼接导出入口原样）
    assert(hostTransfer.indexOf('notes-export-single') >= 0 && appMeta.indexOf('mExport') >= 0 && read(path.join('src', 'client', 'modals', 'export-single.js')).indexOf("host.call('notes-export-single'") >= 0, 'export-single 拼接链路原样保留（互不替代）')
    // 红线③：正文原样——双端 doExportOne 均不加 front-matter/标题 H1
    const appFn = grabFn(appMeta, 'doExportOne', 'app'), cliFn = grabFn(cliEditor, 'doExportOne', 'client')
    assert(appFn.indexOf('front-matter') < 0 && appFn.indexOf("'# '") < 0 && cliFn.indexOf("'# '") < 0, '正文原样红线：不拼 front-matter/不擅自加 H1')
  })

  // ===== ② i18n 双语四键 =====
  await t('meta.export/exportTip/exportedToast/exportImgWarn 双语在案 + 取值锚定', () => {
    const grab = (s, v) => new Function(s + '\nreturn ' + v)()
    const zh = grab(zhSrc, 'I18N_ZH'), en = grab(enSrc, 'I18N_EN')
    assert.strictEqual(zh['meta.export'], '导出', 'zh meta.export')
    assert.strictEqual(en['meta.export'], 'Export', 'en meta.export')
    assert(zh['meta.exportTip'].indexOf('Markdown') >= 0 && zh['meta.exportTip'].indexOf('不内联') >= 0, 'zh meta.exportTip 语义（原样下载 + 图片不内联预告）')
    assert(en['meta.exportTip'].indexOf('Markdown') >= 0 && en['meta.exportTip'].indexOf('not inlined') >= 0, 'en meta.exportTip 语义')
    assert.strictEqual(zh['meta.exportedToast'], '已导出 {name}', 'zh meta.exportedToast（{name} 插值位）')
    assert.strictEqual(en['meta.exportedToast'], 'Exported {name}', 'en meta.exportedToast')
    assert(zh['meta.exportImgWarn'].indexOf('导出单文件') >= 0, 'zh meta.exportImgWarn 指引设置→导出单文件')
    assert(en['meta.exportImgWarn'].indexOf('Export single file') >= 0, 'en meta.exportImgWarn 指引')
  })

  // ===== ③ 文件名清洗行为级 eval（双端同口径：非法字符/空标题/空白标题/中文/首尾空白）=====
  await t('文件名清洗行为级：/\\:*?"<>| → - + 空标题回退「无标题」+ 中文原样 + trim（client/app 双端 eval）', () => {
    const cliFns = evalFns(mkWorld({ tt: zhT }), [grabFn(cliEditor, 'exportFileName', 'client'), grabFn(cliEditor, 'doExportOne', 'client')])
    const appFns = evalFns(mkWorld({ t: zhT }), [grabFn(appMeta, 'exportFileName', 'app'), grabFn(appMeta, 'doExportOne', 'app')])
    for (const [label, fns] of [['client', cliFns], ['app', appFns]]) {
      assert.strictEqual(fns.exportFileName('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j.md', label + ' 九非法字符全洗为 -')
      assert.strictEqual(fns.exportFileName(''), '无标题.md', label + ' 空标题回退「无标题」')
      assert.strictEqual(fns.exportFileName('   '), '无标题.md', label + ' 纯空白标题回退「无标题」')
      assert.strictEqual(fns.exportFileName('中文标题'), '中文标题.md', label + ' 中文标题原样')
      assert.strictEqual(fns.exportFileName('  周报 v2  '), '周报 v2.md', label + ' 首尾空白 trim')
      assert.strictEqual(fns.exportFileName('Untitled'), '无标题.md', label + ' host 无题缺省 Untitled 归一为本地化「无标题」（F verifier 观察 a 收口）')
    }
  })

  // ===== ④ 下载链路 + 图片引用提示两态 + 富文本同步守卫（行为级 eval）=====
  await t('下载链路 eval 实证：Blob 正文原样 + a.download 文件名 + click 触发 + revoke 收尾 + 图片提示两态 + 富文本守卫', () => {
    const appFnSrcs = [grabFn(appMeta, 'exportFileName', 'app'), grabFn(appMeta, 'doExportOne', 'app')]
    // 态A：含 ![](assets/…) 引用 → 双 toast（已导出 + 未内联提示）
    const wA = mkWorld({ t: zhT, toast: function (m) { wA.rec.toasts.push(m) }, edNote: { title: '演示/标题', body: '正文A\n![图](assets/p.png)' }, edMode: 'source', richDirty: false })
    evalFns(wA, appFnSrcs).doExportOne()
    assert.strictEqual(wA.rec.blobs.length, 1, '态A Blob 恰建一次')
    assert.strictEqual(wA.rec.blobs[0].parts[0], '正文A\n![图](assets/p.png)', '态A Blob 正文原样（零改写）')
    assert.strictEqual(wA.rec.blobs[0].opts.type, 'text/markdown;charset=utf-8', '态A Blob MIME 锚定')
    assert.deepStrictEqual(wA.rec.downloads, ['演示-标题.md'], '态A a.download 文件名清洗后落位')
    assert.strictEqual(wA.rec.clicks, 1, '态A a.click() 触发下载')
    assert.strictEqual(wA.rec.revoked.length, 1, '态A revokeObjectURL 收尾')
    assert.strictEqual(wA.rec.toasts.length, 2, '态A 双 toast（已导出 + 图片未内联提示）')
    assert.strictEqual(wA.rec.toasts[0], '已导出 演示-标题.md', '态A 首 toast 已导出（含清洗后文件名）')
    assert.strictEqual(wA.rec.toasts[1], zhT('meta.exportImgWarn'), '态A 次 toast 图片未内联提示（不阻塞下载：提示在下载之后）')
    // 态B：无 assets 引用 → 仅已导出 toast
    const wB = mkWorld({ t: zhT, toast: function (m) { wB.rec.toasts.push(m) }, edNote: { title: 'plain', body: '纯文本\n![外链](https://x/p.png)' }, edMode: 'source', richDirty: false })
    evalFns(wB, appFnSrcs).doExportOne()
    assert.strictEqual(wB.rec.toasts.length, 1, '态B 仅已导出 toast（外链图片不算本地引用）')
    assert.strictEqual(wB.rec.toasts[0], '已导出 plain.md', '态B toast 文案')
    // 态C：富文本在途编辑 → 先 syncFromRich 再取同步后正文（0.4.4-F 同款守卫行为级）
    const wC = mkWorld({
      t: zhT, toast: function () {}, edMode: 'rich', richDirty: true,
      edNote: { title: '富文本', body: '旧正文' },
      syncFromRich: function (why) { wC.rec.syncs.push(why); wC.ctx.edNote.body = '同步后正文'; wC.ctx.richDirty = false },
    })
    evalFns(wC, appFnSrcs).doExportOne()
    assert.deepStrictEqual(wC.rec.syncs, ['导出前同步'], '态C 富文本在途先同步（理由串锚定）')
    assert.strictEqual(wC.rec.blobs[0].parts[0], '同步后正文', '态C 导出的是同步后源码正文')
    // 态D：client 端同链路（refs 形态 + tt + showToast）
    const wD = mkWorld({
      tt: zhT, showToast: function (m) { wD.rec.toasts.push(m) },
      selectedRef: { current: 'n1' }, editorModeRef: { current: 'rich' }, richDirtyRef: { current: true },
      edBodyRef: { current: 'client 旧' }, edTitleRef: { current: '客/端' },
      syncFromRich: function () { wD.ctx.edBodyRef.current = 'client 同步后'; wD.ctx.richDirtyRef.current = false },
    })
    evalFns(wD, [grabFn(cliEditor, 'exportFileName', 'client'), grabFn(cliEditor, 'doExportOne', 'client')]).doExportOne()
    assert.strictEqual(wD.rec.blobs[0].parts[0], 'client 同步后', 'client 富文本在途先同步再导出')
    assert.deepStrictEqual(wD.rec.downloads, ['客-端.md'], 'client a.download 文件名清洗')
    assert.strictEqual(wD.rec.clicks, 1, 'client a.click() 触发')
    // 守卫：无选中笔记零副作用（client selectedRef null）
    const wE = mkWorld({ tt: zhT, showToast: function (m) { wE.rec.toasts.push(m) }, selectedRef: { current: null }, editorModeRef: { current: 'source' }, richDirtyRef: { current: false }, edBodyRef: { current: 'x' }, edTitleRef: { current: 'x' } })
    evalFns(wE, [grabFn(cliEditor, 'exportFileName', 'client'), grabFn(cliEditor, 'doExportOne', 'client')]).doExportOne()
    assert.strictEqual(wE.rec.blobs.length, 0, '无选中笔记零下载（守卫）')
    assert.strictEqual(wE.rec.toasts.length, 0, '无选中笔记零 toast（守卫）')
    // 原型回归：原型 doExportOne 无富文本守卫（原型无双模式编辑器）+ 链路同款
    const protoFn = grabFn(protoSrc, 'doExportOne', '原型')
    assert(protoFn.indexOf('syncFromRich') < 0, '原型无富文本守卫（source-only 编辑器）')
    assert(protoFn.indexOf("type: 'text/markdown;charset=utf-8'") >= 0 && protoFn.indexOf('a.download = fname') >= 0, '原型 Blob 下载链路同款')
  })
  }
}
