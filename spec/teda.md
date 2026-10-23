# `.teda` 格式规范（v0.9，草案）

状态：草案。`AGENTS.md` 记录设计决策与边界，本文件定义具体格式。两者冲突时，以 `AGENTS.md` 的不变量为准，并修本文件。

本文件描述当前提议的**表格式**；`AGENTS.md` §11 第 1 条的“表 vs 链式”仍待十用例验证，可被 ADR 推翻。表内具体列也按同一原则处理。

---

## 0. 一句话

`.teda` 是**一行一事实**的文本格式：文件头声明类型，段（section）放表，表行的列由该段的 schema 解释。

```
version 0.1
schematic main

instances
  R1  res-th-0402  10k  ±1%
  U1  tps7a02

nets
  GND:   U1.GND  R1.2
  VIN:   U1.IN  U1.EN
  VOUT:  U1.OUT  R1.1
```

---

## 1. 设计约束

1. 一行一个事实；不允许需要读下一行才能理解的结构。**事实层的值是终值字面量，没有表达式、没有控制流**——生成器在语言之外，产物是表（`docs/adr/0017-fact-layer-no-expressions.md`）。
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

九种文件类型：

| 类型 | 位置 | 说明 |
|---|---|---|
| `component` | `assets/components/**/<component_id>.teda` | 器件定义一个文件（`part` 与 `generic` 同在这个目录），可放子目录 |
| `schematic` | `design/sch/<board_id>.teda` | 一块板一个文件（v0.7 起：板内不再有页面文件） |
| `pcb` | `design/pcb/<board_id>.teda` | 可后置，可为空 |
| `system` | `design/system/<system_id>.teda` | 多板连接描述，一份系统一个文件（v0.2 新增） |
| `footprint` | `assets/footprints/<lib>/<footprint_id>.teda` | 库产物：一个封装的规范几何（v0.4 新增） |
| `symbol` | `assets/symbols/<lib>/<symbol_id>.teda` | 库产物：一个符号的视图（v0.5 新增） |
| `view` | `views/<board_id>/<page_id>.view.teda` | 一块板的一个"打印页"：S1 视图层（v0.6 新增，v0.7 起引用板级 id，语法见 `spec/schematic-view.md`） |
| `module` | `design/modules/<module_id>.teda` | 板内的一个模块：带端口、持有电气事实（v0.8 新增，语法见 `spec/module.md`） |
| `procurement` | `assets/procurement/{primary,alternatives}/<board_id>.teda` | 一块板的采购选料：通用器件 → 买哪颗（v0.9 新增，语法见 `spec/procurement.md`） |

文件名必须等于头部 id；不一致报错。`assets/components/` 允许子目录，子目录只用于分类；`component_id` 取文件名（不含 `.teda`），不取相对路径，同一 id 在 `assets/components/` 树内必须唯一。顶层目录与文件类型必须一致（`assets/components/` 只放 `component`，`design/modules/` 只放 `module`，以此类推）；`design/sch/<board_id>.teda` 是板的文件（`schematic`）；打印页（`view`）是独立描述类型，放在独立根目录 `views/<board_id>/<page_id>.view.teda`，靠 `.view` 后缀与目录区分（`view <page_id>`，见 [ADR-0032](../docs/adr/0032-view-is-a-drawing-not-a-build-input.md)）。`assets/footprints/` 与 `assets/symbols/` 是**库目录**而不是描述目录：它们按库分子目录（`assets/footprints/<lib>/`、`assets/symbols/<lib>/`），库名由目录决定（IR 的 `footprint.library` / `symbol.library`），不进文件内容。`assets/procurement/primary/` 与 `assets/procurement/alternatives/` 只放 `procurement` 文件，文件名是板 id，两者的区别是**哈希级别**（主料规范、备料附注），不是语法（v0.9）。工程树整体按 `docs/adr/0031-project-tree-ownership-model.md`（本表其余行的路径待同步）。

---

## 3. 行类型

解析器逐行分类，只有八种：

| 类型 | 形态 | 说明 |
|---|---|---|
| 空行 | 仅空白 | 忽略 |
| 注释 | `#` 为第一个非空白字符 | 整行忽略；v0.1 不支持行尾注释 |
| 版本行 | `version <ver>` | 必须是最前面的有效行 |
| 类型行 | `<file_type> <id>` | 必须在版本行之后 |
| 段头 | 单独一个保留字，如 `instances` | 由保留字集合识别，不靠缩进 |
| 标量 | `key value...` | 只能出现在第一个段之前 |
| 行 | ≥2 个空白分隔的单元格 | 属于当前段 |
| 指令 | `bus <id> = <type>` | 仅 `schematic` |

关键规则：

- **段头是“单个保留字”**。`instances` 单独一行是段头；`instances x` 是行或错误，取决于当前段。
- **缩进无语义**。`  U1 tps7a02` 与 `U1 tps7a02` 等价；缩进只为阅读。
- **标量只在第一个段之前**。进入段之后，所有非段头、非空、非注释行都按行解析。
- **注释只整行**。`#` 出现在值或单元格中间时是普通字符（避免截断 URL 片段）。
- **`:` 只用于 net/bus 成员行**。`name: member...` 表示“名字 → 成员列表”；其余段是固定列元组，不加冒号。
- **冒号与续行同域**。只有“名字 + 不定长列表”的行（`nets`、`bus` 成员）才既用冒号界定名字与列表的边界，又可能长到一行放不下，所以也只有它们支持续行：首列是裸 `:` 的行延续上一行命名的 net。其余段要么列数固定（`instances`、`ports`、`constraints`），要么是成对坐标、拆行会断配对（`trace`、`zone`、`keepout`、`outline`），都不需要续行。

---

## 4. 词法

### 4.1 空白

空格或制表符；连续空白视为一个分隔符。行首行尾空白忽略。段内行的缩进不参与解析。

### 4.2 标识符

| 名称 | 规则 | 示例 |
|---|---|---|
| `component_id` / `board_id` / `page_id` | `[a-z][a-z0-9-]*` | `tps7a02`, `res-thick-0402`, `ch32v307vct6` |
| `refdes` | `[A-Z]+[0-9]+` | `U1`, `R10`, `LED1` |
| `net_id` | `[A-Za-z0-9_+-]+(\.[A-Za-z0-9_+-]+)*` | `VBUS`, `USB_DP`, `i2c0.scl` |
| 引脚名 | `[A-Za-z0-9_+-]+` | `PA0`, `VREF+`, `OSC_IN` |
| 键 / 段名 | `[a-z][a-z0-9_]*` | `mpn`, `physical_only` |

### 4.3 单元格

单元格是不含空白的连续字符。v0.1 **不支持引号、转义、跨行单元格**。需要空格的自由文本（厂商名、描述）只能写在标量里。

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
| `U1.PA0` | refdes + 引脚名（名称不唯一时改用编号） |
| `U1.1` | refdes + 引脚编号 |
| `U1.2.OUT` | 多单元器件：refdes + unit + 引脚名 |
| `i2c0.scl` | net 名（bus 成员） |

解析顺序：先按名称匹配；名称不存在则按编号；两者都命中不同引脚时报“歧义”，要求改用编号。

