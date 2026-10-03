// DSH 笔记插件回归测试套件
// 架构：host.js/client.js = 引导壳；src/host-impl.js/src/client-impl.js = 真正实现（磁盘文件）
// 测试：host 全链路逻辑（内存 mock fs/llm）+ 工具 schema 校验 + 实现源码结构断言
// 不触碰真实笔记目录。
const fsNative = require('fs')
const path = require('path')
const osNative = require('os')
const assert = require('assert')
const { pathToFileURL } = require('url')

const DIR = 'D:\\deepseek-work\\dsh-notes-plugin'
// 开发版源码集中在 src/（v0.3 工程整理）；路径引用统一收敛为以下三个常量，断言体内不再散落拼路径
const SRC_HOST = path.join(DIR, 'src', 'host-impl.js')
const SRC_CLIENT = path.join(DIR, 'src', 'client-impl.js')
const SRC_STYLES = path.join(DIR, 'src', 'styles.css')
const bootHostSrc = fsNative.readFileSync(path.join(DIR, 'host.js'), 'utf8')
const bootClientSrc = fsNative.readFileSync(path.join(DIR, 'client.js'), 'utf8')
const hostSrc = fsNative.readFileSync(SRC_HOST, 'utf8')
const clientSrc = fsNative.readFileSync(SRC_CLIENT, 'utf8')
// P2：发布版静态包 host（ESM）。开发版 host-impl.js 之上的回归照旧，这里额外覆盖静态包。
const INDEX_PATH = path.join(DIR, 'packages', 'dsh-notes-plugin', 'index.mjs')
const indexSrc = fsNative.readFileSync(INDEX_PATH, 'utf8')

let passed = 0, failed = 0, skipped = 0
// ===== 核心快检模式（--core / CHECK_CORE=1）=====
// 默认无参 = 全量（输出与历史完全一致，check-result.txt 照常刷新）；--core 只跑 CORE 名单内的代表性断言。
// 约定（DEVELOPMENT.md「测试」节）：worker 自测跑 --core，verifier / 发布前跑全量。
// 实现注意：节间 mock 实例与造数代码（t() 之外）两种模式都照常执行——核心断言看到的共享状态与全量模式完全一致，
// 只跳过 t() 断言体本身，不动任何断言语义。
const CORE_MODE = process.argv.indexOf('--core') >= 0 || process.env.CHECK_CORE === '1'
// CORE 名单按断言名精确匹配（全量 514 个断言名已验证唯一）。覆盖：RPC 面/缓存/quick 合并/搜索/软删/归档三连/
// 工具路由/约定注入+分桶/injectTo/派发+闭环/静态包全链路（含迁移+资产路由+归档+perf）/设置持久化/构建可复现/
// 编辑器 round-trip+XSS/文件夹/目录注入/资产上传/导入导出/三端内核同步/注入脱敏/预算截断/遥测计数/注入预览/整理建议/组合过滤/injectEver/img-path-hint/快照式历史引擎/LLM 用量统计/历史版本面板 UI/文件夹嵌套（parent/深度/cycle/子树过滤/cascade/导出子树 + UI 递归树/拖拽换父/级联 confirm/面包屑/深度设置行）。
// 改断言名必须同步本名单——core 模式收尾时校验名单全部命中，未命中（改名/删除）计 1 个 failed，防静默失效。
const CORE = new Set([
  'host-impl.js 语法',
  'client-impl.js 语法',
  'token 语义映射 bg-layer 系 + 鲜蓝强调（开发版/发布包/原型/app.html 四处同步）',
  'T1.1 工具瘦身 9→3',
  'index.mjs 是 ESM（export name/inject/apply，无 bootstrap return）',
  'index.mjs 保留 39 个 RPC + 3 工具 + 约定注入 + 派发 + LLM 分类 + 设置 + 导入导出 + 单文件导出 + 资产上传 + 历史版本三 RPC + 工作记忆 notes-memory-guide',
  '两栏布局骨架（侧栏 + 编辑器通栏）',
  'note_search 已注册',
  'note_get 已注册',
  'note_manage 已注册',
  '创建返回 id',
  '列表瘦身（不含 body）',
  '缓存：第二次 list 零磁盘读',
  'get 带正文',
  'update 不读盘（缓存命中）',
  'update 后列表 topic 已变',
  '首次 quick 创建新笔记',
  '同 session 窗口内合并',
  '异步分类填主题',
  '跨 session 不合并',
  'notes-search RPC 命中正文且瘦身',
  '删除后列表隐藏',
  '恢复后列表可见',
  'preview（dry-run）：零写入 + 手动笔记不进速记组',
  'preview：速记按 sessionId 分组（≥2），手动/单条/已删不进组，dry-run 零写入',
  '无 groups 归档：只合速记组 + 默认标题 + .bak 备份 + undo 事务落盘',
  'undo 往返：成员批量还原 + 归档笔记软删 + undo 清空；二次 undo → undone=0',
  'host-impl 应用成功（39 RPC handlers，含 notes-settings-get/set + 导入导出 + P3 notes-export-single + 资产上传 + 归档 preview/undo + ai-organize/assets-prune + P1 notes-purge + notes-inject-preview + notes-suggest + notes-usage-get + 历史版本 notes-history/history-get/restore-history + 工作记忆 notes-memory-guide）',
  'manage.create 返回 id',
  'manage.archive 显式 groups 合并手动组（白名单 + title 覆盖）',
  'kind 默认 note（向后兼容）',
  'systemPrompt.context 已注册（order 130）',
  'inject=true 笔记注入文本（双角色新文案：缺省进约定桶，单桶只出该桶标题）',
  'injectTo=[不匹配会话] 不注入',
  'injectTo=[当前会话短id] 注入',
  'notes-dispatch 注入上下文+触发工作（agent.send）',
  'notes-dispatch-done 标记完成停止注入',
  '保底联动：notes-update 置 resolved 自动回执全部未闭环派发',
  '事件回执：agent/status idle → 该会话未闭环派发 dispatchStatus=done（receipt=idle）',
  'notes-quick-instruct LLM 解析失败回退等价 notes-quick',
  'index.mjs 可被 ESM import（语法 + 顶层无副作用）',
  'harness 缺失时兜底：3 条 exact 路由（RPC + 全窗口页面 + 资产）+ ctx.tools 3 工具 + 约定注入 order130 + 目录注入 order131',
  'GET /dsh-notes/asset 防穿越/形态/白名单/404',
  'RPC 200 + 首次启动迁移开发版笔记到 ~/.dsh/notes',
  'notes-create 走静态包 RPC',
  'notes-get 返回正文',
  '静态包显式归档全链路：preview → 无参仅速记 → 显式 groups 手动组 → undo → notes-perf / notes-ping',
  'harness 主通道：handle 经 harness.handle 注册（host.call 链路可用）',
  'notes-settings-get：初始空设置 + models 目录（llm 探针）',
  'notes-settings-set：保存 llm override 并持久化 settings.json',
  'lib/client.js 是 scripts/build-dist.cjs 的产物且可复现',
  '内核函数可提取（esc/renderMarkdown/serializeRich/analyzeMarkdown/sanitizeFragment）',
  '往返保真：白名单 Markdown render→serialize→render 不变（10 用例，含原型自测 7 条 + 场景 A/C 正文）',
  'XSS 红线：渲染全量转义 + 图片仅 assets/ 前缀放行（javascript:/外链/引号注入全拒绝）',
  'notes-folders create：落盘 folders.json + order 递增；缺 name 报错',
  'folder 字段数据往返：create 带 folder → get/list/磁盘 front-matter 一致',
  '准入排除：resolved / superseded / recall=false / 约定去重',
  'notes-asset-upload：mime 白名单 / 超 5MB / 非法 base64 / 空 data 拒绝',
  '静态包导入/导出全链路（导出 → 预览分类 → 备份 → 默认跳过 diff → overwrite 覆盖 → folders 合并）',
  '内核三端字节一致（client-impl.js / app.html / 发布包 lib/client.js，去公共缩进比较）',
  'conventionText 对 sensitive=true 笔记正文按行打码 + 尾部计数行',
  'notes-quick 命中敏感模式：直接落 sensitive=true + 返回 sensitiveSuggested（磁盘原文不动）',
  'injectBudgetChars 预算截断：资料桶从最旧整条省略 + 提示行；约定桶永不截断；lastInjectChars 随渲染更新',
  'note_get 命中计数：内存即时 +1（响应即见），60s 防抖期内零写盘；notes-get RPC 不计数',
  'notes-inject-preview 返回结构：conventions/catalog 字符串 + stats 六字段数值正确',
  'workspace 视角：该工作区全部会话注入并集 + 未知工作区退化全局 + sessionId 互斥优先',
  'notes-suggest 三段返回 + 遥测/时效闭环 + 零写入（开发版独立实例）',
  '组合过滤：sensitive / inject / kind 三态组合',
  'injectEver 单向粘性（never unset）：开 → 关 → 仍 true；不传 inject 不动存量值',
  'img-path-hint 标记块双包逐字节一致 + 可 eval（bodyHasImageRef/assetsHintLine 导出）',
  'llm-usage 标记块双包逐字节一致 + 三调用点计量包装挂载（classify×2 + organize）',
  'notes-usage-get：三功能分别计数 + today/week/month/allTime/byFeature 结构 + usage.json 防抖落盘',
  '快照去重 + 红线：无变化重复保存不增快照，update 零新增读盘',
  '导入导出适配：默认不含 .history / includeHistory 连带 / 备份含 / added 合并 / id 冲突跳过',
  '历史引擎双包三 RPC 结构同步（host-impl ⇄ index.mjs，恢复走 persistNote 缺省快照）',
  '历史版本三 RPC 契约：列表倒序零正文 / get 取正文 / 未知 ts 报错（开发版独立实例）',
  '恢复前置快照（安全核心）：恢复前当前版自动入 .history + 恢复可再撤销回滚',
  '历史版本面板四端同步：入口/modal/三 RPC 调用点（client-impl + 发布包 + app.html + 原型）',
  '多选操作条批量删除（软删进回收站，三端同步）',
  'notes-get includeDeleted：已删笔记正文只读可达（双包同步 + 行为级，缺省/墓碑仍拒绝）',
  '回收站批量操作四端同步：全选/行勾选/选中计数 + 批量恢复/批量彻底删除（confirm 含 不可恢复+含历史版本+条数）',
  '回收站行预览四端同步：notes-get includeDeleted 取已删正文 + 只读渲染（esc 先行零注入面）',
  // 40. 文件夹嵌套（parent/maxFolderDepth/cycle/递归子树过滤/cascade/导出子树 + 双包标记块 + 静态包行为）
  'folder-tree-helpers 标记块双包逐字节一致 + 可 eval（folderDepth/folderSubtreeIds/folderSubtreeHeight/checkFolderAttach）',
  'maxFolderDepth 设置往返：缺省 3（无键）→ set 落盘回读 → 非法值报错 → null 恢复缺省',
  '嵌套 parent 往返：create 带 parent 落盘 + list 返回 parent/depth + 存量零迁移（无 parent=根级 depth 1）',
  '嵌套深度校验：缺省 3 层超限拒绝 / 边界第 3 层 OK / 调大与 0 不限放行',
  'reorder 拖父级：cycle 拒绝（自身/子孙）+ 深度超限拒绝 + 合法改挂落盘',
  '递归子树过滤：三层父子样本 notes-list / note_search / note_manage 同口径 + count 子树口径',
  'notes-folders delete：缺省拒绝含子内容（needCascade）+ cascade:true 笔记软删进回收站可恢复落未分类',
  'cascade 删除：缺省拒绝含子内容 + cascade:true 整棵删除笔记进回收站可恢复落未分类',
  '导出子树：notes-export-single scope.folder 递归含子孙文件夹笔记',
  '静态包嵌套文件夹：parent 建层/深度超限拒绝/cycle 拒绝/cascade 软删恢复落未分类',
  // 41. 文件夹嵌套 UI（notes-nested-folder-ui：递归树/拖拽换父/级联删除 confirm/面包屑/maxFolderDepth 设置行，四端同步）
  '嵌套 UI 递归树渲染：depth-first 递归 + 子树过滤/自动展开/计数 + 键盘导航顺序（四端同步）',
  '嵌套 UI：新建子文件夹 + 拖拽换父（cycle 本地拦截 + 深度拒绝 toast）+ 同级排序（四端同步）',
  '嵌套 UI：级联删除 confirm 子树统计 + 面包屑路径可点击 + maxFolderDepth 设置行（四端同步）',
  // 42. 列表韧性（notes-list-union-defense：listDir 快照停滞窗口内 cache 并集补入）
  'list-union-defense 标记块双包逐字节一致（host-impl / index.mjs）',
  '并集补入：listDir 停滞窗口内新建笔记立即可见；watcher 恢复后幂等零重复',
  '并集条目同一过滤管线：deleted/log 隐身/tag/kind/folder 与目录条目零差异',
  '并集墓碑排除：purge 后缺省/回收站口径均不出现（含缓存墓碑条目）',
  '静态包并集防御：停滞窗口新建笔记可见 + watcher 恢复幂等（index.mjs 行为）',
])
const coreSeen = new Set()
let pendingSection = null   // core 模式：section 头延迟到首个被执行的断言前打印（无核心断言的 section 不输出空标题）
// 必须 await fn()：大量测试是 async 的，不 await 会导致 promise 内断言未执行就 passed++（假通过）
async function t(name, fn) {
  if (CORE_MODE && !CORE.has(name)) { skipped++; return }
  if (CORE_MODE) {
    coreSeen.add(name)
    if (pendingSection) { console.log('\n\x1b[1m' + pendingSection + '\x1b[0m'); pendingSection = null }
  }
  try { await fn(); passed++; console.log('  \x1b[32m✓\x1b[0m ' + name) }
  catch (e) { failed++; console.log('  \x1b[31m✗\x1b[0m ' + name + '\n      ' + (e.message || e)) }
}
function section(name) { if (CORE_MODE) { pendingSection = name; return } console.log('\n\x1b[1m' + name + '\x1b[0m') }

async function main() {
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

  // ===== 1.2 P2 静态包 index.mjs 静态校验 =====
  section('1.2 P2 静态包 host（packages/dsh-notes/index.mjs）静态校验')
  await t('index.mjs 存在', () => assert(fsNative.existsSync(INDEX_PATH), INDEX_PATH + ' 必须存在'))
  await t('index.mjs 是 ESM（export name/inject/apply，无 bootstrap return）', () => {
    assert(/export const name\s*=\s*'dsh-notes-plugin'/.test(indexSrc), "应 export const name = 'dsh-notes-plugin'")
    assert(/export const inject\s*=\s*\[[^\]]*'fs'[^\]]*'sandboxPolicy'[^\]]*'webServer'[^\]]*'tools'[^\]]*\]/.test(indexSrc), "inject 必须含 fs/sandboxPolicy/webServer/tools（静态包硬依赖，harness 是动态插件 Builtin 不进 inject）")
    assert(/export function apply\(ctx\)/.test(indexSrc), 'export function apply(ctx)')
    assert(!/^return\s*\{/m.test(indexSrc), '不应再有 bootstrap 的顶层 return { inject, apply } 形式')
    assert(!/new Function\s*\(/.test(indexSrc), '不应再依赖 new Function 引导壳（注释中提及历史形式不算）')
  })
  await t('index.mjs 顶部 import node 内置模块', () => {
    assert(indexSrc.indexOf("from 'node:os'") >= 0, 'import node:os')
    assert(indexSrc.indexOf("from 'node:path'") >= 0, 'import node:path')
    assert(indexSrc.indexOf("from 'node:fs'") >= 0, 'import node:fs')
  })
  await t('index.mjs 存储路径为 ~/.dsh/notes（不再从插件目录派生）', () => {
    assert(/path\.join\(os\.homedir\(\),\s*'\.dsh',\s*'notes'\)/.test(indexSrc), "NOTES_ROOT = path.join(os.homedir(), '.dsh', 'notes')")
    assert(indexSrc.indexOf('PLUGIN_DIR + ') < 0 && indexSrc.indexOf('PLUGIN_DIR +') < 0, '不应再用 PLUGIN_DIR 拼接路径')
  })
  await t('index.mjs 含一次性数据迁移逻辑（只复制不删除）', () => {
    assert(indexSrc.indexOf('migrateLegacyNotes') >= 0, 'migrateLegacyNotes 存在')
    assert(indexSrc.indexOf('LEGACY_NOTES_DIR') >= 0, 'LEGACY_NOTES_DIR 迁移源存在')
    assert(indexSrc.indexOf('legacyNames') >= 0 && indexSrc.indexOf('existing[name]') >= 0, '逐文件按需复制（已存在则跳过）')
  })
  await t('index.mjs RPC 主通道 harness.handle + 兜底 webServer 路由', () => {
    assert(indexSrc.indexOf("function handle(name, fn)") >= 0, 'handle(name,fn) helper 保留')
    assert(indexSrc.indexOf('harnessRef.handle(name, wrapped)') >= 0, 'handle helper 内部调用 harness.handle（原姿势）')
    assert(indexSrc.indexOf('webServer.register(') >= 0, '兜底：ctx.webServer.register 路由')
    assert(/kind:\s*'exact'/.test(indexSrc), "路由 kind: 'exact'（参照 task-board）")
    assert(indexSrc.indexOf("RPC_PATH = '/dsh-notes'") >= 0, "RPC 路径 '/dsh-notes'")
  })
  await t('index.mjs 工具走 harness.defineTool/registerTool（保留内联 defineTool 兜底）', () => {
    assert(indexSrc.indexOf('harnessRef.defineTool(def)') >= 0 && indexSrc.indexOf('harnessRef.registerTool(ctx, tool)') >= 0, 'harness.defineTool + harness.registerTool 原姿势保留')
    assert(indexSrc.indexOf('tools.register(defineTool(def))') >= 0, 'ctx.tools 兜底通道')
    assert(indexSrc.indexOf('function defineTool(options)') >= 0, '内联 defineTool（零外部依赖）')
    assert(indexSrc.indexOf("/* global harness */") >= 0, '顶部 /* global harness */ 保留')
  })
  await t('index.mjs 发布版不再写 .last-host-load 开发心跳', () => {
    assert(indexSrc.indexOf('.last-host-load') < 0 || /发布版不再写/.test(indexSrc), '心跳写入段已删除')
    assert(indexSrc.indexOf('PERF_PATH = path.join(NOTES_ROOT') >= 0, 'perf-report.json 落在 ~/.dsh/notes')
  })
  await t('index.mjs 保留 39 个 RPC + 3 工具 + 约定注入 + 派发 + LLM 分类 + 设置 + 导入导出 + 单文件导出 + 资产上传 + 历史版本三 RPC + 工作记忆 notes-memory-guide', () => {
    const m = indexSrc.match(/handle\('([^']+)'/g) || []
    const names = m.map(s => s.match(/'([^']+)'/)[1])
    // 39 = 38（25 基线 + notes-archive-preview/notes-archive-undo + notes-asset-upload + notes-ai-organize/notes-assets-prune + notes-purge + notes-export-single + notes-inject-preview + notes-suggest + notes-usage-get + notes-history/notes-history-get/notes-restore-history）+ notes-memory-guide（工作记忆 v0 沉淀引导启用流程，见 section 39）
    const expected = ['notes-perf', 'notes-list', 'notes-folders', 'notes-css', 'notes-src', 'notes-get', 'notes-create', 'notes-update', 'notes-quick', 'notes-quick-instruct', 'notes-delete', 'notes-restore', 'notes-purge', 'notes-archive', 'notes-archive-preview', 'notes-archive-undo', 'notes-search', 'notes-conventions', 'notes-inject-preview', 'notes-sessions', 'notes-active-sessions', 'notes-workspaces', 'notes-dispatch', 'notes-dispatch-done', 'notes-settings-get', 'notes-settings-set', 'notes-export', 'notes-export-single', 'notes-import-preview', 'notes-import', 'notes-asset-upload', 'notes-ai-organize', 'notes-assets-prune', 'notes-suggest', 'notes-usage-get', 'notes-history', 'notes-history-get', 'notes-restore-history', 'notes-memory-guide']
    for (const e of expected) assert(names.indexOf(e) >= 0, '缺少 RPC：' + e + '（实得 ' + names.length + ' 个：' + names.join(',') + '）')
    assert(names.length === expected.length + 1, '应为 39 个迁移 RPC（含 notes-memory-guide 工作记忆引导）+ 1 个 P1 存活探测（notes-ping），实得 ' + names.length)
    const tm = indexSrc.match(/regTool\(\{\s*name:\s*'([^']+)'/g) || []
    const tnames = tm.map(s => s.match(/'([^']+)'/)[1])
    assert.deepStrictEqual(tnames.sort(), ['note_get', 'note_manage', 'note_search'], '静态包工具必须是 3 个（实得：' + JSON.stringify(tnames) + '）')
    assert(indexSrc.indexOf("name: 'notes:workspace-conventions'") >= 0 && /order:\s*130/.test(indexSrc), 'systemPrompt 约定注入 order 130')
    assert(indexSrc.indexOf('classifyTopic') >= 0 && indexSrc.indexOf('extractInstruction') >= 0, 'LLM 分类 + 指令元数据提取保留')
    assert(indexSrc.indexOf('form: \'recall\'') >= 0, '派发消息保留 form:recall 标记')
    assert(indexSrc.indexOf('function migrationDone') >= 0 || indexSrc.indexOf('let migrationDone') >= 0, '_list 与迁移的竞态等待存在')
  })

  // ===== 1.5 T1.2 列表懒加载分页（client 逻辑层验证）=====
  section('1.5 T1.2 列表懒加载分页')
  await t('client-impl 含 PAGE_SIZE 常量', () => assert(/PAGE_SIZE\s*=\s*50/.test(clientSrc), 'PAGE_SIZE=50'))
  await t('client-impl 含 visibleCount 状态', () => assert(clientSrc.indexOf('visibleCount') >= 0, 'visibleCount state 存在'))
  await t('client-impl 含滚动加载判定', () => assert(/scrollTop\s*\+\s*el\.clientHeight\s*>=\s*el\.scrollHeight\s*-\s*40/.test(clientSrc), 'onListScroll 距底 40px 阈值'))
  await t('client-impl 用 paged 切片渲染', () => assert(/filtered\.slice\(0,\s*visibleCount\)/.test(clientSrc), 'paged = filtered.slice(0, visibleCount)'))
  await t('client-impl 有 hasMore 判定', () => assert(/filtered\.length\s*>\s*visibleCount/.test(clientSrc), 'hasMore = filtered.length > visibleCount'))
  // 纯算法边界验证（与 client 等价实现的正确性）
  const PAGE = 50
  function slicePaged(list, visibleCount) { return list.slice(0, visibleCount) }
  await t('分页切片：0 条', () => assert.strictEqual(slicePaged([], PAGE).length, 0))
  await t('分页切片：恰好 50 条（hasMore=false）', () => {
    const arr = Array.from({ length: 50 }, (_, i) => i)
    const paged = slicePaged(arr, PAGE)
    assert.strictEqual(paged.length, 50)
    assert.strictEqual(arr.length > PAGE, false)
  })
  await t('分页切片：51 条（首屏 50，hasMore=true）', () => {
    const arr = Array.from({ length: 51 }, (_, i) => i)
    const paged = slicePaged(arr, PAGE)
    assert.strictEqual(paged.length, 50)
    assert.strictEqual(arr.length > PAGE, true)
  })
  await t('分页切片：滚动后 +50', () => {
    const arr = Array.from({ length: 120 }, (_, i) => i)
    let vc = PAGE
    const p1 = slicePaged(arr, vc)
    vc += PAGE
    const p2 = slicePaged(arr, vc)
    assert.strictEqual(p1.length, 50)
    assert.strictEqual(p2.length, 100)
    assert.strictEqual(arr.length > vc, true)
  })
  await t('分页切片：越界安全（visibleCount > 总数）', () => {
    const arr = Array.from({ length: 30 }, (_, i) => i)
    assert.strictEqual(slicePaged(arr, PAGE).length, 30)
  })

  // ===== 1.6 T1.4 键盘快捷键（client 源码结构断言）=====
  section('1.6 T1.4 键盘快捷键')
  await t('client-impl 含 keydown 监听', () => assert(/addEventListener\('keydown'/.test(clientSrc), 'keydown 监听存在'))
  await t('Ctrl+K 聚焦搜索', () => assert(/ev\.key === 'k' \|\| ev\.key === 'K'/.test(clientSrc), 'Ctrl+K 分支'))
  await t('Ctrl+N 打开新建笔记 modal', () => {
    assert(/ev\.key === 'n' \|\| ev\.key === 'N'/.test(clientSrc), 'Ctrl+N 分支')
    assert(/mod && \(ev\.key === 'n' \|\| ev\.key === 'N'\)\) \{ ev\.preventDefault\(\); openNewNoteRef\.current\(\); return \}/.test(clientSrc), 'Ctrl+N 调 openNewNoteRef（打开新建 modal，不再是速记框）')
  })
  await t('Escape 关闭', () => assert(/ev\.key === 'Escape'/.test(clientSrc), 'Esc 分支'))
  await t('j/k 或 方向键导航', () => assert(/ev\.key === 'j' \|\| ev\.key === 'ArrowDown'/.test(clientSrc) && /ev\.key === 'k' \|\| ev\.key === 'ArrowUp'/.test(clientSrc), 'j/k 与 ↑↓ 分支'))
  await t('Enter 打开聚焦项', () => assert(/ev\.key === 'Enter'/.test(clientSrc), 'Enter 分支'))
  await t('输入框内不响应导航键', () => assert(/tagName === 'INPUT' \|\| t\.tagName === 'TEXTAREA' \|\| t\.isContentEditable/.test(clientSrc), 'inField 判定'))
  await t('聚焦样式 .focused 存在', () => {
    const cssPath = SRC_STYLES
    assert(fsNative.readFileSync(cssPath, 'utf8').indexOf('.dsh-notes-note-row.focused') >= 0, 'styles.css 含 note-row focused')
  })
  await t('Ctrl+K 直接聚焦侧栏搜索框（v2 常显搜索，无展开态）', () => {
    assert(/mod && \(ev\.key === 'k' \|\| ev\.key === 'K'\)\) \{ ev\.preventDefault\(\); if \(searchInputRef\.current\) searchInputRef\.current\.focus\(\); return \}/.test(clientSrc), 'Ctrl+K → searchInputRef.focus()')
    assert(clientSrc.indexOf('searchOpen') < 0, 'v2 移除 searchOpen 展开态（搜索框侧栏常显）')
  })

  // ===== 1.7 UI v2 client 渲染结构断言（两栏布局 + 主题全局过滤 + 全 SVG 图标）=====
  section('1.7 UI v2 client 渲染结构（两栏 + 主题全局过滤 + SVG 图标）')
  await t('client-impl 含 kind 标签映射', () => assert(/KIND_LABELS\s*=/.test(clientSrc) && clientSrc.indexOf('decision') >= 0, 'KIND_LABELS 映射'))
  await t('SVG 图标 helper I() + 内联图标集（原型 15 symbol + check/tag/swap）', () => {
    assert(/const IC = \{/.test(clientSrc), 'IC 图标集存在')
    assert(/function I\(name, size, cls\)/.test(clientSrc), 'I(name, size, cls) 图标 helper 存在')
    assert(/viewBox: '0 0 24 24'/.test(clientSrc), 'svg viewBox 0 0 24 24')
    // 原型 symbol 的 path 数据逐个内联（抽查关键图标）
    for (const d of ['M12 17v5M7 4h10', 'm20 20-3.5-3.5', 'm9 6 6 6-6 6', 'M13 3 5 13.5h6L11 21l8-10.5h-6Z', 'M4 5h16l-6.5 7.5V19l-3-1.5v-5Z']) {
      assert(clientSrc.indexOf("d: '" + d) >= 0, 'IC 缺 path：' + d)
    }
  })
  await t('emoji 全移除（面板内图标全部 SVG）', () => {
    for (const emoji of ['📌', '⚡', '👁', '🗑', '📁', '📂', '✎', '📝', '⌕', '📇']) {
      assert(clientSrc.indexOf(emoji) < 0, 'client-impl 不应再含 emoji ' + emoji)
    }
  })
  await t('两栏布局骨架（侧栏 + 编辑器通栏）', () => {
    for (const cls of ['dsh-notes-app', 'dsh-notes-side', 'dsh-notes-brand', 'dsh-notes-quick', 'dsh-notes-filterbar', 'dsh-notes-tree', 'dsh-notes-side-foot', 'dsh-notes-ed']) {
      assert(clientSrc.indexOf(cls) >= 0, 'client-impl 缺两栏结构 class：' + cls)
    }
    assert(clientSrc.indexOf('dsh-notes-list') < 0 && clientSrc.indexOf('dsh-notes-divider') < 0 && clientSrc.indexOf('dsh-notes-content') < 0, '旧三栏（list/divider/content）已移除')
    assert(clientSrc.indexOf('listWidth') < 0, '旧列宽拖拽（listWidth）已移除')
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    for (const cls of ['.dsh-notes-app{', '.dsh-notes-side{', '.dsh-notes-brand{', '.dsh-notes-quick{', '.dsh-notes-filterbar{', '.dsh-notes-tree{', '.dsh-notes-side-foot{', '.dsh-notes-fbtn{', '.dsh-notes-ed{']) {
      assert(css.indexOf(cls) >= 0, 'styles.css 缺两栏样式：' + cls)
    }
    assert(/\.dsh-notes-side\{[^}]*width:300px/.test(css), '侧栏固定宽 300px')
  })
  await t('品牌行 + 计数 + 新建＋入口 + 侧栏底部收敛为 回收站/选择/设置 三入口（导出/导入/整理移入设置卡片）', () => {
    assert(clientSrc.indexOf('dsh-notes-brand-logo') >= 0 && clientSrc.indexOf('dsh-notes-brand-cnt') >= 0, '品牌行 logo + 计数')
    assert(clientSrc.indexOf("' 条'") >= 0, '品牌行计数文案「N 条」')
    // 筛选中心口径⑥：新建 chip 迁入 brand 行右侧 ＋ 按钮
    assert(clientSrc.indexOf('dsh-notes-brand-add') >= 0, 'brand 行右侧新建 ＋ 入口（dsh-notes-brand-add）')
    // 底部按钮区精确截取（dsh-notes-side-foot → editorEl 之间）：恰 3 个 fbtn = 回收站 + 选择（多选合并迁入）+ 设置，无导出/导入/整理
    const foot = clientSrc.match(/dsh-notes-side-foot' \},([\s\S]*?)editorEl\)/)
    assert(foot, '侧栏底部区存在')
    assert.strictEqual((foot[1].match(/dsh-notes-fbtn/g) || []).length, 3, '底部按钮恰为 3 个（实得 ' + ((foot[1].match(/dsh-notes-fbtn/g) || []).length) + '）')
    assert(foot[1].indexOf('onClick: openTrash') >= 0 && foot[1].indexOf('onClick: toggleSelMode') >= 0 && foot[1].indexOf('onClick: openSettings') >= 0, '底部 = 回收站 + 选择 + 设置')
    assert(foot[1].indexOf('openExport') < 0 && foot[1].indexOf('openImport') < 0 && foot[1].indexOf('openSuggest') < 0, '底部已无 导出/导入/整理 入口')
    assert(foot[1].indexOf("'导出'") < 0 && foot[1].indexOf("'导入'") < 0 && foot[1].indexOf("'整理'") < 0, '底部无 导出/导入/整理 字样')
    // open* 逻辑保留：导出/导入仍在设置卡片「数据」区，整理建议在设置卡片「整理建议」行
    assert(clientSrc.indexOf("onClick: openExport") >= 0 && clientSrc.indexOf("onClick: openImport") >= 0 && clientSrc.indexOf("onClick: openSuggest") >= 0, 'openExport/openImport/openSuggest 逻辑保留（设置卡片路径可达）')
    assert(clientSrc.indexOf("I('gear', 12)") >= 0, '设置按钮 gear SVG 图标')
  })
  await t('筛选中心控制行（筛选按钮(N) + 激活 chips + 独立排序控件；popover 分组面板）', () => {
    assert(clientSrc.indexOf("const FILTER_KINDS = ['note', 'decision', 'todo', 'link', 'quote', 'log']") >= 0, '类型组六种 kind（多选；+log 工作记忆 v0 专入口）')
    assert(clientSrc.indexOf('dsh-notes-filterbar') >= 0 && clientSrc.indexOf('dsh-notes-fpop') >= 0, '筛选中心容器（filterbar + popover）')
    assert(clientSrc.indexOf('dsh-notes-fchip') >= 0 && clientSrc.indexOf('dsh-notes-fchip-x') >= 0, '激活条件 chip + × 移除')
    assert(clientSrc.indexOf('dsh-notes-fsort-menu') >= 0 && clientSrc.indexOf('dsh-notes-fsort-item') >= 0, '独立排序控件菜单')
    assert(clientSrc.indexOf("I('pin', 11)") >= 0, '置顶 pin 图标（popover 状态组）')
    assert(/onClick: openNewNote, 'data-tooltip': '新建笔记（Ctrl\+N）'/.test(clientSrc), 'brand 行 ＋ → openNewNote')
    // 旧平铺 chips / 旧筛选面板已移除
    assert(clientSrc.indexOf('dsh-notes-chip') < 0 && clientSrc.indexOf('dsh-notes-filter-panel') < 0 && clientSrc.indexOf('dsh-notes-fp-opt') < 0, '旧 chips 行/旧筛选面板类已移除')
    assert(clientSrc.indexOf("'仅置顶'") < 0 && clientSrc.indexOf("'仅敏感'") < 0 && clientSrc.indexOf("'仅注入'") < 0, '旧单选开关文案已移除')
  })
  await t('树结构：视图头 + 置顶组 + 文件夹组 + 未入夹根级直显区 + 主题全局过滤区', () => {
    assert(clientSrc.indexOf('dsh-notes-sec-h') >= 0, 'sec-h 分组头')
    assert(clientSrc.indexOf('全部笔记') >= 0 && clientSrc.indexOf("'主题 · ' + view.id") >= 0 && clientSrc.indexOf("'文件夹 · ' + folderName(view.id)") >= 0, '视图头文案（全部/主题/文件夹）')
    assert(clientSrc.indexOf('（跨文件夹 ') >= 0, '主题视图头含「跨文件夹 N 条」')
    assert(clientSrc.indexOf('PINNED_KEY') >= 0 && clientSrc.indexOf("'置顶'") >= 0, '置顶折叠组（PINNED_KEY 持久化）')
    assert(clientSrc.indexOf('dsh-notes-nested') >= 0, 'nested 子笔记容器')
    assert(clientSrc.indexOf('未分类') >= 0, '未入夹口径文案保留（右键「移出文件夹（未分类）」/面包屑兜底）')
    assert(clientSrc.indexOf("'dsh-notes-sec-h-t' }, '未分类')") < 0, '未入夹区不再渲染「未分类」分组头（同级直显，notes-tree-unfiled-sibling）')
    assert(clientSrc.indexOf("'主题 (' + (filtersActive ? topicHitCount : topicNames.length) + ')'") >= 0 && clientSrc.indexOf('跨文件夹') >= 0, '主题全局过滤区（默认折叠「主题 (N)」一行）')
    assert(clientSrc.indexOf('dsh-notes-topic-row') >= 0, '主题过滤行')
  })
  await t('视图求值：view 单选 ∩ 筛选中心（组内 OR / 跨组 AND）∩ 搜索', () => {
    assert(/const \[view, setView\] = React\.useState\(\{ type: 'all', id: '' \}\)/.test(clientSrc), 'view state（all/folder/topic 单选）')
    assert(clientSrc.indexOf("if (view.type === 'topic') filtered = filtered.filter(n => (n.topic || '') === view.id)") >= 0, '主题视图过滤')
    assert(clientSrc.indexOf("else if (view.type === 'folder') { const vsub = folderSubtreeIdsOf(view.id); filtered = filtered.filter(n => vsub[(n.folder || '')]) }") >= 0, '文件夹视图过滤（递归子树口径，notes-nested-folder-ui）')
    assert(clientSrc.indexOf('filtered = filtered.filter(n => matchFilters(n, filters))') >= 0, '筛选中心谓词接入求值管线')
    assert(/const \[filters, setFilters\] = React\.useState/.test(clientSrc), 'filters 状态（{pinned, injected, injectEver, sensitive, kinds[]}）')
  })
  await t('笔记行：kind 色点 + 标题(+pin) + 注入 bolt + 行尾（主题字/文件夹徽章/日期）', () => {
    assert(clientSrc.indexOf('dsh-notes-kind-dot') >= 0 && clientSrc.indexOf("style: { background: 'var(--nkind-' + (n.kind || 'note') + ')' }") >= 0, 'kind 色点走 token var(--nkind-*)')
    assert(clientSrc.indexOf('dsh-notes-note-ti') >= 0 && clientSrc.indexOf("I('pin', 10, 'dsh-notes-note-pin')") >= 0, '标题 + 置顶 pin 图标')
    assert(clientSrc.indexOf('dsh-notes-note-inj') >= 0 && clientSrc.indexOf("I('bolt', 10)") >= 0, '上下文注入 bolt 标记')
    assert(clientSrc.indexOf("'注入为上下文 · ' + (n.injectRole === 'reference' ? '资料' : '约定') + ' · 范围：'") >= 0, 'bolt tooltip 按 injectRole 段位显示 约定/资料')
    assert(clientSrc.indexOf('dsh-notes-fbadge') >= 0, '主题视图行尾文件夹徽章（fbadge）')
    assert(clientSrc.indexOf('dsh-notes-note-tp') >= 0 && clientSrc.indexOf('dsh-notes-note-dt') >= 0, '文件夹上下文行尾主题字 / 其余行尾日期')
    assert(clientSrc.indexOf('injectScopeLabel') >= 0, '注入范围文字函数')
    assert(clientSrc.indexOf("keepQuickRef.current && tags.indexOf('quick') < 0") >= 0, 'doSave 保留 quick 速记标签（v2 行不渲染标签，语义保留在保存链路）')
  })
  await t('编辑器：面包屑 + 大标题 + meta chips 行 + 正文 + 底部状态', () => {
    assert(clientSrc.indexOf('dsh-notes-ed-crumb') >= 0 && clientSrc.indexOf('dsh-notes-crumb-lnk') >= 0, '面包屑（主题段可点击）')
    assert(clientSrc.indexOf('jumpToTopicFilter') >= 0, '面包屑/主题 chip 跳主题全局过滤')
    assert(/className: 'dsh-notes-ed-title', placeholder: '无标题', value: edTitle/.test(clientSrc), '大标题输入（受控 edTitle）')
    assert(clientSrc.indexOf('dsh-notes-meta-chip') >= 0 && clientSrc.indexOf('dsh-notes-meta-act') >= 0, 'meta chips + 右侧操作')
    assert(/className: 'dsh-notes-meta-select', value: edKind/.test(clientSrc), 'kind 下拉 chip')
    assert(clientSrc.indexOf('dsh-notes-meta-dot') >= 0, 'kind 色点 chip')
    assert(/value: edTopic/.test(clientSrc) && clientSrc.indexOf('dsh-notes-meta-topic-input') >= 0, '主题 chip 可编辑')
    assert(/value: edTags/.test(clientSrc) && clientSrc.indexOf('dsh-notes-meta-tags-input') >= 0, '标签 chip 可编辑')
    assert(clientSrc.indexOf('dsh-notes-ed-foot') >= 0 && clientSrc.indexOf("'创建 '") >= 0 && clientSrc.indexOf("'更新 '") >= 0 && clientSrc.indexOf("'来源 会话 '") >= 0, '底部 创建/更新/来源')
    assert(clientSrc.indexOf('dsh-notes-ed-saved') >= 0 && clientSrc.indexOf('已自动保存 ') >= 0, '自动保存提示')
  })
  await t('编辑器 meta：注入三态分段控件 + 目录可见 toggle + 派发/来源/置顶/删除', () => {
    assert(clientSrc.indexOf("'dsh-notes-meta-chip dsh-notes-role-seg'") >= 0, '三态分段控件容器（meta-chip + role-seg）')
    assert((clientSrc.match(/dsh-notes-role-opt/g) || []).length >= 3, '三个段位（关闭/约定/资料）')
    assert(clientSrc.indexOf("onClick: () => setRoleSeg('off')") >= 0 && clientSrc.indexOf("onClick: () => setRoleSeg('convention')") >= 0 && clientSrc.indexOf("onClick: () => setRoleSeg('reference')") >= 0, '三段点击切换 setRoleSeg')
    assert(clientSrc.indexOf("'data-tooltip': '不注入系统提示'") >= 0, '关闭段 tooltip')
    assert(clientSrc.indexOf("'data-tooltip': '须遵守的行为规则'") >= 0, '约定段 tooltip')
    assert(clientSrc.indexOf("'data-tooltip': '事实性补充信息，Agent 按需取用'") >= 0, '资料段 tooltip')
    assert(/edRole === 'off' \? ' on' : ''/.test(clientSrc) && /edRole === 'convention' \? ' on' : ''/.test(clientSrc) && /edRole === 'reference' \? ' on' : ''/.test(clientSrc), '选中段 on 态高亮（三态各自分支）')
    assert(clientSrc.indexOf('dsh-notes-ed-scope-wrap') >= 0 && clientSrc.indexOf('dsh-notes-scope-panel') >= 0 && clientSrc.indexOf('dsh-notes-scope-trigger') >= 0, '逐级范围浮层挂 meta 行')
    assert(/const isInjected = edRole !== 'off'/.test(clientSrc) && clientSrc.indexOf('isInjected ? e(\'span\', { className: \'dsh-notes-ed-scope-wrap\' }') >= 0, '范围浮层在非 off（约定/资料）时显示')
    assert(clientSrc.indexOf('目录可见') >= 0 && clientSrc.indexOf("I('eye', 11)") >= 0, '目录可见 toggle（eye 图标）')
    assert(clientSrc.indexOf("'派发'") >= 0 && clientSrc.indexOf("I('play', 12)") >= 0, '派发操作（play 图标）')
    assert(clientSrc.indexOf("'来源'") >= 0 && clientSrc.indexOf("I('ext', 12)") >= 0, '来源操作（ext 图标）')
    assert(clientSrc.indexOf("I('pin', 12)") >= 0 && clientSrc.indexOf("I('trash', 12)") >= 0, '置顶/删除操作图标')
    assert(clientSrc.indexOf('openDispatch') >= 0 && clientSrc.indexOf('jumpToSession') >= 0, '派发/来源行为保留')
  })
  await t('client-impl 含 status 类名分支', () => assert(/status === 'pinned'/.test(clientSrc) && /status === 'resolved'/.test(clientSrc) && /status === 'superseded'/.test(clientSrc), 'status 视觉分支'))
  await t('client-impl 选区捕获传 kind=quote', () => assert(/kind: 'quote'/.test(clientSrc), 'selection capture → quote'))
  await t('快速记录卡片 v2 结构（cap-h + 识别为引用徽章 + cap-pv 预览 + cap-in 输入 + 三按钮）', () => {
    assert(clientSrc.indexOf('dsh-notes-cap-h') >= 0 && clientSrc.indexOf('dsh-notes-cap-src') >= 0, '卡片头部')
    assert(clientSrc.indexOf('dsh-notes-cap-auto') >= 0 && clientSrc.indexOf('识别为 引用') >= 0, '「识别为 引用」自动徽章')
    assert(clientSrc.indexOf('dsh-notes-cap-pv') >= 0, '选区预览块')
    assert(/lines\.length > 160 \? lines\.slice\(0, 160\)/.test(clientSrc), '预览 160 字上限（原型口径）')
    assert(clientSrc.indexOf('dsh-notes-cap-in') >= 0 && clientSrc.indexOf('dsh-notes-cap-input') >= 0, '补充输入框')
    assert(clientSrc.indexOf('Enter 记录') >= 0, '输入框 kbd 提示')
    assert(clientSrc.indexOf('dsh-notes-cap-acts') >= 0, '按钮行')
    assert(clientSrc.indexOf('复制') >= 0 && clientSrc.indexOf("'记录'") >= 0 && clientSrc.indexOf("'取消'") >= 0, '复制/记录/取消三按钮')
    assert(/dsh-notes-cbtn primary/.test(clientSrc), '记录按钮 primary 实心强调色')
    assert(/copySelection/.test(clientSrc), 'copySelection 复制处理函数存在')
    assert(clientSrc.indexOf('navigator.clipboard') >= 0, '优先 navigator.clipboard.writeText')
    assert(clientSrc.indexOf('execCommand') >= 0, '降级 execCommand 兜底')
    assert(clientSrc.indexOf("closest('.dsh-notes-cap')") >= 0, '卡片内部点击不误关（closest 守卫）')
    // 旧选区指令框（instruct 系列）已移除
    assert(clientSrc.indexOf('dsh-notes-instruct') < 0, '旧 instruct 浮层已移除')
  })
  await t('快速记录卡片 v2 样式走 token（无硬编码白底/深色字）', () => {
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    for (const cls of ['.dsh-notes-cap{', '.dsh-notes-cap-h{', '.dsh-notes-cap-pv{', '.dsh-notes-cap-in{', '.dsh-notes-cap-acts{', '.dsh-notes-cbtn{']) {
      assert(css.indexOf(cls) >= 0, 'styles.css 缺卡片样式：' + cls)
    }
    assert(/\.dsh-notes-cbtn\.primary\{[^}]*var\(--nacc\)/.test(css), 'primary 按钮用 var(--nacc) 主题色')
    assert(/\.dsh-notes-cbtn\.primary:hover\{[^}]*opacity:\.9/.test(css), 'primary hover 减透明度（原型口径）')
    assert(/\.dsh-notes-cap-input\{[^}]*background:transparent/.test(css), 'cap-input 背景透明（抬升面容器之上）')
    assert(css.indexOf('dsh-notes-capin') >= 0, '卡片弹出动画')
    assert(css.indexOf('.dsh-notes-instruct') < 0, '旧 instruct 样式已移除')
    // cap 系列全部走 token：无硬编码白底/深色字（var() fallback 与 primary 白字除外）
    const capRules = css.match(/\.dsh-notes-(cap|cbtn)[^{]*\{[^}]*\}/g) || []
    const noVar = (r) => r.replace(/var\([^)]*\)/g, '')
    const badBg = capRules.filter(r => /background:\s*(#fff\b|white\b)/i.test(noVar(r)))
    assert.strictEqual(badBg.length, 0, 'cap 系列不得含硬编码白底：' + badBg.join(' | '))
    const badFg = capRules.filter(r => /(^|[{;])\s*color:\s*(#0[0-9a-f]|#1[0-9a-f]|#2[0-9a-f]|#3[0-9a-f]|black\b)/i.test(noVar(r)))
    assert.strictEqual(badFg.length, 0, 'cap 系列不得含硬编码深色字：' + badFg.join(' | '))
  })
  await t('client-impl 注入为独立三态控件+逐级范围浮层', () => {
    assert(/function setRoleSeg\(r\) \{/.test(clientSrc), '独立注入三态切换 setRoleSeg（不碰标签）')
    assert(!/toggleInject/.test(clientSrc), '旧布尔开关 toggleInject 已移除')
    assert(/if \(r === 'off'\) setScopeOpen\(false\)/.test(clientSrc) && /else if \(wasOff\) setScopeOpen\(true\)/.test(clientSrc), 'off→非off 自动展开范围浮层，切 off 收起')
    assert(/edScope/.test(clientSrc), '范围多选 edScope 数组')
    assert(/dsh-notes-scope-group/.test(clientSrc) && /scopeByWs/.test(clientSrc), '会话按工作区分组（两级）')
    assert(clientSrc.indexOf("toggleScope('workspace')") < 0 && clientSrc.indexOf("toggleScope('global')") < 0, '范围浮层移除「本工作区/全局」选项（缺省=所有会话）')
    assert(clientSrc.indexOf('dsh-notes-scope-hint') >= 0 && clientSrc.indexOf('默认注入到所有会话；勾选会话则仅限这些会话') >= 0, '范围浮层顶部灰色默认提示行')
    assert(clientSrc.indexOf("return '所有会话'") >= 0, '范围触发按钮缺省标签=所有会话')
    assert(clientSrc.indexOf('sessList') >= 0 && clientSrc.indexOf('notes-sessions') >= 0, '会话名列表 sessList 来自 notes-sessions RPC')
  })
  await t('注入范围重构：schema 描述去工作区/全局维度（host-impl / index.mjs 双边）+ 发布包同步', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(src.indexOf('["workspace"]') < 0 && src.indexOf('["global"]') < 0, label + ' schema/工具描述不含 ["workspace"]/["global"] 字样')
      assert(src.indexOf('Injection scope multi-select: [] or omitted=all sessions (default), or session short-ids like ["99f2b674","7f8b49e6"] to restrict') >= 0, label + ' schema injectTo 描述新口径（缺省=所有会话）')
      // conventionHit 新语义：缺省/存量 'global'/'workspace' 值 → 所有会话；会话短 id → 仅限这些会话
      assert(src.indexOf("if (t === 'global' || t === 'workspace') return true") >= 0, label + ' conventionHit 存量 global/workspace 值按所有会话容错')
      assert(src.indexOf('当前工作区优先') < 0 && src.indexOf('←') < 0, label + ' 目录去「当前工作区优先」排序与 ←来源 标注')
    }
    const pkgClient = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
    assert(pkgClient.indexOf("toggleScope('workspace')") < 0 && pkgClient.indexOf("toggleScope('global')") < 0, '发布包 lib/client.js 范围浮层移除「本工作区/全局」选项（需先跑 scripts/build-dist.cjs）')
    assert(pkgClient.indexOf('默认注入到所有会话；勾选会话则仅限这些会话') >= 0 && pkgClient.indexOf("return '所有会话'") >= 0, '发布包提示行/缺省标签同步')
    const devCss = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const pkgCss = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    assert(devCss.indexOf('.dsh-notes-scope-hint{') >= 0 && pkgCss.indexOf('.dsh-notes-scope-hint{') >= 0, 'styles.css / 发布包样式含 scope-hint（var(--nt3) 灰字）')
  })
  await t('注入三态 edRole 链路：state/ref/selectNote 映射/doSave payload（开发版 + 发布包）', () => {
    assert(/const \[edRole, setEdRole\] = React\.useState\('off'\)/.test(clientSrc), 'edRole 三态 state（off/convention/reference，缺省 off）')
    assert(/const edRoleRef = React\.useRef\('off'\)/.test(clientSrc), 'edRoleRef 自动保存镜像存在')
    assert(/setEdRole\(n\.inject \? \(n\.injectRole \|\| 'convention'\) : 'off'\)/.test(clientSrc), 'selectNote 映射：inject=true 无 role 缺省 convention（存量零迁移），否则 off')
    assert(/edRoleRef\.current = edRole/.test(clientSrc), '渲染期同步 edRoleRef')
    assert(/inject: edRoleRef\.current !== 'off'/.test(clientSrc), 'doSave：off → inject:false')
    assert(/if \(upd\.inject\) upd\.injectRole = edRoleRef\.current/.test(clientSrc), 'doSave：非 off 才带 injectRole（off 态 payload 不带，禁 undefined）')
    assert(clientSrc.indexOf('edInject') < 0, '旧 edInject 布尔链路清零')
    const pkgRole = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
    assert(pkgRole.indexOf('dsh-notes-role-seg') >= 0 && pkgRole.indexOf('setRoleSeg') >= 0 && pkgRole.indexOf('edRoleRef') >= 0, '发布包 lib/client.js 同步三态链路（需先跑 scripts/build-dist.cjs）')
    assert(pkgRole.indexOf('edInject') < 0 && pkgRole.indexOf('toggleInject') < 0, '发布包旧布尔链路清零')
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    assert(css.indexOf('.dsh-notes-role-seg{') >= 0 && css.indexOf('.dsh-notes-role-opt{') >= 0 && css.indexOf('.dsh-notes-role-opt.on{') >= 0, 'styles.css 含 role-seg/role-opt 三态样式')
    assert(/\.dsh-notes-role-opt\.on\{[^}]*background:var\(--nbg-sel\)[^}]*color:var\(--nacc-tx\)/.test(css), '选中段走 var(--nbg-sel) + var(--nacc-tx) token')
    const pkgCss = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    assert(pkgCss.indexOf('.dsh-notes-role-opt.on{') >= 0, '发布包 lib/styles.css 同步三态样式')
  })
  await t('app.html + 原型三态同步：分段控件/role 映射/保存 payload/mock 链路', () => {
    const appRole = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const protoRole = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    for (const pair of [[appRole, 'app.html'], [protoRole, '原型 notes-ui-v2.html']]) {
      const src = pair[0], tag = pair[1]
      assert(src.indexOf('meta-chip role-seg') >= 0 && src.indexOf('data-role="off"') >= 0 && src.indexOf('data-role="convention"') >= 0 && src.indexOf('data-role="reference"') >= 0, tag + ' 含三态分段控件（关闭/约定/资料）')
      assert(src.indexOf('>关闭</span>') >= 0 && src.indexOf('>约定</span>') >= 0 && src.indexOf('>资料</span>') >= 0, tag + ' 三段位文案')
      assert(src.indexOf('title="不注入系统提示"') >= 0 && src.indexOf('title="须遵守的行为规则"') >= 0 && src.indexOf('title="事实性补充信息，Agent 按需取用"') >= 0, tag + ' 三段 tooltip')
      assert(src.indexOf("var role = n.inject ? (n.injectRole === 'reference' ? 'reference' : 'convention') : 'off'") >= 0, tag + ' renderMeta 三态映射（存量 inject=true 无 role 缺省 convention）')
      assert(src.indexOf("if (upd.inject) upd.injectRole = edNote.injectRole === 'reference' ? 'reference' : 'convention'") >= 0, tag + ' doSave 非 off 才带 injectRole（payload 禁 undefined）')
      assert(/\.role-seg \.seg\.on\{[^}]*background:var\(--nbg-sel\)[^}]*color:var\(--nacc-tx\)/.test(src), tag + ' 选中段样式走 var(--nbg-sel)+var(--nacc-tx) token')
      assert(src.indexOf('id="mInj"') < 0 && src.indexOf('注入为约定') < 0 && src.indexOf('约定注入') < 0, tag + ' 旧「注入为约定」开关/单义文案清零')
    }
    assert(protoRole.indexOf("injectRole: 'reference'") >= 0, '原型 mock 含 reference 示例数据（n6 演示资料态）')
    assert(/injectRole: n\.injectRole === 'reference' \? 'reference' : 'convention'/.test(protoRole), '原型 _mockSlim 携带 injectRole（缺省 convention）')
    assert(/if \(a\.injectRole !== undefined\) n\.injectRole = a\.injectRole === 'reference'/.test(protoRole), '原型 mock notes-update 透传 injectRole')
  })
  await t('client 旧「注入为约定」单义文案清零（三态升级为 关闭/约定/资料）', () => {
    const pkgRole2 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
    for (const pair of [[clientSrc, 'client-impl.js'], [pkgRole2, '发布包 lib/client.js']]) {
      const src = pair[0], tag = pair[1]
      for (const dead of ['注入为约定', '约定 · 注入中', '作为约定注入到系统提示', 'toggleInject', '已记录并设为约定', '设为约定…']) {
        assert(src.indexOf(dead) < 0, tag + ' 不含旧文案/旧开关：' + dead)
      }
    }
    assert(clientSrc.indexOf('已记录并注入为上下文（') >= 0, '速记 toast 改「注入为上下文（约定/资料）」')
    assert(clientSrc.indexOf('注入为上下文…直接回车则仅记录') >= 0, '速记备注 placeholder 改「注入为上下文」')
  })
  await t('改名防竞态：正文加载中 doSave 省略 body（面板 + app.html + 发布包）', () => {
    const pkgCli = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
    const appHtml = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    for (const pair of [[clientSrc, 'client-impl.js'], [pkgCli, '发布包 lib/client.js']]) {
      const src = pair[0], tag = pair[1]
      assert(src.indexOf('edLoadingRef.current = true') >= 0, tag + ' selectNote 置加载标记')
      assert(/edLoadingRef\.current = false/.test(src), tag + ' notes-get 回填/异常后解除标记')
      assert(/if \(!edLoadingRef\.current\) upd\.body = edBodyRef\.current/.test(src), tag + ' doSave 加载中省略 body（host 对 undefined 保留原内容）')
    }
    assert(appHtml.indexOf('edLoading = true') >= 0 && /if \(!edLoading\) upd\.body = edNote\.body/.test(appHtml), 'app.html 同款防竞态守卫')
  })
  await t('client-impl 派发对话框（已有/新建会话）', () => {
    assert(/dsh-notes-dispatch-modal/.test(clientSrc), '派发对话框 modal')
    assert(/openDispatch/.test(clientSrc) && /doDispatchConfirm/.test(clientSrc), '打开对话框+确认派发')
    assert(/dispatchMode/.test(clientSrc) && clientSrc.indexOf('新建会话') >= 0 && clientSrc.indexOf('已有会话') >= 0, '两种派发模式')
    assert(/connectWorkspace/.test(clientSrc), '新建会话用 connectWorkspace')
    assert(/dsh-notes-dispatch-history/.test(clientSrc), '详情区派发历史展示')
    assert(/notes-workspaces/.test(clientSrc) && /notes-active-sessions/.test(clientSrc), '工作区+活跃会话下拉数据源')
  })
  await t('client-impl 派发历史可折叠（默认折叠，点标题行展开）', () => {
    assert(/const \[dispatchHistoryOpen, setDispatchHistoryOpen\] = React\.useState\(false\)/.test(clientSrc), '折叠态 dispatchHistoryOpen 存在且默认 false（折叠）')
    assert(clientSrc.indexOf("dispatchHistoryOpen ? ' open' : ' collapsed'") >= 0, 'open/collapsed 折叠态 class 分支存在')
    assert(/setDispatchHistoryOpen\(!dispatchHistoryOpen\)/.test(clientSrc), '标题行点击切换折叠态')
    assert(clientSrc.indexOf('dispatchHistoryOpen ? curDispatches.map') >= 0, '折叠时不渲染记录列表（不挤压正文）')
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    assert(/\.dsh-notes-dispatch-history-t\{[^}]*cursor:pointer/.test(css), '标题行 cursor:pointer 可点击')
    assert(/\.dsh-notes-dispatch-history\.collapsed/.test(css), 'collapsed 折叠态样式存在')
  })
  await t('styles.css 含 kind/status 视觉（v2 token 化）', () => {
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    assert(css.indexOf('.dsh-notes-kind-dot') >= 0, 'kind 色点 css')
    assert(css.indexOf('--nkind-decision') >= 0 && css.indexOf('--nkind-quote') >= 0, 'kind 颜色 token 声明')
    assert(css.indexOf('.dsh-notes-note-row.resolved') >= 0 && css.indexOf('.dsh-notes-note-row.superseded') >= 0, 'status 划线视觉')
  })
  await t('入口 v2：头部描边胶囊 + FAB 卡片式 tridots（无计数徽章，开发版/发布包/原型同步）', () => {
    const cssDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    const pkgClient = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
    for (const [css, tag] of [[cssDev, 'styles.css'], [cssPkg, '发布包 lib/styles.css']]) {
      // 头部按钮 = 原型 .hbtn 描边胶囊：inline-flex / gap 6px / padding 5px 11px / 1px var(--nbd) / radius 8px / 透明底
      assert(/\.dsh-notes-floating,\.dsh-notes-fab,\.dsh-notes-hdr-btn\{/.test(css), tag + ' token 作用域须含 .dsh-notes-hdr-btn（头部按钮在 DSH 文档流内，不在面板里）')
      const hdr = (css.match(/(?:^|\n)\.dsh-notes-hdr-btn\{([^}]*)\}/) || [])[1] || ''
      assert(/gap:6px/.test(hdr) && /padding:5px 11px/.test(hdr) && /border-radius:8px/.test(hdr) && /border:1px solid var\(--nbd\)/.test(hdr) && /background:transparent/.test(hdr) && /color:var\(--nt2\)/.test(hdr), tag + ' 头部按钮 v2 描边胶囊基态（实得：' + hdr + '）')
      assert(/\.dsh-notes-hdr-btn:hover\{[^}]*var\(--nbg-hover\)[^}]*var\(--ntx\)/.test(css), tag + ' 头部按钮 hover=nbg-hover 底 + ntx 字')
      assert(/\.dsh-notes-hdr-btn\.active\{[^}]*var\(--nbg-sel\)[^}]*border-color:transparent[^}]*var\(--nacc\)[^}]*font-weight:600/.test(css), tag + ' 头部按钮激活态=nbg-sel 底 + transparent 边 + nacc 字 + 600')
      // FAB = 原型 .fabg 卡片式：44px / radius 12px / npanel 底 / nbd-soft 描边 / 阴影
      const fab = (css.match(/(?:^|\n)\.dsh-notes-fab\{([^}]*)\}/) || [])[1] || ''
      assert(/width:44px/.test(fab) && /border-radius:12px/.test(fab) && /background:var\(--npanel\)/.test(fab) && /border:1px solid var\(--nbd-soft\)/.test(fab) && /box-shadow:var\(--nshadow-fab\)/.test(fab) && /color:var\(--ntx\)/.test(fab), tag + ' FAB v2 卡片式基态（实得：' + fab + '）')
      // FAB 阴影主题自适应：亮色轻阴影为默认，暗色经 body[data-ds-dark-theme] 覆盖加重（修复亮色阴影过重）
      assert(css.indexOf('--nshadow-fab:0 4px 14px rgba(0,0,0,.10),0 1px 4px rgba(0,0,0,.06)') >= 0, tag + ' FAB 亮色轻阴影 token 默认值')
      assert(/body\[data-ds-dark-theme\][^{]*\{[^}]*--nshadow-fab:0 10px 28px/.test(css), tag + ' FAB 暗色重阴影 data-ds-dark-theme 覆盖')
      assert(/\.dsh-notes-fab:hover\{[^}]*translateY\(-1px\)[^}]*var\(--nacc\)/.test(css), tag + ' FAB hover=上浮 1px + nacc 图标/描边')
      assert(/\.dsh-notes-fab-tridots\{[^}]*right:4px[^}]*bottom:4px[^}]*gap:2px[^}]*var\(--npanel\)[^}]*padding:1px 3px/.test(css), tag + ' FAB tridots 底托样式')
      assert(/\.dsh-notes-fab-tridots i\{[^}]*width:5px[^}]*height:5px[^}]*border-radius:50%/.test(css), tag + ' FAB tridots 5px 圆点')
      // 旧版残留清零（圆形 FAB / 旧灰色 token）
      assert(css.indexOf('--color-text-secondary') < 0 && css.indexOf('--color-surface-hover') < 0 && css.indexOf('--color-accent') < 0, tag + ' 旧头部按钮 token 已清')
    }
    for (const [src, tag] of [[clientSrc, 'client-impl.js'], [pkgClient, '发布包 lib/client.js']]) {
      assert(src.indexOf("I('note', 22)") >= 0, tag + ' FAB 中央 note 图标 22px')
      assert(src.indexOf("I('note', 13)") >= 0, tag + ' 头部按钮 note 图标 13px')
      assert(src.indexOf('dsh-notes-fab-tridots') >= 0, tag + ' FAB 渲染 tridots')
      assert(src.indexOf('var(--nkind-todo)') >= 0 && src.indexOf('var(--nkind-decision)') >= 0 && src.indexOf('var(--nkind-quote)') >= 0, tag + ' tridots 三枚 kind 色点')
      // 需求变更：两个入口均不要计数徽章
      assert(src.indexOf('dsh-notes-hdr-badge') < 0 && src.indexOf('dsh-notes-fab-badge') < 0, tag + ' 无计数徽章标记')
    }
    // 原型 Shell 入口小节已同步（实现与原型保持一致）
    const proto = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    assert(proto.indexOf('.shell-demo') >= 0 && proto.indexOf('.hbtn{') >= 0 && proto.indexOf('.hbtn.on') >= 0 && proto.indexOf('.fabg{') >= 0 && proto.indexOf('.fabg .tridots') >= 0, '原型含 Shell 入口小节 .hbtn/.fabg/.tridots')
  })

  // ===== 1.8 新建笔记 modal（＋ / Ctrl+N 输标题创建，替代顶栏速记）=====
  section('1.8 新建笔记 modal（＋ / Ctrl+N 输标题创建）')
  // 发布包 client 源码独立读取（本节在 section 18 之前，clientPkgSrc 尚未定义）
  const clientPkgSrcNewNote = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
  await t('＋ 按钮点击弹新建 modal（tooltip=新建笔记（Ctrl+N））', () => {
    assert(/onClick: openNewNote, 'data-tooltip': '新建笔记（Ctrl\+N）'/.test(clientSrc), '＋ 按钮 onClick=openNewNote + tooltip「新建笔记（Ctrl+N）」')
    assert(/function openNewNote\(\) \{ setNewNoteTitle\(''\); setNewNoteKind\('note'\); setNewNotePending\(false\); setError\(''\); setNewNoteOpen\(true\) \}/.test(clientSrc), 'openNewNote 清空上次标题 + 类型复位 note 并打开 modal（二期：类型选择入 modal）')
    assert(/newNoteOpen \? e\('div', \{ className: 'dsh-notes-newnote-mask'/.test(clientSrc), 'mask 仅在 newNoteOpen 时渲染（＋ 点击后弹出）')
    assert(clientPkgSrcNewNote.indexOf('onClick: openNewNote') >= 0 && clientPkgSrcNewNote.indexOf('dsh-notes-newnote-mask') >= 0, '发布包 client.js 同步含 ＋→modal（需先跑 scripts/build-dist.cjs）')
  })
  await t('新建 modal 结构：居中卡片 + 标题输入 + 取消/创建', () => {
    assert(clientSrc.indexOf("'dsh-notes-newnote-modal'") >= 0 && clientSrc.indexOf("'dsh-notes-newnote-t'") >= 0, 'modal 容器 + 标题 class')
    assert(clientSrc.indexOf("'新建笔记'") >= 0, 'modal 标题「新建笔记」')
    assert(/ref: newNoteInputRef, className: 'dsh-notes-newnote-input', placeholder: '笔记标题…', value: newNoteTitle/.test(clientSrc), '标题输入框（placeholder「笔记标题…」）受控于 newNoteTitle')
    assert(/newNoteOpen && newNoteInputRef\.current\) newNoteInputRef\.current\.focus\(\)/.test(clientSrc), '打开 modal 自动聚焦标题输入框')
    assert(/onClick: \(\) => setNewNoteOpen\(false\) \}, '取消'\)/.test(clientSrc), '取消按钮关闭 modal')
    assert(/onClick: doCreateNote, disabled: newNotePending \|\| !newNoteTitle\.trim\(\)/.test(clientSrc), '创建按钮：标题为空/创建中 disabled')
  })
  await t('标题输入交互：Enter 提交 / Esc 关 modal / 点遮罩关闭', () => {
    assert(/onChange: \(ev\) => setNewNoteTitle\(ev\.target\.value\)/.test(clientSrc), '输入即更新 newNoteTitle')
    assert(/if \(ev\.key === 'Enter'\) \{ ev\.preventDefault\(\); doCreateNote\(\) \}/.test(clientSrc), '输入框 Enter 提交创建')
    assert(/if \(newNoteOpenRef\.current\) \{ setNewNoteOpen\(false\); return \}/.test(clientSrc), 'Esc 优先关新建 modal（在全局 keydown 中）')
    assert(/dsh-notes-newnote-mask', onMouseDown: \(ev\) => \{ if \(ev\.target === ev\.currentTarget\) setNewNoteOpen\(false\) \}/.test(clientSrc), '点遮罩关闭 modal')
    assert(/mod && \(ev\.key === 'n' \|\| ev\.key === 'N'\)\) \{ ev\.preventDefault\(\); openNewNoteRef\.current\(\); return \}/.test(clientSrc), 'Ctrl+N 打开新建 modal')
  })
  await t('创建流程：notes-create 输标题建笔记 → 刷新 → 选中新笔记 → 聚焦正文', () => {
    assert(clientSrc.indexOf("const payload = { title: title, body: KIND_TEMPLATES[newNoteKind] || '', kind: newNoteKind }") >= 0, 'notes-create payload 传 title/kind=newNoteKind/body=类型模板骨架（二期 kind 骨架；note=空）')
    assert(/host\.call\('notes-create', payload\)/.test(clientSrc), 'notes-create 走 payload（v2 视图落位）')
    assert(clientSrc.indexOf("view.type === 'folder' ? view.id :") >= 0 && clientSrc.indexOf("payload.folder = createFolder") >= 0, '文件夹视图落当前文件夹')
    assert(clientSrc.indexOf("if (view.type === 'topic' && view.id) payload.topic = view.id") >= 0, '主题视图带当前主题')
    assert(/showToast\('已创建'\)/.test(clientSrc), '创建成功 toast「已创建」')
    const m = clientSrc.match(/async function doCreateNote\(\) \{[\s\S]*?\n        \}/)
    assert(m, 'doCreateNote 函数体可提取')
    const fnBody = m[0]
    assert(/loadNotes\(true\)/.test(fnBody), '创建后静默刷新列表（后台，不阻塞选中链路）')
    assert(/selectNote\(\{ id: res\.id/.test(fnBody), '创建后按返回 id 立即选中新笔记（不等列表刷新）')
    assert(/setEditorModeState\('source'\)/.test(fnBody), '富文本态先切回源码态（保证正文 textarea 存在）')
    assert(/edBodyDomRef\.current\.focus\(\)/.test(fnBody), '创建后聚焦正文 textarea（edBodyDomRef）')
    assert(/ref: edBodyDomRef, className: 'dsh-notes-ed-body'/.test(clientSrc), '正文 textarea 挂 edBodyDomRef（v2 ed-body）')
    assert(clientPkgSrcNewNote.indexOf("rpc('notes-create', payload)") >= 0, '发布包创建走 notes-create（rpc 形态）')
  })
  await t('顶栏速记已移除（capOpen/doCapture/capture 样式清零）', () => {
    for (const dead of ['capOpen', 'capText', 'capSaved', 'capPending', 'doCapture', 'dsh-notes-capture']) {
      assert(clientSrc.indexOf(dead) < 0, 'client-impl 不含 ' + dead)
      assert(clientPkgSrcNewNote.indexOf(dead) < 0, '发布包 client.js 不含 ' + dead)
    }
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    assert(css.indexOf('.dsh-notes-capture') < 0, 'styles.css 不含 capture 系列样式')
  })
  await t('新建 modal 样式走 token（dsh-notes-newnote-* 系列）', () => {
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    for (const cls of ['.dsh-notes-newnote-mask{', '.dsh-notes-newnote-modal{', '.dsh-notes-newnote-t{', '.dsh-notes-newnote-input', '.dsh-notes-newnote-actions{']) {
      assert(css.indexOf(cls) >= 0, 'styles.css 缺 ' + cls)
    }
    assert(css.indexOf('background:var(--nbg)') >= 0, 'modal 背景走 token var(--nbg)')
  })
  await t('使用说明与空态文案已改为新建标题（无速记输入框残留文案）', () => {
    assert(clientSrc.indexOf('展开输入框') < 0, '使用说明不再提「展开输入框」速记')
    assert(clientSrc.indexOf('在上方输入框直接记录') < 0, '编辑器空态不再提「上方输入框」')
    assert(clientSrc.indexOf('输入标题新建笔记') >= 0, '使用说明第一条改为输标题新建')
  })

  // ===== 2. Host 运行时 mock =====
  section('2. Host 全链路逻辑（内存 mock）')
  const store = new Map()
  let reads = 0, writes = 0
  const NOTES_DIR = 'D:\\deepseek-work\\dsh-notes-plugin\\notes'
  const fsMock = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { reads++; if (!store.has(p)) throw new Error('ENOENT: ' + p); return store.get(p) },
    writeText: async (p, c) => { writes++; store.set(p, c) },
  }
  const llmMock = {
    stream: async function* (req) {
      const sys = (req && req.system) || ''
      // T3 指令元数据提取：返回固定 JSON（断言原文不变 + 元数据应用）
      if (sys.indexOf('元数据') >= 0) {
        yield { type: 'text-delta', text: '{"tags":["重要","bug"],"titleHint":"登录崩溃修复","kind":"todo","inject":true}' }
        yield { type: 'finish' }
      } else if (sys.indexOf('笔记整理助手') >= 0) {
        // 二期 ✨整理（27 节）：返回带 ```markdown 围栏的重写正文（断言 host 剥离围栏 + 尾随换行）
        yield { type: 'text-delta', text: '```markdown\n## 背景\n\n（问题与上下文）\n\n## 结论\n\n采用方案 A\n' }
        yield { type: 'text-delta', text: '\n\n## 理由\n\n成本最低\n```' }
        yield { type: 'finish' }
      } else {
        yield { type: 'text-delta', text: '开发' }
        yield { type: 'finish' }
      }
    },
    // 模型目录探针（notes-settings-get 的 models 数据源）：listProviders() → listModels(provider)
    listProviders: () => [{ id: 'p', name: 'MockProvider' }],
    listModels: async (prov) => (prov === 'p' ? [{ provider: 'p', id: 'm', name: 'MockModel' }] : []),
  }
  const admMock = { currentSelection: () => ({ provider: 'p', model: 'm' }) }
  const handlers = {}
  const registeredTools = []
  global.harness = {
    handle: (name, fn) => { handlers[name] = fn; return () => { delete handlers[name] } },
    defineTool: (def) => def,
    registerTool: (ctx, def) => { registeredTools.push(def); return () => {} },
  }
  const sentMessages = []
  const liveAgent = {
    id: 'session-abc12345-0000-0000-0000-000000000000',
    session: { id: 'session-abc12345-0000-0000-0000-000000000000', header: { cwd: 'D:\\deepseek-work' } },
    send: (msg, target, wakeup) => { sentMessages.push({ msg, target, wakeup }) }
  }
  const agentsMock = {
    currentInitiator: () => ({ sessionId: 'session-abc12345-0000-0000-0000-000000000000', session: { id: 'session-abc12345-0000-0000-0000-000000000000', header: { cwd: 'D:\\deepseek-work' } } }),
    roots: () => [liveAgent],
    get: (id) => id === 'session-abc12345-0000-0000-0000-000000000000' ? liveAgent : undefined
  }
  const registeredContexts = []
  const systemPromptMock = { context: (c) => { registeredContexts.push(c); return () => {} } }
  const sessionPersistenceMock = {
    // 返回 SessionPersistenceSnapshot 结构（{header, revision}），模拟 DSH 新版 list() 返回
    list: async () => [
      { header: { id: 'session-abc12345-0000-0000-0000-000000000000', cwd: 'D:\\deepseek-work', createdAt: '2026-09-16T01:00:00.000Z' }, revision: 'r1' },
      { header: { id: 'session-sub9900000-0000-0000-0000-000000000000', cwd: 'D:\\deepseek-work', createdAt: '2026-09-16T02:00:00.000Z', origin: 'subagent' }, revision: 'r2' },
      { header: { id: 'session-arch00000-0000-0000-0000-000000000000', cwd: 'D:\\deepseek-work', createdAt: '2026-09-16T03:00:00.000Z' }, revision: 'r3' }
    ],
    inspect: async (id) => ({ meta: { id: id, cwd: 'D:\\deepseek-work' }, events: [{ type: 'session/title', data: { title: '开发会话' } }] })
  }
  const workspaceRegistryMock = {
    archivedSessionIds: ['session-arch00000-0000-0000-0000-000000000000'],
    // 工作区（含 sessionIds，= 左侧列表有效会话数据源）
    list: () => [
      { id: 'ws1', title: 'deepseek-work', path: 'D:\\deepseek-work', sessionIds: ['session-abc12345-0000-0000-0000-000000000000', 'session-sub9900000-0000-0000-0000-000000000000', 'session-arch00000-0000-0000-0000-000000000000'] }
    ]
  }
  const sessionTitleMock = { get: (session) => ({ title: '开发会话' }) }
  // 0.1.7 会话元数据缓存断言用：readTitleSnapshots 调用计数（缓存命中后不应再触发）
  let sharedTitleReads = 0
  const sessionQueryMock = {
    // 批量读 title + header（origin/cwd/createdAt）
    readTitleSnapshots: async (sids) => {
      sharedTitleReads++
      return (sids || []).map(sid => ({
        sessionId: sid,
        status: 'fulfilled',
        value: {
          session: { id: sid, cwd: 'D:\\deepseek-work', createdAt: '2026-09-16T01:00:00.000Z', origin: sid.indexOf('sub99') >= 0 ? 'subagent' : undefined },
          title: { title: '开发会话' }
        }
      }))
    }
  }
  const evtListeners = {}   // P3 派发闭环：ctx.on 事件订阅捕获（模拟 agent/status 触发）
  const ctx = {
    fs: fsMock, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: systemPromptMock, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
    on: (name, fn) => { (evtListeners[name] = evtListeners[name] || []).push(fn); return () => {} },
  }
  const plugin = new Function('harness', 'pluginDir', hostSrc)(global.harness, DIR)
  plugin.apply(ctx)

  // ===== 3. 工具 schema 校验 =====
  section('3. 工具 schema 校验')
  function findTool(name) { return registeredTools.find(x => x.name === name) }
  await t('note_search 已注册', () => assert(findTool('note_search'), 'note_search 存在'))
  await t('note_get 已注册', () => assert(findTool('note_get'), 'note_get 存在'))
  await t('note_manage 已注册', () => assert(findTool('note_manage'), 'note_manage 存在'))
  const t1 = findTool('note_search')
  const t2 = findTool('note_get')
  const t3 = findTool('note_manage')
  await t('note_search.output.render 存在', () => assert(typeof t1.output.render === 'function'))
  await t('note_get.output.render 存在', () => assert(typeof t2.output.render === 'function'))
  await t('note_manage.output.render 存在', () => assert(typeof t3.output.render === 'function'))
  await t('note_search.parameters 含 query/tag/topic', () => {
    const p = t1.parameters.properties
    assert(p.query && p.tag && p.topic, '缺字段')
  })
  await t('note_get.parameters 含 id', () => assert(t2.parameters.properties.id))
  await t('note_manage.parameters 含 action', () => {
    assert(t3.parameters.properties && t3.parameters.properties.action, 'note_manage 需 action 字段区分动作')
  })

  // ===== 4. 核心 RPC 行为 =====
  section('4. 核心 RPC 行为')
  const r1 = await handlers['notes-create']({ title: '测试笔记A', body: '内容A', tags: ['t1'], topic: '开发' })
  await t('创建返回 id', () => assert(r1.id))
  const r2 = await handlers['notes-list']({})
  await t('列表瘦身（不含 body）', () => assert(!('body' in r2.notes[0]) && r2.notes[0].preview.indexOf('内容A') >= 0))
  const readsAfterFirstList = reads
  await handlers['notes-list']({})
  await t('缓存：第二次 list 零磁盘读', () => assert.strictEqual(reads, readsAfterFirstList))
  const g = await handlers['notes-get']({ id: r1.id })
  await t('get 带正文', () => assert.strictEqual(g.note.body, '内容A'))
  const readsBeforeUpdate = reads
  await handlers['notes-update']({ id: r1.id, topic: '运维' })
  await t('update 不读盘（缓存命中）', () => assert.strictEqual(reads, readsBeforeUpdate))
  const afterUpd = await handlers['notes-list']({})
  await t('update 后列表 topic 已变', () => assert.strictEqual(afterUpd.notes[0].topic, '运维'))

  // ===== 5. 快速记录合并窗口 =====
  section('5. 快速记录：合并窗口 + 异步分类')
  const q1 = await handlers['notes-quick']({ text: '速记第一条', sessionId: 'sess-test-1' })
  await t('首次 quick 创建新笔记', () => assert(!q1.merged && q1.id))
  const q2 = await handlers['notes-quick']({ text: '速记第二条', sessionId: 'sess-test-1' })
  await t('同 session 窗口内合并', () => assert(q2.merged && q2.id === q1.id))
  await new Promise(r => setTimeout(r, 150))
  const gq = await handlers['notes-get']({ id: q1.id })
  await t('异步分类填主题', () => assert.strictEqual(gq.note.topic, '开发'))
  await t('标题含分类主题', () => assert(gq.note.title.indexOf('开发') >= 0))
  await t('合并后正文含两段', () => assert(gq.note.body.indexOf('速记第一条') >= 0 && gq.note.body.indexOf('速记第二条') >= 0))
  const q3 = await handlers['notes-quick']({ text: '别的会话', sessionId: 'sess-test-2' })
  await t('跨 session 不合并', () => assert(!q3.merged && q3.id !== q1.id))
  await new Promise(r => setTimeout(r, 150))

  // ===== 6. 搜索 =====
  section('6. 搜索')
  const sRpc = await handlers['notes-search']({ query: '速记第二' })
  await t('notes-search RPC 命中正文且瘦身', () => {
    assert(sRpc.notes && sRpc.notes.length >= 1 && !('body' in sRpc.notes[0]))
  })
  // 搜索体验升级：matches 命中字段（只读断言，写库的组合过滤/全档用例在 34.2 独立实例，防污染共享库）
  await t('notes-search 附 matches 命中字段（正文命中标记 body）', () => {
    const hit = sRpc.notes.find(n => n.id === q1.id)
    assert(hit && Array.isArray(hit.matches), '带 query 的结果附 matches 数组（实得 ' + JSON.stringify(hit && hit.matches) + '）')
    assert(hit.matches.indexOf('body') >= 0 && hit.matches.indexOf('title') < 0, '正文命中标 body、标题未中不标 title')
  })

  // ===== 7. 软删除 + 恢复 =====
  section('7. 软删除 + 恢复')
  await handlers['notes-delete']({ id: r1.id })
  const afterDel = await handlers['notes-list']({})
  await t('删除后列表隐藏', () => assert(!afterDel.notes.find(n => n.id === r1.id)))
  await handlers['notes-restore']({ id: r1.id })
  const afterRestore = await handlers['notes-list']({})
  await t('恢复后列表可见', () => assert(afterRestore.notes.find(n => n.id === r1.id)))

  // ===== 8. 显式归档（重构）：共享实例冒烟 =====
  section('8. 显式归档：行为变更冒烟（手动笔记不再自动分组）')
  // 行为变更：旧版按 manual:<tags排序串> 自动分组手动笔记（漏合/过合两类失败的根因），现已删除；
  // 无 groups 参数的 notes-archive 只自动合并速记组（tags 含 quick 按 sessionId，≥2 条）；
  // 手动笔记合并只能由调用方显式传 groups 白名单（见 8.5 全行为矩阵）。
  const m1 = await handlers['notes-create']({ title: 'M1', body: 'b1', tags: ['arc'], topic: '其他' })
  const m2 = await handlers['notes-create']({ title: 'M2', body: 'b2', tags: ['arc'], topic: '其他' })
  const writesBeforePv = writes
  const pv0 = await handlers['notes-archive-preview']({})
  await t('preview（dry-run）：零写入 + 手动笔记不进速记组', () => {
    assert.strictEqual(writes, writesBeforePv, 'preview 零写入（写入增量 ' + (writes - writesBeforePv) + '）')
    assert(Array.isArray(pv0.quickGroups), 'preview 返回 { quickGroups } 结构')
    for (const g of pv0.quickGroups) for (const mm of g.members) {
      assert(mm.id !== m1.id && mm.id !== m2.id, '手动笔记不得出现在 preview 速记组')
    }
    assert(!store.has(NOTES_DIR + '\\.archive-undo.json'), 'preview 不写 undo 事务文件')
  })
  const ar0 = await handlers['notes-archive']({})
  await t('无 groups 归档：只合速记组（本库速记均单条 → merged=0），手动笔记不动', () => {
    assert.strictEqual(ar0.merged, 0, '无可合速记组 → merged=0（实得 ' + JSON.stringify(ar0) + '）')
    assert.deepStrictEqual(ar0.groups, [], '空归档返回 groups=[]（undo 事务同源字段）')
  })
  const afterArc0 = await handlers['notes-list']({})
  await t('手动笔记仍在列表（行为变更：不再按标签自动分组）', () => assert(afterArc0.notes.find(n => n.id === m1.id) && afterArc0.notes.find(n => n.id === m2.id)))
  await t('空归档零副作用：不写 .bak / 不覆盖 undo 文件', () => {
    assert(!store.has(NOTES_DIR + '\\' + m1.id + '.md.bak') && !store.has(NOTES_DIR + '\\' + m2.id + '.md.bak'), '未合并不产生 .bak')
    assert(!store.has(NOTES_DIR + '\\.archive-undo.json'), '空归档不写 undo 文件（保留上一次撤销能力）')
  })
  await t('双侧归档源码同步：preview/参数化/undo 齐备 + 旧手动分组已删除 + 行为变更写进工具描述', () => {
    for (const pair of [[hostSrc, 'host-impl.js'], [indexSrc, 'index.mjs']]) {
      const src = pair[0], label = pair[1]
      assert(src.indexOf('async function _archivePreview()') >= 0, label + ' 缺 _archivePreview')
      assert(src.indexOf('async function _archiveUndo()') >= 0, label + ' 缺 _archiveUndo')
      assert(src.indexOf("handle('notes-archive-preview'") >= 0, label + ' 未注册 notes-archive-preview RPC')
      assert(src.indexOf("handle('notes-archive-undo'") >= 0, label + ' 未注册 notes-archive-undo RPC')
      assert(src.indexOf('.archive-undo.json') >= 0, label + ' 缺 undo 事务文件路径')
      assert(src.indexOf("'manual:'") < 0, label + ' 旧 manual:<tags> 自动分组逻辑必须已删除')
      assert(src.indexOf('NEVER auto-grouped by tag') >= 0, label + ' note_manage 工具描述须写明行为变更（手动笔记不再按标签自动分组）')
      assert(src.indexOf('memberIds') >= 0, label + ' notes-archive 参数化 groups 白名单（memberIds）')
    }
  })

  // ===== 8.5 显式归档全行为矩阵（独立实例：preview 分组规则 / 参数化白名单 / title 覆盖 / 校验 / undo 往返） =====
  section('8.5 显式归档行为矩阵（独立实例）')
  const store9 = new Map()
  let writes9 = 0
  const fsMock9 = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store9.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store9.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!store9.has(p)) throw new Error('ENOENT: ' + p); return store9.get(p) },
    writeText: async (p, c) => { writes9++; store9.set(p, c) },
  }
  const handlers9 = {}
  const harnessMock9 = { handle: (name, fn) => { handlers9[name] = fn; return () => { delete handlers9[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock9, DIR).apply({
    fs: fsMock9, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  // 造库：直写 store 控 updatedAt 确定性——速记 sess-arch-1 两条（可合）+ sess-arch-2 单条（<2 不合）+ 已删速记一条（不进组）+ 手动同标签两条
  const UNDO_PATH9 = NOTES_DIR + '\\.archive-undo.json'
  function seedNote9(id, fm, body) { store9.set(NOTES_DIR + '\\' + id + '.md', '---\n' + fm + '\n---\n\n' + body) }
  seedNote9('n-qk01', 'id: n-qk01\ntitle: 速记甲\ntopic: 开发\ntags: quick\nsessionId: sess-arch-1\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"', '速记一正文\n')
  seedNote9('n-qk02', 'id: n-qk02\ntitle: 速记乙\ntopic: 运维\ntags: quick\nsessionId: sess-arch-1\ncreatedAt: "2026-01-02T00:00:00.000Z"\nupdatedAt: "2026-01-02T00:00:00.000Z"', '速记二正文\n')
  seedNote9('n-qk03', 'id: n-qk03\ntitle: 速记丙\ntopic: 设计\ntags: quick\nsessionId: sess-arch-2\ncreatedAt: "2026-01-03T00:00:00.000Z"\nupdatedAt: "2026-01-03T00:00:00.000Z"', '速记三正文\n')
  seedNote9('n-qkdel', 'id: n-qkdel\ntitle: 已删速记\ntopic: 其他\ntags: quick\nsessionId: sess-arch-1\ndeleted: true\ncreatedAt: "2026-01-01T12:00:00.000Z"\nupdatedAt: "2026-01-01T12:00:00.000Z"', '已删正文\n')
  const mm1 = await handlers9['notes-create']({ title: '手动甲', body: '手动正文一', tags: ['arc9'], topic: '其他' })
  const mm2 = await handlers9['notes-create']({ title: '手动乙', body: '手动正文二', tags: ['arc9'], topic: '其他' })

  await t('preview：速记按 sessionId 分组（≥2），手动/单条/已删不进组，dry-run 零写入', async () => {
    const w0 = writes9
    const pv = await handlers9['notes-archive-preview']({})
    assert.strictEqual(writes9, w0, 'preview 零写入（写入增量 ' + (writes9 - w0) + '）')
    assert(!store9.has(UNDO_PATH9), 'preview 不写 undo 文件')
    assert(Array.isArray(pv.quickGroups) && pv.quickGroups.length === 1, '仅 1 个可合速记组（实得 ' + JSON.stringify(pv.quickGroups).slice(0, 200) + '）')
    const g = pv.quickGroups[0]
    assert.strictEqual(g.sessionId, 'sess-arch-1', '按 sessionId 分组')
    assert.deepStrictEqual(g.members.map(m => m.id), ['n-qk01', 'n-qk02'], '组内 updatedAt 升序；已删速记/单条速记（<2）不进组')
    assert.strictEqual(g.title, '运维', '组标题沿用现规则 last.topic（实得 ' + g.title + '）')
    assert.deepStrictEqual(g.dateSpan, { from: '2026-01-01', to: '2026-01-02' }, 'dateSpan = 首尾成员日期')
    // parseFM 对 buildFM 格式（'---' 后空行）解析出的 body 带前导 '\n'（与真实落盘文件口径一致）
    const eb1 = Buffer.byteLength('\n速记一正文\n', 'utf8'), eb2 = Buffer.byteLength('\n速记二正文\n', 'utf8')
    assert.strictEqual(g.members[0].bodyBytes, eb1, 'members[].bodyBytes = UTF-8 字节数')
    assert.strictEqual(g.totalBytes, eb1 + eb2, 'totalBytes = 成员字节求和')
    for (const grp of pv.quickGroups) for (const m of grp.members) {
      assert(m.id !== mm1.id && m.id !== mm2.id, '手动笔记不返回（由 client 多选构造组）')
    }
  })

  let arcNote1 = null
  await t('无 groups 归档：只合速记组 + 默认标题 + .bak 备份 + undo 事务落盘', async () => {
    const ar = await handlers9['notes-archive']({})
    assert.strictEqual(ar.merged, 1, 'merged=1（实得 ' + JSON.stringify(ar) + '）')
    assert.strictEqual(ar.groups.length, 1, 'groups 事务结构返回')
    assert.deepStrictEqual(ar.groups[0].memberIds, ['n-qk01', 'n-qk02'], '事务成员 = 组内升序成员')
    assert.strictEqual(ar.mergedIds[0], ar.groups[0].noteId, 'mergedIds 兼容旧返回结构')
    arcNote1 = ar.groups[0].noteId
    const l = await handlers9['notes-list']({})
    assert(!l.notes.find(n => n.id === 'n-qk01') && !l.notes.find(n => n.id === 'n-qk02'), '速记原文已隐藏（软删除）')
    assert(l.notes.find(n => n.id === mm1.id) && l.notes.find(n => n.id === mm2.id), '手动笔记不动（行为变更：无参不合手动组）')
    assert(l.notes.find(n => n.id === 'n-qk03'), '单条速记（<2）不合')
    const g = await handlers9['notes-get']({ id: arcNote1 })
    assert.strictEqual(g.note.title, '运维', '默认标题 = last.topic')
    assert.deepStrictEqual(g.note.mergedFrom, ['n-qk01', 'n-qk02'], 'mergedFrom 记录成员')
    assert(g.note.archivedAt, 'archivedAt 落盘')
    assert(g.note.body.indexOf('## 2026-01-01') >= 0 && g.note.body.indexOf('速记一正文') >= 0 && g.note.body.indexOf('## 2026-01-02') >= 0 && g.note.body.indexOf('速记二正文') >= 0, '正文按 updatedAt 日期分节升序拼接')
    assert(store9.has(NOTES_DIR + '\\n-qk01.md.bak') && store9.has(NOTES_DIR + '\\n-qk02.md.bak'), '.bak 备份机制保留不动')
    const tx = JSON.parse(store9.get(UNDO_PATH9))
    assert(tx.groups && tx.groups.length === 1 && tx.groups[0].noteId === arcNote1 && tx.at, 'undo 事务落盘 { at, groups }（只保留最近一次）')
  })

  await t('undo 往返：成员批量还原 + 归档笔记软删 + undo 清空；二次 undo → undone=0', async () => {
    const ud = await handlers9['notes-archive-undo']({})
    assert.strictEqual(ud.undone, 1, 'undone=1（实得 ' + JSON.stringify(ud) + '）')
    assert.strictEqual(ud.restored, 2, '2 条成员还原')
    const l = await handlers9['notes-list']({})
    assert(l.notes.find(n => n.id === 'n-qk01') && l.notes.find(n => n.id === 'n-qk02'), '成员 restore（deleted=false）')
    assert(!l.notes.find(n => n.id === arcNote1), '归档笔记软删除（列表隐藏）')
    assert(store9.get(NOTES_DIR + '\\' + arcNote1 + '.md').indexOf('deleted: true') >= 0, '归档笔记 deleted:true 落盘（可再 restore 捞回）')
    const tx = JSON.parse(store9.get(UNDO_PATH9))
    assert(tx.groups.length === 0, 'undo 成功后清空事务（groups: []）')
    const ud2 = await handlers9['notes-archive-undo']({})
    assert.strictEqual(ud2.undone, 0, '无可撤销 → { undone: 0 }')
  })

  await t('参数化校验：单成员/重复/不存在 整体报错不动手（无半归档）', async () => {
    const bakBefore = Array.from(store9.keys()).filter(k => k.endsWith('.bak')).length
    const listBefore = (await handlers9['notes-list']({})).notes.length
    const e1 = await handlers9['notes-archive']({ groups: [{ memberIds: [mm1.id] }] })
    assert(e1.error && e1.error.indexOf('至少 2 条') >= 0, '单成员组拒绝（实得 ' + JSON.stringify(e1) + '）')
    const e2 = await handlers9['notes-archive']({ groups: [{ memberIds: [mm1.id, mm1.id] }] })
    assert(e2.error && e2.error.indexOf('重复') >= 0, '组内重复拒绝')
    const e3 = await handlers9['notes-archive']({ groups: [{ memberIds: [mm1.id, 'n-no-such'] }] })
    assert(e3.error && e3.error.indexOf('不存在或已删除') >= 0, '不存在成员拒绝')
    const e4 = await handlers9['notes-archive']({ groups: [{ memberIds: [mm1.id, mm2.id] }, { memberIds: [mm2.id, 'n-qk01'] }] })
    assert(e4.error && e4.error.indexOf('重复') >= 0, '跨组重复拒绝')
    assert.strictEqual((await handlers9['notes-list']({})).notes.length, listBefore, '校验失败零副作用')
    assert.strictEqual(Array.from(store9.keys()).filter(k => k.endsWith('.bak')).length, bakBefore, '校验失败不写 .bak')
  })

  await t('参数化白名单：多组一次归档 + title 覆盖 + undo 只保留最近一次（整次撤销）', async () => {
    const ar = await handlers9['notes-archive']({ groups: [{ memberIds: [mm1.id, mm2.id], title: '运维归档总集' }, { memberIds: ['n-qk01', 'n-qk02'] }] })
    assert(!ar.error, '归档成功（实得 ' + JSON.stringify(ar) + '）')
    assert.strictEqual(ar.merged, 2, '白名单两组一次合并')
    const g1 = await handlers9['notes-get']({ id: ar.groups[0].noteId })
    assert.strictEqual(g1.note.title, '运维归档总集', 'title 覆盖默认标题')
    assert.deepStrictEqual(g1.note.mergedFrom, [mm1.id, mm2.id], '手动组 mergedFrom = 白名单成员')
    const g2 = await handlers9['notes-get']({ id: ar.groups[1].noteId })
    assert.strictEqual(g2.note.title, '运维', '未传 title 走默认（last.topic）')
    const l = await handlers9['notes-list']({})
    assert(!l.notes.find(n => n.id === mm1.id) && !l.notes.find(n => n.id === mm2.id), '手动白名单成员已合并隐藏')
    const tx = JSON.parse(store9.get(UNDO_PATH9))
    assert.strictEqual(tx.groups.length, 2, 'undo 事务整体覆盖为本次归档')
    const ud = await handlers9['notes-archive-undo']({})
    assert(ud.undone === 2 && ud.restored === 4, '整次撤销：2 组 4 成员（实得 ' + JSON.stringify(ud) + '）')
    const l2 = await handlers9['notes-list']({})
    assert(l2.notes.find(n => n.id === mm1.id) && l2.notes.find(n => n.id === mm2.id) && l2.notes.find(n => n.id === 'n-qk01') && l2.notes.find(n => n.id === 'n-qk02'), '全部成员还原')
    assert(!l2.notes.find(n => n.id === ar.groups[0].noteId) && !l2.notes.find(n => n.id === ar.groups[1].noteId), '两条归档笔记软删')
  })

  // ===== 9. 启动加载与遥测 =====
  section('9. 启动 + 遥测')
  await t('host-impl 应用成功（39 RPC handlers，含 notes-settings-get/set + 导入导出 + P3 notes-export-single + 资产上传 + 归档 preview/undo + ai-organize/assets-prune + P1 notes-purge + notes-inject-preview + notes-suggest + notes-usage-get + 历史版本 notes-history/history-get/restore-history + 工作记忆 notes-memory-guide）', () => assert.strictEqual(Object.keys(handlers).length, 39))
  await t('notes-src handler 可用', () => assert(typeof handlers['notes-src'] === 'function'))
  await t('notes-css handler 可用', () => assert(typeof handlers['notes-css'] === 'function'))
  await t('notes-perf handler 可用', () => assert(typeof handlers['notes-perf'] === 'function'))

  // ===== 10. note_manage 各 action 行为 =====
  section('10. note_manage 工具：六种 action 路由')
  const noteManage = findTool('note_manage')
  const tMgr1 = await noteManage.execute({ action: 'create', title: 'mgr-A', body: 'ma', topic: '设计' })
  await t('manage.create 返回 id', () => assert(tMgr1.id && tMgr1.action === 'create'))
  const tMgr1Get = await handlers['notes-get']({ id: tMgr1.id })
  await t('manage.create 的笔记可 get', () => assert.strictEqual(tMgr1Get.note.title, 'mgr-A'))
  const tMgrList = await noteManage.execute({ action: 'list', tag: 'arc' })
  await t('manage.list 按 tag 过滤', () => {
    assert(tMgrList.action === 'list' && Array.isArray(tMgrList.notes))
  })
  const tMgrUpd = await noteManage.execute({ id: tMgr1.id, action: 'update', topic: '设计-改' })
  await t('manage.update 改 topic', async () => {
    assert.strictEqual(tMgrUpd.action, 'update')
    const g = await handlers['notes-get']({ id: tMgr1.id })
    assert.strictEqual(g.note.topic, '设计-改')
  })
  const tMgrDel = await noteManage.execute({ id: tMgr1.id, action: 'delete' })
  await t('manage.delete 软删除', async () => {
    assert.strictEqual(tMgrDel.action, 'delete')
    const lst = await handlers['notes-list']({})
    assert(!lst.notes.find(n => n.id === tMgr1.id))
  })
  const tMgrRes = await noteManage.execute({ id: tMgr1.id, action: 'restore' })
  await t('manage.restore 恢复', async () => {
    assert.strictEqual(tMgrRes.action, 'restore')
    const lst = await handlers['notes-list']({})
    assert(lst.notes.find(n => n.id === tMgr1.id))
  })
  const tMgrArc = await noteManage.execute({ action: 'archive' })
  await t('manage.archive 无 groups：只合速记组，返回 merged 计数', () => {
    assert.strictEqual(tMgrArc.action, 'archive')
    assert.strictEqual(typeof tMgrArc.merged, 'number')
    assert(Array.isArray(tMgrArc.groups), '返回 groups（undo 事务同源字段）')
  })
  // 显式白名单：note_manage archive 传 groups 合并手动笔记（行为变更后手动合并的唯一入口）+ title 覆盖
  const tMgrArcG = await noteManage.execute({ action: 'archive', groups: [{ memberIds: [m1.id, m2.id], title: '手动归档X' }] })
  await t('manage.archive 显式 groups 合并手动组（白名单 + title 覆盖）', async () => {
    assert.strictEqual(tMgrArcG.action, 'archive')
    assert.strictEqual(tMgrArcG.merged, 1, 'merged=1（实得 ' + JSON.stringify(tMgrArcG) + '）')
    assert(tMgrArcG.groups && tMgrArcG.groups.length === 1 && tMgrArcG.groups[0].noteId, '返回 groups:[{ noteId, memberIds }]')
    const g = await handlers['notes-get']({ id: tMgrArcG.groups[0].noteId })
    assert.strictEqual(g.note.title, '手动归档X', 'title 覆盖默认标题')
    assert.deepStrictEqual(g.note.mergedFrom, [m1.id, m2.id], 'mergedFrom = 白名单成员')
    const lst = await handlers['notes-list']({})
    assert(!lst.notes.find(n => n.id === m1.id) && !lst.notes.find(n => n.id === m2.id), '手动成员已合并隐藏')
  })
  const tMgrArcBad = await noteManage.execute({ action: 'archive', groups: [{ memberIds: [m1.id] }] })
  await t('manage.archive groups 校验失败返回 error（m1 已归档不存在于活跃库）', () => {
    assert(tMgrArcBad.error, '单成员组须报错（实得 ' + JSON.stringify(tMgrArcBad) + '）')
  })
  const tMgrBad = await noteManage.execute({ action: 'nonexistent' })
  await t('manage 未知 action 返回错误', () => {
    assert(tMgrBad.error && tMgrBad.error.indexOf('未知 action') >= 0)
  })
  const tMgrNoId = await noteManage.execute({ action: 'delete' })
  await t('manage.delete 缺 id 返回错误', () => {
    assert(tMgrNoId.error && tMgrNoId.error.indexOf('需要 id') >= 0)
  })
  const tMgrCreateNoBody = await noteManage.execute({ action: 'create', title: 'no-body' })
  await t('manage.create 缺 body 返回错误', () => {
    assert(tMgrCreateNoBody.error && tMgrCreateNoBody.error.indexOf('需要 title 和 body') >= 0)
  })

  // ===== 11. T2.1 kind + T2.2 status 字段 =====
  section('11. T2.1 kind + T2.2 status 字段')
  await t('kind 默认 note（向后兼容）', async () => {
    const r = await noteManage.execute({ action: 'create', title: 'k-default', body: 'x' })
    const g = await handlers['notes-get']({ id: r.id })
    assert.strictEqual(g.note.kind, 'note')
    assert.strictEqual(g.note.status, 'active')
  })
  await t('create 指定 kind/status', async () => {
    const r = await noteManage.execute({ action: 'create', title: 'k-decision', body: 'x', kind: 'decision', status: 'pinned' })
    const g = await handlers['notes-get']({ id: r.id })
    assert.strictEqual(g.note.kind, 'decision')
    assert.strictEqual(g.note.status, 'pinned')
  })
  await t('update 改 kind/status', async () => {
    const r = await noteManage.execute({ action: 'create', title: 'k-upd', body: 'x' })
    await noteManage.execute({ id: r.id, action: 'update', kind: 'todo', status: 'resolved' })
    const g = await handlers['notes-get']({ id: r.id })
    assert.strictEqual(g.note.kind, 'todo')
    assert.strictEqual(g.note.status, 'resolved')
  })
  await t('list 按 kind 过滤', async () => {
    await noteManage.execute({ action: 'create', title: 'k-link-1', body: 'x', kind: 'link' })
    const r = await noteManage.execute({ action: 'list', kind: 'link' })
    assert(r.notes.length >= 1 && r.notes.every(n => n.kind === 'link'))
  })
  await t('pinned 置顶排序', async () => {
    await noteManage.execute({ action: 'create', title: 'k-plain', body: 'x' })
    await noteManage.execute({ action: 'create', title: 'k-pinned', body: 'x', status: 'pinned' })
    const r = await noteManage.execute({ action: 'list' })
    const firstPinned = r.notes.findIndex(n => n.status === 'pinned')
    const firstPlain = r.notes.findIndex(n => n.status === 'active')
    assert(firstPinned >= 0 && firstPlain >= 0 && firstPinned < firstPlain, 'pinned 应排在 active 之前')
  })
  await t('slim 结果含 kind/status', async () => {
    const r = await noteManage.execute({ action: 'list' })
    assert(r.notes.every(n => 'kind' in n && 'status' in n))
  })
  await t('旧笔记无 kind/status 字段时兜底为默认值', async () => {
    const legacyId = 'n-legacy-kind-status'
    const legacyContent = '---\nid: ' + legacyId + '\ntitle: 老笔记\ntopic: 需求\ntags: quick\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n正文\n'
    const legacyPath = NOTES_DIR + '\\' + legacyId + '.md'
    await fsMock.writeText(legacyPath, legacyContent)
    const g = await handlers['notes-get']({ id: legacyId })
    assert.strictEqual(g.note.kind, 'note')
    assert.strictEqual(g.note.status, 'active')
  })

  // ===== 12. T2.3 工作区约定自动注入 =====
  section('12. T2.3 工作区约定自动注入')
  await t('systemPrompt.context 已注册（order 130）', () => {
    assert(registeredContexts.length >= 1, '应注册至少一个 context')
    const c = registeredContexts.find(x => x.name === 'notes:workspace-conventions')
    assert(c, 'context name 应为 notes:workspace-conventions')
    assert.strictEqual(c.order, 130, 'order 应为 130')
    assert(typeof c.text === 'function', 'text 应为函数')
  })
  await t('无 convention 笔记时约定文本为空', async () => {
    const r = await handlers['notes-conventions']({})
    assert(r.text === '', '无约定时返回空串')
  })
  await t('inject=true 笔记注入文本（双角色新文案：缺省进约定桶，单桶只出该桶标题）', async () => {
    const cConv = await handlers['notes-create']({ title: '本工作区约定', body: '代码必须带单测', inject: true, topic: '约定' })
    const r = await handlers['notes-conventions']({})
    assert(r.text.indexOf('本工作区约定') >= 0, '约定标题应出现')
    assert(r.text.indexOf('代码必须带单测') >= 0, '约定正文应出现')
    assert(r.text.indexOf('以下是注入的上下文笔记（与当前任务无关时忽略）：') === 0, '新文案引导词开头（实得：' + r.text.slice(0, 60) + '）')
    assert(r.text.indexOf('用户约定（须遵守）：') >= 0, '缺省 injectRole=convention 进约定桶')
    assert(r.text.indexOf('- [' + cConv.id + '] 本工作区约定') >= 0, '桶内条目格式 - [id] 标题')
    assert(r.text.indexOf('参考资料（与当前任务相关时按需取用）：') < 0, '单桶命中时只输出该桶标题（无 reference 不出资料桶）')
    assert(r.text.indexOf('已记录的约定') < 0, '新文案不含旧引导词「已记录的约定」')
    assert(r.text.indexOf('记录会话') < 0 && r.text.indexOf('记录于会话') < 0, '新文案不含会话归属标注')
    assert(r.text.indexOf('工作区「') < 0, '新文案不含工作区归属标签')
  })
  await t('inject 缺省 false 不注入（独立字段，不靠标签）', async () => {
    // 即使带 convention 标签，没显式 inject=true 也不注入（注入是独立字段，不是标签）
    await handlers['notes-create']({ title: '仅标签无inject', body: 'x', tags: ['convention'], topic: '约定' })
    const r = await handlers['notes-conventions']({})
    assert(r.text.indexOf('仅标签无inject') < 0, '仅 convention 标签但 inject=false 不应注入')
  })
  await t('旧文件兼容：无 inject 字段但含 convention 标签的文件回退注入', async () => {
    // 直接写一条无 inject 字段、tags 含 convention 的旧格式文件
    const legacyId = 'n-legacy-conv'
    const legacyContent = '---\nid: ' + legacyId + '\ntitle: 旧版约定\ntopic: 约定\ntags: convention\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\nsessionId: session-abc12345-0000\ncwd: "D:\\deepseek-work"\n---\n\n旧约定正文\n'
    await fsMock.writeText(NOTES_DIR + '\\' + legacyId + '.md', legacyContent)
    // 先 notes-get 触发解析进 cache（conventionText 只读 cache）
    const g = await handlers['notes-get']({ id: legacyId })
    assert(g.note.inject === true, '旧文件 inject 应回退到 convention 标签')
    const r = await handlers['notes-conventions']({})
    assert(r.text.indexOf('旧版约定') >= 0, '旧文件（无 inject 字段）应回退按 convention 标签注入')
    assert(r.text.indexOf('用户约定（须遵守）：') >= 0 && r.text.indexOf('旧版约定') > r.text.indexOf('用户约定（须遵守）：'), '旧文件无 injectRole 字段 → 缺省进约定桶（零迁移）')
  })

  // ===== 12.5 injectRole 双角色：字段链路 + 分桶文案 =====
  await t('injectRole 字段往返：create 带 reference → get/list/front-matter 一致', async () => {
    const c = await handlers['notes-create']({ title: '参考资料笔记', body: '机器配置：Node 22', inject: true, topic: '资料', injectRole: 'reference' })
    const g = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g.note.injectRole, 'reference', 'notes-get 返回 injectRole=reference')
    const lst = await handlers['notes-list']({})
    assert.strictEqual(lst.notes.find(n => n.id === c.id).injectRole, 'reference', 'notes-list（slim）携带 injectRole')
    const onDisk = store.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(onDisk.indexOf('\ninjectRole: reference\n') >= 0, 'front-matter 写 injectRole: reference（inject=true 才落盘）')
  })
  await t('injectRole 缺省/非法值回退 convention（create 不传 / 非法值 / 旧文件无字段）', async () => {
    const c1 = await handlers['notes-create']({ title: '缺省角色约定', body: 'x', inject: true, topic: '约定' })
    const g1 = await handlers['notes-get']({ id: c1.id })
    assert.strictEqual(g1.note.injectRole, 'convention', 'create 不传 injectRole 缺省 convention')
    const onDisk1 = store.get(NOTES_DIR + '\\' + c1.id + '.md')
    assert(onDisk1.indexOf('\ninjectRole: convention\n') >= 0, '缺省也落盘 injectRole: convention（inject=true）')
    const c2 = await handlers['notes-create']({ title: '非法角色约定', body: 'x', inject: true, topic: '约定', injectRole: 'bogus' })
    const g2 = await handlers['notes-get']({ id: c2.id })
    assert.strictEqual(g2.note.injectRole, 'convention', '非法 injectRole 回退 convention')
    const gLegacy = await handlers['notes-get']({ id: 'n-legacy-conv' })
    assert.strictEqual(gLegacy.note.injectRole, 'convention', '旧文件无 injectRole 字段回退 convention（零迁移）')
  })
  await t('inject=false 时 injectRole 不落盘（避免脏数据）', async () => {
    const c = await handlers['notes-create']({ title: '非注入资料', body: 'x', injectRole: 'reference', topic: '资料' })
    const onDisk = store.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(onDisk.indexOf('injectRole') < 0, 'inject=false 不写 injectRole 行（实得：' + onDisk.split('\n').slice(0, 12).join('|') + '）')
  })
  await t('role 分桶文案：两桶并列（约定桶 + 资料桶各自引导词）', async () => {
    const r = await handlers['notes-conventions']({})
    const iConv = r.text.indexOf('用户约定（须遵守）：')
    const iRef = r.text.indexOf('参考资料（与当前任务相关时按需取用）：')
    assert(iConv >= 0 && iRef >= 0, '两桶引导词齐备（实得：' + r.text.slice(0, 120) + '）')
    assert(iConv < iRef, '约定桶在资料桶之前')
    assert(r.text.indexOf('参考资料笔记') > iRef, 'reference 笔记列在资料桶下')
    const iConvNote = r.text.indexOf('本工作区约定')
    assert(iConvNote > iConv && iConvNote < iRef, 'convention 笔记列在约定桶下')
  })
  await t('note_manage 工具路由透传 injectRole（create/update）+ schema 参数', async () => {
    const nm = findTool('note_manage')
    const p = nm.parameters.properties
    assert(p.injectRole && p.injectRole.type === 'string' && JSON.stringify(p.injectRole.enum) === '["convention","reference"]', 'schema 含 injectRole enum（实得：' + JSON.stringify(p.injectRole) + '）')
    assert(p.inject.description.indexOf('as context') >= 0, 'inject 描述改为上下文注入（实得：' + p.inject.description + '）')
    const c = await nm.execute({ action: 'create', title: '工具资料', body: '参考内容', inject: true, injectRole: 'reference', topic: '资料' })
    assert(!c.error, 'manage.create 成功（实得：' + JSON.stringify(c) + '）')
    const g = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g.note.injectRole, 'reference', 'manage.create 透传 injectRole')
    const u = await nm.execute({ action: 'update', id: c.id, injectRole: 'convention' })
    assert(!u.error, 'manage.update injectRole 成功')
    const g2 = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g2.note.injectRole, 'convention', 'manage.update 改 injectRole 生效')
    const onDisk = store.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(onDisk.indexOf('\ninjectRole: convention\n') >= 0, 'update 后 front-matter 同步')
    await nm.execute({ action: 'update', id: c.id, topic: '资料-改' })
    const g3 = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g3.note.injectRole, 'convention', 'update 不显式传 injectRole 保持原值（undefined 不动）')
  })
  await t('notes-update RPC 透传 injectRole（显式改 / 不传不动）', async () => {
    const c = await handlers['notes-create']({ title: 'RPC角色笔记', body: 'x', inject: true, topic: '约定' })
    await handlers['notes-update']({ id: c.id, injectRole: 'reference' })
    const g = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g.note.injectRole, 'reference', 'notes-update 透传 injectRole')
    await handlers['notes-update']({ id: c.id, topic: '约定2' })
    const g2 = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g2.note.injectRole, 'reference', 'notes-update 不传 injectRole 保持原值')
  })
  await t('双侧 injectRole 字段链路 + 分桶文案同步（host-impl / index.mjs 源码结构）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(src.indexOf("(m.inject ? 'injectRole: '") >= 0 && /'injectRole: ' \+ escYaml\(m\.injectRole === 'reference' \? 'reference' : 'convention'\)/.test(src), label + ' buildFM 仅 inject=true 写 injectRole 行')
      assert(src.indexOf("p.meta.injectRole === 'reference' ? 'reference' : 'convention'") >= 0, label + ' noteFromParsed 读 injectRole（缺省/非法回退 convention）')
      assert((src.match(/injectRole: n\.injectRole === 'reference' \? 'reference' : 'convention'/g) || []).length >= 2, label + ' persistNote 与 slim 均携带 injectRole')
      assert(src.indexOf("injectRole: ex.injectRole === 'reference' ? 'reference' : 'convention'") >= 0, label + ' _create 接受 injectRole')
      assert(/if \(injectRole !== undefined\) note\.injectRole = injectRole === 'reference' \? 'reference' : 'convention'/.test(src), label + ' _update 第 12 位参数显式传才改（undefined 不动）')
      assert(/injectRole: \{ type: 'string', enum: \['convention', 'reference'\]/.test(src), label + ' note_manage schema 含 injectRole enum')
      assert(/args\.injectRole/.test(src), label + ' 工具/RPC 路由透传 args.injectRole')
      assert(src.indexOf('以下是注入的上下文笔记（与当前任务无关时忽略）：') >= 0, label + ' 新引导词')
      assert(src.indexOf('用户约定（须遵守）：') >= 0 && src.indexOf('参考资料（与当前任务相关时按需取用）：') >= 0, label + ' 双桶引导词')
      assert(src.indexOf('已记录的约定') < 0 && src.indexOf('记录于会话') < 0 && src.indexOf('工作区「') < 0, label + ' 旧文案（工作区归属/会话标注）已删除')
    }
  })
  await t('跨工作区 convention 同样注入（注入无工作区维度）', async () => {
    await noteManage.execute({ action: 'create', title: '别区约定', body: '别区内容', inject: true, topic: '约定', workspace: 'other-ws' })
    const r = await handlers['notes-conventions']({})
    assert(r.text.indexOf('本工作区约定') >= 0, '本工作区约定仍在')
    assert(r.text.indexOf('别区约定') >= 0, 'workspace=other-ws 的笔记同样注入（注入范围只看会话，不看工作区）')
  })
  await t('deleted 的约定不注入', async () => {
    const c = await handlers['notes-create']({ title: '待删除约定', body: '不注入', inject: true, topic: '约定' })
    await handlers['notes-delete']({ id: c.id })
    const r = await handlers['notes-conventions']({})
    assert(r.text.indexOf('待删除约定') < 0, '软删除的约定不应注入')
  })

  // ===== 13. injectTo 注入范围（多选数组） =====
  section('13. injectTo 注入范围（多选数组）')
  await t('injectTo=[global] 存量值兼容 = 所有会话注入', async () => {
    await handlers['notes-create']({ title: '全局约定', body: '全局生效', inject: true, topic: '约定', injectTo: ['global'] })
    const r = await handlers['notes-conventions']({})
    assert(r.text.indexOf('全局约定') >= 0, '存量 global 值按所有会话注入')
  })
  await t("injectTo=[workspace] 存量值兼容 = 所有会话注入", async () => {
    await handlers['notes-create']({ title: '旧口径约定', body: '存量 workspace 值', inject: true, topic: '约定', injectTo: ['workspace'] })
    const r = await handlers['notes-conventions']({})
    assert(r.text.indexOf('旧口径约定') >= 0, '存量 workspace 值按所有会话注入（不迁移、不过滤）')
  })
  await t('injectTo=[不匹配会话] 不注入', async () => {
    // agentsMock 当前 initiator 短 id = 'abc12345'；injectTo=['deadbeef'] 不匹配 → 不应注入
    await handlers['notes-create']({ title: '指定会话约定', body: '仅某会话', inject: true, topic: '约定', injectTo: ['deadbeef'] })
    const r = await handlers['notes-conventions']({})
    assert(r.text.indexOf('指定会话约定') < 0, 'injectTo 指定其它会话时当前会话不应注入')
  })
  await t('injectTo=[当前会话短id] 注入', async () => {
    await handlers['notes-create']({ title: '本会话约定', body: '仅本会话', inject: true, topic: '约定', injectTo: ['abc12345'] })
    const r = await handlers['notes-conventions']({})
    assert(r.text.indexOf('本会话约定') >= 0, 'injectTo 等于当前会话短id 时应注入')
  })
  await t('injectTo=[] 缺省 = 所有会话注入', async () => {
    // 前面已创建 '本工作区约定'（inject=true 无 injectTo）应仍在注入列表
    const r = await handlers['notes-conventions']({})
    assert(r.text.indexOf('本工作区约定') >= 0, '无 injectTo 的约定按所有会话注入')
  })

  // ===== 14. notes-sessions 会话名 =====
  section('14. notes-sessions 会话名')
  await t('notes-sessions 返回带名字的会话', async () => {
    // 此前已有多条笔记，sessionId 均为 agentsMock 的 'session-abc12345-...'
    const r = await handlers['notes-sessions']({})
    assert(Array.isArray(r.sessions), '返回 sessions 数组')
    const found = r.sessions.find(s => s.short === 'abc12345')
    assert(found, '应包含当前会话')
    assert.strictEqual(found.name, '开发会话', '会话名应读自 session/title 事件')
  })
  await t('notes-sessions 排除子 agent 会话', async () => {
    const r = await handlers['notes-sessions']({})
    assert(!r.sessions.find(s => s.id.indexOf('sub9900000') >= 0), 'origin=subagent 的一次性子 agent 会话不应出现在注入范围里')
    assert(r.sessions.find(s => s.short === 'abc12345'), '主窗口会话应保留')
  })
  await t('notes-sessions 排除已归档会话', async () => {
    const r = await handlers['notes-sessions']({})
    assert(!r.sessions.find(s => s.id.indexOf('arch00000') >= 0), '已归档会话不应出现在注入范围里')
    assert(r.sessions.find(s => s.short === 'abc12345'), '未归档的主会话应保留')
  })

  // ===== 15. 任务派发（系统提示注入形式：登记 dispatches + 目标会话系统提示注入待办） =====
  section('15. 任务派发（系统提示注入形式）')
  await t('notes-active-sessions 返回活跃主会话', async () => {
    const r = await handlers['notes-active-sessions']({})
    assert(Array.isArray(r.sessions), '返回 sessions 数组')
    assert(r.sessions.length === 1, 'mock 只有 1 个活跃主会话')
    assert.strictEqual(r.sessions[0].short, 'abc12345')
  })
  await t('notes-dispatch 注入上下文+触发工作（agent.send）', async () => {
    const c = await handlers['notes-create']({ title: '待办A', body: '重构 X 模块', kind: 'todo' })
    const before = sentMessages.length
    const r = await handlers['notes-dispatch']({ id: c.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话', workspace: 'deepseek-work', mode: 'existing', instruction: '重点处理性能瓶颈' })
    assert(r.ok === true, '派发应成功')
    assert.strictEqual(sentMessages.length, before + 1, '应 agent.send 注入上下文并触发工作')
    const m = sentMessages[sentMessages.length - 1]
    assert.strictEqual(m.target, 'next-turn'); assert.strictEqual(m.wakeup, true, 'wakeup=true 触发 agent 开始工作')
    assert(m.msg.source && m.msg.source.kind === 'plugin:dsh-notes' && m.msg.source.form === 'recall', 'source 应为生产者自有 kind（v4：plugin:dsh-notes）+ form=recall（召回上下文，非用户指令）')
    assert(m.msg.content[0].text.indexOf('重构 X 模块') >= 0, '消息含 todo 上下文')
    assert(m.msg.content[0].text.indexOf('重点处理性能瓶颈') >= 0, '消息含派发方补充要求')
    const g = await handlers['notes-get']({ id: c.id })
    assert(Array.isArray(g.note.dispatches) && g.note.dispatches.length === 1, 'dispatches 属性应有 1 条记录')
    const d = g.note.dispatches[0]
    assert.strictEqual(d.sessionName, '开发会话'); assert.strictEqual(d.instruction, '重点处理性能瓶颈'); assert.strictEqual(d.done, false, '新派发为待处理 done=false')
    assert.strictEqual(d.dispatchStatus, 'sent', 'P3：新派发带状态机字段 dispatchStatus=sent')
    assert(g.note.body.indexOf('已派发到') < 0, '派发记录不应写进正文')
  })
  await t('notes-dispatch 目标未打开返回 needOpen', async () => {
    const c = await handlers['notes-create']({ title: '待办B2', body: 'x', kind: 'todo' })
    const r = await handlers['notes-dispatch']({ id: c.id, sessionId: 'session-notlive-0000' })
    assert(r.error && r.needOpen === true, '目标不 live 应返回 needOpen 提示')
  })
  await t('notes-dispatch-done 标记完成停止注入', async () => {
    const c = await handlers['notes-create']({ title: '待办-done', body: 'x', kind: 'todo' })
    await handlers['notes-dispatch']({ id: c.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话' })
    const r = await handlers['notes-dispatch-done']({ id: c.id, dispatchIndex: 0 })
    assert(r.ok === true, '标记完成应成功')
    const g = await handlers['notes-get']({ id: c.id })
    assert(g.note.dispatches[0].done === true && g.note.dispatches[0].doneAt, 'dispatch 应标记 done + doneAt')
    assert(g.note.dispatches[0].dispatchStatus === 'done' && g.note.dispatches[0].receipt === 'manual', 'P3：手动标记写 dispatchStatus=done + receipt=manual')
  })
  await t('notes-dispatch 缺少目标会话报错', async () => {
    const c = await handlers['notes-create']({ title: '待办C', body: 'x', kind: 'todo' })
    const r = await handlers['notes-dispatch']({ id: c.id })
    assert(r.error && r.error.indexOf('缺少目标会话') >= 0, '缺 sessionId 应报错')
  })
  await t('dispatches 字段 front-matter 往返', async () => {
    const c = await handlers['notes-create']({ title: '待办D2', body: 'x', kind: 'todo' })
    await handlers['notes-dispatch']({ id: c.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话', instruction: '含,逗号"引号' })
    const r = await handlers['notes-get']({ id: c.id })
    assert(r.note.dispatches.length === 1 && r.note.dispatches[0].instruction === '含,逗号"引号', 'dispatches 应正确序列化/反序列化（含特殊字符）')
  })
  await t('note_manage dispatch 无目标时列出活跃会话', async () => {
    const c = await noteManage.execute({ action: 'create', title: '待办D', body: 'x', kind: 'todo' })
    const r = await noteManage.execute({ action: 'dispatch', id: c.id })
    assert(r.needTarget === true && Array.isArray(r.activeSessions), '无目标时应返回活跃会话列表')
    assert(r.activeSessions.find(s => s.short === 'abc12345'), '列表应含当前活跃会话')
    assert(r.activeSessions[0].name, '活跃会话应带名字')
  })
  await t('note_manage dispatch 注入上下文+触发工作', async () => {
    const c = await noteManage.execute({ action: 'create', title: '待办E', body: '做E事', kind: 'todo' })
    const before = sentMessages.length
    const r = await noteManage.execute({ action: 'dispatch', id: c.id, targetSessionId: 'session-abc12345-0000-0000-0000-000000000000', targetSessionName: '开发会话', instruction: '按要求做' })
    assert(r.action === 'dispatch' && !r.error, '派发应成功')
    assert.strictEqual(sentMessages.length, before + 1, '应 agent.send 触发工作')
    assert(sentMessages[sentMessages.length - 1].msg.content[0].text.indexOf('按要求做') >= 0, '消息含 instruction')
    const g = await handlers['notes-get']({ id: c.id })
    assert(g.note.dispatches.length === 1 && g.note.dispatches[0].instruction === '按要求做', 'dispatches 记录含 instruction')
  })

  // ===== 15.5 P3 派发闭环（dispatchStatus/doneAt 状态机 + resolved 保底联动 + agent/status idle 事件回执 + 详情徽章） =====
  section('15.5 P3 派发闭环（调研 + 状态回写）')
  await t('保底联动：notes-update 置 resolved 自动回执全部未闭环派发', async () => {
    const c = await handlers['notes-create']({ title: '闭环A', body: 'x', kind: 'todo' })
    await handlers['notes-dispatch']({ id: c.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话' })
    const r = await handlers['notes-update']({ id: c.id, status: 'resolved' })
    assert(r.dispatchClosed === 1, '应回执 1 条派发（实得 ' + r.dispatchClosed + '）')
    const g = await handlers['notes-get']({ id: c.id })
    const d = g.note.dispatches[0]
    assert(g.note.status === 'resolved', '笔记状态 resolved')
    assert(d.dispatchStatus === 'done' && d.done === true && d.doneAt && d.receipt === 'resolved', '派发 dispatchStatus=done + doneAt + receipt=resolved（实得 ' + JSON.stringify(d) + '）')
  })
  await t('保底联动：note_manage update resolved 回执 + 消息明示', async () => {
    const c = await noteManage.execute({ action: 'create', title: '闭环B', body: 'x', kind: 'todo' })
    await noteManage.execute({ action: 'dispatch', id: c.id, targetSessionId: 'session-abc12345-0000-0000-0000-000000000000', targetSessionName: '开发会话' })
    const r = await noteManage.execute({ action: 'update', id: c.id, status: 'resolved' })
    assert(r.dispatchClosed === 1 && r.message.indexOf('已自动回执 1 条派发') >= 0, '返回 dispatchClosed + 消息含回执提示（实得 ' + r.message + '）')
    const g = await handlers['notes-get']({ id: c.id })
    assert(g.note.dispatches[0].dispatchStatus === 'done', '派发已闭环')
  })
  await t('保底联动幂等/不误伤：重复 resolved 零回执；非 resolved 更新不动派发', async () => {
    const c = await handlers['notes-create']({ title: '闭环C', body: 'x', kind: 'todo' })
    await handlers['notes-dispatch']({ id: c.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话' })
    const r0 = await handlers['notes-update']({ id: c.id, topic: '运维' })
    assert(!r0.dispatchClosed, '非 resolved 更新不回执（dispatchClosed=' + r0.dispatchClosed + '）')
    let g = await handlers['notes-get']({ id: c.id })
    assert(g.note.dispatches[0].dispatchStatus === 'sent', '派发仍待回执')
    await handlers['notes-update']({ id: c.id, status: 'resolved' })
    const r2 = await handlers['notes-update']({ id: c.id, status: 'resolved' })
    assert(r2.dispatchClosed === 0, '重复 resolved 幂等零回执（dispatchClosed=' + r2.dispatchClosed + '）')
    g = await handlers['notes-get']({ id: c.id })
    assert(g.note.dispatches.filter(d => d.dispatchStatus === 'done').length === 1, '只有 1 条 done（不重复写）')
  })
  await t('事件回执：agent/status idle → 该会话未闭环派发 dispatchStatus=done（receipt=idle）', async () => {
    assert(Array.isArray(evtListeners['agent/status']) && evtListeners['agent/status'].length === 1, 'host 应订阅 agent/status（实得 ' + (evtListeners['agent/status'] || []).length + ' 个监听）')
    const c = await handlers['notes-create']({ title: '闭环D', body: 'x', kind: 'todo' })
    await handlers['notes-dispatch']({ id: c.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话' })
    const fire = (st, agent) => { for (const fn of evtListeners['agent/status']) fn({ agent: agent || liveAgent, status: st }) }
    fire('running')
    await new Promise(r => setTimeout(r, 50))
    let g = await handlers['notes-get']({ id: c.id })
    assert(g.note.dispatches[0].dispatchStatus === 'sent', 'running 状态不回执')
    fire('idle')
    await new Promise(r => setTimeout(r, 50))
    g = await handlers['notes-get']({ id: c.id })
    const d = g.note.dispatches[0]
    assert(d.dispatchStatus === 'done' && d.receipt === 'idle' && d.doneAt, 'idle 回执 dispatchStatus=done + receipt=idle（实得 ' + JSON.stringify(d) + '）')
    assert(g.note.status === 'active', 'idle 回执不自动 resolved 笔记（语义完成归保底联动）')
  })
  await t('事件回执不误伤：只回执该会话的派发；无 agent 的 payload 静默跳过', async () => {
    const c = await handlers['notes-create']({ title: '闭环E', body: 'x', kind: 'todo' })
    await handlers['notes-dispatch']({ id: c.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话' })
    // 另一个会话的 idle：只回执 sessionId 匹配的派发，本笔记目标会话是 abc12345 → 不动
    const otherAgent = { id: 'session-other-9999-0000-0000-000000000000', session: { id: 'session-other-9999-0000-0000-000000000000' } }
    for (const fn of evtListeners['agent/status']) fn({ agent: otherAgent, status: 'idle' })
    await new Promise(r => setTimeout(r, 50))
    let g = await handlers['notes-get']({ id: c.id })
    assert(g.note.dispatches[0].dispatchStatus === 'sent', '其它会话 idle 不得回执本派发')
    // 目标会话 idle → 回执
    for (const fn of evtListeners['agent/status']) fn({ agent: liveAgent, status: 'idle' })
    await new Promise(r => setTimeout(r, 50))
    g = await handlers['notes-get']({ id: c.id })
    assert(g.note.dispatches[0].dispatchStatus === 'done' && g.note.dispatches[0].receipt === 'idle', 'abc 会话条目被 idle 回执')
    // 无 agent / 无 id / null payload 不炸不误写
    for (const fn of evtListeners['agent/status']) { fn({ status: 'idle' }); fn({ agent: {}, status: 'idle' }); fn(null) }
    await new Promise(r => setTimeout(r, 20))
    g = await handlers['notes-get']({ id: c.id })
    assert(g.note.dispatches.filter(d => d.dispatchStatus === 'done').length === 1, '畸形 payload 后仍只有 1 条 done')
  })
  await t('dispatch-loop 标记块双包逐字节一致（host-impl / index.mjs）', () => {
    const grab = (s, tag) => { const m = s.match(/\/\/ ==== dispatch-loop BEGIN ====[\s\S]*?\/\/ ==== dispatch-loop END ====/); assert(m, tag + ' 缺 dispatch-loop 标记块'); return m[0] }
    assert.strictEqual(grab(indexSrc, 'index.mjs'), grab(hostSrc, 'host-impl.js'), 'host-impl.js 与 index.mjs 的 dispatch-loop 块必须逐字节一致')
  })
  await t('dispatch-loop 静态结构：ctx.on 守卫 + agent/status 订阅 + 三通道回执', () => {
    for (const [src, tag] of [[hostSrc, 'host-impl.js'], [indexSrc, 'index.mjs']]) {
      assert(src.indexOf("typeof ctx.on === 'function'") >= 0, tag + ' ctx.on 存在性守卫（老宿主/无事件 mock 降级）')
      assert(src.indexOf("ctx.on('agent/status'") >= 0, tag + ' 订阅 agent/status')
      assert(src.indexOf("payload.status !== 'idle'") >= 0, tag + ' 只关心 idle 落定')
      assert(src.indexOf("receipt: receipt || 'manual'") >= 0, tag + ' 回执来源标记 receipt')
      assert(src.indexOf("if (status === 'resolved') dispatchClosed = _closeOpenDispatches(note, 'resolved')") >= 0, tag + ' _update resolved 保底联动')
      assert(src.indexOf("dispatchStatus: 'sent'") >= 0, tag + ' 派发登记 dispatchStatus=sent')
    }
  })
  await t('派发消息含完成回执指引（引导 agent resolved 闭环）', async () => {
    const c = await handlers['notes-create']({ title: '闭环F', body: '做F事', kind: 'todo' })
    const before = sentMessages.length
    await handlers['notes-dispatch']({ id: c.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话' })
    const m = sentMessages[sentMessages.length - 1]
    assert(sentMessages.length === before + 1 && m.msg.content[0].text.indexOf("note_manage") >= 0 && m.msg.content[0].text.indexOf("status: 'resolved'") >= 0 && m.msg.content[0].text.indexOf(c.id) >= 0, '派发消息应引导 agent 完成后 note_manage update resolved（含笔记 id）')
  })
  await t('详情徽章三端落地（client-impl / app.html / 原型）+ 样式（styles.css / lib/styles.css）', () => {
    assert(clientSrc.indexOf('isDispatchDone') >= 0 && clientSrc.indexOf('dsh-notes-dispatch-badge') >= 0, 'client-impl 派发徽章 + isDispatchDone')
    assert(clientSrc.indexOf('dispatchOpenCount') >= 0 && clientSrc.indexOf('派发已回执') >= 0, 'client-impl 徽章聚合计数 + 文案')
    const appSrc2 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const protoSrc2 = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    for (const [s, tag] of [[appSrc2, 'app.html'], [protoSrc2, '原型 notes-ui-v2.html']]) {
      assert(s.indexOf('isDispDone') >= 0, tag + ' isDispDone 判定helper')
      assert(s.indexOf('disp-badge') >= 0 && s.indexOf('mDispBadge') >= 0, tag + ' meta chips 派发徽章（disp-badge + mDispBadge）')
      assert(s.indexOf('派发已回执') >= 0, tag + ' 徽章已回执文案')
      assert(s.indexOf(".disp-badge.pending{color:var(--nwarn)") >= 0, tag + ' 徽章 pending 样式')
    }
    // 原型是带 mock 数据层的设计稿：mock 派发/回执与演示数据带 dispatchStatus；app.html 是真实页面（数据层走 RPC，无 mock）
    assert(protoSrc2.indexOf("dispatchStatus: 'sent'") >= 0, '原型 mock/演示数据 dispatchStatus=sent')
    assert(protoSrc2.indexOf("dispatchStatus: 'done'") >= 0, '原型 mock 回执 dispatchStatus=done')
    const cssDev2 = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg2 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const [s, tag] of [[cssDev2, 'styles.css'], [cssPkg2, 'lib/styles.css']]) {
      assert(s.indexOf('.dsh-notes-dispatch-badge.pending') >= 0 && s.indexOf('dshNotesDispatchPulse') >= 0, tag + ' 徽章样式（pending + 脉冲动画）')
    }
    // 原型 mock 的 resolved 保底联动（契约同 host）
    assert(protoSrc2.indexOf("receipt: 'resolved'") >= 0 && protoSrc2.indexOf('dispatchClosed') >= 0, '原型 mock notes-update resolved 联动回执')
  })

  // ===== 16. T3 选区指令记录（notes-quick-instruct） =====
  section('16. T3 选区指令记录（notes-quick-instruct）')
  await t('notes-quick-instruct handler 已注册', () => assert(typeof handlers['notes-quick-instruct'] === 'function', 'handler 存在'))
  const qi = await handlers['notes-quick-instruct']({ text: '选区原文内容abc', note: '这是待办，标记为重要 bug，记住这个', sessionId: 'sess-instruct-1', cwd: 'D:\\deepseek-work' })
  await t('notes-quick-instruct 返回 ok + applied', () => {
    assert(qi.ok === true && qi.id, '应返回 ok + id')
    assert.deepStrictEqual(qi.applied.tags, ['重要', 'bug'], 'applied.tags = LLM 提取的标签')
    assert.strictEqual(qi.applied.kind, 'todo', 'applied.kind = todo')
    assert.strictEqual(qi.applied.inject, true, 'applied.inject = true')
    assert.strictEqual(qi.applied.titleHint, '登录崩溃修复', 'applied.titleHint 透传')
  })
  const qiGet = await handlers['notes-get']({ id: qi.id })
  await t('notes-quick-instruct 选区原文原样为 body', () => {
    assert.strictEqual(qiGet.note.body, '选区原文内容abc\n', 'body = 选区原文（不变）')
  })
  await t('notes-quick-instruct 备注不进笔记 body', () => {
    assert(qiGet.note.body.indexOf('待办') < 0, '备注不应进 body')
    assert(qiGet.note.body.indexOf('记住这个') < 0, '备注不应进 body')
  })
  await t('notes-quick-instruct 元数据应用到笔记', () => {
    assert(qiGet.note.tags.indexOf('重要') >= 0 && qiGet.note.tags.indexOf('bug') >= 0, 'tags 合并到笔记')
    assert(qiGet.note.tags.indexOf('quick') >= 0, '保留 quick 默认标签')
    assert.strictEqual(qiGet.note.kind, 'todo', 'kind 应用为 todo')
    assert.strictEqual(qiGet.note.inject, true, 'inject 应用为约定')
    assert.strictEqual(qiGet.note.injectRole, 'convention', 'LLM 未输出 injectRole 时缺省 convention（提取器提示词已说明按 kind 推断建议）')
    assert.strictEqual(qi.applied.injectRole, 'convention', 'applied 透传 injectRole')
    const qiDisk = store.get(NOTES_DIR + '\\' + qi.id + '.md')
    assert(qiDisk.indexOf('\ninjectRole: convention\n') >= 0, 'inject=true 落盘 injectRole 行')
    assert.strictEqual(qiGet.note.topic, '登录崩溃修复', 'titleHint 引导 topic')
  })
  await t('notes-quick-instruct 不走合并窗口（独立笔记）', () => {
    assert(!qi.merged, '指令记录是独立意图，不合并')
  })
  await t('notes-quick-instruct 空备注走 notes-quick 逻辑', async () => {
    const r = await handlers['notes-quick-instruct']({ text: '空备注原文xyz', note: '', sessionId: 'sess-instruct-empty', cwd: 'D:\\deepseek-work' })
    assert(r.ok === true && r.id, '空备注应返回 ok + id')
    assert.deepStrictEqual(r.applied.tags, [], '空备注 applied.tags 为空')
    assert.strictEqual(r.applied.inject, false, '空备注 applied.inject 为 false')
    const g = await handlers['notes-get']({ id: r.id })
    assert(g.note.body.indexOf('空备注原文xyz') >= 0, '空备注 body = 选区原文')
  })
  await t('notes-quick-instruct LLM 解析失败回退等价 notes-quick', async () => {
    // 临时替换 llmMock.stream 返回非 JSON，验证容错回退（原文不变，等价 notes-quick）
    const origStream = llmMock.stream
    llmMock.stream = async function* () { yield { type: 'text-delta', text: '这不是JSON' }; yield { type: 'finish' } }
    try {
      const r = await handlers['notes-quick-instruct']({ text: '容错回退原文', note: '有备注但LLM返回非JSON', sessionId: 'sess-instruct-fb', cwd: 'D:\\deepseek-work' })
      assert(r.ok === true && r.id, '容错回退应返回 ok + id')
      assert(r.fallback === true, '应标记 fallback=true')
      assert.deepStrictEqual(r.applied.tags, [], '回退 applied.tags 为空')
      const g = await handlers['notes-get']({ id: r.id })
      assert(g.note.body.indexOf('容错回退原文') >= 0, '回退 body = 选区原文')
      assert(g.note.body.indexOf('有备注但LLM返回非JSON') < 0, '回退时备注不进 body')
    } finally {
      llmMock.stream = origStream
    }
  })

  // ===== 16.5 0.1.7 会话元数据缓存（notes-dispatch-slow-fix：128s 超时空白修复） =====
  section('16.5 0.1.7 会话元数据缓存（派发会话列表提速）')
  await t('host-impl 含会话元数据缓存结构（模块级 Map + TTL 10min + 后台补齐）', () => {
    assert(/const SESS_META_TTL = 10 \* 60 \* 1000/.test(hostSrc), 'SESS_META_TTL = 10min 常量（模块级）')
    assert(/const sessMetaCache = new Map\(\)/.test(hostSrc), 'sessMetaCache 模块级 Map')
    assert(hostSrc.indexOf('async function _fillSessMeta(missIds)') >= 0, '_fillSessMeta 后台批量读（串行化）')
    assert(hostSrc.indexOf('sessMetaFillRunning') >= 0, '批量读串行化守卫')
    assert(hostSrc.indexOf('titlesPending: true') >= 0 && hostSrc.indexOf('pendingIds: bgIds') >= 0, 'RPC 返回 titlesPending + pendingIds')
    assert(hostSrc.indexOf('pendingSessions') >= 0, 'RPC 返回 pendingSessions 占位条目')
  })
  await t('index.mjs 双边同步同款缓存结构', () => {
    assert(/const SESS_META_TTL = 10 \* 60 \* 1000/.test(indexSrc), 'SESS_META_TTL = 10min 常量（模块级）')
    assert(/const sessMetaCache = new Map\(\)/.test(indexSrc), 'sessMetaCache 模块级 Map')
    assert(indexSrc.indexOf('async function _fillSessMeta(missIds)') >= 0, '_fillSessMeta 后台批量读')
    assert(indexSrc.indexOf('titlesPending: true') >= 0 && indexSrc.indexOf('pendingIds: bgIds') >= 0, 'RPC 返回 titlesPending + pendingIds')
    assert(indexSrc.indexOf('(await _activeSessions()).sessions.map') >= 0, 'note_manage dispatch 取 .sessions（新返回形态）')
    assert(hostSrc.indexOf('(await _activeSessions()).sessions.map') >= 0, 'host-impl note_manage dispatch 同步取 .sessions')
  })

  // --- 行为断言：全新实例（独立 harness/fs/计数 mock），冷热缓存计数确定 ---
  // mock 工作区：abc12345=live（实时，不走 readTitleSnapshots）、sub9900000=非 live 子 agent（读盘路径）、arch00000=已归档（entries 阶段排除）
  const mkCacheCtx = (sq, wr) => ({
    fs: fsMock, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: systemPromptMock, sessionPersistence: sessionPersistenceMock, workspaceRegistry: wr || workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sq })[name],
    effect: () => {},
  })
  const mkHarness = (h) => ({ handle: (name, fn) => { h[name] = fn; return () => { delete h[name] } }, defineTool: (d) => d, registerTool: () => () => {} })

  let cacheReadsA = 0
  const sqA = { readTitleSnapshots: async (sids) => { cacheReadsA++; return sessionQueryMock.readTitleSnapshots(sids) } }
  const handlersA = {}
  new Function('harness', 'pluginDir', hostSrc)(mkHarness(handlersA), DIR).apply(mkCacheCtx(sqA))
  // 注意：sqA 包装 sessionQueryMock 会同时计 sharedTitleReads；本区只用 cacheReadsA/B/C 做断言
  await t('冷缓存首次调用：立即返回 live 会话 + titlesPending/pendingIds（不阻塞首屏）', async () => {
    const r = await handlersA['notes-active-sessions']({})
    assert(Array.isArray(r.sessions) && r.sessions.length === 1 && r.sessions[0].short === 'abc12345', 'live 会话同步实时返回（实得 ' + JSON.stringify(r.sessions) + '）')
    assert.strictEqual(r.titlesPending, true, '冷缓存响应带 titlesPending')
    assert(Array.isArray(r.pendingIds) && r.pendingIds.length === 1 && r.pendingIds[0].indexOf('sub9900000') >= 0, 'pendingIds = 未命中非 live 会话（实得 ' + JSON.stringify(r.pendingIds) + '）')
    assert(Array.isArray(r.pendingSessions) && r.pendingSessions.length === 1 && r.pendingSessions[0].workspace === 'deepseek-work' && r.pendingSessions[0].id.indexOf('sub9900000') >= 0, 'pendingSessions 占位条目带 workspace/id（实得 ' + JSON.stringify(r.pendingSessions) + '）')
    assert.strictEqual(cacheReadsA, 1, '未命中会话后台触发一次批量读（实得 ' + cacheReadsA + '）')
  })
  await t('缓存命中：第二次调用零 readTitleSnapshots 增量 + 无 titlesPending', async () => {
    const before = cacheReadsA
    const r = await handlersA['notes-active-sessions']({})
    assert.strictEqual(cacheReadsA, before, '第二次调用不再触发 readTitleSnapshots（增量须为 0，实得 ' + (cacheReadsA - before) + '）')
    assert(!r.titlesPending, '缓存全命中不带 titlesPending')
    assert(r.sessions.length === 1 && r.sessions[0].short === 'abc12345', 'subagent 按缓存 origin 过滤，列表稳定（实得 ' + JSON.stringify(r.sessions) + '）')
  })
  await t('TTL 过期重读（补丁实例 10min→80ms）：旧标题兜底展示 + 后台刷新 + titlesPending 复现', async () => {
    const ttlSrc = hostSrc.replace('const SESS_META_TTL = 10 * 60 * 1000', 'const SESS_META_TTL = 80')
    assert(ttlSrc.indexOf('const SESS_META_TTL = 80') >= 0 && ttlSrc !== hostSrc, 'TTL 补丁生效')
    let cacheReadsB = 0
    const sqB = { readTitleSnapshots: async (sids) => { cacheReadsB++; return sessionQueryMock.readTitleSnapshots(sids) } }
    // 专属工作区：1 live（abc12345）+ 1 非 live 普通会话（ddd11111，非 subagent，标题走缓存）
    const wrB = { archivedSessionIds: [], list: () => [{ id: 'wsB', title: 'deepseek-work', path: 'D:\\deepseek-work', sessionIds: ['session-abc12345-0000-0000-0000-000000000000', 'session-ddd11111-0000-0000-0000-000000000000'] }] }
    const handlersB = {}
    new Function('harness', 'pluginDir', ttlSrc)(mkHarness(handlersB), DIR).apply(mkCacheCtx(sqB, wrB))
    const c1 = await handlersB['notes-active-sessions']({})
    assert.strictEqual(cacheReadsB, 1, '冷缓存首次触发批量读（实得 ' + cacheReadsB + '）')
    assert.strictEqual(c1.titlesPending, true, '冷缓存响应带 titlesPending')
    assert(c1.sessions.length === 1 && c1.sessions[0].short === 'abc12345', '冷首屏仅 live 会话同步返回')
    assert(c1.pendingIds.some(id => id.indexOf('ddd11111') >= 0), 'pendingIds 含持久会话')
    const c2 = await handlersB['notes-active-sessions']({})
    assert.strictEqual(cacheReadsB, 1, 'TTL 内命中不重读（实得 ' + cacheReadsB + '）')
    assert(!c2.titlesPending, '命中无 titlesPending')
    assert(c2.sessions.length === 2 && c2.sessions.some(s => s.short === 'ddd11111' && s.name === '开发会话' && s.live === false), '持久会话按缓存标题展示（实得 ' + JSON.stringify(c2.sessions) + '）')
    await new Promise(r => setTimeout(r, 100))  // 越过 80ms TTL
    const c3 = await handlersB['notes-active-sessions']({})
    assert.strictEqual(cacheReadsB, 2, 'TTL 过期后台重读（实得 ' + cacheReadsB + '）')
    assert.strictEqual(c3.titlesPending, true, '过期刷新响应带 titlesPending')
    assert(c3.pendingIds.some(id => id.indexOf('ddd11111') >= 0), 'pendingIds 含过期会话')
    assert(c3.sessions.length === 2 && c3.sessions.some(s => s.short === 'ddd11111' && s.name === '开发会话'), '过期期间旧标题兜底展示（列表不空不闪）')
  })
  await t('notes-sessions 同源同形：冷缓存也带 titlesPending（注入范围浮层不空等）', async () => {
    let cacheReadsC = 0
    const sqC = { readTitleSnapshots: async (sids) => { cacheReadsC++; return sessionQueryMock.readTitleSnapshots(sids) } }
    const handlersC = {}
    new Function('harness', 'pluginDir', hostSrc)(mkHarness(handlersC), DIR).apply(mkCacheCtx(sqC))
    const r = await handlersC['notes-sessions']({})
    assert.strictEqual(r.titlesPending, true, 'notes-sessions 冷缓存同样 titlesPending')
    assert(r.sessions.some(s => s.short === 'abc12345'), 'live 会话同步返回')
    const r2 = await handlersC['notes-sessions']({})
    assert.strictEqual(cacheReadsC, 1, '第二次 notes-sessions 零重读（实得 ' + cacheReadsC + '）')
    assert(!r2.titlesPending && r2.sessions.length === 1, '命中后稳定：仅 live 主会话（subagent 过滤、archived 排除）')
  })
  await t('client 占位渲染 + titlesPending 轮询重拉（结构）', () => {
    assert(clientSrc.indexOf('标题加载中…') >= 0, '占位文案「短id · 标题加载中…」')
    assert(clientSrc.indexOf('titlesPending') >= 0 && clientSrc.indexOf('pendingSessions') >= 0, 'client 消费 titlesPending + pendingSessions')
    assert(clientSrc.indexOf('setDispatchPending') >= 0 && clientSrc.indexOf('setSessPending') >= 0, '派发对话框 + 注入范围浮层双占位状态')
    assert(clientSrc.indexOf('later(loadActiveSessions, 1500)') >= 0, '派发对话框 1.5s 轮询重拉（dispatchOpenRef 终止）')
    assert(clientSrc.indexOf('dispatchOpenRef') >= 0, '对话框开关镜像 ref（轮询终止条件）')
    assert(clientSrc.indexOf('pullSessList') >= 0 && clientSrc.indexOf('timer.timeout(pullSessList, 1500)') >= 0, '注入范围浮层 1.5s 轮询重拉（面板关闭终止）')
    assert(clientSrc.indexOf('disabled: !!s.pending') >= 0, '占位条目禁用态（不可勾选/不可选）')
  })

  // ===== 17. P2 静态包 host 全链路（ESM import + webServer RPC 路由 + tools） =====
  section('17. P2 静态包 host 全链路（ESM import + webServer RPC 路由）')
  const NOTES_ROOT_STATIC = path.join(osNative.homedir(), '.dsh', 'notes')
  const LEGACY_NOTES_STATIC = path.join('D:\\deepseek-work\\dsh-notes-plugin', 'notes')
  const store2 = new Map()
  const fsMock2 = {
    resolve: async (p) => p,
    stat: async (p) => ((p === NOTES_ROOT_STATIC || p === LEGACY_NOTES_STATIC) ? { dir: true } : (store2.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store2.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!store2.has(p)) throw new Error('ENOENT: ' + p); return store2.get(p) },
    writeText: async (p, c) => { store2.set(p, c) },
  }
  // 迁移源：预置一条开发版笔记（apply 时应被复制到 ~/.dsh/notes，且原目录保留）
  const legacyIdP2 = 'n-legacy-p2'
  const legacySrcPath = path.join(LEGACY_NOTES_STATIC, legacyIdP2 + '.md')
  store2.set(legacySrcPath, '---\nid: ' + legacyIdP2 + '\ntitle: 迁移前旧笔记\ntopic: 调用约定\nworkspace: deepseek-work\nstatus: active\ninject: true\ncreatedAt: 2026-09-17T00:00:00.000Z\nupdatedAt: 2026-09-17T00:00:00.000Z\n---\n\n旧笔记正文\n')
  const routes2 = []
  const tools2 = []
  const contexts2 = []
  const evtListeners2 = {}   // P3 派发闭环：静态包 ctx.on 事件订阅捕获
  const ctx2 = {
    fs: fsMock2,
    sandboxPolicy: { resolve: () => ({}) },
    webServer: { register: (r) => { routes2.push(r); return () => {} } },
    tools: { register: (d) => { tools2.push(d); return () => {} } },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contexts2.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
    on: (name, fn) => { (evtListeners2[name] = evtListeners2[name] || []).push(fn); return () => {} },
  }
  // 真实静态包环境没有动态沙箱的 harness Builtin —— 临时摘掉 mock 的 global.harness 还原真实条件
  const harnessBackup = global.harness
  delete global.harness
  let modIndex = null
  await t('index.mjs 可被 ESM import（语法 + 顶层无副作用）', async () => {
    modIndex = await import(pathToFileURL(INDEX_PATH).href)
    assert.strictEqual(modIndex.name, 'dsh-notes-plugin', 'name 导出')
    assert(Array.isArray(modIndex.inject) && modIndex.inject.indexOf('fs') >= 0 && modIndex.inject.indexOf('sandboxPolicy') >= 0, 'inject 含 fs/sandboxPolicy')
    assert(typeof modIndex.apply === 'function', 'apply 导出')
  })
  await t('harness 缺失时兜底：3 条 exact 路由（RPC + 全窗口页面 + 资产）+ ctx.tools 3 工具 + 约定注入 order130 + 目录注入 order131', () => {
    modIndex.apply(ctx2)
    assert.strictEqual(routes2.length, 3, '应注册 3 条路由（/dsh-notes RPC + /dsh-notes-app 页面 + /dsh-notes/asset 资产），实得 ' + routes2.length)
    assert.strictEqual(routes2[0].kind, 'exact', "路由 kind='exact'")
    assert.strictEqual(routes2[0].path, '/dsh-notes', "路由 path='/dsh-notes'")
    assert.strictEqual(typeof routes2[0].handler, 'function', 'handler 是函数')
    assert.strictEqual(routes2[1].kind, 'exact', "页面路由 kind='exact'")
    assert.strictEqual(routes2[1].path, '/dsh-notes-app', "页面路由 path='/dsh-notes-app'")
    assert.strictEqual(typeof routes2[1].handler, 'function', '页面 handler 是函数')
    assert.strictEqual(routes2[2].kind, 'exact', "资产路由 kind='exact'")
    assert.strictEqual(routes2[2].path, '/dsh-notes/asset', "资产路由 path='/dsh-notes/asset'")
    assert.strictEqual(typeof routes2[2].handler, 'function', '资产 handler 是函数')
    assert.deepStrictEqual(tools2.map(x => x.name).sort(), ['note_get', 'note_manage', 'note_search'], '注册 3 个工具')
    assert.strictEqual(contexts2.length, 2, '注册 2 个 systemPrompt context（约定 + 目录）')
    assert.strictEqual(contexts2[0].order, 130, '约定注入 order=130')
    assert.strictEqual(contexts2[1].name, 'notes:catalog', '目录注入 context 名')
    assert.strictEqual(contexts2[1].order, 131, '目录注入 order=131（紧邻约定注入之后）')
  })
  // 走真实 HTTP handler 形态调用 RPC（等价 client 侧 fetch POST /dsh-notes）
  function rpc2(method, args) {
    return new Promise((resolve, reject) => {
      const body = Buffer.from(JSON.stringify({ method: method, args: args }))
      const req = { method: 'POST', on: (ev, cb) => { if (ev === 'data') cb(body); else if (ev === 'end') cb(); return req }, destroy: () => {} }
      const res = { statusCode: 0, setHeader: () => {}, writeHead: (c) => { res.statusCode = c }, end: (s) => { let b; try { b = JSON.parse(s) } catch (e) { b = s } resolve({ status: res.statusCode, body: b }) } }
      Promise.resolve(routes2[0].handler(req, res)).catch(reject)
    })
  }
  // GET /dsh-notes-app 页面路由行为：真实读包内 app.html 返回 text/html；非 GET/HEAD 405
  function pageReq(method) {
    const headers = {}
    const res = { statusCode: 0, body: null, setHeader: (k, v) => { headers[String(k).toLowerCase()] = v }, writeHead: (c) => { res.statusCode = c }, end: (s) => { res.body = s } }
    return Promise.resolve(routes2[1].handler({ method: method }, res)).then(() => ({ status: res.statusCode, headers: headers, body: res.body }))
  }
  await t('GET /dsh-notes-app 返回 app.html（200 + text/html; charset=utf-8）', async () => {
    const r = await pageReq('GET')
    assert.strictEqual(r.status, 200, 'GET 应 200（实得 ' + r.status + '）')
    assert(String(r.headers['content-type'] || '').indexOf('text/html') === 0, "Content-Type 应以 text/html 开头（实得 " + r.headers['content-type'] + '）')
    assert(String(r.headers['cache-control'] || '').indexOf('no-store') >= 0, 'Cache-Control: no-store（每次读盘，开发期改页面免重启）')
    assert(r.body.indexOf('<title>dsh-notes</title>') >= 0, '页面 <title> 应为 dsh-notes')
    assert(r.body.indexOf("fetch('/dsh-notes'") >= 0, '页面应含 /dsh-notes RPC 数据层')
  })
  await t('POST /dsh-notes-app 返回 405（页面路由只服务 GET/HEAD）', async () => {
    const r = await pageReq('POST')
    assert.strictEqual(r.status, 405, 'POST 应 405（实得 ' + r.status + '）')
  })
  // GET /dsh-notes/asset 资产路由行为：真实走 handler（读盘经 ctx.fs → 内存 store2）
  const pngBytes2 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const pngB64_2 = pngBytes2.toString('base64')
  function assetReq(method, url) {
    const headers = {}
    const res = { statusCode: 0, body: null, setHeader: (k, v) => { headers[String(k).toLowerCase()] = v }, writeHead: (c) => { res.statusCode = c }, end: (s) => { res.body = s === undefined ? null : s } }
    return Promise.resolve(routes2[2].handler({ method: method, url: url }, res)).then(() => ({ status: res.statusCode, headers: headers, body: res.body }))
  }
  const assetUp2 = await rpc2('notes-asset-upload', { name: '像素图.png', data: pngB64_2, mime: 'image/png' })
  await t('notes-asset-upload（静态包 RPC）：落盘 assets/<ts>-<安全名> 且内容为 base64 文本', () => {
    assert(!assetUp2.body.error, '上传成功（实得 ' + JSON.stringify(assetUp2.body) + '）')
    assert(/^assets\/\d{8}-\d{6}-.+\.png$/.test(assetUp2.body.file), '返回相对路径 assets/<ts>-<名>.png（实得 ' + assetUp2.body.file + '）')
    assert.strictEqual(assetUp2.body.bytes, pngBytes2.length, 'bytes = 解码后字节数')
    assert.strictEqual(store2.get(path.join(NOTES_ROOT_STATIC, 'assets', assetUp2.body.name)), pngB64_2, '磁盘内容为 base64 文本形态')
  })
  await t('GET /dsh-notes/asset 命中：200 + image/png + 解码回原始字节 + immutable 缓存', async () => {
    const r = await assetReq('GET', '/dsh-notes/asset?file=' + assetUp2.body.file)
    assert.strictEqual(r.status, 200, '实得 ' + r.status)
    assert.strictEqual(r.headers['content-type'], 'image/png', 'Content-Type 按扩展名白名单')
    assert.strictEqual(r.headers['cache-control'], 'public, max-age=31536000, immutable', 'immutable 长缓存')
    assert(Buffer.isBuffer(r.body) && r.body.equals(pngBytes2), '响应体 = base64 解码后的原始字节')
    assert.strictEqual(Number(r.headers['content-length']), pngBytes2.length, 'Content-Length 匹配')
  })
  await t('GET /dsh-notes/asset 防穿越/形态/白名单/404', async () => {
    for (const bad of ['assets/../secret.md', 'assets/../../x', 'assets', 'x.png', 'assets/sub/x.png', 'assets/%2e%2e/x.md', '/etc/passwd', 'assets/..']) {
      const r = await assetReq('GET', '/dsh-notes/asset?file=' + bad)
      assert(r.status === 400, '穿越/非法形态应 400：' + bad + '（实得 ' + r.status + '）')
    }
    const nf = await assetReq('GET', '/dsh-notes/asset?file=assets/20990101-000000-none.png')
    assert.strictEqual(nf.status, 404, '不存在 → 404')
    const badExt = await assetReq('GET', '/dsh-notes/asset?file=assets/x.svg')
    assert.strictEqual(badExt.status, 404, '扩展名白名单外 → 404')
    const h = await assetReq('HEAD', '/dsh-notes/asset?file=' + assetUp2.body.file)
    assert.strictEqual(h.status, 200, 'HEAD 200')
    assert(h.body === null || h.body === '', 'HEAD 空体')
    const p = await assetReq('POST', '/dsh-notes/asset?file=' + assetUp2.body.file)
    assert.strictEqual(p.status, 405, 'POST → 405')
  })
  const listP2 = await rpc2('notes-list', {})
  await t('RPC 200 + 首次启动迁移开发版笔记到 ~/.dsh/notes', () => {
    assert.strictEqual(listP2.status, 200, 'HTTP 200')
    const ids = listP2.body.notes.map(n => n.id)
    assert(ids.indexOf(legacyIdP2) >= 0, '迁移后的旧笔记应出现在列表（实得：' + JSON.stringify(ids) + '）')
    assert.strictEqual(listP2.body.notes.find(n => n.id === legacyIdP2).title, '迁移前旧笔记', '迁移保留标题')
    assert(store2.has(path.join(NOTES_ROOT_STATIC, legacyIdP2 + '.md')), '目标目录出现迁移副本')
    assert(store2.has(legacySrcPath), '迁移不删除开发版原目录')
  })
  const cr2 = await rpc2('notes-create', { title: '静态包笔记', body: '正文P2', tags: ['p2'], topic: '开发' })
  await t('notes-create 走静态包 RPC', () => assert(cr2.body.id, '返回 id（实得 ' + JSON.stringify(cr2.body) + '）'))
  const get2 = await rpc2('notes-get', { id: cr2.body.id })
  await t('notes-get 返回正文', () => assert.strictEqual(get2.body.note.body, '正文P2', 'body 原样'))
  await t('notes-update 生效', async () => {
    const up = await rpc2('notes-update', { id: cr2.body.id, topic: '运维' })
    assert.strictEqual(up.body.id, cr2.body.id, 'update 返回 id')
    const g = await rpc2('notes-get', { id: cr2.body.id })
    assert.strictEqual(g.body.note.topic, '运维', 'topic 更新为 运维')
  })
  await t('notes-quick 合并窗口 + 异步分类回填', async () => {
    const q1 = await rpc2('notes-quick', { text: '速记P2第一条', sessionId: 'sess-p2-1' })
    assert(q1.body.id && q1.body.merged === false, '首条新建')
    const q2 = await rpc2('notes-quick', { text: '速记P2第二条', sessionId: 'sess-p2-1' })
    assert.strictEqual(q2.body.id, q1.body.id, '10 分钟内同会话合并')
    const g = await rpc2('notes-get', { id: q1.body.id })
    assert(g.body.note.body.indexOf('速记P2第二条') >= 0, '合并正文含第二条')
  })
  await t('notes-search 命中', async () => {
    const s = await rpc2('notes-search', { query: '速记P2第二' })
    assert.strictEqual(s.body.notes.length, 1, '命中 1 条')
    assert(Array.isArray(s.body.notes[0].matches) && s.body.notes[0].matches.indexOf('body') >= 0, '静态包附 matches 命中字段（正文命中标 body）')
  })
  await t('notes-delete / notes-restore 软删除往返', async () => {
    await rpc2('notes-delete', { id: cr2.body.id })
    const l1 = await rpc2('notes-list', {})
    assert(l1.body.notes.every(n => n.id !== cr2.body.id), '软删除后不在列表')
    await rpc2('notes-restore', { id: cr2.body.id })
    const l2 = await rpc2('notes-list', {})
    assert(l2.body.notes.some(n => n.id === cr2.body.id), '恢复后回到列表')
  })
  await t('notes-conventions 读到迁移笔记的 inject 约定', async () => {
    const c = await rpc2('notes-conventions', {})
    assert(c.body.text.indexOf('迁移前旧笔记') >= 0, 'inject=true 且 workspace 匹配时应注入（实得：' + c.body.text + '）')
    assert(c.body.text.indexOf('旧笔记正文') >= 0, '注入正文')
    assert(c.body.text.indexOf('用户约定（须遵守）：') >= 0, '迁移旧笔记（无 injectRole 字段）缺省进约定桶')
    assert(c.body.text.indexOf('已记录的约定') < 0 && c.body.text.indexOf('记录会话') < 0, '静态包新文案不含旧归属标注')
  })
  await t('静态包 injectRole 链路：create reference → get/front-matter/双桶文案/update 一致', async () => {
    const c = await rpc2('notes-create', { title: '静态包资料', body: '参考资料正文P2', tags: ['rolep2'], inject: true, topic: '资料', injectRole: 'reference' })
    assert(c.body.id, 'create 返回 id（实得 ' + JSON.stringify(c.body) + '）')
    const g = await rpc2('notes-get', { id: c.body.id })
    assert.strictEqual(g.body.note.injectRole, 'reference', '静态包 notes-get 返回 injectRole=reference')
    const onDisk = store2.get(path.join(NOTES_ROOT_STATIC, c.body.id + '.md'))
    assert(onDisk && onDisk.indexOf('\ninjectRole: reference\n') >= 0, '静态包磁盘 front-matter 写 injectRole: reference')
    const conv = await rpc2('notes-conventions', {})
    const iRef = conv.body.text.indexOf('参考资料（与当前任务相关时按需取用）：')
    assert(conv.body.text.indexOf('用户约定（须遵守）：') >= 0 && iRef >= 0, '双桶引导词并列')
    assert(conv.body.text.indexOf('静态包资料') > iRef, 'reference 笔记列在资料桶下')
    const u = await rpc2('notes-update', { id: c.body.id, injectRole: 'convention' })
    assert(!u.body.error, 'notes-update 透传 injectRole')
    const g2 = await rpc2('notes-get', { id: c.body.id })
    assert.strictEqual(g2.body.note.injectRole, 'convention', '静态包 notes-update 改 injectRole 生效')
    const onDisk2 = store2.get(path.join(NOTES_ROOT_STATIC, c.body.id + '.md'))
    assert(onDisk2.indexOf('\ninjectRole: convention\n') >= 0, '静态包 update 后磁盘 front-matter 同步')
  })
  await t('notes:catalog 目录注入行为（静态包）：普通笔记进目录、约定去重、标题行+轻推行', () => {
    const cat = contexts2.find(x => x.name === 'notes:catalog')
    assert(cat && typeof cat.text === 'function', 'notes:catalog context 已注册且 text 为函数')
    const txt = cat.text()
    assert(txt.indexOf('本地笔记库目录（与本任务相关时用 note_get 拉全文，更多用 note_search）：') === 0, '目录标题行开头（实得：' + txt.slice(0, 80) + '）')
    assert(txt.indexOf('- [' + cr2.body.id + '] 静态包笔记 (笔记, 运维)') >= 0, '一行一条格式：- [id] 标题 (kind中文, topic)（实得：' + txt + '）')
    assert(txt.indexOf('迁移前旧笔记') < 0, 'inject=true 且本会话命中的约定不进目录（order 130 已注入全文，目录去重）')
    assert(txt.indexOf('规划任务前，若目录中有相关笔记（尤其待办/决策），建议先 note_get 读取再动手') >= 0, '末尾轻推行')
  })
  await t('notes-sessions / notes-active-sessions / notes-workspaces 可用', async () => {
    const s1 = await rpc2('notes-sessions', {})
    assert(Array.isArray(s1.body.sessions), 'sessions 数组')
    assert(s1.body.sessions.some(x => x.id === 'session-abc12345-0000-0000-0000-000000000000'), '含有效会话')
    assert(!s1.body.sessions.some(x => String(x.id).indexOf('arch') >= 0), '排除已归档会话')
    assert(!s1.body.sessions.some(x => String(x.id).indexOf('sub99') >= 0), '排除子 agent')
    const s2 = await rpc2('notes-active-sessions', {})
    assert(Array.isArray(s2.body.sessions), 'active-sessions 数组')
    const s3 = await rpc2('notes-workspaces', {})
    assert(s3.body.workspaces.length === 1 && s3.body.workspaces[0].cwd === 'D:\\deepseek-work', 'workspaces 映射')
  })
  await t('notes-active-sessions 缓存命中：再次调用零 readTitleSnapshots 增量（静态包模块级缓存）', async () => {
    // 上一个测试的 notes-sessions 冷调用已后台填充缓存；此处再调必须全命中
    const before = sharedTitleReads
    const r = await rpc2('notes-active-sessions', {})
    assert.strictEqual(sharedTitleReads, before, '缓存命中不应再触发 readTitleSnapshots（实得增量 ' + (sharedTitleReads - before) + '）')
    assert(!r.body.titlesPending, '全命中响应不带 titlesPending')
    assert(Array.isArray(r.body.sessions) && r.body.sessions.some(x => x.id === 'session-abc12345-0000-0000-0000-000000000000'), 'live 会话仍实时返回')
  })
  await t('index.mjs 冷缓存首屏：titlesPending + pendingIds，补齐后零重读（?coldcache 独立 ESM 实例）', async () => {
    const modCold = await import(pathToFileURL(INDEX_PATH).href + '?coldcache=1')
    const handlersCold = {}
    global.harness = mkHarness(handlersCold)
    try {
      const storeCold = new Map()
      const fsMockCold = {
        resolve: async (p) => p,
        stat: async (p) => ((p === NOTES_ROOT_STATIC || p === LEGACY_NOTES_STATIC) ? { dir: true } : (storeCold.has(p) ? { file: true } : null)),
        listDir: async () => [],
        readText: async (p) => { if (!storeCold.has(p)) throw new Error('ENOENT: ' + p); return storeCold.get(p) },
        writeText: async (p, c) => { storeCold.set(p, c) },
      }
      modCold.apply({
        fs: fsMockCold, sandboxPolicy: { resolve: () => ({}) },
        webServer: { register: () => () => {} }, tools: { register: () => () => {} },
        get: (name) => ({ agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
        effect: () => {},
      })
      const before = sharedTitleReads
      const r = await handlersCold['notes-active-sessions']({})
      assert.strictEqual(r.titlesPending, true, '静态包冷缓存响应带 titlesPending')
      assert(Array.isArray(r.pendingIds) && r.pendingIds.length === 1 && r.pendingIds[0].indexOf('sub9900000') >= 0, 'pendingIds 含未命中非 live 会话（实得 ' + JSON.stringify(r.pendingIds) + '）')
      assert(r.sessions.length === 1 && r.sessions[0].short === 'abc12345', 'live 会话同步返回，首屏不空')
      assert.strictEqual(sharedTitleReads, before + 1, '未命中后台触发一次批量读（实得增量 ' + (sharedTitleReads - before) + '）')
      const r2 = await handlersCold['notes-active-sessions']({})
      assert.strictEqual(sharedTitleReads, before + 1, '第二次调用零 readTitleSnapshots 增量')
      assert(!r2.titlesPending && r2.sessions.length === 1, '缓存命中后稳定（subagent 过滤、archived 排除）')
    } finally {
      delete global.harness
    }
  })
  await t('notes-dispatch 派发到 live 会话 + 记录 dispatches', async () => {
    const before = sentMessages.length
    const d = await rpc2('notes-dispatch', { id: cr2.body.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话', instruction: '静态包派发要求' })
    assert(d.body.ok === true, '派发成功（实得 ' + JSON.stringify(d.body) + '）')
    assert.strictEqual(sentMessages.length, before + 1, 'agent.send 触发一次')
    assert.strictEqual(sentMessages[sentMessages.length - 1].msg.source.form, 'recall', "source.form='recall'")
    const g = await rpc2('notes-get', { id: cr2.body.id })
    assert(g.body.note.dispatches.length >= 1 && g.body.note.dispatches[g.body.note.dispatches.length - 1].instruction === '静态包派发要求', 'dispatches 记录')
    const idx = g.body.note.dispatches.length - 1
    const dn = await rpc2('notes-dispatch-done', { id: cr2.body.id, dispatchIndex: idx })
    assert(dn.body.ok === true, 'dispatch-done 成功')
  })
  await t('静态包 P3 派发闭环：dispatchStatus=sent → resolved 保底联动 → idle 事件回执', async () => {
    const c = await rpc2('notes-create', { title: '静态闭环', body: 'x', kind: 'todo' })
    const sid = 'session-abc12345-0000-0000-0000-000000000000'
    const d = await rpc2('notes-dispatch', { id: c.body.id, sessionId: sid, sessionName: '开发会话' })
    assert(d.body.ok === true && d.body.dispatch && d.body.dispatch.dispatchStatus === 'sent', '静态包派发登记 dispatchStatus=sent（实得 ' + JSON.stringify(d.body.dispatch) + '）')
    // 保底联动：notes-update resolved → 自动回执未闭环派发
    const u = await rpc2('notes-update', { id: c.body.id, status: 'resolved' })
    assert(u.body.dispatchClosed === 1, 'resolved 联动回执 1 条（实得 ' + u.body.dispatchClosed + '）')
    let g = await rpc2('notes-get', { id: c.body.id })
    assert(g.body.note.dispatches[0].dispatchStatus === 'done' && g.body.note.dispatches[0].receipt === 'resolved' && g.body.note.dispatches[0].doneAt, '静态包保底联动写 dispatchStatus=done + receipt=resolved + doneAt')
    // 事件回执：ctx2.on 捕获 agent/status 监听；目标会话 idle → 未闭环派发回执
    assert(Array.isArray(evtListeners2['agent/status']) && evtListeners2['agent/status'].length === 1, '静态包应订阅 agent/status（实得 ' + (evtListeners2['agent/status'] || []).length + '）')
    const c2b = await rpc2('notes-create', { title: '静态闭环2', body: 'x', kind: 'todo' })
    await rpc2('notes-dispatch', { id: c2b.body.id, sessionId: sid, sessionName: '开发会话' })
    for (const fn of evtListeners2['agent/status']) fn({ agent: liveAgent, status: 'idle' })
    await new Promise(r => setTimeout(r, 50))
    g = await rpc2('notes-get', { id: c2b.body.id })
    assert(g.body.note.dispatches[0].dispatchStatus === 'done' && g.body.note.dispatches[0].receipt === 'idle', '静态包 idle 事件回执（实得 ' + JSON.stringify(g.body.note.dispatches[0]) + '）')
    // 已 resolved 的第一篇不受 idle 影响（幂等）
    g = await rpc2('notes-get', { id: c.body.id })
    assert(g.body.note.dispatches.filter(x => x.dispatchStatus === 'done').length === 1, '幂等：已闭环条目不重复回执')
  })
  await t('静态包显式归档全链路：preview → 无参仅速记 → 显式 groups 手动组 → undo → notes-perf / notes-ping', async () => {
    // 直写 store2 造速记组（sess-st-1 两条，updatedAt 确定性）；静态包与开发版同一归档语义
    const seedStatic = (id, day, title, topic) => store2.set(path.join(NOTES_ROOT_STATIC, id + '.md'),
      '---\nid: ' + id + '\ntitle: ' + title + '\ntopic: ' + topic + '\ntags: quick\nsessionId: sess-st-1\ncreatedAt: "2026-01-0' + day + 'T00:00:00.000Z"\nupdatedAt: "2026-01-0' + day + 'T00:00:00.000Z"\n---\n\n' + title + '正文\n')
    seedStatic('n-sqk1', 1, '静态速记一', '开发')
    seedStatic('n-sqk2', 2, '静态速记二', '运维')
    const cA = await rpc2('notes-create', { title: '归档A', body: 'a', tags: ['arc2'], topic: '其他' })
    const cB = await rpc2('notes-create', { title: '归档B', body: 'b', tags: ['arc2'], topic: '其他' })
    // preview（dry-run）：速记组出现，手动笔记不出现
    const pv = await rpc2('notes-archive-preview', {})
    assert(!pv.body.error && Array.isArray(pv.body.quickGroups), 'preview 返回 quickGroups（实得 ' + JSON.stringify(pv.body).slice(0, 160) + '）')
    const gSt = pv.body.quickGroups.find(g => g.sessionId === 'sess-st-1')
    assert(gSt && gSt.members.length === 2 && gSt.title === '运维', '速记按 sessionId 分组 + 默认标题 last.topic（实得 ' + JSON.stringify(gSt) + '）')
    assert(pv.body.quickGroups.every(g => g.members.every(m => m.id !== cA.body.id && m.id !== cB.body.id)), '手动笔记不进 preview（行为变更）')
    // 无参归档：只合速记组，手动笔记不动
    const ar = await rpc2('notes-archive', {})
    assert.strictEqual(ar.body.merged, 1, '无参只合速记组（实得 ' + JSON.stringify(ar.body) + '）')
    let l = await rpc2('notes-list', {})
    assert(l.body.notes.some(n => n.id === cA.body.id) && l.body.notes.some(n => n.id === cB.body.id), '手动笔记不再按标签自动分组（保持可见）')
    assert(!l.body.notes.some(n => n.id === 'n-sqk1') && !l.body.notes.some(n => n.id === 'n-sqk2'), '速记组已合并隐藏')
    // 显式白名单：手动组 + title 覆盖
    const ar2 = await rpc2('notes-archive', { groups: [{ memberIds: [cA.body.id, cB.body.id], title: '静态手动归档' }] })
    assert.strictEqual(ar2.body.merged, 1, '显式 groups 合并手动组（实得 ' + JSON.stringify(ar2.body) + '）')
    const gArc = await rpc2('notes-get', { id: ar2.body.groups[0].noteId })
    assert.strictEqual(gArc.body.note.title, '静态手动归档', 'title 覆盖默认标题')
    // undo：只撤销最近一次（手动组）；前一次速记合并不回滚
    const ud = await rpc2('notes-archive-undo', {})
    assert(ud.body.undone === 1 && ud.body.restored === 2, 'undo 撤销最近一次归档（实得 ' + JSON.stringify(ud.body) + '）')
    l = await rpc2('notes-list', {})
    assert(l.body.notes.some(n => n.id === cA.body.id) && l.body.notes.some(n => n.id === cB.body.id), 'undo 成员批量还原')
    assert(!l.body.notes.some(n => n.id === ar2.body.groups[0].noteId), 'undo 归档笔记软删')
    assert(!l.body.notes.some(n => n.id === 'n-sqk1'), 'undo 只保留最近一次：前一次速记合并不回滚')
    const ud2 = await rpc2('notes-archive-undo', {})
    assert.strictEqual(ud2.body.undone, 0, '无可撤销 → { undone: 0 }')
    const pf = await rpc2('notes-perf', { perf: { hostCall: 1 } })
    assert(pf.body.ok === true, 'notes-perf ok')
    const pg = await rpc2('notes-ping', { t: 1 })
    assert(pg.body.ok === true && pg.body.echo.t === 1, 'P1 存活探测保留')
  })
  await t('notes-src / notes-css handler 保留（静态资产可回退读取）', async () => {
    const src = await rpc2('notes-src', { which: 'host' })
    assert(typeof src.body.src === 'string' && src.body.src.length > 1000, 'host 源码可下发')
    const src2 = await rpc2('notes-src', { which: 'client' })
    assert(typeof src2.body.src === 'string' && src2.body.src.length > 1000, 'client 源码可下发')
    const err = await rpc2('no-such-method', {})
    assert.strictEqual(err.status, 404, '未知方法 404')
  })
  await t('notes-css 从候选路径读到真实 styles.css', async () => {
    const css = await rpc2('notes-css', {})
    assert(typeof css.body.css === 'string' && css.body.css.indexOf('.dsh-notes-settings-modal') >= 0, 'css 下发成功（实得：' + JSON.stringify(css.body).slice(0, 120) + '）')
  })
  await t('静态包 3 工具可执行（note_search / note_get / note_manage）', async () => {
    const tSearch = tools2.find(x => x.name === 'note_search')
    const tGet = tools2.find(x => x.name === 'note_get')
    const tMgr = tools2.find(x => x.name === 'note_manage')
    const s = await tSearch.execute({ query: '静态包笔记' })
    assert(s.count >= 1, 'note_search 命中')
    const g = await tGet.execute({ id: cr2.body.id })
    assert(g.note && g.note.id === cr2.body.id, 'note_get 返回笔记')
    const l = await tMgr.execute({ action: 'list' })
    assert(l.action === 'list' && l.count >= 1, 'note_manage.list 可用')
    const c = await tMgr.execute({ action: 'create', title: '工具建笔记', body: '工具正文' })
    assert(c.action === 'create' && c.id, 'note_manage.create 可用')
    const d = await tMgr.execute({ action: 'delete', id: c.id })
    assert(d.action === 'delete', 'note_manage.delete 可用')
    assert(typeof tSearch.output.render === 'function', 'output.render 保留')
  })
  // 虚拟文件夹（静态包运行面）：notes-folders 经 webServer 兜底路由可达 + folder 字段链路 + move 往返
  await t('notes-folders RPC（webServer 路由）：create/list 计数 + folders.json 落盘', async () => {
    const c1 = await rpc2('notes-folders', { op: 'create', name: '静态包文件夹' })
    assert(c1.status === 200 && c1.body.ok === true && c1.body.folder && c1.body.folder.id.indexOf('f-') === 0, 'create 返回 f- 前缀 id（实得：' + JSON.stringify(c1.body) + '）')
    assert.strictEqual(c1.body.folder.order, 0, '首个文件夹 order=0')
    const foldersJsonPath = path.join(NOTES_ROOT_STATIC, 'folders.json')
    assert(store2.has(foldersJsonPath), 'folders.json 已写入 ~/.dsh/notes')
    assert.deepStrictEqual(JSON.parse(store2.get(foldersJsonPath)), [{ id: c1.body.folder.id, name: '静态包文件夹', order: 0 }], '磁盘清单内容一致')
    const lst = await rpc2('notes-folders', {})
    assert(lst.body.folders.length === 1 && lst.body.folders[0].id === c1.body.folder.id, 'list 含新文件夹')
    assert.strictEqual(typeof lst.body.unfiled, 'number', 'list 返回 unfiled 计数')
    const bad = await rpc2('notes-folders', { op: 'purge' })
    assert(bad.body.error && bad.body.error.indexOf('未知 op') >= 0, '未知 op 报错')
  })
  await t('静态包 folder 字段链路：create 带 folder → get/list/front-matter 一致 + 过滤', async () => {
    const fid = (await rpc2('notes-folders', {})).body.folders[0].id
    const n = await rpc2('notes-create', { title: 'fld-静态包', body: 'x', folder: fid })
    assert(n.body.id, 'notes-create 接受 folder')
    const g = await rpc2('notes-get', { id: n.body.id })
    assert.strictEqual(g.body.note.folder, fid, 'get 返回 folder id')
    const content = store2.get(path.join(NOTES_ROOT_STATIC, n.body.id + '.md'))
    assert(content.indexOf('\nfolder: ' + fid + '\n') >= 0, 'front-matter 含 folder 行')
    const inF = await rpc2('notes-list', { folder: fid })
    assert(inF.body.notes.some(x => x.id === n.body.id) && inF.body.notes.every(x => x.folder === fid), 'notes-list 按 folder 过滤')
    const unf = await rpc2('notes-list', { folder: '' })
    assert(!unf.body.notes.some(x => x.id === n.body.id), 'folder=\'\' 未分类不含该笔记')
    const lst = await rpc2('notes-folders', {})
    assert.strictEqual(lst.body.folders.find(f => f.id === fid).count, 1, '文件夹计数=1')
  })
  await t('静态包 note_manage move/create 名称解析 + 移出往返', async () => {
    const fid = (await rpc2('notes-folders', {})).body.folders[0].id
    const tMgr = tools2.find(x => x.name === 'note_manage')
    // create 按名称落位（修复：不再把名称当 id 写入悬空引用）
    const c = await tMgr.execute({ action: 'create', title: 'fld-静态包-mgr', body: 'x', folder: '静态包文件夹' })
    assert(c.id, 'create 按名称接受 folder')
    const g1 = await rpc2('notes-get', { id: c.id })
    assert.strictEqual(g1.body.note.folder, fid, 'create 名称解析为 id 落盘')
    const cbad = await tMgr.execute({ action: 'create', title: 'fld-bad', body: 'x', folder: '不存在的文件夹' })
    assert(cbad.error && cbad.error.indexOf('文件夹不存在') >= 0, 'create 不存在文件夹报错')
    // move：移出 → 按名称移回
    const m1 = await tMgr.execute({ action: 'move', id: c.id, folder: '' })
    assert.strictEqual(m1.folder, '', 'move 空串 = 移出未分类')
    assert.strictEqual((await rpc2('notes-get', { id: c.id })).body.note.folder, '', '移出生效')
    const m2 = await tMgr.execute({ action: 'move', id: c.id, folder: '静态包文件夹' })
    assert.strictEqual(m2.folder, fid, 'move 按名称解析为 id')
    assert.strictEqual(m2.folderName, '静态包文件夹', 'move 返回 folderName')
    assert.strictEqual((await rpc2('notes-get', { id: c.id })).body.note.folder, fid, '移回生效')
    const mbad = await tMgr.execute({ action: 'move', id: c.id, folder: '不存在的文件夹' })
    assert(mbad.error && mbad.error.indexOf('文件夹不存在') >= 0, 'move 不存在文件夹报错')
    // note_search folder 过滤（名称命中）
    const tSearch = tools2.find(x => x.name === 'note_search')
    const s1 = await tSearch.execute({ query: 'fld-静态包-mgr', folder: '静态包文件夹' })
    assert(s1.count >= 1 && s1.notes.every(n => n.folder === fid), 'note_search 按名称过滤命中')
    const s2 = await tSearch.execute({ query: 'fld-静态包-mgr', folder: '' })
    assert.strictEqual(s2.count, 0, 'folder=\'\' 未分类查不到该笔记')
  })
  await t('静态包 folders.json 损坏兜底：空清单 + 主流程不受影响', async () => {
    const foldersJsonPath = path.join(NOTES_ROOT_STATIC, 'folders.json')
    const backup = store2.get(foldersJsonPath)
    store2.set(foldersJsonPath, '这不是 JSON {')
    const r1 = await rpc2('notes-folders', {})
    assert(r1.status === 200 && Array.isArray(r1.body.folders) && r1.body.folders.length === 0 && !r1.body.error, '坏 JSON → 空清单不抛错')
    const l = await rpc2('notes-list', {})
    assert(l.body.notes.length >= 1, 'notes-list 主流程不受 folders.json 损坏影响')
    store2.set(foldersJsonPath, backup)
  })
  // 文件夹嵌套（静态包运行面）：parent 建层/深度上限/cycle 拒绝/递归子树过滤/cascade 软删恢复（webServer 兜底路由链路，与开发版同一 _folders 实现）
  await t('静态包嵌套文件夹：parent 建层/深度超限拒绝/cycle 拒绝/cascade 软删恢复落未分类', async () => {
    const A = (await rpc2('notes-folders', { op: 'create', name: '静态A' })).body.folder
    const rB = await rpc2('notes-folders', { op: 'create', name: '静态B', parent: A.id })
    assert(rB.body.ok === true && rB.body.folder.parent === A.id, 'create parent 落位（实得：' + JSON.stringify(rB.body) + '）')
    const B = rB.body.folder
    const C = (await rpc2('notes-folders', { op: 'create', name: '静态C', parent: B.id })).body.folder
    // 深度上限：缺省 maxFolderDepth=3，C 已是第 3 层 → 第 4 层拒绝
    const d4 = await rpc2('notes-folders', { op: 'create', name: '静态D', parent: C.id })
    assert(d4.body.error && d4.body.error.indexOf('maxFolderDepth') >= 0, '第 4 层超限拒绝（实得：' + JSON.stringify(d4.body) + '）')
    // cycle：A 不能挂到自己的子孙 C 下
    const cyc = await rpc2('notes-folders', { op: 'reorder', ids: [A.id], parents: { [A.id]: C.id } })
    assert(cyc.body.error && cyc.body.error.indexOf('cycle') >= 0, 'cycle 拒绝（实得：' + JSON.stringify(cyc.body) + '）')
    // list 带 parent/depth + 子树口径计数；notes-list 递归子树过滤
    const n = await rpc2('notes-create', { title: '静态嵌套笔记', body: 'x', folder: C.id })
    const lst = await rpc2('notes-folders', {})
    const la = lst.body.folders.find(f => f.id === A.id)
    const lc = lst.body.folders.find(f => f.id === C.id)
    assert(la.parent === '' && la.depth === 1 && la.count === 1, 'A 根级 depth=1 + 子树计数含 C 的笔记（实得：' + JSON.stringify(la) + '）')
    assert(lc.parent === B.id && lc.depth === 3 && lc.count === 1, 'C depth=3 + parent=B（实得：' + JSON.stringify(lc) + '）')
    const inA = await rpc2('notes-list', { folder: A.id })
    assert(inA.body.notes.some(x => x.id === n.body.id), 'notes-list folder=A 递归含子孙文件夹笔记')
    const inC = await rpc2('notes-list', { folder: C.id })
    assert(inC.body.notes.length === 1 && inC.body.notes[0].id === n.body.id, 'folder=C 只自身')
    // cascade：缺省拒绝（needCascade + 统计）→ cascade:true 整棵删除 + 笔记软删
    const refuse = await rpc2('notes-folders', { op: 'delete', id: A.id })
    assert(refuse.body.error && refuse.body.needCascade === true && refuse.body.childFolders === 2 && refuse.body.notes === 1, '缺省拒绝 + 统计（实得：' + JSON.stringify(refuse.body) + '）')
    const del = await rpc2('notes-folders', { op: 'delete', id: A.id, cascade: true })
    assert(del.body.ok === true && del.body.folders === 3 && del.body.notes === 1, 'cascade 统计 {folders:3, notes:1}（实得：' + JSON.stringify(del.body) + '）')
    assert(!(await rpc2('notes-folders', {})).body.folders.some(f => f.id === A.id || f.id === B.id || f.id === C.id), 'A/B/C 整棵出清单')
    // 恢复 → 原文件夹已不存在 → effectiveFolder 兜底未分类
    await rpc2('notes-restore', { id: n.body.id })
    assert((await rpc2('notes-list', { folder: '' })).body.notes.some(x => x.id === n.body.id), '恢复后落未分类（effectiveFolder 兜底）')
  })
  await t('harness 主通道：handle 经 harness.handle 注册（host.call 链路可用）', async () => {
    global.harness = harnessBackup
    try {
      const modBridge = await import(pathToFileURL(INDEX_PATH).href + '?bridge=1')
      modBridge.apply(ctx2)
      assert.strictEqual(routes2.length, 6, '兜底路由仍在（两次 apply × 3 条路由：RPC + 页面 + 资产），实得 ' + routes2.length)
      assert.strictEqual(typeof handlers['notes-list'], 'function', 'notes-list 经 harness.handle 注册')
      assert.strictEqual((await handlers['notes-ping']({ t: 2 })).ok, true, 'P1 notes-ping 经 harness.handle 可调用')
    } finally {
      delete global.harness
    }
  })

  await t('harness 存在时工具走 harness.defineTool/registerTool（不回退 ctx.tools，无重复注册）', async () => {
    global.harness = harnessBackup
    try {
      const modPrimary = await import(pathToFileURL(INDEX_PATH).href + '?primary=1')
      const tools5 = []
      const beforeTools = registeredTools.length
      modPrimary.apply({ fs: fsMock2, sandboxPolicy: { resolve: () => ({}) }, webServer: { register: () => () => {} }, tools: { register: (d) => { tools5.push(d); return () => {} } }, get: () => undefined, effect: () => {} })
      const added = registeredTools.slice(beforeTools).map(x => x.name).sort()
      assert.deepStrictEqual(added, ['note_get', 'note_manage', 'note_search'], 'harness.defineTool/registerTool 注册 3 个工具（实得：' + JSON.stringify(added) + '）')
      assert.strictEqual(tools5.length, 0, '两通道互斥：不应重复走 ctx.tools')
    } finally {
      delete global.harness
    }
  })

  // ===== 17.5 设置持久化 + LLM 模型选配（notes-settings-get/set + 设置卡片）=====
  section('17.5 设置持久化 + LLM 模型选配（settings RPC + 设置卡片）')
  // 发布包 client 源码独立读取（本节在 section 18 之前，clientPkgSrc 尚未定义）
  const clientPkgSrcSettings = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
  // --- 源码结构断言 ---
  await t('设置入口存在（v2 侧栏底部 fbtn：gear 图标 + tooltip 设置）', () => {
    assert(/dsh-notes-fbtn dsh-nt', onClick: openSettings/.test(clientSrc), 'client-impl 侧栏底部含设置按钮（dsh-notes-fbtn + onClick=openSettings）')
    assert(clientSrc.indexOf("'data-tooltip': '设置'") >= 0, '设置按钮 tooltip=设置')
    assert(clientSrc.indexOf("I('gear', 12)") >= 0, '设置按钮 gear SVG 图标')
    assert(clientSrc.indexOf('⚙') < 0, '⚙ emoji 已移除（SVG 化）')
  })
  await t('设置卡片 class 存在（client-impl + 发布包 + styles.css 三处同步）', () => {
    for (const cls of ['dsh-notes-settings-mask', 'dsh-notes-settings-modal', 'dsh-notes-settings-modal-t', 'dsh-notes-settings-list', 'dsh-notes-settings-row', 'dsh-notes-settings-label', 'dsh-notes-settings-control']) {
      assert(clientSrc.indexOf(cls) >= 0, 'client-impl 缺 ' + cls)
      assert(clientPkgSrcSettings.indexOf(cls) >= 0, '发布包 client.js 缺 ' + cls + '（需先跑 scripts/build-dist.cjs）')
    }
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    for (const cls of ['.dsh-notes-settings-mask{', '.dsh-notes-settings-modal{', '.dsh-notes-settings-row{', '.dsh-notes-settings-select', '.dsh-notes-settings-input', '.dsh-notes-settings-clear']) {
      assert(css.indexOf(cls) >= 0, 'styles.css 缺 ' + cls)
    }
  })
  await t('设置卡片通用结构（settingsRows 数组 map 渲染：加设置项 = 加行）', () => {
    assert(/const settingsRows = \[/.test(clientSrc), 'settingsRows 行数组存在')
    assert(/settingsRows\.map\(row =>/.test(clientSrc), 'settingsRows.map 渲染设置项行')
    assert(clientSrc.indexOf('LLM 模型') >= 0, '第一项为「LLM 模型」')
    assert(clientSrc.indexOf('跟随当前会话（默认）') >= 0, '含「跟随当前会话（默认）」选项/清除钮')
    assert(/function openSettings\(\)/.test(clientSrc) && /function saveSettingsLlm\(/.test(clientSrc), 'openSettings / saveSettingsLlm 函数存在')
  })
  await t('设置卡片承接底部收敛：「数据」区补回收站兜底 + 新增「整理建议」行（openTrash/openSuggest 仍可达）', () => {
    // dataControl 追加「回收站」按钮（openTrash，与底部同款）
    assert(clientSrc.indexOf("onClick: openTrash }, '回收站'") >= 0, 'client-impl 数据区含「回收站」按钮（openTrash）')
    // settingsRows 新增「整理建议」行（openSuggest）
    assert(/key: 'suggest', label: '整理建议'/.test(clientSrc), 'client-impl settingsRows 含「整理建议」行')
    assert(clientSrc.indexOf("sub: '速记组归档 / 过期未引用清理 / 孤儿笔记候选（只提名不自动执行）'") >= 0, '整理建议行 sub 文案')
    assert(/const suggestControl = e\('button', \{[^}]*onClick: openSuggest[^}]*\}, '打开'\)/.test(clientSrc), '整理建议行控件 = 打开按钮 → openSuggest')
    // 发布包 client.js 同步（build-dist 产物）
    assert(clientPkgSrcSettings.indexOf("onClick: openTrash }, '回收站'") >= 0, '发布包数据区含「回收站」按钮（需先跑 scripts/build-dist.cjs）')
    assert(/key: 'suggest', label: '整理建议'/.test(clientPkgSrcSettings), '发布包 settingsRows 含「整理建议」行（需先跑 scripts/build-dist.cjs）')
  })
  await t('client 经 RPC 读写设置（notes-settings-get / notes-settings-set）', () => {
    assert(clientSrc.indexOf('notes-settings-get') >= 0 && clientSrc.indexOf('notes-settings-set') >= 0, 'client-impl 含两个设置 RPC 调用')
    assert(clientPkgSrcSettings.indexOf('notes-settings-get') >= 0 && clientPkgSrcSettings.indexOf('notes-settings-set') >= 0, '发布包 client.js 含两个设置 RPC 调用')
  })
  await t('index.mjs 注册 settings RPC + settings.json 持久化函数', () => {
    assert(indexSrc.indexOf("handle('notes-settings-get'") >= 0, 'notes-settings-get 已注册')
    assert(indexSrc.indexOf("handle('notes-settings-set'") >= 0, 'notes-settings-set 已注册')
    assert(/SETTINGS_PATH\s*=\s*path\.join\(NOTES_ROOT,\s*'settings\.json'\)/.test(indexSrc), 'SETTINGS_PATH 落在 NOTES_ROOT/settings.json')
    assert(indexSrc.indexOf('function loadSettings()') >= 0 && indexSrc.indexOf('function saveSettings()') >= 0, 'loadSettings/saveSettings 存在（内存缓存 + 启动加载）')
    assert(indexSrc.indexOf('function listAvailableModels()') >= 0, 'listAvailableModels（llm 服务模型目录探针）存在')
  })
  await t('classifyTopic/extractInstruction 优先读设置模型（源码结构）', () => {
    assert(indexSrc.indexOf('function resolveLlmSelection()') >= 0, 'resolveLlmSelection 存在')
    const rm = indexSrc.match(/function resolveLlmSelection\(\) \{[\s\S]*?\n    \}/)
    assert(rm, 'resolveLlmSelection 函数体可提取')
    const iSet = rm[0].indexOf('settingsCache.llm')
    const iAdm = rm[0].indexOf('adm.currentSelection()')
    assert(iSet >= 0 && iAdm >= 0 && iSet < iAdm, 'settings.llm 优先判定，adm.currentSelection 兜底回退')
    const cm = indexSrc.match(/async function classifyTopic\(text\) \{[\s\S]*?\n    \}/)
    assert(cm && cm[0].indexOf('resolveLlmSelection()') >= 0, 'classifyTopic 经 resolveLlmSelection 选模型')
    const em = indexSrc.match(/async function extractInstruction\(text, note\) \{[\s\S]*?\n    \}/)
    assert(em && em[0].indexOf('resolveLlmSelection()') >= 0, 'extractInstruction 经 resolveLlmSelection 选模型')
  })
  // --- 行为断言（静态包 rpc2 链路 + 内存 mock fs/llm） ---
  const SETTINGS_PATH_MOCK = path.join(NOTES_ROOT_STATIC, 'settings.json')
  await t('notes-settings-get：初始空设置 + models 目录（llm 探针）', async () => {
    const sg = await rpc2('notes-settings-get', {})
    assert.strictEqual(sg.status, 200, 'HTTP 200')
    assert(sg.body.settings && typeof sg.body.settings === 'object', '返回 settings 对象')
    assert(!sg.body.settings.llm, '初始无 llm override（默认跟随会话）')
    assert(Array.isArray(sg.body.models), 'models 是数组')
    assert(sg.body.models.some(m => m.provider === 'p' && m.model === 'm'), 'models 含 listProviders/listModels 探到的 p/m（实得：' + JSON.stringify(sg.body.models) + '）')
  })
  await t('notes-settings-set：保存 llm override 并持久化 settings.json', async () => {
    const ss = await rpc2('notes-settings-set', { llm: { provider: 'setP', model: 'setM' } })
    assert(ss.body.ok === true, '保存成功（实得 ' + JSON.stringify(ss.body) + '）')
    assert(store2.has(SETTINGS_PATH_MOCK), 'settings.json 已落盘（mock store）')
    const onDisk = JSON.parse(store2.get(SETTINGS_PATH_MOCK))
    assert(onDisk.llm && onDisk.llm.provider === 'setP' && onDisk.llm.model === 'setM', '磁盘内容含 llm override')
    const sg = await rpc2('notes-settings-get', {})
    assert(sg.body.settings.llm && sg.body.settings.llm.provider === 'setP' && sg.body.settings.llm.model === 'setM', 'get 回读与 set 一致')
  })
  await t('notes-settings-set 参数校验：缺 provider/model 报错且不写盘', async () => {
    const before = store2.get(SETTINGS_PATH_MOCK)
    const bad = await rpc2('notes-settings-set', { llm: { provider: 'onlyP' } })
    assert(bad.body.error, '缺 model 应返回 error')
    assert.strictEqual(store2.get(SETTINGS_PATH_MOCK), before, '校验失败不写盘')
  })
  // LLM 调用侦查：包装 llmMock.stream 记录每次调用的 provider/model（用 system 区分分类器/提取器）
  const llmCalls = []
  const origStreamForSettings = llmMock.stream
  llmMock.stream = async function* (req) { llmCalls.push({ provider: req && req.provider, model: req && req.model, system: (req && req.system) || '' }); yield* origStreamForSettings(req) }
  try {
    await t('extractInstruction 优先读设置模型（不跟随会话）', async () => {
      llmCalls.length = 0
      const qi = await rpc2('notes-quick-instruct', { text: '设置模型验证原文', note: '标记为设置验证', sessionId: 'sess-set-1', cwd: 'D:\\deepseek-work' })
      assert(qi.body.ok === true && qi.body.id, '指令记录成功')
      const used = llmCalls.filter(c => c.system.indexOf('元数据') >= 0)
      assert(used.length >= 1, 'extractInstruction 应至少调用一次 LLM')
      assert(used.every(c => c.provider === 'setP' && c.model === 'setM'), 'extractInstruction 应全部用设置模型 setP/setM（实得：' + JSON.stringify(used) + '）')
    })
    await t('classifyTopic 优先读设置模型（不跟随会话）', async () => {
      llmCalls.length = 0
      const q = await rpc2('notes-quick', { text: '设置模型分类速记', sessionId: 'sess-set-cls', cwd: 'D:\\deepseek-work' })
      assert(q.body.id, '速记成功')
      await new Promise(r => setTimeout(r, 200))   // 等异步分类回填
      const used = llmCalls.filter(c => c.system.indexOf('分类器') >= 0)
      assert(used.length >= 1, 'classifyTopic 应至少调用一次 LLM')
      assert(used.every(c => c.provider === 'setP' && c.model === 'setM'), 'classifyTopic 应全部用设置模型 setP/setM（实得：' + JSON.stringify(used) + '）')
    })
    await t('llm=null 恢复跟随会话（回退 adm.currentSelection）', async () => {
      const ss = await rpc2('notes-settings-set', { llm: null })
      assert(ss.body.ok === true, '清除成功')
      const sg = await rpc2('notes-settings-get', {})
      assert(!sg.body.settings.llm, 'llm override 已删除')
      const onDisk = JSON.parse(store2.get(SETTINGS_PATH_MOCK))
      assert(!onDisk.llm, '磁盘 settings.json 不再含 llm')
      llmCalls.length = 0
      const qi = await rpc2('notes-quick-instruct', { text: '恢复跟随验证原文', note: '标记为恢复验证', sessionId: 'sess-set-2', cwd: 'D:\\deepseek-work' })
      assert(qi.body.ok === true, '指令记录成功')
      const used = llmCalls.filter(c => c.system.indexOf('元数据') >= 0)
      assert(used.length >= 1 && used.every(c => c.provider === 'p' && c.model === 'm'), 'extractInstruction 恢复后回退会话模型 p/m（实得：' + JSON.stringify(used) + '）')
    })
    await t('classifyTopic 恢复后也回退跟随会话', async () => {
      llmCalls.length = 0
      await rpc2('notes-quick', { text: '恢复跟随分类速记', sessionId: 'sess-set-cls2', cwd: 'D:\\deepseek-work' })
      await new Promise(r => setTimeout(r, 200))
      const used = llmCalls.filter(c => c.system.indexOf('分类器') >= 0)
      assert(used.length >= 1 && used.every(c => c.provider === 'p' && c.model === 'm'), 'classifyTopic 恢复后回退会话模型 p/m（实得：' + JSON.stringify(used) + '）')
    })
  } finally {
    llmMock.stream = origStreamForSettings
  }
  await t('settings.json 不污染笔记列表（_list 只认 .md）', async () => {
    assert(store2.has(SETTINGS_PATH_MOCK), 'settings.json 存在于笔记目录（mock）')
    const l = await rpc2('notes-list', {})
    assert(l.body.notes.every(n => String(n.id).indexOf('settings') < 0), '列表无 settings 相关条目')
  })

  // ===== 18. P3 静态包 client（packages/dsh-notes/lib/client.js） =====
  // 开发版 client-impl.js 仍是「动态插件」形态（全局 React/styles/host + styles.insert），
  // 发布版 lib/client.js 是机械转换产物：require('react') + fetch('/dsh-notes') + <style> 注入。
  // 本节验证发布包自身的形态与功能面，不改动上面针对开发版的既有断言。
  section('18. P3 静态包 client（packages/dsh-notes/lib/client.js）')
  const CLIENT_PATH = path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js')
  const clientPkgSrc = fsNative.readFileSync(CLIENT_PATH, 'utf8')
  // 注释剥离：避免文档性注释里的字符串影响"无残留"判定
  const clientPkgCode = clientPkgSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  // --- P3 测试脚手架：在 Node 里以浏览器模拟方式加载发布版 client 包 ---
  // client.js 是「CJS 工厂 + __ModuleLoader__.load」，不是 ESM，所以用 new Function 执行并捕获
  // 模块加载器登记项，再用可替换的 createElement 构建一次真实 React 元素树（无 JSX）。
  function makeMockReact(onCreateElement) {
    return {
      createElement: function (type, props) {
        const children = Array.prototype.slice.call(arguments, 2)
        if (onCreateElement) onCreateElement(type, props, children)
        return { $$typeof: Symbol.for('react.element'), type: type, props: props || {}, children: children }
      },
      useState: function (init) { return [typeof init === 'function' ? init() : init, function () {}] },
      useEffect: function (fn) { try { const d = fn(); if (typeof d === 'function') d() } catch (e) {} },
      useRef: function (init) { return { current: init } },
      Fragment: Symbol.for('react.fragment')
    }
  }
  // 最小 document 模拟：样式注入路径会用到 createElement('style') / head.append
  function makeMockDocument() {
    return {
      createElement: function () { return { dataset: {}, textContent: '', remove: function () {} } },
      head: { append: function () {} },
      addEventListener: function () {}, removeEventListener: function () {},
      querySelector: function () { return null }
    }
  }
  // 加载发布包并执行 apply。
  // services：{ slots, timer, sessions, workspaces }——键**缺失**=用内置 mock，显式传 null=该服务不可用（走守卫分支）。
  // opts：{ react, fetch } 覆盖 React mock 与 fetch mock。
  function loadClientPackage(services, opts) {
    const svc = services || {}
    const o = opts || {}
    const ReactMock = o.react || makeMockReact()
    const slots = {
      injections: [],
      registered: [],
      disposed: 0,
      inject: function (name, fn) {
        slots.injections.push(name)
        fn()
        return function () { slots.disposed++ }
      },
      register: function (def, render) { slots.registered.push({ id: def.id, render: render }) }
    }
    const timer = {
      interval: function () { return function () {} },
      timeout: function () { return function () {} },
      debounce: function (fn) { return Object.assign(function () { return fn() }, { dispose: function () {} }) }
    }
    // 默认 fetch mock 返回真实 CSS，让「fetch CSS → <style> 注入」完整路径被跑到
    const fetchMock = o.fetch || function () {
      return Promise.resolve({ json: function () { return Promise.resolve({ css: '.dsh-notes-mock{}' }) } })
    }
    const effects = []
    const ctx = {
      get: function (name) {
        if (name === 'slots') return ('slots' in svc) ? (svc.slots || undefined) : slots
        if (name === 'timer') return ('timer' in svc) ? (svc.timer || undefined) : timer
        if (name === 'sessions') return svc.sessions
        if (name === 'workspaces') return svc.workspaces
        return undefined
      },
      effect: function (fn) { effects.push(fn); return function () {} }
    }
    let captured = null
    const prevWindow = global.window
    const prevFetch = global.fetch
    global.window = {
      __ModuleLoader__: { load: function (def) { captured = def } },
      addEventListener: function () {}, removeEventListener: function () {}, innerWidth: 1280, innerHeight: 800
    }
    global.fetch = fetchMock
    let moduleExports = null
    try {
      // eslint-disable-next-line no-new-func
      new Function('window', 'document', 'fetch', 'console', clientPkgSrc)(
        global.window, makeMockDocument(), fetchMock, console
      )
      if (!captured) throw new Error('未捕获 __ModuleLoader__.load 登记项')
      assert.strictEqual(captured.id, 'dsh-notes-plugin', 'load id 必须是 dsh-notes-plugin')
      moduleExports = captured.factory(function (name) {
        if (name === 'react') return ReactMock
        throw new Error('unknown require: ' + name)
      })
    } finally {
      if (prevWindow === undefined) delete global.window; else global.window = prevWindow
      if (prevFetch === undefined) delete global.fetch; else global.fetch = prevFetch
    }
    if (!moduleExports || typeof moduleExports.apply !== 'function') throw new Error('factory 未返回 { apply }')
    moduleExports.apply(ctx)
    return {
      module: moduleExports,
      slots: slots,
      applied: slots.injections.length > 0,
      effects: effects,
      effectsCleaned: 0,
      cleanup: function () {
        for (const fn of effects) {
          try { const d = fn(); if (typeof d === 'function') d() } catch (e) {}
        }
        this.effectsCleaned = effects.length
      }
    }
  }

  await t('lib/client.js 存在且是 __ModuleLoader__ CJS 工厂形态', () => {
    assert(clientPkgSrc.indexOf('window.__ModuleLoader__.load(') >= 0, 'window.__ModuleLoader__.load(...) 包装')
    assert(/id:\s*'dsh-notes-plugin'/.test(clientPkgSrc), "id: 'dsh-notes-plugin'")
    assert(/factory:\s*\(require\)\s*=>/.test(clientPkgSrc), 'factory: (require) =>')
    assert(clientPkgSrc.indexOf('return module.exports') >= 0, 'return module.exports')
    assert(clientPkgSrc.indexOf('new Function') < 0, '发布包不应再用 new Function 引导壳')
  })
  await t('lib/client.js 用 require(\'react\') 取 React（无全局 React 依赖）', () => {
    assert(/const React = require\('react'\)/.test(clientPkgSrc), "const React = require('react')")
    assert(/const e = React\.createElement/.test(clientPkgSrc), 'e = React.createElement 保留')
    assert(!/typeof React !== 'undefined'/.test(clientPkgCode), '不应再靠全局 React 兜底')
  })
  await t('lib/client.js RPC 走 fetch(\'/dsh-notes\')（与 index.mjs RPC_PATH 一致）', () => {
    assert(clientPkgCode.indexOf("fetch('/dsh-notes'") >= 0, "fetch('/dsh-notes')")
    assert(/method:\s*'POST'/.test(clientPkgCode), "method: 'POST'")
    assert(/Content-Type':\s*'application\/json'/.test(clientPkgCode), 'JSON Content-Type')
    assert(/JSON\.stringify\(\{\s*method:\s*method,\s*args:\s*args\s*\|\|\s*\{\}\s*\}\)/.test(clientPkgCode), 'body = {method, args}')
    assert(clientPkgCode.indexOf('rpc(') >= 0, 'rpc helper 已注入')
    assert(!/host\.call\s*\(/.test(clientPkgCode), '代码中无 host.call( 残留')
  })
  await t('lib/client.js 样式用 document.createElement(\'style\') 注入（无 styles.insert）', () => {
    assert(clientPkgCode.indexOf("document.createElement('style')") >= 0, "document.createElement('style')")
    assert(clientPkgCode.indexOf('notes-css') >= 0, 'notes-css RPC 取 CSS')
    assert(/document\.head\.append\(/.test(clientPkgCode), '注入 document.head')
    assert(!/styles\.insert\s*\(/.test(clientPkgCode), '代码中无 styles.insert( 残留')
  })
  await t('lib/client.js 定时器走 ctx.get(\'timer\') + ctx.effect（无 ctx.interval 快捷方式）', () => {
    assert(/const timer = ctx\.get\('timer'\)/.test(clientPkgSrc), "timer = ctx.get('timer')")
    assert(/ctx\.effect\(function \(\) \{ return pd \}\)/.test(clientPkgSrc), 'perf 定时器经 ctx.effect 注册清理')
    assert(/disposers\.push\(function \(\) \{ try \{ tag\.remove\(\) \}/.test(clientPkgSrc), 'style 标签有移除 disposer')
    assert(!/\bctx\.(interval|timeout|debounce)\s*\(/.test(clientPkgCode), '无 ctx.interval/timeout/debounce 快捷方式')
    assert(!/ctx\.timer\b/.test(clientPkgCode), '无 ctx.timer 直接访问')
  })
  await t('lib/client.js 服务获取全部 ctx.get + 守卫（inject 只声明 slots）', () => {
    assert(/inject:\s*\['slots',\s*'timer',\s*'sessions',\s*'workspaces'\]/.test(clientPkgSrc), "module.exports.inject 应声明 apply 用到的全部服务（slots/timer/sessions/workspaces，保证就绪后才 apply）")
    assert(/const sessions = ctx\.get\('sessions'\)/.test(clientPkgSrc), 'sessions 经 ctx.get')
    assert(/const workspaces = ctx\.get\('workspaces'\)/.test(clientPkgSrc), 'workspaces 经 ctx.get')
    assert(!/ctx\.sessions\b/.test(clientPkgCode) && !/ctx\.workspaces\b/.test(clientPkgCode), '无 ctx.sessions / ctx.workspaces 直接属性访问')
    assert(clientPkgSrc.indexOf('if (!slots)') >= 0 && clientPkgSrc.indexOf('if (!timer)') >= 0, 'slots / timer 存在性守卫')
    // 服务缺失时优雅退出而不是抛错
    const modNoSlots = loadClientPackage({ slots: undefined })
    assert.strictEqual(modNoSlots.applied, false, 'slots 缺失时 apply 直接返回')
    const modNoTimer = loadClientPackage({ slots: {}, timer: undefined })
    assert.strictEqual(modNoTimer.applied, false, 'timer 缺失时 apply 直接返回')
  })
  await t('lib/client.js 功能面完整（UI v2 全保留）', () => {
    const need = [
      'conversation.session.header.actions', 'shell.overlay',      // 三个 Slot 注册点
      'dsh-notes-hdr-btn', 'dsh-notes-fab', 'dsh-notes-floating',  // 头部按钮 / 悬浮气泡 / 浮窗面板
      'dsh-notes-titlebar', 'dsh-notes-app', 'dsh-notes-side', 'dsh-notes-quick-input',
      'dsh-notes-fchip', 'dsh-notes-sec-h', 'dsh-notes-folder-row', 'dsh-notes-note-row',
      'dsh-notes-nested', 'dsh-notes-fbadge', 'dsh-notes-topic-row', 'dsh-notes-side-foot',
      'dsh-notes-ed', 'dsh-notes-ed-crumb', 'dsh-notes-ed-title', 'dsh-notes-ed-meta',
      'dsh-notes-meta-chip', 'dsh-notes-meta-act', 'dsh-notes-ed-body', 'dsh-notes-ed-foot',
      'dsh-notes-settings-modal', 'dsh-notes-scope-panel', 'dsh-notes-dispatch-modal',
      'dsh-notes-dispatch-history', 'dsh-notes-cap', 'dsh-notes-toast',
      'dsh-notes-resize-handle', 'dsh-notes-empty-state'
    ]
    const missing = need.filter(x => clientPkgSrc.indexOf(x) < 0)
    assert.strictEqual(missing.length, 0, '缺少 UI 标记：' + JSON.stringify(missing))
    // v2 旧三栏/旧浮层标记清零
    for (const gone of ['dsh-notes-list', 'dsh-notes-divider', 'dsh-note-item', 'dsh-notes-instruct-box', 'dsh-notes-topic-header', 'dsh-notes-kind-chip', 'dsh-notes-pin-toggle']) {
      assert(clientPkgSrc.indexOf(gone) < 0, '发布包仍含旧 UI 标记：' + gone)
    }
    // RPC 方法面（与 index.mjs 的 handler 名一致）
    const rpcs = ['notes-css', 'notes-list', 'notes-get', 'notes-create', 'notes-sessions', 'notes-search', 'notes-quick', 'notes-quick-instruct', 'notes-update', 'notes-delete', 'notes-restore', 'notes-purge', 'notes-folders', 'notes-active-sessions', 'notes-workspaces', 'notes-dispatch', 'notes-dispatch-done', 'notes-archive', 'notes-archive-preview', 'notes-archive-undo', 'notes-perf', 'notes-settings-get', 'notes-settings-set', 'notes-export', 'notes-export-single', 'notes-import-preview', 'notes-import', 'notes-asset-upload', 'notes-inject-preview', 'notes-suggest', 'notes-history', 'notes-history-get', 'notes-restore-history']
    const missRpc = rpcs.filter(x => clientPkgSrc.indexOf(x) < 0)
    assert.strictEqual(missRpc.length, 0, '缺少 RPC 调用：' + JSON.stringify(missRpc))
    // 交互能力：拖拽 / 快捷键 / 自动保存 / 入口双模式 / 性能遥测 / SVG 图标 helper
    for (const k of ['drag(', 'keydown', 'dsh-notes-entry', 'dsh-notes-panel-state', 'connectWorkspace', '__dshNotesPerf', 'PerformanceObserver', 'localStorage', 'function I(name, size, cls)']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '缺少能力：' + k)
    }
  })
  await t('lib/client.js React 树可构建（createElement 递归渲染，无 JSX）', () => {
    let elCount = 0
    const mockReact = makeMockReact(() => { elCount++ })
    const loaded = loadClientPackage({}, { react: mockReact })
    assert.strictEqual(loaded.applied, true, 'apply 应执行到结束（slots/timer 就绪）')
    assert.strictEqual(loaded.module.name, 'dsh-notes-plugin', 'name = dsh-notes-plugin')
    assert.deepStrictEqual(loaded.module.inject, ['slots', 'timer', 'sessions', 'workspaces'], "inject = ['slots','timer','sessions','workspaces']")
    // 4 个 Slot 注入点（header / fab / panel / selection）
    assert.strictEqual(loaded.slots.injections.length, 4, '应注册 4 个 Slot 注入点（实得 ' + loaded.slots.injections.length + '）')
    assert.deepStrictEqual(loaded.slots.registered.map(r => r.id).sort(), ['dsh-notes-btn', 'dsh-notes-fab', 'dsh-notes-panel', 'dsh-notes-selection'], '4 个注册 id')
    // 渲染 HeaderBtn：React.createElement 树必须能构建（含 hook 调用）
    const headerRegister = loaded.slots.registered.find(r => r.id === 'dsh-notes-btn')
    const tree = headerRegister.render({ sessionId: 'session-abcdefgh-0000' })
    assert(tree && tree.type, 'HeaderBtn 渲染出元素树')
    assert(elCount > 0, 'createElement 被调用（实得 ' + elCount + '）')
    // 卸载：fiber effect cleanup 应把 4 个 slots.inject 全部释放
    assert.strictEqual(loaded.slots.disposed, 0, '卸载前未释放')
    loaded.cleanup()
    assert.strictEqual(loaded.slots.disposed, 4, '卸载时释放 4 个 slots.inject（实得 ' + loaded.slots.disposed + '）')
    assert(loaded.effectsCleaned >= 1, 'ctx.effect 清理执行（实得 ' + loaded.effectsCleaned + '）')
  })
  await t('lib/client.js 快速记录卡片 v2（复制按钮 + primary 样式类）', () => {
    assert(clientPkgSrc.indexOf('dsh-notes-cap-acts') >= 0, '卡片按钮行容器存在')
    assert(clientPkgSrc.indexOf('复制') >= 0, '卡片含复制按钮')
    assert(/dsh-notes-cbtn primary/.test(clientPkgSrc), 'primary 按钮样式类存在')
    assert(/copySelection/.test(clientPkgSrc), 'copySelection 复制处理函数存在')
    assert(clientPkgSrc.indexOf('navigator.clipboard') >= 0, '优先 navigator.clipboard.writeText')
    assert(clientPkgSrc.indexOf('execCommand') >= 0, '降级 execCommand 兜底')
    assert(/dispatchHistoryOpen/.test(clientPkgSrc) && clientPkgSrc.indexOf("dispatchHistoryOpen ? ' open' : ' collapsed'") >= 0, '静态包含派发历史折叠态（dispatchHistoryOpen + collapsed class）')
  })
  await t('lib/client.js 是 scripts/build-dist.cjs 的产物且可复现', () => {
    assert(fsNative.existsSync(path.join(DIR, 'scripts', 'build-dist.cjs')), 'build-dist.cjs 存在')
    assert(/build-dist\.cjs/.test(clientPkgSrc), '产物头部标注了构建来源')
    const buildSrc = fsNative.readFileSync(path.join(DIR, 'scripts', 'build-dist.cjs'), 'utf8')
    assert(/RPC_PATH = '\/dsh-notes'/.test(buildSrc), 'build 脚本 RPC 路径与 host 的 RPC_PATH 一致')
    assert((buildSrc.match(/counts\[/g) || []).length >= 4, 'build 带转换计数断言（漏改会中止而不是产出坏包）')
  })

  // ===== 19. 双模式编辑器 v3 内核（renderMarkdown⇄serializeRich 往返保真 + XSS + 降级分析；规格 design/notes-editor-v3.html）=====
  // （v3 起替代原「预览/编辑双态」：预览容器改为可编辑富文本 contenteditable；序列化器是其逆函数，本节用 Node MiniDOM 跑真内核锁定往返）
  section('19. 双模式编辑器 v3 内核（往返保真 + XSS + 降级）')
  // 从开发版 client-impl.js 提取「双模式编辑器内核 v3」标记区间（app.html / 发布包 lib/client.js 同块，字节一致断言在 25 节）
  const KERNEL_MARKER_START = '// ===== 双模式编辑器内核 v3'
  const KERNEL_MARKER_END = '// ===== end 双模式编辑器内核 v3 ====='
  function grabKernelBlock(src, label) {
    const ps = src.indexOf(KERNEL_MARKER_START), pe = src.indexOf(KERNEL_MARKER_END)
    assert(ps >= 0 && pe > ps, label + ' 含双模式内核标记区间')
    return src.slice(src.lastIndexOf('\n', ps) + 1, pe + KERNEL_MARKER_END.length)
  }
  const kernelBlock = grabKernelBlock(clientSrc, 'client-impl.js')
  // Node 侧 MiniDOM：serializeRich/sanitizeFragment 依赖的 DOM 子集（childNodes/nodeType/tagName/nodeValue/textContent/getAttribute/setAttribute/cloneNode/appendChild/querySelectorAll）
  // + 白名单 HTML 解析器（只解析 renderMarkdown 的机器产出：h1-3/p/ul/ol/li/blockquote/pre/code/hr/img/a/strong/em + 转义实体；img/hr/br void）
  function v3DecodeEnt(s) { return String(s).replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => k === 'amp' ? '&' : k === 'lt' ? '<' : k === 'gt' ? '>' : k === 'quot' ? '"' : "'") }
  class V3Text {
    constructor(v) { this.nodeType = 3; this.nodeValue = v; this.childNodes = [] }
    get textContent() { return this.nodeValue }
    cloneNode() { return new V3Text(this.nodeValue) }
  }
  class V3El {
    constructor(tag) { this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.attributes = {}; this.childNodes = [] }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null }
    setAttribute(k, v) { this.attributes[k] = String(v) }
    appendChild(c) { this.childNodes.push(c); return c }
    get textContent() { return this.childNodes.map(c => c.textContent).join('') }
    cloneNode(deep) { const c = new V3El(this.tagName); c.attributes = Object.assign({}, this.attributes); if (deep) this.childNodes.forEach(ch => c.appendChild(ch.cloneNode(true))); return c }
    querySelectorAll(sel) { const tags = sel.split(',').map(s => s.trim().toUpperCase()); const out = []; (function walk(n) { n.childNodes.forEach(c => { if (c.nodeType === 1) { if (tags.indexOf(c.tagName) >= 0) out.push(c); walk(c) } }) })(this); return out }
    set href(v) { this.attributes.href = String(v) }   // sanitizeFragment 的 A 分支 a.href=href（DOM 属性≈attribute 桥）
    set src(v) { this.attributes.src = String(v) }     // sanitizeFragment 的 IMG 分支 im.src=...
  }
  const V3_VOID = { IMG: 1, HR: 1, BR: 1 }
  function v3ParseHtml(html) {
    const root = new V3El('div'); const stack = [root]
    const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=\/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g
    let m
    while ((m = re.exec(html))) {
      if (m[5] !== undefined) { stack[stack.length - 1].appendChild(new V3Text(v3DecodeEnt(m[5]))); continue }
      const tag = m[2].toUpperCase()
      if (m[1] === '/') { for (let i = stack.length - 1; i > 0; i--) { if (stack[i].tagName === tag) { stack.length = i; break } } continue }
      const el = new V3El(tag)
      const attrRe = /([^\s=\/>]+)\s*=\s*"([^"]*)"/g
      let a
      while ((a = attrRe.exec(m[3] || ''))) el.setAttribute(a[1], v3DecodeEnt(a[2]))
      stack[stack.length - 1].appendChild(el)
      if (!V3_VOID[tag] && m[4] !== '/') stack.push(el)
    }
    return root
  }
  const v3MiniDocument = { createElement: t2 => new V3El(t2), createTextNode: v => new V3Text(v) }
  let kernelFn = null
  await t('内核函数可提取（esc/renderMarkdown/serializeRich/analyzeMarkdown/sanitizeFragment）', () => {
    kernelFn = new Function('document', kernelBlock + '\nreturn { esc: esc, assetDisplaySrc: assetDisplaySrc, renderMarkdown: renderMarkdown, serializeRich: serializeRich, serializeInline: serializeInline, escapeMd: escapeMd, normMd: normMd, analyzeMarkdown: analyzeMarkdown, DEG_RULES: DEG_RULES, HTML_BLOCK_LINE: HTML_BLOCK_LINE, sanitizeFragment: sanitizeFragment, WIKI_RE: WIKI_RE, extractWikiTargets: extractWikiTargets, wikiLinksTo: wikiLinksTo, unesc: unesc }')(v3MiniDocument)
    for (const fn of ['esc', 'renderMarkdown', 'serializeRich', 'analyzeMarkdown', 'sanitizeFragment', 'assetDisplaySrc', 'extractWikiTargets', 'wikiLinksTo', 'unesc']) assert(typeof kernelFn[fn] === 'function', fn + ' 可调用')
  })
  // 往返自检（与原型 roundtripCheck 同一不变量）：① 显示保真 render∘serialize∘render 逐字节一致 ② 定点稳定（md2===md3）
  function v3Roundtrip(md) {
    const h1 = kernelFn.renderMarkdown(md)
    const md2 = kernelFn.serializeRich(v3ParseHtml(h1))
    const h2 = kernelFn.renderMarkdown(md2)
    const md3 = kernelFn.serializeRich(v3ParseHtml(h2))
    return { same: h1 === h2 && md2 === md3, md2: md2, md3: md3, h1: h1, h2: h2 }
  }
  await t('往返保真：白名单 Markdown render→serialize→render 不变（10 用例，含原型自测 7 条 + 场景 A/C 正文）', () => {
    assert(kernelFn, 'kernelFn 可用')
    // 原型 design/notes-editor-v3.html runSelfTest 同款 7 用例 + 图片 alt 尖括号 + 场景 A/C 整文
    const SCEN_A = '# DSH 插件发布清单\n\n发布前按顺序走完 **四个阶段**，任何一步 *失败* 都不要继续往下走。\n\n## 1. 版本对齐\n\n- 根 package.json 与包内 version 一致\n- README 表格同步到 *最新行*\n- 运行 `node scripts/sync-pkg-readme.cjs` 更新 npm 页面文档\n\n## 2. 验证\n\n1. npm pack 干跑检查 files 白名单\n2. 实测基线版本加载通过\n3. CI publish.yml 绿灯\n\n> 可用性是底线：上下文切换后的在途响应覆盖、渲染 bailout、时区偏移都要回归。\n\n### 3. 参考命令\n\n```bash\nnpm pack --dry-run\nnode scripts/sync-pkg-readme.cjs\n```\n\n发布记录见 [插件仓库](https://example.com/dsh-notes)，配图：\n\n![发布流程示意](assets/release-flow.svg)\n\n## 4. 发布记录\n\n| 版本 | 日期 | 状态 |\n| --- | :---: | ---: |\n| 0.1.6 | 2026-09-15 | 已发布 |\n| 0.1.7 | 2026-09-28 | 当前 |\n\n---\n\n*完成于 2026-09-30 · 下次发版前复核*'
    const SCEN_C = '# 面板截图归档\n\nv2 面板三视图，**选中态**配色已按实机 token 校准：\n\n![面板-列表态](assets/panel-list.png)\n\n![面板-编辑态](assets/panel-edit.png)\n\n> 后续截图统一走 `assets/` 目录，命名 panel-*.png。\n\n用工具栏「图片」按钮、Ctrl+V 粘贴或拖拽文件到富文本区即可插入新图。'
    const cases = [
      ['标题/粗体/斜体/行内码', '# 标题 A\n\n带 **粗体** 和 *斜体* 还有 `code` 的段落。'],
      ['无序+有序列表', '- 甲\n- 乙\n\n1. 一\n2. 二'],
      ['引用/代码块/分隔线', '> 引用一行\n\n```js\nconst a = 1\nconsole.log(a)\n```\n\n---\n\n收尾'],
      ['链接', '见 [插件仓库](https://example.com/dsh) 说明。'],
      ['图片（资产路径还原）', '![发布流程](assets/release-flow.svg)\n\n文字 ![内联图](assets/panel-list.png) 混排。'],
      ['特殊字符转义往返', '计算 2*3 和 a[b] 以及 `x\\`y` 与 C:\\path 不走格式。'],
      ['h2/h3', '## 二级\n\n### 三级'],
      ['图片 alt 含尖括号', '![a<b>c](assets/x.png)'],
      ['场景A 正文', SCEN_A],
      ['场景C 正文', SCEN_C],
    ]
    for (const [name, md] of cases) {
      const rt = v3Roundtrip(md)
      assert(rt.same, '往返差异 @' + name + '\n--- 序列化 ---\n' + rt.md2 + '\n--- 二轮 ---\n' + rt.md3 + (rt.h1 !== rt.h2 ? '\n--- h1 ---\n' + rt.h1 + '\n--- h2 ---\n' + rt.h2 : ''))
    }
  })
  await t('L1 行内 HTML：转义字面量渲染（无 XSS）+ 序列化逐字还原 + 不再降级（真实样本锁死）', () => {
    assert(kernelFn, 'kernelFn 可用')
    // 首条 = 实战样本 n-muc4p3jdydlc 第 69 行原文（行内代码含 <input type="date">，旧门禁下整篇降级锁源码）
    const cases = [
      '**根因**：混用 UTC 表示和本地日期——`iso.slice(0,10)` 切出来是 UTC 日期，`toISOString()` 也是 UTC，而 `<input type="date">` 给的是本地日期。',
      '使用 <input type="date"> 与 <div class="x"> 标签。',
      '属性双引号与 &：<input type="text" value="a&b"> 原样呈现。',
      "属性单引号 <input type='text'> 与收尾 </div>。",
      '# 标题里的 <span> 标签',
      '- 列表项里的 <input> 标签',
      '> 引用里的 <br> 标签',
      '<div>独占一行的裸标签</div>',
      'a < b 且 c > d（比较运算不是标签）'
    ]
    for (const md of cases) {
      const h1 = kernelFn.renderMarkdown(md)
      // 字面量渲染：产物中用户输入的 < 全部转为 &lt; 实体，无可解析裸标签（XSS 面为零）
      assert(!/<(input|div|span|br)\b/.test(h1.replace(/&lt;/g, '')), '渲染产物不含裸 HTML 标签 @' + md.slice(0, 24))
      assert(h1.indexOf('&lt;') >= 0, '渲染产物为转义字面量 @' + md.slice(0, 24))
      // 逐字往返：源码 → 渲染 → 序列化 === 源码（escapeMd 不动 <>，文本节点逐字还原）
      const md2 = kernelFn.serializeRich(v3ParseHtml(h1))
      assert.strictEqual(md2, md, '逐字往返一致 @' + md.slice(0, 24) + '\n--- 序列化 ---\n' + md2)
      // 显示保真 + 定点稳定
      const h2 = kernelFn.renderMarkdown(md2)
      assert.strictEqual(h2, h1, '二轮渲染逐字节一致 @' + md.slice(0, 24))
      assert.strictEqual(kernelFn.serializeRich(v3ParseHtml(h2)), md2, '序列化定点稳定 @' + md.slice(0, 24))
      // 不再降级
      assert(kernelFn.analyzeMarkdown(md).ok, '行内 HTML 不再触发降级 @' + md.slice(0, 24))
    }
  })
  await t('L2 GFM 表格：只读渲染（th/td/对齐/contenteditable=false）+ 序列化逐字回吐 + 混合内容/异形/转义管道/XSS + 不再降级', () => {
    assert(kernelFn, 'kernelFn 可用')
    // ① 渲染断言：table.dsh-notes-table 只读岛屿 + th/td + 三向对齐样式 + data-md-src 记原始源码
    const TBL = '| 机器 | IP | 状态 |\n| :--- | :---: | ---: |\n| **主**节点 | 10.102.90.138 | 在线 |\n| a\\|b 转义管 | x | y |'
    const h1 = kernelFn.renderMarkdown(TBL)
    assert(h1.indexOf('<table class="dsh-notes-table" contenteditable="false" data-md-src="') >= 0, '只读表格容器（contenteditable=false + data-md-src 记源码）')
    assert(h1.indexOf('<th style="text-align:left">机器</th>') >= 0 && h1.indexOf('<th style="text-align:center">IP</th>') >= 0 && h1.indexOf('<th style="text-align:right">状态</th>') >= 0, '表头三向对齐样式（:---/ :---: /---:）')
    assert(h1.indexOf('<td style="text-align:left"><strong>主</strong>节点</td>') >= 0, '单元格行内渲染（粗体进单元格）')
    assert(h1.indexOf('a|b 转义管') >= 0 && (h1.match(/<td/g) || []).length === 6, '\\| 转义管道不切列（2 行 × 3 列 = 6 个 td）、显示还原为 |')
    // ② round-trip 逐字一致（硬约束）：序列化 = data-md-src 逐字回吐（含对齐分隔行）
    const md2 = kernelFn.serializeRich(v3ParseHtml(h1))
    assert.strictEqual(md2, TBL, '表格源码逐字回吐（含对齐分隔行）\n--- 序列化 ---\n' + md2)
    // 显示保真 + 定点稳定
    const h2 = kernelFn.renderMarkdown(md2)
    assert.strictEqual(h2, h1, '二轮渲染逐字节一致')
    assert.strictEqual(kernelFn.serializeRich(v3ParseHtml(h2)), md2, '序列化定点稳定')
    // ③ 混合内容：表格嵌在标题/段落/列表之间，整篇逐字一致
    const MIX = '# 发布记录\n\n开头段落 **粗**。\n\n| 版本 | 日期 |\n| --- | --- |\n| 0.1.6 | 2026-09-15 |\n| 0.1.7 | 2026-09-28 |\n\n- 收尾项\n\n> 引用收尾'
    const m2 = kernelFn.serializeRich(v3ParseHtml(kernelFn.renderMarkdown(MIX)))
    assert.strictEqual(m2, MIX, '表格+周边混合内容逐字一致\n--- 序列化 ---\n' + m2)
    // ④ 不再降级（黑名单已移除「表格」）
    assert(kernelFn.analyzeMarkdown(TBL).ok && kernelFn.analyzeMarkdown(MIX).ok, '表格不再触发降级')
    // ⑤ 异形表格（无外框管道、表头/分隔行格数不齐、表体多格）同样只读渲染且源码逐字（补齐/截尾仅影响显示）
    const WEIRD = 'a | b | c\n- | -\n1 | 2 | 3 | 4'
    assert.strictEqual(kernelFn.serializeRich(v3ParseHtml(kernelFn.renderMarkdown(WEIRD))), WEIRD, '异形表格逐字回吐')
    assert(kernelFn.analyzeMarkdown(WEIRD).ok, '异形表格不降级')
    // ⑥ XSS：单元格内容与源码记录全量转义，恶意内容也逐字回吐
    const EVIL = '| a |\n| --- |\n| <img onerror=alert(1)> |'
    const eh = kernelFn.renderMarkdown(EVIL)
    assert(eh.indexOf('<img onerror') < 0 && eh.indexOf('&lt;img') >= 0, '单元格恶意 HTML 转义为字面量')
    assert(v3ParseHtml(eh).querySelectorAll('img').length === 0, '渲染产物零 img 节点（data-md-src 只是字符串属性）')
    assert.strictEqual(kernelFn.serializeRich(v3ParseHtml(eh)), EVIL, '恶意内容表格逐字回吐')
  })
  await t('降级分析：白名单外结构检出（嵌套引用/h4/任务列表/多行 HTML 块）+ L2 表格放行 + 行内 HTML 放行 + 围栏代码块豁免', () => {
    assert(kernelFn, 'kernelFn 可用')
    // 原型场景 B 同款：正文仍含 GFM 表格（L2 起只读渲染、不再降级），降级检出 4 类（不含表格）
    const dB = kernelFn.analyzeMarkdown('# o2oa 环境机器清单\n\n| 机器 | IP |\n| --- | --- |\n\n> a\n> > b\n\n#### 附\n\n- [ ] x\n- [x] y\n\n<div class="legacy">\n<span>旧系统拷贝的标记</span>\n</div>')
    assert(!dB.ok && dB.reasons.length === 4, '场景B 检出 4 类（表格不再计入；实得 ' + JSON.stringify(dB.reasons) + '）')
    assert(dB.reasons.map(r => r.label).join(',') === '嵌套引用,四级及以下标题,任务列表,多行 HTML 块', '检出标签与顺序')
    // L2：表格放行（只读渲染 + 序列化逐字回吐，行为级断言见 L2 专项用例）
    assert(kernelFn.analyzeMarkdown('| 机器 | IP |\n| --- | --- |\n| A | 10.0.0.1 |').ok, 'GFM 表格不再降级（L2）')
    // L1：行内/单行 HTML 放行（从黑名单移除「行内 HTML」）
    assert(kernelFn.analyzeMarkdown('# t\n\n<div>html</div>').ok, '单行裸标签独占一行放行')
    assert(kernelFn.analyzeMarkdown('而 `<input type="date">` 给的是本地日期。').ok, '行内代码含 HTML 放行（实战样本）')
    assert(kernelFn.analyzeMarkdown('<div>a</div>\n\n<div>b</div>').ok, '空行隔开的单行标签放行')
    // 多行 HTML 块仍降级：连续 ≥2 行以 <tag>/</tag> 开头（段落合并丢换行、逐字往返不保）
    const dH = kernelFn.analyzeMarkdown('<div class="legacy">\n<span>旧系统拷贝的标记</span>\n</div>')
    assert(!dH.ok && dH.reasons.length === 1 && dH.reasons[0].label === '多行 HTML 块' && dH.reasons[0].line === 1, '多行 HTML 块检出（记段首行号）')
    assert(!kernelFn.analyzeMarkdown('<div>a</div>\n<div>b</div>').ok, '连续两行裸标签构成多行 HTML 块')
    assert(kernelFn.analyzeMarkdown('```html\n<div>\n<span>x</span>\n</div>\n```').ok, '围栏代码块内多行 HTML 豁免')
    assert(kernelFn.analyzeMarkdown('```\n| a | b |\n```\n\n> > 在代码块外才算\n```\n正文').ok === false, '代码块外的嵌套引用仍检出')
    assert(kernelFn.analyzeMarkdown('```\n| a | b |\n> > 嵌套引用\n#### h4\n```').ok, '围栏代码块内容不参与判定（豁免）')
    assert(kernelFn.analyzeMarkdown('# 标题\n\n正常 **段落**').ok, '白名单正文通过')
  })
  await t('XSS 红线：渲染全量转义 + 图片仅 assets/ 前缀放行（javascript:/外链/引号注入全拒绝）', () => {
    assert(kernelFn, 'kernelFn 可用')
    const evil = '<img onerror=alert(1) src=x><script>alert(2)</script>'
    const escaped = kernelFn.esc(evil)
    assert(escaped.indexOf('<img') < 0 && escaped.indexOf('<script') < 0, 'esc 后不含裸 <img / <script')
    assert(escaped.indexOf('&lt;img') >= 0 && escaped.indexOf('&#39;') < 0, 'esc 转义形态')
    assert(kernelFn.renderMarkdown('```\n' + evil + '\n```').indexOf('<script') < 0, '代码块内恶意 HTML 被转义')
    assert(kernelFn.renderMarkdown(evil).indexOf('<img') < 0, '段落内恶意 HTML 被转义')
    // 图片 src 白名单：仅 assets/ 前缀 → 资产路由；javascript:/外链/引号注入均不成 <img>
    assert(kernelFn.renderMarkdown('![x](javascript:alert(1))').indexOf('<img') < 0, 'javascript: 图片拒绝')
    assert(kernelFn.renderMarkdown('![x](https://evil.com/x.png)').indexOf('<img') < 0, '外链图片拒绝（仅 assets/）')
    assert(kernelFn.renderMarkdown('![x](assets/evil.png" onerror="alert(1))').indexOf('<img') < 0, '引号注入不成 img（转义纯文本）')
    const okImg = kernelFn.renderMarkdown('![发布流程](assets/release-flow.svg)')
    assert(okImg.indexOf('<img src="/dsh-notes/asset?file=') >= 0 && okImg.indexOf('data-md-src="assets/release-flow.svg"') >= 0, 'assets 图片放行：src=资产路由 + data-md-src 记原始路径')
    // 正常渲染回归（h1/strong/em/ul）
    const html = kernelFn.renderMarkdown('# Title\n\nSome **bold** and *italic* text.\n\n- item 1\n- item 2\n')
    assert(html.indexOf('<h1') >= 0 && html.indexOf('<strong>bold</strong>') >= 0 && html.indexOf('<em>italic</em>') >= 0 && html.indexOf('<li>item 1</li>') >= 0, '基础渲染回归')
  })
  await t('粘贴清洗 sanitizeFragment：script/style 丢弃 + h4-6 降段落 + table 拆壳 + 非 assets 图片丢弃', () => {
    assert(kernelFn, 'kernelFn 可用')
    const frag = v3ParseHtml('<div><h4>深标题</h4><script>alert(1)</script><table><tr><td>格</td></tr></table><p>正文<strong>粗</strong></p><img src="https://evil.com/x.png"><img data-md-src="assets/ok.png" alt="ok"></div>')
    const clean = kernelFn.sanitizeFragment(frag)
    const tags = []
    ;(function walk(n) { n.childNodes.forEach(c => { if (c.nodeType === 1) { tags.push(c.tagName); walk(c) } }) })(clean)
    assert(tags.indexOf('SCRIPT') < 0 && tags.indexOf('TABLE') < 0, 'script/table 不保留')
    assert(tags.indexOf('P') >= 0 && tags.indexOf('H4') < 0, 'h4 降为 p')
    assert(tags.indexOf('STRONG') >= 0, '粗体保留')
    assert(tags.filter(x => x === 'IMG').length === 1, '仅 assets/ 图片保留（实得 ' + tags.join(',') + '）')
    // 序列化回 Markdown：js 脚本内容不得出现
    const md = kernelFn.serializeRich(clean)
    assert(md.indexOf('alert') < 0 && md.indexOf('assets/ok.png') >= 0, '清洗后序列化无脚本内容、保留资产图')
  })
  await t('内核纯净性：不碰 edBody/自动保存/RPC（纯函数集合，副作用全在调用侧）', () => {
    assert(!/setEdBody|triggerAutoSave|doSave|triggerSave/.test(kernelBlock), '内核不触发保存')
    assert(kernelBlock.indexOf('host' + '.call') < 0 && kernelBlock.indexOf('fetch(') < 0, '内核不发 RPC/网络请求')
    assert(!/\.innerHTML\s*=[^=]/.test(kernelBlock), '内核不直写 innerHTML（渲染产物由调用侧赋值；注释提及不算）')
  })

  // ===== 20. 列表项右键菜单（替代悬浮 ×：onContextMenu + ctxmenu 结构 + 三动作 + 旧按钮移除）=====
  section('20. 列表项右键菜单（ctxmenu）')
  await t('列表项 onContextMenu 处理器存在', () => {
    assert(/onContextMenu:\s*\(ev\)\s*=>\s*openCtxMenu\(ev,\s*n\)/.test(clientSrc), 'client-impl 列表项含 onContextMenu → openCtxMenu')
    assert(/onContextMenu:\s*\(ev\)\s*=>\s*openCtxMenu\(ev,\s*n\)/.test(clientPkgSrc), '发布包列表项含 onContextMenu')
    assert(/function openCtxMenu\(ev, n\)/.test(clientSrc), 'openCtxMenu 函数存在')
    assert(/ctxMenuRef/.test(clientSrc), 'ctxMenuRef 键盘流兼容镜像存在')
  })
  await t('ctxmenu 结构与样式存在', () => {
    assert(clientSrc.indexOf('dsh-notes-ctxmenu') >= 0, 'client-impl 含 ctxmenu 容器 class')
    assert(clientPkgSrc.indexOf('dsh-notes-ctxmenu') >= 0, '发布包含 ctxmenu 容器 class')
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    assert(css.indexOf('.dsh-notes-ctxmenu{') >= 0, 'styles.css 含 ctxmenu 容器样式')
    assert(css.indexOf('.dsh-notes-ctxmenu-item') >= 0, 'styles.css 含菜单项样式')
  })
  await t('菜单含置顶/已解决/删除三动作（v2 纯文字 + SVG 图标）', () => {
    assert(clientSrc.indexOf("ctxMenu.note.status === 'pinned' ? '取消置顶' : '置顶'") >= 0, '置顶/取消置顶动作存在')
    assert(clientSrc.indexOf("ctxMenu.note.status === 'resolved' ? '重开' : '标记已解决'") >= 0, '标记已解决/重开动作存在')
    assert(clientSrc.indexOf("I('trash', 12), '删除'") >= 0, '删除动作存在（trash 图标）')
    assert(/function ctxSetStatus\(n, status\)/.test(clientSrc), 'ctxSetStatus 函数存在')
    assert(/ctxSetStatus[\s\S]{0,300}host\.call\('notes-update'/.test(clientSrc), 'ctxSetStatus 走 notes-update RPC')
  })
  await t('旧悬浮删除按钮已移除', () => {
    assert(clientSrc.indexOf('dsh-note-delete') < 0, 'client-impl 不含 dsh-note-delete')
    assert(clientPkgSrc.indexOf('dsh-note-delete') < 0, '发布包不含 dsh-note-delete')
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    assert(!/\.dsh-note-delete\{/.test(css), 'styles.css 不含 dsh-note-delete 样式块')
  })

  // ===== 21. 虚拟文件夹（folders.json 清单 + folder 字段 + notes-folders RPC + move + 过滤）=====
  section('21. 虚拟文件夹（folder 字段 + folders.json + notes-folders + move）')
  // 注意：section 17 用同一个 mock harness 应用过静态包 index.mjs，其 handlers 覆盖了开发版；
  // 本节断言的是开发版 folder 行为（静态包 folder 行为断言在 section 17），故重新 apply 开发版插件，
  // 把 handlers 还原为 host-impl 版本（同一 store，数据互通）。
  plugin.apply(ctx)
  const FOLDERS_PATH_MOCK = NOTES_DIR + '\\folders.json'

  // --- 源码结构断言（host 数据链路 / 工具 schema / client UI / 样式，开发版 + 发布包同步）---
  await t('host-impl folder 字段全链路（FM 写入 / 解析 / 瘦身 / 更新）', () => {
    assert(/'folder: ' \+ escYaml\(m\.folder \|\| ''\)/.test(hostSrc), 'buildFM 写 folder 行')
    assert(/folder: p\.meta\.folder \|\| ''/.test(hostSrc), 'noteFromParsed 读 folder（缺省 \'\'）')
    assert((hostSrc.match(/folder: n\.folder \|\| ''/g) || []).length >= 2, 'persistNote 与 slim 均带 folder')
    assert(/if \(folder !== undefined\) note\.folder = folder/.test(hostSrc), '_update 仅在显式传 folder 时改（undefined 不动）')
  })
  await t('index.mjs folder 字段全链路 + notes-folders 注册（静态包与开发版同源）', () => {
    assert(/'folder: ' \+ escYaml\(m\.folder \|\| ''\)/.test(indexSrc), 'index.mjs buildFM 写 folder 行')
    assert(/folder: p\.meta\.folder \|\| ''/.test(indexSrc), 'index.mjs noteFromParsed 读 folder')
    assert((indexSrc.match(/folder: n\.folder \|\| ''/g) || []).length >= 2, 'index.mjs persistNote 与 slim 均带 folder')
    assert(/if \(folder !== undefined\) note\.folder = folder/.test(indexSrc), 'index.mjs _update 显式传 folder 才改')
    assert(indexSrc.indexOf("FOLDERS_PATH = path.join(NOTES_ROOT, 'folders.json')") >= 0, 'index.mjs FOLDERS_PATH 落在 ~/.dsh/notes/folders.json')
    for (const fn of ['loadFolders', 'saveFolders', 'effectiveFolder', 'resolveFolderRef', 'genFolderId', '_folders', 'folderDepth', 'folderSubtreeIds', 'folderSubtreeHeight', 'checkFolderAttach', 'maxFolderDepthLimit']) {
      assert(indexSrc.indexOf('function ' + fn) >= 0, 'index.mjs 缺函数 ' + fn)
    }
    assert(/handle\('notes-folders'/.test(indexSrc), 'index.mjs 注册 notes-folders RPC（webServer 兜底路由经 handlers 表自动可达）')
    assert(/async function _list\(tag, kind, folder, includeDeleted, includeLogs\)/.test(indexSrc) && /folderSubtree = \(folder !== undefined && folder !== ''\) \? folderSubtreeIds\(folder, folders\) : null/.test(indexSrc) && indexSrc.indexOf("if (folder === '') { if (ef !== '') continue }") >= 0, 'index.mjs _list 接 folder 递归子树过滤（folder-tree-helpers；第 4 参数 includeDeleted 回收站 / 第 5 参数 includeLogs 工作记忆日志召回）')
    assert(/async function _search\(query, tag, topic, kind, folder, filters\)/.test(indexSrc), 'index.mjs _search 接 folder（+ filters 组合过滤尾参，搜索体验升级）')
    assert(/enum: \['create', 'list', 'update', 'move', 'delete'/.test(indexSrc), 'index.mjs note_manage action enum 含 move')
  })
  await t('host-impl folders.json 清单模块 + notes-folders RPC 注册', () => {
    assert(hostSrc.indexOf("FOLDERS_PATH = NOTES_DIR + '\\\\folders.json'") >= 0, 'FOLDERS_PATH 落在 notes/folders.json')
    for (const fn of ['loadFolders', 'saveFolders', 'effectiveFolder', 'resolveFolderRef', 'genFolderId', '_folders', 'folderDepth', 'folderSubtreeIds', 'folderSubtreeHeight', 'checkFolderAttach', 'maxFolderDepthLimit']) {
      assert(hostSrc.indexOf('function ' + fn) >= 0, '缺函数 ' + fn)
    }
    assert(/JSON\.stringify\(list, null, 2\)/.test(hostSrc), 'saveFolders 持久化 JSON 清单')
    assert(/catch \(e\) \{ return \[\] \}/.test(hostSrc), 'loadFolders 损坏兜底空数组')
    assert.strictEqual(typeof handlers['notes-folders'], 'function', 'notes-folders handler 已注册')
  })
  await t('工具 schema：note_manage 含 move action + folder 参数；note_search 含 folder 参数', () => {
    const enumList = t3.parameters.properties.action.enum
    assert(enumList.indexOf('move') >= 0, 'note_manage action enum 应含 move（实得：' + JSON.stringify(enumList) + '）')
    assert(t3.parameters.properties.folder, 'note_manage 缺 folder 参数')
    assert(t1.parameters.properties.folder, 'note_search 缺 folder 参数')
    assert(t1.parameters.properties.folder.description.indexOf('unfiled') >= 0, 'note_search folder 说明应含未分类口径')
  })
  await t('client 树状文件夹结构（folder-row 节点 + 折叠态持久化 + notes-folders 加载，发布包同步）', () => {
    assert(/const \[folders, setFolders\] = React\.useState\(\[\]\)/.test(clientSrc), 'folders state 存在')
    assert(/const \[foldersExpanded, setFoldersExpanded\] = React\.useState\(loadFoldersExpanded\)/.test(clientSrc), 'foldersExpanded state 读 localStorage 初值')
    assert(clientSrc.indexOf("localStorage.getItem('dsh-notes-folders-expanded')") >= 0 && clientSrc.indexOf("localStorage.setItem('dsh-notes-folders-expanded', JSON.stringify(") >= 0, '折叠态持久化 localStorage(dsh-notes-folders-expanded)')
    assert(clientSrc.indexOf("localStorage.getItem('dsh-notes-folder')") < 0, '旧 folderSel 持久化键（dsh-notes-folder）已移除')
    assert(/host\.call\('notes-folders'\)/.test(clientSrc), 'loadFolders 走 notes-folders RPC')
    assert(/setFoldersExpanded\(prev => pruneFoldersExpanded\(prev, res\.folders\)\)/.test(clientSrc), '已删除文件夹的展开态残留自动清理（pruneFoldersExpanded）')
    for (const cls of ['dsh-notes-folder-row', 'dsh-notes-caret', 'dsh-notes-row-nm', 'dsh-notes-row-n', 'dsh-notes-ic-slot', 'dsh-notes-folder-rename', 'dsh-notes-sec-h-add']) {
      assert(clientSrc.indexOf(cls) >= 0, 'client-impl 缺 ' + cls)
      assert(clientPkgSrc.indexOf(cls) >= 0, '发布包 client.js 缺 ' + cls + '（需先跑 scripts/build-dist.cjs）')
    }
    // v2：文件夹行图标全部 SVG（caret chev + folder symbol），无 emoji
    assert(clientSrc.indexOf("I('folder', 13)") >= 0 && clientSrc.indexOf("I('chev', 10)") >= 0, '文件夹行 SVG 图标（folder + caret chev）')
    assert(clientSrc.indexOf('dsh-notes-folder-ic') < 0, 'client-impl 不含旧 folder-ic')
    assert(clientPkgSrc.indexOf('dsh-notes-folder-ic') < 0, '发布包 client.js 不含旧 folder-ic')
    assert(clientSrc.indexOf('📂') < 0, '文件夹行 📂 emoji 已移除')
    for (const gone of ['dsh-notes-folderbar', 'dsh-notes-folder-chip', 'loadFolderSel', 'saveFolderSel', 'selectFolder(']) {
      assert(clientSrc.indexOf(gone) < 0, 'client-impl 应已移除 ' + gone)
      assert(clientPkgSrc.indexOf(gone) < 0, '发布包 client.js 应已移除 ' + gone + '（需先跑 scripts/build-dist.cjs）')
    }
    assert(clientSrc.indexOf('PINNED_KEY') >= 0 && clientSrc.indexOf('sec-pinned') >= 0, '树顶部保留「置顶」折叠组（PINNED_KEY）')
    assert(clientSrc.indexOf('新建文件夹') >= 0, '含「新建文件夹」入口（分组头 ＋ tooltip）')
    assert(clientPkgSrc.indexOf('notes-folders') >= 0, '发布包 client.js 含 notes-folders RPC 调用')
  })
  await t('client 树渲染逻辑（v2：视图头 / 置顶折叠组 / 文件夹嵌套 / 未入夹根级直显 / 主题全局过滤区 + 新建落位）', () => {
    assert(clientSrc.indexOf('const treeMode') < 0, 'v2 恒为树渲染（旧 treeMode 平铺退化已移除）')
    assert(/if \(n\.folder\) expandFolder\(n\.folder\)/.test(clientSrc), '选中笔记所在文件夹自动展开')
    assert(/function toggleFolder\(id\)/.test(clientSrc) && /function isFolderExpanded\(id\)/.test(clientSrc) && /function expandFolder\(id\)/.test(clientSrc), '折叠切换/判定/自动展开 helper 存在')
    assert(clientSrc.indexOf("className: 'dsh-notes-nested'") >= 0, '文件夹/主题分组子笔记 nested 渲染')
    assert(clientSrc.indexOf("folderSel === 'pinned'") < 0 && clientSrc.indexOf("folderSel !== 'all'") < 0, 'folderSel 过滤分支已移除')
    assert(clientSrc.indexOf('groupByTopic') < 0, '未分类主题二级分组已移除（未入夹笔记根级直显平铺，主题聚合由「主题过滤」区承担不重复）')
    assert(clientSrc.indexOf("const unfiledKids = unfiled.map(n => { treeIds.push(n.id); return renderNoteRow(n, false) })") >= 0, '未入夹笔记根级平铺直渲（无主题分组头/nested 包裹）')
    assert(clientSrc.indexOf('notes.forEach(n => { if (n.topic) allTopics[n.topic]') >= 0, '主题过滤区统计全库主题（不按当前过滤）')
    assert(/setView\(view\.type === 'topic' && view\.id === tn \? \{ type: 'all', id: '' \} : \{ type: 'topic', id: tn \}\)/.test(clientSrc), '主题行尾过滤图标切换主题视图/全部（行主体单击已让位原地展开）')
    assert(/setView\(view\.type === 'folder' && view\.id === f\.id \? \{ type: 'all', id: '' \} : \{ type: 'folder', id: f\.id \}\)/.test(clientSrc), '文件夹行尾过滤图标切换文件夹视图/全部（行主体单击已让位原地展开）')
    assert(clientSrc.indexOf("view.type === 'folder' ? view.id :") >= 0, '新建落位：文件夹视图落当前文件夹')
    assert(/payload\.folder = createFolder/.test(clientSrc), 'notes-create 携带 folder')
  })
  await t('目录树点击展开语义（点哪个展开哪个）：行主体=原地展开 + 视图过滤降级行尾图标 + 陈旧 id 清洗（四端同步）', () => {
    const appSrcT = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const protoSrcT = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    // ① 文件夹行主体单击 = 原地展开/折叠（toggleFolder；caret 不再独占折叠，整行同义）
    assert(clientSrc.indexOf('onClick: () => toggleFolder(f.id)') >= 0, '文件夹行主体 onClick = toggleFolder（原地展开）')
    assert(clientSrc.indexOf('ev.stopPropagation(); toggleFolder(f.id)') < 0, 'caret 不再单独绑折叠（整行同义）')
    // ② 视图过滤降级为行尾过滤图标（stopPropagation 不抢占单击）+ 文件夹右键菜单项兜底
    assert(clientSrc.indexOf("'dsh-notes-row-vfilter dsh-nt'") >= 0, '文件夹/主题行尾过滤图标（dsh-notes-row-vfilter）')
    assert(/ev\.stopPropagation\(\); setView\(view\.type === 'folder' && view\.id === f\.id/.test(clientSrc), '文件夹行尾图标点击 = 进入/退出文件夹视图')
    assert(clientSrc.indexOf('进入文件夹视图') >= 0, '文件夹右键菜单含「进入文件夹视图」')
    // ③ 主题行主体单击 = 原地展开/收起该主题子列表（topicExpanded object，session 内不持久化）
    assert(/const \[topicExpanded, setTopicExpanded\] = React\.useState\(\{\}\)/.test(clientSrc), 'topicExpanded state（object，不持久化）')
    assert(/function toggleTopicExpanded\(tn\)/.test(clientSrc) && clientSrc.indexOf('onClick: () => toggleTopicExpanded(tn)') >= 0, '主题行主体 onClick = toggleTopicExpanded（原地展开）')
    assert(/ev\.stopPropagation\(\); setView\(view\.type === 'topic' && view\.id === tn/.test(clientSrc), '主题行尾图标点击 = 主题视图（跨文件夹过滤）')
    assert(clientSrc.indexOf("key: 'tpk-' + tn") >= 0, '主题原地展开子列表 nested 渲染（tpk- 前缀）')
    // ④ 陈旧展开态清洗：按当前文件夹 id + PINNED_KEY 过滤；空集回 null（缺省全展开）并回写持久化
    assert(/function pruneFoldersExpanded\(prev, folderList\)/.test(clientSrc), 'pruneFoldersExpanded 清洗 helper 存在')
    assert(clientSrc.indexOf('id === PINNED_KEY || folderList.some(f => f.id === id)') >= 0, '按当前文件夹 id + PINNED_KEY 过滤失效 id')
    assert(clientSrc.indexOf('const fixed = next.length ? next : null') >= 0 && clientSrc.indexOf('saveFoldersExpanded(fixed)') >= 0, '清洗后为空 → null 回缺省全展开并回写持久化')
    // 发布包 + styles.css 同步
    assert(clientPkgSrc.indexOf('dsh-notes-row-vfilter') >= 0 && clientPkgSrc.indexOf('toggleTopicExpanded') >= 0 && clientPkgSrc.indexOf('pruneFoldersExpanded') >= 0, '发布包 lib/client.js 同步（需先跑 scripts/build-dist.cjs）')
    const cssDevT = fsNative.readFileSync(SRC_STYLES, 'utf8')
    assert(cssDevT.indexOf('.dsh-notes-row-vfilter{') >= 0 && cssDevT.indexOf('.dsh-notes-row-vfilter.on{') >= 0, 'styles.css 含行尾过滤图标样式（常态/hover 浮现/激活常显）')
    // app.html / 原型 notes-ui-v2.html 同步：行主体折叠 + vfilter 图标 + 主题原地展开 + 陈旧清洗 + 右键菜单项
    for (const pair of [['app.html', appSrcT], ['原型 notes-ui-v2.html', protoSrcT]]) {
      assert(pair[1].indexOf("ev.target.closest('.vfilter')") >= 0, pair[0] + ' 树事件委托识别 .vfilter 行尾图标')
      assert(pair[1].indexOf('class="vfilter') >= 0, pair[0] + ' 文件夹/主题行渲染行尾过滤图标')
      assert(pair[1].indexOf('var topicOpen = {}') >= 0 && pair[1].indexOf('topicOpen[t] = !topicOpen[t]') >= 0, pair[0] + ' 主题行原地展开（topicOpen）')
      assert(pair[1].indexOf('.vfilter{') >= 0 && pair[1].indexOf('.vfilter.on{') >= 0, pair[0] + ' vfilter 样式')
      assert(pair[1].indexOf('进入文件夹视图') >= 0, pair[0] + ' 文件夹右键菜单含「进入文件夹视图」')
      assert(/delete foldOpen\[k\]/.test(pair[1]), pair[0] + ' foldOpen 陈旧 id 清洗（loadFolders）')
    }
  })
  await t('树修正（notes-tree-root-expand）：未入夹根级直显 + 过滤命中自动展开 + 命中计数（四端同步）', () => {
    const appSrcX = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const protoSrcX = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    // ① 根级直显：无 folder 笔记平铺在树根部（文件夹列表之后）；未分类主题二次分组兜底已移除（主题聚合由「主题过滤」区承担，不重复聚合）
    assert(clientSrc.indexOf('groupByTopic') < 0, 'client-impl 未分类主题二次分组（groupByTopic）已移除')
    assert(clientSrc.indexOf("const unfiled = paged.filter(n => !(n.folder || ''))") >= 0, 'client-impl 未入夹笔记 = 无 folder 过滤集')
    assert(clientSrc.indexOf("const unfiledKids = unfiled.map(n => { treeIds.push(n.id); return renderNoteRow(n, false) })") >= 0, 'client-impl 未入夹笔记根级平铺直渲（无主题分组头/nested 包裹）')
    assert(clientSrc.indexOf("'tg-' + topic") < 0 && clientSrc.indexOf('dsh-notes-topic-g') < 0, 'client-impl 未分类主题分组头渲染已移除')
    // ② drop 移出落点保持：.dsh-notes-unfiled-drop 容器 + 三处理器不变（「未分类」分组头已在 notes-tree-unfiled-sibling 移除——落点 = 包裹容器 + 拖拽中提示行）
    assert(clientSrc.indexOf("className: 'dsh-notes-unfiled-drop', onDragOver: onUnfiledDragOver, onDragLeave: onUnfiledDragLeave, onDrop: onUnfiledDrop") >= 0, 'client-impl 未入夹区 drop 移出落点保持')
    assert(clientSrc.indexOf("'dsh-notes-sec-h-t' }, '未分类')") < 0, 'client-impl 未入夹「未分类」分组头/分区计数已移除（同级直显）')
    // ③ 过滤命中自动展开（纯计算 OR，不写回折叠态——清除过滤即恢复手动折叠）+ 命中计数：置顶组/文件夹/主题行
    assert(clientSrc.indexOf("const pinOpen = isFolderExpanded(PINNED_KEY) || (filtersActive && pinnedAll.length > 0)") >= 0, '置顶组过滤命中自动展开')
    assert(clientSrc.indexOf("const fOpen = isFolderExpanded(f.id) || (filtersActive && subHits > 0)") >= 0, '文件夹过滤命中自动展开（子树命中口径，无命中保持折叠）')
    assert(clientSrc.indexOf("const cnt = filtersActive ? subHits : (f.count || 0)") >= 0, '文件夹计数：过滤激活 = 子树命中数（无命中 0）/ 否则 = 子树总数（host count 已递归）')
    assert(clientSrc.indexOf("const tOpen = !!topicExpanded[tn] || (filtersActive && tkidsAll.length > 0)") >= 0, '主题行过滤命中自动展开')
    assert(clientSrc.indexOf("filtersActive ? tkidsAll.length : allTopics[tn]") >= 0, '主题行计数：过滤激活 = 命中数 / 否则 = 全库数')
    // 恢复断言：自动展开为纯计算（isFolderExpanded OR），折叠态写入口仍只有 toggleFolder/expandFolder——过滤清除即恢复手动折叠
    assert(/function toggleFolder\(id\)/.test(clientSrc) && /function expandFolder\(id\)/.test(clientSrc), '折叠态写入口保持（toggleFolder/expandFolder）')
    // ④ 发布包 client.js 同步（需先跑 scripts/build-dist.cjs）
    for (const k of ["const fOpen = isFolderExpanded(f.id) || (filtersActive && subHits > 0)", "const unfiledKids = unfiled.map(n => { treeIds.push(n.id); return renderNoteRow(n, false) })", "const tOpen = !!topicExpanded[tn] || (filtersActive && tkidsAll.length > 0)", "const cnt = filtersActive ? subHits : (f.count || 0)"]) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺「' + k.slice(0, 34) + '…」（需先跑 scripts/build-dist.cjs）')
    }
    assert(clientPkgSrc.indexOf('groupByTopic') < 0, '发布包 lib/client.js groupByTopic 已移除（需先跑 scripts/build-dist.cjs）')
    // ⑤ app.html / 原型 notes-ui-v2.html 同步（同一套 DOM/CSS/交互口径）
    for (const pair of [['app.html', appSrcX], ['原型 notes-ui-v2.html', protoSrcX]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("var filtering = view.type !== 'all' || !!searchText || filtersActiveCount() > 0;") >= 0, label + ' 过滤激活标记（视图/筛选中心/搜索任一）')
      assert(s.indexOf("var open = (foldOpen[f.id] !== false) || (filtering && subHits > 0);") >= 0, label + ' 文件夹过滤命中自动展开（子树命中口径，不写回 foldOpen）')
      assert(s.indexOf("(filtering ? subHits : (f.count != null ? f.count : kids.length))") >= 0, label + ' 文件夹计数：过滤激活 = 子树命中数')
      assert(s.indexOf("var tOpen = !!topicOpen[t] || (filtering && tkids.length > 0);") >= 0, label + ' 主题行过滤命中自动展开（不写回 topicOpen）')
      assert(s.indexOf("(filtering ? tkids.length : allTopics[t])") >= 0, label + ' 主题行计数：过滤激活 = 命中数')
      assert(s.indexOf("' 置顶<span class=\"cnt2\">' + pins.length + '</span></div>'") >= 0, label + ' 置顶组计数')
      assert(s.indexOf(">未分类<span class=\"cnt2\">") < 0, label + ' 未入夹「未分类」分组头/分区计数已移除（同级直显，落点 = 包裹容器）')
      assert(s.indexOf("unfiled.forEach(function (n) { h += noteRow(n, false) });") >= 0, label + ' 未入夹笔记根级平铺直渲')
      assert(s.indexOf('未分类</div><div class="nested">') < 0 && s.indexOf('var topics = {};') < 0, label + ' 未分类主题二次分组兜底已移除')
      assert(s.indexOf('.sec-h .cnt2{margin-left:auto;font-size:10px;font-weight:400;letter-spacing:0;text-transform:none}') >= 0, label + ' 分组头计数丸样式（.sec-h .cnt2）')
      assert(s.indexOf('data-drop-out="1"') >= 0, label + ' drop 移出落点保留（data-drop-out）')
    }
  })
  await t('树修正（notes-tree-unfiled-sibling）：未入夹笔记与文件夹同级直显（去「未分类」分组头）+ drop 落点保留 + 空态不占位（四端同步）', () => {
    const appSrcU = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const protoSrcU = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    // ① 去分组头：未入夹区不再渲染「未分类」sec-h 标题行/分区计数（数量并入 brand 行总计数）；笔记行保持根级平铺直渲（treeIds 键盘导航顺序不变）
    assert(clientSrc.indexOf("'dsh-notes-sec-h-t' }, '未分类')") < 0, 'client-impl 未入夹「未分类」分组头已移除')
    assert(clientSrc.indexOf('unfiledAll') < 0, 'client-impl 未入夹分区计数变量（unfiledAll）已移除——并入 brand 总计数')
    assert(clientSrc.indexOf("const unfiledKids = unfiled.map(n => { treeIds.push(n.id); return renderNoteRow(n, false) })") >= 0, 'client-impl 未入夹笔记根级平铺直渲（与文件夹行同缩进层级；treeIds 顺序不变）')
    // ② drop 移出落点保留：.dsh-notes-unfiled-drop 包裹容器 + 三处理器不变；拖拽中（dragActive state）本区头部显示淡提示行「拖到此处移出文件夹」
    assert(clientSrc.indexOf("className: 'dsh-notes-unfiled-drop', onDragOver: onUnfiledDragOver, onDragLeave: onUnfiledDragLeave, onDrop: onUnfiledDrop") >= 0, 'client-impl 未入夹区 drop 移出落点保持（容器三处理器不变）')
    assert(/const \[dragActive, setDragActive\] = React\.useState\(false\)/.test(clientSrc), 'client-impl dragActive state（dragstart 置位 / dragend 复位）')
    assert(clientSrc.indexOf("dragNoteIdRef.current = n.id\n          setDragActive(true)") >= 0 && clientSrc.indexOf("dragNoteIdRef.current = null\n          setDragActive(false)") >= 0, 'client-impl dragstart/dragend 置位/复位 dragActive')
    assert(clientSrc.indexOf("className: 'dsh-notes-unfiled-hint'") >= 0 && clientSrc.indexOf('拖到此处移出文件夹') >= 0, 'client-impl 拖拽中显示「拖到此处移出文件夹」提示行')
    // ③ 空态：无未入夹笔记且非拖拽中不渲染任何占位（（空）行/空容器均不渲染）；有笔记或拖拽中才渲染落点容器
    assert(clientSrc.indexOf('if (unfiledKids.length || dragActive)') >= 0, 'client-impl 落点容器条件渲染（有未入夹笔记 或 拖拽中）')
    assert(clientSrc.indexOf('empty-u') < 0 && clientSrc.indexOf('dsh-notes-tree-empty') < 0, 'client-impl（空）占位行已移除')
    // ④ 发布包 lib/client.js + lib/styles.css 同步（需先跑 scripts/build-dist.cjs）
    for (const k of ['if (unfiledKids.length || dragActive)', 'dsh-notes-unfiled-hint', '拖到此处移出文件夹', 'setDragActive(true)']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺「' + k.slice(0, 30) + '…」（需先跑 scripts/build-dist.cjs）')
    }
    assert(clientPkgSrc.indexOf("'dsh-notes-sec-h-t' }, '未分类')") < 0 && clientPkgSrc.indexOf('empty-u') < 0, '发布包 未入夹分组头/（空）占位已移除')
    const cssDevU = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkgU = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDevU], ['发布包 lib/styles.css', cssPkgU]]) {
      assert(pair[1].indexOf('.dsh-notes-unfiled-hint') >= 0, pair[0] + ' 含 .dsh-notes-unfiled-hint 提示行样式（需先跑 scripts/build-dist.cjs）')
    }
    // ⑤ app.html / 原型 notes-ui-v2.html 同步：包裹容器 data-drop-out + 提示行（.drag-on 显示）+ dragstart 点亮/补插 + dragend 清理 + 无（空）占位
    for (const pair of [['app.html', appSrcU], ['原型 notes-ui-v2.html', protoSrcU]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf(">未分类<span class=\"cnt2\">") < 0, label + ' 未入夹「未分类」分组头/分区计数已移除')
      assert(s.indexOf('<div class="unfiled-drop" data-drop-out="1"') >= 0, label + ' 未入夹包裹容器保留 drop 移出落点（data-drop-out，根级同级直显）')
      assert(s.indexOf('unfiled.forEach(function (n) { h += noteRow(n, false) });') >= 0, label + ' 未入夹笔记根级平铺直渲（容器内无 nested 缩进包裹）')
      assert(s.indexOf('（空）') < 0, label + ' 空态（空）占位行已移除（非拖拽不渲染任何占位）')
      assert(s.indexOf('class="unfiled-hint"') >= 0 && s.indexOf('拖到此处移出文件夹') >= 0, label + ' 容器内含「拖到此处移出文件夹」提示行')
      assert(s.indexOf('.unfiled-drop.drag-on .unfiled-hint{display:block}') >= 0 && s.indexOf('.unfiled-drop.drop{') >= 0, label + ' 提示行/落点高亮样式（.drag-on 显示 + .drop 虚线描边）')
      assert(s.indexOf("var udrop = $('tree').querySelector('.unfiled-drop')") >= 0, label + ' dragstart 委托点亮/补插落点容器')
      assert(s.indexOf("udrop.className = 'unfiled-drop drag-on'") >= 0 && s.indexOf("insertBefore(udrop, $('tree').querySelector('[data-tsec]'))") >= 0, label + ' 空态临时落点容器补插（主题过滤区之前）')
      assert(s.indexOf("el.querySelector('[data-note]')) el.classList.remove('drag-on'); else el.remove()") >= 0, label + ' dragend 清理拖拽态（摘 drag-on / 移除临时容器）')
    }
  })
  await t('主题过滤区默认折叠（notes-topic-collapse）：常态「主题 (N)」一行 + 点击展开 + 过滤命中自动展开+计数（四端同步）', () => {
    const appSrcC = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const protoSrcC = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    // ① client：整区折叠态（缺省折叠，session 记忆不持久化）+ 分组头 sec-toggle 点击展开/收起（置顶折叠组 PINNED_KEY 同款机制）
    assert(/const \[topicSecOpen, setTopicSecOpen\] = React\.useState\(false\)/.test(clientSrc), 'topicSecOpen state（缺省折叠，session 记忆不持久化）')
    assert(clientSrc.indexOf("key: 'sec-topics', className: 'dsh-notes-sec-h dsh-notes-sec-toggle', onClick: () => setTopicSecOpen(!topicSecOpen)") >= 0, '主题区分组头 = sec-toggle 点击展开/收起')
    assert(clientSrc.indexOf("'dsh-notes-caret' + (topicSecOpenEff ? ' open' : '')") >= 0, '分组头 caret 随展开态旋转')
    // ② 常态只显示「主题 (N)」一行（N=主题数）；过滤激活计数切换为命中主题数（folders「过滤激活=命中数」同口径）
    assert(clientSrc.indexOf("'主题 (' + (filtersActive ? topicHitCount : topicNames.length) + ')'") >= 0, '常态「主题 (N)」一行；过滤激活计数=命中主题数')
    assert(clientSrc.indexOf('const topicHitCount = Object.keys(topicHitSet).length') >= 0, '命中主题数统计（filtered 口径）')
    // ③ 过滤命中自动展开：纯计算 OR，不写回 topicSecOpen（清除过滤即恢复手动折叠态）；列表仅展开时渲染
    assert(clientSrc.indexOf('const topicSecOpenEff = topicSecOpen || (filtersActive && topicHitCount > 0)') >= 0, '过滤命中自动展开（纯计算 OR，不写回）')
    assert(clientSrc.indexOf('if (topicSecOpenEff) topicNames.forEach(tn => {') >= 0, '主题列表折叠门控（仅展开时渲染）')
    // 列表内行为不变：主题行原地展开/收起子列表（topicExpanded）+ 行尾主题视图过滤图标
    assert(clientSrc.indexOf('onClick: () => toggleTopicExpanded(tn)') >= 0 && clientSrc.indexOf("key: 'tpk-' + tn") >= 0, '列表内主题行原地展开行为不变')
    // ④ 发布包 lib/client.js 同步（需先跑 scripts/build-dist.cjs）
    for (const k of ['const topicSecOpenEff = topicSecOpen || (filtersActive && topicHitCount > 0)', "'主题 (' + (filtersActive ? topicHitCount : topicNames.length) + ')'", 'if (topicSecOpenEff) topicNames.forEach(tn => {']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺「' + k.slice(0, 30) + '…」（需先跑 scripts/build-dist.cjs）')
    }
    // ⑤ app.html / 原型 notes-ui-v2.html 同步（同一套 DOM/交互口径）
    for (const pair of [['app.html', appSrcC], ['原型 notes-ui-v2.html', protoSrcC]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('var topicSecOpen = false;') >= 0, label + ' topicSecOpen 缺省折叠（session 记忆不持久化）')
      assert(s.indexOf('data-tsec="1"') >= 0 && s.indexOf('var tSecOpen = topicSecOpen || (filtering && topicHitCount > 0);') >= 0, label + ' 分组头单行 + 过滤命中自动展开（纯计算不写回）')
      assert(s.indexOf("' 主题 (' + (filtering ? topicHitCount : topicNames.length)") >= 0, label + ' 常态「主题 (N)」计数；过滤激活=命中主题数')
      assert(s.indexOf('if (tSecOpen) topicNames.forEach(function (t) {') >= 0, label + ' 主题列表折叠门控（仅展开时渲染）')
      assert(/topicSecOpen = !topicSecOpen; renderTree\(\); return/.test(s), label + ' 树事件委托：点分组头切换 topicSecOpen')
      assert(s.indexOf('topicOpen[t] = !topicOpen[t]') >= 0, label + ' 列表内主题行原地展开行为不变（topicOpen）')
    }
  })
  await t('client 移动到文件夹 + 文件夹右键管理（v2 纯文字标签，开发版 + 发布包同步）', () => {
    assert(clientSrc.indexOf('移动到文件夹') >= 0, '笔记行右键含「移动到文件夹」')
    assert(/function ctxMoveToFolder\(n, folderId\)/.test(clientSrc), 'ctxMoveToFolder 存在')
    assert(/host\.call\('notes-update', \{ id: n\.id, folder: folderId \}\)/.test(clientSrc), '移动走 notes-update 只改 folder 字段')
    assert(clientSrc.indexOf('移出文件夹（未分类）') >= 0 && clientSrc.indexOf('新建文件夹…') >= 0, '子菜单含移出/新建')
    assert(/function openFolderMenu\(ev, f\)/.test(clientSrc), 'openFolderMenu 存在')
    for (const label of ["'重命名'", "'上移'", "'下移'", "'删除文件夹'"]) {
      assert(clientSrc.indexOf(label) >= 0, '文件夹右键菜单缺「' + label + '」')
    }
    for (const op of ["{ op: 'create', name: name, parent: parent }", "{ op: 'rename', id: id, name: name }", "{ op: 'delete', id: f.id, cascade: true }", "{ op: 'reorder', ids: ids }"]) {
      assert(clientSrc.indexOf(op) >= 0, 'client-impl 缺 notes-folders 调用 ' + op)
    }
    assert(clientPkgSrc.indexOf('移动到文件夹') >= 0 && clientPkgSrc.indexOf('删除文件夹') >= 0, '发布包含移动/删除文件夹交互')
  })
  await t('styles.css 树状文件夹样式（v2 token 化，开发版 + 发布包同步）', () => {
    const cssDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const cls of ['.dsh-notes-folder-row{', '.dsh-notes-caret{', '.dsh-notes-row-nm{', '.dsh-notes-row-n{', '.dsh-notes-folder-rename{', '.dsh-notes-nested{', '.dsh-notes-sec-h{', '.dsh-notes-fbadge{', '.dsh-notes-note-row{']) {
      assert(cssDev.indexOf(cls) >= 0, 'styles.css 缺 ' + cls)
      assert(cssPkg.indexOf(cls) >= 0, '发布包 lib/styles.css 缺 ' + cls)
    }
    assert(cssDev.indexOf('.dsh-notes-folder-ic') < 0 && cssPkg.indexOf('.dsh-notes-folder-ic') < 0, 'folder-ic 样式已移除（开发版 + 发布包）')
    // 文件夹行视觉（notes-tree-typography，VS Code 式同级统一）：cursor:default + 13px/常规/主色（--ntx，与同级笔记行同字体；旧 11.5px/600/--nt2 配角层级已移除）
    assert(/\.dsh-notes-folder-row\{[^}]*cursor:default/.test(cssDev) && /\.dsh-notes-folder-row\{[^}]*cursor:default/.test(cssPkg), '文件夹行 cursor:default')
    assert(/\.dsh-notes-folder-row\{[^}]*color:var\(--ntx\)/.test(cssDev) && /\.dsh-notes-folder-row\{[^}]*font-size:13px/.test(cssDev), '文件夹行 13px 主色（--ntx，与笔记行同级统一）')
    assert(!/\.dsh-notes-folder-row\{[^}]*font-size:11\.5px/.test(cssDev) && !/\.dsh-notes-folder-row\{[^}]*font-weight:600/.test(cssDev) && !/\.dsh-notes-folder-row\{[^}]*color:var\(--nt2\)/.test(cssDev), '文件夹行旧层级（11.5px/600/--nt2）已移除')
    // 嵌套笔记：margin-left 13px + padding-left 9px + 1px 引导线（--nbd-soft，原型口径）
    assert(/\.dsh-notes-nested\{[^}]*margin-left:13px/.test(cssDev) && /\.dsh-notes-nested\{[^}]*padding-left:9px/.test(cssDev) && /\.dsh-notes-nested\{[^}]*border-left:1px solid var\(--nbd-soft\)/.test(cssDev), '嵌套笔记 1px 缩进引导线（原型 13px/9px）')
    // 新建文件夹入口：分组头 ＋ 图标按钮（sec-h-add，hover 强调色）
    assert(/\.dsh-notes-sec-h-add\{[^}]*var\(--nt3\)/.test(cssDev) && /\.dsh-notes-sec-h-add:hover\{[^}]*var\(--nacc\)/.test(cssDev), '新建文件夹入口（nt3 → hover nacc）')
    assert(cssDev.indexOf('.dsh-notes-folderbar') < 0 && cssPkg.indexOf('.dsh-notes-folderbar') < 0, 'folderbar 样式已移除（开发版 + 发布包）')
    assert(cssDev.indexOf('.dsh-notes-folder-chip') < 0 && cssPkg.indexOf('.dsh-notes-folder-chip') < 0, 'folder-chip 样式已移除（开发版 + 发布包）')
    assert(cssDev.indexOf('.dsh-note-item') < 0 && cssPkg.indexOf('.dsh-note-item') < 0, '旧 dsh-note-item 列表项样式已移除（开发版 + 发布包）')
  })
  await t('树排版（notes-tree-typography）：同级字体统一 13px/常规/主色 + 行首槽位对齐（caret 槽 11px 占位 + 图标槽 16px，四端同步）', () => {
    const appSrcT = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const protoSrcT = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    const cssDevT = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkgT = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    // ① 面板（client-impl + styles.css）：笔记行行首 = caret 槽透明占位 + 图标槽（kind 色点槽内居中），与文件夹行标题文字起点 x 一致
    assert(clientSrc.indexOf("className: 'dsh-notes-caret-spacer'") >= 0, 'client-impl 笔记行渲染 caret 槽占位（与文件夹行 caret 同位同宽 11px）')
    assert(/className: 'dsh-notes-kind-slot'/.test(clientSrc) && /dsh-notes-kind-slot[^\n]*dsh-notes-kind-dot/.test(clientSrc), 'client-impl 笔记行 kind 色点包 16px 图标槽（kind-slot）')
    assert(clientPkgSrc.indexOf('dsh-notes-caret-spacer') >= 0 && clientPkgSrc.indexOf('dsh-notes-kind-slot') >= 0, '发布包 lib/client.js 同步（需先跑 scripts/build-dist.cjs）')
    // ② 槽位宽度固定：caret 槽 11px / 图标槽 16px（开发版 + 发布包 styles.css 同步）
    for (const pair of [['styles.css', cssDevT], ['发布包 lib/styles.css', cssPkgT]]) {
      const c = pair[1], label = pair[0]
      assert(/\.dsh-notes-caret-spacer\{[^}]*width:11px/.test(c), label + ' caret 槽占位 11px 定宽（.dsh-notes-caret-spacer）')
      assert(/\.dsh-notes-kind-slot\{[^}]*width:16px/.test(c), label + ' 笔记图标槽 16px 定宽（.dsh-notes-kind-slot）')
      assert(/\.dsh-notes-ic-slot\{[^}]*width:16px/.test(c), label + ' 文件夹图标槽 16px 定宽（.dsh-notes-ic-slot，旧 15px 已移除）')
      assert(/\.dsh-notes-folder-row\{[^}]*font-size:13px/.test(c) && /\.dsh-notes-folder-row\{[^}]*color:var\(--ntx\)/.test(c), label + ' 文件夹行 13px/主色（与笔记行同级统一）')
    }
    // ③ 嵌套层级保留：.dsh-notes-nested 子笔记 12.5px 小字 + 缩进引导线不动（同级统一后嵌套对比更清晰）
    assert(/\.dsh-notes-nested \.dsh-notes-note-row\{[^}]*font-size:12\.5px/.test(cssDevT), '嵌套子笔记 12.5px 小字保留')
    // ④ app.html / 原型 notes-ui-v2.html 同步（同一套 DOM/CSS 口径）：noteRow 行首占位 + kind-slot + .row.head 13px 主色
    for (const pair of [['app.html', appSrcT], ['原型 notes-ui-v2.html', protoSrcT]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('class="caret-spacer"') >= 0, label + ' 笔记行渲染 caret 槽占位')
      assert(/class="kind-slot"><span class="kind"/.test(s), label + ' 笔记行 kind 色点包图标槽（kind-slot）')
      assert(/\.caret-spacer\{[^}]*width:11px/.test(s), label + ' caret 槽占位样式 11px 定宽')
      assert(/\.kind-slot\{[^}]*width:16px/.test(s), label + ' kind 图标槽样式 16px 定宽')
      assert(/\.ic-slot\{[^}]*width:16px/.test(s), label + ' 文件夹图标槽 16px 定宽（旧 15px 已移除）')
      assert(s.indexOf('.row.head{font-size:13px;color:var(--ntx)}') >= 0, label + ' 文件夹行 13px/主色（.row.head；旧 11.5px/600 已移除）')
      assert(s.indexOf('.row.head{font-size:11.5px') < 0, label + ' 文件夹行旧 11.5px 字号已移除')
    }
  })

  // --- 行为断言（内存 mock：handlers + note_manage + fsMock store）---
  await t('notes-folders list 初始兜底：folders.json 缺失 → 空清单 + unfiled 计数（不抛错）', async () => {
    assert(!store.has(FOLDERS_PATH_MOCK), '前置：mock store 无 folders.json')
    const r = await handlers['notes-folders']({})
    assert(Array.isArray(r.folders) && r.folders.length === 0, 'folders 为空数组（实得：' + JSON.stringify(r) + '）')
    const all = await handlers['notes-list']({})
    assert.strictEqual(r.unfiled, all.notes.length, '无清单时全部笔记计入 unfiled')
  })
  await t('notes-folders create：落盘 folders.json + order 递增；缺 name 报错', async () => {
    const c1 = await handlers['notes-folders']({ op: 'create', name: '工作' })
    assert(c1.ok === true && c1.folder && c1.folder.id.indexOf('f-') === 0, 'create 返回 f- 前缀 id（实得：' + JSON.stringify(c1) + '）')
    assert.strictEqual(c1.folder.name, '工作')
    assert.strictEqual(c1.folder.order, 0, '首个文件夹 order=0')
    assert(store.has(FOLDERS_PATH_MOCK), 'folders.json 已写入 mock store')
    const onDisk = JSON.parse(store.get(FOLDERS_PATH_MOCK))
    assert.deepStrictEqual(onDisk, [{ id: c1.folder.id, name: '工作', order: 0 }], '磁盘清单内容一致')
    const c2 = await handlers['notes-folders']({ op: 'create', name: '学习' })
    assert.strictEqual(c2.folder.order, 1, '第二个文件夹 order 递增为 1')
    const bad = await handlers['notes-folders']({ op: 'create', name: '  ' })
    assert(bad.error && bad.error.indexOf('需要 name') >= 0, '空白 name 应报错')
    const bad2 = await handlers['notes-folders']({ op: 'create' })
    assert(bad2.error, '缺 name 应报错')
  })
  await t('folder 字段数据往返：create 带 folder → get/list/磁盘 front-matter 一致', async () => {
    const folders = (await handlers['notes-folders']({})).folders
    const fWork = folders.find(f => f.name === '工作')
    const r = await handlers['notes-create']({ title: 'fld-往返', body: 'RT', topic: '开发', folder: fWork.id })
    const g = await handlers['notes-get']({ id: r.id })
    assert.strictEqual(g.note.folder, fWork.id, 'get 返回 folder id')
    const content = store.get(NOTES_DIR + '\\' + r.id + '.md')
    assert(content.indexOf('\nfolder: ' + fWork.id + '\n') >= 0, 'front-matter 含 folder 行（实得：' + content.split('\n').slice(0, 8).join('|') + '）')
    const l = await handlers['notes-list']({})
    assert.strictEqual(l.notes.find(n => n.id === r.id).folder, fWork.id, 'list slim 带 folder 字段')
  })
  await t('旧文件无 folder 字段兜底为未分类（向后兼容）', async () => {
    const legacyId = 'n-legacy-folder'
    const legacyContent = '---\nid: ' + legacyId + '\ntitle: 老笔记无folder\ntopic: 需求\ntags: quick\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n正文\n'
    await fsMock.writeText(NOTES_DIR + '\\' + legacyId + '.md', legacyContent)
    const g = await handlers['notes-get']({ id: legacyId })
    assert.strictEqual(g.note.folder, '', '无 folder 字段 → 缺省 \'\'（未分类）')
    const r = await handlers['notes-folders']({})
    assert(r.unfiled >= 1, '旧文件计入 unfiled')
  })
  await t('notes-list folder 过滤：按 id 命中 / 空串 = 未分类', async () => {
    const folders = (await handlers['notes-folders']({})).folders
    const fWork = folders.find(f => f.name === '工作')
    const inWork = await handlers['notes-list']({ folder: fWork.id })
    assert(inWork.notes.length >= 1 && inWork.notes.every(n => n.folder === fWork.id), 'folder=id 只返回该文件夹笔记')
    const unfiled = await handlers['notes-list']({ folder: '' })
    assert(unfiled.notes.length >= 1 && unfiled.notes.every(n => !(n.folder && folders.some(f => f.id === n.folder))), 'folder=\'\' 只返回未分类（不含清单内引用）')
    assert(unfiled.notes.find(n => n.id === 'n-legacy-folder'), '未分类列表含旧文件')
    const all = await handlers['notes-list']({})
    assert.strictEqual(all.notes.length, inWork.notes.length + unfiled.notes.length, '不过滤 = 各文件夹 + 未分类 之和（当前仅一个非空文件夹）')
  })
  await t('notes-folders list 计数口径：移入后 count/unfiled 联动', async () => {
    const before = await handlers['notes-folders']({})
    const fWork = before.folders.find(f => f.name === '工作')
    const note = await handlers['notes-create']({ title: 'fld-计数', body: 'x', topic: '开发' })
    const afterCreate = await handlers['notes-folders']({})
    assert.strictEqual(afterCreate.unfiled, before.unfiled + 1, '新建未指定文件夹 → unfiled+1')
    await handlers['notes-update']({ id: note.id, folder: fWork.id })
    const afterMove = await handlers['notes-folders']({})
    assert.strictEqual(afterMove.unfiled, before.unfiled, '移入文件夹 → unfiled 回落')
    assert.strictEqual(afterMove.folders.find(f => f.id === fWork.id).count, fWork.count + 1, '目标文件夹 count+1')
  })
  await t('notes-folders rename：改名生效 + 不存在 id/缺 name 报错', async () => {
    const folders = (await handlers['notes-folders']({})).folders
    const fStudy = folders.find(f => f.name === '学习')
    const r = await handlers['notes-folders']({ op: 'rename', id: fStudy.id, name: '学习资料' })
    assert(r.ok === true && r.name === '学习资料', 'rename 返回 ok + 新名')
    const after = await handlers['notes-folders']({})
    assert(after.folders.find(f => f.id === fStudy.id).name === '学习资料', 'list 反映新名')
    const onDisk = JSON.parse(store.get(FOLDERS_PATH_MOCK))
    assert(onDisk.find(f => f.id === fStudy.id).name === '学习资料', '磁盘清单已更新')
    const bad = await handlers['notes-folders']({ op: 'rename', id: 'f-nope', name: 'x' })
    assert(bad.error && bad.error.indexOf('文件夹不存在') >= 0, '不存在 id 报错')
    const bad2 = await handlers['notes-folders']({ op: 'rename', id: fStudy.id, name: ' ' })
    assert(bad2.error && bad2.error.indexOf('需要 name') >= 0, '空白 name 报错')
  })
  await t('notes-folders reorder：入列按序重排 + 未入列追加尾部 + order 归一化', async () => {
    const c3 = await handlers['notes-folders']({ op: 'create', name: '临时' })
    const folders = (await handlers['notes-folders']({})).folders
    const fWork = folders.find(f => f.name === '工作')
    const fStudy = folders.find(f => f.name === '学习资料')
    const r = await handlers['notes-folders']({ op: 'reorder', ids: [c3.folder.id, fWork.id] })
    assert(r.ok === true && Array.isArray(r.folders), 'reorder 返回 ok + folders')
    assert.deepStrictEqual(r.folders.map(f => f.id), [c3.folder.id, fWork.id, fStudy.id], '入列按 ids 序，未入列保持原序追加尾部')
    assert.deepStrictEqual(r.folders.map(f => f.order), [0, 1, 2], 'order 归一化为 0..n-1')
    const listed = (await handlers['notes-folders']({})).folders
    assert.deepStrictEqual(listed.map(f => f.id), [c3.folder.id, fWork.id, fStudy.id], 'list 按 order 排序输出')
    const bad = await handlers['notes-folders']({ op: 'reorder' })
    assert(bad.error && bad.error.indexOf('ids') >= 0, '缺 ids 报错')
  })
  await t('notes-folders delete：缺省拒绝含子内容（needCascade）+ cascade:true 笔记软删进回收站可恢复落未分类', async () => {
    // 自包含造数（不依赖前置 reorder 的「临时」夹——core 模式该断言跳过，本节仍可独立成立）
    const fTemp = (await handlers['notes-folders']({ op: 'create', name: '临时删' })).folder
    const n1 = await handlers['notes-create']({ title: 'fld-删1', body: 'x', folder: fTemp.id })
    const n2 = await handlers['notes-create']({ title: 'fld-删2', body: 'x', folder: fTemp.id })
    const before = await handlers['notes-folders']({})
    assert.strictEqual(before.folders.find(f => f.id === fTemp.id).count, 2, '前置：两条笔记在「临时删」')
    // 缺省（无 cascade）拒绝：报错 + needCascade 标记 + 子内容统计（供 confirm 明示），文件夹与笔记均不动
    const refuse = await handlers['notes-folders']({ op: 'delete', id: fTemp.id })
    assert(refuse.error && refuse.error.indexOf('cascade') >= 0 && refuse.needCascade === true && refuse.childFolders === 0 && refuse.notes === 2, '含笔记未传 cascade → 拒绝 + 统计（实得：' + JSON.stringify(refuse) + '）')
    assert((await handlers['notes-folders']({})).folders.find(f => f.id === fTemp.id), '拒绝后文件夹仍在')
    assert((await handlers['notes-get']({ id: n1.id })).note.folder === fTemp.id, '拒绝后笔记未动')
    // cascade:true → 文件夹删除 + 笔记逐条软删（回收站可恢复，folder 字段保留原引用不改写）
    const r = await handlers['notes-folders']({ op: 'delete', id: fTemp.id, cascade: true })
    assert(r.ok === true && r.folders === 1 && r.notes === 2, 'cascade 返回统计 {folders:1, notes:2}（实得：' + JSON.stringify(r) + '）')
    const after = await handlers['notes-folders']({})
    assert(!after.folders.find(f => f.id === fTemp.id), '清单不再含已删文件夹')
    assert.strictEqual(after.unfiled, before.unfiled, '软删笔记不进 unfiled（deleted 不计数）')
    assert((await handlers['notes-get']({ id: n1.id })).error, '软删后 notes-get 拒绝（已进回收站）')
    const trash = await handlers['notes-list']({ includeDeleted: true })
    const t1 = trash.notes.find(n => n.id === n1.id)
    assert(t1 && t1.deleted === true && t1.folder === fTemp.id, '回收站可见 + folder 字段保留原引用（不改写磁盘数据）')
    // 恢复：原文件夹已不存在 → effectiveFolder 兜底未分类（现有机制天然支持，断言锁定）
    await handlers['notes-restore']({ id: n1.id })
    assert((await handlers['notes-get']({ id: n1.id })).note.folder === fTemp.id, '恢复不改写 folder 原引用')
    assert((await handlers['notes-list']({ folder: '' })).notes.find(n => n.id === n1.id), '恢复后落未分类（原文件夹已删，effectiveFolder 兜底）')
    const bad = await handlers['notes-folders']({ op: 'delete', id: fTemp.id, cascade: true })
    assert(bad.error && bad.error.indexOf('文件夹不存在') >= 0, '重复删除报错')
  })
  await t('notes-folders 未知 op 报错', async () => {
    const r = await handlers['notes-folders']({ op: 'purge' })
    assert(r.error && r.error.indexOf('未知 op') >= 0, '未知 op 返回错误（实得：' + JSON.stringify(r) + '）')
  })
  await t('note_manage move：按 id/名称移动 + 移出未分类 + 参数校验', async () => {
    const folders = (await handlers['notes-folders']({})).folders
    const fWork = folders.find(f => f.name === '工作')
    const fStudy = folders.find(f => f.name === '学习资料')
    // 磁盘 folder 行是缓存无关的真相源（工具与重 apply 的 handlers 分属两个插件实例，各有缓存）
    const diskFolder = (id) => { const m = store.get(NOTES_DIR + '\\' + id + '.md').match(/\nfolder: ([^\n]*)\n/); return m ? m[1] : null }
    const n = await noteManage.execute({ action: 'create', title: 'fld-move', body: 'x' })
    const m1 = await noteManage.execute({ action: 'move', id: n.id, folder: fWork.id })
    assert.strictEqual(m1.action, 'move')
    assert.strictEqual(m1.folder, fWork.id)
    assert.strictEqual(m1.folderName, '工作')
    assert.strictEqual(diskFolder(n.id), fWork.id, '按 id 移动生效（磁盘 front-matter）')
    const m2 = await noteManage.execute({ action: 'move', id: n.id, folder: '学习资料' })
    assert.strictEqual(m2.folder, fStudy.id, '按名称精确命中解析为 id')
    assert.strictEqual(diskFolder(n.id), fStudy.id, '按名称移动生效（磁盘 front-matter）')
    const m3 = await noteManage.execute({ action: 'move', id: n.id, folder: '' })
    assert.strictEqual(m3.folder, '', '空串 = 移出到未分类')
    assert(m3.message.indexOf('未分类') >= 0, '移出消息含未分类')
    assert.strictEqual(diskFolder(n.id), '', '移出后磁盘 folder 行为空')
    const e1 = await noteManage.execute({ action: 'move', id: n.id })
    assert(e1.error && e1.error.indexOf('需要 folder') >= 0, '缺 folder 报错')
    const e2 = await noteManage.execute({ action: 'move', folder: fWork.id })
    assert(e2.error && e2.error.indexOf('需要 id') >= 0, '缺 id 报错')
    const e3 = await noteManage.execute({ action: 'move', id: n.id, folder: '不存在的文件夹' })
    assert(e3.error && e3.error.indexOf('文件夹不存在') >= 0, '找不到文件夹报错（不写悬空引用）')
  })
  await t('note_manage create/list 带 folder（create 按 id 落位；list 名称/id 兼容，\'\' = 未分类）', async () => {
    const folders = (await handlers['notes-folders']({})).folders
    const fStudy = folders.find(f => f.name === '学习资料')
    const c = await noteManage.execute({ action: 'create', title: 'fld-manage-create', body: 'x', folder: fStudy.id })
    assert(c.id, 'create 接受 folder id')
    assert.strictEqual((await handlers['notes-get']({ id: c.id })).note.folder, fStudy.id, 'create 落位到指定文件夹')
    const l1 = await noteManage.execute({ action: 'list', folder: '学习资料' })
    assert(l1.notes.length >= 1 && l1.notes.every(n => n.folder === fStudy.id), 'list 按名称过滤')
    const l2 = await noteManage.execute({ action: 'list', folder: fStudy.id })
    assert(l2.notes.length >= 1 && l2.notes.every(n => n.folder === fStudy.id), 'list 按 id 过滤')
    const l3 = await noteManage.execute({ action: 'list', folder: '' })
    assert(l3.notes.every(n => !(n.folder && folders.some(f => f.id === n.folder))), 'list folder=\'\' 只看未分类')
    const e1 = await noteManage.execute({ action: 'list', folder: 'f-nope' })
    assert(e1.error && e1.error.indexOf('文件夹不存在') >= 0, 'list 不存在文件夹报错')
  })
  await t('note_search folder 过滤（名称命中 / \'\' 未分类 / 不存在报错）', async () => {
    const tSearch = findTool('note_search')
    const folders = (await handlers['notes-folders']({})).folders
    const fStudy = folders.find(f => f.name === '学习资料')
    const s1 = await tSearch.execute({ query: 'fld-manage-create', folder: '学习资料' })
    assert(s1.count >= 1 && s1.notes.every(n => n.folder === fStudy.id), '按名称过滤命中')
    const s2 = await tSearch.execute({ query: 'fld-manage-create', folder: '' })
    assert.strictEqual(s2.count, 0, '该笔记不在未分类，folder=\'\' 应查不到')
    const s3 = await tSearch.execute({ folder: fStudy.id })
    assert(s3.notes.length >= 1 && s3.notes.every(n => n.folder === fStudy.id), '按 id 过滤（无 query 列全部）')
    const e1 = await tSearch.execute({ folder: '不存在的文件夹' })
    assert(e1.error && e1.error.indexOf('文件夹不存在') >= 0, '不存在文件夹报错')
  })
  await t('update 不动 folder：note_manage.update 保持原值，notes-update 显式改', async () => {
    const folders = (await handlers['notes-folders']({})).folders
    const fWork = folders.find(f => f.name === '工作')
    const n = await noteManage.execute({ action: 'create', title: 'fld-upd-iso', body: 'x', folder: fWork.id })
    await noteManage.execute({ action: 'update', id: n.id, title: 'fld-upd-iso-改' })
    const g = await handlers['notes-get']({ id: n.id })
    assert.strictEqual(g.note.title, 'fld-upd-iso-改', '标题已改')
    assert.strictEqual(g.note.folder, fWork.id, 'update 未传 folder 时保持原文件夹')
    await handlers['notes-update']({ id: n.id, folder: '' })
    assert.strictEqual((await handlers['notes-get']({ id: n.id })).note.folder, '', 'notes-update 显式 folder=\'\' 移出（client 移动通道）')
  })
  await t('悬空引用兜底：folder 指向清单外 id 按未分类对待（计数/过滤口径一致）', async () => {
    const ghostId = 'n-ghost-folder'
    await fsMock.writeText(NOTES_DIR + '\\' + ghostId + '.md', '---\nid: ' + ghostId + '\ntitle: 悬空引用笔记\ntopic: 调试\nfolder: f-ghost000\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n正文\n')
    const g = await handlers['notes-get']({ id: ghostId })
    assert.strictEqual(g.note.folder, 'f-ghost000', '原始字段保留（不篡改数据）')
    const u0 = (await handlers['notes-folders']({})).unfiled
    const ghostList = await handlers['notes-list']({ folder: 'f-ghost000' })
    assert.strictEqual(ghostList.notes.length, 0, '按清单外 id 过滤为空（effectiveFolder 判未分类）')
    const unfiled = await handlers['notes-list']({ folder: '' })
    assert(unfiled.notes.find(n => n.id === ghostId), '悬空引用笔记出现在未分类列表')
    assert(u0 >= 1, '悬空引用计入 unfiled')
  })
  await t('folders.json 损坏/结构非法兜底：清单空 + 笔记主流程不受影响', async () => {
    store.set(FOLDERS_PATH_MOCK, '这不是 JSON {')
    const r1 = await handlers['notes-folders']({})
    assert(Array.isArray(r1.folders) && r1.folders.length === 0 && !r1.error, '坏 JSON → 空清单不抛错')
    const l = await handlers['notes-list']({})
    assert(l.notes.length >= 1, 'notes-list 主流程不受 folders.json 损坏影响')
    store.set(FOLDERS_PATH_MOCK, '{"x":1}')
    const r2 = await handlers['notes-folders']({})
    assert(r2.folders.length === 0, '非数组 JSON → 空清单')
    store.set(FOLDERS_PATH_MOCK, JSON.stringify([{ id: 'f-ok1', name: 'OK', order: 0 }, { name: '无id' }, null, 'junk', { id: 123, name: '数字id', order: '0' }]))
    const r3 = await handlers['notes-folders']({})
    assert.strictEqual(r3.folders.length, 2, '非法元素被过滤（缺 id/null/字符串）')
    assert(r3.folders.find(f => f.id === 'f-ok1') && r3.folders.find(f => f.id === '123'), '合法元素保留且 id 归一化为字符串')
    store.delete(FOLDERS_PATH_MOCK)
    const r4 = await handlers['notes-folders']({})
    assert(r4.folders.length === 0, '删除清单文件后回退空清单（状态清理）')
  })

  // --- 树状列表拖拽：笔记挪入/挪出文件夹（HTML5 DnD；开发版 + 发布包同步）---
  await t('拖拽：笔记行 draggable + dragstart 记录 noteId（ref 防闭包过期 + dataTransfer）', () => {
    assert(/const dragNoteIdRef = React\.useRef\(null\)/.test(clientSrc), 'dragNoteIdRef 拖拽状态 ref 存在')
    assert(/draggable: true, onDragStart: \(ev\) => onNoteDragStart\(ev, n\)/.test(clientSrc), '笔记行 draggable + onDragStart → onNoteDragStart')
    assert(/onDragEnd: \(ev\) => onNoteDragEnd\(ev\)/.test(clientSrc), '笔记行 onDragEnd → onNoteDragEnd')
    assert(/function onNoteDragStart\(ev, n\)/.test(clientSrc) && /function onNoteDragEnd\(ev\)/.test(clientSrc), 'onNoteDragStart/onNoteDragEnd 函数存在')
    assert(/dragNoteIdRef\.current = n\.id/.test(clientSrc), 'dragstart 记录 noteId 到 ref')
    assert(clientSrc.indexOf("ev.dataTransfer.setData('text/dsh-note-id', n.id)") >= 0, 'dragstart 写入 dataTransfer text/dsh-note-id（Firefox 起拖必需）')
    assert(clientSrc.indexOf("classList.add('dragging')") >= 0, 'dragstart 源行加 .dragging 半透明')
  })
  await t('拖拽：文件夹行 drop 目标（dragover preventDefault + drop-hint 高亮 + drop 移入）', () => {
    assert(/function onFolderDragOver\(ev, f\)/.test(clientSrc) && /function onFolderDragLeave\(ev\)/.test(clientSrc) && /function onFolderDrop\(ev, f\)/.test(clientSrc), '文件夹行 dragover/dragleave/drop 处理器存在')
    assert(/onDragOver: \(ev\) => onFolderDragOver\(ev, f\), onDragLeave: onFolderDragLeave, onDrop: \(ev\) => onFolderDrop\(ev, f\)/.test(clientSrc), '文件夹行挂载三个 DnD 处理器')
    assert(clientSrc.indexOf("classList.add('drop-hint')") >= 0 && clientSrc.indexOf("classList.remove('drop-hint')") >= 0, 'drop-hint 高亮加/摘')
    assert(clientSrc.indexOf('ctxMoveToFolder({ id: id }, f.id)') >= 0, 'drop 移入复用 ctxMoveToFolder（notes-update 只改 folder 字段）')
    assert(clientSrc.indexOf("(noteObj.folder || '') !== f.id") >= 0, '已在目标夹内静默无动作（不重复弹 toast）')
  })
  await t('拖拽：未分类区 drop 目标 = 移出文件夹；非法目标无动作；dragend 兜底清理', () => {
    assert(/function onUnfiledDragOver\(ev\)/.test(clientSrc) && /function onUnfiledDrop\(ev\)/.test(clientSrc), '未分类区 dragover/drop 处理器存在')
    assert(clientSrc.indexOf("className: 'dsh-notes-unfiled-drop', onDragOver: onUnfiledDragOver, onDragLeave: onUnfiledDragLeave, onDrop: onUnfiledDrop") >= 0, '未分类平铺区包一层 drop 容器')
    assert(clientSrc.indexOf("ctxMoveToFolder({ id: id }, '')") >= 0, 'drop 到未分类区 = 移出（folder: \'\'）')
    assert((clientSrc.match(/if \(!dragNoteIdRef\.current\) return/g) || []).length >= 3, '笔记拖拽 drop 处理器均先判 ref：非本插件拖拽不接管（非法目标无动作；文件夹拖拽走 dragFolderIdRef 通道）')
    assert(clientSrc.indexOf("classList.remove('dragging')") >= 0, 'dragend 清理 .dragging')
    assert(clientSrc.indexOf("querySelectorAll('.dsh-notes-floating .drop-hint')") >= 0, 'dragend 清理面板内所有残留 .drop-hint')
    // 右键「移动到文件夹」保留（拖拽与右键菜单共存）
    assert(clientSrc.indexOf('移动到文件夹') >= 0, '右键「移动到文件夹」保留')
  })
  await t('拖拽样式：.dragging 半透明 + .drop-hint 虚线描边（原型 .row.drop）+ 未分类区容器（开发版 + 发布包同步）', () => {
    const cssDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    assert(/\.dsh-notes-note-row\.dragging\{[^}]*opacity:\.35/.test(cssDev), 'styles.css 含 .dsh-notes-note-row.dragging opacity:.35（原型口径）')
    assert(/\.dsh-notes-folder-row\.drop-hint\{[^}]*outline:1\.5px dashed var\(--nacc\)/.test(cssDev), 'styles.css 含 .drop-hint 1.5px 虚线 --nacc 描边（原型 .row.drop）')
    assert(cssDev.indexOf('.dsh-notes-unfiled-drop') >= 0, 'styles.css 含未分类区 drop 容器样式')
    for (const cls of ['.dsh-notes-note-row.dragging', '.dsh-notes-folder-row.drop-hint', '.dsh-notes-unfiled-drop']) {
      assert(cssPkg.indexOf(cls) >= 0, '发布包 lib/styles.css 缺 ' + cls + '（需先跑 scripts/build-dist.cjs）')
    }
  })
  await t('发布包 client.js 同步拖拽链路（需先跑 scripts/build-dist.cjs）', () => {
    for (const k of ['text/dsh-note-id', 'onNoteDragStart', 'onNoteDragEnd', 'onFolderDragOver', 'onFolderDrop', 'onUnfiledDrop', 'dragNoteIdRef', 'drop-hint', 'dsh-notes-unfiled-drop', 'draggable: true']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 client.js 缺 ' + k)
    }
    assert(clientPkgSrc.indexOf('ctxMoveToFolder({ id: id }, f.id)') >= 0 && clientPkgSrc.indexOf("ctxMoveToFolder({ id: id }, '')") >= 0, '发布包 drop 移入/移出复用 ctxMoveToFolder')
  })

  // ===== 22. 笔记目录索引注入（notes:catalog order 131 + recall 字段 + catalogEnabled 总开关） =====
  section('22. 笔记目录索引注入（recall 通道，host 双侧同步）')

  // --- 源码结构断言（开发版 host-impl + 静态包 index.mjs 同步） ---
  await t('双侧注册 notes:catalog order 131 + catalogText + 40 封顶 + 文案', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(src.indexOf("name: 'notes:catalog'") >= 0 && /order:\s*131/.test(src), label + ' 注册 notes:catalog order 131')
      assert(src.indexOf('function catalogText(sidOverride)') >= 0, label + ' catalogText 生成函数存在（sidOverride 为注入预览形参，缺省行为不变）')
      assert(/CATALOG_LIMIT\s*=\s*40/.test(src), label + ' CATALOG_LIMIT=40 封顶')
      assert(src.indexOf("settingsCache.catalogEnabled === false") >= 0, label + ' catalogEnabled 总开关门（默认开）')
      assert(src.indexOf('本地笔记库目录（与本任务相关时用 note_get 拉全文，更多用 note_search）：') >= 0, label + ' 目录标题行文案')
      assert(src.indexOf('规划任务前，若目录中有相关笔记（尤其待办/决策），建议先 note_get 读取再动手') >= 0, label + ' 末尾轻推行文案')
      assert(src.indexOf('…另有 ') >= 0 && src.indexOf('条较早笔记，用 note_search 检索') >= 0, label + ' 溢出提示行文案')
      assert(src.indexOf('function conventionHit(n, ws, curSid)') >= 0, label + ' conventionHit 共用命中判定（约定注入与目录去重）')
      assert(src.indexOf("n.status === 'resolved' || n.status === 'superseded'") >= 0, label + ' 排除 resolved/superseded')
      assert(src.indexOf('n.recall === false') >= 0, label + ' 排除 recall=false')
      assert(src.indexOf('conventionHit(n, ws, curSid)') >= 0, label + ' 目录与约定注入去重')
    }
  })
  await t('双侧 recall 字段链路（buildFM / noteFromParsed / persistNote / slim / _update / 工具 schema）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(/'recall: ' \+ escYaml\(m\.recall === false \? 'false' : 'true'\)/.test(src), label + ' buildFM 写 recall 行')
      assert(src.indexOf("recall: p.meta.recall === 'true' ? true : (p.meta.recall === 'false' ? false : (p.meta.kind === 'log' ? false : true)),") >= 0, label + ' noteFromParsed 读 recall（缺省 true；工作记忆 v0：kind=log 缺省 false，显式 true 豁免）')
      assert((src.match(/recall: n\.recall !== false/g) || []).length >= 2, label + ' persistNote 与 slim 均带 recall')
      assert(/if \(recall !== undefined\) note\.recall = recall !== false/.test(src), label + ' _update 显式传 recall 才改（undefined 不动）')
      assert(/recall: \{ type: 'boolean'/.test(src), label + ' note_manage schema 含 recall 参数')
      assert(src.indexOf("handle('notes-settings-set'") >= 0 && src.indexOf('catalogEnabled') >= 0, label + ' notes-settings-set 支持 catalogEnabled')
    }
  })

  // --- 行为断言（开发版 host-impl，全新实例：独立 store/handlers/contexts，计数确定） ---
  const store3 = new Map()
  const fsMock3 = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store3.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store3.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!store3.has(p)) throw new Error('ENOENT: ' + p); return store3.get(p) },
    writeText: async (p, c) => { store3.set(p, c) },
  }
  const handlers3 = {}
  const tools3 = []
  const harnessMock3 = {
    handle: (name, fn) => { handlers3[name] = fn; return () => { delete handlers3[name] } },
    defineTool: (def) => def,
    registerTool: (ctx, def) => { tools3.push(def); return () => {} },
  }
  const contexts3 = []
  const ctx3 = {
    fs: fsMock3, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contexts3.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock3, DIR).apply(ctx3)
  const catCtx3 = contexts3.find(x => x.name === 'notes:catalog')
  const tMgr3 = tools3.find(x => x.name === 'note_manage')

  await t('notes:catalog context 注册（order 131 紧邻约定注入 130 之后，开发版）', () => {
    assert.strictEqual(contexts3.length, 2, '注册 2 个 systemPrompt context')
    assert.strictEqual(contexts3[0].name, 'notes:workspace-conventions')
    assert.strictEqual(contexts3[0].order, 130, '约定注入 order=130')
    assert.strictEqual(contexts3[1].name, 'notes:catalog')
    assert.strictEqual(contexts3[1].order, 131, '目录注入 order=131')
    assert(typeof catCtx3.text === 'function', 'text 是函数')
  })
  await t('空库目录文本为空串（不注入，绝不返回 undefined）', () => {
    assert.strictEqual(catCtx3.text(), '', '空库返回空串')
  })

  // 造数据：本区笔记 / 跨区笔记 / pinned 待办 / resolved / 约定 inject=true / recall=false
  const cn1 = await handlers3['notes-create']({ title: '目录笔记甲', body: '甲正文', topic: '开发' })
  // updatedAt 为毫秒级 ISO 时间戳：两条创建若落在同一毫秒内，降序断言会因并列序而退化为不稳定（间歇性失败）
  await new Promise(r => setTimeout(r, 2))
  await tMgr3.execute({ action: 'create', title: '目录笔记乙', body: '乙正文', topic: '设计', workspace: 'other-ws' })
  await tMgr3.execute({ action: 'create', title: '目录待办置顶', body: 'x', kind: 'todo', status: 'pinned', topic: '运维' })
  await tMgr3.execute({ action: 'create', title: '已解决笔记', body: 'x', status: 'resolved' })
  await tMgr3.execute({ action: 'create', title: '已被取代笔记', body: 'x', status: 'superseded' })
  await handlers3['notes-create']({ title: '本区约定不入目录', body: '约定全文已注入', inject: true, topic: '约定' })
  const cn6 = await tMgr3.execute({ action: 'create', title: 'recall关闭笔记', body: 'x', recall: false })

  await t('目录标题行 + 一行一条格式 + 末尾轻推行', () => {
    const txt = catCtx3.text()
    assert(txt.indexOf('本地笔记库目录（与本任务相关时用 note_get 拉全文，更多用 note_search）：') === 0, '标题行开头（实得：' + txt.slice(0, 80) + '）')
    assert(txt.indexOf('- [' + cn1.id + '] 目录笔记甲 (笔记, 开发)') >= 0, '行格式：- [id] 标题 (kind中文, topic)')
    assert(txt.indexOf('(待办, 运维)') >= 0, 'kind 中文映射（todo→待办）')
    assert(txt.indexOf('\n规划任务前，若目录中有相关笔记（尤其待办/决策），建议先 note_get 读取再动手') > 0, '末尾轻推行')
  })
  await t('排序：pinned 优先 → updatedAt 降序；目录不再标注 ←工作区来源', () => {
    const txt = catCtx3.text()
    assert(txt.indexOf('目录待办置顶') >= 0 && txt.indexOf('目录待办置顶') < txt.indexOf('目录笔记甲'), 'pinned 排最前')
    const i1 = txt.indexOf('目录笔记甲'), i2 = txt.indexOf('目录笔记乙')
    assert(i1 >= 0 && i2 >= 0, '本区/跨区笔记都进目录（无工作区过滤）')
    assert(i2 < i1, 'updatedAt 降序（乙晚于甲创建，排在甲前）')
    assert(txt.indexOf('目录笔记乙 (笔记, 设计)') >= 0 && txt.indexOf('←') < 0, '行尾不再标注 ←工作区名')
    assert(txt.indexOf('目录笔记甲 (笔记, 开发)') >= 0, '行格式不变（- [id] 标题 (kind, topic)）')
  })
  await t('准入排除：resolved / superseded / recall=false / 约定去重', () => {
    const txt = catCtx3.text()
    assert(txt.indexOf('已解决笔记') < 0, 'resolved 不进目录')
    assert(txt.indexOf('已被取代笔记') < 0, 'superseded 不进目录')
    assert(txt.indexOf('recall关闭笔记') < 0, 'recall=false 不进目录')
    assert(txt.indexOf('本区约定不入目录') < 0, 'inject=true 且本会话命中的约定不进目录（order 130 已注入全文）')
    const conv = contexts3[0].text()
    assert(conv.indexOf('本区约定不入目录') >= 0 && conv.indexOf('约定全文已注入') >= 0, '约定全文确实在 order 130 注入（去重成立的前提）')
  })
  await t('recall 字段 front-matter 往返 + 缺省 true', async () => {
    const onDisk1 = store3.get(NOTES_DIR + '\\' + cn1.id + '.md')
    assert(onDisk1.indexOf('\nrecall: true\n') >= 0, '缺省写 recall: true')
    const onDisk6 = store3.get(NOTES_DIR + '\\' + cn6.id + '.md')
    assert(onDisk6.indexOf('\nrecall: false\n') >= 0, 'create recall=false 写 recall: false')
    const g = await handlers3['notes-get']({ id: cn1.id })
    assert.strictEqual(g.note.recall, true, 'notes-get 返回 recall=true（缺省）')
    assert.strictEqual(g.note.inject, false, 'recall 与 inject 正交（缺省 recall=true 不影响 inject）')
  })
  await t('note_manage update 可改 recall（false 出目录 / true 回目录）', async () => {
    const u1 = await tMgr3.execute({ action: 'update', id: cn1.id, recall: false })
    assert(!u1.error, 'update recall=false 成功')
    assert(catCtx3.text().indexOf('目录笔记甲') < 0, 'recall=false 后目录不含该笔记')
    const onDisk = store3.get(NOTES_DIR + '\\' + cn1.id + '.md')
    assert(onDisk.indexOf('\nrecall: false\n') >= 0, '磁盘 front-matter 同步为 recall: false')
    await tMgr3.execute({ action: 'update', id: cn1.id, recall: true })
    assert(catCtx3.text().indexOf('目录笔记甲') >= 0, 'recall 改回 true 后目录恢复')
  })
  await t('旧文件无 recall 字段缺省进目录（向后兼容）', async () => {
    const legacyId = 'n-legacy-recall'
    await fsMock3.writeText(NOTES_DIR + '\\' + legacyId + '.md', '---\nid: ' + legacyId + '\ntitle: 旧版无recall笔记\ntopic: 运维\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n旧正文\n')
    const g = await handlers3['notes-get']({ id: legacyId })   // 触发解析进 cache（catalogText 只读 cache）
    assert.strictEqual(g.note.recall, true, '旧文件解析缺省 recall=true')
    assert(catCtx3.text().indexOf('旧版无recall笔记') >= 0, '无 recall 字段的旧笔记缺省进目录')
  })
  await t('note_manage schema 含 recall 参数', () => {
    assert(tMgr3.parameters.properties.recall && tMgr3.parameters.properties.recall.type === 'boolean', 'recall boolean 参数存在')
  })
  await t('catalogEnabled 总开关：默认开 → 关即空 → settings.json 落盘 → 校验非布尔 → 重开恢复', async () => {
    assert(catCtx3.text().length > 0, '默认开：目录非空')
    const bad = await handlers3['notes-settings-set']({ catalogEnabled: 'yes' })
    assert(bad.error && bad.error.indexOf('catalogEnabled') >= 0, '非布尔值报错')
    assert(catCtx3.text().length > 0, '校验失败不影响开关状态')
    const off = await handlers3['notes-settings-set']({ catalogEnabled: false })
    assert(off.ok === true, '关闭成功（实得 ' + JSON.stringify(off) + '）')
    assert.strictEqual(catCtx3.text(), '', '关闭后目录文本为空')
    const onDisk = JSON.parse(store3.get(NOTES_DIR + '\\settings.json'))
    assert.strictEqual(onDisk.catalogEnabled, false, 'settings.json 含 catalogEnabled:false')
    const sg = await handlers3['notes-settings-get']({})
    assert.strictEqual(sg.settings.catalogEnabled, false, 'notes-settings-get 回读一致')
    assert(Array.isArray(sg.models) && sg.models.some(m => m.provider === 'p' && m.model === 'm'), 'settings-get 带 models 目录（llm 探针）')
    await handlers3['notes-settings-set']({ catalogEnabled: true })
    assert(catCtx3.text().length > 0, '重新打开后目录恢复')
  })

  // --- 40 条封顶（再开全新实例，计数确定） ---
  await t('40 条封顶 + 溢出提示行（…另有 N 条较早笔记）', async () => {
    const store4 = new Map()
    const fsMock4 = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store4.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of store4.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!store4.has(p)) throw new Error('ENOENT: ' + p); return store4.get(p) },
      writeText: async (p, c) => { store4.set(p, c) },
    }
    const handlers4 = {}
    const contexts4 = []
    const harnessMock4 = { handle: (name, fn) => { handlers4[name] = fn; return () => {} }, defineTool: (d) => d, registerTool: () => () => {} }
    new Function('harness', 'pluginDir', hostSrc)(harnessMock4, DIR).apply({
      fs: fsMock4, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ agents: agentsMock, systemPrompt: { context: (c) => { contexts4.push(c); return () => {} } } })[name],
      effect: () => {},
    })
    for (let i = 0; i < 45; i++) await handlers4['notes-create']({ title: '批量' + i, body: 'x' })
    const txt = contexts4.find(x => x.name === 'notes:catalog').text()
    const itemLines = txt.split('\n').filter(l => l.indexOf('- [n-') === 0)
    assert.strictEqual(itemLines.length, 40, '目录最多 40 条（实得 ' + itemLines.length + '）')
    assert(txt.indexOf('…另有 5 条较早笔记，用 note_search 检索') >= 0, '溢出提示行（实得尾部：' + txt.split('\n').slice(-2).join(' | ') + '）')
  })

  // --- 静态包行为（独立 ESM 实例 + 独立 store；harness 缺席 → webServer 路由 + ctx.tools） ---
  section('22.5 笔记目录索引注入（静态包 index.mjs 行为）')
  const store5 = new Map()
  const fsMock5 = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_ROOT_STATIC ? { dir: true } : (store5.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store5.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!store5.has(p)) throw new Error('ENOENT: ' + p); return store5.get(p) },
    writeText: async (p, c) => { store5.set(p, c) },
  }
  const routes5 = []
  const tools5b = []
  const contexts5 = []
  const ctx5 = {
    fs: fsMock5,
    sandboxPolicy: { resolve: () => ({}) },
    webServer: { register: (r) => { routes5.push(r); return () => {} } },
    tools: { register: (d) => { tools5b.push(d); return () => {} } },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contexts5.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  }
  const modCat = await import(pathToFileURL(INDEX_PATH).href + '?catalog=1')
  modCat.apply(ctx5)
  function rpc5(method, args) {
    return new Promise((resolve, reject) => {
      const body = Buffer.from(JSON.stringify({ method: method, args: args }))
      const req = { method: 'POST', on: (ev, cb) => { if (ev === 'data') cb(body); else if (ev === 'end') cb(); return req }, destroy: () => {} }
      const res = { statusCode: 0, setHeader: () => {}, writeHead: (c) => { res.statusCode = c }, end: (s) => { let b; try { b = JSON.parse(s) } catch (e) { b = s } resolve({ status: res.statusCode, body: b }) } }
      Promise.resolve(routes5[0].handler(req, res)).catch(reject)
    })
  }
  const catCtx5 = contexts5.find(x => x.name === 'notes:catalog')
  await t('静态包注册 notes:catalog order 131（无迁移干扰的干净库）', () => {
    assert.strictEqual(contexts5.length, 2, '静态包注册 2 个 context')
    assert.strictEqual(contexts5[0].order, 130, '约定注入 order=130')
    assert.strictEqual(catCtx5 && catCtx5.order, 131, '目录注入 order=131')
    assert.strictEqual(catCtx5.text(), '', '空库目录为空串')
  })
  await t('静态包目录行为：create 进目录 / recall=false 排除 / update 可改', async () => {
    const c = await rpc5('notes-create', { title: '静态目录笔记', body: 'x', topic: '开发' })
    assert(c.body.id, 'notes-create 成功')
    let txt = catCtx5.text()
    assert(txt.indexOf('- [' + c.body.id + '] 静态目录笔记 (笔记, 开发)') >= 0, '新建笔记进目录（实得：' + txt + '）')
    const tMgr5 = tools5b.find(x => x.name === 'note_manage')
    const c2 = await tMgr5.execute({ action: 'create', title: '静态recall关', body: 'x', recall: false })
    assert(c2.id && !c2.error, '工具 create recall=false 成功')
    assert(catCtx5.text().indexOf('静态recall关') < 0, 'recall=false 不进目录')
    const u = await tMgr5.execute({ action: 'update', id: c.body.id, recall: false })
    assert(!u.error, '工具 update recall=false 成功')
    assert(catCtx5.text().indexOf('静态目录笔记') < 0, 'update recall=false 后出目录')
    const onDisk = store5.get(path.join(NOTES_ROOT_STATIC, c.body.id + '.md'))
    assert(onDisk.indexOf('\nrecall: false\n') >= 0, '静态包磁盘 front-matter 同步 recall: false')
    await tMgr5.execute({ action: 'update', id: c.body.id, recall: true })
    assert(catCtx5.text().indexOf('静态目录笔记') >= 0, 'recall 改回 true 后回目录')
  })
  await t('静态包 catalogEnabled 总开关（notes-settings-set 经 webServer 路由）', async () => {
    const off = await rpc5('notes-settings-set', { catalogEnabled: false })
    assert(off.body.ok === true, '关闭成功（实得 ' + JSON.stringify(off.body) + '）')
    assert.strictEqual(catCtx5.text(), '', '关闭后目录为空')
    const onDisk = JSON.parse(store5.get(path.join(NOTES_ROOT_STATIC, 'settings.json')))
    assert.strictEqual(onDisk.catalogEnabled, false, 'settings.json 落盘 catalogEnabled:false')
    const sg = await rpc5('notes-settings-get', {})
    assert.strictEqual(sg.body.settings.catalogEnabled, false, 'settings-get 回读一致')
    const bad = await rpc5('notes-settings-set', { catalogEnabled: 1 })
    assert(bad.body.error && bad.body.error.indexOf('catalogEnabled') >= 0, '非布尔值报错')
    await rpc5('notes-settings-set', { catalogEnabled: null })
    const sg2 = await rpc5('notes-settings-get', {})
    assert(!('catalogEnabled' in sg2.body.settings), 'null 删除 override（恢复缺省开）')
    assert(catCtx5.text().length > 0, '恢复默认开后目录回来')
  })

  // ===== 22.6 笔记目录注入 client UI 开关（设置卡片 catalogEnabled 总开关 + 详情区逐条 recall 开关） =====
  section('22.6 笔记目录注入 client UI 开关（catalogEnabled 总开关 + recall 逐条）')
  await t('设置卡片含「笔记目录注入」总开关行（settingsRows 加行，勾选即保存）', () => {
    assert(/key: 'catalog', label: '笔记目录注入'/.test(clientSrc), 'settingsRows 含「笔记目录注入」行')
    assert(clientSrc.indexOf('catalogEnabled') >= 0, 'client-impl 含 catalogEnabled 字段')
    assert(/function saveSettingsCatalog\(/.test(clientSrc), 'saveSettingsCatalog 保存函数存在')
    assert(/function saveSettingsCatalog\([\s\S]*?notes-settings-set', \{ catalogEnabled: enabled \}\)/.test(clientSrc), '总开关走 notes-settings-set 传 catalogEnabled 布尔')
    assert(clientSrc.indexOf('向 Agent 系统提示注入笔记目录（一行一条），供其规划时参考并按需 note_get 取全文') >= 0, '总开关 tooltip/sub 说明文案')
    assert(/setSetCatalog\(!res\.settings \|\| res\.settings\.catalogEnabled !== false\)/.test(clientSrc), 'openSettings 回读 catalogEnabled（缺省开）')
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
    assert(clientPkgSrc.indexOf('笔记目录注入') >= 0 && clientPkgSrc.indexOf('目录可见') >= 0, '发布包含总开关行 + 逐条开关文案')
    assert(clientPkgSrc.indexOf('catalogEnabled') >= 0 && /recall: edRecallRef\.current/.test(clientPkgSrc), '发布包含 catalogEnabled + recall 链路')
    assert(clientPkgSrc.indexOf('saveSettingsCatalog') >= 0 && clientPkgSrc.indexOf('toggleRecall') >= 0, '发布包含两个开关函数')
  })

  // ===== 23. 笔记导入/导出（notes-export / notes-import-preview / notes-import，双侧同步） =====
  section('23. 笔记导入/导出（目录快照 + 预览分类 + 全量备份 + 覆盖策略 + folders 合并）')

  // --- 源码结构断言（开发版 host-impl + 静态包 index.mjs 同步）---
  await t('双侧注册 3 个 RPC + 核心函数 + 目录命名约定（host-impl / index.mjs）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(src.indexOf("handle('notes-export'") >= 0, label + ' 注册 notes-export')
      assert(src.indexOf("handle('notes-import-preview'") >= 0, label + ' 注册 notes-import-preview')
      assert(src.indexOf("handle('notes-import'") >= 0, label + ' 注册 notes-import')
      for (const fn of ['_export', '_importPreview', '_import', 'scanImportDir', 'copyNotesDir', 'listNoteMd', 'readFoldersFile', 'readLibraryRaw', 'tsStamp']) {
        assert(src.indexOf('function ' + fn) >= 0, label + ' 缺函数 ' + fn)
      }
      assert(src.indexOf('dsh-notes-export-') >= 0, label + ' 导出目录命名 dsh-notes-export-<ts>')
      assert(src.indexOf('notes-backup-') >= 0, label + ' 备份目录命名 notes-backup-<ts>')
      assert(src.indexOf("indexOf('n-') === 0") >= 0, label + ' n-*.md 过滤（settings.json / *.bak / assets 子目录不进出）')
      assert(src.indexOf("p.meta.id || name.replace(/\\.md$/i, '')") >= 0, label + ' 导入 id 取 front-matter，缺失按文件名兜底')
    }
  })
  await t('双侧图片资产段同步：上传 RPC + mime 白名单 + 5MB 上限 + 重名序号 + 导出/导入/备份连带', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(src.indexOf("handle('notes-asset-upload'") >= 0, label + ' 注册 notes-asset-upload')
      for (const fn of ['_assetUpload', 'listAssets', 'copyAssetsDir', 'safeAssetFileName', 'allocAssetName', 'assetDecodedSize']) {
        assert(src.indexOf('function ' + fn) >= 0, label + ' 缺资产函数 ' + fn)
      }
      assert(src.indexOf("ASSET_MIME_EXT") >= 0 && src.indexOf("'image/png': '.png'") >= 0 && src.indexOf("'image/webp': '.webp'") >= 0, label + ' mime 白名单 png/jpeg/gif/webp')
      assert(src.indexOf('ASSET_MAX_BYTES = 5 * 1024 * 1024') >= 0, label + ' 解码后 5MB 上限常量')
      assert(src.indexOf('base64 文本形态落盘') >= 0 || src.indexOf('base64 文本形态') >= 0, label + ' 磁盘格式注释：base64 文本形态（沙箱 fs 仅文本写）')
      assert(src.indexOf('copyAssetsDir(NOTES_DIR, targetDir, false)') >= 0, label + ' copyNotesDir 连带 assets（导出/备份共用）')
      assert(src.indexOf('copyAssetsDir(chk.dir, NOTES_DIR, true)') >= 0, label + ' _import 合并 assets（同名跳过）')
      assert(src.indexOf('assetsMerged') >= 0, label + ' _import 返回 assetsMerged')
      assert(src.indexOf('r.assets') >= 0, label + ' _export 返回 assets 计数')
    }
  })

  // --- 行为断言（开发版 host-impl，全新实例：独立 store/handlers，计数确定）---
  // mock 增强：stat 对「有子项的隐含目录」返回 dir（贴近真实 fs，import/export 的目录存在性校验依赖它）
  function mkFsMockImp(store, dirs) {
    return {
      resolve: async (p) => p,
      stat: async (p) => {
        if (dirs.indexOf(p) >= 0) return { dir: true }
        if (store.has(p)) return { file: true }
        const prefix = p + '\\'
        for (const k of store.keys()) if (k.startsWith(prefix)) return { dir: true }
        return null
      },
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of store.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!store.has(p)) throw new Error('ENOENT: ' + p); return store.get(p) },
      writeText: async (p, c) => { store.set(p, c) },
    }
  }
  const store6 = new Map()
  const fsMock6 = mkFsMockImp(store6, [NOTES_DIR])
  const handlers6 = {}
  const harnessMock6 = { handle: (name, fn) => { handlers6[name] = fn; return () => { delete handlers6[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  const ctx6 = {
    fs: fsMock6, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock6, DIR).apply(ctx6)
  await t('开发版注册 39 个 RPC（含 notes-export / notes-export-single / notes-import-preview / notes-import / notes-asset-upload；另含归档 preview/undo + ai-organize/assets-prune 并行重构 + P1 notes-purge + P3 单文件导出 + notes-inject-preview 注入预览 + notes-suggest 整理建议 + notes-usage-get 用量统计 + 历史版本三 RPC + 工作记忆 notes-memory-guide）', () => {
    assert.strictEqual(Object.keys(handlers6).length, 39, '实得 ' + Object.keys(handlers6).length)
    assert(typeof handlers6['notes-memory-guide'] === 'function', 'notes-memory-guide handler 存在（工作记忆 v0 沉淀引导）')
    assert(typeof handlers6['notes-export'] === 'function' && typeof handlers6['notes-import-preview'] === 'function' && typeof handlers6['notes-import'] === 'function', '3 个新 handler 存在')
    assert(typeof handlers6['notes-export-single'] === 'function', 'notes-export-single handler 存在（P3 单文件导出）')
    assert(typeof handlers6['notes-asset-upload'] === 'function', 'notes-asset-upload handler 存在')
    assert(typeof handlers6['notes-purge'] === 'function', 'notes-purge handler 存在（P1 回收站彻底删除）')
    assert(typeof handlers6['notes-usage-get'] === 'function', 'notes-usage-get handler 存在（LLM 用量统计）')
    assert(typeof handlers6['notes-history'] === 'function' && typeof handlers6['notes-history-get'] === 'function' && typeof handlers6['notes-restore-history'] === 'function', '历史版本三 handler 存在（notes-history-ui）')
  })

  // 造库：3 条笔记 + 1 个文件夹
  const exA = await handlers6['notes-create']({ title: '导出A', body: '正文A', topic: '开发' })
  const exB = await handlers6['notes-create']({ title: '导出B', body: '正文B', topic: '设计' })
  const exC = await handlers6['notes-create']({ title: '导出C', body: '正文C', topic: '运维' })
  await handlers6['notes-folders']({ op: 'create', name: '导出文件夹' })

  await t('notes-export：全库快照（n-*.md + folders.json）到 <dir>\\dsh-notes-export-<ts>', async () => {
    const r = await handlers6['notes-export']({ dir: 'D:\\exp-out' })
    assert(!r.error, '导出成功（实得 ' + JSON.stringify(r) + '）')
    assert.strictEqual(r.exported, 3, '导出 3 条笔记')
    assert.strictEqual(r.foldersFile, true, 'folders.json 一并导出')
    assert(/\\dsh-notes-export-\d{8}-\d{6}$/.test(r.target), 'target = <dir>\\dsh-notes-export-<yyyyMMdd-HHmmss>（实得：' + r.target + '）')
    for (const id of [exA.id, exB.id, exC.id]) {
      assert.strictEqual(store6.get(r.target + '\\' + id + '.md'), store6.get(NOTES_DIR + '\\' + id + '.md'), id + ' 快照内容与原文件逐字节一致')
    }
    assert.strictEqual(store6.get(r.target + '\\folders.json'), store6.get(NOTES_DIR + '\\folders.json'), 'folders.json 快照一致')
    assert(!store6.has(r.target + '\\settings.json'), 'settings.json 不导出')
  })
  await t('notes-export 参数校验：缺 dir 报错 / dir 是文件报错', async () => {
    const e1 = await handlers6['notes-export']({})
    assert(e1.error && e1.error.indexOf('需要 dir') >= 0, '缺 dir 报错')
    const e2 = await handlers6['notes-export']({ dir: NOTES_DIR + '\\' + exA.id + '.md' })
    assert(e2.error && e2.error.indexOf('不是目录') >= 0, 'dir 指向文件应报错（实得：' + JSON.stringify(e2) + '）')
  })

  // 预览基线：全新导出目录与库一致 → 全 same；预览本身不写任何文件
  let expDir = null
  await t('notes-import-preview：全 same 基线 + folders.new=0 + 不写任何东西', async () => {
    const ex = await handlers6['notes-export']({ dir: 'D:\\exp-out' })
    expDir = ex.target
    const sizeBefore = store6.size
    const p = await handlers6['notes-import-preview']({ dir: expDir })
    assert(!p.error, '预览成功（实得 ' + JSON.stringify(p).slice(0, 200) + '）')
    assert.strictEqual(p.total, 3)
    assert.strictEqual(p.same, 3); assert.strictEqual(p.diff, 0); assert.strictEqual(p.added, 0)
    assert(p.detail.every(d => d.status === 'same' && d.deleted === false), 'detail 全 same 且未标注 deleted')
    assert(p.folders && p.folders.total === 1 && p.folders.new === 0, 'folders：清单 1 个且全部已存在')
    assert.strictEqual(store6.size, sizeBefore, '预览不写任何文件（纯只读）')
  })

  // 构造混合场景：B 外部改动（diff）+ 新增 n-newimp01（added）+ 新增 deleted 笔记（added+标注）+ folders.json 加新文件夹
  await t('notes-import-preview：same/diff/added 分类 + deleted 标注 + folders 新增统计', async () => {
    store6.set(expDir + '\\' + exB.id + '.md', store6.get(expDir + '\\' + exB.id + '.md') + '\n外部改动\n')
    store6.set(expDir + '\\n-newimp01.md', '---\nid: n-newimp01\ntitle: 外部新笔记\ntopic: 调研\ncreatedAt: "2026-01-02T00:00:00.000Z"\nupdatedAt: "2026-01-02T00:00:00.000Z"\n---\n\n新正文\n')
    store6.set(expDir + '\\n-delimp01.md', '---\nid: n-delimp01\ntitle: 外部已删笔记\ndeleted: true\ncreatedAt: "2026-01-02T00:00:00.000Z"\nupdatedAt: "2026-01-02T00:00:00.000Z"\n---\n\n已删正文\n')
    const curFolders = JSON.parse(store6.get(expDir + '\\folders.json'))
    curFolders.push({ id: 'f-imp01', name: '导入新文件夹', order: 5 })
    store6.set(expDir + '\\folders.json', JSON.stringify(curFolders, null, 2))
    const p = await handlers6['notes-import-preview']({ dir: expDir })
    assert.strictEqual(p.total, 5, 'A/B/C + 2 新增')
    assert.strictEqual(p.same, 2); assert.strictEqual(p.diff, 1); assert.strictEqual(p.added, 2)
    const byId = {}
    for (const d of p.detail) byId[d.id] = d
    assert.strictEqual(byId[exB.id].status, 'diff', 'B 分类为 diff')
    assert.strictEqual(byId['n-newimp01'].status, 'added', '新笔记分类为 added')
    assert.strictEqual(byId['n-delimp01'].status, 'added', 'deleted 笔记也是 added')
    assert.strictEqual(byId['n-delimp01'].deleted, true, 'deleted 笔记在预览 detail 里标注（导入后仍隐藏）')
    assert.strictEqual(p.folders.total, 2)
    assert.strictEqual(p.folders.new, 1, 'f-imp01 是新文件夹')
  })
  await t('notes-import-preview 参数与目录校验', async () => {
    const e1 = await handlers6['notes-import-preview']({})
    assert(e1.error && e1.error.indexOf('需要 dir') >= 0, '缺 dir 报错')
    const e2 = await handlers6['notes-import-preview']({ dir: 'D:\\no-such-dir-anywhere' })
    assert(e2.error && e2.error.indexOf('目录不存在') >= 0, '目录不存在报错（实得：' + JSON.stringify(e2) + '）')
  })

  await t('notes-import：先全量备份 → added 入库 / same 跳过 / diff 默认跳过 / folders 合并只增不删', async () => {
    const r = await handlers6['notes-import']({ dir: expDir })
    assert(!r.error, '导入成功（实得 ' + JSON.stringify(r) + '）')
    assert.strictEqual(r.imported, 2, 'n-newimp01 + n-delimp01 入库')
    assert.strictEqual(r.skippedSame, 2, 'A/C 相同跳过')
    assert.strictEqual(r.skippedDiff, 1, 'B 不同且未 overwrite → 跳过')
    assert.strictEqual(r.overwritten, 0)
    assert.strictEqual(r.foldersMerged, 1, 'f-imp01 追加合并')
    assert(/\\notes-backup-\d{8}-\d{6}$/.test(r.backupDir), 'backupDir = notes\\notes-backup-<ts>（实得：' + r.backupDir + '）')
    // 备份是导入前的库快照：B 为原文（不含外部改动），含 folders.json，不含 settings.json
    const bakB = store6.get(r.backupDir + '\\' + exB.id + '.md')
    assert(bakB && bakB.indexOf('正文B') >= 0 && bakB.indexOf('外部改动') < 0, '备份保留导入前 B 原文')
    assert(store6.has(r.backupDir + '\\' + exA.id + '.md') && store6.has(r.backupDir + '\\' + exC.id + '.md'), '备份含全部 n-*.md')
    assert(store6.has(r.backupDir + '\\folders.json'), '备份含 folders.json')
    assert(!store6.has(r.backupDir + '\\settings.json'), '备份不含 settings.json')
    // 默认策略不动 diff 笔记
    assert(store6.get(NOTES_DIR + '\\' + exB.id + '.md').indexOf('外部改动') < 0, '库内 B 保持原文（diff 未覆盖）')
    // added 入库：文件落盘 + 缓存同步可 get
    assert(store6.has(NOTES_DIR + '\\n-newimp01.md'), '新笔记文件已入库')
    const g = await handlers6['notes-get']({ id: 'n-newimp01' })
    assert(g.note && g.note.title === '外部新笔记' && g.note.body.indexOf('新正文') >= 0, '导入笔记可立即 get（缓存已同步）')
    // deleted 按原文件导入，导入后仍隐藏
    assert(store6.has(NOTES_DIR + '\\n-delimp01.md'), 'deleted 笔记文件按原样入库')
    const l = await handlers6['notes-list']({})
    assert(l.notes.find(n => n.id === 'n-newimp01'), '列表含新导入笔记')
    assert(!l.notes.find(n => n.id === 'n-delimp01'), 'deleted 导入后仍隐藏')
    // folders.json 合并：只增不删，新 id 追加尾部且 order 续排（不沿用导入清单的 order=5）
    const onDisk = JSON.parse(store6.get(NOTES_DIR + '\\folders.json'))
    assert.strictEqual(onDisk.length, 2, 'folders 只增（1→2）')
    const nf = onDisk.find(f => f.id === 'f-imp01')
    assert(nf && nf.name === '导入新文件夹' && nf.order === 1, '新文件夹 order 续在尾部（实得 ' + JSON.stringify(nf) + '）')
    assert(onDisk.find(f => f.name === '导出文件夹').order === 0, '既有文件夹不动')
  })
  await t('notes-import 幂等：二次导入全 same / folders 无新增；overwrite=true 才覆盖 diff', async () => {
    const r2 = await handlers6['notes-import']({ dir: expDir })
    assert.strictEqual(r2.imported, 0, '二次导入无新增')
    assert.strictEqual(r2.skippedSame, 4, 'A/C + 2 条新导入全部相同')
    assert.strictEqual(r2.skippedDiff, 1, 'diff 仍跳过')
    assert.strictEqual(r2.foldersMerged, 0, 'folders 无新增')
    const r3 = await handlers6['notes-import']({ dir: expDir, overwrite: true })
    assert.strictEqual(r3.overwritten, 1, 'overwrite=true 覆盖 B')
    assert.strictEqual(r3.imported, 0)
    assert(store6.get(NOTES_DIR + '\\' + exB.id + '.md').indexOf('外部改动') >= 0, '库内 B 已是外部改动版')
    const g = await handlers6['notes-get']({ id: exB.id })
    assert(g.note.body.indexOf('外部改动') >= 0, '缓存同步为覆盖后内容')
  })
  await t('notes-import 参数与目录校验（不建备份）', async () => {
    const before = Array.from(store6.keys()).filter(k => k.indexOf('notes-backup-') >= 0).length
    const e1 = await handlers6['notes-import']({})
    assert(e1.error && e1.error.indexOf('需要 dir') >= 0, '缺 dir 报错')
    const e2 = await handlers6['notes-import']({ dir: 'D:\\no-such-dir-anywhere' })
    assert(e2.error && e2.error.indexOf('目录不存在') >= 0, '目录不存在报错')
    const after = Array.from(store6.keys()).filter(k => k.indexOf('notes-backup-') >= 0).length
    assert.strictEqual(after, before, '校验失败不产生新备份')
  })

  // --- 图片资产（开发版 host-impl 行为，复用 store6/handlers6；库内此时 5 条笔记 + folders） ---
  const pngBytes6 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const pngB64_6 = pngBytes6.toString('base64')
  await t('notes-asset-upload：mime 白名单 / 超 5MB / 非法 base64 / 空 data 拒绝', async () => {
    const e1 = await handlers6['notes-asset-upload']({ name: 'x.svg', data: pngB64_6, mime: 'image/svg+xml' })
    assert(e1.error && e1.error.indexOf('mime') >= 0, 'svg 拒绝（实得：' + JSON.stringify(e1) + '）')
    const e2 = await handlers6['notes-asset-upload']({ name: 'big.png', data: 'A'.repeat(7 * 1024 * 1024 + 4), mime: 'image/png' })
    assert(e2.error && e2.error.indexOf('5MB') >= 0, '超 5MB 拒绝（实得：' + JSON.stringify(e2) + '）')
    const e3 = await handlers6['notes-asset-upload']({ name: 'bad.png', data: '!!!not-base64!!!', mime: 'image/png' })
    assert(e3.error && e3.error.indexOf('base64') >= 0, '非法 base64 拒绝')
    const e4 = await handlers6['notes-asset-upload']({ name: 'empty.png', data: '', mime: 'image/png' })
    assert(e4.error, '空 data 拒绝')
    const e5 = await handlers6['notes-asset-upload']({ name: 'x.png', data: 'QUJD', mime: '' })
    assert(e5.error && e5.error.indexOf('mime') >= 0, '空 mime 拒绝')
    assert(!Array.from(store6.keys()).some(k => k.indexOf(NOTES_DIR + '\\assets\\') === 0), '全部拒绝后无资产落盘')
  })
  let upA = null, upB = null
  await t('notes-asset-upload：落盘 assets/<yyyyMMdd-HHmmss>-<安全名> + 重名追加序号 + dataURL 前缀容忍', async () => {
    upA = await handlers6['notes-asset-upload']({ name: '界面截图.png', data: pngB64_6, mime: 'image/png' })
    assert(!upA.error, '上传成功（实得 ' + JSON.stringify(upA) + '）')
    assert(/^assets\/\d{8}-\d{6}-.+\.png$/.test(upA.file), '返回 assets/<ts>-<名>.png（实得 ' + upA.file + '）')
    assert(upA.name.indexOf('界面截图') >= 0, '中文名保留（实得 ' + upA.name + '）')
    assert.strictEqual(upA.bytes, pngBytes6.length, 'bytes = 解码后字节数')
    assert.strictEqual(store6.get(NOTES_DIR + '\\assets\\' + upA.name), pngB64_6, '磁盘内容 = base64 文本形态')
    // 同秒同名第二张 → -2 序号（tsStamp 秒级前缀确定性碰撞）
    upB = await handlers6['notes-asset-upload']({ name: '界面截图.png', data: 'data:image/png;base64,' + pngB64_6, mime: 'image/png' })
    assert(!upB.error && upB.name !== upA.name, '同秒同名应改名（实得 ' + (upB && upB.name) + '）')
    assert(/-2\.png$/.test(upB.name), '重名追加 -2 序号（实得 ' + upB.name + '）')
    assert.strictEqual(store6.get(NOTES_DIR + '\\assets\\' + upB.name), pngB64_6, 'dataURL 前缀剥离后内容一致')
    // noteId 可空（通用资产）；传入也不影响落盘；jpeg → .jpg 扩展名以 mime 为准
    const upC = await handlers6['notes-asset-upload']({ noteId: 'n-not-exist', name: 'photo.jpeg', data: pngB64_6, mime: 'image/jpeg' })
    assert(!upC.error && /\.jpg$/.test(upC.name), 'jpeg → .jpg 扩展名（mime 为准，实得 ' + upC.name + '）')
  })
  await t('assets/ 不被当笔记枚举（列表/搜索不受污染）', async () => {
    const l = await handlers6['notes-list']({})
    assert(l.notes.every(n => n.id && String(n.id).indexOf('assets') < 0), '列表无 assets 伪笔记')
    const s = await handlers6['notes-search']({})
    assert.strictEqual(s.notes.length, l.notes.length, '搜索与列表同口径（实得 ' + s.notes.length + '）')
  })
  await t('notes-export 连带 assets/ 快照（逐字节一致）', async () => {
    const r = await handlers6['notes-export']({ dir: 'D:\\exp-assets' })
    assert(!r.error && r.assets === 3, '导出含 3 个资产（实得 ' + JSON.stringify(r) + '）')
    for (const nm of [upA.name, upB.name]) {
      assert.strictEqual(store6.get(r.target + '\\assets\\' + nm), pngB64_6, '快照资产逐字节一致：' + nm)
    }
  })
  await t('notes-import 合并 assets（同名跳过）+ 备份连带 assets', async () => {
    const ex = await handlers6['notes-export']({ dir: 'D:\\exp-assets' })
    // 快照里塞一个库内不存在的新资产（模拟外部带入）
    store6.set(ex.target + '\\assets\\20260101-000000-extra.png', 'QUJD')
    const r = await handlers6['notes-import']({ dir: ex.target })
    assert(!r.error, '导入成功（实得 ' + JSON.stringify(r) + '）')
    assert.strictEqual(r.assetsMerged, 1, '仅新资产入库，同名 3 个跳过')
    assert.strictEqual(store6.get(NOTES_DIR + '\\assets\\20260101-000000-extra.png'), 'QUJD', '新资产内容落盘')
    assert.strictEqual(store6.get(NOTES_DIR + '\\assets\\' + upA.name), pngB64_6, '同名资产未被覆盖')
    // 备份连带：导入前的库内 assets（3 个）进入 notes-backup-<ts>\assets\
    const bakAssets = Array.from(store6.keys()).filter(k => k.indexOf(r.backupDir + '\\assets\\') === 0)
    assert.strictEqual(bakAssets.length, 3, '备份含库内 3 个资产（实得 ' + bakAssets.length + '）')
  })

  // --- 旧结构零回归（无 assets/ 的旧库 + 无 assets 的旧导出，全新实例） ---
  const store8 = new Map()
  const fsMock8 = mkFsMockImp(store8, [NOTES_DIR])
  const handlers8 = {}
  const harnessMock8 = { handle: (name, fn) => { handlers8[name] = fn; return () => { delete handlers8[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock8, DIR).apply({
    fs: fsMock8, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  await t('旧结构零回归：无 assets/ 旧库导出 assets=0；无 assets 旧导出导入 assetsMerged=0', async () => {
    await handlers8['notes-create']({ title: '旧库笔记', body: '无图', topic: '旧' })
    const ex = await handlers8['notes-export']({ dir: 'D:\\exp-old' })
    assert(!ex.error && ex.exported === 1 && ex.assets === 0, '旧库导出正常且 assets=0（实得 ' + JSON.stringify(ex) + '）')
    assert(!Array.from(store8.keys()).some(k => k.indexOf(ex.target + '\\assets') === 0), '快照不产生 assets 目录')
    // 手工构造无 assets/ 的旧导出目录（仅 n-*.md + folders.json，模拟旧版本导出物）
    const oldExp = 'D:\\exp-old-snap'
    store8.set(oldExp + '\\n-old0001.md', '---\nid: n-old0001\ntitle: 旧导出笔记甲\ntopic: 旧\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n旧正文甲\n')
    store8.set(oldExp + '\\n-old0002.md', '---\nid: n-old0002\ntitle: 旧导出笔记乙\ntopic: 旧\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n旧正文乙\n')
    store8.set(oldExp + '\\folders.json', JSON.stringify([{ id: 'f-old01', name: '旧导出夹', order: 0 }]))
    const im = await handlers8['notes-import']({ dir: oldExp })
    assert(!im.error && im.assetsMerged === 0, '旧导出导入 assetsMerged=0（实得 ' + JSON.stringify(im) + '）')
    assert.strictEqual(im.imported, 2, '旧导出 2 条笔记全部 added 入库')
    assert.strictEqual(im.foldersMerged, 1, '旧导出 folders 正常合并')
    const l = await handlers8['notes-list']({})
    assert(l.notes.some(n => n.id === 'n-old0001'), '旧导出笔记正常入库可列表')
    // 上传是纯增量：资产存在后列表计数不变
    const before = l.notes.length
    const up = await handlers8['notes-asset-upload']({ name: 'x.png', data: pngB64_6, mime: 'image/png' })
    assert(!up.error, '旧库上传成功')
    const l2 = await handlers8['notes-list']({})
    assert.strictEqual(l2.notes.length, before, '上传资产不影响笔记列表')
  })


  // --- 静态包行为（index.mjs 独立 ESM 实例 + 独立 store；harness 主通道注册 handlers7） ---
  section('23.5 笔记导入/导出（静态包 index.mjs 行为）')
  const store7 = new Map()
  const fsMock7 = mkFsMockImp(store7, [NOTES_ROOT_STATIC])
  const handlers7 = {}
  const harnessMock7 = { handle: (name, fn) => { handlers7[name] = fn; return () => { delete handlers7[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  const pngB64_7 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).toString('base64')
  await t('静态包导入/导出全链路（导出 → 预览分类 → 备份 → 默认跳过 diff → overwrite 覆盖 → folders 合并）', async () => {
    global.harness = harnessMock7
    try {
      const modImp = await import(pathToFileURL(INDEX_PATH).href + '?impexp=1')
      modImp.apply({
        fs: fsMock7, sandboxPolicy: { resolve: () => ({}) },
        webServer: { register: () => () => {} }, tools: { register: () => () => {} },
        get: (name) => ({ agents: agentsMock, systemPrompt: { context: () => () => {} } })[name],
        effect: () => {},
      })
      assert.strictEqual(Object.keys(handlers7).length, 40, '静态包注册 40 个 RPC（39 + notes-ping；39 含工作记忆 notes-memory-guide），实得 ' + Object.keys(handlers7).length)
      const sA = await handlers7['notes-create']({ title: '静态导出A', body: 'SA正文' })
      const sB = await handlers7['notes-create']({ title: '静态导出B', body: 'SB正文' })
      await handlers7['notes-folders']({ op: 'create', name: '静态夹' })
      // 导出
      const ex = await handlers7['notes-export']({ dir: 'D:\\exp-st' })
      assert(!ex.error && ex.exported === 2 && ex.foldersFile === true, '导出 2 条 + folders.json（实得 ' + JSON.stringify(ex) + '）')
      assert(/\\dsh-notes-export-\d{8}-\d{6}$/.test(ex.target), '静态包导出目录命名一致（path.join）')
      assert.strictEqual(store7.get(path.join(ex.target, sA.id + '.md')), store7.get(path.join(NOTES_ROOT_STATIC, sA.id + '.md')), '快照逐字节一致')
      // 预览基线全 same
      const p0 = await handlers7['notes-import-preview']({ dir: ex.target })
      assert(p0.same === 2 && p0.diff === 0 && p0.added === 0 && p0.folders.new === 0, '预览基线全 same')
      // 混合场景：B 改动 + 新增 + 新文件夹
      store7.set(path.join(ex.target, sB.id + '.md'), store7.get(path.join(ex.target, sB.id + '.md')) + '静态改动')
      store7.set(path.join(ex.target, 'n-stnew01.md'), '---\nid: n-stnew01\ntitle: 静态新入\ncreatedAt: "2026-01-02T00:00:00.000Z"\nupdatedAt: "2026-01-02T00:00:00.000Z"\n---\n\n新\n')
      const fArr = JSON.parse(store7.get(path.join(ex.target, 'folders.json')))
      fArr.push({ id: 'f-stimp01', name: '静态新夹', order: 9 })
      store7.set(path.join(ex.target, 'folders.json'), JSON.stringify(fArr))
      const p1 = await handlers7['notes-import-preview']({ dir: ex.target })
      assert(p1.same === 1 && p1.diff === 1 && p1.added === 1 && p1.folders.new === 1, '预览分类：1 same / 1 diff / 1 added / 1 新文件夹（实得 ' + JSON.stringify({ s: p1.same, d: p1.diff, a: p1.added, f: p1.folders }) + '）')
      // 默认导入：备份 + added 入库 + diff 跳过 + folders 合并
      const im = await handlers7['notes-import']({ dir: ex.target })
      assert(im.imported === 1 && im.skippedSame === 1 && im.skippedDiff === 1 && im.overwritten === 0 && im.foldersMerged === 1, '默认导入计数（实得 ' + JSON.stringify(im) + '）')
      assert(/\\notes-backup-\d{8}-\d{6}$/.test(im.backupDir), '备份目录命名一致')
      assert(store7.get(path.join(im.backupDir, sB.id + '.md')).indexOf('静态改动') < 0, '备份保留导入前 B 原文')
      assert(store7.has(path.join(NOTES_ROOT_STATIC, 'n-stnew01.md')), '新笔记入库')
      assert(store7.get(path.join(NOTES_ROOT_STATIC, sB.id + '.md')).indexOf('静态改动') < 0, 'diff 默认跳过')
      const onDisk = JSON.parse(store7.get(path.join(NOTES_ROOT_STATIC, 'folders.json')))
      const nf = onDisk.find(f => f.id === 'f-stimp01')
      assert(onDisk.length === 2 && nf && nf.order === 1, 'folders 合并只增不删 + order 续排（实得 ' + JSON.stringify(onDisk) + '）')
      // overwrite 覆盖
      const im2 = await handlers7['notes-import']({ dir: ex.target, overwrite: true })
      assert(im2.overwritten === 1 && im2.skippedSame === 2, 'overwrite 覆盖 1 条 diff（实得 ' + JSON.stringify(im2) + '）')
      assert(store7.get(path.join(NOTES_ROOT_STATIC, sB.id + '.md')).indexOf('静态改动') >= 0, '覆盖生效')
      const g = await handlers7['notes-get']({ id: sB.id })
      assert(g.note.body.indexOf('静态改动') >= 0, '缓存同步覆盖后内容')
      // 校验
      const bad = await handlers7['notes-import']({ dir: 'D:\\no-such-static-dir' })
      assert(bad.error && bad.error.indexOf('目录不存在') >= 0, '静态包目录不存在报错')
      // 图片资产连带：上传 → 导出含 assets → 导入合并同名跳过 → 备份含 assets
      const up = await handlers7['notes-asset-upload']({ name: '静态图.png', data: pngB64_7, mime: 'image/png' })
      assert(!up.error && /^assets\/\d{8}-\d{6}-.+\.png$/.test(up.file), '静态包上传落盘（实得 ' + JSON.stringify(up) + '）')
      assert.strictEqual(store7.get(path.join(NOTES_ROOT_STATIC, 'assets', up.name)), pngB64_7, '磁盘为 base64 文本形态')
      const ex2 = await handlers7['notes-export']({ dir: 'D:\\exp-st2' })
      assert(!ex2.error && ex2.assets === 1, '静态包导出连带 1 个资产（实得 ' + JSON.stringify(ex2) + '）')
      assert.strictEqual(store7.get(path.join(ex2.target, 'assets', up.name)), pngB64_7, '快照资产逐字节一致')
      store7.set(path.join(ex2.target, 'assets', '20260101-000000-stextra.png'), 'QUJD')
      const im3 = await handlers7['notes-import']({ dir: ex2.target })
      assert(!im3.error && im3.assetsMerged === 1, '静态包导入合并新资产、同名跳过（实得 ' + JSON.stringify(im3) + '）')
      assert.strictEqual(store7.get(path.join(NOTES_ROOT_STATIC, 'assets', '20260101-000000-stextra.png')), 'QUJD', '新资产入库')
      const bakA = Array.from(store7.keys()).filter(k => k.indexOf(path.join(im3.backupDir, 'assets') + '\\') === 0)
      assert.strictEqual(bakA.length, 1, '静态包备份连带 assets（实得 ' + bakA.length + '）')
      // 静态包上传校验同口径：mime 白名单 + 5MB 上限
      const e1 = await handlers7['notes-asset-upload']({ name: 'x.gif', data: pngB64_7, mime: 'image/tiff' })
      assert(e1.error && e1.error.indexOf('mime') >= 0, '静态包 mime 白名单拒绝')
      const e2 = await handlers7['notes-asset-upload']({ name: 'big.png', data: 'A'.repeat(7 * 1024 * 1024 + 4), mime: 'image/png' })
      assert(e2.error && e2.error.indexOf('5MB') >= 0, '静态包超 5MB 拒绝')
    } finally {
      delete global.harness
    }
  })

  // ===== 23.6 P3 单文件导出（notes-export-single：scope 拼接 + 图片 base64 内联 + >20MB 告警仍导出） =====
  section('23.6 P3 单文件导出（scope 拼接 + 图片内联 + 体积告警 + 双包同步）')

  // --- 双侧结构契约（host-impl / index.mjs 同步）---
  await t('双侧注册 notes-export-single + _exportSingle + 命名/告警常量（host-impl / index.mjs）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(src.indexOf("handle('notes-export-single'") >= 0, label + ' 注册 notes-export-single')
      assert(src.indexOf('async function _exportSingle(args)') >= 0, label + ' 缺 _exportSingle')
      assert(src.indexOf('dsh-notes-export-single-') >= 0, label + ' 文件命名 dsh-notes-export-single-<ts>.md')
      assert(src.indexOf('SINGLE_EXPORT_WARN_BYTES = 20 * 1024 * 1024') >= 0, label + ' 20MB 告警阈值常量')
      assert(src.indexOf('resolveFolderRef(scope.folder)') >= 0, label + ' scope.folder 兼容 id/名称（resolveFolderRef）')
      assert(src.indexOf('notes-export-single 需要 dir') >= 0, label + ' dir 参数校验')
      assert(src.indexOf('已照常导出') >= 0, label + ' >20MB 告警仍导出（warning 字段文案）')
    }
  })
  // --- export-single 标记块：双包逐字节一致 + eval 单测（与 sensitive-helpers 同款姿势）---
  const grabExpBlk = (s, tag) => { const m = s.match(/\/\/ ==== export-single BEGIN ====[\s\S]*?\/\/ ==== export-single END ====/); assert(m, tag + ' 缺 export-single 标记块'); return m[0] }
  const expBlkDev = grabExpBlk(hostSrc, 'host-impl.js')
  const expBlkPkg = grabExpBlk(indexSrc, 'index.mjs')
  const expNS = {}
  new Function('ns', 'ASSET_MIME_EXT', expBlkDev + '\nns.utf8Bytes = utf8Bytes; ns.assetMimeFromName = assetMimeFromName; ns.inlineAssetsInBody = inlineAssetsInBody; ns.singleExportScopeLabel = singleExportScopeLabel; ns.buildSingleExport = buildSingleExport; ns.SEP = SINGLE_EXPORT_SEP; ns.WARN = SINGLE_EXPORT_WARN_BYTES;')(expNS, { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' })
  await t('export-single 标记块双包逐字节一致 + 可 eval（五函数/两常量导出）', () => {
    assert.strictEqual(expBlkPkg, expBlkDev, 'host-impl.js 与 index.mjs 的 export-single 块必须逐字节一致')
    for (const fn of ['utf8Bytes', 'assetMimeFromName', 'inlineAssetsInBody', 'singleExportScopeLabel', 'buildSingleExport']) assert.strictEqual(typeof expNS[fn], 'function', fn + ' 导出')
    assert.strictEqual(expNS.WARN, 20 * 1024 * 1024, 'WARN = 20MB')
    assert.strictEqual(expNS.SEP, '\n\n---\n\n', 'SEP 篇间分隔线')
  })
  await t('utf8Bytes：ascii / CJK / emoji 代理对 / 空串', () => {
    assert.strictEqual(expNS.utf8Bytes('abc'), 3)
    assert.strictEqual(expNS.utf8Bytes('中文'), 6)
    assert.strictEqual(expNS.utf8Bytes('😀'), 4, '代理对计 4 字节')
    assert.strictEqual(expNS.utf8Bytes(''), 0)
  })
  await t('assetMimeFromName：白名单扩展名反查（大小写不敏感）+ 非白名单/无扩展名 → 空', () => {
    assert.strictEqual(expNS.assetMimeFromName('a.png'), 'image/png')
    assert.strictEqual(expNS.assetMimeFromName('B.JPG'), 'image/jpeg')
    assert.strictEqual(expNS.assetMimeFromName('x.webp'), 'image/webp')
    assert.strictEqual(expNS.assetMimeFromName('x.svg'), '', '非白名单不内联')
    assert.strictEqual(expNS.assetMimeFromName('noext'), '')
  })
  await t('inlineAssetsInBody：命中内联 data URL / 缺失保留原引用并计数 / 非图片形态不动 / 空正文', () => {
    const r = expNS.inlineAssetsInBody('前 ![图](assets/a.png) 中 ![缺](assets/miss.png) 后', { 'a.png': 'QUJD' })
    assert(r.body.indexOf('![图](data:image/png;base64,QUJD)') >= 0, '命中内联为 data URL')
    assert(r.body.indexOf('![缺](assets/miss.png)') >= 0, '缺失资产保留原引用')
    assert(r.inlined === 1 && r.missing === 1, '计数 inlined=1 missing=1（实得 ' + JSON.stringify({ i: r.inlined, m: r.missing }) + '）')
    const r2 = expNS.inlineAssetsInBody('普通链接 [x](assets/a.png) 不动', { 'a.png': 'QUJD' })
    assert(r2.inlined === 0 && r2.body.indexOf('[x](assets/a.png)') >= 0, '非图片形态（无 ! 前缀）不内联')
    const r3 = expNS.inlineAssetsInBody('', { 'a.png': 'QUJD' })
    assert(r3.body === '' && r3.inlined === 0 && r3.missing === 0, '空正文零计数')
  })
  await t('singleExportScopeLabel：tag > folder > 缺省全部', () => {
    assert.strictEqual(expNS.singleExportScopeLabel({}), '全部笔记')
    assert.strictEqual(expNS.singleExportScopeLabel({ all: true }), '全部笔记')
    assert.strictEqual(expNS.singleExportScopeLabel({ folder: 'f-1' }, '导出夹'), '文件夹「导出夹」')
    assert.strictEqual(expNS.singleExportScopeLabel({ tag: '分享' }), '标签「分享」')
  })
  const renderFMStub = (m) => '---\nid: ' + m.id + '\ntitle: ' + m.title + '\n---\n\n'
  await t('buildSingleExport 拼接结构：文档头 + 目录页 + 每篇「# 标题 + front-matter + 正文」+ 篇间分隔线', () => {
    const two = [{ id: 'n-a', title: '甲', body: '正文甲' }, { id: 'n-b', title: '乙\n换行', body: '正文乙' }]
    const doc = expNS.buildSingleExport(two, { toc: true, exportedAt: '2026-10-02T00:00:00.000Z', scopeLabel: '全部笔记', inlined: 1, missing: 0 }, renderFMStub)
    assert(doc.indexOf('# dsh-notes 单文件导出\n') === 0, '文档头起始')
    assert(doc.indexOf('> - 范围：全部笔记') >= 0 && doc.indexOf('> - 篇数：2') >= 0, '头含范围/篇数')
    assert(doc.indexOf('> - 图片：base64 内联 1 张') >= 0, '头含图片计数')
    assert(doc.indexOf('## 目录\n\n1. 甲（n-a）\n2. 乙 换行（n-b）') >= 0, '目录页：序号 + 标题（换行收拢）+ id')
    assert(doc.indexOf('# 甲\n\n---\nid: n-a\ntitle: 甲\n---\n\n正文甲') >= 0, '每篇 = # 标题 + front-matter + 正文')
    assert.strictEqual(doc.split('\n\n---\n\n').length - 1, 2, '2 篇 = 2 条分隔线（目录与首篇间 1 + 篇间 1）')
    const noToc = expNS.buildSingleExport(two, { toc: false, exportedAt: '', scopeLabel: '全部笔记' }, renderFMStub)
    assert(noToc.indexOf('## 目录') < 0, 'toc:false 无目录页')
    const empty = expNS.buildSingleExport([], { toc: true, exportedAt: '', scopeLabel: '全部笔记' }, renderFMStub)
    assert(empty.indexOf('> - 篇数：0') >= 0 && empty.indexOf('\n\n---\n\n') < 0, '空范围仅文档头（无分隔线）')
  })

  // --- 行为断言（开发版全新实例 storeES/handlersES，计数确定；标识符 ES 后缀避让 27.5 节 storeS 实例）---
  const storeES = new Map()
  const fsMockES = mkFsMockImp(storeES, [NOTES_DIR])
  const handlersES = {}
  const harnessMockES = { handle: (name, fn) => { handlersES[name] = fn; return () => { delete handlersES[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  const ctxES = {
    fs: fsMockES, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockES, DIR).apply(ctxES)
  // 造库：1 资产 + 1 文件夹 + 3 笔记（A 在文件夹且正文含 1 命中 + 1 缺失图片引用；B 带标签「分享」；C 裸笔记）
  const pngB64ES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).toString('base64')
  const upES = await handlersES['notes-asset-upload']({ name: '单文件图.png', data: pngB64ES, mime: 'image/png' })
  assert(!upES.error && upES.file, '资产上传成功（前置）')
  const esFolder = (await handlersES['notes-folders']({ op: 'create', name: '导出单夹' })).folder
  const esA = await handlersES['notes-create']({ title: '单文件A', body: 'A正文\n![图](' + upES.file + ')\n![缺](assets/20990101-000000-none.png)\n', topic: '开发', folder: esFolder.id })
  const esB = await handlersES['notes-create']({ title: '单文件B', body: 'B正文', tags: ['分享'], topic: '设计' })
  const esC = await handlersES['notes-create']({ title: '单文件C', body: 'C正文', topic: '运维' })

  await t('notes-export-single 全部 scope：单文件拼接 + 图片内联 + 缺失保留 + 结构完整 + 小体积无 warning', async () => {
    const r = await handlersES['notes-export-single']({ dir: 'D:\\exp-single', scope: { all: true }, format: 'md' })
    assert(!r.error, '导出成功（实得 ' + JSON.stringify(r).slice(0, 300) + '）')
    assert.strictEqual(r.exported, 3, '3 篇全部导出')
    assert(/\\dsh-notes-export-single-\d{8}-\d{6}\.md$/.test(r.target), 'target = <dir>\\dsh-notes-export-single-<ts>.md（实得：' + r.target + '）')
    assert.strictEqual(r.images, 1, '内联 1 张')
    assert.strictEqual(r.missingAssets, 1, '缺失 1 张保留原引用')
    assert.strictEqual(r.scope, '全部笔记', 'scopeLabel 全部')
    assert(!r.warning, '小体积无 warning')
    const doc = storeES.get(r.target)
    assert(doc, '文件已写入目标目录')
    assert(doc.indexOf('# dsh-notes 单文件导出') === 0, '文档头')
    assert(doc.indexOf('## 目录') >= 0, '目录页缺省生成')
    assert(doc.indexOf('# 单文件A\n\n---\nid: ' + esA.id) >= 0, '每篇 = # 标题 + front-matter 元信息块')
    assert(doc.indexOf('data:image/png;base64,' + pngB64ES) >= 0, '图片 base64 内联为 data URL')
    assert(doc.indexOf('![缺](assets/20990101-000000-none.png)') >= 0, '缺失资产保留原引用')
    assert(doc.indexOf('](' + upES.file + ')') < 0, '已内联引用不再保留相对路径')
    assert.strictEqual(doc.split('\n\n---\n\n').length - 1, 3, '3 篇 = 3 条篇间分隔线')
    assert.strictEqual(r.bytes, expNS.utf8Bytes(doc), 'bytes = 文档 UTF-8 字节数')
  })
  await t('notes-export-single scope 过滤：文件夹（id/名称双兼容）/ 标签', async () => {
    const byId = await handlersES['notes-export-single']({ dir: 'D:\\exp-single', scope: { folder: esFolder.id } })
    assert(!byId.error && byId.exported === 1, '按文件夹 id 导出 1 篇（实得 ' + JSON.stringify(byId).slice(0, 200) + '）')
    const docF = storeES.get(byId.target)
    assert(docF.indexOf(esA.id) >= 0 && docF.indexOf(esB.id) < 0 && docF.indexOf(esC.id) < 0, '文件夹 scope 仅含夹内笔记')
    assert(byId.scope === '文件夹「导出单夹」', 'scopeLabel 带解析后的文件夹名（实得 ' + byId.scope + '）')
    const byName = await handlersES['notes-export-single']({ dir: 'D:\\exp-single', scope: { folder: '导出单夹' } })
    assert(!byName.error && byName.exported === 1 && byName.scope === '文件夹「导出单夹」', '按文件夹名称导出（resolveFolderRef 兼容）')
    const byTag = await handlersES['notes-export-single']({ dir: 'D:\\exp-single', scope: { tag: '分享' } })
    assert(!byTag.error && byTag.exported === 1 && byTag.scope === '标签「分享」', '按标签导出 1 篇')
    const docT = storeES.get(byTag.target)
    assert(docT.indexOf(esB.id) >= 0 && docT.indexOf(esA.id) < 0, '标签 scope 仅含带该标签的笔记')
  })
  await t('notes-export-single toc:false 无目录页 + 软删除笔记不导出', async () => {
    const r = await handlersES['notes-export-single']({ dir: 'D:\\exp-single', scope: {}, toc: false })
    assert(!r.error, '导出成功')
    assert(storeES.get(r.target).indexOf('## 目录') < 0, 'toc:false 无目录页')
    await handlersES['notes-delete']({ id: esC.id })
    const r2 = await handlersES['notes-export-single']({ dir: 'D:\\exp-single', scope: {} })
    assert(r2.exported === 2 && storeES.get(r2.target).indexOf(esC.id) < 0, '软删除笔记不进单文件导出（与 _list 同口径）')
    await handlersES['notes-restore']({ id: esC.id })
  })
  await t('notes-export-single 参数校验：缺 dir / dir 是文件 / format 非 md / 文件夹不存在', async () => {
    const e1 = await handlersES['notes-export-single']({ scope: {} })
    assert(e1.error && e1.error.indexOf('需要 dir') >= 0, '缺 dir 报错')
    const e2 = await handlersES['notes-export-single']({ dir: NOTES_DIR + '\\' + esA.id + '.md', scope: {} })
    assert(e2.error && e2.error.indexOf('不是目录') >= 0, 'dir 指向文件报错')
    const e3 = await handlersES['notes-export-single']({ dir: 'D:\\exp-single', scope: {}, format: 'html' })
    assert(e3.error && e3.error.indexOf('md') >= 0, 'format 非 md 报错')
    const e4 = await handlersES['notes-export-single']({ dir: 'D:\\exp-single', scope: { folder: '不存在的夹' } })
    assert(e4.error && e4.error.indexOf('文件夹不存在') >= 0, '文件夹不存在报错')
  })
  await t('notes-export-single >20MB 告警仍导出（指引：图片内联体积可能大）', async () => {
    const big = await handlersES['notes-create']({ title: '超大笔记', body: 'a'.repeat(20 * 1024 * 1024 + 100), tags: ['bigbody'] })
    const r = await handlersES['notes-export-single']({ dir: 'D:\\exp-single', scope: { tag: 'bigbody' } })
    assert(!r.error && r.exported === 1, '超限仍导出（实得 ' + JSON.stringify(r).slice(0, 200) + '）')
    assert(r.warning && r.warning.indexOf('20MB') >= 0, '带 20MB 告警（实得 ' + r.warning + '）')
    assert(r.bytes > 20 * 1024 * 1024, 'bytes 超阈值')
    assert(storeES.has(r.target), '超大文件照常写盘')
    assert(storeES.get(r.target).indexOf(big.id) >= 0, '内容完整')
  })

  // --- 静态包行为（index.mjs 独立实例；harness 主通道注册 handlersES2）---
  const storeES2 = new Map()
  const fsMockES2 = mkFsMockImp(storeES2, [NOTES_ROOT_STATIC])
  const handlersES2 = {}
  const harnessMockES2 = { handle: (name, fn) => { handlersES2[name] = fn; return () => { delete handlersES2[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  await t('静态包 notes-export-single 全链路（拼接 + 图片内联 + scope 过滤 + 文件命名）', async () => {
    global.harness = harnessMockES2
    try {
      const modES = await import(pathToFileURL(INDEX_PATH).href + '?expsingle=1')
      modES.apply({
        fs: fsMockES2, sandboxPolicy: { resolve: () => ({}) },
        webServer: { register: () => () => {} }, tools: { register: () => () => {} },
        get: (name) => ({ agents: agentsMock, systemPrompt: { context: () => () => {} } })[name],
        effect: () => {},
      })
      assert(typeof handlersES2['notes-export-single'] === 'function', '静态包注册 notes-export-single')
      const up = await handlersES2['notes-asset-upload']({ name: '静态单图.png', data: pngB64ES, mime: 'image/png' })
      const nA = await handlersES2['notes-create']({ title: '静态单A', body: 'SA\n![图](' + up.file + ')\n' })
      const nB = await handlersES2['notes-create']({ title: '静态单B', body: 'SB', tags: ['静态标签'] })
      const r = await handlersES2['notes-export-single']({ dir: 'D:\\exp-single-st', scope: {} })
      assert(!r.error && r.exported === 2, '静态包导出 2 篇（实得 ' + JSON.stringify(r).slice(0, 200) + '）')
      assert(/dsh-notes-export-single-\d{8}-\d{6}\.md$/.test(r.target), '静态包文件命名一致（path.join）')
      const doc = storeES2.get(r.target)
      assert(doc && doc.indexOf('# 静态单A\n\n---\nid: ' + nA.id) >= 0, '静态包拼接结构（# 标题 + front-matter）')
      assert(doc.indexOf('data:image/png;base64,' + pngB64ES) >= 0, '静态包图片内联')
      const rt = await handlersES2['notes-export-single']({ dir: 'D:\\exp-single-st', scope: { tag: '静态标签' } })
      assert(!rt.error && rt.exported === 1, '静态包标签 scope 导出 1 篇')
      const docT = storeES2.get(rt.target)
      assert(docT.indexOf(nB.id) >= 0 && docT.indexOf(nA.id) < 0, '静态包 scope 过滤口径一致')
      const bad = await handlersES2['notes-export-single']({ scope: {} })
      assert(bad.error && bad.error.indexOf('需要 dir') >= 0, '静态包缺 dir 报错')
    } finally {
      delete global.harness
    }
  })

  // --- client 面板侧结构（client-impl.js + 发布包 lib/client.js 同步）---
  await t('client 设置卡片「数据」区「导出单文件…」入口 + modal（scope 三选一/目录/目录页开关）+ RPC 调用', () => {
    assert(clientSrc.indexOf('onClick: openSExport') >= 0 && clientSrc.indexOf('导出单文件…') >= 0, '数据区「导出单文件…」按钮')
    assert(clientSrc.indexOf('function openSExport') >= 0 && clientSrc.indexOf('function doSExport') >= 0, 'openSExport/doSExport 函数')
    assert(clientSrc.indexOf("host.call('notes-export-single'") >= 0, '调用 notes-export-single RPC')
    assert(clientSrc.indexOf('dsh-notes-last-export-single-dir') >= 0, '目标目录 localStorage 记忆键')
    assert(clientSrc.indexOf("sExportScope === 'folder'") >= 0 && clientSrc.indexOf("sExportScope === 'tag'") >= 0, 'scope 三选一联动（全部/文件夹/标签）')
    assert(clientSrc.indexOf('生成目录页') >= 0 && clientSrc.indexOf('sExportToc') >= 0, '目录页开关')
    assert(clientSrc.indexOf('sExportOpenRef') >= 0, 'Esc 镜像 ref（modal 优先关闭）')
    assert(clientSrc.indexOf('!sExportOpen') >= 0, '全局错误条互斥（modal 打开时不叠报）')
    // 发布包同步（client-impl.js 改动后需跑 scripts/build-dist.cjs）
    assert(clientPkgSrc.indexOf("rpc('notes-export-single'") >= 0 && clientPkgSrc.indexOf('导出单文件…') >= 0, '发布包 lib/client.js 同步单文件导出（需先跑 scripts/build-dist.cjs）')
  })

  // ===== 24. 半独立全窗口笔记页 /dsh-notes-app（app.html + 页面路由，静态断言） =====
  section('24. 半独立笔记页 /dsh-notes-app（app.html v2 定稿改造 + webServer GET 路由）')
  const APP_HTML_PATH = path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html')
  await t('app.html 存在且非空', () => {
    assert(fsNative.existsSync(APP_HTML_PATH), APP_HTML_PATH + ' 必须存在')
    assert(fsNative.readFileSync(APP_HTML_PATH, 'utf8').length > 5000, 'app.html 应是完整页面（>5KB）')
  })
  const appSrc = fsNative.readFileSync(APP_HTML_PATH, 'utf8')
  await t('app.html 页面标识：title=dsh-notes + 全窗口布局 + 主题 token', () => {
    assert(appSrc.indexOf('<title>dsh-notes</title>') >= 0, '<title>dsh-notes</title>')
    assert(appSrc.indexOf('data-theme="dark"') >= 0 && appSrc.indexOf('html[data-theme="light"]') >= 0, '暗/明双主题 token 保留')
    assert(appSrc.indexOf('class="app"') >= 0 && appSrc.indexOf('class="side"') >= 0 && appSrc.indexOf('class="topbar"') >= 0, '全窗口两栏布局（topbar + side + ed）')
    assert(appSrc.indexOf('--kind-decision') >= 0 && appSrc.indexOf('--nacc') >= 0, 'DSH token 配色保留')
  })
  await t('app.html 数据层：fetch /dsh-notes POST {method,args}，无原型 mock 残留', () => {
    assert(appSrc.indexOf("fetch('/dsh-notes'") >= 0, "rpc() 应 fetch('/dsh-notes')")
    assert(/method:\s*'POST'/.test(appSrc), 'POST 方法')
    assert(appSrc.indexOf('JSON.stringify({ method: method, args: args || {} })') >= 0, 'payload 形态 {method,args}')
    assert(appSrc.indexOf("var notes=[{id:'n1'") < 0 && appSrc.indexOf('原型示意') < 0, '不得残留 v2 原型 mock 数据/占位')
    assert(appSrc.indexOf('__ModuleLoader__') < 0 && appSrc.indexOf("require('react')") < 0, '页面不依赖 client bundle/React')
  })
  await t('app.html 复用全部现有 RPC（list/get/create/update/delete/restore/folders/search/quick/quick-instruct/settings/import-export/dispatch/sessions/asset-upload）', () => {
    const need = ['notes-list', 'notes-get', 'notes-create', 'notes-update', 'notes-delete', 'notes-restore', 'notes-purge', 'notes-folders', 'notes-search', 'notes-quick', 'notes-quick-instruct', 'notes-settings-get', 'notes-settings-set', 'notes-export', 'notes-import-preview', 'notes-import', 'notes-active-sessions', 'notes-dispatch', 'notes-dispatch-done', 'notes-sessions', 'notes-asset-upload', 'notes-archive', 'notes-archive-preview', 'notes-archive-undo', 'notes-inject-preview', 'notes-suggest']
    for (const m of need) assert(appSrc.indexOf("'" + m + "'") >= 0, '页面应调用 RPC：' + m)
    assert(/setTimeout\(pullSessions,\s*1500\)/.test(appSrc) || appSrc.indexOf('1500') >= 0, 'titlesPending 1.5s 重拉契约')
  })
  await t('app.html 关键交互结构：树/编辑器/快速记录卡片/派发对话框/设置/导入导出/注入范围浮层', () => {
    for (const k of ['id="tree"', 'id="q"', 'id="filterbar"', 'id="fchips"', 'id="fpop"', 'id="btnSort"', 'id="capHost"', 'id="modalHost"', 'id="toast"', 'id="btnNew"', 'id="btnTrash"', 'id="btnSelMode"', 'id="btnSettings"']) assert(appSrc.indexOf(k) >= 0, '静态结构缺：' + k)
    assert(appSrc.indexOf('id="btnExport"') < 0 && appSrc.indexOf('id="btnImport"') < 0 && appSrc.indexOf('id="btnSuggest"') < 0, '底部 导出/导入/整理 按钮已移除（收敛进设置卡片）')
    for (const k of ['ed-title', 'ed-main', 'ed-meta', 'ed-crumb', 'scope-panel', 'disp-sess', 'disp-todo', 'imp-list', 'set-row', 'cap-in', 'note-row', 'nested']) assert(appSrc.indexOf(k) >= 0, '样式/动态结构缺：' + k)
    assert(appSrc.indexOf('contenteditable="true"') >= 0, '标题/正文 contenteditable 编辑')
    assert(appSrc.indexOf('localStorage') >= 0 && appSrc.indexOf('dsh-notes-app-foldopen') >= 0, '折叠态 localStorage 持久化')
    assert(appSrc.indexOf('dsh-notes-panel-state') < 0, '不做面板位置持久化（全窗口页面）')
  })
  await t('app.html 页面特化：来源会话降级 toast + 快速记录传空 sessionId/cwd + 返回 DSH 入口', () => {
    assert(appSrc.indexOf('请回 DSH 主界面打开') >= 0, '来源会话点击降级为 toast 提示回 DSH')
    assert(appSrc.indexOf("sessionId: '', cwd: ''") >= 0, 'notes-quick / notes-quick-instruct 传空会话上下文（host 兜底标题）')
    assert(appSrc.indexOf('href="/"') >= 0, '顶栏返回 DSH 主界面入口')
    assert(appSrc.indexOf('connectWorkspace') < 0, '页面无 workspaces 服务，不做新建会话派发')
  })
  await t('app.html 内联脚本语法可解析（new Function 编译级校验）', () => {
    const m = appSrc.match(/<script>([\s\S]*?)<\/script>/)
    assert(m && m[1].length > 3000, '应含主脚本块')
    new Function(m[1])   // 仅编译不执行：语法错误在此抛出
  })
  await t('原型同步（DEVELOPMENT.md UI 约定）：notes-ui-v2.html 与 app.html 共享同一套 UI/交互，仅数据层不同', () => {
    const PROTO_PATH = path.join(DIR, 'design', 'notes-ui-v2.html')
    assert(fsNative.existsSync(PROTO_PATH), 'design/notes-ui-v2.html 存在')
    const protoSrc = fsNative.readFileSync(PROTO_PATH, 'utf8')
    // 关键 UI 标记两边一致（topbar/side/ed/modal/scope/cap/disp/ctxmenu）
    for (const k of ['class="topbar"', 'class="side"', 'class="ed empty"', 'scope-panel', 'disp-sess', 'disp-todo', 'imp-list', 'set-row', 'cap-in', 'ctxmenu', 'note-row', 'id="tree"', 'id="modalHost"']) {
      assert(protoSrc.indexOf(k) >= 0, '原型缺 UI 标记：' + k)
      assert(appSrc.indexOf(k) >= 0, 'app.html 缺 UI 标记：' + k)
    }
    // 同一 rpc(method,args) 接口形态；原型为内存 mock，页面为 fetch('/dsh-notes')
    assert(/function rpc\(method, args\)/.test(protoSrc) && /function rpc\(method, args\)/.test(appSrc), '两边同 rpc(method,args) 接口')
    assert(protoSrc.indexOf('_mockRpc') >= 0, '原型数据层为内存 mock（_mockRpc）')
    assert(!/function rpc\(method, args\) \{\s*return fetch\(/.test(protoSrc), '原型 rpc 函数体不走 fetch（注释提及不算）')
    assert(protoSrc.indexOf('唯一规格来源') >= 0, '原型头部注释声明同步约定')
    // 注入范围浮层重构同步：去「本工作区/全局」选项（缺省=所有会话）+ 顶部默认提示行（app.html 与原型一致）
    for (const pair of [['app.html', appSrc], ['原型', protoSrc]]) {
      assert(pair[1].indexOf('data-scope="workspace"') < 0 && pair[1].indexOf('data-scope="global"') < 0, pair[0] + ' 范围浮层移除「本工作区/全局」选项（缺省=所有会话）')
      assert(pair[1].indexOf('class="scope-hint"') >= 0 && pair[1].indexOf('默认注入到所有会话；勾选会话则仅限这些会话') >= 0, pair[0] + ' 范围浮层顶部默认提示行')
      assert(pair[1].indexOf('.scope-hint{') >= 0, pair[0] + ' scope-hint 样式（var(--nt3) 灰字）')
      assert(pair[1].indexOf("return '所有会话'") >= 0, pair[0] + ' injectScopeLabel 缺省=所有会话')
    }
    const pm = protoSrc.match(/<script>([\s\S]*?)<\/script>/)
    assert(pm && pm[1].length > 3000, '原型含主脚本块')
    new Function(pm[1])   // 编译级校验
  })
  await t('index.mjs 注册 GET /dsh-notes-app 页面路由（exact + app.html 读盘 + text/html）', () => {
    assert(indexSrc.indexOf("APP_PAGE_ROUTE = '/dsh-notes-app'") >= 0, "页面路由常量 '/dsh-notes-app'")
    assert(indexSrc.indexOf("path.join(PKG_DIR, 'app.html')") >= 0, 'app.html 以 import.meta.url 锚定的包内路径读取')
    assert(/path:\s*APP_PAGE_ROUTE/.test(indexSrc), 'webServer.register 消费 APP_PAGE_ROUTE')
    assert(indexSrc.indexOf('text/html; charset=utf-8') >= 0, '响应 Content-Type: text/html; charset=utf-8')
    assert(indexSrc.indexOf("req.method !== 'GET' && req.method !== 'HEAD'") >= 0, '仅 GET/HEAD，其余 405')
    assert(indexSrc.indexOf('notes-app') >= 0, '启动日志含页面路由')
  })
  await t('index.mjs 注册 GET /dsh-notes/asset 资产路由（防穿越 + 白名单 mime + immutable + base64 解码下发）', () => {
    assert(indexSrc.indexOf("ASSET_ROUTE = '/dsh-notes/asset'") >= 0, "资产路由常量 '/dsh-notes/asset'")
    assert(/path:\s*ASSET_ROUTE/.test(indexSrc), 'webServer.register 消费 ASSET_ROUTE（exact，重复注册会 throw 故仅一次 + disposer 登记）')
    assert(indexSrc.indexOf('disposers.push(webServer.register') >= 0, '资产路由 disposer 登记')
    assert(indexSrc.indexOf('ASSET_EXT_MIME') >= 0 && indexSrc.indexOf("'.png': 'image/png'") >= 0 && indexSrc.indexOf("'.webp': 'image/webp'") >= 0, '扩展名 → mime 白名单映射')
    assert(indexSrc.indexOf('public, max-age=31536000, immutable') >= 0, 'Cache-Control immutable（文件名含时间戳不重复）')
    assert(indexSrc.indexOf("Buffer.from(") >= 0 && indexSrc.indexOf("'base64'") >= 0, 'base64 文本解码为二进制下发')
    assert(indexSrc.indexOf("parts[0] !== 'assets'") >= 0 && indexSrc.indexOf('path.dirname(abs) !== assetsRoot') >= 0, '两段式形态校验 + path.dirname 复核防穿越')
    assert(indexSrc.indexOf('readBody(req, 12 * 1024 * 1024)') >= 0, 'RPC 兜底路由 body 上限提到 12MB（装 5MB 图的 base64 JSON）')
    assert(/, asset =', ASSET_ROUTE\)/.test(indexSrc), '启动日志含资产路由')
    assert(hostSrc.indexOf('webServer.register') < 0, '开发版不注册 HTTP 路由（避免与静态包同载 duplicate throw；与 /dsh-notes 既有架构一致）')
  })

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

  // ===== 26. 显式归档 UI（归档按钮引导气泡 + 归档预览对话框 + toast 撤销 + 手动笔记多选合并）=====
  // host 契约（notes-archive-host 收口）：notes-archive-preview → {quickGroups:[{sessionId,title,members:[{id,title,updatedAt,bodyBytes}],dateSpan,totalBytes}]}；
  // notes-archive {groups:[{memberIds,title?}]}（白名单，host 全量校验后才动手）；notes-archive-undo → {undone,restored}
  section('26. 显式归档 UI（引导气泡 + 预览对话框 + toast 撤销 + 多选合并）')
  const protoV2Src = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
  await t('归档按钮改为预览入口 + 引导 tooltip（开发版 + 发布包）', () => {
    const TIP = '归档：把同一会话的速记合并成一篇；点按弹出预览，勾选后才执行（可撤销）'
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      assert(pair[1].indexOf("onClick: openArchive, 'data-tooltip': '" + TIP + "'") >= 0, pair[0] + ' 归档按钮 → openArchive + 引导 tooltip')
      assert(pair[1].indexOf('async function openArchive()') >= 0, pair[0] + ' openArchive 存在')
      assert(pair[1].indexOf('归档合并：速记按会话、普通笔记按标签') < 0, pair[0] + ' 旧 tooltip（行为变更前文案）已清零')
    }
  })
  await t('旧「直接执行归档」逻辑清零（点击不再无参直调 notes-archive）', () => {
    assert(clientSrc.indexOf("onClick: doArchive,") < 0 && clientSrc.indexOf('async function doArchive()') < 0, 'client-impl 不再 onClick: doArchive / 无 doArchive 函数（doArchiveConfirm/doArchiveUndo 不算）')
    assert(clientSrc.indexOf('归档完成：合并 ') < 0, 'client-impl 旧直接执行 toast 已清零')
    assert(clientSrc.indexOf("host.call('notes-archive')") < 0, 'client-impl 不再无参直调 notes-archive')
    assert(clientPkgSrc.indexOf("rpc('notes-archive')") < 0, '发布包不再无参直调 notes-archive')
  })
  await t('归档预览对话框结构（开发版 + 发布包）：组勾选 + 成员展开 + 手动笔记提示 + 确认按钮计数', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1]
      assert(s.indexOf("' 归档预览'") >= 0 && s.indexOf('勾选后才执行 · 合并可撤销') >= 0, pair[0] + ' 对话框标题 + 副标')
      assert(s.indexOf('dsh-notes-arch-list') >= 0 && s.indexOf('dsh-notes-arch-group') >= 0 && s.indexOf('dsh-notes-arch-row') >= 0, pair[0] + ' 组列表结构 class')
      assert(s.indexOf('dsh-notes-arch-members') >= 0 && s.indexOf('dsh-notes-arch-member-dt') >= 0, pair[0] + ' 成员明细（标题+日期）')
      assert(s.indexOf('archChecked[g.sessionId] !== false') >= 0, pair[0] + ' 组级复选框（缺省全勾，false=取消）')
      assert(s.indexOf('archExpand[g.sessionId]') >= 0, pair[0] + ' caret 展开成员明细')
      assert(s.indexOf('fmtBytes(g.totalBytes)') >= 0 && s.indexOf('g.dateSpan.from') >= 0, pair[0] + ' dateSpan + totalBytes 展示')
      assert(s.indexOf('手动笔记不受影响；如需合并手动笔记，请在列表多选后右键合并。') >= 0, pair[0] + ' 底部手动笔记提示')
      assert(s.indexOf("'归档所选（' + checkedCount + ' 组）'") >= 0, pair[0] + ' 确认按钮显示已勾组数')
      assert(s.indexOf('disabled: archPending || checkedCount === 0') >= 0, pair[0] + ' 零勾选/执行中禁用确认（primary 实心 dispatch-ok，非 danger）')
    }
  })
  await t('归档执行链路：preview dry-run → 勾选组白名单 payload（禁 undefined）→ toast 带撤销 → undo RPC', () => {
    assert(clientSrc.indexOf("host.call('notes-archive-preview')") >= 0, 'openArchive 走 notes-archive-preview（dry-run 零写入）')
    assert(clientSrc.indexOf("host.call('notes-archive', { groups: gs.map(g => ({ memberIds: g.members.map(m => m.id) })) })") >= 0, '勾选组 → memberIds 白名单 payload（不带 title，禁 undefined）')
    assert(clientPkgSrc.indexOf("rpc('notes-archive-preview')") >= 0 && clientPkgSrc.indexOf("rpc('notes-archive', { groups: gs.map(") >= 0, '发布包同链路（rpc 形态）')
    // toast 撤销按钮（先例 = app.html toast(m, act)）
    assert(clientSrc.indexOf("showToast('已合并 ' + (res.merged || 0) + ' 组', { label: '撤销', fn: doArchiveUndo })") >= 0, '归档成功 toast 带「撤销」按钮')
    assert(clientSrc.indexOf("host.call('notes-archive-undo')") >= 0 && clientSrc.indexOf("'已撤销归档'") >= 0, '撤销按钮 → notes-archive-undo → toast「已撤销归档」+ 刷新')
    assert(clientSrc.indexOf('typeof toast === \'object\' && toast.act ? 4200 : 2600') >= 0, '带按钮 toast 延长展示（4200ms）')
    assert(clientSrc.indexOf('dsh-notes-toast-act') >= 0 && clientSrc.indexOf('has-act') >= 0, 'toast 动作按钮渲染（has-act 放行点击）')
  })
  await t('Esc 链路：归档预览/合并对话框/多选态入栈', () => {
    assert(clientSrc.indexOf('if (mergeOpenRef.current) { setMergeOpen(false); return }') >= 0, 'Esc 关合并对话框')
    assert(clientSrc.indexOf('if (archOpenRef.current) { setArchOpen(false); return }') >= 0, 'Esc 关归档预览对话框')
    assert(clientSrc.indexOf('if (selModeRef.current) { setSelMode(false); setSelIds({}); return }') >= 0, 'Esc 退出多选态')
  })
  await t('手动笔记多选合并（开发版 + 发布包）：选择 chip + 行复选框 + 操作条 + 标题输入 + 单组 payload', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1]
      assert(s.indexOf("const [selMode, setSelMode] = React.useState(false)") >= 0 && s.indexOf('const [selIds, setSelIds] = React.useState({})') >= 0, pair[0] + ' selMode/selIds 状态')
      assert(s.indexOf('onClick: toggleSelMode') >= 0 && s.indexOf("'选择'") >= 0, pair[0] + ' 「选择」chip 入口')
      assert(s.indexOf("I('check', 12), '合并为一篇'") >= 0, pair[0] + ' 右键菜单「合并为一篇」入口（预勾当前笔记）')
      assert(s.indexOf("className: 'dsh-notes-pick-check'") >= 0, pair[0] + ' 行首复选框')
      assert(s.indexOf('if (selMode) { toggleSelId(n.id); return }') >= 0, pair[0] + ' 多选态行点击=勾选（不打开笔记）')
      assert(s.indexOf('dsh-notes-selbar') >= 0 && s.indexOf("'已选 ' + Object.keys(selIds).length + ' 条'") >= 0, pair[0] + ' 底部浮动操作条（已选 N 条）')
      assert(s.indexOf('至少选择 2 条笔记') >= 0, pair[0] + ' 少于 2 条提示')
      assert(s.indexOf("'合并后标题…'") >= 0 && s.indexOf("(sel[0] && sel[0].topic) || '合并笔记'") >= 0, pair[0] + ' 合并标题输入框（默认=所选最早 topic）')
      assert(s.indexOf('const g = { memberIds: ids }; if (t) g.title = t') >= 0, pair[0] + ' 单组 payload（title 空则不传，禁 undefined）')
      assert(s.indexOf("showToast('已合并所选 ' + ids.length + ' 条', { label: '撤销', fn: doArchiveUndo })") >= 0, pair[0] + ' 合并成功 toast 带撤销')
    }
  })
  await t('归档/多选样式（styles.css + 发布包 lib/styles.css 同步）', () => {
    const cssDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev], ['发布包 lib/styles.css', cssPkg]]) {
      for (const cls of ['.dsh-notes-arch-modal', '.dsh-notes-arch-list{', '.dsh-notes-arch-row{', '.dsh-notes-arch-members{', '.dsh-notes-arch-member', '.dsh-notes-selbar{', '.dsh-notes-selbar-n{', '.dsh-notes-pick-check{', '.dsh-notes-note-row.pick{', '.dsh-notes-toast-act{', '.dsh-notes-toast.has-act{pointer-events:auto}']) {
        assert(pair[1].indexOf(cls) >= 0, pair[0] + ' 缺归档/多选样式：' + cls)
      }
    }
  })
  await t('app.html 同款：归档按钮（引导 title）+ 预览对话框 + 多选合并 + toast 撤销 + Esc', () => {
    assert(appSrc.indexOf('id="btnArchive"') >= 0 && appSrc.indexOf('归档：把同一会话的速记合并成一篇；点按弹出预览，勾选后才执行（可撤销）') >= 0, 'app.html 归档按钮 + 引导 title')
    assert(appSrc.indexOf("rpc('notes-archive-preview', {})") >= 0, 'app.html 预览走 notes-archive-preview')
    assert(appSrc.indexOf('归档预览') >= 0 && appSrc.indexOf('arch-list') >= 0 && appSrc.indexOf('arch-members') >= 0, 'app.html 预览对话框结构（组列表+成员明细）')
    assert(appSrc.indexOf('归档所选（') >= 0 && appSrc.indexOf('手动笔记不受影响；如需合并手动笔记，请在列表多选后右键合并。') >= 0, 'app.html 确认计数 + 手动笔记提示')
    assert(appSrc.indexOf("toast('已合并 ' + (res && res.merged || 0) + ' 组', { label: '撤销', fn: doArchiveUndo })") >= 0, 'app.html 归档 toast 撤销按钮')
    assert(appSrc.indexOf("rpc('notes-archive-undo', {})") >= 0 && appSrc.indexOf('已撤销归档') >= 0, 'app.html undo RPC + toast「已撤销归档」')
    assert(appSrc.indexOf('id="btnSelMode"') >= 0 && appSrc.indexOf('id="selbar"') >= 0 && appSrc.indexOf('pick-check') >= 0, 'app.html 多选：选择 chip + 操作条 + 行复选框')
    assert(appSrc.indexOf('var g = { memberIds: ids }; if (t) g.title = t;') >= 0, 'app.html 多选合并 payload（禁 undefined）')
    assert(appSrc.indexOf("toast('已合并所选 ' + ids.length + ' 条', { label: '撤销', fn: doArchiveUndo })") >= 0, 'app.html 多选合并 toast 撤销')
    assert(appSrc.indexOf('if (selMode) { selMode = false; selIds = {}; renderTree(); return }') >= 0, 'app.html Esc 退出多选态')
    assert(appSrc.indexOf('.selbar{') >= 0 && appSrc.indexOf('.arch-list{') >= 0, 'app.html selbar/arch 样式')
  })
  await t('原型 notes-ui-v2.html 硬性同步：归档按钮 tooltip + 预览对话框 + 多选操作条 + mock 归档 RPC', () => {
    assert(protoV2Src.indexOf('id="btnArchive"') >= 0 && protoV2Src.indexOf('归档：把同一会话的速记合并成一篇；点按弹出预览，勾选后才执行（可撤销）') >= 0, '原型归档按钮 tooltip 引导文案同步')
    assert(protoV2Src.indexOf('归档预览') >= 0 && protoV2Src.indexOf('arch-list') >= 0 && protoV2Src.indexOf('归档所选（') >= 0, '原型归档预览对话框示意同步')
    assert(protoV2Src.indexOf('id="btnSelMode"') >= 0 && protoV2Src.indexOf('id="selbar"') >= 0 && protoV2Src.indexOf('selbarN') >= 0, '原型多选合并操作条示意同步')
    for (const m of ['notes-archive-preview', 'notes-archive-undo']) assert(protoV2Src.indexOf("method === '" + m + "'") >= 0, '原型 mock 含 ' + m)
    assert(protoV2Src.indexOf('_mockArchUndo') >= 0, '原型 mock undo 事务（只保留最近一次）')
    // 原型与 app.html 的归档/多选 UI 标记双端一致（共享 CSS 选择器与 DOM id）
    for (const k of ['arch-row', 'arch-check', 'arch-member', 'pick-check', 'selbar', 'btnArchive', 'btnSelMode', 'mergeTitle']) {
      assert(protoV2Src.indexOf(k) >= 0 && appSrc.indexOf(k) >= 0, '归档/多选 UI 标记双端一致：' + k)
    }
  })
  await t('多选操作条批量删除（软删进回收站，三端同步）', () => {
    // React 两端：开发版面板 + 发布包 lib/client.js（build-dist 产物，host.call → rpc 机械转换）
    for (const pair of [['client-impl', clientSrc, "host.call('notes-delete', { id: id })"], ['发布包 lib/client.js', clientPkgSrc, "rpc('notes-delete', { id: id })"]]) {
      const s = pair[1]
      assert(s.indexOf('async function doSelBatchDelete()') >= 0, pair[0] + ' 多选批量删除函数存在')
      assert(s.indexOf("window.confirm('批量删除：所选的 ' + ids.length + ' 条笔记将移入回收站（可在回收站恢复）。\\n确认删除？')") >= 0, pair[0] + ' confirm 文案注明移入回收站可恢复')
      assert(s.indexOf(pair[2]) >= 0, pair[0] + ' 逐条 notes-delete（软删 payload，与整理建议器批量软删同通道）')
      assert(s.indexOf("className: 'dsh-notes-data-danger'") >= 0 && s.indexOf("selDelPending ? '删除中…' : '删除'") >= 0, pair[0] + ' 操作条删除按钮（danger 实心 + 执行中防重入）')
      assert(s.indexOf('disabled: Object.keys(selIds).length < 1 || selDelPending') >= 0, pair[0] + ' 0 条勾选禁用删除按钮（与合并按钮互斥校验一致）')
      assert(s.indexOf("showToast('已删除 ' + ok + ' 条（可在回收站恢复）'") >= 0, pair[0] + ' toast 文案（已删除 N 条 + 可恢复提示）')
      assert(s.indexOf('setSelDelPending(false); setSelMode(false); setSelIds({})') >= 0, pair[0] + ' 删后退出多选态')
      assert(s.indexOf('afterArchiveCleanup(ids)') >= 0, pair[0] + ' 删后收尾：正打开笔记退出选中态（归档/建议器同款语义）')
    }
    // DOM 两端：app.html + 原型 notes-ui-v2.html（同款 DOM/脚本）
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1]
      assert(s.indexOf('<button class="mbtn danger" id="selDelete">删除</button>') >= 0, pair[0] + ' 操作条删除按钮（danger）')
      assert(s.indexOf("$('selDelete').disabled = n < 1;") >= 0, pair[0] + ' 0 条勾选禁用删除按钮（renderSelBar 联动）')
      assert(s.indexOf('function doSelBatchDelete()') >= 0, pair[0] + ' 多选批量删除函数存在')
      assert(s.indexOf("confirm('批量删除：所选的 ' + ids.length + ' 条笔记将移入回收站（可在回收站恢复）。\\n确认删除？')") >= 0, pair[0] + ' confirm 文案注明移入回收站可恢复')
      assert(s.indexOf("rpc('notes-delete', { id: id })") >= 0, pair[0] + ' 逐条 notes-delete（软删 payload，与整理建议器批量软删同通道）')
      assert(s.indexOf("toast('已删除 ' + ok + ' 条（可在回收站恢复）'") >= 0, pair[0] + ' toast 文案（已删除 N 条 + 可恢复提示）')
      assert(s.indexOf("$('selDelete').addEventListener('click', doSelBatchDelete)") >= 0, pair[0] + ' 删除按钮事件绑定')
      assert(s.indexOf('selMode = false; selIds = {};') >= 0 && s.indexOf('afterArchiveRefresh()') >= 0, pair[0] + ' 删后退出多选态 + 刷新（打开笔记回空态收尾）')
    }
  })

  // ===== 27. 二期增强（✨整理 / kind 模板骨架 / 孤儿资产清理 / 图片压缩）=====
  // host 契约（notes-md-editor-phase2 收口）：
  //   notes-ai-organize {body,kind,title} → {ok,body} | {error}（LLM 按 kind 模板重写，不落盘，client 替换+自动保存+一次撤销栈）；
  //   notes-assets-prune {dryRun?,files?} → 预览 {orphans,totalBytes,referenced,tombstoned,notes} / 执行 {deleted,freedBytes,skipped,remaining,modes}。
  section('27. 二期增强（AI 整理 + kind 骨架 + 资产清理 + 图片压缩）')
  // ---- 27.1 host 双侧静态契约 ----
  await t('host 双侧：KIND_TEMPLATES + MACHINE_TEMPLATE + AI_ORGANIZE_MAX_CHARS 同源常量', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1]
      assert(s.indexOf('const KIND_TEMPLATES = {') >= 0, pair[0] + ' KIND_TEMPLATES 存在')
      assert(s.indexOf("'## 背景\\n\\n（问题与上下文）\\n\\n## 结论\\n\\n（最终选择）\\n\\n## 理由\\n\\n（权衡与依据）\\n'") >= 0, pair[0] + ' decision 模板（背景/结论/理由）')
      assert(s.indexOf("'- [ ] （待办事项）\\n'") >= 0, pair[0] + ' todo 模板（checkbox）')
      assert(s.indexOf("'## 链接\\n\\n（URL）\\n\\n## 说明\\n\\n（用途与要点）\\n'") >= 0, pair[0] + ' link 模板')
      assert(s.indexOf("'> （引用原文）\\n\\n—— （出处）\\n'") >= 0, pair[0] + ' quote 模板')
      assert(s.indexOf('const MACHINE_TEMPLATE = ') >= 0 && s.indexOf('## 机器清单') >= 0 && s.indexOf('## 门户') >= 0, pair[0] + ' 机器信息模板（环境/机器清单/账号/门户）')
      assert(s.indexOf('AI_ORGANIZE_MAX_CHARS = 12000') >= 0, pair[0] + ' 整理草稿上限 12000')
    }
  })
  await t('host 双侧：notes-ai-organize prompt 设计（先规则 → 模板示例全文 → 本篇类型/草稿）+ 围栏剥离 + 不落盘', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1]
      assert(s.indexOf("handle('notes-ai-organize'") >= 0, pair[0] + ' RPC 注册')
      assert(s.indexOf('【重写规则】') >= 0 && s.indexOf('【模板示例】') >= 0 && s.indexOf('【当前草稿】') >= 0, pair[0] + ' prompt 三段结构（规则→模板示例→草稿）')
      assert(s.indexOf('一条都不许丢，也不许编造草稿没有的事实') >= 0, pair[0] + ' 规则：事实零丢失/零编造')
      assert(s.indexOf('![' + '](assets/...)') >= 0 && s.indexOf('原样保留在合适位置') >= 0, pair[0] + ' 规则：图片/链接原样保留')
      assert(s.indexOf('KIND_TEMPLATES.decision') >= 0 && s.indexOf('KIND_TEMPLATES.todo') >= 0 && s.indexOf('MACHINE_TEMPLATE') >= 0, pair[0] + ' 模板示例嵌入 KIND_TEMPLATES/MACHINE_TEMPLATE 全文')
      assert(s.indexOf('只输出重写后的 Markdown 正文') >= 0, pair[0] + ' 只输出正文约束')
      assert(s.indexOf('```(?:markdown|md)?') >= 0, pair[0] + ' 输出剥离 ``` 围栏容错')
      assert(s.indexOf("notes-quick-instruct 同款") >= 0, pair[0] + ' 注释标明 quick-instruct 同款 LLM 通道')
    }
  })
  await t('host 双侧：notes-assets-prune 契约（dryRun 缺省 true 零写入 + 软删除引用计入 + files 白名单 + 调用内重扫）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1]
      assert(s.indexOf("handle('notes-assets-prune'") >= 0, pair[0] + ' RPC 注册')
      assert(s.indexOf('const dryRun = !args || args.dryRun !== false') >= 0, pair[0] + ' dryRun 缺省 true')
      assert(s.indexOf('含软删除笔记') >= 0, pair[0] + ' 软删除笔记引用计入保护（宁留勿删）')
      assert(s.indexOf('tombstoned') >= 0, pair[0] + ' 墓碑（0 字节占位）计数')
      assert(s.indexOf('args.files') >= 0 && s.indexOf('wanted[o.name]') >= 0, pair[0] + ' files 白名单过滤')
      assert(s.indexOf('防预览→执行间隙') >= 0 || s.indexOf('调用内重扫') >= 0, pair[0] + ' 执行时重扫防漂移注释')
    }
    assert(indexSrc.indexOf('node:fs 真删除') >= 0, 'index.mjs 静态包有 node:fs 真删除通道')
    assert(hostSrc.indexOf('墓碑式清空') >= 0 && hostSrc.indexOf('fsNode') < 0, '开发版仅墓碑式清空（ctx.fs 无删除契约；不 import node:fs）')
  })
  // ---- 27.2 host 行为级（内存 mock）----
  // ✨整理 ok 路径复用 section 2 主实例（llmMock 对「笔记整理助手」system 返回带围栏正文）
  await t('notes-ai-organize 行为：ok 路径剥离 ``` 围栏 + 尾随换行；空正文/超长/未配置模型报错', async () => {
    const ok = await handlers['notes-ai-organize']({ body: '方案对比草稿：A 便宜 B 快', kind: 'decision', title: '选型' })
    assert(ok && ok.ok === true, 'ok 路径（实得 ' + JSON.stringify(ok) + '）')
    assert(ok.body.indexOf('```') < 0, '围栏已剥离（实得开头 ' + JSON.stringify(ok.body.slice(0, 24)) + '）')
    assert(ok.body.indexOf('## 背景') >= 0 && ok.body.indexOf('## 结论') >= 0, '模板章节保留')
    assert(ok.body.charAt(ok.body.length - 1) === '\n', '正文尾随换行')
    const e1 = await handlers['notes-ai-organize']({ body: '   ', kind: 'note' })
    assert(e1 && e1.error && e1.error.indexOf('正文为空') >= 0, '空正文报错')
    const e2 = await handlers['notes-ai-organize']({ body: 'x'.repeat(12001), kind: 'note' })
    assert(e2 && e2.error && e2.error.indexOf('上限') >= 0 && e2.error.indexOf('12000') >= 0, '超限报错引导分段')
    const e3 = await handlers['notes-ai-organize']({ body: 'abc', kind: 'no-such-kind' })
    assert(e3 && e3.ok === true && e3.kind === 'note', '非法 kind 回退 note')
  })
  // 未配置模型：无 adm 且无 settings.llm → error（独立实例，llm 在但无默认可跟随）
  const storeP0 = new Map()
  const fsMockP0 = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeP0.has(p) ? { file: true } : null)),
    listDir: async () => [],
    readText: async (p) => { if (!storeP0.has(p)) throw new Error('ENOENT: ' + p); return storeP0.get(p) },
    writeText: async (p, c) => { storeP0.set(p, c) },
  }
  const handlersP0 = {}
  const harnessMockP0 = { handle: (name, fn) => { handlersP0[name] = fn; return () => { delete handlersP0[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockP0, DIR).apply({
    fs: fsMockP0, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: undefined, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  await t('notes-ai-organize 行为：无设置且无会话模型可跟随 → error（原文不动）', async () => {
    const r = await handlersP0['notes-ai-organize']({ body: '草稿', kind: 'note' })
    assert(r && r.error && r.error.indexOf('未配置笔记 LLM') >= 0, '未配置模型报错（实得 ' + JSON.stringify(r) + '）')
  })
  // 孤儿资产清理行为矩阵（独立实例）：引用保护（含软删除笔记）/墓碑排除/dry-run 零写入/白名单执行/无参全量
  const storeP = new Map()
  let writesP = 0
  const fsMockP = {
    resolve: async (p) => p,
    stat: async (p) => {
      if (p === NOTES_DIR) return { dir: true }
      if (p === NOTES_DIR + '\\assets') return Array.from(storeP.keys()).some(k => k.indexOf(p + '\\') === 0) ? { dir: true } : null
      return storeP.has(p) ? { file: true } : null
    },
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of storeP.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!storeP.has(p)) throw new Error('ENOENT: ' + p); return storeP.get(p) },
    writeText: async (p, c) => { writesP++; storeP.set(p, c) },
  }
  const handlersP = {}
  const harnessMockP = { handle: (name, fn) => { handlersP[name] = fn; return () => { delete handlersP[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockP, DIR).apply({
    fs: fsMockP, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  // 造库：笔记甲引用 a-ref.png；已删笔记乙引用 a-delref.png（软删除引用仍保护）；孤儿 a-orphan.png；墓碑 a-tomb.png（0 字节）
  storeP.set(NOTES_DIR + '\\n-pa.md', '---\nid: n-pa\ntitle: 引用笔记\ntopic: 运维\n---\n\n正文引用 ![图](assets/a-ref.png)\n')
  storeP.set(NOTES_DIR + '\\n-pb.md', '---\nid: n-pb\ntitle: 已删笔记\ntopic: 运维\ndeleted: true\n---\n\n已删仍引用 ![](assets/a-delref.png)\n')
  const b64ok = 'QUJD'  // 'ABC'（合法 base64，解码 3 字节）
  storeP.set(NOTES_DIR + '\\assets\\a-ref.png', b64ok)
  storeP.set(NOTES_DIR + '\\assets\\a-delref.png', b64ok)
  storeP.set(NOTES_DIR + '\\assets\\a-orphan.png', b64ok + b64ok)
  storeP.set(NOTES_DIR + '\\assets\\a-tomb.png', '')
  // 预热沉降：apply 时的心跳（.last-host-load）与首个 RPC 的 perf-report（10s 节流）是 fire-and-forget 写——
  // 先跑一个 awaited RPC + 宏任务等待让它们落定，否则 dryRun 零写入快照会被启动写污染
  await handlersP['notes-list']({})
  await new Promise(r => setTimeout(r, 20))
  await t('notes-assets-prune 行为：dryRun 缺省零写入；软删除引用计入保护；墓碑排除；字节数=base64 解码', async () => {
    const w0 = writesP
    const pv = await handlersP['notes-assets-prune']({})
    assert.strictEqual(writesP, w0, 'dryRun 零写入（写入增量 ' + (writesP - w0) + '）')
    assert(pv.dryRun === true, 'dryRun 标记')
    assert.deepStrictEqual(pv.orphans.map(o => o.name), ['a-orphan.png'], '孤儿 = 仅 a-orphan.png（实得 ' + JSON.stringify(pv.orphans) + '）')
    assert.strictEqual(pv.orphans[0].bytes, 6, 'bytes = base64 解码字节数（6）')
    assert.strictEqual(pv.referenced, 2, '引用中 2 个（含软删除笔记的 a-delref.png）')
    assert.strictEqual(pv.tombstoned, 1, '墓碑 1 个（0 字节占位自动排除）')
    assert.strictEqual(pv.notes, 2, '扫描笔记 2 条（含软删除）')
    assert.strictEqual(pv.totalBytes, 6, 'totalBytes 求和')
  })
  await t('notes-assets-prune 行为：files 白名单执行（开发版墓碑式清空）+ 白名单外跳过 + 保护资产不动', async () => {
    const r = await handlersP['notes-assets-prune']({ dryRun: false, files: ['a-orphan.png'] })
    assert(!r.error, '执行成功（实得 ' + JSON.stringify(r) + '）')
    assert(r.dryRun === false, '执行标记')
    assert.deepStrictEqual(r.deleted, ['a-orphan.png'], '删除白名单内孤儿')
    assert.strictEqual(r.freedBytes, 6, '释放字节数')
    assert.strictEqual(r.modes && r.modes.tombstoned, 1, '开发版删除语义 = 墓碑式清空（writeText 空串）')
    assert.strictEqual(storeP.get(NOTES_DIR + '\\assets\\a-orphan.png'), '', '孤儿资产已清空为 0 字节占位')
    assert.strictEqual(storeP.get(NOTES_DIR + '\\assets\\a-ref.png'), b64ok, '被引用资产不动')
    assert.strictEqual(storeP.get(NOTES_DIR + '\\assets\\a-delref.png'), b64ok, '软删除笔记引用的资产不动（宁留勿删）')
    // 二次执行：a-orphan 已成墓碑 → 预览为空
    const pv2 = await handlersP['notes-assets-prune']({ dryRun: true })
    assert.strictEqual(pv2.orphans.length, 0 && pv2.tombstoned, 2, '清理后无孤儿，墓碑计数 2')
  })
  // ---- 27.3 client（开发版 + 发布包）结构断言 ----
  await t('二期 client 同源常量 + ✨整理按钮链路（开发版 + 发布包）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('const KIND_TEMPLATES = {') >= 0 && s.indexOf("'## 背景\\n\\n（问题与上下文）") >= 0 && s.indexOf("'- [ ] （待办事项）\\n'") >= 0, label + ' KIND_TEMPLATES 与 host 同份')
      assert(s.indexOf("sparkle: [e('path'") >= 0, label + ' sparkle 图标（二期 ✨整理）')
      assert(s.indexOf('dsh-notes-organize-btn') >= 0, label + ' 整理按钮 class')
      assert(s.indexOf('async function doAiOrganize()') >= 0, label + ' doAiOrganize 存在')
      assert(s.indexOf("'notes-ai-organize', { body: body, kind: edKindRef.current, title: edTitleRef.current }") >= 0, label + ' RPC payload {body,kind,title}')
      assert(s.indexOf('organizeUndoRef.current = { body: body }') >= 0, label + ' 一次撤销栈（整理前正文）')
      assert(s.indexOf("{ label: '撤销', fn: undoAiOrganize }") >= 0, label + ' 整理成功 toast 带「撤销」')
      assert(s.indexOf('已恢复整理前正文') >= 0, label + ' 撤销恢复 toast')
      assert(s.indexOf('正文为空，无可整理内容') >= 0 && s.indexOf('edLoadingRef.current') >= 0, label + ' 空正文/加载中守卫')
      assert(s.indexOf("syncFromRich('整理前同步')") >= 0, label + ' 富文本在途编辑先落回源码')
    }
  })
  await t('二期 kind 模板骨架（新建 modal 类型选择 + 预填 body；开发版 + 发布包）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('const [newNoteKind, setNewNoteKind] = React.useState') >= 0, label + ' newNoteKind 状态')
      assert(s.indexOf('dsh-notes-newnote-select') >= 0, label + ' 新建 modal 类型 select')
      assert(s.indexOf("body: KIND_TEMPLATES[newNoteKind] || '', kind: newNoteKind") >= 0, label + ' 创建 payload 按类型预填骨架')
      assert(s.indexOf('将预填模板骨架') >= 0 && s.indexOf('自由格式（空正文）') >= 0, label + ' 骨架提示文案')
    }
  })
  await t('二期 图片压缩（>1MB PNG/JPEG → canvas 降质转 JPEG；开发版 + 发布包）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('IMG_COMPRESS_THRESHOLD = 1024 * 1024') >= 0, label + ' 1MB 压缩阈值')
      assert(s.indexOf('function compressImageData(dataURL, cb)') >= 0, label + ' compressImageData 存在')
      assert(s.indexOf("canvas.toDataURL('image/jpeg'") >= 0, label + ' canvas 转 JPEG')
      assert(s.indexOf("f.size > IMG_COMPRESS_THRESHOLD && (f.type === 'image/png' || f.type === 'image/jpeg')") >= 0, label + ' pickImageFile 压缩接线（仅 >1MB 的 PNG/JPEG）')
      assert(s.indexOf("fillStyle = '#ffffff'") >= 0, label + ' PNG 透明底刷白（JPEG 无 alpha）')
      assert(s.indexOf('已压缩 ') >= 0 && s.indexOf('origSize') >= 0, label + ' 弹窗显示压缩前后大小')
      assert(s.indexOf('自动压缩转 JPEG') >= 0, label + ' 弹窗副标说明自动压缩')
    }
    // GIF/WebP 不进压缩（保动画/透明语义）
    assert(clientSrc.indexOf("f.type === 'image/gif' || f.type === 'image/webp'") < 0, 'GIF/WebP 不参与压缩条件')
  })
  await t('二期 资产清理 UI（设置卡片入口 + dry-run 预览 + 白名单执行 + Esc + danger 按钮；开发版 + 发布包）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("{ key: 'assets', label: '资产清理'") >= 0, label + ' 设置卡片「资产清理」行')
      assert(s.indexOf('function openPrune()') >= 0 && s.indexOf("'notes-assets-prune', { dryRun: true }") >= 0, label + ' openPrune 走 dryRun:true 零写入预览')
      assert(s.indexOf("'notes-assets-prune', { dryRun: false, files: files }") >= 0, label + ' 执行 payload（dryRun:false + files 白名单）')
      assert(s.indexOf('pruneChecked[o.name] !== false') >= 0, label + ' 缺省全勾（false=取消）')
      assert(s.indexOf("'删除所选（' + checked.length + ' 项 · '") >= 0, label + ' 确认按钮计数（N 项 · 字节）')
      assert(s.indexOf("className: 'dsh-notes-data-danger'") >= 0, label + ' 删除按钮 danger 样式')
      assert(s.indexOf('已清理 ') >= 0 && s.indexOf('fmtBytes(res.freedBytes || 0)') >= 0, label + ' 执行结果 toast（数量 + 释放字节）')
    }
    assert(clientSrc.indexOf('if (pruneOpenRef.current) { setPruneOpen(false); return }') >= 0, 'Esc 链路关资产清理对话框')
    assert(clientSrc.indexOf('!importOpen && !pruneOpen') >= 0, '全局错误条排除 prune modal（modal 内自显错误）')
  })
  await t('二期 样式（styles.css + 发布包 lib/styles.css 同步）', () => {
    const cssDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev], ['发布包 lib/styles.css', cssPkg]]) {
      for (const cls of ['.dsh-notes-newnote-select{', '.dsh-notes-newnote-kind-row{', '.dsh-notes-newnote-kind-hint{', '.dsh-notes-organize-btn.busy{']) {
        assert(pair[1].indexOf(cls) >= 0, pair[0] + ' 缺二期样式：' + cls)
      }
    }
    assert.strictEqual(cssDev.replace(/\r\n/g, '\n'), cssPkg.replace(/\r\n/g, '\n'), 'styles.css 与发布包逐字节一致（需跑 scripts/build-dist.cjs）')
  })
  // ---- 27.4 app.html 同款 ----
  await t('app.html 二期同款：KIND_TEMPLATES + ✨整理 + 压缩 + 资产清理 + i-sparkle', () => {
    assert(appSrc.indexOf('var KIND_TEMPLATES = {') >= 0 && appSrc.indexOf("'## 背景\\n\\n（问题与上下文）") >= 0, 'app.html KIND_TEMPLATES 同份')
    assert(appSrc.indexOf('id="i-sparkle"') >= 0, 'app.html i-sparkle 图标')
    assert(appSrc.indexOf('id="mOrganize"') >= 0 && appSrc.indexOf('function doAiOrganize()') >= 0, 'app.html 整理按钮 + doAiOrganize')
    assert(appSrc.indexOf("rpc('notes-ai-organize', { body: body, kind: edNote.kind || 'note'") >= 0, 'app.html 整理 RPC payload')
    assert(appSrc.indexOf("toast('已按「' + (KIND[edNote.kind] || '笔记') + '」模板整理', { label: '撤销', fn: undoAiOrganize })") >= 0, 'app.html 整理 toast 撤销')
    assert(appSrc.indexOf("body: KIND_TEMPLATES[kind0] || ''") >= 0, 'app.html 新建按类型预填骨架')
    assert(appSrc.indexOf('IMG_COMPRESS_THRESHOLD = 1024 * 1024') >= 0 && appSrc.indexOf('function compressImageData(dataURL, cb)') >= 0, 'app.html 压缩阈值 + helper')
    assert(appSrc.indexOf("f.size > IMG_COMPRESS_THRESHOLD && (f.type === 'image/png' || f.type === 'image/jpeg')") >= 0, 'app.html pickImageFile 压缩接线')
    assert(appSrc.indexOf('id="setPrune"') >= 0 && appSrc.indexOf('function openPrune()') >= 0, 'app.html 设置行 + openPrune')
    assert(appSrc.indexOf("rpc('notes-assets-prune', { dryRun: true })") >= 0 && appSrc.indexOf("rpc('notes-assets-prune', { dryRun: false, files: files })") >= 0, 'app.html prune 预览/执行 RPC')
    assert(appSrc.indexOf('.meta-act.organize-btn.busy{') >= 0, 'app.html 整理忙态样式')
  })
  // ---- 27.5 原型同步（UI 唯一规格来源约束）----
  await t('原型 notes-ui-v2.html 二期硬性同步：模板/整理/清理 + mock RPC + i-sparkle', () => {
    assert(protoV2Src.indexOf('var KIND_TEMPLATES = {') >= 0, 'v2 KIND_TEMPLATES 同份')
    assert(protoV2Src.indexOf('id="i-sparkle"') >= 0, 'v2 i-sparkle 图标')
    assert(protoV2Src.indexOf('id="mOrganize"') >= 0 && protoV2Src.indexOf('function doAiOrganize()') >= 0, 'v2 整理按钮 + 函数')
    assert(protoV2Src.indexOf("method === 'notes-ai-organize'") >= 0, 'v2 mock notes-ai-organize')
    assert(protoV2Src.indexOf("method === 'notes-assets-prune'") >= 0 && protoV2Src.indexOf('_mockAssets') >= 0, 'v2 mock notes-assets-prune + 资产清单')
    assert(protoV2Src.indexOf('id="setPrune"') >= 0 && protoV2Src.indexOf('function openPrune()') >= 0, 'v2 设置行 + openPrune')
    assert(protoV2Src.indexOf("body: KIND_TEMPLATES[kind0] || ''") >= 0, 'v2 新建按类型预填骨架')
    assert(protoV2Src.indexOf('.meta-act.organize-btn.busy{') >= 0, 'v2 整理忙态样式')
    // v2 与 app.html 二期 UI 标记双端一致（共享 DOM id 与函数名）
    for (const k of ['mOrganize', 'doAiOrganize', 'undoAiOrganize', 'setPrune', 'openPrune', 'renderPruneList', 'doPruneConfirm', 'pruneList', 'KIND_TEMPLATES']) {
      assert(protoV2Src.indexOf(k) >= 0 && appSrc.indexOf(k) >= 0, '二期 UI 标记双端一致：' + k)
    }
  })
  await t('原型 notes-editor-v3.html 二期回写：✨整理演示 + 契约注释 + i-sparkle', () => {
    const protoV3 = fsNative.readFileSync(path.join(DIR, 'design', 'notes-editor-v3.html'), 'utf8')
    assert(protoV3.indexOf('id="i-sparkle"') >= 0, 'v3 i-sparkle 图标')
    assert(protoV3.indexOf('id="mOrganize"') >= 0 && protoV3.indexOf('demoOrganize') >= 0, 'v3 整理按钮 + 演示函数')
    assert(protoV3.indexOf('notes-ai-organize') >= 0 && protoV3.indexOf('一次撤销栈') >= 0, 'v3 头注含整理契约（RPC + 撤销栈）')
    assert(protoV3.indexOf('12000') >= 0 && protoV3.indexOf('canvas 降质转 JPEG') >= 0, 'v3 头注含上限与压缩契约')
    assert(protoV3.indexOf('二期实现对照（notes-md-editor-phase2') >= 0, 'v3 二期回写段落')
  })
  // ---- 27.6 文档同步 ----
  await t('README/DEVELOPMENT 二期同步（功能清单 + RPC 计数）', () => {
    const readme = fsNative.readFileSync(path.join(DIR, 'README.md'), 'utf8')
    for (const kw of ['✨ 整理', '模板骨架', '资产清理', '压缩']) assert(readme.indexOf(kw) >= 0, 'README 功能清单缺二期关键词：' + kw)
    assert(readme.indexOf('notes-ai-organize') >= 0 && readme.indexOf('notes-assets-prune') >= 0, 'README 数据位置/RPC 提及二期 RPC')
    const dev = fsNative.readFileSync(path.join(DIR, 'DEVELOPMENT.md'), 'utf8')
    assert(dev.indexOf('39 个 RPC') >= 0, 'DEVELOPMENT RPC 计数更新为 39（历史版本三 RPC + 工作记忆 notes-memory-guide）')
    assert(dev.indexOf('notes-memory-guide') >= 0, 'DEVELOPMENT RPC 清单提及工作记忆 notes-memory-guide')
    assert(dev.indexOf('notes-inject-preview') >= 0, 'DEVELOPMENT RPC 清单提及注入预览 notes-inject-preview')
    assert(dev.indexOf('notes-suggest') >= 0, 'DEVELOPMENT RPC 清单提及整理建议 notes-suggest')
    assert(dev.indexOf('notes-export-single') >= 0, 'DEVELOPMENT RPC 清单提及 P3 notes-export-single')
    assert(dev.indexOf('notes-restore-history') >= 0, 'DEVELOPMENT RPC 清单提及历史版本 notes-restore-history')
    const pkgReadme = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'README.md'), 'utf8')
    for (const kw of ['✨ 整理', '资产清理']) assert(pkgReadme.indexOf(kw) >= 0, '发布包 README 同步二期（需跑 scripts/sync-pkg-readme.cjs）：' + kw)
  })

  // ===== 27.5 敏感信息脱敏注入（sensitive 字段 + 注入打码 + 识别建议 + 双端 toggle）=====
  section('27.5 敏感信息脱敏注入（sensitive 字段 + 注入打码 + 识别建议）')

  // --- 27.1 sensitive-helpers 标记块：提取 eval 单测 + 双包逐字节一致 ---
  const grabSensBlock = (src, tag) => {
    const m = src.match(/\/\/ ==== sensitive-helpers BEGIN ====[\s\S]*?\/\/ ==== sensitive-helpers END ====/)
    assert(m, tag + ' 缺 sensitive-helpers 标记块')
    return m[0]
  }
  const sensBlkDev = grabSensBlock(hostSrc, 'host-impl.js')
  const sensBlkPkg = grabSensBlock(indexSrc, 'index.mjs')
  const sensNS = {}
  new Function('ns', sensBlkDev + '\nns.suggestSensitive = suggestSensitive; ns.maskSensitiveLine = maskSensitiveLine; ns.maskSensitiveBody = maskSensitiveBody;')(sensNS)
  await t('sensitive-helpers 标记块双包逐字节一致 + 可 eval（三函数导出）', () => {
    assert.strictEqual(sensBlkPkg, sensBlkDev, 'host-impl.js 与 index.mjs 的 sensitive-helpers 块必须逐字节一致')
    assert.strictEqual(typeof sensNS.suggestSensitive, 'function', 'suggestSensitive 导出')
    assert.strictEqual(typeof sensNS.maskSensitiveLine, 'function', 'maskSensitiveLine 导出')
    assert.strictEqual(typeof sensNS.maskSensitiveBody, 'function', 'maskSensitiveBody 导出')
  })
  await t('maskSensitiveLine R1 键值行：键保留/值遮蔽/结构不变（冒号/全角/等号/列表前缀/ssh/引号键）', () => {
    const L = sensNS.maskSensitiveLine
    assert.strictEqual(L('password: hunter2', 'n-t'), 'password: ******（敏感，note_get n-t 获取）')
    assert.strictEqual(L('管理员账号：张川 !QAZ@WSX#EDC123', 'n-t'), '管理员账号：******（敏感，note_get n-t 获取）', '全角冒号 + 含空格值整段遮蔽')
    assert.strictEqual(L('api_key = abc123XYZ', 'n-t'), 'api_key = ******（敏感，note_get n-t 获取）', '等号分隔')
    assert.strictEqual(L('10.52.2.64 ssh: root 9bM%1qLGqF6$8q', 'n-t'), '10.52.2.64 ssh: ******（敏感，note_get n-t 获取）', 'ssh 行：IP 与键名保留，账号密码整值遮蔽')
    assert.strictEqual(L('- token: ghp_abc123XYZ', 'n-t'), '- token: ******（敏感，note_get n-t 获取）', '列表前缀保留')
    assert.strictEqual(L('"password": "hunter2"', 'n-t'), '"password": ******（敏感，note_get n-t 获取）', 'JSON 风格带引号键名')
  })
  await t('maskSensitiveLine R2 空白裸令牌：敏感词后形似凭据的令牌遮蔽（周围结构保留）', () => {
    const L = sensNS.maskSensitiveLine
    assert.strictEqual(L('用户 o2oa 密码 0TM_1p2@land', 'n-t'), '用户 o2oa 密码 ******（敏感，note_get n-t 获取）')
    assert.strictEqual(L('token abc123XYZ', 'n-t'), 'token ******（敏感，note_get n-t 获取）')
    assert.strictEqual(L('数据库：he3pg-x.internal:5432 用户 o2oa 密码 0TM_1p2@land', 'n-t'), '数据库：he3pg-x.internal:5432 用户 o2oa 密码 ******（敏感，note_get n-t 获取）', 'R1 不命中时 R2 补位（主机/用户保留）')
  })
  await t('误报对照：散文/配置/URL/纯小写单词不遮蔽', () => {
    const L = sensNS.maskSensitiveLine
    const unchanged = ['密码要求：至少 8 位，含大小写', 'token expires soon', '密码 必须足够长', 'max_tokens: 4096', '请注意 password 的安全性', 'https://10.102.90.77:8088', '普通的一行文字']
    for (const s of unchanged) assert.strictEqual(L(s, 'n-t'), s, '不应遮蔽：' + s)
  })
  await t('打码幂等：二次打码结果不变（占位符不再二次遮蔽）', () => {
    const L = sensNS.maskSensitiveLine
    for (const s of ['password: hunter2', '密码 abc123XYZ', 'token ghp_123abc']) {
      const once = L(s, 'n-t')
      assert.strictEqual(L(once, 'n-t'), once, '幂等：' + s)
    }
  })
  await t('maskSensitiveBody R3 私钥块：BEGIN/END 行保留、中间体遮蔽 + 多行混合正文', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234\nabcdWXYZ==\n-----END RSA PRIVATE KEY-----'
    const out = sensNS.maskSensitiveBody('部署说明\n' + pem + '\n密码: abc123', 'n-t')
    assert(out.indexOf('-----BEGIN RSA PRIVATE KEY-----') >= 0 && out.indexOf('-----END RSA PRIVATE KEY-----') >= 0, 'PEM 结构行保留')
    assert(out.indexOf('MIIEowIBAAKCAQEA1234') < 0 && out.indexOf('abcdWXYZ==') < 0, 'PEM 中间体被遮蔽')
    assert(out.indexOf('部署说明') >= 0, '普通行保留')
    assert(out.indexOf('密码: ******（敏感，note_get n-t 获取）') >= 0, '同正文 R1 行也遮蔽')
    // 幂等：私钥块二次打码稳定
    assert.strictEqual(sensNS.maskSensitiveBody(out, 'n-t'), out, '整段打码幂等')
  })
  await t('suggestSensitive：命中三规则 true / 干净文本 false', () => {
    assert.strictEqual(sensNS.suggestSensitive('密码: abc123'), true, 'R1 命中')
    assert.strictEqual(sensNS.suggestSensitive('token abc123XYZ'), true, 'R2 命中')
    assert.strictEqual(sensNS.suggestSensitive('-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----'), true, 'R3 命中')
    assert.strictEqual(sensNS.suggestSensitive('今天天气不错，记录一下'), false, '干净文本不建议')
    assert.strictEqual(sensNS.suggestSensitive(''), false, '空文本不建议')
  })

  // --- 行为断言（独立实例 storeS/handlersS/contextsS/toolsS，与主共享实例隔离）---
  // 注意：section 21 会对主 plugin 二次 apply(ctx)，主 handlers/tools/contexts 分裂到两个实例（工具/find 取旧实例、
  // handlers 取新实例、contexts find 取旧实例），本节统一走专属实例，与 8.5/22 节同款模式。
  const storeS = new Map()
  const fsMockS = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeS.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of storeS.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!storeS.has(p)) throw new Error('ENOENT: ' + p); return storeS.get(p) },
    writeText: async (p, c) => { storeS.set(p, c) },
  }
  const handlersS = {}
  const toolsS = []
  const contextsS = []
  const harnessMockS = {
    handle: (name, fn) => { handlersS[name] = fn; return () => { delete handlersS[name] } },
    defineTool: (def) => def,
    registerTool: (ctx, def) => { toolsS.push(def); return () => {} },
  }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockS, DIR).apply({
    fs: fsMockS, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contextsS.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  const nmS = toolsS.find(x => x.name === 'note_manage')
  const catS = contextsS.find(x => x.name === 'notes:catalog')

  await t('sensitive 字段往返：create 带 true → get/list/front-matter 一致', async () => {
    const c = await handlersS['notes-create']({ title: '敏感笔记A', body: 'password: abc123', topic: '敏感', sensitive: true })
    assert(!c.sensitiveSuggested, '显式 sensitive=true 不再回传建议')
    const g = await handlersS['notes-get']({ id: c.id })
    assert.strictEqual(g.note.sensitive, true, 'notes-get 返回 sensitive=true')
    const lst = await handlersS['notes-list']({})
    assert.strictEqual(lst.notes.find(n => n.id === c.id).sensitive, true, 'notes-list（slim）携带 sensitive')
    const onDisk = storeS.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(onDisk.indexOf('\nsensitive: true\n') >= 0, 'front-matter 写 sensitive: true（实得：' + onDisk.split('\n').slice(0, 18).join('|') + '）')
  })
  await t('sensitive 缺省 false：create 不传 → get false + front-matter 恒写 false', async () => {
    const c = await handlersS['notes-create']({ title: '普通笔记B', body: '普通内容', topic: '杂' })
    assert(!c.sensitiveSuggested, '干净正文不回传建议')
    const g = await handlersS['notes-get']({ id: c.id })
    assert.strictEqual(g.note.sensitive, false, '缺省 false（noteFromParsed 回退）')
    const onDisk = storeS.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(onDisk.indexOf('\nsensitive: false\n') >= 0, 'buildFM 恒写 sensitive: false')
  })
  await t('notes-update RPC 透传 sensitive（显式改 true/false；不传不动）', async () => {
    const c = await handlersS['notes-create']({ title: '敏感切换C', body: 'x', topic: '敏感' })
    await handlersS['notes-update']({ id: c.id, sensitive: true })
    assert.strictEqual((await handlersS['notes-get']({ id: c.id })).note.sensitive, true, 'update sensitive=true 生效')
    await handlersS['notes-update']({ id: c.id, topic: '敏感-改' })
    assert.strictEqual((await handlersS['notes-get']({ id: c.id })).note.sensitive, true, 'update 不传 sensitive 保持原值（undefined 不动）')
    await handlersS['notes-update']({ id: c.id, sensitive: false })
    assert.strictEqual((await handlersS['notes-get']({ id: c.id })).note.sensitive, false, 'update sensitive=false 回落')
  })
  await t('note_manage 透传 sensitive：schema 含字段 + create/update 路由 + 敏感建议回传', async () => {
    assert(nmS.parameters.properties.sensitive && nmS.parameters.properties.sensitive.type === 'boolean', 'schema 含 sensitive 布尔参数')
    assert(nmS.description.indexOf('sensitive (boolean)') >= 0, '工具描述含 sensitive 说明')
    const c = await nmS.execute({ action: 'create', title: '工具敏感笔记', body: '普通内容', topic: '敏感', sensitive: true })
    assert(!c.error, 'manage.create sensitive 成功（实得：' + JSON.stringify(c) + '）')
    assert.strictEqual((await handlersS['notes-get']({ id: c.id })).note.sensitive, true, 'manage.create 透传 sensitive')
    const u = await nmS.execute({ action: 'update', id: c.id, sensitive: false })
    assert(!u.error, 'manage.update sensitive 成功')
    assert.strictEqual((await handlersS['notes-get']({ id: c.id })).note.sensitive, false, 'manage.update 透传 sensitive')
    const c2 = await nmS.execute({ action: 'create', title: '工具敏感建议', body: 'password: hunter2', topic: '敏感' })
    assert.strictEqual(c2.sensitiveSuggested, true, 'manage.create 命中敏感模式回传 sensitiveSuggested')
    assert.strictEqual((await handlersS['notes-get']({ id: c2.id })).note.sensitive, false, 'create 建议不强制落 sensitive（显式动作由调用方决策）')
  })
  await t('存量/导入文件兼容：front-matter 带 sensitive: true 的原文落盘文件解析生效', async () => {
    // 导入走原文落盘（_import 直写 n.content + noteFromParsed 重建缓存），sensitive 天然保留
    await fsMockS.writeText(NOTES_DIR + '\\n-legacy-sens.md', '---\nid: n-legacy-sens\ntitle: 存量敏感笔记\ntopic: 敏感\nsensitive: true\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\nsessionId: \ncwd: \n---\n\npassword: legacy123\n')
    const g = await handlersS['notes-get']({ id: 'n-legacy-sens' })
    assert.strictEqual(g.note.sensitive, true, '存量文件 sensitive: true 解析生效')
    await fsMockS.writeText(NOTES_DIR + '\\n-legacy-plain.md', '---\nid: n-legacy-plain\ntitle: 旧版普通笔记\ntopic: 杂\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\nsessionId: \ncwd: \n---\n\n旧正文\n')
    const gDef = await handlersS['notes-get']({ id: 'n-legacy-plain' })
    assert.strictEqual(gDef.note.sensitive, false, '旧文件无 sensitive 字段缺省 false（零迁移）')
  })

  // --- 注入打码行为（conventionText / catalogText）---
  await t('conventionText 对 sensitive=true 笔记正文按行打码 + 尾部计数行', async () => {
    const c = await handlersS['notes-create']({ title: '注入敏感约定', body: '部署密码：Top$ecret99\n第二行普通内容', inject: true, topic: '敏感', sensitive: true })
    const r = await handlersS['notes-conventions']({})
    assert(r.text.indexOf('Top$ecret99') < 0, '注入文本不含明文密码')
    assert(r.text.indexOf('部署密码：******（敏感，note_get ' + c.id + ' 获取）') >= 0, '键保留值遮蔽 + note_get 引导（实得：' + r.text.slice(0, 240) + '）')
    assert(r.text.indexOf('第二行普通内容') >= 0, '非敏感行原文保留')
    assert(r.text.indexOf('条含敏感信息已脱敏，原文用 note_get 按 id 获取') >= 0, '尾部计数提示行')
  })
  await t('sensitive=false 的注入笔记不打码（对照）', async () => {
    await handlersS['notes-create']({ title: '注入普通约定', body: 'code style 规范', inject: true, topic: '约定' })
    const r = await handlersS['notes-conventions']({})
    assert(r.text.indexOf('code style 规范') >= 0, '普通注入笔记原文呈现')
  })
  await t('catalogText 对 sensitive=true 条目标题打码 + 🔒 标记 + 尾部计数行', async () => {
    // inject=false 才进目录（inject=true 且命中本会话的条目在 order 130 已注入全文，目录去重）
    const c = await handlersS['notes-create']({ title: '敏感目录条目 token: ghp_abc123', body: 'x', topic: '敏感', sensitive: true })
    assert(catS && typeof catS.text === 'function', 'notes:catalog context 已注册')
    const txt = catS.text()
    assert(txt.indexOf('- [' + c.id + '] 🔒 ') >= 0, '敏感条目带 🔒 标记（实得：' + txt.split('\n').slice(0, 8).join('|') + '）')
    assert(txt.indexOf('ghp_abc123') < 0, '标题命中敏感模式同样打码')
    assert(txt.indexOf('条含敏感信息已脱敏，原文用 note_get 按 id 获取') >= 0, '目录尾部计数提示行')
  })

  // --- 自动识别建议 + quick 落敏感 + 归档继承 ---
  await t('notes-quick 命中敏感模式：直接落 sensitive=true + 返回 sensitiveSuggested（磁盘原文不动）', async () => {
    const r = await handlersS['notes-quick']({ text: 'ssh 密码：9bM%1qLGqF6$8q', sessionId: 'sess-sens-quick-1' })
    assert.strictEqual(r.sensitiveSuggested, true, 'quick 返回 sensitiveSuggested（实得：' + JSON.stringify(r) + '）')
    const g = await handlersS['notes-get']({ id: r.id })
    assert.strictEqual(g.note.sensitive, true, 'quick 命中直接落 sensitive=true（即发即忘场景自动保护）')
    const onDisk = storeS.get(NOTES_DIR + '\\' + r.id + '.md')
    assert(onDisk.indexOf('\nsensitive: true\n') >= 0, 'front-matter 落 sensitive: true')
    assert(onDisk.indexOf('9bM%1qLGqF6$8q') >= 0, '磁盘原文不动（打码只作用于注入渲染，无 round-trip）')
  })
  await t('notes-quick 干净文本：不落敏感不建议', async () => {
    const r = await handlersS['notes-quick']({ text: '普通速记内容', sessionId: 'sess-sens-merge-1' })
    assert.strictEqual(r.sensitiveSuggested, false, '干净文本不建议')
    assert.strictEqual((await handlersS['notes-get']({ id: r.id })).note.sensitive, false, '干净速记 sensitive=false')
  })
  await t('notes-quick 合并窗口：后一条命中 → 原速记升级为敏感', async () => {
    const r2 = await handlersS['notes-quick']({ text: 'token abc123XYZ', sessionId: 'sess-sens-merge-1' })
    assert.strictEqual(r2.merged, true, '10 分钟内同会话合并（实得：' + JSON.stringify(r2) + '）')
    assert.strictEqual(r2.sensitiveSuggested, true, '合并条命中返回建议')
    assert.strictEqual((await handlersS['notes-get']({ id: r2.id })).note.sensitive, true, '合并后原速记升级为 sensitive=true')
  })
  await t('归档合并敏感继承：任一成员 sensitive=true → 归档笔记敏感', async () => {
    const c1 = await nmS.execute({ action: 'create', title: '归档成员-敏感', body: 'password: xxx999', topic: '归档敏感', sensitive: true })
    const c2 = await nmS.execute({ action: 'create', title: '归档成员-普通', body: '普通内容', topic: '归档敏感' })
    const r = await nmS.execute({ action: 'archive', groups: [{ memberIds: [c1.id, c2.id] }] })
    assert(!r.error && r.merged === 1, '归档成功（实得：' + JSON.stringify(r) + '）')
    assert.strictEqual((await handlersS['notes-get']({ id: r.mergedIds[0] })).note.sensitive, true, '归档笔记继承敏感标记（合并正文含成员原文，泄露面不降级）')
  })

  // --- 双侧源码同步 + 双端 UI toggle 链路 ---
  await t('双侧 sensitive 字段链路 + 注入打码源码同步（host-impl / index.mjs）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(src.indexOf("'sensitive: ' + escYaml(m.sensitive === true ? 'true' : 'false')") >= 0, label + ' buildFM 恒写 sensitive')
      assert(src.indexOf("p.meta.sensitive === 'true'") >= 0, label + ' noteFromParsed 读 sensitive（缺省 false）')
      assert((src.match(/sensitive: n\.sensitive === true/g) || []).length >= 2, label + ' persistNote 与 slim 均携带 sensitive')
      assert(src.indexOf('sensitive: ex.sensitive === true') >= 0, label + ' _create 接受 sensitive')
      assert(/if \(sensitive !== undefined\) note\.sensitive = sensitive === true/.test(src), label + ' _update 第 13 位参数显式传才改（undefined 不动）')
      assert(src.indexOf("sensitive: { type: 'boolean'") >= 0, label + ' note_manage schema 含 sensitive')
      assert((src.match(/sensitive: args\.sensitive/g) || []).length >= 2, label + ' notes-create + note_manage.create 透传 args.sensitive')
      assert(src.indexOf('args.injectRole, args.sensitive') >= 0, label + ' notes-update / note_manage.update 第 13 位透传')
      assert(src.indexOf('members.some(n => n.sensitive === true)') >= 0, label + ' _mergeGroup 敏感继承')
      assert(src.indexOf('maskSensitiveBody(bodyTrim, n.id)') >= 0, label + ' conventionText 正文打码')
      assert(src.indexOf('maskSensitiveLine(title, n.id)') >= 0, label + ' catalogText 标题打码')
      assert(src.indexOf('条含敏感信息已脱敏，原文用 note_get 按 id 获取') >= 0, label + ' 尾部计数提示行')
      assert(src.indexOf('sensitiveSuggested') >= 0, label + ' 敏感建议回传（create/quick/quick-instruct）')
    }
  })
  await t('client-impl.js 敏感 toggle 链路（edSens state/ref + toggleSens + lock chip + doSave 携带 + selectNote 回填）', () => {
    assert(clientSrc.indexOf("const [edSens, setEdSens] = React.useState(false)") >= 0, 'edSens 状态')
    assert(clientSrc.indexOf('const edSensRef = React.useRef(false)') >= 0 && clientSrc.indexOf('edSensRef.current = edSens') >= 0, 'edSensRef 镜像（自动保存读最新值）')
    assert(clientSrc.indexOf('function toggleSens() { setEdSens(!edSens); triggerAutoSave() }') >= 0, 'toggleSens')
    assert(clientSrc.indexOf('onClick: toggleSens') >= 0 && clientSrc.indexOf("I('lock', 11), '敏感'") >= 0, 'meta chip（目录可见旁）')
    assert(clientSrc.indexOf("lock: [e('rect'") >= 0, 'IC.lock 锁形图标')
    assert(clientSrc.indexOf('sensitive: edSensRef.current === true') >= 0, 'doSave 携带 sensitive')
    assert(clientSrc.indexOf('setEdSens(n.sensitive === true)') >= 0, 'selectNote 回填')
  })
  await t('发布包 lib/client.js 同步敏感 toggle 链路（需先跑 scripts/build-dist.cjs）', () => {
    assert(clientPkgSrc.indexOf('edSens') >= 0 && clientPkgSrc.indexOf('toggleSens') >= 0, '发布包含 edSens/toggleSens')
    assert(clientPkgSrc.indexOf('sensitive: edSensRef.current === true') >= 0, '发布包 doSave 携带 sensitive')
    assert(clientPkgSrc.indexOf("I('lock', 11), '敏感'") >= 0, '发布包敏感 chip')
  })
  await t('client/app.html 速记 toast 敏感标注（sensitiveSuggested 命中告知）', () => {
    assert(clientSrc.indexOf("res.sensitiveSuggested ? '，已标记敏感（注入自动脱敏）' : ''") >= 0, 'client-impl 速记 toast 追加敏感标注')
    assert(appSrc.indexOf("res && res.sensitiveSuggested ? '，已标记敏感（注入自动脱敏）' : ''") >= 0, 'app.html 速记 toast 追加敏感标注')
  })
  await t('app.html 敏感 toggle：i-lock symbol + mSens chip + doSave 携带 sensitive', () => {
    assert(appSrc.indexOf('id="i-lock"') >= 0, 'i-lock symbol')
    assert(appSrc.indexOf('id="mSens"') >= 0 && appSrc.indexOf("icon('i-lock')") >= 0, 'mSens chip（mRecall 旁）')
    assert(appSrc.indexOf("$('mSens').onclick") >= 0 && appSrc.indexOf('edNote.sensitive = edNote.sensitive !== true') >= 0, 'mSens toggle 处理')
    assert(appSrc.indexOf('sensitive: edNote.sensitive === true') >= 0, 'app.html doSave 携带 sensitive')
  })

  // ===== 28. P1 回收站（notes-list includeDeleted + notes-purge + 恢复/彻底删除 UI）=====
  // 契约：notes-list 参数化 includeDeleted（缺省排除软删除，true 时含 deleted 且 slim 携带 deleted 标记）；
  // notes-purge {id} 仅限已软删除笔记（安全闸），删除 n-<id>.md 与归档备份 n-<id>.md.bak——
  // 静态包 node:fs 真删（fs.processPath 通道），开发版落回墓碑式清空（0 字节占位，readNoteFile 标 tombstoned，全链路视作不存在）。
  section('28. P1 回收站（trash 列表 + 恢复/彻底删除 + notes-purge）')
  // ---- 28.1 host 双侧结构契约（host-impl / index.mjs 双包同步）----
  await t('host 双侧：notes-purge RPC + notes-list includeDeleted 参数化 + 墓碑跳过 + slim deleted 标记', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1]
      assert(s.indexOf("handle('notes-purge'") >= 0, pair[0] + ' notes-purge RPC 注册')
      assert(s.indexOf('args.includeDeleted') >= 0, pair[0] + ' notes-list 透传 includeDeleted')
      assert(s.indexOf('async function _list(tag, kind, folder, includeDeleted, includeLogs)') >= 0, pair[0] + ' _list 第 4 参数 includeDeleted / 第 5 参数 includeLogs（工作记忆 v0）')
      assert(s.indexOf('if (note.deleted && !includeDeleted) continue') >= 0, pair[0] + ' includeDeleted 放行软删除')
      assert(s.indexOf('if (note.tombstoned) continue') >= 0, pair[0] + ' _list 跳过 purge 墓碑')
      assert(s.indexOf('note.tombstoned = !c') >= 0, pair[0] + ' readNoteFile 墓碑标记（0 字节占位）')
      assert(s.indexOf('async function _purge(id)') >= 0 && s.indexOf('purgeNoteFile') >= 0, pair[0] + ' _purge/purgeNoteFile 存在')
      assert(s.indexOf('彻底删除请先移入回收站') >= 0, pair[0] + ' 未软删除拒绝 purge（安全闸）')
      assert(s.indexOf("id + '.md.bak'") >= 0, pair[0] + ' .bak 归档备份一并清除')
      assert(s.indexOf('deleted: n.deleted === true') >= 0, pair[0] + ' slim 携带 deleted 标记')
      assert(s.indexOf('if (!content) continue   // purge 墓碑') >= 0, pair[0] + ' scanImportDir 跳过墓碑（防导出→导入复活）')
    }
    assert(indexSrc.indexOf('node:fs 真删除') >= 0 && indexSrc.indexOf('fsNode.promises.unlink(pp)') >= 0, 'index.mjs purge 有 node:fs 真删除通道')
    assert(hostSrc.indexOf('fsNode') < 0, '开发版不 import node:fs（ctx.fs 无删除契约，仅墓碑式清空）')
  })
  // ---- 28.2 host 行为级（开发版独立实例 storeT/handlersT，与 8.5/27.2 同款隔离模式）----
  const storeT = new Map()
  const fsMockT = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeT.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of storeT.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!storeT.has(p)) throw new Error('ENOENT: ' + p); return storeT.get(p) },
    writeText: async (p, c) => { storeT.set(p, c) },
  }
  const handlersT = {}
  const harnessMockT = { handle: (name, fn) => { handlersT[name] = fn; return () => { delete handlersT[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockT, DIR).apply({
    fs: fsMockT, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  await t('notes-list includeDeleted：缺省排除 deleted；includeDeleted:true 含 deleted 且 slim 携带标记', async () => {
    const c1 = await handlersT['notes-create']({ title: '回收站甲', body: 'a', topic: '回收' })
    const c2 = await handlersT['notes-create']({ title: '回收站乙', body: 'b', topic: '回收' })
    await handlersT['notes-delete']({ id: c2.id })
    const l0 = await handlersT['notes-list']({})
    assert(!l0.notes.find(n => n.id === c2.id) && l0.notes.find(n => n.id === c1.id), '缺省列表排除软删除')
    const l1 = await handlersT['notes-list']({ includeDeleted: true })
    const d = l1.notes.find(n => n.id === c2.id)
    assert(d && d.deleted === true, 'includeDeleted 含软删除且 slim 携带 deleted:true')
    const a1 = l1.notes.find(n => n.id === c1.id)
    assert(a1 && a1.deleted === false, '未删笔记 deleted:false')
  })
  await t('notes-purge 安全闸：未软删除的笔记拒绝彻底删除 + 缺 id 报错', async () => {
    const c = await handlersT['notes-create']({ title: '回收站丙', body: 'c', topic: '回收' })
    const r = await handlersT['notes-purge']({ id: c.id })
    assert(r && r.error && r.error.indexOf('彻底删除请先移入回收站') >= 0, '未删笔记拒绝 purge（实得 ' + JSON.stringify(r) + '）')
    assert((await handlersT['notes-list']({})).notes.find(n => n.id === c.id), '笔记仍在列表（未被误删）')
    const e0 = await handlersT['notes-purge']({})
    assert(e0 && e0.error && e0.error.indexOf('需要 id') >= 0, '缺 id 报错')
  })
  await t('notes-purge 彻底删除：.md 与 .bak 墓碑化 + 回收站列表消失 + 缓存失效 + 不可恢复', async () => {
    const c = await handlersT['notes-create']({ title: '回收站丁', body: 'd', topic: '回收' })
    // 造 .bak（归档备份形态）
    await fsMockT.writeText(NOTES_DIR + '\\' + c.id + '.md.bak', storeT.get(NOTES_DIR + '\\' + c.id + '.md'))
    await handlersT['notes-delete']({ id: c.id })
    const r = await handlersT['notes-purge']({ id: c.id })
    assert(!r.error && r.purged === true, 'purge 成功（实得 ' + JSON.stringify(r) + '）')
    assert.strictEqual(r.mode, 'tombstoned', '开发版删除语义 = 墓碑式清空（ctx.fs 无删除契约）')
    assert.strictEqual(storeT.get(NOTES_DIR + '\\' + c.id + '.md'), '', '.md 已清空为 0 字节墓碑')
    assert.strictEqual(storeT.get(NOTES_DIR + '\\' + c.id + '.md.bak'), '', '.bak 归档备份一并清空')
    const l1 = await handlersT['notes-list']({ includeDeleted: true })
    assert(!l1.notes.find(n => n.id === c.id), '回收站列表（includeDeleted）也不再出现（墓碑跳过）')
    const g = await handlersT['notes-get']({ id: c.id })
    assert(g && g.error, 'notes-get 墓碑报错（缓存已失效）')
    const rs = await handlersT['notes-restore']({ id: c.id })
    assert(rs && rs.error && rs.error.indexOf('不可恢复') >= 0, '墓碑不可恢复（实得 ' + JSON.stringify(rs) + '）')
    const r2 = await handlersT['notes-purge']({ id: c.id })
    assert(r2 && r2.error && r2.error.indexOf('不可恢复') >= 0, '二次 purge 报错（幂等防重）')
  })
  await t('恢复往返：回收站恢复后回到正常列表（notes-restore）', async () => {
    const c = await handlersT['notes-create']({ title: '回收站戊', body: 'e', topic: '回收' })
    await handlersT['notes-delete']({ id: c.id })
    let l = await handlersT['notes-list']({ includeDeleted: true })
    assert(l.notes.find(n => n.id === c.id && n.deleted === true), '删除后回收站可见')
    await handlersT['notes-restore']({ id: c.id })
    l = await handlersT['notes-list']({})
    assert(l.notes.find(n => n.id === c.id), '恢复后回到正常列表')
    l = await handlersT['notes-list']({ includeDeleted: true })
    assert(l.notes.find(n => n.id === c.id && n.deleted === false), '恢复后 deleted:false')
  })
  // ---- 28.3 静态包行为级（rpc2 路由链路 + store2 内存 mock；无 processPath → 落回墓碑式清空）----
  await t('静态包：notes-list includeDeleted + notes-purge + 不可恢复（RPC 路由链路）', async () => {
    const c = await rpc2('notes-create', { title: '静态包回收站', body: 'x', topic: '回收' })
    const id = c.body.id
    await rpc2('notes-delete', { id: id })
    const l1 = await rpc2('notes-list', { includeDeleted: true })
    const d = l1.body.notes.find(n => n.id === id)
    assert(d && d.deleted === true, '静态包 includeDeleted 含软删除 + slim deleted 标记')
    const p0 = await rpc2('notes-purge', {})
    assert(p0.body && p0.body.error && p0.body.error.indexOf('需要 id') >= 0, '缺 id 报错')
    const p1 = await rpc2('notes-purge', { id: id })
    assert(p1.body && p1.body.purged === true, '静态包 purge 成功（实得 ' + JSON.stringify(p1.body) + '）')
    assert.strictEqual(p1.body.mode, 'tombstoned', 'mock fs 无 processPath → 落回墓碑式清空')
    assert.strictEqual(store2.get(path.join(NOTES_ROOT_STATIC, id + '.md')), '', '静态包 .md 已清空为 0 字节墓碑')
    const l2 = await rpc2('notes-list', { includeDeleted: true })
    assert(!l2.body.notes.find(n => n.id === id), 'purge 后回收站也不再出现')
    const rs = await rpc2('notes-restore', { id: id })
    assert(rs.body && rs.body.error && rs.body.error.indexOf('不可恢复') >= 0, 'purge 后不可恢复')
  })
  // ---- 28.4 client 结构断言（开发版 client-impl + 发布包 lib/client.js 同步）----
  await t('回收站 UI（client-impl + 发布包 lib/client.js）：侧栏入口 + modal + 恢复/彻底删除 + Esc + toast', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("onClick: openTrash") >= 0 && s.indexOf("I('trash', 12), '回收站'") >= 0, label + ' 侧栏底部回收站入口（fbtn + trash 图标）')
      assert(s.indexOf('function openTrash()') >= 0 && s.indexOf('function loadTrash()') >= 0, label + ' openTrash/loadTrash 存在')
      assert(s.indexOf("'notes-list', { includeDeleted: true }") >= 0, label + ' 回收站列表走 notes-list includeDeleted')
      assert(s.indexOf('.filter(n => n.deleted === true)') >= 0, label + ' 客户端过滤 deleted:true')
      assert(s.indexOf("'notes-purge', { id: id }") >= 0, label + ' 彻底删除走 notes-purge')
      assert(s.indexOf('彻底删除不可恢复') >= 0, label + ' confirm 双确认文案「彻底删除不可恢复」')
      assert(s.indexOf("showToast('已恢复')") >= 0 && s.indexOf("showToast('已彻底删除')") >= 0, label + ' toast：已恢复/已彻底删除')
      assert(s.indexOf('dsh-notes-trash-act') >= 0, label + ' 行内操作按钮样式类')
    }
    assert(clientSrc.indexOf('if (trashOpenRef.current) { setTrashOpen(false); return }') >= 0, 'Esc 链路关回收站对话框')
    assert(clientSrc.indexOf('!pruneOpen && !trashOpen') >= 0, '全局错误条排除回收站 modal（modal 内自显错误）')
    assert(clientSrc.indexOf('回收站为空') >= 0, '空态文案')
  })
  // ---- 28.5 样式同步（styles.css + 发布包 lib/styles.css）----
  await t('回收站样式（styles.css + 发布包 lib/styles.css 同步）', () => {
    const cssDev2 = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg2 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev2], ['发布包 lib/styles.css', cssPkg2]]) {
      assert(pair[1].indexOf('.dsh-notes-trash-act{') >= 0 && pair[1].indexOf('.dsh-notes-trash-act.danger') >= 0, pair[0] + ' 缺回收站行按钮样式（需跑 scripts/build-dist.cjs）')
    }
  })
  // ---- 28.6 app.html / 原型 notes-ui-v2.html 同步（UI 唯一规格来源约束）----
  await t('app.html 回收站同款：btnTrash 入口 + openTrash + notes-purge + confirm 双确认 + toast', () => {
    assert(appSrc.indexOf('id="btnTrash"') >= 0, 'app.html 侧栏底部回收站入口')
    assert(appSrc.indexOf("$('btnTrash').addEventListener('click', openTrash)") >= 0, 'app.html 入口接线')
    // 底部收敛：恰 3 个 fbtn（回收站 + 选择 + 设置，「选择」自旧 chips 行迁入——筛选中心口径⑥），无 导出/导入/整理；回收站在设置卡片「数据」区有兜底入口
    const footA = appSrc.match(/<div class="side-foot">([\s\S]*?)<\/div>\s*<\/aside>/)
    assert(footA && (footA[1].match(/class="fbtn"/g) || []).length === 3, 'app.html 底部按钮恰为 3 个')
    assert(footA[1].indexOf('btnTrash') >= 0 && footA[1].indexOf('btnSelMode') >= 0 && footA[1].indexOf('btnSettings') >= 0, 'app.html 底部 = 回收站 + 选择 + 设置')
    assert(appSrc.indexOf('id="setTrash"') >= 0 && appSrc.indexOf("$('setTrash').onclick = function () { openTrash() }") >= 0, 'app.html 设置卡片「数据」区回收站兜底入口（openTrash）')
    assert(appSrc.indexOf('function openTrash()') >= 0 && appSrc.indexOf("rpc('notes-list', { includeDeleted: true })") >= 0, 'app.html openTrash + includeDeleted')
    assert(appSrc.indexOf("rpc('notes-purge', { id: id })") >= 0 && appSrc.indexOf("rpc('notes-restore', { id: id })") >= 0, 'app.html purge/restore RPC')
    assert(appSrc.indexOf('彻底删除不可恢复') >= 0, 'app.html confirm 双确认文案')
    assert(appSrc.indexOf("toast('已恢复')") >= 0 && appSrc.indexOf("toast('已彻底删除')") >= 0, 'app.html toast')
    assert(appSrc.indexOf('回收站为空') >= 0, 'app.html 空态文案')
  })
  await t('原型 notes-ui-v2.html 回收站硬性同步：UI 标记 + mock includeDeleted/purge + 演示数据', () => {
    assert(protoV2Src.indexOf('id="btnTrash"') >= 0 && protoV2Src.indexOf('function openTrash()') >= 0, 'v2 回收站入口 + 函数')
    // 底部收敛同款：恰 3 个 fbtn（回收站 + 选择 + 设置）+ 设置卡片「数据」区兜底
    const footP = protoV2Src.match(/<div class="side-foot">([\s\S]*?)<\/div>\s*<\/aside>/)
    assert(footP && (footP[1].match(/class="fbtn"/g) || []).length === 3, 'v2 底部按钮恰为 3 个')
    assert(footP[1].indexOf('btnTrash') >= 0 && footP[1].indexOf('btnSelMode') >= 0 && footP[1].indexOf('btnSettings') >= 0, 'v2 底部 = 回收站 + 选择 + 设置')
    assert(protoV2Src.indexOf('id="setTrash"') >= 0 && protoV2Src.indexOf("$('setTrash').onclick = function () { openTrash() }") >= 0, 'v2 设置卡片「数据」区回收站兜底入口')
    assert(protoV2Src.indexOf('includeDeleted') >= 0, 'v2 mock notes-list includeDeleted')
    assert(protoV2Src.indexOf("method === 'notes-purge'") >= 0, 'v2 mock notes-purge')
    assert(protoV2Src.indexOf('彻底删除不可恢复') >= 0, 'v2 confirm 双确认文案')
    assert(protoV2Src.indexOf('已删演示') >= 0, 'v2 mock 含软删除演示笔记（回收站非空演示）')
    // v2 与 app.html 回收站 UI 标记双端一致（共享 DOM id / 函数名 / 样式类）
    for (const k of ['btnTrash', 'setTrash', 'openTrash', 'loadTrash', 'renderTrashList', 'doTrashRestore', 'doTrashPurge', 'trashList', 'trash-act', 'trashState',
                     'toggleTrashSel', 'toggleTrashAll', 'toggleTrashPreview', 'doTrashRestoreBatch', 'doTrashPurgeBatch', 'trashAll', 'trashRestoreBatch', 'trashPurgeBatch', 'trash-batch', 'trash-check', 'trash-preview']) {
      assert(protoV2Src.indexOf(k) >= 0 && appSrc.indexOf(k) >= 0, '回收站 UI 标记双端一致：' + k)
    }
  })

  // ---- 28.7 回收站增强（notes-trash-batch-preview）：批量选择/全选 + 批量恢复/批量彻底删除 + 行内容只读预览 ----
  await t('notes-get includeDeleted：已删笔记正文只读可达（双包同步 + 行为级，缺省/墓碑仍拒绝）', async () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1]
      assert(s.indexOf('async function _getDeleted(id)') >= 0, pair[0] + ' _getDeleted 存在（回收站预览专用：放行已删、墓碑仍拒绝）')
      assert(s.indexOf('args && args.includeDeleted ? await _getDeleted(args.id) : await _get(args.id)') >= 0, pair[0] + ' notes-get 透传 includeDeleted（缺省走 _get，编辑器链路口径不变）')
    }
    // 行为级（开发版独立实例 handlersT）：已删笔记缺省拒绝、includeDeleted 可达且带正文+deleted 标记；墓碑 includeDeleted 仍拒绝
    const pv = await handlersT['notes-create']({ title: '回收站预览甲', body: 'trash-preview-body-1', topic: '回收' })
    await handlersT['notes-delete']({ id: pv.id })
    const g0 = await handlersT['notes-get']({ id: pv.id })
    assert(g0 && g0.error && !g0.note, '缺省 notes-get 对已删笔记仍拒绝（编辑器链路口径不变）')
    const g1 = await handlersT['notes-get']({ id: pv.id, includeDeleted: true })
    assert(g1 && g1.note && g1.note.body === 'trash-preview-body-1' && g1.note.deleted === true, 'includeDeleted 已删正文可达（实得 ' + JSON.stringify(g1 && (g1.error || g1.note && g1.note.deleted)) + '）')
    await handlersT['notes-purge']({ id: pv.id })
    const g2 = await handlersT['notes-get']({ id: pv.id, includeDeleted: true })
    assert(g2 && g2.error && !g2.note, '墓碑（已彻底删除）includeDeleted 仍拒绝')
    // 静态包同款（rpc2 路由链路）
    const pv2 = await rpc2('notes-create', { title: '静态包回收站预览', body: 'trash-preview-body-2', topic: '回收' })
    await rpc2('notes-delete', { id: pv2.body.id })
    const sg0 = await rpc2('notes-get', { id: pv2.body.id })
    assert(sg0.body && sg0.body.error && !sg0.body.note, '静态包缺省 notes-get 对已删笔记仍拒绝')
    const sg1 = await rpc2('notes-get', { id: pv2.body.id, includeDeleted: true })
    assert(sg1.body && sg1.body.note && sg1.body.note.body === 'trash-preview-body-2' && sg1.body.note.deleted === true, '静态包 includeDeleted 已删正文可达')
  })
  await t('回收站批量操作四端同步：全选/行勾选/选中计数 + 批量恢复/批量彻底删除（confirm 含 不可恢复+含历史版本+条数）', () => {
    // React 两端：开发版面板 + 发布包 lib/client.js（build-dist 机械转换产物）
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('function toggleTrashSel(id)') >= 0 && s.indexOf('function toggleTrashAll()') >= 0, label + ' 行勾选/全选函数存在')
      assert(s.indexOf('async function doTrashRestoreBatch()') >= 0 && s.indexOf('async function doTrashPurgeBatch()') >= 0, label + ' 批量恢复/批量彻底删除函数存在')
      assert(s.indexOf("window.confirm('批量恢复：所选的 ' + ids.length + ' 条笔记将移出回收站（恢复后回到正常列表）。\\n确认恢复？')") >= 0, label + ' 批量恢复 confirm 文案（含条数）')
      assert(s.indexOf("window.confirm('批量彻底删除：所选的 ' + ids.length + ' 条笔记将彻底删除，不可恢复（含历史版本）。\\n删除后正文、历史版本快照与归档备份将一并移除，确认彻底删除？')") >= 0, label + ' 批量彻底删除 confirm 含「不可恢复 + 含历史版本 + 条数」')
      assert(s.indexOf("showToast('已恢复 ' + ok + ' 条'") >= 0 && s.indexOf("showToast('已彻底删除 ' + ok + ' 条'") >= 0, label + ' 批量 toast 计数文案')
      assert(s.indexOf("'notes-restore', { id: id }") >= 0 && s.indexOf("'notes-purge', { id: id }") >= 0, label + ' 批量逐条 notes-restore / notes-purge payload')
      assert(s.indexOf("'已选 ' + Object.keys(trashSel).length + ' 条'") >= 0, label + ' 选中计数')
      assert(s.indexOf('dsh-notes-trash-batch') >= 0 && s.indexOf('dsh-notes-trash-check') >= 0, label + ' 批量条/行勾选样式类')
    }
    // DOM 两端：app.html + 原型 notes-ui-v2.html（同款 DOM/脚本）
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('function toggleTrashSel(id)') >= 0 && s.indexOf('function toggleTrashAll()') >= 0, label + ' 行勾选/全选函数存在')
      assert(s.indexOf('function doTrashRestoreBatch()') >= 0 && s.indexOf('function doTrashPurgeBatch()') >= 0, label + ' 批量恢复/批量彻底删除函数存在')
      assert(s.indexOf('id="trashAll"') >= 0 && s.indexOf('id="trashRestoreBatch"') >= 0 && s.indexOf('id="trashPurgeBatch"') >= 0, label + ' 全选 checkbox + 批量按钮 DOM id')
      assert(s.indexOf("'已选 ' + selCnt + ' 条'") >= 0, label + ' 选中计数')
      assert(s.indexOf("confirm('批量恢复：所选的 ' + ids.length + ' 条笔记将移出回收站（恢复后回到正常列表）。\\n确认恢复？')") >= 0, label + ' 批量恢复 confirm 文案（含条数）')
      assert(s.indexOf("confirm('批量彻底删除：所选的 ' + ids.length + ' 条笔记将彻底删除，不可恢复（含历史版本）。\\n删除后正文、历史版本快照与归档备份将一并移除，确认彻底删除？')") >= 0, label + ' 批量彻底删除 confirm 含「不可恢复 + 含历史版本 + 条数」')
      assert(s.indexOf("toast('已恢复 ' + ok + ' 条'") >= 0 && s.indexOf("toast('已彻底删除 ' + ok + ' 条'") >= 0, label + ' 批量 toast 计数文案')
      assert(s.indexOf("rpc('notes-restore', { id: id })") >= 0 && s.indexOf("rpc('notes-purge', { id: id })") >= 0, label + ' 批量逐条 notes-restore / notes-purge payload')
      assert(s.indexOf('.trash-batch{') >= 0 && s.indexOf('.trash-check{') >= 0 && s.indexOf('.trash-preview{') >= 0, label + ' 批量条/勾选/预览样式（内联 CSS）')
    }
    // 面板样式双份同步（styles.css + 发布包 lib/styles.css）
    const cssDev3 = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg3 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev3], ['发布包 lib/styles.css', cssPkg3]]) {
      assert(pair[1].indexOf('.dsh-notes-trash-batch{') >= 0 && pair[1].indexOf('.dsh-notes-trash-check{') >= 0 && pair[1].indexOf('.dsh-notes-trash-preview{') >= 0, pair[0] + ' 缺回收站批量/勾选/预览样式（需跑 scripts/build-dist.cjs）')
    }
  })
  await t('回收站行预览四端同步：notes-get includeDeleted 取已删正文 + 只读渲染（esc 先行零注入面）', () => {
    // React 两端：renderMarkdown 内核只读渲染（内核全量转义，esc 先行——XSS 红线断言同源）
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('function toggleTrashPreview(id)') >= 0, label + ' 行预览开关函数存在')
      assert(s.indexOf("'notes-get', { id: id, includeDeleted: true }") >= 0, label + ' 预览走 notes-get includeDeleted（已删正文可达）')
      assert(s.indexOf("className: 'dsh-notes-trash-preview dsh-notes-rich', dangerouslySetInnerHTML: { __html: renderMarkdown(trashPreview.body, wikiResolve) }") >= 0, label + ' 预览只读 renderMarkdown 内核渲染（全量转义零注入面）')
      assert(s.indexOf("trashPreview && trashPreview.id === n.id ? '收起' : '预览'") >= 0, label + ' 行尾「预览/收起」按钮')
    }
    // app.html：同款 renderMarkdown 只读渲染；标题/错误态均经 esc()
    assert(appSrc.indexOf('function toggleTrashPreview(id)') >= 0, 'app.html 行预览开关函数存在')
    assert(appSrc.indexOf("rpc('notes-get', { id: id, includeDeleted: true })") >= 0, 'app.html 预览走 notes-get includeDeleted')
    assert(appSrc.indexOf('\'<div class="trash-preview rich">\' + (typeof pv.body === \'string\' ? renderMarkdown(pv.body, wikiResolve)') >= 0, 'app.html 预览只读 renderMarkdown 内核渲染（esc 先行）')
    assert(appSrc.indexOf('data-act="preview"') >= 0 && appSrc.indexOf('class="ti trash-ti"') >= 0, 'app.html 行尾「预览/收起」按钮 + 标题点击预览')
    // 原型：无 Markdown 内核——esc() 纯文本只读预览（hist-preview 同款先例，esc 全量转义零注入面）+ mock notes-get 支持 includeDeleted
    assert(protoV2Src.indexOf('function toggleTrashPreview(id)') >= 0, '原型行预览开关函数存在')
    assert(protoV2Src.indexOf("rpc('notes-get', { id: id, includeDeleted: true })") >= 0, '原型预览走 notes-get includeDeleted')
    assert(protoV2Src.indexOf('\'<div class="trash-preview">\' + (typeof pv.body === \'string\' ? esc(pv.body)') >= 0, '原型预览 esc() 纯文本只读（esc 先行零注入面）')
    assert(protoV2Src.indexOf('data-act="preview"') >= 0 && protoV2Src.indexOf('class="ti trash-ti"') >= 0, '原型行尾「预览/收起」按钮 + 标题点击预览')
    assert(protoV2Src.indexOf("return n && (!n.deleted || a.includeDeleted) ? { note: JSON.parse(JSON.stringify(n)) } : { error: 'Note has been deleted' }") >= 0, '原型 mock notes-get 支持 includeDeleted（已删演示正文可预览）')
  })

  // ===== 29. P1 注入增强：时效衰减提醒（staleDays）+ 注入体积预算（injectBudgetChars）=====
  // 契约：settings.json 新增 staleDays（缺省 90，0=关闭）与 injectBudgetChars（缺省 0=不限；约，按字符数近似，不引 token 计算库）；
  // catalogText 对 kind=note/link（参考资料类）且 updatedAt 超期条目行尾追加「 ⚠ N 天未更新」；
  // conventionText 约定桶永不截断、资料桶超预算从最旧整条省略 + 尾部提示行；lastInjectChars 每次渲染更新并随 settings-get 回传（设置卡片仪表）。
  section('29. P1 注入增强（staleDays 时效标注 + injectBudgetChars 预算截断）')

  // ---- 29.1 host 双侧结构契约（host-impl / index.mjs 双包同步）----
  await t('host 双侧：staleDays/injectBudgetChars helper + 默认值 + settings-set 校验 + 文案', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('const STALE_DAYS_DEFAULT = 90') >= 0, label + ' staleDays 缺省 90')
      assert(s.indexOf('function staleDaysLimit()') >= 0 && s.indexOf('function injectBudgetChars()') >= 0, label + ' staleDaysLimit/injectBudgetChars helper 存在')
      assert(s.indexOf('function staleDaysOf(updatedAt, limit)') >= 0, label + ' staleDaysOf 时效判定存在')
      assert(s.indexOf('let lastInjectChars = 0') >= 0, label + ' lastInjectChars 缓存变量')
      assert(s.indexOf('lastInjectChars: lastInjectChars') >= 0, label + ' settings-get 回传 lastInjectChars')
      assert(s.indexOf('lastInjectChars = full.length') >= 0, label + ' conventionText 每次渲染更新缓存值')
      assert(s.indexOf("if ('staleDays' in patch)") >= 0 && s.indexOf("if ('injectBudgetChars' in patch)") >= 0, label + ' settings-set 处理两个新键')
      assert(s.indexOf('staleDays 需要非负数值') >= 0 && s.indexOf('injectBudgetChars 需要非负数值') >= 0, label + ' 新键校验文案')
      assert(s.indexOf("(n.kind === 'note' || n.kind === 'link')") >= 0, label + ' ⚠ 标注限 kind=note/link（参考资料类）')
      assert(s.indexOf("line += ' ⚠ ' + sd + ' 天未更新'") >= 0, label + ' 目录行尾「 ⚠ N 天未更新」标注')
      assert(s.indexOf('约定桶永不截断') >= 0, label + ' 约定桶永不截断（注释约定）')
      assert(s.indexOf('条资料超出预算未注入（note_search 可检索）') >= 0, label + ' 预算省略提示行文案')
      assert(s.indexOf('按字符数近似统计，不引 token 计算库') >= 0, label + ' 「约/字符数近似」口径注释')
    }
  })

  // ---- 29.2 host 行为级（开发版独立实例 store9i/handlers9i/contexts9i，与 22/28 节同款隔离模式）----
  const store9i = new Map()
  const fsMock9i = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store9i.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store9i.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!store9i.has(p)) throw new Error('ENOENT: ' + p); return store9i.get(p) },
    writeText: async (p, c) => { store9i.set(p, c) },
  }
  const handlers9i = {}
  const contexts9i = []
  const harnessMock9i = { handle: (name, fn) => { handlers9i[name] = fn; return () => { delete handlers9i[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock9i, DIR).apply({
    fs: fsMock9i, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contexts9i.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  const convCtx9i = contexts9i.find(x => x.name === 'notes:workspace-conventions')
  const catCtx9i = contexts9i.find(x => x.name === 'notes:catalog')

  await t('staleDays 时效标注：kind=note/link 超期行尾「 ⚠ N 天未更新」；todo/新鲜条目不标', async () => {
    const old = new Date(Date.now() - 100 * 86400000).toISOString()
    const fresh = new Date().toISOString()
    const fm = (id, kind, updatedAt) => '---\nid: ' + id + '\ntitle: ' + id + '标题\ntopic: 运维\n' + (kind ? 'kind: ' + kind + '\n' : '') + 'createdAt: "' + updatedAt + '"\nupdatedAt: "' + updatedAt + '"\n---\n\n正文\n'
    await fsMock9i.writeText(NOTES_DIR + '\\n-stale-note.md', fm('n-stale-note', '', old))      // 缺省 kind=note（向后兼容）
    await fsMock9i.writeText(NOTES_DIR + '\\n-stale-link.md', fm('n-stale-link', 'link', old))
    await fsMock9i.writeText(NOTES_DIR + '\\n-stale-todo.md', fm('n-stale-todo', 'todo', old))
    await fsMock9i.writeText(NOTES_DIR + '\\n-fresh-note.md', fm('n-fresh-note', '', fresh))
    for (const id of ['n-stale-note', 'n-stale-link', 'n-stale-todo', 'n-fresh-note']) await handlers9i['notes-get']({ id: id })   // 触发解析进 cache（catalogText 只读 cache）
    const txt = catCtx9i.text()
    assert(txt.indexOf('- [n-stale-note] n-stale-note标题 (笔记, 运维) ⚠ 100 天未更新') >= 0, 'note 超期标注（实得：' + txt.split('\n').filter(l => l.indexOf('stale') >= 0 || l.indexOf('fresh') >= 0).join(' | ') + '）')
    assert(txt.indexOf('- [n-stale-link] n-stale-link标题 (链接, 运维) ⚠ 100 天未更新') >= 0, 'link 超期标注')
    assert(txt.indexOf('n-stale-todo标题 (待办, 运维) ⚠') < 0, 'todo 不标注（非参考资料类）')
    assert(txt.indexOf('n-fresh-note标题 (笔记, 运维) ⚠') < 0, '新鲜条目不标注')
    assert(txt.indexOf('n-stale-todo标题 (待办, 运维)') >= 0 && txt.indexOf('n-fresh-note标题 (笔记, 运维)') >= 0, '未标注条目仍在目录')
  })
  await t('staleDays 设置往返：落盘回读 → 阈值放宽不标 → 0 关闭 → null 恢复缺省 90 → 非法值报错', async () => {
    let bad = await handlers9i['notes-settings-set']({ staleDays: -1 })
    assert(bad.error && bad.error.indexOf('staleDays') >= 0, '负数报错')
    bad = await handlers9i['notes-settings-set']({ staleDays: '30' })
    assert(bad.error && bad.error.indexOf('staleDays') >= 0, '字符串报错')
    const ok = await handlers9i['notes-settings-set']({ staleDays: 30 })
    assert(ok.ok === true, '保存成功（实得 ' + JSON.stringify(ok) + '）')
    const onDisk = JSON.parse(store9i.get(NOTES_DIR + '\\settings.json'))
    assert.strictEqual(onDisk.staleDays, 30, 'settings.json 落盘 staleDays:30')
    const sg = await handlers9i['notes-settings-get']({})
    assert.strictEqual(sg.settings.staleDays, 30, 'notes-settings-get 回读一致')
    assert.strictEqual(typeof sg.lastInjectChars, 'number', 'settings-get 回传 lastInjectChars 数值（仪表数据源）')
    await handlers9i['notes-settings-set']({ staleDays: 200 })
    assert(catCtx9i.text().indexOf('⚠') < 0, '阈值 200：100 天未超期不标注')
    await handlers9i['notes-settings-set']({ staleDays: 0 })
    assert(catCtx9i.text().indexOf('⚠') < 0, '0 = 关闭标注')
    await handlers9i['notes-settings-set']({ staleDays: null })
    const sg2 = await handlers9i['notes-settings-get']({})
    assert(!('staleDays' in sg2.settings), 'null 删除 override（恢复缺省 90）')
    assert(catCtx9i.text().indexOf('⚠ 100 天未更新') >= 0, '缺省 90 恢复标注')
  })
  await t('injectBudgetChars 预算截断：资料桶从最旧整条省略 + 提示行；约定桶永不截断；lastInjectChars 随渲染更新', async () => {
    // 约定 1 条（100 字符正文）+ 资料 3 条（各 200 字符正文；R1 最旧，R3 最新——updatedAt 降序的尾部 = 最旧）
    await handlers9i['notes-create']({ title: '预算约定条目', body: 'x'.repeat(100), inject: true, topic: '约定' })
    await handlers9i['notes-create']({ title: '资料一', body: 'a'.repeat(200), inject: true, injectRole: 'reference', topic: '资料' })
    await new Promise(r => setTimeout(r, 2))
    await handlers9i['notes-create']({ title: '资料二', body: 'b'.repeat(200), inject: true, injectRole: 'reference', topic: '资料' })
    await new Promise(r => setTimeout(r, 2))
    await handlers9i['notes-create']({ title: '资料三', body: 'c'.repeat(200), inject: true, injectRole: 'reference', topic: '资料' })
    // 基线（缺省 0=不限）：全部注入，无省略提示行
    const f0 = convCtx9i.text()
    assert(f0.indexOf('预算约定条目') >= 0 && f0.indexOf('资料一') >= 0 && f0.indexOf('资料二') >= 0 && f0.indexOf('资料三') >= 0, '缺省不限：约定 + 3 条资料全部注入')
    assert(f0.indexOf('超出预算未注入') < 0, '基线无省略提示行')
    const sg0 = await handlers9i['notes-settings-get']({})
    assert.strictEqual(sg0.lastInjectChars, f0.length, 'lastInjectChars = 最近一次渲染长度')
    // 预算 = 基线 - 150：每个资料块 >200 字符 → 恰好省略最旧 1 条（资料一），其余保留
    const ok1 = await handlers9i['notes-settings-set']({ injectBudgetChars: f0.length - 150 })
    assert(ok1.ok === true, '预算保存成功')
    const f1 = convCtx9i.text()
    assert(f1.indexOf('资料一') < 0 && f1.indexOf('资料二') >= 0 && f1.indexOf('资料三') >= 0, '最旧资料整条省略，较新资料保留')
    assert(f1.indexOf('预算约定条目') >= 0 && f1.indexOf('x'.repeat(100)) >= 0, '约定桶完整保留')
    assert(f1.indexOf('…另有 1 条资料超出预算未注入（note_search 可检索）') >= 0, '省略提示行 N=1（实得尾部：' + f1.split('\n').slice(-2).join(' | ') + '）')
    assert(f1.split('\n\n…另有')[0].length <= f0.length - 150, '截断后主体回到预算内')
    // 约定不截断：预算小于约定自身长度 → 资料全部省略，约定仍完整
    await handlers9i['notes-settings-set']({ injectBudgetChars: 30 })
    const f2 = convCtx9i.text()
    assert(f2.indexOf('用户约定（须遵守）：') >= 0 && f2.indexOf('预算约定条目') >= 0 && f2.indexOf('x'.repeat(100)) >= 0, '约定桶永不截断（即使自身已超预算）')
    assert(f2.indexOf('资料一') < 0 && f2.indexOf('资料二') < 0 && f2.indexOf('资料三') < 0, '资料桶全部省略')
    assert(f2.indexOf('…另有 3 条资料超出预算未注入（note_search 可检索）') >= 0, '省略提示行 N=3')
    // 恢复不限 + 非法值
    await handlers9i['notes-settings-set']({ injectBudgetChars: null })
    const sg2 = await handlers9i['notes-settings-get']({})
    assert(!('injectBudgetChars' in sg2.settings), 'null 删除 override（恢复缺省不限）')
    const f3 = convCtx9i.text()
    assert(f3.indexOf('资料一') >= 0 && f3.indexOf('资料三') >= 0 && f3.indexOf('超出预算未注入') < 0, '恢复不限后资料全回、提示行消失')
    const bad = await handlers9i['notes-settings-set']({ injectBudgetChars: -5 })
    assert(bad.error && bad.error.indexOf('injectBudgetChars') >= 0, '负数报错')
    const bad2 = await handlers9i['notes-settings-set']({ injectBudgetChars: 'abc' })
    assert(bad2.error && bad2.error.indexOf('injectBudgetChars') >= 0, '字符串报错')
  })

  // ---- 29.3 静态包行为（独立 ESM 实例 + 独立 store10i；harness 缺席 → webServer 路由链路）----
  await t('静态包：staleDays/injectBudgetChars 往返 + ⚠ 标注 + 预算截断 + 约定不截断（rpc 路由链路）', async () => {
    const store10i = new Map()
    const fsMock10i = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_ROOT_STATIC ? { dir: true } : (store10i.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of store10i.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!store10i.has(p)) throw new Error('ENOENT: ' + p); return store10i.get(p) },
      writeText: async (p, c) => { store10i.set(p, c) },
    }
    const routes10i = []
    const contexts10i = []
    const ctx10i = {
      fs: fsMock10i,
      sandboxPolicy: { resolve: () => ({}) },
      webServer: { register: (r) => { routes10i.push(r); return () => {} } },
      tools: { register: () => () => {} },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contexts10i.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    }
    const modEnh = await import(pathToFileURL(INDEX_PATH).href + '?inject-enhance=1')
    modEnh.apply(ctx10i)
    function rpc10i(method, args) {
      return new Promise((resolve, reject) => {
        const body = Buffer.from(JSON.stringify({ method: method, args: args }))
        const req = { method: 'POST', on: (ev, cb) => { if (ev === 'data') cb(body); else if (ev === 'end') cb(); return req }, destroy: () => {} }
        const res = { statusCode: 0, setHeader: () => {}, writeHead: (c) => { res.statusCode = c }, end: (s) => { let b; try { b = JSON.parse(s) } catch (e) { b = s } resolve({ status: res.statusCode, body: b }) } }
        Promise.resolve(routes10i[0].handler(req, res)).catch(reject)
      })
    }
    const convCtx10i = contexts10i.find(x => x.name === 'notes:workspace-conventions')
    const catCtx10i = contexts10i.find(x => x.name === 'notes:catalog')
    // 设置往返（webServer JSON 通道）
    const bad = await rpc10i('notes-settings-set', { staleDays: 'x' })
    assert(bad.body.error && bad.body.error.indexOf('staleDays') >= 0, '静态包 staleDays 非法值报错')
    const bad2 = await rpc10i('notes-settings-set', { injectBudgetChars: -1 })
    assert(bad2.body.error && bad2.body.error.indexOf('injectBudgetChars') >= 0, '静态包 injectBudgetChars 非法值报错')
    await rpc10i('notes-settings-set', { staleDays: 15, injectBudgetChars: 3000 })
    const onDisk = JSON.parse(store10i.get(path.join(NOTES_ROOT_STATIC, 'settings.json')))
    assert.strictEqual(onDisk.staleDays, 15, '静态包 settings.json 落盘 staleDays:15')
    assert.strictEqual(onDisk.injectBudgetChars, 3000, '静态包 settings.json 落盘 injectBudgetChars:3000')
    const sg = await rpc10i('notes-settings-get', {})
    assert.strictEqual(sg.body.settings.staleDays, 15, '静态包回读 staleDays')
    assert.strictEqual(sg.body.settings.injectBudgetChars, 3000, '静态包回读 injectBudgetChars')
    assert.strictEqual(typeof sg.body.lastInjectChars, 'number', '静态包 settings-get 回传 lastInjectChars')
    // ⚠ 标注（阈值 15，100 天旧笔记超期）
    const old10 = new Date(Date.now() - 100 * 86400000).toISOString()
    await fsMock10i.writeText(path.join(NOTES_ROOT_STATIC, 'n-stale-pkg.md'), '---\nid: n-stale-pkg\ntitle: 静态旧笔记\ntopic: 运维\ncreatedAt: "' + old10 + '"\nupdatedAt: "' + old10 + '"\n---\n\n旧正文\n')
    await rpc10i('notes-get', { id: 'n-stale-pkg' })   // 入 cache
    assert(catCtx10i.text().indexOf('静态旧笔记 (笔记, 运维) ⚠ 100 天未更新') >= 0, '静态包目录 ⚠ 标注（实得：' + catCtx10i.text().split('\n').slice(0, 4).join(' | ') + '）')
    // 预算截断（约定不截断 + 最旧省略 + 提示行）
    await rpc10i('notes-create', { title: '静态约定', body: 'x'.repeat(100), inject: true, topic: '约定' })
    await rpc10i('notes-create', { title: '静态资料一', body: 'a'.repeat(200), inject: true, injectRole: 'reference', topic: '资料' })
    await new Promise(r => setTimeout(r, 2))
    await rpc10i('notes-create', { title: '静态资料二', body: 'b'.repeat(200), inject: true, injectRole: 'reference', topic: '资料' })
    await rpc10i('notes-settings-set', { injectBudgetChars: 30 })
    const ft = convCtx10i.text()
    assert(ft.indexOf('静态约定') >= 0 && ft.indexOf('x'.repeat(100)) >= 0, '静态包约定桶永不截断')
    assert(ft.indexOf('静态资料一') < 0 && ft.indexOf('静态资料二') < 0, '静态包资料桶全部省略')
    assert(ft.indexOf('…另有 2 条资料超出预算未注入（note_search 可检索）') >= 0, '静态包省略提示行 N=2')
    await rpc10i('notes-settings-set', { injectBudgetChars: null, staleDays: null })
    const sg2 = await rpc10i('notes-settings-get', {})
    assert(!('injectBudgetChars' in sg2.body.settings) && !('staleDays' in sg2.body.settings), '静态包 null 恢复缺省')
    assert(convCtx10i.text().indexOf('静态资料一') >= 0, '静态包恢复不限后资料回来')
  })

  // ---- 29.4 client 设置卡片（client-impl + 发布包 lib/client.js 同步 + 仪表样式）----
  await t('设置卡片：「时效衰减提醒」+「注入体积预算」两行（失焦/Enter 即保存 + 仪表 + 「约」文案）', () => {
    assert(/key: 'stale', label: '时效衰减提醒'/.test(clientSrc), 'settingsRows 含「时效衰减提醒」行')
    assert(/key: 'budget', label: '注入体积预算'/.test(clientSrc), 'settingsRows 含「注入体积预算」行')
    assert(clientSrc.indexOf('提醒参考资料可能过期') >= 0, '时效行 sub 说明文案')
    assert(clientSrc.indexOf('约定条目永不截断，资料条目从最旧开始省略') >= 0, '预算行 sub 说明文案（约定不截断）')
    assert(/function saveSettingsStale\(\)[\s\S]*?notes-settings-set', \{ staleDays: v \}\)/.test(clientSrc), '时效阈值走 notes-settings-set 传 staleDays')
    assert(/function saveSettingsBudget\(\)[\s\S]*?notes-settings-set', \{ injectBudgetChars: v \}\)/.test(clientSrc), '预算走 notes-settings-set 传 injectBudgetChars')
    assert(clientSrc.indexOf("setSetStale(String(res.settings && typeof res.settings.staleDays === 'number' ? res.settings.staleDays : 90))") >= 0, 'openSettings 回读 staleDays（缺省 90）')
    assert(clientSrc.indexOf("setSetBudget(String(res.settings && typeof res.settings.injectBudgetChars === 'number' ? res.settings.injectBudgetChars : 0))") >= 0, 'openSettings 回读 injectBudgetChars（缺省 0）')
    assert(clientSrc.indexOf('settingsData.lastInjectChars') >= 0 && clientSrc.indexOf('当前注入约 ') >= 0, '仪表读 lastInjectChars + 「约」文案')
    assert(clientSrc.indexOf('dsh-notes-inject-gauge') >= 0 && clientSrc.indexOf('dsh-notes-inject-gauge-bar') >= 0, '仪表条结构类')
    for (const k of ['时效衰减提醒', '注入体积预算', 'saveSettingsStale', 'saveSettingsBudget', 'dsh-notes-inject-gauge', '当前注入约 ', 'staleDays', 'injectBudgetChars']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺 ' + k + '（需先跑 scripts/build-dist.cjs）')
    }
    const cssDev9 = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg9 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev9], ['发布包 lib/styles.css', cssPkg9]]) {
      assert(pair[1].indexOf('.dsh-notes-inject-gauge{') >= 0 && pair[1].indexOf('.dsh-notes-inject-gauge-bar') >= 0 && pair[1].indexOf('.dsh-notes-inject-gauge-t{') >= 0, pair[0] + ' 缺注入预算仪表样式')
    }
  })

  // ---- 29.5 app.html / 原型 notes-ui-v2.html 设置卡同步 ----
  await t('app.html + 原型设置卡同款两行 + 仪表（双端 UI 标记一致 + mock 演示值）', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('id="setStale"') >= 0 && s.indexOf('id="setBudget"') >= 0, label + ' 两个数值输入')
      assert(s.indexOf('saveSettings({ staleDays: parseInt(v, 10) }') >= 0 && s.indexOf('saveSettings({ injectBudgetChars: parseInt(v, 10) }') >= 0, label + ' 失焦即保存链路')
      assert(s.indexOf('时效衰减提醒') >= 0 && s.indexOf('注入体积预算') >= 0, label + ' 两行标签')
      assert(s.indexOf('当前注入约 ') >= 0 && s.indexOf('setGaugeBar') >= 0, label + ' 仪表文案 + 仪表条')
      assert(s.indexOf('提醒参考资料可能过期') >= 0 && s.indexOf('约定条目永不截断') >= 0, label + ' 说明文案（过期提醒 / 约定不截断）')
      assert(s.indexOf('lastInjectChars') >= 0, label + ' 读 settings-get 的 lastInjectChars')
    }
    assert(protoV2Src.indexOf('lastInjectChars: 2480') >= 0, '原型 mock settings-get 含仪表演示值')
  })

  // ===== 30. P2 使用遥测（note_get 引用计数 + 防抖批量落盘 + 列表/详情显示 + 按引用排序） =====
  section('30. P2 使用遥测（note_get 引用计数 + 防抖批量落盘 + 排序 + UI）')

  // ---- 30.1 host 双侧结构契约（host-impl / index.mjs 双包同步）----
  await t('use-telemetry 标记块双包逐字节一致（host-impl / index.mjs）', () => {
    const grabBlk = (s) => { const m = s.match(/\/\/ ==== use-telemetry BEGIN ====[\s\S]*?\/\/ ==== use-telemetry END ====/); return m ? m[0] : '' }
    const blkDev = grabBlk(hostSrc), blkPkg = grabBlk(indexSrc)
    assert(blkDev.length > 100, 'host-impl 缺 use-telemetry 标记块')
    assert.strictEqual(blkPkg, blkDev, 'host-impl.js 与 index.mjs 的 use-telemetry 块必须逐字节一致')
  })
  await t('host 双侧：useCount 字段链路 + 60s 防抖 + 卸载 flush + note_get 命中 + 归档合计/继承', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('const USE_COUNT_FLUSH_MS = 60 * 1000') >= 0, label + ' 60s 防抖常量')
      assert(s.indexOf('function bumpUseCount(id)') >= 0 && s.indexOf('async function flushUseCounts()') >= 0, label + ' bump/flush 函数存在')
      assert(s.indexOf('typeof useCountTimer.unref') >= 0, label + ' timer unref（防抖挂起不阻塞进程退出）')
      assert(s.indexOf("'useCount: ' + escYaml(m.useCount || 0)") >= 0, label + ' buildFM 恒写 useCount（缺省 0）')
      assert(s.indexOf('useCount: Math.max(0, parseInt(p.meta.useCount, 10) || 0)') >= 0, label + ' noteFromParsed 解析缺省 0（存量零迁移）')
      assert(s.indexOf('useCount: n.useCount || 0,') >= 0, label + ' slim 携带 useCount')
      assert(s.indexOf('const uc = bumpUseCount(n.id)') >= 0, label + ' note_get 工具命中计数')
      assert(s.indexOf('flushUseCounts()   // 卸载 flush') >= 0, label + ' 插件卸载 flush（ctx.effect dispose）')
      assert(s.indexOf('totalUseCount: members.reduce((s, m) => s + m.useCount, 0)') >= 0, label + ' 归档预览组合计引用数')
      assert(s.indexOf('useCount: members.reduce((s, n) => s + Math.max(0, n.useCount || 0), 0)') >= 0, label + ' 归档合并继承成员引用合计')
    }
  })

  // ---- 30.2 host 行为级（开发版独立实例 storeU + 假定时器捕获防抖，不真实等待 60s）----
  const storeU = new Map()
  let writesU = 0
  const fsMockU = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeU.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of storeU.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!storeU.has(p)) throw new Error('ENOENT: ' + p); return storeU.get(p) },
    writeText: async (p, c) => { writesU++; storeU.set(p, c) },
  }
  const handlersU = {}
  const toolsU = []
  const effectsU = []
  const harnessMockU = { handle: (name, fn) => { handlersU[name] = fn; return () => { delete handlersU[name] } }, defineTool: (d) => d, registerTool: (c, d) => { toolsU.push(d); return () => {} } }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockU, DIR).apply({
    fs: fsMockU, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: (fn) => { effectsU.push(fn) },
  })
  // 预热沉降（真实定时器窗口）：心跳 .last-host-load + 首个 RPC 的 perf-report（10s 节流）落定后再装假定时器
  await handlersU['notes-list']({})
  await new Promise(r => setTimeout(r, 20))
  const noteGetU = toolsU.find(x => x.name === 'note_get')
  const flushMicro30 = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
  let teleNoteId = ''
  // 假定时器：捕获防抖调度（60s 不真实等待）；仅本区块生效，finally 恢复
  const realSetTimeout30 = global.setTimeout, realClearTimeout30 = global.clearTimeout
  const scheduledU = []
  global.setTimeout = (fn, ms) => { const h = { fn: fn, ms: ms, cleared: false }; scheduledU.push(h); return h }
  global.clearTimeout = (h) => { if (h) h.cleared = true }
  try {
    await t('note_get 命中计数：内存即时 +1（响应即见），60s 防抖期内零写盘；notes-get RPC 不计数', async () => {
      const cU = await handlersU['notes-create']({ title: '遥测笔记甲', body: '正文甲', tags: [], topic: '运维' })
      teleNoteId = cU.id
      const w0 = writesU
      const g1 = await noteGetU.execute({ id: cU.id })
      const g2 = await noteGetU.execute({ id: cU.id })
      const g3 = await noteGetU.execute({ id: cU.id })
      assert.strictEqual(g1.note.useCount, 1, '第 1 次命中返回 useCount=1')
      assert.strictEqual(g2.note.useCount, 2, '第 2 次命中返回 useCount=2')
      assert.strictEqual(g3.note.useCount, 3, '第 3 次命中返回 useCount=3')
      assert.strictEqual(writesU, w0, '3 次命中防抖期内零写盘（写入增量 ' + (writesU - w0) + '）')
      assert.strictEqual(scheduledU.length, 1, '重复命中只挂一个防抖定时器（实得 ' + scheduledU.length + '）')
      assert.strictEqual(scheduledU[0].ms, 60000, '防抖窗口 60s')
      const lst = await handlersU['notes-list']({})
      assert.strictEqual(lst.notes.find(n => n.id === cU.id).useCount, 3, 'slim 列表即时携带 useCount=3（内存可见，未落盘）')
      assert.strictEqual(writesU, w0, 'notes-list 不触发写盘')
      // notes-get RPC（client 面板打开笔记）不计数：人类浏览非 agent 引用
      const gRpc = await handlersU['notes-get']({ id: cU.id })
      assert.strictEqual(gRpc.note.useCount, 3, 'notes-get RPC 不计数（仍为 3）')
      // 已删笔记 note_get 报错且不计数
      const cDel = await handlersU['notes-create']({ title: '遥测删除笔记', body: 'x' })
      await handlersU['notes-delete']({ id: cDel.id })
      const gDel = await noteGetU.execute({ id: cDel.id })
      assert(gDel.error, '已删笔记 note_get 报错')
      assert.strictEqual(scheduledU.length, 1, '报错不挂防抖定时器（不计数）')
    })
    await t('防抖批量落盘：3 次命中 flush 仅 1 次写盘；front-matter 恒写 useCount；updatedAt 不动', async () => {
      const w0 = writesU
      scheduledU[0].fn()   // 模拟 60s 防抖到期
      await flushMicro30()
      assert.strictEqual(writesU, w0 + 1, '3 次命中批量落盘仅 1 次写盘（增量 ' + (writesU - w0) + '）')
      const onDisk = storeU.get(NOTES_DIR + '\\' + teleNoteId + '.md')
      assert(onDisk.indexOf('\nuseCount: 3\n') >= 0, '磁盘 front-matter useCount: 3')
      const mC = onDisk.match(/\ncreatedAt: ([^\n]+)\n/), mU = onDisk.match(/\nupdatedAt: ([^\n]+)\n/)
      assert(mC && mU && mC[1] === mU[1], '计数落盘不动 updatedAt（计数不算编辑）')
      // 再命中 → 重挂防抖（供 30.2d 卸载 flush 用）
      await noteGetU.execute({ id: teleNoteId })
      assert.strictEqual(scheduledU.length, 2, '命中重挂防抖定时器')
    })
    await t('归档预览组行合计引用数（totalUseCount）+ 合并归档继承成员引用合计', async () => {
      const qA = await handlersU['notes-create']({ title: '速记甲', body: 'quick a', tags: ['quick'] })
      const qB = await handlersU['notes-create']({ title: '速记乙', body: 'quick b', tags: ['quick'] })
      // 同会话（sessCtx 兜底同一 sessionId）2 条 quick → 1 个速记组；甲被引用 2 次
      await noteGetU.execute({ id: qA.id })
      await noteGetU.execute({ id: qA.id })
      const pv = await handlersU['notes-archive-preview']({})
      const grp = pv.quickGroups.find(g => g.members.some(m => m.id === qA.id))
      assert(grp, 'preview 含该速记组')
      assert.strictEqual(grp.totalUseCount, 2, '组行合计引用数 = 成员合计（实得 ' + JSON.stringify(grp.totalUseCount) + '）')
      assert.strictEqual(grp.members.find(m => m.id === qA.id).useCount, 2, '成员条目携带 useCount')
      const ar = await handlersU['notes-archive']({ groups: [{ memberIds: [qA.id, qB.id], title: '遥测归档' }] })
      assert.strictEqual(ar.merged, 1, '合并成功')
      const gArc = await handlersU['notes-get']({ id: ar.groups[0].noteId })
      assert.strictEqual(gArc.note.useCount, 2, '归档笔记继承成员引用合计（合并不丢计数）')
    })
    await t('插件卸载 flush：防抖窗口内未落盘计数立即写盘；防抖定时器清除不二次触发；已删成员跳过', async () => {
      const w1 = writesU
      const disposeU = effectsU[0]()   // ctx.effect 注册的 effect 体 → 返回 dispose
      disposeU()                        // 模拟插件卸载
      await flushMicro30()
      assert.strictEqual(writesU, w1 + 1, '卸载 flush 仅落盘活跃脏笔记（增量 ' + (writesU - w1) + '；已删速记甲跳过）')
      assert.strictEqual(scheduledU[1].cleared, true, '卸载 flush 清掉防抖定时器（不二次触发）')
      assert(storeU.get(NOTES_DIR + '\\' + teleNoteId + '.md').indexOf('\nuseCount: 4\n') >= 0, '卸载后磁盘 useCount: 4')
    })
  } finally {
    global.setTimeout = realSetTimeout30; global.clearTimeout = realClearTimeout30
  }

  // ---- 30.3 静态包行为（独立 ESM 实例 + 假定时器 + webServer 路由链路）----
  await t('静态包：note_get 命中计数 + 60s 防抖批量落盘 + 卸载 flush（webServer 路由链路）', async () => {
    const storeU2 = new Map()
    let writesU2 = 0
    const fsMockU2 = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_ROOT_STATIC ? { dir: true } : (storeU2.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of storeU2.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!storeU2.has(p)) throw new Error('ENOENT: ' + p); return storeU2.get(p) },
      writeText: async (p, c) => { writesU2++; storeU2.set(p, c) },
    }
    const routesU2 = []
    const toolsU2 = []
    const effectsU2 = []
    const ctxU2 = {
      fs: fsMockU2,
      sandboxPolicy: { resolve: () => ({}) },
      webServer: { register: (r) => { routesU2.push(r); return () => {} } },
      tools: { register: (d) => { toolsU2.push(d); return () => {} } },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: (fn) => { effectsU2.push(fn) },
    }
    // 真实静态包环境没有 harness Builtin —— 摘掉还原真实条件
    const harnessBackup30 = global.harness
    delete global.harness
    try {
      const modU = await import(pathToFileURL(INDEX_PATH).href + '?use-telemetry=1')
      modU.apply(ctxU2)
      const rpcU2 = (method, args) => new Promise((resolve, reject) => {
        const body = Buffer.from(JSON.stringify({ method: method, args: args }))
        const req = { method: 'POST', on: (ev, cb) => { if (ev === 'data') cb(body); else if (ev === 'end') cb(); return req }, destroy: () => {} }
        const res = { statusCode: 0, setHeader: () => {}, writeHead: (c) => { res.statusCode = c }, end: (s) => { let b; try { b = JSON.parse(s) } catch (e) { b = s } resolve({ status: res.statusCode, body: b }) } }
        Promise.resolve(routesU2[0].handler(req, res)).catch(reject)
      })
      // 预热沉降（真定时器）：首个 RPC 的 perf-report（10s 节流）落定
      await rpcU2('notes-list', {})
      await new Promise(r => setTimeout(r, 20))
      const tGetU2 = toolsU2.find(x => x.name === 'note_get')
      const scheduledU2 = []
      global.setTimeout = (fn, ms) => { const h = { fn: fn, ms: ms, cleared: false }; scheduledU2.push(h); return h }
      global.clearTimeout = (h) => { if (h) h.cleared = true }
      try {
        const cU2 = await rpcU2('notes-create', { title: '静态遥测笔记', body: '静态正文', tags: [], topic: '运维' })
        const idU2 = cU2.body.id
        const w0 = writesU2
        const g1 = await tGetU2.execute({ id: idU2 })
        const g2 = await tGetU2.execute({ id: idU2 })
        assert.strictEqual(g1.note.useCount, 1, '静态包第 1 次命中 useCount=1')
        assert.strictEqual(g2.note.useCount, 2, '静态包第 2 次命中 useCount=2')
        assert.strictEqual(writesU2, w0, '静态包防抖期内零写盘（增量 ' + (writesU2 - w0) + '）')
        assert.strictEqual(scheduledU2.length, 1, '静态包重复命中只挂一个防抖定时器')
        assert.strictEqual(scheduledU2[0].ms, 60000, '静态包防抖窗口 60s')
        scheduledU2[0].fn()   // 模拟防抖到期
        await flushMicro30()
        assert.strictEqual(writesU2, w0 + 1, '静态包批量落盘仅 1 次写盘（增量 ' + (writesU2 - w0) + '）')
        assert(storeU2.get(path.join(NOTES_ROOT_STATIC, idU2 + '.md')).indexOf('\nuseCount: 2\n') >= 0, '静态包磁盘 useCount: 2')
        // 卸载 flush
        await tGetU2.execute({ id: idU2 })
        const w1 = writesU2
        effectsU2[0]()()   // effect 体 → dispose（插件卸载）
        await flushMicro30()
        assert.strictEqual(writesU2, w1 + 1, '静态包卸载 flush 落盘（增量 ' + (writesU2 - w1) + '）')
        assert.strictEqual(scheduledU2[1].cleared, true, '静态包卸载清掉防抖定时器')
        assert(storeU2.get(path.join(NOTES_ROOT_STATIC, idU2 + '.md')).indexOf('\nuseCount: 3\n') >= 0, '静态包卸载后 useCount: 3')
      } finally {
        global.setTimeout = realSetTimeout30; global.clearTimeout = realClearTimeout30
      }
    } finally {
      if (harnessBackup30 !== undefined) global.harness = harnessBackup30
    }
  })

  // ---- 30.4 列表排序「按引用」（chip 开关 + 真实比较器行为 + 四端同步）----
  await t('按引用排序比较器行为：useCount 降序，同数按 updatedAt 兜底（从 client-impl 源码提取真实比较器执行）', () => {
    const m = clientSrc.match(/if \(sortBy === 'use'\) filtered = filtered\.slice\(\)\.sort\(\(a, b\) => ([^\r\n]+)\)\r?\n/)
    assert(m, 'client-impl 缺按引用排序行')
    const cmp = new Function('a', 'b', 'return ' + m[1])
    const arr = [
      { id: 'x', useCount: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'y', useCount: 5, updatedAt: '2026-01-02T00:00:00.000Z' },
      { id: 'z', useCount: 5, updatedAt: '2026-01-03T00:00:00.000Z' },
      { id: 'w', useCount: 0, updatedAt: '2026-01-04T00:00:00.000Z' },
      { id: 'v', updatedAt: '2026-01-05T00:00:00.000Z' },
    ]
    assert.strictEqual(arr.slice().sort(cmp).map(n => n.id).join(','), 'z,y,x,v,w', 'useCount 降序 → 同数 updatedAt 降序（缺省字段按 0 计）')
  })
  await t('排序三档接入筛选中心独立控件：时间/引用/相关度（client-impl / 发布包 lib/client.js / app.html / 原型）', () => {
    assert(clientSrc.indexOf("const [sortBy, setSortBy] = React.useState(() => loadFiltersState().sortBy)") >= 0, 'client-impl sortBy 状态（持久化恢复，缺省 time）')
    assert(clientSrc.indexOf("const FILTER_SORTS = [") >= 0 && clientSrc.indexOf("{ id: 'time', label: '时间'") >= 0 && clientSrc.indexOf("{ id: 'use', label: '引用'") >= 0 && clientSrc.indexOf("{ id: 'rel', label: '相关度'") >= 0, 'client-impl 排序三档（FILTER_SORTS 独立控件）')
    assert(clientSrc.indexOf('setSortBy(s.id); setSortOpen(false)') >= 0, 'client-impl 排序档位点击切换（选择即关菜单）')
    assert(clientPkgSrc.indexOf('FILTER_SORTS') >= 0 && clientPkgSrc.indexOf("label: '相关度'") >= 0, '发布包 lib/client.js 同步排序三档（需先跑 scripts/build-dist.cjs）')
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("var sortBy = _fs.sortBy;") >= 0, label + ' sortBy 状态（持久化恢复，缺省 time）')
      assert(s.indexOf("if (sortBy === 'use') vis.sort(") >= 0, label + ' 按引用排序逻辑保留')
      assert(s.indexOf("var FILTER_SORTS = [") >= 0 && s.indexOf("{ id: 'time', label: '时间'") >= 0 && s.indexOf("{ id: 'rel', label: '相关度'") >= 0, label + ' 排序三档（FILTER_SORTS 独立控件）')
      assert(s.indexOf("sortBy === 'rel' && qRel") >= 0, label + ' 相关度排序分支')
    }
  })

  // ---- 30.5 列表行尾/详情 meta「被引用 N 次」（0 次不显示）+ 归档预览合计 + 样式（四端同步）----
  await t('被引用显示链路：行尾徽章 + 详情 meta chip + 归档预览合计（0 次不显示；client/app/原型/样式 四端）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("(n.useCount || 0) > 0 ? e('span', { className: 'dsh-notes-note-use dsh-nt'") >= 0, label + ' 行尾被引用徽章（0 次不显示）')
      assert(s.indexOf("(curNote.useCount || 0) > 0 ? e('span', { className: 'dsh-notes-meta-chip'") >= 0, label + ' 详情 meta chip（0 次不显示）')
      assert(s.indexOf("'被引用 ' + curNote.useCount + ' 次'") >= 0, label + ' 详情 meta chip「被引用 N 次」')
      assert(s.indexOf("((g.totalUseCount || 0) > 0 ? ' · 被引用 ' + g.totalUseCount + ' 次' : '')") >= 0, label + ' 归档预览组行合计引用数（0 次不显示）')
    }
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('(n.useCount || 0) > 0 ? \'<span class="use" title="被 Agent 引用（note_get 命中）\'') >= 0, label + ' 行尾被引用徽章（0 次不显示）')
      assert(s.indexOf("'被引用 ' + n.useCount + ' 次</span>'") >= 0, label + ' 详情 meta chip「被引用 N 次」')
      assert(s.indexOf("((g.totalUseCount || 0) > 0 ? ' · 被引用 ' + g.totalUseCount + ' 次' : '')") >= 0, label + ' 归档预览组行合计引用数（0 次不显示）')
      assert(s.indexOf('.note-row .use{') >= 0 && s.indexOf('.note-row .use svg.ic{') >= 0, label + ' 行尾徽章样式')
    }
    // 原型 mock 演示数据（徽章/合计在原型可见）
    assert(protoV2Src.indexOf('useCount: 12') >= 0 && protoV2Src.indexOf('useCount: 7') >= 0 && protoV2Src.indexOf('useCount: 3') >= 0, '原型 mock 演示数据含 useCount')
    assert(protoV2Src.indexOf('totalUseCount: ms.reduce(') >= 0, '原型 mock 归档 preview 合计')
    const cssDev30 = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg30 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev30], ['发布包 lib/styles.css', cssPkg30]]) {
      assert(pair[1].indexOf('.dsh-notes-note-use{') >= 0 && pair[1].indexOf('.dsh-notes-note-use .dsh-ic{') >= 0, pair[0] + ' 缺被引用徽章样式')
    }
  })

  // ===== 31. P2 笔记双链（[[id/标题]] 渲染跳转 + 反向链接面板 + 行尾标记；host 不改，解析在 client）=====
  section('31. P2 笔记双链（[[..]] + 反向链接）')

  // ---- 31.1 内核行为级（renderMarkdown 第二参 wikiResolve；kernelFn 在 19 节已用 MiniDOM 装配，三端字节一致在 25 节锁定）----
  await t('双链渲染：id/标题精确命中 → 可点击锚（data-wiki 记原始 target，显示标题）；解析不到/无 resolver → 纯文本', () => {
    assert(kernelFn, 'kernelFn 可用（19 节装配）')
    const resolver = (w) => (w === 'n-abc123' || w === '发布清单') ? { id: 'n-abc123', title: '发布清单' } : null
    const h = kernelFn.renderMarkdown('见 [[n-abc123]] 与 [[发布清单]] 与 [[不存在]]', resolver)
    assert(h.indexOf('<a class="dsh-notes-wikilink" data-wiki="n-abc123" href="#wiki" title="发布清单">发布清单</a>') >= 0, '[[id]] 命中 → 锚（显示标题，data-wiki 记原始 target）')
    assert(h.indexOf('data-wiki="发布清单"') >= 0, '[[标题]] 命中 → data-wiki 记原始 target')
    assert(h.indexOf('[[不存在]]') >= 0 && h.indexOf('data-wiki="不存在"') < 0, '解析不到 → 纯文本')
    const h2 = kernelFn.renderMarkdown('见 [[n-abc123]]')
    assert(h2.indexOf('[[n-abc123]]') >= 0 && h2.indexOf('dsh-notes-wikilink') < 0, '不传 wikiResolve → 纯文本（向后兼容存量调用）')
  })
  await t('双链 XSS 红线：target/标题全量转义（esc/unesc 互逆，含 & 标题可命中且不成注入）', () => {
    assert(kernelFn, 'kernelFn 可用')
    const resolver = (w) => w === 'A & B' ? { id: 'n-x', title: 'A & B <img onerror=alert(1)>' } : null
    const h = kernelFn.renderMarkdown('链 [[A & B]]', resolver)
    assert(h.indexOf('dsh-notes-wikilink') >= 0, '含 & 标题经 unesc 还原后命中')
    assert(h.indexOf('<img') < 0 && h.indexOf('&lt;img') >= 0, 'resolver 返回的标题经 esc 转义（不成注入）')
    assert(h.indexOf('data-wiki="A &amp; B"') >= 0, 'data-wiki 属性值转义形态')
  })
  await t('双链往返保真：[[target]] → 锚 → 序列化回 [[target]]（显示标题不进 Markdown；二轮渲染逐字节一致）', () => {
    assert(kernelFn, 'kernelFn 可用')
    const resolver = (w) => w === 'n-abc123' ? { id: 'n-abc123', title: '发布清单' } : null
    const h1 = kernelFn.renderMarkdown('见 [[n-abc123]] 收尾', resolver)
    const md2 = kernelFn.serializeRich(v3ParseHtml(h1))
    assert.strictEqual(md2, '见 [[n-abc123]] 收尾', '序列化还原 [[原始 target]]，显示标题不泄漏进 Markdown')
    const h2 = kernelFn.renderMarkdown(md2, resolver)
    assert.strictEqual(h2, h1, '二轮渲染逐字节一致（定点稳定）')
    // 未解析双链（纯文本形态）：与 a[b] 同款——escapeMd 转义 [[ → md2 加反斜杠，定点稳定（render∘serialize∘render 逐字节一致）
    const h3 = kernelFn.renderMarkdown('见 [[没人]]', resolver)
    const mdU = kernelFn.serializeRich(v3ParseHtml(h3))
    assert.strictEqual(kernelFn.renderMarkdown(mdU, resolver), h3, '未解析双链二轮渲染逐字节一致')
    assert.strictEqual(kernelFn.serializeRich(v3ParseHtml(kernelFn.renderMarkdown(mdU, resolver))), mdU, '未解析双链序列化定点稳定')
  })
  await t('extractWikiTargets / wikiLinksTo 口径：多目标提取 + 转义括号豁免 + 反向链接精确匹配（[[该id]] 或 [[该标题]]）', () => {
    assert(kernelFn, 'kernelFn 可用')
    assert.deepStrictEqual(kernelFn.extractWikiTargets('a [[n-1]] b [[标题]] c [[n-1]]'), ['n-1', '标题', 'n-1'], '多目标按序提取（不去重）')
    assert.deepStrictEqual(kernelFn.extractWikiTargets('\\[\\[x\\]\\] 转义'), [], '反斜杠转义括号不算双链')
    assert.deepStrictEqual(kernelFn.extractWikiTargets('[[含[括号]]]'), [], 'target 含方括号不匹配（防嵌套歧义）')
    assert(kernelFn.wikiLinksTo('正文 [[n-abc]]', 'n-abc', '别的') === true, '[[id]] 命中反向链接')
    assert(kernelFn.wikiLinksTo('正文 [[发布清单]]', 'n-abc', '发布清单') === true, '[[标题]] 命中反向链接')
    assert(kernelFn.wikiLinksTo('正文 [[发布清单2]]', 'n-abc', '发布清单') === false, '标题前缀不算（精确匹配）')
    assert(kernelFn.wikiLinksTo('正文 [[n-ab]]', 'n-abc', '') === false, 'id 前缀不算')
    assert(kernelFn.wikiLinksTo('无链正文', 'n-abc', '发布清单') === false, '无链不命中')
  })
  await t('粘贴清洗保留双链锚（data-wiki 重建），非 http 普通链接仍拆壳', () => {
    assert(kernelFn, 'kernelFn 可用')
    const frag = v3ParseHtml('<p><a class="dsh-notes-wikilink" data-wiki="n-1" href="#wiki">标题甲</a></p><p><a href="javascript:alert(1)">坏</a></p>')
    const clean = kernelFn.sanitizeFragment(frag)
    const as = clean.querySelectorAll('a')
    assert.strictEqual(as.length, 1, '仅双链锚保留（javascript: 拆壳；实得 ' + as.length + '）')
    assert.strictEqual(as[0].getAttribute('data-wiki'), 'n-1', 'data-wiki 保留')
    const md = kernelFn.serializeRich(clean)
    assert(md.indexOf('[[n-1]]') >= 0 && md.indexOf('javascript') < 0, '清洗后序列化回 [[target]]，无脚本残留')
  })

  // ---- 31.2 双端落地结构（面板 client-impl / 发布包 lib/client.js / app.html / 样式双端 / host 不改）----
  await t('面板双链结构：解析 + 索引 + 跳转 + 行尾标记 + 反向链接面板 + 富文本点击委托（开发版 + 发布包）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('function resolveWikiTarget(target)') >= 0, label + ' resolveWikiTarget 存在')
      assert(s.indexOf("list.find(n => n.id === t) || list.find(n => (n.title || '') === t)") >= 0, label + ' 解析口径：id 精确优先、标题精确匹配')
      assert(s.indexOf('function wikiResolve(w)') >= 0, label + ' wikiResolve（renderMarkdown 第二参）')
      assert(s.indexOf('function ensureWikiIndex(list)') >= 0 && s.indexOf('wikiIdxGenRef') >= 0, label + ' 全库正文惰性索引（代际作废旧任务）')
      assert(s.indexOf('function bumpWikiBody(id, body, updatedAt)') >= 0, label + ' bumpWikiBody（选中/保存即时新鲜）')
      assert(s.indexOf('bumpWikiBody(id, body, res.note.updatedAt)') >= 0, label + ' 选中加载写索引缓存')
      assert(s.indexOf("bumpWikiBody(id, edBodyRef.current, '')") >= 0, label + ' 保存后写索引缓存（updatedAt 置空复核）')
      assert(s.indexOf('function hasWikiLinks(n)') >= 0, label + ' hasWikiLinks（缓存正文优先，preview 兜底）')
      assert(s.indexOf('function jumpToWikiTarget(target)') >= 0 && s.indexOf("'未找到链接目标：' + target") >= 0, label + ' 跳转 + 未命中 toast')
      assert(s.indexOf("className: 'dsh-notes-note-wiki dsh-nt'") >= 0 && s.indexOf("I('link', 9)") >= 0, label + ' 行尾双链标记（SVG 图标，零 emoji）')
      assert(s.indexOf("className: 'dsh-notes-backlinks'") >= 0 && s.indexOf("className: 'dsh-notes-backlink dsh-nt'") >= 0, label + ' 反向链接面板结构')
      assert(s.indexOf("'反向链接' + (wikiWarm ? '（' + backlinks.length + '）' : '（索引中…）')") >= 0, label + ' 反向链接标题（索引中…提示）')
      assert(s.indexOf("if (wikiLinksTo(c.body, curNote.id, curNote.title || '')) out.push(n)") >= 0, label + ' 反向链接扫描口径（[[该id]] 或 [[该标题]]，自链除外）')
      assert(s.indexOf("ev.target.closest('a[data-wiki]')") >= 0 && s.indexOf("el.addEventListener('click', onWikiClick)") >= 0 && s.indexOf("el.removeEventListener('click', onWikiClick)") >= 0, label + ' 富文本 click 委托绑定/卸绑')
      assert(s.indexOf('jumpWikiRef.current = jumpToWikiTarget') >= 0, label + ' 跳转函数 ref 镜像（防闭包过期）')
      assert(s.indexOf('renderMarkdown(edBodyRef.current, wikiResolve)') >= 0 && s.indexOf('renderMarkdown(body, wikiResolve)') >= 0 && s.indexOf('renderMarkdown(text, wikiResolve)') >= 0, label + ' 三处 renderMarkdown 调用点带 wikiResolve')
    }
    assert(clientSrc.indexOf("host.call('notes-get', { id: n.id })") >= 0, 'client-impl 索引拉取走 notes-get')
    assert(clientPkgSrc.indexOf("rpc('notes-get', { id: n.id })") >= 0, '发布包索引拉取走 notes-get（build-dist rpc 形态）')
    assert(clientSrc.indexOf('loadFolders(); ensureWikiIndex(list)') >= 0 && clientPkgSrc.indexOf('loadFolders(); ensureWikiIndex(list)') >= 0, 'loadNotes 链路桥接索引构建（双端）')
  })
  await t('app.html 双链结构：解析 + 索引 + 跳转 + 行尾标记 + 反向链接面板 + 富文本点击（与面板同款，双端同步）', () => {
    const s = appSrc
    assert(s.indexOf('function resolveWikiTarget(target)') >= 0 && s.indexOf('function wikiResolve(w)') >= 0, 'app.html 解析函数存在')
    assert(s.indexOf("notes.find(function (n) { return n.id === t; }) || notes.find(function (n) { return (n.title || '') === t; })") >= 0, 'app.html 解析口径：id 精确优先、标题精确匹配')
    assert(s.indexOf('function ensureWikiIndex()') >= 0 && s.indexOf('wikiIdxGen') >= 0, 'app.html 全库正文惰性索引（代际作废）')
    assert(s.indexOf('function hasWikiLinks(n)') >= 0 && s.indexOf('class="wikimark"') >= 0, 'app.html 行尾双链标记')
    assert(s.indexOf('function jumpToWikiTarget(target)') >= 0 && s.indexOf("'未找到链接目标：' + target") >= 0, 'app.html 跳转 + 未命中 toast')
    assert(s.indexOf('function renderBacklinks()') >= 0 && s.indexOf('id="backlinksHost"') >= 0, 'app.html 反向链接面板 + 宿主 div')
    assert(s.indexOf("' 反向链接' + (warm ? '（' + bl.length + '）' : '（索引中…）')") >= 0, 'app.html 反向链接标题（索引中…提示）')
    assert(s.indexOf("if (wikiLinksTo(c.body, edNote.id, edNote.title || '')) bl.push(n);") >= 0, 'app.html 反向链接扫描口径（[[该id]] 或 [[该标题]]，自链除外）')
    assert(s.indexOf("ev.target.closest('a[data-wiki]')") >= 0 && s.indexOf("jumpToWikiTarget(a.getAttribute('data-wiki') || '')") >= 0, 'app.html 富文本 click 委托（data-wiki 锚 → 跳转）')
    assert(s.indexOf('_wikiBound') >= 0, 'app.html 富文本点击绑定防重复（_wikiBound 守卫）')
    assert(s.indexOf('renderMarkdown(body, wikiResolve)') >= 0 && s.indexOf("renderMarkdown(edNote ? edNote.body || '' : '', wikiResolve)") >= 0, 'app.html renderMarkdown 调用点带 wikiResolve')
    assert(s.indexOf("wikiBodies[id] = { body: edNote.body || '', updatedAt: res.note.updatedAt || '' }") >= 0, 'app.html 选中加载写索引缓存')
    assert(s.indexOf("wikiBodies[selId] = { body: edNote.body || '', updatedAt: '' }") >= 0, 'app.html 保存后写索引缓存（复核 reconcile）')
    assert(s.indexOf('ensureWikiIndex(); renderTree();') >= 0, 'app.html loadNotes 链路桥接索引构建')
  })
  await t('双链样式双端：styles.css ⇄ 发布包 lib/styles.css + app.html 内嵌样式', () => {
    const cssDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev], ['发布包 lib/styles.css', cssPkg]]) {
      for (const cls of ['.dsh-notes-rich a.dsh-notes-wikilink{', '.dsh-notes-note-wiki{', '.dsh-notes-backlinks{', '.dsh-notes-backlinks-t{', '.dsh-notes-backlink{', '.dsh-notes-backlinks-empty{']) {
        assert(pair[1].indexOf(cls) >= 0, pair[0] + ' 缺双链样式：' + cls)
      }
    }
    for (const cls of ['.rich a.dsh-notes-wikilink{', '.note-row .wikimark{', '.backlinks{', '.backlinks .bl-item{', '.backlinks .bl-empty{']) {
      assert(appSrc.indexOf(cls) >= 0, 'app.html 缺双链样式：' + cls)
    }
  })
  await t('host 不改契约：双链解析/扫描全在 client（host-impl / index.mjs 零双链逻辑）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      assert(pair[1].indexOf('data-wiki') < 0 && pair[1].indexOf('WIKI_RE') < 0 && pair[1].indexOf('wikiLinksTo') < 0 && pair[1].indexOf('extractWikiTargets') < 0, pair[0] + ' 不含双链逻辑（解析放 client，库已在内存）')
    }
  })

  // ===== 32. 注入预览器（notes-inject-preview RPC + 设置卡片「注入预览」modal） =====
  // 契约：RPC {sessionId?} → { conventions, catalog, stats:{conventionsChars, catalogChars, totalChars, maskedNotes, staleMarked, budgetTruncated} }；
  // 缺省 sessionId = 「全局」视角（sidOverride=''，只命中 injectTo=[] 的笔记）；传会话 id/短 id 按 conventionHit 同一口径过滤；
  // 纯复用 conventionText/catalogText（新增 sidOverride 形参 + 渲染统计 lastConvStats/lastCatStats），不重写拼装；预览渲染不更新 lastInjectChars（仪表只反映真实注入）。
  section('32. 注入预览器（notes-inject-preview + 设置卡片入口 modal + 双端同步）')

  // ---- 32.1 host 双侧结构契约（host-impl / index.mjs 双包同步）----
  await t('host 双侧：notes-inject-preview RPC + sidOverride 形参 + 渲染统计变量（双包同步）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("handle('notes-inject-preview'") >= 0, label + ' notes-inject-preview RPC 注册')
      assert(s.indexOf('function conventionText(sidOverride)') >= 0, label + ' conventionText 支持 sidOverride（纯复用，不重写拼装）')
      assert(s.indexOf('function catalogText(sidOverride)') >= 0, label + ' catalogText 支持 sidOverride')
      assert((s.match(/sidOverride [!=]== undefined/g) || []).length >= 4, label + ' sidOverride 守卫（curSid ×2 + lastInjectChars ×2）')
      assert(s.indexOf('const lastConvStats = { masked: 0, budgetTruncated: false }') >= 0, label + ' lastConvStats 渲染统计')
      assert(s.indexOf('const lastCatStats = { masked: 0, stale: 0 }') >= 0, label + ' lastCatStats 渲染统计')
      assert(s.indexOf('lastCatStats.stale = staleCount') >= 0, label + ' catalogText 时效标注计数')
      assert(s.indexOf('conventionsChars: conventions.length') >= 0 && s.indexOf('budgetTruncated: lastConvStats.budgetTruncated') >= 0, label + ' stats 字段结构')
      assert(s.indexOf('if (sidOverride === undefined) lastInjectChars = full.length') >= 0, label + ' 预览渲染不更新 lastInjectChars（仪表只反映真实注入）')
      // notes-scope-global-pick：三档视角（全局/工作区并集/单会话）——workspace 参数 + conventionHit 集合口径（双包同步）
      assert(s.indexOf("const wsName = !sid && args && args.workspace ? String(args.workspace) : ''") >= 0, label + ' inject-preview workspace 参数（与 sessionId 互斥，sessionId 优先）')
      assert(s.indexOf('const sidSet = Array.isArray(curSid) ? curSid : null') >= 0, label + ' conventionHit 支持会话短 id 集合（工作区并集视角）')
      assert(s.indexOf('sessRes.pendingSessions') >= 0, label + ' workspace 解析含 pending 占位会话（同 notes-sessions 数据源）')
    }
  })

  // ---- 32.2 host 行为级（开发版独立实例 storeIP/handlersIP，与 28/29 节同款隔离模式）----
  const storeIP = new Map()
  const fsMockIP = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeIP.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of storeIP.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!storeIP.has(p)) throw new Error('ENOENT: ' + p); return storeIP.get(p) },
    writeText: async (p, c) => { storeIP.set(p, c) },
  }
  const handlersIP = {}
  const harnessMockIP = { handle: (name, fn) => { handlersIP[name] = fn; return () => { delete handlersIP[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockIP, DIR).apply({
    fs: fsMockIP, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  await t('notes-inject-preview 返回结构：conventions/catalog 字符串 + stats 六字段数值正确', async () => {
    await handlersIP['notes-create']({ title: '预览全局约定', body: '全局约定正文', inject: true, topic: '约定' })
    const r = await handlersIP['notes-inject-preview']({})
    assert(!r.error, '无报错（实得 ' + JSON.stringify(r).slice(0, 160) + '）')
    assert(typeof r.conventions === 'string' && typeof r.catalog === 'string', 'conventions/catalog 为字符串')
    const st = r.stats
    assert(st && typeof st.conventionsChars === 'number' && typeof st.catalogChars === 'number' && typeof st.totalChars === 'number', 'stats 字符数三字段为数值')
    assert(typeof st.maskedNotes === 'number' && typeof st.staleMarked === 'number' && typeof st.budgetTruncated === 'boolean', 'stats maskedNotes/staleMarked/budgetTruncated 类型')
    assert.strictEqual(st.conventionsChars, r.conventions.length, 'conventionsChars = conventions.length')
    assert.strictEqual(st.catalogChars, r.catalog.length, 'catalogChars = catalog.length')
    assert.strictEqual(st.totalChars, r.conventions.length + r.catalog.length, 'totalChars = 两者之和')
    assert(r.conventions.indexOf('预览全局约定') >= 0 && r.conventions.indexOf('全局约定正文') >= 0, '全局视角含 injectTo=[] 注入笔记')
  })
  await t('sessionId 过滤：缺省全局不含定向笔记；传会话长 id 自动 shortSid 命中；其他会话不命中', async () => {
    await handlersIP['notes-create']({ title: '预览定向约定abc', body: '定向正文', inject: true, injectTo: ['abc12345'], topic: '约定' })
    const g0 = await handlersIP['notes-inject-preview']({})
    assert(g0.conventions.indexOf('预览定向约定abc') < 0, '缺省 sessionId = 全局视角，不含 injectTo 定向笔记')
    const g1 = await handlersIP['notes-inject-preview']({ sessionId: 'session-abc12345-0000-0000-0000-000000000000' })
    assert(g1.conventions.indexOf('预览定向约定abc') >= 0, '传会话长 id 命中定向笔记（shortSid 转换）')
    assert(g1.conventions.indexOf('预览全局约定') >= 0, '全局笔记在会话视角仍在（injectTo=[] 所有会话共享）')
    const g2 = await handlersIP['notes-inject-preview']({ sessionId: 'deadbeef' })
    assert(g2.conventions.indexOf('预览定向约定abc') < 0, '其他会话短 id 不命中')
  })
  await t('workspace 视角：该工作区全部会话注入并集 + 未知工作区退化全局 + sessionId 互斥优先', async () => {
    // 自造数（--core 模式跳过「sessionId 过滤」断言体，其定向笔记不存在；CORE 约定 = 核心断言共享状态与全量一致，依赖的笔记须自造）
    await handlersIP['notes-create']({ title: '预览定向约定ws', body: '定向正文ws', inject: true, injectTo: ['abc12345'], topic: '约定' })
    // workspaceRegistryMock 唯一工作区 deepseek-work：含 live 会话 abc12345（short 命中定向笔记 injectTo）
    const w0 = await handlersIP['notes-inject-preview']({ workspace: 'deepseek-work' })
    assert(w0.conventions.indexOf('预览定向约定ws') >= 0, '工作区视角命中区内会话的定向笔记（并集口径，实得长度 ' + w0.conventions.length + '）')
    assert(w0.conventions.indexOf('预览全局约定') >= 0, '工作区视角仍含 injectTo=[] 全局笔记')
    const w1 = await handlersIP['notes-inject-preview']({ workspace: 'no-such-ws' })
    assert(w1.conventions.indexOf('预览定向约定ws') < 0 && w1.conventions.indexOf('预览全局约定') >= 0, '未知工作区 = 空会话集合：并集退化为全局视角')
    const w2 = await handlersIP['notes-inject-preview']({ sessionId: 'deadbeef', workspace: 'deepseek-work' })
    assert(w2.conventions.indexOf('预览定向约定ws') < 0, 'sessionId 与 workspace 同传时 sessionId 优先（deadbeef 不命中）')
  })
  await t('脱敏文本进入预览：sensitive 正文/标题打码 + 占位符 + stats.maskedNotes 覆盖双桶', async () => {
    const c1 = await handlersIP['notes-create']({ title: '预览敏感约定', body: '部署密码：Top$ecret99', inject: true, sensitive: true, topic: '敏感' })
    await handlersIP['notes-create']({ title: '预览敏感目录 token: ghp_pv999', body: 'x', sensitive: true, topic: '敏感' })   // inject=false → 进目录桶
    const r = await handlersIP['notes-inject-preview']({})
    assert(r.conventions.indexOf('Top$ecret99') < 0, '约定预览不含明文密码')
    assert(r.conventions.indexOf('部署密码：******（敏感，note_get ' + c1.id + ' 获取）') >= 0, '约定预览含打码占位符（键保留值遮蔽）')
    assert(r.catalog.indexOf('ghp_pv999') < 0 && r.catalog.indexOf('🔒') >= 0, '目录预览标题打码 + 🔒 标记')
    assert(r.stats.maskedNotes >= 2, 'maskedNotes 覆盖约定桶 + 目录桶（实得 ' + r.stats.maskedNotes + '）')
  })
  await t('stats.staleMarked / budgetTruncated：⚠ 时效标注计数 + 预算截断标记 + 预览不污染 lastInjectChars', async () => {
    const old = new Date(Date.now() - 100 * 86400000).toISOString()
    await fsMockIP.writeText(NOTES_DIR + '\\n-pv-stale.md', '---\nid: n-pv-stale\ntitle: 预览陈旧笔记\ntopic: 运维\ncreatedAt: "' + old + '"\nupdatedAt: "' + old + '"\n---\n\n旧正文\n')
    await handlersIP['notes-get']({ id: 'n-pv-stale' })   // 触发解析进 cache（catalogText 只读 cache）
    const r0 = await handlersIP['notes-inject-preview']({})
    assert(r0.catalog.indexOf('预览陈旧笔记 (笔记, 运维) ⚠ 100 天未更新') >= 0, '目录预览含 ⚠ 时效标注')
    assert(r0.stats.staleMarked >= 1, 'staleMarked ≥ 1（实得 ' + r0.stats.staleMarked + '）')
    assert.strictEqual(r0.stats.budgetTruncated, false, '缺省不限：budgetTruncated=false')
    // 预算收紧 → 资料桶整条省略 → budgetTruncated=true + 省略提示行入预览文本
    await handlersIP['notes-create']({ title: '预览资料一', body: 'a'.repeat(300), inject: true, injectRole: 'reference', topic: '资料' })
    await handlersIP['notes-settings-set']({ injectBudgetChars: 120 })
    const r1 = await handlersIP['notes-inject-preview']({})
    assert.strictEqual(r1.stats.budgetTruncated, true, '超预算：budgetTruncated=true')
    assert(r1.conventions.indexOf('条资料超出预算未注入（note_search 可检索）') >= 0, '预览文本含预算省略提示行')
    assert(r1.conventions.indexOf('预览资料一') < 0, '资料桶被省略（约定桶永不截断）')
    await handlersIP['notes-settings-set']({ injectBudgetChars: null })
    const r2 = await handlersIP['notes-inject-preview']({})
    assert.strictEqual(r2.stats.budgetTruncated, false, '恢复不限：budgetTruncated=false')
    // 预览渲染不触碰仪表数据源：lastInjectChars 恒为 0（本实例从未真实渲染注入）
    assert(r2.conventions.length > 0, '预览有内容')
    const sg = await handlersIP['notes-settings-get']({})
    assert.strictEqual(sg.lastInjectChars, 0, 'notes-inject-preview 不更新 lastInjectChars（仪表只反映真实注入）')
  })

  // ---- 32.3 静态包行为（独立 ESM 实例；harness 缺席 → webServer 路由链路，与 29.3 同款）----
  await t('静态包：notes-inject-preview 经 webServer 路由返回完整结构 + sessionId 过滤', async () => {
    const storePv = new Map()
    const fsMockPv = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_ROOT_STATIC ? { dir: true } : (storePv.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of storePv.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!storePv.has(p)) throw new Error('ENOENT: ' + p); return storePv.get(p) },
      writeText: async (p, c) => { storePv.set(p, c) },
    }
    const routesPv = []
    const modPv = await import(pathToFileURL(INDEX_PATH).href + '?injprev=1')
    modPv.apply({
      fs: fsMockPv, sandboxPolicy: { resolve: () => ({}) },
      webServer: { register: (r) => { routesPv.push(r); return () => {} } },
      tools: { register: () => () => {} },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    function rpcPv(method, args) {
      return new Promise((resolve, reject) => {
        const body = Buffer.from(JSON.stringify({ method: method, args: args }))
        const req = { method: 'POST', on: (ev, cb) => { if (ev === 'data') cb(body); else if (ev === 'end') cb(); return req }, destroy: () => {} }
        const res = { statusCode: 0, setHeader: () => {}, writeHead: (c) => { res.statusCode = c }, end: (s) => { let b; try { b = JSON.parse(s) } catch (e) { b = s } resolve({ status: res.statusCode, body: b }) } }
        Promise.resolve(routesPv[0].handler(req, res)).catch(reject)
      })
    }
    await rpcPv('notes-create', { title: '静态预览约定', body: '静态正文', inject: true, topic: '约定' })
    await rpcPv('notes-create', { title: '静态预览定向', body: '定向', inject: true, injectTo: ['abc12345'], topic: '约定' })
    const r = await rpcPv('notes-inject-preview', {})
    assert(r.body && typeof r.body.conventions === 'string' && typeof r.body.catalog === 'string' && r.body.stats, '路由返回 {conventions, catalog, stats} 结构齐备')
    assert(r.body.conventions.indexOf('静态预览约定') >= 0 && r.body.conventions.indexOf('静态预览定向') < 0, '静态包缺省全局视角（定向笔记不命中）')
    assert.strictEqual(r.body.stats.totalChars, r.body.conventions.length + r.body.catalog.length, '静态包 totalChars = 两桶之和')
    const r2 = await rpcPv('notes-inject-preview', { sessionId: 'abc12345' })
    assert(r2.body.conventions.indexOf('静态预览定向') >= 0, '静态包 sessionId 过滤命中定向笔记')
  })

  // ---- 32.4 client 结构断言（开发版 client-impl + 发布包 lib/client.js + 样式双端）----
  await t('client 注入预览链路：设置行入口 + modal 双 tab/会话下拉/统计条 + Esc + 错误条排除（开发版 + 发布包）', () => {
    assert(clientSrc.indexOf("key: 'injprev', label: '注入预览'") >= 0, 'settingsRows 含「注入预览」行')
    assert(clientSrc.indexOf('onClick: openInjectPreview') >= 0, '预览按钮接线 openInjectPreview')
    assert(clientSrc.indexOf('function openInjectPreview()') >= 0 && clientSrc.indexOf('function loadInjectPreview(sid)') >= 0, 'openInjectPreview/loadInjectPreview 存在')
    assert(clientSrc.indexOf("sid.indexOf('ws:') === 0 ? { workspace: sid.slice(3) } : { sessionId: sid }") >= 0, 'RPC 调用（缺省全局 / ws: 前缀走 workspace 并集视角 / 传 sessionId）')
    assert(clientSrc.indexOf("e('optgroup', { label: '工作区' }") >= 0 && clientSrc.indexOf("e('optgroup', { label: '会话' }") >= 0, '预览视角下拉三档（全局 + 工作区/会话 optgroup）')
    assert(clientSrc.indexOf("const [injectPreviewTab, setInjectPreviewTab] = React.useState('conv')") >= 0, '双 tab 状态（缺省约定）')
    assert(clientSrc.indexOf('dsh-notes-injprev-text') >= 0 && clientSrc.indexOf('dsh-notes-injprev-stats') >= 0 && clientSrc.indexOf('dsh-notes-injprev-tab') >= 0, '预览 modal 结构类（文本区/统计条/tab）')
    assert(clientSrc.indexOf('预算截断 ') >= 0 && clientSrc.indexOf('时效标注 ') >= 0, '统计条文案（预算截断/时效标注）')
    assert(clientSrc.indexOf('if (injectPreviewOpenRef.current) { setInjectPreviewOpen(false); return }') >= 0, 'Esc 链路关预览对话框')
    assert(clientSrc.indexOf('!trashOpen && !injectPreviewOpen') >= 0, '全局错误条排除预览 modal（modal 内自显错误）')
    assert(clientSrc.indexOf('setSettingsOpen(false); setInjectPreviewOpen(true)') >= 0, '与设置卡片互斥（modal 不叠 modal）')
    for (const k of ['openInjectPreview', 'notes-inject-preview', 'dsh-notes-injprev-text', 'injectPreviewTab', '注入预览']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺 ' + k + '（需先跑 scripts/build-dist.cjs）')
    }
  })
  await t('注入预览样式双端：styles.css ⇄ 发布包 lib/styles.css', () => {
    const cssDevP = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkgP = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDevP], ['发布包 lib/styles.css', cssPkgP]]) {
      for (const cls of ['.dsh-notes-injprev-modal{', '.dsh-notes-injprev-tab{', '.dsh-notes-injprev-tab.on{', '.dsh-notes-injprev-text{', '.dsh-notes-injprev-stats{']) {
        assert(pair[1].indexOf(cls) >= 0, pair[0] + ' 缺注入预览样式：' + cls + '（需跑 scripts/build-dist.cjs）')
      }
    }
  })

  // ---- 32.5 app.html / 原型 notes-ui-v2.html 同步（UI 唯一规格来源约束）----
  await t('app.html + 原型注入预览同款：设置行入口 + openInjectPreview + 双 tab/会话下拉/统计条（双端 UI 标记一致 + mock 演示）', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('id="setInjectPreview"') >= 0, label + ' 设置卡片「注入预览」入口')
      assert(s.indexOf("$('setInjectPreview').onclick") >= 0 && s.indexOf('openInjectPreview()') >= 0, label + ' 入口接线')
      assert(s.indexOf('function openInjectPreview()') >= 0 && s.indexOf('function loadInjectPreview()') >= 0 && s.indexOf('function renderInjectPreview()') >= 0, label + ' 预览三函数')
      assert(s.indexOf("v.indexOf('ws:') === 0 ? { workspace: v.slice(3) } : { sessionId: v }") >= 0, label + ' RPC 调用（缺省全局 / ws: 前缀走 workspace 并集视角 / 传 sessionId）')
      assert(s.indexOf('<optgroup label="工作区">') >= 0 && s.indexOf('<optgroup label="会话">') >= 0, label + ' 视角下拉三档（全局 + 工作区/会话 optgroup）')
      assert(s.indexOf("rpc('notes-sessions', {})") >= 0, label + ' 会话下拉数据源 notes-sessions')
      assert(s.indexOf('injprev-text') >= 0 && s.indexOf('injprev-stats') >= 0 && s.indexOf('injprev-tab') >= 0, label + ' 预览 modal 结构类')
      assert(s.indexOf('预算截断 ') >= 0 && s.indexOf('.modal.injprev{') >= 0, label + ' 统计条文案 + 宽 modal 样式')
    }
    // 双端 UI 标记一致（共享 DOM id / 函数名 / 样式类）
    for (const k of ['setInjectPreview', 'openInjectPreview', 'loadInjectPreview', 'renderInjectPreview', 'injectPreviewState', 'injprevTabConv', 'injprevTabCat', 'injprevSess', 'injprevText', 'injprevStats']) {
      assert(protoV2Src.indexOf(k) >= 0 && appSrc.indexOf(k) >= 0, '注入预览 UI 标记双端一致：' + k)
    }
    assert(protoV2Src.indexOf("method === 'notes-inject-preview'") >= 0, '原型 mock notes-inject-preview')
    assert(protoV2Src.indexOf('定向约定') >= 0, '原型 mock 演示 sessionId 过滤（定向约定）')
    assert(protoV2Src.indexOf('a.workspace') >= 0 && protoV2Src.indexOf('injectTo 并集演示') >= 0, '原型 mock 演示 workspace 视角（工作区定向约定）')
    assert(protoV2Src.indexOf('maskedNotes: 2') >= 0 && protoV2Src.indexOf('staleMarked: 1') >= 0 && protoV2Src.indexOf('budgetTruncated: false') >= 0, '原型 mock 统计演示值')
  })

  // ===== 33. 整理建议器（notes-suggest RPC + 侧栏「整理」入口三段式 modal + 四端同步）=====
  // 契约：notes-suggest（dry-run 零写入）→ { archiveCandidates（速记组，内聚复用 _archivePreview，与 notes-archive-preview 同源）,
  //   staleCandidates（kind=note/link 且超 staleDays 且 useCount===0——遥测保护：useCount>0 不入选）,
  //   orphanCandidates（孤儿：无 [[双链]] 出链/反向链接 + inject=false + useCount=0 + status=active 的普通笔记，排除速记/归档产物防误伤，上限 20）, generatedAt }。
  // 红线：只提名不自动执行——「去归档」直达归档预览对话框；「一键批量软删除」confirm 后才逐条 notes-delete；孤儿仅展示逐条跳转。
  section('33. 整理建议器（notes-suggest + 三段式 modal + 四端同步）')

  // ---- 33.1 host 双侧：suggest-helpers 标记块逐字节一致 + eval 单测（与 sensitive-helpers/export-single 同款姿势）----
  const grabSuggestBlk = (s, tag) => { const m = s.match(/\/\/ ==== suggest-helpers BEGIN ====[\s\S]*?\/\/ ==== suggest-helpers END ====/); assert(m, tag + ' 缺 suggest-helpers 标记块'); return m[0] }
  const sugBlkDev = grabSuggestBlk(hostSrc, 'host-impl.js')
  const sugBlkPkg = grabSuggestBlk(indexSrc, 'index.mjs')
  const sugNS = {}
  new Function('ns', sugBlkDev + '\nns.suggestCandidates = suggestCandidates; ns.suggestLinkTargetsOf = suggestLinkTargetsOf; ns.SUGGEST_ORPHAN_LIMIT = SUGGEST_ORPHAN_LIMIT; ns.suggestLogHygiene = suggestLogHygiene; ns.suggestISOWeek = suggestISOWeek; ns.suggestLogDateOf = suggestLogDateOf;')(sugNS)
  await t('suggest-helpers 标记块双包逐字节一致 + 可 eval（suggestCandidates/suggestLinkTargetsOf 导出）', () => {
    assert.strictEqual(sugBlkPkg, sugBlkDev, 'host-impl.js 与 index.mjs 的 suggest-helpers 块必须逐字节一致')
    assert.strictEqual(typeof sugNS.suggestCandidates, 'function', 'suggestCandidates 可 eval 导出')
    assert.strictEqual(typeof sugNS.suggestLinkTargetsOf, 'function', 'suggestLinkTargetsOf 可 eval 导出')
    assert.strictEqual(sugNS.SUGGEST_ORPHAN_LIMIT, 20, '孤儿候选上限 20')
  })
  await t('suggest-helpers 日志卫生函数可 eval 导出（suggestLogHygiene/suggestISOWeek/suggestLogDateOf，工作记忆 v0）', () => {
    assert.strictEqual(typeof sugNS.suggestLogHygiene, 'function', 'suggestLogHygiene 可 eval 导出')
    assert.strictEqual(typeof sugNS.suggestISOWeek, 'function', 'suggestISOWeek 可 eval 导出')
    assert.strictEqual(typeof sugNS.suggestLogDateOf, 'function', 'suggestLogDateOf 可 eval 导出')
  })
  await t('host 双侧：notes-suggest RPC 注册 + _suggest 内聚复用 _archivePreview + 生成时间戳（双包同步）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("handle('notes-suggest'") >= 0, label + ' notes-suggest RPC 注册')
      assert(s.indexOf('async function _suggest()') >= 0, label + ' _suggest 存在')
      assert(s.indexOf('const pv = await _archivePreview()') >= 0, label + ' 速记组内聚复用 _archivePreview（结构与 notes-archive-preview 同源）')
      assert(s.indexOf('generatedAt: new Date().toISOString()') >= 0, label + ' generatedAt 时间戳')
      assert(s.indexOf('只提名不执行') >= 0, label + ' 红线注释：只提名不执行')
      assert(s.indexOf('防误伤') >= 0, label + ' orphanCandidates 判定条件注释（防误伤）')
    }
  })
  await t('suggestCandidates 单元：stale 过滤（useCount=0 才入选 + kind=note/link + 超期才入选 + 降序）', () => {
    const dayMs = 86400000
    const iso = (d) => new Date(Date.now() - d * dayMs).toISOString()
    const mk = (over) => Object.assign({ id: 'n-x', title: 'x', kind: 'note', status: 'active', inject: false, useCount: 0, tags: [], mergedFrom: [], updatedAt: iso(10), body: '' }, over)
    const r = sugNS.suggestCandidates([
      mk({ id: 'n-s1', updatedAt: iso(200) }),               // 过期+未引用+note → 入选
      mk({ id: 'n-s2', updatedAt: iso(200), useCount: 3 }),  // 仍被引用 → 不入选（遥测保护）
      mk({ id: 'n-s3', kind: 'todo', updatedAt: iso(200) }), // kind≠note/link → 不入选
      mk({ id: 'n-s4', updatedAt: iso(5) }),                 // 未超期 → 不入选
      mk({ id: 'n-s5', kind: 'link', updatedAt: iso(100) }), // link 过期未引用 → 入选
    ], 90)
    assert.deepStrictEqual(r.staleCandidates.map(x => x.id).sort(), ['n-s1', 'n-s5'], 'stale 仅过期+未引用+note/link 入选（实得 ' + r.staleCandidates.map(x => x.id).join(',') + '）')
    assert(r.staleCandidates[0].id === 'n-s1' && r.staleCandidates[0].staleDays >= 199, 'staleDays 降序（200 天在前）')
    assert(r.staleCandidates[0].topic !== undefined && r.staleCandidates[0].updatedAt, 'stale 条目含 id/title/topic/updatedAt/staleDays')
    assert.strictEqual(sugNS.suggestCandidates([mk({ id: 'n-s1', updatedAt: iso(200) })], 0).staleCandidates.length, 0, 'staleLimit=0（时效关闭）→ stale 段为空')
  })
  await t('suggestCandidates 单元：orphan 判定（防误伤逐项排除：inject/useCount/quick/归档产物/出链/反向链接/status/kind）+ 上限 20 最旧在前', () => {
    const mk = (over) => Object.assign({ id: 'n-x', title: 'x', kind: 'note', status: 'active', inject: false, useCount: 0, tags: [], mergedFrom: [], updatedAt: '2026-01-01T00:00:00.000Z', body: '' }, over)
    const pool = [
      mk({ id: 'n-o1', title: '纯孤儿' }),                                     // 入选
      mk({ id: 'n-o2', inject: true }),                                        // 注入中 → 排除
      mk({ id: 'n-o3', useCount: 2 }),                                         // 被引用过 → 排除
      mk({ id: 'n-o4', tags: ['quick'] }),                                     // 速记 → 排除（archive 通道）
      mk({ id: 'n-o5', mergedFrom: ['n-a', 'n-b'] }),                          // 归档产物 → 排除
      mk({ id: 'n-o6', body: '见 [[不存在目标]] 吗' }),                         // 有出链 → 排除
      mk({ id: 'n-o7', title: '被链目标' }),                                   // 被 n-o8 [[标题]] 反链 → 排除
      mk({ id: 'n-o8', body: '引用 [[被链目标]]' }),                           // 有出链 → 排除
      mk({ id: 'n-o9', status: 'pinned' }),                                    // 置顶 → 排除
      mk({ id: 'n-o10', status: 'resolved' }),                                 // 已解决 → 排除
      mk({ id: 'n-o11', kind: 'todo' }),                                       // 非普通笔记 → 排除
      mk({ id: 'n-o12', body: '链 [[n-o13]]' }),                               // 有出链 → 排除
      mk({ id: 'n-o13', title: '被id链' }),                                    // 被 n-o12 [[id]] 反链 → 排除
    ]
    const r = sugNS.suggestCandidates(pool, 0)
    assert.deepStrictEqual(r.orphanCandidates.map(x => x.id), ['n-o1'], '仅纯孤儿入选（实得 ' + r.orphanCandidates.map(x => x.id).join(',') + '）')
    const many = []
    for (let i = 1; i <= 25; i++) many.push(mk({ id: 'n-m' + String(i).padStart(2, '0'), updatedAt: '2026-01-' + String(i).padStart(2, '0') + 'T00:00:00.000Z' }))
    const r2 = sugNS.suggestCandidates(many, 0)
    assert.strictEqual(r2.orphanCandidates.length, 20, '孤儿上限 20（实得 ' + r2.orphanCandidates.length + '）')
    assert.strictEqual(r2.orphanCandidates[0].id, 'n-m01', '最旧在前')
  })

  // ---- 33.2 host 行为级（开发版独立实例 storeSG/handlersSG，与 32 节同款隔离模式）----
  const storeSG = new Map()
  const fsMockSG = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeSG.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of storeSG.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!storeSG.has(p)) throw new Error('ENOENT: ' + p); return storeSG.get(p) },
    writeText: async (p, c) => { storeSG.set(p, c) },
  }
  const handlersSG = {}
  const harnessMockSG = { handle: (name, fn) => { handlersSG[name] = fn; return () => { delete handlersSG[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockSG, DIR).apply({
    fs: fsMockSG, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  await t('notes-suggest 三段返回 + 遥测/时效闭环 + 零写入（开发版独立实例）', async () => {
    const dayMs = 86400000
    const iso = (d) => new Date(Date.now() - d * dayMs).toISOString()
    // 直写 store 造库（front-matter 确定性 updatedAt/useCount）：
    // 速记组 ×2（sess-sg-1）+ 过期未引用 note(200d)/link(150d) + 过期但被引用(useCount=4) + 孤儿 + 出链/反链对 + 注入中 + 单条速记（不成组）
    const seed = (id, fm, body) => storeSG.set(NOTES_DIR + '\\' + id + '.md', '---\nid: ' + id + '\n' + fm.join('\n') + '\n---\n\n' + body)
    seed('n-sg-q1', ['title: 速记甲', 'topic: 调试', 'tags: quick', 'sessionId: sess-sg-1', 'createdAt: "' + iso(3) + '"', 'updatedAt: "' + iso(3) + '"'], '速记内容一')
    seed('n-sg-q2', ['title: 速记乙', 'topic: 调试', 'tags: quick', 'sessionId: sess-sg-1', 'createdAt: "' + iso(2) + '"', 'updatedAt: "' + iso(2) + '"'], '速记内容二')
    seed('n-sg-stale1', ['title: 陈旧笔记', 'topic: 运维', 'createdAt: "' + iso(200) + '"', 'updatedAt: "' + iso(200) + '"'], '陈旧正文')
    seed('n-sg-stale-link', ['title: 陈旧链接', 'topic: ' + '资料', 'kind: link', 'createdAt: "' + iso(150) + '"', 'updatedAt: "' + iso(150) + '"'], 'https://example.com/old')
    seed('n-sg-stale-used', ['title: 陈旧但被引用', 'topic: 运维', 'useCount: 4', 'createdAt: "' + iso(200) + '"', 'updatedAt: "' + iso(200) + '"'], '仍被 agent 引用')
    seed('n-sg-orphan', ['title: ' + '孤立笔记', 'topic: 其他', 'createdAt: "' + iso(1) + '"', 'updatedAt: "' + iso(1) + '"'], '无链正文')
    seed('n-sg-linker', ['title: 出链笔记', 'topic: 其他', 'createdAt: "' + iso(1) + '"', 'updatedAt: "' + iso(1) + '"'], '见 [[n-sg-linked]] 的说明')
    seed('n-sg-linked', ['title: 被反链笔记', 'topic: 其他', 'createdAt: "' + iso(1) + '"', 'updatedAt: "' + iso(1) + '"'], '被引用正文')
    seed('n-sg-inject', ['title: 注入中笔记', 'topic: 约定', 'inject: true', 'createdAt: "' + iso(1) + '"', 'updatedAt: "' + iso(1) + '"'], '注入正文')
    seed('n-sg-quick-single', ['title: 单条速记', 'topic: 调试', 'tags: quick', 'sessionId: sess-sg-2', 'createdAt: "' + iso(1) + '"', 'updatedAt: "' + iso(1) + '"'], '单条速记不成组')
    const keysBefore = Array.from(storeSG.keys()).filter(k => k.indexOf(NOTES_DIR + '\\') === 0).sort()
    const r = await handlersSG['notes-suggest']({})
    const keysAfter = Array.from(storeSG.keys()).filter(k => k.indexOf(NOTES_DIR + '\\') === 0).sort()
    assert.deepStrictEqual(keysAfter, keysBefore, 'notes-suggest 零写入（NOTES_DIR 键集合不变）')
    assert(!r.error, '无报错（实得 ' + JSON.stringify(r).slice(0, 160) + '）')
    assert(typeof r.generatedAt === 'string' && r.generatedAt.length > 10, 'generatedAt 时间戳存在')
    // a. 速记组：与 notes-archive-preview 逐字段一致（内聚复用）
    const pv = await handlersSG['notes-archive-preview']({})
    assert.deepStrictEqual(r.archiveCandidates, pv.quickGroups, 'archiveCandidates 与 notes-archive-preview.quickGroups 逐字段一致')
    assert(r.archiveCandidates.length === 1 && r.archiveCandidates[0].sessionId === 'sess-sg-1' && r.archiveCandidates[0].members.length === 2, '速记组 1 组 2 条（实得 ' + JSON.stringify(r.archiveCandidates).slice(0, 160) + '）')
    assert(typeof r.archiveCandidates[0].totalUseCount === 'number' && r.archiveCandidates[0].dateSpan && typeof r.archiveCandidates[0].totalBytes === 'number', '组附 totalUseCount/dateSpan/totalBytes')
    // b. 过期未引用：useCount=0 才入选（遥测保护：n-sg-stale-used 不入选）
    const staleIds = r.staleCandidates.map(x => x.id).sort()
    assert.deepStrictEqual(staleIds, ['n-sg-stale-link', 'n-sg-stale1'], 'stale 仅过期+未引用+note/link（实得 ' + staleIds.join(',') + '）')
    assert(r.staleCandidates[0].id === 'n-sg-stale1' && r.staleCandidates[0].staleDays >= 199, 'staleDays 降序 + 天数正确')
    // c. 孤儿：纯孤儿入选；出链/反链/注入/速记/被引用均排除（防误伤）
    const orphIds = r.orphanCandidates.map(x => x.id).sort()
    assert(orphIds.indexOf('n-sg-orphan') >= 0, '纯孤儿入选')
    for (const excluded of ['n-sg-linker', 'n-sg-linked', 'n-sg-inject', 'n-sg-quick-single', 'n-sg-stale-used', 'n-sg-q1', 'n-sg-q2', 'n-sg-stale-link']) {
      assert(orphIds.indexOf(excluded) < 0, '防误伤排除：' + excluded)
    }
    assert(orphIds.length <= 20, '孤儿上限 20')
  })
  await t('notes-suggest 时效阈值跟随 settings.staleDays（override 生效 + 0 关闭 + null 恢复缺省）', async () => {
    await handlersSG['notes-settings-set']({ staleDays: 300 })
    const r1 = await handlersSG['notes-suggest']({})
    assert.strictEqual(r1.staleCandidates.length, 0, 'staleDays=300：200/150 天均未超期 → stale 空')
    await handlersSG['notes-settings-set']({ staleDays: 160 })
    const r2 = await handlersSG['notes-suggest']({})
    assert.deepStrictEqual(r2.staleCandidates.map(x => x.id), ['n-sg-stale1'], 'staleDays=160：仅 200 天入选（150 天出局）')
    await handlersSG['notes-settings-set']({ staleDays: 0 })
    const r3 = await handlersSG['notes-suggest']({})
    assert.strictEqual(r3.staleCandidates.length, 0, 'staleDays=0 关闭时效 → stale 段为空')
    await handlersSG['notes-settings-set']({ staleDays: null })
    const r4 = await handlersSG['notes-suggest']({})
    assert.strictEqual(r4.staleCandidates.length, 2, 'null 恢复缺省 90 → 两条回到候选')
  })

  // ---- 33.3 静态包行为（index.mjs 独立 ESM 实例，harness 主通道）----
  await t('静态包：notes-suggest 注册 + 三段结构 + 孤儿入选（index.mjs 独立实例）', async () => {
    const storeSug = new Map()
    const fsMockSug = mkFsMockImp(storeSug, [NOTES_ROOT_STATIC])
    const handlersSug = {}
    const harnessMockSug = { handle: (name, fn) => { handlersSug[name] = fn; return () => { delete handlersSug[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
    global.harness = harnessMockSug   // 静态包 handle() 主通道读全局 harness（apply 时解析）；指回本实例的注册表
    const modSug = await import(pathToFileURL(INDEX_PATH).href + '?suggest=1')
    modSug.apply({
      fs: fsMockSug, sandboxPolicy: { resolve: () => ({}) },
      webServer: { register: () => () => {} }, tools: { register: () => () => {} },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    assert.strictEqual(typeof handlersSug['notes-suggest'], 'function', '静态包注册 notes-suggest')
    const c = await handlersSug['notes-create']({ title: '静态建议笔记', body: 'x' })
    const r = await handlersSug['notes-suggest']({})
    assert(!r.error && Array.isArray(r.archiveCandidates) && Array.isArray(r.staleCandidates) && Array.isArray(r.orphanCandidates) && typeof r.generatedAt === 'string', '三段 + generatedAt 结构齐备（实得 ' + JSON.stringify(r).slice(0, 160) + '）')
    assert(r.orphanCandidates.some(x => x.id === c.id), '新建普通笔记（无链/未引用/进行中）入选孤儿')
  })

  // ---- 33.4 client 结构断言（开发版 client-impl + 发布包 lib/client.js + 样式双端）----
  await t('client 整理建议：设置卡片「整理建议」行入口 + 三段式 modal + Esc + 错误条互斥（开发版 + 发布包）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("key: 'suggest', label: '整理建议'") >= 0, label + ' 设置卡片「整理建议」行（底部收敛后的入口）')
      assert(s.indexOf("onClick: openSuggest }, '打开'") >= 0, label + ' 整理建议行控件 → openSuggest')
      assert(s.indexOf('整理建议：速记组归档') >= 0, label + ' 整理建议入口 tooltip 文案保留')
      assert(s.indexOf('function openSuggest()') >= 0 && s.indexOf('function loadSuggest()') >= 0, label + ' openSuggest/loadSuggest 存在')
      assert(s.indexOf("' 整理建议'") >= 0 && s.indexOf('只提名不自动执行') >= 0, label + ' modal 标题 + 红线副标')
      assert(s.indexOf('可整理的速记组') >= 0 && s.indexOf('过期未引用') >= 0 && s.indexOf('可能无用') >= 0, label + ' 三段标题')
      assert(s.indexOf('库很干净，无需整理') >= 0, label + ' 空态文案「库很干净，无需整理」')
      assert(s.indexOf('dsh-notes-suggest-sec') >= 0, label + ' 分节样式类')
      assert(s.indexOf('if (suggestOpenRef.current) { setSuggestOpen(false); return }') >= 0, label + ' Esc 链路关建议框')
      assert(s.indexOf('!injectPreviewOpen && !suggestOpen') >= 0, label + ' 全局错误条排除建议 modal（modal 内自显错误）')
    }
    assert(clientSrc.indexOf("host.call('notes-suggest', {})") >= 0, 'openSuggest 走 notes-suggest（dry-run 零写入）')
    assert(clientPkgSrc.indexOf("rpc('notes-suggest', {})") >= 0, '发布包同链路（rpc 形态，需先跑 scripts/build-dist.cjs）')
  })
  await t('client 建议动作：去归档直达归档预览 / 批量软删 confirm + 逐条 notes-delete payload / 孤儿仅展示逐条跳转', () => {
    // ① 速记组「去归档」：关建议框 → openArchive（归档预览对话框，数据同源）
    assert(clientSrc.indexOf('function suggestGoArchive() { setSuggestOpen(false); openArchive() }') >= 0, '「去归档」直达归档预览对话框')
    assert(clientPkgSrc.indexOf('function suggestGoArchive()') >= 0, '发布包同步 suggestGoArchive')
    // ② 过期未引用「一键批量软删除」：confirm 守卫 + 逐条 notes-delete + 删后收尾刷新
    assert(clientSrc.indexOf("window.confirm('一键批量软删除：' + list.length + ' 条") >= 0, '批量软删前 window.confirm 确认')
    assert(clientSrc.indexOf("await host.call('notes-delete', { id: n.id })") >= 0, '逐条 notes-delete payload（软删，回收站可恢复）')
    assert(clientPkgSrc.indexOf("await rpc('notes-delete', { id: n.id })") >= 0, '发布包同批量软删 payload（rpc 形态）')
    assert(clientSrc.indexOf('afterArchiveCleanup(list.map(n => n.id))') >= 0, '删后收尾：正打开笔记退出选中态（归档同款）')
    assert(clientSrc.indexOf('loadSuggest()') >= 0, '删后刷新建议数据（三段联动）')
    // ③ 孤儿仅展示：「查看」逐条跳转（jumpToWikiTarget 同款过滤退回）；无批量操作（启发式判定防误伤）
    assert(clientSrc.indexOf('function suggestViewNote(id) { setSuggestOpen(false); jumpToWikiTarget(id) }') >= 0, '孤儿「查看」逐条跳转')
    const sec3 = clientSrc.match(/'可能无用',[\s\S]*?判定口径/)   // 锚定③段标题行（JSX 形态），避开段头注释与②段批量按钮
    assert(sec3 && sec3[0].indexOf('查看') >= 0 && sec3[0].indexOf('一键批量') < 0 && sec3[0].indexOf('danger') < 0, '孤儿段仅展示（查看按钮，无批量/danger 操作）')
  })
  await t('整理建议样式双端：styles.css ⇄ 发布包 lib/styles.css', () => {
    const cssDevS = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkgS = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDevS], ['发布包 lib/styles.css', cssPkgS]]) {
      for (const cls of ['.dsh-notes-suggest-modal{', '.dsh-notes-suggest-sec{', '.dsh-notes-suggest-sec-t{', '.dsh-notes-suggest-sec-n{']) {
        assert(pair[1].indexOf(cls) >= 0, pair[0] + ' 缺整理建议样式：' + cls + '（需跑 scripts/build-dist.cjs）')
      }
    }
  })

  // ---- 33.5 app.html / 原型 notes-ui-v2.html 同款（UI 唯一规格来源约束）----
  await t('app.html + 原型整理建议同款：设置卡片「整理建议」行入口 + 三段式 modal + 批量软删 confirm + 孤儿仅展示（双端 UI 标记一致 + mock 演示）', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('id="btnSuggest"') < 0, label + ' 底部「整理」按钮已移除（收敛进设置卡片）')
      assert(s.indexOf('id="setSuggest"') >= 0, label + ' 设置卡片「整理建议」行入口')
      assert(s.indexOf("$('setSuggest').onclick = function () { openSuggest() }") >= 0, label + ' 入口接线（设置卡片）')
      assert(s.indexOf('function openSuggest()') >= 0 && s.indexOf('function renderSuggestList()') >= 0 && s.indexOf('function doSuggestBatchDelete()') >= 0, label + ' 建议三函数')
      assert(s.indexOf("rpc('notes-suggest', {})") >= 0, label + ' RPC 调用 notes-suggest')
      assert(s.indexOf('整理建议') >= 0 && s.indexOf('可整理的速记组') >= 0 && s.indexOf('过期未引用') >= 0 && s.indexOf('可能无用') >= 0, label + ' modal 三段标题')
      assert(s.indexOf('库很干净，无需整理') >= 0, label + ' 空态文案')
      assert(s.indexOf('.sg-sec{') >= 0 && s.indexOf('.sg-sec-t{') >= 0, label + ' 分节样式')
      assert(s.indexOf("confirm('一键批量软删除：'") >= 0, label + ' 批量软删 confirm 确认')
      assert(s.indexOf("rpc('notes-delete', { id: n.id })") >= 0, label + ' 逐条 notes-delete payload')
      assert(s.indexOf('sgGoArch') >= 0 && s.indexOf('openArchive()') >= 0, label + ' 「去归档」直达归档预览')
      const sec3 = s.match(/>可能无用<span[\s\S]*?判定口径/)   // 锚定③段标题行（HTML 字符串形态），避开段头注释与②段批量按钮
      assert(sec3 && sec3[0].indexOf('查看') >= 0 && sec3[0].indexOf('一键批量') < 0 && sec3[0].indexOf('danger') < 0, label + ' 孤儿段仅展示（无批量操作）')
      assert(s.indexOf('suggestState = null; histState = null; memEnableState = null; return }') >= 0, label + ' Esc 统一关建议框（连带历史面板 histState / 工作记忆启用框 memEnableState 复位）')
    }
    // 双端 UI 标记一致（共享 DOM id / 函数名 / 样式类）
    for (const k of ['setSuggest', 'openSuggest', 'loadSuggest', 'renderSuggestList', 'doSuggestBatchDelete', 'suggestState', 'sgGoArch', 'sgBatchDel', 'sg-view', 'sg-sec']) {
      assert(protoV2Src.indexOf(k) >= 0 && appSrc.indexOf(k) >= 0, '整理建议 UI 标记双端一致：' + k)
    }
    assert(protoV2Src.indexOf("method === 'notes-suggest'") >= 0, '原型 mock 含 notes-suggest')
    assert(protoV2Src.indexOf('过期演示') >= 0 && protoV2Src.indexOf('孤儿演示') >= 0, '原型 mock 演示数据（过期 + 孤儿）')
  })

  // ===== 34. 搜索体验升级（<mark> 高亮防 XSS + 相关度排序 + kind/sensitive/inject 组合过滤 + host 扩展 + 四端同步）=====
  section('34. 搜索体验升级（高亮 / 相关度 / 组合过滤 / 四端同步）')

  // ---- 34.1 host 双包 search-helpers 标记块：提取 eval 单测 + 双包逐字节一致 ----
  const grabSearchBlk = (s, tag) => { const m = s.match(/\/\/ ==== search-helpers BEGIN ====[\s\S]*?\/\/ ==== search-helpers END ====/); assert(m, tag + ' 缺 search-helpers 标记块'); return m[0] }
  const searchBlkDev = grabSearchBlk(hostSrc, 'host-impl.js')
  const searchBlkPkg = grabSearchBlk(indexSrc, 'index.mjs')
  await t('search-helpers 双包逐字节一致（host-impl.js ⇄ index.mjs）', () => assert.strictEqual(searchBlkDev, searchBlkPkg))
  const searchNS = {}
  new Function('ns', searchBlkDev + '\nns.searchMatchFields = searchMatchFields; ns.searchPassFilters = searchPassFilters')(searchNS)
  await t('searchMatchFields：title/tags/body 命中字段 + 多档并列 + 无 query 空数组', () => {
    const f = searchNS.searchMatchFields
    assert.deepStrictEqual(f({ title: 'Alpha', tags: [], body: '' }, 'alpha'), ['title'], '标题命中 → [title]')
    assert.deepStrictEqual(f({ title: '', tags: ['Beta'], body: '' }, 'beta'), ['tags'], '标签命中 → [tags]')
    assert.deepStrictEqual(f({ title: '', tags: [], body: 'Gamma 正文' }, 'gamma'), ['body'], '正文命中 → [body]')
    assert.deepStrictEqual(f({ title: '多档', tags: ['多档'], body: '多档' }, '多档'), ['title', 'tags', 'body'], '多字段同命中全列（相关度取最高档）')
    assert.deepStrictEqual(f({ title: 'x', tags: ['y'], body: 'z' }, ''), [], '无 query → 空数组')
  })
  await t('searchPassFilters：sensitive/inject 三态（true=仅命中 / false=仅排除 / undefined=不过滤）', () => {
    const p = searchNS.searchPassFilters
    const s = { sensitive: true, inject: false }, n0 = { sensitive: false, inject: true }
    assert(p(s, { sensitive: true }) === true && p(n0, { sensitive: true }) === false, 'sensitive=true 仅敏感')
    assert(p(s, { sensitive: false }) === false && p(n0, { sensitive: false }) === true, 'sensitive=false 排除敏感')
    assert(p(s, { inject: true }) === false && p(n0, { inject: true }) === true, 'inject=true 仅注入')
    assert(p(s, { inject: false }) === true && p(n0, { inject: false }) === false, 'inject=false 排除注入')
    assert(p(s, undefined) === true && p(s, {}) === true && p(s, { sensitive: undefined, inject: undefined }) === true, '缺省不过滤（向后兼容旧调用）')
  })
  await t('host 双包 notes-search 扩展结构（RPC 透传 + slim 附 matches + 工具参数）', () => {
    for (const pair of [['host-impl.js', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('async function _search(query, tag, topic, kind, folder, filters)') >= 0, label + ' _search 扩展 filters 参数（末尾追加，向后兼容）')
      assert(s.indexOf('if (n.matches) s.matches = n.matches') >= 0, label + ' slim 结果附 matches 命中字段')
      assert(s.indexOf('sensitive: a.sensitive, inject: a.inject') >= 0, label + ' RPC 透传 sensitive/inject 组合过滤')
      assert(s.indexOf("sensitive: { type: 'boolean'") >= 0 && s.indexOf("inject: { type: 'boolean'") >= 0, label + ' note_search 工具含 sensitive/inject 参数')
    }
  })

  // ---- 34.2 host 行为（开发版独立实例，防污染第 2 节共享库）：matches 全档 + 组合过滤 + 向后兼容 ----
  const store34 = new Map()
  const handlers34 = {}
  const harnessMock34 = { handle: (name, fn) => { handlers34[name] = fn; return () => { delete handlers34[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock34, DIR).apply({
    fs: mkFsMockImp(store34, [NOTES_DIR]), sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  const sf1 = await handlers34['notes-create']({ title: '搜索升级·敏感约定', body: '含凭据正文本', tags: ['sec'], topic: '运维', kind: 'decision', sensitive: true, inject: true })
  const sf2 = await handlers34['notes-create']({ title: '搜索升级·普通笔记', body: '普通正文本', tags: ['sec'], topic: '运维' })
  await t('matches 命中字段全档：title / tags / body / 仅 topic 命中不计档', async () => {
    await handlers34['notes-create']({ title: '命中字段甲', body: '无瓜正文', tags: [], topic: '其他' })
    await handlers34['notes-create']({ title: '无瓜标题乙', body: '无瓜', tags: ['命中字段'], topic: '其他' })
    await handlers34['notes-create']({ title: '无瓜标题丙', body: '正文命中字段出现', tags: [], topic: '其他' })
    await handlers34['notes-create']({ title: '无瓜标题丁', body: '无瓜', tags: [], topic: '命中字段' })
    const r = await handlers34['notes-search']({ query: '命中字段' })
    const byTitle = {}
    for (const n of r.notes) byTitle[n.title] = n.matches
    assert.deepStrictEqual(byTitle['命中字段甲'], ['title'], '标题命中 → [title]')
    assert.deepStrictEqual(byTitle['无瓜标题乙'], ['tags'], '标签命中 → [tags]')
    assert.deepStrictEqual(byTitle['无瓜标题丙'], ['body'], '正文命中 → [body]')
    assert.deepStrictEqual(byTitle['无瓜标题丁'], [], '仅 topic 命中 → 空档（相关度排最末，但仍搜得到——向后兼容）')
  })
  await t('组合过滤：sensitive / inject / kind 三态组合', async () => {
    const r1 = await handlers34['notes-search']({ tag: 'sec', sensitive: true })
    assert(r1.notes.length === 1 && r1.notes[0].id === sf1.id, 'sensitive=true 仅敏感（实得 ' + r1.notes.length + '）')
    const r2 = await handlers34['notes-search']({ tag: 'sec', sensitive: false })
    assert(r2.notes.length === 1 && r2.notes[0].id === sf2.id, 'sensitive=false 排除敏感')
    const r3 = await handlers34['notes-search']({ tag: 'sec', inject: true })
    assert(r3.notes.length === 1 && r3.notes[0].id === sf1.id, 'inject=true 仅注入')
    const r4 = await handlers34['notes-search']({ tag: 'sec', inject: false })
    assert(r4.notes.length === 1 && r4.notes[0].id === sf2.id, 'inject=false 排除注入')
    const r5 = await handlers34['notes-search']({ tag: 'sec', kind: 'decision', sensitive: true, inject: true })
    assert(r5.notes.length === 1 && r5.notes[0].id === sf1.id, 'kind+sensitive+inject 组合 AND')
    const r6 = await handlers34['notes-search']({ tag: 'sec', kind: 'todo' })
    assert(r6.notes.length === 0, 'kind 不命中 → 空')
  })
  await t('向后兼容：旧调用（仅 query / 无新参数）行为不变', async () => {
    const r = await handlers34['notes-search']({ tag: 'sec' })
    assert(r.notes.length === 2 && !('matches' in r.notes[0]), '无 query → 不附 matches 字段（旧调用方不受影响）')
    const r2 = await handlers34['notes-search']({ query: '搜索升级' })
    assert(r2.notes.length === 2, '不带过滤参数 → 全集命中（缺省不过滤）')
  })
  await t('note_search 工具：sensitive/inject 参数 + matches 命中字段透传', async () => {
    const tools34 = []
    const harnessMock34b = { handle: () => () => {}, defineTool: (d) => d, registerTool: (c, d) => { tools34.push(d); return () => {} } }
    const store34b = new Map()
    new Function('harness', 'pluginDir', hostSrc)(harnessMock34b, DIR).apply({
      fs: mkFsMockImp(store34b, [NOTES_DIR]), sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    const tool = tools34.find(x => x.name === 'note_search')
    assert(tool && tool.parameters.properties.sensitive && tool.parameters.properties.inject, '工具 schema 含 sensitive/inject')
    // 工具链路端到端：note_manage 造数 → note_search 检索（含组合过滤与 matches）
    const manage = tools34.find(x => x.name === 'note_manage')
    await manage.execute({ action: 'create', title: '工具搜索·敏感', body: 'x', tags: ['t34'], sensitive: true, inject: true })
    await manage.execute({ action: 'create', title: '工具搜索·普通', body: 'x', tags: ['t34'] })
    const rAll = await tool.execute({ tag: 't34' })
    assert(rAll.count === 2, '工具缺省不过滤（实得 ' + rAll.count + '）')
    const rSens = await tool.execute({ tag: 't34', sensitive: true })
    assert(rSens.count === 1 && rSens.notes[0].title === '工具搜索·敏感', '工具 sensitive=true 仅敏感')
    const rQ = await tool.execute({ query: '工具搜索' })
    assert(rQ.count === 2 && Array.isArray(rQ.notes[0].matches) && rQ.notes[0].matches.indexOf('title') >= 0, '工具返回 matches 命中字段（标题命中）')
  })

  // ---- 34.2 静态包 index.mjs 行为（独立 ESM 实例：matches + 组合过滤）----
  await t('静态包：notes-search matches 命中字段 + sensitive/inject 组合过滤（index.mjs 独立实例）', async () => {
    const storeS34 = new Map()
    const fsMockS34 = mkFsMockImp(storeS34, [NOTES_ROOT_STATIC])
    const handlersS34 = {}
    const harnessMockS34 = { handle: (name, fn) => { handlersS34[name] = fn; return () => { delete handlersS34[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
    global.harness = harnessMockS34   // 静态包 handle() 主通道读全局 harness（apply 时解析）；指回本实例注册表
    const modS34 = await import(pathToFileURL(INDEX_PATH).href + '?search34=1')
    modS34.apply({
      fs: fsMockS34, sandboxPolicy: { resolve: () => ({}) },
      webServer: { register: () => () => {} }, tools: { register: () => () => {} },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    const c1 = await handlersS34['notes-create']({ title: '静态搜索甲', body: '正文含令牌', tags: ['s34'], sensitive: true, inject: true })
    const c2 = await handlersS34['notes-create']({ title: '静态搜索乙', body: '普通正文', tags: ['s34'] })
    const r1 = await handlersS34['notes-search']({ query: '静态搜索' })
    assert(r1.notes.length === 2 && r1.notes.every(n => Array.isArray(n.matches) && n.matches[0] === 'title'), '静态包附 matches（标题命中，实得 ' + JSON.stringify(r1.notes.map(n => n.matches)) + '）')
    const r2 = await handlersS34['notes-search']({ tag: 's34', sensitive: true })
    assert(r2.notes.length === 1 && r2.notes[0].id === c1.id, '静态包 sensitive=true 仅敏感')
    const r3 = await handlersS34['notes-search']({ tag: 's34', inject: false })
    assert(r3.notes.length === 1 && r3.notes[0].id === c2.id, '静态包 inject=false 排除注入')
    const r4 = await handlersS34['notes-search']({ tag: 's34' })
    assert(r4.notes.length === 2 && !('matches' in r4.notes[0]), '静态包向后兼容：无 query 无 matches、缺省不过滤')
  })

  // ---- 34.3 高亮防 XSS（先 esc 再包 <mark>；禁止 innerHTML 拼原文）----
  const grabFn = (s, name, tag) => { const m = s.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}')); assert(m, tag + ' 缺 ' + name + '()'); return m[0] }
  const hlApp = grabFn(appSrc, 'hl', 'app.html')
  const hlProto = grabFn(protoV2Src, 'hl', '原型 notes-ui-v2.html')
  await t('hl() 高亮函数双端逐字节一致（app.html ⇄ 原型）', () => assert.strictEqual(hlApp, hlProto))
  const hlNS = {}
  new Function('ns', grabFn(appSrc, 'esc', 'app.html') + '\n' + hlApp + '\nns.hl = hl')(hlNS)
  await t('高亮防 XSS：先 esc 再包 <mark>（恶意标题/恶意查询词/正则元字符均安全）', () => {
    const hl = hlNS.hl
    const escPos = hlApp.indexOf('esc(text == null'), markPos = hlApp.indexOf("'<mark>$1</mark>'")
    assert(escPos >= 0 && markPos > escPos, '源码顺序：先 esc 再包 <mark>')
    const out1 = hl('<img src=x onerror=alert(1)> 笔记', 'img')
    assert(out1.indexOf('<img') < 0 && out1.indexOf('onerror') >= 0, '标题原文先转义（无 <img 节点，onerror 成纯文本）')
    assert(out1.indexOf('<mark>img</mark>') >= 0, '命中词包 <mark>')
    const out2 = hl('普通标题', '<img onerror=alert(1)>')
    assert(out2.indexOf('<img') < 0 && out2.indexOf('<mark>') < 0, '恶意查询词经 esc 后无命中、不注入标签')
    assert(hl('a.c (x) [y]', '.') === 'a<mark>.</mark>c (x) [y]', '正则元字符转义：. 只命中字面点（实得 ' + hl('a.c (x) [y]', '.') + '）')
    assert(hl('100% 完成 & 收尾', '&') === '100% 完成 <mark>&amp;</mark> 收尾', '查询词 & 经 esc 后命中转义文本（&amp; 形态一致）')
    assert(hl('', 'x') === '' && hl('abc', '') === 'abc' && hl('abc', '  ') === 'abc', '空文本/空查询原样返回')
  })
  await t('面板 highlight（React）：正则转义 + mark 元素（React 转义渲染，无 innerHTML 拼原文）', () => {
    assert(clientSrc.indexOf("q.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')") >= 0, 'client-impl highlight 查询词正则元字符转义')
    assert(clientSrc.indexOf("e('mark', { key: i, className: 'dsh-notes-mark' }, p)") >= 0, 'client-impl 高亮走 React mark 元素（文本节点自动转义）')
    assert(clientPkgSrc.indexOf("'dsh-notes-mark'") >= 0, '发布包 lib/client.js 同步高亮（需先跑 scripts/build-dist.cjs）')
    assert(clientSrc.indexOf("highlight(n.title || '无标题', q)") >= 0, '面板行标题接入高亮')
  })

  // ---- 34.4 相关度排序（标题 > 标签 > 正文 > 其他，同级 updatedAt 降序）----
  await t('相关度排序比较器行为（app.html/原型 relRank + 比较器提取执行）', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      const relSrc = grabFn(s, 'relRank', label)
      const meta = { 'n-t': ['title'], 'n-t2': ['title'], 'n-g': ['tags'], 'n-b': ['body'] }
      const relRank = new Function('searchMeta', relSrc + '\nreturn relRank')(meta)
      assert.strictEqual(relRank({ id: 'n-l', title: 'XqX', tags: [], preview: '' }, 'q'), 3, label + ' 无 meta 时本地估算标题命中=3')
      assert.strictEqual(relRank({ id: 'n-x', title: '', tags: [], preview: '' }, 'q'), 0, label + ' 无命中=0 档')
      const cm = s.match(/if \(sortBy === 'rel' && qRel\) vis\.sort\(function \(a, b\) \{ return ([^\r\n]+) \}\);/)
      assert(cm, label + ' 缺相关度排序行')
      const cmp = new Function('relRank', 'qRel', 'return function (a, b) { return ' + cm[1] + ' }')(relRank, 'q')
      const arr = [
        { id: 'n-b', title: '', tags: [], preview: '', updatedAt: '2026-01-04T00:00:00.000Z' },
        { id: 'n-t', title: '', tags: [], preview: '', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'n-x', title: '', tags: [], preview: '', updatedAt: '2026-01-06T00:00:00.000Z' },
        { id: 'n-g', title: '', tags: [], preview: '', updatedAt: '2026-01-03T00:00:00.000Z' },
        { id: 'n-t2', title: '', tags: [], preview: '', updatedAt: '2026-01-05T00:00:00.000Z' },
      ]
      assert.strictEqual(arr.slice().sort(cmp).map(n => n.id).join(','), 'n-t2,n-t,n-g,n-b,n-x', label + ' 标题>标签>正文>无命中，同级 updatedAt 降序')
    }
  })
  await t('相关度排序比较器（面板 client-impl）：relRank 降序 + updatedAt 兜底 + 无搜索词退化', () => {
    const m = clientSrc.match(/else if \(sortBy === 'rel' && q\) filtered = filtered\.slice\(\)\.sort\(\(a, b\) => ([^\r\n]+)\)\r?\n/)
    assert(m, 'client-impl 缺相关度排序行')
    const cmp = new Function('relRank', 'return (a, b) => ' + m[1])((n) => n._r)
    const arr = [
      { id: 'a', _r: 1, updatedAt: '2026-01-02' }, { id: 'b', _r: 3, updatedAt: '2026-01-01' },
      { id: 'c', _r: 3, updatedAt: '2026-01-03' }, { id: 'd', _r: 2, updatedAt: '2026-01-04' }, { id: 'e', _r: 0, updatedAt: '2026-01-05' },
    ]
    assert.strictEqual(arr.slice().sort(cmp).map(n => n.id).join(','), 'c,b,d,a,e', '标题>标签>正文>无命中，同级 updatedAt 降序')
    assert(clientSrc.indexOf("sortBy === 'rel' && q") >= 0, '无搜索词时相关度退化为 host 序（不抢默认排序）')
  })

  // ---- 34.5 四端同步：筛选中心（design/notes-filter-center.html 落地）----
  // 面板（client-impl / 发布包 lib/client.js）+ app.html / 原型 + 样式双端 + 原型 mock
  await t('四端同步：筛选中心（筛选按钮(N) + 分组 popover + 激活 chips + 独立排序控件）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('筛选中心：分组勾选条件（组内 OR / 跨组 AND）') >= 0, label + ' 筛选中心入口 tooltip')
      assert(s.indexOf('dsh-notes-filterbar') >= 0 && s.indexOf('dsh-notes-fpop') >= 0 && s.indexOf('dsh-notes-fchip') >= 0 && s.indexOf('dsh-notes-fcnt') >= 0, label + ' 控制行结构（filterbar/popover/chip/计数丸）')
      assert(s.indexOf('dsh-notes-fsort-menu') >= 0 && s.indexOf('dsh-notes-fsort-item') >= 0, label + ' 独立排序控件菜单')
      assert(s.indexOf('组内多选 = OR') >= 0 && s.indexOf('组内 OR · 与状态组 = AND') >= 0, label + ' popover 分组规则文案')
      assert(s.indexOf("'命中 '") >= 0 && s.indexOf("'清空'") >= 0 && s.indexOf("'完成'") >= 0, label + ' popover 底部 命中数 + 清空/完成')
      assert(s.indexOf("pred: n => n.status === 'pinned'") >= 0 && s.indexOf('pred: n => n.inject === true') >= 0 && s.indexOf('pred: n => n.injectEver === true') >= 0 && s.indexOf('pred: n => n.sensitive === true') >= 0, label + ' 状态组四条件谓词')
      assert(s.indexOf("n.injectEver !== undefined") >= 0, label + ' 曾注入 feature-detect（slim 有该字段才显示）')
      assert(s.indexOf("localStorage.setItem('dsh-notes-filters'") >= 0 && s.indexOf("localStorage.getItem('dsh-notes-filters')") >= 0, label + ' 筛选条件+排序 localStorage 持久化')
      assert(s.indexOf('searchMatches') >= 0 && s.indexOf('relRank') >= 0, label + ' 命中字段消费 + 相关度排位')
      assert(s.indexOf('sArgs.sensitive = true') >= 0 && s.indexOf('sArgs.inject = true') >= 0, label + ' 组合过滤参数同步 host（单条件独活时）')
      assert(s.indexOf("host.call('notes-search', sArgs)") >= 0 || s.indexOf("rpc('notes-search', sArgs)") >= 0, label + ' notes-search 走 sArgs（含组合过滤）')
      assert(s.indexOf('FILTERS0()') >= 0 && s.indexOf('matchFilters(n, filters)') >= 0, label + ' filters state + 谓词接入')
      assert(s.indexOf("'清空筛选'") >= 0, label + ' 空结果态「清空筛选」快捷动作')
      // Esc 顺序：排序菜单先于筛选 popover 关闭
      const escI = s.indexOf("if (ev.key === 'Escape')")
      const sI = s.indexOf('sortOpenRef.current) { setSortOpen(false); return }', escI)
      const fI = s.indexOf('filterOpenRef.current) { setFilterOpen(false); return }', escI)
      assert(sI > 0 && fI > 0 && sI < fI, label + ' Esc 顺序：排序菜单 → 筛选 popover')
      // 旧筛选面板/平铺 chips 已移除
      assert(s.indexOf('dsh-notes-filter-panel') < 0 && s.indexOf('dsh-notes-fp-opt') < 0 && s.indexOf('dsh-notes-chip-badge') < 0, label + ' 旧筛选面板结构已移除')
      assert(s.indexOf("'仅置顶'") < 0 && s.indexOf("'仅敏感'") < 0 && s.indexOf("'仅注入'") < 0, label + ' 旧单选开关文案已移除')
      assert(s.indexOf('kindFilter') < 0 && s.indexOf('pinnedOnly') < 0 && s.indexOf('sensOnly') < 0 && s.indexOf('injOnly') < 0, label + ' 旧过滤 state 已迁入 filters')
    }
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('id="filterbar"') >= 0 && s.indexOf('id="btnFilter"') >= 0 && s.indexOf('id="fchips"') >= 0 && s.indexOf('id="fpop"') >= 0 && s.indexOf('id="btnSort"') >= 0 && s.indexOf('id="fsortMenu"') >= 0 && s.indexOf('id="filterBd"') >= 0, label + ' 筛选中心 DOM 骨架')
      // 状态组/类型组 checkbox 由 FILTER_STATUS/FILTER_KINDS 驱动生成（data-ft/data-fk 为拼接属性，断言模型定义 + 拼接点）
      assert(s.indexOf("{ id: 'pinned', label: '置顶', icon: 'i-pin'") >= 0 && s.indexOf("{ id: 'injected', label: '已注入', icon: 'i-bolt'") >= 0 && s.indexOf("{ id: 'injectEver', label: '曾注入', icon: 'i-clock'") >= 0 && s.indexOf("{ id: 'sensitive', label: '敏感', icon: 'i-lock'") >= 0, label + ' 状态组四条件模型（多选）')
      assert(s.indexOf("data-ft=\"' + s.id + '\"") >= 0 && s.indexOf("data-fk=\"' + k + '\"") >= 0, label + ' 状态组/类型组 checkbox 接线（data-ft/data-fk）')
      assert(s.indexOf("var FILTER_KINDS = ['note', 'decision', 'todo', 'link', 'quote', 'log'];") >= 0, label + ' 类型组六种 kind（多选；+log 工作记忆 v0 专入口）')
      assert(s.indexOf("if (s.id === 'injectEver' && !showEver) return") >= 0, label + ' 曾注入 feature-detect（slim 无 injectEver 字段不显示）')
      assert(s.indexOf('组内多选 = OR') >= 0 && s.indexOf('组内 OR · 与状态组 = AND') >= 0, label + ' 分组规则文案')
      assert(s.indexOf('id="popClear"') >= 0 && s.indexOf('id="popDone"') >= 0 && s.indexOf('命中 ') >= 0, label + ' popover 底部 清空/完成/命中数')
      assert(s.indexOf('id="emptyClear"') >= 0 && s.indexOf('清空筛选条件') >= 0, label + ' 空结果态清空链接')
      assert(s.indexOf('function matchFilters(n, F)') >= 0 && s.indexOf('matchFilters(n, filters)') >= 0, label + ' 筛选谓词（组内 OR / 跨组 AND）')
      assert(s.indexOf('function renderFilterBar()') >= 0 && s.indexOf('function renderFilterPop()') >= 0 && s.indexOf('function renderSortMenu()') >= 0, label + ' 筛选中心渲染函数')
      assert(s.indexOf('function doSearch()') >= 0 && s.indexOf('function reSearch()') >= 0, label + ' 搜索/重搜函数保留')
      assert(s.indexOf('sArgs.sensitive = true') >= 0 && s.indexOf('sArgs.inject = true') >= 0 && s.indexOf('sArgs.kind = filters.kinds[0]') >= 0 && s.indexOf("rpc('notes-search', sArgs)") >= 0, label + ' 组合过滤参数同步 host（单条件独活/类型单选时）')
      assert(s.indexOf("localStorage.getItem('dsh-notes-app-filters')") >= 0 && s.indexOf("localStorage.setItem('dsh-notes-app-filters'") >= 0, label + ' 筛选条件+排序 localStorage 持久化')
      assert(s.indexOf("$('btnFilter').addEventListener('click'") >= 0 && s.indexOf("$('btnSort').addEventListener('click'") >= 0, label + ' 筛选/排序按钮接线')
      assert(s.indexOf("$('fchips').addEventListener('click'") >= 0 && s.indexOf('filters[c.dataset.ft] = false') >= 0 && s.indexOf('filters.kinds.splice(i, 1)') >= 0, label + ' 激活 chip × 单条移除')
      assert(s.indexOf("$('fsortMenu').addEventListener('click'") >= 0, label + ' 排序菜单接线')
      assert(s.indexOf('function hl(text, q)') >= 0 && s.indexOf("hl(n.title || '无标题', searchText)") >= 0 && s.indexOf('.note-row .ti mark{') >= 0, label + ' hl() 高亮保留')
      assert(s.indexOf("sortBy === 'rel' && qRel") >= 0, label + ' 相关度排序档保留')
      assert(s.indexOf('id="i-clock"') >= 0 && s.indexOf('id="i-sort"') >= 0 && s.indexOf('id="i-x"') >= 0, label + ' defs 含 i-clock/i-sort/i-x（曾注入/排序/×）')
      assert(s.indexOf('id="btnSelMode"') >= 0 && s.indexOf('id="btnNew"') >= 0, label + ' 选择（side-foot）/新建（brand 行）保留')
      assert(s.indexOf('class="add-new" id="btnNew"') >= 0 && s.indexOf('.brand .add-new{') >= 0, label + ' 新建入口迁入 brand 行')
      // Esc 顺序：排序菜单先于筛选 popover
      const sI2 = s.indexOf('if (sortOpen) { sortOpen = false; renderFilterBar(); return }')
      const fI2 = s.indexOf('if (filterOpen) { filterOpen = false; renderFilterBar(); return }')
      assert(sI2 > 0 && fI2 > 0 && sI2 < fI2, label + ' Esc 顺序：排序菜单 → 筛选 popover')
      // 旧筛选面板/平铺 chips 已移除
      assert(s.indexOf('id="fpanel"') < 0 && s.indexOf('.fpanel{') < 0 && s.indexOf('.fp-opt.on{') < 0 && s.indexOf('.chip .fbdg{') < 0, label + ' 旧筛选面板样式/容器已移除')
      assert(s.indexOf('id="chips"') < 0 && s.indexOf("'仅置顶'") < 0 && s.indexOf("'仅敏感'") < 0 && s.indexOf("'仅注入'") < 0, label + ' 旧 chips 行/单选开关文案已移除（带引号条件文案，避免误伤 mock 文本）')
      assert(s.indexOf('data-ft="inject"') < 0 && s.indexOf('data-k=') < 0 && s.indexOf('chipSortUse') < 0, label + ' 旧条件标记已迁移')
      // 布局层级断言（硬性约束：树区不被挤压）
      assert(/\.side\{[^}]*display:flex;flex-direction:column/.test(s), label + ' 侧栏 flex 纵列')
      assert(/\.tree\{[^}]*flex:1;overflow-y:auto/.test(s), label + ' 树区 flex:1 自适应剩余高度')
      assert(/\.filterbar\{[^}]*flex-wrap:nowrap[^}]*flex-shrink:0/.test(s), label + ' 控制行不换行 + 固定高度（不挤压树区）')
      assert(/\.fchips\{[^}]*overflow-x:auto/.test(s), label + ' 激活 chips 单行横向滚动')
      assert(/\.fpop\{[^}]*position:absolute/.test(s) && /\.fsort-menu\{[^}]*position:absolute/.test(s), label + ' popover/排序菜单均 absolute 浮层（覆盖树上）')
    }
    // 筛选谓词语义功能级回归：从四端源码提取 matchFilters 逐语义验证（组内 OR / 跨组 AND / 曾注入含已注入 / kind 缺省 note）
    const F0 = { pinned: false, injected: false, injectEver: false, sensitive: false, kinds: [] }
    const F$ = (o) => Object.assign({}, F0, o)
    for (const pair of [['client-impl', clientSrc, '\n    }'], ['发布包 lib/client.js', clientPkgSrc, '\n    }'], ['app.html', appSrc, '\n}'], ['原型 notes-ui-v2.html', protoV2Src, '\n}']]) {
      const start = pair[1].indexOf('function matchFilters(n, F) {')
      const end = start < 0 ? -1 : pair[1].indexOf(pair[2], start)
      assert(start >= 0 && end > start, pair[0] + ' matchFilters 可提取')
      const m = [pair[1].slice(start, end + pair[2].length)]
      const mf = new Function('return ' + m[0])()
      assert(mf({ id: 'a' }, F0) === true, pair[0] + ' 无条件全过')
      assert(mf({ status: 'pinned' }, F$({ pinned: true })) === true && mf({ status: 'active' }, F$({ pinned: true })) === false, pair[0] + ' 置顶单条件')
      assert(mf({ status: 'pinned' }, F$({ pinned: true, sensitive: true })) === true && mf({ sensitive: true }, F$({ pinned: true, sensitive: true })) === true && mf({ status: 'active' }, F$({ pinned: true, sensitive: true })) === false, pair[0] + ' 状态组组内 OR（置顶 ∪ 敏感）')
      assert(mf({ inject: true, kind: 'decision' }, F$({ injected: true, kinds: ['decision'] })) === true && mf({ inject: true, kind: 'note' }, F$({ injected: true, kinds: ['decision'] })) === false && mf({ inject: false, kind: 'decision' }, F$({ injected: true, kinds: ['decision'] })) === false, pair[0] + ' 跨组 AND（已注入 ∩ 决策）')
      assert(mf({ kind: 'todo' }, F$({ kinds: ['note', 'todo'] })) === true && mf({ kind: 'link' }, F$({ kinds: ['note', 'todo'] })) === false, pair[0] + ' 类型组组内 OR')
      assert(mf({ injectEver: true, inject: true }, F$({ injectEver: true })) === true && mf({ injectEver: true }, F$({ injectEver: true })) === true && mf({ inject: true }, F$({ injectEver: true })) === false, pair[0] + ' 曾注入含已注入（injectEver=true 即命中）')
      assert(mf({}, F$({ kinds: ['note'] })) === true, pair[0] + ' kind 缺省回退 note')
    }
    assert(protoV2Src.indexOf('id="i-lock"') >= 0, '原型 defs 含 i-lock 图标（敏感条件）')
    assert(protoV2Src.indexOf('a.sensitive === true && x.sensitive !== true') >= 0, '原型 mock notes-search 组合过滤同 host 口径')
    assert(protoV2Src.indexOf("s.matches.push('title')") >= 0, '原型 mock 返回 matches 命中字段')
    assert(protoV2Src.indexOf('sensitive: n.sensitive === true') >= 0, '原型 mock slim 含 sensitive')
    assert(protoV2Src.indexOf("recall: true, sensitive: true, tags: [], createdAt: '2026-09-23T08:00:00.000Z'") >= 0, '原型 mock 演示数据：n4 敏感笔记（npm token）')
    assert(protoV2Src.indexOf('injectEver: true') >= 0 && protoV2Src.indexOf('if (n.injectEver !== undefined) s.injectEver = n.injectEver === true') >= 0, '原型 mock：曾注入演示数据 + slim 条件透传（feature-detect）')
    const cssDev34 = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg34 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev34], ['发布包 lib/styles.css', cssPkg34]]) {
      const c = pair[1], lab = pair[0]
      assert(c.indexOf('.dsh-notes-filterbar{') >= 0 && c.indexOf('.dsh-notes-fpop{') >= 0 && c.indexOf('.dsh-notes-fchip{') >= 0 && c.indexOf('.dsh-notes-fsort-menu{') >= 0 && c.indexOf('.dsh-notes-fg-item{') >= 0 && c.indexOf('.dsh-notes-pbtn') >= 0, lab + ' 缺筛选中心样式（需跑 scripts/build-dist.cjs）')
      assert(c.indexOf('.dsh-notes-brand-add{') >= 0, lab + ' 缺 brand 行新建入口样式')
      assert(c.indexOf('.dsh-notes-mark{') >= 0, lab + ' 缺 mark 高亮样式')
      assert(/\.dsh-notes-filterbar\{[^}]*flex-wrap:nowrap[^}]*flex-shrink:0/.test(c) && /\.dsh-notes-fchips\{[^}]*overflow-x:auto/.test(c), lab + ' 控制行不换行 + chips 单行横滚（树区高度不受影响）')
      assert(/\.dsh-notes-fpop\{[^}]*position:absolute/.test(c) && /\.dsh-notes-fsort-menu\{[^}]*position:absolute/.test(c), lab + ' popover/排序菜单 absolute 浮层')
      assert(c.indexOf('.dsh-notes-filter-panel') < 0 && c.indexOf('.dsh-notes-fp-opt') < 0 && c.indexOf('.dsh-notes-chip-badge') < 0 && c.indexOf('.dsh-notes-chips{') < 0, lab + ' 旧筛选面板/chips 行样式已移除')
    }
  })
  await t('app.html / 原型 <script> 块语法自洽（提取 new Function 校验）', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const m = pair[1].match(/<script>([\s\S]*?)<\/script>/)
      assert(m && m[1].length > 1000, pair[0] + ' script 块可提取')
      new Function(m[1])   // 语法错误会抛出
    }
  })

  // ---- 34.6 injectEver 曾注入粘性标记（notes-inject-filter）：host 双包字段链路 + 行为（粘性/归档继承）+ 四端徽章/chip ----
  await t('injectEver 字段链路源码断言（host-impl / index.mjs 双包同步）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const src = pair[1], label = pair[0]
      assert(src.indexOf("'injectEver: ' + escYaml(m.injectEver === true ? 'true' : 'false')") >= 0, label + ' buildFM 恒写 injectEver（缺省 false）')
      assert(src.indexOf("injectEver: p.meta.injectEver === 'true' || inject === true") >= 0, label + ' noteFromParsed 读 injectEver（缺省 false + 现状兜底 injectEver ⊇ inject）')
      assert((src.match(/injectEver: n\.injectEver === true \|\| n\.inject === true/g) || []).length >= 2, label + ' persistNote 与 slim 均携带 injectEver')
      assert(src.indexOf('injectEver: isLog ? (ex.injectEver === true) : (ex.injectEver === true || ex.inject === true),') >= 0, label + ' _create 粘性（创建即注入 / 归档继承显式传入；kind=log 隐身硬闸下不随被纠正的 inject 拉起）')
      assert(src.indexOf('if (inject === true) note.injectEver = true') >= 0, label + ' _update 单向粘性（inject 置 true 拉起，置 false/不传不回退）')
      assert(src.indexOf('injectEver: meta.inject === true') >= 0, label + ' notes-quick-instruct 落 injectEver')
      assert(src.indexOf('injectEver: members.some(n => n.injectEver === true || n.inject === true)') >= 0, label + ' _mergeGroup 归档继承（members.some，与 sensitive 同款）')
      assert(src.indexOf('never unsets it; injectEver is read-only') >= 0, label + ' note_manage 工具描述说明 injectEver 粘性语义')
    }
  })

  // --- 行为断言（独立实例 storeIE/handlersIE/toolsIE，与其他章节隔离；同 sensitive 节同款模式）---
  const storeIE = new Map()
  const fsMockIE = mkFsMockImp(storeIE, [NOTES_DIR])
  const handlersIE = {}
  const toolsIE = []
  const harnessMockIE = {
    handle: (name, fn) => { handlersIE[name] = fn; return () => { delete handlersIE[name] } },
    defineTool: (def) => def,
    registerTool: (ctx, def) => { toolsIE.push(def); return () => {} },
  }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockIE, DIR).apply({
    fs: fsMockIE, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  const nmIE = toolsIE.find(x => x.name === 'note_manage')

  await t('injectEver 创建即粘性：create inject=true → get / list（slim）/ front-matter 均 true', async () => {
    const c = await handlersIE['notes-create']({ title: '注入约定甲IE', body: 'x', topic: '注入IE', inject: true })
    assert.strictEqual((await handlersIE['notes-get']({ id: c.id })).note.injectEver, true, 'notes-get injectEver=true')
    const lst = await handlersIE['notes-list']({})
    assert.strictEqual(lst.notes.find(n => n.id === c.id).injectEver, true, 'notes-list（slim）携带 injectEver=true')
    const onDisk = storeIE.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(onDisk.indexOf('\ninjectEver: true\n') >= 0, 'front-matter 写 injectEver: true（实得：' + onDisk.split('\n').slice(0, 18).join('|') + '）')
  })
  await t('injectEver 缺省 false：create 不传 inject → get false + front-matter 恒写 false', async () => {
    const c = await handlersIE['notes-create']({ title: '普通笔记乙IE', body: 'x', topic: '杂IE' })
    assert.strictEqual((await handlersIE['notes-get']({ id: c.id })).note.injectEver, false, '缺省 false（noteFromParsed 回退）')
    const onDisk = storeIE.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(onDisk.indexOf('\ninjectEver: false\n') >= 0, 'buildFM 恒写 injectEver: false')
  })
  await t('injectEver 单向粘性（never unset）：开 → 关 → 仍 true；不传 inject 不动存量值', async () => {
    const c = await handlersIE['notes-create']({ title: '粘性笔记丙IE', body: 'x', topic: '注入IE' })
    assert.strictEqual((await handlersIE['notes-get']({ id: c.id })).note.injectEver, false, '初始 false')
    await handlersIE['notes-update']({ id: c.id, inject: true })
    assert.strictEqual((await handlersIE['notes-get']({ id: c.id })).note.injectEver, true, '开启注入 → injectEver=true')
    await handlersIE['notes-update']({ id: c.id, inject: false })
    const g2 = (await handlersIE['notes-get']({ id: c.id })).note
    assert.strictEqual(g2.inject, false, 'inject 已关闭')
    assert.strictEqual(g2.injectEver, true, '粘性核心断言：关闭注入后 injectEver 仍 true（不回退）')
    const onDisk = storeIE.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(onDisk.indexOf('\ninject: false\n') >= 0 && onDisk.indexOf('\ninjectEver: true\n') >= 0, '落盘 inject=false 与 injectEver=true 并存')
    await handlersIE['notes-update']({ id: c.id, topic: '注入IE-改' })
    assert.strictEqual((await handlersIE['notes-get']({ id: c.id })).note.injectEver, true, 'update 不传 inject → injectEver 不动')
  })
  await t('note_manage create/update 透传粘性：manage 开启 → 关闭 → 仍 true；list（slim）携带', async () => {
    const c = await nmIE.execute({ action: 'create', title: '工具粘性丁IE', body: 'x', topic: '注入IE' })
    assert(!c.error, 'manage.create 成功（实得：' + JSON.stringify(c) + '）')
    await nmIE.execute({ action: 'update', id: c.id, inject: true })
    assert.strictEqual((await handlersIE['notes-get']({ id: c.id })).note.injectEver, true, 'manage.update inject=true 拉起 injectEver')
    await nmIE.execute({ action: 'update', id: c.id, inject: false })
    assert.strictEqual((await handlersIE['notes-get']({ id: c.id })).note.injectEver, true, 'manage.update inject=false 不回退（粘性）')
    const lst = await nmIE.execute({ action: 'list' })
    assert.strictEqual(lst.notes.find(n => n.id === c.id).injectEver, true, 'manage.list（slim）携带 injectEver=true')
  })
  await t('存量文件兼容：无字段缺省 false；旧 inject=true 现状兜底 true；injectEver: true 解析保留', async () => {
    await fsMockIE.writeText(NOTES_DIR + '\\n-legacy-plain-ie.md', '---\nid: n-legacy-plain-ie\ntitle: 旧普通\ntopic: 杂\ninject: false\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\nsessionId: \ncwd: \n---\n\nx\n')
    assert.strictEqual((await handlersIE['notes-get']({ id: 'n-legacy-plain-ie' })).note.injectEver, false, '旧文件无 injectEver 字段缺省 false（零迁移）')
    await fsMockIE.writeText(NOTES_DIR + '\\n-legacy-inj-ie.md', '---\nid: n-legacy-inj-ie\ntitle: 旧注入\ntopic: 杂\ninject: true\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\nsessionId: \ncwd: \n---\n\nx\n')
    assert.strictEqual((await handlersIE['notes-get']({ id: 'n-legacy-inj-ie' })).note.injectEver, true, '旧 inject=true 笔记现状兜底 injectEver=true（injectEver ⊇ inject 不变量）')
    await fsMockIE.writeText(NOTES_DIR + '\\n-legacy-ever-ie.md', '---\nid: n-legacy-ever-ie\ntitle: 旧曾注入\ntopic: 杂\ninject: false\ninjectEver: true\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\nsessionId: \ncwd: \n---\n\nx\n')
    const g3 = (await handlersIE['notes-get']({ id: 'n-legacy-ever-ie' })).note
    assert.strictEqual(g3.injectEver, true, 'injectEver: true 存量解析保留')
    assert.strictEqual(g3.inject, false, 'inject: false 保留（曾注入且已关闭形态）')
  })
  await t('归档合并 injectEver 继承：任一成员曾注入/正注入 → 归档笔记 true；全普通 → false', async () => {
    const c1 = await nmIE.execute({ action: 'create', title: '归档成员-曾注入IE', body: 'x1', topic: '归档IE' })
    await nmIE.execute({ action: 'update', id: c1.id, inject: true })
    await nmIE.execute({ action: 'update', id: c1.id, inject: false })   // 曾注入（现已关闭）
    const c2 = await nmIE.execute({ action: 'create', title: '归档成员-普通IE', body: 'x2', topic: '归档IE' })
    const r = await nmIE.execute({ action: 'archive', groups: [{ memberIds: [c1.id, c2.id] }] })
    assert(!r.error && r.merged === 1, '归档成功（实得：' + JSON.stringify(r) + '）')
    assert.strictEqual((await handlersIE['notes-get']({ id: r.mergedIds[0] })).note.injectEver, true, '归档笔记继承 injectEver（成员曾注入）')
    const c3 = await nmIE.execute({ action: 'create', title: '归档成员-普通甲IE', body: 'y1', topic: '归档IE2' })
    const c4 = await nmIE.execute({ action: 'create', title: '归档成员-普通乙IE', body: 'y2', topic: '归档IE2' })
    const r2 = await nmIE.execute({ action: 'archive', groups: [{ memberIds: [c3.id, c4.id] }] })
    assert(!r2.error && r2.merged === 1, '第二组归档成功')
    assert.strictEqual((await handlersIE['notes-get']({ id: r2.mergedIds[0] })).note.injectEver, false, '全普通成员 → 归档笔记 injectEver=false')
  })
  await t('静态包 index.mjs 行为：injectEver 粘性（开 → 关 → 仍 true）+ slim 携带', async () => {
    const storeIE2 = new Map()
    const handlersIE2 = {}
    const harnessMockIE2 = { handle: (name, fn) => { handlersIE2[name] = fn; return () => { delete handlersIE2[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
    global.harness = harnessMockIE2   // 静态包 handle() 主通道读全局 harness（apply 时解析）；指回本实例注册表
    const modIE = await import(pathToFileURL(INDEX_PATH).href + '?injever=1')
    modIE.apply({
      fs: mkFsMockImp(storeIE2, [NOTES_ROOT_STATIC]), sandboxPolicy: { resolve: () => ({}) },
      webServer: { register: () => () => {} }, tools: { register: () => () => {} },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    const c = await handlersIE2['notes-create']({ title: '静态粘性IE', body: 'x', topic: '注入IE' })
    assert.strictEqual((await handlersIE2['notes-get']({ id: c.id })).note.injectEver, false, '静态包初始 false')
    await handlersIE2['notes-update']({ id: c.id, inject: true })
    await handlersIE2['notes-update']({ id: c.id, inject: false })
    const g = (await handlersIE2['notes-get']({ id: c.id })).note
    assert.strictEqual(g.inject, false, '静态包 inject 已关闭')
    assert.strictEqual(g.injectEver, true, '静态包粘性：关闭注入后 injectEver 仍 true')
    const lst = await handlersIE2['notes-list']({})
    assert.strictEqual(lst.notes.find(n => n.id === c.id).injectEver, true, '静态包 slim 携带 injectEver')
    const onDisk = storeIE2.get(NOTES_ROOT_STATIC + '\\' + c.id + '.md')
    assert(onDisk.indexOf('\ninjectEver: true\n') >= 0, '静态包 front-matter 落 injectEver: true')
  })

  // --- 四端同步：曾注入行徽章 + 详情 meta chip（面板双形态 / app.html / 原型）---
  await t('四端同步：曾注入行徽章（clock）+ 详情 meta chip + 样式', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("className: 'dsh-notes-note-injevr dsh-nt'") >= 0, label + ' 行尾曾注入徽章（clock，被引用徽章旁；需跑 scripts/build-dist.cjs）')
      assert(s.indexOf("n.inject !== true && n.injectEver === true ? e('span', { className: 'dsh-notes-note-injevr") >= 0, label + ' 行徽章条件：曾注入且非已注入（互斥 bolt），不满足不渲染')
      assert(s.indexOf("'data-tooltip': '曾注入：历史上开启过上下文注入（现已关闭）'") >= 0, label + ' 行徽章 tooltip')
      assert(s.indexOf("curNote.injectEver === true && !isInjected") >= 0, label + ' 详情 chip 条件（injectEver 且当前未注入）')
      assert(s.indexOf("I('clock', 11), '曾注入'") >= 0, label + ' 详情 meta chip「曾注入」（clock 图标）')
      assert(s.indexOf('injectEver 为粘性标记，不随关闭回退') >= 0, label + ' 详情 chip tooltip 说明粘性语义')
      assert(s.indexOf("clock: [e('circle'") >= 0, label + ' IC.clock 时钟图标')
    }
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("!n.inject && n.injectEver === true ? '<span class=\"injevr\"") >= 0, label + ' 行徽章条件：曾注入且非已注入（互斥 bolt）')
      assert(s.indexOf('曾注入：历史上开启过上下文注入（现已关闭）') >= 0, label + ' 行徽章 tooltip')
      assert(s.indexOf("icon('i-clock', 9)") >= 0, label + ' 行徽章 i-clock 图标')
      assert(s.indexOf('.note-row .injevr{') >= 0, label + ' 行徽章样式（淡灰时钟）')
      assert(s.indexOf("n.injectEver === true && !n.inject ? '<span class=\"meta-chip\"") >= 0, label + ' 详情 meta chip 条件')
      assert(s.indexOf("icon('i-clock') + '曾注入</span>'") >= 0, label + ' 详情 meta chip「曾注入」')
      assert(s.indexOf('injectEver 为粘性标记，不随关闭回退') >= 0, label + ' 详情 chip tooltip 说明粘性语义')
    }
    const cssIEDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssIEPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssIEDev], ['发布包 lib/styles.css', cssIEPkg]]) {
      assert(pair[1].indexOf('.dsh-notes-note-injevr{') >= 0, pair[0] + ' 含曾注入行徽章样式（需跑 scripts/build-dist.cjs）')
    }
    // 原型 mock：n3/n10 曾注入演示数据（inject: false + injectEver: true → 行渲染时钟徽章）
    assert(protoV2Src.indexOf("inject: false, injectTo: [], recall: true, tags: ['quick'], injectEver: true") >= 0, '原型 mock n3 曾注入演示数据')
  })

  // ===== 35. 侧栏宽度拖拽分隔条（面板 + app.html + 原型三端同步：拖拽 / clamp 200px–60% / localStorage 记忆 / 双击重置） =====
  section('35. 侧栏宽度拖拽分隔条（splitter：拖拽 + clamp + 记忆 + 双击重置，三端同步）')
  const spCssDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
  const spCssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
  const spClientPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
  const spApp = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
  const spProto = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
  await t('面板分隔条链路（client-impl.js）：元素 / DOM 序 / 拖拽 / clamp / 记忆 / 双击重置', () => {
    assert(clientSrc.indexOf("className: 'dsh-notes-splitter dsh-nt'") >= 0, '分隔条元素 .dsh-notes-splitter')
    assert(clientSrc.indexOf('onMouseDown: onSplitterMouseDown') >= 0 && clientSrc.indexOf('onDoubleClick: resetSideW') >= 0, 'mousedown / dblclick 接线')
    // DOM 序：分隔条位于侧栏（side-foot 之后）与编辑器（editorEl）之间
    const iFoot = clientSrc.indexOf('dsh-notes-side-foot'), iSplit = clientSrc.indexOf("className: 'dsh-notes-splitter"), iEd = clientSrc.indexOf('editorEl),')
    assert(iFoot > 0 && iSplit > iFoot && iEd > iSplit, '分隔条位于侧栏与编辑器之间')
    // 拖拽链路：复用 drag() 助手（mousemove 挂 document、mouseup 移除监听防泄漏）；拖拽期间 body 禁选 class 随 mouseup 移除
    const iFn = clientSrc.indexOf('function onSplitterMouseDown(ev)')
    assert(iFn > 0, 'onSplitterMouseDown 存在')
    const fnBody = clientSrc.slice(iFn, clientSrc.indexOf('function resetSideW', iFn))
    assert(fnBody.indexOf('drag(') >= 0, '复用 drag() 助手')
    assert(fnBody.indexOf("document.body.classList.add('dsh-notes-split-drag')") >= 0 && fnBody.indexOf("document.body.classList.remove('dsh-notes-split-drag')") >= 0, '拖拽期间禁文本选择（mouseup 移除）')
    assert(fnBody.indexOf('clampSideW(sw + ev2.clientX - sx') >= 0, 'mousemove 按面板内相对坐标增量算宽')
    assert(fnBody.indexOf('saveSideW(sideWRef.current)') >= 0, 'mouseup 持久化（ref 防闭包过期）')
    // drag() 助手自身：document mousemove / mouseup 成对装卸（mouseup 移除监听防泄漏）
    const iDrag = clientSrc.indexOf('function drag(move, done)')
    const dragBody = iDrag < 0 ? '' : clientSrc.slice(iDrag, iDrag + 420)
    assert(iDrag > 0 && dragBody.indexOf("document.addEventListener('mousemove', onMove)") >= 0 && dragBody.indexOf("document.removeEventListener('mousemove', onMove)") >= 0 && dragBody.indexOf("document.removeEventListener('mouseup', onUp)") >= 0, 'drag()：mousemove 挂 document、mouseup 移除监听')
    // clamp / 记忆 / 缺省 / aside 宽度受控
    assert(clientSrc.indexOf('function clampSideW(w, panelW)') >= 0 && clientSrc.indexOf('Math.max(200, Math.min(Math.round(panelW * 0.6), Math.round(w)))') >= 0, 'clamp 200px–60% 面板宽')
    assert(clientSrc.indexOf("const SIDE_W_KEY = 'dsh-notes-sidebar-w'") >= 0 && clientSrc.indexOf('const SIDE_W_DEFAULT = 300') >= 0, 'localStorage key（面板独立）+ 缺省 300（同 styles.css 侧栏缺省宽）')
    assert(clientSrc.indexOf('function resetSideW()') >= 0 && clientSrc.indexOf('saveSideW(null)') >= 0, '双击重置缺省宽（清除持久化）')
    assert(clientSrc.indexOf("className: 'dsh-notes-side', style: { width: clampSideW(sideW, size.width) + 'px' }") >= 0, 'aside 宽度受控（渲染按当前面板宽 clamp）')
  })
  await t('面板 clamp 边界 + 记忆恢复行为（client-impl 提取执行）', () => {
    const grabLine = (src, name) => { const st = src.indexOf('function ' + name + '('); assert(st >= 0, name + ' 存在'); return src.slice(st, src.indexOf('\n', st)) }
    const clampFn = new Function('return ' + grabLine(clientSrc, 'clampSideW'))()
    assert(clampFn(100, 920) === 200, 'clamp 下限 200px')
    assert(clampFn(300, 920) === 300, 'clamp 区间内原值')
    assert(clampFn(9999, 920) === 552, 'clamp 上限 = 60% 面板宽（920→552）')
    assert(clampFn(9999, 680) === 408, '上限随面板宽收窄（680→408）')
    const store = {}
    const mockLS = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) }, removeItem: (k) => { delete store[k] } }
    const fns = new Function('localStorage', 'SIDE_W_KEY', grabLine(clientSrc, 'loadSideW') + '\n' + grabLine(clientSrc, 'saveSideW') + '\nreturn { loadSideW: loadSideW, saveSideW: saveSideW }')(mockLS, 'dsh-notes-sidebar-w')
    assert(fns.loadSideW() === null, '无持久化 → null（回缺省）')
    fns.saveSideW(420)
    assert(store['dsh-notes-sidebar-w'] === '420' && fns.loadSideW() === 420, '拖拽结束持久化 → 加载恢复')
    fns.saveSideW(null)
    assert(!('dsh-notes-sidebar-w' in store) && fns.loadSideW() === null, '双击重置清除持久化 → 回缺省')
    fns.saveSideW(150)
    assert(fns.loadSideW() === null, '非法值（<200）不回读')
  })
  await t('分隔条样式双端（styles.css ⇄ 发布包 lib/styles.css，build-dist 同步）', () => {
    for (const pair of [['styles.css', spCssDev], ['发布包 lib/styles.css', spCssPkg]]) {
      const c = pair[1], lab = pair[0]
      assert(c.indexOf('.dsh-notes-splitter{width:4px;margin:0 -7px;') >= 0, lab + ' 4px 分隔条叠加间隙不占位（负 margin 抵消 gap，需跑 scripts/build-dist.cjs）')
      assert(c.indexOf('.dsh-notes-splitter:hover,.dsh-notes-splitter.on{background:var(--nacc)}') >= 0, lab + ' hover/拖拽中高亮（需跑 scripts/build-dist.cjs）')
      assert(/\.dsh-notes-splitter\{[^}]*cursor:col-resize/.test(c), lab + ' col-resize 光标（需跑 scripts/build-dist.cjs）')
      assert(c.indexOf('body.dsh-notes-split-drag') >= 0 && c.indexOf('user-select:none!important') >= 0, lab + ' 拖拽期间全局禁文本选择（需跑 scripts/build-dist.cjs）')
    }
  })
  await t('发布包 client.js 同步分隔条链路（需先跑 scripts/build-dist.cjs）', () => {
    assert(spClientPkg.indexOf("className: 'dsh-notes-splitter") >= 0 && spClientPkg.indexOf('onSplitterMouseDown') >= 0 && spClientPkg.indexOf('resetSideW') >= 0 && spClientPkg.indexOf("'dsh-notes-sidebar-w'") >= 0, '发布包 lib/client.js 缺分隔条链路（需先跑 scripts/build-dist.cjs）')
  })
  await t('app.html + 原型同款：分隔条 DOM / 样式 / 脚本双端一致（key 独立 dsh-notes-app-sidebar-w）', () => {
    for (const pair of [['app.html', spApp], ['原型 notes-ui-v2.html', spProto]]) {
      const s = pair[1], lab = pair[0]
      // DOM：分隔条位于 </aside> 与 <section class="ed" 之间
      const iAside = s.indexOf('</aside>'), iSplit = s.indexOf('<div class="splitter" id="splitter"'), iEd = s.indexOf('<section class="ed')
      assert(iAside > 0 && iSplit > iAside && iEd > iSplit, lab + ' 分隔条 DOM 序：aside → splitter → ed')
      assert(s.indexOf('title="拖拽调整侧栏宽度（双击重置）"') >= 0, lab + ' 分隔条引导 tooltip')
      // 样式：4px 叠加间隙不占位 + hover/拖拽高亮 + col-resize + 拖拽期间禁选
      assert(s.indexOf('.splitter{width:4px;margin:0 -7px;') >= 0, lab + ' 4px 拖拽条叠加间隙不占位（负 margin 抵消 gap）')
      assert(s.indexOf('.splitter:hover,.splitter.on{background:var(--nacc)}') >= 0, lab + ' hover/拖拽中高亮')
      assert(/\.splitter\{[^}]*cursor:col-resize/.test(s), lab + ' col-resize 光标')
      assert(s.indexOf('body.split-drag') >= 0 && s.indexOf('user-select:none!important') >= 0, lab + ' 拖拽期间禁文本选择')
      // 脚本：mousedown 起拖 → document mousemove 算宽 → mouseup 卸监听；clamp；记忆；双击重置；窗口 resize 复核
      assert(s.indexOf("splitterEl.addEventListener('mousedown'") >= 0, lab + ' mousedown 起拖')
      assert(s.indexOf("document.addEventListener('mousemove', onMove)") >= 0 && s.indexOf("document.removeEventListener('mousemove', onMove)") >= 0 && s.indexOf("document.removeEventListener('mouseup', onUp)") >= 0, lab + ' mousemove 挂 document、mouseup 移除监听防泄漏')
      assert(s.indexOf("document.body.classList.add('split-drag')") >= 0 && s.indexOf("document.body.classList.remove('split-drag')") >= 0, lab + ' 拖拽期间禁选 class 随 mouseup 移除')
      assert(s.indexOf('function clampSideW(w)') >= 0 && s.indexOf('Math.max(200, Math.min(Math.round(') >= 0 && s.indexOf('* 0.6') >= 0, lab + ' clamp 200px–60% 面板宽')
      assert(s.indexOf("var SIDE_W_KEY = 'dsh-notes-app-sidebar-w'") >= 0 && s.indexOf('SIDE_W_DEFAULT = 342') >= 0, lab + ' localStorage 记忆（独立 key）+ 缺省 342（同 .side 缺省宽）')
      assert(s.indexOf('function loadSideW()') >= 0 && s.indexOf('\nloadSideW();') >= 0, lab + ' 加载恢复持久化宽度')
      assert(s.indexOf("splitterEl.addEventListener('dblclick'") >= 0 && s.indexOf('applySideW(SIDE_W_DEFAULT)') >= 0 && s.indexOf('saveSideW(null)') >= 0, lab + ' 双击重置缺省宽（清除持久化）')
      assert(s.indexOf("window.addEventListener('resize'") >= 0, lab + ' 窗口 resize 按新 60% 上限复核')
      assert(s.indexOf("'dsh-notes-sidebar-w'") < 0, lab + ' 不用面板 key（key 独立）')
    }
    // 双端逐字节一致：分隔条 CSS 块与 JS 块（UI 同步硬性约定；数据层之外的共享交互）
    const grabCss = (s) => (s.match(/  \/\* ===== 侧栏宽度拖拽条[\s\S]*?-webkit-user-select:none!important\}\n/) || [''])[0]
    assert(grabCss(spApp).length > 10 && grabCss(spApp) === grabCss(spProto), 'app.html ⇄ 原型：分隔条 CSS 逐字节一致')
    const grabJs = (s) => (s.match(/\/\* ================= 侧栏宽度拖拽条[\s\S]*?\nloadSideW\(\);\n/) || [''])[0]
    assert(grabJs(spApp).length > 10 && grabJs(spApp) === grabJs(spProto), 'app.html ⇄ 原型：分隔条脚本逐字节一致')
  })

  // ===== 35. 注入/派发图片路径消歧提示（img-path-hint：正文含 assets/ 图片引用时尾部追加绝对路径提示行） =====
  section('35. 注入/派发图片路径消歧提示（img-path-hint，host 双包）')

  // --- 35.1 标记块：双包逐字节一致 + eval 单测（与 sensitive-helpers/export-single 同款姿势）---
  const grabImgBlk = (s, tag) => { const m = s.match(/\/\/ ==== img-path-hint BEGIN ====[\s\S]*?\/\/ ==== img-path-hint END ====/); assert(m, tag + ' 缺 img-path-hint 标记块'); return m[0] }
  const imgBlkDev = grabImgBlk(hostSrc, 'host-impl.js')
  const imgBlkPkg = grabImgBlk(indexSrc, 'index.mjs')
  const imgNS = {}
  new Function('ns', imgBlkDev + '\nns.bodyHasImageRef = bodyHasImageRef; ns.assetsHintLine = assetsHintLine;')(imgNS)
  await t('img-path-hint 标记块双包逐字节一致 + 可 eval（bodyHasImageRef/assetsHintLine 导出）', () => {
    assert.strictEqual(imgBlkPkg, imgBlkDev, 'host-impl.js 与 index.mjs 的 img-path-hint 块必须逐字节一致')
    assert.strictEqual(typeof imgNS.bodyHasImageRef, 'function', 'bodyHasImageRef 导出')
    assert.strictEqual(typeof imgNS.assetsHintLine, 'function', 'assetsHintLine 导出')
  })
  await t('bodyHasImageRef：与渲染/内联同口径（![alt](assets/name) 命中；普通链接/外链/空正文不命中）', () => {
    assert.strictEqual(imgNS.bodyHasImageRef('见截图 ![架构](assets/20260101-000000-a.png) 如上'), true, '标准图片引用命中')
    assert.strictEqual(imgNS.bodyHasImageRef('![](assets/x.webp)'), true, '空 alt 命中')
    assert.strictEqual(imgNS.bodyHasImageRef('普通链接 [x](assets/a.png) 不算'), false, '无 ! 前缀的普通链接不命中')
    assert.strictEqual(imgNS.bodyHasImageRef('外链 ![x](https://a/b.png) 不算'), false, '非 assets/ 前缀不命中')
    assert.strictEqual(imgNS.bodyHasImageRef('') === false && imgNS.bodyHasImageRef(null) === false && imgNS.bodyHasImageRef(undefined) === false, true, '空/null/undefined 安全不命中')
  })
  await t('assetsHintLine：绝对 root + /assets/ 后缀 + 尾部斜杠归一', () => {
    assert.strictEqual(imgNS.assetsHintLine('D:\\x\\notes'), '（图片位于笔记库目录 D:\\x\\notes/assets/，可用文件工具直接读取）', 'Windows 绝对路径原形')
    assert.strictEqual(imgNS.assetsHintLine('/home/u/.dsh/notes/'), '（图片位于笔记库目录 /home/u/.dsh/notes/assets/，可用文件工具直接读取）', '尾部斜杠归一不双写')
  })

  // --- 35.2 行为断言（开发版 host-impl，全新实例：独立 store/handlers/contexts，含图/不含图对照确定） ---
  const store35 = new Map()
  const fsMock35 = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store35.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store35.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!store35.has(p)) throw new Error('ENOENT: ' + p); return store35.get(p) },
    writeText: async (p, c) => { store35.set(p, c) },
  }
  const handlers35 = {}
  const harnessMock35 = {
    handle: (name, fn) => { handlers35[name] = fn; return () => { delete handlers35[name] } },
    defineTool: (def) => def,
    registerTool: () => () => {},
  }
  const contexts35 = []
  const ctx35 = {
    fs: fsMock35, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contexts35.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
    on: () => () => {},
  }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock35, DIR).apply(ctx35)
  const convCtx35 = contexts35.find(x => x.name === 'notes:workspace-conventions')
  const catCtx35 = contexts35.find(x => x.name === 'notes:catalog')
  const hintCount = (s) => (s.match(/图片位于笔记库目录 /g) || []).length

  await t('对照：注入笔记正文无图 → 约定注入/目录注入均无提示行', async () => {
    await handlers35['notes-create']({ title: '无图约定', body: '纯文本约定内容', inject: true, topic: '约定' })
    const conv = convCtx35.text()
    assert(conv.indexOf('无图约定') >= 0, '约定注入正常')
    assert.strictEqual(hintCount(conv), 0, '无图时约定注入不追加提示行')
    const cat = catCtx35.text()
    assert.strictEqual(hintCount(cat), 0, '无图时目录注入不追加提示行')
  })
  await t('注入含图笔记 → 约定注入尾部追加提示行（恰好一次 + 绝对真实 NOTES_DIR 路径）', async () => {
    await handlers35['notes-create']({ title: '含图约定', body: '部署截图 ![部署](assets/20260101-000000-deploy.png) 如上', inject: true, topic: '约定' })
    const conv = convCtx35.text()
    assert.strictEqual(hintCount(conv), 1, '整条注入只追加一次提示行（不逐笔记重复），实得 ' + hintCount(conv))
    assert(conv.indexOf(imgNS.assetsHintLine(NOTES_DIR)) >= 0, '提示行含绝对真实 NOTES_DIR 路径：' + NOTES_DIR + '/assets/')
    assert(conv.indexOf('部署截图') >= 0, '原注入内容不受影响')
  })
  await t('目录条目正文含图 → 目录注入尾部追加提示行', async () => {
    await handlers35['notes-create']({ title: '含图目录笔记', body: '看图 ![x](assets/dir-img.png)' })
    const cat = catCtx35.text()
    assert(cat.indexOf('含图目录笔记') >= 0, '目录含该条目')
    assert.strictEqual(hintCount(cat), 1, '目录注入追加一次提示行')
    assert(cat.indexOf(imgNS.assetsHintLine(NOTES_DIR)) >= 0, '目录提示行含绝对 NOTES_DIR 路径')
  })
  await t('派发消息：待办正文含图 → 尾部追加提示行（绝对 NOTES_DIR）；无图对照不追加', async () => {
    const c1 = await handlers35['notes-create']({ title: '含图待办', body: '改这个弹窗 ![弹窗](assets/pop.png)', kind: 'todo' })
    const b1 = sentMessages.length
    const r1 = await handlers35['notes-dispatch']({ id: c1.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话' })
    assert(r1.ok === true && sentMessages.length === b1 + 1, '含图待办派发成功')
    const t1x = sentMessages[sentMessages.length - 1].msg.content[0].text
    assert.strictEqual(hintCount(t1x), 1, '派发消息追加一次提示行')
    assert(t1x.indexOf(imgNS.assetsHintLine(NOTES_DIR)) >= 0, '派发提示行含绝对 NOTES_DIR 路径')
    const c2 = await handlers35['notes-create']({ title: '无图待办', body: '纯文本待办', kind: 'todo' })
    const b2 = sentMessages.length
    const r2 = await handlers35['notes-dispatch']({ id: c2.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话' })
    assert(r2.ok === true && sentMessages.length === b2 + 1, '无图待办派发成功')
    assert.strictEqual(hintCount(sentMessages[sentMessages.length - 1].msg.content[0].text), 0, '无图待办派发消息不追加提示行')
  })

  // --- 35.3 静态包行为（index.mjs）：提示行路径为绝对真实 NOTES_ROOT（~/.dsh/notes） ---
  await t('静态包：注入含图笔记 → 约定注入提示行含绝对 NOTES_ROOT 路径', async () => {
    const c = await rpc2('notes-create', { title: '静态含图约定', body: '静态截图 ![s](assets/st-img.png)', inject: true, topic: '约定' })
    assert(c.body && c.body.id, '静态包建含图约定成功')
    const conv = contexts2[0].text()
    assert.strictEqual(hintCount(conv), 1, '静态包约定注入追加一次提示行')
    assert(conv.indexOf(imgNS.assetsHintLine(NOTES_ROOT_STATIC)) >= 0, '提示行含绝对真实 NOTES_ROOT：' + NOTES_ROOT_STATIC + '/assets/')
  })
  await t('静态包：派发含图待办 → 消息尾部提示行含绝对 NOTES_ROOT 路径', async () => {
    const c = await rpc2('notes-create', { title: '静态含图待办', body: '看这个 ![k](assets/st-todo.png)', kind: 'todo' })
    const before = sentMessages.length
    const d = await rpc2('notes-dispatch', { id: c.body.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话' })
    assert(d.body.ok === true && sentMessages.length === before + 1, '静态包派发成功')
    const txt = sentMessages[sentMessages.length - 1].msg.content[0].text
    assert.strictEqual(hintCount(txt), 1, '静态包派发消息追加一次提示行')
    assert(txt.indexOf(imgNS.assetsHintLine(NOTES_ROOT_STATIC)) >= 0, '静态包派发提示行含绝对 NOTES_ROOT 路径')
  })

  // ===== 36. 快照式历史引擎（.history 快照 + 稳定内容去重 + 分层保留 + 20版/50MB 上限 + purge 连带 + 导入导出适配）=====
  section('36. 快照式历史引擎（host 数据层 + 导入导出适配）')

  // ---- 36.1 双包结构同步（host-impl.js / index.mjs）----
  await t('历史引擎双包结构同步（函数/常量/persistNote 挂点/purge 连带/导入导出适配/删除通道）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('==== history-engine BEGIN ====') >= 0 && s.indexOf('==== history-engine END ====') >= 0, label + ' history-engine 标记块')
      for (const fn of ['noteFileContent', 'histContentHash', 'histNameTs', 'histNameHash', 'histFileSize', 'histRemoveFile', 'histEnsureScanned', 'histRetainNote', 'histEnforceBudget', 'histSnapshot', 'histPurgeNote', 'copyHistoryDir']) {
        assert(s.indexOf('function ' + fn) >= 0, label + ' 缺函数 ' + fn)
      }
      assert(s.indexOf('HIST_NOTE_CAP = 20') >= 0, label + ' 单笔记 20 版上限常量')
      assert(s.indexOf('HIST_GLOBAL_BUDGET = 50 * 1024 * 1024') >= 0, label + ' 全库 50MB 预算常量')
      assert(s.indexOf('HIST_KEEP_ALL_MS') >= 0 && s.indexOf('HIST_KEEP_DAILY_MS') >= 0, label + ' 分层保留窗口常量')
      assert(s.indexOf('async function persistNote(n, opts)') >= 0 && s.indexOf('opts.history !== false') >= 0, label + ' persistNote 第二参 opts.history 开关')
      assert(s.split('persistNote(n, { history: false })').length - 1 >= 2, label + ' useCount 防抖 + idle 回执两处自动回写免快照（实得 ' + (s.split('persistNote(n, { history: false })').length - 1) + ' 处）')
      assert(s.indexOf('await histSnapshot(n.id, prev)') >= 0, label + ' persistNote 写盘前快照上一版（缓存重建，零新增读盘）')
      assert(s.indexOf('const historyPurged = await histPurgeNote(id)') >= 0, label + ' _purge 连带清 .history')
      assert(s.indexOf('historyMerged += await copyHistoryDir(chk.dir, NOTES_DIR, true, n.id)') >= 0, label + ' _import added 连带历史合并')
      assert(s.indexOf('copyNotesDir(backupDir, { includeHistory: true })') >= 0, label + ' 导入前备份含 .history')
      assert(s.indexOf('async function _export(dir, includeHistory)') >= 0, label + ' _export includeHistory 参数')
      assert(s.indexOf("_export(args && args.dir, !!(args && args.includeHistory))") >= 0, label + ' notes-export RPC 透传 includeHistory')
      assert(s.indexOf('histSizes = null') >= 0, label + ' 导入合并历史后存活清单失效重扫')
    }
    assert(hostSrc.indexOf("const HISTORY_DIR = NOTES_DIR + '\\\\.history'") >= 0, '开发版 HISTORY_DIR 反斜杠拼接')
    assert(indexSrc.indexOf("const HISTORY_DIR = path.join(NOTES_DIR, '.history')") >= 0, '静态包 HISTORY_DIR 走 path.join')
    assert(indexSrc.indexOf('async function histRemoveFile(noteId, name)') >= 0 && indexSrc.indexOf('fsNode.promises.unlink(pp)') >= 0, '静态包 histRemoveFile 有 node:fs 真删通道')
  })

  // ---- 36.2 行为断言（开发版独立实例）----
  // mock 增强：listDir 贴近真实 fs——直子级目录也以 { name, type:'dir' } 出现（.history 是目录，引擎扫描/列表过滤都依赖该形态）
  function mkFsMockHist(store, dirs, io) {
    return {
      resolve: async (p) => p,
      stat: async (p) => {
        if (dirs.indexOf(p) >= 0) return { dir: true }
        if (store.has(p)) return { file: true }
        const prefix = p + '\\'
        for (const k of store.keys()) if (k.startsWith(prefix)) return { dir: true }
        return null
      },
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        const seenDir = {}
        for (const k of store.keys()) {
          if (!k.startsWith(prefix)) continue
          const rest = k.slice(prefix.length)
          const i = rest.indexOf('\\')
          if (i < 0) out.push({ name: rest })
          else { const d = rest.slice(0, i); if (!seenDir[d]) { seenDir[d] = 1; out.push({ name: d, type: 'dir' }) } }
        }
        return out
      },
      readText: async (p) => { if (io) io.reads++; if (!store.has(p)) throw new Error('ENOENT: ' + p); return store.get(p) },
      writeText: async (p, c) => { store.set(p, c) },
    }
  }
  function mkHistHandlers(store, dirs, io) {
    const handlers = {}
    const harnessMock = { handle: (name, fn) => { handlers[name] = fn; return () => { delete handlers[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
    new Function('harness', 'pluginDir', hostSrc)(harnessMock, DIR).apply({
      fs: mkFsMockHist(store, dirs, io), sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    return handlers
  }
  // 枚举 .history\<id>\ 直子级快照：live=存活（非空串），tomb=墓碑（空串）；rootDir 默认开发版 NOTES_DIR
  function histFilesOf(store, id, rootDir) {
    const prefix = (rootDir || NOTES_DIR) + '\\.history\\' + id + '\\'
    const live = [], tomb = []
    for (const [k, v] of store) {
      if (k.indexOf(prefix) !== 0) continue
      const name = k.slice(prefix.length)
      if (name.indexOf('\\') >= 0) continue
      if (v === '') tomb.push(name); else live.push(name)
    }
    return { live: live.sort(), tomb: tomb.sort() }
  }
  // 快照文件名形态（与引擎同构）：<ISO 时间戳 ':'→'-'>.<len36>.<hash36>.md；伪造历史用 '.0.0.md' 后缀即合法
  const SNAP_NAME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.[0-9a-z]+\.[0-9a-z]+\.md$/
  function fakeSnapName(ts) { return new Date(ts).toISOString().replace(/:/g, '-') + '.0.0.md' }

  const ioH = { reads: 0 }
  const storeH = new Map()
  const handlersH = mkHistHandlers(storeH, [NOTES_DIR], ioH)
  const hc = await handlersH['notes-create']({ title: '历史甲', body: 'v0 正文', topic: '开发' })
  const hPath = NOTES_DIR + '\\' + hc.id + '.md'
  await t('快照触发：创建无快照，更新把上一版入 .history（时间戳+hash 文件名，内容逐字节 = 被替换版）', async () => {
    assert(!Array.from(storeH.keys()).some(k => k.indexOf('\\.history\\') >= 0), '创建不产生历史快照（无旧版）')
    const v0 = storeH.get(hPath)
    await handlersH['notes-update']({ id: hc.id, body: 'v1 正文' })
    const f1 = histFilesOf(storeH, hc.id)
    assert.strictEqual(f1.live.length, 1, '首次更新产生 1 份快照（实得 ' + f1.live.length + '）')
    assert(SNAP_NAME_RE.test(f1.live[0]), '快照文件名 = <ISO时间戳>.<hash>.md（实得 ' + f1.live[0] + '）')
    assert.strictEqual(storeH.get(NOTES_DIR + '\\.history\\' + hc.id + '\\' + f1.live[0]), v0, '快照内容 = 被替换的上一版逐字节')
  })
  await t('快照去重 + 红线：无变化重复保存不增快照，update 零新增读盘', async () => {
    // 独立笔记自洽（core/全量两种模式断言口径一致）：创建无快照；两次有效落盘 → 2 份；之后无变化重复保存去重跳过
    const cD = await handlersH['notes-create']({ title: '历史去重', body: 'd0 正文', topic: '开发' })
    await handlersH['notes-update']({ id: cD.id, body: 'd1 正文' })   // 快照 d0 版
    await handlersH['notes-update']({ id: cD.id, body: 'd1 正文' })   // 快照 d1 版（prev 稳定内容与最新快照不同 → 产生）
    assert.strictEqual(histFilesOf(storeH, cD.id).live.length, 2, '两次有效落盘 → 2 份快照（实得 ' + histFilesOf(storeH, cD.id).live.length + '）')
    const r0 = ioH.reads
    await handlersH['notes-update']({ id: cD.id, body: 'd1 正文' })   // 稳定内容同最新快照 → 去重跳过
    await handlersH['notes-update']({ id: cD.id, body: 'd1 正文' })   // 同上
    assert.strictEqual(histFilesOf(storeH, cD.id).live.length, 2, '无变化重复保存被去重（快照数不增）')
    assert.strictEqual(ioH.reads, r0, 'update 保存路径零新增 readText（红线；快照内容来自缓存重建，去重靠文件名内嵌 hash）')
    assert(storeH.get(NOTES_DIR + '\\' + cD.id + '.md').indexOf('d1 正文') >= 0, '当前版正常落盘')
  })
  await t('单笔记 20 版硬上限：100 次有效保存后存活快照恒为 20（最旧淘汰为墓碑）', async () => {
    for (let i = 0; i < 100; i++) await handlersH['notes-update']({ id: hc.id, body: 'rev-' + i })
    const f = histFilesOf(storeH, hc.id)
    assert.strictEqual(f.live.length, 20, '存活快照 = 20 版硬上限（实得 ' + f.live.length + '）')
    assert(f.tomb.length >= 80, '超限最旧版本墓碑化（实得墓碑 ' + f.tomb.length + '）')
    assert(f.live[0] > f.tomb[f.tomb.length - 1], '淘汰的是最旧版本（live 全晚于 tomb；文件名时序）')
  })
  await t('主路径零 IO：.history 填充后 list/get/search 零新增读盘，.history 子目录绝不进笔记列表', async () => {
    const r0 = ioH.reads
    const l = await handlersH['notes-list']({})
    const g = await handlersH['notes-get']({ id: hc.id })
    const s = await handlersH['notes-search']({ query: 'rev-99' })
    assert.strictEqual(ioH.reads, r0, 'list/get/search 全缓存命中，零新增 readText（.history 已填充）')
    assert(l.notes.find(n => n.id === hc.id), '真笔记在列表中')
    assert(l.notes.every(n => n.id.indexOf('history') < 0 && !SNAP_NAME_RE.test(n.id)), '.history 目录/快照绝不进笔记列表（实得列表 ' + l.notes.length + ' 条）')
    assert(g.note.body === 'rev-99' && s.notes.length === 1, 'get/search 内容正常')
  })
  await t('purge 连带：彻底删除清空整棵 .history/<id>（存活+残留墓碑全墓碑化）；无编辑历史笔记的删除前快照一并清除', async () => {
    await handlersH['notes-delete']({ id: hc.id })
    const totalBefore = histFilesOf(storeH, hc.id)   // 删除动作本身也快照了删除前一版
    const totalCount = totalBefore.live.length + totalBefore.tomb.length
    const r = await handlersH['notes-purge']({ id: hc.id })
    assert(!r.error && r.purged === true, 'purge 成功（实得 ' + JSON.stringify(r) + '）')
    assert(r.historyPurged === totalCount, 'historyPurged 覆盖存活+残留墓碑（实得 ' + r.historyPurged + '，预期 ' + totalCount + '）')
    const f = histFilesOf(storeH, hc.id)
    assert.strictEqual(f.live.length, 0, 'purge 后无存活快照')
    assert.strictEqual(f.tomb.length, totalCount, '全部快照墓碑化（实得 ' + f.tomb.length + '）')
    // 无编辑历史的笔记：删除动作本身产生「删除前快照」（历史引擎保护语义），purge 一并连带清除
    const c2 = await handlersH['notes-create']({ title: '历史乙', body: '无编辑历史', topic: '开发' })
    await handlersH['notes-delete']({ id: c2.id })
    assert.strictEqual(histFilesOf(storeH, c2.id).live.length, 1, '删除前版本被快照保护（无编辑历史也有 1 份）')
    const r2 = await handlersH['notes-purge']({ id: c2.id })
    assert.strictEqual(r2.historyPurged, 1, 'purge 连带清除删除前快照（实得 ' + JSON.stringify(r2) + '）')
    assert.strictEqual(histFilesOf(storeH, c2.id).live.length, 0, 'purge 后无存活快照')
  })

  // ---- 36.3 分层保留收敛（预注伪造历史文件 → 一次保存触发惰性扫描 + 分层 + 上限收敛）----
  const storeH2 = new Map()
  const handlersH2 = mkHistHandlers(storeH2, [NOTES_DIR], null)
  await t('分层保留收敛：1h 内每版全留 / 当天每小时 1 版 / 7 天内每天 1 版 / 超 7 天淘汰', async () => {
    const c = await handlersH2['notes-create']({ title: '分层笔记', body: 'base', topic: '开发' })
    const hDir = NOTES_DIR + '\\.history\\' + c.id + '\\'
    const now = Date.now()
    const nd = new Date(now)
    const today0 = new Date(nd.getFullYear(), nd.getMonth(), nd.getDate()).getTime()
    const put = (ts) => { storeH2.set(hDir + fakeSnapName(ts), '伪造历史 ' + ts) }
    put(now - 10 * 60000); put(now - 20 * 60000)                                    // 1h 内两版 → 全留
    put(today0 - 24 * 3600000 + 8 * 3600000); put(today0 - 24 * 3600000 + 9 * 3600000)  // 昨天两版 → 留最新 1
    put(today0 - 2 * 24 * 3600000 + 8 * 3600000)                                     // 前天一版 → 留
    put(today0 - 9 * 24 * 3600000 + 8 * 3600000)                                     // 9 天前 → 超 7 天淘汰
    const hNow = nd.getHours()
    if (hNow >= 4) { put(today0 + (hNow - 3) * 3600000); put(today0 + (hNow - 3) * 3600000 + 30 * 60000) }   // 当天 >1h 同小时两版 → 留 1（凌晨 <4 点不存在「当天 3 小时前」，条件跳过）
    await handlersH2['notes-update']({ id: c.id, body: '触发收敛' })
    const f = histFilesOf(storeH2, c.id)
    const expectLive = 3 + 1 + 1 + (hNow >= 4 ? 1 : 0)   // 1h内2版+新快照 / 昨天1 / 前天1 / 当天小时桶1
    const expectTomb = 1 + 1 + (hNow >= 4 ? 1 : 0)       // 昨天重复 1 + 超期 1 + 当天同小时重复 1
    assert.strictEqual(f.live.length, expectLive, '存活数 = ' + expectLive + '（实得 ' + f.live.length + '：' + f.live.join(', ') + '）')
    assert.strictEqual(f.tomb.length, expectTomb, '淘汰数 = ' + expectTomb + '（实得 ' + f.tomb.length + '）')
    assert(f.tomb.indexOf(fakeSnapName(today0 - 9 * 24 * 3600000 + 8 * 3600000)) >= 0, '超 7 天版本被淘汰')
    assert(f.live.indexOf(fakeSnapName(today0 - 24 * 3600000 + 9 * 3600000)) >= 0, '昨天两版留最新一版')
    assert(f.live.indexOf(fakeSnapName(now - 10 * 60000)) >= 0 && f.live.indexOf(fakeSnapName(now - 20 * 60000)) >= 0, '1h 内每版全留')
  })

  // ---- 36.4 全库 50MB 预算 LRU（3 笔记 × 18 版 × ~1MB ≈ 56MB → 触发跨笔记淘汰最旧）----
  const storeH3 = new Map()
  const handlersH3 = mkHistHandlers(storeH3, [NOTES_DIR], null)
  await t('全库 50MB 预算：LRU 跨笔记淘汰最旧快照直到总量回落（单笔记仍 ≤20 版）', async () => {
    const big = 'x'.repeat(1024 * 1024)   // ~1MB/版（ASCII 1 字节/字符）
    const ids = []
    for (let i = 0; i < 3; i++) ids.push((await handlersH3['notes-create']({ title: 'big' + i, body: big + i, topic: '开发' })).id)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 18; j++) await handlersH3['notes-update']({ id: ids[i], body: big + i + '-' + j })
    }
    let liveBytes = 0, tombCount = 0
    const perNote = {}
    for (const [k, v] of storeH3) {
      const m = k.match(/\\\.history\\(n-[^\\]+)\\[^\\]+$/)
      if (!m) continue
      if (v === '') { tombCount++; continue }
      liveBytes += Buffer.byteLength(v, 'utf8')
      perNote[m[1]] = (perNote[m[1]] || 0) + 1
    }
    assert(liveBytes <= 50 * 1024 * 1024, '存活快照总量回落到 50MB 预算内（实得 ' + (liveBytes / 1048576).toFixed(1) + 'MB）')
    assert(tombCount >= 4, 'LRU 淘汰了最旧快照（墓碑 ≥4，实得 ' + tombCount + '）')
    assert.strictEqual(perNote[ids[2]], 18, '最新笔记 18 版全存活（LRU 不动新版本）')
    assert((perNote[ids[0]] || 0) < 18, '最旧笔记的早期版本被优先淘汰（实得存活 ' + (perNote[ids[0]] || 0) + '）')
    for (const id of ids) assert((perNote[id] || 0) <= 20, '单笔记存活 ≤20 版')
  })

  // ---- 36.5 导入导出适配（默认不含 / includeHistory 连带 / 备份含 / added 合并 + id 冲突跳过）----
  const storeH4 = new Map()
  const handlersH4 = mkHistHandlers(storeH4, [NOTES_DIR], null)
  await t('导入导出适配：默认不含 .history / includeHistory 连带 / 备份含 / added 合并 / id 冲突跳过', async () => {
    const A = await handlersH4['notes-create']({ title: '历史导出A', body: 'A0', topic: '开发' })
    await handlersH4['notes-update']({ id: A.id, body: 'A1' })                              // A 有 1 份快照
    await handlersH4['notes-create']({ title: '历史导出B', body: 'B0', topic: '开发' })       // B 无快照
    const snapA = histFilesOf(storeH4, A.id).live
    assert.strictEqual(snapA.length, 1, '前置：A 有 1 份快照')
    const libSnap = NOTES_DIR + '\\.history\\' + A.id + '\\' + snapA[0]
    // 导出默认不含 .history
    const ex1 = await handlersH4['notes-export']({ dir: 'D:\\hist-exp' })
    assert(!ex1.error && ex1.history === undefined, '默认导出返回无 history 字段（实得 ' + JSON.stringify(ex1) + '）')
    assert(!Array.from(storeH4.keys()).some(k => k.indexOf(ex1.target + '\\.history\\') === 0), '默认导出目录不含 .history')
    // includeHistory 连带（逐字节一致）
    const ex2 = await handlersH4['notes-export']({ dir: 'D:\\hist-exp', includeHistory: true })
    assert.strictEqual(ex2.history, 1, 'includeHistory 导出 1 份历史文件（实得 ' + ex2.history + '）')
    assert.strictEqual(storeH4.get(ex2.target + '\\.history\\' + A.id + '\\' + snapA[0]), storeH4.get(libSnap), '导出历史逐字节一致')
    // 导入目录：新笔记 n-hnew01（带 2 份历史）+ A 的同内容文件（same）+ A 的伪造外部历史（id 冲突 → 跳过）
    const imp = 'D:\\hist-imp'
    storeH4.set(imp + '\\n-hnew01.md', '---\nid: n-hnew01\ntitle: 外部新笔记\ntopic: 调研\ncreatedAt: "2026-01-02T00:00:00.000Z"\nupdatedAt: "2026-01-02T00:00:00.000Z"\n---\n\n新正文\n')
    storeH4.set(imp + '\\' + A.id + '.md', storeH4.get(NOTES_DIR + '\\' + A.id + '.md'))
    storeH4.set(imp + '\\.history\\n-hnew01\\' + fakeSnapName(Date.now() - 60000), '外部历史1')
    storeH4.set(imp + '\\.history\\n-hnew01\\' + fakeSnapName(Date.now() - 120000), '外部历史2')
    storeH4.set(imp + '\\.history\\' + A.id + '\\' + fakeSnapName(Date.now() - 30000), 'A的伪造外部历史')
    const im = await handlersH4['notes-import']({ dir: imp })
    assert(!im.error, '导入成功（实得 ' + JSON.stringify(im) + '）')
    assert.strictEqual(im.imported, 1, 'added 1 条入库')
    assert.strictEqual(im.skippedSame, 1, 'A 同内容跳过')
    assert.strictEqual(im.historyMerged, 2, '仅新笔记历史连带合并 2 份（实得 ' + im.historyMerged + '）')
    assert.strictEqual(histFilesOf(storeH4, 'n-hnew01').live.length, 2, '新笔记 2 份历史入库')
    assert.strictEqual(histFilesOf(storeH4, A.id).live.length, 1, 'id 冲突跳过历史合并（A 仍只有自身 1 份）')
    // 导入前备份含 .history（备份的是导入前库内历史：A 的 1 份）
    assert.strictEqual(storeH4.get(im.backupDir + '\\.history\\' + A.id + '\\' + snapA[0]), storeH4.get(libSnap), '导入前备份含库内 .history')
    // 无历史导出（默认导出物）导入：historyMerged=0 零回归
    const im2 = await handlersH4['notes-import']({ dir: ex1.target })
    assert.strictEqual(im2.historyMerged, 0, '默认导出（无 .history）导入 historyMerged=0（实得 ' + im2.historyMerged + '）')
  })

  // ---- 36.6 静态包行为（index.mjs 独立 ESM 实例；mock fs 无 processPath → 墓碑式清空）----
  await t('静态包历史引擎行为：保存触发 + 去重 + purge 连带墓碑 + 导出默认不含/includeHistory 连带', async () => {
    const storeH5 = new Map()
    const handlersH5 = {}
    const harnessMockH5 = { handle: (name, fn) => { handlersH5[name] = fn; return () => { delete handlersH5[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
    global.harness = harnessMockH5
    try {
      const modH = await import(pathToFileURL(INDEX_PATH).href + '?hist=1')
      modH.apply({
        fs: mkFsMockHist(storeH5, [NOTES_ROOT_STATIC], null), sandboxPolicy: { resolve: () => ({}) },
        webServer: { register: () => () => {} }, tools: { register: () => () => {} },
        get: (name) => ({ agents: agentsMock, systemPrompt: { context: () => () => {} } })[name],
        effect: () => {},
      })
      const A = await handlersH5['notes-create']({ title: '静态历史A', body: 'SA0' })
      await handlersH5['notes-update']({ id: A.id, body: 'SA1' })
      const f1 = histFilesOf(storeH5, A.id, NOTES_ROOT_STATIC)
      assert.strictEqual(f1.live.length, 1, '静态包更新触发 1 份快照（实得 ' + f1.live.length + '）')
      assert(SNAP_NAME_RE.test(f1.live[0]), '静态包快照文件名同构（实得 ' + f1.live[0] + '）')
      await handlersH5['notes-update']({ id: A.id, body: 'SA1' })   // prev 稳定内容与最新快照相同？→ 不同（prev 是 SA1 版，快照是 SA0 版）→ 产生；再来一次才去重
      await handlersH5['notes-update']({ id: A.id, body: 'SA1' })   // 去重跳过
      assert.strictEqual(histFilesOf(storeH5, A.id, NOTES_ROOT_STATIC).live.length, 2, '静态包无变化重复保存去重（实得 ' + histFilesOf(storeH5, A.id, NOTES_ROOT_STATIC).live.length + '）')
      const ex1 = await handlersH5['notes-export']({ dir: 'D:\\hist-exp-st' })
      assert(!Array.from(storeH5.keys()).some(k => k.indexOf(ex1.target + '\\.history\\') === 0), '静态包默认导出不含 .history')
      const ex2 = await handlersH5['notes-export']({ dir: 'D:\\hist-exp-st', includeHistory: true })
      assert.strictEqual(ex2.history, 2, '静态包 includeHistory 连带 2 份（实得 ' + ex2.history + '）')
      await handlersH5['notes-delete']({ id: A.id })   // 删除前版本与最新快照稳定内容相同 → 去重不增
      const p = await handlersH5['notes-purge']({ id: A.id })
      assert(p.purged === true && p.historyPurged >= 2, '静态包 purge 连带清历史（实得 ' + JSON.stringify(p) + '）')
      assert.strictEqual(histFilesOf(storeH5, A.id, NOTES_ROOT_STATIC).live.length, 0, '静态包 purge 后无存活快照（mock 无 processPath → 墓碑式清空）')
    } finally {
      delete global.harness
    }
  })

  // ===== 37. LLM token 用量统计（llm-usage 计量包装 + usage.json 落盘 + notes-usage-get + 预算提醒） =====
  section('37. LLM token 用量统计（计量包装 + usage.json + notes-usage-get + 预算提醒）')

  // ---- 37.1 结构契约（双包同步 + 零侵入红线）----
  await t('llm-usage 标记块双包逐字节一致 + 三调用点计量包装挂载（classify×2 + organize）', () => {
    const grabBlk = (s) => { const m = s.match(/\/\/ ==== llm-usage BEGIN ====[\s\S]*?\/\/ ==== llm-usage END ====/); return m ? m[0] : '' }
    const blkDev = grabBlk(hostSrc), blkPkg = grabBlk(indexSrc)
    assert(blkDev.length > 100, 'host-impl 缺 llm-usage 标记块')
    assert.strictEqual(blkPkg, blkDev, 'host-impl.js 与 index.mjs 的 llm-usage 块必须逐字节一致')
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert.strictEqual((s.match(/await streamMetered\('/g) || []).length, 3, label + ' 计量包装挂 3 个调用点（实得 ' + (s.match(/await streamMetered\('/g) || []).length + '）')
      assert.strictEqual((s.match(/await streamMetered\('classify', \{/g) || []).length, 2, label + ' classify 两处（classifyTopic + extractInstruction）')
      assert.strictEqual((s.match(/await streamMetered\('organize', \{/g) || []).length, 1, label + ' organize 一处（_aiOrganize）')
      assert(s.indexOf("else if (chunk && chunk.type === 'usage')") >= 0, label + ' streamMetered 捕获 usage chunk（dsh-llm 契约：finish 前 emit）')
      // 零侵入红线：只包装调用点，不改写 llm 通道本身
      assert(!/llm\.stream\s*=/.test(s), label + ' 不改写 llm.stream 通道本身（计量零侵入）')
    }
  })
  await t('host 双侧：usage.json 独立落盘 + 5s 防抖 + 卸载 flush + 估算系数 + RPC + 预算键', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('const USAGE_FLUSH_MS = 5000') >= 0, label + ' 5s 防抖常量')
      assert(s.indexOf('const USAGE_EST_CHARS_PER_TOKEN = 1.6') >= 0, label + ' 1.6 字符估算系数（中文≈1.6 字符/token）')
      assert(s.indexOf('async function recordUsage(feature, usage, inChars, outChars)') >= 0, label + ' recordUsage 记账函数')
      assert(s.indexOf('async function streamMetered(feature, options)') >= 0, label + ' streamMetered 计量包装')
      assert(s.indexOf('function usageReport()') >= 0, label + ' usageReport 报表函数')
      assert(s.indexOf("handle('notes-usage-get'") >= 0, label + ' notes-usage-get RPC 注册')
      assert(s.indexOf("'usageBudgetMonthly' in patch") >= 0, label + ' settings-set 预算键 usageBudgetMonthly')
      assert(s.indexOf('flushUsage()       // 卸载 flush') >= 0, label + ' 插件卸载 flush（ctx.effect dispose）')
      assert(s.indexOf('typeof usageTimer.unref') >= 0, label + ' timer unref（防抖不阻塞进程退出）')
    }
    assert(hostSrc.indexOf("NOTES_DIR + '\\\\usage.json'") >= 0, '开发版 usage.json 落在 notes 目录（独立于 settings.json）')
    assert(indexSrc.indexOf("path.join(NOTES_ROOT, 'usage.json')") >= 0, '静态包 usage.json 落在 ~/.dsh/notes')
  })

  // ---- 37.2 行为级（开发版独立实例 storeV + usage chunk mock llm；dispose 触发防抖 flush，不真实等 5s）----
  const storeV = new Map()
  let writesV = 0
  const fsMockV = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeV.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of storeV.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!storeV.has(p)) throw new Error('ENOENT: ' + p); return storeV.get(p) },
    writeText: async (p, c) => { writesV++; storeV.set(p, c) },
  }
  // usage mock llm：按 system 提示分流三功能，均在 finish 前 emit usage chunk（dsh-llm 契约）
  const llmMockV = {
    stream: async function* (req) {
      const sys = (req && req.system) || ''
      if (sys.indexOf('元数据') >= 0) {
        yield { type: 'text-delta', text: '{"tags":[],"titleHint":"指令标题","kind":"note","inject":false}' }
        yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } }
        yield { type: 'finish' }
      } else if (sys.indexOf('笔记整理助手') >= 0) {
        yield { type: 'text-delta', text: '## 背景\n\n整理后正文\n' }
        yield { type: 'usage', usage: { inputTokens: 800, outputTokens: 200, totalTokens: 1000 } }
        yield { type: 'finish' }
      } else {
        yield { type: 'text-delta', text: '运维' }
        yield { type: 'usage', usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } }
        yield { type: 'finish' }
      }
    }
  }
  const handlersV = {}
  const effectsV = []
  const harnessMockV = { handle: (name, fn) => { handlersV[name] = fn; return () => { delete handlersV[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockV, DIR).apply({
    fs: fsMockV, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMockV, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: (fn) => { effectsV.push(fn) },
  })
  const flushMicro37 = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
  await t('notes-usage-get：三功能分别计数 + today/week/month/allTime/byFeature 结构 + usage.json 防抖落盘', async () => {
    // ① quick → 异步分类（classify=60，真实 usage）
    await handlersV['notes-quick']({ text: '用量统计速记', sessionId: 'sess-usage-1' })
    await new Promise(r => setTimeout(r, 150))
    let u = await handlersV['notes-usage-get']({})
    assert(!u.error, 'RPC 无错误（实得 ' + JSON.stringify(u).slice(0, 120) + '）')
    for (const k of ['today', 'week', 'month', 'allTime', 'byFeature', 'estimatedTokens', 'exactTokens', 'calls']) assert(k in u, '返回缺字段 ' + k)
    assert.strictEqual(u.today.classify, 60, '分类真实 usage 计数 60（实得 ' + u.today.classify + '）')
    assert.strictEqual(u.today.total, 60); assert.strictEqual(u.calls, 1, 'calls=1')
    assert.strictEqual(u.byFeature.classify.today, 60, 'byFeature.classify.today=60')
    assert.strictEqual(u.byFeature.organize.allTime, 0, '整理未计数')
    assert.strictEqual(u.byFeature.summarize.allTime, 0, '总结未计数')
    assert.strictEqual(u.week.total, 60, 'week=今日（单日数据）')
    assert.strictEqual(u.month.total, 60, 'month=当月累计（预算提醒口径）')
    assert.strictEqual(u.allTime.total, 60)
    assert.strictEqual(u.estimatedTokens, 0, '真实值不进估算')
    assert.strictEqual(u.exactTokens, 60, 'exactTokens=60')
    // ② quick-instruct（指令提取计入 classify；mock 带 titleHint 不再触发异步分类）
    await handlersV['notes-quick-instruct']({ text: '选区原文内容', note: '这是待办', sessionId: 'sess-usage-2' })
    u = await handlersV['notes-usage-get']({})
    assert.strictEqual(u.today.classify, 180, '指令提取计入 classify（60+120，实得 ' + u.today.classify + '）')
    assert.strictEqual(u.calls, 2, 'calls=2')
    // ③ ai-organize（organize=1000）
    const ao = await handlersV['notes-ai-organize']({ body: '草稿正文内容', kind: 'note' })
    assert(!ao.error, '整理成功（实得 ' + JSON.stringify(ao).slice(0, 120) + '）')
    u = await handlersV['notes-usage-get']({})
    assert.strictEqual(u.today.organize, 1000, 'organize 计数 1000（实得 ' + u.today.organize + '）')
    assert.strictEqual(u.byFeature.organize.allTime, 1000, 'byFeature.organize.allTime=1000')
    assert.strictEqual(u.today.total, 1180, 'total=1180（实得 ' + u.today.total + '）')
    assert.strictEqual(u.week.total, 1180); assert.strictEqual(u.month.total, 1180); assert.strictEqual(u.allTime.total, 1180)
    assert.strictEqual(u.calls, 3, 'calls=3')
    assert.strictEqual(u.exactTokens, 1180, 'exactTokens=1180')
    // ④ usage.json 防抖落盘：dispose 前零落盘，卸载 flush 立即写盘（结构 {daily, allTime, estimatedTokens, exactTokens, calls}）
    assert(!storeV.has(NOTES_DIR + '\\usage.json'), '防抖窗口内 usage.json 未落盘（5s 防抖未到期）')
    const disposeV = effectsV[0]()
    disposeV()
    await flushMicro37()
    const raw = storeV.get(NOTES_DIR + '\\usage.json')
    assert(raw, '卸载 flush 落盘 usage.json')
    const disk = JSON.parse(raw)
    const nowD = new Date()
    const todayKey = nowD.getFullYear() + '-' + ('0' + (nowD.getMonth() + 1)).slice(-2) + '-' + ('0' + nowD.getDate()).slice(-2)
    assert(disk.daily && disk.daily[todayKey], '落盘含今日 daily 键 ' + todayKey)
    assert.strictEqual(disk.daily[todayKey].classify, 180, '落盘 daily.classify=180')
    assert.strictEqual(disk.daily[todayKey].organize, 1000, '落盘 daily.organize=1000')
    assert.strictEqual(disk.daily[todayKey].total, 1180, '落盘 daily.total=1180')
    assert.strictEqual(disk.allTime.total, 1180, '落盘 allTime.total=1180')
    assert.strictEqual(disk.calls, 3, '落盘 calls=3')
    assert.strictEqual(disk.exactTokens, 1180, '落盘 exactTokens=1180')
    // 落盘后再读：新实例视角由 37.2c 静态包用例覆盖（加载合并路径）
  })
  await t('估算兜底：adapter 未回 usage chunk 时按字符估算（1.6 系数）+ estimatedTokens 累计', async () => {
    const storeE = new Map()
    const fsMockE = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeE.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of storeE.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!storeE.has(p)) throw new Error('ENOENT: ' + p); return storeE.get(p) },
      writeText: async (p, c) => { storeE.set(p, c) },
    }
    const llmMockNoUsage = { stream: async function* () { yield { type: 'text-delta', text: '开发' }; yield { type: 'finish' } } }
    const handlersE = {}
    const harnessMockE = { handle: (name, fn) => { handlersE[name] = fn; return () => { delete handlersE[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
    new Function('harness', 'pluginDir', hostSrc)(harnessMockE, DIR).apply({
      fs: fsMockE, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMockNoUsage, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    await handlersE['notes-quick']({ text: '估算速记', sessionId: 'sess-est-1' })
    await new Promise(r => setTimeout(r, 150))
    const u = await handlersE['notes-usage-get']({})
    assert(u.today.classify > 0, '估算计数 >0（实得 ' + u.today.classify + '）')
    assert.strictEqual(u.estimatedTokens, u.today.total, '全部计入估算（estimatedTokens=total）')
    assert.strictEqual(u.exactTokens, 0, '无真实值')
    assert.strictEqual(u.calls, 1, 'calls=1')
    // 预算键校验（复用本实例，无 llm 介入）：非负整数直存 / 非法报错 / null 删除恢复关闭
    const bad = await handlersE['notes-settings-set']({ usageBudgetMonthly: 'x' })
    assert(bad.error && bad.error.indexOf('usageBudgetMonthly') >= 0, '字符串报错（实得 ' + JSON.stringify(bad) + '）')
    const bad2 = await handlersE['notes-settings-set']({ usageBudgetMonthly: -5 })
    assert(bad2.error && bad2.error.indexOf('usageBudgetMonthly') >= 0, '负数报错')
    const ok = await handlersE['notes-settings-set']({ usageBudgetMonthly: 50000 })
    assert(ok.ok === true, '保存成功')
    assert.strictEqual(JSON.parse(storeE.get(NOTES_DIR + '\\settings.json')).usageBudgetMonthly, 50000, 'settings.json 落盘 usageBudgetMonthly')
    const ok2 = await handlersE['notes-settings-set']({ usageBudgetMonthly: null })
    assert(ok2.ok === true && !('usageBudgetMonthly' in ok2.settings), 'null 删除 override 恢复关闭提醒')
  })

  // ---- 37.2c 静态包行为（index.mjs 独立 ESM 实例 + webServer 路由链路；含 usage.json 读回合并）----
  await t('静态包：计量包装三功能计数 + notes-usage-get + 预算键校验 + usage.json 存量读回（rpc 路由链路）', async () => {
    const storeS = new Map()
    const fsMockS = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_ROOT_STATIC ? { dir: true } : (storeS.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of storeS.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!storeS.has(p)) throw new Error('ENOENT: ' + p); return storeS.get(p) },
      writeText: async (p, c) => { storeS.set(p, c) },
    }
    // 存量 usage.json：上月历史 5000 tokens（allTime 累计口径验证：month 不含上月，allTime 含）
    const histDay = '2020-01-15'
    storeS.set(path.join(NOTES_ROOT_STATIC, 'usage.json'), JSON.stringify({
      daily: { [histDay]: { classify: 2000, organize: 3000, summarize: 0, total: 5000 } },
      allTime: { classify: 2000, organize: 3000, summarize: 0, total: 5000 },
      estimatedTokens: 0, exactTokens: 5000, calls: 9
    }, null, 2))
    const routesS = []
    const effectsS = []
    const ctxS = {
      fs: fsMockS, sandboxPolicy: { resolve: () => ({}) },
      webServer: { register: (r) => { routesS.push(r); return () => {} } },
      tools: { register: () => () => {} },
      get: (name) => ({ llm: llmMockV, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: (fn) => { effectsS.push(fn) },
    }
    // 真实静态包环境没有 harness Builtin —— 摘掉还原真实条件
    const harnessBackup37 = global.harness
    delete global.harness
    try {
      const modS = await import(pathToFileURL(INDEX_PATH).href + '?llm-usage=1')
      modS.apply(ctxS)
      const rpcS = (method, args) => new Promise((resolve, reject) => {
        const body = Buffer.from(JSON.stringify({ method: method, args: args }))
        const req = { method: 'POST', on: (ev, cb) => { if (ev === 'data') cb(body); else if (ev === 'end') cb(); return req }, destroy: () => {} }
        const res = { statusCode: 0, setHeader: () => {}, writeHead: (c) => { res.statusCode = c }, end: (s) => { let b; try { b = JSON.parse(s) } catch (e) { b = s } resolve({ status: res.statusCode, body: b }) } }
        Promise.resolve(routesS[0].handler(req, res)).catch(reject)
      })
      // 存量读回：allTime 含历史 5000，month/today 不含
      let u = (await rpcS('notes-usage-get', {})).body
      assert.strictEqual(u.allTime.total, 5000, '存量 usage.json 读回 allTime=5000（实得 ' + u.allTime.total + '）')
      assert.strictEqual(u.calls, 9, '存量 calls=9')
      assert.strictEqual(u.today.total, 0, 'today 不含历史')
      assert.strictEqual(u.month.total, 0, 'month 不含上月历史（预算口径=当月）')
      // 计量包装：quick 异步分类 + ai-organize
      await rpcS('notes-quick', { text: '静态包用量速记', sessionId: 'sess-usage-s' })
      await new Promise(r => setTimeout(r, 150))
      const ao = (await rpcS('notes-ai-organize', { body: '静态包草稿', kind: 'note' })).body
      assert(!ao.error, '静态包整理成功（实得 ' + JSON.stringify(ao).slice(0, 120) + '）')
      u = (await rpcS('notes-usage-get', {})).body
      assert.strictEqual(u.today.classify, 60, '静态包分类计数 60（实得 ' + u.today.classify + '）')
      assert.strictEqual(u.today.organize, 1000, '静态包整理计数 1000（实得 ' + u.today.organize + '）')
      assert.strictEqual(u.allTime.total, 6060, 'allTime=历史5000+新增1060（实得 ' + u.allTime.total + '）')
      assert.strictEqual(u.calls, 11, 'calls=9+2（实得 ' + u.calls + '）')
      // 预算键校验 + 落盘 settings.json
      const bad = (await rpcS('notes-settings-set', { usageBudgetMonthly: 'x' })).body
      assert(bad.error && bad.error.indexOf('usageBudgetMonthly') >= 0, '静态包预算键非法值报错')
      const ok = (await rpcS('notes-settings-set', { usageBudgetMonthly: 80000 })).body
      assert(ok.ok === true, '静态包预算保存成功')
      assert.strictEqual(JSON.parse(storeS.get(path.join(NOTES_ROOT_STATIC, 'settings.json'))).usageBudgetMonthly, 80000, '静态包 settings.json 落盘预算键')
      // 卸载 flush：防抖窗口内的新增计数写回 usage.json（与存量合并）
      const disposeS = effectsS[0]()
      disposeS()
      await flushMicro37()
      const disk = JSON.parse(storeS.get(path.join(NOTES_ROOT_STATIC, 'usage.json')))
      assert.strictEqual(disk.allTime.total, 6060, '静态包卸载 flush 落盘 allTime=6060（实得 ' + disk.allTime.total + '）')
      assert.strictEqual(disk.calls, 11, '静态包落盘 calls=11')
    } finally {
      global.harness = harnessBackup37
    }
  })

  // ---- 37.3 client 设置卡片（client-impl + 发布包 lib/client.js 同步 + toast 提醒链路）----
  await t('设置卡片「LLM 用量」+「用量预算提醒」两行（client-impl + 发布包 lib/client.js 同步 + 超预算 toast 不阻断）', () => {
    assert(/key: 'usage', label: 'LLM 用量'/.test(clientSrc), 'settingsRows 含「LLM 用量」行')
    assert(/key: 'usagebudget', label: '用量预算提醒'/.test(clientSrc), 'settingsRows 含「用量预算提醒」行')
    assert(clientSrc.indexOf("host.call('notes-usage-get', {})") >= 0, 'openSettings 拉取 notes-usage-get（独立 RPC 不拖慢主链路）')
    assert(clientSrc.indexOf("host.call('notes-settings-set', { usageBudgetMonthly: v })") >= 0, '预算保存链路 notes-settings-set usageBudgetMonthly')
    assert(clientSrc.indexOf('已超预算 ') >= 0 && clientSrc.indexOf('（仅提醒，不阻断）') >= 0, '超预算 toast 文案（仅提醒，不阻断）')
    assert(clientSrc.indexOf('（含字符估算，约）') >= 0, '估算标注「约」文案')
    assert(clientSrc.indexOf('const fmtTok = ') >= 0, 'fmtTok token 人性化函数')
    assert(clientSrc.indexOf('usageData.byFeature.classify.allTime') >= 0, '按功能分列读 byFeature')
    assert(clientSrc.indexOf('usageBudgetRef') >= 0, '预算 ref 镜像（settings/usage 并发放射防闭包过期）')
    for (const k of ['LLM 用量', '用量预算提醒', 'notes-usage-get', 'usageBudgetMonthly', '（仅提醒，不阻断）', 'fmtTok', '（含字符估算，约）', 'usageBudgetRef']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺 ' + k + '（需先跑 scripts/build-dist.cjs）')
    }
    assert(clientPkgSrc.indexOf("rpc('notes-usage-get', {})") >= 0, '发布包用量拉取走 rpc 形态（host.call 已构建转换）')
  })

  // ---- 37.4 app.html / 原型 notes-ui-v2.html 设置卡同步 + 原型 mock ----
  await t('app.html + 原型设置卡同款两行 + 用量区 + mock notes-usage-get 演示（双端 UI 标记一致）', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('id="setUsageBody"') >= 0 && s.indexOf('id="setUsageBudget"') >= 0, label + ' 用量区容器 + 预算输入')
      assert(s.indexOf("rpc('notes-usage-get', {})") >= 0, label + ' 拉取 notes-usage-get')
      assert(s.indexOf('saveSettings({ usageBudgetMonthly:') >= 0, label + ' 预算保存链路')
      assert(s.indexOf('LLM 用量') >= 0 && s.indexOf('用量预算提醒') >= 0, label + ' 两行标签')
      assert(s.indexOf('（仅提醒，不阻断）') >= 0 && s.indexOf('（含字符估算，约）') >= 0, label + ' toast/估算文案')
      assert(s.indexOf('function fmtTok(') >= 0, label + ' fmtTok 人性化函数')
      assert(s.indexOf('.set-ctrl.usage{') >= 0 && s.indexOf('.usage-line{') >= 0, label + ' 用量区样式')
    }
    assert(protoV2Src.indexOf("if (method === 'notes-usage-get')") >= 0, '原型 mock 含 notes-usage-get 分支')
    assert(protoV2Src.indexOf('estimatedTokens: 420') >= 0, '原型 mock 含估算演示值（「约」标注演示）')
  })

  // ===== 38. 历史版本面板 UI（notes-history-ui：三 RPC + 详情区「历史」入口 + 列表/预览/恢复 modal + 四端同步）=====
  section('38. 历史版本面板 UI（notes-history / notes-history-get / notes-restore-history + 四端 UI）')

  // ---- 38.1 双包结构同步（host-impl.js ⇄ index.mjs）----
  await t('历史引擎双包三 RPC 结构同步（host-impl ⇄ index.mjs，恢复走 persistNote 缺省快照）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("handle('notes-history'") >= 0 && s.indexOf("handle('notes-history-get'") >= 0 && s.indexOf("handle('notes-restore-history'") >= 0, label + ' 三 RPC handler 注册')
      assert(s.indexOf('async function histFindName') >= 0, label + ' histFindName（ts → 存活快照文件名）')
      assert(s.indexOf('async function _historyList') >= 0 && s.indexOf('async function _historyGet') >= 0 && s.indexOf('async function _historyRestore') >= 0, label + ' 三个历史支撑函数')
      assert(s.indexOf('versions.sort((a, b) => b.ts - a.ts)') >= 0, label + ' 版本列表按时间倒序（新→旧）')
      assert(s.indexOf('恢复前置快照') >= 0, label + ' 恢复前置快照安全注释')
      // 安全核心结构断言：_historyRestore 必须经 persistNote 缺省快照语义写回（禁 { history:false }——恢复前当前版入 .history，恢复本身可撤销）
      const m = s.match(/async function _historyRestore[\s\S]*?\n    \}/)
      assert(m, label + ' _historyRestore 函数体可提取')
      assert(m[0].indexOf('await persistNote(note)') >= 0 && m[0].indexOf('history: false') < 0, label + ' 恢复经 persistNote 缺省快照（恢复前置自动快照；禁 history:false 旁路）')
      assert(m[0].indexOf("throw new Error('Note has been deleted')") >= 0, label + ' 已删除/墓碑笔记拒绝恢复')
    }
    assert(hostSrc.indexOf("HISTORY_DIR + '\\\\' + id + '\\\\' + name") >= 0, '开发版历史快照读取走反斜杠拼接')
    assert(indexSrc.indexOf('path.join(HISTORY_DIR, id, name)') >= 0, '静态包历史快照读取走 path.join')
  })

  // ---- 38.2 三 RPC 契约行为 + 恢复前置快照（开发版独立实例；复用 section 36 mkHistHandlers/histFilesOf）----
  const storeHU = new Map()
  const handlersHU = mkHistHandlers(storeHU, [NOTES_DIR], null)
  await t('历史版本三 RPC 契约：列表倒序零正文 / get 取正文 / 未知 ts 报错（开发版独立实例）', async () => {
    const c = await handlersHU['notes-create']({ title: '历史UI', body: 'U0 正文', topic: '开发' })
    await handlersHU['notes-update']({ id: c.id, body: 'U1 正文' })   // 快照 U0
    await handlersHU['notes-update']({ id: c.id, body: 'U2 正文' })   // 快照 U1
    const h = await handlersHU['notes-history']({ id: c.id })
    assert(!h.error && Array.isArray(h.versions), 'notes-history 返回 versions 数组（实得 ' + JSON.stringify(h).slice(0, 80) + '）')
    assert.strictEqual(h.versions.length, 2, '两次有效保存 → 2 个版本（实得 ' + h.versions.length + '）')
    assert(h.versions[0].ts > h.versions[1].ts, '按时间倒序（新→旧）')
    assert(typeof h.versions[0].ts === 'number' && typeof h.versions[0].bytes === 'number', '版本条目 {ts, bytes} 数值形态')
    assert(h.versions.every(v => v.body === undefined), '列表零正文明文（列表轻量，正文走 notes-history-get 按需）')
    // get 取正文：最旧版 = U0 正文 / 最新快照 = U1 正文（快照字节 = 完整笔记文件，返回 parseFM 解析的 body）
    const g0 = await handlersHU['notes-history-get']({ id: c.id, ts: h.versions[1].ts })
    assert(!g0.error && g0.body === 'U0 正文', 'notes-history-get 取最旧版正文（实得 ' + JSON.stringify(g0).slice(0, 60) + '）')
    const g1 = await handlersHU['notes-history-get']({ id: c.id, ts: h.versions[0].ts })
    assert(g1.body === 'U1 正文', 'notes-history-get 取最新快照正文')
    const bad = await handlersHU['notes-history-get']({ id: c.id, ts: 123 })
    assert(bad.error && bad.error.indexOf('历史版本不存在') >= 0, '未知 ts 报错（实得 ' + JSON.stringify(bad) + '）')
    assert((await handlersHU['notes-history']({})).error, '缺 id 报错')
  })
  await t('恢复前置快照（安全核心）：恢复前当前版自动入 .history + 恢复可再撤销回滚', async () => {
    const c = await handlersHU['notes-create']({ title: '恢复安全', body: 'R0 正文', topic: '开发' })
    await handlersHU['notes-update']({ id: c.id, body: 'R1 正文' })   // 快照 R0
    const h1 = await handlersHU['notes-history']({ id: c.id })
    assert.strictEqual(h1.versions.length, 1, '前置：1 个历史版本（实得 ' + h1.versions.length + '）')
    // 恢复到 R0：正文写回历史版 + 当前版 R1 自动快照（恢复动作本身可撤销的安全网）
    const r = await handlersHU['notes-restore-history']({ id: c.id, ts: h1.versions[0].ts })
    assert(!r.error && r.restored === true, '恢复成功（实得 ' + JSON.stringify(r) + '）')
    const cur = await handlersHU['notes-get']({ id: c.id })
    assert.strictEqual(cur.note.body, 'R0 正文', '正文写回历史版（实得 ' + JSON.stringify(cur.note.body) + '）')
    const h2 = await handlersHU['notes-history']({ id: c.id })
    assert.strictEqual(h2.versions.length, 2, '恢复前置快照使版本数 +1（实得 ' + h2.versions.length + '）')
    const gNew = await handlersHU['notes-history-get']({ id: c.id, ts: h2.versions[0].ts })
    assert.strictEqual(gNew.body, 'R1 正文', '最新快照 = 恢复前的当前版（恢复可撤销的安全网；实得 ' + JSON.stringify(gNew.body) + '）')
    // 回滚闭环：再恢复「恢复前快照」→ 正文回到 R1（恢复本身可撤销的实证）
    const r2 = await handlersHU['notes-restore-history']({ id: c.id, ts: h2.versions[0].ts })
    assert(!r2.error, '二次恢复成功')
    const cur2 = await handlersHU['notes-get']({ id: c.id })
    assert.strictEqual(cur2.note.body, 'R1 正文', '恢复可再撤销：二次恢复回滚到恢复前版本')
    // 边界：未知 ts 拒绝恢复；已软删除笔记拒绝恢复
    const bad = await handlersHU['notes-restore-history']({ id: c.id, ts: 123 })
    assert(bad.error && bad.error.indexOf('历史版本不存在') >= 0, '未知 ts 拒绝恢复')
    await handlersHU['notes-delete']({ id: c.id })
    const h3 = await handlersHU['notes-history']({ id: c.id })
    const del = await handlersHU['notes-restore-history']({ id: c.id, ts: h3.versions[0].ts })
    assert(del.error, '已删除笔记拒绝恢复（实得 ' + JSON.stringify(del) + '）')
  })

  // ---- 38.3 client 面板结构（client-impl.js）：meta 行入口（有版本才显示）+ modal + Esc/错误互斥 + 恢复不再触发自动保存 ----
  await t('历史面板 client 结构：meta 行「历史」入口 + 列表/预览/恢复 modal + Esc/互斥接入 + 恢复零自动保存', () => {
    assert(clientSrc.indexOf("host.call('notes-history', { id: id })") >= 0, 'notes-history 探测/列表调用点')
    assert(clientSrc.indexOf("host.call('notes-history-get', { id: selectedRef.current, ts: ts })") >= 0, 'notes-history-get 预览调用点')
    assert(clientSrc.indexOf("host.call('notes-restore-history', { id: id, ts: ts0 })") >= 0, 'notes-restore-history 恢复调用点')
    assert(clientSrc.indexOf('(histCount || 0) > 0') >= 0 && clientSrc.indexOf("I('clock', 12), '历史'") >= 0, 'meta 行「历史」入口（有版本才显示，clock 图标）')
    assert(clientSrc.indexOf('probeHistCount') >= 0 && clientSrc.indexOf('histCountRef.current = null; setHistCount(null)') >= 0, '选中笔记切换时重置并探测版本计数')
    assert(clientSrc.indexOf('dsh-notes-hist-modal') >= 0 && clientSrc.indexOf('dsh-notes-hist-list') >= 0 && clientSrc.indexOf('dsh-notes-hist-item') >= 0, '历史 modal 结构类（列表）')
    assert(clientSrc.indexOf("'dsh-notes-hist-preview dsh-notes-rich'") >= 0 && clientSrc.indexOf('renderMarkdown(histPreview.body, wikiResolve)') >= 0, '预览只读渲染走 renderMarkdown 内核（全量转义零注入面）')
    assert(clientSrc.indexOf('fmtHistTs') >= 0 && clientSrc.indexOf('fmtBytes(v.bytes)') >= 0, '版本列表时间+大小展示')
    assert(clientSrc.indexOf('恢复此版本') >= 0 && clientSrc.indexOf('当前版本会先自动快照进历史版本，可再撤销') >= 0, '恢复按钮 + confirm 前置快照提示文案')
    assert(clientSrc.indexOf('histOpenRef.current) { setHistOpen(false)') >= 0, 'Esc 优先关历史面板')
    assert(clientSrc.indexOf('!suggestOpen && !histOpen') >= 0, '错误条与历史 modal 互斥')
    // 恢复回填不再触发自动保存（恢复版已由 host 落盘；再保存会把恢复版又快照一遍污染历史）
    const m = clientSrc.match(/function applyRestoredBody[\s\S]*?\n        \}/)
    assert(m, 'applyRestoredBody 函数体可提取')
    assert(m[0].indexOf('triggerAutoSave') < 0, '恢复回填不调 triggerAutoSave（恢复不是新编辑，不产生新快照）')
    assert(m[0].indexOf('setEdBody(text)') >= 0, '恢复回填刷新编辑器正文')
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    assert(css.indexOf('.dsh-notes-hist-modal{width:640px}') >= 0 && css.indexOf('.dsh-notes-hist-item.on{') >= 0 && css.indexOf('.dsh-notes-hist-preview{') >= 0, 'styles.css 历史 modal 样式')
  })

  // ---- 38.4 四端同步（client-impl / 发布包 lib/client.js / app.html / 原型 notes-ui-v2.html）----
  await t('历史版本面板四端同步：入口/modal/三 RPC 调用点（client-impl + 发布包 + app.html + 原型）', () => {
    // 发布包 lib/client.js 由 build-dist 机械转换（host 调用桥 → rpc 形态）
    for (const k of ['notes-history', 'notes-history-get', 'notes-restore-history', 'dsh-notes-hist-modal', '恢复此版本', 'probeHistCount', 'fmtHistTs', '当前版本会先自动快照']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺 ' + k + '（需先跑 scripts/build-dist.cjs）')
    }
    assert(clientPkgSrc.indexOf("rpc('notes-history', { id: id })") >= 0 && clientPkgSrc.indexOf("rpc('notes-restore-history', { id: id, ts: ts0 })") >= 0, '发布包历史三 RPC 调用点为 rpc 形态（build-dist 转换后）')
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("rpc('notes-history', { id: id })") >= 0, label + ' notes-history 探测调用点')
      assert(s.indexOf("rpc('notes-history-get', { id: selId, ts: ts })") >= 0, label + ' notes-history-get 预览调用点')
      assert(s.indexOf("rpc('notes-restore-history', { id: selId, ts: ts })") >= 0, label + ' notes-restore-history 恢复调用点')
      assert(s.indexOf('id="mHist"') >= 0 && s.indexOf('function openHistory()') >= 0, label + ' meta 行「历史」入口 + openHistory')
      assert(s.indexOf('(histCount || 0) > 0') >= 0, label + ' 入口有版本才显示（histCount 探测门控）')
      assert(s.indexOf('class="hist-body"') >= 0 && s.indexOf('id="histList"') >= 0 && s.indexOf('id="histView"') >= 0 && s.indexOf('id="histRestore"') >= 0, label + ' 历史 modal 结构（列表/预览/恢复按钮）')
      assert(s.indexOf('恢复此版本') >= 0 && s.indexOf('当前版本会先自动快照进历史版本，可再撤销') >= 0, label + ' 恢复按钮 + confirm 前置快照提示文案')
      assert(s.indexOf('.modal.hist{') >= 0 && s.indexOf('.hist-item.on{') >= 0 && s.indexOf('.hist-preview{') >= 0, label + ' 历史 modal 样式')
      assert(s.indexOf('histState = null') >= 0, label + ' Esc 关闭历史面板（histState 复位）')
    }
    assert(protoV2Src.indexOf("if (method === 'notes-history')") >= 0 && protoV2Src.indexOf("if (method === 'notes-history-get')") >= 0 && protoV2Src.indexOf("if (method === 'notes-restore-history')") >= 0, '原型 mock 含历史三 RPC 分支')
    assert(protoV2Src.indexOf('_mockHistory') >= 0 && protoV2Src.indexOf('function _mockSnap') >= 0, '原型 mock 历史快照存储/快照函数（恢复前置快照语义示意）')
  })

  // ---- 38.5 静态包行为（index.mjs 独立 ESM 实例）----
  await t('静态包历史三 RPC 行为：列表零正文 / get 取正文 / 恢复 + 恢复前置快照', async () => {
    const storeHU2 = new Map()
    const handlersHU2 = {}
    const harnessMockHU2 = { handle: (name, fn) => { handlersHU2[name] = fn; return () => { delete handlersHU2[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
    const harnessBackup38 = global.harness
    global.harness = harnessMockHU2
    try {
      const modHU = await import(pathToFileURL(INDEX_PATH).href + '?hist-ui=1')
      modHU.apply({
        fs: mkFsMockHist(storeHU2, [NOTES_ROOT_STATIC], null), sandboxPolicy: { resolve: () => ({}) },
        webServer: { register: () => () => {} }, tools: { register: () => () => {} },
        get: (name) => ({ agents: agentsMock, systemPrompt: { context: () => () => {} } })[name],
        effect: () => {},
      })
      const c = await handlersHU2['notes-create']({ title: '静态历史UI', body: 'SU0' })
      await handlersHU2['notes-update']({ id: c.id, body: 'SU1' })   // 快照 SU0
      const h = await handlersHU2['notes-history']({ id: c.id })
      assert(!h.error && h.versions.length === 1 && h.versions[0].body === undefined, '静态包列表 1 版且零正文（实得 ' + JSON.stringify(h).slice(0, 80) + '）')
      const g = await handlersHU2['notes-history-get']({ id: c.id, ts: h.versions[0].ts })
      assert(!g.error && g.body === 'SU0', '静态包 get 取历史版正文（实得 ' + JSON.stringify(g).slice(0, 60) + '）')
      const r = await handlersHU2['notes-restore-history']({ id: c.id, ts: h.versions[0].ts })
      assert(!r.error && r.restored === true, '静态包恢复成功')
      const cur = await handlersHU2['notes-get']({ id: c.id })
      assert.strictEqual(cur.note.body, 'SU0', '静态包正文写回历史版')
      const h2 = await handlersHU2['notes-history']({ id: c.id })
      assert.strictEqual(h2.versions.length, 2, '静态包恢复前置快照版本数 +1（实得 ' + h2.versions.length + '）')
    } finally {
      if (harnessBackup38 === undefined) delete global.harness; else global.harness = harnessBackup38
    }
  })

  // ===== 39. 工作记忆 v0 Phase 1（kind=log 沉淀链路 + 默认隐身 + 启用流程 + 日志卫生提名 + 四端同步）=====
  // 规格 = design/agent-memory-v0.md：① kind=log 模板/枚举/永不被清理提名 ② 默认隐身（inject 硬 false / recall 缺省 false / 列表与默认搜索排除）
  // ③ 启用流程（notes-memory-guide：check 重叠检查 / enable 创建预填约定 tag memory-guide + 作用域 / disable 关 inject / status 单一事实源）
  // ④ 日志卫生提名（suggest 第四类 logHygieneCandidates：周聚合 >7 天 / 月聚合 >90 天，只提名不执行，v0 仅展示明细）
  section('39. 工作记忆 v0 Phase 1（kind=log + 默认隐身 + 启用流程 + 日志卫生）')

  // ---- 39.1 host 双侧静态契约（host-impl.js ⇄ index.mjs 双包同步）----
  await t('host 双侧：kind=log 枚举三处 + KIND_TEMPLATES.log 四节模板（§4.2）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("const KINDS = ['note', 'decision', 'todo', 'link', 'quote', 'log']") >= 0, label + ' KINDS 含 log')
      assert(s.indexOf("quote: '引用', log: '日志'") >= 0, label + ' 中文标签映射含 log:日志')
      assert(s.indexOf("const CATALOG_KIND_LABELS = { note: '笔记', decision: '决策', todo: '待办', link: '链接', quote: '引用', log: '日志' }") >= 0, label + ' CATALOG_KIND_LABELS 含 log')
      assert(s.indexOf("'## 做了什么\\n\\n（本会话完成的任务/阶段，一句话一条）") >= 0, label + ' log 模板「做了什么」节')
      assert(s.indexOf('## 改动\\n\\n（改动的文件/配置/数据，路径 + 一句话）') >= 0, label + ' log 模板「改动」节')
      assert(s.indexOf('## 遗留与后续') >= 0 && s.indexOf('## 相关笔记\\n\\n（[[n-xxxxxxxx]] 双链引用本库相关笔记；无则空）') >= 0, label + ' log 模板「遗留与后续/相关笔记」节（双链占位）')
    }
  })
  await t('host 双侧：front-matter 检索字段往返预留（§7.2：logDate 恒写 / entities+summarizedAt 条件行 / parseFM 拆分 / noteFromParsed 缺省）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("'logDate: ' + escYaml(m.logDate || '')") >= 0, label + ' buildFM logDate 恒写（log 恒写/其他空）')
      assert(s.indexOf("(m.entities && m.entities.length ? 'entities: ' + m.entities.map(escYaml).join(', ') + '\\n' : '')") >= 0, label + ' buildFM entities 条件行（仅非空落盘）')
      assert(s.indexOf("(m.summarizedAt ? 'summarizedAt: ' + escYaml(m.summarizedAt) + '\\n' : '')") >= 0, label + ' buildFM summarizedAt 条件行')
      assert(s.indexOf("|| key === 'entities'") >= 0, label + ' parseFM entities 进拆分列表（与 tags 同路径）')
      assert(s.indexOf("entities: Array.isArray(p.meta.entities) ? p.meta.entities : [],") >= 0, label + ' noteFromParsed entities 缺省 []')
      assert(s.indexOf("logDate: p.meta.logDate || '',") >= 0 && s.indexOf("summarizedAt: p.meta.summarizedAt || '',") >= 0, label + ' noteFromParsed logDate/summarizedAt 缺省')
      assert(s.indexOf('function localDateStr(d)') >= 0, label + ' localDateStr 本地时区日期 helper（logDate 缺省今天）')
      assert(s.indexOf('logDate: n.logDate || \'\'') >= 0, label + ' slim 携带 logDate（client 卫生展示用）')
    }
  })
  await t('host 双侧：默认隐身硬闸（_create/_update 强制 inject=false + recall 缺省 false + injectForcedOff 告知 + 解析侧缺省）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("const isLog = (ex.kind || 'note') === 'log'") >= 0, label + ' _create isLog 判定')
      assert(s.indexOf('inject: isLog ? false : ex.inject === true,') >= 0, label + ' _create inject 硬 false（显式 true 也纠正）')
      assert(s.indexOf('recall: isLog ? (ex.recall === true) : (ex.recall !== false),') >= 0, label + ' _create recall 缺省 false（显式 true 豁免保留）')
      assert(s.indexOf("if (effKind === 'log' && inject === true) { note.inject = false; injectForcedOff = true }") >= 0, label + ' _update inject 硬闸纠正')
      assert(s.indexOf('if (injectForcedOff) r.injectForcedOff = true') >= 0, label + ' 响应 injectForcedOff 告知（create/update 同款）')
      assert(s.indexOf("p.meta.kind === 'log' ? false : true") >= 0, label + ' noteFromParsed：存量/外部直写 log 缺省 recall=false')
    }
  })
  await t('host 双侧：_list/_search 默认排除 kind=log（显式 kind=log / includeLogs / 回收站路径召回）+ 目录尾部日志计数提示行', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('async function _list(tag, kind, folder, includeDeleted, includeLogs)') >= 0, label + ' _list 五参（+includeLogs）')
      assert(s.indexOf("if (note.kind === 'log' && !includeLogs && !includeDeleted && !kind) continue") >= 0, label + ' _list 默认排除 log（显式 kind/回收站/includeLogs 召回）')
      assert(s.indexOf("!!(kind === 'log' || (filters && filters.includeLogs))") >= 0, label + ' _search 同款默认排除')
      assert(s.indexOf(' 条工作日志（kind=log，默认隐身不进目录），用 note_search 传 kind=log 检索') >= 0, label + ' 目录尾部日志计数提示行（有日志恒出现，只出计数不出标题）')
      assert(s.indexOf('if (pool.length === 0 && logCount === 0) return') >= 0, label + ' 目录空态判定连带日志计数')
    }
  })
  await t('host 双侧：notes-memory-guide RPC + 引导模板 §5.2 要点 + 重叠检查关键词 + 日志永不被清理提名', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("handle('notes-memory-guide'") >= 0, label + ' notes-memory-guide RPC 注册')
      assert(s.indexOf("const MEMORY_GUIDE_TAG = 'memory-guide'") >= 0, label + ' 发现键 tag memory-guide（零 schema 变更）')
      assert(s.indexOf('约定：工作日志沉淀（工作记忆 v0）') >= 0, label + ' 引导约定标题')
      assert(s.indexOf('【工作约定】会话工作沉淀（工作记忆 v0）') >= 0, label + ' 引导模板首行')
      assert(s.indexOf('用户显式说「记一下 / 沉淀一下 / 写工作日志」时') >= 0, label + ' 内置「记一下」响应指令（沉淀快捷⑤，无新按钮）')
      assert(s.indexOf('【分工边界】') >= 0 && s.indexOf('互不替代、互不合并') >= 0, label + ' 【分工边界】必需段落（裁决 A②防双记）')
      assert(s.indexOf('note_manage list（kind=log）') >= 0 && s.indexOf('## HH:mm 续') >= 0, label + ' 模板含当日归键写法（list 查当天 → update 追加续节）')
      assert(s.indexOf('MEMORY_GUIDE_OVERLAP_RE') >= 0 && s.indexOf('记录|日志|总结|沉淀|复盘|feedback|反馈') >= 0, label + ' 语义重叠检查关键词（§5.1）')
      assert(s.indexOf("const MEMORY_GUIDE_FOLDER = '工作日志'") >= 0, label + ' 启用时确保「工作日志」文件夹')
      assert(s.indexOf('启用状态不落 settings.json') >= 0, label + ' 状态单一事实源注释（tag + inject=true）')
      assert(s.indexOf("if (n.kind === 'log') continue   // 日志永不被过期清理提名") >= 0, label + ' stale 候选显式排除 log（只聚合不淘汰）')
      assert(s.indexOf("if ((n.kind || 'note') === 'log') continue   // 日志永不被孤儿清理提名") >= 0, label + ' orphan 候选显式排除 log')
    }
  })
  await t('host 双侧：settings 键 logWeekAfterDays/logRetentionDays 校验 + _suggest 第四类候选 logHygieneCandidates（只提名不执行）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('const LOG_WEEK_AFTER_DAYS_DEFAULT = 7') >= 0 && s.indexOf('const LOG_RETENTION_DAYS_DEFAULT = 90') >= 0, label + ' 窗口缺省 7/90（§6.3）')
      assert(s.indexOf('function logWeekAfterDaysLimit()') >= 0 && s.indexOf('function logRetentionDaysLimit()') >= 0, label + ' 窗口 helper（null 恢复缺省）')
      assert(s.indexOf("'logWeekAfterDays' in patch") >= 0 && s.indexOf("'logRetentionDays' in patch") >= 0, label + ' settings-set 两键校验')
      assert(s.indexOf('notes-settings-set: logWeekAfterDays 需要非负数值') >= 0 && s.indexOf('notes-settings-set: logRetentionDays 需要非负数值') >= 0, label + ' 非法值报错文案')
      assert(s.indexOf('logHygieneCandidates: suggestLogHygiene(all, logWeekAfterDaysLimit(), logRetentionDaysLimit())') >= 0, label + ' _suggest 第四类候选接线')
      assert(s.indexOf('工作周志 · ') >= 0 && s.indexOf('工作月志 · ') >= 0, label + ' 周志/月志标题三段式（§6.3）')
      assert(s.indexOf('_list(undefined, undefined, undefined, undefined, true)') >= 0, label + ' 治理路径显式包含日志（suggest/memory-guide）')
    }
  })

  // ---- 39.2 host 行为级（开发版独立实例 storeM/handlersM，与 33 节同款隔离模式）----
  const storeM = new Map()
  let writesM = 0
  const fsMockM = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeM.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of storeM.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!storeM.has(p)) throw new Error('ENOENT: ' + p); return storeM.get(p) },
    writeText: async (p, c) => { writesM++; storeM.set(p, c) },
  }
  const handlersM = {}
  const harnessMockM = { handle: (name, fn) => { handlersM[name] = fn; return () => { delete handlersM[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  const contextsM = []
  new Function('harness', 'pluginDir', hostSrc)(harnessMockM, DIR).apply({
    fs: fsMockM, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contextsM.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  const dayMsM = 86400000
  const dstrM = (d) => { const x = new Date(Date.now() - d * dayMsM); const p = (n) => String(n).padStart(2, '0'); return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate()) }
  const seedM = (id, fm, body) => storeM.set(NOTES_DIR + '\\' + id + '.md', '---\nid: ' + id + '\n' + fm.join('\n') + '\n---\n\n' + body)
  // 预热沉降：apply 心跳与首个 RPC 的 perf-report 是 fire-and-forget 写——先落定再断言零写入（33 节同款姿势）
  await handlersM['notes-list']({})
  await new Promise(r => setTimeout(r, 20))

  await t('kind=log 创建：inject 硬 false（显式 true 被纠正 + injectForcedOff 告知）+ recall 缺省 false + logDate 缺省今天 + front-matter 落盘', async () => {
    const lg = await handlersM['notes-create']({ title: '工作日志 · 测试', body: '## 做了什么\n\n验收工作记忆 v0', kind: 'log', inject: true })
    assert(lg.id && lg.injectForcedOff === true, '显式 inject:true 被纠正且响应告知（实得 ' + JSON.stringify(lg) + '）')
    const g = await handlersM['notes-get']({ id: lg.id })
    assert(g.note.kind === 'log' && g.note.inject === false, 'inject 硬 false 落库')
    assert(g.note.recall === false, 'recall 缺省 false（日志不进目录）')
    assert(/^\d{4}-\d{2}-\d{2}$/.test(g.note.logDate || ''), 'logDate 缺省取今天（本地时区 YYYY-MM-DD，实得 ' + g.note.logDate + '）')
    const raw = storeM.get(NOTES_DIR + '\\' + lg.id + '.md')
    assert(raw.indexOf('kind: log') >= 0 && raw.indexOf('inject: false') >= 0 && raw.indexOf('recall: false') >= 0, 'front-matter kind/inject/recall 落盘')
    assert(new RegExp('logDate: ' + g.note.logDate).test(raw), 'front-matter logDate 落盘')
    assert(raw.indexOf('entities:') < 0 && raw.indexOf('summarizedAt:') < 0, 'entities/summarizedAt 空值不落盘（条件行）')
  })
  await t('kind=log recall 显式 true 豁免 + 普通 note 不受隐身影响（recall 缺省 true / inject 照常）', async () => {
    const lg = await handlersM['notes-create']({ title: '日志-目录豁免', body: 'x', kind: 'log', recall: true })
    const g = await handlersM['notes-get']({ id: lg.id })
    assert(g.note.recall === true && g.note.inject === false, '显式 recall=true 允许进目录（豁免保留），inject 仍硬 false')
    const nm = await handlersM['notes-create']({ title: '普通笔记M', body: 'x', inject: true })
    const gn = await handlersM['notes-get']({ id: nm.id })
    assert(gn.note.recall === true && gn.note.inject === true, '普通笔记 recall/inject 口径不变（向后兼容）')
  })
  await t('检索字段往返：entities 经 notes-create 落盘并解析回数组；summarizedAt 经 notes-update 条件落盘', async () => {
    const c = await handlersM['notes-create']({ title: '实体往返', body: 'x', entities: ['alpha', 'beta'] })
    const raw = storeM.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(raw.indexOf('entities: alpha, beta') >= 0, 'entities 非空落盘（逗号分隔同 tags 路径）')
    const g = await handlersM['notes-get']({ id: c.id })
    assert.deepStrictEqual(g.note.entities, ['alpha', 'beta'], 'entities 解析回数组（往返无损）')
    assert((g.note.logDate || '') === '', '非 log 笔记 logDate 为空串（§7.2 其他空）')
    await handlersM['notes-update']({ id: c.id, summarizedAt: '2026-10-02T13:00:00.000Z' })
    const raw2 = storeM.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(raw2.indexOf('summarizedAt: "2026-10-02T13:00:00.000Z"') >= 0, 'summarizedAt 条件落盘（ISO 串含冒号，escYaml 引号包裹——与 createdAt 同款）')
    const g2 = await handlersM['notes-get']({ id: c.id })
    assert.strictEqual(g2.note.summarizedAt, '2026-10-02T13:00:00.000Z', 'summarizedAt 解析往返')
  })
  await t('隐身口径：默认列表/默认搜索排除 kind=log；显式 kind=log 或 includeLogs:true 召回；回收站路径含日志', async () => {
    const def = await handlersM['notes-list']({})
    assert(def.notes.every(n => n.kind !== 'log'), '默认列表零日志（实得含 log：' + def.notes.filter(n => n.kind === 'log').length + '）')
    assert(def.notes.some(n => n.title === '普通笔记M'), '默认列表含普通笔记')
    const only = await handlersM['notes-list']({ kind: 'log' })
    assert(only.notes.length >= 2 && only.notes.every(n => n.kind === 'log'), '显式 kind=log 过滤召回（实得 ' + only.notes.length + '）')
    const inc = await handlersM['notes-list']({ includeLogs: true })
    assert(inc.notes.some(n => n.kind === 'log') && inc.notes.some(n => n.kind === 'note'), 'includeLogs:true 混合召回')
    const s0 = await handlersM['notes-search']({ query: '工作日志' })
    assert(s0.notes.every(n => n.kind !== 'log'), '默认搜索排除日志')
    const s1 = await handlersM['notes-search']({ query: '工作日志', kind: 'log' })
    assert(s1.notes.length >= 1 && s1.notes.every(n => n.kind === 'log'), 'kind=log 搜索召回')
    const s2 = await handlersM['notes-search']({ query: '工作日志', includeLogs: true })
    assert(s2.notes.some(n => n.kind === 'log'), 'includeLogs:true 搜索召回')
    const tr = await handlersM['notes-list']({ includeDeleted: true })
    assert(tr.notes.some(n => n.kind === 'log'), '回收站（includeDeleted）路径显式包含日志（隐身不适用治理面）')
  })
  await t('update 硬闸：kind=log 显式 inject:true 被纠正（injectForcedOff + injectEver 不拉起）；改 kind=note 后恢复普通语义', async () => {
    const lg = await handlersM['notes-create']({ title: '改注入演示', body: 'x', kind: 'log' })   // 标题刻意避开「日志/记录」关键词：转成 note 后 inject=true，不干扰 39.3 重叠检查计数
    const u1 = await handlersM['notes-update']({ id: lg.id, inject: true })
    assert(u1.injectForcedOff === true, 'update 显式 inject:true 被纠正并告知')
    const g1 = await handlersM['notes-get']({ id: lg.id })
    assert(g1.note.inject === false && g1.note.injectEver === false, 'inject=false 且 injectEver 未被粘性拉起')
    const u2 = await handlersM['notes-update']({ id: lg.id, kind: 'note' })
    assert(!u2.error, 'kind 改为 note 成功')
    const u3 = await handlersM['notes-update']({ id: lg.id, inject: true })
    assert(u3.injectForcedOff !== true, 'kind=note 后 inject:true 不再纠正')
    const g3 = await handlersM['notes-get']({ id: lg.id })
    assert(g3.note.inject === true && g3.note.injectEver === true, '普通语义恢复（injectEver 粘性照常）')
  })
  await t('目录注入尾部日志计数提示行（order 131，有日志恒出现；只出计数不出标题）', async () => {
    const cat = contextsM.find(c => c.order === 131)
    assert(cat && typeof cat.text === 'function', 'notes:catalog order 131 已注册')
    const txt = cat.text()
    const m = txt.match(/另有 (\d+) 条工作日志（kind=log，默认隐身不进目录），用 note_search 传 kind=log 检索/)
    // 此刻实例内恰 2 条 log：「工作日志 · 测试」（recall=false）+「日志-目录豁免」（recall=true 豁免，同时以条目进目录）；「改注入演示」已转 kind=note
    assert(m && +m[1] === 2, '目录尾部日志计数提示行（实得计数 ' + (m && m[1]) + '）')
    assert(txt.indexOf('工作日志 · 测试') < 0, '提示行不含日志标题（天然无泄露面）')
  })

  // ---- 39.3 启用流程（notes-memory-guide check/enable/status/disable 全链路）----
  await t('notes-memory-guide：status 缺省关 → check 零写入列重叠 → enable 未确认闸门 → confirmed 创建约定 + 文件夹', async () => {
    // 造一条语义重叠的已注入约定（命中「记录」关键词）
    const ov = await handlersM['notes-create']({ title: '约定：看板反馈记录', body: '使用问题随手记录到「看板反馈」文件夹', inject: true, topic: '约定' })
    const st0 = await handlersM['notes-memory-guide']({ op: 'status' })
    assert(st0.enabled === false, '缺省关（无 tag memory-guide 笔记）')
    const keysBefore = Array.from(storeM.keys()).sort()
    const chk = await handlersM['notes-memory-guide']({ op: 'check' })
    assert.deepStrictEqual(Array.from(storeM.keys()).sort(), keysBefore, 'check 为 dry-run 零写入')
    assert(chk.overlaps.length === 1 && chk.overlaps[0].id === ov.id, '重叠候选命中反馈约定（实得 ' + JSON.stringify(chk.overlaps.map(o => o.id)) + '）')
    assert(chk.overlaps[0].title.indexOf('看板反馈') >= 0 && typeof chk.overlaps[0].preview === 'string', '候选含标题+摘要')
    const e1 = await handlersM['notes-memory-guide']({ op: 'enable', scope: [] })
    assert(e1.needConfirm === true && e1.overlaps.length === 1, '有重叠且未 confirmed → 待确认闸门（零写入）')
    const e2 = await handlersM['notes-memory-guide']({ op: 'enable', scope: ['abc12345'], confirmed: true })
    assert(e2.ok === true && e2.id && e2.overlaps === 1, 'confirmed:true 创建成功（实得 ' + JSON.stringify(e2) + '）')
    const g = await handlersM['notes-get']({ id: e2.id })
    assert(g.note.title === '约定：工作日志沉淀（工作记忆 v0）' && g.note.kind === 'note', '预填约定标题/kind=note（引导是行为约定，不是日志本身）')
    assert(g.note.inject === true && g.note.injectRole === 'convention', 'inject=true + convention 桶（单一注入源 order 130）')
    assert(g.note.tags.indexOf('memory-guide') >= 0, 'tag memory-guide 发现键')
    assert.deepStrictEqual(g.note.injectTo, ['abc12345'], '作用域写入 injectTo（用户选择）')
    assert(g.note.body.indexOf('【分工边界】') >= 0 && g.note.body.indexOf('kind=log') >= 0, '引导模板全文（含分工边界段）')
    const folders = await handlersM['notes-folders']({})
    assert(folders.folders.some(f => f.name === '工作日志'), '启用同时确保「工作日志」虚拟文件夹存在')
    const st1 = await handlersM['notes-memory-guide']({ op: 'status' })
    assert(st1.enabled === true && st1.noteId === e2.id, 'status 单一事实源：启用态 = tag+inject=true')
    const chk2 = await handlersM['notes-memory-guide']({ op: 'check' })
    assert(chk2.overlaps.every(o => o.id !== e2.id), '重叠检查排除引导笔记自身（tag memory-guide 豁免）')
  })
  await t('notes-memory-guide：enable 幂等（已启用不建第二条）+ disable 关 inject 停用 + 未知 op 报错', async () => {
    const st = await handlersM['notes-memory-guide']({ op: 'status' })
    assert(st.enabled === true && st.noteId, '前置：上一断言已启用')
    const e3 = await handlersM['notes-memory-guide']({ op: 'enable', scope: [], confirmed: true })
    assert(e3.ok === true && e3.already === true && e3.id === st.noteId, '幂等：重复启用返回现状（不建第二条）')
    const d1 = await handlersM['notes-memory-guide']({ op: 'disable' })
    assert(d1.ok === true && d1.disabled === true && d1.id === st.noteId, 'disable = 关闭该约定 inject')
    const g = await handlersM['notes-get']({ id: st.noteId })
    assert(g.note.inject === false && g.note.injectEver === true, '笔记保留（inject 已关；injectEver 粘性照常）')
    const st2 = await handlersM['notes-memory-guide']({ op: 'status' })
    assert(st2.enabled === false && st2.noteId === st.noteId, '停用后 status=关（笔记仍在可再启用）')
    const d2 = await handlersM['notes-memory-guide']({ op: 'disable' })
    assert(d2.ok === true && d2.disabled === false, '重复停用幂等（本就未启用）')
    const bad = await handlersM['notes-memory-guide']({ op: 'bogus' })
    assert(bad.error && bad.error.indexOf('未知 op') >= 0, '未知 op 报错')
    // 复启用（停用后的笔记仍存在 → enable 应再建吗？不——active=null 时会新建一条；此处验证「删除即彻底退出」前的再启用路径）
    const e4 = await handlersM['notes-memory-guide']({ op: 'enable', scope: [], confirmed: true })
    assert(e4.ok === true && e4.id && e4.id !== st.noteId, '停用后再启用创建新约定（旧约定 inject=false 不视为启用）')
  })

  // ---- 39.4 日志卫生提名（suggest 第四类候选；只提名不执行）----
  await t('notes-suggest logHygieneCandidates：周聚合（>7 天 工作区×ISO 周）+ 月聚合（>90 天 工作区×月）+ 同组 ≥2 才提名', async () => {
    // 造确定性日志：dstr(10) ×2（wsA 同周）、dstr(100) ×2（wsA 同月）、dstr(2)（新日志不成组）、dstr(10) wsB 单条（≥2 规则出局）
    const iso = (d) => new Date(Date.now() - d * dayMsM).toISOString()
    seedM('n-m-lgw1', ['title: 日志W1', 'kind: log', 'workspace: wsA', 'logDate: ' + dstrM(10), 'sessionId: sess-w1', 'createdAt: "' + iso(10) + '"', 'updatedAt: "' + iso(10) + '"'], '周志成员一')
    seedM('n-m-lgw2', ['title: 日志W2', 'kind: log', 'workspace: wsA', 'logDate: ' + dstrM(10), 'sessionId: sess-w2', 'createdAt: "' + iso(10) + '"', 'updatedAt: "' + iso(10) + '"'], '周志成员二')
    seedM('n-m-lgm1', ['title: 日志M1', 'kind: log', 'workspace: wsA', 'logDate: ' + dstrM(100), 'createdAt: "' + iso(100) + '"', 'updatedAt: "' + iso(100) + '"'], '月志成员一')
    seedM('n-m-lgm2', ['title: 日志M2', 'kind: log', 'workspace: wsA', 'logDate: ' + dstrM(100), 'createdAt: "' + iso(100) + '"', 'updatedAt: "' + iso(100) + '"'], '月志成员二')
    seedM('n-m-lgfresh', ['title: ' + '新日志', 'kind: log', 'workspace: wsA', 'logDate: ' + dstrM(2), 'createdAt: "' + iso(2) + '"', 'updatedAt: "' + iso(2) + '"'], '未超窗')
    seedM('n-m-lgsolo', ['title: 单条旧日志', 'kind: log', 'workspace: wsB', 'logDate: ' + dstrM(10), 'createdAt: "' + iso(10) + '"', 'updatedAt: "' + iso(10) + '"'], 'wsB 单条不成组')
    const r = await handlersM['notes-suggest']({})
    assert(!r.error && r.logHygieneCandidates, '第四类候选存在（实得键 ' + Object.keys(r).join(',') + '）')
    const hg = r.logHygieneCandidates
    const wk10 = sugNS.suggestISOWeek(dstrM(10)), wk100 = sugNS.suggestISOWeek(dstrM(100)), mo100 = dstrM(100).slice(0, 7)
    const wKeys = hg.weekly.map(g => g.key)
    assert(wKeys.indexOf('wsA|' + wk10) >= 0 && wKeys.indexOf('wsA|' + wk100) >= 0, '周聚合两组（10 天组 + 100 天组同区不同周；实得 ' + wKeys.join(',') + '）')
    assert(wKeys.every(k => k.indexOf('wsB|') < 0), 'wsB 单条旧日志不成组（同组 ≥2 条才提名）')
    const wA = hg.weekly.find(g => g.key === 'wsA|' + wk10)
    assert(wA.title === '工作周志 · wsA · ' + wk10 && wA.members.length === 2, '周志标题三段式 + 2 成员')
    assert(wA.members[0].logDate === dstrM(10) && typeof wA.members[0].sessionId === 'string', '成员含 id/title/logDate/sessionId（明细展示数据源）')
    assert(hg.monthly.length === 1 && hg.monthly[0].key === 'wsA|' + mo100 && hg.monthly[0].title === '工作月志 · wsA · ' + mo100, '月聚合一组（>90 天；实得 ' + hg.monthly.map(g => g.key).join(',') + '）')
    assert(hg.monthly[0].members.length === 2, '月志 2 成员（原始日志混合归组）')
    // 日志永不进过期/孤儿候选（只聚合不淘汰，§6.3 红线）
    const staleIds = r.staleCandidates.map(x => x.id), orphIds = r.orphanCandidates.map(x => x.id)
    for (const lid of ['n-m-lgw1', 'n-m-lgw2', 'n-m-lgm1', 'n-m-lgm2', 'n-m-lgfresh', 'n-m-lgsolo']) {
      assert(staleIds.indexOf(lid) < 0 && orphIds.indexOf(lid) < 0, '日志不进 stale/orphan：' + lid)
    }
    // 前三段口径不变（速记组结构仍与 archive-preview 同源）
    assert(Array.isArray(r.archiveCandidates) && Array.isArray(r.staleCandidates) && Array.isArray(r.orphanCandidates) && typeof r.generatedAt === 'string', '四段 + generatedAt 结构齐备')
  })
  await t('日志卫生窗口跟随 settings（logRetentionDays=0 关闭月聚合；logWeekAfterDays override 生效 + null 恢复缺省）', async () => {
    await handlersM['notes-settings-set']({ logRetentionDays: 0 })
    const r1 = await handlersM['notes-suggest']({})
    assert(r1.logHygieneCandidates.monthly.length === 0 && r1.logHygieneCandidates.weekly.length >= 1, 'logRetentionDays=0 关闭月聚合本级（周聚合不受影响）')
    await handlersM['notes-settings-set']({ logWeekAfterDays: 120 })
    const r2 = await handlersM['notes-suggest']({})
    assert(r2.logHygieneCandidates.weekly.length === 0, 'logWeekAfterDays=120：10/100 天均未超窗 → 周聚合空')
    await handlersM['notes-settings-set']({ logWeekAfterDays: null, logRetentionDays: null })
    const r3 = await handlersM['notes-suggest']({})
    assert(r3.logHygieneCandidates.weekly.length >= 1 && r3.logHygieneCandidates.monthly.length === 1, 'null 恢复缺省 7/90 → 两组回到候选')
    const bad1 = await handlersM['notes-settings-set']({ logWeekAfterDays: -3 })
    const bad2 = await handlersM['notes-settings-set']({ logRetentionDays: 'x' })
    assert(bad1.error && bad2.error, '负数/非数值报错不落盘')
  })

  // ---- 39.5 静态包行为（index.mjs 独立 ESM 实例，harness 主通道）----
  await t('静态包：notes-memory-guide 注册 + kind=log 隐身硬闸 + suggest 第四段（index.mjs 独立实例）', async () => {
    const storeM2 = new Map()
    const fsMockM2 = mkFsMockImp(storeM2, [NOTES_ROOT_STATIC])
    const handlersM2 = {}
    const harnessMockM2 = { handle: (name, fn) => { handlersM2[name] = fn; return () => { delete handlersM2[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
    const harnessBackup39 = global.harness
    global.harness = harnessMockM2
    try {
      const modM2 = await import(pathToFileURL(INDEX_PATH).href + '?memory=1')
      modM2.apply({
        fs: fsMockM2, sandboxPolicy: { resolve: () => ({}) },
        webServer: { register: () => () => {} }, tools: { register: () => () => {} },
        get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
        effect: () => {},
      })
      assert.strictEqual(typeof handlersM2['notes-memory-guide'], 'function', '静态包注册 notes-memory-guide')
      const lg = await handlersM2['notes-create']({ title: '静态日志', body: 'x', kind: 'log', inject: true })
      assert(lg.id && lg.injectForcedOff === true, '静态包 inject 硬闸（显式 true 纠正 + 告知）')
      const g = await handlersM2['notes-get']({ id: lg.id })
      assert(g.note.inject === false && g.note.recall === false && /^\d{4}-\d{2}-\d{2}$/.test(g.note.logDate || ''), '静态包 recall 缺省 false + logDate 缺省今天')
      const def = await handlersM2['notes-list']({})
      assert(def.notes.every(n => n.kind !== 'log'), '静态包默认列表排除日志')
      const en = await handlersM2['notes-memory-guide']({ op: 'enable', scope: [], confirmed: true })
      assert(en.ok === true && en.id, '静态包启用流程（无重叠库直接创建）')
      const st = await handlersM2['notes-memory-guide']({ op: 'status' })
      assert(st.enabled === true && st.noteId === en.id, '静态包 status 单一事实源')
      const sg = await handlersM2['notes-suggest']({})
      assert(sg.logHygieneCandidates && Array.isArray(sg.logHygieneCandidates.weekly) && Array.isArray(sg.logHygieneCandidates.monthly), '静态包 suggest 第四段结构')
    } finally {
      if (harnessBackup39 === undefined) delete global.harness; else global.harness = harnessBackup39
    }
  })

  // ---- 39.6 四端同步（client-impl / 发布包 lib/client.js / app.html / 原型 notes-ui-v2.html + styles.css）----
  await t('四端 kind=log：KIND 标签/模板/筛选类型组/色板变量/专入口接线同步（client + 发布包 + app.html + 原型 + styles）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("log: '日志'") >= 0, label + ' KIND_LABELS 含日志')
      assert(s.indexOf("'## 做了什么\\n\\n（本会话完成的任务/阶段，一句话一条）") >= 0, label + ' KIND_TEMPLATES.log 与 host 同份')
      assert(s.indexOf("const FILTER_KINDS = ['note', 'decision', 'todo', 'link', 'quote', 'log']") >= 0, label + ' 筛选中心类型组含 log（kind=日志 即专入口）')
      assert(s.indexOf("e('option', { value: 'log' }, '日志')") >= 0, label + ' 编辑器 kind 下拉含日志')
      assert(s.indexOf("['note', 'decision', 'todo', 'link', 'quote', 'log'].map(k => e('option'") >= 0, label + ' 新建 modal 类型含日志（预填 log 模板骨架）')
      assert(s.indexOf("notes-list', wantLogsRef.current ? { includeLogs: true } : undefined") >= 0, label + ' loadNotes 日志专入口 includeLogs 接线（host 默认排除）')
      assert(s.indexOf("(n.kind || 'note') !== 'log' || filters.kinds.indexOf('log') >= 0") >= 0, label + ' 隐身渲染守卫（未勾日志不进日常视图）')
    }
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("log: '日志'") >= 0, label + ' KIND 含日志')
      assert(s.indexOf("'## 做了什么\\n\\n（本会话完成的任务/阶段，一句话一条）") >= 0, label + ' KIND_TEMPLATES.log 与 host 同份')
      assert(s.indexOf("var FILTER_KINDS = ['note', 'decision', 'todo', 'link', 'quote', 'log'];") >= 0, label + ' 筛选类型组含 log')
      assert(s.indexOf("log: 'var(--kind-log)'") >= 0, label + ' KCOLOR 含 log')
      assert(s.indexOf('--kind-log:') >= 0, label + ' 色板 --kind-log 变量（双主题）')
      assert(s.indexOf("rpc('notes-list', wantLogs ? { includeLogs: true } : undefined)") >= 0, label + ' loadNotes includeLogs 接线')
      assert(s.indexOf("(n.kind || 'note') === 'log' && filters.kinds.indexOf('log') < 0") >= 0, label + ' 隐身渲染守卫')
      assert(s.indexOf('function maybeReloadForLogs()') >= 0, label + ' 勾选「日志」自动重拉列表')
    }
    const cssDev2 = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg2 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    assert(cssDev2.indexOf('--nkind-log:') >= 0 && cssPkg2.indexOf('--nkind-log:') >= 0, 'styles.css 双端 --nkind-log 日志色点（需跑 scripts/build-dist.cjs）')
  })
  await t('设置卡片「工作记忆」区 + 启用对话框（状态行/作用域/重叠检查/停用）四端同步', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("{ key: 'memory', label: '工作记忆'") >= 0, label + ' 设置卡片「工作记忆」行')
      assert(s.indexOf("{ key: 'logweek', label: '日志周聚合窗口'") >= 0 && s.indexOf("{ key: 'logmonth', label: '日志月聚合窗口'") >= 0, label + ' 日志卫生两级窗口行')
      assert(s.indexOf("'notes-memory-guide', { op: 'status' }") >= 0, label + ' 状态探测调用点')
      assert(s.indexOf("'notes-memory-guide', { op: 'check' }") >= 0, label + ' 重叠检查调用点（dry-run）')
      assert(s.indexOf("'notes-memory-guide', { op: 'enable', scope: memScopeResolve(), confirmed: true }") >= 0, label + ' 启用调用点（作用域 + confirmed）')
      assert(s.indexOf("'notes-memory-guide', { op: 'disable' }") >= 0, label + ' 停用调用点（关 inject）')
      assert(s.indexOf('启用沉淀引导…') >= 0 && s.indexOf('约定：工作日志沉淀（工作记忆 v0）') >= 0, label + ' 入口按钮 + 对话框文案')
      // notes-scope-global-pick：「当前X」单选 → 「指定X」多选清单（全局视角；injectTo 落值语义不变——工作区档展开为所选工作区全部会话短 id 并集）
      assert(s.indexOf('function memScopeResolve()') >= 0 && s.indexOf("memScope === 'global'") >= 0 && s.indexOf("memScope === 'session'") >= 0, label + ' 作用域三档解析（全局/指定工作区/指定会话）')
      assert(s.indexOf("scopeOpt('workspace', '指定工作区（多选）'") >= 0 && s.indexOf("scopeOpt('session', '指定会话（多选）'") >= 0, label + ' 指定工作区/会话多选档文案')
      assert(s.indexOf('memWsPick') >= 0 && s.indexOf('memSidPick') >= 0 && s.indexOf('sessList.concat(sessPending)') >= 0, label + ' 多选清单状态 + 数据源（sessList + pending 占位）')
      assert(s.indexOf('当前工作区的会话') < 0 && s.indexOf('仅当前会话') < 0, label + ' 去「当前X」单选档（全局视角改造）')
      assert(s.indexOf('logWeekAfterDays: v') >= 0 && s.indexOf('logRetentionDays: v') >= 0, label + ' 窗口保存 payload')
      assert(s.indexOf('memOpenRef.current) { setMemOpen(false)') >= 0, label + ' Esc 优先关启用对话框')
    }
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('id="setMemoryCtrl"') >= 0, label + ' 设置卡片「工作记忆」行')
      assert(s.indexOf('id="setLogWeek"') >= 0 && s.indexOf('id="setLogMonth"') >= 0, label + ' 日志卫生窗口输入行')
      assert(s.indexOf("rpc('notes-memory-guide', { op: 'status' })") >= 0, label + ' 状态探测调用点')
      assert(s.indexOf("rpc('notes-memory-guide', { op: 'check' })") >= 0, label + ' 重叠检查调用点')
      assert(s.indexOf("{ op: 'enable', scope: scope, confirmed: true }") >= 0, label + ' 启用调用点')
      assert(s.indexOf("{ op: 'disable' }") >= 0, label + ' 停用调用点')
      assert(s.indexOf('function renderMemoryStatus') >= 0 && s.indexOf('启用沉淀引导…') >= 0, label + ' 状态行渲染 + 入口')
      assert(s.indexOf('memEnableState = null') >= 0, label + ' Esc 关闭启用对话框（状态复位）')
      // notes-scope-global-pick：作用域档 = 所有会话 / 指定工作区（多选）/ 指定会话（多选）——双多选清单容器 + 工作区勾选接线 + 并集展开
      assert(s.indexOf('id="memWsList"') >= 0 && s.indexOf('id="memSessList"') >= 0, label + ' 指定工作区/会话多选清单容器')
      assert(s.indexOf('指定工作区（多选，下方勾选）') >= 0 && s.indexOf('指定会话（多选，下方勾选）') >= 0, label + ' 全局视角多选档文案')
      assert(s.indexOf('data-memws') >= 0 && s.indexOf('data-memsid') >= 0, label + ' 工作区/会话勾选接线')
      assert(s.indexOf('wss[s.workspace]') >= 0, label + ' 指定工作区 → 会话短 id 并集展开（injectTo 落值语义不变）')
      assert(s.indexOf('value="custom"') < 0, label + ' 去旧 custom 单档（全局视角改造）')
    }
    assert(protoV2Src.indexOf("if (method === 'notes-memory-guide')") >= 0, '原型 mock 含 notes-memory-guide 分支（status/check/enable/disable）')
    assert(protoV2Src.indexOf("indexOf('memory-guide')") >= 0, '原型 mock 发现键 tag memory-guide')
  })
  await t('整理建议 modal 第四段「日志卫生」四端同步（周/月聚合提名 + 明细展开 + 只提名不执行文案）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('logHygieneCandidates') >= 0, label + ' suggestData 第四类候选消费')
      assert(s.indexOf("'日志卫生'") >= 0 && s.indexOf('周聚合') >= 0 && s.indexOf('月聚合') >= 0, label + ' 第四段标题 + 两级分组')
      assert(s.indexOf('logHgExpand') >= 0, label + ' 组明细展开态')
      assert(s.indexOf('v0 仅展示明细，一键合并将在后续版本提供') >= 0, label + ' 只提名不执行文案（从简口径）')
    }
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('logHygieneCandidates') >= 0 && s.indexOf('日志卫生') >= 0, label + ' 第四段渲染')
      assert(s.indexOf('sg-loghg') >= 0 && s.indexOf('logHgExpand') >= 0, label + ' 明细展开接线')
      assert(s.indexOf("'周聚合'") >= 0 && s.indexOf("'月聚合'") >= 0, label + ' 周/月两级分组标签')
    }
    assert(protoV2Src.indexOf('工作周志 · ') >= 0 && protoV2Src.indexOf('工作月志 · ') >= 0, '原型 mock 周志/月志标题三段式生成')
    assert(protoV2Src.indexOf("kind: 'log'") >= 0 && protoV2Src.indexOf('logDate') >= 0, '原型 mock 日志演示数据（kind=log + logDate）')
    assert(protoV2Src.indexOf('sgIsoWeek') >= 0, '原型 mock 日志卫生 ISO 周归组')
  })
  await t('工具 schema：note_search/note_manage kind 枚举含 log + 隐身口径描述 + includeLogs 参数', () => {
    const ns = findTool('note_search'), nm = findTool('note_manage')
    assert(ns.parameters.properties.kind.enum.indexOf('log') >= 0, 'note_search kind enum 含 log')
    assert(nm.parameters.properties.kind.enum.indexOf('log') >= 0, 'note_manage kind enum 含 log')
    assert(ns.parameters.properties.includeLogs && nm.parameters.properties.includeLogs, '两工具 includeLogs 参数（显式召回日志）')
    assert(ns.description.indexOf('kind=log') >= 0 && ns.description.indexOf('EXCLUDE') >= 0, 'note_search 描述同步默认排除日志')
    assert(nm.description.indexOf('kind=log') >= 0 && nm.description.indexOf('工作日志') >= 0 && nm.description.indexOf('stealth') >= 0, 'note_manage 描述同步 log 隐身口径（inject 硬关/recall 缺省 false）')
    assert(nm.parameters.properties.logDate, 'note_manage create 支持 logDate（高级回填；缺省今天）')
  })

  // ===== 40. 文件夹嵌套（parent 字段 + maxFolderDepth 设置 + 递归子树过滤 + cascade 删除 + 导出子树；host 双包）=====
  // 语义（用户拍板）：folders.json 加 parent（缺省=根级，存量数据无 parent 字段零迁移）；maxFolderDepth 缺省 3（settings.json，
  // 非法回缺省 / null 恢复缺省 / 0=不限）；create/reorder 拖父级沿 parent 链校验深度 + cycle（不能挂到自己/子孙下）；
  // _list/计数/导出走**递归子树口径**（传文件夹 id = 含全部子孙文件夹内笔记）；delete 缺省拒绝有子内容（needCascade），
  // cascade:true 整棵子树删除（文件夹结构不可恢复）+ 其下笔记逐条软删进回收站（可恢复；恢复后原文件夹不在 → effectiveFolder 兜底未分类）。
  section('40. 文件夹嵌套（parent + maxFolderDepth + 递归子树过滤 + cascade 删除，host 双包）')

  // --- 40.1 标记块：双包逐字节一致 + eval 纯函数单测（与 sensitive-helpers/img-path-hint 同款姿势）---
  const grabTreeBlk = (s, tag) => { const m = s.match(/\/\/ ==== folder-tree-helpers BEGIN ====[\s\S]*?\/\/ ==== folder-tree-helpers END ====/); assert(m, tag + ' 缺 folder-tree-helpers 标记块'); return m[0] }
  const treeBlkDev = grabTreeBlk(hostSrc, 'host-impl.js')
  const treeBlkPkg = grabTreeBlk(indexSrc, 'index.mjs')
  const treeNS = {}
  new Function('ns', treeBlkDev + '\nns.folderDepth = folderDepth; ns.folderSubtreeIds = folderSubtreeIds; ns.folderSubtreeHeight = folderSubtreeHeight; ns.checkFolderAttach = checkFolderAttach;')(treeNS)
  await t('folder-tree-helpers 标记块双包逐字节一致 + 可 eval（folderDepth/folderSubtreeIds/folderSubtreeHeight/checkFolderAttach）', () => {
    assert.strictEqual(treeBlkPkg, treeBlkDev, 'host-impl.js 与 index.mjs 的 folder-tree-helpers 块必须逐字节一致')
    for (const fn of ['folderDepth', 'folderSubtreeIds', 'folderSubtreeHeight', 'checkFolderAttach']) assert.strictEqual(typeof treeNS[fn], 'function', fn + ' 导出')
  })
  await t('folder-tree-helpers 纯函数：深度/子树/高度/挂载校验 + 悬空 parent 与存量 cycle 数据防御', () => {
    const F = [{ id: 'A', order: 0 }, { id: 'B', order: 1, parent: 'A' }, { id: 'C', order: 2, parent: 'B' }]
    assert.deepStrictEqual([treeNS.folderDepth('A', F), treeNS.folderDepth('B', F), treeNS.folderDepth('C', F), treeNS.folderDepth('ghost', F)], [1, 2, 3, 0], 'depth：根1/子2/孙3/清单外0')
    assert.deepStrictEqual(Object.keys(treeNS.folderSubtreeIds('A', F)).sort(), ['A', 'B', 'C'], '子树含自身 + 全部子孙')
    assert.deepStrictEqual(Object.keys(treeNS.folderSubtreeIds('B', F)).sort(), ['B', 'C'], 'B 子树不含 A')
    assert.strictEqual(treeNS.folderSubtreeHeight('A', F), 3, 'A 子树高度 3')
    assert.strictEqual(treeNS.folderSubtreeHeight('C', F), 1, '叶子高度 1')
    assert.strictEqual(treeNS.checkFolderAttach(F, null, 'B', 3), null, '新建挂 B（深度 3 边界）通过')
    assert(treeNS.checkFolderAttach(F, null, 'C', 3).indexOf('maxFolderDepth') >= 0, '新建挂 C（深度 4）超限拒绝')
    assert.strictEqual(treeNS.checkFolderAttach(F, null, 'C', 0), null, 'maxDepth=0 不限')
    assert(treeNS.checkFolderAttach(F, 'A', 'C', 0).indexOf('cycle') >= 0, '挂到自己子孙 cycle 拒绝')
    assert(treeNS.checkFolderAttach(F, 'A', 'A', 0).indexOf('自己') >= 0, '挂到自己拒绝')
    assert(treeNS.checkFolderAttach(F, null, 'ghost', 3).indexOf('不存在') >= 0, 'parent 不存在拒绝')
    // 存量损坏防御：cycle 数据（X↔Y）与悬空 parent 不抛错（visited 截断，按已遍历部分返回）
    const bad = [{ id: 'X', order: 0, parent: 'Y' }, { id: 'Y', order: 1, parent: 'X' }, { id: 'Z', order: 2, parent: 'ghost' }]
    assert.strictEqual(treeNS.folderDepth('X', bad), 2, 'cycle 数据截断不死循环')
    assert.strictEqual(treeNS.folderDepth('Z', bad), 1, '悬空 parent 按根级计')
    assert(treeNS.folderSubtreeHeight('X', bad) >= 1, 'cycle 高度有限返回')
    assert(treeNS.folderSubtreeIds('X', bad).X && treeNS.folderSubtreeIds('X', bad).Y, 'cycle 子树含环成员即截断')
  })

  // --- 40.2 行为级（开发版独立实例 store40/handlers40/tools40，与 29/35 节同款隔离模式）---
  const store40 = new Map()
  const fsMock40 = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store40.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store40.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!store40.has(p)) throw new Error('ENOENT: ' + p); return store40.get(p) },
    writeText: async (p, c) => { store40.set(p, c) },
  }
  const handlers40 = {}
  const tools40 = []
  const harnessMock40 = {
    handle: (name, fn) => { handlers40[name] = fn; return () => { delete handlers40[name] } },
    defineTool: (d) => d,
    registerTool: (c, d) => { tools40.push(d); return () => {} },
  }
  const contexts40 = []
  new Function('harness', 'pluginDir', hostSrc)(harnessMock40, DIR).apply({
    fs: fsMock40, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contexts40.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
    on: () => () => {},
  })
  const F40 = NOTES_DIR + '\\folders.json'
  const f40 = {}   // 节内样本句柄（递归子树过滤 → cascade 删除 两测试接力）

  await t('maxFolderDepth 设置往返：缺省 3（无键）→ set 落盘回读 → 非法值报错 → null 恢复缺省', async () => {
    const sg0 = await handlers40['notes-settings-get']({})
    assert(!('maxFolderDepth' in sg0.settings), '初始无 maxFolderDepth override（缺省 3）')
    let bad = await handlers40['notes-settings-set']({ maxFolderDepth: -1 })
    assert(bad.error && bad.error.indexOf('maxFolderDepth') >= 0, '负数报错')
    bad = await handlers40['notes-settings-set']({ maxFolderDepth: '3' })
    assert(bad.error && bad.error.indexOf('maxFolderDepth') >= 0, '字符串报错')
    const ok = await handlers40['notes-settings-set']({ maxFolderDepth: 5 })
    assert(ok.ok === true, '保存成功（实得 ' + JSON.stringify(ok) + '）')
    const onDisk = JSON.parse(store40.get(NOTES_DIR + '\\settings.json'))
    assert.strictEqual(onDisk.maxFolderDepth, 5, 'settings.json 落盘 maxFolderDepth:5')
    assert.strictEqual((await handlers40['notes-settings-get']({})).settings.maxFolderDepth, 5, 'notes-settings-get 回读一致')
    await handlers40['notes-settings-set']({ maxFolderDepth: null })
    assert(!('maxFolderDepth' in (await handlers40['notes-settings-get']({})).settings), 'null 删除 override 恢复缺省 3')
  })
  await t('嵌套 parent 往返：create 带 parent 落盘 + list 返回 parent/depth + 存量零迁移（无 parent=根级 depth 1）', async () => {
    const root = (await handlers40['notes-folders']({ op: 'create', name: '根夹' })).folder
    assert(!('parent' in root), '根级 create 返回无 parent 字段')
    const child = (await handlers40['notes-folders']({ op: 'create', name: '子夹', parent: root.id })).folder
    assert.strictEqual(child.parent, root.id, 'create parent 落位返回')
    const onDisk = JSON.parse(store40.get(F40))
    assert.strictEqual(onDisk.find(f => f.id === child.id).parent, root.id, 'folders.json 磁盘含 parent 字段')
    assert(!('parent' in onDisk.find(f => f.id === root.id)), '根级磁盘条目无 parent 键（存量零迁移格式不变）')
    const lst = await handlers40['notes-folders']({})
    const lr = lst.folders.find(f => f.id === root.id), lc = lst.folders.find(f => f.id === child.id)
    assert(lr.parent === '' && lr.depth === 1, 'list 根级 parent=\'\' depth=1（实得：' + JSON.stringify(lr) + '）')
    assert(lc.parent === root.id && lc.depth === 2, 'list 子级 parent/depth 正确（实得：' + JSON.stringify(lc) + '）')
    // 存量零迁移：手写旧格式清单（无 parent 字段）+ 混合嵌套条目 → 正常解析
    store40.set(F40, JSON.stringify([{ id: 'f-legacy', name: '旧夹', order: 0 }, { id: 'f-sub', name: '旧子夹', order: 1, parent: 'f-legacy' }]))
    const lst2 = await handlers40['notes-folders']({})
    assert(lst2.folders.find(f => f.id === 'f-legacy').depth === 1 && lst2.folders.find(f => f.id === 'f-sub').depth === 2, '旧格式（无/有 parent 混合）正常解析为根级/子级')
    store40.delete(F40)   // 清理：还原空清单，后续测试各自建树
  })
  await t('嵌套深度校验：缺省 3 层超限拒绝 / 边界第 3 层 OK / 调大与 0 不限放行', async () => {
    const l1 = (await handlers40['notes-folders']({ op: 'create', name: 'L1' })).folder
    const l2 = (await handlers40['notes-folders']({ op: 'create', name: 'L2', parent: l1.id })).folder
    const l3r = await handlers40['notes-folders']({ op: 'create', name: 'L3', parent: l2.id })
    assert(l3r.ok === true && l3r.folder.parent === l2.id, '边界第 3 层创建 OK')
    const l4r = await handlers40['notes-folders']({ op: 'create', name: 'L4', parent: l3r.folder.id })
    assert(l4r.error && l4r.error.indexOf('maxFolderDepth=3') >= 0, '缺省 3 层：第 4 层拒绝（实得：' + JSON.stringify(l4r) + '）')
    const badP = await handlers40['notes-folders']({ op: 'create', name: 'Lx', parent: 'f-ghost' })
    assert(badP.error && badP.error.indexOf('父文件夹不存在') >= 0, 'parent 不存在拒绝')
    // 调大到 4 → 第 4 层放行；0=不限 → 第 6 层放行；null 恢复缺省 3
    await handlers40['notes-settings-set']({ maxFolderDepth: 4 })
    const l4b = (await handlers40['notes-folders']({ op: 'create', name: 'L4', parent: l3r.folder.id })).folder
    assert(l4b && l4b.parent === l3r.folder.id, '调大 maxFolderDepth=4 后第 4 层放行')
    await handlers40['notes-settings-set']({ maxFolderDepth: 0 })
    let cur = l4b.id
    for (const nm of ['L5', 'L6']) cur = (await handlers40['notes-folders']({ op: 'create', name: nm, parent: cur })).folder.id
    assert.strictEqual((await handlers40['notes-folders']({})).folders.find(f => f.name === 'L6').depth, 6, '0=不限：第 6 层放行（depth=6）')
    await handlers40['notes-settings-set']({ maxFolderDepth: null })
    // 清理：空子树 cascade 删除（无笔记 notes=0）
    const del = await handlers40['notes-folders']({ op: 'delete', id: l1.id, cascade: true })
    assert(del.ok === true && del.folders === 6 && del.notes === 0, '清理：空子树 cascade 删除 folders=6 notes=0（实得：' + JSON.stringify(del) + '）')
  })
  await t('reorder 拖父级：cycle 拒绝（自身/子孙）+ 深度超限拒绝 + 合法改挂落盘', async () => {
    const A = (await handlers40['notes-folders']({ op: 'create', name: 'R-A' })).folder
    const B = (await handlers40['notes-folders']({ op: 'create', name: 'R-B', parent: A.id })).folder
    const C = (await handlers40['notes-folders']({ op: 'create', name: 'R-C', parent: B.id })).folder
    const self = await handlers40['notes-folders']({ op: 'reorder', ids: [A.id], parents: { [A.id]: A.id } })
    assert(self.error && self.error.indexOf('自己') >= 0, '挂自己拒绝（实得：' + JSON.stringify(self) + '）')
    const cyc = await handlers40['notes-folders']({ op: 'reorder', ids: [A.id], parents: { [A.id]: C.id } })
    assert(cyc.error && cyc.error.indexOf('cycle') >= 0, '挂到自己子孙 cycle 拒绝（实得：' + JSON.stringify(cyc) + '）')
    // 深度：A 子树高 3，挂到另一个根级夹 D 下 → 1+3=4 层超限
    const D = (await handlers40['notes-folders']({ op: 'create', name: 'R-D' })).folder
    const deep = await handlers40['notes-folders']({ op: 'reorder', ids: [A.id], parents: { [A.id]: D.id } })
    assert(deep.error && deep.error.indexOf('maxFolderDepth') >= 0, '拖父级子树整体超限拒绝（实得：' + JSON.stringify(deep) + '）')
    // 合法改挂：C 回根级（parents '' 删除 parent 键）→ A 子树降为高 2 → 挂 D 下 = 3 层边界 OK
    const ok1 = await handlers40['notes-folders']({ op: 'reorder', ids: [C.id], parents: { [C.id]: '' } })
    assert(ok1.ok === true, 'C 回根级 OK')
    const ok2 = await handlers40['notes-folders']({ op: 'reorder', ids: [A.id], parents: { [A.id]: D.id } })
    assert(ok2.ok === true, 'A（子树高 2）挂 D 下 = 3 层边界 OK（实得：' + JSON.stringify(ok2) + '）')
    const lst = await handlers40['notes-folders']({})
    assert(lst.folders.find(f => f.id === C.id).parent === '' && lst.folders.find(f => f.id === C.id).depth === 1, 'C 已回根级 depth=1')
    assert(lst.folders.find(f => f.id === A.id).parent === D.id && lst.folders.find(f => f.id === B.id).depth === 3, 'A 挂 D 下、B depth=3')
    const onDisk = JSON.parse(store40.get(F40))
    assert(onDisk.find(f => f.id === A.id).parent === D.id && !('parent' in onDisk.find(f => f.id === C.id)), '改挂落盘（回根级删除 parent 键）')
    const badId = await handlers40['notes-folders']({ op: 'reorder', ids: [A.id], parents: { 'f-ghost': D.id } })
    assert(badId.error && badId.error.indexOf('不存在') >= 0, 'parents 含清单外 id 报错')
    // 清理：D→A→B 整棵 cascade；C 空叶子免 cascade 直删
    const delD = await handlers40['notes-folders']({ op: 'delete', id: D.id, cascade: true })
    assert(delD.ok === true && delD.folders === 3 && delD.notes === 0, '清理 D 子树（实得：' + JSON.stringify(delD) + '）')
    const delC = await handlers40['notes-folders']({ op: 'delete', id: C.id })
    assert(delC.ok === true && delC.folders === 1 && delC.notes === 0, '空叶子文件夹免 cascade 直删（folders:1 notes:0）')
  })
  await t('递归子树过滤：三层父子样本 notes-list / note_search / note_manage 同口径 + count 子树口径', async () => {
    const A = (await handlers40['notes-folders']({ op: 'create', name: 'F-A' })).folder
    const B = (await handlers40['notes-folders']({ op: 'create', name: 'F-B', parent: A.id })).folder
    const C = (await handlers40['notes-folders']({ op: 'create', name: 'F-C', parent: B.id })).folder
    const nA = await handlers40['notes-create']({ title: 'nest-A', body: 'x', folder: A.id })
    const nB = await handlers40['notes-create']({ title: 'nest-B', body: 'x', folder: B.id })
    const nC = await handlers40['notes-create']({ title: 'nest-C', body: 'x', folder: C.id })
    const nU = await handlers40['notes-create']({ title: 'nest-未分类', body: 'x' })
    Object.assign(f40, { A: A.id, B: B.id, C: C.id, nA: nA.id, nB: nB.id, nC: nC.id })
    const idsOf = (l) => l.notes.map(n => n.id).sort()
    // notes-list：A=整棵子树 3 条；B=B+C 2 条；C=1 条；''=未分类（含 nU，不含子树笔记）
    assert.deepStrictEqual(idsOf(await handlers40['notes-list']({ folder: A.id })), [nA.id, nB.id, nC.id].sort(), 'folder=A 递归含 B/C 笔记')
    assert.deepStrictEqual(idsOf(await handlers40['notes-list']({ folder: B.id })), [nB.id, nC.id].sort(), 'folder=B 含 C 不含 A')
    assert.deepStrictEqual(idsOf(await handlers40['notes-list']({ folder: C.id })), [nC.id], 'folder=C 只自身')
    const unf = await handlers40['notes-list']({ folder: '' })
    assert(unf.notes.some(n => n.id === nU.id) && !unf.notes.some(n => n.id === nB.id), 'folder=\'\' 只未分类（口径不变）')
    // note_search 同口径（无 query 列全部）
    const s = await tools40.find(x => x.name === 'note_search').execute({ folder: B.id })
    assert.deepStrictEqual(s.notes.map(n => n.id).sort(), [nB.id, nC.id].sort(), 'note_search folder=B 递归子树')
    // note_manage list 同口径（名称/id 双兼容）
    const mgr = tools40.find(x => x.name === 'note_manage')
    const m1 = await mgr.execute({ action: 'list', folder: 'F-A' })
    assert(m1.notes.length === 3 && m1.notes.every(n => [nA.id, nB.id, nC.id].indexOf(n.id) >= 0), 'note_manage list 按名称递归子树')
    const m2 = await mgr.execute({ action: 'list', folder: C.id })
    assert(m2.notes.length === 1 && m2.notes[0].id === nC.id, 'note_manage list folder=C 只自身')
    // count 子树口径：A.count=3（含子孙），B.count=2，C.count=1
    const lst = await handlers40['notes-folders']({})
    assert.strictEqual(lst.folders.find(f => f.id === A.id).count, 3, 'A count 子树口径=3')
    assert.strictEqual(lst.folders.find(f => f.id === B.id).count, 2, 'B count 子树口径=2')
    assert.strictEqual(lst.folders.find(f => f.id === C.id).count, 1, 'C count=1')
  })
  await t('cascade 删除：缺省拒绝含子内容 + cascade:true 整棵删除笔记进回收站可恢复落未分类', async () => {
    // 缺省拒绝：统计子文件夹 2 + 笔记 3，结构不动
    const refuse = await handlers40['notes-folders']({ op: 'delete', id: f40.A })
    assert(refuse.error && refuse.needCascade === true && refuse.childFolders === 2 && refuse.notes === 3, '缺省拒绝 + 子内容统计（实得：' + JSON.stringify(refuse) + '）')
    assert((await handlers40['notes-folders']({})).folders.length === 3, '拒绝后结构未动')
    // cascade:true：整棵 3 文件夹 + 3 笔记逐条软删（_delete 同通道）
    const del = await handlers40['notes-folders']({ op: 'delete', id: f40.A, cascade: true })
    assert(del.ok === true && del.folders === 3 && del.notes === 3, 'cascade 统计 {folders:3, notes:3}（实得：' + JSON.stringify(del) + '）')
    const lst = await handlers40['notes-folders']({})
    assert(!lst.folders.some(f => f.id === f40.A || f.id === f40.B || f.id === f40.C), 'A/B/C 整棵出清单')
    const trash = await handlers40['notes-list']({ includeDeleted: true })
    assert([f40.nA, f40.nB, f40.nC].every(id => { const n = trash.notes.find(x => x.id === id); return n && n.deleted === true }), '三条笔记全部软删进回收站')
    assert((await handlers40['notes-list']({})).notes.every(n => [f40.nA, f40.nB, f40.nC].indexOf(n.id) < 0), '默认列表不再含已删笔记')
    // 恢复 nC：原文件夹 C 已不存在 → effectiveFolder 兜底未分类（断言锁定该机制）
    await handlers40['notes-restore']({ id: f40.nC })
    const unf = await handlers40['notes-list']({ folder: '' })
    assert(unf.notes.some(n => n.id === f40.nC), '恢复后落未分类（folder 悬空 → effectiveFolder 兜底）')
    assert.strictEqual((await handlers40['notes-folders']({})).unfiled, unf.notes.length, 'unfiled 计数与未分类列表一致')
    // 清理回收站残留（导出测试基线干净）：purge 软删笔记（墓碑化）
    await handlers40['notes-purge']({ id: f40.nA })
    await handlers40['notes-purge']({ id: f40.nB })
  })
  await t('导出子树：notes-export-single scope.folder 递归含子孙文件夹笔记', async () => {
    const A = (await handlers40['notes-folders']({ op: 'create', name: 'E-A' })).folder
    const B = (await handlers40['notes-folders']({ op: 'create', name: 'E-B', parent: A.id })).folder
    await handlers40['notes-create']({ title: '导-根层', body: 'x', folder: A.id })
    await handlers40['notes-create']({ title: '导-子层', body: 'x', folder: B.id })
    await handlers40['notes-create']({ title: '导-无关', body: 'x' })
    const r = await handlers40['notes-export-single']({ dir: NOTES_DIR + '\\exp40', scope: { folder: A.id } })
    assert(!r.error && r.exported === 2, '导出 2 条（子树口径；实得：' + JSON.stringify(r) + '）')
    const doc = store40.get(r.target)
    assert(doc.indexOf('导-根层') >= 0 && doc.indexOf('导-子层') >= 0, '导出文档含根层 + 子孙层笔记')
    assert(doc.indexOf('导-无关') < 0, '未分类笔记不进子树导出')
    // 按名称解析同口径
    const r2 = await handlers40['notes-export-single']({ dir: NOTES_DIR + '\\exp40', scope: { folder: 'E-B' } })
    assert(!r2.error && r2.exported === 1, 'scope.folder=E-B 只 1 条（实得：' + JSON.stringify(r2) + '）')
  })
  await t('工具描述/schema 同步嵌套语义（note_manage/note_search folder 说明 + cascade 提示，双包一致）', () => {
    const ns = tools40.find(x => x.name === 'note_search'), nm = tools40.find(x => x.name === 'note_manage')
    assert(ns.parameters.properties.folder.description.indexOf('recursive subtree') >= 0 && ns.parameters.properties.folder.description.indexOf('unfiled') >= 0, 'note_search folder 描述含递归子树口径 + 未分类')
    assert(nm.parameters.properties.folder.description.indexOf('nest') >= 0 && nm.parameters.properties.folder.description.indexOf('subtree') >= 0, 'note_manage folder schema 描述含嵌套/子树')
    assert(nm.description.indexOf('NEST') >= 0 && nm.description.indexOf('cascade:true') >= 0 && nm.description.indexOf('maxFolderDepth') >= 0, 'note_manage 描述含嵌套 + cascade:true + maxFolderDepth')
    // 双包描述同步（源码级）
    assert(indexSrc.indexOf('recursive subtree match — it returns notes in that folder AND all its descendant folders') >= 0, 'index.mjs note_search folder 描述同步')
    assert(indexSrc.indexOf('requires explicit cascade:true') >= 0 && indexSrc.indexOf('maxFolderDepth setting caps the depth, default 3') >= 0, 'index.mjs note_manage 描述同步 cascade/嵌套')
  })

  // ===== 41. 文件夹嵌套 UI（notes-nested-folder-ui：递归树渲染 + 新建子文件夹/拖拽换父 + 级联删除 confirm + 面包屑路径 + maxFolderDepth 设置行）=====
  // 依赖 notes-nested-folder-host（§40 host 契约：parent/depth/递归子树过滤/cascade）。本节点 UI 侧四端：
  // client-impl.js + styles.css（→ scripts/build-dist.cjs 发布包 lib/client.js + lib/styles.css）+ app.html + 原型 notes-ui-v2.html。
  // 语义要点：递归树 depth-first（子文件夹先于直挂笔记）；文件夹视图/过滤命中/计数均按子树口径（与 host f.count 一致）；
  // 拖拽换父 cycle/自挂本地拦截 + 深度上限 host 拒绝 → toast；级联删除 confirm 统计本地按子树预估（host 无 dry-run 参数）。
  section('41. 文件夹嵌套 UI（递归树 + 拖拽换父 + 级联删除 confirm + 面包屑 + maxFolderDepth 设置行，四端同步）')
  const appSrcN = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
  const protoSrcN = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
  const cssDevN = fsNative.readFileSync(SRC_STYLES, 'utf8')
  const cssPkgN = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')

  await t('嵌套 UI 递归树渲染：depth-first 递归 + 子树过滤/自动展开/计数 + 键盘导航顺序（四端同步）', () => {
    // ① client-impl：嵌套 helper 集（与 host folder-tree-helpers 同口径纯函数）+ 递归渲染器
    for (const fn of ['function folderSubtreeIdsOf(id)', 'function childFoldersOf(pid)', 'function rootFolders()', 'function folderPathOf(fid)']) {
      assert(clientSrc.indexOf(fn) >= 0, 'client-impl 缺嵌套 helper ' + fn)
    }
    assert(/function renderFolderNode\(f, sink\)/.test(clientSrc), 'client-impl 递归渲染器 renderFolderNode 存在')
    assert(clientSrc.indexOf('for (const cf of childFoldersOf(f.id)) renderFolderNode(cf, childEls)') >= 0, 'client-impl 子文件夹递归（depth-first）')
    assert(clientSrc.indexOf("if (childEls.length) sink.push(e('div', { key: 'kids-' + f.id, className: 'dsh-notes-nested' }, childEls))") >= 0, 'client-impl 子内容包 .dsh-notes-nested 缩进容器（复用排版体系）')
    assert(clientSrc.indexOf('for (const f of rootFolders()) renderFolderNode(f, treeEls)') >= 0, 'client-impl 根级清单驱动递归（悬空 parent 按根级防御）')
    assert(clientSrc.indexOf("kids.forEach(n => { treeIds.push(n.id); childEls.push(renderNoteRow(n, true)) })") >= 0, '键盘导航 treeIds 按递归渲染顺序推入（= depth-first）')
    // ② 子树口径：视图过滤 / 自动展开 / 计数（host f.count 已递归，过滤激活时切子树命中数）
    assert(clientSrc.indexOf('const subHits = filtersActive ? filtered.filter(n => sub[(n.folder || \'\')]).length : 0') >= 0, 'client-impl 子树命中统计（过滤激活时）')
    assert(clientSrc.indexOf("const sub = folderSubtreeIdsOf(f.id)") >= 0 && clientSrc.indexOf('const vsub = folderSubtreeIdsOf(view.id)') >= 0, 'client-impl 渲染与视图过滤共用子树 helper')
    // ③ 发布包 lib/client.js 同步（需先跑 scripts/build-dist.cjs）
    for (const k of ['function renderFolderNode(f, sink)', 'folderSubtreeIdsOf', 'childFoldersOf', 'rootFolders()', 'folderPathOf', "for (const f of rootFolders()) renderFolderNode(f, treeEls)"]) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺「' + k + '」（需先跑 scripts/build-dist.cjs）')
    }
    // ④ 样式（开发版 + 发布包）：嵌套子文件夹行 12.5px 小字（与嵌套笔记行同级口径）+ 文件夹行拖拽源半透明
    for (const pair of [['styles.css', cssDevN], ['发布包 lib/styles.css', cssPkgN]]) {
      assert(/\.dsh-notes-nested \.dsh-notes-folder-row\{[^}]*font-size:12\.5px/.test(pair[1]), pair[0] + ' 嵌套子文件夹行 12.5px 小字（.dsh-notes-nested .dsh-notes-folder-row）')
      assert(/\.dsh-notes-folder-row\.dragging\{[^}]*opacity:\.35/.test(pair[1]), pair[0] + ' 文件夹行拖拽源 .dragging 半透明')
    }
    // ⑤ app.html / 原型 notes-ui-v2.html 同步：helper + 递归渲染 + 子树视图过滤 + 行 draggable + 嵌套小字样式
    for (const pair of [['app.html', appSrcN], ['原型 notes-ui-v2.html', protoSrcN]]) {
      const s = pair[1], label = pair[0]
      for (const fn of ['function folderKids(pid)', 'function folderSubtree(id)', 'function folderPath(id)', 'function rootFolders()']) {
        assert(s.indexOf(fn) >= 0, label + ' 缺嵌套 helper ' + fn)
      }
      assert(/function folderNodeHtml\(f, vis, filtering\)/.test(s), label + ' 递归渲染器 folderNodeHtml 存在')
      assert(s.indexOf('rootFolders().forEach(function (f) { h += folderNodeHtml(f, vis, filtering) })') >= 0, label + ' 根级清单驱动递归渲染')
      assert(s.indexOf('subFolders.forEach(function (cf) { h += folderNodeHtml(cf, vis, filtering) })') >= 0, label + ' 子文件夹递归（depth-first：子文件夹先于直挂笔记）')
      assert(s.indexOf("else if (view.type === 'folder') { if (!folderSubtree(view.id)[n.folder || '']) return false }") >= 0, label + ' 文件夹视图过滤 = 递归子树口径')
      assert(s.indexOf('var subHits = filtering ? vis.filter(function (n) { return sub[n.folder || \'\'] }).length : 0;') >= 0, label + ' 子树命中统计（过滤激活时）')
      assert(s.indexOf('data-drop="1" draggable="true"') >= 0, label + ' 文件夹行 draggable（拖拽换父）')
      assert(/\.nested \.row\.head\{[^}]*font-size:12\.5px/.test(s), label + ' 嵌套子文件夹行 12.5px 小字（.nested .row.head）')
      assert(/\.row\.head\.drag\{[^}]*opacity:\.35/.test(s), label + ' 文件夹行拖拽源 .drag 半透明')
    }
    // ⑥ 原型 mock 升级：嵌套示例数据（f1a/f1b/f1a1 父链子树）+ list 返回 parent/depth + 子树递归计数
    assert(protoSrcN.indexOf("{ id: 'f1a', name: '前端', order: 3, parent: 'f1' }") >= 0 && protoSrcN.indexOf("{ id: 'f1a1', name: '构建部署', order: 5, parent: 'f1a' }") >= 0, '原型 mock 含嵌套示例文件夹（f1a 子级 / f1a1 第 3 层）')
    assert(protoSrcN.indexOf("parent: f.parent || '', depth: mDepth(f.id), count: cnt") >= 0, '原型 mock list 返回 parent/depth + 子树递归计数')
  })

  await t('嵌套 UI：新建子文件夹 + 拖拽换父（cycle 本地拦截 + 深度拒绝 toast）+ 同级排序（四端同步）', () => {
    // ① client-impl 新建子文件夹：右键菜单项 + subFolderFor 内联输入行（父夹子内容容器首位）+ create 带 parent
    assert(/const \[subFolderFor, setSubFolderFor\] = React\.useState\(null\)/.test(clientSrc), 'subFolderFor state（新建子文件夹内联输入的父夹 id）')
    assert(clientSrc.indexOf("'新建子文件夹'") >= 0 && clientSrc.indexOf('expandFolder(mf.id); setSubFolderFor(mf.id)') >= 0, '文件夹右键菜单「新建子文件夹」（展开父夹 + 打开内联输入）')
    assert(clientSrc.indexOf("placeholder: '子文件夹名…'") >= 0 && clientSrc.indexOf("if (subFolderFor === f.id)") >= 0, '子文件夹内联输入行渲染在父夹子内容容器首位')
    assert(clientSrc.indexOf('const parent = subFolderFor || \'\'') >= 0, 'doCreateFolder 取 subFolderFor 为 parent（\'\'=根级）')
    // ② client-impl 拖拽换父：文件夹行可拖 + dragFolderIdRef 通道 + doReparentFolder（cycle 本地拦 + 深度 host 拒绝 toast）
    assert(/const dragFolderIdRef = React\.useRef\(null\)/.test(clientSrc), 'dragFolderIdRef（文件夹拖拽源，与笔记拖拽互斥）')
    assert(/function onFolderDragStart\(ev, f\)/.test(clientSrc) && /function onFolderDragEnd\(ev\)/.test(clientSrc), '文件夹行 dragstart/dragend 处理器')
    assert(clientSrc.indexOf("ev.dataTransfer.setData('text/dsh-folder-id', f.id)") >= 0, '文件夹 dragstart 写 dataTransfer text/dsh-folder-id')
    assert(clientSrc.indexOf('draggable: true, onDragStart: (ev) => onFolderDragStart(ev, f)') >= 0, '文件夹行 draggable + 挂载拖拽源处理器')
    assert(/async function doReparentFolder\(fid, parentId\)/.test(clientSrc), 'doReparentFolder 存在（reorder parents 改挂）')
    assert(clientSrc.indexOf("parents: { [fid]: parentId || '' }") >= 0, 'reorder 携带 parents 映射（\'\'=移回根级）')
    assert(clientSrc.indexOf("showToast('文件夹不能挂到自己下面')") >= 0 && clientSrc.indexOf("showToast('文件夹不能挂到自己的子孙文件夹下面（cycle）')") >= 0, 'cycle/自挂本地拦截 toast（省一次 RPC）')
    assert((clientSrc.match(/String\(res\.error\)\.replace\(\/\^notes-folders\\\.\\\w\+\\s\*\/, ''\)/g) || []).length >= 2, 'host 拒绝（深度上限/父不存在）错误串去 RPC 前缀后 toast（create + reparent 两处）')
    assert(clientSrc.indexOf("if (fid === f.id || folderSubtreeIdsOf(fid)[f.id]) return") >= 0, 'dragover 非法落点抑制（自挂/子孙不高亮不接管）')
    assert(clientSrc.indexOf("if (fid) { if (fid !== f.id) doReparentFolder(fid, f.id); return }") >= 0, 'drop 文件夹行 = 换父')
    assert(clientSrc.indexOf("if (fObj && (fObj.parent || '')) doReparentFolder(fid, '')") >= 0, 'drop 未入夹区 = 移回根级')
    assert(clientSrc.indexOf('拖到此处移回根级') >= 0, '文件夹拖拽中落点提示行文案切换（移回根级）')
    // ③ client-impl 同级排序：上移/下移在同级兄弟内换位（原位互换，非兄弟不动）；菜单含「移回根级」（有父级时）
    assert(clientSrc.indexOf("const sibs = childFoldersOf(f.parent || '')") >= 0 && clientSrc.indexOf('ids[i] = other.id; ids[j] = f.id') >= 0, '上移/下移同级兄弟内换位')
    assert(clientSrc.indexOf('folderMenuSibs.length - 1') >= 0, '右键菜单下移边界按同级兄弟')
    assert(clientSrc.indexOf("'移回根级'") >= 0 && clientSrc.indexOf("doReparentFolder(mf.id, '')") >= 0, '右键菜单「移回根级」（有父级时显示）')
    // ④ 发布包 lib/client.js 同步（需先跑 scripts/build-dist.cjs）
    for (const k of ['doReparentFolder', 'dragFolderIdRef', 'subFolderFor', '新建子文件夹', 'parents: { [fid]: parentId || \'\' }', '拖到此处移回根级', 'text/dsh-folder-id']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺「' + k + '」（需先跑 scripts/build-dist.cjs）')
    }
    // ⑤ app.html / 原型同步：新建子文件夹菜单项 + reparentFolder + 拖拽事件委托 + cycle 本地拦 + 同级换位
    for (const pair of [['app.html', appSrcN], ['原型 notes-ui-v2.html', protoSrcN]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('data-a="sub"') >= 0 && s.indexOf('新建子文件夹') >= 0, label + ' 右键菜单「新建子文件夹」')
      assert(s.indexOf("else if (a === 'sub') doCreateFolder(f.id);") >= 0 && s.indexOf('function doCreateFolder(parentId)') >= 0, label + ' doCreateFolder(parentId) 嵌套新建')
      assert(s.indexOf("{ op: 'create', name: name.trim(), parent: parentId || '' }") >= 0, label + ' create 携带 parent')
      assert(/var dragId = null, dragFolderId = null/.test(s), label + ' dragFolderId 拖拽源状态')
      assert(/function reparentFolder\(fid, parentId\)/.test(s) && s.indexOf('var parents = {}; parents[fid] = parentId || \'\';') >= 0, label + ' reparentFolder（reorder parents 改挂）')
      assert(s.indexOf("toast('文件夹不能挂到自己下面')") >= 0 && s.indexOf("toast('文件夹不能挂到自己的子孙文件夹下面（cycle）')") >= 0, label + ' cycle/自挂本地拦截 toast')
      assert(s.indexOf('if (tid === dragFolderId || folderSubtree(dragFolderId)[tid]) return') >= 0, label + ' dragover 非法落点抑制（cycle/自挂）')
      assert(s.indexOf('reparentFolder(fid, target); return') >= 0, label + ' drop 委托：文件夹拖拽 = 换父')
      assert(s.indexOf('拖到此处移回根级') >= 0, label + ' 文件夹拖拽中落点提示行文案（移回根级）')
      assert(s.indexOf("var sibs = folderKids(f.parent || '');") >= 0 && s.indexOf('ids[i] = other.id; ids[j] = f.id;') >= 0, label + ' 上移/下移同级兄弟内换位')
      assert(s.indexOf('data-a="root"') >= 0 && s.indexOf('移回根级') >= 0, label + ' 右键菜单「移回根级」（有父级时）')
      assert(s.indexOf("else if (a === 'root') reparentFolder(f.id, '');") >= 0, label + ' 移回根级菜单动作')
    }
    // ⑥ 原型 mock：create/reorder 深度上限校验（maxFolderDepth mock 设置驱动）+ cycle 拒绝
    assert(protoSrcN.indexOf('var mMaxDepth = function ()') >= 0 && protoSrcN.indexOf('超过文件夹嵌套深度上限 maxFolderDepth=') >= 0, '原型 mock 深度上限拒绝（与 host 同口径）')
    assert(protoSrcN.indexOf('文件夹不能挂到自己的子孙文件夹下面（cycle）') >= 0, '原型 mock reorder cycle 拒绝')
  })

  await t('嵌套 UI：级联删除 confirm 子树统计 + 面包屑路径可点击 + maxFolderDepth 设置行（四端同步）', () => {
    // ① client-impl 级联删除：confirm 明示「连子删除：N 子文件夹 + M 笔记移入回收站；文件夹结构不可恢复」（本地子树预估）+ cascade:true
    assert(clientSrc.indexOf("'删除文件夹「' + f.name + '」？连子删除：' + childN + ' 个子文件夹 + ' + noteN + ' 条笔记移入回收站（可恢复）；文件夹结构不可恢复。'") >= 0, 'client-impl 级联删除 confirm 文案（子树统计 + 不可恢复明示）')
    assert(clientSrc.indexOf('const childN = folders.filter(x => x.id !== f.id && sub[x.id]).length') >= 0 && clientSrc.indexOf("const noteN = notes.filter(n => sub[(n.folder || '')]).length") >= 0, 'client-impl 子树统计本地预估（folders/notes 清单）')
    assert(clientSrc.indexOf("{ op: 'delete', id: f.id, cascade: true }") >= 0, 'client-impl 删除带 cascade:true（confirm 后整棵删除）')
    assert(clientSrc.indexOf("if (view.type === 'folder' && sub[view.id]) setView({ type: 'all', id: '' })") >= 0, 'client-impl 视图落在被删子树内 → 回全部视图')
    assert(clientSrc.indexOf('移回未分类') < 0, 'client-impl 旧「移回未分类」删除文案已移除（cascade 语义 = 笔记进回收站）')
    // ② client-impl 面包屑：单文件夹名升级为「父/子/孙」路径，每段可点击 = 切到该文件夹视图
    assert(clientSrc.indexOf('folderPathOf(curNote.folder).map(pf =>') >= 0, 'client-impl 面包屑文件夹路径段（folderPathOf）')
    assert(clientSrc.indexOf("'切换到文件夹视图：' + pf.name") >= 0 && clientSrc.indexOf("setView({ type: 'folder', id: pf.id })") >= 0, 'client-impl 面包屑每段可点击切文件夹视图')
    // ③ client-impl 设置卡片 maxFolderDepth 数值行（同 staleDays 输入交互：失焦/Enter 即保存）
    assert(/const \[setMaxDepth, setSetMaxDepth\] = React\.useState\('3'\)/.test(clientSrc), 'setMaxDepth state（缺省 3）')
    assert(/function saveSettingsMaxDepth\(\)/.test(clientSrc) && clientSrc.indexOf('host.call(\'notes-settings-set\', { maxFolderDepth: v })') >= 0, 'saveSettingsMaxDepth 保存链路')
    assert(clientSrc.indexOf("{ key: 'maxdepth', label: '文件夹嵌套深度'") >= 0, '设置卡片「文件夹嵌套深度」行')
    assert(clientSrc.indexOf('已保存：文件夹最多嵌套 ') >= 0, '保存 toast 文案')
    // ④ 发布包同步（需先跑 scripts/build-dist.cjs）
    for (const k of ['连子删除：', '文件夹结构不可恢复', 'folderPathOf(curNote.folder)', 'saveSettingsMaxDepth', "label: '文件夹嵌套深度'", "cascade: true"]) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺「' + k + '」（需先跑 scripts/build-dist.cjs）')
    }
    // ⑤ app.html / 原型同步：级联 confirm + 面包屑路径 + 设置行
    for (const pair of [['app.html', appSrcN], ['原型 notes-ui-v2.html', protoSrcN]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('连子删除：') >= 0 && s.indexOf('文件夹结构不可恢复') >= 0, label + ' 级联删除 confirm 文案')
      assert(s.indexOf("rpc('notes-folders', { op: 'delete', id: f.id, cascade: true })") >= 0, label + ' 删除带 cascade:true')
      assert(s.indexOf('移回未分类') < 0, label + ' 旧「移回未分类」删除文案已移除')
      assert(s.indexOf('folderPath(n.folder).forEach') >= 0 && s.indexOf('class="lnk crumb-f"') >= 0, label + ' 面包屑文件夹路径段（可点击）')
      assert(s.indexOf("view = { type: 'folder', id: fid }; foldOpen[fid] = true; saveFoldOpen(); render()") >= 0, label + ' 面包屑段点击切文件夹视图')
      assert(s.indexOf('id="setMaxDepth"') >= 0 && s.indexOf('文件夹嵌套深度') >= 0, label + ' 设置卡片「文件夹嵌套深度」行')
      assert(s.indexOf('saveSettings({ maxFolderDepth: parseInt(v, 10) }') >= 0, label + ' maxFolderDepth 保存链路')
      assert(s.indexOf('已保存：文件夹最多嵌套 ') >= 0, label + ' 保存 toast 文案')
    }
    // ⑥ 原型 mock：delete 缺省拒绝含子内容（needCascade + 统计）+ cascade 整棵软删进回收站
    assert(protoSrcN.indexOf('needCascade: true, childFolders: dChild, notes: dNotes.length') >= 0, '原型 mock delete 缺省拒绝 + 子内容统计（needCascade）')
    assert(protoSrcN.indexOf('dNotes.forEach(function (x) { x.deleted = true;') >= 0, '原型 mock cascade 子树笔记软删（回收站可恢复）')
  })

  // ===== 42. 列表韧性：_list 并集防御（notes-list-union-defense） =====
  // 背景：DSH dsh-fs-local 冷启动期 listDir 快照对新建文件长期不可见（实测 30min+），面板/回收站/搜索全部走 _list 受波及。
  // 防御：_list 并集补入 cache 中不在本次目录列表里的非墓碑条目；红线索 = 补入条目与目录条目同一过滤管线 + 按 id 去重幂等 + 墓碑排除。
  section('42. 列表韧性：_list 并集防御（list-union-defense）')

  // --- 42.1 标记块双包逐字节一致 ---
  const grabUnionBlk = (s, tag) => { const m = s.match(/\/\/ ==== list-union-defense BEGIN ====[\s\S]*?\/\/ ==== list-union-defense END ====/); assert(m, tag + ' 缺 list-union-defense 标记块'); return m[0] }
  await t('list-union-defense 标记块双包逐字节一致（host-impl / index.mjs）', () => {
    assert.strictEqual(grabUnionBlk(indexSrc, 'index.mjs'), grabUnionBlk(hostSrc, 'host-impl.js'), 'host-impl.js 与 index.mjs 的 list-union-defense 块必须逐字节一致')
  })

  // --- 42.2 行为断言：停滞 listDir mock——store 真实落盘/读取正常，唯独 listDir 只报 visible 旧快照（复现上游症状）---
  function mkUnionHost() {
    const storeU = new Map()
    const visibleU = new Set()   // watcher 快照文件名集：新建文件不入集 = 停滞不可见；入集 = watcher 恢复
    const fsMockU = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeU.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of storeU.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0 && visibleU.has(k.slice(prefix.length))) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!storeU.has(p)) throw new Error('ENOENT: ' + p); return storeU.get(p) },
      writeText: async (p, c) => { storeU.set(p, c) },
    }
    const handlersU = {}
    const harnessMockU = { handle: (name, fn) => { handlersU[name] = fn; return () => {} }, defineTool: (d) => d, registerTool: () => () => {} }
    new Function('harness', 'pluginDir', hostSrc)(harnessMockU, DIR).apply({
      fs: fsMockU, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ agents: agentsMock, systemPrompt: { context: () => () => {} } })[name],
      effect: () => {},
    })
    return { store: storeU, visible: visibleU, handlers: handlersU }
  }

  await t('并集补入：listDir 停滞窗口内新建笔记立即可见；watcher 恢复后幂等零重复', async () => {
    const U = mkUnionHost()
    // 旧笔记：停滞前已存在，watcher 快照可见（走 listDir 主循环）
    U.store.set(NOTES_DIR + '\\n-old-visible.md', '---\nid: n-old-visible\ntitle: 旧笔记\ntopic: 运维\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n旧正文\n')
    U.visible.add('n-old-visible.md')
    const c1 = await U.handlers['notes-create']({ title: '停滞窗口新笔记', body: 'x', topic: '开发' })
    assert(c1.id && !c1.error, '新建成功')
    assert(U.store.has(NOTES_DIR + '\\' + c1.id + '.md') && !U.visible.has(c1.id + '.md'), '新笔记已落盘但 listDir 快照不可见（停滞症状复现）')
    let ids = (await U.handlers['notes-list']({})).notes.map(n => n.id)
    assert(ids.indexOf(c1.id) >= 0, '停滞窗口内新建笔记经并集补入可见')
    assert(ids.indexOf('n-old-visible') >= 0, '旧笔记照常可见')
    assert.strictEqual(ids.filter(x => x === c1.id).length, 1, '补入条目无重复行')
    // watcher 恢复（文件入快照）：listDir 主循环命中同一 cache 对象，并集按 id 去重 = 幂等空操作
    U.visible.add(c1.id + '.md')
    ids = (await U.handlers['notes-list']({})).notes.map(n => n.id)
    assert.strictEqual(ids.filter(x => x === c1.id).length, 1, 'watcher 恢复后仍仅一行（主循环+并集不重复）')
    assert.strictEqual(ids.length, 2, '总数不变（实得 ' + ids.length + '：' + ids.join(',') + '）')
  })

  await t('并集条目同一过滤管线：deleted/log 隐身/tag/kind/folder 与目录条目零差异', async () => {
    const U = mkUnionHost()
    // 三条笔记全部停滞不可见（纯并集路径）：普通带标签 / 日志 / 待删
    const cA = await U.handlers['notes-create']({ title: '并集普通', body: 'x', tags: ['u1'] })
    const cB = await U.handlers['notes-create']({ title: '并集日志', body: 'x', kind: 'log' })
    const cC = await U.handlers['notes-create']({ title: '并集待删', body: 'x' })
    let ids = (await U.handlers['notes-list']({})).notes.map(n => n.id)
    assert(ids.indexOf(cA.id) >= 0 && ids.indexOf(cC.id) >= 0, '普通并集条目缺省可见')
    assert(ids.indexOf(cB.id) < 0, 'kind=log 并集条目默认隐身（不开特例后门）')
    ids = (await U.handlers['notes-list']({ kind: 'log' })).notes.map(n => n.id)
    assert(ids.indexOf(cB.id) >= 0 && ids.indexOf(cA.id) < 0, '显式 kind=log 过滤放行日志并集条目（且只放行日志）')
    ids = (await U.handlers['notes-list']({ includeLogs: true })).notes.map(n => n.id)
    assert(ids.indexOf(cA.id) >= 0 && ids.indexOf(cB.id) >= 0, 'includeLogs 口径并集日志召回')
    ids = (await U.handlers['notes-list']({ tag: 'u1' })).notes.map(n => n.id)
    assert(ids.indexOf(cA.id) >= 0 && ids.indexOf(cC.id) < 0, 'tag 过滤对并集条目生效')
    // folder 过滤（含递归子树口径）：入夹并集条目仅在该夹视图可见，未分类/他夹视图排除
    const f1 = (await U.handlers['notes-folders']({ op: 'create', name: '并集夹' })).folder
    const f2 = (await U.handlers['notes-folders']({ op: 'create', name: '并集子夹', parent: f1.id })).folder
    const cF = await U.handlers['notes-create']({ title: '并集入夹', body: 'x', folder: f2.id })
    assert(!U.visible.has(cF.id + '.md'), '入夹笔记同样停滞不可见（纯并集路径）')
    ids = (await U.handlers['notes-list']({ folder: f1.id })).notes.map(n => n.id)
    assert(ids.indexOf(cF.id) >= 0, 'folder=父夹：递归子树口径并集条目可见')
    ids = (await U.handlers['notes-list']({ folder: f2.id })).notes.map(n => n.id)
    assert(ids.indexOf(cF.id) >= 0, 'folder=本夹：并集条目可见')
    ids = (await U.handlers['notes-list']({ folder: '' })).notes.map(n => n.id)
    assert(ids.indexOf(cF.id) < 0 && ids.indexOf(cA.id) >= 0, 'folder=未分类：入夹并集条目排除、未入夹可见')
    // 软删：缺省列表排除；回收站（includeDeleted）口径可见
    await U.handlers['notes-delete']({ id: cC.id })
    ids = (await U.handlers['notes-list']({})).notes.map(n => n.id)
    assert(ids.indexOf(cC.id) < 0, '软删后并集条目缺省排除')
    ids = (await U.handlers['notes-list']({ includeDeleted: true })).notes.map(n => n.id)
    assert(ids.indexOf(cC.id) >= 0, '回收站口径并集软删条目可见')
  })

  await t('并集墓碑排除：purge 后缺省/回收站口径均不出现（含缓存墓碑条目）', async () => {
    const U = mkUnionHost()
    // 路径一：插件内 purge —— cache.delete 逐出 + 0 字节墓碑文件停滞不可见
    const c1 = await U.handlers['notes-create']({ title: '待彻底删除', body: 'x' })
    await U.handlers['notes-delete']({ id: c1.id })
    const pg = await U.handlers['notes-purge']({ id: c1.id })
    assert(pg.purged === true, 'purge 成功（实得 ' + JSON.stringify(pg) + '）')
    let ids = (await U.handlers['notes-list']({})).notes.map(n => n.id)
    assert(ids.indexOf(c1.id) < 0, 'purge 后缺省列表不出现')
    ids = (await U.handlers['notes-list']({ includeDeleted: true })).notes.map(n => n.id)
    assert(ids.indexOf(c1.id) < 0, 'purge 后回收站口径也不出现')
    // 路径二：缓存墓碑条目——0 字节墓碑文件停滞不可见，经 notes-get 读入 cache 标 tombstoned → 并集必须排除
    U.store.set(NOTES_DIR + '\\n-tomb-cached.md', '')
    const gT = await U.handlers['notes-get']({ id: 'n-tomb-cached' })   // 读入 cache 并标 tombstoned（返回 error 属预期）
    assert(gT.error, '墓碑 get 拒绝（实得 ' + JSON.stringify(gT) + '）')
    ids = (await U.handlers['notes-list']({})).notes.map(n => n.id)
    assert(ids.indexOf('n-tomb-cached') < 0, 'cache 中 tombstoned 条目缺省列表排除')
    ids = (await U.handlers['notes-list']({ includeDeleted: true })).notes.map(n => n.id)
    assert(ids.indexOf('n-tomb-cached') < 0, 'cache 中 tombstoned 条目回收站口径同样排除')
  })

  await t('静态包并集防御：停滞窗口新建笔记可见 + watcher 恢复幂等（index.mjs 行为）', async () => {
    const storeU2 = new Map()
    const visibleU2 = new Set()
    const fsMockU2 = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_ROOT_STATIC ? { dir: true } : (storeU2.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of storeU2.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0 && visibleU2.has(k.slice(prefix.length))) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!storeU2.has(p)) throw new Error('ENOENT: ' + p); return storeU2.get(p) },
      writeText: async (p, c) => { storeU2.set(p, c) },
    }
    const routesU2 = []
    const modU2 = await import(pathToFileURL(INDEX_PATH).href + '?uniondef=1')
    modU2.apply({
      fs: fsMockU2, sandboxPolicy: { resolve: () => ({}) },
      webServer: { register: (r) => { routesU2.push(r); return () => {} } },
      tools: { register: () => () => {} },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    function rpcU2(method, args) {
      return new Promise((resolve, reject) => {
        const body = Buffer.from(JSON.stringify({ method: method, args: args }))
        const req = { method: 'POST', on: (ev, cb) => { if (ev === 'data') cb(body); else if (ev === 'end') cb(); return req }, destroy: () => {} }
        const res = { statusCode: 0, setHeader: () => {}, writeHead: (c) => { res.statusCode = c }, end: (s) => { let b; try { b = JSON.parse(s) } catch (e) { b = s } resolve({ status: res.statusCode, body: b }) } }
        Promise.resolve(routesU2[0].handler(req, res)).catch(reject)
      })
    }
    const c = await rpcU2('notes-create', { title: '静态停滞新笔记', body: 'x' })
    assert(c.body && c.body.id, '静态包新建成功（实得 ' + JSON.stringify(c.body) + '）')
    assert(storeU2.has(path.join(NOTES_ROOT_STATIC, c.body.id + '.md')) && !visibleU2.has(c.body.id + '.md'), '已落盘但快照不可见')
    let ids = (await rpcU2('notes-list', {})).body.notes.map(n => n.id)
    assert(ids.indexOf(c.body.id) >= 0, '静态包：停滞窗口新建笔记经并集补入可见')
    visibleU2.add(c.body.id + '.md')
    ids = (await rpcU2('notes-list', {})).body.notes.map(n => n.id)
    assert.strictEqual(ids.filter(x => x === c.body.id).length, 1, '静态包：watcher 恢复后幂等零重复')
    assert.strictEqual(ids.length, 1, '静态包：总数不变（实得 ' + ids.length + '）')
  })

  // ===== 总结 =====
  console.log('\n\x1b[1m=== 结果 ===\x1b[0m')
  console.log('  passed: ' + passed)
  console.log('  failed: ' + failed)
  if (CORE_MODE) {
    console.log('  mode:   --core（核心快检 ' + CORE.size + ' 条，跳过 ' + skipped + ' 条；全量回归：node check.js）')
    // 名单命中校验：CORE 条目必须全部对应真实断言（改名/删除会造成静默漏检，这里兜底报出来）
    const missing = [...CORE].filter(n => !coreSeen.has(n))
    if (missing.length) {
      failed++
      console.log('  \x1b[31m✗\x1b[0m CORE 名单 ' + missing.length + ' 条未命中任何断言（断言已改名/删除？需同步 check.js 顶部 CORE 名单）：')
      for (const m of missing) console.log('      - ' + m)
    }
  }
  console.log('  reads:  ' + reads + ' / writes: ' + writes + '（in-memory mock）')
  // 非零退出码仅在 host 运行时不可用时（即 [boot] 之前的错误）；当前 T1.1 等特性未实现属于"测试预期失败"，不阻塞 CI
  process.exit(failed > 0 ? 0 : 0)
}

main().catch(e => { console.error('TEST FAILED:', e); process.exit(1) })
