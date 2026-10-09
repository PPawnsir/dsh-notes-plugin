/* global harness */
// dsh-notes — host 端（ESM 静态包，发布版）
//
// 本文件是 bootstrap 开发版 host-impl.js 的**迁移**（不是重写）：apply 体内的功能逻辑逐段保留
// （25 个 RPC + 3 个工具 + 约定/目录注入 + 派发 + LLM 分类 + 缓存/归档/软删除 + 导入/导出 + 性能遥测）。
// 与开发版的三点结构性差异：
//   1. 形式：`return { inject, apply }`（被 new Function 执行）→ ESM `export name/inject/apply`
//      （package.json 已声明 "type": "module"、"main": "./index.mjs"）
//   2. 路径：PLUGIN_DIR/notes → ~/.dsh/notes（os.homedir()/.dsh/notes）。开发版目录仅保留两处用途：
//      (a) 一次性数据迁移源；(b) styles.css / src/client/** 模块源等开发资产的回退读取路径。
//   3. RPC/工具注册：主通道仍是全局 Builtin `harness`（`harness.handle` / `harness.defineTool` /
//      `harness.registerTool`，与 host-impl.js 的 `function handle(name,fn){ return harness.handle(...) }`
//      和 `harness.defineTool(def)` + `harness.registerTool(ctx, tool)` 姿势一致，原样保留）。
//      额外的兜底：若某部署没有 harness（例如真实 Cordis row 里没有沙箱注入的 Builtin），则同一批
//      handler 退到 `ctx.webServer.register({kind:'exact', path:'/dsh-notes'})`、工具退到 `ctx.tools.register`
//      （已发布范例 task-board-plugin/packages/dsh-agent-board/index.mjs 用的就是这条服务路径）。
//      两条通道互斥（工具不会重复注册）；RPC 表始终维护，供 webServer 路由消费。
import os from 'node:os'
import path from 'node:path'
import fsNode from 'node:fs'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-notes-plugin'
// 硬依赖：fs（笔记读写）+ sandboxPolicy（写策略）+ webServer（静态包 RPC 路由）+ tools（静态包工具注册）
// + agents/workspaceRegistry/sessionPersistence/sessionQuery/sessionTitle（派发与注入的会话列表数据源——
//   这些服务注册时机晚于基础服务，不声明 inject 时 apply 先于它们执行，ctx.get 拿到 undefined，会话列表永远为空）。
// harness 是动态插件的全局 Builtin，静态包里不存在（PACKAGING.md）——静态包必须 inject webServer/tools 走 ctx 服务通道。
// llm / agentDefaultModel / systemPrompt 为可选增强（自动分类/约定注入），保持 ctx.get + 守卫降级，不进 inject。
export const inject = ['fs', 'sandboxPolicy', 'webServer', 'tools', 'agents', 'workspaceRegistry', 'sessionPersistence', 'sessionQuery', 'sessionTitle']

