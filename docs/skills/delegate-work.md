# Skill: Delegate Work to Subagents

> **Audience**: agents that split a job across subagents and have to accept, reject, or price the
> result.
> **Scope**: choosing what to delegate, writing a slice, dispatching it, supervising it, accepting
> it, and measuring what it cost.
> **Not in scope**: what to build (that is the rest of `docs/skills/`); the harness's own settings
> (`~/.omp/agent/config.yml`); the design rules (they live in [`spec/`](../../spec/) and the
> [ADRs](../adr/README.md)).

Index: [`docs/skills/README.md`](README.md) lists the procedures and when to read which.

## 0. What this skill is for

A subagent is a separate session with its own context, its own model, and its own bill. It is good
for work that is **wide** (many files, one mechanical rule) and bad for work that is **judged**
(does this prose read well, does this geometry look right). This skill says how to tell the two
apart, how to write a slice that lands, and how to price it.

Two facts drive everything below:

- **A subagent reporting "green" is not evidence.** Its verdict is a claim about a checkout you
  have not read. The acceptance step is yours.
- **A delegated slice that shares a moving gate proves nothing.** "The suite passed" against a
  gate that changed mid-flight is not a result.

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

There is no setting that filters delegation by work type: `task.eager` is only a prompt nudge
(`default` / `preferred` / `always`), it decides how hard the harness suggests delegating, not
what deserves delegating. The boundary is the rule you write down — here, this file and
[`AGENTS.md`](../../AGENTS.md) §12.

### 1.2 Script it if a script can say it

Before dispatching an audit, ask whether the check is mechanical. It usually is. A short script that
reads an index file and prints the mismatching rows answers the question in seconds, and it
answers the same question every time. A subagent asked the same question spends minutes and may
answer a different one.

Delegate the part a script cannot reach: the part that needs judgment, the part that needs reading
many files side by side, the part that needs a machine to try a change.

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

The `task` tool takes one call with a batch of items:

```json
{
  "context": "<what every child needs to know>",
  "tasks": [
    {
      "name": "CamelCaseName",
      "agent": "scout",
      "task": "<self-contained instructions for this slice>",
      "solutionSpace": "<what is decided, what is open>"
    }
  ]
}
```

`context` is shared background rendered into every child's prompt; `task` is the slice itself. The
child has no access to this conversation, so `task` must stand alone — it cannot say "the file we
discussed above".

`name` becomes the agent's id (CamelCase, ≤ 32 characters) and is what `agent://<id>` resolves to.

### 3.2 Which agent

| Agent | Use it for |
|---|---|
| `scout` | Read-only exploration; the answer is a location, a symbol, or a summary |
| `task` | The default: multi-file implementation work |
| `reviewer` | Reviewing a change for correctness |
| `security-reviewer` | Repository vulnerability review |
| `sonic` | Strictly mechanical updates and data collection |

`scout` cannot edit. Asking it to edit produces a report describing an edit instead of the edit.

### 3.3 Which model

Which model a child runs on is decided in this order: an explicit override for that agent
(`task.agentModelOverrides`), then the agent definition's own `model:` field, then the **parent's
active model**, then its configured/default fallback. A per-call `model` on the slice replaces the
last two steps — but only when `task.perCallModel` is on and the model is approved.

The bundled agents are pinned in their own definition: `task` says `model: "@task"`, `scout` says
`model: "@smol"`, `reviewer` says `model: "@slow"`, and `security-reviewer` names none, so it
inherits the parent's model. Read your own roles — this is a snapshot, not the truth:

```sh
grep -A12 'modelRoles' ~/.omp/agent/config.yml
```

```
modelRoles:
  web: web/exa
  default: modelflare/gpt-6.1-sol:xhigh
  task: minimax-code-cn/MiniMax-M3.1-Flash:max
  judge: dmxapi/jev-latest
  slow: modelflare/gpt-6.1-sol:xhigh
  smol: minimax-code-cn/MiniMax-M3.1-Flash:high
```

The `task` role is a **different model from the main session's**, so a child's output can differ
in quality from yours for reasons that have nothing to do with the slice. **Check which model
actually ran before rewriting the slice.** The child's own transcript is the ground truth — it
records the model in its first `model_change` record:

```sh
cd ~/.omp/agent/sessions/<slug>/<session-id>/
for f in *.jsonl; do printf '%s: ' "${f%.jsonl}"; grep -m1 -o '"model":"[^"]*"' "$f"; done
```

