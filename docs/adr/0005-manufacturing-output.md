# ADR-0005：制造出口路径（IR → KiCad → Gerber/Excellon）

状态：已接受（2026-10-20 修订：制造链由 Circuit JSON 改为 KiCad）
日期：2026-10-20
影响范围：`AGENTS.md` §1、§8、§9（待决问题 4）；`spec/pcb.md`（`rules` 段、新增 `silk` 段、限制表）；`docs/adr/0003-agent-first-pcb-ir.md` 决策 8

## 背景

- `AGENTS.md` §0、§1、§8 的边界：**不自研制造出口**，Gerber / 贴片 / BOM 借现成工具链。本 ADR 定"借"的具体路径。
- **三类信息必须分清**（本 ADR 的核心，也是"IR 要补什么"的判据）：
  1. **设计意图（参数）** → 进 IR。阻焊扩张、锡膏比例、热焊盘间距、最小线宽、丝印出不出与字高、钻孔形式：这些是"这块板怎么造"，是设计事实，和 netclass 同级。
  2. **派生几何（结果）** → 不进 IR。铜皮填充后的多边形、丝印文本位置、阻焊开窗多边形：它们是（意图 + 几何 + 固定算法）的函数。存进 IR 等于存两份真值，必然漂移；而且每板几万顶点，agent 读不动。
  3. **派生 policy（算法本身）** → 进 `spec/`，不进 IR。网格、扫掠顺序、热焊盘形状、丝印排版规则：是规范的一部分，版本化、可 review，不该藏在代码里。
- **Gerber 是有损投影的最末端**：不带约束、不带网名（除非写 X2 属性）、不带装配与 3D 语义，丢的必须报告（`docs/adr/0003-agent-first-pcb-ir.md` 决策 8）。
- **Gerber 好写，DFM 难判**：写出 RS-274X 与 Excellon 是机械活；"这块板能不能被生产"是 DRC 与板厂 CAM 的活。
- **KiCad CLI 能力已核实**（KiCad 9.0 官方手册 CLI 章；KiCad 10 同样具备）：
  - `kicad-cli pcb drc` —— DRC 全量跑，`--format report|json`、`--severity-all/error/warning/exclusions`、`--schematic-parity`、`--exit-code-violations`（无违规退 0，有违规退 5 → 可做 CI 门）。
  - `kicad-cli sch erc` —— ERC 同样有 `--format json` 与 `--exit-code-violations`。
  - `kicad-cli pcb export gerbers` —— 一层一文件；X2 默认开（`--no-x2` 关）、网名属性默认写（`--no-netlist` 关）、`--subtract-soldermask`、`--precision 5|6`、`--no-protel-ext`、`--use-drill-file-origin`。单文件多层的 `pcb export gerber` 在 9.0 已废弃、10.0 移除。
  - `kicad-cli pcb export drill` —— `--format excellon|gerber`、`--excellon-separate-th`（镀通/非镀通分开）、`--excellon-oval-format route|alternate`（槽/腰形孔）、`--generate-map --map-format pdf|gerberx2|...`。
  - 另有 `pcb export step/glb/ipc2581/odb/pos/svg/pdf/ply/dxf/brep/render`、`sch export bom/...`、`jobset run`。
  - 本机**已安装** `kicad-cli` **10.0.7**（nix store：`/nix/store/59w3i7fr0m0jchg8xrhcxl74d1wnqysc-kicad-10.0.7`）。`kicad-cli pcb drc --format json` 已实测跑通：**0.44 s/板**，输出 `violations[]`（每条含 `type` 规则 id、`severity`、`items[]{description, pos, uuid}`）+ `unconnected_items[]` + `schematic_parity`，`coordinate_units: mm` → **可作机器可读的 DRC oracle**（KiCad 自带 `--exit-code-violations`，可直接做 CI 门）。
  - 差分测试语料：KiCad 模板目录 19 块板（`/nix/store/*KiCad_template_dir/**/*.kicad_pcb`，含 Arduino_Micro / BeagleBone-Black-Cape / STM_Nucleo64_Morpho / DevEBox 等）；本 nix 包的 `demos` 目录为空。
- **撤回的选项**：`tscircuit/circuit-json-to-gerber`（3★ / 42 forks / 45 open issues；且用 Circuit JSON 等于把 IR 绑到 tscircuit 的数据模型上）。按项目意见不选这条路。

## 决策

1. **制造出口路径 = IR → KiCad → Gerber/Excellon/DRC**。KiCad 是唯一制造出口，制造与验证在同一条链里闭环。打样交付的 BOM / 坐标文件规范与免费券资格另见 `docs/adr/0006-jlc-prototype-delivery.md`。
2. **撤回 Circuit JSON 作为制造链**。理由：绑定外来 schema；工具成熟度低；无 DRC；它唯一的卖点"免 KiCad"在有更好替代（决策 3）时不值得。若将来需要 KiCad 之外的互操作目标，另行立项。
3. **自研 Gerber 写出器推迟**。触发条件：交付必须在没有 KiCad 的环境完成，或 KiCad CLI 成为瓶颈。届时**自研**，而不是引入另一个外来 schema。
4. **IR 里放什么**：设计意图参数进 IR；派生几何不进 IR；派生 policy 写进 `spec/`（下一步做）。已落地到 `spec/pcb.md`：`rules` 段的 `mask` / `paste` / `thermal` / `min_width`，以及新增的 `silk` 段。
5. **派生层由 KiCad 承担**：铜皮填充、阻焊与锡膏开窗、丝印排版都交给 KiCad 的 board setup、封装属性与 fill algorithm；IR → KiCad 的映射必须覆盖这些设计设置。
   - 实现时要核对落点：KiCad 的**阻焊扩张与锡膏边距是封装属性**（per-footprint），不是板级设置；**热焊盘间距与桥宽是 zone / pad 属性**。所以 IR 的 `mask` / `paste` / `thermal` 要写到对应层级，而不是笼统塞进 board setup。
