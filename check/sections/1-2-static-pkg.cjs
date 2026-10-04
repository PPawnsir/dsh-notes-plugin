// 节 1.2 P2 静态包 host（packages/dsh-notes/index.mjs）静态校验
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "1.2",
  title: "1.2 P2 静态包 host（packages/dsh-notes/index.mjs）静态校验",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { ctx, plugin } = S
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
  await t('index.mjs 是 scripts/concat-host.cjs 的产物且可复现（src/host/** 按 manifest.dist.js 逐字节拼接）', () => {
    // architecture-modular.md §8.4.1 发布版出口：index.mjs 由 src/host/** 按 manifest.dist.js 逐字节拼接生成
    // （build-dist.cjs 写盘提交，本断言读产物兜底防忘跑——对照节 24 app.html 先例）
    const { concatHostDist } = require(path.join(DIR, 'scripts', 'concat-host.cjs'))
    assert.strictEqual(concatHostDist(), indexSrc.replace(/\r\n/g, '\n'), 'index.mjs 与 src/host/** 拼接产物不一致（改 src/host/** 后需跑 node scripts/build-dist.cjs）')
  })
  }
}
