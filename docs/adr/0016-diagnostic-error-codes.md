# ADR-0016：诊断错误码注册表（`域.slug`）

- 状态：**已定**（2026-10-21）
- 相关：F7（backlog）、ADR-0015（开源与标准提案）、ADR-0009（实现栈）、AGENTS.md §12「错误信息是产品」
- 影响面：`packages/ir/src/diagnostics/**`、`packages/parser/src/**`、`packages/cli/**`、`docs/error-codes.md`

## 1. 决策

诊断错误码形如 `域.短 slug`（kebab-case），域取自**封闭词表**：

| 域 | 覆盖 |
|---|---|
| `syntax` | 词法 / 语法 / 解析 |
| `value` | 值与量纲（AGENTS.md §2.8） |
| `ref` | 引用与解析 |
| `contract` | IR 契约 / schema（AGENTS.md §2.7 未知构造报错） |
| `net` | net 完整性（§4.2 三态） |
| `bind` | sch↔pcb 绑定（§4.4） |
| `library` | 库级（ADR-0013） |
| `format` | 版本 / canonical（ADR-0008） |
| `drc` | 涌现检查（ERC / DRC） |
| `cli` | 调用层 |

配套三条：

1. **注册表是唯一真源**：`packages/ir/src/diagnostics/codes.ts`。`docs/error-codes.md` 由 `bun run gen` **生成**，不手写；CI 用 `bun run gen:check` 挡漂移。
2. **双向完整性检查**（`packages/ir/test/codes.test.ts`）：码表里每条都要有真实 call site；代码里每个码字面量都要在码表里。口径抄 cohdl 的 `tests/error_registry.rs`。
3. **诊断形状统一**：parser / 语义检查器 / schema 校验三个来源共用一个 `Diagnostic` 类型（`@texteda/ir/diagnostics`），`--json` 输出带 `code`。

## 2. 为什么不用 `E+数字`

数字无语义（`E1105` 是什么要查表），分类边界只能靠文档裁决，分配需要中央仲裁；插入新码要重排。slug 自解释、分配无冲突、与 JSON Pointer 同族。

紧凑数字码是历史产物：来自载荷带不动文本的环境（早期编译器、嵌入式控制台、8 位错误字节），以及"码本身就是 ABI 契约"的场合（系统调用返回值表、LSP 的整数 `code`）。textEDA 的诊断面向人和 agent，文本载荷不受带宽与存储约束，数字码在这里只剩坏处。

**真正该从 C 那里学的不是"别用数字"，而是"码一旦发布就是 ABI"**——所以本项目的码冻结，但用 slug 冻结成本低得多：新增不重排，旧码语义不动。

若将来接入 LSP / JSON-RPC 这类要求整数 `code` 的传输，整数码在**边界上**由 slug 映射生成，且必须稳定；slug 始终是真源。那是传输层的要求，不是诊断层的设计。

## 3. 域按"错误的种类"划分，不按发现阶段

单位不匹配不管在哪一层发现，都是 `value.*`；引用找不到不管是在实例行还是约束里，都是 `ref.*`。（这是 cohdl RFC-011 最聪明的一条组织原则。）

严重度与域**独立**（`error` / `warning` / `note`）：涌现检查天然有 warning，不能因为"它是 ERC"就全是 error。

## 4. 载荷

```json
{
  "code": "net.pin-in-two-nets",
  "severity": "error",
  "message": "U1.3 同时属于 net A 和 net B",
  "expected": "一个引脚只能属于一个 net",
  "actual": "U1.3 出现在 2 个 net 里",
  "hint": "删掉 net B 里的 U1.3，或改用 net tie 显式声明",
  "location": { "file": "sch/charger-buck/charger-power.teda", "line": 42, "col": 12 },
  "related": [{ "file": "sch/charger-buck.teda", "line": 18 }],
  "data": { "component_id": "U1", "pin": "3" },
  "cause": { "source": "ajv", "instancePath": "/pins/2", "keyword": "required" }
}
```

- `code` / `severity` / `location` / `data` = **机器契约**（agent 按 `code` 分支、按 `data` 自动修）。
- `message` / `expected` / `actual` / `hint` = **人读**（评审者据此改文件）。
- `hint` 的**兜底在注册表里**：注册表条目可带 `hint`（这个码通常怎么修），调用点可以给更具体的说法（带上下文）。载荷组装时取"调用点优先、注册表兜底"——这样 `docs/error-codes.md` 能列出每个码"怎么修"，agent 不必先撞一次错才知道怎么改（ADR-0019）。
- `cause` 保底：textEDA 大量诊断来自 **schema 校验**（Ajv 报在 IR 上，给的是 `instancePath`）。保留原始 `cause`，第三方实现直接用 Ajv 也能映射到 `contract.*` 码，不必各自发明一套——这是 textEDA 相对 cohdl 的优势（它没有 schema 层，第三方必须逐条实现语义检查）。
- `cli` 域的失败**不进 `--json` 诊断数组**，走 stderr + 退出码（抄 cohdl 的 E000 分类）。
- **阶段由域决定**：`parse`（syntax / value / ref / format：描述读不出来或引用断了）· `contract`（contract：IR 不满足 schema）· `semantic`（net / drc / bind / library：读得懂但设计有问题）。载荷带 `countsByStage`，三个键恒在。agent 据此判断"该改文件还是改设计"，不用逐条看码（ADR-0019 / backlog F19）。

