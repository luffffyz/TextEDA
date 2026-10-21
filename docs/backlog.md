# 待办（backlog）

工作项清单，不进 `AGENTS.md` §11（那里是**待定问题**：需要人拍板的取舍）。每条写清：现状、要做的事、涉及文件、验收、注意事项。

编号只增不减：做掉的条目从清单里移除，结论留在对应的 ADR 里。**F2（自研参考渲染器）已关闭** → `docs/adr/0014-reference-renderer.md`（符号与封装渲染 + `bun run preview` 已落地；剩下的 sch 渲染另开 F3）。**F7（诊断错误码注册表）已关闭** → `docs/adr/0016-diagnostic-error-codes.md`（`域.slug` 码表 + 生成的 `docs/error-codes.md` + 双向完整性检查已落地）。

---

## F1. 校准自建封装的几何（footprint 校准）

**现状**：`examples/reference-project/footprints/project/` 下的 16 个封装是**通用 land pattern**——焊盘尺寸与间距按 IPC 通用推荐取整，不是各料号 datasheet 的精确 land pattern（见 `docs/adr/0013-reference-project-self-built-libraries.md` decision 5）。每个文件的 `description` 里都写了 `generic land pattern` 作为标记。

**为什么现在不做**：库级闭环（`bun run lib:verify`：引用可解析、canonical、契约通过、KiCad 能读能渲染、合并板 DRC 0 违规）已经成立，几何精度不影响链路验证。参考工程的价值是"可复现的样本"，不是"厂商级库"。

**要做的事**（逐个封装，从器件 datasheet 抄）：

1. 抄 **body 尺寸**（F.Fab 外形）、**焊盘尺寸与中心距**、**courtyard**、**丝印**；丝印别压到焊盘上（合并板 DRC 会报）。
2. 改 `description`，去掉 `generic land pattern`，写上真实封装代号与 body 尺寸。
3. 有 3D 模型的话补 `model` 行（项目相对路径的 STEP/WRL，[ADR-0010](adr/0010-footprint-and-3d-model-ownership.md) 允许）。
4. 改完重算库内容哈希并同步两处：
   ```bash
   cd examples/reference-project && bun run ../../scripts/libhash.ts symbols/project footprints/project
   # → 写回 project.toml 的 [libs.project].content_hash
   # → 同步 tests/schemas/valid/project/reference-project.json 的 libs[0].content_hash
   ```
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

**现状**：参考渲染器只画符号与封装（[ADR-0014](adr/0014-reference-renderer.md)）：`packages/renderer` 的 `renderSymbol` / `renderFootprint` 已落地，`bun run preview symbol|footprint|component` 能出图。**原理图（sch）还没有渲染器**——`AGENTS.md` §1「是」里第一条写的是"一个参考渲染器（先 sch 的 SVG）"，sch 是第一阶段的主对象（§1.1 P0/P1），所以这是渲染器剩下的那块。

**为什么现在做**：

- **sch 的错误只有看图才发现**：ERC 能抓悬空引脚、短路、电源域冲突，抓不到"两个 net 的标签压在一起"、"引脚名糊成一片"、"连线穿过符号"、"页面元素越界"。这些在 P0 的 ERC 里全是绿的。
- **符号与封装的经验可以直接复用**：中间表示（绘图指令列表）、坐标约定（整数纳米）、确定性（字节可复现）、round-trip 的"语义投影"两端对比，这四样已经定型了（[ADR-0014](adr/0014-reference-renderer.md)），sch 只是多一种图元与一层布局。

**要做的事**：

1. `packages/renderer` 加 `renderSchematic(ir: SchematicIr): SvgDoc`：
   - 页内元素按 IR 的坐标画：器件（用它的符号视图摆位）、导线、net 标签、页面端口、页内电源符号、文本注释；
   - 器件的引脚连接点要与符号渲染器的坐标**完全一致**（同一份 `renderSymbol` 的引脚几何，不能各画各的）；
   - 走线画成"从引脚连接点出发的折线"，拐点用 IR 里的坐标，不做自动布线。
2. 预览命令扩一档：`bun run preview schematic <board_id> [--page <page_id>]`。
3. **可读性检查**（`AGENTS.md` §6："可读性检查自动化：文字重叠、线压引脚、标签碰撞、越界、连线穿过符号"）至少先做**越界**与**连线穿过符号**两项，在渲染时算出来报出来。
4. round-trip：sch 的语义投影两端对比（跟符号/封装同一口径，见 [ADR-0014](adr/0014-reference-renderer.md) decision 5）。注意 sch 里有些字段图形上表达不出来（如 net 的电气属性），投影只留能反解的部分，并在代码注释里写清哪些不可反解。
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

**现状**：仓库从私有转公开（[ADR-0015](adr/0015-licensing-and-open-standard.md)），项目定位是**标准提案**：让别人照着 `spec/` 与 `schemas/` 实现自己的 parser / 校验器 / 渲染器。当前所有规范知识都沉淀在 `packages/**` 的源码里——读者容易把"实现里怎么做的"当成"规范要求什么"，这是标准失败最常见的方式。

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
- 结论回写 [ADR-0015](adr/0015-licensing-and-open-standard.md) decision 4.3。

**注意**：

- 这不是"再写一遍实现"——目的是**发现规范漏洞**，实现只写到能暴露漏洞的深度。发现不了歧义就说明用例覆盖不足。
- 不要让第三方实现反过来污染参考实现：发现不一致时先判断是"实现错了"还是"规范没写清"，两者的修法不同（前者改 `packages/`，后者改 `spec/`）。
- 别把它做成"重构 `packages/`"的借口。

---

## F5. 包发布形式与商标（延后，等生态信号）

**现状**：七个包（根 + `packages/ir` / `parser` / `exporter` / `renderer` / `core` / `cli`）都是 `"private": true`、版本 `0.0.0`，未发布到任何 registry。[ADR-0015](adr/0015-licensing-and-open-standard.md) decision 7 明确延后。

**为什么现在不做**：还没有外部消费者；当前包是 TS 源码（走 git 依赖即可），发布到 npm 只会在没有真实需求时产生"看起来有生态"的假象。

**要做的事（等有信号再做）**：

