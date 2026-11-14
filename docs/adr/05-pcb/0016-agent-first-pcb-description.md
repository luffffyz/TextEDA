# ADR-0016: Agent-First PCB Description (Segment Set and Trade-offs)

Status: Accepted
Date: 2026-10-20
Scope: Decides: the segment set of a PCB description, and what the IR stores about a board. Does not decide: who produces the layout — see ADR-0017.
Related: [ADR-0014](../04-schematic/0014-connectivity-has-one-authority.md), [ADR-0017](0017-layout-and-routing-are-agent-driven.md), [ADR-0018](0018-copper-fill-uses-a-geometry-kernel.md)
Impact: `spec/pcb.md` §4; `packages/ir/src/**`

## Background

The schematic side has already completed its "hand-written format → agent first" turn: `.kicad_sch` stores the finished artifact, not the design — measured, its semantic content is a fraction of a percent of the bytes (`AGENTS.md` §13, the measurement in `docs/comparison.md`), so it can only be an export target, never the IR's reference. The PCB side has to make the same turn, but the situation differs:

- `.kicad_pcb` carries even heavier human/machine traces than `.kicad_sch`: drawing parameters, silkscreen typography, editor locks, groups, UUIDs, internal sequence numbers.
- `.kicad_pcb` contains **derivative caches**: copper pour fill results (`filled_polygon`), measurement text. Moving these into the IR creates a second source of truth.
- **The rules are not in `.kicad_pcb`**. The KiCad board file format spec states plainly that net classes have been moved out of the board file into the design rules file (project file). In other words, an agent given a `.kicad_pcb` gets no clearance/width/differential rules at all and **cannot check itself**.
- Conversely, `.kicad_pcb` holds **no intent**: why the routing is done this way, which one is the power return path, where the ground must be split, which pair must be length-matched — all of that lives in human heads.

The `teda.md` pcb draft of the time (`stackup` scalars + `place` + `route` + `physical_only`) was
unsupported on both ends: copying KiCad's structure inherits workflow noise and caches; that
version could not hold a real board either (no board outline, no vias, no copper pours, no bend
points, no rules) — `route <net> <width> <layer>` cannot even express "which two pads to connect".

## Decision

### 1. Layering criterion

Follow `AGENTS.md` §3: S1 (schematic view) and B1 (PCB preview) are free, **B0 (physical facts) is not free**. So the pcb description must **fully carry the physical facts** (stackup, coordinates, layers, vias, traces); this part cannot be omitted.

**What agent-first-ization acts on is not the amount of information but the form of the information**: what shrinks in the IR is strategy and noise, not geometry.

### 2. What the IR stores

| Category | Content |
|---|---|
| Stackup | Layer order, layer type, copper thickness, dielectric thickness and material, dielectric constant, total thickness |
| Board shape | Board outline polyline, cutouts and mounting holes inside the board |
| Placement | Instance coordinates, rotation, side |
| Binding | Instance → component → footprint; pad number ↔ sch pin number; nets reference only `net_id`, members come from sch |
| Copper | Trace polylines (net/layer/width), vias (position/size/drill/connected layers), zones (outline/net/layer) |
| Keepout | Keepout areas and their types |
| Rules | Default clearance/width/via, per-net overrides, differential pairs, length matching |
| Explicit connections | Which pads have continuous copper between them (`connect` segment) |
| Physical-only | Mounting holes, fiducials, cutouts, stitching vias and other entities that do not affect logic. A test point is **not** one of them: it is a pad on a net, so it is a one-pin device in the schematic ([ADR-0014](../04-schematic/0014-connectivity-has-one-authority.md) D8, D9) |
| Controlled deviations | `net_tie` / `split_ground` (change logical connectivity); `stitching` / `fiducial` are physical entities but likewise go into the report. The list is closed ([ADR-0014](../04-schematic/0014-connectivity-has-one-authority.md) D2) |

### 3. What the IR explicitly does not store

| `.kicad_pcb` ingredient | Why it does not go into the IR |
|---|---|
| `(page A4)` frame and `pcbplotparams` (31 drawing parameters) | Printing and "how it was drawn last time" history state, unrelated to the design |
| Font effects, position nudges, `hide`/`unlock` of silkscreen/assembly text | Typographic aesthetics, produced by a deterministic policy + manual handling on the KiCad side, not fed back |
| `autoplace_cost180`, `locked`, `group` | Editor interaction state |
| `uuid`/`tstamp`/`path`/`tedit`, net sequence numbers, historical counters in `general` | Identity and historical noise; the IR uses stable semantic IDs (`AGENTS.md` §2 item 5) |
| Copper pour fill results `filled_polygon` | Derivative cache; recomputed from outline + rules |
| Measurement text of `dimension` | Derivative quantity |
| Library metadata (`descr`/`tags`/3D model paths) | Belongs to the footprint library; the board file only references it |

### 4. Rules must go into the IR

Because KiCad moved netclasses and custom DRC rules into the project file, an agent holding only a `.kicad_pcb` cannot check itself. **The pcb description carries its own `rules` segment**; netclasses and custom rules are written back on export to KiCad.

### 5. Connectivity is declared, not reverse-extracted from geometry

