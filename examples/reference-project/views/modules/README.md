# Module drawings, sheet templates and composed pages

This directory holds the reusable module drawings of the reference project. A module drawing is a
view artifact with an extent of its own: it draws one module definition, and a print page places
it. It is advisory — it draws electrical facts, it never states them
([ADR-0068](../../../../docs/adr/09-view/0068-reusable-module-drawings-and-sheet-templates.md)).

Language `0.14.0` introduced the three kinds of artifact this example shows. All of them live under
`views/`, and all of them are optional: a project with no module drawings and no template still
validates, still exports a netlist, and still draws its available print pages.

| file | what it is |
|---|---|
| `views/modules/buck-5v.module-view.teda` | the module drawing of the module `buck-5v` (`design/modules/buck-5v.teda`); local bounds 145 × 40 mm |
| `views/templates/a4.sheet-template.teda` | A4 landscape sheet furniture — border, title block, notes table, logo; size 297 × 210 mm |
| `views/composed.view.teda` | a project print page that uses the template, places the module drawing and wires project ports and nets to the module's ports |

## The module drawing

`views/modules/buck-5v.module-view.teda` is headed `module_view buck-5v` and declares its own
extent with `bounds [145,40]`. The local origin is the drawing's upper-left corner, `+x` points
right and `+y` points down. The extent belongs to the drawing, not to a page: a page that places
the drawing maps it into the page without scaling, so the drawing keeps its 145 × 40 mm and the
page keeps its own size.

The identities in the file are the module's own — `U1` is the module's `U1`, `VOUT` is the module's `VOUT`
net, and the three ports (`GND`, `SYS_IN`, `VOUT`) are the module's interface ports. The
file names no project net: which project net a module-instance port belongs to is defined by the
project root when that instance is composed. A page references that project-level module instance
when it places the drawing. The geometry is the reusable drawing for the `buck-5v` module, corresponding
to the project detail page (`views/buck-5v.view.teda`) with the project's `M2.` prefixes dropped,
the project's `VOUT_5V` port replaced by the module's own `VOUT` port, and the module's `SYS_IN`
input port drawn at the module boundary where the project's `SYS` net reaches it.

## The sheet template

`views/templates/a4.sheet-template.teda` is headed `sheet_template a4` and declares
`size [297,210]`. Everything in it is literal furniture: a border, a title block, a notes table and
a logo mark drawn as a polyline. The template says nothing about the project that uses it — no
project metadata, no net names, no page-specific facts. A page that names the template takes the
template's size as the page's own extent, so such a page declares no `size` of its own.

## The composed page

`views/composed.view.teda` puts the two together:

- `template a4` gives the page its extent — the page is A4 landscape, 297 × 210 mm, and the
  template's furniture is drawn underneath whatever the page places;
- `module_place` places the module drawing: `M2  buck-5v  [45.0,20.0]  0` and
  `M2  buck-5v  [235.0,15.0]  90`. The row names the project's module instance (`M2`), the module it
  draws (`buck-5v`), the page position of the drawing's upper-left corner and the rotation. The
  second placement is the same drawing turned a quarter turn: the drawing is looked up by the
  module id, so one drawing serves every page that wants it, as often as it wants it;
- the `wire` section is project-level: the project's ports `GND` and `VOUT_5V` reach module instance
  `M2` through its ports `M2.GND` and `M2.VOUT`, on the project nets defined by `design/sch/main.teda`.
  The module drawing knows nothing about those project net bindings.

The page is where the two extents meet: the drawing is 145 × 40 mm, the page is 297 × 210 mm, and
nothing is scaled to make them fit.

## Two names differ from the original request

- **The module drawing is `buck-5v`, not `power`.** The file name of a module drawing is the
  module id, and the reference project has modules `charger-power`, `buck-5v`, and `mcu-board`.
  There is no module called `power`, so the drawing uses the id that exists — `buck-5v`, the compact
  5 V converter used by the project.
- **The composed page is `views/composed.view.teda`, not `views/reference/`.** A print page lives at
  `views/<page_id>.view.teda`; here the page id is `composed`. The project root
  `design/sch/main.teda` owns the module instance `M2` and its project-level net bindings.
  `views/modules/` and `views/templates/` hold reusable artifacts; physical PCB ownership remains
  in `design/pcb/<pcb_id>.teda`.

## What these files are not

None of them changes the circuit. The module drawing and the template are drawing artifacts: they
can be deleted, and the project still validates, still exports the same netlist and still draws its
pages. The electrical truth of `buck-5v` is in `design/modules/buck-5v.teda`; the project's module
instances, nets, ports, constraints and interconnects are in `design/sch/main.teda`. Physical board
implementation facts are in `design/pcb/<pcb_id>.teda`.
