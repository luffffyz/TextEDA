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
> **契约层永久开源**：`spec/`（含 `spec/teda.md`）/ `schemas/` / `examples/` / `tests/` 永远公开可实现，不改为闭源；实现层（`packages/`）可另行许可。定位是**纯开源技术规范**——没有商业计划、没有收入模型、没有付费服务。实现契约所需的一切都免费且不受限制，且不会变。目标只有一个：**被采用**（规范被引用、被实现、被别人的工具链依赖）。
>
> GitHub 上仓库**已公开**（[luffffyz/TextEDA](https://github.com/luffffyz/TextEDA)）。公开前的内部信息清扫已通过（`bun run check:public`：历史里没有厂商 datasheet、没有凭据、没有维护者的机器路径），并已固化为每次 push 的门禁。详见 [ADR-0138](docs/adr/process/0138-licensing-and-open-standard.md) 与 `docs/backlog.md` F6。

## 现在能做什么

```bash
bun install
bun test                # 单元 + 契约 + round-trip 测试
bun run typecheck       # 七个包一起过 tsc
bun run lib:verify      # 库级闭环（**零外部依赖**）
bun run lib:verify:kicad  # 可选：追加 KiCad 互操作段（KiCad 能读能渲染、合并板 DRC 0 违规）
bun run check:links      # 全部 Markdown 链接与 ADR 交叉引用可解析
bun run check:public     # 公开清扫：查全历史——没有厂商 PDF、没有凭据、没有维护者路径
bun run cases:check      # 钉住的十用例语料（已写了哪些见 examples/cases/）
bun run preview symbol bq24610rger     # 画符号（不依赖 KiCad）
bun run preview component bq24610rger  # 画器件的符号 + 封装
bun run preview view charger-buck/buck-5v  # 画原理图打印页（从视图文件，不依赖 KiCad）
bun run fmt:teda --check examples/reference-project   # canonical form 检查
bun run check examples/reference-project          # 解析、IR 契约、ERC、绑定、器件、额定值、选料、评审轮次
bun run texteda ir examples/reference-project      # 写出 IR 分片树（canonical JSON + manifest + 哈希）
bun run texteda netlist examples/reference-project --board mcu-board  # 网表 = IR 的连通性投影
bun run texteda bom examples/reference-project charger-buck   # 物料表，带选料状态
bun run texteda view-metrics examples/reference-project charger-buck/buck-5v  # 打印页可读性数值
bun run texteda review examples/reference-project   # 在 127.0.0.1 上服务评审 app（--out 写一份 HTML）
bun run texteda id examples/reference-project --count 3  # 生成工程内未使用的实例 UID
bun run texteda renumber examples/reference-project charger-buck --policy compact  # 试跑一次经过校验的位号重编号
bun run texteda init ./my-board        # 生成空工程骨架
```

当前状态，按层看：

**描述。** 工程可以写 `schematic`（实例、net、port、约束、bus——一块板一份扁平文件，[ADR-0111](docs/adr/schematic/0111-one-flat-schematic-per-board.md)）；用带端口的 `module` 文件组合板，展平进板级 IR、IR 仍是平表（[ADR-0112](docs/adr/schematic/0112-modules-compose-boards.md)）；用 `view` 打印页画图，它是独立描述、永远不进构建（[ADR-0134](docs/adr/view/0134-the-view-layer-is-a-drawing.md) D1、D5）；用 `pcb` 描述物理事实与规则意图（12 段，[ADR-0115](docs/adr/pcb/0115-agent-first-pcb-description.md)）；布局与布线是 agent 驱动的循环（[ADR-0116](docs/adr/pcb/0116-layout-and-routing-are-agent-driven.md)），不内建求解器；用 `system` 描述经声明端口的跨板连接（[ADR-0108](docs/adr/project/0108-board-linking.md)）；用 `procurement` 决定这块板买哪颗（主料 + 备料，[ADR-0128](docs/adr/devices/0128-the-procurement-layer.md)）；用 `component` 备器件——`kind: part` 带料号，`kind: generic` 把取值留给实例行（[ADR-0123](docs/adr/devices/0123-the-device-kind-is-part-or-generic.md) D1、D2）——再用 `symbol` / `footprint` 写几何，引脚的电学事实仍归器件（[ADR-0130](docs/adr/libraries/0130-symbol-format.md)）。`project.toml` 是最外层的元数据。除 `component` 外，`fmt` 对上面每一种描述都写 canonical form。库是**模板，不是依赖**：`texteda lib import` 把一颗器件和它引用的符号 / 封装拷进 `assets/`、写成裸 id、加上来源头注释，并盖上每个文件自己的版本号（[ADR-0133](docs/adr/libraries/0133-trust-in-a-library-you-do-not-own.md) D2、D6）。

**检查。** `texteda check` 一次跑完：解析、IR 契约、连通性 ERC、sch↔pcb 绑定（包括每一对声明的 `connect` 是否真有铜箔兑现，以及把部分布局**报出来**而不是静默通过，[ADR-0119](docs/adr/pcb/0119-connect-pairs-need-copper.md)、[ADR-0118](docs/adr/pcb/0118-a-partial-layout-is-legal.md)）、器件词表与参数角色（[ADR-0124](docs/adr/devices/0124-device-vocabulary-and-parameter-roles.md)）、额定值对不对得上声明的窗口、耗散对不对得上声明的上限（[ADR-0125](docs/adr/devices/0125-a-part-states-its-own-ratings.md) D8、D11）、选料、评审轮次是否闭环与处置人是否越权（[ADR-0136](docs/adr/view/0136-review-records-and-attribution.md)），以及板 ↔ 打印页交叉校验与可读性数值。参考工程上是 **0 error**；那些 warning 是它诚实的现状——`mcu-board` 是块 bring-up 板，没有 `pcb`，选料表是空的。

**画。** 参考渲染器把符号、封装与原理图打印页画成 SVG，自带笔画字体，不需要装 KiCad（[ADR-0135](docs/adr/view/0135-our-own-reference-renderer.md)）；三者各自被 `extract(render(ir)) == ir` 闭环。`texteda review` 把打印页服务给浏览器，hover 高亮、点击选中，或者把同一份东西写成一个自包含 HTML 文件。

**导出与哈希。** KiCad `.kicad_mod` / `.kicad_sym`、网表（IR 的连通性投影）、物料表。`texteda export gerbers` 把铜层、阻焊、锡膏、丝印写成 RS-274X，全部孔写成一份 Excellon，**铜皮在导出时重算**——IR 与任何哈希里都没有预存的填充（[ADR-0117](docs/adr/pcb/0117-copper-fill-uses-a-geometry-kernel.md)）。`texteda ir` 写 `dist/ir/`：每种描述一份 canonical JSON 分片、一份带每片 sha256 的 manifest、一个覆盖**规范**分片的工程哈希，以及另一个 `advisory_hash`——画（打印页）与第二货源（备料）属于附注类（[ADR-0105](docs/adr/ir/0105-ir-shards-and-hashes.md)）。

**还没落地。** agent 驱动的布局与布线循环（[ADR-0116](docs/adr/pcb/0116-layout-and-routing-are-agent-driven.md)，无内置求解器）、`.kicad_pcb` 板写出器与 `fab` 描述（backlog F15 / F14，[ADR-0120](docs/adr/manufacturing/0120-the-manufacturing-output-path.md)；Gerber 层集合与钻孔已落地）、KiCad 原理图导出（F16）、逆向工程与外部网表的导入器（F36）、评审 GUI 的 `layout` / `placement` / `edit` 模式（F34；点击跳源码已落地）、模块参数与嵌套（F13），以及把引用整体重键到实例 UID（实例已有稳定 `uid`，但改 refdes 仍会改源码与哈希；[ADR-0109](docs/adr/project/0109-instance-identity-is-a-uid.md)）。KiCad 是当前兜底，直到自研制造出口落地（[ADR-0120](docs/adr/manufacturing/0120-the-manufacturing-output-path.md) D1、D3）。

给 agent 用的两份派生物（都由 `bun run gen` 生成，不手改）：

| 文件 | 回答什么 |
|---|---|
| `docs/error-codes.md` | 诊断码 → 含义、严重度、对应规范（162 条，域词表封闭） |
| `docs/ir-reference.md` | IR 字段 → 类型、必填、**单位**、说明（覆盖率清单在文末） |

手写的一份，给要从零建工程的 agent：[docs/skills/new-project.md](docs/skills/new-project.md)——每一步都是一条命令、预期输出，以及失败时该看哪个诊断码。

## 对比

TextEDA 不是 GUI EDA 工具，也不打算变成一个。它站在编辑器上面一层：文本描述语言 + 类型化 IR 作为唯一真源，再加校验器、参考渲染器与导出器。

TextEDA 的完整对比按三个透镜组织——商业全流程 GUI、开源/低成本 GUI、代码/文本优先——另有 AI 原生托管工具作为相邻一类；这份表格是短版。代表工具：Altium、Cadence、Siemens（商业）；KiCad、EasyEDA、LibrePCB、Horizon（开源/低成本）；atopile、tscircuit、SKiDL、JITX（代码/文本优先）；heypcb、Flux（AI 原生托管）。

| | TextEDA | KiCad | EasyEDA | tscircuit |
|---|---|---|---|---|
| **你编辑的东西** | `.teda` 文本——`sch` 与 `pcb` 是互不依赖的兄弟 | `.kicad_sch` / `.kicad_pcb` s-表达式 | JSON 工程源文件 | TypeScript / TSX 代码 |
| **类型化 IR** | JSON Schema 2020-12、canonical JSON、只用整数单位 | 没有独立层，文件本身就是模型 | JSON 工程格式 | `circuit-json`（zod） |
| **校验** | 连通性 ERC · sch↔pcb 绑定 · 器件规则与额定值 · 选料 · IR 契约 | 内置 ERC 与 DRC | DRC | zod + 写在 IR 里的告警 |
| **评审** | 浏览器里看渲染出的打印页：hover、选中；画法是源文件，不是重建 | 原理图与 PCB 编辑器 | 原理图与 PCB 编辑器 | web 查看器 |
| **布局 / 布线** | agent 驱动、checker 门控、无内置求解器（[ADR-0116](docs/adr/pcb/0116-layout-and-routing-are-agent-driven.md)） | 内置 | 内置 | 代码里算 |
| **制造出口** | Gerber 层集合（铜 / 阻焊 / 锡膏 / 丝印 / 板框）+ Excellon 钻孔已落地；`fab` 制造包未落地（F15 / F14） | 内置 | 内置，可一键下单 | Gerber / BOM / 坐标转换器 |
| **Agent 接入方式** | 文本 + 类型化 IR + 冻结的诊断码 + 结构化布局工具（roadmap） | Python 与 `kicad-cli` | API SDK + WebSocket 桥接的 AI skill | agent 直接写程序 |
| **许可** | Apache-2.0，契约层永久开源 | GPL-3.0+，库为 CC-BY-SA 4.0 | 编辑器闭源，SDK 为 Apache-2.0 | MIT |

带出处与日期的完整三透镜对比——**包括 TextEDA 还没做到的部分**——见 [docs/comparison.md](docs/comparison.md)。

## CI

`.github/workflows/ci.yml` 在每次 push 与指向 `main` 的 PR 上运行。**必过段零外部依赖**——只要 Bun，不需要 KiCad：

`bun test` · `bun run typecheck` · `bun run gen:check` · `bun run lib:verify` · `bun run check:links` · `bun run check:public` · `bun run fmt:teda --check .`

KiCad 互操作段是**独立的可选 workflow**（`.github/workflows/ci-kicad.yml`，定时 + 手动触发），因为门禁不得依赖外部软件（[ADR-0120](docs/adr/manufacturing/0120-the-manufacturing-output-path.md)）。

## 工程结构

`texteda init` 生成的工程按**归属**分组，不按工具分组（[ADR-0107](docs/adr/project/0107-project-tree-has-owners.md)）：

```text
my-board/
├── project.toml              # 名称 / 版本 / 格式
├── assets/                   # 工程自有的器件资产
│   ├── components/           # 件与通用器件；kind 写在文件里
│   ├── symbols/
│   ├── footprints/
│   └── procurement/          # primary/ + alternatives/
├── design/                   # 电路源码
│   ├── sch/<board>.teda
│   ├── pcb/<board>.teda
│   ├── modules/<module>.teda
│   └── system/<system>.teda
├── views/
│   └── <board>/<page>.view.teda  # S1 打印页；进仓库、不进构建身份
├── docs/                     # 意图、评审记录、证据
├── external/                 # 外购材料；cache/ 本地且被忽略
└── dist/                     # 生成输出；已 gitignore
```

`assets/**` 与 `design/**` 是输入；`views/**` 是手写、进仓库，但不参与构建身份；`dist/**` 是派生输出（`texteda ir` 写出 `dist/ir/`）。

## 仓库结构

| 路径 | 是什么 |
|---|---|
| `AGENTS.md` | **主文档**：项目是什么、不可协商的不变量、验证与验收口径 |
| `LICENSE` / `NOTICE` | Apache-2.0 与归属声明 |
| `spec/` | 规范：`teda.md`（语言总规范）+ 分描述规范 `symbol` / `footprint` / `pcb` / `schematic-view` / `module` / `procurement` |
| `schemas/ir/` | IR 契约（JSON Schema 2020-12，唯一契约）；契约版本就是目录名 |
| `packages/ir` | IR 类型、契约校验，与诊断码注册表 |
| `packages/parser` | 每种描述的 `.teda` → IR，含 `fmt`（canonical form）；`module` 文件展平进板级 IR |
| `packages/core` | 纯规则，不碰 fs：连通性 ERC、sch↔pcb 绑定、器件词表与额定值、选料、评审轮次、板 ↔ 视图校验与可读性 |
| `packages/exporter` | 封装 / 符号 → KiCad（`.kicad_mod` / `.kicad_sym`）；网表 |
| `packages/renderer` | 参考渲染器：IR → 绘图指令 → SVG，以及把 round-trip 闭环的反解（[ADR-0135](docs/adr/view/0135-our-own-reference-renderer.md)） |
| `packages/viewer` | 评审 app 的浏览器端：画面、hover 高亮、选身份；无框架、画布不可编辑（[ADR-0134](docs/adr/view/0134-the-view-layer-is-a-drawing.md)） |
| `packages/cli` | `texteda init` / `id` / `compile` / `check` / `netlist` / `ir` / `bom` / `view-metrics` / `review` / `renumber` / `lib import`（[ADR-0137](docs/adr/process/0137-implementation-stack-and-agent-entry.md)、[ADR-0105](docs/adr/ir/0105-ir-shards-and-hashes.md)） |
| `examples/reference-project/` | 自包含的参考工程：两块板（一块带 `pcb`，两张打印页）、器件与符号封装全部自建，库全部自建，另有选料文件与三轮评审记录 |
| `examples/cases/` | 十个困难用例：每个都是完整小工程，用期望 IR 与期望诊断钉住（已写了哪些看目录；`bun run cases:check`） |
| `docs/adr/` | 决策记录（ADR）（[完整索引](docs/adr/README.md)） |
| `docs/guides/` | 上手指南：造符号、造封装、导入外部库、记评审记录、多角色评审、开评审 app、读 KiCad 板文件、位号重编号 |
| `docs/skills/` | 给 agent 的操作手册：每步 = 命令 + 预期输出 + 出错看哪个诊断码 |
| `docs/trial-run/` | 历史快照：KiCad 端到端试跑，pcb 描述 → `.kicad_pcb` → DRC + Gerber（早于自建库落地） |
| `docs/assets/` | 品牌资产（标志、图标、生成脚本）；字体二进制不入库 |
| `docs/backlog.md` | 待办清单 |
| `docs/comparison.md` | 与商业全流程 GUI、开源/低成本 GUI、代码/文本优先工具的三透镜对比（带出处） |
| `docs/error-codes.md` / `docs/ir-reference.md` | 生成的契约参考（不手改） |
| `scripts/` | 仓库工具：链接检查、公开清扫、库校验、用例语料、迁移、预览 |

## 决策记录

**语言与 IR**
- [ADR-0100](docs/adr/language/0100-fact-layer-has-no-expressions.md) The Fact Layer Has No Expressions; Generators Live Outside the Language
- [ADR-0101](docs/adr/language/0101-one-language-version-number.md) One Language Version Number
- [ADR-0102](docs/adr/language/0102-diagnostic-error-codes.md) Diagnostic Error Code Registry (`domain.slug`)
- [ADR-0103](docs/adr/language/0103-source-spans.md) Source Spans — Diagnostics Point at the File, the IR Stays Clean
- [ADR-0104](docs/adr/ir/0104-ir-representation.md) IR Representation (Semantic Model / Contract / Serialization)
- [ADR-0105](docs/adr/ir/0105-ir-shards-and-hashes.md) IR Sharding, Identity Keys, and Hashes
- [ADR-0106](docs/adr/ir/0106-device-description-enters-the-ir.md) A Device's Description Is a Fact, So It Enters the IR

**板与连通性**
- [ADR-0107](docs/adr/project/0107-project-tree-has-owners.md) The Project Tree Has Owners
- [ADR-0108](docs/adr/project/0108-board-linking.md) How Boards Are Linked Together
- [ADR-0109](docs/adr/project/0109-instance-identity-is-a-uid.md) Instance Identity Is a Stable Project-Local UID, Not the Refdes
- [ADR-0110](docs/adr/project/0110-renumbering-is-a-code-executed-rename.md) Renumbering Is a Code-Executed Global Rename, Not an Agent Edit
- [ADR-0111](docs/adr/schematic/0111-one-flat-schematic-per-board.md) One Flat Schematic per Board; the Partition Moves to the View Layer
- [ADR-0112](docs/adr/schematic/0112-modules-compose-boards.md) A Board Is Composed of Modules; the IR Stays Flat
- [ADR-0113](docs/adr/schematic/0113-connectivity-has-one-authority.md) Connectivity Has One Authority; Reverse Engineering Is an Import, Not a Mode
- [ADR-0114](docs/adr/schematic/0114-flattening-and-the-net-set.md) Flattening and the Net Set

**布局、绘图与评审**
- [ADR-0115](docs/adr/pcb/0115-agent-first-pcb-description.md) Agent-First PCB Description (Segment Set and Trade-offs)
- [ADR-0116](docs/adr/pcb/0116-layout-and-routing-are-agent-driven.md) Layout and Routing Are Agent-Driven, Checker-Gated, and Frozen on Acceptance
- [ADR-0117](docs/adr/pcb/0117-copper-fill-uses-a-geometry-kernel.md) Copper Fill Uses a Self-Built Constrained Geometry Kernel
- [ADR-0118](docs/adr/pcb/0118-a-partial-layout-is-legal.md) A Partial Layout Is Legal, and It Is Reported
- [ADR-0119](docs/adr/pcb/0119-connect-pairs-need-copper.md) A Declared `connect` Pair Must Be Implemented by Copper
- [ADR-0134](docs/adr/view/0134-the-view-layer-is-a-drawing.md) The View Layer Is an Independent Description, and the View Is a Drawing, Not a Build Input
- [ADR-0135](docs/adr/view/0135-our-own-reference-renderer.md) Our Own Reference Renderer — IR → Drawing Commands → SVG
- [ADR-0136](docs/adr/view/0136-review-records-and-attribution.md) Review Is Not a Description Type — Notes, Decisions, and the One Accountable Person

**器件、库与采购**
- [ADR-0123](docs/adr/devices/0123-the-device-kind-is-part-or-generic.md) The Device Kind Is `part` or `generic`, and the Devices Live in One Directory
- [ADR-0124](docs/adr/devices/0124-device-vocabulary-and-parameter-roles.md) The Device Vocabulary Is Closed and Checked; a Parameter Is a Role and a Quantity
- [ADR-0125](docs/adr/devices/0125-a-part-states-its-own-ratings.md) A Part States Its Own Ratings, and They Are Checked Against Declared Windows
- [ADR-0126](docs/adr/devices/0126-the-package-gives-a-chip-resistor-its-floor.md) The Package Gives a Chip Resistor Its Floor
- [ADR-0127](docs/adr/devices/0127-package-code-and-3d-models.md) The Package Code Lives in the Footprint; 3D Models Belong to Parts
- [ADR-0128](docs/adr/devices/0128-the-procurement-layer.md) The Procurement Layer — Which Part to Buy Is a Project-Local Decision
- [ADR-0129](docs/adr/libraries/0129-footprint-format-and-geometry.md) Footprint Geometry and 3D Models Do Not Enter the Language; Our Own Footprint Format Is the Source
- [ADR-0130](docs/adr/libraries/0130-symbol-format.md) Self-Built Symbol Libraries Use Our Own Format
- [ADR-0131](docs/adr/libraries/0131-the-reference-project-is-self-built.md) The Reference Project Is Entirely Self-Built
- [ADR-0132](docs/adr/libraries/0132-libraries-are-unverified-facts.md) Libraries Are Unverified Facts; Provenance, Disclaimers, and Corrections
- [ADR-0133](docs/adr/libraries/0133-trust-in-a-library-you-do-not-own.md) Trust in a Library You Do Not Own

**制造与流程**
- [ADR-0120](docs/adr/manufacturing/0120-the-manufacturing-output-path.md) The Manufacturing Output Path and Its Target Form
- [ADR-0121](docs/adr/manufacturing/0121-jlc-prototype-delivery.md) JLC Prototype Delivery (BOM / Coordinates / Part Number)
- [ADR-0122](docs/adr/manufacturing/0122-the-output-package-carries-its-provenance.md) The Output Package Carries Its Own Provenance
- [ADR-0137](docs/adr/process/0137-implementation-stack-and-agent-entry.md) Implementation Stack and the Agent's Entry Point
- [ADR-0138](docs/adr/process/0138-licensing-and-open-standard.md) Licensing and Openness Policy
- [ADR-0139](docs/adr/process/0139-process-entities-outside-the-language.md) Process Entities Stay Outside the Language
- [ADR-0140](docs/adr/process/0140-documentation-has-one-authority-per-fact.md) Documentation Has One Authority per Fact, and the Rest Is a Pointer

完整索引（含标题、状态、日期）见 [docs/adr/README.md](docs/adr/README.md)。

## 造器件

- [docs/guides/symbol-authoring.md](docs/guides/symbol-authoring.md) 造符号
- [docs/guides/footprint-authoring.md](docs/guides/footprint-authoring.md) 造封装
- [docs/guides/library-import.md](docs/guides/library-import.md) 把外部库当模板导入
- [docs/guides/review-records.md](docs/guides/review-records.md) 记评审记录
- [docs/guides/role-reviews.md](docs/guides/role-reviews.md) 多角色跑一轮评审
- [docs/guides/review-app.md](docs/guides/review-app.md) 打开评审 app
- [docs/guides/kicad-pcb-format.md](docs/guides/kicad-pcb-format.md) 读 KiCad 板文件

## 语言策略

源码（`.ts`、schema、`.teda` 示例）只允许英文。**文档默认英文**——`docs/`、`spec/`（含 `spec/teda.md`）、ADR 与 `README.md` 都是英文；只有被明确要求时才写中文，若觉得某份文档用中文更合适，先问。本规则之前写下的文档保持原语言。`README_cn.md` 是本文件的中文镜像，按定义保持中文。
