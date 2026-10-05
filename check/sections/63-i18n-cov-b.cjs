// 节 63. i18n 覆盖卡 B（notes-042-i18n-cov-b：编辑器 + meta 双语化）
// 规格源：反馈条目 n-mut488gske5v 覆盖卡统一方法（免调研模板）——grep 表面 [一-鿿] → 抽串进 zh.js（key=表面.语义）
//   → 内联改 t()（变量 {name} 插值禁拼接）→ en.js 直译 → 断言（t( 命中≥抽串、字典双向覆盖、产物英文态抽查）。
// 表面：app panels/editor.js + panels/editor-meta.js + client panels/panel/editor.js（hook 挂 tt=useT() 订阅 langStore 自渲染）；
//   增补（主窗口交接）：head.html 2 处编辑器 CSS content 占位串（.ed-title:empty / .rich:empty）+ styles.css .dsh-notes-rich:empty
//   ——静态 zh 缺省保留（var() 回退值），运行时 renderChrome()（app）/ useEffect [tt]（client）写 CSS 变量重写；
//   key 与 A 卡字典对齐复用（tree.untitled/tree.roleConvention/tree.roleReference/common.delete/common.saveFailed），不重复建。
// 红线：原型 design/notes-ui-v2.html 不双语（零 t(' 引用）；host error 文案不动；回退永不裸 key（60 节机制断言）；
//   逻辑哨兵值不翻译（view id '未分类' / topic 哨兵 '分类中' / syncFromRich 内部 reason 标记 / ^定时 前缀匹配键）。
module.exports = {
  id: "63",
  title: "63. i18n 覆盖B（编辑器 + meta 双语化）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('63. i18n 覆盖B（编辑器 + meta 双语化）')
  const zhSrc = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8')
  const enSrc = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'en.js'), 'utf8')
  const edAppSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'panels', 'editor.js'), 'utf8')
  const metaAppSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'panels', 'editor-meta.js'), 'utf8')
  const topSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'panels', 'topbar.js'), 'utf8')
  const headSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'shell', 'head.html'), 'utf8')
  const stylesSrc = fsNative.readFileSync(path.join(DIR, 'src', 'styles.css'), 'utf8')
  const edCliSrc = fsNative.readFileSync(path.join(DIR, 'src', 'client', 'panels', 'panel', 'editor.js'), 'utf8')
  const appSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
  const clientPkgSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
  const stylesPkgSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
  const protoSrc = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
  // 覆盖卡 B 抽串清单（171 条 = editor.* 52 + meta.* 118 + common.listSep 1；key=表面.语义；
  // 0.4.3⑦：meta.crumbFolderTip → meta.crumbFolderExpandTip（文件视图拆除，面包屑改树内展开）+ meta.logNoInject/logNoInjectTip 新增（注入硬关 UI 化）；
  // 0.4.3 验收修复⑪：meta.recall/recallTip/recallTipNote/recallOn/recallOff 五键退役（「目录可见」chip 拆除，notes-043-mount-ux-final））
  const KEYS = [
    'editor.richDegradedReasons', 'editor.loadFailed', 'editor.loadFailedData', 'editor.loadFailedLocked',
    'editor.autoSaved', 'editor.autoSavedFlat', 'editor.emptyTitle', 'editor.emptySub',
    'editor.emptyTitleShort', 'editor.emptySubShort', 'editor.degBanner', 'editor.degBannerPre',
    'editor.degBannerB', 'editor.degBannerPost', 'editor.degBanner2', 'editor.loadLockNote',
    'editor.retry', 'editor.bodyPlaceholder', 'editor.richPlaceholder', 'editor.tbBold',
    'editor.tbItalic', 'editor.tbCode', 'editor.tbLink', 'editor.tbUl',
    'editor.tbOl', 'editor.tbQuote', 'editor.tbImage', 'editor.syncing',
    'editor.synced', 'editor.modeSource', 'editor.modeRich', 'editor.imageOnly',
    'editor.tableReadonly', 'editor.richRestored', 'editor.richDisabled', 'editor.degReasonItem',
    'editor.selectCodeFirst', 'editor.selectLinkFirst', 'editor.selectNoteFirst', 'editor.bodyLoading',
    'editor.bodyEmpty', 'editor.organizeFailed', 'editor.organizeEmpty', 'editor.organized',
    'editor.noOrganizeUndo', 'editor.organizeUndone', 'editor.charCount', 'editor.backlinks',
    'editor.backlinksCount', 'editor.backlinksWarming', 'editor.backlinkJumpTip', 'editor.backlinksEmpty',
    'meta.crumbFolderExpandTip', 'meta.crumbTopicTip', 'meta.crumbTopicViewTip', 'meta.uncategorized',
    'meta.unsavedDraft', 'meta.filteredByTopic', 'meta.noTopic', 'meta.kindTip',
    'meta.kindTipFull', 'meta.kindNote', 'meta.kindDecision', 'meta.kindTodo',
    'meta.kindLink', 'meta.kindQuote', 'meta.kindLog', 'meta.statusTip',
    'meta.topicTip', 'meta.topicTipClient', 'meta.topicPlaceholder', 'meta.topicFilterTip',
    'meta.tagsTip', 'meta.tagsTipClient', 'meta.tagsPlaceholder', 'meta.folderTip',
    'meta.useCountTip', 'meta.useCount', 'meta.dispPendingTip', 'meta.dispDoneTip',
    'meta.dispPending', 'meta.dispDone', 'meta.roleOffTip', 'meta.roleOff',
    'meta.logNoInject', 'meta.logNoInjectTip',
    'meta.roleConventionTip', 'meta.roleReferenceTip', 'meta.scopeTip', 'meta.scopeAll',
    'meta.scopeSession', 'meta.scopeHint', 'meta.scopePending', 'meta.wsOther',
    'meta.sensTip',
    'meta.sens', 'meta.injectEverTip', 'meta.injectEver', 'meta.srcModeTip',
    'meta.src', 'meta.richModeTip', 'meta.richModeTipClient', 'meta.rich',
    'meta.richDegradedShort', 'meta.modeAria', 'meta.organizingTip', 'meta.organizeTip',
    'meta.organizing', 'meta.organize', 'meta.dispatchTip', 'meta.dispatchTipClient',
    'meta.dispatch', 'meta.sourceTip', 'meta.sourceJumpTip', 'meta.source',
    'meta.histTip', 'meta.history', 'meta.unpin', 'meta.pin',
    'meta.delTip', 'meta.delTipClient', 'meta.injectOff', 'meta.injectOn',
    'meta.sensOn', 'meta.sensOff',
    'meta.sourceToast', 'meta.pinnedToast', 'meta.unpinnedToast', 'meta.runLogNotFound',
    'meta.schedPlan', 'meta.schedPaused', 'meta.runLogTip', 'meta.runLog',
    'meta.schedEditTip', 'meta.edit', 'meta.schedResumeTip', 'meta.schedPauseTip',
    'meta.resume', 'meta.pause', 'meta.schedDelTip', 'meta.schedPeerTip',
    'meta.schedPeer', 'meta.schedPeerNotFound', 'meta.dispHistory', 'meta.dispStDone',
    'meta.dispStPending', 'meta.dispNew', 'meta.dispExisting', 'meta.dispInstruction',
    'meta.dispMarkDone', 'meta.dispMarkedDone', 'meta.opFailed', 'meta.createdAt',
    'meta.draftHint', 'meta.updatedAt', 'meta.sourceSession', 'meta.sourcePage',
    'meta.refreshFailed', 'meta.draftDiscarded', 'meta.deleted', 'meta.undo',
    'meta.restored', 'meta.restoreFailed', 'meta.deleteFailed', 'meta.schedFailed',
    'meta.schedReceiptTip', 'meta.schedSent', 'meta.schedNever', 'meta.schedFired',
    'meta.schedNext',
    'common.listSep',
  ]
  const grab = (s, v) => new Function(s + '\nreturn ' + v)()
  const zh = grab(zhSrc, 'I18N_ZH'), en = grab(enSrc, 'I18N_EN')

  // ===== ① 字典双向覆盖：171 条 editor/meta/common.listSep key 双端齐备且非空；两字典全域 key 集合一致；占位符双端同形 =====
  await t('覆盖B 字典双向覆盖：171 条 editor/meta key 双端齐备且非空 + 全域 key 集合一致 + 占位符同形', () => {
    assert.strictEqual(KEYS.length, 171, '抽串清单条数（实得 ' + KEYS.length + '）')
    for (const k of KEYS) {
      assert(typeof zh[k] === 'string' && zh[k], 'zh 缺 key/空值：' + k)
      assert(typeof en[k] === 'string' && en[k], 'en 缺 key/空值：' + k)
      const pz = (zh[k].match(/\{\w+\}/g) || []).sort().join(','), pe = (en[k].match(/\{\w+\}/g) || []).sort().join(',')
      assert(pz === pe, k + ' 双端占位符同形（zh:' + pz + ' / en:' + pe + '）')
    }
    assert.deepStrictEqual(Object.keys(en).sort(), Object.keys(zh).sort(), 'en/zh 全域 key 集合一致（守卫卡另有 ⊆ 代码引用断言）')
    // key 复用纪律（与 A 卡字典对齐不重复建）：无 editor.untitled / meta.roleConvention 等重复键
    for (const dup of ['editor.untitled', 'meta.untitled', 'meta.roleConvention', 'meta.roleReference', 'editor.delete', 'meta.delete'])
      assert(!(dup in zh) && !(dup in en), '复用 A 卡既有 key，禁重复建：' + dup)
  })

  // ===== ② t() 改写命中：四表面文件 t(/tt( 命中数阈值 + 逐文件关键锚点 =====
  await t('t() 改写命中：四表面文件域内 t(/tt( 合计 ≥170（≥抽串数）+ 逐文件关键锚点', () => {
    const cnt = (s) => (s.match(/[^\w]t{1,2}\('(?:editor|meta|common|tree)\./g) || []).length
    const per = [['editor.js(app)', edAppSrc, 48], ['editor-meta.js', metaAppSrc, 96], ['editor.js(client)', edCliSrc, 153]]
    let total = cnt(topSrc)
    for (const [label, s, min] of per) { const c = cnt(s); total += c; assert(c >= min, label + ' 域内 t(/tt( 命中 ≥' + min + '（实得 ' + c + '）') }
    assert(total >= 170, '四文件域内 t(/tt( 命中合计 ≥170 抽串数（实得 ' + total + '）')
    // 关键锚点：app 编辑器空态/占位/工具栏/降级横幅走字典；injectScopeLabel 形参改名 tg 消遮蔽
    assert(edAppSrc.indexOf("t('editor.emptyTitle')") >= 0 && edAppSrc.indexOf("t('editor.bodyPlaceholder')") >= 0, 'editor.js(app) 空态/正文占位走 t()')
    assert(edAppSrc.indexOf("t('editor.tbBold')") >= 0 && edAppSrc.indexOf("t('editor.richDegradedReasons'") >= 0, 'editor.js(app) 工具栏/降级提示走 t()')
    assert(edAppSrc.indexOf("return t('meta.scopeAll')") >= 0 && edAppSrc.indexOf('arr.map(function (tg)') >= 0, 'injectScopeLabel 走 t()（形参 tg 消遮蔽）')
    // editor-meta.js：面包屑/注入三态/计划块/派发历史/底栏走字典
    assert(metaAppSrc.indexOf("t('meta.crumbFolderExpandTip'") >= 0 && metaAppSrc.indexOf("t('meta.roleOffTip')") >= 0, 'editor-meta.js 面包屑/注入三态走 t()（0.4.3⑦ 面包屑 crumbFolderExpandTip）')
    assert(metaAppSrc.indexOf("t('meta.schedPlan')") >= 0 && metaAppSrc.indexOf("t('meta.dispHistory'") >= 0, 'editor-meta.js 计划块/派发历史走 t()')
    assert(metaAppSrc.indexOf("t('meta.createdAt'") >= 0 && metaAppSrc.indexOf("t('meta.deleted')") >= 0, 'editor-meta.js 底栏/删除链路走 t()')
    // client editor.js：hook 挂 tt=useT()（唯一），渲染区/命令式 toast 全走 tt()
    assert((edCliSrc.match(/const tt = useT\(\)/g) || []).length === 1, 'client editor.js 挂 tt=useT()（唯一，订阅 langStore 自渲染）')
    assert(edCliSrc.indexOf("tt('meta.schedPlan')") >= 0 && edCliSrc.indexOf("tt('editor.backlinks')") >= 0, 'editor.js(client) 计划块/反向链接走 tt()')
    assert(edCliSrc.indexOf("tt('meta.kindNote')") >= 0 && edCliSrc.indexOf("placeholder: tt('tree.untitled')") >= 0, 'editor.js(client) kind 选项/标题占位走 tt()')
    // CSS content 占位串运行时重写接线（静态缺省+运行时重写模式）
    assert(topSrc.indexOf("setProperty('--i18n-ed-title-ph'") >= 0 && topSrc.indexOf("setProperty('--i18n-ed-rich-ph'") >= 0, 'renderChrome 写编辑器 CSS 变量（app）')
    assert(edCliSrc.indexOf("setProperty('--dsh-notes-rich-ph'") >= 0 && edCliSrc.indexOf("tt('editor.richPlaceholder')") >= 0, 'useEffect 写 rich 空态 CSS 变量（client）')
  })

  // ===== ③ 行为级：eval 字典 + app i18n 块——取值/插值/en 态逐条非裸 key/回退 =====
  await t('行为级：覆盖B key 双语取值 + {name} 插值 + en 态 171 条逐条非裸 key', () => {
    const helpersSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'kernel', 'helpers.js'), 'utf8')
    const i18nBlock = helpersSrc.match(/\/\* ==== i18n-mech BEGIN ====[\s\S]*?\/\* ==== i18n-mech END ==== \*\//)[0]
    const mk = (stored) => new Function('localStorage', 'render', zhSrc + '\n' + enSrc + '\n' + i18nBlock + '\nreturn { t: t }')({ getItem: () => stored, setItem: () => {} }, () => {})
    const a = mk(null)
    assert.strictEqual(a.t('meta.dispatch'), '派发', 'zh 缺省取值')
    assert.strictEqual(a.t('meta.dispPending', { open: 1, total: 2 }), '派发中 1/2', 'zh {open}/{total} 插值')
    assert.strictEqual(a.t('editor.degReasonItem', { label: '嵌套引用', line: 3, sample: '>>' }), '嵌套引用（第 3 行：>>）', 'zh 三参插值')
    assert.strictEqual(a.t('editor.richDegradedReasons', { reasons: 'a、b' }), '含高级语法（a、b），请在源码模式编辑', 'zh {reasons} 插值')
    assert.strictEqual(a.t('meta.injectOn', { role: '资料' }), '已注入为上下文 · 资料（范围见右侧下拉）', 'zh {role} 插值')
    const b = mk('en')
    assert.strictEqual(b.t('meta.dispatch'), 'Dispatch', 'en 取值')
    assert.strictEqual(b.t('meta.dispPending', { open: 1, total: 2 }), 'Dispatching 1/2', 'en {open}/{total} 插值')
    assert.strictEqual(b.t('editor.charCount', { n: 5 }), '5 chars', 'en 计数插值')
    assert.strictEqual(b.t('meta.sourceSession', { short: 'ab12cd' }), 'Source session ab12cd', 'en {short} 插值')
    assert.strictEqual(b.t('editor.emptyTitle'), 'Select a note on the left to view and edit', 'en 空态文案')
    assert.strictEqual(b.t('tree.untitled'), 'Untitled', '复用 A 卡 key（editor 标题占位不重复建）')
    for (const k of KEYS) assert(b.t(k) !== k, 'en 态不得裸 key：' + k)
  })

  // ===== ④ 产物英文态抽查 + 静态缺省保留 + 原型不双语红线 =====
  await t('产物英文态抽查：app.html/lib-client 含 en 关键串 + head.html/styles.css 静态 zh 缺省保留 + 原型零引用', () => {
    for (const [s, tag] of [[appSrc, 'app.html'], [clientPkgSrc, '发布包 lib/client.js']]) {
      assert(s.indexOf("'meta.dispatch': 'Dispatch'") >= 0, tag + ' en 关键串 meta.dispatch')
      assert(s.indexOf("'editor.retry': 'Retry'") >= 0, tag + ' en 关键串 editor.retry')
      assert(s.indexOf("'editor.richPlaceholder': 'Body… (rich text; syncs to source on blur)'") >= 0, tag + ' en 关键串 editor.richPlaceholder')
      assert(s.indexOf("'meta.schedNext': 'Next {time}'") >= 0, tag + ' en 关键串 meta.schedNext')
    }
    assert(appSrc.indexOf("t('meta.schedPlan')") >= 0 && appSrc.indexOf("setProperty('--i18n-ed-title-ph'") >= 0, 'app.html 产物含 meta t() + renderChrome CSS 变量接线（需先跑 concat-app/build-dist）')
    assert(clientSrc.indexOf("tt('meta.schedPlan')") >= 0 && clientPkgSrc.indexOf("tt('meta.schedPlan')") >= 0, 'client 开发版/发布包含 editor tt()（需先跑 build-dist）')
    assert(clientSrc.indexOf("'--dsh-notes-rich-ph'") >= 0 && clientPkgSrc.indexOf("'--dsh-notes-rich-ph'") >= 0, 'client 开发版/发布包含 rich 空态 CSS 变量接线')
    // 静态 zh 缺省保留（var() 回退值）：head.html 双占位 + styles.css rich 占位（开发版 + 发布包）
    assert(headSrc.indexOf('content:var(--i18n-ed-title-ph,"无标题")') >= 0, 'head.html 标题占位静态 zh 缺省保留')
    assert(headSrc.indexOf('content:var(--i18n-ed-rich-ph,"正文…（富文本，编辑后失焦自动同步源码）")') >= 0, 'head.html rich 占位静态 zh 缺省保留')
    assert(stylesSrc.indexOf('content:var(--dsh-notes-rich-ph,"正文…（富文本，编辑后失焦自动同步源码）")') >= 0, 'styles.css rich 占位静态 zh 缺省保留')
    assert(stylesPkgSrc.indexOf('content:var(--dsh-notes-rich-ph,"正文…（富文本，编辑后失焦自动同步源码）")') >= 0, '发布包 lib/styles.css rich 占位同步（需先跑 build-dist）')
    // 原型不双语红线：零 t() 字典引用 + 零 CSS 变量接线
    assert(protoSrc.indexOf("t('editor.") < 0 && protoSrc.indexOf("t('meta.") < 0 && protoSrc.indexOf('--i18n-ed-') < 0, '原型不双语红线：零 t() 字典引用/CSS 变量')
  })
  }
}
