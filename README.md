# DSH Notes Plugin

> DeepSeek Harness 的会话感知本地笔记插件 —— 快速记录、智能分类、约定注入、任务派发，Apple Notes 风格面板。

一个运行在 DSH 里的**动态 Cordis 插件**：笔记以 Markdown + YAML front-matter 落盘在本地，通过 Agent 工具与面板双通道读写，并能把"约定"类笔记自动注入 Agent 系统提示、把待办一键派发给活跃会话执行。

## 核心特性

- **快速记录**：面板顶部输入框 `Enter` 即存，`Shift+Enter` 换行；LLM 异步识别主题并回填标题（不阻塞交互）
- **选区记录**：选中页面任意文字，浮出「快速记录」按钮，一键存为 `quote` 类型笔记
- **同会话合并**：10 分钟窗口内的连续速记自动合并成一条（按时间戳分段）
- **类型与状态**（正交两个维度）：
  - `kind`：笔记 / 决策 / 待办 / 链接 / 引用
  - `status`：进行中 / 置顶 / 已解决 / 已取代（置顶单独分组、已解决降透明度）
- **约定注入**：打开「⚡ 注入为约定」开关，笔记内容自动注入 Agent 系统提示；范围逐级下拉可选（本工作区 / 全局 / 勾选多个会话），会话按工作区分组、显示会话名
- **任务派发**：待办可一键派发给任意**活跃**会话执行（`Agent.send` 注入对方 inbox），派发后笔记记录「已派发→会话X」
- **检索**：面板搜索框（本地即时 + 全文兜底并集）+ `note_search` 工具；kind 筛选 chips
- **键盘流**：`Ctrl+K` 搜索、`Ctrl+N` 新建、`j/k`/`↑↓` 移动、`Enter` 打开、`Esc` 关闭
- **归档整理**：速记按会话合并、手动笔记按标签合并，原笔记软删除可恢复
- **Apple Notes 质感**：0 圆角列表项、纯背景选中、hover 才显示操作、自动保存、暗色模式适配
- **性能**：内存缓存 + 正文按需加载 + 懒加载分页；选区监听 `isCollapsed` 快速路径 + 单注册防抖

## 安装

这是**动态 Cordis 插件**，通过 bootstrap 壳架构加载（壳代码极短，真正实现读磁盘文件，规避 define 传输截断）。

1. 把整个文件夹放到任意位置，**改 `host.js` 顶部一处的 `PLUGIN_DIR`** 为该文件夹的绝对路径（Windows 用 `\\`）。
2. 在 DSH 会话里，让 Agent 执行 `cordis_define`（把 `host.js`、`client.js` 的内容分别作为 host/client 代码传入）+ `cordis_run` 即可激活。

> 激活后改代码只需编辑磁盘上的 `host-impl.js` / `client-impl.js` / `styles.css`，然后 `cordis_run`（mode=run）重启——无需重新 define。

## 使用

- 点击会话头部「**笔记**」按钮（带计数徽标）打开/关闭面板
- 顶部输入框直接记录；选中页面文字点「快速记录」
- 列表按主题分组、置顶单独分组；点卡片右侧「↗ 会话」跳回来源会话
- 选中一条笔记进入详情：编辑标题/类型/状态/主题/标签，**自动保存**（底部显示「已自动保存 HH:MM」）
- 详情区「注入为约定」开关 + 范围浮层 = 约定注入；「▶ 派发」= 任务派发
- 标题栏「归档」整理笔记；点 `?` 看快捷键与说明

## Agent 工具（3 个）

| 工具 | 作用 |
|---|---|
| `note_search` | 自由文本 + tag/topic/kind 过滤检索（返回瘦身列表，正文走 note_get） |
| `note_get` | 按 id 读完整正文 + 元数据 |
| `note_manage` | 单一入口 CRUD + 整理 + 派发：`create / list / update / delete / restore / archive / dispatch` |

`note_manage dispatch { id, targetSessionId? }`：不传 `targetSessionId` 时返回当前活跃会话列表供选择；传了则把笔记待办注入该会话执行。

## 数据模型

笔记是 `notes/` 下的 Markdown 文件，YAML front-matter：

```yaml
---
id: n-xxxx
title: 标题
topic: 主题            # LLM 自动识别
workspace: 工作区名     # cwd 目录名
tags: tag1, tag2
kind: note             # note/decision/todo/link/quote
status: active         # active/pinned/resolved/superseded
inject: false          # 是否作为约定注入系统提示
injectTo: []           # 注入范围多选：[] = 本工作区 / [global] / [会话短id,...]
createdAt: ISO-8601
updatedAt: ISO-8601
sessionId: 来源会话
cwd: 来源工作目录
mergedFrom: []         # 归档合并来源 id
archivedAt: ""
deleted: "false"       # 软删除标记
---

正文 Markdown
```

向后兼容：旧文件无 `inject`/`kind`/`status` 字段时自动兜底（`inject` 回退到 `tags` 含 `convention`）。

## 架构

```
host.js / client.js        bootstrap 壳（~1KB，永不改业务逻辑）
host-impl.js               host 实现：fs 读写、LLM 分类、RPC、Agent 工具、约定注入、任务派发
client-impl.js             client 实现：面板 UI、选区记录、键盘流、注入/派发交互
styles.css                 全部样式（经 notes-css RPC 下发，Apple Notes 设计令牌）
check.js                   回归测试套件（内存 mock，不碰真实笔记）
tests/e2e.md               端到端验证方案
```

- **bootstrap 壳**：`cordis_define` 只传壳；壳用 `fs.readText` + `new Function` 加载磁盘实现，`pluginDir` 参数注入实现路径可移植
- **缓存**：解析结果常驻内存 `cache`，所有写入同步缓存，list 命中零磁盘读
- **约定注入**：`systemPrompt.context({ order: 130, text })` 同步从 cache 读；排除已删除/已归档/子 agent 会话
- **任务派发**：`agents.roots()` 拿活跃主会话，`agents.get(sid).send(msg, 'next-turn', true)` 注入

## 开发

```bash
node check.js    # 回归测试（语法 + host 全链路 mock + 工具 schema + client 结构断言）
```

详见 [DEVELOPMENT.md](DEVELOPMENT.md)（架构细节、Windows 沙箱根因）与 [tests/e2e.md](tests/e2e.md)（端到端验证方案）。

## License

MIT
