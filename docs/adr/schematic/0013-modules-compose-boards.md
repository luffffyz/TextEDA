# ADR-0013: A Board Is Composed of Modules; the IR Stays Flat

Status: Accepted
Date: 2026-10-22
Scope: Decides: that a board composes modules, that a module file holds the electrical truth, and that the IR stays flat. Does not decide: module parameters, nesting and a cross-project module library — see `spec/module.md` §10.
Related: [ADR-0001](../language/0001-fact-layer-has-no-expressions.md), [ADR-0008](../project/0008-project-tree-has-owners.md), [ADR-0010](../project/0010-instance-identity-is-a-uid.md), [ADR-0012](0012-one-flat-schematic-per-board.md), [ADR-0040](../process/0040-process-entities-outside-the-language.md)
Impact: `spec/module.md`; `packages/parser/src/module.ts`; `spec/teda.md` §7.6

## Background

[ADR-0012](0012-one-flat-schematic-per-board.md) removed the `page` description type and left one
flat schematic file per board. That was the right call for the *drawing* partition: a page was a
canvas unit, and putting it in the logic gave the board a second namespace and a duplicated net
declaration (a page port plus a board-root row) for every net that crossed a page boundary.

What the flat board removed along with it was the source partition itself. The reference project's
`charger-buck` board is a BQ24610 charge/power path and a TPS5430 5 V buck — two circuits, 61
parts, two power trees. Flattened into one file they collide: the buck's parts were renumbered
(`C1..C4` became `C19..C22`, `U1` became `U2`) and its nets were prefixed (`BUCK_PH`, `BUCK_VFB`)
purely to keep one namespace. The file is a list, and a list of 61 parts with two power trees in it
is not reviewable in one sitting.

A **module** is a different thing from a page. A page was a drawing unit and was discardable: its
nets were an implementation detail, re-exported to the board root through ports. A module is a
hierarchy level: it holds electrical truth, it has a port interface, and deleting it deletes a
part of the circuit. The old page mechanism already had the right *shape* (instances, nets, ports
per file, a board root that referenced the ports); what it lacked was a reason to exist that was
independent of the canvas.

That reason is now given: the module is the unit of *composition*. A board composes modules; the
modules hold the truth; the drawing is a separate concern that may group several modules onto one
sheet. [ADR-0012](0012-one-flat-schematic-per-board.md) decision 4 already moved the partition to
the view layer, so the module layer does not compete with the print page — they answer different
questions.

## Decision

### 1. The board composes modules; the module holds the electrical truth

A board is a `schematic` file plus a set of `module` files. The board's `modules` section lists
the module instances; each module file holds that module's instances, nets, ports and
constraints. The board's own `instances` section still exists, for parts that belong to no module
(a board-level indicator, a connector), and those use plain refdes.

One level only: a module cannot contain a module. A board may compose as many modules as it
likes — dozens is unremarkable.

### 2. The module body is a file, named by its id

`design/modules/<module_id>.teda`, with `module_id` taken from the file name, like `component_id`
(`AGENTS.md` §4.5). The board's `modules` section references it by id. Modules are project-local
for now; a module library across projects is a later decision (`docs/backlog.md` F10).

### 3. The binding is a member of a board-level net

The board's `nets` section accepts two kinds of member: a pin of a board-level instance
(`R1.2`), and a **port of a module instance** (`M2.VOUT`). A port reference merges the module's
internal net into the board-level net: the board-level net's name and members win.

One port, one board net. A port that no board net references is an error unless the module
declares it as `no_connect`. A port is an interface name and need not match the name of the net
behind it (`SYS_IN` in front of an internal `SYS`).

### 4. The IR stays flat

The board-level IR is the flattened result: one instance list, one net list, no module structure.
An instance of module `M1` is `M1.R1`; a module-internal net is `M1.VCC`; a net that a port
merged into a board net keeps the board net's name. The IR contract therefore does **not** change
— `common.pin_ref` already accepts one qualification level (`M2.L2.2`) — and third-party
implementations keep reading one flat list, exactly as they do today.

