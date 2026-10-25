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
| [ADR-0008](0008-ir-shard-identity-and-hash.md) | IR Sharding, Identity Keys, Units, and Hash Granularity | Accepted | 2026-10-20 |
| [ADR-0009](0009-implementation-stack.md) | Implementation Stack (TypeScript + Bun), Render Layering, and the IDE Integration Surface | Accepted | 2026-10-20 |
| [ADR-0010](0010-footprint-and-3d-model-ownership.md) | Footprint Geometry and 3D Models Do Not Enter the Language; the Project's Self-Built Footprint Library Is a First-Class Artifact | Accepted | 2026-10-20 |
| [ADR-0011](0011-library-format-and-footprint-ir.md) | Self-Built Footprint Libraries Use Our Own Format; the KiCad Format Is an Export Artifact | Accepted | 2026-10-20 |
| [ADR-0012](0012-symbol-description.md) | Self-Built Symbol Libraries Use Our Own Format; the Electrical Facts of Pins Belong to `component` | Accepted | 2026-10-20 |
| [ADR-0013](0013-reference-project-self-built-libraries.md) | The Reference Project Is Entirely Self-Built — Symbol and Footprint Libraries Live in the Project, and Library-Level Checks Close the Loop | Accepted | 2026-10-20 |
| [ADR-0014](0014-reference-renderer.md) | Our Own Reference Renderer — IR → Drawing Commands → SVG, with a Preview That Does Not Depend on KiCad | Accepted | 2026-10-20 |
| [ADR-0015](0015-licensing-and-open-standard.md) | Licensing and Openness Policy — The Contract Layer Is Open Source Forever, the Project Is a Pure Open Technical Specification | Accepted | 2026-10-21 |
| [ADR-0016](0016-diagnostic-error-codes.md) | Diagnostic Error Code Registry (`domain.slug`) | Accepted | 2026-10-21 |
| [ADR-0017](0017-fact-layer-no-expressions.md) | The Fact Layer Has No Expressions; Generators Live Outside the Language | Accepted | 2026-10-22 |
| [ADR-0018](0018-zero-dependency-and-manufacturing-target.md) | Zero-Dependency Principle and the Target Form of the Manufacturing Output | Accepted | 2026-10-21 |
| [ADR-0019](0019-agent-contract-reference-and-check-entry.md) | Contract Reference and Check Entry Point for Agents | Accepted | 2026-10-21 |
| [ADR-0020](0020-source-spans.md) | Source Spans — Diagnostics Point at the File, the IR Stays Clean | Accepted | 2026-10-22 |
| [ADR-0021](0021-schematic-view-layer.md) | The Schematic View Layer (S1) Is an Independent Description; the Review UI Is Browser-First | Accepted | 2026-10-21 |
| [ADR-0022](0022-language-versioning.md) | Language Versioning — MAJOR.MINOR.PATCH, and 1.0 as a Milestone | Accepted | 2026-10-21 |
| [ADR-0023](0023-ir-layer-on-disk.md) | The IR Layer on Disk (Shard Tree, Manifest, Hashes) | Accepted | 2026-10-21 |
| [ADR-0024](0024-level-tags-in-flattened-names.md) | Level Tags in Flattened Names — `P` for Pages, `MOD` for Modules | Accepted | 2026-10-21 |
| [ADR-0025](0025-flat-board-and-print-pages.md) | One Flat Schematic per Board, Pages Become Print Pages in the View Layer | Accepted | 2026-10-21 |
| [ADR-0026](0026-modules-compose-boards.md) | A Board Is Composed of Modules; the IR Stays Flat | Accepted | 2026-10-22 |
| [ADR-0027](0027-device-parts-families-and-library-dependencies.md) | Device Semantics Split into Parts and Families; Project Layout by Asset Kind; Libraries Are Dependencies | Accepted | 2026-10-22 |
| [ADR-0028](0028-library-trust-and-derived-overrides.md) | Libraries Are Unverified Facts; Provenance, Disclaimers, and Derived Overrides | Accepted | 2026-10-22 |
| [ADR-0029](0029-package-code-footprint-and-3d-model-ownership.md) | The Package Code Lives in the Footprint; 3D Models Belong to Parts; Assembly Constraints Are Out of Scope | Accepted | 2026-10-22 |
| [ADR-0030](0030-procurement-layer.md) | The Procurement Layer — Which Part to Buy Is a Project-Local Decision | Accepted | 2026-10-22 |
| [ADR-0031](0031-project-tree-ownership-model.md) | The Project Tree Has Owners — Own Assets, Referenced Material, and Derivations | Accepted | 2026-10-22 |
| [ADR-0032](0032-view-is-a-drawing-not-a-build-input.md) | The View Is a Drawing, Not a Build Input | Accepted | 2026-10-22 |
| [ADR-0033](0033-review-records-and-attribution.md) | Review Is Not a Description Type — Notes, Decisions, and the One Accountable Person | Accepted | 2026-10-22 |
| [ADR-0034](0034-manufacturing-output-target-form.md) | The Target Form of the Manufacturing Output — Derived Manufacturing Data, a Self-Describing Package, and a Gate That Is a Process | Accepted | 2026-10-22 |
| [ADR-0035](0035-connectivity-authority-and-reverse-engineering.md) | Connectivity Has One Authority; Reverse Engineering Is an Import, Not a Mode | Accepted | 2026-10-22 |
| [ADR-0036](0036-process-entities-outside-the-language.md) | Process Entities Stay Outside the Language — Requirements, Blocks, and Analyses | Accepted | 2026-10-22 |
| [ADR-0037](0037-device-kind-vocabulary-and-one-device-directory.md) | The Device Kind Is `part` or `generic`, and the Devices Live in One Directory | Accepted | 2026-10-23 |
| [ADR-0038](0038-device-vocabulary-and-parameter-roles.md) | The Device Vocabulary Is Closed and Checked; a Parameter Is a Role and a Quantity | Accepted | 2026-10-23 |
| [ADR-0039](0039-a-part-states-its-own-ratings.md) | A Part States Its Own Ratings, and the Requirements Stay in the Instance Row | Accepted | 2026-10-23 |
| [ADR-0040](0040-partial-layout-is-legal-and-reported.md) | A Partial Layout Is Legal, and It Is Reported | Accepted | 2026-10-23 |
| [ADR-0041](0041-connect-pairs-must-be-implemented-by-copper.md) | A Declared `connect` Pair Must Be Implemented by Copper (What "Implemented" Means) | Accepted | 2026-10-23 |
| [ADR-0042](0042-a-device-description-enters-the-ir.md) | A Device's Description Is a Fact, So It Enters the IR | Accepted | 2026-10-23 |
| [ADR-0043](0043-ratings-are-compared-against-declared-windows.md) | Ratings Are Compared Against Declared Windows | Accepted | 2026-10-23 |
| [ADR-0044](0044-dissipation-is-checked-against-declared-limits.md) | Dissipation Is Checked Against Declared Limits | Accepted | 2026-10-23 |
| [ADR-0045](0045-the-package-gives-a-resistor-its-floor.md) | The Package Gives a Chip Resistor Its Floor | Accepted | 2026-10-23 |
| [ADR-0046](0046-vendored-libraries-are-verified-by-their-hash.md) | A Vendored Library Is Verified by Its Hash | Accepted | 2026-10-24 |
| [ADR-0047](0047-an-external-library-is-a-template-not-a-dependency.md) | An External Library Is a Template, Not a Dependency | Accepted | 2026-10-24 |
| [ADR-0048](0048-trust-in-a-library-you-do-not-own.md) | Trust in a Library You Do Not Own Is a Consumer Record | Accepted | 2026-10-24 |
| [ADR-0049](0049-a-file-carries-its-own-revision.md) | A File Carries Its Own Revision, and Trust Matches That Revision | Accepted | 2026-10-24 |
| [ADR-0050](0050-renumbering-is-a-code-executed-global-rename.md) | Renumbering Is a Code-Executed Global Rename, Not an Agent Edit | Accepted | 2026-10-25 |
| [ADR-0051](0051-instances-have-a-stable-project-local-uid.md) | Instance Identity Is a Stable Project-Local UID, Not the Refdes | Accepted | 2026-10-25 |

## Reserved Numbers

A number is reserved when the decision is agreed but the record is not written yet. A document may cite a reserved
number; the number itself is never reused, and the file name is fixed when the record is written.

No number is reserved at the moment.

## Rules

- **Cite by number.** A document that refers to a decision writes `ADR-NNNN`, never the title. The number is stable;
  the title may be reworded.
- **The file name is the external anchor.** `docs/adr/NNNN-<slug>.md` never changes once written, so a link to it
  keeps working. The slug after the number may differ from the title.
- **Status vocabulary** is closed: `Accepted` or `Proposed`. A `Proposed` record may be cited, but it is not a
  settled decision — say so when you rely on it.
- **Every ADR carries the same header**: a `# ADR-NNNN: Title` heading, then `Status:`, `Date:`, optionally
  `Related:`, then `Impact:`. The header is machine-checked by `bun run check:links`.
