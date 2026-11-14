# ADR-0055: Schematic `Reference` and `Value` Fields Are Per-Instance View Overrides

Status: Accepted
Date: 2026-11-01
Scope: Decides: that schematic `Reference` and `Value` field positions are view-layer overrides in symbol-local coordinates, that the renderer supplies deterministic defaults for fields without overrides, and that only `Reference` and `Value` are in the closed field vocabulary. Does not decide: automatic placement of symbols, wires, labels, ports, or any other drawing object.
Related: [ADR-0002](../01-language/0002-one-language-version-number.md), [ADR-0035](0035-the-view-layer-is-a-drawing.md), [ADR-0036](0036-our-own-reference-renderer.md), [ADR-0064](0064-automatic-fields-are-placed-for-the-page.md), [ADR-0065](../01-language/0065-a-coordinate-tuple-is-one-cell.md), [ADR-0071](0071-a-module-drawing-is-an-editable-view.md)
Impact: `spec/schematic-view.md`; language version `0.10.0`; IR contract `v0.15`; `schemas/ir/v0.15/`; `packages/parser`; `packages/renderer`; `packages/cli`; `packages/viewer`

## Background

A schematic symbol has two visible fields whose identity and text come from the logical instance: its
reference and its value. The existing library symbol supplies a useful placeholder position, but a
library position is shared by every instance and cannot express the readable placement needed by one
page. Treating a moved field as free text would lose the relationship between the field and its
symbol: moving or rotating the symbol would leave the field behind.

The logical schematic must remain unchanged. Field positions are drawing facts, so they belong in the
view layer. The view also needs a useful result when a page has no field row, but a broad automatic
layout engine would make symbol, wire and label placement nondeterministic and would remove the
human-controlled drawing source.

## Decision

### D1. Field identity and text stay in the schematic

The only field names are `Reference` and `Value`. The `Reference` text is the schematic instance id.
The `Value` text is the instance value; when the instance has no value, the renderer uses the
existing library value placeholder. A view does not restate either text or any electrical fact.

### D2. The view stores local overrides, not absolute field positions

A `field` section contains three columns:

```teda
field
  U1  Reference  [0.00, 2.00]
  U1  Value     [-0.50, -2.00]
```

The columns are `<instance_id> <name> <offset>`, where the offset is one coordinate tuple
([ADR-0065](../01-language/0065-a-coordinate-tuple-is-one-cell.md)). Its values are millimetres on
the view's `0.01 mm` resolution and are relative to the symbol origin. Field-local `+x` points
right and field-local `+y` points up. The sheet uses `+x` right and `+y` down; the renderer
applies the symbol's right-angle rotation when projecting local coordinates to the sheet.

A row is an override for exactly one `(instance_id, name)` pair. The field vocabulary is closed:
unknown names are errors, and duplicate pairs are errors. A field instance must be present in the
page's `place` section. Local coordinates are not checked against sheet bounds.

### D3. Automatic placement is narrow and deterministic

When an override is absent, the renderer places `Reference` above and `Value` below the selected
symbol unit using the visible painted body geometry and a fixed clearance. Shared visible symbol
geometry is considered; the library's field position is the fallback for a bodyless symbol. The
algorithm is pure, deterministic, and independent of the filesystem. It never places symbols,
wires, labels, ports, or other text.

### D4. Override precedence, movement, rotation and removal

A matching view row takes precedence over the automatic position. Because the stored coordinate is
symbol-local, moving a symbol changes the sheet position of its field without changing the row;
right-angle rotation uses the same local frame and preserves attachment. Removing the row means
automatic placement is restored. There are no tombstones and no explicit `automatic` rows.

### D5. Version and contract boundary

The `field` section was introduced by language version `0.10.0`, in the additive IR contract
`v0.15`, whose optional closed `field` array the view contract still carries. The view reader's
floor has since moved with the language: a view file now declares language `0.14` or later whatever
it contains, so a view written before the field section existed is refused at its version line
before its body is parsed. An old file is not migrated merely because the tool supports a newer
language; the floor is what the current project shape needs.

### D6. Projection and source ownership

The renderer and reverse projection each implement their own local-to-sheet transform. Rendering and
semantic projection must agree on the field result without importing one another's transform helpers.
The field rows are included in the semantic projection and source maps. Field-only editing does not
repair wires, labels, ports or any other layout object.

## Consequences

- Field overrides move with their symbol and do not modify schematic logic or shared symbol-library
  geometry.
- The parser, canonical formatter, IR schema, renderer, CLI layout surface and viewer must preserve
  the distinction between automatic fields and authored overrides.
- A missing field row is meaningful: it selects the deterministic default. No compatibility alias or
  tombstone is needed.
- The field vocabulary can be extended only by a later language decision and versioned contract
  change.
- A page without a view still has no drawing; this decision does not create global symbol layout.

## Verification

The implementation must prove parser gating, canonical field ordering, comment-preserving edits,
manual precedence, automatic bodyful and bodyless placement, right-angle attachment, independent
semantic projection, and viewer persistence through apply, revert, reload and override removal.
