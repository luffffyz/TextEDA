# ADR-0025: The Device Vocabulary Is Closed and Checked; a Parameter Is a Role and a Quantity

Status: Accepted
Date: 2026-10-23
Scope: Decides: that the device vocabulary is closed and checked, and that a parameter is a role plus a quantity with a dimension. Does not decide: the ratings a part may state — see ADR-0026.
Related: [ADR-0007](../ir/0007-device-description-enters-the-ir.md), [ADR-0024](0024-the-device-kind-is-part-or-generic.md), [ADR-0026](0026-a-part-states-its-own-ratings.md), [ADR-0027](0027-the-package-gives-a-chip-resistor-its-floor.md), [ADR-0029](0029-the-procurement-layer.md)
Impact: `spec/teda.md` §6.2.1, §6.2.2; `packages/core/src/device/**`

## Background

Three problems, one cause: the language states a fact once and then lets the reader guess what
else it implies.

**1. A generic that does not say enough.** A generic fixes its land pattern, so the land pattern
is a fixed package. A parameter that the specification is *incomplete* without must therefore be
stated, or the generic allows combinations whose meaning nobody wrote down. The reference project
shows the gap: the two MLCC generics did not declare a dielectric at all, so `10u 10% 35V` was a
legal specification with no temperature characteristic; the tantalum generic treated the voltage
rating as optional, although [ADR-0028](0028-package-code-and-3d-models.md) says in so many
words that a tantalum can changes with its voltage rating — the same fact, written as a hard rule
in the geometry layer and as an optional column in the parameter layer.

**2. A spelling that is only noticed downstream.** A capacitor's dielectric is a `string`-typed
parameter, so `X7r` parses. It is then a second BOM line, because the BOM line key is the
generic's id plus the parameter values. Nothing catches it at the place where it was written.

**3. A vocabulary that a check depends on, but that is open.** `construction` is declared an open
value set in the language, yet [ADR-0028](0028-package-code-and-3d-models.md)
decision 2 already branches on it: a land pattern may carry a package envelope only where the
package determines the body, and the rule excludes `tantalum`, `electrolytic`, `film`, `molded`
and `shielded` by name. (The check itself is decided but not written yet — it lands with
`lib:verify`, `docs/backlog.md` F32 — which is exactly why the vocabulary has to be closed
*before* the check, not after.) A typo in an open vocabulary does not produce an error — it
produces a **silent miss of a safety check**, which is worse than an error. The rule "a
vocabulary that a check branches on may not be open" is the one this record generalises.

## Decision

### D1. A parameter column is a role and a quantity

The `params` section keeps its three columns, `name type required|optional`:

```
params
  value      capacitance  required
  tolerance  percent      optional
```

- **`name` is the role** — which quantity or which rating the column carries.
- **`type` is the quantity** — the unit, and with it the integer representation in the IR
  ([ADR-0006](../ir/0006-ir-shards-and-hashes.md) decision 4).

So an inductor declares `value inductance required`, not `inductance value required`: `value`
is not a quantity, it is the role "the nominal value of the primary quantity", and the type slot
holds the unit and nothing else. The asymmetry is already in the contract: the IR gives
`param_decl.name` the pattern `^[a-z][a-z0-9_]*$` (an open label) and gives `param_decl.type` a
closed enumeration of quantities. This record keeps that asymmetry and names it.

### D2. Roles use the language's own shape

A role is lowercase with underscores, like every other identifier in the language. The
datasheet symbols are out: `I_sat` is one manufacturer's notation (Vishay writes `Isat`, TDK
writes `I_sat`), and putting it in the language binds the language to a vendor's notation — it
also violates the IR's own name pattern. `sat_current` is the role; `saturation_current` is the
same role spelled out, and the glossary is a better place for the long form.

### D3. The criterion of a rating role lives in the glossary, not in the type

`I_rated` and `I_sat` are not two names for one current:

| | rated current | saturation current |
|---|---|---|
| limits | temperature rise | magnetic flux |
| when exceeded | it heats, its life falls, it burns | the inductance collapses and the circuit loses control |

They do not correlate — an inductor with 6 A rated and 3 A saturating is a normal part, and the
magnetic limit usually comes first. So the role must distinguish them, and the role glossary in
`spec/teda.md` §6.2 states what each one means **including its criterion** (the datasheet
convention: saturation current at 30 % inductance loss; rated current continuous RMS).

The criterion is **not** put in the type vocabulary, because a `kind: part` may not declare
`params` at all ([ADR-0024](0024-the-device-kind-is-part-or-generic.md) decision 1):
a part's ratings are not in the IR, so the IR holds requirements only. The procurement check
compares *declarations*, not values ([ADR-0029](0029-the-procurement-layer.md) decision 3.2). The
criterion therefore has to be aligned between the person who writes the requirement and the
person who reads the datasheet — both human or agent — and not between two machines. Keeping
the type vocabulary a pure table of units ([ADR-0006](../ir/0006-ir-shards-and-hashes.md))
costs nothing and keeps the conversion table free of device engineering.

