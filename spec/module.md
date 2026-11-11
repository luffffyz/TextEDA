# `module`: reusable module definitions holding all component facts

> Specification: the `module` description type (since language 0.8), module ports, the flattened
> view of a module instance, and how modules are drawn on print pages.
> Decision: `docs/adr/04-schematic/0013-modules-compose-boards.md`; the project root that composes
> them: `teda.md` §7; PCB ownership of instances: `spec/pcb.md` §4.1 and
> [ADR-0069](../docs/adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md).

## 0. What it is

**A module is a reusable, self-contained piece of circuitry, and it has ports. It owns every
component fact. It is not a drawing split, and it is not board-scoped.**

| | Module | Print page (`view`) |
|---|---|---|
| What it is | A reusable circuit definition; it **owns electrical facts** (instances, nets, constraints) | A split of one drawing / printout |
| File | `design/sch/modules/<module_id>.teda` | `views/<page_id>.view.teda` |
| Description type | `module` | `view` |
| If you delete it | The project loses a piece of circuitry; electrical facts are gone | The drawing is gone; the logic is untouched |
| Does it enter the IR | **Yes**: flattened instances and nets carry an `M` qualified name | **No**: the view is a derived layer |

In one sentence: **a module answers "what is this project made of"; a print page answers "what
does this sheet show"**. Neither may stand in for the other — using a print page as a module hides
electrical facts inside a drawing anyone may delete.

Since language **0.14** ([ADR-0069](../docs/adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md))
the module definition is the **only** place component facts live: the project root
(`design/sch/main.teda`) has no `instances` section and composes modules only. A module instance
belongs wholly to exactly one physical PCB (declared in that PCB's `modules` section,
`spec/pcb.md` §4.1); the module definition itself is **reusable** and may be instantiated on
distinct PCBs — each instance separately.

A project may have many modules (tens is normal); each module has its own `refdes` and net
namespace. The project root composes them.

---

## 1. File

```
version 0.14.0
module buck-5v
```

- The file lives at `design/sch/modules/<module_id>.teda`; `module_id` has the same shape as
  `component_id` (`^[a-z][a-z0-9-]*$`) and is **taken from the file name**.
- The `module_id` in the file header must match the file name, otherwise it is an error (same rule
  as `component`, `AGENTS.md` §4.5).
- The `module` type exists since language **0.8**; a file below 0.8 cannot be a `module`. Its
  reader floor stays `0.8` through the 0.14 rework: the 0.14 change rewires the *composition*
  (who instantiates modules and where they live physically), not the module surface.
- Since language **0.9**, an instance row may carry a stable UID as its second cell
  (`C1 ID7k3m9q cap-mlcc-1210 …`). The UID is project-scoped, immutable and duplicate-checked
  ([ADR-0010](../docs/adr/03-project/0010-instance-identity-is-a-uid.md)); module-local UIDs may
  repeat across module instances and are path-qualified when flattened (§5).

## 2. Sections

```
version 0.14.0
module buck-5v

instances
  C1    cap-mlcc-1210    10u    10%  35V
  C2    cap-mlcc-0402    10n    10%  25V
  C3    cap-tantalum-7343    220u   20%  10V  40mΩ
  C4    cap-mlcc-0402    100n   10%  16V
  D1    d-b340a
  L1    ihlp4040dzer150m11
  R1    res-thick-0402    10k    ±1%
  R2    res-thick-0402    3.24k  ±1%
  U1    tps5430ddar

nets
  BOOT:  U1.BOOT  C2.1
  GND:   U1.GND  U1.PAD  C1.2  C3.N  C4.2  D1.A  R2.2
  PH:    U1.PH  C2.2  D1.K  L1.1
  SYS:   U1.VIN  C1.1
  VFB:   U1.VSENSE  R1.2  R2.1
  VOUT:  L1.2  R1.1  C3.P  C4.1

ports
  GND     GND
  SYS_IN  SYS
  VOUT    VOUT

constraints
  voltage  SYS   9V..19.8V
  voltage  VOUT  4.85V..5.15V
  voltage  VFB   1.203V..1.239V
  current  VOUT  3A
```

| Section | Content | Note |
|---|---|---|
| `instances` | `<refdes> [uid] <component_id> [params…]` | The **only** place components are placed in the whole project (`teda.md` §6) |
| `nets` | `<net>: <pin refs>…` | Pin refs resolve in the **module's own** namespace (`U1.BOOT` is this module's U1) |
| `ports` | `<port name> <net inside the module>` | The module's interface, see §3 |
| `constraints` | `<kind> <net> <value>` | Applies to the module's own nets |

