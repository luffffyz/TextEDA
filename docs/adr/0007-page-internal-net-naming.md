# ADR-0007: The Net Set and Its Names After Flattening (What Happens to In-Page Nets)

Status: Accepted (superseded by ADR-0025)
Date: 2026-10-20
Impact: `teda.md` §7.7; `spec/pcb.md` §5.1, §5.2; amends `docs/adr/0002-board-pages-and-bom.md` (board-level visibility of in-page nets)

> **Retired 2026-10-27 by [ADR-0025](0025-flat-board-and-print-pages.md).**
> This record named the nets of a board whose schematic was split into pages: an unreferenced
> in-page net kept the name `<page_instance_id>.<net>`, and a port binding merged a referenced one
> into a board-level net. Nothing in it applies: a board has one flat schematic, one namespace and
> one set of board-level net names, and the `page` description type is gone. The problem it named
> is not gone — a name unique inside one file is not unique in the board, and the surviving source
> partition answers it with `M1.R1` ([ADR-0024](0024-level-tags-in-flattened-names.md) amended). The
> decision text is in this file's history.
