# `pcb` 描述规范（v0.4，草案）

状态：草案。决策与取舍见 `docs/adr/0003-agent-first-pcb-ir.md`；跨描述通用的词法、单位、版本、canonical 规则见 `teda.md` §3–§6、§10、§12。

本文件是 `teda.md` 的分描述补充：`.teda` 语言的共用规则在 `teda.md`，`pcb` 这一类描述的具体段定义在这里。

---

## 0. 定位

`pcb` 描述表达 **B0（PCB 物理事实）**。它与 `schematic` 平级、互不为父子，共享同一身份空间（`net_id`、实例 ID、pad 号 ↔ 引脚编号）。

三条底线（`AGENTS.md` §2）：

1. **连通性只由逻辑模型决定**。pcb 不得隐式增删逻辑连接；偏差必须显式声明并进报告（§5.3）。
2. **逻辑专属 / 物理专属必须显式标记**。物理实体进 `physical_only`，逻辑偏差进 `deviation`。
3. **派生层的东西不进 IR**：绘图参数、丝印排版、铜皮填充结果、量测文本、UUID 与内部序号一律不存（`docs/adr/0003-agent-first-pcb-ir.md` decision 3）。
4. **制造出口自研，判定借专业工具**：RS-274X / Excellon 写出器与铜皮填充用的受限 2D 几何内核由本仓实现（[ADR-0018](../docs/adr/0018-zero-dependency-and-manufacturing-target.md)、[ADR-0054](../docs/adr/0054-copper-fill-uses-a-constrained-geometry-kernel.md)）；KiCad 的 Gerber 导出与 DRC 是**可选对照**，不是门禁；CAM 级 DFM 判定仍借专业工具。路径见 `../docs/adr/0005-manufacturing-output.md` 与 `../docs/adr/0034-manufacturing-output-target-form.md`；打样文件（BOM / 坐标）规范见 `../docs/adr/0006-jlc-prototype-delivery.md`。

v0.4 **假定存在对应的 `sch`**。pcb-only 模式（逆向工程、外部网表导入）待 `AGENTS.md` §11 第 6 条决定后补充。

---

## 1. 文件头

```
version 0.4
pcb main
```

- 版本行、类型行规则同 `teda.md` §5。`pcb` 类型要求 `version 0.4` 或更高（该类型由 0.4 引入；接受规则见 `teda.md` §13.3）。
- **段头独占一行**（整行只有一个单元格）。缩进不表达层级（`AGENTS.md` §2 第 6 条），所以 `via` 这类既是段名又是 `rules` 行首列的词，只能靠列数消歧：规则行至少有 2 列。
- **同一段可以重复出现**，行按出现顺序拼接（与 `teda.md` 里同名 `net` 行合并同一先例）。`stackup` 的顺序即叠层顺序，重复段就接在后面，不做排序。
- 文件名必须等于类型行里的 id：`design/pcb/<board_id>.teda` ↔ `pcb main`。
- `pcb` 描述与 `sch` 描述共享 `board_id`；`design/sch/<board_id>.teda` 与 `design/pcb/<board_id>.teda` 描述同一块板。

---

## 2. 标量

```
board_thickness 1.6mm
```

| 键 | 必填 | 说明 |
|---|---|---|
| `board_thickness` | 是 | 板总厚。与 `stackup` 各层厚度之和一致（阻焊与字符层不计）。 |

其余制造参数（表面处理、阻焊颜色、阻抗工艺说明）属 fab 层（P3），不进 pcb 描述。

---

## 3. 段总表

| 段 | 内容 | 必填 |
|---|---|---|
| `stackup` | 叠层（层序、类型、厚度、材料） | 是 |
| `outline` | 板框折线 | 是 |
| `place` | 实例放置（坐标、旋转、面） | 是 |
| `connect` | 显式连接：哪两个 pad 之间有连续铜箔 | 是 |
| `trace` | 走线折线 | 否 |
| `via` | 过孔 | 否 |
| `zone` | 铜皮 | 否 |
| `keepout` | 避让区 | 否 |
| `rules` | 设计规则（间距、线宽、过孔、差分、等长、阻焊/锡膏/热焊盘） | 是 |
| `silk` | 丝印出图规则（出不出、字高、哪层） | 否 |
| `physical_only` | 物理专属实体 | 否 |
| `deviation` | 受控逻辑偏差 | 否 |

