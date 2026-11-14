# `.teda` 格式规范（v0.14，草案）

状态：草案。`AGENTS.md` 记录设计决策与边界，本文件定义具体格式。两者冲突时，以 `AGENTS.md` 的不变量为准，并修本文件。

本文件描述当前提议的**表格式**；`AGENTS.md` §11 第 1 条的“表 vs 链式”仍待十用例验证，可被 ADR 推翻。表内具体列也按同一原则处理。

---

## 0. 一句话

`.teda` 是**一行一事实**的文本格式：文件头声明类型，段（section）放表，表行的列由该段的 schema 解释。

```
version 0.14.0
schematic main

modules
  M1  IDp8x2n4  charger-power
  M2  buck-5v

nets
  GND:   M1.GND  M2.GND
  SYS:   M1.SYS_OUT  M2.SYS_IN
```

---

## 1. 设计约束

1. 一行一个事实；不允许需要读下一行才能理解的结构。**事实层的值是终值字面量，没有表达式、没有控制流**——生成器在语言之外，产物是表（`docs/adr/01-language/0001-fact-layer-has-no-expressions.md`）。
2. 缩进只是排版，**不表达语义**。段由保留字识别，不由缩进识别。
3. 没有隐式类型：每个值由所在列或键的定义解释。
4. 单元格不含空白；自由文本放标量。
5. 未知段、未知键、未知构造默认报错。
6. 存在唯一 canonical form，`fmt(fmt(x)) == fmt(x)`。
7. 可 diff：改动一行不影响其他行的语义。

---

## 2. 文件

| 项 | 规定 |
|---|---|
| 扩展名 | `.teda` |
| 编码 | UTF-8，无 BOM |
| 换行 | LF；读取时接受 CRLF，写出时统一 LF |
| 末尾 | 必须有换行 |
| 大小写 | 敏感 |

十种文件类型：

| 类型 | 位置 | 说明 |
|---|---|---|
| `component` | `assets/components/**/<component_id>.teda` | 器件定义一个文件（`part` 与 `generic` 同在这个目录），可放子目录 |
| `schematic` | `design/sch/main.teda` | **工程的逻辑根**，一个工程恰好一份（0.14 起；类型 id 固定为 `main`） |
| `module` | `design/sch/modules/<module_id>.teda` | 可复用模块：带端口、**持有全部器件事实**（0.8 新增，语法见 `spec/module.md`） |
| `pcb` | `design/pcb/<pcb_id>.teda` | **一块物理 PCB** 的实现描述，可以多份、可后置（0.4 新增，0.14 起声明所属模块实例，语法见 `spec/pcb.md`） |
| `footprint` | `assets/footprints/<family>/<footprint_id>.teda` | 库产物：一个封装的规范几何，目录是**封装族**（0.4 新增；见本节末的分类规则） |
| `symbol` | `assets/symbols/<category>/<symbol_id>.teda` | 库产物：一个符号的视图，目录是**器件类别**（0.5 新增；见本节末的分类规则） |
| `view` | `views/<page_id>.view.teda` | An advisory project print page: the S1 drawing layer（0.6；0.14 起按工程组织，语法见 `spec/schematic-view.md`） |
| `module_view` | `views/modules/<module_id>.module-view.teda` | A reusable, module-local drawing with independent `bounds`（0.13；语法见 `spec/schematic-view.md` §12） |
| `sheet_template` | `views/templates/<template_id>.sheet-template.teda` | Static sheet furniture and its page extent（0.13；语法见 `spec/schematic-view.md` §13） |
| `procurement` | `assets/procurement/{primary,alternatives}/<pcb_id>.teda` | 一块 PCB 的采购选料：通用器件 → 买哪颗（0.9 新增，语法见 `spec/procurement.md`；id 是它所属 PCB 的 `pcb_id`） |

文件名必须等于头部 id；不一致报错。`assets/components/` 允许子目录，子目录只用于分类；`component_id` 取文件名（不含 `.teda`），不取相对路径，同一 id 在 `assets/components/` 树内必须唯一。顶层目录与文件类型必须一致（`assets/components/` 只放 `component`，`design/sch/modules/` 只放 `module`，`design/pcb/` 只放 `pcb`，以此类推）。打印页（`view`）是独立描述类型，放在独立根目录 `views/` 下，文件名为 `<page_id>.view.teda`，靠 `.view` 后缀区分（`view <page_id>`，见 [ADR-0035](../docs/adr/09-view/0035-the-view-layer-is-a-drawing.md)）。`assets/procurement/primary/` 与 `assets/procurement/alternatives/` 只放 `procurement` 文件，两者的区别是**哈希级别**（主料规范、备料附注），不是语法（0.9）。工程树整体按 `docs/adr/03-project/0008-project-tree-has-owners.md`。

**0.14 的根迁移是破坏性的，无兼容路径**：`design/sch/` 下除 `main.teda` 以外的板级原理图、`design/system/*.teda`、`views/<board_id>/` 的板级打印页都不再合法。工程里的电路只有一份真源（逻辑根），板与板之间怎么连只有一条路（根的 `interconnects`）。见到旧构造报 `ref.legacy-board-root` / `ref.legacy-system-description`（error）。

**分类目录**（0.9.2 起，[ADR-0049](../docs/adr/08-libraries/0049-assets-are-filed-by-what-they-are.md)）：三种资产各自按**自己那根轴**分目录，目录名一律是分类、不进 id、不进文件内容；引用写 `<分类>:<id>`，分类就是那个目录名。

- 器件：`assets/components/<category>/<component_id>.teda`，类别是**这粒料是干什么的**（`passives` / `power` / `regulators` / `sensors` / `mcu` / `indicators` / `mechanical` 之类，词表开放、由作者命名）。
- 符号：`assets/symbols/<category>/<symbol_id>.teda`，用**器件那根轴**——一个符号归到它所画器件所在的类别；同一个符号被不同类别的器件共用时，由作者选一个。
- 封装：`assets/footprints/<family>/<footprint_id>.teda`，用**封装自己那根轴**：封装族（`chip` / `sot` / `soic` / `lqfp` / `vqfn` / `crystal` / `inductor` / `tantalum` / `sma` / `switch` 之类，词表开放）。封装是物理事实，按"它是个什么封装"分，不按它装的是什么器件分。

分类目录**只分一层**（`assets/symbols/<category>/<id>.teda`，不再往下）。IR 里 `symbol.library` / `footprint.library` 存的就是这个目录名（`<category>:<id>` / `<family>:<id>`），KiCad 导出时它同时充当库名——一个分类目录对应一个 `.kicad_sym` / `.pretty` 库。缺少分类目录的文件报 `syntax.*`（与顶层目录不一致同一条规则）。

---

## 3. 行类型

解析器逐行分类，只有八种：

| 类型 | 形态 | 说明 |
|---|---|---|
| 空行 | 仅空白 | 忽略 |
| 注释 | `#` 为第一个非空白字符 | 整行忽略；0.1 起不支持行尾注释 |
| 版本行 | `version <ver>` | 必须是最前面的有效行 |
| 类型行 | `<file_type> <id>` | 必须在版本行之后 |
| 段头 | 单独一个保留字，如 `modules` | 由保留字集合识别，不靠缩进 |
| 标量 | `key value...` | 只能出现在第一个段之前 |
| 行 | ≥2 个空白分隔的单元格 | 属于当前段 |

关键规则：

- **段头是“单个保留字”**。`modules` 单独一行是段头；`modules x` 是行或错误，取决于当前段。
- **缩进无语义**。`  M1 charger-power` 与 `M1 charger-power` 等价；缩进只为阅读。
- **标量只在第一个段之前**。进入段之后，所有非段头、非空、非注释行都按行解析。
- **注释只整行**。`#` 出现在值或单元格中间时是普通字符（避免截断 URL 片段）。
- **`:` 只用于 net 成员行**。`name: member...` 表示“名字 → 成员列表”；其余段是固定列元组，不加冒号。
- **冒号与续行同域**。只有“名字 + 不定长列表”的 `nets` 行既用冒号界定名字与列表的边界，又可能长到一行放不下，所以也只有它们支持续行：首列是裸 `:` 的行延续上一行命名的 net。其余段要么列数固定（`modules`、`ports`、`constraints`、`interconnects`、`interconnect_pins`），要么是不定长的一串**元组单元格**（`trace`、`zone`、`keepout`、`outline`，每个点是一格），都不需要续行。

---

## 4. 词法

### 4.1 空白

空格或制表符；连续空白视为一个分隔符。行首行尾空白忽略。段内行的缩进不参与解析。

### 4.2 标识符

| 名称 | 规则 | 示例 |
|---|---|---|
| `component_id` / `module_id` / `pcb_id` / `page_id` / `interconnect_id` | `[a-z][a-z0-9-]*` | `tps7a02`, `buck-5v`, `main-stack`, `pwr-l2` |
| 器件引用（`component_id` 出现处） | `[a-z][a-z0-9-]*` | `tps7a02`（`<lib>:<id>` 已撤销，见 §12.4） |
| `module_instance_id` | `M` + 数字，`^M[0-9]+$` | `M1`, `M2`, `M10`（保留形状，见 §7.1） |
| `refdes` | `[A-Z]+[0-9]+` | `U1`, `R10`, `LED1`（板级根不再有实例，refdes 只出现在模块内与 pcb 引用里） |
| `port_id` | 同 `net_id` | `SYS_OUT`, `VIN_IN` |
| `net_id` | `[A-Za-z0-9_+-]+(\.[A-Za-z0-9_+-]+)*` | `VBUS`, `USB_DP`, `i2c0.scl` |
| 引脚名 | `[A-Za-z0-9_+-]+` | `PA0`, `VREF+`, `OSC_IN` |
| 键 / 段名 | `[a-z][a-z0-9_]*` | `mpn`, `physical_only` |

### 4.3 单元格

单元格是不含空白的连续字符。0.1 **不支持引号、转义、跨行单元格**。需要空格的自由文本（厂商名、描述）只能写在标量里。

**坐标元组是一个单元格**（0.11 起，[ADR-0065](../docs/adr/01-language/0065-a-coordinate-tuple-is-one-cell.md) D1）。一个几何量——点、尺寸、偏移——写成不带空白的 `[a,b]` / `[a,b,c]`，括号内不允许空白；元数由消费它的那一列固定，**不从行内数出来**。

| 形态 | 写法 | 例 |
|---|---|---|
| 点 | `[x,y]` | `M1.U1  [140.0,105.0]  0` |
| 尺寸 | `[w,h]` | `1  smd  roundrect  [-0.95,0.95]  [1.1,0.6]` |
| 偏移 | `[x,y,z]` | `model body.step offset=[0,0,1.5]` |

**单值是单值，不加括号**：一个长度、一个角度、一个比例仍是普通单元格（`0.25`、`90`、`25%`），`[0.25]` 不是元组。

一串点就是**一串元组单元格**：`outline` 的顶点、`trace` 的折点、`zone`/`keepout` 的环、`wire` 的折点、`poly`/`arc` 的图形、`pads` 的位置与尺寸都是每点一格。run 里有多少格就有多少点——"成对坐标"不再是诊断（旧的 `value.invalid-value: coordinates must come in pairs` 不再出现在这些段）。

`key=value` 里的元组保留键、值加括号：`at=[-6.5,20]`、`size=[1,1]`、`offset=[0,0,1.5]`。

元组**整体失败**：括号缺失、元数不符、括号内有空白都只在元组那一列报一条诊断，文案给出期望的元数与形态（`[10.0]` 需要点 → "a point is `[x,y]`"）。元组内部各分量保留自己的列偏移，所以"某个坐标不在 `0.01 mm` 分辨率上""某点越出图幅"仍指向那个分量，而对齐与"一个几何量"仍以单元格为单位。

规则适用于**所有描述类型**（`view` / `pcb` / `symbol` / `footprint`），列见各分描述规范；这是 [ADR-0065](../docs/adr/01-language/0065-a-coordinate-tuple-is-one-cell.md) D3 的表。

### 4.4 标量值

标量的值是**行尾剩余文本**，允许空格，两端去空白。例如：

```
manufacturer Texas Instruments
description USB hub with 2 downstream ports
```

`#` 在值中间是普通字符；只有行首 `#` 才是注释。

### 4.5 引用

| 形式 | 含义 |
|---|---|
| `M1.PA0` | 模块实例 + 模块内 refdes + 引脚名（名称不唯一时改用编号） |
| `M1.R1.2` | 模块实例 + 模块内 refdes + 引脚编号 |
| `M1.2.OUT` | 多单元器件：模块实例 + 模块内 refdes + unit + 引脚名 |
| `M1.SYS_OUT` | 模块实例端口（net 成员、interconnect 端点） |
| `M1.VOUT` | net 名（模块内 net 展平后的限定名） |

解析顺序：先按名称匹配；名称不存在则按编号；两者都命中不同引脚时报“歧义”，要求改用编号。

**匹配到多个引脚就是歧义，不取第一个**：`M1.OUT` 在双运放上命中单元 1 与单元 2 的 `OUT`，报 `ref.ambiguous-pin`，提示写 `M1.1.OUT`；同一单元内重名的引脚（两个 `GND`）同样报歧义，提示改用编号。静默取第一个会把线接到错误的单元上，而图上看不出区别。

