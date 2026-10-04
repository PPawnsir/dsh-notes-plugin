    // ---- 虚拟文件夹：~/.dsh/notes/folders.json 登记清单 [{id,name,order,parent?}]；parent=父文件夹 id（缺省=根级，存量数据无 parent 字段零迁移）；笔记 front-matter 的 folder 字段存文件夹 id（缺省 ''=未分类，向后兼容） ----
    // .json 后缀不进笔记列表（_list 只认 .md），与 settings.json 同理落在同目录天然不污染列表。
    const FOLDERS_PATH = path.join(NOTES_ROOT, 'folders.json')

    function genFolderId() {
      return 'f-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    }

    // 读文件夹清单：文件缺失/JSON 损坏/结构非法一律兜底为空数组（不抛错，笔记主流程不受 folders.json 影响）；
    // parent 仅真值落对象（缺省 undefined=根级，saveFolders JSON 序列化时 undefined 键自然省略，磁盘格式零迁移）
    async function loadFolders() {
      try {
        const ft = await fs.resolve(FOLDERS_PATH)
        const arr = JSON.parse(await fs.readText(ft))
        if (!Array.isArray(arr)) return []
        return arr.filter(f => f && f.id).map(f => { const o = { id: String(f.id), name: String(f.name || ''), order: typeof f.order === 'number' ? f.order : 0 }; if (f.parent) o.parent = String(f.parent); return o })
      } catch (e) { return [] }
    }

    async function saveFolders(list) {
      const ft = await fs.resolve(FOLDERS_PATH)
      await fs.writeText(ft, JSON.stringify(list, null, 2), undefined, undefined, getPolicy())
    }

    // ==== folder-tree-helpers BEGIN ====（本块纯函数集：全部数据经入参传入零闭包依赖，host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，check.js 提取本标记区间比对 + eval 单测；改动必须双边同步）
    // 文件夹嵌套（parent 字段）树形结构纯函数集。约定：根级文件夹深度=1，子级=父级深度+1。
    // 深度上限语义：maxDepth>0 时「挂载后子树最大深度 = folderDepth(parent) + 被挂子树高度」必须 ≤ maxDepth；maxDepth=0 不限。
    // 数据防御：parent 悬空（指向清单外 id）/ 存量 cycle 一律不抛错——visited 集合截断，按已遍历部分返回（损坏数据不拖垮主流程）。
    // folderDepth(id, folders)：沿 parent 链上溯计层数（根级=1；id 不在清单 → 0）
    function folderDepth(id, folders) {
      const byId = {}
      for (const f of folders) byId[f.id] = f
      let d = 0, cur = id
      const seen = {}
      while (cur && byId[cur] && !seen[cur]) { seen[cur] = true; d++; cur = byId[cur].parent }
      return d
    }
    // folderSubtreeIds(id, folders)：子树 id 集合（含自身 + 全部子孙），返回 {id:true} 映射（BFS 下行，cycle 防御）
    function folderSubtreeIds(id, folders) {
      const out = {}
      out[id] = true
      const queue = [id]
      while (queue.length) {
        const cur = queue.shift()
        for (const f of folders) if (f.parent === cur && !out[f.id]) { out[f.id] = true; queue.push(f.id) }
      }
      return out
    }
    // folderSubtreeHeight(id, folders)：子树高度（叶子=1，每深一层+1；cycle 防御 visited）
    function folderSubtreeHeight(id, folders, seen) {
      seen = seen || {}
      if (seen[id]) return 0
      seen[id] = true
      let h = 1
      for (const f of folders) if (f.parent === id) { const kh = folderSubtreeHeight(f.id, folders, seen) + 1; if (kh > h) h = kh }
      return h
    }
    // checkFolderAttach(folders, selfId, parentId, maxDepth)：挂载校验（create 新建 / reorder 拖父级共用）——
    //   parent 存在性 → cycle（selfId 非空时：parent 不得为自身或自身子孙）→ 深度上限（maxDepth=0 不限）。
    //   返回 null = 通过；否则返回中文错误串（RPC 前缀 op 名后直接透传）。
    function checkFolderAttach(folders, selfId, parentId, maxDepth) {
      if (!folders.some(function (x) { return x.id === parentId })) return '父文件夹不存在: ' + parentId
      if (selfId) {
        if (parentId === selfId) return '文件夹不能挂到自己下面'
        if (folderSubtreeIds(selfId, folders)[parentId]) return '文件夹不能挂到自己的子孙文件夹下面（cycle）'
      }
      if (maxDepth > 0) {
        const d = folderDepth(parentId, folders) + (selfId ? folderSubtreeHeight(selfId, folders) : 1)
        if (d > maxDepth) return '超过文件夹嵌套深度上限 maxFolderDepth=' + maxDepth + '（挂载后深度 ' + d + '；可在设置中调大或置 0 不限）'
      }
      return null
    }
    // ==== folder-tree-helpers END ====

    // 有效文件夹：folder 引用必须命中清单（清单损坏/外部改乱的笔记按未分类对待，保证计数与过滤口径一致）。
    // 嵌套语义：本函数只做直挂校验（返回笔记直挂的文件夹 id）；「归属子树」的递归解析由 folderSubtreeIds 承担
    // （_list 过滤 / _folders 计数 / cascade 删除 / 导出均走子树口径）。恢复的笔记若原文件夹已删除 → 此处兜底 '' 未分类。
    function effectiveFolder(note, folders) {
      const f = (note && note.folder) || ''
      if (!f) return ''
      return folders.some(x => x.id === f) ? f : ''
    }

    // 解析文件夹入参（工具层友好）：id 精确命中优先，其次按名称精确命中；'' = 未分类；找不到返回 null
    async function resolveFolderRef(ref) {
      const r = String(ref == null ? '' : ref).trim()
      if (!r) return { id: '', name: '' }
      const folders = await loadFolders()
      const byId = folders.find(x => x.id === r)
      if (byId) return { id: byId.id, name: byId.name }
      const byName = folders.find(x => x.name === r)
      if (byName) return { id: byName.id, name: byName.name }
      return null
    }

    // notes-folders RPC 核心：无参/op 缺省 = list（按 order 排序，含各文件夹计数 + unfiled 未分类计数 + parent/depth 嵌套字段供 UI 递归渲染）；
    // op = create(name,parent?)/rename/delete(id,cascade?)/reorder(ids,parents?)。
    // 计数口径：deleted 笔记由 _list 排除不计；folder 指向清单外 id 的笔记计入 unfiled；count 为**递归子树口径**（含全部子孙文件夹内笔记）。
    // 嵌套约束：create/reorder 拖父级时经 checkFolderAttach 校验（深度上限 maxFolderDepth 缺省 3 / 0 不限 + cycle 拒绝）。
    // delete 语义（级联必须显式传参）：缺省拒绝有子内容（子孙文件夹/子树笔记）的删除（needCascade 提示）；
    // cascade:true = 整棵子树文件夹删除（结构不可恢复）+ 其下全部笔记逐条软删（_delete 同通道，回收站可恢复；恢复后原文件夹已不存在 → effectiveFolder 兜底未分类）。
    async function _folders(args) {
      const a = args || {}
      const op = a.op || 'list'
      if (op === 'list') {
        const folders = await loadFolders()
        const all = await _list()
        const direct = {}
        let unfiled = 0
        for (const n of all) {
          const f = effectiveFolder(n, folders)
          if (!f) unfiled++
          else direct[f] = (direct[f] || 0) + 1
        }
        const list = folders.slice().sort((x, y) => x.order - y.order)
          .map(f => {
            // 子树口径计数：文件夹 count = 整棵子树（含自身 + 全部子孙文件夹）内笔记总数
            const sub = folderSubtreeIds(f.id, folders)
            let count = 0
            for (const sid in sub) count += direct[sid] || 0
            return { id: f.id, name: f.name, order: f.order, parent: f.parent || '', depth: folderDepth(f.id, folders), count: count }
          })
        return { folders: list, unfiled: unfiled }
      }
      if (op === 'create') {
        const name = String(a.name || '').trim()
        if (!name) return { error: 'notes-folders.create 需要 name' }
        const folders = await loadFolders()
        await loadSettings()   // 幂等（缓存 promise）：确保 maxFolderDepth 用户 override 已加载生效
        // 嵌套：parent 缺省=根级；显式传 parent 时校验存在性 + 深度上限（新建无 cycle 可能，selfId 传 null）
        let parent = ''
        if (a.parent) {
          parent = String(a.parent)
          const attachErr = checkFolderAttach(folders, null, parent, maxFolderDepthLimit())
          if (attachErr) return { error: 'notes-folders.create ' + attachErr }
        }
        const maxOrder = folders.reduce((m, f) => Math.max(m, f.order), -1)
        const folder = { id: genFolderId(), name: name, order: maxOrder + 1 }
        if (parent) folder.parent = parent
        folders.push(folder)
        await saveFolders(folders)
        return { ok: true, folder: folder }
      }
      if (op === 'rename') {
        if (!a.id) return { error: 'notes-folders.rename 需要 id' }
        const name = String(a.name || '').trim()
        if (!name) return { error: 'notes-folders.rename 需要 name' }
        const folders = await loadFolders()
        const f = folders.find(x => x.id === a.id)
        if (!f) return { error: '文件夹不存在: ' + a.id }
        f.name = name
        await saveFolders(folders)
        return { ok: true, id: a.id, name: name }
      }
      if (op === 'delete') {
        if (!a.id) return { error: 'notes-folders.delete 需要 id' }
        const folders = await loadFolders()
        const target = folders.find(x => x.id === a.id)
        if (!target) return { error: '文件夹不存在: ' + a.id }
        // 整棵子树（含自身 + 全部子孙文件夹）；子树内笔记含 kind=log 日志（治理路径显式召回，includeLogs=true）
        const subtree = folderSubtreeIds(a.id, folders)
        const childFolders = folders.filter(f => f.id !== a.id && subtree[f.id]).length
        const all = await _list(undefined, undefined, undefined, undefined, true)
        const notesInSubtree = all.filter(n => subtree[effectiveFolder(n, folders)])
        // 缺省拒绝有子内容的删除（cascade 必须显式传参）：返回统计供 confirm 明示
        if ((childFolders > 0 || notesInSubtree.length > 0) && a.cascade !== true) {
          return { error: 'notes-folders.delete 拒绝：文件夹「' + target.name + '」含子内容（子文件夹 ' + childFolders + ' 个 / 笔记 ' + notesInSubtree.length + ' 条），删除需显式传 cascade: true——文件夹结构整棵删除不可恢复，其下笔记软删除进回收站可恢复', needCascade: true, childFolders: childFolders, notes: notesInSubtree.length }
        }
        // cascade（或空文件夹直删）：其下全部笔记逐条软删（_delete 同通道，回收站可恢复）→ 整棵子树文件夹出清单
        let notesDeleted = 0
        for (const n of notesInSubtree) { await _delete(n.id); notesDeleted++ }
        await saveFolders(folders.filter(f => !subtree[f.id]))
        return { ok: true, id: a.id, folders: childFolders + 1, notes: notesDeleted }
      }
      if (op === 'reorder') {
        if (!Array.isArray(a.ids)) return { error: 'notes-folders.reorder 需要 ids 数组' }
        const ids = a.ids.map(String)
        const rank = {}
        ids.forEach((id, i) => { rank[id] = i })
        const folders = await loadFolders()
        // 拖父级改挂（可选）：parents 映射 {folderId: parentId|''}——逐个经 checkFolderAttach 校验（存在性/cycle/深度），
        // 校验与应用交错进行（每次应用后下一次校验看到最新树形，多步拖动组合安全）；''= 回根级（删除 parent 字段）
        if (a.parents && typeof a.parents === 'object') {
          await loadSettings()   // 幂等（缓存 promise）：确保 maxFolderDepth 用户 override 已加载生效
          const maxDepth = maxFolderDepthLimit()
          const byId = {}
          for (const f of folders) byId[f.id] = f
          for (const fid of Object.keys(a.parents)) {
            if (!byId[fid]) return { error: 'notes-folders.reorder 文件夹不存在: ' + fid }
            const np = a.parents[fid] ? String(a.parents[fid]) : ''
            if (np) {
              const attachErr = checkFolderAttach(folders, fid, np, maxDepth)
              if (attachErr) return { error: 'notes-folders.reorder ' + attachErr }
              byId[fid].parent = np
            } else delete byId[fid].parent
          }
        }
        // 入列的按 ids 顺序重排；未入列的保持原相对顺序追加尾部；最终 order 归一化为 0..n-1
        const inList = folders.filter(f => rank[f.id] !== undefined).sort((x, y) => rank[x.id] - rank[y.id])
        const outList = folders.filter(f => rank[f.id] === undefined).sort((x, y) => x.order - y.order)
        const merged = inList.concat(outList)
        merged.forEach((f, i) => { f.order = i })
        await saveFolders(merged)
        return { ok: true, folders: merged.map(f => ({ id: f.id, name: f.name, order: f.order, parent: f.parent || '' })) }
      }
      return { error: 'notes-folders: 未知 op：' + String(op) + '（期望 list/create/rename/delete/reorder）' }
    }