段顺序固定，见 §6.1。

---

## 4. 段定义

### 4.1 `stackup`

每行是叠层上的一项，**顺序即从上到下**（不可排序）。

```
stackup
  F.Cu    copper     0.035mm  signal
  prepreg dielectric 0.210mm  FR4 4.3
  B.Cu    copper     0.035mm  signal
```

两种行，按第 2 列区分：

| 行 | 列 | 说明 |
|---|---|---|
| 铜 | `<name> copper <thickness> <kind>` | `kind` ∈ `signal` / `power` / `plane` |
| 介质 | `<name> dielectric <thickness> <material> [er]` | `er` 为介电常数，省略表示未知 |

- 第一项必须是顶层铜，最后一项必须是底层铜；`name` 用规范层名（`F.Cu`、`In1.Cu`、`B.Cu`），介质层名用 `prepreg` / `core` / `d1`…。
- 铜层总数 = 板层数；`In1.Cu` 之类的内层必须连续编号。

### 4.2 `outline`

每行一个顶点，构成板框闭合折线（首尾自动闭合）。

```
outline
  0.0 0.0
  40.0 0.0
  40.0 30.0
  0.0 30.0
```

- 至少 3 个顶点；不得自交。
- 只支持折线，**不支持圆弧**（v0.4 限制，见 §7）。
- 板内开孔与安装孔进 `physical_only`（`cutout` / `mounting`）。

### 4.3 `place`

```
place
  U1    12.0 12.0  0   top
  P1.R1 18.0 12.0  90  bottom
```

列：`<instance_id> <x> <y> <rot> <side>`。

- `instance_id` 是**稳定实例 ID**（板级实例 `R1`，模块实例 `M1.R1`，见 `teda.md` §7.6、`spec/module.md` §5），不是 refdes：refdes 可改名，ID 不变（`AGENTS.md` §2 第 5 条、§4.4）。
- 必须解析到 `sch` 展平后的实例；未放置的 sch 实例按变体状态处理（DNP 不占位）。
- `side` ∈ `top` / `bottom`；`rot` 单位为度，顺时针为正。
- 坐标单位 mm，原点为板框包围盒的左下角。

### 4.4 `connect`

**显式声明**哪些 pad 之间有连续铜箔。连通性的真源是这一段与 `sch`，不是几何（`AGENTS.md` §2 第 2 条）。

```
connect
  U1.4  C1.1
  U1.4  R1.2
```

- pad 引用 = `<instance_id>.<pad_number>`；从**最后一个** `.` 分割出 pad 号（实例 ID 可含 `.`）。
- pad 号来自封装（`assets/components/` 的 `footprint`），必须与 sch 引脚编号对应（`AGENTS.md` §4.4 第 2 条）。
- 一对 pad 构成一条"有铜箔连通"的边；一个 net 的 N 个成员至少需要 N-1 条边（可成环，不禁止）。
- 校验见 §5.2。

### 4.5 `trace`

```
trace
  VBUS  F.Cu  0.5mm  8.0 6.0  12.0 6.0
```

列：`<net> <layer> <width> <x1> <y1> [<x2> <y2> …]`。

- 至少 2 个点；点之间是直线段（直线、45° 斜线都能表达）。
- `net` 必须存在于 `sch`；`layer` 必须是 `stackup` 里的铜层。
- **只支持折线**，不支持圆弧段（§7）。
- 差分对不是几何对象：两条线各自一条 `trace` 行，差分/等长/阻抗约束在 `rules`（`docs/adr/0003-agent-first-pcb-ir.md` decision 5）。

### 4.6 `via`

```
via
  VBUS  12.0 6.0  0.6mm 0.3mm
  GND   20.0 14.0 0.6mm 0.3mm  F.Cu  B.Cu
```

