# e2e vendor — React UMD（面板 harness 专用）

本目录两份文件是 **React 18.3.1 官方 UMD 生产构建**的逐字节拷贝（MIT License，文件头
@license 注释保留即授权条件已满足）：

- `react.production.min.js`（10,751 字节）
- `react-dom.production.min.js`（131,835 字节，含 `createRoot`）

## 为什么要 vendor 而不是 npm 依赖

0.4.7-D1 红线：面板 e2e 通道「不引入新 npm 依赖」。harness 只需要浏览器端 UMD 全局
（`window.React` / `window.ReactDOM`），把两个静态文件随仓库提交即可离线、可复现，
不动 `package.json`、不进发布包（`packages/dsh-notes-plugin` 的 files 不含 scripts/）。

## 来源与校验

拷贝自本机 `settings-page/node_modules/react{,-dom}/umd/`（npm registry 官方包，
version 字段 = 18.3.1）。换机器/重装无需任何动作——文件已随 git 提交。

## 为什么不是开发版

生产构建无 `act` 警告/开发期告警噪音，console error 断言（用例 32 零 console 错）
不会被 React 自身污染；面板真实运行环境（dsh web 壳）同样加载 React 生产态。
