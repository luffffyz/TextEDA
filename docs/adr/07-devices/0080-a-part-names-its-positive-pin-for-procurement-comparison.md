# ADR-0080: A Part Names Its Positive Pin for Procurement Comparison

Status: Accepted
Date: 2026-11-18
Scope: Decides: that a part may optionally state which of its pins is positive; that the procurement checker compares this fact with a directed generic when both use the same footprint; how a missing or different part pin is reported; and the language and IR contract versions. Does not decide: the direction of a generic's voltage requirement ([ADR-0078](0078-a-polarised-class-names-its-positive-pin.md)); rating roles or derating ([ADR-0026](0026-a-part-states-its-own-ratings.md)); or procurement requirements other than polarity ([ADR-0029](0029-the-procurement-layer.md)).
Related: [ADR-0024](0024-the-device-kind-is-part-or-generic.md), [ADR-0029](0029-the-procurement-layer.md), [ADR-0030](../08-libraries/0030-footprint-format-and-geometry.md), [ADR-0078](0078-a-polarised-class-names-its-positive-pin.md)
Impact: `spec/teda.md` §6.1, §6.3, §12.1, §12.4; `spec/procurement.md` §3.3, §7, §8; `packages/parser/src/component.ts`, `packages/parser/src/version.ts`; `packages/core/src/procurement/rules.ts`; `schemas/ir/v0.22/**`; `examples/reference-project`, `examples/cases/class-devices`

## Background

[ADR-0078](0078-a-polarised-class-names-its-positive-pin.md) gave a polarised generic a `positive_pin`: the generic says which way round its requirement is read. It deliberately left procurement polarity open. The checker compared the selected part's ratings with the generic's line, but a part had no way to state which of its pins was positive, so a same-footprint part mounted the other way round could still pass.

The two pin numbers belong to two device descriptions. A generic's pin 1 is not, by itself, evidence that a selected part's pin 1 is positive. But when the generic and part name the same footprint, the footprint pad number is the shared pin identity boundary ([ADR-0030](../08-libraries/0030-footprint-format-and-geometry.md) D7), so their declared positive pin numbers can be compared directly. When their footprints differ, procurement already rejects the selection: comparing their pin numbers would add no useful signal and could invent a correspondence that the files do not state.

## Decision

### D1. A part may state its own positive pin

A `kind: part` file may optionally declare `positive_pin <pin number>`. It names the positive pole in that part's own pin-number space; it is not inherited data copied from the generic. A part may omit it, because many parts have no relevant polarity or the library has not established the orientation.

When present, the pin number must name a pin in the part's own `pins` table, that pin must have electrical type `polarized`, and the part must have exactly two pins typed `polarized`. This is the same local shape required of a directed generic. The parser checks this independently of procurement.

The generic's rule is unchanged: a polarised generic names its positive pin, and an unpolarised generic does not. A part's optional orientation does not change its classification or construction, which remain facts inherited from the generic it is selected for ([ADR-0024](0024-the-device-kind-is-part-or-generic.md) D2).

### D2. Compare only a directed generic and a part on the same footprint

For a procurement selection, compare polarity if and only if:

1. the generic declares `positive_pin`; and
2. the part and generic have the same `footprint`.

The part qualifies only when it declares the same `positive_pin` pin number as the generic. A missing part value and a different value both make it unsuitable. Pin names are not compared: names can differ between descriptions and are not the shared identity boundary.

A different footprint remains a footprint mismatch and does not also produce a polarity comparison. An undirected generic does not require or compare the part's orientation; this preserves the behaviour of generics whose requirement is still a magnitude or that are unpolarised. A part-side `positive_pin` has no effect when selected for such a generic.

### D3. Use the existing suitability diagnostic and procurement severity

A primary selection whose part omits or disagrees with the required positive pin is unsuitable and reports `value.procurement-part-unsuitable` as an error. The same failure in an alternatives file is a warning, or an error in strict mode. The diagnostic identifies the expected generic pin and the part's stated pin (or `not stated`). No new diagnostic code is introduced.

A same-footprint selection whose declared positive pin matches the generic has no polarity diagnostic. The rule does not alter the comparison of ratings or the design-level polarity check: the former remains role by role ([ADR-0029](0029-the-procurement-layer.md)), and the latter checks the generic's requirement against the schematic windows ([ADR-0078](0078-a-polarised-class-names-its-positive-pin.md)).

### D4. The language moves to 0.18.0 and the IR contract to v0.22

A part-side `positive_pin` is a new accepted language fact, so it is available from language 0.18.0. The gate applies to that fact: a part file below 0.18 that writes it is rejected; older part files remain valid without it. The generic-side fact remains available from 0.17.0.

The IR contract moves to v0.22 to publish the component field's expanded semantics. `v0.22` is copied from `v0.21` with version identifiers updated and the `positive_pin` description clarified; `v0.21` is unchanged. A part that omits the field continues to compile without it.

## Consequences

- A part can document its orientation without treating the generic's pin number as if it were the part's.
- A reverse-orientation part on the same footprint is rejected for a directed generic before the schematic is built from that procurement choice.
- A missing part orientation is no longer silently treated as a match for a directed generic.
- Generics without a named direction retain their former procurement behaviour.
- The class-devices case carries matching jack and LED orientations in the IR; unit tests pin opposite, missing, alternative, different-footprint and undirected cases.
- No migration is needed: old part descriptions remain accepted, and only a part that adopts the new scalar must declare language 0.18 or later.

## Open Points

- Polarity is not inferred across different footprints. Supporting such a comparison would require an explicit shared pin/pad correspondence; matching pin names or guessing from device convention is not part of this decision.
