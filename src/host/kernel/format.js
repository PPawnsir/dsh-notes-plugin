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

    // ==== topic-tag-merge BEGIN ====（0.4.8 三重分类收敛 B 方案 notes-048-topic-tag-merge；check 节 109 锚定）
    // 主题废弃并入标签·host 侧口径（src/shared/editor-kernel.js effTags 的 host 等价物——host 不拼接 shared 内核，双端各一份同口径）：
    // effTagsOf(n) = tags ∪ {topic}（tags 元素 trim 去空 + 精确去重保序；topic trim 后非空且≠「未分类」才追加；大小写敏感与 tag 精确过滤同口径）。
    // 读侧纯函数，磁盘零改动（懒迁移红线）；「分类中」占位主题照常并入（与 effTags 同口径）。
    function effTagsOf(n) {
      const out = []
      const tags = (n && n.tags) || []
      for (let i = 0; i < tags.length; i++) { const v = String(tags[i] == null ? '' : tags[i]).trim(); if (v && out.indexOf(v) < 0) out.push(v) }
      const tp = String(n && n.topic != null ? n.topic : '').trim()
      if (tp && tp !== '未分类' && out.indexOf(tp) < 0) out.push(tp)
      return out
    }
    // 写侧惰性落盘（note_manage 显式传 topic 时）：topic trim 后非空且≠「未分类」且≠「分类中」（占位符永不落标签）→
    // 并入 tags（去重）+ 返回清空标记（调用方落盘 topic=''）；否则返回 null（调用方原样透传 topic）。
    function topicMergeWrite(tags, topic) {
      const tp = String(topic == null ? '' : topic).trim()
      if (!tp || tp === '未分类' || tp === '分类中') return null
      const out = []
      const src = Array.isArray(tags) ? tags : []
      for (let i = 0; i < src.length; i++) { const v = String(src[i] == null ? '' : src[i]).trim(); if (v && out.indexOf(v) < 0) out.push(v) }
      if (out.indexOf(tp) < 0) out.push(tp)
      return { tags: out, clearTopic: true }
    }
    // ==== topic-tag-merge END ====

