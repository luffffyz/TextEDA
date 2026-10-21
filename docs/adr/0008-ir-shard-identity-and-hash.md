# ADR-0008：IR 的分片、身份键、单位与哈希粒度

状态：提议
日期：2026-10-20
影响范围：`schemas/ir/v0.1/`；`AGENTS.md` §2 第 18 条、§9；`docs/adr/0004-ir-representation.md` 的“后续”四条

## 背景

ADR-0004 定了表示形式（canonical JSON + JSON Schema 契约），把四件事留成“后续”：文件划分、`source_hash` 粒度、IR 与 `project.toml` 的边界、zod 的生成方向。写 schema 时发现还有三条 ADR-0004 没覆盖、但直接决定 schema 形状的问题：

1. **展平放在哪一层**。ADR-0007 说页内 net 展平后叫 `<page_instance_id>.<net>`。IR 是按板一份的（ADR-0004 决策 4），那么它是存“页面结构”，还是存“展平结果”，还是两份都存？
2. **身份键到底是不是名字**。ADR-0004 决策 3 规则 6 说 ID 用语义 ID（`U1`、`net:GND`、`M1.R1.2`），而源码里实例与 net 的句柄就是 refdes 和 net 名——`net_id = 展平后的 net 名`（`spec/pcb.md` §5.1）已经等于“ID 就是名字”。这与 `AGENTS.md` §2 第 5 条“显示名可以改，ID 不变”直接冲突。
3. **单位表不够用**。ADR-0004 只举了几个整数字段（长度 nm、角度毫度、比例 ppm、阻抗 Ω），但 `4R7` = 4.7 Ω、`90Ω±10%`、介电常数 4.3 这类值在“整数 Ω / 整数 ppm”下不可表示。

## 决策

### 1. 分片与源码 1:1，另加 `manifest.json`

```
dist/ir/
├── manifest.json                  # 分片清单 + 哈希
├── project.json
├── components/<component_id>.json
├── boards/<board_id>/schematic.json
├── boards/<board_id>/pcb.json
└── systems/<system_id>.json
```

- 一个 `.teda` 源文件 → 一个 IR 分片；一个分片不跨文件拆分，也不合并多个源文件。
- `boards/<board_id>/schematic.json` 一份装整块板（板根 + 所有页面），因为 ADR-0007 的展平结果只能在板级成立。
- `manifest.json` 不走源文件映射，它只登记分片路径与哈希（见决策 5）。
- 分片都带 `ir_version` 与 `source.file`（相对项目根的路径）；`format` 记录该源文件的语言版本（`0.1`–`0.4` 并存是允许的，`teda.md` §13）。
- 不写绝对路径、不写时间戳（ADR-0004 规则 7）；`manifest.json` 里的 `tool_version` 是工具自己的版本，不是时间。

### 2. 展平即唯一表示，页面结构只作属性保留

`schematic.json` 里**只有一份** `instances` 与一份 `nets`，内容就是 `teda.md` §7.7 的展平结果：

- 实例 id：页内 `M2.U1`，板根 `U1`；`page` 字段只对页内实例出现。
- net id：板级 net 用板根名（`GND`、`SYS`），页内未被端口引用的 net 用 `M2.BOOT`；被端口引用的页内 net 并入板级 net，**用板级名字**。
- `pages` 段只存页面实例化关系（`id`/`page`/`file`），供渲染分页与评审定位；它不是第二份网表。
- 端口在 IR 里落成 `ports`：页面的 `port` 带 `page`，板级 `port` 不带。
- `constraints` 的 subject 跟随展平重命名（页里写 `VFB`、展平后是 `M2.VFB`；写 `SYS`、展平后仍是板级 `SYS`）。
- 推论：**页内 net 与板级 net 的命名空间在 IR 里已经合并**，IR 消费者不需要再实现一遍展平。

### 3. 身份键 = 语义名，重命名 = 删除 + 新增

- IR 里每个实例、net、端口的身份就是它的展平后名字：实例 `M2.U1`，net `M2.BOOT`。不另造 uuid，也不另造一行“稳定 id”表（ADR-0004 规则 6）。
- 因此**重命名会改变身份**。这与 `AGENTS.md` §2 第 5 条字面冲突，按如下解释收口：第 5 条要的是“同一份设计在任何派生物里指同一物”，不是“名字变了还能认得出来”；改名在设计层面就是“旧元件消失、新元件出现”，diff 工具若要显示为改名，必须额外做匹配（不在 IR 契约内）。
- 代价明确：改名 → `source_hash` 变 → 下游产物全失效。这是可接受的：改名本来就要重新导出、重新评审。
- 若是将来要“改名不动身份”，唯一干净的做法是在 `instances`/`nets` 行加**显式 id 列**（语言变更，v0.5 候选），而不是在 IR 里补一层映射。列入待定。

### 4. 单位：两类字段，两套记法

