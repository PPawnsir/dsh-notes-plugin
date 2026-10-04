    // ===== modal: suggest —— 整理建议对话框（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出）=====
    // provides: store.modal.suggest / suggestOpenRef / setSuggestOpen / setSuggestData / setSuggestPending / setLogHgExpand /
    //           openSuggest / loadSuggest / suggestGoArchive / suggestViewNote / SuggestModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError/jumpToWikiTarget 别名）、kernel/format.js（fmtBytes）、
    //        kernel/icons.js（e/I）、kernel/bus.js（showToast/notifyNotesChanged）、modals/archive.js（openArchive，序位在前可见）
    // state 托管：open/data/pending/logHgExpand 迁入 store.modal.suggest 切片；suggestOpenRef 为 Esc 栈同步镜像（模块级单例）；
    // 「去归档」直调 archive 模块 openArchive（同域序位共享）；孤儿「查看」经 kernel jumpToWikiTarget 转发别名；
    // 批量软删收尾（afterArchiveCleanup/loadNotes）经 panelBridge 中转；与设置卡片互斥经 panelBridge.setSettingsOpen 中转
    store.modal.suggest = createStore({ open: false, data: null, pending: false, logHgExpand: {} })
    const suggestOpenRef = { current: false }   // 整理建议对话框镜像（Esc 优先关）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setSuggestOpen(v) { const nv = typeof v === 'function' ? v(suggestOpenRef.current) : v; suggestOpenRef.current = nv; store.modal.suggest.set({ open: nv }) }
    function setSuggestData(v) { store.modal.suggest.set({ data: typeof v === 'function' ? v(store.modal.suggest.get().data) : v }) }
    function setSuggestPending(v) { store.modal.suggest.set({ pending: typeof v === 'function' ? v(store.modal.suggest.get().pending) : v }) }
    function setLogHgExpand(v) { store.modal.suggest.set({ logHgExpand: typeof v === 'function' ? v(store.modal.suggest.get().logHgExpand) : v }) }
    // ===== 整理建议（设置卡片「整理建议」行入口）：notes-suggest（dry-run 零写入）四段式 modal =====
    // 契约：{ archiveCandidates:速记组（结构与 notes-archive-preview 同源）, staleCandidates:过期未引用, orphanCandidates:孤儿（仅展示）, logHygieneCandidates:{weekly,monthly}:日志卫生（工作记忆 v0，仅展示明细）, generatedAt }
    // 红线：只提名不自动执行——速记组「去归档」直达归档预览对话框；过期未引用「一键批量软删除」无 confirm 直接逐条 notes-delete（软删可恢复，撤销 toast 兜底——确认强度 = 不可恢复性，notes-034-c-confirm）；
    // 孤儿候选是启发式判定（可能误伤），不提供批量操作，逐条跳转人工过目；日志卫生 v0 仅展开明细（聚合执行留待 Phase 2，日志只聚合不淘汰）。
    function openSuggest() {
      setSuggestData(null); setSuggestPending(false); setError('')
      panelBridge.setSettingsOpen(false); setSuggestOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入同款）
      loadSuggest()
    }
    function loadSuggest() {
      const empty = { archiveCandidates: [], staleCandidates: [], orphanCandidates: [], logHygieneCandidates: { weekly: [], monthly: [] } }
      host.call('notes-suggest', {}).then(res => {
        if (res && res.error) { setError(res.error); setSuggestData(empty); return }
        setSuggestData(res || empty)
      }).catch(err => { setError(String(err.message || err)); setSuggestData(empty) })
    }
    // 速记组「去归档」：关建议框 → 复用归档预览对话框（数据同源，勾选/执行/撤销链路不变）
    function suggestGoArchive() { setSuggestOpen(false); openArchive() }
    // 孤儿「查看」：关建议框 → 双链跳转同款（目标被当前视图/kind/置顶过滤藏掉时退回「全部」再选中）
    function suggestViewNote(id) { setSuggestOpen(false); jumpToWikiTarget(id) }
    // 整理建议对话框宿主（设置卡片「整理建议」行入口；复用归档预览的列表样式）：
    // 四段式——① 可整理的速记组（「去归档」直达归档预览对话框，数据与 notes-archive-preview 同源）
    //          ② 过期未引用（超 staleDays 且 useCount=0；「一键批量软删除」直接逐条 notes-delete，撤销 toast 兜底）
    //          ③ 可能无用（孤儿候选：启发式判定可能误伤，仅展示逐条「查看」跳转，不提供批量操作）
    //          ④ 日志卫生（工作记忆 v0：超窗日志 周/月 聚合提名——只提名不执行，v0 「明细」展开逐条「查看」）
    function SuggestModal(props) {
      const tt = useT()   // i18n 覆盖卡E：订阅 langStore，切语言本卡自渲染（模块级 handler 走 t() 直读当下语言态）
      const suggestOpen = store.modal.suggest.useSel(s => s.open)
      const suggestData = store.modal.suggest.useSel(s => s.data)
      const suggestPending = store.modal.suggest.useSel(s => s.pending)
      const logHgExpand = store.modal.suggest.useSel(s => s.logHgExpand)
      const error = props.error
      // 过期未引用一键批量软删：确认强度 = 不可恢复性（notes-034-c-confirm）——软删可恢复 → 轻：无 confirm 直接删，
      // 撤销 toast 兜底（逐条 notes-restore；回收站亦可恢复）；删后刷新建议数据（三段联动，全空 → 空态文案）+ 列表
      async function doSuggestBatchDelete() {
        const list = (suggestData && suggestData.staleCandidates) || []
        if (!list.length || suggestPending) return
        setSuggestPending(true); setError('')
        let ok = 0, fail = 0
        const okIds = []
        for (const n of list) {
          try { const res = await host.call('notes-delete', { id: n.id }); if (res && res.error) fail++; else { ok++; okIds.push(n.id) } }
          catch (err) { fail++ }
        }
        setSuggestPending(false)
        showToast(t('sugg.softDeleted', { ok: ok }) + (fail ? t('inj.batchDoneFail', { n: fail }) : ''), okIds.length ? { label: t('meta.undo'), fn: () => undoSuggestBatchDelete(okIds) } : undefined)
        panelBridge.afterArchiveCleanup(list.map(n => n.id))   // 正打开的笔记在被删集合中则退出选中态（归档收尾同款语义）
        await panelBridge.loadNotes(true); notifyNotesChanged()
        loadSuggest()
      }
      // 建议器批量软删撤销：逐条 notes-restore 恢复本次成功删除的笔记，恢复后刷新建议数据与列表
      async function undoSuggestBatchDelete(ids) {
        let ok = 0, fail = 0
        for (const id of ids) {
          try { const res = await host.call('notes-restore', { id: id }); if (res && res.error) fail++; else ok++ }
          catch (err) { fail++ }
        }
        showToast(t('common.restoredBatch', { ok: ok }) + (fail ? t('inj.batchDoneFail', { n: fail }) : ''))
        await panelBridge.loadNotes(true); notifyNotesChanged()
        loadSuggest()
      }
      return suggestOpen ? (() => {
        const d = suggestData
        const arch = (d && d.archiveCandidates) || []
        const stale = (d && d.staleCandidates) || []
        const orphans = (d && d.orphanCandidates) || []
        // 工作记忆 v0 日志卫生（第四段）：周聚合/月聚合两组提名（只提名不执行——v0 仅展示明细，聚合执行留待 Phase 2）
        const logHg = (d && d.logHygieneCandidates) || { weekly: [], monthly: [] }
        const logHgGroups = logHg.weekly.map(g => ({ g: g, tier: tt('sugg.tierWeekly') })).concat(logHg.monthly.map(g => ({ g: g, tier: tt('sugg.tierMonthly') })))
        const allEmpty = d !== null && arch.length === 0 && stale.length === 0 && orphans.length === 0 && logHgGroups.length === 0
        return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget && !suggestPending) setSuggestOpen(false) } },
          e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal dsh-notes-arch-modal dsh-notes-suggest-modal' },
            e('div', { className: 'dsh-notes-settings-modal-t' }, I('sparkle', 14), ' ' + tt('settings.suggest'), e('span', { className: 'dsh-notes-imgup-sub' }, tt('sugg.sub'))),
            d === null
              ? e('div', { className: 'dsh-notes-data-hint' }, tt('sugg.analyzing'))
              : allEmpty
                ? e('div', { className: 'dsh-notes-data-hint' }, tt('sugg.clean'))
                : e(React.Fragment, null,
                    e('div', { className: 'dsh-notes-suggest-sec' },
                      e('div', { className: 'dsh-notes-suggest-sec-t' }, tt('sugg.secArch'), e('span', { className: 'dsh-notes-suggest-sec-n' }, tt('sugg.countGroups', { n: arch.length })),
                        arch.length ? e('button', { className: 'dsh-notes-trash-act', onClick: suggestGoArchive }, tt('sugg.goArch')) : null),
                      arch.length
                        ? e('div', { className: 'dsh-notes-arch-list' },
                            arch.map(g => {
                              const span = g.dateSpan && g.dateSpan.from ? (g.dateSpan.from === g.dateSpan.to ? g.dateSpan.from : g.dateSpan.from + ' ~ ' + g.dateSpan.to) : ''
                              return e('div', { key: g.sessionId, className: 'dsh-notes-arch-row' },
                                e('span', { className: 'dsh-notes-arch-ti', title: g.title }, g.title),
                                e('span', { className: 'dsh-notes-arch-meta' }, tt('arch.groupMeta', { span: span, n: g.members.length, size: fmtBytes(g.totalBytes) }) + ((g.totalUseCount || 0) > 0 ? tt('arch.groupUseCount', { n: g.totalUseCount }) : '')))
                            }))
                        : e('div', { className: 'dsh-notes-data-hint' }, tt('arch.empty'))),
                    e('div', { className: 'dsh-notes-suggest-sec' },
                      e('div', { className: 'dsh-notes-suggest-sec-t' }, tt('sugg.secStale'), e('span', { className: 'dsh-notes-suggest-sec-n' }, tt('sugg.countItems', { n: stale.length })),
                        stale.length ? e('button', { className: 'dsh-notes-trash-act danger', onClick: doSuggestBatchDelete, disabled: suggestPending }, suggestPending ? tt('sugg.deleting') : tt('sugg.batchDel')) : null),
                      stale.length
                        ? e('div', { className: 'dsh-notes-arch-list' },
                            stale.map(n => e('div', { key: n.id, className: 'dsh-notes-arch-row' },
                              e('span', { className: 'dsh-notes-arch-ti', title: n.title || 'Untitled' }, n.title || 'Untitled'),
                              e('span', { className: 'dsh-notes-arch-meta' }, (n.topic || tt('meta.uncategorized')) + ' · ' + tt('sugg.staleDays', { n: n.staleDays })))))
                        : e('div', { className: 'dsh-notes-data-hint' }, tt('sugg.staleEmpty'))),
                    e('div', { className: 'dsh-notes-suggest-sec' },
                      e('div', { className: 'dsh-notes-suggest-sec-t' }, tt('sugg.secOrphan'), e('span', { className: 'dsh-notes-suggest-sec-n' }, tt('sugg.countItems', { n: orphans.length }))),
                      orphans.length
                        ? e('div', { className: 'dsh-notes-arch-list' },
                            orphans.map(n => e('div', { key: n.id, className: 'dsh-notes-arch-row' },
                              e('span', { className: 'dsh-notes-arch-ti', title: n.title || 'Untitled' }, n.title || 'Untitled'),
                              e('span', { className: 'dsh-notes-arch-meta' }, (n.topic || tt('meta.uncategorized')) + ' · ' + (n.updatedAt ? fmtDT(n.updatedAt).slice(0, 10) : '—')),
                              e('button', { className: 'dsh-notes-trash-act', onClick: () => suggestViewNote(n.id) }, tt('sugg.view')))))
                        : e('div', { className: 'dsh-notes-data-hint' }, tt('sugg.orphanEmpty'))),
                    // ④ 日志卫生（工作记忆 v0 裁决 B②：超窗旧日志两级聚合提名——只提名不执行，v0 展开明细逐条过目）
                    e('div', { className: 'dsh-notes-suggest-sec' },
                      e('div', { className: 'dsh-notes-suggest-sec-t' }, tt('sugg.secLogHg'), e('span', { className: 'dsh-notes-suggest-sec-n' }, tt('sugg.countGroups', { n: logHgGroups.length }))),
                      logHgGroups.length
                        ? e('div', { className: 'dsh-notes-arch-list' },
                            logHgGroups.map(({ g, tier }) => e(React.Fragment, { key: tier + g.key },
                              e('div', { className: 'dsh-notes-arch-row' },
                                e('span', { className: 'dsh-notes-arch-ti', title: g.title }, g.title),
                                e('span', { className: 'dsh-notes-arch-meta' }, tt('sugg.logHgMeta', { tier: tier, n: g.members.length })),
                                e('button', { className: 'dsh-notes-trash-act', onClick: () => setLogHgExpand(prev => { const nx = Object.assign({}, prev); if (nx[tier + g.key]) delete nx[tier + g.key]; else nx[tier + g.key] = true; return nx }) }, logHgExpand[tier + g.key] ? tt('trash.collapse') : tt('sugg.detail'))),
                              logHgExpand[tier + g.key] ? e('div', { className: 'dsh-notes-arch-list' },
                                g.members.map(m => e('div', { key: m.id, className: 'dsh-notes-arch-row' },
                                  e('span', { className: 'dsh-notes-arch-ti', title: m.title || 'Untitled' }, m.title || 'Untitled'),
                                  e('span', { className: 'dsh-notes-arch-meta' }, (m.logDate || '—') + (m.sessionId ? tt('sugg.sessSeg', { id: String(m.sessionId).replace(/^session-/, '').slice(0, 8) }) : '')),
                                  e('button', { className: 'dsh-notes-trash-act', onClick: () => suggestViewNote(m.id) }, tt('sugg.view'))))) : null)))
                        : e('div', { className: 'dsh-notes-data-hint' }, tt('sugg.logHgEmpty'))),
                    e('div', { className: 'dsh-notes-data-hint' }, tt('sugg.criteriaClient'))),
            error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
            e('div', { className: 'dsh-notes-dispatch-actions' },
              e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setSuggestOpen(false), disabled: suggestPending }, tt('common.close')))))
      })()
      : null
    }
