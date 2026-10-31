# ADR-0038: Implementation Stack and the Agent's Entry Point

Status: Accepted
Date: 2026-10-21
Scope: Decides: the implementation stack, and the single entry point an agent uses — the generated contract reference and `texteda check`. Does not decide: what the checker enforces — see `spec/teda.md` §11.
Related: [ADR-0003](../01-language/0003-diagnostic-error-codes.md), [ADR-0039](0039-licensing-and-open-standard.md), [ADR-0041](0041-documentation-has-one-authority-per-fact.md)
Impact: `package.json`; `tsconfig.base.json`; `packages/ir/scripts/**`; `packages/ir/src/generated/**`; `docs/ir-reference.md`

## Background

Two questions were open for a long time and were settled within a day of each other.

**The stack.** The choice of implementation language had been hanging around, and three
requirements force the issue: cross-platform rendering (the same drawing has to come out in a CLI,
an editor webview, a browser, and CI); an IDE plugin (diagnostics, completion and
go-to-definition have to run inside an editor extension host); and 3D footprints (reading STEP,
triangulating, and viewing it interactively in a webview). The user settled on **Bun** as the
toolchain. Bun solves the CLI and the tests, but it is **not** an editor extension host (VS Code
and Electron are Node) and it is **not** a webview (a browser is). So what is decided here is the
"language + toolchain", not "Bun is the only runtime".

**The agent's entry point.** The main consumer of this project is agents. An agent has to locate
two things across a pile of files: **what a given IR field is and what its unit is** (today you
can only dig through the schema files — JSON is hard to grep — or read a decision record, which
describes conventions, not a field-by-field mapping); and **what is wrong with my project and how
do I fix it** (diagnostics have codes, but there is no single entry point that aggregates
"semantic-layer ERC + contract-layer schema validation" into one machine-readable result).

## Decision

### D1. TypeScript strict + ESM; Bun is the toolchain, not the only runtime

| Role | Runtime | Notes |
|---|---|---|
| CLI (`texteda`) and CI | **Bun** | `bun build --compile` produces a single-file binary; `bun test` runs the tests |
| IDE extension host | **Node ≥ 20** | VS Code and other LSP clients are all Node |
| Rendering and the 3D view | **browser / WebView** | the webview and the future web version share the same code |
| `packages/core` | **all three** | pure functions: they only take strings/bytes and never touch the filesystem, network, clock, or random sources |

Hard rules:

- `packages/core`, `packages/ir`, `packages/parser`, `packages/exporter` and `packages/renderer`
  **must not** use `Bun.*`, **must not** use Node built-ins other than `node:fs` / `node:path`
  (and those only in the CLI / export layer), and **must not** use `process.env`.
- All packages are ESM, `exports` points at ESM, and the browser can bundle them (no top-level
  side effects).
- Byte-level determinism does not depend on the runtime: the same input produces the same
  canonical JSON (and the same hash) on every runtime.

### D2. There is only one contract chain: JSON Schema → TS types; no zod

- The sole contract is still `schemas/ir/<version>/*.schema.json`.
- The runtime validator **consumes those schema files directly** (Ajv 2020-12, inlined as a constant
  at build time); there is no second copy of the validation code.
- TS types are generated from the schema (`json-schema-to-typescript`), and the output goes to
  `packages/ir/src/generated/`; CI checks that "regenerating produces no diff".
- **No zod.** The "zod and JSON Schema drift into two divergent definitions" worry disappears at
  the root, and the price is one more build step for type generation.

The mechanism difference between the two, written for later readers:

| | JSON Schema + Ajv | zod |
|---|---|---|
| How rules are written | a separate `.schema.json` file | TS code: `z.object({...})` |
| Runtime validation | Ajv reads that file | zod's own generated functions |
| TS types | **generated** from the schema | **inferred** from the code (`z.infer`), zero generation step |
| Cross-language | any language can read the same file | TS only |

zod v4 has `z.toJSONSchema()`, so "write it in zod, then export the schema for others" is feasible
— the price is that **the source of truth of the contract becomes TS code**, which conflicts with
"JSON Schema is the sole contract", and Rust/Python implementers have to read the generated
artifact instead of the source. If we ever want to switch, the correct way to switch is to amend
the IR-representation record and make zod code the source of truth, not to add another layer on top
of the existing structure.