1. **发布形式**：候选是 npm（`@texteda/*`）、纯 git 依赖、或者只发布 `schemas/ir/**` 与 conformance 语料。判断依据是"第三方实现者实际需要什么"——先看有没有人 clone 了仓库并自己写实现。
2. **版本号**：发布前把 `0.0.0` 换成真实版本；`format` 与 `ir_version` 独立版本（[ADR-0008](adr/0008-ir-shard-identity-and-hash.md)）不变，发布时把 `ir_version` 打进包元数据。
3. **商标**：等"符合 textEDA"开始被第三方自称时，再评估注册 `textEDA` 商标与写商标使用指引（Apache-2.0 §6 不授予商标许可，[ADR-0015](adr/0015-licensing-and-open-standard.md) decision 5）。

**涉及**：`packages/*/package.json`、根 `package.json`、新增 `TRADEMARKS.md`（若注册）。

**验收**：

- 第三方能按文档在一条命令内把 `@texteda/ir` 或 schema 装进自己的工程。
- 发布产物里的 `ir_version` 与仓库一致。

**注意**：

- 发布不等于放弃契约层开放：发布的是实现，契约层照样公开（[ADR-0015](adr/0015-licensing-and-open-standard.md) 不变量 19）。
- 别在还没有用户时先做品牌设计、文档站、CI 徽章那一套——那是"看起来在推进"的自我安慰。

---

## F6. 仓库可见性切 public（版权清理已完成，待切开关）

**现状**：GitHub 仓库 `luffffyz/textEDA` **仍是私有**。许可与开放承诺已按 [ADR-0015](adr/0015-licensing-and-open-standard.md) 落定（Apache-2.0 + 契约层永久开源）。**版权前置已清完**（2026-10-21）：

- 5 个厂商 datasheet PDF（约 15 MB：TI `bq24610` / `tps7a20`、WCH `CH32V307DS0`、四川索斯特 `SST-3225-8M-12PF-10PPM`、硕方精密 `TS-1187`）已从索引移除并加进 `.gitignore`；
- 这些 PDF 曾在首个提交里进过历史，已用 `git filter-branch --index-filter` **重写历史清除**，并 gc 掉旧对象；
- `NOTICE` 补了"厂商文档不随仓库分发"声明；`examples/reference-project/docs/` 下的说明与 `mcu-board-components.md` 的表已改成"自行下载到本地"。

**还剩下的（都是人工操作）**：

1. ~~扫一遍 `docs/trial-run/`、README、示例工程里的内部链接、主机名、密钥、真实项目代号~~ **已完成**（2026-10-21，审计结论见下）。
2. 把 GitHub 可见性切 public。
3. 同步 README 顶部的措辞（当前写的是"仍为私有"）。

**审计结论（2026-10-21，`bun run check:public`）**：

- **历史干净**：13 个可达提交、325 个曾被跟踪的路径，**零个 PDF**；`git fsck --unreachable` 无残留；远端 `main` 与本地逐 commit 一致，GitHub 上没有旧 ref、tag 或 PR 引用指向重写前的历史（`git rev-list --objects origin/main | grep -i pdf` 为空）。
- **无凭据、无维护者痕迹**：私钥 / GitHub / AWS / Slack token / API key 赋值均无命中；无邮箱；无 `/home/<user>`、`/Users/<user>`、`C:\Users` 绝对路径（`/tmp/texteda-*` 是通用临时目录，不泄露身份）。
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

- **顺序不能反**：先清历史再切 public。反过来就要二次重写，且届时可能已有 fork。
- 以后再往 `docs/` 里放厂商文档，先想一次"这是不是受版权保护的材料"——默认不入库。
- F1（校准封装几何）依赖 datasheet 原文，按"自行下载到本地"继续，**不要因此把原文塞回仓库**。

---

## F8. 引脚归属下沉到 IR schema

**现状**：`AGENTS.md` §4.2 要求显式区分三种"没连"——floating（漏连，错误）/ no_connect（有意悬空）/ dnp（不贴）；§4.4 绑定规则 2 说每个 sch 器件的 pin 必须能映射到封装 pad，或显式 no_connect / dnp。**这些目前只是检查器的规则**，IR schema 不要求，因此每个实现都得自己写一遍，第三方实现很容易漏。cohdl 的做法相反：把"引脚连接义务"做成类型系统的穷尽检查（unresolved pin 是编译错误，不是 DRC 警告）。

**为什么现在做**：sch 的 IR 还没写（§1.1 P0），schema 现在改成本最低。而且这是"第三方实现只要过 schema 就自动满足"的那类约束——**对标准提案，schema 承担的义务越多，第三方实现越少出错**。

**要做的事**：

1. 给每个 pin 实例一个**归属状态**：`net` 成员 | `no_connect` | `dnp`（三态；**缺省即报错**，不允许"未提及"）。
2. schema 表达两条不变量：
   - 每个 `(component_id, pin_number)` 恰好一个归属；
   - 出现在 net 成员里的 pin 不得同时标 no_connect / dnp。
3. **floating 降级为检查器的派生诊断**（由归属缺失推出），不再是独立标记。
4. 封装侧：pin 号集合与 pad 号集合的一致性（`lib:verify` 已有）下沉到 schema 能表达的部分。
5. 补 conformance 正反例（`tests/schemas/`）。

**涉及**：`schemas/ir/v0.1/**`、`packages/ir/src/**`、`packages/parser/src/**`（sch 解析器）、`tests/schemas/**`、ADR（并入 P0 的 sch ADR 或单开一条）。

**验收**：

- 少写一个 pin 归属 → schema 校验失败并给出位置。
- 一个 pin 既属于 net 又标 no_connect → 报错。
- 第三方实现只做 schema 校验 + 展开，就能保证"没有悬空引脚"。

**注意**：

- **不要因此出现第二个真源**：net 成员表是唯一真相，pin 侧只用引用表达归属，不要把成员复制进 pin 记录。
- dnp 与 no_connect 是不同的东西：no_connect 是"这个引脚不接"，dnp 是"这个器件不贴"（§4.2、[ADR-0002](adr/0002-board-pages-and-bom.md) decision：变体不影响 ERC 结果）。**别合并。**

---

## F9. 事实层禁止表达式 / 生成器在语言之外（写成 ADR）

