#!/usr/bin/env node
/* 发布前同步（四文件）：把仓库根 README.md / README.en.md 复制为发布包同名文件，并改写图片路径
 * （根 README 引用 packages/dsh-notes-plugin/docs/...，包内为 ./docs/...，
 *   docs/ 已加入 files 白名单，npm 页面可直接渲染）。
 * 用法：node scripts/sync-pkg-readme.cjs  （release 流程必须执行，见 DEVELOPMENT.md 版本适配映射约定）
 * 口径：中英双版四文件同步（根 zh → 包 zh、根 en → 包 en），check 节 75 逐字节看守。 */
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const rewrite = (s) => s.split('packages/dsh-notes-plugin/docs/').join('./docs/')
for (const name of ['README.md', 'README.en.md']) {
  const out = rewrite(fs.readFileSync(path.join(root, name), 'utf8'))
  fs.writeFileSync(path.join(root, 'packages', 'dsh-notes-plugin', name), out)
  console.log('[sync-pkg-readme] packages/dsh-notes-plugin/' + name + ' 已同步自根 ' + name + '（' + out.length + ' 字节）')
}
