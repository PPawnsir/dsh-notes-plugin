// 节 22.6 笔记目录注入 client UI 开关（catalogEnabled 总开关 + recall 逐条）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "22.6",
  title: "22.6 笔记目录注入 client UI 开关（catalogEnabled 总开关 + recall 逐条）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { clientPkgSrc } = S
  // ===== 22.6 笔记目录注入 client UI 开关（设置卡片 catalogEnabled 总开关 + 详情区逐条 recall 开关） =====
  section('22.6 笔记目录注入 client UI 开关（catalogEnabled 总开关 + recall 逐条）')
  await t('设置卡片含「目录段补充未挂载条目（缺省关）」总开关行（settingsRows 加行，勾选即保存）', () => {
    assert(/key: 'catalog', label: tt\('settings\.catalog'\)/.test(clientSrc), 'settingsRows 含目录段补充行（覆盖卡 C 起 label 走 tt() 字典）')
    assert(clientSrc.indexOf('catalogEnabled') >= 0, 'client-impl 含 catalogEnabled 字段')
    assert(/function saveSettingsCatalog\(/.test(clientSrc), 'saveSettingsCatalog 保存函数存在')
    assert(/function saveSettingsCatalog\([\s\S]*?settingsSetQuiet\(\{ catalogEnabled: enabled \}\)/.test(clientSrc), '总开关走 settings-set 通道传 catalogEnabled 布尔（settingsSetQuiet 低层通道）')
    assert(clientSrc.indexOf('目录段补充未挂载条目（缺省关）') >= 0, '总开关文案 =「目录段补充未挂载条目（缺省关）」（0.4.3③ 合并段口径）')
    assert(clientSrc.indexOf('开启后，注入的笔记目录段在挂载行之后补充未挂载的普通条目（一行一条），供 Agent 规划时参考并按需 note_get 取全文；缺省关闭，显式开启后生效') >= 0, '总开关 tooltip/sub 说明文案（缺省关口径）')
    assert(/setSetCatalog\(!!\(res\.settings && res\.settings\.catalogEnabled === true\)\)/.test(clientSrc), 'openSettings 回读 catalogEnabled（缺省关，显式 true 才开启）')
  })
  await t('编辑器逐条「目录可见」开关（v2 meta chip tgl，edRecall 链路照抄编辑字段模式）', () => {
    assert(/const \[edRecall, setEdRecall\] = React\.useState\(true\)/.test(clientSrc), 'edRecall state 缺省 true（进目录）')
    assert(/const edRecallRef = React\.useRef\(true\)/.test(clientSrc), 'edRecallRef 自动保存镜像存在')
    assert(/setEdRecall\(n\.recall !== false\)/.test(clientSrc), 'selectNote 读 n.recall（缺省 true）')
    assert(/edRecallRef\.current = edRecall/.test(clientSrc), '渲染期同步 edRecallRef')
    assert(/recall: edRecallRef\.current/.test(clientSrc), 'doSave 的 notes-update payload 带 recall（恒为布尔，绝不含 undefined）')
    assert(/function toggleRecall\(\) \{ setEdRecall\(!edRecall\); triggerAutoSave\(\) \}/.test(clientSrc), 'toggleRecall 翻转 + 触发自动保存')
    assert(clientSrc.indexOf('关闭后该笔记不出现在注入给 Agent 的目录中') >= 0, '逐条开关 tooltip 文案')
    assert(/dsh-notes-meta-chip tgl' \+ \(edRecall \? ' on' : ''\)/.test(clientSrc), '目录可见渲染为 meta chip toggle（on 态高亮）')
    assert(clientSrc.indexOf("I('eye', 11)") >= 0 && clientSrc.indexOf("'目录可见'") >= 0, 'eye SVG 图标 + 「目录可见」文案（📇 emoji 已移除）')
  })
  await t('开关样式类三处同步（client-impl + 发布包 client.js + styles.css）', () => {
    for (const cls of ['dsh-notes-settings-checkwrap', 'dsh-notes-settings-check']) {
      assert(clientSrc.indexOf(cls) >= 0, 'client-impl 缺 ' + cls)
      assert(clientPkgSrc.indexOf(cls) >= 0, '发布包 client.js 缺 ' + cls + '（需先跑 scripts/build-dist.cjs）')
    }
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    assert(css.indexOf('.dsh-notes-settings-checkwrap{') >= 0 && css.indexOf('.dsh-notes-settings-check{') >= 0, 'styles.css 缺 settings-check 系列样式')
  })
  await t('发布包 client.js 同步目录开关链路（需先跑 scripts/build-dist.cjs）', () => {
    assert(clientPkgSrc.indexOf('目录段补充未挂载条目（缺省关）') >= 0 && clientPkgSrc.indexOf('目录可见') >= 0, '发布包含总开关行（0.4.3③ 新文案）+ 逐条开关文案')
    assert(clientPkgSrc.indexOf('catalogEnabled') >= 0 && /recall: edRecallRef\.current/.test(clientPkgSrc), '发布包含 catalogEnabled + recall 链路')
    assert(clientPkgSrc.indexOf('saveSettingsCatalog') >= 0 && clientPkgSrc.indexOf('toggleRecall') >= 0, '发布包含两个开关函数')
  })
  }
}