**现状**：这条线现在散落在 §5.1（"一行一个事实"、"禁止需要跨行阅读的结构"）与 §5.3（"生成器/循环 v0.1 不支持……后续生成层输出表"），**没有一份文件正面声明"事实层不得出现表达式"**。而它恰是 textEDA 对 tscircuit / cohdl 的核心差异：

- tscircuit：JSX 属性是任意表达式（`resistance={compute()}`），同一块板写法不唯一，canonical 化极难（只有 Circuit JSON 的 schema，没有源码 canonical 形式）；
- cohdl：`fn` / 泛型 / 循环在语言内，撞到同一堵墙，于是被迫写 `cohdl fmt --check`；
- textEDA：值是字面量（`3.3V`、`100nF`、`±1%`），事实用表，**生成发生在语言之外，产物是表**。

**为什么现在做**：§11 Q1（表格 vs 链式）与 Q2（表达式/参数化程度）仍是**待定问题**。定得太早会被实现细节绑架，定得太晚会破坏已有语法。这条 ADR 的作用是**把已经生效的事实写成原则，并给出"什么情况下允许修订"的判据**——不是关闭 Q1/Q2。

**根本理由（写进 ADR 的"为什么"）**：**人工评审不可绕过**，评审者是硬件工程师，所以语言的读者模型决定语法。事实层的每一行必须能被评审者**读一行就判对错**；一旦值是表达式，评审就从"读"退化成"验算"（要心算或纸面重算，还要追依赖链），评审成本随行数上升，表达式的边际收益（对程序员）远小于边际成本（对评审者）。因此：

- **生成器在语言之外、产物是表**——让评审永远落在**表**上，而不是落在**程序**上。否则描述只能由程序生成时，评审对象就变成"生成器 + 描述"，等于把信任转移给了一个没人读得动的程序。
- 事实层每个 token 都要能回答"**它描述了哪个硬件事实**"；需要读者理解程序语义才能回答的 token 就是噪声。

**要做的事**：

1. 写 `docs/adr/0017-fact-layer-no-expressions.md`，事实层三原则：
   - 事实层的值只能是**字面量**（含单位），不得是表达式；
   - 事实层不得有控制流、循环、条件；
   - **生成器在语言之外，产物是表**（§5.3 已有结论）。
2. 写清可检查的判据：**源码里出现的每个 token，都必须能回答"它描述了哪个硬件事实"**。分界线不是"有没有符号"，而是"**这个符号要不需要读者理解运算语义**"：
   - `±1%`、`+5%`、`100nF`、`3.3V` 是**终值**——符号本身就是事实，不需要理解运算；
   - `10k * 2`、`{divider(10k, 4.7k)}` 是**过程**——读者要重算才知道这行描述了什么。
3. 明确**组合层**（module 定义/实例化 + 端口契约）与**值层**（单位 / `±` / `%`）允许结构化记法——符号不是一律禁止，禁的是"事实层的程序化"。与 §5.3「表格的边界」一致。
4. 写清**修订条件**：§10 十用例里"20 路电源域"若证明表宽到不可用（§5.3 已预警宽行风险），才允许引入**受限表达式**（仅常量算术，不允许函数调用与控制流）。
5. 同步 `AGENTS.md` §5 与 §11：Q1/Q2 从"纯待定"改为"有原则 + 有修订条件"，但**仍保留待定状态**直到十用例跑完。

**涉及**：`docs/adr/0017-fact-layer-no-expressions.md`、`AGENTS.md` §5.1/§5.3/§11、`teda.md`、`spec/**`。

**验收**：

- 规范里能一句话说清"哪些层可以有符号、哪些层不可以"。
- 十用例跑完后，这条 ADR 的修订条件有明确触发判据，而不是"感觉不好就改"。

**注意**：

- 这条 ADR **不关掉** §11 Q1/Q2：它给边界，不给最终答案。关掉待定问题要等十用例数据。
- 别写成"我们和 tscircuit 不一样"的宣言——写成可检查的规则。

---

## F10. 库生态的入场券：库包规范与分发（registry 前置）

**现状**：[ADR-0015](adr/0015-licensing-and-open-standard.md) 承诺"让别人围绕它建工具"。但**语言的标准不产生生态**——cohdl 的生态靠 `registry.cohdl.org`（命名空间、包、精确版本钉死、`cohdl search`）加 LSP 加 VS Code 扩展加 Explorer 应用。textEDA 侧还没有任何"分发"概念：`components/` / `symbols/` / `footprints/` 只存在于本地工程，库引用靠 `project.toml` 的 `[libs.<name>]` 指向本地路径或 `project:` 库（[ADR-0010](adr/0010-footprint-and-3d-model-ownership.md) 的内容哈希锚点），**没有跨工程、跨组织的库获取方式**。

**为什么现在做**：这是"别人建工具"的真正入口——第三方要做 KiCad 侧 / PLM 侧 / CI 侧工具，第一件事是"我从哪拿封装库"。库规范定不下来，生态就是空谈。

**要做的事**（先只做规范，不做服务）：

1. 定**库包格式与边界**：一个库包 = 若干 `.teda`（器件 / 符号 / 封装）+ `library.toml`（元数据、版本、内容哈希、依赖）。格式与契约层**同构**（同源语法、同一套诊断）。
2. 定**版本与锚点**：库版本怎么标（内容哈希 vs 语义版本）、怎么钉死（`project.toml` 的 `[libs]` 里已有 `content_hash` 雏形）、怎么升级。
3. 定**获取方式的抽象**：v0.1 只要求"本地路径 + 内容哈希"可解析，**不实现 registry 服务**；但要留出 `source` / `rev` 字段（§9 已列），让未来的 registry 只是这个字段的一个取值。
4. 定**第三方库的要求**：库文件必须过 schema、必须能导出成 KiCad、必须能过 `lib:verify`（[ADR-0013](adr/0013-reference-project-self-built-libraries.md)）；不合规不收。
5. 复用 F7 的错误码与 F8 的 schema 义务——**库是契约层的延伸，不是另一个标准**。

**涉及**：`spec/`（库包规范）、`schemas/ir/v0.1/**`（库 manifest）、`AGENTS.md` §9（`[libs]` 键的最终形态）、ADR（并入 [ADR-0011](adr/0011-library-format-and-footprint-ir.md) 的补充或单开）、`examples/reference-project/project.toml`（样例）。

**验收**：

