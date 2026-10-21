# `footprint` 描述规范（v0.4，草案）

状态：草案。决策与取舍见 `docs/adr/0011-library-format-and-footprint-ir.md`；跨描述通用的词法、单位、版本、canonical 规则见 `teda.md` §3–§5、§10、§12。

本文件是 `teda.md` 的分描述补充：`.teda` 语言的共用规则在 `teda.md`，`footprint` 这一类描述的具体段定义在这里。

---

## 0. 定位

`footprint` 描述表达**一个封装的规范几何**：焊盘、图形、属性、3D 模型引用。

三条底线（`AGENTS.md` §2、[ADR-0010](../docs/adr/0010-footprint-and-3d-model-ownership.md) decision 1）：

1. **几何不进板描述**。`pcb` 描述里只有 `component.footprint`（`lib:name` 引用），没有焊盘尺寸、没有 3D 尺寸。几何是器件库的事实。
2. **源格式是 `.teda`，IR 是编译产物**。agent 的工作面是 `.teda` 源码 + 校验报告（[ADR-0004](../docs/adr/0004-ir-representation.md) decision 5），不是 IR JSON。
3. **KiCad 格式是导出产物**。`.kicad_mod` 与板文件内联块都由 `packages/exporter` 从 IR 生成；库的几何改动**不回写** IR 之外的东西。

`footprint` 描述是**库产物**，不是板描述：它不进 `dist/ir/` 的描述分片树，而进库目录（`footprints/<lib>/`），单独编译、单独哈希（`libs.<name>.content_hash`，[ADR-0010](../docs/adr/0010-footprint-and-3d-model-ownership.md) decision 2）。

---

## 1. 文件头

```
version 0.4
footprint sot-23-5
```

- 版本行、类型行规则同 `teda.md` §5。`footprint` 类型要求 `version 0.4` 或更高（该类型由 0.4 引入；接受规则见 `teda.md` §13.3）。
- 文件名必须等于类型行里的 id：`footprints/<lib>/<footprint_id>.teda` ↔ `footprint sot-23-5`。
- `footprint_id` 允许 `[A-Za-z0-9_.+-]+`（比 `component_id` 宽：库里的封装名常带大写与下划线，如 `R_0402_1005Metric`）。

---

## 2. 标量

标量在第一个段之前，值为行尾剩余文本（`teda.md` §4.4）。

| 键 | 必填 | 说明 |
|---|---|---|
| `description` | 否 | 自由文本。进 IR 的 `description`。 |
| `tags` | 否 | 空格分隔的标签列表（KiCad 的 `tags` 是一个空格分隔的字符串）。 |
| `attr` | 否 | `smd` / `through_hole` / `virtual` / `board_only`；缺省按焊盘推断（全 `smd` → `smd`）。 |
| `model` | 否 | 3D 模型：`model <path> [offset=x,y,z] [scale=x,y,z] [rot=x,y,z]`。`path` 是项目相对路径。 |
| `field` | 否 | 属性，可重复：`field <Name> [key=value …] <text…>`。可选键：`at`（`x,y`）、`layer`、`hide`（`yes`）、`size`（`w,h`）、`thickness`。`text` 是**行尾剩余文本**（可为空），所以 `key=value` 必须写在值之前。常见 `Reference` / `Value` / `Datasheet`。 |

顺序无关，canonical form 固定为 `description` → `tags` → `attr` → `model` → `field`（按 `Name` 排序）。

---

## 3. 段总表

| 段 | 内容 | 必填 |
|---|---|---|
| `pads` | 焊盘 | 是 |
| `graphics` | 图形（丝印/装配/阻焊/courtyard） | 否 |

---

## 4. `pads` 段

```
pads
  1  smd  roundrect  -0.95  0.95  1.1  0.6  rratio=0.25
  2  smd  roundrect  -0.95  0     1.1  0.6  rratio=0.25
  9  th   circle     0      0     1.6  1.6  drill=1.0
```

固定列：`number type shape x y w h`。