### 4.6 数字与单位

数字为十进制，可带前缀与单位。单位由列类型提供时可以省略。详见 §9.2。

---

## 5. 文件头与版本

```
version 0.14.0
schematic main
```

- 版本行必须是第一条有效行；类型行必须是第二条。
- 版本行写的是**语言版本**：全语言一个号，每个 `.teda` 文件都写同一个（当前号见 §12.1）。版本号的形式与各位的含义见 §12；接受规则见 §12.3。PATCH 位不参与判定。遇到更高版本默认报错；放宽要显式开关（见 [ADR-0005](../docs/adr/02-ir/0005-ir-representation.md) 的前向兼容约定）。
- 类型行与目录必须一致。`schematic` 的 id 固定为 `main`：逻辑根一个工程只有一份，写别的 id 报错。
- 头部 id 与文件名必须一致（`design/sch/main.teda` ↔ `schematic main`）。

---

## 6. `component` 文件

器件文件构成工程的**器件库**，而库是工程内容的一部分（它进 IR 分片、进工程哈希，[ADR-0006](../docs/adr/02-ir/0006-ir-shards-and-hashes.md)）。所以一个器件文件可以暂时没人用（为还没画的改版备料），但**没人用要被说出来**：既没有被任何模块的 `instances` 放置、也没有采购文件选中的器件报 `library.device-unused`（warning）——否则库会在多个作者之间无声地膨胀。

