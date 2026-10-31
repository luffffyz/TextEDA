# TextEDA — Agent 工作指南

> **本文件怎么读**：本文件是**索引与状态板**，不是手册。
> - **一条事实只住一处**（[ADR-0041](docs/adr/10-process/0041-documentation-has-one-authority-per-fact.md)）：规则本体在规范或决策记录里，本文件只说"住在哪、落地了没有"。要规则就去指针指的地方读。
> - **不变量**（§2）——少而硬，破坏要写 ADR 并说明为什么值得破坏。
> - **方向**（§1、§3、§5）——设计意图，**可被 ADR 推翻**；推翻时改本文件，不算"违反规矩"。
> - **实现现状**——**以代码、测试、ADR、backlog 为准**；本文件只标注"已落地 / 只有设计 / 未落地"。细节过期不算违规，标注错了要改。
>
> 状态（2026-10-27）：**工具链起步，描述层与校验层已能用**。已能走完：`init` → 解析 + `fmt` → `check`（ERC / 绑定 / 器件 / 选料 / 评审轮次）→ `netlist` / `bom` / `ir` 分片树 → 符号 / 封装 / 打印页 SVG → `.kicad_mod` / `.kicad_sym` → 分层 Gerber + Excellon → `review` 只读评审。**未落地**：KiCad 原理图导出、`.kicad_pcb` 导出、`fab` 描述、布局 / 布线（agent 驱动，未建）、遮蔽件选料、模块参数 / 嵌套、conformance 语料、困难用例语料（已写了哪些看 `examples/cases/`）。**权威在别处**：包与契约的现状看 `packages/*/` 与 `schemas/ir/`（语言与 IR 契约的现行版本号见 `spec/teda.md` §13.1），每项工作的现状与验收看 `docs/backlog.md`，每条决策看 `docs/adr/`——本文件不复述。
> 标记约定：**已定** = 不再讨论；**提议** = 默认按此执行，可被 ADR 推翻；**待定** = 未决定，不要擅自选边。**未落地** = 只有设计，没有实现。

---

## 0. TL;DR

给**整个硬件项目**造一套人写的文本描述语言、一个类型化 IR、和一组校验器。

- 项目 = 需求 / 分块 / 接口 / 板 / 原理图 / PCB / 制造 / 变体；语言描述的是这个整体，不是单块 PCB。
- **原理图（sch）与 PCB 是两个独立描述**，互为兄弟，不互为父子：共享身份空间，各自可单独存在。
- 第一阶段只做 sch；PCB 描述晚于 sch，且不要求由 sch 派生。
- 语法只占 10%，真正的工作是语义、约束、错误模型、跨描述一致性。
- IR 是唯一真源；源码语法和任何渲染结果都是派生物。
- 渲染可以自由、可以非确定，但**不得改变连通性**，且必须能被反解校验。
- 不自研布局布线内核、不自研器件库、不自研制造出口（项目可自带**自建封装与符号**，但不做通用库；见 [ADR-0030](docs/adr/08-libraries/0030-footprint-format-and-geometry.md)）。
- 目标用户是 agent，但产出物要人读得懂：**Agent 优先，人来评审**。所有东西都是纯文本——包括错误本身，会指到具体哪个文件、哪一行。

---

## 1. 项目是什么 / 不是什么

**是**：

- 一套面向硬件项目的领域语言：`project`、`board`、`schematic`、`pcb`、`fab`、`variant`；需求 / 分块 / 分析证据为可选的轻量实体。
- 一个类型化 IR 及其 schema（契约在 `schemas/ir/`，字段参考见生成的 `docs/ir-reference.md`）；实现层的公开 TypeScript 包入口、CLI/agent surface 与源码导航见生成的 `docs/api-reference/README.md` 及分包参考页。
- 一个检查器：单位 / 量纲、引脚存在性、电气类型、net 完整性、约束断言、**sch↔pcb 一致性**、**器件额定值 vs 声明窗口**。**现状：已落地**——契约层（Ajv + schema）、连通性 ERC 与器件规则在 `packages/core`，绑定校验、跨板系统校验、采购选料校验；额定值只做了两引脚器件的**电压**（[ADR-0026](docs/adr/07-devices/0026-a-part-states-its-own-ratings.md) D8）与**耗散**（[ADR-0026](docs/adr/07-devices/0026-a-part-states-its-own-ratings.md) D11），多引脚端子语法已定（[ADR-0026](docs/adr/07-devices/0026-a-part-states-its-own-ratings.md) D4）但检查器未实现；电流仍未定。
- 一个参考渲染器和一个导出器（KiCad，见 [ADR-0021](docs/adr/06-manufacturing/0021-the-manufacturing-output-path.md)）。**现状**：渲染器覆盖符号、封装与原理图打印页（[ADR-0036](docs/adr/09-view/0036-our-own-reference-renderer.md)、[ADR-0035](docs/adr/09-view/0035-the-view-layer-is-a-drawing.md)），板 ↔ 打印页交叉校验与可读性检查已落地（F3）；导出器出 `.kicad_mod` / `.kicad_sym` 与**分层 Gerber + Excellon**（[ADR-0018](docs/adr/05-pcb/0018-copper-fill-uses-a-geometry-kernel.md) D9、D10）。网表（`texteda netlist`）已落地；BOM 走采购层（`texteda bom`），下单格式未做（[ADR-0022](docs/adr/06-manufacturing/0022-jlc-prototype-delivery.md)、F14）。
- 一套一致性测试（conformance），让别人能独立实现渲染器。**现状：未存在**。

**不是**：

- 不是内建布局布线求解器的 EDA GUI。**布局与布线在路线图内，但由 agent 驱动、检查器把关**（[ADR-0017](docs/adr/05-pcb/0017-layout-and-routing-are-agent-driven.md)）；评审 GUI 是**导航器 + 批注器 + 受限摆位器**（`review` / `layout` / `edit` 三模式已落地，见 `docs/guides/review-app.md`；app 画的是**画**不是板——打印页、PCB 画布、符号、封装四类，`placement` 已退役为一张画（[ADR-0048](docs/adr/09-view/0048-the-review-app-shows-drawings.md)）；`layout` 只写视图的 `place` 与受影响的 wire，不能做的写在 "What is not built"）。S1 打印页的走线不在拖动中实时算：它是 `place` + 逻辑网表的派生物，`layout` 不写 `design/**`，不碰 IR 与构建哈希（[ADR-0035](docs/adr/09-view/0035-the-view-layer-is-a-drawing.md) D4、D6）。
- 不是器件库维护者（借 KiCad 符号库、嘉立创料号）；项目自己的封装可以自建，但那是项目产物，不是库产品。
- 不是 KiCad 的替代品。KiCad 是**可选后端**（互操作导出、DRC 对照、制造出口兜底），从不是布局布线的决策程序——核心链路与全部门禁都不依赖它（不变量 20）。
- 不是制造工具：不自研 CAM 级 DFM 判定，也不做工艺规则库；**格式层的写出器自研**（Gerber / Excellon，已落地）。`fab` 的默认产物是**制造中立的数据**（装配意图、BOM、坐标），不是 Gerber 本身（[ADR-0021](docs/adr/06-manufacturing/0021-the-manufacturing-output-path.md) D3、D1、F14）。
- 不描述固件、外壳结构、供应链流程（后续可作为引用 / 接口，不进入第一阶段）。

### 1.1 实现路线（工具侧）