| 列 | 取值 | 单位 |
|---|---|---|
| `number` | 焊盘号，必须与符号引脚编号一致（[ADR-0010](../docs/adr/0010-footprint-and-3d-model-ownership.md) decision 3） | — |
| `type` | `smd` / `th` | — |
| `shape` | `rect` / `roundrect` / `oval` / `circle` | — |
| `x` `y` | 焊盘中心，原点在封装中心，+x 向右、+y 向下 | 长度 |
| `w` `h` | 焊盘尺寸 | 长度 |

可选尾列（`key=value`，顺序任意，多余的键报错）：

| 键 | 说明 |
|---|---|
| `rot` | 焊盘自身旋转（角度） |
| `drill` | 通孔钻孔尺寸（长度）；`type=th` **必填**，缺失报错 |
| `rratio` | `roundrect` 圆角比例，`0`…`0.5` |
| `mask` | 阻焊开窗扩张（长度，可负） |
| `paste` | 锡膏扩张（长度，可负） |
| `zone` | `solid` / `thermal` / `none` |
| `thermal_w` / `thermal_g` | 热焊盘宽度 / 缝隙（长度） |
| `layers` | 覆盖默认层集合（逗号分隔，如 `F.Cu,F.Mask,F.Paste`） |

**默认层集合**：`smd` → `F.Cu,F.Mask,F.Paste`；`th` → `*.Cu,*.Mask`。板底封装由 `packages/exporter` 决定镜像，不在源里写。

---

## 5. `graphics` 段

```
graphics
  rect  F.CrtYd  -1.65,-1.2,1.65,1.2  width=0.05
  line  F.SilkS  -2.1,0.95,-1.6,0.95   width=0.12
  circle F.Fab   0,0,1.0              width=0.1  fill=none
```

固定列：`kind layer geometry`。

| `kind` | `geometry` 单元格 | 说明 |
|---|---|---|
| `line` | `x1,y1,x2,y2` | 直线 |
| `rect` | `x1,y1,x2,y2` | 矩形（对角两点） |
| `circle` | `cx,cy,r` | 圆 |
| `arc` | `x1,y1,xm,ym,x2,y2` | 圆弧（起点、中点、终点） |
| `poly` | `x1,y1,x2,y2,…` | 闭合多边形，点数 ≥ 3 |

可选尾列：`width`（线宽；缺省用层默认）、`fill`（`solid` / `none`，仅 `rect`/`circle`/`poly`）。

单元格内不得有空格；列表用 `,` 分隔（点的列表按 x,y 交替）。

---

## 6. 单位

长度的列类型给出默认单位 **mm**，可显式写 `mm` / `mil` / `in` / `m`（`teda.md` §10.2）。角度默认 **度**，可写 `deg`。

换算只发生在边界：`.teda` 解析进来时换算成 **整数纳米 / 整数毫度**（[ADR-0004](../docs/adr/0004-ir-representation.md) decision 3）；换算结果不是整数时**报错**（"精度超过纳米"），不四舍五入。

---

## 7. 校验规则

除 `teda.md` §11 的通用规则外：

1. `pads` 的 `number` 唯一；`type=th` 必须有 `drill`；`shape=roundrect` 才允许 `rratio`。
2. `graphics` 的 `geometry` 单元格点数与 `kind` 匹配；`poly` 点数 ≥ 3。
3. `field` 的 `Name` 唯一。
4. 编译产物必须通过 `schemas/ir/v0.2/footprint.schema.json`（closed schema）。
5. 库级检查（与符号引脚号比对、DRC）不属于本描述，属工具链（[ADR-0010](../docs/adr/0010-footprint-and-3d-model-ownership.md) decision 3）。
6. 编译产物的顺序只依赖语义，不依赖源文件书写顺序：`pads` 按号自然序、`graphics` 按 `(kind, layer, 坐标)`、`fields` 按 `Name`、`tags` 按字节序。同一封装换个写法编译出的 IR 必须字节相同（这是 `content_hash` 与产物可复现的前提）。

诊断格式：`file:line:col: <severity> <code>: <message>`。

