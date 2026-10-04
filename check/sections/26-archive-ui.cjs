// 节 26. 显式归档 UI（引导气泡 + 预览对话框 + toast 撤销 + 多选合并）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "26",
  title: "26. 显式归档 UI（引导气泡 + 预览对话框 + toast 撤销 + 多选合并）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { appSrc, clientPkgSrc, g, plugin } = S
  // ===== 26. 显式归档 UI（归档按钮引导气泡 + 归档预览对话框 + toast 撤销 + 手动笔记多选合并）=====
  // host 契约（notes-archive-host 收口）：notes-archive-preview → {quickGroups:[{sessionId,title,members:[{id,title,updatedAt,bodyBytes}],dateSpan,totalBytes}]}；
  // notes-archive {groups:[{memberIds,title?}]}（白名单，host 全量校验后才动手）；notes-archive-undo → {undone,restored}
  section('26. 显式归档 UI（引导气泡 + 预览对话框 + toast 撤销 + 多选合并）')
  const protoV2Src = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
  await t('归档按钮改为预览入口 + 引导 tooltip（开发版 + 发布包）', () => {
    const TIP = '归档：把同一会话的速记合并成一篇；点按弹出预览，勾选后才执行（可撤销）'
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      assert(pair[1].indexOf("onClick: openArchive, 'data-tooltip': '" + TIP + "'") >= 0, pair[0] + ' 归档按钮 → openArchive + 引导 tooltip')
      assert(pair[1].indexOf('async function openArchive()') >= 0, pair[0] + ' openArchive 存在')
      assert(pair[1].indexOf('归档合并：速记按会话、普通笔记按标签') < 0, pair[0] + ' 旧 tooltip（行为变更前文案）已清零')
    }
  })
  await t('旧「直接执行归档」逻辑清零（点击不再无参直调 notes-archive）', () => {
    assert(clientSrc.indexOf("onClick: doArchive,") < 0 && clientSrc.indexOf('async function doArchive()') < 0, 'client-impl 不再 onClick: doArchive / 无 doArchive 函数（doArchiveConfirm/doArchiveUndo 不算）')
    assert(clientSrc.indexOf('归档完成：合并 ') < 0, 'client-impl 旧直接执行 toast 已清零')
    assert(clientSrc.indexOf("host.call('notes-archive')") < 0, 'client-impl 不再无参直调 notes-archive')
    assert(clientPkgSrc.indexOf("rpc('notes-archive')") < 0, '发布包不再无参直调 notes-archive')
  })
  await t('归档预览对话框结构（开发版 + 发布包）：组勾选 + 成员展开 + 手动笔记提示 + 确认按钮计数', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1]
      assert(s.indexOf("' 归档预览'") >= 0 && s.indexOf('勾选后才执行 · 合并可撤销') >= 0, pair[0] + ' 对话框标题 + 副标')
      assert(s.indexOf('dsh-notes-arch-list') >= 0 && s.indexOf('dsh-notes-arch-group') >= 0 && s.indexOf('dsh-notes-arch-row') >= 0, pair[0] + ' 组列表结构 class')
      assert(s.indexOf('dsh-notes-arch-members') >= 0 && s.indexOf('dsh-notes-arch-member-dt') >= 0, pair[0] + ' 成员明细（标题+日期）')
      assert(s.indexOf('archChecked[g.sessionId] !== false') >= 0, pair[0] + ' 组级复选框（缺省全勾，false=取消）')
      assert(s.indexOf('archExpand[g.sessionId]') >= 0, pair[0] + ' caret 展开成员明细')
      assert(s.indexOf('fmtBytes(g.totalBytes)') >= 0 && s.indexOf('g.dateSpan.from') >= 0, pair[0] + ' dateSpan + totalBytes 展示')
      assert(s.indexOf('手动笔记不受影响；如需合并手动笔记，请在列表多选后右键合并。') >= 0, pair[0] + ' 底部手动笔记提示')
      assert(s.indexOf("'归档所选（' + checkedCount + ' 组）'") >= 0, pair[0] + ' 确认按钮显示已勾组数')
      assert(s.indexOf('disabled: archPending || checkedCount === 0') >= 0, pair[0] + ' 零勾选/执行中禁用确认（primary 实心 dispatch-ok，非 danger）')
    }
  })
  await t('归档执行链路：preview dry-run → 勾选组白名单 payload（禁 undefined）→ toast 带撤销 → undo RPC', () => {
    assert(clientSrc.indexOf("host.call('notes-archive-preview')") >= 0, 'openArchive 走 notes-archive-preview（dry-run 零写入）')
    assert(clientSrc.indexOf("host.call('notes-archive', { groups: gs.map(g => ({ memberIds: g.members.map(m => m.id) })) })") >= 0, '勾选组 → memberIds 白名单 payload（不带 title，禁 undefined）')
    assert(clientPkgSrc.indexOf("rpc('notes-archive-preview')") >= 0 && clientPkgSrc.indexOf("rpc('notes-archive', { groups: gs.map(") >= 0, '发布包同链路（rpc 形态）')
    // toast 撤销按钮（先例 = app.html toast(m, act)）
    assert(clientSrc.indexOf("showToast('已合并 ' + (res.merged || 0) + ' 组', { label: '撤销', fn: doArchiveUndo })") >= 0, '归档成功 toast 带「撤销」按钮')
    assert(clientSrc.indexOf("host.call('notes-archive-undo')") >= 0 && clientSrc.indexOf("'已撤销归档'") >= 0, '撤销按钮 → notes-archive-undo → toast「已撤销归档」+ 刷新')
    assert(clientSrc.indexOf('typeof toast === \'object\' && toast.act ? 4200 : 2600') >= 0, '带按钮 toast 延长展示（4200ms）')
    assert(clientSrc.indexOf('dsh-notes-toast-act') >= 0 && clientSrc.indexOf('has-act') >= 0, 'toast 动作按钮渲染（has-act 放行点击）')
  })
  await t('Esc 链路：归档预览/合并对话框/多选态入栈', () => {
    assert(clientSrc.indexOf('if (mergeOpenRef.current) { setMergeOpen(false); return }') >= 0, 'Esc 关合并对话框')
    assert(clientSrc.indexOf('if (archOpenRef.current) { setArchOpen(false); return }') >= 0, 'Esc 关归档预览对话框')
    assert(clientSrc.indexOf('if (selModeRef.current) { setSelMode(false); setSelIds({}); return }') >= 0, 'Esc 退出多选态')
  })
  await t('手动笔记多选合并（开发版 + 发布包）：选择 chip + 行复选框 + 操作条 + 标题输入 + 单组 payload', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1]
      assert(s.indexOf("const [selMode, setSelMode] = React.useState(false)") >= 0 && s.indexOf('const [selIds, setSelIds] = React.useState({})') >= 0, pair[0] + ' selMode/selIds 状态')
      assert(s.indexOf('onClick: toggleSelMode') >= 0 && s.indexOf("'选择'") >= 0, pair[0] + ' 「选择」chip 入口')
      assert(s.indexOf("I('check', 12), '合并为一篇'") >= 0, pair[0] + ' 右键菜单「合并为一篇」入口（预勾当前笔记）')
      assert(s.indexOf("className: 'dsh-notes-pick-check'") >= 0, pair[0] + ' 行首复选框')
      assert(s.indexOf('if (selMode) { toggleSelId(n.id); return }') >= 0, pair[0] + ' 多选态行点击=勾选（不打开笔记）')
      assert(s.indexOf('dsh-notes-selbar') >= 0 && s.indexOf("'已选 ' + Object.keys(selIds).length + ' 条'") >= 0, pair[0] + ' 底部浮动操作条（已选 N 条）')
      assert(s.indexOf('至少选择 2 条笔记') >= 0, pair[0] + ' 少于 2 条提示')
      assert(s.indexOf("'合并后标题…'") >= 0 && s.indexOf("(sel[0] && sel[0].topic) || '合并笔记'") >= 0, pair[0] + ' 合并标题输入框（默认=所选最早 topic）')
      assert(s.indexOf('const g = { memberIds: ids }; if (t) g.title = t') >= 0, pair[0] + ' 单组 payload（title 空则不传，禁 undefined）')
      assert(s.indexOf("showToast('已合并所选 ' + ids.length + ' 条', { label: '撤销', fn: doArchiveUndo })") >= 0, pair[0] + ' 合并成功 toast 带撤销')
    }
  })
  await t('归档/多选样式（styles.css + 发布包 lib/styles.css 同步）', () => {
    const cssDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev], ['发布包 lib/styles.css', cssPkg]]) {
      for (const cls of ['.dsh-notes-arch-modal', '.dsh-notes-arch-list{', '.dsh-notes-arch-row{', '.dsh-notes-arch-members{', '.dsh-notes-arch-member', '.dsh-notes-selbar{', '.dsh-notes-selbar-n{', '.dsh-notes-pick-check{', '.dsh-notes-note-row.pick{', '.dsh-notes-toast-act{', '.dsh-notes-toast.has-act{pointer-events:auto}']) {
        assert(pair[1].indexOf(cls) >= 0, pair[0] + ' 缺归档/多选样式：' + cls)
      }
    }
  })
  await t('app.html 同款：归档按钮（引导 title）+ 预览对话框 + 多选合并 + toast 撤销 + Esc', () => {
    assert(appSrc.indexOf('id="btnArchive"') >= 0 && appSrc.indexOf('归档：把同一会话的速记合并成一篇；点按弹出预览，勾选后才执行（可撤销）') >= 0, 'app.html 归档按钮 + 引导 title')
    assert(appSrc.indexOf("rpc('notes-archive-preview', {})") >= 0, 'app.html 预览走 notes-archive-preview')
    assert(appSrc.indexOf('归档预览') >= 0 && appSrc.indexOf('arch-list') >= 0 && appSrc.indexOf('arch-members') >= 0, 'app.html 预览对话框结构（组列表+成员明细）')
    assert(appSrc.indexOf('归档所选（') >= 0 && appSrc.indexOf('手动笔记不受影响；如需合并手动笔记，请在列表多选后右键合并。') >= 0, 'app.html 确认计数 + 手动笔记提示')
    assert(appSrc.indexOf("toast('已合并 ' + (res && res.merged || 0) + ' 组', { label: '撤销', fn: doArchiveUndo })") >= 0, 'app.html 归档 toast 撤销按钮')
    assert(appSrc.indexOf("rpc('notes-archive-undo', {})") >= 0 && appSrc.indexOf('已撤销归档') >= 0, 'app.html undo RPC + toast「已撤销归档」')
    assert(appSrc.indexOf('id="btnSelMode"') >= 0 && appSrc.indexOf('id="selbar"') >= 0 && appSrc.indexOf('pick-check') >= 0, 'app.html 多选：选择 chip + 操作条 + 行复选框')
    assert(appSrc.indexOf('var g = { memberIds: ids }; if (t) g.title = t;') >= 0, 'app.html 多选合并 payload（禁 undefined）')
    assert(appSrc.indexOf("toast('已合并所选 ' + ids.length + ' 条', { label: '撤销', fn: doArchiveUndo })") >= 0, 'app.html 多选合并 toast 撤销')
    assert(appSrc.indexOf('if (selMode) { selMode = false; selIds = {}; renderTree(); return }') >= 0, 'app.html Esc 退出多选态')
    assert(appSrc.indexOf('.selbar{') >= 0 && appSrc.indexOf('.arch-list{') >= 0, 'app.html selbar/arch 样式')
  })
  await t('原型 notes-ui-v2.html 硬性同步：归档按钮 tooltip + 预览对话框 + 多选操作条 + mock 归档 RPC', () => {
    assert(protoV2Src.indexOf('id="btnArchive"') >= 0 && protoV2Src.indexOf('归档：把同一会话的速记合并成一篇；点按弹出预览，勾选后才执行（可撤销）') >= 0, '原型归档按钮 tooltip 引导文案同步')
    assert(protoV2Src.indexOf('归档预览') >= 0 && protoV2Src.indexOf('arch-list') >= 0 && protoV2Src.indexOf('归档所选（') >= 0, '原型归档预览对话框示意同步')
    assert(protoV2Src.indexOf('id="btnSelMode"') >= 0 && protoV2Src.indexOf('id="selbar"') >= 0 && protoV2Src.indexOf('selbarN') >= 0, '原型多选合并操作条示意同步')
    for (const m of ['notes-archive-preview', 'notes-archive-undo']) assert(protoV2Src.indexOf("method === '" + m + "'") >= 0, '原型 mock 含 ' + m)
    assert(protoV2Src.indexOf('_mockArchUndo') >= 0, '原型 mock undo 事务（只保留最近一次）')
    // 原型与 app.html 的归档/多选 UI 标记双端一致（共享 CSS 选择器与 DOM id）
    for (const k of ['arch-row', 'arch-check', 'arch-member', 'pick-check', 'selbar', 'btnArchive', 'btnSelMode', 'mergeTitle']) {
      assert(protoV2Src.indexOf(k) >= 0 && appSrc.indexOf(k) >= 0, '归档/多选 UI 标记双端一致：' + k)
    }
  })
  await t('多选操作条批量删除（软删进回收站，三端同步）', () => {
    // React 两端：开发版面板 + 发布包 lib/client.js（build-dist 产物，host.call → rpc 机械转换）
    for (const pair of [['client-impl', clientSrc, "host.call('notes-delete', { id: id })"], ['发布包 lib/client.js', clientPkgSrc, "rpc('notes-delete', { id: id })"]]) {
      const s = pair[1]
      assert(s.indexOf('async function doSelBatchDelete()') >= 0, pair[0] + ' 多选批量删除函数存在')
      assert(s.indexOf("window.confirm('批量删除：所选的 ' + ids.length + ' 条笔记将移入回收站（可在回收站恢复）。\\n确认删除？')") >= 0, pair[0] + ' confirm 文案注明移入回收站可恢复')
      assert(s.indexOf(pair[2]) >= 0, pair[0] + ' 逐条 notes-delete（软删 payload，与整理建议器批量软删同通道）')
      assert(s.indexOf("className: 'dsh-notes-data-danger'") >= 0 && s.indexOf("selDelPending ? '删除中…' : '删除'") >= 0, pair[0] + ' 操作条删除按钮（danger 实心 + 执行中防重入）')
      assert(s.indexOf('disabled: Object.keys(selIds).length < 1 || selDelPending') >= 0, pair[0] + ' 0 条勾选禁用删除按钮（与合并按钮互斥校验一致）')
      assert(s.indexOf("showToast('已删除 ' + ok + ' 条（可在回收站恢复）'") >= 0, pair[0] + ' toast 文案（已删除 N 条 + 可恢复提示）')
      assert(s.indexOf('setSelDelPending(false); setSelMode(false); setSelIds({})') >= 0, pair[0] + ' 删后退出多选态')
      assert(s.indexOf('afterArchiveCleanup(ids)') >= 0, pair[0] + ' 删后收尾：正打开笔记退出选中态（归档/建议器同款语义）')
    }
    // DOM 两端：app.html + 原型 notes-ui-v2.html（同款 DOM/脚本）
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1]
      assert(s.indexOf('<button class="mbtn danger" id="selDelete">删除</button>') >= 0, pair[0] + ' 操作条删除按钮（danger）')
      assert(s.indexOf("$('selDelete').disabled = n < 1;") >= 0, pair[0] + ' 0 条勾选禁用删除按钮（renderSelBar 联动）')
      assert(s.indexOf('function doSelBatchDelete()') >= 0, pair[0] + ' 多选批量删除函数存在')
      assert(s.indexOf("confirm('批量删除：所选的 ' + ids.length + ' 条笔记将移入回收站（可在回收站恢复）。\\n确认删除？')") >= 0, pair[0] + ' confirm 文案注明移入回收站可恢复')
      assert(s.indexOf("rpc('notes-delete', { id: id })") >= 0, pair[0] + ' 逐条 notes-delete（软删 payload，与整理建议器批量软删同通道）')
      assert(s.indexOf("toast('已删除 ' + ok + ' 条（可在回收站恢复）'") >= 0, pair[0] + ' toast 文案（已删除 N 条 + 可恢复提示）')
      assert(s.indexOf("$('selDelete').addEventListener('click', doSelBatchDelete)") >= 0, pair[0] + ' 删除按钮事件绑定')
      assert(s.indexOf('selMode = false; selIds = {};') >= 0 && s.indexOf('afterArchiveRefresh()') >= 0, pair[0] + ' 删后退出多选态 + 刷新（打开笔记回空态收尾）')
    }
  })
  Object.assign(S, { protoV2Src })
  }
}