- 一个第三方库包能被解析、校验、导出，且 `content_hash` 可复现。
- 库规范里没有"只能官方提供"的要求。

**注意**：

- **先规范后服务**：不要一上来就写 registry（那是运维与法务问题，cohdl 走了很多年）。先把"库包长什么样、怎么钉版本、怎么验证"定死。
- 库生态的成败取决于**库的覆盖率与质量**，不取决于注册表的 UI。优先把"自建库能自动生成"（[ADR-0010](adr/0010-footprint-and-3d-model-ownership.md) 的 agent 生成路线）做扎实。
- 与不变量 19 对齐：库规范属契约层，永久开放。

---

## F11. 源码位置（span）机制：诊断要能指到行列

**现状**：`AGENTS.md` §10 要求"每条诊断含文件、行列、期望/实际、修复建议"。但 textEDA 是"源码 → IR"的单向投影（[ADR-0004](adr/0004-ir-representation.md) / [ADR-0008](adr/0008-ir-shard-identity-and-hash.md)），**IR 只含语义、不含源位置**——span 在投影里丢了。两个后果：

1. 语义检查器与 schema 校验的诊断只能指到"哪个文件"，指不到"哪一行哪一列"；
2. schema 校验（Ajv）报的是 **IR 上的 JSON Pointer**（`/pins/2`），评审者看不懂——他手里是 `.teda` 源文件，不是 IR。

对照：cohdl 的 IR 就是 AST，位置天生带着（它的包级诊断直接锚在 `cohdl.toml` 的行上）；tscircuit 同理。**这是 textEDA 独有的难点**——它刻意让 IR 与源分离（§3 的 S0/S1 分层），代价就是位置要另外解决。

**为什么现在做**：F7 要求诊断带位置，F8 会把一部分检查前移进 schema 校验——**schema 错误的位置就是 IR 路径**，没有 span 就只能给路径。agent 要自动改文件，**没有行列就没法做定点修改**，repair loop 无从下手。

**关键约束（这里有个真冲突）**：§10 明写"打乱行序、换单位写法、换键序的同一描述，编译出的 IR 必须与 canonical 源**字节相同**"。**span 一旦进 IR，这条验收就挂**（行序一变字节就变）。所以 **span 不能进 IR**——这是 [ADR-0004](adr/0004-ir-representation.md)「IR 不复制源文本」的延伸。

**要做的事**：

1. **定位置模型**（写进 spec 与 ADR）：
   - `file`（相对工程根的路径）、`line`、`col`；
   - **列号的字符语义要写死**：源文件里可能有中文与 `Ω`、`±`——建议同时给 **Unicode 标量列号** 与 **字节偏移**；
   - `span` 粒度：token 级还是记录级？一条 IR 记录（如 net 的成员列表）对应源里多行 → 建议**记录级**（指向该记录首 token），必要时给 `end`。
2. **span 不进 IR**，两种落地方式选一（建议 A）：
   - **A（推荐）**：parse 阶段产出 IR 的同时记录 **IR 路径 → 源 span** 映射（随诊断使用，解析结束即丢，不落盘）；
   - **B**：落盘一张 span 表（`dist/ir/<shard>.spans.json`），事后可重算定位（支持"IR 已有、源已改"，但多一份产物要管一致性）。
3. **IR 路径 → 源 span 的反向索引**（给 Ajv 用）：Ajv 的 `instancePath` 是 IR 数组下标，要经索引查到 span。这要求解析器的内部结构在编译成 IR 之前保留来源路径，**编译时剥掉**。
4. **跨文件引用**的诊断要同时给**引用点**（`location`）与**定义点**（`related`）——sch 引用 `components/xxx.teda` 时两处都要能指。
5. **canonical 与位置不要混用**：位置基于**原文件**；`fmt` 之后行号会变。
6. 位置稳定性测试：同一份源两次解析位置一致；打乱行序后 IR 字节不变（§10 验收仍绿）而诊断位置指向新行号。

**涉及**：`packages/parser/src/**`（内部结构与映射表）、`packages/ir/src/**`（诊断类型与位置类型）、`spec/**`（位置模型）、新增 `docs/adr/0020-source-spans.md`（编号 0020 已预留，见 `docs/adr/README.md`）、`tests/**`。

**验收**：

- 一条 schema 违规能同时给出 `location`（源行列）与 `cause.instancePath`（IR 路径）。
- 打乱源文件行序后：IR 字节不变（§10 验收仍绿），诊断位置指向新行号。
- agent 拿到诊断能定点改文件，不必再解析一次去猜位置。

**注意**：

- **不要为了位置把源文本复制进 IR**（[ADR-0004](adr/0004-ir-representation.md) 明令：IR 不复制源文本与注释）。span 是位置元数据，且**不进 IR**。
- 列号的字符语义（中文、`Ω`、`±` 怎么算列）必须写死并进 spec，否则第三方实现算出来的列号对不上。
- 这条是 F7 的前置，但**不阻塞 F7 的码表与注册表**（先有码与文件级位置，span 到位后补行列）。

---

## F12. 十用例语料（语法准入规则的闸门）——**延后**

**决定（2026-10-21）**：**延后**。项目距完善还有相当距离，十用例不是当前瓶颈；sch 解析器、展平、BOM 计数、诊断注册表都还没落地，现在写语料等于给一个还会变的 IR 写黄金文件。**触发条件**：sch 的 IR 与展平口径定版之后。

**延后期间的替代闸门**（§5.2 第 1 条不可评估时的临时口径）：

- 新语法特性仍要满足 §5.2 的第 2、3 条（EBNF + 语义 + 正反例 + 错误文案）；
- 第 1 条改为**在 ADR 里写清"这个特性解决哪个具体硬件问题"**，并给一个**最小的具体片段**（不是完整用例），例如"20 路电源域里每路的 5 个器件要写 5 行 × 20 路 = 100 行"；
- ADR 里要写"将来补语料时回到这条"。

**现状**：`AGENTS.md` §10 列了十个困难用例（BGA 200 脚、双运放多单元、20 路电源域、差分对、DNP 变体、net tie、总线、层次复用、参数化分压、NC 引脚），并要求"先于实现写"；§5.2 把"至少一个用例必须用到它"作为新语法特性的准入条件。**但 `examples/` 下只有 `reference-project/`，十个用例一个都没有，期望 IR 黄金文件也没有。**

