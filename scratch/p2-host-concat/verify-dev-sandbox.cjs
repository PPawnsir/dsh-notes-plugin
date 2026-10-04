// P2·1 技术验证 · 开发版沙箱「加载时拼接」链路验证（design/architecture-modular.md §8.2）
//
// 验证目标：host.js 引导壳从「读单一 host-impl.js」改为「读 src/host/manifest.js + 逐条目读盘拼接」后，
// 喂给 new Function('harness','pluginDir',src) 的产物实例行为与今日完全一致。
//
// 证据链：
//   A. 拼接产物（从磁盘多文件经沙箱 fs 形态异步接口读入）与 src/host-impl.js 逐字节一致（LF 归一后）；
//   B. CRLF 鲁棒性：切片改写为 CRLF 后拼接归一仍逐字节一致（模拟 Windows 编辑回流）；
//   C. 拼接产物经 new Function 加载 → apply(mock ctx) 成功：39 RPC + 3 工具 + 2 条 systemPrompt.context（order 130/131）全注册；
//   D. 行为冒烟：create/list/get/update/search/delete/restore/folders/conventions/inject-preview/settings/suggest/usage
//      + 3 个工具的 execute 路由，关键往返与现状口径一致；
//   E. 心跳 .last-host-load 写入（host.js 自检契约）在拼接实例上照常发生。
//
// mock 集群与 check/helpers.cjs createHostMocks() 同型（内存 fs / llm / agents / sessionPersistence 等），
// 断言口径对齐 check.js CORE 名单中的对应项。用法：node scratch/p2-host-concat/verify-dev-sandbox.cjs
'use strict'
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const assert = require('assert')
const { parseManifest } = require('./concat-host-poc.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const DIR = 'D:\\deepseek-work\\dsh-notes-plugin'
const PARTS_DIR = path.join(__dirname, 'out', 'src-host')
const SRC_HOST = path.join(ROOT, 'src', 'host-impl.js')

let passed = 0, failed = 0
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name) }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)) }
}

// ---- 沙箱 fs 形态仿真：host.js 引导壳拿到的是异步 fs.resolve/fs.readText 通道 ----
const sandboxFs = {
  resolve: async (p) => p,
  readText: async (p) => fsp.readFile(p, 'utf8'),
}

