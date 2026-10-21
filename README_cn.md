# TextEDA

[English](README.md) | [简体中文](README_cn.md)

用**人写的文本描述**来表达一块硬件：原理图（`sch`）与 PCB（`pcb`）是两个独立描述，互为兄弟；IR 是唯一真源，源码与任何渲染结果都是派生物。

面向 agent：机器可解析、可校验、错误可定位；人只负责评审。

> 本仓库按 **Apache-2.0** 授权（见 `LICENSE` / `NOTICE`），项目在建中。
>
> **契约层永久开源**：`teda.md` / `spec/` / `schemas/` / `examples/` / `tests/` 永远公开可实现，不改为闭源；实现层（`packages/`）可另行许可。定位是**纯开源技术规范**——没有商业计划、没有收入模型、没有付费服务。实现契约所需的一切都免费且不受限制，且不会变。目标只有一个：**被采用**（规范被引用、被实现、被别人的工具链依赖）。
>
> GitHub 上仓库**当前仍是私有**：许可与"将来一定公开"的承诺已经落定，公开前的内部信息清扫也已完成（`bun run check:public` 通过：历史里没有厂商 datasheet、没有凭据、没有维护者的机器路径）。剩下的是切开关这一步人工操作。详见 [ADR-0015](docs/adr/0015-licensing-and-open-standard.md) 与 `docs/backlog.md` F6。

## 现在能做什么

```bash
bun install
bun test                # 单元 + 契约 + round-trip
bun run typecheck       # 六个包一起过 tsc
bun run lib:verify      # 库级闭环（**零外部依赖**）
bun run lib:verify:kicad  # 可选：追加 KiCad 互操作段（KiCad 能读能渲染、合并板 DRC 0 违规）
bun run check:links      # 全部 Markdown 链接与 ADR 交叉引用可解析
bun run check:public     # 公开前清扫：历史里没有厂商 PDF、没有凭据
bun run preview symbol bq24610rger     # 画符号（不依赖 KiCad）
bun run preview component bq24610rger  # 画器件的符号 + 封装
bun run fmt:teda --check examples/reference-project   # canonical form 检查
bun run compile:schematic examples/reference-project mcu-board   # 板级 IR（诊断带错误码）
bun run check examples/reference-project          # 校验工程里全部板（ERC + IR 契约）
bun run texteda netlist examples/reference-project --board mcu-board  # 网表 = IR 的连通性投影
bun run texteda init ./my-board        # 生成空工程骨架
```

当前状态：工具链前半段已落地（语言 → IR → KiCad 导出 → 预览渲染）。`schematic` / `page` 解析（实例、net、port、约束、bus、页面展平）、`pcb` 解析（12 段 → `pcb` IR）、四种描述的 canonical formatter、连通性 ERC 与 sch↔pcb 绑定校验（`packages/core`）都能用。板级设计（布局、布线、制造出口）未实现；KiCad 仍是制造出口（[ADR-0005](docs/adr/0005-manufacturing-output.md)）。

给 agent 用的两份派生物（都由 `bun run gen` 生成，不手改）：

| 文件 | 回答什么 |
|---|---|
| `docs/error-codes.md` | 诊断码 → 含义、严重度、对应规范 |
| `docs/ir-reference.md` | IR 字段 → 类型、必填、**单位**、说明（覆盖率清单在文末） |

## 结构