**为什么现在做**：这是当前**最挡路的一条**：

- §5.2 的语法准入规则**无法评估**——没有用例就没有证据，任何新语法都能绕过闸门；
- conformance（`source → IR → netlist` 黄金文件）与 binding（5 类受控偏差正反例）都从这批语料长出来；
- §11 Q2（表达式程度）的修订条件绑定在"20 路电源域"这个用例上；
- 参考工程只有 2 块板（`mcu-board` 单页、`charger-buck` 两页），规模与难度都不到用例级别。

**要做的事**：

1. 定目录约定（建议 `examples/cases/<case_id>/`）：
   ```
   examples/cases/<case_id>/
   ├── README.md      # 这个用例要证明什么、期望 IR 是什么
   ├── <描述>.teda    # 源描述（可能多份：sch + page + pcb + component）
   └── expected/      # 期望 IR（canonical JSON）
   ```
2. 十个用例逐个落地，每个至少含：源描述、期望 IR（canonical）、**以及这个用例触发的检查点**（哪些错误码、哪些断言）。
3. **先做不依赖 sch 解析器的四个**（当前工具链就能验证）：差分对（约束）、DNP 变体、net tie（受控偏差）、NC 引脚（`no_connect`）——只需要 `component` + 约束 + 变体语义。
4. 再做需要 sch 解析器的六个：BGA 200 脚、双运放多单元、20 路电源域、总线、层次复用、参数化分压。
5. 每个用例配一条可跑的检查（`bun test` 里一条，或 `bun run cases:check`），失败即回归。
6. 用例写完后回头把 §5.2 的闸门接上（当前状态是"不可评估"）。

**涉及**：`examples/cases/**`、`tests/**` 或各包 `test/`、`packages/parser`（需要时补解析能力）、`AGENTS.md` §5.2 / §10。

**验收**：

- 十个用例目录齐备，每个都有源描述 + 期望 IR + 检查点。
- `bun test` 覆盖它们。
- §5.2 的准入规则可评估：能对任一新语法说"有哪个用例用它 / 没有，所以不加"。

**注意**：

- **用例要难**：自己给自己出题容易偏软。尽量取真实项目的痛点（BGA 扇出、20 路电源域的共地与去耦、多单元器件跨单元的 net、层次化板卡）。
- 期望 IR 必须 **canonical**（打乱行序后仍字节相同）——否则用例本身违反 §10 的"IR 只依赖语义"。
- **不要用生成器批量造用例**：生成器产出的正是"程序化写法"，用它当用例会把 §5.3 的方向带偏（生成器在语言外，产物是表——用例应当手写表形态）。
- 先做四个不依赖 sch 的，把用例流程跑通，再批量。

---

## F13. 层次（`module` / 参数）：先立约束，延后实现

**现状**：层次是设计里**唯一自指闭环**的部分——`AGENTS.md` §4.2 说有 module/实例化/参数/import，`teda.md` 说"草案见 `AGENTS.md` §5.3"，§5.3 又指回 `teda.md`。没有规范、没有语法、没有解析器、没有用例。§11 Q16 已把它记为待定问题。

**已定的约束（2026-10-21 讨论，先写死以免被随手设计掉）**：

1. **层次只在源码层，IR 存展平结果**——与 page 的展平口径一致（[ADR-0002](adr/0002-board-pages-and-bom.md) / [ADR-0007](adr/0007-page-internal-net-naming.md)）。IR 里不留 module 结构，否则第三方实现要额外实现 module 解析 / 展开 / 端口解析三套语义。
2. **module 与 page 同构**：都有 ports，展平命名复用 `<instance_id>.<net>`（[ADR-0007](adr/0007-page-internal-net-naming.md)），未连接端口必须显式（与 F8 的 pin 归属三态同构）。实现上应当只有**一套展开器**。
3. **参数只做字面量替换，不参与运算**：参数值与实例覆盖值都必须是字面量（可带单位）；禁止 `VOUT = $vin * $ratio`、禁止参数引用参数、禁止函数调用。派生值由语言外的生成器算好后写成字面量（与 F9 同源）。
4. **评审可见性**：module 体里的 `$rset` 意味着"值来自实例"，评审者看实例行即可（**一跳**，不是程序语义）；实例行里的值是字面量。参数化**结构**不藏事实，参数化**取值**才藏事实——后者不做。

**什么时候层次真的值得（判据）**：

- **同构重复**（例如 4 路一模一样的 LDO，块 ≥ ~15 行、实例 ≥ 3 次）→ 值得。
- **同构带差异**（20 路电源域：结构同、值不同）→ **多半不值得**——层次会把 20 份字面量收成 1 份体 + 20 个覆盖，评审要跨 20 处对照；写开是 20 份可并排看的表，而**表很便宜**（一行一个事实，diff 干净）。
- 层次**不解决**：BGA 200 脚引脚表太长、电源域公共点太多——那些是 pin 表与 net 表问题。
- §7 的"规模 >100 器件上下文爆炸"由分页 + 展平后的净表缓解，层次只是其中一种手段。

**要做的事**（触发后）：

1. 写 `spec/hierarchy.md`：module 体语法、ports、参数、实例语法、展开规则、命名规则。
2. 决定 module 定义的存放位置：先只支持**工程内**（`modules/` 目录，或直接放在 `sch/<board_id>/` 旁），跨工程复用等 F10 的库包规范（module 进库包）。
3. 校验规则：端口必须全部连接或显式 `nc`；未定义/未使用参数报错；实例化深度上限（防展开爆炸，参考 cohdl 的展开预算）；循环检测；展开后与 sch 的 net/器件命名不冲突。
4. 展平后的结果进板级 IR，器件身份沿用 `component_id`，BOM 计数按 [ADR-0002](adr/0002-board-pages-and-bom.md) 的展平口径。

**触发条件**：出现第一个真实的"同构重复 ≥ 15 行、实例 ≥ 3 次、且取值各不相同"的场景。**在此之前不实现。**

**注意**：

- 层次是源码层机制，越晚定越便宜——sch 解析器与展平口径没定之前定层次，等于在没学会走路前学跑步。
- 不要用层次去解决"文件太长"：表长不是问题，**一行一个事实**才是问题；层次会把"可见的事实"变成"要展开才可见的事实"。
- 引入层次时，F9 的"事实层无表达式"仍然成立：层次是替换机制，不是表达式机制。

