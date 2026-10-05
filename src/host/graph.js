    // ==== notes-graph BEGIN ====（0.4.3 内核①：四类边统一扫描建图 + 增量维护 + 图查询 RPC，notes-043-graph；0.4.3+ notes-043-graph-registry：边类型收敛为 EDGE_REGISTRY 声明式描述符——扩展新边类型 = 追加一个描述符，行为零变化）
    // EDGE_REGISTRY 描述符契约（声明式注册表，非继承——同 RootNoteTpl 先例；差异只在「提取方式 / 死链语义」两个数据维度）：
    //   type          边类型名（GRAPH_EDGE_TYPES 由注册表派生 → notes-graph RPC type 过滤白名单/byType 键/死链清单 type 字段自动跟随）
    //   extract(note, cache) 纯函数：只读 n（cache 供同笔记多描述符共享一次正文扫描），返回出现清单 [{ target, meta }]
    //   deadLinkable  目标解析不中是否计死链：true = 走解析/置死/raw 复活通道；false = 命名空间边永不死链（dispatch 承载 to=session:<id> 语义）
    //   resolve       仅 deadLinkable:true：'full' = id 精确 + 全库标题精确（与 client 反向链接同口径）| 'id' = 仅 id 精确（softref 软链口径）
    //   deadVia       仅 deadLinkable:true：死链时 via 回退值（link/mount='raw' 保留原始形态供复活比对；softref='id'——runLog 写的就是 id）
    //   via           仅 deadLinkable:false：入图 via（dispatch='session'）
    // 四描述符：link（正文 [[双链]] 行内引用）/ mount（行首列表项挂载行，注入索引根笔记 §1 形态）/
    //   softref（front-matter 软链 schedule.runLog 执行记录）/ dispatch（派发记录 → 会话命名空间，永不死链）。
    // 红线：①只读挂载——本模块零改写笔记内容（onNoteChanged 监听只在内存图上做增量，落盘载荷原样透传）；
    //       ②图是派生物——全量重建 _graphRebuild 随时可做（notes-graph {rebuild:true}），增量异常一律降级
    //       built=false，下次查询自动全量重建自愈（错得安全：宁可重建不报错卡死）。
    // 双包共源：本文件物理单份，manifest.dev.js / manifest.dist.js 同名登记（check 节 45/71 看守）。
    // 命名纪律：双链词法与 client 内核同一口径（target 不含方括号/换行），但符号独立命名——host 不引入 client 内核符号。
    const EDGE_REGISTRY = [
      { type: 'link', deadLinkable: true, resolve: 'full', deadVia: 'raw', extract: function (n, cache) { if (!cache.body) cache.body = _graphBodyScan(n); return cache.body.link } },
      { type: 'softref', deadLinkable: true, resolve: 'id', deadVia: 'id', extract: _graphSoftrefOccs },
      { type: 'mount', deadLinkable: true, resolve: 'full', deadVia: 'raw', extract: function (n, cache) { if (!cache.body) cache.body = _graphBodyScan(n); return cache.body.mount } },
      { type: 'dispatch', deadLinkable: false, via: 'session', extract: _graphDispatchOccs }
    ]
    // nodes: id → { title, dead }（dead=软删/清除后不再作解析目标）；edges: [{from,to,raw,type,via,dead,meta}]
    //   raw = 双链原始 target（死链保留原始形态供复活比对）；via = 'id'|'title'|'raw'|'session'（解析路径）
    const graphState = { built: false, edges: [], nodes: {} }
    const GRAPH_EDGE_TYPES = EDGE_REGISTRY.map(function (d) { return d.type })
    const GRAPH_LINK_RE = /\[\[([^\[\]\r\n]+)\]\]/g
    const GRAPH_MOUNT_RE = /^\s*(?:[-*]|\d+[.)])\s+\[\[([^\[\]\r\n]+)\]\]/
    const GRAPH_SESSION_NS = 'session:'
    function _graphSortKey(e) { return e.from + '\u0000' + e.to + '\u0000' + e.type }
    // 死链复活/改名复估共用：指向 id 的存活边 → 置死（to 回退 raw 原始形态）
    function _graphKillEdgesTo(id) {
      for (const e of graphState.edges) {
        if (!e.dead && e.to === id) { e.dead = true; e.to = e.raw }
      }
    }
    // 按当前库解析 target：id 精确优先、标题全库精确匹配（与 client 反向链接同一口径）；不中 → null（死链）
    function _graphResolve(target) {
      const n = graphState.nodes[target]
      if (n && !n.dead) return { id: target, via: 'id' }
      for (const id in graphState.nodes) {
        const nd = graphState.nodes[id]
        if (!nd.dead && nd.title && nd.title === target) return { id: id, via: 'title' }
      }
      return null
    }
    // ---- EDGE_REGISTRY 提取器（纯函数：只读入参，不触库不改写）----
    // 正文出现扫描（link/mount 共享一次）：挂载行只归该行的那一处出现（摘出后行内余文照常按 link 扫），其余出现 = link；
    // 按 target×type 去重（meta.count 记出现次数），link/mount 两组各自保持首次出现序
    function _graphBodyScan(n) {
      const body = String(n.body || '')
      const seen = {}
      const add = function (target, type) {
        const key = target + '\u0000' + type
        if (!seen[key]) seen[key] = { target: target, type: type, count: 0 }
        seen[key].count++
      }
      let rest = ''
      for (const ln of body.split(/\r?\n/)) {
        const m = ln.match(GRAPH_MOUNT_RE)
        if (m) { add(m[1], 'mount'); rest += ln.slice(0, ln.indexOf(m[0])) + ln.slice(ln.indexOf(m[0]) + m[0].length) + '\n' }
        else rest += ln + '\n'
      }
      let m2
      GRAPH_LINK_RE.lastIndex = 0
      while ((m2 = GRAPH_LINK_RE.exec(rest)) !== null) add(m2[1], 'link')
      const link = [], mount = []
      for (const k in seen) {
        const it = seen[k]
        ;(it.type === 'mount' ? mount : link).push({ target: it.target, meta: { count: it.count } })
      }
      return { link: link, mount: mount }
    }
    // softref 提取：schedule.runLog 软链（自链排除；目标不存在同样计死链）
    function _graphSoftrefOccs(n) {
      if (!(n.schedule && n.schedule.runLog && String(n.schedule.runLog) !== n.id)) return []
      const rl = String(n.schedule.runLog)
      return [{ target: rl, meta: { key: 'schedule.runLog' } }]
    }
    // dispatch 提取：派发记录（to = session:<sessionId> 会话命名空间，不属笔记库；status 为记录时点快照，done 布尔向后兼容）
    function _graphDispatchOccs(n) {
      const out = []
      for (const d of (n.dispatches || [])) {
        if (!d || !d.sessionId) continue
        out.push({ target: GRAPH_SESSION_NS + d.sessionId, meta: { at: d.at || '', status: d.dispatchStatus || (d.done === true ? 'done' : 'sent') } })
      }
      return out
    }
    // 注册表收口：单描述符出现清单 → 边（统一自链排除；deadLinkable 走解析/死链/raw 复活通道，否则命名空间边原样入图永不置死）
    function _graphEdgesOf(d, n, cache) {
      const out = []
      for (const o of d.extract(n, cache)) {
        if (o.target === n.id) continue   // 自链不入图（反向链接面板同口径；dispatch target 为 session 命名空间天然不中）
        if (d.deadLinkable) {
          const r = d.resolve === 'id'
            ? (graphState.nodes[o.target] && !graphState.nodes[o.target].dead ? { id: o.target, via: 'id' } : null)
            : _graphResolve(o.target)
          out.push({ from: n.id, to: r ? r.id : o.target, raw: o.target, type: d.type, via: r ? r.via : d.deadVia, dead: !r, meta: o.meta })
        } else {
          out.push({ from: n.id, to: o.target, raw: o.target, type: d.type, via: d.via, dead: false, meta: o.meta })
        }
      }
      return out
    }
    // 单笔记边提取：遍历 EDGE_REGISTRY 逐描述符收口（扩展 = 注册表追加描述符，此处与查询/死链通道零改动）
    function _graphEdgesFor(n) {
      const out = []
      if (!n || n.deleted === true || n.tombstoned) return out
      const cache = {}
      for (const d of EDGE_REGISTRY) {
        const es = _graphEdgesOf(d, n, cache)
        for (const e of es) out.push(e)
      }
      return out
    }
    // 全量重建（复用 _list：含 kind=log——日志正文双链覆盖「相关笔记」节；排除软删；includeSys=true 机器全量视图——
    //   索引挂载边/记忆档案双链/runLog softref 的解析目标均为 kind=sys，0.4.3⑨ 缺省降噪只作用于平铺视图，图内核必须全量否则会造死链假象）
    async function _graphRebuild() {
      const all = await _list(undefined, undefined, undefined, false, true, true)
      const nodes = {}
      for (const n of all) nodes[n.id] = { title: n.title || '', dead: false }
      graphState.nodes = nodes
      graphState.edges = []
      for (const n of all) graphState.edges = graphState.edges.concat(_graphEdgesFor(n))
      graphState.built = true
      return graphState
    }
    async function _graphEnsure() { if (!graphState.built) await _graphRebuild(); return graphState }
    // 增量·节点 upsert（create/update/restore 共用；restore = 删除态笔记重新 persistNote(deleted:false) 同通道覆盖）
    function _graphUpsert(n) {
      if (!graphState.built) return
      const prev = graphState.nodes[n.id]
      const title = n.title || ''
      if (prev && prev.title && prev.title !== title) {
        // 改名：原经旧标题解析指向本笔记的存活边 → 复估置死（raw 保留旧标题，下轮 revive 不误复活）
        for (const e of graphState.edges) { if (!e.dead && e.to === n.id && e.via === 'title') { e.dead = true; e.to = e.raw } }
      }
      graphState.nodes[n.id] = { title: title, dead: false }
      // 死链复活：raw 命中本笔记 id 或当前标题（他链指向本笔记，先前目标不存在/已删）
      for (const e of graphState.edges) {
        if (e.dead && e.from !== n.id && (e.raw === n.id || (!!title && e.raw === title))) { e.dead = false; e.to = n.id; e.via = e.raw === n.id ? 'id' : 'title' }
      }
      _graphDropFrom(n.id)
      graphState.edges = graphState.edges.concat(_graphEdgesFor(n))
    }
    function _graphDropFrom(id) { graphState.edges = graphState.edges.filter(function (e) { return e.from !== id }) }
    // 增量·节点移除（软删/清除共用）：级联删该节点全部出边 + 指向它的存活边置死（死链 = to 不存在）
    function _graphRemove(id) {
      if (!graphState.built) return
      _graphDropFrom(id)
      _graphKillEdgesTo(id)
      if (graphState.nodes[id]) graphState.nodes[id].dead = true
    }
    // 增量钩子·事件总线监听（0.4.3+ notes-043-event-bus：persistNote/_purge 洋葱包裹 → onNoteChanged 单点注册表）：
    //   create/update/delete/restore/archive/派发记录/runLog 回写全部经 persistNote 落盘 → 总线单点分发；
    //   purge 事件由 _purge 落盘成功后分发（彻底删除不经 persistNote，cache.delete 直通），载荷只带 id。
    //   注册序 = 执行序、监听者异常隔离由总线保证；本监听仍保留降级兜底（增量异常 → built=false，下次查询全量重建自愈）。
    onNoteChanged(function (ev) {
      try {
        if (!ev) return
        if (ev.event === 'purge') { _graphRemove(ev.id); return }
        const n = ev.note
        if (n && n.id) { if (n.deleted === true) _graphRemove(n.id); else _graphUpsert(n) }
      } catch (e) { graphState.built = false }
    })
    function _graphByType(es) {
      const o = {}
      for (const t of GRAPH_EDGE_TYPES) o[t] = 0
      for (const e of es) o[e.type] = (o[e.type] || 0) + 1
      return o
    }
    // 图查询 RPC：notes-graph {id?, type?, direction?, rebuild?}
    //   无 id：全图概览 { nodes, edges, byType, dead:[{from,target,type}], types }
    //   有 id：{ id, exists, out, back, counts:{out,back}, byType }
    //   direction：'out'|'in'|'both'（缺省 both）；type：单类型过滤（白名单 = GRAPH_EDGE_TYPES，注册表派生）；rebuild:true 强制全量重建（增量一致性对照口）
    disposers.push(handle('notes-graph', async (args) => {
      try {
        const a = args || {}
        if (a.rebuild || !graphState.built) await _graphRebuild()
        const et = a.type !== undefined && a.type !== null && a.type !== '' ? String(a.type) : undefined
        if (et !== undefined && GRAPH_EDGE_TYPES.indexOf(et) < 0) return { error: 'notes-graph type 须为 ' + GRAPH_EDGE_TYPES.join('/') + '（实得 ' + et + '）' }
        const dir = ['out', 'in', 'both'].indexOf(a.direction) >= 0 ? a.direction : 'both'
        const filt = function (es) { return es.filter(function (e) { return !et || e.type === et }) }
        if (a.id !== undefined && a.id !== null && a.id !== '') {
          const id = String(a.id)
          const node = graphState.nodes[id]
          const allOut = filt(graphState.edges.filter(function (e) { return e.from === id }))
          const allBack = filt(graphState.edges.filter(function (e) { return e.to === id && !e.dead && e.from !== id }))
          const out = dir === 'in' ? [] : allOut
          const back = dir === 'out' ? [] : allBack
          return { id: id, exists: !!(node && !node.dead), out: out, back: back, counts: { out: allOut.length, back: allBack.length }, byType: _graphByType(allOut.concat(allBack)) }
        }
        const es = filt(graphState.edges)
        const dead = es.filter(function (e) { return e.dead }).map(function (e) { return { from: e.from, target: e.raw, type: e.type } })
        let live = 0
        for (const id in graphState.nodes) { if (!graphState.nodes[id].dead) live++ }
        return { nodes: live, edges: es.length, edgeList: es, byType: _graphByType(es), dead: dead, types: GRAPH_EDGE_TYPES }
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // ==== notes-graph END ====