---

## 8. Canonical form

`teda.md` §12 的通用规则之外：

1. 标量顺序：`description` → `tags` → `attr` → `model` → `field`（按 `Name` 排序）。
2. 段顺序：`pads` → `graphics`；段之间一个空行。
3. `pads` 行按 `number` **自然序**（`2` 在 `10` 前）；`graphics` 行按 `(kind, layer, geometry)` 字典序。
4. 布局：
   - 表段（`pads`、`graphics`）按列对齐：同段内按最宽单元格补齐，列间至少两个空格；尾列 `key=value` 也按位置成列对齐。
   - 标量行（含 `field`）是"键 + 值"，不做列对齐：单元格之间（含尾列）**一个**空格。
5. 数值由边界整数反推成列默认单位，**省略单位**：长度 mm（最多 6 位小数）、角度度（最多 3 位）、比例十进制（最多 6 位），去尾零。源里的 `mil` / `in` / `m` 换算成 mm 写出（`10mil` → `0.254`）；显式写 `mm` 也合法，canonical 统一省略——与 `teda.md` §10.2「列类型提供单位时，值可省略单位」一致。
6. 尾列 `key=value` 按键名 ASCII 字节序排序。
7. `tags` 按 ASCII 字节序排序（它是集合，顺序无语义）。
8. `field` 的 `hide=no` 省略（与不写等价）；`hide` 只写肯定形式 `hide=yes`。
9. 注释行跟随其后第一条有效行（跨空行也算）；文件末尾的注释保留在末尾。
10. 不变量：`fmt(fmt(x)) == fmt(x)`，且 `parse(fmt(x))` 与 `parse(x)` 语义相同。**有语义错误的文件不格式化**：工具先按 §7 校验，报错退出（与 gofmt 拒绝语法错误文件一致）。

`fmt` 只重排表面，**不经 IR 回写**：IR 会展开默认层集合、丢掉表面拼写，从 IR 回写会把文件写胖，也做不出最小 diff。

---

## 9. 例子

`examples/reference-project/footprints/project/sot-23-5.teda`（即 canonical form；`bun run fmt:teda --check examples/reference-project/footprints` 退出 0）：

```
version 0.4
footprint sot-23-5

description SOT-23-5 body 2.9x1.6mm pitch 0.95mm (generic land pattern)
tags SOT-23 SOT-23-5
attr smd
field Reference at=0,-2 layer=F.SilkS size=1,1 thickness=0.15 REF**
field Value at=0,2 layer=F.Fab size=1,1 thickness=0.15 SOT-23-5

pads
  1  smd  roundrect  -0.95  0.95    1.1  0.6  rratio=0.25
  2  smd  roundrect  -0.95  0       1.1  0.6  rratio=0.25
  3  smd  roundrect  -0.95  -0.95   1.1  0.6  rratio=0.25
  4  smd  roundrect  0.95   -0.475  1.1  0.6  rratio=0.25
  5  smd  roundrect  0.95   0.475   1.1  0.6  rratio=0.25

graphics
  line  F.SilkS  -2.1,-0.95,-1.6,-0.95  width=0.12
  line  F.SilkS  -2.1,0.95,-1.6,0.95    width=0.12
  rect  F.CrtYd  -1.65,-1.2,1.65,1.2    width=0.05
  rect  F.Fab    -1.45,-0.8,1.45,0.8    width=0.1
```

编译后的 IR（`footprint` kind，节选）：

```json
{
  "ir_version": "0.1",
  "source": { "file": "examples/reference-project/footprints/project/sot-23-5.teda" },
  "footprint": {
    "library": "project",
    "name": "sot-23-5",
    "pads": [
      {
        "number": "1",
        "type": "smd",
        "shape": "roundrect",
        "at": { "x_nm": -950000, "y_nm": 950000 },
        "size": { "x_nm": 1100000, "y_nm": 600000 },
        "layers": ["F.Cu", "F.Mask", "F.Paste"],
        "roundrect_ratio_ppm": 250000
      }
    ]
  }
}
```
