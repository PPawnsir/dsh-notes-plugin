// 节 87. 0.4.5-B UX 打磨（notes-045-ux-polish；B/C 卡 verifier 残留两项收口）
// ①「→ new」生硬显示 → disp.schedNewTarget 人话文案「首轮自动创建专属会话」：
//   四展示点（app modals/inject-manager.js 调度任务区行 + app panels/editor-meta.js 计划块行 +
//   client modals/inject-manager.js 同位 + client panels/panel/editor.js 同位）+ 原型两处镜像（不双语红线：静态中文）；
//   首轮回写真实 sid 后自动恢复「→ 截短」显示（零迁移）；host 闸门/专属会话创建逻辑零改动（纯展示层）。
// ② 机器档（恰选 kinds=['sys']）混合夹 sysKids 惰性闸口径修正：主缓存 = 全库 sys（⑩ kind 通道），该夹直挂 sys 行
//   缓存已有且随 notes 换代恒新鲜——跳过条件只看缓存新鲜度，不再用 count 差值（混合夹 count 含普通笔记、visible 是
//   sys-only 缓存数，差值实为隐藏普通笔记数 → 误度量多发一次 notes-list {folder} 定向请求；且过滤激活时树合并层
//   不消费 sysKids，补拉恒为纯浪费）。缺省档惰性/缓存/防陈旧三红线与 ⑩ 传参语义零改动（80 节既有断言看守，本节补回归锚）。
// 测试策略：四端+原型+双产物静态锚；i18n 双语取值行为级；app schedPlanHtml eval 实证新/旧分支；app ensureSysKids
//   eval 打桩 rpc 计数（机器档混合夹零请求 + 缺省档补拉/普通夹零请求回归）；e2e 用例㉓ 真实 DOM + RPC 旁记收口。
module.exports = {
  id: "87",
  title: "87. 0.4.5-B UX 打磨（target='new' 新文案四展示点 + 机器档混合夹惰性闸修正）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('87. 0.4.5-B UX 打磨（target=new 新文案 + 机器档混合夹惰性闸）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const zhSrc = read(path.join('src', 'i18n', 'zh.js')), enSrc = read(path.join('src', 'i18n', 'en.js'))
  const appInjMgr = read(path.join('src', 'app', 'modals', 'inject-manager.js'))
  const appMeta = read(path.join('src', 'app', 'panels', 'editor-meta.js'))
  const cliInjMgr = read(path.join('src', 'client', 'modals', 'inject-manager.js'))
  const cliEditor = read(path.join('src', 'client', 'panels', 'panel', 'editor.js'))
  const cliMenu = read(path.join('src', 'client', 'popovers', 'folder-menu.js'))
  const appTree = read(path.join('src', 'app', 'panels', 'tree.js'))
  const protoSrc = read(path.join('design', 'notes-ui-v2.html'))
  const appPkg = read(path.join('packages', 'dsh-notes-plugin', 'app.html'))
  const cliPkg = read(path.join('packages', 'dsh-notes-plugin', 'lib', 'client.js'))
  const grabFn = (s, name, tag) => { const m = s.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}')); assert(m, tag + ' 缺 ' + name + '()'); return m && m[0] }

  // ===== ① 四展示点静态锚 + 原型镜像 + 双产物 + 既有截短口径不破 =====
  await t('target=new 新文案：四展示点分支锚 + 原型两处镜像 + 双产物同步 + 真实 sid 截短口径不破', () => {
    const APP_BRANCH = "(s.target === 'new' ? esc(t('disp.schedNewTarget')) : '→ ' + esc(shortSid(s.target)))"
    assert(appInjMgr.indexOf(APP_BRANCH) >= 0, 'app inject-manager 调度任务区行 target=new 新文案分支')
    assert(appMeta.indexOf(APP_BRANCH) >= 0, 'app editor-meta 计划块行 target=new 新文案分支')
    assert(cliInjMgr.indexOf("s.target === 'new' ? tt('disp.schedNewTarget') : '→ ' + shortSid(s.target)") >= 0, 'client inject-manager 调度任务区行 target=new 新文案分支')
    assert(cliEditor.indexOf("curNote.schedule.target === 'new' ? tt('disp.schedNewTarget') : '→ ' + shortSid(curNote.schedule.target)") >= 0, 'client editor 计划块行 target=new 新文案分支')
    // 原型镜像（不双语红线：静态中文文案；调度任务区 + 计划块两处）
    const protoHits = protoSrc.match(/s\.target === 'new' \? '首轮自动创建专属会话' : '→ ' \+ esc\(shortSid\(s\.target\)\)/g) || []
    assert.strictEqual(protoHits.length, 2, '原型两处镜像（实得 ' + protoHits.length + '）')
    // 双产物同步（需先跑 build-dist）
    assert(appPkg.indexOf(APP_BRANCH) >= 0, 'app.html 产物含新文案分支（需先跑 build-dist）')
    assert(cliPkg.indexOf("tt('disp.schedNewTarget')") >= 0 && cliPkg.indexOf("s.target === 'new' ? ") >= 0, 'lib/client.js 产物含新文案分支（需先跑 build-dist）')
    // 既有口径不破：真实 sid 仍截短显示（52 节锚点同源复查）+ tooltip 仍携原始 target 机器值
    assert(appMeta.indexOf('shortSid(s.target)') >= 0 && cliEditor.indexOf('shortSid(curNote.schedule.target)') >= 0, '真实 sid 截短显示保留（首轮回写后自动恢复）')
    assert(appInjMgr.indexOf("title=\"' + esc(s.target || '') + '\"") >= 0 && cliInjMgr.indexOf("'data-tooltip': s.target || ''") >= 0, 'tooltip 携原始 target 机器值不动')
  })

  // ===== ② i18n 双语新键 + app schedPlanHtml 行为级（新分支人话 / 旧分支不变）=====
  await t('disp.schedNewTarget 双语在案 + 行为级：target=new 出人话文案、真实 sid 出「→ 截短」', () => {
    const grab = (s, v) => new Function(s + '\nreturn ' + v)()
    const zh = grab(zhSrc, 'I18N_ZH'), en = grab(enSrc, 'I18N_EN')
    assert.strictEqual(zh['disp.schedNewTarget'], '首轮自动创建专属会话', 'zh 新键文案锚定')
    assert.strictEqual(en['disp.schedNewTarget'], 'Auto-created dedicated session on first fire', 'en 新键文案锚定')
    // 行为级 eval（同 52.3 口径：zh 字典 + t() 桩 + 依赖打桩，提取发布包 app.html 的 schedPlanHtml 真码）
    const ns = {}
    new Function('ns',
      zhSrc + '\nfunction t(k, vars){ var s = I18N_ZH[k]; if (s == null) return k; if (vars) s = s.replace(/\\{(\\w+)\\}/g, function (m, n) { return vars[n] != null ? String(vars[n]) : m }); return s }\n'
      + 'function esc(s){return String(s==null?"":s)}\nfunction icon(){return ""}\nfunction shortSid(s){return String(s||"").slice(0,8)}\n'
      + 'function schedFreqLabel(){return "每天 09:00"}\nfunction schedNextLabel(){return "下次 2026-10-05 09:00"}\nfunction schedBadgeHtml(){return \'<span class="sched-badge">未触发</span>\'}\n'
      + grabFn(appPkg, 'schedPeerKey', 'app.html') + '\n' + grabFn(appPkg, 'relatedScheds', 'app.html') + '\n' + grabFn(appPkg, 'schedPlanHtml', 'app.html')
      + '\nns.schedPlanHtml = schedPlanHtml')(ns)
    const hNew = ns.schedPlanHtml({ id: 'n-s1', title: '定时 巡检', contractType: 'dispatch-schedule', schedule: { every: '1d', anchor: '09:00', target: 'new' } }, [])
    assert(hNew.indexOf('首轮自动创建专属会话') >= 0, 'app 计划块 target=new → 人话文案渲染')
    assert(hNew.indexOf('→ new') < 0 && hNew.indexOf('→ 首轮') < 0, 'target=new 零「→」生硬残留')
    const hSid = ns.schedPlanHtml({ id: 'n-s2', title: '定时 巡检', contractType: 'dispatch-schedule', schedule: { every: '1d', anchor: '09:00', target: 'session-abc' } }, [])
    assert(hSid.indexOf('→ ' + 'session-abc'.slice(0, 8)) >= 0, '真实 sid 仍「→ 截短」（零迁移：回写后自动恢复）')
    assert(hSid.indexOf('首轮自动创建专属会话') < 0, '真实 sid 不显示新文案（分支互斥）')
  })

  // ===== ③ 机器档惰性闸静态锚：双端跳过分支 + 缺省档 count 差值闸原样 =====
  await t('机器档惰性闸静态锚：双端缓存新鲜度跳过分支 + 缺省档 count 差值闸/新鲜缓存/在途闸原样', () => {
    assert(cliMenu.indexOf("const machineOnly = kf.length === 1 && kf[0] === 'sys'") >= 0, 'client folder-menu.js machineOnly 判定（恰选 sys 单档 = ⑩ kind 通道口径）')
    assert(cliMenu.indexOf('if (machineOnly) continue') >= 0, 'client folder-menu.js 机器档跳过分支（不再用 count 差值）')
    assert(appTree.indexOf("if (filters.kinds.length === 1 && filters.kinds[0] === 'sys') return") >= 0, 'app tree.js ensureSysKids 机器档跳过分支（同口径）')
    // 缺省档三红线原样保留（80 节锚点同口径复查）：count 差值惰性闸 + 新鲜缓存短路 + 在途去重
    assert(cliMenu.indexOf('if ((f.count || 0) - visible <= 0) continue') >= 0 && cliMenu.indexOf('if (ent && ent.stamp === notes) continue') >= 0, 'client 缺省档惰性闸 + 新鲜缓存短路原样')
    assert(appTree.indexOf('if (folderSysHidden(fid) <= 0) return') >= 0 && appTree.indexOf('if (ent && ent.stamp === notes) return') >= 0 && appTree.indexOf('if (sysKidsInflight[fid]) return') >= 0, 'app 缺省档惰性/缓存/在途三闸原样')
    // 跳过分支序位：机器档跳过必须在 count 差值闸之前（否则混合夹仍误度量）
    assert(cliMenu.indexOf('if (machineOnly) continue') < cliMenu.indexOf('if ((f.count || 0) - visible <= 0) continue'), 'client 机器档跳过先于 count 差值闸')
    assert(appTree.indexOf("filters.kinds[0] === 'sys') return") < appTree.indexOf('if (folderSysHidden(fid) <= 0) return'), 'app 机器档跳过先于 count 差值闸')
    // 产物同步
    assert(cliPkg.indexOf('if (machineOnly) continue') >= 0, 'lib/client.js 产物同步（需先跑 build-dist）')
    assert(appPkg.indexOf("if (filters.kinds.length === 1 && filters.kinds[0] === 'sys') return") >= 0, 'app.html 产物同步（需先跑 build-dist）')
  })

  // ===== ④ 行为级 eval：app ensureSysKids RPC 计数（机器档混合夹零请求 + 缺省档回归）=====
  await t('机器档混合夹零定向请求（RPC 计数断言）+ 缺省档补拉/普通夹零请求回归（eval ensureSysKids 打桩计数）', async () => {
    const mH = appTree.match(/function folderSysHidden\(fid\) \{([\s\S]*?)\n\}/)
    const mE = appTree.match(/function ensureSysKids\(fid\) \{([\s\S]*?)\n\}/)
    assert(mH && mE, '提取 app folderSysHidden/ensureSysKids 失败（结构变更需同步本断言）')
    function mkWorld(filters, notes, folders) {
      const calls = { rpc: 0, rpcArgs: [] }
      const target = {
        filters: filters,
        folders: folders,
        notes: notes,
        sysKids: {}, sysKidsInflight: {},
        folderSubtree: function (id) { var o = {}; o[id] = true; return o },
        renderTree: function () {},
        rpc: function (m2, a) { calls.rpc++; calls.rpcArgs.push(a); return Promise.resolve({ notes: [] }) },
      }
      const proxy = new Proxy(target, {
        has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
        get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
        set(t2, k, v) { t2[k] = v; return true }
      })
      const fns = new Function('scope', 'with (scope) {\n' + ('function folderSysHidden(fid) {' + mH[1] + '\n}\n') + ('function ensureSysKids(fid) {' + mE[1] + '\n}\n') + '\nreturn { ensureSysKids: ensureSysKids }\n}')(proxy)
      return { target, calls, fns }
    }
    // 机器档 + 混合夹：count=2（1 sys + 1 普通），缓存可见=sys-only 1 ——旧口径差值 1 误发请求；新口径零请求
    const wM = mkWorld(
      { kinds: ['sys'] },
      [{ id: 's1', kind: 'sys', folder: 'fMix' }],
      [{ id: 'fMix', name: '混合夹', parent: '', count: 2 }])
    wM.fns.ensureSysKids('fMix')
    assert.strictEqual(wM.calls.rpc, 0, '机器档混合夹展开零 {folder} 定向请求（count 差值不再误度量）')
    // 机器档 + 纯 sys 夹：同零请求（主缓存已全量；⑯ 档内语义不变——行由主缓存直供渲染）
    const wS = mkWorld(
      { kinds: ['sys'] },
      [{ id: 's1', kind: 'sys', folder: 'fSys' }],
      [{ id: 'fSys', name: '机器夹', parent: '', count: 1 }])
    wS.fns.ensureSysKids('fSys')
    assert.strictEqual(wS.calls.rpc, 0, '机器档纯 sys 夹零请求（缓存已覆盖）')
    // 缺省档回归①：同混合夹 diff>0（藏 sys）→ 恰 1 次定向请求（惰性闸正常面不动）
    const wD = mkWorld(
      { kinds: [] },
      [{ id: 'n1', kind: 'note', folder: 'fMix' }],
      [{ id: 'fMix', name: '混合夹', parent: '', count: 2 }])
    wD.fns.ensureSysKids('fMix')
    assert.strictEqual(wD.calls.rpc, 1, '缺省档混合夹照常补拉恰 1 次（藏 sys 才发——0.4.4-C 惰性闸不回归）')
    assert(wD.calls.rpcArgs[0] && wD.calls.rpcArgs[0].folder === 'fMix', '缺省档补拉定向 {folder:fMix} 形态不变（⑩ 传参语义不动）')
    // 缺省档回归②：普通夹（count==可见数）零请求
    const wN = mkWorld(
      { kinds: [] },
      [{ id: 'n1', kind: 'note', folder: 'fNorm' }],
      [{ id: 'fNorm', name: '普通夹', parent: '', count: 1 }])
    wN.fns.ensureSysKids('fNorm')
    assert.strictEqual(wN.calls.rpc, 0, '缺省档普通夹零请求不回归')
    // 缺省档回归③：恰选非 sys 单 kind 口径门原样跳过（⑩ 缓存不可比）
    const wK = mkWorld(
      { kinds: ['log'] },
      [{ id: 'n1', kind: 'log', folder: 'fMix' }],
      [{ id: 'fMix', name: '混合夹', parent: '', count: 2 }])
    wK.fns.ensureSysKids('fMix')
    assert.strictEqual(wK.calls.rpc, 0, '恰选非 sys 单 kind 档跳过不回归（⑩ 口径门）')
  })
  }
}
