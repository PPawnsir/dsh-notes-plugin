    // ==== sensitive-helpers BEGIN ====（本块三函数集中放置，check.js 提取本标记区间 eval 单测；host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，改动必须双边同步）
    // 背景：sensitive=true 的笔记正文可能含明文密码/密钥；inject=true 会把全文带进所有会话的系统提示（泄露面大）。
    // 策略：注入渲染（renderInjected 合并目录段，0.4.3③）时对 sensitive=true 笔记的正文按行打码——保留键名与结构、只遮值；
    // 占位符统一为 ******（敏感，note_get <id> 获取），引导 agent 需要原文时用 note_get 按 id 自取（注入文本是一次性渲染，无 round-trip）。
    // 三规则：
    //   R1 键值行：行首（可带列表 -/*/+ 或标题 # 前缀）键名以敏感词结尾（password|passwd|pwd|token|secret|apikey|api-key|密码|口令|密钥|私钥|账号|帐号|凭证|credential|ssh 等），
    //      分隔符 : ：= 后值非空 → 遮整段值。键名敏感即视为凭据行，宁多勿漏（原文 note_get 可取，误遮代价低）。
    //   R2 空白裸令牌：敏感词 + 空白 + 形似凭据的令牌（≥4 位可打印 ASCII、非纯小写英文单词，规避「密码 必须足够长」「token expires soon」类散文误报）→ 只遮该令牌。
    //   R3 PEM 私钥块：-----BEGIN ... PRIVATE KEY----- 至 -----END ... PRIVATE KEY----- 整段，保留 BEGIN/END 行、遮中间体。
    // suggestSensitive 复用 maskSensitiveBody 判异：打码逻辑单点，自动建议与打码永不分叉。
    const SENSITIVE_KEY_RE = /(password|passwd|pwd|token|secret|api[-_ ]?key|apikey|access[-_ ]?key|secret[-_ ]?key|private[-_ ]?key|credential|密码|口令|密钥|私钥|账号|帐号|凭证|ssh)$/i
    const SENSITIVE_KV_RE = /^(\s*(?:[-*+]\s+)?(?:#{1,6}\s+)?)([^\s:：=][^:：=\n]{0,38}?)(\s*[:：=]\s*)(\S[\s\S]*)$/
    const SENSITIVE_TOKEN_RE = /(?<![A-Za-z0-9_])(password|passwd|pwd|token|secret|api[-_ ]?key|密码|口令|密钥|私钥)([ \t]+)([\x21-\x7e]{4,})/gi
    const SENSITIVE_PRIVATE_KEY_RE = /(-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z0-9 ]*PRIVATE KEY-----)/g
    function sensitivePlaceholder(id) { return '******（敏感，note_get ' + id + ' 获取）' }
    // 形似凭据的令牌：非纯小写英文单词（排除 expires/required 类散文；令牌本体已被 SENSITIVE_TOKEN_RE 限定为 ≥4 位可打印 ASCII，中文散文天然不命中）
    function looksLikeSecretToken(tok) { return !/^[a-z]+$/.test(tok) }
    function maskSensitiveLine(line, id) {
      const s = String(line == null ? '' : line)
      if (!s) return s
      // R1 键值行：键名以敏感词结尾 → 遮整段值（前缀/键名/分隔符保留；值已是占位符则幂等跳过）
      const m = s.match(SENSITIVE_KV_RE)
      if (m && SENSITIVE_KEY_RE.test(String(m[2]).replace(/["']+$/, ''))) {
        if (m[4].indexOf('******（敏感') === 0) return s
        return m[1] + m[2] + m[3] + sensitivePlaceholder(id)
      }
      // R2 空白裸令牌（幂等：占位符以 ****** 开头不再二次遮蔽）
      return s.replace(SENSITIVE_TOKEN_RE, function (mm, kw, ws, tok) {
        if (tok.indexOf('******') === 0) return mm
        if (!looksLikeSecretToken(tok)) return mm
        return kw + ws + sensitivePlaceholder(id)
      })
    }
    function maskSensitiveBody(body, id) {
      const s = String(body == null ? '' : body)
      if (!s) return s
      // R3 私钥块先行（跨行），再逐行 R1/R2
      const masked = s.replace(SENSITIVE_PRIVATE_KEY_RE, function (mm, b, e) { return b + '\n' + sensitivePlaceholder(id) + '\n' + e })
      return masked.split('\n').map(function (line) { return maskSensitiveLine(line, id) }).join('\n')
    }
    function suggestSensitive(text) {
      return maskSensitiveBody(text, 'n-sens-check') !== String(text == null ? '' : text)
    }
    // ==== sensitive-helpers END ====