**器件不直接属于任何板**：器件文件只描述"这颗料是什么"，不带位置、不带网络、不带板归属。放置与归属是模块定义与模块实例的事（§7.1、`spec/module.md`）；这是 0.14 根迁移的一部分——以前 `design/sch/<board_id>.teda` 可以直接放器件（旧 §7.1 的 `instances` 段），现在所有器件事实都在 `design/sch/modules/<module_id>.teda` 里（[ADR-0069](../docs/adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D1）。

### 6.1 标量（段之前）

| 键 | 必填 | 说明 |
|---|---|---|
| `rev` | 否 | 该文件的事实最后确立的那个发布名（tag 或 commit，不是分支、不是格式 `version`、不是库整体版本）。信任记录按它逐字匹配；副本事实偏离来源时写 `<rev>+local.N`（[ADR-0034](../docs/adr/08-libraries/0034-trust-in-a-library-you-do-not-own.md) D6） |
| `kind` | 是 | `part`（具体器件）或 `generic`（通用器件）；见 §6.1.1 |
| `mpn` | 条件 | 制造商料号：`kind: part` 必填，`kind: generic` **必须不写** |
| `construction` | 条件 | 构造工艺：`kind: generic` 必填，`kind: part` **必须不写** |
| `polarized` | 条件 | 是否有极性：`kind: generic` 必填（`yes` / `no`），`kind: part` **必须不写** |
| `manufacturer` | 否 | 厂商 |
| `category` | 否 | 器件类别，开放取值集：`mcu` / `resistor` / `capacitor` / `inductor` / `led` / `diode` / `mosfet_p` / `regulator` / `battery_charger` / … |
| `datasheet` | 否 | URL |
| `lcsc` | 否 | 嘉立创商城料号（`C` + 数字），供 BOM 匹配 SMT 物料；见 `docs/adr/06-manufacturing/0022-jlc-prototype-delivery.md` |
| `description` | 否 | 一行人类描述（如 `SOT-23-5 500 mA LDO`）。只是散文：不参与任何检查，也不进身份（[ADR-0007](../docs/adr/02-ir/0007-device-description-enters-the-ir.md)） |
| `symbol` | 是 | `lib:name` |
| `footprint` | 是 | `lib:name` |
| `provenance` | 否 | `generated`（从模板/数据手册抄来、没人核对过）或 `reviewed`（有人对照数据手册核过，必须同时写 `verified_by` 与 `verified_on`）；省略 = 未声明。导入的器件写 `generated`，人核过之后**就地**改成 `reviewed`（[ADR-0034](../docs/adr/08-libraries/0034-trust-in-a-library-you-do-not-own.md) D5） |
| `verified_by` | 条件 | `provenance reviewed` 必填：核对人（自由文本，一个名字或账号） |
| `verified_on` | 条件 | `provenance reviewed` 必填：核对日期 `YYYY-MM-DD` |

`provenance` 是**声明**不是证明：没有签名、没有 strict mode（[ADR-0033](../docs/adr/08-libraries/0033-libraries-are-unverified-facts.md) D1）。校验只管形状——`reviewed` 缺归属是错误（`value.provenance-invalid`），因为不可归属的声明比没有声明更糟。

`category` 是**器件类别**，取值是**开放集合**：不设封闭目录，库里没有的类别直接用，小写加下划线。它只做分类，不参与校验逻辑分支；与文件头的类型（`component` / `schematic` / `pcb`）无关。

**封装名不在器件文件里**。器件只引用一个 `footprint`（`lib:name`），封装代号由封装文件自己写（`package_code`，见 `spec/footprint.md` §2）：封装代号是**焊盘图案**的名字（`0402`、`SOT-23-5`、`LQFP-100`），两个字段说同一件事、且没人校验它们一致，所以删掉一个（决策见 [ADR-0028](../docs/adr/07-devices/0028-package-code-and-3d-models.md) decision 1）。

### 6.1.1 两种器件：`part` 与 `generic`

`component` 描述类型同时描述两种不同的东西，用 `kind` 显式区分，**从不推断**（决策见 [ADR-0024](../docs/adr/07-devices/0024-the-device-kind-is-part-or-generic.md) D1；词汇与目录见 [ADR-0024](../docs/adr/07-devices/0024-the-device-kind-is-part-or-generic.md) D6、D7）：

| `kind` | 身份 | `mpn` | `params` | 典型 `instances` 行（在 `module` 文件里） |
|---|---|---|---|---|
| `part` | 一个制造商料号 | **必填** | 不写（身份封闭） | `U1 tps5430ddar` |
| `generic` | 一个通用器件类别（类别 + 构造 + 封装） | **禁止** | 至少一列必填的 `value` | `C1 cap-tantalum-7343 220uF 10V` |

- `part` 是**买得到的那一颗**：料号固定了它的一切，所以它没有参数列，也不写构造与极性（那是从它所属的通用器件继承的）。
- `generic` 是**设计要求的规格**：文件里没有料号，值、耐压、容差都在 `instances` 行里；`construction`（`mlcc` / `film` / `tantalum` / `electrolytic` / `thick` / `thin` / `shielded` / `molded`，**封闭取值集**，由 `texteda check` 按 [ADR-0025](../docs/adr/07-devices/0025-device-vocabulary-and-parameter-roles.md) D4 检查）与 `polarized`（`yes` / `no`）是它自己的事实，不再靠文件名或符号选择暗示。买哪一颗由采购层决定（`spec/procurement.md`），不在器件文件里。**封闭的理由**：已经有一条**已决的规则**按构造分流（[ADR-0028](../docs/adr/07-devices/0028-package-code-and-3d-models.md) decision 2 用它区分"能不能带封装包络"，检查落在 `lib:verify`，**实现未落地**，见 `docs/backlog.md` F32），开放词表里的拼错不会报错，只会**静默漏掉一条安全检查**。
- 两种器件**同在一个目录**：`assets/components/**` 放全部器件文件，子目录只用于分类。`kind` 是文件里的事实，**不从目录推断**，目录也不表达种类（决策见 [ADR-0024](../docs/adr/07-devices/0024-the-device-kind-is-part-or-generic.md)）。两者共用一个 id 命名空间，id 取文件名。
- 通用器件的 id 不带值、不带耐压、不带容差（`cap-mlcc-0402`、`res-thick-0402`、`cap-tantalum-7343`）。

**引脚表是身份边界**：改了引脚表就是另一个器件。只有不改变引脚电气行为的属性才可以成为 `params`（值、耐压、容差、ESR、温度等级）。因此 `footprint` 是器件的固定属性，永远不是参数列；封装代号同理（它由封装文件写，不由器件写）。

### 6.2 `params` 段

声明该器件在 `instances` 行里允许的额外列：

```
params
  value      resistance  required
  power      power       optional
  tolerance  percent     optional
```

列：`name type required|optional`。

- **`name` 是角色**（这个参数是哪个量、哪个额定值），**`type` 是量纲**（单位，以及它在 IR 里的整数表示，见 [ADR-0006](../docs/adr/02-ir/0006-ir-shards-and-hashes.md) decision 7）。所以电感写 `value inductance required`，不写 `inductance value required`：`value` 不是量纲，它是"主量的标称值"这个角色。这个不对称在契约里已经是这样——IR 给 `param_decl.name` 的模式是 `^[a-z][a-z0-9_]*$`（开放标签），给 `param_decl.type` 的是封闭的量纲枚举。
- 角色名一律小写加下划线。**数据手册的符号不进语言**：`I_sat` 是某家的记法（Vishay 写 `Isat`、TDK 写 `I_sat`），把语言绑到一家的记法上，而且违反上面那条模式。角色写 `sat_current`，长形式与判据写进角色词表（决策见 [ADR-0025](../docs/adr/07-devices/0025-device-vocabulary-and-parameter-roles.md) D2）。
- `required` 必须排在 `optional` 之前，因此 `instances` 行只需从右往左省略 optional 列。

类型：`resistance`、`capacitance`、`inductance`、`voltage`、`current`、`power`、`frequency`、`length`、`temperature`、`percent`、`integer`、`string`。

- `kind: part` **不写** `params` 段：料号已经定死身份，再有参数列就是两处身份。
- `kind: generic` **必须**写 `params` 段，且至少有一列必填的 `value`（通用器件之间的区别就是值）。
- 参数列不得叫 `package` 或 `footprint`：封装与焊盘图案是固定属性（§6.1.1、§6.1），不随取值变化。
- 参数不得改变引脚表（§6.1.1）。

#### 6.2.1 角色词表

角色是**哪个额定值**，类型是**量纲**。同一个量纲有多个额定值时，角色名必须指明是哪一个；**判据写在这里，不写进类型词表**——类型词表是纯单位表（[ADR-0006](../docs/adr/02-ir/0006-ir-shards-and-hashes.md)），而件（`kind: part`）在 IR 里根本没有额定值，IR 里只有要求，所以"要求方"与"读数据手册的人"对齐判据是人和 agent 的事，不是两台机器的事（决策见 [ADR-0025](../docs/adr/07-devices/0025-device-vocabulary-and-parameter-roles.md) D3）。

| 角色 | 量纲 | 含义与判据 |
|---|---|---|
| `value` | 主量的量纲 | 主量的标称值（容值 / 阻值 / 电感量） |
| `tolerance` | `percent` | **设计允许的偏差上限**（不是件的容差）：`±1%` = 任何落在 ±1% 内的件都合格，**更好的件（±0.5%）也合格**，更差的（±2%）不合格 |
| `voltage` | `voltage` | 耐压：能承受的最高电压 |
| `power` | `power` | 功率额定值：能长期耗散的最大功率（**热限**）。电阻的这一项由封装决定，所以它在 `thick` / `thin` 里是选填 |
| `dielectric` | `string` | MLCC 的温度特性码（IEC 60068-4）：`C0G` / `NP0` / `X7R` / `X5R` / `Y5V` …，**封闭取值集** |
| `esr` | `resistance` | 直流等效串联电阻 |
| `dcr` | `resistance` | 直流电阻 |
| `rated_current` | `current` | 额定电流：可长期连续流过的 RMS 电流（**热限**） |
| `sat_current` | `current` | 饱和电流：电感量跌到标称 30% 时的电流（**磁限**，数据手册惯例） |

`rated_current` 与 `sat_current` 是两种不同的限制，彼此不相关（额定 6A / 饱和 3A 是常见件，磁限通常先到），所以是两个角色。

**角色带一个比较方向**：`instances` 行写的是**要求**（见 §6.2.2），选料时拿来和件自己的额定值比。方向决定"哪一边更好"，也决定**更好的件永远合格**：

| 角色 | 件必须 | 方向 |
|---|---|---|
| `value` | 落在设计给的包络内：件自己的最坏值（标称 ± 件自己的容差）必须在 `value ± tolerance` 之内 | 包络 |
| `tolerance` | ≤ 设计给的容差 | 上限（更小更好） |
| `voltage` | ≥ 设计给的耐压 | 下限（越大越好） |
| `power` | ≥ 设计给的功率额定值 | 下限（越大越好） |
| `dielectric` | 与设计给的同一类别 | 相等（类别之间无序：X7R 温度特性比 X5R 好，直流偏压又更差，没有"至少"这一说） |
| `esr` `dcr` | ≤ 设计给的上限 | 上限（更小更好） |
| `rated_current` `sat_current` | ≥ 设计给的下限 | 下限（更大更好） |

所以 `R1 10k ±1%` 允许买 ±0.5% 的件（更好，合格），不允许买 ±2% 的件（更差，超出设计给的包络）。**写容差不挡替代料，挡替代料的是"把值当事实写死"。** 比较用的件额定值从哪来已经定了：件在自己的文件里用 `ratings` 段写（[ADR-0026](../docs/adr/07-devices/0026-a-part-states-its-own-ratings.md)，§6.4）。

**封闭取值集**：成员就是唯一合法拼写，**不归一化、不收别名**——同一个码的两种写法会变成两行 BOM。取值不在集合里 → 源码侧报错并列出合法值（决策见 [ADR-0025](../docs/adr/07-devices/0025-device-vocabulary-and-parameter-roles.md) D5）。

#### 6.2.2 哪些参数必填

> **必填 = 少了它这组要求就不完整**：一个 `construction` 的必填集合，就是采购时必须写清的那几项（`100nF ±10% 16V X7R`、`10k ±1%`、`10uH ±20% 3A`）。
> **选填 = 在这一类里挑件用的额外信息**（ESR、DCR），**或者封装已经替你决定了**（电阻的功率额定值）。

| `construction` | 必填 | 选填 |
|---|---|---|
| `mlcc` | `value` `tolerance` `voltage` `dielectric` | — |
| `film` | `value` `tolerance` `voltage` | `esr` |
| `tantalum` | `value` `tolerance` `voltage` | `esr` |
| `electrolytic` | `value` `tolerance` `voltage` | `esr` |
| `thick` `thin` | `value` `tolerance` | `power` |
| `shielded` `molded` | `value` `tolerance` `rated_current` | `sat_current` `dcr` |

理由：

- **`instances` 行写的是要求集，不是件**：每一列都是对"将来买到的件"的要求（标称值、允许的偏差、耐压下限、介质类别），不是数据手册的抄写。件满足全部要求就合格，**更好的件也合格**——`R1 10k ±1%` 意为"任何落在 ±1% 内的 10k"，1% 缺货时可以买 ±0.5%，±2% 的不行。**写容差不挡替代料；把值当"事实"写死才挡。** 采购在这组要求里选件，设计只说要求（[ADR-0029](../docs/adr/07-devices/0029-the-procurement-layer.md)）。
- **容差必填 = 不给采购自由发挥**：不写容差，等于授权采购在这一类里随便挑；写了，它就在设计给定的包络里挑。必填集合因此是**一组完整要求**（`100nF ±10% 16V X7R`），不是半份。
- **容差同时就是最坏情况**：`10k ±1%` 是区间 [9.9kΩ, 10.1kΩ]。评估器要在这段区间上判约束，而不是在标称值上判——设计保证"凡是它允许的件，电路都对"。**限制采购的那个数，就是分析必须扛住的那个数**：一个数，两个用途（评估器是 [ADR-0025](../docs/adr/07-devices/0025-device-vocabulary-and-parameter-roles.md) 的 open point 与 `docs/backlog.md` F42 的事）。
- 钽电容与电解电容的罐体随耐压变（[ADR-0028](../docs/adr/07-devices/0028-package-code-and-3d-models.md) 自己就是拿这条拒绝它们带封装包络的），所以耐压是要求的一部分。
- 电阻的功率额定值由封装决定（0402 厚膜惯例 1/16W），但**三件事要分开**：件自己的额定值写在件的 `ratings` 段里（它是件的事实）；设计需要的**最低功率能力**写在实例行的 `power` 参数里（它是采购要求，见 [ADR-0026](../docs/adr/07-devices/0026-a-part-states-its-own-ratings.md) D1）；设计的**耗散上限**是**约束**（`power M1.R1.1 63mW`）。三者在 `texteda check` 里会合：阻性器件的做最坏耗散 `ΔV²/R` 同时比这三条边界（[ADR-0026](../docs/adr/07-devices/0026-a-part-states-its-own-ratings.md) D11、§7.3）。**封装惯例不在语言里，在工具的器件表里**（[ADR-0027](../docs/adr/07-devices/0027-the-package-gives-a-chip-resistor-its-floor.md)）：片式电阻的功率底线按 `(construction, package_code)` 查表（0402 = 62.5mW、0603 = 100mW……），而厚膜是同一封装的最低档，所以这张表给的是**底线**而不是猜测买了哪颗件——超过底线意味着这个封装的任何标准件都扛不住（确定的违规），不超过不证明通过了（高功率档的件确实存在，要它就把要求写出来）。底线**只在没有任何声明时**生效：设计的耗散上限、行的 `power` 要求、件的 `power` 额定值，哪一个说了话，就按它比。
- `sat_current` 是角色（§6.2.1），但**选填**：它要不要写取决于设计有没有峰值电流；"峰值电流会不会让磁饱和"是**比对**，那是 `docs/backlog.md` F42 的事。

**必填只保证"写出来了"**：解析器强制 `instances` 行给齐每个必填列，所以规格写在源码里。**写出来**与**验证**是两件事（决策见 [ADR-0025](../docs/adr/07-devices/0025-device-vocabulary-and-parameter-roles.md) D6）：现在有**两样**东西拿事实去比要求——采购层拿选中的件自己的 `ratings` 逐角色比这组要求（`spec/procurement.md` §3.3），检查器拿两引脚器件的耐压与耗散去比它两个 net 的声明窗口（§7.3）。**还没有**的是在**容差区间**上判约束的评估器：容差不参与比较（器件互相独立，语言还无法声明相关性），所以"这段容差里每个可能的件都满足约束"这句话今天没人说（`docs/backlog.md` F42）。

上表与检查落在 `packages/core` 的器件规则表里（[ADR-0025](../docs/adr/07-devices/0025-device-vocabulary-and-parameter-roles.md) D7），由 `texteda check` 执行。

### 6.3 `pins` 段

```
pins
  1  IN   power_in
  2  GND  power
  3  EN   input
  4  NC   no_connect
  5  OUT  power_out
```

列：`number name type [unit=<n>] [alt=<name>]`。

- 编号全局唯一。
- 名称可以重复（两个地脚都叫 `GND` 没问题），但同一 `unit` 内的 `alt` 名称不得与别的引脚名撞车；默认 `unit=1`。
- 引脚类型见 §9.1。
- `pins` 对指向**自建符号**的器件是**必填**：自建 `symbol` 只描述视图，不带引脚名与电气类型（[ADR-0031](../docs/adr/08-libraries/0031-symbol-format.md)），事实只能内联。
- 可以省略的唯一情形：`symbol` 指向**自带引脚事实**的第三方库（如 KiCad `.kicad_sym`），此时引脚由库解析、`pins_source = symbol`。自建符号不能成为这个来源。
- 两种来源同时存在时**内联优先**（用于修正库里的错误）；差异由校验报告输出，不静默采用。

### 6.4 `ratings` 段（`kind: part`）

```
ratings
  tolerance  percent  2%
  voltage    voltage  36V
```

列：`role type value`。

`ratings` 段是**事实段**（和 `pins` 一样）：它写这颗**具体的件**自己有什么额定值。与 `params` 段的分工是硬的：

| | `params` | `ratings` |
|---|---|---|
| 是谁的 | 设计的 | 件的 |
| 是什么 | `instances` 行要填的列 | 这颗件自己的取值 |
| 谁填 | 模块定义（每个实例一份） | 件文件（每个额定值一份） |
| 允许的 `kind` | 只有 `generic` | 只有 `part` |

- 角色名取 §6.2.1 的封闭角色词表；`type` 必须是该角色的量纲（`value` 除外：件的量纲由这一行自己写，因为件不声明 `construction`）。
- 取值按该量纲解析；`dielectric` 这类封闭取值集照样只认集合里的写法。
- **一个额定值是一个数，不是一个区间**：能承受的最高电压、长期可过的电流、标称值周围的容差。区间是**要求**（`voltage SYS 9V..19.8V`），由设计写在网的约束里。
- 通用器件不得写 `ratings`（它是一个类，类自己没有额定值；它的要求在 `instances` 行里）；`kind: part` 不得写 `params`（参数列是 `instances` 行填的，件没有实例行可填）——两条都报错。
- `ratings` 不改器件身份：引脚表不变、`mpn` 不变的还是同一颗件。

件被选去填一条通用件的行时，逐角色按方向比（§6.2.1、`spec/procurement.md` §3.3）：**更好的件永远合格**。

---

## 7. `schematic` 文件：工程的逻辑根

### 7.1 `modules` 段

**一个工程的电路 = 一个根文件 + 若干模块定义。** 根文件 `design/sch/main.teda` 组合模块实例、给出项目级 net 与端口；模块体在 `design/sch/modules/<module_id>.teda`，**持有全部器件事实**（`instances` / `nets` / `constraints`，语法见 `spec/module.md`），决策见 `docs/adr/04-schematic/0013-modules-compose-boards.md` 与 [ADR-0069](../docs/adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md)。

```
modules
  M1  IDp8x2n4  charger-power
  M2  IDk2m8q4  buck-5v
```

列：`<module_instance_id> [uid] <module_id>`。

- `<module_instance_id>` 形状 `^M[0-9]+$`（`M1`、`M2`…；层级标记 `M`，[ADR-0012](../docs/adr/04-schematic/0012-one-flat-schematic-per-board.md)）。这个形状是保留形状，根文件不再有其他实例命名空间与它撞（旧规则"板级 refdes 不得占用 M+数字"随板级实例一起退役）。
- `uid` 是模块实例的**稳定身份**（§7.1 通用 UID 规则：`ID` + 6 个 Crockford Base32 小写字符；决策见 [ADR-0010](../docs/adr/03-project/0010-instance-identity-is-a-uid.md)）。展平后的实例 UID 是 `<模块实例 UID>/<本地 UID>`（如 `IDp8x2n4/IDk2m8q4`），本地 UID 可以在不同模块实例里重复。
- `<module_id>` 必须有 `design/sch/modules/<module_id>.teda`（否则 `ref.unknown-module`）；同一模块定义可被多次实例化（`M1`、`M2` 都指 `buck-5v`），展平后是两份电气相同的拷贝。
- 根文件**没有** `instances` 段：器件不直接放在根里，所有器件都在某个模块定义里（[ADR-0069](../docs/adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D1）。写了 `instances` 段报 `syntax.unknown-section`（error）。
- **每个模块实例整只属于恰好一块物理 PCB**；归属写在 PCB 文件的 `modules` 段里（`spec/pcb.md` §4.1），根不写归属。可复用定义可以实例化到不同 PCB（`buck-5v` 同时上 `pwr-l1` 与 `pwr-l2`），但**一个实例**只能被一块 PCB 拥有；跨板的功能拆成两个模块实例 + 一条显式 `interconnects` 行（§7.5）。归属与物理连通性的全局校验在 core（`spec/pcb.md` §5.2），不在 parser。

### 7.2 `nets` 段

根的 `nets` 是**项目逻辑成员表**：它只声明哪些模块端口（以及经端口暴露的模块内 net）属于同一个项目级节点。它不碰器件引脚——根文件里没有器件。

```
nets
  GND:   M1.GND  M2.GND
  SYS:   M1.SYS_OUT  M2.SYS_IN
  VIN:   M1.DC_IN
```

- 首个单元格是 net 名，可带尾随 `:`；`:` 单独成格也接受。canonical form 写成 `name:`，成员之间至少两个空格。
- 其余单元格是**模块端口引用**（`M1.SYS_OUT`）；模块内部引脚（`M1.U1.VIN`）不可直接出现在根 net 里——模块外的世界只见端口（`ref.module-internal-ref`，error）。**例外**：模块实例的裸限定 net 名不是成员形式——展平后模块内 net 以 `M1.VCC` 的限定名出现在 IR，但根源文件不写它；根源只写端口引用。
- **续行**：首个单元格是**裸 `:`** 的行，是上一 net 行的延续——它给上一行命名的 net 增加成员。续行的标志是显式的符号，不是缩进（§3：缩进不表达任何含义）；续行成员与首行成员对齐到同一列。
- 续行必须跟在某个 net 行之后，否则报错（`net.continuation-without-net`）。连续多行续行都归属同一个 net。
- **同名 net 行可重复出现并合并成员**：`nets` 段的同名行合并成一个 net。同一个模块端口只有在**同一个** net 的成员列表里重复出现才算错误（`net.duplicate-member`，error）；同一端口被并进两条 net 报 `net.port-in-two-nets`（error，§10 规则 8）。
- **单成员的 net 合法**（例如上例 `VIN:`）：它是"这个项目级节点目前只有一个口"，通常是留给 interconnect 端点或将来分支的。端口引用指向 `no_connect` 端口报 `ref.no-connect-port`（error）。
- **net 名在根级唯一**；模块内部的 net 名是模块自己的命名空间（`spec/module.md` §2），展平后带 `M` 限定名。撞名由作者改名解决（工具不限定名、不重编号）。
- 根 net **不隐含任何跨板铜连接**（§7.5、`spec/pcb.md` §0）：两个端口写进同一个根 net，说的是"逻辑上是同一个节点"，不是"铜从这块板连到那块板"。同名的两个根 net 与两条 PCB 内铜网之间也**永远不**因名字相等而连通——名字从不建立连接，连接只来自成员行（根）或 `connect`（PCB 内）或 `interconnects` 行（跨板）。

### 7.3 `constraints` 段

```
constraints
  voltage  M2.SYS_IN   3.0V..3.6V
  voltage  M1.VOUT     4.85V..5.15V
  diff     USB_DP  USB_DN  90Ω  ±10%
```

约束段也是表：列间至少两个空格，同段内按最宽单元格对齐（§11）。

第一列是约束类型，列数与语义由类型决定；主语可以是**根 net**、**模块端口引用**（`M2.SYS_IN`）或展平后的实例引脚（`M2.U1.VDD`，工具在展平视图中解析）：

| 约束类型 | 形式 |
|---|---|
| `voltage` | `voltage <pin 或 net> <min>..<max>` |
| `current` | `current <pin 或 net> <max>` |
| `power` | `power <pin> <max>` |
| `impedance` | `impedance <net> <value>` |
| `length` | `length <net> <min>..<max>` |
| `diff` | `diff <netA> <netB> <impedance> [tolerance]` |
| `skew` | `skew <netA> <netB> <op> <length>` |

`<op>` 为 `<`、`<=`、`>`、`>=`。区间 `a..b` 为闭区间。

**约束是设计的承诺，检查器拿它去比事实**（[ADR-0026](../docs/adr/07-devices/0026-a-part-states-its-own-ratings.md)）：`voltage` 声明的是**绝对电位**的窗口，同一个文件里的所有 `voltage` 处在**同一个参考帧**里，帧的原点由设计自己声明——`voltage GND 0V..0V`。工具**不假设**叫 `GND` 的 net 就是 0V：分地或隔离电源有多种参考，猜出来的比较比不比较更糟。

两端的器件（电容、电阻这类两引脚器件）的电压应力是**两端电位的差**，取各自窗口的极值：

`stress = max(|max(a) − min(b)|, |max(b) − min(a)|)`

器件的电压能力来自 `instances` 行的 `voltage` 列（通用件：设计要求）或器件自己的 `ratings`（`kind: part`：事实，[ADR-0026](../docs/adr/07-devices/0026-a-part-states-its-own-ratings.md)）。能力低于应力报 `design.rating-exceeded`；两端的 net 有一个没有窗口、或器件不是两引脚时**不比较**，并在一条 `design.stress-unknown`（note）里报出数量——没比较不等于通过。容差不参与比较（器件独立漂移，语言还无法声明相关性），降额是项目政策而不是检查器的常数：比的是"能不能扛"，不是"留了多少裕量"。

**耗散同理**（[ADR-0026](../docs/adr/07-devices/0026-a-part-states-its-own-ratings.md)）：阻性器件（主量是 `resistance` 的两引脚器件）的最坏耗散是 `P = stress² / R`，`stress` 就是上式那一段窗口差，`R` 取实例行的 `value`（通用件）或件的 `value` 额定值。上界有三处来源，比较取**最紧的那一条**：

| 来源 | 写法 | 说的是 |
|---|---|---|
| 设计的耗散上限 | `power <引脚> <max>` 约束 | 这个位置允许多少耗散 |
| 行的功率要求 | `instances` 行的 `power` 列 | 买到的件至少要能扛多少 |
| 件的功率额定值 | 件 `ratings` 段的 `power` | 这颗件实际能扛多少 |

超过任一条报 `design.rating-exceeded`（载荷里带 `stress_uw` / `limit_uw` / 起作用的那个来源）。

三处都没说话时，还有一条**兜底**的边界：片式电阻的**封装底线**——同一封装的最低档（厚膜）的功率额定值，按 `(construction, package_code)` 查器件的规则表（`0402` = 62.5mW，[ADR-0027](../docs/adr/07-devices/0027-the-package-gives-a-chip-resistor-its-floor.md)）。它是**下界**：超过它意味着这个封装的任何标准件都扛不住，违规是确定的；不超过它不证明通过了（更高档的件存在，也需要更高档就把要求写出来）。底线**只在三处都没有声明时**才用，声明了就以声明为准——`power 1W` 的 2010 行买的是 1W 的件，封装惯例不许反过来质疑它。

两端有一个没有窗口、器件不是两引脚、或封装代号这张表不认（例如按 IEC 写成 `1005`）时**不比较**，计入 `design.power-unknown`（note，按原因分列）。

**这是上界，不是实测**：它假设两端同时到达各自窗口的极端，所以两端窗口相同时它给 0——而实际耗散可以不是 0（电流由谁承担，语言还没说，`current VOUT 3A` 不指成员）。因此它只能报违规、不能证明通过。同一个道理，串在两条声明窗口的**交流/阻尼**元件（RC 缓冲的串联电阻）上，这个上界没有物理意义：设计不该给这种位置写耗散上限。

`power` 约束的**主语必须是引脚**（`M1.R1.1`）：耗散属于器件实例，不属于 net；写 net 的 `power` 约束当前不参与任何比较，也不报错（net 的功率预算还没有语义）。

### 7.4 `ports` 段（可选）

`port` 是**根 `net` 的对外名字**。跨板 interconnect 的端点、打印页的端口符号消费它（§7.5、`spec/schematic-view.md`）。

```
ports
  GND      GND
  SYS_OUT  SYS
```

列：`port_id net`。

- `port_id` 命名规则同 `net_id`（§4.2）。
- `net` 必须是本文件 `nets` 段里已存在的 `net`；不存在即报错（`port` 不创建节点）。
- 同一个 `net` 最多被一个 `port` 引用。
- `port` 不新增连通性：它引用的仍然是原来那些 `net`。

### 7.5 `interconnects` 段（可选）

**跨板的物理连接是一条显式事实**。两块 PCB 之间"这里有一根线/一条电缆"，逻辑根的 net 成员**说不出来**——net 成员只合并逻辑节点（§7.2），所以 0.14 给它专属的段，端点是**模块端口**：

```
interconnects
  ic1  M1.SYS_OUT  M2.SYS_IN
  ic2  M1.GND      M2.GND
```

列：`<interconnect_id> <from-endpoint> <to-endpoint>`。

- `<interconnect_id>` 形状同 `module_id`（§4.2），**在根文件内唯一**（重复报 `ref.duplicate-interconnect`）。
- 端点是**模块端口引用** `<module_instance_id>.<port_id>`（`M1.SYS_OUT`）。两端必须指向**不同**模块实例的端口；同一实例的两侧端口是模块内部的事，不是 interconnect（报错）。模块内 net 与内部引脚不可作为端点（`ref.module-internal-ref`）。
- 端点指向的 port 必须在该模块定义的 `ports` 段声明（`ref.unknown-port`）；指向 `no_connect` 端口报错（`ref.no-connect-port`）。
- **语义**：`from` 端口所属的模块内 net 与 `to` 端口所属的模块内 net，通过这条**显式的物理路径**连接。它回答"两块板之间哪里有线"，与根 net 成员（逻辑节点归属）、PCB 内 `connect`（一块板内部的连续铜箔）三者互相独立、互不推导：**相等的 net 名从不 imply interconnect**（§7.2），一条 interconnect 也从不要求两端 net 同名。
- 一条 interconnect 是**一条物理路径的声明**，不是一根具体的电缆型号：线束与连接器选型仍不在语言里（§14）。**引脚级映射**（连接器 A 的 2 号脚接连接器 B 的 5 号脚）是可选补充段，见 §7.6。
- interconnect 不进入 PCB 的 `connect`（那是板内铜）；它也不改写任何模块的内部连通性——删掉全部 interconnect 行，两块 PCB 各自仍然成立，只是跨板路径没有声明（检查器报出，见 §10 规则 9）。
- **视图只渲染，不创建**：打印页可以画 interconnect，但删掉或改动页面不改变 interconnect 事实（`spec/module.md` §7.2、`spec/schematic-view.md`）。

### 7.6 `interconnect_pins` 段（可选）

当 interconnect 的两端都是**连接器类模块实例**、且引脚映射重要时，用它声明端点侧的引脚映射。它是**连接器/电缆的针脚对照**，**不是 net 成员表**——写成它不会把任何引脚并进任何 net。

```
interconnects
  ic1  M1.PWR  M2.PWR

interconnect_pins
  ic1  M1.J1.1  M2.J1.1
  ic1  M1.J1.2  M2.J1.2
```

列：`<interconnect_id> <from-endpoint-pin> <to-endpoint-pin>`。

- 第一列必须指向 §7.5 已声明的 `interconnect_id`（否则报错）。
- 端点引脚引用是**展平后的完整引脚引用** `<module_instance_id>.<refdes>.<pin>`（`M1.J1.1`、`M2.J1.2`）。它必须落在对应端点**所属模块实例的模块内 net** 上（端口暴露的那条 net），否则报 `ref.pin-off-endpoint-net`（error）。
- 一条 interconnect 的 `interconnect_pins` 行数不限；某条 interconnect 没有引脚映射就**不写行**——没有"空映射"。
- 引脚映射**不改变逻辑连通性**：两个引脚是否同 net 仍由模块内部的 `nets` 段决定；本段只说"电缆/排针把这两个脚接到一起"（校验发现映射两侧不同 net 时报 warning——它是连接器对照表与逻辑图的分歧，不是第二条连通性真源）。
- 未被任何 `interconnect_pins` 行覆盖的 interconnect：端点级路径（§7.5）就是全部事实，多引脚连接器内部的逐脚对应由连接器器件自己的引脚名约定承担。

### 7.7 展平与 IR（[ADR-0069](../docs/adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D1）

根源文件**不含器件事实**，但展平后的 schematic IR **必然含**——普通消费者（netlist、BOM、约束检查、渲染）拿到的还是一张实例表 + 一张 net 表：

- **必填字段**：`ir_version`、`format`、`project`（常量 `main`）、`modules`、`instances`、`nets`。
- `instances` = 全部模块定义的实例展平结果，实例 id 带 `M` 限定（`M1.U1`），UID 路径化（`IDp8x2n4/IDk2m8q4`）。根文件本身零器件（[ADR-0069](../docs/adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D1），实例全部来自模块（`spec/module.md` §5）。
- `nets` = 根 net 合并模块端口后得到的**扁平 net 表**；模块内部 net 名合并进根 net 后消失（`spec/module.md` §5）。
- **`modules` 数组**：每项 `{ instance_id, module_id, uid?, ports: [{ id, net?, pins: string[] }] }`。`ports[].pins` 是该模块本地端口 net 在**根 net 合并之前**的完整归一化展平引脚引用（如 `M1.U1.VIN`）；`net` 是端口指向的模块内 net 名。ports/pins 被保留，是为了**校验端点映射**（`interconnects` 端点、PCB 归属校验）时不用从归属关系反推；根 net 合并后这些本地 net 名在 `nets` 表里不再出现。
- **`interconnects` 数组**：每项 `{ id, from, to }`，端点是 `M1.PORT` 形式的模块端口引用。
- **`interconnect_pins` 数组**：每项 `{ interconnect, from, to }`，引脚引用是 `M1.J1.1` 形式的展平引脚引用。
- **可选数组为空时省略**（`interconnects`、`interconnect_pins`）；必填字段恒在。
- IR 契约版本 **v0.19**（`schemas/ir/`；`v0.18` 保持不变）。`modules` / `interconnects` / `interconnect_pins` 分片是**规范**分片（`normative: true`）：归属与跨板路径进工程哈希。
- **归属与物理连通性的全局校验在 core，不在 parser**：parser 只管每份文件的形状与本地引用；"每个实例恰好属于一块 PCB""interconnect 端点两侧的物理路径成立"由 `texteda check` 汇总全部文件后执行（`spec/pcb.md` §5.2）。

---

## 8. `pcb` 文件

`pcb` 描述的具体段定义在 **`spec/pcb.md`**（分描述规范）。本节只给定位与三条底线。

定位：`pcb` 表达 **一块物理 PCB 的实现事实**，是逻辑根的**实现**而不是第二份连通性真源。0.14 起每个 `design/pcb/<pcb_id>.teda` 必须**声明它拥有哪些模块实例**（必需的 `modules` 段，`spec/pcb.md` §4.1）；`connect` / `trace` / `via` / `zone` 只表达**这块板内部的**连续铜箔。决策与取舍见 `docs/adr/05-pcb/0016-agent-first-pcb-description.md` 与 [ADR-0069](../docs/adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md)。

段集（0.14）：`modules`（新增）· `stackup` · `outline` · `place` · `connect` · `trace` · `via` · `zone` · `keepout` · `rules` · `silk` · `physical_only` · `deviation`。

三条底线：

1. **板内连通性只由逻辑模型 + 本板的 `connect` 决定**。`connect` 段显式声明哪两个 pad 之间有连续铜箔；几何不作为连通性真源；**net 名相等从不 imply 跨板连通**（§7.2、§7.5）。
2. **物理专属实体进 `physical_only`，逻辑偏差进 `deviation`**；两者都必须进校验报告（偏差白名单见 `AGENTS.md` §4.4）。
3. **派生层不进 IR**：绘图参数、丝印排版、铜皮填充结果、量测文本、UUID 与内部序号一律不存。

`logical_only` 的标记语法仍待定（`AGENTS.md` §2 第 14 条）。

---

## 9. 类型与单位

### 9.1 引脚电气类型

`input`、`output`、`bidirectional`、`tri_state`、`passive`、`power_in`、`power_out`、`power`、`open_collector`、`open_emitter`、`polarized`、`no_connect`、`unspecified`。

其中 `power` 表示地/参考节点；`power_in` 表示供电输入；`polarized` 表示**有极性**的引脚（正负不可互换，通用器件本身声明 `polarized yes`）。

### 9.2 单位与前缀

| 量 | 单位 | 示例 |
|---|---|---|
| 电阻 | `Ω` | `10k`、`5k1`、`4R7`、`0.1Ω` |
| 电容 | `F` | `100n`、`1u`、`4u7` |
| 电感 | `H` | `10u` |
| 电压 | `V` | `3.3V`、`-12V` |
| 电流 | `A` | `500mA`、`2A` |
| 功率 | `W` | `0.25W` |
| 频率 | `Hz` | `8MHz`、`32.768kHz` |
| 长度 | `m` / `mm` / `mil` / `in` | `0.5mm`、`10mil`、`1in` |
| 温度 | `C` | `-40C`、`85C` |
| 百分比 | `%` | `±1%`、`+-1%` |
| 阻抗 | `Ω` | `90Ω` |

前缀：`p`、`n`、`u`/`µ`、`m`、`k`/`K`、`M`、`G`。电气列中 `m` 是 milli，`M` 是 mega；长度列中 `m` 是米，`mm` 是毫米，由列类型判定。

- 列类型提供单位时，值可省略单位：`10k` 在电阻列 = 10 kΩ，`100n` 在电容列 = 100 nF。
- 显式单位与列类型冲突时报错。
- 电阻可用 `R` 作小数点：`4R7` = 4.7 Ω，`0R05` = 0.05 Ω。
- 容差用 `±` 或 `+-` 输入，两者等价；canonical form 用 `±`。
- 区间写作 `a..b`，闭区间；比较写作 `<`、`<=`、`>`、`>=`。

---

## 10. 校验规则

按顺序执行；任一错误阻止导出。**每份文件先做本地校验（本节规则 1–8）；归属与物理连通性的全局校验在 core 汇总全部文件后执行（规则 9、14），不在 parser**（[ADR-0069](../docs/adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D1）。

1. 文件头：版本、文件类型、id/文件名、顶层目录/类型一致；`schematic` 的 id 固定 `main`；`assets/components/` 的子目录只做分类，不参与 `component_id`。
2. 词法：未知段、未知键、单元格数量、非法标识符。
3. 器件：`instances` 引用的 id 存在；`params` 数量/类型匹配；引脚编号唯一，引脚名在 `unit` 内唯一；`symbol` 指向自建库时必须有 `pins` 段（自建符号不带引脚事实）；`category` 为通用无源件且 `params` 含 `value` 时 `mpn` 可省，否则必须有 `mpn`；`lcsc` 若出现必须匹配 `C[0-9]+`。
4. 连接（模块内）：引脚引用可解析；每个引脚最多一个 net；`no_connect` 不得连接；单成员 net 警告（带端口的 net 不算单成员，那个引脚是往模块外走的）。
5. 约束：subject 存在；单位/量纲兼容；区间有效。
6. 变体（`project.toml`）：`dnp`/`nofit` 引用的 component_id 存在。
7. 模块（`module` 文件）：按 `spec/module.md` §6 执行；`design/sch/modules/<module_id>.teda` 存在、头部 id 与文件名一致、端口合法。
8. 根（`schematic` 文件）：`modules` 行的 `module_id` 存在；net 成员是**已声明的模块端口**（模块内部引脚不可直达，`ref.module-internal-ref`）；同一端口不被并进两条根 net（`net.port-in-two-nets`）；`ports` 引用的根 net 存在、`port_id` 不重复、同一 net 最多一个 port；`interconnects` 端点是已声明端口、两端不同实例、`interconnect_id` 唯一；`interconnect_pins` 的第一列指向已声明的 interconnect、引脚引用落在端点所属的模块实例内。没有任何模块实例的根报错（空工程的电路还是空的，不给静默通过）。
9. **归属与 interconnect 的全局校验（core）**：每个模块实例被**恰好一块** PCB 的 `modules` 段声明（零块/两块都是 error）；`interconnects` 端点两侧的模块实例**分属不同 PCB**（同一 PCB 内的连接走模块内部 net 与 PCB `connect`，不走 interconnect）；未被任何 interconnect 触及的跨板端口对不判定（语言不做"应该有连线"的猜测）。
10. canonical form（§11）：不满足的文件在 `fmt --check` 下报错；`fmt` 修复后语义不变。
11. BOM：行 = (`component_id`, 参数字典, 变体状态)；聚合键不含 `refdes`；数量 = 工程里的实物数（同一模块定义在多处实例化就算多份）。
12. 变体：只影响 BOM 与制造，不改变连通性；引用 `component_id` 作用于该型号的所有实例，引用稳定 id 只作用于该实例；不影响 ERC 结果。
13. legacy 构造：`design/sch/` 下的其他 `schematic` 文件、`design/system/` 的 `system` 描述、`views/<board_id>/` 的板级打印页，见到即报 `ref.legacy-board-root` / `ref.legacy-system-description`（error，迁移说明见 §12.4 的 0.14 条目）。
14. pcb（`pcb` 文件存在时）：按 `spec/pcb.md` §5.2 执行；sch↔pcb 绑定、模块归属与偏差白名单见 `AGENTS.md` §4.4 与 `spec/pcb.md` §5.2。
15. footprint（库文件存在时）：按 `spec/footprint.md` §7 执行；库级检查（引脚号比对、DRC）不在这层。
16. symbol（库文件存在时）：按 `spec/symbol.md` §7 执行；库级检查（与 `component` 的引脚号集合比对）不在这层。
17. procurement（`procurement` 文件存在时，0.9）：按 `spec/procurement.md` §3.2 与 §7 执行。通用器件能解析且是通用器件、件能解析且是件、件有 `mpn`、件的 `params` 覆盖通用器件的、件的 `footprint` 等于通用器件的 `footprint`、件不是被工程派生件遮蔽的库件。**主料违反是 error，备料违反是 warning**（严格模式下 error）；源文件本身解析失败一律是 error。通用器件行没有选料 → warning（unsourced）；选中的件板上没用到 → warning。

诊断格式：`file:line:col: <severity> <code>: <message>`；`--json` 输出同字段。严重级别：`error` / `warning`。

---

## 11. Canonical form

`fmt` 必须满足：`parse(fmt(x))` 与 `parse(x)` 语义相同，且 `fmt(fmt(x)) == fmt(x)`。

规则：

1. 段顺序固定：
   - schematic（根）：`modules`、`nets`、`ports`、`constraints`、`interconnects`、`interconnect_pins`
   - component：`params`、`pins`
   - module：见 `spec/module.md` §2（`instances`、`nets`、`ports`、`constraints`）
   - pcb：见 `spec/pcb.md` §6.1（`modules`、`stackup`、`outline`、`place`、`connect`、`trace`、`via`、`zone`、`keepout`、`rules`、`silk`、`physical_only`、`deviation`）
   - footprint：`pads`、`graphics`；标量顺序与行的排序见 `spec/footprint.md` §8
   - symbol：`pins`、`body`；标量顺序与行的排序见 `spec/symbol.md` §8
   - view：`place`、`field`、`wire`、`label`、`port`、`text`、`module`、`module_port`；标量顺序与行的排序见 `spec/schematic-view.md` §11
   - procurement：`selections`（唯一段）；标量只有 `role`
2. 行排序（名称一律按 ASCII 字节序；实例 id 按自然序，数字按数值比较）：
   - `modules` 按 `module_instance_id` 自然序
   - `nets` 按 net 名
   - `nets` 的成员按引用自然序（先比实例 id，数字按数值比较；端口引用按 `port_id`）
   - `ports` 按 port_id
   - `interconnects` 按 `interconnect_id`；`interconnect_pins` 按 `(interconnect_id, from, to)`
   - `pins` 按编号数值
   - `params` 保持源文件顺序（声明顺序即实例行的列序）；`required` 列必须排在 `optional` 列之前，否则报错
   - pcb 各段的排序与归一见 `spec/pcb.md` §6.2
   - procurement 的 `selections` 按左键文本排序：通用器件 id 按 ASCII，参数按声明顺序逐个按 ASCII（IR 里按解析后的值排序，见 §11 规则 9）
   - `constraints` 保持源文件顺序
3. 列对齐：同段内按最宽单元格对齐，列间至少两个空格。**procurement 行不对齐**：两行的列含义不同（某通用器件的第一个参数不是另一通用器件的第一个参数），对齐会暗示不存在的对应关系；procurement 行的单元格之间用**一个**空格，`->` 前后各一个空格。
4. 段之间一个空行；无行尾空白；文件末尾一个换行。
5. 整行注释保留，并跟随其后的行移动。
6. 单元格内容不变，只调整分隔空白：表段单元格之间至少两个空格并对齐；标量行（"键 + 值"）用单个空格分隔，多单元格的值（如 `description`）按单元格重排，连续空白归一。
7. `net` 行的 canonical 形式：网名紧贴冒号（`SYS:`），冒号后至少两个空格，成员之间至少两个空格；同段内所有行的成员起始列相同。`ports`、`interconnects` 行同样按最宽单元格对齐。
8. **宽行折行**：同一个 net 的所有成员（跨行、跨同名行、跨续行合并后）按规则 2 排序，然后折行使每行不超过 **80 列**。首行带网名，续行的首列是裸 `:`，续行成员与首行成员对齐到同一列。折行只影响排版，不影响语义：同一份描述无论写成几行，编译出的 IR 相同。
9. **文本顺序与 IR 顺序可以不同**。canonical form 只看文本，因此成员按**源码写的形式**排序（写编号就按编号比，写名字就按名字比）；IR 里的成员一律是引脚**编号**，按编号排序。两者各自确定且幂等，同一份描述的 IR 与源文件的行序、行内成员序都无关。

---

## 12. 版本与兼容

### 12.1 版本号的形式

`version` 为 `MAJOR.MINOR[.PATCH]`，三位各自无前导零。**PATCH 位可省略，省略即 0**：`0.6` 与 `0.6.0` 是同一个版本，IR 里只存一种写法（`0.6`）。

**语言只有一个版本号。** 每个 `.teda` 文件声明的是**语言**的版本，不是它那一种描述类型的版本——所有描述类型共用这一个号（决策见 [ADR-0002](../docs/adr/01-language/0002-one-language-version-number.md) D2）。`project.toml` 的 `format` 是同一个号，IR 的 `format` 字段记的也是它。当前语言版本是 **0.14.0**。

各描述类型接受的**下界**是当前 reader 仍支持的最早表面形态；它可以晚于类型的历史引入版本。上界对所有描述类型都是同一个——语言当前版本。

| 描述类型 | reader 下界 | 说明 |
|---|---|---|
| `schematic` | `0.14` | Introduced at 0.1; **the single project logical root from 0.14** (board-local schematics removed, `system` removed) |
| `module` | `0.8` | Introduced at 0.8; owns all component facts since 0.14 |
| `pcb` | `0.14` | Introduced at 0.4; flat-board rewrite at 0.7; coordinate tuples require 0.11; **required `modules` section from 0.14** |
| `procurement` | `0.9` | Introduced at 0.9; procurement selections, keyed by `pcb_id` from 0.14 |
| `view` | `0.14` | Introduced at 0.6; board-level references from 0.7; coordinate tuples require 0.11; 0.12/0.13 constructs version-gated; **project-scoped under `views/` from 0.14** |
| `module_view` | `0.13` | Introduced at 0.13 by ADR-0068; reusable module-local drawing |
| `sheet_template` | `0.13` | Introduced at 0.13 by ADR-0068; static sheet furniture |
| `footprint` | `0.11` | Introduced at 0.4; coordinate tuples require 0.11 |
| `symbol` | `0.11` | Introduced at 0.5; coordinate tuples require 0.11 |
| `component` | `0.1` | Introduced at 0.1; component descriptions |

`packages/parser/src/version.ts` 的 reader-floor 表实现接受下界；`packages/parser/test/version-spec.test.ts` 将其与本表钉在一起。类型引入版本是历史事实，保留在说明列中；它不决定 reader floor。

在 `0.x` 阶段，兼容澄清和诊断改进走 PATCH；新增段或字段、以及**改变已接受文件的表面形态**走 MINOR，并且必须有显式决策记录（[ADR-0002](../docs/adr/01-language/0002-one-language-version-number.md) D5）。`0.10.0` 由 [ADR-0055](../docs/adr/09-view/0055-schematic-fields-are-view-overrides.md) 引入 `view` 的 `field` 段；`0.11.0` 由 [ADR-0065](../docs/adr/01-language/0065-a-coordinate-tuple-is-one-cell.md) 把坐标统一成一个括号元组单元格；`0.12.0` 由 [ADR-0067](../docs/adr/09-view/0067-hierarchical-module-views-and-custom-page-size.md) 加入 module overview/detail 页、module-port 绘图与 `size` 页尺寸声明；`0.13.0` 由 [ADR-0068](../docs/adr/09-view/0068-reusable-module-drawings-and-sheet-templates.md) 加入 `module_view`、`sheet_template`、`template` 与 `module_place`；`0.14.0` 由 [ADR-0069](../docs/adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md) 收拢工程根并删除板级/系统旧构造。


| 位 | 什么时候动 | 动它意味着 |
|---|---|---|
| MAJOR | 改语义、删字段、删段——老文件不再合法 | 破坏性变更，必须给迁移说明 |
| MINOR | 加描述类型、加段、加字段——老文件继续合法 | 增量变更，老文件不用改 |
| PATCH | **不改变"哪些文件合法"**的改动：加诊断码、改诊断文案、澄清规则、收紧本来就非法的检查 | 行为变更，兼容性不变 |

**`1.0` 是保留号**：它表示语言表面冻结（见 §12.2），只能由收敛决策产生，不会被“计数”走到。`1.0` 之前的一切版本号都在 `0.x` 线里，彼此可比。决策见 [ADR-0002](../docs/adr/01-language/0002-one-language-version-number.md) D6、D10。

一条硬规则：**PATCH 永远不破坏兼容性**。所以实现了 `MAJOR.MINOR` 的工具接受它的**任意** PATCH（判定时忽略 PATCH 位），`0.6.1` 的文件能被只懂 `0.6` 的工具正常读。

> 0.14 是一次**语义上的 MAJOR**（删除描述类型与段、改变根的形状），按 [ADR-0002](../docs/adr/01-language/0002-one-language-version-number.md) D5 的例程记为 MINOR + 显式迁移：`0.x` 线内 MAJOR 位不动，破坏性变更走 MINOR 并附迁移说明（0.7 的先例同此）。

### 12.2 1.0 是什么

`1.0` 是**里程碑，不是用完的计数**：达到 1.0 需要一次显式决策（一份 ADR），表示"语言表面冻结"——之后只出 PATCH 版本（`1.0.1`、`1.0.2`…），不再加描述类型、段与字段。

**版本线的合并已经发生**（2026-10-27，决策见 [ADR-0002](../docs/adr/01-language/0002-one-language-version-number.md)）：九条类型版本线合成一个语言版本号。合并不是冻结——表面还在动，十用例语料还没齐（`docs/backlog.md` F12）——所以 `1.0` 仍然是保留号，触发条件还是那份决策要写的东西：没有待做的破坏性或增量表面变更，且十个困难用例语料已经存在。

所以版本号涨得快不意味着快到 1.0：日常的澄清与诊断改进走 PATCH 位，只有真正的语言增量才动 MINOR，而 MINOR 步在 `0.x` 阶段需要一份决策记录。

**`1.0` 之后如果确实要改表面，那是新的 MAJOR（`2.0`）**，带迁移说明与迁移脚本——`1.x` 线因此只有 `1.0`、`1.0.1`、`1.0.2`……，不会有 `1.1`–`1.9`（[ADR-0002](../docs/adr/01-language/0002-one-language-version-number.md) D6）。

### 12.3 接受规则

一个文件被接受，当且仅当：

1. 版本号是合法的 `MAJOR.MINOR[.PATCH]`（否则 `format.invalid-version`）；
2. MAJOR 与工具支持的 MAJOR 相同（否则 `format.unsupported-version`）；
3. MINOR **不低于该描述类型的 reader 下界**（§12.1 的表）；
4. MINOR **不高于语言当前的 MINOR**——上界对所有描述类型都是同一个：语言当前版本。

上界是统一的语言版本；reader 下界则是该类型当前仍支持的最早表面形态，可能晚于类型的历史引入版本。表面形态发生破坏性变化时，下界可以随显式迁移一起前移。

`project.toml` 的 `format` 是**语言版本**（§12.1 的当前号），`texteda init` 写的就是它；IR 的 `format` 字段记的是源文件自己声明的版本（canonical 写法）。IR 契约版本 `ir_version` 是另一条线，不随语言版本动（[ADR-0002](../docs/adr/01-language/0002-one-language-version-number.md) D8）。

PATCH 位不参与判定（见 §12.1 的硬规则）。

### 12.4 版本沿革

语言的每次版本变化在这里留一条，最新的在前。每条写明改了什么，并指向决定它的那份记录。

#### 0.14.0 — One project root, explicit PCB ownership（2026-11-09）

- **一个工程一个逻辑根**（决策见 [ADR-0069](../docs/adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D1）：`design/sch/main.teda` 是唯一的 `schematic` 描述，id 固定 `main`。它组合模块实例（`modules` 段）、给出项目级 `nets` / `ports` / `constraints`，并新增 `interconnects` 段（跨板物理路径，端点是模块端口）与可选 `interconnect_pins` 段（连接器/电缆引脚映射，不是 net 成员）。根文件**不再有 `instances` 段**：全部器件事实在 `design/sch/modules/<module_id>.teda`（module 文件的解析行为不变）。
- **删除板级与系统旧构造，无兼容路径**：`design/sch/<board_id>.teda`（板级原理图，板 id ≠ `main`）、`system` 描述类型（`design/system/*.teda`）、`views/<board_id>/` 板级打印页全部不再合法（`ref.legacy-board-root` / `ref.legacy-system-description`）。`[boards.<id>]` 键改为物理 PCB 的元数据表。
- **PCB 拥有模块实例**：`design/pcb/<pcb_id>.teda` 新增必需的 `modules` 段，列出它拥有的模块实例；每个模块实例整只属于恰好一块 PCB，可复用定义可在不同 PCB 各自实例化。`procurement` 文件名改用 `pcb_id`。PCB 的 `connect` / `trace` 只表达板内连续铜箔；net 名相等从不 imply interconnect。归属与物理连通性的全局校验在 core，不在 parser。
- **视图按工程组织**：打印页迁到 `views/<page_id>.view.teda`（project 常量 `main`；`place` 可选）。
- **IR 契约到 `v0.19`**（`v0.18` 保持不变）：schematic 根的必填字段是 `ir_version` / `format` / `project`（常量 `main`）/ `modules` / `instances` / `nets`——根源没有器件，但展平 IR 必有（普通消费者拿到的仍是实例表 + net 表）；`modules` 项是 `{instance_id, module_id, uid?, ports:[{id, net?, pins:string[]}]}`，`ports[].pins` 是根 net 合并**之前**的模块本地端口 net 的完整归一化展平引脚引用；`interconnects` 项 `{id, from, to}`（端点 `M1.PORT`）；`interconnect_pins` 项 `{interconnect, from, to}`（引脚引用 `M1.J1.1`）；可选数组为空时省略。`modules` / `interconnects` / `interconnect_pins` 分片是规范分片，进工程哈希。
- **Reader floors**：`schematic` → `0.14`（根形状重写），`pcb` → `0.14`（必需 `modules` 段），`view` → `0.14`（工程作用域）；`module` 保持 `0.8`、`procurement` 保持 `0.9`、`module_view` / `sheet_template` 保持 `0.13`、`footprint` / `symbol` 保持 `0.11`。`system` 类型从表中删除。

#### 0.13.0 — Reusable module drawings and sheet templates（2026-11-08）

- Adds `module_view` and `sheet_template` descriptions, plus the `template` scalar and `module_place` section for composed `view` pages. Module drawings have independent required `bounds`; templates provide static furniture and page `size`. Composition uses the exact right-angle transforms and port-binding rules in `spec/schematic-view.md` §§12–14. No page role is selected by page ID ([ADR-0068](../docs/adr/09-view/0068-reusable-module-drawings-and-sheet-templates.md)).
- `view` keeps its `0.11` reader floor; constructs introduced in 0.12 and 0.13 require those declared language versions. The new `module_view` and `sheet_template` types have reader floors of `0.13`.
- The IR contract advances to `v0.18`; `v0.17` remains immutable. The new module-view and sheet-template shards and the optional `template` and `module_place` fields on schematic-view shards are advisory (`normative: false`) and do not affect normative hashes or netlist content.

#### 0.12.0 — Hierarchical module views and a custom page size（2026-11-08）

- The `view` description gains `module` and `module_port` sections for a drawing-only overview, conventionally on page `main`; module-port wire endpoints draw board bindings. Page IDs do not select roles: any page ID may be a detail or composed page, and detail pages may mix and split module components. Board and module descriptions remain the sole electrical authority ([ADR-0067](../docs/adr/09-view/0067-hierarchical-module-views-and-custom-page-size.md)).
- `size [width,height]` is the canonical page-size scalar. `sheet [width,height]` remains accepted as an alias, but both together are an error. Formatting follows the source file's version: 0.11 writes `sheet`, 0.12 writes `size`. The omitted-size default remains A4 landscape.
- The `view` reader floor stays `0.11`; the additive constructs require version `0.12`. The IR contract advances to `v0.17`; `v0.16` remains unchanged.

#### 0.11.0 — A coordinate tuple is one cell（2026-11-08）

- **Coordinates are bracketed tuples, in every description type.** A point, a size and an offset are one cell — `[x,y]`, `[w,h]`, `[x,y,z]` — and a run of points is a run of such cells. The `key=value` spellings keep their key and gain the brackets: `at=[-6.5,20]`, `size=[1,1]`, `offset=[0,0,1.5]`. Single scalars (length, angle, ratio) are unchanged. The rule and its reasons are in [ADR-0065](../docs/adr/01-language/0065-a-coordinate-tuple-is-one-cell.md); the lexical rule is §4.3.
- **This is a breaking change.** The old two-cell form (`U1  10.0  10.0`, `1  -12.5  -13.5  0`, `rect  -10,-16.5,10,16.5`) is not accepted: `bun run migrate:0.11 <project dir>` folds tuples and sets geometric description files (`view`, `pcb`, `symbol`, `footprint`) to language `0.11`; it also updates the project `format`. The migration table in [ADR-0065](../docs/adr/01-language/0065-a-coordinate-tuple-is-one-cell.md) §Migration lists the affected columns. The migration decides nothing — a tuple's arity was already fixed by its column.
- **Reader floors move only where the surface changed.** `view`, `pcb`, `symbol`, and `footprint` now have a reader floor of `0.11`, whether or not an individual file currently contains a tuple. Other description types keep their prior floors and do not need their version lines rewritten.
- **What does not change.** The `0.5 mm` lattice ([ADR-0059](../docs/adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md)), the wire endpoint rules ([ADR-0062](../docs/adr/09-view/0062-a-run-may-end-at-a-port.md)), the junction graph, the `0.01 mm` view resolution and the IR contract. The IR still stores `x_nm` / `y_nm` as separate integers ([ADR-0005](../docs/adr/02-ir/0005-ir-representation.md)); `ir_version` does not move.

#### 0.10.0 — Schematic field overrides（2026-11-01）

- The `view` description gains an optional `field` section for per-instance `Reference` and `Value` positions. Rows are symbol-local overrides; omitted rows select deterministic renderer placement. The construct is defined by [ADR-0055](../docs/adr/09-view/0055-schematic-fields-are-view-overrides.md).
- At the `0.10` release, a `0.9.2` file remained valid when it used no `field` section, while a `0.9.2` file containing `field` was rejected. The `view` reader floor later moved to `0.11` for the coordinate-tuple rewrite. The IR contract for the new optional array is **v0.15**; **v0.14** is unchanged.

#### 0.9.2 — 资产目录变成分类目录（2026-10-30）

- **符号与封装不再按"库"分目录，改成按分类分目录**（决策见 [ADR-0049](../docs/adr/08-libraries/0049-assets-are-filed-by-what-they-are.md)）：`assets/symbols/<category>/<symbol_id>.teda`（类别与器件同一根轴）、`assets/footprints/<family>/<footprint_id>.teda`（封装族，封装自己的轴）。`assets/components/**` 不变（它本来就是分类目录）。
- **引用形式变了**：`component.symbol` / `component.footprint` 写成 `<分类>:<id>`（如 `symbol passives:r`、`footprint chip:chip-0402`），不再是 `<lib>:<id>`。IR 的 `symbol.library` / `footprint.library` 存的仍是那个目录名，只是它的含义从"库"变成"分类"。
- **为什么这是 PATCH**：接受的文件集合没变（一个文件仍然是"一个 id 一个文件、放在 `assets/<类型>/<目录>/` 下"），变的是那个目录名的含义与引用的前缀；工具读旧布局会找不到引用并报"未定义"，不会静默读错。
- **迁移**：文件要**移动**（从 `assets/symbols/<lib>/` 到 `assets/symbols/<category>/`、从 `assets/footprints/<lib>/` 到 `assets/footprints/<family>/`），并把每个器件的 `symbol` / `footprint` 行改写成新的前缀。这两步是**作者的判断**（分类怎么分、一个符号被多类共用时归哪一类），工具不替人决定；`bun run migrate:0.9 <project dir>` 只改版本行。
- IR 契约版本不动（分片路径的形状没变：`symbols/<目录>/<id>.json`）；KiCad 导出的库名跟着分类目录走。

#### 0.9.1 — 九条类型版本线合并为一个语言版本号（2026-10-27）

- **语言只有一个版本号**（决策见 [ADR-0002](../docs/adr/01-language/0002-one-language-version-number.md) D2）：每个 `.teda` 文件声明的是语言版本，与它是哪一种描述无关；`project.toml` 的 `format` 是同一个号。
- **下界仍按类型，上界统一**（决策同前 D2）：在 0.9.1 合并时，每种描述类型的下界是它被引入的那一版（`pcb` 例外——0.7 的板扁平化改写了它的形状，下界因此是 `0.7`）；上界是语言当前版本，对所有描述类型相同。后续的破坏性表面迁移可以显式提高 reader 下界。
- **合并只放宽接受范围**（决策同前 D3）：今天能读的文件没有一份变成不能读。
- **版本号从此只走 PATCH 位**（决策同前 D4）：下一个是 `0.9.2`；`0.x` 阶段抬 MINOR 需要一份决策记录。
- **`1.0` 仍然是保留号**（决策同前 D5）：合并不是冻结——十用例语料还差六个（`docs/backlog.md` F12）。
- **IR 契约版本是另一条线，不一起合并**（决策同前 D7）：`ir_version` 记的是 IR 契约自己的版本，给的是实现 IR 契约的人，不是读 `.teda` 的人。
- **本仓库的文件全部搬到这个号**（决策同前 D8）：`examples/` 下的 `.teda` 文件与 `project.toml` 的 `format` 变成 `0.9.1`；分片的 `format` 字段跟着变，哈希与用例金样重新生成。机械部分由 `bun run migrate:0.9 <project dir>` 做——它只改版本行，不改别的。

#### 0.9 — 采购层与实例 UID（2026-10-22）

- 新增 `procurement` 描述类型——一块板的采购选料（决策见 [ADR-0029](../docs/adr/07-devices/0029-the-procurement-layer.md)，语法见 `spec/procurement.md`）。选料是**决定**不是事实：主料进工程哈希与板哈希，备料只进 advisory 哈希。**已落地**（2026-10-23）：解析器与 canonical fmt（`packages/parser`）、IR 契约 **v0.6** 的 `procurement` 分片（规范的主料分片 + 附注的备料分片）、`texteda compile --procurement` 与 `texteda check` 的接线。**未落地**：选料与件额定值的比对检查、BOM 输出（`docs/backlog.md` F35）。
- 同一次改动里，实例行可带稳定 UID（`refdes IDxxxxxx …`、`M1 IDxxxxxx module_id`；决策见 [ADR-0010](../docs/adr/03-project/0010-instance-identity-is-a-uid.md)，2026-10-25）。IR 契约到 **v0.14**，`instance` 多一个可选 `uid`；展平后的模块实例 UID 形如 `IDmodule/IDlocal`。这不是引用重写：`nets` 成员、`view` 摆位、`pcb` 摆位仍按显示名引用。

#### 0.8 — 模块（2026-10-22）

- 新增 `module` 描述类型、模块端口与上层 net 的绑定、展平（决策见 [ADR-0013](../docs/adr/04-schematic/0013-modules-compose-boards.md)，语法见 `spec/module.md`）。层次里**有一层逻辑结构**：模块持有电气事实，带端口；绘制划分在视图层的打印页里。**IR 契约不变**（当时仍是 0.2）：上层 IR 是展平结果，不含模块结构。

#### 0.7 — 一块板一份原理图，页面变打印页（2026-10-21）

- **删除**：`page` 描述类型、`sch` 的 `pages` 段、页内命名空间与展平；绘制划分移到视图层，成为**打印页**（决策见 [ADR-0012](../docs/adr/04-schematic/0012-one-flat-schematic-per-board.md)）。
- **迁移 0.6 → 0.7**（`bun run migrate:0.7 <project dir>` 做机械部分）：
  1. 把每个页面文件的 `instances`、`nets`、`constraints` 并进板文件；页面的 `ports` 行删掉，板根里引用页面端口的 net 行改成板级 net 本身。
  2. 板内撞名的 `refdes` 与 `net` 由作者改名（工具不替你决定，报错并列出冲突）。
  3. `view` 文件里的页内 id 改成板级 id，页端口改成板端口；文件名保持 `<page_id>.view.teda`。
  4. `pcb` 文件里的实例 id 与 net 名去掉页面前缀。
  5. 仍带 `page` 头或 `pages` 段的文件，诊断指向本条迁移说明。

#### 0.6 — 视图层（2026-10-21）

- 新增 `view` 描述类型——原理图的 S1 视图层（决策见 [ADR-0035](../docs/adr/09-view/0035-the-view-layer-is-a-drawing.md)，语法见 `spec/schematic-view.md`）。

#### 0.5 — 符号（2026-10-20）

- 新增 `symbol` 描述类型（决策见 [ADR-0031](../docs/adr/08-libraries/0031-symbol-format.md)，语法见 `spec/symbol.md`）。

#### 0.4 — pcb 与封装（2026-10-20）

- 新增 `pcb` 描述的完整段集（决策见 [ADR-0016](../docs/adr/05-pcb/0016-agent-first-pcb-description.md)，语法见 `spec/pcb.md`）；`component` 的 `lcsc` 标量（决策见 [ADR-0022](../docs/adr/06-manufacturing/0022-jlc-prototype-delivery.md)）；`footprint` 描述类型（决策见 [ADR-0030](../docs/adr/08-libraries/0030-footprint-format-and-geometry.md)，语法见 `spec/footprint.md`）。

#### 0.3 — 页（2026-10-20）

- 新增 `page` 描述类型、`sch` 的 `pages` 段、板内展平与 BOM 计数规则（决策见 [ADR-0015](../docs/adr/04-schematic/0015-flattening-and-the-net-set.md)）。**这两项在 `0.7` 被删除**（见上）。

#### 0.2 — 端口（2026-10-20）

- 新增 `sch` 的 `ports` 段（决策见 [ADR-0009](../docs/adr/03-project/0009-board-linking.md)）。未使用新构造的文件保持旧号。

#### 0.1 — 语言的起点（2026-10-20）

- 语言的第一个版本：那时只有 `component` 与 `schematic` 两种描述类型（后来每加一种描述类型或一段就走一次 MINOR，见 [ADR-0002](../docs/adr/01-language/0002-one-language-version-number.md) 的背景）。

#### 合并之前：每种描述类型各有一条版本线

2026-10-22 起，语言曾经同时维护九条**类型版本线**（每种描述类型一条，条与条之间不可比），2026-10-27 合并为一个语言版本号。下面这些条目记的是那段时间里**某一种描述类型自己**的版本号，不是语言的版本号——它们已经随合并退役，但改动本身（以及改法）仍然是记录。合并的决策见 [ADR-0002](../docs/adr/01-language/0002-one-language-version-number.md) D2，类型版本线的来历见 [ADR-0002](../docs/adr/01-language/0002-one-language-version-number.md) D5。

- `component` 描述类型：`0.1` → `0.1.1`（PATCH，2026-10-22）。新增 `kind` / `construction` / `polarized` 三个标量，并把 `kind` 变成必填、`kind: family` 的 `params` 变成必填（决策见 [ADR-0024](../docs/adr/07-devices/0024-the-device-kind-is-part-or-generic.md) D1、D2）。**这是破坏性变更**（老文件不再合法），按合并前的规矩走 PATCH 位（类型版本线只增 PATCH），改法见下：
  - **改法**（本项目尚无外部使用者，没有需要迁移的旧文件；下面是改动的机械部分）：
    1. 有 `mpn` 的文件加 `kind part`，没有 `mpn` 的文件加 `kind family`；两者都不写 `construction` / `polarized`。
    2. `kind: family` 的文件补 `construction` 与 `polarized`（按文件名与符号能推出来的就推，推不出来的由作者填）。
    3. 族文件移到 `assets/families/`；件的 id 不带值的改名由作者决定（工具不替人命名）。
    4. `instances` 行里的器件 id 跟着改名。
  - *（`0.1.3` 撤销了这条里的两件事：`family` 改名为 `generic`，器件目录也合并回 `assets/components/`——见下。）*
- `component` 描述类型：`0.1.1` → `0.1.2`（PATCH，2026-10-22）。**删除** `package` 标量：封装代号改由封装文件自己写（`package_code`），器件只保留 `footprint` 引用（决策见 [ADR-0028](../docs/adr/07-devices/0028-package-code-and-3d-models.md) decision 1）。**这是破坏性变更**（老文件不再合法），按合并前的规矩走 PATCH 位（类型版本线只增 PATCH），改法见下：
  - **改法**（同上没有需要迁移的旧文件）：
    1. 删掉器件文件里的 `package` 行。
    2. 把封装代号搬到对应的封装文件：写 `package_code <代号>`，封装文件的版本行改成 `0.4.1`。同一焊盘图案上出现两个不同代号时由作者决定留哪个。
- `component` 描述类型：`0.1.2` → `0.1.3`（PATCH，2026-10-23）。**改名与合目录**：`kind` 的第二个取值 `family` 改名为 `generic`，两种器件**合并到同一个目录** `assets/components/**`，`kind` 只写在文件里、不再从目录推断（决策见 [ADR-0024](../docs/adr/07-devices/0024-the-device-kind-is-part-or-generic.md) D6、D7）。**这是破坏性变更**（`kind family` 的老文件不再合法），按合并前的规矩走 PATCH 位（类型版本线只增 PATCH），改法见下：
  - **改法**（本项目尚无外部使用者，没有需要迁移的旧文件；下面是改动的机械部分）：
    1. 器件文件里的 `kind family` 改成 `kind generic`；id、`construction`、`polarized`、`params` 一律不动。
    2. `assets/families/**` 下的文件移到 `assets/components/**`（按类别放进对应子目录）。
    3. 通用器件文件的版本行改成 `0.1.3`；`kind: part` 的文件内容没变，版本行保持 `0.1.2`（合并前的规矩：没用新构造的文件保持旧号；今天的接受规则见 §12.3）。
    4. 库里的器件同理；`lib:id` 的限定名规则不变。
- `component` 描述类型：`0.1.3` → `0.1.4`（PATCH，2026-10-23）。**词表封闭 + 必填列按构造收紧**：`construction` 变成封闭取值集（§6.1.1）；`params` 的角色名与量纲分工写进 §6.2；必填列按 `construction` 收紧（§6.2.2）；`dielectric` 的取值变成封闭集合（§6.2.1）。**这是破坏性变更**（`construction` 拼错、介质拼错、以及缺必填列的老文件不再合法），按合并前的规矩走 PATCH 位（类型版本线只增 PATCH），决策见 [ADR-0025](../docs/adr/07-devices/0025-device-vocabulary-and-parameter-roles.md)。**改法**：
  1. `construction` 改成封闭取值集里的写法（`mlcc` / `film` / `tantalum` / `electrolytic` / `thick` / `thin` / `shielded` / `molded`）。
  2. 按 §6.2.2 给每种 `construction` 补齐必填列（例：`mlcc` 补 `dielectric`，`tantalum` 把 `voltage` 提为必填）。
  3. `dielectric` 的取值改成 IEC 60068-4 的码（`X7R` / `X5R` / `C0G` …），不归一化、不收别名。
  4. 通用器件文件的版本行改成 `0.1.4`；`kind: part` 的文件内容没变，版本行保持原号（合并前的规矩：没用新构造的文件保持旧号；今天的接受规则见 §12.3）。
  - **已落地**：上表的规则表在 `packages/core`（`devices/rules.ts`），由 `texteda check` 执行（决策见 [ADR-0025](../docs/adr/07-devices/0025-device-vocabulary-and-parameter-roles.md) D7）。
- `footprint` 描述类型：`0.4` → `0.4.1`（PATCH，2026-10-22）。新增 `package_code` 标量：这块焊盘图案的封装代号（`0402`、`SOT-23-5`、`LQFP-100`），供厂商与评审读（决策见 [ADR-0028](../docs/adr/07-devices/0028-package-code-and-3d-models.md) decision 1）。加字段在 `0.x` 阶段也走 PATCH 位；没写 `package_code` 的文件仍然合法（代号通常已经在封装 id 里），但库级检查（`bun run lib:verify`）要求每个封装都写明自己的代号。
- `component` 描述类型：`0.1.4` → `0.1.5`（PATCH，2026-10-23）。新增 `ratings` 段：`kind: part` 的件在这里写自己的额定值（`role type value`），`kind: generic` 不得写、`kind: part` 仍不得写 `params`（决策见 [ADR-0026](../docs/adr/07-devices/0026-a-part-states-its-own-ratings.md)）。**IR 契约随之到 0.4**（`component` 分片多了 `ratings`）。用到 `ratings` 的件文件写 `version 0.1.5`；没写的件文件版本行不变（合并前的规矩：没用新构造的文件保持旧号；今天的接受规则见 §12.3）。
- `component` 描述类型：`0.1.5` → `0.1.6`（PATCH，2026-10-24）。新增 `provenance` 标量与 `verified_by` / `verified_on`：器件自己声明事实的来源与核对状态（决策见 [ADR-0034](../docs/adr/08-libraries/0034-trust-in-a-library-you-do-not-own.md) decision 5，取代 [ADR-0033](../docs/adr/08-libraries/0033-libraries-are-unverified-facts.md) 的派生件）。**IR 契约随之到 v0.12**（`component` 分片多了 `provenance`）。**改法**：不写这三个标量的文件保持原号；`texteda lib import` 写出的文件是 `0.1.6` + `provenance generated`。
- `component` / `symbol` / `footprint` 三种描述（2026-10-24）：各新增一个可选标量 `rev`——**该文件的事实最后确立的那个发布名**（不是格式 `version`，不是库整体版本），信任记录按它逐字匹配（决策见 [ADR-0034](../docs/adr/08-libraries/0034-trust-in-a-library-you-do-not-own.md) D6）。版本线：`component 0.1.6` → `0.1.7`、`symbol 0.5` → `0.5.1`、`footprint 0.4.1` → `0.4.2`（PATCH；**IR 契约随之到 v0.13**）。**改法**：不写 `rev` 的文件保持原号——`rev` 是可选的，没有信任记录时它什么也不影响；`texteda lib import` 写出的器件是 `0.1.7`，并在没有 `rev` 的文件里盖上一个（几何文件保持它自己的版本行：patch 位不决定接受与否）。**同批改动**：`library.toml` 的 `[library] rev` 与 `[[trust]]` 的行级 `rev` 删除，条目的写法变成 `<id>@<rev>`（`docs/guides/library-import.md` §3）。
- **契约更正**（2026-10-24，`v0.13` 原地修，不抬契约号）：`common.schema.json` 的 `layer_name` 模式原先拒绝 `*`，而同一个 schema 的说明、`spec/footprint.md` §3 与解析器都写着“通孔焊盘用 `*.Cu` / `*.Mask`”——于是**任何通孔封装都过不了契约**（`syntax` 过了，`contract.schema-violation` 挡在门口）。模式改为允许 `*`，解析器的 `LAYER_RE` 同步，并补了通孔正例夹具（`tests/schemas/valid/footprint/th-header.json`）。**为什么原地修**：字段、类型、语义都没变，改的是与自身说明矛盾的一条正则；抬一个契约号会让“v0.13 的 IR 到底能不能有通孔封装”变成两个答案。触发用例：`examples/cases/nc-pins`。
- **撤销**（2026-10-24）：`project.toml` 的 `[libs]` 表（连同 `content_hash` 与 `bun run lib:hash`）。工程不引用外部库；自建资产就在 `assets/`，作为规范分片进构建身份。旧文件里的 `[libs.*]` 现在报 `syntax.unknown-field`，消息直说改法；`init` 也不再建 `external/libs/`（决策见 [ADR-0034](../docs/adr/08-libraries/0034-trust-in-a-library-you-do-not-own.md) decision 15）。
- **撤销**（2026-10-24）：`libref` 描述类型（`external/libs/<name>.toml`）与器件引用的 `<lib>:<id>` 限定形式。工程不再消费 `external/libs/**` 里的树；外部库是模板，用 `texteda lib import` 拷进 `assets/`（决策见 [ADR-0034](../docs/adr/08-libraries/0034-trust-in-a-library-you-do-not-own.md) D2）。旧工程里的 `external/libs/<name>.toml` 与限定 id 现在分别报 `ref.library-in-tree` 与 `ref.library-qualified-id`；改法：删掉锚点与树，重新 `lib import` 你要用的器件。
- **收严**（2026-10-24，`schematic`，PATCH 位不动）：**引脚引用命中多个引脚就是歧义**。`U1.OUT` 在双运放上同时命中单元 1 与单元 2 的 `OUT`，以前静默取第一个，现在报 `ref.ambiguous-pin` 并提示写 `U1.1.OUT`；同一单元内重名的引脚（两个 `GND`）同样报歧义，提示改用编号（§4.5）。**改法**：多单元器件的 net 成员写成 `<refdes>.<unit>.<pin>`；重名引脚改用编号。**为什么算 PATCH**：它不新增构造，只把一条一直写在规范里、实现却没执行的规则（"名称不唯一时改用编号"）接上——而它咬到的正是**已经在做错事**的文件（把线接到错误的单元上），与 §12.1 里 PATCH 位那条规则（"对本来就该报错的文件收严"）同类。触发用例：`examples/cases/dual-opamp-multi-unit`（`docs/backlog.md` F12）。
- `pcb` 描述类型：`0.7` → `0.7.1`（PATCH，2026-10-22）。`physical_only` 的实体**有位置**了：行是 `<id> <type> <x> <y> [args…]`（`spec/pcb.md` §4.11），`cutout` 的参考点是矩形左下角，其余是圆心。同时**删除** `test_point` 形态——测试点是 `sch` 里的单引脚器件，不是 `pcb` 的实体（决策见 [ADR-0014](../docs/adr/04-schematic/0014-connectivity-has-one-authority.md) D8/D9/D11）。**这是破坏性变更**（老的 `physical_only` 行与 `test_point` 行不再合法），按合并前的规矩走 PATCH 位（类型版本线只增 PATCH）。**IR 契约随之到 0.9**（`pcb` 分片：`mounting` / `fiducial` / `stitching` 多了 `x_nm` / `y_nm`，`test_point` 变体删除）。**改法**：
  1. 每个 `physical_only` 行在类型后面插两个坐标（mm，默认单位），写在板框里给它定的位置。
  2. `test_point` 行改成 `sch` 里的单引脚器件（不采购的写 `kind generic`），走普通 net 成员规则；`pcb` 里只保留它的封装放置。
  3. 用到位置的 `pcb` 文件写 `version 0.7.1`；没写 `physical_only` 的 `pcb` 文件版本行不变。
- 类型版本线已随 2026-10-27 的合并退役：一个语言版本号，PATCH 位只增不减（见 §12.1 / §12.2，决策见 [ADR-0002](../docs/adr/01-language/0002-one-language-version-number.md)）。
- 未知构造默认报错；放宽要显式开关（见 ADR-0005 的前向兼容约定）。**这是 `0.x` 阶段版本号只走 PATCH 位的安全依据**：不懂新构造的工具会报错停下，不会误读文件。
- 所有破坏性变更必须写明改了什么、怎么改（见本节）；`fmt` 不自动跨迁移。破坏性变更的机械部分由迁移脚本做（`bun run migrate:0.7`、`bun run migrate:0.9`），其余由作者决定：工具不替人改名、不替人决定事实。

---

## 13. 完整示例

`assets/components/regulators/tps7a02.teda`（一个 `part`）：

```
version 0.14.0
component tps7a02

kind         part
mpn          TPS7A02DBVR
manufacturer Texas Instruments
datasheet    https://www.ti.com/lit/ds/symlink/tps7a02.pdf

symbol       kicad:Regulator_Linear:TPS7A02
footprint    kicad:Package_TO_SOT_SMD:SOT-23-5

pins
  1  IN   power_in
  2  GND  power
  3  EN   input
  4  NC   no_connect
  5  OUT  power_out
```

`assets/components/passives/cap-tantalum-7343.teda`（一个 `generic`）：

```
version 0.14.0
component cap-tantalum-7343

kind         generic
category     capacitor
construction  tantalum
polarized    yes

symbol       project:c-pol
footprint    project:tantalum-7343

params
  value      capacitance  required
  tolerance  percent      optional
  voltage    voltage      optional
  esr        resistance   optional

pins
  1  P  polarized
  2  N  polarized
```

`design/sch/modules/power.teda`（模块定义：**全部器件事实在这里**）：

```
version 0.14.0
module power

instances
  U1  tps7a02
  R1  res-th-0402  10k  ±1%

nets
  GND:   U1.GND  R1.2
  VIN:   U1.IN  U1.EN  R1.1
  VOUT:  U1.OUT

ports
  GND   GND
  PWR   VIN
```

`design/sch/main.teda`（**工程的逻辑根**，一个工程恰好一份）：

```
version 0.14.0
schematic main

modules
  M1  IDp8x2n4  power
  M2  IDk2m8q4  aux

nets
  GND:   M1.GND  M2.GND
  SYS:   M1.PWR  M2.PWR

ports
  GND      GND
  SYS_OUT  SYS

constraints
  voltage  SYS  3.0V..5.5V

interconnects
  ic1  M1.PWR  M2.PWR
```

两块 PCB 各自声明拥有的模块实例（`design/pcb/pwr-l1.teda`、`design/pcb/pwr-l2.teda`，语法见 `spec/pcb.md` §4.1）：`M1` 属于 `pwr-l1`，`M2` 属于 `pwr-l2`；跨板的 `ic1` 是一条显式物理路径，不是任何 net 名的巧合。展平后的 IR 是**扁平的**：一张实例表（`M1.U1`、`M2.U1`…）、一张 net 表，不含模块结构（§7.7；IR 契约 v0.19）。

`views/charger.view.teda`（工程打印页，画给评审看）：

```
version 0.14.0
view charger

place
  M1  [40,30]  0
  M2  [80,30]  0

wire
  SYS  M1.PWR  M2.PWR
```

打印页引用**根级**的模块实例与 net 名；它不创建任何连接，删掉它，工程照样成立（语法见 `spec/schematic-view.md`）。

---

## 14. 尚未定义

以下未定或明确不支持：

- 行尾注释、引号单元格、转义、跨行值。
- `blocks` 层次（`module` 已落地，见 `spec/module.md`；backlog F13 的其余部分：参数、嵌套、跨工程库包）。
- 一个 `port` 暴露多个 `net`；板外端点（适配器、电池、负载）；跨板**线束与连接器选型**（`interconnects` 声明路径本身，`docs/adr/03-project/0009-board-linking.md`）。
- interconnect 的端点级引脚映射之外的事实（电缆型号、线规、差分 twin）。
- 生成器 / 循环 / 条件（事实层禁止；生成器在语言之外、产物是表，见 `docs/adr/01-language/0001-fact-layer-has-no-expressions.md`）。
- 表达式语言；0.2 起只允许约束里的比较与区间（值层与组合层不受事实层禁令约束，见 `docs/adr/01-language/0001-fact-layer-has-no-expressions.md` D4）。
- PCB 几何语法的剩余项（圆弧走线、圆弧板框、微孔、布局约束、封装几何是否内联）：见 `spec/pcb.md` §7。
- `logical_only` 的标记语法（`physical_only` 见 `spec/pcb.md` §4.11）。
- 多单元器件的引用简写（`U1B.OUT`）。

---

## 附录 A：EBNF

形状语法；词法细节以 §4 为准。

```ebnf
file       = header, { line }, EOF ;
header     = { blank | comment }, version_line, { blank | comment }, type_line ;
version_line = WS0, "version", WS1, version, WS0, NL ;
type_line  = WS0, file_type, WS1, id, WS0, NL ;
file_type  = "component" | "schematic" | "module" | "pcb" | "footprint" | "symbol" | "view" ;
version    = digit, ".", digit ;

line       = blank | comment | section | scalar | row | single_row ;
blank      = WS0, NL ;
comment    = WS0, "#", { any - NL }, NL ;
section    = WS0, section_name, WS0, NL ;
scalar     = WS0, key, WS1, value, NL ;
row        = WS0, cell, WS1, cell, { WS1, cell }, WS0, NL ;
single_row = WS0, cell, WS0, NL ;

value      = non_ws, { any - NL } ;
cell       = non_ws, { non_ws } ;
non_ws     = any - ( " " | "\t" | NL ) ;
key        = lower, { lower | digit | "_" } ;
id         = lower, { lower | digit | "-" } ;
section_name = "params" | "pins" | "instances" | "nets" | "ports" | "modules"
             | "constraints" | "interconnects" | "interconnect_pins"
             | "stackup" | "outline" | "place" | "connect" | "trace"
             | "via" | "zone" | "keepout" | "rules" | "silk" | "physical_only"
             | "deviation" | "pads" | "graphics" | "body"
             | "wire" | "label" | "text" ;
WS0        = { " " | "\t" } ;
WS1        = ( " " | "\t" ), { " " | "\t" } ;
```

上下文约束（EBNF 表达不了）：

1. `version_line` 是第一条有效行，`type_line` 是第二条；空行/注释可夹在中间。
2. `scalar` 只能出现在 `type_line` 之后、第一个 `section` 之前。
3. `row` 只能出现在 `section` 内。
4. `section_name` 必须属于当前文件类型：
   - `component`：`params`、`pins`
   - `schematic`（根，id 固定 `main`）：`modules`、`nets`、`ports`、`constraints`、`interconnects`、`interconnect_pins`
   - `module`：`instances`、`nets`、`ports`、`constraints`
   - `pcb`：`modules`、`stackup`、`outline`、`place`、`connect`、`trace`、`via`、`zone`、`keepout`、`rules`、`silk`、`physical_only`、`deviation`
   - `footprint`：`pads`、`graphics`
   - `symbol`：`pins`、`body`
   - `view`：`place`、`field`、`wire`、`label`、`port`、`text`、`module`、`module_port`
5. 单单元格的非空行只能是 `section`。
6. `id` 的具体字符集按 §4.2；net 名允许 `.`、`+`、`-`，与文件 id 不同；`module_instance_id` 是保留形状 `^M[0-9]+$`。
