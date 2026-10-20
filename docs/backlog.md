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

---

## F7. 诊断错误码注册表（`域.slug` + `--json` 载荷）

**现状**：诊断已经是产品（`AGENTS.md` §12「错误信息是产品」），`packages/parser` 有 `formatDiagnostic`，§10 要求"每条诊断含文件、行列、期望/实际、修复建议；提供 `--json` 输出"——但**诊断没有稳定标识**：文案一改，第三方实现就无法判断"我这条行为与 textEDA 是否一致"。对照 cohdl：它把错误码做成正式注册表（`docs/error-codes.md`），并用 `tests/error_registry.rs` 做**双向** completeness 检查（码表每行都要有真实 call site，代码里每个码字面量都要在码表里）——这个机制该抄。

**为什么现在做**：ADR-0015 把项目定位成**标准提案**，标准提案的第一要件是"行为可被第三方实现对齐"，而错误码是对齐行为的最小单位。趁 sch 的解析器还没写（目前只有 symbol / footprint / component），加编号成本最低；等板级描述落地、诊断条数翻倍再补，编号会返工。

**形式（已定，2026-10-21）**：`域.短 slug`，kebab-case slug，域取自**封闭词表**。

- **域按"错误的种类"划分，不按发现阶段**（cohdl RFC-011 的组织原则，他们最聪明的一条）：单位不匹配不管在哪一层发现，都是 `value.unit-mismatch`。
- **不用 `E+数字`**：数字无语义（`E1105` 是什么要查表）、分类边界只能靠文档裁决（cohdl 为"单位不匹配归 E1xx 还是 E4xx"专门写过 RFC-011，还留下 E402/E404 的 DEPRECATED 重定位）、分配需要中央仲裁。slug 自解释、分配无冲突、与 JSON Pointer 同族。
- **严重度独立于域**（`error` / `warning` / `note`）：涌现检查天然有 warning，不能因为"它是 DRC"就全是 error（学 cohdl 的 `D00x` 单独一块）。

**域词表（封闭）**：

| 域 | 覆盖 | 例码 |
|---|---|---|
| `syntax` | 词法 / 语法 / 解析 | `syntax.unexpected-token` |
| `value` | 值与量纲（§2.8） | `value.unit-mismatch`、`value.missing-unit` |
| `ref` | 引用与解析 | `ref.unknown-component`、`ref.anchor-mismatch` |
| `contract` | IR 契约 / schema（§2.7 未知构造报错） | `contract.schema-violation`、`contract.unknown-field` |
| `net` | net 完整性（§4.2 三态） | `net.pin-unassigned`、`net.member-unknown` |
| `bind` | sch↔pcb 绑定（§4.4） | `bind.pin-unmapped`、`bind.undeclared-deviation` |
| `library` | 库级（ADR-0013） | `library.pad-pin-mismatch`、`library.orphan-symbol` |
| `format` | 版本 / canonical（ADR-0008） | `format.unsupported-version`、`format.not-canonical` |
| `drc` | 涌现检查（ERC / DRC） | `drc.floating-net`、`drc.multi-driver` |
| `cli` | 调用层 | `cli.bad-flag` |

- 新增域要写 ADR（防域膨胀成"按文件分"）；`cli` 域的失败**不进 `--json` 诊断数组**，走 stderr + 退出码（抄 cohdl 的 E000 分类）。

**载荷（agent 与人各取所需）**：

```json
{
  "code": "bind.pin-unmapped",
  "severity": "error",
  "message": "U1.3 没有对应封装焊盘",
  "expected": "封装 sot-23-5 的焊盘号应覆盖 U1 的引脚号 {1,2,3}",
  "actual": "封装缺少焊盘 3",
  "hint": "删掉 components/regulators/tps7a02.teda 里 3 号引脚，或在符号里补上 3 号脚",
  "location": { "file": "sch/charger-buck/charger-power.teda", "line": 42, "col": 12 },
  "related": [ { "file": "components/regulators/tps7a02.teda", "line": 8 } ],
  "data": { "component_id": "tps7a02", "pin": "3", "footprint": "sot-23-5" },
  "cause": { "source": "ajv", "instancePath": "/pins/2", "keyword": "required" }
}
```

