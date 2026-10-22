# ADR-0001: How Boards Are Linked Together

Status: Accepted
Date: 2026-10-20
Impact: `teda.md` §7.5, §8; `AGENTS.md` §2, §4.1, §9, §11

## Background

The project is a multi-board system (in the reference project: `charger` + `buck-5v`). In v0.1 there is only "one `sch` per board", with no way of relating boards to each other:

- A board cannot reference another board; otherwise board A has to follow every change made to board B, which breaks the invariant that "sch is an independent description, just like pcb" (`AGENTS.md` §2 item 12).
- `project.toml` carries metadata only (board list, variants, library locks), not circuits.
- Intra-board hierarchy (`module` + port mapping) is not defined yet (`AGENTS.md` §5.3, `teda.md` §15), so it cannot be passed off as inter-board connectivity.

In real projects, inter-board connection is an **interface problem**: which node of which board leaves the board, over which wire / which connector pair, and into which node of the other board. This kind of information belongs neither to the internal circuit of any single board nor to project metadata, so it needs a place of its own.

## Decision

1. **Board side**: `sch` gains an optional `ports` segment that declares "which nodes does this board expose to the outside".

   ```
   ports
     GND      GND
     SYS_OUT  SYS
   ```

   Columns: `<port_id> <net>`.

   - A `port` may only reference a `net` that already exists in this `sch`; it cannot conjure a node into being.
   - A `net` may be referenced by at most one `port` (so that the same node never ends up with two outward identities).
   - A `port` adds no connectivity whatsoever; it only gives an existing node an **outside-the-board name**.
   - `net` names inside a board may be anything; cross-board alignment goes through `port`, not through `net` names.

2. **System side**: a new description type `system`, with files in `design/system/<system_id>.teda`.

   ```
   version 0.2
   system charger-stack

   boards
     buck-5v
     charger

   nets
     GND:  buck-5v.GND  charger.GND
     SYS:  buck-5v.SYS_IN  charger.SYS_OUT
   ```

   - `boards` segment: lists the board ids that take part in this system; every id must exist in `[boards]` of `project.toml` and have a `design/sch/<board_id>.teda`.
   - `nets` segment: `<system_net>: <board_id>.<port_id> ...` (canonical form: the net name sits flush against the colon, with at least two spaces between members); members are **port references**, and a system net has at least two members.

3. **Semantics**: a `system` net merges the intra-board `net`s pointed at by its member ports into one system-level node. The `net` names on the two board sides may differ.

4. **`project.toml` stays unchanged**. The board list remains in `[boards]`; the `system` file only references it and does not redeclare `revision`.

5. **Version**: the `ports` segment and the `system` description type are a MINOR change → format version `0.2`. Files that use the new constructs write `version 0.2`; files that do not keep `version 0.1` (tools accept the same MAJOR with MINOR ≤ their own version).

## Rejected Alternatives

| Option | Why it was rejected |
|---|---|
| Cross-board references inside a board, e.g. `include charger` | The boards become mutually coupled; changing one board forces changes in the other; violates "sch is an independent description" |
| Writing inter-board connectivity into `project.toml` | Metadata does not hold circuits; otherwise `project.toml` becomes a second circuit syntax |
| Using intra-board `module` hierarchy instead | Intra-board reuse ≠ inter-board connection; the former is "a module inside the same board", the latter is "another physical object" |
| Binding `port` directly to connector pins | That couples v0.2 to the mechanical interface. A connector is an ordinary component whose pins are already on a `net`; once the mechanical interface is settled, add the connector component on the corresponding `net` — neither the ports nor the system description have to change |

## Consequences

- A board remains a unit that can be reviewed and exported on its own; the system description is an **extra** layer — delete it and both boards still stand.
- Cross-board connectivity now has a single source of truth (the `system` file), so the "SYS is 9V in board A's netlist but 5V in board B's netlist" kind of situation — each side telling its own story — can no longer happen.
- The board-to-board interface (`port`) becomes a checkable object: non-overlapping voltage ranges on the two sides, or one node merged into two system nets, can be reported as errors instead of being caught by the human eye during review.
- Cost: one more description type, one more directory, one more set of check rules.

## Follow-up (out of scope for this ADR)

- One `port` exposing several `net`s (grouping all the signals of one physical connector into one interface group).
- Endpoints outside the boards (adapter, battery, load): `system` will need a third member kind (`external`), to be discussed in v0.3.
- How wire harnesses and connector pairs (the "declared in pairs" note in `AGENTS.md` §4.1) relate to the net merging of this ADR.
- Intra-board `module` hierarchy: orthogonal to this ADR, still to be discussed along the table boundaries of `AGENTS.md` §5.3.
