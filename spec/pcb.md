# `pcb` 描述规范（草案）

状态：草案。决策与取舍见 `docs/adr/05-pcb/0016-agent-first-pcb-description.md`；工程根与 PCB 归属见 [ADR-0069](../docs/adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md)；跨描述通用的词法、单位、版本、canonical 规则见 `teda.md` §3–§6、§9、§11。

本文件是 `teda.md` 的分描述补充：`.teda` 语言的共用规则在 `teda.md`，`pcb` 这一类描述的具体段定义在这里。

---

## 0. 定位

`pcb` 描述表达 **一块物理 PCB 的实现事实**。它**实现**工程的逻辑根（`design/sch/main.teda`），不是第二份连通性真源：逻辑成员与跨板路径归根（`teda.md` §7.2、§7.5），一块板内部的连续铜箔归本文件的 `connect`。

三条底线（`AGENTS.md` §2）：

1. **板内连通性只由逻辑模型 + `connect` 决定**。pcb 不得隐式增删逻辑连接；偏差必须显式声明并进报告（§5.3）。**net 名相等从不 imply 跨板连通**：两块 PCB 上同名 net、与根上同名 net，互不相干——连接只来自根的成员行（逻辑）、根的 `interconnects` 行（跨板物理路径）、本板的 `connect`（板内铜）。
2. **逻辑专属 / 物理专属必须显式标记**。物理实体进 `physical_only`，逻辑偏差进 `deviation`。
3. **派生层的东西不进 IR**：绘图参数、丝印排版、铜皮填充结果、量测文本、UUID 与内部序号一律不存（`docs/adr/05-pcb/0016-agent-first-pcb-description.md` decision 3）。
4. **制造出口自研，判定借专业工具**：RS-274X / Excellon 写出器与铜皮填充用的受限 2D 几何内核由本仓实现（[ADR-0021](../docs/adr/06-manufacturing/0021-the-manufacturing-output-path.md)、[ADR-0018](../docs/adr/05-pcb/0018-copper-fill-uses-a-geometry-kernel.md)）；KiCad 的 Gerber 导出与 DRC 是**可选对照**，不是门禁；CAM 级 DFM 判定仍借专业工具。打样文件（BOM / 坐标）规范见 `../docs/adr/06-manufacturing/0022-jlc-prototype-delivery.md`。

**归属是显式的（0.14，[ADR-0069](../docs/adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md)）**：每个模块实例整只属于**恰好一块** PCB，由该 PCB 文件的必需 `modules` 段声明（§4.1）。工具**不推断**"一个模块一块板"、**不按同名对应**。一块 PCB 可以拥有多个模块实例；一个可复用模块定义可以在不同 PCB 上各自实例化；**一个实例**绝不跨板拆分——跨板的功能是两个模块实例 + 一条显式 `interconnects` 行（`teda.md` §7.5）。

**假定存在逻辑根**：根文件 `design/sch/main.teda` 必须存在且完整；`pcb-only` 模式不存在（逆向工程、外部网表导入走导入器，见 `AGENTS.md` §11 第 6 条与 [ADR-0014](../docs/adr/04-schematic/0014-connectivity-has-one-authority.md) D5/D6）。

---

## 1. 文件头

```
version 0.14.0
pcb pwr-l1
```

- 版本行、类型行规则同 `teda.md` §5：版本行写的是**语言版本**，全语言一个号，每种描述类型都写同一个（现行号见 `teda.md` §12.1）。`pcb` 的 reader 下界是 `0.14`：0.11 的坐标元组改写与 0.14 的必需 `modules` 段共同构成当前 reader 接受的最早表面。接受规则见 `teda.md` §12.3。
- **段头独占一行**（整行只有一个单元格）。缩进不表达层级（`AGENTS.md` §2 第 6 条），所以 `via` 这类既是段名又是 `rules` 行首列的词，只能靠列数消歧：规则行至少有 2 列。
- **同一段可以重复出现**，行按出现顺序拼接（与 `nets` 同名行合并同一先例）。`stackup` 的顺序即叠层顺序，重复段就接在后面，不做排序。
- 文件名必须等于类型行里的 id：`design/pcb/<pcb_id>.teda` ↔ `pcb <pcb_id>`。`pcb_id` 形状同文件 id（`teda.md` §4.2），**在工程内唯一**（两份 `pcb` 文件同 id 报错）。
- 一份 `pcb` 文件描述**一块物理 PCB**。工程里有几块物理板，就有几份 `pcb` 文件（单板工程恰好一份；多板工程每板一份）。`project.toml` 的 `[boards.<id>]` 可以给每块板记 `revision` / `title` 元数据，但**归属不写在那里**——归属写在本文件的 `modules` 段（§4.1）。

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
| `modules` | **本板拥有的模块实例**（`teda.md` §7.1 的 `modules` 段实例 id 的子集） | **是**（0.14 起） |
| `stackup` | 叠层（层序、类型、厚度、材料） | 是 |
| `outline` | 板框折线 | 是 |
| `place` | 实例放置（坐标、旋转、面） | 是 |
| `connect` | 显式连接：哪两个 pad 之间有**板内**连续铜箔 | 是 |
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

### 4.1 `modules`（必需）

