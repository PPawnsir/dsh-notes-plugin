// 节 25. 双模式编辑器 v3 双端落地（三端同步 + 结构 + 图片契约 + 原型回写）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "25",
  title: "25. 双模式编辑器 v3 双端落地（三端同步 + 结构 + 图片契约 + 原型回写）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { clientPkgSrc, g, grabKernelBlock, plugin } = S
  // ===== 25. 双模式编辑器 v3 双端落地（三端内核同步 + 面板/app.html 结构 + 图片上传契约 + 原型回写）=====
  // 规格来源：design/notes-editor-v3.html（用户已确认）；内核行为级断言（往返/XSS/降级）在 19 节，本节锁双端落地与契约
  section('25. 双模式编辑器 v3 双端落地（三端同步 + 结构 + 图片契约 + 原型回写）')
  const v3AppSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
  await t('内核三端字节一致（client-impl.js / app.html / 发布包 lib/client.js，去公共缩进比较）', () => {
    const norm = (s) => { const lines = s.split('\n'); const indents = lines.filter(l => l.trim()).map(l => l.match(/^[ \t]*/)[0].length); const min = Math.min.apply(null, indents); return lines.map(l => l.slice(min)).join('\n') }
    const kc = norm(grabKernelBlock(clientSrc, 'client-impl.js'))
    const ka = norm(grabKernelBlock(v3AppSrc, 'app.html'))
    const kp = norm(grabKernelBlock(clientPkgSrc, 'lib/client.js'))
    assert(kc === ka, 'client-impl.js 与 app.html 内核不一致（需手动同步标记区间）')
    assert(kc === kp, 'client-impl.js 与发布包 lib/client.js 内核不一致（需跑 scripts/build-dist.cjs）')
  })
  await t('面板双模式结构（开发版+发布包）：modeseg 两段开关 + Ctrl+/ + 富文本非受控 + 900ms 防抖 + 降级置灰 + IME 保护', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const label = pair[0], src = pair[1]
      assert(src.indexOf('dsh-notes-modeseg') >= 0 && src.indexOf('dsh-notes-modeseg-seg') >= 0, label + ' modeseg 两段开关')
      assert(src.indexOf("switchMode('rich')") >= 0 && src.indexOf("switchMode('source')") >= 0, label + ' 双向切换')
      assert(src.indexOf("ev.key === '/'") >= 0 && src.indexOf('switchModeRef.current') >= 0, label + ' Ctrl+/ 快捷键（经 ref 调最新 switchMode）')
      assert(src.indexOf('contentEditable: true') >= 0 && src.indexOf('suppressContentEditableWarning') >= 0, label + ' 富文本 contenteditable 非受控（编辑期间不重渲染）')
      assert(src.indexOf('renderMarkdown(edBodyRef.current, wikiResolve)') >= 0, label + ' 进富文本渲染内核产物（P2 起带双链 resolver 第二参）')
      assert(src.indexOf('serializeRich(el)') >= 0 && src.indexOf("syncFromRich('失焦')") >= 0 && src.indexOf("syncFromRich('切换模式')") >= 0, label + ' 失焦/切换模式序列化回源码')
      assert(src.indexOf('scheduleRichSync') >= 0 && src.indexOf('900') >= 0, label + ' 900ms 防抖序列化')
      assert(src.indexOf('analyzeMarkdown(edBodyRef.current)') >= 0 && src.indexOf('含高级语法') >= 0 && src.indexOf('请在源码模式编辑') >= 0, label + ' 降级拦截 + toast')
      assert(src.indexOf('compositionstart') >= 0 && src.indexOf('compositionend') >= 0, label + ' IME 组合输入保护')
      assert(src.indexOf('dsh-notes-preview-toggle') < 0 && src.indexOf('previewMode') < 0, label + ' 旧预览双态已移除（v3 替代）')
    }
  })
  await t('面板图片三入口契约：粘贴/拖拽/按钮 → 弹窗 → notes-asset-upload {name,data,mime} → 光标处插入 ![](assets/…)', () => {
    // 入口：富文本粘贴 + 富文本拖拽 + 源码 textarea 粘贴/拖拽 + 弹窗文件选择 + 工具栏按钮（openImgModal）
    assert((clientSrc.match(/pickImageFile\(/g) || []).length >= 5, 'pickImageFile 调用点 ≥5（双模式粘贴/拖拽 + 弹窗文件选择；实得 ' + (clientSrc.match(/pickImageFile\(/g) || []).length + '）')
    assert(clientSrc.indexOf("toolbarAction('image')") >= 0 && clientSrc.indexOf("'data-a': 'image'") >= 0, '工具栏图片按钮')
    assert(clientSrc.indexOf("host.call('notes-asset-upload', { name: m.name, data: m.dataURL, mime: m.mime })") >= 0, '上传 RPC payload 形态 {name, data(dataURL), mime}')
    assert(clientPkgSrc.indexOf("rpc('notes-asset-upload', { name: m.name, data: m.dataURL, mime: m.mime })") >= 0, '发布包上传 RPC（build-dist 转换后）')
    // 客户端前置校验与 host 口径一致：mime 白名单 + 5MB
    assert(clientSrc.indexOf("'image/png': 1, 'image/jpeg': 1, 'image/gif': 1, 'image/webp': 1") >= 0 && clientSrc.indexOf('5 * 1024 * 1024') >= 0, 'mime 白名单 + 5MB 前置校验')
    assert(clientSrc.indexOf('图片上传失败') >= 0 && clientSrc.indexOf('uploading') >= 0, '上传中/失败反馈')
    // 插入：源码插 Markdown 文本 / 富文本插 img 节点（data-md-src 记原始路径）
    assert(clientSrc.indexOf("'![' + alt + '](' + mdSrc + ')'") >= 0, '源码模式插入 Markdown 图片语法')
    assert(clientSrc.indexOf("img.setAttribute('data-md-src', mdSrc)") >= 0, '富文本 img 节点 data-md-src 记路径')
    assert(clientSrc.indexOf("syncFromRich('插入图片')") >= 0, '富文本插入后立即序列化回源码')
  })
  await t('app.html 双模式结构：modeseg/rtb/rich/src/deg + 三入口 + 上传契约 + Ctrl+/ + 速记卡排除', () => {
    for (const k of ['id="modeSeg"', 'id="segRich"', 'id="rtb"', 'id="edRich"', 'id="edSrc"', 'id="degBanner"', 'class="src"', 'rich-scroll rich-wrap', 'data-a="image"', 'id="richTip"']) {
      assert(v3AppSrc.indexOf(k) >= 0, 'app.html 缺结构：' + k)
    }
    assert(v3AppSrc.indexOf("ev.key === '/'") >= 0 && v3AppSrc.indexOf("switchMode(edMode === 'source' ? 'rich' : 'source')") >= 0, 'Ctrl+/ 切换')
    assert(v3AppSrc.indexOf("rpc('notes-asset-upload', { name: imgDraft.name, data: imgDraft.dataURL, mime: imgDraft.mime })") >= 0, '上传 RPC payload（页面走 fetch /dsh-notes）')
    assert(v3AppSrc.indexOf("'![' + alt + '](' + mdSrc + ')'") >= 0 && v3AppSrc.indexOf("img.setAttribute('data-md-src', mdSrc)") >= 0, '双模式插入形态')
    assert(v3AppSrc.indexOf('serializeRich(rich)') >= 0 && v3AppSrc.indexOf("syncFromRich('失焦')") >= 0, '富文本序列化回源码')
    assert(v3AppSrc.indexOf('analyzeMarkdown(edNote.body') >= 0, '降级分析接线')
    assert(v3AppSrc.indexOf('setTimeout(function () { if (richDirty) syncFromRich(') >= 0 && v3AppSrc.indexOf('}, 900)') >= 0, '900ms 防抖')
    assert(v3AppSrc.indexOf('.tipwrap.deg:hover .tip') >= 0, '降级 tooltip（原型 .tipwrap.deg 浮层）')
    assert(v3AppSrc.indexOf('input,textarea,select,.modal,.ctxmenu,.rich,.rtb') >= 0, '速记卡排除富文本划选')
    assert(v3AppSrc.indexOf('仅支持 PNG/JPEG/GIF/WebP 图片') >= 0 && v3AppSrc.indexOf('5 * 1024 * 1024') >= 0, '客户端 mime/5MB 前置校验')
  })
  await t('资产显示契约：assetDisplaySrc 走 GET /dsh-notes/asset?file= 路由（三端）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc], ['app.html', v3AppSrc]]) {
      assert(pair[1].indexOf("'/dsh-notes/asset?file=' + encodeURIComponent(mdSrc)") >= 0, pair[0] + ' assetDisplaySrc 路由形态')
    }
  })
  await t('styles.css 双模式样式 + 发布包 lib/styles.css 逐字节同步 + 旧预览样式移除', () => {
    const cssDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev], ['发布包 lib/styles.css', cssPkg]]) {
      for (const cls of ['.dsh-notes-modeseg{', '.dsh-notes-modeseg-seg{', '.dsh-notes-modeseg-seg.dis{', '.dsh-notes-deg{', '.dsh-notes-rtb{', '.dsh-notes-rtb-btn{', '.dsh-notes-rich{', '.dsh-notes-rich img{', '.dsh-notes-rich-wrap.drop', '.dsh-notes-imgup-zone{', '.dsh-notes-imgup-prog{', '.dsh-notes-rich table.dsh-notes-table{', '.dsh-notes-rich table.dsh-notes-table th']) {
        assert(pair[1].indexOf(cls) >= 0, pair[0] + ' 缺双模式样式：' + cls)
      }
      assert(pair[1].indexOf('--nok') >= 0, pair[0] + ' --nok 同步态绿点 token')
      assert(pair[1].indexOf('dsh-notes-preview-container') < 0 && pair[1].indexOf('dsh-notes-preview-toggle') < 0, pair[0] + ' 旧预览样式已移除')
    }
    assert.strictEqual(cssDev.replace(/\r\n/g, '\n'), cssPkg.replace(/\r\n/g, '\n'), 'styles.css 与发布包 lib/styles.css 逐字节一致（需跑 scripts/build-dist.cjs）')
  })
  await t('原型回写同步（design/notes-editor-v3.html）：assets/ 前缀守卫 + 900ms 防抖 + 真实契约注释 + 源码模式图片入口', () => {
    const protoV3 = fsNative.readFileSync(path.join(DIR, 'design', 'notes-editor-v3.html'), 'utf8')
    assert(protoV3.indexOf('if(!/^assets\\/[^\\s?#]+$/.test(isrc))return m') >= 0, '原型渲染器图片 assets/ 前缀守卫已回写')
    assert(protoV3.indexOf("syncFromRich('防抖')},900)") >= 0, '原型防抖 900ms 已回写（与 doSave 同档）')
    assert(protoV3.indexOf('notes-asset-upload') >= 0 && protoV3.indexOf('/dsh-notes/asset?file=assets/xxx') >= 0, '原型头部注释含真实上传/显示契约')
    assert(protoV3.indexOf("$('srcTa').addEventListener('paste'") >= 0 && protoV3.indexOf("$('srcTa').addEventListener('drop'") >= 0, '原型源码模式粘贴/拖拽图片入口已回写')
    assert(protoV3.indexOf('selftest=1') >= 0 && protoV3.indexOf('roundtripCheck') >= 0, '原型自测钩子保留')
    // L1 门禁放宽回写：DEG_RULES 移除「行内 HTML」、新增多行 HTML 块判定 + 场景 B 降级示例改含多行 HTML 块 + 自测覆盖
    assert(protoV3.indexOf('HTML_BLOCK_LINE') >= 0 && protoV3.indexOf('多行 HTML 块') >= 0, '原型多行 HTML 块降级规则已回写')
    assert(protoV3.indexOf("label:'行内 HTML'") < 0, '原型黑名单已移除「行内 HTML」')
    assert(protoV3.indexOf('<div class="legacy">\\n<span>旧系统拷贝的标记</span>\\n</div>') >= 0, '原型场景 B 含多行 HTML 块降级示例')
    assert(protoV3.indexOf('行内 HTML 字面量逐字往返') >= 0 && protoV3.indexOf('多行 HTML 块仍降级') >= 0, '原型自测含 L1 用例')
    // L2 门禁放宽回写：黑名单移除「表格」+ 只读渲染（dsh-notes-table/contenteditable=false/data-md-src）+ 场景 A 表格样本 + 点击提示 + 样式 + 自测覆盖
    assert(protoV3.indexOf("key:'table'") < 0 && protoV3.indexOf("label:'表格'") < 0, '原型黑名单已移除「表格」（L2）')
    assert(protoV3.indexOf('splitTblRow') >= 0 && protoV3.indexOf('parseTblDelims') >= 0 && protoV3.indexOf('isTblStart') >= 0, '原型表格解析三件套已回写')
    assert(protoV3.indexOf('<table class="dsh-notes-table" contenteditable="false" data-md-src="') >= 0, '原型表格只读渲染形态已回写')
    assert(protoV3.indexOf('| 版本 | 日期 | 状态 |') >= 0, '原型场景 A 含表格样本（L2 正常流演示）')
    assert(protoV3.indexOf('表格为只读，请切换源码模式编辑该区域') >= 0, '原型只读表格点击提示已回写')
    assert(protoV3.indexOf('.rich table.dsh-notes-table{') >= 0, '原型表格只读样式已回写')
    assert(protoV3.indexOf('L2 表格 round-trip 逐字一致') >= 0 && protoV3.indexOf('L2 表格不再降级') >= 0, '原型自测含 L2 用例')
  })
  await t('L2 表格只读交互：点击表格区块 toast 提示 + 黑名单移除（面板双端 + app.html）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      assert(pair[1].indexOf("ev.target.closest('table.dsh-notes-table')") >= 0, pair[0] + ' 富文本表格点击委托')
      assert(pair[1].indexOf('表格为只读，请切换源码模式编辑该区域') >= 0, pair[0] + ' 只读 toast 文案')
      assert(pair[1].indexOf("{ key: 'table', label: '表格'") < 0, pair[0] + ' 降级黑名单已移除表格（L2）')
    }
    assert(v3AppSrc.indexOf("ev.target.closest('table.dsh-notes-table')") >= 0 && v3AppSrc.indexOf('表格为只读，请切换源码模式编辑该区域') >= 0, 'app.html 表格点击 toast')
    assert(v3AppSrc.indexOf("{ key: 'table', label: '表格'") < 0, 'app.html 黑名单已移除表格')
    assert(v3AppSrc.indexOf('.rich table.dsh-notes-table{') >= 0, 'app.html 表格只读样式')
  })
  await t('速记卡片排除富文本划选（面板 + 发布包；选区归编辑器工具栏）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      assert(pair[1].indexOf("'.dsh-notes-rich, .dsh-notes-rtb'") >= 0, pair[0] + ' 速记卡 inRichEditor 排除')
    }
  })
  }
}