列：`<net> <x> <y> <size> <drill> [<from_layer> <to_layer>]`。

- 省略最后两列 = 通孔（贯穿全部铜层）；给出时为盲孔/埋孔，连接 from→to 之间的层。
- 微孔（HDI）不支持（§7）。

### 4.7 `zone`

```
zone
  GND  B.Cu  0.0 0.0  40.0 0.0  40.0 30.0  0.0 30.0
```

列：`<net> <layer> <x1> <y1> [<x2> <y2> …]`。

- 顶点构成闭合多边形；至少 3 个点。
- 只存**意图**（轮廓 + 所属 net + 层）。填充参数（clearance、thermal、min_thickness）走 `rules` 与全局默认。
- **填充结果不入 IR**：由 `zone` 轮廓 + `rules` 在导出时用受限 2D 几何内核重算（[ADR-0054](../docs/adr/0054-copper-fill-uses-a-constrained-geometry-kernel.md)），结果不进工程哈希；缓存只能是可删除、可重算的派生物（[ADR-0003](../docs/adr/0003-agent-first-pcb-ir.md) decision 3）。
- **同一层上不同 net 的两块 zone 不得重叠**：重叠就是短路的铜，IR 没有优先级字段，所以填充直接拒绝并报 `drc.zone-overlap`（error），两块都不出铜。同 net 的重复 zone、或同轮廓放在另一层，都不算重叠。
- 填充的判定顺序与已知限制见 §8.1；填充结果与文件字节的关系见 §8.2。

### 4.8 `keepout`

```
keepout
  no_place  F.Cu  30.0 20.0  38.0 20.0  38.0 26.0  30.0 26.0
```

列：`<type> <layer> <x1> <y1> [<x2> <y2> …]`。

- `type` ∈ `no_track` / `no_pour` / `no_place` / `no_via`。
- 顶点构成闭合多边形。

### 4.9 `rules`

首列是规则类型（与 `teda.md` §7.4 `constraints` 同风格：列数与语义由类型决定）。

```
rules
  clearance  0.2mm
  width      0.25mm
  via        0.6mm  0.3mm
  net        VBUS  0.3mm  0.5mm  0.8mm  0.4mm
  diff       USB_DP  USB_DN  90Ω  0.2mm
  match      USB_DP  USB_DN  0.5mm
  mask       0.05mm
  paste      0.9  -0.02mm
  thermal    0.25mm  0.4mm
  min_width  0.15mm
```

| 类型 | 列 | 说明 |
|---|---|---|
| `clearance` | `<value>` | 默认铜间距 |
| `width` | `<value>` | 默认线宽 |
| `via` | `<size> <drill>` | 默认过孔环与钻孔 |
| `net` | `<net> <clearance> <width> <via_size> <via_drill>` | 按 net 覆盖默认（值必须写全，不写"继承"） |
| `diff` | `<netA> <netB> <impedance> <gap>` | 差分对：目标阻抗与对内间距 |
| `match` | `<netA> <netB> <max_delta>` | 等长容差 |
| `mask` | `<expansion>` | 阻焊开窗相对焊盘的扩张量 |
| `paste` | `<ratio> <offset>` | 锡膏开口比例（0–1）与相对焊盘的偏移 |
| `thermal` | `<gap> <bridge>` | 铜皮与焊盘之间的热焊盘间距与桥宽 |
| `min_width` | `<value>` | 铜皮填充与走线的最小线宽 |

- 规则**必须进 IR**：KiCad 把 netclass 与自定义 DRC 规则放在工程文件里，只拿 `.kicad_pcb` 的 agent 无法自查（`docs/adr/0003-agent-first-pcb-ir.md` decision 4）。
- 规则可以由 agent 提议，但必须经 **interactive mode 由用户拍板**后写入 `rules`；只存在于 prompt / skill 里的数值不是规则，检查器不读它（[ADR-0053](../docs/adr/0053-layout-and-routing-are-agent-driven.md) D6）。
- 导出到 KiCad 时映射为 netclass 与自定义规则（细则待定，见该 ADR 的"后续"）。

