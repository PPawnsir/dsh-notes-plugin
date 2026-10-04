// P2·1 技术验证 · 发布版「构建期拼接」链路验证（design/architecture-modular.md §8.2）
//
// 验证目标：packages/dsh-notes-plugin/index.mjs 由 src/host 模块目录经构建期拼接生成后，
// 产物与今日手工维护的 index.mjs 逐字节一致，且 ESM 形态/导出面/双注册通道行为不变。
//
// 证据链：
//   A. 拼接产物与 packages/dsh-notes-plugin/index.mjs 逐字节一致（LF 归一后）；
//   B. node --check 语法校验通过（ESM）；
//   C. 动态 import 成功且顶层无副作用：export name/inject/apply 形态不变（inject 9 服务清单逐项一致）；
//   D. harness 缺失通道：apply 后 3 条 webServer exact 路由（/dsh-notes、/dsh-notes-app、/dsh-notes/asset）
//      + ctx.tools 3 工具注册；POST /dsh-notes 路由分发 notes-ping/notes-create/notes-list 全链路可用；
//   E. harness 存在通道：apply 后 40 个 RPC（39 + notes-ping）经 harness.handle 注册，webServer 路由同登。
//
// 用法：node scratch/p2-host-concat/verify-dist-build.cjs
'use strict'
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const { EventEmitter } = require('events')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')
const { concatHost } = require('./concat-host-poc.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const INDEX_SRC = path.join(ROOT, 'packages', 'dsh-notes-plugin', 'index.mjs')
const PARTS_DIR = path.join(__dirname, 'out', 'pkg-host')
const ASSEMBLED = path.join(__dirname, 'out', 'index.assembled.mjs')

let passed = 0, failed = 0
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name) }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)) }
}

function createStaticMocks() {
  const store = new Map()
  const os = require('os')
  const NOTES_ROOT = path.join(os.homedir(), '.dsh', 'notes')
  const fsMock = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_ROOT ? { dir: true } : (store.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p.endsWith(path.sep) ? p : p + path.sep
      const out = []
      for (const k of store.keys()) if (k.startsWith(prefix) && k.indexOf(path.sep, prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!store.has(p)) throw new Error('ENOENT: ' + p); return store.get(p) },
    writeText: async (p, c) => { store.set(p, c) },
  }
  const routes = []
  const webServerMock = { register: (r) => { routes.push(r); return () => {} } }
  const toolsReg = []
  const toolsMock = { register: (tool) => { toolsReg.push(tool); return () => {} } }
  const harnessHandlers = {}
  const harnessTools = []
  const registeredContexts = []
  const liveAgent = {
    id: 'session-abc12345-0000-0000-0000-000000000000',
    session: { id: 'session-abc12345-0000-0000-0000-000000000000', header: { cwd: 'D:\\deepseek-work' } },
    send: () => {},
  }
  const ctx = {
    fs: fsMock, sandboxPolicy: { resolve: () => ({}) },
    webServer: webServerMock, tools: toolsMock,
    get: (name) => ({
      agents: { currentInitiator: () => ({ sessionId: liveAgent.id, session: liveAgent.session }), roots: () => [liveAgent], get: (id) => (id === liveAgent.id ? liveAgent : undefined) },
      sessionPersistence: { list: async () => [], inspect: async () => ({ events: [] }) },
      workspaceRegistry: { archivedSessionIds: [], list: () => [] },
      sessionTitle: { get: () => ({ title: 't' }) },
      sessionQuery: { readTitleSnapshots: async () => [] },
      systemPrompt: { context: (c) => { registeredContexts.push(c); return () => {} } },
    })[name],
    effect: () => {},
    on: () => () => {},
  }
  const harnessMock = {
    handle: (n, fn) => { harnessHandlers[n] = fn; return () => { delete harnessHandlers[n] } },
    defineTool: (def) => def,
    registerTool: (c, def) => { harnessTools.push(def); return () => {} },
  }
  return { store, NOTES_ROOT, routes, toolsReg, harnessHandlers, harnessTools, registeredContexts, harnessMock, ctx }
}

function fakeReqRes(method, url, bodyText) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  const res = {
    headers: {}, status: 0, body: '',
    setHeader(k, v) { this.headers[k] = v },
    writeHead(s) { this.status = s },
    end(b) { this.body = b },
  }
  process.nextTick(() => { if (bodyText != null) req.emit('data', Buffer.from(bodyText)); req.emit('end') })
  return { req, res }
}

