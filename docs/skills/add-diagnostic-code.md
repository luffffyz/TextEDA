# Skill: Add a Diagnostic Code

> **Audience**: agents and engineers adding a diagnostic code to TextEDA — a new syntax error, a
> new contract violation, a new `view.*` readability finding.
> **Scope**: the registry, the emitter, the spec tables, the generated docs, the tests.
> **Authority**: [spec/teda.md](../../spec/teda.md) §10 (units and electrical types),
> [spec/schematic-view.md](../../spec/schematic-view.md) §9.2 (the warning table),
> [ADR-0003](../adr/01-language/0003-diagnostic-error-codes.md) (the code registry).

Index: [`docs/skills/README.md`](README.md) lists the procedures and when to read which.

## 0. What this skill is for

One new code, end to end, without leaving a hole: the registry entry, the place that emits it,
the spec rows, the regenerated docs, the tests, and the gates.

The registry is the source of truth: **a code is registered when it is emitted, and a code is
frozen once emitted** ([ADR-0003](../adr/01-language/0003-diagnostic-error-codes.md)). The steps
below are in order, and each one has a gate that catches the step being skipped.

## 1. Where each piece lives

| Piece | File |
|---|---|
| The registry | `packages/ir/src/diagnostics/codes.ts` |
| Rules (pure, no fs) | `packages/core/src/**` |
| Syntax and contract checks | `packages/parser/src/**` |
| The printed page's findings | `packages/core/src/view/readability.ts` |
| The geometry those findings read | `packages/renderer`'s `schematicGeometry` |
| The shape both sides agree on | `packages/core/src/view/facts.ts` |
| The generated code table | `docs/error-codes.md` — **generated, never hand-edited** |
| The spec tables | [`spec/schematic-view.md`](../../spec/schematic-view.md) §9.1 (errors) |
| | [`spec/schematic-view.md`](../../spec/schematic-view.md) §9.2 (warnings) |
| | [`spec/schematic-view.md`](../../spec/schematic-view.md) §9.2.1 (`data` payload) |

## 2. Register the code

In `packages/ir/src/diagnostics/codes.ts`, one entry keyed by `domain.slug`. The domain list is
closed: `syntax`, `value`, `ref`, `contract`, `net`, `bind`, `library`, `review`, `format`, `drc`,
`design`, `cli`, `view`.

```ts
"view.text-on-wire": {
  domain: "view",
  severity: "warning",                 // error blocks the build; warning does not
  summary: "<one sentence: what is wrong>",
  hint: "<imperative: how to fix it>",
  spec: ["spec/schematic-view.md §9.2"],
},
```

Never reuse an existing code for a different failure. Reusing the *same* code across layers is
correct when it is the same kind of failure — a `ref.*` code raised inside the `view` domain is
deliberate, not a mistake.

## 3. Emit it

**Where.** Rules live in `packages/core/src/**`; syntax lives in `packages/parser/src/**`. A rule
is a pure function: facts in, `Diagnostic[]` out.

**Location.** The IR carries no line numbers. A diagnostic's position comes from the parse's
source map, which turns an IR path into a span:

```ts
location: facts.locate?.(irPath) ?? { file, line: 1, col: 1 }
```

Point at the record the author can edit. When the fix lives in another file, still point at the
owned record and name the other file in the message.

**Data.** Numeric, in IR units (nm, nm², ppm), plus ids. The human-facing output formats mm and
mm²; the `--json` payload stays in IR units.

**Message shape**, used everywhere:

```text
print page <page>: <subject> <verb> <quantity>: <what it costs the reader>
```

### 3.1 Readability rules specifically

Geometry comes from the renderer's `schematicGeometry` — **never re-derive a text width or a
symbol extent**. If the fact you need is missing from `ReadabilityGeometry`
(`packages/core/src/view/facts.ts`), add it to **both** shapes: the renderer's `Sheet*` and core's
`Readability*`. The two agree by structural typing, so a field added to only one side is a type
error at `packages/cli/src/check.ts` — that error is the mechanism, not an accident.

## 4. Document it in the spec

Three edits in `spec/schematic-view.md` (or the spec of the description type that owns the
rule):

1. a row in [`spec/schematic-view.md`](../../spec/schematic-view.md) §9.1 (errors) or
   [`spec/schematic-view.md`](../../spec/schematic-view.md) §9.2 (warnings), with the status
   column;
2. a row in [`spec/schematic-view.md`](../../spec/schematic-view.md) §9.2.1 — the `--json` payload
   shape;
3. the sentence that counts the codes: it must match the new total.

If the rule needed new geometry, say so in the "geometry comes from the renderer" blockquote.

## 5. Regenerate

```sh
bun run gen         # writes docs/error-codes.md and packages/ir/src/generated/
bun run gen:check   # CI gate: fails on drift
```

`docs/error-codes.md` is generated. Editing it by hand is reverted by the next `gen` run.

## 6. Test

A unit test beside the rule, in the style of `packages/core/test/readability.test.ts`:

- one positive case, asserting the code **and** the `data`;
- one neighbouring case that must **not** fire — an own-net exemption, a touching-but-not-covering
  pair, a value below the threshold;
- one regression case for the behaviour you had to change.

After the geometry shape grows, add `fields: []` to every existing `ReadabilityGeometry` literal
in the tests.

Existing fixtures may legitimately violate a new rule. Update their **expected code arrays**
rather than distorting the fixture.

## 7. Verify and gate

```sh
bun run texteda check examples/reference-project
bun run test
bun run typecheck
bun run gen:check
bun run lib:verify
bun run check:links
bun run check:public
bun run fmt:teda --check .
bun run cases:check
```

A new finding on the reference project is a **drawing defect**, not a reason to weaken the rule.
Fix the drawing: reroute the wire, split the run into a second `wire` row, move the label. Then
`bun run fmt:teda examples/reference-project` and re-run the check — the warning count should drop
by exactly the findings you removed.

## 8. Traps

- **`bun test` does not typecheck.** Run `bun run typecheck` separately.
- **`exactOptionalPropertyTypes: true`** is on. An optional field built from `Map.get()` must be
  typed `?: T | undefined`, not `?: T`.
- The IR carries no line numbers; a diagnostic that hardcodes `line: 1` points nowhere useful
  unless the source map is consulted (§3).
- A code's `spec` array is a list of *links into the spec*, not prose. The generated table renders
  them.
- Do not add a code for a condition that is already covered by an existing one. A second code for
  the same failure splits the reports and doubles the maintenance.

## 9. Definition of done

- The code is in `codes.ts`, emitted from a pure rule, and its `location` resolves to a span.
- `spec/<type>.md` has the warning/error row, the `data` row, and an updated count.
- `bun run gen` was run and `bun run gen:check` passes.
- The test asserts the code and the payload, and covers the negative case.
- The reference project passes with 0 errors, and any new finding there has been fixed **in the
  drawing**.
- The full gate list above passes.

## 10. References

- [ADR-0003](../adr/01-language/0003-diagnostic-error-codes.md): the registry is the source of
  truth; codes are frozen once emitted.
- [`spec/schematic-view.md`](../../spec/schematic-view.md) §9.2 (warnings).
- [`spec/schematic-view.md`](../../spec/schematic-view.md) §9.2.1 (`data`).
- [`docs/error-codes.md`](../error-codes.md): the generated table.
- [`docs/skills/README.md`](README.md): the index of the procedures.
