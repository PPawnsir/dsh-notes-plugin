// host 模块清单（发布版）—— scripts/build-dist.cjs 构建期拼接写盘 packages/dsh-notes-plugin/index.mjs 的组装依据
// 解析规则同 scripts/concat-client.cjs：逐行提取单引号字符串；注释中禁止出现单引号字符。
// P2·3 kernel 抽出：与开发版共用 kernel/ 同名片（逐字节一致片物理单份）；.dist.js 后缀 = 发布版变体片（§8.4.3 红线 9 登记）。
// P2·4 RPC 核心域抽出：folders/notes/history-trash·trash/llm·organize 四域双包变体片（路径拼接与删除通道等设计内差异）。
// P2·5 收口：dist-whole.js 续切完毕——server.dist（核心注册表 + webServer 三路由 + notes-ping + notes-src 源下发）/
// dispatch.dist / inject.dist / memory.dist / transfer.dist / index.dist（工具层 + 一次性迁移 + 启动装配，尾模块）六变体片；
// inject/img-path-hint.js 与 search.js 双包逐字节一致 → 物理单份（无 .dist 变体）。
// 序位与 manifest.dev.js 同序；check/sections/45-host-modular.cjs 锁定序位与共源/变体登记。
'head.js'
'apply-head.js'
'kernel/format.js'
'inject/sensitive-helpers.js'
'kernel/front-matter.js'
'kernel/session-ctx.js'
'kernel/settings-store.dist.js'
'llm/usage-classify.dist.js'
'kernel/store-cache.dist.js'
'history-trash/engine.dist.js'
'kernel/persist.dist.js'
'folders.dist.js'
'notes.dist.js'
'llm/organize.dist.js'
'history-trash/trash.dist.js'
'server.dist.js'
'inject/img-path-hint.js'
'dispatch.dist.js'
'inject.dist.js'
'memory.dist.js'
'search.js'
'transfer.dist.js'
'index.dist.js'
