# ADR-0067: Hierarchical Module Views and a Custom Page Size

Status: Accepted
Date: 2026-11-08
Scope: Decides: that a print page draws module boundaries in new `module` and `module_port` sections and that its wires may end on a module port, that language `0.12` introduces the canonical page-size scalar `size [width,height]` with `sheet` kept as a parse-compatible legacy alias, and that the new view fields ship as IR contract `v0.17`. The overview/detail split this record started from is superseded by [ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md): a page id names a file, not a role. Does not decide: module nesting, module parameters or a cross-project module library — see [ADR-0013](../04-schematic/0013-modules-compose-boards.md) D8 and `spec/module.md` §10.
Related: [ADR-0002](../01-language/0002-one-language-version-number.md), [ADR-0012](../04-schematic/0012-one-flat-schematic-per-board.md), [ADR-0013](../04-schematic/0013-modules-compose-boards.md), [ADR-0035](0035-the-view-layer-is-a-drawing.md), [ADR-0036](0036-our-own-reference-renderer.md), [ADR-0059](0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md), [ADR-0062](0062-a-run-may-end-at-a-port.md), [ADR-0065](../01-language/0065-a-coordinate-tuple-is-one-cell.md), [ADR-0066](../02-ir/0066-symbol-and-footprint-shards-record-source-language-version.md), [ADR-0068](0068-reusable-module-drawings-and-sheet-templates.md), [ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md)
Impact: `spec/schematic-view.md`; `schemas/ir/<version>/schematic-view.schema.json`; `packages/parser/src/view.ts`; `packages/renderer/src/schematic.ts`; `scripts/migrate-0.11.ts`

