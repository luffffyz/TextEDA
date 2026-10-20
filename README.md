# textEDA

用**人写的文本描述**来表达一块硬件：原理图（`sch`）与 PCB（`pcb`）是两个独立描述，互为兄弟；IR 是唯一真源，源码与任何渲染结果都是派生物。

面向 agent：机器可解析、可校验、错误可定位；人只负责评审。

> 本仓库按 **Apache-2.0** 授权（见 `LICENSE` / `NOTICE`），项目在建中。当前落地的是工具链的前半段（语言 → IR → KiCad 导出 → 预览渲染），板级描述（`sch` / `pcb`）尚未实现。
>
> **契约层永久开源**：`teda.md` / `spec/` / `schemas/` / `examples/` / `tests/` 永远公开可实现，不因商业理由关闭；实现层（`packages/`）可另行许可。定位是**标准提案**——让别人围绕它建工具。
>
> GitHub 上仓库**当前仍是私有**：许可与"将来一定公开"的承诺已经落定，切到 public 是待执行的一步，前置条件是先清掉厂商 datasheet（版权问题，见 `docs/backlog.md` F6）。详见 [ADR-0015](docs/adr/0015-licensing-and-open-standard.md)。

## 现在能做什么

```bash
bun install
bun test                # 单元 + 契约 + round-trip
bun run typecheck       # 四个包一起过 tsc
bun run lib:verify      # 库级闭环（**零外部依赖**）：引用可解析、导出成功、我们自己的渲染器出图并自检
bun run lib:verify:kicad  # 可选：追加 KiCad 互操作段（KiCad 能读能渲染、合并板 DRC 0 违规）
bun run preview symbol bq24610rger     # 画符号（不依赖 KiCad）
bun run preview component bq24610rger  # 画器件的符号 + 封装
```

## 结构

| 路径 | 是什么 |
|---|---|
| `AGENTS.md` | **主文档**：项目是什么、不可协商的不变量、验证与验收口径 |
| `LICENSE` / `NOTICE` | Apache-2.0 与归属声明 |
| `teda.md` | `.teda` 语法总览 |
| `spec/` | 分描述规范：`project` / `schematic` / `pcb` / `symbol` / `footprint` / `system` |
| `schemas/ir/v0.1/` | IR 契约（JSON Schema 2020-12，唯一契约） |
| `packages/ir` | IR 类型与契约校验 |
| `packages/parser` | `.teda` → IR，含 `fmt`（canonical form） |
| `packages/exporter` | 封装 / 符号 → KiCad（`.kicad_mod` / `.kicad_sym`） |
| `packages/renderer` | 参考渲染器：IR → 绘图指令 → SVG（ADR-0014） |
| `examples/reference-project/` | 自包含的参考工程：22 个器件 / 15 个符号 / 16 个封装，库全部自建 |
| `docs/adr/` | 决策记录（ADR），从 0001 到 0018 |
| `docs/backlog.md` | 待办清单 |

## 决策记录

- [ADR-0003](docs/adr/0003-agent-first-pcb-ir.md) agent-first 的 PCB IR
- [ADR-0004](docs/adr/0004-ir-representation.md) IR 形态与单位约定
- [ADR-0005](docs/adr/0005-manufacturing-output.md) 制造出口归 KiCad（当前实现路径）
- [ADR-0010](docs/adr/0010-footprint-and-3d-model-ownership.md) 自建封装与 3D 模型的所有权
- [ADR-0012](docs/adr/0012-symbol-description.md) 符号描述：引脚名与电气类型归器件
- [ADR-0013](docs/adr/0013-reference-project-self-built-libraries.md) 参考工程全部自建
- [ADR-0014](docs/adr/0014-reference-renderer.md) 自研参考渲染器，预览不依赖 KiCad
- [ADR-0015](docs/adr/0015-licensing-and-open-standard.md) 许可与开放策略：契约层永久开源，按标准提案定位
- [ADR-0018](docs/adr/0018-zero-dependency-and-manufacturing-target.md) 零依赖原则与制造出口目标形态：KiCad 是可选后端

## 造器件

- [docs/symbol-authoring.md](docs/symbol-authoring.md) 造符号
- [docs/footprint-authoring.md](docs/footprint-authoring.md) 造封装
