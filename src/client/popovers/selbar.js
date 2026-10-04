    // ===== popover: selbar —— 多选操作条（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelSelbar（selMode/selIds/selDelPending 态 + toggleSelMode/toggleSelId/doSelBatchDelete + 操作条 JSX）/ selModeRef
    // needs: kernel/state.js（panelBridge + setError/afterArchiveCleanup/loadNotes 转发别名）、kernel/bus.js（showToast）、
    //        kernel/format.js（notifyNotesChanged）、kernel/icons.js（e/I）、modals/merge.js（openMerge，序位在前）
    // state 托管：selMode/selIds 的 useState 声明原文被 check.js 锚定（26 节），连同 selDelPending 留 hook 内 useState——
    // popover 与主面板同一组件渲染边界，重渲染口径与昔日 FloatingPanel 内联态一致（§6 E 裁决记录见 panel/index.js 头注）；
    // selModeRef 为 Esc 栈/拖拽守卫的同步镜像（模块级单例——面板是 shell.overlay 单例，与昔日 FloatingPanel 内 useRef 等价）
    const selModeRef = { current: false }      // 多选态镜像（Esc 退出多选）
    function usePanelSelbar() {
        const [selMode, setSelMode] = React.useState(false)        // 列表多选态（复选框勾选，与搜索/过滤共存）
        const [selIds, setSelIds] = React.useState({})             // 多选勾选集合：noteId → true
        const [selDelPending, setSelDelPending] = React.useState(false)   // 多选批量删除执行中（按钮禁用防重入）
        React.useEffect(() => { selModeRef.current = selMode }, [selMode])
        // ===== 手动笔记多选合并：「选择」chip / 右键「合并为一篇」进多选态 → 底部操作条 → 标题输入 → notes-archive =====
        function toggleSelMode() { setSelMode(!selMode); setSelIds({}) }
        function toggleSelId(id) { setSelIds(prev => { const next = Object.assign({}, prev); if (next[id]) delete next[id]; else next[id] = true; return next }) }
        // 多选合并弹窗已拆出（modals/merge.js：openMerge/doMergeConfirm 迁入）；toggleSelMode/toggleSelId 属多选操作条域
        // 多选批量删除（软删进回收站，与整理建议器批量软删同通道）：确认强度 = 不可恢复性（notes-034-c-confirm）——
        // 软删可恢复 → 轻：无 confirm 直接删，撤销 toast 兜底（逐条 notes-restore；回收站亦可恢复）；不可恢复的 purge 才保留双确认
        async function doSelBatchDelete() {
          const ids = Object.keys(selIds)
          if (!ids.length || selDelPending) return
          setSelDelPending(true); setError('')
          let ok = 0, fail = 0
          const okIds = []
          for (const id of ids) {
            try { const res = await host.call('notes-delete', { id: id }); if (res && res.error) fail++; else { ok++; okIds.push(id) } }
            catch (err) { fail++ }
          }
          setSelDelPending(false); setSelMode(false); setSelIds({})
          showToast('已删除 ' + ok + ' 条（可在回收站恢复）' + (fail ? '，失败 ' + fail + ' 条' : ''), okIds.length ? { label: '撤销', fn: () => undoBatchDelete(okIds) } : undefined)
          afterArchiveCleanup(ids)   // 正打开的笔记在被删集合中则退出选中态（归档/建议器批量软删同款语义）
          await loadNotes(true); notifyNotesChanged()
        }
        // 批量软删撤销：逐条 notes-restore 恢复本次成功删除的笔记（单条删除撤销链路的批量复用）
        async function undoBatchDelete(ids) {
          let ok = 0, fail = 0
          for (const id of ids) {
            try { const res = await host.call('notes-restore', { id: id }); if (res && res.error) fail++; else ok++ }
            catch (err) { fail++ }
          }
          showToast('已恢复 ' + ok + ' 条' + (fail ? '，失败 ' + fail + ' 条' : ''))
          await loadNotes(true); notifyNotesChanged()
        }
        // 多选操作条（「选择」chip / 右键「合并为一篇」进多选态后浮于侧栏底部）：已选 N 条 | 合并 | 删除 | 取消
        const selbarEl = selMode ? e('div', { className: 'dsh-notes-selbar' },
            e('span', { className: 'dsh-notes-selbar-n' }, '已选 ' + Object.keys(selIds).length + ' 条'),
            e('button', { className: 'dsh-notes-dispatch-ok', onClick: openMerge, disabled: Object.keys(selIds).length < 2 }, '合并'),
            e('button', { className: 'dsh-notes-data-danger', onClick: doSelBatchDelete, disabled: Object.keys(selIds).length < 1 || selDelPending }, selDelPending ? '删除中…' : '删除'),
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: toggleSelMode }, '取消'))
          : null
        return { selMode: selMode, selIds: selIds, selDelPending: selDelPending, setSelMode: setSelMode, setSelIds: setSelIds, toggleSelMode: toggleSelMode, toggleSelId: toggleSelId, selbarEl: selbarEl }
    }
