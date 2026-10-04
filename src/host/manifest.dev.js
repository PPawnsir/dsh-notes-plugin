// host 模块清单（开发版）—— host.js 引导壳运行时拼接的唯一组装依据
// 解析规则同 scripts/concat-client.cjs：逐行提取单引号字符串；注释中禁止出现单引号字符。
// P2·3 kernel 抽出：kernel/ 六模块（format/front-matter/session-ctx 双包逐字节一致片，两清单同名引用同一物理文件；
// settings-store/store-cache/persist 为双包变体，发布版侧以 .dist.js 后缀登记）。
// P2·4 RPC 核心域抽出：folders.js / notes.js / history-trash·trash.js / llm·organize.js。
// P2·5 收口：whole.js 续切完毕——server（RPC 基础设施 handle/perf + 核心注册表 + notes-css/notes-src 源下发）/
// dispatch（会话元数据 + 派发闭环）/ inject（注入渲染 + 设置面 settings-get/set/usage-get）/
// memory（归档 + 整理建议 + 日志卫生 + 工作记忆引导）/ transfer（导入导出 + 资产）/ index（工具层 + 启动装配，尾模块）；
// inject/img-path-hint.js 与 search.js 双包逐字节一致 → 物理单份，两清单同名引用（§8.4.3 共源增强落地）。
// 序位 = 标识符可见序：后位可引用前位顶层标识符（§8.4.2），check/sections/45-host-modular.cjs 锁定序位。
'kernel/head.js'
'kernel/format.js'
'inject/sensitive-helpers.js'
'kernel/front-matter.js'
'kernel/session-ctx.js'
'kernel/settings-store.js'
'llm/usage-classify.js'
'kernel/store-cache.js'
'history-trash/engine.js'
'kernel/persist.js'
'folders.js'
'notes.js'
'llm/organize.js'
'history-trash/trash.js'
'server.js'
'inject/img-path-hint.js'
'dispatch.js'
'inject.js'
'memory.js'
'search.js'
'transfer.js'
'index.js'
