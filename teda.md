# `.teda` 格式规范（v0.5，草案）

状态：草案。`AGENTS.md` 记录设计决策与边界，本文件定义具体格式。两者冲突时，以 `AGENTS.md` 的不变量为准，并修本文件。

本文件描述当前提议的**表格式**；`AGENTS.md` §11 第 1 条的“表 vs 链式”仍待十用例验证，可被 ADR 推翻。表内具体列也按同一原则处理。

---

## 0. 一句话

`.teda` 是**一行一事实**的文本格式：文件头声明类型，段（section）放表，表行的列由该段的 schema 解释。

```
version 0.1
schematic main

instances
  R1  r-0402  10k  ±1%
  U1  tps7a02

nets
  GND:   U1.GND  R1.2
  VIN:   U1.IN  U1.EN
  VOUT:  U1.OUT  R1.1
```

---

## 1. 设计约束

1. 一行一个事实；不允许需要读下一行才能理解的结构。
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

七种文件类型：

| 类型 | 位置 | 说明 |
|---|---|---|
| `component` | `components/**/<component_id>.teda` | 一块料一个文件，可放子目录 |
| `schematic` | `sch/<board_id>.teda` | 一块板一个文件 |
| `pcb` | `pcb/<board_id>.teda` | 可后置，可为空 |
| `system` | `system/<system_id>.teda` | 多板连接描述，一份系统一个文件（v0.2 新增） |
| `page` | `sch/<board_id>/<page_id>.teda` | 板内页面，板的一个划分单元（v0.3 新增） |
| `footprint` | `footprints/<lib>/<footprint_id>.teda` | 库产物：一个封装的规范几何（v0.4 新增） |
| `symbol` | `symbols/<lib>/<symbol_id>.teda` | 库产物：一个符号的视图（v0.5 新增） |

文件名必须等于头部 id；不一致报错。`components/` 允许子目录，子目录只用于分类；`component_id` 取文件名（不含 `.teda`），不取相对路径，同一 id 在 `components/` 树内必须唯一。顶层目录与文件类型必须一致（`components/` 只放 `component`，以此类推）；`sch/` 下有两种：`sch/<board_id>.teda` 是板根（`schematic`），`sch/<board_id>/<page_id>.teda` 是该板的页面（`page`）。`footprints/` 与 `symbols/` 是**库目录**而不是描述目录：它们按库分子目录（`footprints/<lib>/`、`symbols/<lib>/`），库名由目录决定（IR 的 `footprint.library` / `symbol.library`），不进文件内容。

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

---

## 4. 词法

### 4.1 空白

空格或制表符；连续空白视为一个分隔符。行首行尾空白忽略。段内行的缩进不参与解析。

### 4.2 标识符

| 名称 | 规则 | 示例 |
|---|---|---|
| `component_id` / `board_id` / `page_id` | `[a-z][a-z0-9-]*` | `tps7a02`, `r-0402`, `ch32v307vct6` |
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
version 0.1
component tps7a02
```

- 版本行必须是第一条有效行；类型行必须是第二条。
- 工具接受同 MAJOR 且 MINOR ≤ 自身支持的版本（支持 0.2 的工具接受 `0.1` 与 `0.2`）。遇到更高版本默认报错；`--allow-unknown` 可放宽。
- 类型行与目录必须一致。
- 头部 id 与文件名必须一致。

---

## 6. `component` 文件

### 6.1 标量（段之前）

| 键 | 必填 | 说明 |
|---|---|---|
| `mpn` | 是* | 制造商料号；通用无源件可省，见下 |
| `package` | 是 | 封装名，如 `SOT-23-5`、`LQFP-100` |
| `manufacturer` | 否 | 厂商 |
| `category` | 否 | 器件类别，开放取值集：`mcu` / `resistor` / `capacitor` / `inductor` / `led` / `diode` / `mosfet_p` / `regulator` / `battery_charger` / … |
| `datasheet` | 否 | URL |
| `lcsc` | 否 | 嘉立创商城料号（`C` + 数字），供 BOM 匹配 SMT 物料；见 `docs/adr/0006-jlc-prototype-delivery.md` |
| `symbol` | 是 | `lib:name` |
| `footprint` | 是 | `lib:name` |

`*` 通用无源件（`category` 为 `resistor` / `capacitor` / `inductor`，且 `params` 含 `value`）可省略 `mpn`，由 `value` 区分具体规格；具体料号必须写 `mpn`。

`category` 是**器件类别**，取值是**开放集合**：不设封闭目录，库里没有的类别直接用，小写加下划线。它只做分类与免 `mpn` 判定，不参与校验逻辑分支；与文件头的类型（`component` / `schematic` / `pcb` / `system`）无关。

### 6.2 `params` 段（可选）

声明该器件在 `instances` 行里允许的额外列：

```
params
  value      resistance  required
  power      power       optional
  tolerance  percent     optional
