    const d1 = slots.inject('conversation.session.header.actions', () => {
      function HeaderBtn(props) {
        perf.hdrRender++
        const [, force] = React.useState(0)
        if (props && props.sessionId) currentSessionId = props.sessionId
        React.useEffect(() => { const fn = () => force(v => v + 1); entryListeners.add(fn); listeners.add(fn); return () => { entryListeners.delete(fn); listeners.delete(fn) } }, [])
        // 模式互斥：fab 模式时隐藏会话头部按钮
        if (entryMode !== 'header') return null
        return e('button', { className: 'dsh-notes-hdr-btn dsh-nt' + (panelOpen ? ' active' : ''), onClick: () => { panelOpen = !panelOpen; notify() }, 'data-tooltip': '智能笔记' }, e('span', { className: 'dsh-notes-hdr-ic' }, I('note', 13)), e('span', null, '智能笔记'))
      }
      slots.register({ name: 'conversation.session.header.actions', id: 'dsh-notes-btn', order: 40 }, (props) => e(HeaderBtn, props))
    })
    if (typeof d1 === 'function') disposers.push(d1)
