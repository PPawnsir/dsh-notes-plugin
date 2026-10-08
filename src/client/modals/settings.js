    // ===== modal: settings —— 设置卡片（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出；D2 收尾模块，序位最末）=====
    // provides: store.modal.settings / settingsOpenRef / usageBudgetRef / setPersistRef / settingsFlushRef / setSettingsOpen / setSettingsData /
    //           setSetLlmProvider / setSetLlmModel / setSetStale / setSetBudget / setUsageData / setSetUsageBudget /
    //           setSetSaving / setSetLogWeek / setSetLogRetention / openSettings / maybeToastUsageBudget /
    //           settingsSetQuiet / setPersistMerge / saveSettings*（Llm/Stale/MaxDepth/Budget/UsageBudget/LlmManual/LogWeek/LogRetention）/
    //           SET_NUM_FIELDS / SET_GROUPS / settingsGroupJump / saveSettingsAll / restoreSettingsAll / flushSettingsPending / closeSettings / SettingsModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/format.js（fmtTok）、kernel/icons.js（e/I）、kernel/bus.js（showToast）、
    //        kernel/i18n.js（langStore/useT/setLang——语言项，notes-042-i18n-mech）、
    //        modals/export.js + export-single.js + import.js + trash.js + prune.js + suggest.js + inject-preview.js + inject-manager.js + memory-guide.js
    //        + cheatsheet.js（设置行入口 open*/do*/memViewNote 与 setMemStatus——序位在前可见，非横向引用）
    // state 托管：open/data/llmProvider/llmModel/stale/budget/usageData/usageBudget/saving/logWeek/logRetention
    // （0.4.4-E：catalog 目录补充行开关随功能整体拆除——设置卡无此控件，host settings-set 对旧设置键静默忽略）
    // 迁入 store.modal.settings 切片；maxDepth/snap/inflight 因 check 锚定其 useState 声明原文滞留 whole.js（同 newNoteKind 先例）——
    // 组件经 props 注入，模块函数经 panelBridge.setMaxDepth/setSetMaxDepth/setSnap/setSetSnap/setInflight/setSetInflight 中转；
    // settingsOpenRef（Esc 栈）/usageBudgetRef（预算判定）/setPersistRef（已落盘镜像）/settingsFlushRef（Esc 兜底 flush）
    // 为模块级单例（plain object 与 useRef 等价——面板为 shell.overlay 单例）；whole.js 经 panelBridge.setSettingsOpen 回填别名中转互斥关闭
    store.modal.settings = createStore({ open: false, data: null, llmProvider: '', llmModel: '', stale: '90', budget: '0', usageData: null, usageBudget: '0', saving: false, logWeek: '7', logRetention: '90', orgMax: '0' })
    const settingsOpenRef = { current: false }   // 设置卡片镜像（Esc 优先关设置卡片）
    const usageBudgetRef = { current: 0 }   // 预算镜像 ref：usage-get 与 settings-get 并发放射，toast 判定读 ref 防闭包过期
    const setPersistRef = { current: null }   // 已落盘值镜像（兜底 flush/还原只写真不同的键）
    const settingsFlushRef = { current: null }   // 关闭兜底 flush 镜像（Esc 闭包挂一次，读最新控件值）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setSettingsOpen(v) { const nv = typeof v === 'function' ? v(settingsOpenRef.current) : v; settingsOpenRef.current = nv; store.modal.settings.set({ open: nv }) }
    function setSettingsData(v) { store.modal.settings.set({ data: typeof v === 'function' ? v(store.modal.settings.get().data) : v }) }
    function setSetLlmProvider(v) { store.modal.settings.set({ llmProvider: typeof v === 'function' ? v(store.modal.settings.get().llmProvider) : v }) }
    function setSetLlmModel(v) { store.modal.settings.set({ llmModel: typeof v === 'function' ? v(store.modal.settings.get().llmModel) : v }) }
    function setSetStale(v) { store.modal.settings.set({ stale: typeof v === 'function' ? v(store.modal.settings.get().stale) : v }) }
    function setSetBudget(v) { store.modal.settings.set({ budget: typeof v === 'function' ? v(store.modal.settings.get().budget) : v }) }
    function setUsageData(v) { store.modal.settings.set({ usageData: typeof v === 'function' ? v(store.modal.settings.get().usageData) : v }) }
    function setSetUsageBudget(v) { store.modal.settings.set({ usageBudget: typeof v === 'function' ? v(store.modal.settings.get().usageBudget) : v }) }
    function setSetSaving(v) { store.modal.settings.set({ saving: typeof v === 'function' ? v(store.modal.settings.get().saving) : v }) }
    function setSetLogWeek(v) { store.modal.settings.set({ logWeek: typeof v === 'function' ? v(store.modal.settings.get().logWeek) : v }) }
    function setSetLogRetention(v) { store.modal.settings.set({ logRetention: typeof v === 'function' ? v(store.modal.settings.get().logRetention) : v }) }
    function setSetOrgMax(v) { store.modal.settings.set({ orgMax: typeof v === 'function' ? v(store.modal.settings.get().orgMax) : v }) }   // 0.4.7-B⑦：整理长度上限（0=按所配模型自动）
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
        setSetStale(String(res.settings && typeof res.settings.staleDays === 'number' ? res.settings.staleDays : 90))   // 时效提醒阈值：缺省 90
        panelBridge.setSetMaxDepth(String(res.settings && typeof res.settings.maxFolderDepth === 'number' ? res.settings.maxFolderDepth : 3))   // 文件夹嵌套深度上限：缺省 3（0=不限）
        setSetBudget(String(res.settings && typeof res.settings.injectBudgetChars === 'number' ? res.settings.injectBudgetChars : 0))   // 注入预算：缺省 0=不限
        setSetUsageBudget(String(res.settings && typeof res.settings.usageBudgetMonthly === 'number' ? res.settings.usageBudgetMonthly : 0))   // 月度用量预算提醒：缺省 0=关闭
        usageBudgetRef.current = (res.settings && typeof res.settings.usageBudgetMonthly === 'number') ? res.settings.usageBudgetMonthly : 0
        setSetLogWeek(String(res.settings && typeof res.settings.logWeekAfterDays === 'number' ? res.settings.logWeekAfterDays : 7))   // 工作记忆 v0：日志周聚合窗口，缺省 7
        setSetLogRetention(String(res.settings && typeof res.settings.logRetentionDays === 'number' ? res.settings.logRetentionDays : 90))   // 日志月聚合窗口，缺省 90（0=关闭本级）
        // 0.4.7-B⑦（notes-047-ux）：整理长度上限——控件回显用户覆盖值（0=按所配模型自动）；生效值读 settings-get 增带的 organizeMaxChars（渲染期取 settingsData）
        setSetOrgMax(String(res.settings && typeof res.settings.organizeMaxChars === 'number' && res.settings.organizeMaxChars > 0 ? res.settings.organizeMaxChars : 0))
        // dirty/还原基准（notes-settings-feedback）：打开时快照（UI 形态字符串口径，与控件受控值同构）+ 已落盘镜像初始化
        const snap0 = {
          llmP: (l && l.provider && l.model) ? l.provider : '', llmM: (l && l.provider && l.model) ? l.model : '',
          stale: String(res.settings && typeof res.settings.staleDays === 'number' ? res.settings.staleDays : 90),
          maxDepth: String(res.settings && typeof res.settings.maxFolderDepth === 'number' ? res.settings.maxFolderDepth : 3),
          budget: String(res.settings && typeof res.settings.injectBudgetChars === 'number' ? res.settings.injectBudgetChars : 0),
          usageBudget: String(res.settings && typeof res.settings.usageBudgetMonthly === 'number' ? res.settings.usageBudgetMonthly : 0),
          logWeek: String(res.settings && typeof res.settings.logWeekAfterDays === 'number' ? res.settings.logWeekAfterDays : 7),
          logRetention: String(res.settings && typeof res.settings.logRetentionDays === 'number' ? res.settings.logRetentionDays : 90),
          orgMax: String(res.settings && typeof res.settings.organizeMaxChars === 'number' && res.settings.organizeMaxChars > 0 ? res.settings.organizeMaxChars : 0),
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
        if (b > 0 && u && u.month && u.month.total > b) showToast(t('settings.usageOverBudget', { used: fmtTok(u.month.total), budget: fmtTok(b) }))
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
      if ('staleDays' in patch) n.stale = String(patch.staleDays)
      if ('maxFolderDepth' in patch) n.maxDepth = String(patch.maxFolderDepth)
      if ('injectBudgetChars' in patch) n.budget = String(patch.injectBudgetChars)
      if ('usageBudgetMonthly' in patch) n.usageBudget = String(patch.usageBudgetMonthly)
      if ('logWeekAfterDays' in patch) n.logWeek = String(patch.logWeekAfterDays)
      if ('logRetentionDays' in patch) n.logRetention = String(patch.logRetentionDays)
      if ('organizeMaxChars' in patch) n.orgMax = String(patch.organizeMaxChars > 0 ? patch.organizeMaxChars : 0)   // 0.4.7-B⑦：0 = 自动（host 删 override），镜像口径同控件
      setPersistRef.current = n
    }
    // 选择即保存：llm=null 恢复跟随当前会话（默认）；否则保存 { provider, model }
    function saveSettingsLlm(llm) {
      settingsSetQuiet({ llm: llm }).then(() => {
        if (panelBridge.orgMaxCacheReset) panelBridge.orgMaxCacheReset()   /* 0.4.7-B⑦：模型变更 → 引导卡生效值缓存失效 */
        showToast(llm ? t('settings.savedLlm', { name: llm.provider + ' / ' + llm.model }) : t('settings.restoredFollow'))
      }).catch(err => setError(String(err.message || err)))
    }
    // P1 时效衰减提醒阈值：失焦/Enter 即保存（非负整数；0 = 关闭；非法输入报错不落盘）
    function saveSettingsStale() {
      const setStale = store.modal.settings.get().stale
      const raw = setStale.trim()
      if (!/^\d+$/.test(raw)) { setError(t('settings.staleInvalid')); return }
      const v = parseInt(raw, 10)
      settingsSetQuiet({ staleDays: v }).then(() => {
        showToast(v === 0 ? t('settings.staleOff') : t('settings.savedStale', { v: v }))
      }).catch(err => setError(String(err.message || err)))
    }
    // 文件夹嵌套深度上限（maxFolderDepth，层；根级=第 1 层，缺省 3，0=不限）：失焦/Enter 即保存（非负整数；非法输入报错不落盘）
    function saveSettingsMaxDepth() {
      const setMaxDepth = panelBridge.setMaxDepth
      const raw = setMaxDepth.trim()
      if (!/^\d+$/.test(raw)) { setError(t('settings.maxDepthInvalid')); return }
      const v = parseInt(raw, 10)
      settingsSetQuiet({ maxFolderDepth: v }).then(() => {
        showToast(v === 0 ? t('settings.maxDepthUnlimited') : t('settings.savedMaxDepth', { v: v }))
      }).catch(err => setError(String(err.message || err)))
    }
    // P1 注入体积预算（约，字符数）：失焦/Enter 即保存（非负整数；0 = 不限；约定条目永不截断）
    function saveSettingsBudget() {
      const setBudget = store.modal.settings.get().budget
      const raw = setBudget.trim()
      if (!/^\d+$/.test(raw)) { setError(t('settings.budgetInvalid')); return }
      const v = parseInt(raw, 10)
      settingsSetQuiet({ injectBudgetChars: v }).then(() => {
        showToast(v === 0 ? t('settings.budgetOff') : t('settings.savedBudget', { v: v }))
      }).catch(err => setError(String(err.message || err)))
    }
    // LLM 月度用量预算提醒（tokens/月）：失焦/Enter 即保存（非负整数；0 = 关闭提醒）；保存后即按当前用量复核一次（超预算 toast，不阻断）
    function saveSettingsUsageBudget() {
      const setUsageBudget = store.modal.settings.get().usageBudget
      const usageData = store.modal.settings.get().usageData
      const raw = setUsageBudget.trim()
      if (!/^\d+$/.test(raw)) { setError(t('settings.usageBudgetInvalid')); return }
      const v = parseInt(raw, 10)
      settingsSetQuiet({ usageBudgetMonthly: v }).then(() => {
        usageBudgetRef.current = v
        showToast(v === 0 ? t('settings.usageBudgetOff') : t('settings.savedUsageBudget', { v: fmtTok(v) }))
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
      if (!/^\d+$/.test(raw)) { setError(t('settings.logWeekInvalid')); return }
      const v = parseInt(raw, 10)
      settingsSetQuiet({ logWeekAfterDays: v }).then(() => {
        showToast(t('settings.savedLogWeek', { v: v }))
      }).catch(err => setError(String(err.message || err)))
    }
    // 日志月聚合窗口（天，缺省 90；0 = 关闭月聚合本级）
    function saveSettingsLogRetention() {
      const setLogRetention = store.modal.settings.get().logRetention
      const raw = setLogRetention.trim()
      if (!/^\d+$/.test(raw)) { setError(t('settings.logMonthInvalid')); return }
      const v = parseInt(raw, 10)
      settingsSetQuiet({ logRetentionDays: v }).then(() => {
        showToast(v === 0 ? t('settings.logMonthOff') : t('settings.savedLogMonth', { v: v }))
      }).catch(err => setError(String(err.message || err)))
    }
    // 0.4.7-B⑦：整理长度上限（字符，0 = 按所配模型自动——host 侧删 override 回落模型表）：失焦/Enter 即保存（非负整数；非法输入报错不落盘）
    function saveSettingsOrgMax() {
      const raw = store.modal.settings.get().orgMax.trim()
      if (!/^\d+$/.test(raw)) { setError(t('settings.organizeMaxInvalid')); return }
      const v = parseInt(raw, 10)
      settingsSetQuiet({ organizeMaxChars: v }).then(() => {
        if (panelBridge.orgMaxCacheReset) panelBridge.orgMaxCacheReset()   /* 0.4.7-B⑦：上限变更 → 引导卡生效值缓存失效 */
        showToast(v === 0 ? t('settings.organizeMaxAuto') : t('settings.savedOrganizeMax', { v: v }))
      }).catch(err => setError(String(err.message || err)))
    }
    // ===== 设置卡交互反馈（notes-settings-feedback）：显式保存 / 还原 / 关闭兜底 flush =====
    // 数值字段登记表（快照键 ↔ 设置 RPC 键 ↔ 校验文案 i18n key）：保存校验/兜底 flush/还原回滚三处共用同一份口径
    // （第 3 列为字典 key，用时 t() 取当下语言——登记表在模块加载期求值，不能直接存译文）
    const SET_NUM_FIELDS = [
      ['stale', 'staleDays', 'settings.staleInvalid'],
      ['maxDepth', 'maxFolderDepth', 'settings.maxDepthInvalid'],
      ['budget', 'injectBudgetChars', 'settings.budgetInvalid'],
      ['usageBudget', 'usageBudgetMonthly', 'settings.usageBudgetInvalid'],
      ['logWeek', 'logWeekAfterDays', 'settings.logWeekInvalid'],
      ['logRetention', 'logRetentionDays', 'settings.logMonthInvalid'],
      ['orgMax', 'organizeMaxChars', 'settings.organizeMaxInvalid'],
    ]
    // ===== 0.4.8 设置分组导航（notes-048-settings-groups；UX候选D n-mus81ly6hvh2）=====
    // 七组分类常量表（冻结）+ 新节登记处：rows = settingsRows key（app/原型 = data-sec 锚，三端同 id 同序）。
    // 新增节须三端同登记进对应组 rows；登记遗漏由 check 111「常量表 ⇄ 节 id 集双向一致」断言兜底（漏登记即红）。
    // 空组整组隐身（rail/chips/组壳不渲染）——组定义保留为登记槽，有节入驻即自动出现。
    // 红线：节内内容与组内节相对顺序不动（0.4.7-B sticky 标题/描述收折/LLM 区零回归）；组块按本表序渲染。
    const SET_GROUPS = [
      { id: 'general', icon: 'gear', labelKey: 'settings.group.general', rows: ['language'] },   // 常规：主题/语言/面板入口类
      { id: 'editor', icon: 'note', labelKey: 'settings.group.editor', rows: [] },   // 编辑器：自动保存/富文本/双链类（待新节登记）
      { id: 'inject', icon: 'bolt', labelKey: 'settings.group.inject', rows: ['stale', 'budget', 'injprev', 'injmgr'] },   // 检索与注入：搜索/注入/挂载类
      { id: 'dispatch', icon: 'clock', labelKey: 'settings.group.dispatch', rows: [] },   // 派发与调度（待新节登记）
      { id: 'ai', icon: 'sparkle', labelKey: 'settings.group.ai', rows: ['llm', 'organizemax', 'usage', 'usagebudget', 'suggest'] },   // AI：LLM 配置/整理上限类
      { id: 'data', icon: 'folder', labelKey: 'settings.group.data', rows: ['maxdepth', 'data', 'assets', 'memory', 'logweek', 'logmonth'] },   // 数据与存储：遥测/备份/存储路径类
      { id: 'about', icon: 'info', labelKey: 'settings.group.about', rows: ['cheatsheet'] },   // 关于：版本/计数/文档链接类
    ]
    // 分组点击定位：滚动容器 = .dsh-notes-settings-modal（与 0.4.7-B sticky 标题同容器，吸顶标题补偿 48px）
    function settingsGroupJump(gid) {
      const modal = document.querySelector('.dsh-notes-settings-modal')
      const g = modal && modal.querySelector('.dsh-notes-settings-group[data-g="' + gid + '"]')
      if (g) modal.scrollTop = modal.scrollTop + (g.getBoundingClientRect().top - modal.getBoundingClientRect().top) - 48
    }
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
      const setOrgMax = store.modal.settings.get().orgMax
      const settingsData = store.modal.settings.get().data
      if (setSaving || !setSnap) return
      const vals = { stale: setStale, maxDepth: setMaxDepth, budget: setBudget, usageBudget: setUsageBudget, logWeek: setLogWeek, logRetention: setLogRetention, orgMax: setOrgMax }
      for (const f of SET_NUM_FIELDS) { if (!/^\d+$/.test(vals[f[0]].trim())) { setError(t(f[2])); return } }
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
        if (panelBridge.orgMaxCacheReset) panelBridge.orgMaxCacheReset()   /* 0.4.7-B⑦：全量保存可能含 orgMax/llm → 引导卡生效值缓存失效（幂等廉价） */
        // 快照跟进到当前控件值（显式确认完成 → dirty 复位，保存按钮回禁用态）
        panelBridge.setSetSnap({ llmP: setLlmProvider, llmM: setLlmModel, stale: setStale, maxDepth: setMaxDepth, budget: setBudget, usageBudget: setUsageBudget, logWeek: setLogWeek, logRetention: setLogRetention, orgMax: setOrgMax })
        usageBudgetRef.current = parseInt(setUsageBudget.trim(), 10)
        showToast(t('settings.savedAll'))
      }, err => { setSetSaving(false); setError(t('common.saveFailed', { msg: String(err && err.message || err) })) })
    }
    // 「还原」：回滚到打开时快照——已落盘 ≠ 快照的键逐键串行写回（逐键恢复），全部控件复位到快照值
    function restoreSettingsAll() {
      const setSaving = store.modal.settings.get().saving
      const setSnap = panelBridge.setSnap
      if (setSaving || !setSnap) return
      const s = setSnap, p = setPersistRef.current || s
      const patches = []
      if (p.llmP !== s.llmP || p.llmM !== s.llmM) patches.push({ llm: (s.llmP && s.llmM) ? { provider: s.llmP, model: s.llmM } : null })
      for (const f of SET_NUM_FIELDS) { if (p[f[0]] !== s[f[0]]) { const o = {}; o[f[1]] = parseInt(s[f[0]], 10); patches.push(o) } }
      setSetSaving(true)
      let seq = Promise.resolve()
      for (const pt of patches) seq = seq.then(() => settingsSetQuiet(pt))
      seq.then(() => {
        setSetSaving(false)
        setSetLlmProvider(s.llmP); setSetLlmModel(s.llmM)
        setSetStale(s.stale); panelBridge.setSetMaxDepth(s.maxDepth); setSetBudget(s.budget)
        setSetUsageBudget(s.usageBudget); setSetLogWeek(s.logWeek); setSetLogRetention(s.logRetention); setSetOrgMax(s.orgMax || '0')
        usageBudgetRef.current = parseInt(s.usageBudget, 10)
        showToast(t('settings.restoredAll'))
      }, err => { setSetSaving(false); setError(t('settings.restoreFailed', { msg: String(err && err.message || err) })) })
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
      const setOrgMax = store.modal.settings.get().orgMax
      const p = setPersistRef.current
      if (!p) return
      const patches = []
      const models0 = (settingsData && settingsData.models) || []
      if (!models0.length && setLlmProvider.trim() && setLlmModel.trim() && (setLlmProvider !== p.llmP || setLlmModel !== p.llmM)) patches.push({ llm: { provider: setLlmProvider.trim(), model: setLlmModel.trim() } })
      const vals = { stale: setStale, maxDepth: setMaxDepth, budget: setBudget, usageBudget: setUsageBudget, logWeek: setLogWeek, logRetention: setLogRetention, orgMax: setOrgMax }
      for (const f of SET_NUM_FIELDS) { const raw = vals[f[0]].trim(); if (/^\d+$/.test(raw) && raw !== p[f[0]]) { const o = {}; o[f[1]] = parseInt(raw, 10); patches.push(o) } }
      if (!patches.length) return
      let seq = Promise.resolve()
      for (const pt of patches) seq = seq.then(() => settingsSetQuiet(pt))
      seq.then(() => { showToast(t('settings.savedAll')) }, err => { showToast(t('settings.flushSaveFailed', { msg: String(err && err.message || err) })) })
    }
    // ✕/Esc/点遮罩统一关闭入口：有未落盘改动先兜底 flush（fire-and-forget，落盘完成自 toast），再收起
    function closeSettings() { flushSettingsPending(); setSettingsOpen(false) }
    // 0.4.7-B①b（notes-047-ux）：设置行 label 组件——说明文字 >60 字时限 2 行收折（.cl），行名旁出 ⓘ 钮展开/收拢（原生 button 键盘可达）；
    //   展开态为本组件 useState（随行 key 存续；app modals/settings.js 的 setLabelHtml 同口径）
    function SettingsRowLabel(props) {
      const tt = useT()
      const [exp, setExp] = React.useState(false)
      const long = typeof props.sub === 'string' && props.sub.length > 60
      return e('div', { className: 'dsh-notes-settings-label' },
        props.label,
        long ? e('button', { className: 'dsh-notes-settings-sx', type: 'button', title: tt('settings.descExpandTip'), 'aria-label': tt('settings.descExpandTip'), onClick: () => setExp(!exp) }, 'ⓘ') : null,
        props.sub ? e('span', { className: 'dsh-notes-settings-label-s' + (long && !exp ? ' cl' : '') }, props.sub) : null)
    }
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
      const setStale = store.modal.settings.useSel(s => s.stale)
      const setBudget = store.modal.settings.useSel(s => s.budget)
      const usageData = store.modal.settings.useSel(s => s.usageData)
      const setUsageBudget = store.modal.settings.useSel(s => s.usageBudget)
      const setSaving = store.modal.settings.useSel(s => s.saving)
      const setLogWeek = store.modal.settings.useSel(s => s.logWeek)
      const setLogRetention = store.modal.settings.useSel(s => s.logRetention)
      const setOrgMax = store.modal.settings.useSel(s => s.orgMax)
      // i18n 语言态（notes-042-i18n-mech）：订阅 langStore——切换语言本卡即时重渲染为新语言；tt = 本组件 t()
      const lang = langStore.useSel(s => s.lang)
      const tt = useT()
      // maxDepth/snap/inflight 滞留 whole.js（check 锚定 useState 声明原文），经 props 注入
      const setMaxDepth = props.setMaxDepth
      const setSetMaxDepth = props.setSetMaxDepth
      const setSnap = props.setSnap
      const setInflight = props.setInflight
      // 工作记忆 v0 状态行数据源（memory-guide 模块切片；设置卡「工作记忆」区状态行/停用按钮消费）
      const memStatus = store.modal.memory.useSel(s => s.status)
      const memPending = store.modal.memory.useSel(s => s.pending)
      const error = props.error
      const [setGroupCur, setSetGroupCur] = React.useState('')   // 0.4.8：当前组（滚动反高亮数据源；值 = SET_GROUPS id）
      React.useEffect(() => { settingsFlushRef.current = flushSettingsPending })   // 关闭兜底 flush 镜像：每渲染刷新（Esc 闭包读最新控件值；函数声明提升可前引）
      /* 0.4.6-H（R2 n-mux9svn0vhkz）：校验错误渲染位移到标题栏下（原在弹窗最底部需滚动可见）+ 出现即滚回顶部，消除「保存看似没反应」 */
      React.useEffect(() => { if (error) { try { const m = document.querySelector('.dsh-notes-settings-modal'); if (m) m.scrollTop = 0 } catch (e) {} } }, [error])
      /* 0.4.8（notes-048-settings-groups）：滚动监听反高亮当前组——视口顶缘 56px 阈值内末命中组 = 当前组（rail/chips 共享 setGroupCur）；
         监听挂在滚动容器 .dsh-notes-settings-modal 上（与 0.4.7-B sticky 标题同容器），关卡即卸载（settingsOpen 翻转重建节点） */
      React.useEffect(() => {
        if (!settingsOpen) return
        const modal = document.querySelector('.dsh-notes-settings-modal')
        if (!modal) return
        const spy = () => {
          const top = modal.getBoundingClientRect().top
          const gs = modal.querySelectorAll('.dsh-notes-settings-group')
          let cur = ''
          for (let i = 0; i < gs.length; i++) if (gs[i].getBoundingClientRect().top - top <= 56) cur = gs[i].getAttribute('data-g')
          if (!cur && gs.length) cur = gs[0].getAttribute('data-g')   // 顶部落首组（概念速览块压在首组上方，滚顶时首组未过 56px 阈值——首组兜底=当前组）
          if (gs.length && modal.scrollTop + modal.clientHeight >= modal.scrollHeight - 2) cur = gs[gs.length - 1].getAttribute('data-g')   // 触底锁末组（末组高度不足上顶 56px 阈值时的归宿——scroll-spy 标准兜底）
          setSetGroupCur(cur)
        }
        modal.addEventListener('scroll', spy, { passive: true })
        spy()
        return () => modal.removeEventListener('scroll', spy)
      }, [settingsOpen])
      return settingsOpen ? (() => {
        // dirty 判定口径：存在在途未落盘待写（setInflight>0）或 任一控件值 ≠ 打开时快照
        const setDirty = setInflight > 0 || (setSnap ? (
          setLlmProvider !== setSnap.llmP || setLlmModel !== setSnap.llmM ||
          setStale !== setSnap.stale || setMaxDepth !== setSnap.maxDepth || setBudget !== setSnap.budget ||
          setUsageBudget !== setSnap.usageBudget || setLogWeek !== setSnap.logWeek || setLogRetention !== setSnap.logRetention ||
          setOrgMax !== (setSnap.orgMax || '0')) : false)
        const modelList = (settingsData && settingsData.models) || []
        // 下拉选项 = provider/model 组合，第一项「跟随当前会话（默认）」；
        // 已保存值不在列表中（如模型已下线）时追加一项保证回显正确
        const selIdx = modelList.findIndex(m => m.provider === setLlmProvider && m.model === setLlmModel)
        const opts = (setLlmProvider && setLlmModel && selIdx < 0)
          ? modelList.concat([{ provider: setLlmProvider, model: setLlmModel, label: setLlmProvider + ' / ' + setLlmModel + tt('settings.savedSuffix') }])
          : modelList
        const curVal = selIdx >= 0 ? String(selIdx) : (opts.length > modelList.length ? String(opts.length - 1) : '')
        const llmControl = modelList.length
          ? e('select', { className: 'dsh-notes-settings-select', value: curVal, 'data-tooltip': tt('settings.llmTip'), onChange: (ev) => {
                const v = ev.target.value
                if (v === '') { setSetLlmProvider(''); setSetLlmModel(''); saveSettingsLlm(null) }
                else { const m = opts[+v]; if (m) { setSetLlmProvider(m.provider); setSetLlmModel(m.model); saveSettingsLlm({ provider: m.provider, model: m.model }) } }
              } },
              e('option', { value: '' }, tt('settings.followSession')),
              opts.map((m, i) => e('option', { key: m.provider + '/' + m.model + '-' + i, value: String(i) }, m.label || (m.provider + ' / ' + m.model))))
          : e(React.Fragment, null,
              e('input', { className: 'dsh-notes-settings-input', placeholder: 'provider', value: setLlmProvider, onChange: (ev) => setSetLlmProvider(ev.target.value), onBlur: saveSettingsLlmManual, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsLlmManual() } }),
              e('input', { className: 'dsh-notes-settings-input', placeholder: 'model', value: setLlmModel, onChange: (ev) => setSetLlmModel(ev.target.value), onBlur: saveSettingsLlmManual, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsLlmManual() } }),
              (setLlmProvider || setLlmModel) ? e('button', { className: 'dsh-notes-settings-clear', onClick: () => { setSetLlmProvider(''); setSetLlmModel(''); saveSettingsLlm(null) } }, tt('settings.followSession')) : null)
        // 0.4.7-B⑦（notes-047-ux）：整理长度上限控件（LLM 区紧随模型行）——数值输入（字符），失焦/Enter 即保存；0 = 按所配模型自动（说明文字带生效值）
        const orgMaxEff = (settingsData && typeof settingsData.organizeMaxChars === 'number' && settingsData.organizeMaxChars > 0) ? settingsData.organizeMaxChars : 12000
        const orgMaxControl = e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 1000, value: setOrgMax, 'data-tooltip': tt('settings.organizeMaxTip', { eff: orgMaxEff }), onChange: (ev) => setSetOrgMax(ev.target.value), onBlur: saveSettingsOrgMax, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsOrgMax() } })
        // P1 时效衰减提醒控件：数值输入（天），失焦/Enter 即保存；0 = 关闭
        const staleControl = e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 1, value: setStale, 'data-tooltip': tt('settings.staleTipT'), onChange: (ev) => setSetStale(ev.target.value), onBlur: saveSettingsStale, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsStale() } })
        // 文件夹嵌套深度上限控件（同 staleDays 输入交互）：数值输入（层），失焦/Enter 即保存；0 = 不限层数
        const maxDepthControl = e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 1, value: setMaxDepth, 'data-tooltip': tt('settings.maxDepthTipT'), onChange: (ev) => setSetMaxDepth(ev.target.value), onBlur: saveSettingsMaxDepth, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsMaxDepth() } })
        // P1 注入体积预算控件：数值输入（约，字符数）+ 仪表（最近一次注入体积 vs 预算，超预算变红）；约定条目永不截断
        const lastChars = (settingsData && typeof settingsData.lastInjectChars === 'number') ? settingsData.lastInjectChars : 0
        const budgetNum = /^\d+$/.test(setBudget.trim()) ? parseInt(setBudget.trim(), 10) : 0
        const gaugePct = budgetNum > 0 ? Math.min(100, Math.round(lastChars / budgetNum * 100)) : 0
        const budgetControl = e('div', { style: { width: '100%' } },
          e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 100, value: setBudget, 'data-tooltip': tt('settings.budgetTip'), onChange: (ev) => setSetBudget(ev.target.value), onBlur: saveSettingsBudget, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsBudget() } }),
          e('div', { className: 'dsh-notes-inject-gauge dsh-nt', 'data-tooltip': tt('settings.gaugeTip') },
            e('div', { className: 'dsh-notes-inject-gauge-bar' + (budgetNum > 0 && lastChars > budgetNum ? ' over' : ''), style: { width: gaugePct + '%' } })),
          e('span', { className: 'dsh-notes-inject-gauge-t' }, tt('settings.gaugeCurrent', { last: lastChars }) + (budgetNum > 0 ? ' / ' + tt('settings.gaugeBudget', { budget: budgetNum }) : tt('settings.gaugeUnlimited'))))
        // 数据区控件：导出全部（目录快照）/ 导出单文件…（P3 scope 拼接 + 图片内联）/ 导入…（两步式预览后执行）/ 回收站（底部收敛后的兜底入口）；点击即关设置卡片、开各自对话框
        const dataControl = e(React.Fragment, null,
          e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.exportAllTip'), onClick: openExport }, tt('settings.exportAll')),
          e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.exportSingleTip'), onClick: openSExport }, tt('settings.exportSingle')),
          e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.importTip'), onClick: openImport }, tt('settings.importBtn')),
          e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('topbar.trashTip'), onClick: openTrash }, tt('topbar.trash')))
        // 二期 资产清理控件：notes-assets-prune dry-run 预览 → 勾选删除（点击即关设置卡片、开预览对话框）
        const assetsControl = e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.assetsTipT'), onClick: openPrune }, tt('settings.pruneBtn'))
        // 整理建议控件：打开三段式建议 modal（点击即关设置卡片、modal 不叠 modal）——底部「整理」按钮收敛后此处为入口
        const suggestControl = e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.suggestTipT'), onClick: openSuggest }, tt('settings.openBtn'))
        // 键盘快捷键控件：打开速查表（点击即关设置卡片、modal 不叠 modal，同注入管理先例；非输入焦点时 ? 键直达）
        const cheatsheetControl = e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.cheatsheetTipT'), onClick: openCheatsheet }, tt('settings.viewBtn'))
        // 注入预览控件：打开预览 modal（点击即关设置卡片、modal 不叠 modal）——agent 实际收到的注入文本即所见
        const injPrevControl = e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.injPreviewTipT'), onClick: openInjectPreview }, tt('settings.previewBtn'))
        // 注入管理控件：打开注入管理面板（点击即关设置卡片、modal 不叠 modal）——全库注入三态总览 + 单行直改 / 多选批量
        const injMgrControl = e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.injManagerTipT'), onClick: () => openInjectManager('settings') }, tt('settings.manageBtn'))   // from=settings：单层返回栈（notes-041-settings-back），关闭二级面板自动回本卡
        // ===== 工作记忆 v0 控件（设置卡片「工作记忆」区）：状态行（已启用→查看约定/停用）+「启用沉淀引导…」=====
        const memoryControl = memStatus === null
          ? e('span', { className: 'dsh-notes-settings-label-s' }, tt('settings.memProbing'))
          : memStatus.enabled
            ? e(React.Fragment, null,
                e('span', { className: 'dsh-notes-settings-label-s' }, tt('settings.memEnabled') + ' '),
                e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.memViewTip'), onClick: memViewNote }, tt('settings.memView')),
                e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.memDisableTip'), onClick: doMemDisable, disabled: memPending }, memPending ? tt('settings.memPending') : tt('settings.memDisable')))
            : e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.memEnableTip'), onClick: () => openMemEnable('settings') }, tt('settings.memEnable'))   // from=settings：单层返回栈（notes-041-settings-back），关闭/启用成功后回本卡
        // 日志卫生窗口控件：周聚合（缺省 7 天）/ 月聚合（缺省 90 天，0=关闭本级）数值输入，失焦/Enter 即保存
        const logWeekControl = e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 1, value: setLogWeek, 'data-tooltip': tt('settings.logWeekTipT'), onChange: (ev) => setSetLogWeek(ev.target.value), onBlur: saveSettingsLogWeek, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsLogWeek() } })
        const logRetentionControl = e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 1, value: setLogRetention, 'data-tooltip': tt('settings.logMonthTipT'), onChange: (ev) => setSetLogRetention(ev.target.value), onBlur: saveSettingsLogRetention, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsLogRetention() } })
        // LLM 用量区（notes-token-stats）：今日/本周/本月/累计 + 按功能分列（分类/整理/总结）；含字符估算时标注「约」
        const usageControl = e('div', { style: { width: '100%' } },
          (usageData && !usageData.error)
            ? e(React.Fragment, null,
                e('div', { className: 'dsh-notes-usage-line' },
                  tt('settings.usageLine', { today: fmtTok(usageData.today.total), week: fmtTok(usageData.week.total), month: fmtTok(usageData.month.total), all: fmtTok(usageData.allTime.total) }),
                  usageData.calls > 0 ? tt('settings.usageCalls', { n: usageData.calls }) : ''),
                e('div', { className: 'dsh-notes-usage-line dsh-notes-usage-sub' },
                  tt('settings.usageByFeature', { classify: fmtTok(usageData.byFeature.classify.allTime), organize: fmtTok(usageData.byFeature.organize.allTime), summarize: fmtTok(usageData.byFeature.summarize.allTime) })
                    + (usageData.estimatedTokens > 0 ? tt('settings.usageEstimated') : '')))
            : e('span', { className: 'dsh-notes-settings-label-s' }, usageData && usageData.error ? tt('settings.usageLoadFailed') : tt('common.loading')))
        // 月度预算提醒控件：数值输入（tokens/月），失焦/Enter 即保存；0 = 关闭提醒
        const usageBudgetControl = e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 1000, value: setUsageBudget, 'data-tooltip': tt('settings.usageBudgetTipT'), onChange: (ev) => setSetUsageBudget(ev.target.value), onBlur: saveSettingsUsageBudget, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsUsageBudget() } })
        // i18n 语言项控件（notes-042-i18n-mech）：localStorage 本地记忆、选择即生效（setLang → langStore 广播全量重渲染）；
        // 不走 settings.json，不参与 dirty 状态机
        const langControl = e('select', { className: 'dsh-notes-settings-select', value: lang, 'data-tooltip': tt('settings.languageTip'), onChange: (ev) => setLang(ev.target.value) },
          e('option', { value: 'zh' }, '中文'),
          e('option', { value: 'en' }, 'English'))
        // 通用设置项行列表：以后加设置项只需往这里加行（0.4.8 起同步登记 SET_GROUPS.rows，check 111 双向一致断言兜底）
        const settingsRows = [
          { key: 'language', label: tt('settings.language'), sub: tt('settings.languageTip'), control: langControl },
          { key: 'llm', label: tt('settings.llm'), sub: tt('settings.llmTip'), control: llmControl },
          // 0.4.7-B⑦：整理长度上限行（LLM 区紧随模型行；sub 带生效值 = settings-get 增带键，零新 RPC）
          { key: 'organizemax', label: tt('settings.organizeMax'), sub: tt('settings.organizeMaxTip', { eff: orgMaxEff }), control: orgMaxControl },
          { key: 'usage', label: tt('settings.usage'), sub: tt('settings.usageTip'), control: usageControl },
          { key: 'usagebudget', label: tt('settings.usageBudget'), sub: tt('settings.usageBudgetTip'), control: usageBudgetControl },
          { key: 'stale', label: tt('settings.stale'), sub: tt('settings.staleTip'), control: staleControl },
          { key: 'maxdepth', label: tt('settings.maxDepth'), sub: tt('settings.maxDepthTip'), control: maxDepthControl },
          { key: 'budget', label: tt('settings.budget'), sub: tt('settings.budgetTip'), control: budgetControl },
          { key: 'injprev', label: tt('settings.injPreview'), sub: tt('settings.injPreviewTip'), control: injPrevControl },
          { key: 'injmgr', label: tt('settings.injManager'), sub: tt('settings.injManagerTip'), control: injMgrControl },
          // 工作记忆 v0「工作记忆」区：启用沉淀引导（约定笔记方案，裁决 A）+ 日志卫生两级窗口（裁决 B②）
          { key: 'memory', label: tt('settings.memory'), sub: tt('settings.memoryTip'), control: memoryControl },
          { key: 'logweek', label: tt('settings.logWeek'), sub: tt('settings.logWeekTip'), control: logWeekControl },
          { key: 'logmonth', label: tt('settings.logMonth'), sub: tt('settings.logMonthTip'), control: logRetentionControl },
          { key: 'data', label: tt('settings.data'), sub: tt('settings.dataTipClient'), control: dataControl },
          { key: 'assets', label: tt('settings.assets'), sub: tt('settings.assetsTip'), control: assetsControl },
          { key: 'suggest', label: tt('settings.suggest'), sub: tt('settings.suggestTipClient'), control: suggestControl },
          // 键盘流速查表入口（notes-034-f-cheatsheet）：内容与 keyboard.js 逐键核对；? 键为直达通道
          { key: 'cheatsheet', label: tt('settings.cheatsheet'), sub: tt('settings.cheatsheetTip'), control: cheatsheetControl },
        ]
        /* 0.4.8：分组壳渲染——key→行 索引 + 可见组（空组隐身）+ rail（图标+组名，sticky 随滚）/ chips（窄宽 <560px 退化，CSS 媒体查询切换）；
           节内内容与组内节相对顺序不动，组块按 SET_GROUPS 表序渲染 */
        const settingsRowByKey = {}
        settingsRows.forEach(row => { settingsRowByKey[row.key] = row })
        const settingsGroupVis = SET_GROUPS.map(g => ({ g: g, rows: g.rows.map(k => settingsRowByKey[k]).filter(Boolean) })).filter(x => x.rows.length > 0)
        const renderSetRow = (row) => e('div', { key: row.key, className: 'dsh-notes-settings-row' },
          e(SettingsRowLabel, { label: row.label, sub: row.sub }),   /* 0.4.7-B①b：长说明收折 ⓘ 展开（组件态随行 key 存续） */
          e('div', { className: 'dsh-notes-settings-control' }, row.control))
        return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) closeSettings() } },
          e('div', { className: 'dsh-notes-settings-modal' },
            // 标题栏动作区（notes-settings-feedback）：还原/保存（dirty 状态机驱动 disabled）+ ✕ 常驻关闭
            e('div', { className: 'dsh-notes-settings-modal-t' }, I('gear', 14), ' ' + tt('common.settings'),
              e('span', { className: 'dsh-notes-settings-t-acts' },
                e('button', { className: 'dsh-notes-settings-restore dsh-nt', 'data-tooltip': tt('settings.restoreTip'), disabled: !setDirty || setSaving, onClick: restoreSettingsAll }, tt('common.restore')),
                e('button', { className: 'dsh-notes-settings-save dsh-nt', 'data-tooltip': tt('settings.saveTip'), disabled: !setDirty || setSaving, onClick: saveSettingsAll }, setSaving ? tt('settings.saving') : tt('common.save')),
                e('button', { className: 'dsh-notes-settings-close dsh-nt', 'data-tooltip': tt('settings.closeTip'), onClick: closeSettings }, I('x', 12)))),
            /* 0.4.6-H：错误区锚定位 = 标题栏正下方（保存按钮旁视野内；原渲染在列表最底部） */
            error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
            /* onboarding 轻量（notes-034-batch3）：设置卡顶部四概念一行一条速览（注入/约定·资料/目录注入/派发）——新用户前置解释；
               0.4.7-B①c：bullet 逐条 .dsh-notes-onb-li 悬挂缩进（续行对齐文字起点，折行参差消除）；0.4.8：速览独立于分组导航之上（不归组） */
            e('div', { className: 'dsh-notes-data-hint' },
              e('b', null, tt('settings.onboardTitle')),
              e('div', { className: 'dsh-notes-onb-li' }, tt('settings.onboardInject')),
              e('div', { className: 'dsh-notes-onb-li' }, tt('settings.onboardRoles')),
              e('div', { className: 'dsh-notes-onb-li' }, tt('settings.onboardCatalog')),
              e('div', { className: 'dsh-notes-onb-li' }, tt('settings.onboardDispatch'))),
            e('div', { className: 'dsh-notes-settings-layout' },
              e('div', { className: 'dsh-notes-settings-rail', role: 'navigation', 'aria-label': tt('settings.group.nav') },
                settingsGroupVis.map(x => e('button', {
                  key: x.g.id, type: 'button', 'data-g': x.g.id,
                  className: 'dsh-notes-settings-rail-item' + (setGroupCur === x.g.id ? ' on' : ''),
                  'aria-current': setGroupCur === x.g.id ? 'true' : undefined,
                  onClick: () => settingsGroupJump(x.g.id),
                }, I(x.g.icon, 12), e('span', null, tt(x.g.labelKey))))),
              e('div', { className: 'dsh-notes-settings-main' },
                e('div', { className: 'dsh-notes-settings-chips' },
                  settingsGroupVis.map(x => e('button', {
                    key: x.g.id, type: 'button', 'data-g': x.g.id,
                    className: 'dsh-notes-settings-chip' + (setGroupCur === x.g.id ? ' on' : ''),
                    onClick: () => settingsGroupJump(x.g.id),
                  }, tt(x.g.labelKey)))),
                e('div', { className: 'dsh-notes-settings-list' },
                  settingsGroupVis.map(x => e('div', { key: x.g.id, className: 'dsh-notes-settings-group', 'data-g': x.g.id },
                    e('div', { className: 'dsh-notes-settings-group-t' }, tt(x.g.labelKey)),
                    x.rows.map(renderSetRow))))))))
      })()
      : null
    }