```

列：`name type required|optional`。

`required` 必须排在 `optional` 之前，因此 `instances` 行只需从右往左省略 optional 列。

类型：`resistance`、`capacitance`、`inductance`、`voltage`、`current`、`power`、`frequency`、`length`、`temperature`、`percent`、`integer`、`string`。

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
- 名称在 `(unit, name)` 内唯一；默认 `unit=1`。
- 引脚类型见 §10.1。
- `pins` 对指向**自建符号**的器件是**必填**：自建 `symbol` 只描述视图，不带引脚名与电气类型（ADR-0012），事实只能内联。
- 可以省略的唯一情形：`symbol` 指向**自带引脚事实**的第三方库（如 KiCad `.kicad_sym`），此时引脚由库解析、`pins_source = symbol`。自建符号不能成为这个来源。
- 两种来源同时存在时**内联优先**（用于修正库里的错误）；差异由校验报告输出，不静默采用。

---

## 7. `schematic` 文件

### 7.1 `instances` 段

`components/` 存器件定义；本段存放置实例，同一 `component_id` 可被多行引用。

```
instances
  R1  r-0402  10k  ±1%
  U1  tps7a02
```

列：`refdes component_id [param...]`。

- `component_id` 必须在 `components/` 树中按文件名找到；同一 id 只允许一个文件；否则报错。
- 额外列与该器件 `params` 段**声明的顺序**一一对应（不按名字或类型猜）；`optional` 列只能从右往左省略，`required` 列不能省略。
- `refdes` 在本文件内唯一。板根与页面各自是独立命名空间，跨页面可重复；展平时重编（§7.7）。
- 封装不在 `instances` 行写，由器件文件决定。

### 7.2 `nets` 段

```
nets
  GND:   U1.GND  R1.2
  VIN:   U1.IN  U1.EN
  VOUT:  U1.OUT  R1.1
```

- 首个单元格是 net 名，可带尾随 `:`；`:` 单独成格也接受。canonical form 写成 `name:`，成员之间至少两个空格。
- 其余单元格是引脚引用。
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
- 成员行格式同 `nets`。
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

`port` 是**容器内 `net` 的对外名字**。声明 `ports` 的容器只有两个：页面与板，用的是同一套语法；系统级描述消费板级端口（§8）。

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
- 容器内的 `net` 名不参与跨容器对齐，跨容器只靠 `port` 对齐。
- 板级 `ports` 声明这块板对外的接口，`system` 文件用它连接多块板（§8）。
- 页面 `ports` 声明页内 `net` 对板级的接口，板根用它把页面接到板级 `net`（§7.6、§7.7）。

---

### 7.6 `pages` 段（可选，v0.3）

一块板可以拆成多个页面。页面是板内的**划分单元**：一个 page 画不下，或者评审要分块看。页面不是独立板，不产生独立 PCB，也不产生独立 BOM。决策见 `docs/adr/0002-board-pages-and-bom.md`。

```
pages
  M1  charger-power
  M2  buck-5v
```

列：`page_instance_id page_id`。

- `page_instance_id` 是板内唯一的页面实例名，命名规则同 `refdes`（§4.2）；它与板根的 `refdes` 共处板级命名空间，不得同名。
- `page_id` 解析到 `sch/<board_id>/<page_id>.teda`（按约定解析，规范不写项目里的具体路径）；该文件必须是 `page` 类型，头部 id 与文件名一致。
- 每个页面在板里**实例化一次**；同一页在一块板上出现多份属于复用，v0.4 再谈（§15）。
- 页面被声明后，它的每个实例都参与展平（§7.7）：板级 ERC 与 BOM 都包含页面内的器件。

---

### 7.7 页面文件（`page`，v0.3）

页面文件描述板内的一个划分。它与 `schematic` 同构但更窄：有 `instances`、`nets`、`ports`、`constraints`，没有 `pages` 段。

```
version 0.3
page charger-power

instances
  R1    r-0402       100k    ±1%
  U1    bq24610rger

nets
  GND:  U1.GND  R1.2
  VFB:  U1.VFB  R1.1

ports
  GND      GND
  VFB_OUT  VFB

constraints
  voltage  VFB   2.079V..2.121V
