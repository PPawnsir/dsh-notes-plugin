// 节 61. README.en 英文版（notes-042-readme-en：根 README.en.md 全文英文 + 双 README 顶部互链 + 发布包 files 清单 + 术语表抽查）
// 规格源：反馈条目 n-mut488gske5v 种子卡④——README.en.md 全文英文（术语表 11 条；与实际行为一致=发版强约束同口径；不机翻命令块）；
//   双 README 顶部互链（English | 中文）；packages 子 README 保持中文主版（sync 脚本不动），README.en 单独进包 files 清单；
//   package.json description 保持中文，keywords 补 english/i18n。
// 测试策略：纯静态文本断言（存在/体量/互链/术语命中/命令逐字/files 清单/双包同源/零 BOM），不触运行时。
module.exports = {
  id: "61",
  title: "61. README.en 英文版（全文英文 + 双 README 互链 + 发布包 files 清单）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR } = H
  section('61. README.en 英文版（全文英文 + 双 README 互链 + 发布包 files 清单）')
  const rootZh = fsNative.readFileSync(path.join(DIR, 'README.md'), 'utf8')
  const rootEnPath = path.join(DIR, 'README.en.md')
  const pkgDir = path.join(DIR, 'packages', 'dsh-notes-plugin')
  const pkgEnPath = path.join(pkgDir, 'README.en.md')
  const pkgZh = fsNative.readFileSync(path.join(pkgDir, 'README.md'), 'utf8')

  // ===== ① 存在：根 + 发布包 README.en.md，全文体量 + 主干章节齐备 =====
  await t('README.en.md 存在（仓库根 + 发布包）且为全文体量（≥ 中文主版 60% + 主干章节齐备）', () => {
    assert(fsNative.existsSync(rootEnPath), '仓库根 README.en.md 不存在')
    assert(fsNative.existsSync(pkgEnPath), '发布包 README.en.md 不存在')
    const en = fsNative.readFileSync(rootEnPath, 'utf8')
    assert(en.length >= rootZh.length * 0.6, 'README.en.md 体量异常（' + en.length + ' < 中文主版 60% ' + Math.floor(rootZh.length * 0.6) + '），疑非全文翻译')
    for (const h of ['## Version Compatibility', '## What Problem It Solves', '## Install', '## Feature List', '## Agent Tools', '## Data Location', '## Permissions & Implementation', '## Source & Development', '## License']) {
      assert(en.indexOf(h) >= 0, 'README.en.md 缺主干章节：' + h)
    }
  })

  // ===== ② 互链：双 README 顶部互链（English | 中文），根 + 发布包四处 =====
  await t('双 README 顶部互链（[English](README.en.md) | [中文](README.md)，根 + 发布包四处）', () => {
    const head = (s) => s.split('\n').slice(0, 6).join('\n')
    const en = fsNative.readFileSync(rootEnPath, 'utf8')
    const pkgEn = fsNative.readFileSync(pkgEnPath, 'utf8')
    assert(head(rootZh).indexOf('[English](README.en.md)') >= 0, '根 README.md 顶部缺 [English](README.en.md) 互链')
    assert(head(en).indexOf('[中文](README.md)') >= 0, '根 README.en.md 顶部缺 [中文](README.md) 互链')
    assert(head(pkgZh).indexOf('[English](README.en.md)') >= 0, '发布包 README.md 顶部缺互链（sync-pkg-readme 同步后应自带）')
    assert(head(pkgEn).indexOf('[中文](README.md)') >= 0, '发布包 README.en.md 顶部缺互链')
  })

  // ===== ③ 术语抽查 9 条（规格 11 条中本 README 实际覆盖面）+ 命令块未机翻 =====
  await t('README.en 术语表抽查 9 条（injection/convention/dispatch/agent memory/folder/topic/trash/schedule/run log）+ 命令逐字保留', () => {
    const enRaw = fsNative.readFileSync(rootEnPath, 'utf8')
    const en = enRaw.toLowerCase()
    const TERMS = ['injection', 'convention', 'dispatch', 'agent memory', 'folder', 'topic', 'trash', 'schedule', 'run log']
    for (const term of TERMS) assert(en.indexOf(term) >= 0, 'README.en.md 缺术语：' + term)
    // 不机翻命令块：关键命令行逐字保留（注释可译，命令本身一个字符不动）
    for (const cmd of ['dsh plugin --profile web add dsh-notes-plugin', 'dsh plugin --profile web add dsh-notes-plugin@latest', 'dsh plugin --profile web remove dsh-notes-plugin', 'node scripts/build-dist.cjs', 'node --check packages/dsh-notes-plugin/index.mjs', 'node --check packages/dsh-notes-plugin/lib/client.js', 'node check.js']) {
      assert(enRaw.indexOf(cmd) >= 0, 'README.en.md 命令块被改动：' + cmd)
    }
  })

  // ===== ④ 发布包 files 清单：README.en.md 进包 + keywords 补 english/i18n + description 保持中文 =====
  await t('发布包 files 清单含 README.en.md + keywords 补 english/i18n + description 保持中文', () => {
    const pkg = JSON.parse(fsNative.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
    assert(pkg.files.indexOf('README.en.md') >= 0, '发布包 files 清单缺 README.en.md')
    assert(pkg.files.indexOf('README.md') >= 0, '发布包 files 清单仍须含中文主版 README.md')
    assert(pkg.keywords.indexOf('english') >= 0 && pkg.keywords.indexOf('i18n') >= 0, 'keywords 缺 english/i18n')
    assert(/[一-鿿]/.test(pkg.description), 'description 应保持中文（被改动？）')
  })

  // ===== ⑤ 双包同源：发布包 README.en.md = 根 README.en.md 仅图片路径改写（sync-pkg-readme 同口径）+ 零 BOM =====
  await t('发布包 README.en.md 与根同源（仅图片路径改写 ./docs/）+ 双 README.en 零 BOM', () => {
    const en = fsNative.readFileSync(rootEnPath, 'utf8')
    const pkgEn = fsNative.readFileSync(pkgEnPath, 'utf8')
    assert(pkgEn === en.split('packages/dsh-notes-plugin/docs/').join('./docs/'), '发布包 README.en.md ≠ 根 README.en.md 路径改写产物（须与 sync-pkg-readme.cjs 同口径）')
    assert(pkgEn.indexOf('packages/dsh-notes-plugin/docs/') < 0, '发布包 README.en.md 残留仓内图片路径')
    for (const p of [rootEnPath, pkgEnPath]) {
      const buf = fsNative.readFileSync(p)
      assert(!(buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf), p + ' 带 UTF-8 BOM（会让 DSH 静默 skip / npm 渲染异常）')
    }
  })
  }
}
