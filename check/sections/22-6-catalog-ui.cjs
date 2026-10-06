// 节 22.6 目录补充行设置开关已拆除（0.4.4-E notes-044-catalog-remove：catalogEnabled 总开关随功能整体移除；0.4.3 验收修复⑪起逐条 recall chip 已拆除）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "22.6",
  title: "22.6 目录补充行设置开关已拆除（0.4.4-E 负向锚；recall chip 已拆除）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { clientPkgSrc } = S
  // ===== 22.6 目录补充行设置开关已拆除（设置卡片 catalogEnabled 总开关整体移除，0.4.4-E） =====
  section('22.6 目录补充行设置开关已拆除（0.4.4-E 负向锚；recall chip 已拆除）')
  await t('设置卡无「目录补充行」控件（client 开发版/发布包 + app 源/app.html 产物 + 原型 五端负向锚）', () => {
    const appSetSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'modals', 'settings.js'), 'utf8')
    const appHtmlSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')   // S.appSrc 由节 24 赋值，本节序位在前须自读
    const protoSrc = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    // client 开发版 + 发布包：行/保存函数/状态 setter/设置键 全清零
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const label = pair[0], s = pair[1]
      assert(!/key: 'catalog', label: tt\('settings\.catalog'\)/.test(s), label + ' settingsRows 无目录补充行（0.4.4-E 整拆）')
      assert(s.indexOf('saveSettingsCatalog') < 0 && s.indexOf('setSetCatalog') < 0, label + ' 无 saveSettingsCatalog/setSetCatalog 残留')
      assert(s.indexOf('catalogEnabled') < 0, label + ' 无 catalogEnabled 字段引用（host 侧对该键静默忽略）')
      assert(s.indexOf('目录段补充未挂载条目') < 0, label + ' 无「目录段补充未挂载条目」文案')
    }
    // app 源 + app.html 产物 + 原型：控件 DOM id/设置键/文案 全清零
    for (const pair of [['app settings.js', appSetSrc], ['app.html', appHtmlSrc], ['原型 notes-ui-v2.html', protoSrc]]) {
      const label = pair[0], s = pair[1]
      assert(s.indexOf('setCatalog') < 0, label + ' 无 setCatalog 控件残留')
      assert(s.indexOf('catalogEnabled') < 0, label + ' 无 catalogEnabled 字段引用')
      assert(s.indexOf('目录段补充未挂载条目') < 0 && s.indexOf('笔记目录注入') < 0, label + ' 无目录补充行文案')
    }
    // i18n 六键双端清理（settings.catalog/catalogTip/catalogOn/catalogOff/enabled/disabled——enabled/disabled 唯一消费方即本开关）
    const zh = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8')
    const en = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'en.js'), 'utf8')
    for (const k of ["'settings.catalog':", "'settings.catalogTip':", "'settings.catalogOn':", "'settings.catalogOff':", "'settings.enabled':", "'settings.disabled':"]) {
      assert(zh.indexOf(k) < 0 && en.indexOf(k) < 0, 'i18n 双端无孤儿键 ' + k)
    }
    // host 侧负向锚：settings-set 无 catalogEnabled 分支 + 注入渲染无读取门（存量键成惰性死键，不迁移）
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(src.indexOf("'catalogEnabled' in patch") < 0 && src.indexOf('settingsCache.catalogEnabled') < 0, label + ' host 无 catalogEnabled 分支/读取门')
    }
  })
  // 0.4.3 验收修复⑪（notes-043-mount-ux-final）：详情页「目录可见」chip 拆除——目录注入缺省关后逐条开关无感知作用；
  //   0.4.4-E 起 chip 拆除的宿主功能整体移除：host recall 字段/store-cache 缺省解析保留（dormant，0.4.5 清理卡裁决），
  //   目录普通行过滤逻辑随 catalog 整拆消亡；client doSave 不携带 recall（undefined = host patch 语义保留存量值）
  await t('编辑器逐条「目录可见」开关已拆除（0.4.3⑪ chip 退役；0.4.4-E 起 recall 字段 dormant 保留）', () => {
    assert(clientSrc.indexOf('edRecall') < 0, 'client editor 无 edRecall state/ref 残留')
    assert(clientSrc.indexOf('toggleRecall') < 0, 'client editor 无 toggleRecall 残留')
    assert(clientSrc.indexOf("tt('meta.recall')") < 0 && clientSrc.indexOf("tt('meta.recallTipNote')") < 0, 'client 无 recall chip 渲染（i18n 引用清零）')
    assert(/recall: edRecallRef\.current/.test(clientSrc) === false, 'doSave 不再携带 recall（host patch 语义保留存量值）')
    const appMeta = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'panels', 'editor-meta.js'), 'utf8')
    assert(appMeta.indexOf('mRecall') < 0 && appMeta.indexOf("t('meta.recallTip')") < 0, 'app editor-meta 无 mRecall chip/onclick 残留')
    // 原型同步负向锚（0.4.4-E：chip/文案随 catalog 整拆消亡——目录段唯挂载行源，recall 字段 dormant）
    const protoMeta = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    assert(protoMeta.indexOf('id="mRecall"') < 0 && protoMeta.indexOf("icon('i-eye') + '目录可见'") < 0, '原型 notes-ui-v2.html「目录可见」chip 同步拆除（0.4.4-E）')
    assert(protoMeta.indexOf('进目录用「目录可见」开关') < 0 && protoMeta.indexOf('进目录需显式开启「目录」') < 0 && protoMeta.indexOf('详情「目录可见」开关可显式开启') < 0, '原型无「显式开关进目录」活口径文案（日志 chip/注入管理/工作记忆对话框三处）')
    // i18n 五键双端清理（meta.recall/recallTip/recallTipNote/recallOn/recallOff）
    const zh = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8')
    const en = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'en.js'), 'utf8')
    for (const k of ["'meta.recall':", "'meta.recallTip':", "'meta.recallTipNote':", "'meta.recallOn':", "'meta.recallOff':"]) {
      assert(zh.indexOf(k) < 0 && en.indexOf(k) < 0, 'i18n 双端无孤儿键 ' + k)
    }
    // host 字段 dormant 红线：store-cache recall 缺省解析保留（0.4.5 清理卡统一裁决退役）；
    // 目录普通行 recall=false 过滤已随 catalog 整拆消亡（消费方归零）
    assert(hostSrc.indexOf("recall: p.meta.recall === 'true' ? true : (p.meta.recall === 'false' ? false : ((p.meta.kind === 'log' || p.meta.kind === 'sys') ? false : true)),") >= 0, 'host noteFromParsed recall 缺省解析保留（字段 dormant 不退役）')
    assert(hostSrc.indexOf('if (n.recall === false) continue') < 0, 'host 目录普通行 recall=false 过滤随 catalog 整拆消亡（0.4.4-E）')
  })
  await t('开关样式类三处同步（client-impl + 发布包 client.js + styles.css；checkwrap 系列仍服务导入/导出单文件勾选框）', () => {
    for (const cls of ['dsh-notes-settings-checkwrap', 'dsh-notes-settings-check']) {
      assert(clientSrc.indexOf(cls) >= 0, 'client-impl 缺 ' + cls)
      assert(clientPkgSrc.indexOf(cls) >= 0, '发布包 client.js 缺 ' + cls + '（需先跑 scripts/build-dist.cjs）')
    }
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    assert(css.indexOf('.dsh-notes-settings-checkwrap{') >= 0 && css.indexOf('.dsh-notes-settings-check{') >= 0, 'styles.css 缺 settings-check 系列样式')
  })
  await t('发布包 client.js 无目录开关链路残留（需先跑 scripts/build-dist.cjs）', () => {
    assert(clientPkgSrc.indexOf('目录段补充未挂载条目') < 0, '发布包无总开关行文案（0.4.4-E 整拆）')
    assert(clientPkgSrc.indexOf('catalogEnabled') < 0, '发布包无 catalogEnabled 引用')
    assert(clientPkgSrc.indexOf('saveSettingsCatalog') < 0, '发布包无总开关保存函数')
    // 0.4.3⑪：发布包同步拆除——recall chip 链路零残留
    assert(clientPkgSrc.indexOf('toggleRecall') < 0 && clientPkgSrc.indexOf('edRecall') < 0, '发布包同步拆除 recall chip（toggleRecall/edRecall 零残留）')
  })
  }
}