```

- 段顺序：`instances`、`nets`、`ports`、`constraints`。
- 页面里的 `net` 与 `refdes` 是**局部**的：只在页面内唯一，只在页面内可见。
- `ports` 段语法同 §7.5；`port` 是页内 `net` 的页面外名字。
- 板根 net 引用页面端口写作 `M1.SYS_OUT`（`<page_instance_id>.<port_id>`）。引用不存在的页面、或页面没声明的端口，都报错。
- 页面里不被任何 `port` 暴露的 `net` 是页面内部节点，不参与板级 `net`，合法。页面声明了端口但板根没用它 → 警告（悬空端口）。
- **展平后的 net 集合与命名**：板根的 `net` 取板根的名字；页面里经 `port` 被板根引用的 `net` 并入那个板级 net，改用板级 net 的名字；页面里没被引用的页内 `net` 仍留在展平结果里（pcb 要连它、ERC 要查它），名字是 `<page_instance_id>.<net>`（如 `M2.BOOT`）——不同页面可以有同名页内 net（`charger-power` 页与 `buck-5v` 页各有一个 `PH`），不限定名就会撞车。板级 net 名不得含 `.`，免得与这种命名空间形式重名。决策见 `docs/adr/0007-page-internal-net-naming.md`。
- **展平**：板 = 板根实例 + 每个页面实例化一次后的实例。ERC 与 BOM 都在展平结果上跑。
- **稳定 id**：页内实例 = `M1.R1`（`<page_instance_id>.<refdes>`），板根实例 = `R1`。`refdes` 只是显示名，跨页允许重复；导出网表、贴片、BOM 时重编为板级唯一（KiCad 式自动注解），页面归属记在注释里。
- **BOM**：行 = (`component_id`, 参数字典, 变体状态)，聚合键**不含** `refdes`；数量 = 展平后的实物数。详见 §11。

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
- 该板必须有 `sch/<board_id>.teda`；`pcb` 可缺省。
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

`input`、`output`、`bidirectional`、`tri_state`、`passive`、`power_in`、`power_out`、`power`、`open_collector`、`open_emitter`、`no_connect`、`unspecified`。

其中 `power` 表示地/参考节点；`power_in` 表示供电输入。

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

1. 文件头：版本、文件类型、id/文件名、顶层目录/类型一致；`components/` 的子目录只做分类，不参与 `component_id`。
2. 词法：未知段、未知键、单元格数量、非法标识符。
3. 器件：`instances` 引用的 id 存在；`params` 数量/类型匹配；引脚编号唯一，引脚名在 `unit` 内唯一；`symbol` 指向自建库时必须有 `pins` 段（自建符号不带引脚事实）；`category` 为通用无源件且 `params` 含 `value` 时 `mpn` 可省，否则必须有 `mpn`；`lcsc` 若出现必须匹配 `C[0-9]+`。
4. 连接：引脚引用可解析；每个引脚最多一个 net；`no_connect` 不得连接；单成员 net 警告（**按展平后的 net 判**：板级只由页面端口组成的 net 不算单成员，它是板内的节点声明；带板级端口的 net 不算单成员，那个引脚是往板外走的）。
5. 约束：subject 存在；单位/量纲兼容；区间有效。
6. 变体（`project.toml`）：`dnp`/`nofit` 引用的 component_id 存在。
7. sch↔pcb（两者都存在时）：按 `AGENTS.md` §4.4 的绑定规则。
8. 端口（`ports` 段）：引用的 `net` 存在；`port_id` 不重复；同一个 `net` 最多被一个 `port` 引用。
9. 系统（`system` 文件）：`boards` 的 `board_id` 在 `project.toml` 的 `[boards]` 中存在且有 `sch` 文件；`nets` 成员是已声明的 `port`；每条系统 `net` 至少两个成员；同一块板的同一个 `net` 不被并进两条系统 `net`；两侧电压约束区间不相交时报错。
10. canonical form（§12）：不满足的文件在 `fmt --check` 下报错；`fmt` 修复后语义不变。
11. 页面（`pages` 段与 `page` 文件）：`page_id` 解析到的文件存在、是 `page` 类型、头部 id 与文件名一致；`page_instance_id` 板内唯一，且不与板根 `refdes` 同名；板根 net 引用的页面端口可解析；页面声明了端口但板根未引用 → 警告。
12. 展平：板 = 板根实例 + 每个页面实例化一次后的实例；展平后每个引脚最多属于一个 net，`no_connect` 不得连接。
13. BOM：行 = (`component_id`, 参数字典, 变体状态)；聚合键不含 `refdes`；数量 = 展平后的实物数。
14. 变体：只影响 BOM 与制造，不改变连通性；引用 `component_id` 作用于该型号的所有实例，引用稳定 id 只作用于该实例；不影响 ERC 结果。
15. pcb（`pcb` 文件存在时）：按 `spec/pcb.md` §5.2 执行；sch↔pcb 绑定与偏差白名单见 `AGENTS.md` §4.4。
16. footprint（库文件存在时）：按 `spec/footprint.md` §7 执行；库级检查（引脚号比对、DRC）不在这层。
17. symbol（库文件存在时）：按 `spec/symbol.md` §7 执行；库级检查（与 `component` 的引脚号集合比对）不在这层。

诊断格式：`file:line:col: <severity> <code>: <message>`；`--json` 输出同字段。严重级别：`error` / `warning`。

---

## 12. Canonical form

`fmt` 必须满足：`parse(fmt(x))` 与 `parse(x)` 语义相同，且 `fmt(fmt(x)) == fmt(x)`。

规则：

1. 段顺序固定：
   - component：`params`、`pins`
   - schematic：`instances`、`nets`、`pages`、`ports`、`bus`、`constraints`
   - page：`instances`、`nets`、`ports`、`constraints`
   - system：`boards`、`nets`
   - pcb：见 `spec/pcb.md` §6.1（`stackup`、`outline`、`place`、`connect`、`trace`、`via`、`zone`、`keepout`、`rules`、`silk`、`physical_only`、`deviation`）
   - footprint：`pads`、`graphics`；标量顺序与行的排序见 `spec/footprint.md` §8
   - symbol：`pins`、`body`；标量顺序与行的排序见 `spec/symbol.md` §8
2. 行排序（名称一律按 ASCII 字节序；`instances` 的 refdes 按自然序，数字按数值比较）：
   - `instances` 按 refdes 自然序
   - `nets` 按 net 名
   - `pages` 按 page_instance_id
   - `ports` 按 port_id
   - system 的 `boards` 按 board_id
   - system `nets` 的成员按 `<board_id>.<port_id>` 字典序
   - `pins` 按编号数值
   - `params` 保持源文件顺序（声明顺序即实例行的列序）；`required` 列必须排在 `optional` 列之前，否则报错
   - pcb 各段的排序与归一见 `spec/pcb.md` §6.2
   - `constraints` 保持源文件顺序
3. 列对齐：同段内按最宽单元格对齐，列间至少两个空格。
4. 段之间一个空行；无行尾空白；文件末尾一个换行。
5. 整行注释保留，并跟随其后的行移动。
6. 单元格内容不变，只调整分隔空白：表段单元格之间至少两个空格并对齐；标量行（"键 + 值"）用单个空格分隔，多单元格的值（如 `description`）按单元格重排，连续空白归一。
7. `net` 行的 canonical 形式：网名紧贴冒号（`SYS:`），冒号后至少两个空格，成员之间至少两个空格；同段内所有行的成员起始列相同。`ports` 与 `boards` 行同样按最宽单元格对齐。

---

## 13. 版本与兼容

- `version` 为 `MAJOR.MINOR`。加字段/加段为 MINOR；改语义/删字段为 MAJOR。
- `0.2` 新增：`sch` 的 `ports` 段、`system` 描述类型（决策见 `docs/adr/0001-board-linking.md`）。未使用新构造的文件保持 `0.1`。
- `0.3` 新增：`page` 描述类型、`sch` 的 `pages` 段、板内展平与 BOM 计数规则（决策见 `docs/adr/0002-board-pages-and-bom.md`）。用到页面或 `pages` 段的板根与页面文件写 `version 0.3`。
- `0.4` 新增：`pcb` 描述的完整段集（决策见 `docs/adr/0003-agent-first-pcb-ir.md`，语法见 `spec/pcb.md`）；`component` 的 `lcsc` 标量（决策见 `docs/adr/0006-jlc-prototype-delivery.md`）；`footprint` 描述类型（决策见 `docs/adr/0011-library-format-and-footprint-ir.md`，语法见 `spec/footprint.md`）。用到 `pcb` 段、`lcsc` 或 `footprint` 的文件写 `version 0.4`。
- `0.5` 新增：`symbol` 描述类型（决策见 `docs/adr/0012-symbol-description.md`，语法见 `spec/symbol.md`）。用到 `symbol` 的文件写 `version 0.5`。
- 工具接受同 MAJOR 且 MINOR ≤ 自身支持的版本；更高 MINOR 默认报错。
- 未知构造默认报错；`--allow-unknown` 仅用于前向兼容检查，不用于生产。
- 所有破坏性变更必须提供迁移说明；`fmt` 不自动跨 MAJOR 迁移。

---

## 14. 完整示例

`components/regulators/tps7a02.teda`：

```
version 0.1
component tps7a02

