# ADR-0027: The Package Gives a Chip Resistor Its Floor

Status: Accepted
Date: 2026-10-23
Scope: Decides: that a chip resistor's package gives it a floor rating, and that the floor binds procurement too. Does not decide: the rating vocabulary — see ADR-0026.
Related: [ADR-0025](0025-device-vocabulary-and-parameter-roles.md), [ADR-0026](0026-a-part-states-its-own-ratings.md), [ADR-0028](0028-package-code-and-3d-models.md)
Impact: `spec/teda.md` §6.4; `packages/core/src/ratings/**`

## Context

[ADR-0026](0026-a-part-states-its-own-ratings.md) landed the dissipation check and
found the reference project comparing nothing: 24 of 24 resistive instances were skipped, 4 of them
because **nothing stated a power limit**. The design was right to stay silent — a resistor's power
rating is decided by its package, and the role table already says so ("a resistor's power rating:
the package already decides it"). The check simply had no way to know the package.

That is the same shape as ADR-0025 D7: the knowledge exists, it is device-world knowledge, and it
belongs in the tool — not in 24 instance rows, not in a language the user must restate it in.

Two facts make the table possible without guessing a part:

1. **A chip resistor's rating is a property of (technology, package)** — a 0402 thick film is
   1/16 W; the same 0402 in MLCC form has no power rating at all.
2. **Thick film is the lowest grade a size is sold in.** Every other film of that size is rated the
   same or higher. So the thick-film value is not a guess at which part is bought; it is a **floor**
   under every part that could be bought for that socket.

## Decision

### D1. The floor is the standard (thick-film) rating of the JEDEC size

`packages/core/src/devices/packages.ts` holds a closed, integer, microwatt table:

| Size | Floor |
|---|---|
| 0201 | 50 mW (1/20 W) |
| 0402 | 62.5 mW (1/16 W) |
| 0603 | 100 mW (1/10 W) |
| 0805 | 125 mW (1/8 W) |
| 1206 | 250 mW (1/4 W) |
| 1210 | 500 mW (1/2 W) |
| 2010 | 750 mW (3/4 W) |
| 2512 | 1 W |

It is keyed by `(construction, package_code)`, and only the two chip-resistor constructions
(`thick`, `thin`) consult it: a 0402 MLCC legitimately has no power rating, so the floor is
`undefined` there. The `package_code` is the land pattern's fact (ADR-0028 decision 1), so nothing
is restated in the device file.

### D2. A floor is a lower bound, so a violation is certain and a pass is not proof

The floor is the rating of the **worst** part the socket could receive, so:

- `stress > floor` means **every** part of that size is over-stressed — a certain violation, not a
  guess about a part. That is the one direction a bound may safely err in.
- `stress <= floor` says nothing about the specific part: a higher-rated part is still needed if
  the design wants margin. It only means no standard part is obviously destroyed.

The floor is therefore used **only when nothing else names a limit** — neither the design's
`power` constraint, nor the line's `power` requirement, nor the part's own rating. A line that
says `power 1W` on a 2010 has bought a 1W part and has narrowed the class deliberately; the
package convention does not get to overrule it (min-with-the-floor would flag a legitimate 0.9 W
dissipation). Precedence: **declared bounds first, the floor as the fallback.**

### D3. Package codes are JEDEC spellings, and an unknown code is "not compared"

`package_code` is written in the JEDEC (imperial) form for chip sizes — `0402`, not the IEC metric
`1005` — and that is now stated in `spec/footprint.md` §2. The table knows only the JEDEC
spellings; an IEC spelling, or a code the table does not carry, is **not an error**: it is a
package whose rating this tool does not know, and it is counted in `design.power-unknown`
(`no_package_rating`), never treated as a pass. This is where the table deliberately differs from
the construction vocabulary (ADR-0025 D7, fail-closed): an unknown construction is a grammar
problem, an unknown package is a value the device world has not taught the tool yet, and erroring on
it would block builds for a code that is perfectly legal in a land pattern.

### D4. The same floor binds procurement

A missing limit in the line would otherwise be a hole in **both** checks at once: the design check
would pass on the floor, and selection would accept a part whose rating is below it. So procurement
rule 4a (ADR-0029's rules): for a generic whose floor exists, when the line states no `power` role,

- the selected part **must state** its `power` rating (`value.procurement-ratings-missing`), and
- that rating **must be at least the floor** (`value.procurement-part-unsuitable`).

Otherwise "the design did not say" would mean "the weakest part on the market is acceptable". The
fix on the design side is one column (`power` in the instance row), which is exactly the statement
the check needs.

## Consequences

- The reference project now compares the 4 resistive instances whose both nets declare windows
  (it was 0): `20 of 24` remain skipped, all for a declared-window reason, and there are 0
  violations. The two 0402 parts added to the library in ADR-0026 now also satisfy rule 4a by
  stating `62.5mW` / `63mW`.
- A 0402 line with no `power` requirement whose selected part states nothing now fails the check
  (rule 4a). That is new: it asks every purchased chip resistor for its power rating, which every
  datasheet states.
- High-power parts of a small package (a 0402 rated 200 mW) are legitimate but invisible to the
  design check: the **line** must say `power 200mW` for the floor to move out of the way. The
  diagnostic's hint says so.

## Alternatives considered

**Put the rating on the land pattern.** Rejected: a land pattern is geometry, and the same 0402
carries an MLCC (no power rating) and a resistor. The rating is a fact of (technology, package),
which is the generic's construction plus the land pattern's code.

**Make the table fail-closed like the construction set.** Rejected in D3.

**Sweep the table as a hard bound even when a limit is declared (min).** Rejected in D2: it would
flag a design that deliberately bought a 1 W 2010, which is a real part and a real decision.

**Let the floor fill in the row's requirement (i.e. procurement compares nothing).** Rejected in
D4: the two checks must not be able to disagree about the same selection.

## Open points

1. **Thin film may be rated below thick film somewhere.** The floor's correctness rests on "no
   chip resistor of this size is sold below the thick-film rating". A counterexample turns a
   certain violation into a false pass — the one unsafe direction — so the table row must be
   revisited when a lower grade appears, and `thick` and `thin` are kept as separate keys so a
   divergence can be expressed without a new mechanism.
2. **Voltage floors for the same packages** (0402 = 50 V working, 2010 = 200 V) are the natural
   second column; they wait for the "symmetric voltage facts" step of F42, because they are
   limited by the part, not only by the package.
3. **Parts of a non-standard package code** (`SMD-3225-4`) never get a floor; they are counted.