## 5. 生命周期规则

- **码发出即冻结**：不可改义、不可重命名、不可复用。
- 语义变了 → 发新码，旧码标 `[DEPRECATED → new.code]` 并保留旧行。
- 允许"重定位"（同一语义换位置），但新旧码必须指向同一语义。
- **域词表封闭**：新增域要写 ADR（防域膨胀成"按文件分"）。
- 码表属**契约层**（不变量 19）：不许随实现关起来。

## 6. 旧码迁移表

旧的编号码（`F200` / `S113` / `C007` …）在本次决策后全部退役。它们从未对外发布（仓库未公开），因此不保留旧行，只在这里留映射，方便读过旧码的人对照。

| 旧码 | 新码 |
|---|---|
| `C001` | `syntax.header-invalid` |
| `C002` | `syntax.row-too-short` |
| `C003` | `value.pin-number-invalid` / `value.pin-name-invalid` |
| `C004` | `value.electrical-type-unknown` |
| `C005` | `library.duplicate-pin-number` |
| `C006` | `library.pins-empty` |
| `C007` | `value.pin-column-invalid` |
| `F100` | `value.length-invalid`（角度处 `value.angle-invalid`） |
| `F101` | `value.ratio-invalid` |
| `F110` | `syntax.unknown-section` |
| `F111` | `syntax.unknown-field` |
| `F112` | `syntax.row-too-short` |
| `F113` | `syntax.header-invalid` / `format.invalid-version` / `format.unsupported-version` / `syntax.invalid-token` |
| `F200` | `value.pad-number-invalid` / `value.pad-type-unknown` / `value.pad-shape-unknown` / `value.pad-size-invalid` |
| `F201` | `value.pad-attribute-invalid`（其中"未知键"改判 `syntax.unknown-field`） |
| `F202` | `value.pad-ratio-invalid` |
| `F203` | `value.pad-connection-unknown` |
| `F204` | `value.layer-name-invalid` |
| `F210` | `library.pads-empty` |
| `F211` | `library.duplicate-pad-number` |
| `F300` | `value.graphic-invalid` |
| `F301` | `value.graphic-attribute-invalid` |
| `F400` | `library.model-invalid` / `library.field-invalid` |
| `S110` | `syntax.unknown-section` / `syntax.unknown-field` |
| `S111` | `syntax.invalid-literal` / `value.length-invalid` |
| `S112` | `syntax.row-too-short` |
| `S113` | `syntax.header-invalid` / `format.invalid-version` / `format.unsupported-version` / `syntax.invalid-token` |
| `S200` | `value.pin-number-invalid` / `value.pin-geometry-invalid` |
| `S201` | `value.pin-attribute-invalid` |
| `S202` | `value.invalid-unit` / `syntax.row-too-short` |
| `S210` | `library.pins-empty` |
| `S211` | `library.duplicate-pin-number` |
| `S212` | `syntax.row-too-short` |
| `S300` | `value.graphic-invalid` |
| `S301` | `value.graphic-attribute-invalid` |
| `S312` | `syntax.row-too-short` |
| `S400` | `library.field-invalid` |

拆分与改判的理由：

- 旧码把"结构问题"和"值问题"混在一个编号里（如 `F201` 同时报"通孔缺 drill"和"未知键 bogus"）。拆开后 `syntax.unknown-field` 与 `value.*` 各归各的域，agent 才能按域分支。
- 旧码的编号与语义本来就对不齐（`C003` 报的是引脚号/名不合法，`C007` 报的是 unit/alt/未知列），这正是编号码不可维护的证据。

## 7. 后果

- **代价**：注册表是又多一处要维护的东西；新增码要先改表。缓解：码表由类型强制（`Diagnostic["code"]` 是注册表的键，野生码编译不过），新增码没有"分配编号"的仪式成本。
- **收益**：第三方实现者能按 `code` 对齐行为；`--json` 载荷稳定；错误文案可以随便改而不破坏契约。
- **不做**：码的**严重度**不随实现自由裁量（注册表给出规范严重度，调用点可降级但不可升级）；暂不做 `fix` 字段（机械修复的抓手留给后续）。