```
modules
  M1
  M2
```

列：`<module_instance_id>`。

- 每行列出**本板拥有的一个模块实例**；实例 id 必须在根（`design/sch/main.teda`）的 `modules` 段声明（`ref.unknown-module-instance`，error）。
- **整只归属**：一个实例被恰好一块 PCB 声明。零块声明（孤儿实例）与两块声明（跨板拆分实例）都是 error——由 core 汇总全部 `pcb` 文件后检查（§5.2 规则 1），parser 只查引用可解析。
- 一个 PCB 可以声明任意多个实例；两个 PCB 声明**同一个模块定义**的不同实例完全合法（`M1` 上 `pwr-l1`、`M5` 上 `pwr-l2`，都实例化 `buck-5v`）。
- 根上没有模块实例被任何 PCB 声明时，core 报出每个孤儿实例；PCB 声明了根上不存在的实例同样报错。归属不按 id 名、不按模块定义名推断。
- 本段**不声明**跨板路径：跨板连接只有根的 `interconnects`（`teda.md` §7.5）。两块板各自声明 `M1` / `M2` 并不使它们的任何 net 连通。

### 4.2 `stackup`

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

### 4.3 `outline`

每行一个顶点，构成板框闭合折线（首尾自动闭合）。

```
outline
  [0.0,0.0]
  [40.0,0.0]
  [40.0,30.0]
  [0.0,30.0]
```

- 每行一个 `[x,y]` 顶点；至少 3 个顶点；不得自交。
- 只支持折线，**不支持圆弧**（限制，见 §7）。
- 板内开孔与安装孔进 `physical_only`（`cutout` / `mounting`）。

### 4.4 `place`

```
place
  M1.U1  [12.0,12.0]  0   top
  M1.R1  [18.0,12.0]  90  bottom
```

列：`<instance_id> <origin> <rot> <side>`，`<origin>` 是 `[x,y]`。

- `instance_id` 是**展平后的稳定实例 ID**（模块实例 `M1` 的器件 `U1` 写 `M1.U1`，`teda.md` §7.7、`spec/module.md` §5），不是 refdes：refdes 可改名，ID 不变（`AGENTS.md` §2 第 5 条、§4.4）。
- **只接受本板拥有的模块实例的实例**（`M1.U1` 且 `M1` 在 §4.1 声明）：放置别家板上的实例是错误（`bind.instance-not-owned`，error）——一块板的封装物理上不可能装在两块板上。
- 必须解析到逻辑根展平结果里的实例；未放置的实例按变体状态处理（DNP 不占位）。
- `side` ∈ `top` / `bottom`；`rot` 单位为度，顺时针为正。
- 坐标单位 mm，原点为板框包围盒的左下角。

### 4.5 `connect`

**显式声明**哪些 pad 之间有连续铜箔。连通性的真源是这一段与逻辑根，不是几何（`AGENTS.md` §2 第 2 条）。

```
connect
  M1.U1.4  M1.C1.1
  M1.U1.4  M1.R1.2
```

- pad 引用 = `<instance_id>.<pad_number>`；从**最后一个** `.` 分割出 pad 号（实例 ID 可含 `.`）。
- pad 号来自封装（`assets/components/` 的 `footprint`），必须与引脚编号对应（`AGENTS.md` §4.4 第 2 条）。
- 一对 pad 构成一条"有铜箔连通"的边；一个 net 的 N 个成员至少需要 N-1 条边（可成环，不禁止）。
- **范围是板内**：两端 pad 必须都属于**本板拥有的**模块实例（§4.1）。跨板的电气路径不写在这里——那是根的 `interconnects`；试图用 `connect` 连接两块板上的 pad 报错。
- 校验见 §5.2。

### 4.6 `trace`

```
trace
  GND  F.Cu  0.5mm  [8.0,6.0]  [12.0,6.0]
```

列：`<net> <layer> <width> [<point> …]`，每个 `<point>` 是 `[x,y]` 单元格。

- 至少 2 个点；点之间是直线段（直线、45° 斜线都能表达）。
- `net` 必须存在于逻辑根展平后的 net 表（通常是本板实例参与的那条 net）；`layer` 必须是 `stackup` 里的铜层。
- 走线是**板内几何**：它兑现的也只能是本板 pad 之间的 `connect` 对（§5.2 规则 13）。跨板路径没有走线形态——电缆/排针的对照在根的 `interconnect_pins`（`teda.md` §7.6）。
- **只支持折线**，不支持圆弧段（§7）。
- 差分对不是几何对象：两条线各自一条 `trace` 行，差分/等长/阻抗约束在 `rules`（`docs/adr/05-pcb/0016-agent-first-pcb-description.md` decision 5）。

### 4.7 `via`

```
via
  GND   [12.0,6.0]   0.6mm 0.3mm
  GND   [20.0,14.0]  0.6mm 0.3mm  F.Cu  B.Cu
```

列：`<net> <point> <size> <drill> [<from_layer> <to_layer>]`，`<point>` 是 `[x,y]`。

- 省略最后两列 = 通孔（贯穿全部铜层）；给出时为盲孔/埋孔，连接 from→to 之间的层。
- 微孔（HDI）不支持（§7）。

