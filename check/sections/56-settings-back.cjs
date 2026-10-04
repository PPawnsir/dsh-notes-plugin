// 节 56. 设置卡二级面板返回栈（notes-041-settings-back：注入管理/启用引导关闭后自动回设置卡，单层，双端+原型）
// 反馈 n-mut4n94k4l3l：设置卡二级面板关闭后直接回主页、无返回栈。
// 机制：app 端 modal 框架单层返回栈（modalBackTo/modalBackScroll，closeModal 消费 + openSettings 还原滚动）；
//      client 端模块级 backRef 镜像 + closeInjMgr/closeMemEnable 统一关闭入口（✕/取消/点遮罩/Esc/启用成功同口径）经 panelBridge.openSettings 重开设置卡。
// 红线：单层够用不引入多层通用栈（YAGNI）；Esc 语义保持「关当前层」（返回栈是关闭后的去向）；调度编辑回填（doInjSchedEdit）清栈不返回。
module.exports = {
  id: "56",
  title: "56. 设置卡二级面板返回栈（notes-041-settings-back：注入管理/启用引导关闭回设置卡，单层，双端+原型）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { appSrc, clientPkgSrc, plugin, protoV2Src } = S
  section('56. 设置卡二级面板返回栈（notes-041-settings-back：注入管理/启用引导关闭回设置卡，单层，双端+原型）')

  // ---- 56.1 app.html + 原型 notes-ui-v2.html：框架单层栈 + 入口 from 接线 + 滚动还原（双端 UI 标记一致）----
  await t('设置卡返回栈（app.html + 原型）：modalBackTo 单层栈 + from=settings 入口接线 + 滚动还原（双端标记一致）', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      // ① 框架：单层返回栈变量 + openModal 清来源（其余 modal 行为不变）+ closeModal 消费（非返回路径清滚动存档）
      assert(s.indexOf('var modalBackTo = null;') >= 0 && s.indexOf('var modalBackScroll = 0;') >= 0, label + ' 单层返回栈变量（modalBackTo/modalBackScroll）')
      assert(s.indexOf('换 modal 即清返回来源') >= 0, label + ' openModal 换 modal 即清返回来源')
      assert(s.indexOf("if (back === 'settings') openSettings(); else modalBackScroll = 0;") >= 0, label + ' closeModal 单层返回消费（重开设置卡 / 非返回路径清滚动存档）')
      // ② 两个二级面板：from 形参 + openModal 后按来源挂载（各 1 处，共 2 处）
      assert(s.indexOf('function openInjectManager(from)') >= 0 && s.indexOf('function openMemEnable(from)') >= 0, label + ' 二级面板 from 形参')
      assert((s.match(/if \(from === 'settings'\) \{ modalBackTo = 'settings'; modalBackScroll = backScroll \}/g) || []).length === 2, label + ' 两个二级面板均挂载返回来源（注入管理 + 启用引导）')
      assert(s.indexOf("var backScroll = from === 'settings' && $('modal') ? $('modal').scrollTop : 0;") >= 0, label + ' 进入二级前存档设置卡滚动位置')
      // ③ 设置卡入口接线 from='settings' + openSettings 滚动还原（一次性消费）
      assert(s.indexOf("$('setInjectManager').onclick = function () { openInjectManager('settings') };") >= 0, label + ' 注入管理入口 from=settings')
      assert(s.indexOf("$('memEnable').onclick = function () { openMemEnable('settings') };") >= 0, label + ' 启用引导入口 from=settings')
      assert(s.indexOf("if (modalBackScroll > 0 && $('modal')) $('modal').scrollTop = modalBackScroll;") >= 0, label + ' openSettings 滚动还原（一次性消费）')
      // ④ 调度编辑回填清栈（新链路不回设置卡）+ Esc 语义不变（modalHost 统一关当前层，返回栈是关闭后去向）
      assert(s.indexOf('function doInjSchedEdit(n) { modalBackTo = null; closeModal(); injMgrState = null; openDispatchEdit(n) }') >= 0, label + ' 调度编辑回填清返回栈')
      assert(s.indexOf("if ($('modalHost').firstChild) { closeModalFlushed();") >= 0, label + ' Esc 关当前层链路保留（零改动）')
    }
    // 双端 UI 标记一致（app.html ⇄ 原型共享变量/函数/接线文本）
    for (const k of ['modalBackTo', 'modalBackScroll', 'backScroll', "openInjectManager('settings')", "openMemEnable('settings')", "if (back === 'settings') openSettings();"]) {
      assert(protoV2Src.indexOf(k) >= 0 && appSrc.indexOf(k) >= 0, '返回栈 UI 标记双端一致：' + k)
    }
  })

  // ---- 56.2 client（开发版 client-impl + 发布包 lib/client.js）：backRef 镜像 + 统一关闭入口 + Esc/装配接线 ----
  await t('设置卡返回栈（client）：backRef 单层栈 + closeInjMgr/closeMemEnable 统一关闭 + Esc/装配接线（开发版 + 发布包）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      // ① 单层返回栈镜像 + 来源记录（仅设置卡入口传 'settings'）
      assert(s.indexOf('const injMgrBackRef = { current: null }') >= 0 && s.indexOf('const memBackRef = { current: null }') >= 0, label + ' 单层返回栈镜像 ref（injMgrBackRef/memBackRef）')
      assert(s.indexOf("injMgrBackRef.current = from === 'settings' ? 'settings' : null") >= 0 && s.indexOf("memBackRef.current = from === 'settings' ? 'settings' : null") >= 0, label + ' 来源记录（仅 from=settings 挂栈）')
      // ② 统一关闭入口：关闭后回设置卡（panelBridge.openSettings 中转，modals 禁横向引用）；两个面板各 1 处
      assert(s.indexOf('function closeInjMgr()') >= 0 && s.indexOf('function closeMemEnable()') >= 0, label + ' closeInjMgr/closeMemEnable 统一关闭入口')
      assert((s.match(/if \(back === 'settings' && panelBridge\.openSettings\) panelBridge\.openSettings\(\)/g) || []).length === 2, label + ' 两个面板关闭后重开设置卡（panelBridge 中转）')
      // ③ 关闭路径同口径：点遮罩/取消/启用成功/Esc 全走统一关闭入口
      assert(s.indexOf('!injMgrPending) closeInjMgr()') >= 0 && s.indexOf('!memPending) closeMemEnable()') >= 0, label + ' 点遮罩走统一关闭入口')
      assert(s.indexOf('onClick: () => closeInjMgr()') >= 0 && s.indexOf('onClick: () => closeMemEnable()') >= 0, label + ' 关闭/取消按钮走统一关闭入口')
      assert(s.indexOf('启用成功 = 关闭二级面板') >= 0, label + ' 启用成功走统一关闭入口（重开即重新探测状态）')
      assert(s.indexOf('if (injMgrOpenRef.current) { closeInjMgr(); return }') >= 0 && s.indexOf('if (memOpenRef.current) { closeMemEnable(); return }') >= 0, label + ' Esc 关当前层走统一关闭入口（Esc 语义不变）')
      // ④ 设置卡入口 from=settings + panelBridge.openSettings 装配回填 + 调度编辑回填清栈
      assert(s.indexOf("onClick: () => openInjectManager('settings')") >= 0 && s.indexOf("onClick: () => openMemEnable('settings')") >= 0, label + ' 设置卡入口传 from=settings')
      assert(s.indexOf('panelBridge.openSettings = openSettings') >= 0, label + ' panelBridge.openSettings 装配回填（index.js）')
      assert(s.indexOf('function doInjSchedEdit(n) { injMgrBackRef.current = null; setInjMgrOpen(false);') >= 0, label + ' 调度编辑回填清返回栈（新链路不返回）')
      // ⑤ 互斥红线保留：modal 不叠 modal（打开二级仍先收设置卡，返回 = 关闭后再重开，而非叠层）
      assert(s.indexOf('setSettingsOpen(false); setInjMgrOpen(true)') >= 0 && s.indexOf('setSettingsOpen(false); setMemOpen(true)') >= 0, label + ' 互斥红线保留（modal 不叠 modal）')
    }
  })

  // ---- 56.3 行为级 eval（app 真实框架 + 二级面板源码，mock DOM/rpc）：from=settings 关闭→重开；直接打开→不重开 ----
  await t('设置卡返回栈行为级 eval（app）：from=settings 关闭→重开设置卡+滚动送达；直接打开→不重开；Esc 同口径', () => {
    // 从产物 app.html 抽取真实函数源码（grabFn=多行函数 / grabLine=单行语句），框架与二级面板为被测真码
    const grabFn56 = (s, name) => { const m = s.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}')); assert(m, 'app.html 缺 ' + name + '()'); return m[0] }
    const grabLine56 = (s, mark) => { const i = s.indexOf(mark); assert(i >= 0, 'app.html 缺行：' + mark); return s.slice(i, s.indexOf('\n', i)) }
    const backSrc = [
      fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8'),   /* i18n 覆盖卡D：二级面板真码已走 t()——eval 前导补 zh 字典 + t() 桩（取值=中文原文，同 52.3 口径） */
      'function t(k, vars){ var s = I18N_ZH[k]; if (s == null) return k; if (vars) s = s.replace(/\\{(\\w+)\\}/g, function (m, n) { return vars[n] != null ? String(vars[n]) : m }); return s }',
      'var injMgrState = null; var injMgrSearchTimer = null; var memEnableState = null;',
      'function icon() { return "" }',
      'function loadInjectManager() {}',   /* 数据加载不在被测面（返回栈只涉开关链路），stub 防深链 DOM */
      'function openSettings() { __ns.reopened++; __ns.scrollAtReopen = modalBackScroll; modalBackScroll = 0 }',   /* 重开探针：记录次数 + 送达的滚动存档（消费口径同真码 openSettings） */
      grabLine56(appSrc, 'var modalCloseHook = null;'),
      grabLine56(appSrc, 'var modalBackTo = null;'),
      grabLine56(appSrc, 'var modalBackScroll = 0;'),
      grabFn56(appSrc, 'openModal'),
      grabFn56(appSrc, 'closeModal'),
      grabLine56(appSrc, 'function closeModalFlushed()'),
      grabFn56(appSrc, 'openInjectManager'),
      grabFn56(appSrc, 'openMemEnable'),
      'return { openInjectManager: openInjectManager, openMemEnable: openMemEnable, closeModal: closeModal, closeModalFlushed: closeModalFlushed, getBack: function () { return modalBackTo }, getScroll: function () { return modalBackScroll } }'
    ].join('\n')
    const ns = { reopened: 0, scrollAtReopen: null }
    const els = {}
    const mkEl = () => ({ onclick: null, oninput: null, scrollTop: 0, innerHTML: '', classList: { add: function () {} }, addEventListener: function () {} })
    const api = new Function('$', 'document', '__ns', backSrc)(
      function (id) { return els[id] = els[id] || mkEl() },
      { getElementsByName: function () { return [] } },
      ns)
    // ① from=settings：设置卡滚动 320 → 进入二级 → 点「关闭」→ 重开设置卡 + 滚动存档 320 送达 + 栈一次性消费
    els.modal = mkEl(); els.modal.scrollTop = 320   /* 设置卡当前滚动位置（打开二级前；$ 缓存惰性建元素，先预置） */
    api.openInjectManager('settings')
    assert(api.getBack() === 'settings' && api.getScroll() === 320, 'from=settings 进入：挂载来源 + 滚动存档 320')
    els.injMgrClose.onclick()   /* 注入管理「关闭」按钮 */
    assert(ns.reopened === 1 && ns.scrollAtReopen === 320, '关闭二级 → 重开设置卡 + 滚动存档送达（实得 reopened=' + ns.reopened + ' scroll=' + ns.scrollAtReopen + '）')
    assert(api.getBack() === null && api.getScroll() === 0, '返回栈一次性消费（单层，不残留）')
    // ② 直接打开（无 from）：不挂栈 → 关闭不重开
    api.openInjectManager()
    assert(api.getBack() === null, '直接打开二级不挂返回栈')
    els.injMgrClose.onclick()
    assert(ns.reopened === 1, '直接打开关闭 → 不重开设置卡（reopened 仍为 1）')
    // ③ Esc/点遮罩同口径（closeModalFlushed 入口）：from=settings → 重开
    api.openInjectManager('settings')
    api.closeModalFlushed()
    assert(ns.reopened === 2, 'Esc/点遮罩（closeModalFlushed）同口径重开设置卡')
    // ④ 启用引导同款：from=settings → 取消 → 重开；直接打开 → 取消 → 不重开
    api.openMemEnable('settings')
    assert(api.getBack() === 'settings', '启用引导 from=settings 挂载返回栈')
    els.memCancel.onclick()   /* 「取消」按钮 */
    assert(ns.reopened === 3, '启用引导取消 → 重开设置卡')
    api.openMemEnable()
    els.memCancel.onclick()
    assert(ns.reopened === 3, '启用引导直接打开取消 → 不重开（reopened 仍为 3）')
    // ⑤ 非返回路径清滚动存档：挂栈后不关二级直接走 closeModal 之外的关闭不残留（else 分支清零）
    els.modal = mkEl(); els.modal.scrollTop = 200
    api.openInjectManager('settings')
    api.closeModal()   /* from=settings 关 → 重开（reopened=4），滚动送达 200 */
    assert(ns.reopened === 4 && ns.scrollAtReopen === 200, '滚动存档随来源送达（200）')
    api.openInjectManager()   /* 直接打开再关：else 分支清存档 */
    els.injMgrClose.onclick()
    assert(api.getScroll() === 0 && ns.reopened === 4, '非返回路径滚动存档清零防串档')
  })
  }
}
