# 待办（backlog）

工作项清单，不进 `AGENTS.md` §11（那里是**待定问题**：需要人拍板的取舍）。每条写清：现状、要做的事、涉及文件、验收、注意事项。

编号只增不减：做掉的条目从清单里移除，结论留在对应的 ADR 里。**F2（自研参考渲染器）已关闭** → `docs/adr/0014-reference-renderer.md`（符号与封装渲染 + `bun run preview` 已落地；剩下的 sch 渲染另开 F3）。

---

## F1. 校准自建封装的几何（footprint 校准）

**现状**：`examples/reference-project/footprints/project/` 下的 16 个封装是**通用 land pattern**——焊盘尺寸与间距按 IPC 通用推荐取整，不是各料号 datasheet 的精确 land pattern（见 `docs/adr/0013-reference-project-self-built-libraries.md` 决策 5）。每个文件的 `description` 里都写了 `generic land pattern` 作为标记。

**为什么现在不做**：库级闭环（`bun run lib:verify`：引用可解析、canonical、契约通过、KiCad 能读能渲染、合并板 DRC 0 违规）已经成立，几何精度不影响链路验证。参考工程的价值是"可复现的样本"，不是"厂商级库"。

**要做的事**（逐个封装，从器件 datasheet 抄）：

1. 抄 **body 尺寸**（F.Fab 外形）、**焊盘尺寸与中心距**、**courtyard**、**丝印**；丝印别压到焊盘上（合并板 DRC 会报）。
2. 改 `description`，去掉 `generic land pattern`，写上真实封装代号与 body 尺寸。
3. 有 3D 模型的话补 `model` 行（项目相对路径的 STEP/WRL，ADR-0010 允许）。
4. 改完重算库内容哈希并同步两处：
   ```bash
   cd examples/reference-project && bun run ../../scripts/libhash.ts symbols/project footprints/project
   # → 写回 project.toml 的 [libs.project].content_hash
   # → 同步 tests/schemas/valid/project/reference-project.json 的 libs[0].content_hash
   ```
5. 跑 `bun run fmt:teda examples/reference-project/footprints`（canonical form）与 `bun run lib:verify`。

**涉及封装**（16 个）：`chip-0402` `chip-0603` `chip-1210` `chip-2010` `tantalum-7343` `ihlp-4040` `ihlp-2525` `crystal-3225-4` `switch-5x5-4` `sot-23` `sot-23-5` `soic-8-ep` `powerpak-1212-8` `lqfp-100` `vqfn-24-ep` `sma`

**验收**：
- 每个封装的 body 尺寸、焊盘间距能在对应料号的 datasheet 上逐项对上（datasheet 本地副本在 `examples/reference-project/docs/datasheets/`）。
- `bun run lib:verify` 仍全绿（合并板 DRC `violations=0`）。
- `bun run fmt:teda --check examples/reference-project` 退出 0。

**注意**：
- 精确化之后**库内容哈希会变**，`project.toml` 与 schema 夹具里的哈希必须同步改，否则"库被改过但锚点没动"就查不出来了。
- 焊盘间距变小会逼近 KiCad 默认 0.2mm 间距门限（`lqfp-100` 现状 0.3mm 宽 / 0.5mm pitch = 0.2mm 间隙，正好卡在门限上），精确化时留意合并板 DRC 会不会冒 clearance 违规。
- 3D 模型是独立的一条（库里目前一个 STEP 都没有），可以和几何校准一起做，也可以分开。

---

## F3. 原理图的 SVG 渲染（sch renderer）

**现状**：参考渲染器只画符号与封装（ADR-0014）：`packages/renderer` 的 `renderSymbol` / `renderFootprint` 已落地，`bun run preview symbol|footprint|component` 能出图。**原理图（sch）还没有渲染器**——`AGENTS.md` §1「是」里第一条写的是"一个参考渲染器（先 sch 的 SVG）"，sch 是第一阶段的主对象（§1.1 P0/P1），所以这是渲染器剩下的那块。

**为什么现在做**：

- **sch 的错误只有看图才发现**：ERC 能抓悬空引脚、短路、电源域冲突，抓不到"两个 net 的标签压在一起"、"引脚名糊成一片"、"连线穿过符号"、"页面元素越界"。这些在 P0 的 ERC 里全是绿的。
- **符号与封装的经验可以直接复用**：中间表示（绘图指令列表）、坐标约定（整数纳米）、确定性（字节可复现）、round-trip 的"语义投影"两端对比，这四样已经定型了（ADR-0014），sch 只是多一种图元与一层布局。

**要做的事**：

1. `packages/renderer` 加 `renderSchematic(ir: SchematicIr): SvgDoc`：
   - 页内元素按 IR 的坐标画：器件（用它的符号视图摆位）、导线、net 标签、页面端口、页内电源符号、文本注释；
   - 器件的引脚连接点要与符号渲染器的坐标**完全一致**（同一份 `renderSymbol` 的引脚几何，不能各画各的）；
   - 走线画成"从引脚连接点出发的折线"，拐点用 IR 里的坐标，不做自动布线。
2. 预览命令扩一档：`bun run preview schematic <board_id> [--page <page_id>]`。
3. **可读性检查**（`AGENTS.md` §6："可读性检查自动化：文字重叠、线压引脚、标签碰撞、越界、连线穿过符号"）至少先做**越界**与**连线穿过符号**两项，在渲染时算出来报出来。
4. round-trip：sch 的语义投影两端对比（跟符号/封装同一口径，见 ADR-0014 决策 5）。注意 sch 里有些字段图形上表达不出来（如 net 的电气属性），投影只留能反解的部分，并在代码注释里写清哪些不可反解。
5. 与 KiCad 的 `.kicad_sch` 渲染做**一次性人工比对**，结论记进 ADR（不进 CI）。

**验收**：

- `bun run preview schematic <board_id>` 出整页 SVG：器件、导线、net 标签、页面端口都在图上。
- 同一份 IR 渲染两次字节相同。
- sch 的 round-trip 测试通过。
- 越界与"连线穿符号"能被报出来。

**注意**：

- **sch 的 IR 还没实现**（`packages/parser` 目前只有 symbol / footprint / component）。本条的前置是 P0 的 sch 解析器落地；先做渲染器会把"IR 是什么样"这件事猜错两遍。
- 布局不自动排版：sch 的坐标来自 IR，渲染器只画。多单元器件（双运放）要按 `unit` 选对符号视图。
- 不要顺手做自动布线或自动排版——那是 `AGENTS.md` §1「不是」里明确不做的东西。

---

