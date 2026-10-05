// 节 65. i18n 覆盖卡 D（notes-042-i18n-cov-d：注入管理 + 记忆引导双语化）
// 规格源：反馈条目 n-mut488gske5v 覆盖卡统一方法（免调研模板）——grep 表面 [一-鿿] → 抽串进 zh.js（key=inj.*/mem.*）
//   → 内联改 t()/tt()（变量 {name} 插值禁拼接）→ en.js 直译 → 断言（t( 命中≥抽串、字典双向覆盖、产物英文态抽查）。
// 表面：app modals/{inject-manager,memory-guide}.js（全局 t() 直读 NOTES_LANG）
//   + client modals/{inject-manager,memory-guide}.js（InjMgrModal/MemoryGuideModal 挂 tt=useT() 订阅 langStore 自渲染；模块级 handler 走 t() 直读）。
// 主窗口增补（覆盖卡 B 交接）：schedFreqLabel（app kernel/helpers.js ⇄ client kernel/format.js 双镜像）+ schedBadgeHtml/schedNextLabel
//   统一 t() 化——频率人话跨表面复用（注入管理 + 详情计划块）放 common.sched*；徽章/下次触发复用 B 卡 meta.sched* 既有 key 不重复建；
//   星期名经 common.dowNames 管道分隔取值（en 多字符星期名 charAt 不可取，原 '日一二三四五六'.charAt 形态废止）。
// key 复用纪律：settings.injManager（面板标题）/memProbing/memEnabled/memView/memDisable/memEnable、common.loading/close/cancel/delete、
//   tree.untitled/roleConvention/roleReference、sel.selCount、meta.roleOff 系/injectEver 系/sched* 系（B 卡已建）不重复建别名。
// 红线：原型 design/notes-ui-v2.html 不双语（零 t('inj.'/t('mem.'/t('common.sched 引用）；host error 文案不动；
//   回退永不裸 key（60 节机制断言）；逻辑哨兵值不翻译（schedPeerKey 的 ^定时 前缀匹配键等）。
// 旧节适配（断言名不动）：43 节 chips/批量 confirm/作用域摘要代码形态 → t() 形态（app/原型分侧）；39 节 scopeOpt 多选档 → tt() 形态；
//   50.1 节 schedFreqLabel 退出 app⇄原型逐字节一致名单（改行为级三态等价：app zh = 原型原文 / en 英文）；50.3 节徽章文案分侧；
//   56.3 节行为级 eval 前导补 zh 字典 + t() 桩（二级面板真码已走 t()）。
module.exports = {
  id: "65",
  title: "65. i18n 覆盖D（注入管理 + 记忆引导双语化 + schedFreqLabel 跨表面 t() 化）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('65. i18n 覆盖D（注入管理 + 记忆引导双语化 + schedFreqLabel 跨表面 t() 化）')
  const zhSrc = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8')
  const enSrc = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'en.js'), 'utf8')
  const injAppSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'modals', 'inject-manager.js'), 'utf8')
  const memAppSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'modals', 'memory-guide.js'), 'utf8')
  const injCliSrc = fsNative.readFileSync(path.join(DIR, 'src', 'client', 'modals', 'inject-manager.js'), 'utf8')
  const memCliSrc = fsNative.readFileSync(path.join(DIR, 'src', 'client', 'modals', 'memory-guide.js'), 'utf8')
  const helpersSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'kernel', 'helpers.js'), 'utf8')
  const formatSrc = fsNative.readFileSync(path.join(DIR, 'src', 'client', 'kernel', 'format.js'), 'utf8')
  const appSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
  const clientPkgSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
  const protoSrc = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
  // 覆盖卡 D 抽串清单（82 条 = common.sched* 10（跨表面频率人话）+ inj.* 41 + mem.* 31；key=表面.语义；
  // 0.4.3⑦：inj.logSegTip/logRowTip → inj.logNoInject/logNoInjectTip（注入硬关 UI 化，log 行不再渲染开关）；
  // 0.4.3 验收修复⑥：+inj.mntStats/mntStatsTip（注入管理挂载区统计行，notes-043-metrics-present）；
  // 0.4.3 验收修复⑪：+inj.batchRefTip（批量「设为资料」tooltip 注明缺省文案=标题，单行路径改弹框，notes-043-mount-ux-final））
  const KEYS = [
    'common.schedOnce', 'common.schedInvalid', 'common.schedDaily', 'common.schedWeekly', 'common.schedWeeklyDow',
    'common.dowNames', 'common.schedNDays', 'common.schedNHours', 'common.schedNMinutes', 'common.schedNMs',
    'inj.titleSub', 'inj.searchPlaceholder', 'inj.loadFailed', 'inj.chipAll', 'inj.chipConvention',
    'inj.chipReference', 'inj.chipOff', 'inj.noMatch', 'inj.emptyLib', 'inj.selectAll',
    'inj.batchConvention', 'inj.batchReference', 'inj.batchRefTip', 'inj.batchOff', 'inj.executing', 'inj.logNoInject',
    'inj.logNoInjectTip', 'inj.sensTip', 'inj.sensBadge', 'inj.scopeGlobal', 'inj.scopeSessions',
    'inj.schedTitle', 'inj.schedTitleSub', 'inj.schedEmpty', 'inj.schedResumed', 'inj.schedPausedToast',
    'inj.schedDelConfirm', 'inj.schedDeleted', 'inj.forcedOff', 'inj.injectOffToast', 'inj.injectSetToast',
    'inj.setFailed', 'inj.batchLabelSet', 'inj.batchConfirm', 'inj.batchEffOff', 'inj.batchEffRef',
    'inj.batchEffConv', 'inj.batchDone', 'inj.batchDoneFail', 'inj.mntStats', 'inj.mntStatsTip',
    'mem.disabledToast', 'mem.notEnabled', 'mem.disableFailed', 'mem.enableTitle', 'mem.enableSub',
    'mem.enableHint', 'mem.scopeTitle', 'mem.scopeGlobal', 'mem.scopeWsPick', 'mem.scopeSessPick',
    'mem.scopeWsMulti', 'mem.scopeSessMulti', 'mem.scopeGlobalTip', 'mem.scopeWsTip', 'mem.scopeSessTip',
    'mem.confirmEnable', 'mem.enabling', 'mem.wsLabel', 'mem.noWorkspace', 'mem.noSessions',
    'mem.sessNameSeg', 'mem.sessWsSeg', 'mem.sessLoadFailed', 'mem.needWorkspace', 'mem.noSessInWs',
    'mem.noSessInScope', 'mem.needSession', 'mem.alreadyToast', 'mem.revivedToast', 'mem.enabledToast',
    'mem.enableFailed',
  ]
  const grab = (s, v) => new Function(s + '\nreturn ' + v)()
  const zh = grab(zhSrc, 'I18N_ZH'), en = grab(enSrc, 'I18N_EN')

  // ===== ① 字典双向覆盖：82 条 common.sched/inj/mem key 双端齐备且非空；两字典全域 key 集合一致；占位符双端同形 =====
  await t('覆盖D 字典双向覆盖：82 条 common.sched/inj/mem key 双端齐备且非空 + 全域 key 集合一致 + 占位符同形', () => {
    assert.strictEqual(KEYS.length, 82, '抽串清单条数（实得 ' + KEYS.length + '）')
    for (const k of KEYS) {
      assert(typeof zh[k] === 'string' && zh[k], 'zh 缺 key/空值：' + k)
      assert(typeof en[k] === 'string' && en[k], 'en 缺 key/空值：' + k)
      const pz = (zh[k].match(/\{\w+\}/g) || []).sort().join(','), pe = (en[k].match(/\{\w+\}/g) || []).sort().join(',')
      assert(pz === pe, k + ' 双端占位符同形（zh:' + pz + ' / en:' + pe + '）')
    }
    assert.deepStrictEqual(Object.keys(en).sort(), Object.keys(zh).sort(), 'en/zh 全域 key 集合一致')
    // key 复用纪律（与机制卡/A/B/C 卡既有 key 对齐，禁重复建别名）
    for (const dup of ['inj.title', 'inj.close', 'inj.loading', 'inj.delete', 'inj.edit', 'inj.schedPaused', 'inj.schedSent', 'inj.untitled', 'mem.title', 'mem.view', 'mem.cancel', 'mem.probing', 'mem.enable', 'mem.scopeOff']) {
      assert(!(dup in zh) && !(dup in en), '复用 settings.mem*/common.*/meta.sched* 既有 key，禁重复建别名：' + dup)
    }
  })

  // ===== ② t()/tt() 改写命中：六表面文件域内命中数阈值 + 逐文件关键锚点 =====
  await t('t()/tt() 改写命中：六表面文件域内 t(/tt( 合计 ≥200（≥抽串数 82）+ 逐文件关键锚点', () => {
    const cnt = (s) => (s.match(/[^\w]t{1,2}\('(?:inj|mem|common|meta|tree|sel|settings)\./g) || []).length
    const per = [['inject-manager.js(app)', injAppSrc, 60], ['memory-guide.js(app)', memAppSrc, 28], ['inject-manager.js(client)', injCliSrc, 60], ['memory-guide.js(client)', memCliSrc, 24], ['helpers.js(app)', helpersSrc, 9], ['format.js(client)', formatSrc, 9]]
    let total = 0
    for (const [label, s, min] of per) { const c = cnt(s); total += c; assert(c >= min, label + ' 域内 t(/tt( 命中 ≥' + min + '（实得 ' + c + '）') }
    assert(total >= 200, '六文件域内 t(/tt( 命中合计 ≥200（实得 ' + total + '）')
    // app inject-manager.js 锚点：标题复用 settings.injManager / chips / 行内三态复用 meta.role* / 徽章复用 meta.sched* / 批量 confirm 插值
    assert(injAppSrc.indexOf("t('settings.injManager')") >= 0 && injAppSrc.indexOf("t('inj.titleSub')") >= 0, 'app inject-manager 标题/副标走 t()（标题复用 settings.injManager）')
    assert(injAppSrc.indexOf("['convention', t('inj.chipConvention', { n: cntConv })]") >= 0, 'app 统计 chips 走 t() 插值')
    assert(injAppSrc.indexOf("seg('convention', t('tree.roleConvention'), t('meta.roleConventionTip'))") >= 0, 'app 行内三态复用 tree.role*/meta.role*Tip 既有 key')
    assert(injAppSrc.indexOf("t('meta.schedSent', { time:") >= 0 && injAppSrc.indexOf("t('meta.schedNext', { time:") >= 0, 'app schedBadgeHtml/schedNextLabel 复用 B 卡 meta.sched* key')
    assert(injAppSrc.indexOf("t('inj.batchConfirm', { label: label, n: ids.length") >= 0 && injAppSrc.indexOf("t('inj.batchDone', { label: label, ok: ok })") >= 0, 'app 批量 confirm/结果 toast 走 t() 插值')
    assert(injAppSrc.indexOf("t('inj.batchRefTip')") >= 0 && injCliSrc.indexOf("tt('inj.batchRefTip')") >= 0, '批量「设为资料」tooltip 双端接线（0.4.3⑪：缺省文案=标题注明）')
    assert(injAppSrc.indexOf("return arr.length === 0 ? t('inj.scopeGlobal') : t('inj.scopeSessions', { n: arr.length })") >= 0, 'app injMgrScopeLabel 走 t()（filter 回调形参 t 遮蔽仅域内）')
    // app memory-guide.js 锚点：状态行复用 settings.mem* / 长说明 mem.enableHint / 作用域档 / 校验三态
    assert(memAppSrc.indexOf("t('settings.memProbing')") >= 0 && memAppSrc.indexOf("t('settings.memEnable')") >= 0, 'app 记忆状态行复用 settings.mem* 既有 key')
    assert(memAppSrc.indexOf("t('mem.enableHint')") >= 0 && memAppSrc.indexOf("t('mem.scopeWsPick')") >= 0, 'app 启用对话框说明/作用域档走 t()')
    assert(memAppSrc.indexOf("t('mem.needWorkspace')") >= 0 && memAppSrc.indexOf("t('mem.wsLabel', { name: w,") >= 0, 'app 多选校验/工作区行标签走 t()')
    // client inject-manager.js 锚点：组件挂 tt=useT()（唯一）订阅自渲染；模块级 handler 走 t()
    assert((injCliSrc.match(/const tt = useT\(\)/g) || []).length === 2, 'client 注入管理双组件挂 tt=useT()（InjMgrModal + MountModal 挂载弹层，订阅 langStore 自渲染）')
    assert(injCliSrc.indexOf("chipBtn('all', tt('inj.chipAll', { n: listAll.length }))") >= 0 && injCliSrc.indexOf("' ' + tt('settings.injManager')") >= 0, 'client 注入管理标题/chips 走 tt()')
    assert(injCliSrc.indexOf("tt('meta.schedPaused')") >= 0 && injCliSrc.indexOf("tt('meta.schedDelTip')") >= 0, 'client 调度区暂停徽章/操作 tooltip 复用 meta.sched* 走 tt()')
    assert(injCliSrc.indexOf("t('inj.schedDelConfirm', { title:") >= 0 && injCliSrc.indexOf("t('inj.batchConfirm', { label: label") >= 0, 'client 模块级/组件内命令式 confirm 走 t() 直读')
    // client memory-guide.js 锚点：tt=useT() + 作用域档 tip / 启用中按钮态 / 模块级校验 t()
    assert((memCliSrc.match(/const tt = useT\(\)/g) || []).length === 1, 'client MemoryGuideModal 挂 tt=useT()（唯一）')
    assert(memCliSrc.indexOf("scopeOpt('workspace', tt('mem.scopeWsMulti'), tt('mem.scopeWsTip'))") >= 0, 'client 作用域档 label+tip 走 tt()')
    assert(memCliSrc.indexOf("memPending ? tt('mem.enabling') : tt('mem.confirmEnable')") >= 0, 'client 确认按钮启用中/确认双态走 tt()')
    assert(memCliSrc.indexOf("setError(t('mem.needWorkspace'))") >= 0 && memCliSrc.indexOf("t('mem.noSessInScope')") >= 0, 'client 模块级校验走 t()')
    // kernel 双镜像锚点：schedFreqLabel 走 t() common.sched* + 星期名管道取值（charAt 形态废止）
    assert(helpersSrc.indexOf("t('common.schedDaily')") >= 0 && helpersSrc.indexOf("t('common.dowNames').split('|')[s.dow]") >= 0, 'app helpers.js schedFreqLabel 走 t() + dowNames 管道取值')
    assert(formatSrc.indexOf("t('common.schedDaily')") >= 0 && formatSrc.indexOf("t('common.dowNames').split('|')[s.dow]") >= 0, 'client format.js schedFreqLabel 同口径镜像')
    assert(helpersSrc.indexOf('日一二三四五六') < 0 && formatSrc.indexOf('日一二三四五六') < 0, '双镜像 charAt 星期字面量清零（移入 common.dowNames 字典）')
  })

  // ===== ③ 行为级：eval 字典 + app i18n 块——取值/插值/en 态逐条非裸 key =====
  await t('行为级：覆盖D key 双语取值 + {name} 插值 + en 态 82 条逐条非裸 key', () => {
    const i18nBlock = helpersSrc.match(/\/\* ==== i18n-mech BEGIN ====[\s\S]*?\/\* ==== i18n-mech END ==== \*\//)[0]
    const mk = (stored) => new Function('localStorage', 'render', zhSrc + '\n' + enSrc + '\n' + i18nBlock + '\nreturn { t: t }')({ getItem: () => stored, setItem: () => {} }, () => {})
    const a = mk(null)
    assert.strictEqual(a.t('inj.chipConvention', { n: 3 }), '约定 3', 'zh {n} 插值')
    assert.strictEqual(a.t('inj.batchConfirm', { label: '设为约定', n: 2, effect: '注入为约定（须遵守）。' }), '批量设为约定：所选的 2 条笔记将注入为约定（须遵守）。\n确认执行？', 'zh batchConfirm 三参插值')
    assert.strictEqual(a.t('mem.wsLabel', { name: 'deepseek-work', n: 5 }), 'deepseek-work（5 个会话）', 'zh 工作区行双参插值')
    assert.strictEqual(a.t('inj.schedDelConfirm', { title: '定时 巡检' }).indexOf('删除定时任务「定时 巡检」？') === 0, true, 'zh 删除 confirm 插值')
    assert.strictEqual(a.t('common.dowNames'), '日|一|二|三|四|五|六', 'zh 星期名管道串')
    const b = mk('en')
    assert.strictEqual(b.t('inj.chipConvention', { n: 3 }), 'Convention 3', 'en {n} 插值')
    assert.strictEqual(b.t('inj.batchConfirm', { label: 'Set as convention', n: 2, effect: 'be injected as convention (must follow).' }), 'Set as convention (batch): the 2 selected notes will be injected as convention (must follow).\nProceed?', 'en batchConfirm 三参插值')
    assert.strictEqual(b.t('mem.scopeGlobal'), 'All sessions (default)', 'en 作用域全局档')
    assert.strictEqual(b.t('common.dowNames'), 'Sun|Mon|Tue|Wed|Thu|Fri|Sat', 'en 星期名管道串（多字符名）')
    assert.strictEqual(b.t('mem.sessWsSeg', { ws: 'ws1' }), ' (ws1)', 'en 工作区段半角括号')
    for (const k of KEYS) assert(b.t(k) !== k, 'en 态不得裸 key：' + k)
  })

  // ===== ④ 行为级：schedFreqLabel 真码（app helpers.js 提取）双语频率人话——跨表面 common.sched* 口径 =====
  await t('行为级：schedFreqLabel（app helpers.js 真码）zh/en 双语频率人话 + 锚定时刻后缀 + dowNames 星期名', () => {
    const i18nBlock = helpersSrc.match(/\/\* ==== i18n-mech BEGIN ====[\s\S]*?\/\* ==== i18n-mech END ==== \*\//)[0]
    const fmtDTSrc = helpersSrc.match(/function fmtDT\(iso\)[^\n]*/)[0]
    const everySrc = helpersSrc.match(/function schedEveryMs\(every\) \{[\s\S]*?\n\}/)[0]
    const freqSrc = helpersSrc.match(/function schedFreqLabel\(s\) \{[\s\S]*?\n\}/)[0]
    const mk = (stored) => new Function('localStorage', 'render', zhSrc + '\n' + enSrc + '\n' + i18nBlock + '\n' + fmtDTSrc + '\n' + everySrc + '\n' + freqSrc + '\nreturn { f: schedFreqLabel }')({ getItem: () => stored, setItem: () => {} }, () => {})
    const az = mk(null)
    assert.strictEqual(az.f({ every: '1d' }), '每天', 'zh 每天')
    assert.strictEqual(az.f({ every: '1w', anchor: '09:00', dow: 1 }), '每周一 09:00', 'zh 每周 + 星期名 + 锚定时刻')
    assert.strictEqual(az.f({ every: '3d', anchor: '08:30' }), '每 3 天 08:30', 'zh 每 N 天 + 锚定时刻')
    assert.strictEqual(az.f({ every: '45m' }), '每 45 分钟', 'zh 非整天旁路兜底')
    assert.strictEqual(az.f({ every: 'bad' }), '非法间隔', 'zh 非法间隔')
    assert(az.f({ at: '2026-10-10T01:00:00.000Z' }).indexOf('仅一次 ') === 0, 'zh 仅一次带时间')
    const bn = mk('en')
    assert.strictEqual(bn.f({ every: '1d' }), 'Daily', 'en Daily')
    assert.strictEqual(bn.f({ every: '1w', anchor: '09:00', dow: 1 }), 'Weekly Mon 09:00', 'en 每周 + 英文星期名（dowNames 管道取值，charAt 不可取）')
    assert.strictEqual(bn.f({ every: '1w', anchor: '18:30', dow: 0 }), 'Weekly Sun 18:30', 'en 周日 dow=0')
    assert.strictEqual(bn.f({ every: '3d', anchor: '08:30' }), 'Every 3 days 08:30', 'en 每 N 天 + 锚定时刻')
    assert.strictEqual(bn.f({ every: '45m' }), 'Every 45 minutes', 'en 非整天旁路兜底')
    assert.strictEqual(bn.f({ every: 'bad' }), 'Invalid interval', 'en 非法间隔')
    assert(bn.f({ at: '2026-10-10T01:00:00.000Z' }).indexOf('Once ') === 0, 'en 仅一次带时间')
  })

  // ===== ⑤ 产物英文态抽查 + 原型不双语红线 =====
  await t('产物英文态抽查：app.html/lib-client 含 en 关键串 + t()/tt() 接线入产物 + 原型零 inj/mem/common.sched 域引用', () => {
    for (const [s, tag] of [[appSrc, 'app.html'], [clientPkgSrc, '发布包 lib/client.js']]) {
      assert(s.indexOf("'inj.chipOff': 'Not injected {n}'") >= 0, tag + ' en 关键串 inj.chipOff')
      assert(s.indexOf("'mem.enableTitle': 'Enable settling guide'") >= 0, tag + ' en 关键串 mem.enableTitle')
      assert(s.indexOf("'common.schedDaily': 'Daily'") >= 0, tag + ' en 关键串 common.schedDaily')
      assert(s.indexOf("'common.dowNames': 'Sun|Mon|Tue|Wed|Thu|Fri|Sat'") >= 0, tag + ' en 关键串 common.dowNames')
      assert(s.indexOf("'inj.schedEmpty': 'No scheduled tasks yet") >= 0, tag + ' en 关键串 inj.schedEmpty')
    }
    assert(appSrc.indexOf("t('inj.titleSub')") >= 0 && appSrc.indexOf("t('mem.enableHint')") >= 0, 'app.html 产物含 inj/mem t() 接线（需先跑 concat-app）')
    assert(appSrc.indexOf("t('common.schedWeeklyDow', { dow:") >= 0, 'app.html 产物含 schedFreqLabel t() 化（需先跑 concat-app）')
    assert(clientSrc.indexOf("tt('inj.chipAll'") >= 0 && clientPkgSrc.indexOf("tt('inj.chipAll'") >= 0, 'client 开发版/发布包含注入管理 tt()（需先跑 build-dist）')
    assert(clientSrc.indexOf("scopeOpt('global', tt('mem.scopeGlobal')") >= 0 && clientPkgSrc.indexOf("tt('mem.enabling')") >= 0, 'client 开发版/发布包含记忆引导 tt()（需先跑 build-dist）')
    // 原型不双语红线：零 inj/mem/common.sched 域 t() 字典引用
    assert(protoSrc.indexOf("t('inj.") < 0 && protoSrc.indexOf("t('mem.") < 0 && protoSrc.indexOf("t('common.sched") < 0 && protoSrc.indexOf("tt('inj.") < 0 && protoSrc.indexOf("tt('mem.") < 0, '原型不双语红线：零 inj/mem/common.sched 域 t() 引用')
  })
  }
}
