    // ===== modal: organize-instruct —— AI 整理追加指令引导卡（0.4.4-F notes-044-organize-instruct）=====
    // provides: store.modal.organizeInstruct / setOrganizeInstructOpen / openOrganizeInstruct / closeOrganizeInstruct /
    //           confirmOrganizeInstruct / OrganizeInstructModal
    // needs: kernel/state.js（store/createStore/panelBridge）、kernel/icons.js（e/I）、kernel/i18n.js（useT）
    // 交互定稿（用户裁决 2026-10-06）：点 ✨整理 → 弹引导卡（可选指令输入框 + 确认/取消）——
    //   留空确认 = instruction:''（host 空指令路径 prompt 与二期现行逐字节等价，节 84 锁定）；
    //   填写确认 = trim 后追加进 prompt（host 在【当前草稿】前插【用户追加指令】段）；取消/点遮罩 = 关卡零副作用。
    // 确认经 panelBridge.doAiOrganize(instr) 中转（modals 禁横向引用——editor.js hook 内 doAiOrganize 由 panel/index.js 回填），
    //   守卫（空正文/加载中/整理中）/一次撤销栈/容错全在 doAiOrganize 内复用，本卡只做输入收集。
    // state 托管：open/instr 迁入 store.modal.organizeInstruct 切片；Esc 栈不挂（dispatch/mount 同口径先例：遮罩/取消按钮关闭）。
    store.modal.organizeInstruct = createStore({ open: false, instr: '' })
    function setOrganizeInstructOpen(v) { store.modal.organizeInstruct.set({ open: typeof v === 'function' ? v(store.modal.organizeInstruct.get().open) : v }) }
    // 打开即重置输入（上次填写不残留——每次整理独立决策）
    function openOrganizeInstruct() { store.modal.organizeInstruct.set({ open: true, instr: '' }) }
    function closeOrganizeInstruct() { store.modal.organizeInstruct.set({ open: false, instr: '' }) }
    // 确认：先关卡再整理（弹层不滞留——整理中态由 meta 行「整理中…」按钮承载）；trim 在 doAiOrganize 内统一做
    function confirmOrganizeInstruct() {
      const instr = store.modal.organizeInstruct.get().instr || ''
      closeOrganizeInstruct()
      if (panelBridge.doAiOrganize) panelBridge.doAiOrganize(instr)
    }
    function OrganizeInstructModal() {
      const m = store.modal.organizeInstruct.useSel(s => s)
      const tt = useT()
      if (!m.open) return null
      return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) closeOrganizeInstruct() } },
        e('div', { className: 'dsh-notes-settings-modal' },
          e('div', { className: 'dsh-notes-settings-modal-t' }, I('sparkle', 14), ' ' + tt('editor.organizeInstructTitle')),
          e('div', { className: 'dsh-notes-inj-mount-body' },
            e('textarea', { className: 'dsh-notes-inj-mount-when', rows: 3, placeholder: tt('editor.organizeInstructPlaceholder'), value: m.instr, autoFocus: true, onChange: (ev) => store.modal.organizeInstruct.set({ instr: ev.target.value }) })),
          e('div', { className: 'dsh-notes-dispatch-actions' },
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => closeOrganizeInstruct() }, tt('editor.organizeInstructCancel')),
            e('button', { className: 'dsh-notes-dispatch-ok', onClick: () => confirmOrganizeInstruct() }, tt('editor.organizeInstructConfirm')))))
    }
