    // ===== popover: filter-pop —— 筛选中心分组浮层（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelFilterPop（filterOpen 态 + renderFilterPop 渲染函数）/ filterOpenRef
    // needs: kernel/state.js（panelBridge + setFilters 转发别名）、kernel/constants.js（FILTER_STATUS/FILTER_KINDS/FILTERS0/KIND_LABELS）、
    //        kernel/icons.js（e/I）；filters/notes/hasInjectEver/filteredCount/searchDebRef 经渲染函数入参注入（装配层 post-guard 新鲜值）
    // state 托管：filterOpen 留 hook 内 useState（与主面板同一渲染边界；§6 E 裁决记录见 panel/index.js 头注）；
    // filterOpenRef 为 Esc 栈的同步镜像（模块级单例——面板是 shell.overlay 单例，与昔日 FloatingPanel 内 useRef 等价）；
    // 浮层 JSX 依赖 post-guard 视图求值结果（filtered.length/hasInjectEver），故导出渲染函数由装配层在求值后调用（口径不变）
    const filterOpenRef = { current: false }
    function usePanelFilterPop(args) {
        const filters = args.filters, sortBy = args.sortBy
        const [filterOpen, setFilterOpen] = React.useState(false)
        React.useEffect(() => { filterOpenRef.current = filterOpen }, [filterOpen])
        // 筛选条件/排序变化即持久化（与 folders-expanded 等现有 localStorage 记忆同口径）
        React.useEffect(() => { try { localStorage.setItem('dsh-notes-filters', JSON.stringify({ filters, sortBy })) } catch (err) {} }, [filters, sortBy])
        function renderFilterPop(args) {
          const filters = args.filters, notes = args.notes, hasInjectEver = args.hasInjectEver, filteredCount = args.filteredCount, searchDebRef = args.searchDebRef
          return filterOpen ? e('div', { className: 'dsh-notes-fpop' },
                  e('div', { className: 'dsh-notes-fg-h' }, e('span', null, '状态'), e('span', { className: 'dsh-notes-fg-rule' }, '组内多选 = OR')),
                  FILTER_STATUS.filter(f => f.id !== 'injectEver' || hasInjectEver).map(f => e('label', { key: f.id, className: 'dsh-notes-fg-item' },
                    e('input', { type: 'checkbox', checked: filters[f.id] === true, onChange: (ev) => { setFilters(Object.assign({}, filters, { [f.id]: ev.target.checked })); if (searchDebRef.current) searchDebRef.current() } }),
                    I(f.icon, 11), e('span', { className: 'dsh-notes-fg-fl' }, f.label), e('span', { className: 'dsh-notes-fg-cnt' }, String(notes.filter(f.pred).length)))),
                  e('div', { className: 'dsh-notes-fg-h' }, e('span', null, '类型'), e('span', { className: 'dsh-notes-fg-rule' }, '组内 OR · 与状态组 = AND')),
                  FILTER_KINDS.map(k => e('label', { key: k, className: 'dsh-notes-fg-item' },
                    e('input', { type: 'checkbox', checked: filters.kinds.indexOf(k) >= 0, onChange: (ev) => { setFilters(Object.assign({}, filters, { kinds: ev.target.checked ? filters.kinds.concat(k) : filters.kinds.filter(x => x !== k) })); if (searchDebRef.current) searchDebRef.current() } }),
                    e('span', { className: 'dsh-notes-fg-dot', style: { background: 'var(--nkind-' + k + ')' } }), e('span', { className: 'dsh-notes-fg-fl' }, KIND_LABELS[k]), e('span', { className: 'dsh-notes-fg-cnt' }, String(notes.filter(n => (n.kind || 'note') === k).length)))),
                  e('div', { className: 'dsh-notes-fpop-foot' },
                    e('span', { className: 'dsh-notes-fpop-pcnt' }, '命中 ' + filteredCount + ' 条'),
                    e('button', { className: 'dsh-notes-pbtn', onClick: () => { setFilters(FILTERS0()); if (searchDebRef.current) searchDebRef.current() } }, '清空'),
                    e('button', { className: 'dsh-notes-pbtn primary', onClick: () => setFilterOpen(false) }, '完成'))) : null
        }
        return { filterOpen: filterOpen, setFilterOpen: setFilterOpen, renderFilterPop: renderFilterPop }
    }
