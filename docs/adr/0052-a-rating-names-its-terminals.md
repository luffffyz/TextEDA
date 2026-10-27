# ADR-0052: A Rating Names Its Terminals, and the Role Says Which Direction Is Stress

Status: Accepted
Date: 2026-10-26
Related: [ADR-0038](0038-device-vocabulary-and-parameter-roles.md), [ADR-0039](0039-a-part-states-its-own-ratings.md), [ADR-0043](0043-ratings-are-compared-against-declared-windows.md), [ADR-0044](0044-dissipation-is-checked-against-declared-limits.md), `docs/backlog.md` F42 / F43
Impact: `spec/teda.md` §6.2.1 and §6.4; `schemas/ir/v0.15/component.schema.json` (`rating.terminals`); `packages/parser` (ratings rows); `packages/core` (role metadata and the first multi-terminal comparison). Additive: existing ratings keep their meaning.

## Context

ADR-0043 checks a voltage rating only for a **two-pin** device. The check takes the extreme
difference of the two nets' declared windows, because a capacitor's stress is the voltage across
it, not the potential of either side. That model is deliberately narrow (ADR-0043 D6): the next
device classes — diodes, LEDs, transistors, regulators — have more than two pins, and "the voltage
across a rating" is not "the voltage across any two pins".

Two facts are missing from a `rating` row:

- **which two terminals** the number refers to (`Vds` is drain-to-source, `Vr` is cathode-to-anode,
  a capacitor's voltage is across its two plates);
- **which direction** is the stress. A diode's reverse voltage is a limit; its forward drop is
  normal operation, not a violation. Taking `max(|ΔV|)` on a diode would report a forward-biased
  junction as a breakdown.

The backlog already treats these as one decision: the terminal pair and the direction are two
halves of the same row, and deciding them separately would write the pin columns twice
(`docs/backlog.md` F42 items 2 and 3). The role vocabulary needs the same metadata, because a role
like `reverse_voltage` only means something with a direction (F43's `kind` discussion).

This record decides the row shape and the direction model. It does not invent datasheet values,
and it does not add the current check: "which member carries a net's current" is still undefined
(F42 item 5).

## Decision

### D1. A rating row may name its two terminals after the value

The `ratings` table keeps its existing three columns and gains an **optional** ordered pair:

```
ratings
  voltage          voltage  36V    1 2
  reverse_voltage  voltage  40V    A K
```

| Column | Meaning |
|---|---|
| `role` | A role from the closed vocabulary, exactly as today |
| `type` | The role's quantity, exactly as today |
| `value` | The rating, exactly as today |
| `from` | Optional; a **pin number** of this device |
| `to` | Optional; a **pin number** of this device, different from `from` |

The table has either three columns or five. Four columns is an error, and so is a terminal
reference that is not in the component's pin table. Pin **names** are not accepted: a name may be
reused (`GND`, `OUT` on a multi-unit part), and a rating that silently picked one of two pins is
the ambiguity `ref.ambiguous-pin` already refuses elsewhere.

The pair is ordered. `from` then `to` is the direction the role's definition reads; it is not
alphabetical and not inferred from the net order.

### D2. Direction belongs to the role, not to the row

A row does not repeat `symmetric` / `forward` / `reverse`. The role table (§6.2.1) gains a
**direction** column with four values:

| Direction | Stress read from a declared window pair | Meaning |
|---|---|---|
| `symmetric` | `|V_from − V_to|` | Either polarity stresses the part (a capacitor, a resistor) |
| `from` | `V_from − V_to`, only when non-negative | The part is stressed when `from` is above `to` |
| `to` | `V_to − V_from`, only when non-negative | The part is stressed when `to` is above `from` |
| `none` | not a voltage stress | The role is a limit of another quantity, or not a boundary at all |

The sign convention is the role's definition, not a second fact in the file. `reverse_voltage`
would name `from = anode`, `to = cathode` and use `to`: the stress is the cathode above the anode.
`drain_source_voltage` would name `from = drain`, `to = source` and use `from`. A role that needs
the opposite reading is a different role with its own definition, not the same role with a
per-row override.

**Why not a per-row direction token.** It would let one row say `voltage ... from` and the next
say `voltage ... symmetric` for the same role; two tools would then disagree about what the role
means. The role is the unit of meaning, and the vocabulary is already closed and versioned
(ADR-0038). A row that needs another direction needs another role.

**Why not pin names.** Pin numbers are the key the footprint and the binding checks already use
(`component.pins[].number`); names are display labels and may be reused. A rating is a physical
fact about a terminal, so it uses the physical key.

### D3. The role table also carries `kind`

The same role table gains a **kind** column, resolving the vocabulary split F43 identified:

| Kind | Meaning | May a stress check consume it? |
|---|---|---|
| `limit` | A boundary the design must stay inside (`voltage`, `power`, `rated_current`, `tolerance`, …) | Yes, when it has a direction and terminals |
| `characteristic` | A property used to choose or describe a part (`value`, `esr`, `dcr`, a future `rds_on`) | No; it is not "must not exceed" |
| `code` | A closed code (`dielectric`) | No |

`kind` is metadata in the role table (`packages/core` is the source of truth; §6.2.1 is the
published table). It is **not** a new `ratings` column and not a new IR field: the role already
names the row, and a second copy of its kind in every file would drift.

This does not add every future role. It fixes the two pieces of metadata a role needs before it
can enter a stress check; adding a role remains F43 vocabulary work, with the role's name,
quantity, kind and direction decided together.

### D4. No terminals means a device-level rating

A three-column rating remains legal and keeps its current meaning: the number applies to the
device as a whole. It is usable by the two-terminal voltage check exactly as today, because a
two-pin device has only one pair of terminals. It is **not** a multi-terminal stress fact.

Consequences:

- a two-pin part may omit `from` / `to`, and existing files stay valid;
- a two-pin part may state the pair explicitly; it must then be its two pins, in either order for
  a `symmetric` role;
- a part with three or more pins that states a `limit` without terminals is **not compared** and is
  counted in `design.stress-unknown`, not treated as a pass;
- a `characteristic` or `code` rating may still state terminals as documentation, but no stress
  check consumes it.

This is the compatibility rule, and it is also the honest one: a number whose terminals are not
stated cannot be checked against a pair of nets.

### D5. The first checker slice reads explicit terminal pairs

When implemented, the voltage check will:

1. read the role's `direction` and `kind` from the role table;
2. for each `limit` rating with a direction other than `none`:
   - with terminals, look up the two pins' nets and compute the stress in the role's direction;
   - without terminals, keep the existing two-pin inference (D4);
3. compare the extreme of the declared windows, not the nominal point (ADR-0043 D1);
4. count an unknown (missing window, pin not on a net, no terminals on a multi-pin part) in
   `design.stress-unknown`, never as a pass (ADR-0043 D4);
5. never compare a `characteristic` or `code` as a boundary.

For a directed role, the opposite polarity is not a violation and is not counted as "not
compared": it is outside the stress the role describes. A diode reverse rating does not fire on a
forward-biased junction.

The first synthetic test cases use a three-pin part with a `voltage` rating between two named
pins, plus a directed two-pin role. They use synthetic values only; no datasheet value is invented
for the reference project.

### D6. Current stays out

`current` still has no owner: `current VOUT 3A` says the net's budget, not which member carries it.
Terminals alone do not solve that; they identify a path, not a division of current among parallel
members. The current slice waits for a separate decision (F42 item 5).

### D7. Contract and language version when this is implemented

The IR `rating` object gains an optional `terminals` array of exactly two pin numbers. It is
additive, so old shards remain valid; the contract goes to **v0.15** when the schema ships. The
language line is a PATCH under ADR-0022 (`component 0.1.5` → `0.1.6`): old files are still legal,
and a file that uses the new columns declares the new PATCH. The parser and `core` follow the same
batch; no existing reference project data changes.

## Consequences

- A multi-pin device can state `Vds`, `Vr` or a regulator's `Vin` without inventing a per-construction
  pin model: the part file names the terminals, and the role names the direction.
- A two-pin file does not grow ceremony: three columns still mean the only pair of terminals.
- The vocabulary now has a place for limits, characteristics and codes; adding a role is a
  documented change, not a new syntax.
- The first implementation raises coverage only where parts actually state ratings; the reference
  project still has no datasheet values for most of those parts, so its `design.stress-unknown`
  count stays honest until F42 item 1 supplies them.

## Alternatives

- **A per-row `direction` column.** Rejected: it duplicates the role's meaning and permits two
  contradictory rows for one role. A row would have to restate `symmetric` on every capacitor.
- **Pin names instead of pin numbers.** Rejected: names are reusable and ambiguous; the footprint
  and binding checks key on numbers.
- **A separate terminal-pair table keyed by role.** Rejected: one rating row is one fact, and a
  second table would let the pair and the value disagree about which row they belong to.
- **Require terminals on every rating.** Rejected: it breaks every existing two-pin part for a
  piece of information that device already has (its only two pins).
- **Infer the pair from the net order or the symbol.** Rejected: nets are sets, and symbols are
  views; neither carries the part's terminal semantics. Inference here is how a checker becomes
  confidently wrong.
- **Put the direction in the IR row.** Rejected for the same reason as the per-row column: the
  role table is the one source of truth, and the IR already carries the role name.

## Open Points

- The exact role names for the first directed limits (`reverse_voltage`, `drain_source_voltage`,
  `gate_source_voltage`, …) belong to F43; this record fixes only the terminal and direction
  mechanics.
- Whether a future `current` role uses `from` / `to` as a conventional flow direction is deferred
  with the current check (D6).

## Addendum (2026-10-27): the PATCH this record reserves is taken; the next free one is `0.1.8`

D7 says the language line moves `component 0.1.5` → `0.1.6` when the `terminals` column ships. That
number was already spent by the time this record was written: `0.1.5` → `0.1.6` belongs to
`provenance`/`verified_by`/`verified_on` ([ADR-0047](0047-an-external-library-is-a-template-not-a-dependency.md)),
and `0.1.6` → `0.1.7` to the per-file `rev`
([ADR-0049](0049-a-file-carries-its-own-revision.md)). The live line is **`0.1.7`**
(`spec/teda.md` §13.1, §13.4), so the next free PATCH is **`0.1.8`**.

The decision is unaffected: the `terminals` column is still additive, still a PATCH under
[ADR-0022](0022-language-versioning.md), and the contract still goes to `v0.15` when the schema
ships (`schemas/ir/v0.14/` is the current directory). Nothing here is implemented yet.

Three version lines are easy to conflate, so stated once: the language as a whole is at **`0.9`**
(`project.toml` `format`), the `component` type line is at **`0.1.7`** (`spec/teda.md` §13.1),
and `packages/parser/src/version.ts` lists only MINORs (`component: { born: 1, current: 1 }`)
because acceptance ignores the PATCH digit.
