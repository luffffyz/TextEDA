# Decision records

Every decision this project has made, in one index. The corpus is filed in ten topic
folders; each folder has its own README that says what the folder decides and where
the neighbouring questions are answered.

## Numbering

One flat counter, handed out in the order the records are written. A number names one
record and nothing else: what a record is about is said by its folder, not by its
number. A number is **never changed and never reused** — a link to `ADR-0105` names
the same decision forever — so a new record takes the next free number and disturbs
nothing that already exists. The sequence is not contiguous; gaps are normal.

## Retired

| Retired | Range | Note |
|---|---|---|
| Retired | 0001-0056 | the first corpus |

The numbers `0001`–`0056` were the first corpus, before the corpus was filed in topic
folders. They are **retired, not renamed**: a new record never takes a retired number,
because a missed reference rewrite would then point at a *different* decision
silently. The history of those records is in the git history.

## Reserved

Numbers declared but not yet written. A reserved number may be taken by the record
that was meant for it, and by nothing else.

| Number | Reserved for |
|---|---|

## Language

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0100](language/0100-fact-layer-has-no-expressions.md) | The Fact Layer Has No Expressions; Generators Live Outside the Language | Accepted | 2026-10-22 |
| [ADR-0101](language/0101-one-language-version-number.md) | One Language Version Number | Accepted | 2026-10-27 |
| [ADR-0102](language/0102-diagnostic-error-codes.md) | Diagnostic Error Code Registry (`domain.slug`) | Accepted | 2026-10-21 |
| [ADR-0103](language/0103-source-spans.md) | Source Spans — Diagnostics Point at the File, the IR Stays Clean | Accepted | 2026-10-22 |

## IR

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0104](ir/0104-ir-representation.md) | IR Representation (Semantic Model / Contract / Serialization) | Accepted | 2026-10-20 |
| [ADR-0105](ir/0105-ir-shards-and-hashes.md) | IR Sharding, Identity Keys, and Hashes | Accepted | 2026-10-21 |
| [ADR-0106](ir/0106-device-description-enters-the-ir.md) | A Device's Description Is a Fact, So It Enters the IR | Accepted | 2026-10-23 |

## Project

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0107](project/0107-project-tree-has-owners.md) | The Project Tree Has Owners | Accepted | 2026-10-22 |
| [ADR-0108](project/0108-board-linking.md) | How Boards Are Linked Together | Accepted | 2026-10-20 |
| [ADR-0109](project/0109-instance-identity-is-a-uid.md) | Instance Identity Is a Stable Project-Local UID, Not the Refdes | Accepted | 2026-10-25 |
| [ADR-0110](project/0110-renumbering-is-a-code-executed-rename.md) | Renumbering Is a Code-Executed Global Rename, Not an Agent Edit | Accepted | 2026-10-25 |

## Schematic

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0111](schematic/0111-one-flat-schematic-per-board.md) | One Flat Schematic per Board; the Partition Moves to the View Layer | Accepted | 2026-10-21 |
| [ADR-0112](schematic/0112-modules-compose-boards.md) | A Board Is Composed of Modules; the IR Stays Flat | Accepted | 2026-10-22 |
| [ADR-0113](schematic/0113-connectivity-has-one-authority.md) | Connectivity Has One Authority; Reverse Engineering Is an Import, Not a Mode | Accepted | 2026-10-22 |
| [ADR-0114](schematic/0114-flattening-and-the-net-set.md) | Flattening and the Net Set | Accepted | 2026-10-20 |

## PCB

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0115](pcb/0115-agent-first-pcb-description.md) | Agent-First PCB Description (Segment Set and Trade-offs) | Accepted | 2026-10-20 |
| [ADR-0116](pcb/0116-layout-and-routing-are-agent-driven.md) | Layout and Routing Are Agent-Driven, Checker-Gated, and Frozen on Acceptance | Accepted | 2026-10-26 |
| [ADR-0117](pcb/0117-copper-fill-uses-a-geometry-kernel.md) | Copper Fill Uses a Self-Built Constrained Geometry Kernel | Accepted | 2026-10-26 |
| [ADR-0118](pcb/0118-a-partial-layout-is-legal.md) | A Partial Layout Is Legal, and It Is Reported | Accepted | 2026-10-23 |
| [ADR-0119](pcb/0119-connect-pairs-need-copper.md) | A Declared `connect` Pair Must Be Implemented by Copper | Accepted | 2026-10-23 |

