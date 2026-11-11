# ADR-0068: Reusable Module Drawings and Sheet Templates

Status: Accepted
Date: 2026-11-08
Scope: Decides: reusable module-local drawings, static sheet templates, and their composition into schematic print pages. Does not decide: electrical module semantics, page-as-logic hierarchy, or PCB views.
Related: [ADR-0002](../01-language/0002-one-language-version-number.md), [ADR-0035](0035-the-view-layer-is-a-drawing.md), [ADR-0067](0067-hierarchical-module-views-and-custom-page-size.md), [ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md), [ADR-0071](0071-a-module-drawing-is-an-editable-view.md)
Impact: Adds the `module_view` and `sheet_template` description types, extends schematic views, and adds advisory IR shards.
> **Current page scope (2026-11-09):** [ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D4 makes composed schematic pages project-wide. The module-view and template paths remain unchanged; a page is now `views/<page_id>.view.teda`, and its placements and references resolve against the project root's logical IDs, not a board-local schematic or board-local namespace.


## Context

The project root composes electrical modules, while schematic views can draw page-sized topology overviews or detail pages. The current view format has no reusable module-local drawing with its own extent, no reusable page furniture, and no composition operation that draws multiple module definitions on one page. Consequently, module geometry and page furniture have to be duplicated in composed pages. That duplication is view-only, but it makes reuse and independent preview awkward.

The electrical module and project root remain the only authority for component, net, and port facts. A drawing can show those facts; a template can add static artwork. Neither may add electrical facts or change connectivity.

## Decisions

### D1. Module drawings, templates, and pages are separate view artifacts

- A reusable module drawing is `views/modules/<module_id>.module-view.teda`, headed by `module_view <module_id>`.
- A reusable sheet template is `views/templates/<template_id>.sheet-template.teda`, headed by `sheet_template <template_id>`.
- A composed page is `views/<page_id>.view.teda`. It references a template and places module drawings; it is not a new logical page or module hierarchy.
- All three artifact kinds are advisory. Their IR shards are `normative: false`; edits or removal may affect view diagnostics and `advisory_hash`, but never schematic connectivity, physical PCB IR, or netlist output.

These decisions qualify [ADR-0067](0067-hierarchical-module-views-and-custom-page-size.md) D1: page IDs do not determine whether a page is a module overview or detail. The existing `main` overview convention remains available. They supersede D8's “No new kind of drawing” only for the module-local drawing and static page-template kinds defined here; no electrical drawing or page-as-logic type is introduced.

### D2. A module drawing has independent local bounds

A module drawing uses the module definition's local instance, net, and port identities. Its header is followed by `bounds [width,height]`; the local origin is the top-left corner, and the positive axes point right and down. Its drawable sections are `place`, `field`, `junction`, `wire`, `label`, `port`, and `text`, with the same row semantics as a schematic view. Component IDs and net IDs are local to the module definition; a port ID names an existing module interface port. Coordinates and extents use the existing view coordinate units and lattice.

The bounds belong to this module drawing, not to a composed page. Module-local geometry must fit those bounds. A module drawing can be previewed independently. It has no electrical authority: wires and labels are checked against the module's existing nets and ports, and the drawing cannot declare a component, pin, net, or port.

### D3. Templates contain only static vector furniture

A sheet template declares `size [width,height]` and static `line`, `rect`, `polyline`, and `text` rows. Every row has a unique ID; all coordinates and geometry must fit the template size. Text uses the renderer's fixed view-text height. Polylines can describe logos without external files or runtime assets. Furniture is literal: no project metadata interpolation, variables, electrical references, or page-specific facts.

### D4. A page composes templates and module drawings explicitly

A schematic view may declare `template <template_id>` and a `module_place` section. Each `module_place` row names a project-level module instance from `design/sch/main.teda`, a page position `[x,y]`, and a clockwise right-angle rotation (`0`, `90`, `180`, or `270`). The placed module definition is obtained from the root; its reusable drawing is looked up by that module ID. The same drawing may be placed multiple times and on multiple pages.

Placement maps the module drawing bounds into page coordinates without scaling. For local bounds `w × h`, rotation maps a local point `(u,v)` to `(u,v)` at `0°`, `(h-v,u)` at `90°`, `(w-u,h-v)` at `180°`, or `(v,w-u)` at `270°`; the page position `[x,y]` is then added. Thus `[x,y]` is the top-left of the transformed bounds. Rotations are clockwise because view coordinates increase downward. The transformed module bounds must fit the page bounds.

A module port used as a page wire endpoint is written `<module_instance_id>.<port_id>`. Its page coordinate comes from the referenced module drawing's `port` row and the placement transform. Its electrical net comes only from that module instance's project-root port binding. The page wire must use that same project net. A page cannot use a module port endpoint unless that module is placed and the local port is drawn. Page-level `place` rows remain available for project-level component IDs. Legacy `module` and `module_port` rows remain valid for existing pages but cannot be mixed with `module_place` on one page.

When `template` is present, its size supplies the page extent; the page cannot separately declare `sheet`. Without a template, existing page-size behavior remains unchanged.

### D5. IR and versioning

The language version advances to `0.13.0`, and the IR contract advances to `v0.18`, as an additive change under [ADR-0002](../01-language/0002-one-language-version-number.md) D5. The prior contract at `v0.17` remains immutable. The new contract adds `ModuleView` and `SheetTemplate` schemas, and optional `template` and `module_place` fields to `SchematicView`.
The version values in this historical decision record describe the 0.13/0.18 introduction of these reusable drawing kinds. The current language and IR versions are governed by [ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) D6.

The shard paths are `module-views/<module_id>.json` and `sheet-templates/<template_id>.json`, both advisory. Project page shards are `views/<page_id>.json`. Module drawings, templates, and pages affect neither normative project/PCB hashes nor derived netlist content.

## Consequences

- Module-local drawing bounds and whole-page bounds are independently checkable and independently renderable.
- A page can reuse one module drawing at multiple transformed placements, while inter-module links remain explicit project-level view references to root-declared interconnect IDs.
- Title blocks, tables, and vector logos can be shared without introducing external assets or dynamic fields.
- Module drawings and templates must be loaded and validated alongside project views; standalone module preview must use the same renderer and view checks.
- Removing view artifacts can make views or exports fail their view checks, but cannot change electrical semantics or the normative IR.

## Required diagnostics

Use registered diagnostics for unresolved template/module-view references, invalid module port endpoints or net bindings, and geometry outside module, template, or transformed page bounds. Messages must identify the source location and the relevant artifact or placement; follow the repository diagnostic-code policy rather than silently ignoring an unresolved reference.
