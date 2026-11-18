# Devices — decisions

## Scope

The device layer: the two kinds of device, the closed vocabulary of their parameters, the ratings a part states about itself, and the project-local decision of which part to buy.

## Not here

- The footprint and symbol formats — [ADR-0030](../08-libraries/0030-footprint-format-and-geometry.md).
- How a library is imported — [ADR-0034](../08-libraries/0034-trust-in-a-library-you-do-not-own.md).

## Reading order

1. [0024](0024-the-device-kind-is-part-or-generic.md) — the kind is a fact of the file, never of the path.
2. [0025](0025-device-vocabulary-and-parameter-roles.md) — the vocabulary is closed, and a parameter is a role and a quantity.
3. [0026](0026-a-part-states-its-own-ratings.md) — a part states its own ratings, and they are checked.
4. [0027](0027-the-package-gives-a-chip-resistor-its-floor.md) — the package gives a chip resistor its floor.
5. [0028](0028-package-code-and-3d-models.md) — the package code lives in the footprint; a 3D model belongs to a part.
6. [0029](0029-the-procurement-layer.md) — which part to buy is a project-local decision.
7. [0075](0075-a-ratings-polarity-is-the-roles.md) — a rating's polarity is the role's, and a MOSFET's rating covers both polarities.
8. [0076](0076-a-parts-dissipation-is-bounded-by-its-stated-current.md) — a part's dissipation is bounded by the current the design states for it, and by the window span.
9. [0077](0077-a-jack-and-an-led-are-classes.md) — a jack and an LED are classes; a class-valued primary compares by equality.

## Records

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0024](0024-the-device-kind-is-part-or-generic.md) | The Device Kind Is `part` or `generic`, and the Devices Live in One Directory | Accepted | 2026-10-23 |
| [ADR-0025](0025-device-vocabulary-and-parameter-roles.md) | The Device Vocabulary Is Closed and Checked; a Parameter Is a Role and a Quantity | Accepted | 2026-10-23 |
| [ADR-0026](0026-a-part-states-its-own-ratings.md) | A Part States Its Own Ratings, and They Are Checked Against Declared Windows | Accepted | 2026-10-26 |
| [ADR-0027](0027-the-package-gives-a-chip-resistor-its-floor.md) | The Package Gives a Chip Resistor Its Floor | Accepted | 2026-10-23 |
| [ADR-0028](0028-package-code-and-3d-models.md) | The Package Code Lives in the Footprint; 3D Models Belong to Parts | Accepted | 2026-10-22 |
| [ADR-0029](0029-the-procurement-layer.md) | The Procurement Layer — Which Part to Buy Is a Project-Local Decision | Accepted | 2026-10-22 |
| [ADR-0075](0075-a-ratings-polarity-is-the-roles.md) | A Rating's Polarity Is the Role's, and a MOSFET's Rating Covers Both Polarities | Accepted | 2026-11-18 |
| [ADR-0076](0076-a-parts-dissipation-is-bounded-by-its-stated-current.md) | A Part's Dissipation Is Bounded by the Current the Design States for It, and by the Window Span | Accepted | 2026-11-18 |
| [ADR-0077](0077-a-jack-and-an-led-are-classes.md) | A Jack and an LED Are Classes; a Class-Valued Primary Compares by Equality | Accepted | 2026-11-18 |
