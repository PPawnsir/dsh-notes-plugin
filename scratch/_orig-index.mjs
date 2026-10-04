/* global harness */
// dsh-notes — host 端（ESM 静态包，发布版）
//
// 本文件是 bootstrap 开发版 host-impl.js 的**迁移**（不是重写）：apply 体内的功能逻辑逐段保留
// （25 个 RPC + 3 个工具 + 约定/目录注入 + 派发 + LLM 分类 + 缓存/归档/软删除 + 导入/导出 + 性能遥测）。
// 与开发版的三点结构性差异：
//   1. 形式：`return { inject, apply }`（被 new Function 执行）→ ESM `export name/inject/apply`
//      （package.json 已声明 "type": "module"、"main": "./index.mjs"）
//   2. 路径：PLUGIN_DIR/notes → ~/.dsh/notes（os.homedir()/.dsh/notes）。开发版目录仅保留两处用途：
//      (a) 一次性数据迁移源；(b) styles.css / client-impl.js 等开发资产的回退读取路径。
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

export function apply(ctx) {
    const fs = ctx.fs
    const sp = ctx.sandboxPolicy
    const tools = ctx.tools
    const webServer = ctx.webServer
    const agents = ctx.get('agents')
    const llm = ctx.get('llm')
    const adm = ctx.get('agentDefaultModel')
    const systemPrompt = ctx.get('systemPrompt')
    const sessionPersistence = ctx.get('sessionPersistence')
    const workspaceRegistry = ctx.get('workspaceRegistry')
    const sessionTitle = ctx.get('sessionTitle')
    const sessionQuery = ctx.get('sessionQuery')
    const NOTES_DIR = NOTES_ROOT
    const disposers = []
    // 动态沙箱 Builtin：harness 是「dynamic Host half」的符号（cordis-host-runner 用 node:vm 注入），
    // 静态包（真实 Cordis row）里通常不存在；存在时作为兼容通道使用（见 RPC 桥 / regTool 回退）。
    const harnessRef = typeof harness !== 'undefined' ? harness : undefined

    function genId() {
      return 'n-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    }

    function basename(p) {
      if (!p) return ''
      const s = String(p).replace(/[\\/]+$/, '')
      const parts = s.split(/[\\/]/)
      return parts[parts.length - 1] || s
    }

    function shortSid(sid) { return sid ? String(sid).replace(/^session-/, '').slice(0, 8) : '' }

    // dispatches 派发历史：对象数组，front-matter 里以 JSON 字符串存储
    function parseDispatches(s) {
      if (!s) return []
      try { const d = JSON.parse(s); return Array.isArray(d) ? d : [] } catch (e) { return [] }
    }

    function escYaml(s) {
      s = String(s == null ? '' : s)
      if (/[":#\[\]{}&,*?|<>=!%@\n]/.test(s)) {
        return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"'
      }
      return s
    }

    // ==== sensitive-helpers BEGIN ====（本块三函数集中放置，check.js 提取本标记区间 eval 单测；host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，改动必须双边同步）
    // 背景：sensitive=true 的笔记正文可能含明文密码/密钥；inject=true 会把全文带进所有会话的系统提示（泄露面大）。
    // 策略：注入渲染（conventionText/catalogText）时对 sensitive=true 笔记的正文按行打码——保留键名与结构、只遮值；
    // 占位符统一为 ******（敏感，note_get <id> 获取），引导 agent 需要原文时用 note_get 按 id 自取（注入文本是一次性渲染，无 round-trip）。
    // 三规则：
    //   R1 键值行：行首（可带列表 -/*/+ 或标题 # 前缀）键名以敏感词结尾（password|passwd|pwd|token|secret|apikey|api-key|密码|口令|密钥|私钥|账号|帐号|凭证|credential|ssh 等），
    //      分隔符 : ：= 后值非空 → 遮整段值。键名敏感即视为凭据行，宁多勿漏（原文 note_get 可取，误遮代价低）。
    //   R2 空白裸令牌：敏感词 + 空白 + 形似凭据的令牌（≥4 位可打印 ASCII、非纯小写英文单词，规避「密码 必须足够长」「token expires soon」类散文误报）→ 只遮该令牌。
    //   R3 PEM 私钥块：-----BEGIN ... PRIVATE KEY----- 至 -----END ... PRIVATE KEY----- 整段，保留 BEGIN/END 行、遮中间体。
    // suggestSensitive 复用 maskSensitiveBody 判异：打码逻辑单点，自动建议与打码永不分叉。
    const SENSITIVE_KEY_RE = /(password|passwd|pwd|token|secret|api[-_ ]?key|apikey|access[-_ ]?key|secret[-_ ]?key|private[-_ ]?key|credential|密码|口令|密钥|私钥|账号|帐号|凭证|ssh)$/i
    const SENSITIVE_KV_RE = /^(\s*(?:[-*+]\s+)?(?:#{1,6}\s+)?)([^\s:：=][^:：=\n]{0,38}?)(\s*[:：=]\s*)(\S[\s\S]*)$/
    const SENSITIVE_TOKEN_RE = /(?<![A-Za-z0-9_])(password|passwd|pwd|token|secret|api[-_ ]?key|密码|口令|密钥|私钥)([ \t]+)([\x21-\x7e]{4,})/gi
    const SENSITIVE_PRIVATE_KEY_RE = /(-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z0-9 ]*PRIVATE KEY-----)/g
    function sensitivePlaceholder(id) { return '******（敏感，note_get ' + id + ' 获取）' }
    // 形似凭据的令牌：非纯小写英文单词（排除 expires/required 类散文；令牌本体已被 SENSITIVE_TOKEN_RE 限定为 ≥4 位可打印 ASCII，中文散文天然不命中）
    function looksLikeSecretToken(tok) { return !/^[a-z]+$/.test(tok) }
    function maskSensitiveLine(line, id) {
      const s = String(line == null ? '' : line)
      if (!s) return s
      // R1 键值行：键名以敏感词结尾 → 遮整段值（前缀/键名/分隔符保留；值已是占位符则幂等跳过）
      const m = s.match(SENSITIVE_KV_RE)
      if (m && SENSITIVE_KEY_RE.test(String(m[2]).replace(/["']+$/, ''))) {
        if (m[4].indexOf('******（敏感') === 0) return s
        return m[1] + m[2] + m[3] + sensitivePlaceholder(id)
      }
      // R2 空白裸令牌（幂等：占位符以 ****** 开头不再二次遮蔽）
      return s.replace(SENSITIVE_TOKEN_RE, function (mm, kw, ws, tok) {
        if (tok.indexOf('******') === 0) return mm
        if (!looksLikeSecretToken(tok)) return mm
        return kw + ws + sensitivePlaceholder(id)
      })
    }
    function maskSensitiveBody(body, id) {
      const s = String(body == null ? '' : body)
      if (!s) return s
      // R3 私钥块先行（跨行），再逐行 R1/R2
      const masked = s.replace(SENSITIVE_PRIVATE_KEY_RE, function (mm, b, e) { return b + '\n' + sensitivePlaceholder(id) + '\n' + e })
      return masked.split('\n').map(function (line) { return maskSensitiveLine(line, id) }).join('\n')
    }
    function suggestSensitive(text) {
      return maskSensitiveBody(text, 'n-sens-check') !== String(text == null ? '' : text)
    }
    // ==== sensitive-helpers END ====

    function buildFM(m) {
      return '---\n' +
        'id: ' + escYaml(m.id) + '\n' +
        'title: ' + escYaml(m.title) + '\n' +
        'topic: ' + escYaml(m.topic || '') + '\n' +
        'workspace: ' + escYaml(m.workspace || '') + '\n' +
        'folder: ' + escYaml(m.folder || '') + '\n' +
        'tags: ' + (m.tags || []).map(escYaml).join(', ') + '\n' +
        'kind: ' + escYaml(m.kind || 'note') + '\n' +
        'status: ' + escYaml(m.status || 'active') + '\n' +
        'inject: ' + escYaml(m.inject ? 'true' : 'false') + '\n' +
        // injectRole 仅 inject=true 时落盘（非注入笔记不带角色字段，避免脏数据）
        (m.inject ? 'injectRole: ' + escYaml(m.injectRole === 'reference' ? 'reference' : 'convention') + '\n' : '') +
        // injectEver 恒写（true/false 显式落盘，缺省 false）：曾注入粘性标记——一旦 inject 置 true 即永久 true，后续关闭 inject 不回退（侧栏「曾注入」过滤/行徽章数据源）
        'injectEver: ' + escYaml(m.injectEver === true ? 'true' : 'false') + '\n' +
        'injectTo: ' + (m.injectTo || []).map(escYaml).join(', ') + '\n' +
        'recall: ' + escYaml(m.recall === false ? 'false' : 'true') + '\n' +
        // sensitive 恒写（true/false 显式落盘，缺省 false）：敏感笔记注入时正文按行打码
        'sensitive: ' + escYaml(m.sensitive === true ? 'true' : 'false') + '\n' +
        'createdAt: ' + escYaml(m.createdAt) + '\n' +
        'updatedAt: ' + escYaml(m.updatedAt) + '\n' +
        'sessionId: ' + escYaml(m.sessionId) + '\n' +
        'cwd: ' + escYaml(m.cwd) + '\n' +
        // logDate 恒写（工作记忆 v0 §7.2：工作日志归键，YYYY-MM-DD 本地时区；周/月志为周期首日；非日志 kind 为空串）
        'logDate: ' + escYaml(m.logDate || '') + '\n' +
        'mergedFrom: ' + (m.mergedFrom || []).map(escYaml).join(', ') + '\n' +
        // entities 条件行（工作记忆 v0 §7.2：语义检索实体清单——结构预留不写值，仅非空时落盘，往返无损即完成「预留」）
        (m.entities && m.entities.length ? 'entities: ' + m.entities.map(escYaml).join(', ') + '\n' : '') +
        // summarizedAt 条件行（工作记忆 v0 §5.3：仅 host 自动总结产物写入，去重节流阀；Phase 3 启用）
        (m.summarizedAt ? 'summarizedAt: ' + escYaml(m.summarizedAt) + '\n' : '') +
        'dispatches: ' + escYaml(JSON.stringify(m.dispatches || [])) + '\n' +
        // useCount 恒写（缺省 0）：使用遥测——note_get 工具命中计数（内存累积 + 60s 防抖批量落盘，见 use-telemetry 块）
        'useCount: ' + escYaml(m.useCount || 0) + '\n' +
        'archivedAt: ' + escYaml(m.archivedAt || '') + '\n' +
        'deleted: ' + escYaml(m.deleted || 'false') + '\n' +
        '---\n\n'
    }

    function parseFM(content) {
      const meta = {}
      let body = content
      const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
      if (m) {
        body = m[2] || ''
        for (const line of m[1].split(/\r?\n/)) {
          const idx = line.indexOf(':')
          if (idx < 0) continue
          const key = line.slice(0, idx).trim()
          let val = line.slice(idx + 1).trim()
          if (val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') {
            val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n')
          }
          meta[key] = (key === 'tags' || key === 'mergedFrom' || key === 'injectTo' || key === 'entities')
            ? (val ? val.split(',').map(s => s.trim()).filter(Boolean) : [])
            : val
        }
      }
      return { meta, body }
    }

    function sessCtx() {
      const sc = { sessionId: '', cwd: '' }
      try {
        if (agents) {
          const a = agents.currentInitiator()
          if (a) {
            sc.sessionId = a.sessionId || (a.session && a.session.id) || ''
            sc.cwd = (a.session && a.session.header && a.session.header.cwd) || ''
          }
        }
      } catch (e) {}
      return sc
    }

    function getPolicy() {
      try {
        if (sp && sp.resolve) {
          return sp.resolve({ mode: 'danger-full-access' })
        }
      } catch (e) {}
      return undefined
    }

    // 三段式标题：工作区 · 会话 · 主题
    function buildQuickTitle(sc, topic) {
      const ws = basename(sc.cwd)
      const sess = sc.sessionId ? sc.sessionId.replace(/^session-/, '').slice(0, 8) : ''
      return [ws, sess, topic].filter(Boolean).join(' · ') || topic || '未分类'
    }

    // ---- 设置持久化（SETTINGS_PATH）：内存缓存 + 启动加载；文件坏/不存在 → {}（容错）----
    // 通用结构：设置项是 settingsCache 的顶层键（llm 选配 + catalogEnabled 目录索引总开关 + staleDays 时效标注 + injectBudgetChars 注入预算 + maxFolderDepth 文件夹嵌套深度上限），client 经 notes-settings-get/set 读写。
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
          } catch (e) { /* 文件不存在/损坏 → 空设置：默认行为（跟随会话 + 目录开）不变 */ }
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
    // 注入预览统计（notes-inject-preview RPC 数据源）：conventionText/catalogText 每次同步渲染后更新；
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
    // ==== llm-usage BEGIN ====（本块 host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，check.js 比对；改动必须双边同步）
    // LLM token 消耗统计（notes-token-stats）：分功能（classify 分类 / organize 整理 / summarize 总结）× 日 × 累计计量。
    // 计量口径（零侵入 llm 通道本身，只在调用点包装，见 streamMetered）：
    //   1. 真实值优先——dsh-llm 契约：adapter 在 terminal finish 前 emit { type:'usage', usage:TokenUsage }；
    //      取 usage.totalTokens，缺省退 inputTokens+cacheReadTokens+cacheWriteTokens+outputTokens（TokenUsage 三不相交，计费输入=三者之和）。
    //   2. 估算兜底——adapter 未 emit usage 时按字符数估算：tokens ≈ (输入字符+输出字符) / 1.6（中文≈1.6 字符/token 系数，UI 文案注明「约」）；
    //      估算部分累计进 estimatedTokens（exactTokens 记录真实值部分），RPC 透传供 UI 标注。
    // 存储：USAGE_PATH（notes/usage.json，独立于 settings.json）——
    //   { daily: { 'YYYY-MM-DD': { classify, organize, summarize, total } }, allTime: { 同结构 }, estimatedTokens, exactTokens, calls }
    // 落盘节奏：内存累积 + 5s 防抖写盘（搭调用路径，无独立定时器）；插件卸载 flush（ctx.effect dispose，fire-and-forget 不阻塞卸载）。
    // 进程退出丢失防抖窗口内未落盘计数（可接受，同 use-telemetry 口径；timer unref 不阻塞宿主退出）。
    const USAGE_FEATURES = ['classify', 'organize', 'summarize']
    const USAGE_FLUSH_MS = 5000
    const USAGE_EST_CHARS_PER_TOKEN = 1.6   // 中文≈1.6 字符/token 估算系数（仅 adapter 未回 usage 时兜底）
    let usageCache = null
    let usageLoadPromise = null
    let usageTimer = null
    let usageDirty = false
    function usageZeroBucket() { return { classify: 0, organize: 0, summarize: 0, total: 0 } }
    function loadUsage() {
      if (!usageLoadPromise) {
        usageLoadPromise = (async () => {
          const base = { daily: {}, allTime: usageZeroBucket(), estimatedTokens: 0, exactTokens: 0, calls: 0 }
          try {
            const p = await fs.resolve(USAGE_PATH)
            const c = await fs.readText(p)
            const obj = JSON.parse(c)
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
              if (obj.daily && typeof obj.daily === 'object' && !Array.isArray(obj.daily)) base.daily = obj.daily
              if (obj.allTime && typeof obj.allTime === 'object' && !Array.isArray(obj.allTime)) base.allTime = Object.assign(usageZeroBucket(), obj.allTime)
              if (typeof obj.estimatedTokens === 'number' && isFinite(obj.estimatedTokens)) base.estimatedTokens = Math.max(0, Math.round(obj.estimatedTokens))
              if (typeof obj.exactTokens === 'number' && isFinite(obj.exactTokens)) base.exactTokens = Math.max(0, Math.round(obj.exactTokens))
              if (typeof obj.calls === 'number' && isFinite(obj.calls)) base.calls = Math.max(0, Math.round(obj.calls))
            }
          } catch (e) { /* 文件不存在/损坏 → 从零起步（容错，同 settings 口径） */ }
          usageCache = base
          return usageCache
        })()
      }
      return usageLoadPromise
    }
    // 本地日期键（用户观感的「日」按本地时区）：YYYY-MM-DD
    function usageDayKey(d) {
      const m = String(d.getMonth() + 1), dd = String(d.getDate())
      return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (dd.length < 2 ? '0' + dd : dd)
    }
    // 记账：feature ∈ USAGE_FEATURES；usage 为 StreamChunk 的 usage（可空）；inChars/outChars 为估算兜底的输入/输出字符数
    async function recordUsage(feature, usage, inChars, outChars) {
      if (USAGE_FEATURES.indexOf(feature) < 0) return
      let tokens = 0, exact = false
      if (usage && typeof usage === 'object') {
        const t = usage.totalTokens
        if (typeof t === 'number' && isFinite(t) && t > 0) { tokens = Math.round(t); exact = true }
        else {
          const io = (usage.inputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0) + (usage.outputTokens || 0)
          if (io > 0) { tokens = Math.round(io); exact = true }
        }
      }
      if (!exact) tokens = Math.max(1, Math.round(((inChars || 0) + (outChars || 0)) / USAGE_EST_CHARS_PER_TOKEN))   // 估算兜底（UI「约」）
      if (!(tokens > 0)) return
      try { await loadUsage() } catch (e) { return }
      const key = usageDayKey(new Date())
      const day = usageCache.daily[key] || (usageCache.daily[key] = usageZeroBucket())
      day[feature] += tokens; day.total += tokens
      usageCache.allTime[feature] += tokens; usageCache.allTime.total += tokens
      if (exact) usageCache.exactTokens += tokens; else usageCache.estimatedTokens += tokens
      usageCache.calls++
      usageDirty = true
      if (!usageTimer) {
        usageTimer = setTimeout(() => { usageTimer = null; flushUsage() }, USAGE_FLUSH_MS)
        if (usageTimer && typeof usageTimer.unref === 'function') usageTimer.unref()
      }
    }
    // 防抖落盘（独立于 settings.json；写坏不影响设置）
    async function flushUsage() {
      if (usageTimer) { clearTimeout(usageTimer); usageTimer = null }
      if (!usageDirty || !usageCache) return
      usageDirty = false
      try {
        const p = await fs.resolve(USAGE_PATH)
        await fs.writeText(p, JSON.stringify(usageCache, null, 2), undefined, undefined, getPolicy())
      } catch (e) { usageDirty = true; console.error('notes: usage flush failed', e) }
    }
    // 计量包装（挂在现有 llm 调用点，不改 llm 通道）：统一迭代 llm.stream，收集 text-delta 正文 + 捕获 usage chunk，按 feature 记账。
    // 返回 { text, usage }——与原 for-await 循环等价语义（text-delta 拼接、finish 终止），调用点只换迭代壳。
    async function streamMetered(feature, options) {
      let text = ''
      let usage = null
      for await (const chunk of llm.stream(options)) {
        if (chunk && chunk.type === 'text-delta') text += chunk.text
        else if (chunk && chunk.type === 'usage') usage = chunk.usage || null
        if (chunk && chunk.type === 'finish') break
      }
      let inChars = 0
      try {
        if (typeof options.system === 'string') inChars += options.system.length
        for (const m of (options.messages || [])) {
          for (const c of ((m && m.content) || [])) if (c && typeof c.text === 'string') inChars += c.text.length
        }
      } catch (e) {}
      await recordUsage(feature, usage, inChars, text.length)
      return { text: text, usage: usage }
    }
    // 报表（notes-usage-get 数据源）：today（今日）/ week（近 7 天含今日）/ month（当月，月度预算提醒口径）/ allTime + byFeature 分列 + 估算/真实拆分
    function usageReport() {
      const zero = usageZeroBucket
      const d = (usageCache && usageCache.daily) || {}
      const today = Object.assign(zero(), d[usageDayKey(new Date())] || {})
      const week = zero()
      for (let i = 0; i < 7; i++) {
        const v = d[usageDayKey(new Date(Date.now() - i * 86400000))]
        if (v) for (const f of ['classify', 'organize', 'summarize', 'total']) week[f] += v[f] || 0
      }
      const month = zero()
      const prefix = usageDayKey(new Date()).slice(0, 7)   // 'YYYY-MM'
      for (const k of Object.keys(d)) {
        if (k.indexOf(prefix) !== 0) continue
        const v = d[k]
        for (const f of ['classify', 'organize', 'summarize', 'total']) month[f] += (v && v[f]) || 0
      }
      const allTime = Object.assign(zero(), (usageCache && usageCache.allTime) || {})
      const byFeature = {}
      for (const f of USAGE_FEATURES) byFeature[f] = { today: today[f], week: week[f], month: month[f], allTime: allTime[f] }
      return {
        today: today, week: week, month: month, allTime: allTime, byFeature: byFeature,
        estimatedTokens: (usageCache && usageCache.estimatedTokens) || 0,
        exactTokens: (usageCache && usageCache.exactTokens) || 0,
        calls: (usageCache && usageCache.calls) || 0
      }
    }
    // ==== llm-usage END ====
    // LLM 选择：settings.llm（provider+model 齐备）优先；否则回退跟随会话（adm.currentSelection）
    function resolveLlmSelection() {
      const s = settingsCache && settingsCache.llm
      if (s && typeof s.provider === 'string' && s.provider && typeof s.model === 'string' && s.model) {
        return { provider: s.provider, model: s.model }
      }
      if (!adm) return null
      try { return adm.currentSelection() } catch (e) { return null }
    }
    // 可用模型列表（设置卡片下拉数据源）：探 llm 服务目录；探不到返回 []（client 退化为手输 provider/model）
    async function listAvailableModels() {
      const models = []
      if (!llm) return models
      const seen = {}
      function push(provider, model, label) {
        if (!provider || !model) return
        const key = provider + '/' + model
        if (seen[key]) return
        seen[key] = true
        models.push({ provider: provider, model: model, label: label || key })
      }
      // 首选标准目录：llm.listProviders() → llm.listModels(provider)
      let providers = []
      try { if (typeof llm.listProviders === 'function') providers = (await llm.listProviders()) || [] } catch (e) {}
      if (!providers.length && Array.isArray(llm.providers)) providers = llm.providers
      for (const p of providers) {
        const pid = p && (typeof p === 'string' ? p : (p.id || p.provider))
        if (!pid) continue
        try {
          if (typeof llm.listModels === 'function') {
            const ms = (await llm.listModels(pid)) || []
            for (const m of ms) {
              const mid = m && (typeof m === 'string' ? m : (m.id || m.model))
              if (mid) push(pid, mid, (p && p.name ? p.name : pid) + ' / ' + (m && m.name ? m.name : mid))
            }
          }
        } catch (e) {}
      }
      // 退化探针：llm.list() / llm.listModels() 无参全量目录（部署差异兜底）
      if (!models.length) {
        for (const fnName of ['list', 'listModels']) {
          try {
            if (typeof llm[fnName] !== 'function') continue
            const all = (await llm[fnName]()) || []
            for (const m of all) { if (m && m.provider && (m.model || m.id)) push(m.provider, m.model || m.id) }
            if (models.length) break
          } catch (e) {}
        }
      }
      return models
    }

    async function classifyTopic(text) {
      if (!llm) return '未分类'
      try {
        await loadSettings()
        const sel = resolveLlmSelection()   // 设置里的 LLM 优先；未设置 → 跟随会话（adm.currentSelection）
        if (!sel || !sel.provider || !sel.model) return '未分类'
        const preset = ['需求', '设计', '开发', '调试', '运维', '调研', '其他']
        const prompt = '你是一个笔记主题分类器。预设主题：' + preset.join('、') + '。请优先从预设主题中选择最匹配的一个；如果内容明显不属于任何预设主题，可输出一个新的简短主题（2-6个汉字）。只输出主题名本身，不要解释、标点或换行：\n\n' + text
        // 计量包装（llm-usage 块）：usage chunk 真实值优先，缺省字符估算；feature='classify'
        const metered = await streamMetered('classify', {
          provider: sel.provider,
          model: sel.model,
          messages: [{
            id: 'topic-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            role: 'user',
            content: [{ type: 'text', text: prompt }],
            source: { kind: 'user' }
          }],
          system: '你是一个笔记主题分类器，把用户内容归纳成极简主题。',
          temperature: 0
        })
        const out = metered.text
        const topic = out.trim().replace(/^["'「」『』]+|["'「」『』]+$/g, '')
        return topic || '未分类'
      } catch (e) {
        console.error('notes: classifyTopic failed', e)
        return '未分类'
      }
    }

    // ---- 缓存层：解析结果按 id 常驻内存；本插件所有写入同步缓存，外部新增文件在 list 时懒加载 ----
    const KINDS = ['note', 'decision', 'todo', 'link', 'quote', 'log']   // 工作记忆 v0：+ kind=log（工作日志；治理语义不同——默认隐身 + 永不被过期/孤儿清理提名，见 design/agent-memory-v0.md §4.1）
    const STATUSES = ['active', 'pinned', 'resolved', 'superseded']
    // ---- 二期：kind 模板骨架（新建笔记预填）+ ✨整理 LLM prompt 的模板示例，同源于此 ----
    // （与开发版 host-impl.js 双边同步；client-impl.js / app.html / 原型 design/notes-editor-v3.html 同款，check.js 断言一致）
    // note 为自由格式（空骨架）；机器/运维信息类笔记由 ✨整理按内容套用 MACHINE_TEMPLATE（建时无法预判内容，不进 KIND_TEMPLATES）
    const KIND_TEMPLATES = {
      note: '',
      decision: '## 背景\n\n（问题与上下文）\n\n## 结论\n\n（最终选择）\n\n## 理由\n\n（权衡与依据）\n',
      todo: '- [ ] （待办事项）\n',
      link: '## 链接\n\n（URL）\n\n## 说明\n\n（用途与要点）\n',
      quote: '> （引用原文）\n\n—— （出处）\n',
      // 工作记忆 v0 工作日志模板（design/agent-memory-v0.md §4.2 四节结构）；同日多次追加在正文尾部加「## HH:mm 续」小节（复用速记合并的时间戳小节模式）
      log: '## 做了什么\n\n（本会话完成的任务/阶段，一句话一条）\n\n## 改动\n\n（改动的文件/配置/数据，路径 + 一句话）\n\n## 遗留与后续\n\n（未完成事项、已知风险、下次接续的入口）\n\n## 相关笔记\n\n（[[n-xxxxxxxx]] 双链引用本库相关笔记；无则空）\n'
    }
    // 机器信息模板（✨整理 prompt 的 note kind 内容适配分支：环境/机器清单/账号/门户）
    const MACHINE_TEMPLATE = '## 环境\n\n（环境名称与说明）\n\n## 机器清单\n\n（主机名 / IP / 用途）\n\n## 账号\n\n（登录方式与账号）\n\n## 门户\n\n（门户与入口地址）\n'
    const KIND_LABELS_ZH = { note: '笔记', decision: '决策', todo: '待办', link: '链接', quote: '引用', log: '日志' }
    const AI_ORGANIZE_MAX_CHARS = 12000   // ✨整理草稿上限（防 token 爆量）；超限报错引导分段
    const cache = new Map()

    function noteFromParsed(id, p) {
      const tags = p.meta.tags || []
      // inject：显式 true/false 优先；旧数据（无 inject 字段）回退到 tags 含 convention（向后兼容）
      const inject = p.meta.inject === 'true' ? true : (p.meta.inject === 'false' ? false : tags.indexOf('convention') >= 0)
      // injectTo：数组（parseFM 已按 , 拆分）；旧数据若是字符串也兜底成数组
      let injectTo = []
      if (Array.isArray(p.meta.injectTo)) injectTo = p.meta.injectTo
      else if (p.meta.injectTo) injectTo = String(p.meta.injectTo).split(',').map(s => s.trim()).filter(Boolean)
      // injectRole：注入角色（convention=须遵守的约定 / reference=按需取用的资料）；缺省/非法值回退 'convention'（存量零迁移）
      const injectRole = p.meta.injectRole === 'reference' ? 'reference' : 'convention'
      return {
        id: p.meta.id || id,
        title: p.meta.title || 'Untitled',
        topic: p.meta.topic || '未分类',
        workspace: p.meta.workspace || '',
        folder: p.meta.folder || '',
        tags: tags,
        kind: p.meta.kind || 'note',
        status: p.meta.status || 'active',
        inject: inject,
        injectTo: injectTo,
        injectRole: injectRole,
        // recall：目录索引准入字段，缺省 true（旧文件无 recall 字段 → 进目录）；显式 false 逐条关闭（与 inject 正交）；
        // 工作记忆 v0 默认隐身（裁决 B①）：kind=log 缺省 recall=false（日志不进目录；显式 recall=true 允许进目录的豁免保留）
        recall: p.meta.recall === 'true' ? true : (p.meta.recall === 'false' ? false : (p.meta.kind === 'log' ? false : true)),
        // sensitive：敏感内容标记（注入时正文按行打码，键保留值遮蔽），缺省 false（存量零迁移）
        sensitive: p.meta.sensitive === 'true',
        // injectEver：曾注入粘性标记（单向只升不降——inject 曾置 true 即永久 true，关闭不回退），缺省 false（存量零迁移）；
        // 当前 inject=true 蕴含曾注入（旧数据无字段时由现状兜底，保证 injectEver ⊇ inject 不变量）
        injectEver: p.meta.injectEver === 'true' || inject === true,
        createdAt: p.meta.createdAt || '',
        updatedAt: p.meta.updatedAt || '',
        sessionId: p.meta.sessionId || '',
        cwd: p.meta.cwd || '',
        // 工作记忆 v0 §7.2 检索字段：logDate（日志归键/聚合依据，缺省 ''）；entities（结构预留，缺省 []）；summarizedAt（自动总结节流阀，缺省 ''）
        logDate: p.meta.logDate || '',
        entities: Array.isArray(p.meta.entities) ? p.meta.entities : [],
        summarizedAt: p.meta.summarizedAt || '',
        mergedFrom: p.meta.mergedFrom || [],
        dispatches: parseDispatches(p.meta.dispatches),
        // useCount：使用遥测（note_get 工具命中计数），缺省/非法值回退 0（存量零迁移）
        useCount: Math.max(0, parseInt(p.meta.useCount, 10) || 0),
        archivedAt: p.meta.archivedAt || '',
        deleted: p.meta.deleted === 'true',
        body: p.body || ''
      }
    }

    function noteFile(id) { return path.join(NOTES_ROOT, id + '.md') }

    async function readNoteFile(id) {
      perfStats.diskReads++
      const ft = await fs.resolve(noteFile(id))
      const c = await fs.readText(ft)
      const note = noteFromParsed(id, parseFM(c))
      // purge 墓碑（0 字节占位）：ctx.fs 无删除契约时的彻底删除兜底形态——_list/_get/_update/_restore 视作不存在
      note.tombstoned = !c
      cache.set(note.id, note)
      return note
    }

    async function loadNote(id) {
      const hit = cache.get(id)
      if (hit) { perfStats.cacheReads++; return hit }
      return readNoteFile(id)
    }

    // ==== use-telemetry BEGIN ====（本块 host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，check.js 比对；改动必须双边同步）
    // 使用遥测（P2）：note_get 工具命中计数——度量哪些笔记真的被 agent 读过。
    // 口径：只计 note_get 工具命中（agent 引用语义）；client 面板打开笔记的 notes-get RPC 不计（人类浏览非引用）。
    // 落盘频率控制：命中只改内存缓存对象（_list/slim 立即可见），60s 防抖批量落盘（避免高频写盘），插件卸载 flush。
    // 代价兜底：进程退出时防抖窗口内未落盘的计数丢失（可接受；timer unref 不阻塞宿主退出）。
    const USE_COUNT_FLUSH_MS = 60 * 1000
    const useCountDirty = new Set()   // 待落盘笔记 id（重复命中幂等）
    let useCountTimer = null
    // 命中 +1：作用于缓存原件（_get 已保证入缓存）；返回新计数，缓存未命中/墓碑返回 null（调用方忽略）
    function bumpUseCount(id) {
      const n = cache.get(id)
      if (!n || n.tombstoned) return null
      n.useCount = Math.max(0, n.useCount || 0) + 1
      useCountDirty.add(id)
      if (!useCountTimer) {
        useCountTimer = setTimeout(() => { useCountTimer = null; flushUseCounts() }, USE_COUNT_FLUSH_MS)
        if (useCountTimer && typeof useCountTimer.unref === 'function') useCountTimer.unref()
      }
      return n.useCount
    }
    // 防抖批量落盘：逐条 persistNote（buildFM 恒写 useCount，updatedAt 不动——计数不算编辑）；
    // { history:false }：遥测回写不算编辑，不产生历史快照（见 history-engine 块）；
    // 墓碑/已删/缓存失效跳过（删除时已带最新计数落盘，跳过无数据损失；0 字节墓碑不可复活；已删笔记不会再被 note_get 命中）
    async function flushUseCounts() {
      if (useCountTimer) { clearTimeout(useCountTimer); useCountTimer = null }
      const ids = Array.from(useCountDirty)
      for (const id of ids) {
        useCountDirty.delete(id)
        const n = cache.get(id)
        if (!n || n.tombstoned || n.deleted) continue
        try { await persistNote(n, { history: false }) } catch (e) { console.error('notes: useCount flush failed', id, e) }
      }
    }
    // ==== use-telemetry END ====

    // 笔记对象 → 磁盘文件字节（front-matter + 正文）：persistNote 写盘与历史快照重建「上一版」共用同一构造函数，保证字节同口径
    function noteFileContent(n) {
      const meta = {
        id: n.id, title: n.title, topic: n.topic, workspace: n.workspace, folder: n.folder || '',
        tags: n.tags || [], kind: n.kind || 'note', status: n.status || 'active',
        inject: n.inject === true, injectEver: n.injectEver === true || n.inject === true, injectTo: n.injectTo || [], injectRole: n.injectRole === 'reference' ? 'reference' : 'convention', recall: n.recall !== false, sensitive: n.sensitive === true,
        createdAt: n.createdAt, updatedAt: n.updatedAt,
        sessionId: n.sessionId, cwd: n.cwd, logDate: n.logDate || '', entities: n.entities || [], summarizedAt: n.summarizedAt || '', mergedFrom: n.mergedFrom || [],
        dispatches: n.dispatches || [],
        useCount: Math.max(0, n.useCount || 0),
        archivedAt: n.archivedAt || '', deleted: n.deleted ? 'true' : 'false'
      }
      return buildFM(meta) + (n.body || '')
    }

    // ==== history-engine BEGIN ====（host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包同步：路径拼接与删除通道差异同 purgeNoteFile 先例——开发版 '\\' 拼接 + 墓碑式清空；静态包 path.join + processPath 真删。改动必须双边同步）
    // 快照式历史引擎：persistNote 每次真实落盘前，把「被替换的上一版」快照进 NOTES_DIR/.history/<noteId>/<ISO时间戳>.<hash>.md
    // （纯文本不压缩不加密，目录即格式；文件名 = UTC ISO 时间戳（':' 在 Windows 文件名非法 → '-'）+ 稳定内容 hash 后缀，字典序即时序，免读 mtime）。
    // 触发对齐 doSave 防抖：client 防抖后每次真实保存 = 一次 persistNote = 一次快照；创建首版无旧版可快照（缓存未命中自然跳过）。
    // 上一版来源 = persistNote 写盘前的 cache 原件经 noteFileContent 重建字节（插件写入全经 persistNote 同步缓存，缓存即盘上字节）——
    //   零新增磁盘读（update 主路径红线）；例外：useCount 内存累积未落盘时重建字节比盘上多一行计数差、外部手写文件经 FM 规范化重建（均内容等价）。
    //   浅拷贝别名注意：派发等原地变异路径的元数据字段可能已是新值，正文始终正确（字符串不可变）。
    // 内容去重：hash 只覆盖「稳定内容」（剔除 updatedAt/useCount 易变字段——保存时间戳/遥测计数不算内容变化）；
    //   与该笔记最新快照文件名内嵌 hash 比对，相同则跳过（无变化重复保存场景）；hash 内嵌文件名使插件重载后去重仍零读盘有效。
    // 保留策略（写入路径摊销执行，无定时器）：分层——1h 内每版全留 / 当天每小时 1 版 / 7 天内每天 1 版 / 超 7 天淘汰；
    //   单笔记硬上限 20 版（超限淘汰最旧）；全库 .history 总预算 50MB（LRU 跨笔记淘汰最旧快照）。
    // 删除语义同 purge：ctx.fs 无删除契约 → 开发版墓碑式清空（0 字节，histEnsureScanned 视作不存在）；静态包 processPath 可用时 node:fs 真删。
    // 性能红线：_list/_get/_search 主读取路径零新增 IO（.history 是子目录，列表只认 n-*.md 直子级，天然不枚举）；
    //   快照/去重/保留/预算全部挂写入路径（persistNote/_purge/导入导出）；惰性全量扫描每 apply 生命周期至多一次。
    // 自动元数据回写（useCount 防抖落盘 / agent status idle 派发回执）不算编辑：persistNote 第二参 { history:false } 不产生历史版本。
    const HISTORY_DIR = path.join(NOTES_DIR, '.history')
    const HIST_NOTE_CAP = 20                             // 单笔记硬上限（超限淘汰最旧）
    const HIST_GLOBAL_BUDGET = 50 * 1024 * 1024          // 全库 .history 总预算（LRU 淘汰最旧快照）
    const HIST_KEEP_ALL_MS = 60 * 60 * 1000              // 分层：1h 内每版全留
    const HIST_KEEP_DAILY_MS = 7 * 24 * 60 * 60 * 1000   // 分层：7 天内每天 1 版（更早淘汰）
    let histSizes = null   // Map(noteId → Map(文件名 → 字节数))：存活快照清单（0 字节墓碑/非法名不入）；null=未扫描（首个历史操作惰性建）
    let histBytes = 0      // 存活总字节（与 histSizes 同步维护；导入合并历史后整体置 null 触发下次重扫）

    // 稳定内容 hash：FNV-1a 32bit + 长度（纯 JS——vm 沙箱无 node:crypto 依赖）；剔除 updatedAt/useCount 易变字段（保存时间戳/遥测不算内容变化）。
    // 只用于同笔记相邻快照去重，碰撞代价 = 少留一份内容相同的快照（可接受）
    function histContentHash(n) {
      const s = noteFileContent(n).replace(/^updatedAt:.*$/m, 'updatedAt:').replace(/^useCount:.*$/m, 'useCount:')
      let h = 0x811c9dc5
      for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0 }
      return s.length.toString(36) + '.' + h.toString(36)
    }
    // 快照文件名形态：'2026-09-17T06-02-34.123Z.<len36>.<hash36>.md'；反解析出 UTC ms（保留分桶用），非法名 → NaN（扫描跳过）
    function histNameTs(name) {
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})\.(\d{3})Z\.[0-9a-z]+\.[0-9a-z]+\.md$/.exec(name || '')
      if (!m) return NaN
      return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7])
    }
    function histNameHash(name) {
      const m = /Z\.([0-9a-z]+\.[0-9a-z]+)\.md$/.exec(name || '')
      return m ? m[1] : ''
    }
    // 文件字节数：stat.size 可用优先；否则读回按 UTF-8 计（旧契约无 size 字段）；失败/墓碑空串 → 0
    async function histFileSize(ft) {
      try {
        const info = await fs.stat(ft)
        if (info && typeof info.size === 'number') return info.size
        return utf8Bytes(await fs.readText(ft))
      } catch (e) { return 0 }
    }
    // 删除一个快照文件（保留收敛/预算 LRU/purge 连带共用）：优先 node:fs 真删（fs.processPath 把 FsTarget 还原为进程路径）；
    // 不可用/失败 → 落回「墓碑式清空」writeText ''（与开发版一致，histEnsureScanned 视作不存在）。
    async function histRemoveFile(noteId, name) {
      try {
        if (typeof fs.processPath === 'function') {
          const target = await fs.resolve(path.join(HISTORY_DIR, noteId, name))
          const pp = target && fs.processPath(target)
          if (pp) { await fsNode.promises.unlink(pp); return }
        }
      } catch (e) { /* 真删不可用/失败 → 落回墓碑式清空 */ }
      await fs.writeText(await fs.resolve(path.join(HISTORY_DIR, noteId, name)), '', undefined, undefined, getPolicy())
    }
    // 惰性全量扫描（apply 生命周期首个历史操作至多一次）：建立存活清单 histSizes + 总字节 histBytes（0 字节墓碑视作不存在）
    async function histEnsureScanned() {
      if (histSizes) return
      histSizes = new Map()
      histBytes = 0
      let top = []
      try { top = await fs.listDir(await fs.resolve(HISTORY_DIR)) } catch (e) { return }
      for (const d of top) {
        const noteId = d && d.name
        if (!noteId || noteId.indexOf('n-') !== 0) continue
        let ents = []
        try { ents = await fs.listDir(await fs.resolve(path.join(HISTORY_DIR, noteId))) } catch (e) { continue }
        const files = new Map()
        for (const en of ents) {
          const name = en && en.name
          if (!name || !isFinite(histNameTs(name))) continue
          const bytes = await histFileSize(await fs.resolve(path.join(HISTORY_DIR, noteId, name)))
          if (bytes <= 0) continue
          files.set(name, bytes)
          histBytes += bytes
        }
        if (files.size) histSizes.set(noteId, files)
      }
    }
    // 单笔记保留收敛：分层（1h 每版 / 当天每小时 1 版 / 7 天每天 1 版 / 更早淘汰）+ 硬上限 20（淘汰最旧）
    async function histRetainNote(id) {
      const files = histSizes.get(id)
      if (!files || !files.size) return
      const now = Date.now()
      const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate() }
      const todayKey = dayKey(now)
      const entries = Array.from(files.keys()).map(name => ({ name: name, ts: histNameTs(name) })).sort((a, b) => b.ts - a.ts)   // 新→旧
      const hourSeen = {}, daySeen = {}
      const keep = [], drop = []
      for (const e of entries) {
        const age = now - e.ts
        if (age <= HIST_KEEP_ALL_MS) { keep.push(e); continue }
        if (dayKey(e.ts) === todayKey) {
          const hk = new Date(e.ts).getHours()
          if (!hourSeen[hk]) { hourSeen[hk] = 1; keep.push(e); continue }
        } else if (age <= HIST_KEEP_DAILY_MS) {
          const dk = dayKey(e.ts)
          if (!daySeen[dk]) { daySeen[dk] = 1; keep.push(e); continue }
        }
        drop.push(e)
      }
      while (keep.length > HIST_NOTE_CAP) drop.push(keep.pop())   // keep 新→旧：pop = 淘汰最旧
      for (const e of drop) {
        try {
          await histRemoveFile(id, e.name)
          histBytes -= files.get(e.name) || 0
          files.delete(e.name)
        } catch (err) { console.error('notes: history retention failed', id, e.name, err) }
      }
    }
    // 全库预算：LRU 跨笔记淘汰最旧快照直到 ≤ 50MB（搭写入路径摊销；清单已在 histEnsureScanned 摊销建立）
    async function histEnforceBudget() {
      if (histBytes <= HIST_GLOBAL_BUDGET) return
      const all = []
      for (const [id, files] of histSizes) for (const [name, bytes] of files) all.push({ id: id, name: name, ts: histNameTs(name), bytes: bytes })
      all.sort((a, b) => a.ts - b.ts)   // 最旧优先淘汰
      for (const f of all) {
        if (histBytes <= HIST_GLOBAL_BUDGET) break
        try {
          await histRemoveFile(f.id, f.name)
          const m = histSizes.get(f.id)
          if (m) m.delete(f.name)
          histBytes -= f.bytes
        } catch (e) { console.error('notes: history budget sweep failed', f.id, f.name, e) }
      }
    }
    // 快照主入口：persistNote 写盘前调用（prev = 写盘前缓存原件）。失败绝不阻塞保存——历史是增强不是门槛
    async function histSnapshot(id, prev) {
      try {
        const h = histContentHash(prev)
        await histEnsureScanned()
        let files = histSizes.get(id)
        if (!files) { files = new Map(); histSizes.set(id, files) }
        // 内容去重：与该笔记最新快照（文件名内嵌 hash）相同则跳过。
        // 文件名 ts 按笔记单调递增（同毫秒连写/时钟回拨兜底：ts = max(现存 ts)+1）→ 字典序最大即最新，去重永不错位
        let newest = ''
        let ts = Date.now()
        for (const name of files.keys()) {
          if (name > newest) newest = name
          const ets = histNameTs(name)
          if (isFinite(ets) && ets >= ts) ts = ets + 1
        }
        if (newest && histNameHash(newest) === h) return
        const content = noteFileContent(prev)
        if (!content) return
        const name = new Date(ts).toISOString().replace(/:/g, '-') + '.' + h + '.md'
        await fs.writeText(await fs.resolve(path.join(HISTORY_DIR, id, name)), content, undefined, undefined, getPolicy())
        const bytes = utf8Bytes(content)
        files.set(name, bytes)
        histBytes += bytes
        await histRetainNote(id)
        await histEnforceBudget()
      } catch (e) { console.error('notes: history snapshot failed', id, e) }
    }
    // purge 连带：删整棵 .history/<id>（含历史墓碑残留；processPath 可用时逐个真删，否则墓碑式清空）；返回清除文件数
    async function histPurgeNote(id) {
      try {
        let names = []
        try { names = (await fs.listDir(await fs.resolve(path.join(HISTORY_DIR, id))) || []).map(e => e && e.name).filter(Boolean) } catch (e) {}
        const files = histSizes ? histSizes.get(id) : null
        if (files) for (const n of files.keys()) { if (names.indexOf(n) < 0) names.push(n) }
        let purged = 0
        for (const name of names) {
          if (!/\.md$/i.test(name)) continue
          try { await histRemoveFile(id, name); purged++ } catch (e) { console.error('notes: history purge failed', id, name, e) }
        }
        if (files) { for (const b of files.values()) histBytes -= b; histSizes.delete(id) }
        return purged
      } catch (e) { console.error('notes: history purge failed', id, e); return 0 }
    }
    // 复制 <srcDir>/.history 全树（或仅 onlyId 一本笔记）到 <dstDir>/.history：导出 includeHistory / 导入前备份 / 导入合并共用。
    // 快照是纯文本（writeText 随写递归建目录）；0 字节墓碑不进出；skipExisting=同名快照跳过（导入合并只增不改）；返回复制文件数
    async function copyHistoryDir(srcDir, dstDir, skipExisting, onlyId) {
      let copied = 0
      let noteIds = []
      if (onlyId) {
        noteIds = [onlyId]
      } else {
        let top = []
        try { top = await fs.listDir(await fs.resolve(path.join(srcDir, '.history'))) } catch (e) { return 0 }
        noteIds = top.map(e => e && e.name).filter(n => n && n.indexOf('n-') === 0)
      }
      for (const noteId of noteIds) {
        let ents = []
        try { ents = await fs.listDir(await fs.resolve(path.join(srcDir, '.history', noteId))) } catch (e) { continue }
        for (const en of ents) {
          const name = en && en.name
          if (!name || !isFinite(histNameTs(name))) continue
          try {
            const c = await fs.readText(await fs.resolve(path.join(srcDir, '.history', noteId, name)))
            if (!c) continue   // 0 字节墓碑不进出
            const dstFt = await fs.resolve(path.join(dstDir, '.history', noteId, name))
            if (skipExisting && await fs.stat(dstFt)) continue
            await fs.writeText(dstFt, c, undefined, undefined, getPolicy())
            copied++
          } catch (e) { console.error('notes: history copy failed', noteId, name, e) }
        }
      }
      return copied
    }
    // ---- 历史版本面板 RPC 支撑（notes-history-ui）：列表（轻量零正文）/ 预览正文 / 恢复（恢复前置自动快照——恢复本身可撤销）----
    // 按 ts（UTC 毫秒）定位存活快照文件名：单笔记文件名 ts 单调递增唯一（histSnapshot 兜底 max(现存)+1），histSizes 即存活清单（0 字节墓碑/非法名不入）
    async function histFindName(id, ts) {
      await histEnsureScanned()
      const files = histSizes.get(id)
      if (!files) return ''
      const target = Number(ts)
      if (!isFinite(target)) return ''
      for (const name of files.keys()) { if (histNameTs(name) === target) return name }
      return ''
    }
    // notes-history {id} → { versions: [{ts, bytes}] }：按时间倒序（新→旧），零正文明文——列表轻量，正文走 notes-history-get 按需加载
    async function _historyList(id) {
      if (!id) return { error: 'notes-history 需要 id' }
      await histEnsureScanned()
      const files = histSizes.get(id)
      const versions = []
      if (files) for (const [name, bytes] of files) {
        const ts = histNameTs(name)
        if (isFinite(ts)) versions.push({ ts: ts, bytes: bytes })
      }
      versions.sort((a, b) => b.ts - a.ts)
      return { versions: versions }
    }
    // notes-history-get {id, ts} → { ts, body }：快照字节 = 完整笔记文件（front-matter + 正文），返回 parseFM 解析出的正文（预览只读）
    async function _historyGet(id, ts) {
      if (!id) return { error: 'notes-history-get 需要 id' }
      const name = await histFindName(id, ts)
      if (!name) return { error: '历史版本不存在（可能已被保留策略淘汰）' }
      const content = await fs.readText(await fs.resolve(path.join(HISTORY_DIR, id, name)))
      // 快照字节 = noteFileContent 产物（front-matter + '\n' 分隔行 + 正文原形）：parseFM 后剥一个前导换行，逐字节还原落盘前正文（cache 口径）
      return { ts: Number(ts), body: (parseFM(content).body || '').replace(/^\r?\n/, '') }
    }
    // notes-restore-history {id, ts} → 把历史版正文写回当前笔记（其余元数据不动，updatedAt 刷新）。
    // 安全核心 = 恢复前置快照：persistNote 缺省（opts.history 不传 ≠ false）在写盘前把「当前版」自动快照进 .history——恢复动作本身可撤销（再恢复一次即回滚）。
    async function _historyRestore(id, ts) {
      if (!id) return { error: 'notes-restore-history 需要 id' }
      const name = await histFindName(id, ts)
      if (!name) return { error: '历史版本不存在（可能已被保留策略淘汰）' }
      const note = Object.assign({}, await loadNote(id))
      if (note.deleted || note.tombstoned) throw new Error('Note has been deleted')
      const content = await fs.readText(await fs.resolve(path.join(HISTORY_DIR, id, name)))
      note.body = (parseFM(content).body || '').replace(/^\r?\n/, '')   // 剥一个前导换行，还原落盘前正文原形（同 _historyGet 口径）
      note.updatedAt = new Date().toISOString()
      await persistNote(note)   // 恢复前置快照：当前版先自动入 .history（缺省快照语义），随后才写恢复版——恢复可再撤销
      return { id: id, restored: true, ts: Number(ts) }
    }
    // ==== history-engine END ====

    // opts.history===false：自动元数据回写（useCount 防抖/idle 派发回执）不算编辑，不产生历史快照；其余每次真实落盘前快照上一版
    async function persistNote(n, opts) {
      perfStats.diskWrites++
      if (!opts || opts.history !== false) {
        const prev = cache.get(n.id)
        if (prev) await histSnapshot(n.id, prev)
      }
      const content = noteFileContent(n)
      const ft = await fs.resolve(noteFile(n.id))
      await fs.writeText(ft, content, undefined, undefined, getPolicy())
      cache.set(n.id, Object.assign({}, n))
    }

    // 列表/RPC 瘦身：不带 body，正文编辑走 notes-get 按需加载
    function slim(n) {
      return {
        id: n.id, title: n.title, topic: n.topic, workspace: n.workspace, folder: n.folder || '',
        tags: n.tags, kind: n.kind || 'note', status: n.status || 'active',
        inject: n.inject === true, injectEver: n.injectEver === true || n.inject === true, injectTo: n.injectTo || [], injectRole: n.injectRole === 'reference' ? 'reference' : 'convention', recall: n.recall !== false, sensitive: n.sensitive === true,
        createdAt: n.createdAt, updatedAt: n.updatedAt,
        sessionId: n.sessionId, cwd: n.cwd, logDate: n.logDate || '', entities: n.entities || [], summarizedAt: n.summarizedAt || '', mergedFrom: n.mergedFrom,
        dispatches: n.dispatches || [],
        useCount: n.useCount || 0,
        archivedAt: n.archivedAt, deleted: n.deleted === true, preview: String(n.body || '').slice(0, 200)
      }
    }

    // ---- 虚拟文件夹：~/.dsh/notes/folders.json 登记清单 [{id,name,order,parent?}]；parent=父文件夹 id（缺省=根级，存量数据无 parent 字段零迁移）；笔记 front-matter 的 folder 字段存文件夹 id（缺省 ''=未分类，向后兼容） ----
    // .json 后缀不进笔记列表（_list 只认 .md），与 settings.json 同理落在同目录天然不污染列表。
    const FOLDERS_PATH = path.join(NOTES_ROOT, 'folders.json')

    function genFolderId() {
      return 'f-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    }

    // 读文件夹清单：文件缺失/JSON 损坏/结构非法一律兜底为空数组（不抛错，笔记主流程不受 folders.json 影响）；
    // parent 仅真值落对象（缺省 undefined=根级，saveFolders JSON 序列化时 undefined 键自然省略，磁盘格式零迁移）
    async function loadFolders() {
      try {
        const ft = await fs.resolve(FOLDERS_PATH)
        const arr = JSON.parse(await fs.readText(ft))
        if (!Array.isArray(arr)) return []
        return arr.filter(f => f && f.id).map(f => { const o = { id: String(f.id), name: String(f.name || ''), order: typeof f.order === 'number' ? f.order : 0 }; if (f.parent) o.parent = String(f.parent); return o })
      } catch (e) { return [] }
    }

    async function saveFolders(list) {
      const ft = await fs.resolve(FOLDERS_PATH)
      await fs.writeText(ft, JSON.stringify(list, null, 2), undefined, undefined, getPolicy())
    }

    // ==== folder-tree-helpers BEGIN ====（本块纯函数集：全部数据经入参传入零闭包依赖，host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，check.js 提取本标记区间比对 + eval 单测；改动必须双边同步）
    // 文件夹嵌套（parent 字段）树形结构纯函数集。约定：根级文件夹深度=1，子级=父级深度+1。
    // 深度上限语义：maxDepth>0 时「挂载后子树最大深度 = folderDepth(parent) + 被挂子树高度」必须 ≤ maxDepth；maxDepth=0 不限。
    // 数据防御：parent 悬空（指向清单外 id）/ 存量 cycle 一律不抛错——visited 集合截断，按已遍历部分返回（损坏数据不拖垮主流程）。
    // folderDepth(id, folders)：沿 parent 链上溯计层数（根级=1；id 不在清单 → 0）
    function folderDepth(id, folders) {
      const byId = {}
      for (const f of folders) byId[f.id] = f
      let d = 0, cur = id
      const seen = {}
      while (cur && byId[cur] && !seen[cur]) { seen[cur] = true; d++; cur = byId[cur].parent }
      return d
    }
    // folderSubtreeIds(id, folders)：子树 id 集合（含自身 + 全部子孙），返回 {id:true} 映射（BFS 下行，cycle 防御）
    function folderSubtreeIds(id, folders) {
      const out = {}
      out[id] = true
      const queue = [id]
      while (queue.length) {
        const cur = queue.shift()
        for (const f of folders) if (f.parent === cur && !out[f.id]) { out[f.id] = true; queue.push(f.id) }
      }
      return out
    }
    // folderSubtreeHeight(id, folders)：子树高度（叶子=1，每深一层+1；cycle 防御 visited）
    function folderSubtreeHeight(id, folders, seen) {
      seen = seen || {}
      if (seen[id]) return 0
      seen[id] = true
      let h = 1
      for (const f of folders) if (f.parent === id) { const kh = folderSubtreeHeight(f.id, folders, seen) + 1; if (kh > h) h = kh }
      return h
    }
    // checkFolderAttach(folders, selfId, parentId, maxDepth)：挂载校验（create 新建 / reorder 拖父级共用）——
    //   parent 存在性 → cycle（selfId 非空时：parent 不得为自身或自身子孙）→ 深度上限（maxDepth=0 不限）。
    //   返回 null = 通过；否则返回中文错误串（RPC 前缀 op 名后直接透传）。
    function checkFolderAttach(folders, selfId, parentId, maxDepth) {
      if (!folders.some(function (x) { return x.id === parentId })) return '父文件夹不存在: ' + parentId
      if (selfId) {
        if (parentId === selfId) return '文件夹不能挂到自己下面'
        if (folderSubtreeIds(selfId, folders)[parentId]) return '文件夹不能挂到自己的子孙文件夹下面（cycle）'
      }
      if (maxDepth > 0) {
        const d = folderDepth(parentId, folders) + (selfId ? folderSubtreeHeight(selfId, folders) : 1)
        if (d > maxDepth) return '超过文件夹嵌套深度上限 maxFolderDepth=' + maxDepth + '（挂载后深度 ' + d + '；可在设置中调大或置 0 不限）'
      }
      return null
    }
    // ==== folder-tree-helpers END ====

    // 有效文件夹：folder 引用必须命中清单（清单损坏/外部改乱的笔记按未分类对待，保证计数与过滤口径一致）。
    // 嵌套语义：本函数只做直挂校验（返回笔记直挂的文件夹 id）；「归属子树」的递归解析由 folderSubtreeIds 承担
    // （_list 过滤 / _folders 计数 / cascade 删除 / 导出均走子树口径）。恢复的笔记若原文件夹已删除 → 此处兜底 '' 未分类。
    function effectiveFolder(note, folders) {
      const f = (note && note.folder) || ''
      if (!f) return ''
      return folders.some(x => x.id === f) ? f : ''
    }

    // 解析文件夹入参（工具层友好）：id 精确命中优先，其次按名称精确命中；'' = 未分类；找不到返回 null
    async function resolveFolderRef(ref) {
      const r = String(ref == null ? '' : ref).trim()
      if (!r) return { id: '', name: '' }
      const folders = await loadFolders()
      const byId = folders.find(x => x.id === r)
      if (byId) return { id: byId.id, name: byId.name }
      const byName = folders.find(x => x.name === r)
      if (byName) return { id: byName.id, name: byName.name }
      return null
    }

    // notes-folders RPC 核心：无参/op 缺省 = list（按 order 排序，含各文件夹计数 + unfiled 未分类计数 + parent/depth 嵌套字段供 UI 递归渲染）；
    // op = create(name,parent?)/rename/delete(id,cascade?)/reorder(ids,parents?)。
    // 计数口径：deleted 笔记由 _list 排除不计；folder 指向清单外 id 的笔记计入 unfiled；count 为**递归子树口径**（含全部子孙文件夹内笔记）。
    // 嵌套约束：create/reorder 拖父级时经 checkFolderAttach 校验（深度上限 maxFolderDepth 缺省 3 / 0 不限 + cycle 拒绝）。
    // delete 语义（级联必须显式传参）：缺省拒绝有子内容（子孙文件夹/子树笔记）的删除（needCascade 提示）；
    // cascade:true = 整棵子树文件夹删除（结构不可恢复）+ 其下全部笔记逐条软删（_delete 同通道，回收站可恢复；恢复后原文件夹已不存在 → effectiveFolder 兜底未分类）。
    async function _folders(args) {
      const a = args || {}
      const op = a.op || 'list'
      if (op === 'list') {
        const folders = await loadFolders()
        const all = await _list()
        const direct = {}
        let unfiled = 0
        for (const n of all) {
          const f = effectiveFolder(n, folders)
          if (!f) unfiled++
          else direct[f] = (direct[f] || 0) + 1
        }
        const list = folders.slice().sort((x, y) => x.order - y.order)
          .map(f => {
            // 子树口径计数：文件夹 count = 整棵子树（含自身 + 全部子孙文件夹）内笔记总数
            const sub = folderSubtreeIds(f.id, folders)
            let count = 0
            for (const sid in sub) count += direct[sid] || 0
            return { id: f.id, name: f.name, order: f.order, parent: f.parent || '', depth: folderDepth(f.id, folders), count: count }
          })
        return { folders: list, unfiled: unfiled }
      }
      if (op === 'create') {
        const name = String(a.name || '').trim()
        if (!name) return { error: 'notes-folders.create 需要 name' }
        const folders = await loadFolders()
        await loadSettings()   // 幂等（缓存 promise）：确保 maxFolderDepth 用户 override 已加载生效
        // 嵌套：parent 缺省=根级；显式传 parent 时校验存在性 + 深度上限（新建无 cycle 可能，selfId 传 null）
        let parent = ''
        if (a.parent) {
          parent = String(a.parent)
          const attachErr = checkFolderAttach(folders, null, parent, maxFolderDepthLimit())
          if (attachErr) return { error: 'notes-folders.create ' + attachErr }
        }
        const maxOrder = folders.reduce((m, f) => Math.max(m, f.order), -1)
        const folder = { id: genFolderId(), name: name, order: maxOrder + 1 }
        if (parent) folder.parent = parent
        folders.push(folder)
        await saveFolders(folders)
        return { ok: true, folder: folder }
      }
      if (op === 'rename') {
        if (!a.id) return { error: 'notes-folders.rename 需要 id' }
        const name = String(a.name || '').trim()
        if (!name) return { error: 'notes-folders.rename 需要 name' }
        const folders = await loadFolders()
        const f = folders.find(x => x.id === a.id)
        if (!f) return { error: '文件夹不存在: ' + a.id }
        f.name = name
        await saveFolders(folders)
        return { ok: true, id: a.id, name: name }
      }
      if (op === 'delete') {
        if (!a.id) return { error: 'notes-folders.delete 需要 id' }
        const folders = await loadFolders()
        const target = folders.find(x => x.id === a.id)
        if (!target) return { error: '文件夹不存在: ' + a.id }
        // 整棵子树（含自身 + 全部子孙文件夹）；子树内笔记含 kind=log 日志（治理路径显式召回，includeLogs=true）
        const subtree = folderSubtreeIds(a.id, folders)
        const childFolders = folders.filter(f => f.id !== a.id && subtree[f.id]).length
        const all = await _list(undefined, undefined, undefined, undefined, true)
        const notesInSubtree = all.filter(n => subtree[effectiveFolder(n, folders)])
        // 缺省拒绝有子内容的删除（cascade 必须显式传参）：返回统计供 confirm 明示
        if ((childFolders > 0 || notesInSubtree.length > 0) && a.cascade !== true) {
          return { error: 'notes-folders.delete 拒绝：文件夹「' + target.name + '」含子内容（子文件夹 ' + childFolders + ' 个 / 笔记 ' + notesInSubtree.length + ' 条），删除需显式传 cascade: true——文件夹结构整棵删除不可恢复，其下笔记软删除进回收站可恢复', needCascade: true, childFolders: childFolders, notes: notesInSubtree.length }
        }
        // cascade（或空文件夹直删）：其下全部笔记逐条软删（_delete 同通道，回收站可恢复）→ 整棵子树文件夹出清单
        let notesDeleted = 0
        for (const n of notesInSubtree) { await _delete(n.id); notesDeleted++ }
        await saveFolders(folders.filter(f => !subtree[f.id]))
        return { ok: true, id: a.id, folders: childFolders + 1, notes: notesDeleted }
      }
      if (op === 'reorder') {
        if (!Array.isArray(a.ids)) return { error: 'notes-folders.reorder 需要 ids 数组' }
        const ids = a.ids.map(String)
        const rank = {}
        ids.forEach((id, i) => { rank[id] = i })
        const folders = await loadFolders()
        // 拖父级改挂（可选）：parents 映射 {folderId: parentId|''}——逐个经 checkFolderAttach 校验（存在性/cycle/深度），
        // 校验与应用交错进行（每次应用后下一次校验看到最新树形，多步拖动组合安全）；''= 回根级（删除 parent 字段）
        if (a.parents && typeof a.parents === 'object') {
          await loadSettings()   // 幂等（缓存 promise）：确保 maxFolderDepth 用户 override 已加载生效
          const maxDepth = maxFolderDepthLimit()
          const byId = {}
          for (const f of folders) byId[f.id] = f
          for (const fid of Object.keys(a.parents)) {
            if (!byId[fid]) return { error: 'notes-folders.reorder 文件夹不存在: ' + fid }
            const np = a.parents[fid] ? String(a.parents[fid]) : ''
            if (np) {
              const attachErr = checkFolderAttach(folders, fid, np, maxDepth)
              if (attachErr) return { error: 'notes-folders.reorder ' + attachErr }
              byId[fid].parent = np
            } else delete byId[fid].parent
          }
        }
        // 入列的按 ids 顺序重排；未入列的保持原相对顺序追加尾部；最终 order 归一化为 0..n-1
        const inList = folders.filter(f => rank[f.id] !== undefined).sort((x, y) => rank[x.id] - rank[y.id])
        const outList = folders.filter(f => rank[f.id] === undefined).sort((x, y) => x.order - y.order)
        const merged = inList.concat(outList)
        merged.forEach((f, i) => { f.order = i })
        await saveFolders(merged)
        return { ok: true, folders: merged.map(f => ({ id: f.id, name: f.name, order: f.order, parent: f.parent || '' })) }
      }
      return { error: 'notes-folders: 未知 op：' + String(op) + '（期望 list/create/rename/delete/reorder）' }
    }

    // 由 sessionId 推导工作区名：live 走 agents 的 header.cwd，非 live 走 persistence/sessionQuery 快照。
    // 旧笔记（agents 未就绪期创建）workspace 为空时用于兜底补全——否则“本工作区”注入范围因严格匹配永不命中。
    async function _wsOfSession(sid) {
      if (!sid) return ''
      try {
        const a = agents && agents.get ? agents.get(sid) : undefined
        let cwd = (a && a.session && a.session.header && a.session.header.cwd) || ''
        if (!cwd && sessionPersistence && typeof sessionPersistence.list === 'function') {
          let snaps = []
          try { snaps = sessionPersistence.list() || [] } catch (e) { snaps = [] }
          if (snaps && typeof snaps.then === 'function') { try { snaps = await snaps } catch (e2) { snaps = [] } }
          for (const s of (snaps || [])) {
            const h = s && s.header ? s.header : s
            if (h && h.id === sid) { cwd = h.cwd || ''; break }
          }
        }
        // 兜底二：sessionQuery.readTitleSnapshots（_activeSessions 同款，已验证在当前 DSH 可用）
        if (!cwd && sessionQuery && typeof sessionQuery.readTitleSnapshots === 'function') {
          try {
            const rs = await sessionQuery.readTitleSnapshots([sid])
            for (const r of (rs || [])) {
              const v = r && r.status === 'fulfilled' ? r.value : (r && r.value)
              const hd = v && v.session ? v.session : null
              if (hd && hd.cwd) { cwd = hd.cwd; break }
            }
          } catch (e) {}
        }
        return cwd ? basename(cwd) : ''
      } catch (e) { return '' }
    }

    async function _create(title, body, tags, topic, extra) {
      const id = genId()
      const now = new Date().toISOString()
      const sc = sessCtx()
      const ex = extra || {}
      // 工作记忆 v0 隐身硬闸（裁决 B①）：kind=log 强制 inject=false（显式传 true 也纠正，返回值 injectForcedOff 告知），
      // recall 缺省 false（显式 true 豁免——用户/agent 显式选择进目录不算混入）；日志永不进系统提示与目录索引
      const isLog = (ex.kind || 'note') === 'log'
      const injectForcedOff = isLog && ex.inject === true
      const note = {
        id, title: title || 'Untitled', topic: topic || '未分类',
        workspace: ex.workspace || basename(sc.cwd),
        folder: ex.folder || '',
        tags: tags || [],
        kind: ex.kind || 'note',
        status: ex.status || 'active',
        inject: isLog ? false : ex.inject === true,
        // injectEver 粘性：创建即注入（inject=true）或显式继承（归档合并 members.some 传入）→ true；否则缺省 false
        // （kind=log 的 inject 已被硬闸纠正为 false，不随被纠正值拉起 injectEver）
        injectEver: isLog ? (ex.injectEver === true) : (ex.injectEver === true || ex.inject === true),
        injectTo: ex.injectTo || [],
        injectRole: ex.injectRole === 'reference' ? 'reference' : 'convention',
        recall: isLog ? (ex.recall === true) : (ex.recall !== false),
        sensitive: ex.sensitive === true,
        createdAt: ex.createdAt || now, updatedAt: ex.updatedAt || now,
        sessionId: ex.sessionId !== undefined ? ex.sessionId : sc.sessionId,
        cwd: ex.cwd || sc.cwd,
        // 工作记忆 v0 §7.2：logDate 归键（YYYY-MM-DD 本地时区），kind=log 缺省取今天；entities 结构预留缺省 []；summarizedAt 仅自动总结产物写入
        logDate: ex.logDate || (isLog ? localDateStr() : ''),
        entities: Array.isArray(ex.entities) ? ex.entities : [],
        summarizedAt: ex.summarizedAt || '',
        mergedFrom: ex.mergedFrom || [],
        dispatches: ex.dispatches || [],
        useCount: ex.useCount || 0,
        archivedAt: ex.archivedAt || '',
        deleted: false,
        body: body || ''
      }
      await persistNote(note)
      const r = { id, topic: note.topic, title: note.title, kind: note.kind, status: note.status }
      if (injectForcedOff) r.injectForcedOff = true   // 日志隐身硬闸命中告知（调用方可提示用户/agent）
      // 敏感模式自动识别建议：命中不强制落 sensitive（create 是显式动作，由调用方/用户决策），仅回传建议标记
      if (note.sensitive !== true && suggestSensitive(note.body)) r.sensitiveSuggested = true
      return r
    }

    // includeDeleted（P1 回收站）：缺省排除软删除；传 true 时 deleted 笔记一并返回（回收站列表数据源，slim 携带 deleted 标记）
    // includeLogs（工作记忆 v0 默认隐身）：缺省排除 kind=log；显式 kind=log 过滤 / includeLogs:true / 回收站（includeDeleted）路径才返回日志
    // （治理与数据完整性路径——整理建议/归档/导入导出/备份——由调用方显式传 includeLogs:true 包含日志）
    async function _list(tag, kind, folder, includeDeleted, includeLogs) {
      try {
        // 首次启动的一次性迁移（开发版 notes → ~/.dsh/notes）可能与首个 RPC 竞态，这里等一下
        try { await migrationDone } catch (e) {}
        const dirTarget = await fs.resolve(NOTES_DIR)
        const info = await fs.stat(dirTarget)
        if (!info) return []
        // 仅在按文件夹过滤时读清单（无过滤调用保持零额外磁盘读）
        const folders = folder !== undefined ? await loadFolders() : null
        // 递归子树口径（folder-tree-helpers）：folder 非空 = 该文件夹及全部子孙文件夹内的笔记；'' = 未分类（口径不变）
        const folderSubtree = (folder !== undefined && folder !== '') ? folderSubtreeIds(folder, folders) : null
        const entries = await fs.listDir(dirTarget)
        const notes = []
        for (const entry of entries) {
          if (!entry.name || !entry.name.endsWith('.md')) continue
          const id = entry.name.replace(/\.md$/, '')
          try {
            const note = await loadNote(id)
            if (note.tombstoned) continue   // purge 墓碑（0 字节占位）：任何列表口径都不算存在
            if (note.deleted && !includeDeleted) continue
            if (note.kind === 'log' && !includeLogs && !includeDeleted && !kind) continue   // 日志默认隐身（显式 kind=log 时 kind 过滤已放行）
            if (tag && (note.tags || []).indexOf(tag) < 0) continue
            if (kind && note.kind !== kind) continue
            if (folder !== undefined) {
              const ef = effectiveFolder(note, folders)
              if (folder === '') { if (ef !== '') continue }
              else if (!folderSubtree[ef]) continue
            }
            notes.push(note)
          } catch (e) { console.error('notes: read failed', entry.name, e) }
        }
        // ==== list-union-defense BEGIN ====（DSH fs watcher 停滞窗口防御：dsh-fs-local 冷启动期 listDir 快照对新建文件长期不可见（实测 30min+ 不自愈；
        // writeText 落盘成功、按路径 readText 正常、唯独 listDir 停滞）——cache 是 create/update/delete 的第一写入点天然最新，
        // 这里把 cache 中不在本次目录列表里的非墓碑条目并集补入，不依赖上游修复。
        // 红线索：①幂等——正常时目录条目经 loadNote 命中同一 cache 对象，按 id 去重零重复行；
        // ②补入条目与目录条目走**完全相同**的过滤管线（deleted/log 隐身/tag/kind/folder 全照原口径逐条复评），不开特例后门；
        // ③墓碑排除——purge 后条目被逐出 cache（或读入时标 tombstoned）不补入，回收站（includeDeleted）口径同样不出现。
        // 本块 host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，check.js 比对；改动必须双边同步）
        const listedIds = new Set()
        for (const ln of notes) listedIds.add(ln.id)
        for (const cn of cache.values()) {
          if (listedIds.has(cn.id)) continue   // 幂等去重：listDir 已见（loadNote 命中同一 cache 对象）
          if (cn.tombstoned) continue          // purge 墓碑（0 字节占位）：任何列表口径都不算存在
          if (cn.deleted && !includeDeleted) continue
          if (cn.kind === 'log' && !includeLogs && !includeDeleted && !kind) continue   // 日志默认隐身（显式 kind=log 时 kind 过滤已放行）
          if (tag && (cn.tags || []).indexOf(tag) < 0) continue
          if (kind && cn.kind !== kind) continue
          if (folder !== undefined) {
            const ef = effectiveFolder(cn, folders)
            if (folder === '') { if (ef !== '') continue }
            else if (!folderSubtree[ef]) continue
          }
          notes.push(cn)
        }
        // ==== list-union-defense END ====
        // 置顶（pinned）优先，其次按更新时间降序
        notes.sort((a, b) => {
          const pa = a.status === 'pinned' ? 1 : 0
          const pb = b.status === 'pinned' ? 1 : 0
          if (pa !== pb) return pb - pa
          return (b.updatedAt || '').localeCompare(a.updatedAt || '')
        })
        return notes
      } catch (e) {
        console.error('notes: list error', e)
        return []
      }
    }

    async function _get(id) {
      const note = await loadNote(id)
      if (note.deleted || note.tombstoned) throw new Error('Note has been deleted')
      return Object.assign({}, note)
    }

    // 回收站行预览专用（notes-trash-batch-preview）：已软删笔记正文只读可达；墓碑（已彻底删除）仍拒绝——正文已清空无可预览
    async function _getDeleted(id) {
      const note = await loadNote(id)
      if (note.tombstoned) throw new Error('Note has been deleted')
      return Object.assign({}, note)
    }

    // extra（工作记忆 v0 §7.2 检索字段透传）：{ logDate?, entities?, summarizedAt? }——显式传才改（undefined 不动存量值）
    async function _update(id, title, body, tags, topic, kind, status, inject, injectTo, folder, recall, injectRole, sensitive, extra) {
      const note = Object.assign({}, await loadNote(id))
      if (note.deleted || note.tombstoned) throw new Error('Note has been deleted')
      if (title !== undefined) note.title = title
      if (topic !== undefined) note.topic = topic
      if (tags !== undefined) note.tags = tags
      if (kind !== undefined) note.kind = kind
      if (status !== undefined) note.status = status
      // injectEver 单向粘性（never unset）：inject 显式置 true 时同步拉起；置 false/不传均不回退（injectEver = 旧值 || 新 inject）
      // 工作记忆 v0 隐身硬闸：生效 kind=log 时 inject 强制 false（显式传 true 也纠正，返回值 injectForcedOff 告知，且不拉起 injectEver）
      let injectForcedOff = false
      const effKind = (kind !== undefined ? kind : note.kind) || 'note'
      if (inject !== undefined) {
        if (effKind === 'log' && inject === true) { note.inject = false; injectForcedOff = true }
        else { note.inject = inject === true; if (inject === true) note.injectEver = true }
      }
      if (injectTo !== undefined) note.injectTo = injectTo
      if (folder !== undefined) note.folder = folder
      if (recall !== undefined) note.recall = recall !== false
      if (injectRole !== undefined) note.injectRole = injectRole === 'reference' ? 'reference' : 'convention'
      // sensitive 第 13 位参数：显式传才改（undefined 不动存量值）
      if (sensitive !== undefined) note.sensitive = sensitive === true
      // extra 第 14 位参数（工作记忆 v0）：logDate/entities/summarizedAt 检索字段透传
      const ex = extra || {}
      if (ex.logDate !== undefined) note.logDate = ex.logDate
      if (ex.entities !== undefined) note.entities = Array.isArray(ex.entities) ? ex.entities : []
      if (ex.summarizedAt !== undefined) note.summarizedAt = ex.summarizedAt
      if (body !== undefined) note.body = body
      // P3 派发闭环·保底联动：显式置 resolved 时自动回执全部未闭环派发（dispatchStatus→done + doneAt + receipt='resolved'）。
      // 这是语义闭环的必然可行通道（agent 完成派发任务后 note_manage update resolved）；事件回执见 dispatch-loop 标记块
      let dispatchClosed = 0
      if (status === 'resolved') dispatchClosed = _closeOpenDispatches(note, 'resolved')
      note.updatedAt = new Date().toISOString()
      // 兜底补全：约定笔记 workspace 为空（agents 未就绪期创建的存量）时按来源会话推导填入，
      // 否则“本工作区”注入范围在严格匹配下永不命中
      if (!note.workspace && note.sessionId) {
        try { note.workspace = await _wsOfSession(note.sessionId) } catch (e) {}
      }
      await persistNote(note)
      const r = { id, kind: note.kind, status: note.status, dispatchClosed: dispatchClosed }
      if (injectForcedOff) r.injectForcedOff = true   // 日志隐身硬闸命中告知（kind=log 强制 inject=false）
      return r
    }

    // 快速记录队列：串行化避免读-改-写竞态导致内容丢失
    // 合并策略：同 session 且上一条速记在 10 分钟内更新过才合并，否则新建（避免过度合并）
    // 主题分类异步执行：先落盘返回，分类完成后回填主题与标题，不阻塞交互
    const MERGE_WINDOW_MS = 10 * 60 * 1000
    let quickChain = Promise.resolve()
    function _quickCapture(text, sessionId, cwd, kind) {
      const run = quickChain.then(() => _quickCaptureInner(text, sessionId, cwd, kind))
      quickChain = run.then((r) => {
        if (!r || !r.id) return
        perfStats.classify++
        const ct0 = Date.now()
        return classifyTopic(text).then(async (topic) => {
          perfStats.classifyMs += Date.now() - ct0
          try {
            const newTitle = r.merged ? undefined : buildQuickTitle({ sessionId: r.sid, cwd: r.cwd }, topic)
            await _update(r.id, newTitle, undefined, undefined, topic)
          } catch (e) {}
        }).catch(() => {})
      }, () => {})
      return run
    }
    async function _quickCaptureInner(text, sessionId, cwd, kind) {
      const now = new Date().toISOString()
      const sc = sessCtx()
      const sid = sessionId || sc.sessionId
      const cw = cwd || sc.cwd
      // 敏感模式自动识别：速记是即发即忘场景（用户不会回头补标），命中直接落 sensitive=true（注入时自动脱敏）
      const sens = suggestSensitive(text)
      if (sid) {
        const all = await _list()
        const existing = all.find(n => (n.tags || []).indexOf('quick') >= 0 && n.sessionId === sid)
        const fresh = existing && existing.updatedAt && (Date.now() - new Date(existing.updatedAt).getTime()) < MERGE_WINDOW_MS
        if (existing && fresh) {
          const stamp = '## ' + now.slice(0, 10) + ' ' + now.slice(11, 16) + '\n\n'
          const newBody = String(existing.body || '').trim() + '\n\n' + stamp + text + '\n'
          // 正文合并 + 敏感继承（sensitive 是 _update 第 13 位参数；命中敏感模式时把原速记升级为敏感笔记）
          await _update(existing.id, undefined, newBody, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, sens ? true : undefined)
          return { id: existing.id, topic: existing.topic, title: existing.title, kind: existing.kind, merged: true, sid: sid, cwd: cw, sensitiveSuggested: sens }
        }
      }
      const id = genId()
      const title = buildQuickTitle({ sessionId: sid, cwd: cw }, '速记')
      const note = {
        id, title: title, topic: '分类中',
        workspace: basename(cw),
        tags: ['quick'],
        kind: kind || 'note',
        status: 'active',
        sensitive: sens,
        createdAt: now, updatedAt: now,
        sessionId: sid, cwd: cw,
        mergedFrom: [], archivedAt: '',
        deleted: false,
        body: text + '\n'
      }
      await persistNote(note)
      return { id, topic: '分类中', title: title, kind: note.kind, merged: false, sid: sid, cwd: cw, sensitiveSuggested: sens }
    }

    // T3 指令式快速记录：从用户备注提取元数据（tags/titleHint/kind/inject）
    // 复用 classifyTopic 的 llm.stream + resolveLlmSelection 模式（设置模型优先，否则跟随会话），temperature 0
    // 解析容错：失败/不规范 → 返回 null（调用方按无备注处理，等价 notes-quick）
    // 关键约束：绝不改写原文——LLM 只输出结构化 JSON，原文由调用方落盘
    async function extractInstruction(text, note) {
      if (!llm) return null
      try {
        await loadSettings()
        const sel = resolveLlmSelection()   // 设置里的 LLM 优先；未设置 → 跟随会话（adm.currentSelection）
        if (!sel || !sel.provider || !sel.model) return null
        const prompt = '给定选区原文和用户备注，从备注中提取笔记元数据。只输出严格 JSON，没提到的字段留空/默认，绝不改写原文。\n' +
          '字段说明：\n' +
          '- tags: 字符串数组，打标签（如备注"标记为重要 bug" → ["重要","bug"]）\n' +
          '- titleHint: 字符串，标题/主题引导（如"这是关于登录的" → "登录"）\n' +
          '- kind: 字符串，类型枚举 note/decision/todo/link/quote（如"这是待办" → todo）\n' +
          '- inject: 布尔，是否注入到系统提示上下文（如"记住这个" → true）\n' +
          '- injectRole: 字符串，注入角色枚举 convention/reference（仅 inject=true 时有意义）：convention=须遵守的约定，reference=与当前任务相关时按需取用的资料；按 kind 推断建议 decision/todo → convention、note/link/quote → reference；缺省 convention\n\n' +
          '选区原文：\n' + text + '\n\n用户备注：\n' + note + '\n\n只输出 JSON：{"tags":[],"titleHint":"","kind":"note","inject":false,"injectRole":"convention"}'
        // 计量包装（llm-usage 块）：指令提取属分类家族，feature='classify'
        const metered = await streamMetered('classify', {
          provider: sel.provider,
          model: sel.model,
          messages: [{
            id: 'instruct-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            role: 'user',
            content: [{ type: 'text', text: prompt }],
            source: { kind: 'user' }
          }],
          system: '你是一个笔记元数据提取器。从用户备注中提取结构化字段，输出严格 JSON，绝不改写原文。',
          temperature: 0
        })
        const out = metered.text
        // 容错解析：提取第一个 {...} 块；失败返回 null
        const m = out.match(/\{[\s\S]*\}/)
        if (!m) return null
        const obj = JSON.parse(m[0])
        const tags = Array.isArray(obj.tags) ? obj.tags.map(function (s) { return String(s).trim() }).filter(Boolean) : []
        const titleHint = obj.titleHint ? String(obj.titleHint).trim() : ''
        const kindRaw = String(obj.kind || '').trim().toLowerCase()
        const kind = KINDS.indexOf(kindRaw) >= 0 ? kindRaw : 'note'
        const inject = obj.inject === true
        const roleRaw = String(obj.injectRole || '').trim().toLowerCase()
        const injectRole = roleRaw === 'reference' ? 'reference' : (roleRaw === 'convention' ? 'convention' : '')
        return { tags: tags, titleHint: titleHint, kind: kind, inject: inject, injectRole: injectRole }
      } catch (e) {
        console.error('notes: extractInstruction failed', e)
        return null
      }
    }

    // T3 指令式快速记录：选区原文 + LLM 提取元数据 → 新建独立笔记
    // 备注为空 / LLM 不可用 / 解析失败 → 等价 notes-quick（走合并逻辑，原文不变）
    // 备注非空且 LLM 成功 → 新建独立笔记（不走合并窗口），body=选区原文（不变），应用提取的元数据
    async function _quickInstruct(text, note, sessionId, cwd) {
      const noteTrim = String(note || '').trim()
      // 备注为空 → 走现有逻辑（合并窗口，行为不变）
      if (!noteTrim) {
        const r = await _quickCapture(text, sessionId, cwd, 'quote')
        return { ok: true, id: r.id, applied: { tags: [], kind: r.kind || 'note', inject: false, injectRole: 'convention' }, merged: r.merged, sensitiveSuggested: r.sensitiveSuggested === true }
      }
      // 备注非空 → LLM 提取元数据
      const meta = await extractInstruction(text, noteTrim)
      if (!meta) {
        // LLM 不可用 / 解析失败 → 等价 notes-quick（合并逻辑，原文不变）
        const r = await _quickCapture(text, sessionId, cwd, 'quote')
        return { ok: true, id: r.id, applied: { tags: [], kind: r.kind || 'note', inject: false, injectRole: 'convention' }, merged: r.merged, fallback: true, sensitiveSuggested: r.sensitiveSuggested === true }
      }
      // 新建独立笔记（不走合并窗口），body=选区原文（不变）
      const now = new Date().toISOString()
      const sc = sessCtx()
      const sid = sessionId || sc.sessionId
      const cw = cwd || sc.cwd
      const extraTags = meta.tags.filter(function (t) { return t !== 'quick' })
      const tags = ['quick'].concat(extraTags)
      const topic = meta.titleHint || '速记'
      const title = buildQuickTitle({ sessionId: sid, cwd: cw }, topic)
      const id = genId()
      // 敏感模式自动识别（与 notes-quick 同口径：命中直接落 sensitive=true）
      const sens = suggestSensitive(text)
      const noteObj = {
        id: id, title: title, topic: topic, workspace: basename(cw),
        tags: tags, kind: meta.kind, status: 'active', inject: meta.inject, injectTo: [],
        // injectEver 粘性：指令式速记 LLM 判定 inject=true 时同步拉起（与 _create 同口径）
        injectEver: meta.inject === true,
        // 注入角色：LLM 显式输出优先，缺省 convention（与 noteFromParsed 回退口径一致）
        injectRole: meta.injectRole || 'convention',
        sensitive: sens,
        createdAt: now, updatedAt: now, sessionId: sid, cwd: cw,
        mergedFrom: [], archivedAt: '', deleted: false,
        body: text + '\n'
      }
      await persistNote(noteObj)
      // 无 titleHint 时异步分类回填主题/标题（不阻塞交互，复用 classifyTopic 模式）
      if (!meta.titleHint) {
        classifyTopic(text).then(async function (topic2) {
          try {
            const newTitle = buildQuickTitle({ sessionId: sid, cwd: cw }, topic2)
            await _update(id, newTitle, undefined, undefined, topic2)
          } catch (e) {}
        }).catch(function () {})
      }
      return { ok: true, id: id, applied: { tags: meta.tags, kind: meta.kind, inject: meta.inject, injectRole: meta.injectRole || 'convention', titleHint: meta.titleHint }, sensitiveSuggested: sens }
    }

    // ---- 二期 ✨整理（notes-ai-organize）：当前草稿经 LLM 按 kind 模板结构化重写，返回替换正文 ----
    // （与开发版 host-impl.js 双边同步，逻辑逐行一致）
    // 通道：notes-quick-instruct 同款 llm.stream + resolveLlmSelection（设置 LLM 优先，缺省跟随会话），temperature 0。
    // 不落盘：client 拿到重写正文后替换编辑器内容并走既有自动保存；原正文由 client 一次撤销栈兜底（toast「撤销」）。
    // prompt 设计（先规则后模板示例再草稿）：规则——事实零丢失/不编造、图片 ![](assets/...) 与链接原样保留、
    // 空章节只留标题、只输出正文；模板示例——直接嵌入 KIND_TEMPLATES/MACHINE_TEMPLATE 全文。
    // 输出容错：剥离 ```markdown 围栏；空结果/LLM 不可用/未配置模型 → error（client 保留原文不动）。
    async function _aiOrganize(args) {
      const body = args && typeof args.body === 'string' ? args.body : ''
      if (!body.trim()) return { error: '正文为空，无可整理内容' }
      if (body.length > AI_ORGANIZE_MAX_CHARS) return { error: '正文过长（' + body.length + ' 字，上限 ' + AI_ORGANIZE_MAX_CHARS + ' 字），请分段整理' }
      const kind = KINDS.indexOf(args && args.kind) >= 0 ? args.kind : 'note'
      const title = args && typeof args.title === 'string' ? args.title.trim() : ''
      if (!llm) return { error: 'LLM 不可用（宿主无 llm 服务）' }
      await loadSettings()
      const sel = resolveLlmSelection()
      if (!sel || !sel.provider || !sel.model) return { error: '未配置笔记 LLM 且无会话模型可跟随（可在设置卡片选配）' }
      const kindLabel = KIND_LABELS_ZH[kind] || '笔记'
      const prompt =
        '把下面这篇「' + kindLabel + '」类型的笔记草稿按对应模板结构化重写为 Markdown。\n\n' +
        '【重写规则】\n' +
        '1. 草稿中的全部事实信息（名称、地址、账号、密码、IP、日期、结论等）一条都不许丢，也不许编造草稿没有的事实；\n' +
        '2. 图片引用 ![](assets/...) 与链接 [文字](https://...) 原样保留在合适位置；\n' +
        '3. 按下方「' + kindLabel + '」模板的章节结构组织；草稿没有对应内容的章节只留标题，不要编造内容；\n' +
        '4. 语言与草稿保持一致；只输出重写后的 Markdown 正文，不要输出解释、前言或代码围栏。\n\n' +
        '【模板示例】\n' +
        '决策（kind=decision）：\n' + KIND_TEMPLATES.decision + '\n' +
        '待办（kind=todo）：\n' + KIND_TEMPLATES.todo + '\n' +
        '链接（kind=link）：\n' + KIND_TEMPLATES.link + '\n' +
        '引用（kind=quote）：\n' + KIND_TEMPLATES.quote + '\n' +
        '笔记（kind=note）：自由结构（适当的标题/列表/段落）；若草稿内容是机器/运维/部署信息，套用机器信息模板：\n' + MACHINE_TEMPLATE + '\n' +
        '【本篇类型】' + kindLabel + '（kind=' + kind + '）\n' +
        (title ? '【笔记标题】' + title + '\n' : '') +
        '【当前草稿】\n' + body + '\n\n只输出重写后的 Markdown 正文：'
      try {
        // 计量包装（llm-usage 块）：feature='organize'
        const metered = await streamMetered('organize', {
          provider: sel.provider,
          model: sel.model,
          messages: [{
            id: 'organize-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            role: 'user',
            content: [{ type: 'text', text: prompt }],
            source: { kind: 'user' }
          }],
          system: '你是笔记整理助手。把笔记草稿按指定类型的模板结构化重写为 Markdown，只输出重写后的正文本身。',
          temperature: 0
        })
        const out = metered.text
        // 容错：剥离整段 ```markdown/``` 围栏（模型偶发把正文包进代码块）
        let text = out.trim()
        const fence = text.match(/^```(?:markdown|md)?\s*\r?\n([\s\S]*?)\r?\n?```\s*$/)
        if (fence) text = fence[1].trim()
        if (!text) return { error: 'LLM 返回为空，原文未动' }
        return { ok: true, body: text + '\n', kind: kind }
      } catch (e) {
        console.error('notes: aiOrganize failed', e)
        return { error: String(e.message || e) }
      }
    }

    async function _delete(id) {
      const note = Object.assign({}, await loadNote(id))
      note.deleted = true
      note.updatedAt = new Date().toISOString()
      await persistNote(note)
      return { id }
    }

    // 恢复软删除的笔记（撤销删除/撤销归档）
    async function _restore(id) {
      const note = Object.assign({}, await loadNote(id))
      if (note.tombstoned) throw new Error('笔记已彻底删除，不可恢复')
      note.deleted = false
      note.updatedAt = new Date().toISOString()
      await persistNote(note)
      return { id }
    }

    // ---- P1 回收站：彻底删除（notes-purge）----
    // （与开发版 host-impl.js 双边同步；唯一差异：本静态包有 node:fs 真删除通道）
    // 仅限已软删除的笔记（安全闸：未进回收站的笔记拒绝彻底删除）；删除 n-<id>.md 与归档备份 n-<id>.md.bak。
    // 删除语义：ctx.fs（FileSystem 服务契约）只有读/写/编辑、没有删除——优先走 node:fs 真删除
    // （fs.processPath 把 FsTarget 还原为进程路径；不可用时落回「墓碑式清空」writeText ''，与开发版一致）。
    async function purgeNoteFile(name) {
      try {
        if (typeof fs.processPath === 'function') {
          const target = await fs.resolve(path.join(NOTES_DIR, name))
          const pp = target && fs.processPath(target)
          if (pp) { await fsNode.promises.unlink(pp); return 'deleted' }
        }
      } catch (e) { /* 真删不可用/失败 → 落回墓碑式清空 */ }
      await fs.writeText(await fs.resolve(path.join(NOTES_DIR, name)), '', undefined, undefined, getPolicy())
      return 'tombstoned'
    }
    async function _purge(id) {
      const note = await loadNote(id)
      if (note.tombstoned) throw new Error('笔记已彻底删除，不可恢复')
      if (!note.deleted) throw new Error('笔记未删除：彻底删除请先移入回收站（软删除）')
      const mode = await purgeNoteFile(id + '.md')
      // .bak 归档备份一并清除（存在才动，不存在不报错）
      try { if (await fs.stat(await fs.resolve(path.join(NOTES_DIR, id + '.md.bak')))) await purgeNoteFile(id + '.md.bak') } catch (e) {}
      // 快照历史连带清除（.history/<id> 整棵；删除语义同 purge——processPath 可用时真删，否则墓碑式清空）
      const historyPurged = await histPurgeNote(id)
      cache.delete(id)
      return { id: id, purged: true, mode: mode, historyPurged: historyPurged }
    }

    // ---- 显式归档（重构）----
    // 语义总览：
    //   1. 自动分组只处理速记（tags 含 quick，按 sessionId 分组，≥2 条才合并）。
    //      **行为变更**：手动笔记不再按标签自动分组（旧的 手动:<tags排序串> 分组逻辑已删除——漏合/过合两类失败的根因），
    //      手动笔记合并只能由调用方显式传 groups 白名单。
    //   2. notes-archive-preview：dry-run 零写入，返回将要自动合并的速记组；手动笔记不返回（由 client 多选构造组）。
    //   3. notes-archive 参数化 { groups: [{ memberIds, title? }] }：只合并白名单组；无 groups 时向后兼容旧调用但只合速记组。
    //   4. 撤销：每次实际合并成功后落盘 undo 事务文件（只保留最近一次），notes-archive-undo 撤销整次归档。
    //      .bak 备份机制保留不动（合并成员仍先备份再软删除）。

    // 归档撤销事务文件：{ at, groups: [{ noteId, memberIds }] }。
    // .json 后缀不进笔记列表（_list 只认 .md）；只保留最近一次（每次成功归档整体覆盖）；撤销成功后清空（groups: []）。
    const ARCHIVE_UNDO_PATH = path.join(NOTES_ROOT, '.archive-undo.json')

    // UTF-8 字节数（preview 的 bodyBytes/totalBytes 用；不依赖 Buffer，兼容 vm 沙箱全局受限环境）
    function utf8Bytes(s) {
      let n = 0
      for (const ch of String(s || '')) {
        const c = ch.codePointAt(0)
        n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
      }
      return n
    }

    // 速记自动分组：tags 含 quick 的未删笔记按 sessionId 分组；仅 ≥2 成员的组可合并。
    // 组内按 updatedAt 升序（与合并正文顺序一致），返回 [{ sessionId, members }]
    function _quickGroups(all) {
      const bySid = new Map()
      for (const n of all) {
        if ((n.tags || []).indexOf('quick') < 0) continue
        const sid = n.sessionId || 'none'
        if (!bySid.has(sid)) bySid.set(sid, [])
        bySid.get(sid).push(n)
      }
      const out = []
      for (const [sid, members] of bySid) {
        if (members.length < 2) continue
        members.sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''))
        out.push({ sessionId: sid, members: members })
      }
      return out
    }

    // 归档预览（dry-run，零写入）：只返回将要自动合并的速记组（quick tag 按 sessionId，≥2 条）。
    // 手动笔记不返回——手动合并由调用方（client 多选 / agent）显式构造 groups 传给 notes-archive。
    // 无速记组时 quickGroups 为空数组。title 与 _mergeGroup 默认标题同规则（last.topic || first.title）。
    async function _archivePreview() {
      const all = await _list()
      const quickGroups = _quickGroups(all).map(g => {
        const last = g.members[g.members.length - 1]
        const members = g.members.map(n => ({
          id: n.id, title: n.title, updatedAt: n.updatedAt || '',
          bodyBytes: utf8Bytes(n.body), useCount: n.useCount || 0
        }))
        return {
          sessionId: g.sessionId,
          title: last.topic || g.members[0].title || '归档',
          members: members,
          dateSpan: {
            from: (g.members[0].updatedAt || g.members[0].createdAt || '').slice(0, 10),
            to: (last.updatedAt || last.createdAt || '').slice(0, 10)
          },
          totalBytes: members.reduce((s, m) => s + m.bodyBytes, 0),
          // 合计引用数（使用遥测）：组行展示用，对接显式归档决策
          totalUseCount: members.reduce((s, m) => s + m.useCount, 0)
        }
      })
      return { quickGroups: quickGroups }
    }

    // ==== suggest-helpers BEGIN ====（本块 host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，check.js 提取比对 + eval 单测；改动必须双边同步）
    // 整理建议判定内核（notes-suggest 的纯函数部分，零外部函数依赖可 eval 单测）：
    // 让已合入的 useCount（遥测）+ staleDays（时效）数据产生闭环价值——主动提名整理动作。
    // 红线：只提名不执行（归档走 notes-archive-preview/notes-archive；删除由 client confirm 后逐条 notes-delete 软删）。
    // 双链判定与 client 编辑器同一正则口径：[[target]]（target 不含方括号/换行）；[[id]] 或 [[标题]] 精确命中即视为被引用。
    const SUGGEST_LINK_RE = /\[\[([^\[\]\n]+)\]\]/g
    // 孤儿候选上限：提名而非穷尽（防长列表淹没前两段；最旧的优先展示）
    const SUGGEST_ORPHAN_LIMIT = 20
    // 提取正文 [[target]] 出链（与 client 侧提取同口径；上限 500 防病态正文卡正则）
    function suggestLinkTargetsOf(body) {
      const out = []
      SUGGEST_LINK_RE.lastIndex = 0
      let m
      while ((m = SUGGEST_LINK_RE.exec(String(body == null ? '' : body)))) { out.push(m[1]); if (out.length >= 500) break }
      return out
    }
    // 时效判定：updatedAt 距今超过 limit 天 → 整天数；limit<=0（关闭）/无法解析/未超期 → 0
    // （与外层 staleDaysOf 同口径；本块自包含不引用外部函数，nowMs 可注入供单测取确定值）
    function suggestStaleDays(updatedAt, limit, nowMs) {
      if (limit <= 0) return 0
      const t = Date.parse(updatedAt || '')
      if (!isFinite(t)) return 0
      const d = Math.floor(((nowMs || Date.now()) - t) / 86400000)
      return d > limit ? d : 0
    }
    // 候选计算（纯函数；all = 未删除全量笔记，staleLimit = staleDaysLimit() 由调用方注入）：
    //   staleCandidates：kind=note/link 且 updatedAt 距今 > staleLimit 且 useCount===0
    //     （从未被引用且过期的参考资料——最高优先清理信号；useCount>0 的过期笔记仍被 agent 引用，不提名）。按 staleDays 降序。
    //     工作记忆 v0：kind=log 永不进入 stale/orphan 候选——日志是记录类资产，只聚合不淘汰（§6.3），删除权完全留给用户。
    //   orphanCandidates：可能无用的孤儿笔记（上限 20，最旧在前）。判定条件（防误伤，缺一不可）：
    //     · kind='note'：普通笔记（todo/decision/link/quote 各有生命周期语义，不在此列）
    //     · status='active'：pinned/resolved/superseded 是显式用户状态，不动
    //     · inject=false：注入中的笔记正在影响会话系统提示，绝不提名
    //     · useCount=0：被 note_get 命中过即视为有价值
    //     · 正文无 [[..]] 出链，且全库无指向它的 [[id]]/[[标题]] 反向链接
    //       （all 不含已删笔记——已删笔记的链接不算活引用，与 client 反向链接面板口径一致）
    //     · 排除速记（tags 含 quick：已由 archiveCandidates 通道提名，避免双重提名误导）
    //     · 排除归档产物（mergedFrom 非空：合并归档笔记是「已整理」成果，提名删除会误伤归档结果）
    function suggestCandidates(all, staleLimit) {
      const staleCandidates = []
      if (staleLimit > 0) {
        for (const n of all) {
          if (n.kind === 'log') continue   // 日志永不被过期清理提名（工作记忆 v0 §6.3：记录类资产只聚合不淘汰；kind 白名单之外的显式双保险）
          if (n.kind !== 'note' && n.kind !== 'link') continue
          const sd = suggestStaleDays(n.updatedAt, staleLimit)
          if (sd <= 0) continue
          if ((n.useCount || 0) > 0) continue   // 遥测保护：仍被引用的过期笔记不提名
          staleCandidates.push({ id: n.id, title: n.title, topic: n.topic || '', updatedAt: n.updatedAt || '', staleDays: sd })
        }
        staleCandidates.sort((x, y) => y.staleDays - x.staleDays)
      }
      // 反向链接索引：全库正文 [[target]] 集合（一次扫描；命中 id 或标题即视为被引用）
      const linkTargets = new Set()
      for (const n of all) for (const t of suggestLinkTargetsOf(n.body)) linkTargets.add(t)
      const orphans = []
      for (const n of all) {
        if ((n.kind || 'note') === 'log') continue   // 日志永不被孤儿清理提名（同上：只聚合不淘汰）
        if ((n.kind || 'note') !== 'note') continue
        if ((n.status || 'active') !== 'active') continue
        if (n.inject === true) continue
        if ((n.useCount || 0) > 0) continue
        if ((n.tags || []).indexOf('quick') >= 0) continue
        if ((n.mergedFrom || []).length > 0) continue
        if (suggestLinkTargetsOf(n.body).length > 0) continue
        if (linkTargets.has(n.id) || (n.title && linkTargets.has(n.title))) continue
        orphans.push({ id: n.id, title: n.title, topic: n.topic || '', updatedAt: n.updatedAt || '', createdAt: n.createdAt || '' })
      }
      orphans.sort((x, y) => String(x.updatedAt || '').localeCompare(String(y.updatedAt || '')))   // 最旧在前
      return { staleCandidates: staleCandidates, orphanCandidates: orphans.slice(0, SUGGEST_ORPHAN_LIMIT) }
    }
    // ---- 工作记忆 v0 日志卫生（logHygieneCandidates，§6.3 裁决 B②：只提名不执行，机械拼接口径）----
    // 两级聚合提名（dry-run 零写入，与 stale/orphan 同哲学——执行复用归档白名单通道，成员软删除可恢复、可撤销）：
    //   周聚合：logDate 距今 > weekDays（缺省 7 天）→ 按 工作区 × ISO 周 归组，同组 ≥2 条成候选（产物 工作周志 · <工作区> · <YYYY-Www>）
    //   月聚合：logDate 距今 > retentionDays（缺省 90 天；0=关闭本级）→ 按 工作区 × 月 归组（原始日志与周志混合归组），同组 ≥2 条成候选
    // 合并方式 = 机械拼接（不引入 LLM）：压条数不压信息量，dry-run 预览与实际产物逐字一致；v0 面板仅展示明细（聚合执行留待 Phase 2）。
    // logDate 缺失时回退 createdAt 前 10 位（YYYY-MM-DD 本地时区串）；无法解析的条目不提名（不依赖 title 反推，防标题被改后失键）。
    function suggestLogDateOf(n) {
      const s = String(n.logDate || '').slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
      const c = String(n.createdAt || '').slice(0, 10)
      return /^\d{4}-\d{2}-\d{2}$/.test(c) ? c : ''
    }
    function suggestLogAgeDays(dateStr, nowMs) {
      const t = Date.parse(dateStr + 'T00:00:00')
      if (!isFinite(t)) return -1
      return Math.floor(((nowMs || Date.now()) - t) / 86400000)
    }
    // ISO-8601 周键（YYYY-Www）：周四归属口径（一周属于该周周四所在年份；getUTCDay()||7 把周日 0 归为 7）
    function suggestISOWeek(dateStr) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
      if (!m) return ''
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
      d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
      const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
      return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0')
    }
    function suggestLogHygiene(all, weekDays, retentionDays, nowMs) {
      const logs = []
      for (const n of all) {
        if ((n.kind || 'note') !== 'log') continue
        if (n.deleted) continue
        const ld = suggestLogDateOf(n)
        if (!ld) continue
        const age = suggestLogAgeDays(ld, nowMs)
        if (age < 0) continue
        logs.push({ n: n, logDate: ld, age: age })
      }
      const memberOf = (x) => ({ id: x.n.id, title: x.n.title, logDate: x.logDate, sessionId: x.n.sessionId || '', updatedAt: x.n.updatedAt || '' })
      // 归组：keyFn 产 null/'' 的条目不成组；同组 ≥2 条才成候选（单条无需聚合）
      const mkGroups = (arr, keyFn) => {
        const by = new Map()
        for (const x of arr) { const k = keyFn(x); if (!k) continue; if (!by.has(k)) by.set(k, []); by.get(k).push(x) }
        const out = []
        for (const kv of by.entries()) { if (kv[1].length >= 2) out.push({ key: kv[0], members: kv[1].map(memberOf) }) }
        return out
      }
      const weekly = [], monthly = []
      if (weekDays > 0) {
        for (const g of mkGroups(logs.filter(x => x.age > weekDays), x => String(x.n.workspace || '') + '|' + suggestISOWeek(x.logDate))) {
          const cut = g.key.lastIndexOf('|')
          const ws = g.key.slice(0, cut), wk = g.key.slice(cut + 1)
          weekly.push({ key: g.key, title: '工作周志 · ' + (ws || '未分类') + ' · ' + wk, workspace: ws, week: wk, members: g.members })
        }
      }
      if (retentionDays > 0) {
        for (const g of mkGroups(logs.filter(x => x.age > retentionDays), x => String(x.n.workspace || '') + '|' + x.logDate.slice(0, 7))) {
          const cut = g.key.lastIndexOf('|')
          const ws = g.key.slice(0, cut), mo = g.key.slice(cut + 1)
          monthly.push({ key: g.key, title: '工作月志 · ' + (ws || '未分类') + ' · ' + mo, workspace: ws, month: mo, members: g.members })
        }
      }
      const byKey = (a, b) => String(a.key).localeCompare(String(b.key))
      weekly.sort(byKey); monthly.sort(byKey)
      return { weekly: weekly, monthly: monthly }
    }
    // ==== suggest-helpers END ====

    // 整理建议（notes-suggest，dry-run 零写入）：返回 { archiveCandidates, staleCandidates, orphanCandidates, logHygieneCandidates, generatedAt }
    // archiveCandidates 内聚复用 _archivePreview——速记组结构与 notes-archive-preview 完全同源，
    // client「去归档」直达归档预览对话框对接的正是同一批组（dry-run 非热路径，二次 _list 走缓存）。
    // logHygieneCandidates（工作记忆 v0 §6.3）：日志卫生两级聚合提名（周 >7 天 / 月 >90 天，设置键 logWeekAfterDays/logRetentionDays 可调），
    // 只提名不执行——v0 面板仅展示明细，合并执行（机械拼接 + 概览索引）走归档白名单通道留待 Phase 2。
    async function _suggest() {
      await loadSettings()   // 幂等（缓存 promise）：确保 staleDays 用户 override 已加载生效
      const all = await _list(undefined, undefined, undefined, undefined, true)   // 治理路径显式包含日志（隐身只作用于日常浏览/默认搜索；stale/orphan 内核已排除 kind=log）
      const pv = await _archivePreview()
      const c = suggestCandidates(all, staleDaysLimit())
      return { archiveCandidates: pv.quickGroups, staleCandidates: c.staleCandidates, orphanCandidates: c.orphanCandidates, logHygieneCandidates: suggestLogHygiene(all, logWeekAfterDaysLimit(), logRetentionDaysLimit()), generatedAt: new Date().toISOString() }
    }

    // 合并一组笔记为一条归档笔记：正文按 updatedAt 升序拼接（## 日期 分节），原笔记先 .bak 备份再软删除。
    // 返回 { noteId, memberIds }（undo 事务记录用）
    async function _mergeGroup(members, titleOverride) {
      members = members.slice().sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''))
      const now = new Date().toISOString()
      const bodyParts = members.map(n => {
        const d = (n.updatedAt || n.createdAt || '').slice(0, 10)
        return '## ' + d + '\n\n' + String(n.body || '').trim() + '\n'
      })
      const body = bodyParts.join('\n')
      const last = members[members.length - 1]
      const topic = last.topic || members[0].topic || '未分类'
      const title = titleOverride || last.topic || members[0].title || '归档'
      const r = await _create(title, body, members[0].tags || [], topic, {
        workspace: last.workspace || '',
        createdAt: members[0].createdAt || now,
        updatedAt: now,
        sessionId: last.sessionId || '',
        cwd: last.cwd || '',
        mergedFrom: members.map(n => n.id),
        // 使用遥测继承：归档笔记 useCount = 成员合计（合并不丢引用计数；撤销恢复成员原值）
        useCount: members.reduce((s, n) => s + Math.max(0, n.useCount || 0), 0),
        archivedAt: now,
        folder: last.folder || '',
        // 敏感继承：任一成员敏感则归档笔记敏感（合并正文含成员原文，泄露面不降级）
        sensitive: members.some(n => n.sensitive === true),
        // 曾注入继承（与 sensitive 同款 members.some）：任一成员曾注入/正注入 → 归档笔记 injectEver=true
        injectEver: members.some(n => n.injectEver === true || n.inject === true)
      })
      // 归档前先备份原笔记（.bak 后缀，_list 不会读到）
      for (const n of members) {
        try {
          const src = await fs.resolve(noteFile(n.id))
          const dst = await fs.resolve(noteFile(n.id) + '.bak')
          const c = await fs.readText(src)
          await fs.writeText(dst, c, undefined, undefined, getPolicy())
        } catch (e) {}
      }
      for (const n of members) { await _delete(n.id) }
      return { noteId: r.id, memberIds: members.map(n => n.id) }
    }

    // 归档（显式语义）：
    //   args.groups = [{ memberIds: [...], title? }] → 只合并白名单组；memberIds 必须全部存在且未删除、
    //     跨组/组内不重复（违反则整体报错不动手，避免半归档状态）；title 覆盖默认标题。
    //   无 groups 参数 → 向后兼容旧调用，但只自动合并速记组（行为变更：手动笔记不再自动分组）。
    // 返回兼容旧结构 { merged, mergedIds }，新增 groups: [{ noteId, memberIds }]（与 undo 事务同源）。
    // 有实际合并才覆盖 undo 文件（空归档保留上一次撤销能力）。
    async function _archive(args) {
      const a = args || {}
      const plan = []
      if (Array.isArray(a.groups)) {
        // 显式白名单组：先全量校验（存在/未删除/不重复），全部通过才动手
        const seen = {}
        for (const g of a.groups) {
          const ids = (g && Array.isArray(g.memberIds)) ? g.memberIds.map(String) : []
          if (ids.length < 2) throw new Error('notes-archive: 每组 memberIds 至少 2 条（实得 ' + ids.length + '）')
          const members = []
          for (const id of ids) {
            if (seen[id]) throw new Error('notes-archive: 笔记跨组/组内重复：' + id)
            seen[id] = true
            let n = null
            try { n = await loadNote(id) } catch (e) { n = null }
            if (!n || n.deleted) throw new Error('notes-archive: 成员不存在或已删除：' + id)
            members.push(n)
          }
          plan.push({ members: members, title: g.title ? String(g.title) : undefined })
        }
      } else {
        const all = await _list()
        for (const g of _quickGroups(all)) plan.push({ members: g.members })
      }
      let merged = 0
      const mergedIds = []
      const undoGroups = []
      for (const p of plan) {
        const r = await _mergeGroup(p.members, p.title)
        merged++
        mergedIds.push(r.noteId)
        undoGroups.push(r)
      }
      if (undoGroups.length) {
        try {
          const p = await fs.resolve(ARCHIVE_UNDO_PATH)
          await fs.writeText(p, JSON.stringify({ at: new Date().toISOString(), groups: undoGroups }, null, 2), undefined, undefined, getPolicy())
        } catch (e) { console.error('notes: archive undo file write failed', e) }
      }
      return { merged: merged, mergedIds: mergedIds, groups: undoGroups }
    }

    // 撤销最近一次归档：归档笔记软删除（deleted:true，可再经 restore 捞回）+ 成员批量 restore（deleted=false），
    // 成功后清空 undo 文件（写空组占位；不依赖 fs.delete）。无可撤销（无文件/损坏/已清空）→ { undone: 0 }。
    // 单条成员/归档笔记缺失时跳过该条，尽力撤销。
    async function _archiveUndo() {
      let tx = null
      try {
        const p = await fs.resolve(ARCHIVE_UNDO_PATH)
        tx = JSON.parse(await fs.readText(p))
      } catch (e) { return { undone: 0 } }
      const groups = (tx && Array.isArray(tx.groups)) ? tx.groups : []
      if (!groups.length) return { undone: 0 }
      let undone = 0, restored = 0
      for (const g of groups) {
        const memberIds = Array.isArray(g.memberIds) ? g.memberIds : []
        let ok = 0
        for (const id of memberIds) {
          try { await _restore(id); ok++ } catch (e) {}
        }
        if (g.noteId) { try { await _delete(g.noteId) } catch (e) {} }
        undone++
        restored += ok
      }
      try {
        const p = await fs.resolve(ARCHIVE_UNDO_PATH)
        await fs.writeText(p, JSON.stringify({ at: new Date().toISOString(), groups: [] }, null, 2), undefined, undefined, getPolicy())
      } catch (e) {}
      return { undone: undone, restored: restored }
    }

    // 派发目标会话列表（共享）：**未归档的主会话**（可继续对话，符合 DSH 交互逻辑），不只是当前 live。
    // sessionPersistence.list() 返回 SessionPersistenceSnapshot[]（{header, revision, ...}），id/origin/cwd/createdAt 都在 header 里；兼容旧版直接返回 SessionHeader
    function snapHeader(h) { return (h && h.header) ? h.header : h }
    // 后台批量读 title + header（origin/cwd/createdAt）：sessionQuery.readTitleSnapshots（live/persisted 都行，取代已删除的 inspect）。
    // 0.1.7 下该 API 对非 live 会话走全量日志解析（~10s/会话），故只在后台补缓存，绝不阻塞 RPC 返回。
    // 串行化：已有批量读在跑时本轮跳过（未命中会话保持 pending，client 轮询重拉时自然再触发）。
    async function _fillSessMeta(missIds) {
      if (!missIds || !missIds.length) return
      if (!sessionQuery || !sessionQuery.readTitleSnapshots) return
      if (sessMetaFillRunning) return
      sessMetaFillRunning = true
      try {
        const results = await sessionQuery.readTitleSnapshots(missIds)
        const ts = Date.now()
        for (const r of (results || [])) {
          if (r && r.status === 'fulfilled' && r.value) {
            const hd = r.value.session || {}
            sessMetaCache.set(r.sessionId, { title: (r.value.title && r.value.title.title) || '', cwd: hd.cwd || '', origin: hd.origin || '', createdAt: hd.createdAt, ts: ts })
          }
        }
      } catch (e) {} finally { sessMetaFillRunning = false }
    }
    // 与左侧会话列表一致：workspaceRegistry 各工作区 sessionIds 过滤子 agent + 已归档；名字 live 实时（sessionTitle.get 最新 fold），非 live 走元数据缓存。
    // 返回 { sessions, titlesPending?, pendingIds?, pendingSessions? }：
    //   sessions        —— 已 resolve 的条目（live 实时 + 缓存命中/兜底的非 live），立即可用
    //   titlesPending   —— 存在缓存未命中 / title 过期会话，已后台触发 _fillSessMeta（全命中时不带此字段）
    //   pendingIds      —— 后台读盘中的 sid 列表（未命中 + 过期刷新）
    //   pendingSessions —— 未命中会话的占位条目 [{id, short, workspace}]，client 渲染「短id · 标题加载中…」
    async function _activeSessions() {
      const empty = { sessions: [] }
      if (!workspaceRegistry || !workspaceRegistry.list) return empty
      // 已归档集合（workspaceRegistry.archivedSessionIds 是 registry 级归档集合）
      const archivedSet = {}
      try { const arch = workspaceRegistry.archivedSessionIds; if (Array.isArray(arch)) { for (const id of arch) archivedSet[id] = true } } catch (e) {}
      // 数据源：各工作区的 sessionIds（= 左侧会话列表显示的有效会话；已关闭/废弃的不在任何工作区里，自然排除）
      const entries = []
      const seen = {}
      const wl = workspaceRegistry.list() || []
      for (const w of wl) {
        const wsTitle = (w && w.title) || basename((w && w.path) || '')
        let sids = []
        try { sids = w.sessionIds || [] } catch (e) {}
        for (const sid of (sids || [])) {
          if (!sid || seen[sid]) continue
          seen[sid] = true
          if (archivedSet[sid]) continue  // 已归档跳过
          entries.push({ sid, wsTitle })
        }
      }
      if (entries.length === 0) return empty
      const nowTs = Date.now()
      const out = []
      const missIds = []        // 缓存未命中：必须读盘才知道 title/origin，先占位、后台补齐
      const refreshIds = []     // 缓存有但 title 过期：旧标题兜底展示，后台重读刷新
      const pendingSessions = []
      for (const e of entries) {
        const liveAgent = agents && agents.get ? agents.get(e.sid) : undefined
        const live = !!liveAgent
        if (live) {
          // live 会话始终实时：sessionTitle.get 走内存（最新 fold，含 fork 改名后的新名），近零成本
          let title = ''
          if (sessionTitle && sessionTitle.get && liveAgent.session) {
            try { const snap = sessionTitle.get(liveAgent.session); if (snap && snap.title) title = snap.title } catch (e2) {}
          }
          const hd = (liveAgent.session && liveAgent.session.header) || {}
          // 反哺缓存：live 转非 live 后标题即刻可用（origin 读不到就保留旧值，避免污染子 agent 过滤）
          const prev = sessMetaCache.get(e.sid) || {}
          sessMetaCache.set(e.sid, { title: title || prev.title || '', cwd: hd.cwd || prev.cwd || '', origin: hd.origin !== undefined ? hd.origin : prev.origin, createdAt: hd.createdAt || prev.createdAt, ts: nowTs })
          out.push({ id: e.sid, short: shortSid(e.sid), name: title || (e.wsTitle + ' · ' + shortSid(e.sid)), cwd: hd.cwd || prev.cwd || '', workspace: e.wsTitle, live: true, createdAt: hd.createdAt || prev.createdAt })
          continue
        }
        const c = sessMetaCache.get(e.sid)
        if (!c) {
          // 未命中：占位条目进 pendingSessions（client 显示「短id · 标题加载中…」），后台批量读盘补齐
          missIds.push(e.sid)
          pendingSessions.push({ id: e.sid, short: shortSid(e.sid), workspace: e.wsTitle })
          continue
        }
        if (c.origin === 'subagent') continue  // 排除一次性子 agent
        const fresh = (nowTs - (c.ts || 0)) < SESS_META_TTL
        if (!fresh) refreshIds.push(e.sid)     // title 过期：后台重读（空标题会话也可能后来补上了标题），本轮先用旧值兜底
        // 无标题且非 live 的会话视为已关闭/废弃（从没生成标题，也不在运行），不在派发/注入列表显示
        if (!c.title) continue
        out.push({ id: e.sid, short: shortSid(e.sid), name: c.title, cwd: c.cwd || '', workspace: e.wsTitle, live: false, createdAt: c.createdAt })
      }
      // 后台补齐/刷新：不阻塞首屏返回（0.1.7 下非 live 会话读盘 ~10s/个，同步等即复现 128s 空白）
      const bgIds = missIds.concat(refreshIds)
      if (bgIds.length) _fillSessMeta(bgIds)
      // 排序：live 在前，再按创建时间倒序
      out.sort((a, b) => { if (a.live !== b.live) return a.live ? -1 : 1; return String(b.createdAt || '').localeCompare(String(a.createdAt || '')) })
      if (bgIds.length === 0) return { sessions: out }
      return { sessions: out, titlesPending: true, pendingIds: bgIds, pendingSessions: pendingSessions }
    }

    // ==== img-path-hint BEGIN ====（注入/派发图片路径消歧；host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，check.js 提取比对，改动必须双边同步）
    // 背景：正文图片引用 ![](assets/xxx.png) 是相对笔记库根的相对路径；注入/派发以纯文本下发，agent 无法确定基准目录。
    // 策略：注入文本（conventionText/catalogText）与派发消息（_dispatch）尾部追加一行绝对路径提示，agent 可用文件工具直读；
    // 提示行整条文本只追加一次（不逐笔记重复），且仅当正文含 assets/ 图片引用时追加。
    // 检测与 inlineAssetsInBody / 渲染白名单同口径（![alt](assets/name)）；非全局正则 .test 无 lastIndex 残留坑。
    const BODY_IMG_REF_RE = /!\[[^\]]*\]\(assets\/[^\s)"']+\)/
    function bodyHasImageRef(body) { return BODY_IMG_REF_RE.test(String(body == null ? '' : body)) }
    // 提示行拼装：notesRoot 取运行时实际值（开发版 NOTES_DIR / 静态包 NOTES_ROOT，均已是绝对路径）；正斜杠形态双平台可读
    function assetsHintLine(notesRoot) { return '（图片位于笔记库目录 ' + String(notesRoot || '').replace(/[\\/]+$/, '') + '/assets/，可用文件工具直接读取）' }
    // ==== img-path-hint END ====

    // 任务派发（共享）：主动注入上下文 + 触发对话——agent.send 一条消息到目标会话，
    // source 标记为 { kind:'plugin', form:'recall' }（todo 作为"召回的上下文"，区别于用户指令/系统提示拼接），
    // wakeup=true 保证触发该会话 agent 去获取并处理这条上下文（可见反应，不污染系统提示）。
    // opts: { sessionId, sessionName, workspace, mode('existing'|'new'), instruction }
    async function _dispatch(id, opts) {
      const o = opts || {}
      const note = await _get(id)
      if (note.deleted) return { error: '笔记已删除' }
      if (!o.sessionId) return { error: '缺少目标会话' }
      const target = agents && agents.get ? agents.get(o.sessionId) : undefined
      if (!target || typeof target.send !== 'function') return { error: '目标会话当前未打开，无法触发工作。请先打开它，或改用「新建会话」。', needOpen: true }
      const instruction = String(o.instruction || '').trim()
      const text = '【笔记插件 · 派发的待办上下文】\n\n【待办】' + (note.title || 'Untitled') + '\n' + String(note.body || note.title || '').trim() + (instruction ? '\n\n【派发方补充的要求】\n' + instruction : '') + '\n\n—— 以上是笔记插件派发给你的待办上下文（recall）。请获取此上下文并开始处理。完成后请调用 note_manage（action: \'update\', id: \'' + note.id + '\', status: \'resolved\'）了结该笔记，系统会自动回执派发状态（dispatchStatus→done）。' + (bodyHasImageRef(note.body) ? '\n\n' + assetsHintLine(NOTES_ROOT) : '')
      const msg = {
        id: 'note-dispatch-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        role: 'user',
        content: [{ type: 'text', text: text }],
        // form:'recall'：标记为"召回的上下文"而非用户指令；agent loop 照常处理（wakeup 触发），模型据 form 理解为参考资料
        // v0.1.7 起会话日志为 format v4：kind:'plugin' 是已退役的 v3 包装写法，落盘会抛
        // SessionFormatError 并炸掉目标会话当前轮次；v3→v4 迁移映射为 plugin:dsh-notes，直接写迁移后形态
        source: { kind: 'plugin:dsh-notes', form: 'recall' }
      }
      target.send(msg, 'next-turn', true)
      // 派发历史：作为笔记属性记录（不改正文）；P3 起带 dispatchStatus（'sent'|'done'）状态机字段，done 布尔保留兼容旧 client
      const rec = {
        sessionId: o.sessionId,
        sessionName: o.sessionName || shortSid(o.sessionId),
        workspace: o.workspace || '',
        mode: o.mode || 'existing',
        instruction: instruction,
        at: new Date().toISOString(),
        done: false,
        dispatchStatus: 'sent'
      }
      note.dispatches = (note.dispatches || []).concat([rec])
      note.updatedAt = new Date().toISOString()
      await persistNote(note)
      return { ok: true, id: note.id, sessionId: o.sessionId, sessionName: rec.sessionName, dispatch: rec }
    }

    // 标记一条派发待办为完成（手动闭环通道；P3 起写 dispatchStatus='done' + doneAt + receipt='manual'，done 布尔同步保留）
    async function _dispatchDone(id, dispatchIndex) {
      const note = await _get(id)
      if (note.deleted) return { error: '笔记已删除' }
      const ds = note.dispatches || []
      const i = typeof dispatchIndex === 'number' ? dispatchIndex : -1
      if (i < 0 || i >= ds.length) return { error: '无效的派发记录索引' }
      ds[i] = Object.assign({}, ds[i], { done: true, dispatchStatus: 'done', doneAt: new Date().toISOString(), receipt: 'manual' })
      note.dispatches = ds
      note.updatedAt = new Date().toISOString()
      await persistNote(note)
      return { ok: true, id: note.id }
    }

    // ==== dispatch-loop BEGIN ====（P3 派发闭环；host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，check.js 提取比对，改动必须双边同步）
    // 调研结论（DSH 0.2.0-rc.2 实机核验 node_modules 源码）：Cordis Events 暴露 agent/* 生命周期事件——
    //   agent/status（idle⇄running，emit 模式，dsh-agent-loop setPhase 发出；插件 ctx.on 可订阅，
    //   先例：dsh-api-session-controller / dsh-goal-round-driver / dsh-agent invariant.js）。
    //   但 0.2.0 没有「任务语义完成」事件：idle 只代表目标会话驱动静止（可能是报错、追问或部分处理后的停顿），
    //   把 idle 当完成信号自动 resolved 笔记会误报——故本订阅只做「派发回执」（dispatchStatus→done），
    //   笔记 resolved 走保底联动（_update 置 status='resolved' 时 _closeOpenDispatches 全量回执，必然可行）。
    //   轮询方案（面板打开时读目标会话最新消息摘要判完成）评估后放弃：非 live 会话读盘 ~10s/个（0.1.7 教训），
    //   且「最新消息」无法判定语义完成，不可靠。
    // 已知局限：插件重载/宿主重启期间错过的 idle 无事件回执（由保底联动或手动「标记完成」兜底）。
    // 单条派发完成判定：dispatchStatus==='done' 或存量 done===true（0.2.0 前记录只有 done 字段，向后兼容）
    function isDispatchDone(d) { return !!(d && (d.dispatchStatus === 'done' || d.done === true)) }
    // 回执落库（作用于笔记对象内联）：把 note.dispatches 中未闭环条目标记 done（dispatchStatus/done/doneAt + receipt 来源）；
    // onlySessionId 限定只回执派发到该会话的条目（idle 事件回执用）；缺省全量（resolved 保底联动用）。返回新闭环条数
    function _closeOpenDispatches(note, receipt, onlySessionId) {
      const ds = note.dispatches || []
      let closed = 0
      const now = new Date().toISOString()
      for (let i = 0; i < ds.length; i++) {
        const d = ds[i]
        if (isDispatchDone(d)) continue
        if (onlySessionId && (!d || d.sessionId !== onlySessionId)) continue
        ds[i] = Object.assign({}, d, { done: true, dispatchStatus: 'done', doneAt: now, receipt: receipt || 'manual' })
        closed++
      }
      if (closed) note.dispatches = ds
      return closed
    }
    // agent/status idle 事件回执：目标会话处理完派发消息转入静止 → 全库扫描该会话的未闭环派发逐笔记落盘。
    // _list 走内存缓存（二次起零磁盘读）；idle 每轮次至多一次，开销可忽略。
    // { history:false }：回执是自动元数据回写（作用于 _list 返回的缓存原件，dispatches 原地变异），不算编辑，不产生历史快照
    async function _receiptDispatchesForSession(sid) {
      const all = await _list()
      for (const n of all) {
        if (!n || n.deleted || n.tombstoned) continue
        if (!(n.dispatches || []).length) continue
        if (_closeOpenDispatches(n, 'idle', sid) > 0) {
          n.updatedAt = new Date().toISOString()
          try { await persistNote(n, { history: false }) } catch (e) { console.error('notes: dispatch receipt persist failed', n.id, e) }
        }
      }
    }
    // 订阅 agent/status：只关心 idle 落定（running 无关）；ctx.on 不存在（老宿主/单测 mock）时静默跳过——保底联动不依赖本订阅
    if (typeof ctx.on === 'function') {
      try {
        const offDispatchStatus = ctx.on('agent/status', (payload) => {
          try {
            if (!payload || payload.status !== 'idle') return
            const agent = payload.agent
            const sid = agent && (agent.id || (agent.session && agent.session.id))
            if (!sid) return
            _receiptDispatchesForSession(sid).catch((e) => { console.error('notes: dispatch receipt failed', e) })
          } catch (e) {}
        })
        if (typeof offDispatchStatus === 'function') disposers.push(offDispatchStatus)
      } catch (e) {}
    }
    // ==== dispatch-loop END ====

    // ==== search-helpers BEGIN ====（搜索命中字段 + 组合过滤：host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，改动必须双边同步；check.js 提取本标记区间 eval 单测）
    // 命中字段（相关度档位数据源，notes-search 随 slim 结果返回 matches 数组）：标题命中 > 标签命中 > 正文命中；
    // topic 命中不计档（返回空数组——相关度排序时排最末；该笔记仍因 hay 含 topic 而被搜到，向后兼容旧行为）
    function searchMatchFields(n, q) {
      const fields = []
      if (!q) return fields
      if ((n.title || '').toLowerCase().indexOf(q) >= 0) fields.push('title')
      if ((n.tags || []).join(' ').toLowerCase().indexOf(q) >= 0) fields.push('tags')
      if ((n.body || '').toLowerCase().indexOf(q) >= 0) fields.push('body')
      return fields
    }
    // 组合过滤（供筛选面板/工具消费，三态布尔）：true=仅命中 / false=仅排除 / undefined=不过滤；kind 由 _search 既有参数承担
    function searchPassFilters(n, filters) {
      const f = filters || {}
      if (f.sensitive === true && n.sensitive !== true) return false
      if (f.sensitive === false && n.sensitive === true) return false
      if (f.inject === true && n.inject !== true) return false
      if (f.inject === false && n.inject === true) return false
      return true
    }
    // ==== search-helpers END ====

    async function _search(query, tag, topic, kind, folder, filters) {
      // 工作记忆 v0 默认隐身：默认搜索排除 kind=log；显式 kind=log 或 filters.includeLogs:true 召回
      const all = await _list(undefined, undefined, folder, undefined, !!(kind === 'log' || (filters && filters.includeLogs)))
      const q = query ? String(query).toLowerCase() : ''
      return all.filter(n => {
        if (tag && (n.tags || []).indexOf(tag) < 0) return false
        if (topic && n.topic !== topic) return false
        if (kind && n.kind !== kind) return false
        if (!searchPassFilters(n, filters)) return false
        if (q) {
          const hay = ((n.title || '') + ' ' + (n.body || '') + ' ' + (n.topic || '') + ' ' + (n.tags || []).join(' ')).toLowerCase()
          if (hay.indexOf(q) < 0) return false
        }
        return true
        // matches 挂在浅拷贝上（不污染 _list 缓存对象）；无 query 时不带 matches 字段（向后兼容）
      }).map(n => q ? Object.assign({}, n, { matches: searchMatchFields(n, q) }) : n)
    }

    // ---- 导入/导出：全库目录快照（目录即格式，零新依赖；settings.json 与 *.md.bak 不进出）----
    // 与 host-impl.js 同逻辑同步维护：仅路径拼接换为 path.join（ESM 静态包惯例）
    // 时间戳目录后缀：yyyyMMdd-HHmmss（本地时间），导出/备份目录共用
    function tsStamp(d) {
      const p = (n) => String(n).padStart(2, '0')
      return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
    }
    // 本地时区日期串（YYYY-MM-DD）：工作日志 logDate 归键与日志卫生两级聚合窗口的结构化依据（工作记忆 v0 §7.2）
    function localDateStr(d) {
      const x = d || new Date()
      const p = (n) => String(n).padStart(2, '0')
      return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate())
    }

    // 列出目录直子级笔记文件（n-*.md；目录缺失/不可读 → []，不抛错）
    // 只认 n-*.md 直子级：assets/ 子目录、settings.json、*.md.bak 都不会被当笔记枚举
    async function listNoteMd(dir) {
      try {
        const t = await fs.resolve(dir)
        const info = await fs.stat(t)
        if (!info) return []
        const entries = await fs.listDir(t)
        return (entries || []).map(e => e && e.name).filter(n => n && n.indexOf('n-') === 0 && /\.md$/i.test(n))
      } catch (e) { return [] }
    }

    // ---- 图片资产（assets/ 目录）：mime 白名单 + base64 文本落盘 ----
    // 磁盘格式说明：与 host-impl.js 同一格式——资产统一以 base64 文本形态落盘
    // （动态沙箱 fs 仅支持文本写，双包统一后导出/导入/备份/迁移全部纯文本复制即可）；
    // 下方 GET /dsh-notes/asset 路由读回后解码为二进制下发（Content-Type 按扩展名白名单）。
    // Markdown 正文以相对路径引用：![说明](assets/xxx.png)。
    const ASSET_MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' }
    // 扩展名 → mime（GET 路由 Content-Type 白名单；.jpg/.jpeg 双形态）
    const ASSET_EXT_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
    const ASSET_MAX_BYTES = 5 * 1024 * 1024    // 解码后上限 5MB
    const ASSET_MAX_B64_LEN = 7 * 1024 * 1024  // base64 文本上限（≈5.25MB 解码），超限免扫字符集直接拒

    // base64 解码后字节数；字符集非法/长度不齐 → -1（不落盘，先做大小校验）
    function assetDecodedSize(b64) {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) return -1
      const pad = b64.endsWith('==') ? 2 : (b64.endsWith('=') ? 1 : 0)
      return Math.floor(b64.length / 4) * 3 - pad
    }

    // 资产文件名安全化：basename 剥路径 + 危险字符折叠 + 扩展名以 mime 白名单为准（不信原扩展名）
    function safeAssetFileName(name, mime) {
      const ext = ASSET_MIME_EXT[mime]
      let stem = basename(String(name == null ? '' : name).trim()).replace(/\.[A-Za-z0-9]{1,8}$/, '')
      stem = stem.replace(/[^\w一-龥.-]+/g, '-').replace(/^[.-]+/, '').replace(/-{2,}/g, '-')
      if (stem.length > 60) stem = stem.slice(0, 60)
      if (!stem) stem = 'image'
      return stem + ext
    }

    // 重名追加序号（x.png → x-2.png → x-3.png）：tsStamp 秒级前缀下，重名主要来自同秒同名上传
    async function allocAssetName(fileName) {
      const dot = fileName.lastIndexOf('.')
      const stem = dot > 0 ? fileName.slice(0, dot) : fileName
      const ext = dot > 0 ? fileName.slice(dot) : ''
      let candidate = fileName, n = 1
      while (await fs.stat(await fs.resolve(path.join(NOTES_DIR, 'assets', candidate)))) { n++; candidate = stem + '-' + n + ext }
      return candidate
    }

    // 列出 <dir>/assets 直子级资产文件名（目录缺失/不可读 → []；子目录不递归不进出）
    async function listAssets(dir) {
      try {
        const t = await fs.resolve(path.join(dir, 'assets'))
        const info = await fs.stat(t)
        if (!info) return []
        const entries = await fs.listDir(t)
        return (entries || [])
          .filter(e => e && e.name && e.name.indexOf('\\') < 0 && e.name.indexOf('/') < 0 && (!e.type || e.type === 'file'))
          .map(e => e.name)
      } catch (e) { return [] }
    }

    // 复制 srcDir/assets 直子级文件到 dstDir/assets：导出/备份全量（skipExisting=false）与导入合并（true，同名跳过）共用
    // writeText 原子写会递归创建父目录，目标 assets/ 不存在时随首个文件写入自动建好
    async function copyAssetsDir(srcDir, dstDir, skipExisting) {
      let copied = 0
      for (const name of await listAssets(srcDir)) {
        try {
          if (skipExisting && await fs.stat(await fs.resolve(path.join(dstDir, 'assets', name)))) continue
          const c = await fs.readText(await fs.resolve(path.join(srcDir, 'assets', name)))
          await fs.writeText(await fs.resolve(path.join(dstDir, 'assets', name)), c, undefined, undefined, getPolicy())
          copied++
        } catch (e) { console.error('notes: asset copy failed', name, e) }
      }
      return copied
    }

    // ==== export-single BEGIN ====（本块 host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，check.js 提取比对 + eval 单测；改动必须双边同步）
    // P3 单文件导出（拼接/分享用）：scope 内笔记拼接为一篇自包含 Markdown——
    //   文档头（导出时间/范围/篇数/图片计数）+ 可选目录 + 每篇「# 标题 + front-matter 元信息块 + 正文」，篇间分隔线；
    //   正文图片 ![](assets/xxx) 内联为 data URL（base64），单文件零外部依赖可直接分享/归档。
    // 体积红线：单文件 > SINGLE_EXPORT_WARN_BYTES（20MB）时返回值带 warning 仍照常导出（导出是用户显式动作，不阻断）。
    const SINGLE_EXPORT_WARN_BYTES = 20 * 1024 * 1024
    const SINGLE_EXPORT_SEP = '\n\n---\n\n'   // 篇间分隔线（Markdown 水平线；文档头/目录与首篇之间同此线）
    // UTF-8 字节数（沙箱无 Buffer/TextEncoder）：BMP 1/2/3 字节 + 代理对 4 字节；孤立代理按 3 计（宽容不抛）
    function utf8Bytes(s) {
      const str = String(s == null ? '' : s)
      let n = 0
      for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i)
        if (c < 0x80) n += 1
        else if (c < 0x800) n += 2
        else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length && str.charCodeAt(i + 1) >= 0xdc00 && str.charCodeAt(i + 1) <= 0xdfff) { n += 4; i++ }
        else n += 3
      }
      return n
    }
    // 资产名 → mime（按扩展名反查 ASSET_MIME_EXT 白名单；不在白名单 → ''，调用方保留原引用不内联）
    function assetMimeFromName(name) {
      const m = String(name || '').toLowerCase().match(/\.[a-z0-9]+$/)
      const ext = m ? m[0] : ''
      for (const mime in ASSET_MIME_EXT) { if (ASSET_MIME_EXT[mime] === ext) return mime }
      return ''
    }
    // 正文图片内联：![alt](assets/name) → ![alt](data:<mime>;base64,<b64>)（assets 键值表查不到/墓碑空串/非白名单扩展名 → 保留原引用）
    // 返回 { body, inlined, missing }：inlined=内联张数，missing=未解析保留原样的引用数
    function inlineAssetsInBody(body, assets) {
      const src = String(body == null ? '' : body)
      if (!src) return { body: src, inlined: 0, missing: 0 }
      let inlined = 0, missing = 0
      const out = src.replace(/!\[([^\]]*)\]\(assets\/([^\s)"']+)\)/g, function (mm, alt, name) {
        const b64 = assets ? assets[name] : undefined
        const mime = assetMimeFromName(name)
        if (!b64 || !mime) { missing++; return mm }
        inlined++
        return '![' + alt + '](data:' + mime + ';base64,' + String(b64).replace(/\s+/g, '') + ')'
      })
      return { body: out, inlined: inlined, missing: missing }
    }
    // scope 描述文案（文档头/返回值 scopeLabel 共用）：tag > folder > 缺省全部；folder 带解析后的名称
    function singleExportScopeLabel(scope, folderName) {
      const s = scope || {}
      if (s.tag) return '标签「' + s.tag + '」'
      if (s.folder) return '文件夹「' + (folderName || s.folder) + '」'
      return '全部笔记'
    }
    // 单文档拼接：head（导出时间/范围/篇数/图片计数）+ 可选目录（toc 缺省开）+ 每篇「# 标题 + front-matter + 正文」，篇间 SINGLE_EXPORT_SEP。
    // renderFM 依赖注入（= buildFM）：本块保持零外部函数依赖（ASSET_MIME_EXT 除外，eval 单测时由注入参数提供），
    // check.js 提取本块 eval 直接单测拼接结构/图片内联/scope 文案（与 sensitive-helpers 块同款姿势）。
    function buildSingleExport(notes, opts, renderFM) {
      const o = opts || {}
      const head = '# dsh-notes 单文件导出\n\n' +
        '> - 导出时间：' + (o.exportedAt || '') + '\n' +
        '> - 范围：' + (o.scopeLabel || '全部笔记') + '\n' +
        '> - 篇数：' + notes.length + '\n' +
        '> - 图片：base64 内联 ' + (o.inlined || 0) + ' 张' + ((o.missing || 0) > 0 ? '，' + o.missing + ' 张未解析保留原引用' : '') + '\n'
      const tocBlock = o.toc === false
        ? ''
        : '\n## 目录\n\n' + notes.map(function (n, i) { return (i + 1) + '. ' + String(n.title || 'Untitled').replace(/[\r\n]+/g, ' ') + '（' + n.id + '）' }).join('\n') + '\n'
      if (!notes.length) return head + tocBlock
      const parts = notes.map(function (n) {
        return '# ' + String(n.title || 'Untitled').replace(/[\r\n]+/g, ' ') + '\n\n' + renderFM(n) + String(n.body || '')
      })
      return head + tocBlock + SINGLE_EXPORT_SEP + parts.join(SINGLE_EXPORT_SEP) + '\n'
    }
    // ==== export-single END ====

    // notes-asset-upload：{noteId?, name, data(base64 或 dataURL), mime} → assets/<yyyyMMdd-HHmmss>-<安全名> 落盘
    // noteId 仅预留登记（通用资产，不要求笔记已存在）；mime 白名单 + 解码后 ≤5MB 双重校验
    async function _assetUpload(args) {
      const mime = args && typeof args.mime === 'string' ? args.mime.trim().toLowerCase() : ''
      if (!ASSET_MIME_EXT[mime]) return { error: 'notes-asset-upload: 不支持的 mime：' + (mime || '(空)') + '（仅 image/png、image/jpeg、image/gif、image/webp）' }
      let b64 = args && args.data
      if (typeof b64 !== 'string' || !b64) return { error: 'notes-asset-upload: 需要 data（base64）' }
      b64 = b64.replace(/^data:[^,]*;base64,/i, '').replace(/\s+/g, '')
      if (b64.length > ASSET_MAX_B64_LEN) return { error: 'notes-asset-upload: 图片超过 5MB 上限' }
      const bytes = assetDecodedSize(b64)
      if (bytes < 0) return { error: 'notes-asset-upload: data 不是合法 base64' }
      if (bytes === 0) return { error: 'notes-asset-upload: 空图片' }
      if (bytes > ASSET_MAX_BYTES) return { error: 'notes-asset-upload: 图片超过 5MB 上限（解码后 ' + bytes + ' 字节）' }
      const fileName = await allocAssetName(tsStamp(new Date()) + '-' + safeAssetFileName(args.name, mime))
      await fs.writeText(await fs.resolve(path.join(NOTES_DIR, 'assets', fileName)), b64, undefined, undefined, getPolicy())
      return { file: 'assets/' + fileName, name: fileName, mime: mime, bytes: bytes }
    }

    // ---- 二期：孤儿资产清理（notes-assets-prune）----
    // （与开发版 host-impl.js 双边同步；唯一差异：本静态包有 node:fs 真删除通道）
    // 孤儿 = assets/ 直子级文件，未被任何笔记正文（含软删除笔记——恢复后引用仍成立，故一并计入）以 'assets/<name>' 形式引用。
    // dryRun（缺省 true）零写入预览；执行（dryRun:false，可选 files 白名单）逐项复核实时孤儿后删除。
    // 删除语义：ctx.fs（FileSystem 服务契约）只有读/写/编辑、没有删除——优先走 node:fs 真删除
    // （fs.processPath 把 FsTarget 还原为进程路径；不可用时落回「墓碑式清空」writeText ''，与开发版一致）。
    async function deleteAssetFile(name) {
      try {
        if (typeof fs.processPath === 'function') {
          const target = await fs.resolve(path.join(NOTES_DIR, 'assets', name))
          const pp = target && fs.processPath(target)
          if (pp) { await fsNode.promises.unlink(pp); return 'deleted' }
        }
      } catch (e) { /* 真删不可用/失败 → 落回墓碑式清空 */ }
      await fs.writeText(await fs.resolve(path.join(NOTES_DIR, 'assets', name)), '', undefined, undefined, getPolicy())
      return 'tombstoned'
    }
    async function _assetsPrune(args) {
      const dryRun = !args || args.dryRun !== false
      // 1) 收集全部笔记正文中的 assets/<name> 引用集合（图片 ![](assets/x) 与任何 (assets/x) 形态都算引用，宁留勿删）
      const referenced = {}
      let scannedNotes = 0
      for (const mdName of await listNoteMd(NOTES_DIR)) {
        let content = null
        try { content = await fs.readText(await fs.resolve(path.join(NOTES_DIR, mdName))) } catch (e) { continue }
        scannedNotes++
        const body = parseFM(content).body || ''
        const re = /assets\/([^\s)"']+)/g
        let m
        while ((m = re.exec(body))) referenced[m[1]] = true
      }
      // 2) 扫 assets/ 直子级：空文件=墓碑（历史清理残留）计数跳过；被引用计数；其余为孤儿
      const orphans = []
      let tombstoned = 0
      let referencedCount = 0
      for (const name of await listAssets(NOTES_DIR)) {
        let content = null
        try { content = await fs.readText(await fs.resolve(path.join(NOTES_DIR, 'assets', name))) } catch (e) { continue }
        if (!content) { tombstoned++; continue }
        if (referenced[name]) { referencedCount++; continue }
        const bytes = assetDecodedSize(content)
        orphans.push({ name: name, bytes: bytes > 0 ? bytes : 0 })
      }
      const totalBytes = orphans.reduce((s, o) => s + o.bytes, 0)
      if (dryRun) return { dryRun: true, orphans: orphans, totalBytes: totalBytes, referenced: referencedCount, tombstoned: tombstoned, notes: scannedNotes }
      // 3) 执行：args.files 白名单（缺省=全部孤儿）；orphans 是本调用内重扫的实时结果，天然防预览→执行间隙漂移
      const wanted = args && Array.isArray(args.files) && args.files.length ? {} : null
      if (wanted) for (const f of args.files) wanted[String(f)] = true
      const deleted = []
      let freedBytes = 0, skipped = 0
      const modes = { deleted: 0, tombstoned: 0 }
      for (const o of orphans) {
        if (wanted && !wanted[o.name]) { skipped++; continue }
        try {
          const mode = await deleteAssetFile(o.name)
          modes[mode]++
          deleted.push(o.name); freedBytes += o.bytes
        } catch (e) { skipped++ }
      }
      return { dryRun: false, deleted: deleted, freedBytes: freedBytes, skipped: skipped, remaining: orphans.length - deleted.length, modes: modes }
    }

    // 读指定目录的 folders.json（导入预览/合并共用）：缺失/损坏/结构非法 → []（与 loadFolders 同一容错口径，parent 字段同款保留）
    async function readFoldersFile(dir) {
      try {
        const ft = await fs.resolve(path.join(dir, 'folders.json'))
        const arr = JSON.parse(await fs.readText(ft))
        if (!Array.isArray(arr)) return []
        return arr.filter(f => f && f.id).map(f => { const o = { id: String(f.id), name: String(f.name || ''), order: typeof f.order === 'number' ? f.order : 0 }; if (f.parent) o.parent = String(f.parent); return o })
      } catch (e) { return [] }
    }

    // 复制 NOTES_DIR 全部 n-*.md + folders.json + assets/ 到目标目录（导出与导入前全量备份共用）；
    // writeText 原子写会递归创建父目录，目标目录不存在时随首个文件写入自动建好；
    // 无 assets/ 的旧库：listAssets 返回 []，assets=0，零回归。
    // opts.includeHistory：连带 .history 快照历史（导出默认不含——历史是本地安全网不随导出物流转；导入前全量备份恒带）
    async function copyNotesDir(targetDir, opts) {
      let copied = 0
      for (const name of await listNoteMd(NOTES_DIR)) {
        try {
          const c = await fs.readText(await fs.resolve(path.join(NOTES_DIR, name)))
          await fs.writeText(await fs.resolve(path.join(targetDir, name)), c, undefined, undefined, getPolicy())
          copied++
        } catch (e) { console.error('notes: copy failed', name, e) }
      }
      let foldersFile = false
      try {
        const c = await fs.readText(await fs.resolve(FOLDERS_PATH))
        await fs.writeText(await fs.resolve(path.join(targetDir, 'folders.json')), c, undefined, undefined, getPolicy())
        foldersFile = true
      } catch (e) { /* folders.json 缺失/不可读 → 跳过（foldersFile=false） */ }
      const assets = await copyAssetsDir(NOTES_DIR, targetDir, false)
      const history = opts && opts.includeHistory ? await copyHistoryDir(NOTES_DIR, targetDir, false) : 0
      return { copied, foldersFile, assets, history }
    }

    // 扫描导入目录（只读不写）：n-*.md 逐条解析 front-matter 取 id（缺 id 按文件名兜底）+ folders.json；
    // 同 id 多文件取先扫描到的一份（目录快照正常一 id 一文件）；读失败的文件计入 unreadable
    async function scanImportDir(dir) {
      const notes = []
      const seen = {}
      let unreadable = 0
      for (const name of await listNoteMd(dir)) {
        let content = null
        try { content = await fs.readText(await fs.resolve(path.join(dir, name))) } catch (e) { unreadable++; continue }
        if (!content) continue   // purge 墓碑（0 字节占位）不导入（防止彻底删除的笔记经导出→导入复活）
        const p = parseFM(content)
        const id = p.meta.id || name.replace(/\.md$/i, '')
        if (seen[id]) continue
        seen[id] = true
        notes.push({ id: id, title: p.meta.title || 'Untitled', deleted: p.meta.deleted === 'true', content: content })
      }
      return { notes: notes, folders: await readFoldersFile(dir), unreadable: unreadable }
    }

    // 读库内笔记原始文件内容（same/diff 比对用，raw 文本与导出快照逐字节同口径）；不存在/不可读 → null
    async function readLibraryRaw(id) {
      try { return await fs.readText(await fs.resolve(noteFile(id))) } catch (e) { return null }
    }

    // 校验导入目录（预览/执行共用）：dir 归一化去尾部斜杠；不存在/不是目录 → error
    async function checkImportDir(dir) {
      const d = String(dir || '').trim().replace(/[\\/]+$/, '')
      if (!d) return { error: '需要 dir（导入目录）' }
      const info = await fs.stat(await fs.resolve(d))
      if (!info) return { error: '目录不存在：' + d }
      if (!(info.dir || info.type === 'directory')) return { error: '不是目录：' + d }
      return { dir: d }
    }

    // notes-export：NOTES_DIR 全库快照 → <dir>/dsh-notes-export-<ts>/（不打包不压缩，目录即格式；dir 不存在则随写入自建）
    // 快照含 n-*.md + folders.json + assets/（图片资产连带；无 assets 的旧库 assets=0）；
    // .history 快照历史默认不含（本地安全网不随导出物流转），includeHistory=true 时连带（返回 history 文件计数）
    async function _export(dir, includeHistory) {
      const d = String(dir || '').trim().replace(/[\\/]+$/, '')
      if (!d) return { error: 'notes-export 需要 dir（目标目录）' }
      const info = await fs.stat(await fs.resolve(d))
      if (info && !(info.dir || info.type === 'directory')) return { error: '目标路径不是目录：' + d }
      const target = path.join(d, 'dsh-notes-export-' + tsStamp(new Date()))
      const r = await copyNotesDir(target, { includeHistory: includeHistory === true })
      const out = { exported: r.copied, foldersFile: r.foldersFile, assets: r.assets, target: target }
      if (includeHistory === true) out.history = r.history
      return out
    }

    // notes-export-single（P3 单文件导出，拼接/分享用）：scope 内笔记拼接为一篇自包含 Markdown
    // → <dir>/dsh-notes-export-single-<ts>.md。args={dir, scope:{all?|folder?|tag?}, format:'md', toc?}：
    //   scope.tag 按标签 / scope.folder 按文件夹（id 或名称，resolveFolderRef 兼容；**递归子树口径**——含全部子孙文件夹内笔记，与 _list 过滤同通道）/ 缺省全部；过滤与 _list 同口径（排除软删除，pinned 优先 + updatedAt 降序）。
    //   正文图片 ![](assets/xxx) 读盘内联为 data URL（资产本就是 base64 文本形态，读回即嵌）；缺失/墓碑/非白名单扩展名保留原引用并计入 missingAssets。
    //   单文件 > SINGLE_EXPORT_WARN_BYTES（20MB）返回 warning 仍照常导出（指引：图片内联体积可能大，告警不阻断）。
    async function _exportSingle(args) {
      const a = args || {}
      if (a.format !== undefined && a.format !== 'md') return { error: 'notes-export-single 仅支持 format: \'md\'' }
      const d = String(a.dir || '').trim().replace(/[\\/]+$/, '')
      if (!d) return { error: 'notes-export-single 需要 dir（目标目录）' }
      const info = await fs.stat(await fs.resolve(d))
      if (info && !(info.dir || info.type === 'directory')) return { error: '目标路径不是目录：' + d }
      const scope = a.scope || {}
      let notes = []
      let folderName = ''
      if (scope.tag) {
        notes = await _list(String(scope.tag))
      } else if (scope.folder) {
        const rf = await resolveFolderRef(scope.folder)
        if (!rf) return { error: 'notes-export-single 文件夹不存在：' + scope.folder }
        folderName = rf.name
        notes = await _list(undefined, undefined, rf.id)
      } else {
        notes = await _list()
      }
      // 逐篇收集正文引用的 assets/<name> 并读盘（读失败/0 字节墓碑 → 不进键值表，inlineAssetsInBody 保留原引用）
      const wanted = {}
      for (const n of notes) {
        const re = /!\[[^\]]*\]\(assets\/([^\s)"']+)\)/g
        let m
        while ((m = re.exec(String(n.body || '')))) wanted[m[1]] = true
      }
      const assets = {}
      for (const name of Object.keys(wanted)) {
        try {
          const c = await fs.readText(await fs.resolve(path.join(NOTES_DIR, 'assets', name)))
          if (c) assets[name] = c
        } catch (e) { /* 缺失资产保留原引用 */ }
      }
      let inlined = 0, missing = 0
      const entries = notes.map(n => {
        const r = inlineAssetsInBody(n.body, assets)
        inlined += r.inlined; missing += r.missing
        return Object.assign({}, n, { body: r.body })
      })
      const scopeLabel = singleExportScopeLabel(scope, folderName)
      const doc = buildSingleExport(entries, { toc: a.toc !== false, exportedAt: new Date().toISOString(), scopeLabel: scopeLabel, inlined: inlined, missing: missing }, buildFM)
      const target = path.join(d, 'dsh-notes-export-single-' + tsStamp(new Date()) + '.md')
      await fs.writeText(await fs.resolve(target), doc, undefined, undefined, getPolicy())
      const bytes = utf8Bytes(doc)
      const out = { exported: entries.length, target: target, bytes: bytes, images: inlined, missingAssets: missing, scope: scopeLabel }
      if (bytes > SINGLE_EXPORT_WARN_BYTES) out.warning = '单文件体积约 ' + Math.round(bytes / 1048576) + 'MB，超过 20MB（图片 base64 内联膨胀），已照常导出；部分编辑器打开超大文件较慢'
      return out
    }

    // notes-import-preview：与现有库比对分类 same（内容相同）/diff（同 id 内容不同）/added（库中不存在）；不写任何东西
    // detail 逐条标注 deleted（软删除笔记按原文件导入后仍隐藏）；folders 统计导入清单总数与新增数
    async function _importPreview(dir) {
      const chk = await checkImportDir(dir)
      if (chk.error) return { error: 'notes-import-preview ' + chk.error }
      const scan = await scanImportDir(chk.dir)
      const detail = []
      let same = 0, diff = 0, added = 0
      for (const n of scan.notes) {
        const cur = await readLibraryRaw(n.id)
        const status = cur === null ? 'added' : (cur === n.content ? 'same' : 'diff')
        if (status === 'same') same++; else if (status === 'diff') diff++; else added++
        detail.push({ id: n.id, title: n.title, status: status, deleted: n.deleted })
      }
      const known = {}
      for (const f of await loadFolders()) known[f.id] = true
      return {
        total: scan.notes.length, same: same, diff: diff, added: added, detail: detail,
        folders: { total: scan.folders.length, new: scan.folders.filter(f => !known[f.id]).length },
        unreadable: scan.unreadable
      }
    }

    // notes-import：执行导入（只增改不删）
    // 1) 任何改动前先把 NOTES_DIR 全量备份到 notes/notes-backup-<ts>/（含软删除笔记的全部 n-*.md + folders.json + assets/）
    // 2) added 原文件原样入库（deleted 导入后仍隐藏）；same 跳过；diff 默认跳过，overwrite=true 才覆盖
    // 3) folders.json 合并只增不删：清单外的文件夹 id 追加尾部（order 续排），已存在的不动
    // 4) assets/ 合并只增不改：同名文件跳过（文件名含秒级时间戳，同名即同物）；无 assets 的旧导出 assetsMerged=0
    // 5) .history 历史合并：仅 added（库内不存在）新笔记连带合并源 .history/<id>（同名快照跳过）；id 冲突（库内已有该笔记，
    //    same/diff/overwrite 任一）跳过历史合并——两库同 id 历史不混杂（文档见 README/DEVELOPMENT）
    async function _import(dir, overwrite) {
      const chk = await checkImportDir(dir)
      if (chk.error) return { error: 'notes-import ' + chk.error }
      const backupDir = path.join(NOTES_DIR, 'notes-backup-' + tsStamp(new Date()))
      await copyNotesDir(backupDir, { includeHistory: true })
      const scan = await scanImportDir(chk.dir)
      let imported = 0, skippedSame = 0, skippedDiff = 0, overwritten = 0, historyMerged = 0
      for (const n of scan.notes) {
        const cur = await readLibraryRaw(n.id)
        if (cur === n.content) { skippedSame++; continue }
        if (cur !== null && !overwrite) { skippedDiff++; continue }
        try {
          await fs.writeText(await fs.resolve(noteFile(n.id)), n.content, undefined, undefined, getPolicy())
          // 同步内存缓存（约定/目录注入直接读 cache）：按导入内容重建解析结果
          const note = noteFromParsed(n.id, parseFM(n.content))
          cache.set(note.id, note)
          if (cur === null) {
            imported++
            // 历史连带：仅 added 新笔记合并源 .history/<id>（同名快照跳过，只增不改）
            historyMerged += await copyHistoryDir(chk.dir, NOTES_DIR, true, n.id)
          } else overwritten++
        } catch (e) { console.error('notes: import failed', n.id, e) }
      }
      // folders.json 合并：清单外的文件夹 id 追加到尾部（order 续排），已存在的不动；嵌套 parent 字段随条目保留（悬空 parent 由 folderDepth 防御兜底）
      let foldersMerged = 0
      if (scan.folders.length) {
        const curFolders = await loadFolders()
        const known = {}
        for (const f of curFolders) known[f.id] = true
        let maxOrder = curFolders.reduce((m, f) => Math.max(m, f.order), -1)
        for (const f of scan.folders.slice().sort((x, y) => x.order - y.order)) {
          if (known[f.id]) continue
          maxOrder++
          const nf = { id: f.id, name: f.name, order: maxOrder }
          if (f.parent) nf.parent = String(f.parent)
          curFolders.push(nf)
          foldersMerged++
        }
        if (foldersMerged) await saveFolders(curFolders)
      }
      // assets/ 合并：同名跳过，只增不改（备份已在上面 copyNotesDir 里含库内 assets）
      const assetsMerged = await copyAssetsDir(chk.dir, NOTES_DIR, true)
      // 合并了外部历史 → 存活清单/预算记账失效，下次快照惰性重扫（histEnsureScanned）
      if (historyMerged > 0) histSizes = null
      return { imported: imported, skippedSame: skippedSame, skippedDiff: skippedDiff, overwritten: overwritten, foldersMerged: foldersMerged, assetsMerged: assetsMerged, historyMerged: historyMerged, backupDir: backupDir, unreadable: scan.unreadable }
    }

    // 约定命中判定（约定注入 conventionText 与目录去重 catalogText 共用）：
    // 注入范围 injectTo 是多选数组（不再有「工作区」维度——笔记无归属，只看会话）：
    //   []（空）                  → 默认所有会话
    //   含 'global' / 'workspace' → 存量值容错：同样视为所有会话（不迁移、不保留工作区过滤）
    //   含会话短 id               → 仅注入这些会话（可多选多个会话）
    // ws 形参保留（调用点不变）但不再用于过滤。
    // curSid 两种形态：字符串 = 单会话命中口径；字符串数组 = 多会话并集（注入预览「工作区」视角专用：
    // 工作区 = 其全部会话的注入并集，injectTo 与集合有交集即命中；空数组 = 只命中 injectTo=[] 的全局笔记）。
    function conventionHit(n, ws, curSid) {
      const targets = n.injectTo || []
      if (targets.length === 0) return true
      const sidSet = Array.isArray(curSid) ? curSid : null
      for (const t of targets) {
        if (t === 'global' || t === 'workspace') return true
        if (sidSet ? sidSet.indexOf(t) >= 0 : t === curSid) return true
      }
      return false
    }

    // 上下文注入（双角色）：从常驻内存 cache 同步读取 inject=true 笔记，按 injectRole 分桶注入 agent 系统提示。
    // text 是同步函数（systemPrompt 契约），故不能 await _list()，必须读 cache。
    // 是否注入：inject 布尔字段（noteFromParsed 已对旧数据回退到 convention 标签）；
    // 注入范围由笔记的 injectTo 字段决定（命中语义见 conventionHit）。
    // 分桶：injectRole='convention' → 用户约定（须遵守）；'reference' → 参考资料（按需取用）；
    // 缺省/非法值已在 noteFromParsed 回退 convention（存量零迁移）；只命中单桶时只输出该桶标题。
    // 文案不再标注工作区归属与来源会话：大量笔记由 agent 快速记录产生，归属标注对注入方无意义。
    // sidOverride（注入预览 RPC 专用）：不传 = 真实注入路径（取当前会话，行为不变）；传 '' = 「全局」视角（只命中 injectTo=[] 的笔记）；
    // 传会话短 id = 按该会话 injectTo 命中过滤；传会话短 id 数组 = 工作区并集视角（workspace 参数，命中集合内任一会话即视为命中）。
    // 拼装逻辑不变，仅 curSid 输入来源不同（纯复用）。
    function conventionText(sidOverride) {
      const shortSid = (x) => x ? String(x).replace(/^session-/, '').slice(0, 8) : ''
      lastConvStats.masked = 0; lastConvStats.budgetTruncated = false
      try {
        let cwd = ''
        let sid = ''
        const a = agents && agents.currentInitiator ? agents.currentInitiator() : undefined
        if (a) {
          cwd = (a.session && a.session.header && a.session.header.cwd) || ''
          sid = a.sessionId || (a.session && a.session.id) || ''
        }
        const ws = basename(cwd)
        const curSid = sidOverride !== undefined ? sidOverride : shortSid(sid)
        const matches = []
        for (const n of cache.values()) {
          if (n.deleted) continue
          if (n.inject !== true) continue
          if (conventionHit(n, ws, curSid)) matches.push(n)
        }
        if (matches.length === 0) { if (sidOverride === undefined) lastInjectChars = 0; return '' }
        matches.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        // 双角色分桶：约定与资料各自成段，标题换行收拢，正文行统一缩进两格保持在列表项内
        const conventions = []
        const references = []
        for (const n of matches) (n.injectRole === 'reference' ? references : conventions).push(n)
        // 敏感脱敏：sensitive=true 的笔记正文按行打码（键保留值遮蔽，见 sensitive-helpers 块），计数用于尾部提示行
        let maskedCount = 0
        const block = (n) => {
          const bodyTrim = String(n.body || '').trim()
          const bodyOut = n.sensitive === true ? (maskedCount++, maskSensitiveBody(bodyTrim, n.id)) : bodyTrim
          return '- [' + n.id + '] ' + String(n.title || 'Untitled').replace(/[\r\n]+/g, ' ') + '\n  ' + bodyOut.replace(/\n/g, '\n  ')
        }
        const head = '以下是注入的上下文笔记（与当前任务无关时忽略）：'
        const convPart = conventions.length ? '\n\n用户约定（须遵守）：\n\n' + conventions.map(block).join('\n\n') : ''
        // 资料块整列预渲染（block 有 maskedCount 计数副作用，每条只渲染一次；被预算省略时整块丢弃）
        const refBlocks = references.map(block)
        const refHead = '\n\n参考资料（与当前任务相关时按需取用）：\n\n'
        // P1 注入体积预算（约，按字符数近似）：约定桶永不截断；资料桶从最旧（updatedAt 降序的尾部）开始整条省略，
        // 直至总长度回到预算内或资料桶为空；省略计数在尾部提示行告知（note_search 可检索原文）
        const budget = injectBudgetChars()
        let droppedRefs = 0
        if (budget > 0) {
          while (refBlocks.length > 0 && (head + convPart + refHead + refBlocks.join('\n\n')).length > budget) {
            refBlocks.pop()
            droppedRefs++
          }
        }
        let full = head + convPart
        if (refBlocks.length) full += refHead + refBlocks.join('\n\n')
        if (full.length > 4000) full = full.slice(0, 4000) + '\n\n（内容过长已截断）'
        // 尾部提示行恒定可见（截断之后追加）：预算省略计数 + 脱敏计数（原文 note_get 按 id 获取 / note_search 检索）
        if (droppedRefs > 0) full += '\n\n…另有 ' + droppedRefs + ' 条资料超出预算未注入（note_search 可检索）'
        if (maskedCount > 0) full += '\n\n（其中 ' + maskedCount + ' 条含敏感信息已脱敏，原文用 note_get 按 id 获取）'
        // 图片路径消歧（img-path-hint 块）：实际注入的正文含 assets/ 图片引用时，尾部追加一次绝对路径提示（截断之后追加，恒定可见；预算省略的资料不算）
        if (conventions.concat(references.slice(0, refBlocks.length)).some(function (n) { return bodyHasImageRef(n.body) })) full += '\n\n' + assetsHintLine(NOTES_ROOT)
        // 预览统计：脱敏条数 + 预算截断标记（资料桶有省略即视为截断）；预览渲染不触碰 lastInjectChars
        lastConvStats.masked = maskedCount; lastConvStats.budgetTruncated = droppedRefs > 0
        if (sidOverride === undefined) lastInjectChars = full.length   // 注入体积缓存：真实注入渲染才更新（设置卡片仪表数据源）
        return full
      } catch (e) { return '' }
    }

    // ---- 笔记目录索引注入（recall 通道，order 131）----
    // 全库一行一条目录 + 轻推提示：让 agent 规划时知道库里有什么，相关条目自主 note_get 拉全文、note_search 检索更多。
    // 准入：排除 deleted、status=resolved/superseded（已了结不进目录）、recall=false（front-matter 逐条关闭，缺省 true）；
    // 与约定注入去重：inject=true 且本会话命中（order 130 已注入全文）的笔记不再出现。
    // 排序：pinned 优先 → updatedAt 降序（注入无工作区维度，不按工作区重排）；CATALOG_LIMIT 条封顶。
    // text 是同步函数（systemPrompt 契约）：读常驻 cache + settingsCache；总开关关闭/无条目/异常 → 返回 ''（不能返回 undefined）。
    const CATALOG_LIMIT = 40
    const CATALOG_KIND_LABELS = { note: '笔记', decision: '决策', todo: '待办', link: '链接', quote: '引用', log: '日志' }
    // sidOverride：注入预览 RPC 专用（语义同 conventionText——含数组形态的工作区并集视角）；不传 = 真实注入路径（当前会话），行为不变
    function catalogText(sidOverride) {
      lastCatStats.masked = 0; lastCatStats.stale = 0
      try {
        if (settingsCache && settingsCache.catalogEnabled === false) return ''   // 面板总开关（settings.json，缺省开）
        let cwd = ''
        let sid = ''
        const a = agents && agents.currentInitiator ? agents.currentInitiator() : undefined
        if (a) {
          cwd = (a.session && a.session.header && a.session.header.cwd) || ''
          sid = a.sessionId || (a.session && a.session.id) || ''
        }
        const ws = basename(cwd)
        const curSid = sidOverride !== undefined ? sidOverride : shortSid(sid)
        const pool = []
        // 工作记忆 v0：日志计数提示行数据源（目录条目因 recall 缺省 false 不含日志；有日志时尾部恒出现一行占位提示，不刷屏）
        let logCount = 0
        for (const n of cache.values()) {
          if (n.deleted) continue
          if ((n.kind || 'note') === 'log') { logCount++; continue }
          if (n.status === 'resolved' || n.status === 'superseded') continue   // 已了结的笔记不进目录
          if (n.recall === false) continue                                     // recall=false 逐条关闭
          if (n.inject === true && conventionHit(n, ws, curSid)) continue      // 约定注入去重（全文已在 order 130）
          pool.push(n)
        }
        if (pool.length === 0 && logCount === 0) return ''
        pool.sort((x, y) => {
          const px = x.status === 'pinned' ? 1 : 0
          const py = y.status === 'pinned' ? 1 : 0
          if (px !== py) return py - px                                        // pinned 优先
          return (y.updatedAt || '').localeCompare(x.updatedAt || '')          // 更新时间降序
        })
        const shown = pool.slice(0, CATALOG_LIMIT)
        // 敏感脱敏：目录只出标题一行，sensitive=true 的条目标题同样按行打码（防标题泄值）并加 🔒 标记；计数用于尾部提示行
        let maskedCount = 0
        // P1 时效衰减提醒：kind=note/link（参考资料类）且 updatedAt 距今超过 staleDays（缺省 90 天，0=关闭）的行尾追加 ⚠ 标注
        const staleLimit = staleDaysLimit()
        let staleCount = 0   // 预览统计：被 ⚠ 时效标注的条目数
        const lines = shown.map(n => {
          const kl = CATALOG_KIND_LABELS[n.kind] || CATALOG_KIND_LABELS.note
          let title = String(n.title || 'Untitled').replace(/[\r\n]+/g, ' ')   // 一行一条：标题换行收拢
          let mark = ''
          if (n.sensitive === true) { maskedCount++; title = maskSensitiveLine(title, n.id); mark = '🔒 ' }
          let line = '- [' + n.id + '] ' + mark + title + ' (' + kl + ', ' + (n.topic || '未分类') + ')'
          const sd = staleDaysOf(n.updatedAt, (n.kind === 'note' || n.kind === 'link') ? staleLimit : 0)
          if (sd > 0) { staleCount++; line += ' ⚠ ' + sd + ' 天未更新' }
          return line
        })
        if (pool.length > CATALOG_LIMIT) lines.push('…另有 ' + (pool.length - CATALOG_LIMIT) + ' 条较早笔记，用 note_search 检索')
        if (maskedCount > 0) lines.push('（其中 ' + maskedCount + ' 条含敏感信息已脱敏，原文用 note_get 按 id 获取）')
        // 工作记忆 v0（裁决 B①）：目录尾部固定日志计数提示行——只出计数不出标题（天然无泄露面），引导 agent 显式检索日志
        if (logCount > 0) lines.push('另有 ' + logCount + ' 条工作日志（kind=log，默认隐身不进目录），用 note_search 传 kind=log 检索')
        lastCatStats.masked = maskedCount; lastCatStats.stale = staleCount   // 预览统计（notes-inject-preview）
        let out = '本地笔记库目录（与本任务相关时用 note_get 拉全文，更多用 note_search）：\n' +
          lines.join('\n') +
          '\n规划任务前，若目录中有相关笔记（尤其待办/决策），建议先 note_get 读取再动手'
        // 图片路径消歧（img-path-hint 块）：目录条目正文含 assets/ 图片引用时尾部追加一次绝对路径提示（note_get 拉全文后可直读图片）
        if (shown.some(function (n) { return bodyHasImageRef(n.body) })) out += '\n' + assetsHintLine(NOTES_ROOT)
        return out
      } catch (e) { return '' }
    }

    // ---- 性能遥测：RPC 计数/耗时 + 缓存命中 + client 推送快照，节流写盘供诊断 ----
    const perfStats = { started: new Date().toISOString(), rpc: {}, rpcMs: {}, classify: 0, classifyMs: 0, cacheReads: 0, diskReads: 0, diskWrites: 0, client: null }
    const PERF_PATH = path.join(NOTES_ROOT, 'perf-report.json')
    let lastPerfWrite = 0
    function writePerfReport() {
      const t = Date.now()
      if (t - lastPerfWrite < 10000) return
      lastPerfWrite = t
      ;(async () => {
        try {
          const ft = await fs.resolve(PERF_PATH)
          await fs.writeText(ft, JSON.stringify({ writtenAt: new Date().toISOString(), host: perfStats }, null, 2), undefined, undefined, getPolicy())
        } catch (e) {}
      })()
    }

    // ---- client ↔ host RPC ----
    // 主通道：全局 Builtin `harness.handle`（原 host-impl.js 的 helper 姿势原样保留，只是补了 handler 表）。
    // 兜底通道：harness 缺失时同一批 handler 由 ctx.webServer.register 的 exact 路由承载。
    const handlers = {}
    function handle(name, fn) {
      const wrapped = async (args) => {
        const t0 = Date.now()
        try { return await fn(args) }
        finally { perfStats.rpc[name] = (perfStats.rpc[name] || 0) + 1; perfStats.rpcMs[name] = (perfStats.rpcMs[name] || 0) + (Date.now() - t0); writePerfReport() }
      }
      handlers[name] = wrapped   // handler 表始终维护：webServer 兜底路由据此分发
      if (harnessRef && typeof harnessRef.handle === 'function') return harnessRef.handle(name, wrapped)
      return () => { delete handlers[name] }
    }
    disposers.push(handle('notes-perf', async (args) => { if (args && args.perf) perfStats.client = args.perf; return { ok: true } }))
    // P1 回收站：args.includeDeleted=true 时含软删除笔记（缺省排除）；tag/kind/folder 过滤口径不变
    // 工作记忆 v0：args.includeLogs=true 时含 kind=log 日志（缺省排除——默认隐身；筛选中心 kind=日志 专入口由 client 传此参数）
    disposers.push(handle('notes-list', async (args) => ({ notes: (await _list(args && args.tag, args && args.kind, args && args.folder, !!(args && args.includeDeleted), !!(args && args.includeLogs))).map(slim) })))
    // 虚拟文件夹清单/管理：无参=列表（含子树口径计数 + parent/depth 嵌套字段），args={op:'create'(name,parent?)|'rename'|'delete'(id,cascade?——缺省拒绝有子内容)|'reorder'(ids,parents? 拖父级改挂), ...}
    disposers.push(handle('notes-folders', async (args) => {
      try { return await _folders(args) } catch (e) { return { error: String(e.message || e) } }
    }))
    // 样式文件按需下发：避免 client 内嵌超长 CSS 字符串（包内 styles.css 优先，开发版目录回退）
    disposers.push(handle('notes-css', async () => {
      try {
        for (const p of CSS_CANDIDATES) {
          try { if (fsNode.existsSync(p)) return { css: fsNode.readFileSync(p, 'utf8') } } catch (e) {}
        }
        throw new Error('styles.css not found in: ' + CSS_CANDIDATES.join(' | '))
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // client 实现源码下发：开发版 bootstrap 壳通过它加载 client-impl.js（同理避免 define 传大字符串）。
    // 发布版候选：开发版目录的 client-impl.js / host-impl.js，包内的 lib/client.js / index.mjs。
    disposers.push(handle('notes-src', async (args) => {
      try {
        const which = args && args.which === 'client' ? 'client' : 'host'
        const candidates = which === 'client'
          ? [path.join(LEGACY_PLUGIN_DIR, 'src', 'client-impl.js'), path.join(PKG_DIR, 'lib', 'client.js')]
          : [path.join(LEGACY_PLUGIN_DIR, 'src', 'host-impl.js'), path.join(PKG_DIR, 'index.mjs')]
        for (const p of candidates) {
          try { if (fsNode.existsSync(p)) return { src: fsNode.readFileSync(p, 'utf8') } } catch (e) {}
        }
        throw new Error(which + ' source not found in: ' + candidates.join(' | '))
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // args.includeDeleted（回收站行预览 notes-trash-batch-preview）：已软删笔记正文只读可达（缺省拒绝，编辑器链路口径不变）；墓碑仍拒绝
    disposers.push(handle('notes-get', async (args) => {
      try { const n = args && args.includeDeleted ? await _getDeleted(args.id) : await _get(args.id); const s = slim(n); s.body = n.body; return { note: s } } catch (e) { return { error: String(e.message || e) } }
    }))
    // 工作记忆 v0：kind=log 日志经同一 _create（隐身硬闸在内部生效）；logDate/entities/summarizedAt 检索字段透传（§7.2 往返预留）
    disposers.push(handle('notes-create', async (args) => {
      try { return await _create(args.title, args.body, args.tags, args.topic, { kind: args.kind, status: args.status, inject: args.inject, injectRole: args.injectRole, injectTo: args.injectTo, folder: args.folder, recall: args.recall, sensitive: args.sensitive, logDate: args.logDate, entities: args.entities, summarizedAt: args.summarizedAt }) } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-update', async (args) => {
      try { return await _update(args.id, args.title, args.body, args.tags, args.topic, args.kind, args.status, args.inject, args.injectTo, args.folder, args.recall, args.injectRole, args.sensitive, { logDate: args.logDate, entities: args.entities, summarizedAt: args.summarizedAt }) } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-quick', async (args) => {
      try { return await _quickCapture(args.text, args.sessionId, args.cwd, args.kind) } catch (e) { return { error: String(e.message || e) } }
    }))
    // T3 指令式快速记录：备注非空时 LLM 提取 tags/titleHint/kind/inject，选区原文原样为 body，备注不进笔记
    disposers.push(handle('notes-quick-instruct', async (args) => {
      try { return await _quickInstruct(args.text, args.note, args.sessionId, args.cwd) } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-delete', async (args) => {
      try { return await _delete(args.id) } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-restore', async (args) => {
      try { return await _restore(args.id) } catch (e) { return { error: String(e.message || e) } }
    }))
    // P1 回收站：彻底删除（仅限已软删除笔记；.md 与 .bak 一并移除，不可恢复；processPath 可用时 node:fs 真删，否则墓碑式清空）
    disposers.push(handle('notes-purge', async (args) => {
      if (!args || !args.id) return { error: 'notes-purge 需要 id' }
      try { return await _purge(args.id) } catch (e) { return { error: String(e.message || e) } }
    }))
    // 历史版本面板（notes-history-ui）：版本列表（倒序轻量零正文）/ 单版正文预览 / 一键恢复（恢复前当前版自动快照——恢复本身可撤销）
    disposers.push(handle('notes-history', async (args) => {
      try { return await _historyList(args && args.id) } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-history-get', async (args) => {
      try { return await _historyGet(args && args.id, args && args.ts) } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-restore-history', async (args) => {
      try { return await _historyRestore(args && args.id, args && args.ts) } catch (e) { return { error: String(e.message || e) } }
    }))
    // 归档（显式语义）：args.groups = 白名单组 [{memberIds, title?}]；无参 = 只合速记组（行为变更：手动笔记不再自动分组）
    disposers.push(handle('notes-archive', async (args) => {
      try { return await _archive(args) } catch (e) { return { error: String(e.message || e) } }
    }))
    // 归档预览（dry-run 零写入）：只列速记自动分组；手动笔记须由调用方显式构造 groups 走 notes-archive
    disposers.push(handle('notes-archive-preview', async () => {
      try { return await _archivePreview() } catch (e) { return { error: String(e.message || e) } }
    }))
    // 撤销最近一次归档（undo 事务文件 .archive-undo.json）：归档笔记软删 + 成员批量恢复，成功后清空；无可撤销 → { undone: 0 }
    disposers.push(handle('notes-archive-undo', async () => {
      try { return await _archiveUndo() } catch (e) { return { error: String(e.message || e) } }
    }))
    // 整理建议（dry-run 零写入）：四类候选（速记组/过期未引用/孤儿/日志卫生）——只提名不执行；过期未引用的批量软删由 client confirm 后逐条 notes-delete
    disposers.push(handle('notes-suggest', async () => {
      try { return await _suggest() } catch (e) { return { error: String(e.message || e) } }
    }))
    // ==== 工作记忆 v0：沉淀引导启用流程（裁决 A——复用约定体系，无独立注入管线；design/agent-memory-v0.md §5.1）====
    // 启用 = 创建一条预填约定笔记（inject=true + 用户选的作用域 injectTo），用户可在面板查看/编辑/停用/删除——单一注入源。
    // 发现键 = tag memory-guide（零 schema 变更）；启用状态不落 settings.json：状态 = 存在 tag=memory-guide 且 inject=true 的未删除笔记（单一事实源，杜绝双源漂移）。
    // 停用 = 关闭该约定笔记 inject（既有操作，op:'disable' 是便捷封装）；修改/删除走面板既有通道。
    const MEMORY_GUIDE_TAG = 'memory-guide'
    const MEMORY_GUIDE_FOLDER = '工作日志'
    const MEMORY_GUIDE_TITLE = '约定：工作日志沉淀（工作记忆 v0）'
    // 引导模板全文（§5.2）：时机/写法/隐身口径/检索入口 + 【分工边界】必需段落（与反馈类约定从文案上杜绝双记——日志只收工作结论，反馈仍走反馈约定）
    const MEMORY_GUIDE_BODY = '【工作约定】会话工作沉淀（工作记忆 v0）\n\n在以下时机把本会话的工作结论沉淀为工作日志（note_manage，kind=log）：\n- 一个任务或阶段完成时（尤其看板任务验收/上线后）；\n- 用户显式说「记一下 / 沉淀一下 / 写工作日志」时；\n- 会话明显收尾（用户道别、长时间无新指令前的最后回合）。\n\n写法：\n1. 先 note_manage list（kind=log）查本会话今天是否已有日志：\n   有 → update 追加一节「## HH:mm 续」；无 → create（模板骨架见 KIND_TEMPLATES.log）。\n2. folder 传「工作日志」。日志默认隐身：不进系统提示、不进目录索引、\n   不出现在默认列表与默认搜索——无需也不能开 inject；recall 保持默认。\n3. 返回 sensitiveSuggested=true 时必须补 sensitive: true。\n4. 「相关笔记」一节用 [[n-xxxxxxxx]] 双链引用本库笔记。\n5. 查历史工作日志：note_search 传 kind=log（默认搜索不含日志）。\n\n【分工边界】本约定只管「会话工作结论沉淀」（做了什么/改了什么/遗留什么）。\n产品使用问题与体验反馈**不写入工作日志**——若同时注入了「看板反馈」\n「笔记反馈」类约定，那些内容按那些约定记到对应文件夹。两者正交、\n互不替代、互不合并。\n'
    // 语义重叠检查关键词（§5.1：命中关键词的 inject=true 约定列为重叠候选，用户确认后才继续创建）
    const MEMORY_GUIDE_OVERLAP_RE = /记录|日志|总结|沉淀|复盘|feedback|反馈/i
    async function _memoryGuide(args) {
      const a = args || {}
      const op = a.op || 'status'
      const all = await _list(undefined, undefined, undefined, undefined, true)   // 引导笔记是 kind=note 不受隐身影响；显式含日志保持口径统一
      const guides = all.filter(n => (n.tags || []).indexOf(MEMORY_GUIDE_TAG) >= 0)
      const active = guides.find(n => n.inject === true) || null
      if (op === 'status') return { enabled: !!active, noteId: active ? active.id : (guides[0] ? guides[0].id : ''), guideIds: guides.map(n => n.id) }
      if (op === 'check') {
        // dry-run 零写入：全库扫描 inject=true 的约定笔记（排除引导笔记自身），命中关键词者列为「语义重叠候选」
        const overlaps = []
        for (const n of all) {
          if (n.inject !== true) continue
          if ((n.tags || []).indexOf(MEMORY_GUIDE_TAG) >= 0) continue
          const hay = String(n.title || '') + '\n' + String(n.body || '')
          if (MEMORY_GUIDE_OVERLAP_RE.test(hay)) overlaps.push({ id: n.id, title: n.title, topic: n.topic || '', preview: String(n.body || '').replace(/\s+/g, ' ').slice(0, 120) })
        }
        return { overlaps: overlaps, enabled: !!active, noteId: active ? active.id : '' }
      }
      if (op === 'enable') {
        const scope = Array.isArray(a.scope) ? a.scope.map(String) : []
        if (active) return { ok: true, id: active.id, already: true }   // 幂等：已启用直接返回现状（重复启用不建第二条）
        // 重叠检查先行：有候选且未确认 → 返回待确认（零写入，client 列出候选请用户确认后带 confirmed:true 重发）
        const chk = await _memoryGuide({ op: 'check' })
        if (chk.overlaps.length && a.confirmed !== true) return { needConfirm: true, overlaps: chk.overlaps }
        // 同时确保虚拟文件夹「工作日志」存在（同名复用不重复建；日志默认落入）
        const folders = await loadFolders()
        let logFolder = null
        for (const f of folders) { if (f.name === MEMORY_GUIDE_FOLDER) { logFolder = f; break } }
        if (!logFolder) {
          const maxOrder = folders.reduce((m, f) => Math.max(m, f.order), -1)
          logFolder = { id: genFolderId(), name: MEMORY_GUIDE_FOLDER, order: maxOrder + 1 }
          folders.push(logFolder)
          await saveFolders(folders)
        }
        const r = await _create(MEMORY_GUIDE_TITLE, MEMORY_GUIDE_BODY, [MEMORY_GUIDE_TAG], '约定', { kind: 'note', inject: true, injectRole: 'convention', injectTo: scope })
        return { ok: true, id: r.id, folderId: logFolder.id, overlaps: chk.overlaps.length }
      }
      if (op === 'disable') {
        if (!active) return { ok: true, disabled: false }   // 本就未启用（无 inject=true 的引导笔记）
        await _update(active.id, undefined, undefined, undefined, undefined, undefined, undefined, false)
        return { ok: true, disabled: true, id: active.id }
      }
      return { error: 'notes-memory-guide: 未知 op：' + String(op) + '（期望 check/enable/status/disable）' }
    }
    disposers.push(handle('notes-memory-guide', async (args) => {
      try { return await _memoryGuide(args) } catch (e) { return { error: String(e.message || e) } }
    }))
    // notes-search 扩展（向后兼容）：新增 sensitive/inject 组合过滤参数（true=仅命中 / false=仅排除 / 缺省=不过滤，供筛选面板消费）；
    // 带 query 时每条 slim 结果附 matches 命中字段数组（title/tags/body，供前端高亮与「相关度」排序；旧调用方不读该字段不受影响）
    // 工作记忆 v0：args.includeLogs=true 或 kind='log' 时搜索含日志（缺省排除——默认隐身口径与 _list 一致）
    disposers.push(handle('notes-search', async (args) => {
      try {
        const a = args || {}
        const found = await _search(a.query, a.tag, a.topic, a.kind, a.folder, { sensitive: a.sensitive, inject: a.inject, includeLogs: !!a.includeLogs })
        return { notes: found.map(n => { const s = slim(n); if (n.matches) s.matches = n.matches; return s }) }
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // 上下文注入（双角色分桶）：注册动态 prompt context（order 130，位于 policy/delegation 之后）
    // 笔记目录索引注入（recall 通道）：order 131 紧邻上下文注入之后；text 同步返回 string，无内容/总开关关闭返回 ''
    if (systemPrompt && typeof systemPrompt.context === 'function') {
      disposers.push(systemPrompt.context({ name: 'notes:workspace-conventions', order: 130, text: () => conventionText() }))
      disposers.push(systemPrompt.context({ name: 'notes:catalog', order: 131, text: () => catalogText() }))
    }
    // 调试 RPC：预览当前会话将注入的上下文笔记文本（双角色分桶新文案，E2E 验证用）
    disposers.push(handle('notes-conventions', async () => ({ text: conventionText() || '' })))
    // 注入预览（设置卡片「注入预览」modal 数据源）：纯复用 conventionText/catalogText 渲染产物 + 统计，不重写拼装。
    // 三档视角：args.sessionId（会话 id/短 id）= 单会话 injectTo 命中口径（conventionHit 同一口径）；
    // args.workspace（工作区标题，notes-sessions 的 workspace 字段）= 该工作区全部会话的注入并集（会话短 id 集合与 injectTo 求交）；
    // 两者缺省 = 「全局」视角（sidOverride=''，只命中 injectTo=[] / 存量 global/workspace 的笔记）。
    // sessionId 与 workspace 互斥、同传时 sessionId 优先；workspace 经 _activeSessions 解析（与 UI 下拉同一数据源 notes-sessions，pending 占位会话同计入——标题未补齐不影响命中）。
    // 预览渲染不更新 lastInjectChars（仪表只反映真实注入）；统计取自同步渲染的 lastConvStats/lastCatStats（无竞态）。
    disposers.push(handle('notes-inject-preview', async (args) => {
      try {
        const sid = args && args.sessionId ? shortSid(String(args.sessionId)) : ''
        const wsName = !sid && args && args.workspace ? String(args.workspace) : ''
        let scope = sid
        if (wsName) {
          const wsSet = []
          const sessRes = await _activeSessions()
          const wsAll = (sessRes.sessions || []).concat(sessRes.pendingSessions || [])
          for (const s of wsAll) { if (s && s.workspace === wsName && s.short && wsSet.indexOf(s.short) < 0) wsSet.push(s.short) }
          scope = wsSet   // 空集合 = 该工作区暂无有效会话：并集退化为只命中 injectTo=[]（全局共享笔记）
        }
        const conventions = conventionText(scope) || ''
        const catalog = catalogText(scope) || ''
        return {
          conventions: conventions,
          catalog: catalog,
          stats: {
            conventionsChars: conventions.length,
            catalogChars: catalog.length,
            totalChars: conventions.length + catalog.length,
            maskedNotes: lastConvStats.masked + lastCatStats.masked,
            staleMarked: lastCatStats.stale,
            budgetTruncated: lastConvStats.budgetTruncated
          }
        }
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // 会话列表（注入范围多选用）：与派发同源——工作区有效会话（排除已归档 + 子 agent），复用 _activeSessions
    // 返回 { sessions, titlesPending?, pendingIds?, pendingSessions? }：缓存未命中的会话后台补标题（0.1.7 首屏不阻塞）
    disposers.push(handle('notes-sessions', async () => {
      try { return await _activeSessions() } catch (e) { return { sessions: [] } }
    }))
    // 活跃主会话列表（任务派发目标用）：同 notes-sessions——live 实时 + 非 live 走元数据缓存（TTL 10min）
    disposers.push(handle('notes-active-sessions', async () => {
      try { return await _activeSessions() } catch (e) { return { sessions: [] } }
    }))
    // 工作区列表（派发对话框的"新建会话"下拉用）
    disposers.push(handle('notes-workspaces', async () => {
      try {
        if (!workspaceRegistry || !workspaceRegistry.list) return { workspaces: [] }
        const list = workspaceRegistry.list() || []
        return { workspaces: list.map(w => ({ id: w.id, title: w.title || basename(w.path || ''), cwd: w.path || '' })) }
      } catch (e) { return { workspaces: [] } }
    }))
    // 任务派发（client 面板用）：复用共享 _dispatch（系统提示注入形式，登记到 dispatches）
    disposers.push(handle('notes-dispatch', async (args) => {
      try { return await _dispatch(args.id, { sessionId: args.sessionId, sessionName: args.sessionName, workspace: args.workspace, mode: args.mode, instruction: args.instruction }) } catch (e) { return { error: String(e.message || e) } }
    }))
    // 标记派发待办完成（停止注入目标会话系统提示）
    disposers.push(handle('notes-dispatch-done', async (args) => {
      try { return await _dispatchDone(args.id, args.dispatchIndex) } catch (e) { return { error: String(e.message || e) } }
    }))
    // 设置读取（设置卡片数据源）：settings 内存缓存（确保已加载）+ 可用模型列表（探不到为空数组，client 退化手输）
    // + lastInjectChars（最近一次注入体积，约/字符数——设置卡片仪表数据源，conventionText 每次渲染更新）
    disposers.push(handle('notes-settings-get', async () => {
      try { await loadSettings(); return { settings: settingsCache, models: await listAvailableModels(), lastInjectChars: lastInjectChars } }
      catch (e) { return { settings: settingsCache || {}, models: [], lastInjectChars: lastInjectChars, error: String(e.message || e) } }
    }))
    // 设置保存（client 选择即保存）：浅合并顶层键；llm 为 null 恢复跟随会话；catalogEnabled 为 null 恢复默认开
    disposers.push(handle('notes-settings-set', async (args) => {
      try {
        await loadSettings()
        const patch = (args && typeof args === 'object') ? args : {}
        if ('llm' in patch) {
          if (patch.llm === null || patch.llm === undefined) delete settingsCache.llm
          else {
            const l = patch.llm
            const provider = l && typeof l.provider === 'string' ? l.provider.trim() : ''
            const model = l && typeof l.model === 'string' ? l.model.trim() : ''
            if (!provider || !model) return { error: 'notes-settings-set: llm 需要 provider + model（或 null 恢复跟随会话）' }
            settingsCache.llm = { provider: provider, model: model }
          }
        }
        // 目录索引注入总开关：布尔直存；null/undefined 删除 override（缺省 = 开）
        if ('catalogEnabled' in patch) {
          if (patch.catalogEnabled === null || patch.catalogEnabled === undefined) delete settingsCache.catalogEnabled
          else if (typeof patch.catalogEnabled === 'boolean') settingsCache.catalogEnabled = patch.catalogEnabled
          else return { error: 'notes-settings-set: catalogEnabled 需要布尔值（或 null 恢复默认开）' }
        }
        // P1 时效衰减提醒阈值（天）：非负数值取整直存；null/undefined 删除 override（缺省 90）；0 = 关闭标注
        if ('staleDays' in patch) {
          if (patch.staleDays === null || patch.staleDays === undefined) delete settingsCache.staleDays
          else if (typeof patch.staleDays === 'number' && isFinite(patch.staleDays) && patch.staleDays >= 0) settingsCache.staleDays = Math.floor(patch.staleDays)
          else return { error: 'notes-settings-set: staleDays 需要非负数值（或 null 恢复缺省 90 天）' }
        }
        // P1 注入体积预算（约，字符数）：非负数值取整直存；null/undefined 删除 override（缺省 0 = 不限）
        if ('injectBudgetChars' in patch) {
          if (patch.injectBudgetChars === null || patch.injectBudgetChars === undefined) delete settingsCache.injectBudgetChars
          else if (typeof patch.injectBudgetChars === 'number' && isFinite(patch.injectBudgetChars) && patch.injectBudgetChars >= 0) settingsCache.injectBudgetChars = Math.floor(patch.injectBudgetChars)
          else return { error: 'notes-settings-set: injectBudgetChars 需要非负数值（或 null 恢复不限）' }
        }
        // LLM 月度用量预算提醒阈值（tokens/月，notes-token-stats）：非负数值取整直存；null/undefined 删除 override（缺省 0 = 关闭提醒）；
        // 超预算仅 client toast 提醒，不阻断任何调用
        if ('usageBudgetMonthly' in patch) {
          if (patch.usageBudgetMonthly === null || patch.usageBudgetMonthly === undefined) delete settingsCache.usageBudgetMonthly
          else if (typeof patch.usageBudgetMonthly === 'number' && isFinite(patch.usageBudgetMonthly) && patch.usageBudgetMonthly >= 0) settingsCache.usageBudgetMonthly = Math.floor(patch.usageBudgetMonthly)
          else return { error: 'notes-settings-set: usageBudgetMonthly 需要非负数值（或 null 恢复关闭提醒）' }
        }
        // 工作记忆 v0 日志卫生窗口（天）：logWeekAfterDays 周聚合窗口（缺省 7）/ logRetentionDays 月聚合窗口（缺省 90，0 = 关闭月聚合本级）；
        // 非负数值取整直存；null/undefined 删除 override 恢复缺省（settings-set 校验同款模式）
        if ('logWeekAfterDays' in patch) {
          if (patch.logWeekAfterDays === null || patch.logWeekAfterDays === undefined) delete settingsCache.logWeekAfterDays
          else if (typeof patch.logWeekAfterDays === 'number' && isFinite(patch.logWeekAfterDays) && patch.logWeekAfterDays >= 0) settingsCache.logWeekAfterDays = Math.floor(patch.logWeekAfterDays)
          else return { error: 'notes-settings-set: logWeekAfterDays 需要非负数值（或 null 恢复缺省 7 天）' }
        }
        if ('logRetentionDays' in patch) {
          if (patch.logRetentionDays === null || patch.logRetentionDays === undefined) delete settingsCache.logRetentionDays
          else if (typeof patch.logRetentionDays === 'number' && isFinite(patch.logRetentionDays) && patch.logRetentionDays >= 0) settingsCache.logRetentionDays = Math.floor(patch.logRetentionDays)
          else return { error: 'notes-settings-set: logRetentionDays 需要非负数值（或 null 恢复缺省 90 天；0 = 关闭月聚合）' }
        }
        // 文件夹嵌套深度上限（层，根级=1）：非负数值取整直存；null/undefined 删除 override（缺省 3）；0 = 不限层数
        if ('maxFolderDepth' in patch) {
          if (patch.maxFolderDepth === null || patch.maxFolderDepth === undefined) delete settingsCache.maxFolderDepth
          else if (typeof patch.maxFolderDepth === 'number' && isFinite(patch.maxFolderDepth) && patch.maxFolderDepth >= 0) settingsCache.maxFolderDepth = Math.floor(patch.maxFolderDepth)
          else return { error: 'notes-settings-set: maxFolderDepth 需要非负数值（或 null 恢复缺省 3；0 = 不限层数）' }
        }
        await saveSettings()
        return { ok: true, settings: settingsCache }
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // LLM 用量统计（notes-token-stats，llm-usage 块数据源）：{ today, week, month, allTime, byFeature, estimatedTokens, exactTokens, calls }
    // month = 当月累计（月度预算提醒口径）；estimatedTokens>0 表示含字符估算部分（UI 文案「约」）
    disposers.push(handle('notes-usage-get', async () => {
      try { await loadUsage(); return usageReport() } catch (e) { return { error: String(e.message || e) } }
    }))
    // 全库导出（目录快照）：args={dir, includeHistory?} → <dir>/dsh-notes-export-<ts>/，返回 { exported, foldersFile, assets, target, history? }；
    // .history 快照历史默认不含，includeHistory=true 连带
    disposers.push(handle('notes-export', async (args) => {
      try { return await _export(args && args.dir, !!(args && args.includeHistory)) } catch (e) { return { error: String(e.message || e) } }
    }))
    // P3 单文件导出（拼接/分享）：args={dir, scope:{all?|folder?|tag?}, format:'md', toc?} → <dir>/dsh-notes-export-single-<ts>.md
    // （每篇 # 标题 + front-matter + 正文 + 篇间分隔线，可选目录；图片 base64 内联，>20MB 告警仍导出）
    disposers.push(handle('notes-export-single', async (args) => {
      try { return await _exportSingle(args || {}) } catch (e) { return { error: String(e.message || e) } }
    }))
    // 导入预览（只读）：args={dir} → same/diff/added 分类 + folders 新旧统计，不写任何东西
    disposers.push(handle('notes-import-preview', async (args) => {
      try { return await _importPreview(args && args.dir) } catch (e) { return { error: String(e.message || e) } }
    }))
    // 导入执行：先全量备份（notes-backup-<ts>，含 .history 快照历史），added 入库 / diff 默认跳过（overwrite=true 覆盖）/ folders.json 合并只增不删 /
    // assets 合并同名跳过 / .history 历史合并仅 added 新笔记连带（id 冲突跳过历史合并，同名快照只增不改）
    disposers.push(handle('notes-import', async (args) => {
      try { return await _import(args && args.dir, !!(args && args.overwrite)) } catch (e) { return { error: String(e.message || e) } }
    }))
    // 图片资产上传：{noteId?, name, data(base64/dataURL), mime} → assets/<ts>-<安全名> 落盘（base64 文本形态），返回 {file:'assets/xxx.png'}
    disposers.push(handle('notes-asset-upload', async (args) => {
      try { return await _assetUpload(args || {}) } catch (e) { return { error: String(e.message || e) } }
    }))
    // 二期 ✨整理：{id?, body, kind, title?} → LLM 按 kind 模板重写正文，返回 { ok, body, kind }（不落盘，client 替换编辑器 + 一次撤销栈）
    disposers.push(handle('notes-ai-organize', async (args) => {
      try { return await _aiOrganize(args || {}) } catch (e) { return { error: String(e.message || e) } }
    }))
    // 二期 孤儿资产清理：{dryRun?, files?} → 预览（缺省 dryRun=true，零写入）/ 执行（node:fs 真删除优先，墓碑式清空兜底）
    disposers.push(handle('notes-assets-prune', async (args) => {
      try { return await _assetsPrune(args || {}) } catch (e) { return { error: String(e.message || e) } }
    }))
    // POC 存活探测（P1 骨架遗留，包内 lib/client.js 的「笔记POC」按钮消费；非 host-impl 迁移 RPC 之一）
    disposers.push(handle('notes-ping', async (args) => ({ ok: true, pong: Date.now(), echo: (args && typeof args === 'object') ? args : null })))

    // ---- RPC 兜底路由（harness 缺失时生效；harness 存在时它是无副作用的第二传送门）----
    function readBody(req, limit) {
      return new Promise(function (resolve, reject) {
        var chunks = [], size = 0
        req.on('data', function (c) { size += c.length; if (size > limit) { reject(new Error('payload too large')); try { req.destroy() } catch (_) {} return }; chunks.push(c) })
        req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')) })
        req.on('error', reject)
      })
    }
    if (webServer && typeof webServer.register === 'function') {
      disposers.push(webServer.register({
        kind: 'exact',
        path: RPC_PATH,
        handler: async function (req, res) {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ ok: false, message: 'method not allowed' })); return }
          var payload = null
          // 12MB 上限：notes-asset-upload 携带 base64 图片（5MB 解码 ≈ 6.8MB JSON），原 4MB 装不下
          try { payload = JSON.parse(await readBody(req, 12 * 1024 * 1024)) } catch (e) { res.writeHead(400); res.end(JSON.stringify({ ok: false, message: 'bad request' })); return }
          var fn = payload && handlers[payload.method]
          if (!fn) { res.writeHead(404); res.end(JSON.stringify({ ok: false, message: 'unknown method: ' + payload.method })); return }
          try { var out = await fn(payload.args); res.writeHead(200); res.end(JSON.stringify(out === undefined ? null : out)) } catch (e) { res.writeHead(500); res.end(JSON.stringify({ ok: false, message: String(e) })) }
        },
      }))
    } else if (!(harnessRef && typeof harnessRef.handle === 'function')) {
      console.error('notes: harness 与 ctx.webServer 均不可用，RPC 未注册')
    }

    // ---- 半独立全窗口笔记页路由：GET /dsh-notes-app → app.html（text/html）----
    // 与 RPC 兜底路由同通道（ctx.webServer exact 路由），与 harness 是否存在无关——页面 fetch RPC_PATH 走上方 handlers 表。
    // 每次请求读盘：静态包经符号链接安装，app.html 在真实磁盘路径（import.meta.url 锚定），开发期改页面免重启 host。
    if (webServer && typeof webServer.register === 'function') {
      disposers.push(webServer.register({
        kind: 'exact',
        path: APP_PAGE_ROUTE,
        handler: function (req, res) {
          res.setHeader('Cache-Control', 'no-store')
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.setHeader('Content-Type', 'application/json')
            res.writeHead(405); res.end(JSON.stringify({ ok: false, message: 'method not allowed' })); return
          }
          var html = null
          try { html = fsNode.readFileSync(APP_PAGE_FILE, 'utf8') } catch (e) {}
          if (html == null) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.writeHead(404); res.end('dsh-notes app page not found: ' + APP_PAGE_FILE); return
          }
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.writeHead(200); res.end(req.method === 'HEAD' ? '' : html)
        },
      }))
    }

    // ---- 图片资产路由：GET /dsh-notes/asset?file=assets/<name> ----
    // 磁盘格式是 base64 文本（见上方资产段注释），路由解码为二进制下发。
    // 安全：file 必须恰好是 assets/<basename> 两段式（拒 '..'/绝对路径/子目录穿越），
    //       path.resolve 后复核 dirname 仍钉在 assets 根（双保险）；扩展名白名单决定 Content-Type。
    // 缓存：文件名含秒级时间戳 + 重名序号，内容不变 → immutable 长缓存。
    // 读盘走 ctx.fs（与插件其余读写同通道，单测落内存 mock）；重复注册会 throw，故只在此注册一次并登记 disposer。
    if (webServer && typeof webServer.register === 'function') {
      disposers.push(webServer.register({
        kind: 'exact',
        path: ASSET_ROUTE,
        handler: async function (req, res) {
          res.setHeader('Cache-Control', 'no-store')
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.setHeader('Content-Type', 'application/json')
            res.writeHead(405); res.end(JSON.stringify({ ok: false, message: 'method not allowed' })); return
          }
          let file = ''
          try { file = new URL(req.url || '/', 'http://x').searchParams.get('file') || '' } catch (e) {}
          const parts = file.replace(/\\/g, '/').split('/')
          if (parts.length !== 2 || parts[0] !== 'assets' || !parts[1] || parts[1] === '.' || parts[1] === '..') {
            res.setHeader('Content-Type', 'application/json')
            res.writeHead(400); res.end(JSON.stringify({ ok: false, message: 'bad file' })); return
          }
          const name = parts[1]
          const dot = name.lastIndexOf('.')
          const mime = dot > 0 ? ASSET_EXT_MIME[name.slice(dot).toLowerCase()] : undefined
          if (!mime) {
            res.setHeader('Content-Type', 'application/json')
            res.writeHead(404); res.end(JSON.stringify({ ok: false, message: 'not found' })); return
          }
          const assetsRoot = path.join(NOTES_ROOT, 'assets')
          const abs = path.resolve(assetsRoot, name)
          if (path.dirname(abs) !== assetsRoot) {
            res.setHeader('Content-Type', 'application/json')
            res.writeHead(400); res.end(JSON.stringify({ ok: false, message: 'bad file' })); return
          }
          let text = null
          try { text = await fs.readText(await fs.resolve(abs)) } catch (e) {}
          if (text == null) {
            res.setHeader('Content-Type', 'application/json')
            res.writeHead(404); res.end(JSON.stringify({ ok: false, message: 'not found' })); return
          }
          const buf = Buffer.from(String(text).replace(/\s+/g, ''), 'base64')
          res.setHeader('Content-Type', mime)
          res.setHeader('Content-Length', buf.length)
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          res.writeHead(200); res.end(req.method === 'HEAD' ? '' : buf)
        },
      }))
    }

    // 工具注册：主通道 = 全局 Builtin harness.defineTool + harness.registerTool（原 host-impl.js 姿势原样保留）；
    // 仅在 harness 缺失时回退到 ctx.tools.register（task-board 的服务路径）。两通道互斥，不会重复注册。
    function regTool(def) {
      if (harnessRef && typeof harnessRef.defineTool === 'function' && typeof harnessRef.registerTool === 'function') {
        const tool = harnessRef.defineTool(def)
        if (tool) { const d = harnessRef.registerTool(ctx, tool); if (typeof d === 'function') disposers.push(d) }
        return
      }
      if (tools && typeof tools.register === 'function') {
        const d = tools.register(defineTool(def))
        if (typeof d === 'function') disposers.push(d)
        return
      }
      console.error('notes: 无可用工具注册通道（harness / ctx.tools），工具未注册：' + (def && def.name))
    }

    const outSchema = { type: 'object', additionalProperties: true }
    function mkRender() {
      return (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    }

    // ---- 工具层：合并 9 个细粒度工具为 3 个（note_search / note_get / note_manage）
    // RPC 层保持 handler 不变（client panel 仍在用）；工具只面向 Agent，瘦身 schema。
    regTool({
      name: 'note_search',
      description: 'Search local notes by free-text query (matches title/body/topic/tags), with optional tag, topic, kind, folder, sensitive, and inject filters. When a query is given, each result carries a matches array telling which fields matched (title/tags/body — relevance: title > tags > body). Returns slim notes (no body) for fast triage — call note_get for the full body of a specific id. Default results EXCLUDE work logs (kind=log, stealth by design) — pass kind=log or includeLogs:true to recall them. Tip: when planning a task, picking an approach, or making decisions, consider searching this notes library first for related decisions, todos, and context recorded in earlier sessions — it may already contain the conclusions you need.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text query against title, body, topic, and tags. Omit to list all (optionally filtered by tag/topic/kind/folder/sensitive/inject).' },
          tag: { type: 'string', description: 'Optional tag filter (exact match)' },
          topic: { type: 'string', description: 'Optional topic filter (exact match)' },
          kind: { type: 'string', enum: KINDS, description: 'Optional kind filter: note/decision/todo/link/quote/log. Pass log to recall work logs (excluded by default).' },
          folder: { type: 'string', description: 'Optional folder filter: folder id or exact folder name; empty string = unfiled notes (未分类). Non-empty filter is a recursive subtree match — it returns notes in that folder AND all its descendant folders (folders nest via parent; maxFolderDepth setting, default 3).' },
          sensitive: { type: 'boolean', description: 'Optional sensitive filter: true = only sensitive (masked) notes, false = exclude sensitive notes. Omit = no filter.' },
          inject: { type: 'boolean', description: 'Optional inject filter: true = only notes injected into the system prompt, false = exclude injected notes. Omit = no filter.' },
          includeLogs: { type: 'boolean', description: 'Include work logs (kind=log) in results; default false (logs are stealth). kind=log implies inclusion.' },
          limit: { type: 'number', description: 'Optional max results (default 50)' }
        }
      },
      output: { schema: outSchema, render: mkRender() },
      async execute(args) {
        // folder 入参兼容 id 或名称（名称精确命中）；找不到直接报错，不写悬空引用
        let folder = args && args.folder
        if (folder !== undefined) {
          const rf = await resolveFolderRef(folder)
          if (!rf) return { error: '文件夹不存在：' + String(folder) }
          folder = rf.id
        }
        const all = await _search(args && args.query, args && args.tag, args && args.topic, args && args.kind, folder, { sensitive: args && args.sensitive, inject: args && args.inject, includeLogs: !!(args && args.includeLogs) })
        const limit = (args && args.limit) || 50
        return { count: all.length, notes: all.slice(0, limit).map(n => { const s = slim(n); if (n.matches) s.matches = n.matches; return s }) }
      }
    })

    regTool({
      name: 'note_get',
      description: 'Read the full body and metadata of a local note by id. Use after note_search to retrieve the body of an interesting result.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Note id' } },
        required: ['id']
      },
      output: { schema: outSchema, render: mkRender() },
      async execute(args) {
        try {
          const n = await _get(args.id)
          // 使用遥测（P2）：命中计数 +1（内存即时生效，60s 防抖批量落盘，见 use-telemetry 块）
          const uc = bumpUseCount(n.id)
          if (uc !== null) n.useCount = uc
          return { note: n }
        }
        catch (e) { return { error: String(e.message || e) } }
      }
    })

    regTool({
      name: 'note_manage',
      description: 'Single tool for create/list/update/delete/restore/archive. Pick an action and supply its required fields. The Agent should prefer this for any non-search CRUD: one tool means one decision point and one schema to learn.\n\n' +
        'Fields kind (what it is) and status (its lifecycle) are orthogonal: kind ∈ note/decision/todo/link/quote/log (default note); status ∈ active/pinned/resolved/superseded (default active). kind=log is a work log (工作日志): stealth by design — inject is force-disabled (hard gate, true is corrected with injectForcedOff in the response), recall defaults false, and logs are excluded from default list/search (pass kind=log or includeLogs:true to recall); put work logs in folder「工作日志」.\n' +
        'inject (boolean) controls whether the note is injected into the system prompt as context — an explicit field, NOT a tag. injectRole ("convention"|"reference", default "convention") picks the injection bucket: convention = user rules to follow; reference = background facts to consult only when relevant to the current task. Rule of thumb — infer from kind: decision/todo → convention, note/link/quote → reference. injectTo (string[]) is the injection scope, a multi-select list: [] or omitted=all sessions (default), or session short-ids like ["99f2b674","7f8b49e6"] to restrict the scope.\n\n' +
        'recall (boolean) controls whether the note appears in the notes catalog — a one-line-per-note index injected into the system prompt (right after conventions) so you know what the library holds without searching; default true. Set false to hide a note from the catalog (it stays searchable via note_search). Orthogonal to inject; notes with status resolved/superseded never appear in the catalog.\n\n' +
        'sensitive (boolean) marks the note as containing secrets (passwords/tokens/keys); default false. When true, injected text (conventions/catalog) masks secret-looking lines — keys and structure are kept, only values are hidden as ******（敏感，note_get <id> 获取）— so agents must call note_get for the original. Create/quick responses may return sensitiveSuggested: true when the body matches secret patterns; quick-capture notes are auto-flagged sensitive instead.\n\n' +
        'folder (string) assigns a note to a virtual folder: pass a folder id or an exact folder name; "" or omitted = unfiled (未分类). Folders (name/order/parent) are managed via the notes-folders RPC (list/create/rename/delete/reorder): folders NEST via a parent field (maxFolderDepth setting caps the depth, default 3, 0 = unlimited), any folder filter is a recursive subtree match (a folder includes notes in all its descendant folders), and deleting a folder that still has child folders or notes requires explicit cascade:true — the folder structure is removed for good while its notes are soft-deleted into the trash and can be restored (restored notes fall back to unfiled when their folder is gone).\n\n' +
        'Actions:\n' +
        '- create: { title, body, topic?, tags?, kind?, status?, inject?, injectRole?, injectTo?, recall?, sensitive?, folder?, sessionId?, cwd?, workspace?, logDate? }\n' +
        '- list: { tag?, topic?, kind?, folder?, includeLogs? } (no id/title/body needed; default excludes kind=log work logs — pass kind=log or includeLogs:true)\n' +
        '- update: { id, title?, body?, topic?, tags?, kind?, status?, inject?, injectRole?, injectTo?, recall?, sensitive? } (setting status to "resolved" auto-closes the dispatch loop: all open entries in the note\'s dispatches are marked dispatchStatus=done with doneAt — use this to report completion of a dispatched todo)\n' +
        '- move: { id, folder } (move note into a virtual folder — folders nest, so any folder id at any depth is valid; folder = folder id or exact folder name, "" = move out to unfiled)\n' +
        '- delete: { id } (soft delete; restorable via restore)\n' +
        '- restore: { id } (undo delete/archive)\n' +
        '- archive: { groups? } (explicit archive, undoable once via the notes-archive-undo RPC). groups = whitelist [{memberIds:[noteId,...], title?}]: merge exactly those groups (memberIds must all exist and not be deleted; title overrides the default group title). Without groups: merge ONLY quick-capture notes grouped by session. Behavior change: manual notes are NEVER auto-grouped by tag anymore — pass explicit groups to merge them (preview quick groups first via the notes-archive-preview RPC).\n' +
        '- dispatch: { id, targetSessionId?, targetSessionName?, instruction? } (assemble the todo context plus your instruction into one user message and send it to a live session as a real task; the handoff is recorded in the note\'s dispatches property with dispatchStatus=sent. Omit targetSessionId to list live sessions. Closed loop: when the target session reports completion via update status=resolved, open dispatches auto-flip to dispatchStatus=done; an idle transition of the target session also writes a receipt.)',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'list', 'update', 'move', 'delete', 'restore', 'archive', 'dispatch', 'debugws'], description: 'Action to perform' },
          // create / update 字段
          id: { type: 'string', description: 'Note id (required for update/delete/restore/dispatch)' },
          title: { type: 'string', description: 'Title (create/update)' },
          body: { type: 'string', description: 'Markdown body (create/update)' },
          topic: { type: 'string', description: 'Topic (create/update; defaults to 未分类)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags (create/update)' },
          kind: { type: 'string', enum: KINDS, description: 'Kind (create/update): note/decision/todo/link/quote/log; default note. log = work log (隐身：inject 强制关闭，recall 缺省 false，默认列表/搜索不含)' },
          status: { type: 'string', enum: STATUSES, description: 'Status (create/update): active/pinned/resolved/superseded; default active' },
          inject: { type: 'boolean', description: 'Inject into system prompt as context (create/update); default false. Setting inject=true permanently marks injectEver=true (sticky "ever injected" flag — later turning inject off never unsets it; injectEver is read-only and appears in list/get output).' },
          injectRole: { type: 'string', enum: ['convention', 'reference'], description: 'Injection role: convention=rules to follow | reference=background facts to consult as needed; default convention' },
          injectTo: { type: 'array', items: { type: 'string' }, description: 'Injection scope multi-select: [] or omitted=all sessions (default), or session short-ids like ["99f2b674","7f8b49e6"] to restrict' },
          recall: { type: 'boolean', description: 'Recall in the notes catalog index (create/update); default true. Set false to hide from the catalog (still searchable via note_search).' },
          sensitive: { type: 'boolean', description: 'Sensitive-content flag (create/update); default false. When true, injected text masks secret-looking lines (keys kept, values hidden as ******（敏感，note_get <id> 获取）); agents call note_get for the original.' },
          folder: { type: 'string', description: 'Virtual folder (create/move/list filter): folder id or exact folder name; "" = unfiled (未分类). Folders nest via parent (maxFolderDepth setting, default 3); a list filter matches the whole subtree recursively (notes in descendant folders included).' },
          // archive 字段（显式归档白名单）
          groups: { type: 'array', items: { type: 'object', properties: { memberIds: { type: 'array', items: { type: 'string' } }, title: { type: 'string' } }, required: ['memberIds'] }, description: 'Archive whitelist (archive action only): [{memberIds:[noteId,...], title?}] — merge exactly these groups. Omitted = merge only quick-capture groups; manual notes are NEVER auto-grouped by tag (behavior change).' },
          // dispatch 字段
          targetSessionId: { type: 'string', description: 'Dispatch target: a live session id (dispatch). Omit to list live sessions.' },
          targetSessionName: { type: 'string', description: 'Dispatch target display name (dispatch, optional)' },
          instruction: { type: 'string', description: 'Dispatch: your concrete instruction appended to the todo context (dispatch, optional)' },
          // list 字段
          tag: { type: 'string', description: 'Tag filter (list only)' },
          includeLogs: { type: 'boolean', description: 'Include work logs kind=log in list results (list only); default false. kind=log implies inclusion.' },
          // 高级（通常自动填充）
          sessionId: { type: 'string', description: 'Session id (advanced; usually auto-filled)' },
          cwd: { type: 'string', description: 'Working dir (advanced; usually auto-filled)' },
          workspace: { type: 'string', description: 'Workspace name (advanced; usually auto-filled)' },
          logDate: { type: 'string', description: 'Work-log date key YYYY-MM-DD local (create with kind=log only; defaults to today — omit normally)' }
        },
        required: ['action']
      },
      output: { schema: outSchema, render: mkRender() },
      async execute(args) {
        const action = args && args.action
        try {
          if (action === 'create') {
            if (!args.title || !args.body) return { error: 'note_manage.create 需要 title 和 body' }
            // folder 兼容 id 或名称（名称精确命中解析为 id）；找不到直接报错，不写悬空引用
            let folder = args.folder
            if (folder !== undefined) {
              const rf = await resolveFolderRef(folder)
              if (!rf) return { error: '文件夹不存在：' + String(folder) }
              folder = rf.id
            }
            const r = await _create(args.title, args.body, args.tags, args.topic, {
              sessionId: args.sessionId, cwd: args.cwd, workspace: args.workspace,
              kind: args.kind, status: args.status, inject: args.inject, injectRole: args.injectRole, injectTo: args.injectTo,
              folder: folder, recall: args.recall, sensitive: args.sensitive, logDate: args.logDate
            })
            const out = { action: 'create', id: r.id, topic: r.topic, kind: r.kind, status: r.status, message: 'Note created' }
            // 敏感模式自动识别建议透传（create 不强制落 sensitive，由调用方决策）
            if (r.sensitiveSuggested) { out.sensitiveSuggested = true; out.message += '（检测到疑似敏感信息，建议 sensitive: true 开启注入脱敏）' }
            // 日志隐身硬闸命中告知（kind=log 强制 inject=false、recall 缺省 false）
            if (r.injectForcedOff) { out.injectForcedOff = true; out.message += '（kind=log 日志默认隐身：inject 已强制关闭，日志不进系统提示/目录/默认列表与搜索）' }
            return out
          }
          if (action === 'list') {
            // folder 过滤：兼容 id 或名称；'' = 未分类
            let folder = args.folder
            if (folder !== undefined) {
              const rf = await resolveFolderRef(folder)
              if (!rf) return { error: '文件夹不存在：' + String(folder) }
              folder = rf.id
            }
            const notes = await _list(args.tag, args.kind, folder, undefined, !!args.includeLogs)
            return { action: 'list', count: notes.length, notes: notes.map(slim) }
          }
          if (action === 'move') {
            if (!args.id) return { error: 'note_manage.move 需要 id' }
            if (args.folder === undefined) return { error: 'note_manage.move 需要 folder（文件夹 id 或名称，空字符串 = 移出到未分类）' }
            const rf = await resolveFolderRef(args.folder)
            if (!rf) return { error: '文件夹不存在：' + String(args.folder) }
            await _update(args.id, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, rf.id)
            return { action: 'move', id: args.id, folder: rf.id, folderName: rf.name, message: rf.id ? '已移动到文件夹「' + rf.name + '」' : '已移出文件夹（未分类）' }
          }
          if (action === 'update') {
            if (!args.id) return { error: 'note_manage.update 需要 id' }
            const r = await _update(args.id, args.title, args.body, args.tags, args.topic, args.kind, args.status, args.inject, args.injectTo, undefined, args.recall, args.injectRole, args.sensitive)
            // P3 派发闭环：resolved 联动回执了派发时在消息里明示（agent 可感知闭环已发生）
            // 工作记忆 v0：kind=log 隐身硬闸命中时告知（inject 被强制关闭）
            return { action: 'update', id: args.id, kind: r.kind, status: r.status, dispatchClosed: r.dispatchClosed || 0, injectForcedOff: r.injectForcedOff === true, message: 'Note updated' + (r.dispatchClosed ? '；已自动回执 ' + r.dispatchClosed + ' 条派发（dispatchStatus→done）' : '') + (r.injectForcedOff ? '（kind=log 日志默认隐身：inject 已强制关闭）' : '') }
          }
          if (action === 'delete') {
            if (!args.id) return { error: 'note_manage.delete 需要 id' }
            await _delete(args.id)
            return { action: 'delete', id: args.id, message: 'Note deleted (soft)' }
          }
          if (action === 'restore') {
            if (!args.id) return { error: 'note_manage.restore 需要 id' }
            await _restore(args.id)
            return { action: 'restore', id: args.id, message: 'Note restored' }
          }
          if (action === 'archive') {
            // 显式归档：groups 白名单优先；无 groups 只合速记组（行为变更：手动笔记不再自动分组）
            const r = await _archive({ groups: args.groups })
            return { action: 'archive', merged: r.merged, mergedIds: r.mergedIds, groups: r.groups, message: 'Archived ' + r.merged + ' groups' }
          }
          if (action === 'debugws') {
            // dump 指定会话（args.sessionId=short id）的 title 事件历史 + fold 结果
            if (args.sessionId) {
              const hs = await sessionPersistence.list()
              const h = hs.map(snapHeader).find(x => x && shortSid(x.id) === args.sessionId)
              if (!h) return { error: '会话不存在: ' + args.sessionId }
              const insp = await sessionPersistence.inspect(h.id)
              const evs = (insp && insp.events) || []
              const titleEvs = []
              for (const ev of evs) { if (ev && ev.type === 'session/title') titleEvs.push({ seq: ev.seq, title: ev.data && ev.data.title, source: ev.data && ev.data.source && ev.data.source.kind }) }
              const live = agents && agents.get ? agents.get(h.id) : undefined
              let stTitle = '(not live)'
              if (live) { try { const s = sessionTitle.get(live.session); stTitle = s && s.title } catch (e) { stTitle = 'ERR' } }
              return { action: 'debugws', sessionShort: args.sessionId, live: !!live, parent: h.parentSession ? shortSid(h.parentSession) : '', sessionTitleGet: stTitle, titleEvents: titleEvs }
            }
            // 默认：对比 工作区 sessionIds（左侧列表数据源）vs sessionPersistence.list()（所有持久化），确认"已关闭"会话的差异
            const wl = (workspaceRegistry && workspaceRegistry.list) ? workspaceRegistry.list() : []
            const archivedSet = {}
            try { const arch = workspaceRegistry && workspaceRegistry.archivedSessionIds; if (Array.isArray(arch)) { for (const id of arch) archivedSet[id] = true } } catch (e) {}
            const wsInfo = []
            let totalInWs = 0, archivedInWs = 0
            for (const w of wl) {
              let sids = []
              try { sids = w.sessionIds || [] } catch (e) {}
              const cnt = Array.isArray(sids) ? sids.length : 0
              totalInWs += cnt
              const archCnt = Array.isArray(sids) ? sids.filter(s => archivedSet[s]).length : 0
              archivedInWs += archCnt
              wsInfo.push({ title: w.title, sessionCount: cnt, archivedInIt: archCnt })
            }
            let totalPersist = 0
            try { const hs = await sessionPersistence.list(); totalPersist = hs.length } catch (e) {}
            return {
              action: 'debugws',
              hasInspect: typeof sessionPersistence.inspect,
              hasStat: typeof sessionPersistence.stat,
              totalPersist: totalPersist,
              totalInWorkspaces: totalInWs,
              archivedInWorkspaces: archivedInWs,
              archivedSetSize: Object.keys(archivedSet).length,
              workspaces: wsInfo
            }
          }
          if (action === 'dispatch') {
            if (!args.id) return { error: 'note_manage.dispatch 需要 id' }
            if (!args.targetSessionId) {
              // 未指定目标：返回当前活跃主会话列表（含名字）供 agent 选择（_activeSessions 新形态：取 .sessions）
              const list = (await _activeSessions()).sessions.map(s => ({ sessionId: s.id, short: s.short, name: s.name, workspace: s.workspace }))
              return { action: 'dispatch', needTarget: true, activeSessions: list, message: '请用 targetSessionId 指定目标活跃会话' }
            }
            const r = await _dispatch(args.id, { sessionId: args.targetSessionId, sessionName: args.targetSessionName, instruction: args.instruction, mode: 'existing' })
            if (r.error) return { error: r.error }
            return { action: 'dispatch', id: args.id, sessionId: r.sessionId, message: '已派发到「' + r.sessionName + '」' + (args.instruction ? '（含具体要求）' : '') }
          }
          return { error: 'note_manage: 未知 action：' + String(action) + '（期望 create/list/update/move/delete/restore/archive/dispatch）' }
        } catch (e) { return { error: String(e.message || e) } }
      }
    })

    // ---- 一次性数据迁移：开发版 D:\...\dsh-notes-plugin\notes → ~/.dsh/notes ----
    // 触发：目标目录缺失该 .md 时逐文件复制（幂等、不覆盖已存在的目标文件、不删除源目录）。
    // 走 ctx.fs 服务（而非 node:fs），保证写盘受 sandboxPolicy 管束，单测里也只落在内存 mock。
    async function listMd(dir) {
      try {
        const target = await fs.resolve(dir)
        const info = await fs.stat(target)
        if (!info) return []
        const entries = await fs.listDir(target)
        return (entries || []).map(e => e && e.name).filter(n => n && /\.md$/i.test(n))
      } catch (e) { return [] }
    }
    async function migrateLegacyNotes() {
      try {
        // 图片资产连带迁移（同名跳过）：即使无旧 .md 也执行（开发版可能只攒下 assets）
        const assetsMigrated = await copyAssetsDir(LEGACY_NOTES_DIR, NOTES_ROOT, true)
        if (assetsMigrated > 0) console.log('notes: migrated ' + assetsMigrated + ' legacy asset(s) → ' + path.join(NOTES_ROOT, 'assets'))
        const legacyNames = await listMd(LEGACY_NOTES_DIR)
        if (legacyNames.length === 0) return { migrated: 0, assetsMigrated: assetsMigrated, skipped: 'no-legacy-notes' }
        const existing = {}
        for (const n of await listMd(NOTES_ROOT)) existing[n] = true
        let migrated = 0
        for (const name of legacyNames) {
          if (existing[name]) continue
          try {
            const src = await fs.resolve(path.join(LEGACY_NOTES_DIR, name))
            const dst = await fs.resolve(path.join(NOTES_ROOT, name))
            const content = await fs.readText(src)
            await fs.writeText(dst, content, undefined, undefined, getPolicy())
            migrated++
          } catch (e) { console.error('notes: migrate failed', name, e) }
        }
        if (migrated > 0) console.log('notes: migrated ' + migrated + ' legacy note(s) → ' + NOTES_ROOT)
        return { migrated: migrated, total: legacyNames.length, assetsMigrated: assetsMigrated }
      } catch (e) {
        console.error('notes: legacy migration error', e)
        return { migrated: 0, error: String(e && e.message || e) }
      }
    }
    let migrationDone = migrateLegacyNotes()
    // 设置启动加载（不阻塞 apply 返回）：classifyTopic/extractInstruction/notes-settings-get 内部 await 同一 promise 保证就绪
    loadSettings()
    // 用量统计启动加载（同口径不阻塞）：recordUsage 记账前内部也会 await loadUsage()，双保险防覆盖存量
    loadUsage()

    // 存量一次性修补：agents 未就绪期创建的笔记 workspace 为空，导致“本工作区”注入范围严格匹配后永不命中。
    // 启动时按来源会话推导补填一次（只补空值）。注意：不用 _list()（它 await migrationDone，会与本补全死锁），
    // 直接走底层遍历；也不挂进 migrationDone 链——_list 只需等 legacy 迁移，补全异步自跑即可。
    const legacyDone = migrationDone
    async function fixLegacyWorkspaces() {
      try { await legacyDone } catch (e) {}
      try {
        const dirTarget = await fs.resolve(NOTES_DIR)
        const info = await fs.stat(dirTarget)
        if (!info) return { fixed: 0 }
        const entries = await fs.listDir(dirTarget)
        let fixed = 0
        let skipped = 0
        for (const entry of entries) {
          if (!entry.name || !entry.name.endsWith('.md')) continue
          const id = entry.name.replace(/\.md$/, '')
          try {
            const n = await loadNote(id)
            if (n.deleted || n.workspace) continue
            const ws = await _wsOfSession(n.sessionId)
            if (!ws) { skipped++; console.log('notes: workspace backfill skip ' + id + ' (sid=' + (n.sessionId || 'none') + ', 推导不到 cwd)') ; continue }
            await persistNote(Object.assign({}, n, { workspace: ws }))
            fixed++
          } catch (e) { skipped++; console.error('notes: workspace backfill item failed', id, e) }
        }
        console.log('notes: workspace backfill done, fixed=' + fixed + ' skipped=' + skipped)
        return { fixed: fixed }
      } catch (e) { console.error('notes: workspace backfill error', e); return { fixed: 0, error: String(e && e.message || e) } }
    }
    fixLegacyWorkspaces()

    ctx.effect(() => () => {
      for (const d of disposers) { try { d() } catch (e) {} }
      flushUseCounts()   // 卸载 flush：防抖窗口内未落盘的 useCount 立即写盘（fire-and-forget，不阻塞卸载）
      flushUsage()       // 卸载 flush：usage.json 防抖窗口内未落盘的 token 计数立即写盘（同上 fire-and-forget）
    })
    // 发布版不再写 .last-host-load 开发心跳（静态包 import 即就绪，无需引导壳自检）
    console.log('notes plugin: host ready (static pkg), notes dir =', NOTES_ROOT, ', llm =', !!llm, ', adm =', !!adm, ', rpc =', RPC_PATH, ', app =', APP_PAGE_ROUTE, ', asset =', ASSET_ROUTE)
}