| 路径 | 是什么 |
|---|---|
| `AGENTS.md` | **主文档**：项目是什么、不可协商的不变量、验证与验收口径 |
| `LICENSE` / `NOTICE` | Apache-2.0 与归属声明 |
| `teda.md` | `.teda` 语法总览 |
| `spec/` | 分描述规范：`project` / `schematic` / `pcb` / `symbol` / `footprint` / `system` |
| `schemas/ir/v0.1/` | IR 契约（JSON Schema 2020-12，唯一契约） |
| `packages/ir` | IR 类型与契约校验 |
| `packages/parser` | `.teda` → IR，含 `fmt`（canonical form） |
| `packages/core` | 纯规则：连通性 ERC 与 sch↔pcb 绑定，不碰 fs |
| `packages/exporter` | 封装 / 符号 → KiCad（`.kicad_mod` / `.kicad_sym`）；网表 |
| `packages/renderer` | 参考渲染器：IR → 绘图指令 → SVG（[ADR-0014](docs/adr/0014-reference-renderer.md)） |
| `packages/cli` | `texteda init` / `compile` / `check` / `netlist`（[ADR-0019](docs/adr/0019-agent-contract-reference-and-check-entry.md)） |
| `examples/reference-project/` | 自包含的参考工程：22 个器件 / 15 个符号 / 16 个封装，库全部自建 |
| `docs/adr/` | 决策记录（ADR），0001–0019（[完整索引](docs/adr/README.md)；0017 与 0020 已预留） |
| `docs/backlog.md` | 待办清单 |

## 决策记录

- [ADR-0001](docs/adr/0001-board-linking.md) 板之间如何连接
- [ADR-0002](docs/adr/0002-board-pages-and-bom.md) 板内分页、展平与 BOM 计数
- [ADR-0003](docs/adr/0003-agent-first-pcb-ir.md) agent-first 的 PCB IR
- [ADR-0004](docs/adr/0004-ir-representation.md) IR 形态与单位约定
- [ADR-0005](docs/adr/0005-manufacturing-output.md) 制造出口归 KiCad
- [ADR-0006](docs/adr/0006-jlc-prototype-delivery.md) 嘉立创打样交付：BOM、坐标、料号绑定
- [ADR-0007](docs/adr/0007-page-internal-net-naming.md) 展平后的 net 集合与命名
- [ADR-0008](docs/adr/0008-ir-shard-identity-and-hash.md) IR 分片、身份键、单位与哈希粒度
- [ADR-0009](docs/adr/0009-implementation-stack.md) 实现栈：TypeScript、Bun、渲染分层、IDE 接入面
- [ADR-0010](docs/adr/0010-footprint-and-3d-model-ownership.md) 自建封装与 3D 模型的所有权
- [ADR-0011](docs/adr/0011-library-format-and-footprint-ir.md) 自建封装库用自己的格式
- [ADR-0012](docs/adr/0012-symbol-description.md) 符号描述：引脚名与电气类型归器件
- [ADR-0013](docs/adr/0013-reference-project-self-built-libraries.md) 参考工程全部自建
- [ADR-0014](docs/adr/0014-reference-renderer.md) 自研参考渲染器，预览不依赖 KiCad
- [ADR-0015](docs/adr/0015-licensing-and-open-standard.md) 许可与开放策略：契约层永久开源，项目是纯开源技术规范
- [ADR-0016](docs/adr/0016-diagnostic-error-codes.md) 诊断错误码注册表：`域.slug`，发出即冻结
- [ADR-0018](docs/adr/0018-zero-dependency-and-manufacturing-target.md) 零依赖原则与制造出口目标形态：KiCad 是可选后端
- [ADR-0019](docs/adr/0019-agent-contract-reference-and-check-entry.md) agent 契约参考与 `check` 入口

完整索引（含标题、状态、日期）见 [docs/adr/README.md](docs/adr/README.md)。

## 造器件

- [docs/symbol-authoring.md](docs/symbol-authoring.md) 造符号
- [docs/footprint-authoring.md](docs/footprint-authoring.md) 造封装

## 语言策略

源码（`.ts`、schema、`.teda` 示例）只允许英文；`docs/` 与 `spec/` 下的设计文档用中文，**唯一例外是 `docs/adr/` 用英文**——ADR 属于契约层，`spec/`、`schemas/`、`teda.md` 按编号引用它的决策，第三方实现者要读得懂。`README.md` 是英文入口，`README_cn.md` 承载中文。
