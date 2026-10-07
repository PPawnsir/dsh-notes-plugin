// check/helpers.cjs —— check.js 模块化拆分的共享设施层（notes-check-split）
// 内容来源：原 check.js 头部常量/源码读取 + t()/section() + 节 2 mock 构造（逐字节迁移，仅计数器收口 io）。
// DSH 笔记插件回归测试套件
// 架构：host.js/client.js = 引导壳；src/host/** = host 模块源（P2·2 起，concat-host.cjs 按 manifest 拼接）；src/client/** = client 模块源（architecture-modular 起）
// 测试：host 全链路逻辑（内存 mock fs/llm）+ 工具 schema 校验 + 实现源码结构断言
// 不触碰真实笔记目录。
const fsNative = require('fs')
const path = require('path')
const osNative = require('os')
const assert = require('assert')
const { pathToFileURL } = require('url')

const DIR = path.join(__dirname, '..')   // 0.4.5-A（notes-045-debt-host）：硬编码绝对路径相对化——隔离实验环境可移植
// 工作区 mock 路径（liveAgent/currentInitiator/sessionPersistence/workspaceRegistry fixture 的 cwd/path）：
//   取插件仓父目录（本仓常态 = D:\deepseek-work），随仓迁移自动跟随；断言侧用 path.dirname(DIR) 同口径
const WS_DIR = path.dirname(DIR)
// 开发版源码集中在 src/（v0.3 工程整理）；路径引用统一收敛为以下常量，断言体内不再散落拼路径
// P2·5：src/host/** 模块树终态（whole.js 余量清零，续切为 server/dispatch/inject/memory/search/transfer/index；
// 本常量仅为历史锚点保留（断言体不读它），指向尾模块 index.js（收口装配：工具层 + 启动收尾）
const SRC_HOST = path.join(DIR, 'src', 'host', 'index.js')
const SRC_STYLES = path.join(DIR, 'src', 'styles.css')
const bootHostSrc = fsNative.readFileSync(path.join(DIR, 'host.js'), 'utf8')
const bootClientSrc = fsNative.readFileSync(path.join(DIR, 'client.js'), 'utf8')
// host 源唯一口径 = src/host/** 经 scripts/concat-host.cjs 按 manifest.dev.js 逐字节拼接的产物（LF 归一）：
// 断言读的始终是「产物文本」（与迁移前 src/host-impl.js 逐字节一致），模块源改名/移动对断言无感（与下行 clientSrc 同一先例）
const hostSrc = require(path.join(DIR, 'scripts', 'concat-host.cjs')).concatHost()
// client 源唯一口径 = src/client/** 经 scripts/concat-client.cjs 按 manifest 逐字节拼接的产物（LF 归一）：
// 断言读的始终是「产物文本」（与迁移前 src/client-impl.js 逐字节一致），模块源改名/移动对断言无感
const clientSrc = require(path.join(DIR, 'scripts', 'concat-client.cjs')).concatClient()
// P2：发布版静态包 host（ESM）。开发版 host-impl.js 之上的回归照旧，这里额外覆盖静态包。
const INDEX_PATH = path.join(DIR, 'packages', 'dsh-notes-plugin', 'index.mjs')
const indexSrc = fsNative.readFileSync(INDEX_PATH, 'utf8')

// ===== 运行状态（原模块顶层 let passed/failed/skipped 收口为 state；io = 磁盘读写/会话标题读取计数器）=====
const state = {
  passed: 0, failed: 0, skipped: 0,
  CORE_MODE: false, CORE: null,          // --core：名单过滤 + 命中校验（名单本体在 runner check.js）
  ONLY: null, ONLY_MODE: false,          // --only=39,42：分节运行（新增能力；只跳过非选中节的 t() 断言体，节间造数照常）
  currentSelected: true,                 // 当前执行节是否被 --only 选中（runner 经 beginSection 设置）
  coreSeen: new Set(),
  pendingSection: null,                  // core/only 模式：section 头延迟到首个被执行的断言前打印（无执行断言的 section 不输出空标题）
}
const io = { reads: 0, writes: 0, sharedTitleReads: 0 }
const S = {}   // 跨节共享状态：节 2 mock 集群 + 各节 Object.assign 导出的造数引用

function init(opts) {
  state.CORE_MODE = opts.CORE_MODE
  state.CORE = opts.CORE
  state.ONLY = opts.ONLY
  state.ONLY_MODE = opts.ONLY_MODE
}
function beginSection(selected) { state.currentSelected = selected }

