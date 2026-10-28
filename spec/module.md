# `module`: hierarchy inside a board

> Specification: the `module` description type (since language 0.8), the `modules` section of a board file, module ports and their binding to board nets, and the flattening rules.
> Decision: `docs/adr/schematic/0112-modules-compose-boards.md`; the relation to the board-level description: `teda.md` §7.6.

## 0. What it is

**A module is a hierarchy level inside a board, and it has ports. It is not a drawing split.**

| | Module | Print page (`view`) |
|---|---|---|
| What it is | A piece of circuitry inside a board; it **owns electrical facts** | A split of one drawing / printout |
| File | `design/modules/<module_id>.teda` | `views/<board_id>/<page_id>.view.teda` |
| Description type | `module` | `view` |
| If you delete it | The board loses a piece of circuitry; electrical facts are gone | The drawing is gone; the logic is untouched |
| Does it enter the IR | **Yes**: flattened instances and nets carry an `M` qualified name | **No**: the view is a derived layer |

In one sentence: **a module answers "what is this board made of"; a print page answers "what does this sheet show"**. Neither may stand in for the other — using a print page as a module hides electrical facts inside a drawing anyone may delete.

A board may have many modules (tens is normal); each module has its own `refdes` and net namespace. The board composes them.

---

## 1. File

```
version 0.9.1
module buck-5v
```

- The file lives at `design/modules/<module_id>.teda`; `module_id` has the same shape as `component_id` (`^[a-z][a-z0-9-]*$`) and is **taken from the file name**.
- The `module_id` in the file header must match the file name, otherwise it is an error (same rule as `component`, `AGENTS.md` §4.5).
- The `module` type exists since language **0.8**; a file below 0.8 cannot be a `module`.
- Since language **0.9**, an instance row may carry a stable UID as its second cell
  (`C1 ID7k3m9q cap-mlcc-1210 …`); the board's `modules` row likewise carries the module
  instance's UID (`M1 IDp8x2n4 charger-power`). The UID is project-scoped, immutable and
  duplicate-checked ([ADR-0109](../docs/adr/project/0109-instance-identity-is-a-uid.md)).
  In a 0.9 file a missing UID is reported as a warning; in a 0.8 or older file the row keeps
  name identity and no warning is emitted.

## 2. Sections

```
version 0.9.1
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
| `instances` | `<refdes> [uid] <component_id> [params…]` | Exactly the syntax of the board-level `instances` section (`teda.md` §7.1) |
| `nets` | `<net>: <pin refs>…` | Pin refs resolve in the **module's own** namespace (`U1.BOOT` is this module's U1) |
| `ports` | `<port name> <net inside the module>` | The module's interface, see §3 |
| `constraints` | `<kind> <net> <value>` | Applies to the module's own nets |

- A module has **no** `bus` section, no `pages` section, and no `modules` section: a module cannot contain another module (the hierarchy is one level deep, `docs/backlog.md` F13).
- `refdes` and net names are unique **only inside their module**. Two modules may each have an `R1`; after flattening they are `M1.R1` and `M2.R1` (§5).
- A module-local UID is local to the definition, so two module instances may use the same local
  UID. The flattened `instance.uid` is path-qualified: `<module instance uid>/<local uid>`
  (e.g. `IDp8x2n4/ID7k3m9q`). A module instance UID is required for that path to exist. Net
  members and the view still reference the display name (`M1.R1`), not the UID.

## 3. Ports: the module's interface

Each line of the `ports` section is `<port name> <net inside the module>`:

- The **port name** is the module's outward-facing name. It **may differ** from the internal net name (above, the internal net `SYS` is called `SYS_IN` outside). How the module names things internally is the module's business; the board only knows port names.
- A port name is unique inside the module; a net is referenced by at most one port.
- A port that is **deliberately left unconnected** says `no_connect`:

  ```
  ports
    GND     GND
    SPARE   no_connect
  ```

  `no_connect` is a keyword here (not a net name). A port that no board-level net references and that does not say `no_connect` is an error (§6) — a port is an interface, not an optional comment.

A port **creates no connection** (same meaning as the board-level `ports` section, `teda.md` §7.5): it only gives an outward name to a net that already exists inside the module.

## 4. Module instances in a board

The board file (`design/sch/<board_id>.teda`) gains a `modules` section:

```
version 0.9.1
schematic charger-buck

modules
  M1  charger-power
  M2  buck-5v

instances
  LED1  led-green

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
| `<module_instance_id>` | Module instance id, shape `^M[0-9]+$` (`M1`, `M2`, …). The level tag is `M` ([ADR-0111](../docs/adr/schematic/0111-one-flat-schematic-per-board.md)) |
| `<uid>` | Optional stable module-instance UID since 0.9, shape `^ID[0-9a-hjkmnp-tv-z]{6}$` ([ADR-0109](../docs/adr/project/0109-instance-identity-is-a-uid.md)) |
| `<module_id>` | Module definition id, matching `design/modules/<module_id>.teda` |

- The same module may be instantiated several times in one board (`M1` and `M2` both point at `buck-5v`); they are electrically identical (this version has no parameters, see §10).
- **The `M` + digits shape belongs to module instances**: a board-level `refdes` must not use it (`M2` cannot be a board-level refdes), otherwise a reference like `M2.VOUT` cannot be read as "port VOUT of module M2" versus "pin of instance M2". Error: `syntax.invalid-identifier`.
- The board-level `instances` section and the `modules` section **may coexist**: parts that belong to no module (an LED, a connector) are written directly in the board file with ordinary refdes.

