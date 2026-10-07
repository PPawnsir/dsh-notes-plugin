    const PAGE_SIZE = 50
    // ==== group-paging BEGIN ====
    // 0.4.6-J（notes-046-group-paging）：分组分页纯函数核——懒加载死锁根修（反馈 n-muxyj3zodvf3：全局 flat 窗口切片在
    // 文件夹收起时树内容过短 → 无滚动条 → 滚动加载永不触发 → 窗口外条目无途径够到）。分页单位从全局切片改为
    // 分组各自分页（置顶/文件夹/未入夹/主题四组同构），组尾「加载更多（还有 N 条）」按钮行翻页，不再依赖滚动。
    // key = 组标识（'pinned' / folder.id / 'unfiled' / 'topic:'+主题名）；value = 该组当前显示条数（缺省 PAGE_SIZE）。
    // 组内 cap PAGE_SIZE 性能闸保留：总渲染量 = Σ min(组命中, PAGE_SIZE)，小库≈全量（与 app 端恒全量口径收敛）。
    // check 节 1.5 提取本块 eval 回归（folder-tree-helpers / i18n-mech 同姿势）。
    function groupShownOf(gs, key) { return (gs && gs[key]) || PAGE_SIZE }
    function groupPage(list, gs, key) { return list.slice(0, groupShownOf(gs, key)) }
    function groupMoreCount(list, gs, key) { return Math.max(0, list.length - groupShownOf(gs, key)) }
    function groupPageNext(gs, key) { const next = Object.assign({}, gs); next[key] = groupShownOf(gs, key) + PAGE_SIZE; return next }
    // ==== group-paging END ====
    // 0.4.6-B（notes-046-rpc-resilience）：落地页无活跃会话开面板——首取数挂起超阈给空态引导（「打开一个会话后使用」+ 重试），不再无限「加载中…」假死
    const LANDING_STALL_MS = 6000
    const KIND_LABELS = { note: '笔记', decision: '决策', todo: '待办', link: '链接', quote: '引用', log: '日志', sys: '机器' }   /* 0.4.3⑩ +sys「机器」（筛选中心「机器」档标签/持久化校验用；编辑器/新建 kind 选项不收 sys——机器托管 kind 人工不转） */
    // ---- 二期：kind 模板骨架（新建笔记预填）——与 host-impl.js / index.mjs / app.html / 原型同一份（check.js 断言一致）----
    // note 为自由格式（空骨架）；机器/运维信息类由 ✨整理按内容套用机器模板（建时无法预判内容，不进 KIND_TEMPLATES）
    const KIND_TEMPLATES = {
      note: '',
      decision: '## 背景\n\n（问题与上下文）\n\n## 结论\n\n（最终选择）\n\n## 理由\n\n（权衡与依据）\n',
      todo: '- [ ] （待办事项）\n',
      link: '## 链接\n\n（URL）\n\n## 说明\n\n（用途与要点）\n',
      quote: '> （引用原文）\n\n—— （出处）\n',
      // 工作记忆 v0 工作日志模板（design/agent-memory-v0.md §4.2 四节结构；同日追加尾部加「## HH:mm 续」小节）
      log: '## 做了什么\n\n（本会话完成的任务/阶段，一句话一条）\n\n## 改动\n\n（改动的文件/配置/数据，路径 + 一句话）\n\n## 遗留与后续\n\n（未完成事项、已知风险、下次接续的入口）\n\n## 相关笔记\n\n（[[n-xxxxxxxx]] 双链引用本库相关笔记；无则空）\n'
    }
    // ===== 筛选中心（design/notes-filter-center.html 落地）：状态组/类型组多选，组内 OR / 跨组 AND =====
    // 与 app.html / 原型 notes-ui-v2.html 同一份条件模型（check.js 断言一致）；injectEver 字段由 notes-inject-filter 任务提供，feature-detect（slim 有该字段才显示选项）
    const FILTER_STATUS = [
      { id: 'pinned', label: '置顶', icon: 'pin', pred: n => n.status === 'pinned' },
      { id: 'injected', label: '已注入', icon: 'bolt', pred: n => n.inject === true },
      { id: 'injectEver', label: '曾注入', icon: 'clock', pred: n => n.injectEver === true },
      { id: 'sensitive', label: '敏感', icon: 'lock', pred: n => n.sensitive === true },
    ]
    const FILTER_KINDS = ['note', 'decision', 'todo', 'link', 'quote', 'log', 'sys']   // 类型组含 log（0.4.3⑦ 日志同权：勾选「日志」= 只看日志，与普通 kind 过滤同语义，不再是隐身专入口）+ sys（0.4.3⑩「机器」档：勾选=全库 sys 机器笔记（含「记忆档案」夹内档案）经 host kind 通道直达，面板翻账本入口）
    const FILTER_SORTS = [
      { id: 'time', label: '时间', desc: '置顶优先 · 更新降序（默认）' },
      { id: 'use', label: '引用', desc: '被引用次数降序' },
      { id: 'rel', label: '相关度', desc: '搜索打分（搜索时生效）' },
    ]
    const FILTERS0 = () => ({ pinned: false, injected: false, injectEver: false, sensitive: false, kinds: [] })
    // 筛选条件 + 排序档位持久化（dsh-notes-filters；kinds 按已知 kind 校验，sortBy 非法值回退 time）
    function loadFiltersState() {
      const F = FILTERS0()
      try {
        const v = localStorage.getItem('dsh-notes-filters')
        if (!v) return { filters: F, sortBy: 'time' }
        const s = JSON.parse(v) || {}
        if (s.filters) {
          ['pinned', 'injected', 'injectEver', 'sensitive'].forEach(k => { F[k] = s.filters[k] === true })
          if (Array.isArray(s.filters.kinds)) F.kinds = s.filters.kinds.filter(k => !!KIND_LABELS[k])
        }
        return { filters: F, sortBy: (s.sortBy === 'use' || s.sortBy === 'rel') ? s.sortBy : 'time' }
      } catch (err) { return { filters: F, sortBy: 'time' } }
    }
    // 筛选谓词（纯函数，check.js 提取做语义回归）：状态组组内 OR、类型组组内 OR、跨组 AND
    function matchFilters(n, F) {
      const st = []
      if (F.pinned) st.push(n.status === 'pinned')
      if (F.injected) st.push(n.inject === true)
      if (F.injectEver) st.push(n.injectEver === true)
      if (F.sensitive) st.push(n.sensitive === true)
      if (st.length && st.indexOf(true) < 0) return false
      if (F.kinds.length && F.kinds.indexOf(n.kind || 'note') < 0) return false
      return true
    }
    // ===== i18n 覆盖卡F（notes-042-i18n-cov-f，B 卡交接①）：共享常量表条件映射——KIND_LABELS/FILTER_STATUS/FILTER_SORTS 的
    //    label 中文字面量保留作四端同构锚（check 30/34/39 锁定原文 + 原型不双语红线），渲染一律经下列 helper 走 t() 字典
    //    （kernel/i18n.js 序位在前，langStore 订阅者自渲染即换语言）；未知值回退 ''（调用方 || 兜底），永不裸 key =====
    function kindLabel(k) { return KIND_LABELS[k] ? t('meta.kind' + k.charAt(0).toUpperCase() + k.slice(1)) : '' }
    function filterStatusLabel(id) { return id === 'pinned' ? t('tree.pinned') : id === 'injected' ? t('filter.stInjected') : id === 'injectEver' ? t('meta.injectEver') : id === 'sensitive' ? t('meta.sens') : id }
    function sortLabelOf(id) { return t('sort.' + (id === 'use' || id === 'rel' ? id : 'time')) }
    function sortDescOf(id) { return t('sort.' + (id === 'use' || id === 'rel' ? id : 'time') + 'Desc') }
