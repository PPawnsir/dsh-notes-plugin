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
      return { id: id, purged: true, mode: mode, historyPurged: historyPurged }
    }