### 4.6 数字与单位

数字为十进制，可带前缀与单位。单位由列类型提供时可以省略。详见 §10.2。

---

## 5. 文件头与版本

```
version 0.1.2
component tps7a02
```

- 版本行必须是第一条有效行；类型行必须是第二条。
- 版本号的形式与各位的含义见 §13；接受规则见 §13.3。PATCH 位不参与判定。遇到更高版本默认报错；`--allow-unknown` 可放宽。
- 类型行与目录必须一致。
- 头部 id 与文件名必须一致。

---

## 6. `component` 文件

### 6.1 标量（段之前）

| 键 | 必填 | 说明 |
|---|---|---|
| `kind` | 是 | `part`（具体器件）或 `generic`（通用器件）；见 §6.1.1 |
| `mpn` | 条件 | 制造商料号：`kind: part` 必填，`kind: generic` **必须不写** |
| `construction` | 条件 | 构造工艺：`kind: generic` 必填，`kind: part` **必须不写** |
| `polarized` | 条件 | 是否有极性：`kind: generic` 必填（`yes` / `no`），`kind: part` **必须不写** |
| `manufacturer` | 否 | 厂商 |
| `category` | 否 | 器件类别，开放取值集：`mcu` / `resistor` / `capacitor` / `inductor` / `led` / `diode` / `mosfet_p` / `regulator` / `battery_charger` / … |
| `datasheet` | 否 | URL |
| `lcsc` | 否 | 嘉立创商城料号（`C` + 数字），供 BOM 匹配 SMT 物料；见 `docs/adr/0006-jlc-prototype-delivery.md` |
| `description` | 否 | 一行人类描述（如 `SOT-23-5 500 mA LDO`）。只是散文：不参与任何检查，也不进身份（[ADR-0042](../docs/adr/0042-a-device-description-enters-the-ir.md)） |
| `symbol` | 是 | `lib:name` |
| `footprint` | 是 | `lib:name` |

`category` 是**器件类别**，取值是**开放集合**：不设封闭目录，库里没有的类别直接用，小写加下划线。它只做分类，不参与校验逻辑分支；与文件头的类型（`component` / `schematic` / `pcb` / `system`）无关。

**封装名不在器件文件里**。器件只引用一个 `footprint`（`lib:name`），封装代号由封装文件自己写（`package_code`，见 `spec/footprint.md` §2）：封装代号是**焊盘图案**的名字（`0402`、`SOT-23-5`、`LQFP-100`），两个字段说同一件事、且没人校验它们一致，所以删掉一个（决策见 [ADR-0029](../docs/adr/0029-package-code-footprint-and-3d-model-ownership.md) decision 1）。

### 6.1.1 两种器件：`part` 与 `generic`

`component` 描述类型同时描述两种不同的东西，用 `kind` 显式区分，**从不推断**（决策见 [ADR-0027](../docs/adr/0027-device-parts-families-and-library-dependencies.md)；词汇与目录见 [ADR-0037](../docs/adr/0037-device-kind-vocabulary-and-one-device-directory.md)）：

| `kind` | 身份 | `mpn` | `params` | 典型 `instances` 行 |
|---|---|---|---|---|
| `part` | 一个制造商料号 | **必填** | 不写（身份封闭） | `U1 tps5430ddar` |
| `generic` | 一个通用器件类别（类别 + 构造 + 封装） | **禁止** | 至少一列必填的 `value` | `C1 cap-tantalum-7343 220uF 10V` |

- `part` 是**买得到的那一颗**：料号固定了它的一切，所以它没有参数列，也不写构造与极性（那是从它所属的通用器件继承的）。
- `generic` 是**设计要求的规格**：文件里没有料号，值、耐压、容差都在 `instances` 行里；`construction`（`mlcc` / `film` / `tantalum` / `electrolytic` / `thick` / `thin` / `shielded` / `molded`，**封闭取值集**，由 `texteda check` 按 [ADR-0038](../docs/adr/0038-device-vocabulary-and-parameter-roles.md) D4 检查）与 `polarized`（`yes` / `no`）是它自己的事实，不再靠文件名或符号选择暗示。买哪一颗由采购层决定（`spec/procurement.md`），不在器件文件里。**封闭的理由**：已经有一条**已决的规则**按构造分流（[ADR-0029](../docs/adr/0029-package-code-footprint-and-3d-model-ownership.md) decision 2 用它区分"能不能带封装包络"，检查落在 `lib:verify`，**实现未落地**，见 `docs/backlog.md` F32），开放词表里的拼错不会报错，只会**静默漏掉一条安全检查**。
- 两种器件**同在一个目录**：`assets/components/**` 放全部器件文件，子目录只用于分类。`kind` 是文件里的事实，**不从目录推断**，目录也不表达种类（决策见 [ADR-0037](../docs/adr/0037-device-kind-vocabulary-and-one-device-directory.md)）。两者共用一个 id 命名空间，id 取文件名。
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

- **`name` 是角色**（这个参数是哪个量、哪个额定值），**`type` 是量纲**（单位，以及它在 IR 里的整数表示，见 [ADR-0008](../docs/adr/0008-ir-shard-identity-and-hash.md) decision 4）。所以电感写 `value inductance required`，不写 `inductance value required`：`value` 不是量纲，它是"主量的标称值"这个角色。这个不对称在契约里已经是这样——IR 给 `param_decl.name` 的模式是 `^[a-z][a-z0-9_]*$`（开放标签），给 `param_decl.type` 的是封闭的量纲枚举。
- 角色名一律小写加下划线。**数据手册的符号不进语言**：`I_sat` 是某家的记法（Vishay 写 `Isat`、TDK 写 `I_sat`），把语言绑到一家的记法上，而且违反上面那条模式。角色写 `sat_current`，长形式与判据写进角色词表（决策见 [ADR-0038](../docs/adr/0038-device-vocabulary-and-parameter-roles.md) D2）。
- `required` 必须排在 `optional` 之前，因此 `instances` 行只需从右往左省略 optional 列。

类型：`resistance`、`capacitance`、`inductance`、`voltage`、`current`、`power`、`frequency`、`length`、`temperature`、`percent`、`integer`、`string`。

- `kind: part` **不写** `params` 段：料号已经定死身份，再有参数列就是两处身份。
- `kind: generic` **必须**写 `params` 段，且至少有一列必填的 `value`（通用器件之间的区别就是值）。
- 参数列不得叫 `package` 或 `footprint`：封装与焊盘图案是固定属性（§6.1.1、§6.1），不随取值变化。
- 参数不得改变引脚表（§6.1.1）。

#### 6.2.1 角色词表

角色是**哪个额定值**，类型是**量纲**。同一个量纲有多个额定值时，角色名必须指明是哪一个；**判据写在这里，不写进类型词表**——类型词表是纯单位表（[ADR-0008](../docs/adr/0008-ir-shard-identity-and-hash.md)），而件（`kind: part`）在 IR 里根本没有额定值，IR 里只有要求，所以"要求方"与"读数据手册的人"对齐判据是人和 agent 的事，不是两台机器的事（决策见 [ADR-0038](../docs/adr/0038-device-vocabulary-and-parameter-roles.md) D3）。

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

