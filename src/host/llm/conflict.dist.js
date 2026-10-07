    // ==== conflict-check BEGIN ====（0.4.5-G 约定体检 notes-045-conflict-check：LLM 对全部注入中约定两两检测冲突/被取代对，只提名不执行——裁决动作在人）
    // （与开发版 host-impl.js 双边同步，逻辑逐行一致）
    // 背景：约定多了会打架（真实事故：日志隐身约定 vs 后来的同权裁决并存）。本通道提名「疑似冲突/疑似被取代」对，
    //   人工在注入管理面板内联结果区裁决（标 A/B 已取代 = notes-update status='superseded'；保留两者 = 会话内 dismiss）。
    // 通道：llm.stream + resolveLlmSelection（设置 LLM 优先，缺省跟随会话），temperature 0，120s Promise.race 超时（0.4.7-A⑨ 起，见常量注）。
    // 数据集谓词（行为级断言锁定）：inject=true && injectRole=convention（缺省值等同 convention） && !deleted && status!=='superseded' ——
    //   （0.4.7-A③ notes-047-cleanup：已废止约定不参与冲突检测——superseded 是裁决终点，再参与提名只产噪音）；
    //   _list 六参全开（含 sys：谓词即唯一选择口径，sys 降噪不在此生效）；<2 条 → { ok:true, pairs:[] } 零 LLM 调用。
    // 红线：①敏感笔记正文经 maskSensitiveBody 按行打码后才进 prompt（键留值遮，占位符引导 note_get 自取）；
    //   ②只提名不执行——本函数零写入，status 翻转只能由用户点击触发 notes-update；
    //   ③手动触发（注入管理面板「约定体检」按钮），v0 不进 cron/启动装配。
    // 计量口径（0.4.5-G 裁决）：低频手动治理功能沿用 when-suggest 豁免先例——不进 llm-usage 计量（USAGE_FEATURES 三功能口径不动，
    //   故直接迭代 llm.stream 而非 streamMetered；注册面能加 conflict 键，但计量口径变更会连带 usage 报表/UI/断言面漂移，本期注释注明暂不计量）。
    // 输出容错：剥离 ```json 围栏 → JSON.parse 失败/非数组 → { error }；逐条校验——幻觉 id（不在数据集）/aId=bId/非法 relation 条目静默过滤，
    //   reason 归一空白截断 200 字；同一无序对去重（先见者留）。
    const CONFLICT_CHECK_TIMEOUT_MS = 120000      // 0.4.7-A⑨（notes-047-cleanup，用户实测 8.7s 被打断）：8s → 120s——体检是「全部注入约定塞一个大 prompt 的单次流式调用」
                                                //   （量级估算：N 条约定 × 正文截断 2000 字 ≈ 2N KB prompt，20 条 ≈ 40KB≈2万+ tokens 输入 + 两两比对输出，远超 when-suggest 单行草稿的轻量档）；
                                                //   手动触发的重操作，对齐客户端 LLM 护栏口径（HOSTCALL/RPC_LLM_METHODS 120s，perf.js / app rpc.js）
    const CONFLICT_BODY_MAX_CHARS = 2000          // 单条约定正文入 prompt 上限（超出截断标注，防 token 爆）
    const CONFLICT_REASON_MAX_CHARS = 200         // reason 归一截断上限（防御性，UI 单行呈现）
    async function _conflictCheck(args) {
      if (!llm) return { error: 'LLM 不可用（宿主无 llm 服务）' }
      let all = []
      try { all = await _list(undefined, undefined, undefined, false, true, true) } catch (e) { return { error: String(e.message || e) } }
      const conv = (all || []).filter(n => n && n.inject === true && !n.deleted && n.status !== 'superseded' && (n.injectRole || 'convention') === 'convention')
      if (conv.length < 2) return { ok: true, pairs: [], total: conv.length }
      await loadSettings()
      const sel = resolveLlmSelection()
      if (!sel || !sel.provider || !sel.model) return { error: '未配置笔记 LLM 且无会话模型可跟随（可在设置卡片选配）' }
      // 数据集落 prompt：id + 标题（去换行）+ 正文（敏感打码 / 超长截断）
      const items = conv.map(n => {
        const rawBody = String(n.body || '')
        const safeBody = n.sensitive === true ? maskSensitiveBody(rawBody, n.id) : rawBody
        const clipped = safeBody.length > CONFLICT_BODY_MAX_CHARS ? safeBody.slice(0, CONFLICT_BODY_MAX_CHARS) + '\n…（正文截断）' : safeBody
        return { id: n.id, title: String(n.title || n.id).replace(/[\r\n]+/g, ' '), body: clipped }
      })
      const listing = items.map((it, i) => '【约定 ' + (i + 1) + '】id=' + it.id + '\n标题：' + it.title + '\n正文：\n' + (it.body.trim() || '（空）')).join('\n\n')
      const prompt =
        '下面是 ' + items.length + ' 条正在注入到 AI 系统提示的「约定」笔记（每条 = id + 标题 + 正文）。\n' +
        '请两两检查它们之间是否存在以下关系：\n' +
        '1. conflict（疑似冲突）：两条约定给出相互矛盾、不可兼得的指令（同一事项一个要求做、一个要求不做，或规则互相打架）；\n' +
        '2. supersede（疑似取代）：同一主题下一条约定明显更新/覆盖了另一条，旧条继续注入会造成歧义。\n' +
        '只报告有实际内容依据的对子，不要猜测；一条约定可出现在多个对子中；没有就输出空数组 []。\n' +
        '输出：JSON 数组，每个元素 {"aId":"<id>","bId":"<id>","relation":"conflict"或"supersede","reason":"<用约定自身的语言一句话说明依据>"}。\n' +
        '只输出 JSON 数组本身，不要输出解释、前言或代码围栏。\n\n' +
        listing + '\n\n只输出 JSON 数组：'
      let timer = null
      const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('体检超时（120s）')), CONFLICT_CHECK_TIMEOUT_MS); if (timer && typeof timer.unref === 'function') timer.unref() })
      let text = ''
      try {
        await Promise.race([(async () => {
          for await (const chunk of llm.stream({
            provider: sel.provider,
            model: sel.model,
            messages: [{
              id: 'conflict-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
              role: 'user',
              content: [{ type: 'text', text: prompt }],
              source: { kind: 'user' }
            }],
            system: '你是笔记约定治理助手。检查注入中的约定笔记两两之间的冲突与取代关系，只输出 JSON 数组。',
            temperature: 0
          })) {
            if (chunk && chunk.type === 'text-delta') text += chunk.text
            if (chunk && chunk.type === 'finish') break
          }
        })(), timeout])
      } catch (e) {
        console.error('notes: conflictCheck failed', e)
        return { error: String(e.message || e) }
      } finally { if (timer) clearTimeout(timer) }
      // 输出容错：剥离整段 ```json/``` 围栏（模型偶发包代码块）；JSON.parse 失败/非数组 → error
      let raw = String(text || '').trim()
      const fence = raw.match(/^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n?```\s*$/)
      if (fence) raw = fence[1].trim()
      let arr = null
      try { arr = JSON.parse(raw) } catch (e) { return { error: 'LLM 输出非合法 JSON：' + String(e.message || e) } }
      if (!Array.isArray(arr)) return { error: 'LLM 输出非 JSON 数组' }
      const byId = {}
      for (const it of items) byId[it.id] = it
      const pairs = []
      const seen = {}
      for (const p of arr) {
        if (!p || typeof p !== 'object' || Array.isArray(p)) continue
        const aId = String(p.aId || ''), bId = String(p.bId || '')
        if (!byId[aId] || !byId[bId] || aId === bId) continue   // 幻觉 id / 自配对过滤（防御性，不计 error）
        const relation = p.relation === 'conflict' ? 'conflict' : (p.relation === 'supersede' ? 'supersede' : '')
        if (!relation) continue
        const key = (aId < bId ? aId + '|' + bId : bId + '|' + aId) + '|' + relation
        if (seen[key]) continue   // 同一无序对同关系去重（先见者留）
        seen[key] = true
        const reason = String(p.reason || '').replace(/\s+/g, ' ').trim().slice(0, CONFLICT_REASON_MAX_CHARS)
        pairs.push({ aId: aId, bId: bId, aTitle: byId[aId].title, bTitle: byId[bId].title, relation: relation, reason: reason })
      }
      return { ok: true, pairs: pairs, total: conv.length }
    }
    // ==== conflict-check END ====
