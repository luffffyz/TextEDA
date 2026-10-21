# ADR-0009: Implementation Stack (TypeScript + Bun), Render Layering, and the IDE Integration Surface

Status: Accepted
Date: 2026-10-20
Impact: `AGENTS.md` §1.1, §8, §9, §11 rule 13, §12; decision 2 of `docs/adr/0004-ir-representation.md`; `schemas/ir/`

## Background

`AGENTS.md` §11 rule 13 (Rust or Python/TS) has been hanging around for a long time. Three requirements now force the issue:

1. **Cross-platform rendering**: the same drawing has to come out in a CLI (terminal host), an editor webview, a browser, and CI.
2. **IDE plugin**: diagnostics, completion, and go-to-definition have to run inside an editor extension host.
3. **3D footprints**: reading STEP, triangulating, and viewing it interactively in a webview.

The user has settled on **Bun** as the toolchain. Bun solves the CLI and the tests, but **it is not** an editor extension host (VS Code/Electron are Node) and **it is not** a webview (a browser is). So what is decided here is the "language + toolchain", not "Bun is the only runtime" — that distinction goes into decision 1 below, otherwise the first plugin will end up containing code that only runs under Bun.

## Decision

### 1. TypeScript strict + ESM; Bun is the toolchain, not the only runtime

| Role | Runtime | Notes |
|---|---|---|
| CLI (`textEDA`) and CI | **Bun** | `bun build --compile` produces a single-file binary; `bun test` runs the tests |
| IDE extension host | **Node ≥ 20** | VS Code and other LSP clients are all Node |
| Rendering and the 3D view | **browser / WebView** | the webview and the future web version share the same code |
| `packages/core` | **all three** | pure functions: they only take strings/bytes and never touch the filesystem, network, clock, or random sources |

Hard rules:

- `packages/core` and `packages/ir` **must not** use `Bun.*`, **must not** use Node built-ins other than `node:fs`/`node:path` (fs/path are only allowed in the CLI/export layer), and **must not** use `process.env`.
- All packages are ESM, `exports` points at ESM, and the browser can bundle them (no top-level side effects).
- Byte-level determinism does not depend on the runtime: the same input produces the same canonical JSON (and the same hash) on every runtime.

### 2. There is only one contract chain: JSON Schema → TS types; no zod

This revises the zod part of [ADR-0004](0004-ir-representation.md) decision 2:

- The sole contract is still `schemas/ir/<version>/*.schema.json`.
- The runtime validator **consumes those schema files directly** (Ajv 2020-12, inlined as a constant at build time); there is no second copy of the validation code.
- TS types are generated from the schema (`json-schema-to-typescript`), and the output goes to `packages/ir/src/generated/`; CI checks that "regenerating produces no diff".
- **Conclusion: no zod.** The "zod and JSON Schema drift into two divergent definitions" worry from [ADR-0004](0004-ir-representation.md) disappears at the root, and the price is one more build step for type generation.

  The mechanism difference between the two (written for later readers):

  | | JSON Schema + Ajv | zod |
  |---|---|---|
  | How rules are written | a separate `.schema.json` file | TS code: `z.object({...})` |
  | Runtime validation | Ajv reads that file | zod's own generated functions |
  | TS types | **generated** from the schema (`json-schema-to-typescript`) | **inferred** from the code (`z.infer`), zero generation step |
  | Cross-language | any language can read the same file | TS only |

  zod v4 has `z.toJSONSchema()`, so "write it in zod, then export the schema for others" is feasible — the price is that **the source of truth of the contract becomes TS code**, which conflicts with [ADR-0004](0004-ir-representation.md)'s "JSON Schema is the sole contract", and Rust/Python implementers have to read the generated artifact instead of the source. If we ever want to switch, the correct way to switch is **to amend [ADR-0004](0004-ir-representation.md) and make zod code the source of truth**, not to add another layer on top of the existing structure.

### 3. Render layering: SVG is the sole authoritative derivative; bitmap/PDF are export-only

| Form | Ownership | Rationale |
|---|---|---|
| **SVG** (sch / pcb) | S1 / B1 authoritative derivative | text, diffable, hashable, displayable by any host (the CLI can convert it, the webview displays it directly, the browser opens it directly) |
| PNG / PDF | generated only at export time | converted from SVG (resvg / host capability), not committed to the repository |
| glTF (3D assembly) | B1 derivative | interactive viewing, triangulated from STEP |
| STEP | borrowed (component library / export) | we do not build our own geometry kernel |

