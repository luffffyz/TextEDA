# `symbol` 描述规范（草案）

状态：草案。决策与取舍见 `docs/adr/08-libraries/0031-symbol-format.md`；跨描述通用的词法、单位、版本、canonical 规则见 `teda.md` §3–§5、§10、§12。

本文件是 `teda.md` 的分描述补充：`.teda` 语言的共用规则在 `teda.md`，`symbol` 这一类描述的具体段定义在这里。

---

## 0. 定位

`symbol` 描述表达**一个符号的视图**：引脚摆位、外形、单元分组、显示开关。

一条底线（[ADR-0031](../docs/adr/08-libraries/0031-symbol-format.md) decision 2）：

> **引脚的电学事实只有一个所有者：`component`。** `symbol` 不写引脚名、不写引脚号的含义、不写电气类型——它只写这些引脚**画在哪、怎么画**。

因此：

- `symbol` 是**库产物**，与 `footprint` 同级：进库目录（`assets/symbols/<lib>/`），单独编译、单独哈希。
- 导出 `.kicad_sym` 时，**必须**同时给出引用它的 `component`（引脚名/编号/电气类型来自那里）；工具比对两边的引脚号集合，缺一个报错。
- `component.symbol = "<lib>:<name>"` 指向它；这是唯一的绑定处，`symbol` 文件不重复声明。

坐标约定：**+x 向右、+y 向上**（KiCad 符号约定）。这与 `footprint`（+y 向下，PCB 约定）相反，是有意的——两边各自跟随目标格式，导出器不做符号翻转。

---

## 1. 文件头

```
version 0.11.0
symbol bq24610rger
```

- 版本行、类型行规则同 `teda.md` §5。文件写**语言版本**（当前版本见 `teda.md` §12.1）；`symbol` 的 reader 下界是 `0.11`。该类型于 `0.5` 引入，`0.11` 的坐标元组改写要求 reader 拒绝旧表面；接受规则见 `teda.md` §12.3。
- 文件名必须等于类型行里的 id：`assets/symbols/<lib>/<symbol_id>.teda` ↔ `symbol bq24610rger`。
- `symbol_id` 允许 `[A-Za-z0-9_.+-]+`。一个符号是**可复用的视图**：`r` / `c` / `nmos-5` 这类通用画法供多个器件共享，所以名字不必等于 `component_id`。绑定只发生在 `component.symbol`。

---

## 2. 标量

标量在第一个段之前，值为行尾剩余文本（`teda.md` §4.4）。

| 键 | 必填 | 说明 |
|---|---|---|
| `rev` | 否 | 该文件的事实最后确立的那个发布名（[ADR-0034](../docs/adr/08-libraries/0034-trust-in-a-library-you-do-not-own.md)）。不写也能用：只有信任记录需要它 |
| `description` | 否 | 自由文本。进 IR 的 `description`，导出为 `Description` 属性。 |
| `tags` | 否 | 空格分隔的标签列表。 |
| `units` | 否 | 单元数，正整数，缺省 `1`。多单元器件（双运放等）写 `2`。 |
| `pin_numbers` | 否 | `show` / `hide`，缺省 `show`。 |
| `pin_names` | 否 | `show` / `hide`，缺省 `show`。 |
| `pin_name_offset` | 否 | 引脚名相对**引脚内端**（贴符号体那一头）沿引脚方向向内的偏移，长度，缺省 `0.508`。与 KiCad 的 `(pin_names (offset …))` 同义；参考 SVG 渲染器在有可见符号体时按 [ADR-0053](../docs/adr/09-view/0053-pin-name-body-clearance-is-measured-from-symbol-body-bounds.md) 以器件框内侧边缘的 `0.40` 间隙摆放，无可见符号体时仍使用这个偏移；竖直引脚的名与号一起转 `90_000`（[ADR-0054](../docs/adr/09-view/0054-vertical-pin-name-labels-always-rotate-toward-their-pins.md)），两者不会各转各的。
| `power` | 否 | `yes` / `no`，缺省 `no`。电源符号（KiCad `(power)`）。 |
| `in_bom` | 否 | `yes` / `no`，缺省 `yes`。 |
| `on_board` | 否 | `yes` / `no`，缺省 `yes`。 |
| `field` | 否 | 属性，可重复：`field <Name> [key=value …] <text…>`。键：`at`（`[x,y]`）、`hide`（`yes`）、`size`（`[w,h]`）。常见 `Reference`（值如 `U`）、`Value`（缺省取符号名）。**没有 `layer`**（符号不分层）。 |

