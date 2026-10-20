# textEDA

用**人写的文本描述**来表达一块硬件：原理图（`sch`）与 PCB（`pcb`）是两个独立描述，互为兄弟；IR 是唯一真源，源码与任何渲染结果都是派生物。

面向 agent：机器可解析、可校验、错误可定位；人只负责评审。

> 这是**私有仓库**，项目在建中。当前落地的是工具链的前半段（语言 → IR → KiCad 导出 → 预览渲染），板级描述（`sch` / `pcb`）尚未实现。

## 现在能做什么

```bash
bun install
bun test                # 单元 + 契约 + round-trip
bun run typecheck       # 四个包一起过 tsc
bun run lib:verify      # 库级闭环：引用可解析、KiCad 能读能渲染、合并板 DRC 0 违规
bun run preview symbol bq24610rger     # 画符号（不依赖 KiCad）
bun run preview component bq24610rger  # 画器件的符号 + 封装
```

## 结构

| 路径 | 是什么 |
|---|---|
| `AGENTS.md` | **主文档**：项目是什么、不可协商的不变量、验证与验收口径 |
| `teda.md` | `.teda` 语法总览 |
| `spec/` | 分描述规范：`project` / `schematic` / `pcb` / `symbol` / `footprint` / `system` |
| `schemas/ir/v0.1/` | IR 契约（JSON Schema 2020-12，唯一契约） |
| `packages/ir` | IR 类型与契约校验 |
| `packages/parser` | `.teda` → IR，含 `fmt`（canonical form） |
| `packages/exporter` | 封装 / 符号 → KiCad（`.kicad_mod` / `.kicad_sym`） |
| `packages/renderer` | 参考渲染器：IR → 绘图指令 → SVG（ADR-0014） |
| `examples/reference-project/` | 自包含的参考工程：22 个器件 / 15 个符号 / 16 个封装，库全部自建 |
| `docs/adr/` | 决策记录（ADR），从 0001 到 0014 |
| `docs/backlog.md` | 待办清单 |

## 决策记录

- [ADR-0003](docs/adr/0003-agent-first-pcb-ir.md) agent-first 的 PCB IR
- [ADR-0004](docs/adr/0004-ir-representation.md) IR 形态与单位约定
- [ADR-0005](docs/adr/0005-manufacturing-output.md) 制造出口归 KiCad
- [ADR-0010](docs/adr/0010-footprint-and-3d-model-ownership.md) 自建封装与 3D 模型的所有权
- [ADR-0012](docs/adr/0012-symbol-description.md) 符号描述：引脚名与电气类型归器件
- [ADR-0013](docs/adr/0013-reference-project-self-built-libraries.md) 参考工程全部自建
- [ADR-0014](docs/adr/0014-reference-renderer.md) 自研参考渲染器，预览不依赖 KiCad

## 造器件

- [docs/symbol-authoring.md](docs/symbol-authoring.md) 造符号
- [docs/footprint-authoring.md](docs/footprint-authoring.md) 造封装