### 4.8 `zone`

```
zone
  GND  B.Cu  [0.0,0.0]  [40.0,0.0]  [40.0,30.0]  [0.0,30.0]
```

列：`<net> <layer> [<point> …]`，每个 `<point>` 是 `[x,y]`。

- 顶点构成闭合多边形；至少 3 个点。
- 只存**意图**（轮廓 + 所属 net + 层）。填充参数（clearance、thermal、min_thickness）走 `rules` 与全局默认。
- **填充结果不入 IR**：由 `zone` 轮廓 + `rules` 在导出时用受限 2D 几何内核重算（[ADR-0018](../docs/adr/05-pcb/0018-copper-fill-uses-a-geometry-kernel.md)），结果不进工程哈希；缓存只能是可删除、可重算的派生物（[ADR-0016](../docs/adr/05-pcb/0016-agent-first-pcb-description.md) decision 3）。
- **同一层上不同 net 的两块 zone 不得重叠**：重叠就是短路的铜，IR 没有优先级字段，所以填充直接拒绝并报 `drc.zone-overlap`（error），两块都不出铜。同 net 的重复 zone、或同轮廓放在另一层，都不算重叠。
- 填充的判定顺序与已知限制见 §8.1；填充结果与文件字节的关系见 §8.2。

### 4.9 `keepout`

```
keepout
  no_place  F.Cu  [30.0,20.0]  [38.0,20.0]  [38.0,26.0]  [30.0,26.0]
```

列：`<type> <layer> [<point> …]`，每个 `<point>` 是 `[x,y]`。

- `type` ∈ `no_track` / `no_pour` / `no_place` / `no_via`。
- 顶点构成闭合多边形。

### 4.10 `rules`

首列是规则类型（与 `teda.md` §7.3 `constraints` 同风格：列数与语义由类型决定）。

```
rules
  clearance  0.2mm
  width      0.25mm
  via        0.6mm  0.3mm
  net        GND  0.3mm  0.5mm  0.8mm  0.4mm
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
| `mask` | `<expansion>` | 阻焊开窗相对焊盘的扩张量（板级 ≥ 0；要收窗写焊盘自己的 `mask=`，它可负） |
| `paste` | `<ratio> <offset>` | 锡膏开口的**面积**比例（0–1）与比例之后的逐边偏移（可负） |
| `thermal` | `<gap> <bridge>` | 铜皮与焊盘之间的热焊盘间距与桥宽 |
| `min_width` | `<value>` | 铜皮填充与走线的最小线宽 |

- **缺省就是恒等**：没有 `mask` 行时扩张量是 0（开窗**就是**焊盘本身），没有 `paste` 行时比例 1、偏移 0（钢网开口**就是**焊盘本身）。两者都是一个描述在什么都没说时唯一能表达的东西——不是对板厂偏好的猜测。
- **`mask` 的扩张是逐边的**：开窗 = 焊盘外轮廓按 `<expansion>` 向外（或向内）平移，收缩到没有面积就不出图元。板级规则只表达“往外留多少”（契约要求 ≥ 0：一块板上该留的量是同一个，而该收的量逐焊盘不同），要收窗写在焊盘自己的 `mask=` 上，那里可负——收窗是压掉焊盘间的桥接风险。
- **`paste` 的 `<ratio>` 是面积比**：开口面积 = 焊盘面积 × ratio，所以线性缩放系数是 `sqrt(ratio)`，绕焊盘中心缩放（保持旋转与圆角）。`<offset>` 是**比例之后**的逐边偏移，正数长大、负数缩小——一个有符号标量表达不了平移，这与 KiCad 的 paste margin 口径一致。
- **焊盘自己的值优先**：封装里的 `mask=` / `paste=` 覆盖板级规则（`paste=` 只覆盖偏移，比例仍归板级），因为它描述的是这颗焊盘的物理处境。
- 阻焊与锡膏**不进 `FillRules`**：铜皮填充只读 `clearance` / `thermal` / `min_width`（`packages/core/src/fill/rules.ts`），开窗层不走填充。
- 规则**必须进 IR**：KiCad 把 netclass 与自定义 DRC 规则放在工程文件里，只拿 `.kicad_pcb` 的 agent 无法自查（`docs/adr/05-pcb/0016-agent-first-pcb-description.md` decision 4）。
- 规则可以由 agent 提议，但必须经 **interactive mode 由用户拍板**后写入 `rules`；只存在于 prompt / skill 里的数值不是规则，检查器不读它（[ADR-0017](../docs/adr/05-pcb/0017-layout-and-routing-are-agent-driven.md) D6）。
- 导出到 KiCad 时映射为 netclass 与自定义规则（细则待定，见该 ADR 的"后续"）。

### 4.11 `silk`

丝印是制造物（Gerber 的 `F.SilkS` / `B.SilkS`），所以"出不出、多大、哪层"必须声明；**排版位置不进 IR**（`docs/adr/05-pcb/0016-agent-first-pcb-description.md` decision 3），由确定性 policy 生成。

```
silk
  refdes  F.SilkS  1.0mm  show
  value   F.SilkS  0.8mm  hide