| 阶段 | 内容 | 说明 |
|---|---|---|
| P0 | `schematic` | 器件、引脚、net、约束、ERC；先跑通 |
| P1 | 渲染 + 导出 | sch SVG、netlist、KiCad 原理图 |
| P2 | `pcb` | 叠层、放置、走线、物理专属件 + 与 sch 的绑定校验；布局布线由 agent 驱动、检查器把关（[ADR-0017](docs/adr/05-pcb/0017-layout-and-routing-are-agent-driven.md)） |
| P3 | `fab` / BOM / 变体 | 制造出口、DNP、装配变体 |
| P4 | 多板系统 | 板间连接器、系统级 net、共享 BOM |

原则：**每一步都能单独使用**。只有 sch 也要能完成设计、评审、导出网表。

### 1.2 设计流程（用户侧）

工程流程不是瀑布、而是带反馈的环——需求 → 架构 → 接口 / 电源树 → 选型 → 分析 → sch → pcb → 打样 → 认证 / 量产，PCB 的 SI / PI / 热 / EMC 结论会打回 sch 与选型。**它描述语言所处的流程，不是语言的一部分**：`Requirement` / `Block` / `Analysis` 因此都不进语言（[ADR-0040](docs/adr/10-process/0040-process-entities-outside-the-language.md)）。完整流程与每阶段出口准则见 `docs/guides/design-flow.md`。

---

## 2. 不可协商的不变量

少而硬。破坏任何一条都要写 ADR，并说明为什么值得破坏。

1. **IR 是唯一真源**：语法、渲染器、导出器都可换，IR 语义不变。
2. **连通性只由逻辑模型决定**，绝不允许从几何反推连通性作为权威结果；几何反解只用于**校验**渲染是否失真。
3. **渲染器只读**：输入 IR，输出几何 / 图片；不得增删器件、引脚、net。
4. **渲染必须可校验**：存在 `extract(render(ir)) == ir` 的检查路径，做不到就不要提交该渲染器。**现状：符号、封装与原理图打印页都已成立**（[ADR-0036](docs/adr/09-view/0036-our-own-reference-renderer.md) decision 5；口径见 `spec/schematic-view.md` §9.5）。
5. **每个元素有稳定 ID**：显示名可改，ID 不变。**现状：部分兑现**——实例有显式、不可变的 `uid`（[ADR-0010](docs/adr/03-project/0010-instance-identity-is-a-uid.md)）；**引用仍是名字**，改 refdes 仍改源码与 `source_hash`。
6. **没有隐式类型、没有有效缩进**：`no` 不是布尔，缩进不表达层级（这一条排除了 YAML 作为语言层）。
7. **未知构造默认报错**，不静默忽略；要放宽得先写决策记录。
8. **单位进字面量**（`3.3V`、`100nF`、`90Ω`）；语义位置上没有单位来源的数字必须报错。
9. **默认值必须写进规范**，并且可以省略；不允许"必须显式写默认值"的设计。
10. **版本化**：语言和 IR 都有版本号，破坏性变更必须附迁移脚本与迁移说明。**语言只有一个版本号**（全语言共享一个号，各描述类型只保留"诞生于"这个下界），此后只走 PATCH 位；IR 契约是另一条独立的线。**现行号码**见 `spec/teda.md` §13.1 与 `packages/parser/src/version.ts`；决策见 [ADR-0002](docs/adr/01-language/0002-one-language-version-number.md)。
11. **产物可追溯**：导出的 Gerber / 图 / 网表携带 `source_hash + tool_version`（+ 渲染 seed，如适用）。
12. **sch 与 pcb 是两个独立描述**，共享同一身份空间（`component_id`、`pin_number`、`net_id`）。
13. **pcb 不得隐式增删逻辑连接**：任何偏差（net tie、测试点、缝合孔、分地）必须显式声明，并出现在校验报告里。
14. **逻辑专属 / 物理专属元素必须显式标记**（`logical_only` / `physical_only`），不得靠"缺省即某一边"推断。
15. **板间连接只在 `system` 描述里声明**：`sch` 不引用别的板，`system` 也不改写板内连通性（[ADR-0009](docs/adr/03-project/0009-board-linking.md)）。
16. **一块板 = 一份原理图描述、一个 BOM、一个 PCB**：板内不再有 `page` 描述类型与 `pages` 段（已撤销，迁移说明见 `spec/teda.md` §13.4）；评审时的分块由 S1 的**打印页**承担——只画板级 net，不产生独立 BOM，也不改写连通性（[ADR-0012](docs/adr/04-schematic/0012-one-flat-schematic-per-board.md)）。
17. **pcb 描述只存物理事实与规则意图**：不存绘图参数、丝印排版、编辑器状态与派生缓存；连通性由 `connect` 段与 sch 决定；人在 KiCad 里的改动**不回写** IR（[ADR-0016](docs/adr/05-pcb/0016-agent-first-pcb-description.md)）。
18. **IR 的对外表示是 canonical JSON，契约是 JSON Schema**：数值只用整数，不写浮点；缺省字段省略而不是写 `null`；落盘必须字节可复现，`source_hash` = SHA-256(canonical 字节)。决策见 [ADR-0005](docs/adr/02-ir/0005-ir-representation.md)；分片与哈希见 [ADR-0006](docs/adr/02-ir/0006-ir-shards-and-hashes.md) D1、D8；契约在 `schemas/ir/`。
19. **契约层永久开源**：`spec/**`、`schemas/ir/**`、`examples/**`、`tests/**` 永远公开、可实现、可再分发，**不得改为闭源或加附加限制**；实现层（`packages/**`）可另行许可，但不得把私有扩展混进契约层。项目按**纯开源技术规范**定位：**没有商业计划与收入模型**，回报方式只有一种：**被采用**（[ADR-0039](docs/adr/10-process/0039-licensing-and-open-standard.md)）。
20. **核心链路零外部依赖**：装 TextEDA 就能走完"描述 → 校验 → 渲染 → 制造包"，**不得要求用户安装 KiCad 或任何其他外部工具**；**任何门禁都不得依赖外部工具**——KiCad 的读入与 DRC 是"第三方接受我们"的**观测**，不是我们的正确性定义。边界：**格式与描述自己写，判定与工艺规则借专业工具**（[ADR-0021](docs/adr/06-manufacturing/0021-the-manufacturing-output-path.md)）。

---

## 3. 分层：哪一层能自由

| 层 | 内容 | 能否自由 / 交给 AI | 原因 |
|---|---|---|---|
| PRJ | 项目：系统、板、变体、元数据 | **不能** | 结构化程度低，但身份与版本必须精确 |
| S0 | 原理图逻辑：器件、引脚、net、约束 | **不能** | 唯一逻辑真源，必须精确可校验 |
| S1 | 原理图视图：符号位置、走线、标签 | **可以**，不进构建身份（但文件必须留） | 给人评审用。**独立描述类型** `view`（`views/<board_id>/<page_id>.view.teda`，打印页，**独立根目录**，不进 `design/`）+ 独立 IR 分片；**手写的源文件、进仓库**（渲染器只画不摆），分片是附注类——移动标签不改工程哈希与板哈希（[ADR-0035](docs/adr/09-view/0035-the-view-layer-is-a-drawing.md) D1、D5） |
| B0 | PCB 物理：叠层、坐标、层、过孔、走线 | **不能**自由 | 决定阻抗、串扰、回流、散热、爬电 |
| B1 | PCB 预览 / 3D / 走线检查视图 | **可以** | 派生 |
| M0 | 制造：Gerber / 钻孔 / BOM / 贴片 | **不能** | 校验后冻结，带版本与哈希（**冻结的是发布，不是每一次构建**：每个制造包带 `source_hash`；见 [ADR-0021](docs/adr/06-manufacturing/0021-the-manufacturing-output-path.md) D8） |

