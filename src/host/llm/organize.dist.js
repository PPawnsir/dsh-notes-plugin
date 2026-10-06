    // ---- 二期 ✨整理（notes-ai-organize）：当前草稿经 LLM 按 kind 模板结构化重写，返回替换正文 ----
    // （与开发版 host-impl.js 双边同步，逻辑逐行一致）
    // 通道：notes-quick-instruct 同款 llm.stream + resolveLlmSelection（设置 LLM 优先，缺省跟随会话），temperature 0。
    // 不落盘：client 拿到重写正文后替换编辑器内容并走既有自动保存；原正文由 client 一次撤销栈兜底（toast「撤销」）。
    // prompt 设计（先规则后模板示例再草稿）：规则——事实零丢失/不编造、图片 ![](assets/...) 与链接原样保留、
    // 空章节只留标题、只输出正文；模板示例——直接嵌入 KIND_TEMPLATES/MACHINE_TEMPLATE 全文。
    // 0.4.4-F 可选追加用户指令（弹卡引导）：args.instruction（string 可选）trim 后 ≤500 字（超限 error）；
    //   有才在【当前草稿】前插【用户追加指令】段，空/缺省路径 prompt 与二期现行逐字节等价（节 84 行为级断言锁定）；system 提示词不动。
    // 输出容错：剥离 ```markdown 围栏；空结果/LLM 不可用/未配置模型 → error（client 保留原文不动）。
    async function _aiOrganize(args) {
      const body = args && typeof args.body === 'string' ? args.body : ''
      if (!body.trim()) return { error: '正文为空，无可整理内容' }
      if (body.length > AI_ORGANIZE_MAX_CHARS) return { error: '正文过长（' + body.length + ' 字，上限 ' + AI_ORGANIZE_MAX_CHARS + ' 字），请分段整理' }
      const kind = KINDS.indexOf(args && args.kind) >= 0 ? args.kind : 'note'
      const title = args && typeof args.title === 'string' ? args.title.trim() : ''
      const instruction = args && typeof args.instruction === 'string' ? args.instruction.trim() : ''
      if (instruction.length > AI_ORGANIZE_INSTR_MAX_CHARS) return { error: '追加指令过长（' + instruction.length + ' 字，上限 ' + AI_ORGANIZE_INSTR_MAX_CHARS + ' 字），请精简后再试' }
      if (!llm) return { error: 'LLM 不可用（宿主无 llm 服务）' }
      await loadSettings()
      const sel = resolveLlmSelection()
      if (!sel || !sel.provider || !sel.model) return { error: '未配置笔记 LLM 且无会话模型可跟随（可在设置卡片选配）' }
      const kindLabel = KIND_LABELS_ZH[kind] || '笔记'
      const prompt =
        '把下面这篇「' + kindLabel + '」类型的笔记草稿按对应模板结构化重写为 Markdown。\n\n' +
        '【重写规则】\n' +
        '1. 草稿中的全部事实信息（名称、地址、账号、密码、IP、日期、结论等）一条都不许丢，也不许编造草稿没有的事实；\n' +
        '2. 图片引用 ![](assets/...) 与链接 [文字](https://...) 原样保留在合适位置；\n' +
        '3. 按下方「' + kindLabel + '」模板的章节结构组织；草稿没有对应内容的章节只留标题，不要编造内容；\n' +
        '4. 语言与草稿保持一致；只输出重写后的 Markdown 正文，不要输出解释、前言或代码围栏。\n\n' +
        '【模板示例】\n' +
        '决策（kind=decision）：\n' + KIND_TEMPLATES.decision + '\n' +
        '待办（kind=todo）：\n' + KIND_TEMPLATES.todo + '\n' +
        '链接（kind=link）：\n' + KIND_TEMPLATES.link + '\n' +
        '引用（kind=quote）：\n' + KIND_TEMPLATES.quote + '\n' +
        '笔记（kind=note）：自由结构（适当的标题/列表/段落）；若草稿内容是机器/运维/部署信息，套用机器信息模板：\n' + MACHINE_TEMPLATE + '\n' +
        '【本篇类型】' + kindLabel + '（kind=' + kind + '）\n' +
        (title ? '【笔记标题】' + title + '\n' : '') +
        (instruction ? '【用户追加指令】\n' + instruction + '\n' : '') +
        '【当前草稿】\n' + body + '\n\n只输出重写后的 Markdown 正文：'
      try {
        // 计量包装（llm-usage 块）：feature='organize'
        const metered = await streamMetered('organize', {
          provider: sel.provider,
          model: sel.model,
          messages: [{
            id: 'organize-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            role: 'user',
            content: [{ type: 'text', text: prompt }],
            source: { kind: 'user' }
          }],
          system: '你是笔记整理助手。把笔记草稿按指定类型的模板结构化重写为 Markdown，只输出重写后的正文本身。',
          temperature: 0
        })
        const out = metered.text
        // 容错：剥离整段 ```markdown/``` 围栏（模型偶发把正文包进代码块）
        let text = out.trim()
        const fence = text.match(/^```(?:markdown|md)?\s*\r?\n([\s\S]*?)\r?\n?```\s*$/)
        if (fence) text = fence[1].trim()
        if (!text) return { error: 'LLM 返回为空，原文未动' }
        return { ok: true, body: text + '\n', kind: kind }
      } catch (e) {
        console.error('notes: aiOrganize failed', e)
        return { error: String(e.message || e) }
      }
    }