- A module has **no** `bus` section, **no** `pages` section, and **no** `modules` section: a module
  cannot contain another module (the hierarchy is one level deep, `docs/backlog.md` F13).
- `refdes` and net names are unique **only inside their module**. Two modules may each have an
  `R1`; after flattening they are `M1.R1` and `M2.R1` (§5).
- A module-local UID is local to the definition, so two module instances may use the same local
  UID. The flattened `instance.uid` is path-qualified: `<module instance uid>/<local uid>`
  (e.g. `IDp8x2n4/ID7k3m9q`). A module instance UID is required for that path to exist. Net
  members and the view still reference the display name (`M1.R1`), not the UID.


## 3. Ports: the module's interface

Each line of the `ports` section is `<port name> <net inside the module>`:

- The **port name** is the module's outward-facing name. It **may differ** from the internal net
  name (above, the internal net `SYS` is called `SYS_IN` outside). How the module names things
  internally is the module's business; consumers only know port names.
- A port name is unique inside the module; a net is referenced by at most one port.
- A port that is **deliberately left unconnected** says `no_connect`:

  ```
  ports
    GND     GND
    SPARE   no_connect
  ```

  `no_connect` is a keyword here (not a net name). A port that nothing references and that does
  not say `no_connect` is an error (§6) — a port is an interface, not an optional comment.

A port **creates no connection** (same meaning as the root `ports` section, `teda.md` §7.4): it
only gives an outward name to a net that already exists inside the module.

**What a port is consumed by** — and who owns each fact:

| Fact | Owner | Where |
|---|---|---|
| Instantiating the module | the project root, `modules` section | `teda.md` §7.1 |
| Merging a port's net into a root net | the project root, `nets` section | `teda.md` §7.2 |
| A cross-PCB path from this port | the project root, `interconnects` row | `teda.md` §7.5 |
| Which PCB owns the instance | that PCB, `modules` section | `spec/pcb.md` §4.1 |
| Drawing the port | a print page / module view | `spec/schematic-view.md` |

## 4. Module instances in the project root

The project root (`design/sch/main.teda`) composes modules:

```
version 0.14.0
schematic main

modules
  M1  IDp8x2n4  charger-power
  M2  IDk2m8q4  buck-5v

nets
  AC_COMMON:  M1.AC_RET
  ADAPTER_P:  M1.DC_IN
  GND:        M1.GND  M2.GND
  SYS:        M1.SYS_OUT  M2.SYS_IN
  VBAT:       M1.BAT
  VOUT:       M2.VOUT

ports
  AC_RET   AC_COMMON
  BAT      VBAT
  DC_IN    ADAPTER_P
  GND      GND
  VOUT_5V  VOUT
```

| Column | Meaning |
|---|---|
| `<module_instance_id>` | Module instance id, shape `^M[0-9]+$` (`M1`, `M2`, …). The level tag is `M` ([ADR-0012](../docs/adr/04-schematic/0012-one-flat-schematic-per-board.md)) |
| `<uid>` | Optional stable module-instance UID since 0.9, shape `^ID[0-9a-hjkmnp-tv-z]{6}$` ([ADR-0010](../docs/adr/03-project/0010-instance-identity-is-a-uid.md)) |
| `<module_id>` | Module definition id, matching `design/sch/modules/<module_id>.teda` |

- The same module may be instantiated several times (`M1` and `M2` both point at `buck-5v`); they
  are electrically identical (this version has no parameters, see §10).
- **The root has no `instances` section** (0.14): there are no board-level components. An LED, a
  connector, a fuse — anything with a footprint — lives in a module definition. If it is shared,
  define one module and instantiate it where needed.
- **The root does not assign PCB ownership**. Each module instance is owned by exactly one PCB,
  named in that PCB file (`spec/pcb.md` §4.1); the root stays physical-free. The `M` + digits
  shape is reserved for module instances; nothing else in the project may use it.

### 4.1 Module port references inside root nets

A root `nets` section has one kind of member:

| Member | Meaning |
|---|---|
| `<module_instance_id>.<port name>` | A port of a module instance (`M2.VOUT`) |

A port reference merges the **net inside the module into the root net** (the root net's name and
members decide). Reaching into a module's interior (`M1.R1.2`) is `ref.module-internal-ref`
(error) — the outside world sees ports, pins stay inside.

