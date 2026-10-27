# ADR-0011: Self-Built Footprint Libraries Use Our Own Format; the KiCad Format Is an Export Artifact

Status: Accepted
Date: 2026-10-20
Impact: [ADR-0010](0010-footprint-and-3d-model-ownership.md) decision 2 (the format part is superseded by this ADR); `schemas/ir/v0.1/footprint.schema.json` (new IR kind `footprint`); new `packages/exporter`; `examples/reference-project/assets/footprints/`; `docs/footprint-authoring.md`; `AGENTS.md` §4.5, §9, §11

## Background

[ADR-0010](0010-footprint-and-3d-model-ownership.md) settled that "geometry does not enter `.teda`" and left "what format should a self-built library use" as an open question. This ADR answers it.

Two measured facts decide the answer:

1. **KiCad imposes no library format**. In KiCad 6+ board files the footprint geometry is **inlined**: in `docs/trial-run/charger-buck/charger-buck.kicad_pcb` every `(footprint …)` block carries the full geometry with `fp_line` / `pad`, and `lib:name` is just a label. The library is read exactly once at export time; afterwards DRC, Gerber, and the placement file no longer need the library.
2. **A missing library table only affects "lookup"**. `lib_footprint_issues` appears when KiCad tries to look up the library by the `lib:name` prefix and `fp-lib-table` cannot find it (hit during the first trial run, recorded in `docs/kicad-pcb-format.md`). The geometry itself is in the board file and DRC still runs.

So the library format is **our own choice**, not something KiCad dictates. Since we have to choose, we choose by this project's standing discipline: **the schema-ized canonical description is the source of truth, the KiCad format is an export artifact** (isomorphic to [ADR-0003](0003-agent-first-pcb-ir.md) "IR is the sole source of truth, rendering is a derivative").

## Decision

1. **The source of truth of a self-built library is `.teda` source code**, with the syntax described in `spec/footprint.md` (the `footprint` description type, v0.4). One footprint per file: `assets/footprints/<lib>/<footprint_id>.teda`; the library name is determined by the directory and is not part of the file content.
   - **Why not writing JSON directly**: [ADR-0004](0004-ir-representation.md) decision 5 says outright that "agents do not read IR directly; the agent's working surface is the `.teda` source plus a validation report". Libraries are the thing agents will mostly author (datasheet → footprint), so their working surface must be `.teda` just like for board descriptions; otherwise the same job ends up with two authoring experiences and two diagnostic systems (JSON can only report a path, with no line/column).
   - **The compiled artifact is an IR shard**: `packages/parser` compiles `.teda` into IR of the `footprint` kind (contract `schemas/ir/v0.1/footprint.schema.json`), and unit conversion happens only at this layer: length → integer nanometers, angle → integer millidegrees, ratio → integer ppm (the IR forbids floats, [ADR-0004](0004-ir-representation.md) decision 3).
