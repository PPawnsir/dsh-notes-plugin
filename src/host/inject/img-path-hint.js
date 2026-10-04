    // ==== img-path-hint BEGIN ====（注入/派发图片路径消歧；host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，check.js 提取比对，改动必须双边同步）
    // 背景：正文图片引用 ![](assets/xxx.png) 是相对笔记库根的相对路径；注入/派发以纯文本下发，agent 无法确定基准目录。
    // 策略：注入文本（conventionText/catalogText）与派发消息（_dispatch）尾部追加一行绝对路径提示，agent 可用文件工具直读；
    // 提示行整条文本只追加一次（不逐笔记重复），且仅当正文含 assets/ 图片引用时追加。
    // 检测与 inlineAssetsInBody / 渲染白名单同口径（![alt](assets/name)）；非全局正则 .test 无 lastIndex 残留坑。
    const BODY_IMG_REF_RE = /!\[[^\]]*\]\(assets\/[^\s)"']+\)/
    function bodyHasImageRef(body) { return BODY_IMG_REF_RE.test(String(body == null ? '' : body)) }
    // 提示行拼装：notesRoot 取运行时实际值（开发版 NOTES_DIR / 静态包 NOTES_ROOT，均已是绝对路径）；正斜杠形态双平台可读
    function assetsHintLine(notesRoot) { return '（图片位于笔记库目录 ' + String(notesRoot || '').replace(/[\\/]+$/, '') + '/assets/，可用文件工具直接读取）' }
    // ==== img-path-hint END ====

