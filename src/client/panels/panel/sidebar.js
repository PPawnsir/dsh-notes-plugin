    // ===== panel/sidebar —— 侧栏：brand 行 / 搜索框 / 筛选中心控制行 / 树容器 / side-foot（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: renderSidebar(R)（侧栏 JSX 注册函数，装配层 post-guard 调用）
    // needs: kernel/state.js（panelBridge 经 setter 转发别名 + searchRef/searchDebRef/searchInputRef 跨域镜像）、kernel/constants.js（PAGE_SIZE/FILTER_STATUS/KIND_LABELS）、
    //        kernel/persist.js（clampSideW）、kernel/icons.js（e/I）、modals/newnote.js（openNewNote）+ modals/trash.js（openTrash）+
    //        modals/settings.js（openSettings）——序位在前
    // state 托管：本域无自有 state（filters/sortBy 的 useState 声明原文被 check.js 锚定，滞留装配层「state 堆编排」；
    // §6 E 裁决记录见 panel/index.js 头注）；筛选持久化 effect 随 popovers/filter-pop.js（筛选中心条件编辑入口）收容
    function renderSidebar(R) {
              const sideW = R.sideW, size = R.size, notes = R.notes, filtersActive = R.filtersActive, filtered = R.filtered
              const filters = R.filters, sortBy = R.sortBy, searchText = R.searchText, filterCount = R.filterCount
              const filterOpen = R.filterOpen, sortOpen = R.sortOpen, sortLabel = R.sortLabel, sortMenuEl = R.sortMenuEl, filterPopEl = R.filterPopEl
              const treeEls = R.treeEls, hasMore = R.hasMore, paged = R.paged, onListScroll = R.onListScroll, selMode = R.selMode
              return e('aside', { className: 'dsh-notes-side', style: { width: clampSideW(sideW, size.width) + 'px' } },
              e('div', { className: 'dsh-notes-brand' },
                e('span', { className: 'dsh-notes-brand-logo' }, I('note', 13)),
                e('b', null, '笔记'),
                e('span', { className: 'dsh-notes-brand-cnt' }, (filtersActive ? filtered.length : notes.length) + ' 条'),
                // 新建入口（自旧 chips 行迁入 brand 行右侧，筛选中心口径⑥）
                e('span', { className: 'dsh-notes-brand-add dsh-nt', onClick: openNewNote, 'data-tooltip': '新建笔记（Ctrl+N）' }, I('plus', 13))),
              e('div', { className: 'dsh-notes-quick' },
                I('search', 14),
                e('input', { ref: searchInputRef, className: 'dsh-notes-quick-input', placeholder: '搜索笔记、标签、内容…', value: searchText, onChange: (ev) => { searchRef.current = ev.target.value; setSearchText(ev.target.value); setSearchIds(null); setVisibleCount(PAGE_SIZE); if (searchDebRef.current) searchDebRef.current() } }),
                e('span', { className: 'dsh-notes-kbd' }, 'Ctrl K')),
              // ===== 筛选中心控制行（design/notes-filter-center.html）：筛选按钮(N) + 激活条件 chips（单行横滚，× 单条移除）+ 独立排序控件 =====
              // 常态度 UI 只有 筛选按钮 + 排序控件（+ 激活 chips）；popover 是唯一条件编辑入口（浮层，不挤压树区）
              e('div', { className: 'dsh-notes-filterbar' },
                e('button', { className: 'dsh-notes-fbtn-filter' + (filterCount > 0 || filterOpen ? ' on' : '') + ' dsh-nt', onClick: () => { setFilterOpen(!filterOpen); if (!filterOpen) setSortOpen(false) }, 'aria-expanded': filterOpen ? 'true' : 'false', 'data-tooltip': '筛选中心：分组勾选条件（组内 OR / 跨组 AND）' }, I('filter', 11), '筛选', filterCount > 0 ? e('span', { className: 'dsh-notes-fcnt' }, String(filterCount)) : null),
                e('div', { className: 'dsh-notes-fchips' },
                  FILTER_STATUS.filter(f => filters[f.id]).map(f => e('span', { key: f.id, className: 'dsh-notes-fchip dsh-nt', 'data-tooltip': '筛选条件：状态 / ' + f.label + '（点 × 移除）' }, I(f.icon, 10), f.label, e('span', { className: 'dsh-notes-fchip-x', onClick: () => setFilters(Object.assign({}, filters, { [f.id]: false })) }, I('x', 9)))),
                  filters.kinds.map(k => e('span', { key: 'k-' + k, className: 'dsh-notes-fchip dsh-nt', 'data-tooltip': '筛选条件：类型 / ' + KIND_LABELS[k] + '（点 × 移除）' }, e('span', { className: 'dsh-notes-fchip-dot', style: { background: 'var(--nkind-' + k + ')' } }), KIND_LABELS[k], e('span', { className: 'dsh-notes-fchip-x', onClick: () => setFilters(Object.assign({}, filters, { kinds: filters.kinds.filter(x => x !== k) })) }, I('x', 9))))),
                e('div', { className: 'dsh-notes-fsort-wrap' },
                  e('button', { className: 'dsh-notes-fsort-btn' + (sortBy !== 'time' || sortOpen ? ' on' : '') + ' dsh-nt', onClick: () => { setSortOpen(!sortOpen); if (!sortOpen) setFilterOpen(false) }, 'data-tooltip': '排序（与筛选正交，互不重置）' }, I('sort', 11), sortLabel),
                  sortMenuEl),
                filterPopEl),
              e('div', { className: 'dsh-notes-tree', onScroll: onListScroll },
                treeEls,
                hasMore ? e('div', { className: 'dsh-notes-more' }, '继续滚动加载更多（已显示 ' + paged.length + ' / ' + filtered.length + '）') : null),
              // 底部：回收站 + 选择（多选合并，自旧 chips 行迁入）+ 设置；导出/导入 → 设置卡片「数据」区，整理建议 → 设置卡片「整理建议」行（open* 逻辑不变）
              e('div', { className: 'dsh-notes-side-foot' },
                e('span', { className: 'dsh-notes-fbtn dsh-nt', onClick: openTrash, 'data-tooltip': '回收站：查看已删除的笔记，可恢复或彻底删除' }, I('trash', 12), '回收站'),
                e('span', { className: 'dsh-notes-fbtn' + (selMode ? ' on' : '') + ' dsh-nt', onClick: toggleSelMode, 'data-tooltip': '多选笔记：勾选后可合并为一篇（Esc 退出）' }, I('check', 12), '选择'),
                e('span', { className: 'dsh-notes-fbtn dsh-nt', onClick: openSettings, 'data-tooltip': '设置' }, I('gear', 12), '设置')))
    }
