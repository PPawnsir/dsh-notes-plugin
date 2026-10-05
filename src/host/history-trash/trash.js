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
    // 仅限已软删除的笔记（安全闸：未进回收站的笔记拒绝彻底删除）；删除 n-<id>.md 与归档备份 n-<id>.md.bak。
    // 删除语义：ctx.fs（FileSystem 服务契约）只有读/写/编辑、没有删除——开发版用「墓碑式清空」（writeText ''：
    // 0 字节占位，readNoteFile 标 tombstoned，_list/get/update/restore 视作不存在）；
    // 静态包 index.mjs 同名函数有 node:fs 真删除通道（fs.processPath 可用时优先真删）。
    async function purgeNoteFile(name) {
      await fs.writeText(await fs.resolve(NOTES_DIR + '\\' + name), '', undefined, undefined, getPolicy())
      return 'tombstoned'
    }
    async function _purge(id) {
      const note = await loadNote(id)
      if (note.tombstoned) throw new Error('笔记已彻底删除，不可恢复')
      if (!note.deleted) throw new Error('笔记未删除：彻底删除请先移入回收站（软删除）')
      const mode = await purgeNoteFile(id + '.md')
      // .bak 归档备份一并清除（存在才动，不存在不报错）
      try { if (await fs.stat(await fs.resolve(NOTES_DIR + '\\' + id + '.md.bak'))) await purgeNoteFile(id + '.md.bak') } catch (e) {}
      // 快照历史连带清除（.history\<id> 整棵；删除语义同 purge——开发版墓碑式清空，静态包真删）
      const historyPurged = await histPurgeNote(id)
      cache.delete(id)
      _emitNoteChanged({ event: 'purge', id: id })   // 事件总线单点分发（0.4.3+ notes-043-event-bus；彻底删除不经 persistNote）
      return { id: id, purged: true, mode: mode, historyPurged: historyPurged }
    }