```

列：`<item> <layer> <size> <mode>`。

- `item` ∈ `refdes` / `value`；`layer` ∈ `F.SilkS` / `B.SilkS`；`size` 是字高；`mode` ∈ `show` / `hide`。
- 缺省（无 `silk` 段）：refdes 在 `F.SilkS`、字高 1.0mm、显示；value 隐藏。
- 位置来自封装库（借 KiCad / 嘉立创）；本段不描述位置。

**谁决定什么**（职责切分是硬的，两侧都不重复对方）：

| 事实 | 由谁给 | 说明 |
|---|---|---|
| 文字放在哪 | 封装的 `field`（`at`） | 只有库知道自己的 `Reference` 该摆在哪个空位 |
| 出不出、哪层、多大 | 本段 | 版面的决定，与这块板这次评审要看什么有关 |
| 文字内容（refdes） | 实例 id | 工程的事实（模块实例的器件是 `M1.R1`，`spec/module.md` §5） |
| 文字内容（value） | 模块的实例行 | 通用器件的文件不能带值，件的值就是它的 MPN（[ADR-0024](../docs/adr/07-devices/0024-the-device-kind-is-part-or-generic.md)）；由导出器把同一串文本交给丝印（与打印页同源） |

- **封装 `field` 自己的 `layer` 不决定输出层**：库里 `Reference` 常在丝印层、`Value` 常在 `F.Fab`，而本段才是版面决定的所在。`field` 的 `layer` 只说明"这颗字段在库里属于哪一层"，本段说 `F.SilkS` 就印在 `F.SilkS`。
- **`hide` 仍然生效**：封装把字段标了 `hide` 就不印——那是库对"这颗器件的这个字段不该出现"的断言，版面不能凭空复活它。
- **底板件的丝印整层镜像**：`F.SilkS` → `B.SilkS`，图形与文字一起镜像，这样从板子背面看文字是正的（`spec/footprint.md` §4）。
- **文字永不倒着印**：文字的基准方向 = 放置旋转 + 字段自身旋转；当它指向左侧（角度落在 90°–270°）时整体再转 180° 绕锚点（锚点居中，转完仍在原处）。这条在两侧一样——背面是镜像而不是又倒一次。
- **字重与字符集**：笔画宽度 = 字高 × 10%（内置笔画字体，与原理图渲染同源，`packages/core/src/font/`）。字体只覆盖可打印 ASCII，画不出的字符在进入本层**之前**就被丢掉（`10kΩ` 印成 `10k`）。

### 4.12 `physical_only`

不影响逻辑的物理实体。列：`<id> <type> <point> [args…]`，参数由类型决定。

```
physical_only
  H1  mounting   [5,5]    6     3.2
  F1  fiducial   [45,31]  1.0   F.Cu
  S1  stitching  [10,30]  GND   0.6  0.3
  X1  cutout     [34,22]  4.0   2.0
```

单位默认 mm，与其余几何段一致（canonical form 不写 `mm` 后缀，`spec/pcb.md` §6）。

`<point>` 是实体的**参考点**，是 `[x,y]`，单位默认 mm，坐标帧同其他几何段。除了 `cutout`（参考点是矩形的一角），参考点都是几何中心——孔、点、过孔都是圆形，圆心就是它们唯一说得清的位置。

| 类型 | 参数 | 说明 |
|---|---|---|
| `mounting` | `<point> <size> <drill>` | 安装孔，圆环外径与孔径 |
| `fiducial` | `<point> <size> <layer>` | 基准点；**不得挂 net**（挂了是错误） |
| `stitching` | `<point> <net> <size> <drill>` | 缝合孔：跨层连接**同一个 net 的多个层**；过孔不是焊盘，不算 net 的新成员 |
| `cutout` | `<point> <w> <h>` | 板内矩形开孔/槽，`<point>` 是左下角 |

`cutout` 的参考点与其余三类不同（角 vs 圆心），因为矩形用它自己的形状说话；圆形的"左下角"没有意义，所以统一取圆心。**位置是坐标，不是几何**：实体只有简单图元（圆孔、圆点、矩形开槽），要自定义形状就写成器件（`AGENTS.md` §4.4 第 7 条）。

**测试点不是本段的形态（2026-10-22b 退役；那次删除记在 `teda.md` §12.4 合并之前的版本线里）**：测试点是某个 net 上的一个**焊盘**，按 [ADR-0014](../docs/adr/04-schematic/0014-connectivity-has-one-authority.md) D8/D9 它是模块里的**单引脚器件**（不采购的是 generic，采购的是 part）：有位号、有封装（形状任意）、走普通 net 成员规则。分界线是"它是不是某个 net 上的焊盘"：是 → 器件；不是 → 本段的实体（过孔、安装孔、基准点、挖槽）。白名单因此是四类（`net_tie` / `split_ground` / `stitching` / `fiducial`），`stitching` 与 `fiducial` 是物理实体放本段，前两类改逻辑连通性放 `deviation`。

### 4.13 `deviation`

受控的**逻辑**偏差。`net_tie` 与 `split_ground` 会改变逻辑连通性，必须显式声明并进报告（`AGENTS.md` §4.4 第 4 条）。`stitching` / `fiducial` 两类是物理实体，放在 `physical_only`；它们同样进报告，但不改逻辑。

```
deviation
  net_tie       M1.VBUS  M1.VBUS_RAW
  split_ground  M1.GND
