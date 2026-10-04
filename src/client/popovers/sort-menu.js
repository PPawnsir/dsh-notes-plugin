    // ===== popover: sort-menu —— 排序菜单浮层（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelSortMenu（sortOpen 态 + 菜单 JSX + 筛选/排序共享点外关闭 effect）/ sortOpenRef
    // needs: kernel/state.js（panelBridge + setSortBy/setFilterOpen 转发别名）、kernel/constants.js（FILTER_SORTS）、kernel/icons.js（e/I）；
    //        sortBy/filterOpen 经 hook 入参注入（装配层回填，渲染期新鲜值）
    // state 托管：sortOpen 留 hook 内 useState（与主面板同一渲染边界；§6 E 裁决记录见 panel/index.js 头注）；
    // sortOpenRef 为 Esc 栈的同步镜像（模块级单例——面板是 shell.overlay 单例，与昔日 FloatingPanel 内 useRef 等价）；
    // 筛选 popover + 排序菜单共享同一点外关闭 effect（均在 .dsh-notes-filterbar 内）——随序位在后的本模块收容（同文）
    const sortOpenRef = { current: false }
    function usePanelSortMenu(args) {
        const sortBy = args.sortBy
        const filterOpen = args.filterOpen
        const [sortOpen, setSortOpen] = React.useState(false)
        React.useEffect(() => { sortOpenRef.current = sortOpen }, [sortOpen])
        // 筛选中心浮层：点击外部关闭（popover + 排序菜单均在 .dsh-notes-filterbar 内，同一选择器覆盖）
        React.useEffect(() => {
          if (!filterOpen && !sortOpen) return
          const onDown = (ev) => { if (!(ev.target && ev.target.closest && ev.target.closest('.dsh-notes-filterbar'))) { setFilterOpen(false); setSortOpen(false) } }
          document.addEventListener('mousedown', onDown)
          return () => document.removeEventListener('mousedown', onDown)
        }, [filterOpen, sortOpen])
        const sortMenuEl = sortOpen ? e('div', { className: 'dsh-notes-fsort-menu' },
                    FILTER_SORTS.map(s => e('div', { key: s.id, className: 'dsh-notes-fsort-item' + (sortBy === s.id ? ' on' : ''), onClick: () => { setSortBy(s.id); setSortOpen(false) } }, e('span', { className: 'dsh-notes-fsort-tick' }, I('check', 11)), s.label, e('span', { className: 'dsh-notes-fsort-sd' }, s.desc)))) : null
        return { sortOpen: sortOpen, setSortOpen: setSortOpen, sortMenuEl: sortMenuEl }
    }
