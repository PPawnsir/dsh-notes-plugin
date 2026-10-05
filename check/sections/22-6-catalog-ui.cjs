// 节 22.6 笔记目录注入 client UI 开关（catalogEnabled 总开关；0.4.3 验收修复⑪起逐条 recall chip 已拆除）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "22.6",
  title: "22.6 笔记目录注入 client UI 开关（catalogEnabled 总开关；recall chip 已拆除）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { clientPkgSrc } = S
  // ===== 22.6 笔记目录注入 client UI 开关（设置卡片 catalogEnabled 总开关） =====
  section('22.6 笔记目录注入 client UI 开关（catalogEnabled 总开关；recall chip 已拆除）')
  await t('设置卡片含「目录段补充未挂载条目（缺省关）」总开关行（settingsRows 加行，勾选即保存）', () => {
    assert(/key: 'catalog', label: tt\('settings\.catalog'\)/.test(clientSrc), 'settingsRows 含目录段补充行（覆盖卡 C 起 label 走 tt() 字典）')
    assert(clientSrc.indexOf('catalogEnabled') >= 0, 'client-impl 含 catalogEnabled 字段')
    assert(/function saveSettingsCatalog\(/.test(clientSrc), 'saveSettingsCatalog 保存函数存在')
    assert(/function saveSettingsCatalog\([\s\S]*?settingsSetQuiet\(\{ catalogEnabled: enabled \}\)/.test(clientSrc), '总开关走 settings-set 通道传 catalogEnabled 布尔（settingsSetQuiet 低层通道）')
    assert(clientSrc.indexOf('目录段补充未挂载条目（缺省关）') >= 0, '总开关文案 =「目录段补充未挂载条目（缺省关）」（0.4.3③ 合并段口径）')
    assert(clientSrc.indexOf('开启后，注入的笔记目录段在挂载行之后补充未挂载的普通条目（一行一条），供 Agent 规划时参考并按需 note_get 取全文；缺省关闭，显式开启后生效') >= 0, '总开关 tooltip/sub 说明文案（缺省关口径）')
    assert(/setSetCatalog\(!!\(res\.settings && res\.settings\.catalogEnabled === true\)\)/.test(clientSrc), 'openSettings 回读 catalogEnabled（缺省关，显式 true 才开启）')
  })
  // 0.4.3 验收修复⑪（notes-043-mount-ux-final）：详情页「目录可见」chip 拆除——目录注入缺省关后逐条开关无感知作用；
  //   chip 拆除 ≠ 字段退役：host recall 字段/store-cache 缺省/目录开关开启时的过滤逻辑全部保留（22 节看守），
  //   client doSave 不再携带 recall（undefined = host patch 语义保留存量值）
  await t('编辑器逐条「目录可见」开关已拆除（0.4.3⑪ chip 退役，host recall 字段与过滤逻辑保留）', () => {
    assert(clientSrc.indexOf('edRecall') < 0, 'client editor 无 edRecall state/ref 残留')
    assert(clientSrc.indexOf('toggleRecall') < 0, 'client editor 无 toggleRecall 残留')
    assert(clientSrc.indexOf("tt('meta.recall')") < 0 && clientSrc.indexOf("tt('meta.recallTipNote')") < 0, 'client 无 recall chip 渲染（i18n 引用清零）')
    assert(/recall: edRecallRef\.current/.test(clientSrc) === false, 'doSave 不再携带 recall（host patch 语义保留存量值）')
    const appMeta = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'panels', 'editor-meta.js'), 'utf8')
    assert(appMeta.indexOf('mRecall') < 0 && appMeta.indexOf("t('meta.recallTip')") < 0, 'app editor-meta 无 mRecall chip/onclick 残留')
    // i18n 五键双端清理（meta.recall/recallTip/recallTipNote/recallOn/recallOff）
    const zh = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8')
    const en = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'en.js'), 'utf8')
    for (const k of ["'meta.recall':", "'meta.recallTip':", "'meta.recallTipNote':", "'meta.recallOn':", "'meta.recallOff':"]) {
      assert(zh.indexOf(k) < 0 && en.indexOf(k) < 0, 'i18n 双端无孤儿键 ' + k)
    }
    // host 字段保留红线：store-cache recall 缺省解析与目录过滤（recall===false 排除）零改动
    assert(hostSrc.indexOf("recall: p.meta.recall === 'true' ? true : (p.meta.recall === 'false' ? false : ((p.meta.kind === 'log' || p.meta.kind === 'sys') ? false : true)),") >= 0, 'host noteFromParsed recall 缺省解析保留（字段不退役）')
    assert(hostSrc.indexOf('if (n.recall === false) continue') >= 0, 'host 目录普通行 recall=false 过滤保留')
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
    assert(clientPkgSrc.indexOf('目录段补充未挂载条目（缺省关）') >= 0, '发布包含总开关行（0.4.3③ 新文案）')
    assert(clientPkgSrc.indexOf('catalogEnabled') >= 0, '发布包含 catalogEnabled 总开关')
    assert(clientPkgSrc.indexOf('saveSettingsCatalog') >= 0, '发布包含总开关保存函数')
    // 0.4.3⑪：发布包同步拆除——recall chip 链路零残留
    assert(clientPkgSrc.indexOf('toggleRecall') < 0 && clientPkgSrc.indexOf('edRecall') < 0, '发布包同步拆除 recall chip（toggleRecall/edRecall 零残留）')
  })
  }
}
