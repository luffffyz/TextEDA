# ADR-0018: Zero-Dependency Principle and the Target Form of the Manufacturing Output

Status: Accepted
Date: 2026-10-21
Impact: `AGENTS.md` §1 / §2 (new invariant 20) / §8 / §10 / §11, `scripts/verify-libs.ts` (split into a mandatory tier and an optional tier), `package.json` (new `lib:verify:kicad`), the positioning of `docs/adr/0005-manufacturing-output.md`, `docs/backlog.md` F14 / F15

**Amendment (2026-10-26, [ADR-0053](0053-layout-and-routing-are-agent-driven.md))**: the
agent-facing layout/routing loop needs its own geometric DRC subset (clearance, width, via,
keepout, edge, unrouted). That subset is our code and remains on the zero-dependency path.
KiCad DRC stays an **optional cross-check/oracle**, never the gate. CAM-level DFM judgement is
still borrowed; this amendment does not change that boundary.

## Background

Three facts stack up before this ADR can exist.

**First, [ADR-0005](0005-manufacturing-output.md)'s manufacturing-output decision was built on a wrong estimate.** What it said back then was "do not build our own Gerber / Excellon writer, borrow `kicad-cli`". The real reason was that **we did not know how much work it would be**, not that self-building was wrong in principle. Later, when the self-built symbol and footprint libraries landed ([ADR-0011](0011-library-format-and-footprint-ir.md) ~ [ADR-0013](0013-reference-project-self-built-libraries.md)), the facts corrected that estimate: writing a library yourself was not as hard as imagined, and "borrowing" was a temporary choice made out of missing information, not a conclusion. Since the estimate changed, the decision has to be reopened.

**Second, the real objection was never workload — it is dependencies.** A textual hardware description language that requires a whole EDA suite to run is just a precondition script for that EDA, not an independent thing. TextEDA should reach the point where: **install TextEDA and you can walk the whole "describe → check → render → manufacturing package" path**; KiCad is an optional integration, not a premise.

**Third, the repository already contains a hard dependency today, and it is hidden inside the "gate".** `bun run lib:verify` calls `kicad-cli` directly for three things: `sym upgrade` (verify KiCad can read our symbol libraries), `fp export svg` (verify it can read footprints), and `pcb drc` (verify the merged board has 0 DRC violations). In this repository that is described as the threshold of a "library closed loop", that is, **a check that must pass before a commit**. The result: without KiCad installed locally you cannot pass the full check — **TextEDA does already depend on KiCad today**, and the dependency sits in the least noticeable place.

Two things that were already done right, confirmed along the way: the core packages (`ir` / `parser` / `exporter` / `renderer`) have no **external tool** dependency of their own — the only third-party runtime dependency in the whole tree is `ajv` in `packages/ir` (the schema validator, authorized by [ADR-0009](0009-implementation-stack.md) decision 2; everything else is a workspace-internal `@texteda/*` dependency) — and the reference renderer is **our own** implementation, producing images without borrowing KiCad and without depending on system fonts ([ADR-0014](0014-reference-renderer.md), `scripts/preview.ts`). In other words, **in terms of capability we have been zero-dependency all along; the gate definition simply missed it**.

## Decision

### 1. The Core Path Has Zero External Dependencies; KiCad Is Demoted to an Optional Backend

- The **mandatory path** = source → IR → check → render / own export, all done by code in this repository, with zero external tools. Extending [ADR-0009](0009-implementation-stack.md) decision 1: the core packages must not take on third-party runtime dependencies, **with one authorized exception** — `packages/ir` depends on `ajv` for schema validation ([ADR-0009](0009-implementation-stack.md) decision 2). Everything else in the tree depends only on workspace-internal `@texteda/*` packages.
- **KiCad is an optional backend** with three jobs: interoperability export (`.kicad_sch` / `.kicad_pcb`), cross-validation of third-party implementations (its read-in and DRC), and a fallback path for the manufacturing output. **Without installing KiCad, TextEDA remains fully usable.**
- **No gate may depend on KiCad.** The correctness of a gate comes from this repository's contracts and rules; KiCad's read-in and DRC are **cross-validation** (a third-party implementation accepts us), not "the premise of our existence". Treating the latter as the former writes third-party tool acceptance into our definition of correctness.

Landing (done in this commit): `scripts/verify-libs.ts` is split into two tiers.

|Command|Content|Needs KiCad|
|---|---|---|
|`bun run lib:verify`|Component references resolve, no external library prefixes, symbol pin-number set == component pin-number set, footprint pad-number set ⊇ component pin-number set, canonical form, compiles to IR and passes the contract, export succeeds, and **our own renderer** produces images and self-checks them (symbols and footprints use the same definition)|**No**|
|`bun run lib:verify:kicad`|Additionally: KiCad can read `.kicad_sym` / `.kicad_mod`, and the merged board has 0 `pcb drc` violations|**Yes** (optional)|

