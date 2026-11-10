# `view` 描述规范（草案）

Status: Draft. Decisions and trade-offs are in [ADR-0035](../docs/adr/09-view/0035-the-view-layer-is-a-drawing.md) and [ADR-0069](../docs/adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md); shared lexical, unit, version, and canonical rules are in `teda.md` §§3–5, 10, and 12.

本文件是 `teda.md` 的分描述补充：`.teda` 语言的共用规则在 `teda.md`，`view` 这一类描述的具体段定义在这里。

Every `.teda` file declares the shared language version, currently `0.14.0` (see `spec/teda.md` §12.1). The `view` type was introduced at `0.6`; its reader floor is now `0.14` because project-level roots and flat project-page ownership replace board-owned schematics and pages ([ADR-0069](../docs/adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D4, D6). A `view` file must declare language `0.14` or later; there is no legacy board-scoped reader.

Language `0.12` added module-box and module-port overview sections and page size ([ADR-0067](../docs/adr/09-view/0067-hierarchical-module-views-and-custom-page-size.md)). Language `0.13` added reusable `module_view` drawings, `sheet_template` descriptions, and page composition with `template` and `module_place` ([ADR-0068](../docs/adr/09-view/0068-reusable-module-drawings-and-sheet-templates.md)). These features remain available in language `0.14.0`; module-port wire endpoints are not a project-page connection mechanism.

**All view-layer artifacts are advisory.** Project pages, module drawings, sheet templates, and composed pages contain geometry and references, not electrical or physical facts. Editing or deleting them can change view diagnostics and the advisory hash only; views never change project connectivity, PCB copper continuity, the normative project hash, or netlist output ([ADR-0068](../docs/adr/09-view/0068-reusable-module-drawings-and-sheet-templates.md) D1; [ADR-0069](../docs/adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D4–D5).

## 0. Position and authority

`view` describes one project print page: where project components and module boxes are drawn, how project nets are shown, and where project ports and declared interconnects appear. It is the drawing layer (S1) between project logic (S0) and the renderer.

1. **A view is not a second source of truth.** Module descriptions own component facts; the project root owns module-instance identities, project nets, project ports, constraints, and interconnects. A view refers to those identities and cannot redefine them.
2. The renderer does not arrange symbols, wires, labels or ports. It does provide deterministic `Reference` / `Value` field positions when no override is present; this narrow text-placement rule is not a layout solver.
3. **Views are disposable drawings.** A project remains logically and physically defined without any view pages.
4. **A view never changes continuity.** Wires draw root project-net membership; an `interconnect` row draws a separately declared root interconnect. Neither creates, removes, or changes a connection.

### 0.1 Project references

Component endpoints use numbered pins (`M1.U1.5`), not pin names (`M1.U1.PA0`) or multi-unit shorthand (`M1.U1.2.OUT`). Module ports use `<module_instance_id>.<port_id>` (for example, `M1.SYS_OUT`). Project nets and flattened component identities are defined by the root and module descriptions; views only refer to those identities.

### 0.2 Project root, PCBs, and print pages

The project has one logical root, `design/sch/main.teda`. Its `modules`, `nets`, `ports`, constraints, and `interconnects` describe project logic. Module definitions in `design/modules/<module_id>.teda` own component instances and their local electrical facts. Physical implementations are separate `pcb` files at `design/pcb/<pcb_id>.teda`; their module assignments and copper describe physical ownership and intra-PCB continuity, not another logical root.

| | Project logic | Physical implementation | Print page |
|---|---|---|---|
| File | `design/sch/main.teda` and `design/modules/<module_id>.teda` | `design/pcb/<pcb_id>.teda` | `views/<page_id>.view.teda` |
| Description type | `schematic` and `module` | `pcb` | `view` |
| Identity | Project-wide module-instance, net, port, and interconnect IDs | PCB ID and its assigned project module instances | Flat project page ID; IR `project` identity is `main` |

The page ID has no PCB parent. A page can draw flattened project instances such as `M1.U1`, project nets and ports, module topology, and root interconnects. It does not declare module ownership, root net membership, interconnect endpoints, PCB assignment, or copper continuity.

`main` is the conventional first-listed page ID, not a required page or topology-overview role. Any page may draw module boxes, module ports, and declared interconnect links without component placements or a `place` section. Detail pages may place any subset of project components. No view pages is a valid project state; tools must not synthesize a page.

Page divisions are for drawing and review only. Project logic and physical implementation remain complete and checkable regardless of how pages are split or whether any page exists. See [ADR-0069](../docs/adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md).

---
## 1. File header

```
version 0.14.0
view main
```

- Header rules follow `teda.md` §5.
- The filename must match the type-line ID after removing `.view`: `views/<page_id>.view.teda` ↔ `view <page_id>`. The `.view` suffix marks the type.
- Page IDs share one flat project namespace; no board ID is encoded in the path or identity.

### 1.1 Page identity and overview convention

A page ID names a project drawing file; it does not select a mandatory role. `main` is conventionally listed first; it may be a detail page or an overview, and a topology overview may use any page ID.

| Convention | Common page ID | Drawing |
|---|---|---|
| Project topology overview | Any ID (often `main`) | Module boxes and ports, plus links that reference declared root interconnects; component `place` rows are optional and may be absent |
| Detail page | Any ID, including `main` | Any subset of project components placed with `place`, optionally alongside module or interconnect drawings |

- One file is one print page. The page ID is a stable drawing reference, not a logical boundary or board identity.
- A page may mix and split components from project modules freely. An ID that happens to equal a module name does not establish ownership.
- A page that declares `module_place` is a composed page (§14), regardless of its ID. A page may also use a template without adopting an overview or detail role.
- The project root, module descriptions, and PCB descriptions remain authoritative for their respective logical and physical facts. All page drawings are advisory.

### 1.2 The three view-layer files

| Type | File | Type line | What it is |
|---|---|---|---|
| `view` | `views/<page_id>.view.teda` | `view <page_id>` | One project print page (§4–§8) |
| `module_view` | `views/modules/<module_id>.module-view.teda` | `module_view <module_id>` | One module's reusable, module-local drawing (§12) |
| `sheet_template` | `views/templates/<template_id>.sheet-template.teda` | `sheet_template <template_id>` | Static sheet furniture and the extent it supplies (§13) |

All three types live under `views/`, distinguished by directory and suffix (`.view` / `.module-view` / `.sheet-template`). A `view` page ID is flat and project-wide; reusable module drawings and templates keep their own type-specific identities. The ID on each type line must match the filename after removing its suffix.

---


## 2. 标量

标量在第一个段之前，值为行尾剩余文本（`teda.md` §4.4）。

| 键 | 必填 | 说明 |
|---|---|---|
| `size` | No | This page's extent `[width,height]` in mm, one tuple cell (`teda.md` §4.3; [ADR-0065](../docs/adr/01-language/0065-a-coordinate-tuple-is-one-cell.md) D1). Canonical since language `0.12`. Defaults to `[297,210]` (A4 landscape). |
| `sheet` | No | Legacy alias for `size`, with identical dimensions and semantics. Accepted as an input spelling; canonical output uses `size`. |
| `template` | No | The sheet template this page draws on: `views/templates/<template_id>.sheet-template.teda`. Added in language `0.13` ([ADR-0068](../docs/adr/09-view/0068-reusable-module-drawings-and-sheet-templates.md) D4). |

- `size` and `sheet` are mutually exclusive spellings of the same page extent ([ADR-0067](../docs/adr/09-view/0067-hierarchical-module-views-and-custom-page-size.md) D6).
- `template` and page-size keys are mutually exclusive: a page with `template` uses the template's `size` as its extent ([ADR-0068](../docs/adr/09-view/0068-reusable-module-drawings-and-sheet-templates.md) D4).
- Without an explicit size or template, the page defaults to A4 landscape, 297 × 210 mm. A template supplies the extent instead.
- Language `0.14` is the minimum view version, so `size` is available in every valid project page. The reader also accepts the legacy `sheet` spelling; canonical output writes `size`.
- Scalar order is irrelevant; canonical form places page-size scalars before the sections (§11).
- The IR page extent remains `SchematicView.sheet` (`{width_nm, height_nm}`). A page using a template omits its own `sheet` field (IR contract `v0.19`; [ADR-0067](../docs/adr/09-view/0067-hierarchical-module-views-and-custom-page-size.md) D7).


### 2.1 坐标系

- 单位 **mm**，分辨率 **0.01 mm**（2026-10-25 起；此前是 0.1 mm）。这是**格式能表达的精度**，不是绘制网格。绘制网格是 `0.5 mm` 晶格（[ADR-0059](../docs/adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D1）：**打印页存的每一个坐标**都锚在它上面——`place` 的符号原点、`field` 的字段锚点（符号局部系）、`wire` 的折点、`label` 的标签位置、`port` 的端口位置、`text` 的注释位置，两个轴都是。符号侧的引脚连接点与引脚内端同样在这张晶格上（`spec/symbol.md` §4.1，[ADR-0057](../docs/adr/08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) D1），摆位吸附也是 `0.5 mm`（同一条记录 D4）。**目前不允许自由摆位**（[ADR-0059](../docs/adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D5）。格式比晶格细一档，是为了让历史文件与手工微调仍能表达；把分辨率调粗到 `0.5 mm` 会改变 canonical form，并让长度诊断改写每一条旧坐标。超出这个分辨率仍报 `value.length-invalid`。
- 晶格是**作图约定**，不是新的诊断码：跑偏了由既有的 `view.wire-diagonal` / `view.wire-crosses-pin` 这些码说话，仓库的门禁另外查（[ADR-0059](../docs/adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D2）。
- 原点 = **图幅的左上角**；**+x 向右，+y 向下**（与 SVG 的坐标系一致，渲染器不需要翻转）。
- 旋转角度单位为度，**顺时针为正**，缺省 `0`。
- IR 里长度一律是整数纳米（`_nm`）、角度是整数毫度（`_mdeg`），见 `AGENTS.md` §2 第 18 条与 `docs/adr/02-ir/0006-ir-shards-and-hashes.md` decision 7。
- **模块框的几何**（§4.2）与页一样：框的左上角 `[x,y]` 与尺寸 `[w,h]` 都锚在 `0.5 mm` 晶格上，整个框落在**这一页自己的尺寸**之内（写明的尺寸，或缺省的 A4 横向 297 × 210 mm）。框的尺寸与页的尺寸是两件事：页的尺寸是这一页的范围，框的尺寸是这个模块画出来的范围。

---

## 3. 段总表

| Section | Contents | Required |
|---|---|---|
| `place` | Component-instance placement | No |
| `field` | Per-instance `Reference` / `Value` position overrides | No |
| `module` | Module boxes (topology overview) | No |
| `module_port` | Module-port positions (topology overview) | No |
| `interconnect` | Drawing of a declared root interconnect | No |
| `module_place` | Placement of reusable module drawings (composed page) | No |
| `junction` | View-only drawing nodes and coordinates | No |
| `wire` | Project-net drawing edges | No |
| `label` | Project-net name labels | No |
| `port` | Project-port symbols | No |
| `text` | Free annotation text | No |

`place` is optional. A topology-only overview may contain module boxes, module ports, and interconnect drawings without any component placements. Segment headers are reserved words (`teda.md` §3). Sections use fixed columns and do not use colons or continuation lines.

The `module` and `module_port` sections were added in language `0.12`; `module_place` was added in `0.13` ([ADR-0068](../docs/adr/09-view/0068-reusable-module-drawings-and-sheet-templates.md) D4). The project `interconnect` drawing section requires language `0.14`. A page must not mix `module_place` with legacy `module` / `module_port` sections.

---

## 4. `place` 段

```
place
  U1    [40.0,30.0]  0
  C1    [20.0,30.0]  90
  U2    [80.0,30.0]  0   unit=2
```

列：`<instance_id> <origin> [<rot>] [key=value …]`，`<origin>` 是 `[x,y]`。

| 列 | 说明 |
|---|---|
| `instance_id` | Project component-instance ID, such as `M1.U1`; it must exist in the flattened project model assembled from the root and its module descriptions |
| `x` `y` | 符号**原点**在图幅坐标系里的位置（mm） |
| `rot` | 符号旋转（度，顺时针为正），缺省 `0`。v0.1 只支持直角旋转：必须是 0/90/180/270，否则报 `value.angle-invalid` |

可选尾列（`key=value`，顺序任意，多余的键报错）：

| 键 | 说明 |
|---|---|
| `unit` | 多单元器件画哪一个单元（`1` 起）；缺省 `1`。取值必须 ≤ 该器件的单元数 |

- 符号画成什么样**不在视图里**：由 `component.symbol` → 符号库决定，渲染器自己去查。视图只说"这个实例摆在哪儿、朝哪儿"。
- `x` `y` 锚在 `0.5 mm` 晶格上（§2.1，[ADR-0059](../docs/adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D1）。摆位吸附也是这张晶格（[ADR-0057](../docs/adr/08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md) D4）。
- 引脚的连接点坐标 = 符号原点 + 旋转后的引脚偏移（符号的几何事实，见 `spec/symbol.md`）。因此**符号改了引脚位置，视图里的线自动跟着走**，视图不需要跟着改。
- A page places only the instances it draws; project instances omitted from a page are not errors. In particular, a topology-only page may omit `place` entirely.

---

## 4.1. `field` section

`field` is optional. It stores positions for the two schematic-instance fields, never their text or electrical facts:

```teda
field
  U1  Reference  [0.00,2.00]
  U1  Value      [-0.50,-2.00]
```

Each row is `<instance_id> <name> <offset>`. The vocabulary is closed to exactly `Reference` and `Value`; each `(instance_id, name)` pair occurs at most once. The instance must occur in this page's `place` section. `<offset>` is `[x,y]` relative to the symbol origin and is not checked against sheet bounds. In this local frame, `+x` points right and `+y` points up. The renderer applies the symbol's right-angle rotation when projecting a field to sheet coordinates; moving or rotating the symbol therefore carries the override with it.

Two coordinate facts apply, and they are different questions (§2.1): the coordinates are written with the view file's `0.01 mm` **resolution** — the finest value the format can express, and the limit a writer is checked against — while the **drawing lattice** is `0.5 mm`. A field anchor is a lattice point in both axes ([ADR-0059](../docs/adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D1), and the review app snaps it there like a symbol placement. The file format does not *reject* a non-lattice value — `0.01 mm` resolution is what the format promises — but the drawing convention does not admit one, and the repository's view-style gate reports it.

The text is taken from the schematic instance: `Reference` is its instance id and `Value` is its instance value. If the instance has no value, the renderer retains the symbol library's `Value` placeholder. A field row overrides its automatic position; deleting the row restores automatic placement. There are no `automatic` rows or tombstones.

Without an override, a symbol with visible painted body geometry places `Reference` above and `Value` below the body, centered on its horizontal bounds with `1 mm` clearance from painted text ink. Geometry from the selected unit and shared visible symbol geometry both count. A bodyless symbol retains its library field positions and existing quarter-turn field anchoring. This is renderer-owned default text placement; it does not place symbols or change the drawing's connectivity.

The places above are the places a field *wants*. The page decides whether it gets them: the renderer places a page's fields together, in the order the page places its instances. A field keeps the place it wants while that place is free, and otherwise steps to the next free slot around its own body — the side across from the one it wanted, then the two sides at right angles to it, and each of those three again `2 mm` further out, so a field never floats more than `5 mm` from the body it names. A slot is free when the text would cover nothing else on the sheet: no other field, no label, no port tag, no note, no other symbol's painted body, and no wire run. A field's own body is not in that list — the `1 mm` clearance above is the rule that governs it — and a field an override placed by hand is not moved; the automatic fields route around it.

The result is a drawing fact, recomputed on every render like the places above, and it is never written back into the view file: an override decides its own field and nothing else. Two parts drawn close therefore keep readable designators and values, and a page that has no room left says so in the check report (`view.text-overlap`, §9.2) rather than printing one text on top of another.

An override is for a position the author *wants*, not for one they need. An automatic field is
recomputed every time the page is rendered, so it follows its symbol through an Apply; an override
does not, and a row written to dodge a collision goes stale the moment the parts around it move.
The renderer routes around a collision on its own, so no row is needed to keep two fields apart:
write one only where the author wants a field somewhere else. The review app reports `manual`
versus `automatic` on every field, which is how a reviewer tells the two apart.

`field` was introduced in language `0.10`. Every view file now declares language `0.14` or later because the project-level page and root shapes changed; this applies whether or not the page contains a `field` section. Version validation runs before the body is parsed. Unknown field names are invalid literals, duplicate pairs report `value.duplicate-field`, and an unknown instance reports `ref.unknown-instance`.

---

## 4.2. `module` 段（概览页的模块框）

`module` 段是可选的，属于概览页（§1.1），语言 `0.12` 引入。

```
module
  M1  charger-power   [20.0,20.0]   [90.0,60.0]
  M2  buck-5v         [150.0,20.0]  [80.0,60.0]
```

列：`<module_instance_id> <module_id> [x,y] [w,h]`。

| 列 | 说明 |
|---|---|
| `module_instance_id` | Project module-instance ID (for example, `M1`), declared in the root's `modules` section |
| `module_id` | The module definition bound to this project instance by the root |
| `x` `y` | Top-left corner of the drawn frame in page coordinates (mm) |
| `w` `h` | Width and height of the drawn frame (mm) |

- **A frame is only a drawing.** It shows a boundary, never the contents: component instances, nets, and constraints belong to the module definition, and its external ports are declared in that module's `ports` section (`spec/module.md` §§2–3).
- The frame has its own position and dimensions, independent of the page size. Its corners and dimensions follow the `0.5 mm` lattice, and the whole frame must fit on the page (§2.1).
- Frames are advisory; a page may show any subset of project modules. Project-wide view-coverage warnings are advisory, not logical errors.
- Electrical facts are owned as described in `spec/module.md` §7.2 and ADR-0069: modules own internal facts, the root owns module instances and project bindings, and views only reference them.

---

## 4.3. `module_port` 段（概览页的模块端口）

`module_port` 段是可选的，属于概览页，语言 `0.12` 引入。

```
module_port
  M1.SYS_OUT   [110.0,50.0]
  M2.SYS_IN    [150.0,50.0]
```

列：`<module_instance_id>.<port_id> [x,y]`。

| 列 | 说明 |
|---|---|
| `id` | 带实例前缀的端口：模块实例 id + 模块声明的端口名（`M1.SYS_OUT`） |
| `x` `y` | 端口在页上画出来的位置（mm） |

- The referenced module definition must declare the port, and the project root must bind that module-instance port to a project net. A drawing cannot create, move, or rebind a port.
- The module instance must have a frame on this page (§4.2); the port is drawn on its module boundary.
- These sections are optional `SchematicView` arrays `module` and `module_port`; omitted sections are absent from IR.

---

## 4.4. `interconnect` section

The optional `interconnect` section draws root interconnects on a project page. Each row is `<interconnect_id> <from_module_port> <to_module_port> [<point> [<rotation>]]`:

```teda
interconnect
  ic1  M1.SYS_OUT  M2.SYS_IN  [130.0,50.0]  0
```

- `interconnect_id` must name an interconnect declared by the project's root `design/sch/main.teda` `interconnects` section. The endpoint IDs must exactly restate that root row, in its declared order.
- This row draws only the declared project-level join. It cannot create, remove, reverse, or re-endpoint continuity; views that omit it do not alter the root. Where project-wide page coverage is checked, omission is advisory.
- Both endpoints need page drawing positions: `module_port` rows for module-box overviews, or the matching `port` rows in placed module drawings on composed pages (§14.4).
- `<point>` is an optional page-coordinate position for the interconnect drawing. `<rotation>` is optional clockwise right-angle rotation and defaults to `0`.
- An interconnect is not a PCB trace or a `wire` endpoint. PCB copper and board-local connectivity remain physical-board facts, separate from this project-level drawing.

---

## 5. `wire` 段

```
wire
  VDD   U1.5  C1.1  [35.0,25.0]
  GND   C1.2  U2.4  [15.0,25.0]  [15.0,12.0]
```

列：`<net> <from_endpoint> <to_endpoint> [<bend> …]`，每个 `<bend>` 是 `[x,y]`。

| 列 | 说明 |
|---|---|
| `net` | Project net ID, declared by `design/sch/main.teda` in its `nets` section |
| `from_endpoint` | Start: a project component pin reference, a project-port ID drawn on this page, or a junction declared on this page |
| `to_endpoint` | End point, with the same endpoint forms |
| `bend` | Zero or more ordered bend coordinates (mm), each one `[x,y]` cell |

- `@x,y` **不是合法 wire endpoint**。历史文件必须把每个匿名坐标提升为命名 junction，并在 `junction` 段声明其坐标；实现不得静默把旧端点解释成 junction。
- A component-pin endpoint refers to a project component instance and must belong to the row's declared project net. A project-port endpoint must be declared by the project root and drawn in this page's `port` section. A junction is a page-local drawing node only.
- Module ports are drawn as project ports by `module_port`; a project-level join between ports is drawn only by an `interconnect` row (§4.4), never by an ordinary `wire` row. Drawing either cannot create or alter the root's net membership or interconnect endpoints.
- On composed pages, a project port may be positioned by a placed module drawing's `port` row and its placement transform (§14.3); that drawing remains advisory.
- Wires must not cross a module frame except at a project-port endpoint on its boundary (`view.wire-crosses-module`, §9.1).
- Wire geometry joins the resolved endpoint positions (pins, project ports, or junctions), in order through its bends. Endpoint identity is not a coordinate alias.
- One `wire` row is one visual edge of a declared project net. Junctions are drawing-graph nodes, not project-net members, and do not change root connectivity.
- Pin and project-port endpoints must agree with the root project net; junctions are page-local drawing nodes. Different nets cannot share a junction.
- The page's drawing graph is checked for dangling endpoints, geometric gaps, disconnected required members, isolated junctions, and invalid junction degree. These checks concern drawing fidelity only; they do not change project connectivity. Geometric crossings between different nets do not connect them.
- With Review App Re-anchor wires disabled, moving or rotating a pin does not change endpoint identity or author-written bends; affected nets are stale until explicitly repaired with `view rewire`. When enabled, pin identity is retained and endpoints follow the existing re-anchor rule.
- **只走 90 度**：每一段必须平行于坐标轴，违反即报 `view.wire-diagonal`（§9.2）。
- **走线不得自交**：重锚若保形会使路径自交，则按既有规则重建并报告冲突（[ADR-0042](../docs/adr/09-view/0042-the-review-app-has-modes.md) D5、[ADR-0062](../docs/adr/09-view/0062-a-run-may-end-at-a-port.md)）。
- **A pin connection point may be the endpoint of a perpendicular wire**: when a wire ends at a pin connection point and its final segment is perpendicular to the pin stroke, the renderer draws a junction dot at that point. The connection still comes from the wire's pin endpoint identity and net; this does not create another junction graph node.
- 走线不得穿过非本端点的引脚连接点或引脚笔画，违反即报 `view.wire-crosses-pin`（§9.2）。

### 5.1 `junction` 段

```
junction
  VOUT_J1  [204.0,92.5]
```

列：`<junction_id> <point>`，`<point>` 是 `[x,y]`。坐标单位为 mm，使用 view 的 `0.01 mm` 格式分辨率；坐标必须在图幅内，并遵守 `0.5 mm` 绘图晶格门禁（[ADR-0065](../docs/adr/01-language/0065-a-coordinate-tuple-is-one-cell.md)、[ADR-0059](../docs/adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md)）。`junction_id` 在本页唯一，且不得与页面 port id 混淆。junction 只属于 view drawing graph，不进入 schematic IR 的 net members。

Junctions of one net may be shared by multiple wire rows; different nets must not reference the same junction. A junction's degree is the number of effective wire arms connected to it: fewer than 2 is isolated/dangling, and more than 4 is invalid. Declared junctions and the perpendicular pin endpoints above draw dots; ordinary two-arm bends do not. Crossings between different nets do not create connection points.

---

## 6. `label` 段

```
label
  VDD   [35.0,25.0]
  GND   [15.0,25.0]
```

列：`<net> <point>`，`<point>` 是 `[x,y]`。

- 标签画的就是 **net id 本身**，**不允许改写显示文字**。标签若能显示与 net id 不同的东西（比如 net 叫 `VDD`、标签写 `3.3V`），图上就会出现"看起来叫 3.3V 的网络"——人读图时会误判网络名。想要 `3.3V` 这个名字，就把 net 命名为 `3.3V`。
- 标签位置必须落在**该 net 的某条走线上**，或落在**该 net 某个引脚的连接点**上；否则报 `view.label-not-on-net`（**警告**，不是错误：视图是给人看的图，位置偏了要提示，但不该让整张图不可用）。
- 标签锚点锚在 `0.5 mm` 晶格上（§2.1，[ADR-0059](../docs/adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D1）。
- 同一个 net 可以有多个标签（例如一页上多处标 `GND`）。

---

## 7. `port` 段

```
port
  SYS_OUT   [280.0,105.0]  180
```

Column: `<project_port_id> <point> [<rotation>]`, where `<point>` is `[x,y]`.

- `project_port_id` must be declared in the root `design/sch/main.teda` `ports` section (`teda.md` §7.5). A view does not declare project ports.
- The port glyph does not create connectivity; it draws an existing project port.
- A row both draws the glyph and supplies its position as a `wire` endpoint. The endpoint uses the same project-port ID and coordinates; a wire endpoint must have a matching `port` row on this page ([ADR-0062](../docs/adr/09-view/0062-a-run-may-end-at-a-port.md) D1–D2).
- Moving the row moves the glyph and the wire endpoint together; the view cannot change the root port's identity or net membership.
- Port glyphs may be repeated on any number of project pages.
- The anchor follows the `0.5 mm` drawing lattice (§2.1, [ADR-0059](../docs/adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D1). Rotation is clockwise degrees and defaults to `0`.
---

## 8. `text` 段

```
text
  12.0 8.0   Rev A — power section
```

列：`<point> <text…>`，`<point>` 是 `[x,y]`。

- 第三列起是**行尾剩余文本**（与标量同一约定，`teda.md` §4.4），允许空格。
- 注释锚点锚在 `0.5 mm` 晶格上（§2.1，[ADR-0059](../docs/adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D1）。
- 纯注释，不带任何电气含义，不参与任何校验（除了"文字重叠"这类可读性检查）。

---

## 9. 校验

Validation has two scopes: syntax and page-local geometry are checked while reading the file; project references and drawing fidelity are checked against `design/sch/main.teda`, its module descriptions, and the composed project model. These checks run with `texteda check` ([ADR-0038](../docs/adr/10-process/0038-implementation-stack-and-agent-entry.md)); `texteda ir` writes shards without running cross-file checks. View shards are advisory and excluded from the normative project identity ([ADR-0006](../docs/adr/02-ir/0006-ir-shards-and-hashes.md), [ADR-0069](../docs/adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D5).
### 9.1 错误（阻断）

| 码 | 触发 | 状态 |
|---|---|---|
| `view.pin-not-placed` | A `wire` pin endpoint's project component instance is absent from this page's `place` section | Implemented (parser) |
| `view.out-of-sheet` | A point or drawing bounds exceed the page extent; for `module_view` the local `bounds`, for `sheet_template` the `size`, and for `module_place` the transformed bounds are checked | Implemented (parser and project checks) |
| `value.angle-invalid` | A rotation is not an integer right angle (the view supports only 0/90/180/270 degrees) | Implemented (parser) |
| `ref.unknown-instance` | A project page `place`, `module`, or `module_place` row references an instance absent from the flattened project model; `module_view` placements must reference an instance declared by that module | Implemented (project checks) |
| `ref.unknown-net` | A project-page `wire` or `label` names a net absent from the project model; a `module_view` must reference a net declared by its module | Implemented (project checks) |
| `ref.unknown-port` | A project-page `port` or `module_port` references an undeclared project/module port | Implemented (project checks) |
| `ref.unknown-interconnect` | An `interconnect` row references an ID not declared by the root | Implemented (project checks) |
| `view.pin-net-mismatch` | A `wire` pin endpoint is not a member of the row's declared project net | Implemented (project checks) |
| `view.port-not-drawn` | A `wire` endpoint references a project port not drawn in this page's `port` section | Implemented (parser) |
| `ref.unknown-junction` | A `wire` endpoint references a junction not declared on this page | Implemented (project checks) |
| `view.wire-dangling-endpoint` | A wire endpoint has no corresponding pin, project-port, or junction anchor in the rendered geometry | Implemented (project checks and rendered geometry) |
| `view.wire-gap` | Wire geometry passes through a declared junction of the same net without ending at that junction | Implemented (project checks and rendered geometry) |
| `view.wire-disconnected` | Required pin/port nodes in this page's drawing of one project net are not in one connected component | Implemented (project checks) |
| `view.junction-isolated` | A declared junction is not used by a valid wire edge | Implemented (project checks) |
| `view.endpoint-wrong-net` | A junction or page port is used by a wire for a different project net | Implemented (project checks) |
| `view.module-unknown-instance` | A `module` or `module_place` row names an instance absent from the project root | Implemented (project checks) |
| `view.module-id-mismatch` | A `module` or `module_place` row names a module definition other than the one bound to that project instance | Implemented (project checks) |
| `view.wire-crosses-module` | A page wire crosses a drawn module frame away from its own project-port endpoint | Implemented (readability check) |
| `ref.unknown-module` | A composed page references a missing template or module drawing, or a placed instance has no module drawing for its root-bound module | Implemented (project checks) |

`view.out-of-sheet` also applies to module-drawing bounds, template furniture bounds, and each transformed module placement against the page extent. Module-drawing references are checked against the module definition's local instances, nets, and ports; template references are checked as literal static geometry (see §§12.2–12.3 and 13.2–13.4).

Module and project-port references are checked against the root and module definitions, not against a PCB. A page may draw only a subset of the project; omitted component placements are not errors.

### 9.2 警告（不阻断）

| 码 | 触发 | 状态 |
|---|---|---|
| `view.nets-not-drawn` | A project net with at least two members has no wire or label on any project page. When pages exist, this is one advisory coverage warning with a count and up to ten net IDs; a project with no pages is valid and produces no view-coverage warning. | Implemented (project checks) |
| `view.label-not-on-net` | 标签没落在该 net 的走线或引脚上（该 net 在本页**有画走线**时才判：整条 net 没画是 `view.nets-not-drawn` 的事，不逐标签重复） | 已实现（可读性检查，`packages/core/src/view/readability.ts`） |
| `view.port-not-on-net` | 端口符号没落在该 net 的走线或引脚上（同一前提） | 已实现（可读性检查，同上） |
| `view.wire-crosses-symbol` | 走线穿过某个符号的本体（`AGENTS.md` §6 的可读性检查）；本体取符号**图形**的包围盒，不含文字字段 | 已实现（可读性检查，同上） |
| `view.wire-diagonal` | 走线有一段**不平行于坐标轴**（§5）：整页横平竖直，唯一的斜线读不出来它的两端是什么关系 | 已实现（可读性检查，同上） |
| `view.wire-crosses-pin` | 走线穿过某个引脚的连接点（该引脚不是这条走线的端点时），或穿过该引脚从连接点到符号本体的笔画（§5）：读者会把走线读成引脚的一部分，或读成一个没有圆点的连接 | 已实现（可读性检查，同上） |
| `view.text-overlap` | 两段文字互相压住（**相切不算**，必须有重叠面积）。**符号画的字段（Reference / Value）也是文字**：字段压字段、字段压标签或注释，同归这条 | 已实现（可读性检查，同上） |
| `view.label-collision` | 两个标签压在一起（label 与 label 的重叠归这条，其余文字组合归 `view.text-overlap`） | 已实现（可读性检查，同上） |
| `view.text-on-wire` | 走线从文字**中间**穿过：字还在，词读不出来。标签与端口**豁免它自己命名的那个 net**（标签本来就落在自己的线上），符号画的字段（Reference / Value）与自由注释不豁免 | 已实现（可读性检查，同上） |

> Crossings between different nets do not connect them: a dot indicates a junction, and an unmarked crossing does not. `view.wire-crossing` is retired and is not emitted.

> 码表见 `docs/error-codes.md`（由 `packages/ir/src/diagnostics/codes.ts` 生成）。诊断码按"错误的种类"分域，不按发现阶段分（[ADR-0003](../docs/adr/01-language/0003-diagnostic-error-codes.md)）："引用了不存在的东西"在 `view` 里和在 `sch` 里是同一类错误，所以复用 `ref.*`；"角度不合法"复用 `value.angle-invalid`。`view` 域是本描述引入的新域，授权见 [ADR-0035](../docs/adr/09-view/0035-the-view-layer-is-a-drawing.md)。
>
> The diagnostic registry lists only emitted and registered codes ([ADR-0003](../docs/adr/01-language/0003-diagnostic-error-codes.md) decision 7). The table above lists current registered diagnostics; project-wide view-coverage warnings are advisory and do not become blocking errors.
>
> **几何从渲染器来，不从检查器推**。文字宽度、符号本体范围、引脚落点都由 `packages/renderer` 的 `schematicGeometry` 按**实际画法**算出（同一套变换、同一套笔画字体度量），检查器只判断"压没压住""在不在线上"。检查器自己再算一遍就会和读者看到的东西漂移，那正是可读性检查要防的那类错误。
>
> **字段也在几何里**：`schematicGeometry` 除了视图自己的记录（`label` / `port` / `text`），还给出每个已放置实例的 `fields`——符号画的 `Reference` / `Value` 在纸上的框（含旋转，按绘制后的矩形取包围盒）。字段的默认位置由渲染器确定，显式 `field` 覆盖由视图作者调整；两者都是视图几何的一部分，但都不改变逻辑事实。可读性检查读取最终字段几何：`view.text-on-wire` 就靠它报出"走线穿过位号"，`view.text-overlap` 就靠它报出"两个字段压在一起"。字段在整页上的位置由渲染器按 §4.1 的规则统一安排，所以一页里字段互相压住说明这页已经没有位置可让——检查器把它报出来，作者去把符号挪开。

### 9.2.1 诊断载荷

诊断的 `--json` 载荷带量才可修。`data` 字段使用与 IR 一致的单位（纳米）：

| 码 | `data` |
|---|---|
| `view.label-not-on-net` / `view.port-not-on-net` | `page` `net` `kind` `distance_nm`（到该 net 最近走线或引脚的**距离**） |
| `view.label-collision` / `view.text-overlap` | `page` `first` `second` `first_kind` `second_kind`（`label` / `port` / `text` / `field`）`overlap_area_nm2`（重叠**面积**） |
| `view.text-on-wire` | `page` `net` `kind` `text` `through_nm`（在文字框**内部**的长度）；字段另带 `instance` |
| `view.wire-crosses-symbol` | `page` `net` `instance` `through_nm`（在**本体内部**的长度） |
| `view.wire-diagonal` | `page` `net` `segments`（斜段**条数**）`x_nm` `y_nm`（第一段斜线的起点）`off_axis_nm`（该段偏出轴线的量 = min(abs(dx), abs(dy))） |
| `view.wire-crosses-pin` | `page` `net` `instance` `pin` `x_nm` `y_nm`（引脚连接点）；穿过笔画时另带 `cross_x_nm` `cross_y_nm`（笔画上的穿越点） |
| `view.nets-not-drawn` | `count` + 前十个 net 名 |
| `view.wire-dangling-endpoint` | `page` `net` `endpoint` |
| `view.wire-gap` | `page` `net` `junction` `wire`（本页 `wire` 段中的零基索引） |
| `view.wire-disconnected` | `page` `net` `components` `missing_members` |
| `view.junction-isolated` / `view.junction-invalid-degree` | `page` `junction` `degree` |
| `view.endpoint-wrong-net` | `page` `junction` / `port` `net`；junction 冲突另带 `other_net` |

同一组数字在人类可读输出里换成 mm / mm²，出现在消息里（"nearest point of the net is 6.8 mm away"）：一个偏 0.1 mm 的标签和一个偏 20 mm 的标签是同一条警告、两种完全不同的修法。

### 9.3 不校验的事

- **Views do not participate in ERC.** ERC uses the project's logical model, not page drawings; drawing mistakes are reported by `view.*` diagnostics.
- **Views do not change connectivity.** Omitting or misdrawing a wire, port, module, or interconnect leaves root net membership and declared interconnects unchanged.
- **An overview cannot add a project join.** It may draw a root-declared interconnect by ID (§4.4); only the root owns module-port net membership and interconnect endpoints. Deleting every page leaves the project logic, PCB checks, netlists, and normative project hash intact.
- **Module ownership is not a view fact.** Project module instances, root net membership, and interconnects are declared by the project root and module descriptions; PCB assignment and copper continuity are declared by the physical PCB descriptions. A page only references these facts.

### 9.5 可反解（round-trip）

渲染器只读（`AGENTS.md` §2 不变量 3），所以它画的每一页都必须能反解回"这一页说了什么"——`extract(render(ir)) == ir`（不变量 4，[ADR-0036](../docs/adr/09-view/0036-our-own-reference-renderer.md) decision 5）。

**比的是语义投影，不是 IR 本身**。一张打印页的语义是落在纸面上的东西：图幅大小、引脚连接点与朝向、符号自身的图形、走线折点、标签与注释的文字与位置、端口标签的尖点与朝向、模块框与模块端口的框线与位置，以及 `Reference` / `Value` 字段的文字与绝对图纸位置。以下故意不在投影里：

| 不进投影 | 理由 |
|---|---|
| 实例摆位原点与旋转本身 | 投影比较的是由它们产生的引脚、图形和字段在纸面上的可见结果；不比较 IR 的摆位参数本身 |
| 线宽、字号、对齐方式 | 外观，不是语义；符号自身的绘制由符号的 round-trip 负责 |
| 端口标签的塔形细节 | 只比尖点与朝向，改标签外形不算失真 |
| "这个引脚属于哪个实例" | 图上没有这条信息；同一符号的两个实例互换位置画出的是同一张图，实例身份靠投影中的 `Reference` 文字与字段归属来配对 |

**字段文字来自实例**：符号文件的 `Reference`（`U`）与 `Value`（符号名）只是占位符。图上 `Reference` 使用实例 id；`Value` 使用实例的 `value` 列，未提供时保留符号库 `Value` 字段的占位文本，见 `spec/symbol.md` §2。两字段的内容与最终纸面位置都进入投影；库占位文本仅在 `Value` 无实例值时进入投影。

**自动字段位置是确定性渲染规则**：对有可见本体几何的符号，`Reference` 放在本体上方、`Value` 放在下方；与符号图形及其可见文字笔画保持至少 `1_000_000 nm` 间距。几何包含所选 unit 与共享可见图形。无本体几何时沿用符号库字段位置及现有的直角旋转锚定规则。显式 `field` 覆盖位置优先于自动位置；删除覆盖即恢复自动位置。字段位置进入投影。

**两端独立实现**：视图侧用象限矩阵把符号局部坐标换到图纸坐标（`schematicProjection`），图纸侧直接读绘制指令（`extractSchematic`），两者不共用变换函数——共用就等于自己验证自己。字段覆盖坐标按符号局部坐标存储（+x 右、+y 上），变换后与绘制出的字段位置比较。落在复现性上：同一份 `view` 两次渲染字节相同（§11），反解也相同。

实现：`packages/renderer/src/schematic-extract.ts`；测试：`packages/renderer/test/schematic-roundtrip.test.ts`（四个象限 + 走线端点落在引脚上 + 字段位置与内容 + 灵敏度）与 `packages/cli/test/view-roundtrip.test.ts`（参考工程的每一页）。


### 9.4 度量（`texteda view metrics`）

A page's metrics are provided by `texteda view metrics <project-directory> <page_id> [--json]` (`packages/core/src/view/metrics.ts`). Metrics and readability checks use the same geometry (`schematicGeometry`), so a distance from a wire to a net has one answer.

| 量 | 含义 |
|---|---|
| `content` / `content_fill_ppm` | 所有图元的外接框，以及它占图幅的比例（ppm；靠近 1000000 说明画面快撑满） |
| `counts` | 实例 / 标签 / 端口 / 注释 / 走线数，以及本页没画走线的 net 数 |
| `label_min_gap_nm` / `text_min_gap_nm` | 任意两段文字的最小间隙（0 = 相接或压住）；不足两段时缺省 |
| `wire_total_nm` | 走线总长 |
| `wire_crossings` | **不同 net** 的走线互相穿越的次数（同一 net 交叉是汇合，共享端点更不算） |
| `wires_through_bodies` | 穿过非本端点的符号本体的走线条数 |
| `net_texts[].distance_nm` | 每个标签/端口到它所指 net 的距离；`-1` = 该 net 在本页没有任何走线或引脚 |

**为什么不是截图**：像素不能跨渲染比较（抗锯齿、视口、字体），一次截图要过视觉模型、说不出"差 0.2 mm"，也进不了 CI。agent 画图的循环是 `写 → check（对不对）→ view metrics（差多少）→ 改`，SVG 快照留给人的评审——判定要机器给，观感要人给。

### 9.4.1 打印页的命令（`texteda view`）

打印页作用域的命令归在一个名词底下（[ADR-0044](../docs/adr/10-process/0044-the-agent-surface-is-a-set-of-verbs.md) D6）：

| 命令 | 做什么 |
|---|---|
| `texteda view metrics <project-directory> <page_id> [--json]` | §9.4 metrics |
| `texteda view rewire <project-directory> <page_id> [--dry-run] [--json]` | Re-anchor the page's component-pin wires (see below) |
| `texteda view render <project-directory> <page_id> [--out <file>] [--json]` | Render that project page to SVG with the review app's renderer |

**`view rewire` 做什么**：走线行的端点写的是**引脚引用**，所以符号一动端点就跟着动，而折点留在原地——走线会歪（`view.wire-diagonal`）。`view rewire` 把折点重新算出来：中间的折点坐标不动，两端按引脚现在的位置重算。方向从走线自己读出来：相邻两段不能同向（同向就是一条线），所以端段的轴向由它旁边那一段决定（`packages/core/src/view/reroute.ts` 的 `rerouteWire`）。

**它不是路由器**：不搜索、不绕行、不看符号本体；内部有斜段的走线只**报冲突**（ADR-0042 D6），不重画。

---

## 10. 例子

### 10.1 正例

```
version 0.14.0
view power-detail

size [297,210]

place
  M1.C1   [20.0,30.0]  90
  M1.R1   [60.0,30.0]  0
  M1.U1   [40.0,30.0]  0

wire
  M1.GND  M1.C1.2  M1.R1.2  [25.0,35.0]  [55.0,35.0]
  M1.VDD  M1.C1.1  M1.R1.1  [25.0,25.0]  [55.0,25.0]
  M1.VDD  M1.U1.5  M1.C1.1  [35.0,25.0]

label
  M1.GND  [25.0,35.0]
  M1.VDD  [35.0,25.0]
```

### 10.2 Invalid pin drawing

```teda
version 0.14.0
view power-detail

wire
  M1.VDD  M1.U1.5  M1.C1.1
```

This page is invalid because the pin instances are not placed (`view.pin-not-placed`) and the root project model does not establish the listed pin memberships on `M1.VDD` (`view.pin-net-mismatch`). Fix the drawing by placing the instances and make its `wire` net and endpoints match the flattened project model. No PCB net declaration supplies these logical facts.

### 10.3 概览页正例

```
version 0.14.0
view main

size [297,210]

module
  M1  charger-power   [20.0,20.0]   [90.0,60.0]
  M2  buck-5v         [150.0,20.0]  [80.0,60.0]

module_port
  M1.SYS_OUT   [110.0,50.0]
  M2.SYS_IN    [150.0,50.0]

interconnect
  ic1  M1.SYS_OUT  M2.SYS_IN  [130.0,50.0]  0
```

This topology-only example intentionally has no `place` section. It is valid when the project root declares module instances `M1` and `M2`, binds both declared module ports to the same project net, and declares interconnect `ic1` with exactly these ordered endpoints. The page draws that root-declared link; it does not create a net membership or a physical path. The physical PCB assignments and any copper continuity are described separately by the PCB files.

### 10.4 自定义页尺寸正例

```
version 0.14.0
view buck-5v-detail

size [120,80]

place
  M2.U1   [30.0,20.0]  0
  M2.L1   [60.0,20.0]  0
```

This page uses its own 120 × 80 mm extent rather than A4. Coordinates lie within the page and follow the `0.5 mm` drawing lattice. A detail page may draw any subset of project components; the page ID does not establish ownership (§1.1).

### 10.5 概览页反例

```
version 0.14.0
view main

size [297,210]
sheet [297,210]

module
  M1  charger-power   [20.0,20.0]   [90.0,60.0]
```

This file is invalid because `size` and its legacy alias `sheet` are mutually exclusive (§2). The single module frame is otherwise valid: pages are advisory and need not draw every project module.

Fix it by deleting either `size` or `sheet`.

---

## 11. Canonical form

Section order is fixed: `place` → `field` → `module` → `module_port` → `interconnect` → `module_place` → `junction` → `wire` → `label` → `port` → `text`.
- Rows within a section use natural identifier order (`C2` precedes `C10`; see `teda.md` §12 rule 9).
  - `place` by `instance_id`;
  - `field` by `(instance_id, name)`;
  - `module` by `module_instance_id`;
  - `module_port` by `id`;
  - `interconnect` by `interconnect_id`;
  - `module_place` by `(module_instance_id, x, y)`;
  - `junction` by `junction_id`;
  - `wire` by `(net, from_endpoint, to_endpoint)`;
  - `label` by `(net, x, y)`;
  - `port` by `port_id`;
  - `text` by `(x, y, text)`.
- Columns align to each section's widest cell; rows longer than 80 columns are not wrapped (`wire` bends are individual `[x,y]` cells, and splitting a row would make one path appear as two; see `teda.md` §3).
- Each `wire` bend is one cell `[x,y]`; align bend cells with the first three columns.
- `place` rotation and `unit=` are separately aligned optional columns.
- `wire` bends remain in path order; their order is semantic.
- Every view is language `0.14` or later. Canonical output writes `size`; `sheet` is accepted only as a legacy input alias and is never emitted. Canonicalization does not change the file's declared language version.
- Source row order does not affect IR: the `points` array retains bend order, while other section arrays use the sort keys above.
- Defaults may be omitted (`rot` defaults to 0, `unit` to 1, and page extent to A4 landscape); IR omits default-valued fields.

`module_place` rows are ordered by `(module_instance_id, x, y)`; repeated placements of one instance are allowed and source order has no meaning. For a declared interconnect endpoint on a page using `module_place`, use the first canonical placement of its module instance to resolve that module port's drawing position; all placements are rendered and their transformed bounds are checked independently. `module_view` and `sheet_template` canonical forms are in §§12.6 and 13.5.

---

## 12. `module_view`：可复用的模块局部图

`module_view` is a reusable drawing of a module definition. It can be previewed independently or placed repeatedly on project pages. It is advisory: the module description owns every electrical fact, while the project root owns module-instance identity and project bindings ([ADR-0068](../docs/adr/09-view/0068-reusable-module-drawings-and-sheet-templates.md) D1–D2; `spec/module.md` §7.2).

### 12.1 文件与头

```
version 0.14.0
module_view buck-5v

bounds [120,80]
```

- 文件住在 `views/modules/<module_id>.module-view.teda`；类型行是 `module_view <module_id>`，`module_id` 必须等于去掉 `.module-view` 后缀的文件名（与 `view` 同一规则，§1）。
- `module_id` 的形状与模块文件里的模块 id 相同（`^[a-z][a-z0-9-]*$`）：模块图按**模块 id** 找，不按模块实例找。
- 语言 `0.13` 新增。`module_view` 的 reader 下界是 `0.13`（`spec/teda.md` §12.1）——这个类型在 `0.13` 之前不存在。

### 12.2 `bounds`：这张图自己的范围

`bounds [width,height]` 是**必填**标量（mm，一个括号元组单元格，`teda.md` §4.3）。局部原点在 `bounds` 的左上角，+x 向右、+y 向下（与页同一套坐标系，§2.1）。

- **这是模块局部的范围，不是页的图幅。** 它与页的 `size` / `sheet`（§2）是两件事：一个模块图可以在多页上以不同尺寸摆放，页的图幅由页自己（或它的模板）决定。两者的检查也是分开的：模块图的点落在自己的 `bounds` 内，摆放后的范围落在页内（§14.3）。
- 模块图的每一个画出来的点都必须落在 `bounds` 内；落在外面是错误（§9.1）。
- 坐标分辨率与晶格与页相同（`0.01 mm` 分辨率、`0.5 mm` 绘图晶格，§2.1）。

### 12.3 段与行

模块图有这些段，行语义与页相同（§4–§8）：`place`、`field`、`junction`、`wire`、`label`、`port`、`text`。没有 `module`、`module_port`、`module_place`——模块图不摆放别的模块图。

```
place
  U1    [10.0,10.0]  0
  C1    [40.0,10.0]  90

wire
  VOUT   U1.5  C1.2  [20.0,20.0]

port
  VOUT   [0.0,30.0]  180
```

**Names are module-local**, not project-page names:

| Spelling | Meaning in a module drawing |
|---|---|
| `place` `instance_id` | An internal module instance such as `U1`, without an `M<digits>.` prefix |
| `wire` / `label` net | A net declared inside the module, such as `VOUT`, without an `M<digits>.` prefix |
| `port` `port_id` | An external port declared by the module (`spec/module.md` §3) |

- A module drawing cannot declare electrical facts: it cannot add components, pins, nets, or ports. Its `place` instances, `wire` / `label` nets, and `port` IDs must all exist in the module description; the module description is authoritative (§9.1).
- Module-drawing wire endpoints use module-local spelling: pin references such as `U1.5`, module ports such as `PORT`, and junction IDs. Project-page prefixes are not used in this local namespace.
- A module port's drawing position follows the module interface and is transformed when the drawing is placed on a project page (§14.3).

### 12.4 没有电气权威

模块图**只画**，不定义。删除一张模块图，模块与板一字不变：模块文件里的一切仍然成立，ERC 仍然跑，导出的网表仍然是同一份。模块图的增删改只影响视图诊断与 `advisory_hash`（§9.3、§14.5）。

### 12.5 独立预览

模块图**可以独立预览**：不摆到任何页上也能画出来、也能查。预览用同一套渲染器与同一套视图检查（[ADR-0068](../docs/adr/09-view/0068-reusable-module-drawings-and-sheet-templates.md) Consequences）。

### 12.6 Canonical form

- 段顺序固定：`place` → `field` → `junction` → `wire` → `label` → `port` → `text`。
- 段内行按**自然序**排序（§11 的同一套规则）：`place` 按 `instance_id`，`field` 按 `(instance_id, name)`，`junction` 按 `junction_id`，`wire` 按 `(net, from_endpoint, to_endpoint)`，`label` 按 `(net, x, y)`，`port` 按 `port_id`，`text` 按 `(x, y, text)`。
- `bounds` 是唯一的标量，canonical form 把它放在第一个段之前。
- 缺省值可以不写（`rot` 缺省 0）；IR 里缺省字段一律省略。

---

## 13. `sheet_template`：静态的图纸模板

`sheet_template` 是**页面上静态的家具**：图框、标题栏、表格、矢量 logo。它只有图形与文字，没有电气，也没有任何页特有的事实（[ADR-0068](../docs/adr/09-view/0068-reusable-module-drawings-and-sheet-templates.md) D3）。

### 13.1 文件与头

```
version 0.14.0
sheet_template a4

size [297,210]
```

- 文件住在 `views/templates/<template_id>.sheet-template.teda`；类型行是 `sheet_template <template_id>`，`template_id` 必须等于去掉 `.sheet-template` 后缀的文件名，形状为 `^[a-z][a-z0-9-]*$`。
- 语言 `0.13` 新增；`sheet_template` 的 reader 下界是 `0.13`。

### 13.2 `size`：模板的范围

`size [width,height]` 是**必填**标量（mm），与页的图幅同一套写法（§2）。

- **模板的 `size` 就是用它的页的图幅**：页写了 `template` 就不再写自己的 `size` / `sheet`（§2、§14.1）。
- 模板的 `size` 与模块图的 `bounds`（§12.2）是两件事：模板的范围是**整页**的范围，模块图的范围是**一张图**的范围。

### 13.3 家具段：封闭的四个

模板只有四个段，**这是封闭集**，不多不少：`line`、`rect`、`polyline`、`text`。

| 段 | 行 | 说明 |
|---|---|---|
| `line` | `<id> [x1,y1] [x2,y2]` | 一条直线 |
| `rect` | `<id> [x1,y1] [x2,y2]` | 一个矩形，给**两个对角点**（与 `line` 同一套格子写法） |
| `polyline` | `<id> [x1,y1] [x2,y2] [x3,y3] …` | 一条折线，按顺序经过它的点；至少两个点 |
| `text` | `<id> [x,y] <text…>` | 一段静态文字 |

```
line
  RULE_TOP   [10.0,10.0]   [287.0,10.0]

rect
  TITLE_BOX  [197.0,160.0]  [287.0,200.0]

polyline
  LOGO       [12.0,180.0]  [20.0,190.0]  [28.0,180.0]

text
  TITLE      [200.0,190.0]  Charger-Buck Rev A
```

- **每一行都有一个 id**，在模板内唯一（`value.duplicate-id`）。id 的形状是 `^[A-Za-z0-9_+-]+$`。
- **每一行都按 id 起头**——`text` 也一样（`text` 段的行是 `<id> [x,y] <text…>`，id 在前）。页里的 `text` 行没有 id（§8），模板里的有：模板的每一样东西都要能被指认。
- **所有坐标与图形都必须落在模板的 `size` 之内**（§9.1）。
- 文字用渲染器的**固定视图字高**，没有字号、没有字体、没有行距这些参数。
- 折线可以画 logo，不引入外部文件，不引入运行时资源。

### 13.4 家具是字面的

A template's contents are literal: no project metadata interpolation, variables, electrical references, or page-specific facts. Text in a title block is exactly the text supplied; the template does not read a project's name, version, or date. Templates do not supply net names, reference designators, or project ports; those belong to project pages and module drawings.

### 13.5 Canonical form

- 段顺序固定：`line` → `rect` → `polyline` → `text`。
- 段内行按 `id` 排（自然序，§11 的同一套规则）。
- `size` 是唯一的标量，canonical form 把它放在第一个段之前。

---

## 14. 组合页：模板 + 模块图

A composed page can place a template and reusable module drawings. It remains one project `view` file at `views/<page_id>.view.teda` and one print page; it is not another logical page or module hierarchy ([ADR-0068](../docs/adr/09-view/0068-reusable-module-drawings-and-sheet-templates.md) D1, D4).

### 14.1 `template`：这一页画在哪个模板上

页的标量 `template <template_id>` 指向 `views/templates/<template_id>.sheet-template.teda`（§2、§13.1）。

- **模板的 `size` 就是这一页的图幅**，所以这一页不再写 `size` 或 `sheet`（§2）。
- 模板引用不到（文件不存在）是错误，不是"没有模板就算了"（§9.1）。

### 14.2 `module_place`：把模块图摆到页上

```
module_place
  M1  charger-power  [20.0,20.0]   0
  M2  buck-5v        [160.0,20.0]  90
```

列：`<module_instance_id> <module_id> [x,y] [<rot>]`。

| 列 | 说明 |
|---|---|
| `module_instance_id` | A project module-instance ID (such as `M1`), declared by the root's `modules` section |
| `module_id` | The definition bound to that project instance by the root |
| `x` `y` | Top-left corner of the placed drawing in page coordinates (mm) |
| `rot` | Clockwise right-angle rotation: `0` / `90` / `180` / `270`, default `0`; other values report `value.angle-invalid` |

- **A placement is a drawing, not a fact:** it says where the module drawing appears and never defines its contents (§4.2, §12.4).
- Repeated rows for one project module instance are valid. Each is a drawing occurrence; the root remains authoritative for project identity and electrical bindings.
- A module-port reference does not identify a repeated drawing occurrence. Resolve its position from the first canonical `module_place` row for that instance, sorted by `(module_instance_id, x, y)`; never use source row order. Render all occurrences and check each transformed bound independently.
- A page must use either `module` / `module_port` or `module_place`, not both. They are separate drawing conventions; mixing them defines no third meaning.
- A composed page may also contain page-level `place` rows for any project component instances it chooses to draw.

### 14.3 摆放变换

摆放把模块图的 `bounds` 映射到页坐标，**不缩放**。局部点 `(u,v)`、局部范围 `w × h`：

| `rot` | 局部点 → 摆放后的局部点 |
|---|---|
| `0` | `(u, v)` |
| `90` | `(h - v, u)` |
| `180` | `(w - u, h - v)` |
| `270` | `(v, w - u)` |

然后加上页位置 `[x,y]`。所以 **`[x,y]` 是变换后的 bounds 的左上角**：模块图的左上角不一定落在 `[x,y]` 上（`90` / `180` / `270` 时它落在别的角）。

- 旋转是**顺时针**的，因为页坐标 y 向下增长（§2.1）。
- **变换后的范围必须落在页内**（页的图幅，或用模板时模板的 `size`）。落在外面是错误（§9.1）。
- 摆放不改变任何电气事实：被摆进去的图仍然只是图（§14.5）。

### 14.4 页上的模块端口端点

A composed page draws a root-declared interconnect with its `interconnect` row (§4.4); it never uses a `wire` row to join module ports. Each endpoint's page position comes from the corresponding module drawing's `port` row after the `module_place` transform (§14.3). The module drawing must be placed on this page and declare the named port. These positions are advisory: neither a view nor a module drawing changes root net membership, the interconnect endpoints, PCB assignment, or copper continuity.

### 14.5 Composed pages have no electrical authority

A composed page is a drawing. Editing or deleting it affects view diagnostics and the advisory hash only; it never changes project connectivity, a PCB IR, the normative project hash, or netlist output ([ADR-0068](../docs/adr/09-view/0068-reusable-module-drawings-and-sheet-templates.md) D1; [ADR-0069](../docs/adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D4–D5).
