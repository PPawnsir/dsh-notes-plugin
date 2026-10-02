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
// .json 后缀不进笔记列表（_list/listMd 只认 .md），settings.json 落在同目录天然不污染列表。
// 开发版目录：只用于 (a) 首次启动的一次性数据迁移 (b) 开发资产回退读取。发布环境不存在这些文件时静默跳过。
const LEGACY_PLUGIN_DIR = 'D:\\deepseek-work\\dsh-notes-plugin'
const LEGACY_NOTES_DIR = path.join(LEGACY_PLUGIN_DIR, 'notes')
// 样式/源码候选路径：包内 lib/styles.css 优先（P3 会把 styles.css 放那里），再包根，最后开发版回退
const CSS_CANDIDATES = [
  path.join(PKG_DIR, 'lib', 'styles.css'),
  path.join(PKG_DIR, 'styles.css'),
  path.join(LEGACY_PLUGIN_DIR, 'styles.css'),
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
        'injectTo: ' + (m.injectTo || []).map(escYaml).join(', ') + '\n' +
        'recall: ' + escYaml(m.recall === false ? 'false' : 'true') + '\n' +
        // sensitive 恒写（true/false 显式落盘，缺省 false）：敏感笔记注入时正文按行打码
        'sensitive: ' + escYaml(m.sensitive === true ? 'true' : 'false') + '\n' +
        'createdAt: ' + escYaml(m.createdAt) + '\n' +
        'updatedAt: ' + escYaml(m.updatedAt) + '\n' +
        'sessionId: ' + escYaml(m.sessionId) + '\n' +
        'cwd: ' + escYaml(m.cwd) + '\n' +
        'mergedFrom: ' + (m.mergedFrom || []).map(escYaml).join(', ') + '\n' +
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
          meta[key] = (key === 'tags' || key === 'mergedFrom' || key === 'injectTo')
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
    // 通用结构：设置项是 settingsCache 的顶层键（llm 选配 + catalogEnabled 目录索引总开关 + staleDays 时效标注 + injectBudgetChars 注入预算），client 经 notes-settings-get/set 读写。
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
    let lastInjectChars = 0
    // 时效判定：updatedAt 距今超过 limit 天 → 返回整天数（目录 ⚠ 标注用）；limit=0 关闭 / 无法解析 / 未超期 → 0
    function staleDaysOf(updatedAt, limit) {
      if (limit <= 0) return 0
      const t = Date.parse(updatedAt || '')
      if (!isFinite(t)) return 0
      const d = Math.floor((Date.now() - t) / 86400000)
      return d > limit ? d : 0
    }
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
        let out = ''
        for await (const chunk of llm.stream({
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
        })) {
          if (chunk && chunk.type === 'text-delta') out += chunk.text
          if (chunk && chunk.type === 'finish') break
        }
        const topic = out.trim().replace(/^["'「」『』]+|["'「」『』]+$/g, '')
        return topic || '未分类'
      } catch (e) {
        console.error('notes: classifyTopic failed', e)
        return '未分类'
      }
    }

    // ---- 缓存层：解析结果按 id 常驻内存；本插件所有写入同步缓存，外部新增文件在 list 时懒加载 ----
    const KINDS = ['note', 'decision', 'todo', 'link', 'quote']
    const STATUSES = ['active', 'pinned', 'resolved', 'superseded']
    // ---- 二期：kind 模板骨架（新建笔记预填）+ ✨整理 LLM prompt 的模板示例，同源于此 ----
    // （与开发版 host-impl.js 双边同步；client-impl.js / app.html / 原型 design/notes-editor-v3.html 同款，check.js 断言一致）
    // note 为自由格式（空骨架）；机器/运维信息类笔记由 ✨整理按内容套用 MACHINE_TEMPLATE（建时无法预判内容，不进 KIND_TEMPLATES）
    const KIND_TEMPLATES = {
      note: '',
      decision: '## 背景\n\n（问题与上下文）\n\n## 结论\n\n（最终选择）\n\n## 理由\n\n（权衡与依据）\n',
      todo: '- [ ] （待办事项）\n',
      link: '## 链接\n\n（URL）\n\n## 说明\n\n（用途与要点）\n',
      quote: '> （引用原文）\n\n—— （出处）\n'
    }
    // 机器信息模板（✨整理 prompt 的 note kind 内容适配分支：环境/机器清单/账号/门户）
    const MACHINE_TEMPLATE = '## 环境\n\n（环境名称与说明）\n\n## 机器清单\n\n（主机名 / IP / 用途）\n\n## 账号\n\n（登录方式与账号）\n\n## 门户\n\n（门户与入口地址）\n'
    const KIND_LABELS_ZH = { note: '笔记', decision: '决策', todo: '待办', link: '链接', quote: '引用' }
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
        // recall：目录索引准入字段，缺省 true（旧文件无 recall 字段 → 进目录）；显式 false 逐条关闭（与 inject 正交）
        recall: p.meta.recall !== 'false',
        // sensitive：敏感内容标记（注入时正文按行打码，键保留值遮蔽），缺省 false（存量零迁移）
        sensitive: p.meta.sensitive === 'true',
        createdAt: p.meta.createdAt || '',
        updatedAt: p.meta.updatedAt || '',
        sessionId: p.meta.sessionId || '',
        cwd: p.meta.cwd || '',
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
    // 墓碑/已删/缓存失效跳过（删除时已带最新计数落盘，跳过无数据损失；0 字节墓碑不可复活；已删笔记不会再被 note_get 命中）
    async function flushUseCounts() {
      if (useCountTimer) { clearTimeout(useCountTimer); useCountTimer = null }
      const ids = Array.from(useCountDirty)
      for (const id of ids) {
        useCountDirty.delete(id)
        const n = cache.get(id)
        if (!n || n.tombstoned || n.deleted) continue
        try { await persistNote(n) } catch (e) { console.error('notes: useCount flush failed', id, e) }
      }
    }
    // ==== use-telemetry END ====

    async function persistNote(n) {
      perfStats.diskWrites++
      const meta = {
        id: n.id, title: n.title, topic: n.topic, workspace: n.workspace, folder: n.folder || '',
        tags: n.tags || [], kind: n.kind || 'note', status: n.status || 'active',
        inject: n.inject === true, injectTo: n.injectTo || [], injectRole: n.injectRole === 'reference' ? 'reference' : 'convention', recall: n.recall !== false, sensitive: n.sensitive === true,
        createdAt: n.createdAt, updatedAt: n.updatedAt,
        sessionId: n.sessionId, cwd: n.cwd, mergedFrom: n.mergedFrom || [],
        dispatches: n.dispatches || [],
        useCount: Math.max(0, n.useCount || 0),
        archivedAt: n.archivedAt || '', deleted: n.deleted ? 'true' : 'false'
      }
      const content = buildFM(meta) + (n.body || '')
      const ft = await fs.resolve(noteFile(n.id))
      await fs.writeText(ft, content, undefined, undefined, getPolicy())
      cache.set(n.id, Object.assign({}, n))
    }

    // 列表/RPC 瘦身：不带 body，正文编辑走 notes-get 按需加载
    function slim(n) {
      return {
        id: n.id, title: n.title, topic: n.topic, workspace: n.workspace, folder: n.folder || '',
        tags: n.tags, kind: n.kind || 'note', status: n.status || 'active',
        inject: n.inject === true, injectTo: n.injectTo || [], injectRole: n.injectRole === 'reference' ? 'reference' : 'convention', recall: n.recall !== false, sensitive: n.sensitive === true,
        createdAt: n.createdAt, updatedAt: n.updatedAt,
        sessionId: n.sessionId, cwd: n.cwd, mergedFrom: n.mergedFrom,
        dispatches: n.dispatches || [],
        useCount: n.useCount || 0,
        archivedAt: n.archivedAt, deleted: n.deleted === true, preview: String(n.body || '').slice(0, 200)
      }
    }

    // ---- 虚拟文件夹：~/.dsh/notes/folders.json 登记清单 [{id,name,order}]；笔记 front-matter 的 folder 字段存文件夹 id（缺省 ''=未分类，向后兼容） ----
    // .json 后缀不进笔记列表（_list 只认 .md），与 settings.json 同理落在同目录天然不污染列表。
    const FOLDERS_PATH = path.join(NOTES_ROOT, 'folders.json')

    function genFolderId() {
      return 'f-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    }

    // 读文件夹清单：文件缺失/JSON 损坏/结构非法一律兜底为空数组（不抛错，笔记主流程不受 folders.json 影响）
    async function loadFolders() {
      try {
        const ft = await fs.resolve(FOLDERS_PATH)
        const arr = JSON.parse(await fs.readText(ft))
        if (!Array.isArray(arr)) return []
        return arr.filter(f => f && f.id).map(f => ({ id: String(f.id), name: String(f.name || ''), order: typeof f.order === 'number' ? f.order : 0 }))
      } catch (e) { return [] }
    }

    async function saveFolders(list) {
      const ft = await fs.resolve(FOLDERS_PATH)
      await fs.writeText(ft, JSON.stringify(list, null, 2), undefined, undefined, getPolicy())
    }

    // 有效文件夹：folder 引用必须命中清单（清单损坏/外部改乱的笔记按未分类对待，保证计数与过滤口径一致）
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

    // notes-folders RPC 核心：无参/op 缺省 = list（按 order 排序，含各文件夹计数 + unfiled 未分类计数）；op = create/rename/delete/reorder
    // 计数口径：deleted 笔记由 _list 排除不计；folder 指向清单外 id 的笔记计入 unfiled
    async function _folders(args) {
      const a = args || {}
      const op = a.op || 'list'
      if (op === 'list') {
        const folders = await loadFolders()
        const all = await _list()
        const counts = {}
        let unfiled = 0
        for (const n of all) {
          const f = effectiveFolder(n, folders)
          if (!f) unfiled++
          else counts[f] = (counts[f] || 0) + 1
        }
        const list = folders.slice().sort((x, y) => x.order - y.order)
          .map(f => ({ id: f.id, name: f.name, order: f.order, count: counts[f.id] || 0 }))
        return { folders: list, unfiled: unfiled }
      }
      if (op === 'create') {
        const name = String(a.name || '').trim()
        if (!name) return { error: 'notes-folders.create 需要 name' }
        const folders = await loadFolders()
        const maxOrder = folders.reduce((m, f) => Math.max(m, f.order), -1)
        const folder = { id: genFolderId(), name: name, order: maxOrder + 1 }
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
        const idx = folders.findIndex(x => x.id === a.id)
        if (idx < 0) return { error: '文件夹不存在: ' + a.id }
        folders.splice(idx, 1)
        await saveFolders(folders)
        // 其下笔记回退未分类：主动清空 folder 字段（保持数据一致，计数/过滤无需额外兜底）
        const all = await _list()
        let reset = 0
        for (const n of all) {
          if ((n.folder || '') === a.id) {
            await _update(n.id, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, '')
            reset++
          }
        }
        return { ok: true, id: a.id, reset: reset }
      }
      if (op === 'reorder') {
        if (!Array.isArray(a.ids)) return { error: 'notes-folders.reorder 需要 ids 数组' }
        const ids = a.ids.map(String)
        const rank = {}
        ids.forEach((id, i) => { rank[id] = i })
        const folders = await loadFolders()
        // 入列的按 ids 顺序重排；未入列的保持原相对顺序追加尾部；最终 order 归一化为 0..n-1
        const inList = folders.filter(f => rank[f.id] !== undefined).sort((x, y) => rank[x.id] - rank[y.id])
        const outList = folders.filter(f => rank[f.id] === undefined).sort((x, y) => x.order - y.order)
        const merged = inList.concat(outList)
        merged.forEach((f, i) => { f.order = i })
        await saveFolders(merged)
        return { ok: true, folders: merged.map(f => ({ id: f.id, name: f.name, order: f.order })) }
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
      const note = {
        id, title: title || 'Untitled', topic: topic || '未分类',
        workspace: ex.workspace || basename(sc.cwd),
        folder: ex.folder || '',
        tags: tags || [],
        kind: ex.kind || 'note',
        status: ex.status || 'active',
        inject: ex.inject === true,
        injectTo: ex.injectTo || [],
        injectRole: ex.injectRole === 'reference' ? 'reference' : 'convention',
        recall: ex.recall !== false,
        sensitive: ex.sensitive === true,
        createdAt: ex.createdAt || now, updatedAt: ex.updatedAt || now,
        sessionId: ex.sessionId !== undefined ? ex.sessionId : sc.sessionId,
        cwd: ex.cwd || sc.cwd,
        mergedFrom: ex.mergedFrom || [],
        dispatches: ex.dispatches || [],
        useCount: ex.useCount || 0,
        archivedAt: ex.archivedAt || '',
        deleted: false,
        body: body || ''
      }
      await persistNote(note)
      const r = { id, topic: note.topic, title: note.title, kind: note.kind, status: note.status }
      // 敏感模式自动识别建议：命中不强制落 sensitive（create 是显式动作，由调用方/用户决策），仅回传建议标记
      if (note.sensitive !== true && suggestSensitive(note.body)) r.sensitiveSuggested = true
      return r
    }

    // includeDeleted（P1 回收站）：缺省排除软删除；传 true 时 deleted 笔记一并返回（回收站列表数据源，slim 携带 deleted 标记）
    async function _list(tag, kind, folder, includeDeleted) {
      try {
        // 首次启动的一次性迁移（开发版 notes → ~/.dsh/notes）可能与首个 RPC 竞态，这里等一下
        try { await migrationDone } catch (e) {}
        const dirTarget = await fs.resolve(NOTES_DIR)
        const info = await fs.stat(dirTarget)
        if (!info) return []
        // 仅在按文件夹过滤时读清单（无过滤调用保持零额外磁盘读）
        const folders = folder !== undefined ? await loadFolders() : null
        const entries = await fs.listDir(dirTarget)
        const notes = []
        for (const entry of entries) {
          if (!entry.name || !entry.name.endsWith('.md')) continue
          const id = entry.name.replace(/\.md$/, '')
          try {
            const note = await loadNote(id)
            if (note.tombstoned) continue   // purge 墓碑（0 字节占位）：任何列表口径都不算存在
            if (note.deleted && !includeDeleted) continue
            if (tag && (note.tags || []).indexOf(tag) < 0) continue
            if (kind && note.kind !== kind) continue
            if (folder !== undefined && effectiveFolder(note, folders) !== folder) continue
            notes.push(note)
          } catch (e) { console.error('notes: read failed', entry.name, e) }
        }
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

    async function _update(id, title, body, tags, topic, kind, status, inject, injectTo, folder, recall, injectRole, sensitive) {
      const note = Object.assign({}, await loadNote(id))
      if (note.deleted || note.tombstoned) throw new Error('Note has been deleted')
      if (title !== undefined) note.title = title
      if (topic !== undefined) note.topic = topic
      if (tags !== undefined) note.tags = tags
      if (kind !== undefined) note.kind = kind
      if (status !== undefined) note.status = status
      if (inject !== undefined) note.inject = inject === true
      if (injectTo !== undefined) note.injectTo = injectTo
      if (folder !== undefined) note.folder = folder
      if (recall !== undefined) note.recall = recall !== false
      if (injectRole !== undefined) note.injectRole = injectRole === 'reference' ? 'reference' : 'convention'
      // sensitive 第 13 位参数：显式传才改（undefined 不动存量值）
      if (sensitive !== undefined) note.sensitive = sensitive === true
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
      return { id, kind: note.kind, status: note.status, dispatchClosed: dispatchClosed }
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
        let out = ''
        for await (const chunk of llm.stream({
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
        })) {
          if (chunk && chunk.type === 'text-delta') out += chunk.text
          if (chunk && chunk.type === 'finish') break
        }
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
        let out = ''
        for await (const chunk of llm.stream({
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
        })) {
          if (chunk && chunk.type === 'text-delta') out += chunk.text
          if (chunk && chunk.type === 'finish') break
        }
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
      cache.delete(id)
      return { id: id, purged: true, mode: mode }
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
        sensitive: members.some(n => n.sensitive === true)
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
      const text = '【笔记插件 · 派发的待办上下文】\n\n【待办】' + (note.title || 'Untitled') + '\n' + String(note.body || note.title || '').trim() + (instruction ? '\n\n【派发方补充的要求】\n' + instruction : '') + '\n\n—— 以上是笔记插件派发给你的待办上下文（recall）。请获取此上下文并开始处理。完成后请调用 note_manage（action: \'update\', id: \'' + note.id + '\', status: \'resolved\'）了结该笔记，系统会自动回执派发状态（dispatchStatus→done）。'
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
    // _list 走内存缓存（二次起零磁盘读）；idle 每轮次至多一次，开销可忽略
    async function _receiptDispatchesForSession(sid) {
      const all = await _list()
      for (const n of all) {
        if (!n || n.deleted || n.tombstoned) continue
        if (!(n.dispatches || []).length) continue
        if (_closeOpenDispatches(n, 'idle', sid) > 0) {
          n.updatedAt = new Date().toISOString()
          try { await persistNote(n) } catch (e) { console.error('notes: dispatch receipt persist failed', n.id, e) }
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

    async function _search(query, tag, topic, kind, folder) {
      const all = await _list(undefined, undefined, folder)
      const q = query ? String(query).toLowerCase() : ''
      return all.filter(n => {
        if (tag && (n.tags || []).indexOf(tag) < 0) return false
        if (topic && n.topic !== topic) return false
        if (kind && n.kind !== kind) return false
        if (q) {
          const hay = ((n.title || '') + ' ' + (n.body || '') + ' ' + (n.topic || '') + ' ' + (n.tags || []).join(' ')).toLowerCase()
          if (hay.indexOf(q) < 0) return false
        }
        return true
      })
    }

    // ---- 导入/导出：全库目录快照（目录即格式，零新依赖；settings.json 与 *.md.bak 不进出）----
    // 与 host-impl.js 同逻辑同步维护：仅路径拼接换为 path.join（ESM 静态包惯例）
    // 时间戳目录后缀：yyyyMMdd-HHmmss（本地时间），导出/备份目录共用
    function tsStamp(d) {
      const p = (n) => String(n).padStart(2, '0')
      return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
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

    // 读指定目录的 folders.json（导入预览/合并共用）：缺失/损坏/结构非法 → []（与 loadFolders 同一容错口径）
    async function readFoldersFile(dir) {
      try {
        const ft = await fs.resolve(path.join(dir, 'folders.json'))
        const arr = JSON.parse(await fs.readText(ft))
        if (!Array.isArray(arr)) return []
        return arr.filter(f => f && f.id).map(f => ({ id: String(f.id), name: String(f.name || ''), order: typeof f.order === 'number' ? f.order : 0 }))
      } catch (e) { return [] }
    }

    // 复制 NOTES_DIR 全部 n-*.md + folders.json + assets/ 到目标目录（导出与导入前全量备份共用）；
    // writeText 原子写会递归创建父目录，目标目录不存在时随首个文件写入自动建好；
    // 无 assets/ 的旧库：listAssets 返回 []，assets=0，零回归
    async function copyNotesDir(targetDir) {
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
      return { copied, foldersFile, assets }
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
    // 快照含 n-*.md + folders.json + assets/（图片资产连带；无 assets 的旧库 assets=0）
    async function _export(dir) {
      const d = String(dir || '').trim().replace(/[\\/]+$/, '')
      if (!d) return { error: 'notes-export 需要 dir（目标目录）' }
      const info = await fs.stat(await fs.resolve(d))
      if (info && !(info.dir || info.type === 'directory')) return { error: '目标路径不是目录：' + d }
      const target = path.join(d, 'dsh-notes-export-' + tsStamp(new Date()))
      const r = await copyNotesDir(target)
      return { exported: r.copied, foldersFile: r.foldersFile, assets: r.assets, target: target }
    }

    // notes-export-single（P3 单文件导出，拼接/分享用）：scope 内笔记拼接为一篇自包含 Markdown
    // → <dir>/dsh-notes-export-single-<ts>.md。args={dir, scope:{all?|folder?|tag?}, format:'md', toc?}：
    //   scope.tag 按标签 / scope.folder 按文件夹（id 或名称，resolveFolderRef 兼容）/ 缺省全部；过滤与 _list 同口径（排除软删除，pinned 优先 + updatedAt 降序）。
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
    async function _import(dir, overwrite) {
      const chk = await checkImportDir(dir)
      if (chk.error) return { error: 'notes-import ' + chk.error }
      const backupDir = path.join(NOTES_DIR, 'notes-backup-' + tsStamp(new Date()))
      await copyNotesDir(backupDir)
      const scan = await scanImportDir(chk.dir)
      let imported = 0, skippedSame = 0, skippedDiff = 0, overwritten = 0
      for (const n of scan.notes) {
        const cur = await readLibraryRaw(n.id)
        if (cur === n.content) { skippedSame++; continue }
        if (cur !== null && !overwrite) { skippedDiff++; continue }
        try {
          await fs.writeText(await fs.resolve(noteFile(n.id)), n.content, undefined, undefined, getPolicy())
          // 同步内存缓存（约定/目录注入直接读 cache）：按导入内容重建解析结果
          const note = noteFromParsed(n.id, parseFM(n.content))
          cache.set(note.id, note)
          if (cur === null) imported++; else overwritten++
        } catch (e) { console.error('notes: import failed', n.id, e) }
      }
      // folders.json 合并：清单外的文件夹 id 追加到尾部（order 续排），已存在的不动
      let foldersMerged = 0
      if (scan.folders.length) {
        const curFolders = await loadFolders()
        const known = {}
        for (const f of curFolders) known[f.id] = true
        let maxOrder = curFolders.reduce((m, f) => Math.max(m, f.order), -1)
        for (const f of scan.folders.slice().sort((x, y) => x.order - y.order)) {
          if (known[f.id]) continue
          maxOrder++
          curFolders.push({ id: f.id, name: f.name, order: maxOrder })
          foldersMerged++
        }
        if (foldersMerged) await saveFolders(curFolders)
      }
      // assets/ 合并：同名跳过，只增不改（备份已在上面 copyNotesDir 里含库内 assets）
      const assetsMerged = await copyAssetsDir(chk.dir, NOTES_DIR, true)
      return { imported: imported, skippedSame: skippedSame, skippedDiff: skippedDiff, overwritten: overwritten, foldersMerged: foldersMerged, assetsMerged: assetsMerged, backupDir: backupDir, unreadable: scan.unreadable }
    }

    // 约定命中判定（约定注入 conventionText 与目录去重 catalogText 共用）：
    // 注入范围 injectTo 是多选数组（不再有「工作区」维度——笔记无归属，只看会话）：
    //   []（空）                  → 默认所有会话
    //   含 'global' / 'workspace' → 存量值容错：同样视为所有会话（不迁移、不保留工作区过滤）
    //   含会话短 id               → 仅注入这些会话（可多选多个会话）
    // ws 形参保留（调用点不变）但不再用于过滤。
    function conventionHit(n, ws, curSid) {
      const targets = n.injectTo || []
      if (targets.length === 0) return true
      for (const t of targets) {
        if (t === 'global' || t === 'workspace') return true
        if (t === curSid) return true
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
    function conventionText() {
      const shortSid = (x) => x ? String(x).replace(/^session-/, '').slice(0, 8) : ''
      try {
        let cwd = ''
        let sid = ''
        const a = agents && agents.currentInitiator ? agents.currentInitiator() : undefined
        if (a) {
          cwd = (a.session && a.session.header && a.session.header.cwd) || ''
          sid = a.sessionId || (a.session && a.session.id) || ''
        }
        const ws = basename(cwd)
        const curSid = shortSid(sid)
        const matches = []
        for (const n of cache.values()) {
          if (n.deleted) continue
          if (n.inject !== true) continue
          if (conventionHit(n, ws, curSid)) matches.push(n)
        }
        if (matches.length === 0) { lastInjectChars = 0; return '' }
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
        lastInjectChars = full.length   // 注入体积缓存：每次渲染更新（设置卡片仪表数据源）
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
    const CATALOG_KIND_LABELS = { note: '笔记', decision: '决策', todo: '待办', link: '链接', quote: '引用' }
    function catalogText() {
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
        const curSid = shortSid(sid)
        const pool = []
        for (const n of cache.values()) {
          if (n.deleted) continue
          if (n.status === 'resolved' || n.status === 'superseded') continue   // 已了结的笔记不进目录
          if (n.recall === false) continue                                     // recall=false 逐条关闭
          if (n.inject === true && conventionHit(n, ws, curSid)) continue      // 约定注入去重（全文已在 order 130）
          pool.push(n)
        }
        if (pool.length === 0) return ''
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
        const lines = shown.map(n => {
          const kl = CATALOG_KIND_LABELS[n.kind] || CATALOG_KIND_LABELS.note
          let title = String(n.title || 'Untitled').replace(/[\r\n]+/g, ' ')   // 一行一条：标题换行收拢
          let mark = ''
          if (n.sensitive === true) { maskedCount++; title = maskSensitiveLine(title, n.id); mark = '🔒 ' }
          let line = '- [' + n.id + '] ' + mark + title + ' (' + kl + ', ' + (n.topic || '未分类') + ')'
          const sd = staleDaysOf(n.updatedAt, (n.kind === 'note' || n.kind === 'link') ? staleLimit : 0)
          if (sd > 0) line += ' ⚠ ' + sd + ' 天未更新'
          return line
        })
        if (pool.length > CATALOG_LIMIT) lines.push('…另有 ' + (pool.length - CATALOG_LIMIT) + ' 条较早笔记，用 note_search 检索')
        if (maskedCount > 0) lines.push('（其中 ' + maskedCount + ' 条含敏感信息已脱敏，原文用 note_get 按 id 获取）')
        return '本地笔记库目录（与本任务相关时用 note_get 拉全文，更多用 note_search）：\n' +
          lines.join('\n') +
          '\n规划任务前，若目录中有相关笔记（尤其待办/决策），建议先 note_get 读取再动手'
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
    disposers.push(handle('notes-list', async (args) => ({ notes: (await _list(args && args.tag, args && args.kind, args && args.folder, !!(args && args.includeDeleted))).map(slim) })))
    // 虚拟文件夹清单/管理：无参=列表（含计数），args={op:'create'|'rename'|'delete'|'reorder', ...}
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
          ? [path.join(LEGACY_PLUGIN_DIR, 'client-impl.js'), path.join(PKG_DIR, 'lib', 'client.js')]
          : [path.join(LEGACY_PLUGIN_DIR, 'host-impl.js'), path.join(PKG_DIR, 'index.mjs')]
        for (const p of candidates) {
          try { if (fsNode.existsSync(p)) return { src: fsNode.readFileSync(p, 'utf8') } } catch (e) {}
        }
        throw new Error(which + ' source not found in: ' + candidates.join(' | '))
      } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-get', async (args) => {
      try { const n = await _get(args.id); const s = slim(n); s.body = n.body; return { note: s } } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-create', async (args) => {
      try { return await _create(args.title, args.body, args.tags, args.topic, { kind: args.kind, status: args.status, inject: args.inject, injectRole: args.injectRole, injectTo: args.injectTo, folder: args.folder, recall: args.recall, sensitive: args.sensitive }) } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-update', async (args) => {
      try { return await _update(args.id, args.title, args.body, args.tags, args.topic, args.kind, args.status, args.inject, args.injectTo, args.folder, args.recall, args.injectRole, args.sensitive) } catch (e) { return { error: String(e.message || e) } }
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
    disposers.push(handle('notes-search', async (args) => {
      try { return { notes: (await _search(args && args.query, args && args.tag, args && args.topic, args && args.kind, args && args.folder)).map(slim) } } catch (e) { return { error: String(e.message || e) } }
    }))
    // 上下文注入（双角色分桶）：注册动态 prompt context（order 130，位于 policy/delegation 之后）
    // 笔记目录索引注入（recall 通道）：order 131 紧邻上下文注入之后；text 同步返回 string，无内容/总开关关闭返回 ''
    if (systemPrompt && typeof systemPrompt.context === 'function') {
      disposers.push(systemPrompt.context({ name: 'notes:workspace-conventions', order: 130, text: () => conventionText() }))
      disposers.push(systemPrompt.context({ name: 'notes:catalog', order: 131, text: () => catalogText() }))
    }
    // 调试 RPC：预览当前会话将注入的上下文笔记文本（双角色分桶新文案，E2E 验证用）
    disposers.push(handle('notes-conventions', async () => ({ text: conventionText() || '' })))
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
        await saveSettings()
        return { ok: true, settings: settingsCache }
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // 全库导出（目录快照）：args={dir} → <dir>/dsh-notes-export-<ts>/，返回 { exported, foldersFile, target }
    disposers.push(handle('notes-export', async (args) => {
      try { return await _export(args && args.dir) } catch (e) { return { error: String(e.message || e) } }
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
    // 导入执行：先全量备份（notes-backup-<ts>），added 入库 / diff 默认跳过（overwrite=true 覆盖）/ folders.json 合并只增不删 / assets 合并同名跳过
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
      description: 'Search local notes by free-text query (matches title/body/topic/tags), with optional tag, topic, kind, and folder filters. Returns slim notes (no body) for fast triage — call note_get for the full body of a specific id. Tip: when planning a task, picking an approach, or making decisions, consider searching this notes library first for related decisions, todos, and context recorded in earlier sessions — it may already contain the conclusions you need.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text query against title, body, topic, and tags. Omit to list all (optionally filtered by tag/topic/kind/folder).' },
          tag: { type: 'string', description: 'Optional tag filter (exact match)' },
          topic: { type: 'string', description: 'Optional topic filter (exact match)' },
          kind: { type: 'string', enum: KINDS, description: 'Optional kind filter: note/decision/todo/link/quote' },
          folder: { type: 'string', description: 'Optional folder filter: folder id or exact folder name; empty string = unfiled notes (未分类)' },
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
        const all = await _search(args && args.query, args && args.tag, args && args.topic, args && args.kind, folder)
        const limit = (args && args.limit) || 50
        return { count: all.length, notes: all.slice(0, limit).map(slim) }
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
        'Fields kind (what it is) and status (its lifecycle) are orthogonal: kind ∈ note/decision/todo/link/quote (default note); status ∈ active/pinned/resolved/superseded (default active).\n' +
        'inject (boolean) controls whether the note is injected into the system prompt as context — an explicit field, NOT a tag. injectRole ("convention"|"reference", default "convention") picks the injection bucket: convention = user rules to follow; reference = background facts to consult only when relevant to the current task. Rule of thumb — infer from kind: decision/todo → convention, note/link/quote → reference. injectTo (string[]) is the injection scope, a multi-select list: [] or omitted=all sessions (default), or session short-ids like ["99f2b674","7f8b49e6"] to restrict the scope.\n\n' +
        'recall (boolean) controls whether the note appears in the notes catalog — a one-line-per-note index injected into the system prompt (right after conventions) so you know what the library holds without searching; default true. Set false to hide a note from the catalog (it stays searchable via note_search). Orthogonal to inject; notes with status resolved/superseded never appear in the catalog.\n\n' +
        'sensitive (boolean) marks the note as containing secrets (passwords/tokens/keys); default false. When true, injected text (conventions/catalog) masks secret-looking lines — keys and structure are kept, only values are hidden as ******（敏感，note_get <id> 获取）— so agents must call note_get for the original. Create/quick responses may return sensitiveSuggested: true when the body matches secret patterns; quick-capture notes are auto-flagged sensitive instead.\n\n' +
        'folder (string) assigns a note to a virtual folder: pass a folder id or an exact folder name; "" or omitted = unfiled (未分类). Folders (name/order) are managed via the notes-folders RPC (list/create/rename/delete/reorder).\n\n' +
        'Actions:\n' +
        '- create: { title, body, topic?, tags?, kind?, status?, inject?, injectRole?, injectTo?, recall?, sensitive?, folder?, sessionId?, cwd?, workspace? }\n' +
        '- list: { tag?, topic?, kind?, folder? } (no id/title/body needed)\n' +
        '- update: { id, title?, body?, topic?, tags?, kind?, status?, inject?, injectRole?, injectTo?, recall?, sensitive? } (setting status to "resolved" auto-closes the dispatch loop: all open entries in the note\'s dispatches are marked dispatchStatus=done with doneAt — use this to report completion of a dispatched todo)\n' +
        '- move: { id, folder } (move note into a virtual folder; folder = folder id or exact folder name, "" = move out to unfiled)\n' +
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
          kind: { type: 'string', enum: KINDS, description: 'Kind (create/update): note/decision/todo/link/quote; default note' },
          status: { type: 'string', enum: STATUSES, description: 'Status (create/update): active/pinned/resolved/superseded; default active' },
          inject: { type: 'boolean', description: 'Inject into system prompt as context (create/update); default false' },
          injectRole: { type: 'string', enum: ['convention', 'reference'], description: 'Injection role: convention=rules to follow | reference=background facts to consult as needed; default convention' },
          injectTo: { type: 'array', items: { type: 'string' }, description: 'Injection scope multi-select: [] or omitted=all sessions (default), or session short-ids like ["99f2b674","7f8b49e6"] to restrict' },
          recall: { type: 'boolean', description: 'Recall in the notes catalog index (create/update); default true. Set false to hide from the catalog (still searchable via note_search).' },
          sensitive: { type: 'boolean', description: 'Sensitive-content flag (create/update); default false. When true, injected text masks secret-looking lines (keys kept, values hidden as ******（敏感，note_get <id> 获取）); agents call note_get for the original.' },
          folder: { type: 'string', description: 'Virtual folder (create/move/list filter): folder id or exact folder name; "" = unfiled (未分类)' },
          // archive 字段（显式归档白名单）
          groups: { type: 'array', items: { type: 'object', properties: { memberIds: { type: 'array', items: { type: 'string' } }, title: { type: 'string' } }, required: ['memberIds'] }, description: 'Archive whitelist (archive action only): [{memberIds:[noteId,...], title?}] — merge exactly these groups. Omitted = merge only quick-capture groups; manual notes are NEVER auto-grouped by tag (behavior change).' },
          // dispatch 字段
          targetSessionId: { type: 'string', description: 'Dispatch target: a live session id (dispatch). Omit to list live sessions.' },
          targetSessionName: { type: 'string', description: 'Dispatch target display name (dispatch, optional)' },
          instruction: { type: 'string', description: 'Dispatch: your concrete instruction appended to the todo context (dispatch, optional)' },
          // list 字段
          tag: { type: 'string', description: 'Tag filter (list only)' },
          // 高级（通常自动填充）
          sessionId: { type: 'string', description: 'Session id (advanced; usually auto-filled)' },
          cwd: { type: 'string', description: 'Working dir (advanced; usually auto-filled)' },
          workspace: { type: 'string', description: 'Workspace name (advanced; usually auto-filled)' }
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
              folder: folder, recall: args.recall, sensitive: args.sensitive
            })
            const out = { action: 'create', id: r.id, topic: r.topic, kind: r.kind, status: r.status, message: 'Note created' }
            // 敏感模式自动识别建议透传（create 不强制落 sensitive，由调用方决策）
            if (r.sensitiveSuggested) { out.sensitiveSuggested = true; out.message += '（检测到疑似敏感信息，建议 sensitive: true 开启注入脱敏）' }
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
            const notes = await _list(args.tag, args.kind, folder)
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
            return { action: 'update', id: args.id, kind: r.kind, status: r.status, dispatchClosed: r.dispatchClosed || 0, message: 'Note updated' + (r.dispatchClosed ? '；已自动回执 ' + r.dispatchClosed + ' 条派发（dispatchStatus→done）' : '') }
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
    })
    // 发布版不再写 .last-host-load 开发心跳（静态包 import 即就绪，无需引导壳自检）
    console.log('notes plugin: host ready (static pkg), notes dir =', NOTES_ROOT, ', llm =', !!llm, ', adm =', !!adm, ', rpc =', RPC_PATH, ', app =', APP_PAGE_ROUTE, ', asset =', ASSET_ROUTE)
}
