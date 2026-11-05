# ADR-0064: Automatic Fields Are Placed for the Page, Not for One Symbol

Status: Accepted
Date: 2026-11-05
Scope: Decides: that the automatic position of a schematic `Reference` or `Value` field is decided for the print page as a whole — which slot around its body a field takes when the place it wants is taken — and that the placement is a drawing fact, recomputed on every render. Does not decide: where symbols, wires, labels, ports and notes are placed ([ADR-0055](0055-schematic-fields-are-view-overrides.md) D3, [ADR-0059](0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md)); what a `field` row overrides ([ADR-0055](0055-schematic-fields-are-view-overrides.md) D4); the review app's live preview of a field's place ([ADR-0056](0056-the-review-app-has-one-interaction-surface.md)).
Related: [ADR-0035](0035-the-view-layer-is-a-drawing.md), [ADR-0036](0036-our-own-reference-renderer.md), [ADR-0055](0055-schematic-fields-are-view-overrides.md), [ADR-0059](0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md).
Impact: `spec/schematic-view.md` §4.1, §9.2; `packages/renderer/src/field-layout.ts` (new); `packages/renderer/src/schematic.ts`; `packages/renderer/src/schematic-extract.ts`; `packages/renderer/src/field-placement.ts`; `packages/core/src/view/readability.ts`; `packages/core/src/index.ts`

## Context

[ADR-0055](0055-schematic-fields-are-view-overrides.md) D3 decided the automatic position of a
field: above and below the painted body of its symbol, `1 mm` of clearance. That is a decision
about one symbol, and it was right about one symbol. A page is not one symbol.

Two parts drawn close together break it. The buck page's `M2.C3` and `M2.C4` are `6.5 mm` apart:
each one's `Reference` wants the side its symbol points at, the two wanted places face each other,
and each one's `Value` wants the other side, which is where the neighbour's body is. The renderer
drew all four texts anyway, and the reader got two pairs of words on top of each other. The
checker had nothing to say: `view.text-overlap` compared the page's own records — labels, port
tags, notes — and never looked at a field.

Two earlier records had tried to cover this from the other end. The page carried `field` rows
written by hand to dodge the collision, and a row written for one spacing goes stale the moment the
parts around it move ([ADR-0055](0055-schematic-fields-are-view-overrides.md) D4 says a row is for a
position the author *wants*). The review app's Apply rewrites places and wires but leaves a field
row where it was, so the page carried a stale anchor for a layout that no longer existed.

The rule that was missing is a rule about the *page*: the place a field wants is only good while
the page around it stays as it was.

## Decision

### D1. The place a field wants, and the place it gets

The automatic position of a field is now two things. The **place it wants** is the rule of
[ADR-0055](0055-schematic-fields-are-view-overrides.md) D3: above and below the painted body, at
`1 mm` of clearance from the painted text ink, centred on the body's horizontal bounds. The **place
it gets** is decided for the page as a whole. A field that cannot have the place it wants takes
another one; it never prints where it would cover something else.

### D2. The page places its fields together

The renderer places a page's fields together, in the order the page places its instances. Each
field keeps the place it wants while that place is free; otherwise it takes the first free slot
around its own body. The decision is the page's, not the symbol's, because the thing that
collides is a neighbour.

### D3. What makes a slot free

A slot is free when the text it would draw covers nothing that is already on the sheet: no other
field, no label, no port tag, no note, no other symbol's painted body, and no wire run. A field's
own body is not in that list — the `1 mm` clearance of D1 is the rule that governs it — and a
field a `field` row placed by hand is not moved: the page routes the automatic fields around it.

### D4. The slots around a body

The slots are a fixed list, so the same page always draws the same way. In order: the place the
field wants; the side across from the one it wanted; the two sides at right angles to it; and then
each of those three again, `2 mm` further out. A field therefore never floats more than `5 mm` from
the body it names.

### D5. The placement is a drawing fact

The placement is recomputed on every render, like the places of D1, and it is never written back
into the view file: a `field` row decides its own field and nothing else
([ADR-0055](0055-schematic-fields-are-view-overrides.md) D4). The renderer and the reverse
projection each compute the page's placement through their own local-to-sheet transform
([ADR-0055](0055-schematic-fields-are-view-overrides.md) D6) and must agree on every field's
place, or `extract(render(ir)) == ir` fails. A stored field anchor is on the `0.5 mm` lattice
([ADR-0059](0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D1); an automatic
field's drawn position is derived from the body's painted edge and is not a stored coordinate.

### D6. The checker reports what the placement could not resolve

The renderer cannot always find room. When two fields still cover each other, the drawing says so:
a field is text on the sheet, and `view.text-overlap` compares it with the page's other text, the
way it already compares a label with a note. The placement removes the collision; the check
reports the page that has none left to give.

## Consequences

- Moving a symbol can move its field: the field follows the page, not the symbol's own frame.
- A field's place is no longer a property of its symbol alone, so a page that is re-spaced draws
  differently — which is the point.
- The rule the renderer and the checker both use is one rule, stated once: the slot is free when
  the text covers nothing else, and the text is measured the way the checker measures it.
- A page with no room left is reported, not silently drawn on top of itself.
- This record amends [ADR-0055](0055-schematic-fields-are-view-overrides.md) D3, which decided the
  automatic placement for one symbol. The rest of that record — the vocabulary, the override
  precedence, the version and the contract boundary — is unchanged.

## Verification

The renderer must prove that two parts drawn close keep readable fields, that a `field` row is
never moved, that the renderer and the reverse projection agree on every field's place, and that
the checker reports a field that covers another.