All renderers obey `extract(render(ir)) == ir` (§2 rule 4); SVG output must be deterministic (same IR, same bytes), otherwise "frozen artifact + hash" does not hold.

### 4. 3D: two paths, split by use case (measured)

| Use case | Means | Measured result |
|---|---|---|
| 3D snapshots in reports/CI | `kicad-cli pcb render` | KiCad 10 has that command; 800×450 PNG, rendered in 0.036 s. **When no 3D model library is installed locally, only the bare board + silkscreen are produced** (measured: copper and silkscreen inside the box, no component bodies) |
| Interactive viewing in a webview | OCCT WASM → triangulation → three.js | `replicad@1.1.0` + `replicad-opencascadejs@1.1.0` work under Bun: `makeBox` → `mesh` 72 vertices / 36 triangles; `blobSTEP` 15 KB → `importSTEP` → re-triangulation passes |

#### Licensing and alternatives (measured, 2026-10-20)

In the JS ecosystem **everything that can read STEP embeds OCCT**, so switching packages does not change the license level; the real difference is "whether to carry a CAD kernel at runtime":

| Option | License | Size | Measured |
|---|---|---|---|
| `replicad` + `replicad-opencascadejs@1.1.0` (maintained 2026-09) | MIT wrapper + **LGPL-2.1-only** OCCT | wasm 22 MB | Works under Bun: `makeBox` → `mesh` 72 vertices / 36 triangles; `blobSTEP` 15 KB → `importSTEP` → re-triangulation passes |
| `occt-import-js@0.0.23` (import only: STEP/IGES/BREP → mesh) | **LGPL-2.1** | wasm **7.3 MB** | Works under Bun: the same STEP → 1 mesh, 24 vertices / 12 triangles |
| `opencascade.js@1.1.1` (2020-09, stalled) | LGPL-2.1-only | 66.7 MB | Not tested; only `2.0.0-beta.*` is being worked on |
| `three@0.186` + `GLTFLoader` / `VRMLLoader` | MIT | — | KiCad's bundled `.wrl` models can be read directly, no CAD kernel needed |
| `manifold-3d@3.5` | Apache-2.0 | 2.8 MB | pure geometry/CSG, **does not read STEP** |
| `kicad-cli pcb render` (external program) | KiCad itself GPL-3.0 | — | only invoked, not linked, not redistributed |

**Routing decision (tiered by "does the runtime carry LGPL"):**

- **Path A (default): offline conversion to glTF**: STEP is converted to `.glb` at build time and stored as a project asset; at runtime only three.js (MIT) + `GLTFLoader` are present. The converter is a build-time dependency and does not enter the distribution → **no LGPL in the distribution**.
- **Path B: read KiCad `.wrl` directly**: KiCad's official 3D models are VRML, and three.js's `VRMLLoader` reads them directly → also zero CAD kernel.
- **Path C (fallback): convert STEP at runtime**: only vendor STEP models need this, using `occt-import-js` (7.3 MB, 3× smaller than replicad, 9× smaller than opencascade.js). The license level is the same as for the other OCCT options: **LGPL-2.1**.

**How to stay LGPL-compliant under wasm** (if we end up taking path C): the wasm is distributed as a **separate file** alongside the package, loaded with a dynamic `import()` at runtime (not statically merged into the bundle), its source is not modified, and the package ships the license plus the corresponding source/build instructions. Meeting these satisfies LGPL's "replaceable, re-linkable" requirement; the typical violation is stuffing the wasm binary into a single-file bundle or rewriting it.

- **Size budget**: the 7.3 MB wasm only enters the 3D view, imported on demand; CLI cold start is unaffected.
- 3D **does not participate in connectivity determination and does not write back to IR** (§2 rules 2, 3). Mirror/assembly checks only look at geometry.

### 5. IDE integration surface: LSP is the only entry point, the plugin is a thin shell

- Language service = **LSP over stdio**: diagnostics (following the `file:line:col: severity code: message` format of `teda.md` §11), completion, hover, go-to-definition, formatting (`fmt`).
- Graphics and 3D go through a **webview** consuming `dist/ir/` (or an LSP extension request); **the plugin does not parse `.teda` itself**.
- The VS Code extension comes first; other IDEs reuse the same LSP; we do not write a separate set of semantics per IDE.
- A second semantic implementation is forbidden inside the plugin: the diagnostic texts come from the core checker, and the plugin only presents them.

