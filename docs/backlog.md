# 待办（backlog）

工作项清单，不进 `AGENTS.md` §11（那里是**待定问题**：需要人拍板的取舍）。每条写清：现状、要做的事、涉及文件、验收、注意事项。

编号只增不减：做掉的条目从清单里移除，结论留在对应的 ADR 里。**F2（自研参考渲染器）已关闭** → `docs/adr/0014-reference-renderer.md`（符号与封装渲染 + `bun run preview` 已落地；剩下的 sch 渲染另开 F3）。**F7（诊断错误码注册表）已关闭** → `docs/adr/0016-diagnostic-error-codes.md`（`域.slug` 码表 + 生成的 `docs/error-codes.md` + 双向完整性检查已落地）。

---

## F1. 校准自建封装的几何（footprint 校准）

**现状**：`examples/reference-project/assets/footprints/project/` 下的 16 个封装是**通用 land pattern**——焊盘尺寸与间距按 IPC 通用推荐取整，不是各料号 datasheet 的精确 land pattern（见 `docs/adr/0013-reference-project-self-built-libraries.md` decision 5）。每个文件的 `description` 里都写了 `generic land pattern` 作为标记。

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

**现状**：sch 打印页渲染**已落地**。`packages/renderer` 的 `renderSchematic(view: SchematicView, instances)` 把视图 IR 画成 `SvgDoc`（图幅框、摆位符号、走线折线、标签、端口、注释），调用方负责把每个 `place.instance_id` 解析成符号 IR 与器件引脚事实——渲染器仍然不碰文件系统、不排版。`bun run preview view <board>/<page>` 能出图；参考工程有两份打印页：`views/charger-buck/buck-5v.view.teda`（全部 net 走线，GND 走一条总线）与 `views/charger-buck/charger-power.view.teda`（摆位研究，线在评审时逐网补）。**未落地**：`packages/core` 的板 ↔ 打印页交叉校验、可读性检查、sch 的 round-trip 反解、与 `.kicad_sch` 的人工比对。旧状态见 [ADR-0014](adr/0014-reference-renderer.md)（符号/封装先落地）。

**为什么现在做**：

- **sch 的错误只有看图才发现**：ERC 能抓悬空引脚、短路、电源域冲突，抓不到"两个 net 的标签压在一起"、"引脚名糊成一片"、"连线穿过符号"、"打印页元素越界"。这些在 P0 的 ERC 里全是绿的。
- **符号与封装的经验可以直接复用**：中间表示（绘图指令列表）、坐标约定（整数纳米）、确定性（字节可复现）、round-trip 的"语义投影"两端对比，这四样已经定型了（[ADR-0014](adr/0014-reference-renderer.md)），sch 只是多一种图元与一层布局。

**要做的事**：

1. ~~`packages/renderer` 加 `renderSchematic(...)`~~ **已落地**（2026-10-21）：
   - 打印页内的元素按 IR 的坐标画：器件（用它的符号视图摆位）、导线、net 标签、端口、文本注释；**电源符号**未做——`view` 描述没有这个段，GND 目前靠 net 标签表达；
   - 器件的引脚连接点与符号渲染器用同一份 `renderSymbol` 几何（走线端点直接取变换后的引脚连接点，不另算）；
   - 走线是"引脚连接点 → IR 折点 → 引脚连接点"的折线，不做自动布线。
2. ~~预览命令扩一档~~ **已落地**：`bun run preview view <board>/<page>`（旧的 `preview schematic <board_id> --page` 方案改成按打印页取 `views/<board>/<page>.view.teda`，与文件布局一致）。
3. **可读性检查**（`AGENTS.md` §6："文字重叠、线压引脚、标签碰撞、越界、连线穿过符号"）——**未落地**。越界已由 `view` 解析器的 `view.out-of-sheet` 覆盖；其余仍是 `spec/schematic-view.md` §9.2 的待实现项。
4. **round-trip**——**未落地**：sch 的语义投影两端对比（跟符号/封装同一口径，见 [ADR-0014](adr/0014-reference-renderer.md) decision 5）。绘制指令里的 `pin`（旋转后的编号与方向）、`text`（`role` 区分字段/引脚名/标签/端口/注释）已经能反解，但视图 IR 的"摆位 + 折点"需要从图元逆推，且 `unit` 的共享项与字段要按实例归并。
5. 与 KiCad 的 `.kicad_sch` 渲染做**一次性人工比对**——**未落地**（不进 CI）。
6. **板 ↔ 打印页交叉校验**（`packages/core`）——**未落地**：`spec/schematic-view.md` §9.1 标"待实现"的那几条（实例 / net / port 是否存在、端点引脚是否属于该 net、`net-not-drawn`）。渲染器对未知实例或未知符号引脚是**抛错**，不是发诊断——诊断归 core，渲染器不伪造几何。

**验收**：

- ~~`bun run preview view <board>/<page>` 出整页 SVG~~ **已满足**：器件、导线、net 标签、端口都在图上（参考工程两份打印页）。
- ~~同一份 IR 渲染两次字节相同~~ **已满足**（`packages/renderer/test/schematic.test.ts`）。
- sch 的 round-trip 测试通过——**未满足**（见第 4 条）。
- 越界与"连线穿符号"能被报出来——**部分**：越界在解析器，穿符号未做。

**注意**：

- **sch 的逻辑 IR 仍然没有坐标**（`instances` / `nets` / `ports` 只有身份与成员），画在独立的 `view` IR 里；渲染器的输入因此是 `view` + 调用方解析好的符号事实（符号 IR、器件引脚事实），仍然不碰文件系统。
- **S1 视图层已闭环到渲染**：`spec/schematic-view.md`、`schemas/ir/v0.2/schematic-view.schema.json`、`packages/parser` 的 `view` 解析与 canonical `fmt`（语言版本 0.7）、`packages/renderer` 的 `renderSchematic`、`preview view`、参考工程两份打印页。**下一步**：`packages/core` 的板 ↔ 打印页交叉校验（视图引用的实例 / net / port 是否存在、端点引脚是否属于该 net），再把可读性检查与 round-trip 反解补上。
- **已知口径冲突（`view.label-not-on-net` 落地前必须定）**：`view` 坐标限制在 0.1mm 栅格（`VIEW_GRID_NM`），而符号引脚偏移是 2.54 / 3.81mm 的倍数，**不在 0.1mm 栅格上**。所以"标签必须精确落在引脚连接点上"对标准符号不可满足。参考工程的标签全部落在走线的网格折点 / 直段上（buck-5v 的 GND 走一条位总线，引脚到总线用带折点的 wire 连），没有标签落在引脚端点上。
- 布局不自动排版：sch 的坐标来自 IR，渲染器只画。多单元器件（双运放）要按 `unit` 选对符号视图。
- 不要顺手做自动布线或自动排版——那是 `AGENTS.md` §1「不是」里明确不做的东西。**自动排版尤其不可取**：如果渲染器自己排版，人就无法把重叠的标签挪开，"可读性检查"（文字重叠、线压引脚）也失去意义——每次渲染的图都不一样，评审无从进行。

---

## F4. 第三方可实现性交叉验证（开源规范的发布门槛）

**现状**：仓库从私有转公开（[ADR-0015](adr/0015-licensing-and-open-standard.md)），项目定位是**纯开源技术规范**：让别人照着 `spec/` 与 `schemas/` 实现自己的 parser / 校验器 / 渲染器。当前所有规范知识都沉淀在 `packages/**` 的源码里——读者容易把"实现里怎么做的"当成"规范要求什么"，这是开源规范失败最常见的方式。

**为什么现在不做**：板级描述（`sch` / `pcb`）还没实现（`AGENTS.md` §1.1 P0），现在做完整验证等于给一个还要改的规范写验收。**但 `sch` 落地前必须做**，否则规范定型后再改代价更大。

**要做的事**：

1. 写一份**最小第三方实现**：只允许读 `teda.md` / `spec/**` / `schemas/ir/**` / `tests/**`，**不许读 `packages/**` 的源码**。目标是 `component` + `symbol` + `footprint` 三种描述的解析与 IR 产出。
2. 用 `tests/` 里的 conformance 语料与黄金 IR 跑它，比对输出 IR 是否逐字段一致（字节级或语义级，口径写清）。
3. **规范补漏**：凡是实现时必须回头看 `packages/**` 才能确定的地方，在 `spec/` 里补成规范条款。补不了的（例如刻意留给实现的自由度），在 spec 里显式写"本条不约束实现"。
4. 产出一份差异报告（`docs/third-party-implementability.md`），列出规范歧义点与已修条款。

**涉及**：`spec/**`、`schemas/ir/v0.2/**`、`tests/**`、新增 `docs/third-party-implementability.md`。

**验收**：

- 第三方实现在**不参考 `packages/**` 源码**的前提下通过 conformance 核心用例。
- 差异报告里的每条歧义要么在 spec 里被写成条款，要么被显式标注为实现自由度。
- 结论回写 [ADR-0015](adr/0015-licensing-and-open-standard.md) decision 4.3。

**注意**：

- 这不是"再写一遍实现"——目的是**发现规范漏洞**，实现只写到能暴露漏洞的深度。发现不了歧义就说明用例覆盖不足。
- 不要让第三方实现反过来污染参考实现：发现不一致时先判断是"实现错了"还是"规范没写清"，两者的修法不同（前者改 `packages/`，后者改 `spec/`）。
- 别把它做成"重构 `packages/`"的借口。

---

## F5. 包发布形式与商标（延后，等真实使用信号）

**现状**：七个包（根 + `packages/ir` / `parser` / `exporter` / `renderer` / `core` / `cli`）都是 `"private": true`、版本 `0.0.0`，未发布到任何 registry。[ADR-0015](adr/0015-licensing-and-open-standard.md) decision 7 明确延后。

**为什么现在不做**：还没有外部消费者；当前包是 TS 源码（走 git 依赖即可），发布到 npm 只会在没有真实需求时产生"看起来有人在用"的假象。

**要做的事（等有信号再做）**：

1. **发布形式**：候选是 npm（`@texteda/*`）、纯 git 依赖、或者只发布 `schemas/ir/**` 与 conformance 语料。判断依据是"第三方实现者实际需要什么"——先看有没有人 clone 了仓库并自己写实现。
2. **版本号**：发布前把 `0.0.0` 换成真实版本；`format` 与 `ir_version` 独立版本（[ADR-0008](adr/0008-ir-shard-identity-and-hash.md)）不变，发布时把 `ir_version` 打进包元数据。
3. **商标**：目前没有注册任何商标（[ADR-0015](adr/0015-licensing-and-open-standard.md) decision 5）。若将来第三方开始自称"符合 TextEDA"，再评估是否注册 `TextEDA` 商标并写使用指引（Apache-2.0 §6 不授予商标许可）。

**涉及**：`packages/*/package.json`、根 `package.json`、新增 `TRADEMARKS.md`（若注册）。

**验收**：

- 第三方能按文档在一条命令内把 `@texteda/ir` 或 schema 装进自己的工程。
- 发布产物里的 `ir_version` 与仓库一致。

**注意**：

- 发布不等于放弃契约层开放：发布的是实现，契约层照样公开（[ADR-0015](adr/0015-licensing-and-open-standard.md) 不变量 19）。
- 别在还没有用户时先做品牌设计、文档站、CI 徽章那一套——那是"看起来在推进"的自我安慰。

---

## F6. 仓库可见性切 public（**已完成** 2026-10-21）

