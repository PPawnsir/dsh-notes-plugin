// 节 43. 注入管理面板（设置卡入口 + 总览/直改/批量/过滤/护栏，三端同步零新 RPC）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "43",
  title: "43. 注入管理面板（设置卡入口 + 总览/直改/批量/过滤/护栏，三端同步零新 RPC）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { appSrc, clientPkgSrc, plugin, protoV2Src } = S
  // ===== 43. 注入管理面板（notes-inject-manager：设置卡「注入管理」入口 + 全库注入总览 modal，三端同步零新 RPC）=====
  // 契约：数据源 notes-list {includeLogs:true} slim（inject/injectRole/injectEver/sensitive/kind/injectTo 齐备，零新 RPC）；
  // 三态语义与详情区 ⚡ 分段控件完全一致（off→{inject:false}；约定/资料→{inject:true, injectRole}，payload 禁 undefined）；
  // 单行直改 + 多选批量（confirm 条数，逐条 notes-update，失败计数不中断）；三态过滤 chips（点击=统计过滤）+ 搜索 250ms 防抖；
  // 护栏：kind=log 注入硬禁（勾选/档位禁用 + tooltip），sensitive 允许但行内提示「注入时自动脱敏」；
  // 排序：注入中在前（约定 > 资料），组内 updatedAt 降序；统计行：约定 N / 资料 M / 未注入 K。
  section('43. 注入管理面板（设置卡入口 + 总览/直改/批量/过滤/护栏，三端同步零新 RPC）')

  // ---- 43.1 client 结构断言（开发版 client-impl + 发布包 lib/client.js）----
  await t('注入管理面板（client）：设置行入口 + 总览 modal 结构 + 三态直改 payload + 批量通道 + log/sensitive 护栏（开发版 + 发布包）', () => {
    // ① 设置卡片入口（「注入预览」旁新增「注入管理」行）+ 互斥开 modal
    assert(clientSrc.indexOf("{ key: 'injmgr', label: '注入管理'") >= 0, 'settingsRows 含「注入管理」行')
    assert(clientSrc.indexOf('onClick: openInjectManager') >= 0, '管理按钮接线 openInjectManager')
    assert(clientSrc.indexOf('function openInjectManager()') >= 0 && clientSrc.indexOf('function loadInjectManager()') >= 0, 'openInjectManager/loadInjectManager 存在')
    assert(clientSrc.indexOf('setSettingsOpen(false); setInjMgrOpen(true)') >= 0, '与设置卡片互斥（modal 不叠 modal）')
    // ② 数据源：notes-list {includeLogs:true} slim 零新 RPC（含日志——日志行禁用态展示）
    assert(clientSrc.indexOf("host.call('notes-list', { includeLogs: true })") >= 0, 'loadInjectManager 数据源 notes-list includeLogs（零新 RPC）')
    assert(clientSrc.indexOf("function injMgrRole(n) { return n.inject === true ? (n.injectRole === 'reference' ? 'reference' : 'convention') : 'off' }") >= 0, '三态判定与详情区同口径')
    // ③ 单行直改 payload（同详情区通道 notes-update {inject, injectRole}，off 态不带 injectRole）
    assert(clientSrc.indexOf('async function doInjMgrSet(n, role)') >= 0, 'doInjMgrSet 单行直改存在')
    assert(clientSrc.indexOf("const upd = { id: n.id, inject: role !== 'off' }") >= 0, '直改 payload：inject 三态映射')
    assert(clientSrc.indexOf('if (upd.inject) upd.injectRole = role') >= 0, '非 off 才带 injectRole（payload 禁 undefined）')
    // ④ log 隐身硬禁护栏（函数双保险 + 行档位/勾选禁用 + tooltip）+ sensitive 行内提示
    assert(clientSrc.indexOf("if ((n.kind || 'note') === 'log' && role !== 'off') return") >= 0, 'log 隐身硬禁双保险（doInjMgrSet 拦截）')
    assert(clientSrc.indexOf("const dis = (n.kind || 'note') === 'log' && r !== 'off'") >= 0 && clientSrc.indexOf("日志默认隐身：inject 强制关闭（kind=log 硬禁）") >= 0, 'log 行约定/资料档禁用 + tooltip')
    assert(clientSrc.indexOf('disabled: isLog || injMgrPending') >= 0 && clientSrc.indexOf('不参与注入批量操作') >= 0, 'log 行勾选禁用 + tooltip')
    assert(clientSrc.indexOf('注入时自动脱敏') >= 0 && clientSrc.indexOf('dsh-notes-injmgr-sens') >= 0, 'sensitive 行内提示「注入时自动脱敏」')
    // ⑤ 曾注入徽章（injectEver 粘性，当前已注入不重复显示）+ 作用域摘要（全局显示「全局」）
    assert(clientSrc.indexOf("n.injectEver === true && !n.inject ? e('span', { className: 'dsh-notes-injmgr-ever dsh-nt'") >= 0, '曾注入徽章（injectEver 且当前未注入才显示）')
    assert(clientSrc.indexOf("function injMgrScopeLabel(injectTo)") >= 0 && clientSrc.indexOf("return arr.length === 0 ? '全局' : arr.length + ' 个会话'") >= 0, '作用域摘要（injectTo 数 / 全局）')
    // ⑥ 统计 chips（点击=过滤）+ 排序（注入中在前：约定>资料，组内 updatedAt 降序）+ 搜索 250ms 防抖
    assert(clientSrc.indexOf("chipBtn('convention', '约定 ' + cntConv)") >= 0 && clientSrc.indexOf("chipBtn('reference', '资料 ' + cntRef)") >= 0 && clientSrc.indexOf("chipBtn('off', '未注入 ' + cntOff)") >= 0, '顶部统计 chips（约定 N / 资料 M / 未注入 K）')
    assert(clientSrc.indexOf("const injMgrWeight = { convention: 0, reference: 1, off: 2 }") >= 0, '排序权重：约定 > 资料 > 未注入')
    assert(clientSrc.indexOf("String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))") >= 0, '组内 updatedAt 降序')
    assert(clientSrc.indexOf('timer.debounce(() => setInjMgrQ(injMgrSearchRef.current.trim().toLowerCase()), 250)') >= 0, '搜索 250ms 防抖（与列表搜索同口径）')
    // ⑦ 批量通道：confirm 条数 → 逐条 notes-update（失败计数不中断）→ 清选刷新
    assert(clientSrc.indexOf('async function doInjMgrBatch(role)') >= 0, 'doInjMgrBatch 存在')
    assert(clientSrc.indexOf("'批量' + label + '：所选的 ' + ids.length + ' 条笔记将") >= 0, '批量 confirm 含条数')
    assert(clientSrc.indexOf("catch (err) { fail++ }") >= 0 && clientSrc.indexOf("setInjMgrPending(false); setInjMgrSel({})") >= 0, '批量逐条失败计数不中断 + 完成后清选')
    assert(clientSrc.indexOf("doInjMgrBatch('convention')") >= 0 && clientSrc.indexOf("doInjMgrBatch('reference')") >= 0 && clientSrc.indexOf("doInjMgrBatch('off')") >= 0, '批量三档按钮（设为约定/设为资料/关闭注入）')
    // ⑧ modal 结构类 + Esc 链路 + 全局错误条排除
    for (const cls of ['dsh-notes-injmgr-modal', 'dsh-notes-injmgr-chips', 'dsh-notes-injmgr-search', 'dsh-notes-injmgr-batch', 'dsh-notes-injmgr-list', 'dsh-notes-injmgr-row', 'dsh-notes-injmgr-seg', 'dsh-notes-injmgr-opt']) {
      assert(clientSrc.indexOf(cls) >= 0, '注入管理 modal 结构类：' + cls)
    }
    assert(clientSrc.indexOf('if (injMgrOpenRef.current) { setInjMgrOpen(false); return }') >= 0, 'Esc 链路关注入管理面板')
    assert(clientSrc.indexOf('!memOpen && !injMgrOpen') >= 0, '全局错误条排除注入管理 modal（modal 内自显错误）')
    // ⑨ 发布包 lib/client.js 同步（需先跑 scripts/build-dist.cjs）
    for (const k of ['openInjectManager', 'loadInjectManager', 'doInjMgrSet', 'doInjMgrBatch', 'injMgrRole', 'injMgrScopeLabel', 'dsh-notes-injmgr-list', 'dsh-notes-injmgr-opt', '注入管理', 'injMgrOpenRef']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺「' + k + '」（需先跑 scripts/build-dist.cjs）')
    }
  })
  await t('注入管理样式双端：styles.css ⇄ 发布包 lib/styles.css', () => {
    const cssDevM = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkgM = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDevM], ['发布包 lib/styles.css', cssPkgM]]) {
      for (const cls of ['.dsh-notes-injmgr-modal{', '.dsh-notes-injmgr-chip{', '.dsh-notes-injmgr-chip.on{', '.dsh-notes-injmgr-search{', '.dsh-notes-injmgr-batch{', '.dsh-notes-injmgr-list{', '.dsh-notes-injmgr-row{', '.dsh-notes-injmgr-ti{', '.dsh-notes-injmgr-scope{', '.dsh-notes-injmgr-sens{', '.dsh-notes-injmgr-ever{', '.dsh-notes-injmgr-seg{', '.dsh-notes-injmgr-opt{', '.dsh-notes-injmgr-opt.on{', '.dsh-notes-injmgr-opt.dis{']) {
        assert(pair[1].indexOf(cls) >= 0, pair[0] + ' 缺注入管理样式：' + cls + '（需跑 scripts/build-dist.cjs）')
      }
    }
  })

  // ---- 43.2 app.html / 原型 notes-ui-v2.html 同步（UI 唯一规格来源约束）----
  await t('app.html + 原型注入管理同款：设置行入口 + 三态直改/批量 payload + log 禁用护栏 + 统计 chips（双端 UI 标记一致）', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('id="setInjectManager"') >= 0, label + ' 设置卡片「注入管理」入口')
      assert(s.indexOf("$('setInjectManager').onclick = function () { openInjectManager() };") >= 0, label + ' 入口接线')
      assert(s.indexOf('function openInjectManager()') >= 0 && s.indexOf('function loadInjectManager()') >= 0 && s.indexOf('function renderInjectManager()') >= 0, label + ' 管理三函数')
      assert(s.indexOf("rpc('notes-list', { includeLogs: true })") >= 0, label + ' 数据源 notes-list includeLogs（零新 RPC）')
      assert(s.indexOf("function injMgrRole(n) { return n.inject === true ? (n.injectRole === 'reference' ? 'reference' : 'convention') : 'off' }") >= 0, label + ' 三态判定与详情区同口径')
      // 单行直改 payload + log 隐身硬禁护栏（函数双保险 + 行档位/勾选禁用）
      assert(s.indexOf('function doInjMgrSet(n, role)') >= 0, label + ' doInjMgrSet 单行直改存在')
      assert(s.indexOf("var upd = { id: n.id, inject: role !== 'off' };") >= 0, label + ' 直改 payload：inject 三态映射')
      assert(s.indexOf('if (upd.inject) upd.injectRole = role;') >= 0, label + ' 非 off 才带 injectRole（payload 禁 undefined）')
      assert(s.indexOf("if ((n.kind || 'note') === 'log' && role !== 'off') return;") >= 0, label + ' log 隐身硬禁双保险（doInjMgrSet 拦截）')
      assert(s.indexOf('日志默认隐身：inject 强制关闭（kind=log 硬禁）') >= 0 && s.indexOf("var dis = isLog && r !== 'off';") >= 0, label + ' log 行约定/资料档禁用 + title 提示')
      assert(s.indexOf('不参与注入批量操作') >= 0, label + ' log 行勾选禁用 + title 提示')
      assert(s.indexOf('注入时自动脱敏') >= 0 && s.indexOf('injmgr-sens') >= 0, label + ' sensitive 行内提示「注入时自动脱敏」')
      // 统计 chips（点击=过滤）+ 排序 + 搜索防抖 + 批量 confirm 条数 + 逐条失败计数不中断
      assert(s.indexOf("['convention', '约定 ' + cntConv]") >= 0 && s.indexOf("['reference', '资料 ' + cntRef]") >= 0 && s.indexOf("['off', '未注入 ' + cntOff]") >= 0, label + ' 顶部统计 chips（约定 N / 资料 M / 未注入 K）')
      assert(s.indexOf('var w = { convention: 0, reference: 1, off: 2 };') >= 0, label + ' 排序权重：约定 > 资料 > 未注入')
      assert(s.indexOf('}, 250);') >= 0 && s.indexOf('injMgrSearchTimer') >= 0, label + ' 搜索 250ms 防抖')
      assert(s.indexOf('function doInjMgrBatch(role)') >= 0 && s.indexOf("'批量' + label + '：所选的 ' + ids.length + ' 条笔记将") >= 0, label + ' 批量 confirm 含条数')
      assert(s.indexOf("function (res) { if (res && res.error) fail++; else ok++ }") >= 0, label + ' 批量逐条失败计数不中断')
      assert(s.indexOf("doInjMgrBatch('convention')") >= 0 && s.indexOf("doInjMgrBatch('reference')") >= 0 && s.indexOf("doInjMgrBatch('off')") >= 0, label + ' 批量三档按钮（设为约定/设为资料/关闭注入）')
      // modal 结构类 + 宽 modal 样式 + Esc 统一关
      assert(s.indexOf('.modal.injmgr{') >= 0 && s.indexOf('injmgr-list') >= 0 && s.indexOf('injmgr-seg') >= 0 && s.indexOf('injmgr-opt') >= 0, label + ' 注入管理 modal 结构类')
      assert(s.indexOf('trashState = null; injMgrState = null; suggestState = null;') >= 0, label + ' Esc 统一关（modalHost 链路，injMgrState 复位）')
    }
    // 双端 UI 标记一致（共享 DOM id / 函数名 / 样式类）
    for (const k of ['setInjectManager', 'openInjectManager', 'loadInjectManager', 'renderInjectManager', 'injMgrState', 'injMgrRole', 'injMgrScopeLabel', 'injMgrShownList', 'doInjMgrSet', 'doInjMgrBatch', 'toggleInjMgrSel', 'toggleInjMgrAll', 'injMgrChips', 'injMgrSearch', 'injMgrBody', 'injMgrAll', 'injMgrBatchConv', 'injMgrBatchRef', 'injMgrBatchOff', 'injmgr-check', 'injmgr-opt', 'injmgr-sens', 'injmgr-ever', 'injmgr-scope']) {
      assert(protoV2Src.indexOf(k) >= 0 && appSrc.indexOf(k) >= 0, '注入管理 UI 标记双端一致：' + k)
    }
    // 原型 mock：notes-update 日志隐身硬闸（契约同 host _update）+ injectEver 单向粘性 + injectForcedOff 回执
    assert(protoV2Src.indexOf("if ((a.kind || n.kind) === 'log' && n.inject === true) { n.inject = false; injForcedOff = true }") >= 0, '原型 mock notes-update 日志隐身硬闸（契约同 host _update）')
    assert(protoV2Src.indexOf('ru.injectForcedOff = true') >= 0, '原型 mock 回 injectForcedOff（硬闸命中告知）')
    assert(protoV2Src.indexOf('if (a.inject === true && !injForcedOff) n.injectEver = true;') >= 0, '原型 mock injectEver 单向粘性（开启即曾注入）')
    // 原型演示数据覆盖：约定注入 n7 / 资料注入 n6 / 曾注入 n3 / 敏感 n4 / 日志 n83（三态/徽章/护栏全要素演示）
    assert(protoV2Src.indexOf("id: 'n7', title: '不动工约定', kind: 'decision', topic: '其他', folder: '', status: 'pinned', inject: true") >= 0, '原型 mock 含约定注入演示（n7）')
    assert(protoV2Src.indexOf("inject: true, injectRole: 'reference', injectTo: []") >= 0, '原型 mock 含资料注入演示（n6）')
    assert(protoV2Src.indexOf("tags: ['quick'], injectEver: true") >= 0, '原型 mock 含曾注入演示（n3）')
    assert(protoV2Src.indexOf('recall: true, sensitive: true, tags: []') >= 0, '原型 mock 含敏感演示（n4）')
    assert(protoV2Src.indexOf("id: 'n83', title: '工作日志 · deepseek-work · 2026-09-14', kind: 'log'") >= 0, '原型 mock 含日志演示（n83，隐身硬禁行）')
  })
  }
}