### 6. Repository structure (target, replacing the placeholder in AGENTS.md §9)

```
textEDA/
├── packages/
│   ├── ir/         # schema → TS types + Ajv validation
│   ├── core/       # parser → IR → checks (pure functions)
│   ├── render/     # SVG (sch / pcb)
│   ├── exporter/   # KiCad / netlist / BOM (calls kicad-cli)
│   ├── lsp/        # language service
│   ├── cli/        # textEDA command (compiled with Bun)
│   └── vscode/     # VS Code extension (thin shell)
├── schemas/ir/     # the contract (sole source of truth)
├── tests/          # unit + conformance + binding + round-trip + schemas
└── examples/       # reference project + ten cases
```

## Consequences

- **core must not cut corners with Bun APIs**: in exchange, the plugin and the web version do not have to rewrite the core; the price is that the core layer can only use standard APIs (`TextEncoder`, `URL`, `structuredClone`…).
- **No zod**: one less dependency and one less consistency test suite; the price is that type generation enters the build chain and the generated artifacts have to go through CI's "no diff" check.
- **SVG first**: bitmaps/PDF are the export layer's business; "rendering" itself has only one authoritative form; the price is that fancy effects (shadows, gradients) cannot just be added via canvas APIs.
- **3D is an optional dependency**: neither the 22 MB wasm nor the KiCad 3D model library enters the main path; the price is that "what you see in 3D" depends on the availability of external model libraries (local measurements have already exposed this).
- **The LGPL boundary**: the default paths (A/B) carry no LGPL in the distribution; on path C the 3D package may only be dynamically loaded, neither modified nor merged — this restriction must be enforced in the packaging script, otherwise the license is silently violated.
- **STEP import capability is deferred to path C**: the price is that vendor STEP models need one offline conversion before live preview (a build-time step).

## Addendum (2026-10-21): how the target structure actually landed

Decision 6 records a **target**; the repository has since diverged from it in three ways, all settled by other ADRs and the code. The authoritative current tree is `AGENTS.md` §9; this addendum records the delta so the target above is not mistaken for the current state:

|Target in decision 6|What landed|Why|
|---|---|---|
|`render/`|`packages/renderer/` (`@texteda/renderer`)|[ADR-0014](0014-reference-renderer.md) created the package under this name; the directory is the real one, so the target spelling was corrected to match|
|—|`packages/parser/` (`@texteda/parser`) — `.teda` → IR for footprint / symbol / schematic / page, plus `fmt`|Not in the target tree at all; it is the front half of what decision 6 called `core/` ("parser → IR → checks")|
|`core/` = "parser → IR → checks"|`packages/core/` (`@texteda/core`) = **pure rules only**: connectivity ERC and sch↔pcb binding checks, no parsing|[ADR-0019](0019-agent-contract-reference-and-check-entry.md) split it: the CLI needs parsing, the browser / IDE needs the rules without the parser. Parsing moved to `parser/`, so `core/` is now the browser-safe half|
|`lsp/`, `vscode/`|**not built yet**|Still planned; see `AGENTS.md` §9|

The other half of the split is the reason `packages/core` must not use `Bun.*` or `process.env` (decision 1): it is the one package that has to run in the browser, in the Node extension host, and in Bun. `packages/parser` and `packages/cli` may touch the filesystem.

## Follow-up

- ~~Build orchestration for `packages/`~~ **Settled (landed with `@texteda/ir`)**: bun workspace + TS project references; `packages/ir` generates `src/generated/{schemas.ts,types/*.ts}` from `schemas/ir/<version>/`, `bun run gen` writes and `bun run gen:check` only compares; contract validation uses Ajv consuming the schema directly, and the types are generated by `json-schema-to-typescript`.
- The build artifacts and the release form of the remaining packages (core / render / exporter / lsp / cli / vscode) are decided when the second package lands.
- The determinism requirements for SVG (float quantization, `id` generation) have to be written into the renderer specification, otherwise "same IR, same bytes" is just a slogan. The font question is settled: a bundled Hershey stroke font draws text as paths and does not depend on system fonts ([ADR-0014](0014-reference-renderer.md) decision 4).
- The environment convention that `kicad-cli pcb render` depends on a 3D model library (`KICAD*_3DMODEL_DIR` or carried with the project) has to be spelled out in the export documentation.
- Whether the STEP → glTF conversion for 3D is pre-generated offline (into `dist/`) or done live in the webview depends on the loading experience of 22 MB; measured in the next round.
