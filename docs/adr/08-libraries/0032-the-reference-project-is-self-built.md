# ADR-0032: The Reference Project Is Entirely Self-Built

Status: Accepted
Date: 2026-10-20
Scope: Decides: that the reference project carries its own symbols and footprints, and that library-level checks close the loop. Does not decide: the trust model for a library you do not own — see ADR-0034.
Related: [ADR-0030](0030-footprint-format-and-geometry.md), [ADR-0031](0031-symbol-format.md), [ADR-0033](0033-libraries-are-unverified-facts.md)
Impact: `spec/symbol.md` §7; `spec/footprint.md` §7; `examples/reference-project/**`; `scripts/lib-verify.ts`

## Background

The reference project `examples/reference-project/` originally got the whole pipeline running on **borrowed libraries**: the `symbol` / `footprint` of every device file pointed at KiCad's official libraries and at JLC (嘉立创)'s `wch_kicad_library`, and `project.toml` pinned versions with `[libs.kicad]` + `[libs.wch_mcu]`.

That is fine in the world of "a human draws boards in a GUI", but it conflicts with this project's premise:

- **agent-first** ([ADR-0016](../05-pcb/0016-agent-first-pcb-description.md)): an agent has to be able to build symbols and footprints by itself from a datasheet ([ADR-0030](0030-footprint-format-and-geometry.md) decision 2). If the reference project itself relies on borrowed libraries, there is no complete "library from zero to board" sample.
- **Reproducibility**: borrowed libraries have to be fetched over the network to get a version; their bytes are not in the repository, so a single `.teda` cannot be pinned by its own contents.
- **The value of a "reference project" is precisely that it can be reproduced byte for byte**: it is at once the conformance input, the subject of `bun run smoke:*`, and the target of library-level checks.

The preconditions for self-built libraries are now in place: the `.teda` library format ([ADR-0030](0030-footprint-format-and-geometry.md)), the symbol library format ([ADR-0031](0031-symbol-format.md)), the exporter, the KiCad smoke run. What is missing is **moving the libraries into the project**, and **a gate that keeps "every reference resolves"** — because pin numbers, pad numbers and symbol views are aligned across files and drift naturally.

## Decision

1. **The reference project no longer references any external library**. The `symbol` / `footprint` of every device file are written as `project:<name>` — the explicit synonym for a bare id.
2. **The project's own symbols and footprints are assets, not a library.** They live under
   `assets/symbols/` and `assets/footprints/`, and `project.toml` carries no library entry at all:
   the project has no dependency to declare, and the `[libs]` table is gone with the anchor (see
   [ADR-0034](0034-trust-in-a-library-you-do-not-own.md)). The reference project has **no
   `external/` directory at all**, which makes it the worked example of the case the tree-ownership
   record leaves open: a project that borrows nothing.
3. **The library-level checks still apply, to a wider scope.** The three-way alignment of symbol
   pin numbers, footprint pad numbers and device pin numbers must hold for every asset the
   project owns *and* for every asset of an imported library, and `lib:verify` checks both.
4. **Library-level checking is a closed-loop gate**: `bun run lib:verify` (`scripts/verify-libs.ts`) has to be fully green to pass:
   - the `symbol` / `footprint` of every device file points at a file that exists inside the project (no external prefix, no pointing at a file that does not exist);
   - there are **no orphan library files** (every library file is referenced by at least one device);
   - the pin number set of a symbol is **exactly** the pin number set of the device referencing it; the pad number set of a footprint **covers** the device's pin numbers (extra pads raise a warning);
   - every library file is in canonical form, compiles to IR and passes the contract;
   - the export succeeds, and **our own renderer** draws the symbols and footprints and
     self-checks them.

   The gate is split into two tiers, because **a gate may not depend on an external tool**
   ([ADR-0021](../06-manufacturing/0021-the-manufacturing-output-path.md) decision 1):

   | Command | Content | Needs KiCad |
   |---|---|---|
   | `bun run lib:verify` | everything above | No |
   | `bun run lib:verify:kicad` | additionally: KiCad can read the exported `.kicad_sym` / `.kicad_mod`, and the merged board has 0 `pcb drc` violations | Yes (optional) |

   KiCad's read-in and DRC are cross-validation, not the definition of our correctness. The checks
   themselves are unchanged; only their tier changed. The merged-board `.kicad_pcb` is still
   generated, as an interoperability artifact rather than a gate.
5. **The library geometry is a "generic land pattern", not the exact dimensions of each part number**. The goal of the reference project is to make the pipeline and the check loop hold, not to replace vendor libraries (`AGENTS.md` §1: "no generic library"). Every footprint's `description` states `generic land pattern`, so that whoever comes later does not mistake it for exact dimensions. **Making the geometry exact is a separate follow-up item**, see F1 in `docs/backlog.md`.

## Consequences

- **Benefit**: the reference project is now a **self-contained, reproducible sample that an agent can rebuild from zero**; every byte of the library is in the repository; library-level checks turn the drift between "pin numbers / pad numbers / views" from "watched by a human" into "reported by a tool".
- **Cost**: the geometric accuracy is below vendor libraries (see decision 5); the KiCad tier of
  `lib:verify` is optional, so it can only be all green when KiCad is installed.
- **A real bug fixed along the way**: the symbol exporter wrote `(stroke (width 0) (type none))` for "line width 0 (no outline)", while KiCad's stroke type enumeration has no `none` — **KiCad rejects the entire symbol library**. It has been changed to `(type default)`, with a regression test added (`packages/exporter/test/symbol.test.ts`).
- **Verified in practice** (`bun run lib:verify`): every device file, symbol and footprint of the reference project parses, compiles, exports, and passes the contract; the optional KiCad tier reads and renders them, and the merged board has `violations=0`.
