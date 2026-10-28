# ADR-0129: Footprint Geometry and 3D Models Do Not Enter the Language; Our Own Footprint Format Is the Source

Status: Accepted
Date: 2026-10-20
Scope: Decides: that footprint geometry and 3D models do not enter the language, and that a self-built footprint library uses our own format with the KiCad format as an export artifact. Does not decide: the symbol format — see ADR-0130.
Related: [ADR-0127](../devices/0127-package-code-and-3d-models.md), [ADR-0130](0130-symbol-format.md), [ADR-0131](0131-the-reference-project-is-self-built.md), [ADR-0133](0133-trust-in-a-library-you-do-not-own.md)
Impact: `spec/footprint.md`; `packages/exporter/**`; `packages/parser` (the `footprint` description type); `docs/guides/footprint-authoring.md`

## Background

Two facts sit side by side.

**This project's boundary**: we are not a general component-library maintainer. The `component`
file records the part number, the symbol, the footprint and the pin table. Geometry is not in the
language.

**A new fact**: an agent needs only a few minutes to build a footprint from a datasheet, and
humans are hand-writing footprints doing the same thing. A "library" is no longer only an
external dependency borrowed from upstream; it can be **a project-owned artifact produced on the
spot**.

So the question becomes: now that footprints and 3D models can be produced on a whim, **should 3D
dimensions be written into `.teda`**, letting the board carry its own geometry? And if geometry
stays out, **what format does a self-built library use**?

The format question is answered by two measured facts about KiCad:

1. **KiCad imposes no library format.** In KiCad 6+ board files the footprint geometry is
   **inlined**: every `(footprint …)` block carries the full geometry with `fp_line` / `pad`, and
   `lib:name` is just a label. The library is read exactly once at export time; afterwards DRC,
   Gerber, and the placement file no longer need it.
2. **A missing library table only affects "lookup".** `lib_footprint_issues` appears when KiCad
   tries to look up the library by the `lib:name` prefix and `fp-lib-table` cannot find it. The
   geometry itself is in the board file and DRC still runs.

So the library format is **our own choice**, not something KiCad dictates. Since we have to choose,
we choose by this project's standing discipline: **the schema-ized canonical description is the
source of truth, the KiCad format is an export artifact**.

## Decision

### D1. Footprint geometry and 3D models do not enter the language

There are **no** fields in `.teda` for pad dimensions, courtyard, assembly outline, or 3D
dimensions, and none will be added. The reasons:

1. **Wrong ownership layer.** Footprint geometry is a property of the *device type* — the same
   0402 is the same geometry on ten boards — not a property of *this board*. Writing it into the
   board description is copying the library into every board, which is exactly an amplified
   version of the "duplicate description" pitfall: the same fact written twice, changed in one
   place and missed in another.
2. **The reference point already exists.** `component.footprint` is the single reference point to
   the geometry. The geometry should land in the library, not in the description.
3. **3D even less so.** STEP/WRL is CAD data, not diffable text. It is referenced by a pointer in
   the part file (see ADR-0127), and describing the model itself in the language would create a
   second source of truth. The exported KiCad footprint carries no model at all — the land pattern
   is 2D.
4. **Layering.** The 3D assembly view is a derived layer, free to change; board-level physical
   facts are not. The dimensions of the component body belong to the component library, not to
   board-level facts.

The dimensions that belong at board level are already in the language: `board_thickness`,
`stackup`, `rules` (clearance / trace width / solder mask / solder paste / thermal pad), the
coordinates and rotation of `place`, and the mounting holes and cutouts of `physical_only`. The
only thing missing was "which footprint does this board use", and that is given by
`component.footprint`.

### D2. Mechanics and structure do not enter the language

Cross-domain constraints such as enclosure interference, connector mating space, and cooling
airflow do not enter `.teda`: this project does not describe an enclosure. If they are ever to be
expressed, they need a separate `structure` description layer and a decision record of their own;
they must **not** be stuffed into the `pcb` description as a patch. `physical_only` in `pcb` only
covers in-board entities (mounting holes, fiducials, test points, stitching vias, cutouts).

### D3. The source of truth of a self-built library is `.teda` source code

One footprint per file: `assets/footprints/<lib>/<footprint_id>.teda`. The library name is
determined by the directory and is not part of the file content. The syntax is described in
`spec/footprint.md`.

**Why not writing JSON directly.** The IR-representation record says outright that agents do not
read IR directly; the agent's working surface is the `.teda` source plus a validation report.
Libraries are the thing agents will mostly author (datasheet → footprint), so their working
surface must be `.teda` just like for board descriptions; otherwise the same job ends up with two
authoring experiences and two diagnostic systems — and JSON can only report a path, with no line
or column.

**The compiled artifact is an IR shard.** The parser compiles `.teda` into IR of the `footprint`
kind, and unit conversion happens only at this layer: length → integer nanometers, angle → integer
millidegrees, ratio → integer ppm (the IR forbids floats).

### D4. The KiCad format is an export artifact

The exporter writes two kinds of artifact:

- **A standalone `.kicad_mod`**, placed into a `<lib>.pretty/` directory, used by KiCad as an
  ordinary library — a human can browse it, edit it, and put it into the global library table;