### 4.10 `silk`

丝印是制造物（Gerber 的 `F.SilkS` / `B.SilkS`），所以"出不出、多大、哪层"必须声明；**排版位置不进 IR**（`docs/adr/0003-agent-first-pcb-ir.md` decision 3），由确定性 policy 生成。

```
silk
  refdes  F.SilkS  1.0mm  show
  value   F.SilkS  0.8mm  hide
```

列：`<item> <layer> <size> <mode>`。

- `item` ∈ `refdes` / `value`；`layer` ∈ `F.SilkS` / `B.SilkS`；`size` 是字高；`mode` ∈ `show` / `hide`。
- 缺省（无 `silk` 段）：refdes 在 `F.SilkS`、字高 1.0mm、显示；value 隐藏。
- 位置来自封装库（借 KiCad / 嘉立创）；本段不描述位置。

### 4.11 `physical_only`

不影响逻辑的物理实体。列：`<id> <type> <x> <y> [args…]`，参数由类型决定。

```
physical_only
  H1  mounting   5   5    6     3.2
  F1  fiducial   45  31   1.0   F.Cu
  S1  stitching  10  30   GND   0.6  0.3
  X1  cutout     34  22   4.0   2.0
```

单位默认 mm，与其余几何段一致（canonical form 不写 `mm` 后缀，`spec/pcb.md` §6）。

`<x> <y>` 是实体的**参考点**，单位默认 mm，坐标帧同其他几何段。除了 `cutout`（参考点是矩形的一角），参考点都是几何中心——孔、点、过孔都是圆形，圆心就是它们唯一说得清的位置。

| 类型 | 参数 | 说明 |
|---|---|---|
| `mounting` | `<x> <y> <size> <drill>` | 安装孔，圆环外径与孔径 |
| `fiducial` | `<x> <y> <size> <layer>` | 基准点；**不得挂 net**（挂了是错误） |
| `stitching` | `<x> <y> <net> <size> <drill>` | 缝合孔：跨层连接**同一个 net 的多个层**；过孔不是焊盘，不算 net 的新成员 |
| `cutout` | `<x> <y> <w> <h>` | 板内矩形开孔/槽，`<x> <y>` 是左下角 |

`cutout` 的参考点与其余三类不同（角 vs 圆心），因为矩形用它自己的形状说话；圆形的"左下角"没有意义，所以统一取圆心。**位置是坐标，不是几何**：实体只有简单图元（圆孔、圆点、矩形开槽），要自定义形状就写成器件（`AGENTS.md` §4.4 第 7 条）。

**测试点不是本段的形态（2026-10-22b 退役，语言 `pcb` 线 0.7.1 删除）**：测试点是某个 net 上的一个**焊盘**，按 [ADR-0035](../docs/adr/0035-connectivity-authority-and-reverse-engineering.md) D8/D9 它是 `sch` 里的**单引脚器件**（不采购的是 generic，采购的是 part）：有位号、有封装（形状任意）、走普通 net 成员规则。分界线是"它是不是某个 net 上的焊盘"：是 → 器件；不是 → 本段的实体（过孔、安装孔、基准点、挖槽）。白名单因此是四类（`net_tie` / `split_ground` / `stitching` / `fiducial`），`stitching` 与 `fiducial` 是物理实体放本段，前两类改逻辑连通性放 `deviation`。

### 4.12 `deviation`

受控的**逻辑**偏差。`net_tie` 与 `split_ground` 会改变逻辑连通性，必须显式声明并进报告（`AGENTS.md` §4.4 第 4 条）。`stitching` / `fiducial` 两类是物理实体，放在 `physical_only`；它们同样进报告，但不改逻辑。

```
deviation
  net_tie       VBUS  VBUS_RAW
  split_ground  GND
```

| 类型 | 列 | 说明 |
|---|---|---|
| `net_tie` | `<netA> <netB>` | 两个 sch net 在物理上短接（合并两个 net） |
| `split_ground` | `<net>` | 一个 sch net 在物理上分成互不连通的区域（拆分一个 net） |

