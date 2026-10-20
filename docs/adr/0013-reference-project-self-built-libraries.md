# ADR-0013：参考工程全部自建——符号与封装库都在项目内，库级校验闭环

状态：已接受
日期：2026-10-20
影响范围：ADR-0010（自建库）、ADR-0011（库格式）、ADR-0012（符号库）；`examples/reference-project/`（`project.toml`、`components/`、`symbols/project/`、`footprints/project/`）；`schemas/ir/v0.1/project.schema.json`（`lib.symbols` / `lib.footprints`）；`scripts/libhash.ts`；`scripts/verify-libs.ts`；`packages/exporter/src/symbol.ts`（stroke 修正）；`docs/footprint-authoring.md`；`docs/symbol-authoring.md`；`AGENTS.md` §4.5、§9、§10

## 背景

参考工程 `examples/reference-project/` 原本靠**借来的库**跑通全流程：22 个器件的 `symbol` / `footprint` 指向 KiCad 官方库与嘉立创的 `wch_kicad_library`，`project.toml` 用 `[libs.kicad]` + `[libs.wch_mcu]` 锁版本。

这在"人用 GUI 画板"的世界里没问题，但和这个项目的前提冲突：

- **agent-first**（ADR-0003）：agent 要能从 datasheet 自己造符号与封装（ADR-0010 决策 2），如果参考工程自己都靠借库，就没有一个"库从零到板"的完整样本。
- **可复现**：借来的库要联网取版本；仓库里没有它们的字节，内容哈希锁不住任何一个 `.teda`。
- **"参考工程"的价值就是能被逐字节复现**：它同时是 conformance 输入、是 `bun run smoke:*` 的对象、是库级检查的靶子。

自建库的前置条件这轮已经齐了：`.teda` 库格式（ADR-0011）、符号库格式（ADR-0012）、导出器、KiCad 冒烟。缺的是**把库搬进项目**，以及**一条能守住"引用都能解析"的门槛**——因为引脚号、焊盘号、符号视图三者跨文件对齐，天然会漂。

## 决策

1. **参考工程不再引用任何外部库**。22 个器件的 `symbol` / `footprint` 全部写成 `project:<name>`；`project.toml` 只留一个自建库条目，不再有 `kicad` / `wch_mcu`。
2. **一个自建库同时提供符号与封装**，两者共用同一个 `<lib>:` 命名空间。因此 `[libs.<name>]` 允许两个根键：

   ```toml
   [libs.project]
   source = "project"
   symbols = "symbols/project"
   footprints = "footprints/project"
   content_hash = "…"
   ```

   `path` 保留为"只有一个根"的旧写法。IR 契约（`schemas/ir/v0.1/project.schema.json`）同步加 `lib.symbols` / `lib.footprints`。
3. **内容哈希覆盖所有根**：`SHA-256(全部文件的 "<项目相对路径>:<file_sha256>\n" 按字节序拼接)`。工具 `bun run lib:hash <dir>...`（`scripts/libhash.ts`），文档里给出等价的 shell 写法。
4. **库级校验是闭环门槛**：`bun run lib:verify`（`scripts/verify-libs.ts`）必须全绿才算通过：
   - 每个器件的 `symbol` / `footprint` 都指向项目内存在的文件（没有外部前缀、没有指向不存在文件）；
   - 没有**孤儿库文件**（每个库文件至少被一个器件引用）；
   - 符号引脚号集合与引用它的器件**完全一致**；封装焊盘号集合**覆盖**器件引脚号（多出的焊盘报警告）；
   - 每个库文件是 canonical form、编译成 IR 并通过契约；
   - 每个符号导出成 `.kicad_sym` 后 **KiCad 能解析**（`kicad-cli sym upgrade`），每个封装导出成 `.kicad_mod` 后 **KiCad 能渲染**（`kicad-cli fp export svg`）；
   - 全部封装摆到一块合并板上，**DRC 0 违规**。
5. **库的几何是"通用 land pattern"，不是逐颗料号的精确尺寸**。参考工程的目标是让流程与校验闭环成立，不是替代厂商库（`AGENTS.md` §1："不做通用库"）。每个封装的 `description` 里写明 `generic land pattern`，免得后来的人把它当精确尺寸用。**精确化是独立的后续工作项**，见 `docs/backlog.md` 的 F1。

## 后果

- **好处**：参考工程现在是一个**自包含、可复现、能被 agent 从零重建**的样本；库的每个字节都在仓库里，内容哈希真的锁住了版本；库级校验把"引脚号 / 焊盘号 / 视图"三处漂移从"靠人盯"变成"工具报错"。
- **代价**：库文件从 2 个变成 31 个（15 个符号 + 16 个封装）；几何精度低于厂商库（见决策 5）；`lib:verify` 依赖 `kicad-cli`，是"有 KiCad 才能全绿"的门槛。
- **顺带修掉的真 bug**：符号导出器在"线宽 0（不描边）"时写出 `(stroke (width 0) (type none))`，而 KiCad 的 stroke type 枚举里没有 `none`——**KiCad 会拒绝整个符号库**。已改为 `(type default)`，并加回归测试（`packages/exporter/test/symbol.test.ts`）。
- **实测通过**（`bun run lib:verify`）：22 个器件 / 15 个符号 / 16 个封装全部解析、编译、导出、被 KiCad 读入并渲染；合并板 DRC `violations=0`。
