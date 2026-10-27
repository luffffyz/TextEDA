# 自建封装库：怎么让 agent（或人）造封装

> 依据：[ADR-0010](../adr/0010-footprint-and-3d-model-ownership.md)（几何不进语言）、[ADR-0011](../adr/0011-library-format-and-footprint-ir.md)（**源是 `.teda`**，IR 是编译产物，KiCad 格式是导出产物）、[spec/footprint.md](../../spec/footprint.md)（语法）。
> 一句话：**几何与 3D 不进 `.teda` 板描述；它们落在项目自建的封装库里，库用 `.teda` 写，编译成 IR，再导出成 KiCad。**

## 为什么不是"把 3D 尺寸写进 teda"

- 封装几何是**器件类型**的属性，不是这块板的属性——写进板描述就是每块板抄一份库，必然漂移。
- `component.footprint`（`lib:name`）已经是几何的唯一引用点；几何的第二份真源会造成 §7「重复描述」坑。
- STEP/WRL 是 CAD 数据，不可 diff、不可评审；它在 KiCad 封装里以 `model` 语句引用。
- 板级该有的尺寸已经在语言里：`board_thickness`、`stackup`、`rules`、`place` 坐标/旋转、`physical_only` 的孔位。

## 目录布局

```
<项目>/
  project.toml            # metadata only: no library reference (assets/ is the library)
  footprints/project/     # 库目录（真源）：一份封装一个 .teda
    sot-23-5.teda
    3dmodels/sot-23-5.stp           # 可选 3D 模型（项目相对路径）
  fp-lib-table            # KiCad 库表：指向**导出的** .pretty 目录
  dist/footprints/project.pretty/   # 导出产物：.kicad_mod（KiCad 侧可见）
```

`fp-lib-table`（KiCad 按 `lib:name` 回查库时读它；缺了会报 `lib_footprint_issues`）：

```
(fp_lib_table
  (lib (name "project")(type "KiCad")(uri "${KIPRJMOD}/dist/footprints/project.pretty")(options "")(descr "项目自建封装库"))
)
```

参考工程**全部自建**：`examples/reference-project/` 下不出现任何外部前缀，23 个器件的 `symbol` / `footprint` 都指向 `project:`（历史写法，今天写作裸 id），源文件在 `assets/symbols/project/` 与 `assets/footprints/project/`。

要拿 KiCad 官方库的封装，不登记、不写前缀：用 `texteda lib import` 把需要的封装（连同它们的 symbol 与 component）拷进 `assets/footprints/`，之后它就是本工程的封装，引用只写裸 id。`<lib>:` 限定符与 `external/libs/**` 都已被撤销（[ADR-0047](../adr/0047-an-external-library-is-a-template-not-a-dependency.md)），做法见 [library-import.md](library-import.md)。

## 造封装的流程

### 1. 从 datasheet 取尺寸事实

要抄进封装的只有这些（其余是 3D 外观，不影响制板）：

| 事实 | 用途 |
|---|---|
| body L × W（mm） | F.Fab 外形、courtyard 参考、3D 模型尺寸 |
| lead pitch、每侧焊盘中心偏移 | 焊盘 `x` / `y` |
| 焊盘尺寸（W×H）、是否全暴露 | 焊盘 `w` / `h`、层集合 |
| 是否全金属焊盘（QFN/DFN 散热盘） | 是否需要散热焊盘 |
| 推荐的 courtyard 外扩 | F.CrtYd 矩形 |

### 2. 写 `.teda`（真源）

语法见 `spec/footprint.md`。完整示例：`examples/reference-project/assets/footprints/project/sot-23-5.teda`。

