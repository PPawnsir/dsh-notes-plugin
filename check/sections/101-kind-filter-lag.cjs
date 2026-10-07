// 节 101. 0.4.6-K（notes-046-kind-lag）：kind 过滤滞后一拍根修——filtersRef 镜像序位依赖 → loadNotes 显式传参
// 根因链：index.js 的 kinds 重拉 effect 声明在 usePanelSearch 之前 → filtersRef 镜像在 search.js 内 effect 同步 →
//   同一 commit 内 React effect 按声明序执行 → kinds 重拉 effect 读到的镜像慢一次点击（kind 参数滞后一拍）；
//   外部 notes-changed 重拉时镜像已同步故「时好时坏」。修法：重拉 effect 显式传当次渲染闭包 filters.kinds，
//   loadNotes 增 kindsNow 形参（显式优先，ref 镜像仅兜底挂载期监听器闭包）。
// 覆盖：①源锚；②行为级——0.4.7-D2 起迁 e2e 真机用例㉝（原假 React 序位仿真退役，逐条映射见 101.1 块注）；
//   ③search.js debounce 链路锚不回归。
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

  // ---- 101.1 假 React 序位仿真——0.4.7-D2（notes-047-panel-e2e-migrate）已退役，迁 e2e 真机用例㉝（33-panel-kind-lag）----
  // 退役裁决：原断言用 Proxy 世界按声明序手排 effect（kindsEffect ≺ syncEffect）回放五档 + 监听器兜底；
  //   真机版严格更强——真 React 18 commit 序 + 真 effect 链 + 真 UI 勾选事件 + harness 录制 host.call 参数序列逐位锁。逐条映射：
  //   档①「缺省 kinds=[] 零 kind 参数」              → ㉝ 步①（开板无参 + 6 行全量 + sys 排除锁）
  //   档②「[sys] 当次即 kind=sys」                   → ㉝ 步③（勾「机器」，含 DOM 仅机器行 + 命中 1 条）
  //   档③「[sys,note] 多选当次即回无参」             → ㉝ 步④（加勾「笔记」，含多选无参口径 DOM 3 行锁）
  //   档④「清空 kinds=[] 当次即回无参」              → ㉝ 步⑥（经步⑤ [note] 中间档连摘两次）
  //   「每次 kinds 变更恰一次 notes-list 重拉」       → ㉝ 每档 delta===1 计数锁 + 收尾全序列逐位相等
  //   档⑤「恰选 note 当次即 kind=note」              → ㉝ 步⑧（删除后复勾）
  //   「监听器兜底：[]→无参 / [note]→kind=note」      → ㉝ 步⑦⑨（编辑器删除 → doDelete loadNotes(true) +
  //     notifyNotesChanged → 监听器/📎徽标三连重拉，全走 filtersRef 镜像路径，实收参数与当次档一致）
  // 保留：101.0 源锚（显式传参 effect + kindsNow 形参 + 镜像零残留防回退）+ 101.2 debounce 链路锚（本卡零改动看守）。

  // ---- 101.2 searchKinds debounce 链路不回归（search.js 零改动锚）----
  await t('0.4.6-K 回归：search.js debounce 链路锚原样（filtersRef 镜像同步 + sArgs 组合过滤 + 250ms 防抖）', () => {
    assert(cliSearch.indexOf('React.useEffect(() => { filtersRef.current = filters }, [filters])') >= 0, 'filtersRef 镜像同步 effect 原样（debounce 闭包读最新值通道不动）')
    assert(cliSearch.indexOf('if (F.kinds.length === 1) sArgs.kind = F.kinds[0]') >= 0, 'debounce 内恰选单 kind 传 sArgs.kind 原样')
    assert(cliSearch.indexOf('timer.debounce(') >= 0 && cliSearch.indexOf('}, 250)') >= 0, '250ms 防抖原样')
  })
  }
}
