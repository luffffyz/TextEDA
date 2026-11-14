# View — decisions

## Scope

What a person looks at: the view as an independent description and a drawing, the reference renderer, and the review record that says who looked and decided what.

## Not here

- The project-wide logical source — [ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md).

## Reading order

1. [0035](0035-the-view-layer-is-a-drawing.md) — the view is an independent description, and a drawing is not a build input.
2. [0036](0036-our-own-reference-renderer.md) — the reference renderer is ours, and its output must be verifiable.
3. [0050](0050-pin-number-placement-is-a-renderer-convention.md) — pin-number placement is a fixed renderer convention, separate from source facts and export geometry.
4. [0051](0051-pin-number-clearance-is-measured-from-painted-ink.md) — pin-line clearance is measured from the nearest painted edge, not the text anchor.
5. [0052](0052-pin-number-body-clearance-is-measured-from-symbol-body-bounds.md) — body-side clearance uses visible symbol-body bounds, with a bodyless fallback.
6. [0053](0053-pin-name-body-clearance-is-measured-from-symbol-body-bounds.md) — pin-name body clearance uses the same visible frame, with a larger inside-frame gap.
7. [0054](0054-vertical-pin-name-labels-always-rotate-toward-their-pins.md) — every vertical pin name uses a fixed `90_000` millidegree rotation, like its pin number; a visible-body one sits against the inner body edge on the pin's side.
8. [0055](0055-schematic-fields-are-view-overrides.md) — schematic `Reference` and `Value` fields are deterministic renderer defaults with per-instance local overrides.
9. [0037](0037-review-records-and-attribution.md) — a review is a record, not a description type.
10. [0042](0042-the-review-app-has-modes.md) — the historical mode and standalone write decision; its interaction-surface rule is superseded by [ADR-0056](0056-the-review-app-has-one-interaction-surface.md).
11. [0043](0043-the-review-app-is-a-plugin-of-the-agent-workbench.md) — the plugin boundary and places-only host write; its current interaction contract is superseded by [ADR-0056](0056-the-review-app-has-one-interaction-surface.md).
12. [0048](0048-the-review-app-shows-drawings.md) — the app shows drawings, not boards: print pages, board canvases, module drawings, symbols and footprints; its mode-switch rule is superseded by [ADR-0056](0056-the-review-app-has-one-interaction-surface.md).
13. [0056](0056-the-review-app-has-one-interaction-surface.md) — one interaction surface with explicit move, rotate, source and commit actions.
14. [0059](0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) — every coordinate a print page stores is anchored on the `0.5 mm` lattice; free placement is not admitted today.
15. [0061](0061-a-move-carries-only-what-belonged-to-the-net.md) — a move carries only what belonged to the net, and its cost grows with the page, not faster.
16. [0062](0062-a-run-may-end-at-a-port.md) — a run may end at a port the page draws, so a port at the board's edge is a wire end and follows the port when moved.
17. [0063](0063-a-run-is-shortened-only-along-the-lines-it-was-drawn-on.md) — a moved run keeps its drawn coordinates and loses only the corners it no longer needs, on lines it already drew.
18. [0064](0064-automatic-fields-are-placed-for-the-page.md) — the automatic place of a field is decided for the page as a whole: a field that cannot have the place it wants steps aside.
19. [0067](0067-hierarchical-module-views-and-custom-page-size.md) — a page may draw module composition or module internals, and page size names the drawing extent; the `main`-means-overview convention is superseded by [ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md).
20. [0068](0068-reusable-module-drawings-and-sheet-templates.md) — reusable module-local drawings and static page templates compose into schematic print pages; electrical facts stay in the schematic.
21. [0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) — project-level views and advisory page references.
22. [0071](0071-a-module-drawing-is-an-editable-view.md) — a module drawing is authored source, and the app edits it as a drawing.
23. [0072](0072-a-second-rendering-backend-paints-the-same-drawing.md) — the same drawing commands, painted into a picture by our own rasterizer.


