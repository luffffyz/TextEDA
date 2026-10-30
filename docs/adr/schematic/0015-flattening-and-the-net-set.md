# ADR-0015: Flattening and the Net Set

Status: Accepted
Date: 2026-10-20
Scope: Decides: that the schematic source is flat, and what happens to a net once the hierarchy is flattened. Does not decide: how a review partitions a board for reading — that is a print page, see ADR-0012.
Related: [ADR-0012](0012-one-flat-schematic-per-board.md), [ADR-0029](../devices/0029-the-procurement-layer.md)
Impact: `spec/teda.md` §7, §7.6; `spec/module.md`

## Background

A real project is **one board**, but the schematic does not fit in a single mental picture: a
charger / power path plus a 5 V buck will not fit on one page, and reviewers cannot take it all in
either. The natural move is to split the board into several "pages" (sheets).

The earlier answer to that question mixed two different things. A page was described as a
**partitioning unit inside the board**, motivated by canvas capacity and review granularity, and
the answer went on to build a whole mechanism for it: a `page` description type, a `pages`
segment, page ports, a per-page namespace, and a flattening step. That mechanism was later
withdrawn — the board has one flat schematic file, and the partition of the drawing is a print
page in the view layer (see ADR-0012).

What survived the withdrawal is a different fact, and this record owns it. **The schematic source
is flat.** A board's schematic is one file, one namespace, one set of nets. Whatever produced the
file — a human writing it in one go, a module library expanded into it, a script that assembled it
— the result the tools see is flat, and the tools have one model of a net.

Flattening is therefore not a feature of the language; it is the **absence** of a feature. The
question this record answers is what survives when the hierarchy is gone: what a net is, and what
a name means.

## Decision

### D1. A board's schematic is one flat file

A board has exactly one schematic description, at `design/sch/<board_id>.teda`, and it is flat:
one namespace of instances, one namespace of nets, no `pages` segment, no page ports, no per-page
scope. The file's header says `schematic <board_id>`.

The partition of the drawing for reading is a **print page** in the view layer, and it is a
separate description with its own file (see ADR-0012). A print page is not part of the schematic,
it does not appear in the schematic's namespace, and it never changes connectivity.

### D2. A board is one physical board: one PCB, one BOM, one set of Gerbers

The distinction that made the earlier "page" answer possible was between a **board** and a
**partition**. A board = a physical board = 1 PCB / 1 BOM / 1 set of Gerbers. A partition is a unit
of canvas and of review, and it produces no standalone PCB and no standalone BOM.

This is why "charger plus buck" is one board and not two boards wired together: two boards would
mean two BOMs and two sets of Gerbers, and inter-board net and cross-board voltage compatibility
checks would have to exist in a project that draws one board. The multi-board mechanism exists and
is reserved for genuinely multi-board products; it is not the answer to a crowded schematic.

### D3. Flattening happens before the tools see the board

A board that is composed of modules (see ADR-0013) is flattened **at the source level**, and
everything downstream — ERC, the netlist, the BOM, the exporters, the checks — works on the
flattened result. There is no hierarchical model in the IR, no hierarchical netlist, and no
hierarchical BOM.

The flattening rules are mechanical:

- an instance of a module becomes instances of the board, with their refdes prefixed by the
  module instance (`M1.R1`);
- a net inside a module becomes a board-level net whose name carries the same prefix
  (`M1.VFB`);
- a module's ports are bound one-to-one to board-level nets, and a port that is bound to nothing
  must be declared `no_connect` explicitly;
- a board-level refdes may not use the reserved `M<number>` form, because that form belongs to
  the module instances.

### D4. A net is a set of pins, and its name is its identity

After flattening, a net is what it has always been: **a named set of pin connections**. The name
is the identity, and the identity is what a reference uses.

The rule that the flattening makes necessary, and that a reader must not have to re-derive: a net
name is **unique within the board**, and a module's internal nets are carried into the board with
their module prefix, so two modules may each have a net called `VFB` without colliding. The
prefix is not decoration — it is what makes the flat name unambiguous.

### D5. The net set is the board's, and it is what the tools agree on

Because everything downstream sees the flattened board, there is exactly **one net set** for a
board, and every tool agrees on it: the ERC, the netlist exporter, the KiCad exporter, the BOM, the
review renderer, and the `texteda` checks.

The alternative — letting each tool recover a hierarchy of its own — was never attractive and
became untenable once the tools multiplied: two tools that recovered different hierarchies would
disagree about connectivity, and the disagreement would show up as a "renderer lost a net" bug
that is really a modelling bug.

### D6. A partition of the drawing is not a part of the schematic

A review may want to look at one corner of a crowded board. That is a **print page**: a file in the
view layer that places symbols and routes labels for reading. It has no authority:

- it may not add, remove or re-point a device, a pin or a net;
- it may not introduce a connection the schematic does not have;
- the connectivity of the board is read from the schematic, always.

A print page that contradicts the schematic is a bad drawing, not a different board.

## Consequences

- **The schematic has one namespace and one file.** A reader of the source never has to ask which
  page a net belongs to.
- **The IR is flat.** No tool has to reconstruct a hierarchy, and no two tools can disagree about
  one.
- **Modules are a source-level convenience, not a runtime model.** The price is that the board's
  netlist does not show the module structure; the benefit is that every tool has one job.
- **A crowded board is a view problem, not a schematic problem.** The answer is a print page, and
  the answer cannot change connectivity.
- **The BOM counts physical parts.** A partition of the drawing never splits a BOM, because a
  partition is not a board.
- **The multi-board mechanism stays reserved.** It is not the answer to a crowded schematic, and
  using it that way would invent cross-board checks this project has no business making.
