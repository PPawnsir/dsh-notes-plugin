// 节 44. 设置卡交互反馈（✕ 关闭 + dirty 保存/还原 + 兜底 flush，三端同步）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "44",
  title: "44. 设置卡交互反馈（✕ 关闭 + dirty 保存/还原 + 兜底 flush，三端同步）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { appSrc, clientPkgSrc, plugin, protoV2Src } = S
  // ===== 44. 设置卡交互反馈（notes-settings-feedback：✕ 常驻关闭 + dirty 保存/还原 + 关闭兜底 flush，三端同步）=====
  // 口径：✕ 常驻标题栏（点击收起，点外部行为保留）；dirty = 在途待写>0 或 控件值≠打开时快照；
  // 保存 = 显式确认 + 兜底 flush（校验中止→串行落盘→toast「设置已保存」→快照跟进→按钮回禁用态）；还原 = 回滚打开时快照逐键恢复；
  // 自动保存（选择即存/失焦/Enter 即存）零破坏；Esc/点遮罩 = ✕ 同义（先 flush 再关）
  section('44. 设置卡交互反馈（✕ 关闭 + dirty 保存/还原 + 兜底 flush，三端同步）')

  // ---- 44.1 client 面板（开发版 client-impl + 发布包 lib/client.js 同步）----
  await t('设置卡交互反馈（client）：✕ 常驻关闭 + dirty 状态机 + 保存/还原 + 兜底 flush（开发版 + 发布包）', () => {
    // ① 标题栏动作区：✕ 常驻 + 保存（accent 实心主按钮）/还原（次按钮），dirty 状态机驱动 disabled（无改动禁用灰显）
    assert(clientSrc.indexOf("e('button', { className: 'dsh-notes-settings-close dsh-nt'") >= 0, '✕ 常驻关闭按钮')
    assert(clientSrc.indexOf("className: 'dsh-notes-settings-save dsh-nt'") >= 0 && clientSrc.indexOf("className: 'dsh-notes-settings-restore dsh-nt'") >= 0, '保存/还原按钮')
    assert(clientSrc.indexOf("I('x', 12)") >= 0, '✕ 用 x SVG 图标（零 emoji）')
    assert(clientSrc.indexOf('disabled: !setDirty || setSaving') >= 0, '保存/还原 disabled 随 dirty 状态机（变更→enabled→保存→disabled）')
    // ② dirty 判定口径：打开时快照 + 在途写计数 + 已落盘镜像
    assert(clientSrc.indexOf('const [setSnap, setSetSnap] = React.useState(null)') >= 0, '打开时快照 state')
    assert(clientSrc.indexOf('const [setInflight, setSetInflight] = React.useState(0)') >= 0, '在途写计数 state')
    assert(clientSrc.indexOf('const setDirty = setInflight > 0 || (setSnap ? (') >= 0, 'dirty 判定口径（在途待写 + 快照比对）')
    assert(clientSrc.indexOf('setPersistRef') >= 0 && clientSrc.indexOf('function setPersistMerge(patch)') >= 0, '已落盘镜像 + 逐键跟进')
    assert(clientSrc.indexOf('setSetSnap(snap0); setPersistRef.current = snap0') >= 0, 'openSettings 捕获打开时快照 + 镜像初始化')
    // ③ 低层写通道：全部 settings-set 走 settingsSetQuiet（在途计数 + 镜像跟进；不逐键 toast）
    assert(clientSrc.indexOf('function settingsSetQuiet(patch)') >= 0 && clientSrc.indexOf("host.call('notes-settings-set', patch)") >= 0, 'settingsSetQuiet 低层写通道（零新 RPC）')
    // ④ 保存：校验中止（改动保留）→ 兜底 flush → toast「设置已保存」→ 快照跟进
    assert(clientSrc.indexOf('function saveSettingsAll()') >= 0 && clientSrc.indexOf("showToast(t('settings.savedAll'))") >= 0, '显式保存 + toast 文案「设置已保存」（覆盖卡 C 起走 t() 字典）')
    assert(clientSrc.indexOf('const SET_NUM_FIELDS = [') >= 0, '数值字段登记表（校验/flush/还原同口径）')
    // ⑤ 还原：回滚打开时快照逐键恢复 + UI 复位 + toast
    assert(clientSrc.indexOf('function restoreSettingsAll()') >= 0 && clientSrc.indexOf("showToast(t('settings.restoredAll'))") >= 0, '还原回滚 + toast 文案（覆盖卡 C 起走 t() 字典）')
    // ⑥ 关闭兜底 flush：✕/Esc/点遮罩同口径（先 flush 再关）
    assert(clientSrc.indexOf('function flushSettingsPending()') >= 0 && clientSrc.indexOf('function closeSettings() { flushSettingsPending(); setSettingsOpen(false) }') >= 0, '兜底 flush + 统一关闭入口')
    assert(clientSrc.indexOf('onClick: closeSettings') >= 0, '✕ onClick=closeSettings')
    assert(clientSrc.indexOf('if (settingsOpenRef.current) { if (settingsFlushRef.current) settingsFlushRef.current(); setSettingsOpen(false); return }') >= 0, 'Esc = ✕ 同义（先兜底 flush 再关）')
    assert(clientSrc.indexOf('onMouseDown: (ev) => { if (ev.target === ev.currentTarget) closeSettings() }') >= 0, '点遮罩同口径（保留收起行为 + flush）')
    assert(clientSrc.indexOf('React.useEffect(() => { settingsFlushRef.current = flushSettingsPending })') >= 0, 'Esc 闭包经 ref 读最新 flush（防过期）')
    // ⑦ 存量零破坏：失焦/Enter 即存 + 勾选/选择即存链路原样保留
    assert(clientSrc.indexOf("onBlur: saveSettingsStale, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsStale() }") >= 0, '时效行失焦/Enter 即存保留')
    assert(clientSrc.indexOf('onChange: (ev) => { const v = !!ev.target.checked; setSetCatalog(v); saveSettingsCatalog(v) }') >= 0, '目录开关勾选即存保留')
    assert(clientSrc.indexOf('onBlur: saveSettingsLogRetention') >= 0 && clientSrc.indexOf('onBlur: saveSettingsUsageBudget') >= 0, '日志窗口/用量预算失焦即存保留')
    // ⑧ 发布包同步（build-dist 产物）
    for (const k of ['dsh-notes-settings-close', 'dsh-notes-settings-save', 'dsh-notes-settings-restore', 'settingsSetQuiet', 'setPersistMerge', 'flushSettingsPending', 'saveSettingsAll', 'restoreSettingsAll', 'closeSettings', 'setDirty', '设置已保存', '已还原：设置回滚到打开时的状态', 'SET_NUM_FIELDS']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺「' + k + '」（需先跑 scripts/build-dist.cjs）')
    }
  })

  // ---- 44.2 样式双端（styles.css ⇄ 发布包 lib/styles.css）----
  await t('设置卡反馈样式双端：styles.css ⇄ 发布包 lib/styles.css（动作区/保存/还原/✕）', () => {
    const cssDevF = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkgF = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDevF], ['发布包 lib/styles.css', cssPkgF]]) {
      for (const cls of ['.dsh-notes-settings-t-acts{', '.dsh-notes-settings-save{', '.dsh-notes-settings-save:disabled{', '.dsh-notes-settings-restore{', '.dsh-notes-settings-restore:disabled{', '.dsh-notes-settings-close{']) {
        assert(pair[1].indexOf(cls) >= 0, pair[0] + ' 缺设置卡反馈样式 ' + cls + '（需跑 scripts/build-dist.cjs）')
      }
    }
    // accent 实心主按钮 + 禁用灰显（dirty 状态机视觉口径）
    assert(cssDevF.indexOf('.dsh-notes-settings-save{background:var(--nacc)') >= 0, '保存按钮 accent 实心')
    assert(cssDevF.indexOf('.dsh-notes-settings-save:disabled{opacity:.4') >= 0 && cssDevF.indexOf('.dsh-notes-settings-restore:disabled{opacity:.4') >= 0, '无改动禁用灰显')
  })

  // ---- 44.3 app.html / 原型 notes-ui-v2.html 同款（双端 UI 标记一致）----
  await t('app.html + 原型设置卡反馈同款：✕ + dirty 保存/还原 + 关闭兜底 flush + Esc 同口径（双端 UI 标记一致）', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      // ① 标题栏动作区：✕ 常驻 + 保存（primary accent 实心）/还原，初始禁用灰显
      assert(s.indexOf('id="setClose"') >= 0 && s.indexOf('id="setSave"') >= 0 && s.indexOf('id="setRestore"') >= 0, label + ' ✕/保存/还原 三按钮')
      assert(s.indexOf('class="mbtn primary" id="setSave" disabled') >= 0 && s.indexOf('class="mbtn" id="setRestore" disabled') >= 0, label + ' 初始禁用灰显（无改动）')
      assert(s.indexOf("$('setClose').onclick = closeModalFlushed;") >= 0 && s.indexOf("$('setSave').onclick = doSettingsSaveAll;") >= 0 && s.indexOf("$('setRestore').onclick = doSettingsRestoreAll;") >= 0, label + ' 三按钮接线')
      assert(s.indexOf('set-t-acts') >= 0 && s.indexOf('.set-t-acts{') >= 0, label + ' 标题栏动作区样式类')
      // ② dirty 状态机：快照 + 在途 + 已落盘镜像 + 判定/刷新
      assert(s.indexOf('var setSnap = null;') >= 0 && s.indexOf('var setPersist = null;') >= 0 && s.indexOf('var setInflight = 0;') >= 0, label + ' dirty 三态变量')
      assert(s.indexOf('function setDirtyCompute()') >= 0 && s.indexOf('function setDirtyRefresh()') >= 0, label + ' dirty 判定/刷新函数')
      assert(s.indexOf('if (setInflight > 0) return true;') >= 0, label + ' dirty 含在途待写口径')
      assert(s.indexOf('setSnap = { llmP: l ? l.provider : ') >= 0 && s.indexOf('setPersist = setSnap;') >= 0, label + ' 打开时快照捕获 + 镜像初始化')
      assert(s.indexOf('function setPersistMerge(patch)') >= 0, label + ' 已落盘镜像逐键跟进')
      // ③ 输入即刷新按钮态（oninput 只刷新不落盘）；存量失焦/Enter 即存 onchange 链路保留
      assert(s.indexOf('el.oninput = setDirtyRefresh') >= 0, label + ' oninput dirty 刷新')
      assert(s.indexOf("$('setStale').onchange = function ()") >= 0 && s.indexOf('saveSettings({ staleDays: parseInt(v, 10) }') >= 0, label + ' 存量失焦即存保留')
      // ④ 保存：校验中止 + 串行兜底 flush + toast「设置已保存」+ 快照跟进（dirty 复位）；
      //    文案口径：app 覆盖卡 C 起走 t() 字典，原型不双语红线保留内联中文
      assert(s.indexOf('function doSettingsSaveAll()') >= 0 && s.indexOf('setSnap = setSnapFromControls();') >= 0, label + ' 显式保存 + 快照跟进')
      assert(s.indexOf("toast(t('settings.savedAll'));") >= 0 || s.indexOf("toast('设置已保存');") >= 0, label + ' 保存 toast（app=t() 字典 / 原型=内联中文）')
      // ⑤ 还原：逐键回滚打开时快照 + UI 复位 + toast（文案口径同上）
      assert(s.indexOf('function doSettingsRestoreAll()') >= 0, label + ' 还原回滚函数')
      assert(s.indexOf("toast(t('settings.restoredAll'));") >= 0 || s.indexOf("toast('已还原：设置回滚到打开时的状态');") >= 0, label + ' 还原 toast（app=t() 字典 / 原型=内联中文）')
      // ⑥ 低层写通道 + 关闭兜底 flush（✕/Esc/点遮罩同口径，modalCloseHook 挂接）
      assert(s.indexOf('function settingsSetQuiet(patch)') >= 0 && s.indexOf('function flushSettingsPending()') >= 0, label + ' settingsSetQuiet + flushSettingsPending')
      assert(s.indexOf("rpc('notes-settings-set', patch)") >= 0, label + ' 零新 RPC（复用 settings-set）')
      assert(s.indexOf('var modalCloseHook = null;') >= 0 && s.indexOf('function closeModalFlushed()') >= 0, label + ' 关闭钩子框架')
      assert(s.indexOf('modalCloseHook = flushSettingsPending;') >= 0, label + ' 设置卡挂接兜底 flush 钩子')
      assert(s.indexOf("if ($('modalHost').firstChild) { closeModalFlushed();") >= 0, label + ' Esc = ✕ 同义（先兜底 flush 再关）')
      // ⑦ 其余 modal 行为不变：钩子缺省 null（openModal 换 modal 即清）
      assert(s.indexOf('modalCloseHook = null;   /* 换 modal 即清钩子') >= 0, label + ' openModal 清钩子（其余 modal 行为不变）')
    }
    // 双端 UI 标记一致（共享 DOM id / 函数名 / 变量名 / 文案）
    for (const k of ['setClose', 'setSave', 'setRestore', 'set-t-acts', 'setSnap', 'setPersist', 'setInflight', 'setSaving', 'setDirtyCompute', 'setDirtyRefresh', 'setPersistMerge', 'settingsSetQuiet', 'setSnapFromControls', 'doSettingsSaveAll', 'doSettingsRestoreAll', 'flushSettingsPending', 'modalCloseHook', 'closeModalFlushed', 'SET_NUM_FIELDS', '设置已保存', '已还原：设置回滚到打开时的状态']) {
      assert(protoV2Src.indexOf(k) >= 0 && appSrc.indexOf(k) >= 0, '设置卡反馈 UI 标记双端一致：' + k)
    }
  })
  }
}
