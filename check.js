// DSH 笔记插件回归测试套件 —— runner（模块化拆分：check/helpers.cjs + check/sections/*.cjs，notes-check-split）
// 架构：check.js = runner（模式解析 + CORE 名单 + 节注册表 + 收尾总结 + i18n 未覆盖清单尾部打印）；check/helpers.cjs = 共享设施（t/section/mock 工厂/计数器）；check/discover.cjs = 节注册自动发现（0.4.6-I 起，数值元组排序契约）；check/sections/*.cjs = 节断言体（逐字节迁移，自动发现注册）。
// 测试：host 全链路逻辑（内存 mock fs/llm）+ 工具 schema 校验 + 实现源码结构断言。不触碰真实笔记目录。
const H = require('./check/helpers.cjs')
const { state, io, S } = H

// ===== 核心快检模式（--core / CHECK_CORE=1）=====
// 默认无参 = 全量（输出与历史完全一致，check-result.txt 照常刷新）；--core 只跑 CORE 名单内的代表性断言。
// 约定（DEVELOPMENT.md「测试」节）：worker 自测跑 --core，verifier / 发布前跑全量。
// 实现注意：节间 mock 实例与造数代码（t() 之外）两种模式都照常执行——核心断言看到的共享状态与全量模式完全一致，
// 只跳过 t() 断言体本身，不动任何断言语义。
const CORE_MODE = process.argv.indexOf('--core') >= 0 || process.env.CHECK_CORE === '1'
// CORE 名单按断言名精确匹配（断言名全量唯一）。覆盖：RPC 面/缓存/quick 合并/搜索/软删/归档三连/
// 工具路由/约定注入+分桶/injectTo/派发+闭环/静态包全链路（含迁移+资产路由+归档+perf）/设置持久化/构建可复现+app 可复现/发布面零 BOM/
// 编辑器 round-trip+XSS/文件夹/目录注入/资产上传/导入导出/三端内核同步/注入脱敏/预算截断/遥测计数/注入预览/整理建议/组合过滤/injectEver/img-path-hint/快照式历史引擎/LLM 用量统计/历史版本面板 UI/文件夹嵌套（parent/深度/cycle/子树过滤/cascade/导出子树 + UI 递归树/拖拽换父/级联 confirm/面包屑/深度设置行）/注入管理面板三端/folder 写入归一（名称→id + 非法拒绝）。
// 改断言名必须同步本名单——core 模式收尾时校验名单全部命中，未命中（改名/删除）计 1 个 failed，防静默失效。
const CORE = new Set([
  'host-impl.js 语法',
  'client-impl.js 语法',
  '发布面文件零 BOM（壳/发布包 package.json/index.mjs/app.html/README.md 等首 3 字节非 EF BB BF）',
  'token 语义映射 bg-layer 系 + 鲜蓝强调（开发版/发布包/原型/app.html 四处同步）',
  'T1.1 工具瘦身 9→3',
  'index.mjs 是 ESM（export name/inject/apply，无 bootstrap return）',
  'index.mjs 保留 48 个 RPC + 3 工具 + 约定注入 + 派发 + LLM 分类 + 设置 + 导入导出 + 单文件导出 + 资产上传 + 历史版本三 RPC + 工作记忆 notes-memory-guide + 定时派发 notes-schedule-eval + 图查询 notes-graph + 注入索引 notes-mount/notes-mount-list + 效用账本 notes-ledger-refresh + 召回遥测 notes-recall-stats + whenToUse 草稿 notes-when-suggest + 约定体检 notes-conflict-check',
  '两栏布局骨架（侧栏 + 编辑器通栏）',
  'note_search 已注册',
  'note_get 已注册',
  'note_manage 已注册',
  '创建返回 id',
  '列表瘦身（不含 body）',
  '缓存：第二次 list 零磁盘读',
  'get 带正文',
  'update 不读盘（缓存命中）',
  'update 后列表 topic 已变',
  '首次 quick 创建新笔记',
  '同 session 窗口内合并',
  '异步分类填主题',
  '跨 session 不合并',
  'notes-search RPC 命中正文且瘦身',
  '删除后列表隐藏',
  '恢复后列表可见',
  'preview（dry-run）：零写入 + 手动笔记不进速记组',
  'preview：速记按 sessionId 分组（≥2），手动/单条/已删不进组，dry-run 零写入',
  '无 groups 归档：只合速记组 + 默认标题 + .bak 备份 + undo 事务落盘',
  'undo 往返：成员批量还原 + 归档笔记软删 + undo 清空；二次 undo → undone=0',
  'host-impl 应用成功（48 RPC handlers，含 notes-settings-get/set + 导入导出 + P3 notes-export-single + 资产上传 + 归档 preview/undo + ai-organize/assets-prune + P1 notes-purge + notes-inject-preview + notes-suggest + notes-usage-get + 历史版本 notes-history/history-get/restore-history + 工作记忆 notes-memory-guide + 定时派发 notes-schedule-eval + N+1 批量 notes-get-batch + 图查询 notes-graph + 注入索引 notes-mount/notes-mount-list + 效用账本 notes-ledger-refresh + 召回遥测 notes-recall-stats + whenToUse 草稿 notes-when-suggest + 约定体检 notes-conflict-check）',
  'manage.create 返回 id',
  'manage.archive 显式 groups 合并手动组（白名单 + title 覆盖）',
  'kind 默认 note（向后兼容）',
  'systemPrompt.context 已注册（order 130）',
  'inject=true 笔记注入文本（双角色新文案：缺省进约定桶，单桶只出该桶标题）',
  'injectTo=[不匹配会话] 不注入',
  'injectTo=[当前会话短id] 注入',
  'notes-dispatch 注入上下文+触发工作（agent.send）',
  'notes-dispatch-done 标记完成停止注入',
  '保底联动：notes-update 置 resolved 自动回执全部未闭环派发',
  '事件回执：agent/status idle → 该会话未闭环派发 dispatchStatus=done（receipt=idle）',
  'notes-quick-instruct LLM 解析失败回退等价 notes-quick',
  'index.mjs 可被 ESM import（语法 + 顶层无副作用）',
  'harness 缺失时兜底：3 条 exact 路由（RPC + 全窗口页面 + 资产）+ ctx.tools 3 工具 + 约定注入 order130（单一 context：目录段并入）',
  'GET /dsh-notes/asset 防穿越/形态/白名单/404',
  'RPC 200 + 首次启动迁移开发版笔记到 ~/.dsh/notes',
  'notes-create 走静态包 RPC',
  'notes-get 返回正文',
  '静态包显式归档全链路：preview → 无参仅速记 → 显式 groups 手动组 → undo → notes-perf / notes-ping',
  'harness 主通道：handle 经 harness.handle 注册（host.call 链路可用）',
  'notes-settings-get：初始空设置 + models 目录（llm 探针）',
  'notes-settings-set：保存 llm override 并持久化 settings.json',
  'lib/client.js 是 scripts/build-dist.cjs 的产物且可复现',
  'app.html 是 scripts/concat-app.cjs 的产物且可复现（src/app/** + src/shared 逐字节拼接）',
  'index.mjs 是 scripts/concat-host.cjs 的产物且可复现（src/host/** 按 manifest.dist.js 逐字节拼接）',
  '内核函数可提取（esc/renderMarkdown/serializeRich/analyzeMarkdown/sanitizeFragment）',
  '往返保真：白名单 Markdown render→serialize→render 不变（10 用例，含原型自测 7 条 + 场景 A/C 正文）',
  '0.4.6-A 内核性能闸：病态语料 renderMarkdown 全量 < 500ms（正则灾难回溯常驻防线）',
  'XSS 红线：渲染全量转义 + 图片仅 assets/ 前缀放行（javascript:/外链/引号注入全拒绝）',
  'notes-folders create：落盘 folders.json + order 递增；缺 name 报错',
  'folder 字段数据往返：create 带 folder → get/list/磁盘 front-matter 一致',
  '负向锚：未挂载条目一律不进目录段（普通/pinned 待办/resolved/superseded/recall=false/约定命中——catalog 已移除）',
  'notes-asset-upload：mime 白名单 / 超 5MB / 非法 base64 / 空 data 拒绝',
  '静态包导入/导出全链路（导出 → 预览分类 → 备份 → 默认跳过 diff → overwrite 覆盖 → folders 合并）',
  '内核三端字节一致（client-impl.js / app.html / 发布包 lib/client.js，去公共缩进比较）',
  'conventionText 对 sensitive=true 笔记正文按行打码 + 尾部计数行',
  'notes-quick 命中敏感模式：直接落 sensitive=true + 返回 sensitiveSuggested（磁盘原文不动）',
  'injectBudgetChars 预算截断：资料桶从最旧整条省略 + 提示行；约定桶永不截断；lastInjectChars 随渲染更新',
  'note_get 命中计数：内存即时 +1（响应即见），防抖期内零写盘；notes-get RPC 不计数',
  'notes-inject-preview 返回结构：conventions/directory 字符串 + stats 字符数值正确（catalog 别名已退役）',
  'workspace 视角：该工作区全部会话注入并集 + 未知工作区退化全局 + sessionId 互斥优先',
  'notes-suggest 三段返回 + 遥测/时效闭环 + 零写入（开发版独立实例）',
  '组合过滤：sensitive / inject / kind 三态组合',
  'injectEver 单向粘性（never unset）：开 → 关 → 仍 true；不传 inject 不动存量值',
  'img-path-hint 标记块双包逐字节一致 + 可 eval（bodyHasImageRef/assetsHintLine 导出）',
  'llm-usage 标记块双包逐字节一致 + 三调用点计量包装挂载（classify×2 + organize）',
  'notes-usage-get：三功能分别计数 + today/week/month/allTime/byFeature 结构 + usage.json 防抖落盘',
  '快照去重 + 红线：无变化重复保存不增快照，update 零新增读盘',
  '导入导出适配：默认不含 .history / includeHistory 连带 / 备份含 / added 合并 / id 冲突跳过',
  '历史引擎双包三 RPC 结构同步（host-impl ⇄ index.mjs，恢复走 persistNote 缺省快照）',
  '历史版本三 RPC 契约：列表倒序零正文 / get 取正文 / 未知 ts 报错（开发版独立实例）',
  '恢复前置快照（安全核心）：恢复前当前版自动入 .history + 恢复可再撤销回滚',
  '历史版本面板四端同步：入口/modal/三 RPC 调用点（client-impl + 发布包 + app.html + 原型）',
  '多选操作条批量删除（软删进回收站，三端同步）',
  'notes-get includeDeleted：已删笔记正文只读可达（双包同步 + 行为级，缺省/墓碑仍拒绝）',
  '回收站批量操作四端同步：全选/行勾选/选中计数 + 批量恢复/批量彻底删除（confirm 含 不可恢复+含历史版本+条数）',
  '回收站行预览四端同步：notes-get includeDeleted 取已删正文 + 只读渲染（esc 先行零注入面）',
  // 40. 文件夹嵌套（parent/maxFolderDepth/cycle/递归子树过滤/cascade/导出子树 + 双包标记块 + 静态包行为）
  'folder-tree-helpers 标记块双包逐字节一致 + 可 eval（folderDepth/folderSubtreeIds/folderSubtreeHeight/checkFolderAttach）',
  'maxFolderDepth 设置往返：缺省 3（无键）→ set 落盘回读 → 非法值报错 → null 恢复缺省',
  '嵌套 parent 往返：create 带 parent 落盘 + list 返回 parent/depth + 存量零迁移（无 parent=根级 depth 1）',
  '嵌套深度校验：缺省 3 层超限拒绝 / 边界第 3 层 OK / 调大与 0 不限放行',
  'reorder 拖父级：cycle 拒绝（自身/子孙）+ 深度超限拒绝 + 合法改挂落盘',
  '递归子树过滤：三层父子样本 notes-list / note_search / note_manage 同口径 + count 子树口径',
  'notes-folders delete：缺省拒绝含子内容（needCascade）+ cascade:true 笔记软删进回收站可恢复落未分类',
  'cascade 删除：缺省拒绝含子内容 + cascade:true 整棵删除笔记进回收站可恢复落未分类',
  '导出子树：notes-export-single scope.folder 递归含子孙文件夹笔记',
  '静态包嵌套文件夹：parent 建层/深度超限拒绝/cycle 拒绝/cascade 软删恢复落未分类',
  // 41. 文件夹嵌套 UI（notes-nested-folder-ui：递归树/拖拽换父/级联删除 confirm/面包屑/maxFolderDepth 设置行，四端同步）
  '嵌套 UI 递归树渲染：depth-first 递归 + 子树过滤/自动展开/计数 + 键盘导航顺序（四端同步）',
  '嵌套 UI：新建子文件夹 + 拖拽换父（cycle 本地拦截 + 深度拒绝 toast）+ 同级排序（四端同步）',
  '嵌套 UI：级联删除 confirm 子树统计 + 面包屑路径可点击 + maxFolderDepth 设置行（四端同步）',
  // 42. 列表韧性（notes-list-union-defense：listDir 快照停滞窗口内 cache 并集补入）
  'list-union-defense 标记块双包逐字节一致（host-impl / index.mjs）',
  '并集补入：listDir 停滞窗口内新建笔记立即可见；watcher 恢复后幂等零重复',
  '并集条目同一过滤管线：deleted/tag/kind/folder 与目录条目零差异（0.4.3⑦ log 同权）',
  '并集墓碑排除：purge 后缺省/回收站口径均不出现（含缓存墓碑条目）',
  '静态包并集防御：停滞窗口新建笔记可见 + watcher 恢复幂等（index.mjs 行为）',
  // 43. 注入管理面板（notes-inject-manager：设置卡入口 + 全库总览 + 单行直改/多选批量 + log/sensitive 护栏，三端同步零新 RPC）
  '注入管理面板（client）：设置行入口 + 总览 modal 结构 + 三态直改 payload + 批量通道 + log/sensitive 护栏（开发版 + 发布包）',
  '注入管理样式双端：styles.css ⇄ 发布包 lib/styles.css',
  'app.html + 原型注入管理同款：设置行入口 + 三态直改/批量 payload + log 注入硬关（不渲染开关）+ 统计 chips（双端 UI 标记一致）',
  // 44. 设置卡交互反馈（notes-settings-feedback：✕ 常驻关闭 + dirty 保存/还原 + 关闭兜底 flush，三端同步）
  '设置卡交互反馈（client）：✕ 常驻关闭 + dirty 状态机 + 保存/还原 + 兜底 flush（开发版 + 发布包）',
  'app.html + 原型设置卡反馈同款：✕ + dirty 保存/还原 + 关闭兜底 flush + Esc 同口径（双端 UI 标记一致）',
  // 39.6b 日志同权接线（0.4.3⑦ notes-043-log-firstclass：R-6 UI 隐身推翻——日志并入主缓存全管线同权，文件视图拆除，四端）
  '日志同权接线（四端）：默认列表恒含 log（无 includeLogs 翻转机制/渲染守卫）+「文件视图」入口/求值拆除',
  // 50. 定时派发·设置交互 UI（notes-034-sched-ui：派发弹窗调度区 + 注入管理调度任务区，四端 + 原型 mock 行为）
  '调度 helper 四端同口径：schedEveryMs/schedFreqLabel/schedNextMs/isoToLocalInput 行为 + app⇄原型逐字节一致',
  '派发弹窗调度区（app.html + 原型）：立即/定时单选 + 频率四模式 + 内联校验 + 创建/编辑双通道 + 手动派发零改动',
  '注入管理调度任务区（app.html + 原型）：总览徽章 + 编辑回填 + 暂停/恢复 + 软删 + Esc 复位',
  '定时派发 UI（client 开发版 + 发布包）：调度区/编辑回填经 panelBridge + 调度任务区 + 样式双端',
  '原型 mock 定时派发：写入闸门红线行为 + schedule-eval + slim 携带 schedule + 演示数据',
  // 51. 键盘流速查表（notes-034-f-cheatsheet：? 键唤起 + 设置卡入口，三端同步 + 键位逐键核对）
  '键盘流速查表（client）：modal 模块 + ? 键唤起/toggle + Esc 栈首段 + 设置卡入口 + 样式（开发版 + 发布包）',
  '键盘流速查表（app.html + 原型）：openCheatsheet + ? 分支 + 设置行入口 + hintbar 指引（双端 UI 标记一致）',
  // 55. 文件夹名称输入弹层（notes-041-folder-prompt：弃原生 prompt + 空名/同级重名校验）
  'prompt( 在 app.html/client.js/原型产物中 0 命中（原生弹窗清零）',
  '弹层校验行为级 eval：空名/同级重名内联拒绝 + 合法名 trim 回调 + 自身排除 + Enter 提交',
  // 57. 顶栏窄宽防竖排（notes-041-topbar-400：nowrap + shrink:0 + ≤480px 次要按钮收图标）
  '顶栏按钮防竖排样式锚点（app.html + 原型）：tbtn nowrap + shrink:0 + ≤480px 断点收图标',
  '行为级 eval：断点判定函数（自 CSS 源提取阈值 eval）+ ico-only 配对完整性（图标/title/文字三齐备，收图标不留空按钮）',
  // 58. folder 写入归一（notes-041-create-folder-name：create/update folder 名称→id + 非法显式拒绝）
  'folder-arg-norm 行为级：create/update 传文件夹名落盘归一为 id（RPC + 工具双通道）',
  'folder-arg-norm 非法显式拒绝：未知 id/名称整体报错不落库 + 原值不动 + 空串未分类透传',
  'folder-arg-norm 标记块双包逐字节一致（notes.js ⇄ notes.dist.js）+ create/update 接线锚点',
  // 59. 定时派发·执行记录独立笔记（notes-041-sched-runlog：schedule.runLog 软链 + 约定正文零改动红线）
  'runLog 懒创建 + 软链回写 + 约定正文零改动红线（idle 回执 → 执行记录独立笔记）',
  'runLog 写入闸门：存在笔记 id 放行 / 幽灵 id 与非串拒绝 / 缺省延续 / 空串解除',
  // 74. 效用账本（notes-043-ledger：指标快照 + 记忆档案懒创建回填，无 LLM；卡⑤ notes-043-metrics-storage：指标落 telemetry.json + 存量 §2 摘除）
  'fixture 全链路：挂载 2 条 + 近 7 天/超窗日志各 1 → refresh → 指标落 telemetry.json + 存量 §2 摘除 + 档案懒创建恰 1 个（refNote 软链 + 红线）',
  '幂等重放：二次 refresh → archivesCreated=0 + 引用记录仍 1 行 + §2 摘除幂等零改动',
  // 68. i18n 守卫（notes-042-i18n-lint：常驻 lint——字典↔代码双向覆盖为守卫核心，常驻 --core 防字典/代码漂移）
  'i18n 守卫② 字典↔代码双向覆盖：字典 key 全被引用 + 代码 key 形字面量全命中字典（白名单逐条锚定）',
  // 75. 守卫扩展 + README 哲学节（notes-043-guard：索引 lint / 死链查图 / 四文件同步——常驻 --core 防索引与 README 漂移）
  '守卫① 索引行格式：现行索引 §1 全部合规（正则 `- [[id]] when`）+ notes-mount-list 解析行与正文行数一致',
  'README 四文件同步：双语言发布包 README = 根 README 仅图片路径改写（sync-pkg-readme 同口径，逐字节）',
  // 76. 存储加固（notes-043-atomic-store：per-note 串行化链 + 原子性委托声明 + 崩溃恢复断言——常驻 --core 防丢行竞态回归）
  'per-note 串行化链标记块双包逐字节一致（kernel/persist.js ⇄ persist.dist.js）+ 构建产物锚点',
  '崩溃恢复·半写：目标笔记写失败（RPC 报错）→ 盘上保持完整旧版 + 重启读回完整旧版；重试落全量新版',
  '崩溃恢复·墓碑：软删墓碑落盘后重启不复活 + 删除写失败时盘上仍存活态 + 恢复翻转 deleted:false',
  'per-note 写链串行化：同笔记并发写零重叠在飞 + 并发双 append 两行都在（重启后仍在）',
  // 77. front-matter 往返幂等（notes-043-fm-newline：正文前导换行零增长 + 存量首轮归一——常驻 --core 防数据保真回归）
  '往返幂等：读→原样回写→读三轮正文逐字节相同（含内部空行/尾部换行）',
  '存量污染首轮归一：多前导换行读入即归一 + 纯读不改盘 + 回写后稳定零增长',
  // 79. 创建级锁（notes-043-ensure-lock：根笔记并发首建竞态修复——常驻 --core 防孤儿索引/档案/runLog 回归）
  '创建级锁落地结构：rootNoteCreateLock 模块级单链（quickChain 同模式）+ 三消费点共用 + 快路径在锁前 + 双产物同步',
  '并发首建：索引不存在时启动 ensure + 两个并发 notes-mount 三方竞态 → 恰 1 篇索引 + indexNoteId 唯一 + 挂载行双在',
  // 83. 0.4.4-B 休眠送达 + 专属会话（notes-044-dormant-dispatch：常驻 --core 防双通道/专属会话生命周期回归）
  '休眠目标派发 → queued:true + durable inbox splice 落盘（agent/inbox/spliced 同 live send 形态）+ 执行记录行注（下次活动送达）',
  '专属会话全生命周期：首轮创建「定时 · 任务名」+ target 回写 → 二轮复用同 sid（零新建）→ 休眠降级 queued 送达',
  // 94. 0.4.6-B RPC 韧性层（notes-046-rpc-resilience：常驻 --core 防挂起假死回归——超时结构化/提示条/落地页空态）
  '0.4.6-B rpc 超时 → 结构化 {error} + toast 不静默（AbortController 行为级）',
  '0.4.6-B rpc 挂起提示条：>RPC_SLOW_MS 出现 / 落定消失（并发归并同一条）',
  // 103. 0.4.7-C 稳定性债（notes-047-stability：常驻 --core 防关闭丢稿/假同步回归——卸载 flush 行为级主断言）
  '0.4.7-C app flush（行为）：dirty 态触发关闭钩 → host 立即收到 notes-update（不等到期）+ 到期回调不双保存',
  // 107. 0.4.8-A 遥测退避 + 慢请求诊断钩（notes-048-perf-backoff：常驻 --core 防遥测刷屏/诊断钩回归——退避序列与 6s 位移行为级主断言）
  '0.4.8-A 遥测退避行为级：连败 60s→120s→240s→封顶 300s + 窗口跳票 + 成功复位（eval 打桩）',
  '0.4.8-A 遥测 warn 降级：连败首条一条 + 恢复带计数 + 零 unhandled rejection（eval 打桩）',
  'slow-rpc-log 标记块双包逐字节一致 + 行为级 eval（>5s 触发 / ≤5s 静默 / 纯进程日志红线）',
  '0.4.8-A 慢请求诊断钩（行为）：6s 位移 mock → console.warn 一行（方法名+耗时），快请求静默（开发版+静态包）',
  // 108. 0.4.8 双链 [[ 输入补全（notes-048-wiki-autocomplete：常驻 --core 防触发窗/过滤口径/红线回归——内核纯函数行为级 + 红线主断言）
  '0.4.8 双链 [[ 补全内核纯函数行为级：wikiAcTrigger 窗口开合 + wikiAcFilter 双匹配/剔除/倒序/上限',
  '0.4.8 双链 [[ 补全红线：wikiResolve 契约/900ms 自动保存/富文本零改动',
  '0.4.8 主题并入标签内核行为级：effTags 全矩阵（空/未分类/重复/大小写/空白/null/占位）+ effTagsUi 剔占位',
  '0.4.8 写侧惰性落盘·host note_manage：显式 topic 并入 tags + topic 落盘清空 + topicMerged 回执（create/update）',
  '0.4.8 app 写侧合并行为级：edFoldTopic 折叠单元 + buildSavePayload——topic 清空 + 在途输入并入 + 去重 + quick 保留 + 占位不触写 + 守卫 + 移除生效（不回魂）',
  '0.4.8 侧栏标签树四端同构：effTags 多值分组 + 组头去重篇数 + 「未分类」桶消失 + i-tag 图标 + 分类中映射',
  '0.4.8 红线：topic 字段保留（front-matter/schema）+ notes-list/note_search 响应结构零变化 + 存量零批量迁移',
  '0.4.8 降级场景：旧版 .md（topic 行）降级可读 + effTags 合并可见 + 导出标签档 topic-only 命中不成孤儿',
])

