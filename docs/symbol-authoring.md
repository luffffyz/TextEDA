# 自建符号库：怎么让 agent（或人）造符号

> 依据：[ADR-0010](adr/0010-footprint-and-3d-model-ownership.md)（几何不进语言）、[ADR-0011](adr/0011-library-format-and-footprint-ir.md)（库格式的原则：源是 `.teda`，IR 是编译产物，KiCad 格式是导出产物）、[ADR-0012](adr/0012-symbol-description.md)（**引脚的电学事实归 `component`**）、[spec/symbol.md](../spec/symbol.md)（语法）。
> 一句话：**符号画在库里、库用 `.teda` 写；但引脚叫什么、是什么电气类型、编号多少，只写在 `component` 里。**

## 先分清两件事

| | 归谁 | 内容 |
|---|---|---|
| **电学事实** | `component`（唯一所有者） | 引脚号、引脚名、电气类型（`power_in` / `input` / …） |
| **视图** | `symbol`（库产物） | 引脚画在哪、朝哪、画多长、什么样式、外形框、显示开关 |

同一件事只写一遍。符号文件里**不出现引脚名**——否则 `component.pins` 与 `symbol.pins` 就是两份事实，两边不一致时没有裁决规则（`AGENTS.md` §7「器件描述漂移」坑的放大版）。

## 目录布局

```
<项目>/
  project.toml            # [libs.project] source="project" symbols/footprints + content_hash
  symbols/project/        # 库目录（真源）：一个符号一个 .teda
    bq24610rger.teda
  components/power/bq24610rger.teda   # 引脚名与电气类型在这里
  dist/symbols/project.kicad_sym      # 导出产物（KiCad 可见）
```

符号可以借（KiCad 官方库，`kicad:Regulator_Linear:TPS7A02`），也可以自建；引用形式一样，只有 `lib:` 前缀不同。**参考工程 `examples/reference-project/` 全部自建**：`symbols/project/` 下的符号覆盖 22 个器件，`r` / `c` / `l` / `nmos-5` / `ldo-sot23-5` 都是多个器件共享同一视图。

## 造符号的流程

### 1. 从 datasheet 取摆位事实

符号要抄的只有这些：

| 事实 | 用途 |
|---|---|
| 引脚号与功能名的对应 | 写在 `component` 里（**不是**符号里） |
| 引脚在图上的位置与朝向 | 符号 `pins` 段的 `x y rot` |
| 封装外形的长宽 | 符号 `body` 段的矩形 |
| 引脚名是否显示、显示多远 | `pin_names` / `pin_name_offset` |

朝向约定（`spec/symbol.md` §4）：`0` 向右（左侧引脚）、`180` 向左（右侧引脚）、`90` 向上（下方引脚）、`270` 向下（上方引脚）。坐标 **+y 向上**（KiCad 符号约定；封装是 +y 向下，别混）。

### 2. 写 `.teda`（真源）

语法见 `spec/symbol.md`。完整示例：`examples/reference-project/symbols/project/bq24610rger.teda`。

```
version 0.5
symbol bq24610rger

description 24V synchronous buck battery charger controller
tags battery charger
field Reference at=-6.35,17.78 U
field Value at=0,-21.59 bq24610rger

pins
  1   -12.7  13.97   0
  2   -12.7  11.43   0
  3    12.7   6.35   180
  ...
  25   2.54 -19.05   90

body
  rect  -10.16,-16.51,10.16,16.51  fill=background  width=0.254
```

要点：

- 长度默认 **mm**，可写 `0.95mm` / `10mil` / `1in`；角度默认度。单位换算在编译期做，**结果不是整数纳米就报错**（不四舍五入）。
- `pins` 行固定 4 列 `number x y rot`，后面接 `key=value` 尾列（`length` / `unit` / `style`）。
- `body` 行 2 列：`kind geometry`；`geometry` 单元格内逗号写坐标（`line`/`rect` 4 个数、`arc` 6 个、`circle` 3 个、`poly` 偶数个）。
- **符号没有层**：`field` 不接受 `layer`（那是封装的概念）。
- **缺省值不写**：`length=2.54`、`unit=1`、`style=line`、`units 1`、`pin_numbers show` 等一律省略（`spec/symbol.md` §8）。
- v0.1 不支持：文字标注（极性、功能名）、图片、贝塞尔。缺口不硬塞：可以在库里放手写 `.kicad_sym` 兜底（不受 schema 管）。

手写时不必纠结对齐和顺序，写完跑一次：

```bash
bun run fmt:teda symbols/project/bq24610rger.teda   # 就地规范化
bun run fmt:teda --check symbols                    # CI：不是 canonical 就退出 1
```