## 5. Flattening

The project IR is the **flattened result**: one instance table, one net table, **no module
structure** in the tables themselves (the `modules` array records instances and their port/pin
mappings for endpoint validation; the connectivity tables are flat). Constraint 1 of
`docs/backlog.md` F13; the IR contract is `v0.19` ([ADR-0069](../docs/adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md)).

| Thing | After flattening |
|---|---|
| Instance `R1` of module `M1` | Instance id `M1.R1` |
| Internal net `VCC` of module `M1` | Net `M1.VCC` (until the root merges it) |
| Internal net `SYS` of module `M1` (bound by port `SYS_OUT` to root net `SYS`) | Merged into root net `SYS`; the internal name `M1.SYS` disappears |
| A port of module `M1` | Gone from the net tables (it is an interface, not a fact); the binding shows up as a net merge; the port's local pin set survives in the `modules` array |
| A constraint of module `M1` | Lands on the net it applies to: a constraint on a merged net lands on the root net, the rest on `M1.<net>` |
| Root nets and ports | Kept as they are, names unprefixed |

Rules:

1. **Qualified names are one level deep**: `M1.R1` is the instance inside module instance `M1`,
   `M1.R1.2` is its pin. A module cannot contain a module.
2. **The root namespace and the module namespaces are separate**: a root net is a bare name
   (`GND`), a module's internal net is qualified (`M1.VCC`).
3. **Port binding is one to one**: a module port is referenced by at most one root net (otherwise
   `net.port-in-two-nets`); a root net may reference several module ports.
4. **An unbound port is an error** (`ref.unbound-port`), unless it says `no_connect`.
5. **Flattening does not change connectivity**: a merge only folds two names of one node into one.

## 6. Diagnostics

| Code | When | Severity |
|---|---|---|
| `ref.unknown-module` | A `module_id` in the root `modules` section has no `design/sch/modules/<module_id>.teda` | error |
| `ref.module-id-mismatch` | The id in the module file header does not match the file name | error |
| `ref.unknown-port` | A root net or interconnect endpoint references a port the module does not declare | error |
| `ref.unbound-port` | A module port is referenced by no root net / interconnect and does not say `no_connect` | error |
| `ref.no-connect-port` | A root net or interconnect endpoint references a port that says `no_connect` | error |
| `ref.module-internal-ref` | A root net, constraint, or interconnect endpoint reaches into a module's interior (`M1.R1.2`, a module-internal net name) | error |
| `ref.duplicate-interconnect` | An `interconnect_id` appears twice in one root | error |
| `ref.pin-off-endpoint-net` | An `interconnect_pins` pin ref does not lie on the endpoint's module-local port net | error |
| `net.port-in-two-nets` | One module port is referenced by two root nets | error |
| `ref.duplicate-port-net` | One net inside a module is referenced by two ports | error |
| `syntax.invalid-identifier` | An id uses the reserved module-instance shape without being one | error |
| `format.unsupported-version` | The module file declares a language version below 0.8 | error |

Ownership checks (an instance claimed by zero or two PCBs; an interconnect whose endpoints sit on
the same PCB) are **core**, not parser: `spec/pcb.md` §5.2.

## 7. Relation to print pages

A print page (`view`) **draws** modules; it never defines them. The page syntax — sections,
coordinates, page size, and the page-local checks — is specified in
[`spec/schematic-view.md`](schematic-view.md); this section states only what a module owes the
view layer.

A print page references **root-level** ids, so once modules are instantiated the instances in a
print page are written `M1.U1`, `M2.U1` ([ADR-0035](../docs/adr/09-view/0035-the-view-layer-is-a-drawing.md), [ADR-0012](../docs/adr/04-schematic/0012-one-flat-schematic-per-board.md) decision 4).

### 7.1 Page conventions and reusable module drawings

Page IDs identify files, not page roles ([ADR-0067](../docs/adr/09-view/0067-hierarchical-module-views-and-custom-page-size.md) D1; [ADR-0068](../docs/adr/09-view/0068-reusable-module-drawings-and-sheet-templates.md) D1). `main` remains a convention for an overview page using `module` and `module_port`; any page ID may instead be used for component detail, and a page's declarations determine what it draws.

