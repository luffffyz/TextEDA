# View — decisions

## Scope

What a person looks at: the view as an independent description and a drawing, the reference renderer, and the review record that says who looked and decided what.

## Not here

- The schematic the view draws — [ADR-0111](../schematic/0111-one-flat-schematic-per-board.md).
- The manufacturing output path — [ADR-0120](../manufacturing/0120-the-manufacturing-output-path.md).

## Reading order

1. [0134](0134-the-view-layer-is-a-drawing.md) — the view is an independent description, and a drawing is not a build input.
2. [0135](0135-our-own-reference-renderer.md) — the reference renderer is ours, and its output must be verifiable.
3. [0136](0136-review-records-and-attribution.md) — a review is a record, not a description type.
4. [0141](0141-the-review-app-has-four-modes.md) — the review app has four modes, and `layout` writes placement, not copper.
5. [0142](0142-the-review-app-is-a-plugin-of-the-agent-workbench.md) — the review app becomes a plugin of the agent workbench, and the agent owns the source (it narrows 0141's write, and the app keeps its modes for now).

## Records

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0134](0134-the-view-layer-is-a-drawing.md) | The View Layer Is an Independent Description, and the View Is a Drawing, Not a Build Input | Accepted | 2026-10-22 |
| [ADR-0135](0135-our-own-reference-renderer.md) | Our Own Reference Renderer — IR → Drawing Commands → SVG | Accepted | 2026-10-20 |
| [ADR-0136](0136-review-records-and-attribution.md) | Review Is Not a Description Type — Notes, Decisions, and the One Accountable Person | Accepted | 2026-10-22 |
| [ADR-0141](0141-the-review-app-has-four-modes.md) | The Review App Has Four Modes, and `layout` Writes Placement, Not Copper | Accepted | 2026-10-28 |
| [ADR-0142](0142-the-review-app-is-a-plugin-of-the-agent-workbench.md) | The Review App Is a Plugin of the Agent Workbench, and the Agent Owns the Source | Accepted | 2026-10-29 |
