    // ===== mentions.js —— 0.4.5-E @ 引用笔记（notes-045-at-mention）：DSH 输入框 @ 菜单注册「笔记」候选源 =====
    // provides: createNotesMentionSource 工厂 + mentionCache 轻缓存 + inputTriggers 注册（服务缺席静默不注册）
    // needs: kernel/bus.js（noteRefreshListeners）、kernel/i18n.js（t）、kernel/constants.js（kindLabel）——序位全部在前
    //
    // 契约锚（@deepseek-ai/dsh-client-ui-input-trigger lib/types/types.d.ts 冻结契约，字段名严格照抄）：
    //   InputTriggerSource { trigger:'@', name, order?, candidates(session,req)→Promise<Candidate[]>, onPick(pick)→PickOutcome,
    //     warm?(session), codec?{clipboardText(ref), serialize(ref,signal)→Promise<string>} }；
    //   Candidate { name,label?,description?,icon?,hint?,section?,value? }（value = 不透明 pick 载荷，onPick 原样回传）；
    //   onPick → { insert: ReferenceInsert{ source, ref, label, appearance, clipboardText } }（chip 落文，clipboardText 随节点缓存）；
    //   codec.serialize(ref, signal) 在提交时逐 chip 异步调用（conversation 输入机 sinkSerialized 链路），返回值替换 chip 进正文。
    //
    // 红线遵循：
    //   · 独立 name='notes' 分组 + order=40 置后——不劫持宿主既有 reference 源（trigger '@' name 'reference'，order 缺省 0）；
    //   · inputTriggers 服务缺席（旧版宿主无此服务）= 静默不注册，插件其余功能面不受影响；
    //   · serialize 失败**透明降级不静默**：契约原文是「失败阻塞发送、永不静默降级为剪贴板文本」，此处裁决透明降级优于阻塞——
    //     拉正文失败时序列化为 `@标题（内容拉取失败）` 显式注记（发送不阻塞、失败对 Agent/用户可见，且不含旧正文误导）。
    // 数据面：独立轻缓存（不依赖面板打开状态——notesRef 只在面板渲染期镜像，@ 菜单可能在面板从未打开时使用）：
    //   注册/首次 candidates 时拉一次 notes-list（host 缺省口径已排 deleted/sys），noteRefreshListeners 失效重拉（惰性，下次
    //   candidates 触发）；serialize 经 notes-get 取正文（顺带召回遥测 get 通道计数，host server.js notes-get 内 _recallHit）。
    //   拉取失败/异常响应 → 空候选（读路径静默群同口径：不抛给菜单管线、不打扰输入）。
    //
    // ==== notes-mention-source BEGIN ====（check 节 89 提取本块做行为级 eval；改动须同步断言）
    const MENTION_MAX = 8   // 候选上限（@ 菜单分组行数闸口）
    const mentionCache = { notes: null, inflight: null }   // notes=null 未拉/已失效；inflight 去重并发首拉
    function mentionNotesInvalidate() { mentionCache.notes = null }   // notifyNotesChanged 失效：下次 candidates 惰性重拉
    function ensureMentionNotes() {
      if (mentionCache.notes) return Promise.resolve(mentionCache.notes)
      if (mentionCache.inflight) return mentionCache.inflight
      mentionCache.inflight = Promise.resolve(host.call('notes-list', {})).then((res) => {
        mentionCache.inflight = null
        if (res && !res.error && Array.isArray(res.notes)) { mentionCache.notes = res.notes; return res.notes }
        return []   // 异常响应形态（error/缺字段）→ 空候选静默降级；cache 保持 null 下次重试
      }, () => { mentionCache.inflight = null; return [] })
      return mentionCache.inflight
    }
    // 候选过滤（纯函数，check 行为级 eval 锚）：软删/sys 组件侧兜底双闸（host 缺省口径已排，复评防回归）；
    // query 命中标题/标签（0.4.8：主题并入标签——hay 吃 effTags = tags ∪ topic 读侧虚拟合并；小写折叠子串）；上限 MENTION_MAX
    function mentionFilter(notes, query) {
      const q = String(query || '').trim().toLowerCase()
      const alive = (notes || []).filter((n) => n && !n.deleted && (n.kind || 'note') !== 'sys')
      const hit = !q ? alive : alive.filter((n) => {
        const hay = [n.title].concat(effTags(n)).join('\n').toLowerCase()
        return hay.indexOf(q) >= 0
      })
      return hit.slice(0, MENTION_MAX)
    }
    // 缓存内热查标题（serialize 降级文案 / codec.clipboardText 同步投影用；缓存冷时回退 id 本身）
    function mentionTitleOf(ref) {
      const n = (mentionCache.notes || []).find((x) => x && x.id === ref)
      return n ? (String(n.title || '').trim() || t('tree.untitled')) : String(ref || '')
    }
    // serialize 失败透明降级文案（含标题/检索 id，对 Agent 与用户可见，非静默吞错）
    function mentionFallbackText(ref) { return t('mention.fetchFailed', { title: mentionTitleOf(ref) }) }
    // 单行候选投影：name=标题（pick 载荷/精确匹配键/第一检索键）；description=首枚有效标签 · 类型（0.4.8：主题并入标签——
    // effTagsUi = tags ∪ topic 剔「分类中」占位；MenuView 实际渲染的副行字段）；section=分组小标题（相邻同组共享去重）；value=笔记 id（onPick 原样回传）
    function mentionCandidate(n) {
      const title = String(n.title || '').trim() || t('tree.untitled')
      const tag0 = effTagsUi(n)[0] || ''
      const kl = kindLabel(n.kind || 'note')
      const desc = tag0 && kl ? tag0 + ' · ' + kl : (tag0 || kl)
      return {
        name: title,
        description: desc || undefined,
        icon: 'file',
        section: t('mention.section'),
        value: n.id,
      }
    }
    function createNotesMentionSource() {
      return {
        trigger: '@',
        name: 'notes',
        order: 40,   // 置后于宿主 reference 源（order 缺省 0），独立分组不抢序
        async candidates(session, req) {
          const notes = await ensureMentionNotes()
          if (req && req.signal && req.signal.aborted) return []   // 查询已更迭/菜单已关（signal 被 supersede）→ 空
          const hits = mentionFilter(notes, req && req.query)
          // 0.4.6-C（notes-046-ux-discovery）：拉取成功但零命中 → 单条空态提示候选（mention.empty，无 value = onPick 守卫不产出 chip，纯展示）；
          // 拉取失败（缓存仍 null）保持空数组静默降级，不出提示行（读路径静默群同口径）
          if (!hits.length && mentionCache.notes) return [{ name: t('mention.empty'), icon: 'file', section: t('mention.section') }]
          return hits.map(mentionCandidate)
        },
        onPick(pick) {
          const c = pick && pick.candidate
          const id = c && c.value
          if (!id) return undefined
          const title = String(c.name || '').trim() || t('tree.untitled')
          return { insert: { source: 'notes', ref: id, label: title, appearance: 'file', clipboardText: '@' + title } }
        },
        // scope 诞生预热（fire-and-forget）：会话 scope 起来时先拉一次清单，首次 @ 免等
        warm(session) { ensureMentionNotes() },
        codec: {
          // 剪贴板/持久化投影（同步热态直读；缓存冷时回退 '@'+id）。当前宿主实现实际消费的是 chip 节点缓存的
          // ReferenceInsert.clipboardText，本投影为契约完整性兜底
          clipboardText: (ref) => '@' + mentionTitleOf(ref),
          // 提交时模型序列化：notes-get 拉正文内联直达 Agent；失败透明降级（见文件头红线裁决，不阻塞发送不静默）
          serialize: (ref) => Promise.resolve(host.call('notes-get', { id: ref })).then((res) => {
            const n = res && !res.error && res.note ? res.note : null
            if (!n) return mentionFallbackText(ref)
            const title = String(n.title || '').trim() || t('tree.untitled')
            return t('mention.inlineHead', { title: title, id: n.id }) + '\n' + String(n.body || '')
          }, () => mentionFallbackText(ref)),
        },
      }
    }
    // ==== notes-mention-source END ====
    // ==== notes-mention-register BEGIN ====（check 节 89 提取本块做守卫行为级 eval；改动须同步断言）
    // 注册：inputTriggers 为宿主可选服务——缺席静默不注册（其余功能面不受影响）；ctx.effect 包裹注册，
    // disposer 成对摘除失效监听（插件卸载/重载时归零残留）
    const mentionInputTriggers = ctx.get('inputTriggers')
    if (mentionInputTriggers && typeof mentionInputTriggers.registerSource === 'function') {
      ctx.effect(() => {
        const offMention = mentionInputTriggers.registerSource(createNotesMentionSource())
        noteRefreshListeners.add(mentionNotesInvalidate)
        return () => { try { offMention() } catch (e) {} noteRefreshListeners.delete(mentionNotesInvalidate) }
      }, 'dsh-notes: @ source')
    }
    // ==== notes-mention-register END ====
