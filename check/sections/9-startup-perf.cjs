// 节 9. 启动 + 遥测
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "9",
  title: "9. 启动 + 遥测",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { handlers } = S
  // ===== 9. 启动加载与遥测 =====
  section('9. 启动 + 遥测')
  await t('host-impl 应用成功（47 RPC handlers，含 notes-settings-get/set + 导入导出 + P3 notes-export-single + 资产上传 + 归档 preview/undo + ai-organize/assets-prune + P1 notes-purge + notes-inject-preview + notes-suggest + notes-usage-get + 历史版本 notes-history/history-get/restore-history + 工作记忆 notes-memory-guide + 定时派发 notes-schedule-eval + N+1 批量 notes-get-batch + 图查询 notes-graph + 注入索引 notes-mount/notes-mount-list + 效用账本 notes-ledger-refresh + 召回遥测 notes-recall-stats + whenToUse 草稿 notes-when-suggest）', () => assert.strictEqual(Object.keys(handlers).length, 47))
  await t('notes-src handler 可用', () => assert(typeof handlers['notes-src'] === 'function'))
  await t('notes-css handler 可用', () => assert(typeof handlers['notes-css'] === 'function'))
  await t('notes-perf handler 可用', () => assert(typeof handlers['notes-perf'] === 'function'))
  }
}