### D3. Render layering: SVG is the sole authoritative derivative; bitmap and PDF are export-only

| Form | Ownership | Rationale |
|---|---|---|
| **SVG** (sch / pcb) | S1 / B1 authoritative derivative | text, diffable, hashable, displayable by any host |
| PNG / PDF | generated only at export time | converted from SVG (resvg / host capability), not committed to the repository |
| glTF (3D assembly) | B1 derivative | interactive viewing, triangulated from STEP |
| STEP | borrowed (component library / export) | we do not build our own geometry kernel |

All renderers obey `extract(render(ir)) == ir`; SVG output must be deterministic (same IR, same
bytes), otherwise "frozen artifact + hash" does not hold.

### D4. 3D: two paths, split by use case

| Use case | Means | Measured result |
|---|---|---|
| 3D snapshots in reports / CI | the external KiCad CLI | produces a 800×450 PNG in 0.036 s; **when no 3D model library is installed locally, only the bare board + silkscreen are produced** |
| Interactive viewing in a webview | OCCT WASM → triangulation → three.js | `replicad` + `replicad-opencascadejs` work under Bun: `makeBox` → `mesh` 72 vertices / 36 triangles; a 15 KB `blobSTEP` → `importSTEP` → re-triangulation passes |

**Routing decision (tiered by "does the runtime carry LGPL"):**

- **Path A (default): offline conversion to glTF.** STEP is converted to `.glb` at build time and
  stored as a project asset; at runtime only three.js (MIT) + `GLTFLoader` are present. The
  converter is a build-time dependency and does not enter the distribution → **no LGPL in the
  distribution**.
- **Path B: read KiCad `.wrl` directly.** The official 3D models are VRML, and three.js's
  `VRMLLoader` reads them directly → also zero CAD kernel.
- **Path C (fallback): convert STEP at runtime.** Only for vendor STEP models, using
  `occt-import-js` (7.3 MB, 3× smaller than replicad, 9× smaller than opencascade.js). The
  license level is the same as for the other OCCT options: **LGPL-2.1**.

**How to stay LGPL-compliant under wasm** (if we end up taking path C): the wasm is distributed as
a **separate file** alongside the package, loaded with a dynamic `import()` at runtime (not
statically merged into the bundle), its source is not modified, and the package ships the license
plus the corresponding source/build instructions. Meeting this satisfies LGPL's "replaceable,
re-linkable" requirement; the typical violation is stuffing the wasm binary into a single-file
bundle or rewriting it.

**Size budget**: the wasm only enters the 3D view, imported on demand; CLI cold start is
unaffected. 3D **does not participate in connectivity determination and does not write back to
the IR**.

### D5. The IR contract reference is generated from the schema, not hand-written

`docs/ir-reference.md` is generated by `bun run gen` from `schemas/ir/`, one line per field: type,
whether it is required, **unit**, description. The generator and the error-code document are two
outputs of the same script.

- The schema is the single source of truth; the document is a derivative (the same principle as
  the canonical JSON).
- The document **answers only two questions** (field type, unit) and does not restate the spec —
  that avoids a second copy of the spec that will drift. Behavioural semantics still come from
  `spec/`; the document only points.
- Fields missing a `description` are listed in the coverage list at the end of the document; filling
  them in is **writing the contract**, not writing documentation, so it is worth doing.
- **Union types must be expanded**: for a `oneOf` like `constraint`, the dimension fields live in
  the branches (`min_uv` / `max_na`). Rendering only the top-level `properties` would make the
  very fields people most want to look up unlookupable, so the generator emits a table per branch,
  with `type=` in the heading.
- **The generator must enable `unreachableDefinitions`**: adding a sibling `description` to a
  `$ref` makes the type generator **inline** that reference, and named types such as `Slug` /
  `NetOrPinRef` disappear from the type surface (measured: filling in descriptions once killed 6
  names, and the compiler only caught 1). With the flag on, every `$defs` produces a named type.

