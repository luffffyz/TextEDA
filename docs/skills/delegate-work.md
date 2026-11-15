# Skill: Delegate Work to Subagents

> **Audience**: agents that split a job across subagents and have to accept, reject, or price the
> result.
> **Scope**: choosing what to delegate, writing a slice, dispatching it, supervising it, accepting
> it, and measuring what it cost.
> **Not in scope**: what to build (that is the rest of `docs/skills/`); the harness's own settings
> and configuration; the design rules (they live in [`spec/`](../../spec/) and the
> [ADRs](../adr/README.md)).
>
> **Two layers.** §1, §2 and §5 are the contract: they hold whatever your harness's subagent tool
> looks like. §3, §4 and §6 describe the surface this repository's agents actually run under — a
> `task` tool with one child per call. Keep the contract, map the rest to what you have.

Index: [`docs/skills/README.md`](README.md) lists the procedures and when to read which.

## 1. Decide: delegate, script, or do it yourself

### 1.1 Delegate only what a gate can adjudicate

| Delegate | Do not delegate |
|---|---|
| Enumeration and inventory over a named file set | Prose readability (ADR bodies, READMEs) |
| Audits with a fixed question and a fixed output shape | Visual geometry (symbols, footprints, print pages) |
| Pure deletions plus reference cleanup | Semantic changes to a shared gate script |
| Mechanical migrations | Anything whose correctness is a taste call |
| Refactors a command can check (`bun run test`, `bun run check`, `bun run fmt:teda --check .`) | The design of the thing being changed |

The test is not "is it big" — it is "**can a command tell me it is right?**" If a human has to
read the diff and decide, the diff is yours to read, so the work in the main session.

There is no setting that filters delegation by work type: a harness may nudge you toward
delegating harder, but it never decides what deserves delegating. The boundary is the rule you
write down — here, this file and [`AGENTS.md`](../../AGENTS.md) §12.

### 1.2 Script it if a script can say it

Script deterministic checks first; delegate only the parts that need judgment, cross-file reading, or
trial changes.

### 1.3 Split the work by files owned, not by steps

One slice = one reviewable change. A slice names the files it touches, and a slice that would
touch more than about four files is two slices. Splitting by *step* ("first write the tests, then
the code") makes two slices write the same files and race; splitting by *file ownership* does not.

Slices that will run against the same gate have a second constraint: **the gate must be frozen
first**, or the group runs serially. If the gate changes while the slices are in flight, "green"
means nothing, and the only honest move is to freeze the gate, dispatch, and read every diff.

## 2. Write the slice

A slice is a small document. It has four parts and nothing else.

1. **Scope, fixed.** The exact files, the exact range, the exact enumeration. "Audit the ADR index"
   is not a scope; "read `docs/adr/README.md`, and for every row read the `Status:` and `Date:` line
   of the file it points at, and report rows whose status or date disagrees" is.
2. **The output, fixed.** Name the shape the answer must take — the columns of a table, the file
   to write. An open-ended "report what you find" produces a document nobody can check.
3. **The acceptance check, as a command.** The slice states what passing looks like, and it is
   something a gate can run: `bun run test packages/parser`, `bun run check:links`, `bun run fmt:teda
   --check .`. A slice with no runnable acceptance has no way to fail, and so no way to finish.
4. **What is still open.** Say which parts are decided and which are the child's to decide. If
   nothing is open, say so — that is information, and it lets the child skip re-deriving it.

The brief should also say what **not** to send back. A child that repeats the code it wrote has
doubled the review; ask for the file plus the one line that says what changed.

## 3. Dispatch

### 3.1 Shape of the call

The `task` tool launches **one child per call**:

```json
{
  "agent_name": "explore",
  "description": "Map symbol geometry and identity",
  "prompt": "<the self-contained slice>"
}
```

The child has no access to this conversation, so `prompt` must stand alone — it cannot say "the file
we discussed above". Everything the child needs (the files, the rules, the acceptance command, what
is open) goes into it. `description` is the child's title in the roster; make it say what the child
is for.

