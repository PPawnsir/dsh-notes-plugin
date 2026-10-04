// P2·2 验收自测 · 真实 host.js 引导壳端到端验证（design/architecture-modular.md §8.5 步骤 H-A）
//
// 与 P2·1 PoC（verify-dev-sandbox.cjs，验证「未来 host.js 同构逻辑」）不同：本脚本直接 eval 现行 host.js 本体，
// 并用 Function 构造器遮蔽（shadow）捕获引导壳实际喂给 new Function('harness','pluginDir',src) 的拼接产物：
//   A. 捕获产物与迁移前 src/host-impl.js 基线逐字节一致（LF 归一后）——红线 7a 的壳级实证；
//   B. 引导壳经沙箱 fs 形态异步接口（resolve/readText）读 manifest.dev.js + 逐条目读盘，加载成功
//      （console 出现 'notes plugin: host impl loaded'，无 'bootstrap failed'）；
//   C. 产物实例 apply(mock ctx)：39 RPC + 3 工具 + systemPrompt.context order 130/131 + 心跳 .last-host-load。
//
// 用法：node scratch/p2-host-concat/verify-hostjs-real.cjs [基线目录]   （基线 = 迁移前 host-impl.js 所在目录）
'use strict'
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const assert = require('assert')

const ROOT = path.resolve(__dirname, '..', '..')
const DIR = 'D:\\deepseek-work\\dsh-notes-plugin'
const BASELINE = process.argv[2] || path.join(process.env.TEMP || '', 'p22-baseline')

let passed = 0, failed = 0
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name) }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)) }
}

// ---- mock 集群（与 check/helpers.cjs createHostMocks 同型；fs.readText 双层：内存笔记库优先，未命中回退真实盘——
//      引导壳读 manifest/模块走真实盘，impl 笔记操作走内存库）----
function createMocks() {
  const store = new Map()
  const NOTES_DIR = 'D:\\deepseek-work\\dsh-notes-plugin\\notes'
  const fsMock = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (store.has(p)) return store.get(p); return fsp.readFile(p, 'utf8') },
    writeText: async (p, c) => { store.set(p, c) },
  }
  const llmMock = {
    stream: async function* () { yield { type: 'text-delta', text: '开发' }; yield { type: 'finish' } },
    listProviders: () => [{ id: 'p', name: 'MockProvider' }],
    listModels: async () => [{ provider: 'p', id: 'm', name: 'MockModel' }],
  }
  const admMock = { currentSelection: () => ({ provider: 'p', model: 'm' }) }
  const handlers = {}
  const registeredTools = []
  global.harness = {
    handle: (name, fn) => { handlers[name] = fn; return () => { delete handlers[name] } },
    defineTool: (def) => def,
    registerTool: (ctx, def) => { registeredTools.push(def); return () => {} },
  }
  const liveAgent = { id: 'session-abc12345-0000-0000-0000-000000000000', session: { id: 'session-abc12345-0000-0000-0000-000000000000', header: { cwd: 'D:\\deepseek-work' } }, send: () => {} }
  const agentsMock = { currentInitiator: () => ({ sessionId: liveAgent.id, session: liveAgent.session }), roots: () => [liveAgent], get: () => undefined }
  const registeredContexts = []
  const ctx = {
    fs: fsMock, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { registeredContexts.push(c); return () => {} } }, sessionPersistence: { list: async () => [], inspect: async () => ({ meta: {}, events: [] }) }, workspaceRegistry: { archivedSessionIds: [], list: () => [] }, sessionTitle: { get: () => ({ title: '开发会话' }) }, sessionQuery: { readTitleSnapshots: async () => [] } })[name],
    effect: () => {},
    on: () => () => {},
  }
  return { store, handlers, registeredTools, registeredContexts, ctx }
}

async function main() {
  console.log('[verify-hostjs] 真实 host.js 引导壳端到端验证（P2·2）')

  const bootSrc = fs.readFileSync(path.join(ROOT, 'host.js'), 'utf8')
  const baseline = fs.readFileSync(path.join(BASELINE, 'host-impl.js'), 'utf8').replace(/\r\n/g, '\n')

  // Function 构造器遮蔽：捕获引导壳实际喂给 new Function('harness','pluginDir',src) 的拼接产物
  let capturedSrc = null
  const RealFunction = Function
  const CaptureFunction = function (...args) { capturedSrc = args[args.length - 1]; return RealFunction.apply(null, args) }

  const logs = []
  const origLog = console.log
  const origErr = console.error
  console.log = (...a) => { logs.push(a.join(' ')); origLog.apply(console, a) }
  console.error = (...a) => { logs.push('ERROR ' + a.join(' ')); origErr.apply(console, a) }

  const M = createMocks()
  const bootPlugin = RealFunction('Function', bootSrc)(CaptureFunction)
  await t('B0. host.js 求值返回引导壳（inject=[fs,sandboxPolicy] 不变）', async () => {
    assert.deepStrictEqual(bootPlugin.inject, ['fs', 'sandboxPolicy'])
    assert.strictEqual(typeof bootPlugin.apply, 'function')
  })

  bootPlugin.apply(M.ctx)
  await new Promise((r) => setTimeout(r, 300))   // 引导壳异步加载 + impl apply 同步完成，等一拍

  console.log = origLog
  console.error = origErr

  await t('A. 引导壳实际拼接产物与迁移前 src/host-impl.js 逐字节一致（LF 归一后）', async () => {
    assert.strictEqual(typeof capturedSrc, 'string', '未捕获到 new Function 载荷（引导壳加载失败？）')
    assert.strictEqual(capturedSrc.replace(/\r\n/g, '\n'), baseline)
  })
  await t('B. 加载成功日志出现且无 bootstrap failed', async () => {
    assert.ok(logs.some((l) => l.indexOf('notes plugin: host impl loaded') >= 0), '缺加载成功日志（实得：' + JSON.stringify(logs) + '）')
    assert.ok(!logs.some((l) => l.indexOf('bootstrap failed') >= 0), '出现 bootstrap failed')
  })
  await t('C1. 39 个 RPC handler 全注册', async () => {
    assert.strictEqual(Object.keys(M.handlers).length, 39)
  })
  await t('C2. 3 个工具注册（note_search / note_get / note_manage）', async () => {
    assert.deepStrictEqual(M.registeredTools.map((x) => x.name), ['note_search', 'note_get', 'note_manage'])
  })
  await t('C3. systemPrompt.context 两条注入注册（order 130/131）', async () => {
    assert.deepStrictEqual(M.registeredContexts.map((c) => c.order), [130, 131])
  })
  await t('C4. 心跳 .last-host-load 写入照常', async () => {
    assert.ok([...M.store.keys()].some((k) => k.indexOf('.last-host-load') >= 0))
  })

  console.log('\n[verify-hostjs] 结果：passed=' + passed + ' failed=' + failed)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error('[verify-hostjs] FATAL', e); process.exit(1) })
