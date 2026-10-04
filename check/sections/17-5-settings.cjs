// 节 17.5 设置持久化 + LLM 模型选配（settings RPC + 设置卡片）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "17.5",
  title: "17.5 设置持久化 + LLM 模型选配（settings RPC + 设置卡片）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_ROOT_STATIC, llmMock, plugin, qi, rpc2, store, store2 } = S
  // ===== 17.5 设置持久化 + LLM 模型选配（notes-settings-get/set + 设置卡片）=====
  section('17.5 设置持久化 + LLM 模型选配（settings RPC + 设置卡片）')
  // 发布包 client 源码独立读取（本节在 section 18 之前，clientPkgSrc 尚未定义）
  const clientPkgSrcSettings = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
  // --- 源码结构断言 ---
  await t('设置入口存在（v2 侧栏底部 fbtn：gear 图标 + tooltip 设置）', () => {
    assert(/dsh-notes-fbtn dsh-nt', onClick: openSettings/.test(clientSrc), 'client-impl 侧栏底部含设置按钮（dsh-notes-fbtn + onClick=openSettings）')
    assert(clientSrc.indexOf("'data-tooltip': t('common.settings')") >= 0, '设置按钮 tooltip=设置（i18n 覆盖卡A 起走 t() 字典）')
    assert(clientSrc.indexOf("I('gear', 12)") >= 0, '设置按钮 gear SVG 图标')
    assert(clientSrc.indexOf('⚙') < 0, '⚙ emoji 已移除（SVG 化）')
  })
  await t('设置卡片 class 存在（client-impl + 发布包 + styles.css 三处同步）', () => {
    for (const cls of ['dsh-notes-settings-mask', 'dsh-notes-settings-modal', 'dsh-notes-settings-modal-t', 'dsh-notes-settings-list', 'dsh-notes-settings-row', 'dsh-notes-settings-label', 'dsh-notes-settings-control']) {
      assert(clientSrc.indexOf(cls) >= 0, 'client-impl 缺 ' + cls)
      assert(clientPkgSrcSettings.indexOf(cls) >= 0, '发布包 client.js 缺 ' + cls + '（需先跑 scripts/build-dist.cjs）')
    }
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    for (const cls of ['.dsh-notes-settings-mask{', '.dsh-notes-settings-modal{', '.dsh-notes-settings-row{', '.dsh-notes-settings-select', '.dsh-notes-settings-input', '.dsh-notes-settings-clear']) {
      assert(css.indexOf(cls) >= 0, 'styles.css 缺 ' + cls)
    }
  })
  await t('设置卡片通用结构（settingsRows 数组 map 渲染：加设置项 = 加行）', () => {
    assert(/const settingsRows = \[/.test(clientSrc), 'settingsRows 行数组存在')
    assert(/settingsRows\.map\(row =>/.test(clientSrc), 'settingsRows.map 渲染设置项行')
    assert(clientSrc.indexOf('LLM 模型') >= 0, '第一项为「LLM 模型」')
    assert(clientSrc.indexOf('跟随当前会话（默认）') >= 0, '含「跟随当前会话（默认）」选项/清除钮')
    assert(/function openSettings\(\)/.test(clientSrc) && /function saveSettingsLlm\(/.test(clientSrc), 'openSettings / saveSettingsLlm 函数存在')
  })
  await t('设置卡片承接底部收敛：「数据」区补回收站兜底 + 新增「整理建议」行（openTrash/openSuggest 仍可达）', () => {
    // dataControl 追加「回收站」按钮（openTrash，与底部同款；覆盖卡 C 起文案走 tt() 字典）
    assert(clientSrc.indexOf("onClick: openTrash }, tt('topbar.trash')") >= 0, 'client-impl 数据区含「回收站」按钮（openTrash）')
    // settingsRows 新增「整理建议」行（openSuggest；覆盖卡 C 起 label/sub 走 tt() 字典，文案本体在 zh.js）
    assert(/key: 'suggest', label: tt\('settings\.suggest'\)/.test(clientSrc), 'client-impl settingsRows 含「整理建议」行')
    assert(clientSrc.indexOf("'settings.suggestTipClient': '速记组归档 / 过期未引用清理 / 孤儿笔记候选（只提名不自动执行）'") >= 0, '整理建议行 sub 文案（字典 settings.suggestTipClient）')
    assert(/const suggestControl = e\('button', \{[^}]*onClick: openSuggest[^}]*\}, tt\('settings\.openBtn'\)\)/.test(clientSrc), '整理建议行控件 = 打开按钮 → openSuggest')
    // 发布包 client.js 同步（build-dist 产物）
    assert(clientPkgSrcSettings.indexOf("onClick: openTrash }, tt('topbar.trash')") >= 0, '发布包数据区含「回收站」按钮（需先跑 scripts/build-dist.cjs）')
    assert(/key: 'suggest', label: tt\('settings\.suggest'\)/.test(clientPkgSrcSettings), '发布包 settingsRows 含「整理建议」行（需先跑 scripts/build-dist.cjs）')
  })
  await t('client 经 RPC 读写设置（notes-settings-get / notes-settings-set）', () => {
    assert(clientSrc.indexOf('notes-settings-get') >= 0 && clientSrc.indexOf('notes-settings-set') >= 0, 'client-impl 含两个设置 RPC 调用')
    assert(clientPkgSrcSettings.indexOf('notes-settings-get') >= 0 && clientPkgSrcSettings.indexOf('notes-settings-set') >= 0, '发布包 client.js 含两个设置 RPC 调用')
  })
  await t('index.mjs 注册 settings RPC + settings.json 持久化函数', () => {
    assert(indexSrc.indexOf("handle('notes-settings-get'") >= 0, 'notes-settings-get 已注册')
    assert(indexSrc.indexOf("handle('notes-settings-set'") >= 0, 'notes-settings-set 已注册')
    assert(/SETTINGS_PATH\s*=\s*path\.join\(NOTES_ROOT,\s*'settings\.json'\)/.test(indexSrc), 'SETTINGS_PATH 落在 NOTES_ROOT/settings.json')
    assert(indexSrc.indexOf('function loadSettings()') >= 0 && indexSrc.indexOf('function saveSettings()') >= 0, 'loadSettings/saveSettings 存在（内存缓存 + 启动加载）')
    assert(indexSrc.indexOf('function listAvailableModels()') >= 0, 'listAvailableModels（llm 服务模型目录探针）存在')
  })
  await t('classifyTopic/extractInstruction 优先读设置模型（源码结构）', () => {
    assert(indexSrc.indexOf('function resolveLlmSelection()') >= 0, 'resolveLlmSelection 存在')
    const rm = indexSrc.match(/function resolveLlmSelection\(\) \{[\s\S]*?\n    \}/)
    assert(rm, 'resolveLlmSelection 函数体可提取')
    const iSet = rm[0].indexOf('settingsCache.llm')
    const iAdm = rm[0].indexOf('adm.currentSelection()')
    assert(iSet >= 0 && iAdm >= 0 && iSet < iAdm, 'settings.llm 优先判定，adm.currentSelection 兜底回退')
    const cm = indexSrc.match(/async function classifyTopic\(text\) \{[\s\S]*?\n    \}/)
    assert(cm && cm[0].indexOf('resolveLlmSelection()') >= 0, 'classifyTopic 经 resolveLlmSelection 选模型')
    const em = indexSrc.match(/async function extractInstruction\(text, note\) \{[\s\S]*?\n    \}/)
    assert(em && em[0].indexOf('resolveLlmSelection()') >= 0, 'extractInstruction 经 resolveLlmSelection 选模型')
  })
  // --- 行为断言（静态包 rpc2 链路 + 内存 mock fs/llm） ---
  const SETTINGS_PATH_MOCK = path.join(NOTES_ROOT_STATIC, 'settings.json')
  await t('notes-settings-get：初始空设置 + models 目录（llm 探针）', async () => {
    const sg = await rpc2('notes-settings-get', {})
    assert.strictEqual(sg.status, 200, 'HTTP 200')
    assert(sg.body.settings && typeof sg.body.settings === 'object', '返回 settings 对象')
    assert(!sg.body.settings.llm, '初始无 llm override（默认跟随会话）')
    assert(Array.isArray(sg.body.models), 'models 是数组')
    assert(sg.body.models.some(m => m.provider === 'p' && m.model === 'm'), 'models 含 listProviders/listModels 探到的 p/m（实得：' + JSON.stringify(sg.body.models) + '）')
  })
  await t('notes-settings-set：保存 llm override 并持久化 settings.json', async () => {
    const ss = await rpc2('notes-settings-set', { llm: { provider: 'setP', model: 'setM' } })
    assert(ss.body.ok === true, '保存成功（实得 ' + JSON.stringify(ss.body) + '）')
    assert(store2.has(SETTINGS_PATH_MOCK), 'settings.json 已落盘（mock store）')
    const onDisk = JSON.parse(store2.get(SETTINGS_PATH_MOCK))
    assert(onDisk.llm && onDisk.llm.provider === 'setP' && onDisk.llm.model === 'setM', '磁盘内容含 llm override')
    const sg = await rpc2('notes-settings-get', {})
    assert(sg.body.settings.llm && sg.body.settings.llm.provider === 'setP' && sg.body.settings.llm.model === 'setM', 'get 回读与 set 一致')
  })
  await t('notes-settings-set 参数校验：缺 provider/model 报错且不写盘', async () => {
    const before = store2.get(SETTINGS_PATH_MOCK)
    const bad = await rpc2('notes-settings-set', { llm: { provider: 'onlyP' } })
    assert(bad.body.error, '缺 model 应返回 error')
    assert.strictEqual(store2.get(SETTINGS_PATH_MOCK), before, '校验失败不写盘')
  })
  // LLM 调用侦查：包装 llmMock.stream 记录每次调用的 provider/model（用 system 区分分类器/提取器）
  const llmCalls = []
  const origStreamForSettings = llmMock.stream
  llmMock.stream = async function* (req) { llmCalls.push({ provider: req && req.provider, model: req && req.model, system: (req && req.system) || '' }); yield* origStreamForSettings(req) }
  try {
    await t('extractInstruction 优先读设置模型（不跟随会话）', async () => {
      llmCalls.length = 0
      const qi = await rpc2('notes-quick-instruct', { text: '设置模型验证原文', note: '标记为设置验证', sessionId: 'sess-set-1', cwd: 'D:\\deepseek-work' })
      assert(qi.body.ok === true && qi.body.id, '指令记录成功')
      const used = llmCalls.filter(c => c.system.indexOf('元数据') >= 0)
      assert(used.length >= 1, 'extractInstruction 应至少调用一次 LLM')
      assert(used.every(c => c.provider === 'setP' && c.model === 'setM'), 'extractInstruction 应全部用设置模型 setP/setM（实得：' + JSON.stringify(used) + '）')
    })
    await t('classifyTopic 优先读设置模型（不跟随会话）', async () => {
      llmCalls.length = 0
      const q = await rpc2('notes-quick', { text: '设置模型分类速记', sessionId: 'sess-set-cls', cwd: 'D:\\deepseek-work' })
      assert(q.body.id, '速记成功')
      await new Promise(r => setTimeout(r, 200))   // 等异步分类回填
      const used = llmCalls.filter(c => c.system.indexOf('分类器') >= 0)
      assert(used.length >= 1, 'classifyTopic 应至少调用一次 LLM')
      assert(used.every(c => c.provider === 'setP' && c.model === 'setM'), 'classifyTopic 应全部用设置模型 setP/setM（实得：' + JSON.stringify(used) + '）')
    })
    await t('llm=null 恢复跟随会话（回退 adm.currentSelection）', async () => {
      const ss = await rpc2('notes-settings-set', { llm: null })
      assert(ss.body.ok === true, '清除成功')
      const sg = await rpc2('notes-settings-get', {})
      assert(!sg.body.settings.llm, 'llm override 已删除')
      const onDisk = JSON.parse(store2.get(SETTINGS_PATH_MOCK))
      assert(!onDisk.llm, '磁盘 settings.json 不再含 llm')
      llmCalls.length = 0
      const qi = await rpc2('notes-quick-instruct', { text: '恢复跟随验证原文', note: '标记为恢复验证', sessionId: 'sess-set-2', cwd: 'D:\\deepseek-work' })
      assert(qi.body.ok === true, '指令记录成功')
      const used = llmCalls.filter(c => c.system.indexOf('元数据') >= 0)
      assert(used.length >= 1 && used.every(c => c.provider === 'p' && c.model === 'm'), 'extractInstruction 恢复后回退会话模型 p/m（实得：' + JSON.stringify(used) + '）')
    })
    await t('classifyTopic 恢复后也回退跟随会话', async () => {
      llmCalls.length = 0
      await rpc2('notes-quick', { text: '恢复跟随分类速记', sessionId: 'sess-set-cls2', cwd: 'D:\\deepseek-work' })
      await new Promise(r => setTimeout(r, 200))
      const used = llmCalls.filter(c => c.system.indexOf('分类器') >= 0)
      assert(used.length >= 1 && used.every(c => c.provider === 'p' && c.model === 'm'), 'classifyTopic 恢复后回退会话模型 p/m（实得：' + JSON.stringify(used) + '）')
    })
  } finally {
    llmMock.stream = origStreamForSettings
  }
  await t('settings.json 不污染笔记列表（_list 只认 .md）', async () => {
    assert(store2.has(SETTINGS_PATH_MOCK), 'settings.json 存在于笔记目录（mock）')
    const l = await rpc2('notes-list', {})
    assert(l.body.notes.every(n => String(n.id).indexOf('settings') < 0), '列表无 settings 相关条目')
  })
  }
}
