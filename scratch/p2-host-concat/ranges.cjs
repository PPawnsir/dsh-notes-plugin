// P2·1 技术验证：host 侧「加载时拼接」锚点清单（design/architecture-modular.md §8）
// 每个条目 = [模块文件相对路径, 起始行锚点（行首前缀精确匹配）]；anchor=null 表示第 1 行。
// 锚点全部取自现行源码的行首文本，gen-parts.cjs 顺序解析（从上一切点向后找首个匹配行），
// 解析失败（锚点漂移）直接 throw——这本身就是「切分清单可机械定位」的证据。
'use strict'

// 开发版：src/host-impl.js（3376 行）→ 26 片
const host = {
  name: 'host-impl（开发版沙箱拼接）',
  source: 'src/host-impl.js',
  outDir: 'out/src-host',
  rangesOut: 'out/ranges-host.json',
  parts: [
    ['kernel/head.js', null],
    ['kernel/format.js', '    function genId()'],
    ['inject/sensitive-helpers.js', '    // ==== sensitive-helpers BEGIN ===='],
    ['notes/front-matter.js', '    function buildFM(m)'],
    ['kernel/session-ctx.js', '    function sessCtx()'],
    ['settings/store.js', '    // ---- 设置持久化（SETTINGS_PATH）'],
    ['llm/usage-classify.js', '    // ==== llm-usage BEGIN ===='],
    ['notes/store-cache.js', '    // ---- 缓存层：解析结果按 id 常驻内存'],
    ['history-trash/engine.js', '    // ==== history-engine BEGIN ===='],
    ['notes/persist.js', '    async function persistNote(n, opts)'],
    ['folders/tree.js', '    // ---- 虚拟文件夹：'],
    ['notes/create-list.js', '    async function _create('],
    ['notes/get-update.js', '    async function _get(id)'],
    ['notes/quick.js', '    function _quickCapture('],
    ['llm/organize.js', '    // ---- 二期 ✨整理（notes-ai-organize）'],
    ['history-trash/trash.js', '    async function _delete(id)'],
    ['notes/archive-suggest.js', '    // ---- 显式归档（重构）----'],
    ['dispatch/sessions.js', '    function snapHeader(h)'],
    ['search/helpers.js', '    // ==== search-helpers BEGIN ===='],
    ['transfer/import-export.js', '    // ---- 导入/导出：全库目录快照'],
    ['inject/conventions.js', '    function conventionHit('],
    ['server/rpc-a.js', '    // ---- 性能遥测：RPC 计数/耗时'],
    ['memory/guide.js', '    // ==== 工作记忆 v0：沉淀引导启用流程'],
    ['server/rpc-b.js', "    disposers.push(handle('notes-memory-guide'"],
    ['server/tools.js', '    function regTool(def)'],
    ['kernel/bootstrap-tail.js', '    // 设置启动加载（不阻塞 apply 返回）'],
  ],
}

// 发布版：packages/dsh-notes-plugin/index.mjs（3718 行）→ 28 片（多 head/apply-head/migration 三片）
const dist = {
  name: 'index.mjs（发布版构建期拼接）',
  source: 'packages/dsh-notes-plugin/index.mjs',
  outDir: 'out/pkg-host',
  rangesOut: 'out/ranges-dist.json',
  parts: [
    ['head.js', null],
    ['apply-head.js', 'export function apply(ctx)'],
    ['kernel/format.js', '    function genId()'],
    ['inject/sensitive-helpers.js', '    // ==== sensitive-helpers BEGIN ===='],
    ['notes/front-matter.js', '    function buildFM(m)'],
    ['kernel/session-ctx.js', '    function sessCtx()'],
    ['settings/store.js', '    // ---- 设置持久化（SETTINGS_PATH）'],
    ['llm/usage-classify.js', '    // ==== llm-usage BEGIN ===='],
    ['notes/store-cache.js', '    // ---- 缓存层：解析结果按 id 常驻内存'],
    ['history-trash/engine.js', '    // ==== history-engine BEGIN ===='],
    ['notes/persist.js', '    async function persistNote(n, opts)'],
    ['folders/tree.js', '    // ---- 虚拟文件夹：'],
    ['notes/create-list.js', '    async function _create('],
    ['notes/get-update.js', '    async function _get(id)'],
    ['notes/quick.js', '    function _quickCapture('],
    ['llm/organize.js', '    // ---- 二期 ✨整理（notes-ai-organize）'],
    ['history-trash/trash.js', '    async function _delete(id)'],
    ['notes/archive-suggest.js', '    // ---- 显式归档（重构）----'],
    ['dispatch/sessions.js', '    function snapHeader(h)'],
    ['search/helpers.js', '    // ==== search-helpers BEGIN ===='],
    ['transfer/import-export.js', '    // ---- 导入/导出：全库目录快照'],
    ['inject/conventions.js', '    function conventionHit('],
    ['server/rpc-a.js', '    // ---- 性能遥测：RPC 计数/耗时'],
    ['memory/guide.js', '    // ==== 工作记忆 v0：沉淀引导启用流程'],
    ['server/rpc-b.js', "    disposers.push(handle('notes-memory-guide'"],
    ['server/tools.js', '    function regTool(def)'],
    ['server/migration.js', '    // ---- 一次性数据迁移：'],
    ['kernel/bootstrap-tail.js', '    // 设置启动加载（不阻塞 apply 返回）'],
  ],
}

module.exports = { host, dist }