`net_tie` 与 `split_ground` 的分界是**合并 vs 拆分**。两者都是逻辑偏差：短接若没有声明就是错误；声明了也不等于"对"——检查器只负责报出来，对不对由人判（[ADR-0035](../docs/adr/0035-connectivity-authority-and-reverse-engineering.md) D2）。

**声明了也要进报告，严重度按危险程度分**（[ADR-0035](../docs/adr/0035-connectivity-authority-and-reverse-engineering.md) D10）：`net_tie` 是 **note**（常见且有意的声明——0Ω 跳线、焊接跳线——但它改变两个 net 的连通性，读者要看见）；`split_ground` 是 **warning**（一个 net——通常是地——被物理拆成互不接触的区域，回流路径在缺口处断开；它可以是合法的（隔离、分开的模拟地），但绝不是默认值，每一处都值得看一眼）。

**偏差白名单是封闭的**：只有 `net_tie` / `split_ground` / `stitching` / `fiducial` 四类（`test_point` 已于 2026-10-22b 退役，见 §4.11），加新类要另起 ADR。白名单是给**物理特性**与**拆分/短接机制**用的，不是给"sch 没写"兜底的。

---

## 5. 与 `sch` 的绑定与校验

### 5.1 身份映射

| 实体 | 键 |
|---|---|
| 器件 | `component_id`（`AGENTS.md` §4.4） |
| 实例 | 稳定实例 ID（`R1`；层次落地后 `M1.R1`） |
| 引脚 / pad | `(instance_id, pin_number)`；pad 号来自封装 |
| net | `net_id`（= net 名，sch 与 pcb 同一命名空间） |

pcb 里写的 net 名就是**板级** net 名，与 sch 同一命名空间（模块内的 net 用 `<module_instance_id>.<net>`），见 `teda.md` §7.6、`spec/module.md` §5。IR 里的身份键是 `net_id`，不是名字；名字只是表面语法的引用形式。

### 5.2 校验规则

1. `place` 的每个实例 ID 必须在 `sch` 展平结果里存在；sch 展平后未被放置的实例由规则 12 报出（变体决定 DNP 件装不装，不决定它的封装放不放）。
2. `connect` 的每个 pad 引用必须解析到已放置实例的 pad；pad 号必须存在于该器件的封装。
3. `connect` 的一对 pad 必须落在 `sch` 展平后的同一个 net 内；否则必须由 `deviation` 的 `net_tie` / `split_ground` 显式覆盖，否则报错。
4. `sch` 展平后每个 net 的每个成员 pad（限已放置实例）至少出现在一个 `connect` 对里；否则报"该 net 未布线"。未放置实例的 pad 不参与本检查（规则 1）。
5. `connect` 引用的 net 不得超出 `sch` 的 net 集合（pcb 不得创建新逻辑连接）。
6. `trace` / `via` / `zone` 的 `net` 必须存在于 `sch`；`layer` 必须在 `stackup` 里。
7. `rules` 里的 net 必须存在于 `sch`。
8. `physical_only` 的 `stitching` 必须引用 `sch` 里存在的 net；`fiducial` 不得挂 net。`stitching` 是跨层过孔（同一 net 的多个层），连接两个不同 net 的过孔按 `deviation` 的 `net_tie` 处理。
8a. **pcb 不得新增逻辑连接**：任何两 pad 之间的短接若不在同一个 sch net 内，必须由 `deviation` 的 `net_tie` / `split_ground` 显式覆盖，否则报 error。白名单之外的任何差异都是 error，不是 warning。
9. `board_thickness` 与 `stackup` 厚度之和一致（容差 0.05mm，规则本身不精确）。
10. `outline` 顶点不重复、不自交；`zone` / `keepout` 多边形同样不自交。
11. `silk` 段的 `layer` 必须是 `F.SilkS` / `B.SilkS`；字高小于 0.5mm 给出警告（多数板厂难以辨识）。
13. 每个 `connect` 对必须被**铜箔兑现**：该 net 的 `trace` 线段、`via` 桶、`zone` 多边形要能连成一条同时触及两端 pad 的链（链只在 via 处换层）。不成立报 `bind.connect-unbacked`（warning）——布局是渐进过程，检查器要在中途可用（[ADR-0041](../docs/adr/0041-connect-pairs-must-be-implemented-by-copper.md) D1/D5）。几何口径：pad 取**外接圆**、走线按线宽半宽加粗、容差 1 nm（D3），所以"查不出"只会漏报、不会误报；相邻两 pad 之间的短路（跨 net）不在本条内，属 DRC（D7）。
12. `sch` 展平后每个**实体**实例（没有 `logical_only`）都必须在 `place` 里出现。缺失时给出一条 `bind.instance-unplaced`（warning），报"已放 / 共几个"并点名缺的实例——一块板只报一条，不是每个实例一条。`dnp` 件**不豁免**：封装仍在 `place` 里占位，只是不装件（[ADR-0040](../docs/adr/0040-partial-layout-is-legal-and-reported.md) D6）。