所以 `R1 10k ±1%` 允许买 ±0.5% 的件（更好，合格），不允许买 ±2% 的件（更差，超出设计给的包络）。**写容差不挡替代料，挡替代料的是"把值当事实写死"。** 比较用的件额定值从哪来已经定了：件在自己的文件里用 `ratings` 段写（[ADR-0039](../docs/adr/0039-a-part-states-its-own-ratings.md)，§6.4）。

**封闭取值集**：成员就是唯一合法拼写，**不归一化、不收别名**——同一个码的两种写法会变成两行 BOM。取值不在集合里 → 源码侧报错并列出合法值（决策见 [ADR-0038](../docs/adr/0038-device-vocabulary-and-parameter-roles.md) D5）。

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

- **`instances` 行写的是要求集，不是件**：每一列都是对"将来买到的件"的要求（标称值、允许的偏差、耐压下限、介质类别），不是数据手册的抄写。件满足全部要求就合格，**更好的件也合格**——`R1 10k ±1%` 意为"任何落在 ±1% 内的 10k"，1% 缺货时可以买 ±0.5%，±2% 的不行。**写容差不挡替代料；把值当"事实"写死才挡。** 采购在这组要求里选件，设计只说要求（[ADR-0030](../docs/adr/0030-procurement-layer.md)）。
- **容差必填 = 不给采购自由发挥**：不写容差，等于授权采购在这一类里随便挑；写了，它就在设计给定的包络里挑。必填集合因此是**一组完整要求**（`100nF ±10% 16V X7R`），不是半份。
- **容差同时就是最坏情况**：`10k ±1%` 是区间 [9.9kΩ, 10.1kΩ]。评估器要在这段区间上判约束，而不是在标称值上判——设计保证"凡是它允许的件，电路都对"。**限制采购的那个数，就是分析必须扛住的那个数**：一个数，两个用途（评估器是 [ADR-0038](../docs/adr/0038-device-vocabulary-and-parameter-roles.md) 的 open point 与 `docs/backlog.md` F42 的事）。
- 钽电容与电解电容的罐体随耐压变（[ADR-0029](../docs/adr/0029-package-code-footprint-and-3d-model-ownership.md) 自己就是拿这条拒绝它们带封装包络的），所以耐压是要求的一部分。
- 电阻的功率额定值由封装决定（0402 厚膜惯例 1/16W），但**三件事要分开**：件自己的额定值写在件的 `ratings` 段里（它是件的事实）；设计需要的**最低功率能力**写在实例行的 `power` 参数里（它是采购要求，见 [ADR-0039](../docs/adr/0039-a-part-states-its-own-ratings.md)）；设计的**耗散上限**是**约束**（`power R1 63mW`，ERC 检查）。
- `sat_current` 是角色（§6.2.1），但**选填**：它要不要写取决于设计有没有峰值电流；"峰值电流会不会让磁饱和"是**比对**，那是 `docs/backlog.md` F42 的事。

**必填只保证"写出来了"**：解析器强制 `instances` 行给齐每个必填列，所以规格写在源码里。**写出来**与**验证**是两件事（决策见 [ADR-0038](../docs/adr/0038-device-vocabulary-and-parameter-roles.md) D6 与其附录）：现在有一样东西拿件去比要求——采购层拿选中的件自己的 `ratings` 逐角色比这组要求（`spec/procurement.md` §3.3）；**还没有**的东西是拿要求去比电路：没有检查器拿电容的耐压去比它所在的网，也没有评估器在这段容差区间上判约束（`docs/backlog.md` F42）。

上表与检查落在 `packages/core` 的器件规则表里（[ADR-0038](../docs/adr/0038-device-vocabulary-and-parameter-roles.md) D7），由 `texteda check` 执行。

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
- 引脚类型见 §10.1。
- `pins` 对指向**自建符号**的器件是**必填**：自建 `symbol` 只描述视图，不带引脚名与电气类型（[ADR-0012](../docs/adr/0012-symbol-description.md)），事实只能内联。
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
| 谁填 | 板（每个实例一份） | 件文件（每个额定值一份） |
| 允许的 `kind` | 只有 `generic` | 只有 `part` |

- 角色名取 §6.2.1 的封闭角色词表；`type` 必须是该角色的量纲（`value` 除外：件的量纲由这一行自己写，因为件不声明 `construction`）。
- 取值按该量纲解析；`dielectric` 这类封闭取值集照样只认集合里的写法。
- **一个额定值是一个数，不是一个区间**：能承受的最高电压、长期可过的电流、标称值周围的容差。区间是**要求**（`voltage SYS 9V..19.8V`），由设计写在网的约束里。
- 通用器件不得写 `ratings`（它是一个类，类自己没有额定值；它的要求在 `instances` 行里）；`kind: part` 不得写 `params`（参数列是 `instances` 行填的，件没有实例行可填）——两条都报错。
- `ratings` 不改器件身份：引脚表不变、`mpn` 不变的还是同一颗件。

件被选去填一条通用件的行时，逐角色按方向比（§6.2.1、`spec/procurement.md` §3.3）：**更好的件永远合格**。

---

## 7. `schematic` 文件

### 7.1 `instances` 段

`assets/components/` 存器件定义（`part` 与 `generic` 同在一个目录）；本段存放置实例，同一 `component_id` 可被多行引用。

```
instances
  R1  res-th-0402  10k  ±1%
  C1  cap-tantalum-7343  220uF  10V
  U1  tps7a02
```

列：`refdes component_id [param...]`。

- `component_id` 必须在 `assets/components/` 树中按文件名找到；同一 id 只允许一个文件；否则报错。
- 额外列与该器件 `params` 段**声明的顺序**一一对应（不按名字或类型猜）；`optional` 列只能从右往左省略，`required` 列不能省略。
- `kind: part` 的实例行只有 `refdes` 与 `component_id`；`kind: generic` 的实例行带上它的参数（值的列必填）。
- `refdes` 在本文件内唯一。板只有一份原理图文件，板内没有第二套命名空间（v0.7 起，§7.6）。
- 封装不在 `instances` 行写，由器件文件决定。

### 7.2 `nets` 段

```
nets
  GND:   U1.GND  R1.2
  :      U2.GND  C1.2
  VIN:   U1.IN  U1.EN
  VOUT:  U1.OUT  R1.1
```

- 首个单元格是 net 名，可带尾随 `:`；`:` 单独成格也接受。canonical form 写成 `name:`，成员之间至少两个空格。
- 其余单元格是引脚引用。
- **续行**：首个单元格是**裸 `:`** 的行，是上一 net 行的延续——它给上一行命名的 net 增加成员。续行的标志是显式的符号，不是缩进（§3：缩进不表达任何含义）；续行成员与首行成员对齐到同一列。
- 续行必须跟在某个 net 行之后，否则报错（`net.continuation-without-net`）。连续多行续行都归属同一个 net。
- **同名 net 行可重复出现并合并成员**；同一引脚在同一 net 中重复出现报错。
- 只有一个成员的 net 合法，但 ERC 给出警告。
- 每个引脚最多属于一个 net；未连接且不是 `no_connect` 的引脚给出警告。

