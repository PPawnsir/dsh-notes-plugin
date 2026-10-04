    function genId() {
      return 'n-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    }

    function basename(p) {
      if (!p) return ''
      const s = String(p).replace(/[\\/]+$/, '')
      const parts = s.split(/[\\/]/)
      return parts[parts.length - 1] || s
    }

    function shortSid(sid) { return sid ? String(sid).replace(/^session-/, '').slice(0, 8) : '' }

    // dispatches 派发历史：对象数组，front-matter 里以 JSON 字符串存储
    function parseDispatches(s) {
      if (!s) return []
      try { const d = JSON.parse(s); return Array.isArray(d) ? d : [] } catch (e) { return [] }
    }

    // schedule 调度声明（定时派发·执行层）：对象，front-matter 里以 JSON 字符串存储（同 dispatches 先例）；
    // 非法 JSON / 非对象 / 数组 → null（解析失败安全态：不识别为调度笔记，绝不误触发）
    function parseSchedule(s) {
      if (!s) return null
      try { const d = JSON.parse(s); return (d && typeof d === 'object' && !Array.isArray(d)) ? d : null } catch (e) { return null }
    }

    function escYaml(s) {
      s = String(s == null ? '' : s)
      if (/[":#\[\]{}&,*?|<>=!%@\n]/.test(s)) {
        return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"'
      }
      return s
    }