```
BridgeGround: "model":"modelflare/gpt-6.1-sol"
CliTestFixtures: "model":"minimax-code-cn/MiniMax-M3.1-Flash"
ConfiguredTaskProbeEval: "model":"minimax-code-cn/MiniMax-M3.1-Flash"
```

The children ran on three different models, and not all of them on the `task` role: an override or
an agent definition can pin one, and the `smol` role was a different model again at the time.
Read the transcript; do not infer the model from the role table.

Two settings change what a call may do:

- `task.perCallModel` (`off` here) — when it is off, a slice may not name a model; the role decides.
- `task.prewalk` (`false` here) and `prewalk.enabled` (`false` here) — the cheap-model hand-off at
  the first edit is off, so a child stays on its own model for the whole run. The two are
  independent: `task.prewalk` is what a child sees, and it applies only to the bundled generic
  `task` agent; `prewalk.enabled` arms the top-level session's own hand-off and never reaches a
  child. A per-agent `task.agentPrewalk[<agent>]` setting overrides that agent's frontmatter.

## 4. Supervise

| Read | Gets you |
|---|---|
| `read proc://` | Every background job with its state and runtime |
| `read agent://<id>` | The child's finished output, or its latest assistant text while it runs |
| `read history://<id>` | The child's transcript, as a readable tail |
| `write agent://<id>` | A follow-up message to a live or parked child |
| `write proc://<id>/kill` | Stop a job; the transcript survives |

`Alt+A` opens the Agent Hub in the terminal: the live roster, each agent's model, age and token
use, and `x` to kill or `r` to revive.

**A silent child is usually still generating, not stuck.** Read the transcript tail before
concluding anything. The raw file is JSONL, one event per line; `jq` turns the last few events
into something readable:

```sh
# what is it doing right now
tail -n 40 ~/.omp/agent/sessions/<slug>/<session-id>/<AgentName>.jsonl \
  | jq -r 'select(.type=="message") | .message.role as $r | (.message.content // [])[]
           | if type=="object" then "\($r) \(.name // .type)" else "\($r) \((.text // "")[0:60])" end' \
  | tail -n 8
```

```
assistant thinking
assistant text
assistant bash
toolResult text
toolResult text
developer text
assistant text
```

A transcript that ends in a tool call and keeps growing is a working child. A transcript that
repeats the same call is a loop — kill it and re-scope.

A second probe answers "is it writing anything at all?" — the freshest files on disk:

```sh
find . -path ./node_modules -prune -o -type f -printf "%T@ %TH:%TM:%TS %p\n" | sort -rn | head -12
```