---

## F14. `fab` 的目标形态：制造中立数据是契约层，KiCad 只是兼容方案

**现状**：`AGENTS.md` §1 的"不是"里写着"不自研 Gerber / Excellon 写出器"，[ADR-0005](adr/0005-manufacturing-output.md) 把制造出口定为"IR → KiCad → Gerber/Excellon"。同时 §1/§4/§9 又提到 `fab` 描述，但**它连形态都没有**（无 spec、无 schema、无类型、无例子）——§11 Q17 已记为待定。

**已定的方向（2026-10-21 讨论）**：**KiCad 是兼容方案，不是目标形态**。目标形态要把两类产物分开，因为它们在项目分层里属于不同的层：

| 产物 | 性质 | 谁做 |
|---|---|---|
| Gerber / Excellon | **物理图像**（渲染层） | **写出器自研**（P3，F15）——RS-274X 是行式文本格式，工作量已知；但 **CAM 级 DFM 判定不自研** |
| 制造与装配意图：层叠与规则、BOM、位号 + 坐标 + 朝向、装配说明 | **描述**（M0 层） | **这才是 fab 契约层该做的**——它是描述，不是画图 |

**因此建议**：

1. **`fab` 的默认产物 = 制造中立的数据**（自有 JSON 契约），而不是 Gerber 本身。内容：BOM（含变体状态）、贴片坐标与旋转、层叠与规则意图、装配/制造说明。
2. **导出器再从这份数据派生多种下游**：Gerber（**自研**，P3）/ IPC-2581（可选）/ BOM+坐标（嘉立创路径，[ADR-0006](adr/0006-jlc-prototype-delivery.md)）/ KiCad 工程（**兼容方案**）。"KiCad 只是兼容方案"由此成为**结构性事实**而不是口号：Gerber 由我们的 IR 直接出，而制造中立数据是我们自己的。
3. **规范获取成本要单独核实**：ODB++ 的规范由 Valor/PTC 掌握、需会员资格；IPC-2581 由 IPC 发布、同样是会员可取（虽是行业事实标准）。**两者都不适合当"自研格式"**——所以契约层用自己的 JSON，导出到 IPC-2581 / Gerber 是导出器的事。
4. **v0.1 不做 `fab` 描述**（P3），但**先把"制造中立数据"的形状想清楚**——它是 B0 板级描述 + BOM/坐标/装配意图的投影，形状定了，`fab` 描述与导出器就都定了。
5. **补一条 ADR** 说明目标形态与 [ADR-0005](adr/0005-manufacturing-output.md) 的关系：[ADR-0005](adr/0005-manufacturing-output.md) 定的是**当前实现路径**（走 `kicad-cli`），不是终点；免得后人把 [ADR-0005](adr/0005-manufacturing-output.md) 读成"KiCad 是终点"。

**要做的事**（触发后）：

1. 写 ADR：制造出口的目标形态（自有制造中立数据 + 多种导出，KiCad 为其中一种）。
2. 定数据形状：BOM 行（`component_id` + 参数字典 + 变体状态，[ADR-0002](adr/0002-board-pages-and-bom.md) 的口径）、坐标与朝向、层叠与规则引用、装配说明。
3. 定与 B0 的边界：哪些字段来自 `pcb` 描述（层叠、规则意图）、哪些来自 `sch` 展平（BOM、变体）、哪些是纯制造附加（工艺说明、拼板）。
4. `fab` 描述进语言与否，等这一步定完再决定（§11 Q17）。

**注意**：

- 不要现在写 Gerber 写出器——它排在 P3（F15），先把制造中立数据的形状定下来。
- **不要让"制造中立数据"变成 KiCad 工程文件的翻版**（§7 的"pcb 变成 KiCad 的翻版"同款坑）。
- 制造中立数据一旦公开就是契约层（[ADR-0015](adr/0015-licensing-and-open-standard.md) 不变量 19），别为了排他性把它关起来。
- **零依赖是硬要求**（[ADR-0018](adr/0018-zero-dependency-and-manufacturing-target.md) / 不变量 20）：这条产线不得依赖 KiCad 才能跑通，KiCad 只是可选后端。

---

## F15. 自研 Gerber / Excellon 写出器（零依赖制造出口）

**现状**：制造出口的当前路径是 IR → KiCad → Gerber / Excellon（[ADR-0005](adr/0005-manufacturing-output.md)）。这要求用户安装 KiCad，与 [ADR-0018](adr/0018-zero-dependency-and-manufacturing-target.md) 的零依赖原则（不变量 20）冲突：textEDA 的目标是"装 textEDA 就能走完描述 → 校验 → 渲染 → 制造包"。

**为什么工作量是已知的**：RS-274X 是行式文本格式（aperture 定义 + draw / flash + 坐标），**不需要几何内核**；本仓已有 pcb IR 的层、焊盘、走线、过孔、丝印事实，缺的是画布展开与坐标变换。对照自建符号库与封装库的实际经验（[ADR-0011](adr/0011-library-format-and-footprint-ir.md) ~ [ADR-0013](adr/0013-reference-project-self-built-libraries.md)）——"自建比想象中容易"已经被验证过一次，别再靠猜。

**要做的事**（P3，排在 F14 的数据形状之后）：

1. **定写出范围**：RS-274X + Excellon 钻孔；坐标格式 4.6（与 IR 的整数纳米一致）；零填充（leading zero suppression）取哪一种要写进规范并冻结。
2. **层映射表**：pcb IR 的层 → Gerber 文件名与层标识（`F.Cu` → `F_Cu.gbr` 等），板框、丝印、阻焊、锡膏开窗的对应关系写进 spec。
3. **铜皮展开**：Gerber 需要实际填充区域。**优先在 IR 里存派生好的填充结果**（可丢弃、可重算，见 [ADR-0003](adr/0003-agent-first-pcb-ir.md)），**导出器不做几何运算**——否则就把几何内核引进来了。
4. **极性与 D-code 复用、镜像、旋转**：全部按坐标变换处理，不引入额外语义。
5. **对照测试**（可选，不是门禁）：同一块板，自研写出器与 `kicad-cli pcb export gerbers` 的产物要比对——层集合、孔位、图形数量一致。
6. **可复现**：同一 IR 两次导出**逐字节相同**（与不变量 18 的 canonical 要求一致）。

