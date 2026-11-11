# ADR-0071: A Reusable Module Drawing Is an Editable View

Status: Accepted
Date: 2026-11-11
Scope: Decides: that a reusable module drawing is authored view source, that the review app offers the same explicit placement and source actions on it as on a print page, that the write targets the module-view file, and that one module has one drawing shared by every placement. Does not decide: per-instance or per-page drawing overrides, or editing a sheet template — a variation of a module's picture needs its own record.
Related: [ADR-0035](../09-view/0035-the-view-layer-is-a-drawing.md), [ADR-0055](../09-view/0055-schematic-fields-are-view-overrides.md), [ADR-0056](../09-view/0056-the-review-app-has-one-interaction-surface.md), [ADR-0059](../09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md), [ADR-0068](../09-view/0068-reusable-module-drawings-and-sheet-templates.md), [ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md), [ADR-0070](../03-project/0070-module-definitions-live-under-the-schematic-tree.md)
Impact: `spec/schematic-view.md`; `packages/cli/src/layout.ts`; `packages/cli/src/review.ts`; `packages/cli/src/review-model.ts`; `packages/viewer/src/app.ts`; `scripts/verify-views.ts`; `docs/guides/review-app.md`; `docs/backlog.md`

## Background

A reusable module drawing is a view artifact with its own extent: it draws one module definition
with the module's local instance, net and port identities, and a print page places it
([ADR-0068](../09-view/0068-reusable-module-drawings-and-sheet-templates.md) D1, D2). It is
advisory — it can show a module, it can never change one.

The review app lists module drawings as drawings of their own, but its write actions are gated on a
schematic **print page**: `canWriteFull()` requires `drawing().kind === "sch"`, and the layout route
carries a `page` id that resolves to `views/<page_id>.view.teda` ([ADR-0056](../09-view/0056-the-review-app-has-one-interaction-surface.md)
D1, D2). A module drawing therefore opens read-only: a person can look at it but cannot move a part,
re-anchor a wire, or drag a field.

That is an implementation boundary, not a rule. [ADR-0035](../09-view/0035-the-view-layer-is-a-drawing.md)
D3 and D4 make every view authored source: a human or an agent moves the symbols, wires and labels,
and nothing else writes them. A module drawing is a view; excluding it from the write surface makes
the module-first workflow — draw the module, then compose it on a page — text-only, and leaves the
"fine-tune a copied module" case without the tool that draws it.

## Decision

### D1. A module drawing is authored source, and the app edits it as a drawing

The interaction surface does not grow a mode. On a module drawing the app exposes the same explicit
actions it exposes on a print page:

- select a symbol and move it on the `0.5 mm` lattice;
- rotate a selected symbol by a quarter turn;
- move a `Reference` / `Value` field or remove its override;
- move a label or a module port, with the same re-anchor rules;
- open the Source panel for the module-view file.

PCB canvases, symbols and footprints remain read-only. The kind of the drawing decides which
actions are meaningful, exactly as [ADR-0056](../09-view/0056-the-review-app-has-one-interaction-surface.md)
D1 already requires.

### D2. The write targets the module-view file and the module-local namespace

A layout or source write for a module drawing resolves to
`views/modules/<module_id>.module-view.teda`, is parsed as a `module_view`, and is written in the
canonical `module_view` form. Its checks are the module drawing's own (`spec/schematic-view.md` §12):

- `place` identities, `wire` / `label` nets and `port` ids must exist in the module definition;
- the drawing cannot add a component, pin, net or port;
- every drawn coordinate stays inside the drawing's declared `bounds`.

A write never touches `design/**`, a PCB, an IR shard or a build hash. It changes the module-view
shard and the advisory hash, exactly as editing a page does.

### D3. One module, one drawing; every placement shares it

A module drawing is looked up by module id ([ADR-0068](../09-view/0068-reusable-module-drawings-and-sheet-templates.md)
D4). There is at most one drawing per module, and every `module_place` row that names the module
draws that one file. Editing it therefore changes every page and every instance that places it.

That is the reuse contract, not an accident: the same picture for the same module is what makes the
drawing reusable. The app names the edited file, so the scope of the change is visible; the drawing
is not silently forked per placement.

A per-instance or per-page variation of a module's picture is **not** part of this decision. It would
need an explicit override mechanism and its own record; copying the module to a new id to get a
different picture forks the electrical definition and is not the answer.

### D4. The write route identifies the drawing, not a page id alone

The host write request names the drawing it edits: a print page (`page`) or a module drawing
(`module`). The server resolves the target to the corresponding view file, applies the same layout
plan, and writes through the canonical formatter. A request that names neither, or both, is
rejected. Host capabilities are unchanged (`places` / `layout`); a module-drawing write is a layout
write.

### D5. The lattice gate covers module drawings too

The repository's view house-style gate checks every authored view drawing, not only files directly
under `views/`. A module drawing on the `0.5 mm` lattice is checked by the same rule as a page; the
gate reports the drawing kind and its file.

## Consequences

- The module-first workflow is usable in the app: draw the module drawing, then compose it on a page.
- A module drawing edit is visible on every page that places it. The status line and the source path
  say which file was edited; no implicit per-page copy is made.
- The CLI layout request grows a drawing target; existing page requests keep their meaning.
- The review guide's drawing table and the view skill gain the module drawing as an editable kind.
- A common "one module, one drawing" limit becomes explicit: two instances of one module cannot be
  drawn differently without a new decision.
