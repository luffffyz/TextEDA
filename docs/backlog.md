# 待办（backlog）

工作项清单，不进 `AGENTS.md` §11（那里是**待定问题**：需要人拍板的取舍）。每条写清：现状、要做的事、涉及文件、验收、注意事项。

编号只增不减：做掉的条目从清单里移除，结论留在对应的 ADR 里。

- **F2（自研参考渲染器）已关闭** → `docs/adr/view/0135-our-own-reference-renderer.md`（符号与封装渲染 + `bun run preview` 已落地；剩下的 sch 渲染另开 F3）。
- **F7（诊断错误码注册表）已关闭** → `docs/adr/language/0102-diagnostic-error-codes.md`（`域.slug` 码表 + 生成的 `docs/error-codes.md` + 双向完整性检查已落地）。
- **F41（器件词表与参数角色的检查）已关闭** → `docs/adr/devices/0124-device-vocabulary-and-parameter-roles.md`（`packages/core` 的器件规则表 + `texteda check` 的三类检查已落地；"额定值只被写出、没有被验证"另开 F42）。
- **F50（ADR 语料的附录膨胀与散文漂移）已关闭** → `docs/adr-corpus-structure.md`（语料换成主题文件夹后附录全部就地折进正文、R4 零告警；版本号类快照改成指针；新写记录里的裸 `§N` 全部补上文件名；版本表与 `TYPE_BIRTH` 由测试钉住）。

---

## F1. 校准自建封装的几何（footprint 校准）

**现状**：`examples/reference-project/assets/footprints/project/` 下的 16 个封装是**通用 land pattern**——焊盘尺寸与间距按 IPC 通用推荐取整，不是各料号 datasheet 的精确 land pattern（见 `docs/adr/libraries/0131-the-reference-project-is-self-built.md` decision 5）。每个文件的 `description` 里都写了 `generic land pattern` 作为标记。

**为什么现在不做**：库级闭环（`bun run lib:verify`：引用可解析、canonical、契约通过、KiCad 能读能渲染、合并板 DRC 0 违规）已经成立，几何精度不影响链路验证。参考工程的价值是"可复现的样本"，不是"厂商级库"。

**要做的事**（逐个封装，从器件 datasheet 抄）：

1. 抄 **body 尺寸**（F.Fab 外形）、**焊盘尺寸与中心距**、**courtyard**、**丝印**；丝印别压到焊盘上（合并板 DRC 会报）。
2. 改 `description`，去掉 `generic land pattern`，写上真实封装代号与 body 尺寸。
3. 有 3D 模型的话补 `model` 行（项目相对路径的 STEP/WRL，[ADR-0129](adr/libraries/0129-footprint-format-and-geometry.md) 允许）。
4. ~~改完重算库内容哈希~~ **不需要**：自建库没有 `content_hash`（`[libs]` 已撤销，[ADR-0133](adr/libraries/0133-trust-in-a-library-you-do-not-own.md)），几何就在 `assets/` 里。
5. 跑 `bun run fmt:teda examples/reference-project/footprints`（canonical form）与 `bun run lib:verify`。

**涉及封装**（16 个）：`chip-0402` `chip-0603` `chip-1210` `chip-2010` `tantalum-7343` `ihlp-4040` `ihlp-2525` `crystal-3225-4` `switch-5x5-4` `sot-23` `sot-23-5` `soic-8-ep` `powerpak-1212-8` `lqfp-100` `vqfn-24-ep` `sma`

**验收**：
- 每个封装的 body 尺寸、焊盘间距能在对应料号的 datasheet 上逐项对上（datasheet **不入库**，自行从厂商官网下载到 `examples/reference-project/docs/datasheets/`，该目录已 gitignore；文件名见 `examples/reference-project/docs/mcu-board-components.md` 的表）。
- `bun run lib:verify` 仍全绿（合并板 DRC `violations=0`）。
- `bun run fmt:teda --check examples/reference-project` 退出 0。

**注意**：
- 精确化之后**库内容哈希会变**，`project.toml` 与 schema 夹具里的哈希必须同步改，否则"库被改过但锚点没动"就查不出来了。
- 焊盘间距变小会逼近 KiCad 默认 0.2mm 间距门限（`lqfp-100` 现状 0.3mm 宽 / 0.5mm pitch = 0.2mm 间隙，正好卡在门限上），精确化时留意合并板 DRC 会不会冒 clearance 违规。
- 3D 模型是独立的一条（库里目前一个 STEP 都没有），可以和几何校准一起做，也可以分开。

---

## F3. 原理图的 SVG 渲染（sch renderer）

**现状**：sch 打印页渲染**已落地**。`packages/renderer` 的 `renderSchematic(view: SchematicView, instances)` 把视图 IR 画成 `SvgDoc`（图幅框、摆位符号、走线折线、标签、端口、注释），调用方负责把每个 `place.instance_id` 解析成符号 IR 与器件引脚事实——渲染器仍然不碰文件系统、不排版。`bun run preview view <board>/<page>` 能出图；参考工程有两份打印页：`views/charger-buck/buck-5v.view.teda`（全部 net 走线，GND 走一条总线）与 `views/charger-buck/charger-power.view.teda`（摆位研究，线在评审时逐网补）。**未落地**：与 `.kicad_sch` 的人工比对。旧状态见 [ADR-0135](adr/view/0135-our-own-reference-renderer.md)（符号/封装先落地）。**规则现状（2026-10-25）**：`view` 域九个码，最新两条是 `view.text-on-wire`（走线穿过文字，含符号画的字段）与 `view.wire-diagonal`（走线只走 90 度）；视图坐标网格随之从 0.1 mm 细到 0.01 mm，否则在 1.27 mm 的引脚偏置上无法表达正交出线。

**为什么现在做**：

- **sch 的错误只有看图才发现**：ERC 能抓悬空引脚、短路、电源域冲突，抓不到"两个 net 的标签压在一起"、"引脚名糊成一片"、"连线穿过符号"、"打印页元素越界"。这些在 P0 的 ERC 里全是绿的。
- **符号与封装的经验可以直接复用**：中间表示（绘图指令列表）、坐标约定（整数纳米）、确定性（字节可复现）、round-trip 的"语义投影"两端对比，这四样已经定型了（[ADR-0135](adr/view/0135-our-own-reference-renderer.md)），sch 只是多一种图元与一层布局。

**要做的事**：

1. ~~`packages/renderer` 加 `renderSchematic(...)`~~ **已落地**（2026-10-21）：
   - 打印页内的元素按 IR 的坐标画：器件（用它的符号视图摆位）、导线、net 标签、端口、文本注释；**电源符号**未做——`view` 描述没有这个段，GND 目前靠 net 标签表达；
   - 器件的引脚连接点与符号渲染器用同一份 `renderSymbol` 几何（走线端点直接取变换后的引脚连接点，不另算）；
   - 走线是"引脚连接点 → IR 折点 → 引脚连接点"的折线，不做自动布线。
2. ~~预览命令扩一档~~ **已落地**：`bun run preview view <board>/<page>`（旧的 `preview schematic <board_id> --page` 方案改成按打印页取 `views/<board>/<page>.view.teda`，与文件布局一致）。
3. ~~**可读性检查**（`AGENTS.md` §6："文字重叠、线压引脚、标签碰撞、越界、连线穿过符号"）~~ **已落地**（2026-10-23）：`spec/schematic-view.md` §9.2 的六个码全部发出——越界原本就由 `view` 解析器的 `view.out-of-sheet` 覆盖，其余五个（`view.label-not-on-net` / `view.port-not-on-net` / `view.label-collision` / `view.text-overlap` / `view.wire-crosses-symbol`）在 `packages/core/src/view/readability.ts`，由 `texteda check` 跑。（2026-10-25 补了 `view.text-on-wire`：走线穿过文字，含符号画的 Reference / Value 字段——这两类字原先不在检查器看的几何里，试跑打印页评审时被 `charger-buck-buck-5v-view-r1` 的两条意见抓到；同日又补了 `view.wire-diagonal`：走线只走 90 度，任何一段两端坐标同时变化就报警——引脚偏置是 1.27 mm，所以视图网格从 0.1 mm 收细到 0.01 mm，否则从第一个引脚就无法正交出线。同日又补了 `view.wire-crosses-pin`：走线穿过某个引脚连接点（该引脚不是这条走线的端点时），或穿过引脚从连接点到符号本体的短笔画，就报警——引脚是连接点，线从它中间穿过而不在这里结束，读者会读成一个没有圆点的连接；横穿引脚笔画时，读者也分不清哪一段是引脚。参考工程的 buck 页按此把 PH 线绕开 U1 的引脚列与 C2 的引脚笔画。）**几何从渲染器来**：`packages/renderer` 的 `schematicGeometry` 用与 `renderSchematic` 同一套变换与同一套笔画字体度量算出文字框、符号本体框与引脚落点，检查器只做判断——自己再算一遍就会与读者看到的东西漂移。两条口径：`*-not-on-net` 只在该 net **本页画了走线**时判（整条 net 没画是 `view.nets-not-drawn` 的事，不逐标签重复）；`view.text-overlap` 要求有重叠**面积**，相切不算。参考工程当前 0 条（标签都落在线上）。**配套的度量**：`texteda view-metrics <工程目录> <board>/<page> [--json]`（`packages/core/src/view/metrics.ts`，`spec/schematic-view.md` §9.4）报内容占比、文字最小间隙、走线总长、跨 net 交叉数、穿身条数，以及每个标签/端口到其 net 的**距离**；同一批数字也进了五条警告的 `data`（距离 / 重叠面积 / 穿身长度），人类可读输出里换成 mm。**agent 的循环因此是 `写 → check（对不对）→ view-metrics（差多少）→ 改`**，截图只留给人的评审：像素不能跨渲染比较，也进不了 CI。
4. ~~**round-trip**~~ **已落地**（2026-10-23）：`packages/renderer/src/schematic-extract.ts` 的 `schematicProjection(view, instances)` 与 `extractSchematic(doc)` 两端对比，口径写在 `spec/schematic-view.md` §9.5。**投影是"纸面上的东西"**：图幅、引脚连接点与朝向、符号图形、走线折点、标签/注释文字与位置、端口尖点与朝向，全在绝对图纸坐标；**摆位原点与旋转、线宽字号、端口塔形细节、引脚归属哪个实例**都不进投影（图上没有这些信息；实例身份靠 `Reference` 文字进投影）。**两端不共用变换函数**：视图侧用象限矩阵，图纸侧直接读绘制指令——共用就是自己验证自己。测试：`packages/renderer/test/schematic-roundtrip.test.ts`（四个象限、灵敏度、走线端点落在引脚上）与 `packages/cli/test/view-roundtrip.test.ts`（参考工程每一页）。已用一次故意写错 `toSheet` 的变异验证过：两个参考页的测试都变红。
5. 与 KiCad 的 `.kicad_sch` 渲染做**一次性人工比对**——**未落地**（不进 CI）。
6. ~~**板 ↔ 打印页交叉校验**（`packages/core`）~~ **已落地**（2026-10-23，`packages/core/src/view/checks.ts`，在 `texteda check` 里跑）：`spec/schematic-view.md` §9.1 的四条错误（`ref.unknown-instance` / `ref.unknown-net` / `ref.unknown-port` / `view.pin-net-mismatch`）与一条覆盖率警告（`view.nets-not-drawn`）。**两处口径修正**：`net-not-drawn` 做成**板级**（规范原写“在这个打印页里”）——打印页按模块分，按页会替另一页的线报错；而且一块板报**一条**总数 + 前十个 net 名（同 [ADR-0118](adr/pcb/0118-a-partial-layout-is-legal.md) D4 的分寸）。参考工程现在报 `30 of 36 nets`：两份页是研究稿，这个数字是真的。（原记录：：`spec/schematic-view.md` §9.1 标"待实现"的那几条（实例 / net / port 是否存在、端点引脚是否属于该 net、`net-not-drawn`）。渲染器对未知实例或未知符号引脚是**抛错**，不是发诊断——诊断归 core，渲染器不伪造几何。
   缺口的具体形状（2026-10-23 复查）：
   - 视图只**引用**身份（`place.instance_id` / `wire` 的 `pin` / `label` 的 `net_id`），可是引错、引到不存在的 id、引到别块板的 id 今天都不报——`texteda check` 只看 `schematic` 与 `pcb`，`view` 只做解析与越界（`view.out-of-sheet`）；
   - 反向也要查：板上有 net、打印页里一条线都没有（`net-not-drawn`），以及一个实例在整块板的所有打印页里都没出现——后者与 `bind.instance-unplaced`（pcb 侧）是同一类"缺失要看得见"的信号，严重度应一致（warning）；
   - ~~两条视图规则都**不改哈希**，所以这类诊断只能是 warning/note，不能拦树~~ ——**身份错误照样阻断**：`spec/schematic-view.md` §9.1 一直把“引用了不存在的东西”列为 error，与 `sch` 侧同类（ADR-0102 按错误的种类分域），解析器也早就对 `view.pin-not-placed` 报 error。只有覆盖率是 warning；`ir` 不跑交叉校验，这一点仍然成立；
   - 边界：视图说“这条线在这里”与板说“这两个引脚同 net”冲突时，**以板为准**（`AGENTS.md` §2 第 2 条），诊断只指出冲突，不改真源。）

**验收**：

- ~~`bun run preview view <board>/<page>` 出整页 SVG~~ **已满足**：器件、导线、net 标签、端口都在图上（参考工程两份打印页）。
- ~~同一份 IR 渲染两次字节相同~~ **已满足**（`packages/renderer/test/schematic.test.ts`）。
- ~~sch 的 round-trip 测试通过~~ **已满足**（第 4 条）。
- 越界与"连线穿符号"能被报出来——**部分**：越界在解析器，穿符号未做。

**注意**：

- **sch 的逻辑 IR 仍然没有坐标**（`instances` / `nets` / `ports` 只有身份与成员），画在独立的 `view` IR 里；渲染器的输入因此是 `view` + 调用方解析好的符号事实（符号 IR、器件引脚事实），仍然不碰文件系统。
- **S1 视图层已闭环到渲染**：`spec/schematic-view.md`、`schemas/ir/v0.3/schematic-view.schema.json`、`packages/parser` 的 `view` 解析与 canonical `fmt`（语言版本 0.7）、`packages/renderer` 的 `renderSchematic`、`preview view`、参考工程两份打印页。**下一步**：`packages/core` 的板 ↔ 打印页交叉校验（视图引用的实例 / net / port 是否存在、端点引脚是否属于该 net），再把可读性检查与 round-trip 反解补上。
- **已知口径冲突（`view.label-not-on-net` 落地前必须定）**：`view` 坐标限制在 0.1mm 栅格（`VIEW_GRID_NM`），而符号引脚偏移是 2.54 / 3.81mm 的倍数，**不在 0.1mm 栅格上**。所以"标签必须精确落在引脚连接点上"对标准符号不可满足。参考工程的标签全部落在走线的网格折点 / 直段上（buck-5v 的 GND 走一条位总线，引脚到总线用带折点的 wire 连），没有标签落在引脚端点上。
- 布局不自动排版：sch 的坐标来自 IR，渲染器只画。多单元器件（双运放）要按 `unit` 选对符号视图。
- 不要顺手做自动排版——S1 打印页的自动排版仍明确不做（每次渲染都变，可读性检查就失去意义）。B0 的 agent 驱动布局布线是另一条线，见 [ADR-0116](adr/pcb/0116-layout-and-routing-are-agent-driven.md) 与 F48。

---

## F4. 第三方可实现性交叉验证（开源规范的发布门槛）

**现状**：仓库从私有转公开（[ADR-0138](adr/process/0138-licensing-and-open-standard.md)），项目定位是**纯开源技术规范**：让别人照着 `spec/` 与 `schemas/` 实现自己的 parser / 校验器 / 渲染器。当前所有规范知识都沉淀在 `packages/**` 的源码里——读者容易把"实现里怎么做的"当成"规范要求什么"，这是开源规范失败最常见的方式。

**为什么现在不做**：板级描述（`sch` / `pcb`）还没实现（`AGENTS.md` §1.1 P0），现在做完整验证等于给一个还要改的规范写验收。**但 `sch` 落地前必须做**，否则规范定型后再改代价更大。

**要做的事**：

1. 写一份**最小第三方实现**：只允许读 `spec/**`（含 `spec/teda.md`）/ `schemas/ir/**` / `tests/**`，**不许读 `packages/**` 的源码**。目标是 `component` + `symbol` + `footprint` 三种描述的解析与 IR 产出。
2. 用 `tests/` 里的 conformance 语料与黄金 IR 跑它，比对输出 IR 是否逐字段一致（字节级或语义级，口径写清）。
3. **规范补漏**：凡是实现时必须回头看 `packages/**` 才能确定的地方，在 `spec/` 里补成规范条款。补不了的（例如刻意留给实现的自由度），在 spec 里显式写"本条不约束实现"。
4. 产出一份差异报告（`docs/third-party-implementability.md`），列出规范歧义点与已修条款。

**涉及**：`spec/**`、`schemas/ir/v0.3/**`、`tests/**`、新增 `docs/third-party-implementability.md`。

**验收**：

- 第三方实现在**不参考 `packages/**` 源码**的前提下通过 conformance 核心用例。
- 差异报告里的每条歧义要么在 spec 里被写成条款，要么被显式标注为实现自由度。
- 结论回写 [ADR-0138](adr/process/0138-licensing-and-open-standard.md) decision 4.3。

**注意**：

- 这不是"再写一遍实现"——目的是**发现规范漏洞**，实现只写到能暴露漏洞的深度。发现不了歧义就说明用例覆盖不足。
- 不要让第三方实现反过来污染参考实现：发现不一致时先判断是"实现错了"还是"规范没写清"，两者的修法不同（前者改 `packages/`，后者改 `spec/`）。
- 别把它做成"重构 `packages/`"的借口。

---

## F5. 包发布形式与商标（延后，等真实使用信号）

**现状**：七个包（根 + `packages/ir` / `parser` / `exporter` / `renderer` / `core` / `cli`）都是 `"private": true`、版本 `0.0.0`，未发布到任何 registry。[ADR-0138](adr/process/0138-licensing-and-open-standard.md) decision 7 明确延后。

**为什么现在不做**：还没有外部消费者；当前包是 TS 源码（走 git 依赖即可），发布到 npm 只会在没有真实需求时产生"看起来有人在用"的假象。

**要做的事（等有信号再做）**：

1. **发布形式**：候选是 npm（`@texteda/*`）、纯 git 依赖、或者只发布 `schemas/ir/**` 与 conformance 语料。判断依据是"第三方实现者实际需要什么"——先看有没有人 clone 了仓库并自己写实现。
2. **版本号**：发布前把 `0.0.0` 换成真实版本；`format` 与 `ir_version` 独立版本（[ADR-0105](adr/ir/0105-ir-shards-and-hashes.md)）不变，发布时把 `ir_version` 打进包元数据。
3. **商标**：目前没有注册任何商标（[ADR-0138](adr/process/0138-licensing-and-open-standard.md) decision 5）。若将来第三方开始自称"符合 TextEDA"，再评估是否注册 `TextEDA` 商标并写使用指引（Apache-2.0 许可证第 6 节不授予商标许可）。

**涉及**：`packages/*/package.json`、根 `package.json`、新增 `TRADEMARKS.md`（若注册）。

**验收**：

- 第三方能按文档在一条命令内把 `@texteda/ir` 或 schema 装进自己的工程。
- 发布产物里的 `ir_version` 与仓库一致。

**注意**：

- 发布不等于放弃契约层开放：发布的是实现，契约层照样公开（[ADR-0138](adr/process/0138-licensing-and-open-standard.md) 不变量 19）。
- 别在还没有用户时先做品牌设计、文档站、CI 徽章那一套——那是"看起来在推进"的自我安慰。

---

## F6. 仓库可见性切 public（**已完成** 2026-10-21）