**`Reference` 与 `Value` 的文本是占位符**：库里的 `U` / `R` / 符号名只说明"这里有个位号""这里有个值"。落到图纸上时由**被放置的实例**填：`Reference` 换成实例 id（`R1`），`Value` 换成该实例的 `value` 列（`10k`、`100nF`；件没有 `value` 列时用它自己的 `mpn`）。其余字段原样画（`spec/schematic-view.md` §9.5 把这两条都算进投影）。

顺序无关，canonical form 固定为 `description` → `tags` → `units` → `pin_numbers` → `pin_names` → `pin_name_offset` → `power` → `in_bom` → `on_board` → `field`（按 `Name` 排序）。

---

## 3. 段总表

| 段 | 内容 | 必填 |
|---|---|---|
| `pins` | 引脚摆位 | 是 |
| `body` | 符号外形（矩形/线/圆/弧/多边形） | 否 |

---

## 4. `pins` 段

```
pins
  1   [-12.5,-11.0]  0
  24  [-1.0,19.0]    270
  25  [1.0,-19.0]    90  style=inverted
```

固定列：`number point rot`，`point` 是 `[x,y]`。**第一列是引脚号，不是引脚名**（引脚名归 `component`）。

| 列 | 取值 | 单位 |
|---|---|---|
| `number` | 引脚号，必须与 `component` 的引脚编号一致（库级检查） | — |
| `point` | 引脚**连接点** `[x,y]`，+y 向上；落在 `0.5 mm` 网格上（见下） | 长度 |
| `rot` | 引脚朝向：`0` 向右（左侧引脚）、`180` 向左（右侧）、`90` 向上（下方引脚）、`270` 向下（上方引脚） | 角度 |

可选尾列（`key=value`，顺序任意，多余的键报错）：

| 键 | 说明 |
|---|---|
| `length` | Pin length, default `2.5` |
| `unit` | 所属单元，`0`…`units`；`0` 表示所有单元共有，缺省 `1` |
| `style` | 引脚图形：`line`（缺省）/ `inverted` / `clock` / `inverted_clock` / `input_low` / `clock_low` / `output_low` / `edge_clock_high` / `non_logic` |

引脚名与电气类型**不在这里**：导出时从 `component` 的 `pins` 表按编号查。查不到即错误（工具报"符号引脚在器件里不存在"）。

### 4.1 引脚摆位网格

**规则**（[ADR-0057](../docs/adr/08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) D1、D4）：引脚**连接点**与它的**内端**（尾端与本体重合的那一点）都是 `0.5 mm` 的整数倍，`length` 因此也是 `0.5 mm` 的整数倍。规则管的是**画的坐标**，不管器件的物理封装：焊盘坐标归 `footprint`，按数据手册取值，即使落不在这个网格上也不动（同一条记录 D6）。

**为什么内端也算**：走线从引脚出发要能接到一个折点。只管连接点会把尾端留在任意偏移上，而尾端是读者在图上唯一看得见的引脚笔画。

**引脚间距**：画引脚号的符号，同一单元、同一侧相邻两脚的连接点沿这一行的距离**至少 `2.5 mm`**（[ADR-0058](../docs/adr/08-libraries/0058-pin-rows-on-a-number-bearing-symbol-are-at-least-two-and-a-half-millimetres-apart.md) D1）。常规取值就是 `2.5 mm`；只有具体理由才放宽——三位数的引脚号（`"100"` 的墨迹宽 `2.824 mm`）需要 `3.0 mm`，`crystal-4` 为给封装的两个极板留位置把 `2`/`4` 画成 `3.0 mm`。

