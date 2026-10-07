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
    // 0.4.4-B：定时派发专属会话创建需挂载默认 preset（工具能力来源）；软依赖 ctx.get + 守卫降级（缺失时专属会话创建报 lastError，主服务不受影响）
    const agentPresets = ctx.get('agentPresets')
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

    // schedule 调度声明（定时派发·执行层）：对象，front-matter 里以 JSON 字符串存储（同 dispatches 先例）；
    // 非法 JSON / 非对象 / 数组 → null（解析失败安全态：不识别为调度笔记，绝不误触发）
    function parseSchedule(s) {
      if (!s) return null
      try { const d = JSON.parse(s); return (d && typeof d === 'object' && !Array.isArray(d)) ? d : null } catch (e) { return null }
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
    // 策略：注入渲染（renderInjected 合并目录段，0.4.3③）时对 sensitive=true 笔记的正文按行打码——保留键名与结构、只遮值；
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
        // recall 字段写侧退役（0.4.5-A notes-045-debt-host，0.4.4-E 遗留裁决落地）：buildFM 不再写此行——
        //   新笔记无此字段；存量文件该行保留无害、parseFM/noteFromParsed 解析保留（读写兼容红线：存量零迁移零删除）、
        //   字段随下次真实保存自然脱落；note_manage schema 入参保留（deprecated，见工具描述）
        // sensitive 恒写（true/false 显式落盘，缺省 false）：敏感笔记注入时正文按行打码
        'sensitive: ' + escYaml(m.sensitive === true ? 'true' : 'false') + '\n' +
        // hidden 条件行（0.4.4-D hidden 隐藏属性，OS 文件管理对齐：纯 UI 遮罩标记——面板显隐开关关时滤除、开时半透明渲染；
        //   仅 true 落盘（缺省 false 存量零迁移）；host _list/_search/notes-get/note_manage 语义零改动——遮罩全在 client/app 渲染层）
        (m.hidden === true ? 'hidden: true\n' : '') +
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
        // contractType 条件行（工作记忆 v0 r3 车道模型·契约分型：memory-guide 引导笔记的结构化身份标记——op=status/disable 主识别键，
        // tag memory-guide 保留为兼容发现键；普通笔记不落此行，存量零迁移）
        (m.contractType ? 'contractType: ' + escYaml(m.contractType) + '\n' : '') +
        // origin 条件行（工作记忆 v0 r3 车道模型·产物溯源：memory-guide 引导激活期间产生的沉淀日志落 origin=memory-guide；
        // 可选轻字段本期只落数据，详情区展示另期）
        (m.origin ? 'origin: ' + escYaml(m.origin) + '\n' : '') +
        // refNote 条件行（0.4.3⑥ 效用账本：记忆档案笔记 → 被引用记忆 id 的结构化软链，notes-ledger 懒创建回写；
        // 普通笔记不落此行，存量零迁移）
        (m.refNote ? 'refNote: ' + escYaml(m.refNote) + '\n' : '') +
        // runLog 条件行（0.4.4-A 派发回执笔记化·三表归一：「执行记录」伴生笔记软链——调度约定笔记存 schedule.runLog
        // （存量口径不动），非调度派发源笔记存本顶层 runLog 字段；普通笔记不落此行，存量零迁移）
        (m.runLog ? 'runLog: ' + escYaml(m.runLog) + '\n' : '') +
        // schedule 条件行（定时派发·执行层：contractType=dispatch-schedule 约定笔记的调度声明 + 机器状态——
        // 声明 {at|every, target, action, enabled} + 状态 {lastFiredAt, lastRun{at,status,receiptId}, lastError, declaredAt(0.4.6-F 声明重锚)}；
        // JSON 单行存储同 dispatches 先例；普通笔记不落此行，存量零迁移）
        (m.schedule ? 'schedule: ' + escYaml(JSON.stringify(m.schedule)) + '\n' : '') +
        'dispatches: ' + escYaml(JSON.stringify(m.dispatches || [])) + '\n' +
        // useCount 字段退役（0.4.3 验收修复⑧ notes-043-stats-unify）：统计收编 telemetry.json facets.use 单一事实源，不再写此行——
        //   新笔记无此字段；存量文件字段保留无害、下次真实保存自然脱落；parseFM 仍读旧值仅作 facet seed（_useFacetSync，兼容）
        'archivedAt: ' + escYaml(m.archivedAt || '') + '\n' +
        'deleted: ' + escYaml(m.deleted || 'false') + '\n' +
        // 闭合分隔符固定单换行收尾、不多写空行（notes-043-fm-newline）：与 parseFM「吃掉闭合 --- 后全部连续前导换行」
        //   配对，保证 读盘→写盘 往返幂等（旧口径 '---\n\n' + 只吃一个 \n 曾致正文前导换行每轮 +1 无上界递增）
        '---\n'
    }

    function parseFM(content) {
      const meta = {}
      let body = content
      // 闭合 --- 后吃掉全部连续前导换行：front-matter 与正文间的空行属分隔符填充、不属正文语义——
      //   旧格式（'---\n\n' 收尾）及缺陷累积的多空行存量文件首轮读入即归一，回写后稳定零增长（不做全库迁移）；
      //   只作用于最前缘，正文内部空行不受影响。canonical 口径：正文不再以前导空行开头。
      const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)*([\s\S]*)$/)
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
    // 通用结构：设置项是 settingsCache 的顶层键（llm 选配 + staleDays 过期候选阈值 + injectBudgetChars 注入预算 + maxFolderDepth 文件夹嵌套深度上限），client 经 notes-settings-get/set 读写。
    // 0.4.4-E：catalogEnabled 目录补充行总开关随功能整体拆除退役——存量 settings.json 残留键保留不迁移（惰性死键，settings-set 分支删除后无人读）。
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
    // ---- P1 注入增强：时效阈值 + 注入体积预算（settings.json 顶层键，null 删除 override 恢复缺省）----
    // staleDays：过期候选提名阈值（天），缺省 90；0 = 关闭。
    // （0.4.4-E：⚠ 注入标注呈现面 = 目录普通行，随 catalog 拆除退役；现存唯一消费方 = 整理建议器 suggestCandidates
    //   过期未引用提名（memory.js）——本键保留服务该口径：读写兼容、存量不迁移）
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
    // ==== telemetry-store BEGIN ====（0.4.3 验收修复⑤：机器存储层——召回遥测迁 telemetry.json，notes-043-metrics-storage。
    // 背景（用户定案三层分离）：①载荷层 = 注入索引正文（纯人/LLM 策展，零元数据）；②机器存储层 = 本模块（notes/telemetry.json）；
    //   ③注入呈现层（卡⑥装配增强）。遥测从「召回遥测（自动）」笔记正文迁出——search/get 热路径每次 body 全量重写 + 文本行解析
    //   是代码读写障碍；笔记只当视图（存量遥测笔记降级人读镜像，见 recall.js _recallMirrorRefresh），不当存储（排版/热路径/编辑权/污染面四冲突）。
    // 文件：NOTES_DIR/telemetry.json（.json 不进笔记列表天然隐身——_list 只认 .md；与 settings.json 分离防写放大，同 usage.json 先例）。
    //   结构：{ version:1, receipts:{ inject:[{ts,ids[],session?}≤200], mount:[...], catalog:[...] },
    //           byDay:{ search:{日期:{id:count}}, get:{...} }, facets:{ use:{id:总计数} }, ledger:{账本快照}?, meta:{ lastFlush, migratedAt?, migratedFrom? } }
    //   facets.use（0.4.3 验收修复⑧ notes-043-stats-unify）：笔记使用计数 facet——useCount 唯一事实源（按 id 累计总数，
    //     与 byDay 分离：90 天剪枝/体积护栏摘桶不动总计）；front-matter useCount 字段退役（不再写入，存量旧值仅作 seed 并入）。
    // 四纪律：①内存增量 + 2s 防抖原子落盘（fs.writeText 底层 writeFileAtomic 自带原子——崩溃只留完整旧版/完整新版；
    //     崩溃丢 ≤2s 内存增量可容忍，计数是下界语义）；
    //   ②汇总纯函数现算不落盘（recall.js _recallComputeStats 读内存权威现算；ledger 快照是刷新语义产物而非聚合，不占遥测流水面）；
    //   ③容量三闸：receipts 每通道 ≤TELEMETRY_RECEIPT_MAX 裁尾（保最新）、byDay >TELEMETRY_BYDAY_KEEP_DAYS 天剪枝、
    //     单文件体积护栏 TELEMETRY_MAX_BYTES（先裁 receipts 再逐日摘最旧 byDay 桶；facets.use 总计数语义不可裁，不在摘桶面内）；
    //   ④读失败 = 空桶重建、写失败 = 内存续用（dirty 保持，下次防抖/flush 重试；全程静默降级，遥测永不阻塞主流程）。
    // 一致性三定案（注释与节 78 断言双锁）：单写者——唯一写入方 = host 进程本模块（client/app 只经 RPC 读，构造性无双写）；
    //   先渲染后记账——inject/catalog 埋点在 renderInjected 渲染完成后调用（自排除，计数不虚高）；
    //   单调性——计数只增（保留窗口内）为下界语义（崩溃窗口与导入合并取大都守住「不少计」）。
    // 序位：紧随 kernel/settings-store.js（同 JSON sidecar 先例）；消费方 recall.js/ledger.js/transfer.js 全部运行时引用（函数声明提升，无 TDZ）。
    // 变体说明：TELEMETRY_PATH 常量在开发版由 telemetry-store.js 定义（NOTES_DIR 拼接），发布版由 head.js 定义（path.join(NOTES_ROOT,...)）——
    //   双包差异仅此一处，telemetry-store.dist.js 与本文档其余部分逐字节一致（节 78 看守）。
    const TELEMETRY_VERSION = 1
    const TELEMETRY_FLUSH_MS = 2000                  // 纪律①：内存增量 + 2s 防抖原子落盘（崩溃丢 ≤2s 计数可容忍）
    const TELEMETRY_RECEIPT_MAX = 200                // 纪律③闸一：receipts 每通道裁尾上限（保最新裁最旧）
    const TELEMETRY_BYDAY_KEEP_DAYS = 90             // 纪律③闸二：日聚合保留窗口（天）
    const TELEMETRY_MAX_BYTES = 256 * 1024           // 纪律③闸三：单文件体积护栏
    const TELEMETRY_RECEIPT_CHANNELS = ['inject', 'mount', 'catalog']
    const TELEMETRY_BYDAY_CHANNELS = ['search', 'get']
    // 内存权威（读路径 stats 现算的唯一数据源；跨 apply 由磁盘恢复）
    let _telemetryCache = null
    let _telemetryLoadPromise = null
    let _telemetryDirty = false
    let _telemetryFlushTimer = null
    let _telemetryFlushChain = Promise.resolve()     // 写盘单链串行化（flush/import 合并不交错；单写者进程内串行）
    // 本地日键（YYYY-MM-DD，byDay 粒度；本地墙钟语义与 ledger 日志归键同口径）
    function _telemetryDay(ms) {
      const d = ms === undefined ? new Date() : new Date(ms)
      const p = function (n) { return (n < 10 ? '0' : '') + n }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    }
    function _telemetryEmpty() {
      return { version: TELEMETRY_VERSION, receipts: { inject: [], mount: [], catalog: [] }, byDay: { search: {}, get: {} }, facets: { use: {} }, meta: {} }
    }
    // 读入归一：缺键补齐/坏桶自愈（receipts 非数组→空、byDay 计数非法→剔除）；未知顶层键保留（前向兼容，导入合并/未来版本字段不丢）
    function _telemetryNormalize(obj) {
      const t = (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {}
      if (typeof t.version !== 'number' || !isFinite(t.version) || t.version < 1) t.version = TELEMETRY_VERSION
      if (!t.receipts || typeof t.receipts !== 'object') t.receipts = {}
      for (const ch of TELEMETRY_RECEIPT_CHANNELS) {
        const arr = Array.isArray(t.receipts[ch]) ? t.receipts[ch] : []
        t.receipts[ch] = arr.filter(function (r) { return r && typeof r === 'object' && r.ts && Array.isArray(r.ids) && r.ids.length })
      }
      if (!t.byDay || typeof t.byDay !== 'object') t.byDay = {}
      for (const ch of TELEMETRY_BYDAY_CHANNELS) {
        const days = (t.byDay[ch] && typeof t.byDay[ch] === 'object') ? t.byDay[ch] : {}
        const out = {}
        for (const d of Object.keys(days)) {
          const bucket = days[d]
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !bucket || typeof bucket !== 'object') continue
          const b2 = {}
          for (const id of Object.keys(bucket)) {
            const v = Math.max(0, Math.floor(Number(bucket[id]) || 0))
            if (v > 0) b2[String(id)] = v
          }
          if (Object.keys(b2).length) out[d] = b2
        }
        t.byDay[ch] = out
      }
      // facets.use 归一（note-stats facet，0.4.3 验收修复⑧）：非对象 → 空桶、计数非法（≤0/非数）剔除；
      //   facets 未知子键保留（前向兼容，未来 facet 种类不丢）；总计数不参与 byDay 剪枝/裁尾（单调性红线）
      if (!t.facets || typeof t.facets !== 'object' || Array.isArray(t.facets)) t.facets = {}
      const useRaw = (t.facets.use && typeof t.facets.use === 'object' && !Array.isArray(t.facets.use)) ? t.facets.use : {}
      const useOut = {}
      for (const uid of Object.keys(useRaw)) {
        const uv = Math.max(0, Math.floor(Number(useRaw[uid]) || 0))
        if (uv > 0) useOut[String(uid)] = uv
      }
      t.facets.use = useOut
      if (!t.meta || typeof t.meta !== 'object') t.meta = {}
      return t
    }
    // 启动加载（memoized 单飞）：文件坏/不存在 → 空桶重建（纪律④）；全程静默，不抛错
    function _telemetryLoad() {
      if (!_telemetryLoadPromise) {
        _telemetryLoadPromise = (async () => {
          try {
            const p = await fs.resolve(TELEMETRY_PATH)
            _telemetryCache = _telemetryNormalize(JSON.parse(await fs.readText(p)))
          } catch (e) { _telemetryCache = _telemetryEmpty() }
          return _telemetryCache
        })()
      }
      return _telemetryLoadPromise
    }
    // 防抖调度（纪律①）：脏标记 + 2s 定时器（已挂不重复；unref 不阻塞进程退出）
    function _telemetryScheduleFlush() {
      _telemetryDirty = true
      if (_telemetryFlushTimer) return
      _telemetryFlushTimer = setTimeout(function () { _telemetryFlushTimer = null; _telemetryFlushNow() }, TELEMETRY_FLUSH_MS)
      if (_telemetryFlushTimer && typeof _telemetryFlushTimer.unref === 'function') _telemetryFlushTimer.unref()
    }
    // 容量三闸（纪律③）：receipts 裁尾 → byDay 窗口剪枝 → 体积护栏（先 receipts 收紧到 100，再逐日摘最旧 byDay 桶直至达标）
    function _telemetryPrune(t, nowMs) {
      for (const ch of TELEMETRY_RECEIPT_CHANNELS) {
        if (t.receipts[ch].length > TELEMETRY_RECEIPT_MAX) t.receipts[ch] = t.receipts[ch].slice(-TELEMETRY_RECEIPT_MAX)
      }
      const cutoff = _telemetryDay(nowMs - TELEMETRY_BYDAY_KEEP_DAYS * 86400000)
      for (const ch of TELEMETRY_BYDAY_CHANNELS) {
        const days = t.byDay[ch]
        for (const d of Object.keys(days)) { if (d < cutoff) delete days[d] }
      }
      if (JSON.stringify(t).length <= TELEMETRY_MAX_BYTES) return
      for (const ch of TELEMETRY_RECEIPT_CHANNELS) {
        if (t.receipts[ch].length > 100) t.receipts[ch] = t.receipts[ch].slice(-100)
      }
      let text = JSON.stringify(t)
      while (text.length > TELEMETRY_MAX_BYTES) {
        let oldest = null, oldestCh = null
        for (const ch of TELEMETRY_BYDAY_CHANNELS) {
          for (const d of Object.keys(t.byDay[ch])) { if (oldest === null || d < oldest) { oldest = d; oldestCh = ch } }
        }
        if (oldest === null) break
        delete t.byDay[oldestCh][oldest]
        text = JSON.stringify(t)
      }
    }
    // 落盘单点（纪律①④）：清防抖定时器（手动/卸载 flush 不二次触发）→ 链内串行（不交错）→ 剪枝/护栏 → 原子写。
    //   落盘格式 = compact JSON（机器存储，人读视图是镜像笔记）——体积护栏与落盘字节同口径（pretty 打印会放大失真）；
    //   非脏零写（空转幂等）；写失败 = 内存续用（dirty 保持，静默降级不扩散主流程）
    function _telemetryFlushNow() {
      try { if (_telemetryFlushTimer) { clearTimeout(_telemetryFlushTimer); _telemetryFlushTimer = null } } catch (e) {}
      const run = _telemetryFlushChain.then(async function () {
        const t = _telemetryCache
        if (!t || !_telemetryDirty) return
        _telemetryPrune(t, Date.now())
        t.meta.lastFlush = new Date().toISOString()
        try {
          const p = await fs.resolve(TELEMETRY_PATH)
          await fs.writeText(p, JSON.stringify(t), undefined, undefined, getPolicy())
          _telemetryDirty = false
        } catch (e) { /* 纪律④：写失败内存续用（dirty 保持待重试），静默不扩散 */ }
      })
      _telemetryFlushChain = run.then(function () {}, function () {})   // 失败不断链
      return run
    }
    // 低频通道原始回执追加（inject/mount/catalog）：内存 push（旧→新序）+ 裁尾保最新 + 防抖调度；未加载/坏通道静默丢弃
    function _telemetryAddReceipt(channel, row) {
      try {
        const t = _telemetryCache
        if (!t || TELEMETRY_RECEIPT_CHANNELS.indexOf(channel) < 0 || !row || !Array.isArray(row.ids) || !row.ids.length) return
        const r = { ts: String(row.ts || new Date().toISOString()), ids: row.ids.map(String) }
        if (row.session) r.session = String(row.session)
        t.receipts[channel].push(r)
        if (t.receipts[channel].length > TELEMETRY_RECEIPT_MAX) t.receipts[channel] = t.receipts[channel].slice(-TELEMETRY_RECEIPT_MAX)
        _telemetryScheduleFlush()
      } catch (e) {}
    }
    // 高频通道日聚合增量（search/get）：内存累加（同日同通道同 id 单调只增——下界语义）+ 防抖调度
    function _telemetryBumpDay(channel, day, id, n) {
      try {
        const t = _telemetryCache
        const v = Math.max(0, Math.floor(Number(n) || 0))
        if (!t || TELEMETRY_BYDAY_CHANNELS.indexOf(channel) < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(String(day)) || !id || !v) return
        const days = t.byDay[channel]
        const bucket = days[day] || (days[day] = {})
        const k = String(id)
        bucket[k] = (bucket[k] || 0) + v
        _telemetryScheduleFlush()
      } catch (e) {}
    }
    // ---- note-stats facet（0.4.3 验收修复⑧ notes-043-stats-unify）：facets.use = { id: totalCount } = useCount 唯一事实源 ----
    // 与 byDay.get 分工：byDay = 90 天窗口日明细视图（剪枝不动总计）；facets.use = 按 id 累计总数（不剪枝/不裁尾）。
    //   内存视图 n.useCount 由本 facet 供电（载入/创建/导入经 store-cache _useFacetSync 双向 max 合并；bump 双写视图+facet）——消费方读视图零改动。
    //   单调下界语义同三定案：只增/取大（崩溃窗口与导入合并取大都守住「不少计」）；落盘复用纪律① 2s 防抖通道（无独立定时器/无独立 flush）。
    // use facet 总计数 +1（自含加载——bumpUseCount 热路径 fire-and-forget 直调；静默降级不扩散主流程）
    async function _telemetryBumpUse(id) {
      try {
        await _telemetryLoad()
        const t = _telemetryCache
        if (!t || !id) return
        const k = String(id)
        t.facets.use[k] = Math.max(0, Math.floor(Number(t.facets.use[k]) || 0)) + 1
        _telemetryScheduleFlush()
      } catch (e) {}
    }
    // use facet 读取（调用方须已完成 _telemetryLoad；未加载/缺失/非法 → 0）
    function _telemetryUseOf(id) {
      try {
        const t = _telemetryCache
        if (!t || !id) return 0
        return Math.max(0, Math.floor(Number(t.facets.use[String(id)]) || 0))
      } catch (e) { return 0 }
    }
    // use facet 种子合并（max 合并幂等——旧 front-matter 字段/归档继承/导入并入；重放不双计）：
    //   仅在真正抬升时置脏并调度落盘（零变化零写，存量重读零放大）；返回合并后总计数（调用方须已完成 _telemetryLoad）
    function _telemetrySeedUse(id, count) {
      try {
        const t = _telemetryCache
        if (!t || !id) return 0
        const k = String(id)
        const cur = Math.max(0, Math.floor(Number(t.facets.use[k]) || 0))
        const v = Math.max(0, Math.floor(Number(count) || 0))
        if (v > cur) { t.facets.use[k] = v; _telemetryScheduleFlush(); return v }
        return cur
      } catch (e) { return 0 }
    }
    // 账本快照落存储层（0.4.3 验收修复⑤ ledger §2 数据源切换）：整体覆盖写（幂等——同快照重写零语义变化）+ 防抖调度；
    //   自含加载（账本刷新通道可能先于任何遥测事件触发）；静默降级
    async function _telemetrySetLedger(snap) {
      try {
        await _telemetryLoad()
        if (!_telemetryCache || !snap || typeof snap !== 'object') return
        _telemetryCache.ledger = snap
        _telemetryScheduleFlush()
      } catch (e) {}
    }
    // 导入合并（0.4.3 验收修复⑤ transfer.js 消费）：导入数据计数并入、冲突取大（单调下界语义不破坏）——
    //   receipts 按 ts+ids 签名去重并集（时间序归一后 ≤200 保最新）；byDay 同键取大、缺键并入；facets.use 同键取大（卡⑧）；meta.lastFlush 取晚；
    //   migratedAt/migratedFrom 只补不缺（不覆盖既有迁移史）；ledger 快照 at 晚者胜；version 取大（前向兼容入口）。
    //   幂等：同一快照重复导入零变化（并集/取大均幂等）→ 返回 false；有变化 → 防抖 flush 落盘 → 返回 true。
    function _telemetryReceiptKey(r) { return String(r.ts) + '|' + (Array.isArray(r.ids) ? r.ids.join(',') : '') }
    async function _telemetryImportMerge(obj) {
      try {
        await _telemetryLoad()
        const t = _telemetryCache
        if (!t || !obj || typeof obj !== 'object' || Array.isArray(obj)) return false
        let changed = false
        if (typeof obj.version === 'number' && isFinite(obj.version) && obj.version > (t.version || 1)) { t.version = Math.floor(obj.version); changed = true }
        for (const ch of TELEMETRY_RECEIPT_CHANNELS) {
          const inc = obj.receipts && Array.isArray(obj.receipts[ch]) ? obj.receipts[ch] : []
          if (!inc.length) continue
          const seen = {}
          for (const r of t.receipts[ch]) seen[_telemetryReceiptKey(r)] = true
          for (const r of inc) {
            if (!r || typeof r !== 'object' || !r.ts || !Array.isArray(r.ids) || !r.ids.length) continue
            const k = _telemetryReceiptKey(r)
            if (seen[k]) continue
            seen[k] = true
            const row = { ts: String(r.ts), ids: r.ids.map(String) }
            if (r.session) row.session = String(r.session)
            t.receipts[ch].push(row)
            changed = true
          }
          t.receipts[ch].sort(function (a, b) { return a.ts < b.ts ? -1 : (a.ts > b.ts ? 1 : 0) })
          if (t.receipts[ch].length > TELEMETRY_RECEIPT_MAX) t.receipts[ch] = t.receipts[ch].slice(-TELEMETRY_RECEIPT_MAX)
        }
        for (const ch of TELEMETRY_BYDAY_CHANNELS) {
          const incDays = obj.byDay && obj.byDay[ch] && typeof obj.byDay[ch] === 'object' ? obj.byDay[ch] : null
          if (!incDays) continue
          for (const d of Object.keys(incDays)) {
            const bucket = incDays[d]
            if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !bucket || typeof bucket !== 'object') continue
            const out = t.byDay[ch][d] || (t.byDay[ch][d] = {})
            for (const id of Object.keys(bucket)) {
              const v = Math.max(0, Math.floor(Number(bucket[id]) || 0))
              if (!v) continue
              const k = String(id)
              if (!out[k] || out[k] < v) { out[k] = v; changed = true }
            }
          }
        }
        // facets.use 并入（0.4.3 验收修复⑧）：同键取大、缺键并入（单调下界语义不破坏；幂等——重复导入零变化）
        const incUse = obj.facets && obj.facets.use && typeof obj.facets.use === 'object' && !Array.isArray(obj.facets.use) ? obj.facets.use : null
        if (incUse) {
          for (const uid of Object.keys(incUse)) {
            const uv = Math.max(0, Math.floor(Number(incUse[uid]) || 0))
            if (!uv) continue
            const k = String(uid)
            if (!t.facets.use[k] || t.facets.use[k] < uv) { t.facets.use[k] = uv; changed = true }
          }
        }
        const incMeta = obj.meta && typeof obj.meta === 'object' ? obj.meta : {}
        if (incMeta.lastFlush && (!t.meta.lastFlush || String(incMeta.lastFlush) > String(t.meta.lastFlush))) { t.meta.lastFlush = String(incMeta.lastFlush); changed = true }
        if (incMeta.migratedAt && !t.meta.migratedAt) { t.meta.migratedAt = String(incMeta.migratedAt); if (incMeta.migratedFrom) t.meta.migratedFrom = String(incMeta.migratedFrom); changed = true }
        if (obj.ledger && typeof obj.ledger === 'object' && obj.ledger.at && (!t.ledger || !t.ledger.at || String(obj.ledger.at) > String(t.ledger.at))) { t.ledger = obj.ledger; changed = true }
        if (changed) { _telemetryDirty = true; await _telemetryFlushNow() }
        return changed
      } catch (e) { return false }
    }
    // ==== telemetry-store END ====
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
    // 存储加固声明（notes-043-atomic-store）：写入原子性委托 DSH fs 服务 writeText（底层 writeFileAtomic：
    // staging+temp+sync+rename+targetKey 锁，见 kernel/persist.js 声明）；cache 为常驻权威，跨 apply 由磁盘恢复。
    //   sys 常驻语义：kind=sys 系统根笔记与普通笔记同走本通道（无特例写路径、无旁路缓存）——机器托管正文与全库同口径，
    //   盘上字节即 cache 权威源，重启后由磁盘 front-matter 逐字段重建（墓碑/软链字段一并恢复）。
    const KINDS = ['note', 'decision', 'todo', 'link', 'quote', 'log', 'sys']   // 工作记忆 v0：+ kind=log（工作日志；治理语义不同——默认隐身 + 永不被过期/孤儿清理提名，见 design/agent-memory-v0.md §4.1）
    // 0.4.3⑥（notes-043-sys-kind）：+ kind=sys（系统根笔记——机器托管的公司笔记：注入允许且是核心用途、recall 缺省 false
    //   （不进目录/默认召回）、编辑器可见可改；整理建议器/批量删除豁免面收口——见 memory.js suggestCandidates + selbar/archive 红字警示）
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
    const AI_ORGANIZE_INSTR_MAX_CHARS = 500   // 0.4.4-F：整理追加用户指令上限（trim 后计，超限报 error 不落 prompt）
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
        // recall：原目录索引准入字段——0.4.4-E 起目录段唯挂载行源，字段失去最后消费方；0.4.5-A（notes-045-debt-host）写侧退役落地
        //   （buildFM 不再写 recall 行，存量文件该行保留不迁移、本处解析保留 = 读写兼容红线；无注入效果）；
        // 缺省 true（旧文件无 recall 字段 → true，向后兼容解析保留）；显式 false 逐条置否（与 inject 正交）；
        // 工作记忆 v0（裁决 B①）/0.4.3⑥：kind=log/sys 缺省 recall=false（dormant 缺省口径保留）
        recall: p.meta.recall === 'true' ? true : (p.meta.recall === 'false' ? false : ((p.meta.kind === 'log' || p.meta.kind === 'sys') ? false : true)),
        // sensitive：敏感内容标记（注入时正文按行打码，键保留值遮蔽），缺省 false（存量零迁移）
        sensitive: p.meta.sensitive === 'true',
        // hidden：隐藏属性（0.4.4-D，纯 UI 遮罩——面板显隐开关关时滤除/开时半透明渲染；agent 面与读写面天然完整），缺省 false（存量零迁移）
        hidden: p.meta.hidden === 'true',
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
        // 工作记忆 v0 r3 车道模型：contractType（契约身份标记，memory-guide 引导笔记）；origin（产物溯源，引导激活期日志）；缺省 '' 存量零迁移
        contractType: p.meta.contractType || '',
        origin: p.meta.origin || '',
        // 效用账本（0.4.3⑥）：记忆档案 → 被引用记忆 id 的结构化软链，缺省 ''（存量零迁移；仅 notes-ledger 懒创建回写）
        refNote: p.meta.refNote || '',
        // 0.4.4-A 派发回执笔记化：执行记录伴生笔记软链（非调度派发源笔记顶层字段；调度约定走 schedule.runLog），缺省 '' 存量零迁移
        runLog: p.meta.runLog || '',
        // 定时派发·执行层：调度声明 + 机器状态（dispatch-schedule 约定笔记），缺省 null（存量零迁移；非法 JSON 回退 null 不触发）
        schedule: parseSchedule(p.meta.schedule),
        mergedFrom: p.meta.mergedFrom || [],
        dispatches: parseDispatches(p.meta.dispatches),
        // useCount：使用遥测（note_get 工具命中计数）——0.4.3 验收修复⑧起 front-matter 字段退役（buildFM 不再写入），
        //   此处仅读存量旧值作 facet seed 依据（_useFacetSync max 合并）；缺省/非法值回退 0（存量零迁移）
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
      // useCount facet 供电（0.4.3 验收修复⑧）：旧 front-matter 值 seed 并入 facet + facet 更大抬头视图（双向 max 合并幂等）
      await _useFacetSync(note)
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
    // 0.4.3 验收修复⑧（notes-043-stats-unify）：useCount 收编 note-stats facet——telemetry.json facets.use {id:总计数} 为唯一事实源，
    //   front-matter useCount 字段退役（buildFM 不再写入；存量旧值由 _useFacetSync 作 seed max 合并并入，字段随下次真实保存自然脱落）。
    //   内存视图 n.useCount 保留且由 facet 供电——全部消费方（按引用排序/行尾角标/详情 chip/ledger useRank Top5/整理建议零引用保护/归档合计）读视图零改动。
    // 落盘：命中只改内存视图 + facet 内存增量（_telemetryBumpUse），复用遥测 2s 防抖通道落 telemetry.json（无独立定时器），卸载经 _recallFlushAgg 同盘 flush；
    //   note_get 热路径不再重写笔记 .md（写放大消除——旧遥测回写每次 flush 逐笔记 persistNote 全文重写，已随 flushUseCounts 一并拆除）。
    // 代价兜底：进程退出时防抖窗口内未落盘的计数丢失（可接受，下界语义；遥测 timer unref 不阻塞宿主退出——语义同卡⑤）。
    // 命中 +1：内存视图即时 +1（_list/slim/排序/角标立即可见）+ facet 总计数 +1（fire-and-forget 自含加载，静默降级不扩散）；
    //   作用于缓存原件（_get 已保证入缓存）；返回新计数，缓存未命中/墓碑返回 null（调用方忽略）
    function bumpUseCount(id) {
      const n = cache.get(id)
      if (!n || n.tombstoned) return null
      n.useCount = Math.max(0, n.useCount || 0) + 1
      _telemetryBumpUse(id)
      return n.useCount
    }
    // facet ⇄ 视图双向同步（载入 readNoteFile / 创建 _create 显式继承 / 导入 cache 直建三入口共用）：
    //   视图值（含旧 front-matter seed）max 合并入 facet；facet 更大 → 视图抬头（facet 是唯一事实源）。
    //   自含加载（遥测故障空桶不抛——静默降级不阻塞主流程）；种子未抬升时零置脏零写（存量重读零放大）；返回合并后总计数
    async function _useFacetSync(n) {
      try {
        if (!n || !n.id) return 0
        await _telemetryLoad()
        const fused = _telemetrySeedUse(n.id, Math.max(0, n.useCount || 0))
        if (fused > (n.useCount || 0)) n.useCount = fused
        return fused
      } catch (e) { return Math.max(0, (n && n.useCount) || 0) }
    }
    // ==== use-telemetry END ====

    // 笔记对象 → 磁盘文件字节（front-matter + 正文）：persistNote 写盘与历史快照重建「上一版」共用同一构造函数，保证字节同口径
    function noteFileContent(n) {
      const meta = {
        id: n.id, title: n.title, topic: n.topic, workspace: n.workspace, folder: n.folder || '',
        tags: n.tags || [], kind: n.kind || 'note', status: n.status || 'active',
        inject: n.inject === true, injectEver: n.injectEver === true || n.inject === true, injectTo: n.injectTo || [], injectRole: n.injectRole === 'reference' ? 'reference' : 'convention', sensitive: n.sensitive === true, hidden: n.hidden === true,
        createdAt: n.createdAt, updatedAt: n.updatedAt,
        sessionId: n.sessionId, cwd: n.cwd, logDate: n.logDate || '', entities: n.entities || [], summarizedAt: n.summarizedAt || '', contractType: n.contractType || '', origin: n.origin || '', refNote: n.refNote || '', runLog: n.runLog || '', schedule: n.schedule || null, mergedFrom: n.mergedFrom || [],
        dispatches: n.dispatches || [],
        // useCount 不落盘（0.4.3 验收修复⑧字段退役）：统计归 telemetry.json facets.use 单一事实源，buildFM 无此行
        // recall 不落盘（0.4.5-A notes-045-debt-host 写侧退役）：buildFM 无此行；内存视图保留（slim 读侧下发不变），存量行解析保留
        archivedAt: n.archivedAt || '', deleted: n.deleted ? 'true' : 'false'
      }
      return buildFM(meta) + (n.body || '')
    }

    // ==== history-engine BEGIN ====（host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包同步：路径拼接与删除通道差异同 purgeNoteFile 先例——开发版 '\\' 拼接 + 墓碑式清空；静态包 path.join + processPath 真删。改动必须双边同步）
    // 快照式历史引擎：persistNote 每次真实落盘前，把「被替换的上一版」快照进 NOTES_DIR/.history/<noteId>/<ISO时间戳>.<hash>.md
    // （纯文本不压缩不加密，目录即格式；文件名 = UTC ISO 时间戳（':' 在 Windows 文件名非法 → '-'）+ 稳定内容 hash 后缀，字典序即时序，免读 mtime）。
    // 触发对齐 doSave 防抖：client 防抖后每次真实保存 = 一次 persistNote = 一次快照；创建首版无旧版可快照（缓存未命中自然跳过）。
    // 上一版来源 = persistNote 写盘前的 cache 原件经 noteFileContent 重建字节（插件写入全经 persistNote 同步缓存，缓存即盘上字节）——
    //   零新增磁盘读（update 主路径红线）；例外：存量文件盘上残留已退役 useCount 行时重建字节不含该行（0.4.3 验收修复⑧字段退役，内容等价）、外部手写文件经 FM 规范化重建（均内容等价）。
    //   浅拷贝别名注意：派发等原地变异路径的元数据字段可能已是新值，正文始终正确（字符串不可变）。
    // 内容去重：hash 只覆盖「稳定内容」（剔除 updatedAt/useCount 易变字段——保存时间戳/遥测计数不算内容变化）；
    //   与该笔记最新快照文件名内嵌 hash 比对，相同则跳过（无变化重复保存场景）；hash 内嵌文件名使插件重载后去重仍零读盘有效。
    // 保留策略（写入路径摊销执行，无定时器）：分层——1h 内每版全留 / 当天每小时 1 版 / 7 天内每天 1 版 / 超 7 天淘汰；
    //   单笔记硬上限 20 版（超限淘汰最旧）；全库 .history 总预算 50MB（LRU 跨笔记淘汰最旧快照）。
    // 删除语义同 purge：ctx.fs 无删除契约 → 开发版墓碑式清空（0 字节，histEnsureScanned 视作不存在）；静态包 processPath 可用时 node:fs 真删。
    // 性能红线：_list/_get/_search 主读取路径零新增 IO（.history 是子目录，列表只认 n-*.md 直子级，天然不枚举）；
    //   快照/去重/保留/预算全部挂写入路径（persistNote/_purge/导入导出）；惰性全量扫描每 apply 生命周期至多一次。
    // 自动元数据回写（agent status idle 派发回执 / 根笔记与调度机器回写）不算编辑：persistNote 第二参 { history:false } 不产生历史版本。
    //   （useCount 防抖落盘已于 0.4.3 验收修复⑧退役——统计归 telemetry.json facets.use，不经 persistNote，天然零快照。）
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
      // 快照字节 = noteFileContent 产物（front-matter + 正文原形）：parseFM 节 77 起已吃掉闭合分隔符后全部前导换行，逐字节还原落盘前正文（cache 口径，旧「剥一个前导换行」绕行已消除）
      return { ts: Number(ts), body: parseFM(content).body || '' }
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
      note.body = parseFM(content).body || ''   // 还原落盘前正文原形（同 _historyGet 口径：parseFM 节 77 起已归一前导换行，无需再剥）
      note.updatedAt = new Date().toISOString()
      await persistNote(note)   // 恢复前置快照：当前版先自动入 .history（缺省快照语义），随后才写恢复版——恢复可再撤销
      return { id: id, restored: true, ts: Number(ts) }
    }
    // ==== history-engine END ====

    // opts.history===false：自动元数据回写（idle 派发回执/根笔记与调度机器回写）不算编辑，不产生历史快照；其余每次真实落盘前快照上一版
    // 0.4.3 存储加固（notes-043-atomic-store）·存储层语义声明：
    //   ①原子性——本插件全部笔记写路径统一收口 persistNote → fs.writeText；DSH fs 服务的 writeText 底层即
    //     writeFileAtomic（staging 目录 + temp 文件 + fsync + rename 发布，按目标路径 targetKey 加锁），
    //     单次写入对崩溃半写天然免疫（崩溃只会留下完整旧版或完整新版，无中间字节）——插件层不再叠加 tmp+rename。
    //   ②常驻——cache 为常驻内存权威：所有写入同步缓存（写后缓存即盘上字节的同口径重建源，历史快照/列表共用），
    //     外部新增文件仅在 list 懒加载；跨 apply 生命周期由磁盘文件恢复，墓碑（deleted:true）落盘后重载不复活。
    //   ③串行化——per-note 写链：同笔记并发 persistNote 读-改-写竞态（两异步流程同时 rootNoteAppend 丢行不报错）
    //     由 _persistChains[id] 串行消除；跨笔记仍并行。失败不断链（catch 吞尾），错误原样抛给调用方。
    //   ④事件分发（0.4.3+ notes-043-event-bus）——落盘成功后经 notes-events 注册表单点分发（替代洋葱包裹），见下方标记块。
    const _persistChains = Object.create(null)
    // ==== notes-events BEGIN ====（0.4.3+ 内核事件总线：onNoteChanged 单点注册表，notes-043-event-bus——替代 persistNote/_purge 洋葱包裹）
    // 契约：persistNote/_purge 落盘成功后单点分发 { event, note?, id? }：
    //   event ∈ create（首写，cache 无旧版）/ update（已存笔记改写）/ delete（软删落盘 deleted:true）/
    //           restore（删除态重存 deleted:true→false 同通道）/ purge（彻底删除——不经 persistNote，由 _purge 分发，载荷只带 id）。
    // 顺序契约：监听者按注册序同步执行（manifest 登记序 = 执行序，check 节 45 序断言看守——比洋葱包裹序显式）。
    // 红线：监听者异常隔离（逐监听 try/catch + console.error 记录）——任何监听者抛错不影响其余监听者与落盘主流程（零阻塞）。
    const _noteListeners = []
    function onNoteChanged(fn) { if (typeof fn === 'function') _noteListeners.push(fn) }
    function _emitNoteChanged(ev) {
      for (const fn of _noteListeners.slice()) {
        try { fn(ev) } catch (e) { console.error('notes: onNoteChanged 监听者异常（已隔离）', e) }
      }
    }
    // 事件类型推导：prev = 写前 cache 旧版（常驻权威）；墓碑视作不存在（purge 后重写 = 新建语义）
    function _noteEventOf(prev, n) {
      if (n && n.deleted === true) return 'delete'
      if (!prev || prev.tombstoned) return 'create'
      if (prev.deleted === true) return 'restore'
      return 'update'
    }
    // ==== notes-events END ====
    async function _persistNoteInner(n, opts) {
      perfStats.diskWrites++
      const prev = cache.get(n.id)
      if ((!opts || opts.history !== false) && prev) await histSnapshot(n.id, prev)
      const content = noteFileContent(n)
      const ft = await fs.resolve(noteFile(n.id))
      await fs.writeText(ft, content, undefined, undefined, getPolicy())
      cache.set(n.id, Object.assign({}, n))
      _emitNoteChanged({ event: _noteEventOf(prev, n), note: n })   // 落盘成功且缓存同步后单点分发（notes-043-event-bus）
    }
    async function persistNote(n, opts) {
      const prev = _persistChains[n.id] || Promise.resolve()
      const run = prev.then(() => _persistNoteInner(n, opts))
      _persistChains[n.id] = run.then(function () {}, function () {})   // 失败不断链：后续写不受前次失败阻塞
      await run
    }

    // 列表/RPC 瘦身：不带 body，正文编辑走 notes-get 按需加载
    function slim(n) {
      return {
        id: n.id, title: n.title, topic: n.topic, workspace: n.workspace, folder: n.folder || '',
        tags: n.tags, kind: n.kind || 'note', status: n.status || 'active',
        inject: n.inject === true, injectEver: n.injectEver === true || n.inject === true, injectTo: n.injectTo || [], injectRole: n.injectRole === 'reference' ? 'reference' : 'convention', recall: n.recall !== false, sensitive: n.sensitive === true,
        hidden: n.hidden === true,   // 0.4.4-D：hidden 隐藏属性随 slim 下发（纯 UI 遮罩数据源——面板显隐开关滤除/半透明；列表瘦身不丢字段）
        createdAt: n.createdAt, updatedAt: n.updatedAt,
        sessionId: n.sessionId, cwd: n.cwd, logDate: n.logDate || '', entities: n.entities || [], summarizedAt: n.summarizedAt || '', contractType: n.contractType || '', origin: n.origin || '', schedule: n.schedule || null, mergedFrom: n.mergedFrom,
        dispatches: n.dispatches || [],
        refNote: n.refNote || '',
        runLog: n.runLog || '',   // 0.4.4-A：执行记录伴生笔记软链（顶层 runLog）随 slim 下发——UI 派发历史行/计划块跳转数据源
        useCount: n.useCount || 0,
        archivedAt: n.archivedAt, deleted: n.deleted === true, preview: String(n.body || '').slice(0, 200)
      }
    }

    // ---- 虚拟文件夹：~/.dsh/notes/folders.json 登记清单 [{id,name,order,parent?,hidden?,sys?}]；parent=父文件夹 id（缺省=根级，存量数据无 parent 字段零迁移）；笔记 front-matter 的 folder 字段存文件夹 id（缺省 ''=未分类，向后兼容） ----
    // hidden（0.4.4-D 隐藏属性，OS 文件管理对齐）：纯 UI 遮罩标记——面板显隐开关关时该夹行+nested 子树容器滤除、开时半透明渲染；
    //   host 计数/过滤/导出语义零改动（遮罩全在 client/app 渲染层）；仅 true 落对象（缺省 false 存量零迁移）。写入走 op:'set-flags' {id,hidden}。
    // sys（0.4.4-G 机器属性，自动沉淀文件夹默认隐身）：工作日志/记忆档案/执行记录三夹的机器托管标记——树默认不渲染该夹行+nested 子树容器
    //   （夹内普通笔记随夹隐身，OS 父子树语义同 hidden）；显式入口双通道并集放行：筛选中心「机器」档选中 或 「显示隐藏」开关开；
    //   host 计数/过滤/导出语义零改动（遮罩全在 client/app 渲染层，与⑨ 内容级 kind=sys 谓词正交）。
    //   自动标记三管线：①ledger 记忆档案 ensure ②schedule 执行记录 ensure ③loadFolders 一次性懒迁移（名称严格匹配三值 + sys 字段缺席 → 置 true 落盘）；
    //   用户可经右键「取消机器属性」摘除——set-flags sys:false 落**显式 false 墓碑**（区别于 hidden 的摘字段：墓碑挡懒迁移回标，摘除生效不回弹）。
    // .json 后缀不进笔记列表（_list 只认 .md），与 settings.json 同理落在同目录天然不污染列表。
    const FOLDERS_PATH = path.join(NOTES_ROOT, 'folders.json')

    function genFolderId() {
      return 'f-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    }

    // 0.4.4-G 机器属性（folder 级 sys）：自动沉淀三夹名称严格匹配表——loadFolders 懒迁移判据（用户改名过的夹不匹配则不动）
    const SYS_FOLDER_NAMES = { '工作日志': true, '记忆档案': true, '执行记录': true }

    // 读文件夹清单：文件缺失/JSON 损坏/结构非法一律兜底为空数组（不抛错，笔记主流程不受 folders.json 影响）；
    // parent 仅真值落对象（缺省 undefined=根级，saveFolders JSON 序列化时 undefined 键自然省略，磁盘格式零迁移）；
    // sys 三态（0.4.4-G）：true/false 显式落对象（false=用户摘除墓碑，挡懒迁移回标），缺席=undefined 待迁移判定
    async function loadFolders() {
      try {
        const ft = await fs.resolve(FOLDERS_PATH)
        const arr = JSON.parse(await fs.readText(ft))
        if (!Array.isArray(arr)) return []
        const out = arr.filter(f => f && f.id).map(f => { const o = { id: String(f.id), name: String(f.name || ''), order: typeof f.order === 'number' ? f.order : 0 }; if (f.parent) o.parent = String(f.parent); if (f.hidden === true) o.hidden = true; if (f.sys === true) o.sys = true; else if (f.sys === false) o.sys = false; return o })
        // 0.4.4-G 一次性懒迁移：名称 ∈ SYS_FOLDER_NAMES 且 sys 字段缺席 → 置 true 落盘（幂等：置位后不再命中；
        //   显式 sys:false 墓碑不命中——用户右键摘除不回弹；用户改名过的夹名称不匹配不动；并发重放同内容落盘幂等）
        let migrated = false
        for (const f of out) { if (f.sys === undefined && SYS_FOLDER_NAMES[f.name] === true) { f.sys = true; migrated = true } }
        if (migrated) await saveFolders(out)
        return out
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
    // op = create(name,parent?,sys?)/rename/set-flags(id,hidden?,sys?)/delete(id,cascade?)/reorder(ids,parents?)。
    // 计数口径：deleted 笔记由 _list 排除不计；folder 指向清单外 id 的笔记计入 unfiled；count 为**递归子树口径**（含全部子孙文件夹内笔记）。
    // 0.4.3⑩（notes-043-archive-folder 第二轮裁决）：计数取 includeSys 机器全量视图——文件夹徽标 = 夹内全部笔记数
    //   （与 folder 定向视图（⑨ 保留通道，含 sys）逐字一致，消除「count=0 但夹内有 sys 档案」的死节点观感；通用计数语义修正，非文件夹特判）；
    //   unfiled 计数与⑨「未分类」平铺同族口径守恒——kind=sys 仍不计入（未分类列表不含 sys，计数不得虚高）。
    // 嵌套约束：create/reorder 拖父级时经 checkFolderAttach 校验（深度上限 maxFolderDepth 缺省 3 / 0 不限 + cycle 拒绝）。
    // delete 语义（级联必须显式传参）：缺省拒绝有子内容（子孙文件夹/子树笔记）的删除（needCascade 提示）；
    // cascade:true = 整棵子树文件夹删除（结构不可恢复）+ 其下全部笔记逐条软删（_delete 同通道，回收站可恢复；恢复后原文件夹已不存在 → effectiveFolder 兜底未分类）。
    async function _folders(args) {
      const a = args || {}
      const op = a.op || 'list'
      if (op === 'list') {
        const folders = await loadFolders()
        // ==== folders-count-sys BEGIN ====（0.4.3⑩ 第二轮裁决③：计数口径 includeSys——文件夹徽标=夹内全部笔记（与 folder 定向视图
        //   含 sys 逐字一致，消除 count=0 死节点）；unfiled 与⑨「未分类」平铺同族排除 sys。folders.js 与 folders.dist.js 双变体逐字节同步，check 节 21 看守）
        const all = await _list(undefined, undefined, undefined, undefined, undefined, true)   // ⑩ includeSys 机器全量口径：文件夹计数含 sys（与定向视图一致）
        const direct = {}
        let unfiled = 0
        for (const n of all) {
          const f = effectiveFolder(n, folders)
          if (!f) { if ((n.kind || 'note') !== 'sys') unfiled++ }   // unfiled 与⑨「未分类」平铺同族：sys 不计
          else direct[f] = (direct[f] || 0) + 1
        }
        // ==== folders-count-sys END ====
        const list = folders.slice().sort((x, y) => x.order - y.order)
          .map(f => {
            // 子树口径计数：文件夹 count = 整棵子树（含自身 + 全部子孙文件夹）内笔记总数
            const sub = folderSubtreeIds(f.id, folders)
            let count = 0
            for (const sid in sub) count += direct[sid] || 0
            return { id: f.id, name: f.name, order: f.order, parent: f.parent || '', depth: folderDepth(f.id, folders), count: count, hidden: f.hidden === true, sys: f.sys === true }
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
        if (a.sys === true) folder.sys = true   // 0.4.4-G：机器属性创建直入（自动沉淀管线下水点用；UI 新建不传 = 缺省普通夹）
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
      if (op === 'set-flags') {
        // 0.4.4-D hidden 隐藏属性 + 0.4.4-G sys 机器属性：文件夹标记写入通道（两键独立——仅显式传入的键才触碰）——
        //   hidden：true 落 hidden:true / false 摘字段回缺省（存量零迁移）；
        //   sys：true 落 sys:true / false 落**显式 false 墓碑**（不摘字段——墓碑挡 loadFolders 懒迁移回标，用户摘除不回弹；再传 true 可恢复）
        if (!a.id) return { error: 'notes-folders.set-flags 需要 id' }
        const folders = await loadFolders()
        const f = folders.find(x => x.id === a.id)
        if (!f) return { error: '文件夹不存在: ' + a.id }
        if (a.hidden !== undefined) { if (a.hidden === true) f.hidden = true; else delete f.hidden }
        if (a.sys !== undefined) { if (a.sys === true) f.sys = true; else f.sys = false }
        await saveFolders(folders)
        return { ok: true, id: a.id, hidden: f.hidden === true, sys: f.sys === true }
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
        return { ok: true, folders: merged.map(f => ({ id: f.id, name: f.name, order: f.order, parent: f.parent || '', hidden: f.hidden === true, sys: f.sys === true })) }
      }
      return { error: 'notes-folders: 未知 op：' + String(op) + '（期望 list/create/rename/set-flags/delete/reorder）' }
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

    // ==== injectto-norm-guard BEGIN ====（injectTo 写入路径归一 + 非法显式拒绝：notes.js 与 notes.dist.js 双变体逐字节同步，check 节 53 看守）
    // 归一规则（错得安全：收窄失败必须显式失败，禁止静默放宽/静默吞）：
    //   ① 存量 'global'/'workspace' 原样透传（读路径兼容口径，不迁移）；② 等于活跃会话短 id → 原样保留；
    //   ③ 等于活跃会话完整 id（含经 shortSid 可约到的长形态）→ 归一为短 id 落盘（详情下拉勾选态按短 id 比对，长 id 落盘恒不命中——本 bug 核心）；
    //   ④ 短 id 形态但不在活跃集（历史会话已删）→ 保留原值不报错（治理连续性，读路径按短 id 比对仍可命中复活后的同名会话）；
    //   ⑤ 其余无法解析值 → 整体拒绝（报错含具体值，不部分保存）。
    // 红线：归一只在写入路径（_create/_update 显式传 injectTo 时），读路径（conventionHit 命中）不动；
    //       活跃会话集与 notes-sessions 同源（_activeSessions，含 pendingSessions 占位会话——标题未补齐不影响命中）。
    async function _normInjectTo(arr) {
      if (!Array.isArray(arr)) return { error: 'injectTo 须为字符串数组（实得 ' + typeof arr + '）' }
      let act = []
      try { const r = await _activeSessions(); act = ((r && r.sessions) || []).concat((r && r.pendingSessions) || []) } catch (e) { act = [] }
      const byShort = {}, byFull = {}
      for (const s of act) {
        if (!s) continue
        const sh = s.short || shortSid(s.id)
        if (sh) byShort[sh] = sh
        if (s.id) byFull[String(s.id)] = sh
      }
      const out = [], seen = {}
      const pushOnce = (v) => { if (!seen[v]) { seen[v] = true; out.push(v) } }
      for (const raw of arr) {
        const v = String(raw == null ? '' : raw).trim()
        if (!v) continue
        if (v === 'global' || v === 'workspace') { pushOnce(v); continue }   // ① 存量值透传
        if (byShort[v]) { pushOnce(v); continue }                            // ② 活跃会话短 id
        if (byFull[v]) { pushOnce(byFull[v]); continue }                     // ③ 完整 id → 归一短 id
        const sv = shortSid(v)
        if (byShort[sv]) { pushOnce(sv); continue }                          // ③ 长形态（带不带 session- 前缀）经归一命中活跃会话
        if (sv === v) { pushOnce(v); continue }                              // ④ 短 id 形态但会话已不在活跃集（历史已删）：保留原值不报错
        return { error: 'injectTo 含无法解析的会话标识符「' + v + '」（须为活跃会话短 id 或完整 id）' }   // ⑤ 整体拒绝
      }
      return { value: out }
    }
    // ==== injectto-norm-guard END ====

    // ==== folder-arg-norm BEGIN ====（create/update 写入路径 folder 名称→id 归一 + 非法显式拒绝：notes.js 与 notes.dist.js 双变体逐字节同步，check 节 58 看守）
    // 归一规则（错得安全：解析不到必须显式报错，禁止静默落未分类/静默吞）：
    //   ① ''（空串 = 未分类语义）→ 原样透传；② 等于某文件夹 id → 原样保留；
    //   ③ 等于某文件夹名 → 归一为该文件夹 id 落盘（笔记 folder 字段存 id，存名称字符串会显示成未分类——本 bug 核心，实证 n-mut9tg7bik40）；
    //   ④ 其余无法解析值 → 整体拒绝（报错含具体值，不落库）。
    // 红线：归一只在写入路径（_create/_update 显式传 folder 时）；读路径/查询参数（_list/_search 的 folder 过滤，R-6 递归子树口径）由工具层 resolveFolderRef 先行解析，不在此列；
    //       存量已误存名称的笔记不自动改写（下次 move/保存经本闸归一治愈）。
    async function _resolveFolderArg(v) {
      const rf = await resolveFolderRef(v)
      if (!rf) throw new Error('folder 未知文件夹 id 或名称：' + String(v))
      return rf.id
    }
    // ==== folder-arg-norm END ====

    async function _create(title, body, tags, topic, extra) {
      const id = genId()
      const now = new Date().toISOString()
      const sc = sessCtx()
      const ex = extra || {}
      // injectTo 写入归一 + 非法显式拒绝（injectto-norm-guard）：显式传才归一（undefined 不缺省归一）；非法值整体拒绝不落库
      let injectToNorm = ex.injectTo
      if (injectToNorm !== undefined) {
        const ng = await _normInjectTo(injectToNorm)
        if (ng.error) throw new Error(ng.error)
        injectToNorm = ng.value
      }
      // folder 写入归一 + 非法显式拒绝（folder-arg-norm）：显式传才归一（undefined 不缺省归一）；非法值整体拒绝不落库
      let folderNorm = ex.folder
      if (folderNorm !== undefined) folderNorm = await _resolveFolderArg(folderNorm)
      // 工作记忆 v0 隐身硬闸（裁决 B①）：kind=log 强制 inject=false（显式传 true 也纠正，返回值 injectForcedOff 告知），
      // recall 缺省 false（0.4.4-E 起字段 dormant——目录段唯挂载行源，显式 true 亦无注入效果，读写兼容保留）；日志永不进系统提示与目录索引
      const isLog = (ex.kind || 'note') === 'log'
      // 0.4.3⑥（notes-043-sys-kind）：kind=sys 系统根笔记——recall 缺省 false（dormant 缺省口径保留，0.4.4-E 起无注入效果）；
      //   inject 允许且是核心用途（与 log 的隐身硬闸不同，不做 inject 纠正）
      const isSys = (ex.kind || 'note') === 'sys'
      const injectForcedOff = isLog && ex.inject === true
      // 定时派发·执行层：schedule 声明写入闸门（校验红线：at 必须未来 / 轮询≥5min / 目标存活 / 契约配对——非法声明拒绝落库，错得安全）
      const createCT = ex.contractType || ''
      let scheduleDecl = null
      if (ex.schedule !== undefined && ex.schedule !== null) {
        const gate = await _schedValidateWrite(ex.schedule, createCT, null)
        if (gate.error) throw new Error(gate.error)
        scheduleDecl = gate.value
      } else if (createCT === SCHEDULE_CONTRACT_TYPE) {
        throw new Error('contractType=dispatch-schedule 需要 schedule 声明（schedule: { at|every, target }）')
      }
      const note = {
        id, title: title || 'Untitled', topic: topic || '未分类',
        workspace: ex.workspace || basename(sc.cwd),
        folder: folderNorm || '',
        tags: tags || [],
        kind: ex.kind || 'note',
        status: ex.status || 'active',
        inject: isLog ? false : ex.inject === true,
        // injectEver 粘性：创建即注入（inject=true）或显式继承（归档合并 members.some 传入）→ true；否则缺省 false
        // （kind=log 的 inject 已被硬闸纠正为 false，不随被纠正值拉起 injectEver）
        injectEver: isLog ? (ex.injectEver === true) : (ex.injectEver === true || ex.inject === true),
        injectTo: injectToNorm || [],
        injectRole: ex.injectRole === 'reference' ? 'reference' : 'convention',
        recall: (isLog || isSys) ? (ex.recall === true) : (ex.recall !== false),
        sensitive: ex.sensitive === true,
        // hidden 隐藏属性（0.4.4-D）：纯 UI 遮罩标记，显式透传（缺省 false）；host 列表/搜索/读写面零过滤——遮罩全在 client/app 渲染层
        hidden: ex.hidden === true,
        createdAt: ex.createdAt || now, updatedAt: ex.updatedAt || now,
        sessionId: ex.sessionId !== undefined ? ex.sessionId : sc.sessionId,
        cwd: ex.cwd || sc.cwd,
        // 工作记忆 v0 §7.2：logDate 归键（YYYY-MM-DD 本地时区），kind=log 缺省取今天；entities 结构预留缺省 []；summarizedAt 仅自动总结产物写入
        logDate: ex.logDate || (isLog ? localDateStr() : ''),
        entities: Array.isArray(ex.entities) ? ex.entities : [],
        summarizedAt: ex.summarizedAt || '',
        // 工作记忆 v0 r3 车道模型·契约分型：contractType 仅显式透传（enable 流程落 memory-guide；普通创建为空）
        contractType: ex.contractType || '',
        // 工作记忆 v0 r3 车道模型·产物溯源：显式 origin 优先（含显式 '' 关闭打标）；kind=log 未显式指定时，
        // 若 memory-guide 引导对本会话激活（注入同源 cache 视图 + conventionHit 作用域口径）自动落 'memory-guide'——引导未激活/不在作用域则不打标
        origin: ex.origin !== undefined ? ex.origin : (isLog && memoryGuideActiveFor(sc.sessionId) ? MEMORY_GUIDE_CONTRACT_TYPE : ''),
        schedule: scheduleDecl,
        mergedFrom: ex.mergedFrom || [],
        dispatches: ex.dispatches || [],
        useCount: ex.useCount || 0,
        archivedAt: ex.archivedAt || '',
        deleted: false,
        body: body || ''
      }
      await persistNote(note)
      // useCount facet 供电（0.4.3 验收修复⑧）：归档合并等显式继承计数（ex.useCount>0）并入 facet（max 合并幂等；front-matter 已退役不写）
      if (note.useCount > 0) await _useFacetSync(note)
      const r = { id, topic: note.topic, title: note.title, kind: note.kind, status: note.status }
      if (injectForcedOff) r.injectForcedOff = true   // 日志隐身硬闸命中告知（调用方可提示用户/agent）
      // 敏感模式自动识别建议：命中不强制落 sensitive（create 是显式动作，由调用方/用户决策），仅回传建议标记
      if (note.sensitive !== true && suggestSensitive(note.body)) r.sensitiveSuggested = true
      return r
    }

    // includeDeleted（P1 回收站）：缺省排除软删除；传 true 时 deleted 笔记一并返回（回收站列表数据源，slim 携带 deleted 标记）
    // 日志同权（0.4.3 验收修复⑦，用户裁决推翻 R-6 UI 隐身）：kind=log 与普通笔记同权——默认列表/默认检索均包含（可见/可搜/可编辑）；
    // includeLogs 第 5 参保留向后兼容（旧调用方传 true 语义不变——已恒为包含；显式 kind=log 过滤照常只看日志）；
    // 唯一保留的边界：注入硬禁（inject 强制 false，_create/_update 闸门 + injectForcedOff 告知）+ 目录 recall 缺省 false（0.4.4-E 起 recall 字段 dormant——目录段唯挂载行源，inject.js 无 recall 消费方）
    // sys 缺省降噪（0.4.3 验收修复⑨，用户反馈：记忆档案 12 篇挤爆默认列表）：kind=sys 机器托管笔记（注入索引/记忆档案/执行记录/遥测镜像）
    //   只在「全部」/「未分类」平铺视图排除（folder 缺省或 ''——未分类与全部同族守恒口径：不过滤 = 各文件夹 + 未分类之和）——
    //   显式入口照常显示零变化：kind 过滤 / tag 过滤 / 具体文件夹（非空 id）定向导航；日志同权语义不受影响（⑦ 红线）；
    // includeSys 第 6 参 = 机器全量视图内部通道（graph 全量重建/导出全部等需要 sys 在内的消费者显式传 true；视图/RPC 调用方不传）
    async function _list(tag, kind, folder, includeDeleted, includeLogs, includeSys) {
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
            if (tag && (note.tags || []).indexOf(tag) < 0) continue
            if (kind && note.kind !== kind) continue
            if (includeSys !== true && !kind && !tag && (folder === undefined || folder === '') && note.kind === 'sys') continue   // sys 缺省降噪（0.4.3⑨）：「全部」/「未分类」平铺视图排除；显式 kind/tag/具体文件夹入口与机器全量视图（includeSys）照常放行
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
        // ②补入条目与目录条目走**完全相同**的过滤管线（deleted/tag/kind/folder + sys 缺省降噪谓词全照原口径逐条复评），不开特例后门；
        // ③墓碑排除——purge 后条目被逐出 cache（或读入时标 tombstoned）不补入，回收站（includeDeleted）口径同样不出现。
        // 本块 host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，check.js 比对；改动必须双边同步）
        const listedIds = new Set()
        for (const ln of notes) listedIds.add(ln.id)
        for (const cn of cache.values()) {
          if (listedIds.has(cn.id)) continue   // 幂等去重：listDir 已见（loadNote 命中同一 cache 对象）
          if (cn.tombstoned) continue          // purge 墓碑（0 字节占位）：任何列表口径都不算存在
          if (cn.deleted && !includeDeleted) continue
          if (tag && (cn.tags || []).indexOf(tag) < 0) continue
          if (kind && cn.kind !== kind) continue
          if (includeSys !== true && !kind && !tag && (folder === undefined || folder === '') && cn.kind === 'sys') continue   // sys 缺省降噪谓词与主循环同口径（0.4.3⑨：补入条目零特例后门；「全部」/「未分类」平铺视图排除）
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

    // extra（工作记忆 v0 §7.2 检索字段透传 + r3 车道模型 contractType/origin 标记）：{ logDate?, entities?, summarizedAt?, contractType?, origin?, confirmClearBody? }——显式传才改（undefined 不动存量值）；confirmClearBody 为 R-1 空正文覆盖确认闸（不落盘，见 empty-body-overwrite-guard 块）
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
      // 0.4.3⑦ 第三轮补闸（notes-043 验收驳回修复）：effKind==='log' 时无条件 inject=false——强制纠正移出 inject 显式传值包裹，
      // kind-only 更新路径（update({kind:'log'}) 不传 inject）存量 inject=true 同样过闸纠正并回执 injectForcedOff:true；
      // 零放松语义：kind 改回非 log 不自动恢复 inject（保持 false，恢复须显式 inject:true 走普通路径）。
      if (effKind === 'log' && note.inject !== false) { note.inject = false; injectForcedOff = true }
      if (injectTo !== undefined) {
        // injectTo 写入归一 + 非法显式拒绝（injectto-norm-guard）：非法值整体拒绝，本条更新不落盘（错得安全）
        const ng = await _normInjectTo(injectTo)
        if (ng.error) throw new Error(ng.error)
        note.injectTo = ng.value
      }
      if (folder !== undefined) {
        // folder 写入归一 + 非法显式拒绝（folder-arg-norm）：非法值整体拒绝，本条更新不落盘（错得安全）
        note.folder = await _resolveFolderArg(folder)
      }
      if (recall !== undefined) note.recall = recall !== false
      if (injectRole !== undefined) note.injectRole = injectRole === 'reference' ? 'reference' : 'convention'
      // sensitive 第 13 位参数：显式传才改（undefined 不动存量值）
      if (sensitive !== undefined) note.sensitive = sensitive === true
      // extra 第 14 位参数（工作记忆 v0）：logDate/entities/summarizedAt 检索字段透传 + contractType/origin 车道模型标记（r3）
      const ex = extra || {}
      if (ex.logDate !== undefined) note.logDate = ex.logDate
      if (ex.entities !== undefined) note.entities = Array.isArray(ex.entities) ? ex.entities : []
      if (ex.summarizedAt !== undefined) note.summarizedAt = ex.summarizedAt
      // 定时派发·执行层：schedule 声明写入闸门（校验红线同上；机器状态字段 lastFiredAt/lastRun/lastError 由闸门延续存量）
      if (ex.schedule !== undefined) {
        const effCT = (ex.contractType !== undefined ? ex.contractType : note.contractType) || ''
        const gate = await _schedValidateWrite(ex.schedule, effCT, note.schedule)
        if (gate.error) throw new Error(gate.error)
        note.schedule = gate.value
      }
      if (ex.contractType !== undefined) {
        if ((ex.contractType || '') === SCHEDULE_CONTRACT_TYPE && !note.schedule) throw new Error('contractType=dispatch-schedule 需要 schedule 声明（schedule: { at|every, target }）')
        note.contractType = ex.contractType
      }
      if (ex.origin !== undefined) note.origin = ex.origin
      // hidden 隐藏属性（0.4.4-D）：extra 透传，显式传才改（undefined 不动存量值）；纯 UI 遮罩，host 语义零改动
      if (ex.hidden !== undefined) note.hidden = ex.hidden === true
      // ==== empty-body-overwrite-guard BEGIN ====（R-1 P0 数据丢失兜底；notes.js 与 notes.dist.js 双变体逐字节同步，check 节 46 看守）
      // 判据：body 显式传空串且现存正文非空 → 拒绝静默覆盖，抛错要求调用方显式传 extra.confirmClearBody===true 重试。
      // 选型理由（错得安全 = 失败时停在原状，而不是失败后留备份）：宁拒绝不墓碑——.bak 墓碑方案失败时已破坏现场
      // （活动正文被清空，用户面对空白笔记，要靠发现并手工找回 .bak）；拒绝方案下任何调用路径
      // （client get 失败空 body 提交 / 脚本 / 工具直调）都无法造成既成数据丢失，合法清空由显式确认放行。
      // 红线：只拦「空串覆盖非空」——undefined（不动正文）/ 空→空 / 非空覆盖照常；判据读缓存现值（loadNote 命中 cache），零新增磁盘读。
      if (body === '' && note.body && ex.confirmClearBody !== true) {
        throw new Error('notes-update 拒绝执行：body 为空串将覆盖现有非空正文（疑似 get 失败空正文覆盖路径，R-1 数据丢失防护）。如确认为有意清空，请显式传 confirmClearBody: true 重试')
      }
      // ==== empty-body-overwrite-guard END ====
      if (body !== undefined) note.body = body
      // P3 派发闭环·保底联动：显式置 resolved 时自动回执全部未闭环派发（dispatchStatus→done + doneAt + receipt='resolved'）。
      // 这是语义闭环的必然可行通道（agent 完成派发任务后 note_manage update resolved）；事件回执见 dispatch-loop 标记块
      let dispatchClosed = 0
      const dispatchClosedDs = []   // 执行记录独立笔记（notes-041-sched-runlog）：收集本次闭环条目供 runLog 追加
      if (status === 'resolved') dispatchClosed = _closeOpenDispatches(note, 'resolved', undefined, dispatchClosedDs)
      note.updatedAt = new Date().toISOString()
      // 兜底补全：约定笔记 workspace 为空（agents 未就绪期创建的存量）时按来源会话推导填入，
      // 否则“本工作区”注入范围在严格匹配下永不命中
      if (!note.workspace && note.sessionId) {
        try { note.workspace = await _wsOfSession(note.sessionId) } catch (e) {}
      }
      await persistNote(note)
      if (dispatchClosedDs.length) await _schedRunLogAppend(note, dispatchClosedDs)   // 0.4.4-A 起全笔记生效·三表归一（resolved 回执 📥 行落执行记录伴生笔记；内部全量吞异常；源笔记正文零改动红线不破）
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
    // 0.4.4-F 可选追加用户指令（弹卡引导）：args.instruction（string 可选）trim 后 ≤500 字（超限 error）；
    //   有才在【当前草稿】前插【用户追加指令】段，空/缺省路径 prompt 与二期现行逐字节等价（节 84 行为级断言锁定）；system 提示词不动。
    // 输出容错：剥离 ```markdown 围栏；空结果/LLM 不可用/未配置模型 → error（client 保留原文不动）。
    async function _aiOrganize(args) {
      const body = args && typeof args.body === 'string' ? args.body : ''
      if (!body.trim()) return { error: '正文为空，无可整理内容' }
      if (body.length > AI_ORGANIZE_MAX_CHARS) return { error: '正文过长（' + body.length + ' 字，上限 ' + AI_ORGANIZE_MAX_CHARS + ' 字），请分段整理' }
      const kind = KINDS.indexOf(args && args.kind) >= 0 ? args.kind : 'note'
      const title = args && typeof args.title === 'string' ? args.title.trim() : ''
      const instruction = args && typeof args.instruction === 'string' ? args.instruction.trim() : ''
      if (instruction.length > AI_ORGANIZE_INSTR_MAX_CHARS) return { error: '追加指令过长（' + instruction.length + ' 字，上限 ' + AI_ORGANIZE_INSTR_MAX_CHARS + ' 字），请精简后再试' }
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
        (instruction ? '【用户追加指令】\n' + instruction + '\n' : '') +
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

    // ==== conflict-check BEGIN ====（0.4.5-G 约定体检 notes-045-conflict-check：LLM 对全部注入中约定两两检测冲突/被取代对，只提名不执行——裁决动作在人）
    // （与开发版 host-impl.js 双边同步，逻辑逐行一致）
    // 背景：约定多了会打架（真实事故：日志隐身约定 vs 后来的同权裁决并存）。本通道提名「疑似冲突/疑似被取代」对，
    //   人工在注入管理面板内联结果区裁决（标 A/B 已取代 = notes-update status='superseded'；保留两者 = 会话内 dismiss）。
    // 通道：notes-when-suggest 同款 llm.stream + resolveLlmSelection（设置 LLM 优先，缺省跟随会话），temperature 0，8s Promise.race 超时。
    // 数据集谓词（行为级断言锁定）：inject=true && injectRole=convention（缺省值等同 convention） && !deleted ——
    //   _list 六参全开（含 sys：谓词即唯一选择口径，sys 降噪不在此生效）；<2 条 → { ok:true, pairs:[] } 零 LLM 调用。
    // 红线：①敏感笔记正文经 maskSensitiveBody 按行打码后才进 prompt（键留值遮，占位符引导 note_get 自取）；
    //   ②只提名不执行——本函数零写入，status 翻转只能由用户点击触发 notes-update；
    //   ③手动触发（注入管理面板「约定体检」按钮），v0 不进 cron/启动装配。
    // 计量口径（0.4.5-G 裁决）：低频手动治理功能沿用 when-suggest 豁免先例——不进 llm-usage 计量（USAGE_FEATURES 三功能口径不动，
    //   故直接迭代 llm.stream 而非 streamMetered；注册面能加 conflict 键，但计量口径变更会连带 usage 报表/UI/断言面漂移，本期注释注明暂不计量）。
    // 输出容错：剥离 ```json 围栏 → JSON.parse 失败/非数组 → { error }；逐条校验——幻觉 id（不在数据集）/aId=bId/非法 relation 条目静默过滤，
    //   reason 归一空白截断 200 字；同一无序对去重（先见者留）。
    const CONFLICT_CHECK_TIMEOUT_MS = 8000        // 与 when-suggest 同款 8s 超时
    const CONFLICT_BODY_MAX_CHARS = 2000          // 单条约定正文入 prompt 上限（超出截断标注，防 token 爆）
    const CONFLICT_REASON_MAX_CHARS = 200         // reason 归一截断上限（防御性，UI 单行呈现）
    async function _conflictCheck(args) {
      if (!llm) return { error: 'LLM 不可用（宿主无 llm 服务）' }
      let all = []
      try { all = await _list(undefined, undefined, undefined, false, true, true) } catch (e) { return { error: String(e.message || e) } }
      const conv = (all || []).filter(n => n && n.inject === true && !n.deleted && (n.injectRole || 'convention') === 'convention')
      if (conv.length < 2) return { ok: true, pairs: [], total: conv.length }
      await loadSettings()
      const sel = resolveLlmSelection()
      if (!sel || !sel.provider || !sel.model) return { error: '未配置笔记 LLM 且无会话模型可跟随（可在设置卡片选配）' }
      // 数据集落 prompt：id + 标题（去换行）+ 正文（敏感打码 / 超长截断）
      const items = conv.map(n => {
        const rawBody = String(n.body || '')
        const safeBody = n.sensitive === true ? maskSensitiveBody(rawBody, n.id) : rawBody
        const clipped = safeBody.length > CONFLICT_BODY_MAX_CHARS ? safeBody.slice(0, CONFLICT_BODY_MAX_CHARS) + '\n…（正文截断）' : safeBody
        return { id: n.id, title: String(n.title || n.id).replace(/[\r\n]+/g, ' '), body: clipped }
      })
      const listing = items.map((it, i) => '【约定 ' + (i + 1) + '】id=' + it.id + '\n标题：' + it.title + '\n正文：\n' + (it.body.trim() || '（空）')).join('\n\n')
      const prompt =
        '下面是 ' + items.length + ' 条正在注入到 AI 系统提示的「约定」笔记（每条 = id + 标题 + 正文）。\n' +
        '请两两检查它们之间是否存在以下关系：\n' +
        '1. conflict（疑似冲突）：两条约定给出相互矛盾、不可兼得的指令（同一事项一个要求做、一个要求不做，或规则互相打架）；\n' +
        '2. supersede（疑似取代）：同一主题下一条约定明显更新/覆盖了另一条，旧条继续注入会造成歧义。\n' +
        '只报告有实际内容依据的对子，不要猜测；一条约定可出现在多个对子中；没有就输出空数组 []。\n' +
        '输出：JSON 数组，每个元素 {"aId":"<id>","bId":"<id>","relation":"conflict"或"supersede","reason":"<用约定自身的语言一句话说明依据>"}。\n' +
        '只输出 JSON 数组本身，不要输出解释、前言或代码围栏。\n\n' +
        listing + '\n\n只输出 JSON 数组：'
      let timer = null
      const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('conflict-check 超时（8s）')), CONFLICT_CHECK_TIMEOUT_MS); if (timer && typeof timer.unref === 'function') timer.unref() })
      let text = ''
      try {
        await Promise.race([(async () => {
          for await (const chunk of llm.stream({
            provider: sel.provider,
            model: sel.model,
            messages: [{
              id: 'conflict-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
              role: 'user',
              content: [{ type: 'text', text: prompt }],
              source: { kind: 'user' }
            }],
            system: '你是笔记约定治理助手。检查注入中的约定笔记两两之间的冲突与取代关系，只输出 JSON 数组。',
            temperature: 0
          })) {
            if (chunk && chunk.type === 'text-delta') text += chunk.text
            if (chunk && chunk.type === 'finish') break
          }
        })(), timeout])
      } catch (e) {
        console.error('notes: conflictCheck failed', e)
        return { error: String(e.message || e) }
      } finally { if (timer) clearTimeout(timer) }
      // 输出容错：剥离整段 ```json/``` 围栏（模型偶发包代码块）；JSON.parse 失败/非数组 → error
      let raw = String(text || '').trim()
      const fence = raw.match(/^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n?```\s*$/)
      if (fence) raw = fence[1].trim()
      let arr = null
      try { arr = JSON.parse(raw) } catch (e) { return { error: 'LLM 输出非合法 JSON：' + String(e.message || e) } }
      if (!Array.isArray(arr)) return { error: 'LLM 输出非 JSON 数组' }
      const byId = {}
      for (const it of items) byId[it.id] = it
      const pairs = []
      const seen = {}
      for (const p of arr) {
        if (!p || typeof p !== 'object' || Array.isArray(p)) continue
        const aId = String(p.aId || ''), bId = String(p.bId || '')
        if (!byId[aId] || !byId[bId] || aId === bId) continue   // 幻觉 id / 自配对过滤（防御性，不计 error）
        const relation = p.relation === 'conflict' ? 'conflict' : (p.relation === 'supersede' ? 'supersede' : '')
        if (!relation) continue
        const key = (aId < bId ? aId + '|' + bId : bId + '|' + aId) + '|' + relation
        if (seen[key]) continue   // 同一无序对同关系去重（先见者留）
        seen[key] = true
        const reason = String(p.reason || '').replace(/\s+/g, ' ').trim().slice(0, CONFLICT_REASON_MAX_CHARS)
        pairs.push({ aId: aId, bId: bId, aTitle: byId[aId].title, bTitle: byId[bId].title, relation: relation, reason: reason })
      }
      return { ok: true, pairs: pairs, total: conv.length }
    }
    // ==== conflict-check END ====
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

    // ==== tmpdir-sweep BEGIN ====（0.4.6-H notes-046-smallfix 卫生小件②，R2 n-mux9tc6z76mj；trash.js ⇄ trash.dist.js 双变体同 purgeNoteFile 删除通道先例）
    // 原子写孤儿清扫：writeFileAtomic 的 staging 目录（<目标>.<pid>.<uuid>.tmpdir/）在 rename 失败/进程中断时残留，此前无任何清理路径
    //   （实证：notes/.n-mujh1qizthz3.md.29940.9fed335c-*.tmpdir/ 自 2026-09-27 残留）。
    // 时机 = apply 启动一次（fire-and-forget 不阻塞就绪；无定时器——插件重载/宿主重启即下一清扫点，摊销即防抖，写入热路径零开销）。
    // 红线：只删 mtime 超过 24h 的 *.tmpdir 目录——在途写的 staging 恒新（秒级生命周期），24h 阈值天然不动在途写；逐条 try/catch 全吞。
    // 删除通道：ctx.fs 契约无删除也无 mtime —— 经 fs.processPath 还原进程路径 + node:fs stat/rm（同 purgeNoteFile 静态包先例）；
    //   能力缺失（宿主 fs 无 processPath / stat 失败）→ 静默跳过，留待下次启动，不报错不扩散。开发版变体（trash.js）= 空操作（无 node:fs）。
    const TMPDIR_ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000
    async function sweepTmpdirOrphans() {
      try {
        if (!fsNode || !fsNode.promises) return
        if (!fs || typeof fs.processPath !== 'function') return
        const dirTarget = await fs.resolve(NOTES_DIR)
        const info = await fs.stat(dirTarget)
        if (!info) return
        const entries = await fs.listDir(dirTarget)
        const cutoff = Date.now() - TMPDIR_ORPHAN_MAX_AGE_MS
        for (const en of entries || []) {
          try {
            const nm = en && en.name
            if (!nm || nm.slice(-7) !== '.tmpdir') continue
            if (en.type && en.type !== 'directory') continue
            const pp = fs.processPath(en.target ? en.target : await fs.resolve(path.join(NOTES_DIR, nm)))
            if (!pp) continue
            const st = await fsNode.promises.stat(pp)
            if (!st || !st.isDirectory()) continue
            if (!(st.mtimeMs < cutoff)) continue   // 在途写豁免：只删 >24h 孤儿
            await fsNode.promises.rm(pp, { recursive: true, force: true })
          } catch (e) {}
        }
      } catch (e) {}
    }
    // ==== tmpdir-sweep END ====

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
      _emitNoteChanged({ event: 'purge', id: id })   // 事件总线单点分发（0.4.3+ notes-043-event-bus；彻底删除不经 persistNote）
      return { id: id, purged: true, mode: mode, historyPurged: historyPurged }
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
    // 日志同权（0.4.3 验收修复⑦）：kind=log 默认包含（可见/可搜同权）；args.includeLogs 保留为兼容 no-op（_list 注释承接）
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
    // client 实现源码下发：开发版 bootstrap 壳通过它加载 client 实现（同理避免 define 传大字符串）。
    // 开发目录存在模块清单时按 src/client/manifest.js 逐字节拼接（与 scripts/concat-client.cjs 同一解析规则：
    // 单引号路径一行一条，LF 归一，零插入零改写；@shared/ 条目 = src/shared/ 两态物理共源块，
    // client 态纳入时逐非空行加 4 空格基座缩进——apply 体层级）；纯安装环境无开发目录，回退包内产物 lib/client.js。
    // host 源候选：开发目录存在 manifest.dev.js 时按 src/host/** 逐字节拼接（与 client 分支同一解析规则）；纯安装环境回退包内 index.mjs。
    disposers.push(handle('notes-src', async (args) => {
      try {
        const which = args && args.which === 'client' ? 'client' : 'host'
        if (which === 'client') {
          const manifestPath = path.join(LEGACY_PLUGIN_DIR, 'src', 'client', 'manifest.js')
          if (fsNode.existsSync(manifestPath)) {
            const list = (String(fsNode.readFileSync(manifestPath, 'utf8')).match(/'[^'\n]+'/g) || []).map(s => s.slice(1, -1))
            let src = ''
            for (const rel of list) {
              if (rel.indexOf('@shared/') === 0 || rel.indexOf('@i18n/') === 0) {
                // @i18n/ 条目 = src/i18n/ 双语字典（notes-042-i18n-mech），共源 + 基座缩进规则与 @shared/ 完全一致
                const shared = fsNode.readFileSync(path.join(LEGACY_PLUGIN_DIR, 'src', rel.indexOf('@shared/') === 0 ? 'shared' : 'i18n', rel.slice(rel.indexOf('/') + 1)), 'utf8')
                src += String(shared).replace(/\r\n/g, '\n').split('\n').map(l => l ? '    ' + l : l).join('\n')
              } else {
                src += fsNode.readFileSync(path.join(LEGACY_PLUGIN_DIR, 'src', 'client', rel), 'utf8')
              }
            }
            return { src: src.replace(/\r\n/g, '\n') }
          }
          return { src: fsNode.readFileSync(path.join(PKG_DIR, 'lib', 'client.js'), 'utf8') }
        }
        const hostManifest = path.join(LEGACY_PLUGIN_DIR, 'src', 'host', 'manifest.dev.js')
        if (fsNode.existsSync(hostManifest)) {
          const hlist = (String(fsNode.readFileSync(hostManifest, 'utf8')).match(/'[^'\n]+'/g) || []).map(s => s.slice(1, -1))
          let hsrc = ''
          for (const rel of hlist) hsrc += fsNode.readFileSync(path.join(LEGACY_PLUGIN_DIR, 'src', 'host', rel), 'utf8')
          return { src: hsrc.replace(/\r\n/g, '\n') }
        }
        return { src: fsNode.readFileSync(path.join(PKG_DIR, 'index.mjs'), 'utf8') }
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // args.includeDeleted（回收站行预览 notes-trash-batch-preview）：已软删笔记正文只读可达（缺省拒绝，编辑器链路口径不变）；墓碑仍拒绝
    disposers.push(handle('notes-get', async (args) => {
      try {
        const n = args && args.includeDeleted ? await _getDeleted(args.id) : await _get(args.id)
        _recallHit('get', [n.id])   // 召回遥测（0.4.3+ 卡⑫ notes-043-inject-receipt）：get 通道取用信号日聚合（成功返回才计；静默降级）
        const s = slim(n); s.body = n.body; return { note: s }
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // ==== notes-get-batch BEGIN ====（N+1 批量端点 notes-034-batch3：双包同源——server.js 与 server.dist.js 本块逐字节一致，check 节 49 看守）
    // 首屏双链索引等「全库正文」场景的批量通道：一次调用拉全补缺/过期条目，请求数 O(n)→O(1)（证据 n-mut6u356mloa：76 条库 159 次 notes-get）。
    // 选型（弃 notes-list?includeBodies）：①消费方语义是「按 id 补缺 reconcile」，增量刷新只传 stale ids 省传输（includeBodies 每次全库往返）；
    //   ②notes-list 既有 slim 契约零风险（注入管理等调用方依赖瘦身列表）；③ids 数组给调用方留分片闸口。
    // 入参 {ids:[...]}；返回 { notes:[{id,body,updatedAt}], missing:[id...] }——最小传输面（正文三字段）；已删/墓碑/不存在条目计入 missing 不报错（调用方按缺口径下轮重试）。
    disposers.push(handle('notes-get-batch', async (args) => {
      try {
        const ids = (args && Array.isArray(args.ids)) ? args.ids : []
        const out = [], missing = []
        for (const id of ids) {
          try { const n = await _get(id); out.push({ id: n.id, body: n.body || '', updatedAt: n.updatedAt || '' }) }
          catch (e) { missing.push(id) }
        }
        return { notes: out, missing: missing }
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // ==== notes-get-batch END ====
    // 工作记忆 v0：kind=log 日志经同一 _create（隐身硬闸在内部生效）；logDate/entities/summarizedAt 检索字段透传（§7.2 往返预留）
    disposers.push(handle('notes-create', async (args) => {
      try {
        const ctErr = schedPublicContractTypeError(args && args.contractType)   // 定时派发：公共写入口 contractType 白名单（'' / dispatch-schedule）
        if (ctErr) return { error: ctErr }
        return await _create(args.title, args.body, args.tags, args.topic, { kind: args.kind, status: args.status, inject: args.inject, injectRole: args.injectRole, injectTo: args.injectTo, folder: args.folder, recall: args.recall, sensitive: args.sensitive, hidden: args.hidden, logDate: args.logDate, entities: args.entities, summarizedAt: args.summarizedAt, contractType: args.contractType, origin: args.origin, schedule: args.schedule })
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // R-1：confirmClearBody 透传 _update 空正文覆盖兜底闸（body:'' 覆盖非空正文需显式确认，见 notes.dist.js empty-body-overwrite-guard 块）
    disposers.push(handle('notes-update', async (args) => {
      try {
        const ctErr = schedPublicContractTypeError(args && args.contractType)   // 定时派发：公共写入口 contractType 白名单（'' / dispatch-schedule）
        if (ctErr) return { error: ctErr }
        return await _update(args.id, args.title, args.body, args.tags, args.topic, args.kind, args.status, args.inject, args.injectTo, args.folder, args.recall, args.injectRole, args.sensitive, { logDate: args.logDate, entities: args.entities, summarizedAt: args.summarizedAt, contractType: args.contractType, origin: args.origin, schedule: args.schedule, hidden: args.hidden, confirmClearBody: args.confirmClearBody === true })
      } catch (e) { return { error: String(e.message || e) } }
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

    // 二期 ✨整理：{id?, body, kind, title?} → LLM 按 kind 模板重写正文，返回 { ok, body, kind }（不落盘，client 替换编辑器 + 一次撤销栈）
    disposers.push(handle('notes-ai-organize', async (args) => {
      try { return await _aiOrganize(args || {}) } catch (e) { return { error: String(e.message || e) } }
    }))

    // ==== when-suggest BEGIN ====（0.4.3 验收修复 notes-043-preview-when-edit：server.js 与 server.dist.js 本块逐字节一致，check 节 73 看守）
    // notes-when-suggest {id} → LLM 生成 whenToUse 单行草稿（挂载弹层预填数据源；仅用户主动触发——资料开注入/预览目录行点击，不批量后台跑）。
    // 同构 llm/usage-classify.js 调用模式：resolveLlmSelection（settingsCache.llm provider+model 齐备优先，否则跟随会话 adm.currentSelection）；
    //   prompt = 标题 + 正文前 1200 字摘要，要求随笔记语言输出一行 ≤40 字「何时查我」。
    // 红线：无 LLM / 未配置 / 笔记缺失 / 异常 / 8s 超时 → 一律 { error }（client 静默回退预填标题，草稿失败绝不阻断挂载）；
    //   草稿为低频用户主动触发，不进 llm-usage 计量（USAGE_FEATURES 三功能口径不动）。
    const WHEN_SUGGEST_TIMEOUT_MS = 8000
    disposers.push(handle('notes-when-suggest', async (args) => {
      try {
        if (!args || !args.id) return { error: 'notes-when-suggest 需要 id' }
        if (!llm) return { error: 'llm 不可用' }
        let n = null
        try { n = await loadNote(String(args.id)) } catch (e) { return { error: 'notes-when-suggest: 笔记不存在' } }
        if (!n || n.deleted || n.tombstoned) return { error: 'notes-when-suggest: 笔记不存在' }
        await loadSettings()
        const sel = resolveLlmSelection()
        if (!sel || !sel.provider || !sel.model) return { error: 'llm 未配置' }
        const excerpt = String(n.body || '').replace(/\s+/g, ' ').trim().slice(0, 1200)
        const prompt = '笔记标题：' + String(n.title || '').replace(/[\r\n]+/g, ' ') + '\n\n笔记正文摘要：\n' + (excerpt || '（空）') + '\n\n请用笔记自身的语言，输出一行「何时查我」（whenToUse）：描述 Agent 在什么场景下应该查阅这条笔记。只输出这一行本身，不超过 40 字，不要解释、引号、结尾标点或换行。'
        let timer = null
        const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('when-suggest 超时（8s）')), WHEN_SUGGEST_TIMEOUT_MS); if (timer && typeof timer.unref === 'function') timer.unref() })
        let text = ''
        try {
          await Promise.race([(async () => {
            for await (const chunk of llm.stream({
              provider: sel.provider,
              model: sel.model,
              messages: [{
                id: 'when-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                role: 'user',
                content: [{ type: 'text', text: prompt }],
                source: { kind: 'user' }
              }],
              system: '你是笔记挂载助手，为笔记生成一行极简的「何时查我」使用场景说明。',
              temperature: 0
            })) {
              if (chunk && chunk.type === 'text-delta') text += chunk.text
              if (chunk && chunk.type === 'finish') break
            }
          })(), timeout])
        } finally { if (timer) clearTimeout(timer) }
        const one = Array.from(String(text || '').split('\n')[0].trim().replace(/^["'「」『』\s]+|["'「」『』。；;，,\.\s]+$/g, '')).slice(0, 40).join('')
        if (!one) return { error: 'llm 空输出' }
        return { ok: true, id: String(args.id), suggestion: one }
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // ==== when-suggest END ====

    // ==== conflict-check BEGIN ====（0.4.5-G 约定体检 notes-045-conflict-check：server.js 与 server.dist.js 本块逐字节一致，check 节 90 看守）
    // notes-conflict-check {} → LLM 对全部注入中约定（inject=true && injectRole=convention && !deleted）两两检测冲突/被取代对，返回 { ok, pairs:[{aId,bId,aTitle,bTitle,relation,reason}], total }。
    // 只提名不执行：本通道零写入——「标已取代」裁决动作由 client 走既有 notes-update status='superseded'；敏感笔记正文打码后才进 prompt（maskSensitiveBody，llm/conflict.js 内）；
    //   <2 条约定 → { ok, pairs: [] } 零 LLM 调用；LLM 不可用/未配置/超时（8s）/输出非合法 JSON → { error }（client 内联回显，不阻断面板）。
    disposers.push(handle('notes-conflict-check', async (args) => {
      try { return await _conflictCheck(args || {}) } catch (e) { return { error: String(e.message || e) } }
    }))
    // ==== conflict-check END ====

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

    // 扩展名 → mime（GET 路由 Content-Type 白名单；.jpg/.jpeg 双形态）
    const ASSET_EXT_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }

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

    // ==== notes-graph BEGIN ====（0.4.3 内核①：四类边统一扫描建图 + 增量维护 + 图查询 RPC，notes-043-graph；0.4.3+ notes-043-graph-registry：边类型收敛为 EDGE_REGISTRY 声明式描述符——扩展新边类型 = 追加一个描述符，行为零变化）
    // EDGE_REGISTRY 描述符契约（声明式注册表，非继承——同 RootNoteTpl 先例；差异只在「提取方式 / 死链语义」两个数据维度）：
    //   type          边类型名（GRAPH_EDGE_TYPES 由注册表派生 → notes-graph RPC type 过滤白名单/byType 键/死链清单 type 字段自动跟随）
    //   extract(note, cache) 纯函数：只读 n（cache 供同笔记多描述符共享一次正文扫描），返回出现清单 [{ target, meta }]
    //   deadLinkable  目标解析不中是否计死链：true = 走解析/置死/raw 复活通道；false = 命名空间边永不死链（dispatch 承载 to=session:<id> 语义）
    //   resolve       仅 deadLinkable:true：'full' = id 精确 + 全库标题精确（与 client 反向链接同口径）| 'id' = 仅 id 精确（softref 软链口径）
    //   deadVia       仅 deadLinkable:true：死链时 via 回退值（link/mount='raw' 保留原始形态供复活比对；softref='id'——runLog 写的就是 id）
    //   via           仅 deadLinkable:false：入图 via（dispatch='session'）
    // 四描述符：link（正文 [[双链]] 行内引用）/ mount（行首列表项挂载行，注入索引根笔记 §1 形态）/
    //   softref（front-matter 软链 schedule.runLog 执行记录）/ dispatch（派发记录 → 会话命名空间，永不死链）。
    // 红线：①只读挂载——本模块零改写笔记内容（onNoteChanged 监听只在内存图上做增量，落盘载荷原样透传）；
    //       ②图是派生物——全量重建 _graphRebuild 随时可做（notes-graph {rebuild:true}），增量异常一律降级
    //       built=false，下次查询自动全量重建自愈（错得安全：宁可重建不报错卡死）。
    // 双包共源：本文件物理单份，manifest.dev.js / manifest.dist.js 同名登记（check 节 45/71 看守）。
    // 命名纪律：双链词法与 client 内核同一口径（target 不含方括号/换行），但符号独立命名——host 不引入 client 内核符号。
    const EDGE_REGISTRY = [
      { type: 'link', deadLinkable: true, resolve: 'full', deadVia: 'raw', extract: function (n, cache) { if (!cache.body) cache.body = _graphBodyScan(n); return cache.body.link } },
      { type: 'softref', deadLinkable: true, resolve: 'id', deadVia: 'id', extract: _graphSoftrefOccs },
      { type: 'mount', deadLinkable: true, resolve: 'full', deadVia: 'raw', extract: function (n, cache) { if (!cache.body) cache.body = _graphBodyScan(n); return cache.body.mount } },
      { type: 'dispatch', deadLinkable: false, via: 'session', extract: _graphDispatchOccs }
    ]
    // nodes: id → { title, dead }（dead=软删/清除后不再作解析目标）；edges: [{from,to,raw,type,via,dead,meta}]
    //   raw = 双链原始 target（死链保留原始形态供复活比对）；via = 'id'|'title'|'raw'|'session'（解析路径）
    const graphState = { built: false, edges: [], nodes: {} }
    const GRAPH_EDGE_TYPES = EDGE_REGISTRY.map(function (d) { return d.type })
    const GRAPH_LINK_RE = /\[\[([^\[\]\r\n]+)\]\]/g
    const GRAPH_MOUNT_RE = /^\s*(?:[-*]|\d+[.)])\s+\[\[([^\[\]\r\n]+)\]\]/
    const GRAPH_SESSION_NS = 'session:'
    function _graphSortKey(e) { return e.from + '\u0000' + e.to + '\u0000' + e.type }
    // 死链复活/改名复估共用：指向 id 的存活边 → 置死（to 回退 raw 原始形态）
    function _graphKillEdgesTo(id) {
      for (const e of graphState.edges) {
        if (!e.dead && e.to === id) { e.dead = true; e.to = e.raw }
      }
    }
    // 按当前库解析 target：id 精确优先、标题全库精确匹配（与 client 反向链接同一口径）；不中 → null（死链）
    function _graphResolve(target) {
      const n = graphState.nodes[target]
      if (n && !n.dead) return { id: target, via: 'id' }
      for (const id in graphState.nodes) {
        const nd = graphState.nodes[id]
        if (!nd.dead && nd.title && nd.title === target) return { id: id, via: 'title' }
      }
      return null
    }
    // ---- EDGE_REGISTRY 提取器（纯函数：只读入参，不触库不改写）----
    // 正文出现扫描（link/mount 共享一次）：挂载行只归该行的那一处出现（摘出后行内余文照常按 link 扫），其余出现 = link；
    // 按 target×type 去重（meta.count 记出现次数），link/mount 两组各自保持首次出现序
    function _graphBodyScan(n) {
      const body = String(n.body || '')
      const seen = {}
      const add = function (target, type) {
        const key = target + '\u0000' + type
        if (!seen[key]) seen[key] = { target: target, type: type, count: 0 }
        seen[key].count++
      }
      let rest = ''
      for (const ln of body.split(/\r?\n/)) {
        const m = ln.match(GRAPH_MOUNT_RE)
        if (m) { add(m[1], 'mount'); rest += ln.slice(0, ln.indexOf(m[0])) + ln.slice(ln.indexOf(m[0]) + m[0].length) + '\n' }
        else rest += ln + '\n'
      }
      let m2
      GRAPH_LINK_RE.lastIndex = 0
      while ((m2 = GRAPH_LINK_RE.exec(rest)) !== null) add(m2[1], 'link')
      const link = [], mount = []
      for (const k in seen) {
        const it = seen[k]
        ;(it.type === 'mount' ? mount : link).push({ target: it.target, meta: { count: it.count } })
      }
      return { link: link, mount: mount }
    }
    // softref 提取：执行记录软链——schedule.runLog（调度派发源）+ 顶层 runLog（0.4.4-A 非调度派发源的执行记录伴生笔记软链）；
    //   自链排除；目标不存在同样计死链；两键独立成边（meta.key 区分来源）
    function _graphSoftrefOccs(n) {
      const out = []
      if (n.schedule && n.schedule.runLog && String(n.schedule.runLog) !== n.id) out.push({ target: String(n.schedule.runLog), meta: { key: 'schedule.runLog' } })
      if (n.runLog && String(n.runLog) !== n.id) out.push({ target: String(n.runLog), meta: { key: 'runLog' } })
      return out
    }
    // dispatch 提取：派发记录（to = session:<sessionId> 会话命名空间，不属笔记库；status 为记录时点快照，done 布尔向后兼容）
    function _graphDispatchOccs(n) {
      const out = []
      for (const d of (n.dispatches || [])) {
        if (!d || !d.sessionId) continue
        out.push({ target: GRAPH_SESSION_NS + d.sessionId, meta: { at: d.at || '', status: d.dispatchStatus || (d.done === true ? 'done' : 'sent') } })
      }
      return out
    }
    // 注册表收口：单描述符出现清单 → 边（统一自链排除；deadLinkable 走解析/死链/raw 复活通道，否则命名空间边原样入图永不置死）
    function _graphEdgesOf(d, n, cache) {
      const out = []
      for (const o of d.extract(n, cache)) {
        if (o.target === n.id) continue   // 自链不入图（反向链接面板同口径；dispatch target 为 session 命名空间天然不中）
        if (d.deadLinkable) {
          const r = d.resolve === 'id'
            ? (graphState.nodes[o.target] && !graphState.nodes[o.target].dead ? { id: o.target, via: 'id' } : null)
            : _graphResolve(o.target)
          out.push({ from: n.id, to: r ? r.id : o.target, raw: o.target, type: d.type, via: r ? r.via : d.deadVia, dead: !r, meta: o.meta })
        } else {
          out.push({ from: n.id, to: o.target, raw: o.target, type: d.type, via: d.via, dead: false, meta: o.meta })
        }
      }
      return out
    }
    // 单笔记边提取：遍历 EDGE_REGISTRY 逐描述符收口（扩展 = 注册表追加描述符，此处与查询/死链通道零改动）
    function _graphEdgesFor(n) {
      const out = []
      if (!n || n.deleted === true || n.tombstoned) return out
      const cache = {}
      for (const d of EDGE_REGISTRY) {
        const es = _graphEdgesOf(d, n, cache)
        for (const e of es) out.push(e)
      }
      return out
    }
    // 全量重建（复用 _list：含 kind=log——日志正文双链覆盖「相关笔记」节；排除软删；includeSys=true 机器全量视图——
    //   索引挂载边/记忆档案双链/runLog softref 的解析目标均为 kind=sys，0.4.3⑨ 缺省降噪只作用于平铺视图，图内核必须全量否则会造死链假象）
    async function _graphRebuild() {
      const all = await _list(undefined, undefined, undefined, false, true, true)
      const nodes = {}
      for (const n of all) nodes[n.id] = { title: n.title || '', dead: false }
      graphState.nodes = nodes
      graphState.edges = []
      for (const n of all) graphState.edges = graphState.edges.concat(_graphEdgesFor(n))
      graphState.built = true
      return graphState
    }
    async function _graphEnsure() { if (!graphState.built) await _graphRebuild(); return graphState }
    // 增量·节点 upsert（create/update/restore 共用；restore = 删除态笔记重新 persistNote(deleted:false) 同通道覆盖）
    function _graphUpsert(n) {
      if (!graphState.built) return
      const prev = graphState.nodes[n.id]
      const title = n.title || ''
      if (prev && prev.title && prev.title !== title) {
        // 改名：原经旧标题解析指向本笔记的存活边 → 复估置死（raw 保留旧标题，下轮 revive 不误复活）
        for (const e of graphState.edges) { if (!e.dead && e.to === n.id && e.via === 'title') { e.dead = true; e.to = e.raw } }
      }
      graphState.nodes[n.id] = { title: title, dead: false }
      // 死链复活：raw 命中本笔记 id 或当前标题（他链指向本笔记，先前目标不存在/已删）
      for (const e of graphState.edges) {
        if (e.dead && e.from !== n.id && (e.raw === n.id || (!!title && e.raw === title))) { e.dead = false; e.to = n.id; e.via = e.raw === n.id ? 'id' : 'title' }
      }
      _graphDropFrom(n.id)
      graphState.edges = graphState.edges.concat(_graphEdgesFor(n))
    }
    function _graphDropFrom(id) { graphState.edges = graphState.edges.filter(function (e) { return e.from !== id }) }
    // 增量·节点移除（软删/清除共用）：级联删该节点全部出边 + 指向它的存活边置死（死链 = to 不存在）
    function _graphRemove(id) {
      if (!graphState.built) return
      _graphDropFrom(id)
      _graphKillEdgesTo(id)
      if (graphState.nodes[id]) graphState.nodes[id].dead = true
    }
    // 增量钩子·事件总线监听（0.4.3+ notes-043-event-bus：persistNote/_purge 洋葱包裹 → onNoteChanged 单点注册表）：
    //   create/update/delete/restore/archive/派发记录/runLog 回写全部经 persistNote 落盘 → 总线单点分发；
    //   purge 事件由 _purge 落盘成功后分发（彻底删除不经 persistNote，cache.delete 直通），载荷只带 id。
    //   注册序 = 执行序、监听者异常隔离由总线保证；本监听仍保留降级兜底（增量异常 → built=false，下次查询全量重建自愈）。
    onNoteChanged(function (ev) {
      try {
        if (!ev) return
        if (ev.event === 'purge') { _graphRemove(ev.id); return }
        const n = ev.note
        if (n && n.id) { if (n.deleted === true) _graphRemove(n.id); else _graphUpsert(n) }
      } catch (e) { graphState.built = false }
    })
    function _graphByType(es) {
      const o = {}
      for (const t of GRAPH_EDGE_TYPES) o[t] = 0
      for (const e of es) o[e.type] = (o[e.type] || 0) + 1
      return o
    }
    // 图查询 RPC：notes-graph {id?, type?, direction?, rebuild?}
    //   无 id：全图概览 { nodes, edges, byType, dead:[{from,target,type}], types }
    //   有 id：{ id, exists, out, back, counts:{out,back}, byType }
    //   direction：'out'|'in'|'both'（缺省 both）；type：单类型过滤（白名单 = GRAPH_EDGE_TYPES，注册表派生）；rebuild:true 强制全量重建（增量一致性对照口）
    disposers.push(handle('notes-graph', async (args) => {
      try {
        const a = args || {}
        if (a.rebuild || !graphState.built) await _graphRebuild()
        const et = a.type !== undefined && a.type !== null && a.type !== '' ? String(a.type) : undefined
        if (et !== undefined && GRAPH_EDGE_TYPES.indexOf(et) < 0) return { error: 'notes-graph type 须为 ' + GRAPH_EDGE_TYPES.join('/') + '（实得 ' + et + '）' }
        const dir = ['out', 'in', 'both'].indexOf(a.direction) >= 0 ? a.direction : 'both'
        const filt = function (es) { return es.filter(function (e) { return !et || e.type === et }) }
        if (a.id !== undefined && a.id !== null && a.id !== '') {
          const id = String(a.id)
          const node = graphState.nodes[id]
          const allOut = filt(graphState.edges.filter(function (e) { return e.from === id }))
          const allBack = filt(graphState.edges.filter(function (e) { return e.to === id && !e.dead && e.from !== id }))
          const out = dir === 'in' ? [] : allOut
          const back = dir === 'out' ? [] : allBack
          return { id: id, exists: !!(node && !node.dead), out: out, back: back, counts: { out: allOut.length, back: allBack.length }, byType: _graphByType(allOut.concat(allBack)) }
        }
        const es = filt(graphState.edges)
        const dead = es.filter(function (e) { return e.dead }).map(function (e) { return { from: e.from, target: e.raw, type: e.type } })
        let live = 0
        for (const id in graphState.nodes) { if (!graphState.nodes[id].dead) live++ }
        return { nodes: live, edges: es.length, edgeList: es, byType: _graphByType(es), dead: dead, types: GRAPH_EDGE_TYPES }
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // ==== notes-graph END ====
    // ==== rootnote BEGIN ====（0.4.3 内核②：RootNote 托管节框架，notes-043-rootnote。
    // 目标：把「机器托管的根笔记自动节」从 runLog 专属实现提炼为一套通用框架——
    //   RootNoteTpl 模板声明式描述：锚点节标题（'## §名'）/ 行格式（lineOf 消费者注入）/
    //   排序（newestFirst 新→旧缺省）/ 容量上限（max 裁尾）/ 幂等键（keyOfLine/keyOfEntry 去重）/ 软链键（linkOf/writeLink）/
    //   preText（0.4.4-A：可选说明块——创建正文 = preText + head 锚点行；pre 区节外零触碰逐字节保留，同 injectindex 说明块先例）。
    // 红线（迁就现状格式，不是反过来）：
    //   ①节外零触碰——锚点节标题行与用户手写备注区逐字节保留；托管笔记其余正文原样；
    //   ②节锚点不存在则创建（首写时 pre 缺省补锚点行）；
    //   ③幂等——同幂等键条目已存在跳过（崩溃重放/双通道回执防御）；
    //   ④容量裁尾——合并序保留前 max 条（缺省新→旧 = 保最新裁最旧）；
    //   ⑤机器产物零历史快照——托管笔记创建/追加/摘行一律 persistNote { history:false }。
    // 创建级锁（0.4.3+ notes-043-ensure-lock）：rootNoteCreateLock 模块级单链串行化懒创建读-改-写窗口（见下方标记），
    //   索引（injectindex.js idxEnsure）/档案（ledger.js）/runLog（本框架 ensure）三消费点共用，并发首建不再产孤儿文件。
    // 依赖序位：本文件消费前位模块的 _create / loadNote / persistNote（notes.js / kernel/persist.js），被后位 schedule.js 消费。
    const ROOTNOTE_MAX_DEFAULT = 50
    // 模板归一：缺省补齐（head 必填；max 缺省 50；newestFirst 缺省 true；行格式缺省按 /^-\s/ 识别条目行、整行为幂等键）
    function rootNoteTpl(tpl) {
      return Object.assign({ max: ROOTNOTE_MAX_DEFAULT, newestFirst: true, lineRe: /^-\s/ }, tpl || {})
    }
    // 行幂等键：keyOfLine 注入优先，缺省整行
    function rootNoteKeyOfLine(tpl, line) { return tpl.keyOfLine ? tpl.keyOfLine(line) : line }
    // 节切分（纯函数）：body → { pre（至锚点行含；无锚点 = [锚点行]）, entries（条目行）, others（非条目非空行=用户手写备注） }
    //   无锚点时 rest = 全部行（迁就现状：与 runLog 原实现同口径，既有正文不丢，锚点行补在最前）
    function rootNoteSplit(body, tpl) {
      tpl = rootNoteTpl(tpl)
      const lines = String(body || '').split('\n')
      let headIdx = -1
      for (let i = 0; i < lines.length; i++) { if (lines[i].trim() === tpl.head) { headIdx = i; break } }
      const pre = headIdx >= 0 ? lines.slice(0, headIdx + 1) : [tpl.head]
      const rest = headIdx >= 0 ? lines.slice(headIdx + 1) : lines
      const entries = rest.filter(function (l) { return tpl.lineRe.test(l) })
      const others = rest.filter(function (l) { return !tpl.lineRe.test(l) && l.trim() !== '' })
      return { pre: pre, entries: entries, others: others }
    }
    // 节重写（纯函数）：pre + 空行 + 合并条目（新条目按排序入队 + 旧条目，按行幂等键去重，≤max 裁尾）+（备注区）
    function rootNoteRender(body, tpl, newLines) {
      tpl = rootNoteTpl(tpl)
      const sec = rootNoteSplit(body, tpl)
      const all = tpl.newestFirst === false ? sec.entries.concat(newLines) : newLines.concat(sec.entries)
      const seen = {}
      const merged = []
      for (const l of all) {
        const key = rootNoteKeyOfLine(tpl, l)
        if (seen[key]) continue
        seen[key] = true
        merged.push(l)
        if (merged.length >= (tpl.max || ROOTNOTE_MAX_DEFAULT)) break
      }
      let out = sec.pre.concat(['']).concat(merged)
      if (sec.others.length) out = out.concat(['']).concat(sec.others)
      return out.join('\n') + '\n'
    }
    // sys 归位（0.4.3⑥ notes-043-sys-kind）：存量托管笔记 kind 元数据迁移到 sys——只写 kind（正文/其余字段零变化红线），
    //   { history:false } 机器产物零历史快照；异常吞（迁移失败不阻塞主链路，下次 ensure 重试）
    async function rootNoteEnsureSysKind(n) {
      try {
        if (n && n.kind !== 'sys') {
          n.kind = 'sys'
          n.updatedAt = new Date().toISOString()
          await persistNote(n, { history: false })
        }
      } catch (e) {}
      return n
    }
    // 托管笔记解析：id 存活（非软删/非墓碑）→ 笔记，否则 null
    async function rootNoteResolve(id) {
      if (!id) return null
      try { const t = await loadNote(String(id)); if (t && !t.deleted && !t.tombstoned) return t } catch (e) {}
      return null
    }
    // 创建级锁（0.4.3+ notes-043-ensure-lock）：模块级单链 Promise（同 notes.js quickChain 模式）串行化全部
    //   「托管根笔记懒创建」的「存在性检查 → 创建 → 软链回写」读-改-写窗口——索引/档案/runLog 并发首建竞态
    //   （两个并发 ensure 各建一篇 → 盘上孤儿文件，软链指针只留其一）由此消除；单 host 进程内串行即可，不引跨进程锁。
    // 红线：①快路径零开销——命中既有根笔记的 ensure 不进锁（锁只覆盖创建窗口，并发 mount 正常路径不变慢）；
    //       ②失败不断链——创建抛错链不挂（.then 双参吞尾），后续调用仍可重试创建（死锁防护）；
    //       ③锁内不得再入队本链（同链重入 = 自死锁）——现消费者锁内仅 _create/persistNote/saveSettings/loadNote，无递归 ensure。
    let _rootNoteCreateChain = Promise.resolve()
    function rootNoteCreateLock(work) {
      const run = _rootNoteCreateChain.then(work)
      _rootNoteCreateChain = run.then(function () {}, function () {})
      return run
    }
    // ensure：软链（linkOf）失效/缺省 → 懒创建托管笔记（标题/类别/文件夹/主题随 tpl.hostNote 派生）+ writeLink 软链回写；
    //   创建窗口经 rootNoteCreateLock 串行化（notes-043-ensure-lock），锁内双检——并发 ensure 同 hostNote 时后者命中前者产物复用
    async function rootNoteEnsure(hostNote, tpl) {
      tpl = rootNoteTpl(tpl)
      const rl = await rootNoteResolve(tpl.linkOf ? tpl.linkOf(hostNote) : null)
      if (rl) { if (tpl.kind === 'sys') await rootNoteEnsureSysKind(rl); return rl }   // sys 模板才做存量 kind 迁移（非 sys 模板零触碰）
      return rootNoteCreateLock(async function () {
        // 锁内双检：重读宿主最新软链（调用方可能持陈旧快照——writeLink 经 persistNote 落缓存副本，此处读缓存权威）；
        //   宿主并发删除时回退入参快照（与原行为一致：仍按入参派生创建）
        const freshHost = await rootNoteResolve(hostNote.id)
        const rl2 = await rootNoteResolve(tpl.linkOf ? tpl.linkOf(freshHost || hostNote) : null)
        if (rl2) { if (tpl.kind === 'sys') await rootNoteEnsureSysKind(rl2); return rl2 }
        const cr = await _create(
          tpl.titleOf ? tpl.titleOf(hostNote) : String(hostNote.title || hostNote.id),
          (tpl.preText || '') + tpl.head + '\n', [],
          tpl.topicOf ? tpl.topicOf(hostNote) : '未分类',
          { kind: tpl.kind || 'note', folder: tpl.folderOf ? tpl.folderOf(hostNote) : undefined }
        )
        if (!cr || !cr.id) return null
        if (tpl.writeLink) await tpl.writeLink(hostNote, cr.id)
        return rootNoteResolve(cr.id)
      })
    }
    // 追加（幂等 + 裁尾 + 落盘）：entries 按时序旧→新传入；框架按排序自行倒序（新→旧时新条目在合并序前列）；
    //   entry 幂等键经 keyOfEntry（缺省行落键）；命中正文已存在跳过；返回是否落盘
    async function rootNoteAppend(rl, tpl, entries) {
      tpl = rootNoteTpl(tpl)
      const curBody = String(rl.body || '')
      const newLines = []
      const ordered = tpl.newestFirst === false ? entries : entries.slice().reverse()
      for (const d of ordered) {
        const line = tpl.lineOf(d)
        const key = tpl.keyOfEntry ? tpl.keyOfEntry(d) : rootNoteKeyOfLine(tpl, line)
        if (curBody.indexOf(key) >= 0) continue
        newLines.push(line)
      }
      if (!newLines.length) return false
      rl.body = rootNoteRender(curBody, tpl, newLines)
      rl.updatedAt = new Date().toISOString()
      await persistNote(rl, { history: false })
      return true
    }
    // 组合口（runLog 首消费者）：ensure + append，返回托管笔记或 null（异常由消费者吞）
    async function rootNoteAppendEnsured(hostNote, tpl, entries) {
      const items = (entries || []).filter(Boolean)
      if (!items.length) return null
      const rl = await rootNoteEnsure(hostNote, tpl)
      if (!rl) return null
      await rootNoteAppend(rl, tpl, items)
      return rl
    }
    // 按幂等键摘除条目行（removeLine）：节外零触碰——锚点行/备注区逐字节保留；无锚点或键未命中零改动；返回是否落盘
    async function rootNoteRemoveLine(rl, tpl, key) {
      tpl = rootNoteTpl(tpl)
      const body = String(rl.body || '')
      const sec = rootNoteSplit(body, tpl)
      if (body.split('\n').indexOf(tpl.head) < 0) return false
      const kept = sec.entries.filter(function (l) { return rootNoteKeyOfLine(tpl, l) !== key })
      if (kept.length === sec.entries.length) return false
      let out = sec.pre
      if (kept.length) out = out.concat(['']).concat(kept)
      if (sec.others.length) out = out.concat(['']).concat(sec.others)
      rl.body = out.join('\n') + '\n'
      rl.updatedAt = new Date().toISOString()
      await persistNote(rl, { history: false })
      return true
    }
    // ==== rootnote END ====
    // ==== inject-index BEGIN ====（0.4.3⑤：注入索引根笔记 + 管线 reference 桶切换 + 挂载行级联动，notes-043-index）
    // 行为（总纲 n-muufiroz67it 卡5/7）：
    //   ①升级首启自动建「注入索引（自动）」根笔记（RootNote 框架创建；settings 记 indexNoteId 软链；自身不注入 inject=false；
    //     创建窗口经 rootNoteCreateLock 创建级锁串行化，并发首建竞态消除——0.4.3+ notes-043-ensure-lock）；
    //   ②§1 挂载清单：行格式 `- [[n-xxx]] 何时查我：…`（幂等键 = 笔记 id，同笔记唯一行，重挂载 = 换文案）；
    //     前缀「何时查我：」机器加（lineOf 写入），when 存纯文案；解析剥离可选前缀——存量无前缀行零迁移照常工作
    //     （0.4.3 验收修复④ notes-043-index-preset-v2 行格式归一）；
    //   ③管线切换（inject.js 消费）：reference 桶 = §1 逐行（每行 whenToUse + [[链接]]，agent 按需 note_get 拉正文）；
    //     旧「资料全文注入」通道下线；无索引/索引无行 → 回退空 reference 桶；约定桶全文注入不动（用户裁决红线）；
    //   ④联动：资料（reference）开注入 → 自动落缺省行（whenToUse=标题，弹层确认后 notes-mount 换文案）；
    //     关注入/改约定桶 → 摘行；删笔记（软删/彻底删）→ 清行（图内核死链联动上游——行摘了死链自然不出现）。
    //   ⑤索引笔记编辑器可见可手工整理（recall=false 不进目录注入，但列表/编辑器可见）；机器只行级操作（RootNote 节外零触碰）。
    // 预设 v2（0.4.3 验收修复④ notes-043-index-preset-v2）：INJECT_INDEX_BODY = 说明块（人读契约：机器托管/行格式/可编辑边界）
    //   + §1 挂载清单单节——§2 召回指标不再入预设（指标迁机器存储层+呈现层，走 notes-043-metrics-storage/-present；
    //   旧索引存量 §2 的摘除由迁移卡⑤统一处理，本卡不碰存量正文）。
    // 依赖序位：rootnote.js（框架）之后、inject.js（管线消费）之前；_update/_delete/_purge/_create 包装序位在 graph.js 之后（RPC 域包装保留；
    //   graph 增量维护 0.4.3+ 已迁 onNoteChanged 事件总线，notes-043-event-bus——本模块包装与之不再叠加）。
    const INJECT_INDEX_TITLE = '注入索引（自动）'
    const INJECT_INDEX_HEAD = '## §1 挂载清单'
    // 说明块（预设首行，RootNote pre 区逐字节保留）：机器托管声明 + §1 行格式契约 + 可编辑边界（冒号后文案可改，行首结构保持）
    const INJECT_INDEX_GUIDE = '机器托管笔记（请勿删除）：§1 每行 = 一条注入载荷（agent 系统提示会看到此行），格式：- [[笔记id]] 何时查我：<一句话说明何时该读这篇>；可直接编辑冒号后的文案，请保持行首 `- [[id]]` 结构。\n\n'
    // 存量兼容：§2 锚常量保留给 ledger.js 存量摘除通道消费（_ledgerStripS2FromBody，0.4.3 验收修复⑤ notes-043-metrics-storage）——
    //   新预设已不再含此节（上方 v2 注）；指标落 telemetry.json + notes-recall-stats RPC ledger 键（卡⑤），索引笔记回归纯挂载清单
    const INJECT_INDEX_S2 = '## §2 召回指标'
    const INJECT_INDEX_BODY = INJECT_INDEX_GUIDE + INJECT_INDEX_HEAD + '\n'
    const INJECT_INDEX_WHEN_PREFIX = '何时查我：'
    const INJECT_INDEX_MAX = 200
    // RootNote 模板：newestFirst=false 挂载序稳定（追加节尾）；说明块/存量 §2 指标节（非条目行）进 others 区逐字节保留
    const INJECT_INDEX_TPL = rootNoteTpl({
      head: INJECT_INDEX_HEAD,
      lineRe: /^\s*-\s\[\[[^\[\]\r\n]+\]\]/,
      keyOfLine: function (l) { const m = String(l).match(/\[\[([^\[\]\r\n]+)\]\]/); return m ? m[1] : l },
      keyOfEntry: function (d) { return d.id },
      lineOf: function (d) { return '- [[' + d.id + ']] ' + INJECT_INDEX_WHEN_PREFIX + String(d.when == null ? '' : d.when).replace(/[\r\n]+/g, ' ').trim() },
      max: INJECT_INDEX_MAX,
      newestFirst: false
    })
    // 索引笔记解析（同步，conventionText 管线用）：indexNoteId 指针优先，丢了按 kind=sys 判定（0.4.3⑥）在 cache 自愈找回，
    //   再退按标题（存量旧笔记——升级前创建的索引）；都没有 → null
    function idxNoteSync() {
      try {
        if (settingsCache && settingsCache.indexNoteId) {
          const n = cache.get(String(settingsCache.indexNoteId))
          if (n && !n.deleted && !n.tombstoned) return n
        }
        for (const n of cache.values()) { if (!n.deleted && !n.tombstoned && (n.kind || 'note') === 'sys' && n.title === INJECT_INDEX_TITLE) return n }
        for (const n of cache.values()) { if (!n.deleted && !n.tombstoned && n.title === INJECT_INDEX_TITLE) return n }
      } catch (e) {}
      return null
    }
    // §1 挂载行解析核（body → [{ id, when, raw }]）：idxLinesSync（正式索引）与孤儿索引自愈合并（idxHealOrphans）共用同一口径。
    //   行格式归一（0.4.3 验收修复④ notes-043-index-preset-v2）：when = 纯文案——剥离可选「何时查我：」机器前缀，
    //   存量无前缀行零迁移照常解析；raw = 行原样（管线注入用，自带前缀形态）
    function idxParseBody(body) {
      const out = []
      for (const l of String(body || '').split('\n')) {
        const m = l.match(/^\s*-\s\[\[([^\[\]\r\n]+)\]\]\s*(.*)$/)
        if (!m) continue
        let when = m[2] || ''
        if (when.indexOf(INJECT_INDEX_WHEN_PREFIX) === 0) when = when.slice(INJECT_INDEX_WHEN_PREFIX.length)
        out.push({ id: m[1], when: when, raw: l.trim() })
      }
      return out
    }
    // §1 挂载行解析（同步）：[{ id, when, raw }]——行首 `- [[target]] 何时查我：文案`；无索引 → []（管线回退空 reference 桶）。
    //   解析核 = idxParseBody（上方）；返回结构 {id,when,raw} 不变（红线）
    function idxLinesSync() {
      const rl = idxNoteSync()
      if (!rl) return []
      return idxParseBody(rl.body)
    }
    // 升级首启/指针丢失自愈：懒创建索引根笔记（kind=sys 系统根笔记——recall=false 不进目录注入；自身不 inject）；
    //   存量迁移（0.4.3⑥）：按标题找回的旧索引 kind≠sys → rootNoteEnsureSysKind 只写 kind 元数据（正文零变化红线）；返回托管笔记或 null
    // 创建级锁（0.4.3+ notes-043-ensure-lock）：「存在性检查 → 创建 → indexNoteId 回写」读-改-写窗口经 rootNoteCreateLock 串行化——
    //   并发首建竞态（索引不存在时两个并发 notes-mount 各建一篇，盘上孤儿索引文件）消除；命中既有索引走快路径不进锁零开销
    async function idxEnsure() {
      try {
        await loadSettings()
        let rl = idxNoteSync()
        // 冷缓存防御（0.4.3 验收修复⑪ notes-043-mount-ux-final）：快路径未命中才水化——启动装配 fire-and-forget 调用本函数时
        //   cache 可能尚未水化，idxNoteSync 的指针/标题两条腿都读 cache，冷缓存误判「无索引」会在存量库上重复创建孤儿索引
        //   （实案：复测环境出现两篇同名「注入索引（自动）」，指针迁走后旧索引挂载行全部隐形）。仅未命中时全量水化一次
        //   （含删除态/日志/sys 口径，存活索引必命中）；指针命中的挂载热路径零额外磁盘读
        if (!rl) { try { await _list(undefined, undefined, undefined, true, true, true) } catch (e) {} rl = idxNoteSync() }
        if (rl) {
          await rootNoteEnsureSysKind(rl)
          if (settingsCache.indexNoteId !== rl.id) { settingsCache.indexNoteId = rl.id; await saveSettings() }
          return rl
        }
        return await rootNoteCreateLock(async function () {
          // 锁内双检：并发首建时后者命中前者产物（settings 指针/标题扫描同口径），不再重复创建
          rl = idxNoteSync()
          if (rl) {
            await rootNoteEnsureSysKind(rl)
            if (settingsCache.indexNoteId !== rl.id) { settingsCache.indexNoteId = rl.id; await saveSettings() }
            return rl
          }
          const cr = await _create(INJECT_INDEX_TITLE, INJECT_INDEX_BODY, ['自动'], '注入索引', { kind: 'sys', inject: false, recall: false })
          if (!cr || !cr.id) return null
          settingsCache.indexNoteId = cr.id
          await saveSettings()
          return rootNoteResolve(cr.id)
        })
      } catch (e) { return null }
    }
    // 孤儿索引自愈（0.4.3 验收修复⑪，启动装配处 idxEnsure().then 单次触发，见 index 收口模块）：正式索引之外仍存活的同名
    //   「注入索引（自动）」笔记（冷缓存竞态/指针丢失的历史产物）——其 §1 存量行并入正式索引（跳过已存在键与目标已死行，
    //   idxMount 幂等落行），然后软删孤儿（回收站可恢复）。孤儿正文只读不写（行级操作红线延伸到自愈路径）；异常全吞（失败下次启动重试）
    // 0.4.3 验收修复⑫（notes-043-final-polish）：并入前判目标 inject===true && injectRole==='reference'（挂载⇔资料不变量）——
    //   idxMount 直落不翻目标注入态，不达标行并入后会在目标下次 update 被 _idxSyncMount 静默摘回；故不达标行跳过并入
    //   （行随孤儿软删丢弃——孤儿本就是要收敛的残骸，不强行复活注入态；notes-mount RPC 通道的翻档单点收口不动）
    async function idxHealOrphans(rl) {
      try {
        if (!rl) return
        const dups = []
        for (const m of cache.values()) { if (!m.deleted && !m.tombstoned && m.id !== rl.id && m.title === INJECT_INDEX_TITLE) dups.push(m) }
        for (const dp of dups) {
          const lines = idxParseBody(dp.body)
          for (const l of lines) {
            const tn = cache.get(l.id)
            if (!tn || tn.deleted || tn.tombstoned) continue   // 死挂载行不并入（图内核死链不扩散）
            if (!(tn.inject === true && tn.injectRole === 'reference')) continue   // 挂载⇔资料不变量：不达标行不并入（不翻档）
            if (!idxLinesSync().some(function (x) { return x.id === l.id })) await idxMount(l.id, l.when)
          }
          await _delete(dp.id)
        }
      } catch (e) {}
    }
    // 挂载/换文案（幂等）：先摘同键旧行再落新行（同笔记唯一行）；机器只行级操作；返回索引笔记 id 或 null
    async function idxMount(noteId, whenToUse) {
      const rl = await idxEnsure()
      if (!rl) return null
      const key = String(noteId)
      await rootNoteRemoveLine(rl, INJECT_INDEX_TPL, key)
      await rootNoteAppend(rl, INJECT_INDEX_TPL, [{ id: key, when: whenToUse }])
      return rl.id
    }
    // 摘行（幂等零改动）：索引不存在/键未命中均 no-op 返回 false
    async function idxUnmount(noteId) {
      const rl = idxNoteSync()
      if (!rl) return false
      return rootNoteRemoveLine(rl, INJECT_INDEX_TPL, String(noteId))
    }
    // ---- 挂载 RPC：notes-mount { id, whenToUse? }（弹层确认落行；缺省 whenToUse = 标题）----
    // 0.4.3 验收修复⑪（notes-043-mount-ux-final）：挂载 ⇔ 资料档不变量单点收口——落行前先把目标翻 inject=true +
    //   injectRole=reference（undefined 位参数 = 保留存量值，patch 语义）。此前 preview/弹层直挂路径不翻注入态，
    //   _idxSyncMount 会在目标笔记下一次 update 时判 inject≠true 摘行——用户复测③「whenToUse 不进预览」的断链根因；
    //   翻转经 _update 普通链路（wrapper 先落缺省行，随后 idxMount 幂等换文案）；kind=log 注入硬关延伸到挂载（拒绝）。
    disposers.push(handle('notes-mount', async (args) => {
      try {
        if (!args || !args.id) return { error: 'notes-mount 需要 id' }
        const n = await loadNote(String(args.id))
        if (!n || n.deleted || n.tombstoned) return { error: 'notes-mount: 笔记不存在' }
        if ((n.kind || 'note') === 'log') return { error: 'notes-mount: kind=log 工作日志不参与注入，不可挂载' }
        const when = args.whenToUse === undefined || args.whenToUse === null ? String(n.title || '') : String(args.whenToUse)
        if (!(n.inject === true && n.injectRole === 'reference')) {
          await _update(String(args.id), undefined, undefined, undefined, undefined, undefined, undefined, true, undefined, undefined, undefined, 'reference', undefined, undefined)
        }
        const rlId = await idxMount(String(args.id), when)
        if (!rlId) return { error: 'notes-mount: 索引笔记创建失败' }
        return { ok: true, id: String(args.id), indexNoteId: rlId, whenToUse: when }
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // 索引总览（client 弹层回填 / 卡 6 指标数据源）：{ indexNoteId, lines:[{ id, when, raw }] }
    disposers.push(handle('notes-mount-list', async () => {
      try { const rl = idxNoteSync(); return { indexNoteId: rl ? rl.id : null, lines: idxLinesSync() } }
      catch (e) { return { error: String(e.message || e) } }
    }))
    // ---- 开关联动（单点收口包装）：_create / _update 后按注入态同步挂载行 ----
    // 同步判据：存活 + inject=true + injectRole=reference → 无行补缺省行（whenToUse=标题）；
    //          其余（关注入 / 约定桶 / 索引自身）→ 摘行（幂等零改动）。异常全吞（联动失败不阻塞主写路径）。
    async function _idxSyncMount(id) {
      try {
        const n = await loadNote(id)
        if (n && !n.deleted && !n.tombstoned && n.inject === true && n.injectRole === 'reference') {
          const has = idxLinesSync().some(function (l) { return l.id === String(n.id) })
          if (!has) await idxMount(n.id, n.title || n.id)
        } else if (n) { await idxUnmount(id) }
      } catch (e) {}
    }
    const _idxCreateOrig = _create
    _create = async function (title, body, tags, topic, opts) {
      const r = await _idxCreateOrig(title, body, tags, topic, opts)
      try { if (r && r.id) await _idxSyncMount(r.id) } catch (e) {}
      return r
    }
    const _idxUpdateOrig = _update
    _update = async function (id, title, body, tags, topic, kind, status, inject, injectTo, folder, recall, injectRole, sensitive, extra) {
      const r = await _idxUpdateOrig(id, title, body, tags, topic, kind, status, inject, injectTo, folder, recall, injectRole, sensitive, extra)
      try { await _idxSyncMount(id) } catch (e) {}
      return r
    }
    // 删笔记 → 清行（软删/彻底删双通道；恢复不自动回挂——挂载是显式动作，回收站恢复后可重开注入）
    const _idxDeleteOrig = _delete
    _delete = async function (id) {
      const r = await _idxDeleteOrig(id)
      try { await idxUnmount(id) } catch (e) {}
      return r
    }
    const _idxPurgeOrig = _purge
    _purge = async function (id) {
      const r = await _idxPurgeOrig(id)
      try { await idxUnmount(id) } catch (e) {}
      return r
    }
    // ==== inject-index END ====
    // ==== notes-ledger BEGIN ====（0.4.3⑥：效用账本——日志双链扫描 → 指标快照 + 记忆档案懒创建回填（无 LLM），notes-043-ledger；
    //   0.4.3 验收修复⑤ notes-043-metrics-storage：§2 数据源切换——指标落机器存储层 telemetry.json，索引笔记 §2 通道退役摘除；
    //   0.4.3 验收修复⑩ notes-043-archive-folder：档案归位真实文件夹「记忆档案」——_create 第 5 参 extra.folder（参数位纠错：原误植第 4 参 topic 位，
    //     folder='' 导致面板树无入口）+ 存量 folder='' 档案一次性幂等迁移；第二轮裁决（Verifier 驳回成立返修）：面板翻账本入口的真实形态 =
    //     筛选中心「机器」档（FILTER_KINDS +sys + 面板取数恰选单 kind 时传 {kind} 走 ⑨ 保留的显式 kind 通道）+ folders 计数 includeSys——
    //     folder 定向视图含 sys 是 host 侧保留通道，但面板取数从不带 folder 参数（驳回探针实证 data.js 仅无参调用），不再充当面板入口等价物）
    // 行为（总纲 n-muufiroz67it 卡6/7 + 卡⑤修订）：
    //   ①扫描：复用 notes-graph 内核（_graphRebuild 全量只读重建，图是派生物），取近 7 天 kind=log 日志的 link 存活边
    //     聚合引用（本周口径 = logDate 距今 ≤7 天，缺省回退 createdAt 前 10 位；无法解析的日志不提名）。扫描只读，零 LLM。
    //   ②指标快照（卡⑤）：挂载总数 / 本周引用 Top5 / 零引用候选 / 任务挂载排行（口径受限：看板 contextFiles RPC 本期未接入，
    //     可得项 = useCount 引用计数 Top5）——经 _telemetrySetLedger 落 telemetry.json 派生字段 ledger（2s 防抖随遥测同盘），
    //     「召回指标」汇总输出 = notes-recall-stats RPC 的 ledger 键（面板数据源）；索引笔记 §2 召回指标节不再写入。
    //   ②b 存量摘除（卡⑤，一次性幂等）：_ledgerStripS2 摘除旧索引笔记的「## §2 召回指标」整段（机器托管节语义——节内全行随节
    //     整段退役，残行不留防污染 §1 行区 lint；§1 与说明块节外零触碰）；启动（index.js）与每次 refresh 双触发，无 §2 零改动。
    //   ③记忆档案懒创建：近 7 天日志引用且无档案 → 建「记忆 @标题 · 档案」（首行 [[记忆id]]；front-matter refNote
    //     结构化软链指向记忆 id；永不 inject 红线 + recall=false；⑩ folder=「记忆档案」真实文件夹归夹，topic 口径保留）→
    //     引用记录倒序追加（RootNote 框架，幂等键 = 日志 id，重放不重复行）。
    //   ③b 存量档案归夹（⑩，一次性幂等，refresh 顺带）：title「记忆 @」开头 + kind=sys + folder='' 的存量档案批量改 folder=「记忆档案」id
    //     ——只写 folder 元数据（正文/标题/其余 front-matter 零触碰红线）；{ history:false } 机器产物零历史快照；迁移后 folder 非空不再命中判据 = 重放零改写。
    //     口径说明（第二轮裁决）：迁移顺带更新 updatedAt 属 rootnote.js rootNoteEnsureSysKind 同族先例（机器元数据迁移随写 updatedAt）；
    //     ⑥ 前 kind='note' 陈旧档案不命中本判据（kind=sys 限定）——先经 _ledgerArchiveEnsure 的 rootNoteEnsureSysKind 升级（本周引用命中时），下一轮 refresh 归夹。
    //   ④遥测镜像顺带（卡⑤）：_recallMirrorRefresh 刷新存量「召回遥测（自动）」人读镜像笔记（不存在则跳过——新装库零笔记足迹）。
    //   ⑤触发：schedule.js cron tick 顺带（10min 节流在 _ledgerRefresh 内部）+ notes-ledger-refresh 手动 RPC（绕过节流）。
    // 红线：档案/镜像永不 inject（ensure/镜像重写内强制纠正锁）；无 LLM；扫描只读（写入仅限 telemetry.json ledger 键 + 档案笔记 + 镜像笔记，
    //   均 { history:false } 机器产物零历史快照 / 存储层防抖落盘）。
    // 依赖序位：rootnote.js（框架）→ injectindex.js（索引 INJECT_INDEX_S2/idxEnsure/idxLinesSync）之后、schedule.js（cron 顺带）之前；
    //   kernel/telemetry-store.js（_telemetrySetLedger）与 recall.js（_recallMirrorRefresh）运行时引用（函数声明提升，无 TDZ）；
    //   双清单同名共源（无 .dist 变体，check 节 45/74 看守）。
    const LEDGER_WINDOW_MS = 7 * 86400000        // 本周口径：近 7 天日志
    const LEDGER_CRON_MIN_MS = 10 * 60 * 1000    // cron 顺带刷新节流（手动 RPC 不受限）
    const LEDGER_TOP_N = 5                       // Top5 行容量
    const LEDGER_ZERO_MAX = 10                   // 零引用候选提名上限（提名而非穷尽）
    const LEDGER_ARCHIVE_MAX = 50                // 档案引用记录容量红线（倒序保留最新 50 条裁尾）
    const LEDGER_ARCHIVE_HEAD = '## 引用记录（自动）'
    const LEDGER_ARCHIVE_FOLDER = '记忆档案'     // ⑩ 档案归夹目标文件夹名（folder-arg-norm 名称→id 归一；_ledgerArchiveFolderEnsure 懒建）
    const LEDGER_ARCHIVE_TITLE_PREFIX = '记忆 @' // ⑩ 存量迁移判据：档案标题前缀（与懒创建标题同模）
    // 档案引用记录模板：新→旧倒序 + 日志 id 幂等键（重放/双触发不重复行）+ ≤50 裁尾
    const LEDGER_ARCHIVE_TPL = rootNoteTpl({
      head: LEDGER_ARCHIVE_HEAD,
      max: LEDGER_ARCHIVE_MAX,
      newestFirst: true,
      keyOfLine: function (l) { const m = String(l).match(/\[\[([^\[\]\r\n]+)\]\]/); return m ? m[1] : l },
      keyOfEntry: function (d) { return d.logId },
      lineOf: function (d) { return '- [[' + d.logId + ']] ' + d.at + ' · ' + String(d.label || '').replace(/[\r\n]+/g, ' ').slice(0, 60) }
    })
    // ISO → 本地 YYYY-MM-DD HH:MM（人读优先；与 runLog 条目同口径的本地墙钟语义，符号独立不复用 schedule 域）
    function ledgerTs(iso) {
      const ms = Date.parse(iso || '')
      if (!isFinite(ms)) return String(iso || '')
      const d = new Date(ms)
      const p = function (n) { return (n < 10 ? '0' : '') + n }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    }
    // 日志归键（与日志卫生 suggestLogDateOf 同口径）：logDate 前 10 位优先，回退 createdAt 前 10 位
    function _ledgerLogDateStr(n) {
      const s = String(n.logDate || '').slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
      const c = String(n.createdAt || '').slice(0, 10)
      return /^\d{4}-\d{2}-\d{2}$/.test(c) ? c : ''
    }
    // 扫描（只读）：全量重建图 → 近 7 天日志的 link 存活出边聚合
    //   refs: 记忆 id → { count 出现次数, logs: [{ logId, at, label }] }；inRefs: 全库 link 存活入度（零引用候选判据，不只看本周）
    async function _ledgerScan(nowMs) {
      await _graphRebuild()
      const all = await _list(undefined, undefined, undefined, false, true)
      const logs = {}
      for (const n of all) {
        if ((n.kind || 'note') !== 'log' || n.deleted || n.tombstoned) continue
        // 0.4.4-A（notes-044-dispatch-receipts）：派发管线「执行记录」伴生笔记（kind=log + refNote 回链源笔记）不计入日志扫描——
        //   语义分目录裁决的账本面延伸：执行记录=派发回执、工作日志=会话沉淀（两类内容不同目录同理不同账本口径）；
        //   兼防指令摘要文本误入 [[双链]] 造成假性引用（refs 聚合只认会话沉淀日志）
        if (n.refNote) continue
        const ds = _ledgerLogDateStr(n)
        const ms = ds ? Date.parse(ds + 'T00:00:00') : NaN
        if (!isFinite(ms) || nowMs - ms > LEDGER_WINDOW_MS || ms - nowMs > LEDGER_WINDOW_MS) continue
        logs[n.id] = n
      }
      const refs = {}
      let weekRefs = 0
      for (const e of graphState.edges) {
        if (e.type !== 'link' || e.dead) continue
        const lg = logs[e.from]
        if (!lg) continue
        const cnt = e.meta && e.meta.count ? e.meta.count : 1
        const t = String(e.to)
        if (!refs[t]) refs[t] = { count: 0, logs: [] }
        refs[t].count += cnt
        refs[t].logs.push({ logId: e.from, at: ledgerTs(lg.updatedAt || lg.createdAt || ''), label: lg.title || '' })
        weekRefs += cnt
      }
      const inRefs = {}
      for (const e of graphState.edges) {
        if (e.type !== 'link' || e.dead) continue
        inRefs[e.to] = (inRefs[e.to] || 0) + (e.meta && e.meta.count ? e.meta.count : 1)
      }
      return { all: all, logs: logs, refs: refs, weekRefs: weekRefs, inRefs: inRefs }
    }
    // §2 存量摘除（卡⑤，一次性幂等）：指标迁 telemetry.json + notes-recall-stats 查询面，索引笔记回归纯挂载清单（§1）。
    //   整段摘除「## §2 召回指标」至下一「## 」节标题（或 EOF）——§2 是机器托管节（指标快照语义），节内全部行（机器指标行/误入的
    //   手写备注）随节整段退役：不保留节内残行（残行失去节锚会落入 §1 行区，污染索引行格式 lint 的兜底检出面——节 75 守卫①）；
    //   节外（说明块 + §1 + 后续节）逐字节不动。无 §2 锚 → null（幂等零改动，调用方不落盘）。
    function _ledgerStripS2FromBody(body) {
      const lines = String(body || '').split('\n')
      let headIdx = -1
      for (let i = 0; i < lines.length; i++) { if (lines[i].trim() === INJECT_INDEX_S2) { headIdx = i; break } }
      if (headIdx < 0) return null
      let end = lines.length
      for (let i = headIdx + 1; i < lines.length; i++) { if (/^##\s/.test(lines[i].trim())) { end = i; break } }
      const before = lines.slice(0, headIdx)
      while (before.length && before[before.length - 1].trim() === '') before.pop()
      const after = lines.slice(end)
      let out = before
      if (after.length) out = out.concat(['']).concat(after)
      return out.join('\n') + '\n'
    }
    // 摘除落盘（幂等）：无 §2 → false 零改动；有 → { history:false } 机器产物零历史快照。启动（index.js 双包）与 refresh 双触发
    async function _ledgerStripS2() {
      try {
        const rl = await idxEnsure()
        if (!rl) return false
        const nb = _ledgerStripS2FromBody(rl.body)
        if (nb === null) return false
        rl.body = nb
        rl.updatedAt = new Date().toISOString()
        await persistNote(rl, { history: false })
        return true
      } catch (e) { return false }
    }
    // 档案查找：refNote 软链精确命中（front-matter 结构化主识别键；标题仅人读）
    function _ledgerArchiveFind(memId) {
      for (const n of cache.values()) {
        if (!n || n.deleted || n.tombstoned) continue
        if (String(n.refNote || '') === memId) return n
      }
      return null
    }
    // 档案文件夹确保（0.4.3 验收修复⑩ notes-043-archive-folder）：「记忆档案」真实文件夹懒创建——
    //   resolveFolderRef 命中（id/名称双通道）直接复用；未命中经 rootNoteCreateLock 串行化创建 + 锁内双检
    //   （并发 refresh 双建同名文件夹竞态消除；锁内仅消费 loadFolders/saveFolders/loadSettings，无本链重入 = 无自死锁）。
    //   红线：必须在档案创建锁（_ledgerArchiveEnsure 内 rootNoteCreateLock）之外调用——嵌套同链重入 = 自死锁（rootnote 红线③）。
    async function _ledgerArchiveFolderEnsure() {
      const hit = await resolveFolderRef(LEDGER_ARCHIVE_FOLDER)
      if (hit && hit.id) return hit.id
      return rootNoteCreateLock(async function () {
        const again = await resolveFolderRef(LEDGER_ARCHIVE_FOLDER)   // 锁内双检：并发 ensure 前者产物已落 folders.json，命中即复用
        if (again && again.id) return again.id
        const c = await _folders({ op: 'create', name: LEDGER_ARCHIVE_FOLDER, sys: true })   // 0.4.4-G：机器属性创建直入（自动沉淀夹默认隐身；幂等——命中复用路径不触碰 sys，用户摘除墓碑不回弹）
        return (c && c.ok && c.folder) ? c.folder.id : ''
      })
    }
    // 存量档案归夹（⑩，一次性幂等）：title「记忆 @」开头 + kind=sys + folder='' 的存量档案批量改 folder=「记忆档案」id——
    //   只写 folder 元数据（正文/标题/其余 front-matter 零触碰红线）；persistNote { history:false } 机器产物零历史快照（事件总线正常分发）；
    //   幂等：迁移后 folder 非空不再命中判据，重放零改写。返回迁移篇数。
    async function _ledgerArchiveFolderMigrate(folderId) {
      if (!folderId) return 0
      let moved = 0
      for (const n of cache.values()) {
        if (!n || n.deleted || n.tombstoned) continue
        if ((n.kind || 'note') !== 'sys' || n.folder) continue
        if (String(n.title || '').indexOf(LEDGER_ARCHIVE_TITLE_PREFIX) !== 0) continue
        n.folder = folderId
        n.updatedAt = new Date().toISOString()
        await persistNote(n, { history: false })
        moved++
      }
      return moved
    }
    // 档案懒创建（幂等）：无档案 → _create（inject=false + recall=false + ⑩ folder=「记忆档案」归夹）→ refNote 软链回写（{ history:false }）；
    //   永不 inject 红线锁：被人为开注入的档案强制纠正回 false（防套娃注入）
    // 创建级锁（0.4.3+ notes-043-ensure-lock）：「查找 → 创建 → refNote 回写」窗口经 rootNoteCreateLock 串行化 + 锁内双检
    //   （_ledgerArchiveFind 扫共享 cache 权威）——并发 refresh 同记忆各建档案的竞态消除；命中既有档案走快路径不进锁
    async function _ledgerArchiveEnsure(mem) {
      const memId = String(mem.id)
      let a = _ledgerArchiveFind(memId)
      if (a) await rootNoteEnsureSysKind(a)   // 存量迁移（0.4.3⑥）：旧档案 kind=note → sys（只写 kind 元数据，正文零变化）
      if (!a) {
        await _ledgerArchiveFolderEnsure()   // ⑩ 归夹前置：创建锁外确保「记忆档案」文件夹存在（嵌套同链 = 自死锁；folder-arg-norm 对未知名称整体拒绝，缺夹会炸_create）
        a = await rootNoteCreateLock(async function () {
          const hit = _ledgerArchiveFind(memId)   // 锁内双检：并发创建者产物已带 refNote 落缓存，命中即复用
          if (hit) { await rootNoteEnsureSysKind(hit); return hit }
          const cr = await _create('记忆 @' + String(mem.title || memId) + ' · 档案', '[[' + memId + ']]\n\n' + LEDGER_ARCHIVE_HEAD + '\n', ['自动'], '记忆档案', { kind: 'sys', inject: false, recall: false, folder: LEDGER_ARCHIVE_FOLDER })   // ⑩ 参数位纠错：folder 走 extra.folder（名称→id 归一）；topic「记忆档案」口径保留
          if (!cr || !cr.id) return null
          const na = await rootNoteResolve(cr.id)
          if (!na) return null
          na.refNote = memId
          na.updatedAt = new Date().toISOString()
          await persistNote(na, { history: false })
          return na
        })
        if (!a) return null
      }
      if (a.inject === true) {
        a.inject = false
        a.updatedAt = new Date().toISOString()
        await persistNote(a, { history: false })
      }
      return a
    }
    // 刷新主口（卡⑤修订 + ⑩）：存量 §2 摘除 → 扫描 → ⑩ 档案文件夹确保 + 存量档案归夹（一次性幂等）→ 指标快照落 telemetry.json
    //   （_telemetrySetLedger，存储层防抖落盘）→ 遥测镜像顺带刷新 → 记忆档案懒创建回填。trigger='cron' 时 10min 节流；手动 RPC 绕过节流。
    // 全量吞异常由调用方兜底（cron 顺带）或转 error 字段（手动 RPC）——账本是观察面产物，任何故障不扩散主链路。
    async function _ledgerRefresh(opts) {
      const trig = (opts && opts.trigger) || 'manual'
      const nowMs = Date.now()
      if (trig === 'cron' && nowMs - ledgerLastCronMs < LEDGER_CRON_MIN_MS) return { ok: true, skipped: 'throttled' }
      if (trig === 'cron') ledgerLastCronMs = nowMs
      const rl = await idxEnsure()
      if (!rl) return { ok: false, error: '注入索引笔记不可用' }
      await _ledgerStripS2()   // 存量 §2 摘除（一次性幂等；卡⑤——指标迁机器存储层，索引回归纯挂载清单）
      const scan = await _ledgerScan(nowMs)
      // ⑩ 存量档案归夹（一次性幂等，refresh 顺带）：scan 内 _list 已暖缓存（外部文件懒加载入 cache），此处全量扫描判据零遗漏；
      //   文件夹 ensure 返回 ''（folders.json 写失败等）时迁移降级 0 篇不扩散主链路；档案懒创建遇缺夹由 folder-arg-norm 显式拒绝兜底（错得安全）
      const archFolderId = await _ledgerArchiveFolderEnsure()
      const archivesMoved = await _ledgerArchiveFolderMigrate(archFolderId)
      const mounted = idxLinesSync()
      const tops = Object.keys(scan.refs).map(function (id) { return { id: id, count: scan.refs[id].count } }).sort(function (x, y) { return y.count - x.count }).slice(0, LEDGER_TOP_N)
      const zeroIds = mounted.filter(function (l) { return !(scan.inRefs[l.id] > 0) }).slice(0, LEDGER_ZERO_MAX).map(function (l) { return l.id })
      const useRank = mounted.map(function (l) {
        const n = cache.get(l.id)
        return { id: l.id, count: Math.max(0, (n && !n.deleted && !n.tombstoned && n.useCount) || 0) }
      }).filter(function (it) { return it.count > 0 }).sort(function (x, y) { return y.count - x.count }).slice(0, LEDGER_TOP_N)
      // 指标快照落机器存储层（卡⑤）：telemetry.json 派生字段 ledger——「召回指标」汇总输出 = notes-recall-stats RPC ledger 键（面板数据源）；
      //   整体覆盖写幂等（同快照重写零语义变化）；存储层 2s 防抖落盘；静默降级（遥测故障不扩散账本主链路）
      await _telemetrySetLedger({
        at: new Date(nowMs).toISOString(), trigger: trig,
        mountTotal: mounted.length, weekLogs: Object.keys(scan.logs).length, weekRefs: scan.weekRefs,
        top: tops, zeroRefCount: zeroIds.length, zeroRef: zeroIds, useRank: useRank
      })
      // 遥测镜像顺带刷新（卡⑤：存量「召回遥测（自动）」降级人读镜像；不存在则跳过；内部全吞异常）
      await _recallMirrorRefresh('ledger-' + trig)
      // 记忆档案懒创建回填：仅近 7 天被日志引用的记忆（零引用挂载不建空档案）
      let archivesCreated = 0
      for (const memId of Object.keys(scan.refs)) {
        const mem = await rootNoteResolve(memId)
        if (!mem) continue
        const existed = !!_ledgerArchiveFind(memId)
        const a = await _ledgerArchiveEnsure(mem)
        if (!a) continue
        if (!existed) archivesCreated++
        await rootNoteAppend(a, LEDGER_ARCHIVE_TPL, scan.refs[memId].logs)
      }
      return { ok: true, trigger: trig, indexNoteId: rl.id, mountTotal: mounted.length, weekLogs: Object.keys(scan.logs).length, weekRefs: scan.weekRefs, top: tops, zeroRefCount: zeroIds.length, archivesCreated: archivesCreated, archivesMoved: archivesMoved }
    }
    let ledgerLastCronMs = 0
    // 手动触发 RPC：notes-ledger-refresh { trigger? }（缺省 manual，绕过 cron 节流）
    disposers.push(handle('notes-ledger-refresh', async (args) => {
      try { return await _ledgerRefresh({ trigger: (args && args.trigger) || 'manual' }) }
      catch (e) { return { error: String(e.message || e) } }
    }))
    // ==== notes-ledger END ====
    // ==== recall-telemetry BEGIN ====（0.4.3+ 卡⑫ 统一召回遥测 → 0.4.3 验收修复⑤迁机器存储层，notes-043-metrics-storage）
    // 覆盖矩阵（五通道，主窗口裁决 n-muufiroz67it 卡⑫ 修订版——卡⑤不改埋点点位与口径）：
    //   inject  装配（强）：conventionText 真实注入路径（预览 sidOverride 不计）实际渲染的约定 id 集 + 资料桶存活索引行 id 集；
    //   mount   任务挂载（中）：_dispatch 派发成功 = 笔记作为待办上下文挂载进目标任务会话；
    //   search  自由检索（弱）：notes-search RPC 与 note_search 工具各自实际返回的 id 集（两处埋点同源口径）；
    //   get     按需取（使用信号）：note_get 工具 + notes-get RPC 成功返回（取用 = 五通道统一的「使用」事件源）；
    //   catalog 目录（弱）：renderInjected 真实渲染路径实际出清单的目录段普通行 id 集（预览不计）。
    // 存储（卡⑤）：全部事件落 kernel/telemetry-store.js（notes/telemetry.json）——四纪律/单写者/先渲染后记账/单调性见该模块头注：
    //   · 低频通道（inject/mount/catalog）记 receipts 原始回执 {ts,ids[],session?}——签名去重（同通道同会话同 id 集连续重复装配只记一行，
    //     防每轮系统提示拼装写盘风暴；id 集按集合序判等——排序 join，换序不重复记；id 集/会话变化即新签名立即记）；
    //   · 高频通道（search/get）记 byDay 日聚合 {channel→day→id→count}——内存增量单调只增（同日同键累加）；
    //   · 内存权威 + 2s 防抖原子落盘 + 卸载 flush（index.js effect 挂载点）；崩溃丢 ≤2s 内存增量（下界语义）。
    // 遥测笔记降级（卡⑤）：存量「召回遥测（自动）」根笔记一次性迁移——首个 flush 前解析旧流水行回填 JSON（幂等：
    //   meta.migratedAt 持久化标记 + 镜像正文零 `- {` 机器行双保险，重放/崩溃重跑不双计；解析失败空桶起步——遥测允许重来）；
    //   迁移后笔记降级人读镜像（## 遥测摘要（人读镜像）：日评估 cron 通道——_ledgerRefresh 顺带刷一次可读摘要，热路径零笔记写入；
    //   镜像仍 kind=sys + recall=false + inject 红线锁）；新装库无旧笔记 → 永不建镜像（遥测零笔记足迹）。
    // 红线：埋点零阻塞——全部 fire-and-forget + 静默降级（落盘失败吞异常，不扩散主流程）；
    //   notes-recall-stats 返回结构不变（ok/noteId/sinceDays/fromDay/events/channels 五通道字段零改动；ledger 为卡⑤新增键，消费方零改动）；
    //   注入管线不读本存储（卡⑥才接）。
    // 依赖序位：kernel/telemetry-store.js（存储层）+ rootnote.js（迁移解析旧流水节）+ injectindex.js/ledger.js（sys 根笔记先例 + ledgerTs 镜像时间戳）之后、
    //   inject/img-path-hint.js 之前；消费方 server/dispatch/inject/search/index 全部运行时引用（函数声明提升，RPC 调用期引用——节 45 方向断言看守）。
    const RECALL_TITLE = '召回遥测（自动）'
    const RECALL_HEAD = '## 事件流水（自动）'                  // 旧版流水节锚（一次性迁移解析用；写路径已退役）
    const RECALL_MIRROR_HEAD = '## 遥测摘要（人读镜像）'        // 降级后人读镜像锚（卡⑤：机器存储在 telemetry.json，本页仅人读）
    const RECALL_MIRROR_REMARKS = '## 手写备注（机器不改）'     // 镜像内手写备注保留节（迁移时旧流水节备注区迁入，刷新逐字节保留）
    const RECALL_MIRROR_MIN_MS = 30 * 60 * 1000              // 镜像刷写节流（内容未变且 30min 内 → 零写入）
    const RECALL_CHANNELS = ['inject', 'mount', 'search', 'get', 'catalog']
    // 旧流水节模板（迁移解析专用）：行识别 `- {json}`；RootNote split 拆 pre/entries/others（手写备注行落 others 区，迁镜像时保留）
    const RECALL_TPL = rootNoteTpl({ head: RECALL_HEAD, lineRe: /^\s*-\s\{/ })
    // 行解析：`- {json}`；非法行 → null
    function _recallParseLine(l) {
      const m = String(l).match(/^\s*-\s(\{.*\})\s*$/)
      if (!m) return null
      try { const o = JSON.parse(m[1]); return o && typeof o === 'object' ? o : null } catch (e) { return null }
    }
    // 本地日键（YYYY-MM-DD，日聚合粒度；本地墙钟语义与 ledger 日志归键同口径）
    function _recallDay(ms) {
      const d = ms === undefined ? new Date() : new Date(ms)
      const p = function (n) { return (n < 10 ? '0' : '') + n }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    }
    // 遥测笔记解析（同步）：settings.recallNoteId 指针优先，丢了按 kind=sys + 标题在 cache 自愈找回，再退按标题（存量旧笔记）
    function _recallNoteSync() {
      try {
        if (settingsCache && settingsCache.recallNoteId) {
          const n = cache.get(String(settingsCache.recallNoteId))
          if (n && !n.deleted && !n.tombstoned) return n
        }
        for (const n of cache.values()) { if (!n.deleted && !n.tombstoned && (n.kind || 'note') === 'sys' && n.title === RECALL_TITLE) return n }
        for (const n of cache.values()) { if (!n.deleted && !n.tombstoned && n.title === RECALL_TITLE) return n }
      } catch (e) {}
      return null
    }
    // 解析（异步，迁移/镜像路径用）：同步口径之上补指针读盘兜底——冷缓存 cache.get 未命中时经 loadNote 读盘自愈（命中即回缓存）
    async function _recallResolve() {
      const hit = _recallNoteSync()
      if (hit) return hit
      try {
        if (settingsCache && settingsCache.recallNoteId) {
          const t = await loadNote(String(settingsCache.recallNoteId))
          if (t && !t.deleted && !t.tombstoned) return t
        }
      } catch (e) {}
      return null
    }
    // 一次性迁移（promise 收口，并发/重入安全）：首个 flush 前解析旧「召回遥测（自动）」笔记流水行回填 telemetry.json——
    //   原始回执行倒序遍历（旧→新入队，裁尾保最新 200）+ 日聚合行计数累加；meta.migratedAt 持久化标记（跨重启幂等，重放不双计）。
    //   崩溃顺序红线：先 flushNow 落 JSON 再改写镜像（崩溃重放解析同源旧行 = 同结果重建，不双计）。
    //   找不到旧笔记：冷缓存（cache 空）重置 promise 允许下个事件重试；暖缓存确认无旧笔记 → 本 apply 生命周期封口（新装库常态零开销）。
    //   迁移失败静默（遥测允许重来，空桶起步）；settings.recallNoteId 指针只读消费（卡⑤起不再回写——镜像不再懒建，指针无新建需求）。
    let _recallMigratePromise = null
    function _recallMaybeMigrate() {
      if (_recallMigratePromise) return _recallMigratePromise
      _recallMigratePromise = (async () => {
        try {
          await _telemetryLoad()
          const t = _telemetryCache
          if (!t) return
          if (t.meta && t.meta.migratedAt) return              // 已迁移（标记持久化在 JSON，跨重启幂等）
          await loadSettings()
          const rl = await _recallResolve()
          if (!rl) {
            if (cache.size === 0) _recallMigratePromise = null   // 冷缓存：重置允许重试（暖缓存后标题扫描才可靠）
            return
          }
          const sec = rootNoteSplit(String(rl.body || ''), RECALL_TPL)
          for (const l of sec.entries.slice().reverse()) {       // 旧文件合并序新行在前 → 倒序遍历 = 旧→新入队（裁尾保最新）
            const o = _recallParseLine(l)
            if (!o || RECALL_CHANNELS.indexOf(o.channel) < 0) continue
            if (o.ts && Array.isArray(o.ids)) _telemetryAddReceipt(o.channel, o)
            else if (o.day && o.id) _telemetryBumpDay(o.channel, String(o.day), String(o.id), Math.max(0, Math.floor(o.count || 0)))
          }
          t.meta.migratedAt = new Date().toISOString()
          t.meta.migratedFrom = rl.id
          await _telemetryFlushNow()                             // JSON 先落盘（崩溃顺序红线）
          await _recallMirrorWrite(rl, 'migrate', sec.others)    // 笔记降级人读镜像（旧流水节手写备注迁入保留节）
        } catch (e) { /* 迁移失败静默：遥测允许重来（空桶起步），本 apply 生命周期封口不重试 */ }
      })()
      return _recallMigratePromise
    }
    // 低频通道原始回执（inject/mount/catalog）：签名去重——同通道同会话同 id 集连续装配只记一行；
    //   签名按集合序（排序后 join）：同 id 集仅渲染顺序抖动（cache 迭代序/updatedAt 并列）不视为新交付——
    //   Verifier 驳回②修复：有序 join 会把同集合换序记成第二条交付行（遥测交付量虚增 + 断言脆）；
    //   id 集或会话变化即新签名立即记（装配类防每轮系统提示拼装写盘风暴；mount 换会话重派仍计独立交付）
    const _recallLastSig = {}
    function _recallRaw(channel, ids, session) {
      try {
        const list = []
        for (const id0 of ids || []) { const s = String(id0 || ''); if (s && list.indexOf(s) < 0) list.push(s) }
        if (!list.length) return
        const sig = (session || '') + '|' + list.slice().sort().join(',')
        if (_recallLastSig[channel] === sig) return
        _recallLastSig[channel] = sig
        const row = { ts: new Date().toISOString(), ids: list }
        if (session) row.session = String(session)
        _recallMaybeMigrate().then(function () { _telemetryAddReceipt(channel, row) }).catch(function () {})
      } catch (e) {}
    }
    // 高频通道日聚合（search/get）：内存增量（同日同键累加不爆行）→ 存储层 2s 防抖落盘（卸载 flush 兜底）
    function _recallHit(channel, ids) {
      try {
        const day = _recallDay()
        const list = []
        for (const id0 of ids || []) { const s = String(id0 || ''); if (s && list.indexOf(s) < 0) list.push(s) }
        if (!list.length) return
        _recallMaybeMigrate().then(function () { for (const id of list) _telemetryBumpDay(channel, day, id, 1) }).catch(function () {})
      } catch (e) {}
    }
    // flush 关口（stats 读前落账 + 卸载 flush 共用签名）：加载 → 一次性迁移（首个 flush 前回填）→ 存储层落盘
    async function _recallFlushAgg() {
      await _recallMaybeMigrate()
      await _telemetryFlushNow()
    }
    // ---- 人读镜像（卡⑤降级：遥测笔记仅人读视图，机器存储在 telemetry.json）----
    // 镜像手写备注提取：现行镜像的保留节内容逐字节取；迁移前的旧格式正文回退 RootNote 备注区口径
    function _recallMirrorOthers(body) {
      const lines = String(body || '').split('\n')
      let idx = -1
      for (let i = 0; i < lines.length; i++) { if (lines[i].trim() === RECALL_MIRROR_REMARKS) { idx = i; break } }
      if (idx >= 0) return lines.slice(idx + 1).filter(function (l) { return l.trim() !== '' })
      return rootNoteSplit(body, RECALL_TPL).others
    }
    // 内容门比较口径：剥「- 更新于：」行（时间戳行不参与等同判定——内容未变且节流窗口内零写入）
    function _recallMirrorSansTs(b) {
      return String(b || '').split('\n').filter(function (l) { return l.indexOf('- 更新于：') !== 0 }).join('\n')
    }
    let _recallMirrorLastMs = 0
    // 镜像全量重写（冷路径唯一写笔记点：一次性迁移 + 账本刷新顺带；热路径永不调用——节 78「热路径零笔记写入」看守）。
    //   镜像仍机器托管：kind=sys 归位（存量迁移）+ inject 红线锁（人为开注入 → 随镜像重写强制纠正回 false，防套娃注入）；
    //   落盘不动 updatedAt（机器镜像刷新不算编辑——遥测计数同哲学，防列表排序抖动）；{ history:false } 机器产物零历史快照。
    async function _recallMirrorWrite(rl, trigger, othersLines) {
      const st = _recallComputeStats(7)
      const lines = [
        '> 机器遥测存储已迁至 notes/telemetry.json（0.4.3 验收修复⑤：单写者 = host 进程，热路径零写入；本页仅人读镜像，机器查询走 notes-recall-stats RPC）。',
        '',
        '- 更新于：' + ledgerTs(new Date().toISOString()) + '（' + (trigger || 'cron') + '）',
        '- 近 7 天遥测事件：' + st.events,
        '- 分通道召回率（交付→取用口径）：' + _recallFmtChannels(st.channels)
      ]
      if (st.ledger) lines.push('- 账本快照（近 7 天日志双链口径）：挂载总数 ' + (st.ledger.mountTotal || 0) + ' · 本周引用 ' + (st.ledger.weekRefs || 0) + ' 次 · 零引用候选 ' + (st.ledger.zeroRefCount || 0) + ' 条 · 快照于 ' + ledgerTs(st.ledger.at))
      const others = (othersLines || []).filter(function (l) { return typeof l === 'string' && l.trim() !== '' })
      let body = RECALL_MIRROR_HEAD + '\n\n' + lines.join('\n') + '\n'
      if (others.length) body += '\n' + RECALL_MIRROR_REMARKS + '\n\n' + others.join('\n') + '\n'
      const nowMs = Date.now()
      if (_recallMirrorSansTs(rl.body) === _recallMirrorSansTs(body) && nowMs - _recallMirrorLastMs < RECALL_MIRROR_MIN_MS) return false
      rl.body = body
      if (rl.inject === true) rl.inject = false   // 永不 inject 红线锁（随镜像重写强制纠正，不单独起写）
      await persistNote(rl, { history: false })   // 不动 rl.updatedAt：机器镜像刷新不算编辑
      _recallMirrorLastMs = nowMs
      return true
    }
    // 镜像刷新（_ledgerRefresh 顺带 = 日评估 cron 通道）：无镜像笔记 → 跳过（新装库零笔记足迹，永不懒建）；异常全吞不扩散账本主链路
    async function _recallMirrorRefresh(trigger) {
      try {
        await _recallMaybeMigrate()              // 未迁移先迁移（迁移自身已写镜像则此处内容门零改动跳过）
        const rl = await _recallResolve()
        if (!rl) return false
        await rootNoteEnsureSysKind(rl)
        return await _recallMirrorWrite(rl, trigger || 'cron', _recallMirrorOthers(rl.body))
      } catch (e) { return false }
    }
    // ---- 查询面（统计纯函数现算，不落盘——纪律②）----
    // 窗口内五通道分列（内存权威现算；telemetry.json 未加载/不存在 → 全零结构，静默降级）：
    //   交付通道（inject/mount/search/catalog）：delivered=交付的去重笔记数，deliveries=交付事件计数（原始回执 ids 计数累加/日聚合 count 累加），
    //     used=交付且窗口内被 get 实际取用的去重数，uses=那些笔记的取用总次数，rate=used/delivered（无交付 → null）；
    //   get 通道（纯使用信号，无交付侧）：delivered=0/rate=null，used=取用去重笔记数，uses=取用总次数。
    //   ledger 键（卡⑤新增）：账本刷新写入的指标快照（挂载总数/本周引用 Top5/零引用候选/任务挂载排行），无刷新记录 → null。
    function _recallComputeStats(sinceDays) {
      const fromDay = _recallDay(Date.now() - (sinceDays - 1) * 86400000)   // 日聚合窗口下沿（含当日共 sinceDays 天，日粒度字符串比较）
      const fromMs = Date.now() - sinceDays * 86400000                      // 原始回执 ts 窗口下沿
      const channels = {}
      for (const c of RECALL_CHANNELS) channels[c] = { deliveredIds: {}, deliveries: 0 }
      const getIds = {}
      const getCount = {}
      let events = 0
      const t = _telemetryCache
      if (t) {
        for (const ch of ['inject', 'mount', 'catalog']) {                  // 原始回执（低频通道）
          const arr = (t.receipts && t.receipts[ch]) || []
          for (const r of arr) {
            const ms = Date.parse(r.ts)
            if (!isFinite(ms) || ms < fromMs) continue
            const ids = Array.isArray(r.ids) ? r.ids : []
            events += ids.length
            for (const id0 of ids) { const id = String(id0); channels[ch].deliveredIds[id] = true; channels[ch].deliveries++ }
          }
        }
        for (const ch of ['search', 'get']) {                               // 日聚合（高频通道）
          const days = (t.byDay && t.byDay[ch]) || {}
          for (const d of Object.keys(days)) {
            if (d < fromDay) continue
            const bucket = days[d]
            for (const id of Object.keys(bucket)) {
              const cnt = bucket[id] || 0
              events += cnt
              if (ch === 'get') { getIds[id] = true; getCount[id] = (getCount[id] || 0) + cnt }
              else { channels[ch].deliveredIds[id] = true; channels[ch].deliveries += cnt }
            }
          }
        }
      }
      const out = {}
      for (const c of RECALL_CHANNELS) {
        if (c === 'get') {
          let uses = 0
          for (const id in getCount) uses += getCount[id]
          out.get = { delivered: 0, deliveries: 0, used: Object.keys(getIds).length, uses: uses, rate: null }
          continue
        }
        const st = channels[c]
        const ids = Object.keys(st.deliveredIds)
        let used = 0
        let uses = 0
        for (const id of ids) { if (getIds[id]) { used++; uses += getCount[id] || 0 } }
        out[c] = { delivered: ids.length, deliveries: st.deliveries, used: used, uses: uses, rate: ids.length ? Math.round(used / ids.length * 1000) / 1000 : null }
      }
      const rl = _recallNoteSync()
      // 0.4.6-E（n-mux8cq80ai5h）：面板统计行鲜度两件套（纯读增量，遥测写路径不动）——
      //   lastFlush = meta.lastFlush（遥测最近落账时刻）：面板统计行「截至 HH:MM」数据源（与目录段信号行同口径的人读时刻）；
      //   mountNow = idxLinesSync() 实时挂载计数：账本 ledger.mountTotal 是 cron 快照口径（节拍不随挂载动作），
      //   每次打开注入管理经本 RPC 即得新鲜计数；索引不可用 → null 静默降级（面板回退快照值）。
      let mountNow = null
      try { mountNow = idxLinesSync().length } catch (e) { mountNow = null }
      return { noteId: rl ? rl.id : null, sinceDays: sinceDays, fromDay: fromDay, events: events, channels: out, ledger: (t && t.ledger) || null, lastFlush: (t && t.meta && t.meta.lastFlush) || null, mountNow: mountNow }
    }
    // 查询面入口（RPC + 镜像摘要共用）：读前落账（防抖 pending 与在途回执先 flush 再统计——自洽读）
    async function _recallStats(opts) {
      const sinceDays = Math.max(1, Math.floor((opts && opts.sinceDays) || 7))
      await _recallFlushAgg()
      return Object.assign({ ok: true }, _recallComputeStats(sinceDays))
    }
    // 分通道行格式化（镜像摘要/面板共用）：交付通道 `ch used/delivered·pct%`（无交付 → `ch 无交付`）+ get 取用计数
    function _recallFmtChannels(channels) {
      const parts = []
      for (const c of ['inject', 'mount', 'search', 'catalog']) {
        const st = channels[c]
        if (!st || !st.delivered) { parts.push(c + ' 无交付'); continue }
        parts.push(c + ' ' + st.used + '/' + st.delivered + '·' + Math.round(st.rate * 100) + '%')
      }
      const g = channels.get
      parts.push('get 取用 ' + (g ? g.used : 0) + ' 条/' + (g ? g.uses : 0) + ' 次')
      return parts.join('、')
    }
    // 手动查询 RPC：notes-recall-stats {sinceDays?}（缺省 7 天；只读——除读前落账 flush 防抖 pending 外零副作用；
    //   返回结构不变 + 卡⑤新增 ledger 键：「召回指标」汇总输出本 RPC（面板数据源），索引笔记 §2 通道已退役摘除）
    disposers.push(handle('notes-recall-stats', async (args) => {
      try { return await _recallStats({ sinceDays: args && args.sinceDays }) }
      catch (e) { return { error: String(e.message || e) } }
    }))
    // ==== recall-telemetry END ====
    // ==== img-path-hint BEGIN ====（注入/派发图片路径消歧；host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，check.js 提取比对，改动必须双边同步）
    // 背景：正文图片引用 ![](assets/xxx.png) 是相对笔记库根的相对路径；注入/派发以纯文本下发，agent 无法确定基准目录。
    // 策略：注入文本（renderInjected 合并目录段，0.4.3③）与派发消息（_dispatch）尾部追加一行绝对路径提示，agent 可用文件工具直读；
    // 提示行整条文本只追加一次（不逐笔记重复），且仅当正文含 assets/ 图片引用时追加。
    // 检测与 inlineAssetsInBody / 渲染白名单同口径（![alt](assets/name)）；非全局正则 .test 无 lastIndex 残留坑。
    const BODY_IMG_REF_RE = /!\[[^\]]*\]\(assets\/[^\s)"']+\)/
    function bodyHasImageRef(body) { return BODY_IMG_REF_RE.test(String(body == null ? '' : body)) }
    // 提示行拼装：notesRoot 取运行时实际值（开发版 NOTES_DIR / 静态包 NOTES_ROOT，均已是绝对路径）；正斜杠形态双平台可读
    function assetsHintLine(notesRoot) { return '（图片位于笔记库目录 ' + String(notesRoot || '').replace(/[\\/]+$/, '') + '/assets/，可用文件工具直接读取）' }
    // ==== img-path-hint END ====

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


    // 休眠送达通道（0.4.4-B，notes-044-dormant-dispatch）：目标非 live 时，向其持久化日志追加 durable inbox splice
    // （agent/inbox/spliced，与 live send(msg,'next-turn') 的落盘记录同形态）——零唤醒零成本：不启动 agent，
    // 会话下次活动（用户打开/恢复）时由 loop 认领该消息开始处理；GUI 打开时即显示为排队消息。
    // 落盘前折叠 inbox 现状求精确 splice start（dsh-agent-loop inboxProjectionDefinition 对 start>length 拒绝，
    // 错写会让会话恢复即抛 invalid persisted inbox splice——必须全量读日志现算，无更便宜通道）。
    // 幂等：同 msgId 已在队列则跳过追加（inbox 折叠对重复 pending id 拒绝，重复写入会毁掉恢复路径）。
    // 失败一律 { error, needOpen:true }（含「未打开」字样供调度链 lastError 口径与 UI 提示复用）。
    async function _queueDormantDispatch(sid, msg) {
      const fail = function (why) { return { error: '目标会话当前未打开，休眠送达失败（' + why + '）。请先打开它，或改用「新建会话」。', needOpen: true } }
      if (!sessionPersistence || typeof sessionPersistence.open !== 'function') return fail('宿主无 sessionPersistence.open 能力')
      let handle = null
      try { handle = await sessionPersistence.open(sid, 'write') } catch (e) { return fail('会话不存在于持久化存储或写锁被占用：' + String(e && e.message || e)) }
      try {
        const rd = await handle.read(0)
        const events = (rd && rd.events) || []
        // 折叠 durable inbox（同 loop 投影口径：agent/inbox/spliced 标准 splice 语义，越界钳位容错）
        const inbox = { 'next-turn': [], 'next-step': [] }
        for (const ev of events) {
          if (!ev || ev.type !== 'agent/inbox/spliced') continue
          const d = ev.data || {}
          const list = inbox[d.target]
          if (!Array.isArray(list)) continue
          const start = Math.max(0, Math.min(typeof d.start === 'number' && isFinite(d.start) ? Math.trunc(d.start) : list.length, list.length))
          const rm = typeof d.removedCount === 'number' && isFinite(d.removedCount) ? Math.min(Math.max(Math.trunc(d.removedCount), 0), list.length - start) : 0
          const ins = Array.isArray(d.inserted) ? d.inserted : []
          inbox[d.target] = list.slice(0, start).concat(ins, list.slice(start + rm))
        }
        const dup = inbox['next-turn'].concat(inbox['next-step']).some(function (m) { return m && m.id === msg.id })
        if (!dup) {
          await handle.append([{ type: 'agent/inbox/spliced', seq: events.length, time: Date.now(), data: { target: 'next-turn', start: inbox['next-turn'].length, inserted: [msg] } }])
          await handle.flush()   // 耐久屏障：flush 落定后崩溃也送达
        }
        return { ok: true }
      } catch (e) {
        return fail('日志追加异常：' + String(e && e.message || e))
      } finally { try { if (handle) await handle.close() } catch (e) {} }
    }

    // 任务派发（共享）：主动注入上下文 + 触发对话——agent.send 一条消息到目标会话，
    // source 标记为 { kind:'plugin', form:'recall' }（todo 作为"召回的上下文"，区别于用户指令/系统提示拼接），
    // wakeup=true 保证触发该会话 agent 去获取并处理这条上下文（可见反应，不污染系统提示）。
    // 双通道（0.4.4-B）：live 命中走现行 send 立即触发；未命中走休眠送达（_queueDormantDispatch 持久化排队，
    // 「下次活动送达」语义——不主动唤醒休眠会话），返回 queued:true + dispatches 记录带 queued 布尔。
    // opts: { sessionId, sessionName, workspace, mode('existing'|'new'), instruction, sourceLabel（派发来源标注，定时调度传 '定时调度 @约定标题'，进消息尾行与 dispatches 记录） }
    async function _dispatch(id, opts) {
      const o = opts || {}
      // 0.4.6-H（notes-046-smallfix，R2 n-mux9s42zajxk）：入口参数校验——缺 id / 笔记不存在统一返回结构化 {error}
      //   （与 notes-export-single 缺 dir 等姊妹 RPC 同口径；修复缺参时「cannot read "…\undefined.md"」把 undefined 拼进路径、泄漏内部存储形态）
      if (!id) return { error: '笔记不存在或参数缺失' }
      let note
      try { note = await _get(id) } catch (e) { return { error: '笔记不存在或参数缺失' } }
      if (note.deleted) return { error: '笔记已删除' }
      if (!o.sessionId) return { error: '缺少目标会话' }
      const instruction = String(o.instruction || '').trim()
      // 0.4.5-I（notes-045-periodic-no-resolve，用户裁决 2026-10-06 两轮合并）：派发完成不再指示目标 agent 把笔记标记已解决——
      //   周期/一次性定时/手动三形态全量统一（循环任务 resolved 语义困扰 + 已有执行历史）；闭环交给 idle 空闲回执
      //   （dispatchStatus→done + 执行记录伴生笔记 📥 行照落），resolved 保底联动机制保留为手动兜底（notes.js _update 不动）。
      const text = '【笔记插件 · 派发的待办上下文】\n\n【待办】' + (note.title || 'Untitled') + '\n' + String(note.body || note.title || '').trim() + (instruction ? '\n\n【派发方补充的要求】\n' + instruction : '') + '\n\n—— 以上是笔记插件派发给你的待办上下文（recall' + (o.sourceLabel ? '，来源：' + o.sourceLabel : '') + '）。请获取此上下文并开始处理。处理完即可，**不要**修改笔记状态（保持原样）；系统会在你会话空闲时自动回执本轮完成（派发记录与执行记录自动闭环）。' + (bodyHasImageRef(note.body) ? '\n\n' + assetsHintLine(NOTES_ROOT) : '')
      const msg = {
        id: 'note-dispatch-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        role: 'user',
        content: [{ type: 'text', text: text }],
        // form:'recall'：标记为"召回的上下文"而非用户指令；agent loop 照常处理（wakeup 触发），模型据 form 理解为参考资料
        // v0.1.7 起会话日志为 format v4：kind:'plugin' 是已退役的 v3 包装写法，落盘会抛
        // SessionFormatError 并炸掉目标会话当前轮次；v3→v4 迁移映射为 plugin:dsh-notes，直接写迁移后形态
        source: { kind: 'plugin:dsh-notes', form: 'recall' }
      }
      // 双通道分流（0.4.4-B）：live → send 立即触发；非 live → 休眠送达（持久化排队，下次活动送达）
      const target = agents && agents.get ? agents.get(o.sessionId) : undefined
      let queued = false
      if (target && typeof target.send === 'function') {
        target.send(msg, 'next-turn', true)
      } else {
        const q = await _queueDormantDispatch(o.sessionId, msg)
        if (q.error) return q
        queued = true
      }
      // 派发历史：作为笔记属性记录（不改正文）；P3 起带 dispatchStatus（'sent'|'done'）状态机字段，done 布尔保留兼容旧 client
      const rec = {
        sessionId: o.sessionId,
        sessionName: o.sessionName || shortSid(o.sessionId),
        workspace: o.workspace || '',
        mode: o.mode || 'existing',
        instruction: instruction,
        at: new Date().toISOString(),
        // msgId 派发消息关联键（定时调度 lastRun.receiptId 回执关联用；存量记录无此字段，向后兼容）
        msgId: msg.id,
        done: false,
        dispatchStatus: 'sent'
      }
      // queued 布尔（0.4.4-B）：休眠送达标记——仅 queued 时落键（存量/live 记录零字段变化，向后兼容）；
      // 回执闭环沿用 dispatch-loop（会话活动处理完该消息转 idle → 自动回执 done）
      if (queued) rec.queued = true
      if (o.sourceLabel) rec.sourceLabel = o.sourceLabel
      note.dispatches = (note.dispatches || []).concat([rec])
      note.updatedAt = new Date().toISOString()
      await persistNote(note)
      // 召回遥测（0.4.3+ 卡⑫ notes-043-inject-receipt）：mount 通道交付事件——笔记作为待办上下文挂载进目标任务会话
      // （notes-dispatch / note_manage.dispatch / 定时派发 _schedFire 三入口同走本单点；签名含会话——换会话重派计独立交付）
      _recallRaw('mount', [note.id], shortSid(o.sessionId))
      // 0.4.4-A（notes-044-dispatch-receipts）派发回执笔记化·三表归一：派发事件本身落「执行记录」伴生笔记 📤 行（派发历史笔记化）——
      //   懒创建 + runLog 软链回写（调度约定 schedule.runLog 存量继承 / 非调度笔记顶层 runLog）；观察面产物异常内部全吞，不扩散派发主链路
      await _schedRunLogAppend(note, [{ _dispatch: true, at: rec.at, sessionId: o.sessionId, sessionName: rec.sessionName, instruction: instruction, sourceLabel: o.sourceLabel || '', msgId: rec.msgId, queued: queued }])
      return { ok: true, id: note.id, sessionId: o.sessionId, sessionName: rec.sessionName, queued: queued, dispatch: rec }
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
      await _schedRunLogAppend(note, [ds[i]])   // 执行记录独立笔记（notes-041-sched-runlog）：手动标记同回执落盘口径（幂等由 msgId 去重兜底）
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
    // onlySessionId 限定只回执派发到该会话的条目（idle 事件回执用）；缺省全量（resolved 保底联动用）。返回新闭环条数；
    // out（可选数组，notes-041-sched-runlog）：收集本次新闭环的派发记录（执行记录独立笔记追加用）
    function _closeOpenDispatches(note, receipt, onlySessionId, out) {
      const ds = note.dispatches || []
      let closed = 0
      const now = new Date().toISOString()
      for (let i = 0; i < ds.length; i++) {
        const d = ds[i]
        if (isDispatchDone(d)) continue
        if (onlySessionId && (!d || d.sessionId !== onlySessionId)) continue
        ds[i] = Object.assign({}, d, { done: true, dispatchStatus: 'done', doneAt: now, receipt: receipt || 'manual' })
        if (out) out.push(ds[i])
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
        const closedDs = []   // 执行记录独立笔记（notes-041-sched-runlog）：收集本次闭环条目供 runLog 追加
        if (_closeOpenDispatches(n, 'idle', sid, closedDs) > 0) {
          n.updatedAt = new Date().toISOString()
          try { await persistNote(n, { history: false }) } catch (e) { console.error('notes: dispatch receipt persist failed', n.id, e) }
          await _schedRunLogAppend(n, closedDs)   // 0.4.4-A 起全笔记生效·三表归一（内部全量吞异常；源笔记正文零改动红线不破）
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
    // ==== schedule-exec BEGIN ====（定时派发·执行层：dispatch-schedule 声明解析 + 常驻 cron tick + 派发执行 + 状态三层。
    // 本块 host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致（schedule.js 双清单同名共源，无 .dist 变体），check.js 比对；改动必须双边同步）
    // 产品裁决（决策 n-muqyk2ve1sqx / n-musewkked3tq 设计定稿 2026-10-04）：形态 = 「约定即调度」——不做调度器 UI/cron 概念，
    //   约定笔记以 front-matter 结构化字段声明调度意图，插件识别执行（治理面复用约定车道：可见/可编辑/可停用，零新概念）。
    //   ①声明：contractType=dispatch-schedule 约定笔记 + schedule: { at | every, target, action:'dispatch', enabled }；
    //     正文 = 人话描述（即被派发的工作内容本身）。禁自然语言解析（错得安全：会真执行动作的能力声明必须无歧义）。
    //   ②常驻 cron：setInterval 30s tick + .unref() 不挂进程退出 + disposers cleanup（ctx.effect 统一消费，防重载双跑）；
    //     tick 内异常全量吞掉——全局异常 console.error，单笔记异常记该笔记 schedule.lastError，绝不能影响主服务。
    //   ③执行：到期 → 复用 _dispatch 全链路（标准派发卡，来源标注「定时调度 @约定标题」）；回执走既有 dispatch-loop 链路自动积累。
    //   ④状态三层：schedule.lastFiredAt / lastRun{at,status,receiptId} / lastError（front-matter 机器读写，随笔记落盘）；
    //     历史主载体 = 约定笔记既有 dispatches 数组（每次触发 _dispatch 自动登记，零新建）；不建独立 schedule-log。
    //   ⑤防重与错过：lastFiredAt 先落盘再派发是幂等生命线（进程在派发后崩溃最多漏记 lastRun，绝不重发同一触发）；
    //     单次 at 停机错过 → 启动补评估补发一次（lastFiredAt 空 + at 已过 → 到期即补）；轮询错过 → 触发一次即对齐下周期不追赶。
    //   ⑥校验红线（写入闸门 _schedValidateWrite）：at 必须未来且禁止时区后缀（本地时区语义：无后缀串 Date.parse 按本地解析；
    //     带 Z/±偏移会被按 UTC 解释造成整时区偏移——能力声明必须无歧义，错得安全一律拒绝）且禁止纯日期（YYYY-MM-DD 无 T 时间部分，
    //     ES 规范按 UTC 午夜解析，本地时区下产生整时区偏移——与时区后缀同类歧义，notes-034-at-need-time）；轮询间隔 ≥5min；目标会话必须存活（工作区有效且未归档）。
    //   ⑦锚定时刻（notes-034-sched-time）：every 可配 anchor:'HH:MM'（本地墙钟时刻，触发序列钉死该时刻不随创建/触发时刻漂移；
    //     需整天间隔——子日间隔锚定语义有歧义一律拒绝）；weekly 另配 dow:0-6（星期几，0=周日；需搭配 anchor 且 every=1w）。
    //     无 anchor 的存量 every 声明保持纯间隔语义（锚点 lastFiredAt||declaredAt||createdAt，0.4.6-F）——存量零迁移兼容。
    //   ⑨声明重锚（0.4.6-F，notes-046-sched-anchor）：schedule.declaredAt 机器字段（随 schedule JSON front-matter 落盘，已知键容忍输入但剥离）——
    //     声明字段（at/every/anchor/dow/target/action/enabled）任一变更或首次写入时，写入闸门刷新 declaredAt=当前时刻；
    //     声明未变更的改写（等价重提交/只改正文不过闸门）延续存量，缺省不留字段。到期锚点 = lastFiredAt || declaredAt || createdAt
    //     （字段缺省回退 = 存量零迁移）——修「编辑存量约定后当天误触发一轮」：旧口径锚点恒为 note.createdAt（编辑不推进），
    //     老约定（创建多日、从未触发）一经编辑 now-base 远超间隔即到期；重锚后锚点 = 本次声明时刻，下个调度点才触发。
    //     every+anchor 首触防过去候选（schedAnchorNextMs 注入 nowMs）：首触候选陈旧整天以上（base 陈旧）→ 对齐「now 之后第一个锚定时刻」
    //     ——首轮不补发，与⑤「轮询错过不追赶」口径对齐；当日内错过（轮询 tick 恒晚于锚点几秒~几分钟）→ 当日内补发
    //     （0.4.7 闸收紧，notes-047-anchor-firstfire：原「候选 < nowMs 即跳日」在 30s 轮询时钟下首触永不触发——次日 tick 再跳后日）；
    //     已触发分支与 at 单次停机补发语义（⑤）不动。
    //   ⑧专属会话 + 休眠送达（0.4.4-B，notes-044-dormant-dispatch）：target='new'（仅周期模式）= 首轮触发创建「定时 · <标题>」
    //     专属会话并随幂等生命线回写 target=新 sid（持久复用，后续轮次同 sid）；执行红线由「目标 live」改写为「目标可送达」——
    //     live 直通 / 持久化可达（stat 命中）走 _dispatch 休眠送达通道（durable inbox 排队，下次活动送达，零唤醒）；
    //     两路皆不可达才记 lastError 不推进 lastFiredAt（补发语义不变）。lastRun.status 新增 queued 枚举（休眠送达标记）。
    //   ⑩专属会话模型档位（0.4.6-G，notes-046-sched-model）：schedule 声明增可选 model/provider（成对出现、非空字符串；
    //     合法性不联网校验——创建时 agents.create 失败即落 lastError）。declared model/provider 透传 _schedCreateDedicatedSession
    //     的 agentOptions（覆盖宿主默认选择）；缺省 = 现状默认模型（存量零迁移）。声明变更比对键随之扩为九键（重锚口径不变）。
    // 序位说明（§8.4.2 例外备案）：本模块消费 dispatch.js 的 _dispatch 故置于其后；notes.js 的 _create/_update 经函数声明提升
    //   调用本模块的 _schedValidateWrite/SCHEDULE_CONTRACT_TYPE——全部为运行期（RPC 调用时）引用，apply 执行期零触碰，无 TDZ 风险。
    const SCHED_TICK_MS = 30 * 1000              // 常驻 tick 周期（裁决②）
    const SCHED_MIN_INTERVAL_MS = 5 * 60 * 1000  // 校验红线：轮询间隔 ≥5min
    const SCHED_ERR_RETRY_MS = 5 * 60 * 1000     // 执行失败 lastError 刷写节流（防 30s tick 对同一故障反复写盘）
    const SCHEDULE_CONTRACT_TYPE = 'dispatch-schedule'   // 契约身份标记（front-matter contractType，调度声明的主识别键）
    // 专属会话目标字面量（0.4.4-B，notes-044-dormant-dispatch）：schedule.target='new' = 周期任务专属会话——
    //   首轮触发时 agents.create 创建「定时 · <任务名>」会话并回写 target=新 sid（持久复用），后续轮次 live 直发/休眠送达复用同一会话。
    //   仅周期模式（every）接受；存量真实 sid 声明零迁移兼容（'new' 是保留字面量，绝非合法会话 id 形态——session-* 前缀约束天然隔离）。
    const SCHED_TARGET_NEW = 'new'

    // every 声明 → 毫秒：number 直给（毫秒）；字符串 '<n>m|<n>h|<n>d|<n>w'（分钟/小时/天/周）。非法 → null
    function schedEveryMs(every) {
      if (typeof every === 'number' && isFinite(every) && every > 0) return Math.floor(every)
      if (typeof every === 'string') {
        const m = every.trim().match(/^(\d+)([mhdw])$/)
        if (m) {
          const n = parseInt(m[1], 10)
          const unit = { m: 60000, h: 3600000, d: 86400000, w: 604800000 }[m[2]]
          return n * unit
        }
      }
      return null
    }

    // 锚定时刻（notes-034-sched-time）：'HH:MM' → 当日分钟偏移 ms（本地墙钟）；非法 → null
    function schedAnchorMs(anchor) {
      const m = typeof anchor === 'string' ? anchor.match(/^([01]\d|2[0-3]):([0-5]\d)$/) : null
      return m ? (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 60000 : null
    }

    // 锚定时刻序列（notes-034-sched-time）：anchor 声明 → 触发时刻钉死本地 HH:MM，不随创建/触发时刻漂移。
    //   首触（fired=false，base=declaredAt||createdAt，0.4.6-F）= base 之后第一个锚定时刻（weekly 限定 dow 星期几）；
    //   后续（fired=true，base=lastFiredAt）= base + 间隔 所在本地日的锚定时刻（weekly = 下一个 dow 锚定时刻）——
    //   触发延迟（停机错过）只推迟本次，后续仍落回同一时刻序列。
    //   0.4.6-F（notes-046-sched-anchor）首触防过去候选：注入 nowMs 时，首触候选陈旧（base 陈旧：declaredAt 重锚前存量/停机多日）
    //   → 对齐「now 之后第一个锚定时刻」（首轮不补发，与⑤轮询错过不追赶口径对齐）；已触发分支不注入该闸（停机补发一次语义保留）。
    //   0.4.7（notes-047-anchor-firstfire）闸收紧：「落在过去」改判「陈旧整天以上」——候选 < now 当日午夜才跳日/跳周对齐；
    //   候选仅在当日之内错过（nday0 ≤ 候选 < nowMs）正常返回 → 下个 tick 当日内补发（与⑤ at 单次停机补发语义对齐）。
    //   坑（测试时钟盲区）：真实运行是 30s 轮询时钟，tick 恒晚于锚点几秒~几分钟、打不中精确等号——原口径 first < nowMs 即跳日，
    //   新建锚定任务首触永不触发（次日 tick 再跳后日）；e2e/单元测试虚拟时钟精确对齐等号所以全绿，用户实测钓出。
    //   dow=0-6（0=周日，Date.getDay 口径）；ivMs 需整天倍数（写入闸门保证）。非法 → null
    function schedAnchorNextMs(anchor, dow, ivMs, baseMs, fired, nowMs) {
      const off = schedAnchorMs(anchor)
      if (off === null || !isFinite(baseMs) || !baseMs) return null
      const b = new Date(baseMs)
      const day0 = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()   // base 所在本地日午夜
      // 首触防过去候选闸（0.4.7 收紧）：nday0 = now 当日午夜——候选 < nday0（陈旧整天以上）才跳日/跳周对齐；当日内错过照常返回 → 下个 tick 补发
      const hasNow = typeof nowMs === 'number' && isFinite(nowMs)
      const nd0 = hasNow ? new Date(nowMs) : null
      const nday0 = nd0 ? new Date(nd0.getFullYear(), nd0.getMonth(), nd0.getDate()).getTime() : 0   // now 所在本地日午夜
      if (typeof dow === 'number') {
        // weekly：自 base 当日逐日找首个 getDay()===dow 且锚定时刻 > base 的候选（已触发 → 下周同 dow 准点；首触 → base 之后第一个 dow 锚定时刻）
        let firstDow = null
        for (let i = 0; i < 14; i++) {
          const dm = day0 + i * 86400000
          if (new Date(dm).getDay() === dow && dm + off > baseMs) { firstDow = dm + off; break }
        }
        if (firstDow === null) return null
        if (fired || !hasNow) return firstDow
        // 首触防过去候选（0.4.6-F → 0.4.7 收紧，与每日分支同法）：候选陈旧整天以上（< now 当日午夜）→ 对齐「now 之后第一个 dow 锚定时刻」
        //   （首轮不补发）；当日内错过（今日 dow 锚点刚过几分钟）不跳周——下个 tick 当日内补发
        if (firstDow < nday0) {
          for (let j = 0; j < 14; j++) {
            const dn = nday0 + j * 86400000
            if (new Date(dn).getDay() === dow && dn + off >= nowMs) return dn + off
          }
          return null
        }
        return firstDow
      }
      if (typeof ivMs !== 'number' || !isFinite(ivMs) || ivMs % 86400000 !== 0) return null
      if (fired) { const f = new Date(baseMs + ivMs); return new Date(f.getFullYear(), f.getMonth(), f.getDate()).getTime() + off }
      // 首触：base 当日锚定时刻未到 → 当日；已过 → 次日
      const first = (day0 + off > baseMs ? day0 : day0 + 86400000) + off
      // 首触防过去候选（0.4.6-F → 0.4.7 收紧 first < nday0 陈旧整天以上才跳）：对齐「now 之后第一个锚定时刻」（当日锚定未到 → 当日；已过 → 次日）
      if (hasNow && first < nday0) {
        return (nday0 + off >= nowMs ? nday0 : nday0 + 86400000) + off
      }
      return first
    }

    // 声明纯校验（同步部分：形状/未知键/动作/at 未来/every 下限；目标存活为异步部分由 _schedValidateWrite 补）。
    // 返回 { value: 归一化声明 } | { error }；机器状态字段（lastFiredAt/lastRun/lastError）容忍输入但剥离（由既有值延续，见 _schedValidateWrite）
    function schedCheckDecl(raw, nowMs) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'schedule 必须是对象 { at|every, target, action?, enabled?, anchor?, dow?, model?, provider? }' }
      // runLog（notes-041-sched-runlog）：执行记录独立笔记 id 软链——机器字段（回执链路懒创建回写），已知键容忍输入，闸门校验/延续见 _schedValidateWrite
      // declaredAt（0.4.6-F，notes-046-sched-anchor）：声明重锚时刻——机器字段（闸门赋值/延续），同列已知键容忍输入但剥离（防伪声明注入锚点）
      const known = { at: 1, every: 1, target: 1, action: 1, enabled: 1, anchor: 1, dow: 1, model: 1, provider: 1, lastFiredAt: 1, lastRun: 1, lastError: 1, runLog: 1, declaredAt: 1 }
      for (const k of Object.keys(raw)) {
        if (!known[k]) return { error: 'schedule 含未知字段 ' + k + '（声明只允许 at/every/anchor/dow/target/action/enabled/model/provider；错得安全：能力声明必须无歧义）' }
      }
      const at = raw.at !== undefined && raw.at !== null && raw.at !== '' ? String(raw.at).trim() : ''
      const every = raw.every !== undefined && raw.every !== null && raw.every !== '' ? raw.every : undefined
      // 锚定时刻（notes-034-sched-time）：anchor='HH:MM' 本地时刻 / dow=0-6 星期几（weekly）——空串/null 视为未声明
      const anchorRaw = raw.anchor !== undefined && raw.anchor !== null && raw.anchor !== '' ? String(raw.anchor).trim() : ''
      const hasDow = raw.dow !== undefined && raw.dow !== null && raw.dow !== ''
      if (at && every !== undefined) return { error: 'schedule.at 与 schedule.every 二选一（单次定时 / 轮询定时），不能同时声明' }
      if (!at && every === undefined) return { error: 'schedule 需要 at（单次定时 ISO 时间）或 every（轮询间隔，如 30m/12h/3d）' }
      const target = String(raw.target || '').trim()
      if (!target) return { error: 'schedule.target 缺省：必须声明目标会话 id' }
      const action = raw.action === undefined ? 'dispatch' : String(raw.action)
      if (action !== 'dispatch') return { error: 'schedule.action 仅支持 dispatch（实得 ' + action + '）' }
      const enabled = raw.enabled === undefined ? true : raw.enabled
      if (typeof enabled !== 'boolean') return { error: 'schedule.enabled 必须是布尔值' }
      const value = { target: target, action: 'dispatch', enabled: enabled }
      if (at) {
        // 锚定时刻字段仅周期模式（every）有效——单次 at 自身即完整时刻声明，混声明有歧义一律拒绝
        if (anchorRaw || hasDow) return { error: 'schedule.anchor/dow 仅周期模式（every）有效，单次 at 不接受锚定字段（错得安全：能力声明必须无歧义）' }
        // 校验红线①·本地时区闸门（notes-034-at-local-tz）：拒绝一切时区后缀（Z/z 结尾或 ±HH:MM/±HHMM 偏移），
        //   at 钉死「本地机器时间」语义——无后缀串 Date.parse 按本地解析，带后缀会被按 UTC 解释造成整时区偏移（错得安全：能力声明必须无歧义）
        if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(at)) return { error: 'schedule.at 必须是不带时区的本地时间（如 2026-10-05T09:00），禁止 Z/±偏移后缀（实得 ' + at + '）' }
        const atMs = Date.parse(at)
        if (!isFinite(atMs)) return { error: 'schedule.at 非法时间：' + at + '（期望 ISO 时间串）' }
        // 校验红线①·b 纯日期闸门（notes-034-at-need-time）：at 必须含 'T' 时间部分——纯日期 YYYY-MM-DD 被 ES 规范按 UTC 午夜解析，
        //   本地时区（如 UTC+8）下产生整时区偏移，与时区后缀同属「非本地语义」歧义一律拒绝（置于非法时间之后、未来性之前：纯日期无论古今同口径拒绝）
        if (at.indexOf('T') < 0) return { error: 'schedule.at 必须含日期和时间（如 2026-10-05T09:00），不接受纯日期（实得 ' + at + '）' }
        if (atMs <= nowMs) return { error: 'schedule.at 必须是未来时间（实得 ' + at + '）' }   // 校验红线①
        value.at = at
      } else {
        const iv = schedEveryMs(every)
        if (iv === null) return { error: 'schedule.every 非法：' + JSON.stringify(every) + '（期望毫秒数或 <n>m/<n>h/<n>d/<n>w）' }
        if (iv < SCHED_MIN_INTERVAL_MS) return { error: 'schedule.every 轮询间隔不得低于 5 分钟（实得 ' + Math.round(iv / 1000) + 's）' }   // 校验红线②
        value.every = every
        // 校验红线④·锚定时刻（notes-034-sched-time）：anchor 钉死触发时刻序列（首触=下一个本地 anchor 时刻，不随创建时间漂移）——
        //   HH:MM 严格两位格式；需整天间隔（子日间隔锚定语义有歧义，错得安全一律拒绝）
        if (anchorRaw) {
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(anchorRaw)) return { error: 'schedule.anchor 非法：' + JSON.stringify(raw.anchor) + '（期望 HH:MM 本地时刻，如 09:00）' }
          if (iv % 86400000 !== 0) return { error: 'schedule.anchor 需搭配整天周期（每天/每周/每 N 天），子日间隔锚定语义有歧义（实得 every=' + JSON.stringify(every) + '）' }
          value.anchor = anchorRaw
        }
        if (hasDow) {
          if (!anchorRaw) return { error: 'schedule.dow 需搭配 anchor 使用（每周模式锚定：{ every: \'1w\', anchor: \'09:00\', dow: 1 }）' }
          if (typeof raw.dow !== 'number' || !isFinite(raw.dow) || Math.floor(raw.dow) !== raw.dow || raw.dow < 0 || raw.dow > 6) return { error: 'schedule.dow 非法：' + JSON.stringify(raw.dow) + '（期望 0-6 整数，0=周日）' }
          if (iv !== 604800000) return { error: 'schedule.dow 仅每周模式有效（every=\'1w\'；实得 every=' + JSON.stringify(every) + '）' }
          value.dow = raw.dow
        }
      }
      // 专属会话（0.4.4-B）：target='new' 仅周期模式（every）接受——首轮触发自动创建并回写复用；单次 at 无复用场景一律拒绝（错得安全）
      if (target === SCHED_TARGET_NEW && !value.every) return { error: 'schedule.target=\'new\' 专属会话仅周期模式（every）支持——首轮触发自动创建「定时 · 任务名」会话并持久复用；单次 at 请直接指定目标会话 id' }
      // 专属会话模型档位（0.4.6-G，notes-046-sched-model）：model/provider 成对出现（单给其一即歧义拒绝），非空字符串；
      //   空串/null 视为未声明（同 anchor 口径）。合法性不联网校验——创建时 agents.create 失败即落 lastError（声明期零网络，同 at/anchor 纯校验口径）
      const hasModel = raw.model !== undefined && raw.model !== null && raw.model !== ''
      const hasProvider = raw.provider !== undefined && raw.provider !== null && raw.provider !== ''
      if (hasModel !== hasProvider) return { error: 'schedule.model 与 schedule.provider 必须成对出现（专属会话模型档位，单给其一有歧义——错得安全）' }
      if (hasModel) {
        if (typeof raw.model !== 'string' || typeof raw.provider !== 'string') return { error: 'schedule.model/provider 必须是字符串（实得 model:' + typeof raw.model + ' / provider:' + typeof raw.provider + '）' }
        const mv = String(raw.model).trim(), pv = String(raw.provider).trim()
        if (!mv || !pv) return { error: 'schedule.model/provider 不能是空白字符串（错得安全：能力声明必须无歧义）' }
        value.model = mv; value.provider = pv
      }
      return { value: value }
    }

    // 声明字段等价比对（0.4.6-F，notes-046-sched-anchor）：at/every/anchor/dow/target/action/enabled 七键 + 0.4.6-G model/provider 九键——
    //   undefined/null/空串归一为空串比对；任一差异 = 声明变更（declaredAt 重锚触发条件）。
    //   归一化声明（action/enabled 由闸门补齐缺省）与存量比对时，存量缺键（如裸编辑旁路未带 action）按变更处理——保守刷新安全向。
    function schedDeclChanged(decl, ex) {
      const keys = ['at', 'every', 'anchor', 'dow', 'target', 'action', 'enabled', 'model', 'provider']
      for (const k of keys) {
        const a = decl[k], b = ex && ex[k]
        const an = (a === undefined || a === null || a === '') ? '' : String(a)
        const bn = (b === undefined || b === null || b === '') ? '' : String(b)
        if (an !== bn) return true
      }
      return false
    }

    // 校验红线③：目标会话必须存活——live 直通；非 live 须在工作区有效会话清单内且未归档（live 与否不影响声明准入，执行时再要求 live）
    async function _schedTargetAliveErr(target) {
      const live = agents && agents.get ? agents.get(target) : undefined
      if (live) return ''
      try {
        const archived = {}
        const arch = workspaceRegistry && workspaceRegistry.archivedSessionIds
        if (Array.isArray(arch)) { for (const id of arch) archived[id] = true }
        const wl = workspaceRegistry && workspaceRegistry.list ? workspaceRegistry.list() || [] : []
        for (const w of wl) {
          const sids = (w && w.sessionIds) || []
          for (const sid of sids) { if (sid === target && !archived[sid]) return '' }
        }
      } catch (e) {}
      return 'schedule.target 目标会话不存在或已归档：' + target
    }

    // 写入闸门（_create/_update 共用）：纯校验 + 目标存活 + 机器状态延续。返回 { value }（null=显式清除）| { error }
    // existingSched = 存量 schedule（update 场景）：声明字段被覆盖，机器状态字段（lastFiredAt/lastRun/lastError/runLog）延续——
    //   防重锚点对声明变更自洽（at 改新未来时刻：旧 lastFiredAt < 新 at 自然再触发一次；every 已触发变更：锚点不动对齐下周期）；
    //   declaredAt（0.4.6-F）属机器字段但语义相反——声明字段变更/首次写入时刷新为当前时刻（重锚），未变更改写延续。
    async function _schedValidateWrite(raw, contractType, existingSched) {
      if (raw === null) {
        // 显式清除：契约仍是 dispatch-schedule 时拒绝（契约 ⟺ 声明配对不变量，防悬空调度笔记）
        if ((contractType || '') === SCHEDULE_CONTRACT_TYPE) return { error: 'contractType=dispatch-schedule 需要 schedule 声明；解除调度请同时清除 contractType（contractType: \'\' + schedule: null）' }
        return { value: null }
      }
      if ((contractType || '') !== SCHEDULE_CONTRACT_TYPE) return { error: 'schedule 字段仅允许 contractType=dispatch-schedule 的约定笔记（错得安全：会真执行动作的能力声明必须显式契约分型）' }
      const nowMs = Date.now()
      const chk = schedCheckDecl(raw, nowMs)
      if (chk.error) return { error: chk.error }
      const decl = chk.value
      // 校验红线③目标存活：enabled=false（停用/暂停）豁免——暂停操作随时可落，不因目标漂移锁死治理面；
      //   target='new'（0.4.4-B 专属会话）同豁免——首轮触发时才创建，声明期无目标可校验
      if (decl.enabled !== false && decl.target !== SCHED_TARGET_NEW) {
        const aliveErr = await _schedTargetAliveErr(decl.target)
        if (aliveErr) return { error: aliveErr }
      }
      const ex = existingSched || {}
      if (ex.lastFiredAt) decl.lastFiredAt = ex.lastFiredAt
      if (ex.lastRun) decl.lastRun = ex.lastRun
      if (ex.lastError) decl.lastError = ex.lastError
      // declaredAt（0.4.6-F，notes-046-sched-anchor 声明重锚）：声明字段（schedDeclChanged 九键，0.4.6-G 扩 model/provider）任一变更或首次写入 → 刷新为当前时刻
      //   （到期锚点由陈旧 createdAt 改为本次声明时刻，修「编辑存量约定当天误触发」；输入携带的 declaredAt 已被 schedCheckDecl 剥离，
      //   此处纯机器赋值/延续，伪声明无法注入锚点）；声明未变更的改写延续存量 declaredAt，存量缺省不留字段（到期回退 createdAt，零迁移）
      if (!existingSched || schedDeclChanged(decl, ex)) decl.declaredAt = new Date(nowMs).toISOString()
      else if (ex.declaredAt) decl.declaredAt = ex.declaredAt
      // runLog 软链（notes-041-sched-runlog）：显式声明须为存在的笔记 id（空串 = 显式解除软链，runLog 笔记留档不级联删）；
      //   缺省（未携带）延续存量——声明改写（编辑/暂停/恢复只提交声明字段）不丢软链
      if (raw.runLog !== undefined && raw.runLog !== null) {
        if (raw.runLog === '') { /* 显式解除软链：decl 不带 runLog */ }
        else {
          if (typeof raw.runLog !== 'string') return { error: 'schedule.runLog 必须是笔记 id 字符串或空串（实得 ' + typeof raw.runLog + '）' }
          const rlId = raw.runLog.trim()
          let rlOk = false
          try { const t = await loadNote(rlId); rlOk = !!(t && !t.deleted && !t.tombstoned) } catch (e) {}
          if (!rlOk) return { error: 'schedule.runLog 必须是存在的笔记 id 或空（实得 ' + raw.runLog + '）' }
          decl.runLog = rlId
        }
      } else if (ex.runLog) decl.runLog = ex.runLog
      return { value: decl }
    }

    // 公共写入口（RPC / note_manage 工具）contractType 白名单：''（清除）或 dispatch-schedule（定时派发声明）；
    // memory-guide 等内部契约类型由系统流程直写 _create/_update，不对公共入口开放
    function schedPublicContractTypeError(ct) {
      if (ct === undefined || ct === '' || ct === SCHEDULE_CONTRACT_TYPE) return ''
      return 'contractType 公共写入口仅支持 \'dispatch-schedule\' 或 \'\'（其余契约类型由系统内部流程管理）'
    }

    // 到期判定（纯函数，注入时钟 nowMs 便于测试与回放）：
    //   at：lastFiredAt < at <= now → 到期（lastFiredAt 空 = 从未触发——含停机错过启动补发场景；触发后 lastFiredAt ≥ at 永不重发）
    //   every：锚点 = lastFiredAt || declaredAt || createdAt（0.4.6-F 声明重锚：declaredAt=声明最近写入时刻，缺省回退 createdAt 存量零迁移）；
    //     now - 锚点 ≥ 间隔 → 到期（触发后 lastFiredAt=本次时刻对齐下周期，错过不追赶）；
    //   every + anchor（notes-034-sched-time 锚定时刻）：到期 = now ≥ 锚定序列下一时刻（schedAnchorNextMs 注入 nowMs——
    //     首触防过去候选：候选陈旧整天以上对齐下一轮不补发（0.4.6-F；0.4.7 收紧——当日内错过当日内补发，notes-047-anchor-firstfire）；钉死本地 HH:MM 不漂移）；
    //   无 anchor 存量声明保持纯间隔语义（零迁移兼容）；非法声明（写入闸门已拦，此处双保险）一律不触发
    function schedDueAt(note, sched, nowMs) {
      const lastFiredMs = sched.lastFiredAt ? Date.parse(sched.lastFiredAt) : 0
      const firedMs = isFinite(lastFiredMs) ? lastFiredMs : 0
      if (sched.at) {
        const atMs = Date.parse(sched.at)
        if (!isFinite(atMs)) return false
        return atMs <= nowMs && firedMs < atMs
      }
      const iv = schedEveryMs(sched.every)
      if (iv === null || iv < SCHED_MIN_INTERVAL_MS) return false
      const declaredMs0 = sched.declaredAt ? Date.parse(sched.declaredAt) : 0
      const declaredMs = isFinite(declaredMs0) ? declaredMs0 : 0
      const base = firedMs || declaredMs || Date.parse(note.createdAt || '') || 0
      if (sched.anchor) {
        const next = schedAnchorNextMs(sched.anchor, typeof sched.dow === 'number' ? sched.dow : undefined, iv, base, !!firedMs, nowMs)
        return next !== null && nowMs >= next
      }
      return nowMs - base >= iv
    }

    // lastError 落盘（状态三层①失败面）：throttle=true 时 5min 节流（目标未存活等持续性故障防 tick 刷写）；
    // { history:false }：机器状态回写不算编辑，不产生历史快照（dispatch-loop 回执同先例）
    async function _schedMarkError(noteId, message, nowMs, throttle) {
      const n = await loadNote(noteId)
      if (!n || !n.schedule) return
      const nowIso = new Date(nowMs).toISOString()
      if (throttle) {
        const lastErrMs = n.schedule.lastError && n.schedule.lastError.at ? Date.parse(n.schedule.lastError.at) : 0
        if (isFinite(lastErrMs) && lastErrMs && nowMs - lastErrMs < SCHED_ERR_RETRY_MS) return
      }
      n.schedule = Object.assign({}, n.schedule, { lastError: { at: nowIso, message: String(message || 'unknown') }, lastRun: { at: nowIso, status: 'error', receiptId: '' } })
      n.updatedAt = nowIso
      try { await persistNote(n, { history: false }) } catch (e) { console.error('notes: schedule lastError persist failed', noteId, e) }
    }

    // 专属会话创建（0.4.4-B）：agents.create 真实 agent（走注册 factory——持久化写把手 + 会话注册一体），
    //   setup 内 agentPresets.mount 绑定默认 preset（同 session-controller composeAgent 口径——无 preset 的裸 agent 无工具能力）；
    //   workspace.attachSession 落账（GUI 左侧列表可见性——工作区 sessionIds 经 header cwd 校验归组）；
    //   sessionTitle.rename 命名「定时 · <任务名>」（观察面，失败不阻塞主链路）。
    //   孤儿探测（0.4.5-A notes-045-debt-host）：创建前先按标题探测工作区账目内既有同名专属会话（target 回写失败窗口遗留），
    //   命中即复用其 sid 返回（reused:true，handle=null——非本轮创建，调用方回收路径跳过），未命中才新建（防重复建会话）。
    //   归属模型（实测结论）：create 经调用方 fiber 归属——插件重载/卸载会 dispose 该 agent，但会话日志已持久化，
    //   退化为休眠态（GUI 可见、用户打开即复活），后续触发由休眠送达通道（_queueDormantDispatch）承接，优雅降级不丢任务。
    //   返回 { sessionId, handle, name } | { error }；失败方负责回收半成品（handle.dispose），调用方零清理负担。
    async function _schedCreateDedicatedSession(note) {
      if (!agents || typeof agents.create !== 'function') return { error: '宿主不支持 agents.create（无法创建专属会话）' }
      if (!agentPresets || typeof agentPresets.resolve !== 'function' || typeof agentPresets.mount !== 'function') return { error: 'agentPresets 服务缺失（专属会话需挂载默认 preset 获得工具能力）' }
      // 工作区归属：note.workspace 标题命中优先（笔记创建时自会话上下文自动填充），缺省回落首个工作区
      const wl = workspaceRegistry && workspaceRegistry.list ? workspaceRegistry.list() || [] : []
      if (!wl.length) return { error: '无可用工作区（专属会话无处归属）' }
      let ws = null
      const wtitle = String((note && note.workspace) || '').trim()
      if (wtitle) { for (const w of wl) { if (w && (w.title || '') === wtitle) { ws = w; break } } }
      if (!ws) ws = wl[0]
      const cwd = String((ws && ws.path) || '').trim()
      if (!cwd) return { error: '工作区缺 path（专属会话无 cwd 不可创建）' }
      const name = '定时 · ' + String((note && note.title) || '任务').replace(/^定时\s*·?\s*/, '')
      // 孤儿专属会话探测（0.4.5-A notes-045-debt-host，B 卡 verifier 遗留④）：「agents.create 成功但 target 回写落盘失败/
      //   进程崩溃于回写前」的极端窗口下，工作区账目里已存在上次创建的同名专属会话——下 tick 若不探测会重复创建。
      //   修复：创建前先按标题「定时 · <任务名>」探测既有专属会话（工作区 sessionIds 账目 + readTitleSnapshots 批量读标题，
      //   live/持久化双覆盖，同 _activeSessions 数据源口径），命中则复用其 sid 回写 target（零新建），未命中才走新建。
      //   探测失败（服务缺失/读盘异常）静默降级为直接新建——与改造前行为等价，不扩散主链路。
      try {
        const archivedSet = {}
        const arch0 = workspaceRegistry && workspaceRegistry.archivedSessionIds
        if (Array.isArray(arch0)) { for (const id of arch0) archivedSet[id] = true }
        const candIds = ((ws && ws.sessionIds) || []).filter(function (s) { return s && !archivedSet[s] })
        if (candIds.length && sessionQuery && typeof sessionQuery.readTitleSnapshots === 'function') {
          const snaps = await sessionQuery.readTitleSnapshots(candIds)
          for (const r of (snaps || [])) {
            if (!r || r.status !== 'fulfilled' || !r.value) continue
            const rt = r.value.title && r.value.title.title
            const rsid = r.sessionId || (r.value.session && r.value.session.id)
            // 标题精确命中专属会话命名形态即复用；handle=null（复用会话非本轮创建，调用方 dispose 回收路径天然跳过）
            if (rt === name && rsid) return { sessionId: rsid, handle: null, name: name, reused: true }
          }
        }
      } catch (e) {}
      let presetId
      try { const p = await agentPresets.resolve(); presetId = p && p.id } catch (e) { return { error: 'preset 解析失败：' + String(e && e.message || e) } }
      // 0.4.6-G（notes-046-sched-model）：声明档位 model/provider 优先（写入闸门保证成对非空；合法性=agents.create 成败即 lastError，此处零校验）；
      //   缺省回落宿主当前选择（adm.currentSelection）——无声明存量任务行为零变化（存量零迁移红线）
      const declSel = (function () { const sc = (note && note.schedule) || {}; return (typeof sc.provider === 'string' && sc.provider && typeof sc.model === 'string' && sc.model) ? { provider: sc.provider, model: sc.model } : null })()
      const sel = declSel || (adm && typeof adm.currentSelection === 'function' ? adm.currentSelection() : null)
      const sid = 'session-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
      let handle = null
      try {
        handle = await agents.create({
          sessionId: sid,
          agentOptions: sel ? { provider: sel.provider, model: sel.model } : {},
          meta: presetId ? { cwd: cwd, agentPreset: presetId } : { cwd: cwd },
          // setup 契约（0.4.5 热修，活机故障「(intermediate value)?.commit is not a function」实锤）：宿主
          //   dsh-agent-loop setupAndPublish 对 setup 返回值调 `?.commit()`——mount 返回 disposer 函数会炸。
          //   正解（session-controller composeAgent 同款）：await 掉 mount，setup 本身返回 undefined（?. 短路安全）。
          setup: async function (agentCtx) { await agentPresets.mount(agentCtx, presetId) }
        })
      } catch (e) { return { error: 'agents.create 失败：' + String(e && e.message || e) } }
      // GUI 可见性落账（致命）：失败回收 agent 报错（lastFiredAt 未推进，下 tick 重试创建）
      try { if (typeof ws.attachSession === 'function') await ws.attachSession(sid) } catch (e) {
        try { if (handle && typeof handle.dispose === 'function') await handle.dispose() } catch (e2) {}
        return { error: '工作区落账失败：' + String(e && e.message || e) }
      }
      // 命名（非致命观察面：失败时 GUI 显示缺省标题，不阻塞派发）
      try { if (sessionTitle && typeof sessionTitle.rename === 'function' && handle && handle.agent && handle.agent.session) sessionTitle.rename(handle.agent.session, name) } catch (e) {}
      return { sessionId: sid, handle: handle, name: name }
    }

    // 单笔记触发：专属会话首轮创建（target='new'）→ 可送达预检 → 标记 lastFiredAt 落盘（幂等生命线，先于派发）→ _dispatch 全链路 → lastRun 回写
    async function _schedFire(note, nowMs) {
      const nowIso = new Date(nowMs).toISOString()
      const sched = note.schedule
      // 专属会话（0.4.4-B）：target='new' → 首轮触发先创建「定时 · <标题>」会话，target 回写随幂等生命线同事务落盘（持久复用）
      let created = null
      let effTarget = sched.target
      if (sched.target === SCHED_TARGET_NEW) {
        created = await _schedCreateDedicatedSession(note)
        if (!created || created.error) {
          await _schedMarkError(note.id, '专属会话创建失败：' + (created && created.error || 'unknown'), nowMs, true)
          return false   // 不推进 lastFiredAt——下个 tick 自动重试创建
        }
        effTarget = created.sessionId
      } else {
        // 执行红线（0.4.4-B 改写：目标 live ⟹ 可送达）：live 直通；非 live 探持久化可达（stat 命中 = 休眠送达可排队）——
        //   两路皆不可达 → 记 lastError（节流）不推进 lastFiredAt（目标上线/可送达后下个 tick 自动补发）
        const target = agents && agents.get ? agents.get(effTarget) : undefined
        if (!target || typeof target.send !== 'function') {
          let reachable = false
          try { reachable = !!(sessionPersistence && typeof sessionPersistence.stat === 'function' && (await sessionPersistence.stat(effTarget))) } catch (e) {}
          if (!reachable) {
            await _schedMarkError(note.id, '目标会话当前未打开且持久化不可达，无法触发工作（目标 live 或可送达后下个 tick 自动补发）', nowMs, true)
            return false
          }
        }
      }
      // 幂等生命线：先推进 lastFiredAt 落盘再派发（专属会话首轮：target=新 sid 同事务回写）——进程在「派发后、lastRun 回写前」崩溃最多漏记一次 lastRun，绝不重发同一触发
      const marked = await loadNote(note.id)
      if (!marked || marked.deleted || marked.tombstoned || !marked.schedule || (marked.contractType || '') !== SCHEDULE_CONTRACT_TYPE) {
        if (created && created.handle && typeof created.handle.dispose === 'function') { try { await created.handle.dispose() } catch (e) {} }
        return false
      }
      const markedSched = Object.assign({}, marked.schedule, { lastFiredAt: nowIso })
      if (created) markedSched.target = created.sessionId   // 专属会话持久复用锚点：次轮起按真实 sid 走 live/休眠双通道
      delete markedSched.lastError   // lastError 仅失败记：进入成功路径即摘除（不留空串脏键）
      marked.schedule = markedSched
      marked.updatedAt = nowIso
      try { await persistNote(marked, { history: false }) } catch (e) {
        console.error('notes: schedule lastFiredAt mark failed', note.id, e)
        if (created && created.handle && typeof created.handle.dispose === 'function') { try { await created.handle.dispose() } catch (e2) {} }   // 落盘失败回收新建 agent（防孤儿 live 会话）
        return false
      }
      const r = await _dispatch(note.id, { sessionId: effTarget, sessionName: created ? created.name : undefined, mode: 'existing', sourceLabel: '定时调度 @' + (marked.title || note.title || note.id) })
      if (r && r.error) {
        await _schedMarkError(note.id, '派发执行失败：' + r.error, nowMs, false)
        return false
      }
      // 状态三层①：lastRun{at,status,receiptId}（status：sent=live 直发 / queued=休眠送达·下次活动处理（0.4.4-B 新增枚举值，存量 sent/error 不变）；
      //   receiptId = 派发消息 msgId，与 dispatches 记录关联；回执闭环走既有 dispatch-loop 链路）
      const done = await loadNote(note.id)
      const doneSched = Object.assign({}, done.schedule, { lastRun: { at: nowIso, status: r && r.queued ? 'queued' : 'sent', receiptId: (r.dispatch && r.dispatch.msgId) || '' } })
      delete doneSched.lastError   // lastError 仅失败记：派发成功摘除
      done.schedule = doneSched
      done.updatedAt = nowIso
      try { await persistNote(done, { history: false }) } catch (e) { console.error('notes: schedule lastRun persist failed', note.id, e) }
      return true
    }

    // tick：全库扫描 contractType=dispatch-schedule + enabled!==false 的笔记逐一到期评估。全量吞异常（绝不扩散到主服务）。
    async function _schedTick(nowMs) {
      const out = { evaluated: 0, fired: 0, errors: 0 }
      let all
      try { all = await _list(undefined, undefined, undefined, false, true) } catch (e) { console.error('notes: schedule tick list failed', e); out.errors++; return out }
      for (const n of all) {
        try {
          if (!n || n.deleted || n.tombstoned) continue
          if ((n.contractType || '') !== SCHEDULE_CONTRACT_TYPE) continue
          const sched = n.schedule
          if (!sched || sched.enabled === false) continue
          out.evaluated++
          if (!schedDueAt(n, sched, nowMs)) continue
          if (await _schedFire(n, nowMs)) out.fired++; else out.errors++
        } catch (e) {
          // 单笔记异常全量吞掉记 lastError——任何一个调度笔记的故障绝不扩散到主服务与其它调度
          out.errors++
          console.error('notes: schedule tick note failed', n && n.id, e)
          try { await _schedMarkError(n && n.id, 'tick 执行异常：' + String(e && e.message || e), nowMs, true) } catch (e2) {}
        }
      }
      // 效用账本顺带刷新（0.4.3⑥ notes-043-ledger）：仅在有调度实际触发时（fired>0）顺带跑一轮指标快照（卡⑤：落 telemetry.json）+档案回填——
      // 只 evaluated 不 fired 的普通 tick 不刷新（防后台 tick 与在途断言/写入交错）；10min 节流在 _ledgerRefresh 内部；
      // 全量吞异常——账本是观察面产物，任何故障绝不扩散到调度主链路（同 tick 吞异常裁决）
      if (out.fired > 0) { try { await _ledgerRefresh({ trigger: 'cron' }) } catch (e) { console.error('notes: ledger cron refresh failed', e) } }
      return out
    }

    // 防重叠闸：上一 tick 未跑完时本轮跳过（30s 周期内 _list 全量扫描未完成时绝不叠加）
    let schedTickRunning = false
    function _schedTickGuarded(nowMs) {
      if (schedTickRunning) return Promise.resolve({ evaluated: 0, fired: 0, errors: 0, skipped: 'running' })
      schedTickRunning = true
      return _schedTick(nowMs).then(function (r) { schedTickRunning = false; return r }, function (e) { schedTickRunning = false; console.error('notes: schedule tick failed', e); return { evaluated: 0, fired: 0, errors: 1 } })
    }

    // 定时调度立即评估（调试/UI「立即检查」通道；args.now 注入 ISO 时钟供测试与回放，缺省真实时钟）。返回 { evaluated, fired, errors }
    disposers.push(handle('notes-schedule-eval', async (args) => {
      try {
        const nowMs = args && args.now !== undefined ? Date.parse(args.now) : Date.now()
        if (!isFinite(nowMs)) return { error: 'notes-schedule-eval: now 非法（期望 ISO 时间串）' }
        return await _schedTickGuarded(nowMs)
      } catch (e) { return { error: String(e.message || e) } }
    }))

    // 常驻 cron 装配（裁决②）：30s tick + .unref() 不挂进程退出 + disposers cleanup（ctx.effect 于 index 尾模块统一消费，防重载双跑）；
    // 启动补评估（裁决⑤）：单次 at 停机错过 → 启动后补发一次；异步 fire-and-forget，异常全量吞掉
    let schedTimer = setInterval(function () { _schedTickGuarded(Date.now()) }, SCHED_TICK_MS)
    if (schedTimer && typeof schedTimer.unref === 'function') schedTimer.unref()
    disposers.push(function () { if (schedTimer) { clearInterval(schedTimer); schedTimer = null } })
    ;(async function () { try { await _schedTickGuarded(Date.now()) } catch (e) {} })()
    // ==== schedule-exec END ====

    // ==== schedule-runlog BEGIN ====（notes-041-sched-runlog：执行记录独立笔记 + schedule.runLog 软链；
    //   0.4.4-A notes-044-dispatch-receipts 升级·三表归一：执行记录 = 派发历史 = 调度回执 同一篇伴生笔记——
    //   每篇派发源笔记 ≤1 篇「执行记录 · <源笔记标题>」（设计修正·用户最新裁决 2026-10-05：kind=log 工作日志型——
    //   注入硬关天然适用（回执永不进系统提示）、可见/可搜/可编辑照常 + folder='执行记录' 专用文件夹（懒创建 ensure；
    //   严禁放「工作日志」夹——工作日志=会话沉淀、执行记录=派发回执，语义不同分目录存放）+ refNote=源笔记 id 回链 +
    //   软链字段统一 runLog：调度约定存 schedule.runLog（存量直接继承零迁移），非调度派发源笔记存顶层 runLog front-matter 条件行）。
    // 设计红线（用户裁决 2026-10-04 晚）：约定正文零改动——克隆体约定正文=派发载荷（整体注入 target 会话），
    //   历史追加会无限膨胀并污染下次派发上下文；执行记录落独立笔记（0.4.4-A 起 kind=log——recall 缺省 false 不进目录/默认召回、
    //   inject 硬闸强制 false（injectForcedOff）；存量 kind=sys 的 runLog 零迁移原样留档，软链指针无关 kind 照常命中），
    //   front-matter 软链存其 id；
    //   回执落盘时机（idle 事件 / resolved 保底 / 手动标记完成三通道共用）懒创建并追加条目；条目倒序（最新在前）≤50 裁尾；
    //   幂等：同 msgId（=lastRun.receiptId）条目已存在跳过；删除约定不级联删 runLog（留档）。
    // 0.4.4-A 行型三族：📤 派发行（_dispatch 成功即落——派发历史笔记化）/ 📥 回执行（idle/resolved 真实回执）/ ✅ 人工闭环行
    //   （_dispatchDone 手动标记）；dispatches[] 数组与 dispatchStatus 状态机零改动（结构化状态给闭环逻辑，笔记行给人读——双载体正交）。
    // 写入纪律：runLog 笔记创建/追加与 runLog 软链回写都是机器自动产物——persistNote { history:false } 不产生历史快照；
    //   软链回写直改 schedule/runLog 不经 _update 声明闸门（避免目标存活等声明校验阻塞回执链路；声明改写时 runLog 由 _schedValidateWrite 延续存量）。
    // 序位：本块跨模块调用点（dispatch.js/notes.js）经函数声明提升在运行期引用，apply 执行期零触碰，无 TDZ 风险（同 _schedValidateWrite 先例）。
    const SCHED_RUNLOG_MAX = 50                        // 条目容量红线：倒序保留最新 50 条裁尾
    const SCHED_RUNLOG_HEAD = '## 执行记录（自动）'     // runLog 笔记正文的自动管理节标题
    const EXEC_LOG_FOLDER_NAME = '执行记录'             // 0.4.4-A 设计修正：伴生笔记专用文件夹（懒创建 ensure folders.json 条目；严禁复用「工作日志」夹）
    // 说明块（预设首行，RootNote pre 区逐字节保留）：机器托管声明 + kind=log 用途 + 行型契约 + 可编辑边界
    const EXEC_LOG_GUIDE = '机器托管笔记（请勿手动清理，由派发管线维护）：本笔记 = 派发源笔记的执行记录（0.4.4-A 三表归一：派发历史/调度回执/执行记录同一篇；kind=log 工作日志型——注入硬关天然适用，回执永不进系统提示）。行型：📤 派发（带（下次活动送达）后缀 = 休眠会话排队送达，0.4.4-B）/ 📥 回执 / ✅ 人工闭环；可直接编辑备注，请保持条目行首 `- 📤/📥/✅` 结构。\n\n'
    // 条目时间戳：ISO → 本地 YYYY-MM-DD HH:MM（人读优先；与调度 at 声明同口径的本地墙钟语义）
    function schedRunLogTs(iso) {
      const ms = Date.parse(iso || '')
      if (!isFinite(ms)) return String(iso || '')
      const d = new Date(ms)
      const p = function (n) { return (n < 10 ? '0' : '') + n }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    }
    // 派发行时间戳（0.4.4-A）：秒级精度——同分钟连发可区分（行幂等键成分；崩溃重放同秒同文天然去重）
    function schedRunLogTsS(iso) {
      const ms = Date.parse(iso || '')
      if (!isFinite(ms)) return String(iso || '')
      const d = new Date(ms)
      const p = function (n) { return (n < 10 ? '0' : '') + n }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
    }
    // 回执条目行：- 📥 {本地时刻} · 回执（{idle|resolved}）· → {会话名|短id} · {msgId}（真实回执）；人工闭环 = ✅（回执（manual））。
    //   0.4.4-A 起真实回执前缀 ✅→📥（设计「📥 回执：<会话> <时间>」）；存量 ✅ 行零迁移原样保留（msgId 幂等键跨新旧行型同口径）
    function schedRunLogLine(d) {
      return '- ' + (d.receipt === 'manual' ? '✅' : '📥') + ' ' + schedRunLogTs(d.doneAt) + ' · 回执（' + (d.receipt || 'manual') + '）· → ' + (d.sessionName || shortSid(d.sessionId) || '?') + ' · ' + d.msgId
    }
    // 派发条目行（0.4.4-A 派发历史笔记化）：- 📤 {本地时刻·秒级} · → {会话名|短id}[（下次活动送达）][ · 指令：{摘要≤40字}][ · {sourceLabel}] · 单号 {msgId 尾段}。
    //   （下次活动送达）后缀（0.4.4-B）：休眠送达（queued）派发专属标注——目标会话未 live，消息已持久化排队，会话下次活动时处理。
    //   红线：行内绝不出现完整 msgId（note-dispatch-* 前缀形态）——keyOfLine 的 msgId 提取与正文 indexOf 幂等去重专属回执族，
    //   派发行混入完整 msgId 会让同 msgId 回执行被误吞；单号尾段 = 行幂等键成分（同秒连发区分 + 崩溃重放同 msgId 去重）兼人读派发↔回执对参
    function schedRunLogDispatchLine(d) {
      let l = '- 📤 ' + schedRunLogTsS(d.at) + ' · → ' + (d.sessionName || shortSid(d.sessionId) || '?') + (d.queued ? '（下次活动送达）' : '')
      const instr = String(d.instruction || '').replace(/[\r\n]+/g, ' ').trim()
      if (instr) l += ' · 指令：' + (instr.length > 40 ? instr.slice(0, 40) + '…' : instr)
      if (d.sourceLabel) l += ' · ' + String(d.sourceLabel)
      const tail = String(d.msgId || '')
      if (tail) l += ' · 单号 ' + (tail.indexOf('note-dispatch-') === 0 ? tail.slice(14) : tail)
      return l
    }
    // 正文重写已上收 RootNote 托管节框架（0.4.3 内核②，notes-043-rootnote）：锚点补建/幂等去重/裁尾/备注区保留
    //   由 src/host/rootnote.js rootNoteRender 统一实现——runLog 是首个消费者，行为等价迁移（节 59 断言不改语义仍全绿 = 等价证明）。
    // runLog 消费者模板：锚点节标题 + 容量 50 + 新→旧排序 + note-dispatch msgId 幂等键 + schedule.runLog 软链键
    const SCHED_RUNLOG_TPL = {
      head: SCHED_RUNLOG_HEAD,
      max: SCHED_RUNLOG_MAX,
      newestFirst: true,
      // 行幂等键：回执族 = 行内 note-dispatch-* msgId；派发行（无 msgId）= 整行（秒级时刻+会话+指令摘要区分连发）
      keyOfLine: function (l) { const m = l.match(/(note-dispatch-\S+)/); return m ? m[1] : l },
      // 条目幂等键：回执 = msgId（=lastRun.receiptId）——与正文 indexOf 命中同口径；派发 = 整行渲染（正文子串命中同口径）
      keyOfEntry: function (d) { return d._dispatch ? schedRunLogDispatchLine(d) : d.msgId },
      lineOf: function (d) { return d._dispatch ? schedRunLogDispatchLine(d) : schedRunLogLine(d) },
      // 软链键统一 runLog（0.4.4-A 裁决·三表归一）：调度约定读 schedule.runLog（存量继承），非调度派发源笔记读顶层 runLog
      linkOf: function (note) { return (note.schedule && note.schedule.runLog) || note.runLog || '' },
      // 软链回写：调度约定写 schedule.runLog、非调度写顶层 runLog（直读最新笔记对象防 tick 在途改写被覆盖；机器状态回写零历史快照）；
      //   顺手给执行记录笔记落 refNote=源笔记 id 回链（0.4.4-A 设计① 双端跳转的机器键；同 { history:false } 口径）
      writeLink: async function (note, rlId) {
        const fresh = await loadNote(note.id)
        if (fresh && !fresh.deleted && !fresh.tombstoned) {
          if (fresh.schedule) fresh.schedule = Object.assign({}, fresh.schedule, { runLog: rlId })
          else fresh.runLog = rlId
          fresh.updatedAt = new Date().toISOString()
          try { await persistNote(fresh, { history: false }) } catch (e) { console.error('notes: schedule runLog link persist failed', note.id, e) }
        }
        try {
          const rl = await rootNoteResolve(rlId)
          if (rl && String(rl.refNote || '') !== String(note.id)) {
            rl.refNote = String(note.id)
            rl.updatedAt = new Date().toISOString()
            await persistNote(rl, { history: false })
          }
        } catch (e) {}
      },
      titleOf: function (note) { return '执行记录 · ' + String(note.title || note.id) },
      // 0.4.4-A 设计修正（用户最新裁决）：kind=log 工作日志型——注入硬关天然适用（injectForcedOff 强制 inject=false、
      //   recall 缺省 false），可见/可搜/可编辑照常；存量 kind=sys runLog 零迁移（软链指针无关 kind 照常命中）
      kind: 'log',
      // 说明块（preText）：创建正文 = 机器托管声明 + 锚点节（RootNote pre 区逐字节保留）
      preText: EXEC_LOG_GUIDE,
      // folder 设计修正（0.4.4-A）：'执行记录' 专用夹——缺省未分类（undefined）；_schedRunLogAppend 懒创建路径先 ensure 夹条目再覆写为夹 id
      folderOf: function (note) { return undefined },
      topicOf: function (note) { return note.topic || '未分类' }
    }
    // 执行记录文件夹 ensure（0.4.4-A 设计修正②）：「执行记录」专用文件夹懒创建——resolveFolderRef 命中（id/名称双通道）直接复用；
    //   未命中经 rootNoteCreateLock 串行化创建 + 锁内双检（并发首建竞态消除；同 ledger「记忆档案」_ledgerArchiveFolderEnsure 先例）。
    //   红线：必须在 rootNoteAppendEnsured 的创建锁之外调用（嵌套同链 = 自死锁，rootnote 红线③）；失败 → '' 降级未分类，不扩散主链路。
    async function _execLogFolderEnsure() {
      try {
        const hit = await resolveFolderRef(EXEC_LOG_FOLDER_NAME)
        if (hit && hit.id) return hit.id
        return await rootNoteCreateLock(async function () {
          const again = await resolveFolderRef(EXEC_LOG_FOLDER_NAME)   // 锁内双检：并发 ensure 前者产物已落 folders.json，命中即复用
          if (again && again.id) return again.id
          const c = await _folders({ op: 'create', name: EXEC_LOG_FOLDER_NAME, sys: true })   // 0.4.4-G：机器属性创建直入（自动沉淀夹默认隐身；幂等——命中复用路径不触碰 sys，用户摘除墓碑不回弹）
          return (c && c.ok && c.folder) ? c.folder.id : ''
        })
      } catch (e) { return '' }
    }
    // 执行记录落盘挂钩（0.4.4-A 起全笔记生效·三表归一；四通道共用：dispatch.js _dispatch 派发 📤 / _receiptDispatchesForSession
    //   idle 事件 📥 / _dispatchDone 手动标记 ✅ / notes.js _update resolved 保底 📥）。
    //   软链空/失效 → 懒创建执行记录笔记并回写软链；条目追加幂等；异常全量吞掉——执行记录是观察面产物，任何故障绝不扩散派发/回执主链路。
    async function _schedRunLogAppend(note, entries) {
      try {
        if (!note || !note.id) return
        const items = (entries || []).filter(function (d) { return d && (d.msgId || d._dispatch) })
        if (!items.length) return
        let tpl = SCHED_RUNLOG_TPL
        // 懒创建路径才 ensure 归夹（0.4.4-A 设计修正：folder='执行记录' 专用夹——folders.json 条目懒创建；
        //   在 rootNoteAppendEnsured 创建锁外求值（嵌套同链 = 自死锁红线不触）；ensure 失败 → '' 降级未分类）
        if (!((note.schedule && note.schedule.runLog) || note.runLog)) {
          const fid = await _execLogFolderEnsure()
          if (fid) tpl = Object.assign({}, SCHED_RUNLOG_TPL, { folderOf: function () { return fid } })
        }
        // RootNote 框架组合口：懒创建（首条派发/回执）+ 幂等追加 + ≤50 裁尾 + 落盘 { history:false }——异常吞在下方
        await rootNoteAppendEnsured(note, tpl, items)
      } catch (e) { console.error('notes: schedule runLog append failed', note && note.id, e) }
    }
    // ==== schedule-runlog END ====
    // 约定命中判定（约定注入与目录段普通行去重共用）：
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

    // 上下文注入（约定桶 + 目录段）：从常驻内存 cache 同步读取 inject=true 笔记，按 injectRole 分桶注入 agent 系统提示。
    // text 是同步函数（systemPrompt 契约），故不能 await _list()，必须读 cache。
    // 是否注入：inject 布尔字段（noteFromParsed 已对旧数据回退到 convention 标签）；
    // 注入范围由笔记的 injectTo 字段决定（命中语义见 conventionHit）。
    // 分桶：injectRole='convention' → 用户约定（须遵守，全文注入，红线零触碰）；挂载行 = 注入索引根笔记 §1 逐行（0.4.3⑤ 管线载荷）。
    // 0.4.4-E（notes-044-catalog-remove）：「目录段补充未挂载条目」整体移除——全库平铺普通行与「资料=显式挂载」模型冲突，
    //   挂载行（注入索引 §1 管线载荷）是目录段唯一内容源；catalogEnabled 设置分支/UI 开关/预览徽标/catalog 遥测埋点/catalog 兼容别名一并退役
    //   （用户 settings.json 存量 catalogEnabled 键保留不迁移 = 惰性死键无人读；recall 字段随之失去最后消费方——
    //   0.4.5-A（notes-045-debt-host）写侧退役落地：buildFM 不再写 recall 行，存量行解析保留 = 读写兼容；
    //   staleDays 的 ⚠ 注入标注呈现面随普通行拆除——现存唯一消费方 = 整理建议器过期候选提名（memory.js suggestCandidates））。
    // 目录段语义：挂载行排前（§1 行原样进段）+ 挂载 note_get 引导 + 尾部提示行（价值信号行[0.4.3⑥]/预算省略计数/约定脱敏计数/日志计数尾行/规划轻推）；
    //   无挂载行且无日志 → 目录段整段为空。约定桶与索引 §1 行格式零变化（红线）。
    // 文案不再标注工作区归属与来源会话：大量笔记由 agent 快速记录产生，归属标注对注入方无意义。
    // sidOverride（注入预览 RPC 专用）：不传 = 真实注入路径（取当前会话，行为不变）；传 '' = 「全局」视角（只命中 injectTo=[] 的笔记）；
    // 传会话短 id = 按该会话 injectTo 命中过滤；传会话短 id 数组 = 工作区并集视角（workspace 参数，命中集合内任一会话即视为命中）。
    // renderInjected 返回 { full, conventions, directory }：full = order 130 注入全文（conventionText 口径）；
    //   conventions = 约定段文本（引导词 + 约定桶）；directory = 目录段文本（含尾部提示行）。
    // 注入价值信号行（0.4.3 验收修复⑥ notes-043-metrics-present，三层架构收口之呈现层）：
    // 数据源 = telemetry 内存缓存的账本快照（_telemetryCache.ledger——cron/手动 _ledgerRefresh 经 _telemetrySetLedger 写入）：
    //   同步读内存权威，零磁盘零 await（renderInjected 同步契约守住）；存储未加载/无快照/快照无命中 → 整行省略（静默降级，不占位不报错）。
    // 快照原子性（构造性保证，节 78 断言④看守）：本行与本次渲染目录行在同一同步装配时刻现算，提及 id 一律过滤到
    //   存活目录行 id 集（预算省略后挂载行——0.4.4-E 起目录段唯挂载行源）——信号行与目录行构造性同版本；约定桶全文条目不进目录行 → 不出现。
    // 埋点纪律：纯读零写（零 _recallRaw/_telemetry 写入）——render→record 顺序不变，本次装配自排除（信号反映装配前存量快照）。
    // 用途分级红线：本行只服务注入呈现（Top3 + 零引用候选首条紧凑信号，≤200 字符截断）；正确性判断/清理裁决必须走
    //   notes-recall-stats 全量或人工（README 治理节明示）。
    function _valueSignalLine(dirIds) {
      try {
        const lg = _telemetryCache && _telemetryCache.ledger
        if (!lg || !lg.at) return ''
        const inDir = function (id) { return dirIds.indexOf(String(id)) >= 0 }
        const tops = []
        for (const it of lg.top || []) {
          if (!it || !inDir(it.id)) continue
          tops.push(String(it.id) + '×' + Math.max(0, Math.floor(Number(it.count) || 0)))
          if (tops.length >= 3) break   // Top3 截断
        }
        let zero = ''
        for (const z0 of lg.zeroRef || []) { if (inDir(z0)) { zero = String(z0); break } }   // 零引用候选首条
        if (!tops.length && !zero) return ''   // 无可呈现信号 → 整行省略（不占位）
        const ms = Date.parse(lg.at)
        const d = isFinite(ms) ? new Date(ms) : null
        const pad = function (n) { return (n < 10 ? '0' : '') + n }
        const parts = []
        if (tops.length) parts.push('本周引用：' + tops.join('、'))
        if (zero) parts.push('零引用候选：' + zero)
        parts.push('截至 ' + (d ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : String(lg.at)))
        return ('（' + parts.join('｜') + '）').slice(0, 200)   // 红线：信号行总长 ≤200 字符
      } catch (e) { return '' }
    }
    function renderInjected(sidOverride) {
      const EMPTY = { full: '', conventions: '', directory: '' }
      lastConvStats.masked = 0; lastConvStats.budgetTruncated = false
      lastCatStats.masked = 0; lastCatStats.stale = 0
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
        matches.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        // 约定桶：injectRole 非 reference 的命中笔记全文注入（红线不动）
        const conventions = []
        for (const n of matches) { if (n.injectRole !== 'reference') conventions.push(n) }
        // 挂载行（目录段排前 = 增强态载荷）：注入索引根笔记 §1 逐行（每行 whenToUse + [[链接]]，agent 按需 note_get 拉正文）。
        // 索引行先于空判计算：约定零命中但有挂载行/目录行时仍要注入（行即载荷）。
        // refBlocks 保对象形态（遥测取 id 用——Verifier 驳回①修复锚：此前直接 .map 成字符串后再取 b.id 恒 undefined，交付静默丢失）；
        // refLines = §1 行原样进段：raw 已是 `- [[id]] …` 完整列表行（Verifier 驳回②修复锚——此前再叠 '- ' 前缀产出 `- - [[id]]` 双横线行，
        //   与卡面契约/README 单横线形态及前端行解析正则 ^- \[\[? 三重不符，预览挂载行不可点；禁止再加前缀）；
        // 预算省略 pop 只动 refLines 尾部，存活 id = refBlocks.slice(0, refLines.length)；
        // 排序：按挂载目标 updatedAt 降序（延续「从最旧开始省略」预算语义；目标不在库/无时间 → 视为最旧沉底）
        const refBlocks = idxLinesSync()
          .map(function (l) { const n = cache.get(l.id); return { id: l.id, raw: l.raw, ts: (n && !n.deleted && !n.tombstoned && n.updatedAt) || '' } })
          .sort(function (a, b) { return (b.ts || '').localeCompare(a.ts || '') })
        const refLines = refBlocks.map(function (it) { return it.raw })
        // 日志计数尾行（段尾提示，0.4.4-E 保留）：原 catalog 普通行分支内的计数随拆除移到段装配层，口径放宽为全量未删除日志——
        // recall=true 显式豁免进目录的通道已随 catalog 拆除（目录段唯挂载行源），计数尾行是日志存在性的唯一注入面提示
        let logCount = 0
        for (const n of cache.values()) { if (!n.deleted && (n.kind || 'note') === 'log') logCount++ }
        // 空判：约定零命中 + 无挂载行 + 无日志计数 → 整段为空不注入
        if (conventions.length === 0 && refLines.length === 0 && logCount === 0) { if (sidOverride === undefined) lastInjectChars = 0; return EMPTY }
        // 敏感脱敏：sensitive=true 的约定正文按行打码（键保留值遮蔽，见 sensitive-helpers 块），计数用于尾部提示行
        let maskedCount = 0
        const block = (n) => {
          const bodyTrim = String(n.body || '').trim()
          const bodyOut = n.sensitive === true ? (maskedCount++, maskSensitiveBody(bodyTrim, n.id)) : bodyTrim
          return '- [' + n.id + '] ' + String(n.title || 'Untitled').replace(/[\r\n]+/g, ' ') + '\n  ' + bodyOut.replace(/\n/g, '\n  ')
        }
        const head = '以下是注入的上下文笔记（与当前任务无关时忽略）：'
        const convPart = conventions.length ? '\n\n用户约定（须遵守）：\n\n' + conventions.map(block).join('\n\n') : ''
        // 目录段拼装（预算省略循环反复重算，故为函数）：挂载行 + 挂载 note_get 引导 + 日志计数尾行 + 规划轻推行
        const dirBody = () => {
          if (refLines.length === 0 && logCount === 0) return ''
          let d = '\n\n本地笔记库目录（与本任务相关时用 note_get 拉全文，更多用 note_search）：\n\n'
          if (refLines.length) d += refLines.join('\n') + '\n\n（以上为挂载索引行：正文用 note_get <id> 获取）'
          if (logCount > 0) d += '\n另有 ' + logCount + ' 条工作日志（kind=log，注入不含），note_search 可检索'
          d += '\n规划任务前，若目录中有相关笔记（尤其待办/决策），建议先 note_get 读取再动手'
          return d
        }
        // P1 注入体积预算（约，按字符数近似统计，不引 token 计算库）：约定桶永不截断；目录段 = 挂载行单源（0.4.4-E），
        // 超预算时挂载行内部仍 updatedAt 降序从旧整条省略，直至总长度回到预算内或目录段为空；省略计数在尾部提示行告知（note_search 可检索原文）
        const budget = injectBudgetChars()
        let droppedRefs = 0
        if (budget > 0) {
          while (refLines.length > 0 && (head + convPart + dirBody()).length > budget) { refLines.pop(); droppedRefs++ }
        }
        const convText = head + convPart
        let full = convText + dirBody()
        if (full.length > 4000) full = full.slice(0, 4000) + '\n\n（内容过长已截断）'
        // 尾部提示行恒定可见（截断之后追加）：价值信号行（卡⑥，先渲染后记账——本行纯读内存快照，随后的 _recallRaw 才记账）+ 预算省略计数（挂载行）+ 约定脱敏计数 + 图片路径消歧
        // 快照原子性锚（卡⑥）：存活目录行 id 集 = 预算省略后挂载行（refBlocks 前 refLines.length 项——0.4.4-E 起目录段唯挂载行源）；
        //   信号行与目录行同一同步装配时刻现算，构造性同版本（节 78 断言④：信号行 id ⊆ 本集）
        const dirIds = refBlocks.slice(0, refLines.length).map(function (it) { return it.id })
        const sigLine = _valueSignalLine(dirIds)
        let tailLines = sigLine ? '\n\n' + sigLine : ''
        if (droppedRefs > 0) tailLines += '\n\n…另有 ' + droppedRefs + ' 条目录行超出预算未注入（note_search 可检索）'
        if (maskedCount > 0) tailLines += '\n\n（其中 ' + maskedCount + ' 条含敏感信息已脱敏，原文用 note_get 按 id 获取）'
        // 图片路径消歧（img-path-hint 块）：实际注入的约定正文含 assets/ 图片引用时，尾部追加一次绝对路径提示（全量只出一次）
        if (conventions.some(function (n) { return bodyHasImageRef(n.body) })) tailLines += '\n\n' + assetsHintLine(NOTES_ROOT)
        full += tailLines
        // 预览统计：约定脱敏条数 + 预算截断标记（目录段有省略即视为截断）；预览渲染不触碰 lastInjectChars；
        // lastCatStats（原目录普通行打码/时效计数）随 0.4.4-E catalog 拆除恒 0（stats.maskedNotes/staleMarked 字段保留 = 约定桶口径）
        lastConvStats.masked = maskedCount; lastConvStats.budgetTruncated = droppedRefs > 0
        if (sidOverride === undefined) lastInjectChars = full.length   // 注入体积缓存：真实注入渲染才更新（设置卡片仪表数据源）
        // 召回遥测（0.4.3+ 卡⑫ notes-043-inject-receipt）：真实注入路径才记（预览 sidOverride 不计），签名去重 + 静默降级（recall-telemetry 块）；
        // inject 通道 ids = 约定 + 存活挂载行 id 集（refLines 尾部省略 → 存活 = refBlocks 前 refLines.length 项）；
        // 0.4.4-E：catalog 通道埋点随「目录补充行」拆除退役（recall.js 通道结构保留 dormant，永不再产事件）
        if (sidOverride === undefined) {
          _recallRaw('inject', conventions.map(function (n) { return n.id }).concat(refBlocks.slice(0, refLines.length).map(function (it) { return it.id })), curSid)
        }
        // 预览拆分：conventions = 约定段（截断口径）；directory = 目录段 + 尾部提示行（totalChars = 两者之和保持）
        const convShown = full.slice(0, Math.min(convText.length, full.length))
        const dirShown = full.slice(convShown.length)
        return { full: full, conventions: convShown, directory: dirShown }
      } catch (e) { return { full: '', conventions: '', directory: '' } }
    }
    function conventionText(sidOverride) { return renderInjected(sidOverride).full }

    // 上下文注入（约定桶 + 合并目录段）：注册唯一动态 prompt context（order 130，位于 policy/delegation 之后）；
    // 0.4.3 验收修复③：目录段并入本 context，原 notes:catalog order 131 撤销（单一目录段语义见 renderInjected 头注）
    if (systemPrompt && typeof systemPrompt.context === 'function') {
      disposers.push(systemPrompt.context({ name: 'notes:workspace-conventions', order: 130, text: () => conventionText() }))
    }
    // 调试 RPC：预览当前会话将注入的上下文笔记文本（真实注入路径同渲染，E2E 验证用）；
    // 0.4.3③ 起附 conventions/directory 分段（text = 全文 = conventions + directory，向后兼容）
    disposers.push(handle('notes-conventions', async () => { const r = renderInjected(); return { text: r.full, conventions: r.conventions, directory: r.directory } }))
    // 注入预览（设置卡片「注入预览」modal 数据源）：纯复用 renderInjected 渲染产物 + 统计，不重写拼装。
    // 返回结构 0.4.4-E：{ conventions, directory, stats }（0.4.3③ 的 catalog 兼容别名 + stats.catalogEnabled/catalogChars
    // 随「目录补充行」整体拆除退役——目录段唯挂载行源，无普通行可别名）。
    // 三档视角：args.sessionId（会话 id/短 id）= 单会话 injectTo 命中口径（conventionHit 同一口径）；
    // args.workspace（工作区标题，notes-sessions 的 workspace 字段）= 该工作区全部会话的注入并集（会话短 id 集合与 injectTo 求交）；
    // 两者缺省 = 「全局」视角（sidOverride=''，只命中 injectTo=[] / 存量 global/workspace 的笔记）。
    // sessionId 与 workspace 互斥、同传时 sessionId 优先；workspace 经 _activeSessions 解析（与 UI 下拉同一数据源 notes-sessions，pending 占位会话同计入——标题未补齐不影响命中）。
    // 预览渲染不更新 lastInjectChars（仪表只反映真实注入）；统计取自同步渲染的 lastConvStats/lastCatStats（无竞态；lastCatStats 恒 0 = 原目录普通行统计随拆除归零）。
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
        const r = renderInjected(scope)
        return {
          conventions: r.conventions,
          directory: r.directory,
          stats: {
            conventionsChars: r.conventions.length,
            directoryChars: r.directory.length,
            totalChars: r.full.length,
            maskedNotes: lastConvStats.masked + lastCatStats.masked,
            staleMarked: lastCatStats.stale,
            budgetTruncated: lastConvStats.budgetTruncated
          }
        }
      } catch (e) { return { error: String(e.message || e) } }
    }))

    // 设置读取（设置卡片数据源）：settings 内存缓存（确保已加载）+ 可用模型列表（探不到为空数组，client 退化手输）
    // + lastInjectChars（最近一次注入体积，约/字符数——设置卡片仪表数据源，conventionText 每次渲染更新）
    disposers.push(handle('notes-settings-get', async () => {
      try { await loadSettings(); return { settings: settingsCache, models: await listAvailableModels(), lastInjectChars: lastInjectChars } }
      catch (e) { return { settings: settingsCache || {}, models: [], lastInjectChars: lastInjectChars, error: String(e.message || e) } }
    }))
    // 设置保存（client 选择即保存）：白名单顶层键；llm 为 null 恢复跟随会话；
    // 0.4.4-E：catalogEnabled 分支已随「目录补充行」拆除——该键现为未知键静默忽略（不报错不落盘）；
    // 用户存量 settings.json 残留的 catalogEnabled:true 保留不迁移（惰性死键无人读，加载即躺在 settingsCache 但无任何消费方）
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
        // P1 时效阈值（天）：非负数值取整直存；null/undefined 删除 override（缺省 90）；0 = 关闭
        // （0.4.4-E：⚠ 注入标注呈现面 = 目录普通行，已随 catalog 拆除；现存唯一消费方 = 整理建议器过期候选提名
        //   （memory.js suggestCandidates）——设置行保留服务该口径，读写兼容不迁移）
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
    // 候选计算（纯函数；all = 未删除全量笔记，staleLimit = staleDaysLimit() 由调用方注入；nowMs 可选注入供单测取确定值）：
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
    //     · 新建宽限期（0.4.6-E）：createdAt 距今 < SUGGEST_ORPHAN_GRACE_MS 不提名——刚建的笔记「未被引用」是常态而非信号，
    //       即刻提名「可能无用」对新用户是受打击的误伤（n-mux79kj4lwx9）；createdAt 不可解析 = 老旧存量，不豁免。
    //       stale 段天然免疫（须超 staleLimit 天）；遥测两段各有窗口期豁免口径，不叠加本宽限。
    const SUGGEST_ORPHAN_GRACE_MS = 86400000   // 新建宽限期 24h（0.4.6-E 常量先行+注释口径；后续可 settings 化）
    function suggestCandidates(all, staleLimit, nowMs) {
      const now0 = nowMs || Date.now()
      const staleCandidates = []
      if (staleLimit > 0) {
        for (const n of all) {
          if (n.kind === 'log') continue   // 日志永不被过期清理提名（工作记忆 v0 §6.3：记录类资产只聚合不淘汰；kind 白名单之外的显式双保险）
          if (n.kind === 'sys') continue   // 0.4.3⑥：kind=sys 系统根笔记（注入索引/记忆档案等机器产物）永不被过期清理提名（豁免面收口）
          if (n.kind !== 'note' && n.kind !== 'link') continue
          const sd = suggestStaleDays(n.updatedAt, staleLimit, now0)
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
        if ((n.kind || 'note') === 'sys') continue   // 0.4.3⑥：kind=sys 系统根笔记永不被孤儿清理提名（机器产物豁免面收口，双重保险——下方 kind==='note' 白名单已天然排除）
        // 注入索引根笔记（0.4.3⑤ notes-043-index）：机器托管的管线载荷笔记，整理建议器永不提名（误删即断资料召回管线）
        if (typeof settingsCache !== 'undefined' && settingsCache && settingsCache.indexNoteId && n.id === settingsCache.indexNoteId) continue
        if (n.title === '注入索引（自动）') continue
        if ((n.kind || 'note') !== 'note') continue
        if ((n.status || 'active') !== 'active') continue
        if (n.inject === true) continue
        if ((n.useCount || 0) > 0) continue
        if ((n.tags || []).indexOf('quick') >= 0) continue
        if ((n.mergedFrom || []).length > 0) continue
        const cg = Date.parse(n.createdAt || '')
        if (isFinite(cg) && now0 - cg < SUGGEST_ORPHAN_GRACE_MS) continue   // 新建宽限期（0.4.6-E）：<24h 不提名
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
    // ---- 遥测驱动候选（0.4.5-C 治理建议器 v0：遥测消费端首卡——纯函数，遥测快照/挂载行/窗口下沿全部由调用方注入，可 eval 单测）----
    // 两个新候选类（只提名不执行红线同 stale/orphan；信号=启发式，清理裁决=全量+人工）：
    //   zeroRefMountCandidates（零引用挂载）：注入索引 §1 挂载行 id 集 ∩ 窗口内五通道（inject/mount/catalog 原始回执 + search/get 日聚合）
    //     零事件 → 建议「摘除挂载」（不删笔记）或「改文案」。豁免：①窗口内任一通道有事件即跳过（约定桶高频笔记 inject 通道有事件，
    //     天然豁免成立）；②新建未满窗口期——挂载时间戳无独立数据源，以笔记 createdAt 兜底口径：createdAt ≥ 窗口下沿（或无法解析）
    //     不提名（遥测未覆盖其完整生命周期，宁缺勿滥）；③死挂载行（目标已删/不在全量集）不提名（死链清理由图内核/守卫面负责）。
    //   hotUnmountedCandidates（高频取用未挂载）：窗口内 get+search 合计 ≥ hotMin（v0 缺省 3 次/14 天——常量先行+注释口径，
    //     后续可 settings 化）∩ 未在 §1 ∩ inject=false（已注入不提名——约定桶高频笔记豁免位）∩ kind=note/link；
    //     status≠active / quick 速记 / mergedFrom 归档产物豁免面同 orphanCandidates（防误伤同一哲学）。
    //     数据源 = byDay 高频双通道窗口聚合（facets.use 是全期总计数、无窗口维度，不作本判定数据源——口径注释锁定）。
    // 静默降级红线：t（遥测快照）缺失/损坏/非法 → 两类候选皆空数组（零异常上抛；stale/orphan 等既有输出零影响）。
    const SUGGEST_TELEM_WINDOW_DAYS = 14   // 遥测窗口缺省 14 天（v0 常量；调用方可经 opts.windowDays 覆写）
    const SUGGEST_TELEM_HOT_MIN = 3        // 高频阈值：窗口内 get+search 合计 ≥3 才提名（2 不提名/3 提名——边界语义锁定）
    const SUGGEST_TELEM_HOT_LIMIT = 20     // 高频候选上限（提名而非穷尽，与孤儿同哲学；取用降序保最热的在前）
    // 窗口内事件计数聚合（纯函数）：events = 五通道合计（零引用判据）；useHits = get+search 合计（高频判据）。
    //   fromMs = 原始回执 ts 窗口下沿（含）；fromDay = 日聚合本地日键下沿（含，YYYY-MM-DD 字符串比较，空串 = byDay 全量兜底）
    function suggestTelemWindowCounts(t, fromMs, fromDay) {
      const events = {}, useHits = {}
      if (!t || typeof t !== 'object') return { events: events, useHits: useHits }
      const receipts = t.receipts && typeof t.receipts === 'object' ? t.receipts : {}
      for (const ch of ['inject', 'mount', 'catalog']) {
        const arr = Array.isArray(receipts[ch]) ? receipts[ch] : []
        for (const r of arr) {
          const ms = Date.parse(r && r.ts)
          if (!isFinite(ms) || ms < fromMs) continue
          const ids = Array.isArray(r.ids) ? r.ids : []
          for (const id0 of ids) { const id = String(id0); events[id] = (events[id] || 0) + 1 }
        }
      }
      const byDay = t.byDay && typeof t.byDay === 'object' ? t.byDay : {}
      for (const ch of ['search', 'get']) {
        const days = byDay[ch] && typeof byDay[ch] === 'object' ? byDay[ch] : {}
        for (const d of Object.keys(days)) {
          if (d < fromDay) continue
          const bucket = days[d]
          if (!bucket || typeof bucket !== 'object') continue
          for (const id of Object.keys(bucket)) {
            const cnt = Math.max(0, Math.floor(Number(bucket[id]) || 0))
            if (!cnt) continue
            events[id] = (events[id] || 0) + cnt
            useHits[id] = (useHits[id] || 0) + cnt
          }
        }
      }
      return { events: events, useHits: useHits }
    }
    // 两候选类判定（纯函数）：all = 未删除全量笔记；mountLines = idxLinesSync() 形态 [{ id, when }]；opts = { windowDays, hotMin, nowMs, fromDay }
    function suggestTelemetryCandidates(all, mountLines, t, opts) {
      if (!t || typeof t !== 'object') return { zeroRefMountCandidates: [], hotUnmountedCandidates: [] }   // 静默降级红线：遥测缺失/损坏 → 两类皆空
      const o = opts || {}
      const windowDays = Math.max(1, Math.floor(o.windowDays || SUGGEST_TELEM_WINDOW_DAYS))
      const hotMin = Math.max(1, Math.floor(o.hotMin || SUGGEST_TELEM_HOT_MIN))
      const nowMs = o.nowMs || Date.now()
      const fromMs = nowMs - windowDays * 86400000
      const fromDay = typeof o.fromDay === 'string' ? o.fromDay : ''
      const counts = suggestTelemWindowCounts(t, fromMs, fromDay)
      const byId = {}
      for (const n of all || []) byId[String(n.id)] = n
      // ① 零引用挂载：§1 挂载行 ∩ 窗口内五通道零事件（豁免面见块头口径）
      const zeroRef = []
      const mountSet = {}
      for (const l of mountLines || []) {
        const id = String(l && l.id || '')
        if (!id || mountSet[id]) continue
        mountSet[id] = true
        const n = byId[id]
        if (!n || n.deleted) continue                          // 死挂载行不提名
        if ((counts.events[id] || 0) > 0) continue             // 窗口内任一通道事件即豁免
        const cms = Date.parse(n.createdAt || '')
        if (!isFinite(cms) || cms >= fromMs) continue          // 新建未满窗口期豁免（createdAt 兜底口径；不可解析同样豁免）
        zeroRef.push({ id: id, title: n.title, topic: n.topic || '', when: String(l.when || ''), updatedAt: n.updatedAt || '' })
      }
      zeroRef.sort((x, y) => String(x.updatedAt || '').localeCompare(String(y.updatedAt || '')))   // 最旧在前（与孤儿同序）
      // ② 高频取用未挂载：窗口内 get+search ≥ hotMin ∩ 未挂载 ∩ inject=false ∩ kind=note/link ∩ orphan 豁免面
      const hot = []
      for (const n of all || []) {
        const id = String(n.id)
        if (mountSet[id]) continue
        const k = n.kind || 'note'
        if (k !== 'note' && k !== 'link') continue             // log/sys/todo/decision/quote 豁免（orphan 面同哲学；log/sys 双保险）
        if ((n.status || 'active') !== 'active') continue
        if (n.inject === true) continue                        // 已注入笔记不提名（约定桶高频笔记天然豁免位）
        if ((n.tags || []).indexOf('quick') >= 0) continue
        if ((n.mergedFrom || []).length > 0) continue
        const hits = counts.useHits[id] || 0
        if (hits < hotMin) continue
        hot.push({ id: id, title: n.title, topic: n.topic || '', hits: hits, updatedAt: n.updatedAt || '' })
      }
      hot.sort((x, y) => (y.hits - x.hits) || String(x.id).localeCompare(String(y.id)))   // 取用降序（并列按 id 稳定序）
      return { zeroRefMountCandidates: zeroRef, hotUnmountedCandidates: hot.slice(0, SUGGEST_TELEM_HOT_LIMIT) }
    }
    // 两段互斥（0.4.6-E 建议器断点批，n-mux8beuj84i2）：hotUnmountedCandidates 命中的笔记不再进 orphanCandidates——
    //   同屏并列「可能无用」与「高频未挂载」观感直接矛盾（这条到底无用还是高频？）。互斥优先级：高频 > 可能无用
    //   （高频有窗口遥测实证信号，孤儿是启发式判定——实证优先，孤儿让位）。纯函数：返回剔除后的孤儿数组（原数组不改）。
    function suggestMutexFilter(orphans, hot) {
      if (!hot || !hot.length) return orphans || []
      const hotIds = {}
      for (const h of hot) hotIds[String(h && h.id)] = true
      return (orphans || []).filter(n => !hotIds[String(n && n.id)])
    }
    // ==== suggest-helpers END ====

    // 整理建议（notes-suggest，dry-run 零写入）：返回 { archiveCandidates, staleCandidates, orphanCandidates, logHygieneCandidates,
    //   zeroRefMountCandidates, hotUnmountedCandidates, telemetryWindowDays, generatedAt }
    // archiveCandidates 内聚复用 _archivePreview——速记组结构与 notes-archive-preview 完全同源，
    // client「去归档」直达归档预览对话框对接的正是同一批组（dry-run 非热路径，二次 _list 走缓存）。
    // logHygieneCandidates（工作记忆 v0 §6.3）：日志卫生两级聚合提名（周 >7 天 / 月 >90 天，设置键 logWeekAfterDays/logRetentionDays 可调），
    // 只提名不执行——v0 面板仅展示明细，合并执行（机械拼接 + 概览索引）走归档白名单通道留待 Phase 2。
    // zeroRefMountCandidates / hotUnmountedCandidates（0.4.5-C 治理建议器 v0 遥测消费端）：判定内核 = suggestTelemetryCandidates 纯函数
    // （口径/豁免面见 suggest-helpers 块头注释）；只提名不执行——摘除挂载复用 notes-update inject:false 既有通道（_idxSyncMount 联动摘行），
    // 挂载/改文案复用 MountModal（LLM 预填 notes-when-suggest），均人工确认才动作。
    async function _suggest() {
      await loadSettings()   // 幂等（缓存 promise）：确保 staleDays 用户 override 已加载生效
      const all = await _list(undefined, undefined, undefined, undefined, true)   // 治理路径显式包含日志（隐身只作用于日常浏览/默认搜索；stale/orphan 内核已排除 kind=log）
      const pv = await _archivePreview()
      const c = suggestCandidates(all, staleDaysLimit())
      // 遥测驱动两类候选（只读消费）：读前落账（_recallFlushAgg——防抖 pending 与在途回执先 flush 再统计，notes-recall-stats 同款自洽读）。
      //   可用性闸门：meta.lastFlush 缺失 = 遥测从未落账（新装库零事件 / telemetry.json 缺失 / 损坏自愈空桶）→ 两类候选静默为空
      //   （防「空遥测库上全量旧挂载被误提名零引用」）；计算异常同样静默降级——stale/orphan 等既有候选零影响（静默降级红线）。
      let telem = { zeroRefMountCandidates: [], hotUnmountedCandidates: [] }
      try {
        await _recallFlushAgg()
        const t0 = _telemetryCache
        if (t0 && t0.meta && t0.meta.lastFlush) {
          const nowMs = Date.now()
          telem = suggestTelemetryCandidates(all, idxLinesSync(), t0, {
            windowDays: SUGGEST_TELEM_WINDOW_DAYS, hotMin: SUGGEST_TELEM_HOT_MIN, nowMs: nowMs,
            fromDay: _recallDay(nowMs - (SUGGEST_TELEM_WINDOW_DAYS - 1) * 86400000)   // 日聚合窗口下沿（含当日共 14 天，notes-recall-stats 同口径）
          })
        }
      } catch (e) { /* 静默降级：遥测故障不扩散整理建议主输出 */ }
      // 两段互斥（0.4.6-E）：高频未挂载命中的笔记从「可能无用」剔除（互斥优先级注释见 suggestMutexFilter 块头）
      const orphansFinal = suggestMutexFilter(c.orphanCandidates, telem.hotUnmountedCandidates)
      return { archiveCandidates: pv.quickGroups, staleCandidates: c.staleCandidates, orphanCandidates: orphansFinal, logHygieneCandidates: suggestLogHygiene(all, logWeekAfterDaysLimit(), logRetentionDaysLimit()), zeroRefMountCandidates: telem.zeroRefMountCandidates, hotUnmountedCandidates: telem.hotUnmountedCandidates, telemetryWindowDays: SUGGEST_TELEM_WINDOW_DAYS, generatedAt: new Date().toISOString() }
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
    // 整理建议（dry-run 零写入）：六类候选（速记组/过期未引用/孤儿/日志卫生/零引用挂载/高频取用未挂载——后两类 0.4.5-C 遥测驱动）——
    // 只提名不执行；过期未引用的批量软删由 client confirm 后逐条 notes-delete；遥测两类动作复用既有通道（notes-update 关注入 / MountModal）
    disposers.push(handle('notes-suggest', async () => {
      try { return await _suggest() } catch (e) { return { error: String(e.message || e) } }
    }))

    // ==== 工作记忆 v0：沉淀引导启用流程（裁决 A——复用约定体系，无独立注入管线；design/agent-memory-v0.md §5.1，r3 车道模型）====
    // 启用 = 创建一条预填约定笔记（inject=true + 用户选的作用域 injectTo），用户可在面板查看/编辑/停用/删除——单一注入源。
    // r3 车道模型（契约分型）：约定车道与记忆车道是并行车道——「记一下」两条路都走（约定→反馈笔记给人看；记忆→kind=log 自用召回），
    //   产物重复是设计意图非噪音；跨车道永不仲裁、永不检测冲突（r2 的跨车道关键词重叠检测已删除——产品裁决，非功能弱化）。
    //   check 退化为同类唯一性检查（已启用 → 返回已启用信息；未启用 → 直接可启用）；enable 无冲突确认闸门，幂等直建。
    // 契约身份分型：front-matter contractType=memory-guide 为结构化主识别键（op=status/disable 以其定位）；
    //   tag memory-guide 保留为兼容发现键（r2 及以前创建的存量引导笔记无 contractType，仍可识别/停用）。
    // 启用状态不落 settings.json：状态 = 存在 contractType=memory-guide（或兼容 tag）且 inject=true 的未删除笔记（单一事实源，杜绝双源漂移）。
    // 停用 = 关闭该约定笔记 inject（既有操作，op:'disable' 是便捷封装）；修改/删除走面板既有通道。
    // 再启用幂等复活（R-3，n-mut4mxe2m727）：存在已停用引导笔记 → 复用复活（inject=true + injectTo 按本次作用域更新），不新建第二条；
    //   已删除（回收站）引导不复活——删除即彻底退出，此时再次启用才新建。
    const MEMORY_GUIDE_TAG = 'memory-guide'   // 兼容发现键（存量引导笔记识别兜底；r3 起新建引导仍带此 tag，便于人读与检索）
    const MEMORY_GUIDE_CONTRACT_TYPE = 'memory-guide'   // 契约身份标记（front-matter contractType，r3 主识别键；同时复用为 origin 溯源值）
    const MEMORY_GUIDE_FOLDER = '工作日志'
    const MEMORY_GUIDE_TITLE = '约定：工作日志沉淀（工作记忆 v0）'
    // 引导笔记身份判定（契约分型）：contractType 结构化标记优先，tag 兼容兜底（存量 r2 引导笔记无 contractType）
    function isMemoryGuideNote(n) {
      return n.contractType === MEMORY_GUIDE_CONTRACT_TYPE || (n.tags || []).indexOf(MEMORY_GUIDE_TAG) >= 0
    }
    // 产物溯源判定（r3）：引导对本会话处于激活态？（inject=true 且 injectTo 命中本会话）
    // 数据源 = 常驻 cache 同步视图——与 conventionText 注入渲染同一事实源（注入里有的引导才视为「引导了本会话」），零新增磁盘 IO；
    // 无会话上下文（sid=''，面板手工建日志等 RPC 直调）不打标——origin 语义是「agent 会话在引导下的产物」。
    // _create 对 kind=log 且未显式传 origin 的产物自动落 origin=memory-guide（显式 origin 优先，可传 '' 关闭打标）。
    function memoryGuideActiveFor(sessionId) {
      const sid = shortSid(sessionId)
      if (!sid) return false
      for (const n of cache.values()) {
        if (!n || n.deleted || n.tombstoned) continue
        if (!isMemoryGuideNote(n)) continue
        if (n.inject === true && conventionHit(n, '', sid)) return true
      }
      return false
    }
    // 引导模板全文（§5.2）：时机/写法/同权口径（0.4.3⑦ 日志同权）/检索入口 + 【分工边界】必需段落（车道内容分工：日志只收工作结论，反馈仍走反馈约定——
    // 车道并行语义下两边可对同一事件各自产出，分工段约定的是「各车道收什么内容」，非冲突检测）
    const MEMORY_GUIDE_BODY = '【工作约定】会话工作沉淀（工作记忆 v0）\n\n在以下时机把本会话的工作结论沉淀为工作日志（note_manage，kind=log）：\n- 一个任务或阶段完成时（尤其看板任务验收/上线后）；\n- 用户显式说「记一下 / 沉淀一下 / 写工作日志」时；\n- 会话明显收尾（用户道别、长时间无新指令前的最后回合）。\n\n写法：\n1. 先 note_manage list（kind=log）查本会话今天是否已有日志：\n   有 → update 追加一节「## HH:mm 续」；无 → create（模板骨架见 KIND_TEMPLATES.log）。\n2. folder 传「工作日志」。日志与普通笔记同权：可见/可搜索/可编辑；\n   注入硬禁（无需也不能开 inject）；目录索引缺省不含（0.4.4-E 起目录段唯挂载行源；recall 字段 dormant——读写兼容但无注入效果，保持默认即可）。\n3. 返回 sensitiveSuggested=true 时必须补 sensitive: true。\n4. 「相关笔记」一节用 [[n-xxxxxxxx]] 双链引用本库笔记。\n5. 查历史工作日志：note_search 直接检索（日志已在默认搜索内；传 kind=log 只看日志）。\n\n【分工边界】本约定只管「会话工作结论沉淀」（做了什么/改了什么/遗留什么）。\n产品使用问题与体验反馈**不写入工作日志**——若同时注入了「看板反馈」\n「笔记反馈」类约定，那些内容按那些约定记到对应文件夹。两者正交、\n互不替代、互不合并。\n'
    async function _memoryGuide(args) {
      const a = args || {}
      const op = a.op || 'status'
      const all = await _list(undefined, undefined, undefined, undefined, true)   // 引导笔记是 kind=note 不受隐身影响；显式含日志保持口径统一
      const guides = all.filter(isMemoryGuideNote)   // 契约分型识别：contractType 主键 + tag 兼容
      const active = guides.find(n => n.inject === true) || null
      if (op === 'status') return { enabled: !!active, noteId: active ? active.id : (guides[0] ? guides[0].id : ''), guideIds: guides.map(n => n.id) }
      if (op === 'check') {
        // 同类唯一性检查（r3 车道模型）：dry-run 零写入，只回答「记忆车道是否已在跑」——
        // 已启用 → 返回已启用信息（client 提示现状）；未启用 → 可直接启用。跨车道重叠检测已删除（并行语义，重复合法）。
        return { enabled: !!active, already: !!active, noteId: active ? active.id : '' }
      }
      if (op === 'enable') {
        const scope = Array.isArray(a.scope) ? a.scope.map(String) : []
        if (active) return { ok: true, id: active.id, already: true }   // 幂等：已启用直接返回现状（重复启用不建第二条）
        // r3 车道模型：无冲突确认闸门（不再返回待确认响应，confirmed 参数不再需要）——约定车道共存是设计意图，无需用户裁决
        // 同时确保虚拟文件夹「工作日志」存在（同名复用不重复建；日志默认落入；0.4.4-G：创建带 sys:true 机器属性——自动沉淀夹默认隐身，
        //   命中复用路径不触碰 sys（用户右键摘除的显式 false 墓碑不回弹）；存量缺席字段由 loadFolders 懒迁移置位）
        const folders = await loadFolders()
        let logFolder = null
        for (const f of folders) { if (f.name === MEMORY_GUIDE_FOLDER) { logFolder = f; break } }
        if (!logFolder) {
          const maxOrder = folders.reduce((m, f) => Math.max(m, f.order), -1)
          logFolder = { id: genFolderId(), name: MEMORY_GUIDE_FOLDER, order: maxOrder + 1, sys: true }
          folders.push(logFolder)
          await saveFolders(folders)
        }
        // R-3 幂等复活（n-mut4mxe2m727）：存在已停用（inject≠true）的未删除引导笔记 → 复用复活（inject=true +
        //   按本次对话框作用域更新 injectTo），不再新建第二条——停用/启用往返零重复（目录/搜索不再出现双份同名约定）。
        //   多条残留时取 _list 序首条（pinned 优先 + 最近更新），其余留存为用户数据不代清理；已删引导不在 guides 内（_list 缺省排除 deleted）；
        //   排除 kind=log（日志 inject 硬闸会强制 false，复活必然失败）——引导笔记恒为 kind=note，此守卫仅挡用户手工打 tag 的病理场景。
        const dormant = guides.find(n => n.inject !== true && (n.kind || 'note') !== 'log')
        if (dormant) {
          await _update(dormant.id, undefined, undefined, undefined, undefined, undefined, undefined, true, scope)
          return { ok: true, id: dormant.id, revived: true, folderId: logFolder.id }
        }
        const r = await _create(MEMORY_GUIDE_TITLE, MEMORY_GUIDE_BODY, [MEMORY_GUIDE_TAG], '约定', { kind: 'note', inject: true, injectRole: 'convention', injectTo: scope, contractType: MEMORY_GUIDE_CONTRACT_TYPE })
        return { ok: true, id: r.id, folderId: logFolder.id }
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
      // 日志同权（0.4.3 验收修复⑦）：默认搜索含 kind=log（可见/可搜）；filters.includeLogs 参数保留向后兼容（已恒为包含）
      // sys 缺省降噪（0.4.3 验收修复⑨）：tag/kind 透传 _list 同一条过滤管线——缺省检索（无 tag/kind、folder 缺省或未分类）排除 kind=sys 机器笔记
      //   （记忆档案/注入索引/runLog/遥测镜像）；显式 kind='sys'/tag/具体文件夹检索 = 显式入口照常命中（降噪谓词仅在平铺口径生效）
      const all = await _list(tag, kind, folder, undefined, true)
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


    // notes-search 扩展（向后兼容）：新增 sensitive/inject 组合过滤参数（true=仅命中 / false=仅排除 / 缺省=不过滤，供筛选面板消费）；
    // 带 query 时每条 slim 结果附 matches 命中字段数组（title/tags/body，供前端高亮与「相关度」排序；旧调用方不读该字段不受影响）
    // 日志同权（0.4.3 验收修复⑦）：搜索默认含日志（args.includeLogs 保留为兼容 no-op）
    disposers.push(handle('notes-search', async (args) => {
      try {
        const a = args || {}
        const found = await _search(a.query, a.tag, a.topic, a.kind, a.folder, { sensitive: a.sensitive, inject: a.inject, includeLogs: !!a.includeLogs })
        // 召回遥测（0.4.3+ 卡⑫ notes-043-inject-receipt）：search 通道交付事件——实际返回的 id 集日聚合（同日同 id 计数累加不爆行；静默降级）
        _recallHit('search', found.map(function (n) { return n.id }))
        return { notes: found.map(n => { const s = slim(n); if (n.matches) s.matches = n.matches; return s }) }
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // ---- 导入/导出：全库目录快照（目录即格式，零新依赖；settings.json 与 *.md.bak 不进出；
    //   telemetry.json 遥测 sidecar 进出（0.4.3 验收修复⑤ notes-043-metrics-storage：version 字段供迁移，导入按计数并入/冲突取大合并））----
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

    // 复制 NOTES_DIR 全部 n-*.md + folders.json + assets/ + telemetry.json 到目标目录（导出与导入前全量备份共用）；
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
      // 遥测 sidecar（0.4.3 验收修复⑤）：导出/备份连带 telemetry.json（version 字段供迁移合并）；
      //   先落账（防抖窗口内内存增量 flush 到盘，快照拿最新口径）再读盘复制；缺失/不可读 → 跳过（telemetry=false，旧库零回归）
      let telemetry = false
      try {
        await _telemetryFlushNow()
        const c = await fs.readText(await fs.resolve(TELEMETRY_PATH))
        await fs.writeText(await fs.resolve(path.join(targetDir, 'telemetry.json')), c, undefined, undefined, getPolicy())
        telemetry = true
      } catch (e) { /* telemetry.json 缺失/不可读 → 跳过（遥测允许重来） */ }
      const assets = await copyAssetsDir(NOTES_DIR, targetDir, false)
      const history = opts && opts.includeHistory ? await copyHistoryDir(NOTES_DIR, targetDir, false) : 0
      return { copied, foldersFile, telemetry, assets, history }
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
    // 快照含 n-*.md + folders.json + assets/（图片资产连带；无 assets 的旧库 assets=0）+ telemetry.json（遥测 sidecar，卡⑤）；
    // .history 快照历史默认不含（本地安全网不随导出物流转），includeHistory=true 时连带（返回 history 文件计数）
    async function _export(dir, includeHistory) {
      const d = String(dir || '').trim().replace(/[\\/]+$/, '')
      if (!d) return { error: 'notes-export 需要 dir（目标目录）' }
      const info = await fs.stat(await fs.resolve(d))
      if (info && !(info.dir || info.type === 'directory')) return { error: '目标路径不是目录：' + d }
      const target = path.join(d, 'dsh-notes-export-' + tsStamp(new Date()))
      const r = await copyNotesDir(target, { includeHistory: includeHistory === true })
      const out = { exported: r.copied, foldersFile: r.foldersFile, telemetry: r.telemetry === true, assets: r.assets, target: target }
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
        // 导出全部 = 机器全量口径（includeSys=true）：0.4.3⑨ 缺省降噪只作用于平铺视图/检索管线，导出行为不变（含 kind=sys 机器笔记）
        notes = await _list(undefined, undefined, undefined, undefined, undefined, true)
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
    // 1) 任何改动前先把 NOTES_DIR 全量备份到 notes/notes-backup-<ts>/（含软删除笔记的全部 n-*.md + folders.json + assets/ + .history/ 快照历史 + telemetry.json 遥测 sidecar）
    // 2) added 原文件原样入库（deleted 导入后仍隐藏）；same 跳过；diff 默认跳过，overwrite=true 才覆盖
    // 3) folders.json 合并只增不删：清单外的文件夹 id 追加尾部（order 续排），已存在的不动
    // 4) assets/ 合并只增不改：同名文件跳过（文件名含秒级时间戳，同名即同物）；无 assets 的旧导出 assetsMerged=0
    // 4b) telemetry.json 遥测合并（0.4.3 验收修复⑤）：计数并入、同键冲突取大 + receipts 签名去重并集（≤200 保最新）——换机器遥测不丢；
    //     同一快照重复导入零变化（幂等，telemetryMerged=false）；缺失/损坏 → 跳过（遥测允许重来）
    // 5) .history 历史合并：仅 added（库内不存在）新笔记连带合并源 .history/<id>（同名快照跳过）；id 冲突（库内已有该笔记，
    //    same/diff/overwrite 任一）跳过历史合并——两库同 id 历史不混杂（文档见 README/DEVELOPMENT）
    async function _import(dir, overwrite) {
      const chk = await checkImportDir(dir)
      if (chk.error) return { error: 'notes-import ' + chk.error }
      const backupDir = path.join(NOTES_DIR, 'notes-backup-' + tsStamp(new Date()))
      await copyNotesDir(backupDir, { includeHistory: true })
      const scan = await scanImportDir(chk.dir)
      let imported = 0, skippedSame = 0, skippedDiff = 0, overwritten = 0, historyMerged = 0
      const importedNoteIds = []   // 入库/覆盖笔记 id（导入后 useCount facet 双向同步用，0.4.3 验收修复⑧）
      for (const n of scan.notes) {
        const cur = await readLibraryRaw(n.id)
        if (cur === n.content) { skippedSame++; continue }
        if (cur !== null && !overwrite) { skippedDiff++; continue }
        try {
          await fs.writeText(await fs.resolve(noteFile(n.id)), n.content, undefined, undefined, getPolicy())
          // 同步内存缓存（约定/目录注入直接读 cache）：按导入内容重建解析结果
          const note = noteFromParsed(n.id, parseFM(n.content))
          cache.set(note.id, note)
          importedNoteIds.push(note.id)
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
      // 遥测 sidecar 合并（卡⑤）：导出物带 telemetry.json 时按 version 兼容并入（计数冲突取大 + receipts 去重并集）；
      //   幂等——同一快照二次导入零变化（telemetryMerged=false）；缺失/损坏静默跳过
      let telemetryMerged = false
      try {
        const tc = await fs.readText(await fs.resolve(path.join(chk.dir, 'telemetry.json')))
        telemetryMerged = await _telemetryImportMerge(JSON.parse(tc))
      } catch (e) { /* 无遥测文件/损坏 → 跳过（遥测允许重来） */ }
      // useCount facet 双向同步（0.4.3 验收修复⑧）：导入直写 cache 不经 readNoteFile——此处补齐 seed/pull：
      //   导入文件残留旧 front-matter useCount → seed 并入 facet；导入 telemetry.json facets.use 更大 → 视图抬头（facet 唯一事实源）
      for (const id of importedNoteIds) { const n2 = cache.get(id); if (n2) await _useFacetSync(n2) }
      // 合并了外部历史 → 存活清单/预算记账失效，下次快照惰性重扫（histEnsureScanned）
      if (historyMerged > 0) histSizes = null
      return { imported: imported, skippedSame: skippedSame, skippedDiff: skippedDiff, overwritten: overwritten, foldersMerged: foldersMerged, assetsMerged: assetsMerged, historyMerged: historyMerged, telemetryMerged: telemetryMerged, backupDir: backupDir, unreadable: scan.unreadable }
    }


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

    // 二期 孤儿资产清理：{dryRun?, files?} → 预览（缺省 dryRun=true，零写入）/ 执行（node:fs 真删除优先，墓碑式清空兜底）
    disposers.push(handle('notes-assets-prune', async (args) => {
      try { return await _assetsPrune(args || {}) } catch (e) { return { error: String(e.message || e) } }
    }))
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
      description: 'Search local notes by free-text query (matches title/body/topic/tags), with optional tag, topic, kind, folder, sensitive, and inject filters. When a query is given, each result carries a matches array telling which fields matched (title/tags/body — relevance: title > tags > body). Returns slim notes (no body) for fast triage — call note_get for the full body of a specific id. Work logs (kind=log) are first-class: default results INCLUDE them (visible/searchable/editable like any note) — pass kind=log to see only work logs; injection is hard-disabled for logs (no toggle, host-enforced). Machine-managed sys notes (kind=sys: inject index, memory archives「记忆档案」, telemetry mirror) are excluded from default unfiltered results — pass kind=sys (or a tag/folder filter) to see them. Dispatch execution-record companion notes「执行记录 · <源标题>」(0.4.4-A) are kind=log in folder「执行记录」— first-class visible/searchable/editable like other logs, injection hard-disabled, maintained by the dispatch pipeline (do not manually clean up). Tip: when planning a task, picking an approach, or making decisions, consider searching this notes library first for related decisions, todos, and context recorded in earlier sessions — it may already contain the conclusions you need.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text query against title, body, topic, and tags. Omit to list all (optionally filtered by tag/topic/kind/folder/sensitive/inject).' },
          tag: { type: 'string', description: 'Optional tag filter (exact match)' },
          topic: { type: 'string', description: 'Optional topic filter (exact match)' },
          kind: { type: 'string', enum: KINDS, description: 'Optional kind filter: note/decision/todo/link/quote/log/sys. Pass log to see only work logs; pass sys to see machine-managed notes (excluded from default unfiltered results).' },
          folder: { type: 'string', description: 'Optional folder filter: folder id or exact folder name; empty string = unfiled notes (未分类). Non-empty filter is a recursive subtree match — it returns notes in that folder AND all its descendant folders (folders nest via parent; maxFolderDepth setting, default 3).' },
          sensitive: { type: 'boolean', description: 'Optional sensitive filter: true = only sensitive (masked) notes, false = exclude sensitive notes. Omit = no filter.' },
          inject: { type: 'boolean', description: 'Optional inject filter: true = only notes injected into the system prompt, false = exclude injected notes. Omit = no filter.' },
          includeLogs: { type: 'boolean', description: 'Backward-compatible no-op: work logs (kind=log) are first-class and always included since 0.4.3; the parameter is still accepted but no longer changes results.' },
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
        const page = all.slice(0, limit)
        _recallHit('search', page.map(function (n) { return n.id }))   // 召回遥测（0.4.3+ 卡⑫ notes-043-inject-receipt）：search 通道交付=工具实际返回页（与 notes-search RPC 同口径日聚合）
        return { count: all.length, notes: page.map(n => { const s = slim(n); if (n.matches) s.matches = n.matches; return s }) }
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
          // 使用遥测（P2 → 0.4.3 验收修复⑧收编 facet）：命中计数 +1（内存视图即时生效；facet 复用遥测 2s 防抖落 telemetry.json，
          //   不再重写笔记 .md——热路径写放大消除，见 use-telemetry 块）
          const uc = bumpUseCount(n.id)
          // 召回遥测（0.4.3+ 卡⑫ notes-043-inject-receipt）：note_get 工具取用信号（与 notes-get RPC 同通道日聚合）；
          //   卡⑧起与 bumpUseCount 共用遥测 2s 防抖单定时器（facets.use 总计 + byDay.get 日明细分记账，同盘同 flush）
          _recallHit('get', [n.id])
          if (uc !== null) n.useCount = uc
          return { note: n }
        }
        catch (e) { return { error: String(e.message || e) } }
      }
    })

    regTool({
      name: 'note_manage',
      description: 'Single tool for create/list/update/delete/restore/archive. Pick an action and supply its required fields. The Agent should prefer this for any non-search CRUD: one tool means one decision point and one schema to learn.\n\n' +
        'Fields kind (what it is) and status (its lifecycle) are orthogonal: kind ∈ note/decision/todo/link/quote/log (default note); status ∈ active/pinned/resolved/superseded (default active). kind=log is a work log (工作日志): first-class in list/search/edit (visible by default) — inject is force-disabled (hard gate, true is corrected with injectForcedOff in the response) and recall defaults false (the recall field is deprecated — see below); put work logs in folder「工作日志」.\n' +
        'inject (boolean) controls whether the note is injected into the system prompt as context — an explicit field, NOT a tag. injectRole ("convention"|"reference", default "convention") picks the injection bucket: convention = user rules to follow; reference = background facts to consult only when relevant to the current task. Rule of thumb — infer from kind: decision/todo → convention, note/link/quote → reference. injectTo (string[]) is the injection scope, a multi-select list: [] or omitted=all sessions (default), or session short-ids like ["99f2b674","7f8b49e6"] to restrict the scope.\n\n' +
        'recall (boolean, default true) is a DEPRECATED compatibility field (deprecated since 0.4.5-A, write side retired): it used to control the notes catalog index (a one-line-per-note flat library listing injected into the system prompt), which was removed entirely in 0.4.4-E — the injected directory section now carries mounted index lines only (a note enters it solely via an explicit mount in the injection index). The argument is still accepted for backward compatibility and existing front-matter recall lines are still parsed (存量行保留不迁移、读侧兼容), but new writes no longer persist the field to disk and it has no effect on injection; every note stays searchable via note_search regardless.\n\n' +
        'sensitive (boolean) marks the note as containing secrets (passwords/tokens/keys); default false. When true, injected text (conventions) masks secret-looking lines — keys and structure are kept, only values are hidden as ******（敏感，note_get <id> 获取）— so agents must call note_get for the original. Create/quick responses may return sensitiveSuggested: true when the body matches secret patterns; quick-capture notes are auto-flagged sensitive instead.\n\n' +
        'hidden (boolean, default false) is the OS-style hidden attribute (0.4.4-D): hidden notes are masked out of the notes panel tree/lists only — a pure client-side UI filter governed by the panel「显示隐藏」toggle (localStorage-persisted). Agents and all read/write paths are UNAFFECTED: note_search/note_get/note_manage see hidden notes exactly like normal ones, and opening a hidden note via backlink/dispatch/search hit renders and edits normally. Folders carry the same flag via the notes-folders RPC op:\'set-flags\' { id, hidden } (a hidden folder masks its row and its nested subtree from the tree).\n\n' +
        'folder (string) assigns a note to a virtual folder: pass a folder id or an exact folder name — a name is normalized to its folder id on write, and an unknown id/name is rejected with an error (never silently filed as unfiled); "" or omitted = unfiled (未分类). Folders (name/order/parent/hidden) are managed via the notes-folders RPC (list/create/rename/delete/reorder/set-flags): folders NEST via a parent field (maxFolderDepth setting caps the depth, default 3, 0 = unlimited), any folder filter is a recursive subtree match (a folder includes notes in all its descendant folders), and deleting a folder that still has child folders or notes requires explicit cascade:true — the folder structure is removed for good while its notes are soft-deleted into the trash and can be restored (restored notes fall back to unfiled when their folder is gone).\n\n' +
        'Actions:\n' +
        '- create: { title, body, topic?, tags?, kind?, status?, inject?, injectRole?, injectTo?, recall?, sensitive?, hidden?, folder?, sessionId?, cwd?, workspace?, logDate? }\n' +
        '- list: { tag?, topic?, kind?, folder?, includeLogs? } (no id/title/body needed; work logs kind=log are first-class and included by default — includeLogs is a kept no-op for backward compatibility; machine notes kind=sys are excluded from the default unfiltered list — pass kind:\'sys\', tag, or folder to see them)\n' +
        '- update: { id, title?, body?, topic?, tags?, kind?, status?, inject?, injectRole?, injectTo?, recall?, sensitive?, hidden?, confirmClearBody? } (setting body to "" while the stored body is non-empty is REJECTED unless confirmClearBody:true — R-1 data-loss guard against silent empty-body overwrite; setting status to "resolved" auto-closes the dispatch loop: all open entries in the note\'s dispatches are marked dispatchStatus=done with doneAt — kept as a manual fallback（手动兜底）to force-close the loop; since 0.4.5-I dispatched todos no longer ask the target session to resolve the note — the target session\'s idle transition closes the receipt automatically)\n' +
        '- move: { id, folder } (move note into a virtual folder — folders nest, so any folder id at any depth is valid; folder = folder id or exact folder name, "" = move out to unfiled)\n' +
        '- delete: { id } (soft delete; restorable via restore)\n' +
        '- restore: { id } (undo delete/archive)\n' +
        '- archive: { groups? } (explicit archive, undoable once via the notes-archive-undo RPC). groups = whitelist [{memberIds:[noteId,...], title?}]: merge exactly those groups (memberIds must all exist and not be deleted; title overrides the default group title). Without groups: merge ONLY quick-capture notes grouped by session. Behavior change: manual notes are NEVER auto-grouped by tag anymore — pass explicit groups to merge them (preview quick groups first via the notes-archive-preview RPC).\n' +
        '- dispatch: { id, targetSessionId?, targetSessionName?, instruction? } (assemble the todo context plus your instruction into one user message and send it to a live session as a real task — or, when the target session is dormant (not live but persisted), queue it into the session\'s durable inbox with ZERO wake: it is delivered and processed on the session\'s next activity (the dispatch record carries queued:true in that case — 0.4.4-B); the handoff is recorded in the note\'s dispatches property with dispatchStatus=sent, and a 📤 line is appended to the note\'s lazily-created execution-log companion note「执行记录 · <标题>」(kind=log in folder「执行记录」— injection hard-disabled, visible/searchable/editable as usual; soft-linked via schedule.runLog for schedule conventions / top-level runLog field otherwise — 0.4.4-A 三表归一). Omit targetSessionId to list dispatchable sessions (live flag per entry — live:false entries are dormant and get queued delivery). Closed loop: closed via idle-transition receipt of the target session — an idle transition auto-flips that session\'s open dispatches to dispatchStatus=done and writes the receipt (dormant queued deliveries close the same way on next-activity idle, zero wake 零唤醒排队同理); update status=resolved remains available as a manual fallback（手动兜底）that force-closes all open dispatches of the note — since 0.4.5-I dispatch messages no longer instruct the target session to resolve the note.)\n' +
        'Scheduled dispatch (定时派发·约定即调度): create/update a convention note with contractType: \'dispatch-schedule\' + schedule: { at | every, target, action?, enabled?, anchor?, dow?, provider?, model? } — the host runs a resident 30s cron; when due it auto-dispatches the note body to the target session via the standard dispatch chain (source labeled 定时调度 @标题, receipts accumulate in dispatches as usual, and a lazily-created execution-log note「执行记录 · @标题」is soft-linked via schedule.runLog — shared with manual dispatches of the same note (dispatch 📤 lines + receipt 📥/✅ lines land in one note) — the convention body itself is NEVER appended to (it is the dispatch payload; history would bloat and pollute future dispatch contexts). Declaration red lines (enforced at write): exactly one of at (LOCAL ISO time WITHOUT timezone suffix, e.g. 2026-10-05T09:00 — must be future; Z/±offset suffix is rejected because the declaration is pinned to the host machine local timezone) / every (\'30m\'/\'12h\'/\'3d\'/\'1w\' or ms, >= 5min); anchor: \'HH:MM\' LOCAL wall-clock time (periodic mode only, requires a whole-day interval — pins the firing sequence to that local time: first fire = next anchor time, later fires stay on that time of day without drifting from creation/fire time; declarations WITHOUT anchor keep the legacy pure-interval semantics anchored at lastFiredAt||createdAt — zero migration); dow: 0-6 integer (weekly mode only, 0=Sunday, requires every:\'1w\' + anchor); target session must exist in a workspace and not be archived — OR the reserved literal target: \'new\' (periodic mode only — 0.4.4-B dedicated session: the first fire auto-creates a session named 定时 · <title> in the note\'s workspace, writes schedule.target back to the new sid, and every later round reuses that session via live-send or dormant queued delivery); model/provider: optional dedicated-session model pair (0.4.6-G — declare BOTH or NEITHER, non-empty strings; on target:\'new\' first fire they are passed to agents.create agentOptions, overriding the host default model selection — omitted = host default, zero migration; validity is NOT probed at declaration time, an invalid pair surfaces as schedule.lastError at fire time); unknown keys rejected. Machine state (lastFiredAt/lastRun{at,status(sent|queued|error),receiptId}/lastError/runLog/declaredAt) is host-managed in front-matter — reads via note_get, never write it by hand. Un-declare with contractType: \'\' + schedule: null.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'list', 'update', 'move', 'delete', 'restore', 'archive', 'dispatch', 'debugws'], description: 'Action to perform' },
          // create / update 字段
          id: { type: 'string', description: 'Note id (required for update/delete/restore/dispatch)' },
          title: { type: 'string', description: 'Title (create/update)' },
          body: { type: 'string', description: 'Markdown body (create/update)' },
          confirmClearBody: { type: 'boolean', description: 'Explicit confirmation (update only): required when setting body to "" while the stored body is non-empty — R-1 data-loss guard rejects silent empty-body overwrite without it.' },
          topic: { type: 'string', description: 'Topic (create/update; defaults to 未分类)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags (create/update)' },
          kind: { type: 'string', enum: KINDS, description: 'Kind (create/update): note/decision/todo/link/quote/log/sys; default note. log = work log（同权：默认列表/搜索可见可编辑；inject 强制关闭，recall 缺省 false 注入目录恒不含）; sys = 机器托管笔记（缺省列表/检索降噪排除，显式 kind=sys/tag/folder 过滤可见——一般由系统内部创建，手写请改用其他 kind）' },
          status: { type: 'string', enum: STATUSES, description: 'Status (create/update): active/pinned/resolved/superseded; default active' },
          inject: { type: 'boolean', description: 'Inject into system prompt as context (create/update); default false. Setting inject=true permanently marks injectEver=true (sticky "ever injected" flag — later turning inject off never unsets it; injectEver is read-only and appears in list/get output).' },
          injectRole: { type: 'string', enum: ['convention', 'reference'], description: 'Injection role: convention=rules to follow | reference=background facts to consult as needed; default convention' },
          injectTo: { type: 'array', items: { type: 'string' }, description: 'Injection scope multi-select: [] or omitted=all sessions (default), or session short-ids like ["99f2b674","7f8b49e6"] to restrict' },
          recall: { type: 'boolean', description: 'DEPRECATED compatibility field (create/update); default true. The catalog index it once fed was removed in 0.4.4-E (directory section = mounted lines only); since 0.4.5-A the write side is retired — the argument is still accepted and existing front-matter recall lines are still parsed (read-compatible), but new writes no longer persist the field and it has no injection effect; notes stay searchable via note_search regardless.' },
          sensitive: { type: 'boolean', description: 'Sensitive-content flag (create/update); default false. When true, injected text masks secret-looking lines (keys kept, values hidden as ******（敏感，note_get <id> 获取）); agents call note_get for the original.' },
          hidden: { type: 'boolean', description: 'Hidden flag (create/update); default false. Pure UI mask (0.4.4-D): hidden notes are filtered from the panel tree/lists only when the「显示隐藏」toggle is off; search/get/agent faces are unaffected. Folders: notes-folders RPC op:\'set-flags\' { id, hidden }.' },
          folder: { type: 'string', description: 'Virtual folder (create/move/list filter): folder id or exact folder name (a name is normalized to its id on write; unknown id/name is rejected); "" = unfiled (未分类). Folders nest via parent (maxFolderDepth setting, default 3); a list filter matches the whole subtree recursively (notes in descendant folders included).' },
          // 定时派发·执行层（dispatch-schedule 声明字段；公共写入口 contractType 白名单 '' / dispatch-schedule）
          contractType: { type: 'string', description: 'Contract type (create/update): public writes allow only \'dispatch-schedule\' (scheduled-dispatch convention, must pair with schedule) or \'\' to clear; other contract types are system-managed' },
          schedule: { type: ['object', 'null'], description: 'Scheduled-dispatch declaration (create/update; requires contractType=\'dispatch-schedule\'): { at?: LOCAL ISO time WITHOUT timezone suffix, e.g. 2026-10-05T09:00 (one-shot, must be future; Z/±offset rejected) | every?: \'30m\'/\'12h\'/\'3d\'/\'1w\' or ms (>=5min), anchor?: \'HH:MM\' LOCAL time (periodic only, whole-day interval; pins firing to that time of day, no drift), dow?: 0-6 (weekly only, 0=Sunday, requires every:\'1w\' + anchor), target: sessionId (workspace session, not archived) or \'new\' (periodic only: auto-create a dedicated 定时 · <title> session on first fire, then reuse it — 0.4.4-B), action?: \'dispatch\', enabled?: boolean, provider?: + model?: dedicated-session model pair (0.4.6-G: BOTH or NEITHER, non-empty strings; passed to agents.create agentOptions on first-fire creation of a target:\'new\' session, overriding the host default selection; not probed at declaration time — invalid pair surfaces as lastError at fire time) }. Host-managed machine fields lastFiredAt/lastRun/lastError/runLog/declaredAt are preserved across declaration edits (declaredAt = declaration anchor timestamp, refreshed only when declaration fields at/every/anchor/dow/target/action/enabled/model/provider change — periodic due-anchor is lastFiredAt||declaredAt||createdAt; runLog = soft-link id of the lazily-created execution-log note; pass an existing note id to relink, \'\' to unlink). null clears the declaration (pair with contractType: \'\').' },
          // archive 字段（显式归档白名单）
          groups: { type: 'array', items: { type: 'object', properties: { memberIds: { type: 'array', items: { type: 'string' } }, title: { type: 'string' } }, required: ['memberIds'] }, description: 'Archive whitelist (archive action only): [{memberIds:[noteId,...], title?}] — merge exactly these groups. Omitted = merge only quick-capture groups; manual notes are NEVER auto-grouped by tag (behavior change).' },
          // dispatch 字段
          targetSessionId: { type: 'string', description: 'Dispatch target: a live session id, or a dormant (persisted) session id — dormant targets are queued into the durable inbox and delivered on the session\'s next activity without waking it (0.4.4-B). Omit to list dispatchable sessions (live flag per entry).' },
          targetSessionName: { type: 'string', description: 'Dispatch target display name (dispatch, optional)' },
          instruction: { type: 'string', description: 'Dispatch: your concrete instruction appended to the todo context (dispatch, optional)' },
          // list 字段
          tag: { type: 'string', description: 'Tag filter (list only)' },
          includeLogs: { type: 'boolean', description: 'Backward-compatible no-op (list only): work logs kind=log are first-class and included by default since 0.4.3.' },
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
            // 定时派发：公共写入口 contractType 白名单（'' / dispatch-schedule；其余契约类型系统内部管理）
            const ctErr0 = schedPublicContractTypeError(args.contractType)
            if (ctErr0) return { error: ctErr0 }
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
              folder: folder, recall: args.recall, sensitive: args.sensitive, hidden: args.hidden, logDate: args.logDate, contractType: args.contractType, schedule: args.schedule
            })
            const out = { action: 'create', id: r.id, topic: r.topic, kind: r.kind, status: r.status, message: 'Note created' }
            // 敏感模式自动识别建议透传（create 不强制落 sensitive，由调用方决策）
            if (r.sensitiveSuggested) { out.sensitiveSuggested = true; out.message += '（检测到疑似敏感信息，建议 sensitive: true 开启注入脱敏）' }
            // 日志隐身硬闸命中告知（kind=log 强制 inject=false、recall 缺省 false）
            if (r.injectForcedOff) { out.injectForcedOff = true; out.message += '（kind=log 工作日志不参与注入：inject 已强制关闭——日志同权可见/可搜/可编辑）' }
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
            // 定时派发：公共写入口 contractType 白名单（'' / dispatch-schedule；其余契约类型系统内部管理）
            const ctErr1 = schedPublicContractTypeError(args.contractType)
            if (ctErr1) return { error: ctErr1 }
            const r = await _update(args.id, args.title, args.body, args.tags, args.topic, args.kind, args.status, args.inject, args.injectTo, undefined, args.recall, args.injectRole, args.sensitive, { confirmClearBody: args.confirmClearBody === true, contractType: args.contractType, schedule: args.schedule, hidden: args.hidden })
            // P3 派发闭环：resolved 联动回执了派发时在消息里明示（agent 可感知闭环已发生）
            // 工作记忆 v0：kind=log 隐身硬闸命中时告知（inject 被强制关闭）
            return { action: 'update', id: args.id, kind: r.kind, status: r.status, dispatchClosed: r.dispatchClosed || 0, injectForcedOff: r.injectForcedOff === true, message: 'Note updated' + (r.dispatchClosed ? '；已自动回执 ' + r.dispatchClosed + ' 条派发（dispatchStatus→done）' : '') + (r.injectForcedOff ? '（kind=log 工作日志不参与注入：inject 已强制关闭）' : '') }
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
              // 未指定目标：返回当前可派发会话列表（活跃 + 休眠双区，0.4.4-B；live 字段区分，休眠目标走「下次活动送达」排队）
              const list = (await _activeSessions()).sessions.map(s => ({ sessionId: s.id, short: s.short, name: s.name, workspace: s.workspace, live: s.live !== false }))
              return { action: 'dispatch', needTarget: true, activeSessions: list, message: '请用 targetSessionId 指定目标会话（live:false = 休眠会话，派发将持久化排队、下次活动送达）' }
            }
            const r = await _dispatch(args.id, { sessionId: args.targetSessionId, sessionName: args.targetSessionName, instruction: args.instruction, mode: 'existing' })
            if (r.error) return { error: r.error }
            return { action: 'dispatch', id: args.id, sessionId: r.sessionId, queued: r.queued === true, message: '已派发到「' + r.sessionName + '」' + (r.queued ? '（休眠会话：已持久化排队，下次活动送达）' : '') + (args.instruction ? '（含具体要求）' : '') }
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
    // 0.4.6-H（notes-046-smallfix 卫生小件②）：原子写 .tmpdir 孤儿启动清扫（fire-and-forget；>24h 才删不动在途写；能力缺失静默跳过）
    sweepTmpdirOrphans()
    // 0.4.3⑤ 升级首启自动建「注入索引（自动）」根笔记（notes-043-index，fire-and-forget；失败静默下次启动重试）
    // 0.4.3 验收修复⑪：ensure 落定后顺带孤儿索引自愈（idxHealOrphans：存量同名索引 §1 行并入正式索引 + 软删孤儿；冷缓存防御在 idxEnsure 内水化闸门）
    idxEnsure().then(function (rl) { if (rl) idxHealOrphans(rl) })

    // 存量一次性修补：agents 未就绪期创建的笔记 workspace 为空，导致“本工作区”注入范围严格匹配后永不命中。
    // 启动时按来源会话推导补填一次（只补空值）。注意：不用 _list()（它 await migrationDone，会与本补全死锁），
    // 直接走底层遍历；也不挂进 migrationDone 链——_list 只需等 legacy 迁移，补全异步自跑即可。
    const legacyDone = migrationDone
    // 0.4.3 验收修复⑤（notes-043-metrics-storage）：遥测一次性迁移 + 存量索引 §2 摘除挂在 legacy 迁移之后
    //   （旧「召回遥测（自动）」笔记可能随开发版目录迁移而来——等迁移落定再解析回填 telemetry.json，幂等，内部全吞异常）
    ;(async function () { try { await legacyDone } catch (e) {} try { await _recallMaybeMigrate() } catch (e) {} try { await _ledgerStripS2() } catch (e) {} })()
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
      flushUsage()       // 卸载 flush：usage.json 防抖窗口内未落盘的 token 计数立即写盘（同上 fire-and-forget）
      // 卸载 flush：召回遥测 + useCount facet（0.4.3 验收修复⑧收编，facets.use 唯一事实源）防抖窗口内内存增量同盘落 telemetry.json
      //   （0.4.3+ 卡⑫ → 卡⑤机器存储层；旧 flushUseCounts 逐笔记 persistNote 重写 .md 通道已拆除；同上 fire-and-forget）
      _recallFlushAgg()
    })
    // 发布版不再写 .last-host-load 开发心跳（静态包 import 即就绪，无需引导壳自检）
    console.log('notes plugin: host ready (static pkg), notes dir =', NOTES_ROOT, ', llm =', !!llm, ', adm =', !!adm, ', rpc =', RPC_PATH, ', app =', APP_PAGE_ROUTE, ', asset =', ASSET_ROUTE)
}