`AGENTS.md` §2 item 2 forbids "treating connectivity reverse-extracted from geometry as the authoritative result". Therefore the pcb description **explicitly declares** which pads have continuous copper between them (`connect` segment), while geometry is responsible for exactly one verifiable check: "there really is copper between these two pads".

- Every pad pair in `connect` must fall within the same net in sch; otherwise it must be explicitly declared in the `deviation` segment (whitelisted type), otherwise it is an error.
- Every net member in sch must appear in at least one `connect` pair; otherwise "this net is not routed" is reported.
- Differential pairs **are not geometric objects but constraints**: traces are still described as single-net polylines, and differential/length-matching/impedance go into `rules`.

### 6. Segment set

`modules` · `stackup` · `outline` · `place` · `connect` · `trace` · `via` · `zone` · `keepout` · `rules` · `silk` · `physical_only` · `deviation`

(`modules` was added after this record: a PCB declares the project module instances it owns,
[ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D2.)

See `spec/pcb.md` for the exact syntax. Key points:

- Traces support polylines only; arc traces are approximated as polylines on import, and the **deviation is reported**.
- Copper pours store only outline + net + layer; fill parameters (clearance, thermal) go into `rules`.
- Silkscreen is a manufacturing artifact: the `silk` segment declares whether to print it, the text height and the layer; **typographic placement still does not go into the IR** and is generated by a deterministic policy ([ADR-0018](0018-copper-fill-uses-a-geometry-kernel.md) D10, `spec/pcb.md` §4.11).
- `physical_only` holds physical entities that do not affect logic (`mounting` / `fiducial` / `stitching` / `cutout`); `deviation` holds the two kinds of controlled deviations that change logical connectivity (`net_tie` / `split_ground`). Both go into the report. The `test_point` form was retired: a test point is a one-pin device ([ADR-0014](../04-schematic/0014-connectivity-has-one-authority.md) D8).
- pcb references an instance by its **flattened instance id** (`M1.R1` — the qualified refdes form, the same id space as the schematic, `spec/pcb.md` §5.1). The pcb carries no uid of its own: renaming a refdes is a source edit in both descriptions, and the identity that survives it is the instance `uid` in the schematic IR ([ADR-0010](../03-project/0010-instance-identity-is-a-uid.md)).

### 7. One-way, no write-back

Adjustments a human makes in KiCad (silkscreen positions, layer display, temporary grouping) are **not written back to the IR**. The IR is the single source of truth; KiCad is a view plus DRC / manufacturing output. For a change to take effect, the IR must be edited and re-exported. The cost is that rule changes on the KiCad side no longer take effect automatically (in exchange for "the agent can check itself").

### 8. Export target

Export target: **KiCad `.kicad_pcb`** (best DRC coverage, doubles as an entry point for 3D and continued manual editing). It is an **interoperability export and an optional backend**, not the manufacturing exit: the mandatory path writes Gerber and Excellon itself ([ADR-0021](../06-manufacturing/0021-the-manufacturing-output-path.md) D2, D10, D11), and KiCad's DRC is an optional cross-check, never a gate (invariant 20). The `.kicad_pcb` exporter is not built yet (`docs/backlog.md` F15). Circuit JSON as a manufacturing chain has been withdrawn (binds to a foreign schema, low tool maturity, no DRC).

Export is a **lossy projection**: semantics the target format cannot hold must be reported (`file:line:col: warning …`), reusing the controlled-deviation mechanism from `AGENTS.md` §4.4, never dropped silently.

> The export order on the sch side is out of scope for this ADR; see `AGENTS.md` §11 item 4.

## Consequences

- **The IR gets bigger**: geometry goes into the IR in full, an unavoidable consequence of B0 not being free; only strategy and noise shrink.
- **One more rules source of truth to maintain**: once rules live in the IR, rule changes on the KiCad side no longer take effect automatically (see decision 7).
- **Silkscreen typography is delegated to policy**: ugly silkscreen on agent-generated boards is a known cost; nudge it by hand in KiCad, but that is KiCad-side business.
- **We do not build a placement or routing solver**: the pcb description expresses B0; generation is agent-driven and checker-gated ([ADR-0017](0017-layout-and-routing-are-agent-driven.md)). KiCad / freerouting can only be optional tools, not the decision procedure.
- **The description assumes a logical root exists**: there is no pcb-only mode and no segment set for one — `AGENTS.md` §11 question 6 is answered ([ADR-0014](../04-schematic/0014-connectivity-has-one-authority.md) D5, D6). A PCB whose module instances no root owns is an error, and reverse engineering arrives as an import.

## Follow-up

- ~~Where footprint geometry comes from~~ — settled: the geometry lives in the footprint library and the board stores coordinates only ([ADR-0030](../08-libraries/0030-footprint-format-and-geometry.md), `spec/footprint.md`).
- Whether to open up arc traces and micro-vias (HDI). Traces are polylines only today (`spec/pcb.md` §4.6).
- The detailed mapping from rules to KiCad netclass / custom rules.
- The correspondence between the pcb `connect` segment and instance ids after module flattening — the page level is gone, modules are the hierarchy now ([ADR-0013](../04-schematic/0013-modules-compose-boards.md)).
- Hard pcb cases in `examples/cases/` (differential pairs, net ties, split ground) and the expected IR — `net-tie` and `diff-pair` are written; a split-ground case is not.