The mandatory tier also does one more thing: it pulls **footprints** into our own rendering and self-check as well (previously only symbols went through self-rendering, while footprints relied on KiCad for images). The merged-board `.kicad_pcb` is still generated (it is an interoperability artifact, not a gate).

### 2. We Build the Gerber Writer Ourselves; CAM Judgement We Do Not

The layering does not change: **Gerber is a physical image and belongs to the derived layer**. But "derived" does not mean "must be produced by an external tool".

- **A self-built Gerber / Excellon writer**: **feasible, moderate cost**. RS-274X is a line-oriented text format (aperture definitions + draw/flash + coordinates) and needs no geometry kernel; this repository already has the facts of the PCB IR — layers, pads, traces, vias, silkscreen — and what is missing is canvas unfolding and coordinate transforms. Scheduled as P3 (`docs/backlog.md` F15).
- **What we still do not build ourselves is CAM-grade DFM judgement**: manufacturability judgements such as solder-mask openings, paste expansion, silkscreen clearance and impedance rules — that is rule engineering, not format engineering. The derived-layer policy ("under which rules do we open things") can be self-built, but **"can this batch of boards actually be made" is left to a professional CAM tool**.

### 3. Manufacturing-Neutral Data Is the Default Output of `fab`

- The default output of `fab` = **manufacturing-neutral data**: stackup and rule intent, BOM (with variant status), placement coordinates and orientation, assembly and manufacturing notes. This is **description**, and it is the layer this project is supposed to own (M0 of the layering in §3).
- Derived from that data: **Gerber (self-built, P3)**, IPC-2581 (optional export), BOM + coordinates (the JLC path, [ADR-0006](0006-jlc-prototype-delivery.md)), KiCad project (compatibility path).
- Manufacturing-neutral data belongs to the **contract layer** (invariant 19) and is publicly implementable.
- The cost of obtaining the specs needs separate verification: ODB++'s specification is held by Valor / PTC and requires membership; IPC-2581 is an IPC publication, also available to members (though it is already an industry de facto standard). **Neither is suitable as a "self-built format"**, so the contract layer uses its own JSON, and exporting to them is the exporter's job.

### 4. Relationship to [ADR-0005](0005-manufacturing-output.md)

**[ADR-0005](0005-manufacturing-output.md) is not repealed, it is bounded**: [ADR-0005](0005-manufacturing-output.md) records the **current implementation path** (IR → KiCad → Gerber / Excellon), while this ADR records the **target form and the dependency boundary**. The two do not conflict, but any reference to [ADR-0005](0005-manufacturing-output.md) must carry that qualification, otherwise it will be read as "KiCad is the end state".

## Consequences

**Benefits**

- Installing only TextEDA is enough to walk the whole "describe → check → render → manufacturing package" path; KiCad users can still join seamlessly (interoperability export is retained).
- Third-party implementers verifying themselves **do not need to install KiCad** — this is one of the conditions for delivering on invariant 19 (the contract layer is open source forever, anyone can implement independently).
- The gate definition becomes honest: our definition of correctness lives in our own code, and third-party acceptance is an **observation**, not a **premise**.

**Costs**

- The Gerber writer has to be written by us (P3, on the order of several hundred lines); until it lands, the "zero-dependency manufacturing package" is not complete — **be prepared for this, and do not claim a zero-dependency manufacturing output on the day ADR-0018 lands**.
- On the PCB side, the **agent-facing geometric DRC subset** is now in scope as our own code (clearance, width, via, keepout, edge, unrouted; [ADR-0053](0053-layout-and-routing-are-agent-driven.md)). KiCad DRC remains an optional cross-check, not a gate. CAM-level DFM judgement is still borrowed; this ADR's boundary (formats and descriptions ours, judgement and process rules borrowed) is unchanged.

**Risks**

- **"Zero dependency" easily slides into "we write everything ourselves".** The boundary is: **we write formats and descriptions ourselves, and we borrow professional tools for judgement and process rules**. A self-built Gerber writer is format work; CAM judgement is not.
- **Self-built ≠ no cross-validation.** After going zero-dependency, interoperability validation such as `lib:verify:kicad` must be retained (as an optional CI job), or we lose the signal of "third parties accept us" — which is exactly where a self-built library is more dangerous than a borrowed one.

## Related

- [ADR-0005](0005-manufacturing-output.md) Manufacturing output (the current path)
- [ADR-0009](0009-implementation-stack.md) Implementation stack (decision 1: core packages have no runtime dependencies)
- [ADR-0010](0010-footprint-and-3d-model-ownership.md) ~ [ADR-0013](0013-reference-project-self-built-libraries.md) Self-built libraries (the empirical basis for "self-building is easier than imagined")
- [ADR-0014](0014-reference-renderer.md) Reference renderer (the existing practice of self-rendering without borrowing KiCad)
- [ADR-0015](0015-licensing-and-open-standard.md) Licensing and openness policy (invariant 19)
- `docs/backlog.md` F14 (target form of `fab`), F15 (self-built Gerber writer)
