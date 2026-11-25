    // ===== entries/injected-badge —— 会话头部注入清单徽标 📎N（0.4.5-H notes-045-session-injected-view）=====
    // provides: injSessionHit/injBadgeCompute/injBadgePopPlace（纯函数，check 节 88 行为级 eval 锚）+ InjectedBadge 组件 +
    //           injBadgePopBuild 命令式弹层 DOM 组装（portal）+ slots.register（conversation.session.header.actions #41，排既有笔记按钮 #40 旁——独立 id 共存，不抢槽位）
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
    // 弹层坐标纯函数（0.6.x notes-071/072，反馈 n-mwvgrqllcob5）：宿主 titleCluster computed overflow:clip 把旧
    //   absolute 弹层整体裁掉（pop.top 恰落簇底缘外，用户截图实证）；071 首修 fixed 被真机驳回修正——titleCluster 还有
    //   mask-image，mask 使该祖先成为 fixed 的包含块，overflow:clip 照样裁掉 fixed 弹层（Verifier 受控实验：仅置
    //   mask:none 弹层即完整可见，恢复 mask 即复失）。终态 = 弹层 portal 物理离开该祖先（挂载见 InjectedBadge 弹层 effect），
    //   坐标仍按按钮 rect 现算。口径：默认弹层右缘对齐按钮右缘；left 钳制视口左右各 8px；top=按钮下缘+4；
    //   width≤320 且不超 vw-16；maxHeight≤300 且不超剩余视口高（vh-top-8）。
    //   vw/vh 参数化（check 节 88 行为级 eval 矩阵；调用方传 window.innerWidth/innerHeight）。宽/高口径 = border-box
    //   （样式侧 box-sizing:border-box 配套，实测 rect 与 width/maxHeight 逐像素一致）。
    function injBadgePopPlace(br, vw, vh) {
      const M = 8
      const width = Math.min(320, Math.max(0, vw - 2 * M))
      let left = br.right - width
      if (left < M) left = M
      if (left + width > vw - M) left = Math.max(M, vw - M - width)
      const top = br.bottom + 4
      const maxHeight = Math.min(300, Math.max(0, vh - top - M))
      return { left: left + 'px', top: top + 'px', width: width + 'px', maxHeight: maxHeight + 'px' }
    }
    // 弹层 DOM 组装（notes-072-injbadge-pop-portal）：命令式 createElement——标题/范围/when 全是用户数据，textContent
    //   直填不经 HTML 解析（零 innerHTML 红线，与 React 文本节点转义同强度）；tooltip 走 setAttribute。类名与 React 形态
    //   逐类一致（styles.css / e2e 选择器零迁移）；挂载/移除由 InjectedBadge 弹层 effect 全权管理（本函数只产不挂）。
    function injBadgePopRowEl(id, title, sub, tip, onOpen) {
      const row = document.createElement('div')
      row.className = 'dsh-notes-injbadge-row dsh-nt'
      row.setAttribute('data-tooltip', tip)
      row.addEventListener('click', () => onOpen(id))
      const rt = document.createElement('div')
      rt.className = 'dsh-notes-injbadge-row-t'
      rt.textContent = title
      row.appendChild(rt)
      if (sub) {
        const rs = document.createElement('div')
        rs.className = 'dsh-notes-injbadge-row-s'
        rs.textContent = sub
        row.appendChild(rs)
      }
      return row
    }
    function injBadgePopBuild(data, place, tt, onOpen) {
      const pop = document.createElement('div')
      pop.className = 'dsh-notes-injbadge-pop'
      if (place) { for (const k of Object.keys(place)) pop.style[k] = place[k] }
      const head = document.createElement('div')
      head.className = 'dsh-notes-injbadge-pop-t'
      head.textContent = tt('injBadge.title')
      pop.appendChild(head)
      const M = data.convs.length, K = data.refs.length
      const tip = tt('injBadge.openTip')
      if (M > 0) {
        const s = document.createElement('div')
        s.className = 'dsh-notes-injbadge-sec'
        s.textContent = tt('injBadge.convSec', { n: M })
        pop.appendChild(s)
      }
      for (const n of data.convs) pop.appendChild(injBadgePopRowEl(n.id, n.title || tt('tree.untitled'), injBadgeScopeLabel(n.injectTo, tt), tip, onOpen))
      if (K > 0) {
        const s2 = document.createElement('div')
        s2.className = 'dsh-notes-injbadge-sec'
        s2.textContent = tt('injBadge.refSec', { n: K })
        pop.appendChild(s2)
      }
      for (const r of data.refs) pop.appendChild(injBadgePopRowEl(r.id, r.title, r.when || '', tip, onOpen))
      return pop
    }
    const d5 = slots.inject('conversation.session.header.actions', () => {
      function InjectedBadge(props) {
        const tt = useT()
        const sid = shortSid(props && props.sessionId)
        const [data, setData] = React.useState(null)   // null = 未加载/拉取失败（徽标不渲染，静默降级）
        const [popOpen, setPopOpen] = React.useState(false)
        const btnRef = React.useRef(null)   // 徽标按钮 rect 锚：弹层 portal 坐标开层时现算（notes-072-injbadge-pop-portal）
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
        // 浮层点外关闭 + Esc 关闭（会话头部在宿主壳，面板 Esc 分层栈覆盖不到，本组件自理）；
        // 弹层 portal 直挂 body（不在徽标壳内），点外判定须把弹层本体计入「内」，否则点弹层空白区会误关
        React.useEffect(() => {
          if (!popOpen) return
          const onDown = (ev) => { if (!(ev.target && ev.target.closest && ev.target.closest('.dsh-notes-injbadge, .dsh-notes-injbadge-pop'))) setPopOpen(false) }
          const onKey = (ev) => { if (ev.key === 'Escape') setPopOpen(false) }
          document.addEventListener('mousedown', onDown)
          document.addEventListener('keydown', onKey)
          return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
        }, [popOpen])
        // 会话切换即收弹层（防跨会话残留旧行——portal 弹层生命周期随本组件，sid 变更先行关闭）
        React.useEffect(() => { setPopOpen(false) }, [sid])
        // 弹层 portal 挂载（notes-072-injbadge-pop-portal）：开层时命令式建 DOM 直挂 document.body——物理离开宿主
        //   titleCluster（mask-image 使其成为 fixed 的包含块 + overflow:clip 双重裁切，fixed 单体修法已被真机驳回）；
        //   坐标按按钮 rect 现算（injBadgePopPlace，border-box 口径与样式配套）；关层/数据刷新/卸载经 effect 清理链
        //   统一移除（data 变更重建 = 行内容随拉取刷新；行点击 onOpen = openNote 函数声明提升，早退渲染路径同样在册）。
        //   纪律红线：本 effect 必须在早退 return 之前声明——hooks 数量恒定（早退后加 hook = React #310 崩槽，真机实证）；
        //   零新增槽位注册（shell 通道加注册会打破 18 节「恰 5 个 Slot 注入点」产物锚），走命令式层（editor.js 遮蔽层同款形态）。
        React.useEffect(() => {
          if (!popOpen || !data) return
          const btn = btnRef.current
          const place = (btn && btn.getBoundingClientRect) ? injBadgePopPlace(btn.getBoundingClientRect(), window.innerWidth, window.innerHeight) : null
          const el = injBadgePopBuild(data, place, tt, openNote)
          document.body.appendChild(el)
          return () => { if (el.parentNode) { try { el.parentNode.removeChild(el) } catch (err) {} } }
        }, [popOpen, data])
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
        return e('span', { className: 'dsh-notes-injbadge' },
          e('button', { ref: btnRef, className: 'dsh-notes-hdr-btn dsh-notes-injbadge-btn dsh-nt', onClick: () => setPopOpen(v => !v), 'data-tooltip': tt('injBadge.tip', { m: M, k: K }), 'aria-label': tt('injBadge.title') },
            e('span', { className: 'dsh-notes-injbadge-ic', 'aria-hidden': 'true' }, '📎'),
            e('span', { className: 'dsh-notes-injbadge-n' }, String(N))))
      }
      slots.register({ name: 'conversation.session.header.actions', id: 'dsh-notes-injected-badge', order: 41 }, (props) => e(InjectedBadge, props))
    })
    if (typeof d5 === 'function') disposers.push(d5)
