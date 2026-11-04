# ADR-0056: The Review App Has One Interaction Surface

Status: Accepted
Date: 2026-11-03
Scope: Decides: that the review app has one interaction surface rather than review/layout/edit modes; that selection, movement, rotation, source editing, host capabilities, and commit/cancel semantics are explicit actions on the current drawing; that a completed move keeps its object selected; that the keyboard hint is resident; and that PCB drawings remain read-only. Does not decide: what a view description contains or how it is rendered — see [ADR-0035](0035-the-view-layer-is-a-drawing.md) and [ADR-0036](0036-our-own-reference-renderer.md); how PCB placement and routing are produced — see [ADR-0017](../05-pcb/0017-layout-and-routing-are-agent-driven.md).
Related: [ADR-0042](0042-the-review-app-has-modes.md), [ADR-0043](0043-the-review-app-is-a-plugin-of-the-agent-workbench.md), [ADR-0048](0048-the-review-app-shows-drawings.md), [ADR-0057](../08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md), [ADR-0059](0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md), [ADR-0060](../03-project/0060-a-write-keeps-the-bytes-it-replaced.md), [ADR-0061](0061-a-move-carries-only-what-belonged-to-the-net.md)
Impact: `packages/viewer/**`; `packages/cli/src/review.ts`; `packages/cli/src/review-model.ts`; `packages/cli/src/layout.ts`; `plugins/dsh-texteda/**`; `docs/guides/review-app.md`; `docs/backlog.md` (F34)

## Context

The app grew three interaction modes around one drawing: `review` for inspection, `layout` for
placement, and `edit` for source text. The modes duplicated the same drawing, selection, hover, and
navigation surface while making the meaning of a pointer gesture depend on a mode switch. The PCB
was later made a drawing of its own, and schematic field overrides added another view-only edit.

The useful boundary is not a mode. It is the action being requested and the capability granted by
the host. Selection is inspection; movement and rotation are explicit pending view edits; source
text is an explicit standalone-panel edit; and a PCB drawing has no write action.

## Decision

### D1. One surface; actions are explicit

The app has no `review`, `layout`, or `edit` mode state, mode bar, or mode-only interaction path.
The current drawing determines which actions are meaningful:

- All drawings support hover, selection, definition menus, same-kind arrow navigation, zoom, and
  pan. A schematic drawing click selects without opening a file or moving an object.
- On a schematic print page, selecting a symbol and pressing `m` starts a local move transaction.
  The pointer then previews the move on the sheet; the preview uses the existing `snapPlacement()`
  `0.5 mm` grid ([ADR-0057](../08-libraries/0057-symbol-pins-sit-on-a-half-millimetre-lattice.md)). A left-click completes that transaction locally. It does not write a file.
- With a full host capability, a selected schematic field can use the same explicit `m` action.
  Field movement is a view override, not a logical-device edit.
- Pressing `r` on a selected schematic symbol queues one clockwise 90-degree rotation. The queued
  rotation remains pending after the click or `Escape` that clears the selection.
- A normal drag pans. It becomes a move only after `m` starts a transaction; a selection click never
  moves a symbol by accident.
- `Enter` or a double-click opens the definition menu. A drawing click never jumps the source
  cursor. Source navigation and source editing are separate actions in the standalone Source panel.
- PCB drawings are read-only. PCB clicks may pick and highlight a net, but cannot place, rotate, or
  edit board objects.

### D2. Move cancellation and commit are transaction-based

A move transaction records only the selected symbol or field's original view state. `Escape` while
that transaction is active restores that transaction and leaves unrelated pending edits intact.
`Escape` without an active move closes an open definition menu or clears the selection. A click or
`Escape` following a queued rotation clears the selection without removing the queued rotation.

Placement, rotation, and field changes remain in local pending state until `Apply` or `Ctrl+Enter`.
The host then writes only the affected view file through the canonical CLI path. The browser never
writes files directly, and no action in this app changes `design/**`, IR shards, or build hashes.

### D3. Host capability is the write boundary

The viewer capability is intentionally small:

```ts
{ write: "places" | "layout" }
```

An absent capability is the standalone/full capability. `write: "places"` permits placement rows
only. `write: "layout"` additionally permits schematic field overrides/removals and standalone
Source-panel writes. A places-only host rejects `fields`, `remove_fields`, and source text payloads;
it does not silently ignore unsupported keys. DSH uses `{ write: "places" }`.

The `/api/layout` and `/api/source` routes remain host routes. The viewer requests a plan or commit;
the CLI or plugin host validates and writes through the existing canonical paths.

### D4. The drawing kinds remain independent

The app continues to show print pages, PCB canvases, symbols, and footprints as drawings of one
surface. This decision changes interaction semantics, not ownership: the print page remains an
independent view description, the PCB remains a physical description, and the renderer remains
read-only.

### D5. A completed move keeps its object selected

The click that completes a move transaction leaves the moved object selected. A placement is often
a second nudge rather than a second selection, so clearing the selection would make the second nudge
impossible: `m` would have no target, and the sheet would show no selection at all.

The selection a move leaves behind is the object it moved, not whatever the pointer happened to land
on. The status line names it, so the reviewer can see what a further `m` would move.

### D6. The keyboard hint is resident

The sheet's top-left corner carries the keys that answer in the current state, in rounded boxes. The
hint is up from the start rather than summoned by a key: a reader who does not know that a key
exists cannot ask for the list that would tell them, and a hint that appears only for a moment is
missed. `?` folds the hint away for the moments when it covers the sheet, and brings it back.

The list is derived from the state every time it is painted, so a resident hint does not become a
stale one: it names the keys that answer *now* — while a move is in flight only the two keys that
end it, a field with no override no `Backspace`, a host that may not write no `M`, and a PCB drawing
neither `M` nor `R`.

## Consequences

- There is one keyboard and pointer contract to document and test; no mode-switch state can drift
  from the drawing that is on screen.
- A person must ask explicitly for a move (`m`) or rotation (`r`), so selecting a symbol remains
  non-mutating and pan remains the default drag.
- `Apply` is the only commit point for pending view edits. `Escape` is local cancellation, not a
  blanket revert.
- Standalone hosts can edit view source only through the explicit Source panel and full capability.
  DSH can place symbols but cannot edit fields or source.
- The review app still does not solve layout or routing. PCB edits remain in the agent/CLI workflow.
- The hint covers the sheet's top-left corner while it is up. It never takes a pointer, so it cannot
  shadow a hotspot there, and `?` folds it away when the corner matters.
