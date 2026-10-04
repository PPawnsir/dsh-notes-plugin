// 节 55. 文件夹名称输入弹层（notes-041-folder-prompt：弃原生 prompt，空名/同级重名内联校验，app + 原型 + client 三端）
// 反馈 n-mut46q00c3yw：新建/重命名文件夹用原生 prompt()——无样式/无校验，自动化环境静默失效。
// 修复：app.html + 原型 notes-ui-v2.html 改 openFolderInputModal 纯 DOM 自定义弹层（复用 modal 框架/minput/modal-err 既有类）；
// client 端本就是树内联输入（零 prompt），本节断言锁死三端「prompt( 0 命中」+ 弹层结构/校验行为/RPC 契约不变。
module.exports = {
  id: "55",
  title: "55. 文件夹名称输入弹层（弃原生 prompt：openFolderInputModal + 空名/同级重名校验）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  const { clientPkgSrc } = S
  section('55. 文件夹名称输入弹层（弃原生 prompt：openFolderInputModal + 空名/同级重名校验，app + 原型 + client 三端）')
  const appSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
  const protoSrc = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
  const modalSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'modals', 'folder-input.js'), 'utf8')

  await t('prompt( 在 app.html/client.js/原型产物中 0 命中（原生弹窗清零）', () => {
    // 红线：自动化环境 prompt 静默失效是本 bug 根因——新建/重命名必须纯 DOM，三端产物（含注释）零残留
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoSrc], ['开发版 client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      assert(pair[1].indexOf('prompt(') < 0, pair[0] + ' 仍残留 prompt( 调用/字样')
    }
    // 弹层唯一入口：doCreateFolder/doRenameFolder 均改调 openFolderInputModal（app + 原型双端）
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('function openFolderInputModal(opts)') >= 0, label + ' 缺 openFolderInputModal 弹层函数')
      assert((s.match(/openFolderInputModal\(\{/g) || []).length === 2, label + ' 弹层调用点应为 2 处（create + rename）')
      assert(/function doCreateFolder\(parentId\) \{\s*\n\s*openFolderInputModal\(\{/.test(s), label + ' doCreateFolder 首行即开弹层')
      assert(/function doRenameFolder\(f\) \{\s*\n\s*openFolderInputModal\(\{/.test(s), label + ' doRenameFolder 首行即开弹层')
    }
  })

  await t('弹层结构双端同步：modal 框架复用 + minput 输入 + mErr 红字 + Enter 提交 + 位置副标题', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoSrc]]) {
      const s = pair[1], label = pair[0]
      /* i18n 覆盖卡E：app 端弹层文案走 t() 字典（zh 原串在 src/i18n/zh.js，随包内嵌），原型不双语红线保留中文原文（分侧断言） */
      if (label === 'app.html') assert(s.indexOf("'<input class=\"minput\" id=\"fldName\" maxlength=\"60\" placeholder=\"' + t('fld.namePlaceholder') + '\"") >= 0, label + ' 弹层 minput 输入框走 t()（覆盖卡E）')
      else assert(s.indexOf("'<input class=\"minput\" id=\"fldName\" maxlength=\"60\" placeholder=\"文件夹名称\"") >= 0, label + ' 弹层 minput 输入框（复用既有类，零新样式）')
      assert(s.indexOf('id="mErr"') >= 0 && s.indexOf('modal-err') >= 0, label + ' 内联红字错误区（modal-err/mErr）')
      assert(s.indexOf("if (ev.key === 'Enter') { ev.preventDefault(); submit() }") >= 0, label + ' Enter 提交（Esc/遮罩走 modal 框架既有分支）')
      assert(s.indexOf("folderPath(parentId).map(function (f) { return f.name }).join(' / ')") >= 0, label + ' 父文件夹只读上下文（位置：路径 / 根级文件夹）')
      assert(s.indexOf('文件夹名称不能为空') >= 0 && s.indexOf('同级已存在同名文件夹「') >= 0, label + ' 空名/同级重名校验文案')
      assert(s.indexOf('folderKids(parentId).filter(function (x) { return x.id !== opts.excludeId })') >= 0, label + ' 重名名单 = 同级兄弟去自身（excludeId 重命名排除自名）')
      // RPC 契约不变：create 携带 parent（''=根级）/ rename 携带 id；名字未变不发 RPC
      assert(s.indexOf("{ op: 'create', name: name.trim(), parent: parentId || '' }") >= 0, label + ' create RPC 参数契约不变（name + parent）')
      assert(s.indexOf("{ op: 'rename', id: f.id, name: name.trim() }") >= 0, label + ' rename RPC 参数契约不变（id + name）')
      assert(s.indexOf('if (name === f.name) return;') >= 0, label + ' 名字未变不发 RPC 守卫')
    }
  })

  await t('弹层校验行为级 eval：空名/同级重名内联拒绝 + 合法名 trim 回调 + 自身排除 + Enter 提交', () => {
    // 用桩环境 eval src/app/modals/folder-input.js（单函数模块）：$ 返回输入/按钮桩，openModal 捕获 html，modalErr/closeModal 记录
    // i18n 覆盖卡E：弹层文案走 t() 字典——桩接真 zh 字典（{name} 插值同真码口径），行为断言读 zh 渲染结果
    const zhSrc55 = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8')
    const tFn55 = new Function(zhSrc55 + '\nreturn function t(k, vars){ var s = I18N_ZH[k]; if (s == null) return k; if (vars) s = s.replace(/\\{(\\w+)\\}/g, function (m, n) { return vars[n] != null ? String(vars[n]) : m }); return s }')()
    const env = {
      html: '', errs: [], closed: false, okCalls: [],
      siblings: [{ id: 'f1', name: '工作', parent: '' }, { id: 'f2', name: '学习', parent: '' }, { id: 'f3', name: '子夹', parent: 'f1' }],
      inp: null, okBtn: null, cancelBtn: null
    }
    function resetModal(opened) {
      env.errs = []; env.closed = false; env.okCalls = []
      env.inp = { value: '', focus() {}, select() {}, onkeydown: null }
      env.okBtn = { onclick: null }; env.cancelBtn = { onclick: null }
    }
    const $stub = (id) => id === 'fldName' ? env.inp : id === 'fldOk' ? env.okBtn : id === 'fldCancel' ? env.cancelBtn : null
    const openFolderInputModal = new Function(
      'openModal', 'closeModal', 'modalErr', 'folderKids', 'folderPath', 'icon', 'esc', '$', 't',
      modalSrc + '\nreturn openFolderInputModal'
    )(
      (html) => { env.html = html },
      () => { env.closed = true },
      (m) => { env.errs.push(m) },
      (pid) => env.siblings.filter(x => (x.parent || '') === pid),
      (id) => env.siblings.filter(x => x.id === id),
      () => '',
      (s) => String(s == null ? '' : s),
      $stub,
      tFn55
    )
    // ① 渲染锚点：标题/输入框/双按钮/错误区 + 根级副标题
    resetModal()
    openFolderInputModal({ title: '新建文件夹', parentId: '', okText: '新建', onOk: (n) => env.okCalls.push(n) })
    assert(env.html.indexOf('新建文件夹') >= 0 && env.html.indexOf('id="fldName"') >= 0 && env.html.indexOf('id="fldOk"') >= 0 && env.html.indexOf('id="fldCancel"') >= 0 && env.html.indexOf('id="mErr"') >= 0, '弹层 html 锚点齐全')
    assert(env.html.indexOf('根级文件夹') >= 0, '根级新建副标题（无父级位置路径）')
    // ② 空名拒绝：不发回调、不关弹层、红字提示
    env.inp.value = '   '
    env.okBtn.onclick()
    assert(env.errs.length === 1 && env.errs[0].indexOf('不能为空') >= 0, '空名 → 内联红字「不能为空」')
    assert(env.okCalls.length === 0 && env.closed === false, '空名 → 不发回调不关弹层')
    // ③ 同级重名拒绝（根级兄弟「工作」）；不同级同名放行（「子夹」在 f1 下，根级可建）
    env.inp.value = '工作'
    env.okBtn.onclick()
    assert(env.errs.length === 2 && env.errs[1].indexOf('同级已存在同名文件夹') >= 0, '同级重名 → 内联红字')
    assert(env.okCalls.length === 0, '同级重名 → 不发回调')
    env.inp.value = '子夹'
    env.okBtn.onclick()
    assert(env.okCalls.length === 1 && env.okCalls[0] === '子夹' && env.closed === true, '不同级同名放行（重名口径=同级兄弟）')
    // ④ 合法名 trim 后回调 + 关弹层
    resetModal()
    openFolderInputModal({ title: '新建子文件夹', parentId: 'f1', okText: '新建', onOk: (n) => env.okCalls.push(n) })
    assert(env.html.indexOf('位置：工作') >= 0, '子夹新建副标题含父级位置路径')
    env.inp.value = '  前端  '
    env.okBtn.onclick()
    assert(env.okCalls.length === 1 && env.okCalls[0] === '前端' && env.closed === true, '合法名 trim 后回调并关弹层')
    // ⑤ 重命名：excludeId 排除自身（自名不算重名）+ Enter 键提交
    resetModal()
    openFolderInputModal({ title: '重命名文件夹', value: '工作', parentId: '', excludeId: 'f1', okText: '重命名', onOk: (n) => env.okCalls.push(n) })
    assert(env.inp.value === '' && env.html.indexOf('value="工作"') >= 0, '重命名初值回填进输入框 value')
    env.inp.value = '学习'
    env.okBtn.onclick()
    assert(env.okCalls.length === 0 && env.errs.some(m => m.indexOf('同级已存在') >= 0), '重命名为同级他名 → 拒绝')
    env.inp.value = '工作'
    let prevented = false
    env.inp.onkeydown({ key: 'Enter', preventDefault: () => { prevented = true } })
    assert(prevented === true && env.okCalls.length === 1 && env.okCalls[0] === '工作', 'Enter 提交 + excludeId 排除自身（自名放行，由调用方名字未变守卫拦 RPC）')
    // ⑥ Esc/取消：关闭由 modal 框架承担（cancel 按钮 = closeModal）
    resetModal()
    openFolderInputModal({ title: '新建文件夹', parentId: '', onOk: (n) => env.okCalls.push(n) })
    env.cancelBtn.onclick()
    assert(env.closed === true && env.okCalls.length === 0, '取消按钮关闭弹层不发回调')
  })

  await t('client 端零 prompt 旁证：文件夹新建/重命名本就走树内联输入（subFolderFor/renamingId）', () => {
    // client 不随本任务改动——既有内联输入已满足「禁原生 prompt」红线，断言锁死防回退
    assert(clientSrc.indexOf('subFolderFor') >= 0 && clientSrc.indexOf('renamingId') >= 0, 'client 文件夹新建/重命名 = 树内联输入')
    assert(clientSrc.indexOf('dsh-notes-folder-rename') >= 0, 'client 重命名内联输入样式类')
    assert(clientPkgSrc.indexOf('subFolderFor') >= 0, '发布包 lib/client.js 同步内联输入')
  })
  }
}
