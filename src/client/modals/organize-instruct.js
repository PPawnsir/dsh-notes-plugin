    // ===== modal: organize-instruct —— AI 整理追加指令引导卡（0.4.4-F notes-044-organize-instruct）=====
    // provides: store.modal.organizeInstruct / setOrganizeInstructOpen / openOrganizeInstruct / closeOrganizeInstruct /
    //           confirmOrganizeInstruct / OrganizeInstructModal
    // needs: kernel/state.js（store/createStore/panelBridge）、kernel/icons.js（e/I）、kernel/i18n.js（useT）、kernel/bootstrap.js（host）
    // 交互定稿（用户裁决 2026-10-06）：点 ✨整理 → 弹引导卡（可选指令输入框 + 确认/取消）——
    //   留空确认 = instruction:''（host 空指令路径 prompt 与二期现行逐字节等价，节 84 锁定）；
    //   填写确认 = trim 后追加进 prompt（host 在【当前草稿】前插【用户追加指令】段）；取消/点遮罩 = 关卡零副作用。
    // 确认经 panelBridge.doAiOrganize(instr) 中转（modals 禁横向引用——editor.js hook 内 doAiOrganize 由 panel/index.js 回填），
    //   守卫（空正文/加载中/整理中）/一次撤销栈/容错全在 doAiOrganize 内复用，本卡只做输入收集。
    // state 托管：open/instr 迁入 store.modal.organizeInstruct 切片；Esc 栈不挂（dispatch/mount 同口径先例：遮罩/取消按钮关闭）。
    // 0.4.7-B⑥b/⑦（notes-047-ux）：超限前置校验——开卡携正文长度（bodyLen 由 editor 按钮位传入，本地长度零 RPC 等待）；
    //   生效上限 = notes-settings-get 响应 organizeMaxChars（⑦.4 增带，用户覆盖 || 模型表 || 12000；模块级缓存，首开后台对齐 host）；
    //   超限 → textarea 上方提示「本篇 N 字超上限 X，建议分段整理」+ 确认钮禁用（confirm 内同口径双闸）。
    store.modal.organizeInstruct = createStore({ open: false, instr: '', bodyLen: 0, maxChars: 0 })
    let orgMaxCache = 0   // 整理长度上限生效值会话级缓存（0 = 未拉取，暂用 12000 回落）
    panelBridge.orgMaxCacheReset = () => { orgMaxCache = 0 }   // 设置卡保存整理长度上限后失效（modals/settings.js 成功路径经 panelBridge 调用）
    function setOrganizeInstructOpen(v) { store.modal.organizeInstruct.set({ open: typeof v === 'function' ? v(store.modal.organizeInstruct.get().open) : v }) }
    // 打开即重置输入（上次填写不残留——每次整理独立决策）；bodyLen = 当前正文长度（0.4.7-B⑥b 前置校验数据源）
    function openOrganizeInstruct(bodyLen) {
      store.modal.organizeInstruct.set({ open: true, instr: '', bodyLen: bodyLen || 0, maxChars: orgMaxCache })
      if (!orgMaxCache) host.call('notes-settings-get', {}).then(res => {
        orgMaxCache = (res && typeof res.organizeMaxChars === 'number' && res.organizeMaxChars > 0) ? res.organizeMaxChars : 12000
        if (store.modal.organizeInstruct.get().open) store.modal.organizeInstruct.set({ maxChars: orgMaxCache })   // 弹卡还开着才复判（关窗静默）
      }).catch(() => { orgMaxCache = 12000 })   // 通道异常回落 12000 现状值（不阻塞开卡）
    }
    function closeOrganizeInstruct() { store.modal.organizeInstruct.set({ open: false, instr: '' }) }
    // 确认：先关卡再整理（弹层不滞留——整理中态由 meta 行「整理中…」按钮 + 正文区遮罩承载）；trim 在 doAiOrganize 内统一做；
    // 超限双闸（0.4.7-B⑥b）：按钮禁用为主，本守卫兜底（Enter 键入等旁路）
    function confirmOrganizeInstruct() {
      const m = store.modal.organizeInstruct.get()
      if (m.bodyLen > (m.maxChars || 12000)) return
      closeOrganizeInstruct()
      if (panelBridge.doAiOrganize) panelBridge.doAiOrganize(m.instr || '')
    }
    function OrganizeInstructModal() {
      const m = store.modal.organizeInstruct.useSel(s => s)
      const tt = useT()
      if (!m.open) return null
      const maxChars = m.maxChars || 12000
      const over = m.bodyLen > maxChars   // 0.4.7-B⑥b：超限态（提示 + 确认禁用）
      return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) closeOrganizeInstruct() } },
        e('div', { className: 'dsh-notes-settings-modal' },
          e('div', { className: 'dsh-notes-settings-modal-t' }, I('sparkle', 14), ' ' + tt('editor.organizeInstructTitle')),
          e('div', { className: 'dsh-notes-inj-mount-body' },
            over ? e('div', { className: 'dsh-notes-org-limit' }, tt('editor.organizeTooLong', { n: m.bodyLen, max: maxChars }) + '。' + tt('editor.organizeTooLongTip')) : null,
            e('textarea', { className: 'dsh-notes-inj-mount-when', rows: 3, placeholder: tt('editor.organizeInstructPlaceholder'), value: m.instr, autoFocus: true, onChange: (ev) => store.modal.organizeInstruct.set({ instr: ev.target.value }) })),
          e('div', { className: 'dsh-notes-dispatch-actions' },
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => closeOrganizeInstruct() }, tt('editor.organizeInstructCancel')),
            e('button', { className: 'dsh-notes-dispatch-ok', disabled: over, onClick: () => confirmOrganizeInstruct() }, tt('editor.organizeInstructConfirm')))))
    }
