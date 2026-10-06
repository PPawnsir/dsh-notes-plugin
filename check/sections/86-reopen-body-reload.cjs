// 节 86. 重开笔记面板正文空白修复（0.4.4-H，notes-044-reopen-body-reload；用户实测 bug 2026-10-06，反馈 n-muwf58akwisp）
// 根因（活机复现锁定）：FloatingPanel 为 shell.overlay 单例——关闭时 return null 销毁 DOM 但 React 态（selected/edBody/editorMode）存活；
//   富文本 contenteditable 非受控（innerHTML 仅由 loadEdBody/模式切换写入），重开时 div 重建为空，
//   而填充效应依赖 [editorMode, selected] 均未变 → 不重跑 → 标题在（受控）正文空白；重新点选走 selectNote→loadEdBody 才回填。
//   源码模式 textarea 受控（value=edBody）天然免疫——故 bug 仅富文本态显现。
// 修复（双闸，均不动 R-1 语义）：
//   ①富文本效应 deps 增 open——重开重跑：el 为重建空节点时按已同步基底回填 innerHTML + 重绑事件族；
//     dirty 卡死态（关闭瞬间在途编辑随旧 DOM 销毁、900ms 防抖落空）一并复位回填，堵「dirty 存活→切笔记序列化空 div 覆盖正文」次生丢数路径；
//   ②重开补拉兜底效应（主窗口推荐方向）：open false→true 且选中存活而正文从未成功加载（未在途/无错误横幅）→ 自动 loadEdBody(selected)；
//     幂等（在途/错误态不重发），正常路径零额外 RPC；R-1 放行点/迟到守卫/错误横幅复用原链路。
// app 端同构核查结论：app.html 无「关→开状态存活」生命周期（浏览器标签关闭=整页销毁 selId 归零；保活 iframe=DOM 存活不空白），
//   且 renderEd 每次重建 DOM 恒调 fillEdBody()（edNote.body 回填），天然无此洞——本节以结构锚锁定该不变量。
module.exports = {
  id: "86",
  title: "86. 重开笔记面板正文空白修复（0.4.4-H：富文本重开回填 + 选中存活未加载自动补拉，R-1 语义不动）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('86. 重开笔记面板正文空白修复（0.4.4-H：富文本重开回填 + 选中存活未加载自动补拉）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const cliEd = read(path.join('src', 'client', 'panels', 'panel', 'editor.js'))
  const cliIndex = read(path.join('src', 'client', 'panels', 'panel', 'index.js'))
  const appEd = read(path.join('src', 'app', 'panels', 'editor.js'))
  const appHtml = read(path.join('packages', 'dsh-notes-plugin', 'app.html'))
  const clientPkgSrc = read(path.join('packages', 'dsh-notes-plugin', 'lib', 'client.js'))

  // ===== ① client 修复锚：open 注入链 + 富文本效应 open 依赖 + 空节点回填 + 重开补拉兜底 =====
  await t('0.4.4-H client：open 开合态注入编辑器 hook（index 装配层 → args.open 解构）', () => {
    assert(cliIndex.indexOf('usePanelEditor({ selected: selected, notes: notes, dispatching: dispatching, open: open,') >= 0, 'index.js 装配层未向 usePanelEditor 注入 open')
    assert(cliEd.indexOf('const open = args.open') >= 0, 'editor.js 未解构 args.open')
  })
  await t('0.4.4-H client：富文本填充/绑定效应依赖增 open（重开重跑）+ 重建空节点按基底回填并复位 dirty 卡死态', () => {
    assert(cliEd.indexOf('}, [editorMode, selected, open])') >= 0, '富文本效应 deps 未含 open（重开不重跑=bug 根因）')
    assert(cliEd.indexOf('if (!richDirtyRef.current || !el.innerHTML) { richDirtyRef.current = false; try { el.innerHTML = renderMarkdown(edBodyRef.current, wikiResolve) } catch (err) {} }') >= 0, '富文本空节点回填/脏态复位行缺失（节 31 renderMarkdown(edBodyRef.current, wikiResolve) 锚点须保留）')
  })
  await t('0.4.4-H client：重开补拉兜底效应（选中存活+正文未加载+未在途+无错误横幅 → loadEdBody(selected)，幂等）', () => {
    assert(cliEd.indexOf('const prevOpenRef = React.useRef(open)') >= 0, 'prevOpenRef 边沿检测缺失')
    assert(cliEd.indexOf('if (open && !prevOpenRef.current && selected && !edBodyLoadedRef.current && !edLoadingRef.current && !edLoadErrRef.current) loadEdBody(selected)') >= 0, '重开补拉条件行缺失（五闸门全量在：开边沿/选中存活/未加载/未在途/无错误横幅）')
    assert(cliEd.indexOf('prevOpenRef.current = open') >= 0, 'prevOpenRef 回写缺失')
  })
  await t('0.4.4-H R-1 红线零放松：迟到丢弃守卫双处保留 + 提交闸唯一放行点不动（拼接产物同口径）', () => {
    const guards = cliEd.split('if (selectedRef.current !== id) return')
    assert(guards.length - 1 >= 2, 'loadEdBody 迟到响应守卫（selectedRef.current !== id）须 ≥2 处（then/catch）')
    assert(cliEd.indexOf('edBodyLoadedRef.current = true   // R-1 正文提交闸：全局唯一放行点') >= 0, 'R-1 放行点锚零改动')
    assert(clientSrc.indexOf('}, [editorMode, selected, open])') >= 0, 'client 拼接产物含 open 依赖（src/client/** 拼接直出）')
    assert(clientPkgSrc.indexOf('}, [editorMode, selected, open])') >= 0, '发布包 lib/client.js 含 open 依赖（改后需跑 build-dist）')
    assert(clientPkgSrc.indexOf('prevOpenRef.current && selected') >= 0, '发布包含重开补拉兜底（build-dist 同步）')
  })

  // ===== ② app 端同构核查：无「关→开状态存活」半链路——renderEd 重建恒回填 fillEdBody（不变量锁定） =====
  await t('0.4.4-H app 同构核查：renderEd 重建 DOM 恒调 fillEdBody 回填（edNote.body 随渲染恢复，天然无空白中间态）', () => {
    assert(appEd.indexOf('renderCrumb(); renderMeta(); renderDispatches(); fillEdBody(); renderEdFoot(); refreshDegradeUI(); renderBacklinks();') >= 0, 'app renderEd 回填链（fillEdBody）锚缺失')
    assert(appHtml.indexOf('renderCrumb(); renderMeta(); renderDispatches(); fillEdBody();') >= 0, 'app.html 产物同口径（改 src/app/** 后需跑 concat-app/build-dist）')
    // app 侧选中态不跨页存活（无持久化键）：整页重载 selId 归零——不存在「选中存活+正文未加载」输入域
    assert(appEd.indexOf('var selId') < 0 && read(path.join('src', 'app', 'kernel', 'state.js')).indexOf('var selId = null, edNote = null;') >= 0, 'app 选中态为模块级内存量（重载归零），无持久化恢复')
  })
  }
}
