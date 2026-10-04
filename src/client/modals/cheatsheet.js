    // ===== modal: cheatsheet —— 键盘流快捷键速查表（notes-034-f-cheatsheet：? 键唤起 + 设置卡入口）=====
    // provides: store.modal.cheatsheet / cheatsheetOpenRef / setCheatsheetOpen / openCheatsheet / CHEATSHEET_ROWS / CheatsheetModal
    // needs: kernel/state.js（store/createStore/panelBridge/setShowHelp 别名）、kernel/icons.js（e/I）
    // state 托管：open 迁入 store.modal.cheatsheet 切片；cheatsheetOpenRef 为 Esc 栈 / ? 键守卫的同步镜像
    // （模块级单例——面板是 shell.overlay 单例，与昔日 FloatingPanel 内 useRef 等价）
    // 键位清单与 panels/panel/keyboard.js 实现逐键核对（R-4 口径）：增改快捷键时必须同步本表 + app 页/原型同款表
    store.modal.cheatsheet = createStore({ open: false })
    const cheatsheetOpenRef = { current: false }   // 速查表镜像（Esc 优先关 / ? 键 toggle / 列表导航暂停）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：同步写 ref 镜像 + store（订阅方 = CheatsheetModal）
    function setCheatsheetOpen(v) { const nv = typeof v === 'function' ? v(cheatsheetOpenRef.current) : v; cheatsheetOpenRef.current = nv; store.modal.cheatsheet.set({ open: nv }) }
    // 打开入口（设置卡「键盘快捷键」行 / ? 键）：与设置卡片互斥（modal 不叠 modal，同注入管理先例）；帮助气泡同时收起
    function openCheatsheet() { panelBridge.setSettingsOpen(false); setShowHelp(false); setCheatsheetOpen(true) }
    // 键位表（与 keyboard.js 逐键核对，R-4 口径）：[键帽文案, 说明]——Ctrl+N 已改 Alt+N 的标注在此收口
    const CHEATSHEET_ROWS = [
      ['Ctrl+K', '聚焦搜索框'],
      ['Alt+N', '新建笔记（Ctrl+N 是浏览器保留键「新建窗口」，页面拿不到，故改用 Alt+N）'],
      ['Ctrl+/', '编辑器 源码 ⇄ 富文本 切换（编辑中生效；弹窗打开时不切）'],
      ['j / ↓', '列表焦点下移一行'],
      ['k / ↑', '列表焦点上移一行'],
      ['Enter', '打开焦点笔记'],
      ['↓', '搜索框内：直达列表首行（保留过滤上下文，搜索 → ↓ → j/k → Enter 纯键盘路径）'],
      ['?', '唤起 / 关闭本速查表'],
      ['Esc', '分层关闭：弹层/浮层/菜单 → 退出多选 → 清搜索并还焦列表 → 关闭面板'],
    ]
    // 速查表弹层宿主：复用设置卡片 mask/modal 样式（modal 不叠 modal）；Esc 关闭由 keyboard.js Esc 栈首段接管
    function CheatsheetModal() {
      const cheatsheetOpen = store.modal.cheatsheet.useSel(s => s.open)
      return cheatsheetOpen ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setCheatsheetOpen(false) } },
        e('div', { className: 'dsh-notes-settings-modal dsh-notes-cheatsheet-modal' },
          e('div', { className: 'dsh-notes-settings-modal-t' }, I('kbd', 14), ' 键盘快捷键',
            e('span', { className: 'dsh-notes-settings-t-acts' },
              e('button', { className: 'dsh-notes-settings-close dsh-nt', 'data-tooltip': '关闭（Esc / ?）', onClick: () => setCheatsheetOpen(false) }, I('x', 12)))),
          e('div', { className: 'dsh-notes-data-hint' }, '非输入焦点时生效；输入框 / 富文本内不响应 j/k、Enter、?。设置卡「键盘快捷键」行也可打开本表。'),
          e('div', { className: 'dsh-notes-cheatsheet-list' },
            CHEATSHEET_ROWS.map(r => e('div', { key: r[0], className: 'dsh-notes-cs-row' },
              e('span', { className: 'dsh-notes-cs-keys' }, e('kbd', null, r[0])),
              e('span', { className: 'dsh-notes-cs-desc' }, r[1]))))))
        : null
    }