### 7.3 `bus` 指令（可选）

```
bus i2c0 = I2C
  scl: U1.PA8  U2.SCL
  sda: U1.PA9  U2.SDA
```

- `bus <bus_id> = <type>` 开始一个 bus 块，直到下一个段头或指令。
- 成员行格式同 `nets`，包括续行：裸 `:` 的行给上一个 bus 成员行增加引脚。
- 成员 net 的全名是 `<bus_id>.<member>`，例如 `i2c0.scl`。
- v0.1 的 bus 类型只有命名意义，不做协议校验。

### 7.4 `constraints` 段

```
constraints
  voltage  U1.VDD   3.0V..3.6V
  diff     USB_DP  USB_DN  90Ω  ±10%
```

约束段也是表：列间至少两个空格，同段内按最宽单元格对齐（§12）。

第一列是约束类型，列数与语义由类型决定：

| 约束类型 | 形式 |
|---|---|
| `voltage` | `voltage <pin 或 net> <min>..<max>` |
| `current` | `current <pin 或 net> <max>` |
| `power` | `power <component 或 net> <max>` |
| `impedance` | `impedance <net> <value>` |
| `length` | `length <net> <min>..<max>` |
| `diff` | `diff <netA> <netB> <impedance> [tolerance]` |
| `skew` | `skew <netA> <netB> <op> <length>` |

`<op>` 为 `<`、`<=`、`>`、`>=`。区间 `a..b` 为闭区间。

### 7.5 `ports` 段（可选，v0.2）

`port` 是**板的 `net` 的对外名字**。系统级描述消费板级端口（§8）。

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
- 板级 `ports` 声明这块板对外的接口，`system` 文件用它连接多块板（§8）。

---

### 7.6 一块板 = 一份原理图文件 + 若干模块（v0.8）

一块板 = 一份 `design/sch/<board_id>.teda` + 若干个模块文件。板内**没有**第二套绘制划分：没有 `pages` 段，没有 `page` 描述类型。板内**有**一层逻辑层次：**模块**——带端口、持有电气事实，语法见 `spec/module.md`，决策见 `docs/adr/0026-modules-compose-boards.md`。

- 板文件里有一个 `modules` 段，列出模块实例（`M1  charger-power`）；模块体在 `design/modules/<module_id>.teda`。
- 板级 `instances` 与模块并存：不属于任何模块的器件直接写在板文件里，用普通 `refdes`。
- `refdes` 与 `net` 名在**板级**唯一；模块内部有**自己的一套** `refdes` 与 `net` 名，展平后带 `M` 限定名（`M1.R1`、`M1.VCC`）。撞名由作者改名解决（工具不限定名、不重编号）。
- 模块端口与板级 net 的绑定写在板级 `nets` 段（成员可以是 `M2.VOUT` 这样的模块端口引用）。
- 展平后的板级 IR 是**扁平的**：一张实例表、一张 net 表，不含模块结构（IR 契约仍是 0.2）。
- 板的 `ports` 段是它对外的唯一接口（§7.5）。
- 板内的**绘制划分**（"这块图画不下"、评审想分块看）属于**视图层**：`views/<board_id>/<page_id>.view.teda` 是一个**打印页**，它引用板级的 `instance_id` 与 `net_id`（模块实例化之后是 `M1.U1`），语法见 `spec/schematic-view.md`。打印页可以随时丢弃、随时重画；删掉全部打印页，板的逻辑依然完整、可校验、可导网表。
- **BOM**：行 = (`component_id`, 参数字典, 变体状态)，聚合键**不含** `refdes`；数量 = 板上的实物数（模块实例化几次就算几份）。详见 §11。
- **层次只有一层**：模块不能再嵌套模块（backlog F13）。模块实例 id 带层级标记 `M`（`M1.R1`）。模块是**带端口的层次**，不是可丢弃的绘制划分，两者不混用。

---

## 8. `system` 文件（多板连接，v0.2）

一块板一个 `sch`；板与板之间怎么连，由独立的 `system` 描述表达。决策与理由见 `docs/adr/0001-board-linking.md`。

```
version 0.2
system cabinet

boards
  amp
  ctrl

nets
  GND:  amp.GND  ctrl.GND
  SYS:  amp.SYS_IN  ctrl.SYS_OUT
```

### 8.1 `boards` 段

列：`board_id`。

- `board_id` 必须在 `project.toml` 的 `[boards]` 中存在。
- 该板必须有 `design/sch/<board_id>.teda`；`pcb` 可缺省。
- 同一块板可以出现在多个 `system` 文件里。

### 8.2 `nets` 段

列：`system_net : <board_id>.<port_id> ...`。

- 成员是 **port 引用**（`<board_id>.<port_id>`），不是引脚引用。
- 引用的 `port` 必须在该板 `sch` 的 `ports` 段里声明。
- 一条系统 `net` 至少两个成员；成员可以是多块板（星形连接）。
- 同一块板的同一个 `net` 不能被并进两条系统 `net`（那是短路）。
- 语义：这些 port 指向的板内 `net` 是同一个系统级节点；板内两端的 `net` 名可以不同。
- 跨板电气约束写在各自 `sch` 的 `constraints` 段；两侧都写且区间不相交时报错（§11 第 9 条）。

### 8.3 与其它描述的关系

- `system` 不改写任何板的内部连通性；删掉 `system` 文件，两块板照样成立。
- `sch` 不能引用 `system` 里的 `system_net`：板不知道自己在系统里的位置。
- 跨板的线束与连接器对不属于 v0.2（见 §15）。

---

## 9. `pcb` 文件

`pcb` 描述的具体段定义在 **`spec/pcb.md`**（分描述规范）。本节只给定位与三条底线。

定位：`pcb` 表达 **B0（PCB 物理事实）**，与 `sch` 平级、共享同一身份空间（`net_id`、实例 ID、pad 号 ↔ 引脚编号）。决策与取舍见 `docs/adr/0003-agent-first-pcb-ir.md`。

段集（v0.4）：`stackup` · `outline` · `place` · `connect` · `trace` · `via` · `zone` · `keepout` · `rules` · `silk` · `physical_only` · `deviation`。

三条底线：

1. **连通性只由逻辑模型决定**。`connect` 段显式声明哪两个 pad 之间有连续铜箔；几何不作为连通性真源。
2. **物理专属实体进 `physical_only`，逻辑偏差进 `deviation`**；两者都必须进校验报告（偏差白名单见 `AGENTS.md` §4.4）。
3. **派生层不进 IR**：绘图参数、丝印排版、铜皮填充结果、量测文本、UUID 与内部序号一律不存。

`logical_only` 的标记语法仍待定（`AGENTS.md` §2 第 14 条）。

---

## 10. 类型与单位

### 10.1 引脚电气类型

`input`、`output`、`bidirectional`、`tri_state`、`passive`、`power_in`、`power_out`、`power`、`open_collector`、`open_emitter`、`polarized`、`no_connect`、`unspecified`。

其中 `power` 表示地/参考节点；`power_in` 表示供电输入；`polarized` 表示**有极性**的引脚（正负不可互换，通用器件本身声明 `polarized yes`）。

