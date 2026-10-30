# Decision records

Every decision this project has made, in one index. The corpus is filed in ten topic
folders; each folder has its own README that says what the folder decides and where
the neighbouring questions are answered.

## Numbering

One flat counter, handed out in the order the records are written, starting at
`0001`. A number names one record and nothing else: what a record is about is said by
its folder, not by its number. A number is **never changed and never reused** — a link
to `ADR-0006` names the same decision forever — so a new record takes the next free
number and disturbs nothing that already exists. The next free number is `0048`. The
sequence is not contiguous; gaps are normal.

## Retired

| Retired | Range | Note |
|---|---|---|
| Retired | 0100-0146 | the topic-folder corpus, renumbered into 0001-0047 |

The numbers `0100`–`0146` are the numbers these same forty-seven decisions carried
before 2026-10-30. The corpus was renumbered in one pass — every record, every
citation, every link target — and the old numbers are **retired, not reused**: a
citation that still says `ADR-0105` now points at nothing, and the link gate says so.
The retired range is disjoint from the series in use, and a retired number is never
listed as reserved: reserved means declared, not yet written.

Two earlier series were renamed into this one, so a citation written before
2026-10-28 names a different decision than it did. The mapping for those passes is in
the git history of `docs/adr-corpus-structure.md`.

## Reserved

Numbers declared but not yet written. A reserved number may be taken by the record
that was meant for it, and by nothing else.

| Number | Reserved for |
|---|---|

## Language

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0001](language/0001-fact-layer-has-no-expressions.md) | The Fact Layer Has No Expressions; Generators Live Outside the Language | Accepted | 2026-10-22 |
| [ADR-0002](language/0002-one-language-version-number.md) | One Language Version Number | Accepted | 2026-10-27 |
| [ADR-0003](language/0003-diagnostic-error-codes.md) | Diagnostic Error Code Registry (`domain.slug`) | Accepted | 2026-10-21 |
| [ADR-0004](language/0004-source-spans.md) | Source Spans — Diagnostics Point at the File, the IR Stays Clean | Accepted | 2026-10-22 |

## IR

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0005](ir/0005-ir-representation.md) | IR Representation (Semantic Model / Contract / Serialization) | Accepted | 2026-10-20 |
| [ADR-0006](ir/0006-ir-shards-and-hashes.md) | IR Sharding, Identity Keys, and Hashes | Accepted | 2026-10-21 |
| [ADR-0007](ir/0007-device-description-enters-the-ir.md) | A Device's Description Is a Fact, So It Enters the IR | Accepted | 2026-10-23 |

## Project

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0008](project/0008-project-tree-has-owners.md) | The Project Tree Has Owners | Accepted | 2026-10-22 |
| [ADR-0009](project/0009-board-linking.md) | How Boards Are Linked Together | Accepted | 2026-10-20 |
| [ADR-0010](project/0010-instance-identity-is-a-uid.md) | Instance Identity Is a Stable Project-Local UID, Not the Refdes | Accepted | 2026-10-25 |
| [ADR-0011](project/0011-renumbering-is-a-code-executed-rename.md) | Renumbering Is a Code-Executed Global Rename, Not an Agent Edit | Accepted | 2026-10-25 |

## Schematic

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0012](schematic/0012-one-flat-schematic-per-board.md) | One Flat Schematic per Board; the Partition Moves to the View Layer | Accepted | 2026-10-21 |
| [ADR-0013](schematic/0013-modules-compose-boards.md) | A Board Is Composed of Modules; the IR Stays Flat | Accepted | 2026-10-22 |
| [ADR-0014](schematic/0014-connectivity-has-one-authority.md) | Connectivity Has One Authority; Reverse Engineering Is an Import, Not a Mode | Accepted | 2026-10-22 |
| [ADR-0015](schematic/0015-flattening-and-the-net-set.md) | Flattening and the Net Set | Accepted | 2026-10-20 |

## PCB

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0016](pcb/0016-agent-first-pcb-description.md) | Agent-First PCB Description (Segment Set and Trade-offs) | Accepted | 2026-10-20 |
| [ADR-0017](pcb/0017-layout-and-routing-are-agent-driven.md) | Layout and Routing Are Agent-Driven, Checker-Gated, and Frozen on Acceptance | Accepted | 2026-10-26 |
| [ADR-0018](pcb/0018-copper-fill-uses-a-geometry-kernel.md) | Copper Fill Uses a Self-Built Constrained Geometry Kernel | Accepted | 2026-10-26 |
| [ADR-0019](pcb/0019-a-partial-layout-is-legal.md) | A Partial Layout Is Legal, and It Is Reported | Accepted | 2026-10-23 |
| [ADR-0020](pcb/0020-connect-pairs-need-copper.md) | A Declared `connect` Pair Must Be Implemented by Copper | Accepted | 2026-10-23 |