**不做**：CAM 级 DFM 判定（阻焊开窗规则、锡膏膨胀、丝印避让、阻抗规则的可制造性判断）。Gerber 是格式，判定是规则工程，交给专业 CAM（[ADR-0018](adr/0018-zero-dependency-and-manufacturing-target.md) decision 2）。

**验收**：

- 在**没有 KiCad 的机器上**跑通 `textEDA export gerbers <board>`，产出分层 Gerber + 钻孔文件。
- 与 KiCad 产物在层集合、孔位、图形数量上一致（对照测试）。
- 同一 IR 两次导出逐字节相同。

**注意**：

- 这一条的价值不只是"少一个依赖"，更是**契约层自足**：第三方实现者拿到 IR 就能出制造包，不必安装 KiCad，也不必实现 KiCad 的语义（不变量 19 的兑现）。
- **不要顺手把 CAM 规则塞进来**：格式层与判定层分开，否则这条会变成无底洞。
- 极性与 D-code 的选择写进规范并冻结——Gerber 一旦流到工厂就是 ABI。

---

## F16. 网表与 KiCad 原理图导出（P1）

**现状**：`packages/parser` 能把板根 + 页面编译成板级 IR 分片（`bun run compile:schematic <项目目录> <board_id>`），IR 里已有实例、net（编号形式的引脚引用）、端口与约束。**网表已落地**：`textEDA netlist <项目目录> [--board <id>] [--json] [--out <文件>]`，实现在 `packages/exporter/src/netlist.ts`，是 IR 的纯函数投影（net/成员/实例都排序，逐字节可复现；有 error 时拒绝导出）。**netlist 只带连通性**：值、容差、封装属于 BOM，不进来。**KiCad 原理图导出仍是空的**：`packages/exporter` 只有封装与符号；原记录：`packages/exporter` 只做封装（`.kicad_mod`）与符号（`.kicad_sym`）→ KiCad，没有原理图方向的产物；BOM 与网表也没做。

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
- BOM 的参数值要人读（`10k` 而不是 `10000000 µΩ`），所以需要"规范单位 → 显示值"的换算；**规范单位表只有一份**（[ADR-0008](adr/0008-ir-shard-identity-and-hash.md) decision 4），不要在导出器里另抄一张。
- 变体（DNP / 不贴）还没进 IR，BOM 的"变体状态"这一列先留空，等 P3。

---

## F17. `project.toml` 与 `system` 描述的解析（语言表面的最后两块）

**现状**：语言表面还差两块没实现——`project.toml`（项目元数据：名称、版本、板列表、变体、库引用）与 `system`（板间连接）。`scripts/lib/project.ts` 里有一份只够库校验用的手写 TOML 读取，不是解析器；`system` 描述完全没有代码。`sch` 解析器已经能读板根与页面，但**读不到板列表**，所以跨板校验（teda.md §11 第 9 条：两侧电压区间不相交报错）做不了。

**要做的事**：

1. **`project.toml` 解析**：按 AGENTS.md §9 的键表实现（`[project]` 必填三项、`[boards.*]`、`[variants.*]`、`[libs.*]`、`[compliance]`、`[ext]`）；未知顶层键报错；不写时间戳、绝对路径、随机 ID、派生数据。
2. **`system` 描述解析**：段只有 `boards` 与 `nets`；成员是 `<board_id>.<port_id>` 引用，不是引脚引用。校验项见 teda.md §8.1/§8.2 与 §11 第 9 条。
3. 把两者接到 CLI：`textEDA check` 先要能列出工程里的板与系统。

**涉及文件**：`packages/parser/src/project.ts`（新）、`packages/parser/src/system.ts`（新）、`packages/cli/scripts/textEDA.ts`。

**验收**：

- 解析参考工程的 `project.toml` 与（新增的）一份 `system` 描述，板列表与实际 `sch/` 文件对得上。
- `system` 的每条 net 至少两个成员、成员都是已声明的 port、同一个板内 net 不被并进两条系统 net；两侧电压区间不相交时报错。
- 未知顶层键、未知段名都报错并给出行列。

**注意**：

- **TOML 解析不要引依赖**：项目默认零运行时依赖；手写一个够用的子集解析器（键值、表、数组 of tables、字符串/数字/布尔/数组），遇到子集外的语法就明确报错，不要"尽力解析"。
- `system` **不改写板内连通性**（不变量 15）：删掉 system 文件，各板依然独立成立；这条要有测试兜着。
- `project.toml` 只承载元数据，**不承载电路**。

---

## F18. `textEDA check`：一条命令跑完解析、契约校验与 ERC

**现状**：**sch 级已落地**（[ADR-0019](adr/0019-agent-contract-reference-and-check-entry.md)）。`bun run check <项目目录>` 遍历工程里的全部板（`sch/<board>.teda`），逐板解析 → 语义层 ERC → 契约层 schema 校验，诊断走 [ADR-0016](adr/0016-diagnostic-error-codes.md) 的统一载荷（`code` / `severity` / `location` / `data` / `hint`），`--json` 打到 stdout、人读模式打到 stderr；有 error 退出码 1，只有 warning 退出码 0。器件文件解析失败（`syntax.component-invalid`）与器件文件头 id 与文件名不一致（`ref.component-id-mismatch`）也走同一条通道。

**还没做的**：

1. `project.toml` / `system` / `pcb` 的解析还没接进 `check`（`pcb` 描述本身还没实现；`project.toml` 与 `system` 是 F17）。
2. **ERC 与契约校验分层计数**：现在两类诊断在同一个数组里（`severity` 能区分 error/warning，但"契约错"与"设计错"没有分开统计）。
3. 诊断顺序稳定 ✓（板按 id 排序、板内按产出顺序），但还没写成测试。

**验收（已过的部分）**：

- 对参考工程跑 `textEDA check`，退出码 0，诊断里只有已知的 ERC 警告（未连接引脚）。✓
- 故意写坏一个文件（器件找不到、器件文件解析失败），退出码非 0，`--json` 里有文件、行列与码。✓（`packages/cli/test/check.test.ts`）

**注意**：