mpn          TPS7A02DBVR
manufacturer Texas Instruments
package      SOT-23-5
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

`sch/main.teda`：

```
version 0.2
schematic main

instances
  R1  r-0402  10k  ±1%
  U1  tps7a02

nets
  GND:   U1.GND  R1.2
  VIN:   U1.IN  U1.EN
  VOUT:  U1.OUT  R1.1

ports
  GND     GND
  VIN_IN  VIN
```

`sch/aux.teda`：

```
version 0.2
schematic aux

instances
  R1  r-0402  10k  ±1%
  U1  tps7a02

nets
  GND:  U1.GND  R1.2
  VIN:  U1.IN  R1.1

ports
  GND     GND
  VIN_IN  VIN
```

`sch/power.teda`（板根，两个页面）：

```
version 0.3
schematic power

pages
  M1  charger
  M2  regulator

nets
  GND:  M1.GND  M2.GND
  VFB:  M1.VFB_OUT  M2.VFB_IN

ports
  GND  GND
```

`sch/power/charger.teda`（页面）：

```
version 0.3
page charger

instances
  R1  r-0402  100k  ±1%
  U1  bq24610rger

nets
  GND:  U1.GND  R1.2
  VFB:  U1.VFB  R1.1

ports
  GND      GND
  VFB_OUT  VFB

constraints
  voltage  VFB   2.079V..2.121V
```

