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
├── assets/            this case's own devices, symbols and footprints (ADR-0133: no external libs)
├── design/sch/        the board
└── expected/
    ├── ir/**.json     every IR shard, byte for byte
    ├── manifest.json  the manifest without `tool_version`
    ├── netlist.txt    the connectivity projection of every board
    └── diagnostics.json  code + severity + file + line, sorted
```

`bun run cases:check` compares every case with its expectation; `bun run cases:update` rewrites the
expectation. Both are one test in `bun test`, so a case that changes silently fails CI.

What is pinned and what is not: the shard bytes, the netlist and the project hash are pinned, because that is
what "the IR only depends on meaning" means (`AGENTS.md` §10); the diagnostic **wording** is not, because
reworded prose is not a different design. A case with an `error` diagnostic is not a case — the
corpus is the shape of valid designs, and an error belongs in a negative fixture where the
expectation is the error code alone.

The ten cases (`AGENTS.md` §10, `docs/backlog.md` F12): BGA 200 pins, dual op-amp multi-unit, 20-way
power domains, differential pair, DNP variant, net tie, bus, hierarchy reuse, parameterised divider,
NC pins. Written so far: `dual-opamp-multi-unit`, `nc-pins`, `bus`, `diff-pair`.