推论：讨论"渲染自由"时先问是哪一层。S1 随便画，B0 不行；S0 与 B0 之间的一致性由校验器保证，不由渲染器保证。

---

## 4. 语义模型：谁拥有哪条事实

> 一条事实只住一处（[ADR-0041](docs/adr/10-process/0041-documentation-has-one-authority-per-fact.md)）。本节只指路：**规则住在哪**，不复制规则原文。

| 横切主题 | 事实住在哪 |
|---|---|
| 单位与量纲、引脚电气类型 | `spec/teda.md` §10 |
| Canonical form（规范化、排序、数值） | `spec/teda.md` §12；`spec/pcb.md` §6 |
| 版本号与接受规则 | `spec/teda.md` §13；`packages/parser/src/version.ts` |
| 诊断码与严重度 | `packages/ir/src/diagnostics/codes.ts`；生成的 `docs/error-codes.md`（[ADR-0003](docs/adr/01-language/0003-diagnostic-error-codes.md)） |
| IR 字段与单位 | 生成的 `docs/ir-reference.md` |
| 实现 API 入口与源码导航 | 包的 `exports`、`packages/*/src/`；生成的 `docs/api-reference/README.md` 与 `docs/api-reference/` 分包页（只做导航，不取代契约或规范） |
| `project.toml` 的键与规则 | `spec/project.md` §1、§2 |
| 评审记录 / 多角色评审 / 评审 app | `docs/guides/review-records.md`、`docs/guides/role-reviews.md`、`docs/guides/review-app.md` |
| 外部库导入与信任 | `docs/guides/library-import.md` |

### 4.1 项目层

| 事实 | 住在哪 |
|---|---|
| `Project` / `Board` / `Variant` 语义；sch 与 pcb 平级、可各自缺席 | `spec/teda.md` §7；`spec/project.md` §1 |
| 跨板连接（`system` 描述、ports） | `spec/teda.md` §7.5、§8；[ADR-0009](docs/adr/03-project/0009-board-linking.md) |
| 变体只影响 BOM 与制造，不改连通性、不影响 ERC | `spec/teda.md` §11；[ADR-0015](docs/adr/04-schematic/0015-flattening-and-the-net-set.md) |
| 采购层（选料、BOM、备料不进哈希） | `spec/procurement.md`；[ADR-0029](docs/adr/07-devices/0029-the-procurement-layer.md) |
| `fab` 描述（形态已定，实现为零） | [ADR-0021](docs/adr/06-manufacturing/0021-the-manufacturing-output-path.md) |
| 流程实体（`Requirement` / `Block` / `Analysis`）不进语言 | [ADR-0040](docs/adr/10-process/0040-process-entities-outside-the-language.md) |
| 没有 pcb-only 模式；逆向与外部网表走导入器（延后） | [ADR-0014](docs/adr/04-schematic/0014-connectivity-has-one-authority.md) D5 / D6；F36 |

### 4.2 原理图（S0）

| 事实 | 住在哪 |
|---|---|
| 器件实例、引脚、net、约束的段与列 | `spec/teda.md` §7、§7.1–§7.4 |
| **BOM 聚合键** =（`component_id`，参数字典，变体状态），**不含** refdes；数量 = 实物数 | `spec/teda.md` §11；`spec/procurement.md` §5 |
| 显式区分三种"没连"：floating（漏连，错误）/ no_connect（有意悬空）/ dnp（不贴） | `spec/teda.md` §7.2 |
| 模块（源码层展平；实例 id 带 `M<数字>.` 前缀，模块内 net 带前缀） | `spec/teda.md` §7.6；`spec/module.md`；[ADR-0013](docs/adr/04-schematic/0013-modules-compose-boards.md)、[ADR-0012](docs/adr/04-schematic/0012-one-flat-schematic-per-board.md) |
| 打印页与视图（只画不摆；不重复电气事实；坏视图由人重做，不得重绘覆盖） | `spec/schematic-view.md`；[ADR-0035](docs/adr/09-view/0035-the-view-layer-is-a-drawing.md) D6、[ADR-0012](docs/adr/04-schematic/0012-one-flat-schematic-per-board.md) D4、[ADR-0035](docs/adr/09-view/0035-the-view-layer-is-a-drawing.md) D3 |
| 实例稳定身份 `uid`（工程内唯一） | [ADR-0010](docs/adr/03-project/0010-instance-identity-is-a-uid.md) |
| 模块参数 / 嵌套 / 跨工程模块库（未落地） | `spec/module.md` §10；F13 |

### 4.3 PCB（B0）

| 事实 | 住在哪 |
|---|---|
| 段集与语法（`stackup` / `outline` / `place` / `connect` / `trace` / `via` / `zone` / `keepout` / `rules` / `silk` / `physical_only` / `deviation`） | `spec/pcb.md` §4；[ADR-0016](docs/adr/05-pcb/0016-agent-first-pcb-description.md) |
| 绑定规则与偏差白名单 | `spec/pcb.md` §5.2；[ADR-0014](docs/adr/04-schematic/0014-connectivity-has-one-authority.md) |
| 铜皮填充（`zone` 只存意图；结果不进 IR、不进哈希；受限几何内核） | `spec/pcb.md` §4.7；[ADR-0018](docs/adr/05-pcb/0018-copper-fill-uses-a-geometry-kernel.md)；F49 |
| 导出（分层 Gerber + Excellon；层集合与文件清单） | `spec/pcb.md` §8；[ADR-0021](docs/adr/06-manufacturing/0021-the-manufacturing-output-path.md) |
| 布局与布线由 agent 驱动、检查器把关 | [ADR-0017](docs/adr/05-pcb/0017-layout-and-routing-are-agent-driven.md) |

### 4.4 绑定与一致性（核心）

身份键：器件 = `component_id`（不是 refdes）；引脚 =（`component_id`，`pin_number`）；net = `net_id`（不是网络名）。**规则全文与报告格式见 `spec/pcb.md` §5.1、§5.2、§5.3**；下面八条是速记：

1. pcb 器件必须绑定到一个 sch 器件，或标 `physical_only`。
2. sch 的 pin 必须映射到封装 pad，或显式 `no_connect` / `dnp`。
3. pcb net 的成员集合 = sch net 成员在"已放置器件"上的投影，**除非**声明了受控偏差。
4. `connect` 的每一对必须落在 sch 的同一 net 内；sch 每个 net 的每个成员 pad 至少出现在一个 `connect` 对里，否则报"未布线"。
5. 受控偏差只有白名单四类（`net_tie`、`stitching`、`split_ground`、`fiducial`），**封闭**（加类要另起 ADR），进报告不隐藏；白名单不是给"sch 没写"兜底的。`net_tie` 是 note，`split_ground` 是 warning（[ADR-0014](docs/adr/04-schematic/0014-connectivity-has-one-authority.md) D10）。
6. 缺 `pcb` 跳过并在报告里说明"未校验"；**缺 `sch` 是错误**（同上 D5）。
7. **形状归封装库**：板描述存坐标不存几何。
8. **逻辑存在的，必须在原理图里看得见**（同上 D8 / D9）：分界线是"它是不是某个 net 上的焊盘"。