几何层面的检查（"这两个 pad 之间确实有铜箔"、"实际间距不小于 `rules`"）属**校验**而非连通性真源（`AGENTS.md` §2 第 2 条）：**兑现检查**（规则 13）是我们自己的；**agent 反馈用的几何 DRC 子集**（间距、线宽、过孔、keepout、板边、未布线）也由 `packages/core` 自己实现，零外部依赖（[ADR-0053](../docs/adr/0053-layout-and-routing-are-agent-driven.md)），与铜皮填充共用 [ADR-0054](../docs/adr/0054-copper-fill-uses-a-constrained-geometry-kernel.md) 的几何内核；KiCad DRC 是**可选对照**，不是门禁。CAM 级 DFM 判定仍借专业工具（[ADR-0018](../docs/adr/0018-zero-dependency-and-manufacturing-target.md)）。

两份描述只存在一份时，绑定校验**跳过，并在报告里给出 `bind.not-checked`（note）**——跳过不等于通过：只有 `sch` 的板在放置与连通性上未校验，只有 `pcb` 的板在逻辑归属上未校验，`pcb` 文件也不会因为对应的 `sch` 不存在而消失（`AGENTS.md` §4.4 规则 6）。

严重度：规则 1–3、5 是 `error`（逻辑连通了是硬错）；规则 4（未布线）与规则 12（部分布局）是 `warning`——布线是渐进过程，检查器要在中途可用；部分布局是正常的工作状态，它需要的是**说得出来**，不是被禁止（[ADR-0040](../docs/adr/0040-partial-layout-is-legal-and-reported.md) D4）。

### 5.3 报告

所有偏差（`deviation` 段的每一条、`physical_only` 里 sch 无对应器件的实体、导出时目标格式装不下的语义）必须出现在校验报告里，格式同 `teda.md` §11：`file:line:col: <severity> <code>: <message>`，`--json` 输出同字段。

---

## 6. Canonical form

### 6.1 段顺序

`stackup` · `outline` · `place` · `connect` · `trace` · `via` · `zone` · `keepout` · `rules` · `silk` · `physical_only` · `deviation`

### 6.2 行排序与归一

| 段 | 排序 | 归一 |
|---|---|---|
| `stackup` | **保持源顺序**（叠层序有语义） | — |
| `outline` | 保持顶点环序 | 起点旋转到字典序最小的顶点；方向统一为有向面积为正 |
| `place` | 按 `instance_id` | — |
| `connect` | 按 `(padA, padB)` | 每对内按字节序排（`padA ≤ padB`） |
| `trace` | 按 `(net, layer, 起点)` | 折线方向归一：起点字典序大于终点时整条反转 |
| `via` | 按 `(net, x, y)` | — |
| `zone` | 按 `(net, layer, 归一后首点)` | 起点旋转到字典序最小的顶点；方向统一为有向面积为正 |
| `keepout` | 按 `(type, layer, 归一后首点)` | 同 `zone` |
| `rules` | 按类型固定序 `clearance` `width` `via` `net` `diff` `match` `mask` `paste` `thermal` `min_width`；同类型按主体名 | — |
| `silk` | 按 `item` 名（`refdes` 在 `value` 前） | — |
| `physical_only` | 按 `id` | — |
| `deviation` | 按 `(type, 主体)` | — |

