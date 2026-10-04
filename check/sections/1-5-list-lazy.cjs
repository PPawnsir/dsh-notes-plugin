// 节 1.5 T1.2 列表懒加载分页
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "1.5",
  title: "1.5 T1.2 列表懒加载分页",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
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
  }
}
