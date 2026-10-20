# ADR-0003：agent-first 的 PCB 描述（段集与取舍）

状态：已接受
日期：2026-10-20
影响范围：`teda.md` §9、§11、§12、§13、§15、附录 A；`AGENTS.md` §2、§4.3、§4.4、§7、§11；新增 `spec/pcb.md`

## 背景

原理图侧已经完成"人工格式 → agent first"的转身：`.kicad_sch` 存的是成稿（实测 74.6% 的字节是空白、缩进、结构关键字、坐标与 UUID），所以它只能是导出目标，不能当 IR 的参照物（`AGENTS.md` §13）。PCB 侧要同样转身，但情况不同：

- `.kicad_pcb` 的人机痕迹比 `.kicad_sch` 更重：绘图参数、丝印排版、编辑器锁定、分组、UUID、内部序号。
- `.kicad_pcb` 里带**派生缓存**：铜皮填充结果 `filled_polygon`、量测文本。搬进 IR 就是造出第二真源。
- **规则不在 `.kicad_pcb` 里**。KiCad 板文件格式规范明写：net class 已从板文件移出，放进设计规则文件（工程文件）。也就是说 agent 拿到一个 `.kicad_pcb`，拿不到任何间距/线宽/差分规则，**无法自查**。
- 反过来，`.kicad_pcb` 里**没有意图**：为什么这样布线、哪条是电源回路、哪里要分割地、哪对要等长，全在人脑里。

现有 `teda.md` §9 的 pcb 草案（`stackup` 标量 + `place` + `route` + `physical_only`）两头不靠：照抄 KiCad 的结构会继承工效噪声与缓存；照现在这版又装不下一块真板（没有板框、没有过孔、没有铜皮、没有折点、没有规则），`route <net> <width> <layer>` 连"连到哪两个焊盘"都表达不了。

## 决策

### 1. 分层判据

沿用 `AGENTS.md` §3：S1（原理图视图）与 B1（PCB 预览）自由，**B0（物理事实）不自由**。所以 pcb 描述必须**完整承载物理事实**（叠层、坐标、层、过孔、走线），这部分不能省。

**agent-first 化的对象不是信息量，而是信息的形态**：IR 变小的是策略与噪音，不是几何。

### 2. IR 存什么

| 类别 | 内容 |
|---|---|
| 叠层 | 层序、层类型、铜厚、介质厚度与材料、介电常数、总厚 |
| 板形 | 板框折线、板内开孔与安装孔 |
| 放置 | 实例坐标、旋转、面 |
| 绑定 | 实例 → 器件 → 封装；pad 号 ↔ sch 引脚编号；net 只引用 `net_id`，成员由 sch 提供 |
| 铜箔 | 走线折线（net/层/线宽）、过孔（位置/尺寸/钻孔/连通层）、铜皮（outline/net/层） |
| 避让 | keepout 区域与类型 |
| 规则 | 默认间距/线宽/过孔、按 net 的覆盖、差分对、等长 |
| 显式连接 | 哪些 pad 之间有连续铜箔（`connect` 段） |
| 物理专属 | 安装孔、基准点、板内开孔、屏蔽罩、测试点、缝合孔等不影响逻辑的实体 |
| 受控偏差 | `net_tie` / `split_ground`（改变逻辑连通性）；`test_point` / `stitching` / `fiducial` 属物理实体，但同样进报告 |

### 3. IR 明确不存什么

| `.kicad_pcb` 成分 | 为什么不进 IR |
|---|---|
| `(page A4)` 图框与 `pcbplotparams`（31 项绘图参数） | 打印与"上次怎么画的"的历史状态，与设计无关 |
| 丝印/装配文本的字体效果、位置微调、`hide`/`unlock` | 排版美学，由确定性 policy 生成 + KiCad 侧人工处理，不回流 |
| `autoplace_cost180`、`locked`、`group` | 编辑器交互状态 |
| `uuid`/`tstamp`/`path`/`tedit`、net 序号、`general` 里的历史计数 | 身份与历史噪声；IR 用稳定语义 ID（`AGENTS.md` §2 第 5 条） |
| 铜皮填充结果 `filled_polygon` | 派生缓存；由 outline + 规则重算 |
| `dimension` 的量测文本 | 派生量 |
| 库元数据（`descr`/`tags`/3D 模型路径） | 属封装库，板文件里只是引用 |

