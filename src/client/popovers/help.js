    // ===== popover: help —— 使用说明气泡（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelHelp（showHelp 态 + 气泡 JSX）
    // needs: kernel/icons.js（e/I）；跨域写入（标题栏「?」按钮）经 kernel/state.js setShowHelp 转发别名 → panelBridge
    // state 托管：showHelp 留 hook 内 useState——popover 与主面板同一组件渲染边界（注册函数经 panel/index.js 装配调用），
    // 重渲染口径与昔日 FloatingPanel 内联态完全一致；check 锚定 useState 族不迁 store（§6 E 裁决记录见 panel/index.js 头注）
    function usePanelHelp() {
        const [showHelp, setShowHelp] = React.useState(false)
        // i18n 覆盖卡F：气泡文案走 t() 字典（help.* 域；标题复用 A 卡 chrome.help）；kbd 键名段与文案段分离拼装
        const helpEl = showHelp ? e('div', { className: 'dsh-notes-help-bubble' },
            e('button', { className: 'dsh-notes-help-close', onClick: () => setShowHelp(false) }, '×'),
            e('h4', null, t('chrome.help')),
            e('ul', null,
              e('li', null, t('help.newPre'), e('kbd', null, 'Alt+N'), t('help.newPost')),
              e('li', null, t('help.capture')),
              e('li', null, t('help.mergeWin')),
              e('li', null, t('help.topic')),
              e('li', null, t('help.drag')),
              e('li', null, t('help.keysLead'), e('kbd', null, 'Ctrl+K'), t('help.keysSearch'), e('kbd', null, '↓'), t('help.keysSearchEnd'), e('kbd', null, 'Alt+N'), t('help.keysNew'), e('kbd', null, 'j/k'), t('help.keysMoveOr'), e('kbd', null, '↑↓'), t('help.keysMoveEnd'), e('kbd', null, 'Enter'), t('help.keysOpen'), e('kbd', null, 'Esc'), t('help.keysEsc')),
              e('li', null, t('help.cheatPre'), e('kbd', null, '?'), t('help.cheatPost')),
              e('li', null, t('help.archive')),
              e('li', null, t('help.organize')),
              e('li', null, t('help.image')),
              e('li', null, t('help.delete')))) : null
        return { showHelp: showHelp, setShowHelp: setShowHelp, helpEl: helpEl }
    }