- **`check` 不改文件**：只报告，不修；修是 `fmt` 与显式 patch 的事。
- 警告不阻止退出码 0（ERC 警告是设计信息，不是失败）——这条要写进 CLI 的帮助文本，否则 agent 会误判。

## F19. ERC 从 parser 外移到 core：让第三方分清"语法错"和"设计错"

**现状**：解析器（`packages/parser/src/schematic.ts`）同时报语法错误与 ERC 规则违规——同一个诊断数组里既有 `syntax.row-too-short`，也有 `net.pin-in-two-nets`。对本项目没问题，但**第三方实现者**没法据此判断"是我的语法实现写错了"还是"这个设计本身有问题"。

**要做的事**：

1. 建 `packages/core`（[ADR-0009](adr/0009-implementation-stack.md) 已规划：纯函数，禁 `Bun.*` 与 `process.env`），把 ERC 规则作为独立阶段放进去：输入是解析结果，输出是 ERC 诊断。
2. `packages/parser` 只出语法与语义层面的"读不出来"（器件找不到、引脚不存在这类解析失败），不出规则违规。
3. ~~`textEDA check` 的载荷里区分两类~~ **已落地（第一步）**：诊断按**域**归到三个阶段（`parse` / `contract` / `semantic`），载荷带 `countsByStage`，`check` 的人读输出也打印阶段分布。不需要调用点声明阶段——域是封闭词表，一个域只可能属于一个阶段。剩下的是真正的迁移：把 `net` / `drc` 域的规则从 parser 挪进 `packages/core`。

**第二步已落地**：`packages/core` 建包，连通性四条规则（`drc.single-member-net` / `net.pin-in-two-nets` / `net.pin-unassigned` / `net.no-connect-connected`）移出 parser，改成纯函数 `checkConnectivity(facts)`——吃展平后的 net、每个实例的引脚、带端口的 net 集合与定位回调，不认识语法也不碰 fs。parser 只负责摆事实（约 25 行），行为等价（参考工程仍是 79 警告，`pin-in-two-nets` 的定位从"板文件首行"变成该 net 的真实行）。规则自带 8 条单测，不需要构造 `.teda` 源。

**还剩**：`ref.duplicate-port-net` / `ref.port-net-undecided` / bus 相关规则仍长在 parser 里；`check` 的编排也还在 CLI。真正的收口是让 `core` 提供 `analyzeBoard()`（parse → ERC → 契约），CLI 只剩读文件与打印。

**为什么现在做**：F16（网表导出）与 LSP 都要复用同一套检查；规则散在 parser 里时，每加一个导出格式就要抄一遍判断。

**注意**：规则**保持代码**，不做规则 DSL（AGENTS.md §11 Q2/Q9：表达式与生成器都推过）。外移的是**边界**，不是表达方式。

## F20. IR 契约参考的字段说明补齐 + `pcb` 分片

**现状**：`docs/ir-reference.md`（[ADR-0019](adr/0019-agent-contract-reference-and-check-entry.md)）已生成，每个字段一行（类型 / 必填 / 单位 / 说明），联合类型按分支展开（`constraint（type=voltage）` …），文末有"缺说明"清单。**非 pcb 分片已 100% 覆盖**（common / component / schematic / manifest / system / project / symbol / footprint）；**`pcb` 分片还剩 81 个字段没说明**，而 `pcb` 描述本身还没实现。

**要做的事**：

1. 给 `schemas/ir/v0.1/pcb.schema.json` 的字段补 `description`（`pcb` 描述落地时一并做，否则会返工）。
2. 把"缺说明字段数"变成一个门槛（`gen:check` 或 CI 里卡覆盖率），防止新字段裸奔。

**注意**：description 是**契约的一部分**（写的是这个字段装什么），不是文档润色；补它等于把 IR 语义写进唯一真源。补说明时若给 `$ref` 加兄弟 `description`，生成器必须开 `unreachableDefinitions`，否则命名类型会被内联掉（[ADR-0019](adr/0019-agent-contract-reference-and-check-entry.md)）。

## F21. pcb 描述：绑定校验、`fmt`、参考工程的 pcb

**现状**：`pcb` 12 段的解析已落地（`packages/parser/src/pcb.ts` → `schemas/ir/v0.1/pcb.schema.json`，`textEDA compile <dir> <id> --pcb`）。覆盖面是规范 §1–§6 的全部段与 10 种规则；`stackup` 顺序/编号、板厚与叠层之和、板框闭合与自交、重复放置、重复 pad 对都在解析期报。

**没做的三件**：

1. ~~**绑定校验**~~ **已落地（规则 1–5）**：`packages/core/src/binding/checks.ts` 的 `checkBinding()`，接在 `textEDA check` 里（有 `pcb/<board>.teda` 就跑）。覆盖：未知实例、未放置 pad、跨 net 短接（`net_tie` 可豁免）、未布线（warning）、未知 net。**还差**规则 6–8（`rules`/`trace` 的层名与 net 存在性已做，`physical_only` 的 `fiducial` 不得挂 net、`deviation` 白名单类型完整性）与规则 10–11（多边形自交已在解析期做，丝印层枚举已做）。
2. ~~**`pcb` 的 canonical formatter**~~ **已落地**：`packages/parser/src/fmt-pcb.ts`，`fmt --check` 已覆盖 pcb（参考工程的 `pcb/charger-buck.teda` 已重排成 canonical）。三条不变量都有测试：`parse(fmt(x))` 与 `parse(x)` 产出**逐字节相同**的 IR、`fmt(fmt(x)) == fmt(x)`、注释原地保留。**canonical 归一口径在解析器里**（`connect` 对内排序、`trace` 折线方向、`rules` 类型序），formatter 复用同一口径——否则 IR 与源文件会各排各的。
3. ~~**参考工程的 pcb**~~ **已有**：`examples/reference-project/pcb/charger-buck.teda`（放置 M2 页 9 个器件 + `connect` + `trace`/`via`/`zone` + `rules`/`silk`），跑 `check` 零诊断。含两个真实约束，已补进实现与规范：**同一段可以重复出现**（该文件把 `trace` 分了两段，行按出现顺序拼接）、**段头独占一行**。

**注意**：`via` 既是段名又是 `rules` 的行首列，语法上靠"段头独占一行"消歧（已写进 `spec/pcb.md` §1）。加新段名时要检查是否与规则类型/物理实体类型重名。
