# 自建符号库：怎么让 agent（或人）造符号

> 依据：[ADR-0030](../adr/08-libraries/0030-footprint-format-and-geometry.md) D1（几何不进语言）、[ADR-0030](../adr/08-libraries/0030-footprint-format-and-geometry.md) D3、D4（库格式的原则：源是 `.teda`，IR 是编译产物，KiCad 格式是导出产物）、[ADR-0031](../adr/08-libraries/0031-symbol-format.md) D2（**引脚的电学事实归 `component`**）、[spec/symbol.md](../../spec/symbol.md)（语法）。
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
  project.toml            # metadata only: no library reference (assets/ is the library)
  assets/symbols/power/   # 器件类别目录（真源）：一个符号一个 .teda
    bq24610rger.teda
  assets/components/power/bq24610rger.teda   # 引脚名与电气类型在这里
  dist/symbols/power.kicad_sym        # 导出产物（KiCad 可见，目录名 = 库名）
```

符号可以自建，也可以从外部库拿来——但外部库是**模板**：用 `texteda lib import` 拷进 `assets/`，之后它就是本工程的资产，引用写它落地的分类目录（`<category>:<id>`，[ADR-0049](../adr/08-libraries/0049-assets-are-filed-by-what-they-are.md)），所以本工程内不再区分"借的"和"自己的"。**参考工程 `examples/reference-project/` 全部自建**：`assets/symbols/<category>/` 下的 15 个符号覆盖 23 个器件，`r` / `c` / `l` / `nmos-5` / `ldo-sot23-5` 都是多个器件共享同一视图。

## 造符号的流程

以下 shell 示例都从项目根目录运行；`REPO` 指向 TextEDA 仓库根目录。

```bash
REPO=/path/to/TextEDA
```

### 1. 从 IEC 60617 取符号事实

对于有 IEC 60617 条目的标准化原理图符号，来源顺序固定为：

1. 先查 IEC 60617 对应条目，确定符号语义、图形和必要标记；记录条目编号与版本。
2. 再查 KiCad 官方库作工程对照，确认常用变体、实现尺寸和导出兼容性。KiCad 不是规范权威，不得机械照搬。
3. `datasheet` 只用于 `component` 的引脚号、引脚名、电气事实和封装事实，不作为 symbol 图形来源。
4. IEC 条目不可访问或图形有歧义时，不得宣称严格 IEC 合规；可以暂以 KiCad 作为工程基线，并在描述或评审记录中标为 `IEC-style` / `provisional`。

符号要记录的事实：

| 事实 | 用途 | 首选来源 |
|---|---|---|
| 引脚号与功能名的对应 | 写在 `component` 里 | `datasheet` |
| 标准符号语义、图形和必要标记 | `symbol` 的 `body` 与相关显示设置 | IEC 60617 |
| 引脚在图上的位置与朝向 | `symbol` 的 `pins` 段 | IEC 60617；KiCad 作工程对照 |
| 符号实现尺寸与常用变体 | `symbol` 的坐标与几何 | KiCad 作第二来源；记录取舍 |
| 封装外形的长宽 | `footprint` 的几何 | `datasheet` |
| 引脚名是否显示、显示多远 | `pin_names` / `pin_name_offset` | IEC 语义需要；TextEDA house style |

朝向约定（`spec/symbol.md` §4）：`0` 向右（左侧引脚）、`180` 向左（右侧引脚）、`90` 向上（下方引脚）、`270` 向下（上方引脚）。坐标 **+y 向上**（KiCad 符号坐标约定；封装是 +y 向下，别混）。

### 2. 写 `.teda`（真源）

语法见 `spec/symbol.md`。当前完整示例：[bq24610rger.teda](../../examples/reference-project/assets/symbols/power/bq24610rger.teda)。

要点：

- 长度默认 **mm**，可写 `0.95mm` / `10mil` / `1in`；角度默认度。单位换算在编译期做，**结果不是整数纳米就报错**（不四舍五入）。
- `pins` 行固定 3 列 `number [x,y] rot`，后面接 `key=value` 尾列（`length` / `unit` / `style`）。连接点是**一格**，不是两列（[ADR-0065](../adr/01-language/0065-a-coordinate-tuple-is-one-cell.md)）。
- `body` 行 2 列：`kind [geometry]`；`geometry` 是**一格带方括号**的逗号列表（`line`/`rect` 4 个数、`arc` 6 个、`circle` 3 个、`poly` 偶数个），例如 `rect [-10,-16.5,10,16.5]`。
- **引脚落在 `0.5 mm` 晶格上**：连接点与内端都是 `0.5 mm` 的整数倍（`length` 因此也是），而且**逐个引脚、两个轴**都落格——不要求一行关于原点对称，打印页是引脚到引脚连线。画引脚号的符号，同侧相邻两脚至少 `2.5 mm`，常规就是 `2.5 mm`；只有三位数号码这类具体理由才放宽到 `3.0 mm`，隐藏引脚号的器件图形不受这个下限。理由与例外清单见 `spec/symbol.md` §4.1、[ADR-0057](../adr/08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) 与 [ADR-0058](../adr/08-libraries/0058-pin-rows-on-a-number-bearing-symbol-are-at-least-two-and-a-half-millimetres-apart.md)。焊盘坐标不跟着这个晶格走——那是 `footprint` 的事。
- **符号没有层**：`field` 不接受 `layer`（那是封装的概念）。
- 缺省值不写：`length=2.5`、`unit=1`、`style=line`、`units 1`、`pin_numbers show` 等一律省略（`spec/symbol.md` §8）。
- 不支持：文字标注（极性、功能名）、图片、贝塞尔。缺口不硬塞：可以在库里放手写 `.kicad_sym` 兜底（不受 schema 管）。

手写时不必纠结对齐和顺序，写完跑一次：

```bash
bun run "$REPO/packages/parser/scripts/fmt-teda.ts" assets/symbols/power/bq24610rger.teda   # 就地规范化
bun run "$REPO/packages/parser/scripts/fmt-teda.ts" --check assets/symbols             # CI：不是 canonical 就退出 1
```

`fmt` 只重排表面（行/键顺序、列对齐、单位归一、缺省值省略），不碰语义；有语义错误的文件会被拒绝格式化，报错跟编译时同一套行列诊断。传目录时递归处理其中的 `*.teda`，只处理已实现的描述类型（`footprint` / `symbol`），其他类型跳过；显式点名未实现的类型会报错。规范见 `spec/symbol.md` §8。

### 3. 写 `component`（引脚事实）

`assets/components/power/bq24610rger.teda`：

```
pins
  1   ACN     input
  2   ACP     input
  3   CE      input
  ...
  25  PAD     power
