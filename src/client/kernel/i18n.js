    // ===== i18n 语言机制（notes-042-i18n-mech；与 app kernel/helpers.js 同口径——机制卡，纯机制不改现有文案）=====
    // 字典 @i18n/zh.js+en.js（列 0 维护，client 态逐非空行加 4 空格基座缩进纳入，序位在本文件之前）；
    // 语言态 localStorage 'dsh-notes-lang'（'zh' 缺省），langStore 订阅驱动全量重渲染（§4.4 store 纪律）。
    const I18N_LANG_KEY = 'dsh-notes-lang'
    function loadLang() { try { const v = localStorage.getItem(I18N_LANG_KEY); return v === 'en' ? 'en' : 'zh' } catch (err) { return 'zh' } }
    const langStore = createStore({ lang: loadLang() })
    // tLookup(lang, key, vars)：当前语言字典 → zh 全量基准字典 → key 本身（红线：永不裸 key，仅 zh 也缺才兜底露 key）；{name} 插值（禁拼接）
    function tLookup(lang, key, vars) {
      const dict = lang === 'en' ? I18N_EN : I18N_ZH
      let s = dict[key]
      if (s == null) s = I18N_ZH[key]
      if (s == null) return key
      if (vars) s = s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? String(vars[n]) : m))
      return s
    }
    // 非组件语境直取（toast/confirm 等命令式调用点，读当下语言态）
    function t(key, vars) { return tLookup(langStore.get().lang, key, vars) }
    // I18nContext：子树级覆盖通道（缺省 null → 走全局语言态；覆盖卡/预览类场景可挂 Provider 局部换语言）
    const I18nContext = React.createContext(null)
    // useT()：组件内取 t——订阅 langStore，切换语言全部消费组件自更新（无需手动重渲染）
    function useT() {
      const override = React.useContext(I18nContext)
      const lang = langStore.useSel(s => s.lang)
      if (typeof override === 'function') return override
      return (key, vars) => tLookup(lang, key, vars)
    }
    // setLang(l)：校验 + 持久化 + store 广播（订阅者自渲染，等价全量 render）
    function setLang(l) {
      if (l !== 'zh' && l !== 'en') return
      try { localStorage.setItem(I18N_LANG_KEY, l) } catch (err) {}
      langStore.set({ lang: l })
    }