### 4.5 器件描述（`assets/components/`）

| 事实 | 住在哪 |
|---|---|
| `kind: part`（具体料，`mpn` 必填）/ `kind: generic`（通用器件，`mpn` 必省）；`kind` 只写在文件里，不从目录推断 | `spec/teda.md` §6.1.1；[ADR-0024](docs/adr/07-devices/0024-the-device-kind-is-part-or-generic.md) D1、D6 |
| **`component_id` = 文件名（不含 `.teda`），不取相对路径；文件头 id 必须与文件名一致，否则报错** | `spec/teda.md` §6 |
| `params` 段的角色词表与量纲、必填列的收紧规则 | `spec/teda.md` §6.2.1、§6.2.2；[ADR-0025](docs/adr/07-devices/0025-device-vocabulary-and-parameter-roles.md) |
| 引脚表（编号、名称、电气类型、多单元、复用功能） | `spec/teda.md` §6.3 |
| 额定值（归件自己写） | `spec/teda.md` §6.4；[ADR-0026](docs/adr/07-devices/0026-a-part-states-its-own-ratings.md) |
| 符号只写"画在哪、怎么画"；引脚的电学事实只在器件里 | `spec/symbol.md`；[ADR-0031](docs/adr/08-libraries/0031-symbol-format.md) |
| 封装几何与 3D 模型不进语言；`package_code` 归 land pattern | `spec/footprint.md`；[ADR-0030](docs/adr/08-libraries/0030-footprint-format-and-geometry.md)、[ADR-0028](docs/adr/07-devices/0028-package-code-and-3d-models.md) |
| 库级校验（引用闭合、无孤儿、引脚号与焊盘号对齐） | `bun run lib:verify`；`docs/guides/symbol-authoring.md`、`docs/guides/footprint-authoring.md` |

### 4.5.1 外部库是**模板**，不是依赖

`texteda lib import` 把库拷进 `assets/` 并写成裸 id；工程**不读** `external/libs/**`（那里有 `components/` / `symbols/` / `footprints/` 就是 error）。消费方的信任表与每文件 `rev` 的匹配规则见 `docs/guides/library-import.md`；决策见 [ADR-0034](docs/adr/08-libraries/0034-trust-in-a-library-you-do-not-own.md) D2、D8、D6。

### 4.6 评审记录（`docs/reviews/`）

评审是工程里的一等产物：库里复核一件料写在器件文件里，评审一块设计留下一轮记录（**谁看了什么、什么时候、说了什么、谁定的、定的什么**）。约定见 `docs/guides/review-records.md`，多角色做法见 `docs/guides/role-reviews.md`，评审 app 见 `docs/guides/review-app.md`；决策见 [ADR-0037](docs/adr/09-view/0037-review-records-and-attribution.md)。意见不进语言、不进 IR、**不改任何哈希**。

---

## 5. Surface syntax（**提议**，未冻结）

格式本体在 `spec/teda.md` §2–§5（文件、词法、行类型、文件头与版本）与 §12（canonical form）；分描述语法在各自规范（`spec/symbol.md`、`spec/footprint.md`、`spec/pcb.md`、`spec/schematic-view.md`、`spec/module.md`、`spec/procurement.md`）。本节只留三条边界：

1. **主形式只有表格一种，不引入链式记法**；组合用带端口的块，规则归检查器（[ADR-0001](docs/adr/01-language/0001-fact-layer-has-no-expressions.md) D7）。
2. **事实层没有表达式**：值是终值字面量，没有控制流、循环、条件；生成器在语言之外、产物是表（[ADR-0001](docs/adr/01-language/0001-fact-layer-has-no-expressions.md) D3）。
3. **未知构造默认报错**（不变量 7），要放宽先写决策记录。

### 5.1 硬规则

细则在 `spec/teda.md` §3–§5。一行一个事实，禁止需要跨行阅读的结构；冒号与续行只用于"名字 + 不定长列表"的段，列固定的段与成对坐标的段都不用；列的含义由器件类型定义；必须有 canonical formatter；运算符尽量 ASCII、单位允许 Unicode；每种描述有独立的文件类型，`version` 头写的是**语言版本**；跨文件引用只走显式 `use` / `import`（**现状：未落地**，现有引用机制是裸 `component_id`）。

### 5.2 语法特性准入规则

每个新特性必须满足**全部**三条，否则不加：

1. 在困难用例（清单见 `examples/cases/README.md`，F12）中至少有一个必须用它；
2. 能用一段 EBNF + 一段语义说明 + 一个正例 + 一个反例说清；
3. 有明确的错误信息文案（含行列与修复建议）。

**现状：第 1 条还不能下结论**——用例没补齐，"没有用例用到"不足以下结论；补齐之前仍要求另起 ADR + 迁移说明 + 迁移脚本（F12）。

### 5.3 表格的边界（提议）

表格只负责"事实"，不负责"组合"和"规则"：器件清单 / net 成员 / 引脚绑定 / 变体用表；层次与复用用 `module` + 端口；计算值不进语言（[ADR-0001](docs/adr/01-language/0001-fact-layer-has-no-expressions.md)）；量词规则归检查器；生成器 / 循环不支持（[ADR-0001](docs/adr/01-language/0001-fact-layer-has-no-expressions.md) D3）。两个已知风险：**宽行**（net 行按 80 列折行，续行首列是裸 `:`，折行只影响排版）与**稀疏元数据**（放旁表，主表只留每个类型都有的列）。细则见 `spec/teda.md` §12。

---

## 6. 渲染与确定性

三种"确定性"必须分开，别混为一谈：

| 性质 | 要求 | 手段 | 规则住在哪 |
|---|---|---|---|
| 语义确定性（渲染不改变连通性） | **必需** | `extract(render(ir)) == ir` | [ADR-0036](docs/adr/09-view/0036-our-own-reference-renderer.md) decision 5；`spec/schematic-view.md` §9.5 |
| 布局稳定性（小改动 → 小移动） | **强烈建议** | 锚定未变器件、增量布局 | [ADR-0035](docs/adr/09-view/0035-the-view-layer-is-a-drawing.md) |
| 像素可复现（同输入同输出） | 可选 | 保存已接受的渲染 + seed + 版本 | [ADR-0035](docs/adr/09-view/0035-the-view-layer-is-a-drawing.md) |

策略：

- 接受的渲染存为产物，记录 `source_hash + renderer_version + seed`，只读。
- 重新渲染不得覆盖人工调整；需要人工编辑时走显式 patch / merge，不靠"重画一遍"。
- sch 视图与 pcb 视图是**两个独立的渲染目标**，可以分别实现、分别替换。
- 可读性检查自动化：文字重叠、线压引脚、标签碰撞、越界、连线穿过符号、走线穿过引脚、走线穿过文字、**走线斜段**（视图坐标因此是 0.01 mm 网格）。可测；"好看"不可测。码表见 `spec/schematic-view.md` §9.2。
- AI 渲染的三种形态：写渲染器代码（人审后固化）→ **推荐**；在确定性候选里挑选 / 调样式 → 可用；每次运行生成坐标 → 允许，但产物必须冻结并校验，不得回写 S0 / B0。

---

## 7. 已知坑（按出现顺序）

