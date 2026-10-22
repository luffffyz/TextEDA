# ADR-0005: Manufacturing Output Path (IR → KiCad → Gerber/Excellon)

Status: Accepted (revised 2026-10-20: the manufacturing chain changed from Circuit JSON to KiCad)
Date: 2026-10-20
Impact: `AGENTS.md` §1, §8, §9 (open question 4); `spec/pcb.md` (`rules` segment, new `silk` segment, restriction table); `docs/adr/0003-agent-first-pcb-ir.md` decision 8

## Background

- The boundary of `AGENTS.md` §0, §1, §8: **no in-house manufacturing output**; Gerber / SMT placement / BOM borrow existing toolchains. This ADR fixes the concrete path of that "borrowing".
- **Three kinds of information must be kept apart** (the core of this ADR, and also the criterion for "what the IR must add"):
  1. **Design intent (parameters)** → into the IR. Solder mask expansion, solder paste ratio, thermal pad spacing, minimum trace width, whether silkscreen is printed and at what text height, drill forms: these are "how this board is made", they are design facts on the same level as netclasses.
  2. **Derived geometry (results)** → not into the IR. The polygon after copper pour filling, silkscreen text positions, solder mask opening polygons: they are a function of (intent + geometry + fixed algorithm). Storing them in the IR means storing two truths, and they will inevitably drift; moreover, with tens of thousands of vertices per board, the agent cannot read them.
  3. **Derived policy (the algorithm itself)** → into `spec/`, not into the IR. Meshing, sweep order, thermal pad shapes, silkscreen typography rules: they are part of the specification, versioned and reviewable, and must not be hidden in code.
- **Gerber is the terminal end of the lossy projection**: it carries no constraints, no net names (unless X2 attributes are written), no assembly or 3D semantics; what is lost must be reported (`docs/adr/0003-agent-first-pcb-ir.md` decision 8).
- **Gerbers are easy to write, DFM is hard to judge**: writing RS-274X and Excellon is mechanical work; "can this board be produced" is the job of DRC and the board house's CAM.
- **KiCad CLI capabilities have been verified** (KiCad 9.0 official manual, CLI chapter; KiCad 10 has the same):
  - `kicad-cli pcb drc` — runs the full DRC, `--format report|json`, `--severity-all/error/warning/exclusions`, `--schematic-parity`, `--exit-code-violations` (exit 0 without violations, exit 5 with violations → usable as a CI gate).
  - `kicad-cli sch erc` — ERC likewise has `--format json` and `--exit-code-violations`.
  - `kicad-cli pcb export gerbers` — one file per layer; X2 on by default (`--no-x2` turns it off), net name attributes written by default (`--no-netlist` turns it off), `--subtract-soldermask`, `--precision 5|6`, `--no-protel-ext`, `--use-drill-file-origin`. The single-file multi-layer `pcb export gerber` is deprecated in 9.0 and removed in 10.0.
  - `kicad-cli pcb export drill` — `--format excellon|gerber`, `--excellon-separate-th` (plated/non-plated separated), `--excellon-oval-format route|alternate` (slots/oval holes), `--generate-map --map-format pdf|gerberx2|...`.
  - There is also `pcb export step/glb/ipc2581/odb/pos/svg/pdf/ply/dxf/brep/render`, `sch export bom/...`, `jobset run`.
  - **This machine already has `kicad-cli` 10.0.7 installed** (nix store: `/nix/store/59w3i7fr0m0jchg8xrhcxl74d1wnqysc-kicad-10.0.7`). `kicad-cli pcb drc --format json` has been tested and works: **0.44 s/board**, emitting `violations[]` (each entry carries `type` rule id, `severity`, `items[]{description, pos, uuid}`) plus `unconnected_items[]` and `schematic_parity`, `coordinate_units: mm` → **it can serve as a machine-readable DRC oracle** (KiCad ships `--exit-code-violations`, which can be used directly as a CI gate).
  - Differential test corpus: 19 boards in the KiCad template directory (`/nix/store/*KiCad_template_dir/**/*.kicad_pcb`, including Arduino_Micro / BeagleBone-Black-Cape / STM_Nucleo64_Morpho / DevEBox etc.); the `demos` directory of this nix package is empty.