### 10.2 单位与前缀

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

## 11. 校验规则

按顺序执行；任一错误阻止导出。

1. 文件头：版本、文件类型、id/文件名、顶层目录/类型一致；`assets/components/` 的子目录只做分类，不参与 `component_id`。
2. 词法：未知段、未知键、单元格数量、非法标识符。
3. 器件：`instances` 引用的 id 存在；`params` 数量/类型匹配；引脚编号唯一，引脚名在 `unit` 内唯一；`symbol` 指向自建库时必须有 `pins` 段（自建符号不带引脚事实）；`category` 为通用无源件且 `params` 含 `value` 时 `mpn` 可省，否则必须有 `mpn`；`lcsc` 若出现必须匹配 `C[0-9]+`。
4. 连接：引脚引用可解析；每个引脚最多一个 net；`no_connect` 不得连接；单成员 net 警告（**按板级 net 判**：带板级端口的 net 不算单成员，那个引脚是往板外走的）。
5. 约束：subject 存在；单位/量纲兼容；区间有效。
6. 变体（`project.toml`）：`dnp`/`nofit` 引用的 component_id 存在。
7. sch↔pcb（两者都存在时）：按 `AGENTS.md` §4.4 的绑定规则。
8. 端口（`ports` 段）：引用的 `net` 存在；`port_id` 不重复；同一个 `net` 最多被一个 `port` 引用。
9. 系统（`system` 文件）：`boards` 的 `board_id` 在 `project.toml` 的 `[boards]` 中存在且有 `sch` 文件；`nets` 成员是已声明的 `port`；每条系统 `net` 至少两个成员；同一块板的同一个 `net` 不被并进两条系统 `net`；两侧电压约束区间不相交时报错。
10. canonical form（§12）：不满足的文件在 `fmt --check` 下报错；`fmt` 修复后语义不变。
11. 板（v0.8）：一块板一份 `schematic` 文件 + 若干 `module` 文件；`refdes` 与 `net` 名在**板级**唯一（模块内部另有自己的一套）；没有 `pages` 段、没有 `page` 文件（见到即报错，见迁移说明）；模块实例 id 是 `M` + 数字，板级 `refdes` 不得占用这个形式。
12. BOM：行 = (`component_id`, 参数字典, 变体状态)；聚合键不含 `refdes`；数量 = 板上的实物数。
13. 变体：只影响 BOM 与制造，不改变连通性；引用 `component_id` 作用于该型号的所有实例，引用稳定 id 只作用于该实例；不影响 ERC 结果。
14. pcb（`pcb` 文件存在时）：按 `spec/pcb.md` §5.2 执行；sch↔pcb 绑定与偏差白名单见 `AGENTS.md` §4.4。
15. footprint（库文件存在时）：按 `spec/footprint.md` §7 执行；库级检查（引脚号比对、DRC）不在这层。
16. symbol（库文件存在时）：按 `spec/symbol.md` §7 执行；库级检查（与 `component` 的引脚号集合比对）不在这层。
17. procurement（`procurement` 文件存在时，v0.9）：按 `spec/procurement.md` §3.2 与 §7 执行。通用器件能解析且是通用器件、件能解析且是件、件有 `mpn`、件的 `params` 覆盖通用器件的、件的 `footprint` 等于通用器件的 `footprint`、件不是被工程派生件遮蔽的库件。**主料违反是 error，备料违反是 warning**（严格模式下 error）；源文件本身解析失败一律是 error。通用器件行没有选料 → warning（unsourced）；选中的件板上没用到 → warning。

诊断格式：`file:line:col: <severity> <code>: <message>`；`--json` 输出同字段。严重级别：`error` / `warning`。

---

## 12. Canonical form

`fmt` 必须满足：`parse(fmt(x))` 与 `parse(x)` 语义相同，且 `fmt(fmt(x)) == fmt(x)`。

规则：

1. 段顺序固定：
   - component：`params`、`pins`
   - schematic：`instances`、`nets`、`ports`、`bus`、`constraints`
   - system：`boards`、`nets`
   - pcb：见 `spec/pcb.md` §6.1（`stackup`、`outline`、`place`、`connect`、`trace`、`via`、`zone`、`keepout`、`rules`、`silk`、`physical_only`、`deviation`）
   - footprint：`pads`、`graphics`；标量顺序与行的排序见 `spec/footprint.md` §8
   - symbol：`pins`、`body`；标量顺序与行的排序见 `spec/symbol.md` §8
   - view：`place`、`wire`、`label`、`port`、`text`；标量顺序与行的排序见 `spec/schematic-view.md` §11
   - procurement：`selections`（唯一段）；标量只有 `role`
2. 行排序（名称一律按 ASCII 字节序；`instances` 的 refdes 按自然序，数字按数值比较）：
   - `instances` 按 refdes 自然序
   - `nets` 按 net 名
   - `nets` 的成员按引脚引用自然序：先比实例（自然序，数字按数值比较），再比引脚（编号按数值，名称按自然序）
   - `ports` 按 port_id
   - system 的 `boards` 按 board_id
   - system `nets` 的成员按 `<board_id>.<port_id>` 字典序
   - `pins` 按编号数值
   - `params` 保持源文件顺序（声明顺序即实例行的列序）；`required` 列必须排在 `optional` 列之前，否则报错
   - pcb 各段的排序与归一见 `spec/pcb.md` §6.2
   - procurement 的 `selections` 按左键文本排序：通用器件 id 按 ASCII，参数按声明顺序逐个按 ASCII（IR 里按解析后的值排序，见 §12 规则 9）
   - `constraints` 保持源文件顺序
3. 列对齐：同段内按最宽单元格对齐，列间至少两个空格。**procurement 行不对齐**：两行的列含义不同（某通用器件的第一个参数不是另一通用器件的第一个参数），对齐会暗示不存在的对应关系；procurement 行的单元格之间用**一个**空格，`->` 前后各一个空格。
4. 段之间一个空行；无行尾空白；文件末尾一个换行。
5. 整行注释保留，并跟随其后的行移动。
6. 单元格内容不变，只调整分隔空白：表段单元格之间至少两个空格并对齐；标量行（"键 + 值"）用单个空格分隔，多单元格的值（如 `description`）按单元格重排，连续空白归一。
7. `net` 行的 canonical 形式：网名紧贴冒号（`SYS:`），冒号后至少两个空格，成员之间至少两个空格；同段内所有行的成员起始列相同。`ports` 与 `boards` 行同样按最宽单元格对齐。
8. **宽行折行**：同一个 net 的所有成员（跨行、跨同名行、跨续行合并后）按规则 2 排序，然后折行使每行不超过 **80 列**。首行带网名，续行的首列是裸 `:`，续行成员与首行成员对齐到同一列。折行只影响排版，不影响语义：同一份描述无论写成几行，编译出的 IR 相同。
9. **文本顺序与 IR 顺序可以不同**。canonical form 只看文本，因此成员按**源码写的形式**排序（写编号就按编号比，写名字就按名字比）；IR 里的成员一律是引脚**编号**，按编号排序。两者各自确定且幂等，同一份描述的 IR 与源文件的行序、行内成员序都无关。

