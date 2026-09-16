# DSH 本地笔记插件 PRD

> 状态：这是早期迭代的需求文档，描述的字段/功能已被后续扩展（kind/status/inject/injectTo/任务派发/约定注入/逐级范围/Apple Notes UI）。当前完整能力见 [README.md](README.md)。

## 背景

DSH 本地笔记插件已实现基础能力：Markdown 落盘、Agent 工具（create/list/get/update/quick/delete）、主题（topic）自动分类、选区快速记录、浮动面板 UI。

本次迭代将笔记从"单条记录"升级为"可归档、可检索、可追溯"的知识管理。

## 需求

### R1. 快速记录标题 = 工作区 · 会话 · 主题

快速记录（quick-capture）的标题不再用正文前 50 字，改为三段式：

```
<工作区名> · <会话> · <主题>
```

- 工作区名：cwd 的目录名（如 `deepseek-work`）
- 会话：会话标题（host 端从 session header 获取；取不到则用短 sessionId）
- 主题：LLM 识别的 topic

### R2. 标题可跳转到来源

- 笔记 front-matter 记录 `sessionId` / `cwd`（已有）
- 笔记标题/来源信息可点击 → `sessions.open(sessionId)` 打开来源会话
- 精确定位到来源消息：本期降级（DSH 无消息定位 API），预留 `sourceSeq` 字段，作为后续增强

### R3. 合并归档（手动"归档"按钮）

面板标题栏加"归档"按钮，点击后：

- **快速记录**（tags 含 `quick`）：按 `sessionId` 合并 → 同会话多段记录合成一条，正文按时间戳分段
- **手动笔记**（非 quick）：按**标签**合并 → 同标签多条合成一条，正文按日期分段
- 合并后原笔记软删除，新笔记 front-matter 记录 `mergedFrom`（来源 id 列表）+ `archivedAt`

### R4. 检索

- UI：面板内搜索框，搜标题/正文/标签/主题（前端过滤）
- 工具：新增 `note_search`（参数 query/tag/topic），Agent 可调用

## 数据模型扩展

front-matter 新增字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `workspace` | string | 工作区名（cwd 目录名） |
| `sourceSeq` | number? | 来源消息 seq（预留，本期不填充） |
| `mergedFrom` | string[] | 合并来源的笔记 id 列表 |
| `archivedAt` | string? | 归档时间（ISO-8601） |

## 实现方案

### Host 端

- `_quickCapture`：标题改为三段式；写 `workspace` 字段
- `_archive`：按 sessionId（quick）/ 标签（非 quick）分组合并，生成新笔记，软删除原笔记
- `note_search` 工具：query/tag/topic 过滤
- RPC：`notes-archive`、`notes-search`

### Client 端

- 笔记列表项：标题可点击 → `sessions.open(sessionId)`
- 标题栏"归档"按钮 → `notes-archive`
- 列表顶部搜索框 → 前端过滤 + `notes-search`

## 技术备注

- 动态 client 端禁用浏览器定时器全局（setTimeout 等），需 `inject: ['timer']`
- 选区快速记录用 `selectionchange` 事件（mouseup 不从 DSH 消息区冒泡）
- `fs.writeText` 必须传 `danger-full-access` 沙箱策略（Windows ACL 后端不可用）