| 坑 | 表现 | 对策住在哪 |
|---|---|---|
| 语义不足 | 只有 pins + nets，没有电气类型 / net class / NC | `spec/teda.md` §6、§7 |
| 器件身份断裂 | symbol ↔ footprint ↔ pad 号对不上 | `spec/teda.md` §6.3；`bun run lib:verify` |
| 器件描述漂移 | `assets/components/` 内联的引脚与库符号不一致 | 内联优先；引脚事实只在器件里（`spec/teda.md` §6.3） |
| 逻辑 / 几何混淆 | 图上看连着，实际不连 | 不变量 2 |
| **sch / pcb 漂移** | 两份描述各自演化，谁对说不清 | S0 定逻辑，偏差白名单 + 报告（`spec/pcb.md` §5.2） |
| **重复描述** | 同一个连接写两遍，改一处漏一处 | pcb 只引用 `net_id`，不重写成员表（`spec/pcb.md` §4.4） |
| 非确定性渲染 | 每版图都变，评审失效 | 冻结产物 + 锚定布局（§6） |
| 回写覆盖 | 重渲染冲掉手工调整 | 稳定 ID + patch 模型（不变量 5） |
| 规模 | >100 器件后上下文爆炸 | 层次化（模块）+ 生成器；分块只归 S1 打印页 |
| **绘制分块被当成逻辑分块** | 给逻辑加了页面、端口与限定名 | 分块归 S1 打印页，逻辑只有一份板文件（[ADR-0012](docs/adr/04-schematic/0012-one-flat-schematic-per-board.md)） |
| **pcb 变成 KiCad 的翻版** | 段集照抄 `.kicad_pcb`，继承绘图参数与缓存 | 丢弃清单与段集见 `spec/pcb.md` §4；[ADR-0016](docs/adr/05-pcb/0016-agent-first-pcb-description.md) |
| 假验证 | "图好看"当成"电路对" | 机器校验等价是硬门槛（不变量 4） |
| 导出边界 | 非网格坐标导入 KiCad 后断网 | 导出前量化 / 吸附，导出后跑连通性比对 |
| 同一器件两个源 | 项目派生覆盖库的件 | 覆盖是最后手段；派生件遮蔽库件（[ADR-0033](docs/adr/08-libraries/0033-libraries-are-unverified-facts.md) D3） |
| 库缺失 | 第一颗 BGA 就卡住 | 通用库借 KiCad + 嘉立创；**项目自建库是一等产物**（[ADR-0030](docs/adr/08-libraries/0030-footprint-format-and-geometry.md)） |
| **agent 直接写板绕过检查** | 生成的 `pcb` 连通性 / DRC 没跑过，源码被污染 | agent 只改 sandbox；`check` 通过才 `apply`（[ADR-0017](docs/adr/05-pcb/0017-layout-and-routing-are-agent-driven.md)） |
| **DRC 全绿但板很差** | 绕远路、堆过孔、回流断裂、去耦乱放 | DRC 不是目标函数：线长 / 过孔 / 面积 / 电流密度等指标 + 人审 |
| **skill 与 rules 漂移** | skill 写死 0.2mm，`pcb.rules` 写 0.15mm | 数值只进 `pcb.rules`；skill 引用规则与诊断码（[ADR-0017](docs/adr/05-pcb/0017-layout-and-routing-are-agent-driven.md) D6） |

---

## 8. 造 vs 借

逐层对比与同类项目的逐项对比见 `docs/comparison.md`。三条底线不变：

- **自己造**：语法、parser、IR、类型 / 量纲 / 约束求解、ERC 与绑定校验、参考渲染器（符号 / 封装 / 打印页 SVG，自带笔画字体、不依赖 KiCad，[ADR-0036](docs/adr/09-view/0036-our-own-reference-renderer.md)）、**受限** 2D 几何内核（[ADR-0018](docs/adr/05-pcb/0018-copper-fill-uses-a-geometry-kernel.md)、F49）、Gerber / Excellon 写出器。
- **不写求解器**：布局与布线由 agent 驱动、检查器把关（[ADR-0017](docs/adr/05-pcb/0017-layout-and-routing-are-agent-driven.md)）。
- **借**：通用器件库（KiCad / 嘉立创，不做库产品；但项目自建的封装与符号库是一等产物，[ADR-0030](docs/adr/08-libraries/0030-footprint-format-and-geometry.md)）、CAM 级 DFM 判定（[ADR-0021](docs/adr/06-manufacturing/0021-the-manufacturing-output-path.md)）、3D 预览运行时（three.js）。

最小闭环：`parser → typed IR → ERC → netlist 导出 → sch SVG → KiCad 导出`。pcb 描述与布局布线排在后面。

---

## 9. 仓库结构（目标）

**两棵树都在根 README（英文）里**：**工程布局**（`texteda init` 建的目录）与**仓库布局**（`spec/` / `schemas/` / `packages/` 各自是什么）。这里只补 README 说不清的几件事。

1. **仓库根只留入口、构建配置与目录**：入口是 `AGENTS.md` / `README*` / `LICENSE` / `NOTICE`，构建配置是 `package.json` / `bun.lock` / `tsconfig.base.json`；产物、素材、临时脚本不进根目录。工具脚本在 `scripts/`（共用工具在 `scripts/lib/`，生成器在 `packages/ir/scripts/`）。**语言总规范在 `spec/teda.md`**，`spec/` 其余文件是分描述规范；IR 的契约在 `schemas/ir/`（契约版本就是目录名）。

2. **工程目录按归属分组**（决策见 [ADR-0008](docs/adr/03-project/0008-project-tree-has-owners.md)）：自有器件资产与选料放 `assets/`，引用但不自有的材料放 `external/`（外部库只作**模板**，`texteda lib import` 拷进 `assets/` 后就是自有资产；数据手册本体在 `external/cache/`，不入库不进 IR），电路描述收进 `design/`，画在 `views/`（手写、进仓库、不参与构建身份）。库信任模型见 [ADR-0033](docs/adr/08-libraries/0033-libraries-are-unverified-facts.md)，器件语义拆分见 [ADR-0024](docs/adr/07-devices/0024-the-device-kind-is-part-or-generic.md)，打印页的地位见 [ADR-0035](docs/adr/09-view/0035-the-view-layer-is-a-drawing.md)；工作项见 F25 / F26 / F29 / F30。
3. **`init` 契约**：`bun run texteda init <dir>` 只建目录与 `project.toml`、`docs/README.md`；目标目录非空时拒绝执行（`--force` 才覆盖），不合并、不猜测；不联网、不拉模板、不生成 `dist/`；输出确定性（不写时间戳、不写随机 ID）。键表见 `spec/project.md` §1、§2。多板按描述类型分目录（`design/sch/` / `design/pcb/` / `design/modules/` / `design/system/`），打印页是独立描述类型、独立根目录 `views/`；扩展名统一 `.teda`，由目录与首行区分描述类型。`project.toml` 只承载项目元数据，**不承载电路、不承载库引用**（库是模板）；板间连接走 `system` 描述。
4. **`dist/ir/` 的分片树**（`texteda ir` 写出，每片一份 canonical JSON；决策见 [ADR-0005](docs/adr/02-ir/0005-ir-representation.md)、[ADR-0006](docs/adr/02-ir/0006-ir-shards-and-hashes.md)）：