| 字段种类 | 记法 | 单位来源 |
|---|---|---|
| 带量纲的几何/物理/规则字段 | 字段名带单位后缀：`x_nm`、`rot_mdeg`、`thickness_nm`、`width_nm`、`impedance_mohm`、`er_ppm` | 后缀即单位，读字段即知 |
| 器件参数值（`params`） | `{"name": "<param 名>", "value": <整数>}` | 由器件文件 `params` 段声明的类型决定 |

参数类型 → IR 单位（覆盖 ADR-0004 举例里不成立的“阻抗 Ω”）：

| 参数类型 | IR 单位 | 换算 |
|---|---|---|
| `resistance` | µΩ | 4R7 = 4.7 Ω = 4700000 |
| `capacitance` | fF | 100n = 100 nF = 100000000 |
| `inductance` | pH | 15u = 15 µH = 15000000 |
| `voltage` | µV | 3.3V = 3300000 |
| `current` | nA | 500mA = 500000000 |
| `power` | µW | 0.25W = 250000 |
| `frequency` | mHz | 8MHz = 8000000000 |
| `length` | nm | 0.5mm = 500000 |
| `temperature` | m°C | 85C = 85000 |
| `percent` | ppm | ±1% = 10000 |
| `integer` | 1 | — |
| `string` | — | 走 `{"name","text"}` |

- 字符串参数用 `text` 字段，与数值参数的 `value` 互斥；一条参数只出现其中一种。
- 几何字段的阻抗用 `_mohm`（90Ω = 90000），因为 `Ω` 不是整数可表示的最小单位。
- 换算只发生在两个边界：解析 `.teda` 时、导出到目标格式时（ADR-0004 决策 3 不变）。

### 5. `source_hash`：按分片算，按板与整项目聚合

- 每个分片：`sha256` 算在**该分片的 canonical JSON 字节**上，记进 `manifest.json` 的 `shards`。
- 板哈希 = `sha256`（该板所有分片的 `<path>:<sha256>\n` 按路径排序后拼接）；项目哈希同上，覆盖全部分片。板/项目哈希**不落盘**，按此规则可复算——避免“存了哈希、内容却对不上”的两份真源。
- 派生产物（Gerber、图、网表）写 `source_hash`（项目哈希）+ 所属板哈希 + `tool_version`（`AGENTS.md` §2 第 11 条）。
- 增量：改了哪个源文件就重算哪个分片，未变分片字节不变、哈希不变——这是分片存在的理由。

### 6. IR 与 `project.toml` 的边界

- `project.toml` 是**人写的**项目元数据入口；`project.json` 是它的 IR 投影，字段一一对应（`name`/`version`/`format`/`description`/`license`/`status`/`default_variant`/`authors`/`links`/`boards`/`variants`/`libs`/`compliance`/`ext`）。
- IR 不复制源文本、不复制注释、不复制 canonical 排版；IR 存语义，`source.file` 只做回溯。
- `ir_version` 与语言 `format` 独立版本：`ir_version` 只在 IR 形状变化时升，`format` 只在 `.teda` 语法变化时升。两者不是一一对应（`0.4` 的语言可以产出 `0.1` 的 IR）。

### 7. 暂不产出 zod

实现语言未定（`AGENTS.md` §11 第 13 条）。在选定之前，契约**只有** JSON Schema（`schemas/ir/v0.1/`，`$id` 为 `urn:texteda:ir:<ir_version>:<name>`）。若将来落到 TS，再由 JSON Schema 生成类型（方向：Schema → TS），一致性测试按 ADR-0004 决策 2 执行。

## 后果

- **展平只有一份**：schema 不出现“页内网表 + 板级网表”两份数据，消费者不会读到互相矛盾的两种说法；代价是 IR 里看不到“这一页原本写了什么 net 名”（只有 `source.file` 可以回去看）。
- **身份与名字绑定**：改名代价高（哈希全变），但 IR 简单、无映射层。想“改名不换身份”就得改语言加显式 id 列。
- **字段名变长**（`x_nm`、`rot_mdeg`）：换来的是读 IR 时不可能把 mm 当 nm；也避免了 JSON Schema 里为每个数值字段写一段“单位是 nm”的注释。
- **哈希分三层**：分片可缓存、板可单独追溯、项目可整体追溯；代价是任何消费者都要实现三行聚合规则。
- **约束 subject 在展平中被重命名**：写 `.teda` 的人不会察觉，但读 IR 的人必须知道 `M2.VFB` 的来源是页面 `VFB` 被展平。

## 后续

- `pcb` 分片里 `place`/`connect`/`trace` 的几何是否要**量化到固定网格**（`AGENTS.md` §7“导出边界”坑）——量化属于导出器策略还是 IR 不变量，下一轮定。
- 语言层是否加显式 `id` 列（改名不换身份）；一旦加，`ir_version` 升 MINOR，旧分片仍可读。
- `manifest.json` 是否需要记录每个分片的 `format` 与 schema `$id`，以便工具在混合版本项目里自检。