- `code` / `severity` / `location` / `data` = **机器契约**（agent 按 `code` 分支、按 `data` 自动修）。
- `message` / `expected` / `actual` / `hint` = **人读**（评审者据此改文件）。评审者不关心错误"背后怎么报错"，但必须知道**错在哪一行、期望什么、实际什么、怎么改**——别把"不关心实现机制"误读成"不需要建议"。
- `cause` 保底：textEDA 大量诊断来自 **schema 校验**（Ajv 报在 IR 上，给的是 `instancePath`）。保留原始 `cause`，**第三方实现直接用 Ajv 也能映射到 `contract.*` 码**，不必各自发明一套——这是 textEDA 相对 cohdl 的优势（它没有 schema 层，第三方必须逐条实现语义检查）。
- 可机械修的诊断再加 `fix`（`add-suffix` / `replace-token` / `remove-line` 等），给 agent 的 repair loop 抓手。

**要做的事**：

1. 单一真源：`packages/ir/src/diagnostics/codes.ts`（每条含 code、域、严重度、触发条件、建议模板、相关 spec/ADR 引用）。
2. `docs/error-codes.md` **由 `bun run gen:codes` 生成**（复用仓库已有的 gen 机制，ADR-0009），CI 用 `gen:check` 挡漂移——**不手写注册表**（cohdl 手写 md + 手写测试，能漂移）。
3. **双向 completeness 检查**（照抄 cohdl 的 `tests/error_registry.rs`）：
   - 码表里每条都有真实 call site（防"文档写了但没实现"）；
   - 代码里每个码字面量都在码表里（防"野生码"）。
4. 诊断结构统一到一个 `Diagnostic` 类型（parser / 语义检查器 / schema 校验三个来源），`--json` 输出带 `code`；`formatDiagnostic` 与注册表一致。
5. 生命周期规则写进 ADR：码发出即冻结（不可改义、不可重命名、不可复用）；语义变了 → 新码 + 旧码标 `[DEPRECATED → new.code]` 并保留旧行；允许"重定位"但新旧码必须指向同一语义；域词表封闭。
6. 写 `docs/adr/0016-diagnostic-error-codes.md`。

**涉及**：`packages/ir/src/diagnostics/**`、`packages/parser/src/**`、`packages/ir/scripts/**`（生成器）、`docs/error-codes.md`、新增 ADR、`tests/**`。

**验收**：

- 同一处错误在不同实现里用同一个码（码表是契约的一部分）。
- `--json` 的每条诊断都有 `code`，且 `data` 字段名稳定。
- 改了码表没重新生成文档（或反之）→ CI 失败。
- 码表里有一条没有 call site → CI 失败；代码里出现未登记的码 → CI 失败。

**注意**：

- 码表属**契约层**（不变量 19）：不许随实现关起来。
- 别把码做成粗粒度类别枚举（如 `type_error`）：粒度要细到"这一条行为"能被单独对齐。
- **位置（文件/行列）依赖 F11**：span 机制没落地前，诊断只能给到文件级 + IR 路径，别在这条里假装行列已经有了。
- 一次别铺满 100 个码：**按需增长**，码表从代码生成，新增码没有分配成本。

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
- dnp 与 no_connect 是不同的东西：no_connect 是"这个引脚不接"，dnp 是"这个器件不贴"（§4.2、ADR-0002 决策：变体不影响 ERC 结果）。**别合并。**

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

**现状**：ADR-0015 承诺"让别人围绕它建工具"。但**语言的标准不产生生态**——cohdl 的生态靠 `registry.cohdl.org`（命名空间、包、精确版本钉死、`cohdl search`）加 LSP 加 VS Code 扩展加 Explorer 应用。textEDA 侧还没有任何"分发"概念：`components/` / `symbols/` / `footprints/` 只存在于本地工程，库引用靠 `project.toml` 的 `[libs.<name>]` 指向本地路径或 `project:` 库（ADR-0010 的内容哈希锚点），**没有跨工程、跨组织的库获取方式**。

**为什么现在做**：这是"别人建工具"的真正入口——第三方要做 KiCad 侧 / PLM 侧 / CI 侧工具，第一件事是"我从哪拿封装库"。库规范定不下来，生态就是空谈。

**要做的事**（先只做规范，不做服务）：

