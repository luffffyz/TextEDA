# TextEDA Logo

**最终方案:扁版板子图形 + 等宽字标(Cascadia Mono)。**

之前迭代过的方框版、分叉双焊盘版、裸 T 版都已删掉,只保留下面这一套。

## 文件

**`svg/` 目录**

| 文件 | 用途 |
|---|---|
| `texteda-logo.svg` | **主标志**:扁版图形 + 等宽字标,透明底 |
| `texteda-logo-dark.svg` | 深色底主标志 |
| `texteda-logo-tagline.svg` | 主标志 + 描述语 `Hardware as text` |
| `texteda-logo-cn.svg` | 主标志 + 中文描述语 `用文本描述硬件` |
| `texteda-icon.svg` | 头像(方形 240×240,圆形裁切安全) |
| `texteda-icon-dark.svg` | 深色底头像 |
| `texteda-social-preview.svg` | GitHub 社交预览图 1280×640 |
| `texteda-brand-sheet.svg` | 品牌手册一页纸 |
| `texteda-positive-negative.svg` | 正负对照表 |

**`png/` 目录** — 常用尺寸导出:字标 1800px、图标 16/32/64/128/256/512、社交预览、
品牌手册、正负对照表、`favicon.ico`,另附 `preview.png` 快速预览。

**根目录** — `README.md`(索引,英文)、`DESIGN.md`(本文件)、`build_logo.py`(生成脚本)、
`_font/`(Cascadia 字体 + OFL 许可,只用于离线重新生成;成品 SVG 只有轮廓路径,不依赖字体)。

## 字标:全粗体等宽

「Text」和「EDA」**都是粗体**(Cascadia Bold,wght 700),只靠颜色区分。
混排(「Text」常规 + 「EDA」粗体)那版试过,放弃的原因:「Text」偏轻,整串像两个词拼的,
不像一个整体。全粗体更像代码编辑器的字标,也更贴"一切都是纯文本"的定位。

想换回混排:把脚本里 `_WORDMARK_OPT["cascadia"]["text_bold"]` 改成 `False` 重跑即可。

## 场景对照

| 场景 | 尺寸约束 | 用这个 |
|---|---|---|
| README 顶部、页眉、banner | 宽 | `svg/texteda-logo.svg` |
| GitHub / 社交预览、OG 图 | 1280×640(2:1) | `svg/texteda-social-preview.svg` |
| **GitHub 头像、仓库 About** | **圆形裁切** | **`svg/texteda-icon.svg`** |
| favicon | 16×16 正方形 | `png/favicon.ico` |
| npm 图标 / VS Code 插件图标 | 正方形 | `png/icon-128.png` |
| 文档正文里行内引用 | 窄 | `svg/texteda-icon.svg`(纯图形) |

**头像为什么单独做一个**:GitHub 头像是**圆形裁切**。横版标志塞进圆形里左右两端会被切掉;
方框标志的四角会被斜切掉。所以头像用的是**不带框的扁 T,居中在正方形画布里** ——
横杠落在圆的赤道位置(圆的最宽处),三个圈完全在圆内,怎么裁都不掉。

## 图形概念

- **「T」本身是一条 PCB 走线** —— Text。横杠是横杠,竖干是竖干,按真电路板的习惯走 45° 斜角。
- **三个端点各套一个圈** —— 三个端子,也是"一个 T 字 = 三个连接点"最直白的读法。
- **扁版**:一条横杠引到左右两端的圈,竖干往下引到底端的圈。宽扁,适合横向排版。
- **浅色过孔** 在框的下角,补上"这是一块板"的信息(正色 `#B0C2DB`,负色 `#4A6699`)。
- 珊瑚红是画面里唯一的暖色,视线自然落在三个圈上。
- 字标下面那条带圆点的横线也是一根走线,前后统一。

## 排版细节(都是量过的,不是凭感觉)

