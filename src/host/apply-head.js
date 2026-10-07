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
    // 0.4.4-B：定时派发专属会话创建需挂载默认 preset（工具能力来源）；软依赖 ctx.get + 守卫降级（缺失时专属会话创建报 lastError，主服务不受影响）
    const agentPresets = ctx.get('agentPresets')
    // 0.4.7（notes-047-sched-preset）：专属会话权限预设——settings-get 增带 defaultPreset（派发弹窗权限下拉预填数据源）+
    //   声明 preset 创建透传（permissionPresets.set）；软依赖 ctx.get + 守卫降级（服务缺席 → settings-get 省略该键 / 透传静默跳过，绝不炸创建）
    const permissionPresets = ctx.get('permissionPresets')
    const NOTES_DIR = NOTES_ROOT
    const disposers = []
    // 动态沙箱 Builtin：harness 是「dynamic Host half」的符号（cordis-host-runner 用 node:vm 注入），
    // 静态包（真实 Cordis row）里通常不存在；存在时作为兼容通道使用（见 RPC 桥 / regTool 回退）。
    const harnessRef = typeof harness !== 'undefined' ? harness : undefined