// ===== 分节运行模式（--only=39,42 / CHECK_ONLY）=====
// 新增能力（非替换）：逗号分隔的节号或节名前缀，只执行选中节的 t() 断言体；节间 mock 实例与造数代码全部照常执行（与 --core 同一原则，
// 选中节看到的共享状态与全量完全一致）。可组合 --core（在选中节内再按 CORE 名单过滤；此时名单命中校验自动跳过——子集注定不全命中）。
const ONLY_ARG = process.argv.find(a => a.indexOf('--only=') === 0)
const ONLY_ENV = process.env.CHECK_ONLY
const ONLY = (ONLY_ARG ? ONLY_ARG.slice('--only='.length) : (ONLY_ENV || '')).split(',').map(s => s.trim()).filter(Boolean)
const ONLY_MODE = ONLY.length > 0

// ===== 节注册表：自动发现（0.4.6-I，notes-046-check-autodiscovery）=====
// check/sections/*.cjs 全部自动注册（顺序即执行顺序）——新增节文件零改动本文件，消除新卡必触 check.js 的批次共享锁。
// 排序契约（check/discover.cjs 实现；节 100 常驻断言看守）：文件名开头数字前缀按 '-' 分段转数值元组逐段数值比较
// （1-2 → [1,2]，1-10 ＞ 1-2 为数值序非字典序）；元组互为他方前缀时短者在前（[35] ＜ [35,5]）；等值元组/无数字前缀按文件名全串字典序兜底。
// 红线：节执行顺序零容忍漂移——落地时已用一次性对照脚本断言自动发现序列 ≡ 原硬编码 114 节清单逐位一致
// （唯一漂移点：35 序号撞车对，以改名 35-5-img-path-hint.cjs 消化，未静默换序）。CORE 名单保留在本文件（改动频率低，不构成锁点）。
const SECTIONS = require('./check/discover.cjs').discoverSections(H.path.join(__dirname, 'check', 'sections'))

