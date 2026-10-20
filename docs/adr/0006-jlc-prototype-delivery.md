# ADR-0006：打样交付与嘉立创（BOM / 坐标 / 免费券资格）

状态：已接受
日期：2026-10-20
影响范围：`teda.md` §6.1（新增 `lcsc` 标量）、§11、§13；`docs/adr/0005-manufacturing-output.md` 决策 1、4

## 背景

嘉立创这条链上有**两个互相独立的义务**，混起来会得出错误结论：

1. **打样文件**：制造要 Gerber + Drill，贴片要 BOM + 坐标文件（CPL）。嘉立创给了**公开的、与 EDA 无关的格式规范**（官方《嘉立创BOM&坐标相关格式规范》，2026-08-11 更新）。任何 EDA 都能产出这套文件。
2. **免费打样资格**：2022-08 起改为**领券制**（官方《PCB免费打样规则变更正式实施，新增6层免费》，2022-07-30）：
   - **通用券**：上月 PCB 实付 ≥ 20 元 → 每月 2 张，**不限 PCB 软件**（嘉立创EDA 文件同样可用通用券）。
   - **嘉立创EDA 专属券**：上月无实单 → 每月 2 张，**整个 PCB 必须完全是用嘉立创EDA 设计的，不能是直接导入的其它软件的 PCB**；官方同时明确"导入了第三方 EDA 的**库文件**后，使用导入的库文件从头绘制的 PCB 是允许的"——即器件库可以外来，PCB 设计文件不能外来。
   - 6 层券另有限制（≤10×10cm、1.6mm、5 片、绿油、单片出货、不拼板、无阻抗）并需晒图；双面板免杂色费；另有少量 SMT 盲盒券（只付元器件费）。
   - 旧的"每月自动 2 次、不限软件"规则已被领券制取代。

SMT 侧的事实（同一份官方规范）：BOM 必需 `Comment` / `Designator` / `Footprint`，推荐填**嘉立创元件编号（C 编号）**，且**编号优先**——官方原话是"错误编号比缺少编号更容易造成错误匹配"；坐标文件必需 `Designator` / `Mid X` / `Mid Y` / `Layer` / `Rotation`，推荐列序 `Designator → Footprint → Mid X → Mid Y → Ref X → Ref Y → Pad X → Pad Y → Layer → Rotation → Comment`，单位 mm、原点与 PCB 一致，顶底层建议同文件、底层旋转方向各 EDA 不同需 2D 复核；PCB、BOM、坐标必须同版本、位号不重不漏、不贴器件处理一致，否则 SMT 检查会判异常。嘉立创 DFM 客户端可做 SMT 检查（开短路分析、锣程计算等）。

现状缺口：项目里的器件绑定（`examples/reference-project/components/**/*.teda`）只有 `mpn` 与 KiCad 符号/封装引用，**没有嘉立创商城料号**，BOM 无法可靠匹配 SMT 物料。

## 已核实的工程格式事实（2026-10-20，来自真实工程备份 `ProPrj_DMX512_FT232_2026-10-20.epro2`）

嘉立创 EDA 专业版 4.1.78 导出的 `.epro2` = zip，含 `project2.json`（title / editorVersion）、`<name>.epru`（工程数据）、`IMAGE/*.webp`（模型与图片）。`.epru` 就是官方 V3 格式：**每行 `{外层}||{内层}`**，外层是 `{type, id, ticket, firstTicket}`（`id` 常是 `["类型","键"]` 形式的复合 id，`ticket` 决定最终一致性），内层是数据。

**文档种类**（原生工程是自包含的）：`SCH` 1、`SCH_PAGE` 2、`SYMBOL` 38、`DEVICE` 38、`FOOTPRINT` 13、`PCB` 1、`BOARD` 1、`CONFIG` 1、`BLOB` 1。器件、符号、封装全部内嵌在工程里（`ELE_PLACEHOLDER` 记录库对象数量，如 `{dataType:"PAD", max:19}`）。

**关键记录模型**（与本项目 IR 的落点）：

