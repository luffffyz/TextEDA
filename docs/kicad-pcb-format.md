# KiCad 导出目标：`.kicad_pcb` / `.kicad_pro` 的字段级映射

状态：试跑基线（2026-10-20，KiCad 10.0.7）· 对应 `docs/adr/0005-manufacturing-output.md` 决策 8、9

本文件是**导出目标**的规格：IR 的每一段落到 KiCad 工程里的哪个位置、哪些落不下（要报告的损失）。
它不描述 IR 语义（那在 `spec/pcb.md`），也不描述 KiCad 自己的格式细节（那是 KiCad 的文档与源码的事）。
每条都标注**是否实测**——实测 = 在 `docs/trial-run/charger-buck/` 那轮试跑里真跑出来的。

## 1. 导出一个 KiCad 工程要几个文件

| 文件 | 装什么 | 谁读它 |
|---|---|---|
| `<board>.kicad_pcb` | 板：叠层外的几何、封装、走线、过孔、铺铜、板框 | KiCad / 制造出口 |
| `<board>.kicad_pro` | 工程：**设计规则**（间距、线宽、过孔、netclass）、叠层设置 | **DRC 引擎**（`kicad-cli pcb drc`） |
| `fp-lib-table` | 封装库表（`LIB:NAME` → `.pretty` 目录） | KiCad 库核对 |

**实测**：设计规则**不在** `.kicad_pcb` 里。板文件里没有规则 → DRC 跑的是 KiCad 默认值。
把 `.kicad_pro` 里的 `design_settings.rules.min_clearance` 改成 1.0mm，同一块板立刻报 40 条 `clearance` 违规 → 规则确实来自工程文件。
所以 `spec/pcb.md` 的 `rules` 段必须落进 `.kicad_pro`，不是 `.kicad_pcb`。

**实测**：没有 `fp-lib-table` 时，KiCad 对板里每个封装报一条 `lib_footprint_issues` warning（9 个器件 → 9~10 条），
DRC 报告就不干净。板文件里封装是内联的，但 `(footprint "LIB:NAME" ...)` 这个名字仍被拿去和库核对。

## 2. IR 段 → KiCad 落点

| IR | KiCad 落点 | 状态 |
|---|---|---|
| `board_thickness` | `.kicad_pcb` → `(general (thickness 1.6))` | 实测 |
| `stackup` | `.kicad_pro` → `design_settings.stackup`（铜厚、介质厚度、材料） | **未验**：本轮只落了板厚 |
| `outline` | `.kicad_pcb` → `Edge.Cuts` 上的 `gr_line` / `gr_rect` / `gr_poly` | 实测（4 段 `gr_line` 拼矩形） |
| `place` | `.kicad_pcb` → `(footprint "LIB:NAME" (layer "F.Cu") (at X Y ROT) ...)` | 实测 |
| `place` 的 refdes | 封装内 `(property "Reference" "R1" ...)` | 实测 |
| `place` 的面 | `(layer "B.Cu")` + 坐标镜像 + 焊盘层翻转 | 未验（本轮全在正面） |
| `connect` | **不导出**：连通性由 pad 的 `(net N "NAME")` 表达 | 实测（`connect` 段只用于校验） |
| `trace` | `.kicad_pcb` → `(segment (start X Y) (end X Y) (width W) (layer "F.Cu") (net N))`，折线拆成多段 | 实测 |
| `via` | `.kicad_pcb` → `(via (at X Y) (size S) (drill D) (layers "F.Cu" "B.Cu") (net N))` | 实测 |
| `zone` | `.kicad_pcb` → `(zone (net N) (net_name "NAME") (layer "B.Cu") ... (polygon (pts ...)))`，**填充由 KiCad 算** | 实测 |
| `rules.clearance` | `.kicad_pro` → `design_settings.rules.min_clearance` + `net_settings.classes[].clearance` | 实测（工程文件生效） |
| `rules.width` | `.kicad_pro` → `rules.min_track_width` + `classes[].track_width` + `design_settings.track_widths[]` | 未验 |
| `rules.via` | `.kicad_pro` → `classes[].via_diameter` / `via_drill` + `design_settings.via_dimensions[]` | 未验 |
| `rules.mask` / `paste` / `thermal` | **封装属性 + zone 属性**（不是板级设置） | 未验：落点要单独核 |
| `rules.min_width` | `.kicad_pro` → `rules.min_track_width` | 未验 |
| `silk` | 封装的 `Reference` / `Value` 属性（是否隐藏、字高、层） | 未验（本轮沿用库默认） |
| `physical_only` | `.kicad_pcb` → 孔/图形/测试点实体 | 未验（段还没实现） |
| `deviation` | 不导出几何，只进报告 | 规则（ADR 0005 决策 9） |

