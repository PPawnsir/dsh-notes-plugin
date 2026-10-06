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
        // hidden 条件行（0.4.4-D hidden 隐藏属性，OS 文件管理对齐：纯 UI 遮罩标记——面板显隐开关关时滤除、开时半透明渲染；
        //   仅 true 落盘（缺省 false 存量零迁移）；host _list/_search/notes-get/note_manage 语义零改动——遮罩全在 client/app 渲染层）
        (m.hidden === true ? 'hidden: true\n' : '') +
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
        // refNote 条件行（0.4.3⑥ 效用账本：记忆档案笔记 → 被引用记忆 id 的结构化软链，notes-ledger 懒创建回写；
        // 普通笔记不落此行，存量零迁移）
        (m.refNote ? 'refNote: ' + escYaml(m.refNote) + '\n' : '') +
        // runLog 条件行（0.4.4-A 派发回执笔记化·三表归一：「执行记录」伴生笔记软链——调度约定笔记存 schedule.runLog
        // （存量口径不动），非调度派发源笔记存本顶层 runLog 字段；普通笔记不落此行，存量零迁移）
        (m.runLog ? 'runLog: ' + escYaml(m.runLog) + '\n' : '') +
        // schedule 条件行（定时派发·执行层：contractType=dispatch-schedule 约定笔记的调度声明 + 机器状态——
        // 声明 {at|every, target, action, enabled} + 状态 {lastFiredAt, lastRun{at,status,receiptId}, lastError}；
        // JSON 单行存储同 dispatches 先例；普通笔记不落此行，存量零迁移）
        (m.schedule ? 'schedule: ' + escYaml(JSON.stringify(m.schedule)) + '\n' : '') +
        'dispatches: ' + escYaml(JSON.stringify(m.dispatches || [])) + '\n' +
        // useCount 字段退役（0.4.3 验收修复⑧ notes-043-stats-unify）：统计收编 telemetry.json facets.use 单一事实源，不再写此行——
        //   新笔记无此字段；存量文件字段保留无害、下次真实保存自然脱落；parseFM 仍读旧值仅作 facet seed（_useFacetSync，兼容）
        'archivedAt: ' + escYaml(m.archivedAt || '') + '\n' +
        'deleted: ' + escYaml(m.deleted || 'false') + '\n' +
        // 闭合分隔符固定单换行收尾、不多写空行（notes-043-fm-newline）：与 parseFM「吃掉闭合 --- 后全部连续前导换行」
        //   配对，保证 读盘→写盘 往返幂等（旧口径 '---\n\n' + 只吃一个 \n 曾致正文前导换行每轮 +1 无上界递增）
        '---\n'
    }

    function parseFM(content) {
      const meta = {}
      let body = content
      // 闭合 --- 后吃掉全部连续前导换行：front-matter 与正文间的空行属分隔符填充、不属正文语义——
      //   旧格式（'---\n\n' 收尾）及缺陷累积的多空行存量文件首轮读入即归一，回写后稳定零增长（不做全库迁移）；
      //   只作用于最前缘，正文内部空行不受影响。canonical 口径：正文不再以前导空行开头。
      const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)*([\s\S]*)$/)
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

