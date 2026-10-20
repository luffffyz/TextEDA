# ADR-0012：自建符号库用我们自己的格式；引脚的电学事实归 `component`

状态：已接受
日期：2026-10-20
影响范围：ADR-0010 决策 2（符号部分）；ADR-0011（库格式的同一原则延伸到符号）；`schemas/ir/v0.1/symbol.schema.json`（新增 IR kind `symbol`）；`packages/parser`（`symbol` 表面解析 + `fmt`）；`packages/exporter`（`.kicad_sym`）；`spec/symbol.md`；`examples/reference-project/symbols/`；`docs/symbol-authoring.md`；`AGENTS.md` §4.5、§8、§10、§11

## 背景

ADR-0011 定了"自建封装库用 `.teda` 写，KiCad 格式是导出产物"，并把符号侧留作开放问题（`AGENTS.md` §11 问题 3）。这里回答它。

符号与封装有一个关键差别，这个差别决定了符号不能照抄封装的结构：

- **封装是纯几何**：焊盘位置、丝印、courtyard、3D 引用——全是"怎么画"，没有"是什么"。
- **符号一半是几何、一半是电学事实**：引脚**画在哪**是视图；引脚**叫什么、是什么电气类型、编号是多少**是器件事实。

如果符号文件也带上引脚名和电气类型，同一个事实就有两个所有者（`component.pins` 与 `symbol.pins`），两边不一致时没有裁决规则——这正是 `AGENTS.md` §7「器件描述漂移」那个坑的放大版。历史上 KiCad 自己就踩过：符号库里的引脚名与实际器件 datasheet 对不上，只能靠人在 KiCad 里改符号，改完又和原理图里的另一份拷贝分叉。

另一个现实约束：**符号库几乎总是借来的**。项目里绝大多数符号来自 KiCad 官方库或嘉立创，自建的只有少数几个（自造器件、特殊封装、需要改画法的）。所以符号侧的工作量集中在"能不能正确地**消费**别人的库"与"自建的那几个能不能被校验"，而不是"把整个符号库搬进我们的格式"。

## 决策

1. **自建符号的真源是 `.teda` 源码**，语法见 `spec/symbol.md`（`symbol` 描述类型，v0.5）。一个符号一个文件：`symbols/<lib>/<symbol_id>.teda`；库名由目录决定，不进文件内容。与 `footprint` 同构：编译成 IR 分片（契约 `schemas/ir/v0.1/symbol.schema.json`，closed schema），`.kicad_sym` 是导出产物。
   - **为什么不是直接写 JSON**：同 ADR-0011 决策 1——agent 的工作面是 `.teda` 源码 + 行列级诊断，不是 JSON 路径。
2. **引脚的电学事实只有一个所有者：`component`**。`symbol` 只写引脚**画在哪、怎么画**（位置、朝向、长度、样式、单元归属）与外形、显示开关；**不写引脚名、不写电气类型**。
   - 导出 `.kicad_sym` 时两边合起来：引脚号与位置来自 `symbol`，引脚名与电气类型来自 `component`，按**引脚号**对齐。
   - **两边引脚号集合必须对齐**：符号有、器件没有 → **错误**（导出拒绝）；器件有、符号没画 → **警告**（可以是有意隐藏的电源脚）。
   - `component.symbol = "<lib>:<name>"` 是唯一绑定处，符号文件不重复声明引用关系。
3. **借来的符号库照旧消费**：`component.symbol` 可以指向 KiCad 官方库（`kicad:Regulator_Linear:TPS7A02`）或项目自建库（`project:ldo-sot23-5`），引用形式一致；差别只在"怎么把 `lib:name` 解析成几何/视图"，用"库提供方"抽象隔离（同 ADR-0011 决策 3）。
4. **v0.1 支持的符号范围**：引脚摆位（位置/朝向/长度/样式/单元）、外形（`rect`/`line`/`circle`/`arc`/`poly`，带线宽与填充）、单元分组（`units`）、显示开关（引脚号/引脚名显隐、名字偏移）、属性字段（`Reference`/`Value`/`Datasheet`/任意字段）。
   **暂不支持**：文字标注（极性 `+`/`−`、功能名）、图片、贝塞尔、多段线描边样式。缺口不硬塞：自建库里可以放手写 `.kicad_sym` 兜底（同 `footprint` 的逃生舱规则）。
5. **坐标约定跟随目标格式**：符号用 **+x 向右、+y 向上**（KiCad 符号约定），封装用 +y 向下（PCB 约定）。两边各自跟随目标格式，导出器不做符号翻转——翻转是纯视觉操作，留在渲染层（`AGENTS.md` §6）。
6. **单位换算只发生在边界**：解析进来换算成**整数纳米 / 整数毫度**（ADR-0004 决策 3），不是整数时报错，不四舍五入。canonical form 反算回列默认单位（mm / 度）写出。
7. **不变的部分**：符号几何仍然**不进 `.teda` 板描述**（ADR-0010 决策 1 不变）；符号不参与连通性判定、不回写 IR。

## 后果

- **好处**：自建符号有 schema、有 canonical 形式、有内容哈希、可读的 diff；引脚事实只有一份，漂移从"两处人工同步"降级为"工具报错"。
- **代价**：导出 `.kicad_sym` 需要同时拿到符号与器件两份描述，导出器多一个输入参数；符号库格式比封装窄（没有层、没有焊盘几何），但比封装多一条跨描述约束（引脚号必须对齐）。
- **已跑通**（`bun run smoke:symbol`，实测）：示例符号（`examples/reference-project/symbols/project/bq24610rger.teda`）→ 编译成 IR（契约通过，25 个引脚）→ 与 `component` 按引脚号合并（引脚名/电气类型就位）→ 写出 `.kicad_sym`（25 个引脚）→ **KiCad 10 能解析**（`kicad-cli sym upgrade`）→ **能渲染**（`kicad-cli sym export svg` 出图，外形、左右两侧引脚、上下引脚、名字都正确）。
- **IR 顺序只依赖语义**（实测）：`pins` 按 (`unit`, `number` 自然序)、`body` 按 (`kind`, 坐标)、`fields` 按名、`tags` 按字节序；乱序/换单位/换键序的同一符号编译出的 IR 与 canonical 源**字节相同**。
- **`fmt` 已跑通**（实测）：`bun run fmt:teda --check examples/reference-project/symbols` 退出 0；示例文件是 `fmt` 的固定点。`fmt` 只重排表面，语义错误时拒绝格式化（与 gofmt 一致）。
- **诊断按行列给**：未知标量、未知键、`unit` 越界、缺 `layer`、引脚号重复，都在 `file:line:col` 报出来（`packages/parser/src/symbol.ts`）。
- **一个诚实的投影**：`packages/parser/src/component-facts.ts` 只从 `component` 描述里读出导出符号需要的几件事（引脚表、footprint、datasheet、描述）。它**不是** `component` 的解析器——完整解析（`params` 列类型、`category`/`mpn` 规则、`lcsc` 校验）还没落地（`AGENTS.md` §11）。它对自己读到的那部分严格校验，其余段原样跳过，不假装校验过。

## 后续

- `component` 的完整解析器（`params` 列、变体、`lcsc` 校验）——下一步。
- KiCad 官方符号库的**导入**路径（把 `.kicad_sym` 读成我们的 IR，用于校验借来的库引脚号与 `component` 是否一致）。
- 符号的文字标注（极性、功能名）与图片。
- 符号与封装的联合校验：符号引脚号 ⊇ 器件引脚号、器件引脚号 ⊆ 封装 pad 号（ADR-0010 决策 3 的库级检查在工具链里做）。