**现状**：GitHub 仓库 [`luffffyz/TextEDA`](https://github.com/luffffyz/TextEDA) **已公开**。许可与开放承诺已按 [ADR-0138](adr/process/0138-licensing-and-open-standard.md) 落定（Apache-2.0 + 契约层永久开源）。

**已完成（2026-10-21）**：

1. ~~扫一遍 `docs/trial-run/`、README、示例工程里的内部链接、主机名、密钥、真实项目代号~~ **已完成**（审计结论见下）。
2. ~~把 GitHub 可见性切 public~~ **已完成**（切开关后匿名 clone 与匿名 API 均返回 200）。
3. ~~同步 README 顶部的措辞~~ **已完成**（`README.md` 与 `README_cn.md` 都改为"已公开"）。

**版权前置**（切开关前已清完）：

- 5 个厂商 datasheet PDF（约 15 MB：TI `bq24610` / `tps7a20`、WCH `CH32V307DS0`、四川索斯特 `SST-3225-8M-12PF-10PPM`、硕方精密 `TS-1187`）已从索引移除并加进 `.gitignore`；
- 这些 PDF 曾在首个提交里进过历史，已用 `git filter-branch --index-filter` **重写历史清除**，并 gc 掉旧对象；
- `NOTICE` 补了"厂商文档不随仓库分发"声明；`examples/reference-project/docs/` 下的说明与 `mcu-board-components.md` 的表已改成"自行下载到本地"。

**切开关当天额外做的两件事**：

- **仓库改名**：旧写法（首字母小写）→ `TextEDA`（GitHub 仓库名大小写敏感且不重定向，所以按品牌写法走；包名与命令行仍是小写 `texteda`）。
- **清除错误署名的 trailer**：3 个提交带 `Co-Authored-By:` trailer，把模型署成了另一家的模型（实际 provider/model 是 `minimax-code-cn` / `MiniMax-M3.1-Flash`）——署名是错的。切开关前用 `git filter-branch --msg-filter` 重写移除并 force push（当时 0 fork / 0 PR / 0 star，无外部影响）；旧提交对象匿名访问已返回 404。**教训：commit trailer 是工具行为的一部分，写错了要立刻改，别等公开后。**

**审计结论（2026-10-21，`bun run check:public`）**：

- **历史干净**：17 个可达提交、331 个曾被跟踪的路径，**零个 PDF**；`git fsck --unreachable` 无残留；远端 `main` 与本地逐 commit 一致，GitHub 上没有旧 ref、tag 或 PR 引用指向重写前的历史（`git rev-list --objects origin/main | grep -i pdf` 为空）。
- **无凭据、无维护者痕迹**：私钥 / GitHub / AWS / Slack token / API key 赋值均无命中；无邮箱（提交者标识用的 GitHub noreply 形式属有意公开，但门禁仍按"零邮箱"判定）；无 `/home/<user>`、`/Users/<user>`、`C:\Users` 绝对路径（`/tmp/texteda-*` 是通用临时目录，不泄露身份）。
- **无未公开产品**：参考工程的 22 个料号全是公开在售芯片（TI `BQ24610`、WCH `CH32V307`、Vishay `IHLP4040` 等），不含真实客户项目、代号或厂牌。
- **许可齐备**：7 个 `package.json` 都有 `license: Apache-2.0` 与 `private: true`；`NOTICE` 覆盖内置的 Hershey 字形数据（MIT 正文已附）、KiCad（外部工具，未随仓库分发）、厂商 datasheet（不入库）。
- **补了一处合规缺口**：`NOTICE` 原先只提了一句 "MIT, (c) 2014 James T"，**没有 MIT 许可正文**——MIT 要求随分发附上正文。已补全。

**检查已固化为门禁**：`bun run check:public`（`scripts/check-public.ts`）。它查的是**历史**而不只是工作区——公开后进过历史的文件永久可读，fork 已存在就收不回来。检查项见 `AGENTS.md` §10。

**验收**：

- `bun run check:public` 通过。
- `git log --all --name-only | grep -i '\.pdf$'` 无输出。
- 匿名可 clone（临时目录里用无凭据方式验证）。
- 仓库里不存在第三方受版权保护的文档。

**注意**：
…
- **顺序不能反**：先清历史再切 public。反过来就要二次重写，且届时可能已有 fork。
- 以后再往 `docs/` 里放厂商文档，先想一次"这是不是受版权保护的材料"——默认不入库。
- F1（校准封装几何）依赖 datasheet 原文，按"自行下载到本地"继续，**不要因此把原文塞回仓库**。

---

## F8. 引脚归属下沉到 IR schema

**现状**：`AGENTS.md` §4.2 要求显式区分三种"没连"——floating（漏连，错误）/ no_connect（有意悬空）/ dnp（不贴）；`AGENTS.md` §4.4 绑定规则 2 说每个 sch 器件的 pin 必须能映射到封装 pad，或显式 no_connect / dnp。**这些目前只是检查器的规则**，IR schema 不要求，因此每个实现都得自己写一遍，第三方实现很容易漏。cohdl 的做法相反：把"引脚连接义务"做成类型系统的穷尽检查（unresolved pin 是编译错误，不是 DRC 警告）。

**为什么现在做**：sch 的 IR 还没写（`AGENTS.md` §1.1 P0），schema 现在改成本最低。而且这是"第三方实现只要过 schema 就自动满足"的那类约束——**对开源规范，schema 承担的义务越多，第三方实现越少出错**。

**要做的事**：

1. 给每个 pin 实例一个**归属状态**：`net` 成员 | `no_connect` | `dnp`（三态；**缺省即报错**，不允许"未提及"）。
2. schema 表达两条不变量：
   - 每个 `(component_id, pin_number)` 恰好一个归属；
   - 出现在 net 成员里的 pin 不得同时标 no_connect / dnp。
3. **floating 降级为检查器的派生诊断**（由归属缺失推出），不再是独立标记。
4. 封装侧：pin 号集合与 pad 号集合的一致性（`lib:verify` 已有）下沉到 schema 能表达的部分。
5. 补 conformance 正反例（`tests/schemas/`）。

**涉及**：`schemas/ir/v0.3/**`、`packages/ir/src/**`、`packages/parser/src/**`（sch 解析器）、`tests/schemas/**`、ADR（并入 P0 的 sch ADR 或单开一条）。

**验收**：

- 少写一个 pin 归属 → schema 校验失败并给出位置。
- 一个 pin 既属于 net 又标 no_connect → 报错。
- 第三方实现只做 schema 校验 + 展开，就能保证"没有悬空引脚"。

**注意**：

- **不要因此出现第二个真源**：net 成员表是唯一真相，pin 侧只用引用表达归属，不要把成员复制进 pin 记录。
- dnp 与 no_connect 是不同的东西：no_connect 是"这个引脚不接"，dnp 是"这个器件不贴"（`AGENTS.md` §4.2、[ADR-0114](adr/schematic/0114-flattening-and-the-net-set.md) decision：变体不影响 ERC 结果）。**别合并。**

---

## F9. 事实层禁止表达式 / 生成器在语言之外（**已定**）

**现状**：**决策已写成 [ADR-0100](adr/language/0100-fact-layer-has-no-expressions.md)**（Accepted，2026-10-22），语言层与文档已同步：

- `AGENTS.md` §5.1 硬规则新增第 7 条（事实层没有表达式）、第 2 条补"主形式只有表格一种，不引入链式记法"；`AGENTS.md` §5.3 的"生成器/循环"行指向 ADR-0100 D3；`AGENTS.md` §11 Q1 已定（不引入链式）、Q2 保留待定但判据已写死。
- `teda.md` §1 第 1 条与 `spec/teda.md` §15 的"生成器/循环/条件""表达式语言"两行指向 ADR-0100。

**ADR-0100 的决策**：D1 值是终值字面量（带单位），D2 事实层无控制流，D3 生成器在语言之外、产物是表；D4 划清边界（组合层与值层不受限），D5 给出可检查判据（每个 token 都要能回答"它描述了哪个硬件事实"），D6 写死修订条件，D7 不引入链式。

**剩下的**：只有一条——**修订条件是否被触发**。触发器是 `spec/teda.md` §10 十用例里的"20 路电源域"（语料见 F12，**已决定延后**）。在语料跑完之前，`AGENTS.md` §11 Q2 保持待定（ADR-0100 明说不关它）。真要修订时：另起 ADR + 迁移说明 + 迁移脚本，0.x 期间是**语言版本**上的一个 PATCH（[ADR-0101](adr/language/0101-one-language-version-number.md) D5）。


## F10. 库包规范与分发（registry 前置）

**现状**：[ADR-0138](adr/process/0138-licensing-and-open-standard.md) 承诺"让别人围绕它建工具"。但**光有语言规范不够**——别人要建工具，第一件事是"我从哪拿封装库"。Cohdl 的做法是 `registry.cohdl.org`（命名空间、包、精确版本钉死、`cohdl search`）加 LSP 加 VS Code 扩展加 Explorer 应用。TextEDA 侧还没有任何"分发"概念：`assets/components/` / `assets/symbols/` / `assets/footprints/` 只存在于本地工程，库引用靠 `project.toml` 的 `[libs.<name>]` 指向本地路径或 `project:` 库（[ADR-0129](adr/libraries/0129-footprint-format-and-geometry.md) 的内容哈希锚点），**没有跨工程、跨组织的库获取方式**。

**为什么现在做**：这是"别人建工具"的真正入口——第三方要做 KiCad 侧 / PLM 侧 / CI 侧工具，第一件事是"我从哪拿封装库"。库规范定不下来，工具就无从下手。

**要做的事**（先只做规范，不做服务）：

1. 定**库包格式与边界**：一个库包 = 若干 `.teda`（器件 / 符号 / 封装）+ `library.toml`（元数据、版本、内容哈希、依赖）。格式与契约层**同构**（同源语法、同一套诊断）。
2. 定**版本与锚点**：库版本怎么标（内容哈希 vs 语义版本）、怎么钉死（`project.toml` 的 `[libs]` 里已有 `content_hash` 雏形）、怎么升级。
3. 定**获取方式的抽象**：v0.1 只要求"本地路径 + 内容哈希"可解析，**不实现 registry 服务**；但要留出 `source` / `rev` 字段（`spec/teda.md` §9 已列），让未来的 registry 只是这个字段的一个取值。
4. 定**第三方库的要求**：库文件必须过 schema、必须能导出成 KiCad、必须能过 `lib:verify`（[ADR-0131](adr/libraries/0131-the-reference-project-is-self-built.md)）；不合规不收。
5. 复用 F7 的错误码与 F8 的 schema 义务——**库是契约层的延伸，不是另一个标准**。

**涉及**：`spec/`（库包规范）、`schemas/ir/v0.3/**`（库 manifest）、`AGENTS.md` §9（`[libs]` 键的最终形态）、ADR（并入 [ADR-0129](adr/libraries/0129-footprint-format-and-geometry.md) 的补充或单开）、`examples/reference-project/project.toml`（样例）。

**验收**：

- 一个第三方库包能被解析、校验、导出，且 `content_hash` 可复现。
- 库规范里没有"只能官方提供"的要求。

**注意**：

- **先规范后服务**：不要一上来就写 registry（那需要长期运维，cohdl 走了很多年）。先把"库包长什么样、怎么钉版本、怎么验证"定死。
- 库能不能被用起来，取决于**库的覆盖率与质量**，不取决于注册表的 UI。优先把"自建库能自动生成"（[ADR-0129](adr/libraries/0129-footprint-format-and-geometry.md) 的 agent 生成路线）做扎实。
- 与不变量 19 对齐：库规范属契约层，永久开放。

---

## F11. 源码位置（span）机制：诊断要能指到行列（**已落地，D6 已落地**）

**现状（2026-10-23）**：**第 1–5 条已落地**——`packages/parser` 的每个解析器在编译成 IR 之前保留记录来源（`SourceFile` + 逐记录的行号，`packages/parser/src/sources.ts`），编译时产出「IR 路径 → span」映射（`SourceMap`，`packages/ir/src/spans.ts`）；`DiagnosticLocation` 带 `byte` / `end`；schema 与语义诊断都通过这张表回填源位置（`packages/cli/src/locate.ts` 的 `locateWith` / `idLocator`）；稳定性与打乱行序的测试在 `packages/parser/test/spans.test.ts`。**D5 的引用点/定义点**落在：同文件重复行（`schematic` 解析器内部）、器件声明（`value.param-count-mismatch` / `value.invalid-param` 的 `related` 指向 `assets/components/**` 的 `params` 行）、板 net 行（`view.pin-net-mismatch`、`bind.net-mismatch`、`bind.unrouted` 的 `related` 指向板的 `nets` 行）；`bind.*` 的定位也修到了具体行（`/place/` · `/connect/` · `/deviation/`），聚合类发现（`bind.instance-unplaced`）仍按文件级报告，因为它没有单一行。**未落地：D6 的身份索引**（归 F34）。**同批修正了 D1 的一处违例**：IR 记录曾带 `line` 字段，打乱行序会改变分片字节；该字段已删除，契约升到 **v0.10**（见 [ADR-0103](adr/language/0103-source-spans.md) 2026-10-23 修正案）。

ADR-0103 的决策：

| # | 决策 |
|---|---|
| D1 | **span 不进 IR**：打乱行序后 IR 仍字节相同（`AGENTS.md` §10 的验收） |
| D2 | 编译期产出「IR 路径 → 源 span」映射，用完即丢（**不落盘**） |
| D3 | span 形状：`file`（相对工程根）+ `line`（1-based）+ `col`（1-based **Unicode 标量列**）+ `byte`（0-based 字节偏移）+ 可选 `end`（同字段，右开） |
| D4 | 粒度是**记录级**（该记录首 token），不是 token 级 |
| D5 | 引用类诊断带两处点：`location` = 引用点，`related[]` = 定义点 |
| D6 | 评审 GUI 要的「身份 → 位置」索引是**另一个产物**（附注类，不进工程哈希），现在写成 `dist/ir/identity.json`（`version: 1`），形状见 [ADR-0103](adr/language/0103-source-spans.md) D6；它不是分片、不进 `manifest.shards`，也不进工程哈希 |
| D7 | 位置只对**当次解析的那份文件**有效；`fmt` 之后要重新解析 |
| D8 | schema 违规同时给源位置（`location`）与 IR 路径（`cause.instancePath`） |

**实现要做的事**（ADR 已定，这里是工程）：

1. `packages/parser` 的内部结构在编译成 IR 之前保留来源路径，编译时剥掉；同时产出 D2 的映射表。
2. `packages/ir` 的 `DiagnosticLocation` 加可选 `byte` 与 `end`（**IR 契约 `schemas/ir/v0.3/**` 不动**——位置不是语义契约的一部分）。
3. 语义检查器与 schema 校验器的诊断接上 D8：源位置 + IR 路径两条都给。
4. 位置稳定性测试：同一份源两次解析位置一致；打乱行序后 IR 字节不变而诊断位置指向新行号。
5. 跨文件引用的 `related` 落点（引用点 + 定义点）。

**D6 已落地（2026-10-26）**：`texteda ir` 从通过契约的 `Draft` 生成 `dist/ir/identity.json`，键是 `instance:<board>/<id>`、`net:<board>/<id>`、`port:<board>/<id>`、`component:<id>`、`component-pin:<id>/<pin>`、`symbol:<lib>:<id>`、`footprint:<lib>:<id>`；值是 `{kind,label,file,line,col}`。打印页的 `place` / `wire` / `label` / `port` 与 PCB 的 `place` 追加到同一身份键下。构造在 `packages/cli/src/identity.ts`，写盘在 `packages/cli/src/ir-tree.ts`，评审模型消费在 `packages/cli/src/review.ts`；测试在 `packages/cli/test/ir-tree.test.ts` 与 `packages/cli/test/review.test.ts`。

**注意**：

- **不要为了位置把源文本复制进 IR**（[ADR-0104](adr/ir/0104-ir-representation.md) 明令：IR 不复制源文本与注释）。span 是位置元数据，且**不进 IR**。
- 列号的字符语义（中文、`Ω`、`±` 怎么算列）已在 ADR-0103 D3 写死，第三方实现按它算。
- 评审 GUI（F34）依赖的是 D6 的身份索引，不是 D2 的源映射；两者别混。


## F12. 十用例语料（语法准入规则的闸门）——**进行中（4 / 10）**

**进度（2026-10-25 三个，2026-10-27 加 `diff-pair`）**：约定落地在 `examples/cases/README.md`（一个用例 = 一个完整小工程 + `expected/{ir/**,manifest.json,diagnostics.json,netlist.txt}`；`bun run cases:check` 比对、`--update` 重写，`bun test` 里有一条带上它；用例必须无 error）。已写：

| 用例 | 证明什么 | 暴露的问题 |
|---|---|---|
| `dual-opamp-multi-unit` | 一个件三个单元；net 成员必须写单元（`U1.2.OUT`）；unit 只是引脚的事实，实例仍是一行 | 裸名 `U1.OUT` 原先**静默取第一个**（会把线接到错的单元上）→ 已改成 `ref.ambiguous-pin`，提示写单元 |
| `nc-pins` | `no_connect` 静默 / 有意悬空告警 / 已连静默，三者分得开；port 豁免单成员告警；三爪（TH）封装 | 契约的 `layer_name` 模式拒绝 `*.Cu`——**任何 TH 封装都过不了契约**（解析器一直在产出这个名字）→ 已修模式并补正例夹具 |
| `bus` | `bus` 只是命名方案：成员行展开成普通 net（`i2c0.scl`），不连接成员；port / constraint 可以点名成员 net；一个 bus id 只允许一个块，重复**成员行**才合并 | 成员 net 原先**不在** `scope.nets` 里，port 与 constraint 点名它会被报 `ref.unknown-net`；重复的 `bus` 块原先静默产出两个同 id 的 bus 分片 → 已补 `busNets` 解析、`ref.duplicate-bus` 与 `net.duplicate-member`，并修 `fmt` 把第二个 bus 块覆盖掉的问题 |
| `diff-pair` | 差分对是**声明**不是几何：`diff CANH CANL 120Ω ±10%` 与 `skew CANH CANL <= 5mm` 落在 IR 的 `impedance_mohm`(120000) / `tolerance_ppm`(100000) / `op`(`<=`) / `length_nm`(5000000)；两个 net 仍是普通 net（成员、窗口、悬空引脚照常查）；split termination 用 4 个通用件围一对线；`U1.Vref` 有意悬空 → 一条 `net.pin-unassigned` warning 被钉住 | 没有。全部用现有语言写出（`diff` / `skew` 自 `spec/teda.md` §7.4 起就有语法、解析器与契约分支），用例证明的是**没有东西消费它们**——`packages/core` 里没有检查器读 `diff` / `skew`，所以这对约束只能钉 IR，钉不到诊断。**缺口是检查器，不是表面**。另外顺手抓到一个渲染器缺陷：通孔焊盘的层是通配名 `*.Cu` / `*.Mask`，`LAYER_STYLE` 没有这两个键，回退成 `fill=none stroke=none`——**整块通孔焊盘画不出来**（参考工程全是 SMD 件，三个带排针的用例都没人看一眼图）。已补样式与绘序，回归测试见 `packages/renderer/test/wildcard-layers.test.ts`；同时修了两个用例里丝印压在焊盘上的行 |

**`diff` / `skew` 的落地状态（写于 2026-10-27）**：语法（`spec/teda.md` §7.4）、解析（`packages/parser/src/schematic.ts` 的 `case "diff"` / `case "skew"`）、契约（`schematic.schema.json` 的 `constraint` 分支）都在，**没有**任何规则消费它们：`impedance` / `length` / `diff` / `skew` 目前只被「pcb 里点名的 net 必须存在」这条绑定校验顺带看到（`packages/core/src/binding/checks.ts`）。差分阻抗与等长要能判定，得先有 B0 的走线数据与 DRC 指标（F48），所以本项不重复登记。

**剩下的 6 个，各自的已知障碍**（写之前先读）：

- **DNP 变体**：语言**没有** `dnp` 的表面（`project.toml` 的 `[variants]` 也还没解析），IR 有 `dnp` 字段但没有来源 → 先定表面（ADR），再写用例。
- **net tie**：受控偏差在 `pcb` 的类型里，需要 `pcb` 描述 + `connect` 段 + 铜箔，用例要带一块最小的板。
- 其余 4 个（BGA 200 脚、20 路电源域、层次复用、参数化分压）都能用现有语言写，按难度排：层次复用 → BGA 200 脚 → 参数化分压 → 20 路电源域。
- **20 路电源域**写完后要回头回答 `AGENTS.md` §11 Q2（表达式程度）：如果表真的宽到不可用，那才是引入受限表达式的触发条件。


**原决定（2026-10-21，已被上面的进度取代）**：**延后**。项目距完善还有相当距离，十用例不是当前瓶颈；sch 解析器、展平、BOM 计数、诊断注册表都还没落地，现在写语料等于给一个还会变的 IR 写黄金文件。**触发条件**：sch 的 IR 与展平口径定版之后。

**延后期间的替代闸门**（`AGENTS.md` §5.2 第 1 条不可评估时的临时口径）：

- 新语法特性仍要满足 `AGENTS.md` §5.2 的第 2、3 条（EBNF + 语义 + 正反例 + 错误文案）；
- 第 1 条改为**在 ADR 里写清"这个特性解决哪个具体硬件问题"**，并给一个**最小的具体片段**（不是完整用例），例如"20 路电源域里每路的 5 个器件要写 5 行 × 20 路 = 100 行"；
- ADR 里要写"将来补语料时回到这条"。

**现状**：`AGENTS.md` §10 列了十个困难用例（BGA 200 脚、双运放多单元、20 路电源域、差分对、DNP 变体、net tie、总线、层次复用、参数化分压、NC 引脚），并要求"先于实现写"；`AGENTS.md` §5.2 把"至少一个用例必须用到它"作为新语法特性的准入条件。**已落地 4 个**（见上表），另 6 个未写（障碍见上）。

**为什么现在做**：这是当前**最挡路的一条**：

- `AGENTS.md` §5.2 的语法准入规则**无法评估**——没有用例就没有证据，任何新语法都能绕过闸门；
- conformance（`source → IR → netlist` 黄金文件）与 binding（5 类受控偏差正反例）都从这批语料长出来；
- `AGENTS.md` §11 Q2（表达式程度）的修订条件绑定在"20 路电源域"这个用例上；
- 参考工程只有 2 块板（`mcu-board` 单页、`charger-buck` 两页），规模与难度都不到用例级别。

**要做的事**：

1. ~~定目录约定~~ **已定**（2026-10-24，实际形状见 `examples/cases/README.md`）：一个用例 = 一个完整小工程（`project.toml` + `assets/` + `design/sch/`），期望在 `expected/ir/**`（逐字节）+ `expected/manifest.json`（去掉 `tool_version`）+ `expected/diagnostics.json`（`code/severity/file/line`，不钉文案）+ `expected/netlist.txt`（连通性投影）。
2. 十个用例逐个落地，每个至少含：源描述、期望 IR（canonical）、**以及这个用例触发的检查点**（哪些错误码、哪些断言）。
3. ~~先做不依赖 sch 解析器的四个~~：sch 解析器已落地，这条按难度排取代（见上面的进度表）；`nc-pins` 已完成。
4. 再做需要 sch 解析器的六个：BGA 200 脚、双运放多单元、20 路电源域、总线、层次复用、参数化分压（外加差分对；`dual-opamp-multi-unit`、`bus`、`diff-pair` 已完成）。
5. ~~每个用例配一条可跑的检查~~ **已落地**：`bun run cases:check`（`--update` 重写）+ `bun test` 里的 `packages/cli/test/cases.test.ts`。
6. 用例写完后回头把 `AGENTS.md` §5.2 的闸门接上（当前状态：能问"哪个用例用到它"，但"没有用例用到"还不足以下结论，见 `AGENTS.md` §5.2）。

**涉及**：`examples/cases/**`、`tests/**` 或各包 `test/`、`packages/parser`（需要时补解析能力）、`AGENTS.md` §5.2 / §10。

**验收**：

- 十个用例目录齐备，每个都有源描述 + 期望 IR + 检查点。
- `bun test` 覆盖它们。
- `AGENTS.md` §5.2 的准入规则可评估：能对任一新语法说"有哪个用例用它 / 没有，所以不加"。

**注意**：

- **用例要难**：自己给自己出题容易偏软。尽量取真实项目的痛点（BGA 扇出、20 路电源域的共地与去耦、多单元器件跨单元的 net、层次化板卡）。
- 期望 IR 必须 **canonical**（打乱行序后仍字节相同）——否则用例本身违反 `AGENTS.md` §10 的"IR 只依赖语义"。
- **不要用生成器批量造用例**：生成器产出的正是"程序化写法"，用它当用例会把 `AGENTS.md` §5.3 的方向带偏（生成器在语言外，产物是表——用例应当手写表形态）。
- 先做四个不依赖 sch 的，把用例流程跑通，再批量。

---

## F13. 层次（`module` / 参数）：模块层已落地，参数与嵌套仍延后

**现状（2026-10-22 更新）**：**模块层已落地**（语言 0.8）——规范 `spec/module.md`、决策 [ADR-0112](adr/schematic/0112-modules-compose-boards.md)、解析器（`packages/parser`：`design/modules/` 段 + `module` 文件 + 端口绑定 + 展平进板级 IR）、canonical formatter、CLI（`loadBoard` 读 `design/modules/`，`check` / `compile` / `ir` 走同一路径）。参考工程里 `charger-buck` 板已改写为"两个模块 + 板级器件"。

这一条原来是"层次是设计里唯一自指闭环的部分"（`AGENTS.md` §4.2 说有 module/参数/import，`teda.md` 说"草案见 `AGENTS.md` §5.3"，`AGENTS.md` §5.3 又指回 `teda.md`）。那个闭环已经拆掉：模块有规范、有语法、有解析器、有用例。

**已定并已实现的约束（2026-10-21 讨论定，2026-10-22 落地）**：

1. **层次只在源码层，IR 存展平结果**——展平口径由 module 自己定义（旧的页面展平机制已随语言 0.7 撤销，见 [ADR-0111](adr/schematic/0111-one-flat-schematic-per-board.md)）。IR 里不留 module 结构，否则第三方实现要额外实现 module 解析 / 展开 / 端口解析三套语义。**已落地**：IR 契约不变（仍是 0.2 的平表），模块只存在于源码层。
2. **module 是唯一的层次**：有 ports，展平命名用 `<instance_id>.<net>`（[ADR-0111](adr/schematic/0111-one-flat-schematic-per-board.md) D5），未连接端口必须显式（与 F8 的 pin 归属三态同构）。**外层 id 的层级标记**：module 实例用 `M` 开头（`M1.R1`）；`P`（页面）已随页面机制撤销，`MOD` 不用（[ADR-0111](adr/schematic/0111-one-flat-schematic-per-board.md) decision 6）。**已落地**：模块实例 id `M1`、展平实例 `M1.R1`、展平 net `M1.VFB`；端口用 `no_connect` 显式悬空。
3. **参数只做字面量替换，不参与运算**：参数值与实例覆盖值都必须是字面量（可带单位）；禁止 `VOUT = $vin * $ratio`、禁止参数引用参数、禁止函数调用。派生值由语言外的生成器算好后写成字面量（与 F9 同源）。**未落地**（见下）。
4. **评审可见性**：module 体里的 `$rset` 意味着"值来自实例"，评审者看实例行即可（**一跳**，不是程序语义）；实例行里的值是字面量。参数化**结构**不藏事实，参数化**取值**才藏事实——后者不做。

**还没落地的部分**（触发后做）：

1. **模块参数**（约束 3）：`$name` 形参、实例行覆盖字面量值。判据不变——出现真实的"同构重复 ≥ 15 行、实例 ≥ 3 次、**且取值各不相同**"才做。参数化结构不藏事实、参数化取值藏事实（所以不做），见约束 4。
2. **模块嵌套**：模块引用模块。层次只有一层是当前决定；嵌套要额外定"展开预算"（防展开爆炸，参考 cohdl 的展开预算）与循环检测。
3. **跨工程模块库**：`use` / `import` + 库包规范（module 进库包），等 F10 的库包规范先定。
4. **版本锁定与循环检测**（`module` 文件的版本锚定）。

**什么时候层次真的值得（判据）**：

- **同构重复**（例如 4 路一模一样的 LDO，块 ≥ ~15 行、实例 ≥ 3 次）→ 值得。
- **同构带差异**（20 路电源域：结构同、值不同）→ **多半不值得**——层次会把 20 份字面量收成 1 份体 + 20 个覆盖，评审要跨 20 处对照；写开是 20 份可并排看的表，而**表很便宜**（一行一个事实，diff 干净）。
- 层次**不解决**：BGA 200 脚引脚表太长、电源域公共点太多——那些是 pin 表与 net 表问题。
- `AGENTS.md` §7 的"规模 >100 器件上下文爆炸"由展平后的净表 + 打印页分块缓解，层次只是其中一种手段。

**注意**：

- 层次是源码层机制，越晚定越便宜——sch 解析器与展平口径没定之前定层次，等于在没学会走路前学跑步。（模块层是在展平口径定版之后才落的。）
- 不要用层次去解决"文件太长"：表长不是问题，**一行一个事实**才是问题；层次会把"可见的事实"变成"要展开才可见的事实"。
- 引入层次时，F9 的"事实层无表达式"仍然成立：层次是替换机制，不是表达式机制。

---

## F14. `fab` 的目标形态：制造中立数据是契约层，KiCad 只是兼容方案（**已定**）

**现状**：**决策已写成 [ADR-0120](adr/manufacturing/0120-the-manufacturing-output-path.md)**（Accepted，2026-10-22）。它把 [ADR-0120](adr/manufacturing/0120-the-manufacturing-output-path.md) D3 的一行展开成可实现的形状：

| 决策 | 内容 |
|---|---|
| D1 | **派生为主**：能从 `pcb` + `sch` + 采购主料算出来的，一律算，不重写（`AGENTS.md` §7 的"重复描述"坑） |
| D2 | 数据内容：身份（板/变体/`source_hash`/`tool_version`）、BOM 行（`component_id` + 参数字典 + 变体状态 + 选中料）、位号+坐标+朝向+面、层叠与规则意图、制造附加 |
| D3 | **不含**：铜箔图形（在 `pcb` IR 里）、订单事实（试产/量产/数量/订单号）、**评审状态**（会随时间变，进了包就破坏"两次编译逐字节相同"） |
| D4 | 按 **板 × 变体**，**规范分片**（进工程哈希）；备选料仍是附注（[ADR-0128](adr/devices/0128-the-procurement-layer.md) D13） |
| D5 | 制造包**自描述**：文件名带板/变体/哈希前缀，载荷带完整 `source_hash` + `tool_version`（不变量 11）；IR 树仍是稳定名 + manifest 记哈希 |
| D6 | **门是流程不是格式**：试产永不阻断；量产要求每轮评审"有交代"（关闭或明确接受并记录），工具只报告不阻断 |
| D7 | **拼板不做**，但槽位存在（空则省略，不变量 18），以后加是加法 |
| D8 | 制造附加的**来源位置**（`fab` 描述类型是否存在）随实现定——`AGENTS.md` §11 Q17 收窄后的形态 |
| D9 | 写出器读 `pcb` IR，不读制造中立数据；不自研 CAM 判定 |
| D10 | 制造产线**零依赖**：不装 KiCad 也能走完 |

**顺带关掉** [ADR-0136](adr/view/0136-review-records-and-attribution.md) 的一个开放点（"未关闭的评审轮次是否阻断制造出口" → 不阻断；量产的门是"有交代"）。

**剩下的**（P3 实现时）：

1. `spec/fab.md` + 分片 schema：字段名、单位、省略规则、变体语义（ADR-0120 的开放点）。
2. 编译器产出该分片（`boards/<board_id>/fab.json` 或等价路径），并纳入工程哈希。
3. 制造附加的来源（若 P3 阶段要写拼板或装配说明，`AGENTS.md` §11 Q17 就要给最终答案）。
4. 打包格式（目录 / 归档 / 文件集）是导出器的事，ADR-0120 只定命名与身份。

**注意**：

- **不要让"制造中立数据"变成 KiCad 工程文件的翻版**（`AGENTS.md` §7 的"pcb 变成 KiCad 的翻版"同款坑）——ADR-0120 D6 就是这条的守门。
- 制造中立数据一旦公开就是契约层（[ADR-0138](adr/process/0138-licensing-and-open-standard.md) 不变量 19），别为了排他性把它关起来。
- **零依赖是硬要求**（[ADR-0120](adr/manufacturing/0120-the-manufacturing-output-path.md) / 不变量 20）：这条产线不得依赖 KiCad 才能跑通，KiCad 只是可选后端。
- **评审不是闸门**——不要在工具里加"评审未关闭就拒绝出包"的检查（ADR-0120 D8）。

## F15. 自研 Gerber / Excellon 写出器（零依赖制造出口）

**现状（2026-10-27 更新）**：**层集合已完整**——`texteda export gerbers <工程目录> <board_id> [--out <dir>] [--json]` 从 pcb IR + 封装 + 导出时重算的铜皮填充写出分层 RS-274X 与一份 Excellon（`packages/core` 的 `fill/` + `boardImage()` + `mask-paste.ts` + `silk.ts`，`packages/exporter` 的 `gerber.ts` + `excellon.ts`；格式条款冻结在 [ADR-0117](adr/pcb/0117-copper-fill-uses-a-geometry-kernel.md) D9、D10，入口与文件清单见 `spec/pcb.md` §8）。参考工程 `charger-buck` 出 9 个 Gerber（2 铜层 + 两面各 Mask/Paste/SilkS + 板框）+ 1 个钻孔文件，两次导出逐字节相同（`packages/cli/test/export.test.ts`）。**仍缺**：`.kicad_pcb` 板导出器；制造包（F14）。`docs/trial-run/` 里的 IR → KiCad → Gerber 是一次性历史原型，不是可调用的产品路径。**目标形态已定**（[ADR-0120](adr/manufacturing/0120-the-manufacturing-output-path.md) D3）：制造中立数据**不含铜箔图形**，所以写出器的输入只有 `pcb` IR 与层映射表，制造数据里的层叠/规则意图只是随包走的意图，不是几何来源。这要求用户安装 KiCad，与 [ADR-0120](adr/manufacturing/0120-the-manufacturing-output-path.md) D1 的零依赖原则（不变量 20）冲突：TextEDA 的目标是"装 TextEDA 就能走完描述 → 校验 → 渲染 → 制造包"。

**为什么工作量是已知的**：RS-274X 是行式文本格式（aperture 定义 + draw / flash + 坐标），**序列化本身不需要几何内核**；本仓已有 pcb IR 的层、焊盘、走线、过孔、丝印事实，缺的是画布展开与坐标变换。**但铜皮填充需要几何内核**：`zone` 只存意图，Gerber 要实际填充区域；这个内核由 F49 提供，不是把结果放进 IR 就能消失的。对照自建符号库与封装库的实际经验（[ADR-0129](adr/libraries/0129-footprint-format-and-geometry.md) ~ [ADR-0131](adr/libraries/0131-the-reference-project-is-self-built.md)）——"自建比想象中容易"已经被验证过一次，但填充不是那一类简单工作。

**要做的事**（P3；F49 是带 `zone` 的板的前置条件，F14 只阻塞制造包、不阻塞 raw Gerber）。第 1–4、6 条已落地；第 5 条仍待做：

1. **定写出范围**：RS-274X + Excellon 钻孔；坐标格式 4.6（与 IR 的整数纳米一致）；零填充（leading zero suppression）取哪一种要写进规范并冻结。
2. ~~**层映射表**~~ **已落地**：pcb IR 的层 → Gerber 文件名与层标识（`F.Cu` → `F_Cu.gbr`），板框、丝印、阻焊、锡膏开窗的对应关系见 `spec/pcb.md` §8.2；阻焊/锡膏是开窗（不是铜），默认与逐边语义见 `spec/pcb.md` §4.9，丝印的职责切分见 `spec/pcb.md` §4.10。
3. **铜皮展开**：Gerber 需要实际填充区域。**由导出时的受限 2D 几何内核从 `zone` 意图重算**（[ADR-0117](adr/pcb/0117-copper-fill-uses-a-geometry-kernel.md)、F49）；填充结果**不进 IR、不进工程哈希**，缓存只能是可删除、可重算的派生物。写出器只负责序列化，不在 `packages/exporter` 里另写一套几何算法。
4. **极性与 D-code 复用、镜像、旋转**：全部按坐标变换处理，不引入额外语义。
5. **对照测试**（可选，不是门禁）：同一块板，自研写出器与 `kicad-cli pcb export gerbers` 的产物要比对——层集合、孔位、图形数量一致。
6. **可复现**：同一 IR 两次导出**逐字节相同**（与不变量 18 的 canonical 要求一致）。

**不做**：CAM 级 DFM 判定（阻焊开窗规则、锡膏膨胀、丝印避让、阻抗规则的可制造性判断）。Gerber 是格式，判定是规则工程，交给专业 CAM（[ADR-0120](adr/manufacturing/0120-the-manufacturing-output-path.md) decision 2）。

**验收**：

- 在**没有 KiCad 的机器上**跑通 `texteda export gerbers <board>`，产出分层 Gerber + 钻孔文件。**已完成**（必过段零外部依赖）。
- 与 KiCad 产物在层集合、孔位、图形数量上一致（对照测试）。**未完成**——这是观测，不是门禁（不变量 20）。
- 同一 IR 两次导出逐字节相同。**已完成**（`packages/cli/test/export.test.ts`）。

**注意**：

- 这一条的价值不只是"少一个依赖"，更是**契约层自足**：第三方实现者拿到 IR 就能出制造包，不必安装 KiCad，也不必实现 KiCad 的语义（不变量 19 的兑现）。
- **不要顺手把 CAM 规则塞进来**：格式层与判定层分开，否则这条会变成无底洞。
- 极性与 D-code 的选择写进规范并冻结——Gerber 一旦流到工厂就是 ABI。

---

## F16. 网表与 KiCad 原理图导出（P1）

**现状**：`packages/parser` 能把板文件编译成板级 IR 分片（`bun run compile:schematic <项目目录> <board_id>`），IR 里已有实例、net（编号形式的引脚引用）、端口与约束。**网表已落地**：`texteda netlist <项目目录> [--board <id>] [--json] [--out <文件>]`，实现在 `packages/exporter/src/netlist.ts`，是 IR 的纯函数投影（net/成员/实例都排序，逐字节可复现；有 error 时拒绝导出）。**netlist 只带连通性**：值、容差、封装属于 BOM，不进来。**KiCad 原理图导出仍是空的**：`packages/exporter` 只有封装与符号；原记录：`packages/exporter` 只做封装（`.kicad_mod`）与符号（`.kicad_sym`）→ KiCad，没有原理图方向的产物；BOM 与网表也没做。

**要做的事**：

1. **网表导出**：从板级 IR 出网表（先定中间形态：项目自己的 JSON 网表，还是直接 KiCad 的 `.net`）。这一层是**纯连通性**（实例、引脚、net 名），没有几何。
2. **KiCad 原理图导出**（`.kicad_sch`）：目标是 KiCad 能打开、能读出同样的连通性。**连线几何属于 S1 视图层**（可自由），但导出物必须能被反解校验：`kicad-cli sch export netlist` 出来的 netlist 与源 IR 的连通性一致。
3. **BOM**：按 AGENTS.md §4.2 的聚合键（`component_id` + 参数字典 + 变体状态，不含 refdes）出 CSV 与 JSON。

**涉及文件**：`packages/exporter/src/`（新增网表 / BOM / 原理图导出）、`packages/ir/src/generated/types/schematic.ts`（若 IR 要补字段，先改 schema 再改生成物）。

**验收**：

- 参考工程两块板（`mcu-board`、`charger-buck`）都能出网表；网表里的 net 成员集合与板级 IR 的 `nets[].members` **逐条相等**。
- KiCad 导出的原理图能被 `kicad-cli` 读入并导出 netlist，导出的 netlist 与源 IR 连通性一致（`extract(export(ir)) == ir` 的连通性口径）。
- 同一 IR 两次导出逐字节相同（UUID 必须由内容派生，不能随机——不变量 11 的可复现要求）。

**注意**：

- **网表/BOM 不是渲染**：不要在导出器里塞"排版好看"的目标；KiCad 原理图里的符号摆放与连线走向属于 S1，可以任意，只要连通性对。
- BOM 的参数值要人读（`10k` 而不是 `10000000 µΩ`），所以需要"规范单位 → 显示值"的换算；**规范单位表只有一份**（[ADR-0105](adr/ir/0105-ir-shards-and-hashes.md) decision 7），不要在导出器里另抄一张。
- 变体（DNP / 不贴）还没进 IR，BOM 的"变体状态"这一列先留空，等 P3。

---

## F17. `project.toml` 与 `system` 描述的解析（语言表面的最后两块）

**现状**：**已落地**（2026-10-23）——`project.toml` 有解析器（`packages/parser/src/project.ts`，手写 TOML 子集，零依赖），产出 `project` IR 分片；`system` 描述类型有解析器（`packages/parser/src/system.ts`，段只有 `boards` 与 `nets`）+ canonical `fmt` + `system` IR 分片 + 跨板校验（`packages/core/src/system/rules.ts`）。`texteda check` 现在读得到板列表、跑得了系统层的校验（板不存在 / port 未声明 / 一个板内 net 被并进两条系统 net / 两侧电压区间不相交）。参考工程多了一份 `design/system/power-chain.teda`（把 `charger-buck` 与 `mcu-board` 接起来）。

**当时的现状（已过时，保留作对照）**：语言表面还差两块没实现——`project.toml`（项目元数据：名称、版本、板列表、变体、库引用）与 `system`（板间连接）。`scripts/lib/project.ts` 里有一份只够库校验用的手写 TOML 读取，不是解析器；`system` 描述完全没有代码。`sch` 解析器已经能读板文件，但**读不到板列表**，所以跨板校验（teda.md §11 第 9 条：两侧电压区间不相交报错）做不了。

**要做的事**：

1. **`project.toml` 解析**：按 AGENTS.md §9 的键表实现（`[project]` 必填三项、`[boards.*]`、`[variants.*]`、`[libs.*]`、`[compliance]`、`[ext]`）；未知顶层键报错；不写时间戳、绝对路径、随机 ID、派生数据。
2. **`system` 描述解析**：段只有 `boards` 与 `nets`；成员是 `<board_id>.<port_id>` 引用，不是引脚引用。校验项见 `spec/teda.md` §8.1/§8.2 与 `spec/teda.md` §11 第 9 条。
3. 把两者接到 CLI：`texteda check` 先要能列出工程里的板与系统。

**涉及文件**：`packages/parser/src/project.ts`（新）、`packages/parser/src/system.ts`（新）、`packages/cli/scripts/texteda.ts`。

**验收**：

- 解析参考工程的 `project.toml` 与（新增的）一份 `system` 描述，板列表与实际 `design/sch/` 文件对得上。
- `system` 的每条 net 至少两个成员、成员都是已声明的 port、同一个板内 net 不被并进两条系统 net；两侧电压区间不相交时报错。
- 未知顶层键、未知段名都报错并给出行列。

**注意**：

- **TOML 解析不要引依赖**：项目默认零运行时依赖；手写一个够用的子集解析器（键值、表、数组 of tables、字符串/数字/布尔/数组），遇到子集外的语法就明确报错，不要"尽力解析"。
- `system` **不改写板内连通性**（不变量 15）：删掉 system 文件，各板依然独立成立；这条要有测试兜着。
- `project.toml` 只承载元数据，**不承载电路**。

---

## F18. `texteda check`：一条命令跑完解析、契约校验与 ERC

**现状**：**sch 级已落地**（[ADR-0137](adr/process/0137-implementation-stack-and-agent-entry.md)）。`bun run check <项目目录>` 遍历工程里的全部板（`design/sch/<board>.teda`），逐板解析 → 语义层 ERC → 契约层 schema 校验，诊断走 [ADR-0102](adr/language/0102-diagnostic-error-codes.md) 的统一载荷（`code` / `severity` / `location` / `data` / `hint`），`--json` 打到 stdout、人读模式打到 stderr；有 error 退出码 1，只有 warning 退出码 0。器件文件解析失败（`syntax.component-invalid`）与器件文件头 id 与文件名不一致（`ref.component-id-mismatch`）也走同一条通道。

**还没做的**：

1. ~~`project.toml` / `system` / `pcb` 的解析还没接进 `check`~~ **已落地**（`project.toml` 与 `system` 见 F17；`pcb` 描述在 F16 里落地后也接进了 `check`——板级绑定校验 `checkBinding` 随之进 `check`）。
2. **ERC 与契约校验分层计数**：现在两类诊断在同一个数组里（`severity` 能区分 error/warning，但"契约错"与"设计错"没有分开统计）。
3. 诊断顺序稳定 ✓（板按 id 排序、板内按产出顺序），但还没写成测试。

**验收（已过的部分）**：

- 对参考工程跑 `texteda check`，退出码 0，诊断里只有已知的 ERC 警告（未连接引脚）。✓
- 故意写坏一个文件（器件找不到、器件文件解析失败），退出码非 0，`--json` 里有文件、行列与码。✓（`packages/cli/test/check.test.ts`）

**注意**：

- **`check` 不改文件**：只报告，不修；修是 `fmt` 与显式 patch 的事。
- 警告不阻止退出码 0（ERC 警告是设计信息，不是失败）——这条要写进 CLI 的帮助文本，否则 agent 会误判。

## F19. ERC 从 parser 外移到 core：让第三方分清"语法错"和"设计错"

**现状**：解析器（`packages/parser/src/schematic.ts`）同时报语法错误与 ERC 规则违规——同一个诊断数组里既有 `syntax.row-too-short`，也有 `net.pin-in-two-nets`。对本项目没问题，但**第三方实现者**没法据此判断"是我的语法实现写错了"还是"这个设计本身有问题"。

**要做的事**：

1. 建 `packages/core`（[ADR-0137](adr/process/0137-implementation-stack-and-agent-entry.md) 已规划：纯函数，禁 `Bun.*` 与 `process.env`），把 ERC 规则作为独立阶段放进去：输入是解析结果，输出是 ERC 诊断。
2. `packages/parser` 只出语法与语义层面的"读不出来"（器件找不到、引脚不存在这类解析失败），不出规则违规。
3. ~~`texteda check` 的载荷里区分两类~~ **已落地（第一步）**：诊断按**域**归到三个阶段（`parse` / `contract` / `semantic`），载荷带 `countsByStage`，`check` 的人读输出也打印阶段分布。不需要调用点声明阶段——域是封闭词表，一个域只可能属于一个阶段。剩下的是真正的迁移：把 `net` / `drc` 域的规则从 parser 挪进 `packages/core`。

**第二步已落地**：`packages/core` 建包，连通性四条规则（`drc.single-member-net` / `net.pin-in-two-nets` / `net.pin-unassigned` / `net.no-connect-connected`）移出 parser，改成纯函数 `checkConnectivity(facts)`——吃展平后的 net、每个实例的引脚、带端口的 net 集合与定位回调，不认识语法也不碰 fs。parser 只负责摆事实（约 25 行），行为等价（参考工程仍是 79 警告，`pin-in-two-nets` 的定位从"板文件首行"变成该 net 的真实行）。规则自带 8 条单测，不需要构造 `.teda` 源。

**还剩**：`ref.duplicate-port-net` / `ref.port-net-undecided` / bus 相关规则仍长在 parser 里；`check` 的编排也还在 CLI。真正的收口是让 `core` 提供 `analyzeBoard()`（parse → ERC → 契约），CLI 只剩读文件与打印。

**为什么现在做**：F16（网表导出）与 LSP 都要复用同一套检查；规则散在 parser 里时，每加一个导出格式就要抄一遍判断。

**注意**：规则**保持代码**，不做规则 DSL（AGENTS.md §11 Q2/Q9：表达式与生成器都推过）。外移的是**边界**，不是表达方式。

## F20. IR 契约参考的字段说明补齐 + `pcb` 分片

**现状**：`docs/ir-reference.md`（[ADR-0137](adr/process/0137-implementation-stack-and-agent-entry.md)）已生成，每个字段一行（类型 / 必填 / 单位 / 说明），联合类型按分支展开（`constraint（type=voltage）` …），文末有"缺说明"清单。**非 pcb 分片已 100% 覆盖**（common / component / schematic / manifest / system / project / symbol / footprint）；**`pcb` 分片还剩 81 个字段没说明**，而 `pcb` 描述本身还没实现。

**要做的事**：

1. 给 `schemas/ir/v0.3/pcb.schema.json` 的字段补 `description`（`pcb` 描述落地时一并做，否则会返工）。
2. 把"缺说明字段数"变成一个门槛（`gen:check` 或 CI 里卡覆盖率），防止新字段裸奔。

**注意**：description 是**契约的一部分**（写的是这个字段装什么），不是文档润色；补它等于把 IR 语义写进唯一真源。补说明时若给 `$ref` 加兄弟 `description`，生成器必须开 `unreachableDefinitions`，否则命名类型会被内联掉（[ADR-0137](adr/process/0137-implementation-stack-and-agent-entry.md)）。

## F21. pcb 描述：绑定校验、`fmt`、参考工程的 pcb

**现状**：`pcb` 12 段的解析已落地（`packages/parser/src/pcb.ts` → `schemas/ir/v0.3/pcb.schema.json`，`texteda compile <dir> <id> --pcb`）。覆盖面是 `spec/pcb.md` §1–§6 的全部段与 10 种规则；`stackup` 顺序/编号、板厚与叠层之和、板框闭合与自交、重复放置、重复 pad 对都在解析期报。

**没做的三件**：

1. ~~**绑定校验**~~ **已落地（规则 1–5、12、13）**：`packages/core/src/binding/checks.ts` 的 `checkBinding()`，接在 `texteda check` 里（有 `design/pcb/<board>.teda` 就跑）。覆盖：未知实例、未放置 pad、跨 net 短接（`net_tie` 可豁免）、未布线（warning）、未知 net、部分布局（规则 12，warning）、铜箔兑现（规则 13）。**还差**规则 6–8（`rules`/`trace` 的层名与 net 存在性已做，`physical_only` 的 `fiducial` 不得挂 net、`deviation` 白名单类型完整性）与规则 10–11（多边形自交已在解析期做，丝印层枚举已做）。**已补**：声明的偏差进报告（`net_tie` = note、`split_ground` = warning，ADR-0113 D10；`packages/core` 已在 `texteda check` 里输出）。另按 [ADR-0113](adr/schematic/0113-connectivity-has-one-authority.md) D2 的口径补三条：**白名单封闭**（四类之外的差异一律 error，不是 warning）、`stitching`（跨层）与连接两个不同 net 的过孔按 `net_tie` 处理。（`test_point` 已于 2026-10-22b 退役，见 F38。）
2. ~~**`pcb` 的 canonical formatter**~~ **已落地**：`packages/parser/src/fmt-pcb.ts`，`fmt --check` 已覆盖 pcb（参考工程的 `design/pcb/charger-buck.teda` 已重排成 canonical）。三条不变量都有测试：`parse(fmt(x))` 与 `parse(x)` 产出**逐字节相同**的 IR、`fmt(fmt(x)) == fmt(x)`、注释原地保留。**canonical 归一口径在解析器里**（`connect` 对内排序、`trace` 折线方向、`rules` 类型序），formatter 复用同一口径——否则 IR 与源文件会各排各的。
3. ~~**参考工程的 pcb**~~ **已有**：`examples/reference-project/design/pcb/charger-buck.teda`（放置 M2 页 9 个器件 + `connect` + `trace`/`via`/`zone` + `rules`/`silk`），跑 `check` 零诊断。含两个真实约束，已补进实现与规范：**同一段可以重复出现**（该文件把 `trace` 分了两段，行按出现顺序拼接）、**段头独占一行**。

**注意**：`via` 既是段名又是 `rules` 的行首列，语法上靠"段头独占一行"消歧（已写进 `spec/pcb.md` §1）。加新段名时要检查是否与规则类型/物理实体类型重名。

## F22. `symbol` / `footprint` 的 IR 分片不记录语言版本

**现状**：语言版本方案已定（`MAJOR.MINOR[.PATCH]`，`1.0` 是里程碑，决策见 [ADR-0101](adr/language/0101-one-language-version-number.md)），版本判定集中在 `packages/parser/src/version.ts`。但 IR 分片之间不一致：`schematic` / `pcb` / `schematic-view` / `project` / `component` / `system` 六个分片带 `format`（以及 `common` 定义的 `format_version`），**`symbol` 与 `footprint` 两个分片一个版本字段都没有**——它们只带 `ir_version`（IR 契约自己的版本，与语言版本无关）。

**为什么要补**：分片自描述是第三方实现的入口条件（[ADR-0137](adr/process/0137-implementation-stack-and-agent-entry.md)）。读到一个 `symbol` 分片的人无法知道它是用哪个语言版本产的，也就无法判断"这个分片里的东西在当前语言版本下是否还成立"。现在影响很小（`symbol` / `footprint` 自 `0.5` / `0.4` 起没有新构造），但分片之间不一致本身是个坑。

**要做的事**：

1. 给 `schemas/ir/v0.3/symbol.schema.json` 与 `footprint.schema.json` 加 `format`（或引用 `common` 的 `format_version`），与其它分片对齐——**先定用哪个名字**，别一个用 `format` 一个用 `format_version`。
2. 解析器写入规范化的版本号（补丁位为 0 时省略，`0.6` 与 `0.6.0` 存成同一个字符串）。
3. 这是 **IR 契约变更**：`ir_version` 要不要跟着动（当前 `0.1`）按 [ADR-0105](adr/ir/0105-ir-shards-and-hashes.md) 的分片约定决定，别顺手改。
4. 补 `tests/schemas/` 的正反例与 `bun run gen` 生成的类型。

**注意**：不要在没有 ADR 的情况下把语言版本和 `ir_version` 绑在一起——两者回答的是不同问题（"这份描述能用什么构造" vs "这个分片的形状我还认不认"）。

## F23. "从零到板"的 skill：一步一步建一个 TextEDA 工程

**现状**：零件齐了，**路径没连起来**。仓库里有走完前半程要用的每一样东西，但没有一条被验证过的、从空目录走到成品的路径。

- `texteda init <dir>` 只给骨架（`project.toml` + `assets/components/` `design/sch/` `design/pcb/` `design/system/` `docs/`），**不含任何器件、符号、封装或原理图**。
- 库的写法分散在三处：`docs/guides/symbol-authoring.md`（符号）、`docs/guides/footprint-authoring.md`（封装）、`teda.md` §6（器件）。**没有一份"一个工程该有哪些文件、它们怎么互相引用"的总账**。
- 命令有四条（`init` / `compile` / `check` / `netlist`），但**没有一条把它们串起来的脚本**；用法只能从源码里读。CLI 也**没有 `export` 子命令**——KiCad 符号/封装导出只能走仓库脚本（`bun run export:symbol` / `export:footprint`），而且它们吃的是**IR JSON 不是 `.teda`**：`compile:symbol` / `compile:footprint` 先出 JSON，`export:symbol` 再拿 JSON **加 `--component <器件文件>`** 合并引脚事实（引脚的电学事实归 `component`，符号只写视图，[ADR-0130](adr/libraries/0130-symbol-format.md)）。这条两步链没人写在文档里，是最容易踩的地方。
- **终点缺两块**：`.kicad_pcb` 板文件导出器**不在仓库里**（`docs/trial-run/charger-buck/` 那份是**一次性原型**生成的，README 明写"未进仓库"）；Gerber / Excellon 写出器也没有（F15）。
- 所以今天能走通的最远终点是：`init → 库 → 器件 → sch → check → 网表 / .kicad_sym / .kicad_mod`。**skill 不能假装能走到 Gerber**。（这条链已手工试跑通过：`init` → 两个无源件 → 三实例的最小板根 → `check` 零 error 零 warning → `compile` 出 IR → `netlist` 出连通性投影 → `compile:symbol` + `export:symbol` 出 `.kicad_sym`。）

**要做的事**：

1. 写 `docs/skills/new-project.md`：**给 agent 的操作手册**（**英文**——skill 是 agent 读的操作手册，不是设计文档，见 AGENTS.md §12 的语言例外）。每一步 = 一条命令 + 预期输出 + **失败时怎么办**（指到诊断码与修复动作，不写"照着做"）。步骤：`init` → 建符号/封装/器件 → 写板文件与打印页 → `texteda check` → `texteda compile` → 导出网表与 KiCad 库。**每条命令都必须真的能跑**（由第 2 条逐条验证）。
2. 写 `scripts/skill-new-project.ts`：把上面那串步骤做成**可执行、可断言**的脚本——在临时目录里从零建一个最小工程（一条电源轨 + 一路分压 + 一颗去耦），跑 `check`（必须**零 error**）、导出网表与符号/封装，并断言：产物存在、**同输入逐字节相同**（`init` 的确定性契约要一路守到终点）。这是 skill 的**可执行形态**：文档会烂，脚本不会。
3. 给它 `bun run skill:new-project`，并**接进门禁**（`bun test` 的一个 case，或并进 `scripts/verify-libs.ts` 那一串）。**不接进门禁的 skill 等于没有**。
4. 终点分两段接：**先到 `.kicad_pcb`**（依赖第 5 条的板文件导出器），**再到 Gerber / Excellon**（F15）。skill 每一步都要标出"这一步依赖什么"；依赖没到的步骤就写到"到此为止"，**不要写仓库里并不存在的命令**（"然后在 KiCad 里导出 Gerber"这种是给 KiCad 用户的，不是给本仓库的）。
5. **板文件导出器单独立项**（`pcb` IR → `.kicad_pcb`）：把 `docs/trial-run/charger-buck/` 那个一次性原型收进 `packages/exporter`（确定性：uuid 由内容派生），一并生成 `.kicad_pro` 与 `fp-lib-table`（设计规则在工程文件里，不在板文件里——见 `docs/trial-run/charger-buck/README.md` 的实测结论）。**这一步不做，skill 的终点就只能停在网表**。

**注意**：

- skill **不定义语言、不改 schema**，只描述"按现有契约怎么把一个工程建起来"。所以它必须**跟着语言版本走**：语言加了新段、新描述类型，skill 的模板要跟着改（版本方案见 [ADR-0101](adr/language/0101-one-language-version-number.md)）。
- skill 相对"教程"的唯一增量是**出错时怎么办**——教程给顺序，skill 给诊断码与修复动作（"错误信息是产品"，AGENTS.md §12）。每一步都要能回答"这一步失败了，看哪个码、改哪里"。
- **别把 skill 写成"复制参考工程改改"**：那会让人绕过 `init` 契约与自建库的边界（[ADR-0129](adr/libraries/0129-footprint-format-and-geometry.md) 的 `project:` 库约定），也绕过了"每个文件最小化"的写作纪律。
- 这条 skill 是 F12 十用例语料的**种子**：先把"最小可跑工程"这条路径钉死并做成脚本，再扩到 BGA、多电源域、差分对那些难例。

## F24. IR 分片树剩下的三种分片（`project` / `component` / `system`）（**已完成**）

**现状**：`bun run texteda ir <工程目录>` 已经写出整棵分片树——`boards/<board_id>/{schematic,pcb}.json`、`boards/<board_id>/view/<page_id>.json`、`assets/symbols/<lib>/<id>.json`、`assets/footprints/<lib>/<id>.json`，外加 `manifest.json`（每片 sha256 + 工程哈希），布局与哈希规则见 [ADR-0105](adr/ir/0105-ir-shards-and-hashes.md) D3、D8、D9。[ADR-0105](adr/ir/0105-ir-shards-and-hashes.md) D2 里定的另外三种分片，**现在还差一种**（`project` 与 `system` 已落地，见 F17）：

- ~~`project.json`——`project.toml` 的 IR 投影~~ **已落地**（F17）：字段对字段（`name`/`version`/`format`/`description`/`license`/`status`/`default_variant`/`authors`/`links`/`boards`/`variants`/`libs`/`compliance`/`ext`），规范类分片，进工程哈希。
- ~~`assets/components/<component_id>.json`——器件描述的 IR 分片~~ **已落地**（2026-10-23）：`parseComponent` 现在把 `ComponentFile` 投影成 `component` 分片（`pins_source: "inline"`，解析器的行号/列号与 `alt` 单元格不进契约），`texteda ir` 为每个器件文件写一片，规范类、进工程哈希。**它需要 IR 升到 `0.8`**：器件文件的 `description` 标量此前既不在规范里也不在契约里，产物一写就会静默丢掉这个事实，决策见 [ADR-0106](adr/ir/0106-device-description-enters-the-ir.md)。头行 id 与文件名不一致的文件不产分片（`ref.component-id-mismatch`）。
- ~~`systems/<system_id>.json`——多板连接描述的 IR 分片~~ **已落地**（F17）：`system` 描述（`design/system/<system_id>.teda`，段 `boards` + `nets`，成员是 `<board_id>.<port_id>`）→ `system` IR，规范类分片，进工程哈希。

**要做的事**：

1. ~~`project.toml` 解析器 → `project.json` 分片~~ **已落地**（F17；诊断码 `syntax.*` / `ref.unknown-project` 已登记进 `packages/ir/src/diagnostics/codes.ts`）。
2. ~~`component` 描述的 IR 投影 → `assets/components/<component_id>.json` 分片（引脚的电学事实仍归 `component`，符号/封装只存视图，[ADR-0130](adr/libraries/0130-symbol-format.md)）~~ **已落地**（2026-10-23）。
3. ~~`system` 描述的语法与解析器 → `systems/<system_id>.json` 分片~~ **已落地**（F17）。
4. 三种分片进 `manifest.json` 后，**工程哈希的含义会变**——哈希覆盖的分片集合变了，旧哈希与新哈希不可比。这不是 bug，但**要写进迁移说明**（`AGENTS.md` §2 不变量 10 要求破坏性变更附迁移说明）。
5. 每种新分片都要补 `tests/schemas/` 正反例，并过 `bun run gen:check`。

**注意**：

- **不要为了"树看起来完整"而写空分片**：没有生产者的类型不能出现空目录或空分片（[ADR-0105](adr/ir/0105-ir-shards-and-hashes.md) decision 3）。
- 分片路径与源码目录一一对应（`assets/components/<component_id>.json` ↔ `assets/components/**/<component_id>.teda`，`systems/<system_id>.json` ↔ `design/system/<system_id>.teda`），不要另发明映射表。
- 这条不是"补三个文件"，是"补三种描述的解析器"——工作量在解析器，不在写 JSON。

---

## F25. 器件拆成 part / generic，器件资产归到 `assets/`（ADR-0123 / ADR-0123 的落地）

**现状**：**语言与实现已落地**（2026-10-22；2026-10-23 按 [ADR-0123](adr/devices/0123-the-device-kind-is-part-or-generic.md) D6 改名并合目录）——`component` 有必填 `kind`（`part` / `generic`）、通用器件专有的 `construction` / `polarized`，`part` 禁 `params`、通用器件必带必填 `value`；`packages/parser` 有真正的 `component` 解析器（`packages/parser/src/component.ts`）；**件与通用器件同在 `assets/components/` 一个目录**，`kind` 只写在文件里、不从目录推断；参考工程是 16 个件与 6 个通用器件。**本项目尚无外部使用者，没有需要迁移的旧文件，所以不写迁移脚本**——改法写在 `spec/teda.md` §13.4。决策见 [ADR-0123](adr/devices/0123-the-device-kind-is-part-or-generic.md) D1 与 [ADR-0123](adr/devices/0123-the-device-kind-is-part-or-generic.md) D7。

**未落地**：`lib:id` 限定名与库解析顺序、变体对通用器件的作用域、库的信任模型（F26）。**采购描述类型已落地**（F35：解析器、`fmt`、IR 契约 v0.6 的 `procurement` 分片）。

**要做的事**：

1. **语言层（已落地）**：`component` 增加必填 `kind`（`part` / `generic`）；`part` 要求 `mpn`、`generic` 禁止 `mpn` 且 `params` 至少有一列参与身份（`value`）；新增 `construction`（开放词表）与 `polarized`（`yes`/`no`）两个标量字段；`spec/teda.md` §6 改写（`spec/teda.md` §6.1.1 两种器件、`spec/teda.md` §6.2 `params`、`spec/teda.md` §10.1 新增 `polarized` 电气类型）。**版本走的是 `component` 自己的版本线 `0.1` → `0.1.1` → `0.1.2` → `0.1.3`**（每种描述类型一条线，0.x 阶段只走 PATCH 位，见 [ADR-0101](adr/language/0101-one-language-version-number.md) D5）——这是合并前（2026-10-23）的记法：类型版本线已随 2026-10-27 的合并退役，合并后是**语言版本**（见 [ADR-0101](adr/language/0101-one-language-version-number.md) D2）。
   - **引脚表是身份分界**（[ADR-0123](adr/devices/0123-the-device-kind-is-part-or-generic.md) decision 3）：引脚表变了就是另一个器件；只有不改引脚表、不改引脚行为的属性才允许进 `params`（value / tolerance / 耐压 / ESR / 温度档）。`package` 与 `footprint` 是 part / generic 的固定属性，**不是** `params`。
   - **一封装一 part**（decision 4）：同一 die 的多个封装 = 多个 part 文件，各自写**完整**引脚表；不做引脚表合成、不做多封装 part。
2. **目录迁移（已落地）**：`assets/components/passives/c-0402.teda` → `cap-mlcc-0402.teda`（通用器件 id 不带值、带构造）、`c-220u.teda` → `cap-tantalum-7343.teda`（`construction tantalum` + `polarized yes`）、`r-0402.teda` → `res-thick-0402.teda`；有真 MPN 的（`xtal-8mhz-3225`、`l-6r8` → `ihlp2525czer6r8m01` 等）留在 `assets/components/*` 并标 `kind: part`；`assets/symbols/`、`assets/footprints/` 归到 `assets/` 下（**库目录仍带库名**：`assets/symbols/project/`、`assets/footprints/project/`，见 `spec/teda.md` §2 的 `<lib>/` 布局）；`project.toml` 的 `[libs.project]` 还在，`libref` 替代它属 F29 的**未落地**部分。**2026-10-23**：通用器件不再单独放 `assets/families/`，与件同在 `assets/components/**`（按类别进子目录），`kind` 只写在文件里（[ADR-0123](adr/devices/0123-the-device-kind-is-part-or-generic.md)）。
3. **迁移脚本：不做**（2026-10-23 定）——本项目尚无外部使用者，没有需要迁移的旧文件；改法写在 `spec/teda.md` §13.4（加 `kind`、`family` 改名 `generic`、把通用器件挪进 `assets/components/`、版本提到 `0.1.3`）。**通用器件 id 的改名与 `construction` / `polarized` 的取值由作者决定**，工具不替人填。
4. **命名空间**：`instances` 行支持 `lib:id` 限定名（库内件必须限定，项目件可裸写）；解析顺序：项目 `assets/components/` → 库。
5. **variant 作用域**：`packages/core` 的 ERC 里，变体按 `component_id` 生效只对 `kind: part` 成立；通用器件只能按实例作用域（DNP/替代料指到具体实例）。
6. **`params` 语义校验（部分落地）**：`part` 禁 `params`、通用器件必带必填 `value`、`package` / `footprint` 不得作参数列、必填列在前——都已在解析器里查（诊断码 `value.component-identity-invalid` / `value.component-param-reserved` / `value.component-param-order`）。**未落地**："改引脚表/改引脚行为"这层语义靠人工判定（编译器查不了），仍靠约定 + 库级检查。
7. **`procurement/` 描述类型**：新描述类型（通用器件+规格 → 料），带 parser 与 fmt；BOM 行键统一为 `(component_id, 参数字典)`（part 的参数为空）。**格式已定**（[ADR-0128](adr/devices/0128-the-procurement-layer.md) 已 Accepted，语法见 `spec/procurement.md`），**实现见 F35**。
   - **主料 / 备选分离**：主料在 `assets/procurement/primary/<board_id>.teda`（**规范分片**，进工程哈希与板哈希，决定 BOM 与制造包）；第二货源在 `assets/procurement/alternatives/<board_id>.teda`（**附注分片**，进 IR 但**不进工程哈希**，另聚合成 `advisory_hash`）——换备选不触发重建、不作废已评审的制造包。备选违反硬约束（封装不等、不是 part、无 `mpn`）报 **warning**，不阻断构建；主料违反则是 error；备选文件的**语法错**仍是 error（文件坏了）。
8. ~~**IR 契约（未落地）**~~ **已落地**（2026-10-23）：`schemas/ir/v0.3/component.schema.json` 加 `kind` / `construction` / `polarized`，契约版本到 **v0.3**（纯增量），`bun run gen` 重生成类型，`tests/schemas/` 补正反例。**与 F27 同批升**（契约一次升到 v0.3，别分两次）；F28 的双哈希（规范 / 附注分类 + `advisory_hash`）随后单独落地，契约随之到 v0.5。

**验收**：

- 参考工程 `bun run check` 通过、`bun run lib:verify` 全绿、`bun run fmt:teda --check .` 退出 0。
- 变体对通用器件的作用域有专门用例：通用器件级 DNP 报错，实例级 DNP 通过。
- 库件限定名与裸名解析各有用例；库内件不限定时报"必须限定"而不是"找不到"。

**注意**：

- **`component_id` 语义变了**（通用器件 id 不再带值），哈希与 BOM 口径都变 → 属于 [ADR-0101](adr/language/0101-one-language-version-number.md) 里的 MINOR 变更，要写迁移说明。
- `packages/ir` 的诊断码表要新增码（`域.slug` 形式），登记进 `packages/ir/src/diagnostics/codes.ts`，跑 `bun run gen` 更新 `docs/error-codes.md`。
- 别顺手把"库"塞进项目树：**外部库是模板**——`texteda lib import` 把器件拷进 `assets/` 后它就是自有资产、进 `dist/ir/`（规范分片），IR 必须自足，见 [ADR-0133](adr/libraries/0133-trust-in-a-library-you-do-not-own.md)。`external/libs/**` 不被读取，`[libs]` 表项也不存在。

---

## F26. 库的信任模型：provenance、免责条款、派生覆盖（ADR-0132 的落地）

**现状**：`bun run lib:verify` 校验项目自有资产（引用可解析、引脚号与焊盘号对齐、KiCad 可读、DRC 0 违规）。**`provenance` 已落地**（2026-10-24）：`component` 的 `provenance generated|reviewed` 进 IR 契约，`reviewed` 缺 `verified_by` / `verified_on` 报 `value.provenance-invalid`。**库级 trust record 已落地**（`library.toml`，`[[trust]]` 按 revision 列 id，导入时落成副本的 claim 与头注释，见 `docs/guides/library-import.md` §3）：审一次库 = 一份 record，不是几百个文件。 **消费者侧 trust 表已落地**（2026-10-24，[ADR-0133](adr/libraries/0133-trust-in-a-library-you-do-not-own.md) D8，`lib import --trust <file>`）：背书别人的库（上游/官方库不带我们的 manifest）写在消费方的一张表里，`library` + `by` / `on` + 三组 `id@rev` 条目（**无整库开关**，行按动作而非 revision 分）；两份记录各自覆盖不同条目时并存、同一 `(library, id, rev)` 不同归属 = error，来源头注释写明是哪一份（形状随 [ADR-0133](adr/libraries/0133-trust-in-a-library-you-do-not-own.md) D6 改，见 F46）。表不进工程树、不进构建，`provenance reviewed` 照常进工程哈希。**派生覆盖与 vendoring 已撤销**（[ADR-0133](adr/libraries/0133-trust-in-a-library-you-do-not-own.md) D2）：副本就是自有件。**剩下**：库清单 `lib.toml`（我们自己发布库时才需要）、严格模式。

**要做的事**：

1. **`provenance` 字段**：`component` 增加 `provenance`（`generated` / `reviewed`），未声明按 `generated` 处理；`reviewed` 必须带 `verified_by` / `verified_on`；`kind: part` 且 `provenance: generated` 时 `datasheet` 必填。
2. **库清单 `lib.toml`**：`name` / `version` / `generated` / `reviewed` / `disclaimer`；库发布时清单必填。
3. **派生覆盖**：`component` 增加 `overrides`（指向被覆盖的 `lib:id`）；派生的 `component` / `generic` 必须是**完整**的一份（不是 patch），且要声明自己的 `provenance`。
4. **严格模式**：`texteda check --strict-provenance`（或 `project.toml` 开关）下，引用 `generated` 的库件报错，诊断里给库名、件号与 datasheet 指针。
5. **`lib:verify` 能跑外部库**：对库目录跑同一套三方对齐（symbol 引脚号 == footprint 焊盘号 == component 引脚号）与 canonical 检查。
6. ~~**库 vendoring 与哈希校验**~~ **撤销**（2026-10-24，[ADR-0133](adr/libraries/0133-trust-in-a-library-you-do-not-own.md)）：没有锚点、没有内容哈希、没有 vendored 树。**已落地**的是 `texteda lib import <name> --from <dir> --rev <tag>`：拷贝器件与它们引用的几何进 `assets/`、重写为裸 id、加来源头注释、标 `provenance generated`；**编译期不联网**。

**验收**：

- 一个引用 `generated` 库件的项目在严格模式下报错、在普通模式下通过，诊断文案含库名与 datasheet 链接。
- ~~派生覆盖后：库内容哈希不变；项目内该件的事实等于派生文件；`lib:verify` 仍全绿。~~ **已撤销**（[ADR-0133](adr/libraries/0133-trust-in-a-library-you-do-not-own.md) D4）：没有库内件与派生件之分，导入的副本就是唯一的件，改它等于改设计。
- ~~`content_hash` 被改动时 CLI 明确报错~~ **已撤销**：没有哈希可改。

**注意**：

- 免责条款是**库自己发布的**内容（`lib.toml`），不要让 CLI 替库作者生成法律文本；CLI 只校验字段在位。
- 派生覆盖是"复制 + 声明关系"，不要做成字段级 patch（合并结果不是任何文件写下的内容，读者要自己算合并才知道真相）。
- 库的注册表与分发格式仍未定（见 F10），本条只做"引用一个已在本地的库"这一段。

---

## F27. `package` 字段删除、3D 模型改挂 part（ADR-0127 的落地）

**现状**：**第 1、2 条已落地**（2026-10-23）：`component` 不再写 `package`（读到即报错 `syntax.removed-construct`），封装代号由 land pattern 自己写（`package_code`，`lib:verify` 要求每个封装都写）；契约随这批从 v0.2 升到 **v0.3**（`schemas/ir/v0.3/`），语言的 `component` 线 `0.1.1` → `0.1.2`、`footprint` 线 `0.4` → `0.4.1`，改法写在 `spec/teda.md` §13.4（本项目没有需要迁移的旧文件，不写迁移脚本）。**第 3-8 条未落地**：3D 模型仍按 `model` 行挂在 **footprint** 文件上（[ADR-0129](adr/libraries/0129-footprint-format-and-geometry.md)）。决策见 [ADR-0127](adr/devices/0127-package-code-and-3d-models.md)。

**要做的事**：

1. ~~**`component` 去掉 `package` 字段**~~ **已落地**：`spec/teda.md` §6.1 改写；`packages/parser/src/component.ts` 读到该字段即报错（`syntax.removed-construct`，字段已不存在，不要静默忽略）；`schemas/ir/v0.3/component.schema.json` 去掉 `package`、加上 `kind` / `construction` / `polarized`（契约 v0.2 → v0.3）。
2. ~~**`footprint` 增加 `package_code`**~~ **已落地**：`spec/footprint.md` §2 与 `packages/parser/src/footprint.ts`；`schemas/ir/v0.3/footprint.schema.json` 加字段。封装代号（`0402` / `SOT-23-5` / `LQFP-100`）落在 land pattern 文件里，footprint id 通常已经带它；`lib:verify` 要求每个封装都写明自己的代号。
3. **3D 模型改挂 part**：`component` 增加可选 `model <相对路径>`；`footprint` 解析器**拒绝** `model` 行（迁移脚本负责搬）；**footprint 的 IR 分片与 schema 去掉 `model3d`**（`schemas/ir/v0.3/footprint.schema.json` 现在还有它），`packages/exporter` 也不再往 `.kicad_mod` 写 `(model ...)`。`spec/footprint.md` §2 标量表里的 `model` 行要删（`packages/parser/src/footprint.ts` 的 `SCALAR_KEYS` 仍在收它）。
4. **3D 模型文件的存放位置**：放在提供该 part 的树里（项目或库），例如 `3dmodels/<id>.step`，（[ADR-0129](adr/libraries/0129-footprint-format-and-geometry.md) decision 11；`content_hash` 已随 [ADR-0133](adr/libraries/0133-trust-in-a-library-you-do-not-own.md) 撤销）。
5. **导出的 footprint 是纯 2D，没有变体**（[ADR-0127](adr/devices/0127-package-code-and-3d-models.md) D4 已定）：KiCad 输出是给**板厂**的派生产物，最多给人 review，不当工作环境——KiCad 自己的 footprint 也不绑 part。所以导出的 `.kicad_mod` **不带 3D 模型**，一个 land pattern 一个文件，**没有封装变体**，导出器重新变成 footprint IR 的**纯函数**（`export footprint --part` 不做）。3D 身体留在 part / generic 文件里，用在有 part 上下文的地方：我们自己的 3D 预览与装配层、板级导出（每个实例可带自己的模型路径）。可选：land pattern 可附一个**封装外形**（包络，按 land pattern 唯一，也不产生变体）。
6. **KiCad 输出里不再有 3D 身体**：今天 `.kicad_mod` 带 `(model ...)`（来自 footprint 的 `model3d`），去掉后 KiCad 里只看得到 2D。
   补法有两条：**封装外形**（land pattern 可选地附一个封装标准外形——IPC/JEDEC 的通用件——按 land pattern 唯一、**不产生变体**，但那是外形不是厂商件，要标出来），或**板级导出时按实例写模型**（`packages/exporter` 目前只出 `.kicad_mod` / `.kicad_sym`，**没有板导出**，所以这条要等 F16 / F21）。**已定：做封装外形**（[ADR-0127](adr/devices/0127-package-code-and-3d-models.md) D3）——见下面第 8 条。
7. **封装外形（envelope）**：`footprint` 增加可选 `envelope <path>`（封装标准外形，IPC/JEDEC 通用件，不是厂商件）；导出时写进 `.kicad_mod`（`packages/exporter` 的 `modelSexp` 那条路改成写 envelope）。**一个 land pattern 一个 envelope → 不产生变体**，导出器仍是纯函数。允许的条件：身体由封装决定（MLCC、贴片无源、标准封装的集成电路）；钽电解薄膜电容、模压屏蔽电感、连接器、带引线框架的分立件**不允许**（身体随额定值变）。检查在 `lib:verify`：用了带 envelope 的 land pattern 的 part，其 `construction` 属于身体随额定值变的那一组 → 报错。
8. **不做装配约束**：语言里不加 `body_height` / `body_size` 等机械尺寸，也不做限高检查（限高要配合外壳，外壳不在项目里）。这条要写进 `docs/guides/footprint-authoring.md`，避免以后有人"顺手加个高度字段"。

**验收**：

- 迁移后参考工程 `bun run check` / `bun run lib:verify` / `bun run fmt:teda --check .` 全绿。
- 同一 land pattern 上的两个不同厂商器件（可用钽电容 / 电解电容构造）各自持有自己的 `model`，互不覆盖。
- 给 `footprint` 文件加 `model` 行 → 解析器报错并指向 ADR-0127。
- 给 `component` 留 `package` 行 → 解析器报错。

**注意**：

- **这是 ADR-0129 的修订**（3D 归属），但 ADR-0129 decision 1（语言里没有尺寸字段）**不变**——本次不引入任何尺寸字段。
- ~~契约从 v0.2 升到 v0.3 是同一批（`kind` / `construction` / `polarized` / 去 `package` / 加 `package_code`），别分两次升。~~ **已按这一批升完**（2026-10-23，`schemas/ir/v0.3/`）。
- **别把 model 挂回 footprint**：导出器保持 footprint IR 的**纯函数**（2026-10-22 附录改了 decision 3 的方向——原来"导出器需要 part 上下文"这条已被推翻，因为 KiCad 输出只给板厂与评审，`.kicad_mod` 是纯 2D land pattern）。
- 身体信息仍然是 part / generic 的事实，只是**不写进 KiCad 库文件**；写它进 KiCad 的动机只能是"想给 KiCad 用户看形体"，那用**封装外形**，不用厂商件。

---

## F28. 分片的规范 / 附注之分与双哈希（ADR-0105 修订 + ADR-0128 的落地）

**状态**：**已落地**（2026-10-23）。manifest 逐片记 `sha256` 与 `normative`（分类是文件级属性，工具不靠路径猜）；工程哈希 = **规范**分片按路径排序后 `<path>:<sha256>\n` 拼接的 `sha256`；`advisory_hash` = 附注分片的同样聚合；板哈希 = 该板**规范**分片的同样聚合。**打印页分片已经是附注类**（[ADR-0134](adr/view/0134-the-view-layer-is-a-drawing.md) decision 5）：挪一个标签，工程哈希与板哈希不变，只有 `advisory_hash` 变。IR 契约随之到 `v0.5`（`manifest` 分片多了 `normative` 与 `advisory_hash`）。决策见 [ADR-0105](adr/ir/0105-ir-shards-and-hashes.md) D8、D9 与 [ADR-0128](adr/devices/0128-the-procurement-layer.md) decision 13。

**原来的现状**：`dist/ir/` 的 manifest 逐片记 `sha256`，工程哈希 = **全部**分片按路径排序后 `<path>:<sha256>\n` 拼接的 `sha256`；没有"规范 / 附注"的概念，也没有第二个哈希。

**要做的事**：

1. **分片分类**：manifest 的 `shards` 每项加 `normative: true | false`。分类是**文件级**属性（一个源文件 → 一个分片 → 一个分类，[ADR-0105](adr/ir/0105-ir-shards-and-hashes.md) decision 2），所以采购层拆成两个目录：`assets/procurement/primary/<board_id>.teda`（规范）与 `assets/procurement/alternatives/<board_id>.teda`（附注）。
2. **双哈希**：工程哈希 = 规范分片聚合；新增 `advisory_hash` = 附注分片聚合（同算法、同形状）。板哈希不变（板分片恒为规范）。
3. **manifest schema**：`schemas/ir/v0.3/manifest.schema.json` 加 `normative` 与 `advisory_hash`（契约 v0.2 → v0.3，与 F25 / F27 同批升）。
4. **`texteda ir --json` 载荷**加 `advisory_hash`；人读摘要要能一眼看出"构建身份"与"采购状态"两个不同的数。
5. **盖章规则**：Gerber / 网表 / BOM 主料行盖 `project_hash`；采购附注盖 `advisory_hash`（`AGENTS.md` §2 不变量 11 的追溯口径要按产物类型分）。
6. **陈旧检查**：`texteda check` 比对当前 `advisory_hash` 与采购附注里盖的那个 → 不一致报 warning（"采购附注已过期"）。
7. **文档**：把"哈希标识构建、不标识工程文件集合"写进 `AGENTS.md` §2 不变量 18 与 `AGENTS.md` §9、§10 的哈希口径；`docs/skills/new-project.md` 若提到哈希，同步。

**验收**：

- 只改 `assets/procurement/alternatives/*.teda` → `advisory_hash` 变、`project_hash` **不变**，Gerber / 网表字节不变。
- 改 `assets/procurement/primary/*.teda` → `project_hash` 变。
- manifest 里每片都有 `normative`，且两类分片的聚合互不串。
- 同一工程两次编译仍逐字节相同（含附注分片）。

**注意**：

- **哈希口径变了**：旧工程哈希与新工程哈希不可比（集合不同了），这是 [ADR-0101](adr/language/0101-one-language-version-number.md) 意义上的口径变更，要写迁移说明。
- 别把"附注"当成垃圾桶：凡是**构建产物依赖**的内容必须是规范分片。判据：改它会不会让已签发的制造包作废？会 → 规范；不会 → 附注。
- 附注分片仍然要写盘、仍然要校验（备选里的 part 停产、封装漂移会被发现），只是不进工程哈希。

---

## F29. 目录按归属分组：`assets/` `external/` `design/`（ADR-0107 的落地）

**现状**：**树的机械重排已落地**（2026-10-22）——目录按归属分组（`assets/` `external/` `design/` `views/`），参考工程、CLI 路径、`texteda init` 骨架与文档同步改完；`bun run check` / `lib:verify` / `fmt --check` 全绿。**采购层已落地**（F35）。**库的 vendoring 已撤销**（2026-10-24，[ADR-0133](adr/libraries/0133-trust-in-a-library-you-do-not-own.md)）：工程不再有外部依赖层，`external/libs/**` 不再被读取，外部库是**模板**——`texteda lib import <name> --from <dir> --rev <tag>` 把器件连同它引用的 symbol / footprint 拷进 `assets/`、重写成裸 id、加来源头注释、标 `provenance generated`。`libref` 锚点、内容哈希校验、`lib:id` 限定名、库资产分片一起删除。**要做到"只挪目录不改工程哈希"仍缺内容哈希**（见第 4 条）。

**要做的事**：

1. **树的重排**（机械部分）：`assets/symbols/` `assets/footprints/` `assets/components/` → `assets/**`；`procurement/` → `assets/procurement/`；`design/sch/` `design/pcb/` `design/modules/` `design/system/` → `design/**`；`views/<board_id>/<page>.view.teda` → `views/<board_id>/<page>.view.teda`（见 F30）；新增 `external/simulation/`（`cache/` 不建，由使用者自建且 gitignore；`external/libs/` 后来也不建了——库是模板，见 [ADR-0133](adr/libraries/0133-trust-in-a-library-you-do-not-own.md)）。参考工程与 CLI 里的路径同步改。（**2026-10-23**：件与通用器件合并到 `assets/components/**` 一个目录，不再有 `families/`——见 [ADR-0123](adr/devices/0123-the-device-kind-is-part-or-generic.md)。）
2. ~~**`libref` 描述类型**~~ **已撤销**（2026-10-24，[ADR-0133](adr/libraries/0133-trust-in-a-library-you-do-not-own.md)）：锚点是"钉住一棵只读的树"，而我们真正要的只是"这些器件现在是我们的"。取而代之是 `texteda lib import`：拷贝 + 限定符重写 + 来源头注释 + `provenance generated`，副本可编辑，没有哈希盯着它。`spec/libref.md`、`libref` schema、parser、`lib add` 全部删除；`external/libs/` 下有库形状的树报 `ref.library-in-tree`。
3. ~~**库 vendoring**~~ **已撤销**（同上）：编译期永不联网这一条保留（不变量 20），但"vendored 树 + 内容哈希"这一层没有了——副本是自有资产，`assets/**` 之外没有第二个器件来源。`--from <url>` 不做（门禁不联网）。
4. **分片布局与源码树解耦**：分片按种类固定（`boards/` `assets/symbols/` `assets/footprints/` `assets/components/` `procurement/`），映射由每片的 `source.file` 承担（[ADR-0105](adr/ir/0105-ir-shards-and-hashes.md) decision 3 修订）；挪源码目录不改分片路径、不改工程哈希。
5. **`texteda init`** 建新骨架：`assets/{symbols,footprints,components}`、`assets/procurement/{primary,alternatives}`、`external/simulation`、`design/{sch,pcb,modules,system}`、`views/`、`docs/`。
6. **迁移脚本**：不做——本项目尚无外部使用者，没有需要迁移的旧文件；F28 的目录变更直接改文件，改法写进 `spec/teda.md` §13.4，不替人命名、不替人决定库版本。
7. **`external/cache/` 纪律**：厂商数据手册 PDF 放这里，gitignore；`check:public` 要能发现误提交的 PDF（今天查的是历史与工作区，新增这条要确认覆盖到新路径）。

**验收**：

- 迁移后参考工程 `bun run check` / `bun run lib:verify` / `bun run fmt:teda --check .` 全绿，且 `texteda ir` 的工程哈希与迁移前**按分片口径**一致（分片路径变了但内容没变——这正是解耦的验收点）。
- ~~一个引用了 vendored 库的项目~~ **改为**：一个从外部库导入器件的项目（`packages/cli/test/lib-import.test.ts`）：`lib import` 只拷选中的器件与它们引用的几何、副本写成裸 id、来源在头注释里；`--only` 的选择不对引用闭合时报错；撞 id 拒绝覆盖；`external/libs/` 下留一棵库树 → `ref.library-in-tree`（error），且没有任何器件从那里解析；限定 id → `ref.library-qualified-id`。
- 只把某个源文件在树里挪个目录 → 分片路径**不变**；工程哈希**也要不变**——这要求每片另带一个**内容哈希**（去掉 `source` 引用后的字节），工程哈希聚合它而不是落盘字节。**未落地**（随契约 v0.3 批次一起做，见 F28 的 manifest 改版）。

**注意**：

- **树冻结**：这次改完目录形状就不再动；要改形状得再开 ADR + 再写迁移脚本（[ADR-0107](adr/project/0107-project-tree-has-owners.md) decision 11）。
- **外部材料分三类，机制不同**：外部库是**模板**（拷进 `assets/` 即自有，`external/libs/` 不被读取）；数据手册只留引用（`datasheet` 字段）+ 本体在 cache，不进 IR；仿真模型 vendored 但机制未定（ADR-0107 开放点）——别给它们发明同一套声明格式。
- 别把 `external/` 当成"第二个 assets/"：它按**归属**分，不按**种类**分。

---

## F30. 打印页移到 `views/`，分片改为附注类（ADR-0134 的落地）

**现状**：**搬家已落地**（2026-10-22）——打印页文件在 `views/<board_id>/<page_id>.view.teda`（独立根目录，不再与板文件同目录），参考工程与 CLI 的扫描路径已改。**未落地**：分片分类（打印页分片仍是规范类，随板哈希走——挪一个标签就改板哈希与工程哈希）、盖章、交叉校验、文档同步。决策见 [ADR-0134](adr/view/0134-the-view-layer-is-a-drawing.md)。

**要做的事**：

1. **搬家**：**已落地**——打印页从板文件同目录（`design/sch/<board_id>/`）挪到**独立根目录** `views/<board_id>/<page_id>.view.teda`；参考工程与 CLI 的扫描路径已同步。分片路径 `dist/ir/boards/<board_id>/view/<page_id>.json` **不变**（分片布局与源码树解耦）。
2. **分类**：打印页分片改为 **advisory**（不进工程哈希、不进板哈希）；`advisory_hash` 同时聚合采购备选与打印页。判据不变：改了会不会让已签发的制造包作废。**已落地**（2026-10-23，随 [ADR-0105](adr/ir/0105-ir-shards-and-hashes.md) 的 2026-10-22 修订一起落，见 backlog F28）。
3. **盖章**：渲染出的页面盖**该页分片自己的 `sha256`** 作为 `source_hash`（不盖板哈希）；制造类产物仍盖板哈希 / 工程哈希。评审 UI 按板 id 把 `views/<board_id>/` 的原理图页与 `design/pcb/<board_id>.teda` 渲染出的 PCB 图对上，跳转在 UI 层解决，不靠目录。
4. **交叉校验**：页面引用的实例 / 引脚 / net 必须存在于板级，否则报错（归 `packages/core`）——与 F3 同批做。
5. **文档**：`spec/schematic-view.md` §9 与 `AGENTS.md` §3 的 S1 行改成"手写源文件 + 附注类分片"；`docs/skills/new-project.md` 若提到打印页路径，同步。

**验收**：

- 只挪动一个标签 → `project_hash` 与板哈希**不变**，`advisory_hash` 变。
- 挪动源码文件目录（`design/sch/<board>/` → `view/<board>/`）→ 分片路径与工程哈希**不变**。
- 页面引用一个板级不存在的实例 → 报错（不是静默通过）。

**注意**：

- **"可丢弃"的含义要改口径**：S1 可丢弃指的是**不参与构建身份**，不是"可重新生成"——渲染器只画不摆，页面文件生成不出来，所以它放在 `views/`（手写源、进仓库），不放 `dist/`（派生产物），也不放 `design/`（电路真源）。
- 打印页仍是**手写源**：它进仓库、进评审、可被人工挪动；只是不进构建身份。删掉整个 `views/` 不会让板子失效、不会改哈希、不会作废制造包。
- 别顺手把 view 目录塞回 `design/` 或 `design/sch/`：`design/` 只装电路描述，扫电路的工具不必学会跳过例外。

---

## F31. 语言版本号：从每类型一条线合并成一个语言版本号（ADR-0101 的落地）

**现状**：**已落地**（2026-10-27）。九条类型版本线合并成一个语言版本号（决策见 [ADR-0101](adr/language/0101-one-language-version-number.md)），当前号 **0.9.1**。`packages/parser/src/version.ts` 里 `SUPPORTED_LANGUAGE` 是唯一的上界；`TYPE_BIRTH` 表只留**下界**（类型诞生号：`schematic 0.1`、`module 0.8`、`procurement 0.9`、`view 0.7`、`pcb 0.7`、`footprint 0.4`、`symbol 0.5`、`system 0.2`、`component 0.1`），`typeRange(type)` 按下界取窗口。`0.x` 阶段只走 PATCH 位（`0.9.1` → `0.9.2`），抬 MINOR 要一份决策记录。

**合并前的形态**（历史，2026-10-23 至 2026-10-27）：每种描述类型一条自己的版本线，接受上界是**该类型**的当前号（`TYPE_LINES` 表）；决策见 [ADR-0101](adr/language/0101-one-language-version-number.md) D6。**合并只放宽接受范围**——今天能读的文件没有一份变成不能读。

**要做的事**：

1. ~~**接受规则按类型**：上界改成**该描述类型当前支持的版本**（不再是全语言版本）~~ **已落地**（2026-10-23），2026-10-27 合并成一个上界 + 按类型的下界（[ADR-0101](adr/language/0101-one-language-version-number.md) D4、D3）。
2. **`0.x` 阶段只走 PATCH 位**：加段、加字段不再抬 MINOR；`teda.md` §13.1 / §13.3 / §13.4 已改（见 [ADR-0101](adr/language/0101-one-language-version-number.md) D5）。
3. **收敛计划**：`1.0` 是**保留号**（语言表面冻结），不会由计数走到；触发条件：没有待做的表面变更 + 十个困难用例语料存在（F12）。合并本身不是冻结——十用例还差六个。
4. **文档**：下界表在 `teda.md` §13.1，由 `packages/parser/test/version-spec.test.ts` 与 `packages/parser/src/version.ts` 钉在一起；`AGENTS.md` 不复述版本号（ADR-0140 D1）。

**验收**：

- `view` 文件写 `version 0.10`（高于语言当前号）→ 报 `format.unsupported-version`（`the language is at version 0.9.1: 0.10 is newer`）。
- `symbol` 文件写 `version 0.4`（低于 symbol 的下界 0.5）→ 报 `format.unsupported-version`（`the symbol type was introduced in version 0.5: 0.4 is older`）。
- 同一工程里四种类型都写 `0.9.1` → `texteda check` 全绿。
- `teda.md` §13.1 的下界表与 `TYPE_BIRTH` 逐项一致（`bun test packages/parser`）。

**注意**：

- **安全依据是"未知构造默认报错"**（`AGENTS.md` §2 不变量 7）：`0.x` 阶段版本号不再精确标注"这个文件可能用了哪些新构造"，工具遇到不认识的构造会报错停下，不会误读。别因为"版本号不再细"就去实现"忽略不认识的段"——那是把兼容性的担子从诊断挪到了静默里。
- IR 的 `format` 仍存文件声明的版本（canonical 写法）；IR 契约版本 `ir_version` 依旧独立（[ADR-0105](adr/ir/0105-ir-shards-and-hashes.md) decision 2、[ADR-0101](adr/language/0101-one-language-version-number.md) D8）。

---

## F32. 派生覆盖改为"遮蔽"，通用器件可挂通用 3D 身体（ADR-0132 / ADR-0127 的落地）

**现状**：`component` 允许 `overrides` 指向库件；库与派生件同时存在于工程 IR 里（两个 id、两个来源）；通用器件不允许挂 3D 模型。决策见 [ADR-0132](adr/libraries/0132-libraries-are-unverified-facts.md) 与 [ADR-0127](adr/devices/0127-package-code-and-3d-models.md) D4，**未落地**。

**要做的事**：

1. **遮蔽语义**：派生件在**本工程内**替换被覆盖的库件；被遮蔽的库件不得再被任何 `instances` / `ports` / `constraint` 引用，引用即报错（"这个件已被工程的派生件遮蔽"）。库里的原件保持不变，供别的工程使用。
2. **派生件是 advisory**：校验报告里显式列出"工程与所依赖的库不一致之处"，不阻断构建，但必须看得见。
3. **几何不覆盖**：`component` 的 `overrides` 只能指向库里的 `component` / `generic`；指向 `symbol` / `footprint` 报错（共享几何的爆炸半径太大，改法是上游修 + 抬 pin）。
4. **通用身体 = land pattern 的 `envelope`**（[ADR-0127](adr/devices/0127-package-code-and-3d-models.md) D3，取代本条原先的"通用器件挂通用身体"）：`generic` **不**带 `model`；通用身体写在 land pattern 上（一个 land pattern 一个 → 无变体）。允许条件：身体由封装决定（`mlcc`、贴片无源、标准封装的集成电路）；`tantalum` / `electrolytic` / `film` / `molded` / `shielded` 那组不允许（身体随额定值变）——检查在 `lib:verify`（part 的 `construction` × land pattern 的 envelope）。`part` 自己的 `model`（厂商件）在有 part 上下文的地方（3D 预览、装配、板级导出）压过 envelope。
5. **通用身体要标明是通用身体**：3D 预览与装配输出标出"这是该通用器件的通用身体（附构造）"，不是厂商模型（ADR-0132 的诚实口径用在几何上）。

**验收**：

- 工程派生覆盖库里的 `tps5430ddar`，BOM 里只有一行；再有一处 `instances` 引用 `lib:tps5430ddar` → 报错（被遮蔽）。
- 派生覆盖出现在校验报告的 advisory 段里。
- `generic`（`construction = mlcc`）带 `model` → 接受；`generic`（`construction = tantalum`）带 `model` → 报错并指向 ADR-0127 D3。

**另外两条已定的边界（实现时别顺手加）**：

- **`die` 不进语言**（[ADR-0123](adr/devices/0123-the-device-kind-is-part-or-generic.md) D10）：part 文件里**不要**加 `die` 字段。die 是硅的事实，ERC / BOM / 布局 / 网表都不读它；它的用处只在生成器与库自身的封装一致性检查里，都在语言之外。工程级的"U1 与 U2 同一 die"写进 `docs/` 的装配说明，不进 IR。
- **view 要留**（[ADR-0134](adr/view/0134-the-view-layer-is-a-drawing.md) D4）：`view` 文件是人写的内容，**不得**被"按需生成"或重绘覆盖；板 ↔ 打印页不一致由交叉校验（F3）报出来，人来改。

**注意**：

- 遮蔽是**工程内**的语义，不改库：库里的那份对别的工程仍然有效，库的 `content_hash` 不变。
- 别把遮蔽做成"合并两个文件"——合并的结果不是任何文件写下的内容（ADR-0132 已否过 patch 式合并）。
- 通用身体的判定靠 `construction`，而 `construction` 是**开放词表**：工具只查它认识的几个，其余信任作者（未知词表给 warning，不阻断）。

---

## F33. 评审记录：Markdown 意见 + TOML 处置（ADR-0136 的落地）

**现状**：**已落地**（2026-10-23）。约定文档、处置文件、责任人字段与 `check` 的三条诊断都已落地：`packages/cli/src/reviews.ts`（读盘：`docs/reviews/*.md` 的 note 行与 `*.decision.toml`）、`packages/core` 的 `checkReviews`（规则）、`[project].owner`（`owner` 不进 IR——它是工程的属性，改它不改任何哈希，见 [ADR-0136](adr/view/0136-review-records-and-attribution.md) 2026-10-23 修订）。诊断码：`review.round-unclosed` / `review.owner-mismatch` / `review.owner-missing` / `review.decision-invalid`。参考工程的三个轮次现在报三条 unclosed（它们确实还没处置）。

**要做的事**：

1. **约定文档** `docs/guides/review-records.md`：目录 `docs/reviews/`（评审记录归 `docs/`，与设计意图、分析证据同处，[ADR-0107](adr/project/0107-project-tree-has-owners.md) decision 1）、一轮一个 `<round_id>.md`（意见）+ 一个 `<round_id>.decision.toml`（处置）、note 行的写法、两条检查的语义。**不进语言**：没有描述类型、没有 schema、没有 IR 分片、不影响任何哈希。
2. **处置文件**：TOML，字段 `target`（`board:<id>` / `page:<board>/<page>` / `component:<id>`）、`owner`、`date`、`verdict`（`accepted` / `declined` / `deferred`）。缺字段或取值非法 → 报错。
3. **责任人**：`project.toml` 的 `[project] owner`（创建者或接手人）。有评审记录但没写 owner → 报错。换人 = 改这个字段（不改任何哈希）。
4. **`check` 的两条诊断**：
   - **未闭环**：`docs/reviews/*.md` 没有对应的 `*.decision.toml` → warning，载荷带 target、作者、日期、意见原文。
   - **处置人不是责任人**：`decision.owner` ≠ `project.toml` 的 `owner` → warning（要么越权处置，要么换人没更新 `project.toml`）。
   两条都**不让 `check` 失败**、不改任何哈希（是否挡住制造出口是 ADR-0136 的开放点，归 F14）。
5. **意见是散文，工具不解析**：note 行只被人读；机器只读处置文件里的那几个事实。

**验收**：

- 放一个只有意见、没有处置的评审 → `texteda check` 报一条 warning（未闭环），含 target、作者、日期、意见；工程哈希不变。
- 补上处置文件（owner 与 `project.toml` 一致）→ warning 消失。
- `decision.owner` 写成别人 → 多一条"处置人不是责任人"warning。
- 有评审但 `project.toml` 没有 `owner` → 报错。
- 处置文件缺 `verdict` 或 verdict 取值非法 → 报错并指向 ADR-0136。

**注意**：

- **不签名**：评审记录的归属由版本控制给出，作者与责任人字段是给读者看的。签名只在**库分发**里可能有意义，最多库级、覆盖 `content_hash`，现在不做（ADR-0132 D10 / ADR-0136 决策 8）。
- 意见（notes）是散文，**不解析**每条意见挂在哪个实例 / net 上，也不做逐条处置——处置是**按轮次**给的（ADR-0136 的开放点）。
- `owner` 是人名，不要写团队名；"谁的意见、谁的决定"要能追到人。
- `project.toml` 的解析本身还没落地（**F17**），本项与 F17 一起做。
- **评审不进 IR**：因此 F28 的附注类分片只有采购备选一种，别把评审塞进 `advisory_hash`。

---

## F34. 评审 GUI（`packages/viewer`）：高亮指针、跳转源码、四种模式

**现状**：**四种模式全部落地（2026-10-29）**——`review` 与跳源码见 2026-10-24 / 2026-10-26 那两轮；`layout` / `placement` / `edit` 按 [ADR-0141](adr/view/0141-the-review-app-has-four-modes.md) 落地：`packages/renderer/src/pcb.ts` 出 PCB 画布（`kind: "pcb"`，板框坐标系 + 每个绘制对象的 `data-ref`），`packages/core/src/view/reroute.ts` 做 `place` 改动后的**重锚**（不改形状、不搜索），`packages/cli/src/layout.ts` 是唯一写 `views/**` 的地方（`planLayout` 只算、`commitPlan` 才写、`savePageSource` 走 `fmt`），`packages/viewer/src/client.ts` 的模式栏 + 三个写入交互，CLI 侧两条写路由 `POST /api/layout` 与 `POST /api/source`。`packages/cli/test/review-layout.test.ts`（12 条）与 `packages/cli/test/review-api.test.ts`（7 条，真起服务）钉住写什么、不写什么。**没落地**：意见锚点（`[instance:U3]` 前缀）、`layout` 里的实时布线（按设计不做）。决策见 [ADR-0134](adr/view/0134-the-view-layer-is-a-drawing.md) D3、D7、D8 与 [ADR-0141](adr/view/0141-the-review-app-has-four-modes.md) D1–D9。

**要做的事**：

1. **`packages/viewer`**：浏览器应用，`texteda review <工程目录>` 起本地服务（`node:http`，ADR-0134 decision 7；文件读写留在 CLI 侧，浏览器只收 JSON + SVG）。
2. **元素 id**：渲染器给每个绘制对象发稳定 id（`instance:U1` / `net:VCC` / `label:...`），SVG 里落成 `data-ref`。这是 renderer 侧的小改动，**渲染器仍然纯**（不知道 hover 与点击）。
3. **hover 高亮**：纯 CSS/SVG 层（描边 / 透明度 / 小浮层），**不重绘、不重排**——性能不构成压力；不做命中测试几何、不做空间索引。
4. **双击/`Enter` 跳转**：**已落地（2026-10-26）**。身份索引是 `dist/ir/identity.json`（`identity -> [{kind,label,file,line,col}]`，附注类，F11 / ADR-0103 D6），不是 `dist/ir/<shard>.spans.json`。选中一个元素后，双击它或按 `Enter`，给出「这个身份定义在哪里」的短菜单（sch 的实例行 / view 的摆位 / PCB 摆位 / 器件文件 / 符号 / 封装 / pin 行 / net 行），选中即打开 `vscode://file/<abs>:<line>:<col>`。**单次点击只选中，不跳转**；否则会与 `layout` 的拖拽/旋转抢同一个手势。`edit` 模式的 `Enter` 归文本编辑器。
5. ~~**四种模式**~~ **已落地（2026-10-29）**：`review`（读图 + 高亮 + 跳转）、`layout`（S1 打印页摆位：选中一个符号、拖拽、`r` 旋转；拖动/旋转只写 `place` 行；**不在拖动中走线**，Apply 时才写回 `place` 并重锚受影响的 wire，见 [ADR-0141](adr/view/0141-the-review-app-has-four-modes.md)）、`placement`（PCB 画布：板框、courtyard、走线、过孔、丝印；点一个对象高亮它的 net）、`edit`（分栏：源码文本 + 画布；点画布移动文本光标，改文本刷新画布，**编辑发生在文本里**）。切模式换 SVG 与覆盖层，不重新实现交互。
6. **意见锚点（可选）**：note 行允许 `[instance:U3]` 这样的可选前缀，只有 viewer 解析——与 ADR-0136「工具不解析散文」的张力是 ADR-0136 的开放点。

**验收**：

- hover 一个符号 → 该符号高亮并显示身份（实例 id、器件、封装），**SVG 不重新生成**（渲染一次后只看 DOM 变化）。
- 双击或按 `Enter` 一个符号 → 出现「定义位置」菜单，至少含 sch 实例行与 view 摆位两项；选中后打开对应文件并定位到行。
- 单次点击一个符号 → 只选中并显示 facts，不打开文件；在 `layout` 里按住拖动不会触发跳转。
- `review` / `layout` / `placement` / `edit` 四个模式都能用，且共用同一套高亮与跳转代码。
- `layout` 拖动/旋转一个符号 → 只改 `place` 行，`design/**` 不变；Apply 前不重算走线，旧线标 stale；Apply 后只重锚相关 net，未受影响 net 的 wire 与手改不动；`check` 无新增 error。**"`view.*` warning 清零"按"Apply 不引入新的 `view.*`"验收**：`view.nets-not-drawn` 是页面的既有状态，一次摆位改不动它。
- `edit` 模式改文本 → 画布更新；`edit` 的画布不做直接编辑（`layout` 才有拖动/吸附）。

**注意**：

- **选中是状态，跳转是动作**：单击只选中；`layout` 的拖拽/旋转与双击/`Enter` 跳转不共享手势。
- **GUI 不写设计**：`design/**` 一律不改；`layout` 的拖动/旋转只写 view 的 `place` 行，Apply 才写 `wire`；`edit` 改文本；没有第二个设计模型。
- **viewer 不布线**：`layout` 只产生 S1 打印页摆位；B0 布线的搜索在 sandbox 里由 agent/CLI 完成，不是拖动循环里的 interactive router（[ADR-0116](adr/pcb/0116-layout-and-routing-are-agent-driven.md)）。
- **F11 已不再是阻塞**：`dist/ir/identity.json` 已提供「身份 → 位置」索引，`review` 的跳转已用它；仍要保留的是：身份索引是**附注类**，不进工程哈希，不能变成第二个真源。
- 别在 viewer 里做布局求解或自己的走线算法——viewer 只显示与选中；布局布线的工具、检查与冻结在 CLI/agent 侧（[ADR-0116](adr/pcb/0116-layout-and-routing-are-agent-driven.md)）。
- `placement` 模式依赖 PCB 画布（`packages/renderer` 的 PCB SVG，F21），**在那之前这个模式可以先空着**（如实报"还没有 PCB 画布"，别用 sch 画布顶替）。

---

## F35. 采购层的实现（ADR-0128 的落地）

**现状**：**格式已定并落档；解析器、`fmt`、IR 契约、选料检查与 BOM 输出都已落地（2026-10-23）**。规范见 `spec/procurement.md`，决策见 [ADR-0128](adr/devices/0128-the-procurement-layer.md)（Accepted，2026-10-22；开放点已全部关闭），语言 0.9 新增 `procurement` 描述类型。

**已落地**：解析器与 canonical `fmt`（`packages/parser/src/procurement.ts`）；IR 契约 `schemas/ir/v0.7/procurement.schema.json`（**契约随本项从 v0.5 升到 v0.7**：v0.6 出了采购分片，v0.7 补了 `not_required` 状态）；分片路径 `boards/<board_id>/procurement.json`（规范）与 `boards/<board_id>/procurement-alternatives.json`（附注）；`texteda compile --procurement` 与 `texteda check` 的接线；**选料检查**（`packages/core/src/procurement/rules.ts`：`spec/procurement.md` §3.2 的六条 + `spec/procurement.md` §3.3 的逐角色比对 + 两条 warning，主料 error / 备料 warning）；**BOM 输出**（`texteda bom <工程目录> <board_id>`，CSV 或 `--json`）；参考工程的采购文件（主料 `assets/procurement/primary/charger-buck.teda`、备料 `assets/procurement/alternatives/charger-buck.teda`）与两件料文件。

**没有**：遮蔽件的选料检查（ADR-0132 的遮蔽本身没落地，F10）、下单格式的 BOM 导出（ADR-0121）。

**要做的事**：

1. ~~**解析器 + `fmt`**（`packages/parser`）~~ **已落地**（2026-10-23）：`procurement` 类型；头部三行（`version` / `procurement <board_id>` / `role`），`role` 必须与所在目录一致；唯一段 `selections`；行文法 `<generic> <params…> -> <part>` 与 `<generic> <params…> -> not-required`；canonical form 按左键文本排序、**不对齐**。
2. ~~**IR 契约**~~ **已落地**：`schemas/ir/v0.7/procurement.schema.json` + 重生成类型；分片路径 `boards/<board_id>/procurement.json`（规范）与 `boards/<board_id>/procurement-alternatives.json`（附注）；契约随本项升到 **v0.7**（v0.6 出了分片，v0.7 补了 `not_required`；F25 / F27 / F28 的那批已在 v0.5 落地）。
3. ~~**选料检查**（`packages/core`）~~ **已落地**（2026-10-23）：`spec/procurement.md` §3.2 的六条（通用器件是通用器件、件是件、件有 `mpn`、件的 `ratings` 覆盖行里写的角色、件的 `footprint` 等于通用器件的、件不是被遮蔽的库件）+ `spec/procurement.md` §3.3 的逐角色比对（`value` 走包络、`tolerance` / `esr` / `dcr` 是上限、`voltage` / `power` / `rated_current` / `sat_current` 是下限、`dielectric` 相等）；**主料违反 = error，备料违反 = warning**；通用器件行没选料 → warning（unsourced）；通用器件行写了 `not-required` → **不报**（这才是“本来就没有东西要买”，不是“还没买”）；选中的件板上没用到 → warning。**没做**：遮蔽件那一条（遮蔽本身没落地，F10）。
4. ~~**BOM 输出**（`packages/cli`）~~ **已落地**（2026-10-23）：`texteda bom <工程目录> <board_id>` 出表（CSV 或 `--json`）；四种行（件行、有选料的通用器件行、无选料的通用器件行、明确不采购的通用器件行）；行键统一为 `(component_id, 参数字典)`，件行的参数集为空；**无来源行：MPN 单元格留空，`status` 列写 `unsourced`**；**不需要采购的行：MPN 单元格同样留空，状态写 `not-required`**（MPN 里塞 `n/a` 或标记会被下单系统当真去订——ADR-0128 D4）。**工程自己的 BOM：`status` 列（`bought` / `unsourced` / `not-required`）与 `note` 列分开**，状态不与人的备注混在一格里。**没做**：下单格式的导出（列集由 [ADR-0121](adr/manufacturing/0121-jlc-prototype-delivery.md) D4 的规范定死）。
5. **`texteda check --json`**：采购诊断进机器载荷（unsourced / 未使用的选料 / 备料违反 / 遮蔽件）。**已落地**（诊断是普通的 `Diagnostic` ✓，`--json` 自动带上 ✓）；**遮蔽件**那条还没有（遮蔽没落地）。
6. **文档**：`docs/skills/new-project.md` 加一步"选料"；`AGENTS.md` §4.1 的状态行改成"已落地"；`docs/ir-reference.md` 由 `bun run gen` 重生成。

**验收**：

- 一块板有通用器件行但没选料 → BOM 那行 MPN 为空、comment 是 `unsourced`；`check` 报 warning，**不**阻断。
- 同一块板上另一个通用器件行写了 `not-required` → BOM 那行 MPN 为空、`status` 列是 `not-required`；`check` **不报** warning。
- 选一个 `footprint` 不同的件 → 主料里是 error、备料里是 warning。
- `fmt` 幂等，且**不**把选料行按列对齐。
- 只改备料 → `advisory_hash` 变、`project_hash` 不变（依赖 F28）；改主料 → `project_hash` 变。
- 选一个被工程派生件遮蔽的库件 → 报错。

**注意**：

- **前置依赖**：检查要用到 ADR-0123 的 `kind`（通用器件/件）与 ADR-0132 的遮蔽语义（F25 / F32），先落它们。
- **类型版本是 0.9，工具当前支持到 0.9**（`packages/parser/src/version.ts` 的 `SUPPORTED_LANGUAGE`）：解析器已落地，`procurement` 文件可以正常编译（2026-10-23）。
- 采购层是**决定**不是事实：别把价格、货期、供应商塞进描述里（ADR-0128 decision 10）。

---

## F36. 导入器：逆向工程 / 外部网表 → 本项目的源文件（**延后**）

> **2026-10-22：导入器相关的一切一并延后**——不只实现延后，**决策也延后**：读哪些格式、歧义怎么处理、推断怎么呈现，都在真要做的时候才定（[ADR-0113](adr/schematic/0113-connectivity-has-one-authority.md) D6 的方向保留，用来关掉"pcb only"那个问题；开放点一并延后）。延后期间不写半成品入口。

**现状**：**方向已定，实现为零**（[ADR-0113](adr/schematic/0113-connectivity-has-one-authority.md) D5/D6）。没有 pcb-only 模式：板必须有 sch；两个原本属于"pcb only"的场景由**导入器**承担——导入器是**语言之外的生成器**（[ADR-0100](adr/language/0100-fact-layer-has-no-expressions.md) D3），产物是表，评审对象是生成的 `sch`（对照原件检查），不是黑盒。

**重开条件（按事件，不按日历；2026-10-24 定）**：导入器不做，代价压在**手写库**上——参考工程全自建（[ADR-0131](adr/libraries/0131-the-reference-project-is-self-built.md)），外部库只能靠 `texteda lib import` 的 `.teda` 模板拷进来（[ADR-0133](adr/libraries/0133-trust-in-a-library-you-do-not-own.md)），`.kicad_sym` / `.kicad_mod` 没有导入路径。所以第一次出现下面任一条，就是重开的时候：

1. **一颗画不动的器件**：200 脚 BGA / 上千焊盘的连接器 / 引脚名只能从库文件抄的封装，手写成本明显压过导入；
2. **一次要一批通用件**：一个板需要 ≥20 颗不同取值或不同封装的通用件，逐个手写不再划算；
3. **同封装不同厂商的系列**：十几个 `kind: part` 共用一份几何，只有料号与额定值不同——手抄引脚表开始出错；
4. **别人的库**：只有 `.kicad_sym` / `.kicad_mod` / 外部网表这一个来源，且没有作者愿意按我们的格式重写。

**不构成重开理由**：KiCad 兼容性本身（导出 `.kicad_mod` / `.kicad_sym`、可选互操作 CI 照旧）；`fab` 与 Gerber/Excellon 的进度（F14 / F15 是另一条关键路径，见 [ADR-0120](adr/manufacturing/0120-the-manufacturing-output-path.md)）。

**要做的事**（触发后）：

1. 定范围：读什么（KiCad 工程？外部网表？纯几何？），写什么（`design/sch/` + `design/pcb/` + `assets/components/`）。
2. 从几何**推断**连通性：算法与置信度怎么表达；推断出的 net 名怎么起（用什么规则保证可读与唯一）。
3. 推断结果怎么呈现给人看：哪些是确定的、哪些是猜的（`docs/` 里的报告 + 生成文件里的注释）。
4. `assets/components/` 怎么来：外部网表只有 pin 名与网络，器件型号常常缺失 → 生成的器件是"通用占位"（`kind: generic`？）还是标 `unsourced`（F35 的口径）？
5. 幂等与可复现：同一份输入两次导入的产物逐字节相同（不变量 18 的精神）。

**注意**：

- 导入器**不是** pcb-only 的后门：它必须产出 `sch`，之后的板和其他板一样 sch 优先。
- **设备库导入与"逆向工程导入"是两件事，别捆成一条**：前者的产物是 `assets/**` 里的自有件（`.teda`，`texteda lib import` 拷入后重写为裸 id），后者的产物是 `design/**` 的源文件。前者更可能先被触发（上面的条件 1–4 全是它），后者要等"手里只有成品板"那天。
- 不要把导入器做成"网表黑盒"：它写出的表必须可读、可评审、可手改（[ADR-0100](adr/language/0100-fact-layer-has-no-expressions.md) D3 的反面就是它）。

---

## F37. 封装的非电气焊盘（ADR-0113 D3 的落地）

**现状**：**未落地**。ADR-0113 D3 定了"器件有焊盘、器件没有引脚"的解法：电气焊盘 = 器件的一个引脚（器件与符号都要有）；非电气焊盘（散热片、屏蔽片、机械焊盘）= **封装声明**，且在 pcb 里不得挂 net（挂了是错误）。

**要做的事**：

1. `spec/footprint.md` §4：`pads` 段加非电气标记（尾列 `key=value` 形式，与现有 `zone` / `thermal_w` 等一致），语义写死：非电气焊盘不参与 `lib:verify` 的"焊盘号覆盖器件引脚"检查。
2. `packages/parser/src/footprint.ts` + `schemas/ir/v0.3/footprint.schema.json` 同步（**规范与实现同一次提交**）；封装类型版本线走 PATCH（[ADR-0101](adr/language/0101-one-language-version-number.md) D5）——这是合并前的记法，类型版本线已随 2026-10-27 的合并退役，合并后是语言版本（见 [ADR-0101](adr/language/0101-one-language-version-number.md) D2）。
3. 绑定校验（`packages/core`）按新口径：非电气焊盘挂 net → error。
4. `lib:verify` 相应放宽。

**注意**：

- **不要把源文本复制进 IR**；非电气标记是语义（[ADR-0104](adr/ir/0104-ir-representation.md)）。
- 器件侧的"电气焊盘 = 一个引脚"是 [ADR-0123](adr/devices/0123-the-device-kind-is-part-or-generic.md) 的直接后果：引脚表变了就是另一个器件。

## F38. `physical_only` 实体要有位置；退役 `test_point` 形态（ADR-0113 D10/D11 的落地）——**已完成**
**现状**：**已落地**（2026-10-23）。[ADR-0113](adr/schematic/0113-connectivity-has-one-authority.md) D8、D10 的两件事都进了语法、IR 与校验：
- **位置**：`physical_only` 行是 `<id> <type> <x> <y> [args…]`（`spec/pcb.md` §4.11）。`cutout` 的参考点是矩形左下角，其余三类是圆心——圆形的"左下角"没有意义。IR 的 `mounting` / `fiducial` / `stitching` 多了 `x_nm` / `y_nm`，契约随这批从 v0.8 到 **v0.9**（`schemas/ir/v0.9/`，`bun run gen` 重生成）。语言侧 `pcb` 线 `0.7` → `0.7.1`（`spec/teda.md` §13.4 的 0.x PATCH 规矩；**不是** 0.8→0.9，那是 F31 之前的旧账法）。参考工程给 `charger-buck` 加了四个 M3 安装孔（`6.0mm` 盘 / `3.2mm` 孔，四角内缩 3.5mm），这一段从"声明了但没人用"变成有消费者。
- **退役**：`test_point` 形态从语法与 IR 一起删除（`PHYSICAL_ONLY_TYPES` 四类）；测试点是 `sch` 里的单引脚器件（D8/D9）。旧写法现在报 `value.unknown-pcb-type`，不是静默忽略。
- **绑定校验**：`referencedNets()` 只剩 `stitching` 带 net（`packages/core`），`fiducial` 在 schema 层就挂不上 net（`additionalProperties: false`）。
- **渲染/制造**：能编译、能校验、**画不出也带不走**——PCB SVG 与 Gerber 写出器都没落地（F15），这条只做了一半，不要把"进得了 IR"当成"能出图"。
- **采购尾巴**（不在本项内）：不采购的单引脚 generic 会产生"无来源"的 BOM 行（[ADR-0128](adr/devices/0128-the-procurement-layer.md) D10、F35）。

**原计划留档**（已完成，保留为理由）：测试点是 net 上的焊盘 → 器件；不是 → `physical_only` 实体。位置是坐标不是几何，形状归封装库。

## F39. 拆 `spec/teda.md`：语言级规范与分描述规范分家

**现状**：**未落地**（2026-10-22 决策：先只把文件移进 `spec/`，内容不动）。`spec/teda.md`（原仓库根目录的 `teda.md`）现在是**两层的混合体**：

- **语言级**：文件头与版本（`spec/teda.md` §5）、行类型（`spec/teda.md` §3）、词法（`spec/teda.md` §4）、类型与单位（`spec/teda.md` §10）、校验规则（`spec/teda.md` §11）、规范形式（`spec/teda.md` §12）、版本与兼容（`spec/teda.md` §13）、附录 A EBNF；
- **分描述级**：`component`（`spec/teda.md` §6）、`schematic`（`spec/teda.md` §7）、`system`（`spec/teda.md` §8）、`pcb`（`spec/teda.md` §9）。

而 `spec/` 里另有一半分描述规范（`symbol` / `footprint` / `pcb` / `schematic-view` / `module` / `procurement`）——`pcb` 两边都有（`teda.md` §9 只是一段指针，实体在 `spec/pcb.md`），`component` / `schematic` / `system` 只在 `teda.md` 里。**同一个目录里两种东西混着放**，读者要自己判断哪段是跨类型的、哪段是某个描述类型的。

**为什么不一次拆完**：`§N` 是**引用面**，不是排版：

- 全仓 145 处写 `teda.md §7.2` 这样的节号引用（`packages/` 注释、`docs/`、ADR 的 Impact 行、skill 手册）；
- 诊断注册表 `packages/ir/src/diagnostics/codes.ts` 里 39 条 `spec: ["teda.md §N"]` 是**冻结**的（[ADR-0102](adr/language/0102-diagnostic-error-codes.md)：码冻结、只增不改），它们直接流进 `docs/error-codes.md` 与诊断载荷的 `spec` 字段——那是给 agent 用的机器可读指针；
- 拆分会重编号 → 145 处引用与 39 条冻结指针一起失效。

所以第一步只做**路径搬家**（`teda.md` → `spec/teda.md`，文件名不变，节号不变，引用面全活），内容拆分另立本项。

**要做的事**（要 ADR 定，不能顺手做）：

1. **编号策略**（ADR 的核心问题）：要么新文件保留原编号（`spec/schematic.md` 里出现 "7"，怪但引用面不动）；要么重编号并把引用面整体迁到"文件 + 锚点"（`spec/schematic.md#实例段`），那 39 条冻结指针怎么办要先说清楚——"码冻结"冻结的是码本身还是连指针一起冻结。
2. **落点**：语言级那部分叫 `spec/language.md` 还是继续叫 `spec/teda.md`？叫 `teda.md` 的好处是名字被外部引用习惯（"见 teda.md §7.2"）已经形成；改名要一次性改完 145 处 + 冻结指针。
3. **内容落点**：`component` → `spec/component.md`、`schematic` → `spec/schematic.md`、`system` → `spec/system.md`；`pcb` 段合并进已有的 `spec/pcb.md`；`project.toml` 的语法（现在只在 `teda.md` §2 与 `AGENTS.md` §9 的表里）要不要单独成 `spec/project.md`。
4. **同一次提交**改 `spec/`、`packages/ir/src/diagnostics/codes.ts`（若动指针）、生成的 `docs/error-codes.md` / `docs/ir-reference.md`（`bun run gen`），并跑 `bun run check:links`（ADR 链接文字与目标必须仍一致）。

**为什么现在不做**：这一项的收益是"目录语义干净"，成本是动引用面与冻结契约。在十用例语料（F12）与 conformance 还没落地、引用面还没有统一锚点机制之前，**一份 `spec/teda.md` 更省事**。等 §N 引用面有了迁移机制再做不迟。

## F40. IR 契约参考文档漏掉分片内的嵌套对象

**现状**：**已落地**（2026-10-23）。`docs/ir-reference.md`（由 `packages/ir/scripts/generate.ts` 生成）原来只画两块：分片的**顶层字段**与 `$defs` 里的**具名类型**；分片里**内联的对象**（`component` / `footprint` / `procurement` / `project` / `symbol` / `sheet` 本身，以及 `project.authors[]` / `manifest.shards[]` / `system.boards[]` / `system.nets[]`）没有字段表——例如器件的 `id` / `kind` / `mpn` / `symbol` / `footprint` / `params` / `pins` / `pins_source` 与封装的 `name` / `tags` / `attr` / `package_code` 都不在文档里，agent 只能去读 schema。

**为什么重要**：这份文档是给 agent 的**字段查询表**（类型、单位、必填性）。字段没列出来 = agent 猜。

**要做的事**：

1. ~~生成器在画完顶层与 `$defs` 后，再遍历顶层各字段里**内联**的 object 属性~~ **已落地**（2026-10-23）：生成器现在递归找出分片里内联的对象（`component` / `footprint` / `procurement` / `project` / `symbol` / `sheet`，以及 `project.authors[]` / `manifest.shards[]` / `system.boards[]` / `system.nets[]`），按 `### <字段路径>` 出一张表；内联对象里的内联对象也画（`project.authors[]`）。
2. ~~顺带修覆盖率统计~~ **已落地**：覆盖率的分母现在包含内联对象的字段（350 → 431）。顺带把 `pcb` 分片的 81 处缺描述补齐（`$defs` 的定义与字段、顶层字段、union 的各分支），**431/431 = 100%**——描述是文案不是语义，IR 契约版本不动（ADR-0101 的 PATCH）。
3. ~~生成产物改动会很大（文档会显著变长），同一次提交跑 `bun run gen` 与 `bun run gen:check`）~~ **已落地**：`docs/ir-reference.md` 变长约 40%，`bun run gen:check` 挡住漂移。

**为什么现在不做**：~~与"删掉器件文件里的 `package` 字段"（ADR-0127 decision 1）无关，是生成器的既有缺口；补它会让本次改动的 diff 从"一件事"变成"两件事"。~~ **已做**（2026-10-23，与 ADR-0127 无关的独立一件事）。

## F42. 规格只被"写出"，没有被"验证"（ADR-0124 留下的洞）
**现状**：**item 0 已落地**（耗散检查），item 1 的第一片已落地（电压），见下（2026-10-23，[ADR-0125](adr/devices/0125-a-part-states-its-own-ratings.md) D8 / D11）。

- **分析模式（原来记作 item 0）已定**：按**声明窗口的受压端**比（不是标称点）；器件**互相独立**（语言还无法声明相关性，容差不参与比较）；**未声明即未知**，未知要计数（一块板一条 note）；降额是项目政策，不是检查器的常数。
- **item 0 已落地（耗散）**：阻性两引脚器件的最坏耗散 `P = ΔV²/R`（`ΔV` 同 ADR-0125 的窗口极端差，`R` 取实例行 `value` 或件的 `value` 额定值）同时比三条上界——设计的 `power <引脚> <max>` 约束、实例行的 `power` 要求、件的 `power` 额定值——取最紧那条，超了报 `design.rating-exceeded`；没上限或两端有一个没窗口的不比较，计入 `design.power-unknown`（note，一块板一条）。实现在 `packages/core/src/design/ratings.ts`，决策与局限见 [ADR-0125](adr/devices/0125-a-part-states-its-own-ratings.md)（这是**上界**：两端窗口相同时它给 0，所以只报违规、不证明通过；串在两条窗口之间的 RC 阻尼电阻上这个上界没有物理意义）。参考工程实测：charger-buck `24` 个阻性实例里比了 **4** 个（其余 20 个所在 net 无窗口），mcu-board `3` 个全因无窗口跳过，0 违规——比得动是因为**封装底线**（[ADR-0126](adr/devices/0126-the-package-gives-a-chip-resistor-its-floor.md)）：`(construction, package_code)` 查表（0402 = 62.5mW），厚膜是同一封装的最低档，所以这张表给的是底线而不是猜测买了哪颗件。底线只在设计/行/件都没声明时生效；同一条底线也让选料拒绝低于底线的件（rule 4a），两个检查不会互相打架。两块参考板的两颗 10k 件（`rc0402fr-0710kl` 62.5mW、`crc0402fr-0710kl` 63mW）补上了件的功率额定值。
- **电压第一片已落地**：两引脚器件的 `voltage` 能力 vs 它两个 net 的声明窗口之差。`packages/core/src/design/ratings.ts`，新域 `design`（ADR-0125 D15）：`design.rating-exceeded`（error）+ `design.stress-unknown`（note，报覆盖率）。`spec/teda.md` §7.4 写清了口径；两块参考板补了 `voltage GND 0V..0V`（帧原点由设计声明，工具不假设 GND = 0V），覆盖从 0 抬到 charger-buck 11/61、mcu-board 10/21，且参考设计 0 违规。
- **还没做**：**同一张表里的电压底线**（0402 = 50V、2010 = 200V 之类，是 F42 item 1 的封装版；它受件限制多于受封装限制，所以跟对称电压一起做）；串在窗口之间的**交流/阻尼**位置怎么声明"这个上界不适用"（现在是"没写上界"，两种状态分不开）；多引脚器件的应力模型（`Vds` / `Vgs` / `Vin` 要按构造定引脚语义——这是覆盖率的大头，也是下一个真正的一步）；`current`（网电流由谁承担语言还没说）；`power` / 磁饱和 / 温度；项目级降额政策进 `project.toml`。

**2026-10-26 端子与方向已定，未实现**：`ratings` 行可以写成 `role type value from to`（pin 编号、有序对），方向由角色表决定（`symmetric` / `from` / `to` / `none`），角色表同时加 `kind`（`limit` / `characteristic` / `code`）。决策见 [ADR-0125](adr/devices/0125-a-part-states-its-own-ratings.md)。解析器、IR 契约 `rating.terminals`、`packages/core` 的端子比较仍未开始；参考工程没有可用的 datasheet 值，先用合成夹具。

**2026-10-23 覆盖率审计（实测，用来定下一步做什么）**：`texteda check` 的两块参考板。

| 板 | 实例 | 已比 | 跳过 | 跳过原因 |
|---|---|---|---|---|
| charger-buck | 61 | 11 | 50 | 38 无电压能力 · 11 所在 net 无窗口 · 1 非两引脚 |
| mcu-board | 21 | 10 | 11 | 8 无电压能力 · 3 所在 net 无窗口 |

charger-buck 那 38 个"无电压能力"的实例，按器件拆开是：**电阻 24**、晶体管 5、LED 3、二极管 2、电感 2、NTC 1、充电器 IC 1。所以缺口的**大头不是模型，是件上没写额定值**——电阻的"最大工作电压"本来就能写进现在的两引脚对称模型（焊盘对称，`voltage` 角色已存在），只是件文件里没有。

**第一个该做的是功率，不是电压**（2026-10-23 追问后修正；**已落地**，见上面 item 0）：电阻的两道边界里，**功率是低阻值时先到的那道**，而语言里早就有它的一半——`power <引脚或 net> <max>` 约束能写、能解析、进 IR（`max_uw`），落地前**没有任何检查器消费它**。`spec/teda.md` §6.2.2 曾写着"ERC 检查"，那是空头承诺，已改。功率检查**不需要电流模型也不需要端子**：

- 最坏耗散 = ΔV² / R，ΔV 取两端 net 声明窗口的极端差（ADR-0125 D8/D2 的口径），R 取实例行的阻值；
- 两个比较：**设计的耗散上限**（`power R1 63mW`）比它 → 设计自己说的话错了就报；**件的功率额定值**（件 `ratings` 的 `power`，或实例行的 `power` 要求）比它 → ADR-0125 的 `design.rating-exceeded` 家族；
- 局限说清楚：这是**从声明窗口推出来的上界**，不是实测；两端窗口相同时它给 0，实际耗散可能不是 0（电流不可推），所以它只能报违规、不能证明通过——与 ADR-0125 D13 同一个口径。

按"能抬多少覆盖率 ÷ 要多少设计工作"排序，下一步是这个顺序，不是按器件类别补词：

0. **功率检查（先做，零模型改动）**：见上。
1. **对称电压的件数据**（电阻 27 个实例、NTC）：**零模型改动**。电阻的 `thick` / `thin` 构造缺一个可选 `voltage` 角色（通用件要在 `params` 里声明才可能在实例行写）；件文件按 datasheet 补 `voltage 50V`（0402）/ `200V`（2010）。**值必须来自 datasheet**，仓库里没有就留空并记在 `docs/` 的表里，不许猜。
2. **端子（`ratings` 行说清跨哪两个引脚）**：多引脚器件的**前置**——晶体管、稳压器、二极管都要它。charger-buck 今天只有 1 个实例因此被跳过，但上面第 3 条全靠它。
3. **极性**：二极管的 `Vr`、LED 的 `Vr`、晶体管的 `Vds` / `Vgs` 都是**有方向**的应力；现在两引脚比较取 `max|Δ|`，对二极管是错的（正向压降不是应力）。10 个实例等这一步。
4. **额定值可以是区间**（IC 的工作窗口，如 MCU 的 2.7..3.6V）：**这一步要推翻 [ADR-0125](adr/devices/0125-a-part-states-its-own-ratings.md) D3 的"额定值不是区间"**——IC 的供电窗口是件的事实，而设计声明的窗口必须**落在**它里面。要新 ADR，不能顺手改。
5. **电流**：语言还没说"谁承担这条 net 的电流"（`current VOUT 3A` 不指成员），排最后。

2 与 3 已由**同一个 ADR** 定（[ADR-0125](adr/devices/0125-a-part-states-its-own-ratings.md)，2026-10-26）：一条 `ratings` 行说的是哪两个端子、哪个方向，角色表同时带 `kind`；实现未开始。

**原记录（保留为理由）**：规范要求每个通用器件的 `instances` 行写出一份完整规格（`100nF ±10% 16V X7R`），检查器强制这些列都在（[ADR-0124](adr/devices/0124-device-vocabulary-and-parameter-roles.md)），但没有东西拿它去比对。件级额定值的来源已由 [ADR-0125](adr/devices/0125-a-part-states-its-own-ratings.md) 定案并落地。

## F43. 器件角色词表太薄，装不下真实器件的额定值

**现状**：**未落地**（2026-10-23 记，ADR-0125 落地时暴露）。[ADR-0124](adr/devices/0124-device-vocabulary-and-parameter-roles.md) 把"角色"定成封闭词表（`tolerance` / `voltage` / `dielectric` / `esr` / `dcr` / `rated_current` / `sat_current` + 自由定类型的 `value`），[ADR-0125](adr/devices/0125-a-part-states-its-own-ratings.md) 让件用 `ratings` 段写自己的额定值。但真实器件的额定值远不止这些：晶振的**负载电容**（CL）、MOSFET 的 **Vds(th)** 与 **Rds(on)**、LED 的**光强**、连接器的**插拔次数**、电感的**饱和电流**以外的**温升电流**——都没有角色可写。参考工程里只能把负载电容留在注释里（`examples/reference-project/assets/components/passives/xtal-8mhz-3225.teda`）。

**2026-10-23 补记**：这张清单其实混了三种东西，混在一起就会长出 F43 自己担心的碎名字：

| 类 | 例子 | 消费者 | 能不能被应力检查用 |
|---|---|---|---|
| **限值** | `Vds`、`Vr`、`rated_current` | 应力检查 | 能（但要有端子与方向，见 F42 第 2/3 条） |
| **特性** | 晶体负载电容 `CL`、`Rds(on)`、`Vgs(th)`、光强 | 选料比对、生成器、BOM | 不能——它们不是"不能超过"的边界 |
| **寿命/机械** | 连接器插拔次数 | 选料说明 | 不能 |

所以词表要长的是**两类**：限值（带端子与方向）与特性（不带）。词表加一列 `kind`（`limit` / `characteristic` / `code`），只有 `limit` 才可能进应力检查——这样 `load_capacitance` 永远不会被误当成边界；这条已由 [ADR-0125](adr/devices/0125-a-part-states-its-own-ratings.md) D6 定下。**成本很低**：`rating.name` 在 IR 契约里是自由字符串（`^[a-z][a-z0-9_]*$`），加角色**不动 IR、不动 schema**，只动 `packages/core` 的角色表与 `spec/teda.md` §6.2.1 的表。

**为什么重要**：角色封闭是**对的**（检查器要按角色分支判定），但封闭集必须**长得够用**，否则真实器件有一半额定值写不进去，只能落回注释——那就退回了"规格只是散文"。角色表是**版本化**的词表（加角色 = 加一个 MINOR/PATCH 的词表版本 + ADR），不是随手加字段。

**要做的事**：

1. 先收集真实用例：从参考工程的件里列出"写不进去的额定值"，按类别归并（电容类、晶体管类、光电器类、机电类…），每类问"这个量是不是某个**构造**（construction）的固定角色"（像 `esr` 只属于电解电容那样）还是全局角色。
2. 每个候选角色定三件事：名字、量纲（quantity）、值域是否封闭（像 `dielectric` 那样是代码集，还是连续量）。
3. 角色表进 `packages/core` 的器件规则表（那才是词表的真源 ✓），检查器照旧按角色分支；`value` 的自由类型保持不变（那是"主量"，不是角色）。
4. 加角色的流程写进 [ADR-0124](adr/devices/0124-device-vocabulary-and-parameter-roles.md) 的后续说明（或新 ADR）：词表版本号怎么走、旧的件文件要不要跟着改。

**为什么现在不做**：角色表的形状要一次想清楚，否则会出现"一个构造一个角色名"的碎法（`cap_cl` / `xtal_cl` / …）和全局角色并存、互相打架。`ratings` 段与检查器已经就位，词表可以按构造逐批长。

## F44. `pcb` 的完整性没有校验：`connect` 与 `trace` 互不校验，部分布局是静默的（**已完成**）

**现状**：**已落地**（2026-10-23；两条都由 ADR 定案并实现——几何兑现：[ADR-0119](adr/pcb/0119-connect-pairs-need-copper.md) 的 `bind.connect-unbacked`；部分布局：[ADR-0118](adr/pcb/0118-a-partial-layout-is-legal.md) 的 `bind.instance-unplaced`）。首轮 PCB 评审暴露的问题与当时的记录：绑定校验只查"`connect` 引用了未放置实例的焊盘"（`bind.pad-unplaced`）与"`place` 引用不存在的实例"，**不查反方向**，也不查几何是否兑现了声明：

- **声明与几何不互校**：`connect` 声明哪两个 pad 之间有连续铜箔，`trace` / `via` / `zone` 画几何，两段之间没有任何校验。参考工程里就有一处对不上：`connect` 声明 `M2.R1.1` 与 `M2.C3.1` 直接相连（分压器搭在输出电容上），而 `trace` 里唯一的 VOUT 铜箔从 R1（14.5, 25）绕 28 mm 接到 x ≥ 36 的电容上。两者只能有一个是真的。
- **部分布局是静默的**：参考工程 `design/pcb/charger-buck.teda` 只放了 9 个实例，而这块板有 61 个（`buck-5v` 9 个 + `charger-power` 52 个）。没有任何诊断说"还有 52 个器件没放"，文件里也没有标记说这是部分布局。agent 读 `place` 与 `connect` 会认为板子已经布完。原因是注释里的一句话，不是设计事实。

**为什么重要**：这两件事都决定"这份 PCB 描述能不能被信任"。第一条让**连通性的声明失去几何支撑**——而连通性恰恰是这份描述最不该含糊的东西；第二条让**缺失看不见**，评审与后续工具都会把部分布局当成完整布局。

**要做的事**：

1. ~~**`connect` ↔ 几何的一致性**：为每一对 `connect` 判定"是否被铜箔兑现"~~ **已落地**（[ADR-0119](adr/pcb/0119-connect-pairs-need-copper.md)，Accepted；参考工程首轮报 7 对，其中两对是另一网络的铜箔落在焊盘上）：铜 = `trace` 线段 + `via` 桶 + `zone` 多边形，链只在 via 处换层，贴合容差 1 nm，严重度 warning。需要 pad 几何（封装 + `place` 的旋转/平移）与区域多边形；"兑现"的定义要先定：一条 `trace` 同时触及两端、或两端各有一个 `via` 且 `zone` 相连，算不算？定义不清就会要么漏报要么满屏误报。
2. ~~**部分布局**：先定**部分布局合不合法**~~ **已定并已落地**（2026-10-23，[ADR-0118](adr/pcb/0118-a-partial-layout-is-legal.md)）：合法，且**不加显式标记**——完整性由两份描述相减得到（`sch` 的实体实例减 `place`），一块板报一条 `bind.instance-unplaced`（warning）。规范 `spec/pcb.md` §5.2 规则 12、检查器 `packages/core` 已落地，参考工程现在报 `9 of 61`。`logical_only` 豁免，`dnp` 不豁免（封装仍占位）。
3. 两条都要先改 `spec/pcb.md` §5.2 与 IR 契约，再改 `packages/core`；严重级别与诊断码按 [ADR-0102](adr/language/0102-diagnostic-error-codes.md) 登记。

**验收**：

- 参考工程那份 `pcb` 要么补上 VOUT 的几何、要么改掉 `connect` 的搭接点，并且**有一个诊断**能指出当初那种不一致（构造一个反例夹具）。
- ~~只有 9/61 个实例被放置时，`check` 给出明确信号~~ **已落地**（第 2 条，`bind.instance-unplaced`）。

**注意**：

- 别为了"能查"而发明 `complete = false` 之类的开关再倒推语义：第 2 条是**规范问题**，先决定再写码。
- 几何校验依赖 `physical_only` 带位置（F38）与焊盘几何来自封装库（ADR-0129）；`physical_only` 现在没有坐标，安装孔、基准点还画不进去。
- 与 F42 划清界限：那条是"额定值 vs 约束"（电气），这条是"声明 vs 几何"（物理），不要合并成一个"PCB 检查器"。

## F45. 块（`Block`）的侧车文档：**决定不做，触发条件在案**

**现状（2026-10-23）**：语言、IR 契约、解析器里**没有** `block` 字段或描述类型，这是 [ADR-0139](adr/process/0139-process-entities-outside-the-language.md) D1/D2 的决定（`AGENTS.md` §11 Q10 已关）：`Block` 是功能轴，`module` 是复用轴，两轴正交；不复用的分组只是描述。ADR-0139 留了一个洞没填——"接口表要是想被检查，需要一个小机器可读的形态，此处不定"。

**决定**：**现在不做**。补那个洞的价值不足以支撑又一种文件类型：没有真实评审流程在按功能块开会、按功能块问"这块现在包含哪些件"，也没有出现过一次真实的文档漂移。缺一个东西不等于现在就该补它。

**触发条件**（满足任一条再重开，不要凭"概念完整"重开）：

1. 评审真的按功能块进行，且"这个块包含哪些器件"被问到 **≥3 次**；
2. 出现过**一次**真实漂移：块文档里写的实例 / net 与板上对不上，靠人肉才发现。

**触发后要做的事**（形态草案，重开时先写 ADR 定案，不要照抄落地）：

1. 形态是**侧车文档**，不是描述类型：`docs/blocks/<board_id>/<block_id>.md`，Markdown 头 + 散文正文，与评审记录（[ADR-0136](adr/view/0136-review-records-and-attribution.md) D2）和仿真报告（[ADR-0139](adr/process/0139-process-entities-outside-the-language.md) D3）同一个形状。
2. 头字段先定这几个：`board` / `block` / `instances`（展平后的 `instance_id`，模块实例写 `M2.U1`）/ `nets`。通配符要不要（`M2.C*`）先定：通配符省字，但让"漂移"变成不可判定的匹配。
3. 检查器只做一件事：头里的每个名字在板上存在（实例在 `instances` 表、net 在 `nets` 表）。不存在 → **warning**，`location` 指块文档的头，`related` 指板上最近的行（[ADR-0103](adr/language/0103-source-spans.md) D5，这一轮的 `locateNet` / `locateInstance` 正好复用）。散文一个字都不检查。
4. 明确不做：不生成 IR 分片、不进 `manifest.json`、不进工程哈希；不做 canonical formatter；不检查"划分对不对"；不强制每颗器件必须属于某个块（那是组织政策，[ADR-0139](adr/process/0139-process-entities-outside-the-language.md) D5）。

**边界**：

- 与 F34（评审 GUI 的身份索引）不同：那是"身份 → 位置"，这是"功能归属"；索引能跳到 `M2.U1`，但它不知道 `M2.U1` 属于哪个块。
- 与 F12（十用例）无关，不要捆在一起做。
- `module` 不替代它：一个功能块可以横跨几个模块，一个模块也可以装两个功能块；硬用 `module` 表达会把模块拆碎，破坏复用。
- 打印页（`view`）不替代它：页是**画布分区**（S1、可丢弃），边界由画布尺寸决定，不由电路功能决定。

## F46. 每文件 `rev` 与按文件的信任匹配（ADR-0133 的落地）

**结果（2026-10-24）**：`component 0.1.7` / `symbol 0.5.1` / `footprint 0.4.2` 各多一个可选 `rev`；`[[trust]]` 的行是**一个动作**（`by` / `on` + 三组 `id@rev`），条目与文件 `rev` 逐字相等才算背书；`[library] rev` 删除；重导时事实未变则保留旧 `rev`（对比去掉头注释 / `rev` / `version` / provenance 块后的文本，`factsOf`），副本的 `+local.N` 在事实对得上时随重导并回库版本；两份记录覆盖同一 `(library, id, rev)` 而归属不同 = 拒绝导入。契约到 **v0.13**。实现：`packages/cli/src/trust-record.ts`（共享条目形状）、`library-manifest.ts`、`trust-table.ts`、`lib-import.ts`；测试 `packages/cli/test/lib-import.test.ts`（per-file revisions 一组）。

**原现状（2026-10-24 之前）**：信任按**库 revision**匹配——`library.toml` 与消费方表（`--trust`）的行都是**行级** `rev` + id 列表，`lib import --rev` 选树。语言里**没有** `rev` 标量；`library.toml` 的 `[library]` 仍带 `rev`。后果是已知的：上游发一版只改一个件，消费者重导整棵树就把所有副本盖成新 rev，整库的已审记录随之作废（或保留旧行，让改过的那个件继续被旧背书覆盖）。决策见 [ADR-0133](adr/libraries/0133-trust-in-a-library-you-do-not-own.md)（**Proposed**）。

**要做的事**：

1. **语言表面**：`component` / `symbol` / `footprint` 各加一个可选标量 `rev`，语义 = **该文件的事实最后确立的那个发布名**（不是格式 `version`，不是库整体版本）。取值任意非空字符串，禁空白与 `#`（这样 `2.1.0+local.1` 合法）。写在 `version` 行之后、第一个段之前，与 `provenance` 同区。
2. **契约**：三份 schema 加可选 `rev`，`bun run gen` 重生成类型；`0.x` 阶段走 PATCH 位（[ADR-0101](adr/language/0101-one-language-version-number.md)）。`docs/ir-reference.md` 随之更新（生成的）。
3. **解析与 fmt**：作为标量解析；canonical 位置固定，`fmt` 负责排序与对齐；`fmt --check` 覆盖三种描述。
4. **`lib import`**：文件自带 `rev` → **原样保留**；没有 → 用 `--rev` 盖章。目标文件已存在时，按"去掉来源头注释后的字节"比较：相同则**保留旧 `rev`**，不同则写新值（ADR-0133 D13）。这条比较是本项最容易写错的地方，必须有专门用例。
5. **表条目改为 `id@rev`，匹配按条目**：行只剩 `library` + `by` + `on` + 三组条目（`components` / `symbols` / `footprints`），每组条目是 `<id>@<rev>`，**没有行级 `rev`**，也不允许"条目省略 `@rev` 沿用行 `rev`"（同一事实两种拼法 = 第二套 canonical 形式）。匹配 = 条目字符串与文件自己的 `rev` 逐字相等；两条通道（库的 `library.toml`、消费方的 `--trust` 表）共用这个形状与同一个解析器。`+local.N` 因此天然不被上游的条目覆盖。**同一 `(library, id, rev)` 被两份记录以不同归属声明 = error**（不再"消费方优先"）：各自覆盖不同条目时并存，冲突要人改，不由导入器挑一个。
6. **`[library] rev` 删除**：`library-manifest` 不再接受该键；旧文件报一条明确的诊断（说清改用文件级 `rev`），并拒绝整次导入（与现有 manifest 错误同口径）。

**验收**：

- 库内两个文件 `rev` 不同，只给其中一个的条目加信任行 → 导入后只有它落成 `provenance reviewed`。
- **一次复核覆盖三个不同 `rev` 的文件 → 一条行、三个条目、一组 `by` / `on`**，三个文件都落成 `provenance reviewed`（这是本项形状改动的理由：署名按动作付一次）。
- 两个记录同时覆盖同一文件、`by` 不同 → 拒绝导入并说明是哪两条，不静默选一个。
- 上游只改一个件的 `rev`，`lib import --force` 重导整棵树 → 其余副本仍是 reviewed（字节比较保留了旧 `rev`）。
- 手改副本把 `rev` 改成 `2.1.0+local.1` → 上游那条行不再匹配它；重新导入该件时它回到行能覆盖的值（或保持 fork，取决于是否 `--force`）。
- `library.toml` 里留着 `[library] rev` → 拒绝导入，消息指向文件级 `rev`。
- `bun test` / `typecheck` / `gen:check` / `fmt:teda --check` / `check:links` 全绿。

**注意**：

- **不要引入哈希**：[ADR-0133](adr/libraries/0133-trust-in-a-library-you-do-not-own.md) 保持撤销；字节比较只发生在导入那一刻，不落盘、不校验。
- **`+local.N` 是约定，不是校验**：工具只做精确字符串比对，不判断 fork 的正当性。
- **`rev` 进分片会改工程哈希**（它是文件的公开事实，同 `datasheet`）；这不是回归，是预期，验收时按此口径看哈希变化。
- 与 F29（跨工程共享自有库）**分开**：本条不做依赖层、不做 lockfile、不改"构建只读 `assets/`"。

## F47. 位号重编号（`texteda renumber`，ADR-0110 的落地）

**现状**：**已落地**（2026-10-26，`packages/cli/src/renumber.ts`，CLI `texteda renumber`，测试 `packages/cli/test/renumber.test.ts`，做法见 `docs/guides/renumbering.md`）。加元件仍是直接改源码，`fmt` 只排序、不填洞；重编号是**显示名改名**：实例的 `uid` 保留（[ADR-0109](adr/project/0109-instance-identity-is-a-uid.md)），但 net 成员、view/pcb 摆位与 `source_hash` 仍会变，BOM 显示也会变。agent 可以选策略或给映射，但不能手改编号。`preserve` 对已有行是 no-op（命令不负责创建新实例）；`position` 在模块被多个实例摆到不同坐标时拒绝猜测，要求 `--mapping`；`project.toml` 的 variants 当前契约仍是 `slug`（`component_id`），扫描器只在条目点名实例时改名（为后续放开预留）。

**要做的事**：

1. **CLI**：新增 `texteda renumber <project> <board>`，默认 `--dry-run`；`--apply` 才写盘。策略 `--policy preserve|compact|position`，或 `--mapping <file>`；`position` 依赖 view 的 `place`，没有 view 就报错而不是猜。
2. **映射**：解析 sch / pcb / view，收集实例 id；按前缀分组，按自然序排；校验同一前缀内唯一、前缀不变、无碰撞；处理多单元（`U1.2.OUT`）与模块实例（`M1.R1`）。不改 net 名、port 名、`component_id`、symbol/footprint id。
3. **原子应用**：一次写完或一行不写。更新 sch 实例行与 net 成员、view 的 `place` 与 `wire` 引脚引用、pcb 的摆放实例引用、variants 里引用具体实例的条目；模块按所选命名空间改模块源，不把扁平视图名硬改成全局连续号。
4. **报告**：old→new 表、受影响文件、碰撞、重编号前后的工程哈希 / `advisory_hash`、Markdown 里仍出现旧位号的位置（只报告，不改散文，ADR-0136）；apply 后跑 `fmt` 与 `check`。
5. **测试**：空号 compact、preserve 保持旧号、position 按 view 顺序、mapping 正反例、模块与多单元、碰撞拒绝、dry-run 不写盘、重复执行幂等、view/pcb 同步更新、`fmt` 不重编号。
6. **文档**：命令落地后补 `docs/guides/renumbering.md`（何时用、dry-run 输出、怎么审映射、哪些散文要人工跟），并更新 CLI 帮助与 `AGENTS.md` §10 的命令列表。

**验收**：

- `--dry-run` 打印 old→new 与受影响文件，工作区不变；`--apply` 后 `check` 0 error、`fmt --check` 通过，工程哈希变化被明确报告。
- `compact` 把 `R1, R2, R5` 变成 `R1..R3`；`preserve` 只给新件下一个空号；`position` 按 view 从上到下、从左到右；同一映射第二次执行是 no-op。
- 多单元 `U1.2.OUT`、模块实例 `M1.R1`、view 的 `place`/`wire`、pcb 的实例引用全部跟着改；net 名、port 名、`component_id` 不变。
- 映射有重复或前缀冲突 → 拒绝，不写任何文件，消息指出冲突的两项。
- Markdown/评审记录里的旧位号 → 报告位置，不自动改。

**注意**：

- **`fmt` 永不重编号**：格式化必须只改排版；重编号是独立命令。
- **`uid` 保留，引用仍是名字**：重编号会改 `source_hash`；把 net 成员、view/pcb 摆位整体重键到 UID 并做身份哈希，是另一条决策，不在本条里偷做。
- **模块的全局连续号不是机械映射**：模块内 refdes 是本地的，所有实例共享；要跨实例全局连续，先改模块模型，不要伪造。
- **不自动跑**：加元件不会触发重编号；用户显式调用。agent 只能给 `--mapping` 或选策略，写盘由代码做。

## F48. Agent 驱动的布局与布线：sandbox、结构化工具、DRC 反馈与交互式规则拍板（ADR-0116 的落地）

**现状**：**只有设计，没有实现**（2026-10-26，[ADR-0116](adr/pcb/0116-layout-and-routing-are-agent-driven.md)）。`pcb` IR 已有 `place` / `trace` / `via` / `zone` / `keepout` / `rules` / `connect`，`packages/core` 已有连通性、绑定、部分布局与铜箔兑现检查；没有 sandbox、没有结构化布局工具、没有 agent 反馈用的几何 DRC、没有 `docs/skills/route-pcb.md`，也没有交互式规则拍板。

**为什么现在做**：布局布线的搜索策略交给 agent，项目提供状态、动作与判定。这样既不自研 placer/router，也不把决策交给黑盒求解器；DRC 是硬约束，指标与人审补上“DRC 全绿但板很差”的缺口。

**要做的事**：

1. **Sandbox**：`dist/` 下的派生工作区（具体路径由实现定），gitignore、可丢弃、不是第二真源；agent 只改 sandbox，`apply` 才写 `design/pcb/<board>.teda`。
2. **结构化工具**：`query` / `place` / `route_segment` / `add_via` / `ripup` / `check` / `render` / `diff` / `apply`。工具接受身份与几何，不接受整块板的自由文本；工具层先拒绝非法动作（低于 net 最小线宽、越界层、非法过孔、keepout）。
3. **DRC 子集**：间距、线宽、过孔、keepout、板边、未布线；由 `packages/core` 自己实现，零外部依赖；KiCad DRC 只做可选对照。诊断带 `code + location + expected + actual + rule id`。
4. **指标**：未布线数、总线长、过孔数、层切换、交叉数、面积、电流密度、差分 skew；预算由人审，不静默优化。
5. **规则拍板**：agent 只能提议 `rules`；interactive mode 展示默认值、按 net 覆盖与后果，用户接受/修改后才写入 `rules`。只存在于 prompt / skill 的数值不是规则。
6. **Skill**：`docs/skills/route-pcb.md`（英文）。只写策略：路由顺序、escape、rip-up、失败升级、停止条件；数值引用 `rules` 与诊断码，不复制。每个诊断码一条修复入口，配小夹具与陷阱板。
7. **冻结**：接受的布局记录 `source_hash`、provider/model/version、prompt 标识、seed、工具轨迹摘要、检查报告与评审记录；重跑 agent 不得覆盖已接受布局。
8. **文档**：`AGENTS.md` §1/§8、`spec/pcb.md` §4.9/§5.2、`docs/comparison.md` 已同步；CLI 帮助与 skill 在实现时补。

**验收**：

- agent 在 sandbox 里摆一个器件、布一条 net：`check` 返回结构化违规或通过；`apply` 前 `design/**` 不变，`apply` 后 `check` 仍通过。
- 低于 net 最小线宽的 `route_segment` 被工具直接拒绝，不进入 DRC。
- `connect` 未被铜箔兑现、跨 net 短接、keepout 穿越、板边越界、未布线各有一条诊断；`--json` 可被 agent 消费。
- 交互式规则拍板：用户拒绝的规则不写入源；接受的规则写进 `pcb.rules` 并改工程哈希；skill 里没有硬编码数值。
- skill 的每个诊断码有修复入口与夹具；陷阱板回归记录违规数、未布线数、过孔数、总线长、迭代次数。
- 接受的布局有冻结记录；同一 sandbox 重跑不会静默覆盖。
- `bun test` / `typecheck` / `fmt:teda --check` / `check:links` 全绿；不新增外部依赖。

**注意**：

- **不写 placer/router**：agent 是策略，工具与检查器是底座；外部 router 若要出现，只能作为工具，不是架构。
- **连通性权威不动**：agent 不得用几何新增连接；`sch` + `connect` 仍是真源（[ADR-0113](adr/schematic/0113-connectivity-has-one-authority.md)）。
- **DRC 不是目标函数**：只有硬约束会放过“合法但很差”的板；指标预算与人审必须同时存在。
- **规则不在 skill 里**：skill 引用规则；数值只进 `pcb.rules`，否则 skill 与检查器会各说一套。
- **不保证收敛**：密集板/高速板要允许升级给人；失败是正常结果，不是工具 bug。
- **S1 不混进来**：打印页摆位仍归 `view`，B0 布局布线才归本项（[ADR-0134](adr/view/0134-the-view-layer-is-a-drawing.md)）。

## F49. 受限 2D 几何内核：铜皮填充的 offset / boolean 基础（ADR-0117 的落地）

**现状（2026-10-26 更新）**：**内核核心、填充策略层与 Gerber 写出器的第一段都已落地**（[ADR-0117](adr/pcb/0117-copper-fill-uses-a-geometry-kernel.md) D2、D9）。策略层在 `packages/core/src/fill/`（net 分类、对接间距、`zone_connect`、thermal、`min_width` 开运算、keepout / cutout 裁剪、同层不同 net 重叠报 `drc.zone-overlap`），图像装配在 `packages/core/src/board-image.ts`，序列化在 `packages/exporter/src/gerber.ts` + `excellon.ts`；`texteda export gerbers` 与 `check` 都跑同一条链。F49 剩下的只有第 7 条的部分：随机对拍与更大板面的性能（参考板单块铜皮 8 ms，`min_width` 打开约 370 ms）。`pcb` 的 `zone` 只有轮廓 + net + layer，Gerber 需要实际铜箔区域；之前"把填充结果存进分片"的思路只是把计算挪走，仍然要写几何算法。零依赖（[ADR-0120](adr/manufacturing/0120-the-manufacturing-output-path.md)）排除了借用 polygon/boolean 库，所以自研一个受限内核。

已落地（`packages/geom`，`bun test packages/geom` 101 条）：整数 nm 的 `Point` / `Polygon` / `Region`；谓词（`cross` / `orientation` / `pointOnSegment` / `segmentsIntersect`）；规范化（去重点与共线点、逆时针、**旋转到字典序最小的起点**、`-0` 归零）、`isSimple` / `isConvex` / `convexHull`；形状构造 `rect` / `centeredRect` / `roundRect` / `oval` / `circle`（内接）/ `capsule` / `rotate`；面积与包含、点线/点多边形距离；**布尔**用垂直分解（`union` / `intersection` / `difference` / `overlaps`，按包围盒聚类），输出是**互不重叠的凸片覆盖**，孔洞 = 围成环的若干片，没有内环；**偏置**是解析的（凸片与工具圆盘做闭式 Minkowski 和；侵蚀对单个凸环用半平面裁剪，其余走"补集膨胀再取补"），工具圆盘**外接**，所以间隙只会偏大不会偏小；`convexCover` 供调用方把任意区域切凸。实测锚点写在用例里（10 mm 方形加 1 mm、8/16/32/64/256 段收敛；1 mm 铺铜减 60 个障碍物 < 5 s）。仍缺：填充策略层（`zone` / `trace` / `via` / pad / `keepout` / 板框 / `rules` 组装、热焊盘辐条、同 net 与异 net 分类）、最小线宽与孤岛、空间索引、以及 F15 的 Gerber/Excellon 写出器。

**为什么现在做**：F15 的带 `zone` 板（参考工程 `charger-buck` 的 GND 铺铜）直接卡在这里；F48 的 DRC 子集也需要同一批距离/相交/offset 原语，不能各写一套。

**要做的事**：

1. **建包**：`packages/geom`（工作名），无 `Bun.*`、无 `process.env`、无外部运行时依赖；Node ≥ 20 与浏览器都能跑（[ADR-0137](adr/process/0137-implementation-stack-and-agent-entry.md)）。
2. **图元**：point / segment / polyline / polygon / rect / roundrect / oval / circle / capsule；坐标一律整数纳米，角度整数毫度。
3. **运算**：point-in-polygon、distance、area、contour orientation、offset、union、difference、intersection。只做封闭多边形；**结果用互不重叠的凸片覆盖表达，不引入内环**（孔洞是围成环的若干片，按 2026-10-26b 附录）。
4. **鲁棒性**：合并重合点、处理共线边、拒绝未解决的自交；退化输入返回诊断，不返回"差不多"的形状。
5. **确定性**：轮廓与顶点排序有固定规则；浮点只在内部使用，边界量化回纳米；同一输入两次结果逐字节相同。
6. **填充策略层**：从 `zone` / `trace` / `via` / 封装 pad / `keepout` / `outline` / `rules` 构造障碍与热焊盘，调用内核得到填充轮廓；策略层不塞进内核。
7. **测试**：面积守恒、`A\B + A∩B == A`、offset 往返、孔洞方向、退化边、随机小多边形对拍（与慢速参考实现或解析答案）。

**不好做的，先记在这里**（不在第一版里假装解决）：

| 问题 | 先怎么处理 |
|---|---|
| 近重合边 / 共线重叠 / 仅接触的布尔 | 输入规范化 + 精确方向判定；解决不了就报错，不静默合并 |
| rect/roundrect/oval/capsule 的 clearance offset | 优先解析 offset；自由多边形才走通用 polygon offset |
| 孔洞与 Gerber 轮廓朝向 | 固定外环/内环朝向，单独测；不靠 viewer 看起来对 |
| thermal relief（辐条数量、宽度、角度、solid/thermal） | 先按 `rules.thermal` 的显式策略实现；不支持的组合报错 |
| `rules.min_width` / 细颈 / 孤岛 | 作为独立的窄化与孤岛移除步骤；不静默删铜，必须能报告 |
| 板边、cutout、keepout 的裁剪顺序 | 先裁板框，再减 keepout / cutout；区域被裁空要报诊断 |
| 同层多 zone、不同 net 重叠 | 先报检查错误，不定义隐式优先级；同 net 才允许合并 |
| 通孔 / via 的分层障碍与 annular ring | 按 pad 类型与 via span 逐层构造，不用钻孔直径代替铜环 |
| 同 net 铜箔与不同 net 铜箔 | 先按 net 分类；同 net 连接，不同 net 清空 + 重画，绝不从填充反推连通性 |
| 浮点到整数纳米的舍入翻转 | 边界量化规则写进文档；避免平台相关数学；用固定夹具锁住 |
| 大板性能 | 先做 bounding-box 索引；只对实测板优化，不提前上复杂空间结构 |
| 正确性 oracle | 先断言面积 / 孔数 / 轮廓数 / 层归属；KiCad 对照只是可选项，不是门禁 |
| 缓存 | 默认不缓存；若加，必须可删除、可重算、按输入键控，绝不进 IR / 哈希 |

**不做**：圆弧 / Bezier / 自定义 pad / HDI 微孔；通用 CAD 内核；自动布局布线；CAM 级 DFM 判定；把填充结果写进 `pcb` IR 或工程哈希。

**验收**：

- `bun test packages/geom` 覆盖图元、布尔、offset、孔洞、退化输入与确定性；不使用外部几何库。
- 参考工程 `charger-buck` 的 GND zone 能算出确定轮廓；面积、孔数、轮廓数有固定期望值。**已完成**：`packages/cli/test/export.test.ts` 钉住 1672.0632 mm²、629 片、7 个内层过孔闪光，并从写出的 Gerber 反读回同一面积（写入即投影，不是重算）。
- 两次运行结果相同；同一输入换顶点起点/顺序后，规范化结果相同。
- 不支持的图元（圆弧、自交多边形）返回明确诊断，不产生近似铜箔。
- `bun run typecheck`、`bun test` 全绿；`packages/geom` 无 `Bun.*` / `process.env`。

**注意**：

- **内核不认 net**：net、clearance、thermal 是填充策略层的事；内核只认形状。
- **不要为了 Gerber 把内核做成 Gerber 专用**：F48 的 DRC、未来的 PCB 渲染都要复用。
- **不要先写缓存**：先证明能算、算得对；缓存是性能决定，不是正确性决定。
- **不要用 viewer 截图当验收**：Gerber 是图像，正确性靠面积/拓扑/层归属断言。

---

## F51. `check:links` 只扫 Markdown，代码与契约里的 `ADR-NNNN` 引用没有门禁（2026-10-28）

**现状**：`bun run check:links` 的取数入口是 `listMarkdownFiles`，所以它只管 `.md`。语料换号（`0001`–`0056` → `0100`–`0140`）之后，带引用的非 Markdown 文件全靠一次性的 `grep` 扫尾：本轮扫出 **8 处**写着退役号的引用，全部手工修掉——`examples/reference-project/project.toml` 两处（`ADR-0056`、`ADR-0033 D5`）、6 个 `.teda` 文件的注释（`ADR-0030`、`ADR-0039`、`ADR-0044`）、`.github/workflows/*.yml` 两处（`ADR-0018`）、`.gitignore`（`ADR-0031`）、`NOTICE` 三处（`ADR-0005`、`ADR-0014`、`ADR-0015`）。**没有任何门禁会在下次换号时抓到它们**。

**要做的事**：把"一个号要么存在、要么落在索引声明的预留表里"这条规则（门禁第 2 条）扩展到代码与契约。取数面是现成的：`git ls-files` 里的 `*.ts` / `*.json` / `*.toml` / `*.yml` / `*.teda` 以及 `NOTICE`，实测 189 个文件、约 2.1k 处 `ADR-NNNN`。范围要先定死再写代码：

1. **只查存在性**，不查决策号。`ADR-NNNN D7` 的 `D7` 在代码注释里没有稳定含义（记录会被合并、决策会被重编号），按标题匹配又只能做一次；存在性已经能挡住"指向已退役号"这一类。
2. **跳过 `scripts/check-links.test.ts`**：那里的 `ADR-NNNN` 是夹具（`0006`、`0099` 之类本来就不存在）。
3. **跳过 `docs/adr/**` 与 `docs/trial-run/**` 里的非 Markdown 文件**（目前没有），理由同历史记录不追改。
4. 报错文案与 Markdown 侧一致：`<file>:<line>: ADR-NNNN does not exist`。

**涉及文件**：`scripts/check-links.ts`（新增一个非 Markdown 取数函数 + 一条规则）、`scripts/check-links.test.ts`（正反例：代码注释里的退役号要报错、预留号通过、夹具文件不报）。

**验收**：
- 在 `NOTICE` 里塞回 `ADR-0005`，`bun run check:links` 非零退出；改回 `ADR-0120` 即通过。
- 在 `packages/parser/src/version.ts` 的注释里写 `ADR-0099`（未预留），非零退出；写 `ADR-0141` 并且索引预留表声明了它，通过。
- 全仓 `git ls-files` 的 `.ts` / `.json` / `.toml` / `.yml` / `.teda` / `NOTICE` 扫描后零报错（现状已干净，门禁应当保持干净）。

**注意**：
- **不要顺手查决策号**：`D<n>` 在代码里没有稳定锚点，做了也会立刻过时（理由同上第 1 条）。
- **不要把 `docs/trial-run/**` 拉进来**：那是历史记录，过期指针由门禁报 warning、不修。
- 这条门禁一旦上线，"换号后靠 grep 扫尾"就不再是流程的一部分——**换号脚本自己也该跑它**。

## F52. 命令行重锚定打印页的连线（`texteda view-rewire`）——插件只写 `place` 之后的收尾动作（2026-10-29）

**现状**：`packages/core/src/view/reroute.ts` 已有 `reanchorWire` / `nearestOnPath` / `reseatOnNet`（重锚：保持段数与轴向序列，不寻路，见 [ADR-0141](adr/view/0141-the-review-app-has-four-modes.md) D5），但**只有评审 app 的 Apply 路径能调用**（`packages/cli/src/layout.ts` 的 `applyLayout` → `commitPlan`）。命令行没有对应动作：现有命令是 `init` / `id` / `renumber` / `compile` / `check` / `netlist` / `bom` / `view-metrics` / `review` / `ir` / `export` / `lib`。

**为什么现在要**：插件形态下，人的拖动只写 `place` 行，连线留给 agent 或命令行（[ADR-0142](adr/view/0142-the-review-app-is-a-plugin-of-the-agent-workbench.md) D3）。拖完之后的收尾动作必须有一条命令行，否则 agent 只能手改 `wire` 行。

**要做的事**：新增 `texteda view-rewire <工程目录> <board>/<page>`：读当前打印页，按当前 `place` 把所有 `wire` 重锚定（形状不变），以规范形式写回，并报告改了哪几条 wire、哪些 wire 仍然不合法。

**涉及文件**：`packages/cli/src/rewire.ts`（新）、`packages/cli/scripts/texteda.ts`（挂命令）、`packages/core/src/view/reroute.ts`（必要时导出批量入口）。

**验收**：
- 在 `examples/reference-project` 的 `views/charger-buck/buck-5v.view.teda` 上跑一次：`wire` 条数与每条的段数不变，形状仍轴对齐；`bun run fmt:teda --check .` 通过。
- 先改一个 `place` 行再跑：`texteda check` 不再报 `view.wire-diagonal` / `view.wire-crosses-pin`。
- 幂等：连跑两次，第二次文件字节不变。
- 不碰 `design/**`：跑完工程哈希不变（打印页是 advisory，见 [ADR-0134](adr/view/0134-the-view-layer-is-a-drawing.md) D5）。

**注意**：
- **不要做成自动布线**：重锚定保持形状，绕障碍寻路不做（ADR-0141 D5）。
- **不要顺手改 `wire` 的语义**：只改弯点坐标，端点由 pin 引用推导。

## F53. 插件包：把评审 app 的两半接到 agent 工作台（ADR-0142 的落地）

**现状**：评审 app 已经就是"宿主侧 + 客户端侧"——`packages/cli/src/review.ts`（进程：回答关于工程的问题、写文件）与 `packages/viewer/src/client.ts`（画参考渲染器的 SVG、高亮、按身份拾取）。但今天它是一个独立进程加一个独立页面，不是任何宿主的插件。

**前提**：[ADR-0142](adr/view/0142-the-review-app-is-a-plugin-of-the-agent-workbench.md) 被接受（**当前是 Proposed**）。

**要做的事**：

1. **宿主侧**：在宿主进程里注册工具（agent 可调）与路由（客户端可取模型与 SVG）；写入一律走 core 的规范写路径。
2. **客户端侧**：把 `packages/viewer` 的画布挂进宿主的页面扩展点；没有页面的会话（终端 profile、ACP、pi 的任何模式）只带宿主侧。
3. **次序**：先做 agent 侧（工具 + 命令，任何宿主都能用），再做图（只在有页面的会话里）。宿主形态见 `docs/plugin-hosts.md`。

**开放问题**（做的时候要定）：插件包放本仓还是独立仓；宿主 SDK 是 peer 依赖还是只做示例；第一个宿主是谁。

**验收**：

- 在目标宿主里装上插件，agent 能调用 `texteda check` 一类的动词并拿到诊断。
- 人能看到打印页并拖动一个符号，`place` 行被改写；连线变旧由 `texteda check` 报出来，而不是被插件悄悄改掉。
- 插件不把任何宿主依赖带进 core（不变量 20），`packages/core` 仍然不依赖任何宿主 SDK。

## F54. 拖动会丢掉未保存的文本编辑：`/api/layout` 只认磁盘上的那一版（2026-10-29）

**现状**：`POST /api/layout` 的请求体只有 `{board, page, places, commit}`；`planLayout` 直接 `readFileSync` 打印页文件（`packages/cli/src/layout.ts`），所以拖动是在**磁盘上的那一版**上算的，`commitPlan` 写回的也是那一版。结果：在 `edit` 模式里改了文本但没保存，再拖一个符号并 Apply，那些文本改动被覆盖掉——这是一条数据丢失路径。

**为什么现在要**：插件形态下拖动是人的主要手势（[ADR-0142](adr/view/0142-the-review-app-is-a-plugin-of-the-agent-workbench.md) D3），而客户端可能同时持有草稿；这个缺陷在今天的 app 里已经存在。

**要做的事**：布局路由接受当前草稿文本（`text`），`planLayout` 与 `commitPlan` 以草稿为基准；没有草稿时行为完全不变。

**涉及文件**：`packages/cli/src/layout.ts`（`planLayout` / `commitPlan` 接草稿）、`packages/cli/src/review.ts`（路由读 `text`）、`packages/viewer/src/client.ts`（有草稿时带上）。

**验收**：

- 在 `edit` 模式改一行文本（不保存），切到 `layout` 拖一个符号并 Apply：改过的文本仍在文件里，符号位置也更新了。
- 不带草稿的请求行为不变（`packages/cli/test/review-layout.test.ts` 现有用例全绿）。
- 写回仍是规范形式：`bun run fmt:teda --check .` 通过。

## F55. 打印页的动词收成 `texteda view <子命令>`（2026-10-29）

**现状**：打印页作用域的动词散在顶层：`texteda view-metrics <工程目录> <board>/<page>` 是唯一一个；接线收尾（F52 的 `view-rewire`）和"看一眼"（渲染 SVG）落地后会是另外两个。动词名用连字符、工具名用下划线，同一个东西两种拼法。

**为什么现在做**：[ADR-0143](adr/process/0143-the-agent-surface-is-a-set-of-verbs.md) D6 决定打印页的动词归到一个名词底下（`view` 是语言自己的描述类型名，见 `spec/schematic-view.md`），并且动词名要和工具名同形（`texteda view metrics` ↔ `texteda_view_metrics`）。工具清单还没落地，此刻改名只有 32 处引用；等清单定了再改，两边都要动。

**要做的事**：

1. `texteda view-metrics` → `texteda view metrics`（**破坏性改名**：命令行的表面没有版本号线，所以要同步改文档与 skill，并在提交说明里写明）。
2. 新增 `texteda view rewire`（F52 的实现）与 `texteda view render <工程目录> <board>/<page> [--out <文件>]`（出 SVG，供 agent "看一眼"）。
3. 顶层保留 `review`（app，页面 + 板）、`check`（全项目）、`ir`、`compile`；先例是 `texteda export gerbers`。

**涉及文件**：`packages/cli/scripts/texteda.ts`（二级分发）、`packages/cli/src/view-metrics.ts`（改文件名与命令名）、`packages/cli/src/index.ts`（导出表）、`packages/cli/test/view-metrics.test.ts`、`spec/schematic-view.md`、`README.md`、`README_cn.md`、`docs/skills/draw-print-page.md`、`docs/guides/**`、`AGENTS.md` §10 的命令表、`docs/backlog.md`。

**验收**：

- `texteda view metrics ./examples/reference-project charger-buck/buck-5v` 的输出与改名前逐字节相同；`texteda view-metrics` 不再被接受（报 `cli.bad-usage` 并提示新名字）。
- `texteda view render` 产出的 SVG 与 app 画的同一页一致（同一渲染器、同一 IR）。
- `bun run fmt:teda --check .`、`bun run check:links`、`bun test` 全绿；全仓 `grep -rn "view-metrics"` 只剩本条与 ADR 里的历史描述。

**注意**：命名纪律——`view` 是打印页（S1）、`sch` 是原理图（S0）、`pcb` 是板（B0），三个词不互相撞；app 的 scope 名 `sch` / `pcb` 指同两件事。

## F56. 动词返回"值"，并把清单做成机器可读（ADR-0143 的落地）

**现状**：`runBom` / `runCompile` / `runViewMetrics` / `runIr` 把结果**直接打印**并返回退出码，外部拿不到值；只有 `check` 是干净形态（`checkProject` / `analyzeProject` 纯函数）。因此宿主工具注册表拿不到结构化结果（[ADR-0143](adr/process/0143-the-agent-surface-is-a-set-of-verbs.md) D2）。

**要做的事**：

1. 每个动词拆成 `build*(options) → 值`（`packages/cli/src/**`），打印留在 `packages/cli/scripts/texteda.ts`；CLI 的行为与输出**逐字节不变**。
2. 新增 `texteda tools --json`：打印可作为工具暴露的动词清单（名字、描述、参数），让没写适配器的宿主也能自己接（ADR-0143 D7）。

**涉及文件**：`packages/cli/src/{bom,compile,view-metrics,ir,id,renumber,export}.ts`、`packages/cli/src/tools.ts`（新，清单）、`packages/cli/scripts/texteda.ts`。

**验收**：

- 每个动词的 `build*` 返回值与同名 CLI 动词 `--json` 的输出**逐字段相等**（子进程对比，写在 `packages/cli/test/tools.test.ts`）。
- `texteda tools --json` 的 dump 与内存清单一致；名字唯一、描述非空、参数是扁平的（`type` / `required` / `description`）。
- CLI 现有输出零变化：`bun test` 全绿，`bun run cases:check` 4/4。
