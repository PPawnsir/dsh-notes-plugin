// 节 66. i18n 覆盖卡 E（notes-042-i18n-cov-e：弹窗族双语化）
// 规格源：反馈条目 n-mut488gske5v 覆盖卡统一方法（免调研模板）——grep 表面 [一-鿿] → 抽串进 zh.js（key=表面.语义）
//   → 内联改 t()/tt()（变量 {name} 插值禁拼接）→ en.js 直译 → 断言（t( 命中≥抽串、字典双向覆盖、产物英文态抽查）。
// 表面：app modals/{dispatch,archive,trash,suggest,newnote,cheatsheet,folder-input}.js（全局 t() 直读 NOTES_LANG）
//   + client modals/{dispatch,archive,trash,suggest,newnote,cheatsheet}.js（各 Modal 挂 tt=useT() 订阅 langStore 自渲染；模块级 handler 走 t() 直读）
//   + client kernel/format.js schedFormDecl 校验串（主窗口增补交接：disp.sched* 系；app 侧 schedFormDecl 在 modals/dispatch.js 本地）。
// key 复用纪律（禁重复建别名）：editor.selectNoteFirst/autoSaved、mem.sessLoadFailed、common.loading/cancel/close/schedDaily/schedWeekly/dowNames、
//   meta.wsOther/scopePending/uncategorized/undo/restored/restoreFailed/deleteFailed、tree.untitled、inj.loadFailed/selectAll/batchDoneFail、
//   sel.selCount/merge、settings.saving/suggest/cheatsheet、topbar.trash、meta.kindNote~kindLog（client 新建弹窗类型下拉动态拼 key）。
// 数据层保留中文不抽串（跨语言匹配/check 锁定）：调度约定标题前缀「定时 」（schedPeerKey 前缀正则，50/52 节锚定）、
//   正文「补充指令：」标记（50 节断言锚定原文）、派发兜底会话名「新会话」（写入 dispatches 元数据）。
// 红线：原型 design/notes-ui-v2.html 不双语（零 disp/arch/trash/sugg/newnote/cheat/fld 域 t() 引用）；host error 文案不动；回退永不裸 key（60 节机制断言）。
// 旧节适配（断言名不动）：50.2/50.4 调度区文案 → t() 形态（app/原型分侧）；51 速查表行 key 化 + openCheatsheet 逐字节断言升级 zh 态渲染产物一致；
//   55 弹层 eval 桩补 t（真 zh 字典）；26/28/30/33/47 文案断言 → t()/tt() 形态 + zh 原串字典内嵌锚点；1-8 新建 modal placeholder/toast → tt()/t() 形态。
module.exports = {
  id: "66",
  title: "66. i18n 覆盖E（弹窗族双语化：dispatch/archive/trash/suggest/newnote/cheatsheet/folder-input + schedFormDecl 校验串）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('66. i18n 覆盖E（弹窗族双语化：dispatch/archive/trash/suggest/newnote/cheatsheet/folder-input + schedFormDecl 校验串）')
  const zhSrc = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8')
  const enSrc = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'en.js'), 'utf8')
  const rdA = (f) => fsNative.readFileSync(path.join(DIR, 'src', 'app', 'modals', f), 'utf8')
  const rdC = (f) => fsNative.readFileSync(path.join(DIR, 'src', 'client', 'modals', f), 'utf8')
  const dispAppSrc = rdA('dispatch.js'), archAppSrc = rdA('archive.js'), trashAppSrc = rdA('trash.js'),
    suggAppSrc = rdA('suggest.js'), newnoteAppSrc = rdA('newnote.js'), cheatAppSrc = rdA('cheatsheet.js'), fldAppSrc = rdA('folder-input.js')
  const dispCliSrc = rdC('dispatch.js'), archCliSrc = rdC('archive.js'), trashCliSrc = rdC('trash.js'),
    suggCliSrc = rdC('suggest.js'), newnoteCliSrc = rdC('newnote.js'), cheatCliSrc = rdC('cheatsheet.js')
  const formatSrc = fsNative.readFileSync(path.join(DIR, 'src', 'client', 'kernel', 'format.js'), 'utf8')
  const appSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
  const clientPkgSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
  const protoSrc = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
  // 覆盖卡 E 抽串清单（151 条 = disp.* 50 + arch.* 26 + common.restoredBatch 1 + trash.* 18 + sugg.* 26 + newnote.* 12 + cheat.* 12 + fld.* 6；key=表面.语义）
  const KEYS = [
    'disp.title', 'disp.editTitle', 'disp.sub', 'disp.editSub', 'disp.subCounts',
    'disp.draftNotSaved', 'disp.noSchedule', 'disp.noBody', 'disp.instrPlaceholder', 'disp.now',
    'disp.scheduled', 'disp.modeNDays', 'disp.modeOnce', 'disp.ndaysUnit', 'disp.dowOption',
    'disp.ok', 'disp.saveSched', 'disp.savingSched', 'disp.dispatching', 'disp.needSession',
    'disp.needWorkspace', 'disp.noWsService', 'disp.sessSummary', 'disp.sessPending', 'disp.noSessions',
    'disp.notLive', 'disp.notLiveSuffix', 'disp.orphanSessName', 'disp.orphanSessWs', 'disp.nextTrigger',
    'disp.schedNeedAt', 'disp.schedAtFuture', 'disp.schedNeedAnchor', 'disp.schedNInvalid', 'disp.schedDone',
    'disp.schedUpdated', 'disp.schedFailed', 'disp.needOpenHint', 'disp.dispatched', 'disp.dispatchedOpened',
    'disp.newSessDone', 'disp.failed', 'disp.markedDone', 'disp.pickWs', 'disp.pickSess',
    'disp.noSessInWs', 'disp.pickWsFirst', 'disp.pickWsNew', 'disp.modeExisting', 'disp.modeNew',
    'arch.title', 'arch.sub', 'arch.hint', 'arch.hintClient', 'arch.manualHint',
    'arch.empty', 'arch.ok', 'arch.okCount', 'arch.archiving', 'arch.groupMeta',
    'arch.groupUseCount', 'arch.merged', 'arch.failed', 'arch.previewFailed', 'arch.undone',
    'arch.noUndo', 'arch.undoFailed', 'arch.needTwo', 'arch.mergeTitle', 'arch.mergeHint',
    'arch.mergeDefault', 'arch.mergePlaceholder', 'arch.merging', 'arch.mergeFailed', 'arch.mergedSel',
    'arch.deletedBatch',
    'common.restoredBatch',
    'trash.sub', 'trash.empty', 'trash.restoreSel', 'trash.purgeSel', 'trash.titleTip',
    'trash.deletedAt', 'trash.preview', 'trash.collapse', 'trash.restore', 'trash.purge',
    'trash.previewLoading', 'trash.previewFailed', 'trash.noBody', 'trash.purged', 'trash.purgeConfirm',
    'trash.restoreBatchConfirm', 'trash.purgeBatchConfirm', 'trash.purgedBatch',
    'sugg.sub', 'sugg.analyzing', 'sugg.failed', 'sugg.clean', 'sugg.secArch',
    'sugg.countGroups', 'sugg.goArch', 'sugg.secStale', 'sugg.countItems', 'sugg.deleting',
    'sugg.batchDel', 'sugg.staleDays', 'sugg.staleEmpty', 'sugg.secOrphan', 'sugg.view',
    'sugg.orphanEmpty', 'sugg.secLogHg', 'sugg.tierWeekly', 'sugg.tierMonthly', 'sugg.logHgMeta',
    'sugg.detail', 'sugg.sessSeg', 'sugg.logHgEmpty', 'sugg.criteria', 'sugg.criteriaClient',
    'sugg.softDeleted',
    'newnote.draftToast', 'newnote.createdToast', 'newnote.flushedToast', 'newnote.failed', 'newnote.title',
    'newnote.titlePlaceholder', 'newnote.kindLabel', 'newnote.templateHint', 'newnote.freeHint', 'newnote.create',
    'newnote.creating', 'newnote.created',
    'cheat.closeTip', 'cheat.hint', 'cheat.kSearch', 'cheat.kNew', 'cheat.kMode',
    'cheat.kDown', 'cheat.kUp', 'cheat.kOpen', 'cheat.kSearchDown', 'cheat.kSelf',
    'cheat.kEsc', 'cheat.kEscClient',
    'fld.where', 'fld.root', 'fld.namePlaceholder', 'fld.okDefault', 'fld.errEmpty',
    'fld.errDup',
  ]
  const grab = (s, v) => new Function(s + '\nreturn ' + v)()
  const zh = grab(zhSrc, 'I18N_ZH'), en = grab(enSrc, 'I18N_EN')

  // ===== ① 字典双向覆盖：151 条 key 双端齐备且非空；两字典全域 key 集合一致；占位符双端同形 =====
  await t('覆盖E 字典双向覆盖：151 条 disp/arch/trash/sugg/newnote/cheat/fld/common key 双端齐备且非空 + 全域 key 集合一致 + 占位符同形', () => {
    assert.strictEqual(KEYS.length, 151, '抽串清单条数（实得 ' + KEYS.length + '）')
    for (const k of KEYS) {
      assert(typeof zh[k] === 'string' && zh[k], 'zh 缺 key/空值：' + k)
      assert(typeof en[k] === 'string' && en[k], 'en 缺 key/空值：' + k)
      const pz = (zh[k].match(/\{\w+\}/g) || []).sort().join(','), pe = (en[k].match(/\{\w+\}/g) || []).sort().join(',')
      assert(pz === pe, k + ' 双端占位符同形（zh:' + pz + ' / en:' + pe + '）')
    }
    assert.deepStrictEqual(Object.keys(en).sort(), Object.keys(zh).sort(), 'en/zh 全域 key 集合一致')
    // key 复用纪律（与机制卡/A/B/C/D 卡既有 key 对齐，禁重复建别名）
    for (const dup of ['disp.cancel', 'disp.close', 'disp.loading', 'disp.selectNote', 'disp.sessLoadFailed', 'disp.schedDaily', 'disp.schedWeekly',
      'arch.cancel', 'arch.loading', 'arch.undo', 'arch.untitled', 'trash.title', 'trash.close', 'trash.loading', 'trash.restored', 'trash.undo', 'trash.selAll',
      'sugg.title', 'sugg.close', 'sugg.uncategorized', 'sugg.collapse', 'newnote.cancel', 'newnote.autoSaved', 'cheat.title', 'fld.cancel']) {
      assert(!(dup in zh) && !(dup in en), '复用 common.*/meta.*/settings.*/sel.*/inj.*/editor.*/topbar.* 既有 key，禁重复建别名：' + dup)
    }
  })

  // ===== ② t()/tt() 改写命中：14 表面文件域内命中数阈值 + 逐文件关键锚点 =====
  await t('t()/tt() 改写命中：弹窗族域内 t(/tt( 合计 ≥333（≥抽串数 151）+ 逐文件关键锚点', () => {
    const cnt = (s) => (s.match(/[^\w]t{1,2}\('(?:disp|arch|trash|sugg|newnote|cheat|fld|common|meta|tree|sel|settings|editor|inj|mem|topbar)\./g) || []).length
    const per = [
      ['dispatch.js(app)', dispAppSrc, 50], ['archive.js(app)', archAppSrc, 41], ['trash.js(app)', trashAppSrc, 31],
      ['suggest.js(app)', suggAppSrc, 41], ['newnote.js(app)', newnoteAppSrc, 5], ['cheatsheet.js(app)', cheatAppSrc, 3],
      ['folder-input.js(app)', fldAppSrc, 7],
      ['dispatch.js(client)', dispCliSrc, 45], ['archive.js(client)', archCliSrc, 16], ['trash.js(client)', trashCliSrc, 28],
      ['suggest.js(client)', suggCliSrc, 39], ['newnote.js(client)', newnoteCliSrc, 10], ['cheatsheet.js(client)', cheatCliSrc, 3],
      ['format.js(client)', formatSrc, 14],
    ]
    let total = 0
    for (const [label, s, min] of per) { const c = cnt(s); total += c; assert(c >= min, label + ' 域内 t(/tt( 命中 ≥' + min + '（实得 ' + c + '）') }
    assert(total >= 333, '14 文件域内 t(/tt( 命中合计 ≥333（实得 ' + total + '）')
    // app 端锚点
    assert(dispAppSrc.indexOf("(editing ? t('disp.editTitle') : t('disp.title'))") >= 0, 'app dispatch 标题双态走 t()')
    assert(dispAppSrc.indexOf("return { err: t('disp.schedAtFuture') }") >= 0 && dispAppSrc.indexOf("return { err: t('disp.schedNInvalid') }") >= 0, 'app schedFormDecl 校验串走 t()（主窗口交接项）')
    assert(dispAppSrc.indexOf("t('disp.dowOption', { dow: t('common.dowNames').split('|')[d] || '' })") >= 0, 'app 星期几选项走 dowNames 管道')
    assert(dispAppSrc.indexOf("t('disp.sessSummary', { n: dState.sessions.length") >= 0 && dispAppSrc.indexOf("t('mem.sessLoadFailed', { msg:") >= 0, 'app dispatch 会话摘要/加载失败走 t()（复用 mem.sessLoadFailed）')
    assert(archAppSrc.indexOf("t('arch.okCount', { n: archCheckedCount() })") >= 0 && archAppSrc.indexOf("toast(t('arch.merged', { n:") >= 0, 'app archive 计数按钮/合并 toast 走 t()')
    assert(trashAppSrc.indexOf("confirm(t('trash.purgeConfirm', { title: title || id }))") >= 0 && trashAppSrc.indexOf("t('sel.selCount', { n: selCnt })") >= 0, 'app trash purge confirm/选中计数走 t()')
    assert(suggAppSrc.indexOf("t('sugg.secArch')") >= 0 && suggAppSrc.indexOf("t('sugg.criteria')") >= 0 && suggAppSrc.indexOf("t('sugg.tierWeekly')") >= 0, 'app suggest 段标题/判定口径/日志卫生档走 t()')
    assert(newnoteAppSrc.indexOf("t('newnote.draftToast')") >= 0 && newnoteAppSrc.indexOf("t('editor.autoSaved', { time:") >= 0, 'app newnote 草稿 toast 走 t()（复用 editor.autoSaved）')
    assert(cheatAppSrc.indexOf("esc(t(r[1]))") >= 0 && cheatAppSrc.indexOf("['Ctrl+K', 'cheat.kSearch']") >= 0, 'app 速查表说明列 key 化 + 渲染期 t()')
    assert(fldAppSrc.indexOf("t('fld.errDup', { name: name })") >= 0 && fldAppSrc.indexOf("t('fld.namePlaceholder')") >= 0, 'app folder-input 校验/占位走 t()')
    // client 端锚点：组件挂 tt=useT()（唯一）订阅自渲染；模块级 handler 走 t()
    for (const [label, s] of [['dispatch', dispCliSrc], ['archive', archCliSrc], ['trash', trashCliSrc], ['suggest', suggCliSrc], ['newnote', newnoteCliSrc], ['cheatsheet', cheatCliSrc]]) {
      assert((s.match(/const tt = useT\(\)/g) || []).length === 1, 'client ' + label + ' Modal 挂 tt=useT()（唯一，订阅 langStore 自渲染）')
    }
    assert(dispCliSrc.indexOf("' ' + tt('disp.now')") >= 0 && dispCliSrc.indexOf("showToast(t('disp.noSchedule'))") >= 0, 'client dispatch 单选 tt() + 命令式 t() 双通道')
    assert(archCliSrc.indexOf("tt('arch.okCount', { n: checkedCount })") >= 0 && archCliSrc.indexOf("showToast(t('arch.merged', { n: res.merged || 0 })") >= 0, 'client archive 计数/toast 走 tt()/t()')
    assert(trashCliSrc.indexOf("window.confirm(t('trash.purgeBatchConfirm', { n: ids.length }))") >= 0 && trashCliSrc.indexOf("tt('trash.collapse')") >= 0, 'client trash 批量 confirm t() + 预览按钮 tt()')
    assert(suggCliSrc.indexOf("tt('sugg.batchDel')") >= 0 && suggCliSrc.indexOf("tt('sugg.criteriaClient')") >= 0, 'client suggest 批量按钮/判定口径走 tt()')
    assert(newnoteCliSrc.indexOf("tt('newnote.title')") >= 0 && newnoteCliSrc.indexOf("tt('meta.kind' + k.charAt(0).toUpperCase() + k.slice(1))") >= 0, 'client newnote 标题走 tt() + 类型下拉复用 meta.kind*（动态 key）')
    assert(cheatCliSrc.indexOf("tt(r[1])") >= 0 && cheatCliSrc.indexOf("['Esc', 'cheat.kEscClient']") >= 0, 'client 速查表说明列 key 化（Esc 面板口径 cheat.kEscClient）')
    // kernel/format.js schedFormDecl 镜像（主窗口交接项）
    assert(formatSrc.indexOf("return { err: t('disp.schedNeedAt') }") >= 0 && formatSrc.indexOf("return { err: t('disp.schedAtFuture') }") >= 0
      && formatSrc.indexOf("return { err: t('disp.schedNeedAnchor') }") >= 0 && formatSrc.indexOf("return { err: t('disp.schedNInvalid') }") >= 0,
      'client kernel/format.js schedFormDecl 四校验串走 t() disp.sched*（与 app modals/dispatch.js 同口径镜像）')
    // 数据层红线：「定时 」标题前缀/「补充指令：」正文标记保留中文原文（schedPeerKey 跨语言匹配 + 50 节断言锚定）
    assert(dispAppSrc.indexOf("'定时 ' + (edNote.title || 'Untitled')") >= 0 && dispAppSrc.indexOf("'\\n\\n补充指令：'") >= 0, 'app 数据层中文保留（定时 前缀 + 补充指令：标记）')
    assert(dispCliSrc.indexOf("'定时 ' + (src.title || 'Untitled')") >= 0 && dispCliSrc.indexOf("'\\n\\n补充指令：'") >= 0, 'client 数据层中文保留（同上）')
  })

  // ===== ③ 行为级：eval 字典 + app i18n 块——取值/插值/en 态逐条非裸 key =====
  await t('行为级：覆盖E key 双语取值 + {name} 插值 + en 态 151 条逐条非裸 key', () => {
    const helpersSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'kernel', 'helpers.js'), 'utf8')
    const i18nBlock = helpersSrc.match(/\/\* ==== i18n-mech BEGIN ====[\s\S]*?\/\* ==== i18n-mech END ==== \*\//)[0]
    const mk = (stored) => new Function('localStorage', 'render', zhSrc + '\n' + enSrc + '\n' + i18nBlock + '\nreturn { t: t }')({ getItem: () => stored, setItem: () => {} }, () => {})
    const a = mk(null)
    assert.strictEqual(a.t('disp.title'), '派发待办', 'zh 派发标题')
    assert.strictEqual(a.t('disp.schedDone', { time: '2026-10-05 09:00' }), '已排定，下次：2026-10-05 09:00', 'zh 排定 toast 插值')
    assert.strictEqual(a.t('disp.sessSummary', { n: 3, pending: '' }), '活跃会话 3 · 按工作区分组', 'zh 会话摘要嵌套片段插值')
    assert.strictEqual(a.t('disp.dowOption', { dow: '一' }), '周一', 'zh 星期几选项')
    assert(a.t('trash.purgeConfirm', { title: '旧笔记' }).indexOf('彻底删除不可恢复：「旧笔记」') === 0, 'zh purge confirm 插值')
    assert.strictEqual(a.t('arch.okCount', { n: 2 }), '归档所选（2 组）', 'zh 归档计数插值')
    assert.strictEqual(a.t('sugg.logHgMeta', { tier: '周聚合', n: 4 }), '周聚合 · 4 条', 'zh 日志卫生行插值')
    assert.strictEqual(a.t('fld.errDup', { name: '工作' }), '同级已存在同名文件夹「工作」', 'zh 重名校验插值')
    const b = mk('en')
    assert.strictEqual(b.t('disp.title'), 'Dispatch todo', 'en 派发标题')
    assert.strictEqual(b.t('disp.schedDone', { time: '2026-10-05 09:00' }), 'Scheduled, next: 2026-10-05 09:00', 'en 排定 toast 插值')
    assert.strictEqual(b.t('disp.dowOption', { dow: 'Mon' }), 'Mon', 'en 星期几选项（无前缀）')
    assert.strictEqual(b.t('arch.okCount', { n: 2 }), 'Archive selected (2 groups)', 'en 归档计数插值')
    assert.strictEqual(b.t('sugg.staleDays', { n: 5 }), 'no update for 5 days', 'en 过期天数插值')
    assert.strictEqual(b.t('fld.errDup', { name: 'work' }), 'A folder named "work" already exists at this level', 'en 重名校验插值')
    assert.strictEqual(b.t('cheat.kSearch'), 'Focus the search box', 'en 速查表行')
    for (const k of KEYS) assert(b.t(k) !== k, 'en 态不得裸 key：' + k)
  })

  // ===== ④ 产物英文态抽查 + 原型不双语红线 =====
  await t('产物英文态抽查：app.html/lib-client 含 en 关键串 + t()/tt() 接线入产物 + 原型零弹窗域引用', () => {
    for (const [s, tag] of [[appSrc, 'app.html'], [clientPkgSrc, '发布包 lib/client.js']]) {
      assert(s.indexOf("'disp.ok': 'Dispatch'") >= 0, tag + ' en 关键串 disp.ok')
      assert(s.indexOf("'disp.schedAtFuture': 'The scheduled time must be in the future") >= 0, tag + ' en 关键串 disp.schedAtFuture（schedFormDecl 校验串）')
      assert(s.indexOf("'trash.purge': 'Purge'") >= 0, tag + ' en 关键串 trash.purge')
      assert(s.indexOf("'sugg.goArch': 'Go archive'") >= 0, tag + ' en 关键串 sugg.goArch')
      assert(s.indexOf("'newnote.create': 'Create'") >= 0, tag + ' en 关键串 newnote.create')
      assert(s.indexOf("'cheat.kSearch': 'Focus the search box'") >= 0, tag + ' en 关键串 cheat.kSearch')
      assert(s.indexOf("'fld.errEmpty': 'Folder name cannot be empty'") >= 0, tag + ' en 关键串 fld.errEmpty')
      assert(s.indexOf("'arch.okCount': 'Archive selected ({n} groups)'") >= 0, tag + ' en 关键串 arch.okCount 插值同形')
    }
    assert(appSrc.indexOf("t('disp.now')") >= 0 && appSrc.indexOf("t('trash.purgeConfirm'") >= 0 && appSrc.indexOf("esc(t(r[1]))") >= 0, 'app.html 产物含 disp/trash/cheat t() 接线（需先跑 concat-app）')
    assert(clientSrc.indexOf("tt('disp.now')") >= 0 && clientPkgSrc.indexOf("tt('disp.now')") >= 0, 'client 开发版/发布包含派发 tt()（需先跑 build-dist）')
    assert(clientSrc.indexOf("t('disp.schedNeedAt')") >= 0 && clientPkgSrc.indexOf("t('disp.schedNInvalid')") >= 0, 'client 开发版/发布包含 schedFormDecl t()（format.js，需先跑 build-dist）')
    // 原型不双语红线：零 disp/arch/trash/sugg/newnote/cheat/fld 域 t() 字典引用
    for (const p of ['disp.', 'arch.', 'trash.', 'sugg.', 'newnote.', 'cheat.', 'fld.']) {
      assert(protoSrc.indexOf("t('" + p) < 0 && protoSrc.indexOf("tt('" + p) < 0, '原型不双语红线：零 ' + p + ' 域 t() 引用')
    }
  })
  }
}