**Several children at once**: issue several `task` calls in one turn and wait for their results to
come back. A call you need the answer to before continuing takes `run_in_background: false` and
returns the result directly. The runtime enforces a concurrency limit per session; when a dispatch
comes back `SUBAGENT_CONCURRENCY_LIMIT`, wait for a running child to finish rather than retrying
the call.

### 3.2 Which agent

| Agent | Use it for |
|---|---|
| `explore` | Read-only exploration; the answer is a location, a symbol, or a summary |
| `worker` | The default: multi-file implementation work |
| `verifier` | Reviewing a change for correctness, or auditing a claim |

`explore` cannot edit. Asking it to edit produces a report describing an edit instead of the edit.
`verifier` is read-only too — it judges, it does not fix.

### 3.3 Which model

**Omit the model.** The role decides it: an explicit override for that agent, then the agent
definition's own model, then the parent's. Pass a model only when the user names one; a guessed
model name is rejected before the child starts.

### 3.4 When a dispatch is refused

If a call comes back refused, **stop retrying variants of it.** A placeholder model, an extra
field, or a different spelling of the same call does not repair a refusal — it only burns attempts.
Do the work in the parent session instead, or wait for the condition to clear (a running child
finishing, a concurrency slot freeing).

## 4. Supervise

| Ask for | Gets you |
|---|---|
| the child's output | Its final answer, or its latest text while it runs |
| a follow-up | A message into a live child; it keeps its own context and continues |
| a stop | The child is cancelled; what it already wrote stays in the tree |

**A silent child is usually still generating, not stuck.** Read what the child has produced before
concluding anything. The transcripts are the record: they live under the runtime's session
directory, one JSONL file per child. The raw file is one event per line, so a short tail is enough
to see whether it is moving:

```sh
# the child's last few events
tail -n 40 "$SESSION"/snapshots/<child>.jsonl \
  | jq -r 'select(.message.role=="assistant") | .message.role as $r | (.message.content // [])[]
           | if type=="object" then "\($r) \(.name // .type)" else "\($r) \((.text // "")[0:60])" end' \
  | tail -n 8
```

A transcript that ends in a tool call and keeps growing is a working child. A transcript that
repeats the same call is a loop — stop it and re-scope.

A second probe answers "is it writing anything at all?" — the freshest files on disk:

```sh
find . -path ./node_modules -prune -o -type f -printf "%T@ %TH:%TM:%TS %p\n" | sort -rn | head -12
```

Fresh mtimes on the files that slice owns mean it is writing. Use the `-printf` + `sort -rn` form
rather than `find -newermt`: relative ages are not portable across the `find` implementations a
contributor may have.

**Bound the fan-out.** A child with no request budget will spend the whole session: give it a
scope, a budget, and a deadline out loud ("10 more minutes, then I do it myself"). A slice that has
not touched a file in 20+ minutes is either blocked or was given a scope it cannot finish; the fix
is to narrow the scope or take the work over, not to wait longer. Long research fan-outs are
unwelcome — fetch the one or two primary documents yourself and let the child do the part that
needs reading many files.

**Read the output even when the child says it is done.** A child that has finished its work but
keeps re-emitting it costs tokens without adding anything.

**A finding the child hands back is unowned until you own it.** When a slice reports "outside my
slice, needs an owner", the parent either does the item or assigns it explicitly — and says so in
the reply. Unowned findings are how stale claims survive a migration.

## 5. Accept

1. **Run the gate yourself, in the parent session, after the child's edits are in the tree.** The
   child's own report is a claim; the gate in your session is the fact.
2. **Read the diff for judged work.** For anything a gate cannot decide, the diff is read line by
   line by a human or by the main session. A child's "it looks right" is not a review.
3. **Check the child stayed in scope.** A slice that edited a file it was not given is a finding
   about the slice, not about the code.

If the work was judged, the reviewer is the judge, and the judge grades against a rubric. For code
quality the rubric is **yours**: write criteria the judge can answer from the diff alone, and give
it hidden cases the child never saw. Do not paraphrase a rubric into a shorter version to "test"
it — a simplified rubric makes the same batch of work grade wrongly, and then the probe is wrong,
not the model.

