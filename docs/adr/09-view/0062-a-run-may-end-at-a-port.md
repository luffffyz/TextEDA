# ADR-0062: A Run May End at a Port

Status: Accepted
Date: 2026-11-04
Scope: Decides: what the two end columns of a `wire` row may name — a board-level pin reference, or a port the page itself draws, whose point comes from the page's `port` row — and therefore what "the wire follows the port" means when a port is moved. Does not decide: what a port symbol is or how it is drawn — see [ADR-0035](0035-the-view-layer-is-a-drawing.md); what a move carries besides the symbol that was dragged — see [ADR-0061](0061-a-move-carries-only-what-belonged-to-the-net.md).
Related: [ADR-0003](../01-language/0003-diagnostic-error-codes.md), [ADR-0035](0035-the-view-layer-is-a-drawing.md), [ADR-0042](0042-the-review-app-has-modes.md), [ADR-0056](0056-the-review-app-has-one-interaction-surface.md), [ADR-0059](0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md), [ADR-0061](0061-a-move-carries-only-what-belonged-to-the-net.md), [ADR-0063](0063-a-run-is-shortened-only-along-the-lines-it-was-drawn-on.md).
Impact: `schemas/ir/v0.15/schematic-view.schema.json`; `packages/parser/src/view.ts`; `packages/renderer/src/schematic.ts`; `packages/core/src/view/{geometry,checks,readability,metrics}.ts`; `packages/cli/src/{layout,view}.ts`; `packages/ir/src/diagnostics/codes.ts`; `spec/schematic-view.md`; `packages/core/test/reroute.test.ts`; `packages/cli/test/review-layout.test.ts`

## Context

A `wire` row names the net it draws and two ends. Until now both ends had to be **pin references**
(`U1.5`, `M1.U1.5`), because a pin is where a run can be known to start: its connection point comes
from the symbol, and the view only says which pin it is.

That worked while every run ran from pin to pin. It stops working at the board's edge. A port
(`spec/teda.md` §7.5) names a net for the outside world; the page draws it as a symbol whose
**anchor sits wherever the person put it**. When this record was written, the reference project's
`GND` port sat at `(120, 121)`, in the middle of the bus that ran from `117.5` to `139` — not at
either end of it. The `VOUT_5V` port was 9.19 mm away from the nearest `VOUT` run.

So a port is not an end of a run. It is a symbol the person places **near** one. Three things
followed from that, and the third is the reason for this record:

1. Moving a port did not touch any wire. The port moved, the copper stayed, and the drawing ended
   up with the port symbol sitting away from the net it names (`view.port-not-on-net`).
2. The reviewer had no way to say "this run ends at the board's edge". The run always ended at a
   pin, so a page showing only part of a net had to end at whatever pin the page happened to draw.
3. The only repair available was to **move the port back onto the wire**, which contradicts what
   the person asked for: they dragged the port because that is where the connector goes.

The review app's existing answer — "move the port row, recompute the page" — could not express
either "the port is the end" or "the wire follows the port". Neither could any geometry trick:
snapping the port back is the behaviour the person rejected, and moving a pin is not available
(a port is not a pin, and the board would have to grow one).

## Decision

### D1. A run's end is a pin reference or a port the page draws

The two end columns of a `wire` row accept either:

- a **pin reference** in numbered form (`U1.5`, `M1.U1.5`) — its point comes from the symbol, as
  before; or
- a **port id** (`GND`, `VOUT_5V`) — its point comes from the page's own `port` row.

The two spaces cannot collide, so the kind is read off the string: a pin reference always contains
a dot, a port id never does (`spec/teda.md` §4.2, §7.5). No new syntax, no new column, no prefix.

The column names stay `from_pin` / `to_pin`. A wire has always started at a pin and the schema is
the contract third parties write against; renaming the column would be a breaking change that buys
nothing, since the column means "the end of this run" in both cases. The schema says so, and the
field's type is the union.

### D2. The port's point is the page's own row, not the board's declaration

A port row lives in the page (`port` section), so a page can place the same port where it reads
best on that page. A run ending at that port ends at **that page's** point. Two pages may place the
same port in different places; neither defines where the port "is".

