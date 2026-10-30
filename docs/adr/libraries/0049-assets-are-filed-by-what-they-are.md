# ADR-0049: Assets Are Filed by What They Are, Each Kind by Its Own Axis

Status: Accepted
Date: 2026-10-30
Scope: Decides: that the directory under `assets/components/`, `assets/symbols/` and `assets/footprints/` is a **classification**, that symbols use the device's axis and footprints use a package axis of their own, and that a reference to either is `<classification>:<id>`. Does not decide: the format of the symbol and the footprint themselves — see ADR-0031 and ADR-0030.
Related: [ADR-0008](../project/0008-project-tree-has-owners.md), [ADR-0024](../devices/0024-the-device-kind-is-part-or-generic.md), [ADR-0030](0030-footprint-format-and-geometry.md), [ADR-0031](0031-symbol-format.md), [ADR-0034](0034-trust-in-a-library-you-do-not-own.md), [ADR-0048](../view/0048-the-review-app-shows-drawings.md)
Impact: `spec/teda.md` §2 and §13.4; `spec/symbol.md`; `spec/footprint.md`; `packages/cli` (the library loaders, the shard writer, `lib import`); `core`/`viewer` (the review app's library listing); `examples/reference-project/assets/**`

## Background

Three kinds of asset live under `assets/`:

- `assets/components/**/<component_id>.teda` — the devices. It has **always** been a classification: a subdirectory there is "what this part is" (`passives`, `power`, `regulators`, `sensors`, `mcu`, `indicators`, `mechanical`), and the id is the file name, never the path ([ADR-0024](../devices/0024-the-device-kind-is-part-or-generic.md) D6). The directory is the only classification the tree has.
- `assets/symbols/<lib>/<symbol_id>.teda` and `assets/footprints/<lib>/<footprint_id>.teda` — the library artifacts. Their directory was a **library name** ("project", "vendor"), one flat folder per library, unrelated to what the file draws ([ADR-0031](0031-symbol-format.md) D1, [ADR-0030](0030-footprint-format-and-geometry.md) D3).

That second shape came from the two-provider model that was later withdrawn: with an external library a *template* rather than a dependency ([ADR-0034](0034-trust-in-a-library-you-do-not-own.md) D2), the project's assets are all its own, and a project ends up with one flat `project/` directory holding every symbol and every footprint. Sixteen symbols and sixteen footprints in one list is a list nobody browses — the review app showed exactly that, and the human answer was the one the components already had: **group them.**

The question is what to group them *by*, and the answer is not the same for the two kinds.

## Decision

### D1. The directory is a classification, not a library

`assets/<kind>/<dir>/<id>.teda` — the directory names a **class**, the id names the file, and the class never enters the id or the file content. This is the rule the component tree already had, extended to the other two kinds. The IR keeps storing the directory name (`symbol.library` / `footprint.library`); what changes is its meaning: a class, not a borrowed library.

### D2. The symbol uses the device's axis

A symbol is filed under the category of the devices it draws: `assets/symbols/passives/r.teda`, `assets/symbols/power/dual-diode.teda`, `assets/symbols/regulators/ldo-sot23-5.teda`. The axis is the **device category** — the same folders `assets/components/` uses — because a symbol is the way a device is drawn ([ADR-0031](0031-symbol-format.md) D2), and a reviewer looking for "the buck's symbol" looks under the buck's category.

One symbol may be shared by devices from different categories ([ADR-0031](0031-symbol-format.md) D1: one view, several devices). When that happens **the author picks one class**; the tool does not require the classes to agree, and a second copy is not the answer (a copy is a second fact).

### D3. The footprint uses an axis of its own: the package family

A footprint is filed under the **package family** it is: `assets/footprints/chip/chip-0402.teda`, `sot/sot-23-5.teda`, `soic/soic-8-ep.teda`, `lqfp/lqfp-100.teda`, `qfn`/`vqfn`, `crystal/crystal-3225-4.teda`, `inductor/ihlp-2525.teda`, `tantalum/tantalum-7343.teda`, `switch/switch-5x5-4.teda`.

This is deliberately **not** the device axis. A footprint is a physical fact: it knows pads, courtyard and silk, and it does not know what will be soldered to it — `chip-0402` is used by resistors and capacitors alike ([ADR-0027](../devices/0027-the-package-gives-a-chip-resistor-its-floor.md)). Filing it under "passives" would make a physical object's home depend on an electrical role, and a footprint used across categories would have the same conflict D2 avoids. The package family is the axis a footprint actually has.

The vocabulary is open, like the component one: the author names the class, the tool checks that the file sits exactly one directory deep and that the reference matches that directory.

### D4. A reference is `<classification>:<id>`

`component.symbol = "passives:r"`, `component.footprint = "chip:chip-0402"`. The qualifier keeps its *position* and changes its *meaning* (a class, not a library name); the parser's `<qualifier>:<id>` grammar is untouched. The KiCad export uses the same string as the library name, so one class directory exports as one `.kicad_sym` / `.pretty` library — a shape KiCad is happy with, and a smaller library table than one library per symbol.

### D5. It is a PATCH, and the migration is the author's

The accepted file set does not change: one file per id, exactly one directory under `assets/<kind>/`. What changes is what the directory is called and what a reference's qualifier means. A tool reading the old layout does not read it *wrongly* — the reference no longer resolves, and that is reported as an unknown device/symbol/footprint ([ADR-0038](../process/0038-implementation-stack-and-agent-entry.md) D7).

Moving the files and rewriting the qualifiers is a decision, not a rewrite: which class a symbol belongs to when it serves several device categories (D2), and which family a footprint is (D3), are the author's calls. `bun run migrate:0.9 <project dir>` keeps to the version lines only, as it always has. The reference project moved by hand in the same change.

### D6. Why not a declared field

A class could have been a key in the file (`class: passives`) instead of a directory. It is not, for three reasons: the component tree already made the directory the classification ([ADR-0024](../devices/0024-the-device-kind-is-part-or-generic.md) D6), so a second mechanism would be a second convention for the same fact ([ADR-0041](../process/0041-documentation-has-one-authority-per-fact.md)); a directory is a fact a person sees in `ls`, a checker can enforce without parsing, and `texteda lib import` can honour when it copies a template's tree; and a key would put a fact the tool does not interpret into the file, which is the kind of thing that later grows semantics.

## Consequences

- `assets/symbols/` and `assets/footprints/` each hold one directory per class, and a flat `project/` or `vendor/` directory is no longer a library — the class is the directory.
- The library loaders (`packages/cli/src/symbols.ts`, `packages/cli/src/pads.ts`) keep their shape: one directory down, one file per id. Their keys become `<class>:<id>`.
- The IR's `symbol.library` / `footprint.library` keeps its name and pattern; its description now says the value is the classification directory.
- The review app lists the library drawings grouped by class and folds the groups, which is what prompted this record ([ADR-0048](../view/0048-the-review-app-shows-drawings.md) D1); the model carries the class as `ReviewDrawing.group`, so the app sorts and folds by the same key the references use.
- `texteda lib import` files an imported symbol or footprint under the class the *template* declares, and asks the importer about its destination when the template has no class ([ADR-0034](0034-trust-in-a-library-you-do-not-own.md) D6).
- The pitfall recorded in `AGENTS.md` §7 stands: a class directory is not an electrical fact, and nothing may infer a symbol's or footprint's semantics from where it sits.
