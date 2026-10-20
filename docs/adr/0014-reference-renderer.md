# ADR-0014：自研参考渲染器——IR → 绘图指令 → SVG，预览不依赖 KiCad

状态：已接受
日期：2026-10-20
影响范围：`packages/renderer/`（新包 `@texteda/renderer`）；`scripts/preview.ts`（新命令 `bun run preview`）；`scripts/lib/project.ts`（预览与冒烟共用的"读库 + 编译"）；`scripts/smoke-symbol.ts`、`scripts/smoke-footprint.ts`（改用共用 helper）；`spec/symbol.md`（`pin_name_offset` 的语义写清）；`docs/symbol-authoring.md`、`docs/footprint-authoring.md`（加"看一眼"这一步）；`AGENTS.md` §1、§9、§10；`docs/backlog.md`（F2 关闭，sch 渲染另开）

## 背景

`AGENTS.md` §1「是」里第一条就写着项目要有一个**参考渲染器**（先 sch 的 SVG），但仓库里能"看见"库文件的地方只有两个一次性冒烟脚本：`scripts/smoke-symbol.ts` 与 `scripts/smoke-footprint.ts`。它们各自写死一个样例（`bq24610rger` / `sot-23-5`），产物丢在 `/tmp/texteda-sym-smoke/`、`/tmp/texteda-fp-smoke/`，不打印路径；agent 造完一个封装/符号**看不到自己的东西**。

这件事的代价不只是"不方便看图"，而是**把 KiCad 装不装变成了能不能干活的前提**：

- 校验全绿 ≠ 看着对。引脚朝向反了、箭头没画出来、courtyard 圈小了、丝印压到焊盘——这些在 IR 与契约校验里都是绿的（校验只看自洽，不看像不像）。
- 每看一次就拉起一次 `kicad-cli`，作者回路就挂在 KiCad 上。
- 而 KiCad 在这个项目里的位置是**制造出口**（ADR-0005 决策 1、3：Gerber / Excellon / DRC 归它）。预览是**设计回路**的事，不该走那条路。

## 决策

1. **新包 `packages/renderer`**（`@texteda/renderer`，与 `ir` / `parser` / `exporter` 同构）：
   - `renderSymbol(ir, part): SvgDoc`、`renderFootprint(ir): SvgDoc`；P1 再加 `renderSchematic(ir): SvgDoc`。
   - **中间表示是绘图指令列表**（`line` / `rect` / `circle` / `arc` / `poly` / `polyline` / `text` / `pin` / `pad`），不是字符串拼接：这样才能写断言、才能做 round-trip、以后也能接别的后端。
   - 纯函数、无 I/O、无全局状态；**同一份 IR 渲染两次，输出字节相同**（没有时间戳、没有随机数）。
2. **坐标系跟源走**：符号 +y 向上、封装 +y 向下（ADR-0012 决策 5）；长度一律**整数纳米**，输出时换算成 mm。转 SVG 时按 `orientation` 翻 y（SVG 的 y 向下）。
3. **预览命令是薄壳**（`scripts/preview.ts`）：
   ```bash
   bun run preview symbol|footprint|component <id> [--lib <name>] [--out <dir>] [--scale <n>] [--project <dir>]
   ```
   - `component` 模式出**符号 + 封装两张图**，方便对"引脚号与位置是否对得上"。
   - 打印产物绝对路径；`--out` 不给就落 `/tmp/texteda-preview/<id>/`。
   - 失败要说清是哪一步、哪个文件（库里没这个 id / 编译不过 / 渲染不过），不是干巴巴 `exit 1`。
   - `--scale` 只改 SVG 的 `width/height`（不动 `viewBox`），放大看细节用，几何比例不变。
