    const d4 = slots.inject('shell.overlay', () => {
      // ===== 快速记录卡片 v2（原型 SelectionCapture 重做）：头部（选区速记 + 识别为引用徽章）→ 选区预览 → 补充输入 → 复制/记录/取消 =====
      // 触发链路不变：selectionchange + mouseup；提交链路不变：notes-quick-instruct（备注非空）/ notes-quick（kind=quote）
      function SelectionCapture() {
        perf.selRender++
        const [cap, setCap] = React.useState(null)   // 卡片位置（null=隐藏）
        const tt = useT()   // i18n 覆盖卡F：本组件独立订阅 langStore（shell.overlay 独立边界，切语言自渲染）；命令式 toast 同走 tt（=t 直读）
        // toast 宿主已迁 kernel（architecture-modular §6 步骤 C）：数据桶 = kernel/state.js toastStore，emit/自动消失计时 = kernel/bus.js setToast
        const toast = toastStore.useSel(s => s.toast)
        const [instrText, setInstrText] = React.useState('')
        const selTextRef = React.useRef('')
        const visibleRef = React.useRef(false)
        const instrRef = React.useRef(null)
        React.useEffect(() => {
          let mx = -1, my = -1, watchMouse = false, mouseDown = false
          function hide() { if (visibleRef.current) { visibleRef.current = false; setCap(null) } }
          function onMouseMove(ev) { if (!watchMouse) return; mx = ev.clientX; my = ev.clientY; perf.mousemoveTracked++ }
          function showFromSelection() {
            perf.selShowEval++
            const s0 = now()
            try {
              const sel = window.getSelection()
              const text = sel ? sel.toString().trim() : ''
              // 卡片已展开时，选区被点击清空（如点输入框）不关闭——只有卡片未展开且无选区才 hide
              if (!text || text.length < 2) { if (!visibleRef.current) hide(); return }
              let x, y
              if (mx >= 0) {
                x = mx - 150
                y = my + 14
              } else {
                let rect
                try { if (sel.rangeCount > 0) rect = sel.getRangeAt(0).getBoundingClientRect() } catch (err) {}
                if (rect && !(rect.width === 0 && rect.height === 0)) {
                  x = rect.left + rect.width / 2 - 150
                  y = rect.bottom + 8
                } else { hide(); return }
              }
              // 位置就近 + 视口内夹紧（卡片宽 300）
              x = Math.min(Math.max(8, x), Math.max(60, window.innerWidth - 314))
              y = Math.min(Math.max(8, y), Math.max(60, window.innerHeight - 220))
              selTextRef.current = text
              visibleRef.current = true
              // 位置没有实质变化时不触发重渲染
              setCap(prev => (prev && Math.abs(prev.x - x) < 2 && Math.abs(prev.y - y) < 2) ? prev : { x, y })
            } catch (err) {}
            finally { perf.selShowMs += now() - s0 }
          }
          // 一次性注册的防抖器：timer.timeout 每次调用都会在 fiber 上注册 ctx.effect，击键频率下是持续簿记开销
          const debouncedShow = timer.debounce(showFromSelection, 140)
          // v3：富文本编辑器内的划选归编辑器工具栏所有（加粗/链接等），不弹速记卡
          function inRichEditor() {
            try {
              const sel = window.getSelection()
              const an = sel && sel.rangeCount ? sel.anchorNode : null
              const el = an ? (an.nodeType === 1 ? an : an.parentNode) : null
              return !!(el && el.closest && el.closest('.dsh-notes-rich, .dsh-notes-rtb'))
            } catch (err) { return false }
          }
          function onSelectionChange() {
            perf.selChange++
            const sc0 = now()
            try {
              // 卡片已展开时保持稳定：避免聚焦输入框导致选区收起而误关（文本已在 selTextRef）
              if (visibleRef.current) return
              // 快速路径：光标态（无选区）直接跳过，不创建任何定时器——聊天输入框每次击键都触发本事件
              let collapsed = true
              let sel = null
              try { sel = window.getSelection(); collapsed = !sel || sel.isCollapsed } catch (err) {}
              if (collapsed) { perf.selCollapsedSkip++; watchMouse = false; hide(); return }
              if (inRichEditor()) { watchMouse = false; hide(); return }
              // 记录当前选区文本（供 mouseup 弹卡片预览与提交使用，提交不依赖实时选区）
              try { selTextRef.current = sel ? sel.toString().trim() : '' } catch (err) {}
              watchMouse = true
              // 鼠标拖拽中：只记录选区文本与跟踪坐标，等 mouseup 才弹卡片（避免拖拽中途弹出打断选区）
              if (mouseDown) return
              // 键盘选择（无鼠标按下）：正常防抖弹卡片
              debouncedShow()
            } finally { perf.selChangeMs += now() - sc0 }
          }
          function onMouseDown(ev) {
            if (ev.target.closest && ev.target.closest('.dsh-notes-cap')) return
            // 开始新一次拖拽：置位 mouseDown、停止旧坐标跟踪、隐藏旧卡片
            mouseDown = true; watchMouse = false; hide()
          }
          function onMouseUp(ev) {
            // 拖拽结束：清除 mouseDown；选区非折叠且文本≥2字符时弹卡片（校验在 showFromSelection 内部）
            mouseDown = false
            // 点击卡片内部（输入框/按钮）的 mouseup 不重新评估选区——否则点输入框清空选区后会误关卡片
            if (ev && ev.target && ev.target.closest && ev.target.closest('.dsh-notes-cap')) return
            if (inRichEditor()) return   // v3：富文本编辑器划选不弹速记卡
            showFromSelection()
          }
          document.addEventListener('selectionchange', onSelectionChange)
          document.addEventListener('mousemove', onMouseMove, { passive: true })
          document.addEventListener('mousedown', onMouseDown)
          document.addEventListener('mouseup', onMouseUp)
          return () => {
            document.removeEventListener('selectionchange', onSelectionChange)
            document.removeEventListener('mousemove', onMouseMove)
            document.removeEventListener('mousedown', onMouseDown)
            document.removeEventListener('mouseup', onMouseUp)
            if (debouncedShow && debouncedShow.dispose) debouncedShow.dispose()
          }
        }, [])
        // 弹卡片后不自动 focus 输入框：focus 会清除页面选区，打断拖拽并使选区丢失。
        // 选区文本已存于 selTextRef，提交不依赖实时选区；用户需备注时手动点击输入框（自然 focus）。
        // 选区预览：截断至 3 行 / 160 字符（原型上限），配合渐隐避免卡片过高
        function previewText(text) { if (!text) return ''; const lines = String(text).split(/\n/).slice(0, 3).join(' '); return lines.length > 160 ? lines.slice(0, 160) + '…' : lines }
        async function submit() {
          const text = selTextRef.current
          const note = instrText.trim()
          visibleRef.current = false; setCap(null); setInstrText('')
          if (window.getSelection()) window.getSelection().removeAllRanges()
          if (!text) return
          try {
            if (!note) {
              // 备注为空 → 现有逻辑（行为不变）
              const res = await host.call('notes-quick', { text: text, sessionId: currentSessionId, kind: 'quote' })
              if (res.error) { setToast(tt('cap.failed', { msg: res.error })) }
              // 敏感命中：host 已直接落 sensitive=true（注入自动脱敏），toast 追加标注告知
              else { setToast((res.merged ? tt('cap.mergedClient') : tt('cap.savedClient')) + (res.sensitiveSuggested ? tt('cap.sensSuffix') : '')); notifyNotesChanged() }
            } else {
              // 备注非空 → LLM 提取元数据，按返回结果 toast
              const res = await host.call('notes-quick-instruct', { text: text, note: note, sessionId: currentSessionId })
              if (res.error) { setToast(tt('cap.failed', { msg: res.error })) }
              else if (res.ok && res.applied) {
                const a = res.applied
                let msg = tt('cap.savedPlain')
                if (a.inject) msg = tt('cap.savedCtx', { role: tt(a.injectRole === 'reference' ? 'tree.roleReference' : 'tree.roleConvention') })   /* key 名 cap.savedCtx：规避 1-7 节旧布尔链路清零断言的裸子串扫描 */
                else if (a.tags && a.tags.length) msg = tt('cap.savedTags', { tags: '#' + a.tags.join(' #') })
                else if (a.kind && a.kind !== 'note' && a.kind !== 'quote') msg = tt('cap.savedKind', { kind: kindLabel(a.kind) || a.kind })
                else msg = res.merged ? tt('cap.mergedClient') : tt('cap.savedClient')
                if (res.sensitiveSuggested) msg += tt('cap.sensSuffix')
                setToast(msg); notifyNotesChanged()
              } else {
                setToast((res.merged ? tt('cap.mergedClient') : tt('cap.savedClient')) + (res.sensitiveSuggested ? tt('cap.sensSuffix') : '')); notifyNotesChanged()
              }
            }
          } catch (err) { setToast(tt('cap.failed', { msg: String(err.message || err) })) }
        }
        function cancel() { visibleRef.current = false; setCap(null); setInstrText(''); if (window.getSelection()) window.getSelection().removeAllRanges() }
        // 复制选区文本到剪贴板：优先 navigator.clipboard，不可用/失败时降级 execCommand；
        // 复制成功后与记录/取消一致关闭卡片并清选区（cancel 同款逻辑）；失败/无选区时保持卡片
        function fallbackCopy(text) {
          try {
            var ta = document.createElement('textarea')
            ta.value = text
            ta.style.position = 'fixed'
            ta.style.opacity = '0'
            ta.style.pointerEvents = 'none'
            document.body.appendChild(ta)
            ta.select()
            document.execCommand('copy')
            document.body.removeChild(ta)
            setToast(tt('cap.copied'))
            visibleRef.current = false; setCap(null); setInstrText(''); if (window.getSelection()) window.getSelection().removeAllRanges()
          } catch (err) { setToast(tt('cap.copyFailed')) }
        }
        function copySelection() {
          var text = selTextRef.current
          if (!text) { setToast(tt('cap.noSelection')); return }
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(function () {
                setToast(tt('cap.copied'))
                visibleRef.current = false; setCap(null); setInstrText(''); if (window.getSelection()) window.getSelection().removeAllRanges()
              }, function () { fallbackCopy(text) })
              return
            }
          } catch (err) {}
          fallbackCopy(text)
        }
        return e('div', null, cap ? e('div', { className: 'dsh-notes-cap', style: { left: cap.x + 'px', top: cap.y + 'px' } },
          e('div', { className: 'dsh-notes-cap-h' },
            e('span', { className: 'dsh-notes-cap-src' }, I('note', 11), tt('cap.title')),
            e('span', { className: 'dsh-notes-cap-auto' }, e('span', { className: 'dot' }), tt('cap.autoQuoteClient'))),
          e('div', { className: 'dsh-notes-cap-pv' }, previewText(selTextRef.current)),
          e('div', { className: 'dsh-notes-cap-in' },
            I('plus', 12),
            e('input', { ref: instrRef, className: 'dsh-notes-cap-input', type: 'text', placeholder: tt('cap.placeholderClient'), value: instrText, onChange: function (ev) { setInstrText(ev.target.value) }, onKeyDown: function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); submit() } else if (ev.key === 'Escape') { ev.preventDefault(); cancel() } } }),
            e('span', { className: 'dsh-notes-kbd' }, tt('cap.enterHint'))),
          e('div', { className: 'dsh-notes-cap-acts' },
            e('button', { className: 'dsh-notes-cbtn', onClick: copySelection }, I('note', 12), tt('cap.copy')),
            e('button', { className: 'dsh-notes-cbtn primary', onClick: submit }, I('check', 12), tt('cap.save')),
            e('button', { className: 'dsh-notes-cbtn', onClick: cancel }, tt('common.cancel'))
          )
        ) : null, e('div', { className: 'dsh-notes-toast' + (toast ? ' show' : '') + (toast && toast.act ? ' has-act' : '') },
          typeof toast === 'string' ? toast : (toast ? toast.msg : ''),
          toast && toast.act ? e('a', { className: 'dsh-notes-toast-act', onClick: () => { const fn = toast.act && toast.act.fn; setToast(''); try { if (fn) fn() } catch (err) {} } }, toast.act.label) : null))
      }
      slots.register({ name: 'shell.overlay', id: 'dsh-notes-selection', order: 201 }, () => e(SelectionCapture))
    })
    if (typeof d4 === 'function') disposers.push(d4)
