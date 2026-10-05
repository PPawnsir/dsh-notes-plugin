    // ---- 设置持久化（SETTINGS_PATH）：内存缓存 + 启动加载；文件坏/不存在 → {}（容错）----
    // 通用结构：设置项是 settingsCache 的顶层键（llm 选配 + catalogEnabled 目录索引总开关（缺省 = 关，显式 true 开启）+ staleDays 时效标注 + injectBudgetChars 注入预算 + maxFolderDepth 文件夹嵌套深度上限），client 经 notes-settings-get/set 读写。
    // .json 后缀不进笔记列表（_list 只认 .md），settings.json 落在同目录天然不污染列表。
    const SETTINGS_PATH = NOTES_DIR + '\\settings.json'
    // LLM token 消耗统计落盘（独立于 settings.json：计量数据高频防抖写，与低频设置写隔离，互不坏档）
    const USAGE_PATH = NOTES_DIR + '\\usage.json'
    let settingsCache = {}
    let settingsLoadPromise = null
    function loadSettings() {
      if (!settingsLoadPromise) {
        settingsLoadPromise = (async () => {
          try {
            const p = await fs.resolve(SETTINGS_PATH)
            const c = await fs.readText(p)
            const obj = JSON.parse(c)
            settingsCache = (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {}
          } catch (e) { /* 文件不存在/损坏 → 空设置：默认行为（跟随会话 + 目录关）不变 */ }
          return settingsCache
        })()
      }
      return settingsLoadPromise
    }
    async function saveSettings() {
      const p = await fs.resolve(SETTINGS_PATH)
      await fs.writeText(p, JSON.stringify(settingsCache, null, 2), undefined, undefined, getPolicy())
    }
    // ---- P1 注入增强：时效衰减提醒 + 注入体积预算（settings.json 顶层键，null 删除 override 恢复缺省）----
    // staleDays：目录行时效标注阈值（天），缺省 90；0 = 关闭。只标注 kind=note/link 的参考资料类条目。
    // injectBudgetChars：单次注入体积预算（约，按字符数近似统计，不引 token 计算库），缺省 0 = 不限；
    //   约定桶永不截断；资料桶超预算时从最旧条目开始整条省略，尾部追加提示行。
    // lastInjectChars：最近一次 conventionText 渲染产物的字符数（每次渲染更新缓存值；设置卡片仪表数据源，settings-get 回传）。
    const STALE_DAYS_DEFAULT = 90
    function staleDaysLimit() {
      const v = settingsCache && settingsCache.staleDays
      return (typeof v === 'number' && isFinite(v) && v >= 0) ? Math.floor(v) : STALE_DAYS_DEFAULT
    }
    function injectBudgetChars() {
      const v = settingsCache && settingsCache.injectBudgetChars
      return (typeof v === 'number' && isFinite(v) && v >= 0) ? Math.floor(v) : 0
    }
    // ---- 工作记忆 v0 日志卫生窗口（settings.json 顶层键，null 删除 override 恢复缺省；§6.3 两级聚合提名阈值）----
    // logWeekAfterDays：周聚合提名窗口（天），缺省 7；logRetentionDays：月聚合提名窗口（天），缺省 90，0 = 关闭月聚合本级
    const LOG_WEEK_AFTER_DAYS_DEFAULT = 7
    const LOG_RETENTION_DAYS_DEFAULT = 90
    function logWeekAfterDaysLimit() {
      const v = settingsCache && settingsCache.logWeekAfterDays
      return (typeof v === 'number' && isFinite(v) && v >= 0) ? Math.floor(v) : LOG_WEEK_AFTER_DAYS_DEFAULT
    }
    function logRetentionDaysLimit() {
      const v = settingsCache && settingsCache.logRetentionDays
      return (typeof v === 'number' && isFinite(v) && v >= 0) ? Math.floor(v) : LOG_RETENTION_DAYS_DEFAULT
    }
    // ---- 文件夹嵌套深度上限（settings.json 顶层键 maxFolderDepth，null 删除 override 恢复缺省）----
    // maxFolderDepth：虚拟文件夹嵌套最大层级（根级文件夹 = 第 1 层），缺省 3；0 = 不限层数。
    // notes-folders create/reorder（拖父级）沿 parent 链算深度，超限拒绝（校验见 folder-tree-helpers 标记块）。
    const MAX_FOLDER_DEPTH_DEFAULT = 3
    function maxFolderDepthLimit() {
      const v = settingsCache && settingsCache.maxFolderDepth
      return (typeof v === 'number' && isFinite(v) && v >= 0) ? Math.floor(v) : MAX_FOLDER_DEPTH_DEFAULT
    }
    let lastInjectChars = 0
    // 注入预览统计（notes-inject-preview RPC 数据源）：renderInjected 每次同步渲染后更新（0.4.3③ 合并段）；
    // 两函数均为同步执行，RPC 紧接调用后读取，无竞态。预览渲染（sidOverride 传入）不更新 lastInjectChars——仪表只反映真实注入。
    const lastConvStats = { masked: 0, budgetTruncated: false }
    const lastCatStats = { masked: 0, stale: 0 }
    // 时效判定：updatedAt 距今超过 limit 天 → 返回整天数（目录 ⚠ 标注用）；limit=0 关闭 / 无法解析 / 未超期 → 0
    function staleDaysOf(updatedAt, limit) {
      if (limit <= 0) return 0
      const t = Date.parse(updatedAt || '')
      if (!isFinite(t)) return 0
      const d = Math.floor((Date.now() - t) / 86400000)
      return d > limit ? d : 0
    }