```
dist/ir/
├── manifest.json                          # 分片路径 + 每片 sha256 + 分类 + 工程哈希 + advisory_hash
├── boards/<board_id>/schematic.json
├── boards/<board_id>/pcb.json
├── boards/<board_id>/view/<page_id>.json
├── boards/<board_id>/procurement.json     # 主料（规范）/ procurement-alternatives.json（附注）
├── components/<component_id>.json         # 自有器件
├── symbols/<category>/<symbol_id>.json
├── footprints/<family>/<footprint_id>.json
├── project.json
└── systems/<system_id>.json
```

分片布局按种类固定，不镜像源码树（[ADR-0008](docs/adr/03-project/0008-project-tree-has-owners.md) decision 9），映射由每片自带的 `source.file` 承担（[ADR-0006](docs/adr/02-ir/0006-ir-shards-and-hashes.md) decision 2）。**分片分两类**：规范分片进工程哈希，附注分片（打印页、备料）进 `advisory_hash`；板哈希只算该板的规范分片。哈希规则（每片 sha256 取落盘 canonical 字节；工程哈希 = 规范分片按路径排序后 `<path>:<sha256>\n` 拼接再 sha256）见 [ADR-0006](docs/adr/02-ir/0006-ir-shards-and-hashes.md) decision 9。**工程有 error 时一分片都不写**，输出目录里树不拥有的文件会被删掉（陈旧分片会改哈希）。**工程哈希目前仍会变**（分片带着 `source.file`，路径一变字节就变），解耦见 F29。

板级工程结构不是本仓库的职责；本仓库只规定语言与 IR。

---

## 10. 验证与验收

| 命令 | 查什么 | 规则住在哪 |
|---|---|---|
| `bun run test` | 单元、契约正反例、round-trip | 各包 `test/`；`tests/schemas/`（脚本带 `--timeout 30000`，见下） |
| `bun run typecheck` | 全包类型 | `tsconfig.base.json` |
| `bun run gen:check` | 生成物（IR 类型、`docs/error-codes.md`、`docs/ir-reference.md`、`docs/api-reference/`）不漂移 | `packages/ir/src/generated/`；[ADR-0038](docs/adr/10-process/0038-implementation-stack-and-agent-entry.md) |
| `bun run lib:verify` | 库闭包：引用可解析、无孤儿、引脚号与焊盘号对齐 | `spec/symbol.md` §7、`spec/footprint.md` §7 |
| `bun run check:links` | 跨引用可解析（链接、章节、ADR 编号、backlog 项、ADR 索引与头部格式） | 本文件 §12 |
| `bun run check:public` | 公开仓库历史扫描（PDF / 凭据 / 绝对路径 / 邮箱 / license / NOTICE） | [ADR-0039](docs/adr/10-process/0039-licensing-and-open-standard.md) decision 1 |
| `bun run fmt:teda --check .` | canonical 格式 | `spec/teda.md` §12 |
| `bun run cases:check` | 用例语料与期望 IR / 诊断一致 | `examples/cases/` |
| `bun run texteda check <dir>` | 工程校验：ERC / 绑定 / 器件 / 选料 / 评审轮次 | `spec/teda.md` §11；`spec/pcb.md` §5.2 |
| `bun run texteda ir <dir>` | IR 分片树与哈希 | [ADR-0006](docs/adr/02-ir/0006-ir-shards-and-hashes.md) |
| `bun run texteda export gerbers <dir> <board>` | 分层 Gerber + Excellon | `spec/pcb.md` §8 |
| `bun run texteda bom <dir> <board>` | 物料表 | `spec/procurement.md` §5 |
| `bun run texteda view metrics <dir> <board>/<page>` | 打印页的量：图幅占用、文字间隙、走线长与交叉 | `spec/schematic-view.md` §9.4 |
| `bun run texteda view rewire <dir> <board>/<page>` | 把走线锚回引脚（挪动器件之后的收尾） | `spec/schematic-view.md` §9.4.1 |
| `bun run texteda renumber <dir> <board>` | 全局改名的 dry run / apply | [ADR-0011](docs/adr/03-project/0011-renumbering-is-a-code-executed-rename.md)；`docs/guides/renumbering.md` |
| `bun run texteda id <dir>` | 生成未使用的实例 `uid` | [ADR-0010](docs/adr/03-project/0010-instance-identity-is-a-uid.md) |
| `bun run texteda lib import <name> --from <dir> --rev <tag>` | 外部库拷成自有资产 | `docs/guides/library-import.md`；[ADR-0034](docs/adr/08-libraries/0034-trust-in-a-library-you-do-not-own.md) |
| `bun run texteda tools --json` | 工具清单（名字 / 描述 / JSON Schema），宿主据此适配 | [ADR-0044](docs/adr/10-process/0044-the-agent-surface-is-a-set-of-verbs.md) D7、D8 |
| `bun run texteda mcp` | 把同一批动词以 MCP 工具的形式通过 stdio 提供 | [ADR-0045](docs/adr/10-process/0045-the-mcp-server-is-a-slice-we-write-ourselves.md) |

**验收口径**（性质，不是命令）：

- **IR 只依赖语义**：打乱行序、换单位写法、换键序的同一描述，编译出的 IR 必须与 canonical 源**字节相同**。
- **round-trip**：每个渲染器都要过 `extract(render(ir)) == ir`；符号、封装、打印页已成立（[ADR-0036](docs/adr/09-view/0036-our-own-reference-renderer.md) decision 5；`spec/schematic-view.md` §9.5）。
- **格式化幂等**：`fmt(fmt(x)) == fmt(x)`；`fmt --check` 是 CI 门槛。
- **导出确定性**：同一块板两次导出**逐字节相同**，每份文件带 `source_hash` 与 `tool_version`；工程有 error 时一份不写。
- **几何内核**：整数 nm 进、整数 nm 出，同一输入两次输出**逐字节相同**；不支持的几何抛 `GeometryError` 而不是近似（[ADR-0018](docs/adr/05-pcb/0018-copper-fill-uses-a-geometry-kernel.md)）。
- **错误质量**：每条诊断含文件、行列、期望 / 实际、修复建议；`--json` 输出机器可读载荷；诊断位置来自编译期的"IR 路径 → 源 span"映射（[ADR-0004](docs/adr/01-language/0004-source-spans.md)）。
- **未落地**：conformance 黄金文件语料不存在；绑定用例缺正反例（F21）；困难用例没补齐（F12）；`.kicad_pcb` 板导出未落地（F15）；`fab` 描述没有实现。

**CI 与提交前**：提交前必须跑完整检查，不允许"只跑单测"。CI（`.github/workflows/ci.yml`，push 与 PR 到 `main` 都触发）跑 `bun run test`、`bun run typecheck`、`bun run gen:check`、`bun run lib:verify`、`bun run check:links`、`bun run check:public`、`bun run fmt:teda --check .`。**必过段全部零外部依赖**；KiCad 互操作段是**独立的可选 workflow**（`.github/workflows/ci-kicad.yml`，定时 + 手动触发），因为门禁不得依赖外部工具（不变量 20 / [ADR-0021](docs/adr/06-manufacturing/0021-the-manufacturing-output-path.md)）。

---

## 11. 待定问题（不要擅自决定）

工作项（不是待定问题）见 `docs/backlog.md`。**编号是稳定引用**（`docs/backlog.md` 与生成的 `docs/ir-reference.md` 按 `§11 Q8` / `Q10` / `Q17` 引用），增删条目时不要重排既有编号。每条只写结论与决策所在，理由在 ADR 里。

