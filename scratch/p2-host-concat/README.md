# P2·1 host 侧「加载时拼接」技术验证（scratch/p2-host-concat）

> 对应 spec：design/architecture-modular.md §8。本目录是一次性技术验证（PoC），不是组装器本体；
> 主窗口评审放行后，正式组装器（scripts/concat-host*.cjs + src/host/**）按 §8.5 绞杀者步骤另行落地。

## 文件

| 文件 | 作用 |
|---|---|
| `ranges.cjs` | 切片锚点清单：host-impl.js 26 片 / index.mjs 28 片（起始行行首前缀精确匹配，顺序解析，漂移即 throw） |
| `gen-parts.cjs` | 切片生成器：源单文件 → `out/src-host/**`、`out/pkg-host/**`（各带 manifest.js），并即时断言「manifest 串接（LF 归一）=== 源文件全文（LF 归一）」 |
| `concat-host-poc.cjs` | 组装器 PoC：与 scripts/concat-client.cjs 同一 manifest 解析契约（单引号路径一行一条、文本正则提取、逐字节零插入零改写、LF 归一） |
| `verify-dev-sandbox.cjs` | 开发版验证：沙箱 fs 形态读盘拼接 → `new Function('harness','pluginDir',src)` → mock ctx apply → 39 RPC/3 工具/2 注入注册计数 + 14 项行为冒烟 + 心跳（21 断言） |
| `verify-dist-build.cjs` | 发布版验证：拼接产物 → node --check → 动态 import 导出面 → harness 缺失/存在双通道（webServer 3 路由、tools 3 工具、POST /dsh-notes 全链路、40 RPC）（11 断言） |
| `result.txt` | 运行留档（含 check.js --core 107/0 与全量 578/0） |
| `out/` | 生成产物（切片、拼接结果、解析出的行区间 ranges-*.json、check 全量日志），可再生，不进版本库 |

## 复跑

```sh
node scratch/p2-host-concat/gen-parts.cjs            # 重新切片（含恒等自证）
node scratch/p2-host-concat/verify-dev-sandbox.cjs   # 开发版：21 断言
node scratch/p2-host-concat/verify-dist-build.cjs    # 发布版：11 断言
node check.js                                        # 全量回归（PoC 不触碰任何产物文件，应保持 578/0）
```

## 结论（2026-10-03 实跑，全部可复现）

1. 「加载时拼接」在沙箱引导壳链路可行：拼接产物与今日单文件逐字节一致（LF 归一），实例加载与行为冒烟全绿。
2. 构建期拼接对发布版 ESM 可行：产物逐字节一致 + node --check + import 导出面 + 双注册通道全绿。
3. 机制并非新发明：client 源下发（host-impl.js `notes-src` RPC / index.mjs 同名 RPC）已是「manifest + 逐条目读盘拼接 + LF 归一」的在役先例；host 侧只是把同一姿势挪进引导壳/构建脚本。
