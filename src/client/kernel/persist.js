    // 文件夹折叠态持久化：JSON 数组记录「展开中」的文件夹 id（'__pinned__' 是置顶折叠组固定 key）；null/缺省 = 全部展开
    const PINNED_KEY = '__pinned__'
    function loadFoldersExpanded() { try { const v = localStorage.getItem('dsh-notes-folders-expanded'); if (!v) return null; const arr = JSON.parse(v); return Array.isArray(arr) ? arr : null } catch (err) { return null } }
    function saveFoldersExpanded(arr) { try { localStorage.setItem('dsh-notes-folders-expanded', JSON.stringify(arr)) } catch (err) {} }
    // 陈旧 id 清洗：按当前文件夹清单过滤失效 id（PINNED_KEY 保留）；过滤后为空 → null（回缺省全展开），并回写持久化
    // （文件夹删除重建后旧 id 残留会让「非 null 数组 = 只展开集合内 id」语义错乱：老 id 占位、新文件夹默认折叠——观感即点哪个都不展开）
    function pruneFoldersExpanded(prev, folderList) {
      if (!prev) return prev
      const next = prev.filter(id => id === PINNED_KEY || folderList.some(f => f.id === id))
      if (next.length === prev.length) return prev
      const fixed = next.length ? next : null
      saveFoldersExpanded(fixed)
      return fixed
    }
    // ===== 侧栏宽度（两栏分隔条拖拽调整；localStorage 记忆；双击分隔条重置缺省）=====
    // clamp：200px ≤ w ≤ 60% 面板宽；key 与 app.html 独立（app.html 侧为 dsh-notes-app-sidebar-w）
    const SIDE_W_KEY = 'dsh-notes-sidebar-w'
    const SIDE_W_DEFAULT = 300   // 与 styles.css .dsh-notes-side 缺省宽一致
    function clampSideW(w, panelW) { return Math.max(200, Math.min(Math.round(panelW * 0.6), Math.round(w))) }
    function loadSideW() { try { const v = parseInt(localStorage.getItem(SIDE_W_KEY), 10); return v >= 200 ? v : null } catch (err) { return null } }
    function saveSideW(w) { try { if (w == null) localStorage.removeItem(SIDE_W_KEY); else localStorage.setItem(SIDE_W_KEY, String(w)) } catch (err) {} }
    loadEntryState()