// 必须 await fn()：大量测试是 async 的，不 await 会导致 promise 内断言未执行就 passed++（假通过）
async function t(name, fn) {
  if (state.ONLY_MODE && !state.currentSelected) { state.skipped++; return }
  if (state.CORE_MODE && !state.CORE.has(name)) { state.skipped++; return }
  if (state.CORE_MODE || state.ONLY_MODE) {
    if (state.CORE_MODE) state.coreSeen.add(name)
    if (state.pendingSection) { console.log('\n[1m' + state.pendingSection + '[0m'); state.pendingSection = null }
  }
  try { await fn(); state.passed++; console.log('  \x1b[32m✓\x1b[0m ' + name) }
  catch (e) { state.failed++; console.log('  \x1b[31m✗\x1b[0m ' + name + '\n      ' + (e.message || e)) }
}
function section(name) { if (state.CORE_MODE || state.ONLY_MODE) { state.pendingSection = name; return } console.log('\n[1m' + name + '[0m') }

// ===== 节 2 迁移：Host 全链路 mock 实例构造（内存 mock fs/llm/agents/...，apply 后 handlers 常驻 S）=====
function createHostMocks() {
  const store = new Map()
  // io.reads/io.writes 计数器：收进 helpers.io（io.reads / io.writes），断言侧同口径读取
  const NOTES_DIR = path.join(DIR, 'notes')   // 0.4.5-A：随 DIR 相对化（原硬编码 D:\deepseek-work\dsh-notes-plugin\notes）
  const fsMock = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { io.reads++; if (!store.has(p)) throw new Error('ENOENT: ' + p); return store.get(p) },
    writeText: async (p, c) => { io.writes++; store.set(p, c) },
  }
  const llmMock = {
    stream: async function* (req) {
      const sys = (req && req.system) || ''
      // T3 指令元数据提取：返回固定 JSON（断言原文不变 + 元数据应用）
      if (sys.indexOf('元数据') >= 0) {
        yield { type: 'text-delta', text: '{"tags":["重要","bug"],"titleHint":"登录崩溃修复","kind":"todo","inject":true}' }
        yield { type: 'finish' }
      } else if (sys.indexOf('笔记整理助手') >= 0) {
        // 二期 ✨整理（27 节）：返回带 ```markdown 围栏的重写正文（断言 host 剥离围栏 + 尾随换行）
        yield { type: 'text-delta', text: '```markdown\n## 背景\n\n（问题与上下文）\n\n## 结论\n\n采用方案 A\n' }
        yield { type: 'text-delta', text: '\n\n## 理由\n\n成本最低\n```' }
        yield { type: 'finish' }
      } else if (sys.indexOf('挂载助手') >= 0) {
        // 0.4.3 验收修复（节 73，notes-043-preview-when-edit）：notes-when-suggest 草稿固定单行
        yield { type: 'text-delta', text: '排查断言口径时查我' }
        yield { type: 'finish' }
      } else {
        yield { type: 'text-delta', text: '开发' }
        yield { type: 'finish' }
      }
    },
    // 模型目录探针（notes-settings-get 的 models 数据源）：listProviders() → listModels(provider)
    listProviders: () => [{ id: 'p', name: 'MockProvider' }],
    listModels: async (prov) => (prov === 'p' ? [{ provider: 'p', id: 'm', name: 'MockModel' }] : []),
  }
  const admMock = { currentSelection: () => ({ provider: 'p', model: 'm' }) }
  const handlers = {}
  const registeredTools = []
  global.harness = {
    handle: (name, fn) => { handlers[name] = fn; return () => { delete handlers[name] } },
    defineTool: (def) => def,
    registerTool: (ctx, def) => { registeredTools.push(def); return () => {} },
  }
  const sentMessages = []
  const liveAgent = {
    id: 'session-abc12345-0000-0000-0000-000000000000',
    session: { id: 'session-abc12345-0000-0000-0000-000000000000', header: { cwd: WS_DIR } },
    send: (msg, target, wakeup) => { sentMessages.push({ msg, target, wakeup }) }
  }
  // 0.4.4-B：agents.create 专属会话 mock——创建的 agent 登记进 createdAgents（agents.get 命中 = live 语义）；
  //   dispose 摘除（插件重载降级路径演练）；创建即播种持久化日志（persistLogs），与真实 create 的持久化语义一致
  const createdAgents = new Map()
  const agentCreateCalls = []
  const agentsMock = {
    currentInitiator: () => ({ sessionId: 'session-abc12345-0000-0000-0000-000000000000', session: { id: 'session-abc12345-0000-0000-0000-000000000000', header: { cwd: WS_DIR } } }),
    roots: () => [liveAgent],
    get: (id) => id === 'session-abc12345-0000-0000-0000-000000000000' ? liveAgent : createdAgents.get(id),
    create: async (opts) => {
      agentCreateCalls.push(opts)
      const sid = opts.sessionId
      const a = { id: sid, session: { id: sid, header: { cwd: (opts.meta && opts.meta.cwd) || '' } }, send: (msg, target, wakeup) => { sentMessages.push({ msg, target, wakeup, via: 'created:' + sid }) } }
      createdAgents.set(sid, a)
      if (!persistLogs.has(sid)) persistLogs.set(sid, [])
      return { agent: a, dispose: async () => { createdAgents.delete(sid) } }
    }
  }
  // 0.4.4-B：agentPresets mock（resolve/mount 双方法面；setup 内 mount 语义录制）
  const agentPresetsMock = { resolve: async (id) => ({ id: id || 'mock-default-preset' }), mount: async (agentCtx, id) => {} }
  // 0.4.7（notes-047-sched-preset）：permissionPresets mock——defaultPreset getter（settings-get 增带数据源，ppState.defaultPreset 可变；
  //   '__throw' = getter 异常演练优雅降级）+ set(session, name) 调用录制（创建透传断言；ppState.failSet=true 注入故障演练 lastError 降级）
  const ppState = { defaultPreset: 'danger-full-access', failSet: false }
  const permissionPresetSetCalls = []
  const permissionPresetsMock = {
    get defaultPreset() { if (ppState.defaultPreset === '__throw') throw new Error('mock defaultPreset unreadable'); return ppState.defaultPreset },
    set: (session, name) => { if (ppState.failSet) throw new Error('mock permission set failed'); permissionPresetSetCalls.push({ id: session && session.id, name: name }) }
  }
  const registeredContexts = []
  const systemPromptMock = { context: (c) => { registeredContexts.push(c); return () => {} } }
  // 0.4.4-B：持久化日志 mock（休眠送达通道演习场）——open('write') 拿写把手（read/append/flush/close 四合约 +
  //   seq 连续性校验同 assertContiguous）；stat 元数据探针（_schedFire 可送达预检数据源）；
  //   预置 sub99 一条存量日志（休眠有效目标），arch 一份（归档目标）；agents.create 播种新建会话日志
  const persistLogs = new Map()
  persistLogs.set('session-sub9900000-0000-0000-0000-000000000000', [{ type: 'session/end-seed', seq: 0, time: 1758000000000, data: {} }])
  persistLogs.set('session-arch00000-0000-0000-0000-000000000000', [{ type: 'session/end-seed', seq: 0, time: 1758000000000, data: {} }])
  const persistOpenCalls = []
  const sessionPersistenceMock = {
    // 返回 SessionPersistenceSnapshot 结构（{header, revision}），模拟 DSH 新版 list() 返回
    list: async () => [
      { header: { id: 'session-abc12345-0000-0000-0000-000000000000', cwd: WS_DIR, createdAt: '2026-09-16T01:00:00.000Z' }, revision: 'r1' },
      { header: { id: 'session-sub9900000-0000-0000-0000-000000000000', cwd: WS_DIR, createdAt: '2026-09-16T02:00:00.000Z', origin: 'subagent' }, revision: 'r2' },
      { header: { id: 'session-arch00000-0000-0000-0000-000000000000', cwd: WS_DIR, createdAt: '2026-09-16T03:00:00.000Z' }, revision: 'r3' }
    ],
    inspect: async (id) => ({ meta: { id: id, cwd: WS_DIR }, events: [{ type: 'session/title', data: { title: '开发会话' } }] }),
    stat: async (id) => persistLogs.has(id) ? { header: { id: id, cwd: WS_DIR }, revision: 'r' } : undefined,
    open: async (id, access) => {
      persistOpenCalls.push({ id: id, access: access })
      if (!persistLogs.has(id)) { const e = new Error('session "' + id + '" not found'); e.name = 'SessionPersistenceNotFoundError'; throw e }
      const events = persistLogs.get(id)
      let closed = false
      return {
        id: id, access: access,
        read: async (offset, length) => { const st = offset || 0; return { eventState: 'detached', events: events.slice(st, length === undefined ? events.length : st + length) } },
        append: async (batch) => { for (const ev of batch) { if (!ev || ev.seq !== events.length) throw new Error('non-contiguous append seq') ; events.push(ev) } },
        flush: async () => {},
        close: async () => { closed = true },
        get closed() { return closed }
      }
    }
  }
  // 0.4.4-B：工作区落账录制（attachSession 只录不_mutate——sessionIds 账目变化会污染后续节的会话清单口径，行为断言看录制表）
  const attachCalls = []
  // ws1 账目数组跨 list() 共享（0.4.4-B 节 48/82 需要就地增删 sid 演练「声明期存活、执行期持久化失联」场景；用后必须复位）
  const ws1SessionIds = ['session-abc12345-0000-0000-0000-000000000000', 'session-sub9900000-0000-0000-0000-000000000000', 'session-arch00000-0000-0000-0000-000000000000']
  const workspaceRegistryMock = {
    archivedSessionIds: ['session-arch00000-0000-0000-0000-000000000000'],
    // 工作区（含 sessionIds，= 左侧列表有效会话数据源）
    list: () => [
      { id: 'ws1', title: 'deepseek-work', path: WS_DIR, sessionIds: ws1SessionIds, attachSession: async (sid) => { attachCalls.push(sid) } }
    ]
  }
  const titleRenameCalls = []
  const sessionTitleMock = { get: (session) => ({ title: '开发会话' }), rename: (session, title) => { titleRenameCalls.push({ id: session && session.id, title: title }); return { title: title, seq: 0 } } }
  // 0.1.7 会话元数据缓存断言用：readTitleSnapshots 调用计数（缓存命中后不应再触发）
  // io.sharedTitleReads 计数器：收进 helpers.io.sharedTitleReads
  const sessionQueryMock = {
    // 批量读 title + header（origin/cwd/createdAt）
    // 0.4.5-A（notes-045-debt-host ③ 孤儿专属会话探测）：title 改为 rename-aware——sessionTitle.rename 录制表
    //   内该 sid 的最新命名优先返回（缺省「开发会话」），供 schedule.js 按标题「定时 · <任务名>」探测既有专属会话
    readTitleSnapshots: async (sids) => {
      io.sharedTitleReads++
      return (sids || []).map(sid => {
        let title = '开发会话'
        for (let i = titleRenameCalls.length - 1; i >= 0; i--) { if (titleRenameCalls[i] && titleRenameCalls[i].id === sid) { title = titleRenameCalls[i].title; break } }
        return {
          sessionId: sid,
          status: 'fulfilled',
          value: {
            session: { id: sid, cwd: WS_DIR, createdAt: '2026-09-16T01:00:00.000Z', origin: sid.indexOf('sub99') >= 0 ? 'subagent' : undefined },
            title: { title: title }
          }
        }
      })
    }
  }
  const evtListeners = {}   // P3 派发闭环：ctx.on 事件订阅捕获（模拟 agent/status 触发）
  const ctx = {
    fs: fsMock, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, agentPresets: agentPresetsMock, permissionPresets: permissionPresetsMock, systemPrompt: systemPromptMock, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
    on: (name, fn) => { (evtListeners[name] = evtListeners[name] || []).push(fn); return () => {} },
  }
  const plugin = new Function('harness', 'pluginDir', hostSrc)(global.harness, DIR)
  plugin.apply(ctx)
  Object.assign(S, { NOTES_DIR, admMock, agentPresetsMock, agentsMock, agentCreateCalls, attachCalls, createdAgents, ctx, evtListeners, fsMock, handlers, liveAgent, llmMock, permissionPresetsMock, permissionPresetSetCalls, ppState, persistLogs, persistOpenCalls, plugin, registeredContexts, registeredTools, sentMessages, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, store, systemPromptMock, titleRenameCalls, workspaceRegistryMock, ws1SessionIds })
}

module.exports = {
  t, section, init, beginSection, createHostMocks, state, io, S,
  assert, fsNative, path, osNative, pathToFileURL,
  DIR, SRC_HOST, SRC_STYLES, INDEX_PATH,
  bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc,
}
