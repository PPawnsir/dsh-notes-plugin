    // 通用拖拽：move(ev) 在 mousemove 时调用，done() 在 mouseup 时调用
    function drag(move, done) {
      const onMove = (ev) => move(ev)
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); if (done) done() }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }
