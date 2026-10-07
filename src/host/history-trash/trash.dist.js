    async function _delete(id) {
      const note = Object.assign({}, await loadNote(id))
      note.deleted = true
      note.updatedAt = new Date().toISOString()
      await persistNote(note)
      return { id }
    }

    // 恢复软删除的笔记（撤销删除/撤销归档）
    async function _restore(id) {
      const note = Object.assign({}, await loadNote(id))
      if (note.tombstoned) throw new Error('笔记已彻底删除，不可恢复')
      note.deleted = false
      note.updatedAt = new Date().toISOString()
      await persistNote(note)
      return { id }
    }

    // ==== tmpdir-sweep BEGIN ====（0.4.6-H notes-046-smallfix 卫生小件②，R2 n-mux9tc6z76mj；trash.js ⇄ trash.dist.js 双变体同 purgeNoteFile 删除通道先例）
    // 原子写孤儿清扫：writeFileAtomic 的 staging 目录（<目标>.<pid>.<uuid>.tmpdir/）在 rename 失败/进程中断时残留，此前无任何清理路径
    //   （实证：notes/.n-mujh1qizthz3.md.29940.9fed335c-*.tmpdir/ 自 2026-09-27 残留）。
    // 时机 = apply 启动一次（fire-and-forget 不阻塞就绪；无定时器——插件重载/宿主重启即下一清扫点，摊销即防抖，写入热路径零开销）。
    // 红线：只删 mtime 超过 24h 的 *.tmpdir 目录——在途写的 staging 恒新（秒级生命周期），24h 阈值天然不动在途写；逐条 try/catch 全吞。
    // 删除通道：ctx.fs 契约无删除也无 mtime —— 经 fs.processPath 还原进程路径 + node:fs stat/rm（同 purgeNoteFile 静态包先例）；
    //   能力缺失（宿主 fs 无 processPath / stat 失败）→ 静默跳过，留待下次启动，不报错不扩散。开发版变体（trash.js）= 空操作（无 node:fs）。
    const TMPDIR_ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000
    async function sweepTmpdirOrphans() {
      try {
        if (!fsNode || !fsNode.promises) return
        if (!fs || typeof fs.processPath !== 'function') return
        const dirTarget = await fs.resolve(NOTES_DIR)
        const info = await fs.stat(dirTarget)
        if (!info) return
        const entries = await fs.listDir(dirTarget)
        const cutoff = Date.now() - TMPDIR_ORPHAN_MAX_AGE_MS
        for (const en of entries || []) {
          try {
            const nm = en && en.name
            if (!nm || nm.slice(-7) !== '.tmpdir') continue
            if (en.type && en.type !== 'directory') continue
            const pp = fs.processPath(en.target ? en.target : await fs.resolve(path.join(NOTES_DIR, nm)))
            if (!pp) continue
            const st = await fsNode.promises.stat(pp)
            if (!st || !st.isDirectory()) continue
            if (!(st.mtimeMs < cutoff)) continue   // 在途写豁免：只删 >24h 孤儿
            await fsNode.promises.rm(pp, { recursive: true, force: true })
          } catch (e) {}
        }
      } catch (e) {}
    }
    // ==== tmpdir-sweep END ====

    // ---- P1 回收站：彻底删除（notes-purge）----
    // （与开发版 host-impl.js 双边同步；唯一差异：本静态包有 node:fs 真删除通道）
    // 仅限已软删除的笔记（安全闸：未进回收站的笔记拒绝彻底删除）；删除 n-<id>.md 与归档备份 n-<id>.md.bak。
    // 删除语义：ctx.fs（FileSystem 服务契约）只有读/写/编辑、没有删除——优先走 node:fs 真删除
    // （fs.processPath 把 FsTarget 还原为进程路径；不可用时落回「墓碑式清空」writeText ''，与开发版一致）。
    async function purgeNoteFile(name) {
      try {
        if (typeof fs.processPath === 'function') {
          const target = await fs.resolve(path.join(NOTES_DIR, name))
          const pp = target && fs.processPath(target)
          if (pp) { await fsNode.promises.unlink(pp); return 'deleted' }
        }
      } catch (e) { /* 真删不可用/失败 → 落回墓碑式清空 */ }
      await fs.writeText(await fs.resolve(path.join(NOTES_DIR, name)), '', undefined, undefined, getPolicy())
      return 'tombstoned'
    }
    async function _purge(id) {
      const note = await loadNote(id)
      if (note.tombstoned) throw new Error('笔记已彻底删除，不可恢复')
      if (!note.deleted) throw new Error('笔记未删除：彻底删除请先移入回收站（软删除）')
      const mode = await purgeNoteFile(id + '.md')
      // .bak 归档备份一并清除（存在才动，不存在不报错）
      try { if (await fs.stat(await fs.resolve(path.join(NOTES_DIR, id + '.md.bak')))) await purgeNoteFile(id + '.md.bak') } catch (e) {}
      // 快照历史连带清除（.history/<id> 整棵；删除语义同 purge——processPath 可用时真删，否则墓碑式清空）
      const historyPurged = await histPurgeNote(id)
      cache.delete(id)
      _emitNoteChanged({ event: 'purge', id: id })   // 事件总线单点分发（0.4.3+ notes-043-event-bus；彻底删除不经 persistNote）
      return { id: id, purged: true, mode: mode, historyPurged: historyPurged }
    }