```

| 类型 | 列 | 说明 |
|---|---|---|
| `net_tie` | `<netA> <netB>` | 两个展平 net 在**本板**物理上短接（合并两个 net） |
| `split_ground` | `<net>` | 一个展平 net 在**本板**物理上分成互不连通的区域（拆分一个 net） |

- 主语是**展平后的 net**（`M1.VBUS`、或合并后的根 net 名）；偏差**只作用于本板**：`net_tie` 把两块板上的同名 net 短接是不存在的形态——跨板只有 `interconnects`，而 `interconnects` 端点是端口不是偏差。
- `net_tie` 与 `split_ground` 的分界是**合并 vs 拆分**。两者都是逻辑偏差：短接若没有声明就是错误；声明了也不等于"对"——检查器只负责报出来，对不对由人判（[ADR-0014](../docs/adr/04-schematic/0014-connectivity-has-one-authority.md) D2）。
- **声明了也要进报告，严重度按危险程度分**（[ADR-0014](../docs/adr/04-schematic/0014-connectivity-has-one-authority.md) D10）：`net_tie` 是 **note**（常见且有意的声明——0Ω 跳线、焊接跳线——但它改变两个 net 的连通性，读者要看见）；`split_ground` 是 **warning**（一个 net——通常是地——被物理拆成互不接触的区域，回流路径在缺口处断开；它可以是合法的（隔离、分开的模拟地），但绝不是默认值，每一处都值得看一眼）。
- **偏差白名单是封闭的**：只有 `net_tie` / `split_ground` / `stitching` / `fiducial` 四类（`test_point` 已于 2026-10-22b 退役，见 §4.12），加新类要另起 ADR。白名单是给**物理特性**与**拆分/短接机制**用的，不是给"根没写"兜底的。

---

## 5. 与逻辑根的绑定与校验

### 5.1 身份映射

| 实体 | 键 |
|---|---|
| 器件 | `component_id`（`AGENTS.md` §4.4） |
| 模块实例 | `module_instance_id`（`M1`；归属由本板 `modules` 段声明，§4.1） |
| 实例 | 展平实例 ID（`M1.R1`） |
| 引脚 / pad | `(instance_id, pin_number)`；pad 号来自封装 |
| net | `net_id`（= 展平 net 名） |

pcb 里写的 net 名就是**展平后**的 net 名（模块内部 net 用 `<module_instance_id>.<net>`，被根合并的 net 用根名），与逻辑根同一命名空间，见 `teda.md` §7.7、`spec/module.md` §5。IR 里的身份键是 `net_id`，不是名字；名字只是表面语法的引用形式。

### 5.2 校验规则

1. **归属（core，汇总全部 `pcb` 文件后执行）**：根上每个模块实例被**恰好一块** PCB 的 `modules` 段声明；零块报 `bind.instance-unowned`（error，每实例一条），两块及以上报 `bind.instance-split`（error）。PCB 声明根上不存在的实例报 `ref.unknown-module-instance`（error）。工具不按名字、不按定义归属推断。
2. `place` 的每个实例 ID 必须解析到逻辑根展平结果里的实例，且其模块实例被**本板**声明（§4.4）；否则报 `bind.instance-not-owned` / `bind.instance-unplaced`。展平后未被放置的实例由规则 12 报出（变体决定 DNP 件装不装，不决定它的封装放不放）。
3. `connect` 的每个 pad 引用必须解析到已放置实例的 pad，且该 pad 属于**本板拥有**的实例；pad 号必须存在于该器件的封装。
4. `connect` 的一对 pad 必须落在逻辑根展平后的同一个 net 内；否则必须由 `deviation` 的 `net_tie` / `split_ground` 显式覆盖，否则报错。
5. 根展平后每个 net 的每个成员 pad（限**本板**已放置实例）至少出现在一个 `connect` 对里；否则报"该 net 未布线"。不属于本板的实例的 pad 不参与本检查（它们在别的板上布线）。**跨板路径不参与**：一条根 net 的成员分布在本板与其他板上时，本板只对**本板**成员兑现铜——板间的衔接由根的 `interconnects` 负责，缺它报在根（`teda.md` §10 规则 9），不报在本板。
6. `connect` 引用的 net 不得超出根的 net 集合（pcb 不得创建新逻辑连接）。
7. `trace` / `via` / `zone` 的 `net` 必须存在于根展平后的 net 表；`layer` 必须在 `stackup` 里。
8. `rules` 里的 net 必须存在于根展平后的 net 表。
9. `physical_only` 的 `stitching` 必须引用根里存在的 net；`fiducial` 不得挂 net。`stitching` 是跨层过孔（同一 net 的多个层），连接两个不同 net 的过孔按 `deviation` 的 `net_tie` 处理。
9a. **pcb 不得新增逻辑连接**：任何两 pad 之间的短接若不在同一个展平 net 内，必须由 `deviation` 的 `net_tie` / `split_ground` 显式覆盖，否则报 error。白名单之外的任何差异都是 error，不是 warning。**板间衔接也不是偏差**：两板之间的电气连续性来自根的 `interconnects` 行，不是 `deviation`；`interconnect` 端点两侧的模块实例分属不同 PCB 由 core 校验（`teda.md` §10 规则 9）。
10. `board_thickness` 与 `stackup` 厚度之和一致（容差 0.05mm，规则本身不精确）。
11. `outline` 顶点不重复、不自交；`zone` / `keepout` 多边形同样不自交。
12. `silk` 段的 `layer` 必须是 `F.SilkS` / `B.SilkS`；字高小于 0.5mm 给出警告（多数板厂难以辨识）。
13. 每个 `connect` 对必须被**铜箔兑现**：该 net 的 `trace` 线段、`via` 桶、`zone` 多边形要能连成一条同时触及两端 pad 的链（链只在 via 处换层）。不成立报 `bind.connect-unbacked`（warning）——布局是渐进过程，检查器要在中途可用（[ADR-0020](../docs/adr/05-pcb/0020-connect-pairs-need-copper.md) D1/D5）。几何口径：pad 取**外接圆**、走线按线宽半宽加粗、容差 1 nm（D3），所以"查不出"只会漏报、不会误报；相邻两 pad 之间的短路（跨 net）不在本条内，属 DRC（D7）。
14. 根展平后每个**实体**实例（没有 `logical_only`）都必须出现在**拥有它的那块 PCB** 的 `place` 里。缺失时给出一条 `bind.instance-unplaced`（warning），报"已放 / 共几个"并点名缺的实例——一块板只报一条，不是每个实例一条。`dnp` 件**不豁免**：封装仍在 `place` 里占位，只是不装件（[ADR-0019](../docs/adr/05-pcb/0019-a-partial-layout-is-legal.md) D6）。

几何层面的检查（"这两个 pad 之间确实有铜箔"、"实际间距不小于 `rules`"）属**校验**而非连通性真源（`AGENTS.md` §2 第 2 条）：**兑现检查**（规则 13）是我们自己的，**未布线**（规则 5）也是我们自己的。**agent 反馈用的几何 DRC 子集**（间距、线宽、过孔、keepout、板边）**尚未实现**——它归我们（[ADR-0017](../docs/adr/05-pcb/0017-layout-and-routing-are-agent-driven.md) D5，`docs/backlog.md` F48），落地时与铜皮填充共用 [ADR-0018](../docs/adr/05-pcb/0018-copper-fill-uses-a-geometry-kernel.md) 的几何内核；在此之前 KiCad DRC 是**可选对照**，不是门禁。CAM 级 DFM 判定仍借专业工具（[ADR-0021](../docs/adr/06-manufacturing/0021-the-manufacturing-output-path.md)）。

两份描述只存在一份时，两个方向**不是一回事**：

- **有根、无 `pcb`**：合法状态。绑定校验**跳过**，报告里给出 `bind.not-checked`（note）——跳过不等于通过：这个工程在放置与连通性上未校验。
- **有 `pcb`、无根**：**错误**，报 `bind.no-root`（error）。板在 `modules` 段声明的模块实例没有归属，逻辑连通性没有权威；需要连通性的命令（`compile` / `bom` / `netlist` / `export gerbers` / `view`）一律拒绝这样的工程（`AGENTS.md` §4.4 规则 6，[ADR-0014](../docs/adr/04-schematic/0014-connectivity-has-one-authority.md) D5）。

严重度：规则 1、3–5、9a 是 `error`（逻辑连通了是硬错，归属是硬事实）；规则 13（未兑现）与规则 14（部分布局）是 `warning`——布线是渐进过程，检查器要在中途可用；部分布局是正常的工作状态，它需要的是**说得出来**，不是被禁止（[ADR-0019](../docs/adr/05-pcb/0019-a-partial-layout-is-legal.md) D4）。

### 5.3 报告

所有偏差（`deviation` 段的每一条、`physical_only` 里根无对应器件的实体、导出时目标格式装不下的语义）必须出现在校验报告里，格式同 `teda.md` §10：`file:line:col: <severity> <code>: <message>`，`--json` 输出同字段。

---

## 6. Canonical form

### 6.1 段顺序

`modules` · `stackup` · `outline` · `place` · `connect` · `trace` · `via` · `zone` · `keepout` · `rules` · `silk` · `physical_only` · `deviation`

### 6.2 行排序与归一

| 段 | 排序 | 归一 |
|---|---|---|
| `modules` | 按 `module_instance_id` 自然序（数字按数值） | — |
| `stackup` | **保持源顺序**（叠层序有语义） | — |
| `outline` | 保持顶点环序 | 起点旋转到字典序最小的顶点；方向统一为有向面积为正 |
| `place` | 按 `instance_id` | — |
| `connect` | 按 `(padA, padB)` | 每对内按字节序排（`padA ≤ padB`） |
| `trace` | 按 `(net, layer, 起点)` | 折线方向归一：起点字典序大于终点时整条反转 |
| `via` | 按 `(net, 归一后点)` | — |
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
- 坐标元组写成一个 `[x,y]` 单元格（`teda.md` §4.3、[ADR-0065](../docs/adr/01-language/0065-a-coordinate-tuple-is-one-cell.md)），括号内不写空格、不加单位、各分量按上面的定点数规则格式化。
- 列对齐：同段内按最宽单元格对齐，列间至少两个空格；段之间一个空行；文件末尾一个换行。元组是**一格**，所以一串顶点或折点按单元格对齐，配对由元组自身保证，对齐不需要为它让路。
- `fmt(fmt(x)) == fmt(x)`，且 `parse(fmt(x))` 与 `parse(x)` 语义相同。

---

## 7. 不支持与已知限制

| 限制 | 现在的行为 | 后续 |
|---|---|---|
| 圆弧走线 | 不支持；导入时按折线近似并报告偏差 | 待定 |
| 丝印圆弧 | pcb 描述不画丝印图形（那是封装库的事，§4.11）；封装图形里的 `arc` 在出图时按 32 段折线展开（一圈），起止点保持精确 | 保持 |
| 字体外的字符 | 笔画字体只覆盖可打印 ASCII，画不出的字符在印前去掉（`10kΩ` → `10k`），**不报错** | 保持 |
| `physical_only` 的开窗 | 安装孔、基准点、缝合孔、开槽**不产生**阻焊/锡膏开口（它们不是焊盘，§4.12） | 保持 |
| 圆弧板框 | 不支持 | 待定 |
| 微孔（HDI） | 不支持 | 待定 |
| 铣槽与异形孔 | `physical_only` 只表达圆孔与矩形开孔 | 待补（`docs/adr/06-manufacturing/0021-the-manufacturing-output-path.md` decision 12） |
| 铜到板边间距 | 没有规则项可表达；铜皮贴齐板框导出 | DRC 关注项，[ADR-0018](../docs/adr/05-pcb/0018-copper-fill-uses-a-geometry-kernel.md) D9 已列为已知限制 |
| 铜皮填充缓存 | 不做：每次导出重算（参考板 8 ms / 铜皮，`min_width` 打开约 370 ms） | 真的需要时再加可删除的派生缓存 |
| 丝印避让 | **不裁剪**：丝印按声明原样出图，压到焊盘上也算（CAM 判定，不是格式层） | 不做（[ADR-0021](../docs/adr/06-manufacturing/0021-the-manufacturing-output-path.md) decision 2） |
| 差分对的几何表达 | 不表达，靠 `rules` 约束 | 保持 |
| 阻抗计算的工艺栈 | 只存 `er` 与介质厚度，不做计算 | 交给 KiCad/仿真工具 |
| 跨板连接的 pcb 侧表达 | **没有**：跨板路径是根的 `interconnects`（`teda.md` §7.5），本文件没有对应的段；`connect` 只连本板 pad | 保持（设计如此，不是缺口） |
| pcb-only 模式 | 不支持（pcb 假定有完整的逻辑根） | `AGENTS.md` §11 第 6 条 |
| 封装 pad 几何来源 | 引用 `assets/components/` 的 `footprint`；IR 内 pad 几何是引用还是内联待定 | 见 [ADR-0016](../docs/adr/05-pcb/0016-agent-first-pcb-description.md)"后续" |
| 布局约束（区域、邻接、禁布） | 不表达 | 待定 |
| 3D 模型与装配图 | 不在 pcb 描述内（属封装库与 fab 层） | — |

---

## 8. 导出与制造

### 8.1 填充（导出的第一步）

填充策略在 `packages/core/src/fill/`，几何内核在 `packages/geom`：内核只认形状，策略认 net / 间距 / 层（[ADR-0018](../docs/adr/05-pcb/0018-copper-fill-uses-a-geometry-kernel.md) D3）。

顺序：① zone 轮廓 ∩ 板框，减去板内开孔与本层 `no_pour`；② 与本 zone 不同 net 的铜（以及 `net: null` 的铜——原理图没给 net 的铜不是任何一块铜皮的 net）按间距放大后减掉；③ 同 net 的 `none` 照样减掉，`thermal` 减掉间隙环再补回四条 0°/90°/180°/270° 的桥；④ `min_width` 做开运算（先腐蚀再膨胀，再与输入求交），减掉的面积报 `drc.zone-min-width`；⑤ 量面积，空铜皮报 `drc.zone-empty`。

- **对接间距取两侧较大者**：`net` 规则替换该 net 的板级默认，而间隙要同时满足两侧；焊盘自己的 `clearance_nm` 只能放大，不能缩小。
- **`zone_connect` 决定连接方式，不由 net 决定**：通孔焊盘默认 `thermal`，贴片焊盘默认 `solid`；同 net 的 `solid` 铜不动。
- **铜皮贴齐板框，不内缩**：`rules` 里没有"铜到板边间距"这一项，那属于 DRC 而不是填充规则；是否留边由板厂与 DRC 决定（已知限制，见 §7）。
- 填充是**每次导出重算**的派生物：不进 IR、不进工程哈希，也不写缓存文件。

### 8.2 Gerber 与钻孔文件

`texteda export gerbers <工程目录> <pcb_id> [--out <dir>] [--json]` 把一块板写进默认的 `dist/fab/<pcb_id>/`：

| 文件 | 内容 |
|---|---|
| `<pcb>-<layer>.gbr` | 每个铜层一份（`F.Cu` → `F_Cu`），每面再各出阻焊、锡膏、丝印（`F.Mask` / `F.Paste` / `F.SilkS`，板底同理），外加 `Edge_Cuts`；空层照样出文件（只有头 + `M02*`）——缺文件对板厂意味着"这层没定义"，空文件意味着"这层没有东西" |
| `<pcb>.drl` | 一份 Excellon：电镀孔（过孔、通孔焊盘）与非电镀孔（安装孔）；没有孔就不出文件 |

- 坐标用 `%FSLAX46Y46*%` + `%MOMM*%`、省略前导零，也就是一个单位 = 1 nm，写出的整数**就是纳米数**：不缩放、不取整、负数带 `-`。
- 每份文件带 `G04 TextEDA <tool_version>*` 与 `G04 source <source_hash>*`（Excellon 用 `;` 注释），`source_hash` 是**工程哈希**——文件能追到它描述的那个构建（`AGENTS.md` §2 第 11 条）。
- 孔径去重、从 `D10` 升序编号、按整数算术写六位小数；语句按（区域 < 走线 < 闪光）再按几何规范文本排序，所以同一块板两次导出**逐字节相同**。
- 连线格式的完整冻结条款（`G36`/`G37` 不重复首点、`M02*` 后恰好一个换行、`;unplated:` 为 0 时省略）见 [ADR-0018](../docs/adr/05-pcb/0018-copper-fill-uses-a-geometry-kernel.md) D9。
- 导出器（`packages/exporter`）只做序列化：不读 net、不裁剪、不调内核、不读时钟；几何由 `packages/core` 的 `boardImage()` 装配好再交给它。
- 层序固定：叠层里的铜层按叠层序，然后**每面（先顶后底）各出 `Mask` / `Paste` / `SilkS`**，`Edge.Cuts` 最后；钻孔文件在最后。板的单面与否由叠层决定（有 `F.Cu` 才有顶面，有 `B.Cu` 才有底面），单面板就只出顶面的三层。
- 阻焊与锡膏是**开窗**而不是铜：阻焊层画的是"覆盖层缺在哪里"，锡膏层画的是"钢网在哪里开孔"。两者都从焊盘自己的轮廓出发（§4.10），所以圆焊盘是闪光、其余是区域。
- 文字的位置、层、字号与朝向规则见 §4.11；丝印图形按封装的 `graphics` 原样出图，`width` 缺省或为 0 时用层默认 **0.12mm**（`spec/footprint.md` §5）。
- **尚未导出**：制造包（`fab`，[ADR-0021](../docs/adr/06-manufacturing/0021-the-manufacturing-output-path.md)）与 `.kicad_pcb` 板文件。

## 9. 完整示例

对应的逻辑根 `design/sch/main.teda` 与模块 `design/sch/modules/power.teda` 片段（net 成员只在模块/根里声明，pcb 只引用展平后的 `net_id`）：

```
# design/sch/modules/power.teda
instances
  U1  tps7a02
  C1  cap-mlcc-0603
  R1  res-thick-0402