- **字标用等宽 Cascadia Code / Mono(OFL-1.1),全粗体**:把"一切都是纯文本"直接写在字面上。
  描述语(`Hardware as text`)也用同一套等宽字体,字距 +0.08 —— 整行看着像代码里的
  标签,和字标是同一套语言。中文描述语另用 Noto Sans CJK(等宽字体没有中文字形)。
  市面上 EDA 标志(KiCad、Altium、EasyEDA)清一色比例无衬线,等宽反而更有辨识度。
  (Cascadia Code 和 Cascadia Mono 的常规字形完全相同,Mono 只是去掉了编程连字。)
  比例无衬线版本试过,最终没留 —— 不需要备选,一套就够。
- **字距(tracking)分段给**:「Text」用 **−0.026**,「EDA」保持 **−0.010**。
  等宽的字宽固定,直接用会松散;但收过头「x」「t」会粘在一起,−0.026 是量出来的平衡点
  (内部墨迹间隙 T-e/e-x/x-t = 6.7 / 8.7 / 5.5)。粗体大写字母本身更宽、需要更多空间,
  所以「EDA」收得少 —— 紧凑的小写 + 开阔的大写,反而成了字标的一个层次对比。
- **手动 kern 拉紧 "Te" 和 "ex"**:等宽字的格宽一样,但墨迹宽度不同,三个间隙天生不匀
  (全粗体下 T-e 5.3 / e-x 6.9 / x-t 3.7)。脚本里的 `_PAIR_ADJ = {"Te": -1.5, "ex": -3.1}`
  把前两对收进来,三个间隙变成 **4.0 / 4.2 / 3.7**,一条节奏。
  「ex」比另外两对多留一点,是因为 `x` 是斜的 —— 包围盒算出来的空隙比实际视觉小,
  斜对角需要更多空间,这是排版的标准做法。
  **只对字标生效**,手册里的标注文字不受影响。
- **「Text」和「EDA」之间的边界间隙按内部平均间隙的 1.4 倍定**(等宽 11 单位),
  按墨迹边缘对齐而不是 advance 宽度。边界必须比内部更宽,否则换个颜色就像挤在一起。
- **字标按字体的真实 kerning 排版**:每个字母的位置来自字体自己的前缀宽度测量,
  所以 `Te` 这对的负间距会被收回来。
- **基线干净**:不用 FreeSans(Helvetica 度量)——它的「e」「t」会探出基线 2.3 个单位,
  一眼就能看出错位。Cascadia 只有 0.98,剩下那点下冲是圆形字母的正常 overshoot。

## 配色

| 名称 | 正色 | 负色 | 用途 |
|---|---|---|---|
| Ink | `#14213D` | `#F0F5FF` | 「Text」字标、图形描边 |
| Teal | `#00A38E` | `#2FD3B7` | 「EDA」字标、走线 |
| Coral | `#FF6B4A` | `#FF7A5C` | 三个圈、线尾圆点 |
| Chip | `#EDF3FF` | `#16233A` | 板子底色 |
| Via | `#B0C2DB` | `#4A6699` | 角落过孔 |
| Muted | `#5A6B85` | `#8AA0C2` | 描述语 |
| BG | — | `#0B1626` | 深色底 |

**负色的过孔必须比芯片底更亮** —— 第一版给成了比底还暗的色,深色版上等于看不见。

## 放进 GitHub README

```markdown
<p align="center">
  <img src="docs/assets/svg/texteda-logo.svg" width="420" alt="TextEDA">
</p>
```

社交预览图上传到 Settings → General → Social preview。

## 重新生成

```bash
python3 build_logo.py     # 需要 matplotlib + fontTools
```

字标字体在脚本顶部的 `WORD_FONT` 设置为 `"cascadia"`(等宽全粗体)。
选 cascadia 时脚本会自动从 jsDelivr 拉 Cascadia Code 可变字体并固化 Regular/Bold
两个实例(存在 `_font/`,含 OFL 许可文件)。成品 SVG 里只有轮廓路径,不依赖字体文件;
字体本身只在重新生成时需要。

字距、边界间隙、过孔半径、圈的位置都在脚本的 `_WORDMARK_OPT` / `mark_*_svg()` 参数里,
改完重跑即可。
