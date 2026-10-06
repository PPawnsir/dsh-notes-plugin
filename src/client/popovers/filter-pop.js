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
        // 0.4.4-D（notes-044-hidden-attr）：showHidden 显隐开关（panel/index.js 态经入参注入；写入经 kernel 转发别名 setShowHidden +
        // saveShowHidden 独立键持久——与筛选条件正交，「清空」不重置本开关）
        const showHidden = args.showHidden === true
        const [filterOpen, setFilterOpen] = React.useState(false)
        React.useEffect(() => { filterOpenRef.current = filterOpen }, [filterOpen])
        // 筛选条件/排序变化即持久化（与 folders-expanded 等现有 localStorage 记忆同口径）
        React.useEffect(() => { try { localStorage.setItem('dsh-notes-filters', JSON.stringify({ filters, sortBy })) } catch (err) {} }, [filters, sortBy])
        function renderFilterPop(args) {
          const filters = args.filters, notes = args.notes, hasInjectEver = args.hasInjectEver, filteredCount = args.filteredCount, searchDebRef = args.searchDebRef
          // i18n 覆盖卡F：FILTER_STATUS.label/KIND_LABELS 字面量仅作四端同构锚，渲染经 filterStatusLabel/kindLabel 条件映射走 t()
          return filterOpen ? e('div', { className: 'dsh-notes-fpop' },
                  e('div', { className: 'dsh-notes-fg-h' }, e('span', null, t('filter.statusGroup')), e('span', { className: 'dsh-notes-fg-rule' }, t('filter.ruleOr'))),
                  FILTER_STATUS.filter(f => f.id !== 'injectEver' || hasInjectEver).map(f => e('label', { key: f.id, className: 'dsh-notes-fg-item' },
                    e('input', { type: 'checkbox', checked: filters[f.id] === true, onChange: (ev) => { setFilters(Object.assign({}, filters, { [f.id]: ev.target.checked })); if (searchDebRef.current) searchDebRef.current() } }),
                    I(f.icon, 11), e('span', { className: 'dsh-notes-fg-fl' }, filterStatusLabel(f.id)), e('span', { className: 'dsh-notes-fg-cnt' }, String(notes.filter(f.pred).length)))),
                  e('div', { className: 'dsh-notes-fg-h' }, e('span', null, t('filter.kindGroup')), e('span', { className: 'dsh-notes-fg-rule' }, t('filter.ruleOrAnd'))),
                  FILTER_KINDS.map(k => e('label', { key: k, className: 'dsh-notes-fg-item' },
                    e('input', { type: 'checkbox', checked: filters.kinds.indexOf(k) >= 0, onChange: (ev) => { setFilters(Object.assign({}, filters, { kinds: ev.target.checked ? filters.kinds.concat(k) : filters.kinds.filter(x => x !== k) })); if (searchDebRef.current) searchDebRef.current() } }),
                    e('span', { className: 'dsh-notes-fg-dot', style: { background: 'var(--nkind-' + k + ')' } }), e('span', { className: 'dsh-notes-fg-fl' }, kindLabel(k)), e('span', { className: 'dsh-notes-fg-cnt' }, String(notes.filter(n => (n.kind || 'note') === k).length)))),
                  // 0.4.4-D：显示组——「显示隐藏」显隐开关（OS 文件管理对齐；独立持久键，非筛选条件——不计 filterCount/清空不重置）
                  e('div', { className: 'dsh-notes-fg-h' }, e('span', null, t('filter.displayGroup'))),
                  e('label', { className: 'dsh-notes-fg-item', 'data-tooltip': t('filter.showHiddenTip') },
                    e('input', { type: 'checkbox', checked: showHidden, onChange: (ev) => { setShowHidden(ev.target.checked); saveShowHidden(ev.target.checked) } }),
                    I('eye', 11), e('span', { className: 'dsh-notes-fg-fl' }, t('filter.showHidden'))),
                  e('div', { className: 'dsh-notes-fpop-foot' },
                    e('span', { className: 'dsh-notes-fpop-pcnt' }, t('filter.hitCount', { n: filteredCount })),
                    e('button', { className: 'dsh-notes-pbtn', onClick: () => { setFilters(FILTERS0()); if (searchDebRef.current) searchDebRef.current() } }, t('filter.clear')),
                    e('button', { className: 'dsh-notes-pbtn primary', onClick: () => setFilterOpen(false) }, t('filter.done')))) : null
        }
        return { filterOpen: filterOpen, setFilterOpen: setFilterOpen, renderFilterPop: renderFilterPop }
    }