**锚定是逐引脚、两个轴**（[ADR-0058](../docs/adr/08-libraries/0058-pin-rows-on-a-number-bearing-symbol-are-at-least-two-and-a-half-millimetres-apart.md) D2）：每个引脚的连接点在 `x` 与 `y` 上各自都是 `0.5 mm` 的整数倍，内端也是。一行只决定沿行方向的间距；这一行整体沿行方向偏移多少是自由的，垂直方向的坐标另算。两个轴都要锚，因为打印页是**引脚到引脚**连线的：一条正交走线只在两端各自两个坐标都落格时才存在，与它端点来自哪个符号的哪一行无关。于是偶数脚的一侧**不要求**关于 `0` 对称——`-3.5, -1, 1.5, 4` 与 `-2.5, 0, 2.5, 5` 一样合法，对称只是脚数与偏移恰好凑出来的巧合，不是规则。

**不画引脚号的符号没有这个下限**（同一条记录 D4）：`pin_numbers hide` 画的是器件图形，靠得近的脚描述的是同一个端子——`nmos-5` 的三个源极共用一条 `1.5 mm` 的总线，`dual-diode` 的两个阳极相距 `1.0 mm`，`sw-push` 每侧的两个脚是同一个触点（`1.0 mm`，并因此隐藏引脚号：它的号码墨迹在 `1.0 mm` 下已经重叠）。间距归图形，没有号码可撞。

**可见矩形本体**的边是引脚尾端的落点，所以本体坐标也在网格上（[ADR-0057](../docs/adr/08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) D3）；纯装饰花纹（电阻的矩形、电感的四个拱、二极管的三角）保持原样，只让引脚行与尾端进网格。

**连接器的画不是它的焊盘**（[ADR-0057](../docs/adr/08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) D5、[ADR-0058](../docs/adr/08-libraries/0058-pin-rows-on-a-number-bearing-symbol-are-at-least-two-and-a-half-millimetres-apart.md) D5）：`hdr-1x4` / `jst-sh-4` / `hdr-1x3` / `hdr-2x5` 把行画成 `2.5 mm` 间距，真实焊盘间距（`2.54 mm`、`1.0 mm`）写在 `footprint` 里。两个网格回答两个问题，都不许为对齐对方而凑整。

---

## 5. `body` 段

```
body
  rect    [-10.16,-16.51,10.16,16.51]  width=0.254  fill=background
  line    [-8.89,12.7,-8.89,-12.7]     width=0.254
  circle  [0,0,1.27]                   width=0        fill=outline
  poly    [0,0,1,1,2,0]                width=0.254    unit=0
```

固定列：`kind geometry`（**没有 layer**：符号图形不分层）。`geometry` 是**一个** `[…]` 单元格：

| `kind` | `geometry` 单元格 |
|---|---|
| `line` | `[x1,y1,x2,y2]` |
| `rect` | `[x1,y1,x2,y2]`（对角两点） |
| `circle` | `[cx,cy,r]` |
| `arc` | `[x1,y1,xm,ym,x2,y2]`（起点、中点、终点） |
| `poly` | `[x1,y1,x2,y2,…]`（闭合多边形，点数 ≥ 3） |

可选尾列：`width`（线宽，缺省 `0` = 不描边）、`fill`（`none`（缺省）/ `outline` / `background`）、`unit`（同 `pins`）。

`unit=0` 的元素画在所有单元里（KiCad 的 `<name>_0_1`）。

v0.1 不支持：文字标注（极性 `+`/`−`、功能名）、图片、贝塞尔、多段线描边样式。需要时先用 KiCad 手画 `.kicad_sym` 兜底（同 `footprint` 的逃生舱规则）。

---

## 6. 单位

长度列默认 **mm**，可显式写 `mm` / `mil` / `in` / `m`；角度默认 **度**。换算只发生在边界：解析进来时换算成**整数纳米 / 整数毫度**，不是整数时报错（不四舍五入）。

---

## 7. 校验规则

除 `teda.md` §11 的通用规则外：

