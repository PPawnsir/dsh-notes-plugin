// 节 68. i18n 守卫（notes-042-i18n-lint：常驻 lint——zh/en key 集一致 + 字典↔代码引用双向覆盖 + 产物字典抽查 + 报告尾部未覆盖清单）
// 规格源：反馈条目 n-mut488gske5v 种子卡③——check 新节 i18n-lint：①zh/en key 集一致 ②字典↔代码引用双向覆盖
//   ③产物含字典 + en 关键串抽查 ④报告尾部输出「未覆盖清单」（仍含内联中文的文件/行数排行，只提示不阻塞）。
//   依赖全部覆盖卡（62~67）落地后启用；本节前身断言散见 60/62~67（单卡口径），本节起收敛为全域常驻守卫。
// 扫描面口径：src/app/**（.js + shell/.html 页面壳）+ src/client/**（.js）+ src/shared/**（.js）= 双语化全部表面；
//   host 端 RPC error message 本期保持中文（红线豁免）、原型 design/notes-ui-v2.html 不双语（红线）、字典自身不计。
// 引用提取口径：先经 stripComments 去注释（// 与 /* */ 与 <!-- --> 三态剥离，字符串/正则字面量内免疫），
//   防注释里被引号包住的 key 字样冒充引用、防注释掉的历史代码虚报覆盖。
// 白名单纪律（双向各一张，逐条锚定防静默漂移）：
//   · DYN 动态构造：t('meta.kind' + Cap(k)) / t('meta.status' + Cap(s)) / t('sort.' + id ± 'Desc')（state.js/constants.js/newnote.js），
//     key = 前缀 + 枚举后缀精确命中才视为被引用；构造锚点必须在位。
//   · NON_KEY_LITS 非字典字面量：Cordis slot id（conversation.session.header.actions / shell.overlay）+ 动态构造片段
//     （meta.kind / meta.status）——必须仍在源码出现，消失即须从清单移除。
// ④未覆盖清单不阻塞：计算在 t() 断言体之外（--core/--only 照常统计），结果挂 S.i18nUncovered 由 runner 在
//   === 结果 === 总结之后打印（报告尾部）；常量表四端同构锚（KIND_LABELS/FILTER_STATUS/FILTER_SORTS）与
//   数据层「定时 」前缀属设计内保留，残留计入排行但不视为缺陷。
// 随卡附赠：字典 hygiene 首战果——机制卡骨架键 topbar.sort / common.confirm / common.saved 零代码引用，已从 zh/en 双字典删除
//   （60 节 en 关键串抽查同步改锚 common.save），守卫②从此锁死「字典 key 必须被引用」。
module.exports = {
  id: "68",
  title: "68. i18n 守卫（常驻 lint：key 集一致 + 字典↔代码双向覆盖 + 产物抽查 + 未覆盖清单）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR } = H
  section('68. i18n 守卫（常驻 lint：key 集一致 + 字典↔代码双向覆盖 + 产物抽查 + 未覆盖清单）')
  const zhSrc = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8')
  const enSrc = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'en.js'), 'utf8')
  const grab = (s, v) => new Function(s + '\nreturn ' + v)()
  const zh = grab(zhSrc, 'I18N_ZH'), en = grab(enSrc, 'I18N_EN')

  // ===== 扫描面 + 去注释器（②④共用同一口径）=====
  const walk = (dir, exts, out) => {
    out = out || []
    for (const name of fsNative.readdirSync(dir)) {
      const p = path.join(dir, name)
      const st = fsNative.statSync(p)
      if (st.isDirectory()) walk(p, exts, out)
      else if (exts.indexOf(path.extname(name)) >= 0) out.push(p)
    }
    return out
  }
  const FILES = walk(path.join(DIR, 'src', 'app'), ['.js', '.html'])
    .concat(walk(path.join(DIR, 'src', 'client'), ['.js']), walk(path.join(DIR, 'src', 'shared'), ['.js']))
  // 三态注释剥离：字符串/正则字面量内免疫（引号状态机 + 正则态含字符类追踪）；块注释删除但保留换行（行号口径不漂移）
  const stripComments = (src, html) => {
    let out = '', i = 0, q = null, rx = false, rxClass = false, prev = ''
    const n = src.length
    while (i < n) {
      const c = src[i], d = i + 1 < n ? src[i + 1] : ''
      if (q) { out += c; if (c === '\\') { out += d; i += 2; continue } if (c === q) q = null; i++; continue }
      if (rx) {
        out += c
        if (c === '\\') { out += d; i += 2; continue }
        if (c === '[') rxClass = true
        else if (c === ']') rxClass = false
        else if (c === '/' && !rxClass) rx = false
        i++; continue
      }
      if (c === "'" || c === '"' || c === '`') { q = c; out += c; i++; continue }
      if (!html && c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue }
      if (c === '/' && d === '*') {
        i += 2
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++ }
        i += 2; continue
      }
      if (c === '<' && d === '!' && src[i + 2] === '-' && src[i + 3] === '-') {
        i += 4
        while (i < n && !(src[i] === '-' && src[i + 1] === '-' && src[i + 2] === '>')) { if (src[i] === '\n') out += '\n'; i++ }
        i += 3; continue
      }
      // 正则字面量判定（防御性：扫描面当前无含引号正则，此项为防未来腐蚀）：前一有效字符为运算符/括号类则按正则处理
      if (c === '/' && (prev === '' || '(,=:[!&|?{};\n'.indexOf(prev) >= 0)) { rx = true; rxClass = false; out += c; i++; continue }
      if (!/\s/.test(c)) prev = c
      out += c; i++
    }
    return out
  }
  const strippedList = FILES.map((f) => ({ file: f, text: stripComments(fsNative.readFileSync(f, 'utf8'), path.extname(f) === '.html') }))
  const allCode = strippedList.map((x) => x.text).join('\n')

  // ===== ① zh/en key 集一致：全域 key 集合一致 + 双端值非空 + 占位符 {name} 同形 =====
  await t('i18n 守卫① 字典一致性：zh/en 全域 key 集合一致 + 双端值非空 + 占位符 {name} 同形', () => {
    const kz = Object.keys(zh).sort(), ke = Object.keys(en).sort()
    const onlyZh = kz.filter((k) => !(k in en)), onlyEn = ke.filter((k) => !(k in zh))
    assert.deepStrictEqual(ke, kz, 'en/zh 全域 key 集合一致（仅 zh：' + onlyZh.slice(0, 5).join(',') + '；仅 en：' + onlyEn.slice(0, 5).join(',') + '）')
    // 重复 key 防线：对象字面量重复键后者静默覆盖（本卡实发案例 meta.source 双义碰撞——编辑器「源码」段 ⇄ 「来源」会话 chip）——
    // 字典文件 key 行数必须 = eval 后条数，不等即有重复键
    for (const [s, tag] of [[zhSrc, 'zh.js'], [enSrc, 'en.js']]) {
      const lineN = (s.match(/\n  '[^']+':/g) || []).length
      assert.strictEqual(lineN, kz.length, tag + ' 无重复 key（key 行数 ' + lineN + ' = eval 条数 ' + kz.length + '）')
    }
    assert(kz.length >= 600, '字典体量防线（实得 ' + kz.length + '；0.4.2 覆盖卡全量后 ≥600，异常骤减即字典被误删）')
    for (const k of kz) {
      assert(typeof zh[k] === 'string' && zh[k] && typeof en[k] === 'string' && en[k], k + ' 双端值非空字符串')
      const pz = (zh[k].match(/\{\w+\}/g) || []).sort().join(','), pe = (en[k].match(/\{\w+\}/g) || []).sort().join(',')
      assert(pz === pe, k + ' 双端占位符同形（zh:' + pz + ' / en:' + pe + '）')
    }
  })

  // ===== ② 字典↔代码引用双向覆盖 =====
  // key 形字面量：小驼峰前缀 + 至少一段 .分隔（slot id 与动态构造片段经 NON_KEY_LITS 豁免）
  const KEYRE = /'([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)'/g
  const DYN = [
    { prefix: 'meta.kind', suffixes: ['Note', 'Decision', 'Todo', 'Link', 'Quote', 'Log'], anchor: "t('meta.kind' +" },   // state.js/constants.js/newnote.js：Cap(kind)
    { prefix: 'meta.status', suffixes: ['Active', 'Resolved', 'Superseded'], anchor: "t('meta.status' +" },               // state.js：Cap(status)（pinned 走 tree.pinned 静态引用）
    { prefix: 'sort.', suffixes: ['use', 'rel', 'time', 'useDesc', 'relDesc', 'timeDesc'], anchor: "t('sort.' +" },        // state.js/constants.js：sortLabelOf/sortDescOf
  ]
  const NON_KEY_LITS = ['conversation.session.header.actions', 'shell.overlay', 'meta.kind', 'meta.status']
  await t('i18n 守卫② 字典↔代码双向覆盖：字典 key 全被引用 + 代码 key 形字面量全命中字典（白名单逐条锚定）', () => {
    // 白名单防漂移：动态构造锚点与豁免字面量必须仍在（去注释）源码中出现
    for (const d of DYN) assert(allCode.indexOf(d.anchor) >= 0, '动态构造锚点在位：' + d.anchor + '（消失则同步 DYN 清单）')
    for (const x of NON_KEY_LITS) assert(allCode.indexOf("'" + x + "'") >= 0, '豁免字面量仍在源码出现：' + x + '（消失则移出 NON_KEY_LITS）')
    // 方向一·代码 → 字典：key 形字面量 ⊆ 字典 ∪ NON_KEY_LITS（t()/tt() 实参、CHEATSHEET_ROWS/SET_NUM_FIELDS 表键同被捞取）
    const lits = new Set(); let m
    const re = new RegExp(KEYRE.source, 'g')
    while ((m = re.exec(allCode))) lits.add(m[1])
    const unknown = [...lits].filter((k) => !(k in zh) && NON_KEY_LITS.indexOf(k) < 0).sort()
    assert.deepStrictEqual(unknown, [], '代码引用了字典不存在的 key（补字典或修拼写；新形态非 key 字面量须登记 NON_KEY_LITS）')
    // 方向二·字典 → 代码：每 key 被引（静态引号命中，或 DYN 前缀 + 枚举后缀精确命中）
    const dynHit = (k) => DYN.some((d) => k.indexOf(d.prefix) === 0 && d.suffixes.indexOf(k.slice(d.prefix.length)) >= 0)
    const unref = Object.keys(zh).filter((k) => allCode.indexOf("'" + k + "'") < 0 && !dynHit(k)).sort()
    assert.deepStrictEqual(unref, [], '字典 key 未被任何代码引用（删键或接线；动态构造须登记 DYN）')
  })

  // ===== ③ 产物含字典 + en 关键串抽查（双产物 × 双语言：嵌入锚点 + key 行数 = src 字典条数 + 跨表面取样）=====
  await t('i18n 守卫③ 产物字典抽查：app.html/lib-client 双字典嵌入 + key 行数 = src 条数 + en 关键串 5 条', () => {
    const appSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const clientPkgSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
    const keyN = Object.keys(zh).length
    // 产物字典区提取：拼接契约零插入零改写——app 态列 0、client 态 4 空格基座缩进；区尾 = 基座缩进 } 独占行
    const dictRegion = (src, ind, v) => {
      const i = src.indexOf(ind + 'var ' + v + ' = {')
      assert(i >= 0, '产物含 ' + v + ' 字典（' + (ind ? 'client 基座缩进' : 'app 列 0') + '形态）')
      const rest = src.slice(i), j = rest.indexOf('\n' + ind + '}')
      assert(j >= 0, v + ' 字典区收尾行在位')
      return rest.slice(0, j)
    }
    const SPOT = ['topbar.refresh', 'common.save', 'settings.language', 'tree.untitled', 'side.loadFailed']   // 跨表面取样：顶栏/通用/设置/树/侧栏
    for (const k of SPOT) { assert(k in en && en[k].indexOf("'") < 0, '抽查键在 en 字典且值无单引号：' + k); assert(k in zh, '抽查键在 zh 字典：' + k) }
    for (const [src, tag, ind] of [[appSrc, 'app.html', ''], [clientPkgSrc, 'lib/client.js', '    ']]) {
      for (const v of ['I18N_ZH', 'I18N_EN']) {
        const region = dictRegion(src, ind, v)
        const cnt = (region.match(new RegExp('\\n' + ind + "  '", 'g')) || []).length
        assert.strictEqual(cnt, keyN, tag + ' ' + v + ' key 行数 = src 字典条数 ' + keyN + '（实得 ' + cnt + '；改字典后须跑 build-dist 重拼产物）')
      }
      // en 关键串抽查：整行形态（基座缩进 + 'key': 'value'）逐字命中，值取自 en 字典对象（不手抄防漂移）
      for (const k of SPOT) {
        assert(src.indexOf(ind + "  '" + k + "': '" + en[k] + "'") >= 0, tag + ' en 关键串：' + k)
      }
    }
  })

  // ===== ④ 未覆盖清单（只提示不阻塞）：去注释后仍含内联中文的文件/行数排行，挂 S 由 runner 在报告尾部打印 =====
  const CJK = /[一-鿿]/
  const rows = []
  for (const x of strippedList) {
    let n = 0
    const lines = x.text.split('\n')
    for (const ln of lines) if (CJK.test(ln)) n++
    if (n) rows.push({ file: path.relative(DIR, x.file), lines: n })
  }
  rows.sort((a, b) => b.lines - a.lines || (a.file < b.file ? -1 : 1))
  S.i18nUncovered = { files: rows, totalLines: rows.reduce((s, r) => s + r.lines, 0), scanned: FILES.length }
  await t('i18n 守卫④ 未覆盖清单扫描：' + FILES.length + ' 文件去注释统计（残留 ' + rows.length + ' 文件 / ' + S.i18nUncovered.totalLines + ' 行，报告尾部打印，不阻塞）', () => {
    assert(FILES.length >= 80, '扫描面文件数防线（实得 ' + FILES.length + '；骤减即扫描路径漂移）')
    assert(S.i18nUncovered && S.i18nUncovered.scanned === FILES.length, '未覆盖清单已挂 S.i18nUncovered')
  })
  }
}