1. 语法形态（表格 vs 链式）？**已定**：主形式是表，不引入链式记法；组合用带端口的块（[ADR-0001](docs/adr/01-language/0001-fact-layer-has-no-expressions.md) D7）。
2. 表达式 / 参数化到什么程度？**原则已定、本条未关**：事实层的值是终值字面量，生成器在语言之外；受限表达式的引入条件已写死（十用例的"20 路电源域"证明表宽到不可用 + 常量算术 + 另起 ADR + 迁移脚本），**十用例跑完前保持待定**（[ADR-0001](docs/adr/01-language/0001-fact-layer-has-no-expressions.md)、F12）。
3. 器件库来源？**已定**：自建库用 `.teda` 写，KiCad 格式是导出产物（[ADR-0030](docs/adr/08-libraries/0030-footprint-format-and-geometry.md)、[ADR-0031](docs/adr/08-libraries/0031-symbol-format.md)）。
4. 导出优先 KiCad 还是 Circuit JSON？**已定**：KiCad（[ADR-0021](docs/adr/06-manufacturing/0021-the-manufacturing-output-path.md)）。
5. sch / pcb 的权威边界？**已定**：sch 决定连通性、pcb 只实现；偏差白名单封闭四类，白名单之外一律 error（[ADR-0014](docs/adr/04-schematic/0014-connectivity-has-one-authority.md) D1–D3，形状见 `spec/pcb.md` §4.11 / §4.12）。
6. 是否支持 pcb-only？**已定：没有**——一块板总有一份原理图；逆向与外部网表走导入器（[ADR-0014](docs/adr/04-schematic/0014-connectivity-has-one-authority.md) D5 / D6、F36）。
7. 多板连接器建模放哪层？**已定**：板在 `sch` 的 `ports` 段暴露节点，跨板连接在独立的 `system` 描述（[ADR-0009](docs/adr/03-project/0009-board-linking.md)）。
8. 变体影响 BOM 还是也影响校验？**已定**：只影响 BOM 与制造，**不改变连通性**、不影响 ERC（[ADR-0015](docs/adr/04-schematic/0015-flattening-and-the-net-set.md)）。
9. 从现有 KiCad 工程反向导入？**已决定延后**：一切导入器决策一并延后，期间不写半成品入口；重开条件按事件不按日历（F36）。
10. `Requirement` / `Block` / `Analysis` 进语言吗？**已定：都不进**——它们是流程产物，不是设计输入；`Block` 与 `module` 是正交的两轴（[ADR-0040](docs/adr/10-process/0040-process-entities-outside-the-language.md) D1 / D2）。
11. 追溯粒度追到哪层？**已定**：追到 net 为止，链条写在文档里（[ADR-0040](docs/adr/10-process/0040-process-entities-outside-the-language.md) D5）。
12. 仿真证据如何判定仍适用？**已定**：绑定 `source_hash`，哈希变了报 warning；仿真不进 IR、不改工程哈希（[ADR-0040](docs/adr/10-process/0040-process-entities-outside-the-language.md) D3 / D4）。
13. 实现语言与运行时？**已定**：TypeScript（strict、ESM）+ Bun；`core` 要能跑 Node ≥ 20 与浏览器；不引入 zod（[ADR-0038](docs/adr/10-process/0038-implementation-stack-and-agent-entry.md)）。
14. 器件用家族 / 继承还是一料一号一文件？**已定**：显式 `kind: part` / `kind: generic` 区分，不做继承（[ADR-0024](docs/adr/07-devices/0024-the-device-kind-is-part-or-generic.md)；额定值归件自己：[ADR-0026](docs/adr/07-devices/0026-a-part-states-its-own-ratings.md)）。
15. 实例与 net 是否加显式 `id`？**已部分落地**：实例有稳定 `uid`；net / port 的名字仍是身份，引用仍按名字解析，所以改 refdes 仍改源码与 `source_hash`（[ADR-0010](docs/adr/03-project/0010-instance-identity-is-a-uid.md)）。
16. 层次（`module`）进语言吗？**已落地模块层**，IR 仍存展平结果；参数、嵌套、跨工程模块库未做（`spec/module.md`、[ADR-0013](docs/adr/04-schematic/0013-modules-compose-boards.md)、F13）。
17. `fab` 描述进语言吗？**形态已定、实现延后**：默认产物是制造中立的数据而非 Gerber（[ADR-0021](docs/adr/06-manufacturing/0021-the-manufacturing-output-path.md) D9、F14 / F15）。
18. 困难用例语料谁来写？**已决定延后**，延后期间用 ADR 代替用例证据（F12）。

**近期已定（不再讨论，细节见对应 backlog / ADR）**：诊断错误码 = `域.slug`，码冻结、只增不改（[ADR-0003](docs/adr/01-language/0003-diagnostic-error-codes.md)）；事实层不使用表达式（[ADR-0001](docs/adr/01-language/0001-fact-layer-has-no-expressions.md)）；契约层永久开源、项目是纯开源技术规范、无商业计划（[ADR-0039](docs/adr/10-process/0039-licensing-and-open-standard.md)，不变量 19）；核心链路零外部依赖、KiCad 是可选后端、Gerber 写出器自研、CAM 判定不自研（[ADR-0021](docs/adr/06-manufacturing/0021-the-manufacturing-output-path.md)，不变量 20）；**语言只有一个版本号**（[ADR-0002](docs/adr/01-language/0002-one-language-version-number.md)）。

---

## 12. Agent 工作方式

