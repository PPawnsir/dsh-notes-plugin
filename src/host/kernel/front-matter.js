    function buildFM(m) {
      return '---\n' +
        'id: ' + escYaml(m.id) + '\n' +
        'title: ' + escYaml(m.title) + '\n' +
        'topic: ' + escYaml(m.topic || '') + '\n' +
        'workspace: ' + escYaml(m.workspace || '') + '\n' +
        'folder: ' + escYaml(m.folder || '') + '\n' +
        'tags: ' + (m.tags || []).map(escYaml).join(', ') + '\n' +
        'kind: ' + escYaml(m.kind || 'note') + '\n' +
        'status: ' + escYaml(m.status || 'active') + '\n' +
        'inject: ' + escYaml(m.inject ? 'true' : 'false') + '\n' +
        // injectRole 仅 inject=true 时落盘（非注入笔记不带角色字段，避免脏数据）
        (m.inject ? 'injectRole: ' + escYaml(m.injectRole === 'reference' ? 'reference' : 'convention') + '\n' : '') +
        // injectEver 恒写（true/false 显式落盘，缺省 false）：曾注入粘性标记——一旦 inject 置 true 即永久 true，后续关闭 inject 不回退（侧栏「曾注入」过滤/行徽章数据源）
        'injectEver: ' + escYaml(m.injectEver === true ? 'true' : 'false') + '\n' +
        'injectTo: ' + (m.injectTo || []).map(escYaml).join(', ') + '\n' +
        'recall: ' + escYaml(m.recall === false ? 'false' : 'true') + '\n' +
        // sensitive 恒写（true/false 显式落盘，缺省 false）：敏感笔记注入时正文按行打码
        'sensitive: ' + escYaml(m.sensitive === true ? 'true' : 'false') + '\n' +
        'createdAt: ' + escYaml(m.createdAt) + '\n' +
        'updatedAt: ' + escYaml(m.updatedAt) + '\n' +
        'sessionId: ' + escYaml(m.sessionId) + '\n' +
        'cwd: ' + escYaml(m.cwd) + '\n' +
        // logDate 恒写（工作记忆 v0 §7.2：工作日志归键，YYYY-MM-DD 本地时区；周/月志为周期首日；非日志 kind 为空串）
        'logDate: ' + escYaml(m.logDate || '') + '\n' +
        'mergedFrom: ' + (m.mergedFrom || []).map(escYaml).join(', ') + '\n' +
        // entities 条件行（工作记忆 v0 §7.2：语义检索实体清单——结构预留不写值，仅非空时落盘，往返无损即完成「预留」）
        (m.entities && m.entities.length ? 'entities: ' + m.entities.map(escYaml).join(', ') + '\n' : '') +
        // summarizedAt 条件行（工作记忆 v0 §5.3：仅 host 自动总结产物写入，去重节流阀；Phase 3 启用）
        (m.summarizedAt ? 'summarizedAt: ' + escYaml(m.summarizedAt) + '\n' : '') +
        // contractType 条件行（工作记忆 v0 r3 车道模型·契约分型：memory-guide 引导笔记的结构化身份标记——op=status/disable 主识别键，
        // tag memory-guide 保留为兼容发现键；普通笔记不落此行，存量零迁移）
        (m.contractType ? 'contractType: ' + escYaml(m.contractType) + '\n' : '') +
        // origin 条件行（工作记忆 v0 r3 车道模型·产物溯源：memory-guide 引导激活期间产生的沉淀日志落 origin=memory-guide；
        // 可选轻字段本期只落数据，详情区展示另期）
        (m.origin ? 'origin: ' + escYaml(m.origin) + '\n' : '') +
        // schedule 条件行（定时派发·执行层：contractType=dispatch-schedule 约定笔记的调度声明 + 机器状态——
        // 声明 {at|every, target, action, enabled} + 状态 {lastFiredAt, lastRun{at,status,receiptId}, lastError}；
        // JSON 单行存储同 dispatches 先例；普通笔记不落此行，存量零迁移）
        (m.schedule ? 'schedule: ' + escYaml(JSON.stringify(m.schedule)) + '\n' : '') +
        'dispatches: ' + escYaml(JSON.stringify(m.dispatches || [])) + '\n' +
        // useCount 恒写（缺省 0）：使用遥测——note_get 工具命中计数（内存累积 + 60s 防抖批量落盘，见 use-telemetry 块）
        'useCount: ' + escYaml(m.useCount || 0) + '\n' +
        'archivedAt: ' + escYaml(m.archivedAt || '') + '\n' +
        'deleted: ' + escYaml(m.deleted || 'false') + '\n' +
        '---\n\n'
    }

    function parseFM(content) {
      const meta = {}
      let body = content
      const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
      if (m) {
        body = m[2] || ''
        for (const line of m[1].split(/\r?\n/)) {
          const idx = line.indexOf(':')
          if (idx < 0) continue
          const key = line.slice(0, idx).trim()
          let val = line.slice(idx + 1).trim()
          if (val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') {
            val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n')
          }
          meta[key] = (key === 'tags' || key === 'mergedFrom' || key === 'injectTo' || key === 'entities')
            ? (val ? val.split(',').map(s => s.trim()).filter(Boolean) : [])
            : val
        }
      }
      return { meta, body }
    }

