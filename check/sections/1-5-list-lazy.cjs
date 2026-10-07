// 节 1.5 T1.2 列表懒加载分页（0.4.6-J 起改写：分组各自分页 + 组尾加载行；全局窗口切片退役）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
// 0.4.6-J（notes-046-group-paging）口径：旧模型 = 全局 flat 窗口切片 + 滚动加载——四组共享同一窗口，
//   文件夹收起时树内容过短 → 无滚动条 → 滚动加载永不触发 → 窗口外条目无途径够到（反馈 n-muxyj3zodvf3 实证死锁）；
//   新模型 = 分组各自分页（groupShown state + kernel/constants.js group-paging 纯函数核 + renderMoreRow 组尾按钮行），
//   组内 cap PAGE_SIZE=50 性能闸保留（总渲染量 = Σ min(组命中, 50)，小库≈全量，与 app 端恒全量口径收敛）。
// 0.4.7-D2（notes-047-panel-e2e-migrate）：④⑤ 行为级/边界 eval 探针退役，迁 e2e 真机用例㉞㊱（逐条映射见本节末尾块注）；
//   本节余量 = ①结构锚 + ②退役锚 + ③sysKids 序位源锚（8 条）。
module.exports = {
  id: "1.5",
  title: "1.5 T1.2 列表分组懒加载分页（0.4.6-J：四组同构 + 组尾加载行）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, SRC_STYLES, clientSrc } = H
  // ===== 1.5 T1.2 列表分组懒加载分页（client 逻辑层验证）=====
  section('1.5 T1.2 列表分组懒加载分页（0.4.6-J：四组同构 + 组尾加载行）')

  // ===== ① 结构锚：PAGE_SIZE 保留 + group-paging 纯函数核 + 分组分页 state + 重置 effect =====
  await t('client-impl 含 PAGE_SIZE 常量', () => assert(/PAGE_SIZE\s*=\s*50/.test(clientSrc), 'PAGE_SIZE=50（值不改红线）'))
  await t('group-paging 纯函数核标记块在位（groupShownOf/groupPage/groupMoreCount/groupPageNext）', () => {
    const m = clientSrc.match(/\/\/ ==== group-paging BEGIN ====[\s\S]*?\/\/ ==== group-paging END ====/)
    assert(m, '缺 group-paging 标记块（kernel/constants.js）')
    for (const fn of ['groupShownOf', 'groupPage', 'groupMoreCount', 'groupPageNext']) assert(m[0].indexOf('function ' + fn + '(') >= 0, '块内缺 ' + fn)
  })
  await t('client-impl 分组分页 state + 过滤/搜索/视图切换重置 effect', () => {
    assert(/const \[groupShown, setGroupShown\] = React\.useState\(\{\}\)/.test(clientSrc), 'groupShown state（对象 map：key=组标识，value=当前显示条数）')
    assert(clientSrc.indexOf('React.useEffect(() => { setGroupShown({}) }, [searchText, searchIds, view, filters])') >= 0, '重置 effect 依赖面沿用（searchText/searchIds/view/filters）')
  })
  await t('四组同构消费点：置顶/文件夹/未入夹/主题各经 groupPage 切片 + renderMoreRow 组尾加载行', () => {
    assert(clientSrc.indexOf("groupPage(pinnedAll, groupShown, 'pinned')") >= 0, '置顶组锚（组标识 pinned）')
    assert(clientSrc.indexOf('groupPage(kidsAll, groupShown, f.id)') >= 0, '文件夹组锚（组标识 folder.id）')
    assert(clientSrc.indexOf("groupPage(unfiledHits, groupShown, 'unfiled')") >= 0, '未入夹区锚（组标识 unfiled）')
    assert(clientSrc.indexOf("groupPage(tkidsAll, groupShown, 'topic:' + tn)") >= 0, '主题组锚（组标识 topic:+主题名）')
    const cnt = (clientSrc.match(/renderMoreRow\(/g) || []).length
    assert.strictEqual(cnt, 5, 'renderMoreRow = 定义 1 + 四组调用点 4（实得 ' + cnt + '）')
    assert(clientSrc.indexOf("tt('tree.moreRows', { n:") >= 0, '加载行文案走 tt() tree.moreRows')
    assert(clientSrc.indexOf("className: 'dsh-notes-more-row'") >= 0, '加载行类名 dsh-notes-more-row')
  })
  await t('styles.css 组尾加载行样式（复用原视觉 + cursor:pointer + hover 态；旧全局类退役）', () => {
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    assert(/\.dsh-notes-more-row\{[^}]*cursor:pointer/.test(css), 'more-row 基态含 cursor:pointer')
    assert(css.indexOf('.dsh-notes-more-row:hover{') >= 0, 'more-row hover 态')
    assert(css.indexOf('.dsh-notes-more{') < 0, '旧全局提示行类退役')
  })
  await t('原型静态示例行同步（0.4.4-F 纪律）：树示例区含「加载更多（还有 N 条）」静态行 + more-row 样式', () => {
    const proto = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    assert(proto.indexOf('class="more-row"') >= 0 && proto.indexOf('加载更多（还有') >= 0, '原型树示例区静态加载行')
    assert(proto.indexOf('.more-row{') >= 0, '原型 more-row 样式')
  })

  // ===== ② 退役锚：全局窗口切片链路清零（state/滚动加载/全局提示行/字典键）=====
  await t('退役锚：全局 flat 切片 / 滚动加载 / 全局提示行 / side.more 键全清零', () => {
    assert(clientSrc.indexOf('visibleCount') < 0, 'visibleCount state 退役（零残留）')
    assert(clientSrc.indexOf('onListScroll') < 0, '滚动加载退役（零残留）')
    assert(!/filtered\.slice\(0\s*,/.test(clientSrc), '全局 flat 切片退役（filtered 只经分组谓词+组分页消费）')
    assert(clientSrc.indexOf('hasMore') < 0, 'hasMore 判定退役')
    assert(clientSrc.indexOf("t('side.more'") < 0 && clientSrc.indexOf("tt('side.more'") < 0, 'side.more 代码引用清零')
    const grab = (s, v) => new Function(s + '\nreturn ' + v)()
    const zh = grab(fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8'), 'I18N_ZH')
    const en = grab(fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'en.js'), 'utf8'), 'I18N_EN')
    assert(!('side.more' in zh) && !('side.more' in en), 'side.more 键双字典删除')
    assert(zh['tree.moreRows'] === '加载更多（还有 {n} 条）' && typeof en['tree.moreRows'] === 'string' && en['tree.moreRows'].indexOf('{n}') >= 0, 'tree.moreRows 键双字典新增（{n} 占位符同形）')
  })

  // ===== ③ sysKids 不占分页名额（合并口径不变：分页 slice 之后再 concat sys 置尾行）=====
  await t('sysKids 置尾合并在分页 slice 之后（sys 行不占分页名额，序位锚）', () => {
    const iSlice = clientSrc.indexOf('const kidsBase = groupPage(kidsAll, groupShown, f.id)')
    const iConcat = clientSrc.indexOf('kidsBase.concat(((sysKids[f.id] && sysKids[f.id].rows) || [])')
    assert(iSlice >= 0 && iConcat > iSlice, '分页 slice 先于 sys concat')
  })

  // ===== ④⑤ 行为级/边界 eval 探针——0.4.7-D2（notes-047-panel-e2e-migrate）已退役并迁真机 =====
  // 退役裁决（「真机已覆盖的 eval 退役」原则，逐条映射；原断言均为 mkSandbox e 打桩 eval，真机版严格更强——
  // 真 React 18 渲染树 + 真实点击事件链 + 真 mock RPC + 真 zh 字典插值后的 DOM 文本）：
  //   「组内分页行为级：60 条同夹 → 首屏 50 + 还有 10 → 点击 → 60 全渲染 + 行消失」
  //     → e2e ㉞（34-panel-group-paging：120 条 50→100→120 全真机点击链，含边界行可见性）+ ㊱ mount A 步①②（恰 60 条同夹同款路径）
  //   「多组独立：A 夹翻页不影响 B 夹/置顶/未入夹/主题组显示数」
  //     → ㊱ mount A 步②④（fA/fB 双向翻页互不影响）+ mount B 步②（置顶翻页后同批笔记的钉夹仍 50）
  //   「过滤/搜索/视图切换重置：groupShown 归 {} → 各组回缺省 50」
  //     → ㊱ mount A 步③⑤⑥（重置 effect 三依赖面 filters/searchText/view 各一条真机腿）
  //   「四组同构行为：置顶/未入夹/主题组各自分页 + 加载行（组标识锚 + 元素 key）」
  //     → ㊱ mount B 步①（四组各自 50+「还有 5 条」DOM 锁）+ 步②③④（置顶/主题/未入夹真机翻页；文件夹翻页 mount A 承接）
  //   「sysKids 不占分页名额回归：60 命中 → 50 切片 + 3 sys 置尾 = 53 渲染行，剩余计数按命中全量」
  //     → ㊱ mount A 步⑦（真 sysKids 补拉 RPC 链：53 行 + 置尾序位 + 还有 10 条 + 夹头计数 63 含 sys）
  //   「分组分页边界：0 条 / 恰好 50 / 51 条 / 累进翻页 / 越界安全」
  //     → ㊱ mount B 步⑤（0/恰好 50/51/30 四夹边界 DOM 锁）+ ㉞（120 累进翻页 50→100→120）
  // 保留：①结构锚（PAGE_SIZE/纯函数核/state/消费点/样式/原型）②退役锚（含 tree.moreRows 字典键看守）③sysKids 序位源锚——静态锚非 eval 探针，不动。
  }
}
