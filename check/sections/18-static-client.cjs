// 节 18. P3 静态包 client（packages/dsh-notes/lib/client.js）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "18",
  title: "18. P3 静态包 client（packages/dsh-notes/lib/client.js）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { ctx, g, plugin } = S
  // ===== 18. P3 静态包 client（packages/dsh-notes/lib/client.js） =====
  // 开发版 client-impl.js 仍是「动态插件」形态（全局 React/styles/host + styles.insert），
  // 发布版 lib/client.js 是机械转换产物：require('react') + fetch('/dsh-notes') + <style> 注入。
  // 本节验证发布包自身的形态与功能面，不改动上面针对开发版的既有断言。
  section('18. P3 静态包 client（packages/dsh-notes/lib/client.js）')
  const CLIENT_PATH = path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js')
  const clientPkgSrc = fsNative.readFileSync(CLIENT_PATH, 'utf8')
  // 注释剥离：避免文档性注释里的字符串影响"无残留"判定
  const clientPkgCode = clientPkgSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  // --- P3 测试脚手架：在 Node 里以浏览器模拟方式加载发布版 client 包 ---
  // client.js 是「CJS 工厂 + __ModuleLoader__.load」，不是 ESM，所以用 new Function 执行并捕获
  // 模块加载器登记项，再用可替换的 createElement 构建一次真实 React 元素树（无 JSX）。
  function makeMockReact(onCreateElement) {
    return {
      createElement: function (type, props) {
        const children = Array.prototype.slice.call(arguments, 2)
        if (onCreateElement) onCreateElement(type, props, children)
        return { $$typeof: Symbol.for('react.element'), type: type, props: props || {}, children: children }
      },
      useState: function (init) { return [typeof init === 'function' ? init() : init, function () {}] },
      useEffect: function (fn) { try { const d = fn(); if (typeof d === 'function') d() } catch (e) {} },
      useRef: function (init) { return { current: init } },
      Fragment: Symbol.for('react.fragment')
    }
  }
  // 最小 document 模拟：样式注入路径会用到 createElement('style') / head.append
  function makeMockDocument() {
    return {
      createElement: function () { return { dataset: {}, textContent: '', remove: function () {} } },
      head: { append: function () {} },
      addEventListener: function () {}, removeEventListener: function () {},
      querySelector: function () { return null }
    }
  }
  // 加载发布包并执行 apply。
  // services：{ slots, timer, sessions, workspaces }——键**缺失**=用内置 mock，显式传 null=该服务不可用（走守卫分支）。
  // opts：{ react, fetch } 覆盖 React mock 与 fetch mock。
  function loadClientPackage(services, opts) {
    const svc = services || {}
    const o = opts || {}
    const ReactMock = o.react || makeMockReact()
    const slots = {
      injections: [],
      registered: [],
      disposed: 0,
      inject: function (name, fn) {
        slots.injections.push(name)
        fn()
        return function () { slots.disposed++ }
      },
      register: function (def, render) { slots.registered.push({ id: def.id, render: render }) }
    }
    const timer = {
      interval: function () { return function () {} },
      timeout: function () { return function () {} },
      debounce: function (fn) { return Object.assign(function () { return fn() }, { dispose: function () {} }) }
    }
    // 默认 fetch mock 返回真实 CSS，让「fetch CSS → <style> 注入」完整路径被跑到
    const fetchMock = o.fetch || function () {
      return Promise.resolve({ json: function () { return Promise.resolve({ css: '.dsh-notes-mock{}' }) } })
    }
    const effects = []
    const ctx = {
      get: function (name) {
        if (name === 'slots') return ('slots' in svc) ? (svc.slots || undefined) : slots
        if (name === 'timer') return ('timer' in svc) ? (svc.timer || undefined) : timer
        if (name === 'sessions') return svc.sessions
        if (name === 'workspaces') return svc.workspaces
        return undefined
      },
      effect: function (fn) { effects.push(fn); return function () {} }
    }
    let captured = null
    const prevWindow = global.window
    const prevFetch = global.fetch
    global.window = {
      __ModuleLoader__: { load: function (def) { captured = def } },
      addEventListener: function () {}, removeEventListener: function () {}, innerWidth: 1280, innerHeight: 800
    }
    global.fetch = fetchMock
    let moduleExports = null
    try {
      // eslint-disable-next-line no-new-func
      new Function('window', 'document', 'fetch', 'console', clientPkgSrc)(
        global.window, makeMockDocument(), fetchMock, console
      )
      if (!captured) throw new Error('未捕获 __ModuleLoader__.load 登记项')
      assert.strictEqual(captured.id, 'dsh-notes-plugin', 'load id 必须是 dsh-notes-plugin')
      moduleExports = captured.factory(function (name) {
        if (name === 'react') return ReactMock
        throw new Error('unknown require: ' + name)
      })
    } finally {
      if (prevWindow === undefined) delete global.window; else global.window = prevWindow
      if (prevFetch === undefined) delete global.fetch; else global.fetch = prevFetch
    }
    if (!moduleExports || typeof moduleExports.apply !== 'function') throw new Error('factory 未返回 { apply }')
    moduleExports.apply(ctx)
    return {
      module: moduleExports,
      slots: slots,
      applied: slots.injections.length > 0,
      effects: effects,
      effectsCleaned: 0,
      cleanup: function () {
        for (const fn of effects) {
          try { const d = fn(); if (typeof d === 'function') d() } catch (e) {}
        }
        this.effectsCleaned = effects.length
      }
    }
  }

  await t('lib/client.js 存在且是 __ModuleLoader__ CJS 工厂形态', () => {
    assert(clientPkgSrc.indexOf('window.__ModuleLoader__.load(') >= 0, 'window.__ModuleLoader__.load(...) 包装')
    assert(/id:\s*'dsh-notes-plugin'/.test(clientPkgSrc), "id: 'dsh-notes-plugin'")
    assert(/factory:\s*\(require\)\s*=>/.test(clientPkgSrc), 'factory: (require) =>')
    assert(clientPkgSrc.indexOf('return module.exports') >= 0, 'return module.exports')
    assert(clientPkgSrc.indexOf('new Function') < 0, '发布包不应再用 new Function 引导壳')
  })
  await t('lib/client.js 用 require(\'react\') 取 React（无全局 React 依赖）', () => {
    assert(/const React = require\('react'\)/.test(clientPkgSrc), "const React = require('react')")
    assert(/const e = React\.createElement/.test(clientPkgSrc), 'e = React.createElement 保留')
    assert(!/typeof React !== 'undefined'/.test(clientPkgCode), '不应再靠全局 React 兜底')
  })
  await t('lib/client.js RPC 走 fetch(\'/dsh-notes\')（与 index.mjs RPC_PATH 一致）', () => {
    assert(clientPkgCode.indexOf("fetch('/dsh-notes'") >= 0, "fetch('/dsh-notes')")
    assert(/method:\s*'POST'/.test(clientPkgCode), "method: 'POST'")
    assert(/Content-Type':\s*'application\/json'/.test(clientPkgCode), 'JSON Content-Type')
    assert(/JSON\.stringify\(\{\s*method:\s*method,\s*args:\s*args\s*\|\|\s*\{\}\s*\}\)/.test(clientPkgCode), 'body = {method, args}')
    assert(clientPkgCode.indexOf('rpc(') >= 0, 'rpc helper 已注入')
    assert(!/host\.call\s*\(/.test(clientPkgCode), '代码中无 host.call( 残留')
  })
  await t('lib/client.js 样式用 document.createElement(\'style\') 注入（无 styles.insert）', () => {
    assert(clientPkgCode.indexOf("document.createElement('style')") >= 0, "document.createElement('style')")
    assert(clientPkgCode.indexOf('notes-css') >= 0, 'notes-css RPC 取 CSS')
    assert(/document\.head\.append\(/.test(clientPkgCode), '注入 document.head')
    assert(!/styles\.insert\s*\(/.test(clientPkgCode), '代码中无 styles.insert( 残留')
  })
  await t('lib/client.js 定时器走 ctx.get(\'timer\') + ctx.effect（无 ctx.interval 快捷方式）', () => {
    assert(/const timer = ctx\.get\('timer'\)/.test(clientPkgSrc), "timer = ctx.get('timer')")
    assert(/ctx\.effect\(function \(\) \{ return pd \}\)/.test(clientPkgSrc), 'perf 定时器经 ctx.effect 注册清理')
    assert(/disposers\.push\(function \(\) \{ try \{ tag\.remove\(\) \}/.test(clientPkgSrc), 'style 标签有移除 disposer')
    assert(!/\bctx\.(interval|timeout|debounce)\s*\(/.test(clientPkgCode), '无 ctx.interval/timeout/debounce 快捷方式')
    assert(!/ctx\.timer\b/.test(clientPkgCode), '无 ctx.timer 直接访问')
  })
  await t('lib/client.js 服务获取全部 ctx.get + 守卫（inject 只声明 slots）', () => {
    assert(/inject:\s*\['slots',\s*'timer',\s*'sessions',\s*'workspaces'\]/.test(clientPkgSrc), "module.exports.inject 应声明 apply 用到的全部服务（slots/timer/sessions/workspaces，保证就绪后才 apply）")
    assert(/const sessions = ctx\.get\('sessions'\)/.test(clientPkgSrc), 'sessions 经 ctx.get')
    assert(/const workspaces = ctx\.get\('workspaces'\)/.test(clientPkgSrc), 'workspaces 经 ctx.get')
    assert(!/ctx\.sessions\b/.test(clientPkgCode) && !/ctx\.workspaces\b/.test(clientPkgCode), '无 ctx.sessions / ctx.workspaces 直接属性访问')
    assert(clientPkgSrc.indexOf('if (!slots)') >= 0 && clientPkgSrc.indexOf('if (!timer)') >= 0, 'slots / timer 存在性守卫')
    // 服务缺失时优雅退出而不是抛错
    const modNoSlots = loadClientPackage({ slots: undefined })
    assert.strictEqual(modNoSlots.applied, false, 'slots 缺失时 apply 直接返回')
    const modNoTimer = loadClientPackage({ slots: {}, timer: undefined })
    assert.strictEqual(modNoTimer.applied, false, 'timer 缺失时 apply 直接返回')
  })
  await t('lib/client.js 功能面完整（UI v2 全保留）', () => {
    const need = [
      'conversation.session.header.actions', 'shell.overlay',      // 三个 Slot 注册点
      'dsh-notes-hdr-btn', 'dsh-notes-fab', 'dsh-notes-floating',  // 头部按钮 / 悬浮气泡 / 浮窗面板
      'dsh-notes-titlebar', 'dsh-notes-app', 'dsh-notes-side', 'dsh-notes-quick-input',
      'dsh-notes-fchip', 'dsh-notes-sec-h', 'dsh-notes-folder-row', 'dsh-notes-note-row',
      'dsh-notes-nested', 'dsh-notes-fbadge', 'dsh-notes-topic-row', 'dsh-notes-side-foot',
      'dsh-notes-ed', 'dsh-notes-ed-crumb', 'dsh-notes-ed-title', 'dsh-notes-ed-meta',
      'dsh-notes-meta-chip', 'dsh-notes-meta-act', 'dsh-notes-ed-body', 'dsh-notes-ed-foot',
      'dsh-notes-settings-modal', 'dsh-notes-scope-panel', 'dsh-notes-dispatch-modal',
      'dsh-notes-dispatch-history', 'dsh-notes-cap', 'dsh-notes-toast',
      'dsh-notes-resize-handle', 'dsh-notes-empty-state'
    ]
    const missing = need.filter(x => clientPkgSrc.indexOf(x) < 0)
    assert.strictEqual(missing.length, 0, '缺少 UI 标记：' + JSON.stringify(missing))
    // v2 旧三栏/旧浮层标记清零
    for (const gone of ['dsh-notes-list', 'dsh-notes-divider', 'dsh-note-item', 'dsh-notes-instruct-box', 'dsh-notes-topic-header', 'dsh-notes-kind-chip', 'dsh-notes-pin-toggle']) {
      assert(clientPkgSrc.indexOf(gone) < 0, '发布包仍含旧 UI 标记：' + gone)
    }
    // RPC 方法面（与 index.mjs 的 handler 名一致）
    const rpcs = ['notes-css', 'notes-list', 'notes-get', 'notes-create', 'notes-sessions', 'notes-search', 'notes-quick', 'notes-quick-instruct', 'notes-update', 'notes-delete', 'notes-restore', 'notes-purge', 'notes-folders', 'notes-active-sessions', 'notes-workspaces', 'notes-dispatch', 'notes-dispatch-done', 'notes-archive', 'notes-archive-preview', 'notes-archive-undo', 'notes-perf', 'notes-settings-get', 'notes-settings-set', 'notes-export', 'notes-export-single', 'notes-import-preview', 'notes-import', 'notes-asset-upload', 'notes-inject-preview', 'notes-suggest', 'notes-history', 'notes-history-get', 'notes-restore-history']
    const missRpc = rpcs.filter(x => clientPkgSrc.indexOf(x) < 0)
    assert.strictEqual(missRpc.length, 0, '缺少 RPC 调用：' + JSON.stringify(missRpc))
    // 交互能力：拖拽 / 快捷键 / 自动保存 / 入口双模式 / 性能遥测 / SVG 图标 helper
    for (const k of ['drag(', 'keydown', 'dsh-notes-entry', 'dsh-notes-panel-state', 'connectWorkspace', '__dshNotesPerf', 'PerformanceObserver', 'localStorage', 'function I(name, size, cls)']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '缺少能力：' + k)
    }
  })
  await t('lib/client.js React 树可构建（createElement 递归渲染，无 JSX）', () => {
    let elCount = 0
    const mockReact = makeMockReact(() => { elCount++ })
    const loaded = loadClientPackage({}, { react: mockReact })
    assert.strictEqual(loaded.applied, true, 'apply 应执行到结束（slots/timer 就绪）')
    assert.strictEqual(loaded.module.name, 'dsh-notes-plugin', 'name = dsh-notes-plugin')
    assert.deepStrictEqual(loaded.module.inject, ['slots', 'timer', 'sessions', 'workspaces'], "inject = ['slots','timer','sessions','workspaces']")
    // 4 个 Slot 注入点（header / fab / panel / selection）
    assert.strictEqual(loaded.slots.injections.length, 4, '应注册 4 个 Slot 注入点（实得 ' + loaded.slots.injections.length + '）')
    assert.deepStrictEqual(loaded.slots.registered.map(r => r.id).sort(), ['dsh-notes-btn', 'dsh-notes-fab', 'dsh-notes-panel', 'dsh-notes-selection'], '4 个注册 id')
    // 渲染 HeaderBtn：React.createElement 树必须能构建（含 hook 调用）
    const headerRegister = loaded.slots.registered.find(r => r.id === 'dsh-notes-btn')
    const tree = headerRegister.render({ sessionId: 'session-abcdefgh-0000' })
    assert(tree && tree.type, 'HeaderBtn 渲染出元素树')
    assert(elCount > 0, 'createElement 被调用（实得 ' + elCount + '）')
    // 卸载：fiber effect cleanup 应把 4 个 slots.inject 全部释放
    assert.strictEqual(loaded.slots.disposed, 0, '卸载前未释放')
    loaded.cleanup()
    assert.strictEqual(loaded.slots.disposed, 4, '卸载时释放 4 个 slots.inject（实得 ' + loaded.slots.disposed + '）')
    assert(loaded.effectsCleaned >= 1, 'ctx.effect 清理执行（实得 ' + loaded.effectsCleaned + '）')
  })
  await t('lib/client.js 快速记录卡片 v2（复制按钮 + primary 样式类）', () => {
    assert(clientPkgSrc.indexOf('dsh-notes-cap-acts') >= 0, '卡片按钮行容器存在')
    assert(clientPkgSrc.indexOf('复制') >= 0, '卡片含复制按钮')
    assert(/dsh-notes-cbtn primary/.test(clientPkgSrc), 'primary 按钮样式类存在')
    assert(/copySelection/.test(clientPkgSrc), 'copySelection 复制处理函数存在')
    assert(clientPkgSrc.indexOf('navigator.clipboard') >= 0, '优先 navigator.clipboard.writeText')
    assert(clientPkgSrc.indexOf('execCommand') >= 0, '降级 execCommand 兜底')
    assert(/dispatchHistoryOpen/.test(clientPkgSrc) && clientPkgSrc.indexOf("dispatchHistoryOpen ? ' open' : ' collapsed'") >= 0, '静态包含派发历史折叠态（dispatchHistoryOpen + collapsed class）')
  })
  await t('lib/client.js 是 scripts/build-dist.cjs 的产物且可复现', () => {
    assert(fsNative.existsSync(path.join(DIR, 'scripts', 'build-dist.cjs')), 'build-dist.cjs 存在')
    assert(/build-dist\.cjs/.test(clientPkgSrc), '产物头部标注了构建来源')
    const buildSrc = fsNative.readFileSync(path.join(DIR, 'scripts', 'build-dist.cjs'), 'utf8')
    assert(/RPC_PATH = '\/dsh-notes'/.test(buildSrc), 'build 脚本 RPC 路径与 host 的 RPC_PATH 一致')
    assert((buildSrc.match(/counts\[/g) || []).length >= 4, 'build 带转换计数断言（漏改会中止而不是产出坏包）')
  })
  Object.assign(S, { clientPkgSrc })
  }
}
