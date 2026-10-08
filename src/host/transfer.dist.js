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
        // 0.4.8（notes-048-topic-tag-merge）：导出标签档吃 effTags 口径（tags ∪ topic 读侧虚拟合并）——存量仅 topic 命中的笔记不成孤儿；
        // sys 机器笔记放行口径同旧 _list(tag) 通道（tag 过滤非缺省降噪面）
        const tgv048 = String(scope.tag).trim()
        notes = (await _list(undefined, undefined, undefined, undefined, undefined, true)).filter(function (n) { return effTagsOf(n).indexOf(tgv048) >= 0 })
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
