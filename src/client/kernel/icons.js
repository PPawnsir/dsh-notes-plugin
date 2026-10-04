    const e = React.createElement
    // ===== SVG 图标集（UI v2：全部图标走 SVG，零 emoji）=====
    // 原型 design/notes-ui-v2.html 的 15 个 symbol 内联化为 e() createElement 结构
    // （check.js 断言这些 path d 串；图标渲染不经过 innerHTML，天然无注入面）
    const IC = {
      search: [e('circle', { key: 'c', cx: 11, cy: 11, r: 7 }), e('path', { key: 'p', d: 'm20 20-3.5-3.5' })],
      plus: [e('path', { key: 'p', d: 'M12 5v14M5 12h14' })],
      chev: [e('path', { key: 'p', d: 'm9 6 6 6-6 6' })],
      pin: [e('path', { key: 'p', d: 'M12 17v5M7 4h10l-1.5 6.5 3 4.5h-13l3-4.5Z' })],
      folder: [e('path', { key: 'p', d: 'M4 7a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z' })],
      topic: [e('path', { key: 'p', d: 'M12 3l2.2 5.6L20 11l-5.8 2.4L12 19l-2.2-5.6L4 11l5.8-2.4Z' })],
      bolt: [e('path', { key: 'p', d: 'M13 3 5 13.5h6L11 21l8-10.5h-6Z' })],
      eye: [e('path', { key: 'p', d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z' }), e('circle', { key: 'c', cx: 12, cy: 12, r: 3 })],
      play: [e('path', { key: 'p', d: 'M7 5.5v13l11-6.5Z' })],
      ext: [e('path', { key: 'p', d: 'M14 5h5v5M19 5l-8 8M11 5H6a1.5 1.5 0 0 0-1.5 1.5V18A1.5 1.5 0 0 0 6 19.5h11.5A1.5 1.5 0 0 0 19 18v-5' })],
      trash: [e('path', { key: 'p', d: 'M4.5 6.5h15M9 6V4.5h6V6M7 6.5 8 20h8l1-13.5M10 10v6M14 10v6' })],
      gear: [e('circle', { key: 'c', cx: 12, cy: 12, r: 3.2 }), e('path', { key: 'p', d: 'M12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18' })],
      up: [e('path', { key: 'p', d: 'M12 19V6M6.5 11.5 12 6l5.5 5.5M5 20h14' })],
      down: [e('path', { key: 'p', d: 'M12 5v13M6.5 12.5 12 18l5.5-5.5M5 20h14' })],
      note: [e('path', { key: 'p1', d: 'M6 4h9l4 4v12H6Z' }), e('path', { key: 'p2', d: 'M14.5 4v4.5H19' })],
      filter: [e('path', { key: 'p', d: 'M4 5h16l-6.5 7.5V19l-3-1.5v-5Z' })],
      // 原型 defs 遗漏了 i-check（capSave 引用），补上；tag/swap 为 v2 新增（标签 chip / 入口模式切换）
      check: [e('path', { key: 'p', d: 'M4.5 12.5 10 18 19.5 6.5' })],
      tag: [e('path', { key: 'p', d: 'M4 4h7l9 9-7 7-9-9Z' }), e('circle', { key: 'c', cx: 8, cy: 8, r: 1.6 })],
      swap: [e('path', { key: 'p', d: 'M7 4 3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8' })],
      // v3 双模式编辑器工具栏图标（原型 notes-editor-v3.html defs 内联化）
      codeblock: [e('path', { key: 'p', d: 'm8 6-6 6 6 6M16 6l6 6-6 6' })],
      bold: [e('path', { key: 'p1', d: 'M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z' }), e('path', { key: 'p2', d: 'M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z' })],
      italic: [e('path', { key: 'p', d: 'M19 4h-9M14 20H5M15 4 9 20' })],
      link: [e('path', { key: 'p1', d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }), e('path', { key: 'p2', d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' })],
      ul: [e('path', { key: 'p', d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' })],
      ol: [e('path', { key: 'p', d: 'M11 6h10M11 12h10M11 18h10M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1' })],
      quote: [e('path', { key: 'p1', d: 'M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z' }), e('path', { key: 'p2', d: 'M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z' })],
      image: [e('rect', { key: 'r', x: 3, y: 3, width: 18, height: 18, rx: 2 }), e('circle', { key: 'c', cx: 9, cy: 9, r: 2 }), e('path', { key: 'p', d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' })],
      warn: [e('path', { key: 'p1', d: 'M12 3 2.5 20h19Z' }), e('path', { key: 'p2', d: 'M12 10v4M12 17.5v.01' })],
      // 二期 ✨整理（AI 按 kind 模板重写正文）图标：双星
      sparkle: [e('path', { key: 'p1', d: 'M10 3l1.7 4.8 4.8 1.7-4.8 1.7L10 16l-1.7-4.8-4.8-1.7 4.8-1.7Z' }), e('path', { key: 'p2', d: 'M17.5 14.5l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9Z' })],
      // 敏感标记（sensitive 字段 toggle）：锁形图标
      lock: [e('rect', { key: 'r', x: 4.5, y: 10.5, width: 15, height: 9.5, rx: 1.5 }), e('path', { key: 'p', d: 'M8 10.5V7.5a4 4 0 0 1 8 0v3' })],
      // 筛选中心新增（design/notes-filter-center.html）：曾注入时钟 / 排序 / 激活 chip × 移除
      clock: [e('circle', { key: 'c', cx: 12, cy: 12, r: 8.5 }), e('path', { key: 'p', d: 'M12 7.5V12l3 2' })],
      sort: [e('path', { key: 'p', d: 'M8 5v14M8 5 4.5 8.5M8 5l3.5 3.5M16 19V5M16 19l3.5-3.5M16 19l-3.5-3.5' })],
      x: [e('path', { key: 'p', d: 'M6 6l12 12M18 6 6 18' })],
    }
    // I(name, size?, cls?)：图标 helper——返回 e('svg') 结构（stroke=currentColor 由 CSS 统一，尺寸默认 15px）
    function I(name, size, cls) {
      return e('svg', { className: 'dsh-ic' + (cls ? ' ' + cls : ''), viewBox: '0 0 24 24', style: size ? { width: size + 'px', height: size + 'px' } : undefined, 'aria-hidden': 'true' }, IC[name])
    }
