# ADR-0061: A Move Carries Only What Belonged to the Net

Status: Accepted
Date: 2026-11-04
Scope: Decides: what a placement change in the review app may move besides the symbol that was dragged — a label or a port follows its net only when it was already on that net's wiring, and a label the person placed freely stays where it was put. Does not decide: what a print page contains or how it is rendered — see [ADR-0035](0035-the-view-layer-is-a-drawing.md); the app's interaction surface — see [ADR-0056](0056-the-review-app-has-one-interaction-surface.md).
Related: [ADR-0035](0035-the-view-layer-is-a-drawing.md), [ADR-0043](0043-the-review-app-is-a-plugin-of-the-agent-workbench.md), [ADR-0056](0056-the-review-app-has-one-interaction-surface.md), [ADR-0059](0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md), [ADR-0060](../03-project/0060-a-write-keeps-the-bytes-it-replaced.md), [ADR-0062](0062-a-run-may-end-at-a-port.md).
Impact: `packages/cli/src/layout.ts`; `packages/cli/test/review-layout.test.ts`; `packages/cli/test/benchmark-apply.test.ts`; `scripts/benchmark-apply.ts`; `docs/guides/review-app.md`

## Context

A placement change in the review app is applied by recomputing the page: the geometry of every
symbol is computed, the wires whose pins moved are re-anchored, and whatever sat on the disturbed
nets is put back on them. The recomputation is what produces the new file — the app does not patch
the old one.

That recomputation had two problems, and they are not the same kind of problem.

The first was cost. Rewriting the page lexed the whole file once for **every row that changed**,
so a page with many changed rows cost a scan of the page per row. The work grew with the square of
the page instead of with the page.

The second was authority. A label or a port was put back on its net whenever that net had been
disturbed and the label was more than a micron away from the wiring. A label the reviewer had
placed **freely** — 9 mm below the bus it names, say, because that is where the text reads
clearly — was therefore picked up and carried onto the wire when some *other* symbol on that net
was moved. The reviewer had not asked for that, the original position was gone, and the report
said only `label GND`.

The code's own comment claimed the opposite: a position the person put is a decision, and a
reseat is a repair for an accident, not a preference over the author. The implementation did not
say that.

## Decision

### D1. A label or a port follows its net only when it was on that net

A label or a port that was sitting on its net's wiring **before** the move belongs to that net, and
the move carries it to the net's new wiring. A label the person placed away from the wiring is a
free placement, and a move elsewhere on the page is no reason to pick it up.

"Was on the wiring" is the same measure the reseat itself uses: within one micron of the net's
path. A label that was on the wire follows the wire; a label that was not, does not.

This holds for labels and for ports. A field override is unaffected — it is anchored to its symbol,
not to a net, and it moves with the symbol by construction.

### D2. What the recomputation writes is only what changed

The recomputation is not a redraw. It computes the new geometry to learn where the moved pin now
sits, re-anchors the wires whose pins moved **keeping their shape, their bends and their
directions**, and writes back only the rows whose contents actually changed. Every other row of the
page stays byte-identical.

A wire whose pins did not move is not touched. A wire whose pins moved keeps its segment count and
its directions; only its endpoints follow the pins.

### D3. The cost of a move grows with the page, not faster

The page is lexed once per write, not once per changed row. The work of a move is linear in the
page's size: a move on a page of four hundred rows costs a few times what it costs on a page of a
hundred, not sixteen times.

The benchmark in `scripts/benchmark-apply.ts` builds the shape that makes this visible — one net
carrying many wires and many labels, so that one move disturbs many rows — and
`packages/cli/test/benchmark-apply.test.ts` asserts the growth rate rather than an absolute time,
because a slower machine is allowed to be slower.

### D4. What the app decided for the reviewer is reported

A reseat that did happen is named in the plan's `reseated` list and shown by the app. The reviewer
sees that a port followed its net and that nothing else moved.

## Consequences

- Moving a symbol on a busy net no longer rearranges the labels a reviewer placed by hand. The
  price is that a label that *should* follow its net but was placed a little away from it stays
  where it was, until the reviewer moves it.
- A move writes fewer rows than before, so the file's diff is smaller and says more about what
  actually happened.
- The page's growth no longer makes a single move expensive. The shape that is still expensive is
  the one that changes many rows at once — a symbol on a bus with a thousand labels — and even
  then the work is a scan of the page per write, not per row.
- The reseat report is now short by design: it names what was on the wiring and followed it.