### 4. 规则必须进 IR

因为 KiCad 把 netclass 与自定义 DRC 规则移到了工程文件，只拿 `.kicad_pcb` 的 agent 无法自查。**pcb 描述自带 `rules` 段**；导出到 KiCad 时再写回 netclass 与自定义规则。

### 5. 连通性由声明给出，不由几何反推

`AGENTS.md` §2 第 2 条禁止"从几何反推连通性作为权威结果"。因此 pcb 描述**显式声明**哪些 pad 之间有连续铜箔（`connect` 段），几何只负责"这两个 pad 之间确实有铜箔"这一条可验证的检查。

- `connect` 里的每一对 pad 必须落在 sch 的同一个 net 内；否则必须由 `deviation` 段显式声明（白名单类型），否则报错。
- sch 的每个 net 成员至少要出现在一个 `connect` 对里；否则报"该 net 未布线"。
- 差分对**不是几何对象，是约束**：走线仍按单 net 折线描述，差分/等长/阻抗进 `rules`。

### 6. 段集

`stackup` · `outline` · `place` · `connect` · `trace` · `via` · `zone` · `keepout` · `rules` · `silk` · `physical_only` · `deviation`

具体语法见 `spec/pcb.md`。要点：

- 走线只支持折线（v0.4）；圆弧走线导入时按折线近似，并**报告偏差**。
- 铜皮只存 outline + net + 层；填充参数（clearance、thermal）走 `rules`。
- 丝印是制造物：`silk` 段声明出不出、字高、哪一层；**排版位置仍不进 IR**，由确定性 policy 生成（见 `docs/adr/0005-manufacturing-output.md` 决策 6）。
- `physical_only` 放不影响逻辑的物理实体（`test_point` / `stitching` / `fiducial`）；`deviation` 放两类会改逻辑连通性的受控偏差（`net_tie` / `split_ground`）。两者都进报告。
- pcb 用**稳定实例 ID**（`R1` / `M1.R1`）引用器件，不用 refdes：refdes 可改名，ID 不变（`AGENTS.md` §2 第 5 条、§4.4）。

### 7. 单向不回流

人在 KiCad 里的调整（丝印位置、图层显示、临时分组）**不回写 IR**。IR 是唯一真源，KiCad 是视图与 DRC/制造出口。改动要生效，必须改 IR 再重新导出。代价是 KiCad 侧改规则不再自动生效（换来"agent 能自查"）。

### 8. 导出目标

导出目标：**KiCad `.kicad_pcb`**（DRC 覆盖最好，兼作 3D 与人工继续编辑的入口）。制造与验证都在 KiCad 里闭环（`kicad-cli pcb export gerbers` / `export drill` / `pcb drc`），路径见 `docs/adr/0005-manufacturing-output.md`。Circuit JSON 作为制造链已撤回（绑定外来 schema、工具成熟度低、无 DRC）。

导出是**有损投影**：目标格式装不下的语义必须报告（`file:line:col: warning …`），复用 `AGENTS.md` §4.4 的受控偏差机制，不静默丢。

> sch 侧的导出顺序不在本 ADR 范围，仍见 `AGENTS.md` §11 第 4 条。

## 后果

- **IR 变大**：几何全量入 IR，这是 B0 不自由的必然结果；变小的只有策略与噪音。
- **多一份规则真源要维护**：规则进 IR 后，KiCad 侧改规则不再自动生效（见决策 7）。
- **丝印排版交给 policy**：agent 生成的板子丝印不好看是已知代价，KiCad 里手工挪一下即可，但那是 KiCad 侧的事。
- **不自己布局布线**：pcb 描述表达 B0，但生成仍借 KiCad / freerouting / tscircuit（`AGENTS.md` §3、§8）。
- **v0.4 假定存在 sch**：pcb-only 模式（逆向工程、外部网表导入）的段集待 `AGENTS.md` §11 第 6 条决定后补充。

## 后续

- 封装几何从哪来：自有 footprint IR + `.kicad_mod` importer；IR 里 pad 几何是引用还是内联，待定。
- 圆弧走线、微孔（HDI）是否放开。
- 规则到 KiCad netclass / 自定义规则的映射细则。
- pcb 的 `connect` 段与页面展平后的实例 ID 对应。
- `examples/` 里的 pcb 困难用例（差分对、net tie、分地）与期望 IR。