The consequence is that the IR contract does not move: `dielectric` remains a `string`-typed
parameter, and `param_decl.type` keeps its twelve quantities.

### D4. `construction` is a closed vocabulary

`construction` is closed because a rule already branches on it. The set lives in the tool's
table (D7), not in the language: the IR keeps `construction` as a plain string, and the check
closes it. An unknown construction is an error, not a warning — an unknown construction disables
[ADR-0028](0028-package-code-and-3d-models.md)'s envelope rule silently, and
a silent miss is the failure mode this record exists to remove.

### D5. `dielectric` has a closed value set

The set is the temperature-characteristic codes of IEC 60068-4 (`C0G`, `NP0`, `X7R`, `X5R`,
`Y5V`, …). The members are the only legal spellings: no aliases, no normalisation. A second
spelling for one code is a second BOM line, so accepting `X-7R` next to `X7R` would move the
problem rather than solve it. A value outside the set is an error at the source, and the
diagnostic lists the legal values.

### D6. A parameter is required when the specification is incomplete without it

The rule:

> **Required**: the specification is incomplete without it — the required set of a construction
> is what a purchasing document says about it (`100nF ±10% 16V X7R`, `10k ±1%`, `10uH ±20% 3A`).
> **Optional**: it picks within the class (ESR, DCR), or the package already decides it (a
> resistor's power rating).

The table, per construction:

| `construction` | required | optional |
|---|---|---|
| `mlcc` | `value`, `tolerance`, `voltage`, `dielectric` | — |
| `film` | `value`, `tolerance`, `voltage` | `esr` |
| `tantalum` | `value`, `tolerance`, `voltage` | `esr` |
| `electrolytic` | `value`, `tolerance`, `voltage` | `esr` |
| `thick`, `thin` | `value`, `tolerance` | `power` |
| `shielded`, `molded` | `value`, `tolerance`, `rated_current` | `sat_current`, `dcr` |

Three things follow:

- The required set of every construction is now **exactly the specification string on a
  purchasing document**. That is the check's whole meaning: an instance row of a generic states
  a complete specification.
- `sat_current` is optional. It was required by feasibility — "the package must carry the
  design's peak current without saturating" — which is a comparison, not a completeness
  question. It stays a role (D2): it is what the design states when the peak current matters,
  and comparing it against the design is separate work.
- A resistor's `power` stays optional: the package decides the rating, and the design's
  dissipation is a constraint (`power R1 63mW`), not a parameter.

**Why completeness and not feasibility.** Feasibility is not enforceable: a required column only
means the row *states* the value, and nothing compares it against the package's capability,
because the package's capability is not in the IR. Completeness leaves the specification
incomplete otherwise — with the tolerance optional, an instance row may say `100n 16V X7R`, and
the BOM line key is the device id plus the parameter values, so two rows with different
tolerances would be one BOM line, and the part that gets bought is chosen by somebody other than
the design. The design is the truth; the procurement layer is a projection of it. An unstated
tolerance is a hole in the truth.

The column order is unchanged, because the required group may be declared in any order: the
existing instance rows stay valid, and the rows that lacked a dielectric gain one.

**What "required" buys, and what it does not.** The parser enforces that an instance row
supplies every required column, so the requirement is stated in the source — that is the whole
of it. Nothing compares the stated requirement with anything: there is no evaluator that checks
a capacitor's voltage rating against the net it sits on, and none that checks a part against the
requirement, because a part carries no ratings in the IR (D3). Stating a requirement and
verifying a requirement are two different pieces of work; this record settles the first.

### D7. The table that knows all of this lives in the tool, not in the language

One table in `packages/core` holds the closed `construction` set, the per-construction role set
with each role's quantity and requiredness, and the closed value sets.

It is tool-side because it is device engineering knowledge, not language structure: it changes
when the device world changes, and a language should not carry a table it must be versioned for.
The same reasoning as [ADR-0001](../language/0001-fact-layer-has-no-expressions.md) — the knowledge lives
next to the language, not inside it.

It is closed, and it fails closed. A new construction is a tool upgrade, not a project decision.
That is the cost, stated plainly.

### D8. An instance row states an envelope, not a part

Every value in an instance row is a **requirement** on the part that will be bought, not a copy
of its datasheet: the nominal value, the tolerance as the permitted deviation, the voltage rating
as a minimum, the dielectric as a class. A part qualifies when it satisfies all of them — and a
*better* part qualifies too.

`R1 10k ±1%` means "any 10k within ±1%": a 0.5 % part qualifies (and is what you buy when 1 %
runs out), a 2 % part does not. **Stating the tolerance therefore does not block substitution;
stating a value as a fact does.** The row is the design's complete requirement set, and
procurement chooses within it ([ADR-0029](0029-the-procurement-layer.md)).

Each role therefore carries a **comparison direction** for the day a part is selected against a
line: an upper bound for `tolerance`, `esr` and `dcr`; a lower bound for `voltage`,
`rated_current` and `sat_current`; equality for `dielectric` (the classes are not ordered — X7R
is better in temperature and worse under DC bias); and an envelope for `value` (the part's own
worst case must fall inside the line's). The directions live in `spec/teda.md` §6.2.1 and
`spec/procurement.md` §3.3.

**The tolerance stays required.** The rule was challenged on the ground that a capacitor's
tolerance is a catalogue fact rather than a design input: no calculation in the design uses it,
so requiring it over-specifies the design. With the envelope reading the challenge is answered
rather than conceded: an unstated tolerance is not a neutral omission — it hands procurement the
freedom to pick anything in the class, whereas a stated one is a limit it must respect. The
design states the limit even when its own calculations are indifferent to it, and that is a small
price: the stated limit is a *permitted* deviation, so a better part still qualifies and nothing
is blocked.

**The tolerance is also the worst case.** `10k ±1%` is the interval [9.9 kΩ, 10.1 kΩ]. An
evaluator checks the constraints over that interval, not over the nominal value: the design
guarantees its behaviour for every part it permits, and the bought part is inside that guarantee
by construction. **The number that bounds the purchase is the number the analysis must
survive** — one value, two uses.

### D9. A broken device file is reported at the file

The rules in this record make a broken device file a routine event, so the check has to say what
is wrong without piling consequences on top of it:

- The device file's own errors are reported **at the file**, with file and line
  (`value.component-construction-invalid`, `value.component-param-invalid`).
- A board that references a device file with errors gets `ref.component-invalid` as a
  **warning** naming the device file. It is a consequence, not a second cause: the file's own
  errors already block the check.
- `ref.unknown-component` is reserved for a device id that **does not exist**. Saying "not
  found" about a file that is present but wrong sends the reader to the wrong place — and, with
  one file referenced from many rows, repeats the same wrong sentence many times.

## Consequences

- The IR contract does not move: `param_decl.type` keeps its quantities, `construction` stays a
  string, `dielectric` stays a `string`-typed parameter. Every check in this record happens on
  the source side.
- A BOM line for a generic now carries a complete specification, so the line key says what the
  part has to be.
- The reference project's own generics were corrected to satisfy the rule: the two MLCC generics
  did not declare a dielectric, and no generic required its tolerance.
- The residual hole is stated rather than hidden: a stated requirement is not a verified
  requirement.

## Open Points

- **Who owns the vocabulary.** The table is global today. A project that needs a construction the
  table does not know has to wait for a tool upgrade. Whether a project may extend the table
  locally — and how the envelope rule would then treat the extension — is not decided.
- **The resistor's power rating.** It is implied by the package rather than stated per instance.
  Should the package's rating become a library fact the checker can use, with the design's
  dissipation as a constraint (`power R1 63mW`)? The constraint vocabulary has
  `power <component or net> <max>`; the rating side does not exist. Not decided.
- **`esr` and `dcr`.** Both are resistances today, but they are different ratings with
  different consequences (a capacitor's ESR is a loss, an inductor's DCR sets its temperature
  rise). Whether they deserve their own types is not decided.
- **Where a part's ratings live.** The comparison direction per role is decided (D8), but the
  ratings it compares against are not: a part carries no `params` today
  ([ADR-0024](0024-the-device-kind-is-part-or-generic.md) decision 1 — a part's identity is
  closed, and `params` are the columns an `instances` row fills, which is the generic's
  business), while `spec/procurement.md` §3.2 needs the part to carry the generic's roles so a
  line can be checked against a part. The two cannot both stand. The shape that fits both is a
  **separate fact section on the part** (ratings beside `pins`, not `params`), but the choice
  between that and sourcing the ratings from the library at selection time is separate work.
- **Worst case is a mode, not a value.** Treating the tolerance as the design's deviation budget
  (D8) only pays off if something evaluates the constraints over the resulting intervals. Such an
  evaluator has to answer two questions the language does not answer yet. *Nominal or worst case*:
  a design may deliberately rely on nominal values (a reference divider whose ratio error is
  irrelevant) or on matched parts (a matched resistor pair has a better ratio than two independent
  1 % parts). *Which parts vary together*: independent intervals overstate the pessimism — two
  1 % resistors do not drift to +1 % and −1 % at once unless they are independent, and matched
  pairs drift together — so the evaluator has to know what the design treats as correlated. Both
  are language questions, not evaluator details.
