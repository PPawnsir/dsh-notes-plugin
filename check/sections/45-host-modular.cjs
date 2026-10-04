// 节 45. P2·5 host 模块化收口（src/host/** 终态结构 + 双出口同源 + 序位/方向断言）
// 背景：P2·5 把 whole.js/dist-whole.js 余量续切为 server/dispatch/inject/memory/search/transfer/index 七域
// （inject/img-path-hint.js 与 search.js 双包逐字节一致 → 物理单份；其余六域双侧 .dist.js 变体登记）。
// 本节断言的是「结构契约」：序位锁定、共源/变体登记、命名域内容锚、webServer 零漂移、notes-src 死引用清零。
// 行为契约由既有各节看守（17 静态包全链路 / 22 目录注入 / 32 注入预览 / 33 整理建议 / 39 工作记忆 等），本节不重复。
module.exports = {
  id: "45",
  title: "45. P2·5 host 模块化收口（src/host/** 终态结构 + 双出口同源）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const {} = S
  section('45. P2·5 host 模块化收口（src/host/** 终态结构 + 双出口同源）')
  const HOST_DIR = path.join(DIR, 'src', 'host')
  const { parseManifest, MANIFEST_DEV_PATH, MANIFEST_DIST_PATH } = require(path.join(DIR, 'scripts', 'concat-host.cjs'))
  const devList = parseManifest(fsNative.readFileSync(MANIFEST_DEV_PATH, 'utf8'))
  const distList = parseManifest(fsNative.readFileSync(MANIFEST_DIST_PATH, 'utf8'))
  const read = (rel) => fsNative.readFileSync(path.join(HOST_DIR, rel), 'utf8').replace(/\r\n/g, '\n')

  await t('P2·5 序位锁定：双 manifest 尾部序 = server → inject/img-path-hint → dispatch → inject → memory → search → transfer → index', () => {
    const devTail = ['server.js', 'inject/img-path-hint.js', 'dispatch.js', 'inject.js', 'memory.js', 'search.js', 'transfer.js', 'index.js']
    const distTail = ['server.dist.js', 'inject/img-path-hint.js', 'dispatch.dist.js', 'inject.dist.js', 'memory.dist.js', 'search.js', 'transfer.dist.js', 'index.dist.js']
    assert.deepStrictEqual(devList.slice(-8), devTail, 'manifest.dev.js 尾部序（实得：' + devList.slice(-8).join(', ') + '）')
    assert.deepStrictEqual(distList.slice(-8), distTail, 'manifest.dist.js 尾部序（实得：' + distList.slice(-8).join(', ') + '）')
    // 双清单前段（P2·3/P2·4 域）同序同名（.dist.js 后缀映射）
    const devHead = devList.slice(0, -8)
    const distHead = distList.slice(0, -8).map(x => x === 'head.js' || x === 'apply-head.js' ? x : x.replace(/\.dist\.js$/, '.js'))
    assert.deepStrictEqual(distHead.filter(x => x !== 'head.js' && x !== 'apply-head.js'), devHead.filter(x => x !== 'kernel/head.js'), '双清单共有片同序同名（.dist.js 后缀映射）')
  })

  await t('whole.js / dist-whole.js 余量清零（磁盘与双清单均不存在）', () => {
    assert(!fsNative.existsSync(path.join(HOST_DIR, 'whole.js')), 'src/host/whole.js 应已删除')
    assert(!fsNative.existsSync(path.join(HOST_DIR, 'dist-whole.js')), 'src/host/dist-whole.js 应已删除')
    assert(devList.indexOf('whole.js') < 0 && distList.indexOf('dist-whole.js') < 0, '清单不再登记 whole/dist-whole')
    assert(hostSrc.indexOf('src/host/whole.js') < 0 && indexSrc.indexOf('dist-whole') < 0, '产物不再引用余量文件')
  })

  await t('共源片登记：inject/img-path-hint.js 与 search.js 双清单同名引用同一物理文件（无 .dist 变体）', () => {
    for (const rel of ['inject/img-path-hint.js', 'search.js']) {
      assert(devList.indexOf(rel) >= 0 && distList.indexOf(rel) >= 0, rel + ' 双清单同名引用')
      assert(!fsNative.existsSync(path.join(HOST_DIR, rel.replace('.js', '.dist.js'))), rel + ' 不得出现 .dist 变体（第三份拷贝红线）')
    }
  })

  await t('变体片登记：server/dispatch/inject/memory/transfer/index 六域双侧 .dist.js 成对存在且互不相同', () => {
    for (const stem of ['server', 'dispatch', 'inject', 'memory', 'transfer', 'index']) {
      const dev = read(stem + '.js'), dist = read(stem + '.dist.js')
      assert(devList.indexOf(stem + '.js') >= 0 && distList.indexOf(stem + '.dist.js') >= 0, stem + ' 双清单登记')
      assert(dev.length > 100 && dist.length > 100, stem + ' 变体片非空')
      assert(dev !== dist, stem + ' 双包内容应存在设计内差异（若已消差应改共源单份）')
    }
  })

  await t('命名域内容锚：inject.js=注入渲染+settings；memory.js=memory-guide+日志卫生+suggest；server.js=RPC 基础设施+notes-src；index.js=工具层+启动装配', () => {
    const inj = read('inject.js')
    assert(inj.indexOf('function conventionText(') >= 0 && inj.indexOf('function catalogText(') >= 0, 'inject.js 含注入渲染双函数')
    assert(inj.indexOf("handle('notes-settings-set'") >= 0 && inj.indexOf("handle('notes-settings-get'") >= 0, 'inject.js 含 settings-get/set')
    assert(inj.indexOf('systemPrompt.context(') >= 0 && inj.indexOf('order: 130') >= 0 && inj.indexOf('order: 131') >= 0, 'inject.js 含双注入注册（order 130/131）')
    const mem = read('memory.js')
    assert(mem.indexOf('MEMORY_GUIDE_BODY') >= 0 && mem.indexOf('function _memoryGuide(') >= 0, 'memory.js 含工作记忆引导')
    assert(mem.indexOf('function suggestLogHygiene(') >= 0 && mem.indexOf('function _suggest(') >= 0, 'memory.js 含日志卫生 + suggest')
    assert(mem.indexOf('async function _archive(') >= 0 && mem.indexOf("handle('notes-archive-undo'") >= 0, 'memory.js 含归档域（suggest 执行通道同源）')
    const srv = read('server.js')
    assert(srv.indexOf('function handle(name, fn)') >= 0 && srv.indexOf('perfStats') >= 0, 'server.js 含 handle/perf 基础设施')
    assert(srv.indexOf("handle('notes-src'") >= 0 && srv.indexOf("handle('notes-css'") >= 0, 'server.js 含 notes-src/notes-css 源下发')
    const idx = read('index.js')
    assert(idx.indexOf('function regTool(def)') >= 0 && idx.indexOf("name: 'note_manage'") >= 0, 'index.js 含工具层（3 工具）')
    assert(idx.indexOf('loadSettings()') >= 0 && idx.indexOf('ctx.effect(') >= 0, 'index.js 含启动装配收尾')
    const srvD = read('server.dist.js')
    assert(srvD.indexOf("path: RPC_PATH") >= 0 && srvD.indexOf("path: APP_PAGE_ROUTE") >= 0 && srvD.indexOf("path: ASSET_ROUTE") >= 0, 'server.dist.js 含 webServer 三路由注册')
    assert(srvD.indexOf("handle('notes-ping'") >= 0 && srvD.indexOf('ASSET_EXT_MIME') >= 0, 'server.dist.js 含 notes-ping + ASSET_EXT_MIME（随资产路由同模块）')
    const idxD = read('index.dist.js')
    assert(idxD.indexOf('migrateLegacyNotes') >= 0 && idxD.indexOf('fixLegacyWorkspaces') >= 0, 'index.dist.js 含一次性迁移与存量修补')
  })

  await t('webServer 路由零漂移：3 条 exact 路由全部且仅在 server.dist.js（开发版 server.js 零 webServer）', () => {
    const srvD = read('server.dist.js')
    const regs = srvD.match(/webServer\.register\(/g) || []
    assert.strictEqual(regs.length, 3, 'server.dist.js 应恰好 3 处 webServer.register（实得 ' + regs.length + '）')
    assert(srvD.indexOf("kind: 'exact'") >= 0, "路由 kind:'exact'")
    assert(read('server.js').indexOf('webServer') < 0, '开发版 server.js 不引用 webServer（harness 唯一通道）')
    // 行为级零变化由节 17（路由序/405/404/防穿越/immutable/HEAD）原样看守
  })

  await t('方向断言：跨模块引用序位（img-path-hint ≺ dispatch；dispatch ≺ inject/index；inject ≺ memory；核心域 ≺ server）', () => {
    // 序位 = 可见序（§8.4.2）：消费方必须晚于定义方。钉住关键跨模块依赖，防清单重排引入 TDZ/undefined。
    const pairs = [
      ['inject/sensitive-helpers.js', 'inject.js', 'maskSensitiveBody/Line → 注入渲染'],
      ['kernel/settings-store.js', 'inject.js', 'settingsCache/staleDaysLimit → 注入渲染与设置面'],
      ['inject/img-path-hint.js', 'dispatch.js', 'bodyHasImageRef/assetsHintLine → 派发消息'],
      ['dispatch.js', 'inject.js', '_activeSessions → notes-inject-preview 工作区视角'],
      ['inject.js', 'memory.js', 'conventionHit → memoryGuideActiveFor'],
      ['notes.js', 'server.js', 'CRUD 域 → 核心注册表'],
      ['folders.js', 'server.js', '_folders → notes-folders 注册'],
      ['history-trash/trash.js', 'server.js', 'history 三 RPC → 核心注册表'],
      ['llm/organize.js', 'server.js', '_aiOrganize → notes-ai-organize 注册'],
      ['memory.js', 'index.js', '_archive → note_manage.archive'],
      ['dispatch.js', 'index.js', '_dispatch/_activeSessions → note_manage.dispatch'],
      ['search.js', 'index.js', '_search → note_search'],
    ]
    for (const [def, use, why] of pairs) {
      const di = devList.indexOf(def), ui = devList.indexOf(use)
      assert(di >= 0 && ui > di, 'dev 序位违例：' + def + ' 须在 ' + use + ' 之前（' + why + '）')
      const defD = distList.indexOf(def.replace(/\.js$/, '.dist.js')) >= 0 ? def.replace(/\.js$/, '.dist.js') : def
      const useD = distList.indexOf(use.replace(/\.js$/, '.dist.js')) >= 0 ? use.replace(/\.js$/, '.dist.js') : use
      const dd = distList.indexOf(defD), ud = distList.indexOf(useD)
      assert(dd >= 0 && ud > dd, 'dist 序位违例：' + defD + ' 须在 ' + useD + ' 之前（' + why + '）')
    }
  })

  await t('notes-src 双出口同源：host 分支双 flavor 均按 src/host/manifest.dev.js 拼接（host-impl.js 死引用清零）', () => {
    assert(hostSrc.indexOf("PLUGIN_DIR + '\\\\src\\\\host-impl.js'") < 0, '开发版 notes-src 不再读 host-impl.js 死路径')
    assert(indexSrc.indexOf("path.join(LEGACY_PLUGIN_DIR, 'src', 'host-impl.js')") < 0, '发布版 notes-src 不再有 host-impl.js 候选')
    for (const [src, tag] of [[read('server.js'), 'server.js'], [read('server.dist.js'), 'server.dist.js']]) {
      assert(src.indexOf('manifest.dev.js') >= 0, tag + ' notes-src host 分支按 manifest.dev.js 拼接')
      assert(src.indexOf("match(/'[^'\\n]+'/g)") >= 0, tag + ' 沿用单引号清单纯文本解析（沙箱无 require）')
    }
  })
  }
}
