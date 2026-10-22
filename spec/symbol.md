# `symbol` 描述规范（v0.5，草案）

状态：草案。决策与取舍见 `docs/adr/0012-symbol-description.md`；跨描述通用的词法、单位、版本、canonical 规则见 `teda.md` §3–§5、§10、§12。

本文件是 `teda.md` 的分描述补充：`.teda` 语言的共用规则在 `teda.md`，`symbol` 这一类描述的具体段定义在这里。

---

## 0. 定位

`symbol` 描述表达**一个符号的视图**：引脚摆位、外形、单元分组、显示开关。

一条底线（[ADR-0012](../docs/adr/0012-symbol-description.md) decision 2）：

> **引脚的电学事实只有一个所有者：`component`。** `symbol` 不写引脚名、不写引脚号的含义、不写电气类型——它只写这些引脚**画在哪、怎么画**。

因此：

- `symbol` 是**库产物**，与 `footprint` 同级：进库目录（`assets/symbols/<lib>/`），单独编译、单独哈希。
- 导出 `.kicad_sym` 时，**必须**同时给出引用它的 `component`（引脚名/编号/电气类型来自那里）；工具比对两边的引脚号集合，缺一个报错。
- `component.symbol = "<lib>:<name>"` 指向它；这是唯一的绑定处，`symbol` 文件不重复声明。

坐标约定：**+x 向右、+y 向上**（KiCad 符号约定）。这与 `footprint`（+y 向下，PCB 约定）相反，是有意的——两边各自跟随目标格式，导出器不做符号翻转。

---

## 1. 文件头

```
version 0.5
symbol bq24610rger
```

- 版本行、类型行规则同 `teda.md` §5。`symbol` 类型要求 `version 0.5` 或更高（该类型由 0.5 引入；接受规则见 `teda.md` §13.3）。
- 文件名必须等于类型行里的 id：`assets/symbols/<lib>/<symbol_id>.teda` ↔ `symbol bq24610rger`。
- `symbol_id` 允许 `[A-Za-z0-9_.+-]+`。一个符号是**可复用的视图**：`r` / `c` / `nmos-5` 这类通用画法供多个器件共享，所以名字不必等于 `component_id`。绑定只发生在 `component.symbol`。

---

## 2. 标量

标量在第一个段之前，值为行尾剩余文本（`teda.md` §4.4）。

| 键 | 必填 | 说明 |
|---|---|---|
| `description` | 否 | 自由文本。进 IR 的 `description`，导出为 `Description` 属性。 |
| `tags` | 否 | 空格分隔的标签列表。 |
| `units` | 否 | 单元数，正整数，缺省 `1`。多单元器件（双运放等）写 `2`。 |
| `pin_numbers` | 否 | `show` / `hide`，缺省 `show`。 |
| `pin_names` | 否 | `show` / `hide`，缺省 `show`。 |
| `pin_name_offset` | 否 | 引脚名相对**引脚内端**（贴符号体那一头）沿引脚方向向内的偏移，长度，缺省 `0.508`。与 KiCad 的 `(pin_names (offset …))` 同义。 |
| `power` | 否 | `yes` / `no`，缺省 `no`。电源符号（KiCad `(power)`）。 |
| `in_bom` | 否 | `yes` / `no`，缺省 `yes`。 |
| `on_board` | 否 | `yes` / `no`，缺省 `yes`。 |
| `field` | 否 | 属性，可重复：`field <Name> [key=value …] <text…>`。键：`at`（`x,y`）、`hide`（`yes`）、`size`（`w,h`）。常见 `Reference`（值如 `U`）、`Value`（缺省取符号名）。**没有 `layer`**（符号不分层）。 |

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
  1        -12.7  13.97   0
  24       -2.54  19.05   270
  25        2.54 -19.05   90  style=inverted