2. **The KiCad format is an export artifact**. The exporter (`packages/exporter`) writes two kinds of artifact:
   - **A standalone `.kicad_mod`**: placed into a `<lib>.pretty/` directory, used by KiCad as an ordinary library (a human can browse it, edit it, and put it into the global library table in KiCad);
   - **An inline block in the board file**: the board carries the geometry directly (consistent with KiCad's own practice).
   Both artifacts share the same body generation logic, so "the footprint in the library and the footprint on the board disagree" cannot happen.
3. **Two library providers, the same reference shape**:
   - borrowed: the KiCad official libraries and other `.pretty` directories, locked by the upstream `rev`/`version`;
   - self-built: our JSON directory, locked by **content hash** ([ADR-0010](0010-footprint-and-3d-model-ownership.md) decision 2).
   The `lib:name` in `component.footprint` is the same for both, and so are the validation and hashing rules; the only difference is "how to resolve `lib:name` into geometry".
4. **`fp-lib-table` still has to be written**, pointing at the **generated** `.pretty` directory (`dist/footprints/<lib>.pretty` inside the project, using the `${KIPRJMOD}` relative path). It is KiCad's lookup entry point; without it you get `lib_footprint_issues`.
5. **The geometry range supported in v0.1**: pads (`smd`/`th`; `rect`/`roundrect`/`oval`/`circle`; position, size, drill, layer set, corner radius ratio, solder mask/solder paste expansion, connection type, thermal pad gap width), graphics (`line`/`rect`/`circle`/`arc`/`poly`, with layer and line width), text and attributes (`Reference`/`Value`/arbitrary fields), and a **single** 3D model reference.
   **Not supported yet**: custom pad shapes (custom + primitives), cutouts/slots, multi-layer nesting, multiple 3D models, stacked footprints. The gaps are not force-fitted: in a self-built library you can hand-write a `.kicad_mod` as a fallback (it is simply not governed by the schema, and the tool treats it as an "unmanaged file").
6. **What does not change**: geometry still **does not enter the `.teda` description** ([ADR-0010](0010-footprint-and-3d-model-ownership.md) decision 1 unchanged); 3D still does not participate in connectivity determination and does not write back to IR (`AGENTS.md` §2 rules 2, 3).

## Consequences

- **The benefit**: a self-built library has a schema, a canonical form, a content hash, and a readable diff; the agent writes JSON instead of S-expressions, which can be validated and can be traced down to the offending field; a KiCad version bump does not affect the source of truth.
- **The cost**: one more exporter to maintain, and it has to wrestle with the dialect details of KiCad. The pitfalls already hit are written into code comments and tests: `(tags …)` must be **a single** quoted string (write it as several strings and KiCad refuses to load the whole library); `(zone_connect 2/1/0)` corresponds to solid/thermal/none.
- **Two kinds of library coexist**: borrowed libraries are still in the KiCad format. Isolate them behind a "library provider" abstraction — the reference point, the checks, and the locking mechanism are the same for both, only the resolver differs.
- **It works end to end** (`bun run smoke:footprint`, measured): the example footprint (`examples/reference-project/assets/footprints/project/sot-23-5.teda`) → compiled to IR (the contract passes) → `.kicad_mod` → KiCad 10 can parse it (`kicad-cli fp export svg` produces an image) → inlined into the board → `kicad-cli pcb drc` **0 violations** → `kicad-cli pcb export gerbers` produces all 18 files.
- **One more parser**: `packages/parser` (line-level lexing + unit conversion + `footprint` surface parsing + canonical JSON writing + `fmt`). The line-level lexer and the diagnostic format are written per `teda.md` §3–§4 and §11; the general `.teda` parser reuses the same set later.
- **IR ordering depends only on semantics as well** (measured): `pads` in natural order, `graphics` by `(kind, layer, coordinates)`, `fields` by name, `tags` in byte order; the same footprint with reordered entries, changed units, or a changed key order compiles to IR **byte-identical** to the canonical source, and the exported artifacts are identical too. The property verification script has been run: `fmt` is idempotent, the semantics are unchanged, the `.kicad_mod` is unchanged.
- **`fmt` works** (measured): `bun run fmt:teda --check examples/reference-project/assets/footprints/project/sot-23-5.teda` exits 0; the example file is a fixed point of `fmt`. `fmt` only reorders the surface (line/key order, column alignment, unit normalization) and refuses to format when there are semantic errors (consistent with gofmt). The smoke script checks this in its first step, to keep the source file from drifting.

## Follow-up

- Whether **symbols** should be handled the same way (a self-built symbol library described in `.teda`, exporting `.kicad_sym`) — undecided, see `AGENTS.md` §11 question 3.
- Custom pad shapes, cutouts, multiple 3D models, stacked footprints.
- `packages/exporter` currently only handles footprints; the sch/pcb writers are not in the repository yet (the exporter of the first trial run was a one-off script).

## Addendum (2026-10-27): the library model was replaced by the template model

[ADR-0047](0047-an-external-library-is-a-template-not-a-dependency.md) decision 7 withdrew the
library-dependency layer this record's decisions 3 and 4 describe. It named three affected records
(0008, 0023, 0027) and not this one, so the subtraction is recorded here.

- **D3 (line 29) "a self-built library is our JSON directory, locked by `content_hash`"** and
  **line 38 "a content hash"**: there is no `content_hash` and no `bun run lib:hash`. A project's
  own assets enter the build identity as normative shards; library content is `.teda` sources under
  `assets/`. The `[libs]` table and `libref` were withdrawn with it (`spec/teda.md` §13.4).
- **Line 40 "two kinds of library coexist … isolate them behind a library-provider abstraction"**:
  an external library is today a **template**, copied in once by `texteda lib import` and then owned
  by the project. This is how every external library is used, whatever its origin — an official one,
  a company-internal one, a third party's: none is a build-time dependency, so `external/libs/**` is
  not read and a qualified `<lib>:<id>` device reference is an error
  (`ref.library-qualified-id`). There is no provider abstraction to build.
- **The "symbols should be handled the same way — undecided" open point** was decided the same day
  by [ADR-0012](0012-symbol-description.md): self-built symbol libraries in `.teda`, `.kicad_sym` as
  the export artifact. `AGENTS.md` §11 question 3 is closed.
- **Line 50 "the exporter currently only handles footprints"**: `packages/exporter` now also writes
  symbols (`.kicad_sym`) and, past this record's scope, netlists, Gerber and Excellon. The second
  half still holds — there is no `.kicad_sch` / `.kicad_pcb` writer (`docs/backlog.md` F15/F16).
