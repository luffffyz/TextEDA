# ADR-0004：IR 的表示形式（语义模型 / 契约 / 序列化）

状态：已接受
日期：2026-10-20
影响范围：`AGENTS.md` §2、§9、§11、§12；`schemas/` 约定；新增 IR 落盘布局

## 背景

`AGENTS.md` §2 第 1 条只说"IR 是唯一真源"，没规定 IR 长什么样、怎么交换、怎么哈希。周边已经有三个硬需求指向同一个问题：

1. **渲染器与导出器是独立程序**。渲染器只读 IR（§2 第 3 条），而且要能被第三方**独立实现**（§10 conformance）。这要求 IR 有一个跨语言、跨进程的稳定表示，否则"让别人实现你的渲染器"只是一句口号。
2. **产物可追溯**（§2 第 11 条）：导出的 Gerber/图/网表携带 `source_hash + tool_version`。`source_hash` 必须对同一份设计**字节可复现**地算出来，否则追溯无意义。
3. **conformance 黄金文件**（§10）：`source → IR → netlist` 的黄金文件要能被人读、被 diff、被不同语言的实现生成与比对。

同时有三条约束限制选项：

- **默认零运行时依赖的 parser 是目标**（§12）——自研二进制格式直接出局。
- **不变量 5：每个元素有稳定 ID**，diff 与增量更新依赖它——序列化必须承载稳定 ID。
- **规模**（§7 已知坑）：IR 会随器件数膨胀，agent 不能靠整份 IR 工作。所以 IR 的表示要**给工具链用**，不是给 agent 直接读的。

`AGENTS.md` §9 已经把 `schemas/  # IR 的 JSON Schema / zod 定义（机器可读）` 写进目标结构，说明方向已定是 JSON 系；但"契约归谁""序列化要不要 canonical""数值用什么单位"还没定。

## 决策

### 1. 三层分离

| 层 | 内容 | 归属 |
|---|---|---|
| 语义模型 | 内存里的类型化对象 | 各语言各自实现，**不是文件格式** |
| 契约 | IR 的定义与约束 | **JSON Schema 2020-12**（`schemas/`） |
| 序列化 | 落盘、哈希、交换 | **JSON**，且必须 canonical |

"IR 是唯一真源"说的是**语义**，不是文件格式。语义模型可以永远不落盘；一旦要跨进程、跨语言、可哈希，就必须有 canonical 的文本投影。

### 2. 契约唯一是 JSON Schema

- `schemas/ir/<version>/<name>.schema.json` 是对外发布的唯一契约，`$id` 用 `urn:texteda:ir:<version>:<name>`。
- schema 必须是 **closed**：`additionalProperties: false`、枚举穷举、每个字段标注量纲与单位、可选性明确。不闭合的 schema 等于没有契约。
- **zod 只是 TypeScript 侧的实现细节**，不是契约。理由：zod 不能被 Python、Rust、C++ 直接消费，而 conformance 的目标就是让不同语言的实现互相验证。
- 两者并存时（`schemas/` 里同时有 JSON Schema 与 zod），**必须由同一批 conformance 用例驱动，并有一致性测试**：同一批输入，zod 与 JSON Schema 的判定结果必须相同。否则两份定义会漂移，而漂移不会报错。

### 3. 序列化用 canonical JSON

规则（写进 `AGENTS.md` 与 `schemas/` 的说明）：

| # | 规则 |
|---|---|
| 1 | UTF-8 无 BOM；LF；文件末尾一个换行 |
| 2 | 对象键按 Unicode 码位升序排列；键名用 ASCII `snake_case` |
| 3 | **只允许整数**：长度 nm、角度 毫度（1/1000°）、比例 ppm、阻抗 Ω |
| 4 | **禁止浮点**——浮点是 JSON diff 抖动与哈希不稳的头号来源 |
| 5 | 缺省字段**省略**（不写 `null`）；空集合省略；加新字段时旧 IR 的哈希不变 |
| 6 | 枚举用字符串；ID 用语义 ID（`U1`、`net:GND`、`M1.R1.2`），**不用 uuid** |
| 7 | 不写时间戳、绝对路径、随机 ID（与 `project.toml` 同规则，为了可复现） |
| 8 | 自由文本用可选的 `note` 字段（JSON 没有注释，这是它的替代品） |
| 9 | `source_hash` = SHA-256(canonical JSON 字节) |

**IR 内部一律用 SI 子单位整数**（nm / 毫度 / ppm）。单位换算只发生在两个边界：`.teda` 解析进来时，和导出到目标格式时。IR 里出现"到底是 mm 还是 nm"就是设计错误。

### 4. 落盘布局

按描述分片，与 `.teda` 的分文件结构对应，也避免出现几百 MB 的单文件：

```
dist/ir/
├── project.json
├── components/<component_id>.json
├── boards/<board_id>/schematic.json
├── boards/<board_id>/pcb.json
└── systems/<system_id>.json
```

- 渲染器与导出器默认从 `dist/ir/` 读文件（便于断点调试与 diff）；也支持从 stdin 读单个 JSON 文档。
- 落盘必须**字节可复现**：同一份源码 + 同一工具版本 → 逐字节相同的 IR。

### 5. agent 不直接读 IR

agent 的工作面是 `.teda` 源码 + 校验报告 + 按需查询。整份 IR JSON 只在工具链与黄金文件里出现。`AGENTS.md` §7 的"规模"坑由此收敛：IR 膨胀影响的是磁盘，不是上下文。

### 6. 什么时候重新评估

满足任一条才重新考虑表示形式：

- 单个 IR 文件 > 100 MB → 改 CBOR + 流式处理；
- 需要亚毫秒级反序列化 → 改二进制；
- 需要 C++ 零依赖直读 → 届时让 C++ 侧读 canonical JSON，或走 IPC 协议。

届时也**不用 Protobuf / Cap'n Proto**：固定字段号会锁死 schema 演进，代价大于收益。

## 后果

- **多一层映射代码**：每个实现都要写"模型 ↔ JSON"的一层。换来的是跨语言、跨进程、可读、可 diff、零依赖。
- **体积比二进制大**：canonical JSON 冗余明显。IR 不进版本库（`dist/` 是派生产物），所以体积不构成问题。
- **单位制收敛**：IR 里只有 nm/毫度/ppm，实现不会再在"mm 还是 nm"上出错；代价是每个实现都要在边界做换算。
- **schema 演进有代价**：closed schema 意味着加字段也要升版本（与语言版本规则一致：加字段 = MINOR，改语义 = MAJOR）。前向兼容靠显式开关（`--allow-unknown`），不靠宽松 schema。
- **zod 与 JSON Schema 双份定义的风险被显式化**：靠一致性测试兜住，而不是靠"小心维护"。

## 后续

> 本节四条已由 `docs/adr/0008-ir-shard-identity-and-hash.md` 收口（2026-10-20）：文件划分、`source_hash` 粒度、与 `project.toml` 的边界、zod 方向。下面的原文保留作为决策背景。

- `schemas/ir/v0.1/` 的文件划分与 `project` / `components` / `schematic` / `pcb` / `system` 的对应。
- zod 与 JSON Schema 的具体生成方向（JSON Schema → TS 类型，或 zod → JSON Schema），由一致性测试的要求倒推。
- `source_hash` 的粒度：整份 IR 一把哈希，还是按描述/按板分别哈希（增量与缓存需要后者）。
- IR 与 `project.toml` 元数据（`format` 版本、库锁定）的边界：哪些进 IR、哪些留在项目文件。
