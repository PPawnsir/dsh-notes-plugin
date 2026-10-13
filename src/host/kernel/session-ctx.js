    function sessCtx() {
      const sc = { sessionId: '', cwd: '' }
      try {
        if (agents) {
          const a = agents.currentInitiator()
          if (a) {
            sc.sessionId = a.sessionId || (a.session && a.session.id) || ''
            sc.cwd = (a.session && a.session.header && a.session.header.cwd) || ''
          }
        }
      } catch (e) {}
      return sc
    }

    // ==== secret-audit BEGIN ====（0.6.x 文档安全二期 notes-061-docsec-hygiene 池#17：reveal 审计环形缓冲——本块双包同一物理文件，check 节 136 看守）
    // 背景：S3（notes-052-reveal-gate）的 reveal 审计行只写进程日志，用户不可见。本块给审计行加第二读面：
    //   内存环形缓冲（最近 100 条：at 时间/note 笔记 id/title 标题快照/session 会话 sid/spans 机密区计数）。
    // 红线：缓冲只读不写库不进遥测（纯内存态）；进程日志行照旧写（双通道：日志 + 缓冲，index.js note_get 面同一处入账）；
    //   重启清空（内存缓冲——持久化属二期加密批配套，本卡不盘外落盘）。title 随条目快照入账（笔记后续改名/删除不影响历史行显示）。
    // 消费面：server.js/server.dist.js 的 notes-secret-audit 只读 RPC（倒序：最新在前）→ 双端设置卡「数据与存储」组「机密读取记录」行展开列表。
    const SECRET_AUDIT_MAX = 100
    const _secretAuditBuf = []
    function pushSecretAudit(entry) {
      try {
        _secretAuditBuf.unshift({ at: String(entry && entry.at || ''), note: String(entry && entry.note || ''), title: String(entry && entry.title || ''), session: String(entry && entry.session || ''), spans: (entry && typeof entry.spans === 'number') ? entry.spans : 0 })
        if (_secretAuditBuf.length > SECRET_AUDIT_MAX) _secretAuditBuf.length = SECRET_AUDIT_MAX   // 环形截断：超出容量挤掉最旧
      } catch (e) {}
    }
    function listSecretAudit() { return _secretAuditBuf.slice() }   // 倒序出体（unshift 入账，首部即最新）；拷贝防调用方改缓冲
    // ==== secret-audit END ====

    function getPolicy() {
      try {
        if (sp && sp.resolve) {
          return sp.resolve({ mode: 'danger-full-access' })
        }
      } catch (e) {}
      return undefined
    }

    // 三段式标题：工作区 · 会话 · 主题
    function buildQuickTitle(sc, topic) {
      const ws = basename(sc.cwd)
      const sess = sc.sessionId ? sc.sessionId.replace(/^session-/, '').slice(0, 8) : ''
      return [ws, sess, topic].filter(Boolean).join(' · ') || topic || '未分类'
    }

