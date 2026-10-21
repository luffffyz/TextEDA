# ADR Index

Every architecture decision record in this repository, in numeric order.

| ADR | Title | Status | Date |
|---|---|---|---|
| [ADR-0001](0001-board-linking.md) | How Boards Are Linked Together | Accepted | 2026-10-20 |
| [ADR-0002](0002-board-pages-and-bom.md) | Intra-Board Pages (Sheet Partitioning), Flattening and BOM Counting | Accepted | 2026-10-20 |
| [ADR-0003](0003-agent-first-pcb-ir.md) | Agent-First PCB Description (Segment Set and Trade-offs) | Accepted | 2026-10-20 |
| [ADR-0004](0004-ir-representation.md) | IR Representation (Semantic Model / Contract / Serialization) | Accepted | 2026-10-20 |
| [ADR-0005](0005-manufacturing-output.md) | Manufacturing Output Path (IR → KiCad → Gerber/Excellon) | Accepted | 2026-10-20 |
| [ADR-0006](0006-jlc-prototype-delivery.md) | JLC Prototype Delivery (BOM / Coordinates / Part Number) | Accepted | 2026-10-21 |
| [ADR-0007](0007-page-internal-net-naming.md) | The Net Set and Its Names After Flattening (What Happens to In-Page Nets) | Accepted | 2026-10-20 |
| [ADR-0008](0008-ir-shard-identity-and-hash.md) | IR Sharding, Identity Keys, Units, and Hash Granularity | Proposed | 2026-10-20 |
| [ADR-0009](0009-implementation-stack.md) | Implementation Stack (TypeScript + Bun), Render Layering, and the IDE Integration Surface | Accepted | 2026-10-20 |
| [ADR-0010](0010-footprint-and-3d-model-ownership.md) | Footprint Geometry and 3D Models Do Not Enter the Language; the Project's Self-Built Footprint Library Is a First-Class Artifact | Accepted | 2026-10-20 |
| [ADR-0011](0011-library-format-and-footprint-ir.md) | Self-Built Footprint Libraries Use Our Own Format; the KiCad Format Is an Export Artifact | Accepted | 2026-10-20 |
| [ADR-0012](0012-symbol-description.md) | Self-Built Symbol Libraries Use Our Own Format; the Electrical Facts of Pins Belong to `component` | Accepted | 2026-10-20 |
| [ADR-0013](0013-reference-project-self-built-libraries.md) | The Reference Project Is Entirely Self-Built — Symbol and Footprint Libraries Live in the Project, and Library-Level Checks Close the Loop | Accepted | 2026-10-20 |
| [ADR-0014](0014-reference-renderer.md) | Our Own Reference Renderer — IR → Drawing Commands → SVG, with a Preview That Does Not Depend on KiCad | Accepted | 2026-10-20 |
| [ADR-0015](0015-licensing-and-open-standard.md) | Licensing and Openness Policy — The Contract Layer Is Open Source Forever, the Project Is Positioned as a Standard Proposal | Accepted | 2026-10-21 |
| [ADR-0016](0016-diagnostic-error-codes.md) | Diagnostic Error Code Registry (`domain.slug`) | Accepted | 2026-10-21 |
| [ADR-0018](0018-zero-dependency-and-manufacturing-target.md) | Zero-Dependency Principle and the Target Form of the Manufacturing Output | Accepted | 2026-10-21 |
| [ADR-0019](0019-agent-contract-reference-and-check-entry.md) | Contract Reference and Check Entry Point for Agents | Accepted | 2026-10-21 |

## Reserved Numbers

A number is reserved when the decision is agreed but the record is not written yet. A document may cite a reserved
number; the number itself is never reused, and the file name is fixed when the record is written.

| ADR | Planned file | Backlog item |
|---|---|---|
| ADR-0017 | `0017-fact-layer-no-expressions.md` | F9 |
| ADR-0020 | `0020-source-spans.md` | F11 |

## Rules

- **Cite by number.** A document that refers to a decision writes `ADR-NNNN`, never the title. The number is stable;
  the title may be reworded.
- **The file name is the external anchor.** `docs/adr/NNNN-<slug>.md` never changes once written, so a link to it
  keeps working. The slug after the number may differ from the title.
- **Status vocabulary** is closed: `Accepted` or `Proposed`. A `Proposed` record may be cited, but it is not a
  settled decision — say so when you rely on it.
- **Every ADR carries the same header**: a `# ADR-NNNN: Title` heading, then `Status:`, `Date:`, optionally
  `Related:`, then `Impact:`. The header is machine-checked by `bun run check:links`.
