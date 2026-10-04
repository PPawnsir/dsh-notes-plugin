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
    // 键位表（与 keyboard.js 逐键核对，R-4 口径）：[键帽文案, 说明字典 key]——Ctrl+N 已改 Alt+N 的标注在此收口
    // i18n 覆盖卡E：说明列改存字典 key（cheat.*），渲染期 tt() 取值（Esc 行面板口径 = cheat.kEscClient；app 页面口径 = cheat.kEsc）
    const CHEATSHEET_ROWS = [
      ['Ctrl+K', 'cheat.kSearch'],
      ['Alt+N', 'cheat.kNew'],
      ['Ctrl+/', 'cheat.kMode'],
      ['j / ↓', 'cheat.kDown'],
      ['k / ↑', 'cheat.kUp'],
      ['Enter', 'cheat.kOpen'],
      ['↓', 'cheat.kSearchDown'],
      ['?', 'cheat.kSelf'],
      ['Esc', 'cheat.kEscClient'],
    ]
    // 速查表弹层宿主：复用设置卡片 mask/modal 样式（modal 不叠 modal）；Esc 关闭由 keyboard.js Esc 栈首段接管
    function CheatsheetModal() {
      const tt = useT()   // i18n 覆盖卡E：订阅 langStore，切语言本卡自渲染
      const cheatsheetOpen = store.modal.cheatsheet.useSel(s => s.open)
      return cheatsheetOpen ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setCheatsheetOpen(false) } },
        e('div', { className: 'dsh-notes-settings-modal dsh-notes-cheatsheet-modal' },
          e('div', { className: 'dsh-notes-settings-modal-t' }, I('kbd', 14), ' ' + tt('settings.cheatsheet'),
            e('span', { className: 'dsh-notes-settings-t-acts' },
              e('button', { className: 'dsh-notes-settings-close dsh-nt', 'data-tooltip': tt('cheat.closeTip'), onClick: () => setCheatsheetOpen(false) }, I('x', 12)))),
          e('div', { className: 'dsh-notes-data-hint' }, tt('cheat.hint')),
          e('div', { className: 'dsh-notes-cheatsheet-list' },
            CHEATSHEET_ROWS.map(r => e('div', { key: r[0], className: 'dsh-notes-cs-row' },
              e('span', { className: 'dsh-notes-cs-keys' }, e('kbd', null, r[0])),
              e('span', { className: 'dsh-notes-cs-desc' }, tt(r[1])))))))
        : null
    }