4. **引脚文字的位置对齐 KiCad**，免得"预览看着对、KiCad 画出来不一样"：
   - 引脚名在**引脚内端**（贴符号体那一头）沿引脚方向再挪 `pin_name_offset`（缺省 0.508mm）——与 KiCad 的 `(pin_names (offset …))` 同义。`spec/symbol.md` 里"相对引脚端点的偏移"这句话据此写清。
   - 引脚号在**连接点外侧 1.27mm**（KiCad 用 0.05 英寸），字心压在引脚轴上。
   - 字高按 KiCad 的口径（cap height），SVG 字号 = 字高 / 0.75；**基线自己算**（`anchor + 字高/2`），不依赖 `dominant-baseline`（部分光栅化器不认它）。
   - 引脚风格（`inverted` 气泡、`clock` 楔形、`input_low` 低电平弧、`non_logic` 锯齿）要画出来：风格是符号语义，不画等于骗人。
5. **round-trip 用"语义投影"落地**（`AGENTS.md` §10 的 `extract(render(ir)) == ir`）：
   - 两端各算一次投影——一端从**绘图指令反解**（`extractSymbol` / `extractFootprint`），一端从 **IR 直接算**（`symbolProjection` / `footprintProjection`）——比的是投影。
   - 覆盖**整个参考库**（15 个符号 + 16 个封装），不是几个手挑样例；外加"改一个焊盘，反解结果必须变"的敏感度断言，防止这条测试空转。
   - 已知不可反解的两处，写在代码注释里：`symbol.units`（单元数）只能反解成"出现过的最大单元号"；`pin_names_hidden` 只能从"有没有名字文字"反解，所以 round-trip 用**带名字的器件**跑。
6. **与 KiCad 渲染的一致性：一次性人工比对，结论记在本 ADR，不进 CI**。本次比对（`bq24610rger` 符号、`sot-23-5` 封装）：
   - 符号：引脚位置、朝向、名字/编号的内外侧、属性字段位置**与 KiCad 逐项一致**；差别只在配色（我们走工程图风格：外形黑、引脚棕、文字灰；KiCad 走 PCB 配色）。
   - 封装：焊盘位置与尺寸、courtyard、F.Fab、丝印、属性文字位置**与 KiCad 一致**。
   - 结论：**几何与文字布局以 KiCad 为准**，我们的渲染器不另立一套约定。
7. **KiCad 留在哪儿不变**（ADR-0005、ADR-0013 决策 4）：制造出口与 DRC 归它；`lib:verify` 里"我们的导出能被 KiCad 读入并渲染"这条**交叉检查**保留——它验的是"下游能消费我们的产物"，依赖 KiCad 是有意的。**预览与渲染器本身不依赖 KiCad**：作者回路纯 TS/Bun，装不装 KiCad 都能看图、能审库。
8. **共用"读库 + 编译"这一半**（`scripts/lib/project.ts`）：预览命令与两个冒烟脚本都用它找文件、编译 `.teda`、读器件事实。冒烟脚本保留"KiCad 能读我们的导出"这条断言，预览命令只出图、不做断言。

## 后果

- **好处**：agent 造完符号/封装能立刻自己看图——"看着对不对"不再需要 KiCad；渲染器是纯函数，同一份 IR 字节可复现，可以进回归；引脚文字与 KiCad 对齐，预览不会骗人。
- **代价**：多一个包要维护；渲染约定（文字位置、图层配色）是新的东西，KiCad 不认，只能自己保一致；符号/封装之外（sch、PCB、3D、铜箔）还没画。
- **没有代价的部分**：没碰导出器、没碰 IR 契约、没碰 `.teda` 语法。`pin_name_offset` 的语义只是**写清**（本来就是 KiCad 的语义），没有改行为。
- **实测通过**：`bun test packages/renderer` 10 项全绿（含整库 round-trip 与确定性）；`bun run preview component bq24610rger` 出符号 + 封装两张图（25 个引脚、25 个焊盘）；`bun run preview footprint nonexistent` 报"库里没有封装 project:nonexistent"并退出非 0；`bun run smoke:symbol` / `smoke:footprint` 仍全绿（KiCad 能读我们的导出、DRC 0 违规）。