### D6. The dimension table is promoted to the IR layer

The canonical units of the IR are determined by field-name suffixes: `min_uv` is voltage in µV,
`value_mohm` is resistance in mΩ. This suffix table previously lived only in the parser, so the
generator could not use it. It is now promoted to `packages/ir/src/units.ts`:

- It describes the **convention for IR field names**, which is a contract, so it belongs in
  `packages/ir`;
- The parser and the generator share one copy (instead of each writing their own);
- `packages/ir` still has zero runtime dependencies (this table is pure data).

### D7. `texteda check` is the only check entry point

```text
texteda init <dir> [--force] [--name <project name>]
texteda compile <project dir> <board_id> [--json] [--out <file>] [--pcb]
texteda check <project dir> [--json]
texteda netlist <project dir> [--board <board_id>] [--json] [--out <file>]
```

`check` covers **all** boards in the project, parsing each board → semantic-layer ERC →
contract-layer schema validation.

- Diagnostics use the unified payload (code / severity / location / data); `--json` goes to
  stdout, the human-readable form goes to stderr.
- Exit code: 1 if there is an error, 0 if there are only warnings (warnings do not block the
  gate).
- A device file that cannot be read, and a device file whose header id does not match the file
  name, both count as errors.

**The contract stage covers every description the shard tree serialises.** `check` also *reads*
the project's symbols and footprints — the drawing and coverage checks need their geometry — and
validating only the board descriptions would let one gate say "fine" while the other refused the
same tree. So `check` applies parse and contract validation to every description the shard tree
serialises: devices, symbols, footprints, and the print page.

`compile` and `check` share the same project-reading layer, so layout knowledge lives in exactly
one place.

### D8. The file system is confined to the CLI layer

A compile script that used to live in the parser package moved to `packages/cli`: it is a user
command, not library code. Only the CLI / export layer may touch disk; leaving a command script in
a library package blurs the "library packages do not touch fs" boundary.

### D9. Diagnostics carry a stage: parse / contract / semantic

The output of `check` must let an agent tell "the description is broken" from "the design has
problems". The way to do that is to classify by **domain** into three stages, with `countsByStage`
in the payload.

The key point: **the stage does not need to be declared at the call site**. The domain vocabulary
is closed and a domain can only belong to one stage, so the mapping is a pure function
(`STAGE_BY_DOMAIN`) and not a single line at diagnostic creation needs to change.

### D10. Fix hints are registered in the registry

The "how to fix" of a diagnostic previously existed only at the call site — scattered and
unsearchable. Registry entries now carry a `hint` (how this code is usually fixed), while call
sites may still give a more specific wording; when the payload is assembled, take "call site
first, registry as fallback".

Every row of the generated error-code document therefore has a "how to fix" column, and an agent
that gets a code can act directly without hitting the error once first.

## What We Do Not Do

- **No generated SDK / client.** The IR is data (shape), the API is behaviour (parse / compile /
  validate / format / emit). Generating interfaces from the schema would conflate "which fields
  exist" with "what can be done", and with no second consumer yet the generated API has no
  stability pressure. What is needed is a small hand-written facade + CLI + LSP.
- **No ERC rules as a rule language.** The rules stay in code. What needs to change is the
  **boundary** — the rules gradually move out of the parser and into core, so that third parties
  can tell "the syntax implementation is wrong" from "the design has problems".
- **No LSP yet.** That comes after core has stabilized.

## Consequences

- **One bundle, three hosts.** The same packages run in the CLI, in an editor extension host, and
  in a browser, and the determinism does not depend on which.
- **The contract has exactly one source.** A schema file, validated by Ajv, turned into types by
  generation. A rule cannot be enforced by the validator and absent from the types, because they
  are the same file.
- **The generated reference is greppable.** An agent can look up a field and its unit in one
  command, and the answer cannot be stale.
- **`texteda check` is the one gate.** An agent does not have to know which command validates what.
- **Warnings do not block.** The exit code distinguishes "wrong" from "incomplete", so an agent
  can act on the first and note the second.
- **The 3D path is licence-clean by construction.** The default carries no CAD kernel at runtime.