6. **验证路径 = KiCad CLI**：`kicad-cli pcb drc` 与 `kicad-cli sch erc` 都能在无人值守环境里跑（`--exit-code-violations` 给退出码，`--format json` 给机器可读报告）。这让"KiCad 只是 DRC 引擎"变成可自动化的，不需要开 GUI。
7. **Gerber 前置条件**（IR 侧仍需补齐）：
   - `rules`：`mask`（阻焊扩张）、`paste`（比例与偏移）、`thermal`（间距与桥宽）、`min_width`（最小线宽）——已加。
   - `silk` 段：refdes / value 出不出、字高、哪一层——已加；**位置来自封装库**（借 KiCad / 嘉立创），IR 不描述位置。
   - 钻孔形式：槽与异形孔（`physical_only` 目前只表达圆孔与矩形开孔）——待补。
8. **试跑门**：用最小板跑通 `kicad-cli pcb export gerbers` + `pcb export drill` + `pcb drc`，逐项核对：铜层、阻焊开窗、锡膏开口、丝印、圆孔与槽、镀通/非镀通分文件、X2 网名与器件属性、板框与各层对准、DRC 报告可用。缺项记为损失或缺口。
9. **损失必须报告**：IR → KiCad 与 KiCad → Gerber 两级都要报出丢掉的语义（约束、`deviation`、装配与 3D、未映射的 `rules`），复用 `AGENTS.md` §4.4 的受控偏差机制。

## 后果

- 制造与验证同链闭环：一份 KiCad 工程同时出 Gerber / Excellon / IPC-2581 / STEP / BOM，并提供 DRC。
- **代价：制造路径依赖 KiCad**。"最终交付不依赖 KiCad"从现在的保证降为将来目标（决策 3），`docs/adr/0003-agent-first-pcb-ir.md` 决策 8 的双出口相应改为单出口。
- IR → KiCad 是有损投影：`rules`、`deviation`、约束在 KiCad 里的落点要逐条核对（工程文件 + netclass + 封装与 zone 属性）。
- 派生由 KiCad 承担 → IR 保持中立；坏处是我们不控制填充与排版细节，**KiCad 版本变化会改变结果**，所以要锁版本并留试跑基线。
- 依赖集中：库、DRC、制造都挂在 KiCad 一个点上，它是单点故障。
- Circuit JSON 那条路的撤回意味着放弃"现成的中立制造链"，换来的是"一条成熟的、被板厂生态接受的链"。

## 后续

- `kicad-cli` 已装（10.0.7）；`pcb drc` 已跑通并验证 JSON oracle。**试跑门第一轮已过**（2026-10-20）：用 `examples/reference-project` 的 `charger-buck` 板（`examples/reference-project/pcb/charger-buck.teda`）跑通 `pcb 描述 → .kicad_pcb → DRC → Gerber/Excellon`，**DRC 0 违规、0 未连接**，21 个 Gerber + 1 个 Excellon 导出齐全。基线与命令见 `docs/trial-run/charger-buck/`，字段级映射见 `docs/kicad-pcb-format.md`。
- 试跑查出的三件事已落账：① **设计规则不在 `.kicad_pcb` 里**，必须写进 `.kicad_pro`（实测：改 `min_clearance` → 40 条 clearance 违规）；② 页内 net 的命名缺口 → `docs/adr/0007-page-internal-net-naming.md`；③ 焊盘**坐标是局部、角度是绝对**这条易错约定。
- 试跑门**未完**：叠层（`.kicad_pro` 的 `design_settings.stackup`）、`mask`/`paste`/`thermal`/`min_width` 四个 rules 参数的落点、背面器件与槽孔、板框多边形、Gerber 的 CAM 级检查都还没做——清单见 `docs/kicad-pcb-format.md` 的"状态"列。
- DRC 归属待定：维持"KiCad 为 DRC 引擎"（决策 6），还是自研几何 DRC（须以 KiCad JSON 为 oracle 做差分收敛）。见 `AGENTS.md` §1 边界与本 ADR 决策 6。
- IR → KiCad 的字段级映射表：直接映射 / 丢失 / 需报告 → `docs/kicad-pcb-format.md`（第一轮试跑实测底账）。
- 派生 policy 规格化：写进 `spec/`（哪些是固定 policy、哪些是 IR 参数），并给出到 KiCad 的落点。
- 网表作为导出目标之一登记（网表是 IR 的投影，不是独立层）。
- 锁 KiCad 版本（填充与排版结果随版本变化）。