---

## 13. 版本与兼容

### 13.1 版本号的形式

`version` 为 `MAJOR.MINOR[.PATCH]`，三位各自无前导零。**PATCH 位可省略，省略即 0**：`0.6` 与 `0.6.0` 是同一个版本，IR 里只存一种写法（`0.6`）。

`version` 是**该描述类型自己的**版本线，不是全语言共享的一个版本号：今天在飞的是四个号——`schematic 0.8`、`view 0.7`、`symbol 0.5`、`component 0.1.4`（另有 `pcb 0.4`、`footprint 0.4.1`、`system 0.2`、`module 0.8`、`procurement 0.9`）。在 `0.x` 阶段**每种描述类型只走 PATCH 位**（`0.8` → `0.8.1`）：加段、加字段也不抬 MINOR。抬 MINOR 的时机留给最后的合并（见 §13.2）。决策见 `docs/adr/0022-language-versioning.md` 的 2026-10-22 附录。

| 位 | 什么时候动 | 动它意味着 |
|---|---|---|
| MAJOR | 改语义、删字段、删段——老文件不再合法 | 破坏性变更，必须给迁移说明 |
| MINOR | 加描述类型、加段、加字段——老文件继续合法 | 增量变更，老文件不用改 |
| PATCH | **不改变"哪些文件合法"**的改动：加诊断码、改诊断文案、澄清规则、收紧本来就非法的检查 | 行为变更，兼容性不变 |

**0.x 阶段的号码是固定的**：全局号停在 `0.9`（`procurement` 诞生的那一代），**新描述类型也诞生在 `0.9`**，计数器不再往上走；每种类型自己的版本线只走 PATCH。**`1.0` 是保留号**，只能由收敛决策（所有类型没有待做的表面变更 + 十用例语料存在）产生，不会被“计数”走到。号码**按类型独立、彼此不可比**（`symbol 0.5` 与 `procurement 0.9` 不表示谁更老）。决策见 `docs/adr/0022-language-versioning.md` 的 2026-10-22b 附录。

一条硬规则：**PATCH 永远不破坏兼容性**。所以实现了 `MAJOR.MINOR` 的工具接受它的**任意** PATCH（判定时忽略 PATCH 位），`0.6.1` 的文件能被只懂 `0.6` 的工具正常读。

### 13.2 1.0 是什么

`1.0` 是**里程碑，不是用完的计数**：达到 1.0 需要一次显式决策（一份 ADR），表示"语言表面冻结"——之后只出 PATCH 版本（`1.0.1`、`1.0.2`…），不再加描述类型、段与字段。

**在 `0.x` 阶段结束时，各描述类型的版本号会一次性合并成一个 `1.0`**，之后全语言只维护这一个号。合并的触发条件建议是：所有描述类型都没有待做的破坏性或增量表面变更，且十个困难用例语料已经存在（`docs/backlog.md` F12）——用例还在动，就说明表面还没定。

所以版本号涨得快不意味着快到 1.0：日常的澄清与诊断改进走 PATCH 位，只有真正的语言增量才动 MINOR。

**`1.0` 之后如果确实要改表面，那是新的 MAJOR（`2.0`）**，带迁移说明与迁移脚本——`1.x` 线因此只有 `1.0`、`1.0.1`、`1.0.2`……，不会有 `1.1`–`1.9`（`docs/adr/0022-language-versioning.md` 的 2026-10-22b 附录 A5）。

### 13.3 接受规则

一个文件被接受，当且仅当：

1. 版本号是合法的 `MAJOR.MINOR[.PATCH]`（否则 `format.invalid-version`）；
2. MAJOR 与工具支持的 MAJOR 相同（否则 `format.unsupported-version`）；
3. MINOR **不低于该描述类型诞生的版本**——`view` 文件不能写 `0.5`；
4. MINOR **不高于该描述类型当前支持的版本**——上界是**这一种描述类型**的当前版本，不是全语言的一个版本：`view` 文件今天写 `0.7`，`symbol` 文件写 `0.5`，各写各的当前号。

PATCH 位不参与判定（见 §13.1 的硬规则）。

### 13.4 版本沿革

- `0.2` 新增：`sch` 的 `ports` 段、`system` 描述类型（决策见 `docs/adr/0001-board-linking.md`）。未使用新构造的文件保持 `0.1`。
- `0.3` 新增：`page` 描述类型、`sch` 的 `pages` 段、板内展平与 BOM 计数规则（决策见 `docs/adr/0002-board-pages-and-bom.md`）。**这两项在 `0.7` 被删除**（见下）。用到页面或 `pages` 段的板根与页面文件写 `version 0.3`。
- `0.4` 新增：`pcb` 描述的完整段集（决策见 `docs/adr/0003-agent-first-pcb-ir.md`，语法见 `spec/pcb.md`）；`component` 的 `lcsc` 标量（决策见 `docs/adr/0006-jlc-prototype-delivery.md`）；`footprint` 描述类型（决策见 `docs/adr/0011-library-format-and-footprint-ir.md`，语法见 `spec/footprint.md`）。用到 `pcb` 段、`lcsc` 或 `footprint` 的文件写 `version 0.4`。
- `0.5` 新增：`symbol` 描述类型（决策见 `docs/adr/0012-symbol-description.md`，语法见 `spec/symbol.md`）。用到 `symbol` 的文件写 `version 0.5`。
- `0.6` 新增：`view` 描述类型——原理图的 S1 视图层，页面文件的孪生文件（决策见 `docs/adr/0021-schematic-view-layer.md`，语法见 `spec/schematic-view.md`）。用到 `view` 的文件写 `version 0.6`。
- `0.7` **删除**：`page` 描述类型、`sch` 的 `pages` 段、页内命名空间与展平。一块板只有一份 `schematic` 文件；绘制划分移到视图层，成为**打印页**（决策见 `docs/adr/0025-flat-board-and-print-pages.md`）。`view` 文件的 `place` / `wire` / `label` / `port` 改为引用**板级** id（决策同前）。用到新表面的 `schematic` 与 `view` 文件写 `version 0.7`。
  - **迁移 0.6 → 0.7**（`bun run migrate:0.7 <project dir>` 做机械部分）：
    1. 把每个页面文件的 `instances`、`nets`、`constraints` 并进板文件；页面的 `ports` 行删掉，板根里引用页面端口的 net 行改成板级 net 本身。
    2. 板内撞名的 `refdes` 与 `net` 由作者改名（工具不替你决定，报错并列出冲突）。
    3. `view` 文件里的页内 id 改成板级 id，页端口改成板端口；文件名保持 `<page_id>.view.teda`。
    4. `pcb` 文件里的实例 id 与 net 名去掉页面前缀。
    5. 仍带 `page` 头或 `pages` 段的文件，诊断指向本条迁移说明。