## 3. 实测确认的格式约定

这些是写导出器时容易写错、且已经踩过的点：

1. **板文件骨架**（S 表达式，缩进只是给人看的）：
   `(kicad_pcb (version 20241229) (generator ...) (general (thickness ...)) (paper "A4") (layers ...) (setup ...) (net 0 "") (net N "NAME") ... (footprint ...) (segment ...) (via ...) (zone ...) (gr_line ...))`。
2. **层表**必须按 KiCad 的固定编号写：`F.Cu`=0、`B.Cu`=2、`F.Mask`=1、`B.Mask`=3、`F.SilkS`=5、`B.SilkS`=7、
   `F.Paste`=13、`B.Paste`=15、`Edge.Cuts`=25、`F.CrtYd`=31、`B.CrtYd`=29、`F.Fab`=35、`B.Fab`=33。
   层名同时给别名（`F.SilkS` 的别名是 `F.Silkscreen`）——Gerber 文件名用别名。
3. **net 表**：`0` 号是空网（`(net 0 "")`），实体从 1 开始编号；pad 用 `(net N "NAME")` 绑定，名字要重复写一遍。
4. **封装实例**的 `(at X Y ROT)` = 原点 + 旋转（ROT 省略即 0）。
5. **焊盘的坐标是封装局部坐标（不随实例旋转），角度是绝对角**——这两条不一样，最容易写错：
   - 位置：板文件里保持库里的局部坐标，KiCad 自己按实例旋转算绝对位置（实测：DRC 报的 pad 绝对坐标 = 原点 + 旋转后的局部坐标）。
   - 角度：板文件里写 **库角度 + 实例旋转**。已与 KiCad 官方模板板比对确认（模板里 `rot = -90` 的封装，其 pad 写的是 `270`）。
   - 导出的 DRC 报告里的 pad 位置可以用来反查这两条规则有没有写对。
6. **走线坐标是绝对坐标**，单位 mm（板文件里没有单位标注，DRC JSON 里有 `coordinate_units: mm`）。
   **原点必须对齐**：Gerber 默认用辅助轴原点（`setup (aux_axis_origin 0 0)`），钻孔文件用钻孔原点；
   两者都是 (0,0) 时天然对齐，否则要么统一写 (0,0)，要么给 Gerber 导出加 `--use-drill-file-origin`。
7. **铺铜的填充结果不进 IR，也不该由导出器写**——`.kicad_pcb` 里只写多边形，KiCad 自己填，且**不写回文件**。
   所以 DRC 要带 `--refill-zones`，Gerber 导出要带 `--check-zones`；实测：不带时导出的 `B_Cu` 只有过孔、没有铜皮（缺 `G36/G37` 填充区）。
8. **`connect` 段不导出**：它是校验用的声明，导出后的连通性由 pad 的 net 绑定 + 走线几何共同表达。
9. **`uuid`**：格式允许省略，但 KiCad 会自己生成；为了输出可复现，导出器应写**确定性 uuid**（内容派生），否则同一份 IR 每次导出字节不同。

## 4. 损失清单（要进报告）

- `connect` 的**配对关系**在板文件里丢失（KiCad 只有 pad→net 与几何），只能靠几何反解比对（`AGENTS.md` §2 第 2 条：几何反解只用于校验）。
- `rules` 里 KiCad 没有对应物的参数（阻焊扩张、锡膏比例、热焊盘形状等）要落封装属性/zone 属性，落不上就报。
- `deviation`（net tie、分地等）没有 KiCad 表达 → 只能报。
- 丝印位置、装配与 3D 语义、约束 → 不在 `.kicad_pcb` 里。

## 5. 复现

试跑基线与命令见 `docs/trial-run/charger-buck/README.md`（含 DRC 报告、Gerber 清单、`.kicad_pro`、库表）。
`docs/adr/0005-manufacturing-output.md` 决策 8 的逐项核对表，就以本文件的"状态"列作为底账。