- **An inline block in the board file**, because the board carries the geometry directly
  (consistent with KiCad's own practice).

Both artifacts share the same body generation logic, so "the footprint in the library and the
footprint on the board disagree" cannot happen.

**The library table still has to be written**, pointing at the **generated** `.pretty` directory
(`dist/footprints/<lib>.pretty`, using the `${KIPRJMOD}` relative path). It is KiCad's lookup
entry point; without it every footprint is reported as `lib_footprint_issues`. This was measured
in the first trial run, and it is a hard requirement for the interoperation path, not a nicety.

### D5. Two library providers, the same reference shape

- **Borrowed**: the KiCad official libraries and other `.pretty` directories, locked by the
  upstream revision.
- **Self-built**: our own directory of `.teda` sources.

The `lib:name` in `component.footprint` is the same for both, and so are the validation and the
reference shape; the only difference is "how to resolve `lib:name` into geometry".

That two-provider shape was later withdrawn together with the library-dependency layer: an
external library is today a **template**, copied in once by `texteda lib import` and then owned by
the project (see ADR-0133). A project therefore has one source of geometry — its own `assets/`
tree — and the provider abstraction has nothing left to abstract. What survives is the reference
shape and the two-kinds distinction in the *authoring* sense: a library may be borrowed or written
here, and the second is a first-class artifact.

### D6. The project's self-built footprint library is a first-class artifact

A self-built library is not a lesser copy of a borrowed one. It has a schema, a canonical form, a
readable diff, and an exported artifact. The consequence that matters is **self-sufficiency**: a
project can be entirely self-sufficient, and the official libraries are only a convenience. That
is decisive for "an agent completes a board on its own" — provided footprints can be generated
automatically and checked.

**A library with two roots.** A self-built library provides both symbols and footprints, and the
two share the same `<lib>:` namespace, so a library entry may name a `symbols` root and a
`footprints` root.

### D7. The checks that generated footprints must pass

The tools (checker and, on the interoperation path, KiCad DRC) are responsible, not manual review:

1. The footprint exists, the library table is parsable, and `lib:name` resolves to a concrete
   footprint;
2. **the pad number set covers the schematic pin number set**: one missing → error; one extra →
   warning;
3. Pad geometry passes DRC (clearance / solder mask / solder paste);
4. The assembly level (courtyards not overlapping, the 3D model consistent with the footprint
   origin and orientation) belongs to the **derived** checks, looked at through the 3D preview; it
   does not enter the language and does not enter the IR.

### D8. The supported geometry range, and the gaps that are not force-fitted

Supported: pads (`smd` / `th`; `rect` / `roundrect` / `oval` / `circle`; position, size, drill,
layer set, corner radius ratio, solder mask and solder paste expansion, connection type, thermal
pad gap width), graphics (`line` / `rect` / `circle` / `arc` / `poly`, with layer and line width),
text and attributes (`Reference` / `Value` / arbitrary fields), and a **single** 3D model
reference.

Not supported: custom pad shapes (custom + primitives), cutouts and slots, multi-layer nesting,
multiple 3D models, stacked footprints. The gaps are not force-fitted.

### D9. IR ordering depends only on semantics

`pads` are in natural order, `graphics` by `(kind, layer, coordinates)`, `fields` by name, `tags`
in byte order. The same footprint with reordered entries, changed units, or a changed key order
compiles to IR **byte-identical** to the canonical source, and the exported artifacts are
identical too.

### D10. The formatter is a fixed point of the source

`fmt` only reorders the surface (line and key order, column alignment, unit normalization) and
refuses to format when there are semantic errors — consistent with `gofmt`. The example file is a
fixed point of `fmt`, and the smoke script checks that in its first step, to keep the source file
from drifting.

### D11. A 3D model belongs to a part, not to a footprint

The original placement of 3D models was amended: **a land pattern is vendor-independent, a body
is not.** The same `sot-23-5` land pattern is used by parts from many manufacturers, each with its
own body; putting the model on the footprint would force one body onto every part that shares the
land pattern. So the model is referenced by the part, and the footprint stays purely 2D.

What this record decided about models still holds: a model is a **reference to a CAD file**, never
dimensions in the language.

## Consequences

- **The language surface is unchanged.** No fields are added to `.teda` for geometry; the parser
  and the IR contract are untouched by this decision.
- **A self-built library is a schema, not a directory of opaque files.** The agent writes `.teda`,
  gets line-and-column diagnostics, and the diff is readable.
- **Reproducibility follows from the source.** The same footprint source produces the same IR and
  the same exported artifacts, byte for byte.
- **A project can be entirely self-sufficient.** The official libraries are a convenience, not a
  dependency.
- **The assembly level is checked by tool, not by eye.** The generator's output is verified by
  the same checks as anything else, and the 3D preview is where the human looks.
- **3D still does not participate in any determination.** It is an input for review and assembly
  checks; it does not participate in connectivity and does not write back to the IR.
- **A KiCad version bump does not affect the source of truth.** It changes the exporter.
- **The geometry gaps are named.** What the format does not cover is written down, so a user
  knows to hand-write a `.kicad_mod` rather than waiting for the format to grow.