1. `pins` 的 `number` 唯一（同一 `unit` 内）；`unit` 在 `0`…`units` 内。
2. `body` 的 `geometry` 点数与 `kind` 匹配；`poly` 点数 ≥ 3；`fill` 只适用于 `rect` / `circle` / `poly`。
3. `field` 的 `Name` 唯一；`field` 不接受 `layer`。
4. The compiled shard must pass the closed IR v0.19 contract at `schemas/ir/v0.19/symbol.schema.json`. The shard root includes the required `format` field: the source `.teda` file's declared language version in canonical form (the patch component is omitted when zero; see `teda.md` §12.1).
5. 库级检查（与 `component` 的引脚号集合比对、与 `footprint` 的引脚号比对、ERC）不属于本描述，属工具链（[ADR-0030](../docs/adr/08-libraries/0030-footprint-format-and-geometry.md) decision 7）。
6. 编译产物的顺序只依赖语义：`pins` 按 (`unit`, `number` 自然序)、`body` 按 (`kind`, 坐标) 排；`fields` 按 `Name`、`tags` 按字节序。

诊断格式：`file:line:col: <severity> <code>: <message>`。

---

## 8. Canonical form

`teda.md` §12 的通用规则之外：

1. 标量顺序：见 §2。
2. **缺省值不写**：等于缺省的标量与尾列一律省略（`units 1`、`pin_numbers show`、`pin_names show`、`power no`、`in_bom yes`、`on_board yes`、`pin_name_offset 0.508`、`length=2.5`、`unit=1`、`style=line`、`width=0`、`fill=none`）。这样同一份符号只有一种写法，diff 只反映语义变化。
3. 段顺序：`pins` → `body`；段之间一个空行。
4. `pins` 行按 (`unit` 自然序, `number` 自然序)；`body` 行按 (`kind`, `geometry`, `unit`) 字典序。
5. 布局：表段按列对齐，列间至少两个空格；标量行（含 `field`）用单个空格。引脚连接点 `[x,y]` 与 `body` 的 `geometry` 都是**一个**单元格（`teda.md` §4.3、[ADR-0065](../docs/adr/01-language/0065-a-coordinate-tuple-is-one-cell.md)），按单元格对齐，括号内不写空格；`at=` / `size=` 的值同样带括号。
6. 数值按列的默认单位写（长度 mm、角度度），省略单位；单位换算成 mm 后写出。
7. 尾列 `key=value` 按键名 ASCII 字节序排序。
8. `tags` 按 ASCII 字节序排序；`field` 的 `hide=no` 省略。
9. 注释行跟随其后第一条有效行。
10. 不变量：`fmt(fmt(x)) == fmt(x)`，`parse(fmt(x))` 与 `parse(x)` 语义相同；有语义错误的文件不格式化。

---

## 9. 例子

`examples/reference-project/assets/symbols/power/bq24610rger.teda`（即 canonical form；`bun run packages/parser/scripts/fmt-teda.ts --check examples/reference-project/assets/symbols` 退出 0）：

```
version 0.11.0
symbol bq24610rger

description 24V synchronous buck battery charger controller
tags battery charger
# Pin connection points sit on the 0.5 mm placement lattice (ADR-0057) in both coordinates; same-side rows are
# 2.5 mm apart (ADR-0058) and every tail is 2.5 mm.
pin_name_offset 1.25
field Reference at=[-6.5,20] U
field Value at=[0,-20] bq24610rger

pins
  1   [-12.5,-13.5]  0    length=2.5
  2   [-12.5,-11.0]  0    length=2.5
  3   [12.5,-10.0]   180  length=2.5
  ...
  25  [1.5,-19.0]    90   length=2.5

body
  rect  [-10,-16.5,10,16.5]  fill=background  width=0.25
```

配套的 `component`（`examples/reference-project/components/power/bq24610rger.teda`）提供引脚名与电气类型：

```
pins
  1   ACN     input
  2   ACP     input
  ...
  25  PAD     power
```

导出 `.kicad_sym` 时两边合起来：引脚号与位置来自 `symbol`，名字与电气类型来自 `component`；两边引脚号集合对不上就报错（`symbol` 有、`component` 没有 → 错误；反过来 → 警告，可以是有意隐藏的电源脚）。