```
version 0.4.1
footprint sot-23-5

description SOT-23-5 body 2.9x1.6mm pitch 0.95mm
tags SOT-23 SOT-23-5
attr smd
package_code SOT-23-5
model 3dmodels/sot-23-5.stp
field Reference at=0,-2 layer=F.SilkS size=1,1 thickness=0.15 REF**
field Value at=0,2 layer=F.Fab size=1,1 thickness=0.15 SOT-23-5

pads
  1  smd  roundrect  -0.95  0.95    1.1  0.6  rratio=0.25
  2  smd  roundrect  -0.95  0       1.1  0.6  rratio=0.25
  3  smd  roundrect  -0.95  -0.95   1.1  0.6  rratio=0.25
  4  smd  roundrect  0.95   -0.475  1.1  0.6  rratio=0.25
  5  smd  roundrect  0.95   0.475   1.1  0.6  rratio=0.25

graphics
  line  F.SilkS  -2.1,-0.95,-1.6,-0.95  width=0.12
  line  F.SilkS  -2.1,0.95,-1.6,0.95    width=0.12
  rect  F.CrtYd  -1.65,-1.2,1.65,1.2    width=0.05
  rect  F.Fab    -1.45,-0.8,1.45,0.8    width=0.1
```

要点：

- 长度默认 **mm**，可写 `0.95mm` / `10mil` / `1in`；角度默认度。单位换算在编译期做，**结果不是整数纳米就报错**（不四舍五入）。
- 比例（`rratio`）在 IR 里是整数百万分比（`250000`），不是浮点。
- 焊盘行固定 7 列，后面接 `key=value` 尾列（`rot` `drill` `rratio` `mask` `paste` `zone` `thermal_w` `thermal_g` `layers`）。
- 图形行 3 列：`kind layer geometry`；`geometry` 单元格内用逗号写坐标（`line`/`rect` 4 个数、`arc` 6 个、`circle` 3 个、`poly` 偶数个）。
- v0.1 不支持：自定义焊盘形状、挖空/开槽、多个 3D 模型、层叠封装。缺口不硬塞：可以在库里放手写 `.kicad_mod` 兜底（不受 schema 管）。

手写时不必纠结对齐和顺序，写完跑一次：

```bash
bun run fmt:teda footprints/project/sot-23-5.teda      # 就地规范化
bun run fmt:teda --check footprints/project             # CI：不是 canonical 就退出 1
```

`fmt` 只重排表面（行/键顺序、列对齐、单位归一），不碰语义；有语义错误的文件会被拒绝格式化，报错跟编译时同一套行列诊断。传目录时递归处理其中的 `*.teda`，只处理已实现的描述类型（`footprint` / `symbol`），其他类型跳过；显式点名未实现的类型会报错。规范见 `spec/footprint.md` §8。

### 3. 编译成 IR

```bash
bun run compile:footprint footprints/project/sot-23-5.teda --library project --out dist/ir/footprints/sot-23-5.json
```

IR 是 `footprint` kind（契约 `schemas/ir/v0.3/footprint.schema.json`），单位全是整数纳米/毫度/百万分比。

### 4. 导出成 KiCad 产物

```bash
bun run export:footprint dist/ir/footprints/sot-23-5.json --out dist/footprints/project.pretty
```

两种用途：放进 `.pretty` 目录后是 KiCad 可见的普通库；板导出时同一份几何会**内联**进 `.kicad_pcb`（KiCad 6+ 的做法），所以 DRC 与制造不再依赖库文件。

### 5. 登记与引用

- `fp-lib-table` 登记 `project`（见上）。
- `component` 里：`footprint = "project:sot-23-5"`，`symbol` 指向符号库里的对应符号。
- `project.toml` 里**没有**库登记项：自建库就是工程的 `assets/`，没有版本锚点、没有 `content_hash`（`[libs]` 已撤销，[ADR-0047](../adr/0047-an-external-library-is-a-template-not-a-dependency.md)）。库级的闭环由 `bun run lib:verify` 当场校验（引用可解析、引脚号与焊盘号对齐、KiCad 能读、DRC 0 违规）。

### 6. 看一眼（不用 KiCad）

```bash
bun run preview footprint sot-23-5            # 只出封装图
bun run preview component bq24610rger         # 器件的符号 + 封装两张图
bun run preview footprint sot-23-5 --scale 20 # 放大看焊盘与丝印的细节
```

