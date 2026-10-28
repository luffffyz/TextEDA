# Devices — decisions

## Scope

The device layer: the two kinds of device, the closed vocabulary of their parameters, the ratings a part states about itself, and the project-local decision of which part to buy.

## Not here

- The footprint and symbol formats — [ADR-0129](../libraries/0129-footprint-format-and-geometry.md).
- How a library is imported — [ADR-0133](../libraries/0133-trust-in-a-library-you-do-not-own.md).

## Reading order

1. [0123](0123-the-device-kind-is-part-or-generic.md) — the kind is a fact of the file, never of the path.
2. [0124](0124-device-vocabulary-and-parameter-roles.md) — the vocabulary is closed, and a parameter is a role and a quantity.
3. [0125](0125-a-part-states-its-own-ratings.md) — a part states its own ratings, and they are checked.
4. [0126](0126-the-package-gives-a-chip-resistor-its-floor.md) — the package gives a chip resistor its floor.
5. [0127](0127-package-code-and-3d-models.md) — the package code lives in the footprint; a 3D model belongs to a part.
6. [0128](0128-the-procurement-layer.md) — which part to buy is a project-local decision.

## Records

| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0123](0123-the-device-kind-is-part-or-generic.md) | The Device Kind Is `part` or `generic`, and the Devices Live in One Directory | Accepted | 2026-10-23 |
| [ADR-0124](0124-device-vocabulary-and-parameter-roles.md) | The Device Vocabulary Is Closed and Checked; a Parameter Is a Role and a Quantity | Accepted | 2026-10-23 |
| [ADR-0125](0125-a-part-states-its-own-ratings.md) | A Part States Its Own Ratings, and They Are Checked Against Declared Windows | Accepted | 2026-10-26 |
| [ADR-0126](0126-the-package-gives-a-chip-resistor-its-floor.md) | The Package Gives a Chip Resistor Its Floor | Accepted | 2026-10-23 |
| [ADR-0127](0127-package-code-and-3d-models.md) | The Package Code Lives in the Footprint; 3D Models Belong to Parts | Accepted | 2026-10-22 |
| [ADR-0128](0128-the-procurement-layer.md) | The Procurement Layer — Which Part to Buy Is a Project-Local Decision | Accepted | 2026-10-22 |
