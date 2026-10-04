export function apply(ctx) {
    const fs = ctx.fs
    const sp = ctx.sandboxPolicy
    const tools = ctx.tools
    const webServer = ctx.webServer
    const agents = ctx.get('agents')
    const llm = ctx.get('llm')
    const adm = ctx.get('agentDefaultModel')
    const systemPrompt = ctx.get('systemPrompt')
    const sessionPersistence = ctx.get('sessionPersistence')
    const workspaceRegistry = ctx.get('workspaceRegistry')
    const sessionTitle = ctx.get('sessionTitle')
    const sessionQuery = ctx.get('sessionQuery')
    const NOTES_DIR = NOTES_ROOT
    const disposers = []
    // 动态沙箱 Builtin：harness 是「dynamic Host half」的符号（cordis-host-runner 用 node:vm 注入），
    // 静态包（真实 Cordis row）里通常不存在；存在时作为兼容通道使用（见 RPC 桥 / regTool 回退）。
    const harnessRef = typeof harness !== 'undefined' ? harness : undefined