> **Project scope (2026-11-09):** [ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) supersedes this record's board-scoped wording: print pages are project-wide (`views/<page_id>.view.teda`), they draw the project root's composition, and `main` is only the conventional first-listed page ID, not a required page or topology-overview role. Any page may draw interconnect links and omit component placements; modules and interconnects that no page represents are view warnings, never logic errors ([ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D4). The `size`/`sheet` page-size decision and the drawing-only renderer rule remain current; the `view` reader floor and the IR contract have since advanced to `0.14` and `v0.19` ([ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D6).

## Background

**A design of modules has no picture.** [ADR-0013](../04-schematic/0013-modules-compose-boards.md)
made the module layer real: module files own their instances, their nets and their ports, and a
composing root binds each module port to a net — today the project-level root file
`design/sch/main.teda`, with project nets
([ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D1). The
IR is flat on purpose (ADR-0013 D4). The drawing layer, however, drew **components only** — every
print page was a set of `place` rows — so the one view that would show what the design is *made
of* could not be written: the language had no way to say "this rectangle is module `M1`", and no
way for a wire to end on a module port. A reader had to read the composing root's `modules`
section and reconstruct the composition in their head, which is exactly the work the drawing is
supposed to have done.

**The page's size is named after the paper.** The `sheet` scalar carries the page's dimensions,
and the IR field is `SchematicView.sheet`. The name names the **paper** the drawing is printed
on; what the scalar actually declares is the **extent of the drawing**. Those come apart as soon
as the pages stop being one sheet each: a project with a dozen module instances wants a big
overview sheet, and a detail page of one small circuit wants a `120 x 80 mm` crop instead of an
A4 sheet that is 90 % white. The renderer, the bounds check (`view.out-of-sheet`), the page
metrics and the SVG viewBox all need the **page's own** extent, and today they get it under a
name that says "paper".

**The key is also the wrong word for the shape.** [ADR-0065](../01-language/0065-a-coordinate-tuple-is-one-cell.md)
made every geometric tuple one bracketed cell and named that form: a **size** is `[w,h]`. The
view's page-size scalar is a size, and the language now has one word for that shape — the scalar
should carry that word.

**The wire endpoint vocabulary has three kinds and only two.** A wire endpoint may be a pin, a
page port, or a junction ([ADR-0062](0062-a-run-may-end-at-a-port.md)). On an overview the
interesting endpoint is a **module port** — `M1.VOUT` — and it is not a pin: it is the module's
interface, bound to a project net by the composing root
([ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D1).

**The IR contract is closed.** Adding optional arrays to the view shard changes the contract, so
it needs a contract version of its own; [ADR-0066](../02-ir/0066-symbol-and-footprint-shards-record-source-language-version.md)
sets the precedent — an additive change is published as a new contract version and the previous
one is kept unchanged.

## Decision

### D1. The legacy `main` overview convention

Page ids name files; they do not determine a page's role. The existing `main` page remains a
supported overview convention, while other ids have commonly been used for detail pages.

| Convention | Page id | File | What it draws |
|---|---|---|---|
| Legacy overview | `main` | `views/main.view.teda` | module-instance boxes and wires between exposed ports |
| Common detail | any other id | `views/<page_id>.view.teda` | components placed with ordinary `place` identities |

- **One file per page.** The page id names the file; it is not a logical boundary or role
  selector. Pages are project-wide (`views/<page_id>.view.teda`);
  [ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D4
  removed the board directory.
- A page's role follows its content and references, not its id. New reusable compositions are
  defined by [ADR-0068](0068-reusable-module-drawings-and-sheet-templates.md).
- The overview is a **page-size and readability target**, not a new logical connectivity rule:
  everything it draws is already true in the project's logic — the root file, the module files and
  the interconnects ([ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D1, D3, D4).

### D2. Detail pages mix and split freely

A detail page may place components of several modules at once, and may split one module across
several pages. A page id that happens to name a module (`buck-5v.view.teda`) says nothing about
ownership.

### D3. The overview's source syntax: `module`, `module_port`, module-port wire endpoints

Two new sections, available from language `0.12`:

```
module
  M1  charger-power   [20.0,20.0]   [90.0,60.0]
  M2  buck-5v         [150.0,20.0]  [80.0,60.0]

module_port
  M1.SYS_OUT   [110.0,50.0]
  M2.SYS_IN    [150.0,50.0]

wire
  SYS   M1.SYS_OUT   M2.SYS_IN
```

- A `module` row is `<module_instance_id> <module_id> [x,y] [w,h]`: the instance, the module it
  instantiates, the box's upper-left corner, and the box's own size.
- A `module_port` row is `<module_instance_id>.<port_id> [x,y]`: where a module port is drawn.
- A `wire` endpoint may name a **module port** (`M1.PORT`) in addition to a pin, a page port and
  a junction. On the overview, a wire between two module ports draws the project net that joins
  them.

### D4. Box and port geometry is drawing-only

- A box carries **its own position and size**, distinct from the page size: the page size is the
  page's extent (D6), the box size is the module's drawn extent. The page is not sized by the
  boxes, and the boxes are not sized by the page.
- A box's boundary **is** the module boundary: nothing of that module is drawn outside the box on
  that page, and the box contains nothing that is not part of the module.
- Box and port positions say **where a boundary is drawn**, never what is inside it. They carry no
  electrical meaning, they are not part of the logic, and they never enter the IR's logical layer.
- All view geometry stays on the `0.5 mm` lattice and inside the explicit or default page bounds
  ([ADR-0059](0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md)).

### D5. Electrical authority stays in the schematic layer

| Fact | Owner |
|---|---|
| Which module instances the project has | the root file `design/sch/main.teda`, `modules` section |
| Which project net a module port is bound to | the root file, `nets` section |
| Which PCB implements a module instance | the PCB file, `modules` section ([ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D2) |
| A module's instances, internal nets, constraints | the module file |
| A module's exposed ports | the module file, `ports` section |

Therefore the overview may not invent, move or re-bind anything:

- An overview `module_port` must name a port the referenced module **actually declares**, and that
  port must be bound to the project net its wire claims. A missing or stale port, or a port bound
  to a different net, is an error — a drawing cannot invent, move or re-bind a port.
- An unknown instance (a box for an instance the project does not have) is an error, and drawing
  one instance twice is a drawing defect: the overview is the picture of the composition, so a
  wrong box is a wrong drawing. A module instance that no page represents is a view warning,
  never a logic error
  ([ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D4) —
  the picture may be incomplete without the logic becoming wrong.
- An overview wire may **not cross a module box** except at its own module-port endpoints.
- A disagreement between the overview and the project logic is reported **in favour of the logic**
  (`AGENTS.md` §2, rule 2). Deleting every print page leaves the project complete — the root
  logic, the PCB checks and the netlists are unchanged
  ([ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D4).

### D6. Language `0.12`: the page's own size, with `sheet` kept as an alias

- Language **`0.12`** introduces the canonical page-size scalar **`size [width,height]`** in
  millimetres — the bracketed cell is the language-wide tuple form
  ([ADR-0065](../01-language/0065-a-coordinate-tuple-is-one-cell.md) D1).
- The old **`sheet [width,height]`** scalar remains a **parse-compatible alias** for the same page
  dimensions. A `0.12` file may write either; a file that carries **both** keys is an error —
  they are two spellings of one fact, and the language has no reason to pick between them.
- **Canonical output follows the file's own language version**: a `0.11` page formats back to
  `sheet`, a `0.12` page formats to `size`. Formatting an old page therefore never migrates it
  behind the author's back, and a `0.11` page never comes back carrying syntax its own version
  does not have.
- An **omitted size remains exactly A4 landscape** (297 × 210 mm). Renaming the key does not move
  the default.
- The `view` **reader floor stayed `0.11`** when this record was accepted: the change was
  additive, so every file that was valid stayed valid, and the `0.12` constructs (`size`,
  `module`, `module_port`, module-port wire endpoints) are accepted only in a file that declares
  `0.12` or later. [ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D6
  advances the `view` reader floor to `0.14` with the project-ownership shapes; old board-scoped
  pages are migrated explicitly (`bun run migrate:0.14`), never silently interpreted.

### D7. IR contract `v0.17`

- The new IR contract is **`v0.17`**; **`v0.16` is preserved unchanged**
  ([ADR-0066](../02-ir/0066-symbol-and-footprint-shards-record-source-language-version.md)).
- `SchematicView.sheet` remains **`{width_nm, height_nm}`** — the IR keeps its name for API
  stability. The rename is a source-language fact, not an IR fact: `size` and `sheet` describe
  the same dimensions in the IR.
- `SchematicView` gains two **optional** arrays:
  - `module`: `{instance_id, module_id, x_nm, y_nm, width_nm, height_nm}`;
  - `module_port`: `{id, x_nm, y_nm}`.
- The wire endpoint schema admits **`M1.PORT`** next to pins and plain ids.
- The new fields stay **absent when unused** — omitted, never `null`
  ([ADR-0005](../02-ir/0005-ir-representation.md)).

### D8. What this version does not have

- **No change to the electrical layer.** This record touches no electrical file — today the root
  file `design/sch/main.teda` and the module files
  ([ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D1) —
  and the IR stays flat (ADR-0013 D4): the overview adds no hierarchy to the IR.
- **No new kind of electrical drawing or page-as-logic hierarchy.** The view stays a drawing layer
  ([ADR-0035](0035-the-view-layer-is-a-drawing.md)) and the renderer stays ours
  ([ADR-0036](0036-our-own-reference-renderer.md)). Reusable module-local drawings and static sheet
  templates are later view artifacts defined by [ADR-0068](0068-reusable-module-drawings-and-sheet-templates.md); they do not change this electrical boundary. A view
  draws an interconnect only by referencing its ID and can never create or remove one
  ([ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D3).

## Consequences

- **A project's composition becomes drawable.** `main` shows the module instances and the project
  nets — and, since [ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md), the interconnect links — that join them; the detail pages
  show what is inside them. The picture of the product is a picture of the product, not a picture
  of a flat list of parts.
- **A page can be the size the drawing needs.** The overview of a wide board can be one large
  sheet; a small detail page can be a `120 x 80 mm` crop. Parser, canonical formatter, IR,
  renderer, metrics, review app, lattice checks and SVG output all read the same page extent.
- **Old pages keep working.** A `0.11` page parses under the reader floors this record set, its
  canonical form still says `sheet`, an omitted size is still exactly A4 landscape, and no page
  silently changes size. [ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D6 later advances the reader floors to
  `0.14` and migrates old pages explicitly.
- **The overview cannot become a second source of truth.** Every check it needs is a check
  *against* the project logic: the port exists, the port is bound to the net the wire claims, and
  no wire crosses a box it does not belong to; a module or interconnect that no page represents is
  a view warning ([ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D4).
- **The IR contract moves to `v0.17`**, with two optional arrays and one more endpoint kind. The
  new fields are absent when unused, so a page without modules serializes exactly as before.
- **New checks are new diagnostics.** The overview rules use the codes listed in
  [`spec/schematic-view.md`](../../../spec/schematic-view.md) §9.1; the registry and checks are
  implemented.

## Alternatives rejected

- **Put the composition into the schematic file.** The root file already has it (the `modules`
  section). A second copy in a page would be a second truth, and the drawing layer is explicitly
  outside the build — hand-written, tracked, and discardable
  ([ADR-0035](0035-the-view-layer-is-a-drawing.md) D4).
- **Let the page bind a module port to a net** (a `module_port` row that names the net as well).
  Then the drawing decides what is connected, and a page could disagree with the root file in a
  way that reads as authoritative. Rejected: the page *draws* the root's binding; the root owns it.
- **Size the module boxes from the page** (fit the boxes to the sheet). Then a box's size says
  nothing about the module and the drawing becomes a layout the renderer invents — which is the
  one thing the renderer does not do ([ADR-0035](0035-the-view-layer-is-a-drawing.md) D6).
  Rejected: the box carries its own size.
- **Rename `sheet` and drop the old key.** A file that was valid would stop being valid, for a
  name only. Rejected: `sheet` stays as an alias, and the rename is not worth a migration.
- **Rename the IR field to `size` too.** The IR field name is an API; renaming it breaks
  consumers for no gain, and the IR records a page's extent, not a piece of paper. Rejected:
  `SchematicView.sheet` stays.
- **Make the overview a separate description type** (`overview`). A second file type means a
  second parser, a second shard and a second contract for what is a page with two extra
  sections. Rejected: one page type, two roles.

## Implementation status

This record decides the design. The parser, the IR contract, the renderer, the checks and the
reference pages are implemented.