## Records

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0035](0035-the-view-layer-is-a-drawing.md) | The View Layer Is an Independent Description, and the View Is a Drawing, Not a Build Input | Accepted | 2026-10-22 |
| [ADR-0036](0036-our-own-reference-renderer.md) | Our Own Reference Renderer — IR → Drawing Commands → SVG | Accepted | 2026-10-20 |
| [ADR-0037](0037-review-records-and-attribution.md) | Review Is Not a Description Type — Notes, Decisions, and the One Accountable Person | Accepted | 2026-10-22 |
| [ADR-0042](0042-the-review-app-has-modes.md) | The Review App Has Modes, and `layout` Writes Placement, Not Copper | Accepted | 2026-10-28 |
| [ADR-0043](0043-the-review-app-is-a-plugin-of-the-agent-workbench.md) | The Review App Is a Plugin of the Agent Workbench, and the Agent Owns the Source | Accepted | 2026-10-29 |
| [ADR-0048](0048-the-review-app-shows-drawings.md) | The Review App Shows Drawings, Not Boards | Accepted | 2026-10-30 |
| [ADR-0056](0056-the-review-app-has-one-interaction-surface.md) | The Review App Has One Interaction Surface | Accepted | 2026-11-03 |
| [ADR-0050](0050-pin-number-placement-is-a-renderer-convention.md) | Pin-Number Placement Is a Renderer Convention | Accepted | 2026-11-01 |
| [ADR-0051](0051-pin-number-clearance-is-measured-from-painted-ink.md) | Pin-Number Clearance Is Measured from Painted Ink | Accepted | 2026-11-01 |
| [ADR-0052](0052-pin-number-body-clearance-is-measured-from-symbol-body-bounds.md) | Pin-Number Body Clearance Is Measured from the Symbol Body Bounds | Accepted | 2026-11-01 |
| [ADR-0053](0053-pin-name-body-clearance-is-measured-from-symbol-body-bounds.md) | Pin-Name Body Clearance Is Measured from Symbol-Body Bounds | Accepted | 2026-11-01 |
| [ADR-0054](0054-vertical-pin-name-labels-always-rotate-toward-their-pins.md) | Vertical Pin-Name Labels Always Rotate Toward Their Pins | Accepted | 2026-11-01 |
| [ADR-0055](0055-schematic-fields-are-view-overrides.md) | Schematic `Reference` and `Value` Fields Are Per-Instance View Overrides | Accepted | 2026-11-01 |
| [ADR-0059](0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) | Print Page Coordinates Anchor on the 0.5 mm Lattice | Accepted | 2026-11-04 |
| [ADR-0061](0061-a-move-carries-only-what-belonged-to-the-net.md) | A Move Carries Only What Belonged to the Net | Accepted | 2026-11-04 |
| [ADR-0062](0062-a-run-may-end-at-a-port.md) | A Run May End at a Port | Accepted | 2026-11-04 |
| [ADR-0063](0063-a-run-is-shortened-only-along-the-lines-it-was-drawn-on.md) | A Run Is Shortened Only Along the Lines It Was Drawn On | Accepted | 2026-11-04 |
| [ADR-0064](0064-automatic-fields-are-placed-for-the-page.md) | Automatic Fields Are Placed for the Page, Not for One Symbol | Accepted | 2026-11-05 |
| [ADR-0068](0068-reusable-module-drawings-and-sheet-templates.md) | Reusable Module Drawings and Sheet Templates | Accepted | 2026-11-08 |
| [ADR-0067](0067-hierarchical-module-views-and-custom-page-size.md) | Hierarchical Module Views and a Custom Page Size | Accepted | 2026-11-08 |
| [ADR-0069](../03-project/0069-project-level-logical-root-and-physical-board-mapping.md) | One Project Logic Root, Physical PCB Implementations, and Project Views | Accepted | 2026-11-09 |
| [ADR-0071](0071-a-module-drawing-is-an-editable-view.md) | A Reusable Module Drawing Is an Editable View | Accepted | 2026-11-11 |
| [ADR-0072](0072-a-second-rendering-backend-paints-the-same-drawing.md) | A Second Rendering Backend Paints the Same Drawing | Accepted | 2026-11-13 |
