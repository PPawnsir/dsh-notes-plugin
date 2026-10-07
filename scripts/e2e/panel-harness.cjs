'use strict'
/* 0.4.7-D1（notes-047-panel-e2e-harness）：面板 e2e mock 挂载 harness。
 *
 * == 路线裁决（三选一的排除依据，落地前已评估）==
 * a. mock 挂载法（本文件，采纳）：Playwright 页内装载发布版 lib/client.js 真实 bundle，
 *    打桩面 = 页面侧宿主契约（__ModuleLoader__/ctx 服务 slots·timer·sessions·workspaces·effect）
 *    + 网络侧 /dsh-notes fetch 拦截（复用 server.cjs 的 handleRpc/createMockState 内存 mock）。
 *    理由：面板产物零改动（打桩全在本侧）、用例隔离确定（每 mount 独立 browser context + 独立 mock state）、
 *    离线可复现、与既有 231 条 app 页用例互不干扰。
 * b. 真 GUI 法（排除）：连真实 127.0.0.1:3080 需 DSH 宿主活着 + 面板依赖会话页 DOM，
 *    e2e 环境无此常驻依赖，脆且不可重复。
 * c. bsk 桥法（排除）：借浏览器插件工具链，e2e 环境无此依赖，候选即排除。
 *
 * == 机制 ==
 * 虚拟源 http://dsh-notes-panel.e2e（page.route 全量 URL 拦截，零真实网络）：
 *   GET  /harness            → 装配页 HTML（容器 #notes-header-root/#notes-overlay-root + ModuleLoader 桩）
 *   GET  /vendor/react(-dom).js → vendor/ 内 React 18.3.1 UMD（见 vendor/README.md）
 *   GET  /client.js          → packages/dsh-notes-plugin/lib/client.js（发布产物本体，真机口径）
 *   GET  /boot.js            → 装配脚本：factory(require('react')→window.React) → apply(ctx 桩) →
 *                              slots.register 收集 → ReactDOM.createRoot 挂载两个槽位 → __panelHarness.ready
 *   POST /dsh-notes          → 录制 rpcCalls 后转 handleRpc（notes-css 特判下发真样式，其余同 server.cjs 内存口径）
 * opts.breakRpc=true 时 POST 一律 abort——「桩未接通」演练面（用例 32 负向断言：断言必红、非假绿）。
 *
 * 返回句柄 { page, state, rpcCalls, rpcAttempts, consoleErrors, openPanel, close } 供用例断言。 */
const fs = require('fs')
const path = require('path')
const { handleRpc, createMockState } = require('./server.cjs')

const PKG = path.resolve(__dirname, '..', '..', 'packages', 'dsh-notes-plugin')
const CLIENT_JS = path.join(PKG, 'lib', 'client.js')
const STYLES_CSS = path.join(PKG, 'lib', 'styles.css')
const VENDOR_DIR = path.join(__dirname, 'vendor')
const ORIGIN = 'http://dsh-notes-panel.e2e'

/* 装配脚本（页面侧）：ModuleLoader 工厂兑现 + ctx 桩 + 槽位挂载。
 * 桩面与 dsh web 壳对插件的契约对齐（见 build-dist.cjs 头注 §4）：slots.inject/register、
 * timer.timeout/interval/debounce、sessions.open、workspaces.connectWorkspace、ctx.effect。 */