### 6.3 数值与单位

- 坐标、尺寸、间距、线宽：mm，定点数，最多 4 位小数，去掉尾随零；由列类型提供单位，值里不写单位。
- 角度：度，最多 1 位小数。
- 阻抗：Ω。
- 列对齐：同段内按最宽单元格对齐，列间至少两个空格；段之间一个空行；文件末尾一个换行。
- `fmt(fmt(x)) == fmt(x)`，且 `parse(fmt(x))` 与 `parse(x)` 语义相同。

---

## 7. 不支持与已知限制

| 限制 | v0.4 行为 | 后续 |
|---|---|---|
| 圆弧走线 | 不支持；导入时按折线近似并报告偏差 | 待定 |
| 圆弧板框 | 不支持 | 待定 |
| 微孔（HDI） | 不支持 | 待定 |
| 铣槽与异形孔 | `physical_only` 只表达圆孔与矩形开孔 | 待补（`docs/adr/0005-manufacturing-output.md` decision 7） |
| 铜到板边间距 | 没有规则项可表达；铜皮贴齐板框导出 | DRC 关注项，`docs/adr/0054-…` 附录已列为已知限制 |
| 铜皮填充缓存 | 不做：每次导出重算（参考板 8 ms / 铜皮，`min_width` 打开约 370 ms） | 真的需要时再加可删除的派生缓存 |
| 阻焊/锡膏/热焊盘开窗 | 只声明参数（`rules`），尚未导出开窗层 | `docs/backlog.md` F15（铜层与钻孔已落地，见 §8.2） |
| 差分对的几何表达 | 不表达，靠 `rules` 约束 | 保持 |
| 阻抗计算的工艺栈 | 只存 `er` 与介质厚度，不做计算 | 交给 KiCad/仿真工具 |
| pcb-only 模式 | 不支持（v0.4 假定有 `sch`） | `AGENTS.md` §11 第 6 条 |
| 封装 pad 几何来源 | 引用 `assets/components/` 的 `footprint`；IR 内 pad 几何是引用还是内联待定 | 见 [ADR-0003](../docs/adr/0003-agent-first-pcb-ir.md)"后续" |
| 布局约束（区域、邻接、禁布） | v0.4 不表达 | 待定 |
| 3D 模型与装配图 | 不在 pcb 描述内（属封装库与 fab 层） | — |

---

## 8. 导出与制造

### 8.1 填充（导出的第一步）

填充策略在 `packages/core/src/fill/`，几何内核在 `packages/geom`：内核只认形状，策略认 net / 间距 / 层（[ADR-0054](../docs/adr/0054-copper-fill-uses-a-constrained-geometry-kernel.md) D3）。

顺序：① zone 轮廓 ∩ 板框，减去板内开孔与本层 `no_pour`；② 与本 zone 不同 net 的铜（以及 `net: null` 的铜——原理图没给 net 的铜不是任何一块铜皮的 net）按间距放大后减掉；③ 同 net 的 `none` 照样减掉，`thermal` 减掉间隙环再补回四条 0°/90°/180°/270° 的桥；④ `min_width` 做开运算（先腐蚀再膨胀，再与输入求交），减掉的面积报 `drc.zone-min-width`；⑤ 量面积，空铜皮报 `drc.zone-empty`。

- **对接间距取两侧较大者**：`net` 规则替换该 net 的板级默认，而间隙要同时满足两侧；焊盘自己的 `clearance_nm` 只能放大，不能缩小。
- **`zone_connect` 决定连接方式，不由 net 决定**：通孔焊盘默认 `thermal`，贴片焊盘默认 `solid`；同 net 的 `solid` 铜不动。
- **铜皮贴齐板框，不内缩**：`rules` 里没有"铜到板边间距"这一项，那属于 DRC 而不是填充规则；是否留边由板厂与 DRC 决定（已知限制，见 §7）。
- 填充是**每次导出重算**的派生物：不进 IR、不进工程哈希，也不写缓存文件。

