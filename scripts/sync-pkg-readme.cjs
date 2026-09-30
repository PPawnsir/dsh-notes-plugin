#!/usr/bin/env node
/* 发布前同步：把仓库根 README.md 复制为发布包 README.md，并改写图片路径
 * （根 README 引用 packages/dsh-notes-plugin/docs/...，包内为 ./docs/...，
 *   docs/ 已加入 files 白名单，npm 页面可直接渲染）。
 * 用法：node scripts/sync-pkg-readme.cjs  （release 流程必须执行，见 DEVELOPMENT.md 版本适配映射约定） */
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const src = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
const out = src.split('packages/dsh-notes-plugin/docs/').join('./docs/')
fs.writeFileSync(path.join(root, 'packages', 'dsh-notes-plugin', 'README.md'), out)
console.log('[sync-pkg-readme] packages/dsh-notes-plugin/README.md 已同步自根 README（' + out.length + ' 字节）')
