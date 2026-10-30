# ADR-0023: The Output Package Carries Its Own Provenance

Status: Accepted
Date: 2026-10-28
Scope: Decides: that an output package states the source hash and the tool version that produced it, so a package can be traced to the design it came from. Does not decide: what the package contains — see ADR-0021.
Related: [ADR-0006](../ir/0006-ir-shards-and-hashes.md), [ADR-0021](0021-the-manufacturing-output-path.md)
Impact: `spec/pcb.md` §8; `packages/exporter/**`; `packages/cli/src/export.ts`; `AGENTS.md` §2 invariant 11

## Background

The manufacturing output is a **delivered artifact**. A Gerber file, an Excellon drill file, a
BOM: they leave the project, get uploaded to a fabricator, and come back as physical boards.
Nothing in that chain can ask the project what it meant. A file on a fabricator's server has no
link to the design that produced it, and a project months later has no way to tell which build a
delivered board came from — except by remembering.

The repository already had the raw material for the answer. The IR layer computes a **project
hash** over the normative shards, and the exporter stamps that hash on every file it writes. What
was missing was the decision that made the stamp a **promise** rather than an implementation
detail, and the rules that make the promise checkable by whoever holds the package.

The question is worth its own record because it is the one place where a hash stops being an
internal consistency device and becomes an **external contract**. Everywhere else, a hash proves
that two things inside the project agree. Here, it has to let a stranger — the fabricator, the
auditor, the next engineer — answer "what is this, and does it match what we approved?".

## Decision

### D1. Every file of an output package carries the source hash and the tool version

Each file written by an export carries, in its own comment syntax:

```
G04 TextEDA 1.4.0*
G04 source 3f2a…*
```

(The Excellon drill file uses `;` comments for the same two lines.) The values are:

- **`source_hash`** — the **project hash** of the tree the export was projected from, not the
  board hash and not a per-file hash. The package as a whole is traceable to one build, and the
  build is the project.
- **`tool_version`** — the version of the exporter that produced the file. The exporter is part of
  the toolchain, and a file produced by a different exporter version is not the same artifact.

Both are written into every file, not into a manifest beside them. The reason is the delivery
chain: a fabricator's system takes the file and not the folder. A stamp in a sidecar is a stamp
that does not travel.

### D2. The stamp names the build, not the file

`source_hash` is the project hash, so every file in one package carries the **same** value. That
is deliberate:

- a package is one build, and a reader who sees two different hashes in one package is looking at
  a mixed delivery, which is exactly the situation the stamp exists to expose;
- the project hash covers everything the build depends on — the schematic, the PCB, the symbols,
  the footprints, the devices, the primary procurement selections — so the stamp answers "which
  design", not "which file";
- the board hash is not enough (it excludes the project's shared assets) and a per-file hash is
  too much (it says nothing about the design).

The **advisory** parts of the project — the procurement alternatives and the print pages — are not
in the project hash, and that is correct here too: a second source for a line and a moved label
do not change the board that was made.

### D3. A file that carries no stamp is not a product of this toolchain

The stamp is not decoration and not a best-effort annotation. A file produced by this project
always carries it, and a delivered package whose files do not carry it did not come from this
toolchain — or it was edited by hand after the fact.

That is the check the stamp enables: **a package can be traced to a build**. The project hash
computed today from the source tree must equal the hash stamped on the files. A mismatch says the
package is from a different design, or the design changed after the package was made.

### D4. The stamp is written at the last moment, from the tree that was actually read

The stamp is not an input to the export and not a value carried around. It is computed from the
same IR tree the export projected from, at the moment the files are written.

This matters because the export is a **projection**, and a projection can fail partway: a board
with a hole in it produces no files at all. If the stamp were computed earlier — say, when the
tree was built — a partial or refused export could still be handed a hash that says "this is a
good build". So a refusal writes no file, and the hash on the files that were written is the hash
of the tree they came from.

### D5. The stamp does not make the package reproducible by itself

Two files with the same stamp are the same **build**. They are not necessarily the same bytes:
the exporter's own version, and any nondeterminism in a downstream tool, are outside the stamp's
claim.

The export path is deterministic by construction — the same board produces byte-identical files —
and the project's own acceptance criterion says so. But the stamp's job is narrower: it identifies
the build, and it is the tool version that closes the gap between "the same build" and "the same
bytes".

### D6. The provenance travels with the derived artifacts too

The same rule applies to the other derived artifacts a project hands out:

- a rendered **page** carries the **page shard's own `sha256`** as its `source_hash` — the
  drawing is traceable to the exact file it was drawn from, without the drawing being part of the
  build identity;
- the **IR manifest** carries the tool version and the project hash it was computed from;
- the manufacturing **package** carries the project hash and the tool version, as above.

The rule that produces these is one rule: **a derived artifact states what it was derived from.**
Which value it states depends on what it was derived from — the project, the board, or the shard.

## Consequences

- **A delivered board can be traced.** The files carry the build they came from, and the next
  engineer can recompute that build's hash and compare.
- **A mixed delivery is visible.** Two hashes in one package is a fact on the face of the files.
- **The stamp travels.** It is inside the file, because the file is what leaves.
- **The exporter's version is part of the identity of its output.** A tool upgrade is visible in
  the artifacts it produced, not invisible in them.
- **A refused export leaves nothing behind.** No file means no false claim.
- **The stamp is a claim about the build, not about the bytes.** The two are close, and the tool
  version is what separates them.
- **The drawer's provenance follows the same rule**, at a different granularity: a drawing names
  the shard it came from, and a package names the project.
