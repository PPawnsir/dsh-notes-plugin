<div align="center">

# 📝 dsh-notes-plugin

**把 Agent 会话里「聊完就丢」的决策与约定，沉淀成本地 Markdown 笔记**

自动注入系统提示 · 可派发待办给活跃会话 · 选区一键摘录 · 纯本地 Markdown 不上传

[![npm version](https://img.shields.io/npm/v/dsh-notes-plugin.svg)](https://www.npmjs.com/package/dsh-notes-plugin)
[![npm downloads](https://img.shields.io/npm/dw/dsh-notes-plugin.svg)](https://www.npmjs.com/package/dsh-notes-plugin)
[![node](https://img.shields.io/node/v/dsh-notes-plugin.svg)](https://www.npmjs.com/package/dsh-notes-plugin)
[![license](https://img.shields.io/npm/l/dsh-notes-plugin.svg)](https://github.com/PPawnsir/dsh-notes-plugin/blob/main/LICENSE)
![category](https://img.shields.io/badge/awesome--dsh--plugin-workflow-blue)

<img src="./docs/screenshot-panel.png" alt="dsh-notes-plugin 笔记面板" width="820">

**交互演示** <br>
<img src="./docs/demo.gif" alt="dsh-notes-plugin 交互演示" width="820">

</div>

## 版本适配（dsh-notes ↔ DSH）

DSH 更新频繁，插件各版本能力与适配范围不同，**升级插件前请对照下表**。声明范围来自 `peerDependencies`（npm 安装时强制校验），「实测基线」是该版本开发与回归所用的 DSH 版本：

| 插件版本 | 发布 | 声明适配 DSH | 实测基线 | 要点 |
| --- | --- | --- | --- | --- |
| **0.2.4** | 2026-09-30 | `^0.1.7 \| 0.2.0-rc.2 \| ^0.2.0` | **0.2.0-rc.2** | 兼容 DSH 0.2.0：声明显式覆盖 0.2.0-rc.2 预发布（semver 预发布不命中宽区间，须枚举）；改名竞态防正文丢失；已在本机 0.2.0-rc.2 实测加载 |
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
- **虚拟文件夹**：侧栏笔记树按「📌 置顶 / 📁 文件夹 / 未分类（按主题分组）」组织，文件夹含计数、`＋` 内联新建；右键文件夹可重命名 / 上移 / 下移 / 删除（删除后其下笔记自动回退未分类）；**拖拽**列表项到文件夹行即挪入、拖到未分类区即挪出（列表项右键「📁 移动到文件夹」等效）；清单持久化在 `folders.json`，选中态存 `localStorage`
- **面板 UI v2**：两栏布局——左侧笔记树（置顶 / 文件夹 / 未分类主题分组，「主题过滤」跨文件夹全局生效），右侧通栏编辑器（标题 + 主题/标签/类型/状态 meta chips 直改）；SVG 图标库 + DSH 设计 token 配色，明暗主题自适应；快速记录卡片 v2（选区预览 + 复制/记录/取消，复制成功即关卡片）
- **上下文注入（双角色）**：详情区「⚡ 关闭 / 约定 / 资料」三态分段控件（独立字段 `inject` + `injectRole`，不依赖标签）——约定=须遵守的行为规则（每回合注入「用户约定」桶），资料=事实性补充信息（「参考资料」桶，与当前任务相关时按需取用）；范围浮层多选——默认注入所有会话，勾选具体会话则仅限这些会话（会话按工作区分组、显示会话名，自动排除子 agent 与已归档会话）
- **目录索引注入（recall 通道）**：整篇注入之外的轻量通道——一行一条目录（`- [id] 标题 (类型, 主题)`）自动注入系统提示（`order 131`，紧邻约定之后）并附规划轻推，agent 规划期即知库里有什么；已了结（resolved/superseded）与整篇注入已命中的笔记自动排除，40 条封顶；单条以前沿 `recall: false` 退出目录，设置卡片总开关（`catalogEnabled`）一键全关
- **任务派发**：待办一键派发到活跃会话或新建会话，可补充具体要求；派发记录（会话名/要求/时间/是否完成）落在笔记的 `dispatches` 字段里，正文不被污染；目标会话系统提示持续注入该待办直到标记完成；DSH 0.1.7 适配——活跃会话列表走会话元数据缓存（未命中先返回占位 + `titlesPending`，前端 1.5s 轮询补齐），加载从 128s 降到 0.2s
- **检索**：面板搜索框（本地即时过滤 + 250ms 防抖全文兜底，取并集）、kind 筛选 chips、`note_search` 工具
- **键盘流**：`Ctrl+K` 搜索、`Ctrl+N` 新建、`j/k`/`↑↓` 移动、`Enter` 打开、`Esc` 关闭（输入框内不抢键）
- **归档整理**：速记按会话合并、手动笔记按标签合并，原笔记软删除（`.bak` 备份）可恢复
- **导入 / 导出**：侧栏底部「导出」/ 设置卡片「数据」区入口——全库目录快照（含 `folders.json`，不打包不压缩，目录即格式）；导入两步式：先预览（新增/相同/不同分类 + 文件夹合并统计）再执行，默认跳过内容不同的冲突、勾选后才覆盖；执行前自动备份，只增改不删
- **Apple Notes 质感**：0 圆角列表项、纯背景选中、hover 才显操作、自动保存（底部提示「已自动保存 HH:MM」）、暗色模式适配
- **半独立应用**：浏览器直接访问 `/dsh-notes-app`（与 DSH Web 同源——把 DSH 页面地址的路径换成 `/dsh-notes-app` 即可）打开全窗口笔记页——包内 `app.html` 与面板共享 UI v2 和同一套 RPC 数据层，不进会话也能管理笔记（记录 / 文件夹 / 派发 / 导入导出 / 设置全可用）
- **性能**：内存缓存（写入同步回填，列表命中零磁盘读）+ 正文按需加载 + 懒加载分页（每屏 50 条）；面板位置/尺寸/列宽持久化到 `localStorage`

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
  folders.json         # 虚拟文件夹清单 [{id, name, order}]（缺失/损坏自动兜底为空清单，不影响笔记主流程）
  settings.json        # 面板设置（LLM 模型选配、catalogEnabled 目录注入总开关等）
  perf-report.json     # 面板性能遥测（可随时删除）
```

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

向后兼容：旧文件缺 `inject`/`kind`/`status`/`injectRole`/`injectTo`/`folder`/`recall` 字段时自动兜底（`folder` 缺省为未分类；`recall` 缺省为 true；`injectRole` 缺省为 `convention`，存量笔记零迁移；无 `inject` 时回退按 `tags` 含 `convention` 判定）。`folder` 指向清单外 id（如 folders.json 损坏或被外部改乱）时按未分类对待，删除文件夹会主动把其下笔记的 `folder` 清空回退未分类。

## 权限与实现

- **Host 端**：`inject: ['fs', 'sandboxPolicy']`，只需笔记读写与写策略；`llm` / `agents` / `systemPrompt` / `sessionPersistence` / `workspaceRegistry` 均按需 `ctx.get` + 存在性守卫，缺失时对应功能降级（如无 LLM 时不自动分类）
- **Client 端**：`inject: ['slots']`，注册 4 个 Slot 注入点——会话头部按钮（`conversation.session.header.actions`，order 40）、悬浮气泡（`shell.overlay` 199）、浮窗面板（200）、选区捕获（201）
- **通信**：client 经 `fetch('/dsh-notes')` POST `{method, args}` 调用 host 的 RPC（笔记 CRUD / 搜索 / 归档 / 派发 / 导入导出 / 设置 / `notes-folders` 文件夹管理等方法 + 1 个存活探测 `notes-ping`）；样式经 `notes-css` 下发并注入 `<style>`，零外部运行时依赖；宿主另注册 `GET /dsh-notes-app` 页面路由，直接返回包内 `app.html`（text/html，非 GET/HEAD 405）

## 源码与开发

- 仓库：<https://github.com/PPawnsir/dsh-notes-plugin>
- 本包（`packages/dsh-notes-plugin/`）由开发版 bootstrap 插件生成：`index.mjs` 为 host 端 ESM 静态包，`lib/client.js` 由 `scripts/build-dist.cjs` 从 `client-impl.js` 机械转换（带转换计数断言，漏改即中止），`app.html` 为 `/dsh-notes-app` 全窗口笔记页（与 `design/notes-ui-v2.html` 原型共享同一套 UI/交互，仅数据层不同）
- 回归测试（内存 mock，不触碰真实笔记）：

```sh
node scripts/build-dist.cjs           # 改完 client-impl.js 后刷新 lib/client.js
node --check packages/dsh-notes-plugin/index.mjs
node --check packages/dsh-notes-plugin/lib/client.js
node check.js                         # 276 例回归（host 全链路 + 静态包 + client UI 面 + 虚拟文件夹 + 目录注入 + 导入导出 + 半独立页）
```

详见 [DEVELOPMENT.md](https://github.com/PPawnsir/dsh-notes-plugin/blob/main/DEVELOPMENT.md) 与 [tests/e2e.md](https://github.com/PPawnsir/dsh-notes-plugin/blob/main/tests/e2e.md)。

## License

MIT
