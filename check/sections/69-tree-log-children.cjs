// 节 69. 树展开「含日志的文件夹」懒加载日志子条目（notes-041c-tree-log-children）
// 语义：R-6 豁免面 = 「用户主动展开日志夹」这一动作——定向 includeLogs 拉取，日志以 overlay 形式并入树子节点
//（不并入 notes 主缓存：默认列表/搜索/目录隐身不变）；foldLogLoaded 按夹去重——折叠再展开不重复拉取；
// 日志行带 📝 隐身标记；文件夹视图/筛选「日志」勾选口径不动；三端（app / client / 原型）同构。
module.exports = {
  id: "69",
  title: "69. 树展开日志夹懒加载日志子条目（overlay 并入 + 按夹去重 + R-6 豁免面收敛 + 三端同步，notes-041c-tree-log-children）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR } = H
  section('69. 树展开日志夹懒加载日志子条目（notes-041c-tree-log-children）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const appTree = read(path.join('src', 'app', 'panels', 'tree.js'))
  const appData = read(path.join('src', 'app', 'kernel', 'data.js'))
  const cliMenu = read(path.join('src', 'client', 'popovers', 'folder-menu.js'))
  const cliTree = read(path.join('src', 'client', 'panels', 'panel', 'tree.js'))
  const proto = read(path.join('design', 'notes-ui-v2.html'))
  const overlayBlock = (src, tag) => {
    const i = src.indexOf('if (open && foldLogLoaded[f.id] && logOverlay.length)')
    assert(i >= 0, tag + ' overlay 并入块在位')
    const j = src.indexOf('if (open && foldLogLoaded[f.id] && logOverlay.length) {', i)
    const k = src.indexOf('\n  }', j)
    return src.slice(j, k + 4)
  }

  // ===== ① app 端：展开动作触发 + 定向 includeLogs + overlay 不污染主缓存 + 按夹去重 =====
  await t('树日志懒加载 app：展开动作触发 ensureFoldLogs + 定向 includeLogs + 按夹去重', () => {
    assert(appTree.indexOf('function ensureFoldLogs(fid)') >= 0, 'app ensureFoldLogs 定义在位')
    assert(appTree.indexOf("var opening = foldOpen[fid2] === false;") >= 0 && appTree.indexOf('if (opening) ensureFoldLogs(fid2)') >= 0, 'app 仅展开动作触发（折叠不动作）')
    assert(appTree.indexOf("rpc('notes-list', { includeLogs: true })") >= 0, 'app 定向 includeLogs 重拉')
    assert(appTree.indexOf("if (foldLogLoaded[fid]) return;") >= 0, 'app 按夹去重（折叠再展开不重复拉取）')
    assert(appTree.indexOf("if (notes.some(function (n) { return (n.kind || 'note') === 'log' })) return;") >= 0, 'app 列表已是 includeLogs 口径零请求')
    /* R-6 红线：overlay 只进树渲染，不并入 notes 主缓存（ensureFoldLogs 内不得出现 notes = 赋值） */
    const ef = appTree.slice(appTree.indexOf('function ensureFoldLogs(fid)'), appTree.indexOf('function noteRow'))
    assert(ef.indexOf('notes =') < 0, 'app overlay 不并入 notes 主缓存（默认列表隐身不变）')
    assert(appData.indexOf("view.type === 'folder'") >= 0, 'app 文件夹视图 includeLogs 口径不动（wantLogsNow 原样）')
  })

  // ===== ② 行为级 eval：overlay 并入块（按夹过滤 + id 去重 + 追加尾部）=====
  await t('树日志懒加载 行为级：overlay 并入块 eval——按夹过滤 + id 去重 + 追加尾部', () => {
    const block = overlayBlock(appTree, 'app')
    function run(open, loaded, overlay, kids, fid) {
      const fn = new Function('open', 'foldLogLoaded', 'logOverlay', 'kids', 'f', block + '\nreturn kids')
      return fn(open, loaded, overlay, kids, { id: fid })
    }
    const k1 = run(true, { fA: true }, [{ id: 'l1', folder: 'fA', kind: 'log' }, { id: 'l2', folder: 'fB', kind: 'log' }], [{ id: 'n1', folder: 'fA' }], 'fA')
    assert.deepStrictEqual(k1.map((x) => x.id), ['n1', 'l1'], '本夹日志追加 + 别夹日志不串 + 顺序尾部')
    const k2 = run(true, { fA: true }, [{ id: 'n1', folder: 'fA', kind: 'log' }], [{ id: 'n1', folder: 'fA' }], 'fA')
    assert.deepStrictEqual(k2.map((x) => x.id), ['n1'], 'id 去重（文件夹视图已含日志行不双显）')
    const k3 = run(false, { fA: true }, [{ id: 'l1', folder: 'fA', kind: 'log' }], [], 'fA')
    assert.deepStrictEqual(k3, [], '折叠态不并入（展开语义才可见）')
    assert(overlayBlock(proto, '原型') === overlayBlock(appTree, 'app').replace(/\r/g, ''), '原型 overlay 并入块与 app 逐字一致')
  })

  // ===== ③ client 端：toggleFolder 展开触发 + overlay 状态链路 + 📝 标记 =====
  await t('树日志懒加载 client：toggleFolder 展开触发 + host.call includeLogs + 树消费 overlay + 📝 标记', () => {
    assert(cliMenu.indexOf('const [foldLogs, setFoldLogs] = React.useState([])') >= 0, 'client foldLogs overlay state 在位')
    assert(cliMenu.indexOf('function ensureFoldLogs(fid)') >= 0 && cliMenu.indexOf("host.call('notes-list', { includeLogs: true })") >= 0, 'client ensureFoldLogs 定向拉取')
    assert(cliMenu.indexOf('if (foldLogLoaded[fid]) return') >= 0, 'client 按夹去重')
    assert(cliMenu.indexOf('if (opening) ensureFoldLogs(id)') >= 0 && cliMenu.indexOf('const opening = !isFolderExpanded(id)') >= 0, 'client 仅展开动作触发')
    assert(cliMenu.indexOf('foldLogs: foldLogs, foldLogLoaded: foldLogLoaded, ensureFoldLogs: ensureFoldLogs') >= 0, 'client hook 出参导出')
    assert(cliTree.indexOf('const foldLogs = args.foldLogs || [], foldLogLoaded = args.foldLogLoaded || {}') >= 0, 'client tree hook 入参接入')
    assert(cliTree.indexOf("foldLogs.filter(n => (n.folder || '') === f.id && !have[n.id])") >= 0, 'client overlay 并入（按夹过滤 + id 去重）')
    assert(cliTree.indexOf("n.kind === 'log' ? e('span', { className: 'dsh-notes-logmark dsh-nt'") >= 0, 'client 日志行 log 隐身标记')
    const idx = read(path.join('src', 'client', 'panels', 'panel', 'index.js'))
    assert(idx.indexOf('foldLogs, foldLogLoaded } = usePanelFolderMenu') >= 0 && idx.indexOf('foldLogs: foldLogs, foldLogLoaded: foldLogLoaded })') >= 0, 'client 装配点接线（folder-menu → tree）')
  })

  // ===== ④ 原型同步 + 三端隐身标记 + i18n 键 =====
  await t('树日志懒加载 原型/标记/i18n：原型三件套同步 + log 隐身标记三端在位 + emoji 红线 + tree.logTip 双语字典', () => {
    assert(proto.indexOf('function ensureFoldLogs(fid)') >= 0 && proto.indexOf('if (opening) ensureFoldLogs(fid2)') >= 0, '原型 ensureFoldLogs + 展开触发同步')
    assert(appTree.indexOf("t('tree.logTip')") >= 0 && cliTree.indexOf("tt('tree.logTip')") >= 0, 'app/client 日志标记 tooltip 走 i18n')
    assert(appTree.indexOf("class=\"logmark\"") >= 0 && proto.indexOf("class=\"logmark\"") >= 0, 'app/原型 logmark 标记在位')
    assert(appTree.indexOf('>log</span>') >= 0 && proto.indexOf('>log</span>') >= 0 && cliTree.indexOf("}, 'log') : null,") >= 0, '三端日志标记为 log 文本徽章（面板 emoji 红线——不用 📝）')
    const zh = read(path.join('src', 'i18n', 'zh.js')), en = read(path.join('src', 'i18n', 'en.js'))
    assert(zh.indexOf("'tree.logTip'") >= 0 && en.indexOf("'tree.logTip'") >= 0, 'tree.logTip 双语字典键在位')
  })
  }
}
