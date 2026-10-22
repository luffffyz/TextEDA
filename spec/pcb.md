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
4. **不自研制造出口**：制造链走 KiCad（`kicad-cli pcb export gerbers` / `export drill` / `pcb drc`）；Gerber / Excellon 写出器借现成工具链，自研的只是 IR 侧的意图参数与到 KiCad 的映射。路径见 `docs/adr/0005-manufacturing-output.md`；打样文件（BOM / 坐标）规范见 `docs/adr/0006-jlc-prototype-delivery.md`。

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
- **填充结果不入 IR**：由轮廓 + 规则重算（`docs/adr/0003-agent-first-pcb-ir.md` decision 3）。

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

不影响逻辑的物理实体。列：`<id> <type> [args…]`，参数由类型决定。

```
physical_only
  H1   mounting   3.2mm  2.5mm
  F1   fiducial   1.0mm  F.Cu
  TP1  test_point VBUS   1.0mm
  S1   stitching  GND    0.6mm  0.3mm
  X1   cutout     34.0 22.0  4.0  2.0
```

| 类型 | 参数 | 说明 |
|---|---|---|
| `mounting` | `<size> <drill>` | 安装孔 |
| `fiducial` | `<size> <layer>` | 基准点；**不得挂 net**（挂了是错误） |
| `test_point` | `<net> <size>` | 测试点：单层焊盘，供探针测量；sch 中无对应器件 → 进偏差报告 |
| `stitching` | `<net> <size> <drill>` | 缝合孔：跨层连接**同一个 net 的多个层**；过孔不是焊盘，不算 net 的新成员 |
| `cutout` | `<x> <y> <w> <h>` | 板内矩形开孔/槽 |

`test_point` 与 `stitching` 的分界是**单层 vs 跨层**；连接两个不同 net 的过孔是 `deviation` 的 `net_tie`，不是 `stitching`。`test_point` / `stitching` 的 net 必须在 `sch` 里存在，否则报错。

**退役（2026-10-22b）**：`test_point` 这一形态退役。测试点是 net 上的一个**焊盘**，按 [ADR-0035](../docs/adr/0035-connectivity-authority-and-reverse-engineering.md) D8/D9 它是 `sch` 里的**单引脚器件**（不采购的是 family，采购的是 part）：有位号、有封装（形状任意）、走普通 net 成员规则，不再是 `physical_only` 实体。白名单随之从五类减为四类（`net_tie` / `split_ground` / `stitching` / `fiducial`）。该形态随下一个契约版本移除（`docs/backlog.md` F38）。

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

1. `place` 的每个实例 ID 必须在 `sch` 展平结果里存在；sch 展平后未被放置的实例按变体状态处理。
2. `connect` 的每个 pad 引用必须解析到已放置实例的 pad；pad 号必须存在于该器件的封装。
3. `connect` 的一对 pad 必须落在 `sch` 展平后的同一个 net 内；否则必须由 `deviation` 的 `net_tie` / `split_ground` 显式覆盖，否则报错。
4. `sch` 展平后每个 net 的每个成员 pad（限已放置实例）至少出现在一个 `connect` 对里；否则报"该 net 未布线"。未放置实例的 pad 不参与本检查（规则 1）。
5. `connect` 引用的 net 不得超出 `sch` 的 net 集合（pcb 不得创建新逻辑连接）。
6. `trace` / `via` / `zone` 的 `net` 必须存在于 `sch`；`layer` 必须在 `stackup` 里。
7. `rules` 里的 net 必须存在于 `sch`。
8. `physical_only` 的 `test_point` / `stitching` 必须引用 `sch` 里存在的 net；`fiducial` 不得挂 net。`test_point` 是单层焊盘，`stitching` 是跨层过孔；连接两个不同 net 的过孔按 `deviation` 的 `net_tie` 处理。
8a. **pcb 不得新增逻辑连接**：任何两 pad 之间的短接若不在同一个 sch net 内，必须由 `deviation` 的 `net_tie` / `split_ground` 显式覆盖，否则报 error。白名单之外的任何差异都是 error，不是 warning。
9. `board_thickness` 与 `stackup` 厚度之和一致（容差 0.05mm，规则本身不精确）。
10. `outline` 顶点不重复、不自交；`zone` / `keepout` 多边形同样不自交。
11. `silk` 段的 `layer` 必须是 `F.SilkS` / `B.SilkS`；字高小于 0.5mm 给出警告（多数板厂难以辨识）。

几何层面的检查（"这两个 pad 之间确实有铜箔"、"实际间距不小于 `rules`"）由几何检查器或 KiCad DRC 执行，属**校验**而非连通性真源（`AGENTS.md` §2 第 2 条）。

严重度：规则 1–3、5 是 `error`（逻辑连通了是硬错）；规则 4（未布线）是 `warning`——布线是渐进过程，检查器要在中途可用。

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
| 阻焊/锡膏/热焊盘开窗 | 只声明参数（`rules`），实际开窗由 KiCad 计算 | `docs/adr/0005-manufacturing-output.md` decision 5 |
| 差分对的几何表达 | 不表达，靠 `rules` 约束 | 保持 |
| 阻抗计算的工艺栈 | 只存 `er` 与介质厚度，不做计算 | 交给 KiCad/仿真工具 |
| pcb-only 模式 | 不支持（v0.4 假定有 `sch`） | `AGENTS.md` §11 第 6 条 |
| 封装 pad 几何来源 | 引用 `assets/components/` 的 `footprint`；IR 内 pad 几何是引用还是内联待定 | 见 [ADR-0003](../docs/adr/0003-agent-first-pcb-ir.md)"后续" |
| 布局约束（区域、邻接、禁布） | v0.4 不表达 | 待定 |
| 3D 模型与装配图 | 不在 pcb 描述内（属封装库与 fab 层） | — |

---

## 8. 完整示例

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
