# ADR-0010：封装几何与 3D 模型不进语言；项目自建封装库是一等产物

状态：已接受
日期：2026-10-20
影响范围：`AGENTS.md` §4.5、§8、§9；`schemas/ir/v0.1/project.schema.json`；新增 `docs/footprint-authoring.md`

## 背景

两个事实摆在一起：

1. **本项目的边界**：`AGENTS.md` §1 明确"不是器件库维护者（借 KiCad 符号库、嘉立创料号）"；`component` 文件只写 `mpn` / `package` / `symbol` / `footprint`（`lib:name`）与引脚表，**几何不在语言里**。
2. **新事实**：agent 从 datasheet 造一个封装（含 3D 模型）只要几分钟，人手写封装也在做同样的事。也就是说"库"不再是只能从上游借的外部依赖，而可以是**项目自有、agent 生成的产物**。

于是问题变成：既然封装与 3D 可以随手生成，**要不要把 3D 尺寸写进 `.teda`**（让板自己带几何）？

## 决策

### 1. 封装几何与 3D 模型不进语言

- `.teda` 里**没有**焊盘尺寸、courtyard、装配外形、3D 尺寸这类字段，也不新增。
- 理由：
  1. **归属错层**：封装几何是*器件类型*的属性（同一颗 0402 在十块板上是同一份几何），不是*这块板*的属性。写进板描述 = 每块板抄一份库，正是 `AGENTS.md` §7「重复描述」坑（"同一个连接写两遍，改一处漏一处"）的放大版。
  2. **引用点已经存在**：`component.footprint`（`lib:name`）就是几何的唯一引用点（§4.5）。几何的落点应该在库里，不在描述里。
  3. **3D 更不能进**：STEP/WRL 是 CAD 数据，不是可 diff 的文本；它在 KiCad 封装里以 `model` 语句引用，语言再描述一遍就是第二真源。
  4. **层次**：`AGENTS.md` §3 把 3D 装配视图划为 B1（派生、可自由），板级物理事实是 B0（不可自由）。器件本体尺寸属于器件库，不是板级事实。
- **板级该有的尺寸已经在语言里**：`board_thickness`、`stackup`、`rules`（间距/线宽/阻焊/锡膏/热焊盘）、`place` 的坐标与旋转、`physical_only` 的安装孔与开孔。缺的只有"这块板用了哪个封装"，由 `component.footprint` 给出。

### 2. 项目自建封装库是一等产物

- 库来源分两类，引用形式统一为 `lib:name`：
  - **借来的**：KiCad 官方库、嘉立创库 —— `libs.<name>` 记 `source` + `rev`/`version`。
  - **自建的**：项目目录下的封装库（agent 或人写的 `.teda` 封装描述 + 可选 3D 模型；格式见 `docs/adr/0011-library-format-and-footprint-ir.md` 与 `spec/footprint.md`）—— `libs.<name>` 记 `path`（项目相对库目录）+ `content_hash`。
- 自建库的**版本锁定用内容哈希**：`content_hash` = SHA-256(库目录下所有文件按相对路径排序后的 `<relpath>:<file_sha256>\n` 拼接)。与 ADR-0008 决策 5 的分片聚合同一形状，理由相同：没有上游 rev 也要有可复现的版本锚点。
- 落点：项目里放 `fp-lib-table`（KiCad 读它解析 `lib:name`），指向**导出的** `.pretty` 目录（ADR-0011 决策 4）。第一轮试跑已经证明这是硬落点——缺了它 KiCad 对每个封装报 `lib_footprint_issues`（`docs/kicad-pcb-format.md` 已记录）。
- `component.footprint` 引用自建库时写成 `project:<name>`（前缀自选，如 `project:sot-23-5`）；IR 的库引用格式允许任意 `<前缀>:<名字>`（`schemas/ir/v0.1/common.schema.json` 的 `library_ref`）。

### 3. 造出来的封装必须过的检查

工具（checker + KiCad DRC）负责，不是人肉看：

1. 封装存在、库表可解析、`lib:name` 能解析到具体 `.kicad_mod`；
2. **pad 号集合 ⊇ sch 引脚编号集合**：少一个 → 错误（`AGENTS.md` §4.4 规则 2 已定）；多一个 → 警告；
3. 焊盘几何过 DRC（间距/阻焊/锡膏），KiCad 侧规则仍由 `.kicad_pro` 提供（ADR-0005 决策 1）；
4. 装配层面（courtyard 不重叠、3D 与封装原点/朝向一致）属于 **B1 派生检查**，靠 3D 预览看，不进语言、不进 IR。

### 4. 机械与结构不进语言

- 外壳干涉、连接器插拔空间、散热风道这类**跨领域约束**不进 `.teda`：`AGENTS.md` §1 已声明第一阶段不描述外壳结构。
- 将来若要表达，需要单开一个 `structure` 描述层并写 ADR；**不**塞进 `pcb` 描述里当补丁。`pcb` 的 `physical_only` 只覆盖板内实体（安装孔、基准点、测试点、缝合孔、开孔）。

## 后果

- **语言表面不变**：`.teda` 不用加字段，parser/IR 不动；唯一例外是 `libs` 条目多了 `path` / `content_hash` 两个键（IR 与 `project.toml` 同步）。封装本身是**独立的库产物**（`footprint` kind），不进板描述，见 ADR-0011。
- **库从"外部依赖"变成"项目产物"**：项目可以完全自给自足（KiCad 官方库只作便利），这对"agent 独立完成一块板"是决定性的——前提是封装能被自动生成并被检查（决策 3）。
- **可复现性靠内容哈希**：自建库改动（`.teda` 源码或 3D 模型）→ `content_hash` 变 → 产物需重出；这是想要的（封装改了，Gerber 与 3D 当然要重出）。
- **3D 仍然不参与判定**：3D 是评审与装配检查的输入，不参与连通性、不回写 IR（`AGENTS.md` §2 第 2、3 条）。

## 后续

- `docs/footprint-authoring.md`：agent 造封装的流程、文件布局、`fp-lib-table` 写法、检查清单。
- 自建库里的**符号**是否也走同样机制（`component.symbol` 指向自建 `.kicad_sym`）——倾向是，但要确认 KiCad 的符号库表与封装库表是否同一套机制。
- 3D 模型的挂载与哈希：自建库用我们的格式后，3D 模型放在库目录内（`footprints/project/3dmodels/…`），由 `content_hash` 一并覆盖（模型改了哈希就变）。格式见 ADR-0011。

## 补充（2026-10-20）：自建库有两个根

ADR-0012 之后，一个自建库同时提供符号与封装，二者共用同一个 `<lib>:` 命名空间。`[libs.<name>]` 因此允许两个根键：

```toml
[libs.project]
source = "project"
symbols = "symbols/project"
footprints = "footprints/project"
content_hash = "…"
```

只有一个根的库仍可写 `path`（旧写法）。`content_hash` 覆盖所有根：SHA-256(全部文件的 `<项目相对路径>:<file_sha256>\n` 按字节序拼接)，工具是 `bun run lib:hash <dir>...`。