## Manufacturing

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0120](manufacturing/0120-the-manufacturing-output-path.md) | The Manufacturing Output Path and Its Target Form | Accepted | 2026-10-22 |
| [ADR-0121](manufacturing/0121-jlc-prototype-delivery.md) | JLC Prototype Delivery (BOM / Coordinates / Part Number) | Accepted | 2026-10-21 |
| [ADR-0122](manufacturing/0122-the-output-package-carries-its-provenance.md) | The Output Package Carries Its Own Provenance | Accepted | 2026-10-28 |

## Devices

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0123](devices/0123-the-device-kind-is-part-or-generic.md) | The Device Kind Is `part` or `generic`, and the Devices Live in One Directory | Accepted | 2026-10-23 |
| [ADR-0124](devices/0124-device-vocabulary-and-parameter-roles.md) | The Device Vocabulary Is Closed and Checked; a Parameter Is a Role and a Quantity | Accepted | 2026-10-23 |
| [ADR-0125](devices/0125-a-part-states-its-own-ratings.md) | A Part States Its Own Ratings, and They Are Checked Against Declared Windows | Accepted | 2026-10-26 |
| [ADR-0126](devices/0126-the-package-gives-a-chip-resistor-its-floor.md) | The Package Gives a Chip Resistor Its Floor | Accepted | 2026-10-23 |
| [ADR-0127](devices/0127-package-code-and-3d-models.md) | The Package Code Lives in the Footprint; 3D Models Belong to Parts | Accepted | 2026-10-22 |
| [ADR-0128](devices/0128-the-procurement-layer.md) | The Procurement Layer — Which Part to Buy Is a Project-Local Decision | Accepted | 2026-10-22 |

## Libraries

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0129](libraries/0129-footprint-format-and-geometry.md) | Footprint Geometry and 3D Models Do Not Enter the Language; Our Own Footprint Format Is the Source | Accepted | 2026-10-20 |
| [ADR-0130](libraries/0130-symbol-format.md) | Self-Built Symbol Libraries Use Our Own Format | Accepted | 2026-10-20 |
| [ADR-0131](libraries/0131-the-reference-project-is-self-built.md) | The Reference Project Is Entirely Self-Built | Accepted | 2026-10-20 |
| [ADR-0132](libraries/0132-libraries-are-unverified-facts.md) | Libraries Are Unverified Facts; Provenance, Disclaimers, and Corrections | Accepted | 2026-10-22 |
| [ADR-0133](libraries/0133-trust-in-a-library-you-do-not-own.md) | Trust in a Library You Do Not Own | Accepted | 2026-10-24 |

## View

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0134](view/0134-the-view-layer-is-a-drawing.md) | The View Layer Is an Independent Description, and the View Is a Drawing, Not a Build Input | Accepted | 2026-10-22 |
| [ADR-0135](view/0135-our-own-reference-renderer.md) | Our Own Reference Renderer — IR → Drawing Commands → SVG | Accepted | 2026-10-20 |
| [ADR-0136](view/0136-review-records-and-attribution.md) | Review Is Not a Description Type — Notes, Decisions, and the One Accountable Person | Accepted | 2026-10-22 |
| [ADR-0141](view/0141-the-review-app-has-four-modes.md) | The Review App Has Four Modes, and `layout` Writes Placement, Not Copper | Accepted | 2026-10-28 |
| [ADR-0142](view/0142-the-review-app-is-a-plugin-of-the-agent-workbench.md) | The Review App Is a Plugin of the Agent Workbench, and the Agent Owns the Source | Proposed | 2026-10-29 |

## Process

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0137](process/0137-implementation-stack-and-agent-entry.md) | Implementation Stack and the Agent's Entry Point | Accepted | 2026-10-21 |
| [ADR-0138](process/0138-licensing-and-open-standard.md) | Licensing and Openness Policy | Accepted | 2026-10-21 |
| [ADR-0139](process/0139-process-entities-outside-the-language.md) | Process Entities Stay Outside the Language | Accepted | 2026-10-22 |
| [ADR-0140](process/0140-documentation-has-one-authority-per-fact.md) | Documentation Has One Authority per Fact, and the Rest Is a Pointer | Accepted | 2026-10-27 |
| [ADR-0143](process/0143-the-agent-surface-is-a-set-of-verbs.md) | The Agent's Surface Is a Set of Verbs; Every Host Adapts the Same Ones | Accepted | 2026-10-29 |
| [ADR-0144](process/0144-the-mcp-server-is-a-slice-we-write-ourselves.md) | The MCP Server Is a Slice We Write Ourselves | Accepted | 2026-10-29 |
| [ADR-0145](process/0145-a-host-is-entered-once.md) | A Host Is Entered Once — One Route for the Tools, One Surface for the Picture | Accepted | 2026-10-29 |
