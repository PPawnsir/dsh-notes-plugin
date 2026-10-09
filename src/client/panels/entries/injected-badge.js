    // ===== entries/injected-badge —— 会话头部注入清单徽标 📎N（0.4.5-H notes-045-session-injected-view）=====
    // provides: injSessionHit/injBadgeCompute（纯函数，check 节 88 行为级 eval 锚）+ InjectedBadge 组件 +
    //           slots.register（conversation.session.header.actions #41，排既有笔记按钮 #40 旁——独立 id 共存，不抢槽位）
    // needs: kernel/bus.js（panelOpen/noteRefreshListeners/showToast）、kernel/format.js（shortSid/notify）、
    //        kernel/state.js（panelBridge/selectNote 转发别名）、kernel/i18n.js（useT/t）、kernel/icons.js（e）——拼接序位全部在前
    // 数据源零新增 RPC：notes-list（inject=true 过滤在本组件求值；sys/软删 host 缺省口径已排除，组件侧同口径兜底）+
    //   notes-mount-list（注入索引 §1 挂载行）。挂载时 + notifyNotesChanged 失效时拉取。
    // 命中规则与 host conventionHit 同口径（inject.js，单会话形态）：injectTo 空 = 全局命中；含 global/workspace 存量值
    //   容错 = 全局；含当前会话短 id（shortSid 归一比对，notes-034-injectto-norm 同口径）= 命中。
    //   挂载行 = 目录段载荷，均随目标笔记 injectTo 过滤（0.5.0 notes-050-mount-scope：host renderInjected 目录段 + 徽标资料区同款 scope 过滤——与真实注入面一致）。
    // 降级红线：拿不到 sessionId / 拉取失败 / 零命中 → 徽标不渲染（静默）；面板能力桥缺席 → 行点击只开面板不选中。
    // 只读会话状态，零写入。原型 notes-ui-v2.html 无需同步：会话头部是宿主壳区域，非本插件原型面。
    // 与入口双模式（header/fab 互斥）无关：本徽标是注入可观测性而非面板入口，两种模式下都常驻。
    function injSessionHit(injectTo, sidShort) {
      const targets = injectTo || []
      if (targets.length === 0) return true
      for (const tg of targets) {
        if (tg === 'global' || tg === 'workspace') return true
        if (shortSid(tg) === sidShort) return true
      }
      return false
    }
    function injBadgeCompute(notes, lines, sidShort) {
      const convs = [], refs = []
      for (const n of (notes || [])) {
        if (!n || n.inject !== true || n.injectRole === 'reference') continue
        if ((n.kind || 'note') === 'sys' || n.deleted === true) continue   // sys/软删排除（host 缺省口径之外的组件侧兜底）
        if (!injSessionHit(n.injectTo, sidShort)) continue
        convs.push(n)
      }
      for (const l of (lines || [])) {
        if (!l || !l.id) continue
        const ln = (notes || []).find(x => x && x.id === l.id)
        if (ln && (ln.deleted === true || (ln.kind || 'note') === 'sys')) continue   // 死挂载行/机器行不回显（与 host 摘行联动同向兜底）
        if (ln && !injSessionHit(ln.injectTo, sidShort)) continue   // 挂载行随目标笔记 injectTo 过滤（与 host 目录段同口径，0.5.0 notes-050-mount-scope）
        refs.push({ id: l.id, when: l.when || '', title: (ln && ln.title) || l.id })
      }
      return { convs: convs, refs: refs }
    }
    // 约定行 scope 文字：缺省 = 所有会话；否则列会话短 id（徽标无 sessList 数据源，不解析会话名——scope.js injectScopeLabel 减配版）
    function injBadgeScopeLabel(injectTo, tt) {
      const arr = (injectTo || []).filter(x => x !== 'global' && x !== 'workspace')
      if (arr.length === 0) return tt('meta.scopeAll')
      return arr.map(tg => tt('meta.scopeSession', { name: shortSid(tg) })).join(tt('common.listSep'))
    }
    const d5 = slots.inject('conversation.session.header.actions', () => {
      function InjectedBadge(props) {
        const tt = useT()
        const sid = shortSid(props && props.sessionId)
        const [data, setData] = React.useState(null)   // null = 未加载/拉取失败（徽标不渲染，静默降级）
        const [popOpen, setPopOpen] = React.useState(false)
        // 拉取：挂载时 + sid 切换时 + notifyNotesChanged 失效时（notes-list + notes-mount-list 组合，零新增 RPC）
        React.useEffect(() => {
          if (!sid) return
          let stopped = false
          function pullInjected() {
            Promise.all([host.call('notes-list', {}), host.call('notes-mount-list', {})]).then(rs => {
              if (stopped) return
              const nl = rs[0], ml = rs[1]
              if (!nl || nl.error || !Array.isArray(nl.notes) || !ml || ml.error || !Array.isArray(ml.lines)) { setData(null); return }
              setData(injBadgeCompute(nl.notes, ml.lines, sid))
            }).catch(() => { if (!stopped) setData(null) })   // 拉取失败静默降级：徽标不渲染
          }
          pullInjected()
          const fn = () => pullInjected()
          noteRefreshListeners.add(fn)
          return () => { stopped = true; noteRefreshListeners.delete(fn) }
        }, [sid])
        // 浮层点外关闭 + Esc 关闭（会话头部在宿主壳，面板 Esc 分层栈覆盖不到，本组件自理）
        React.useEffect(() => {
          if (!popOpen) return
          const onDown = (ev) => { if (!(ev.target && ev.target.closest && ev.target.closest('.dsh-notes-injbadge'))) setPopOpen(false) }
          const onKey = (ev) => { if (ev.key === 'Escape') setPopOpen(false) }
          document.addEventListener('mousedown', onDown)
          document.addEventListener('keydown', onKey)
          return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
        }, [popOpen])
        if (!sid) return null
        if (!data) return null
        const M = data.convs.length, K = data.refs.length, N = M + K
        if (N === 0) return null   // 零命中不占位（无注入是常态，📎0 无信息量）
        // 行点击 = 打开笔记面板直达该笔记：editor.js openExecLog 同款——缓存（panelBridge.notes）命中直接 selectNote，
        // 未命中走 notes-get 直开（open-by-id 通道，selectNote 内登记 openByIdNote 旁路）；面板能力桥缺席 → 只开面板不选中（静默降级）
        function openNote(id) {
          if (!id) return
          setPopOpen(false)
          panelOpen = true; notify()
          const canSelect = typeof panelBridge.selectNote === 'function'
          const hit = (panelBridge.notes || []).find(x => x && x.id === id)
          if (hit) { if (canSelect) panelBridge.selectNote(hit); return }
          if (!canSelect) return
          host.call('notes-get', { id: id }).then(res => {
            if (res && res.note) panelBridge.selectNote(res.note)
            else showToast(t('wiki.targetNotFound', { target: id }))
          }).catch(() => showToast(t('wiki.targetNotFound', { target: id })))
        }
        const popEl = popOpen ? e('div', { className: 'dsh-notes-injbadge-pop' },
          e('div', { className: 'dsh-notes-injbadge-pop-t' }, tt('injBadge.title')),
          M > 0 ? e('div', { className: 'dsh-notes-injbadge-sec' }, tt('injBadge.convSec', { n: M })) : null,
          data.convs.map(n => e('div', { key: n.id, className: 'dsh-notes-injbadge-row dsh-nt', 'data-tooltip': tt('injBadge.openTip'), onClick: () => openNote(n.id) },
            e('div', { className: 'dsh-notes-injbadge-row-t' }, n.title || tt('tree.untitled')),
            e('div', { className: 'dsh-notes-injbadge-row-s' }, injBadgeScopeLabel(n.injectTo, tt)))),
          K > 0 ? e('div', { className: 'dsh-notes-injbadge-sec' }, tt('injBadge.refSec', { n: K })) : null,
          data.refs.map(r => e('div', { key: r.id, className: 'dsh-notes-injbadge-row dsh-nt', 'data-tooltip': tt('injBadge.openTip'), onClick: () => openNote(r.id) },
            e('div', { className: 'dsh-notes-injbadge-row-t' }, r.title),
            r.when ? e('div', { className: 'dsh-notes-injbadge-row-s' }, r.when) : null))) : null
        return e('span', { className: 'dsh-notes-injbadge' },
          e('button', { className: 'dsh-notes-hdr-btn dsh-notes-injbadge-btn dsh-nt', onClick: () => setPopOpen(v => !v), 'data-tooltip': tt('injBadge.tip', { m: M, k: K }), 'aria-label': tt('injBadge.title') },
            e('span', { className: 'dsh-notes-injbadge-ic', 'aria-hidden': 'true' }, '📎'),
            e('span', { className: 'dsh-notes-injbadge-n' }, String(N))),
          popEl)
      }
      slots.register({ name: 'conversation.session.header.actions', id: 'dsh-notes-injected-badge', order: 41 }, (props) => e(InjectedBadge, props))
    })
    if (typeof d5 === 'function') disposers.push(d5)
