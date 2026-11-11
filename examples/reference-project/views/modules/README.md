# Module drawings and the composed project page

This directory holds the reusable module drawings of the reference project. A module drawing is a
view artifact with an extent of its own: it draws one module definition, and a print page places
it. It is advisory — it draws electrical facts, it never states them
([ADR-0068](../../../../docs/adr/09-view/0068-reusable-module-drawings-and-sheet-templates.md)).

The example is module-first: every module is drawn once, on its own, and the project page composes
the drawings. There is no second, full-scale detail page that redraws the same module
([ADR-0071](../../../../docs/adr/09-view/0071-a-module-drawing-is-an-editable-view.md) D3).

| file | what it is |
|---|---|
| `views/modules/charger-power.module-view.teda` | the drawing of `charger-power` (`design/sch/modules/charger-power.teda`), a placement study; local bounds 300 × 210 mm |
| `views/modules/buck-5v.module-view.teda` | the drawing of `buck-5v` (`design/sch/modules/buck-5v.teda`), wired; local bounds 145 × 40 mm |
| `views/modules/mcu-board.module-view.teda` | the drawing of `mcu-board` (`design/sch/modules/mcu-board.teda`), a placement study; local bounds 270 × 190 mm |
| `views/templates/a2.sheet-template.teda` | A2 landscape sheet furniture — border, title block, note; size 594 × 420 mm |
| `views/main.view.teda` | the project's only print page: it places the three drawings on the template and draws the declared interconnects |

## The module drawings

Each file is headed `module_view <module_id>` and declares its own `bounds`. The local origin is the
drawing's upper-left corner, `+x` points right and `+y` points down. The extent belongs to the
drawing, not to a page: a page that places the drawing maps it into the page without scaling, so
each drawing keeps its own size and the page keeps its own.

The identities in a drawing are the module's own — `U1` is the module's `U1`, `VOUT` is the module's
`VOUT` net, and the ports are the module's interface ports. The file names no project net: which
project net a module-instance port belongs to is defined by the project root when that instance is
composed. A page references that project-level module instance when it places the drawing.

A drawing is authored source, and the review app edits it as a drawing: move, rotate, field
placement, label and port moves, and the Source panel. An edit is a module-level change: one module
has one drawing, so every page that places it draws the new picture
([ADR-0071](../../../../docs/adr/09-view/0071-a-module-drawing-is-an-editable-view.md) D3).

The `buck-5v` drawing is wired. The `charger-power` and `mcu-board` drawings are placement studies:
the parts sit on a review grid and the wire runs are laid out during review, one net at a time. A
placement-only drawing is legal; the readability checks report the nets that are not drawn.

## The sheet template

`views/templates/a2.sheet-template.teda` is headed `sheet_template a2` and declares
`size [594,420]`. Everything in it is literal furniture: a border, a title block and a note. The
template says nothing about the project that uses it — no project metadata, no net names, no
page-specific facts. A page that names the template takes the template's size as the page's own
extent, so such a page declares no `size` of its own.

## The composed page

`views/main.view.teda` is the project's only print page. It uses the template for its extent and
furniture and places the three drawings on it:

- `module_place` names the project's module instance (`M1`, `M2`, `M3`), the module it draws, the
  page position of the drawing's upper-left corner and the rotation. The drawing is looked up by the
  module id, so one drawing serves every placement of that module;
- `interconnect` draws the two root-declared cross-PCB joins `ic1` (`M2.VOUT` ↔ `M3.DC_IN`) and
  `ic2` (`M2.GND` ↔ `M3.GND`). The row restates the root's endpoints; it cannot create, remove or
  re-endpoint the fact;
- every part is drawn once, inside its module's drawing. The page has no component `place` of its
  own.

The page is where the extents meet: the drawings keep their own sizes, the page is A2 landscape,
and nothing is scaled to make them fit. A drawing that no longer fits moves or grows the page, not
the drawing.

## What these files are not

None of them changes the circuit. The module drawings and the template are drawing artifacts: they
can be deleted, and the project still validates, still exports the same netlist and still draws its
pages. The electrical truth of `buck-5v` is in `design/sch/modules/buck-5v.teda`; the project's
module instances, nets, ports, constraints and interconnects are in `design/sch/main.teda`.
Physical board implementation facts are in `design/pcb/<pcb_id>.teda`.