- A page may mix components from different modules or split a module's components across pages. A page ID matching a module ID does not imply ownership.
- Legacy overview rows draw a box per module instance and locate its exposed ports; page-level wires may show root-level bindings. These are drawing-only, as specified in `spec/schematic-view.md` §§4.2–5.
- A reusable module-local drawing is a separate `module_view` artifact, keyed by module definition ID and with independent local `bounds`. It uses the module's internal instance, net, and port identities, and may be previewed independently or placed repeatedly on composed pages. The complete syntax, local-bounds checks, and canonical coordinate transform are specified in `spec/schematic-view.md` §§12 and 14.
- A composed page may also reference a static `sheet_template` whose `size` supplies the page extent. The template, module drawing, and composed page are advisory view artifacts; the complete rules are in `spec/schematic-view.md` §§13–14.
- On composed pages, a module port wire endpoint `M1.PORT` gets its coordinate from the local module drawing's port row and the canonical placement transform, but its net only from the root-level binding. Repeated placements are valid; endpoint coordinates resolve through the first canonical placement ordered by `(module_instance_id, x, y)`, independently of source row order (see `spec/schematic-view.md` §§11, 14.4).

### 7.2 Electrical authority

**The module files and the project root own every electrical fact; a view only references them.**

| Fact | Owner |
|---|---|
| A module's instances, internal nets, constraints | the module file (§2) |
| A module's exposed ports | the module file, `ports` section (§3) |
| Which module instances the project has | the project root, `modules` section (`teda.md` §7.1) |
| Which root net a module port is bound to | the project root, `nets` section (`teda.md` §7.2) |
| A cross-PCB path between two ports | the project root, `interconnects` (`teda.md` §7.5) |
| Which PCB owns a module instance | the PCB file, `modules` section (`spec/pcb.md` §4.1) |

Therefore:

- An overview `module_port` or a composed-page module-port endpoint must name a port the referenced module actually declares, and the page wire must use the root net bound to that module instance's port. A drawing cannot invent, move, or re-bind a port; composed-page coordinates are resolved as described in §7.1 and `spec/schematic-view.md` §14.4.
- A legacy overview on `main` must draw every module instance exactly once as a box; an unknown or duplicated instance is an error. This overview-specific check does not impose an appearance requirement on other page conventions.
- A legacy overview wire may not cross a module box except at its own module-port endpoints.
- A view never creates, moves, or removes a connection — page wires draw bindings already stated in the root's `nets` section, interconnects stay interconnects, and a disagreement is reported in favour of the root files (`AGENTS.md` §2, rule 2). Deleting or editing a page cannot create or remove an interconnect.

Print pages do **not** affect the IR: they are only a drawing. Delete every print page and the project is still complete, checkable, and exportable to a netlist.

## 8. Positive example

```
# design/sch/modules/buck-5v.teda
version 0.14.0
module buck-5v
instances
  U1  tps5430ddar
nets
  VOUT:  U1.VOUT
ports
  VOUT  VOUT

# design/sch/main.teda
version 0.14.0
schematic main
modules
  M1  buck-5v
nets
  VOUT:  M1.VOUT
ports
  VOUT_5V  VOUT
```

After flattening: instance `M1.U1`; net `VOUT` has member `M1.U1.VOUT` (the module's internal net
`VOUT` is merged into the root net `VOUT`).

## 9. Counter-examples

```
# A module port is referenced by no root net and does not say no_connect
version 0.14.0
module buck-5v
instances
  U1  tps5430ddar
nets
  VOUT:  U1.VOUT
ports
  VOUT  VOUT
```

-> `ref.unbound-port`: port `VOUT` reaches no net at the root; either reference `M1.VOUT` in the
root's `nets` section or write `no_connect`.

```
# Root reaching into a module's interior
version 0.14.0
schematic main
modules
  M1  buck-5v
nets
  VOUT:  M1.R1.2
```

-> `ref.module-internal-ref`: the root sees ports only; pin `M1.R1.2` must be exported through a
module port first.

## 10. What this version does not have

- **No parameters**: a module instance cannot override values inside the module (constraint 3 of
  `docs/backlog.md` F13). Instantiating the same module several times yields electrically
  identical copies.
- **No nesting**: a module cannot contain a module.
- **No cross-project module library**: modules live inside the project (the `design/sch/modules/`
  directory).
- **No `use` / `import`**: the module id is the file name.
- **No per-instance PCB metadata at the root**: ownership is a PCB fact (`spec/pcb.md` §4.1), not
  a module fact — the same definition may be instantiated on different PCBs.
