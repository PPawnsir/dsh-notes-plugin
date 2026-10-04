    const listeners = new Set()
    const noteRefreshListeners = new Set()
    let panelOpen = false
    let currentSessionId = ''
    let toastEmit = null
    // toast 支持动作按钮：act = { label, fn }（先例 = app.html toast(m, act)；归档「撤销」用它）
    function showToast(msg, act) { try { if (toastEmit) toastEmit(act && act.label ? { msg: msg, act: act } : msg) } catch (e) {} }

    // ===== toast 宿主（architecture-modular §6 步骤 C：由 SelectionCapture 内 state 迁入 kernel/bus）=====
    // 数据桶 toastStore 在 kernel/state.js 回填（createStore 序位在后，bus 不可前向引用，故此处仅声明挂点）；
    // emit/自动消失计时在本文件——showToast/toastEmit 契约不变：toast 值 '' = 无；string = 纯文本；{ msg, act } = 带动作按钮
    let toastStore = null
    let toastTimerOff = null
    function setToast(toast) {
      if (toastTimerOff) { try { toastTimerOff() } catch (err) {} toastTimerOff = null }
      toastStore.set({ toast: toast })
      // toast 自动消失：带动作按钮（如归档「撤销」）时延长展示（先例 = app.html toast(m, act) 的 4200ms）
      if (toast) toastTimerOff = timer.timeout(() => setToast(''), typeof toast === 'object' && toast.act ? 4200 : 2600)
    }
    toastEmit = setToast
