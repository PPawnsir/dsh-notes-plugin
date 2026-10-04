// 节 13. injectTo 注入范围（多选数组）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "13",
  title: "13. injectTo 注入范围（多选数组）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { agentsMock, handlers } = S
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
  }
}