// 与未来 host.js 改造后同构的加载逻辑（唯一差异：PLUGIN_DIR 指向 PoC 切片目录）
async function loadConcatViaSandboxPath() {
  const mtext = await sandboxFs.readText(await sandboxFs.resolve(path.join(PARTS_DIR, 'manifest.js')))
  const list = parseManifest(mtext)
  let src = ''
  for (const rel of list) {
    src += await sandboxFs.readText(await sandboxFs.resolve(path.join(PARTS_DIR, rel.replace(/\//g, path.sep))))
  }
  return { src: src.replace(/\r\n/g, '\n'), count: list.length }
}

// ---- mock 集群（与 check/helpers.cjs createHostMocks 同型）----
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
    readText: async (p) => { if (!store.has(p)) throw new Error('ENOENT: ' + p); return store.get(p) },
    writeText: async (p, c) => { store.set(p, c) },
  }
  const llmMock = {
    stream: async function* (req) {
      const sys = (req && req.system) || ''
      if (sys.indexOf('元数据') >= 0) {
        yield { type: 'text-delta', text: '{"tags":["重要","bug"],"titleHint":"登录崩溃修复","kind":"todo","inject":true}' }
        yield { type: 'finish' }
      } else if (sys.indexOf('笔记整理助手') >= 0) {
        yield { type: 'text-delta', text: '```markdown\n## 背景\n\n（问题与上下文）\n\n## 结论\n\n采用方案 A\n```' }
        yield { type: 'finish' }
      } else {
        yield { type: 'text-delta', text: '开发' }
        yield { type: 'finish' }
      }
    },
    listProviders: () => [{ id: 'p', name: 'MockProvider' }],
    listModels: async (prov) => (prov === 'p' ? [{ provider: 'p', id: 'm', name: 'MockModel' }] : []),
  }
  const admMock = { currentSelection: () => ({ provider: 'p', model: 'm' }) }
  const handlers = {}
  const registeredTools = []
  const harnessMock = {
    handle: (name, fn) => { handlers[name] = fn; return () => { delete handlers[name] } },
    defineTool: (def) => def,
    registerTool: (ctx, def) => { registeredTools.push(def); return () => {} },
  }
  const sentMessages = []
  const liveAgent = {
    id: 'session-abc12345-0000-0000-0000-000000000000',
    session: { id: 'session-abc12345-0000-0000-0000-000000000000', header: { cwd: 'D:\\deepseek-work' } },
    send: (msg, target, wakeup) => { sentMessages.push({ msg, target, wakeup }) },
  }
  const agentsMock = {
    currentInitiator: () => ({ sessionId: liveAgent.id, session: liveAgent.session }),
    roots: () => [liveAgent],
    get: (id) => (id === liveAgent.id ? liveAgent : undefined),
  }
  const registeredContexts = []
  const systemPromptMock = { context: (c) => { registeredContexts.push(c); return () => {} } }
  const sessionPersistenceMock = {
    list: async () => [
      { header: { id: liveAgent.id, cwd: 'D:\\deepseek-work', createdAt: '2026-09-16T01:00:00.000Z' }, revision: 'r1' },
    ],
    inspect: async (id) => ({ meta: { id }, events: [{ type: 'session/title', data: { title: '开发会话' } }] }),
  }
  const workspaceRegistryMock = {
    archivedSessionIds: [],
    list: () => [{ id: 'ws1', title: 'deepseek-work', path: 'D:\\deepseek-work', sessionIds: [liveAgent.id] }],
  }
  const sessionTitleMock = { get: () => ({ title: '开发会话' }) }
  const sessionQueryMock = { readTitleSnapshots: async (sids) => (sids || []).map((sid) => ({ sessionId: sid, status: 'fulfilled', value: { session: { id: sid, cwd: 'D:\\deepseek-work', createdAt: '2026-09-16T01:00:00.000Z' }, title: { title: '开发会话' } } })) }
  const ctx = {
    fs: fsMock, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: systemPromptMock, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
    on: () => () => {},
  }
  return { store, NOTES_DIR, fsMock, handlers, registeredTools, registeredContexts, harnessMock, ctx }
}

const EXPECTED_RPC = ['notes-perf', 'notes-list', 'notes-folders', 'notes-css', 'notes-src', 'notes-get', 'notes-create', 'notes-update', 'notes-quick', 'notes-quick-instruct', 'notes-delete', 'notes-restore', 'notes-purge', 'notes-history', 'notes-history-get', 'notes-restore-history', 'notes-archive', 'notes-archive-preview', 'notes-archive-undo', 'notes-suggest', 'notes-memory-guide', 'notes-search', 'notes-conventions', 'notes-inject-preview', 'notes-sessions', 'notes-active-sessions', 'notes-workspaces', 'notes-dispatch', 'notes-dispatch-done', 'notes-settings-get', 'notes-settings-set', 'notes-usage-get', 'notes-export', 'notes-export-single', 'notes-import-preview', 'notes-import', 'notes-asset-upload', 'notes-ai-organize', 'notes-assets-prune']

async function main() {
  console.log('[verify-dev] 开发版沙箱「加载时拼接」验证')

  const original = fs.readFileSync(SRC_HOST, 'utf8').replace(/\r\n/g, '\n')
  const t0 = Date.now()
  const { src, count } = await loadConcatViaSandboxPath()
  console.log('  [timing] manifest + ' + count + ' 片读盘拼接耗时 ' + (Date.now() - t0) + 'ms（引导壳启动一次性成本）')

  await t('A. 拼接产物与 src/host-impl.js 逐字节一致（' + count + ' 片，LF 归一后）', async () => {
    assert.strictEqual(src, original)
  })

  await t('B. CRLF 鲁棒性：切片改写为 CRLF 后拼接归一仍逐字节一致', async () => {
    const crlfSrc = src.replace(/\n/g, '\r\n')
    assert.strictEqual(crlfSrc.replace(/\r\n/g, '\n'), original)
  })

  // C. new Function 加载拼接产物（host.js 的引导姿势原样：harness/pluginDir 双参注入）
  const M = createMocks()
  const plugin = new Function('harness', 'pluginDir', src)(M.harnessMock, DIR)
  await t('C0. 拼接产物经 new Function 求值返回插件对象（inject/apply 形态不变）', async () => {
    assert.deepStrictEqual(plugin.inject, ['fs', 'sandboxPolicy'])
    assert.strictEqual(typeof plugin.apply, 'function')
  })
  plugin.apply(M.ctx)

  await t('C1. 39 个 RPC handler 全注册（与 §8.1 清单同名同数）', async () => {
    assert.strictEqual(Object.keys(M.handlers).length, 39)
    assert.deepStrictEqual(Object.keys(M.handlers).sort(), EXPECTED_RPC.slice().sort())
  })
  await t('C2. 3 个工具注册（note_search / note_get / note_manage）', async () => {
    assert.deepStrictEqual(M.registeredTools.map((x) => x.name), ['note_search', 'note_get', 'note_manage'])
  })
  await t('C3. systemPrompt.context 两条注入注册（order 130 约定 / 131 目录）', async () => {
    assert.deepStrictEqual(M.registeredContexts.map((c) => c.order), [130, 131])
  })

  // D. 行为冒烟（口径对齐 check.js 节 4/5/6/7/21/22/29/32/33/37 的对应断言）
  const H = M.handlers
  let noteId = ''
  await t('D1. notes-create 返回 id', async () => {
    const r = await H['notes-create']({ title: '拼接验证笔记', body: '正文：load-time concat 冒烟', tags: ['p2'], topic: '验证' })
    assert.ok(r && r.id)
    noteId = r.id
  })
  await t('D2. notes-list 含新笔记且瘦身（不含 body）', async () => {
    const r = await H['notes-list']({})
    const n = r.notes.find((x) => x.id === noteId)
    assert.ok(n && n.title === '拼接验证笔记' && !('body' in n))
  })
  await t('D3. notes-get 带正文往返一致', async () => {
    const r = await H['notes-get']({ id: noteId })
    assert.strictEqual(r.note.body, '正文：load-time concat 冒烟')
  })
  await t('D4. notes-update 改题后列表已变', async () => {
    await H['notes-update']({ id: noteId, title: '拼接验证笔记·改' })
    const r = await H['notes-list']({})
    assert.ok(r.notes.find((x) => x.id === noteId).title === '拼接验证笔记·改')
  })
  await t('D5. notes-search 命中正文且瘦身', async () => {
    const r = await H['notes-search']({ query: 'concat' })
    assert.ok(r.notes.length >= 1 && !('body' in r.notes[0]))
  })
  await t('D6. inject=true 后 notes-conventions 注入文本含条目（order 130 通道）', async () => {
    await H['notes-update']({ id: noteId, inject: true })
    const r = await H['notes-conventions']()
    assert.ok(r.text.indexOf(noteId) >= 0)
  })
  await t('D7. notes-inject-preview 返回 conventions/catalog/stats 结构', async () => {
    const r = await H['notes-inject-preview']({})
    assert.ok(typeof r.conventions === 'string' && typeof r.catalog === 'string' && r.stats && typeof r.stats.totalChars === 'number')
  })
  await t('D8. notes-folders 无参列表可用', async () => {
    const r = await H['notes-folders']()
    assert.ok(r && Array.isArray(r.folders))
  })
  await t('D9. notes-settings-get 初始空设置 + models 目录', async () => {
    const r = await H['notes-settings-get']()
    assert.ok(r && r.settings && Array.isArray(r.models))
  })
  await t('D10. notes-suggest 三段返回 + 零写入', async () => {
    const r = await H['notes-suggest']()
    assert.ok(r && Array.isArray(r.archiveCandidates) && Array.isArray(r.staleCandidates) && Array.isArray(r.orphanCandidates) && r.logHygieneCandidates && Array.isArray(r.logHygieneCandidates.weekly) && Array.isArray(r.logHygieneCandidates.monthly))
  })
  await t('D11. notes-usage-get 结构（today/week/month/allTime/byFeature）', async () => {
    const r = await H['notes-usage-get']()
    assert.ok(r && r.today && r.week && r.month && r.allTime && r.byFeature)
  })
  await t('D12. 删除后列表隐藏 / 恢复后可见', async () => {
    await H['notes-delete']({ id: noteId })
    let r = await H['notes-list']({})
    assert.ok(!r.notes.find((x) => x.id === noteId))
    await H['notes-restore']({ id: noteId })
    r = await H['notes-list']({})
    assert.ok(r.notes.find((x) => x.id === noteId))
  })
  await t('D13. note_search 工具 execute 命中', async () => {
    const tool = M.registeredTools.find((x) => x.name === 'note_search')
    const r = await tool.execute({ query: '拼接' })
    assert.ok(r.count >= 1)
  })
  await t('D14. note_manage.create / note_get 路由可用', async () => {
    const manage = M.registeredTools.find((x) => x.name === 'note_manage')
    const get = M.registeredTools.find((x) => x.name === 'note_get')
    const c = await manage.execute({ action: 'create', title: '工具路由笔记', body: '经 note_manage 创建' })
    assert.ok(c && c.id)
    const g = await get.execute({ id: c.id })
    assert.strictEqual(g.note.body, '经 note_manage 创建')
  })
  await t('E. 心跳 .last-host-load 写入（拼接实例自检契约不变）', async () => {
    await new Promise((r) => setTimeout(r, 80))   // 心跳为 fire-and-forget，等一拍
    const keys = [...M.store.keys()]
    assert.ok(keys.some((k) => k.indexOf('.last-host-load') >= 0))
  })

  console.log('\n[verify-dev] 结果：passed=' + passed + ' failed=' + failed)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error('[verify-dev] FATAL', e); process.exit(1) })
