// 节 50. 定时派发·设置交互 UI（notes-034-sched-ui：派发弹窗调度区 + 注入管理调度任务区 + 原型同步）
// 设计定稿（主窗口调研笔记 2026-10-04，依赖执行层节 48 的 dispatch-schedule schema）：
//   ①派发弹窗扩展「调度」区（默认收起 = 立即派发，手动派发路径零改动）：单选 立即派发/定时执行；频率四模式（每天/每周/每 N 天/仅一次+时间）；
//     确认排定 = 创建 contractType=dispatch-schedule 约定笔记（标题自动「定时 」前缀 + front-matter 声明 + 正文人话=原正文+补充指令）+ toast「已排定，下次：X」；
//     编辑 = 同弹窗回填（注入管理 [编辑] 进入）；校验内联报错（at 未来/N≥1/目标必选，host 红线回显同口径）——禁原生 prompt（R1 反面教材 n-mut46q00c3yw）。
//   ②注入管理面板「调度任务」区：每条 频率/目标/下次触发/上次结果徽章；操作 [编辑（回填弹窗）][暂停 enabled=false][删除（软删约定笔记）]——暂停与删除分开。
//   ③数据一致性：表单与 front-matter 同一数据源两个视图（notes-create/notes-update 写 schedule 声明；slim 已带 contractType/schedule，零新 RPC）。
// 测试策略：四端锚点（clientSrc/clientPkgSrc/appSrc/protoV2Src）+ 纯函数 helper 行为级断言（grabFn 提取 eval）+ 原型 mock 写入闸门行为级断言。
module.exports = {
  id: "50",
  title: "50. 定时派发·设置交互 UI（派发弹窗调度区 + 注入管理调度任务区 + 原型同步）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, SRC_STYLES, clientSrc } = H
  const { appSrc, clientPkgSrc, protoV2Src } = S
  section('50. 定时派发·设置交互 UI（派发弹窗调度区 + 注入管理调度任务区 + 原型同步）')

  const grabFn = (s, name, tag) => { const m = s.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}')); assert(m, tag + ' 缺 ' + name + '()'); return m && m[0] }

  // ===== 50.1 调度 helper：app.html ⇄ 原型逐字节一致 + 行为级（与 host schedEveryMs/schedDueAt 同口径） =====
  await t('调度 helper 四端同口径：schedEveryMs/schedFreqLabel/schedNextMs/isoToLocalInput 行为 + app⇄原型逐字节一致', () => {
    /* i18n 覆盖卡D：schedFreqLabel 频率文案走 t() 字典（common.sched*，app helpers.js ⇄ client format.js 同口径），原型不双语红线保持静态中文——
       app⇄原型逐字节一致断言收敛到其余五函数；schedFreqLabel 改验行为级等价（app zh 态输出 = 原型原文输出 + en 态英文文案） */
    for (const fn of ['schedEveryMs', 'schedAnchorMs', 'schedAnchorNextMs', 'schedNextMs', 'isoToLocalInput']) {
      assert.strictEqual(grabFn(appSrc, fn, 'app.html'), grabFn(protoV2Src, fn, '原型'), 'app.html ⇄ 原型 ' + fn + ' 逐字节一致')
    }
    const fmtDTApp = appSrc.match(/function fmtDT\(iso\)[^\n]*/); assert(fmtDTApp, 'app.html 缺 fmtDT 单行函数')
    /* eval 前导（覆盖卡D）：真字典 + t() 桩（useEn 切换取值字典，回退链同真码）——schedFreqLabel 已走 t() */
    const zhSrc50 = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8')
    const enSrc50 = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'en.js'), 'utf8')
    const tPre50 = (useEn) => zhSrc50 + '\n' + enSrc50 + '\nfunction t(k, vars){ var s = ' + (useEn ? 'I18N_EN' : 'I18N_ZH') + '[k]; if (s == null) s = I18N_ZH[k]; if (s == null) return k; if (vars) s = s.replace(/\\{(\\w+)\\}/g, function (m, n) { return vars[n] != null ? String(vars[n]) : m }); return s }\n'
    const ns = {}
    new Function('ns', tPre50(false) + fmtDTApp[0] + '\n' + ['schedEveryMs', 'schedAnchorMs', 'schedAnchorNextMs', 'schedFreqLabel', 'schedNextMs', 'isoToLocalInput'].map(f => grabFn(appSrc, f, 'app.html')).join('\n') + '\nns.schedEveryMs = schedEveryMs; ns.schedAnchorMs = schedAnchorMs; ns.schedAnchorNextMs = schedAnchorNextMs; ns.schedFreqLabel = schedFreqLabel; ns.schedNextMs = schedNextMs; ns.isoToLocalInput = isoToLocalInput')(ns)
    assert.strictEqual(ns.schedEveryMs('3d'), 259200000, '3d → ms')
    assert.strictEqual(ns.schedEveryMs('1w'), 604800000, '1w → ms')
    assert.strictEqual(ns.schedEveryMs('30m'), 1800000, '30m → ms')
    assert.strictEqual(ns.schedEveryMs('12h'), 43200000, '12h → ms')
    assert.strictEqual(ns.schedEveryMs(45000), 45000, 'number 直给')
    assert.strictEqual(ns.schedEveryMs('3x'), null, '非法单位 → null')
    assert.strictEqual(ns.schedEveryMs(''), null, '空串 → null')
    assert.strictEqual(ns.schedEveryMs(-5), null, '负数 → null')
    assert.strictEqual(ns.schedFreqLabel({ every: '1d' }), '每天', '频率人话：每天')
    assert.strictEqual(ns.schedFreqLabel({ every: '1w' }), '每周', '频率人话：每周')
    assert.strictEqual(ns.schedFreqLabel({ every: '3d' }), '每 3 天', '频率人话：每 N 天')
    assert.strictEqual(ns.schedFreqLabel({ every: '12h' }), '每 12 小时', '非整天旁路值兜底')
    assert.strictEqual(ns.schedFreqLabel({ every: 'bad' }), '非法间隔', '非法间隔兜底')
    assert(ns.schedFreqLabel({ at: '2026-10-10T01:00:00.000Z' }).indexOf('仅一次') === 0, '频率人话：仅一次带时间')
    // 锚定时刻（notes-034-sched-time）：频率人话带本地时刻后缀（确认稿「每天 09:00」形态）
    assert.strictEqual(ns.schedFreqLabel({ every: '1d', anchor: '09:00' }), '每天 09:00', '频率人话：每天 + 锚定时刻')
    assert.strictEqual(ns.schedFreqLabel({ every: '1w', anchor: '09:00', dow: 1 }), '每周一 09:00', '频率人话：每周 + 星期几 + 锚定时刻')
    assert.strictEqual(ns.schedFreqLabel({ every: '1w', anchor: '18:30', dow: 0 }), '每周日 18:30', '频率人话：周日 dow=0')
    assert.strictEqual(ns.schedFreqLabel({ every: '3d', anchor: '08:30' }), '每 3 天 08:30', '频率人话：每 N 天 + 锚定时刻')
    // i18n 覆盖卡D：en 态频率人话（同 eval 换 en 取值）+ 星期名经 common.dowNames 管道分隔（en 多字符名 charAt 不可取）
    const nsEn = {}
    new Function('ns', tPre50(true) + fmtDTApp[0] + '\n' + grabFn(appSrc, 'schedEveryMs', 'app.html') + '\n' + grabFn(appSrc, 'schedFreqLabel', 'app.html') + '\nns.schedFreqLabel = schedFreqLabel')(nsEn)
    assert.strictEqual(nsEn.schedFreqLabel({ every: '1d' }), 'Daily', 'en 频率人话：Daily')
    assert.strictEqual(nsEn.schedFreqLabel({ every: '1w' }), 'Weekly', 'en 频率人话：Weekly')
    assert.strictEqual(nsEn.schedFreqLabel({ every: '3d' }), 'Every 3 days', 'en 频率人话：每 N 天')
    assert.strictEqual(nsEn.schedFreqLabel({ every: '12h' }), 'Every 12 hours', 'en 非整天旁路值兜底')
    assert.strictEqual(nsEn.schedFreqLabel({ every: 'bad' }), 'Invalid interval', 'en 非法间隔兜底')
    assert(nsEn.schedFreqLabel({ at: '2026-10-10T01:00:00.000Z' }).indexOf('Once ') === 0, 'en 频率人话：仅一次带时间')
    assert.strictEqual(nsEn.schedFreqLabel({ every: '1d', anchor: '09:00' }), 'Daily 09:00', 'en 每天 + 锚定时刻')
    assert.strictEqual(nsEn.schedFreqLabel({ every: '1w', anchor: '09:00', dow: 1 }), 'Weekly Mon 09:00', 'en 每周 + 星期名（common.dowNames 管道取值）')
    assert.strictEqual(nsEn.schedFreqLabel({ every: '1w', anchor: '18:30', dow: 0 }), 'Weekly Sun 18:30', 'en 周日 dow=0')
    // 原型静态中文与 app zh 态逐样本行为等价（源码形态分叉 = 不双语红线，有意为之）
    const fmtDTProto = protoV2Src.match(/function fmtDT\(iso\)[^\n]*/); assert(fmtDTProto, '原型缺 fmtDT 单行函数')
    const nsP = {}
    new Function('ns', fmtDTProto[0] + '\n' + grabFn(protoV2Src, 'schedEveryMs', '原型') + '\n' + grabFn(protoV2Src, 'schedFreqLabel', '原型') + '\nns.schedFreqLabel = schedFreqLabel')(nsP)
    assert(grabFn(protoV2Src, 'schedFreqLabel', '原型').indexOf("t('common.sched") < 0 && nsP.schedFreqLabel({ every: '1d' }) === '每天', '原型 schedFreqLabel 静态中文保留（不双语红线）')
    for (const sample of [{ every: '1d' }, { every: '1w' }, { every: '3d' }, { every: '12h' }, { every: 'bad' }, { every: '1d', anchor: '09:00' }, { every: '1w', anchor: '09:00', dow: 1 }, { every: '1w', anchor: '18:30', dow: 0 }, { every: '3d', anchor: '08:30' }]) {
      assert.strictEqual(ns.schedFreqLabel(sample), nsP.schedFreqLabel(sample), 'zh 态 app ⇄ 原型频率人话行为等价：' + JSON.stringify(sample))
    }
    // 锚定时刻 helper：schedAnchorMs 严格 HH:MM
    assert.strictEqual(ns.schedAnchorMs('09:00'), 32400000, '锚定时刻 09:00 → 当日偏移 ms')
    assert.strictEqual(ns.schedAnchorMs('00:00'), 0, '锚定时刻 00:00 边界')
    assert.strictEqual(ns.schedAnchorMs('23:59'), 86340000, '锚定时刻 23:59 边界')
    assert.strictEqual(ns.schedAnchorMs('24:00'), null, '锚定时刻 24:00 越界 → null')
    assert.strictEqual(ns.schedAnchorMs('9:00'), null, '锚定时刻单数字小时 → null（严格两位）')
    assert.strictEqual(ns.schedAnchorMs('bad'), null, '锚定时刻非法串 → null')
    // 锚定时刻 helper：schedAnchorNextMs（本地墙钟造数，时区无关断言）
    const mkL = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi || 0, 0).getTime()
    assert.strictEqual(ns.schedAnchorNextMs('09:00', undefined, 86400000, mkL(2026, 10, 5, 8, 30), false), mkL(2026, 10, 5, 9, 0), '首触=当日锚定时刻（当日 09:00 未到）')
    assert.strictEqual(ns.schedAnchorNextMs('09:00', undefined, 86400000, mkL(2026, 10, 5, 15, 0), false), mkL(2026, 10, 6, 9, 0), '首触=次日锚定时刻（当日 09:00 已过）')
    assert.strictEqual(ns.schedAnchorNextMs('09:00', undefined, 86400000, mkL(2026, 10, 5, 9, 0), true), mkL(2026, 10, 6, 9, 0), '每天已触发：准点后 → 次日 09:00')
    assert.strictEqual(ns.schedAnchorNextMs('09:00', undefined, 86400000, mkL(2026, 10, 5, 12, 0), true), mkL(2026, 10, 6, 9, 0), '每天已触发：延迟 3h 后仍 → 次日 09:00（不漂移）')
    assert.strictEqual(ns.schedAnchorNextMs('08:30', undefined, 3 * 86400000, mkL(2026, 10, 5, 8, 30), true), mkL(2026, 10, 8, 8, 30), '每 3 天已触发：+3d 锚定 08:30')
    assert.strictEqual(ns.schedAnchorNextMs('09:00', undefined, 1800000, mkL(2026, 10, 5, 9, 0), true), null, '子日间隔 → null（闸门前置拦截，helper 双保险）')
    assert.strictEqual(ns.schedAnchorNextMs('bad', undefined, 86400000, mkL(2026, 10, 5, 9, 0), false), null, '非法 anchor → null')
    const wBase = mkL(2026, 10, 5, 8, 30), wDow = new Date(wBase).getDay(), wFire = wBase + 1800000   // 当日 08:30 → 当日 09:00
    assert.strictEqual(ns.schedAnchorNextMs('09:00', wDow, 604800000, wBase, false), wFire, 'weekly 首触：当日即 dow 且时刻未到 → 当日 09:00')
    assert.strictEqual(ns.schedAnchorNextMs('09:00', wDow, 604800000, wFire, true), wFire + 7 * 86400000, 'weekly 已触发：→ 下周同 dow 09:00（不漂移）')
    assert.strictEqual(ns.schedAnchorNextMs('09:00', wDow, 604800000, wFire + 3600000, true), wFire + 7 * 86400000, 'weekly 延迟触发 1h：仍 → 下周同 dow 09:00')
    // 0.4.6-F（notes-046-sched-anchor）首触防过去候选：nowMs 注入时首触候选落在过去 → 对齐「now 之后第一个锚定时刻」（首轮不补发）；
    //   已触发分支不注入该闸（停机补发一次语义保留）；无 nowMs / now 早于 base → 旧口径零变化（上行断言区原样保留 = 兼容证明）
    assert.strictEqual(ns.schedAnchorNextMs('09:00', undefined, 86400000, mkL(2026, 10, 1, 8, 30), false, mkL(2026, 10, 5, 15, 0)), mkL(2026, 10, 6, 9, 0), '首触候选在过去 + 当日锚定已过 → now 次日 09:00（0.4.6-F）')
    assert.strictEqual(ns.schedAnchorNextMs('09:00', undefined, 86400000, mkL(2026, 10, 1, 8, 30), false, mkL(2026, 10, 5, 8, 0)), mkL(2026, 10, 5, 9, 0), '首触候选在过去 + 当日锚定未到 → now 当日 09:00（0.4.6-F）')
    assert.strictEqual(ns.schedAnchorNextMs('09:00', undefined, 86400000, mkL(2026, 10, 5, 8, 30), false, mkL(2026, 10, 5, 8, 40)), mkL(2026, 10, 5, 9, 0), '首触候选在未来 → 闸不插手（编辑当天锚定未到照常当日触发，0.4.6-F）')
    assert.strictEqual(ns.schedAnchorNextMs('09:00', undefined, 86400000, mkL(2026, 10, 5, 9, 0), true, mkL(2026, 10, 8, 12, 0)), mkL(2026, 10, 6, 9, 0), '已触发分支不注入防过去闸（停机补发语义保留，0.4.6-F）')
    assert.strictEqual(ns.schedAnchorNextMs('09:00', wDow, 604800000, wBase - 21 * 86400000, false, wBase), wFire, 'weekly 首触 base 陈旧（3 周前）→ now 之后首个 dow 09:00（0.4.6-F）')
    assert.strictEqual(ns.schedAnchorNextMs('09:00', wDow, 604800000, wBase, false, wBase - 86400000), wFire, 'weekly 首触 now 早于 base → 旧口径不插手（0.4.6-F 兼容）')
    const anchor = '2026-10-01T02:00:00.000Z'
    assert.strictEqual(ns.schedNextMs({ createdAt: anchor, schedule: { every: '3d' } }), Date.parse(anchor) + 3 * 86400000, '轮询未触发：createdAt + 间隔（同 host 锚点，无 anchor 存量兼容）')
    const fired = '2026-10-03T02:00:00.000Z'
    assert.strictEqual(ns.schedNextMs({ createdAt: anchor, schedule: { every: '3d', lastFiredAt: fired } }), Date.parse(fired) + 3 * 86400000, '轮询已触发：lastFiredAt + 间隔（对齐下周期不追赶）')
    // 0.4.6-F 声明重锚：轮询锚点 = lastFiredAt || declaredAt || createdAt（declaredAt 优先于 createdAt；lastFiredAt 最优先）
    assert.strictEqual(ns.schedNextMs({ createdAt: anchor, schedule: { every: '3d', declaredAt: '2026-10-02T02:00:00.000Z' } }), Date.parse('2026-10-02T02:00:00.000Z') + 3 * 86400000, '轮询未触发带 declaredAt：declaredAt + 间隔（重锚优先 createdAt，0.4.6-F）')
    assert.strictEqual(ns.schedNextMs({ createdAt: anchor, schedule: { every: '3d', lastFiredAt: fired, declaredAt: '2026-10-02T02:00:00.000Z' } }), Date.parse(fired) + 3 * 86400000, '轮询已触发带 declaredAt：lastFiredAt 优先（触发后锚点不变回归，0.4.6-F）')
    assert.strictEqual(ns.schedNextMs({ schedule: { at: '2026-10-10T01:00:00.000Z' } }), Date.parse('2026-10-10T01:00:00.000Z'), '单次 = at 本身')
    assert.strictEqual(ns.schedNextMs({ schedule: { every: 'bad' } }), null, '非法间隔 → null')
    assert.strictEqual(ns.schedNextMs({}), null, '无 schedule → null')
    // 锚定时刻声明：schedNextMs 走锚定序列（注入管理「下次触发」展示口径）；
    //   0.4.6-F：存量 createdAt 陈旧的首触展示对齐「now 之后第一个锚定时刻」（防过去候选，与 host 实触口径一致——关系断言防时钟边界竞态）
    const aBase = mkL(2026, 10, 5, 8, 30), aIso = new Date(aBase).toISOString()
    const now50 = Date.now()
    const nxDaily = ns.schedNextMs({ createdAt: aIso, schedule: { every: '1d', anchor: '09:00' } })
    assert(nxDaily >= now50 - 1000 && nxDaily <= now50 + 86400000 + 60000 && new Date(nxDaily).getHours() === 9 && new Date(nxDaily).getMinutes() === 0, '锚定声明存量首触 = now 之后第一个本地 09:00（0.4.6-F 防过去候选，实得 ' + new Date(nxDaily).toISOString() + '）')
    assert.strictEqual(ns.schedNextMs({ createdAt: aIso, schedule: { every: '1d', anchor: '09:00', lastFiredAt: new Date(mkL(2026, 10, 5, 12, 0)).toISOString() } }), mkL(2026, 10, 6, 9, 0), '锚定声明已触发：次日 09:00（延迟不漂移——fired 分支不注入防过去闸）')
    const nxWeekly = ns.schedNextMs({ createdAt: aIso, schedule: { every: '1w', anchor: '09:00', dow: new Date(aBase).getDay() } })
    assert(nxWeekly >= now50 - 1000 && nxWeekly <= now50 + 8 * 86400000 && new Date(nxWeekly).getDay() === new Date(aBase).getDay() && new Date(nxWeekly).getHours() === 9 && new Date(nxWeekly).getMinutes() === 0, '锚定 weekly 存量首触 = now 之后第一个 dow 09:00（0.4.6-F 防过去候选，实得 ' + new Date(nxWeekly).toISOString() + '）')
    // 0.4.6-F 四端锚点：declaredAt 重锚口径镜像同步（app/client/原型）
    for (const [src46, tag46] of [[appSrc, 'app.html'], [clientSrc, 'client'], [protoV2Src, '原型']]) {
      assert(src46.indexOf('declaredAt') >= 0, tag46 + ' 调度镜像含 declaredAt（0.4.6-F 声明重锚）')
      assert(src46.indexOf('首触防过去候选') >= 0, tag46 + ' 调度镜像含首触防过去候选（0.4.6-F）')
    }
    const li = ns.isoToLocalInput('2026-10-10T01:00:00.000Z')
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(li), 'datetime-local 形态（实得 ' + li + '）')
    assert.strictEqual(ns.isoToLocalInput('bad'), '', '非法 ISO → 空串')
    // client 侧同口径锚点（format.js 箭头函数镜像）
    for (const k of ['const schedEveryMs =', 'const schedAnchorMs =', 'const schedAnchorNextMs =', 'const schedFreqLabel =', 'const schedNextMs =', 'const isoToLocalInput =', 'const schedFormDecl =', 'const schedDeclNextMs =']) {
      assert(clientSrc.indexOf(k) >= 0, 'client format.js 缺调度 helper：' + k)
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺调度 helper：' + k + '（需先跑 scripts/build-dist.cjs）')
    }
  })

  // ===== 50.2 派发弹窗调度区（app.html + 原型同款 DOM 实现） =====
  await t('派发弹窗调度区（app.html + 原型）：立即/定时单选 + 频率四模式 + 内联校验 + 创建/编辑双通道 + 手动派发零改动', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      // ① 调度区结构与单选（默认收起 = 立即派发）
      assert(s.indexOf('function openDispatchEdit(note)') >= 0, label + ' openDispatchEdit 编辑回填入口')
      assert(s.indexOf("sched: false, schedMode: 'daily', schedN: 3, schedAt: '', editId: '', editNote: null, schedAnchor: '09:00', schedDow: 1") >= 0, label + ' openDispatch 调度区复位（默认立即派发 + 锚定时刻默认 09:00/周一）')
      /* i18n 覆盖卡E：app 端调度区文案走 t() 字典（zh 原串在 src/i18n/zh.js，随包内嵌），原型不双语红线保留中文原文（分侧断言，同 50.3 徽章先例） */
      if (label === 'app.html') {
        assert(s.indexOf("t('disp.now') + '</label><label") >= 0 && s.indexOf("'> ' + t('disp.scheduled') + '</label>'") >= 0, label + ' 单选 立即派发/定时执行走 t()（覆盖卡E）')
        assert(s.indexOf('id="dSchedMode"') >= 0 && s.indexOf(">' + t('common.schedDaily') + '</option>'") >= 0 && s.indexOf(">' + t('common.schedWeekly') + '</option>'") >= 0 && s.indexOf(">' + t('disp.modeNDays') + '</option>'") >= 0 && s.indexOf(">' + t('disp.modeOnce') + '</option>'") >= 0, label + ' 频率四模式下拉走 t()（覆盖卡E）')
      } else {
        assert(s.indexOf('> 立即派发</label>') >= 0 && s.indexOf('> 定时执行</label>') >= 0, label + ' 单选 立即派发/定时执行')
        assert(s.indexOf('id="dSchedMode"') >= 0 && s.indexOf('>每天</option>') >= 0 && s.indexOf('>每周</option>') >= 0 && s.indexOf('>每 N 天</option>') >= 0 && s.indexOf('>仅一次（指定时间）</option>') >= 0, label + ' 频率四模式下拉')
      }
      assert(s.indexOf('id="dSchedN"') >= 0 && s.indexOf('type="datetime-local"') >= 0 && s.indexOf('id="dSchedOnce"') >= 0, label + ' 每 N 天数字框 + 仅一次时间框')
      // ①·b 锚定时刻（notes-034-sched-time）：周期三模式时刻框（type=time 默认 09:00）+ 每周星期几选择；仅一次保持 datetime-local 不变
      assert(s.indexOf('id="dSchedAnchor"') >= 0 && s.indexOf('type="time"') >= 0, label + ' 周期模式时刻框（type=time）')
      /* i18n 覆盖卡E：app 星期几选项走 t('disp.dowOption') + common.dowNames 管道取值（charAt 形态废止，同卡 D schedFreqLabel 口径）；原型保留中文原文 */
      if (label === 'app.html') assert(s.indexOf('id="dSchedDow"') >= 0 && s.indexOf("t('disp.dowOption', { dow: t('common.dowNames').split('|')[d] || '' })") >= 0 && s.indexOf('[1, 2, 3, 4, 5, 6, 0].map(') >= 0, label + ' 每周星期几选择走 t() dowNames 管道（覆盖卡E）')
      else assert(s.indexOf('id="dSchedDow"') >= 0 && s.indexOf("'>周' + '日一二三四五六'.charAt(d)") >= 0 && s.indexOf('[1, 2, 3, 4, 5, 6, 0].map(') >= 0, label + ' 每周星期几选择（dow 0-6，周日…周六）')
      assert(s.indexOf("$('dSchedDowBox').style.display = this.value === 'weekly' ? '' : 'none'") >= 0, label + ' 星期几框仅每周模式显示')
      assert(s.indexOf("$('dSchedAnchor').style.display = this.value === 'once' ? 'none' : ''") >= 0, label + ' 时刻框仅周期模式显示（仅一次除外）')
      assert(s.indexOf("$('dSchedDow').onchange =") >= 0 && s.indexOf("$('dSchedAnchor').oninput =") >= 0, label + ' 星期几/时刻输入接线')
      assert(s.indexOf('schedAnchorMs(s.anchor) !== null') >= 0 && s.indexOf('dState.schedDow = s.dow') >= 0, label + ' 编辑回填 anchor/dow（非法 anchor 回退 09:00）')
      assert(s.indexOf('id="dSchedNext"') >= 0 && s.indexOf('function renderSchedNext()') >= 0, label + ' 下次触发即时预览')
      // ② 内联校验（禁原生 prompt）
      assert(s.indexOf('function schedFormDecl()') >= 0 && s.indexOf('定时时间必须是未来时刻') >= 0 && s.indexOf('每 N 天的 N 需为 ≥1 的整数') >= 0, label + ' 内联校验文案（at 未来 / N≥1）')
      assert(s.indexOf('周期模式需选择触发时刻（HH:MM）') >= 0, label + ' 锚定时刻内联校验文案（notes-034-sched-time）')
      // ②·b 本地时区语义（notes-034-at-local-tz）：仅一次提交 = datetime-local 原值经 isoToLocalInput 归一（本地无后缀串），禁 toISOString（Z 后缀被 host 闸门拒绝）
      assert(s.indexOf('return { decl: { at: isoToLocalInput(dState.schedAt) } }') >= 0, label + ' 仅一次提交本地无后缀串（datetime-local 提交路径不受闸门影响）')
      // ②·c 锚定时刻声明（notes-034-sched-time）：周期三模式携 anchor:'HH:MM'，每周另带 dow；确认排定透传 + 预览走锚定序列
      assert(s.indexOf("return { decl: { every: '1d', anchor: dState.schedAnchor } }") >= 0, label + ' 每天声明携 anchor')
      assert(s.indexOf("return { decl: { every: '1w', anchor: dState.schedAnchor, dow: dState.schedDow } }") >= 0, label + ' 每周声明携 anchor+dow')
      assert(s.indexOf("return { decl: { every: n + 'd', anchor: dState.schedAnchor } }") >= 0, label + ' 每 N 天声明携 anchor')
      assert(s.indexOf('decl.anchor = f.decl.anchor') >= 0 && s.indexOf('decl.dow = f.decl.dow') >= 0, label + ' 确认排定携锚定时刻字段提交')
      assert(s.indexOf('schedAnchorNextMs(decl.anchor') >= 0, label + ' 下次触发预览走锚定序列口径（同 host schedDueAt）')
      // ③ 确认排定 = 创建 dispatch-schedule 约定笔记（标题「定时 」前缀 + 正文人话 + 补充指令）
      assert(s.indexOf("'定时 ' + (edNote.title || 'Untitled')") >= 0, label + ' 标题自动「定时 」前缀')
      assert(s.indexOf("contractType: 'dispatch-schedule', schedule: decl") >= 0, label + ' notes-create 携带 contractType + schedule（front-matter 同源）')
      assert(s.indexOf("'\\n\\n补充指令：'") >= 0, label + ' 正文 = 原待办正文 + 补充指令')
      /* i18n 覆盖卡E：app 排定 toast 走 t('disp.schedDone'/'disp.schedUpdated') 插值（zh 原串随字典内嵌）；原型保留中文原文 */
      if (label === 'app.html') assert(s.indexOf("t(editId ? 'disp.schedUpdated' : 'disp.schedDone', { time: nextTxt })") >= 0 && s.indexOf("'disp.schedDone': '已排定，下次：{time}'") >= 0 && s.indexOf("'disp.schedUpdated': '已更新排定，下次：{time}'") >= 0, label + ' 排定 toast 走 t()（覆盖卡E，zh 原串字典内嵌）')
      else assert(s.indexOf("'已排定，下次：'") >= 0 && s.indexOf("'已更新排定，下次：'") >= 0, label + ' toast「已排定，下次：X」/ 编辑「已更新排定」')
      // ④ 编辑通道：notes-update + 保留原 enabled 态 + 目标不在活跃清单的合成条目兜底
      assert(s.indexOf("rpc('notes-update', { id: editId, schedule: decl })") >= 0, label + ' 编辑保存走 notes-update')
      assert(s.indexOf('dState.editNote.schedule.enabled !== false') >= 0, label + ' 编辑保留原 enabled 态（暂停任务改排定不被拉起）')
      assert(s.indexOf('原目标会话（当前不在活跃清单）') >= 0, label + ' 编辑模式目标合成条目兜底')
      assert(s.indexOf('保存排定') >= 0 && s.indexOf('编辑定时任务') >= 0, label + ' 编辑模式标题/按钮文案')
      // ⑤ 手动派发路径零改动（既有 RPC 调用形态原样保留）
      assert(s.indexOf("rpc('notes-dispatch', { id: selId, sessionId: dState.sessId, sessionName: sess ? sess.name : '', workspace: sess ? sess.workspace : '', mode: 'existing', instruction: dState.instr })") >= 0, label + ' 手动派发 RPC 调用形态零改动')
      // ⑥ 调度区样式
      for (const cls of ['.sched-box{', '.sched-opt{', '.sched-form{', '.sched-sel{', '.sched-n{', '.sched-at{', '.sched-next{', '.sched-next.warn{']) {
        assert(s.indexOf(cls) >= 0, label + ' 缺调度区样式：' + cls)
      }
    }
  })

  // ===== 50.3 注入管理「调度任务」区（app.html + 原型） =====
  await t('注入管理调度任务区（app.html + 原型）：总览徽章 + 编辑回填 + 暂停/恢复 + 软删 + Esc 复位', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('id="injSchedHost"') >= 0, label + ' 调度任务区宿主')
      assert(s.indexOf('function injSchedList()') >= 0 && s.indexOf("=== 'dispatch-schedule'") >= 0, label + ' 调度清单 = contractType 过滤（slim 既有字段，零新 RPC）')
      assert(s.indexOf('调度任务（') >= 0 && s.indexOf('声明在 front-matter（contractType: dispatch-schedule），裸编辑即开发者旁路') >= 0, label + ' 调度任务区标题 + 同源说明')
      // 徽章：频率/目标/下次触发/上次结果（sent 绿 / error 红 / 未触发灰 / 暂停黄）
      assert(s.indexOf('function schedBadgeHtml(n)') >= 0 && s.indexOf('function schedNextLabel(n)') >= 0, label + ' 徽章/下次触发渲染函数')
      /* i18n 覆盖卡D：app 端徽章文案走 t()（复用 B 卡 meta.sched* key，zh 字典随包内嵌），原型不双语红线保留中文原文 */
      if (label === 'app.html') {
        assert(s.indexOf("t('meta.schedSent', { time:") >= 0 && s.indexOf("t('meta.schedFailed', { time:") >= 0 && s.indexOf("t('meta.schedNever')") >= 0 && s.indexOf("t('meta.schedPaused')") >= 0, label + ' 四态徽章文案走 t()（覆盖卡D）')
        assert(s.indexOf("'meta.schedSent': '已派发 {time}'") >= 0 && s.indexOf("'meta.schedNever': '未触发'") >= 0, label + ' 徽章文案 zh 字典随包内嵌')
      } else {
        assert(s.indexOf("'已派发 '") >= 0 && s.indexOf("'失败 '") >= 0 && s.indexOf('未触发') >= 0 && s.indexOf('已暂停') >= 0, label + ' 四态徽章文案')
      }
      assert(s.indexOf('已触发（单次）') >= 0, label + ' 单次已触发态')
      // 操作：编辑回填 / 暂停恢复（enabled 翻转）/ 软删（confirm + 回收站可恢复）
      assert(s.indexOf('function doInjSchedEdit(n)') >= 0 && s.indexOf('openDispatchEdit(n)') >= 0, label + ' 编辑 = 回填派发弹窗')
      assert(s.indexOf('closeModal(); injMgrState = null; openDispatchEdit(n)') >= 0, label + ' modal 不叠 modal（先关注入管理）')
      assert(s.indexOf('function doInjSchedToggle(n)') >= 0 && s.indexOf('enabled: s.enabled === false') >= 0, label + ' 暂停/恢复 = enabled 翻转（声明字段提交，机器状态 host 延续）')
      assert(s.indexOf('decl.anchor = s.anchor') >= 0 && s.indexOf('decl.dow = s.dow') >= 0, label + ' 暂停/恢复保留锚定时刻 anchor/dow（notes-034-sched-time，防丢锚定）')
      assert(s.indexOf("rpc('notes-update', { id: n.id, schedule: decl })") >= 0, label + ' 暂停/恢复走 notes-update schedule')
      assert(s.indexOf('function doInjSchedDel(n)') >= 0 && s.indexOf("rpc('notes-delete', { id: n.id })") >= 0, label + ' 删除 = 软删约定笔记')
      assert(s.indexOf('回收站（可恢复），调度即刻停止') >= 0, label + ' 删除 confirm 文案（软删可恢复 + 调度停止）')
      // Esc 统一关复位 dState
      assert(s.indexOf('memEnableState = null; dState = null; return') >= 0, label + ' Esc 统一关复位 dState')
      // 调度任务区样式
      for (const cls of ['.sched-sec{', '.sched-sec-t{', '.sched-row{', '.sched-row.paused{', '.sched-row-t{', '.sched-freq{', '.sched-target{', '.sched-nf{', '.sched-badge{', '.sched-badge.ok{', '.sched-badge.err{', '.sched-badge.off{', '.sched-acts{', '.sched-act{']) {
        assert(s.indexOf(cls) >= 0, label + ' 缺调度任务区样式：' + cls)
      }
    }
  })

  // ===== 50.4 client（React 面板）：调度区 + 编辑回填经 panelBridge + 调度任务区 + 样式双端 =====
  await t('定时派发 UI（client 开发版 + 发布包）：调度区/编辑回填经 panelBridge + 调度任务区 + 样式双端', () => {
    for (const pair of [['client 开发版', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      // ① store 切片调度字段 + openDispatch 复位 + openDispatchEdit 回填
      assert(s.indexOf("sched: false, schedMode: 'daily', schedN: 3, schedAt: '', editId: '', editNote: null, schedAnchor: '09:00', schedDow: 1") >= 0, label + ' store.modal.dispatch 调度字段（含锚定时刻默认 09:00/周一）')
      assert(s.indexOf('function openDispatchEdit(note)') >= 0, label + ' openDispatchEdit 存在')
      assert(s.indexOf('panelBridge.openDispatchEdit = openDispatchEdit') >= 0, label + ' panelBridge 中转回填（modals 禁横向引用）')
      assert(s.indexOf('if (panelBridge.openDispatchEdit) panelBridge.openDispatchEdit(n)') >= 0, label + ' 注入管理 [编辑] 经 panelBridge 调起')
      // ② 调度区 JSX：单选 + 四模式 + 时间框 + 即时预览（i18n 覆盖卡E：文案走 tt() 字典）
      assert(s.indexOf("' ' + tt('disp.now')") >= 0 && s.indexOf("' ' + tt('disp.scheduled')") >= 0, label + ' 单选 立即派发/定时执行走 tt()（覆盖卡E）')
      assert(s.indexOf("value: 'daily'") >= 0 && s.indexOf("tt('common.schedDaily')") >= 0 && s.indexOf("tt('common.schedWeekly')") >= 0 && s.indexOf("tt('disp.modeNDays')") >= 0 && s.indexOf("tt('disp.modeOnce')") >= 0, label + ' 频率四模式走 tt()（覆盖卡E）')
      assert(s.indexOf("type: 'datetime-local'") >= 0, label + ' 仅一次 datetime-local 输入')
      // ②·b 锚定时刻（notes-034-sched-time）：周期三模式时刻框（type=time）+ 每周星期几下拉 + 声明携 anchor/dow
      assert(s.indexOf("type: 'time'") >= 0, label + ' 周期模式时刻框（type=time）')
      assert(s.indexOf("tt('disp.dowOption', { dow: tt('common.dowNames').split('|')[d] || '' })") >= 0, label + ' 每周星期几下拉走 tt() dowNames 管道（dow 0-6；i18n 覆盖卡E，charAt 形态废止）')
      assert(s.indexOf('setDispatchSchedAnchor') >= 0 && s.indexOf('setDispatchSchedDow') >= 0, label + ' 锚定时刻 setter + 接线')
      assert(s.indexOf('schedAnchorMs(s.anchor) !== null') >= 0, label + ' 编辑回填 anchor/dow（非法回退 09:00）')
      assert(s.indexOf('schedFormDecl(dispatchSchedMode, dispatchSchedN, dispatchSchedAt, dispatchSchedAnchor, dispatchSchedDow)') >= 0, label + ' 表单声明携 anchor/dow 入参')
      assert(s.indexOf("if (mode === 'weekly') return { decl: { every: '1w', anchor: anchor, dow:") >= 0, label + ' 每周声明携 anchor+dow（format.js）')
      assert(s.indexOf("return { decl: { every: '1d', anchor: anchor } }") >= 0 && s.indexOf("return { decl: { every: nn + 'd', anchor: anchor } }") >= 0, label + ' 每天/每 N 天声明携 anchor（format.js）')
      assert(s.indexOf('周期模式需选择触发时刻（HH:MM）') >= 0, label + ' 锚定时刻内联校验文案')
      assert(s.indexOf('decl.anchor = f.decl.anchor') >= 0 && s.indexOf('decl.dow = f.decl.dow') >= 0, label + ' 确认排定携锚定时刻字段提交')
      assert(s.indexOf('schedAnchorNextMs(decl.anchor') >= 0, label + ' 下次触发预览走锚定序列口径')
      assert(s.indexOf('decl.anchor = s.anchor') >= 0 && s.indexOf('decl.dow = s.dow') >= 0, label + ' 暂停/恢复保留锚定时刻 anchor/dow（inject-manager）')
      assert(s.indexOf('schedFormDecl(') >= 0 && s.indexOf('定时时间必须是未来时刻') >= 0, label + ' 内联校验同口径')
      assert(s.indexOf('at: isoToLocalInput(at)') >= 0, label + ' 仅一次提交本地无后缀串（notes-034-at-local-tz，禁 toISOString）')
      // ③ 排定/编辑双通道（创建标题前缀 + contractType 声明 + toast）
      assert(s.indexOf("'定时 ' + (src.title || 'Untitled')") >= 0, label + ' 标题自动「定时 」前缀')
      assert(s.indexOf("contractType: 'dispatch-schedule', schedule: decl") >= 0, label + ' notes-create 携带声明')
      /* i18n 覆盖卡E：排定 toast / 编辑模式文案走 t()/tt() 字典（zh 原串随字典内嵌） */
      assert(s.indexOf("t(dispatchEditId ? 'disp.schedUpdated' : 'disp.schedDone', { time: nextTxt })") >= 0 && s.indexOf("'disp.schedDone': '已排定，下次：{time}'") >= 0 && s.indexOf("'disp.schedUpdated': '已更新排定，下次：{time}'") >= 0, label + ' 排定 toast 走 t()（覆盖卡E）')
      assert(s.indexOf("tt('disp.saveSched')") >= 0 && s.indexOf("tt('disp.editTitle')") >= 0 && s.indexOf("'disp.saveSched': '保存排定'") >= 0 && s.indexOf("'disp.editTitle': '编辑定时任务'") >= 0, label + ' 编辑模式文案走 tt()（覆盖卡E，zh 原串字典内嵌）')
      assert(s.indexOf('原目标会话（当前不在活跃清单）') >= 0, label + ' 编辑模式目标合成条目兜底')
      // ④ 调度任务区（注入管理）
      assert(s.indexOf('dsh-notes-sched-sec') >= 0 && s.indexOf('调度任务（') >= 0, label + ' 调度任务区结构')
      assert(s.indexOf('function doInjSchedToggle(n)') >= 0 && s.indexOf('function doInjSchedDel(n)') >= 0 && s.indexOf('function doInjSchedEdit(n)') >= 0, label + ' 调度任务三操作函数')
      assert(s.indexOf('function schedBadgeEl(n)') >= 0 && s.indexOf('function schedNextLabel(n)') >= 0, label + ' 徽章/下次触发渲染')
      assert(s.indexOf('enabled: s.enabled === false') >= 0, label + ' 暂停/恢复 enabled 翻转')
      assert(s.indexOf('回收站（可恢复），调度即刻停止') >= 0, label + ' 删除 confirm 文案')
    }
    // 手动派发路径零改动（client 开发版 host.call 形态原样保留）
    assert(clientSrc.indexOf("host.call('notes-dispatch', { id: selected, sessionId: dispatchSessId") >= 0, 'client 手动派发 RPC 形态零改动')
    // ⑤ 样式双端（dev styles.css ⇄ 发布包 lib/styles.css）
    const cssDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev], ['发布包 lib/styles.css', cssPkg]]) {
      for (const cls of ['.dsh-notes-sched-box{', '.dsh-notes-sched-opt{', '.dsh-notes-sched-form{', '.dsh-notes-sched-next{', '.dsh-notes-sched-next.warn{', '.dsh-notes-sched-sec{', '.dsh-notes-sched-row{', '.dsh-notes-sched-row.paused{', '.dsh-notes-sched-badge{', '.dsh-notes-sched-badge.ok{', '.dsh-notes-sched-badge.err{', '.dsh-notes-sched-badge.off{', '.dsh-notes-sched-act{']) {
        assert(pair[1].indexOf(cls) >= 0, pair[0] + ' 缺调度样式：' + cls + '（需跑 scripts/build-dist.cjs）')
      }
    }
  })

  // ===== 50.5 原型 mock：写入闸门红线行为 + schedule-eval 到期评估 + slim 携带 + 演示数据 =====
  await t('原型 mock 定时派发：写入闸门红线行为 + schedule-eval + slim 携带 schedule + 演示数据', () => {
    // 结构锚点
    assert(protoV2Src.indexOf('function _mockSchedGate(raw, contractType, existing)') >= 0, '原型 mock 写入闸门函数')
    assert(protoV2Src.indexOf("if (method === 'notes-schedule-eval')") >= 0, '原型 mock 含 notes-schedule-eval（注入时钟到期评估）')
    assert(protoV2Src.indexOf("setInterval(function () { try { var evTick = _mockRpc('notes-schedule-eval', {})") >= 0 && protoV2Src.indexOf('定时调度已触发') >= 0, '原型 mock 常驻 tick（演示加速 15s）+ 触发 toast')
    assert(protoV2Src.indexOf("s.contractType = n.contractType || '';") >= 0 && protoV2Src.indexOf('s.schedule = n.schedule ? JSON.parse(JSON.stringify(n.schedule)) : null;') >= 0, '原型 mock slim 携带 contractType/schedule（调度任务区数据源）')
    assert(protoV2Src.indexOf("sourceLabel: '定时调度 @'") >= 0, '原型 mock 触发来源标注同 host')
    // 演示数据：轮询已触发（lastRun sent 徽章）+ 单次已暂停 + 每天 lastError 失败徽章（锚定时刻演示：n95 每天 09:00）
    assert(protoV2Src.indexOf("id: 'n93', title: '定时 每 3 天一轮 UX 巡检'") >= 0, '原型演示：轮询 3d 已触发（n93）')
    assert(protoV2Src.indexOf("id: 'n94', title: '定时 周报汇总（暂停演示）'") >= 0, '原型演示：单次已暂停（n94）')
    assert(protoV2Src.indexOf("id: 'n95', title: '定时 每日构建状态检查'") >= 0, '原型演示：每天 + lastError（n95）')
    assert(protoV2Src.indexOf("id: 'n95'") >= 0 && /id: 'n95'[\s\S]*?anchor: '09:00'/.test(protoV2Src), '原型演示：n95 携锚定时刻 anchor 09:00（notes-034-sched-time）')
    // 原型 mock schedule-eval 锚定时刻分支（同 host schedDueAt 口径）
    assert(protoV2Src.indexOf('schedAnchorNextMs(s.anchor') >= 0, '原型 mock schedule-eval 锚定时刻分支（every + anchor → 锚定序列到期判定）')
    // 行为级：提取 _mockSchedGate + schedEveryMs eval（_mockSessions 打桩），断言红线与 host 节 48 同口径
    const ns = {}
    new Function('ns', 'var _mockSessions = [{ id: "session-live001-0000-0000-0000-000000000000", live: true }];\n' + grabFn(protoV2Src, 'schedEveryMs', '原型') + '\n' + grabFn(protoV2Src, '_mockSchedGate', '原型') + '\nns.gate = _mockSchedGate')(ns)
    const SID = 'session-live001-0000-0000-0000-000000000000'
    let r = ns.gate({ every: '3d', target: SID }, 'dispatch-schedule', null)
    assert(r.value && r.value.every === '3d' && r.value.enabled === true && r.value.action === 'dispatch', '合法声明归一化（enabled 缺省 true / action dispatch）')
    r = ns.gate({ every: '1m', target: SID }, 'dispatch-schedule', null)
    assert(r.error && r.error.indexOf('5 分钟') >= 0, '轮询 <5min 拒绝（实得 ' + r.error + '）')
    r = ns.gate({ at: '2020-01-01T00:00:00', target: SID }, 'dispatch-schedule', null)
    assert(r.error && r.error.indexOf('未来') >= 0, 'at 过去拒绝（本地无后缀串）')
    // 本地时区闸门（notes-034-at-local-tz，与 host 节 48 同口径）：Z / +08:00 / 负偏移全拒绝，无后缀本地串放行
    r = ns.gate({ at: '2027-01-01T00:00:00.000Z', target: SID }, 'dispatch-schedule', null)
    assert(r.error && r.error.indexOf('禁止 Z/±偏移后缀') >= 0, 'mock 闸门 at 带 Z 后缀拒绝（实得 ' + r.error + '）')
    r = ns.gate({ at: '2027-01-01T00:00:00+08:00', target: SID }, 'dispatch-schedule', null)
    assert(r.error && r.error.indexOf('禁止 Z/±偏移后缀') >= 0, 'mock 闸门 at 带 +08:00 偏移拒绝（实得 ' + r.error + '）')
    r = ns.gate({ at: '2027-01-01T00:00:00-07:00', target: SID }, 'dispatch-schedule', null)
    assert(r.error && r.error.indexOf('禁止 Z/±偏移后缀') >= 0, 'mock 闸门 at 带负偏移拒绝（实得 ' + r.error + '）')
    // 纯日期闸门（notes-034-at-need-time，与 host 节 48 同口径）：YYYY-MM-DD 纯日期拒绝（UTC 午夜歧义），含 T 本地串放行
    r = ns.gate({ at: '2026-10-05', target: SID }, 'dispatch-schedule', null)
    assert(r.error && r.error.indexOf('不接受纯日期') >= 0, 'mock 闸门 at 纯日期拒绝（实得 ' + r.error + '）')
    r = ns.gate({ at: '2027-01-01T00:00:00', target: SID }, 'dispatch-schedule', null)
    assert(r.value && r.value.at === '2027-01-01T00:00:00', 'mock 闸门无后缀本地时间放行（含 T，不受纯日期闸门影响）')
    r = ns.gate({ every: '3d', target: SID, hack: 1 }, 'dispatch-schedule', null)
    assert(r.error && r.error.indexOf('未知字段') >= 0, '未知字段拒绝（无歧义红线）')
    r = ns.gate({ every: '3d', target: 'session-ghost-00000000' }, 'dispatch-schedule', null)
    assert(r.error && r.error.indexOf('不存在或已归档') >= 0, '目标不存在拒绝')
    r = ns.gate({ every: '3d', target: 'session-ghost-00000000', enabled: false }, 'dispatch-schedule', null)
    assert(r.value && r.value.enabled === false, 'enabled=false 豁免存活校验（暂停随时可落）')
    r = ns.gate({ every: '3d', target: SID }, '', null)
    assert(r.error && r.error.indexOf('dispatch-schedule') >= 0, 'schedule 缺契约拒绝（配对不变量）')
    r = ns.gate(null, 'dispatch-schedule', null)
    assert(r.error && r.error.indexOf('同时清除') >= 0, '单清 schedule 保留契约拒绝')
    r = ns.gate(null, '', null)
    assert(r.value === null, '成对清除放行')
    r = ns.gate({ every: '7d', target: SID }, 'dispatch-schedule', { every: '3d', target: SID, lastFiredAt: '2026-10-03T02:00:00.000Z', lastRun: { at: '2026-10-03T02:00:00.000Z', status: 'sent', receiptId: 'x' } })
    assert(r.value && r.value.every === '7d' && r.value.lastFiredAt === '2026-10-03T02:00:00.000Z' && r.value.lastRun && r.value.lastRun.receiptId === 'x', '声明改写机器状态延续（lastFiredAt/lastRun 不清零）')
    // declaredAt 声明重锚（0.4.6-F，notes-046-sched-anchor，同 host 闸门）：首次写入=now / 声明未变更延续 / 声明变更刷新 / 输入伪值剥离
    r = ns.gate({ every: '3d', target: SID, declaredAt: '2020-01-01T00:00:00.000Z' }, 'dispatch-schedule', null)
    assert(r.value && typeof r.value.declaredAt === 'string' && r.value.declaredAt !== '2020-01-01T00:00:00.000Z' && Math.abs(Date.parse(r.value.declaredAt) - Date.now()) < 60000, 'mock 闸门首次写入 declaredAt=now（伪值剥离，实得 ' + r.value.declaredAt + '）')
    r = ns.gate({ every: '3d', target: SID }, 'dispatch-schedule', { every: '3d', target: SID, action: 'dispatch', enabled: true, declaredAt: '2020-01-01T00:00:00.000Z' })
    assert(r.value && r.value.declaredAt === '2020-01-01T00:00:00.000Z', 'mock 闸门声明未变更延续 declaredAt（实得 ' + r.value.declaredAt + '）')
    r = ns.gate({ every: '7d', target: SID }, 'dispatch-schedule', { every: '3d', target: SID, action: 'dispatch', enabled: true, declaredAt: '2020-01-01T00:00:00.000Z' })
    assert(r.value && r.value.declaredAt !== '2020-01-01T00:00:00.000Z' && Math.abs(Date.parse(r.value.declaredAt) - Date.now()) < 60000, 'mock 闸门声明变更刷新 declaredAt=now（实得 ' + r.value.declaredAt + '）')
    // 锚定时刻闸门（notes-034-sched-time，与 host 节 48 同口径）：anchor HH:MM / 整天间隔 / at 互斥 / dow 0-6 + 搭配 anchor + 仅每周
    r = ns.gate({ every: '1d', anchor: '09:00', target: SID }, 'dispatch-schedule', null)
    assert(r.value && r.value.anchor === '09:00' && !('dow' in r.value), 'mock 闸门 anchor 合法放行（每天 09:00）')
    r = ns.gate({ every: '3d', anchor: '08:30', target: SID }, 'dispatch-schedule', null)
    assert(r.value && r.value.anchor === '08:30', 'mock 闸门每 N 天 + anchor 放行')
    r = ns.gate({ every: '1d', anchor: '9:00', target: SID }, 'dispatch-schedule', null)
    assert(r.error && r.error.indexOf('anchor 非法') >= 0, 'mock 闸门 anchor 非严格 HH:MM 拒绝（实得 ' + r.error + '）')
    r = ns.gate({ every: '1d', anchor: '24:00', target: SID }, 'dispatch-schedule', null)
    assert(r.error && r.error.indexOf('anchor 非法') >= 0, 'mock 闸门 anchor 越界拒绝')
    r = ns.gate({ every: '12h', anchor: '09:00', target: SID }, 'dispatch-schedule', null)
    assert(r.error && r.error.indexOf('整天周期') >= 0, 'mock 闸门子日间隔 + anchor 拒绝（实得 ' + r.error + '）')
    r = ns.gate({ at: '2027-01-01T00:00:00', anchor: '09:00', target: SID }, 'dispatch-schedule', null)
    assert(r.error && r.error.indexOf('仅周期模式') >= 0, 'mock 闸门 at + anchor 拒绝（实得 ' + r.error + '）')
    r = ns.gate({ every: '1w', anchor: '09:00', dow: 1, target: SID }, 'dispatch-schedule', null)
    assert(r.value && r.value.dow === 1 && r.value.anchor === '09:00', 'mock 闸门 weekly + anchor + dow 放行')
    r = ns.gate({ every: '1w', anchor: '09:00', dow: 7, target: SID }, 'dispatch-schedule', null)
    assert(r.error && r.error.indexOf('dow 非法') >= 0, 'mock 闸门 dow 越界拒绝')
    r = ns.gate({ every: '1w', anchor: '09:00', dow: '1', target: SID }, 'dispatch-schedule', null)
    assert(r.error && r.error.indexOf('dow 非法') >= 0, 'mock 闸门 dow 字符串拒绝（必须 number）')
    r = ns.gate({ every: '1d', dow: 1, target: SID }, 'dispatch-schedule', null)
    assert(r.error && r.error.indexOf('搭配 anchor') >= 0, 'mock 闸门 dow 缺 anchor 拒绝')
    r = ns.gate({ every: '3d', anchor: '09:00', dow: 1, target: SID }, 'dispatch-schedule', null)
    assert(r.error && r.error.indexOf('仅每周模式') >= 0, 'mock 闸门 dow 非每周间隔拒绝')
    r = ns.gate({ every: '3d', target: SID }, 'dispatch-schedule', null)
    assert(r.value && !('anchor' in r.value) && !('dow' in r.value), 'mock 闸门无 anchor 存量形态零字段迁移（兼容）')
  })
  }
}