async function main() {
  console.log('[verify-dist] 发布版「构建期拼接」验证')

  const original = fs.readFileSync(INDEX_SRC, 'utf8').replace(/\r\n/g, '\n')
  const assembled = concatHost(path.join(PARTS_DIR, 'manifest.js'))

  await t('A. 拼接产物与 packages/dsh-notes-plugin/index.mjs 逐字节一致（LF 归一后）', async () => {
    assert.strictEqual(assembled, original)
  })

  fs.writeFileSync(ASSEMBLED, assembled, 'utf8')

  await t('B. node --check 语法校验通过（ESM）', async () => {
    const r = spawnSync(process.execPath, ['--check', ASSEMBLED], { encoding: 'utf8' })
    assert.strictEqual(r.status, 0, (r.stderr || '').slice(0, 400))
  })

  const mod = await import(pathToFileURL(ASSEMBLED).href)
  await t('C. 动态 import 成功：export name/inject/apply 形态不变（inject 9 服务）', async () => {
    assert.strictEqual(mod.name, 'dsh-notes-plugin')
    assert.deepStrictEqual(mod.inject, ['fs', 'sandboxPolicy', 'webServer', 'tools', 'agents', 'workspaceRegistry', 'sessionPersistence', 'sessionQuery', 'sessionTitle'])
    assert.strictEqual(typeof mod.apply, 'function')
  })

  // D. harness 缺失通道（真实 Cordis row 姿势）
  delete globalThis.harness
  const M1 = createStaticMocks()
  mod.apply(M1.ctx)
  await t('D1. harness 缺失：3 条 webServer exact 路由注册（RPC/app/asset）', async () => {
    const paths = M1.routes.map((r) => r.path).sort()
    assert.deepStrictEqual(paths, ['/dsh-notes', '/dsh-notes-app', '/dsh-notes/asset'])
    assert.ok(M1.routes.every((r) => r.kind === 'exact'))
  })
  await t('D2. harness 缺失：3 个工具经 ctx.tools.register 注册', async () => {
    assert.deepStrictEqual(M1.toolsReg.map((x) => x.name), ['note_search', 'note_get', 'note_manage'])
  })
  await t('D3. POST /dsh-notes 路由分发：notes-ping 200', async () => {
    const rpc = M1.routes.find((r) => r.path === '/dsh-notes')
    const { req, res } = fakeReqRes('POST', '/dsh-notes', JSON.stringify({ method: 'notes-ping', args: { hello: 1 } }))
    await rpc.handler(req, res)
    assert.strictEqual(res.status, 200)
    const out = JSON.parse(res.body)
    assert.ok(out && out.ok === true && out.echo && out.echo.hello === 1)
  })
  await t('D4. POST /dsh-notes 全链路：notes-create → notes-list 可见', async () => {
    const rpc = M1.routes.find((r) => r.path === '/dsh-notes')
    const c = fakeReqRes('POST', '/dsh-notes', JSON.stringify({ method: 'notes-create', args: { title: '静态包拼接验证', body: 'dist concat 冒烟', topic: '验证' } }))
    await rpc.handler(c.req, c.res)
    assert.strictEqual(c.res.status, 200)
    const created = JSON.parse(c.res.body)
    assert.ok(created && created.id)
    const l = fakeReqRes('POST', '/dsh-notes', JSON.stringify({ method: 'notes-list', args: {} }))
    await rpc.handler(l.req, l.res)
    const listed = JSON.parse(l.res.body)
    assert.ok(listed.notes.some((n) => n.id === created.id))
  })
  await t('D5. 约定注入两条注册（order 130/131）', async () => {
    assert.deepStrictEqual(M1.registeredContexts.map((c) => c.order), [130, 131])
  })

  // E. harness 存在通道（动态沙箱兼容姿势）
  const M2 = createStaticMocks()
  globalThis.harness = M2.harnessMock
  try {
    mod.apply(M2.ctx)
    await t('E1. harness 存在：40 个 RPC 经 harness.handle 注册（39 + notes-ping）', async () => {
      assert.strictEqual(Object.keys(M2.harnessHandlers).length, 40)
      assert.ok(M2.harnessHandlers['notes-ping'] && M2.harnessHandlers['notes-assets-prune'])
    })
    await t('E2. harness 存在：webServer 路由同登（第二传送门无副作用）', async () => {
      assert.strictEqual(M2.routes.length, 3)
    })
    await t('E3. harness 存在：工具走 harness.defineTool/registerTool 主通道', async () => {
      assert.deepStrictEqual(M2.harnessTools.map((x) => x.name), ['note_search', 'note_get', 'note_manage'])
      assert.strictEqual(M2.toolsReg.length, 0)
    })
  } finally {
    delete globalThis.harness
  }

  console.log('\n[verify-dist] 结果：passed=' + passed + ' failed=' + failed)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error('[verify-dist] FATAL', e); process.exit(1) })
