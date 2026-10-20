# ADR-0011：自建封装库用我们自己的格式；KiCad 格式是导出产物

状态：已接受
日期：2026-10-20
影响范围：ADR-0010 决策 2（格式部分由本 ADR 取代）；`schemas/ir/v0.1/footprint.schema.json`（新增 IR kind `footprint`）；新增 `packages/exporter`；`examples/reference-project/footprints/`；`docs/footprint-authoring.md`；`AGENTS.md` §4.5、§9、§11

## 背景

ADR-0010 定了"几何不进 `.teda`"，并把"自建库用什么格式"留作开放问题。这里回答它。

两个实测事实决定了答案：

1. **KiCad 没有强加库格式**。KiCad 6+ 的板文件**内联**封装几何：`docs/trial-run/charger-buck/charger-buck.kicad_pcb` 里每个 `(footprint …)` 块都带着 `fp_line` / `pad` 全几何，`lib:name` 只是个标签。库只在导出时被读一次；之后 DRC、Gerber、贴片坐标都不再需要库。
2. **库表缺失只影响"回查"**。`lib_footprint_issues` 出现在 KiCad 想按 `lib:name` 前缀回查库、而 `fp-lib-table` 找不到该库时（第一轮试跑踩过，`docs/kicad-pcb-format.md` 有记录）。几何本身在板文件里，DRC 照跑。

所以库格式是**我们自己的选择**，不是被 KiCad 定的。既然要选，就按本项目一贯的纪律选：**schema 化的规范描述当真源，KiCad 的格式当导出产物**（与 ADR-0003「IR 唯一真源，渲染是派生物」同构）。

## 决策

1. **自建库的真源是 `.teda` 源码**，语法见 `spec/footprint.md`（`footprint` 描述类型，v0.4）。一个封装一个文件：`footprints/<lib>/<footprint_id>.teda`；库名由目录决定，不进文件内容。
   - **为什么不是直接写 JSON**：ADR-0004 决策 5 明说"agent 不直接读 IR，agent 的工作面是 `.teda` 源码 + 校验报告"。库是 agent 主要会造的东西（datasheet → 封装），它的工作面必须和板描述一样是 `.teda`；否则同一件事有两套作者体验、两套诊断（JSON 只能报路径，没有行列）。
   - **编译产物是 IR 分片**：`packages/parser` 把 `.teda` 编成 `footprint` kind 的 IR（契约 `schemas/ir/v0.1/footprint.schema.json`），单位换算只在这一层发生：长度 → 整数纳米、角度 → 整数毫度、比例 → 整数百万分比（IR 不许浮点，ADR-0004 决策 3）。
2. **KiCad 格式是导出产物**。导出器（`packages/exporter`）写两种产物：
   - **独立 `.kicad_mod`**：放进 `<lib>.pretty/` 目录，KiCad 当普通库用（人可以在 KiCad 里浏览、编辑、放进全局库表）；
   - **板文件内联块**：板里直接带几何（与 KiCad 自己的做法一致）。
   两种产物共用同一份 body 生成逻辑，因此不会出现"库里的封装和板上的不一致"。
3. **两种库提供方，引用同形**：
   - 借来的：KiCad 官方库等 `.pretty` 目录，按上游 `rev`/`version` 锁；
   - 自建的：我们的 JSON 目录，按**内容哈希**锁（ADR-0010 决策 2）。
   `component.footprint` 的 `lib:name` 对两者一样，校验与哈希规则也一致；差别只在"怎么把 `lib:name` 解析成几何"。
4. **`fp-lib-table` 仍然要写**，指向**生成的** `.pretty` 目录（项目内 `dist/footprints/<lib>.pretty`，用 `${KIPRJMOD}` 相对路径）。它是 KiCad 侧的回查入口，缺了就有 `lib_footprint_issues`。
5. **v0.1 支持的几何范围**：焊盘（`smd`/`th`；`rect`/`roundrect`/`oval`/`circle`；位置、尺寸、钻孔、层集合、圆角比、阻焊/锡膏扩张、连接方式、热焊盘宽缝）、图形（`line`/`rect`/`circle`/`arc`/`poly`，带层与线宽）、文本与属性（`Reference`/`Value`/任意字段）、**单个** 3D 模型引用。
   **暂不支持**：自定义焊盘形状（custom + primitives）、挖空/开槽、多层嵌套、多个 3D 模型、层叠封装。缺口不硬塞：自建库里可以放手写的 `.kicad_mod` 作为兜底（只是它不受 schema 管，工具会按"未托管文件"对待）。
6. **不变的部分**：几何仍然**不进 `.teda` 描述**（ADR-0010 决策 1 不变）；3D 仍不参与连通性判定、不回写 IR（`AGENTS.md` §2 第 2、3 条）。

## 后果

- **好处**：自建库有 schema、有 canonical 形式、有内容哈希、有可读的 diff；agent 写的是 JSON 而不是 S-expression，能被校验、能被定位到字段；KiCad 升版本不影响真源。
- **代价**：多维护一个导出器，要跟 KiCad 的方言细节较劲。已踩的坑写进代码注释与测试：`(tags …)` 必须是**一个**引号字符串（写成多个字符串，KiCad 直接拒绝加载整个库）；`(zone_connect 2/1/0)` 对应 solid/thermal/none。
- **两种库并存**：借来的库仍是 KiCad 格式。用"库提供方"抽象隔离——引用点、校验项、锁定方式对两者一致，只有解析器不同。
- **已跑通**（`bun run smoke:footprint`，实测）：示例封装（`examples/reference-project/footprints/project/sot-23-5.teda`）→ 编译成 IR（契约通过）→ `.kicad_mod` → KiCad 10 能解析（`kicad-cli fp export svg` 出图）→ 内联进板 → `kicad-cli pcb drc` **0 违规** → `kicad-cli pcb export gerbers` 出齐 18 个文件。
- **多一个解析器**：`packages/parser`（行级词法 + 单位换算 + `footprint` 表面解析 + canonical JSON 写出 + `fmt`）。行级词法与诊断格式按 `teda.md` §3–§4、§11 写，将来通用 `.teda` 解析器复用同一套。
- **IR 顺序也只依赖语义**（实测）：`pads` 自然序、`graphics` 按 `(kind, layer, 坐标)`、`fields` 按名、`tags` 按字节序；乱序/换单位/换键序的同一封装编译出的 IR 与 canonical 源**字节相同**，导出产物也相同。性质验证脚本跑过：`fmt` 幂等、语义不变、`.kicad_mod` 不变。
- **已跑通 `fmt`**（实测）：`bun run fmt:teda --check examples/reference-project/footprints/project/sot-23-5.teda` 退出 0；示例文件是 `fmt` 的固定点。`fmt` 只重排表面（行/键顺序、列对齐、单位归一），语义错误时拒绝格式化（与 gofmt 一致）。冒烟脚本第一步就检查这一点，防止源文件漂移。

## 后续

- **符号**（symbol）要不要同样处理（自建符号库用 `.teda` 描述，导出 `.kicad_sym`）——未定，见 `AGENTS.md` §11 问题 3。
- 焊盘 custom 形状、挖空、多个 3D 模型、层叠封装。
- `packages/exporter` 目前只做封装；sch/pcb 的写手还没进仓库（第一轮试跑的导出器是一次性脚本）。
