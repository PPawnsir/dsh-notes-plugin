// 节 1. 静态校验（syntax + 结构）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "1",
  title: "1. 静态校验（syntax + 结构）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { plugin } = S
  // ===== 1. 静态校验 =====
  section('1. 静态校验（syntax + 结构）')
  await t('host.js 语法', () => new Function(bootHostSrc))
  await t('client.js 语法', () => new Function(bootClientSrc))
  await t('host-impl.js 语法', () => new Function(hostSrc))
  await t('client-impl.js 语法', () => new Function(clientSrc))
  await t('host 引导壳关键结构', () => {
    assert(bootHostSrc.indexOf('host-impl.js') >= 0 && bootHostSrc.indexOf('new Function') >= 0, 'host bootstrap loads impl via new Function')
  })
  await t('client 引导壳关键结构', () => {
    assert(bootClientSrc.indexOf('notes-src') >= 0 && bootClientSrc.indexOf('new Function') >= 0, 'client bootstrap fetches impl via notes-src + new Function')
  })
  await t('发布面文件零 BOM（壳/发布包 package.json/index.mjs/app.html/README.md 等首 3 字节非 EF BB BF）', () => {
    // 事故防御（0.3.x 发版期真实事故）：package.json 被编辑器写入 BOM，DSH 解析失败**静默 skip 整个插件**。
    // 扫描壳入口 + 发布包全发布面文件首 3 字节；UTF-8 BOM = EF BB BF。
    const surfaces = [
      'package.json', 'client.js', 'host.js', 'README.md',
      path.join('packages', 'dsh-notes-plugin', 'package.json'),
      path.join('packages', 'dsh-notes-plugin', 'index.mjs'),
      path.join('packages', 'dsh-notes-plugin', 'app.html'),
      path.join('packages', 'dsh-notes-plugin', 'README.md'),
      path.join('packages', 'dsh-notes-plugin', 'cordis.patch.yml'),
      path.join('packages', 'dsh-notes-plugin', 'lib', 'client.js'),
      path.join('packages', 'dsh-notes-plugin', 'lib', 'styles.css'),
    ]
    for (const rel of surfaces) {
      const buf = fsNative.readFileSync(path.join(DIR, rel))
      assert(!(buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf), rel + ' 带 UTF-8 BOM（EF BB BF）——会让 DSH 静默 skip 插件，须去除')
    }
  })
  await t('CSS 外置', () => {
    const cssPath = SRC_STYLES
    assert(fsNative.existsSync(cssPath), 'styles.css 存在')
    const cssContent = fsNative.readFileSync(cssPath, 'utf8')
    assert(cssContent.indexOf('.dsh-nt[data-tooltip]::after') >= 0, 'css 含作用域 tooltip')
    assert(cssContent.indexOf('.dsh-notes-capture-input') < 0, 'css 已移除速记输入（新建笔记 modal 替代）')
    assert(cssContent.indexOf('.dsh-notes-settings-modal') >= 0, 'css 含设置卡片')
    assert(clientSrc.indexOf('notes-css') >= 0, 'client 通过 RPC 取 css')
    assert(clientSrc.indexOf('styles.insert(') >= 0, 'client 注入 styles')
  })
  await t('token 语义映射 bg-layer 系 + 鲜蓝强调（开发版/发布包/原型/app.html 四处同步）', () => {
    const cssDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    const MAP = [
      ['--npanel:var(--dsw-alias-bg-layer-1', 'npanel → bg-layer-1（一级层面）'],
      ['--nbg:var(--dsw-alias-bg-base', 'nbg → bg-base（页面底）'],
      ['--nbg-raise:var(--dsw-alias-bg-layer-2', 'nbg-raise → bg-layer-2（二级层面）'],
      ['--nbg-hover:var(--dsw-alias-interactive-bg-hover', 'nbg-hover → interactive-bg-hover（官方交互色）'],
      ['--nbd:var(--dsw-alias-border-l2', 'nbd → border-l2'],
      ['--nbd-soft:var(--dsw-alias-border-l3', 'nbd-soft → border-l3'],
      ['--nt3:var(--dsw-alias-label-tertiary', 'nt3 → label-tertiary'],
      ['--nacc:var(--dsw-alias-state-business-primary', 'nacc → state-business-primary（鲜蓝，亮 #4176e6 / 暗 #7aaaff）'],
    ]
    for (const [css, tag] of [[cssDev, 'styles.css'], [cssPkg, '发布包 lib/styles.css']]) {
      for (const [needle, label] of MAP) assert(css.indexOf(needle) >= 0, tag + ' 缺映射：' + label)
      assert(css.indexOf('--dsw-alias-bg-overlay') < 0, tag + ' 不得再引用 bg-overlay（暗色解析为中灰 #61666b 导致整板发灰）')
      assert(css.indexOf('--dsw-alias-brand-primary') < 0, tag + ' 不得再引用 brand-primary（中性色 #0f1115/#f9fafb，非强调蓝）')
      assert(css.indexOf('body:not([data-ds-dark-theme])') >= 0, tag + ' color-mix 层次派生须仅作用亮色（暗色三层 token 本身即正确层次）')
    }
    // 原型与 app.html 色板 = DSH 实机解析值（暗色 bluish 系 + 鲜蓝强调），两文件色板块逐字节一致（UI 同步硬性约定）
    const proto = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    const app = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const grab = (s) => (s.match(/html\[data-theme="(?:dark|light)"\]\{[^}]*\}/g) || []).join('\n')
    assert(grab(proto).length > 0 && grab(proto) === grab(app), '原型与 app.html 色板逐字节一致')
    for (const v of ['--nbg:#151517', '--npanel:#232324', '--nbg-raise:#2c2c2e', '--nbg-hover:#ffffff14', '--nbg-sel:rgba(122,170,255,.14)', '--ntx:#f9fafb', '--nt2:#cfd3d6', '--nt3:#adb2b8', '--nbd:#ffffff1f', '--nbd-soft:#ffffff29', '--nacc:#7aaaff', '--nacc-tx:#96bcfe']) {
      assert(proto.indexOf(v) >= 0, '原型暗色色板缺 DSH 实机值：' + v)
    }
    for (const v of ['--nbg:#f1f1f1', '--npanel:#ffffff', '--nbg-raise:#f5f5f6', '--nbg-hover:#2631480f', '--nbg-sel:rgba(65,118,230,.14)', '--ntx:#0f1115', '--nt2:#61666b', '--nt3:#81858c', '--nbd:#0000001a', '--nbd-soft:#0000001f', '--nacc:#4176e6', '--nacc-tx:#3660b8']) {
      assert(proto.indexOf(v) >= 0, '原型亮色色板缺 DSH 实机值：' + v)
    }
  })
  await t('T1.1 工具瘦身 9→3', () => {
    const m = hostSrc.match(/regTool\(\{\s*name:\s*'([^']+)'/g) || []
    const names = m.map(s => s.match(/'([^']+)'/)[1])
    assert.deepStrictEqual(names.sort(), ['note_get', 'note_manage', 'note_search'], '已注册工具必须是 3 个：note_get / note_manage / note_search（实得：' + JSON.stringify(names) + '）')
  })
  }
}