| 内容 | LCEDA 记录 | 字段要点 |
|---|---|---|
| 网名 | `NET` | 网名在**外层 id** 里：`["NET","GND"]`；自动网名形如 `$1N1324` |
| 走线 | `LINE` | `{netName, layerId, startX/Y, endX/Y, width}` |
| 过孔 | `VIA` | `{netName, centerX/Y, holeDiameter, viaDiameter, viaType, topSolderExpansion, bottomSolderExpansion}` |
| 焊盘（在封装文档内） | `PAD` | `{netName, layerId, num, centerX/Y, defaultPad{padType,width,height,radius}, specialPad, hole, plated, topSolderExpansion, bottomSolderExpansion, topPasteExpansion, bottomPasteExpansion}` |
| 焊盘↔网绑定 | `PAD_NET` | 外层 id = `["PAD_NET",<元件id>,<焊盘号>,<网id>]` |
| 元件 | `COMPONENT` + 子 `ATTR` | `COMPONENT` 存位置/角度/层；位号、值、封装、器件是 `ATTR` 子记录（`parentId` 指回元件），`key` ∈ `Designator` / `Value` / `Footprint` / `Device` |
| 铜皮 | `POUR` + `POURED` | `POUR` 存 outline（`netName/layerId/width/path/pourType{fineness}/keepIsland`），`POURED` 存**填充结果**（派生量，文件里两者都在） |
| 规则 | `RULE` + `RULE_SELECTOR` | `RULE` 存 `ruleContext{unit:"mm", safeSpacing[…]}`；`RULE_SELECTOR` 18 条，按 `["NET","+5V"]` 之类选择器绑定（即按网的规则） |
| 器件元数据 | `DEVICE` 的 `META.attributes` | `{"LCSC Part Name", "Supplier Part", "Manufacturer", "Manufacturer Part", "Supplier Footprint", "JLCPCB Part Class", "Datasheet"}` + `images` + `tags` |
| 层 | `LAYER` | 1 Top、2 Bottom、3/4 丝印、5/6 阻焊、7/8 锡膏、9/10 装配、11 板框、12 Multi、13 Document、14 Mechanical；板框是 `POLY`（`polyType: BOARD_OUTLINE`） |

**两条要紧的坑**：

1. **单位是 1 mil（0.0254 mm），不是官方文档写的 0.01 inch。** 依据：0402 焊盘 `19.685×21.26` → 0.50×0.54 mm；0603 焊盘 `31.496×35.433` → 0.80×0.90 mm；USB-C 触点 `11.811×55.118` → 0.30×1.40 mm；走线宽 `11.811` → 0.30 mm；过孔 `21.6536/11.811` → 0.55/0.30 mm。官方《嘉立创EDA文件格式》V3 章写的"0.01 inch"与之差 10 倍，按官方说法写会放大 10 倍。
2. **阻焊扩张与锡膏扩张是"每焊盘"字段**（`topSolderExpansion` / `topPasteExpansion` 等），不是板级设置 → IR 的 `rules.mask` / `rules.paste` 在导出时要落到每个焊盘，不能只写板级默认值。

**料号字段确认**：嘉立创商城料号就是 `DEVICE` 的 `attributes["Supplier Part"]`（值形如 `C14663`）。本项目的 `component` 标量 `mpn` / `manufacturer` / `lcsc` 与它一一对应（`Manufacturer Part` / `Manufacturer` / `Supplier Part`）。`teda.md` §6.1 的 `lcsc` 由此得到实证。

## 决策

1. **打样文件与 EDA 无关**：Gerber / Excellon 由 KiCad 链产出（`docs/adr/0005-manufacturing-output.md` 决策 1）；BOM 与坐标文件按嘉立创公开规范产出。**不因为要打样而引入嘉立创EDA 依赖**——通用券与全部 SMT 订单都不需要嘉立创EDA 工程。
2. **验证仍归 KiCad DRC**（ADR-0005 决策 6），不因新增打样义务而改变；嘉立创 DFM 客户端是厂家的外部检查器，我们不自研 CAM 级 DFM 的边界不变。
3. **器件绑定增加嘉立创商城料号**：`component` 新增标量 `lcsc <C编号>`（如 `C14663`）。规则：
   - **不猜料号**：料号必须人工核对后写入。错误编号比没有编号更危险（官方明说），所以工具不得自动填、不得按型号猜。
   - 通用无源件（`category` 为 `resistor` / `capacitor` / `inductor` 且 `params` 含 `value`）的 `lcsc` 同样可省。
   - `lcsc` 缺失不阻断导出，但 BOM 导出必须给**警告**，并把该行标为"待人工匹配"。
