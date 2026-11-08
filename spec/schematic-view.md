# `view` 描述规范（草案）

状态：草案。决策与取舍见 `docs/adr/09-view/0035-the-view-layer-is-a-drawing.md`（视图层）与 `docs/adr/04-schematic/0012-one-flat-schematic-per-board.md`（板只有一份原理图文件，绘制划分是打印页）；跨描述通用的词法、单位、版本、canonical 规则见 `teda.md` §3–§5、§10、§12。

本文件是 `teda.md` 的分描述补充：`.teda` 语言的共用规则在 `teda.md`，`view` 这一类描述的具体段定义在这里。

Every `.teda` file declares the shared language version (currently `0.11.0`; see `spec/teda.md` §13.1). The `view` type was introduced at `0.6`; its reader floor advanced to `0.7` when references changed from page-local to board-level ids ([ADR-0012](../docs/adr/04-schematic/0012-one-flat-schematic-per-board.md) D4), and is now `0.11` because coordinate tuples changed ([ADR-0065](../docs/adr/01-language/0065-a-coordinate-tuple-is-one-cell.md)). A `field` section was introduced in `0.10`, but every `view` file now requires at least `0.11`.

---

## 0. 定位

`view` 描述表达**一块板的一个"打印页"的"画"**：符号摆在哪、走线怎么走、标签与板端口在哪。

它是原理图逻辑（S0）与渲染器之间的那一层，也就是 `AGENTS.md` §3 分层表里的 **S1**。四条底线（`AGENTS.md` §2、[ADR-0035](../docs/adr/09-view/0035-the-view-layer-is-a-drawing.md) decision 1 6）：

1. **视图不是第二个真源**。引脚电气类型、net 成员、器件身份都在板文件（`schematic`）里；`view` 只按同样的身份键（`instance_id` / `pin_number` / `net_id`）**引用**它们，不复述。视图与逻辑不一致是缺陷，要报出来。
2. The renderer does not arrange symbols, wires, labels or ports. It does provide deterministic `Reference` / `Value` field positions when no override is present; this narrow text-placement rule is not a layout solver.
3. **视图可丢弃、可重画**。它是 S1 层，`AGENTS.md` §3 明确标为"可以自由、可以丢弃"。
4. **视图不改变连通性**。`view` 里的 net 只是引用逻辑层的 net id；它既不新增连接，也不删除连接。连通性由 S0 决定（`AGENTS.md` §2 第 2 条）。

### 0.1 视图用哪一套引脚引用

视图**只写引脚编号**（`U1.5`；层次落地后是 `M1.U1.5`），不写引脚名（`U1.PA0`）、不写多单元简写（`U1.2.OUT`）。

理由：板文件里的引脚引用在**编译时**就被解析成编号形式（IR 里的 net 成员一律是编号，见 `teda.md` §4.5、§12 规则 9）。视图如果允许名字形式，视图与板文件就得各自解析一次名字，两边解析结果还可能不一致（歧义、找不到）。统一成编号形式后，"视图与逻辑对不对得上"就是**同一批字符串的直接比对**，不需要任何解析器在场。

代价是写视图的人得知道编号——这本来就是画图工具该知道的事。

### 0.2 与板文件的关系：打印页

`view` 是**一块板的一个打印页**：板的文件是 `design/sch/<board_id>.teda`（`schematic`），打印页是 `views/<board_id>/<page_id>.view.teda`（`view`）。

| | 板文件 | 打印页 |
|---|---|---|
| 文件 | `design/sch/<board_id>.teda` | `views/<board_id>/<page_id>.view.teda` |
| 描述类型 | `schematic` | `view` |
| 名字空间 | 板级（instance_id、net_id 在板内唯一） | **同一套板级名** |

所以视图里写 `U1.5`、`GND`，指的是**板上**的 U1 的 5 号脚、**板上**的 GND net——与板文件里的字符串逐字相同，没有第二套名字要解析。

**视图用的是板的身份语言，不是它的一部分**：板级 `instance_id`、`net_id` 是什么形状，视图里就是什么形状。当前版本的视图仍按**显示名**引用实例（`U1`、`M1.U1`）；实例的稳定 `uid`（[ADR-0010](../docs/adr/03-project/0010-instance-identity-is-a-uid.md)）是板级记录的字段，view/pcb 的引用重键不在本版。将来模块层次落地后，模块实例的 id 是 `M1.U1`、模块内部 net 是 `M1.VCC`，视图照样直接写这些名字（引脚引用是 `M1.U1.5`）——因为视图只**引用**身份，不定义身份。视图不认识的写法（比如两个点的 `A.B.C`）在解析期就报错。

打印页是**绘制与打印的划分单元**，不是逻辑的划分单元：画不下、评审想分块看，就多写一个打印页；逻辑始终只有一份。**没有打印页是合法状态**：板仍然可校验、可导网表，只是不可画。评审界面要如实报"此板无打印页"，不能自己排一张。

