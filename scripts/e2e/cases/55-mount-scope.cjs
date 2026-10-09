'use strict'
/* 0.5.0 插队修复（notes-050-mount-scope）用例㊿：scoped 挂载 → 注入预览两会话视角差异。
 * 修复：挂载行可见性随目标笔记 injectTo 过滤（host 目录段 + 徽标资料区同款 scope 过滤）。
 * e2e 面 = mock notes-inject-preview 同款 scope 过滤（挂载行随目标笔记 injectTo 过滤，同 host conventionHit）。
 * 隔离纪律：纯 RPC 直调 handleRpc（零浏览器 UI），只造本用例专属笔记（id 独立），不碰种子/其他用例状态。 */
module.exports = {
  name: '㊿ scoped 挂载注入预览两会话视角差异（挂载行随 injectTo 过滤）',
  async run({ H, state }) {
    const { handleRpc } = require('../server.cjs')
    /* 造 scoped 挂载（injectTo=['sess-a']）+ 全局挂载（injectTo=[]）各一条（reference 档，挂载⇔资料不变量） */
    const hit = handleRpc(state, 'notes-create', { title: 'e2e scoped 挂载', body: 'x', inject: true, injectRole: 'reference', injectTo: ['sess-a'] })
    const glob = handleRpc(state, 'notes-create', { title: 'e2e 全局挂载', body: 'x', inject: true, injectRole: 'reference' })
    handleRpc(state, 'notes-mount', { id: hit.id, whenToUse: 'e2e scoped 命中行' })
    handleRpc(state, 'notes-mount', { id: glob.id, whenToUse: 'e2e 全局行' })
    /* 两会话视角：sess-a 命中 scoped；sess-b 不命中 */
    const ra = handleRpc(state, 'notes-inject-preview', { sessionId: 'sess-a' })
    const rb = handleRpc(state, 'notes-inject-preview', { sessionId: 'sess-b' })
    H.t('sess-a 视角：scoped 挂载行进目录段 + 全局行仍在', (ra.directory || '').indexOf('e2e scoped 命中行') >= 0 && (ra.directory || '').indexOf('e2e 全局行') >= 0, () => JSON.stringify(ra.directory || ''))
    H.t('sess-b 视角：scoped 挂载行出目录段 + 全局行仍在', (rb.directory || '').indexOf('e2e scoped 命中行') < 0 && (rb.directory || '').indexOf('e2e 全局行') >= 0, () => JSON.stringify(rb.directory || ''))
  },
}
