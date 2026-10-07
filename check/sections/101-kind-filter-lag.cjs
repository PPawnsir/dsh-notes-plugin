// 节 101. 0.4.6-K（notes-046-kind-lag）：kind 过滤滞后一拍根修——filtersRef 镜像序位依赖 → loadNotes 显式传参
// 根因链：index.js 的 kinds 重拉 effect 声明在 usePanelSearch 之前 → filtersRef 镜像在 search.js 内 effect 同步 →
//   同一 commit 内 React effect 按声明序执行 → kinds 重拉 effect 读到的镜像慢一次点击（kind 参数滞后一拍）；
//   外部 notes-changed 重拉时镜像已同步故「时好时坏」。修法：重拉 effect 显式传当次渲染闭包 filters.kinds，
//   loadNotes 增 kindsNow 形参（显式优先，ref 镜像仅兜底挂载期监听器闭包）。
// 覆盖：①源锚；②行为级——假 React 序位仿真（连续变更 kinds，每次 notes-list kind 参数与当次 filters 一致）+
//   缺省档零 kind 参数回归 + 监听器兜底路径回归；③search.js debounce 链路锚不回归。
module.exports = {
  id: "101",
  title: "101. 0.4.6-K kind 过滤滞后一拍根修（filtersRef 序位 → 显式传参，notes-046-kind-lag）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('101. 0.4.6-K kind 过滤滞后一拍根修（filtersRef 序位 → 显式传参）')

  const cliIndex = fsNative.readFileSync(path.join(DIR, 'src', 'client', 'panels', 'panel', 'index.js'), 'utf8')
  const cliSearch = fsNative.readFileSync(path.join(DIR, 'src', 'client', 'panels', 'panel', 'search.js'), 'utf8')

  // ---- 101.0 源锚：显式传参 effect + kindsNow 形参 + filtersRef 镜像保留（监听器兜底）+ 拼接产物同步 ----
  await t('0.4.6-K 源锚：kinds 重拉 effect 显式传 filters.kinds + loadNotes kindsNow 形参优先 + 产物同步', () => {
    assert(cliIndex.indexOf('React.useEffect(() => { if (open) loadNotes(true, filters.kinds) }, [filters.kinds])') >= 0, 'kinds 重拉 effect 显式传当次渲染闭包 filters.kinds（甩掉 filtersRef 镜像序位依赖）')
    assert(cliIndex.indexOf('async function loadNotes(silent, kindsNow)') >= 0 && cliIndex.indexOf('const kf = kindsNow || (F && F.kinds) || []') >= 0, 'loadNotes kindsNow 显式形参优先，filtersRef 镜像仅兜底（noteRefreshListeners 挂载期闭包）')
    assert(cliIndex.indexOf('React.useEffect(() => { filtersRef.current = filters }, [filters])') < 0, 'filtersRef 同步 effect 不在装配层（随 search.js，序位滞后源唯一）')
    assert(clientSrc.indexOf('loadNotes(true, filters.kinds)') >= 0 && clientSrc.indexOf('async function loadNotes(silent, kindsNow)') >= 0, 'client 拼接产物同步')
  })

  // ---- 101.1 行为级：假 React 序位仿真——kinds 重拉 effect 先于 filtersRef 同步 effect 执行（真实序位）----
  await t('0.4.6-K 行为级：连续变更 kinds（[]→[sys]→[sys,note]→[]）每次 notes-list kind 参数与当次 filters 一致', async () => {
    const mLoad = clientSrc.match(/async function loadNotes\(silent, kindsNow\) \{([\s\S]*?)return list \}/)
    const mKinds = clientSrc.match(/React\.useEffect\(\(\) => \{ (if \(open\) loadNotes\(true, filters\.kinds\)) \}, \[filters\.kinds\]\)/)
    const mSync = clientSrc.match(/React\.useEffect\(\(\) => \{ (filtersRef\.current = filters) \}, \[filters\]\)/)
    assert(mLoad && mKinds && mSync, '提取 loadNotes / kinds 重拉 effect / filtersRef 同步 effect 失败（结构变更需同步本断言）')
    // 世界：filtersRef 稳态（= 上一 commit 已同步镜像）；每 commit 按真实声明序 flush：kindsEffect → syncEffect
    const calls = []
    const target = {
      open: true,
      filters: { pinned: false, injected: false, injectEver: false, sensitive: false, kinds: [] },
      filtersRef: { current: { pinned: false, injected: false, injectEver: false, sensitive: false, kinds: [] } },   // 稳态镜像（滞后一拍的事故现场 = 同步 effect 序位在后）
      host: { call: async (name, args) => { calls.push({ name: name, args: args }); return { notes: [] } } },
      setLoading: function () {}, setError: function () {}, setNotes: function () {},
      setLandingStall: function () {}, loadFolders: function () {}, ensureWikiIndex: function () {},
    }
    const proxy = new Proxy(target, {
      has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
      get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
      set(t2, k, v) { t2[k] = v; return true }
    })
    new Function('scope', 'with (scope) {\nloadNotes = async function (silent, kindsNow) {' + mLoad[1] +
      '\n}\nkindsEffect = function () { ' + mKinds[1] + ' }\nsyncEffect = function () { ' + mSync[1] + ' }\n}')(proxy)
    // commit 仿真：kinds 重拉 effect 先跑（镜像仍是上一拍），同步 effect 后跑
    async function commit(kinds) {
      target.filters = { pinned: false, injected: false, injectEver: false, sensitive: false, kinds: kinds }
      await target.kindsEffect()   // 声明序位在前（index.js kinds effect ≺ usePanelSearch 内 sync effect）
      target.syncEffect()
    }
    await commit([]); assert.strictEqual(calls[0].args, undefined, '档①缺省 kinds=[]：零 kind 参数（缺省降噪回归）')
    await commit(['sys']); assert.deepStrictEqual(calls[1].args, { kind: 'sys' }, '档②勾选「机器」：当次即 kind=sys（修复前此处实得 undefined——镜像慢一拍）')
    await commit(['sys', 'note']); assert.strictEqual(calls[2].args, undefined, "档③多选 kinds=[sys,note]：当次即回无参（修复前此处实得 {kind:'sys'}——上一拍口径）")
    await commit([]); assert.strictEqual(calls[3].args, undefined, "档④清空 kinds=[]：当次即回无参（修复前此处仍发 {kind:'sys'}）")
    assert.strictEqual(calls.length, 4, '每次 kinds 变更恰一次 notes-list 重拉')
    // 监听器兜底路径回归：不显式传参时仍读 filtersRef 镜像（noteRefreshListeners 外部触发时镜像已同步）
    await target.loadNotes(true)
    assert.strictEqual(calls[4].args, undefined, '监听器兜底：filtersRef 镜像路径存活（kinds=[] → 无参）')
    await commit(['note']); assert.deepStrictEqual(calls[5].args, { kind: 'note' }, '档⑤恰选 note：当次即 kind=note')
    await target.loadNotes(true)
    assert.deepStrictEqual(calls[6].args, { kind: 'note' }, '监听器兜底：同步后镜像路径给出 kind=note（外部 notes-changed 重拉口径不变）')
  })

  // ---- 101.2 searchKinds debounce 链路不回归（search.js 零改动锚）----
  await t('0.4.6-K 回归：search.js debounce 链路锚原样（filtersRef 镜像同步 + sArgs 组合过滤 + 250ms 防抖）', () => {
    assert(cliSearch.indexOf('React.useEffect(() => { filtersRef.current = filters }, [filters])') >= 0, 'filtersRef 镜像同步 effect 原样（debounce 闭包读最新值通道不动）')
    assert(cliSearch.indexOf('if (F.kinds.length === 1) sArgs.kind = F.kinds[0]') >= 0, 'debounce 内恰选单 kind 传 sArgs.kind 原样')
    assert(cliSearch.indexOf('timer.debounce(') >= 0 && cliSearch.indexOf('}, 250)') >= 0, '250ms 防抖原样')
  })
  }
}