- `0.8` 新增：`module` 描述类型、`sch` 的 `modules` 段、模块端口与板级 net 的绑定、板内展平（决策见 `docs/adr/0026-modules-compose-boards.md`，语法见 `spec/module.md`）。板内重新有了**一层逻辑层次**：模块持有电气事实，带端口；绘制划分仍在视图层的打印页里。**IR 契约不变**（仍是 0.2）：板级 IR 是展平结果，不含模块结构。用到 `module` 或 `modules` 段的文件写 `version 0.8`；只含板级内容的文件仍可写 `0.7`。
- `0.9` 新增（**`0.x` 的最后一个全局号**）：`procurement` 描述类型——一块板的采购选料（决策见 `docs/adr/0030-procurement-layer.md`，语法见 `spec/procurement.md`）。选料是**决定**不是事实：主料进工程哈希与板哈希，备料只进 advisory 哈希。`procurement` 文件写 `version 0.9`。**已落地**（2026-10-23）：解析器与 canonical fmt（`packages/parser`）、IR 契约 **v0.6** 的 `procurement` 分片（规范的主料分片 + 附注的备料分片）、`texteda compile --procurement` 与 `texteda check` 的接线。**未落地**：选料与件额定值的比对检查、BOM 输出（`docs/backlog.md` F35）。
- `component` 描述类型：`0.1` → `0.1.1`（PATCH）。新增 `kind` / `construction` / `polarized` 三个标量，并把 `kind` 变成必填、`kind: family` 的 `params` 变成必填（决策见 [ADR-0027](../docs/adr/0027-device-parts-families-and-library-dependencies.md)）。**这是破坏性变更**（老文件不再合法），按 §13.1 的 `0.x` 规则走 PATCH 位，改法见下：
  - **改法**（本项目尚无外部使用者，没有需要迁移的旧文件；下面是改动的机械部分）：
    1. 有 `mpn` 的文件加 `kind part`，没有 `mpn` 的文件加 `kind family`；两者都不写 `construction` / `polarized`。
    2. `kind: family` 的文件补 `construction` 与 `polarized`（按文件名与符号能推出来的就推，推不出来的由作者填）。
    3. 族文件移到 `assets/families/`；件的 id 不带值的改名由作者决定（工具不替人命名）。
    4. `instances` 行里的器件 id 跟着改名。
  - *（`0.1.3` 撤销了这条里的两件事：`family` 改名为 `generic`，器件目录也合并回 `assets/components/`——见下。）*
- `component` 描述类型：`0.1.1` → `0.1.2`（PATCH）。**删除** `package` 标量：封装代号改由封装文件自己写（`package_code`），器件只保留 `footprint` 引用（决策见 [ADR-0029](../docs/adr/0029-package-code-footprint-and-3d-model-ownership.md) decision 1）。**这是破坏性变更**（老文件不再合法），按 §13.1 的 `0.x` 规则走 PATCH 位，改法见下：
  - **改法**（同上没有需要迁移的旧文件）：
    1. 删掉器件文件里的 `package` 行。
    2. 把封装代号搬到对应的封装文件：写 `package_code <代号>`，封装文件的版本行改成 `0.4.1`。同一焊盘图案上出现两个不同代号时由作者决定留哪个。
- `component` 描述类型：`0.1.2` → `0.1.3`（PATCH）。**改名与合目录**：`kind` 的第二个取值 `family` 改名为 `generic`（"族"是厂商的词：STM32F4 族、LM35 族说的都是厂商的产品线；我们这里说的是"没有厂商的器件类别"，行业里叫 generic），两种器件**合并到同一个目录** `assets/components/**`，`kind` 只写在文件里、不再从目录推断（决策见 [ADR-0037](../docs/adr/0037-device-kind-vocabulary-and-one-device-directory.md)）。**这是破坏性变更**（`kind family` 的老文件不再合法），按 §13.1 的 `0.x` 规则走 PATCH 位，改法见下：
  - **改法**（本项目尚无外部使用者，没有需要迁移的旧文件；下面是改动的机械部分）：
    1. 器件文件里的 `kind family` 改成 `kind generic`；id、`construction`、`polarized`、`params` 一律不动。
    2. `assets/families/**` 下的文件移到 `assets/components/**`（按类别放进对应子目录）。
    3. 通用器件文件的版本行改成 `0.1.3`；`kind: part` 的文件内容没变，版本行保持 `0.1.2`（§13.4 的规矩：没用新构造的文件保持旧号）。
    4. 库里的器件同理；`lib:id` 的限定名规则不变。
- `component` 描述类型：`0.1.3` → `0.1.4`（PATCH）。**词表封闭 + 必填列按构造收紧**：`construction` 变成封闭取值集（§6.1.1）；`params` 的角色名与量纲分工写进 §6.2；必填列按 `construction` 收紧（§6.2.2）；`dielectric` 的取值变成封闭集合（§6.2.1）。**这是破坏性变更**（`construction` 拼错、介质拼错、以及缺必填列的老文件不再合法），按 §13.1 的 `0.x` 规则走 PATCH 位（决策见 [ADR-0038](../docs/adr/0038-device-vocabulary-and-parameter-roles.md)）。**改法**：
  1. `construction` 改成封闭取值集里的写法（`mlcc` / `film` / `tantalum` / `electrolytic` / `thick` / `thin` / `shielded` / `molded`）。
  2. 按 §6.2.2 给每种 `construction` 补齐必填列（例：`mlcc` 补 `dielectric`，`tantalum` 把 `voltage` 提为必填）。
  3. `dielectric` 的取值改成 IEC 60068-4 的码（`X7R` / `X5R` / `C0G` …），不归一化、不收别名。
  4. 通用器件文件的版本行改成 `0.1.4`；`kind: part` 的文件内容没变，版本行保持原号（§13.4 的规矩：没用新构造的文件保持旧号）。
  - **已落地**：上表的规则表在 `packages/core`（`devices/rules.ts`），由 `texteda check` 执行（决策见 [ADR-0038](../docs/adr/0038-device-vocabulary-and-parameter-roles.md) D7）。
- `footprint` 描述类型：`0.4` → `0.4.1`（PATCH）。新增 `package_code` 标量：这块焊盘图案的封装代号（`0402`、`SOT-23-5`、`LQFP-100`），供厂商与评审读（决策见 [ADR-0029](../docs/adr/0029-package-code-footprint-and-3d-model-ownership.md) decision 1）。加字段在 `0.x` 阶段也走 PATCH 位；没写 `package_code` 的文件仍然合法（代号通常已经在封装 id 里），但库级检查（`bun run lib:verify`）要求每个封装都写明自己的代号。
- `component` 描述类型：`0.1.4` → `0.1.5`（PATCH）。新增 `ratings` 段：`kind: part` 的件在这里写自己的额定值（`role type value`），`kind: generic` 不得写、`kind: part` 仍不得写 `params`（决策见 [ADR-0039](../docs/adr/0039-a-part-states-its-own-ratings.md)）。**IR 契约随之到 0.4**（`component` 分片多了 `ratings`）。用到 `ratings` 的件文件写 `version 0.1.5`；没写的件文件版本行不变（§13.4 的规矩：没用新构造的文件保持旧号）。
- `0.x` 阶段各描述类型的版本线各自维护、只走 PATCH 位；项目接近完成时一次性合并为 `1.0`，之后全语言一个号（见 §13.1 / §13.2）。
- 未知构造默认报错；`--allow-unknown` 仅用于前向兼容检查，不用于生产。**这是 `0.x` 阶段版本号只走 PATCH 位的安全依据**：不懂新构造的工具会报错停下，不会误读文件。
- 所有破坏性变更必须写明改了什么、怎么改（见本节）；`fmt` 不自动跨 MAJOR 迁移。本项目尚无外部使用者，所以**没有迁移脚本**：破坏性变更直接改文件，工具不替人改名、不替人决定事实。

