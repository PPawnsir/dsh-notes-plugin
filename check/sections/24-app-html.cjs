// 节 24. 半独立笔记页 /dsh-notes-app（app.html v2 定稿改造 + webServer GET 路由）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "24",
  title: "24. 半独立笔记页 /dsh-notes-app（app.html v2 定稿改造 + webServer GET 路由）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { plugin } = S
  // ===== 24. 半独立全窗口笔记页 /dsh-notes-app（app.html + 页面路由，静态断言） =====
  section('24. 半独立笔记页 /dsh-notes-app（app.html v2 定稿改造 + webServer GET 路由）')
  const APP_HTML_PATH = path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html')
  await t('app.html 存在且非空', () => {
    assert(fsNative.existsSync(APP_HTML_PATH), APP_HTML_PATH + ' 必须存在')
    assert(fsNative.readFileSync(APP_HTML_PATH, 'utf8').length > 5000, 'app.html 应是完整页面（>5KB）')
  })
  const appSrc = fsNative.readFileSync(APP_HTML_PATH, 'utf8')
  await t('app.html 是 scripts/concat-app.cjs 的产物且可复现（src/app/** + src/shared 逐字节拼接）', () => {
    // architecture-modular.md §4.1 app 出口：app.html 由 src/app/** 按 manifest 逐字节拼接生成（写盘提交，本断言读产物兜底防忘跑）
    const { concatApp } = require(path.join(DIR, 'scripts', 'concat-app.cjs'))
    assert.strictEqual(concatApp(), appSrc.replace(/\r\n/g, '\n'), 'app.html 与 src/app/** 拼接产物不一致（改 src/app/** 后需跑 node scripts/concat-app.cjs 或 build-dist.cjs）')
  })
  await t('app.html 页面标识：title=dsh-notes + 全窗口布局 + 主题 token', () => {
    assert(appSrc.indexOf('<title>dsh-notes</title>') >= 0, '<title>dsh-notes</title>')
    assert(appSrc.indexOf('data-theme="dark"') >= 0 && appSrc.indexOf('html[data-theme="light"]') >= 0, '暗/明双主题 token 保留')
    assert(appSrc.indexOf('class="app"') >= 0 && appSrc.indexOf('class="side"') >= 0 && appSrc.indexOf('class="topbar"') >= 0, '全窗口两栏布局（topbar + side + ed）')
    assert(appSrc.indexOf('--kind-decision') >= 0 && appSrc.indexOf('--nacc') >= 0, 'DSH token 配色保留')
  })
  await t('app.html 数据层：fetch /dsh-notes POST {method,args}，无原型 mock 残留', () => {
    assert(appSrc.indexOf("fetch('/dsh-notes'") >= 0, "rpc() 应 fetch('/dsh-notes')")
    assert(/method:\s*'POST'/.test(appSrc), 'POST 方法')
    assert(appSrc.indexOf('JSON.stringify({ method: method, args: args || {} })') >= 0, 'payload 形态 {method,args}')
    assert(appSrc.indexOf("var notes=[{id:'n1'") < 0 && appSrc.indexOf('原型示意') < 0, '不得残留 v2 原型 mock 数据/占位')
    assert(appSrc.indexOf('__ModuleLoader__') < 0 && appSrc.indexOf("require('react')") < 0, '页面不依赖 client bundle/React')
  })
  await t('app.html 复用全部现有 RPC（list/get/create/update/delete/restore/folders/search/quick/quick-instruct/settings/import-export/dispatch/sessions/asset-upload）', () => {
    const need = ['notes-list', 'notes-get', 'notes-get-batch', 'notes-create', 'notes-update', 'notes-delete', 'notes-restore', 'notes-purge', 'notes-folders', 'notes-search', 'notes-quick', 'notes-quick-instruct', 'notes-settings-get', 'notes-settings-set', 'notes-export', 'notes-import-preview', 'notes-import', 'notes-active-sessions', 'notes-dispatch', 'notes-dispatch-done', 'notes-sessions', 'notes-asset-upload', 'notes-archive', 'notes-archive-preview', 'notes-archive-undo', 'notes-inject-preview', 'notes-suggest']
    for (const m of need) assert(appSrc.indexOf("'" + m + "'") >= 0, '页面应调用 RPC：' + m)
    assert(/setTimeout\(pullSessions,\s*1500\)/.test(appSrc) || appSrc.indexOf('1500') >= 0, 'titlesPending 1.5s 重拉契约')
  })
  await t('app.html 关键交互结构：树/编辑器/快速记录卡片/派发对话框/设置/导入导出/注入范围浮层', () => {
    for (const k of ['id="tree"', 'id="q"', 'id="filterbar"', 'id="fchips"', 'id="fpop"', 'id="btnSort"', 'id="capHost"', 'id="modalHost"', 'id="toast"', 'id="btnNew"', 'id="btnTrash"', 'id="btnSelMode"', 'id="btnSettings"']) assert(appSrc.indexOf(k) >= 0, '静态结构缺：' + k)
    assert(appSrc.indexOf('id="btnExport"') < 0 && appSrc.indexOf('id="btnImport"') < 0 && appSrc.indexOf('id="btnSuggest"') < 0, '底部 导出/导入/整理 按钮已移除（收敛进设置卡片）')
    for (const k of ['ed-title', 'ed-main', 'ed-meta', 'ed-crumb', 'scope-panel', 'disp-sess', 'disp-todo', 'imp-list', 'set-row', 'cap-in', 'note-row', 'nested']) assert(appSrc.indexOf(k) >= 0, '样式/动态结构缺：' + k)
    assert(appSrc.indexOf('contenteditable="true"') >= 0, '标题/正文 contenteditable 编辑')
    assert(appSrc.indexOf('localStorage') >= 0 && appSrc.indexOf('dsh-notes-app-foldopen') >= 0, '折叠态 localStorage 持久化')
    assert(appSrc.indexOf('dsh-notes-panel-state') < 0, '不做面板位置持久化（全窗口页面）')
  })
  await t('app.html 页面特化：来源会话降级 toast + 快速记录传空 sessionId/cwd + 返回 DSH 入口', () => {
    assert(appSrc.indexOf('请回 DSH 主界面打开') >= 0, '来源会话点击降级为 toast 提示回 DSH')
    assert(appSrc.indexOf("sessionId: '', cwd: ''") >= 0, 'notes-quick / notes-quick-instruct 传空会话上下文（host 兜底标题）')
    assert(appSrc.indexOf('href="/"') >= 0, '顶栏返回 DSH 主界面入口')
    assert(appSrc.indexOf('connectWorkspace') < 0, '页面无 workspaces 服务，不做新建会话派发')
  })
  await t('app.html 内联脚本语法可解析（new Function 编译级校验）', () => {
    const m = appSrc.match(/<script>([\s\S]*?)<\/script>/)
    assert(m && m[1].length > 3000, '应含主脚本块')
    new Function(m[1])   // 仅编译不执行：语法错误在此抛出
  })
  await t('原型同步（DEVELOPMENT.md UI 约定）：notes-ui-v2.html 与 app.html 共享同一套 UI/交互，仅数据层不同', () => {
    const PROTO_PATH = path.join(DIR, 'design', 'notes-ui-v2.html')
    assert(fsNative.existsSync(PROTO_PATH), 'design/notes-ui-v2.html 存在')
    const protoSrc = fsNative.readFileSync(PROTO_PATH, 'utf8')
    // 关键 UI 标记两边一致（topbar/side/ed/modal/scope/cap/disp/ctxmenu）
    for (const k of ['class="topbar"', 'class="side"', 'class="ed empty"', 'scope-panel', 'disp-sess', 'disp-todo', 'imp-list', 'set-row', 'cap-in', 'ctxmenu', 'note-row', 'id="tree"', 'id="modalHost"']) {
      assert(protoSrc.indexOf(k) >= 0, '原型缺 UI 标记：' + k)
      assert(appSrc.indexOf(k) >= 0, 'app.html 缺 UI 标记：' + k)
    }
    // 同一 rpc(method,args) 接口形态；原型为内存 mock，页面为 fetch('/dsh-notes')
    assert(/function rpc\(method, args\)/.test(protoSrc) && /function rpc\(method, args\)/.test(appSrc), '两边同 rpc(method,args) 接口')
    assert(protoSrc.indexOf('_mockRpc') >= 0, '原型数据层为内存 mock（_mockRpc）')
    assert(!/function rpc\(method, args\) \{\s*return fetch\(/.test(protoSrc), '原型 rpc 函数体不走 fetch（注释提及不算）')
    assert(protoSrc.indexOf('唯一规格来源') >= 0, '原型头部注释声明同步约定')
    // 注入范围浮层重构同步：去「本工作区/全局」选项（缺省=所有会话）+ 顶部默认提示行（app.html 与原型一致）
    for (const pair of [['app.html', appSrc], ['原型', protoSrc]]) {
      assert(pair[1].indexOf('data-scope="workspace"') < 0 && pair[1].indexOf('data-scope="global"') < 0, pair[0] + ' 范围浮层移除「本工作区/全局」选项（缺省=所有会话）')
      /* i18n 覆盖卡B：app 端 scope 提示行/injectScopeLabel 走 t() 字典；原型不双语红线保持静态中文（分侧断言） */
      if (pair[0] === 'app.html') {
        assert(pair[1].indexOf('class="scope-hint"') >= 0 && pair[1].indexOf("t('meta.scopeHint')") >= 0, pair[0] + ' 范围浮层顶部默认提示行走 t()（覆盖卡B）')
        assert(pair[1].indexOf("return t('meta.scopeAll')") >= 0, pair[0] + ' injectScopeLabel 缺省走 t()（覆盖卡B）')
      } else {
        assert(pair[1].indexOf('class="scope-hint"') >= 0 && pair[1].indexOf('默认注入到所有会话；勾选会话则仅限这些会话') >= 0, pair[0] + ' 范围浮层顶部默认提示行')
        assert(pair[1].indexOf("return '所有会话'") >= 0, pair[0] + ' injectScopeLabel 缺省=所有会话')
      }
      assert(pair[1].indexOf('.scope-hint{') >= 0, pair[0] + ' scope-hint 样式（var(--nt3) 灰字）')
    }
    const pm = protoSrc.match(/<script>([\s\S]*?)<\/script>/)
    assert(pm && pm[1].length > 3000, '原型含主脚本块')
    new Function(pm[1])   // 编译级校验
  })
  await t('index.mjs 注册 GET /dsh-notes-app 页面路由（exact + app.html 读盘 + text/html）', () => {
    assert(indexSrc.indexOf("APP_PAGE_ROUTE = '/dsh-notes-app'") >= 0, "页面路由常量 '/dsh-notes-app'")
    assert(indexSrc.indexOf("path.join(PKG_DIR, 'app.html')") >= 0, 'app.html 以 import.meta.url 锚定的包内路径读取')
    assert(/path:\s*APP_PAGE_ROUTE/.test(indexSrc), 'webServer.register 消费 APP_PAGE_ROUTE')
    assert(indexSrc.indexOf('text/html; charset=utf-8') >= 0, '响应 Content-Type: text/html; charset=utf-8')
    assert(indexSrc.indexOf("req.method !== 'GET' && req.method !== 'HEAD'") >= 0, '仅 GET/HEAD，其余 405')
    assert(indexSrc.indexOf('notes-app') >= 0, '启动日志含页面路由')
  })
  await t('index.mjs 注册 GET /dsh-notes/asset 资产路由（防穿越 + 白名单 mime + immutable + base64 解码下发）', () => {
    assert(indexSrc.indexOf("ASSET_ROUTE = '/dsh-notes/asset'") >= 0, "资产路由常量 '/dsh-notes/asset'")
    assert(/path:\s*ASSET_ROUTE/.test(indexSrc), 'webServer.register 消费 ASSET_ROUTE（exact，重复注册会 throw 故仅一次 + disposer 登记）')
    assert(indexSrc.indexOf('disposers.push(webServer.register') >= 0, '资产路由 disposer 登记')
    assert(indexSrc.indexOf('ASSET_EXT_MIME') >= 0 && indexSrc.indexOf("'.png': 'image/png'") >= 0 && indexSrc.indexOf("'.webp': 'image/webp'") >= 0, '扩展名 → mime 白名单映射')
    assert(indexSrc.indexOf('public, max-age=31536000, immutable') >= 0, 'Cache-Control immutable（文件名含时间戳不重复）')
    assert(indexSrc.indexOf("Buffer.from(") >= 0 && indexSrc.indexOf("'base64'") >= 0, 'base64 文本解码为二进制下发')
    assert(indexSrc.indexOf("parts[0] !== 'assets'") >= 0 && indexSrc.indexOf('path.dirname(abs) !== assetsRoot') >= 0, '两段式形态校验 + path.dirname 复核防穿越')
    assert(indexSrc.indexOf('readBody(req, 12 * 1024 * 1024)') >= 0, 'RPC 兜底路由 body 上限提到 12MB（装 5MB 图的 base64 JSON）')
    assert(/, asset =', ASSET_ROUTE\)/.test(indexSrc), '启动日志含资产路由')
    assert(hostSrc.indexOf('webServer.register') < 0, '开发版不注册 HTTP 路由（避免与静态包同载 duplicate throw；与 /dsh-notes 既有架构一致）')
  })
  Object.assign(S, { appSrc })
  }
}
