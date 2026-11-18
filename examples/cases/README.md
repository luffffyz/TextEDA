# Cases

Small projects that answer one question each: **can the language say this, and does the IR come out
right?** They are the evidence the syntax-admission rule asks for (`AGENTS.md` §5.2 rule 1): a new
construct has to be used by at least one case here, or it does not go in.

A case is a whole project, not a snippet. The syntax of one line is rarely the risk; the risk is
whether a real board written with these tables stays readable and compiles into the shape the
contract promises.

```
examples/cases/<case_id>/
├── README.md          what it proves, what it deliberately leaves out, which checks it pins
├── project.toml
├── assets/            this case's own devices, symbols and footprints (ADR-0034: no external libs)
├── design/sch/        the board
└── expected/
    ├── ir/**.json     every IR shard, byte for byte
    ├── manifest.json  the manifest without `tool_version`
    ├── netlist.txt    the connectivity projection of every board
    └── diagnostics.json  code + severity + file + line, sorted
```

`bun run cases:check` compares every case with its expectation; `bun run cases:update` rewrites the
expectation. Both are one test in `bun run test`, so a case that changes silently fails CI.

What is pinned and what is not: the shard bytes, the netlist and the project hash are pinned, because that is
what "the IR only depends on meaning" means (`AGENTS.md` §10); the diagnostic **wording** is not, because
reworded prose is not a different design. A case with an `error` diagnostic is not a case — the
corpus is the shape of valid designs, and an error belongs in a negative fixture where the
expectation is the error code alone.

The ten cases (`AGENTS.md` §10, `docs/backlog.md` F12): BGA 200 pins, dual op-amp multi-unit, 20-way
power domains, differential pair, DNP variant, net tie, bus, hierarchy reuse, parameterised divider,
NC pins. Written so far: `dnp-variant`, `dual-opamp-multi-unit`, `nc-pins`, `bus`, `diff-pair`,
`power-domains`, `hierarchy-reuse`, `net-tie`, `parameterised-divider` (9 of 10 — **BGA 200 pins**
is the one still missing).

**One case outside the ten**: `directed-ratings` — a part's rating naming its two terminals
([ADR-0026](../../docs/adr/07-devices/0026-a-part-states-its-own-ratings.md) D4). It is here because
the terminal pair is a language construct, and a construct may only enter the language once a case
uses it (`AGENTS.md` §5.2 rule 1). It joins the same corpus; it does not fill one of the ten slots.

**A second case outside the ten**: `class-devices` — a DC barrel jack and an indicator LED as
**classes**, a class-valued primary compared for **equality**, a `length`-typed parameter column,
and a rating measured in a class reaching the IR as `text`
([ADR-0077](../../docs/adr/07-devices/0077-a-jack-and-an-led-are-classes.md)). Two constructions
and one role entered the language with it, so it has a case too; it does not fill one of the ten
slots either.

**A third case outside the ten**: `polarized-class` — a polarised class names its positive pole
(`positive_pin`), and its voltage requirement is read in that direction: the forward stress across
the two poles against the requirement, and the opposite direction as a reversal rather than a
magnitude ([ADR-0078](../../docs/adr/07-devices/0078-a-polarised-class-names-its-positive-pin.md)).
The scalar entered the language with it, so it has a case too; it does not fill one of the ten slots
either.