4. **BOM 与坐标文件是 IR 的投影**（导出目标），不引入新语义：
   - BOM 列：`Comment`（器件描述）、`Designator`、`Footprint`（取 `package`）、嘉立创元件编号（取 `lcsc`）、`Quantity`。
   - 坐标列：`Designator`、`Mid X`、`Mid Y`、`Layer`、`Rotation`（自 `place` 派生），单位 mm，原点与 Gerber 一致。
   - 一致性（PCB / BOM / 坐标同版本、位号不重不漏、不贴器件处理一致）由检查器保证，违反则拒绝出包。
5. **嘉立创EDA 原生工程是可选增强，不是 v1 义务**：只为"嘉立创EDA 专属券"（上月无实单的用户）服务。技术路径已核实可行：
   - Pro 文件格式 V3 公开（官方提供 2025.10.21 版 zip / md / pdf）：日志式结构，每行 `{外层}||{内层}`，`DOCTYPE` 头区分文档类型，`type` / `id` / `ticket` 决定最终一致性，键名驼峰 → **可脚本生成**，不是黑盒二进制。真实工程已验证该结构（见上节）。
   - Pro 客户端内置命令行与 JS API：`lceda-pro open [--path] [--headless]`、`session list|close|abort`、`invoke --code <js>`、`doc api|external|format`、`--mcp stdio|http`、`doctor`；官方还直接提供"给 AI 命令行客户端"的提示词文档 → agent 可驱动。
   - **合规路径有官方依据**：官方规则允许"导入第三方 EDA 的**库文件**后，使用导入的库文件从头绘制的 PCB"。因此把 KiCad 的符号/封装转成嘉立创的 `SYMBOL` / `FOOTPRINT` / `DEVICE` 库文档，再由 IR 生成 `PCB` 文档，属于"从头绘制"而非"导入 PCB"——这条路径在规则上是站得住的。
   - **成本估计（有界）**：不是"写一个板文件"，而是要生成五类文档（`DEVICE` / `SYMBOL` / `FOOTPRINT` / `SCH_PAGE` / `PCB`）+ `CONFIG` / `BOARD`。几何来源与 KiCad 路径共用同一批库，增量主要是**一套 LCEDA 文档生成器** + 库格式转换，不含新的几何算法。
   - **待核实（实测前不当结论）**：脚本生成的工程是否被判定为"原生设计"；Pro 客户端是否提供 Linux 版本（本工作区是 Linux x64）；原理图页是否也必须生成（规则只说 PCB，但工程结构里原理图是 `SCH_PAGE` 文档）。
6. **KiCad 与嘉立创EDA 不是二选一**：KiCad 承担 DRC、器件库、工业格式（IPC-2581、ODB++、STEP）与人工继续编辑入口；嘉立创EDA 只在需要专属券时出现。两者承担的义务不重叠。

## 后果

- 打样链路不新增外部依赖（仍只有 KiCad），但 IR 多了一项必须人工维护的事实（料号），错了会静默贴错料 → 因此规定"不猜料号、缺失即警告"。
- 上月有实单的用户（通用券）可以直接下单；上月无实单的用户要用专属券，得等我们提供嘉立创EDA 原生工程出口（决策 5）。
- BOM / 坐标的列名与嘉立创规范耦合 → 规范变更要跟着改，列入定期核对。
- 官方规则里"必须是原生设计、不能导入"是**人工 + 系统混合判定**，我们无法从文档 100% 推断判定逻辑 → 决策 5 的第一项必须用真实下单验证，不能靠推断下结论。

## 后续

- `teda.md`：加 `lcsc` 标量与校验规则（`C[0-9]+`）——已做；demo 器件暂不填料号（不猜）。
- 实现 BOM 与坐标文件导出，按决策 4 的列。
- 若要走专属券路径：装嘉立创 EDA 专业版客户端，实测 Linux 可用性、CLI 驱动、脚本生成工程的"原生性"。（2026-10-20 起**暂缓**：嘉立创原生工程出口不排进 v1，先做 DRC/检查器方向。）
- 定期核对嘉立创 BOM / 坐标规范页与免费打样规则页。
- 需要时可把解析 `.epru` 的检查脚本固化为工具（当前为一次性分析脚本，未入库）。
