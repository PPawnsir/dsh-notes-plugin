// 节 113. mock/宿主契约对齐常驻闸（0.4.8，notes-048-mock-contract-audit：批次收尾卡）
// 背景：e2e 386+ 条用例与面板真机通道的可信度全压在 mock（scripts/e2e/server.cjs）诚实度上；历史漂移均为人肉撞见
//   （0.4.7-B settings-get 缺 organizeMaxChars、0.4.7-D2 suggest fixture 覆写口、本卡审计又钓出 17 处——见下方对账结论）。
// 本节 = 常驻闸，三道防线 + 豁免清单 + 边界文档锚：
//   A. 注册对等：两边源码提取 RPC 方法名集合对账（host 加了 mock 没有且未登记豁免 → 红；mock 私建宿主没有的方法 → 红）；
//   B. 键集对账（活体）：同一 fixture 喂真 handler（createHostMocks eval 加载 host 源）与 mock handleRpc，diff 响应键集
//      （envelope + 嵌套对象/数组条目键集；undefined 值经 JSON 往返归一 = wire 口径）；
//   C. 过滤语义对账（活体）：镜像数据集（普通/约定/log/sys/置顶/夹内/子夹/已删）跑 notes-list/notes-search 矩阵，
//      两侧标题集必须全等（sys 缺省降噪 / deleted / kind / tag / folder 递归子树 / 组合过滤口径）。
//   外加：豁免清单完整性守卫（防「为绿而复刻 host」——允许简化的点必须显式登记且非陈旧）+ 边界文档锚。
//
// == 契约边界（与 DEVELOPMENT.md「e2e mock 与宿主契约边界」节同文，改一边必须同步另一边）==
// 必须一致（本节闸守）：envelope/嵌套条目键集；过滤语义（deleted/sys 缺省降噪/kind/tag/folder 子树/三态组合）；
//   错误形态（{error:string} 键 + needCascade 等结构化错误键）；写入校验闸存在性（空名/缺参/未知 op/R-1 空正文/文件夹挂载校验）。
// 允许简化（EXEMPT 登记）：数据内容（计数/时间戳/正文/id 取值/排序细节）；错误文案措辞；LLM 产出；
//   宿主服务透传键（permissionPresets/会话标题后台补齐三键）；性能/缓存/落盘机制；schedule 声明写闸；settings-set 白名单校验。
//
// == 0.4.8 审计漂移清单（17 处全部修复，mock 向宿主对齐，宿主零改动）==
//   slim 键集（多 pinned/dispatchStatus 两漂移键 + 缺 workspace/cwd/logDate/entities/summarizedAt/origin/mergedFrom/archivedAt 八键 + schedule 缺省形态）；
//   notes-get（note 缺 slim 全键集）；notes-get-batch（缺 missing 键）；notes-create/update（响应形状整体漂移：{id,note}/{ok,note} →
//   {id,topic,title,kind,status}/{id,kind,status,dispatchClosed}，补 log 隐身硬闸/injectEver 粘性/R-1 空正文闸/folder 归一/resolved 联动）；
//   notes-search（sys 缺省降噪缺失 + kind/tag/folder/三态过滤缺失 + matches 缺 tags 档）；notes-delete/restore/purge（ok 键漂移 → {id}/{id,purged,mode,historyPurged}）；
//   notes-folders（list 条目缺 depth/hidden/sys + create 缺 ok/校验 + rename 缺 id/name + delete 缺 needCascade 级联闸且误为移出（实为软删）+
//   reorder parents 误读为数组（实为映射）+ 未知 op 缺错误）；notes-settings-get（modelsDir 漂移键 → models/lastInjectChars）；
//   notes-settings-set（缺 settings 回显）；notes-usage-get（桶缺三功能键 + byFeature 缺三窗 + 缺 exactTokens）；
//   notes-sessions 条目（缺 cwd）；notes-workspaces/dispatch-done（缺省 {ok:true} 升格真实形状）；notes-dispatch（缺 queued）；
//   notes-export（ok 漂移 + 缺 foldersFile/telemetry/assets）；notes-memory-guide（{guide:''} 残形 → op 分型全形状）；
//   notes-mount/mount-list（缺 id/indexNoteId/whenToUse + 行 raw + 校验闸）；notes-ping（{ok} → dist 形状 {ok,pong,echo}）。
module.exports = {
  id: "113",
  title: "113. mock/宿主契约对齐常驻闸（0.4.8，notes-048-mock-contract-audit：注册对等 + 键集对账 + 豁免清单 + 过滤语义矩阵）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR } = H
  section('113. mock/宿主契约对齐常驻闸（0.4.8，notes-048-mock-contract-audit）')

  // ===== 注册面提取（源码正则；host 双侧 = dev 拼接源 + dist 产物，mock = e2e server.cjs case 面）=====
  const mockPath = path.join(DIR, 'scripts', 'e2e', 'server.cjs')
  const mockSrc = fsNative.readFileSync(mockPath, 'utf8')
  const extractHost = (src) => { const out = new Set(); const re = /disposers\.push\(handle\('((?:notes-)[a-z0-9-]+)'/g; let m; while ((m = re.exec(src))) out.add(m[1]); return [...out].sort() }
  const extractMock = (src) => { const out = new Set(); const re = /case '((?:notes-)[a-z0-9-]+)':/g; let m; while ((m = re.exec(src))) out.add(m[1]); return [...out].sort() }
  const devMethods = extractHost(H.hostSrc)
  const distMethods = extractHost(H.indexSrc)
  const mockMethods = extractMock(mockSrc)
  const hostUnion = [...new Set(devMethods.concat(distMethods))].sort()

  // ===== 豁免清单①：注册豁免（host 有、mock 无 case——缺省 {ok:true} 直通，逐条登记理由；host 新增 RPC 须实现或登记于此）=====
  const EXEMPT_REGISTRATION = [
    ['notes-css', '样式下发：面板 harness 特判真样式（panel-harness.cjs 拦截）；app.html 自含样式不调用'],
    ['notes-src', 'bootstrap 源码下发面（client/host 拼接源），e2e 无消费'],
    ['notes-quick', '速记合并窗口 + 异步 LLM 分类管线（e2e 无速记链路；host 返回 {id,topic,title,kind,merged,sid,cwd,sensitiveSuggested}）'],
    ['notes-quick-instruct', 'T3 指令式速记 LLM 提取管线（同上豁免）'],
    ['notes-history-get', '历史版本正文预览（mock 仅 versions 列表桩）'],
    ['notes-restore-history', '历史版本恢复（含恢复前置快照语义，mock 不模拟）'],
    ['notes-when-suggest', 'LLM whenToUse 草稿（挂载弹层预填数据源；失败静默回退标题，e2e 断言语义外）'],
    ['notes-conventions', '注入渲染聚合面（{text,conventions,directory}），mock 不模拟渲染管线'],
    ['notes-archive', '归档合并执行（事务/undo 落盘面）'],
    ['notes-archive-preview', '归档预览 dry-run 面'],
    ['notes-archive-undo', '归档撤销事务面（undo 事务文件通道）'],
    ['notes-graph', '图查询（双链关系统计面）'],
    ['notes-ledger-refresh', '效用账本 cron 刷新面'],
    ['notes-schedule-eval', '定时调度评估机（cron 到点评估通道）'],
    ['notes-import-preview', '导入预览（目录扫描分类面）'],
    ['notes-import', '导入执行（备份 + 合并落盘面）'],
    ['notes-asset-upload', '图片资产上传落盘面'],
    ['notes-assets-prune', '孤儿资产清理面（dryRun/执行双形态）'],
    ['notes-perf', '遥测吞掉语义：缺省 {ok:true} 与 host {ok:true} 同形（键集由活体对账覆盖）'],
  ]
  // ===== 豁免清单②：形状豁免（键集对账中允许的单侧键，逐条登记理由；防「为绿而复刻 host」）=====
  const EXEMPT_SHAPE = {
    'notes-settings-get': { hostOnly: ['permissionPresets'], mockOnly: [], reason: '宿主 permissionPresets 服务透传键（0.4.7 派发弹窗权限下拉预填数据源）；mock 不模拟该宿主服务——服务缺席时 host 同样省略本键，client 缺键有降级预填' },
    'notes-sessions': { hostOnly: ['titlesPending', 'pendingIds', 'pendingSessions'], mockOnly: [], reason: '非 live 会话标题后台补齐机制（0.1.7 首屏不阻塞三键）；mock 恒即时标题、无补题管线' },
    'notes-active-sessions': { hostOnly: ['titlesPending', 'pendingIds', 'pendingSessions'], mockOnly: [], reason: '同 notes-sessions（同一 _activeSessions 通道）' },
  }

  // ===== 对账纯函数（闸逻辑本体；行为级自证见下）=====
  function parityDiff(hostSet, mockSet, exemptSet) {
    return {
      hostMissing: hostSet.filter(m => mockSet.indexOf(m) < 0 && exemptSet.indexOf(m) < 0),
      mockOnly: mockSet.filter(m => hostSet.indexOf(m) < 0),   // 豁免不遮 mock 私建——私建宿主没有的方法恒红
    }
  }
  // 响应键集提取：envelope（<root>）+ 嵌套对象键集 + 数组条目键集并集（JSON 往返归一 = wire 口径，undefined 键自然消隐）
  function shapePaths(v, prefix, out) {
    out = out || {}
    if (Array.isArray(v)) {
      const ks = {}
      v.forEach(it => { if (it && typeof it === 'object' && !Array.isArray(it)) Object.keys(it).forEach(k => { ks[k] = 1 }) })
      if (Object.keys(ks).length) out[prefix + '[]'] = Object.keys(ks).sort()
      return out
    }
    if (v && typeof v === 'object') {
      out[prefix || '<root>'] = Object.keys(v).sort()
      Object.keys(v).forEach(k => { const c = v[k]; if (c && typeof c === 'object') shapePaths(c, (prefix ? prefix + '.' : '') + k, out) })
    }
    return out
  }
  // 键集 diff：单侧缺席路径（空数组/条件子树）= 数据内容面不比；共有路径逐键 diff，落在形状豁免内的不报
  function diffShapes(hr, mr, alw) {
    const hp = shapePaths(hr), mp = shapePaths(mr)
    const paths = {}; Object.keys(hp).forEach(k => { paths[k] = 1 }); Object.keys(mp).forEach(k => { paths[k] = 1 })
    const problems = []
    for (const p of Object.keys(paths)) {
      const hk = hp[p], mk = mp[p]
      if (!hk || !mk) continue
      const alwH = (alw && alw.hostOnly) || [], alwM = (alw && alw.mockOnly) || []
      const badH = hk.filter(k => mk.indexOf(k) < 0 && alwH.indexOf(k) < 0)
      const badM = mk.filter(k => hk.indexOf(k) < 0 && alwM.indexOf(k) < 0)
      if (badH.length || badM.length) problems.push(p + '：host 独有 ' + JSON.stringify(badH) + ' / mock 独有 ' + JSON.stringify(badM))
    }
    return problems
  }

  await t('0.4.8 契约注册对等：host(dev∪dist)⇄mock 方法集零漂移（host 新增未登记 / mock 私建即红）', () => {
    assert(devMethods.length >= 40 && distMethods.length >= 40 && mockMethods.length >= 20, '三面提取非空（防正则失效空集假绿）：dev=' + devMethods.length + ' dist=' + distMethods.length + ' mock=' + mockMethods.length)
    for (const s of ['notes-list', 'notes-get', 'notes-create', 'notes-update', 'notes-search', 'notes-folders', 'notes-settings-get']) {
      assert(devMethods.indexOf(s) >= 0 && distMethods.indexOf(s) >= 0, '哨兵方法在册（host 双侧）：' + s)
      assert(mockMethods.indexOf(s) >= 0, '哨兵方法在册（mock）：' + s)
    }
    assert(distMethods.indexOf('notes-ping') >= 0 && devMethods.indexOf('notes-ping') < 0, 'notes-ping = dist 独有登记口径不变（若 dev 补齐请更新本断言与豁免表）')
    const exemptSet = EXEMPT_REGISTRATION.map(e => e[0])
    const d = parityDiff(hostUnion, mockMethods, exemptSet)
    assert(d.hostMissing.length === 0, 'host 有 mock 未实现且未登记豁免（须在 server.cjs 实现或在节 113 豁免清单登记）：' + JSON.stringify(d.hostMissing))
    assert(d.mockOnly.length === 0, 'mock 私建宿主没有的方法（红线——mock 不得虚构契约面）：' + JSON.stringify(d.mockOnly))
  })

  await t('0.4.8 契约注册闸行为级：人为注入假方法（host 侧/mock 侧）对账函数必报红', () => {
    const exemptSet = EXEMPT_REGISTRATION.map(e => e[0])
    const d1 = parityDiff(hostUnion.concat(['notes-fake-host-z9']), mockMethods, exemptSet)
    assert(d1.hostMissing.indexOf('notes-fake-host-z9') >= 0, 'host 侧加假方法 → hostMissing 必捕获')
    const d2 = parityDiff(hostUnion, mockMethods.concat(['notes-fake-mock-z9']), exemptSet)
    assert(d2.mockOnly.indexOf('notes-fake-mock-z9') >= 0, 'mock 侧加假方法 → mockOnly 必捕获')
    const d3 = parityDiff(hostUnion, mockMethods.concat(['notes-fake-mock-z9']), exemptSet.concat(['notes-fake-mock-z9']))
    assert(d3.mockOnly.indexOf('notes-fake-mock-z9') >= 0, '豁免清单不得遮盖 mock 私建（mockOnly 不吃豁免）')
    const d0 = parityDiff(hostUnion, mockMethods, exemptSet)
    assert(d0.hostMissing.length === 0 && d0.mockOnly.length === 0, '现状零漂移（与注册对等断言互证）')
  })

  await t('0.4.8 契约豁免清单完整性：注册/形状豁免逐条有效非陈旧 + 理由非空', () => {
    for (const [m, reason] of EXEMPT_REGISTRATION) {
      assert(/^notes-[a-z0-9-]+$/.test(m), '豁免方法名形态：' + m)
      assert(hostUnion.indexOf(m) >= 0, '注册豁免指向真实 host 方法（陈旧豁免？host 已删 ' + m + '）')
      assert(mockMethods.indexOf(m) < 0, '注册豁免非陈旧：mock 已实现 ' + m + '（摘除豁免条目，转入键集对账）')
      assert(typeof reason === 'string' && reason.length >= 8, '豁免理由非空：' + m)
    }
    for (const m of Object.keys(EXEMPT_SHAPE)) {
      const alw = EXEMPT_SHAPE[m]
      assert(mockMethods.indexOf(m) >= 0, '形状豁免指向 mock 已实现方法：' + m)
      assert(hostUnion.indexOf(m) >= 0, '形状豁免指向真实 host 方法：' + m)
      assert(Array.isArray(alw.hostOnly) && Array.isArray(alw.mockOnly) && (alw.hostOnly.length + alw.mockOnly.length) > 0, '形状豁免键清单非空：' + m)
      assert(typeof alw.reason === 'string' && alw.reason.length >= 8, '形状豁免理由非空：' + m)
    }
  })

  // ===== 活体对账：fresh host（createHostMocks eval 加载 host 源）⇄ fresh mock（无种子口径——种子是 e2e 伺服面，非契约探针面）=====
  // S 快照/恢复：本节借用 createHostMocks 取独立 host 实例（fresh store 确定性 fixture），跑完整体恢复 S 引用零残留
  const mock = require(mockPath)
  const wire = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v))
  const sBackup = {}
  Object.keys(S).forEach(k => { sBackup[k] = S[k]; delete S[k] })
  try {
    H.createHostMocks()
    const host = S.handlers
    const ms = mock.createMockState()
    ms.notes.length = 0; ms.folders.length = 0   // 无种子口径：镜像数据集全由写通道造数（种子笔记属 e2e 伺服面，不进对账）
    const hcall = async (m, a) => wire(await host[m](a))
    const mcall = (m, a) => wire(mock.handleRpc(ms, m, a))
    // host 启动 ensure 会自建注入索引根笔记（kind=sys，节 79 创建级锁口径）——mock 侧造同款使矩阵镜像对称
    mcall('notes-create', { title: '注入索引（自动）', body: '', kind: 'sys' })
    const problems = []
    const probe = async (label, method, ha, ma) => {
      const hr = await hcall(method, ha), mr = mcall(method, ma === undefined ? ha : ma)
      const ps = diffShapes(hr, mr, EXEMPT_SHAPE[method])
      for (const p of ps) problems.push(method + '（' + label + '）' + p)
      return { h: hr, m: mr }
    }
    const errProblems = []
    const errProbe = async (label, method, ha, ma) => {
      const hr = await hcall(method, ha), mr = mcall(method, ma === undefined ? ha : ma)
      const hk = Object.keys(hr).sort(), mk = Object.keys(mr).sort()
      if (JSON.stringify(hk) !== JSON.stringify(mk)) errProblems.push(method + '（' + label + '）：host 键 ' + JSON.stringify(hk) + ' ⇄ mock 键 ' + JSON.stringify(mk))
      if (hk.indexOf('error') < 0 || mk.indexOf('error') < 0) errProblems.push(method + '（' + label + '）：错误路径两侧均须 {error} 形态（host=' + JSON.stringify(hk) + ' mock=' + JSON.stringify(mk) + '）')
      return { h: hr, m: mr }
    }

    // ---- 造数（两侧各自走写通道，逻辑操作一致；id 各自捕获）----
    const f1 = await probe('folders.create 根夹', 'notes-folders', { op: 'create', name: '闸父夹' })
    const f2 = await probe('folders.create 子夹（parent 校验）', 'notes-folders', { op: 'create', name: '闸子夹', parent: f1.h.folder.id }, { op: 'create', name: '闸子夹', parent: f1.m.folder.id })
    const N1 = await probe('create 普通（夹内+tag+topic）', 'notes-create', { title: '闸笔记甲', body: '正文甲 关键字Q', tags: ['t1'], topic: '闸类', folder: f1.h.folder.id }, { title: '闸笔记甲', body: '正文甲 关键字Q', tags: ['t1'], topic: '闸类', folder: f1.m.folder.id })
    const N2 = { h: (await hcall('notes-create', { title: '闸约定乙', body: '约定正文乙', inject: true, topic: '闸类' })), m: mcall('notes-create', { title: '闸约定乙', body: '约定正文乙', inject: true, topic: '闸类' }) }
    const N3 = await probe('create log 隐身硬闸（injectForcedOff 条件键）', 'notes-create', { title: '闸日志丙', body: '日志正文丙', kind: 'log', inject: true })
    const N4 = { h: (await hcall('notes-create', { title: '闸sys丁', body: 'sys 正文 关键字Q', kind: 'sys' })), m: mcall('notes-create', { title: '闸sys丁', body: 'sys 正文 关键字Q', kind: 'sys' }) }
    const N5 = { h: (await hcall('notes-create', { title: '闸子夹笔记', body: '子夹正文', folder: f2.h.folder.id })), m: mcall('notes-create', { title: '闸子夹笔记', body: '子夹正文', folder: f2.m.folder.id }) }
    const N6 = { h: (await hcall('notes-create', { title: '闸置顶己', body: '置顶正文', status: 'pinned' })), m: mcall('notes-create', { title: '闸置顶己', body: '置顶正文', status: 'pinned' }) }
    // settings 探针前置：host 挂载动作会落 settings.indexNoteId（索引持久化），须在 mount 前对账
    await probe('settings-set（settings 回显）', 'notes-settings-set', { organizeMaxChars: 8888 })
    await probe('settings-get（permissionPresets 豁免）', 'notes-settings-get', {})

    // ---- C. 过滤语义矩阵（镜像数据集，标题集全等断言）----
    const titles = (r) => (r.notes || []).map(n => n.title).sort()
    const matrix = [
      ['list 缺省（sys 降噪 + 未删）', 'notes-list', {}, {}],
      ['list kind=sys（显式入口放行）', 'notes-list', { kind: 'sys' }, { kind: 'sys' }],
      ['list kind=log（日志同权）', 'notes-list', { kind: 'log' }, { kind: 'log' }],
      ['list tag 过滤', 'notes-list', { tag: 't1' }, { tag: 't1' }],
      ['list folder=未分类（sys 不计入）', 'notes-list', { folder: '' }, { folder: '' }],
      ['list folder=父夹（递归子树含子夹笔记）', 'notes-list', { folder: f1.h.folder.id }, { folder: f1.m.folder.id }],
      ['list includeDeleted（回收站口径）', 'notes-list', { includeDeleted: true }, { includeDeleted: true }],
      ['search 缺省（sys 降噪）', 'notes-search', { query: '关键字Q' }, { query: '关键字Q' }],
      ['search kind=sys 显式命中', 'notes-search', { query: '关键字Q', kind: 'sys' }, { query: '关键字Q', kind: 'sys' }],
      ['search 组合过滤 sensitive:false', 'notes-search', { query: '闸', sensitive: false }, { query: '闸', sensitive: false }],
      ['search kind=todo 空集', 'notes-search', { query: '闸', kind: 'todo' }, { query: '闸', kind: 'todo' }],
      ['search folder 子树口径', 'notes-search', { query: '正文', folder: f1.h.folder.id }, { query: '正文', folder: f1.m.folder.id }],
    ]
    const matrixBad = []
    for (const [label, method, ha, ma] of matrix) {
      const hr = await hcall(method, ha), mr = mcall(method, ma)
      const ht = titles(hr), mt = titles(mr)
      if (JSON.stringify(ht) !== JSON.stringify(mt)) matrixBad.push(label + '：host=' + JSON.stringify(ht) + ' ⇄ mock=' + JSON.stringify(mt))
    }

    // ---- B. 键集对账探针面（成功路径）----
    await probe('list envelope+slim 条目', 'notes-list', {})
    await probe('get（slim 全键集+body）', 'notes-get', { id: N1.h.id }, { id: N1.m.id })
    await probe('update 常规', 'notes-update', { id: N1.h.id, title: '闸笔记甲改' }, { id: N1.m.id, title: '闸笔记甲改' })
    await probe('update log 隐身硬闸', 'notes-update', { id: N3.h.id, inject: true }, { id: N3.m.id, inject: true })
    await probe('delete', 'notes-delete', { id: N6.h.id }, { id: N6.m.id })
    await probe('get-batch（missing 口径：已删+不存在）', 'notes-get-batch', { ids: [N1.h.id, 'ghost-x', N6.h.id] }, { ids: [N1.m.id, 'ghost-x', N6.m.id] })
    await probe('restore', 'notes-restore', { id: N6.h.id }, { id: N6.m.id })
    await hcall('notes-delete', { id: N6.h.id }); mcall('notes-delete', { id: N6.m.id })
    await probe('purge', 'notes-purge', { id: N6.h.id }, { id: N6.m.id })
    await probe('folders.list（条目 depth/hidden/sys 恒带）', 'notes-folders', {})
    await probe('folders.rename', 'notes-folders', { op: 'rename', id: f2.h.folder.id, name: '闸子夹改' }, { op: 'rename', id: f2.m.folder.id, name: '闸子夹改' })
    await probe('folders.set-flags', 'notes-folders', { op: 'set-flags', id: f2.h.folder.id, hidden: true }, { op: 'set-flags', id: f2.m.folder.id, hidden: true })
    const ncH = await hcall('notes-folders', { op: 'delete', id: f2.h.folder.id })
    const ncM = mcall('notes-folders', { op: 'delete', id: f2.m.folder.id })
    {
      const hk = Object.keys(ncH).sort(), mk = Object.keys(ncM).sort()
      if (JSON.stringify(hk) !== JSON.stringify(mk)) errProblems.push('notes-folders（needCascade 拒绝）：host 键 ' + JSON.stringify(hk) + ' ⇄ mock 键 ' + JSON.stringify(mk))
      if (ncH.needCascade !== true || ncM.needCascade !== true) errProblems.push('notes-folders（needCascade 拒绝）：两侧均须 needCascade:true 结构化键')
    }
    await probe('folders.delete cascade 级联（子树笔记软删）', 'notes-folders', { op: 'delete', id: f2.h.folder.id, cascade: true }, { op: 'delete', id: f2.m.folder.id, cascade: true })
    await probe('folders.reorder', 'notes-folders', { op: 'reorder', ids: [f1.h.folder.id] }, { op: 'reorder', ids: [f1.m.folder.id] })
    await probe('search（slim+matches）', 'notes-search', { query: '关键字Q' })
    await probe('history（versions 列表）', 'notes-history', { id: N1.h.id }, { id: N1.m.id })
    await probe('ai-organize', 'notes-ai-organize', { body: '整理这段正文 关键字Q', kind: 'note' })
    await probe('memory-guide status', 'notes-memory-guide', { op: 'status' })
    await probe('suggest 六段 envelope', 'notes-suggest', {})
    await probe('mount（挂载⇔资料不变量）', 'notes-mount', { id: N2.h.id, whenToUse: '查我' }, { id: N2.m.id, whenToUse: '查我' })
    await probe('mount-list（lines 条目 id/when/raw）', 'notes-mount-list', {})
    await probe('conflict-check 空态', 'notes-conflict-check', {})
    await probe('dispatch（queued 键 + rec 嵌套）', 'notes-dispatch', { id: N1.h.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话', workspace: 'deepseek-work' }, { id: N1.m.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话', workspace: 'deepseek-work' })
    await probe('dispatch-done', 'notes-dispatch-done', { id: N1.h.id, dispatchIndex: 0 }, { id: N1.m.id, dispatchIndex: 0 })
    await probe('recall-stats envelope', 'notes-recall-stats', {})
    await probe('usage-get（桶/byFeature 嵌套键集）', 'notes-usage-get', {})
    await probe('active-sessions（补题三键豁免）', 'notes-active-sessions', {})
    await probe('sessions（补题三键豁免）', 'notes-sessions', {})
    await probe('workspaces', 'notes-workspaces', {})
    await probe('export（foldersFile/telemetry/assets）', 'notes-export', { dir: 'D:/x' })
    await probe('perf（缺省直通同形）', 'notes-perf', {})

    // ---- 错误形态面（{error} 键集两侧一致；文案措辞豁免——边界文档登记）----
    await errProbe('get 不存在', 'notes-get', { id: 'ghost-x' })
    await errProbe('update 不存在', 'notes-update', { id: 'ghost-x', title: 'x' })
    await errProbe('update R-1 空正文覆盖闸', 'notes-update', { id: N1.h.id, body: '' }, { id: N1.m.id, body: '' })
    await errProbe('folders 未知 op', 'notes-folders', { op: 'bogus' })
    await errProbe('folders.create 空名', 'notes-folders', { op: 'create', name: '  ' })
    await errProbe('folders.reorder 缺 ids', 'notes-folders', { op: 'reorder' })
    await errProbe('mount 缺 id', 'notes-mount', {})
    await errProbe('mount kind=log 拒绝', 'notes-mount', { id: N3.h.id }, { id: N3.m.id })
    await errProbe('dispatch 笔记不存在', 'notes-dispatch', { id: 'ghost-x', sessionId: 's' })
    await errProbe('ai-organize 空正文', 'notes-ai-organize', { body: '  ' })
    await errProbe('export 缺 dir', 'notes-export', {})
    await errProbe('create folder 未知归一拒绝', 'notes-create', { title: 'x', folder: 'ghost-folder-z9' })

    await t('0.4.8 契约过滤语义对账（活体）：镜像数据集 list/search 矩阵两侧结果集全等（' + matrix.length + ' 组）', () => {
      assert(matrixBad.length === 0, '过滤语义漂移：\n      ' + matrixBad.join('\n      '))
    })

    await t('0.4.8 契约键集对账（活体成功面）：同 fixture 真 handler⇄mock 全方法响应键集零未登记漂移', () => {
      assert(problems.length === 0, '键集漂移（登记豁免或修 mock）：\n      ' + problems.join('\n      '))
    })

    await t('0.4.8 契约错误形态对账（活体）：不存在/未知 op/校验闸/级联拒绝 {error} 键两侧一致', () => {
      assert(errProblems.length === 0, '错误形态漂移：\n      ' + errProblems.join('\n      '))
    })
  } finally {
    Object.keys(S).forEach(k => { delete S[k] })
    Object.keys(sBackup).forEach(k => { S[k] = sBackup[k] })
  }

  await t('0.4.8 契约 dist 独有 notes-ping：mock 形状 {ok,pong,echo} 静态锚（活体基准为 dev host，dist 独有方法静态锁定）', () => {
    const ms2 = mock.createMockState()
    const r = JSON.parse(JSON.stringify(mock.handleRpc(ms2, 'notes-ping', { probe: 1 })))
    assert(JSON.stringify(Object.keys(r).sort()) === JSON.stringify(['echo', 'ok', 'pong']), 'mock notes-ping 键集 = {ok,pong,echo}（dist server.dist.js 同形）')
    assert(r.ok === true && typeof r.pong === 'number' && r.echo && r.echo.probe === 1, 'mock notes-ping 值形态')
    assert(H.indexSrc.indexOf("handle('notes-ping'") >= 0, 'dist notes-ping 注册锚')
    assert(H.indexSrc.indexOf('ok: true, pong: Date.now(), echo:') >= 0, 'dist notes-ping {ok,pong,echo} 形状锚（dist 删改本方法须同步 mock）')
  })

  await t('0.4.8 契约边界文档锚：mock 头注边界块 + DEVELOPMENT.md 契约边界节在册', () => {
    assert(mockSrc.indexOf('契约边界（0.4.8') >= 0 && mockSrc.indexOf('113-mock-contract.cjs') >= 0, 'server.cjs 头注契约边界块 + 节 113 指引锚')
    const dev = fsNative.readFileSync(path.join(DIR, 'DEVELOPMENT.md'), 'utf8')
    assert(dev.indexOf('mock 与宿主契约边界') >= 0, 'DEVELOPMENT.md「e2e mock 与宿主契约边界」节在册')
    assert(dev.indexOf('必须一致') >= 0 && dev.indexOf('允许简化') >= 0, '边界文档双清单（必须一致 vs 允许简化）锚')
  })

  await t('0.5.0 R3 模型代理退役：host 零 /dsh-notes-model 路由（server.dist.js/index.mjs 零残留）⇄ e2e mock GET 通道拆除（113 闸扩展——非 RPC 通道走结构锚）', () => {
    assert(H.indexSrc.indexOf('MODEL_PROXY_ROUTE') < 0 && H.indexSrc.indexOf('MODEL_PROXY_MIRRORS') < 0, 'host 侧零 MODEL_PROXY_ROUTE/MODEL_PROXY_MIRRORS 残留（代理路由退役）')
    assert(H.indexSrc.indexOf('/dsh-notes-model') < 0, 'index.mjs 零 /dsh-notes-model 残留')
    assert(mockSrc.indexOf("'/dsh-notes-model/'") < 0 && mockSrc.indexOf('_modelProxyStatus') < 0, 'e2e mock GET /dsh-notes-model/ 通道已拆（含 _modelProxyStatus 失败桩）')
  })
  }
}