## Manufacturing

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0021](manufacturing/0021-the-manufacturing-output-path.md) | The Manufacturing Output Path and Its Target Form | Accepted | 2026-10-22 |
| [ADR-0022](manufacturing/0022-jlc-prototype-delivery.md) | JLC Prototype Delivery (BOM / Coordinates / Part Number) | Accepted | 2026-10-21 |
| [ADR-0023](manufacturing/0023-the-output-package-carries-its-provenance.md) | The Output Package Carries Its Own Provenance | Accepted | 2026-10-28 |

## Devices

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0024](devices/0024-the-device-kind-is-part-or-generic.md) | The Device Kind Is `part` or `generic`, and the Devices Live in One Directory | Accepted | 2026-10-23 |
| [ADR-0025](devices/0025-device-vocabulary-and-parameter-roles.md) | The Device Vocabulary Is Closed and Checked; a Parameter Is a Role and a Quantity | Accepted | 2026-10-23 |
| [ADR-0026](devices/0026-a-part-states-its-own-ratings.md) | A Part States Its Own Ratings, and They Are Checked Against Declared Windows | Accepted | 2026-10-26 |
| [ADR-0027](devices/0027-the-package-gives-a-chip-resistor-its-floor.md) | The Package Gives a Chip Resistor Its Floor | Accepted | 2026-10-23 |
| [ADR-0028](devices/0028-package-code-and-3d-models.md) | The Package Code Lives in the Footprint; 3D Models Belong to Parts | Accepted | 2026-10-22 |
| [ADR-0029](devices/0029-the-procurement-layer.md) | The Procurement Layer — Which Part to Buy Is a Project-Local Decision | Accepted | 2026-10-22 |

## Libraries

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0030](libraries/0030-footprint-format-and-geometry.md) | Footprint Geometry and 3D Models Do Not Enter the Language; Our Own Footprint Format Is the Source | Accepted | 2026-10-20 |
| [ADR-0031](libraries/0031-symbol-format.md) | Self-Built Symbol Libraries Use Our Own Format | Accepted | 2026-10-20 |
| [ADR-0032](libraries/0032-the-reference-project-is-self-built.md) | The Reference Project Is Entirely Self-Built | Accepted | 2026-10-20 |
| [ADR-0033](libraries/0033-libraries-are-unverified-facts.md) | Libraries Are Unverified Facts; Provenance, Disclaimers, and Corrections | Accepted | 2026-10-22 |
| [ADR-0034](libraries/0034-trust-in-a-library-you-do-not-own.md) | Trust in a Library You Do Not Own | Accepted | 2026-10-24 |

## View

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0035](view/0035-the-view-layer-is-a-drawing.md) | The View Layer Is an Independent Description, and the View Is a Drawing, Not a Build Input | Accepted | 2026-10-22 |
| [ADR-0036](view/0036-our-own-reference-renderer.md) | Our Own Reference Renderer — IR → Drawing Commands → SVG | Accepted | 2026-10-20 |
| [ADR-0037](view/0037-review-records-and-attribution.md) | Review Is Not a Description Type — Notes, Decisions, and the One Accountable Person | Accepted | 2026-10-22 |
| [ADR-0042](view/0042-the-review-app-has-four-modes.md) | The Review App Has Four Modes, and `layout` Writes Placement, Not Copper | Accepted | 2026-10-28 |
| [ADR-0043](view/0043-the-review-app-is-a-plugin-of-the-agent-workbench.md) | The Review App Is a Plugin of the Agent Workbench, and the Agent Owns the Source | Accepted | 2026-10-29 |

## Process

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0038](process/0038-implementation-stack-and-agent-entry.md) | Implementation Stack and the Agent's Entry Point | Accepted | 2026-10-21 |
| [ADR-0039](process/0039-licensing-and-open-standard.md) | Licensing and Openness Policy | Accepted | 2026-10-21 |
| [ADR-0040](process/0040-process-entities-outside-the-language.md) | Process Entities Stay Outside the Language | Accepted | 2026-10-22 |
| [ADR-0041](process/0041-documentation-has-one-authority-per-fact.md) | Documentation Has One Authority per Fact, and the Rest Is a Pointer | Accepted | 2026-10-27 |
| [ADR-0044](process/0044-the-agent-surface-is-a-set-of-verbs.md) | The Agent's Surface Is a Set of Verbs; Every Host Adapts the Same Ones | Accepted | 2026-10-29 |
| [ADR-0045](process/0045-the-mcp-server-is-a-slice-we-write-ourselves.md) | The MCP Server Is a Slice We Write Ourselves | Accepted | 2026-10-29 |
| [ADR-0046](process/0046-a-host-is-entered-once.md) | A Host Is Entered Once — One Route for the Tools, One Surface for the Picture | Accepted | 2026-10-29 |
| [ADR-0047](process/0047-the-picture-reaches-a-host-by-three-routes.md) | The Picture Reaches a Host by Three Routes, and a Host-Native Plugin Is Written Only Where Nothing Else Reaches | Accepted | 2026-10-30 |
