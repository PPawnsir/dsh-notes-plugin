    async function persistNote(n, opts) {
      perfStats.diskWrites++
      if (!opts || opts.history !== false) {
        const prev = cache.get(n.id)
        if (prev) await histSnapshot(n.id, prev)
      }
      const content = noteFileContent(n)
      const ft = await fs.resolve(noteFile(n.id))
      await fs.writeText(ft, content, undefined, undefined, getPolicy())
      cache.set(n.id, Object.assign({}, n))
    }

    // 列表/RPC 瘦身：不带 body，正文编辑走 notes-get 按需加载
    function slim(n) {
      return {
        id: n.id, title: n.title, topic: n.topic, workspace: n.workspace, folder: n.folder || '',
        tags: n.tags, kind: n.kind || 'note', status: n.status || 'active',
        inject: n.inject === true, injectEver: n.injectEver === true || n.inject === true, injectTo: n.injectTo || [], injectRole: n.injectRole === 'reference' ? 'reference' : 'convention', recall: n.recall !== false, sensitive: n.sensitive === true,
        createdAt: n.createdAt, updatedAt: n.updatedAt,
        sessionId: n.sessionId, cwd: n.cwd, logDate: n.logDate || '', entities: n.entities || [], summarizedAt: n.summarizedAt || '', contractType: n.contractType || '', origin: n.origin || '', schedule: n.schedule || null, mergedFrom: n.mergedFrom,
        dispatches: n.dispatches || [],
        useCount: n.useCount || 0,
        archivedAt: n.archivedAt, deleted: n.deleted === true, preview: String(n.body || '').slice(0, 200)
      }
    }

