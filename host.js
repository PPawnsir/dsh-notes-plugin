// notes 插件 host 引导壳：真正的实现在 src/host/**（按 manifest.dev.js 逐字节拼接，运行时读取）
// 拼接产物与昔日单文件 src/host-impl.js 逐字节一致（LF 归一；architecture-modular.md §8.4.1 红线 7a）
// 存在意义：cordis_define 传输超长源码字符串可能被截断；引导壳短小可靠，实现代码永不经过 define
// 移植：把整个文件夹放到任意位置后，只需改下面这一处插件目录（Windows 用 \\ 分隔）
const PLUGIN_DIR = 'D:\\deepseek-work\\dsh-notes-plugin'
return {
  inject: ['fs', 'sandboxPolicy'],
  apply(ctx) {
    const fs = ctx.fs
    const sp = ctx.sandboxPolicy
    const harnessRef = typeof harness !== 'undefined' ? harness : undefined
    let cancelled = false
    ctx.effect(() => () => { cancelled = true })
    ;(async () => {
      try {
        // 加载时拼接：读 manifest + 逐条目读盘串接 + LF 归一（与 notes-src RPC / scripts/concat-host.cjs 同一规则：
        // manifest 为单引号路径一行一条，文本正则提取——沙箱无 require；manifest 注释中禁止出现单引号）
        const mtext = await fs.readText(await fs.resolve(PLUGIN_DIR + '\\src\\host\\manifest.dev.js'))
        const list = (String(mtext).match(/'[^'\n]+'/g) || []).map(s => s.slice(1, -1))
        let src = ''
        for (const rel of list) {
          src += await fs.readText(await fs.resolve(PLUGIN_DIR + '\\src\\host\\' + rel.replace(/\//g, '\\')))
        }
        src = src.replace(/\r\n/g, '\n')
        if (cancelled) return
        // pluginDir 作为参数注入，impl 内所有路径都从它派生（可移植）
        const plugin = new Function('harness', 'pluginDir', src)(harnessRef, PLUGIN_DIR)
        plugin.apply(ctx)
        console.log('notes plugin: host impl loaded')
      } catch (e) { console.error('notes host bootstrap failed', e) }
    })()
  }
}
