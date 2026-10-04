    // ===== popover: scope —— 注入范围浮层（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelScope（sessList/sessPending/scopeOpen 态 + 会话清单轮询 + injectScopeLabel + 浮层 JSX）
    // needs: kernel/state.js（panelBridge + toggleScope 转发别名）、kernel/icons.js（e/I）；
    //        open/notes/edScope 经 hook 入参注入（panel/index.js 装配层回填，渲染期新鲜值）
    // state 托管：scopeOpen/sessList/sessPending 留 hook 内 useState（与主面板同一渲染边界；§6 E 裁决记录见 panel/index.js 头注）；
    // 编辑器 setRoleSeg 联动开合经 kernel 转发别名 setScopeOpen → panelBridge 回填
    function usePanelScope(args) {
        const open = args.open
        const notes = args.notes
        const edScope = args.edScope
        const [sessList, setSessList] = React.useState([])
        const [sessPending, setSessPending] = React.useState([])   // 注入范围浮层：标题后台补齐中的占位会话 [{id, short, workspace}]（0.1.7 首屏提速）
        const [scopeOpen, setScopeOpen] = React.useState(false)
        // 注入范围下拉的会话列表：面板打开时 + 笔记数变化时刷新（新会话可能出现）
        // 0.1.7 首屏提速：响应带 titlesPending 说明有会话标题在后台读盘补齐——立即渲染已 resolve 条目 +
        // 占位条目（「短id · 标题加载中…」），1.5s 轮询重拉直到补齐或面板关闭（冷缓存首读可能上百秒，轮询成本≈0）
        React.useEffect(() => {
          if (!open) return
          let stopped = false
          let pendingTimer = null
          function pullSessList() {
            host.call('notes-sessions', {}).then(res => {
              if (stopped || !res) return
              if (res.sessions) setSessList(res.sessions)
              setSessPending(res.titlesPending && Array.isArray(res.pendingSessions) ? res.pendingSessions : [])
              if (res.titlesPending && !stopped) pendingTimer = timer.timeout(pullSessList, 1500)
            }).catch(() => {})
          }
          pullSessList()
          return () => { stopped = true; if (typeof pendingTimer === 'function') pendingTimer() }
        }, [open, notes.length])
        // 范围浮层：点击外部关闭
        React.useEffect(() => {
          if (!scopeOpen) return
          const onDown = (ev) => { if (!(ev.target && ev.target.closest && ev.target.closest('.dsh-notes-ed-scope-wrap'))) setScopeOpen(false) }
          document.addEventListener('mousedown', onDown)
          return () => document.removeEventListener('mousedown', onDown)
        }, [scopeOpen])
        // 注入范围文字（injectTo 是多选数组）：缺省 = 所有会话（存量 global/workspace 值同样视为所有会话）；否则列出所选会话名
        function injectScopeLabel(injectTo) {
          const arr = (injectTo || []).filter(t => t !== 'global' && t !== 'workspace')
          if (arr.length === 0) return '所有会话'
          const names = arr.map(t => {
            const s = sessList.find(x => x.short === t)
            return s ? s.name : ('会话 ' + t)
          })
          return names.join('、')
        }
        // 范围浮层：会话按工作区分组（两级：工作区 → 会话）
        const scopeByWs = {}
        for (const s of sessList) { const w = s.workspace || '其他'; if (!scopeByWs[w]) scopeByWs[w] = []; scopeByWs[w].push(s) }
        // 标题后台补齐中的占位会话（0.1.7）：禁用态占位「短id · 标题加载中…」，补齐后轮询重拉自动替换为真名
        for (const p of sessPending) { const w = p.workspace || '其他'; if (!scopeByWs[w]) scopeByWs[w] = []; scopeByWs[w].push({ id: p.id, short: p.short, name: '', pending: true }) }
        const scopeWsKeys = Object.keys(scopeByWs).sort()
        const scopePanelEl = scopeOpen ? e('div', { className: 'dsh-notes-scope-panel' },
                  // 默认提示行：注入无「工作区/全局」维度——缺省注入所有会话，勾选会话则仅限这些会话
                  e('div', { className: 'dsh-notes-scope-hint' }, '默认注入到所有会话；勾选会话则仅限这些会话'),
                  scopeWsKeys.map(ws => e('div', { key: ws, className: 'dsh-notes-scope-group' },
                    e('div', { className: 'dsh-notes-scope-ws' }, ws),
                    scopeByWs[ws].map(s => e('label', { key: s.id, className: 'dsh-notes-scope-item dsh-notes-scope-sess' },
                      e('input', { type: 'checkbox', checked: s.pending ? false : edScope.indexOf(s.short) >= 0, onChange: () => { if (!s.pending) toggleScope(s.short) }, disabled: !!s.pending }),
                      ' ' + (s.pending ? (s.short + ' · 标题加载中…') : s.name))))))
                : null
        return { sessList: sessList, sessPending: sessPending, scopeOpen: scopeOpen, setScopeOpen: setScopeOpen, injectScopeLabel: injectScopeLabel, scopePanelEl: scopePanelEl }
    }