- **Withdrawn option**: `tscircuit/circuit-json-to-gerber` (3★ / 42 forks / 45 open issues; and using Circuit JSON amounts to binding the IR to tscircuit's data model). Per project opinion, that road is not taken.

## Decision

1. **Manufacturing output path = IR → KiCad → Gerber/Excellon/DRC**. KiCad is the only manufacturing output, and manufacturing and verification close the loop in the same chain. The BOM / coordinate file specifications and the supplier part-number rule for prototype delivery are covered separately in `docs/adr/0006-jlc-prototype-delivery.md`.
2. **Circuit JSON is withdrawn as the manufacturing chain**. Reasons: binding to a foreign schema; low tool maturity; no DRC; its only selling point, "no KiCad needed", is not worth it when there is a better alternative (decision 3). If an interoperability target other than KiCad is needed in the future, that becomes a separate project.
3. **An in-house Gerber writer is postponed**. Trigger conditions: the deliverable must be produced in an environment without KiCad, or KiCad CLI becomes a bottleneck. At that point we build it **in-house** rather than adopting another foreign schema.
4. **What goes into the IR**: design intent parameters go into the IR; derived geometry does not; derived policy is written into `spec/` (next step). Already landed in `spec/pcb.md`: the `mask` / `paste` / `thermal` / `min_width` of the `rules` segment, and the new `silk` segment.
5. **The derived layer is borne by KiCad**: copper pour filling, solder mask and solder paste openings, silkscreen typography are all handed to KiCad's board setup, footprint properties and fill algorithm; the IR → KiCad mapping must cover these design settings.
   - When implementing, check the landing points: KiCad's **solder mask expansion and solder paste margin are footprint properties** (per-footprint), not board-level settings; **thermal pad spacing and bridge width are zone / pad properties**. So the IR's `mask` / `paste` / `thermal` must be written to the corresponding level rather than lumped into board setup.
6. **Verification path = KiCad CLI**: both `kicad-cli pcb drc` and `kicad-cli sch erc` run unattended (`--exit-code-violations` gives the exit code, `--format json` gives a machine-readable report). This turns "KiCad is just a DRC engine" into something automatable, with no GUI needed.
7. **Preconditions for Gerber** (still to be filled in on the IR side):
   - `rules`: `mask` (solder mask expansion), `paste` (ratio and offset), `thermal` (spacing and bridge width), `min_width` (minimum trace width) — added.
   - `silk` segment: whether refdes / value are printed, text height, which layer — added; **the positions come from the footprint library** (via KiCad / JLC); the IR does not describe positions.
   - Drill forms: slots and non-circular holes (`physical_only` currently expresses only round holes and rectangular cutouts) — to be added.
8. **Trial-run gate**: run the minimum board through `kicad-cli pcb export gerbers` + `pcb export drill` + `pcb drc` and check item by item: copper layers, solder mask openings, paste openings, silkscreen, round holes and slots, plated/non-plated separate files, X2 net names and device attributes, board outline and layer alignment, usability of the DRC report. Missing items are recorded as losses or gaps.
9. **Losses must be reported**: both levels, IR → KiCad and KiCad → Gerber, must report the semantics that got dropped (constraints, `deviation`, assembly and 3D, unmapped `rules`), reusing the controlled-deviation mechanism from `AGENTS.md` §4.4.

## Consequences

- Manufacturing and verification close the loop in one chain: a single KiCad project yields Gerber / Excellon / IPC-2581 / STEP / BOM, and provides DRC.
- **Cost: the manufacturing path depends on KiCad**. "The final deliverable does not depend on KiCad" is downgraded from a current guarantee to a future goal (decision 3); the dual output of `docs/adr/0003-agent-first-pcb-ir.md` decision 8 correspondingly becomes a single output.
- IR → KiCad is a lossy projection: the landing points of `rules`, `deviation` and constraints in KiCad must be checked line by line (project file + netclass + footprint and zone properties).
- Derivation is borne by KiCad → the IR stays neutral; the downside is that we do not control fill and typography details, and **KiCad version changes change the results**, so versions must be locked and a trial-run baseline kept.
- Concentrated dependency: libraries, DRC and manufacturing all hang off KiCad as a single point, which is a single point of failure.
- Withdrawing the Circuit JSON road means giving up "an off-the-shelf neutral manufacturing chain" in exchange for "one mature chain accepted by the board house ecosystem".

## Follow-up

- `kicad-cli` is installed (10.0.7); `pcb drc` has been run through and the JSON oracle verified. **The first round of the trial-run gate has passed** (2026-10-20): using the `charger-buck` board of `examples/reference-project` (`examples/reference-project/design/pcb/charger-buck.teda`), the chain `pcb description → .kicad_pcb → DRC → Gerber/Excellon` works, with **0 DRC violations, 0 unconnected items**, and all 21 Gerbers plus 1 Excellon exported. The baseline and commands are in `docs/trial-run/charger-buck/`, the field-level mapping in `docs/kicad-pcb-format.md`.
- The three things the trial run uncovered are now on record: ① **design rules are not in `.kicad_pcb`** and must be written into `.kicad_pro` (measured: changing `min_clearance` → 40 clearance violations); ② the naming gap for page-local nets → `docs/adr/0007-page-internal-net-naming.md`; ③ pad **coordinates are local while angles are absolute** — an easy-to-get-wrong convention.
- The trial-run gate is **not finished**: stackup (`.kicad_pro`'s `design_settings.stackup`), the landing points of the four rules parameters `mask`/`paste`/`thermal`/`min_width`, bottom-side components and slots, board outline polygons, and CAM-level Gerber checks are all still undone — see the "Status" column of `docs/kicad-pcb-format.md`.
- DRC ownership is undecided: keep "KiCad as the DRC engine" (decision 6), or build geometric DRC in-house (which must use the KiCad JSON as an oracle for differential convergence). See the `AGENTS.md` §1 boundary and decision 6 of this ADR.
- The field-level mapping table for IR → KiCad: direct mapping / loss / needs reporting → `docs/kicad-pcb-format.md` (the measured ledger from the first trial run).
- Specifying derived policy: written into `spec/` (which parts are fixed policy, which are IR parameters), with the landing points into KiCad.
- Registering the netlist as one of the export targets (a netlist is a projection of the IR, not an independent layer).
- Locking the KiCad version (fill and typography results vary with the version).