This is the same rule the `port` section already followed for drawing: the page places the symbol,
the board names the net.

### D3. A run that ends at a port this page does not draw is an error

The end point comes from the page's `port` row. With no row there is no point, so the run cannot be
drawn. That is `view.port-not-drawn`, severity `error` — not a warning and not a silently dropped
end, because a wire with an unresolved end is not a drawing that can be checked.

The code is new (`view` domain) and frozen once emitted ([ADR-0003](../01-language/0003-diagnostic-error-codes.md)).
It is raised at parse time, where the page knows which ports it draws.

### D4. A move of a drawn port re-anchors the runs that end at it

This is the behaviour the person asked for when they dragged the port: the run **extends or
shortens** to reach the port's new position, keeping its shape where the shape can be kept.

The re-anchor is the same one a moved pin goes through ([ADR-0042](0042-the-review-app-has-modes.md),
[ADR-0061](0061-a-move-carries-only-what-belonged-to-the-net.md)); the only difference is where the
end's old and new positions come from. Port coordinates are in the page, so a port move does not go
through the symbol-move path, but it must still go through the re-anchor path — a page with a run
ending at the port is not a page whose rows can be rewritten independently.

A port move on a page where **no run ends at that port** keeps the cheaper path: moving the row is
all that changes. Only a port that is actually a run's end disturbs the wires.

### D5. The ends of a run are reported by the same cross-check, split by kind

The board-side cross-check (`view.pin-net-mismatch`) applies to **pin** ends: a pin named as an end
must be a member of the net the run names. A port end is not a member of the net's member list — a
port names a net, it does not appear in it — so it is not checked that way. The port's own row is
checked against the board (`ref.unknown-port`, `view.port-not-on-net`), and the parser checks that
the run ends at a port the page draws.

The alternative — treating a port end as a net member — would make the net's member set depend on
how many pages draw the port. A drawing must not change what the net contains.

### D6. `wirePath` resolves both kinds, and the caller supplies the ports

`wirePath` is the one place the geometry asks "where is this end". It resolves a pin reference
through the symbol map it already receives, and a port id through a map the caller passes. The
callers that check a page (`checks`, `readability`, `metrics`) have the view in hand, so they build
that map from `view.port` and pass it.

The optional third parameter is deliberate: a caller that checks a page whose runs do not end at
ports is not forced to build a map, and a caller that forgets a run ending at a port gets no point —
which the parser has already reported as `view.port-not-drawn` rather than as a silent zero.

## Consequences

- A page can show a run to the board's edge. That is the shape most printed pages actually have,
  and it was not expressible before.
- Moving a port now moves a wire. The reviewer gets what they dragged for, and
  `view.port-not-on-net` stops firing on pages where the port is a run's end.
- The schema's two end columns widen. Third-party implementations that emit only pin references
  still validate; implementations that read a page must now accept a bare name at an end.
- A new error code exists and is frozen (`view.port-not-drawn`).
- The re-anchor path now also runs for a port-only move. The cost guard from
  [ADR-0061](0061-a-move-carries-only-what-belonged-to-the-net.md) D3 still holds: the work is
  linear in the page, because a port move scans the runs once.

## Alternatives considered

**Keep pins only, and require the page to add a pin at the port.** The board would grow a test
point or a connector pin for every port, which changes the circuit to suit the drawing. Rejected.

**Position the port by deriving its point from the net's wiring (snap it on).** That is the old
behaviour: it moves the port back, which is exactly what the reviewer said is wrong. Rejected.

**Allow a prefix on either end (`port:GND` / `pin:U1.5`).** One more token in the language for a
distinction a dot already makes, and a second spelling of every pin reference. Rejected as
needless syntax (`AGENTS.md` §5.2 rule 2: one EBNF, one meaning; the dot is the meaning).

**Treat the port end as a member of the net.** Makes the net's contents depend on drawings, so a
page could change what the net is. Rejected — that is the one thing a drawing may not do
(`AGENTS.md` §2 invariant 2).
