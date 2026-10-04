    // ===== popover: help —— 使用说明气泡（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelHelp（showHelp 态 + 气泡 JSX）
    // needs: kernel/icons.js（e/I）；跨域写入（标题栏「?」按钮）经 kernel/state.js setShowHelp 转发别名 → panelBridge
    // state 托管：showHelp 留 hook 内 useState——popover 与主面板同一组件渲染边界（注册函数经 panel/index.js 装配调用），
    // 重渲染口径与昔日 FloatingPanel 内联态完全一致；check 锚定 useState 族不迁 store（§6 E 裁决记录见 panel/index.js 头注）
    function usePanelHelp() {
        const [showHelp, setShowHelp] = React.useState(false)
        const helpEl = showHelp ? e('div', { className: 'dsh-notes-help-bubble' },
            e('button', { className: 'dsh-notes-help-close', onClick: () => setShowHelp(false) }, '×'),
            e('h4', null, '使用说明'),
            e('ul', null,
              e('li', null, '点侧栏「新建」或按 ', e('kbd', null, 'Ctrl+N'), ' 输入标题新建笔记，创建后直接编辑正文'),
              e('li', null, '在页面划选文字松手，弹出快速记录卡片（自动识别为引用）'),
              e('li', null, '同一会话 10 分钟内的速记自动合并'),
              e('li', null, '点面包屑/编辑器里的主题可按主题全局过滤（跨文件夹）'),
              e('li', null, '拖笔记到文件夹行移入，拖到树根部未入夹笔记区移出（拖拽中显示落点提示）'),
              e('li', null, '快捷键：', e('kbd', null, 'Ctrl+K'), ' 搜索、', e('kbd', null, 'Ctrl+N'), ' 新建、', e('kbd', null, 'j/k'), ' 或 ', e('kbd', null, '↑↓'), ' 移动、', e('kbd', null, 'Enter'), ' 打开、', e('kbd', null, 'Esc'), ' 关闭'),
              e('li', null, '「归档」：弹出预览，勾选速记组后才合并（可撤销）；手动笔记点「选择」多选合并'),
              e('li', null, '编辑器「整理」：AI 按类型模板重写正文（替换后可撤销一次）；新建笔记按类型预填模板骨架'),
              e('li', null, '图片超过 1MB 自动压缩转 JPEG；设置卡片「资产清理」清理未被引用的孤儿文件'),
              e('li', null, '删除是软删除：侧栏底部「回收站」可恢复或彻底删除（彻底删除不可恢复）'))) : null
        return { showHelp: showHelp, setShowHelp: setShowHelp, helpEl: helpEl }
    }