---

## 14. 完整示例

`assets/components/regulators/tps7a02.teda`（一个 `part`）：

```
version 0.1.2
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
version 0.1.3
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

`design/sch/main.teda`：

```
version 0.2
schematic main

instances
  R1  res-th-0402  10k  ±1%
  U1  tps7a02

nets
  GND:   U1.GND  R1.2
  VIN:   U1.IN  U1.EN
  VOUT:  U1.OUT  R1.1

ports
  GND     GND
  VIN_IN  VIN
```

`design/sch/aux.teda`：

```
version 0.2
schematic aux

instances
  R1  res-th-0402  10k  ±1%
  U1  tps7a02

nets
  GND:  U1.GND  R1.2
  VIN:  U1.IN  R1.1

ports
  GND     GND
  VIN_IN  VIN
```

`design/sch/power.teda`（一块板 = 一份文件，两个电路写在同一份里）：

```
version 0.7
schematic power

instances
  R1   res-th-0402       100k   ±1%
  R2   res-th-0402       10k    ±1%
  U1   bq24610rger
  U2   tps7a02

nets
  GND:    U1.GND  R1.2  U2.GND  R2.2
  VFB:    U1.VFB  R1.1  U2.OUT  R2.1

ports
  GND  GND

constraints
  voltage  VFB   2.079V..2.121V
```

板内的 `refdes` 与 `net` 名唯一；两个电路的撞名由作者改名（上面两块电路的 `R1` 分别写成 `R1` 与 `R2`）。BOM 按 (`component_id`, 参数字典) 聚合：两块电路里的同型号同参数件合并成一行、数量相加。

`design/sch/power/charger.view.teda`（同一个板的第一个打印页，画给评审看）：

```
version 0.7
view charger

place
  R1  40  30  0
  U1  80  30  0

wire
  VFB  U1.VFB  R1.1
```

打印页引用**板级**的 `refdes` 与 `net` 名；它不创建任何连接，删掉它，板照样成立（语法见 `spec/schematic-view.md`）。

`design/system/main-stack.teda`：

```
version 0.2
system main-stack

boards
  aux
  main

nets
  GND:  aux.GND  main.GND
  VIN:  aux.VIN_IN  main.VIN_IN
```

---

## 15. 尚未定义（v0.7 之外）

以下未定或明确不支持：

- 行尾注释、引号单元格、转义、跨行值。
- `blocks` 板内层次（`module` 已落地，见 `spec/module.md`；backlog F13 的其余部分：参数、嵌套、跨工程库包）。
- 板内**绘制**划分：一块板可以有多个打印页，但那是视图层的事（`docs/adr/0025-flat-board-and-print-pages.md`）；逻辑的划分只有模块这一层。
- 一个 `port` 暴露多个 `net`；板外端点（适配器、电池、负载）；跨板线束与连接器对（见 `docs/adr/0001-board-linking.md`）。
- 生成器 / 循环 / 条件（事实层禁止；生成器在语言之外、产物是表，见 `docs/adr/0017-fact-layer-no-expressions.md`）。
- 表达式语言；v0.2 只允许约束里的比较与区间（值层与组合层不受事实层禁令约束，见 `docs/adr/0017-fact-layer-no-expressions.md` D4）。
- PCB 几何语法的剩余项（圆弧走线、圆弧板框、微孔、布局约束、封装几何是否内联）：见 `spec/pcb.md` §7。
- `logical_only` 的标记语法（`physical_only` 见 `spec/pcb.md` §4.11）。
- 多单元器件的引用简写（`U1B.OUT`）。

---

## 附录 A：EBNF（v0.5）

形状语法；词法细节以 §4 为准。

```ebnf
file       = header, { line }, EOF ;
header     = { blank | comment }, version_line, { blank | comment }, type_line ;
version_line = WS0, "version", WS1, version, WS0, NL ;
type_line  = WS0, file_type, WS1, id, WS0, NL ;
file_type  = "component" | "schematic" | "pcb" | "system" | "footprint" | "symbol" | "view" ;
version    = digit, ".", digit ;

line       = blank | comment | section | scalar | directive | row | single_row ;
blank      = WS0, NL ;
comment    = WS0, "#", { any - NL }, NL ;
section    = WS0, section_name, WS0, NL ;
scalar     = WS0, key, WS1, value, NL ;
directive  = WS0, "bus", WS1, id, WS1, "=", WS1, bus_type, WS0, NL ;
row        = WS0, cell, WS1, cell, { WS1, cell }, WS0, NL ;
single_row = WS0, cell, WS0, NL ;

value      = non_ws, { any - NL } ;
cell       = non_ws, { non_ws } ;
non_ws     = any - ( " " | "\t" | NL ) ;
key        = lower, { lower | digit | "_" } ;
id         = lower, { lower | digit | "-" } ;
bus_type   = upper, { upper | digit | "_" } ;
section_name = "params" | "pins" | "instances" | "nets" | "ports" | "boards"
             | "constraints" | "stackup" | "outline" | "place" | "connect" | "trace"
             | "via" | "zone" | "keepout" | "rules" | "silk" | "physical_only"
             | "deviation" | "pads" | "graphics" | "body"
             | "wire" | "label" | "text" ;
WS0        = { " " | "\t" } ;
WS1        = ( " " | "\t" ), { " " | "\t" } ;
```

上下文约束（EBNF 表达不了）：

1. `version_line` 是第一条有效行，`type_line` 是第二条；空行/注释可夹在中间。
2. `scalar` 只能出现在 `type_line` 之后、第一个 `section` 之前。
3. `row` 只能出现在 `section` 或 `bus` 块内。
4. `section_name` 必须属于当前文件类型：
   - `component`：`params`、`pins`
   - `schematic`：`instances`、`nets`、`ports`、`constraints`（板级另有 `modules` 段）
   - `module`：`instances`、`nets`、`ports`、`constraints`
   - `system`：`boards`、`nets`
   - `pcb`：`stackup`、`outline`、`place`、`connect`、`trace`、`via`、`zone`、`keepout`、`rules`、`silk`、`physical_only`、`deviation`
   - `footprint`：`pads`、`graphics`
   - `symbol`：`pins`、`body`
   - `view`：`place`、`wire`、`label`、`port`、`text`
5. 单单元格的非空行只能是 `section`；唯一例外是 `system` 的 `boards` 段，那里的单单元格行是 `board_id` 数据行（`single_row`）。
6. `bus` 指令只出现在 `schematic`，canonical form 中位于 `nets` 之后、`constraints` 之前。
7. `id` 的具体字符集按 §4.2；net 名允许 `.`、`+`、`-`，与文件 id 不同。