const BOOT_JS = `
;(function () {
  var H = window.__panelHarness
  function fail(msg) { H.errors.push('boot: ' + msg); H.ready = 'error' }
  try {
    var desc = window.__pluginModuleDesc
    if (!desc || typeof desc.factory !== 'function') { fail('client.js 未向 __ModuleLoader__ 注册工厂（bundle 未装载）'); return }
    if (!window.React || !window.ReactDOM || typeof window.ReactDOM.createRoot !== 'function') { fail('React/ReactDOM UMD 未加载'); return }
    var mod = desc.factory(function (name) {
      if (name === 'react') return window.React
      throw new Error('[panel-harness] 未知 require: ' + name)
    })
    if (!mod || typeof mod.apply !== 'function') { fail('工厂产物缺 apply'); return }
    var React = window.React, e = React.createElement
    var slotRegs = {}
    var slots = {
      inject: function (name, fn) {
        try { var d = fn(); return typeof d === 'function' ? d : function () {} }
        catch (err) { H.errors.push('slots.inject(' + name + '): ' + (err && err.message)); return function () {} }
      },
      register: function (reg, render) {
        var list = slotRegs[reg.name] || (slotRegs[reg.name] = [])
        list.push({ id: reg.id, order: reg.order || 0, render: render })
        list.sort(function (a, b) { return a.order - b.order })
        return function () {}
      }
    }
    var timer = {
      timeout: function (fn, ms) { var id = setTimeout(fn, ms); return function () { clearTimeout(id) } },
      interval: function (fn, ms) { var id = setInterval(fn, ms); return function () { clearInterval(id) } },
      debounce: function (fn, ms) {
        var id = null
        function d() { var self = this, args = arguments; if (id) clearTimeout(id); id = setTimeout(function () { id = null; fn.apply(self, args) }, ms) }
        d.dispose = function () { if (id) { clearTimeout(id); id = null } }
        return d
      }
    }
    var disposers = []
    var sessions = { open: function (id) { H.sessionOpens.push(id) } }
    var workspaces = { connectWorkspace: function () { return Promise.resolve('') } }
    var ctx = {
      get: function (name) {
        if (name === 'slots') return slots
        if (name === 'timer') return timer
        if (name === 'sessions') return sessions
        if (name === 'workspaces') return workspaces
        return undefined   /* 可选服务（inputTriggers 等）缺席静默降级，与真壳旧版同口径 */
      },
      effect: function (fn) { try { var d = fn(); if (typeof d === 'function') disposers.push(d) } catch (err) { H.errors.push('ctx.effect: ' + (err && err.message)) } }
    }
    mod.apply(ctx)
    function mount(slotName, containerId, props) {
      var container = document.getElementById(containerId)
      if (!container) throw new Error('容器缺失 #' + containerId)
      var list = slotRegs[slotName] || []
      var kids = list.map(function (r) { return e(r.render, Object.assign({ key: r.id }, props || {})) })
      var root = window.ReactDOM.createRoot(container)
      root.render(e(React.Fragment, null, kids))
      return root
    }
    H.roots = [
      mount('shell.overlay', 'notes-overlay-root', {}),
      mount('conversation.session.header.actions', 'notes-header-root', { sessionId: (window.__panelHarnessConfig && window.__panelHarnessConfig.sessionId) || 'sess-e2e-0001' })
    ]
    H.registered = {}
    Object.keys(slotRegs).forEach(function (k) { H.registered[k] = slotRegs[k].map(function (r) { return r.id }) })
    H.dispose = function () {
      try { H.roots.forEach(function (r) { r.unmount() }) } catch (err) {}
      disposers.forEach(function (d) { try { d() } catch (err) {} })
    }
    H.ready = true
  } catch (err) { fail(String((err && err.stack) || err)) }
})()
`

function harnessHtml(config) {
  return '<!DOCTYPE html>\n<html lang="zh">\n<head>\n<meta charset="utf-8">\n<title>dsh-notes panel harness</title>\n'
    + '<style>html,body{margin:0;padding:0;background:#fff}#notes-header-root{display:flex;gap:6px;padding:6px 10px;border-bottom:1px solid #e2e2e2;align-items:center}</style>\n'
    + '</head>\n<body>\n'
    + '<div id="notes-header-root"></div>\n<div id="notes-overlay-root"></div>\n'
    /* 桩必须先于 client.js：bundle 顶层即调 __ModuleLoader__.load */
    + '<script>window.__panelHarness={ready:false,errors:[],sessionOpens:[],registered:null};\n'
    + 'window.addEventListener("error",function(ev){window.__panelHarness.errors.push(String((ev&&ev.message)||ev))});\n'
    + 'window.__ModuleLoader__={load:function(desc){window.__pluginModuleDesc=desc}};\n'
    + 'window.__panelHarnessConfig=' + JSON.stringify(config || {}) + ';\n</script>\n'
    + '<script src="/vendor/react.js"></script>\n'
    + '<script src="/vendor/react-dom.js"></script>\n'
    + '<script src="/client.js"></script>\n'
    + '<script src="/boot.js"></script>\n'
    + '</body>\n</html>'
}

/* mountPanel(browser, opts) → 装配并挂载一个面板页。
 * opts: { seed(state) 自定义桩数据（在 createMockState 默认种子上改）、breakRpc 断桩演练、sessionId、viewport } */
