<div align="center">

# 📝 dsh-notes-plugin

**把 Agent 会话里「聊完就丢」的决策与约定，沉淀成本地 Markdown 笔记**

自动注入系统提示 · 可派发待办给活跃会话 · 选区一键摘录 · 纯本地 Markdown 不上传

[![npm version](https://img.shields.io/npm/v/dsh-notes-plugin.svg)](https://www.npmjs.com/package/dsh-notes-plugin)
[![npm downloads](https://img.shields.io/npm/dw/dsh-notes-plugin.svg)](https://www.npmjs.com/package/dsh-notes-plugin)
[![node](https://img.shields.io/node/v/dsh-notes-plugin.svg)](https://www.npmjs.com/package/dsh-notes-plugin)
[![license](https://img.shields.io/npm/l/dsh-notes-plugin.svg)](https://github.com/PPawnsir/dsh-notes-plugin/blob/main/LICENSE)
![category](https://img.shields.io/badge/awesome--dsh--plugin-workflow-blue)

<img src="packages/dsh-notes-plugin/docs/screenshot-panel.png" alt="dsh-notes-plugin 笔记面板" width="820">

**交互演示** <br>
<img src="packages/dsh-notes-plugin/docs/demo.gif" alt="dsh-notes-plugin 交互演示" width="820">

</div>

## 版本适配（dsh-notes ↔ DSH）

DSH 更新频繁，插件各版本能力与适配范围不同，**升级插件前请对照下表**。声明范围来自 `peerDependencies`（npm 安装时强制校验），「实测基线」是该版本开发与回归所用的 DSH 版本：

| 插件版本 | 发布 | 声明适配 DSH | 实测基线 | 要点 |
| --- | --- | --- | --- | --- |
| **0.3.3** | 2026-10-04 | `^0.1.7 \| 0.2.0-rc.2 \| ^0.2.0` | **0.2.0-rc.2** | 工作记忆 r3 车道模型（约定/记忆并行通道，启用不再做重叠冲突确认）+ 注入管理面板（全库注入三态总览 + 单行直改 + 多选批量）+ 设置卡交互反馈（✕ 常驻关闭 + dirty 保存/还原 + 关闭兜底 flush）+ 内部模块化重构（client 46 片 / app 40 片 / host 双清单 45 片次，双包同源组装器逐字节等价 + 发布面零 BOM 断言）+ `check --only` 分节回归；peer 声明不变 |
| 0.3.2 | 2026-10-03 | `^0.1.7 \| 0.2.0-rc.2 \| ^0.2.0` | 0.2.0-rc.2 | 纯 README 补发（0.3.1 发版 README 未同步事故补救：补齐版本历史/Token 统计/嵌套文件夹等特性描述），零代码变更 |
| 0.3.1 | 2026-10-03 | `^0.1.7 \| 0.2.0-rc.2 \| ^0.2.0` | 0.2.0-rc.2 | 工作记忆 v0（kind=log 工作日志沉淀 + memory-guide 引导 + 日志卫生）+ 快照版本历史 + Token 消耗统计 + 虚拟文件夹嵌套（maxFolderDepth/递归子树/级联删除）+ 回收站批量与多选删除 + 列表韧性；npm 页 README 停留 0.3.0 清单（0.3.2 已补救） |
| 0.3.0 | 2026-10-02 | `^0.1.7 \| 0.2.0-rc.2 \| ^0.2.0` | 0.2.0-rc.2 | 大版本：编辑器双模式（源码⇄富文本）+ 图片支持 + ✨AI 整理 + 显式归档（预览/撤销）+ 敏感脱敏 + 注入增强（时效/预算/预览器）+ 回收站 + 使用遥测 + 双链/反向链接 + 单文件导出 + 整理建议器 + 筛选中心（约 20 项，详见功能清单）；peer 声明维持不变（上界 `^0.2.0` 保守不放开 0.3.x——未验证） |
| 0.2.4 | 2026-09-30 | `^0.1.7 \| 0.2.0-rc.2 \| ^0.2.0` | 0.2.0-rc.2 | 兼容 DSH 0.2.0：声明显式覆盖 0.2.0-rc.2 预发布（semver 预发布不命中宽区间，须枚举）；改名竞态防正文丢失；已在本机 0.2.0-rc.2 实测加载 |
| 0.2.3 | 2026-09-30 | `>=0.1.7 <0.2.0-0` | 0.1.7 | npm 页面 README 与仓库根同步（sync-pkg-readme + docs 入白名单） |
| 0.2.2 | 2026-09-30 | `>=0.1.7 <0.2.0-0` | 0.1.7 | 声明范围校正：下限收紧到实测基线 0.1.7（0.1.5~0.1.6 派发列表超时实测不可用，0.2.1 仍误声明旧范围）|
| 0.2.1 | 2026-09-30 | `>=0.1.5-rc.1 <0.2.0-0` | 0.1.7 | 上下文注入双角色（约定/资料）/ 注入范围移除工作区维度（默认所有会话）/ 入口按钮与配色 v2 打磨 |
| 0.2.0 | 2026-09-29 | `>=0.1.5-rc.1 <0.2.0-0` | 0.1.7 | 虚拟文件夹 / UI v2 / 目录索引注入 / 导入导出 / `/dsh-notes-app` / 0.1.7 派发性能修复 |
| 0.1.2 | 2026-09-25 | `>=0.1.5-rc.1 <0.2.0-0` | 0.1.5~0.1.6 | 基础面板：CRUD / 快速记录 / 派发 / 约定注入 / 搜索 |
| 0.1.0 | 2026-09-23 | `>=0.1.5-rc.1 <0.2.0-0` | 0.1.5-rc | 首个 npm 发布 |

- **建议**：始终使用最新插件版 + 表中「实测基线」及以上的 DSH；低于实测基线时不保证 RPC 面完整（如 <0.1.7 有派发列表超时问题，0.2.0 已带缓解但行为以 0.1.7 为准）。
- **semver 预发布提示**：`0.2.0-rc.2` 这类预发布版本**不命中** `>=0.1.7 <0.3.0-0` 这类宽区间（semver 规则），声明里须显式枚举预发布分支——0.2.4 起已按此声明。
- DSH 发生大版本变更（`0.x` 次版本跃迁）时，本表会在插件对应适配版发布后更新；`peerDependencies` 上限（当前 `<0.3.0-0`/`^0.2.0`）即"未在更新后的 DSH 上验证"的保守声明，解除以新插件版本发布为准。

## 解决什么问题

Agent 会话里的结论是「一次性」的：一个方案为什么这么选、项目有哪些硬约定、下午冒出来的待办，全都散落在对话流里；上下文一压缩、会话一关，这些知识就没了。下一个会话的 agent 不知道上周定过什么，用户也得反复复述约定。

dsh-notes 把这件事变成可积累的本地资产：

| 问题 | 解法 |
| --- | --- |
| 结论聊完就丢 | 面板内 `Enter` 即存为本地 Markdown（`~/.dsh/notes`），选区文字一键摘录，永不出本机 |
| 笔记越记越乱 | LLM 异步识别主题并回填标题/分类，`kind`（笔记/决策/待办/链接/引用）与 `status`（进行中/置顶/已解决/已取代）两个正交维度 + 虚拟文件夹归档 |
| agent 不知道约定与资料 | 详情区「⚡ 关闭 / 约定 / 资料」三态分段控件：约定=须遵守的行为规则、资料=事实性补充信息（agent 按需取用），笔记内容按角色分桶注入 Agent 系统提示（`order 130`），范围默认注入所有会话，可限定指定会话 |
| agent 不知道库里有什么 | 目录索引注入（`order 131`）：一行一条笔记目录 + 规划轻推自动进系统提示，不搜索也感知存量；相关条目 `note_get` 拉全文、`note_search` 检索更多 |
| 待办没人执行 | 一键把待办派发给任意**活跃**会话（`Agent.send` 注入「召回上下文 + 具体要求」并唤醒对方开始工作），派发历史可标记完成 |
| 事后找不到 | 面板即时搜索 + 全文兜底并集检索、`note_search` 工具按 tag/topic/kind 过滤、归档按会话或标签合并、软删除可恢复 |

## 安装

> 宿主要求：Node ≥ 22；DSH ≥ `0.1.5-rc.1`（已通过 `peerDependencies` 声明，含预发布分支的版本范围见 package.json）

```sh
dsh plugin --profile web add dsh-notes-plugin
```

重启 DSH 后生效：会话头部出现「**智能笔记**」按钮（✎，带计数徽标），点击打开/关闭面板；桌面角落另有可拖拽的悬浮气泡入口。

## 升级 / 卸载

```sh
dsh plugin --profile web add dsh-notes-plugin@latest   # 升级（重启 DSH）
dsh plugin --profile web remove dsh-notes-plugin       # 卸载（不删数据）
```

## 功能清单

- **快速记录**：顶栏 `＋` 图标（或 `Ctrl+N`）展开输入框，`Enter` 即存、`Shift+Enter` 换行；LLM 异步识别主题并回填标题，不阻塞交互
- **选区记录**：选中页面任意文字浮出「快速记录」按钮，一键存为 `quote` 类型笔记（也可在同一浮层写「备注」，由 LLM 提取标签/类型/注入意图）
- **同会话合并**：10 分钟窗口内的连续速记按时间戳自动合并成一条，避免碎片化
- **类型与状态**：`kind` = 笔记 / 决策 / 待办 / 链接 / 引用；`status` = 进行中 / 置顶 / 已解决 / 已取代（置顶单独分组，已解决降透明度）
- **虚拟文件夹（支持嵌套）**：侧栏笔记树按「📌 置顶 / 📁 文件夹树 / 未分类笔记」组织；文件夹可嵌套（右键「新建子文件夹」或拖拽换父，深度上限 `maxFolderDepth` 默认 3 层、可调/0 不限，cycle 自动拒绝）；文件夹视图与计数按**递归子树**口径（点父文件夹可见全部子孙内容）；删除文件夹=连子删除（confirm 明示「N 个子文件夹 + M 条笔记移入回收站（可恢复）；文件夹结构不可恢复」，恢复的笔记原文件夹已不存在时自动落未分类）；右键可重命名 / 上移下移（同级内换位）/ 移回根级；清单持久化在 `folders.json`（`parent` 字段，存量零迁移），选中态存 `localStorage`
- **快照版本历史**：每次保存前自动快照到 `.history/<id>/`（分层保留：1 小时内每版 / 当天每小时 / 7 天内每天，单笔记 20 版上限 + 全局 50MB LRU）；详情区「历史」面板列出版本（时间/字节数）、点开只读预览、一键恢复——恢复前自动为当前版本落快照，**恢复本身可撤销**（再退回去即可）
- **面板 UI v2**：两栏布局——左侧笔记树（置顶 / 文件夹 / 未分类主题分组，「主题过滤」跨文件夹全局生效），右侧通栏编辑器（标题 + 主题/标签/类型/状态 meta chips 直改）；SVG 图标库 + DSH 设计 token 配色，明暗主题自适应；快速记录卡片 v2（选区预览 + 复制/记录/取消，复制成功即关卡片）
- **上下文注入（双角色）**：详情区「⚡ 关闭 / 约定 / 资料」三态分段控件（独立字段 `inject` + `injectRole`，不依赖标签）——约定=须遵守的行为规则（每回合注入「用户约定」桶），资料=事实性补充信息（「参考资料」桶，与当前任务相关时按需取用）；范围浮层多选——默认注入所有会话，勾选具体会话则仅限这些会话（会话按工作区分组、显示会话名，自动排除子 agent 与已归档会话）
- **目录索引注入（recall 通道）**：整篇注入之外的轻量通道——一行一条目录（`- [id] 标题 (类型, 主题)`）自动注入系统提示（`order 131`，紧邻约定之后）并附规划轻推，agent 规划期即知库里有什么；已了结（resolved/superseded）与整篇注入已命中的笔记自动排除，40 条封顶；单条以前沿 `recall: false` 退出目录，设置卡片总开关（`catalogEnabled`）一键全关
- **注入管理面板**：设置卡片「注入管理 → 管理…」——全库注入三态总览（约定 N / 资料 M / 未注入 K 统计 chips 点击即过滤 + 250ms 防抖搜索）；行内三态 segmented 直改（语义与详情区三态分段控件完全一致）；多选批量「设为约定 / 设为资料 / 关闭注入」（confirm 确认，单条失败计数不中断）；注入中在前（约定 > 资料），组内按更新时间降序；日志隐身硬禁（三态档位禁用 + 批量不可选），敏感笔记行内提示注入自动脱敏，曾注入徽章展示粘性标记
- **设置卡交互反馈**：标题栏 ✕ 常驻关闭 + dirty 态「保存」（显式确认：全部数值字段先校验，串行落盘「控件值 ≠ 已落盘」的键）/「还原」（回滚到打开时快照）；✕/Esc/点遮罩关闭时有未落盘改动自动兜底 flush 并 toast 确认；原有选择即存 / 失焦即存的自动保存不变
- **任务派发**：待办一键派发到活跃会话或新建会话，可补充具体要求；派发记录（会话名/要求/时间/是否完成）落在笔记的 `dispatches` 字段里，正文不被污染；目标会话系统提示持续注入该待办直到标记完成；DSH 0.1.7 适配——活跃会话列表走会话元数据缓存（未命中先返回占位 + `titlesPending`，前端 1.5s 轮询补齐），加载从 128s 降到 0.2s
- **检索**：面板搜索框（本地即时过滤 + 250ms 防抖全文兜底，取并集）、筛选中心（「筛选(N)」按钮 + 分组 popover——状态组 置顶/已注入/曾注入/敏感 与类型组五 kind 均多选，组内 OR 跨组 AND，激活条件 chips 可单独移除，曾注入按 slim 字段 feature-detect；排序独立控件 时间/引用/相关度，条件与排序持久化记忆）、`note_search` 工具
- **键盘流**：`Ctrl+K` 搜索、`Ctrl+N` 新建、`j/k`/`↑↓` 移动、`Enter` 打开、`Esc` 关闭（输入框内不抢键）
- **归档整理（显式）**：标题栏「归档」先 dry-run 预览（`notes-archive-preview`，含引导气泡），勾选速记组后才合并（`notes-archive` 白名单组，host 先全量校验再动手；toast 可撤销一次 `notes-archive-undo`）；手动笔记已摘出自动分组（防误并），用列表「选择」多选合并；原笔记软删除（`.bak` 备份）可恢复
- **整理建议器**：设置卡片「整理建议」——`notes-suggest` dry-run 零写入提名四类候选：速记归档组 / 过期未引用（kind=note/link 且超 `staleDays` 且从未被 `note_get` 命中）/ 孤儿笔记（无 `[[双链]]` 出链与反向链接、未注入、零引用的普通笔记）/ 日志卫生（工作记忆 v0：超 7 天周聚合 + 超 90 天月聚合提名）；只提名不执行——直达归档预览 / confirm 后批量软删 / 孤儿仅展示逐条跳转 / 日志卫生仅展开明细
- **工作记忆 v0（工作日志沉淀，r3 车道模型）**：设置卡片「工作记忆」区「启用沉淀引导」——创建一条预填约定笔记（`inject=true`、`contractType: memory-guide` 契约身份标记（`tag memory-guide` 兼容发现键）、作用域三档可选），引导 Agent 在任务收尾或你说「记一下今天的工作」时把会话结论写为 `kind=log` 工作日志（模板四节：做了什么/改动/遗留与后续/相关笔记双链）；车道模型：工作记忆是独立于笔记约定的并行通道——约定管你怎么记（给人看）、记忆管 Agent 自己沉淀什么（自用召回），可同时对同一事件生效，无重叠检查/冲突确认；引导激活期产生的日志 front-matter 自动落 `origin: memory-guide` 溯源；日志默认隐身——`inject` 硬关闭、目录缺省不进、默认列表与默认搜索不含（筛选中心类型「日志」为专入口），永不被过期/孤儿清理提名；超窗旧日志由整理建议器「日志卫生」段按 工作区×周/月 提名聚合（只提名不执行，窗口在设置卡片可调）；停用 = 关闭该约定注入（规格 `design/agent-memory-v0.md`）
- **编辑器双模式（源码 ⇄ 富文本）**：meta 行两段开关或 `Ctrl+/` 切换——富文本为受限 WYSIWYG（白名单：h1-h3 / 列表 / 引用 / 围栏代码块 / 粗斜体 / 行内码 / 链接（仅 http/https）/ 图片 / 双链，render ⇄ serialize 双向 round-trip 无损，900ms 防抖回写源码）；富文本工具栏（加粗/斜体/链接/图片）+ 粘贴 HTML 白名单清洗（h4-6 降段落、script/style 丢弃）；含白名单外语法时富文本入口置灰 + 横幅给出原因，删净即恢复
- **富文本门禁放宽**：行内 HTML（`<b>`/`<i>` 等）字面渲染、GFM 表格只读渲染（`contenteditable=false` 原子岛屿，序列化逐字回吐）——不再整篇降级，仅多行 HTML 块 / 嵌套引用等歧义结构才禁用富文本
- **✨ 整理（AI 按模板重写）**：编辑器 meta 行「整理」按钮——当前草稿经 `notes-ai-organize`（`notes-quick-instruct` 同款 LLM 通道）按 `kind` 模板结构化重写（决策→背景/结论/理由，待办→checkbox，链接→链接/说明，引用→引用块/出处，机器/运维信息→环境/机器清单/账号/门户）；替换后走自动保存，toast 可撤销一次；正文超 12000 字报错引导分段
- **kind 模板骨架**：新建笔记按类型预填骨架（同上模板；`note` 为自由格式空正文）——面板新建 modal 可选类型，全窗口页随筛选中心类型组（恰选 1 个时按该类型预填）
- **图片支持**：正文 `![](assets/xxx)` 相对路径引用（`assets/` 目录落盘），粘贴 / 拖拽 / 工具栏按钮三入口上传（`notes-asset-upload`：mime 白名单 png/jpeg/gif/webp、≤5MB；`GET /dsh-notes/asset` 供 `<img>` 加载，防路径穿越）；超过 1MB 的 PNG/JPEG 上传前在前端 canvas 降质转 JPEG（长边 ≤2560px、质量阶梯 0.85→0.45、透明底刷白；GIF/WebP 不动以保动画/透明），上传弹窗显示「已压缩 原 → 现」；归档备份与导入导出连带资产
- **资产清理**：设置卡片「资产清理」——`notes-assets-prune` 扫描 `assets/` 中未被任何笔记正文引用的孤儿文件（已删除笔记的引用仍计入保护，宁留勿删），dry-run 预览勾选后才删除；发布版静态包走真删除，开发版为清空占位（0 字节墓碑）
- **回收站**：侧栏底部「回收站」（面板与全窗口页同入口）——列出软删除的笔记（`notes-list` 参数化 `includeDeleted`），支持**全选/多选 + 批量恢复 / 批量彻底删除**（confirm 明示「不可恢复（含历史版本）」，执行中防重入）；点标题行内**只读预览正文**（Markdown 渲染、零注入面）；逐条「恢复」（`notes-restore`）或「彻底删除」（`notes-purge`，confirm 双确认「彻底删除不可恢复」）；彻底删除仅限已软删除笔记（host 安全闸），`.md` 与归档备份 `.md.bak` 及 `.history/<id>` 快照历史一并移除——发布版静态包走真删除，开发版为清空占位（0 字节墓碑，全链路视作不存在）
- **多选批量操作**：列表「选择」进入多选态，底部操作条「已选 N 条 | 合并 | 删除 | 取消」——合并走归档预览、删除为软删除进回收站（confirm 注明可恢复），0 条勾选时按钮禁用
- **敏感笔记脱敏**：编辑器 meta 行 🔒 toggle（`sensitive=true`）——注入系统提示时正文按行打码（键名与结构保留、值遮蔽为 `******（敏感，note_get <id> 获取）`，agent 须 `note_get` 取原文；目录注入标题同样打码并加 🔒 标记）；命中密码/密钥模式自动识别——速记直接落 `sensitive=true`，手动创建回传 `sensitiveSuggested` 建议（不强制）
- **注入增强**：时效衰减提醒（目录行对超 `staleDays`（缺省 90 天，0=关闭）未更新的 note/link 尾注 ⚠）+ 注入体积预算（`injectBudgetChars` 字符预算，超限截断并标注）+ 设置卡片「注入预览」（`notes-inject-preview` 实时渲染注入产物 + 脱敏/时效/截断统计，三档视角：缺省全局 / 工作区并集 / 单会话过滤）+ `injectEver` 曾注入粘性标记（只升不降，驱动筛选中心「曾注入」与列表行徽章）
- **双链与反向链接**：正文 `[[id或标题]]` 互链（id 精确优先、标题全库精确匹配，解析不到按纯文本）——列表行尾双链标记、富文本内点击跳转目标笔记、详情区「反向链接」面板列出全库指向当前笔记的其他条目（全库惰性索引，未热时提示「索引中…」）
- **导入 / 导出**：设置卡片「数据」区入口——全库目录快照（含 `folders.json`，不打包不压缩，目录即格式；`.history` 版本历史默认不含，RPC `notes-export` 传 `includeHistory: true` 连带）；「导出单文件…」按范围（全部/文件夹/标签）把笔记拼接为单个自包含 Markdown（每篇 = 标题 + 元信息块 + 正文，可选目录页，图片 base64 内联，可直接分享；单文件超 20MB 告警但仍照常导出）；导入两步式：先预览（新增/相同/不同分类 + 文件夹合并统计）再执行，默认跳过内容不同的冲突、勾选后才覆盖；执行前自动备份（含 `.history`），只增改不删；导入合并 `.history` 仅对新增笔记连带，同 id 冲突跳过历史合并
- **Token 消耗统计**：设置卡片「用量」区——LLM 通道真实 usage 元数据计量（StreamChunk `usage` 字段，无元数据时按字符估算并标注「约」），当月用量 / 全量累计 / `usageBudgetMonthly` 月度预算提醒（接近与超限分档 toast）；统计落 `usage.json`，RPC `notes-usage-get`
- **Apple Notes 质感**：0 圆角列表项、纯背景选中、hover 才显操作、自动保存（底部提示「已自动保存 HH:MM」）、暗色模式适配
- **半独立应用**：浏览器直接访问 `/dsh-notes-app`（与 DSH Web 同源——把 DSH 页面地址的路径换成 `/dsh-notes-app` 即可）打开全窗口笔记页——包内 `app.html` 与面板共享 UI v2 和同一套 RPC 数据层，不进会话也能管理笔记（记录 / 文件夹 / 派发 / 导入导出 / 设置全可用）
- **性能**：内存缓存（写入同步回填，列表命中零磁盘读）+ 正文按需加载 + 懒加载分页（每屏 50 条）；面板位置/尺寸/列宽持久化到 `localStorage`
- **模块化工程结构（开发向）**：三端唯一源码按域切片——client 46 片 / app 40 片 / host 双清单 45 片次（manifest 有序逐字节拼接，零插入零改写；6 片双包共源单份，差异片以 `.dist.js` 变体登记）；`scripts/concat-*.cjs` 双包同源组装器 + `build-dist.cjs` 一次刷新四产物（`lib/client.js` + `lib/styles.css` + `app.html` + `index.mjs`）；check 模块化结构契约（序位/共源/变体登记断言）+ 发布面零 BOM 断言（防 DSH 静默 skip 插件事故）；`node check.js --only=39,42` 分节回归（`CHECK_ONLY` 环境变量同效）

## Agent 工具（3 个）

| 工具 | 作用 |
| --- | --- |
| `note_search` | 自由文本 + `tag` / `topic` / `kind` / `folder` 过滤检索（`folder` 兼容文件夹 id 或精确名称，`""` = 未分类；返回瘦身列表，正文用 `note_get` 取） |
| `note_get` | 按 id 读完整正文 + 全部元数据（含派发历史） |
| `note_manage` | 单一入口 CRUD + 整理 + 派发 + 移动：`create` / `list` / `update` / `move` / `delete` / `restore` / `archive` / `dispatch` |

`note_manage { action: 'move', id, folder }`：把笔记移入虚拟文件夹（`folder` 兼容文件夹 id 或精确名称，`""` = 移出到未分类；找不到文件夹直接报错，不写悬空引用）。文件夹本身的新建/重命名/删除/排序由面板的 `notes-folders` RPC 管理。

`note_manage` 的 `create` / `update` 另支持 `injectRole`（`'convention'` / `'reference'`，仅 `inject: true` 时有意义，缺省 `convention`）：`convention` = 须遵守的行为规则（「用户约定」桶），`reference` = 事实性补充信息（「参考资料」桶，agent 按需取用）；按 `kind` 推断的建议——`decision`/`todo` → `convention`，`note`/`link`/`quote` → `reference`。

`note_manage` 的 `create` / `update` 另支持 `recall`（布尔，默认 `true`）：置 `false` 把笔记移出目录索引注入（仍可被 `note_search` 检索到），与 `inject` 整篇注入正交。

`note_manage { action: 'dispatch', id, targetSessionId? }`：不传 `targetSessionId` 时返回当前活跃会话列表供选择，传了则把该待办注入目标会话并唤醒它开始工作。

## 数据位置

笔记是 `~/.dsh/notes/` 下的独立 Markdown 文件（YAML front-matter + 正文），**纯本地、不上传**；卸载插件不删数据。

```
~/.dsh/notes/
  n-xxxxxxxx.md        # 一条笔记 = 一个文件
  n-xxxxxxxx.md.bak    # 归档/覆盖时的备份
  .history/            # 快照式版本历史（每次保存前自动快照上一版；详见「版本历史」）
    n-xxxxxxxx/        # 按笔记分目录
      2026-09-17T06-02-34.123Z.ab1.cd2.md   # <UTC 时间戳>.<内容 hash>.md（纯文本，不压缩不加密）
  assets/              # 图片资产（base64 文本落盘；正文以 ![](assets/xxx) 相对路径引用；孤儿资产可用「设置 → 资产清理」清理）
  folders.json         # 虚拟文件夹清单 [{id, name, order}]（缺失/损坏自动兜底为空清单，不影响笔记主流程）
  settings.json        # 面板设置（LLM 模型选配、catalogEnabled 目录注入总开关、staleDays 时效阈值、injectBudgetChars 注入预算等）
  perf-report.json     # 面板性能遥测（可随时删除）
```

**版本历史（快照式）**：每次保存落盘前，host 自动把被替换的上一版快照进 `.history/<笔记 id>/`（与编辑器防抖对齐，一次真实保存 = 一份快照；无变化的重复保存按内容 hash 去重跳过）。保留策略：1 小时内每版全留 → 当天每小时 1 版 → 7 天内每天 1 版 → 超 7 天淘汰；单笔记最多 20 版；全库 `.history` 总预算 50MB（超限时跨笔记淘汰最旧快照）。回收站「彻底删除」会连带清空该笔记的整棵历史。历史是本地安全网：导出默认**不含** `.history`（RPC `notes-export` 加 `includeHistory: true` 才连带），导入前自动备份恒含历史，导入合并仅对库内不存在的新笔记连带其历史（同 id 冲突跳过，两库历史不混杂）。

首次启动若检测到旧的开发版笔记目录（`<repo>/notes/`），会**一次性复制**缺失的文件到 `~/.dsh/notes`（只复制、不删除，同名跳过）。

```yaml
---
id: n-xxxxxxxx
title: 标题
topic: 主题            # LLM 自动识别
workspace: 工作区名     # 取会话 cwd 目录名
folder: ""             # 虚拟文件夹 id（folders.json 清单内）；"" = 未分类
tags: tag1, tag2
kind: note             # note/decision/todo/link/quote
status: active         # active/pinned/resolved/superseded
inject: false          # 是否注入系统提示（注入为上下文总开关）
injectRole: convention # 注入角色（仅 inject=true 时落盘/生效）：convention=约定·须遵守的行为规则 / reference=资料·事实性补充信息（agent 按需取用）；缺省 convention
injectTo: []           # 注入范围多选：[] = 所有会话（默认）/ [会话短id,...] = 仅限这些会话（存量 global/workspace 值按所有会话容错）
recall: true           # 是否进目录索引注入（false 退出目录但仍可搜索；与 inject 正交）
injectEver: false      # 曾注入粘性标记（inject 曾置 true 即永久 true，只读）
sensitive: false       # 敏感笔记（注入时正文按行打码脱敏）
useCount: 0            # 使用遥测（note_get 命中计数，60s 防抖落盘）
createdAt: ISO-8601
updatedAt: ISO-8601
sessionId: 来源会话
cwd: 来源工作目录
dispatches: []         # 派发历史（会话/要求/时间/done）
mergedFrom: []         # 归档合并来源 id
archivedAt: ""
deleted: "false"       # 软删除标记
---

正文 Markdown
```

向后兼容：旧文件缺 `inject`/`kind`/`status`/`injectRole`/`injectTo`/`folder`/`recall`/`sensitive`/`injectEver`/`useCount` 字段时自动兜底（`folder` 缺省为未分类；`recall` 缺省为 true；`injectRole` 缺省为 `convention`；`sensitive`/`injectEver` 缺省 false；`useCount` 缺省 0，存量笔记零迁移；无 `inject` 时回退按 `tags` 含 `convention` 判定）。`folder` 指向清单外 id（如 folders.json 损坏或被外部改乱）时按未分类对待，删除文件夹会主动把其下笔记的 `folder` 清空回退未分类。

## 权限与实现

- **Host 端**：`inject: ['fs', 'sandboxPolicy']`，只需笔记读写与写策略；`llm` / `agents` / `systemPrompt` / `sessionPersistence` / `workspaceRegistry` 均按需 `ctx.get` + 存在性守卫，缺失时对应功能降级（如无 LLM 时不自动分类）
- **Client 端**：`inject: ['slots']`，注册 4 个 Slot 注入点——会话头部按钮（`conversation.session.header.actions`，order 40）、悬浮气泡（`shell.overlay` 199）、浮窗面板（200）、选区捕获（201）
- **通信**：client 经 `fetch('/dsh-notes')` POST `{method, args}` 调用 host 的 RPC（笔记 CRUD / 搜索 / 归档 / 派发 / 导入导出 / 设置 / `notes-folders` 文件夹管理等方法 + 1 个存活探测 `notes-ping`）；样式经 `notes-css` 下发并注入 `<style>`，零外部运行时依赖；宿主另注册 `GET /dsh-notes-app` 页面路由，直接返回包内 `app.html`（text/html，非 GET/HEAD 405）

## 源码与开发

- 仓库：<https://github.com/PPawnsir/dsh-notes-plugin>
- 本包（`packages/dsh-notes-plugin/`）由开发版模块化源码生成：`index.mjs` 为 host 端 ESM 静态包（`src/host/**` 按 `manifest.dist.js` 拼接写盘），`lib/client.js` 由 `scripts/build-dist.cjs` 从 `src/client/**` 拼接产物机械转换（带转换计数断言，漏改即中止），`app.html` 为 `/dsh-notes-app` 全窗口笔记页（`src/app/**` 拼接产物；与 `design/notes-ui-v2.html` 原型共享同一套 UI/交互，仅数据层不同）
- 回归测试（内存 mock，不触碰真实笔记）：

```sh
node scripts/build-dist.cjs           # 改完 src/**（client/host/app/shared/styles）后一次性刷新四产物：lib/client.js + lib/styles.css + app.html + index.mjs
node --check packages/dsh-notes-plugin/index.mjs
node --check packages/dsh-notes-plugin/lib/client.js
node check.js                         # 587 例回归（host 全链路 + 静态包 + client UI 面 + 虚拟文件夹 + 目录注入 + 导入导出 + 半独立页 + 双模式编辑器 + 敏感脱敏 + 注入增强 + 遥测/双链 + 快照式历史引擎 + 模块化结构契约）
```

详见 [DEVELOPMENT.md](https://github.com/PPawnsir/dsh-notes-plugin/blob/main/DEVELOPMENT.md)。

## License

MIT