nets
  VIN:  U1.1
  GND:  U1.4  C1.1  R1.2

ports
  VIN  VIN
  GND  GND

# design/sch/main.teda
modules
  M1  IDp8x2n4  power

nets
  GND:  M1.GND
```

对应的 `design/pcb/pwr-l1.teda`：

```
version 0.14.0
pcb pwr-l1

modules
  M1

board_thickness 1.6mm

stackup
  F.Cu    copper     0.035mm  signal
  prepreg dielectric 0.210mm  FR4 4.3
  B.Cu    copper     0.035mm  signal

outline
  [0.0,0.0]
  [40.0,0.0]
  [40.0,30.0]
  [0.0,30.0]

place
  M1.U1  [12.0,12.0]  0   top
  M1.C1  [18.0,12.0]  90  top
  M1.R1  [24.0,8.0]   0   top

connect
  M1.U1.4  M1.C1.1
  M1.U1.4  M1.R1.2

trace
  GND  F.Cu  0.25mm  [12.0,6.0]   [12.0,16.0]
  GND  B.Cu  0.25mm  [12.0,16.0]  [18.0,16.0]

via
  GND  [12.0,16.0]  0.6mm  0.3mm

zone
  GND  B.Cu  [0.0,0.0]  [40.0,0.0]  [40.0,30.0]  [0.0,30.0]

rules
  clearance  0.2mm
  width      0.25mm
  via        0.6mm  0.3mm
  net        GND  0.3mm  0.5mm  0.8mm  0.4mm

silk
  refdes  F.SilkS  1.0mm  show
  value   F.SilkS  0.8mm  hide

physical_only
  H1   mounting   [5.0,5.0]     6.0    3.2
  F1   fiducial   [45.0,31.0]   1.0    F.Cu
```

读法：`VIN` 只有 `M1.U1.1` 一个成员，pcb 里没有对应走线——按 §5.2 规则 5 报"该 net 未布线"。`M1` 被 `pwr-l1` 声明（§4.1）；别的板上若有另一份 `power` 实例（`M3 power`），它的布线写在**那块板**的文件里，与本板无关——同名 net 不连通两块板，板间只有根的 `interconnects`。
