// 节 1.7 UI v2 client 渲染结构（两栏 + 主题全局过滤 + SVG 图标）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "1.7",
  title: "1.7 UI v2 client 渲染结构（两栏 + 主题全局过滤 + SVG 图标）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { plugin } = S
  // ===== 1.7 UI v2 client 渲染结构断言（两栏布局 + 主题全局过滤 + 全 SVG 图标）=====
  section('1.7 UI v2 client 渲染结构（两栏 + 主题全局过滤 + SVG 图标）')
  await t('client-impl 含 kind 标签映射', () => assert(/KIND_LABELS\s*=/.test(clientSrc) && clientSrc.indexOf('decision') >= 0, 'KIND_LABELS 映射'))
  await t('SVG 图标 helper I() + 内联图标集（原型 15 symbol + check/tag/swap）', () => {
    assert(/const IC = \{/.test(clientSrc), 'IC 图标集存在')
    assert(/function I\(name, size, cls\)/.test(clientSrc), 'I(name, size, cls) 图标 helper 存在')
    assert(/viewBox: '0 0 24 24'/.test(clientSrc), 'svg viewBox 0 0 24 24')
    // 原型 symbol 的 path 数据逐个内联（抽查关键图标）
    for (const d of ['M12 17v5M7 4h10', 'm20 20-3.5-3.5', 'm9 6 6 6-6 6', 'M13 3 5 13.5h6L11 21l8-10.5h-6Z', 'M4 5h16l-6.5 7.5V19l-3-1.5v-5Z']) {
      assert(clientSrc.indexOf("d: '" + d) >= 0, 'IC 缺 path：' + d)
    }
  })
  await t('emoji 全移除（面板内图标全部 SVG）', () => {
    for (const emoji of ['📌', '⚡', '👁', '🗑', '📁', '📂', '✎', '📝', '⌕', '📇']) {
      assert(clientSrc.indexOf(emoji) < 0, 'client-impl 不应再含 emoji ' + emoji)
    }
  })
  await t('两栏布局骨架（侧栏 + 编辑器通栏）', () => {
    for (const cls of ['dsh-notes-app', 'dsh-notes-side', 'dsh-notes-brand', 'dsh-notes-quick', 'dsh-notes-filterbar', 'dsh-notes-tree', 'dsh-notes-side-foot', 'dsh-notes-ed']) {
      assert(clientSrc.indexOf(cls) >= 0, 'client-impl 缺两栏结构 class：' + cls)
    }
    assert(clientSrc.indexOf('dsh-notes-list') < 0 && clientSrc.indexOf('dsh-notes-divider') < 0 && clientSrc.indexOf('dsh-notes-content') < 0, '旧三栏（list/divider/content）已移除')
    assert(clientSrc.indexOf('listWidth') < 0, '旧列宽拖拽（listWidth）已移除')
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    for (const cls of ['.dsh-notes-app{', '.dsh-notes-side{', '.dsh-notes-brand{', '.dsh-notes-quick{', '.dsh-notes-filterbar{', '.dsh-notes-tree{', '.dsh-notes-side-foot{', '.dsh-notes-fbtn{', '.dsh-notes-ed{']) {
      assert(css.indexOf(cls) >= 0, 'styles.css 缺两栏样式：' + cls)
    }
    assert(/\.dsh-notes-side\{[^}]*width:300px/.test(css), '侧栏固定宽 300px')
  })
  await t('品牌行 + 计数 + 新建＋入口 + 侧栏底部收敛为 回收站/选择/设置 三入口（导出/导入/整理移入设置卡片）', () => {
    assert(clientSrc.indexOf('dsh-notes-brand-logo') >= 0 && clientSrc.indexOf('dsh-notes-brand-cnt') >= 0, '品牌行 logo + 计数')
    assert(clientSrc.indexOf("' 条'") >= 0, '品牌行计数文案「N 条」')
    // 筛选中心口径⑥：新建 chip 迁入 brand 行右侧 ＋ 按钮
    assert(clientSrc.indexOf('dsh-notes-brand-add') >= 0, 'brand 行右侧新建 ＋ 入口（dsh-notes-brand-add）')
    // 底部按钮区精确截取（dsh-notes-side-foot → editorEl 之间）：恰 3 个 fbtn = 回收站 + 选择（多选合并迁入）+ 设置，无导出/导入/整理
    const foot = clientSrc.match(/dsh-notes-side-foot' \},([\s\S]*?)editorEl\)/)
    assert(foot, '侧栏底部区存在')
    assert.strictEqual((foot[1].match(/dsh-notes-fbtn/g) || []).length, 3, '底部按钮恰为 3 个（实得 ' + ((foot[1].match(/dsh-notes-fbtn/g) || []).length) + '）')
    assert(foot[1].indexOf('onClick: openTrash') >= 0 && foot[1].indexOf('onClick: toggleSelMode') >= 0 && foot[1].indexOf('onClick: openSettings') >= 0, '底部 = 回收站 + 选择 + 设置')
    assert(foot[1].indexOf('openExport') < 0 && foot[1].indexOf('openImport') < 0 && foot[1].indexOf('openSuggest') < 0, '底部已无 导出/导入/整理 入口')
    assert(foot[1].indexOf("'导出'") < 0 && foot[1].indexOf("'导入'") < 0 && foot[1].indexOf("'整理'") < 0, '底部无 导出/导入/整理 字样')
    // open* 逻辑保留：导出/导入仍在设置卡片「数据」区，整理建议在设置卡片「整理建议」行
    assert(clientSrc.indexOf("onClick: openExport") >= 0 && clientSrc.indexOf("onClick: openImport") >= 0 && clientSrc.indexOf("onClick: openSuggest") >= 0, 'openExport/openImport/openSuggest 逻辑保留（设置卡片路径可达）')
    assert(clientSrc.indexOf("I('gear', 12)") >= 0, '设置按钮 gear SVG 图标')
  })
  await t('筛选中心控制行（筛选按钮(N) + 激活 chips + 独立排序控件；popover 分组面板）', () => {
    assert(clientSrc.indexOf("const FILTER_KINDS = ['note', 'decision', 'todo', 'link', 'quote', 'log']") >= 0, '类型组六种 kind（多选；+log 工作记忆 v0 专入口）')
    assert(clientSrc.indexOf('dsh-notes-filterbar') >= 0 && clientSrc.indexOf('dsh-notes-fpop') >= 0, '筛选中心容器（filterbar + popover）')
    assert(clientSrc.indexOf('dsh-notes-fchip') >= 0 && clientSrc.indexOf('dsh-notes-fchip-x') >= 0, '激活条件 chip + × 移除')
    assert(clientSrc.indexOf('dsh-notes-fsort-menu') >= 0 && clientSrc.indexOf('dsh-notes-fsort-item') >= 0, '独立排序控件菜单')
    assert(clientSrc.indexOf("I('pin', 11)") >= 0, '置顶 pin 图标（popover 状态组）')
    assert(/onClick: openNewNote, 'data-tooltip': '新建笔记（Alt\+N）'/.test(clientSrc), 'brand 行 ＋ → openNewNote')
    // 旧平铺 chips / 旧筛选面板已移除
    assert(clientSrc.indexOf('dsh-notes-chip') < 0 && clientSrc.indexOf('dsh-notes-filter-panel') < 0 && clientSrc.indexOf('dsh-notes-fp-opt') < 0, '旧 chips 行/旧筛选面板类已移除')
    assert(clientSrc.indexOf("'仅置顶'") < 0 && clientSrc.indexOf("'仅敏感'") < 0 && clientSrc.indexOf("'仅注入'") < 0, '旧单选开关文案已移除')
  })
  await t('树结构：视图头 + 置顶组 + 文件夹组 + 未入夹根级直显区 + 主题全局过滤区', () => {
    assert(clientSrc.indexOf('dsh-notes-sec-h') >= 0, 'sec-h 分组头')
    assert(clientSrc.indexOf('全部笔记') >= 0 && clientSrc.indexOf("'主题 · ' + view.id") >= 0 && clientSrc.indexOf("'文件夹 · ' + folderName(view.id)") >= 0, '视图头文案（全部/主题/文件夹）')
    assert(clientSrc.indexOf('（跨文件夹 ') >= 0, '主题视图头含「跨文件夹 N 条」')
    assert(clientSrc.indexOf('PINNED_KEY') >= 0 && clientSrc.indexOf("'置顶'") >= 0, '置顶折叠组（PINNED_KEY 持久化）')
    assert(clientSrc.indexOf('dsh-notes-nested') >= 0, 'nested 子笔记容器')
    assert(clientSrc.indexOf('未分类') >= 0, '未入夹口径文案保留（右键「移出文件夹（未分类）」/面包屑兜底）')
    assert(clientSrc.indexOf("'dsh-notes-sec-h-t' }, '未分类')") < 0, '未入夹区不再渲染「未分类」分组头（同级直显，notes-tree-unfiled-sibling）')
    assert(clientSrc.indexOf("'主题 (' + (filtersActive ? topicHitCount : topicNames.length) + ')'") >= 0 && clientSrc.indexOf('跨文件夹') >= 0, '主题全局过滤区（默认折叠「主题 (N)」一行）')
    assert(clientSrc.indexOf('dsh-notes-topic-row') >= 0, '主题过滤行')
  })
  await t('视图求值：view 单选 ∩ 筛选中心（组内 OR / 跨组 AND）∩ 搜索', () => {
    assert(/const \[view, setView\] = React\.useState\(\{ type: 'all', id: '' \}\)/.test(clientSrc), 'view state（all/folder/topic 单选）')
    assert(clientSrc.indexOf("if (view.type === 'topic') filtered = filtered.filter(n => (n.topic || '') === view.id)") >= 0, '主题视图过滤')
    assert(clientSrc.indexOf("else if (view.type === 'folder') { const vsub = folderSubtreeIdsOf(view.id); filtered = filtered.filter(n => vsub[(n.folder || '')]) }") >= 0, '文件夹视图过滤（递归子树口径，notes-nested-folder-ui）')
    assert(clientSrc.indexOf('filtered = filtered.filter(n => matchFilters(n, filters))') >= 0, '筛选中心谓词接入求值管线')
    assert(/const \[filters, setFilters\] = React\.useState/.test(clientSrc), 'filters 状态（{pinned, injected, injectEver, sensitive, kinds[]}）')
  })
  await t('笔记行：kind 色点 + 标题(+pin) + 注入 bolt + 行尾（主题字/文件夹徽章/日期）', () => {
    assert(clientSrc.indexOf('dsh-notes-kind-dot') >= 0 && clientSrc.indexOf("style: { background: 'var(--nkind-' + (n.kind || 'note') + ')' }") >= 0, 'kind 色点走 token var(--nkind-*)')
    assert(clientSrc.indexOf('dsh-notes-note-ti') >= 0 && clientSrc.indexOf("I('pin', 10, 'dsh-notes-note-pin')") >= 0, '标题 + 置顶 pin 图标')
    assert(clientSrc.indexOf('dsh-notes-note-inj') >= 0 && clientSrc.indexOf("I('bolt', 10)") >= 0, '上下文注入 bolt 标记')
    assert(clientSrc.indexOf("'注入为上下文 · ' + (n.injectRole === 'reference' ? '资料' : '约定') + ' · 范围：'") >= 0, 'bolt tooltip 按 injectRole 段位显示 约定/资料')
    assert(clientSrc.indexOf('dsh-notes-fbadge') >= 0, '主题视图行尾文件夹徽章（fbadge）')
    assert(clientSrc.indexOf('dsh-notes-note-tp') >= 0 && clientSrc.indexOf('dsh-notes-note-dt') >= 0, '文件夹上下文行尾主题字 / 其余行尾日期')
    assert(clientSrc.indexOf('injectScopeLabel') >= 0, '注入范围文字函数')
    assert(clientSrc.indexOf("keepQuickRef.current && tags.indexOf('quick') < 0") >= 0, 'doSave 保留 quick 速记标签（v2 行不渲染标签，语义保留在保存链路）')
  })
  await t('编辑器：面包屑 + 大标题 + meta chips 行 + 正文 + 底部状态', () => {
    assert(clientSrc.indexOf('dsh-notes-ed-crumb') >= 0 && clientSrc.indexOf('dsh-notes-crumb-lnk') >= 0, '面包屑（主题段可点击）')
    assert(clientSrc.indexOf('jumpToTopicFilter') >= 0, '面包屑/主题 chip 跳主题全局过滤')
    assert(/className: 'dsh-notes-ed-title', placeholder: '无标题', value: edTitle/.test(clientSrc), '大标题输入（受控 edTitle）')
    assert(clientSrc.indexOf('dsh-notes-meta-chip') >= 0 && clientSrc.indexOf('dsh-notes-meta-act') >= 0, 'meta chips + 右侧操作')
    assert(/className: 'dsh-notes-meta-select', value: edKind/.test(clientSrc), 'kind 下拉 chip')
    assert(clientSrc.indexOf('dsh-notes-meta-dot') >= 0, 'kind 色点 chip')
    assert(/value: edTopic/.test(clientSrc) && clientSrc.indexOf('dsh-notes-meta-topic-input') >= 0, '主题 chip 可编辑')
    assert(/value: edTags/.test(clientSrc) && clientSrc.indexOf('dsh-notes-meta-tags-input') >= 0, '标签 chip 可编辑')
    assert(clientSrc.indexOf('dsh-notes-ed-foot') >= 0 && clientSrc.indexOf("'创建 '") >= 0 && clientSrc.indexOf("'更新 '") >= 0 && clientSrc.indexOf("'来源 会话 '") >= 0, '底部 创建/更新/来源')
    assert(clientSrc.indexOf('dsh-notes-ed-saved') >= 0 && clientSrc.indexOf('已自动保存 ') >= 0, '自动保存提示')
  })
  await t('编辑器 meta：注入三态分段控件 + 目录可见 toggle + 派发/来源/置顶/删除', () => {
    assert(clientSrc.indexOf("'dsh-notes-meta-chip dsh-notes-role-seg'") >= 0, '三态分段控件容器（meta-chip + role-seg）')
    assert((clientSrc.match(/dsh-notes-role-opt/g) || []).length >= 3, '三个段位（关闭/约定/资料）')
    assert(clientSrc.indexOf("onClick: () => setRoleSeg('off')") >= 0 && clientSrc.indexOf("onClick: () => setRoleSeg('convention')") >= 0 && clientSrc.indexOf("onClick: () => setRoleSeg('reference')") >= 0, '三段点击切换 setRoleSeg')
    assert(clientSrc.indexOf("'data-tooltip': '不注入系统提示'") >= 0, '关闭段 tooltip')
    assert(clientSrc.indexOf("'data-tooltip': '须遵守的行为规则'") >= 0, '约定段 tooltip')
    assert(clientSrc.indexOf("'data-tooltip': '事实性补充信息，Agent 按需取用'") >= 0, '资料段 tooltip')
    assert(/edRole === 'off' \? ' on' : ''/.test(clientSrc) && /edRole === 'convention' \? ' on' : ''/.test(clientSrc) && /edRole === 'reference' \? ' on' : ''/.test(clientSrc), '选中段 on 态高亮（三态各自分支）')
    assert(clientSrc.indexOf('dsh-notes-ed-scope-wrap') >= 0 && clientSrc.indexOf('dsh-notes-scope-panel') >= 0 && clientSrc.indexOf('dsh-notes-scope-trigger') >= 0, '逐级范围浮层挂 meta 行')
    assert(/const isInjected = edRole !== 'off'/.test(clientSrc) && clientSrc.indexOf('isInjected ? e(\'span\', { className: \'dsh-notes-ed-scope-wrap\' }') >= 0, '范围浮层在非 off（约定/资料）时显示')
    assert(clientSrc.indexOf('目录可见') >= 0 && clientSrc.indexOf("I('eye', 11)") >= 0, '目录可见 toggle（eye 图标）')
    assert(clientSrc.indexOf("'派发'") >= 0 && clientSrc.indexOf("I('play', 12)") >= 0, '派发操作（play 图标）')
    assert(clientSrc.indexOf("'来源'") >= 0 && clientSrc.indexOf("I('ext', 12)") >= 0, '来源操作（ext 图标）')
    assert(clientSrc.indexOf("I('pin', 12)") >= 0 && clientSrc.indexOf("I('trash', 12)") >= 0, '置顶/删除操作图标')
    assert(clientSrc.indexOf('openDispatch') >= 0 && clientSrc.indexOf('jumpToSession') >= 0, '派发/来源行为保留')
  })
  await t('client-impl 含 status 类名分支', () => assert(/status === 'pinned'/.test(clientSrc) && /status === 'resolved'/.test(clientSrc) && /status === 'superseded'/.test(clientSrc), 'status 视觉分支'))
  await t('client-impl 选区捕获传 kind=quote', () => assert(/kind: 'quote'/.test(clientSrc), 'selection capture → quote'))
  await t('快速记录卡片 v2 结构（cap-h + 识别为引用徽章 + cap-pv 预览 + cap-in 输入 + 三按钮）', () => {
    assert(clientSrc.indexOf('dsh-notes-cap-h') >= 0 && clientSrc.indexOf('dsh-notes-cap-src') >= 0, '卡片头部')
    assert(clientSrc.indexOf('dsh-notes-cap-auto') >= 0 && clientSrc.indexOf('识别为 引用') >= 0, '「识别为 引用」自动徽章')
    assert(clientSrc.indexOf('dsh-notes-cap-pv') >= 0, '选区预览块')
    assert(/lines\.length > 160 \? lines\.slice\(0, 160\)/.test(clientSrc), '预览 160 字上限（原型口径）')
    assert(clientSrc.indexOf('dsh-notes-cap-in') >= 0 && clientSrc.indexOf('dsh-notes-cap-input') >= 0, '补充输入框')
    assert(clientSrc.indexOf('Enter 记录') >= 0, '输入框 kbd 提示')
    assert(clientSrc.indexOf('dsh-notes-cap-acts') >= 0, '按钮行')
    assert(clientSrc.indexOf('复制') >= 0 && clientSrc.indexOf("'记录'") >= 0 && clientSrc.indexOf("'取消'") >= 0, '复制/记录/取消三按钮')
    assert(/dsh-notes-cbtn primary/.test(clientSrc), '记录按钮 primary 实心强调色')
    assert(/copySelection/.test(clientSrc), 'copySelection 复制处理函数存在')
    assert(clientSrc.indexOf('navigator.clipboard') >= 0, '优先 navigator.clipboard.writeText')
    assert(clientSrc.indexOf('execCommand') >= 0, '降级 execCommand 兜底')
    assert(clientSrc.indexOf("closest('.dsh-notes-cap')") >= 0, '卡片内部点击不误关（closest 守卫）')
    // 旧选区指令框（instruct 系列）已移除
    assert(clientSrc.indexOf('dsh-notes-instruct') < 0, '旧 instruct 浮层已移除')
  })
  await t('快速记录卡片 v2 样式走 token（无硬编码白底/深色字）', () => {
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    for (const cls of ['.dsh-notes-cap{', '.dsh-notes-cap-h{', '.dsh-notes-cap-pv{', '.dsh-notes-cap-in{', '.dsh-notes-cap-acts{', '.dsh-notes-cbtn{']) {
      assert(css.indexOf(cls) >= 0, 'styles.css 缺卡片样式：' + cls)
    }
    assert(/\.dsh-notes-cbtn\.primary\{[^}]*var\(--nacc\)/.test(css), 'primary 按钮用 var(--nacc) 主题色')
    assert(/\.dsh-notes-cbtn\.primary:hover\{[^}]*opacity:\.9/.test(css), 'primary hover 减透明度（原型口径）')
    assert(/\.dsh-notes-cap-input\{[^}]*background:transparent/.test(css), 'cap-input 背景透明（抬升面容器之上）')
    assert(css.indexOf('dsh-notes-capin') >= 0, '卡片弹出动画')
    assert(css.indexOf('.dsh-notes-instruct') < 0, '旧 instruct 样式已移除')
    // cap 系列全部走 token：无硬编码白底/深色字（var() fallback 与 primary 白字除外）
    const capRules = css.match(/\.dsh-notes-(cap|cbtn)[^{]*\{[^}]*\}/g) || []
    const noVar = (r) => r.replace(/var\([^)]*\)/g, '')
    const badBg = capRules.filter(r => /background:\s*(#fff\b|white\b)/i.test(noVar(r)))
    assert.strictEqual(badBg.length, 0, 'cap 系列不得含硬编码白底：' + badBg.join(' | '))
    const badFg = capRules.filter(r => /(^|[{;])\s*color:\s*(#0[0-9a-f]|#1[0-9a-f]|#2[0-9a-f]|#3[0-9a-f]|black\b)/i.test(noVar(r)))
    assert.strictEqual(badFg.length, 0, 'cap 系列不得含硬编码深色字：' + badFg.join(' | '))
  })
  await t('client-impl 注入为独立三态控件+逐级范围浮层', () => {
    assert(/function setRoleSeg\(r\) \{/.test(clientSrc), '独立注入三态切换 setRoleSeg（不碰标签）')
    assert(!/toggleInject/.test(clientSrc), '旧布尔开关 toggleInject 已移除')
    assert(/if \(r === 'off'\) setScopeOpen\(false\)/.test(clientSrc) && /else if \(wasOff\) setScopeOpen\(true\)/.test(clientSrc), 'off→非off 自动展开范围浮层，切 off 收起')
    assert(/edScope/.test(clientSrc), '范围多选 edScope 数组')
    assert(/dsh-notes-scope-group/.test(clientSrc) && /scopeByWs/.test(clientSrc), '会话按工作区分组（两级）')
    assert(clientSrc.indexOf("toggleScope('workspace')") < 0 && clientSrc.indexOf("toggleScope('global')") < 0, '范围浮层移除「本工作区/全局」选项（缺省=所有会话）')
    assert(clientSrc.indexOf('dsh-notes-scope-hint') >= 0 && clientSrc.indexOf('默认注入到所有会话；勾选会话则仅限这些会话') >= 0, '范围浮层顶部灰色默认提示行')
    assert(clientSrc.indexOf("return '所有会话'") >= 0, '范围触发按钮缺省标签=所有会话')
    assert(clientSrc.indexOf('sessList') >= 0 && clientSrc.indexOf('notes-sessions') >= 0, '会话名列表 sessList 来自 notes-sessions RPC')
  })
  await t('注入范围重构：schema 描述去工作区/全局维度（host-impl / index.mjs 双边）+ 发布包同步', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(src.indexOf('["workspace"]') < 0 && src.indexOf('["global"]') < 0, label + ' schema/工具描述不含 ["workspace"]/["global"] 字样')
      assert(src.indexOf('Injection scope multi-select: [] or omitted=all sessions (default), or session short-ids like ["99f2b674","7f8b49e6"] to restrict') >= 0, label + ' schema injectTo 描述新口径（缺省=所有会话）')
      // conventionHit 新语义：缺省/存量 'global'/'workspace' 值 → 所有会话；会话短 id → 仅限这些会话
      assert(src.indexOf("if (t === 'global' || t === 'workspace') return true") >= 0, label + ' conventionHit 存量 global/workspace 值按所有会话容错')
      assert(src.indexOf('当前工作区优先') < 0 && src.indexOf('←') < 0, label + ' 目录去「当前工作区优先」排序与 ←来源 标注')
    }
    const pkgClient = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
    assert(pkgClient.indexOf("toggleScope('workspace')") < 0 && pkgClient.indexOf("toggleScope('global')") < 0, '发布包 lib/client.js 范围浮层移除「本工作区/全局」选项（需先跑 scripts/build-dist.cjs）')
    assert(pkgClient.indexOf('默认注入到所有会话；勾选会话则仅限这些会话') >= 0 && pkgClient.indexOf("return '所有会话'") >= 0, '发布包提示行/缺省标签同步')
    const devCss = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const pkgCss = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    assert(devCss.indexOf('.dsh-notes-scope-hint{') >= 0 && pkgCss.indexOf('.dsh-notes-scope-hint{') >= 0, 'styles.css / 发布包样式含 scope-hint（var(--nt3) 灰字）')
  })
  await t('注入三态 edRole 链路：state/ref/selectNote 映射/doSave payload（开发版 + 发布包）', () => {
    assert(/const \[edRole, setEdRole\] = React\.useState\('off'\)/.test(clientSrc), 'edRole 三态 state（off/convention/reference，缺省 off）')
    assert(/const edRoleRef = React\.useRef\('off'\)/.test(clientSrc), 'edRoleRef 自动保存镜像存在')
    assert(/setEdRole\(n\.inject \? \(n\.injectRole \|\| 'convention'\) : 'off'\)/.test(clientSrc), 'selectNote 映射：inject=true 无 role 缺省 convention（存量零迁移），否则 off')
    assert(/edRoleRef\.current = edRole/.test(clientSrc), '渲染期同步 edRoleRef')
    assert(/inject: edRoleRef\.current !== 'off'/.test(clientSrc), 'doSave：off → inject:false')
    assert(/if \(upd\.inject\) upd\.injectRole = edRoleRef\.current/.test(clientSrc), 'doSave：非 off 才带 injectRole（off 态 payload 不带，禁 undefined）')
    assert(clientSrc.indexOf('edInject') < 0, '旧 edInject 布尔链路清零')
    const pkgRole = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
    assert(pkgRole.indexOf('dsh-notes-role-seg') >= 0 && pkgRole.indexOf('setRoleSeg') >= 0 && pkgRole.indexOf('edRoleRef') >= 0, '发布包 lib/client.js 同步三态链路（需先跑 scripts/build-dist.cjs）')
    assert(pkgRole.indexOf('edInject') < 0 && pkgRole.indexOf('toggleInject') < 0, '发布包旧布尔链路清零')
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    assert(css.indexOf('.dsh-notes-role-seg{') >= 0 && css.indexOf('.dsh-notes-role-opt{') >= 0 && css.indexOf('.dsh-notes-role-opt.on{') >= 0, 'styles.css 含 role-seg/role-opt 三态样式')
    assert(/\.dsh-notes-role-opt\.on\{[^}]*background:var\(--nbg-sel\)[^}]*color:var\(--nacc-tx\)/.test(css), '选中段走 var(--nbg-sel) + var(--nacc-tx) token')
    const pkgCss = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    assert(pkgCss.indexOf('.dsh-notes-role-opt.on{') >= 0, '发布包 lib/styles.css 同步三态样式')
  })
  await t('app.html + 原型三态同步：分段控件/role 映射/保存 payload/mock 链路', () => {
    const appRole = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const protoRole = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    for (const pair of [[appRole, 'app.html'], [protoRole, '原型 notes-ui-v2.html']]) {
      const src = pair[0], tag = pair[1]
      assert(src.indexOf('meta-chip role-seg') >= 0 && src.indexOf('data-role="off"') >= 0 && src.indexOf('data-role="convention"') >= 0 && src.indexOf('data-role="reference"') >= 0, tag + ' 含三态分段控件（关闭/约定/资料）')
      assert(src.indexOf('>关闭</span>') >= 0 && src.indexOf('>约定</span>') >= 0 && src.indexOf('>资料</span>') >= 0, tag + ' 三段位文案')
      assert(src.indexOf('title="不注入系统提示"') >= 0 && src.indexOf('title="须遵守的行为规则"') >= 0 && src.indexOf('title="事实性补充信息，Agent 按需取用"') >= 0, tag + ' 三段 tooltip')
      assert(src.indexOf("var role = n.inject ? (n.injectRole === 'reference' ? 'reference' : 'convention') : 'off'") >= 0, tag + ' renderMeta 三态映射（存量 inject=true 无 role 缺省 convention）')
      assert(src.indexOf("if (upd.inject) upd.injectRole = edNote.injectRole === 'reference' ? 'reference' : 'convention'") >= 0, tag + ' doSave 非 off 才带 injectRole（payload 禁 undefined）')
      assert(/\.role-seg \.seg\.on\{[^}]*background:var\(--nbg-sel\)[^}]*color:var\(--nacc-tx\)/.test(src), tag + ' 选中段样式走 var(--nbg-sel)+var(--nacc-tx) token')
      assert(src.indexOf('id="mInj"') < 0 && src.indexOf('注入为约定') < 0 && src.indexOf('约定注入') < 0, tag + ' 旧「注入为约定」开关/单义文案清零')
    }
    assert(protoRole.indexOf("injectRole: 'reference'") >= 0, '原型 mock 含 reference 示例数据（n6 演示资料态）')
    assert(/injectRole: n\.injectRole === 'reference' \? 'reference' : 'convention'/.test(protoRole), '原型 _mockSlim 携带 injectRole（缺省 convention）')
    assert(/if \(a\.injectRole !== undefined\) n\.injectRole = a\.injectRole === 'reference'/.test(protoRole), '原型 mock notes-update 透传 injectRole')
  })
  await t('client 旧「注入为约定」单义文案清零（三态升级为 关闭/约定/资料）', () => {
    const pkgRole2 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
    for (const pair of [[clientSrc, 'client-impl.js'], [pkgRole2, '发布包 lib/client.js']]) {
      const src = pair[0], tag = pair[1]
      for (const dead of ['注入为约定', '约定 · 注入中', '作为约定注入到系统提示', 'toggleInject', '已记录并设为约定', '设为约定…']) {
        assert(src.indexOf(dead) < 0, tag + ' 不含旧文案/旧开关：' + dead)
      }
    }
    assert(clientSrc.indexOf('已记录并注入为上下文（') >= 0, '速记 toast 改「注入为上下文（约定/资料）」')
    assert(clientSrc.indexOf('注入为上下文…直接回车则仅记录') >= 0, '速记备注 placeholder 改「注入为上下文」')
  })
  await t('改名防竞态：正文加载中 doSave 省略 body（面板 + app.html + 发布包）', () => {
    const pkgCli = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
    const appHtml = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    for (const pair of [[clientSrc, 'client-impl.js'], [pkgCli, '发布包 lib/client.js']]) {
      const src = pair[0], tag = pair[1]
      assert(src.indexOf('edLoadingRef.current = true') >= 0, tag + ' 正文加载置在途标记')
      assert(/edLoadingRef\.current = false/.test(src), tag + ' notes-get 回填/异常后解除在途标记')
      // R-1 升级：负向「加载中」闸 → 正向「已加载」闸（get 失败永不放行 body 提交），合法清空附 confirmClearBody 显式确认
      assert(/if \(edBodyLoadedRef\.current\) \{ upd\.body = edBodyRef\.current/.test(src), tag + ' doSave 仅正文加载成功后携带 body（R-1 正向提交闸）')
      assert(/edBodyLoadedRef\.current = false/.test(src) && src.indexOf('upd.confirmClearBody = true') >= 0, tag + ' R-1 提交闸复位 + 空正文显式确认')
    }
    assert(appHtml.indexOf('edLoading = true') >= 0 && /if \(edBodyLoaded\) \{ upd\.body = edNote\.body/.test(appHtml), 'app.html 同款 R-1 正向提交闸')
    assert(appHtml.indexOf('upd.confirmClearBody = true') >= 0, 'app.html 空正文显式确认')
  })
  await t('client-impl 派发对话框（已有/新建会话）', () => {
    assert(/dsh-notes-dispatch-modal/.test(clientSrc), '派发对话框 modal')
    assert(/openDispatch/.test(clientSrc) && /doDispatchConfirm/.test(clientSrc), '打开对话框+确认派发')
    assert(/dispatchMode/.test(clientSrc) && clientSrc.indexOf('新建会话') >= 0 && clientSrc.indexOf('已有会话') >= 0, '两种派发模式')
    assert(/connectWorkspace/.test(clientSrc), '新建会话用 connectWorkspace')
    assert(/dsh-notes-dispatch-history/.test(clientSrc), '详情区派发历史展示')
    assert(/notes-workspaces/.test(clientSrc) && /notes-active-sessions/.test(clientSrc), '工作区+活跃会话下拉数据源')
  })
  await t('client-impl 派发历史可折叠（默认折叠，点标题行展开）', () => {
    assert(/const \[dispatchHistoryOpen, setDispatchHistoryOpen\] = React\.useState\(false\)/.test(clientSrc), '折叠态 dispatchHistoryOpen 存在且默认 false（折叠）')
    assert(clientSrc.indexOf("dispatchHistoryOpen ? ' open' : ' collapsed'") >= 0, 'open/collapsed 折叠态 class 分支存在')
    assert(/setDispatchHistoryOpen\(!dispatchHistoryOpen\)/.test(clientSrc), '标题行点击切换折叠态')
    assert(clientSrc.indexOf('dispatchHistoryOpen ? curDispatches.map') >= 0, '折叠时不渲染记录列表（不挤压正文）')
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    assert(/\.dsh-notes-dispatch-history-t\{[^}]*cursor:pointer/.test(css), '标题行 cursor:pointer 可点击')
    assert(/\.dsh-notes-dispatch-history\.collapsed/.test(css), 'collapsed 折叠态样式存在')
  })
  await t('styles.css 含 kind/status 视觉（v2 token 化）', () => {
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    assert(css.indexOf('.dsh-notes-kind-dot') >= 0, 'kind 色点 css')
    assert(css.indexOf('--nkind-decision') >= 0 && css.indexOf('--nkind-quote') >= 0, 'kind 颜色 token 声明')
    assert(css.indexOf('.dsh-notes-note-row.resolved') >= 0 && css.indexOf('.dsh-notes-note-row.superseded') >= 0, 'status 划线视觉')
  })
  await t('入口 v2：头部描边胶囊 + FAB 卡片式 tridots（无计数徽章，开发版/发布包/原型同步）', () => {
    const cssDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    const pkgClient = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
    for (const [css, tag] of [[cssDev, 'styles.css'], [cssPkg, '发布包 lib/styles.css']]) {
      // 头部按钮 = 原型 .hbtn 描边胶囊：inline-flex / gap 6px / padding 5px 11px / 1px var(--nbd) / radius 8px / 透明底
      assert(/\.dsh-notes-floating,\.dsh-notes-fab,\.dsh-notes-hdr-btn\{/.test(css), tag + ' token 作用域须含 .dsh-notes-hdr-btn（头部按钮在 DSH 文档流内，不在面板里）')
      const hdr = (css.match(/(?:^|\n)\.dsh-notes-hdr-btn\{([^}]*)\}/) || [])[1] || ''
      assert(/gap:6px/.test(hdr) && /padding:5px 11px/.test(hdr) && /border-radius:8px/.test(hdr) && /border:1px solid var\(--nbd\)/.test(hdr) && /background:transparent/.test(hdr) && /color:var\(--nt2\)/.test(hdr), tag + ' 头部按钮 v2 描边胶囊基态（实得：' + hdr + '）')
      assert(/\.dsh-notes-hdr-btn:hover\{[^}]*var\(--nbg-hover\)[^}]*var\(--ntx\)/.test(css), tag + ' 头部按钮 hover=nbg-hover 底 + ntx 字')
      assert(/\.dsh-notes-hdr-btn\.active\{[^}]*var\(--nbg-sel\)[^}]*border-color:transparent[^}]*var\(--nacc\)[^}]*font-weight:600/.test(css), tag + ' 头部按钮激活态=nbg-sel 底 + transparent 边 + nacc 字 + 600')
      // FAB = 原型 .fabg 卡片式：44px / radius 12px / npanel 底 / nbd-soft 描边 / 阴影
      const fab = (css.match(/(?:^|\n)\.dsh-notes-fab\{([^}]*)\}/) || [])[1] || ''
      assert(/width:44px/.test(fab) && /border-radius:12px/.test(fab) && /background:var\(--npanel\)/.test(fab) && /border:1px solid var\(--nbd-soft\)/.test(fab) && /box-shadow:var\(--nshadow-fab\)/.test(fab) && /color:var\(--ntx\)/.test(fab), tag + ' FAB v2 卡片式基态（实得：' + fab + '）')
      // FAB 阴影主题自适应：亮色轻阴影为默认，暗色经 body[data-ds-dark-theme] 覆盖加重（修复亮色阴影过重）
      assert(css.indexOf('--nshadow-fab:0 4px 14px rgba(0,0,0,.10),0 1px 4px rgba(0,0,0,.06)') >= 0, tag + ' FAB 亮色轻阴影 token 默认值')
      assert(/body\[data-ds-dark-theme\][^{]*\{[^}]*--nshadow-fab:0 10px 28px/.test(css), tag + ' FAB 暗色重阴影 data-ds-dark-theme 覆盖')
      assert(/\.dsh-notes-fab:hover\{[^}]*translateY\(-1px\)[^}]*var\(--nacc\)/.test(css), tag + ' FAB hover=上浮 1px + nacc 图标/描边')
      assert(/\.dsh-notes-fab-tridots\{[^}]*right:4px[^}]*bottom:4px[^}]*gap:2px[^}]*var\(--npanel\)[^}]*padding:1px 3px/.test(css), tag + ' FAB tridots 底托样式')
      assert(/\.dsh-notes-fab-tridots i\{[^}]*width:5px[^}]*height:5px[^}]*border-radius:50%/.test(css), tag + ' FAB tridots 5px 圆点')
      // 旧版残留清零（圆形 FAB / 旧灰色 token）
      assert(css.indexOf('--color-text-secondary') < 0 && css.indexOf('--color-surface-hover') < 0 && css.indexOf('--color-accent') < 0, tag + ' 旧头部按钮 token 已清')
    }
    for (const [src, tag] of [[clientSrc, 'client-impl.js'], [pkgClient, '发布包 lib/client.js']]) {
      assert(src.indexOf("I('note', 22)") >= 0, tag + ' FAB 中央 note 图标 22px')
      assert(src.indexOf("I('note', 13)") >= 0, tag + ' 头部按钮 note 图标 13px')
      assert(src.indexOf('dsh-notes-fab-tridots') >= 0, tag + ' FAB 渲染 tridots')
      assert(src.indexOf('var(--nkind-todo)') >= 0 && src.indexOf('var(--nkind-decision)') >= 0 && src.indexOf('var(--nkind-quote)') >= 0, tag + ' tridots 三枚 kind 色点')
      // 需求变更：两个入口均不要计数徽章
      assert(src.indexOf('dsh-notes-hdr-badge') < 0 && src.indexOf('dsh-notes-fab-badge') < 0, tag + ' 无计数徽章标记')
    }
    // 原型 Shell 入口小节已同步（实现与原型保持一致）
    const proto = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    assert(proto.indexOf('.shell-demo') >= 0 && proto.indexOf('.hbtn{') >= 0 && proto.indexOf('.hbtn.on') >= 0 && proto.indexOf('.fabg{') >= 0 && proto.indexOf('.fabg .tridots') >= 0, '原型含 Shell 入口小节 .hbtn/.fabg/.tridots')
  })
  }
}
