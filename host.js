// notes 插件 host 引导壳：真正的实现在 host-impl.js（磁盘文件，运行时读取）
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
        const ft = await fs.resolve(PLUGIN_DIR + '\\host-impl.js')
        const src = await fs.readText(ft)
        if (cancelled) return
        // pluginDir 作为参数注入，impl 内所有路径都从它派生（可移植）
        const plugin = new Function('harness', 'pluginDir', src)(harnessRef, PLUGIN_DIR)
        plugin.apply(ctx)
        console.log('notes plugin: host impl loaded')
      } catch (e) { console.error('notes host bootstrap failed', e) }
    })()
  }
}