## 6. Price it

Delegation is not free: the child pays a startup cost for its own system prompt and shares nothing
of this session's cache. The transcripts are the record.

Layout: the parent session is `<session-dir>/messages.jsonl`; its children live in
`<session-dir>/snapshots/<child>.jsonl`, one file per child.

```sh
ls ~/.minimax/v2/sessions/<yyyy-mm-dd>/          # one directory per session
ls ~/.minimax/v2/sessions/<yyyy-mm-dd>/<session>/ # the parent transcript and the children's
```

### 6.1 The formula

```python
billable = input + 0.1 * cacheRead + output
```

`totalTokens` in the usage record **includes** `cacheRead`, so never use it directly.

### 6.2 The script

Save it as `cost.py` and run it against the **child directory** — the `snapshots/` directory of a
session, which holds one `<child>.jsonl` per child:

```python
import json, glob, os, sys
d = sys.argv[1]
rows = []
for p in glob.glob(os.path.join(d, "*.jsonl")):
    inp = out = cr = turns = 0
    for line in open(p):
        try: r = json.loads(line)
        except ValueError: continue
        m = r.get("message") or {}
        if m.get("role") != "assistant": continue
        u = m.get("usage") or {}
        inp += u.get("input") or 0
        out += u.get("output") or 0
        cr += u.get("cacheRead") or 0
        turns += 1
    rows.append((inp + 0.1 * cr + out, turns, os.path.basename(p)[:-6]))
rows.sort(reverse=True)
print(f"{'billable':>10} {'turns':>6}  agent")
for b, t, name in rows:
    print(f"{b:10.0f} {t:6d}  {name}")
```

```sh
python3 cost.py ~/.minimax/v2/sessions/<yyyy-mm-dd>/<session>/snapshots/
```

### 6.3 What to change when it is not worth it

- Fewer, larger-but-bounded slices are usually cheaper than many thin ones: each child pays a
  startup cost for its own system prompt.
- "Deliver the file plus one line about what changed" cuts output tokens without cutting work.
- Pinning the boundaries in the brief (what counts as done, what the output shape is) cuts
  rework, which is the expensive kind of waste: the child does the work twice.

### 6.4 Did the delegation pay off?

Totals answer the wrong question. The main session's total is large whether or not the work was
delegated — it includes the turns the parent spent waiting, reading and repairing. Compare
**per turn**, and measure the four things that decide the verdict.

| Measure | How | What it tells you |
|---|---|---|
| Billable per turn | The §6.2 script, plus the parent's own turns | Whether a child is cheaper or dearer than the parent, per unit of work |
| Cold start | The child's first request's `input` tokens | The floor a child pays before doing anything — a slice below it loses money |
| Rework vs fresh | Parent `edit`/`write` calls after a child's last edit: in that child's files = rework, elsewhere = fresh work | Whether delegation saved the parent work or just moved it |
| Parallelism | Sum of child intervals ÷ the union of those intervals; plus the peak concurrent count | Whether the wall-clock time was actually saved |

Two traps make these numbers wrong:

- **`edit` has two argument shapes on disk.** Current runs carry `arguments.path`; older ones put
  the target in `arguments.input` as a `[path#HASH]` header. A parser that reads only one of them
  counts **zero** edits and reports "no rework happened". Read both, and check the parser against
  one known edit call before trusting an aggregate.
- **Deduplicate the parent's edits by `(timestamp, path)`.** One parent batch can land in several
  children's file sets and inflate the rework count.

One script measures all four. Save it as `payoff.py` and run it against the child directory:

```python
import json, glob, os, re, sys, datetime

D = sys.argv[1]                     # the child directory (one .jsonl per child)
brk = re.compile(r'^\[([^\]\#]+)#[0-9A-F]{4}\]')

def recs(p):
    for line in open(p, encoding="utf-8"):
        try: yield json.loads(line)
        except ValueError: continue

def fpath(name, a):
    if name == 'edit':
        if a.get('path'): return a['path']
        m = brk.match((a.get('input') or '').strip())
        return m.group(1) if m else None
    if name in ('write', 'read'): return a.get('path')
    return None

def turns(p):
    for e in recs(p):
        m = e.get("message") or {}
        if m.get("role") != "assistant": continue
        u = m.get("usage") or {}
        yield u.get("input") or 0, u.get("output") or 0, u.get("cacheRead") or 0

def edits(p):
    for e in recs(p):
        m = e.get("message") or {}
        if m.get("role") != "assistant": continue
        c = m.get("content")
        if not isinstance(c, list): continue
        for b in c:
            if isinstance(b, dict) and b.get("type") == "toolCall" and b.get("name") in ("edit", "write"):
                fp = fpath(b["name"], b.get("arguments") or {})
                if fp: yield m.get("timestamp"), fp

bill = lambda t: t[0] + 0.1 * t[2] + t[1]
main = os.path.join(os.path.dirname(D.rstrip("/")), "messages.jsonl")

mt = list(turns(main)); mb = sum(bill(t) for t in mt)
peak = max(((t[0] + t[2]) for t in mt), default=0)
kids = {}
for p in glob.glob(os.path.join(D, "*.jsonl")):
    name = os.path.basename(p)[:-6]
    u = list(turns(p))
    if not u: continue
    kids[name] = (len(u), sum(bill(t) for t in u), u[0][0])
kt = sum(v[0] for v in kids.values()); kb = sum(v[1] for v in kids.values())
cold = [v[2] for v in kids.values() if v[2]]
print(f"main     {len(mt):5d} turns {mb:11.0f} billable {mb/max(len(mt),1):8.0f}/turn  peak prompt {peak}")
print(f"children {kt:5d} turns {kb:11.0f} billable {kb/max(kt,1):8.0f}/turn  cold start {min(cold) if cold else 0}-{max(cold) if cold else 0}")

af, al = {}, {}
for p in glob.glob(os.path.join(D, "*.jsonl")):
    name = os.path.basename(p)[:-6]; ed = list(edits(p))
    if ed: af[name] = {f for _, f in ed}; al[name] = max(x for x, _ in ed)
rework = fresh = 0; seen = set()
for t, fp in edits(main):
    k = (t, fp)
    if k in seen: continue
    seen.add(k)
    if any(t > al[n] and fp in fs for n, fs in af.items()): rework += 1
    else: fresh += 1
print(f"main edits after a child finished: rework {rework}, fresh {fresh}")

def ts(x):
    # A runtime may stamp an ISO string or epoch milliseconds; take both.
    if isinstance(x, (int, float)):
        return datetime.datetime.fromtimestamp(x / 1000)
    return datetime.datetime.fromisoformat(x.replace("Z", "+00:00"))

iv = []
for p in glob.glob(os.path.join(D, "*.jsonl")):
    st = [ts(e["message"]["timestamp"]) for e in recs(p) if (e.get("message") or {}).get("timestamp")]
    if st: iv.append((min(st), max(st)))
pts = []
for a, b in iv: pts += [(a, 1), (b, -1)]
pts.sort(); cur = peak_c = 0
for _, d in pts:
    cur += d; peak_c = max(peak_c, cur)
busy = sum((b - a).total_seconds() for a, b in iv)
merged = []
for a, b in sorted(iv):
    if merged and a <= merged[-1][1]: merged[-1][1] = max(merged[-1][1], b)
    else: merged.append([a, b])
union = sum((b - a).total_seconds() for a, b in merged)
print(f"parallelism {busy/union:.2f}x, peak {peak_c} concurrent")
```

```sh
python3 payoff.py ~/.minimax/v2/sessions/<yyyy-mm-dd>/<session>/snapshots/
```

## 7. References

- [`docs/skills/README.md`](README.md): the index of the procedures.
- [`AGENTS.md`](../../AGENTS.md) §12: the repository's working rules for agents.