async function mountPanel(browser, opts) {
  opts = opts || {}
  const state = createMockState()
  if (typeof opts.seed === 'function') opts.seed(state)
  const rpcCalls = []        /* 已应答的 RPC 序列（{method,args}）——「桩真接通」证据面 */
  const rpcAttempts = []     /* 全部尝试（breakRpc 下也记） */
  const cssText = fs.readFileSync(STYLES_CSS, 'utf8')
  const clientJs = fs.readFileSync(CLIENT_JS, 'utf8')
  const reactJs = fs.readFileSync(path.join(VENDOR_DIR, 'react.production.min.js'), 'utf8')
  const reactDomJs = fs.readFileSync(path.join(VENDOR_DIR, 'react-dom.production.min.js'), 'utf8')

  const context = await browser.newContext({ viewport: (opts && opts.viewport) || { width: 1440, height: 900 } })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + (e && e.message || e)))

  await page.route('**/*', (route) => {
    const req = route.request()
    let url
    try { url = new URL(req.url()) } catch (e) { return route.abort() }
    if (url.pathname === '/dsh-notes' && req.method() === 'POST') {
      let body = {}
      try { body = JSON.parse(req.postData() || '{}') } catch (e) { body = {} }
      rpcAttempts.push({ method: body.method || '', args: body.args })
      if (opts.breakRpc) return route.abort()
      rpcCalls.push({ method: body.method || '', args: body.args })
      /* notes-css 特判：server.cjs 对未知方法回 {ok:true} 会触发 client 端 10 次重试噪音，这里下发真样式 */
      if (body.method === 'notes-css') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ css: cssText }) })
      let out
      try { out = handleRpc(state, body.method, body.args) } catch (e) { out = { error: String(e && e.message || e) } }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(out) })
    }
    if (url.origin !== ORIGIN) return route.abort()   /* 任何外联请求一律断——harness 必须离线自洽 */
    switch (url.pathname) {
      case '/': case '/harness':
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: harnessHtml({ sessionId: opts.sessionId || 'sess-e2e-0001' }) })
      case '/vendor/react.js': return route.fulfill({ contentType: 'application/javascript', body: reactJs })
      case '/vendor/react-dom.js': return route.fulfill({ contentType: 'application/javascript', body: reactDomJs })
      case '/client.js': return route.fulfill({ contentType: 'application/javascript', body: clientJs })
      case '/boot.js': return route.fulfill({ contentType: 'application/javascript', body: BOOT_JS })
      case '/favicon.ico': return route.fulfill({ status: 204, body: '' })
      default: return route.fulfill({ status: 404, body: 'not found' })
    }
  })
  await page.goto(ORIGIN + '/harness', { waitUntil: 'load' })
  /* 装配就绪等待：ready=true 才算 harness 接通（ready='error' 立即带错上浮，防假绿） */
  const deadline = Date.now() + 15000
  for (;;) {
    const st = await page.evaluate(() => {
      const H = window.__panelHarness
      return { ready: H && H.ready, errors: H ? H.errors : ['no __panelHarness'], registered: H && H.registered }
    }).catch(e => ({ ready: false, errors: ['evaluate: ' + (e && e.message)] }))
    if (st.ready === true) break
    if (st.ready === 'error') throw new Error('panel-harness 装配失败：' + st.errors.join(' | '))
    if (Date.now() > deadline) throw new Error('panel-harness 装配超时：' + st.errors.join(' | '))
    await new Promise(r => setTimeout(r, 120))
  }

  /* 打开面板：走真机入口路径——点击会话头部「智能笔记」按钮（header 模式缺省入口），
   * 与用户在 DSH 壳内的开板动作同一代码路径（HeaderBtn onClick → panelOpen=true → notify → FloatingPanel） */
  async function openPanel() {
    await page.click('.dsh-notes-hdr-btn')
    await page.waitForSelector('.dsh-notes-floating', { timeout: 10000 })
  }

  return {
    page, context, state, rpcCalls, rpcAttempts, consoleErrors,
    openPanel,
    /* 桩接通自证数据：slots 注册面（用例断言 dsh-notes-panel 在册 = bundle 真装配） */
    registered: () => page.evaluate(() => window.__panelHarness.registered),
    harnessErrors: () => page.evaluate(() => window.__panelHarness.errors),
    close: () => context.close().catch(() => {}),
  }
}

module.exports = { mountPanel, ORIGIN }
