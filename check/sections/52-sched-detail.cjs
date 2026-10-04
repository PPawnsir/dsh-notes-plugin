// 节 52. 定时派发·详情派发计划块 + 关联调度清单（notes-034-sched-detail；证据 n-mutmkdxhid05 缺陷②）
// 设计定稿（主窗口调研笔记 + 分步执行计划 2026-10-04，依赖节 48 执行层 + 节 50 设置交互 UI）：
//   ①详情 meta 尾部「派发计划」块（app.html renderMeta / client editor.js meta JSX 双端 + 原型镜像）：
//     本笔记 contractType=dispatch-schedule 时渲染 频率人话（schedFreqLabel）/目标会话（shortSid）/下次触发（schedNextMs 本地渲染）/
//     上次结果徽章（复用注入管理 schedBadgeHtml 同口径）/暂停态；数据源 = notes-list slim 既有 contractType/schedule 字段（零新 RPC）。
//   ②关联调度清单：标题去「定时」前缀匹配（schedPeerKey/relatedScheds）列出指向同一待办的其他调度约定
//     （频率+下次+暂停态，≤5 条），点击走既有 selectNote 跳转——多调度同一待办可观察（双向：调度互见 sibling / 待办见其调度）。
//   ③数据源兜底：常态复用 notes slim 缓存（零新 RPC）；仅 log 型调度约定（front-matter 裸编辑旁路）被默认口径排除时，
//     会话级按需一次 notes-list {includeLogs:true} overlay 合并（notes 优先）。
//   红线：无调度笔记零渲染（空串/null = 零 DOM 痕迹）。
// 测试策略：三端锚点（appSrc/clientSrc/clientPkgSrc + 原型 protoV2Src）+ 关联匹配/渲染守卫行为级断言（grabFn 提取 eval，依赖打桩）
//   + app⇄原型函数逐字节一致 + 样式三端。
module.exports = {
  id: "52",
  title: "52. 定时派发·详情计划块（派发计划 + 关联调度清单，三端同步 + 零渲染红线）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, SRC_STYLES, clientSrc } = H
  section('52. 定时派发·详情计划块（派发计划 + 关联调度清单，三端同步 + 零渲染红线）')

  const appSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
  const protoV2Src = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
  const clientPkgSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
  const grabFn = (s, name, tag) => { const m = s.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}')); assert(m, tag + ' 缺 ' + name + '()'); return m && m[0] }

  // ===== 52.1 关联匹配逻辑：行为级 eval（grabFn 提取）+ app⇄原型逐字节一致 =====
  await t('关联匹配 schedPeerKey/relatedScheds 行为级：去前缀 / 双向视角 / 自身排除 / 非法零命中 + app⇄原型逐字节一致', () => {
    for (const fn of ['schedPeerKey', 'relatedScheds', 'schedPlanHtml', 'schedPeerSource', 'ensureSchedPeers']) {
      assert.strictEqual(grabFn(appSrc, fn, 'app.html'), grabFn(protoV2Src, fn, '原型'), 'app.html ⇄ 原型 ' + fn + ' 逐字节一致')
    }
    const ns = {}
    new Function('ns', grabFn(appSrc, 'schedPeerKey', 'app.html') + '\n' + grabFn(appSrc, 'relatedScheds', 'app.html') + '\nns.schedPeerKey = schedPeerKey; ns.relatedScheds = relatedScheds')(ns)
    // 匹配键：有「定时」前缀去除 / 无前缀原样 / 前后空白 trim / 空值零键
    assert.strictEqual(ns.schedPeerKey('定时 每 3 天一轮 UX 巡检'), '每 3 天一轮 UX 巡检', '有定时前缀 → 去除')
    assert.strictEqual(ns.schedPeerKey('每 3 天一轮 UX 巡检'), '每 3 天一轮 UX 巡检', '无前缀 → 原样（待办视角匹配键）')
    assert.strictEqual(ns.schedPeerKey('定时'), '', '纯前缀 → 空键（防全库互撞）')
    assert.strictEqual(ns.schedPeerKey(''), '', '空标题 → 空键')
    assert.strictEqual(ns.schedPeerKey(null), '', 'null 标题 → 空键')
    const S1 = { id: 'n-s1', title: '定时 巡检', contractType: 'dispatch-schedule', schedule: { every: '1d', target: 'session-a' } }
    const S2 = { id: 'n-s2', title: '定时 巡检', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'session-b' } }
    const S3 = { id: 'n-s3', title: '定时 周报', contractType: 'dispatch-schedule', schedule: { every: '1w', target: 'session-a' } }
    const PLAIN = { id: 'n-p1', title: '巡检' }                                        // 普通待办（无契约）
    const NOSCHED = { id: 'n-s4', title: '定时 巡检', contractType: 'dispatch-schedule' }  // 缺 schedule 字段（配对不变量防御）
    const DEL = { id: 'n-s5', title: '定时 巡检', contractType: 'dispatch-schedule', schedule: { every: '1d', target: 'session-a' }, deleted: true }
    const ALL = [S1, S2, S3, PLAIN, NOSCHED, DEL]
    // ①调度约定视角：互见 sibling（自身排除 + 异待办排除 + 缺 schedule/已删排除）
    const r1 = ns.relatedScheds(S1, ALL)
    assert.strictEqual(r1.length, 1, '调度视角：只见另一同待办调度（实得 ' + r1.length + '）')
    assert.strictEqual(r1[0] && r1[0].id, 'n-s2', '调度视角：自身/异键/缺 schedule/已删全排除')
    // ②待办视角：见其全部调度（多调度同一待办可观察）
    const r2 = ns.relatedScheds(PLAIN, ALL)
    assert.strictEqual(r2.length, 2, '待办视角：两条「定时 巡检」调度全列出（实得 ' + r2.length + '）')
    assert(r2.some(n => n.id === 'n-s1') && r2.some(n => n.id === 'n-s2'), '待办视角：s1+s2 均命中')
    // ③零命中口径：null / 空键 / 空列表 / 无匹配
    assert.deepStrictEqual(ns.relatedScheds(null, ALL), [], 'cur=null → []')
    assert.deepStrictEqual(ns.relatedScheds({ id: 'x', title: '定时' }, ALL), [], '空键 → []（纯前缀标题不引发全库互撞）')
    assert.deepStrictEqual(ns.relatedScheds(S1, []), [], '空列表 → []')
    assert.deepStrictEqual(ns.relatedScheds(S1, null), [], 'null 列表 → []')
    assert.deepStrictEqual(ns.relatedScheds(S3, ALL), [], '异待办调度 → []')
    // client 侧同口径锚点（format.js 箭头函数镜像，开发版 + 发布包）
    for (const pair of [['client 开发版', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('const schedPeerKey = (title) =>') >= 0, label + ' 缺 schedPeerKey（format.js）')
      assert(s.indexOf('const relatedScheds = (cur, list) =>') >= 0, label + ' 缺 relatedScheds（format.js）')
      assert(s.indexOf("replace(/^定时\\s*/, '').trim()") >= 0, label + ' 匹配键去前缀同口径')
      assert(s.indexOf("n.id !== cur.id && (n.contractType || '') === 'dispatch-schedule' && n.schedule && !n.deleted && schedPeerKey(n.title) === key") >= 0, label + ' 关联过滤谓词与 app 同口径')
    }
  })

  // ===== 52.2 计划块渲染锚点（app.html + 原型）：renderMeta 尾部挂载 + 五字段 + 点击跳转 + 兜底 =====
  await t('详情计划块渲染锚点（app.html + 原型）：renderMeta 尾部挂载 + 计划五字段 + 关联清单 ≤5 + 点击跳转 + includeLogs 兜底', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      // ① renderMeta 尾部挂载：spHtml 计算 + 零渲染守卫（空串不触发兜底）+ 尾部拼接
      assert(s.indexOf('var spHtml = schedPlanHtml(n, schedPeerSource());') >= 0, label + ' renderMeta 计算计划块 HTML')
      assert(s.indexOf('if (spHtml) ensureSchedPeers();') >= 0, label + ' 无调度零渲染口径：空串不触发兜底拉取')
      assert(s.indexOf("    + spHtml;") >= 0, label + ' 计划块拼接在 meta 尾部')
      // ② 计划块五字段：频率人话 / 目标会话 / 下次触发 / 上次结果徽章 / 暂停态（复用注入管理同口径函数）
      const planFn = grabFn(s, 'schedPlanHtml', label)
      assert(planFn.indexOf("=== 'dispatch-schedule'") >= 0, label + ' 契约分型判定 contractType=dispatch-schedule')
      assert(planFn.indexOf('schedFreqLabel(s)') >= 0, label + ' 频率人话（schedFreqLabel）')
      assert(planFn.indexOf('shortSid(s.target)') >= 0, label + ' 目标会话截短显示')
      assert(planFn.indexOf('schedNextLabel(n)') >= 0 && planFn.indexOf('schedNextLabel(p)') >= 0, label + ' 下次触发（自身 + 关联行，schedNextMs 本地渲染口径）')
      assert(planFn.indexOf('schedBadgeHtml(n)') >= 0, label + ' 上次结果徽章（复用注入管理同口径）')
      assert(planFn.indexOf("'<span class=\"sched-badge off\">已暂停</span>'") >= 0, label + ' 暂停态徽章（自身行 + 关联行同款）')
      assert(planFn.indexOf("paused ? ' paused' : ''") >= 0, label + ' 暂停行置灰')
      assert(planFn.indexOf('.slice(0, 5)') >= 0, label + ' 关联清单 ≤5 条')
      // ③ 文案锚点
      assert(s.indexOf('派发计划</span>') >= 0 && s.indexOf('关联调度</span>') >= 0, label + ' 计划块/关联行标题文案')
      assert(s.indexOf('跳转到调度约定「') >= 0, label + ' 关联行跳转 tooltip')
      // ④ 点击跳转：既有 selectNote 链路（data-sid 携带目标 id）
      assert(s.indexOf("$('edMeta').querySelectorAll('.sched-peer')") >= 0 && s.indexOf("selectNote(el.getAttribute('data-sid'))") >= 0, label + ' 关联调度点击走既有 selectNote 跳转')
      // ⑤ 数据源兜底（③）：会话级按需一次 includeLogs + overlay 合并 notes 优先
      const srcFn = grabFn(s, 'schedPeerSource', label)
      assert(srcFn.indexOf('if (!schedPeerCache) return notes;') >= 0, label + ' 常态复用 notes slim 缓存（零新 RPC）')
      assert(srcFn.indexOf('!inList[n.id]') >= 0, label + ' overlay 只补缓存外条目（notes 优先）')
      const ensFn = grabFn(s, 'ensureSchedPeers', label)
      assert(ensFn.indexOf('if (schedPeerTried) return;') >= 0, label + ' 会话级按需一次（tried 闸）')
      assert(ensFn.indexOf("rpc('notes-list', { includeLogs: true })") >= 0, label + ' 兜底 = notes-list includeLogs（既有 RPC，零新增）')
      assert(ensFn.indexOf("(n.kind || 'note') === 'log'") >= 0, label + ' 缓存已含 log 行时跳过兜底（已是全量口径）')
      // ⑥ 计划块样式（app 壳/原型内联）
      for (const cls of ['.sched-plan{', '.sched-plan-row{', '.sched-plan-row.paused{', '.sched-plan-t{', '.sched-peer{', '.sched-peer:hover{', '.sched-peer-t{']) {
        assert(s.indexOf(cls) >= 0, label + ' 缺计划块样式：' + cls)
      }
    }
  })

  // ===== 52.3 渲染守卫行为级（eval schedPlanHtml 打桩依赖）：无调度零渲染红线 + 双块输出 =====
  await t('计划块渲染守卫行为级：无调度笔记零渲染（空串）+ 调度笔记出计划块 + 待办出关联清单 + ≤5 截断', () => {
    const ns = {}
    new Function('ns',
      'function esc(s){return String(s==null?"":s)}\nfunction icon(){return ""}\nfunction shortSid(s){return String(s||"").slice(0,8)}\n'
      + 'function schedFreqLabel(){return "每天 09:00"}\nfunction schedNextLabel(){return "下次 2026-10-05 09:00"}\nfunction schedBadgeHtml(){return \'<span class="sched-badge">未触发</span>\'}\n'
      + grabFn(appSrc, 'schedPeerKey', 'app.html') + '\n' + grabFn(appSrc, 'relatedScheds', 'app.html') + '\n' + grabFn(appSrc, 'schedPlanHtml', 'app.html')
      + '\nns.schedPlanHtml = schedPlanHtml')(ns)
    // 零渲染红线：普通笔记 / null / 缺 schedule 的契约笔记（配对不变量防御）→ 全空串（零 DOM 痕迹）
    assert.strictEqual(ns.schedPlanHtml({ id: 'n1', title: '普通笔记' }, []), '', '无调度笔记零渲染（空串）')
    assert.strictEqual(ns.schedPlanHtml(null, []), '', 'null 笔记零渲染')
    assert.strictEqual(ns.schedPlanHtml({ id: 'n2', title: '定时 X', contractType: 'dispatch-schedule' }, []), '', '缺 schedule 字段零渲染（防御）')
    // 调度约定 → 计划块（含五字段锚点 + 暂停态）
    const SCHED = { id: 'n-s1', title: '定时 巡检', contractType: 'dispatch-schedule', schedule: { every: '1d', anchor: '09:00', target: 'session-abc' } }
    const h1 = ns.schedPlanHtml(SCHED, [SCHED])
    assert(h1.indexOf('<div class="sched-plan">') === 0 && h1.indexOf('派发计划') >= 0, '调度约定渲染计划块')
    assert(h1.indexOf('session-abc'.slice(0, 8)) >= 0, '计划块含目标会话截短')
    assert(h1.indexOf('sched-badge') >= 0, '计划块含上次结果徽章')
    assert(h1.indexOf('关联调度') < 0, '无关联时不出关联行')
    const h1p = ns.schedPlanHtml({ id: 'n-s1', title: '定时 巡检', contractType: 'dispatch-schedule', schedule: { every: '1d', target: 'session-abc', enabled: false } }, [])
    assert(h1p.indexOf('paused') >= 0 && h1p.indexOf('已暂停') >= 0, '暂停态：行置灰 + 黄徽章')
    // 待办视角 → 关联清单（两条调度全列出，行携 data-sid）
    const SA = { id: 'n-a', title: '定时 巡检', contractType: 'dispatch-schedule', schedule: { every: '1d', target: 'session-a' } }
    const SB = { id: 'n-b', title: '定时 巡检', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'session-b', enabled: false } }
    const TODO = { id: 'n-t', title: '巡检' }
    const h2 = ns.schedPlanHtml(TODO, [SA, SB, TODO])
    assert(h2.indexOf('派发计划') < 0 && (h2.match(/关联调度/g) || []).length === 2, '待办视角：两条关联调度行（无计划块）')
    assert(h2.indexOf('data-sid="n-a"') >= 0 && h2.indexOf('data-sid="n-b"') >= 0, '关联行携目标 id（点击跳转数据源）')
    assert(h2.indexOf('已暂停') >= 0, '关联行暂停态徽章')
    // ≤5 截断：6 条同待办调度 → 只渲染 5 条
    const six = [1, 2, 3, 4, 5, 6].map(i => ({ id: 'n-x' + i, title: '定时 巡检', contractType: 'dispatch-schedule', schedule: { every: '1d', target: 'session-x' } }))
    const h3 = ns.schedPlanHtml(SCHED, [SCHED].concat(six))
    assert((h3.match(/关联调度/g) || []).length === 5, '关联清单 ≤5 条截断（实得 ' + (h3.match(/关联调度/g) || []).length + '）')
  })

  // ===== 52.4 client（React 面板）：meta JSX 计划块 + 关联清单 + 兜底 effect + 样式双端 =====
  await t('详情计划块（client 开发版 + 发布包）：meta JSX 五字段 + 关联清单 ≤5 + selectNote 跳转 + includeLogs 兜底 + 样式双端', () => {
    for (const pair of [['client 开发版', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      // ① meta JSX 挂载：零渲染守卫（null = 零 DOM 痕迹）+ 容器类
      assert(s.indexOf("(curIsSched || schedPeers.length) ? e('div', { className: 'dsh-notes-sched-plan' }") >= 0, label + ' meta 尾部计划块容器（条件渲染，无调度 null 零 DOM）')
      assert(s.indexOf("const curIsSched = !!(curNote && (curNote.contractType || '') === 'dispatch-schedule' && curNote.schedule)") >= 0, label + ' 契约分型判定')
      assert(s.indexOf('relatedScheds(curNote, schedPeerSource()).slice(0, 5)') >= 0, label + ' 关联清单数据源 + ≤5 截断')
      // ② 计划块五字段：schedFreqLabel / shortSid / schedPlanNextLabel（schedNextMs 本地渲染）/ schedPlanBadgeEl / 已暂停
      assert(s.indexOf('schedFreqLabel(curNote.schedule)') >= 0, label + ' 频率人话')
      assert(s.indexOf("shortSid(curNote.schedule.target)") >= 0, label + ' 目标会话截短')
      assert(s.indexOf('function schedPlanNextLabel(n)') >= 0 && s.indexOf('const ms = schedNextMs(n)') >= 0, label + ' 下次触发本地渲染（schedNextMs 同 host 口径）')
      assert(s.indexOf('function schedPlanBadgeEl(n)') >= 0 && s.indexOf('schedPlanBadgeEl(curNote)') >= 0, label + ' 上次结果徽章（注入管理同口径镜像）')
      assert(s.indexOf("'已暂停'") >= 0 && s.indexOf('已触发（单次）') >= 0, label + ' 暂停态 / 单次已触发文案')
      // ③ 关联行：标题 + 点击 selectNote 跳转
      assert(s.indexOf("'关联调度'") >= 0 && s.indexOf("'派发计划'") >= 0, label + ' 行标题文案')
      assert(s.indexOf('跳转到调度约定「') >= 0, label + ' 关联行 tooltip')
      assert(s.indexOf('const t = notes.find(x => x.id === p.id); if (t) selectNote(t)') >= 0, label + ' 关联调度点击走既有 selectNote 跳转')
      // ④ 兜底 effect：会话级按需一次 includeLogs（既涉及调度才触发；缓存含 log 行跳过）
      assert(s.indexOf('schedPeerTriedRef.current = true') >= 0 && s.indexOf('schedPeerCacheRef.current = res.notes') >= 0, label + ' 兜底缓存 tried 闸 + overlay 回填')
      assert(s.indexOf("if (notes.some(n => (n.kind || 'note') === 'log')) return   // 缓存已是 includeLogs 口径（含 log 行），主缓存即全量") >= 0, label + ' 缓存全量口径跳过兜底')
      assert(s.indexOf('function schedPeerSource()') >= 0 && s.indexOf('!inList[n.id]') >= 0, label + ' overlay 合并 notes 优先')
    }
    // 兜底 RPC 形态零新增（notes-list includeLogs 既有通道）
    assert(clientSrc.indexOf("host.call('notes-list', { includeLogs: true })") >= 0, 'client 兜底走既有 notes-list includeLogs（零新 RPC）')
    // ⑤ 样式双端（dev styles.css ⇄ 发布包 lib/styles.css）
    const cssDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev], ['发布包 lib/styles.css', cssPkg]]) {
      for (const cls of ['.dsh-notes-sched-plan{', '.dsh-notes-sched-plan-row{', '.dsh-notes-sched-plan-row.paused{', '.dsh-notes-sched-plan-t{', '.dsh-notes-sched-peer{', '.dsh-notes-sched-peer:hover{', '.dsh-notes-sched-peer-t{']) {
        assert(pair[1].indexOf(cls) >= 0, pair[0] + ' 缺计划块样式：' + cls + '（需跑 scripts/build-dist.cjs）')
      }
    }
  })
  }
}
