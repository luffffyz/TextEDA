# TextEDA

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/svg/texteda-logo-dark.svg">
    <img src="docs/assets/svg/texteda-logo.svg" width="420" alt="TextEDA — 用文本描述硬件">
  </picture>
</p>

[English](README.md) | [简体中文](README_cn.md)

用**人写的文本描述**来表达一块硬件：原理图（`sch`）与 PCB（`pcb`）是两个独立描述，互为兄弟；IR 是唯一真源，源码与任何渲染结果都是派生物。

**Agent 优先，人来评审。** 机器负责读设计、查错误、改设计；人负责在东西交付前读一遍。所有东西都是纯文本——包括错误本身，会指到具体哪个文件、哪一行。

> 本仓库按 **Apache-2.0** 授权（见 `LICENSE` / `NOTICE`），项目在建中。
>
> **契约层永久开源**：`teda.md` / `spec/` / `schemas/` / `examples/` / `tests/` 永远公开可实现，不改为闭源；实现层（`packages/`）可另行许可。定位是**纯开源技术规范**——没有商业计划、没有收入模型、没有付费服务。实现契约所需的一切都免费且不受限制，且不会变。目标只有一个：**被采用**（规范被引用、被实现、被别人的工具链依赖）。
>
> GitHub 上仓库**已公开**（[luffffyz/TextEDA](https://github.com/luffffyz/TextEDA)）。公开前的内部信息清扫已通过（`bun run check:public`：历史里没有厂商 datasheet、没有凭据、没有维护者的机器路径），并已固化为每次 push 的门禁。详见 [ADR-0015](docs/adr/0015-licensing-and-open-standard.md) 与 `docs/backlog.md` F6。

## 现在能做什么

```bash
bun install
bun test                # 单元 + 契约 + round-trip
bun run typecheck       # 六个包一起过 tsc
bun run lib:verify      # 库级闭环（**零外部依赖**）
bun run lib:verify:kicad  # 可选：追加 KiCad 互操作段（KiCad 能读能渲染、合并板 DRC 0 违规）
bun run check:links      # 全部 Markdown 链接与 ADR 交叉引用可解析
bun run check:public     # 公开清扫：查全历史——没有厂商 PDF、没有凭据、没有维护者路径
bun run preview symbol bq24610rger     # 画符号（不依赖 KiCad）
bun run preview component bq24610rger  # 画器件的符号 + 封装
bun run preview view charger-buck/buck-5v  # 画原理图打印页（从视图文件，不依赖 KiCad）
bun run fmt:teda --check examples/reference-project   # canonical form 检查
bun run compile:schematic examples/reference-project mcu-board   # 板级 IR（诊断带错误码）
bun run check examples/reference-project          # 校验工程里全部板（ERC + IR 契约）
bun run texteda netlist examples/reference-project --board mcu-board  # 网表 = IR 的连通性投影
bun run texteda ir examples/reference-project      # 写出 IR 分片树（canonical JSON + manifest + 哈希）
bun run texteda init ./my-board        # 生成空工程骨架
```

当前状态：工具链前半段已落地（语言 → IR → KiCad 导出 → 预览渲染）。`schematic` 解析（实例、net、port、约束、bus——一块板一份扁平文件，[ADR-0025](docs/adr/0025-flat-board-and-print-pages.md)）、`module` 解析（板由带端口的模块组成，IR 仍是平表，[ADR-0026](docs/adr/0026-modules-compose-boards.md)）、`view` 解析（S1 打印页）、`pcb` 解析（12 段 → `pcb` IR）、footprint / symbol / schematic / module / pcb / view 的 canonical formatter、连通性 ERC 与 sch↔pcb 绑定校验（`packages/core`）都能用，原理图打印页可从视图文件出图（`bun run preview view <board>/<page>`），整个工程可编译成带 manifest 与哈希的 IR 分片树（`bun run texteda ir <工程目录>`，[ADR-0023](docs/adr/0023-ir-layer-on-disk.md)）。板级设计（布局、布线、制造出口）未实现；KiCad 仍是制造出口（[ADR-0005](docs/adr/0005-manufacturing-output.md)）。

给 agent 用的两份派生物（都由 `bun run gen` 生成，不手改）：

| 文件 | 回答什么 |
|---|---|
| `docs/error-codes.md` | 诊断码 → 含义、严重度、对应规范 |
| `docs/ir-reference.md` | IR 字段 → 类型、必填、**单位**、说明（覆盖率清单在文末） |

手写的一份，给要从零建工程的 agent：[docs/skills/new-project.md](docs/skills/new-project.md)——每一步都是一条命令、预期输出，以及失败时该看哪个诊断码。

## 对比

TextEDA 不是 GUI EDA 工具，也不打算变成一个。它站在编辑器上面一层：文本描述语言 + 类型化 IR 作为唯一真源，再加校验器、参考渲染器与导出器。

| | TextEDA | KiCad | EasyEDA | tscircuit |
|---|---|---|---|---|
| **你编辑的东西** | `.teda` 文本——`sch` 与 `pcb` 是互不依赖的兄弟 | `.kicad_sch` / `.kicad_pcb` s-表达式 | JSON 工程源文件 | TypeScript / TSX 代码 |
| **类型化 IR** | JSON Schema 2020-12、canonical JSON、只用整数单位 | 没有独立层，文件本身就是模型 | JSON 工程格式 | `circuit-json`（zod） |
| **校验** | 连通性 ERC + sch↔pcb 绑定 + IR 契约 | 内置 ERC 与 DRC | DRC | zod + 写在 IR 里的告警 |
| **布局 / 布线** | 借用（KiCad、freerouting） | 内置 | 内置 | 代码里算 |
| **制造出口** | 尚未实现（F15）；目标形态是制造中立数据 | 内置 | 内置，可一键下单 | Gerber / BOM / 坐标转换器 |
| **Agent 接入方式** | 文本 + 类型化 IR + 冻结的诊断码 | Python 与 `kicad-cli` | API SDK + WebSocket 桥接的 AI skill | agent 直接写程序 |
| **许可** | Apache-2.0，契约层永久开源 | GPL-3.0+，库为 CC-BY-SA 4.0 | 编辑器闭源，SDK 为 Apache-2.0 | MIT |

带出处与日期的完整对比——**包括 TextEDA 还没做到的部分**——见 [docs/comparison.md](docs/comparison.md)。

## CI

`.github/workflows/ci.yml` 在每次 push 与指向 `main` 的 PR 上运行。**必过段零外部依赖**——只要 Bun，不需要 KiCad：

`bun test` · `bun run typecheck` · `bun run gen:check` · `bun run lib:verify` · `bun run check:links` · `bun run check:public` · `bun run fmt:teda --check .`

KiCad 互操作段是**独立的可选 workflow**（`.github/workflows/ci-kicad.yml`，定时 + 手动触发），因为门禁不得依赖外部软件（[ADR-0018](docs/adr/0018-zero-dependency-and-manufacturing-target.md)）。

## 结构

| 路径 | 是什么 |
|---|---|
| `AGENTS.md` | **主文档**：项目是什么、不可协商的不变量、验证与验收口径 |
| `LICENSE` / `NOTICE` | Apache-2.0 与归属声明 |
| `spec/` | 分描述规范：`symbol` / `footprint` / `pcb` / `schematic-view` / `module` |
| `schemas/ir/v0.2/` | IR 契约（JSON Schema 2020-12，唯一契约） |
| `packages/ir` | IR 类型与契约校验 |
| `packages/parser` | `.teda` → IR，含 `fmt`（canonical form）；`module` 文件展平进板级 IR |
| `packages/core` | 纯规则：连通性 ERC 与 sch↔pcb 绑定，不碰 fs |
| `packages/exporter` | 封装 / 符号 → KiCad（`.kicad_mod` / `.kicad_sym`）；网表 |
| `packages/renderer` | 参考渲染器：IR → 绘图指令 → SVG（[ADR-0014](docs/adr/0014-reference-renderer.md)） |
| `packages/cli` | `texteda init` / `compile` / `check` / `netlist` / `ir`（[ADR-0019](docs/adr/0019-agent-contract-reference-and-check-entry.md)、[ADR-0023](docs/adr/0023-ir-layer-on-disk.md)） |
| `examples/reference-project/` | 自包含的参考工程：22 个器件 / 15 个符号 / 16 个封装，库全部自建 |
| `docs/adr/` | 决策记录（ADR），0001–0026（[完整索引](docs/adr/README.md)；0017 与 0020 已预留） |
| `docs/assets/` | 品牌资产（标志、图标、生成脚本）；字体二进制不入库 |
| `docs/backlog.md` | 待办清单 |
| `docs/comparison.md` | 与 KiCad、EasyEDA、tscircuit 的对比（带出处） |
| `docs/error-codes.md` / `docs/ir-reference.md` | 生成的契约参考（不手改） |
| `scripts/` | 仓库工具：链接检查、公开清扫、库校验、预览 |

## 决策记录

- [ADR-0001](docs/adr/0001-board-linking.md) 板之间如何连接
- [ADR-0002](docs/adr/0002-board-pages-and-bom.md) 板内分页、展平与 BOM 计数
- [ADR-0003](docs/adr/0003-agent-first-pcb-ir.md) agent-first 的 PCB IR
- [ADR-0004](docs/adr/0004-ir-representation.md) IR 形态与单位约定
- [ADR-0005](docs/adr/0005-manufacturing-output.md) 制造出口归 KiCad
- [ADR-0006](docs/adr/0006-jlc-prototype-delivery.md) 嘉立创打样交付：BOM、坐标、料号绑定
- [ADR-0007](docs/adr/0007-page-internal-net-naming.md) 展平后的 net 集合与命名
- [ADR-0008](docs/adr/0008-ir-shard-identity-and-hash.md) IR 分片、身份键、单位与哈希粒度
- [ADR-0009](docs/adr/0009-implementation-stack.md) 实现栈：TypeScript、Bun、渲染分层、IDE 接入面
- [ADR-0010](docs/adr/0010-footprint-and-3d-model-ownership.md) 自建封装与 3D 模型的所有权
- [ADR-0011](docs/adr/0011-library-format-and-footprint-ir.md) 自建封装库用自己的格式
- [ADR-0012](docs/adr/0012-symbol-description.md) 符号描述：引脚名与电气类型归器件
- [ADR-0013](docs/adr/0013-reference-project-self-built-libraries.md) 参考工程全部自建
- [ADR-0014](docs/adr/0014-reference-renderer.md) 自研参考渲染器，预览不依赖 KiCad
- [ADR-0015](docs/adr/0015-licensing-and-open-standard.md) 许可与开放策略：契约层永久开源，项目是纯开源技术规范
- [ADR-0016](docs/adr/0016-diagnostic-error-codes.md) 诊断错误码注册表：`域.slug`，发出即冻结
- [ADR-0018](docs/adr/0018-zero-dependency-and-manufacturing-target.md) 零依赖原则与制造出口目标形态：KiCad 是可选后端
- [ADR-0019](docs/adr/0019-agent-contract-reference-and-check-entry.md) agent 契约参考与 `check` 入口
- [ADR-0021](docs/adr/0021-schematic-view-layer.md) S1 视图层：画法是独立的描述类型
- [ADR-0022](docs/adr/0022-language-versioning.md) 语言版本：`MAJOR.MINOR[.PATCH]`，`1.0` 是冻结点
- [ADR-0023](docs/adr/0023-ir-layer-on-disk.md) 落盘的 IR 层：分片树、manifest、哈希
- [ADR-0024](docs/adr/0024-level-tags-in-flattened-names.md) 展平名字里的层级标记（`M1.R1`）
- [ADR-0025](docs/adr/0025-flat-board-and-print-pages.md) 一板一份扁平原理图；页面变成视图层的打印页
- [ADR-0026](docs/adr/0026-modules-compose-boards.md) 板由模块组成；IR 仍是平表

完整索引（含标题、状态、日期）见 [docs/adr/README.md](docs/adr/README.md)。

## 造器件

- [docs/symbol-authoring.md](docs/symbol-authoring.md) 造符号
- [docs/footprint-authoring.md](docs/footprint-authoring.md) 造封装

## 语言策略

源码（`.ts`、schema、`.teda` 示例）只允许英文。**文档默认英文**——`docs/`、`spec/`、`teda.md`、ADR 与 `README.md` 都是英文；只有被明确要求时才写中文，若觉得某份文档用中文更合适，先问。本规则之前写下的文档保持原语言。`README_cn.md` 是本文件的中文镜像，按定义保持中文。
