# ADR-0069: One Project Logic Root, Physical PCB Implementations, and Project Views

Status: Accepted
Date: 2026-11-09
Scope: Decides: that project logic has one root schematic, that module instances map wholly to explicit PCB implementations, that cross-PCB connections are explicit interconnect facts, and that schematic views are project-wide. Does not decide: fabrication descriptions or external-system interfaces — see [ADR-0021](../06-manufacturing/0021-the-manufacturing-output-path.md) and [ADR-0009](0009-board-linking.md).
Related: [ADR-0006](../02-ir/0006-ir-shards-and-hashes.md), [ADR-0008](0008-project-tree-has-owners.md), [ADR-0009](0009-board-linking.md), [ADR-0012](../04-schematic/0012-one-flat-schematic-per-board.md), [ADR-0013](../04-schematic/0013-modules-compose-boards.md), [ADR-0015](../04-schematic/0015-flattening-and-the-net-set.md), [ADR-0029](../07-devices/0029-the-procurement-layer.md), [ADR-0035](../09-view/0035-the-view-layer-is-a-drawing.md), [ADR-0037](../09-view/0037-review-records-and-attribution.md), [ADR-0067](../09-view/0067-hierarchical-module-views-and-custom-page-size.md), [ADR-0068](../09-view/0068-reusable-module-drawings-and-sheet-templates.md), [ADR-0070](0070-module-definitions-live-under-the-schematic-tree.md), [ADR-0071](../09-view/0071-a-module-drawing-is-an-editable-view.md)
Impact: `spec/project.md`; `spec/teda.md`; `spec/module.md`; `spec/pcb.md`; `spec/schematic-view.md`; `schemas/ir/v0.19/`; `packages/parser`; `packages/core`; `packages/cli`; `packages/renderer`; `packages/exporter`; `packages/viewer`; `examples/reference-project/`; `scripts/migrate-0.14.ts`

> **Tree path (2026-11-11):** [ADR-0070](0070-module-definitions-live-under-the-schematic-tree.md) moved module definitions from `design/modules/` to `design/sch/modules/`. D1's composition rule is unchanged; only the module path moves.

## Background

A project is the complete product, but its logic is currently split into one schematic per physical board and a separate `system` file for links between boards. Each board also owns its module instances. The split makes board boundaries part of the logical source model, duplicates a net's identity between board roots and the system layer, and prevents a project-wide topology view from having one authoritative source.

The physical distinction remains real: a net in the product-level logical model is not proof of copper continuity on any PCB, and equal local net names do not connect separate boards. The project therefore needs one logical root, separately described PCBs, and explicit interconnect facts between physical implementations.

## Decision

### D1. One project-level logical root

`design/sch/main.teda` is the only logical root. It composes module descriptions from `design/modules/`; module definitions remain project-local and may be instantiated more than once. All component instances and electrical facts belong to modules. The root owns module-instance identities, project-wide net membership, project ports, constraints, and interconnects. There are no board-local schematic files, root-level component instances, or `system` descriptions.

A module instance ID is globally unique within the project. Its flattened instance and internal-net names remain `<module_instance_id>.<local_id>`. A flattened project net merges module ports listed in the root's `nets` segment. Equal local net names in separate module instances never merge by themselves.

The schematic IR remains flat for ordinary consumers, but it also carries the module-instance ownership and port-binding records needed to validate physical assignments and interconnect endpoints. Root constraints are project-wide; module constraints flatten onto their module-local or root-bound net as before.

### D2. Each module instance is implemented by exactly one PCB

A physical board is a `pcb` description at `design/pcb/<pcb_id>.teda`. Its required `modules` section explicitly lists the project module instances implemented by that PCB. Across all PCBs, each root module instance occurs exactly once. A PCB may list multiple module instances. Separate instances of one reusable module definition may be assigned to different PCBs; one instance may never be split.

Every physical placement, pad connection, trace, via, zone, and rule resolves against the assigned module instances and the flattened project nets. A PCB cannot place an instance owned by another PCB or omit its module assignment. A `connect` edge remains an explicit copper-continuity fact on that PCB only. Sharing a project `net_id` across PCBs does not create copper continuity.

### D3. Interconnects are explicit facts, separate from nets and copper