Fresh mtimes on the files that slice owns mean it is writing. Use the `-printf` + `sort -rn` form
rather than `find -newermt`: on this box `-newermt "-4 minutes"` fails outright ("cannot figure out
how to interpret '-4 minutes' as a date or time"), while the `-printf` form lists the file just
written.

**Bound the fan-out.** A child with no request budget will spend the whole afternoon: the soft
budget is 200 requests by default, and a run that crosses 1.5× it is stopped and yields partial
findings. Long research fan-outs are unwelcome — fetch the one or two primary documents yourself
and let the child do the part that needs reading many files.

**Set a deadline out loud** ("10 more minutes, then I do it myself"). A slice that has not
touched a file in 20+ minutes is either blocked or was given a scope it cannot finish; the fix is
to narrow the scope or take the work over, not to wait longer.

**Read the output even when the child says it is done.** `agent://<id>` exposes the child's latest
text even before it has published a result; a child that has finished its work but keeps
re-emitting it costs tokens without adding anything.

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
quality the rubric is **yours**: `judge()` / `judgeBatch()` take the questions and their rubric as
input, so write criteria the judge can answer from the diff alone, and give it hidden cases the
child never saw. The harness ships built-in rubrics only for its own routing paths — `prewalk.auto`
and `find.enabled: auto` — and those are not code-quality rubrics; copy the one of the path you are
probing, verbatim, per [`AGENTS.md`](../../AGENTS.md) §12.

## 6. Price it

Delegation is not free: the child pays a startup cost for its system prompt and shares nothing of
this session's cache. The transcripts are the record.

Layout: the parent session is `<session-id>.jsonl`; a session that spawned children also has a
sibling **directory** of the same name, holding one `<AgentName>.jsonl` per child.

```sh
ls ~/.omp/agent/sessions/<cwd-slug>/                 # a .jsonl per session, plus a dir per session with children
ls ~/.omp/agent/sessions/<cwd-slug>/<session-id>/     # one .jsonl per child
```

`<cwd-slug>` is the working directory with `/` replaced by `-`.

### 6.1 The formula

```python
billable = input + 0.1 * cacheRead + output
```

`totalTokens` in the usage record **includes** `cacheRead`, so never use it directly.

### 6.2 The script

Save it as `cost.py` and run it against the **child directory** of a session — the directory named
after the session id, which holds one `<AgentName>.jsonl` per child:

```python
import json, glob, os, sys
d = sys.argv[1]
rows = []
for p in glob.glob(os.path.join(d, "*.jsonl")):
    inp = out = cr = turns = 0
    for line in open(p):
        try: r = json.loads(line)
        except ValueError: continue
        if r.get("type") != "message": continue
        m = r.get("message", {})
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
python3 cost.py ~/.omp/agent/sessions/<cwd-slug>/<session-id>/
```

On the 2026-11-02 TextEDA session it printed:

```
  billable  turns  agent
   4691065    301  CliTestFixtures
   2750763    147  DynamicBeetle
   1752873    119  ParserTestFixtures
   1190790     46  ThirdFullRewire
   1081833     18  SwitchDesignScout
```

Read the table as a shape, not as a scoreboard. The top line is an order of magnitude over the
bottom ones, and the driver is **re-reading a large context over many turns**: `CliTestFixtures`
spent 301 turns with 36.2M cached tokens read, and the cached reads alone are 77% of its billable
total. A child that needed 300 turns was under-specified or had no budget — either way the next
slice should be narrower.

### 6.3 What to change when it is not worth it

- Fewer, larger-but-bounded slices are usually cheaper than many thin ones: each child pays a
  startup cost for its own system prompt.
- "Deliver the file plus one line about what changed" cuts output tokens without cutting work.
- Pinning the boundaries in the brief (what counts as done, what the output shape is) cuts
  rework, which is the expensive kind of waste: the child does the work twice.
- `task.maxConcurrency` (default 32) bounds how many children run at once; `task.maxRecursionDepth`
  (default 2) bounds nesting. Neither is a substitute for a small number of slices.

### 6.4 Did the delegation pay off?

Totals answer the wrong question. The main session's total is large whether or not the work was
delegated — it includes the turns the parent spent waiting, reading and repairing. Compare
**per turn**, and measure the four things that decide the verdict.

| Measure | How | What it tells you |
|---|---|---|
| Billable per turn | The §6.2 script, plus the parent's own turns | Whether a child is cheaper or dearer than the parent, per unit of work |
| Cold start | The child's first record's `contextSnapshot`: `nonMessageTokens + toolSchemaTokens` | The floor a child pays before doing anything — a slice below it loses money |
| Rework vs fresh | Parent `edit`/`write` calls after a child's last edit: in that child's files = rework, elsewhere = fresh work | Whether delegation saved the parent work or just moved it |
| Parallelism | Sum of child intervals ÷ the union of those intervals; plus the peak concurrent count | Whether the wall-clock time was actually saved |

Two traps make these numbers wrong:

- **`edit` has two argument shapes on disk.** Current runs carry `arguments.path`; older ones put
  the target in `arguments.input` as a `[path#HASH]` header. A parser that reads only one of them
  counts **zero** edits and reports "no rework happened". Read both, and check the parser against
  one known edit call before trusting an aggregate.
- **Deduplicate the parent's edits by `(timestamp, path)`.** One parent batch can land in several
  children's file sets and inflate the rework count.

One script measures all four. Save it as `payoff.py` and run it against the **child directory**:

```python
import json, glob, os, re, sys, datetime

D = sys.argv[1]
brk = re.compile(r'^\[([^\]\#]+)#[0-9A-F]{4}\]')

def recs(p):
    for line in open(p, encoding='utf-8'):
        try: yield json.loads(line)
        except ValueError: continue

def fpath(name, a):
    # `edit` has two shapes on disk: `arguments.path` (current) and a
    # `[path#HASH]` header inside `arguments.input` (older runs).
    if name == 'edit':
        if a.get('path'): return a['path']
        m = brk.match((a.get('input') or '').strip())
        return m.group(1) if m else None
    if name in ('write', 'read'): return a.get('path')
    return None

def turns(p):
    for e in recs(p):
        m = e.get('message') or {}
        if m.get('role') != 'assistant': continue
        u = m.get('usage') or {}
        yield u.get('input') or 0, u.get('output') or 0, u.get('cacheRead') or 0, m.get('contextSnapshot') or {}

def edits(p):
    for e in recs(p):
        m = e.get('message') or {}
        c = m.get('content')
        if not isinstance(c, list): continue
        for b in c:
            if isinstance(b, dict) and b.get('type') == 'toolCall' and b.get('name') in ('edit', 'write'):
                fp = fpath(b['name'], b.get('arguments') or {})
                if fp: yield e.get('timestamp'), fp

bill = lambda t: t[0] + 0.1 * t[2] + t[1]
base = os.path.basename(D.rstrip('/'))
main = os.path.join(os.path.dirname(D.rstrip('/')), base + '.jsonl')

mt = list(turns(main)); mb = sum(bill(t) for t in mt)
peak = max((t[3].get('promptTokens') or 0) for t in mt)
kids = {}
for p in glob.glob(os.path.join(D, '*.jsonl')):
    name = os.path.basename(p)[:-6]
    u = list(turns(p))
    if not u: continue
    cs = u[0][3]
    kids[name] = (len(u), sum(bill(t) for t in u),
                  (cs.get('nonMessageTokens') or 0) + (cs.get('toolSchemaTokens') or 0))
kt = sum(v[0] for v in kids.values()); kb = sum(v[1] for v in kids.values())
cold = [v[2] for v in kids.values() if v[2]]
print(f"main     {len(mt):5d} turns {mb:11.0f} billable {mb/max(len(mt),1):8.0f}/turn  peak prompt {peak}")
print(f"children {kt:5d} turns {kb:11.0f} billable {kb/max(kt,1):8.0f}/turn  cold start {min(cold)}-{max(cold)}")

af, al = {}, {}
for p in glob.glob(os.path.join(D, '*.jsonl')):
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

ts = lambda x: datetime.datetime.fromisoformat(x.replace('Z', '+00:00'))
iv = []
for p in glob.glob(os.path.join(D, '*.jsonl')):
    st = [ts(e['timestamp']) for e in recs(p) if e.get('timestamp')]
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
python3 payoff.py ~/.omp/agent/sessions/<cwd-slug>/<session-id>/
```

On the 2026-11-02 TextEDA session it printed:

```
main      9311 turns   223627982 billable    24018/turn  peak prompt 404899
children   847 turns    13779108 billable    16268/turn  cold start 7778-13393
main edits after a child finished: rework 27, fresh 1223
parallelism 1.05x, peak 4 concurrent
```

Read that shape, not those numbers: the children were **cheaper per turn** than the parent, their
rework was small next to the fresh work they caused, and parallelism was ~1x against a limit of
32 — the batches serialized on the parent's own turnaround, so the wall-clock win was near zero.

What delegation reliably buys is the parent's **context window**: a child's tool traffic never
enters the parent's prompt. Compare the parent's peak `promptTokens` against
`compaction.thresholdTokens` in `~/.omp/agent/config.yml` (200,000 here, with
`thresholdPercent: 80`) — that gap is the asset delegation protects, and it is the reason to
delegate even when the token totals are a wash.

## 7. What not to do

- Do not accept a child's "green" without running the gate in the parent session.
- Do not let a slice share a moving gate with its siblings and then believe the results.
- Do not dispatch a check that a script can make.
- Do not delegate prose, geometry, or a taste call.
- Do not fan out research without a bound; read the two primary documents yourself.
- Do not diagnose a "bad" result before checking which model ran.
- Do not count `totalTokens` as the cost.

## 8. References

- [`docs/skills/README.md`](README.md): the index of the procedures.
- [`AGENTS.md`](../../AGENTS.md) §12: the repository's working rules for agents.
- `omp://task-agent-discovery.md`: how agents are discovered, which model runs them, and the
  per-call model rules.
- `omp://tools/task.md`: the `task` tool's wire schema, limits, and side effects.
- `omp://agent-hub.md`: the Agent Hub, the roster, and how to steer or revive a child.
- `omp://prewalk.md`: the `prewalk.auto` hand-off, its trigger, and the three-route rubric the
  judge gets (the table there paraphrases the rubric the harness actually sends).