**现状**：GitHub 仓库 [`luffffyz/TextEDA`](https://github.com/luffffyz/TextEDA) **已公开**。许可与开放承诺已按 [ADR-0015](adr/0015-licensing-and-open-standard.md) 落定（Apache-2.0 + 契约层永久开源）。

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

**现状**：`AGENTS.md` §4.2 要求显式区分三种"没连"——floating（漏连，错误）/ no_connect（有意悬空）/ dnp（不贴）；§4.4 绑定规则 2 说每个 sch 器件的 pin 必须能映射到封装 pad，或显式 no_connect / dnp。**这些目前只是检查器的规则**，IR schema 不要求，因此每个实现都得自己写一遍，第三方实现很容易漏。cohdl 的做法相反：把"引脚连接义务"做成类型系统的穷尽检查（unresolved pin 是编译错误，不是 DRC 警告）。

**为什么现在做**：sch 的 IR 还没写（§1.1 P0），schema 现在改成本最低。而且这是"第三方实现只要过 schema 就自动满足"的那类约束——**对开源规范，schema 承担的义务越多，第三方实现越少出错**。

**要做的事**：

1. 给每个 pin 实例一个**归属状态**：`net` 成员 | `no_connect` | `dnp`（三态；**缺省即报错**，不允许"未提及"）。
2. schema 表达两条不变量：
   - 每个 `(component_id, pin_number)` 恰好一个归属；
   - 出现在 net 成员里的 pin 不得同时标 no_connect / dnp。
3. **floating 降级为检查器的派生诊断**（由归属缺失推出），不再是独立标记。
4. 封装侧：pin 号集合与 pad 号集合的一致性（`lib:verify` 已有）下沉到 schema 能表达的部分。
5. 补 conformance 正反例（`tests/schemas/`）。

**涉及**：`schemas/ir/v0.2/**`、`packages/ir/src/**`、`packages/parser/src/**`（sch 解析器）、`tests/schemas/**`、ADR（并入 P0 的 sch ADR 或单开一条）。

**验收**：

- 少写一个 pin 归属 → schema 校验失败并给出位置。
- 一个 pin 既属于 net 又标 no_connect → 报错。
- 第三方实现只做 schema 校验 + 展开，就能保证"没有悬空引脚"。

**注意**：

- **不要因此出现第二个真源**：net 成员表是唯一真相，pin 侧只用引用表达归属，不要把成员复制进 pin 记录。
- dnp 与 no_connect 是不同的东西：no_connect 是"这个引脚不接"，dnp 是"这个器件不贴"（§4.2、[ADR-0002](adr/0002-board-pages-and-bom.md) decision：变体不影响 ERC 结果）。**别合并。**

---

## F9. 事实层禁止表达式 / 生成器在语言之外（**已定**）

**现状**：**决策已写成 [ADR-0017](adr/0017-fact-layer-no-expressions.md)**（Accepted，2026-10-22），语言层与文档已同步：

- `AGENTS.md` §5.1 硬规则新增第 7 条（事实层没有表达式）、第 2 条补"主形式只有表格一种，不引入链式记法"；§5.3 的"生成器/循环"行指向 ADR-0017 D3；§11 Q1 已定（不引入链式）、Q2 保留待定但判据已写死。
- `teda.md` §1 第 1 条与 §15 的"生成器/循环/条件""表达式语言"两行指向 ADR-0017。

**ADR-0017 的决策**：D1 值是终值字面量（带单位），D2 事实层无控制流，D3 生成器在语言之外、产物是表；D4 划清边界（组合层与值层不受限），D5 给出可检查判据（每个 token 都要能回答"它描述了哪个硬件事实"），D6 写死修订条件，D7 不引入链式。

**剩下的**：只有一条——**修订条件是否被触发**。触发器是 §10 十用例里的"20 路电源域"（语料见 F12，**已决定延后**）。在语料跑完之前，§11 Q2 保持待定（ADR-0017 明说不关它）。真要修订时：另起 ADR + 迁移说明 + 迁移脚本，0.x 期间是该类型版本线上的一个 PATCH（[ADR-0022](adr/0022-language-versioning.md) 附录 A2）。


## F10. 库包规范与分发（registry 前置）

**现状**：[ADR-0015](adr/0015-licensing-and-open-standard.md) 承诺"让别人围绕它建工具"。但**光有语言规范不够**——别人要建工具，第一件事是"我从哪拿封装库"。Cohdl 的做法是 `registry.cohdl.org`（命名空间、包、精确版本钉死、`cohdl search`）加 LSP 加 VS Code 扩展加 Explorer 应用。TextEDA 侧还没有任何"分发"概念：`assets/components/` / `assets/symbols/` / `assets/footprints/` 只存在于本地工程，库引用靠 `project.toml` 的 `[libs.<name>]` 指向本地路径或 `project:` 库（[ADR-0010](adr/0010-footprint-and-3d-model-ownership.md) 的内容哈希锚点），**没有跨工程、跨组织的库获取方式**。

**为什么现在做**：这是"别人建工具"的真正入口——第三方要做 KiCad 侧 / PLM 侧 / CI 侧工具，第一件事是"我从哪拿封装库"。库规范定不下来，工具就无从下手。

**要做的事**（先只做规范，不做服务）：

1. 定**库包格式与边界**：一个库包 = 若干 `.teda`（器件 / 符号 / 封装）+ `library.toml`（元数据、版本、内容哈希、依赖）。格式与契约层**同构**（同源语法、同一套诊断）。
2. 定**版本与锚点**：库版本怎么标（内容哈希 vs 语义版本）、怎么钉死（`project.toml` 的 `[libs]` 里已有 `content_hash` 雏形）、怎么升级。
3. 定**获取方式的抽象**：v0.1 只要求"本地路径 + 内容哈希"可解析，**不实现 registry 服务**；但要留出 `source` / `rev` 字段（§9 已列），让未来的 registry 只是这个字段的一个取值。
4. 定**第三方库的要求**：库文件必须过 schema、必须能导出成 KiCad、必须能过 `lib:verify`（[ADR-0013](adr/0013-reference-project-self-built-libraries.md)）；不合规不收。
5. 复用 F7 的错误码与 F8 的 schema 义务——**库是契约层的延伸，不是另一个标准**。

**涉及**：`spec/`（库包规范）、`schemas/ir/v0.2/**`（库 manifest）、`AGENTS.md` §9（`[libs]` 键的最终形态）、ADR（并入 [ADR-0011](adr/0011-library-format-and-footprint-ir.md) 的补充或单开）、`examples/reference-project/project.toml`（样例）。

**验收**：

- 一个第三方库包能被解析、校验、导出，且 `content_hash` 可复现。
- 库规范里没有"只能官方提供"的要求。

**注意**：

- **先规范后服务**：不要一上来就写 registry（那需要长期运维，cohdl 走了很多年）。先把"库包长什么样、怎么钉版本、怎么验证"定死。
- 库能不能被用起来，取决于**库的覆盖率与质量**，不取决于注册表的 UI。优先把"自建库能自动生成"（[ADR-0010](adr/0010-footprint-and-3d-model-ownership.md) 的 agent 生成路线）做扎实。
- 与不变量 19 对齐：库规范属契约层，永久开放。

---

## F11. 源码位置（span）机制：诊断要能指到行列（**已定，实现未落地**）

**现状**：**决策已写成 [ADR-0020](adr/0020-source-spans.md)**（Accepted，2026-10-22），实现为零。ADR-0020 的决策：

| # | 决策 |
|---|---|
| D1 | **span 不进 IR**：打乱行序后 IR 仍字节相同（`AGENTS.md` §10 的验收） |
| D2 | 编译期产出「IR 路径 → 源 span」映射，用完即丢（**不落盘**） |
| D3 | span 形状：`file`（相对工程根）+ `line`（1-based）+ `col`（1-based **Unicode 标量列**）+ `byte`（0-based 字节偏移）+ 可选 `end`（同字段，右开） |
| D4 | 粒度是**记录级**（该记录首 token），不是 token 级 |
| D5 | 引用类诊断带两处点：`location` = 引用点，`related[]` = 定义点 |
| D6 | 评审 GUI 要的「身份 → 位置」索引是**另一个产物**（附注类，不进工程哈希），形状留待 F34 定；本阶段不写盘 |
| D7 | 位置只对**当次解析的那份文件**有效；`fmt` 之后要重新解析 |
| D8 | schema 违规同时给源位置（`location`）与 IR 路径（`cause.instancePath`） |

**实现要做的事**（ADR 已定，这里是工程）：

1. `packages/parser` 的内部结构在编译成 IR 之前保留来源路径，编译时剥掉；同时产出 D2 的映射表。
2. `packages/ir` 的 `DiagnosticLocation` 加可选 `byte` 与 `end`（**IR 契约 `schemas/ir/v0.2/**` 不动**——位置不是语义契约的一部分）。
3. 语义检查器与 schema 校验器的诊断接上 D8：源位置 + IR 路径两条都给。
4. 位置稳定性测试：同一份源两次解析位置一致；打乱行序后 IR 字节不变而诊断位置指向新行号。
5. 跨文件引用的 `related` 落点（引用点 + 定义点）。

**注意**：

- **不要为了位置把源文本复制进 IR**（[ADR-0004](adr/0004-ir-representation.md) 明令：IR 不复制源文本与注释）。span 是位置元数据，且**不进 IR**。
- 列号的字符语义（中文、`Ω`、`±` 怎么算列）已在 ADR-0020 D3 写死，第三方实现按它算。
- 评审 GUI（F34）依赖的是 D6 的身份索引，不是 D2 的源映射；两者别混。


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
   ├── <描述>.teda    # 源描述（可能多份：sch + view + pcb + component）
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

## F13. 层次（`module` / 参数）：模块层已落地，参数与嵌套仍延后

**现状（2026-10-22 更新）**：**模块层已落地**（语言 0.8）——规范 `spec/module.md`、决策 [ADR-0026](adr/0026-modules-compose-boards.md)、解析器（`packages/parser`：`design/modules/` 段 + `module` 文件 + 端口绑定 + 展平进板级 IR）、canonical formatter、CLI（`loadBoard` 读 `design/modules/`，`check` / `compile` / `ir` 走同一路径）。参考工程里 `charger-buck` 板已改写为"两个模块 + 板级器件"。

这一条原来是"层次是设计里唯一自指闭环的部分"（`AGENTS.md` §4.2 说有 module/参数/import，`teda.md` 说"草案见 `AGENTS.md` §5.3"，§5.3 又指回 `teda.md`）。那个闭环已经拆掉：模块有规范、有语法、有解析器、有用例。

**已定并已实现的约束（2026-10-21 讨论定，2026-10-22 落地）**：

1. **层次只在源码层，IR 存展平结果**——展平口径由 module 自己定义（旧的页面展平机制已随语言 0.7 撤销，见 [ADR-0025](adr/0025-flat-board-and-print-pages.md)）。IR 里不留 module 结构，否则第三方实现要额外实现 module 解析 / 展开 / 端口解析三套语义。**已落地**：IR 契约不变（仍是 0.2 的平表），模块只存在于源码层。
2. **module 是唯一的层次**：有 ports，展平命名用 `<instance_id>.<net>`（[ADR-0024](adr/0024-level-tags-in-flattened-names.md)），未连接端口必须显式（与 F8 的 pin 归属三态同构）。**外层 id 的层级标记**：module 实例用 `M` 开头（`M1.R1`）；`P`（页面）已随页面机制撤销，`MOD` 不用（[ADR-0025](adr/0025-flat-board-and-print-pages.md) decision 5）。**已落地**：模块实例 id `M1`、展平实例 `M1.R1`、展平 net `M1.VFB`；端口用 `no_connect` 显式悬空。
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
- §7 的"规模 >100 器件上下文爆炸"由展平后的净表 + 打印页分块缓解，层次只是其中一种手段。

**注意**：

- 层次是源码层机制，越晚定越便宜——sch 解析器与展平口径没定之前定层次，等于在没学会走路前学跑步。（模块层是在展平口径定版之后才落的。）
- 不要用层次去解决"文件太长"：表长不是问题，**一行一个事实**才是问题；层次会把"可见的事实"变成"要展开才可见的事实"。
- 引入层次时，F9 的"事实层无表达式"仍然成立：层次是替换机制，不是表达式机制。

---

## F14. `fab` 的目标形态：制造中立数据是契约层，KiCad 只是兼容方案（**已定**）

**现状**：**决策已写成 [ADR-0034](adr/0034-manufacturing-output-target-form.md)**（Accepted，2026-10-22）。它把 [ADR-0018](adr/0018-zero-dependency-and-manufacturing-target.md) decision 3 的一行展开成可实现的形状：

| 决策 | 内容 |
|---|---|
| D1 | **派生为主**：能从 `pcb` + `sch` + 采购主料算出来的，一律算，不重写（§7 的"重复描述"坑） |
| D2 | 数据内容：身份（板/变体/`source_hash`/`tool_version`）、BOM 行（`component_id` + 参数字典 + 变体状态 + 选中料）、位号+坐标+朝向+面、层叠与规则意图、制造附加 |
| D3 | **不含**：铜箔图形（在 `pcb` IR 里）、订单事实（试产/量产/数量/订单号）、**评审状态**（会随时间变，进了包就破坏"两次编译逐字节相同"） |
| D4 | 按 **板 × 变体**，**规范分片**（进工程哈希）；备选料仍是附注（[ADR-0030](adr/0030-procurement-layer.md) D5b） |
| D5 | 制造包**自描述**：文件名带板/变体/哈希前缀，载荷带完整 `source_hash` + `tool_version`（不变量 11）；IR 树仍是稳定名 + manifest 记哈希 |
| D6 | **门是流程不是格式**：试产永不阻断；量产要求每轮评审"有交代"（关闭或明确接受并记录），工具只报告不阻断 |
| D7 | **拼板不做**，但槽位存在（空则省略，不变量 18），以后加是加法 |
| D8 | 制造附加的**来源位置**（`fab` 描述类型是否存在）随实现定——§11 Q17 收窄后的形态 |
| D9 | 写出器读 `pcb` IR，不读制造中立数据；不自研 CAM 判定 |
| D10 | 制造产线**零依赖**：不装 KiCad 也能走完 |

**顺带关掉** [ADR-0033](adr/0033-review-records-and-attribution.md) 的一个开放点（"未关闭的评审轮次是否阻断制造出口" → 不阻断；量产的门是"有交代"）。

**剩下的**（P3 实现时）：

1. `spec/fab.md` + 分片 schema：字段名、单位、省略规则、变体语义（ADR-0034 的开放点）。
2. 编译器产出该分片（`boards/<board_id>/fab.json` 或等价路径），并纳入工程哈希。
3. 制造附加的来源（若 P3 阶段要写拼板或装配说明，§11 Q17 就要给最终答案）。
4. 打包格式（目录 / 归档 / 文件集）是导出器的事，ADR-0034 只定命名与身份。

**注意**：

- **不要让"制造中立数据"变成 KiCad 工程文件的翻版**（§7 的"pcb 变成 KiCad 的翻版"同款坑）——ADR-0034 D3 就是这条的守门。
- 制造中立数据一旦公开就是契约层（[ADR-0015](adr/0015-licensing-and-open-standard.md) 不变量 19），别为了排他性把它关起来。
- **零依赖是硬要求**（[ADR-0018](adr/0018-zero-dependency-and-manufacturing-target.md) / 不变量 20）：这条产线不得依赖 KiCad 才能跑通，KiCad 只是可选后端。
- **评审不是闸门**——不要在工具里加"评审未关闭就拒绝出包"的检查（ADR-0034 D6）。

## F15. 自研 Gerber / Excellon 写出器（零依赖制造出口）

**现状**：制造出口的当前路径是 IR → KiCad → Gerber / Excellon（[ADR-0005](adr/0005-manufacturing-output.md)）。**目标形态已定**（[ADR-0034](adr/0034-manufacturing-output-target-form.md)）：制造中立数据**不含铜箔图形**，所以写出器的输入只有 `pcb` IR 与层映射表，制造数据里的层叠/规则意图只是随包走的意图，不是几何来源。这要求用户安装 KiCad，与 [ADR-0018](adr/0018-zero-dependency-and-manufacturing-target.md) 的零依赖原则（不变量 20）冲突：TextEDA 的目标是"装 TextEDA 就能走完描述 → 校验 → 渲染 → 制造包"。

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

- 在**没有 KiCad 的机器上**跑通 `texteda export gerbers <board>`，产出分层 Gerber + 钻孔文件。
- 与 KiCad 产物在层集合、孔位、图形数量上一致（对照测试）。
- 同一 IR 两次导出逐字节相同。

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
- BOM 的参数值要人读（`10k` 而不是 `10000000 µΩ`），所以需要"规范单位 → 显示值"的换算；**规范单位表只有一份**（[ADR-0008](adr/0008-ir-shard-identity-and-hash.md) decision 4），不要在导出器里另抄一张。
- 变体（DNP / 不贴）还没进 IR，BOM 的"变体状态"这一列先留空，等 P3。

---

## F17. `project.toml` 与 `system` 描述的解析（语言表面的最后两块）

**现状**：语言表面还差两块没实现——`project.toml`（项目元数据：名称、版本、板列表、变体、库引用）与 `system`（板间连接）。`scripts/lib/project.ts` 里有一份只够库校验用的手写 TOML 读取，不是解析器；`system` 描述完全没有代码。`sch` 解析器已经能读板文件，但**读不到板列表**，所以跨板校验（teda.md §11 第 9 条：两侧电压区间不相交报错）做不了。

**要做的事**：

1. **`project.toml` 解析**：按 AGENTS.md §9 的键表实现（`[project]` 必填三项、`[boards.*]`、`[variants.*]`、`[libs.*]`、`[compliance]`、`[ext]`）；未知顶层键报错；不写时间戳、绝对路径、随机 ID、派生数据。
2. **`system` 描述解析**：段只有 `boards` 与 `nets`；成员是 `<board_id>.<port_id>` 引用，不是引脚引用。校验项见 teda.md §8.1/§8.2 与 §11 第 9 条。
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

**现状**：**sch 级已落地**（[ADR-0019](adr/0019-agent-contract-reference-and-check-entry.md)）。`bun run check <项目目录>` 遍历工程里的全部板（`design/sch/<board>.teda`），逐板解析 → 语义层 ERC → 契约层 schema 校验，诊断走 [ADR-0016](adr/0016-diagnostic-error-codes.md) 的统一载荷（`code` / `severity` / `location` / `data` / `hint`），`--json` 打到 stdout、人读模式打到 stderr；有 error 退出码 1，只有 warning 退出码 0。器件文件解析失败（`syntax.component-invalid`）与器件文件头 id 与文件名不一致（`ref.component-id-mismatch`）也走同一条通道。

**还没做的**：

1. `project.toml` / `system` / `pcb` 的解析还没接进 `check`（`pcb` 描述本身还没实现；`project.toml` 与 `system` 是 F17）。
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

1. 建 `packages/core`（[ADR-0009](adr/0009-implementation-stack.md) 已规划：纯函数，禁 `Bun.*` 与 `process.env`），把 ERC 规则作为独立阶段放进去：输入是解析结果，输出是 ERC 诊断。
2. `packages/parser` 只出语法与语义层面的"读不出来"（器件找不到、引脚不存在这类解析失败），不出规则违规。
3. ~~`texteda check` 的载荷里区分两类~~ **已落地（第一步）**：诊断按**域**归到三个阶段（`parse` / `contract` / `semantic`），载荷带 `countsByStage`，`check` 的人读输出也打印阶段分布。不需要调用点声明阶段——域是封闭词表，一个域只可能属于一个阶段。剩下的是真正的迁移：把 `net` / `drc` 域的规则从 parser 挪进 `packages/core`。

**第二步已落地**：`packages/core` 建包，连通性四条规则（`drc.single-member-net` / `net.pin-in-two-nets` / `net.pin-unassigned` / `net.no-connect-connected`）移出 parser，改成纯函数 `checkConnectivity(facts)`——吃展平后的 net、每个实例的引脚、带端口的 net 集合与定位回调，不认识语法也不碰 fs。parser 只负责摆事实（约 25 行），行为等价（参考工程仍是 79 警告，`pin-in-two-nets` 的定位从"板文件首行"变成该 net 的真实行）。规则自带 8 条单测，不需要构造 `.teda` 源。

**还剩**：`ref.duplicate-port-net` / `ref.port-net-undecided` / bus 相关规则仍长在 parser 里；`check` 的编排也还在 CLI。真正的收口是让 `core` 提供 `analyzeBoard()`（parse → ERC → 契约），CLI 只剩读文件与打印。

**为什么现在做**：F16（网表导出）与 LSP 都要复用同一套检查；规则散在 parser 里时，每加一个导出格式就要抄一遍判断。

**注意**：规则**保持代码**，不做规则 DSL（AGENTS.md §11 Q2/Q9：表达式与生成器都推过）。外移的是**边界**，不是表达方式。

## F20. IR 契约参考的字段说明补齐 + `pcb` 分片

**现状**：`docs/ir-reference.md`（[ADR-0019](adr/0019-agent-contract-reference-and-check-entry.md)）已生成，每个字段一行（类型 / 必填 / 单位 / 说明），联合类型按分支展开（`constraint（type=voltage）` …），文末有"缺说明"清单。**非 pcb 分片已 100% 覆盖**（common / component / schematic / manifest / system / project / symbol / footprint）；**`pcb` 分片还剩 81 个字段没说明**，而 `pcb` 描述本身还没实现。

**要做的事**：

1. 给 `schemas/ir/v0.2/pcb.schema.json` 的字段补 `description`（`pcb` 描述落地时一并做，否则会返工）。
2. 把"缺说明字段数"变成一个门槛（`gen:check` 或 CI 里卡覆盖率），防止新字段裸奔。

**注意**：description 是**契约的一部分**（写的是这个字段装什么），不是文档润色；补它等于把 IR 语义写进唯一真源。补说明时若给 `$ref` 加兄弟 `description`，生成器必须开 `unreachableDefinitions`，否则命名类型会被内联掉（[ADR-0019](adr/0019-agent-contract-reference-and-check-entry.md)）。

## F21. pcb 描述：绑定校验、`fmt`、参考工程的 pcb

**现状**：`pcb` 12 段的解析已落地（`packages/parser/src/pcb.ts` → `schemas/ir/v0.2/pcb.schema.json`，`texteda compile <dir> <id> --pcb`）。覆盖面是规范 §1–§6 的全部段与 10 种规则；`stackup` 顺序/编号、板厚与叠层之和、板框闭合与自交、重复放置、重复 pad 对都在解析期报。

**没做的三件**：

1. ~~**绑定校验**~~ **已落地（规则 1–5）**：`packages/core/src/binding/checks.ts` 的 `checkBinding()`，接在 `texteda check` 里（有 `design/pcb/<board>.teda` 就跑）。覆盖：未知实例、未放置 pad、跨 net 短接（`net_tie` 可豁免）、未布线（warning）、未知 net。**还差**规则 6–8（`rules`/`trace` 的层名与 net 存在性已做，`physical_only` 的 `fiducial` 不得挂 net、`deviation` 白名单类型完整性）与规则 10–11（多边形自交已在解析期做，丝印层枚举已做）。**已补**：声明的偏差进报告（`net_tie` = note、`split_ground` = warning，ADR-0035 D10；`packages/core` 已在 `texteda check` 里输出）。另按 [ADR-0035](adr/0035-connectivity-authority-and-reverse-engineering.md) D2 的口径补三条：**白名单封闭**（四类之外的差异一律 error，不是 warning）、`stitching`（跨层）与连接两个不同 net 的过孔按 `net_tie` 处理。（`test_point` 已于 2026-10-22b 退役，见 F38。）
2. ~~**`pcb` 的 canonical formatter**~~ **已落地**：`packages/parser/src/fmt-pcb.ts`，`fmt --check` 已覆盖 pcb（参考工程的 `design/pcb/charger-buck.teda` 已重排成 canonical）。三条不变量都有测试：`parse(fmt(x))` 与 `parse(x)` 产出**逐字节相同**的 IR、`fmt(fmt(x)) == fmt(x)`、注释原地保留。**canonical 归一口径在解析器里**（`connect` 对内排序、`trace` 折线方向、`rules` 类型序），formatter 复用同一口径——否则 IR 与源文件会各排各的。
3. ~~**参考工程的 pcb**~~ **已有**：`examples/reference-project/design/pcb/charger-buck.teda`（放置 M2 页 9 个器件 + `connect` + `trace`/`via`/`zone` + `rules`/`silk`），跑 `check` 零诊断。含两个真实约束，已补进实现与规范：**同一段可以重复出现**（该文件把 `trace` 分了两段，行按出现顺序拼接）、**段头独占一行**。

**注意**：`via` 既是段名又是 `rules` 的行首列，语法上靠"段头独占一行"消歧（已写进 `spec/pcb.md` §1）。加新段名时要检查是否与规则类型/物理实体类型重名。

## F22. `symbol` / `footprint` 的 IR 分片不记录语言版本

**现状**：语言版本方案已定（`MAJOR.MINOR[.PATCH]`，`1.0` 是里程碑，决策见 [ADR-0022](adr/0022-language-versioning.md)），版本判定集中在 `packages/parser/src/version.ts`。但 IR 分片之间不一致：`schematic` / `pcb` / `schematic-view` / `project` / `component` / `system` 六个分片带 `format`（以及 `common` 定义的 `format_version`），**`symbol` 与 `footprint` 两个分片一个版本字段都没有**——它们只带 `ir_version`（IR 契约自己的版本，与语言版本无关）。

**为什么要补**：分片自描述是第三方实现的入口条件（[ADR-0019](adr/0019-agent-contract-reference-and-check-entry.md)）。读到一个 `symbol` 分片的人无法知道它是用哪个语言版本产的，也就无法判断"这个分片里的东西在当前语言版本下是否还成立"。现在影响很小（`symbol` / `footprint` 自 `0.5` / `0.4` 起没有新构造），但分片之间不一致本身是个坑。

**要做的事**：

1. 给 `schemas/ir/v0.2/symbol.schema.json` 与 `footprint.schema.json` 加 `format`（或引用 `common` 的 `format_version`），与其它分片对齐——**先定用哪个名字**，别一个用 `format` 一个用 `format_version`。
2. 解析器写入规范化的版本号（补丁位为 0 时省略，`0.6` 与 `0.6.0` 存成同一个字符串）。
3. 这是 **IR 契约变更**：`ir_version` 要不要跟着动（当前 `0.1`）按 [ADR-0008](adr/0008-ir-shard-identity-and-hash.md) 的分片约定决定，别顺手改。
4. 补 `tests/schemas/` 的正反例与 `bun run gen` 生成的类型。

**注意**：不要在没有 ADR 的情况下把语言版本和 `ir_version` 绑在一起——两者回答的是不同问题（"这份描述能用什么构造" vs "这个分片的形状我还认不认"）。

## F23. "从零到板"的 skill：一步一步建一个 TextEDA 工程

**现状**：零件齐了，**路径没连起来**。仓库里有走完前半程要用的每一样东西，但没有一条被验证过的、从空目录走到成品的路径。

- `texteda init <dir>` 只给骨架（`project.toml` + `assets/components/` `design/sch/` `design/pcb/` `design/system/` `docs/`），**不含任何器件、符号、封装或原理图**。
- 库的写法分散在三处：`docs/symbol-authoring.md`（符号）、`docs/footprint-authoring.md`（封装）、`teda.md` §6（器件）。**没有一份"一个工程该有哪些文件、它们怎么互相引用"的总账**。
- 命令有四条（`init` / `compile` / `check` / `netlist`），但**没有一条把它们串起来的脚本**；用法只能从源码里读。CLI 也**没有 `export` 子命令**——KiCad 符号/封装导出只能走仓库脚本（`bun run export:symbol` / `export:footprint`），而且它们吃的是**IR JSON 不是 `.teda`**：`compile:symbol` / `compile:footprint` 先出 JSON，`export:symbol` 再拿 JSON **加 `--component <器件文件>`** 合并引脚事实（引脚的电学事实归 `component`，符号只写视图，[ADR-0012](adr/0012-symbol-description.md)）。这条两步链没人写在文档里，是最容易踩的地方。
- **终点缺两块**：`.kicad_pcb` 板文件导出器**不在仓库里**（`docs/trial-run/charger-buck/` 那份是**一次性原型**生成的，README 明写"未进仓库"）；Gerber / Excellon 写出器也没有（F15）。
- 所以今天能走通的最远终点是：`init → 库 → 器件 → sch → check → 网表 / .kicad_sym / .kicad_mod`。**skill 不能假装能走到 Gerber**。（这条链已手工试跑通过：`init` → 两个无源件 → 三实例的最小板根 → `check` 零 error 零 warning → `compile` 出 IR → `netlist` 出连通性投影 → `compile:symbol` + `export:symbol` 出 `.kicad_sym`。）

**要做的事**：

1. 写 `docs/skills/new-project.md`：**给 agent 的操作手册**（**英文**——skill 是 agent 读的操作手册，不是设计文档，见 AGENTS.md §12 的语言例外）。每一步 = 一条命令 + 预期输出 + **失败时怎么办**（指到诊断码与修复动作，不写"照着做"）。步骤：`init` → 建符号/封装/器件 → 写板文件与打印页 → `texteda check` → `texteda compile` → 导出网表与 KiCad 库。**每条命令都必须真的能跑**（由第 2 条逐条验证）。
2. 写 `scripts/skill-new-project.ts`：把上面那串步骤做成**可执行、可断言**的脚本——在临时目录里从零建一个最小工程（一条电源轨 + 一路分压 + 一颗去耦），跑 `check`（必须**零 error**）、导出网表与符号/封装，并断言：产物存在、**同输入逐字节相同**（`init` 的确定性契约要一路守到终点）。这是 skill 的**可执行形态**：文档会烂，脚本不会。
3. 给它 `bun run skill:new-project`，并**接进门禁**（`bun test` 的一个 case，或并进 `scripts/verify-libs.ts` 那一串）。**不接进门禁的 skill 等于没有**。
4. 终点分两段接：**先到 `.kicad_pcb`**（依赖第 5 条的板文件导出器），**再到 Gerber / Excellon**（F15）。skill 每一步都要标出"这一步依赖什么"；依赖没到的步骤就写到"到此为止"，**不要写仓库里并不存在的命令**（"然后在 KiCad 里导出 Gerber"这种是给 KiCad 用户的，不是给本仓库的）。
5. **板文件导出器单独立项**（`pcb` IR → `.kicad_pcb`）：把 `docs/trial-run/charger-buck/` 那个一次性原型收进 `packages/exporter`（确定性：uuid 由内容派生），一并生成 `.kicad_pro` 与 `fp-lib-table`（设计规则在工程文件里，不在板文件里——见 `docs/trial-run/charger-buck/README.md` 的实测结论）。**这一步不做，skill 的终点就只能停在网表**。

**注意**：

- skill **不定义语言、不改 schema**，只描述"按现有契约怎么把一个工程建起来"。所以它必须**跟着语言版本走**：语言加了新段、新描述类型，skill 的模板要跟着改（版本方案见 [ADR-0022](adr/0022-language-versioning.md)）。
- skill 相对"教程"的唯一增量是**出错时怎么办**——教程给顺序，skill 给诊断码与修复动作（"错误信息是产品"，AGENTS.md §12）。每一步都要能回答"这一步失败了，看哪个码、改哪里"。
- **别把 skill 写成"复制参考工程改改"**：那会让人绕过 `init` 契约与自建库的边界（[ADR-0010](adr/0010-footprint-and-3d-model-ownership.md) 的 `project:` 库约定），也绕过了"每个文件最小化"的写作纪律。
- 这条 skill 是 F12 十用例语料的**种子**：先把"最小可跑工程"这条路径钉死并做成脚本，再扩到 BGA、多电源域、差分对那些难例。

## F24. IR 分片树剩下的三种分片（`project` / `component` / `system`）

**现状**：`bun run texteda ir <工程目录>` 已经写出整棵分片树——`boards/<board_id>/{schematic,pcb}.json`、`boards/<board_id>/view/<page_id>.json`、`assets/symbols/<lib>/<id>.json`、`assets/footprints/<lib>/<id>.json`，外加 `manifest.json`（每片 sha256 + 工程哈希），布局与哈希规则见 [ADR-0023](adr/0023-ir-layer-on-disk.md)。但 [ADR-0008](adr/0008-ir-shard-identity-and-hash.md) decision 1 里定的另外三种分片**一片都没有**：

- `project.json`——`project.toml` 的 IR 投影（字段对字段：`name`/`version`/`format`/`description`/`license`/`status`/`default_variant`/`authors`/`links`/`boards`/`variants`/`libs`/`compliance`/`ext`）。**`project.toml` 至今没有解析器**（F17）。
- `assets/components/<component_id>.json`——器件描述的 IR 分片。`assets/components/**` 今天只有只读事实读取 `readComponentFacts`（给符号/封装导出合并引脚用），**没有 IR schema 的生产者**；`schemas/ir/v0.2/component.schema.json` 在，但没人往里填语义。
- `systems/<system_id>.json`——多板连接描述的 IR 分片。`system` 描述**连语法都没有**（只有 `teda.md` 的一段与 schema）。

**要做的事**：

1. `project.toml` 解析器 → `project.json` 分片（连带 `project.toml` 的解析错误诊断码，`域.slug` 形式，登记进 `packages/ir/src/diagnostics/codes.ts`）。
2. `component` 描述的 IR 投影 → `assets/components/<component_id>.json` 分片（引脚的电学事实仍归 `component`，符号/封装只存视图，[ADR-0012](adr/0012-symbol-description.md)）。
3. `system` 描述的语法与解析器 → `systems/<system_id>.json` 分片（`system` 描述进不进语言本身见 `AGENTS.md` §11 Q7 / F17）。
4. 三种分片进 `manifest.json` 后，**工程哈希的含义会变**——哈希覆盖的分片集合变了，旧哈希与新哈希不可比。这不是 bug，但**要写进迁移说明**（`AGENTS.md` §2 不变量 10 要求破坏性变更附迁移说明）。
5. 每种新分片都要补 `tests/schemas/` 正反例，并过 `bun run gen:check`。

**注意**：

- **不要为了"树看起来完整"而写空分片**：没有生产者的类型不能出现空目录或空分片（[ADR-0023](adr/0023-ir-layer-on-disk.md) decision 2）。
- 分片路径与源码目录一一对应（`assets/components/<component_id>.json` ↔ `assets/components/**/<component_id>.teda`，`systems/<system_id>.json` ↔ `design/system/<system_id>.teda`），不要另发明映射表。
- 这条不是"补三个文件"，是"补三种描述的解析器"——工作量在解析器，不在写 JSON。

---

## F25. 器件拆成 part / family，器件资产归到 `assets/`（ADR-0027 的落地）

**现状**：`component` 一种类型同时表示"具体料"（`ch32v307vct6`，`mpn` 齐全）与"通用模板"（`c-0402`，取值落在实例行），两者的区别只靠 `category` + `params` 含 `value` 的约定；目录上 `assets/symbols/project/`、`assets/footprints/project/` 带库名层，`assets/components/` 把族与料混在一起。决策见 [ADR-0027](adr/0027-device-parts-families-and-library-dependencies.md)，**未落地**。

**要做的事**：

1. **语言层**：`component` 增加必填 `kind`（`part` / `family`）；`part` 要求 `mpn`、`family` 禁止 `mpn` 且 `params` 至少有一列参与身份（`value`）；新增 `construction`（开放词表）与 `polarized`（`yes`/`no`）两个标量字段；语言版本到 **0.9**，`teda.md` §6 改写。
   - **引脚表是身份分界**（[ADR-0027](adr/0027-device-parts-families-and-library-dependencies.md) decision 3）：引脚表变了就是另一个器件；只有不改引脚表、不改引脚行为的属性才允许进 `params`（value / tolerance / 耐压 / ESR / 温度档）。`package` 与 `footprint` 是 part / family 的固定属性，**不是** `params`。
   - **一封装一 part**（decision 4）：同一 die 的多个封装 = 多个 part 文件，各自写**完整**引脚表；不做引脚表合成、不做多封装 part。
2. **目录迁移**（机械部分）：`assets/symbols/project/*` → `assets/symbols/*`，`assets/footprints/project/*` → `assets/footprints/*`；`assets/components/passives/c-0402.teda` → `assets/families/cap-0402.teda`（族 id 不带值、带构造）；`assets/components/passives/xtal-8mhz-3225.teda` 等有真 MPN 的 → `assets/components/*` 并标 `kind: part`；`project.toml` 的 `[libs.project]`（自建库的 `symbols`/`footprints` 键）删除，自建资产变成项目自有目录。**目录按归属分组的完整迁移见 F29**（本条只管器件这一半）。
3. **迁移脚本**：`bun run migrate:0.9 <项目目录>`，仿 `scripts/migrate-0.7.ts`；**族 id 的改名由作者决定，脚本不替人命名**（`c-220u` → `cap-tantalum-7343` 这类要在报告里列出来等人确认）。
4. **命名空间**：`instances` 行支持 `lib:id` 限定名（库内件必须限定，项目件可裸写）；解析顺序：项目 `assets/components/` → 项目 `families/` → 库。
5. **variant 作用域**：`packages/core` 的 ERC 里，变体按 `component_id` 生效只对 `kind: part` 成立；族只能按实例作用域（DNP/替代料指到具体实例）。
6. **`params` 语义校验**：编译期检查 `params` 列不承载"改引脚表/改引脚行为"的属性（人工判定不了的部分靠约定 + 库级检查）；`part` 的 `package` / `footprint` 与 `family` 的固定封装不得出现在 `params` 里。
7. **`procurement/` 描述类型**：新描述类型（族+规格 → 料），带 parser 与 fmt；BOM 行键统一为 `(component_id, 参数字典)`（part 的参数为空）。**格式已定**（[ADR-0030](adr/0030-procurement-layer.md) 已 Accepted，语法见 `spec/procurement.md`），**实现见 F35**。
   - **主料 / 备选分离**：主料在 `assets/procurement/primary/<board_id>.teda`（**规范分片**，进工程哈希与板哈希，决定 BOM 与制造包）；第二货源在 `assets/procurement/alternatives/<board_id>.teda`（**附注分片**，进 IR 但**不进工程哈希**，另聚合成 `advisory_hash`）——换备选不触发重建、不作废已评审的制造包。备选违反硬约束（封装不等、不是 part、无 `mpn`）报 **warning**，不阻断构建；主料违反则是 error；备选文件的**语法错**仍是 error（文件坏了）。
8. **IR 契约**：`schemas/ir/v0.2/component.schema.json` 加 `kind` / `construction` / `polarized`，契约版本到 **v0.3**（纯增量），跑 `bun run gen` 重生成类型，`tests/schemas/` 补正反例。

**验收**：

- `bun run migrate:0.9` 后参考工程仍 `bun run check` 通过、`bun run lib:verify` 全绿、`bun run fmt:teda --check .` 退出 0。
- 变体对族的作用域有专门用例：族级 DNP 报错，实例级 DNP 通过。
- 库件限定名与裸名解析各有用例；库内件不限定时报"必须限定"而不是"找不到"。

**注意**：

- **`component_id` 语义变了**（族 id 不再带值），哈希与 BOM 口径都变 → 属于 [ADR-0022](adr/0022-language-versioning.md) 里的 MINOR 变更，要写迁移说明。
- `packages/ir` 的诊断码表要新增码（`域.slug` 形式），登记进 `packages/ir/src/diagnostics/codes.ts`，跑 `bun run gen` 更新 `docs/error-codes.md`。
- 别顺手把"库"塞进项目树：**外部库是依赖，但依赖要 vendored 进树**（`external/libs/<name>/` + `libref` 钉版本），并且它的资产**进 `dist/ir/`**（规范分片）——IR 必须自足，见 [ADR-0031](adr/0031-project-tree-ownership-model.md) decision 6。`[libs]` 表项本身已从 `project.toml` 移走。

---

## F26. 库的信任模型：provenance、免责条款、派生覆盖（ADR-0028 的落地）

**现状**：`bun run lib:verify` 只校验项目自建库（引用可解析、引脚号与焊盘号对齐、KiCad 可读、DRC 0 违规）；库没有版本、没有来源标注、没有免责、没有"项目纠正库" 的机制。决策见 [ADR-0028](adr/0028-library-trust-and-derived-overrides.md)，**未落地**。

**要做的事**：

1. **`provenance` 字段**：`component` 增加 `provenance`（`generated` / `reviewed`），未声明按 `generated` 处理；`reviewed` 必须带 `verified_by` / `verified_on`；`kind: part` 且 `provenance: generated` 时 `datasheet` 必填。
2. **库清单 `lib.toml`**：`name` / `version` / `generated` / `reviewed` / `disclaimer`；库发布时清单必填。
3. **派生覆盖**：`component` 增加 `overrides`（指向被覆盖的 `lib:id`）；派生的 `component` / `family` 必须是**完整**的一份（不是 patch），且要声明自己的 `provenance`。
4. **严格模式**：`texteda check --strict-provenance`（或 `project.toml` 开关）下，引用 `generated` 的库件报错，诊断里给库名、件号与 datasheet 指针。
5. **`lib:verify` 能跑外部库**：对库目录跑同一套三方对齐（symbol 引脚号 == footprint 焊盘号 == component 引脚号）与 canonical 检查。
6. **库 vendoring 与哈希校验**：`external/libs/<name>.toml`（`libref`：`name`/`source`/`rev`/`content_hash`/`channel`）要能被 CLI 消费——`texteda lib add <name>@<rev>` 拉取并落进 `external/libs/<name>/`，校验 `content_hash`，不匹配即报错；**编译期不联网**。库资产进 `dist/ir/`（规范分片），见 [ADR-0031](adr/0031-project-tree-ownership-model.md) decision 6。

**验收**：

- 一个引用 `generated` 库件的项目在严格模式下报错、在普通模式下通过，诊断文案含库名与 datasheet 链接。
- 派生覆盖后：库内容哈希不变；项目内该件的事实等于派生文件；`lib:verify` 仍全绿。
- `content_hash` 被改动时 CLI 明确报错而不是静默继续。

**注意**：

- 免责条款是**库自己发布的**内容（`lib.toml`），不要让 CLI 替库作者生成法律文本；CLI 只校验字段在位。
- 派生覆盖是"复制 + 声明关系"，不要做成字段级 patch（合并结果不是任何文件写下的内容，读者要自己算合并才知道真相）。
- 库的注册表与分发格式仍未定（见 F10），本条只做"引用一个已在本地的库"这一段。

---

## F27. `package` 字段删除、3D 模型改挂 part（ADR-0029 的落地）

**现状**：`component` 同时写 `package LQFP-100` 与 `footprint project:lqfp-100`（同一事实写两遍，无校验）；3D 模型按 `model` 行挂在 **footprint** 文件上（[ADR-0010](adr/0010-footprint-and-3d-model-ownership.md)）。决策见 [ADR-0029](adr/0029-package-code-footprint-and-3d-model-ownership.md)，**未落地**。

**要做的事**：

1. **`component` 去掉 `package` 字段**：`teda.md` §6 改写；`packages/parser` 的 `component` 解析器读到该字段即报错（字段已不存在，不要静默忽略）；`schemas/ir/v0.2/component.schema.json` 去掉 `package`（契约 v0.2 → v0.3）。
2. **`footprint` 增加 `package_code`**：`spec/footprint.md` 与 `packages/parser` 的 footprint 解析器；`schemas/ir/v0.2/footprint.schema.json` 加字段。封装代号（`0402` / `SOT-23-5` / `LQFP-100`）落在 land pattern 文件里，footprint id 通常已经带它。
3. **3D 模型改挂 part**：`component` 增加可选 `model <相对路径>`；`footprint` 解析器**拒绝** `model` 行（迁移脚本负责搬）；**footprint 的 IR 分片与 schema 去掉 `model3d`**（`schemas/ir/v0.2/footprint.schema.json` 现在还有它），`packages/exporter` 也不再往 `.kicad_mod` 写 `(model ...)`。`spec/footprint.md` §6.1 的 `model` 行要删。
4. **3D 模型文件的存放位置**：放在提供该 part 的树里（项目或库），例如 `3dmodels/<id>.step`，被 `content_hash` 覆盖（[ADR-0010](adr/0010-footprint-and-3d-model-ownership.md) decision 5）。库哈希的计算范围要相应调整（`scripts/libhash.ts` 现在只算 `assets/symbols/` + `assets/footprints/`）。
5. **导出的 footprint 是纯 2D，没有变体**（ADR-0029 的 2026-10-22 附录已定）：KiCad 输出是给**板厂**的派生产物，最多给人 review，不当工作环境——KiCad 自己的 footprint 也不绑 part。所以导出的 `.kicad_mod` **不带 3D 模型**，一个 land pattern 一个文件，**没有封装变体**，导出器重新变成 footprint IR 的**纯函数**（`export footprint --part` 不做）。3D 身体留在 part / family 文件里，用在有 part 上下文的地方：我们自己的 3D 预览与装配层、板级导出（每个实例可带自己的模型路径）。可选：land pattern 可附一个**封装外形**（包络，按 land pattern 唯一，也不产生变体）。
6. **KiCad 输出里不再有 3D 身体**：今天 `.kicad_mod` 带 `(model ...)`（来自 footprint 的 `model3d`），去掉后 KiCad 里只看得到 2D。
   补法有两条：**封装外形**（land pattern 可选地附一个封装标准外形——IPC/JEDEC 的通用件——按 land pattern 唯一、**不产生变体**，但那是外形不是厂商件，要标出来），或**板级导出时按实例写模型**（`packages/exporter` 目前只出 `.kicad_mod` / `.kicad_sym`，**没有板导出**，所以这条要等 F16 / F21）。**已定：做封装外形**（[ADR-0029](adr/0029-package-code-footprint-and-3d-model-ownership.md) 的 2026-10-22b 附录）——见下面第 8 条。
7. **封装外形（envelope）**：`footprint` 增加可选 `envelope <path>`（封装标准外形，IPC/JEDEC 通用件，不是厂商件）；导出时写进 `.kicad_mod`（`packages/exporter` 的 `modelSexp` 那条路改成写 envelope）。**一个 land pattern 一个 envelope → 不产生变体**，导出器仍是纯函数。允许的条件：身体由封装决定（MLCC、贴片无源、标准封装的集成电路）；钽电解薄膜电容、模压屏蔽电感、连接器、带引线框架的分立件**不允许**（身体随额定值变）。检查在 `lib:verify`：用了带 envelope 的 land pattern 的 part，其 `construction` 属于身体随额定值变的那一组 → 报错。
8. **不做装配约束**：语言里不加 `body_height` / `body_size` 等机械尺寸，也不做限高检查（限高要配合外壳，外壳不在项目里）。这条要写进 `docs/footprint-authoring.md`，避免以后有人"顺手加个高度字段"。

**验收**：

- 迁移后参考工程 `bun run check` / `bun run lib:verify` / `bun run fmt:teda --check .` 全绿。
- 同一 land pattern 上的两个不同厂商器件（可用钽电容 / 电解电容构造）各自持有自己的 `model`，互不覆盖。
- 给 `footprint` 文件加 `model` 行 → 解析器报错并指向 ADR-0029。
- 给 `component` 留 `package` 行 → 解析器报错。

**注意**：

- **这是 ADR-0010 的修订**（3D 归属），但 ADR-0010 decision 1（语言里没有尺寸字段）**不变**——本次不引入任何尺寸字段。
- 契约从 v0.2 升到 v0.3 是同一批（`kind` / `construction` / `polarized` / 去 `package` / 加 `package_code`），别分两次升。
- **别把 model 挂回 footprint**：导出器保持 footprint IR 的**纯函数**（2026-10-22 附录改了 decision 3 的方向——原来"导出器需要 part 上下文"这条已被推翻，因为 KiCad 输出只给板厂与评审，`.kicad_mod` 是纯 2D land pattern）。
- 身体信息仍然是 part / family 的事实，只是**不写进 KiCad 库文件**；写它进 KiCad 的动机只能是"想给 KiCad 用户看形体"，那用**封装外形**，不用厂商件。

---

## F28. 分片的规范 / 附注之分与双哈希（ADR-0023 修订 + ADR-0030 的落地）

**现状**：`dist/ir/` 的 manifest 逐片记 `sha256`，工程哈希 = **全部**分片按路径排序后 `<path>:<sha256>\n` 拼接的 `sha256`；没有"规范 / 附注"的概念，也没有第二个哈希。决策见 [ADR-0023](adr/0023-ir-layer-on-disk.md)（2026-10-22 修订）、[ADR-0008](adr/0008-ir-shard-identity-and-hash.md) decision 5 与 [ADR-0030](adr/0030-procurement-layer.md) decision 12，**未落地**。

**要做的事**：

1. **分片分类**：manifest 的 `shards` 每项加 `normative: true | false`。分类是**文件级**属性（一个源文件 → 一个分片 → 一个分类，[ADR-0008](adr/0008-ir-shard-identity-and-hash.md) decision 1），所以采购层拆成两个目录：`assets/procurement/primary/<board_id>.teda`（规范）与 `assets/procurement/alternatives/<board_id>.teda`（附注）。
2. **双哈希**：工程哈希 = 规范分片聚合；新增 `advisory_hash` = 附注分片聚合（同算法、同形状）。板哈希不变（板分片恒为规范）。
3. **manifest schema**：`schemas/ir/v0.2/manifest.schema.json` 加 `normative` 与 `advisory_hash`（契约 v0.2 → v0.3，与 F25 / F27 同批升）。
4. **`texteda ir --json` 载荷**加 `advisory_hash`；人读摘要要能一眼看出"构建身份"与"采购状态"两个不同的数。
5. **盖章规则**：Gerber / 网表 / BOM 主料行盖 `project_hash`；采购附注盖 `advisory_hash`（`AGENTS.md` §2 不变量 11 的追溯口径要按产物类型分）。
6. **陈旧检查**：`texteda check` 比对当前 `advisory_hash` 与采购附注里盖的那个 → 不一致报 warning（"采购附注已过期"）。
7. **文档**：把"哈希标识构建、不标识工程文件集合"写进 `AGENTS.md` §2 不变量 18 与 §9、§10 的哈希口径；`docs/skills/new-project.md` 若提到哈希，同步。

**验收**：

- 只改 `assets/procurement/alternatives/*.teda` → `advisory_hash` 变、`project_hash` **不变**，Gerber / 网表字节不变。
- 改 `assets/procurement/primary/*.teda` → `project_hash` 变。
- manifest 里每片都有 `normative`，且两类分片的聚合互不串。
- 同一工程两次编译仍逐字节相同（含附注分片）。

**注意**：

- **哈希口径变了**：旧工程哈希与新工程哈希不可比（集合不同了），这是 [ADR-0022](adr/0022-language-versioning.md) 意义上的口径变更，要写迁移说明。
- 别把"附注"当成垃圾桶：凡是**构建产物依赖**的内容必须是规范分片。判据：改它会不会让已签发的制造包作废？会 → 规范；不会 → 附注。
- 附注分片仍然要写盘、仍然要校验（备选里的 part 停产、封装漂移会被发现），只是不进工程哈希。

---

## F29. 目录按归属分组：`assets/` `external/` `design/`（ADR-0031 的落地）

**现状**：**树的机械重排已落地**（2026-10-22）——目录按归属分组（`assets/` `external/` `design/` `views/`），参考工程、CLI 路径、`texteda init` 骨架与文档同步改完；`bun run check` / `lib:verify` / `fmt --check` 全绿。**未落地**：`libref` 描述类型、库 vendoring、`families/`（F25）、采购层（F35）；外部库仍只有 `project.toml` 的 `[libs]` 一条引用、既不进树也不进 IR。决策见 [ADR-0031](adr/0031-project-tree-ownership-model.md)。

**要做的事**：

1. **树的重排**（机械部分）：`assets/symbols/` `assets/footprints/` `families/` `assets/components/` → `assets/**`；`procurement/` → `assets/procurement/`；`design/sch/` `design/pcb/` `design/modules/` `design/system/` → `design/**`；`views/<board_id>/<page>.view.teda` → `views/<board_id>/<page>.view.teda`（见 F30）；新增 `external/{libs,simulation}/`（`cache/` 不建，由使用者自建且 gitignore）。参考工程与 CLI 里的路径同步改。
2. **`libref` 描述类型**：`external/libs/<name>.toml`（`name` / `source` / `rev` / `content_hash` / `channel`）；新 spec `spec/libref.md`、新 schema `schemas/ir/v0.3/libref.schema.json`、parser 与 fmt；`project.toml` 的 `[libs]` 表项删除（[ADR-0008](adr/0008-ir-shard-identity-and-hash.md) decision 6）。
3. **库 vendoring**：`texteda lib add <name>@<rev>` 拉取、落进 `external/libs/<name>/`、算 `content_hash`、写 `libref`；编译期不联网；库资产进 `dist/ir/`（规范分片）。
4. **分片布局与源码树解耦**：分片按种类固定（`boards/` `assets/symbols/` `assets/footprints/` `families/` `assets/components/` `procurement/` `librefs/`），映射由每片的 `source.file` 承担（[ADR-0023](adr/0023-ir-layer-on-disk.md) decision 2 修订）；挪源码目录不改分片路径、不改工程哈希。
5. **`texteda init`** 建新骨架：`assets/{symbols,footprints,families,components}`、`assets/procurement/{primary,alternatives}`、`external/{libs,simulation}`、`design/{sch,pcb,modules,system}`、`docs/`。
6. **迁移脚本**：与 F25 的 `bun run migrate:0.9 <项目目录>` **合并成一次迁移**（同一批路径变更、同一次跑），脚本负责挪目录与改 `project.toml`，不替人命名、不替人决定库版本。
7. **`external/cache/` 纪律**：厂商数据手册 PDF 放这里，gitignore；`check:public` 要能发现误提交的 PDF（今天查的是历史与工作区，新增这条要确认覆盖到新路径）。

**验收**：

- 迁移后参考工程 `bun run check` / `bun run lib:verify` / `bun run fmt:teda --check .` 全绿，且 `texteda ir` 的工程哈希与迁移前**按分片口径**一致（分片路径变了但内容没变——这正是解耦的验收点）。
- 一个引用了 vendored 库的项目：库件能解析（`<lib>:<id>`）、库资产的 `content_hash` 对不上时报错、`dist/ir/` 里含库的符号与封装分片。
- 只把某个源文件在树里挪个目录 → 分片路径**不变**；工程哈希**也要不变**——这要求每片另带一个**内容哈希**（去掉 `source` 引用后的字节），工程哈希聚合它而不是落盘字节。**未落地**（随契约 v0.3 批次一起做，见 F28 的 manifest 改版）。

**注意**：

- **树冻结**：这次改完目录形状就不再动；要改形状得再开 ADR + 再写迁移脚本（[ADR-0031](adr/0031-project-tree-ownership-model.md) decision 11）。
- **外部材料分三类，机制不同**：库 vendored + 进 IR；数据手册只留引用（`datasheet` 字段）+ 本体在 cache，不进 IR；仿真模型 vendored 但机制未定（ADR-0031 开放点）——别给它们发明同一套声明格式。
- 别把 `external/` 当成"第二个 assets/"：它按**归属**分，不按**种类**分。

---

## F30. 打印页移到 `views/`，分片改为附注类（ADR-0032 的落地）

**现状**：**搬家已落地**（2026-10-22）——打印页文件在 `views/<board_id>/<page_id>.view.teda`（独立根目录，不再与板文件同目录），参考工程与 CLI 的扫描路径已改。**未落地**：分片分类（打印页分片仍是规范类，随板哈希走——挪一个标签就改板哈希与工程哈希）、盖章、交叉校验、文档同步。决策见 [ADR-0032](adr/0032-view-is-a-drawing-not-a-build-input.md)。

**要做的事**：

1. **搬家**：**已落地**——打印页从板文件同目录（`design/sch/<board_id>/`）挪到**独立根目录** `views/<board_id>/<page_id>.view.teda`；参考工程与 CLI 的扫描路径已同步。分片路径 `dist/ir/boards/<board_id>/view/<page_id>.json` **不变**（分片布局与源码树解耦）。
2. **分类**：打印页分片改为 **advisory**（不进工程哈希、不进板哈希）；`advisory_hash` 同时聚合采购备选与打印页。判据不变：改了会不会让已签发的制造包作废。
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

## F31. 每种描述类型一条版本线，`0.x` 阶段只走 PATCH（ADR-0022 附录的落地）

**现状**：`version` 是全语言共享的一个号，文件的 `version` 表示"读我至少要语言 0.几"；接受规则的上界是语言版本（[ADR-0022](adr/0022-language-versioning.md) decision 3）。今天在飞四个号：`schematic 0.8`、`view 0.7`、`symbol 0.5`、`component 0.1`（另有 `pcb 0.4`、`footprint 0.4`、`system 0.2`、`module 0.8`、`procurement 0.9`）。**规则已定，实现未落地**（[ADR-0022](adr/0022-language-versioning.md) 的 2026-10-22 附录与 2026-10-22b 附录）：0.x 阶段每条类型版本线只走 PATCH、全局号停在 `0.9`（新类型也诞生在 `0.9`）、`1.0` 是保留号、`1.0` 之后改表面是新的 MAJOR（`2.0`）、`0.x` 期间号码可以重新给。

**要做的事**：

1. **接受规则按类型**：上界改成**该描述类型当前支持的版本**（不再是全语言版本）；MAJOR 的比较也按类型；下界（类型诞生版本）不变；PATCH 仍不参与判定。`packages/parser/src/version.ts` 改成带"类型 → 当前版本"表的接受函数，各描述解析器传自己的类型。**表里的号是冻结的**（`schematic 0.8`、`view 0.7`、`symbol 0.5`、`component 0.1`、`pcb 0.4`、`footprint 0.4`、`system 0.2`、`module 0.8`、`procurement 0.9`），新类型加一行 `0.9`。
2. **`0.x` 阶段只走 PATCH 位**：加段、加字段不再抬 MINOR；`teda.md` §13.1 / §13.3 / §13.4 已改（见 ADR-0022 的 2026-10-22 附录）。
3. **收敛计划**：项目接近完成时，所有类型一次性合并为 `1.0`（一份 ADR 记录），之后全语言一个号、表面冻结、只出 PATCH。触发条件：所有类型无待做的表面变更 + 十个困难用例语料存在（F12）。
4. **文档**：`AGENTS.md` §2 不变量 10、`teda.md` §13 同步（已改）；`docs/skills/new-project.md` 若提到版本号，同步。

**验收**：

- `view` 文件写 `version 0.8`（高于 view 自己的当前号 0.7）→ 报 `format.unsupported-version`，而不是接受。
- `symbol` 文件写 `version 0.5`（等于自己当前号）→ 接受。
- 同一工程里四种类型各写各的当前号 → `texteda check` 全绿。

**注意**：

- **安全依据是"未知构造默认报错"**（`AGENTS.md` §2 不变量 7）：`0.x` 阶段版本号不再精确标注"这个文件可能用了哪些新构造"，工具遇到不认识的构造会报错停下，不会误读。别因为"版本号不再细"就去实现"忽略不认识的段"——那是把兼容性的担子从诊断挪到了静默里。
- IR 的 `format_version` 仍存文件声明的版本（canonical 写法）；IR 契约版本 `ir_version` 依旧独立（[ADR-0008](adr/0008-ir-shard-identity-and-hash.md) decision 1）。

---

## F32. 派生覆盖改为"遮蔽"，族可挂通用 3D 身体（ADR-0028 / ADR-0029 附录的落地）

**现状**：`component` 允许 `overrides` 指向库件；库与派生件同时存在于工程 IR 里（两个 id、两个来源）；族不允许挂 3D 模型。决策见 [ADR-0028](adr/0028-library-trust-and-derived-overrides.md) 与 [ADR-0029](adr/0029-package-code-footprint-and-3d-model-ownership.md) 的 2026-10-22 附录，**未落地**。

**要做的事**：

1. **遮蔽语义**：派生件在**本工程内**替换被覆盖的库件；被遮蔽的库件不得再被任何 `instances` / `ports` / `constraint` 引用，引用即报错（"这个件已被工程的派生件遮蔽"）。库里的原件保持不变，供别的工程使用。
2. **派生件是 advisory**：校验报告里显式列出"工程与所依赖的库不一致之处"，不阻断构建，但必须看得见。
3. **几何不覆盖**：`component` 的 `overrides` 只能指向库里的 `component` / `family`；指向 `symbol` / `footprint` 报错（共享几何的爆炸半径太大，改法是上游修 + 抬 pin）。
4. **通用身体 = land pattern 的 `envelope`**（[ADR-0029](adr/0029-package-code-footprint-and-3d-model-ownership.md) 的 2026-10-22b 附录，取代本条原先的"族挂通用身体"）：`family` **不**带 `model`；通用身体写在 land pattern 上（一个 land pattern 一个 → 无变体）。允许条件：身体由封装决定（`mlcc`、贴片无源、标准封装的集成电路）；`tantalum` / `electrolytic` / `film` / `molded` / `shielded` 那组不允许（身体随额定值变）——检查在 `lib:verify`（part 的 `construction` × land pattern 的 envelope）。`part` 自己的 `model`（厂商件）在有 part 上下文的地方（3D 预览、装配、板级导出）压过 envelope。
5. **通用身体要标明是通用身体**：3D 预览与装配输出标出"这是该族的通用身体（附构造）"，不是厂商模型（ADR-0028 的诚实口径用在几何上）。

**验收**：

- 工程派生覆盖库里的 `tps5430ddar`，BOM 里只有一行；再有一处 `instances` 引用 `lib:tps5430ddar` → 报错（被遮蔽）。
- 派生覆盖出现在校验报告的 advisory 段里。
- `family`（`construction = mlcc`）带 `model` → 接受；`family`（`construction = tantalum`）带 `model` → 报错并指向 ADR-0029 的附录。

**另外两条已定的边界（实现时别顺手加）**：

- **`die` 不进语言**（ADR-0027 的 2026-10-22 附录）：part 文件里**不要**加 `die` 字段。die 是硅的事实，ERC / BOM / 布局 / 网表都不读它；它的用处只在生成器与库自身的封装一致性检查里，都在语言之外。工程级的"U1 与 U2 同一 die"写进 `docs/` 的装配说明，不进 IR。
- **view 要留**（ADR-0032 的 2026-10-22 附录）：`view` 文件是人写的内容，**不得**被"按需生成"或重绘覆盖；板 ↔ 打印页不一致由交叉校验（F3）报出来，人来改。

**注意**：

- 遮蔽是**工程内**的语义，不改库：库里的那份对别的工程仍然有效，库的 `content_hash` 不变。
- 别把遮蔽做成"合并两个文件"——合并的结果不是任何文件写下的内容（ADR-0028 已否过 patch 式合并）。
- 通用身体的判定靠 `construction`，而 `construction` 是**开放词表**：工具只查它认识的几个，其余信任作者（未知词表给 warning，不阻断）。

---

## F33. 评审记录：Markdown 意见 + TOML 处置（ADR-0033 的落地）

**现状**：评审记录没有地方放——工程树里没有评审目录，`check` 也不知道一块板有没有被人提过意见、有人认领。库件的复核有 `provenance` / `verified_by` / `verified_on`（[ADR-0028](adr/0028-library-trust-and-derived-overrides.md)），但**设计评审**完全没有记录。决策见 [ADR-0033](adr/0033-review-records-and-attribution.md)，**未落地**。

**要做的事**：

1. **约定文档** `docs/review-records.md`：目录 `docs/reviews/`（评审记录归 `docs/`，与设计意图、分析证据同处，[ADR-0031](adr/0031-project-tree-ownership-model.md) decision 1）、一轮一个 `<round_id>.md`（意见）+ 一个 `<round_id>.decision.toml`（处置）、note 行的写法、两条检查的语义。**不进语言**：没有描述类型、没有 schema、没有 IR 分片、不影响任何哈希。
2. **处置文件**：TOML，字段 `target`（`board:<id>` / `page:<board>/<page>` / `component:<id>`）、`owner`、`date`、`verdict`（`accepted` / `declined` / `deferred`）。缺字段或取值非法 → 报错。
3. **责任人**：`project.toml` 的 `[project] owner`（创建者或接手人）。有评审记录但没写 owner → 报错。换人 = 改这个字段（不改任何哈希）。
4. **`check` 的两条诊断**：
   - **未闭环**：`docs/reviews/*.md` 没有对应的 `*.decision.toml` → warning，载荷带 target、作者、日期、意见原文。
   - **处置人不是责任人**：`decision.owner` ≠ `project.toml` 的 `owner` → warning（要么越权处置，要么换人没更新 `project.toml`）。
   两条都**不让 `check` 失败**、不改任何哈希（是否挡住制造出口是 ADR-0033 的开放点，归 F14）。
5. **意见是散文，工具不解析**：note 行只被人读；机器只读处置文件里的那几个事实。

**验收**：

- 放一个只有意见、没有处置的评审 → `texteda check` 报一条 warning（未闭环），含 target、作者、日期、意见；工程哈希不变。
- 补上处置文件（owner 与 `project.toml` 一致）→ warning 消失。
- `decision.owner` 写成别人 → 多一条"处置人不是责任人"warning。
- 有评审但 `project.toml` 没有 `owner` → 报错。
- 处置文件缺 `verdict` 或 verdict 取值非法 → 报错并指向 ADR-0033。

**注意**：

- **不签名**：评审记录的归属由版本控制给出，作者与责任人字段是给读者看的。签名只在**库分发**里可能有意义，最多库级、覆盖 `content_hash`，现在不做（ADR-0028 / ADR-0033 的附录）。
- 意见（notes）是散文，**不解析**每条意见挂在哪个实例 / net 上，也不做逐条处置——处置是**按轮次**给的（ADR-0033 的开放点）。
- `owner` 是人名，不要写团队名；"谁的意见、谁的决定"要能追到人。
- `project.toml` 的解析本身还没落地（**F17**），本项与 F17 一起做。
- **评审不进 IR**：因此 F28 的附注类分片只有采购备选一种，别把评审塞进 `advisory_hash`。

---

## F34. 评审 GUI（`packages/viewer`）：高亮指针、跳转源码、三种模式

**现状**：评审 GUI 未建（[ADR-0021](adr/0021-schematic-view-layer.md) decision 3 / 4）；`packages/renderer` 能出打印页 SVG，`bun run preview view <board>/<page>` 能看图，但**没有交互**，也没有 `packages/viewer`。决策见 [ADR-0021](adr/0021-schematic-view-layer.md) 的 2026-10-22 附录，**未落地**。

**要做的事**：

1. **`packages/viewer`**：浏览器应用，`texteda review <工程目录>` 起本地服务（`node:http`，ADR-0021 decision 3；文件读写留在 CLI 侧，浏览器只收 JSON + SVG）。
2. **元素 id**：渲染器给每个绘制对象发稳定 id（`instance:U1` / `net:VCC` / `label:...`），SVG 里落成 `data-ref`。这是 renderer 侧的小改动，**渲染器仍然纯**（不知道 hover 与点击）。
3. **hover 高亮**：纯 CSS/SVG 层（描边 / 透明度 / 小浮层），**不重绘、不重排**——性能不构成压力；不做命中测试几何、不做空间索引。
4. **点击跳转**：需要**身份索引**（`identity -> [(file, line, col), ...]`），来自 **span 侧车表**（`dist/ir/<shard>.spans.json`）——**依赖 F11 / ADR-0020**。点击后给出「这个身份定义在哪里」的短菜单（sch 的实例行 / view 的摆位 / 器件文件 / 封装文件 / net 行 / pin 行），选中即打开该文件到该行。
5. **三种模式**：`review`（读图 + 高亮 + 跳转 + 写意见）、`placement`（PCB 画布：摆位、板框、courtyard、net 高亮）、`edit`（分栏：源码文本 + 画布；点画布移动文本光标，改文本刷新画布，**编辑发生在文本里**）。切模式换 SVG 与覆盖层，不重新实现交互。
6. **意见锚点（可选）**：note 行允许 `[instance:U3]` 这样的可选前缀，只有 viewer 解析——与 ADR-0033「工具不解析散文」的张力是 ADR-0033 的开放点。

**验收**：

- hover 一个符号 → 该符号高亮并显示身份（实例 id、器件、封装），**SVG 不重新生成**（渲染一次后只看 DOM 变化）。
- 点击一个符号 → 出现「定义位置」菜单，至少含 sch 实例行与 view 摆位两项；选中后打开对应文件并定位到行。
- `review` / `placement` / `edit` 三个模式都能用，且共用同一套高亮与跳转代码。
- `edit` 模式改文本 → 画布更新；画布上不做任何直接编辑（没有拖动、没有吸附）。

**注意**：

- **GUI 不写设计**：改东西一律改文本。画布能改就意味着同一件事有两个写入口，而没有 diff 的那个会赢。
- **F11 是前置**：没有 span 侧车表就没有"跳到源码"。F11 的交付物要包含 **身份索引**（不只诊断用的 IR 路径索引）。
- 别在 viewer 里做布局求解或走线——那是渲染器与布线器的事（AGENTS §1）。
- `placement` 模式依赖 PCB 画布（`packages/renderer` 的 PCB SVG，F21），**在那之前这个模式可以先空着**（如实报"还没有 PCB 画布"，别用 sch 画布顶替）。

---

## F35. 采购层的实现（ADR-0030 的落地）

**现状**：**格式已定并落档，实现为零**。规范见 `spec/procurement.md`（新），决策见 [ADR-0030](adr/0030-procurement-layer.md)（Accepted，2026-10-22；开放点已全部关闭），语言 0.9 新增 `procurement` 描述类型。**没有**解析器、**没有** `fmt`、**没有** IR 契约条目（`schemas/ir/v0.3/procurement.schema.json` 待写）、**没有** BOM 输出、**没有**选料检查。

**要做的事**：

1. **解析器 + `fmt`**（`packages/parser`）：`procurement` 类型；头部三行（`version` / `procurement <board_id>` / `role`），`role` 必须与所在目录一致；唯一段 `selections`；行文法 `<family> <params…> -> <part>` 与 `<family> <params…> -> not-required`（[ADR-0030](adr/0030-procurement-layer.md) 2026-10-22b 附录：选料有三态——已选 / 未选 / **不需要采购**；`not-required` 是保留目标，不是件 id）；canonical form 按左键文本排序、**不对齐**（`teda.md` §12 规则 3 的例外）。
2. **IR 契约**：`schemas/ir/v0.3/procurement.schema.json`（新）+ 重生成类型；分片路径 `boards/<board_id>/procurement.json`（规范）与 `boards/<board_id>/procurement-alternatives.json`（附注）；**契约 v0.2 → v0.3 与 F25 / F27 / F28 同批升**（别分两次升）。
3. **选料检查**（`packages/core`）：`spec/procurement.md` §3.2 的六条（族是族、件是件、件有 `mpn`、件的 `params` 覆盖族的、件的 `footprint` 等于族的、件不是被遮蔽的库件）；**主料违反 = error，备料违反 = warning**（严格模式 error）；族行没选料 → warning（unsourced）；族行写了 `not-required` → **不报**（这才是“本来就没有东西要买”，不是“还没买”）；选中的件板上没用到 → warning。
4. **BOM 输出**（`packages/cli`）：四种行（件行、有选料的族行、无选料的族行、明确不采购的族行）；行键统一为 `(component_id, 参数字典)`，件行的参数集为空；**无来源行：MPN 单元格留空，comment 列写 `unsourced`**；**不需要采购的行：MPN 单元格同样留空，状态写 `not-required`**（MPN 里塞 `n/a` 或标记会被下单系统当真去订——ADR-0030 D4 与 2026-10-22b 附录）。**工程自己的 BOM：`status` 列（`bought` / `unsourced` / `not-required`）与 `note` 列分开**，状态不与人的备注混在一格里；**下单格式的导出不加列**（列集由 [ADR-0006](adr/0006-jlc-prototype-delivery.md) D4 的规范定死），标记落在规范自带的 `Comment` 格里；JLC 形状的导出跟 F16 一起做。
5. **`texteda check --json`**：采购诊断进机器载荷（unsourced / 未使用的选料 / 备料违反 / 遮蔽件）。
6. **文档**：`docs/skills/new-project.md` 加一步"选料"；`AGENTS.md` §4.1 的状态行改成"已落地"；`docs/ir-reference.md` 由 `bun run gen` 重生成。

**验收**：

- 一块板有族行但没选料 → BOM 那行 MPN 为空、comment 是 `unsourced`；`check` 报 warning，**不**阻断。
- 同一块板上另一个族行写了 `not-required` → BOM 那行 MPN 为空、`status` 列是 `not-required`；`check` **不报** warning。
- 选一个 `footprint` 不同的件 → 主料里是 error、备料里是 warning。
- `fmt` 幂等，且**不**把选料行按列对齐。
- 只改备料 → `advisory_hash` 变、`project_hash` 不变（依赖 F28）；改主料 → `project_hash` 变。
- 选一个被工程派生件遮蔽的库件 → 报错。

**注意**：

- **前置依赖**：检查要用到 ADR-0027 的 `kind`（族/件）与 ADR-0028 的遮蔽语义（F25 / F32），先落它们。
- **类型版本是 0.9，工具当前支持到 0.8**（`packages/parser/src/version.ts` 的 `SUPPORTED_LANGUAGE`）：解析器落地前，`procurement` 文件会被判为"比工具支持的版本新"——这是对的，工具确实还不认识这个类型。
- 采购层是**决定**不是事实：别把价格、货期、供应商塞进描述里（ADR-0030 decision 9）。

---

## F36. 导入器：逆向工程 / 外部网表 → 本项目的源文件（**延后**）

> **2026-10-22：导入器相关的一切一并延后**——不只实现延后，**决策也延后**：读哪些格式、歧义怎么处理、推断怎么呈现，都在真要做的时候才定（[ADR-0035](adr/0035-connectivity-authority-and-reverse-engineering.md) D6 的方向保留，用来关掉"pcb only"那个问题；开放点一并延后）。延后期间不写半成品入口。

**现状**：**方向已定，实现为零**（[ADR-0035](adr/0035-connectivity-authority-and-reverse-engineering.md) D5/D6）。没有 pcb-only 模式：板必须有 sch；两个原本属于"pcb only"的场景由**导入器**承担——导入器是**语言之外的生成器**（[ADR-0017](adr/0017-fact-layer-no-expressions.md) D3），产物是表，评审对象是生成的 `sch`（对照原件检查），不是黑盒。

**要做的事**（触发后）：

1. 定范围：读什么（KiCad 工程？外部网表？纯几何？），写什么（`design/sch/` + `design/pcb/` + `assets/components/`）。
2. 从几何**推断**连通性：算法与置信度怎么表达；推断出的 net 名怎么起（用什么规则保证可读与唯一）。
3. 推断结果怎么呈现给人看：哪些是确定的、哪些是猜的（`docs/` 里的报告 + 生成文件里的注释）。
4. `assets/components/` 怎么来：外部网表只有 pin 名与网络，器件型号常常缺失 → 生成的器件是"通用占位"（`kind: family`？）还是标 `unsourced`（F35 的口径）？
5. 幂等与可复现：同一份输入两次导入的产物逐字节相同（不变量 18 的精神）。

**注意**：

- 导入器**不是** pcb-only 的后门：它必须产出 `sch`，之后的板和其他板一样 sch 优先。
- 不要把导入器做成"网表黑盒"：它写出的表必须可读、可评审、可手改（[ADR-0017](adr/0017-fact-layer-no-expressions.md) D3 的反面就是它）。

---

## F37. 封装的非电气焊盘（ADR-0035 D3 的落地）

**现状**：**未落地**。ADR-0035 D3 定了"器件有焊盘、器件没有引脚"的解法：电气焊盘 = 器件的一个引脚（器件与符号都要有）；非电气焊盘（散热片、屏蔽片、机械焊盘）= **封装声明**，且在 pcb 里不得挂 net（挂了是错误）。

**要做的事**：

1. `spec/footprint.md` §4：`pads` 段加非电气标记（尾列 `key=value` 形式，与现有 `zone` / `thermal_w` 等一致），语义写死：非电气焊盘不参与 `lib:verify` 的"焊盘号覆盖器件引脚"检查。
2. `packages/parser/src/footprint.ts` + `schemas/ir/v0.2/footprint.schema.json` 同步（**规范与实现同一次提交**）；封装类型版本线走 PATCH（[ADR-0022](adr/0022-language-versioning.md) 附录 A2）。
3. 绑定校验（`packages/core`）按新口径：非电气焊盘挂 net → error。
4. `lib:verify` 相应放宽。

**注意**：

- **不要把源文本复制进 IR**；非电气标记是语义（[ADR-0004](adr/0004-ir-representation.md)）。
- 器件侧的"电气焊盘 = 一个引脚"是 [ADR-0027](adr/0027-device-parts-families-and-library-dependencies.md) 的直接后果：引脚表变了就是另一个器件。

## F38. `physical_only` 实体要有位置；退役 `test_point` 形态（ADR-0035 D10/D11 的落地）

**现状**：**未落地**。[ADR-0035](adr/0035-connectivity-authority-and-reverse-engineering.md) 的 2026-10-22b 附录定了两件事：

- **测试点是器件，不是 net 的附属物**（D8/D9）：分界线是"它是不是某个 net 上的焊盘"。是 → `sch` 里的单引脚器件（不采购是 family，采购是 part），有位号、有封装、走普通 net 成员规则；不是 → `pcb` 的 `physical_only` 实体（过孔、安装孔、基准点、挖槽）。`physical_only` 的 `test_point` 形态**退役**，白名单从五类减为四类（`net_tie` / `split_ground` / `stitching` / `fiducial`）。
- **`physical_only` 实体现在没有位置**（D11）：语法与 IR 都只有 id / 类型 / 尺寸，没有坐标 → 安装孔、基准点、缝合过孔**放不进去**：渲染器画不出，制造数据也带不走。参考工程目前没用这一段，所以这个洞还没被踩到。

**要做的事**：

1. `spec/pcb.md` §4.11：`physical_only` 行加位置（`<x> <y>`），删 `test_point` 那一行与表里那一行，§5.2 规则 8 里 `test_point` 的半句删掉（白名单句已是四类 ✓）。
2. `packages/parser/src/pcb.ts` + `schemas/ir/v0.2/pcb.schema.json` 同步（**规范与实现同一次提交**）：`physical_only` 的 IR 加 `x_nm` / `y_nm`，删 `test_point` 变体。
3. **版本记账**：删 IR 变体是破坏性改动 → 随 `ir_version` 从 `0.2` 到 `0.3` 一起走（`schemas/ir/v0.2/` → `v0.3/`，重新生成 `packages/ir/src/generated/`），与 F25 / F28 的 v0.3 增量**合并成一次移动**，不要分两次。语言侧按 ADR-0022 A2 的口径：删除形态是"老文件不再合法"的改动 → 需要 pcb 描述类型的版本线前移一位（0.8 → 0.9），而**每种类型一条版本线**本身还没做（F31）→ 依赖 F31；迁移说明写进 `teda.md` §13（照 0.7 撤销 `page` 的写法）。
4. 绑定校验（`packages/core`）：`physical_only` 的 net 引用规则只剩 `stitching`；白名单完整性检查按四类。
5. 渲染器与制造数据：`physical_only` 实体要能画、能带坐标——**在 PCB SVG 落地之前**这条只能做一半（能编译、不能画），要在 backlog 里写清楚，不要假装已可画。

**注意**：

- 位置是**坐标**，不是几何：形状仍然归封装库（`AGENTS.md` §4.4 第 7 条）——`physical_only` 的实体只有简单图元（圆孔、圆点、矩形开槽），要自定义形状就写成器件。
- 退役是**清切**：不留兼容形态，不做"新旧都接受"；旧写法改成 `sch` 里的单引脚器件即可。
- 采购侧的尾巴（不在本项内）：不采购的单引脚 family 会产生一条"无来源"的 BOM 行（[ADR-0030](adr/0030-procurement-layer.md) D9、F35），板上测试点一多就是噪音——制造数据要不要收"非采购"行、family 能不能声明"这是板上特征不是器件"，还没定。
