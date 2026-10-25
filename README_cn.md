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
> **契约层永久开源**：`spec/`（含 `spec/teda.md`）/ `schemas/` / `examples/` / `tests/` 永远公开可实现，不改为闭源；实现层（`packages/`）可另行许可。定位是**纯开源技术规范**——没有商业计划、没有收入模型、没有付费服务。实现契约所需的一切都免费且不受限制，且不会变。目标只有一个：**被采用**（规范被引用、被实现、被别人的工具链依赖）。
>
> GitHub 上仓库**已公开**（[luffffyz/TextEDA](https://github.com/luffffyz/TextEDA)）。公开前的内部信息清扫已通过（`bun run check:public`：历史里没有厂商 datasheet、没有凭据、没有维护者的机器路径），并已固化为每次 push 的门禁。详见 [ADR-0015](docs/adr/0015-licensing-and-open-standard.md) 与 `docs/backlog.md` F6。

## 现在能做什么

```bash
bun install
bun test                # 单元 + 契约 + round-trip 测试
bun run typecheck       # 七个包一起过 tsc
bun run lib:verify      # 库级闭环（**零外部依赖**）
bun run lib:verify:kicad  # 可选：追加 KiCad 互操作段（KiCad 能读能渲染、合并板 DRC 0 违规）
bun run check:links      # 全部 Markdown 链接与 ADR 交叉引用可解析
bun run check:public     # 公开清扫：查全历史——没有厂商 PDF、没有凭据、没有维护者路径
bun run cases:check      # 钉住的十用例语料（现落地 2 / 10）
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
bun run texteda init ./my-board        # 生成空工程骨架
```

当前状态，按层看：

**描述。** 工程可以写 `schematic`（实例、net、port、约束、bus——一块板一份扁平文件，[ADR-0025](docs/adr/0025-flat-board-and-print-pages.md)）；用带端口的 `module` 文件组合板，展平进板级 IR、IR 仍是平表（[ADR-0026](docs/adr/0026-modules-compose-boards.md)）；用 `view` 打印页画图，它是独立描述、永远不进构建（[ADR-0021](docs/adr/0021-schematic-view-layer.md)、[ADR-0032](docs/adr/0032-view-is-a-drawing-not-a-build-input.md)）；用 `pcb` 摆位布线（12 段物理事实与规则意图，[ADR-0003](docs/adr/0003-agent-first-pcb-ir.md)）；用 `system` 描述经声明端口的跨板连接（[ADR-0001](docs/adr/0001-board-linking.md)）；用 `procurement` 决定这块板买哪颗（主料 + 备料，[ADR-0030](docs/adr/0030-procurement-layer.md)）；用 `component` 备器件——`kind: part` 带料号，`kind: generic` 把取值留给实例行（[ADR-0027](docs/adr/0027-device-parts-families-and-library-dependencies.md)、[ADR-0037](docs/adr/0037-device-kind-vocabulary-and-one-device-directory.md)）——再用 `symbol` / `footprint` 写几何，引脚的电学事实仍归器件（[ADR-0012](docs/adr/0012-symbol-description.md)）。`project.toml` 是最外层的元数据。除 `component` 外，`fmt` 对上面每一种描述都写 canonical form。库是**模板，不是依赖**：`texteda lib import` 把一颗器件和它引用的符号 / 封装拷进 `assets/`、写成裸 id、加上来源头注释，并盖上每个文件自己的版本号（[ADR-0047](docs/adr/0047-an-external-library-is-a-template-not-a-dependency.md)、[ADR-0049](docs/adr/0049-a-file-carries-its-own-revision.md)）。

**检查。** `texteda check` 一次跑完：解析、IR 契约、连通性 ERC、sch↔pcb 绑定（包括每一对声明的 `connect` 是否真有铜箔兑现，以及把部分布局**报出来**而不是静默通过，[ADR-0041](docs/adr/0041-connect-pairs-must-be-implemented-by-copper.md)、[ADR-0040](docs/adr/0040-partial-layout-is-legal-and-reported.md)）、器件词表与参数角色（[ADR-0038](docs/adr/0038-device-vocabulary-and-parameter-roles.md)）、额定值对不对得上声明的窗口、耗散对不对得上声明的上限（[ADR-0043](docs/adr/0043-ratings-are-compared-against-declared-windows.md)、[ADR-0044](docs/adr/0044-dissipation-is-checked-against-declared-limits.md)）、选料、评审轮次是否闭环与处置人是否越权（[ADR-0033](docs/adr/0033-review-records-and-attribution.md)），以及板 ↔ 打印页交叉校验与可读性数值。参考工程上是 **0 error**；那些 warning 是它诚实的现状——`mcu-board` 是块 bring-up 板，没有 `pcb`，选料表是空的。

**画。** 参考渲染器把符号、封装与原理图打印页画成 SVG，自带笔画字体，不需要装 KiCad（[ADR-0014](docs/adr/0014-reference-renderer.md)）；三者各自被 `extract(render(ir)) == ir` 闭环。`texteda review` 把打印页服务给浏览器，hover 高亮、点击选中，或者把同一份东西写成一个自包含 HTML 文件。

**导出与哈希。** KiCad `.kicad_mod` / `.kicad_sym`、网表（IR 的连通性投影）、物料表。`texteda ir` 写 `dist/ir/`：每种描述一份 canonical JSON 分片、一份带每片 sha256 的 manifest、一个覆盖**规范**分片的工程哈希，以及另一个 `advisory_hash`——画（打印页）与第二货源（备料）属于附注类（[ADR-0023](docs/adr/0023-ir-layer-on-disk.md)）。

**还没落地。** 布局与布线（借用）、Gerber / Excellon 与 `fab` 描述（backlog F15，[ADR-0034](docs/adr/0034-manufacturing-output-target-form.md)）、KiCad 原理图导出（F16）、逆向工程与外部网表的导入器（F36）、评审 GUI 的 `placement` / `edit` 两模式与点击跳源码（F11 / F34）、模块参数与嵌套（F13），以及把引用整体重键到实例 UID（实例已有稳定 `uid`，但改 refdes 仍会改源码与哈希；[ADR-0051](docs/adr/0051-instances-have-a-stable-project-local-uid.md)）。KiCad 仍是制造出口（[ADR-0005](docs/adr/0005-manufacturing-output.md)）。

给 agent 用的两份派生物（都由 `bun run gen` 生成，不手改）：

| 文件 | 回答什么 |
|---|---|
| `docs/error-codes.md` | 诊断码 → 含义、严重度、对应规范（162 条，域词表封闭） |
| `docs/ir-reference.md` | IR 字段 → 类型、必填、**单位**、说明（覆盖率清单在文末） |

手写的一份，给要从零建工程的 agent：[docs/skills/new-project.md](docs/skills/new-project.md)——每一步都是一条命令、预期输出，以及失败时该看哪个诊断码。

## 对比

TextEDA 不是 GUI EDA 工具，也不打算变成一个。它站在编辑器上面一层：文本描述语言 + 类型化 IR 作为唯一真源，再加校验器、参考渲染器与导出器。

| | TextEDA | KiCad | EasyEDA | tscircuit |
|---|---|---|---|---|
| **你编辑的东西** | `.teda` 文本——`sch` 与 `pcb` 是互不依赖的兄弟 | `.kicad_sch` / `.kicad_pcb` s-表达式 | JSON 工程源文件 | TypeScript / TSX 代码 |
| **类型化 IR** | JSON Schema 2020-12、canonical JSON、只用整数单位 | 没有独立层，文件本身就是模型 | JSON 工程格式 | `circuit-json`（zod） |
| **校验** | 连通性 ERC · sch↔pcb 绑定 · 器件规则与额定值 · 选料 · IR 契约 | 内置 ERC 与 DRC | DRC | zod + 写在 IR 里的告警 |
| **评审** | 浏览器里看渲染出的打印页：hover、选中；画法是源文件，不是重建 | 原理图与 PCB 编辑器 | 原理图与 PCB 编辑器 | web 查看器 |
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
| `spec/` | 规范：`teda.md`（语言总规范）+ 分描述规范 `symbol` / `footprint` / `pcb` / `schematic-view` / `module` / `procurement` |
| `schemas/ir/v0.14/` | IR 契约（JSON Schema 2020-12，唯一契约）：11 份 schema |
| `packages/ir` | IR 类型、契约校验，与诊断码注册表 |
| `packages/parser` | 每种描述的 `.teda` → IR，含 `fmt`（canonical form）；`module` 文件展平进板级 IR |
| `packages/core` | 纯规则，不碰 fs：连通性 ERC、sch↔pcb 绑定、器件词表与额定值、选料、评审轮次、板 ↔ 视图校验与可读性 |
| `packages/exporter` | 封装 / 符号 → KiCad（`.kicad_mod` / `.kicad_sym`）；网表 |
| `packages/renderer` | 参考渲染器：IR → 绘图指令 → SVG，以及把 round-trip 闭环的反解（[ADR-0014](docs/adr/0014-reference-renderer.md)） |
| `packages/viewer` | 评审 app 的浏览器端：画面、hover 高亮、选身份；无框架、画布不可编辑（[ADR-0021](docs/adr/0021-schematic-view-layer.md)） |
| `packages/cli` | `texteda init` / `compile` / `check` / `netlist` / `ir` / `bom` / `view-metrics` / `review` / `lib import`（[ADR-0019](docs/adr/0019-agent-contract-reference-and-check-entry.md)、[ADR-0023](docs/adr/0023-ir-layer-on-disk.md)） |
| `examples/reference-project/` | 自包含的参考工程：2 块板（一块带 `pcb`，两张打印页）、23 个器件（17 个件 + 6 个通用器件）/ 15 个符号 / 16 个封装，库全部自建，另有选料文件与三轮评审记录 |
| `examples/cases/` | 十个困难用例：每个都是完整小工程，用期望 IR 与期望诊断钉住（现 2 / 10；`bun run cases:check`） |
| `docs/adr/` | 决策记录（ADR）：共 49 份（[完整索引](docs/adr/README.md)） |
| `docs/guides/` | 上手指南：造符号、造封装、导入外部库、记评审记录、多角色评审、开评审 app、读 KiCad 板文件 |
| `docs/skills/` | 给 agent 的操作手册：每步 = 命令 + 预期输出 + 出错看哪个诊断码 |
| `docs/trial-run/` | 历史快照：KiCad 端到端试跑，pcb 描述 → `.kicad_pcb` → DRC + Gerber（早于自建库落地） |
| `docs/assets/` | 品牌资产（标志、图标、生成脚本）；字体二进制不入库 |
| `docs/backlog.md` | 待办清单 |
| `docs/comparison.md` | 与 KiCad、EasyEDA、tscircuit 的对比（带出处） |
| `docs/error-codes.md` / `docs/ir-reference.md` | 生成的契约参考（不手改） |
| `scripts/` | 仓库工具：链接检查、公开清扫、库校验、用例语料、迁移、预览 |

## 决策记录

**语言与 IR**
- [ADR-0004](docs/adr/0004-ir-representation.md) IR 形态与单位约定
- [ADR-0008](docs/adr/0008-ir-shard-identity-and-hash.md) IR 分片、身份键、单位与哈希粒度
- [ADR-0016](docs/adr/0016-diagnostic-error-codes.md) 诊断错误码注册表：`域.slug`，发出即冻结
- [ADR-0017](docs/adr/0017-fact-layer-no-expressions.md) 事实层没有表达式；生成器在语言之外
- [ADR-0020](docs/adr/0020-source-spans.md) 源码位置：诊断指到文件，IR 保持干净
- [ADR-0022](docs/adr/0022-language-versioning.md) 语言版本：`MAJOR.MINOR[.PATCH]`，`1.0` 是冻结点
- [ADR-0023](docs/adr/0023-ir-layer-on-disk.md) 落盘的 IR 层：分片树、manifest、规范与附注双哈希

**板与连通性**
- [ADR-0001](docs/adr/0001-board-linking.md) 板之间如何连接
- [ADR-0002](docs/adr/0002-board-pages-and-bom.md) 板内分页、展平与 BOM 计数
- [ADR-0003](docs/adr/0003-agent-first-pcb-ir.md) agent-first 的 PCB 描述：段集与取舍
- [ADR-0007](docs/adr/0007-page-internal-net-naming.md) 展平后的 net 集合与命名
- [ADR-0024](docs/adr/0024-level-tags-in-flattened-names.md) 展平名字里的层级标记（`M1.R1`）
- [ADR-0025](docs/adr/0025-flat-board-and-print-pages.md) 一板一份扁平原理图；页面变成视图层的打印页
- [ADR-0026](docs/adr/0026-modules-compose-boards.md) 板由模块组成；IR 仍是平表
- [ADR-0035](docs/adr/0035-connectivity-authority-and-reverse-engineering.md) 连通性只有一个权威；逆向工程是导入，不是模式

**画与评审**
- [ADR-0021](docs/adr/0021-schematic-view-layer.md) S1 视图层：画法是独立的描述类型
- [ADR-0032](docs/adr/0032-view-is-a-drawing-not-a-build-input.md) 视图是画，不是构建输入
- [ADR-0033](docs/adr/0033-review-records-and-attribution.md) 评审不是描述类型：意见、处置，与唯一责任人

**器件、库与选料**
- [ADR-0010](docs/adr/0010-footprint-and-3d-model-ownership.md) 自建封装与 3D 模型的所有权
- [ADR-0011](docs/adr/0011-library-format-and-footprint-ir.md) 自建封装库用自己的格式
- [ADR-0012](docs/adr/0012-symbol-description.md) 自建符号库；引脚的电学事实归 `component`
- [ADR-0013](docs/adr/0013-reference-project-self-built-libraries.md) 参考工程全部自建
- [ADR-0027](docs/adr/0027-device-parts-families-and-library-dependencies.md) 器件语义拆成件与通用器件
- [ADR-0028](docs/adr/0028-library-trust-and-derived-overrides.md) 库是未经核实的事实：provenance 与免责
- [ADR-0029](docs/adr/0029-package-code-footprint-and-3d-model-ownership.md) 封装代号住在封装里；3D 模型归件
- [ADR-0030](docs/adr/0030-procurement-layer.md) 采购层：买哪颗是工程本地的决定
- [ADR-0031](docs/adr/0031-project-tree-ownership-model.md) 工程树有所有者
- [ADR-0037](docs/adr/0037-device-kind-vocabulary-and-one-device-directory.md) 器件种类是 `part` 或 `generic`，器件住在一个目录
- [ADR-0038](docs/adr/0038-device-vocabulary-and-parameter-roles.md) 器件词表封闭且被检查；参数 = 角色 + 量纲
- [ADR-0039](docs/adr/0039-a-part-states-its-own-ratings.md) 件写自己的额定值，要求留在实例行
- [ADR-0042](docs/adr/0042-a-device-description-enters-the-ir.md) 器件描述是事实，所以进 IR
- [ADR-0045](docs/adr/0045-the-package-gives-a-resistor-its-floor.md) 封装给了片式电阻它的下限
- [ADR-0046](docs/adr/0046-vendored-libraries-are-verified-by-their-hash.md) vendored 库按哈希核实（已被 [ADR-0047](docs/adr/0047-an-external-library-is-a-template-not-a-dependency.md) 取代）
- [ADR-0047](docs/adr/0047-an-external-library-is-a-template-not-a-dependency.md) 外部库是模板，不是依赖
- [ADR-0048](docs/adr/0048-trust-in-a-library-you-do-not-own.md) 对不属于你的库的信任，是消费方的记录
- [ADR-0049](docs/adr/0049-a-file-carries-its-own-revision.md) 文件自带版本号，信任按该版本匹配

**检查**
- [ADR-0040](docs/adr/0040-partial-layout-is-legal-and-reported.md) 部分布局合法，但必须被报出来
- [ADR-0041](docs/adr/0041-connect-pairs-must-be-implemented-by-copper.md) 声明的 `connect` 对必须由铜箔兑现
- [ADR-0043](docs/adr/0043-ratings-are-compared-against-declared-windows.md) 额定值对照声明的窗口比较
- [ADR-0044](docs/adr/0044-dissipation-is-checked-against-declared-limits.md) 耗散对照声明的上限检查

**制造与流程**
- [ADR-0005](docs/adr/0005-manufacturing-output.md) 制造出口的路径
- [ADR-0006](docs/adr/0006-jlc-prototype-delivery.md) 嘉立创打样交付：BOM、坐标、料号
- [ADR-0018](docs/adr/0018-zero-dependency-and-manufacturing-target.md) 零依赖原则，KiCad 是可选后端
- [ADR-0034](docs/adr/0034-manufacturing-output-target-form.md) 制造出口的目标形态
- [ADR-0036](docs/adr/0036-process-entities-outside-the-language.md) 需求、块与分析不进语言

**工具与许可**
- [ADR-0009](docs/adr/0009-implementation-stack.md) 实现栈：TypeScript、Bun、渲染分层、IDE 接入面
- [ADR-0014](docs/adr/0014-reference-renderer.md) 自研参考渲染器，预览不依赖 KiCad
- [ADR-0015](docs/adr/0015-licensing-and-open-standard.md) 许可与开放策略：契约层永久开源，项目是纯开源技术规范
- [ADR-0019](docs/adr/0019-agent-contract-reference-and-check-entry.md) agent 契约参考与 `check` 入口

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