```

固定列：`number x y rot`。**第一列是引脚号，不是引脚名**（引脚名归 `component`）。

| 列 | 取值 | 单位 |
|---|---|---|
| `number` | 引脚号，必须与 `component` 的引脚编号一致（库级检查） | — |
| `x` `y` | 引脚**连接点**，+y 向上 | 长度 |
| `rot` | 引脚朝向：`0` 向右（左侧引脚）、`180` 向左（右侧）、`90` 向上（下方引脚）、`270` 向下（上方引脚） | 角度 |

可选尾列（`key=value`，顺序任意，多余的键报错）：

| 键 | 说明 |
|---|---|
| `length` | 引脚长度，缺省 `2.54` |
| `unit` | 所属单元，`0`…`units`；`0` 表示所有单元共有，缺省 `1` |
| `style` | 引脚图形：`line`（缺省）/ `inverted` / `clock` / `inverted_clock` / `input_low` / `clock_low` / `output_low` / `edge_clock_high` / `non_logic` |

引脚名与电气类型**不在这里**：导出时从 `component` 的 `pins` 表按编号查。查不到即错误（工具报"符号引脚在器件里不存在"）。

---

## 5. `body` 段

```
body
  rect  -10.16,-16.51,10.16,16.51  width=0.254  fill=background
  line  -8.89,12.7,-8.89,-12.7     width=0.254
  circle 0,0,1.27                  width=0        fill=outline
  poly  0,0,1,1,2,0                width=0.254    unit=0
```

固定列：`kind geometry`（**没有 layer**：符号图形不分层）。

| `kind` | `geometry` 单元格 |
|---|---|
| `line` | `x1,y1,x2,y2` |
| `rect` | `x1,y1,x2,y2`（对角两点） |
| `circle` | `cx,cy,r` |
| `arc` | `x1,y1,xm,ym,x2,y2`（起点、中点、终点） |
| `poly` | `x1,y1,x2,y2,…`（闭合多边形，点数 ≥ 3） |

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
4. 编译产物必须通过 `schemas/ir/v0.2/symbol.schema.json`（closed schema）。
5. 库级检查（与 `component` 的引脚号集合比对、与 `footprint` 的引脚号比对、ERC）不属于本描述，属工具链（[ADR-0010](../docs/adr/0010-footprint-and-3d-model-ownership.md) decision 3）。
6. 编译产物的顺序只依赖语义：`pins` 按 (`unit`, `number` 自然序)、`body` 按 (`kind`, 坐标) 排；`fields` 按 `Name`、`tags` 按字节序。

诊断格式：`file:line:col: <severity> <code>: <message>`。

---

## 8. Canonical form

`teda.md` §12 的通用规则之外：

1. 标量顺序：见 §2。
2. **缺省值不写**：等于缺省的标量与尾列一律省略（`units 1`、`pin_numbers show`、`pin_names show`、`power no`、`in_bom yes`、`on_board yes`、`pin_name_offset 0.508`、`length=2.54`、`unit=1`、`style=line`、`width=0`、`fill=none`）。这样同一份符号只有一种写法，diff 只反映语义变化。
3. 段顺序：`pins` → `body`；段之间一个空行。
4. `pins` 行按 (`unit` 自然序, `number` 自然序)；`body` 行按 (`kind`, `geometry`, `unit`) 字典序。
5. 布局：表段按列对齐，列间至少两个空格；标量行（含 `field`）用单个空格。
6. 数值按列的默认单位写（长度 mm、角度度），省略单位；单位换算成 mm 后写出。
7. 尾列 `key=value` 按键名 ASCII 字节序排序。
8. `tags` 按 ASCII 字节序排序；`field` 的 `hide=no` 省略。
9. 注释行跟随其后第一条有效行。
10. 不变量：`fmt(fmt(x)) == fmt(x)`，`parse(fmt(x))` 与 `parse(x)` 语义相同；有语义错误的文件不格式化。

---

## 9. 例子

`examples/reference-project/symbols/project/bq24610rger.teda`（即 canonical form；`bun run fmt:teda --check examples/reference-project/symbols` 退出 0）：

```
version 0.5
symbol bq24610rger

description 24V synchronous buck battery charger controller
tags battery charger
field Reference at=-6.35,17.78 U
field Value at=0,-21.59 bq24610rger

pins
  1   -12.7  13.97   0
  2   -12.7  11.43   0
  3    12.7   6.35   180
  ...
  25   2.54 -19.05   90

body
  rect  -10.16,-16.51,10.16,16.51  fill=background  width=0.254
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