一个板可以有多个打印页（`charger-power`、`buck-5v`），每个打印页画板上的一部分器件；各打印页画到的 net 与端口都是**板级**的，重名不存在。

决策见 `docs/adr/04-schematic/0012-one-flat-schematic-per-board.md`。

---

## 1. 文件头

```
version 0.11.0
view main
```

- 版本行、类型行规则同 `teda.md` §5。
- 文件名必须等于类型行里的 id（去掉 `.view` 后缀）：`views/<board_id>/<page_id>.view.teda` ↔ `view <page_id>`。`.view` 后缀是类型标记。
- 板 id 不写进文件，由目录 `views/<board_id>/` 决定。
- `page_id` 是**打印页**的名字（不是逻辑划分单元）：同一块板的打印页 id 互不相同。

---

## 2. 标量

标量在第一个段之前，值为行尾剩余文本（`teda.md` §4.4）。

| 键 | 必填 | 说明 |
|---|---|---|
| `sheet` | 否 | 图幅：`<宽> <高>`（mm）。缺省 `297 210`（A4 横向）。 |

顺序无关，canonical form 固定为 `sheet` 在最前。

### 2.1 坐标系

- 单位 **mm**，分辨率 **0.01 mm**（2026-10-25 起；此前是 0.1 mm）。这是**格式能表达的精度**，不是绘制网格。绘制网格是 `0.5 mm` 晶格（[ADR-0059](../docs/adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D1）：**打印页存的每一个坐标**都锚在它上面——`place` 的符号原点、`field` 的字段锚点（符号局部系）、`wire` 的折点、`label` 的标签位置、`port` 的端口位置、`text` 的注释位置，两个轴都是。符号侧的引脚连接点与引脚内端同样在这张晶格上（`spec/symbol.md` §4.1，[ADR-0057](../docs/adr/08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) D1），摆位吸附也是 `0.5 mm`（同一条记录 D4）。**目前不允许自由摆位**（[ADR-0059](../docs/adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D5）。格式比晶格细一档，是为了让历史文件与手工微调仍能表达；把分辨率调粗到 `0.5 mm` 会改变 canonical form，并让长度诊断改写每一条旧坐标。超出这个分辨率仍报 `value.length-invalid`。
- 晶格是**作图约定**，不是新的诊断码：跑偏了由既有的 `view.wire-diagonal` / `view.wire-crosses-pin` 这些码说话，仓库的门禁另外查（[ADR-0059](../docs/adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D2）。
- 原点 = **图幅的左上角**；**+x 向右，+y 向下**（与 SVG 的坐标系一致，渲染器不需要翻转）。
- 旋转角度单位为度，**顺时针为正**，缺省 `0`。
- IR 里长度一律是整数纳米（`_nm`）、角度是整数毫度（`_mdeg`），见 `AGENTS.md` §2 第 18 条与 `docs/adr/02-ir/0006-ir-shards-and-hashes.md` decision 7。

---

## 3. 段总表

| 段 | 内容 | 必填 |
|---|---|---|
| `place` | 器件实例的摆位 | 是 |
| `field` | `Reference` / `Value` 的每实例位置覆盖 | 否 |
| `junction` | view-only 绘图节点及其坐标 | 否 |
| `wire` | 走线边 | 否 |
| `label` | net 名标签 | 否 |
| `port` | 板端口符号 | 否 |
| `text` | 自由注释文字 | 否 |

段头是"单个保留字"（`teda.md` §3）。**本描述不使用冒号，也不支持续行**：所有段都是固定前缀 + 变长坐标尾（与 `pcb` 的 `trace` / `zone` 同一风格，见 `spec/pcb.md` §4.5）。

---

## 4. `place` 段

```
place
  U1    [40.0,30.0]  0
  C1    [20.0,30.0]  90
  U2    [80.0,30.0]  0   unit=2
```

列：`<instance_id> <origin> [<rot>] [key=value …]`，`<origin>` 是 `[x,y]`。

| 列 | 说明 |
|---|---|
| `instance_id` | 板级实例 id（`U1`；模块层次落地后可以是 `M1.U1`），必须在板文件 `design/sch/<board_id>.teda` 的 `instances` 段里存在 |
| `x` `y` | 符号**原点**在图幅坐标系里的位置（mm） |
| `rot` | 符号旋转（度，顺时针为正），缺省 `0`。v0.1 只支持直角旋转：必须是 0/90/180/270，否则报 `value.angle-invalid` |

可选尾列（`key=value`，顺序任意，多余的键报错）：

| 键 | 说明 |
|---|---|
| `unit` | 多单元器件画哪一个单元（`1` 起）；缺省 `1`。取值必须 ≤ 该器件的单元数 |

- 符号画成什么样**不在视图里**：由 `component.symbol` → 符号库决定，渲染器自己去查。视图只说"这个实例摆在哪儿、朝哪儿"。
- `x` `y` 锚在 `0.5 mm` 晶格上（§2.1，[ADR-0059](../docs/adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D1）。摆位吸附也是这张晶格（[ADR-0057](../docs/adr/08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) D4）。
- 引脚的连接点坐标 = 符号原点 + 旋转后的引脚偏移（符号的几何事实，见 `spec/symbol.md`）。因此**符号改了引脚位置，视图里的线自动跟着走**，视图不需要跟着改。
- 一个打印页只摆它要画的实例；板上的其它实例不出现在这个打印页里（不是错误）。

---

## 4.1. `field` section

`field` is optional. It stores positions for the two schematic-instance fields, never their text or electrical facts:

```teda
field
  U1  Reference  [0.00,2.00]
  U1  Value      [-0.50,-2.00]
```

Each row is `<instance_id> <name> <offset>`. The vocabulary is closed to exactly `Reference` and `Value`; each `(instance_id, name)` pair occurs at most once. The instance must occur in this page's `place` section. `<offset>` is `[x,y]` relative to the symbol origin and is not checked against sheet bounds. In this local frame, `+x` points right and `+y` points up. The renderer applies the symbol's right-angle rotation when projecting a field to sheet coordinates; moving or rotating the symbol therefore carries the override with it.

Two coordinate facts apply, and they are different questions (§2.1): the coordinates are written with the view file's `0.01 mm` **resolution** — the finest value the format can express, and the limit a writer is checked against — while the **drawing lattice** is `0.5 mm`. A field anchor is a lattice point in both axes ([ADR-0059](../docs/adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D1), and the review app snaps it there like a symbol placement. The file format does not *reject* a non-lattice value — `0.01 mm` resolution is what the format promises — but the drawing convention does not admit one, and the repository's view-style gate reports it.

The text is taken from the schematic instance: `Reference` is its instance id and `Value` is its instance value. If the instance has no value, the renderer retains the symbol library's `Value` placeholder. A field row overrides its automatic position; deleting the row restores automatic placement. There are no `automatic` rows or tombstones.

Without an override, a symbol with visible painted body geometry places `Reference` above and `Value` below the body, centered on its horizontal bounds with `1 mm` clearance from painted text ink. Geometry from the selected unit and shared visible symbol geometry both count. A bodyless symbol retains its library field positions and existing quarter-turn field anchoring. This is renderer-owned default text placement; it does not place symbols or change the drawing's connectivity.

The places above are the places a field *wants*. The page decides whether it gets them: the renderer places a page's fields together, in the order the page places its instances. A field keeps the place it wants while that place is free, and otherwise steps to the next free slot around its own body — the side across from the one it wanted, then the two sides at right angles to it, and each of those three again `2 mm` further out, so a field never floats more than `5 mm` from the body it names. A slot is free when the text would cover nothing else on the sheet: no other field, no label, no port tag, no note, no other symbol's painted body, and no wire run. A field's own body is not in that list — the `1 mm` clearance above is the rule that governs it — and a field an override placed by hand is not moved; the automatic fields route around it.

The result is a drawing fact, recomputed on every render like the places above, and it is never written back into the view file: an override decides its own field and nothing else. Two parts drawn close therefore keep readable designators and values, and a page that has no room left says so in the check report (`view.text-overlap`, §9.2) rather than printing one text on top of another.

An override is for a position the author *wants*, not for one they need. An automatic field is
recomputed every time the page is rendered, so it follows its symbol through an Apply; an override
does not, and a row written to dodge a collision goes stale the moment the parts around it move.
The renderer routes around a collision on its own, so no row is needed to keep two fields apart:
write one only where the author wants a field somewhere else. The review app reports `manual`
versus `automatic` on every field, which is how a reviewer tells the two apart.

`field` was introduced in language `0.10`, but the `view` reader floor is now `0.11` because coordinate tuples changed in `0.11`. Every `view` file declares at least `0.11`, whether or not it contains a `field` section; version validation runs before the body is parsed. Unknown field names are invalid literals, duplicate pairs report `value.duplicate-field`, and an unknown instance reports `ref.unknown-instance`.

---

## 5. `wire` 段

```
wire
  VDD   U1.5  C1.1  [35.0,25.0]
  GND   C1.2  U2.4  [15.0,25.0]  [15.0,12.0]
```

列：`<net> <from_endpoint> <to_endpoint> [<bend> …]`，每个 `<bend>` 是 `[x,y]`。

| 列 | 说明 |
|---|---|
| `net` | 板级 net id，必须在板文件的 `nets` 段里存在 |
| `from_endpoint` | 起点：引脚引用、页面 port id，或本页 `junction` 段声明的 junction id |
| `to_endpoint` | 终点，同上 |
| `bend` | 折点坐标（mm），可为零个或多个，按顺序经过；每点一个 `[x,y]` 单元格 |

- `@x,y` **不是合法 wire endpoint**。历史文件必须把每个匿名坐标提升为命名 junction，并在 `junction` 段声明其坐标；实现不得静默把旧端点解释成 junction。
- 走线的几何 = 端点节点的解析位置（引脚、port 或 junction）→ 依次经过折点 → 另一端点节点。端点身份不是坐标的别名。
- **一条线一个 net**：同一 net 的多条 `wire` 行是图的边；junction 是图节点，不是 schematic net 成员，也不改变 S0 连通性。
- 引脚端点必须属于该 net；port 端点按本页 port 规则校验；junction 端点必须存在且只能属于这条边声明的 net。不同 net 不能共享 junction。
- 视图的绘图连通性按图校验：有效的树不得有 dangling endpoint、几何 gap、断开的必需成员、孤立 junction 或非法 junction degree。不同 net 的几何交叉不是连接；同一 net 的有效分支绘制确定性的 junction dot。
- Review App 的 Re-anchor wires 关闭时，移动或旋转引脚不得改写 endpoint identity，也不得改写作者写下的 bends；受影响的 net 报 stale，显式 `view rewire` 才修复。开启时保留 pin identity 并按既有重锚规则让端点跟随。
- **只走 90 度**：每一段必须平行于坐标轴，违反即报 `view.wire-diagonal`（§9.2）。
- **走线不得自交**：重锚若保形会使路径自交，则按既有规则重建并报告冲突（[ADR-0042](../docs/adr/09-view/0042-the-review-app-has-modes.md) D5、[ADR-0062](../docs/adr/09-view/0062-a-run-may-end-at-a-port.md)）。
- **A pin connection point may be the endpoint of a perpendicular wire**: when a wire ends at a pin connection point and its final segment is perpendicular to the pin stroke, the renderer draws a junction dot at that point. The connection still comes from the wire's pin endpoint identity and net; this does not create another junction graph node.
- 走线不得穿过非本端点的引脚连接点或引脚笔画，违反即报 `view.wire-crosses-pin`（§9.2）。

### 5.1 `junction` 段

```
junction
  VOUT_J1  [204.0,92.5]
```

列：`<junction_id> <point>`，`<point>` 是 `[x,y]`。坐标单位为 mm，使用 view 的 `0.01 mm` 格式分辨率；坐标必须在图幅内，并遵守 `0.5 mm` 绘图晶格门禁（[ADR-0065](../docs/adr/01-language/0065-a-coordinate-tuple-is-one-cell.md)、[ADR-0059](../docs/adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md)）。`junction_id` 在本页唯一，且不得与页面 port id 混淆。junction 只属于 view drawing graph，不进入 schematic IR 的 net members。

Junctions of one net may be shared by multiple wire rows; different nets must not reference the same junction. A junction's degree is the number of effective wire arms connected to it: fewer than 2 is isolated/dangling, and more than 4 is invalid. Declared junctions and the perpendicular pin endpoints above draw dots; ordinary two-arm bends do not. Crossings between different nets do not create connection points.

---

## 6. `label` 段

```
label
  VDD   [35.0,25.0]
  GND   [15.0,25.0]
```

列：`<net> <point>`，`<point>` 是 `[x,y]`。

- 标签画的就是 **net id 本身**，**不允许改写显示文字**。标签若能显示与 net id 不同的东西（比如 net 叫 `VDD`、标签写 `3.3V`），图上就会出现"看起来叫 3.3V 的网络"——人读图时会误判网络名。想要 `3.3V` 这个名字，就把 net 命名为 `3.3V`。
- 标签位置必须落在**该 net 的某条走线上**，或落在**该 net 某个引脚的连接点**上；否则报 `view.label-not-on-net`（**警告**，不是错误：视图是给人看的图，位置偏了要提示，但不该让整张图不可用）。
- 标签锚点锚在 `0.5 mm` 晶格上（§2.1，[ADR-0059](../docs/adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D1）。
- 同一个 net 可以有多个标签（例如一页上多处标 `GND`）。

---

## 7. `port` 段

```
port
  SYS_OUT   [280.0,105.0]  180
```

列：`<port_id> <point> [<rot>]`，`<point>` 是 `[x,y]`。

- `port_id` 必须是**板**的端口，必须在板文件的 `ports` 段里存在（`teda.md` §7.5）。
- 端口符号**不创建连接**，它只是给一个已存在的 net 起个对外的名字。
- 端口有两种角色，二者都用这一行：**画一个符号**（位置落在该 net 的走线或引脚连接点上，同 `label`，不一致报 `view.port-not-on-net`，警告），以及**作为一条走线的端点**（`wire` 行的 `from_pin` / `to_pin` 写这个 port id，端点坐标就取这一行的 `x` / `y`）。端点与符号共用同一个 `x` / `y`：端点的坐标不另写一份（[ADR-0062](../docs/adr/09-view/0062-a-run-may-end-at-a-port.md) D1、D2）。
- 一条走线结束在某个 port 上时，这一行就是它的端点；移动这一行，走线**延伸或收缩**去够它（同引脚重锚，[ADR-0062](../docs/adr/09-view/0062-a-run-may-end-at-a-port.md) D4）。
- 走线命名的 port 必须是**本页**画出的（`port` 段里有一行）；没有那一行就没有端点坐标，报 `view.port-not-drawn`（错误，§9.1）。
- 端口锚点锚在 `0.5 mm` 晶格上（§2.1，[ADR-0059](../docs/adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D1）。
- `rot` 单位度、顺时针为正、缺省 `0`。
- 画在哪个打印页上都可以：一个板端口可以在多个打印页里各画一次。

---

## 8. `text` 段

```
text
  12.0 8.0   Rev A — power section
```

列：`<point> <text…>`，`<point>` 是 `[x,y]`。

- 第三列起是**行尾剩余文本**（与标量同一约定，`teda.md` §4.4），允许空格。
- 注释锚点锚在 `0.5 mm` 晶格上（§2.1，[ADR-0059](../docs/adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D1）。
- 纯注释，不带任何电气含义，不参与任何校验（除了"文字重叠"这类可读性检查）。

---

## 9. 校验

校验分两层：**文件自身能回答的**（解析器做）与**需要板才能回答的**（板交叉校验做，`packages/core`）。下表最后一列是落地状态。

板交叉校验在 `texteda check` 里跑（[ADR-0038](../docs/adr/10-process/0038-implementation-stack-and-agent-entry.md) 是校验入口）；`texteda ir` 只把分片写出来，不做交叉校验——视图是附注分片，不参与构建身份（[ADR-0006](../docs/adr/02-ir/0006-ir-shards-and-hashes.md)）。

### 9.1 错误（阻断）

| 码 | 触发 | 状态 |
|---|---|---|
| `view.pin-not-placed` | `wire` 的端点引脚所属实例没有出现在 `place` 段 | 已实现（解析器） |
| `view.out-of-sheet` | 坐标落在图幅之外 | 已实现（解析器） |
| `value.angle-invalid` | 旋转不是 0/90/180/270 之外的整数度（v0.1 只支持直角旋转） | 已实现（解析器） |
| `ref.unknown-instance` | `place` 里的 instance id 在板的 `instances` 段里不存在 | 已实现（板交叉校验） |
| `ref.unknown-net` | `wire` / `label` 里的 net 在板的 `nets` 段里不存在 | 已实现（板交叉校验） |
| `ref.unknown-port` | `port` 里的 port_id 在板的 `ports` 段里不存在 | 已实现（板交叉校验） |
| `view.pin-net-mismatch` | `wire` 的端点引脚不属于该行声明的 net | 已实现（板交叉校验） |
| `view.port-not-drawn` | `wire` 端点引用的 port 未在本页 `port` 段绘制 | 已实现（解析器） |
| `ref.unknown-junction` | `wire` 端点引用的 junction 未在本页 `junction` 段声明 | 已实现（板交叉校验） |
| `view.wire-dangling-endpoint` | wire 端点在渲染几何中没有对应 pin、page port 或 junction 锚点 | 已实现（板交叉校验 + 渲染几何） |
| `view.wire-gap` | wire 几何经过本 net 声明的 junction，却没有以该 junction 为端点 | 已实现（板交叉校验 + 渲染几何） |
| `view.wire-disconnected` | 本页同一 net 的必需 pin/port 节点未处于一个连通分量 | 已实现（板交叉校验） |
| `view.junction-isolated` | 声明的 junction 未被有效 wire edge 使用 | 已实现（板交叉校验） |
| `view.endpoint-wrong-net` | junction 或 page port 被 wire 声明为不匹配的 net | 已实现（板交叉校验） |
| `view.junction-invalid-degree` | junction 的有效同 net wire-arm degree 不符合图规则 | 已实现（板交叉校验） |

### 9.2 警告（不阻断）

| 码 | 触发 | 状态 |
|---|---|---|
| `view.nets-not-drawn` | 板里**成员数 ≥ 2** 的 net 在**所有**打印页上都既没有走线也没有标签——图上看不出它连着。一块板报**一条**，带数量与前十个 net 名（画到一半是正常状态，它需要说得出来，不是被禁止——同 [ADR-0019](../docs/adr/05-pcb/0019-a-partial-layout-is-legal.md) D4 的分寸）。没有任何打印页的板**不报**：有逻辑、无视图是合法状态 | 已实现（板交叉校验，`packages/core/src/view/checks.ts`） |
| `view.label-not-on-net` | 标签没落在该 net 的走线或引脚上（该 net 在本页**有画走线**时才判：整条 net 没画是 `view.nets-not-drawn` 的事，不逐标签重复） | 已实现（可读性检查，`packages/core/src/view/readability.ts`） |
| `view.port-not-on-net` | 端口符号没落在该 net 的走线或引脚上（同一前提） | 已实现（可读性检查，同上） |
| `view.wire-crosses-symbol` | 走线穿过某个符号的本体（`AGENTS.md` §6 的可读性检查）；本体取符号**图形**的包围盒，不含文字字段 | 已实现（可读性检查，同上） |
| `view.wire-diagonal` | 走线有一段**不平行于坐标轴**（§5）：整页横平竖直，唯一的斜线读不出来它的两端是什么关系 | 已实现（可读性检查，同上） |
| `view.wire-crosses-pin` | 走线穿过某个引脚的连接点（该引脚不是这条走线的端点时），或穿过该引脚从连接点到符号本体的笔画（§5）：读者会把走线读成引脚的一部分，或读成一个没有圆点的连接 | 已实现（可读性检查，同上） |
| `view.text-overlap` | 两段文字互相压住（**相切不算**，必须有重叠面积）。**符号画的字段（Reference / Value）也是文字**：字段压字段、字段压标签或注释，同归这条 | 已实现（可读性检查，同上） |
| `view.label-collision` | 两个标签压在一起（label 与 label 的重叠归这条，其余文字组合归 `view.text-overlap`） | 已实现（可读性检查，同上） |
| `view.text-on-wire` | 走线从文字**中间**穿过：字还在，词读不出来。标签与端口**豁免它自己命名的那个 net**（标签本来就落在自己的线上），符号画的字段（Reference / Value）与自由注释不豁免 | 已实现（可读性检查，同上） |

> **不同 net 的走线交叉不报警**：§5.1 的读法只有一条（有点 = 连接，没点 = 不连接），所以交叉本身不是缺陷；`view.wire-crossing` 已废弃，只为旧报告保留码表行，`check` 不再发出。

> 码表见 `docs/error-codes.md`（由 `packages/ir/src/diagnostics/codes.ts` 生成）。诊断码按"错误的种类"分域，不按发现阶段分（[ADR-0003](../docs/adr/01-language/0003-diagnostic-error-codes.md)）："引用了不存在的东西"在 `view` 里和在 `sch` 里是同一类错误，所以复用 `ref.*`；"角度不合法"复用 `value.angle-invalid`。`view` 域是本描述引入的新域，授权见 [ADR-0035](../docs/adr/09-view/0035-the-view-layer-is-a-drawing.md)。
>
> **注册表只登记"已发出"的码**（[ADR-0003](../docs/adr/01-language/0003-diagnostic-error-codes.md) decision 7：码表是唯一真源，发出即冻结）。本表列出的诊断码均已发出并登记。
>
> **几何从渲染器来，不从检查器推**。文字宽度、符号本体范围、引脚落点都由 `packages/renderer` 的 `schematicGeometry` 按**实际画法**算出（同一套变换、同一套笔画字体度量），检查器只判断"压没压住""在不在线上"。检查器自己再算一遍就会和读者看到的东西漂移，那正是可读性检查要防的那类错误。
>
> **字段也在几何里**：`schematicGeometry` 除了视图自己的记录（`label` / `port` / `text`），还给出每个已放置实例的 `fields`——符号画的 `Reference` / `Value` 在纸上的框（含旋转，按绘制后的矩形取包围盒）。字段的默认位置由渲染器确定，显式 `field` 覆盖由视图作者调整；两者都是视图几何的一部分，但都不改变逻辑事实。可读性检查读取最终字段几何：`view.text-on-wire` 就靠它报出"走线穿过位号"，`view.text-overlap` 就靠它报出"两个字段压在一起"。字段在整页上的位置由渲染器按 §4.1 的规则统一安排，所以一页里字段互相压住说明这页已经没有位置可让——检查器把它报出来，作者去把符号挪开。

### 9.2.1 诊断载荷

诊断的 `--json` 载荷带量才可修。`data` 字段使用与 IR 一致的单位（纳米）：

| 码 | `data` |
|---|---|
| `view.label-not-on-net` / `view.port-not-on-net` | `page` `net` `kind` `distance_nm`（到该 net 最近走线或引脚的**距离**） |
| `view.label-collision` / `view.text-overlap` | `page` `first` `second` `first_kind` `second_kind`（`label` / `port` / `text` / `field`）`overlap_area_nm2`（重叠**面积**） |
| `view.text-on-wire` | `page` `net` `kind` `text` `through_nm`（在文字框**内部**的长度）；字段另带 `instance` |
| `view.wire-crosses-symbol` | `page` `net` `instance` `through_nm`（在**本体内部**的长度） |
| `view.wire-diagonal` | `page` `net` `segments`（斜段**条数**）`x_nm` `y_nm`（第一段斜线的起点）`off_axis_nm`（该段偏出轴线的量 = min(abs(dx), abs(dy))） |
| `view.wire-crosses-pin` | `page` `net` `instance` `pin` `x_nm` `y_nm`（引脚连接点）；穿过笔画时另带 `cross_x_nm` `cross_y_nm`（笔画上的穿越点） |
| `view.nets-not-drawn` | `count` + 前十个 net 名 |
| `view.wire-dangling-endpoint` | `page` `net` `endpoint` |
| `view.wire-gap` | `page` `net` `junction` `wire`（本页 `wire` 段中的零基索引） |
| `view.wire-disconnected` | `page` `net` `components` `missing_members` |
| `view.junction-isolated` / `view.junction-invalid-degree` | `page` `junction` `degree` |
| `view.endpoint-wrong-net` | `page` `junction` / `port` `net`；junction 冲突另带 `other_net` |

同一组数字在人类可读输出里换成 mm / mm²，出现在消息里（"nearest point of the net is 6.8 mm away"）：一个偏 0.1 mm 的标签和一个偏 20 mm 的标签是同一条警告、两种完全不同的修法。

### 9.3 不校验的事

- **视图不参与 ERC**。ERC 在板的逻辑 IR 上跑（`AGENTS.md` §4.2），视图里的线画错了不会让 ERC 变红——那是 `view.*` 诊断的活。
- **视图不改变连通性**。视图里少画一条线，逻辑层照样是那个 net。

### 9.5 可反解（round-trip）

渲染器只读（`AGENTS.md` §2 不变量 3），所以它画的每一页都必须能反解回"这一页说了什么"——`extract(render(ir)) == ir`（不变量 4，[ADR-0036](../docs/adr/09-view/0036-our-own-reference-renderer.md) decision 5）。

**比的是语义投影，不是 IR 本身**。一张打印页的语义是落在纸面上的东西：图幅大小、引脚连接点与朝向、符号自身的图形、走线折点、标签与注释的文字与位置、端口标签的尖点与朝向，以及 `Reference` / `Value` 字段的文字与绝对图纸位置。以下故意不在投影里：

| 不进投影 | 理由 |
|---|---|
| 实例摆位原点与旋转本身 | 投影比较的是由它们产生的引脚、图形和字段在纸面上的可见结果；不比较 IR 的摆位参数本身 |
| 线宽、字号、对齐方式 | 外观，不是语义；符号自身的绘制由符号的 round-trip 负责 |
| 端口标签的塔形细节 | 只比尖点与朝向，改标签外形不算失真 |
| "这个引脚属于哪个实例" | 图上没有这条信息；同一符号的两个实例互换位置画出的是同一张图，实例身份靠投影中的 `Reference` 文字与字段归属来配对 |

**字段文字来自实例**：符号文件的 `Reference`（`U`）与 `Value`（符号名）只是占位符。图上 `Reference` 使用实例 id；`Value` 使用实例的 `value` 列，未提供时保留符号库 `Value` 字段的占位文本，见 `spec/symbol.md` §2。两字段的内容与最终纸面位置都进入投影；库占位文本仅在 `Value` 无实例值时进入投影。

**自动字段位置是确定性渲染规则**：对有可见本体几何的符号，`Reference` 放在本体上方、`Value` 放在下方；与符号图形及其可见文字笔画保持至少 `1_000_000 nm` 间距。几何包含所选 unit 与共享可见图形。无本体几何时沿用符号库字段位置及现有的直角旋转锚定规则。显式 `field` 覆盖位置优先于自动位置；删除覆盖即恢复自动位置。字段位置进入投影。

**两端独立实现**：视图侧用象限矩阵把符号局部坐标换到图纸坐标（`schematicProjection`），图纸侧直接读绘制指令（`extractSchematic`），两者不共用变换函数——共用就等于自己验证自己。字段覆盖坐标按符号局部坐标存储（+x 右、+y 上），变换后与绘制出的字段位置比较。落在复现性上：同一份 `view` 两次渲染字节相同（§11），反解也相同。

实现：`packages/renderer/src/schematic-extract.ts`；测试：`packages/renderer/test/schematic-roundtrip.test.ts`（四个象限 + 走线端点落在引脚上 + 字段位置与内容 + 灵敏度）与 `packages/cli/test/view-roundtrip.test.ts`（参考工程的每一页）。


### 9.4 度量（`texteda view metrics`）

警告之外，一张页的**量**由 `texteda view metrics <工程目录> <board>/<page> [--json]` 给（`packages/core/src/view/metrics.ts`）。它与可读性检查读**同一份几何**（`schematicGeometry`），所以"这条线离那个 net 多远"在两边只有一个答案。

| 量 | 含义 |
|---|---|
| `content` / `content_fill_ppm` | 所有图元的外接框，以及它占图幅的比例（ppm；靠近 1000000 说明画面快撑满） |
| `counts` | 实例 / 标签 / 端口 / 注释 / 走线数，以及本页没画走线的 net 数 |
| `label_min_gap_nm` / `text_min_gap_nm` | 任意两段文字的最小间隙（0 = 相接或压住）；不足两段时缺省 |
| `wire_total_nm` | 走线总长 |
| `wire_crossings` | **不同 net** 的走线互相穿越的次数（同一 net 交叉是汇合，共享端点更不算） |
| `wires_through_bodies` | 穿过非本端点的符号本体的走线条数 |
| `net_texts[].distance_nm` | 每个标签/端口到它所指 net 的距离；`-1` = 该 net 在本页没有任何走线或引脚 |

**为什么不是截图**：像素不能跨渲染比较（抗锯齿、视口、字体），一次截图要过视觉模型、说不出"差 0.2 mm"，也进不了 CI。agent 画图的循环是 `写 → check（对不对）→ view metrics（差多少）→ 改`，SVG 快照留给人的评审——判定要机器给，观感要人给。

### 9.4.1 打印页的命令（`texteda view`）

打印页作用域的命令归在一个名词底下（[ADR-0044](../docs/adr/10-process/0044-the-agent-surface-is-a-set-of-verbs.md) D6）：

| 命令 | 做什么 |
|---|---|
| `texteda view metrics <工程目录> <board>/<page> [--json]` | §9.4 的量 |
| `texteda view rewire <工程目录> <board>/<page> [--dry-run] [--json]` | 把走线重新锚回引脚（见下） |
| `texteda view render <工程目录> <board>/<page> [--out <文件>] [--json]` | 把这一页画成 SVG 文件（与评审 app 同一渲染器） |

**`view rewire` 做什么**：走线行的端点写的是**引脚引用**，所以符号一动端点就跟着动，而折点留在原地——走线会歪（`view.wire-diagonal`）。`view rewire` 把折点重新算出来：中间的折点坐标不动，两端按引脚现在的位置重算。方向从走线自己读出来：相邻两段不能同向（同向就是一条线），所以端段的轴向由它旁边那一段决定（`packages/core/src/view/reroute.ts` 的 `rerouteWire`）。

**它不是路由器**：不搜索、不绕行、不看符号本体；内部有斜段的走线只**报冲突**（ADR-0042 D6），不重画。

---

## 10. 例子

### 10.1 正例

```
version 0.11.0
view main

sheet 297 210

place
  U1    [40.0,30.0]  0
  C1    [20.0,30.0]  90
  R1    [60.0,30.0]  0

wire
  VDD   U1.5  C1.1  [35.0,25.0]
  VDD   C1.1  R1.1  [25.0,25.0]  [55.0,25.0]
  GND   C1.2  R1.2  [25.0,35.0]  [55.0,35.0]

label
  VDD   [35.0,25.0]
  GND   [25.0,35.0]
```

### 10.2 反例

```
version 0.11.0
view main

wire
  VDD   U1.5  C1.1
```

**错在哪**：`C1` 没有出现在 `place` 段（`view.pin-not-placed`，解析器就会报）；`U1.5` 与 `C1.1` 都没在板的 `nets` 段里声明为 `VDD` 的成员（`view.pin-net-mismatch`，板交叉校验时报）。

**怎么修**：把 `C1` 摆进 `place` 段，并在板的 `nets` 段里声明 `VDD: U1.5 C1.1 R1.1`。

---

## 11. Canonical form

段顺序固定：`place` → `field` → `junction` → `wire` → `label` → `port` → `text`。
- 段内行按**自然序**排序（标识符里的数字段按数值比，`C2` 在 `C10` 前；见 `teda.md` §12 规则 9）。
  - `place` 按 `instance_id` 排；
  - `field` 按 `(instance_id, name)` 排；
  - `junction` 按 `junction_id` 排；
  - `wire` 按 `(net, from_endpoint, to_endpoint)` 排；
  - `label` 按 `(net, x, y)` 排；
  - `port` 按 `port_id` 排；
  - `text` 按 `(x, y, text)` 排。
- 列宽按段内最大值对齐；行宽超过 80 列时**不折行**（`wire` 的折点是一串 `[x,y]` 单元格，拆行会让一条走线读成两条，与 `pcb` 的 `trace` 同理，见 `teda.md` §3 末条）。
- `wire` 的折点每个是**一格**（`[x,y]`），所以前三列与折点列一起按最宽单元格对齐，不需要任何"成对排"的例外。
- `place` 的旋转列与 `unit=` 尾列分开对齐（旋转可能缺省，`unit=` 可能没有）。
- `wire` 的折点按经过顺序排列，不排序（顺序有语义）。
- 源文件里同一行的顺序不影响 IR：IR 里的 `points` 保留折点顺序，其余数组按上面的键排序。
- 缺省值在源文件里**可以不写**（`rot` 缺省 0、`unit` 缺省 1、`sheet` 缺省 A4 横向）；IR 里缺省字段一律省略，所以 `rot=0` 与不写旋转是同一个文件。