`fmt` 只重排表面（行/键顺序、列对齐、单位归一、缺省值省略），不碰语义；有语义错误的文件会被拒绝格式化，报错跟编译时同一套行列诊断。传目录时递归处理其中的 `*.teda`，只处理已实现的描述类型（`footprint` / `symbol`），其他类型跳过；显式点名未实现的类型会报错。规范见 `spec/symbol.md` §8。

### 3. 写 `component`（引脚事实）

`components/power/bq24610rger.teda`：

```
pins
  1   ACN     input
  2   ACP     input
  3   CE      input
  ...
  25  PAD     power
```

引脚号必须与符号里的号一一对应。符号有、器件没有 → 导出报错；器件有、符号没画 → 警告（可以是有意隐藏的电源脚）。

### 4. 编译成 IR

```bash
bun run compile:symbol symbols/project/bq24610rger.teda --library project --out dist/ir/symbols/bq24610rger.json
```

IR 是 `symbol` kind（契约 `schemas/ir/v0.1/symbol.schema.json`），单位全是整数纳米/毫度。

### 5. 导出成 KiCad 产物

```bash
bun run export:symbol dist/ir/symbols/bq24610rger.json --component components/power/bq24610rger.teda --out dist/symbols
```

导出器按**引脚号**把两边合起来：号与位置来自符号，名字与电气类型来自器件；属性（`Reference` / `Value` / `Footprint` / `Datasheet`）也一并写齐。`--out` 给目录时写 `<library>.kicad_sym`。

### 6. 看一眼（不用 KiCad）

```bash
bun run preview symbol bq24610rger            # 只出符号图
bun run preview component bq24610rger         # 符号 + 封装两张图，路径打到 stdout
bun run preview symbol bq24610rger --scale 8  # 放大看细节
```

**改完符号先跑这个**。参考渲染器（`packages/renderer`，[ADR-0014](adr/0014-reference-renderer.md)）把 IR 画成 SVG：引脚位置与朝向、引脚名/编号的内外侧、属性字段位置、引脚风格（反相气泡、时钟楔形）都在图上。校验全绿不等于看着对——引脚朝向反了、名字压到别的引脚上，这些只有看图才发现。

图里的字是**单线笔画字体**画成的路径（Hershey Sans，自带字形数据，不依赖系统字体——没装字体的机器打开也有字）。字高是 KiCad 的 cap height 口径，锚点是字的视觉中心；自带字体只有 ASCII，中文之类的字符画不出来，命令会在 stderr 上点名。

产物默认落 `/tmp/texteda-preview/<id>/`，命令会打印绝对路径。`--lib` 换库名（默认 `project`），`--project` 换项目目录。

### 7. 冒烟验证

```bash
bun run smoke:symbol            # 用 examples/reference-project/symbols/project/bq24610rger.teda
```

跑通：canonical form 检查（`fmt` 固定点）→ 编译成 IR（契约通过）→ 与 `component` 对齐引脚号 → 写 `.kicad_sym` → **KiCad 10 能解析**（`kicad-cli sym upgrade`）→ **能渲染**（`kicad-cli sym export svg` 出图）。改完符号跑一次，出图看一眼比读十遍规范快。

> 预览（第 6 步）**不需要 KiCad**；冒烟（第 7 步）需要——它验的是"我们的导出 KiCad 能读"，这是下游契约，故意依赖 KiCad。

## 工具必须替人查的

1. 符号存在、`lib:name` 能解析到具体符号；
2. **符号引脚号集合 == 器件引脚号集合**：少一个 → 错误；多一个 → 警告；
3. 器件引脚号 ⊆ 封装 pad 号（[ADR-0010](adr/0010-footprint-and-3d-model-ownership.md) decision 3 的库级检查，在工具链里做）；
4. 引脚名重复、引脚号重复、`unit` 越界 → 编译期报错（带行列）。

## 常见坑

| 现象 | 原因 | 处理 |
|---|---|---|
| 导出报"符号引脚在器件里不存在" | 符号里的号与 `component.pins` 对不上 | 对齐号；号是唯一的键 |
| KiCad 里引脚名是空的 | 名字只在 `component` 里，导出时按号合并 | 确认 `component` 的号与符号一致 |
| 符号上下颠倒 | 符号 +y 向上，封装 +y 向下 | 别把封装的 y 直接搬过来 |
| 编译报"精度超过纳米" | 写了亚纳米尺寸（如 `0.0000001mm`） | 改成整数纳米；IR 不许浮点，也不许丢精度 |
| 改了符号但产物没变 | 库的内容哈希没更新 | 改完重算哈希，产物需重出（这是有意的） |
