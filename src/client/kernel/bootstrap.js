return {
  inject: ['timer', 'sessions', 'workspaces'],
  apply(ctx) {
    const timer = ctx.timer
    const sessions = ctx.sessions
    const workspaces = ctx.workspaces
    const slots = ctx.get('slots')
    if (!slots) { console.error('notes plugin: slots unavailable'); return }
    const disposers = []
