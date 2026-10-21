# ADR-0007: The Net Set and Its Names After Flattening (What Happens to In-Page Nets)

Status: Accepted (2026-10-20)
Date: 2026-10-20
Impact: `teda.md` §7.7; `spec/pcb.md` §5.1, §5.2; amends `docs/adr/0002-board-pages-and-bom.md` (board-level visibility of in-page nets)

## Background

- A page is a partitioning unit inside the board, and board-level nets are visible only through page `ports` (`docs/adr/0002-board-pages-and-bom.md`). As `teda.md` §7.7 originally read: **a net in a page that is not exposed by any `port` is an internal page node and does not take part in board-level nets**.
- The trial run (`docs/trial-run/charger-buck/`) ran into this gap when exporting the demo's `charger-buck` board to KiCad:
  - the `BOOT` / `PH` / `VFB` nets of the `buck-5v` page were exposed by no port → under the original wording they are not board-level nets;
  - but the pcb has to connect them (`BOOT` is the bootstrap loop of `U1.BOOT`↔`C2.1`), otherwise rules 3/4 of `spec/pcb.md` §5.2 will necessarily fail — the two pads of a `connect` are not in the same net, and the member pads of that net are not covered by any `connect` pair.
  - in other words: **"in-page nets do not take part in board-level nets" and "the pcb may only reference existing nets" are mutually unsatisfiable once combined**.
- More awkward is the name collision: the `charger-power` page and the `buck-5v` page **each have a `PH` and each have a `VFB`**, all of them in-page nets. Same name, no relation at all; flattening directly would merge them into one net and short the two pages' circuits together.
- Board-level net names and in-page net names share one namespace (`spec/pcb.md` §5.1: the key of a net is `net_id` = the net name), so the net names after flattening must be unique and must reveal which level they belong to.

## Decision

1. **The net set after flattening = the nets declared by the board root + the in-page nets of each page that the board root does not reference**. An in-page net is not "nonexistent", it is "not merged into a board-level net".
2. **Referenced page nets are merged into the board-level net and take the board-level net's name**. If the board root writes `SYS: M1.SYS_OUT M2.SYS_IN`, then both the `SYS` of page `M1` and the `SYS` of page `M2` are the `SYS` after flattening; in-page nets the board root does not write out do not sneak in.
3. **Unreferenced in-page nets stay in the flattened result, under the name `<page_instance_id>.<net>`** (e.g. `M2.BOOT`, `M1.PH`). The prefix is the page instance ID, consistent with the instance-ID namespace (`M1.R1`).
4. **Board-level net names must not contain `.`**. Otherwise a board-level name could collide with the namespace form of in-page nets, and the two could not be told apart after flattening.
5. **The pcb references the flattened net names**: `trace` / `via` / `zone` / `deviation` write names such as `M2.BOOT`; a `connect` pair may fall inside the same in-page net (it is one net after flattening, so the rule holds).
6. **Dangling port (the page declares a port, the board root does not reference it) → warning**; the corresponding net of that page keeps its in-page naming and is not merged into any board-level net.
7. **The IR semantics do not change**: the identity key of a net in the IR is still `net_id` (`AGENTS.md` §4.4); this decision only constrains the form of the surface syntax and the flattening algorithm. The flattened result (net set + names + members) is the common input of ERC, BOM and pcb binding checks.

## Rejected Alternatives

| Option | Why it was rejected |
|---|---|
| Requiring in-page net names to be unique across pages | The demo violates this itself (two pages each have a `PH` and a `VFB`); it forces authors to invent globally odd in-page names (`BUCK5V_BOOT`), which reads even worse |
| In-page nets do not enter the pcb / do not enter the flattening | The pcb cannot express in-page connections such as the bootstrap loop, so binding checks necessarily fail (see Background) |
| Referencing "page instance + port" in the pcb instead of a net name | That amounts to admitting that the port is the source of truth for connectivity, violating "connectivity is decided only by the logical model (the net)" (`AGENTS.md` §2 item 2) |
| Giving every flattened net a numeric ID and writing IDs in the pcb | The surface syntax becomes unreadable, and so do diffs; `net_id` belongs to the IR layer, the name is the surface form |

## Consequences

- Page-prefixed net names after flattening are the norm: `GND` / `SYS` / `VOUT` are board-level nets, `M2.BOOT` / `M2.PH` / `M2.VFB` / `M1.PH` are in-page nets. Which is which is visible in the name.
- The validator must implement flattening (board root + pages + port binding), and ERC, BOM and pcb binding checks share the same flattened result — this is just what `docs/adr/0002-board-pages-and-bom.md` already demanded ("one BOM, one PCB"), extended to nets.
- A wrong port reference in the board root (writing `M2.SYS_IN` when page `M2` has no such port) is still an error; a missing reference in the board root (nobody connects a page port) becomes a dangling-port warning, and the in-page net stays in the flattened result.
- Cost: net names no longer "look like" signal names in a circuit (`M2.BOOT` is more verbose than `BOOT`). That is the price of moving "name uniqueness" off the author and onto the tool.

## Follow-up

- Write conformance cases: a board whose two pages hold same-named in-page nets; after flattening, the net set, the names and the members must match this ADR.
- When the flattened result goes into the IR (`dist/ir/boards/<board_id>/schematic.json`), the correspondence between the net name field and `net_id` has to be written into `schemas/`.