`sch/power/regulator.teda`（页面）：

```
version 0.3
page regulator

instances
  R1  r-0402  100k  ±1%
  U1  tps7a02

nets
  GND:  U1.GND  R1.2
  VFB:  U1.OUT  R1.1

ports
  GND     GND
  VFB_IN  VFB

constraints
  voltage  VFB   2.079V..2.121V
```

展平后板上有 `M1.R1`、`M1.U1`、`M2.R1`、`M2.U1`；BOM 按 (`component_id`, 参数字典) 聚合，两个页面里的同型号同参数件合并成一行、数量相加。

`system/main-stack.teda`：

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

## 15. 尚未定义（v0.5 之外）

以下未定或明确不支持：

- 行尾注释、引号单元格、转义、跨行值。
- `module` / `blocks` 板内层次与端口映射（草案见 `AGENTS.md` §5.3；与板间连接正交）。
- 同一页面在一块板上实例化多次（页面参数与端口映射，v0.4 讨论；见 `docs/adr/0002-board-pages-and-bom.md`）。
- 一个 `port` 暴露多个 `net`；板外端点（适配器、电池、负载）；跨板线束与连接器对（见 `docs/adr/0001-board-linking.md`）。
- 生成器 / 循环 / 条件。
- 表达式语言；v0.2 只允许约束里的比较与区间。
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
file_type  = "component" | "schematic" | "pcb" | "system" | "page" | "footprint" | "symbol" ;
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
section_name = "params" | "pins" | "instances" | "nets" | "pages" | "ports" | "boards"
             | "constraints" | "stackup" | "outline" | "place" | "connect" | "trace"
             | "via" | "zone" | "keepout" | "rules" | "silk" | "physical_only"
             | "deviation" | "pads" | "graphics" | "body" ;
WS0        = { " " | "\t" } ;
WS1        = ( " " | "\t" ), { " " | "\t" } ;
```

上下文约束（EBNF 表达不了）：

1. `version_line` 是第一条有效行，`type_line` 是第二条；空行/注释可夹在中间。
2. `scalar` 只能出现在 `type_line` 之后、第一个 `section` 之前。
3. `row` 只能出现在 `section` 或 `bus` 块内。
4. `section_name` 必须属于当前文件类型：
   - `component`：`params`、`pins`
   - `schematic`：`instances`、`nets`、`pages`、`ports`、`constraints`
   - `page`：`instances`、`nets`、`ports`、`constraints`
   - `system`：`boards`、`nets`
   - `pcb`：`stackup`、`outline`、`place`、`connect`、`trace`、`via`、`zone`、`keepout`、`rules`、`silk`、`physical_only`、`deviation`
   - `footprint`：`pads`、`graphics`
   - `symbol`：`pins`、`body`
5. 单单元格的非空行只能是 `section`；唯一例外是 `system` 的 `boards` 段，那里的单单元格行是 `board_id` 数据行（`single_row`）。
6. `bus` 指令只出现在 `schematic`，canonical form 中位于 `nets` 之后、`constraints` 之前。
7. `id` 的具体字符集按 §4.2；net 名允许 `.`、`+`、`-`，与文件 id 不同。
