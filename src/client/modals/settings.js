    // ===== modal: settings —— 设置卡片（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出；D2 收尾模块，序位最末）=====
    // provides: store.modal.settings / settingsOpenRef / usageBudgetRef / setPersistRef / settingsFlushRef / setSettingsOpen / setSettingsData /
    //           setSetLlmProvider / setSetLlmModel / setSetCatalog / setSetStale / setSetBudget / setUsageData / setSetUsageBudget /
    //           setSetSaving / setSetLogWeek / setSetLogRetention / openSettings / maybeToastUsageBudget /
    //           settingsSetQuiet / setPersistMerge / saveSettings*（Llm/Catalog/Stale/MaxDepth/Budget/UsageBudget/LlmManual/LogWeek/LogRetention）/
    //           SET_NUM_FIELDS / saveSettingsAll / restoreSettingsAll / flushSettingsPending / closeSettings / SettingsModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/format.js（fmtTok）、kernel/icons.js（e/I）、kernel/bus.js（showToast）、
    //        modals/export.js + export-single.js + import.js + trash.js + prune.js + suggest.js + inject-preview.js + inject-manager.js + memory-guide.js
    //        （设置行入口 open*/do*/memViewNote 与 setMemStatus——序位在前可见，非横向引用）
    // state 托管：open/data/llmProvider/llmModel/catalog/stale/budget/usageData/usageBudget/saving/logWeek/logRetention
    // 迁入 store.modal.settings 切片；maxDepth/snap/inflight 因 check 锚定其 useState 声明原文滞留 whole.js（同 newNoteKind 先例）——
    // 组件经 props 注入，模块函数经 panelBridge.setMaxDepth/setSetMaxDepth/setSnap/setSetSnap/setInflight/setSetInflight 中转；
    // settingsOpenRef（Esc 栈）/usageBudgetRef（预算判定）/setPersistRef（已落盘镜像）/settingsFlushRef（Esc 兜底 flush）
    // 为模块级单例（plain object 与 useRef 等价——面板为 shell.overlay 单例）；whole.js 经 panelBridge.setSettingsOpen 回填别名中转互斥关闭
    store.modal.settings = createStore({ open: false, data: null, llmProvider: '', llmModel: '', catalog: true, stale: '90', budget: '0', usageData: null, usageBudget: '0', saving: false, logWeek: '7', logRetention: '90' })
    const settingsOpenRef = { current: false }   // 设置卡片镜像（Esc 优先关设置卡片）
    const usageBudgetRef = { current: 0 }   // 预算镜像 ref：usage-get 与 settings-get 并发放射，toast 判定读 ref 防闭包过期
    const setPersistRef = { current: null }   // 已落盘值镜像（兜底 flush/还原只写真不同的键）
    const settingsFlushRef = { current: null }   // 关闭兜底 flush 镜像（Esc 闭包挂一次，读最新控件值）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setSettingsOpen(v) { const nv = typeof v === 'function' ? v(settingsOpenRef.current) : v; settingsOpenRef.current = nv; store.modal.settings.set({ open: nv }) }
    function setSettingsData(v) { store.modal.settings.set({ data: typeof v === 'function' ? v(store.modal.settings.get().data) : v }) }
    function setSetLlmProvider(v) { store.modal.settings.set({ llmProvider: typeof v === 'function' ? v(store.modal.settings.get().llmProvider) : v }) }
    function setSetLlmModel(v) { store.modal.settings.set({ llmModel: typeof v === 'function' ? v(store.modal.settings.get().llmModel) : v }) }
    function setSetCatalog(v) { store.modal.settings.set({ catalog: typeof v === 'function' ? v(store.modal.settings.get().catalog) : v }) }
    function setSetStale(v) { store.modal.settings.set({ stale: typeof v === 'function' ? v(store.modal.settings.get().stale) : v }) }
    function setSetBudget(v) { store.modal.settings.set({ budget: typeof v === 'function' ? v(store.modal.settings.get().budget) : v }) }
    function setUsageData(v) { store.modal.settings.set({ usageData: typeof v === 'function' ? v(store.modal.settings.get().usageData) : v }) }
    function setSetUsageBudget(v) { store.modal.settings.set({ usageBudget: typeof v === 'function' ? v(store.modal.settings.get().usageBudget) : v }) }
    function setSetSaving(v) { store.modal.settings.set({ saving: typeof v === 'function' ? v(store.modal.settings.get().saving) : v }) }
    function setSetLogWeek(v) { store.modal.settings.set({ logWeek: typeof v === 'function' ? v(store.modal.settings.get().logWeek) : v }) }
    function setSetLogRetention(v) { store.modal.settings.set({ logRetention: typeof v === 'function' ? v(store.modal.settings.get().logRetention) : v }) }
    // 设置卡片：打开即拉取 settings + 可用模型列表（host 探 llm 服务目录；探不到时 models=[]，控件退化为手输）
    function openSettings() {
      setSetLlmProvider(''); setSetLlmModel(''); setSettingsData(null); setUsageData(null); setError(''); setSettingsOpen(true)
      panelBridge.setSetSnap(null); setPersistRef.current = null; setSetSaving(false)   // dirty 基准复位（加载完成后再捕获快照）
      // LLM 用量统计接力 settings 拉取（预算 ref 就绪后再判超预算 toast，避免并发竞态漏提醒；settings-get 为本地 RPC 不慢）：
      // 今日/本周/本月/累计 + 按功能分列；超月度预算仅 toast 提醒，不阻断
      const loadUsage = () => host.call('notes-usage-get', {}).then(res => {
        if (!res || res.error) return
        setUsageData(res)
        maybeToastUsageBudget(res)
      }).catch(() => {})
      host.call('notes-settings-get', {}).then(res => {
        if (!res) { loadUsage(); return }
        setSettingsData(res)
        const l = res.settings && res.settings.llm
        if (l && l.provider && l.model) { setSetLlmProvider(l.provider); setSetLlmModel(l.model) }
        setSetCatalog(!res.settings || res.settings.catalogEnabled !== false)   // 目录注入总开关：缺省开
        setSetStale(String(res.settings && typeof res.settings.staleDays === 'number' ? res.settings.staleDays : 90))   // 时效提醒阈值：缺省 90
        panelBridge.setSetMaxDepth(String(res.settings && typeof res.settings.maxFolderDepth === 'number' ? res.settings.maxFolderDepth : 3))   // 文件夹嵌套深度上限：缺省 3（0=不限）
        setSetBudget(String(res.settings && typeof res.settings.injectBudgetChars === 'number' ? res.settings.injectBudgetChars : 0))   // 注入预算：缺省 0=不限
        setSetUsageBudget(String(res.settings && typeof res.settings.usageBudgetMonthly === 'number' ? res.settings.usageBudgetMonthly : 0))   // 月度用量预算提醒：缺省 0=关闭
        usageBudgetRef.current = (res.settings && typeof res.settings.usageBudgetMonthly === 'number') ? res.settings.usageBudgetMonthly : 0
        setSetLogWeek(String(res.settings && typeof res.settings.logWeekAfterDays === 'number' ? res.settings.logWeekAfterDays : 7))   // 工作记忆 v0：日志周聚合窗口，缺省 7
        setSetLogRetention(String(res.settings && typeof res.settings.logRetentionDays === 'number' ? res.settings.logRetentionDays : 90))   // 日志月聚合窗口，缺省 90（0=关闭本级）
        // dirty/还原基准（notes-settings-feedback）：打开时快照（UI 形态字符串口径，与控件受控值同构）+ 已落盘镜像初始化
        const snap0 = {
          llmP: (l && l.provider && l.model) ? l.provider : '', llmM: (l && l.provider && l.model) ? l.model : '',
          catalog: !res.settings || res.settings.catalogEnabled !== false,
          stale: String(res.settings && typeof res.settings.staleDays === 'number' ? res.settings.staleDays : 90),
          maxDepth: String(res.settings && typeof res.settings.maxFolderDepth === 'number' ? res.settings.maxFolderDepth : 3),
          budget: String(res.settings && typeof res.settings.injectBudgetChars === 'number' ? res.settings.injectBudgetChars : 0),
          usageBudget: String(res.settings && typeof res.settings.usageBudgetMonthly === 'number' ? res.settings.usageBudgetMonthly : 0),
          logWeek: String(res.settings && typeof res.settings.logWeekAfterDays === 'number' ? res.settings.logWeekAfterDays : 7),
          logRetention: String(res.settings && typeof res.settings.logRetentionDays === 'number' ? res.settings.logRetentionDays : 90),
        }
        panelBridge.setSetSnap(snap0); setPersistRef.current = snap0
        loadUsage()
      }).catch(() => { loadUsage() })
      // 工作记忆 v0：沉淀引导启用状态探测（单一事实源 = tag memory-guide 且 inject=true 的笔记，不落 settings.json）
      setMemStatus(null)
      host.call('notes-memory-guide', { op: 'status' }).then(res => {
        setMemStatus(res && !res.error ? res : { enabled: false, noteId: '' })
      }).catch(() => setMemStatus({ enabled: false, noteId: '' }))
    }
    // 月度预算提醒：usage.month.total 超 usageBudgetMonthly → toast（仅提醒，不阻断）；budget 读 ref（settings-get/保存预算时同步）
    function maybeToastUsageBudget(u) {
      try {
        const b = usageBudgetRef.current
        if (b > 0 && u && u.month && u.month.total > b) showToast('⚠ 本月笔记 LLM 用量 ' + fmtTok(u.month.total) + ' tokens 已超预算 ' + fmtTok(b) + '（仅提醒，不阻断）')
      } catch (e) {}
    }
    // ===== 设置写通道（notes-settings-feedback）：settingsSetQuiet = 全部 settings-set 的低层共用通道 =====
    // 在途计数（dirty 口径「存在尚未落盘的待写」）+ 已落盘镜像逐键跟进；不 toast——自动保存 saver 自带文案，保存/还原/兜底 flush 统一收口
    function settingsSetQuiet(patch) {
      panelBridge.setSetInflight(n => n + 1)
      return host.call('notes-settings-set', patch).then(res => {
        panelBridge.setSetInflight(n => Math.max(0, n - 1))
        if (res && res.error) throw new Error(res.error)
        if (res && res.settings) setSettingsData(prev => Object.assign({}, prev || {}, { settings: res.settings }))
        setPersistMerge(patch)
        return res
      }, err => { panelBridge.setSetInflight(n => Math.max(0, n - 1)); throw err })
    }
    // 已落盘镜像逐键跟进（写成功后才调；UI 形态字符串口径与快照同构）
    function setPersistMerge(patch) {
      const p = setPersistRef.current; if (!p) return
      const n = Object.assign({}, p)
      if ('llm' in patch) { n.llmP = patch.llm ? patch.llm.provider : ''; n.llmM = patch.llm ? patch.llm.model : '' }
      if ('catalogEnabled' in patch) n.catalog = !!patch.catalogEnabled
      if ('staleDays' in patch) n.stale = String(patch.staleDays)
      if ('maxFolderDepth' in patch) n.maxDepth = String(patch.maxFolderDepth)
      if ('injectBudgetChars' in patch) n.budget = String(patch.injectBudgetChars)
      if ('usageBudgetMonthly' in patch) n.usageBudget = String(patch.usageBudgetMonthly)
      if ('logWeekAfterDays' in patch) n.logWeek = String(patch.logWeekAfterDays)
      if ('logRetentionDays' in patch) n.logRetention = String(patch.logRetentionDays)
      setPersistRef.current = n
    }
    // 选择即保存：llm=null 恢复跟随当前会话（默认）；否则保存 { provider, model }
    function saveSettingsLlm(llm) {
      settingsSetQuiet({ llm: llm }).then(() => {
        showToast(llm ? ('已保存：笔记 LLM = ' + llm.provider + ' / ' + llm.model) : '已恢复跟随当前会话（默认）')
      }).catch(err => setError(String(err.message || err)))
    }
    // 目录注入总开关：勾选即保存（只传布尔 catalogEnabled；host 侧 null 才是恢复默认开，这里不用）
    function saveSettingsCatalog(enabled) {
      settingsSetQuiet({ catalogEnabled: enabled }).then(() => {
        showToast(enabled ? '已开启笔记目录注入' : '已关闭笔记目录注入')
      }).catch(err => setError(String(err.message || err)))
    }
    // P1 时效衰减提醒阈值：失焦/Enter 即保存（非负整数；0 = 关闭；非法输入报错不落盘）
    function saveSettingsStale() {
      const setStale = store.modal.settings.get().stale
      const raw = setStale.trim()
      if (!/^\d+$/.test(raw)) { setError('时效提醒阈值需为非负整数（0 = 关闭）'); return }
      const v = parseInt(raw, 10)
      settingsSetQuiet({ staleDays: v }).then(() => {
        showToast(v === 0 ? '已关闭时效衰减提醒' : '已保存：超过 ' + v + ' 天未更新的资料将在目录标注 ⚠')
      }).catch(err => setError(String(err.message || err)))
    }
    // 文件夹嵌套深度上限（maxFolderDepth，层；根级=第 1 层，缺省 3，0=不限）：失焦/Enter 即保存（非负整数；非法输入报错不落盘）
    function saveSettingsMaxDepth() {
      const setMaxDepth = panelBridge.setMaxDepth
      const raw = setMaxDepth.trim()
      if (!/^\d+$/.test(raw)) { setError('文件夹嵌套深度上限需为非负整数（0 = 不限层数）'); return }
      const v = parseInt(raw, 10)
      settingsSetQuiet({ maxFolderDepth: v }).then(() => {
        showToast(v === 0 ? '已保存：文件夹嵌套不限层数' : '已保存：文件夹最多嵌套 ' + v + ' 层')
      }).catch(err => setError(String(err.message || err)))
    }
    // P1 注入体积预算（约，字符数）：失焦/Enter 即保存（非负整数；0 = 不限；约定条目永不截断）
    function saveSettingsBudget() {
      const setBudget = store.modal.settings.get().budget
      const raw = setBudget.trim()
      if (!/^\d+$/.test(raw)) { setError('注入体积预算需为非负整数（0 = 不限）'); return }
      const v = parseInt(raw, 10)
      settingsSetQuiet({ injectBudgetChars: v }).then(() => {
        showToast(v === 0 ? '已关闭注入体积预算（不限）' : '已保存：注入预算约 ' + v + ' 字符')
      }).catch(err => setError(String(err.message || err)))
    }
    // LLM 月度用量预算提醒（tokens/月）：失焦/Enter 即保存（非负整数；0 = 关闭提醒）；保存后即按当前用量复核一次（超预算 toast，不阻断）
    function saveSettingsUsageBudget() {
      const setUsageBudget = store.modal.settings.get().usageBudget
      const usageData = store.modal.settings.get().usageData
      const raw = setUsageBudget.trim()
      if (!/^\d+$/.test(raw)) { setError('月度用量预算需为非负整数（0 = 关闭提醒）'); return }
      const v = parseInt(raw, 10)
      settingsSetQuiet({ usageBudgetMonthly: v }).then(() => {
        usageBudgetRef.current = v
        showToast(v === 0 ? '已关闭月度用量预算提醒' : '已保存：月度用量预算 ' + fmtTok(v) + ' tokens')
        if (usageData) maybeToastUsageBudget(usageData)
      }).catch(err => setError(String(err.message || err)))
    }
    // 手输模式（探不到模型列表时）：provider/model 两框齐备才保存；清除按钮恢复跟随会话
    function saveSettingsLlmManual() {
      const setLlmProvider = store.modal.settings.get().llmProvider
      const setLlmModel = store.modal.settings.get().llmModel
      const p = setLlmProvider.trim(), m = setLlmModel.trim()
      if (!p || !m) return
      saveSettingsLlm({ provider: p, model: m })
    }
    // ===== 工作记忆 v0：日志卫生窗口保存（设置卡片「工作记忆」区）=====
    // 日志周聚合窗口（天，缺省 7）：失焦/Enter 即保存（非负整数；非法输入报错不落盘）
    function saveSettingsLogWeek() {
      const setLogWeek = store.modal.settings.get().logWeek
      const raw = setLogWeek.trim()
      if (!/^\d+$/.test(raw)) { setError('日志周聚合窗口需为非负整数（天）'); return }
      const v = parseInt(raw, 10)
      settingsSetQuiet({ logWeekAfterDays: v }).then(() => {
        showToast('已保存：超过 ' + v + ' 天的日志将提名周聚合')
      }).catch(err => setError(String(err.message || err)))
    }
    // 日志月聚合窗口（天，缺省 90；0 = 关闭月聚合本级）
    function saveSettingsLogRetention() {
      const setLogRetention = store.modal.settings.get().logRetention
      const raw = setLogRetention.trim()
      if (!/^\d+$/.test(raw)) { setError('日志月聚合窗口需为非负整数（0 = 关闭月聚合）'); return }
      const v = parseInt(raw, 10)
      settingsSetQuiet({ logRetentionDays: v }).then(() => {
        showToast(v === 0 ? '已关闭日志月聚合提名' : '已保存：超过 ' + v + ' 天的日志将提名月聚合')
      }).catch(err => setError(String(err.message || err)))
    }
    // ===== 设置卡交互反馈（notes-settings-feedback）：显式保存 / 还原 / 关闭兜底 flush =====
    // 数值字段登记表（快照键 ↔ 设置 RPC 键 ↔ 校验文案）：保存校验/兜底 flush/还原回滚三处共用同一份口径
    const SET_NUM_FIELDS = [
      ['stale', 'staleDays', '时效提醒阈值需为非负整数（0 = 关闭）'],
      ['maxDepth', 'maxFolderDepth', '文件夹嵌套深度上限需为非负整数（0 = 不限层数）'],
      ['budget', 'injectBudgetChars', '注入体积预算需为非负整数（0 = 不限）'],
      ['usageBudget', 'usageBudgetMonthly', '月度用量预算需为非负整数（0 = 关闭提醒）'],
      ['logWeek', 'logWeekAfterDays', '日志周聚合窗口需为非负整数（天）'],
      ['logRetention', 'logRetentionDays', '日志月聚合窗口需为非负整数（0 = 关闭月聚合）'],
    ]
    // 「保存」：显式确认 + 兜底 flush——先校验全部数值字段（任一非法即中止并报错，改动保留继续编辑），
    // 再串行落盘全部「控件值 ≠ 已落盘」的键（串行防写竞态），全部成功后快照跟进 + toast「设置已保存」+ dirty 复位
    function saveSettingsAll() {
      const setSaving = store.modal.settings.get().saving
      const setSnap = panelBridge.setSnap
      const setStale = store.modal.settings.get().stale
      const setMaxDepth = panelBridge.setMaxDepth
      const setBudget = store.modal.settings.get().budget
      const setUsageBudget = store.modal.settings.get().usageBudget
      const setLogWeek = store.modal.settings.get().logWeek
      const setLogRetention = store.modal.settings.get().logRetention
      const setLlmProvider = store.modal.settings.get().llmProvider
      const setLlmModel = store.modal.settings.get().llmModel
      const setCatalog = store.modal.settings.get().catalog
      const settingsData = store.modal.settings.get().data
      if (setSaving || !setSnap) return
      const vals = { stale: setStale, maxDepth: setMaxDepth, budget: setBudget, usageBudget: setUsageBudget, logWeek: setLogWeek, logRetention: setLogRetention }
      for (const f of SET_NUM_FIELDS) { if (!/^\d+$/.test(vals[f[0]].trim())) { setError(f[2]); return } }
      const p = setPersistRef.current || setSnap
      const patches = []
      // 手输 LLM 两框齐备且 ≠ 已落盘才补写（下拉选择/开关变更即存无待写；单框不齐 = 存量失焦口径静默跳过）
      const models0 = (settingsData && settingsData.models) || []
      if (!models0.length && setLlmProvider.trim() && setLlmModel.trim() && (setLlmProvider !== p.llmP || setLlmModel !== p.llmM)) patches.push({ llm: { provider: setLlmProvider.trim(), model: setLlmModel.trim() } })
      for (const f of SET_NUM_FIELDS) { const raw = vals[f[0]].trim(); if (raw !== p[f[0]]) { const o = {}; o[f[1]] = parseInt(raw, 10); patches.push(o) } }
      setSetSaving(true)
      let seq = Promise.resolve()
      for (const pt of patches) seq = seq.then(() => settingsSetQuiet(pt))
      seq.then(() => {
        setSetSaving(false)
        // 快照跟进到当前控件值（显式确认完成 → dirty 复位，保存按钮回禁用态）
        panelBridge.setSetSnap({ llmP: setLlmProvider, llmM: setLlmModel, catalog: setCatalog, stale: setStale, maxDepth: setMaxDepth, budget: setBudget, usageBudget: setUsageBudget, logWeek: setLogWeek, logRetention: setLogRetention })
        usageBudgetRef.current = parseInt(setUsageBudget.trim(), 10)
        showToast('设置已保存')
      }, err => { setSetSaving(false); setError('保存失败：' + String(err && err.message || err)) })
    }
    // 「还原」：回滚到打开时快照——已落盘 ≠ 快照的键逐键串行写回（逐键恢复），全部控件复位到快照值
    function restoreSettingsAll() {
      const setSaving = store.modal.settings.get().saving
      const setSnap = panelBridge.setSnap
      if (setSaving || !setSnap) return
      const s = setSnap, p = setPersistRef.current || s
      const patches = []
      if (p.llmP !== s.llmP || p.llmM !== s.llmM) patches.push({ llm: (s.llmP && s.llmM) ? { provider: s.llmP, model: s.llmM } : null })
      if (p.catalog !== s.catalog) patches.push({ catalogEnabled: s.catalog })
      for (const f of SET_NUM_FIELDS) { if (p[f[0]] !== s[f[0]]) { const o = {}; o[f[1]] = parseInt(s[f[0]], 10); patches.push(o) } }
      setSetSaving(true)
      let seq = Promise.resolve()
      for (const pt of patches) seq = seq.then(() => settingsSetQuiet(pt))
      seq.then(() => {
        setSetSaving(false)
        setSetLlmProvider(s.llmP); setSetLlmModel(s.llmM); setSetCatalog(s.catalog)
        setSetStale(s.stale); panelBridge.setSetMaxDepth(s.maxDepth); setSetBudget(s.budget)
        setSetUsageBudget(s.usageBudget); setSetLogWeek(s.logWeek); setSetLogRetention(s.logRetention)
        usageBudgetRef.current = parseInt(s.usageBudget, 10)
        showToast('已还原：设置回滚到打开时的状态')
      }, err => { setSetSaving(false); setError('还原失败：' + String(err && err.message || err)) })
    }
    // 关闭兜底 flush（✕/Esc/点遮罩同口径）：「控件值 ≠ 已落盘」的有效改动串行静默落盘；
    // 非法输入按存量口径丢弃（同关闭即弃）；≥1 项落盘则 toast 一次确认
    function flushSettingsPending() {
      const settingsData = store.modal.settings.get().data
      const setLlmProvider = store.modal.settings.get().llmProvider
      const setLlmModel = store.modal.settings.get().llmModel
      const setStale = store.modal.settings.get().stale
      const setMaxDepth = panelBridge.setMaxDepth
      const setBudget = store.modal.settings.get().budget
      const setUsageBudget = store.modal.settings.get().usageBudget
      const setLogWeek = store.modal.settings.get().logWeek
      const setLogRetention = store.modal.settings.get().logRetention
      const p = setPersistRef.current
      if (!p) return
      const patches = []
      const models0 = (settingsData && settingsData.models) || []
      if (!models0.length && setLlmProvider.trim() && setLlmModel.trim() && (setLlmProvider !== p.llmP || setLlmModel !== p.llmM)) patches.push({ llm: { provider: setLlmProvider.trim(), model: setLlmModel.trim() } })
      const vals = { stale: setStale, maxDepth: setMaxDepth, budget: setBudget, usageBudget: setUsageBudget, logWeek: setLogWeek, logRetention: setLogRetention }
      for (const f of SET_NUM_FIELDS) { const raw = vals[f[0]].trim(); if (/^\d+$/.test(raw) && raw !== p[f[0]]) { const o = {}; o[f[1]] = parseInt(raw, 10); patches.push(o) } }
      if (!patches.length) return
      let seq = Promise.resolve()
      for (const pt of patches) seq = seq.then(() => settingsSetQuiet(pt))
      seq.then(() => { showToast('设置已保存') }, err => { showToast('设置保存失败：' + String(err && err.message || err)) })
    }
    // ✕/Esc/点遮罩统一关闭入口：有未落盘改动先兜底 flush（fire-and-forget，落盘完成自 toast），再收起
    function closeSettings() { flushSettingsPending(); setSettingsOpen(false) }
    // 设置卡片宿主（modal，居中，复用派发 modal 的 mask/modal 风格）：通用结构——标题「设置」+ 设置项行列表
    // （每行：左 label + 右控件）。以后加设置项只需往 settingsRows 数组加行，结构不变。
    // 交互（notes-settings-feedback）：自动保存保留（选择即存/失焦/Enter 即存，走 notes-settings-set）；
    // 标题栏 ✕ 常驻关闭 + dirty 态「保存」（accent 实心，显式确认 + 兜底 flush）/「还原」（回滚打开时快照）；
    // 点遮罩 / Esc = ✕ 同义（有未落盘改动先兜底 flush 再关，Esc 在全局 keydown 里优先关本卡片）。
    function SettingsModal(props) {
      const settingsOpen = store.modal.settings.useSel(s => s.open)
      const settingsData = store.modal.settings.useSel(s => s.data)
      const setLlmProvider = store.modal.settings.useSel(s => s.llmProvider)
      const setLlmModel = store.modal.settings.useSel(s => s.llmModel)
      const setCatalog = store.modal.settings.useSel(s => s.catalog)
      const setStale = store.modal.settings.useSel(s => s.stale)
      const setBudget = store.modal.settings.useSel(s => s.budget)
      const usageData = store.modal.settings.useSel(s => s.usageData)
      const setUsageBudget = store.modal.settings.useSel(s => s.usageBudget)
      const setSaving = store.modal.settings.useSel(s => s.saving)
      const setLogWeek = store.modal.settings.useSel(s => s.logWeek)
      const setLogRetention = store.modal.settings.useSel(s => s.logRetention)
      // maxDepth/snap/inflight 滞留 whole.js（check 锚定 useState 声明原文），经 props 注入
      const setMaxDepth = props.setMaxDepth
      const setSetMaxDepth = props.setSetMaxDepth
      const setSnap = props.setSnap
      const setInflight = props.setInflight
      // 工作记忆 v0 状态行数据源（memory-guide 模块切片；设置卡「工作记忆」区状态行/停用按钮消费）
      const memStatus = store.modal.memory.useSel(s => s.status)
      const memPending = store.modal.memory.useSel(s => s.pending)
      const error = props.error
      React.useEffect(() => { settingsFlushRef.current = flushSettingsPending })   // 关闭兜底 flush 镜像：每渲染刷新（Esc 闭包读最新控件值；函数声明提升可前引）
      return settingsOpen ? (() => {
        // dirty 判定口径：存在在途未落盘待写（setInflight>0）或 任一控件值 ≠ 打开时快照
        const setDirty = setInflight > 0 || (setSnap ? (
          setLlmProvider !== setSnap.llmP || setLlmModel !== setSnap.llmM || setCatalog !== setSnap.catalog ||
          setStale !== setSnap.stale || setMaxDepth !== setSnap.maxDepth || setBudget !== setSnap.budget ||
          setUsageBudget !== setSnap.usageBudget || setLogWeek !== setSnap.logWeek || setLogRetention !== setSnap.logRetention) : false)
        const modelList = (settingsData && settingsData.models) || []
        // 下拉选项 = provider/model 组合，第一项「跟随当前会话（默认）」；
        // 已保存值不在列表中（如模型已下线）时追加一项保证回显正确
        const selIdx = modelList.findIndex(m => m.provider === setLlmProvider && m.model === setLlmModel)
        const opts = (setLlmProvider && setLlmModel && selIdx < 0)
          ? modelList.concat([{ provider: setLlmProvider, model: setLlmModel, label: setLlmProvider + ' / ' + setLlmModel + '（已保存）' }])
          : modelList
        const curVal = selIdx >= 0 ? String(selIdx) : (opts.length > modelList.length ? String(opts.length - 1) : '')
        const llmControl = modelList.length
          ? e('select', { className: 'dsh-notes-settings-select', value: curVal, 'data-tooltip': '笔记自动分类 / 指令提取使用的模型', onChange: (ev) => {
                const v = ev.target.value
                if (v === '') { setSetLlmProvider(''); setSetLlmModel(''); saveSettingsLlm(null) }
                else { const m = opts[+v]; if (m) { setSetLlmProvider(m.provider); setSetLlmModel(m.model); saveSettingsLlm({ provider: m.provider, model: m.model }) } }
              } },
              e('option', { value: '' }, '跟随当前会话（默认）'),
              opts.map((m, i) => e('option', { key: m.provider + '/' + m.model + '-' + i, value: String(i) }, m.label || (m.provider + ' / ' + m.model))))
          : e(React.Fragment, null,
              e('input', { className: 'dsh-notes-settings-input', placeholder: 'provider', value: setLlmProvider, onChange: (ev) => setSetLlmProvider(ev.target.value), onBlur: saveSettingsLlmManual, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsLlmManual() } }),
              e('input', { className: 'dsh-notes-settings-input', placeholder: 'model', value: setLlmModel, onChange: (ev) => setSetLlmModel(ev.target.value), onBlur: saveSettingsLlmManual, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsLlmManual() } }),
              (setLlmProvider || setLlmModel) ? e('button', { className: 'dsh-notes-settings-clear', onClick: () => { setSetLlmProvider(''); setSetLlmModel(''); saveSettingsLlm(null) } }, '跟随当前会话（默认）') : null)
        // 目录注入总开关控件：checkbox 勾选即保存（catalogEnabled，缺省开）；label 挂 tooltip 说明注入形态
        const catalogControl = e('label', { className: 'dsh-notes-settings-checkwrap dsh-nt', 'data-tooltip': '向 Agent 系统提示注入笔记目录（一行一条），供其规划时参考并按需 note_get 取全文' },
          e('input', { type: 'checkbox', className: 'dsh-notes-settings-check', checked: setCatalog, onChange: (ev) => { const v = !!ev.target.checked; setSetCatalog(v); saveSettingsCatalog(v) } }),
          setCatalog ? '已开启' : '已关闭')
        // P1 时效衰减提醒控件：数值输入（天），失焦/Enter 即保存；0 = 关闭
        const staleControl = e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 1, value: setStale, 'data-tooltip': '目录行对超过 N 天未更新的笔记/链接追加「 ⚠ N 天未更新」标注；0 = 关闭', onChange: (ev) => setSetStale(ev.target.value), onBlur: saveSettingsStale, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsStale() } })
        // 文件夹嵌套深度上限控件（同 staleDays 输入交互）：数值输入（层），失焦/Enter 即保存；0 = 不限层数
        const maxDepthControl = e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 1, value: setMaxDepth, 'data-tooltip': '虚拟文件夹最大嵌套层级（根级 = 第 1 层）；新建子文件夹/拖拽换父超限将拒绝并 toast 提示；0 = 不限', onChange: (ev) => setSetMaxDepth(ev.target.value), onBlur: saveSettingsMaxDepth, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsMaxDepth() } })
        // P1 注入体积预算控件：数值输入（约，字符数）+ 仪表（最近一次注入体积 vs 预算，超预算变红）；约定条目永不截断
        const lastChars = (settingsData && typeof settingsData.lastInjectChars === 'number') ? settingsData.lastInjectChars : 0
        const budgetNum = /^\d+$/.test(setBudget.trim()) ? parseInt(setBudget.trim(), 10) : 0
        const gaugePct = budgetNum > 0 ? Math.min(100, Math.round(lastChars / budgetNum * 100)) : 0
        const budgetControl = e('div', { style: { width: '100%' } },
          e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 100, value: setBudget, 'data-tooltip': '单次注入笔记全文的上限（约，按字符数近似）；约定条目永不截断，资料条目从最旧开始省略；0 = 不限', onChange: (ev) => setSetBudget(ev.target.value), onBlur: saveSettingsBudget, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsBudget() } }),
          e('div', { className: 'dsh-notes-inject-gauge dsh-nt', 'data-tooltip': '最近一次注入的笔记全文体积（约，按字符数）' },
            e('div', { className: 'dsh-notes-inject-gauge-bar' + (budgetNum > 0 && lastChars > budgetNum ? ' over' : ''), style: { width: gaugePct + '%' } })),
          e('span', { className: 'dsh-notes-inject-gauge-t' }, '当前注入约 ' + lastChars + ' 字符' + (budgetNum > 0 ? ' / 预算约 ' + budgetNum + ' 字符' : '（不限）')))
        // 数据区控件：导出全部（目录快照）/ 导出单文件…（P3 scope 拼接 + 图片内联）/ 导入…（两步式预览后执行）/ 回收站（底部收敛后的兜底入口）；点击即关设置卡片、开各自对话框
        const dataControl = e(React.Fragment, null,
          e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': '把整个笔记库（含 folders.json）快照到目标目录', onClick: openExport }, '导出全部'),
          e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': '按范围（全部/文件夹/标签）拼接为单个 Markdown 文件：图片 base64 内联，可直接分享；超 20MB 告警仍导出', onClick: openSExport }, '导出单文件…'),
          e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': '从目录快照导入：先预览明细再执行，只增改不删、自动备份', onClick: openImport }, '导入…'),
          e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': '回收站：查看已删除的笔记，可恢复或彻底删除', onClick: openTrash }, '回收站'))
        // 二期 资产清理控件：notes-assets-prune dry-run 预览 → 勾选删除（点击即关设置卡片、开预览对话框）
        const assetsControl = e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': '预览 assets/ 中未被任何笔记引用的孤儿文件，勾选后删除（dry-run 先行，零写入）', onClick: openPrune }, '清理…')
        // 整理建议控件：打开三段式建议 modal（点击即关设置卡片、modal 不叠 modal）——底部「整理」按钮收敛后此处为入口
        const suggestControl = e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': '整理建议：速记组归档 / 过期未引用清理 / 孤儿笔记候选（只提名不自动执行）', onClick: openSuggest }, '打开')
        // 注入预览控件：打开预览 modal（点击即关设置卡片、modal 不叠 modal）——agent 实际收到的注入文本即所见
        const injPrevControl = e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': '预览 Agent 系统提示中实际注入的笔记文本（约定桶 + 目录桶），含敏感打码 / 时效标注 / 预算截断效果；可按会话过滤', onClick: openInjectPreview }, '预览…')
        // 注入管理控件：打开注入管理面板（点击即关设置卡片、modal 不叠 modal）——全库注入三态总览 + 单行直改 / 多选批量
        const injMgrControl = e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': '打开注入管理面板：总览全部笔记的注入三态（约定/资料/关闭），单行直改或多选批量调整；顶部统计 chips 点击即过滤；日志隐身硬禁，敏感笔记注入自动脱敏', onClick: openInjectManager }, '管理…')
        // ===== 工作记忆 v0 控件（设置卡片「工作记忆」区）：状态行（已启用→查看约定/停用）+「启用沉淀引导…」=====
        const memoryControl = memStatus === null
          ? e('span', { className: 'dsh-notes-settings-label-s' }, '探测中…')
          : memStatus.enabled
            ? e(React.Fragment, null,
                e('span', { className: 'dsh-notes-settings-label-s' }, '已启用 '),
                e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': '查看引导约定笔记（可见/可改/可删——单一注入源）', onClick: memViewNote }, '查看约定'),
                e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': '停用 = 关闭引导约定笔记的注入（笔记保留可再启用）', onClick: doMemDisable, disabled: memPending }, memPending ? '处理中…' : '停用'))
            : e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': '创建一条预填约定笔记（inject=true，contractType: memory-guide），引导 Agent 在任务收尾时把会话结论写为工作日志（kind=log，默认隐身）——与既有约定并行不冲突', onClick: openMemEnable }, '启用沉淀引导…')
        // 日志卫生窗口控件：周聚合（缺省 7 天）/ 月聚合（缺省 90 天，0=关闭本级）数值输入，失焦/Enter 即保存
        const logWeekControl = e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 1, value: setLogWeek, 'data-tooltip': '超过 N 天的工作日志在整理建议中按 工作区×周 提名聚合（只提名不执行）', onChange: (ev) => setSetLogWeek(ev.target.value), onBlur: saveSettingsLogWeek, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsLogWeek() } })
        const logRetentionControl = e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 1, value: setLogRetention, 'data-tooltip': '超过 N 天提名月聚合（原始日志与周志混合归组）；0 = 关闭月聚合本级', onChange: (ev) => setSetLogRetention(ev.target.value), onBlur: saveSettingsLogRetention, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsLogRetention() } })
        // LLM 用量区（notes-token-stats）：今日/本周/本月/累计 + 按功能分列（分类/整理/总结）；含字符估算时标注「约」
        const usageControl = e('div', { style: { width: '100%' } },
          (usageData && !usageData.error)
            ? e(React.Fragment, null,
                e('div', { className: 'dsh-notes-usage-line' },
                  '今日 ' + fmtTok(usageData.today.total) + ' · 本周 ' + fmtTok(usageData.week.total) + ' · 本月 ' + fmtTok(usageData.month.total) + ' · 累计 ' + fmtTok(usageData.allTime.total) + ' tokens',
                  usageData.calls > 0 ? '（' + usageData.calls + ' 次调用）' : ''),
                e('div', { className: 'dsh-notes-usage-line dsh-notes-usage-sub' },
                  '分类 ' + fmtTok(usageData.byFeature.classify.allTime) + ' · 整理 ' + fmtTok(usageData.byFeature.organize.allTime) + ' · 总结 ' + fmtTok(usageData.byFeature.summarize.allTime)
                    + (usageData.estimatedTokens > 0 ? '（含字符估算，约）' : '')))
            : e('span', { className: 'dsh-notes-settings-label-s' }, usageData && usageData.error ? '用量数据读取失败' : '加载中…'))
        // 月度预算提醒控件：数值输入（tokens/月），失焦/Enter 即保存；0 = 关闭提醒
        const usageBudgetControl = e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 1000, value: setUsageBudget, 'data-tooltip': '本月 LLM token 消耗超过该值时 toast 提醒（仅提醒，不阻断调用）；0 = 关闭', onChange: (ev) => setSetUsageBudget(ev.target.value), onBlur: saveSettingsUsageBudget, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsUsageBudget() } })
        // 通用设置项行列表：以后加设置项只需往这里加行
        const settingsRows = [
          { key: 'llm', label: 'LLM 模型', sub: '笔记自动分类 / 指令提取使用的模型', control: llmControl },
          { key: 'usage', label: 'LLM 用量', sub: '笔记功能的 token 消耗统计（真实 usage 优先，未回传时按字符估算）；按日累计，usage.json 落盘', control: usageControl },
          { key: 'usagebudget', label: '用量预算提醒', sub: '本月 token 消耗超过该值时提醒（仅 toast 提示，不阻断调用）；0 = 关闭', control: usageBudgetControl },
          { key: 'catalog', label: '笔记目录注入', sub: '向 Agent 系统提示注入笔记目录（一行一条），供其规划时参考并按需 note_get 取全文', control: catalogControl },
          { key: 'stale', label: '时效衰减提醒', sub: '目录行对超过 N 天未更新的笔记/链接追加「 ⚠ N 天未更新」标注（提醒参考资料可能过期）；0 = 关闭', control: staleControl },
          { key: 'maxdepth', label: '文件夹嵌套深度', sub: '虚拟文件夹最大嵌套层级（根级 = 第 1 层，缺省 3）；新建子文件夹/拖拽换父超限将拒绝并提示；0 = 不限', control: maxDepthControl },
          { key: 'budget', label: '注入体积预算', sub: '单次注入笔记全文的上限（约，按字符数近似）；约定条目永不截断，资料条目从最旧开始省略；0 = 不限', control: budgetControl },
          { key: 'injprev', label: '注入预览', sub: '查看 Agent 实际收到的注入文本（约定 + 目录）：敏感打码 / 时效标注 / 预算截断效果即所见；可按会话过滤', control: injPrevControl },
          { key: 'injmgr', label: '注入管理', sub: '全库注入总览：逐篇三态直改（关闭/约定/资料）+ 多选批量 + 三态过滤/搜索；日志隐身硬禁，敏感笔记注入自动脱敏', control: injMgrControl },
          // 工作记忆 v0「工作记忆」区：启用沉淀引导（约定笔记方案，裁决 A）+ 日志卫生两级窗口（裁决 B②）
          { key: 'memory', label: '工作记忆', sub: '会话工作结论沉淀为工作日志（kind=log，默认隐身：不进系统提示/目录/默认列表与搜索，筛选中心类型「日志」为专入口）；启用 = 创建一条预填约定笔记（可见/可改/可停用）', control: memoryControl },
          { key: 'logweek', label: '日志周聚合窗口', sub: '超过 N 天的工作日志在整理建议中按 工作区×周 提名聚合（只提名不执行；缺省 7 天）', control: logWeekControl },
          { key: 'logmonth', label: '日志月聚合窗口', sub: '超过 N 天提名月聚合（原始日志与周志混合归组；缺省 90 天）；0 = 关闭月聚合', control: logRetentionControl },
          { key: 'data', label: '数据', sub: '全库目录快照导出 / 单文件拼接导出（图片内联，可分享）/ 从快照目录导入（只增改不删，导入前自动全量备份）/ 回收站兜底（恢复或彻底删除）', control: dataControl },
          { key: 'assets', label: '资产清理', sub: '扫描 assets/ 中未被任何笔记引用的孤儿文件（已删除笔记的引用仍计入保护，宁留勿删）', control: assetsControl },
          { key: 'suggest', label: '整理建议', sub: '速记组归档 / 过期未引用清理 / 孤儿笔记候选（只提名不自动执行）', control: suggestControl },
        ]
        return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) closeSettings() } },
          e('div', { className: 'dsh-notes-settings-modal' },
            // 标题栏动作区（notes-settings-feedback）：还原/保存（dirty 状态机驱动 disabled）+ ✕ 常驻关闭
            e('div', { className: 'dsh-notes-settings-modal-t' }, I('gear', 14), ' 设置',
              e('span', { className: 'dsh-notes-settings-t-acts' },
                e('button', { className: 'dsh-notes-settings-restore dsh-nt', 'data-tooltip': '还原：全部回滚到打开时的设置（逐键恢复）', disabled: !setDirty || setSaving, onClick: restoreSettingsAll }, '还原'),
                e('button', { className: 'dsh-notes-settings-save dsh-nt', 'data-tooltip': '保存：flush 全部未落盘改动并显式确认（自动保存不变，此为兜底 + 确认）', disabled: !setDirty || setSaving, onClick: saveSettingsAll }, setSaving ? '保存中…' : '保存'),
                e('button', { className: 'dsh-notes-settings-close dsh-nt', 'data-tooltip': '关闭（Esc；有未落盘改动先自动 flush）', onClick: closeSettings }, I('x', 12)))),
            e('div', { className: 'dsh-notes-settings-list' },
              settingsRows.map(row => e('div', { key: row.key, className: 'dsh-notes-settings-row' },
                e('div', { className: 'dsh-notes-settings-label' }, row.label, row.sub ? e('span', { className: 'dsh-notes-settings-label-s' }, row.sub) : null),
                e('div', { className: 'dsh-notes-settings-control' }, row.control)))),
            error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null))
      })()
      : null
    }