### 8.2 Gerber 与钻孔文件

`texteda export gerbers <工程目录> <board_id> [--out <dir>] [--json]` 把一块板写进默认的 `dist/fab/<board_id>/`：

| 文件 | 内容 |
|---|---|
| `<board>-<layer>.gbr` | 每个铜层一份（`F.Cu` → `F_Cu`），外加 `Edge_Cuts`；空层照样出文件（只有头 + `M02*`） |
| `<board>.drl` | 一份 Excellon：电镀孔（过孔、通孔焊盘）与非电镀孔（安装孔）；没有孔就不出文件 |

- 坐标用 `%FSLAX46Y46*%` + `%MOMM*%`、省略前导零，也就是一个单位 = 1 nm，写出的整数**就是纳米数**：不缩放、不取整、负数带 `-`。
- 每份文件带 `G04 TextEDA <tool_version>*` 与 `G04 source <source_hash>*`（Excellon 用 `;` 注释），`source_hash` 是**工程哈希**——文件能追到它描述的那个构建（`AGENTS.md` §2 第 11 条）。
- 孔径去重、从 `D10` 升序编号、按整数算术写六位小数；语句按（区域 < 走线 < 闪光）再按几何规范文本排序，所以同一块板两次导出**逐字节相同**。
- 连线格式的完整冻结条款（`G36`/`G37` 不重复首点、`M02*` 后恰好一个换行、`;unplated:` 为 0 时省略）见 [ADR-0054](../docs/adr/0054-copper-fill-uses-a-constrained-geometry-kernel.md) 的 2026-10-26c 附录。
- 导出器（`packages/exporter`）只做序列化：不读 net、不裁剪、不调内核、不读时钟；几何由 `packages/core` 的 `boardImage()` 装配好再交给它。
- **尚未导出**：阻焊、锡膏、丝印层，以及制造包（`fab`，[ADR-0034](../docs/adr/0034-manufacturing-output-target-form.md)）。

## 9. 完整示例

对应的 `design/sch/demo.teda` 片段（net 成员只在 sch 里声明，pcb 只引用 `net_id`）：

```
instances
  U1  tps7a02
  C1  cap-mlcc-0603
  R1  res-thick-0402

nets
  VIN:  U1.1
  GND:  U1.4  C1.1  R1.2
```

对应的 `design/pcb/demo.teda`：

```
version 0.4
pcb demo

board_thickness 1.6mm

stackup
  F.Cu    copper     0.035mm  signal
  prepreg dielectric 0.210mm  FR4 4.3
  B.Cu    copper     0.035mm  signal

outline
  0.0 0.0
  40.0 0.0
  40.0 30.0
  0.0 30.0

place
  U1  12.0 12.0  0   top
  C1  18.0 12.0  90  top
  R1  24.0 8.0   0   top

connect
  U1.4  C1.1
  U1.4  R1.2

trace
  GND  F.Cu  0.25mm  12.0 6.0  12.0 16.0
  GND  B.Cu  0.25mm  12.0 16.0  18.0 16.0

via
  GND  12.0 16.0  0.6mm  0.3mm

zone
  GND  B.Cu  0.0 0.0  40.0 0.0  40.0 30.0  0.0 30.0

rules
  clearance  0.2mm
  width      0.25mm
  via        0.6mm  0.3mm
  net        GND  0.3mm  0.5mm  0.8mm  0.4mm

silk
  refdes  F.SilkS  1.0mm  show
  value   F.SilkS  0.8mm  hide

physical_only
  H1   mounting   3.2mm  2.5mm
  F1   fiducial   1.0mm  F.Cu
```

读法：`VIN` 只有 `U1.1` 一个成员，pcb 里没有对应走线——按 §5.2 第 4 条报“该 net 未布线”。