The module structure lives in the source only, as [ADR-0012](0012-one-flat-schematic-per-board.md)
decision 2 requires for the board level.

### 5. The `M` tag, and what it reserves

A module instance id is `M` plus digits (`M1`, `M2`), continuing
[ADR-0012](0012-one-flat-schematic-per-board.md): the tag reaches the silkscreen, so one
character. A board-level refdes may **not** take the form `M<digits>`, because `M2.VOUT` in a
net row must mean "module M2's port VOUT" and not "instance M2's pin VOUT".

### 6. The drawing is still the view layer's job

A print page (`views/<board_id>/<page_id>.view.teda`; formerly `views/<board_id>/<page_id>.view.teda`, see [ADR-0035](../view/0035-the-view-layer-is-a-drawing.md)) references board-level ids, which after
flattening are the qualified ones (`M1.U1`). A page may draw several modules, or part of one.
Pages do not affect the IR: they are the drawing, and the drawing is discardable
([ADR-0035](../view/0035-the-view-layer-is-a-drawing.md)).

### 7. Language 0.8, IR contract 0.2

A new description type and a new section are an additive change: the language moves to `0.8`
([ADR-0002](../language/0002-one-language-version-number.md)), and files that use neither keep their `0.7`. The IR
contract stays at `0.2` — the flattened shape is what it already was.

### 8. What this version does not have

- **No parameters.** A module instance cannot override values; two instances of one module are
  electrically identical. Literal substitution stays available for later
  ([ADR-0012](0012-one-flat-schematic-per-board.md) and `docs/backlog.md` F13 constraint 3), but
  the reference project has no case for it, and a mechanism without a case is a guess.
- **No nesting.**
- **No cross-project module library.**

## Consequences

- **The reference board reads as what it is**: a charger and a buck, each a module with its own
  refdes and net names, composed by `charger-buck.teda`. The renumbering (`C1..C4` → `C19..C22`)
  and the `BUCK_` net prefixes disappear — they were symptoms of the flat namespace, not facts
  about the circuit.
- **The source is chunked again, by logic rather than by canvas.** A review chunk is a module;
  a print page is a sheet. They are not the same thing and no longer have to agree.
- **Two namespaces exist in the source** (board level and module level), as they did before 0.7.
  The difference is that the module namespace is a *hierarchy* with an interface, and the board
  names it in one place: the `modules` section.
- **The price**: the board file must state, for every module port that carries a signal, which
  board net it lands on. That is one row per interface, and it is the price of a board that can
  be read as a composition.
- **The IR contract does not move.** Consumers of the IR — the renderer, the BOM, the netlist
  exporter, the ERC — see one flat board, with qualified ids. They need no change beyond
  accepting the qualified names they already accept.
- **Print pages gain the ability to mix modules**, which is what the drawing of a real board
  needs: a sheet that shows a module and the board-level parts around it.

## Alternatives Rejected

- **Keep the flat board, and chunk the source some other way** (a generator, a script that
  concatenates files). A generator puts the truth outside the language, and the language's own
  review story depends on the truth being in the source. Rejected.
- **Put the module structure in the IR.** It would let a review UI group by module, which is
  tempting. But it makes every IR consumer — renderer, BOM, netlist, ERC, and every third-party
  implementation — implement the hierarchy, the flattening and the port resolution, and it forces
  an IR contract version for a source-level convenience. The flat IR already carries the level in
  the name (`M1.R1`), which is enough for the tools that matter. Rejected for now; the door is
  not closed.
- **Keep the pre-0.7 page mechanism** (pages in the source, print pages in the view). That was
  tried: a page is discardable, so it cannot hold electrical truth, and a discardable holder of
  truth is a trap. The module is the same shape with the opposite contract — it is not
  discardable, and it is not about the canvas. Rejected.
- **Inline the module bodies in the board file.** One file, no cross-file references, no id
  resolution. But a 61-part board in one file is the problem this record exists to fix, and
  inlining does not scale to the twenty-module boards this decision is meant to serve. Rejected.
