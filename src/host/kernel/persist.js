    // 0.4.3 存储加固（notes-043-atomic-store）·存储层语义声明：
    //   ①原子性——本插件全部笔记写路径统一收口 persistNote → fs.writeText；DSH fs 服务的 writeText 底层即
    //     writeFileAtomic（staging 目录 + temp 文件 + fsync + rename 发布，按目标路径 targetKey 加锁），
    //     单次写入对崩溃半写天然免疫（崩溃只会留下完整旧版或完整新版，无中间字节）——插件层不再叠加 tmp+rename。
    //   ②常驻——cache 为常驻内存权威：所有写入同步缓存（写后缓存即盘上字节的同口径重建源，历史快照/列表共用），
    //     外部新增文件仅在 list 懒加载；跨 apply 生命周期由磁盘文件恢复，墓碑（deleted:true）落盘后重载不复活。
    //   ③串行化——per-note 写链：同笔记并发 persistNote 读-改-写竞态（两异步流程同时 rootNoteAppend 丢行不报错）
    //     由 _persistChains[id] 串行消除；跨笔记仍并行。失败不断链（catch 吞尾），错误原样抛给调用方。
    //   ④事件分发（0.4.3+ notes-043-event-bus）——落盘成功后经 notes-events 注册表单点分发（替代洋葱包裹），见下方标记块。
    const _persistChains = Object.create(null)
    // ==== notes-events BEGIN ====（0.4.3+ 内核事件总线：onNoteChanged 单点注册表，notes-043-event-bus——替代 persistNote/_purge 洋葱包裹）
    // 契约：persistNote/_purge 落盘成功后单点分发 { event, note?, id? }：
    //   event ∈ create（首写，cache 无旧版）/ update（已存笔记改写）/ delete（软删落盘 deleted:true）/
    //           restore（删除态重存 deleted:true→false 同通道）/ purge（彻底删除——不经 persistNote，由 _purge 分发，载荷只带 id）。
    // 顺序契约：监听者按注册序同步执行（manifest 登记序 = 执行序，check 节 45 序断言看守——比洋葱包裹序显式）。
    // 红线：监听者异常隔离（逐监听 try/catch + console.error 记录）——任何监听者抛错不影响其余监听者与落盘主流程（零阻塞）。
    const _noteListeners = []
    function onNoteChanged(fn) { if (typeof fn === 'function') _noteListeners.push(fn) }
    function _emitNoteChanged(ev) {
      for (const fn of _noteListeners.slice()) {
        try { fn(ev) } catch (e) { console.error('notes: onNoteChanged 监听者异常（已隔离）', e) }
      }
    }
    // 事件类型推导：prev = 写前 cache 旧版（常驻权威）；墓碑视作不存在（purge 后重写 = 新建语义）
    function _noteEventOf(prev, n) {
      if (n && n.deleted === true) return 'delete'
      if (!prev || prev.tombstoned) return 'create'
      if (prev.deleted === true) return 'restore'
      return 'update'
    }
    // ==== notes-events END ====
    async function _persistNoteInner(n, opts) {
      perfStats.diskWrites++
      const prev = cache.get(n.id)
      if ((!opts || opts.history !== false) && prev) await histSnapshot(n.id, prev)
      const content = noteFileContent(n)
      const ft = await fs.resolve(NOTES_DIR + '\\' + n.id + '.md')
      await fs.writeText(ft, content, undefined, undefined, getPolicy())
      cache.set(n.id, Object.assign({}, n))
      _emitNoteChanged({ event: _noteEventOf(prev, n), note: n })   // 落盘成功且缓存同步后单点分发（notes-043-event-bus）
    }
    async function persistNote(n, opts) {
      const prev = _persistChains[n.id] || Promise.resolve()
      const run = prev.then(() => _persistNoteInner(n, opts))
      _persistChains[n.id] = run.then(function () {}, function () {})   // 失败不断链：后续写不受前次失败阻塞
      await run
    }

    // 列表/RPC 瘦身：不带 body，正文编辑走 notes-get 按需加载
    function slim(n) {
      return {
        id: n.id, title: n.title, topic: n.topic, workspace: n.workspace, folder: n.folder || '',
        tags: n.tags, kind: n.kind || 'note', status: n.status || 'active',
        inject: n.inject === true, injectEver: n.injectEver === true || n.inject === true, injectTo: n.injectTo || [], injectRole: n.injectRole === 'reference' ? 'reference' : 'convention', recall: n.recall !== false, sensitive: n.sensitive === true,
        createdAt: n.createdAt, updatedAt: n.updatedAt,
        sessionId: n.sessionId, cwd: n.cwd, logDate: n.logDate || '', entities: n.entities || [], summarizedAt: n.summarizedAt || '', contractType: n.contractType || '', origin: n.origin || '', schedule: n.schedule || null, mergedFrom: n.mergedFrom,
        dispatches: n.dispatches || [],
        refNote: n.refNote || '',
        useCount: n.useCount || 0,
        archivedAt: n.archivedAt, deleted: n.deleted === true, preview: String(n.body || '').slice(0, 200)
      }
    }

