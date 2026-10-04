// ---- 会话元数据缓存（0.1.7 修复：notes-active-sessions ~128s 超时、派发对话框空白）----
// 根因：0.1.7 的 sessionQuery.readTitleSnapshots 对非 live 会话走 corpus.inspectPersisted
// 全量日志加载解析（每会话 ~10s，SessionCorpus 缓存容量仅 5，12 会话中 9 个非 live ≈ 128s），
// GUI fetch 等不到即渲染空列表。
// 策略：sid 粒度缓存（模块级 Map，随引导壳生命周期存活）——cwd/origin/createdAt 是不变字段长期有效；
// title 受 TTL（10min）约束：过期不删旧值（先用旧标题兜底展示、不闪烁），后台重读刷新。
// live 会话不读缓存：agents.get + sessionTitle.get 走内存，始终实时。
const SESS_META_TTL = 10 * 60 * 1000
const sessMetaCache = new Map()  // sid → { title, cwd, origin, createdAt, ts }
let sessMetaFillRunning = false  // 后台批量读串行化：避免对话框反复打开时叠加读盘

return {
  inject: ['fs', 'sandboxPolicy'],
  apply(ctx) {
    const fs = ctx.fs
    const sp = ctx.sandboxPolicy
    const agents = ctx.get('agents')
    const llm = ctx.get('llm')
    const adm = ctx.get('agentDefaultModel')
    const systemPrompt = ctx.get('systemPrompt')
    const sessionPersistence = ctx.get('sessionPersistence')
    const workspaceRegistry = ctx.get('workspaceRegistry')
    const sessionTitle = ctx.get('sessionTitle')
    const sessionQuery = ctx.get('sessionQuery')
    // 插件目录由 host 引导壳通过 new Function('harness','pluginDir',...) 注入；缺失时回退（单测/直跑场景）
    const PLUGIN_DIR = typeof pluginDir !== 'undefined' && pluginDir ? pluginDir : 'D:\\deepseek-work\\dsh-notes-plugin'
    const NOTES_DIR = PLUGIN_DIR + '\\notes'
    const CSS_PATH = PLUGIN_DIR + '\\src\\styles.css'
    const disposers = []

