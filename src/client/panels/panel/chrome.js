    // ===== panel/chrome —— 窗口 chrome：pos/size/sideW 态 + 标题栏/分隔条/resize 拖拽族（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelChrome（面板位置/尺寸/侧栏宽 state + 持久化/居中 effect + onTitlebarMouseDown/onResizeMouseDown/onSplitterMouseDown/resetSideW +
    //           titlebarEl/splitterEl/resizeEl JSX）
    // needs: kernel/state.js（setShowHelp 转发别名）、kernel/persist.js（loadSideW/saveSideW/SIDE_W_DEFAULT/clampSideW/entryMode/setEntryMode）、
    //        kernel/drag.js（drag）、kernel/icons.js（e/I）、modals/archive.js（openArchive）——序位在前；
    //        open/close/showHelp 经 hook 入参注入（装配层回填：open 主面板开合态、close 滞留装配层、showHelp 自 popovers/help.js 解构）
    // state 托管：pos/size/sideW/sideDrag 留 hook 内 useState（与主面板同一渲染边界；§6 E 裁决记录见 panel/index.js 头注）
    function usePanelChrome(args) {
        const open = args.open, close = args.close, showHelp = args.showHelp
        // i18n（notes-042-i18n-cov-a 覆盖卡A）：tt = useT()——订阅 langStore，切语言本 hook（随主面板）自渲染；标题栏/分隔条/resize 文案全走 tt()
        const tt = useT()
        const [pos, setPos] = React.useState({ x: null, y: null })
        const [size, setSize] = React.useState({ width: 920, height: 640 })
        // 侧栏宽度：分隔条拖拽调整（clamp 200px–60% 面板宽），localStorage 记忆（SIDE_W_KEY），双击分隔条重置缺省
        const [sideW, setSideW] = React.useState(() => loadSideW() || SIDE_W_DEFAULT)
        const [sideDrag, setSideDrag] = React.useState(false)   // 拖拽中：分隔条高亮 + body 禁文本选择
        const sideWRef = React.useRef(0)   // 拖拽期间最新宽镜像（mouseup 持久化读 ref，防闭包过期）
        React.useEffect(() => { try { const saved = localStorage.getItem('dsh-notes-panel-state'); if (saved) { const s = JSON.parse(saved); if (s.x !== undefined && s.y !== undefined) setPos({ x: s.x, y: s.y }); if (s.width !== undefined && s.height !== undefined) setSize({ width: s.width, height: s.height }) } } catch (err) {} }, [])
        function saveState() { try { localStorage.setItem('dsh-notes-panel-state', JSON.stringify({ x: pos.x, y: pos.y, width: size.width, height: size.height })) } catch (err) {} }
        React.useEffect(() => { if (open && pos.x === null) { const w = window.innerWidth; const h = window.innerHeight; setPos({ x: Math.max(w - 980, w * 0.3), y: Math.max(48, (h - 640) / 2) }) } }, [open])
        function onTitlebarMouseDown(ev) {
          if (ev.target.closest('.dsh-notes-titlebar-btn')) return
          const sx = ev.clientX, sy = ev.clientY, px = pos.x || 0, py = pos.y || 0
          drag((ev2) => setPos({ x: Math.max(0, Math.min(window.innerWidth - 200, px + ev2.clientX - sx)), y: Math.max(0, Math.min(window.innerHeight - 100, py + ev2.clientY - sy)) }), saveState)
        }
        function onResizeMouseDown(direction, ev) {
          ev.stopPropagation(); ev.preventDefault()
          const sx = ev.clientX, sy = ev.clientY, ox = pos.x || 0, oy = pos.y || 0, sw = size.width, sh = size.height
          drag((ev2) => {
            const dx = ev2.clientX - sx, dy = ev2.clientY - sy
            let nw = sw, nh = sh, nx = ox, ny = oy
            if (direction.indexOf('e') >= 0) nw = sw + dx
            if (direction.indexOf('s') >= 0) nh = sh + dy
            if (direction.indexOf('w') >= 0) nw = sw - dx
            if (direction.indexOf('n') >= 0) nh = sh - dy
            nw = Math.max(680, Math.min(window.innerWidth - 40, nw)); nh = Math.max(420, Math.min(window.innerHeight - 40, nh))
            if (direction.indexOf('w') >= 0) nx = ox + sw - nw
            if (direction.indexOf('n') >= 0) ny = oy + sh - nh
            setSize({ width: nw, height: nh }); setPos({ x: nx, y: ny })
          }, saveState)
        }
        // ===== 侧栏分隔条拖拽：mousedown 起拖 → drag() 内 document mousemove 按面板内相对坐标增量算宽 → mouseup 卸监听防泄漏 =====
        // 拖拽期间 body 挂 .dsh-notes-split-drag（禁文本选择 + 强制 col-resize）；mouseup 持久化（读 ref 防闭包过期）
        function onSplitterMouseDown(ev) {
          ev.preventDefault(); ev.stopPropagation()
          const appEl = ev.currentTarget.parentElement   // .dsh-notes-app（分隔条是两栏间的 flex 子项）
          const sx = ev.clientX, sw = sideW
          sideWRef.current = 0
          setSideDrag(true); document.body.classList.add('dsh-notes-split-drag')
          drag((ev2) => {
            const nw = clampSideW(sw + ev2.clientX - sx, appEl ? appEl.getBoundingClientRect().width : size.width)
            sideWRef.current = nw; setSideW(nw)
          }, () => {
            setSideDrag(false); document.body.classList.remove('dsh-notes-split-drag')
            if (sideWRef.current) saveSideW(sideWRef.current)
          })
        }
        // 双击分隔条 = 重置缺省宽度（清除持久化，回 styles.css 缺省 300px）
        function resetSideW() { sideWRef.current = SIDE_W_DEFAULT; setSideW(SIDE_W_DEFAULT); saveSideW(null) }
        const titlebarEl = e('div', { className: 'dsh-notes-titlebar dsh-nt', onMouseDown: onTitlebarMouseDown, 'data-tooltip': tt('chrome.dragMove') },
            e('span', { className: 'dsh-notes-titlebar-title' }, I('note', 14), tt('side.brand')),
            e('div', { className: 'dsh-notes-titlebar-actions' },
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: () => setEntryMode(entryMode === 'header' ? 'fab' : 'header'), 'data-tooltip': tt('chrome.entryModeTip') }, I('swap', 13)),
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: openArchive, 'data-tooltip': tt('topbar.archiveTip') }, tt('topbar.archive')),
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: () => setShowHelp(!showHelp), 'data-tooltip': tt('chrome.help') }, '?'),
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: close, 'data-tooltip': tt('common.close') }, '×')))
        const splitterEl = e('div', { className: 'dsh-notes-splitter dsh-nt' + (sideDrag ? ' on' : ''), onMouseDown: onSplitterMouseDown, onDoubleClick: resetSideW, 'data-tooltip': tt('side.splitterTip') })
        const resizeEl = e('div', { className: 'dsh-notes-resize-handle dsh-nt', style: { position: 'absolute', bottom: 0, right: 0 }, onMouseDown: (ev) => onResizeMouseDown('se', ev), 'data-tooltip': tt('chrome.resizeTip') })
        return { pos: pos, size: size, sideW: sideW, titlebarEl: titlebarEl, splitterEl: splitterEl, resizeEl: resizeEl }
    }