// ---- 路径锚点（模块级常量，import 时求值，无副作用）----
const PKG_DIR = path.dirname(fileURLToPath(import.meta.url))     // packages/dsh-notes
const NOTES_ROOT = path.join(os.homedir(), '.dsh', 'notes')      // 发布版存储根
const SETTINGS_PATH = path.join(NOTES_ROOT, 'settings.json')     // 设置持久化（通用结构；当前仅 llm 选配）。
// LLM token 消耗统计落盘（独立于 settings.json：计量数据高频防抖写，与低频设置写隔离，互不坏档）
const USAGE_PATH = path.join(NOTES_ROOT, 'usage.json')
// 召回遥测机器存储层（0.4.3 验收修复⑤ notes-043-metrics-storage）：独立于 settings.json 防写放大；.json 不进笔记列表天然隐身
const TELEMETRY_PATH = path.join(NOTES_ROOT, 'telemetry.json')
// 向量边车（0.5.0① notes-050-vector-layer 语义检索向量层）：JSONL 逐行 { noteId, chunk, bodyHash, backend, vector }；
//   .jsonl 不进笔记列表天然隐身；与 telemetry.json/settings.json 同目录纪律（开发版 VECTORS_PATH 由 kernel/vector-store.js 定义）
const VECTORS_PATH = path.join(NOTES_ROOT, 'vectors.jsonl')
// .json 后缀不进笔记列表（_list/listMd 只认 .md），settings.json 落在同目录天然不污染列表。
// 开发版目录：只用于 (a) 首次启动的一次性数据迁移 (b) 开发资产回退读取。发布环境不存在这些文件时静默跳过。
const LEGACY_PLUGIN_DIR = 'D:\\deepseek-work\\dsh-notes-plugin'
const LEGACY_NOTES_DIR = path.join(LEGACY_PLUGIN_DIR, 'notes')
// 样式/源码候选路径：包内 lib/styles.css 优先（P3 会把 styles.css 放那里），再包根，最后开发版回退
const CSS_CANDIDATES = [
  path.join(PKG_DIR, 'lib', 'styles.css'),
  path.join(PKG_DIR, 'styles.css'),
  path.join(LEGACY_PLUGIN_DIR, 'src', 'styles.css'),
]
const RPC_PATH = '/dsh-notes'
// 半独立全窗口笔记页：GET /dsh-notes-app → 包内 app.html（v2 定稿原型改造，页面数据层走 RPC_PATH）。
// 与浮动面板并存：面板走 client bundle，页面是挂在同一 webServer 上的全窗口入口；host-impl.js 不动（静态包独有页面）。
const APP_PAGE_ROUTE = '/dsh-notes-app'
const APP_PAGE_FILE = path.join(PKG_DIR, 'app.html')
// 图片资产渲染路由：GET /dsh-notes/asset?file=assets/<name>（防穿越 + 扩展名白名单 mime + immutable 缓存）
const ASSET_ROUTE = '/dsh-notes/asset'

// 零外部依赖：link: 安装的包从真实路径解析，裸 import '@deepseek-ai/dsh-tools' 会 ERR_MODULE_NOT_FOUND。
// defineTool 本体只是 校验+包装 出 {name, description, parameters, output, execute} 普通对象，
// 这里内联等价实现（与 task-board index.mjs 相同）；parameters 已是完整 JSON Schema，原样透传。
function defineTool(options) {
  var userExecute = options.execute
  var userRender = options.output && options.output.render
  return {
    name: options.name,
    description: options.description,
    parameters: options.parameters,
    output: {
      schema: options.output.schema,
      render: userRender ? function (args, value) { return userRender(args, value) } : undefined,
    },
    execute: function (args, exec) { return userExecute(args, exec) },
  }
}

// ---- 会话元数据缓存（0.1.7 修复：notes-active-sessions ~128s 超时、派发对话框空白）----
// 根因：0.1.7 的 sessionQuery.readTitleSnapshots 对非 live 会话走 corpus.inspectPersisted
// 全量日志加载解析（每会话 ~10s，SessionCorpus 缓存容量仅 5，12 会话中 9 个非 live ≈ 128s），
// GUI fetch 等不到即渲染空列表。
// 策略：sid 粒度缓存（模块级 Map，插件重载 apply 不丢）——cwd/origin/createdAt 是不变字段长期有效；
// title 受 TTL（10min）约束：过期不删旧值（先用旧标题兜底展示、不闪烁），后台重读刷新。
// live 会话不读缓存：agents.get + sessionTitle.get 走内存，始终实时。
// （与开发版 host-impl.js 顶部同款，双边同步）
const SESS_META_TTL = 10 * 60 * 1000
const sessMetaCache = new Map()  // sid → { title, cwd, origin, createdAt, ts }
let sessMetaFillRunning = false  // 后台批量读串行化：避免对话框反复打开时叠加读盘

