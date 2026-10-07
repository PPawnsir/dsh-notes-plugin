// 节 106. 0.4.7-B UX 打磨（notes-047-ux：主窗口自查 + R2 漏网 n-mux79knmfjxt + 0.4.6-J verifier 残留 + 用户实测 n-muy9gdybdd40）
// 覆盖六项 + 裁决增补⑦：
//   ① 设置弹窗三件：a 标题栏 sticky（保存恒见）/ b 长说明 >60 字两行收折 ⓘ 展开 / c 概念速览 bullet 悬挂缩进
//   ② 顶栏：a app/原型「速记合并」按钮撤除（建议器内入口保留——撤除锚在 26/49/57/96 节反转）/ b meta 行动区封板溢出菜单
//   ③ 组尾加载行键盘可达（client .dsh-notes-more-row：role=button + tabIndex + Enter/Space；j/k 不混入——取舍注记在 tree.js）
//   ④ 三态两处：a 分段旁可见 ⓘ（tooltip=三档同文合成 + 可聚焦 + 点击 toast）/ b 挂载模态三岔（「仅切换角色，暂不挂载」/ Esc·遮罩=取消不切换）
//   ⑤ 派发弹窗专属会话无界面提示行（双端 + 原型 + 双语）
//   ⑥ 整理中态强化（meta 钮 spinner/禁用 + 正文区遮罩）+ ⑥a 失败驻留条（手动 ✕）+ ⑥b 引导卡超限前置校验（读 settings-get 生效值）
//   ⑦ organizeMaxChars 自适应：host 模型表（AI_ORGANIZE_MODEL_MAX）+ settings 字段（0=自动）+ settings-get 增带生效值 + 超限文案带值
// 行为级主战场：⑦ host 独立实例全矩阵（模型表映射/用户覆盖优先/未知模型回落/生效值透出/超限文案带值）；
//   ②b metaActsSplit 纯函数双端提取 eval；④b 语义锁 = 静态锚（交互级归 e2e ㊱/㊲）。
module.exports = {
  id: "106",
  title: "106. 0.4.7-B UX 打磨六项 + organizeMaxChars 自适应（notes-047-ux）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, clientSrc, indexSrc } = H
  const { NOTES_DIR, admMock, agentsMock, appSrc, clientPkgSrc, protoV2Src, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, workspaceRegistryMock } = S
  section('106. 0.4.7-B UX 打磨六项 + organizeMaxChars 自适应（notes-047-ux）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const stylesSrc = read('src/styles.css')
  const appHead = read('src/app/shell/head.html')
  const appSettings = read('src/app/modals/settings.js')
  const cliSettings = read('src/client/modals/settings.js')
  const appMeta = read('src/app/panels/editor-meta.js')
  const cliEditor = read('src/client/panels/panel/editor.js')
  const appOrganize = read('src/app/panels/organize.js')
  const cliOrganizeInstr = read('src/client/modals/organize-instruct.js')
  const appDispatch = read('src/app/modals/dispatch.js')
  const cliDispatch = read('src/client/modals/dispatch.js')
  const cliTree = read('src/client/panels/panel/tree.js')
  const appMount = read('src/app/modals/inject-manager.js')
  const cliMount = read('src/client/modals/inject-manager.js')
  const grab = (f, v) => new Function(read('src/i18n/' + f) + '\nreturn ' + v)()
  const ZH = grab('zh.js', 'I18N_ZH'), EN = grab('en.js', 'I18N_EN')

  // ===== 106.1 ①a 弹窗标题栏 sticky（三端 CSS）=====
  await t('①a 弹窗标题栏 sticky：app .modal-t + client .dsh-notes-settings-modal-t + 原型 .modal-t 三端同则', () => {
    for (const [label, src, sel] of [['app head.html', appHead, '.modal-t{'], ['client styles.css', stylesSrc, '.dsh-notes-settings-modal-t{'], ['原型', protoV2Src, '.modal-t{']]) {
      const i = src.indexOf(sel)
      assert(i >= 0, label + ' 缺选择器 ' + sel)
      const rule = src.slice(i, src.indexOf('}', i))
      assert(rule.indexOf('position:sticky') >= 0 && rule.indexOf('top:-16px') >= 0 && rule.indexOf('background:var(--npanel)') >= 0, label + ' 标题栏 sticky 三要素（sticky + 顶吸顶 + 不透明底）')
    }
    // e2e ㊱ 补「滚到底保存恒见」真机锁（本卡 DOM 级锚定到此）
  })

  // ===== 106.2 ①b 长说明收折 ⓘ + ①c 速览悬挂缩进（双端 + 原型）=====
  await t('①b/①c 设置卡描述瘦身 + 速览排版：收折类 .cl + ⓘ 钮 + 阈值 60 + onb-li 悬挂缩进（app/client/原型三端）', () => {
    // app：setLabelHtml 生成器 + 阈值 + 接线
    assert(appSettings.indexOf('function setLabelHtml(label, tip, extraHtml)') >= 0 && appSettings.indexOf("tip.length > 60") >= 0, 'app setLabelHtml + 60 字阈值')
    assert(appSettings.indexOf("querySelectorAll('.sx')") >= 0 && appSettings.indexOf("s.classList.toggle('cl')") >= 0, 'app ⓘ 展开/收拢接线')
    assert(appSettings.indexOf('setLabelHtml(t(\'settings.language\'), t(\'settings.languageTip\'))') >= 0, 'app 行全部改走生成器（抽查语言行）')
    // client：SettingsRowLabel 组件同款口径
    assert(cliSettings.indexOf('function SettingsRowLabel(props)') >= 0 && cliSettings.indexOf('props.sub.length > 60') >= 0, 'client SettingsRowLabel + 60 字阈值')
    assert(cliSettings.indexOf('e(SettingsRowLabel, { label: row.label, sub: row.sub })') >= 0, 'client 行渲染改走组件')
    // 原型：生成器同构（静态中文红线）
    assert(protoV2Src.indexOf('function setLabelHtml(label, tip, extraHtml)') >= 0 && protoV2Src.indexOf("querySelectorAll('.sx')") >= 0, '原型 setLabelHtml 同构')
    assert(protoV2Src.indexOf('setLabelHtml(\'LLM 模型\'') >= 0, '原型行改走生成器')
    // ①c：三端 onb-li
    assert(appSettings.indexOf('<div class="onb-li">') >= 0 && cliSettings.indexOf("className: 'dsh-notes-onb-li'") >= 0 && protoV2Src.indexOf('<div class="onb-li">') >= 0, '概念速览 bullet 悬挂缩进三端')
    // CSS 双端 + 原型
    assert(appHead.indexOf('.set-label .s.cl{') >= 0 && appHead.indexOf('.modal-hint .onb-li{') >= 0, 'app CSS：.s.cl 收折 + .onb-li')
    assert(stylesSrc.indexOf('.dsh-notes-settings-label-s.cl{') >= 0 && stylesSrc.indexOf('.dsh-notes-onb-li{') >= 0, 'client CSS：收折 + onb-li')
    assert(protoV2Src.indexOf('.set-label .s.cl{') >= 0 && protoV2Src.indexOf('.modal-hint .onb-li{') >= 0, '原型 CSS 同步')
  })

  // ===== 106.3 ②b meta 行动区封板：metaActsSplit 纯函数三端同文 + 行为级 eval =====
  await t('②b metaActsSplit 纯函数：app/client/原型三端同文 + eval 行为矩阵（≤5 全直出 / 6/7/8 溢出分组）', () => {
    const pick = (src, label) => {
      const m = src.match(/function metaActsSplit\(keys\) \{[\s\S]*?\n\s*\}/)
      assert(m, label + ' metaActsSplit 可提取')
      return m[0]
    }
    const fnA = pick(appMeta, 'app'), fnC = pick(cliEditor, 'client'), fnP = pick(protoV2Src, '原型')
    const norm = (s) => s.split('\n').map(l => l.trim().replace(/;+$/, '')).join('\n')   /* client 无分号风格 vs app/原型带分号——比较前归一 */
    assert(norm(fnA) === norm(fnC) && norm(fnA) === norm(fnP), 'metaActsSplit 三端同文（去缩进/分号）')
    for (const [label, fn] of [['app', fnA], ['client', fnC], ['原型', fnP]]) {
      const split = new Function('META_ACT_MAX', fn + '\nreturn metaActsSplit')(5)
      const r5 = split(['organize', 'dispatch', 'export', 'pin', 'del'])   // 常态 5 动作（无来源/无历史）
      assert(r5.inline.length === 5 && r5.overflow.length === 0, label + ' 5 动作全直出零菜单（常态零变化）')
      const r6 = split(['organize', 'dispatch', 'src', 'export', 'pin', 'del'])   // 带来源无历史
      assert(r6.inline.join() === 'organize,dispatch,src,pin,del' && r6.overflow.join() === 'export', label + ' 6 动作：中段导出收菜单，pin/del 恒见（实得 ' + r6.inline.join() + '|' + r6.overflow.join() + '）')
      const r7 = split(['organize', 'dispatch', 'src', 'hist', 'export', 'pin', 'del'])   // 全量 7 动作
      assert(r7.inline.join() === 'organize,dispatch,src,pin,del' && r7.overflow.join() === 'hist,export', label + ' 7 动作：历史/导出收菜单（相对顺序不动）')
    }
  })
  await t('②b 溢出菜单接线：触发钮/菜单容器/外点收拢/键盘开合（app + client + 原型）', () => {
    for (const [label, s] of [['app', appMeta], ['client', cliEditor], ['原型', protoV2Src]]) {
      assert(s.indexOf('META_ACT_MAX = 5') >= 0, label + ' 封板阈值常量')
      assert(s.indexOf('meta-more-wrap') >= 0 && s.indexOf('meta-more-menu') >= 0, label + ' 溢出菜单容器')
    }
    assert(appMeta.indexOf("$('mActsMore')") >= 0 && appMeta.indexOf("metaActsBindOnce()") >= 0, 'app 触发钮接线 + 外点收拢一次性委托')
    assert(cliEditor.indexOf('actsMenuOpen') >= 0 && cliEditor.indexOf("ev.target.closest('.dsh-notes-meta-more-wrap')") >= 0, 'client 菜单开合态 + 外点收拢 effect')
    assert(appHead.indexOf('.meta-more-menu{') >= 0 && stylesSrc.indexOf('.dsh-notes-meta-more-menu{') >= 0 && protoV2Src.indexOf('.meta-more-menu{') >= 0, '溢出菜单样式三端')
  })

  // ===== 106.4 ③ 组尾加载行键盘可达（client 面板独有面）=====
  await t('③ 组尾加载行键盘可达：role=button + tabIndex=0 + Enter/Space 触发 + aria-label（开发版 + 发布包）', () => {
    for (const [label, s] of [['client', cliTree], ['发布包', clientPkgSrc]]) {
      assert(s.indexOf("className: 'dsh-notes-more-row', role: 'button', tabIndex: 0") >= 0, label + ' more-row 按钮语义')
      assert(s.indexOf("ev.key === 'Enter' || ev.key === ' '") >= 0 && s.indexOf('groupPageNext(prev, key)') >= 0, label + ' Enter/Space 触发翻页')
    }
    assert(cliTree.indexOf('j/k 导航到组尾边界「自动聚焦加载行」不做') >= 0, 'j/k 不混入的取舍注记在案（0.4.7-B③ 评估结论）')
    assert(stylesSrc.indexOf('.dsh-notes-more-row:focus-visible{') >= 0, 'more-row 聚焦环样式')
  })

  // ===== 106.5 ④ 三态两处 =====
  await t('④a 三态旁可见 ⓘ：合成 tooltip（三档同文）+ 可聚焦 + 点击/Enter toast 兜底（app/client/原型）', () => {
    for (const [label, s] of [['app', appMeta], ['原型', protoV2Src]]) {
      assert(s.indexOf('function roleInfoTip()') >= 0, label + ' roleInfoTip 合成函数')
    }
    assert(cliEditor.indexOf("const roleInfoTip = tt('meta.roleOff')") >= 0, 'client roleInfoTip 合成（const 内联形态）')
    assert(cliEditor.indexOf("'data-tooltip': roleInfoTip") >= 0, 'client ⓘ tooltip 取合成文案')
    assert(appMeta.indexOf("t('meta.roleOffTip')") >= 0 && appMeta.indexOf("t('meta.roleConventionTip')") >= 0 && appMeta.indexOf("t('meta.roleReferenceTip')") >= 0, 'app ⓘ 文案 = 三档原生 title 同文合成（单一文案源）')
    assert(appMeta.indexOf("t('common.listSep')") >= 0 && cliEditor.indexOf("tt('common.listSep')") >= 0, 'ⓘ 合成分隔符走 common.listSep 双语键（双端）')
    assert(appMeta.indexOf('class="role-info" id="mRoleInfo" tabindex="0" role="button"') >= 0 && appMeta.indexOf('roleInfoEl.onkeydown') >= 0, 'app ⓘ 可聚焦 + 键盘触发')
    assert(cliEditor.indexOf("className: 'dsh-notes-role-info dsh-nt', tabIndex: 0, role: 'button'") >= 0 && cliEditor.indexOf('showToast(roleInfoTip)') >= 0, 'client ⓘ 可聚焦 + 点击 toast 同文')
    assert(appHead.indexOf('.role-info{') >= 0 && stylesSrc.indexOf('.dsh-notes-role-info{') >= 0 && protoV2Src.indexOf('.role-info{') >= 0, 'ⓘ 样式三端')
  })
  await t('④b 挂载模态三岔：「仅切换角色，暂不挂载」（onSkip 在途）/ 编辑态「取消」/ 其余入口原样 + Esc·遮罩取消零副作用', () => {
    // 双端弹层签名 + 三岔接线
    assert(appMount.indexOf('function openMountModal(n, onConfirm, onSkip)') >= 0 && appMount.indexOf("mountState.onSkip ? t('inj.mountSkipSwitch')") >= 0, 'app 弹层 onSkip 第三参 + 文案分岔')
    assert(appMount.indexOf("var st = mountState; mountState = null; closeModal(); if (st && st.onSkip)") >= 0, 'app 跳过档 = 关卡 + onSkip 切档（Esc/遮罩走 closeModalFlushed 零回调——取消不切换语义锁定）')
    assert(cliMount.indexOf('const mountOnSkipRef = { current: null }') >= 0 && cliMount.indexOf("mountOnSkipRef.current ? tt('inj.mountSkipSwitch')") >= 0, 'client 弹层 onSkip 镜像 + 文案分岔')
    assert(cliMount.indexOf('const cb = mountOnSkipRef.current; closeMountModal(); if (cb)') >= 0, 'client 跳过档 = 关层 + 切档')
    // 角色切换在途的两入口传 onSkip；纯挂载入口（建议器/预览）不传（文案保持 inj.mountSkip）
    assert(appMeta.indexOf('openMountModal({ id: n.id, title: n.title, existing: line ? line.when : undefined }, flipRef, flipRef)') >= 0, 'app 详情三态 onSkip=flipRef（切档不落索引行）')
    assert(cliEditor.indexOf('openMountModal({ id: mid, title: edTitleRef.current || mid }, { onConfirmed: flipRef, onSkip: flipRef })') >= 0, 'client 详情三态 onSkip 回退分支同款')
    assert(cliEditor.indexOf('openMountModal({ id: mid, title: edTitleRef.current || mid, existing: line ? line.when : undefined }, { onConfirmed: flipRef, onSkip: flipRef })') >= 0, 'client 详情三态编辑模式分支同款')
    // i18n 键
    assert(ZH['inj.mountSkipSwitch'] === '仅切换角色，暂不挂载' && typeof EN['inj.mountSkipSwitch'] === 'string' && EN['inj.mountSkipSwitch'].length > 0, 'inj.mountSkipSwitch 双语在案')
  })

  // ===== 106.6 ⑤ 派发弹窗专属会话无界面提示行（双端 + 原型 + 双语）=====
  await t('⑤ 专属会话无界面提示行：双端 + 原型锚 + 联动显隐 + 双语键', () => {
    assert(appDispatch.indexOf('id="dSchedNewHint"') >= 0 && appDispatch.indexOf("t('disp.schedNewHint')") >= 0 && appDispatch.indexOf('function renderSchedNewHint()') >= 0, 'app 提示行 + 显隐收敛点')
    assert((appDispatch.match(/renderSchedNewHint\(\)/g) || []).length >= 3, 'app 首轮渲染 + 模式切换 + 勾选三处联动')
    assert(cliDispatch.indexOf("className: 'dsh-notes-sched-new-hint'") >= 0 && cliDispatch.indexOf("tt('disp.schedNewHint')") >= 0, 'client 提示行（勾选 + 非仅一次条件渲染）')
    assert(cliDispatch.indexOf("dispatchSchedNew && dispatchSchedMode !== 'once'") >= 0, 'client 显隐口径（仅一次无专属会话不显示）')
    assert(protoV2Src.indexOf('id="dSchedNewHint"') >= 0 && protoV2Src.indexOf('function renderSchedNewHint()') >= 0 && protoV2Src.indexOf('专属会话为无界面会话：无浏览器等 GUI 附着工具') >= 0, '原型提示行同步（静态中文红线）')
    assert(appHead.indexOf('.sched-new-hint{') >= 0 && stylesSrc.indexOf('.dsh-notes-sched-new-hint{') >= 0, '提示行样式双端')
    assert(ZH['disp.schedNewHint'].indexOf('无浏览器等 GUI 附着工具') >= 0 && EN['disp.schedNewHint'].indexOf('headless') >= 0, 'disp.schedNewHint 双语在案')
  })

  // ===== 106.7 ⑥ 整理中态强化 + ⑥a 失败驻留 + ⑥b 超限前置校验（双端 + 原型）=====
  await t('⑥ 整理中态强化：meta 钮 spinner/禁用 + 正文区遮罩（app/client/原型三端锚）', () => {
    assert(appOrganize.indexOf("organizing = true; organizeErr = ''; renderMeta(); refreshOrganizeUI()") >= 0, 'app 整理起手式：busy + 遮罩 + 清驻留条')
    assert(appOrganize.indexOf('function refreshOrganizeUI()') >= 0 && appOrganize.indexOf("$('orgVeil')") >= 0, 'app 遮罩显隐收敛点')
    assert(appSrc.indexOf('class="org-veil" id="orgVeil"') >= 0 && appSrc.indexOf("t('editor.organizingVeil')") >= 0, 'app 遮罩 DOM（.ed-main 内）+ 双语文案键')
    assert(appMeta.indexOf("(organizing ? '<span class=\"org-spin\"></span>' : icon('i-sparkle'))") >= 0, 'app meta 钮整理中 spinner 换图标')
    assert(cliEditor.indexOf("className: 'dsh-notes-org-veil'") >= 0 && cliEditor.indexOf("tt('editor.organizingVeil')") >= 0, 'client 遮罩（bodywrap 内）')
    assert(cliEditor.indexOf("organizing ? e('span', { className: 'dsh-notes-org-spin' }) : I('sparkle', 12)") >= 0, 'client meta 钮 spinner')
    assert(cliEditor.indexOf("className: 'dsh-notes-ed-bodywrap'") >= 0, 'client 正文区包壳（遮罩锚）')
    assert(protoV2Src.indexOf('id="orgVeil"') >= 0 && protoV2Src.indexOf('function refreshOrganizeUI()') >= 0, '原型遮罩同构')
    assert(appHead.indexOf('.org-veil{') >= 0 && appHead.indexOf('@keyframes orgSpin') >= 0 && stylesSrc.indexOf('.dsh-notes-org-veil{') >= 0 && stylesSrc.indexOf('@keyframes dshNotesOrgSpin') >= 0, '遮罩 + spinner 样式双端')
    assert(ZH['editor.organizingVeil'] === 'AI 整理中，约需半分钟…' && typeof EN['editor.organizingVeil'] === 'string' && EN['editor.organizingVeil'].length > 0, 'editor.organizingVeil 双语在案')
  })
  await t('⑥a 整理失败驻留条：toast 退场 → 编辑区驻留条（手动 ✕ / 换笔记 / 下次发起才清）', () => {
    assert(appOrganize.indexOf("organizeErr = t('editor.organizeFailed', { msg: res.error }); refreshOrganizeUI(); return") >= 0, 'app 失败 → 驻留条（toast 不再）')
    assert(appOrganize.indexOf('organizeErr = t(\'editor.organizeFailed\', { msg: e && e.message || e })') >= 0, 'app 异常路径同款驻留')
    assert(appSrc.indexOf('id="orgErr"') >= 0 && appSrc.indexOf('id="orgErrX"') >= 0, 'app 驻留条 DOM + ✕')
    assert(appSrc.indexOf("organizeErr = '';                        /* 0.4.7-B⑥a") >= 0 || read('src/app/panels/editor.js').indexOf("organizeErr = '';") >= 0, 'app 换笔记清驻留条')
    assert(cliEditor.indexOf("setOrgErr(tt('editor.organizeFailed', { msg: res.error })); return") >= 0, 'client 失败 → 驻留条')
    assert(cliEditor.indexOf("className: 'dsh-notes-deg dsh-notes-org-err'") >= 0 && cliEditor.indexOf("onClick: () => setOrgErr('')") >= 0, 'client 驻留条 + ✕ 手动关闭')
    assert(cliEditor.indexOf("setOrgErr('')   // 0.4.7-B⑥a：换笔记清整理失败驻留条") >= 0, 'client 换笔记清驻留条')
    assert(protoV2Src.indexOf('id="orgErr"') >= 0 && protoV2Src.indexOf("organizeErr = '整理失败：'") >= 0, '原型驻留条同构')
  })
  await t('⑥b 引导卡超限前置校验：正文超生效上限 → 提示 + 确认禁用（本地长度 + settings-get 生效值缓存）', () => {
    assert(appOrganize.indexOf('function orgLimitRefresh(bodyLen)') >= 0 && appOrganize.indexOf('id="oiLimit"') >= 0 && appOrganize.indexOf('ok.disabled = over') >= 0, 'app 前置校验（提示 + 禁用）')
    assert(appOrganize.indexOf("rpc('notes-settings-get', {})") >= 0 && appOrganize.indexOf('res.organizeMaxChars') >= 0, 'app 生效值走 settings-get 增带键（零新 RPC）')
    assert(appOrganize.indexOf('var orgMaxCache = 0') >= 0, 'app 生效值会话级缓存')
    assert(cliOrganizeInstr.indexOf('bodyLen > (m.maxChars || 12000)') >= 0 && cliOrganizeInstr.indexOf('disabled: over') >= 0, 'client 前置校验 + 确认双闸')
    assert(cliOrganizeInstr.indexOf("host.call('notes-settings-get', {})") >= 0 && cliOrganizeInstr.indexOf('res.organizeMaxChars') >= 0, 'client 生效值同通道')
    assert(cliEditor.indexOf('openOrganizeInstruct(edBodyRef.current.length)') >= 0, 'client 开卡携正文长度')
    assert(protoV2Src.indexOf('function orgLimitRefresh(bodyLen)') >= 0 && protoV2Src.indexOf('id="oiLimit"') >= 0, '原型前置校验同构')
    assert(ZH['editor.organizeTooLong'].indexOf('{n}') >= 0 && ZH['editor.organizeTooLong'].indexOf('{max}') >= 0 && typeof EN['editor.organizeTooLong'] === 'string', 'editor.organizeTooLong 双语 + 占位符')
    assert(ZH['editor.organizeTooLongTip'].length > 0 && EN['editor.organizeTooLongTip'].length > 0, 'editor.organizeTooLongTip 双语在案')
  })

  // ===== 106.8 ⑦ organizeMaxChars：host 静态锚（双侧）+ settings 字段双端 =====
  await t('⑦ host 双侧：模型表 + 生效值解析器 + settings-set 白名单 + settings-get 增带（dev/dist 同构）', () => {
    for (const [label, s] of [['host-dev', hostSrc], ['index.mjs', indexSrc]]) {
      assert(s.indexOf('const AI_ORGANIZE_MODEL_MAX = [') >= 0 && s.indexOf("['deepseek', 12000]") >= 0 && s.indexOf("['kimi', 24000]") >= 0, label + ' 模型表在位（含估算依据注释要求的小表形态）')
      assert(s.indexOf('新增模型在此加行') >= 0, label + ' 表可维护性注记（新增模型在此加行）')
      assert(s.indexOf('function organizeMaxChars()') >= 0, label + ' 生效值解析器在位')
      assert(s.indexOf('const orgMax = organizeMaxChars()') >= 0 && s.indexOf("if (body.length > orgMax) return { error: '正文过长（' + body.length + ' 字，上限 ' + orgMax + ' 字），请分段整理' }") >= 0, label + ' 整理长度闸用生效值 + 文案带值')
      assert(s.indexOf("'organizeMaxChars' in patch") >= 0, label + ' settings-set 白名单')
      assert(s.indexOf('organizeMaxChars: organizeMaxChars()') >= 0, label + ' settings-get 增带生效值（零新 RPC，同 defaultPreset 先例）')
    }
    // 设置字段双端 + 原型
    assert(appSettings.indexOf('id="setOrgMax"') >= 0 && appSettings.indexOf("['setOrgMax', 'orgMax', 'organizeMaxChars', 'settings.organizeMaxInvalid']") >= 0, 'app 设置行 + dirty 登记表')
    assert(cliSettings.indexOf("key: 'organizemax'") >= 0 && cliSettings.indexOf("['orgMax', 'organizeMaxChars', 'settings.organizeMaxInvalid']") >= 0, 'client 设置行 + 登记表')
    assert(clientPkgSrc.indexOf("key: 'organizemax'") >= 0, '发布包 lib/client.js 同步（需先跑 build-dist）')
    assert(protoV2Src.indexOf('id="setOrgMax"') >= 0 && protoV2Src.indexOf('organizeMaxChars: typeof _mockSettings.organizeMaxChars') >= 0, '原型设置行 + mock 增带生效值')
    assert(ZH['settings.organizeMax'] === '整理长度上限' && EN['settings.organizeMax'] === 'Organize length cap', 'settings.organizeMax 双语')
    assert(ZH['settings.organizeMaxTip'].indexOf('{eff}') >= 0 && EN['settings.organizeMaxTip'].indexOf('{eff}') >= 0, 'organizeMaxTip 双语带生效值占位符（0 = 按所配模型自动）')
    assert(ZH['settings.organizeMaxInvalid'].length > 0 && EN['settings.organizeMaxInvalid'].length > 0 && ZH['settings.organizeMaxAuto'].length > 0 && EN['settings.organizeMaxAuto'].length > 0 && ZH['settings.savedOrganizeMax'].indexOf('{v}') >= 0 && EN['settings.savedOrganizeMax'].indexOf('{v}') >= 0, 'organizeMax 校验/自动/保存键双语在案')
  })

  // ===== 106.9 ⑦ host 行为级（独立实例全矩阵）：模型表映射 / 用户覆盖优先 / 未知回落 / 透出 / 超限文案带值 =====
  const store106 = new Map()
  const fsMock106 = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store106.has(p) ? { file: true } : null)),
    listDir: async () => [],
    readText: async (p) => { if (!store106.has(p)) throw new Error('ENOENT: ' + p); return store106.get(p) },
    writeText: async (p, c) => { store106.set(p, c) },
  }
  const llmMock106 = {
    stream: async function* () { yield { type: 'text-delta', text: '## 整理结果\n\n已整理\n' }; yield { type: 'finish' } },
    listProviders: () => [],
    listModels: async () => [],
  }
  const handlers106 = {}
  const harnessMock106 = { handle: (name, fn) => { handlers106[name] = fn; return () => { delete handlers106[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock106, DIR).apply({
    fs: fsMock106, sandboxPolicy: { resolve: () => ({}) },
    effect: () => {}, on: () => () => {},   /* ctx 完整面（schedule 常驻 cron 装配走 ctx.effect；事件订阅走 ctx.on——本例不演习均空桩） */
    get: (name) => ({ llm: llmMock106, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
  }, {})
  const bigBody = (n) => 'x'.repeat(n)
  await t('⑦ 行为级：生效值 = 用户覆盖 || 模型表 || 12000；settings-get 透出；超限 error 带生效值；设置往返落盘', async () => {
    // 未知模型回落（admMock 会话模型 'm' 不在表）→ 12000
    let sg = await handlers106['notes-settings-get']({})
    assert(sg && sg.organizeMaxChars === 12000, '未知模型回落 12000（实得 ' + sg.organizeMaxChars + '）')
    let over = await handlers106['notes-ai-organize']({ body: bigBody(12001), kind: 'note' })
    assert(over && over.error && over.error.indexOf('上限 12000') >= 0 && over.error.indexOf('12001') >= 0, '超限 error 带生效值 + 实际字数（实得 ' + (over && over.error) + '）')
    let ok = await handlers106['notes-ai-organize']({ body: bigBody(12000), kind: 'note' })
    assert(ok && ok.ok === true && ok.body.indexOf('整理结果') >= 0, '恰达上限放行（边界 = 上限本身）')
    // 模型表映射：设置 kimi/kimi-k3 → 24000（13000 字放行）
    await handlers106['notes-settings-set']({ llm: { provider: 'kimi', model: 'kimi-k3' } })
    sg = await handlers106['notes-settings-get']({})
    assert(sg.organizeMaxChars === 24000, '模型表映射 kimi-k3 → 24000（settings-get 透出，实得 ' + sg.organizeMaxChars + '）')
    ok = await handlers106['notes-ai-organize']({ body: bigBody(13000), kind: 'note' })
    assert(ok && ok.ok === true, '13000 字在 kimi 档 24000 下放行（旧硬编码 12000 会误杀）')
    // 用户覆盖优先：organizeMaxChars=5000 → 压过模型表
    const set1 = await handlers106['notes-settings-set']({ organizeMaxChars: 5000 })
    assert(set1 && set1.ok === true, 'settings-set organizeMaxChars=5000 放行')
    sg = await handlers106['notes-settings-get']({})
    assert(sg.organizeMaxChars === 5000 && sg.settings.organizeMaxChars === 5000, '用户覆盖优先（生效 5000 + 设置镜像落库）')
    over = await handlers106['notes-ai-organize']({ body: bigBody(5001), kind: 'note' })
    assert(over && over.error && over.error.indexOf('上限 5000') >= 0, '覆盖后超限文案带 5000（实得 ' + (over && over.error) + '）')
    // 0 = 自动（删 override 回模型表）；非法值拒绝
    await handlers106['notes-settings-set']({ organizeMaxChars: 0 })
    sg = await handlers106['notes-settings-get']({})
    assert(sg.organizeMaxChars === 24000 && !('organizeMaxChars' in sg.settings), '0 = 按模型自动（删 override 回 24000，settings 零残留）')
    const bad = await handlers106['notes-settings-set']({ organizeMaxChars: -5 })
    assert(bad && bad.error, '负数拒绝（实得 ' + JSON.stringify(bad) + '）')
    const badStr = await handlers106['notes-settings-set']({ organizeMaxChars: 'abc' })
    assert(badStr && badStr.error, '非数值拒绝')
    // 回落到跟随会话（未知模型 m）→ 12000
    await handlers106['notes-settings-set']({ llm: null })
    sg = await handlers106['notes-settings-get']({})
    assert(sg.organizeMaxChars === 12000, 'llm null 恢复跟随会话 → 未知模型回落 12000')
    // 静态包（index.mjs）同口径由 106.8 双侧静态锚锁定（dist 由 *.dist.js 镜像生成——check 产物流保证再现性）
  })
  },
}