1. 定**库包格式与边界**：一个库包 = 若干 `.teda`（器件 / 符号 / 封装）+ `library.toml`（元数据、版本、内容哈希、依赖）。格式与契约层**同构**（同源语法、同一套诊断）。
2. 定**版本与锚点**：库版本怎么标（内容哈希 vs 语义版本）、怎么钉死（`project.toml` 的 `[libs]` 里已有 `content_hash` 雏形）、怎么升级。
3. 定**获取方式的抽象**：v0.1 只要求"本地路径 + 内容哈希"可解析，**不实现 registry 服务**；但要留出 `source` / `rev` 字段（§9 已列），让未来的 registry 只是这个字段的一个取值。
4. 定**第三方库的要求**：库文件必须过 schema、必须能导出成 KiCad、必须能过 `lib:verify`（ADR-0013）；不合规不收。
5. 复用 F7 的错误码与 F8 的 schema 义务——**库是契约层的延伸，不是另一个标准**。

**涉及**：`spec/`（库包规范）、`schemas/ir/v0.1/**`（库 manifest）、`AGENTS.md` §9（`[libs]` 键的最终形态）、ADR（并入 ADR-0011 的补充或单开）、`examples/reference-project/project.toml`（样例）。

**验收**：

- 一个第三方库包能被解析、校验、导出，且 `content_hash` 可复现。
- 库规范里没有"只能官方提供"的要求。

**注意**：

- **先规范后服务**：不要一上来就写 registry（那是运维与法务问题，cohdl 走了很多年）。先把"库包长什么样、怎么钉版本、怎么验证"定死。
- 库生态的成败取决于**库的覆盖率与质量**，不取决于注册表的 UI。优先把"自建库能自动生成"（ADR-0010 的 agent 生成路线）做扎实。
- 与不变量 19 对齐：库规范属契约层，永久开放。

---

## F11. 源码位置（span）机制：诊断要能指到行列

**现状**：`AGENTS.md` §10 要求"每条诊断含文件、行列、期望/实际、修复建议"。但 textEDA 是"源码 → IR"的单向投影（ADR-0004 / ADR-0008），**IR 只含语义、不含源位置**——span 在投影里丢了。两个后果：

1. 语义检查器与 schema 校验的诊断只能指到"哪个文件"，指不到"哪一行哪一列"；
2. schema 校验（Ajv）报的是 **IR 上的 JSON Pointer**（`/pins/2`），评审者看不懂——他手里是 `.teda` 源文件，不是 IR。

对照：cohdl 的 IR 就是 AST，位置天生带着（它的包级诊断直接锚在 `cohdl.toml` 的行上）；tscircuit 同理。**这是 textEDA 独有的难点**——它刻意让 IR 与源分离（§3 的 S0/S1 分层），代价就是位置要另外解决。

**为什么现在做**：F7 要求诊断带位置，F8 会把一部分检查前移进 schema 校验——**schema 错误的位置就是 IR 路径**，没有 span 就只能给路径。agent 要自动改文件，**没有行列就没法做定点修改**，repair loop 无从下手。

**关键约束（这里有个真冲突）**：§10 明写"打乱行序、换单位写法、换键序的同一描述，编译出的 IR 必须与 canonical 源**字节相同**"。**span 一旦进 IR，这条验收就挂**（行序一变字节就变）。所以 **span 不能进 IR**——这是 ADR-0004「IR 不复制源文本」的延伸。

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

**涉及**：`packages/parser/src/**`（内部结构与映射表）、`packages/ir/src/**`（诊断类型与位置类型）、`spec/**`（位置模型）、新增 `docs/adr/0018-source-spans.md`、`tests/**`。

**验收**：

- 一条 schema 违规能同时给出 `location`（源行列）与 `cause.instancePath`（IR 路径）。
- 打乱源文件行序后：IR 字节不变（§10 验收仍绿），诊断位置指向新行号。
- agent 拿到诊断能定点改文件，不必再解析一次去猜位置。

**注意**：

- **不要为了位置把源文本复制进 IR**（ADR-0004 明令：IR 不复制源文本与注释）。span 是位置元数据，且**不进 IR**。
- 列号的字符语义（中文、`Ω`、`±` 怎么算列）必须写死并进 spec，否则第三方实现算出来的列号对不上。
- 这条是 F7 的前置，但**不阻塞 F7 的码表与注册表**（先有码与文件级位置，span 到位后补行列）。
