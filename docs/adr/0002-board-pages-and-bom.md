# ADR-0002: Intra-Board Pages (Sheet Partitioning), Flattening and BOM Counting

Status: Accepted
Date: 2026-10-20
Impact: `teda.md` §2, §7.6, §7.7, §11, §12, §13, §14; `AGENTS.md` §2, §4.1, §9, §11; `examples/reference-project/`

**Amendment (2026-10-21, [ADR-0025](0025-flat-board-and-print-pages.md))**: the page *mechanism* —
the `page` description type, the `pages` section, page ports, the per-page namespace and the
flattening (decisions 2 to 6) — is **withdrawn**: a board has one flat schematic file, and the
partition of the drawing is a print page in the view layer. What survives unchanged is decision 1
(**one board = one PCB = one BOM**, and a partition is not a board) and decision 7 (**BOM counting**:
the aggregation key is (`component_id`, parameters, variant status), and the quantity is the physical
count of the board's parts). The reasons for the withdrawal are in [ADR-0025](0025-flat-board-and-print-pages.md).

## Background

A real project is **one board**, but the schematic does not fit on a single page: a BQ24610 charger / power path plus a TPS5430 5V buck will not fit on one page, and reviewers cannot take it all in either. The natural move is to split the board into several "pages" (page / sheet).

[ADR-0001](0001-board-linking.md) treats charger and buck as two boards wired together with a `system` file — that reads the problem wrong:

- A board = **physical board** = 1 PCB / 1 BOM / 1 set of Gerbers. charger + buck are the same board.
- A page = a **partitioning unit inside the board**, motivated by canvas capacity and review granularity, **not by reuse**. Two pages on the same board share one BOM.

So three things have to be settled:

1. how pages are expressed (file form, ports, how they attach to board-level nets);
2. the naming scope inside a page versus at board level (refdes necessarily collides);
3. how the BOM is counted (does page partitioning make the BOM wrong).

## Decision

1. **Hierarchy**: board = physical board; page = partitioning unit inside the board. A page produces no standalone PCB and no standalone BOM.

2. **A page is a new description type** `page`: file `design/sch/<board_id>/<page_id>.teda`, header `page <page_id>`. The board root `design/sch/<board_id>.teda` is still a `schematic`. The `design/sch/` directory therefore holds two kinds, told apart by hierarchy: `design/sch/<id>.teda` is a board root, `design/sch/<id>/<page>.teda` is a page of that board.

3. **The board root declares its pages with a `pages` segment**:

   ```
   pages
     M1  charger-power
     M2  buck-5v
   ```

   Columns: `<page_instance_id> <page_id>`. By convention `page_id` resolves to `design/sch/<board_id>/<page_id>.teda` — the same resolution convention as `component_id` → `assets/components/**/<id>.teda` and `board_id` → `design/sch/<id>.teda`; path literals never appear in the spec. `page_instance_id` is an instance name that is unique inside the board (named like a refdes); board-level nets use it to reference page ports.

4. **There is only one port-binding mechanism**, the container differs:

   - A page uses a `ports` segment to expose its in-page nets as ports; a board-root net line references a page port with `M1.SYS_OUT`.
   - The board root uses a `ports` segment to expose its board-level nets as an external interface; a `system` file net line references a board port with `<board_id>.<port_id>`.

   In other words: **page → board → system**, three levels, each using the same "port → net" syntax. The port is the only cross-boundary mechanism; in-page net names and intra-board net names never cross a boundary.

5. **Namespaces**:

   - A refdes only has to be unique **within its page**; board-root instances are unique within the board root. Display names may repeat across pages.
   - Stable id: in-page instance = `<page_instance_id>.<refdes>`, board-root instance = `<refdes>`. PCB placement, variants and BOM traceability all use the stable id.
   - `page_instance_id` and board-root refdes share the board-level namespace and must not collide.
   - On flattening export (netlist, pick-and-place, BOM) refdes are renumbered to be unique board-wide (KiCad-style automatic annotation); the page membership is recorded in a comment.

6. **Flattening**: board = board-root instances + each page instantiated once. ERC and BOM both run on the flattened result. In-page nets must reach the board level through ports; every page port referenced by a board-level net must resolve.

7. **BOM counting**:

   - A BOM row = (`component_id`, parameter dictionary, variant status); the **aggregation key contains neither refdes nor stable id**.
   - Quantity = the physical count after flattening. A page instantiated once contributes 1 of each of its parts; identical refdes of the same part number in different pages merge into one row, with the quantities added.
   - Rows for generic passives (no `mpn`) are parameter rows (e.g. `10k ±1% 0402`), not part-number rows.

   Conclusion: **reusing the same annotation does not make the BOM a mess**; what makes the BOM a mess is refdes collisions, and that is solved by the stable id and by renumbering during flattening.

8. **Variant scope** (closing `AGENTS.md` §11 Q8): a variant only overrides "fitted or not fitted / fitted with what", and **does not change connectivity** (already defined in `AGENTS.md` §4.1). Therefore:

   - DNP / not-fitted parts still appear in the netlist and in the flattened result; they simply do not enter the BOM or the pick-and-place list;
   - when a variant references a `component_id` it applies to **all instances** of that part number; when it references a stable id it applies to that instance only;
   - variants do not affect ERC results.

## Rejected Alternatives

| Option | Why it was rejected |
|---|---|
| Keeping charger / buck as two boards connected by `system` | It does not match the real hardware: it creates the illusion of "two BOMs, two sets of Gerbers", and inter-board net and cross-board voltage compatibility checks have no business in this project |
| Reinterpreting board as "module" | A board must correspond to a physical board (BOM, Gerber, assembly), otherwise "one BOM" — per board or per project — has no clear answer |
| Pages using implicit global net names (KiCad global label style) | Implicit coupling: renaming a net on a page silently affects other places, and the diff stays unclean. Explicit ports show who is connected to whom |
| Aggregating the BOM by refdes | Once refdes may repeat across pages, aggregation by refdes necessarily merges wrongly; refdes is a display name and must not carry identity |
| Expressing pages through the generic `module` reuse mechanism | A page is a partition, not a reuse; calling it "reuse" invites authors to treat the board as a module. For now only one instantiation per page is supported |

## Consequences

- One board = one BOM, one PCB; a page is only a canvas and review unit, and the "two boards put together" illusion is gone.
- Duplicate refdes across pages is legal; tools use the stable id internally and renumber on export.
- The `system` (inter-board) mechanism stays reserved for genuinely multi-board products (P4); this project does not need it.
- Cost: one more description type, one more `pages` segment, one more set of flattening rules.

## Follow-up (out of scope for this ADR)

- Instantiating the same page several times on one board (multi-channel front ends, etc.): this needs page parameters and port mapping, i.e. the module mechanism of `AGENTS.md` §5.3, to be discussed in v0.4.
- Page-level variant overrides, cross-board BOM rollup, hierarchical presentation of sub-components.
