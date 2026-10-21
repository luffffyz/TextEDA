# ADR-0019：给 agent 的契约参考与校验入口

- 状态：已定
- 日期：2026-10-21
- 影响：`packages/ir/scripts/generate.ts`、`packages/ir/src/units.ts`、`packages/cli`（`textEDA check` / `compile`）、`docs/ir-reference.md`

## 背景

项目的主要消费者是 agent（AGENTS.md §0：人只负责评审）。agent 要在一堆文件里定位两件事：

1. **IR 的某个字段是什么、单位是什么**——现在只能翻 `schemas/ir/v0.1/*.schema.json`（JSON 不好 grep）或读 `docs/adr/0008`（讲的是约定，不是逐字段对照）。
2. **我的工程哪里错了、怎么改**——诊断有码（ADR-0016）✓，但没有单一入口把「语义层 ERC + 契约层 schema 校验」汇总成一份机器可读的结果。

## 决策

### 1. IR 契约参考由 schema 生成，不手写

`docs/ir-reference.md` 由 `bun run gen` 从 `schemas/ir/v0.1/` 生成，每个字段一行：类型、是否必填、**单位**、说明。生成器与错误码文档（`docs/error-codes.md`）是同一个脚本的两个产物。

- schema 是唯一真源；文档是派生物（与 ADR-0004 的 canonical JSON 同一原则）。
- 文档**只回答两个问题**（字段类型、单位），不复述规范——避免出现第二份会漂移的规范。行为语义仍以 `teda.md` 与 `spec/` 为准，文档只给指针。
- 缺 `description` 的字段会被列在文末的覆盖率清单里；补齐说明是**写契约**，不是写文档，所以它值得做。
- **联合类型要展开**：`constraint` 这类 `oneOf`，量纲字段在分支里（`min_uv` / `max_na`）。只渲染顶层 `properties` 会让最需要查单位的字段查不到，所以生成器逐分支出表，标题带 `type=`。
- **生成器必须开 `unreachableDefinitions`**：给 `$ref` 加兄弟 `description` 会让 json-schema-to-typescript 把该引用**内联**，`Slug` / `NetOrPinRef` 这类命名类型会从类型面消失（实测：一次补说明干掉了 6 个名字，编译器只抓到 1 个）。开这个开关后每个 `$defs` 都出命名类型。

### 2. 量纲表升到 IR 层

IR 的规范单位由字段名后缀决定（ADR-0008 决策 4）：`min_uv` 是电压 µV、`value_mohm` 是阻抗 mΩ。这张后缀表此前只在解析器里（`packages/parser/src/quantities.ts`），生成器用不上。现在提到 `packages/ir/src/units.ts`：

- 它描述的是 **IR 字段名的约定**，属于契约，放在 `packages/ir` 才对；
- 解析器与生成器共用一份（不再各写一份）；
- `packages/ir` 仍然零运行时依赖（这张表是纯数据）。

### 3. `textEDA check` 是唯一的校验入口

```
textEDA check <项目目录> [--json]
```

- 覆盖工程里**全部**板（`sch/<board>.teda`），逐板解析 → 语义层 ERC → 契约层 schema 校验；
- 诊断走 ADR-0016 的统一载荷（`code` / `severity` / `location` / `data`），`--json` 打到 stdout，人读模式打到 stderr；
- 退出码：有 error 为 1，只有 warning 为 0（警告不挡门）；
- 器件文件读不出来、器件文件头 id 与文件名不一致（AGENTS.md §4.5）都算 error。

`compile` 与 `check` 共用同一个工程读取层（`packages/cli/src/project.ts`），布局知识只在一处。

### 4. 文件系统只在 CLI 层

`packages/parser/scripts/compile-schematic.ts` 迁到 `packages/cli`（`textEDA compile`）：它是用户命令，不是库代码。按 ADR-0009 决策 1，只有 CLI/导出层可以碰磁盘；把命令脚本留在 parser 包里会让「库包不碰 fs」的边界含糊。

### 5. 诊断带阶段：解析 / 契约 / 设计

`check` 的输出要能让 agent 分清"描述写坏了"和"设计有问题"。做法是按**域**归类成三个阶段（`parse` / `contract` / `semantic`），载荷带 `countsByStage`。

关键点：**阶段不需要在调用点声明**。域是封闭词表（ADR-0016），一个域只可能属于一个阶段，所以映射是纯函数（`STAGE_BY_DOMAIN`），诊断创建处一行都不用改。这一步是 F19（把 ERC 规则挪进 `packages/core`）的前置——迁移完成前，agent 已经能按阶段分流。

### 6. 修复建议（`hint`）登记在注册表里

诊断的「怎么修」此前只存在于调用点（散落、不可查）。现在注册表条目带 `hint`（这个码通常怎么修），调用点仍可给更具体的说法；载荷组装时取「调用点优先、注册表兜底」。

这样 `docs/error-codes.md` 的每一行都有「怎么修」一列，agent 拿到码就能直接动手，不用先撞一次错。注册表是唯一真源（ADR-0016 的码表属性扩展到 `hint` 字段）。

## 不做什么

- **不生成 SDK / 客户端**：IR 是数据（形状），API 是行为（parse / compile / validate / format / emit）。从 schema 生成接口会把「有哪些字段」误当成「能做什么」，而且在没有第二个消费者之前，生成的 API 没有稳定性压力。需要的是手写的小 facade（ADR-0009 的 `packages/core`）+ CLI + LSP。
- **不把 ERC 规则做成规则语言**：规则保持代码（AGENTS.md §11 Q2/Q9：表达式与生成器都推过）。要改的是**边界**——规则逐步从 parser 里挪到 core，让第三方分清「语法实现错了」和「设计有问题」。
- **不建 LSP**：等 core 稳定后再做。

## 影响

- `bun run gen` 多产出一个文档；`bun run gen:check` 照样挡住漂移。
- `bun run compile:schematic` 的实现位置变了，**命令名不变**（`bun run compile:schematic <项目目录> <board_id>` 仍可用）。
- 新增两个诊断码：`syntax.component-invalid`（器件文件解析失败）、`ref.component-id-mismatch`（器件文件头 id 与文件名不一致）。