**改完封装先跑这个**。参考渲染器（`packages/renderer`，[ADR-0014](../adr/0014-reference-renderer.md)）把 IR 画成 SVG：焊盘位置与尺寸、courtyard、F.Fab、丝印、属性文字都在图上，而且**渲染约定与 KiCad 一致**（逐项比对过，见 [ADR-0014](../adr/0014-reference-renderer.md) decision 6）——所以这张图能当 KiCad 的预演看。

看图抓的是 DRC 抓不到的：丝印压焊盘（DRC 才报）、courtyard 圈小了没罩住焊盘、丝印线画到了板边外、1 脚标记没画。

**通孔焊盘只看这张图**：`th` 焊盘在通配层 `*.Cu` / `*.Mask` 上（`spec/footprint.md` §4），预览按“一次画两面”处理——用前铜颜色画一圈焊盘环、再用背景色把钻孔挖掉。所以图上看到的环 = 焊盘外径，白心 = 钻孔；环画不出来（整块焊盘消失）意味着层名没被认出来。

图里的属性文字是**单线笔画字体**画成的路径（Hershey Sans，自带字形数据，不依赖系统字体）。自带字体只有 ASCII，画不出来的字符命令会在 stderr 上点名。

产物默认落 `/tmp/texteda-preview/<id>/`，命令会打印绝对路径。`--lib` 换库名（默认 `project`），`--project` 换项目目录。

### 7. 冒烟验证

```bash
bun run smoke:footprint            # 用 examples/reference-project/assets/footprints/project/sot-23-5.teda
```

跑通：canonical form 检查（`fmt` 固定点）→ 编译成 IR（契约通过）→ 写 `.kicad_mod` → KiCad 能解析（`kicad-cli fp export svg`）→ 内联进板 → `kicad-cli pcb drc` 0 违规 → Gerber 出齐。改完封装跑一次，DRC 会替你抓丝印压焊盘、courtyard 越界这类问题。

> 预览（第 6 步）**不需要 KiCad**；冒烟（第 7 步）需要——它验的是"我们的导出 KiCad 能读"，这是下游契约，故意依赖 KiCad。

## 工具必须替人查的（[ADR-0010](../adr/0010-footprint-and-3d-model-ownership.md) decision 3）

1. 封装存在、`lib:name` 能解析到具体封装；
2. **pad 号集合 ⊇ sch 引脚编号集合**：少一个 → 错误；多一个 → 警告；
3. 焊盘几何过 DRC（间距/阻焊/锡膏），规则由 `.kicad_pro` 提供；
4. 装配层面（courtyard 重叠、3D 原点/朝向）属于派生检查，靠 3D 预览看，不进 IR。

## 常见坑

| 现象 | 原因 | 处理 |
|---|---|---|
| PCB 上焊盘没接上 | pad 编号与 symbol 引脚号错位（`1` vs `A1`） | decision 3 第 2 条会报错；改到一致 |
| 散热焊盘不出现 | 散热焊盘编号（如 `9` / `PAD`）在 symbol 里没有对应引脚 | 把它当机械焊盘，连接规则里明确不参与电气 |
| 编译报"精度超过纳米" | 写了亚纳米尺寸（如 `0.0000001mm`） | 改成整数纳米；IR 不许浮点，也不许丢精度 |
| DRC 报丝印压焊盘 | `Reference`/`Value` 文本位置压到焊盘阻焊开窗 | 文本往外挪（如 ±2.0 mm） |
| DRC 报 courtyard 越界 | 丝印或文本伸出 courtyard | 扩大 courtyard 或收图形 |
| KiCad 拒绝加载整个库 | `(tags …)` 写成多个引号字符串 | KiCad 要求**一个**字符串，标签用空格分隔（导出器已处理） |
| 3D 里器件浮空/沉板 | model 的 `offset` 没对齐 | 对齐 body 中心与底面 z=0 |
| 改了封装但产物没变 | 产物没有重出（导出器是纯函数，读的是当前 IR） | 重新 `compile` 再导出 |
