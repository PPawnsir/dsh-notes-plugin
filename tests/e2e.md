# 端到端验证方案（E2E）

本文件描述在真实 DSH 环境里手工验证 dsh-notes-plugin 的步骤。每个步骤都对应一个**验收信号**——不通过则记 bug。

## 前置条件

- DSH 在 `http://127.0.0.1:3080` 正常运行
- 插件已通过 `cordis_define` + `cordis_run` 安装并激活（当前 `pkg-8` 起的任意版本）
- 浏览器为最新版 Chrome/Edge（DSH Web GUI）
- 笔记目录 `D:\deepseek-work\dsh-notes-plugin\notes\` 可写

## 0. 单元测试基线（每次改动后必跑）

```bash
cd D:\deepseek-work\dsh-notes-plugin
node check.js
```

**验收**：49 passed / 0 failed。任何 failed 即视为改动引入了回归。

---

## 1. 插件加载（初次启用）

| # | 操作 | 期望 |
|---|---|---|
| 1.1 | 浏览器访问 DSH 并打开任一会话 | 会话头部出现「笔记」按钮 |
| 1.2 | 点击「笔记」按钮 | 浮空面板出现 |
| 1.3 | 拖动面板标题栏 | 面板跟随鼠标；松手后面板停在拖动位置 |
| 1.4 | 拖动面板右下角 20×20 区域 | 面板尺寸变化 |
| 1.5 | 拖动列表与编辑器之间的分隔条 | 列表宽度变化 |
| 1.6 | 关闭面板（点 ×） | 面板隐藏；位置/尺寸/列表宽度被记住（localStorage `dsh-notes-panel-state`） |
| 1.7 | 重新打开 | 面板在原位置、原尺寸 |
| 1.8 | 刷新整个页面（Ctrl+Shift+R） | 笔记按钮依然在；面板状态被保留 |

---

## 2. Agent 工具瘦身（T1.1）

| # | 操作 | 期望 |
|---|---|---|
| 2.1 | 在 DSH 对话里直接问 Agent：「列出本会话所有可用工具」 | 工具列表里**只有 3 个 note_* 工具**：`note_search` / `note_get` / `note_manage`。**不应**出现 `note_create`/`note_list`/`note_update`/`note_quick`/`note_archive`/`note_delete`/`note_restore` 旧名 |
| 2.2 | 让 Agent 调用 `note_manage(action="create", title="e2e 测试", body="...", topic="测试")` | 返回 `{action:"create", id:"n-...", topic:"测试"}`；`D:\deepseek-work\dsh-notes-plugin\notes\n-*.md` 出现对应文件 |
| 2.3 | 让 Agent 调用 `note_manage(action="list")` | 返回带 `action:"list"` 与 `count: N` 的结果；列表里有 2.2 创建的那条 |
| 2.4 | 让 Agent 调用 `note_manage(action="update", id="<2.2 的 id>", topic="设计")` | 返回 `{action:"update"}`；再 list，topic 变为「设计」 |
| 2.5 | 让 Agent 调用 `note_manage(action="delete", id="<2.2 的 id>")` | 返回 `{action:"delete"}`；再 list 看不到该条 |
| 2.6 | 让 Agent 调用 `note_manage(action="restore", id="<2.2 的 id>")` | 返回 `{action:"restore"}`；再 list 重新出现 |
| 2.7 | 让 Agent 调用 `note_manage(action="archive")` | 返回 `{action:"archive", merged: N, ...}` |
| 2.8 | 让 Agent 调用 `note_manage(action="nonexistent")` | 返回 `{error:"note_manage: 未知 action：nonexistent（期望 create/list/update/delete/restore/archive）"}` |
| 2.9 | 让 Agent 调用 `note_manage(action="delete")`（缺 id） | 返回 `{error:"note_manage.delete 需要 id"}` |
| 2.10 | 让 Agent 调用 `note_search(query="测试")` | 返回 slim 笔记列表，含 200 字 preview，无 body |
| 2.11 | 让 Agent 调用 `note_get(id="<某 id>")` | 返回完整笔记（含 body） |

**回归警告**：如果 2.1 看到旧工具名仍在工具目录里，说明 `host-impl.js` 改动未生效。

---

## 3. 快速记录（quick-capture）

| # | 操作 | 期望 |
|---|---|---|
| 3.1 | 在面板顶部输入框输入「今天记下这条」 | 输入框自适应增高（1-4 行） |
| 3.2 | 按 Enter | 输入框清空；列表顶部出现新卡片，主题 chip 显示「识别中…」（脉动动画） |
| 3.3 | 等 4-8 秒 | 主题 chip 变为 LLM 判定的主题（如「其他」「设计」） |
| 3.4 | 再次输入「同主题第二条」按 Enter | **合并入同一条**（10 分钟窗口内、同 session）；该卡正文按时间分段 |
| 3.5 | 在页面任意位置**划选一段文字**（至少 2 字符） | 松开后 140ms 内弹出蓝色「快速记录」浮动按钮，靠近鼠标位置 |
| 3.6 | 点击「快速记录」 | 按钮消失；列表顶部出现新卡片，主题 chip 为「识别中…」 |
| 3.7 | 切换到不同 session，在原 session 划选文字快速记录 | **不合并**（跨 session） |

---

## 4. 列表与搜索

| # | 操作 | 期望 |
|---|---|---|
| 4.1 | 在面板搜索框输入关键词 | 列表实时过滤（本地过滤，title/topic/tags/preview 命中） |
| 4.2 | 继续输入到 ≥ 250ms 静止 | host `notes-search` 异步调用，结果合并入本地结果（即使 RPC 失败，本地结果不消失） |
| 4.3 | 点击笔记卡片 | 右侧进入编辑模式，正文通过 `notes-get` 加载 |
| 4.4 | 点击笔记**主题 chip** | 行内弹出主题选择器（7 个预设 + 当前自定义主题） |
| 4.5 | 选新主题 | 立即生效（`note_manage.update`）；选择器收起 |

---

## 5. 软删除 + 归档

| # | 操作 | 期望 |
|---|---|---|
| 5.1 | hover 笔记卡片右上角 × | × 按钮显现 |
| 5.2 | 点击 × | 笔记从列表消失；弹出 toast「已删除（可由 Agent 恢复）」；文件保留、`deleted: true` |
| 5.3 | 让 Agent `note_manage(action="restore", id=...)` | 笔记重现 |
| 5.4 | 创建 ≥ 2 条同标签手动笔记，点标题栏「归档」 | 弹出 toast「归档完成：合并 N 组」；同类合并；原笔记软删除；`.bak` 备份在同目录 |

---

## 6. 性能基线（T1.1 完成后的稳态）

通过遥测文件 `D:\deepseek-work\dsh-notes-plugin\perf-report.json` 验证。

| 指标 | 期望 |
|---|---|
| `host.client.hostCall`（空闲 5 分钟） | 仅 +10（30s 推送本身） |
| `host.client.hostCallMs / hostCall` 平均 | < 20 ms（流式输出期间可短时升高） |
| `host.client.longTasks` 5 分钟新增 | < 5（流式渲染期间例外） |
| `host.client.selChange`（不打字时） | 0 |
| `host.client.panelRender` 5 分钟 | 极少（仅开关面板 / 选中变化时） |
| `host.client.hdrRender` | 与 DSH 流式渲染同步增长（100/s 级别），本插件不主动触发 |

**验收**：在 5 分钟空闲窗口内，`hostCall` 增长 ≤ 10（只有 30s 推送的两次）。如果任意指标异常增长，说明有泄漏或常驻开销。

读报告：
```powershell
Get-Content D:\deepseek-work\dsh-notes-plugin\perf-report.json
```

---

## 7. 重启验证

| # | 操作 | 期望 |
|---|---|---|
| 7.1 | `cordis_run mode=run packageId=pkg-8` | 插件重启；心跳文件 `.last-host-load` 时间戳刷新 |
| 7.2 | 检查 `D:\deepseek-work\dsh-notes-plugin\notes\` | 文件未丢失、未损坏 |
| 7.3 | 在浏览器**不刷新的情况下**操作面板 | 全部功能正常（证明动态插件 client hot-swap 工作正常） |
| 7.4 | 然后 Ctrl+Shift+R 硬刷新 | 笔记按钮 + 面板 + 历史记录全部恢复 |

---

## 8. 回归 checklist（每次改动跑一遍）

- [ ] `node check.js` → 49 passed / 0 failed
- [ ] `cordis_run mode=run` → 心跳文件时间戳刷新
- [ ] 步骤 1.1-1.8 插件加载正常
- [ ] 步骤 2.1 工具列表只有 3 个 note_* 工具
- [ ] 步骤 2.2-2.11 note_manage 六种 action + search/get 各跑一遍
- [ ] 步骤 3 快速记录 + 划选记录 + 合并窗口 + 跨 session 不合并
- [ ] 步骤 5 删除/恢复/归档 + `.bak` 备份存在
- [ ] 步骤 6 性能基线（5 分钟空闲窗口无异常）

**任一项不通过 = 改动引入了回归，必须回滚或修复。**

---

## 附：遥测字段速查

```json
{
  "writtenAt": "...",
  "host": {
    "started": "进程启动 ISO 时间",
    "rpc":    { "notes-list": N, "notes-search": M, ... },
    "rpcMs":  { "notes-list": ms, ... },
    "classify": 分类调用次数,
    "classifyMs": 分类总耗时 ms,
    "cacheReads": 命中缓存次数,
    "diskReads":  实际读盘次数,
    "diskWrites": 实际写盘次数,
    "client": {
      "selChange":          选区事件触发次数,
      "selCollapsedSkip":   因光标态跳过的次数（快速路径生效量）,
      "selChangeMs":        选区处理累计耗时 ms,
      "selShowEval":        实际执行 showFromSelection 次数（去抖后）,
      "selShowMs":          showFromSelection 累计耗时 ms,
      "mousemoveTracked":   实际跟踪的 mousemove 次数（仅选区存在时）,
      "hostCall":           客户端发起的 host.call 总次数,
      "hostCallMs":         客户端 host.call 累计等待时间 ms,
      "panelRender":        FloatingPanel render 次数,
      "selRender":          SelectionCapture render 次数,
      "hdrRender":          HeaderBtn render 次数（受 DSH 流式影响）,
      "longTasks":          主线程长任务（>50ms）数量,
      "longTaskMs":         长任务累计耗时 ms,
      "worstTaskMs":        最长单任务 ms
    }
  }
}
```
