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
- 每个封装的 body 尺寸、焊盘间距能在对应料号的 datasheet 上逐项对上（datasheet **不入库**，自行从厂商官网下载到 `examples/reference-project/docs/datasheets/`，该目录已 gitignore；文件名见 `docs/mcu-board-components.md` 的表）。
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

## F4. 第三方可实现性交叉验证（标准提案的发布门槛）

**现状**：仓库从私有转公开（ADR-0015），项目定位是**标准提案**：让别人照着 `spec/` 与 `schemas/` 实现自己的 parser / 校验器 / 渲染器。当前所有规范知识都沉淀在 `packages/**` 的源码里——读者容易把"实现里怎么做的"当成"规范要求什么"，这是标准失败最常见的方式。

**为什么现在不做**：板级描述（`sch` / `pcb`）还没实现（`AGENTS.md` §1.1 P0），现在做完整验证等于给一个还要改的规范写验收。**但 `sch` 落地前必须做**，否则规范定型后再改代价更大。

**要做的事**：

1. 写一份**最小第三方实现**：只允许读 `teda.md` / `spec/**` / `schemas/ir/**` / `tests/**`，**不许读 `packages/**` 的源码**。目标是 `component` + `symbol` + `footprint` 三种描述的解析与 IR 产出。
2. 用 `tests/` 里的 conformance 语料与黄金 IR 跑它，比对输出 IR 是否逐字段一致（字节级或语义级，口径写清）。
3. **规范补漏**：凡是实现时必须回头看 `packages/**` 才能确定的地方，在 `spec/` 里补成规范条款。补不了的（例如刻意留给实现的自由度），在 spec 里显式写"本条不约束实现"。
4. 产出一份差异报告（`docs/third-party-implementability.md`），列出规范歧义点与已修条款。

**涉及**：`spec/**`、`schemas/ir/v0.1/**`、`tests/**`、新增 `docs/third-party-implementability.md`。

**验收**：

- 第三方实现在**不参考 `packages/**` 源码**的前提下通过 conformance 核心用例。
- 差异报告里的每条歧义要么在 spec 里被写成条款，要么被显式标注为实现自由度。
- 结论回写 ADR-0015 决策 4.3。

**注意**：

- 这不是"再写一遍实现"——目的是**发现规范漏洞**，实现只写到能暴露漏洞的深度。发现不了歧义就说明用例覆盖不足。
- 不要让第三方实现反过来污染参考实现：发现不一致时先判断是"实现错了"还是"规范没写清"，两者的修法不同（前者改 `packages/`，后者改 `spec/`）。
- 别把它做成"重构 `packages/`"的借口。

---

## F5. 包发布形式与商标（延后，等生态信号）

**现状**：五个包（根 + `packages/ir` / `parser` / `exporter` / `renderer`）都是 `"private": true`、版本 `0.0.0`，未发布到任何 registry。ADR-0015 决策 7 明确延后。

**为什么现在不做**：还没有外部消费者；当前包是 TS 源码（走 git 依赖即可），发布到 npm 只会在没有真实需求时产生"看起来有生态"的假象。

**要做的事（等有信号再做）**：

1. **发布形式**：候选是 npm（`@texteda/*`）、纯 git 依赖、或者只发布 `schemas/ir/**` 与 conformance 语料。判断依据是"第三方实现者实际需要什么"——先看有没有人 clone 了仓库并自己写实现。
2. **版本号**：发布前把 `0.0.0` 换成真实版本；`format` 与 `ir_version` 独立版本（ADR-0008）不变，发布时把 `ir_version` 打进包元数据。
3. **商标**：等"符合 textEDA"开始被第三方自称时，再评估注册 `textEDA` 商标与写商标使用指引（Apache-2.0 §6 不授予商标许可，ADR-0015 决策 5）。

**涉及**：`packages/*/package.json`、根 `package.json`、新增 `TRADEMARKS.md`（若注册）。

**验收**：

- 第三方能按文档在一条命令内把 `@texteda/ir` 或 schema 装进自己的工程。
- 发布产物里的 `ir_version` 与仓库一致。

**注意**：

- 发布不等于放弃契约层开放：发布的是实现，契约层照样公开（ADR-0015 不变量 19）。
- 别在还没有用户时先做品牌设计、文档站、CI 徽章那一套——那是"看起来在推进"的自我安慰。

---

## F6. 仓库可见性切 public（版权清理已完成，待切开关）

**现状**：GitHub 仓库 `luffffyz/textEDA` **仍是私有**。许可与开放承诺已按 ADR-0015 落定（Apache-2.0 + 契约层永久开源）。**版权前置已清完**（2026-10-21）：

- 5 个厂商 datasheet PDF（约 15 MB：TI `bq24610` / `tps7a20`、WCH `CH32V307DS0`、四川索斯特 `SST-3225-8M-12PF-10PPM`、硕方精密 `TS-1187`）已从索引移除并加进 `.gitignore`；
- 这些 PDF 曾在首个提交里进过历史，已用 `git filter-branch --index-filter` **重写历史清除**，并 gc 掉旧对象；
- `NOTICE` 补了"厂商文档不随仓库分发"声明；`examples/reference-project/docs/` 下的说明与 `mcu-board-components.md` 的表已改成"自行下载到本地"。

**还剩下的（都是人工操作）**：

1. 扫一遍 `docs/trial-run/`、README、示例工程里的内部链接、主机名、密钥、真实项目代号。
2. 把 GitHub 可见性切 public。
3. 同步 README 顶部的措辞（当前写的是"仍为私有"）。

**验收**：

- `git log --all --name-only | grep -i '\.pdf$'` 无输出。
- 匿名可 clone（临时目录里用无凭据方式验证）。
- 仓库里不存在第三方受版权保护的文档。

**注意**：

- **顺序不能反**：先清历史再切 public。反过来就要二次重写，且届时可能已有 fork。
- 以后再往 `docs/` 里放厂商文档，先想一次"这是不是受版权保护的材料"——默认不入库。
- F1（校准封装几何）依赖 datasheet 原文，按"自行下载到本地"继续，**不要因此把原文塞回仓库**。