async function main() {
  H.init({ CORE_MODE, CORE, ONLY, ONLY_MODE })
  for (const mod of SECTIONS) {
    const selected = !ONLY_MODE || ONLY.some(tok => mod.id === tok || mod.title.indexOf(tok) === 0 || mod.title.replace(/^[\d.]+\.?\s*/, '').indexOf(tok) === 0)
    H.beginSection(selected)
    await mod.run(H, S)
  }

  // ===== 总结 =====
  console.log('\n[1m=== 结果 ===\x1b[0m')
  console.log('  passed: ' + state.passed)
  console.log('  failed: ' + state.failed)
  if (CORE_MODE) {
    console.log('  mode:   --core（核心快检 ' + CORE.size + ' 条，跳过 ' + state.skipped + ' 条；全量回归：node check.js）')
    // 名单命中校验：CORE 条目必须全部对应真实断言（改名/删除会造成静默漏检，这里兜底报出来）。--only 子集运行时跳过（注定不全命中）。
    if (!ONLY_MODE) {
      const missing = [...CORE].filter(n => !state.coreSeen.has(n))
      if (missing.length) {
        state.failed++
        console.log('  \x1b[31m✗\x1b[0m CORE 名单 ' + missing.length + ' 条未命中任何断言（断言已改名/删除？需同步 check.js 顶部 CORE 名单）：')
        for (const m of missing) console.log('      - ' + m)
      }
    }
  }
  if (ONLY_MODE) console.log('  mode:   --only=' + ONLY.join(',') + '（分节运行，跳过 ' + state.skipped + ' 条；全量回归：node check.js）')
  console.log('  reads:  ' + io.reads + ' / writes: ' + io.writes + '（in-memory mock）')
  // ===== i18n 未覆盖清单（节 68 守卫产出；常驻提示，只提示不阻塞）=====
  // 规格：n-mut488gske5v 种子卡③——报告尾部输出仍含内联中文的文件/行数排行。计算在节 68 的 t() 断言体之外，
  // --core/--only 照常统计；host RPC 中文 / 原型 / 字典自身按红线豁免不入扫描面。
  if (S.i18nUncovered) {
    const u = S.i18nUncovered
    console.log('\n\x1b[1m=== i18n 未覆盖清单（内联中文残留 · 只提示不阻塞）===\x1b[0m')
    console.log('  扫描面 src/app + src/client + src/shared 共 ' + u.scanned + ' 文件（host RPC 报错中文 / 原型 / 字典自身按红线豁免）')
    if (!u.files.length) {
      console.log('  ✓ 无内联中文残留（去注释口径）')
    } else {
      console.log('  残留 ' + u.files.length + ' 文件 / ' + u.totalLines + ' 行（按行数排行；常量表四端同构锚与数据层「定时 」前缀属设计内保留）：')
      const TOP_N = 15, top = u.files.slice(0, TOP_N)
      top.forEach((r, i) => console.log('   ' + String(i + 1).padStart(2) + '. ' + r.file + ' — ' + r.lines + ' 行'))
      if (u.files.length > top.length) {
        const restLines = u.files.slice(TOP_N).reduce((s, r) => s + r.lines, 0)
        console.log('      …其余 ' + (u.files.length - top.length) + ' 文件合计 ' + restLines + ' 行')
      }
    }
  }
  // ===== 「待补」占位行清单（节 75 守卫产出；常驻提示，只提示不阻塞，复用 §68 未覆盖清单模式）=====
  if (S.guardPending) {
    const p = S.guardPending
    console.log('\n\x1b[1m=== 待补占位行清单（正文含 待补:/TODO: · 只提示不阻塞）===\x1b[0m')
    console.log('  扫描面全库存活笔记（含 kind=log）共 ' + p.scanned + ' 篇')
    if (!p.files.length) {
      console.log('  ✓ 无待补占位行')
    } else {
      console.log('  命中 ' + p.files.length + ' 篇 / ' + p.total + ' 行（补齐由人裁决，不计失败）：')
      p.files.slice(0, 15).forEach((r, i) => console.log('   ' + String(i + 1).padStart(2) + '. [' + r.id + '] ' + (r.title || '(无题)') + ' — ' + r.lines + ' 行'))
      if (p.files.length > 15) console.log('      …其余 ' + (p.files.length - 15) + ' 篇')
    }
  }
  // 退出码语义（0.4.3 收口修复）：failed>0 → exit 1（CI/worker 自测门禁可信）；「待补」占位清单等提示项不计失败（上方已分流）。
  // 修复前恒 0（`failed > 0 ? 0 : 0`）——多轮 verifier 均以 passed/failed 计数人肉判读，exit 码不可作判据；本行修复后 exit 码恢复门禁语义。
  process.exit(state.failed > 0 ? 1 : 0)
}

main().catch(e => { console.error('TEST FAILED:', e); process.exit(1) })