```

引脚号必须与符号里的号一一对应。单独运行 `export:symbol` 时，符号有、器件没有 → 报错；器件有、符号没画 → 警告（可能是有意隐藏的电源脚）。完整库验证 `lib:verify` 对任一集合差异都失败。

### 4. 编译成 IR

```bash
bun run "$REPO/packages/parser/scripts/compile-symbol.ts" assets/symbols/power/bq24610rger.teda --out dist/ir/symbols/power/bq24610rger.json
```

IR 是 `symbol` kind（契约 `schemas/ir/v0.19/symbol.schema.json`），单位全是整数纳米/毫度。`symbol.library` 取的是文件所在的分类目录（`power`），派生它不需要 `--library`；只有目录名不是分类名时才需要覆盖。

### 5. 导出成 KiCad 产物

```bash
bun run "$REPO/scripts/export-symbol.ts" dist/ir/symbols/power/bq24610rger.json --component assets/components/power/bq24610rger.teda --out dist/symbols/
```

导出器按**引脚号**把两边合起来：号与位置来自符号，名字与电气类型来自器件；属性（`Reference` / `Value` / `Footprint` / `Datasheet`）也一并写齐。`--out` 给目录时写 `<分类>.kicad_sym`（分类目录就是 KiCad 侧的库名，[ADR-0049](../adr/08-libraries/0049-assets-are-filed-by-what-they-are.md)）。

### 6. 看一眼（不用 KiCad）

```bash
bun run "$REPO/scripts/preview.ts" symbol bq24610rger --project .
bun run "$REPO/scripts/preview.ts" component bq24610rger --project .
bun run "$REPO/scripts/preview.ts" symbol bq24610rger --scale 8 --project .
```

**改完符号先跑这个**。参考渲染器（`packages/renderer`，[ADR-0036](../adr/09-view/0036-our-own-reference-renderer.md)）把 IR 画成 SVG：引脚位置与朝向、引脚名/编号的内外侧、属性字段位置、引脚风格（反相气泡、时钟楔形）都在图上。校验全绿不等于看着对——引脚朝向反了、名字压到别的引脚上，这些只有看图才发现。

图里的字是**单线笔画字体**画成的路径（Hershey Sans，自带字形数据，不依赖系统字体——没装字体的机器打开也有字）。字高是 KiCad 的 cap height 口径，锚点是字的视觉中心；自带字体只有 ASCII，中文之类的字符画不出来，命令会在 stderr 上点名。

产物默认落 `/tmp/texteda-preview/<id>/`，命令会打印绝对路径。`--class` 指定分类目录（不给就在整棵树里按 id 找，撞名时报错并列出候选），`--project` 换项目目录。

### 7. 冒烟验证

```bash
bun run "$REPO/scripts/smoke-symbol.ts" assets/symbols/power/bq24610rger.teda assets/components/power/bq24610rger.teda
```

跑通：canonical form 检查（`fmt` 固定点）→ 编译成 IR（契约通过）→ 与 `component` 对齐引脚号 → 写 `.kicad_sym` → **KiCad 10 能解析**（`kicad-cli sym upgrade`）→ **能渲染**（`kicad-cli sym export svg` 出图）。改完符号跑一次，出图看一眼比读十遍规范快。

> 预览（第 6 步）**不需要 KiCad**；冒烟（第 7 步）需要——它验的是"我们的导出 KiCad 能读"，这是下游契约，故意依赖 KiCad。

## 工具必须替人查的

1. 符号存在、`component.symbol` 的 `<category>:<id>` 引用能解析到具体符号；
2. 两侧引脚号集合必须相等：`export:symbol` 对象符号独有引脚会报错、对组件独有引脚只警告；`lib:verify` 对任一集合差异都失败；
3. 器件引脚号 ⊆ 封装 pad 号（[ADR-0030](../adr/08-libraries/0030-footprint-format-and-geometry.md) decision 7 的库级检查，在工具链里做）；
4. 引脚名重复、引脚号重复、`unit` 越界 → 编译期报错（带行列）。

## 常见坑

| 现象 | 原因 | 处理 |
|---|---|---|
| 导出报"符号引脚在器件里不存在" | 符号里的号与 `component.pins` 对不上 | 对齐号；号是唯一的键 |
| KiCad 里引脚名是空的 | 名字只在 `component` 里，导出时按号合并 | 确认 `component` 的号与符号一致 |
| 符号上下颠倒 | 符号 +y 向上，封装 +y 向下 | 别把封装的 y 直接搬过来 |
| 编译报"精度超过纳米" | 写了亚纳米尺寸（如 `0.0000001mm`） | 改成整数纳米；IR 不许浮点，也不许丢精度 |
| 改了符号但产物没变 | IR 或 KiCad 输出未从最新源重建 | 从项目根目录重新运行本节的编译命令，再用新 IR 重新运行导出命令 |
