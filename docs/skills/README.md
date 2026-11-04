# Skills

Operating manuals for agents. Each file is a **procedure**: the commands to run, the output to
expect, and the diagnostic code to read when it fails. The normative rules are not repeated here —
they live in [`spec/`](../../spec/) and in the [ADRs](../adr/README.md). A skill says *how to do the
job*; the spec says *what is true*.

Read the one file that matches the job. They do not overlap, and none of them depends on another.

| Skill | Use it when the job is | Reads |
|---|---|---|
| [`new-project.md`](new-project.md) | Building a project from zero: `init`, the library, the devices, the schematic, the procurement layer, the netlist | [`spec/teda.md`](../../spec/teda.md), [`spec/project.md`](../../spec/project.md) |
| [`library-authoring.md`](library-authoring.md) | Writing or reviewing `assets/**`: components, symbols, footprints | [`spec/symbol.md`](../../spec/symbol.md), [`spec/footprint.md`](../../spec/footprint.md) |
| [`preview-symbols.md`](preview-symbols.md) | Looking at a rendered symbol or footprint and changing its drawn geometry | [`spec/symbol.md`](../../spec/symbol.md), [`spec/footprint.md`](../../spec/footprint.md) |
| [`draw-print-page.md`](draw-print-page.md) | Producing a `views/**` page for the first time: placement, wiring, labels and ports | [`spec/schematic-view.md`](../../spec/schematic-view.md) |
| [`repair-print-page.md`](repair-print-page.md) | Repairing a `views/**` page that already exists: a `view.*` finding, a wandering run, a misplaced dot | [`spec/schematic-view.md`](../../spec/schematic-view.md) |
| [`add-diagnostic-code.md`](add-diagnostic-code.md) | Adding a diagnostic code: the registry, the emitter, the spec tables, the generated docs, the tests | [`spec/teda.md`](../../spec/teda.md), [`spec/schematic-view.md`](../../spec/schematic-view.md) |
| [`verify-review-app.md`](verify-review-app.md) | Proving a review-app change in a real browser: drag, move, rotate, Apply | [`docs/guides/review-app.md`](../guides/review-app.md) |

## Which one, when several seem to fit

- **A new board from nothing** → `new-project.md` first. When it reaches the library
  ([`new-project.md`](new-project.md) §3), it hands off to `library-authoring.md` for the authoring
  rules; the two do not repeat each other.
- **A file under `assets/`** → `library-authoring.md`. It is the only place that carries the
  lattice and pitch rules.
- **A symbol's drawing looks wrong** — a blunt tip, a pin on the wrong side, an upside-down
  name → `preview-symbols.md`. The render is the only evidence; `library-authoring.md` says how
  to write the asset, this one says how to look at it and change it.
- **A file under `views/`** → `draw-print-page.md` to produce it, `repair-print-page.md` once it
  exists and something is wrong with it. `draw-print-page.md` carries the `view.*` code → repair
  table; `repair-print-page.md` carries the diagnosis: how to read the real geometry, how the
  junction dots are derived, how to measure a run against its Manhattan minimum.
- **A project that already exists and needs a new board** → `new-project.md` §2–§6 for the new
  board's files, `library-authoring.md` for anything new under `assets/`.
- **A new diagnostic code** → `add-diagnostic-code.md`. It is the only place that carries the
  registry → emitter → spec → generate → test order, and the geometry-shape rule for the
  readability findings.
- **The review app's behaviour changed** → `verify-review-app.md`. Unit tests do not cover a drag
  or an `Apply`; this one drives the real browser and checks the file that was written.

## What is not a skill

- **`spec/`** — the rules. A skill points at them; it does not restate them.
- **`docs/guides/`** — the background a job needs but that is not a procedure: the review app's
  bindings ([`review-app.md`](../guides/review-app.md)), the library trust model
  ([`library-import.md`](../guides/library-import.md)), the renumbering rules
  ([`renumbering.md`](../guides/renumbering.md)).
- **`docs/adr/`** — why a rule is what it is. Cite the number; do not paraphrase the reasoning.