- **先改 spec，再改实现。** 规范与 conformance 用例同一次提交。
- **改 IR 语义要同时改 `schemas/` 与 conformance 用例。** JSON Schema 是唯一契约（TS 类型由它生成，项目里没有 zod）。改完跑 `bun run test packages/ir`（契约正反例；夹具在 `tests/schemas/valid` 与 `tests/schemas/invalid`）与 `bun run gen`（重新生成类型）。**注意：`tests/schemas/` 下没有独立的 runner，那条 `cd tests/schemas && node run.mjs` 是过时写法。**
- **不要加规范里没有的"顺手功能"。** 需要就先写 ADR。
- **不要为了通过测试而放宽语义**（例如把未知字段当警告）。
- **不要给契约层加许可限制**（不变量 19）：`spec/`、`schemas/`、`examples/`、`tests/` 的开放性不可交易——**没有商业计划，开放性不是可交易的东西**。
- **错误信息是产品**：写实现时同时写诊断文案与 `--json` 结构。诊断码用 `域.slug`，码表是唯一真源、发出即冻结（[ADR-0003](docs/adr/01-language/0003-diagnostic-error-codes.md)）。
- **改任何文件前先声明它属于哪一层**（project / sch / pcb / fab / view）；不要把派生层的东西写回真源。
- **仿真结论不得只写成注释或散文**；作为 `Analysis` 证据绑定 `source_hash` 与假设，否则视为未验证。
- **写器件参数先查角色词表**（[ADR-0025](docs/adr/07-devices/0025-device-vocabulary-and-parameter-roles.md)）：`params` 段的列名是**角色**、类型是**量纲**；角色名用语言自己的写法（`sat_current`，不是 `I_sat`），必填列由 `construction` 决定（`spec/teda.md` §6.2.2）。**不要把值塞进文件名**——通用器件的 id 不带值、不带耐压；值在 `instances` 行里。**`instances` 行是一份完整规格**：必填列就是采购单上写这个器件时写的那几项。
- **导入的副本就是自有器件**：拷进 `assets/` 之后随你改；要跟上游新版本就在另一个目录里再 `lib import`（撞 id 时 `--force`，或者先删旧的）。改动之前先读 `# imported from …` 那行注释，知道自己在分叉谁。
- **sch 不内联器件**：新增料号先落 `assets/components/**/<id>.teda`（`kind: part`），通用无源件也落同一棵树（`kind: generic`），再在 `instances` 引用。
- **源码只允许英文**：`.ts` 的注释、文档字符串、字符串字面量，`schemas/ir/**` 的 `description` / `title`，`examples/**` 的 `.teda` 与 `project.toml` 注释、`title`、`manufacturer` 等值。检查口径：`git grep -lP '[\x{4e00}-\x{9fff}]' -- packages schemas examples` 应为空。**根 README 双语**：`README.md` 英文（对外入口），`README_cn.md` 中文。
- **项目名的写法分层**：品牌与散文写 `TextEDA`（大写 T）；命令行、包名、域名写小写 `texteda`；**仓库名例外，用 `TextEDA`**（GitHub 上是 `luffffyz/TextEDA`，改名即旧 URL 失效）；扩展名 `.teda` 不变。**不写 `textEDA`**。检查口径：`git grep -n 'textEDA' -- . ':!AGENTS.md'` 应无输出。
- **文档默认英文**：`docs/`、`spec/`（含 `spec/teda.md`）、ADR、根 README、`docs/skills/**` 一律英文。**需要中文时先问**，不要自行决定；本规则之前写下的中文文档保持原样。**已登记的例外**：`docs/assets/DESIGN.md`（品牌设计说明，作者原稿）。**生成的文档**跟着生成源走。
- **`docs/adr/` 用英文**：ADR 是契约层的一部分，第三方实现者要读得懂。正文用英文，引用它的文档按编号引用。检查口径：正文不得有中文，**唯一例外是外部专有名词与官方文档标题的括注**。
- **引用要可解析**：提到某条决策时写成 `[ADR-0003](docs/adr/01-language/0003-diagnostic-error-codes.md)` 这样的链接——**链接文字是编号**（编号稳定，标题会改），**链接目标是文件**；编号不能光秃秃地出现在正文里，链接路径相对于所在文件。**同一段里两条链接指向同一份记录时各自带 `D<n>`**：合并后的记录一份管几件事，光给编号说不清指的是哪一条。
- **章节引用要写全名**：写 `spec/pcb.md` §4.9，不要只写节号。章节被重编号或删除时，**活文档里的引用要一起改**（门禁判 error）；决策记录与试跑记录里的过期指针**不改**、由门禁报 warning——那两份是历史记录，追着改会毁掉它存在的理由。
- **ADR 的形状**：记录住在 `docs/adr/<topic>/NNNN-<slug>.md`，文件夹是**主题**（这条决策管什么），不是层 / 产物 / 时间；顶层索引是 `docs/adr/README.md`（一节一个文件夹、一张四列表），每个文件夹另有 `README.md` 说清"本文件夹管什么、不管什么、按什么顺序读"。头部固定为 `# ADR-NNNN: Title` + `Status:` + `Date:` + `Scope:` +（可选）`Related:` + `Impact:`，状态词封闭在 `Accepted` / `Proposed`；**`Scope:` 一行写全两半**——`Decides:` 这条决策断言什么、`Does not decide:` 邻接的问题在哪份记录里回答；**`Related:` 互相对称**——它列出谁，谁也要列出它。这些都由 `bun run check:links` 机器校验，**新增或改 ADR 后必须跑它**。
- **编号只增不改不重用**：一个扁平计数器，从 `0001` 起，写的时候取下一个空号（当前下一个是 `0048`），与文件夹无关（文件夹给的是位置，不是编号）；只要取过号就永不改、永不重发。`0100`–`0146` 已退役——那 47 条决策的旧号，2026-10-30 整体重写成了 `0001`–`0047`；退役区间与在用号段不相交，漏改的引用指向不存在的号（门禁当场报错），而不是悄悄指向另一条决策。索引里的"已预留"表只列**声明了还没写**的号；退役区间单独一行。更早的语料号段已整体并入在用号段，早期引用指向的是另一条决策，映射只在 git 历史里。
- **改错是就地改，不是追加附录**：记录陈述的是**现在为真的事**，写错了就改那一句；带日期的附录只留给**退役记录**（`Status:` 指向取代它的那条）。历史在 git 里，不在正文里积累。
- **拆活时，共享的验证器不能当作各分片的验收标准。** 分片共享"会变的门禁"时，"绿了"什么也不证明——要么先冻结门禁、派工只改被它检查的内容，要么这一组串行。改 `scripts/check-*.ts` 或任何自校验工具，diff 必须逐行读：门禁抓不到门禁自己的回归。
- **同一句话里不要既给规则又给例外。** 矛盾的规格一定会被执行成错的那一半。
- **派工看"对错能不能被门禁判"，不看文件数或行数。** **派**：枚举、审计、纯删除加引用收口、机械迁移、能由 `bun run test` / `bun run check` / `fmt:teda` 判定对错的重构。**不派**：散文可读性（ADR 正文、README）、视觉几何（符号 / 封装 / 打印页）、共享门禁脚本的语义改动——这三类的对错门禁表达不了，只能逐行读 diff（门禁脚本若尚无测试，先补测试，`scripts/check-links.test.ts` 是范例）。判分的活即使派出去也必须配逐行 diff 复核，因为子代理报"绿色"不构成证据。**派审计时分片范围要写死到"哪个文件、哪个正则、输出哪几列"**——范围是派工的一部分。
- **判研（judge）的分档判据由 omp 内置，不要自造短版 rubric 去测它。** `prewalk.auto` 与 `find.enabled: auto` 都走 `judge` 角色，rubric 是 `omp://prewalk.md` 里那张带例子的三档表，验证时必须逐字复制：简化标签会让同一批任务判错，错的是**探针**不是模型。改 `prewalk.autoTarget` 前先确认目标角色指向哪个模型：角色是别名，模型会被换掉。
- **提交信息英文**。
- **新增依赖需要 ADR**；默认零运行时依赖的 parser 是目标。
- **改完 schema 必须重生成**：`bun run gen`（产物在 `packages/ir/src/generated/`、`docs/error-codes.md`、`docs/ir-reference.md`、`docs/api-reference/`，均不手改），CI 用 `bun run gen:check` 挡住漂移；`bun run test` + `bun run typecheck` 必过。
- **`ir` / `parser` / `exporter` / `renderer` 禁止 `Bun.*` 与 `process.env`**（`core` 同样适用）：这些包要能跑在 Node 扩展宿主与浏览器里；文件系统只允许出现在 CLI / 导出层（[ADR-0038](docs/adr/10-process/0038-implementation-stack-and-agent-entry.md) decision 1）。

---

## 13. 背景数据（动机，别重复测量）

- **KiCad 格式存的是成稿，不是设计**：1 个电阻 + 2 个 label 序列化成 3746 B，纯语义约 25 B（0.7%）；`lib_symbols` 独占 47.5%。它是导出目标，不是 IR 的参照物。实测明细见 `docs/comparison.md` 的 "Why KiCad files are not the IR"。
- **同类项目定位**：SKiDL、schematizer、atopile、tscircuit、wire-lang、Polymorphic Blocks、cohdl——逐项对比与"为什么没有照抄它们的形态"见 `docs/comparison.md`。