### 4.1 Module port references inside board nets

A board-level `nets` section has two kinds of members:

| Member | Meaning |
|---|---|
| `<refdes>.<pin>` | A pin of a board-level instance (`R1.2`) |
| `<module_instance_id>.<port name>` | A port of a module instance (`M2.VOUT`) |

A port reference merges the **net inside the module into the board-level net** (the board-level net's name and members decide). That net is therefore part of the board, and the board-level `ports` section may give it an outward name of its own.

## 5. Flattening

The board-level IR is the **flattened result**: one instance table, one net table, **no module structure** (constraint 1 of `docs/backlog.md` F13; the IR contract is still 0.2).

| Thing | After flattening |
|---|---|
| Instance `R1` of module `M1` | Instance id `M1.R1` |
| Internal net `VCC` of module `M1` | Net `M1.VCC` |
| Internal net `SYS` of module `M1` (bound by port `SYS_OUT` to board net `SYS`) | Merged into board net `SYS`; the internal name `M1.SYS` disappears |
| A port of module `M1` | Gone (it is an interface, not a fact); the binding shows up as a net merge |
| A constraint of module `M1` | Lands on the net it applies to: a constraint on a merged net lands on the board net, the rest on `M1.<net>` |
| Board-level instances and nets | Kept as they are, names unprefixed |

Rules:

1. **Qualified names are one level deep**: `M1.R1` is the instance inside module instance `M1`, `M1.R1.2` is its pin. A module cannot contain a module.
2. **The board namespace and the module namespaces are separate**: a board net is a bare name (`GND`), a module's internal net is qualified (`M1.VCC`). A board refdes is a bare name, a module instance is qualified.
3. **Port binding is one to one**: a module port is referenced by at most one board net (otherwise `net.port-in-two-nets`); a board net may reference several module ports.
4. **An unbound port is an error** (`ref.unbound-port`), unless it says `no_connect`.
5. **Flattening does not change connectivity**: a merge only folds two names of one node into one.

## 6. Diagnostics

| Code | When | Severity |
|---|---|---|
| `ref.unknown-module` | A `module_id` in the `modules` section has no `design/modules/<module_id>.teda` | error |
| `ref.module-id-mismatch` | The id in the module file header does not match the file name | error |
| `ref.unknown-port` | A board net references a port the module does not declare | error |
| `ref.unbound-port` | A module port is referenced by no board net and does not say `no_connect` | error |
| `ref.no-connect-port` | A board net references a port that says `no_connect` | error |
| `ref.module-internal-ref` | A board net reaches into the module's interior (`M1.R1.2`) | error |
| `net.port-in-two-nets` | One module port is referenced by two board nets | error |
| `ref.duplicate-port-net` | One net inside a module is referenced by two ports | error |
| `syntax.invalid-identifier` | A board `refdes` uses the module instance shape (`M2`), or a module instance id is not `M` + digits | error |
| `format.unsupported-version` | The module file declares a language version below 0.8 | error |

## 7. Relation to print pages

A print page (`view`) references **board-level** ids, so once modules are instantiated the instances in a print page are written `M1.U1`, `M2.U1` ([ADR-0134](../docs/adr/view/0134-the-view-layer-is-a-drawing.md), [ADR-0111](../docs/adr/schematic/0111-one-flat-schematic-per-board.md) decision 4). One print page may draw several modules, or only part of one module.

Print pages do **not** affect the IR: they are only a drawing. Delete every print page and the board is still complete, checkable, and exportable to a netlist.

## 8. Positive example

```
# modules/buck-5v.teda
version 0.9.1
module buck-5v
instances
  U1  tps5430ddar
nets
  VOUT:  U1.VOUT
ports
  VOUT  VOUT

# sch/charger-buck.teda
version 0.9.1
schematic charger-buck
modules
  M1  buck-5v
nets
  VOUT:  M1.VOUT
ports
  VOUT_5V  VOUT
```

After flattening: instance `M1.U1`; net `VOUT` has member `M1.U1.VOUT` (the module's internal net `VOUT` is merged into the board net `VOUT`).

## 9. Counter-examples

```
# A module port is referenced by no board net and does not say no_connect
version 0.9.1
module buck-5v
instances
  U1  tps5430ddar
nets
  VOUT:  U1.VOUT
ports
  VOUT  VOUT
```

-> `ref.unbound-port`: port `VOUT` reaches no net on the board; either reference `M1.VOUT` in the board's `nets` section or write `no_connect`.

```
# A board refdes takes the module instance shape
version 0.9.1
schematic charger-buck
instances
  M2  led-green
modules
  M2  buck-5v
```

-> `syntax.invalid-identifier`: the shape `M2` belongs to module instance ids; a board-level refdes cannot use it.

## 10. What this version does not have

- **No parameters**: a module instance cannot override values inside the module (constraint 3 of `docs/backlog.md` F13). Instantiating the same module several times yields electrically identical copies.
- **No nesting**: a module cannot contain a module.
- **No cross-project module library**: modules live inside the project (the `design/modules/` directory).
- **No `use` / `import`**: the module id is the file name.
