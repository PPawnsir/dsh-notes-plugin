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
    // 工作记忆 v0：args.includeLogs=true 时含 kind=log 日志（缺省排除——默认隐身；筛选中心 kind=日志 专入口由 client 传此参数）；
    // R-6：args.folder 显式给出（含 '' 未分类）时隐式含日志（_list effLogs 承接——显式文件夹导航放行，四个隐式表面隐身不变）
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
        return await _create(args.title, args.body, args.tags, args.topic, { kind: args.kind, status: args.status, inject: args.inject, injectRole: args.injectRole, injectTo: args.injectTo, folder: args.folder, recall: args.recall, sensitive: args.sensitive, logDate: args.logDate, entities: args.entities, summarizedAt: args.summarizedAt, contractType: args.contractType, origin: args.origin, schedule: args.schedule })
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // R-1：confirmClearBody 透传 _update 空正文覆盖兜底闸（body:'' 覆盖非空正文需显式确认，见 notes.dist.js empty-body-overwrite-guard 块）
    disposers.push(handle('notes-update', async (args) => {
      try {
        const ctErr = schedPublicContractTypeError(args && args.contractType)   // 定时派发：公共写入口 contractType 白名单（'' / dispatch-schedule）
        if (ctErr) return { error: ctErr }
        return await _update(args.id, args.title, args.body, args.tags, args.topic, args.kind, args.status, args.inject, args.injectTo, args.folder, args.recall, args.injectRole, args.sensitive, { logDate: args.logDate, entities: args.entities, summarizedAt: args.summarizedAt, contractType: args.contractType, origin: args.origin, schedule: args.schedule, confirmClearBody: args.confirmClearBody === true })
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