The root's `interconnects` section declares one named connection between exactly two module-port endpoints. Each endpoint is a module instance port, and both must belong to the same root project net. The endpoints must be implemented by different PCBs. A project net represented on multiple PCBs must have interconnect edges connecting all of its participating PCBs; the checker treats each PCB's validated local copper network as one vertex for this cross-board connectivity check.

An optional `interconnect_pins` section records terminal mapping for connector or cable conductors. Each row names an interconnect and one pin on each endpoint module; each pin must belong to that endpoint port's module-local net. One interconnect may have multiple pin-pair rows. If no connector/cable terminal mapping is modeled, the interconnect still explicitly declares the port-to-port path. Views may draw an interconnect only by referencing its ID; they cannot create or remove it.

These are three different facts:

1. The root's `nets` say which module ports share one logical project net.
2. The root's `interconnects` say which module ports have an explicit physical path between PCBs.
3. Each PCB's `connect` and copper geometry say which pads are continuous within that PCB.

No one of these facts is inferred from another, and net-name equality never supplies an interconnect.

### D4. Project-level views

Print pages live at `views/<page_id>.view.teda` and reference project-level module instances, flattened instances/nets, and interconnect IDs. `main` is conventionally listed first, but is neither a required page nor a required topology-overview role. Any page may draw module boxes, their ports, and interconnect links with no component placements; detail pages may place components and draw any subset of the project logic. A project may have multiple overview or detail pages; page IDs are stable references, not logical identities.

The viewer lists `main` first and the remaining page IDs in ASCII order. If any project view exists, checks report project modules and interconnects not represented on any page; these are view warnings, never logic errors. A view stores geometry and references only. It never duplicates net membership, interconnect endpoints, pin mapping, PCB assignment, or copper facts. Removing all views leaves the root logic, PCB checks, netlists, and normative hashes unchanged.

### D5. IR layout and hashes

The project schematic is one normative `project/schematic.json` shard. Physical boards remain normative `boards/<pcb_id>/pcb.json` shards, and board-scoped procurement shards remain under `boards/<pcb_id>/`. Project views are advisory `views/<page_id>.json` shards. There is no `systems/` shard. The project hash includes the logical root and all PCB implementations; advisory views affect only the advisory hash. A board hash covers that PCB's normative physical-board shards and does not imply a second logical root.

### D6. Version and migration

The language advances to `0.14.0`; the `schematic`, `pcb`, and `view` reader floors advance to `0.14` because their accepted project/board/page ownership shapes change. `system` is retired. The IR contract advances from `v0.18` to `v0.19`; `v0.18` remains immutable. The migration command is `bun run migrate:0.14 <project dir>`. It may perform deterministic file moves and transformations, but must refuse to invent module IDs, PCB assignments, or connector-pin mappings where the old sources do not determine them. The migration note lists those author decisions; there is no compatibility reader or parallel legacy model.

## Consequences

- A product has one logical netlist and one project-wide identity space, independent of its number of PCBs.
- Reusable module definitions remain reusable, but each project instance has one physical owner.
- A global net can span several PCBs only through explicit interconnect edges; each local PCB still proves its copper continuity separately.
- A topology page can show the product's module and board relationships without reproducing component-level circuitry.
- Project and board hashes now have different scopes: the project hash covers logic plus all physical implementations; each board hash covers one PCB's physical implementation.
- Existing board schematics, system files, board-scoped views, and PCB files require migration; old sources are not silently interpreted under the new model.

## Rejected alternatives

| Option | Why it was rejected |
|---|---|
| Keep one schematic per PCB and merge them in a `system` file | Retains split logical authority and prevents one project-level netlist. |
| Infer interconnects from equal net names | Names are identifiers within a declared logical model, not evidence of a physical path. |
| Infer PCB assignment from the module name or file path | Reusable definitions and several modules per PCB make this ambiguous. |
| Allow a module instance to be split across PCBs | Breaks the module-instance ownership boundary and makes local placement/binding ambiguous. |
| Let view wires create interconnects | A discardable drawing cannot own electrical or physical connectivity. |
| Put all component instances directly in `main.teda` | Removes the compositional module boundary needed for unambiguous physical ownership and reusable designs. |
