# ADR-0073: The Review App Has a Freehand Pen, and a Sketch Is a Message, Not a Record

Status: Accepted
Date: 2026-11-14
Scope: Decides: that the review app offers a freehand pen on a drawing; that a sketch is a message to the agent and never a fact about the design; where a saved sketch goes and what it is called; what the ink and the caption are; how the pen is armed; and which drawings the pen is offered on today. Does not decide: the shape of the agent's surface — see [ADR-0044](../10-process/0044-the-agent-surface-is-a-set-of-verbs.md); what the drawing layers are — see [ADR-0035](0035-the-view-layer-is-a-drawing.md) and [ADR-0048](0048-the-review-app-shows-drawings.md); how a host is entered — see [ADR-0046](../10-process/0046-a-host-is-entered-once.md).
Related: [ADR-0042](0042-the-review-app-has-modes.md), [ADR-0043](0043-the-review-app-is-a-plugin-of-the-agent-workbench.md), [ADR-0048](0048-the-review-app-shows-drawings.md), [ADR-0056](0056-the-review-app-has-one-interaction-surface.md)
Impact: `packages/viewer/src/sketch.ts`; `packages/viewer/src/app.ts`; `packages/viewer/src/styles.ts`; `packages/viewer/package.json`; `packages/cli/src/sketch.ts`; `packages/cli/src/review.ts`; `packages/viewer/test/sketch.test.ts`; `packages/viewer/test/key-hints.test.ts`; `packages/cli/test/review-sketch.test.ts`; `docs/guides/review-app.md`

## Background

The person in front of the app and the agent in front of the terminal do not speak the same
language. The agent reads text and owns the sources; the person reads pictures. Every channel
between them today carries something the language can hold: a selected instance becomes a brief,
a moved instance becomes a row, a finding becomes a diagnostic code.

One kind of judgement has no such channel. "This triangle should be sharper." "The body is
too tall." "Put the pin row higher." These are judgements about how a thing *looks*, made by
someone who can see the drawing and cannot see the source, and aimed at an agent that can see
the source and cannot see the drawing. Every attempt to carry such a judgement in the existing
channels fails the same way: the person has to guess a number, and the number is wrong.

The obvious fix is a form — a field for "sharper", or a slider for "taller". That asks the
person to translate a picture into a vocabulary the picture does not have, and it asks for a
vocabulary nobody has. The cheaper channel is the one the person already uses when they cannot
say it in words: they draw it.

So the app gets a pen. What it draws on top of the sheet is not geometry and not a fact: it is
the person's own way of saying something, kept as a picture and handed to the agent as a picture.
The agent has eyes ([ADR-0043](0043-the-review-app-is-a-plugin-of-the-agent-workbench.md) D5
gives the gesture to the app and keeps the meaning with the agent), so the picture needs no
translation layer.

## Decision

### D1. The pen draws on the picture, and the picture keeps the ink out of the design

The pen is a freehand overlay on a drawing, drawn in the drawing's own millimetres — the SVG's user
units, which is what the renderer measures every drawing in — so a stroke means the same thing at
any zoom and scales with the drawing. The strokes live in the browser, in the app's own state, and
they are never part of the drawing, the IR, a shard, or a hash.

The ink is not a source fact, so nothing about it can reach a build input. This is the same rule
the rest of the view layer follows ([ADR-0035](0035-the-view-layer-is-a-drawing.md) D5): a drawing
is not a build input, and neither is what a person draws on it.

### D2. The gesture says where, and never what

The pen continues the rule the app already has for its other gestures
([ADR-0043](0043-the-review-app-is-a-plugin-of-the-agent-workbench.md) D5): the person says
*where*, and the agent decides *what*. A sketch is a request, not an edit — "the body here is
wrong" is work the agent does in the source file, with the whole project in view.

So the sketch carries no structured brief and no machine-readable intent. It is a picture, and
the agent reads it as one. A second channel carrying the same message in text would be a second
truth about the same gesture, and it would immediately go stale against the ink.

### D3. A sketch is a message, and it is written outside the project

A saved sketch lands in `/tmp/texteda-sketches/`, named after the drawing it is a sketch of and
numbered in the order the pictures were drawn (`indicators-led-1.png`, `indicators-led-2.png`).

It is not in the project because it is not a record of the design: a record is something the
project keeps and somebody can find again, and a sketch is a note that is read once. It is not
in the IR and not in any hash, so drawing on a symbol cannot change the project — and the symbol
shard is normative, so this matters
([ADR-0035](0035-the-view-layer-is-a-drawing.md) D5).

The picture is written by the server, not by the browser, like every other write
([ADR-0042](0042-the-review-app-has-modes.md) D9): the app asks, the server owns the file
system. The route is `POST /api/sketch`, it refuses a drawing the project does not have, and it
answers with the path. A host with no server behind it — the static export, a plugin surface —
gets the browser's download instead, and the reviewer still has a file to hand over.

### D4. The ink is the drawing's own weight, and it is grey

The pen's line weight is 0.25 mm, the weight the drawings themselves use, and the ink is grey.
A stroke therefore reads as part of the sheet rather than as a different kind of mark, and it is
never mistaken for the symbol's own lines.

The pen's weight is not a free parameter and not a preference the reviewer sets. It is a
constant, because the point of the overlay is to be read as an annotation of that drawing.

### D5. The picture carries a caption, because a picture without one is a riddle

The saved picture says what it is a sketch of: the drawing's kind, its name, and the day
(`symbol · led · 2026-11-13`), drawn under the picture.

Without it, a picture in a folder of pictures is unreadable: the agent cannot tell which symbol
it is looking at, and the reviewer cannot either, a week later. The caption is part of the
picture rather than part of its file name, because the file name is what gets typed into a
conversation and the caption is what gets seen.

### D6. The pen is armed explicitly, and it is not a mode

The pen is turned on with `b` and put away with `Escape`, in the same shape as the move, which
`m` arms ([ADR-0056](0056-the-review-app-has-one-interaction-surface.md)). With the pen armed, a
drag is a stroke; with it disarmed, a drag still pans the sheet. Arming is explicit so that the
hand that reaches for the mouse does not accidentally ink the picture.

There is no mode state and no mode bar: the app has one interaction surface, and the current
canvas decides which actions answer.

### D7. The pen is offered on the drawings whose subject is geometry the agent owns

Today the pen is offered on library symbols, and on nothing else. A symbol is a drawing of
geometry the agent owns, that a reviewer can see something wrong with, and that no coordinate
can describe. The other drawings are not offered yet: a print page is about placement, which the
existing gestures already carry, and a board canvas is about copper, which a sketch would only
make vaguer.

Widening the pen to the other drawings is a later decision, not a later implementation: the same
overlay serves them, and what it takes is a decision about which drawings are worth drawing on.

### D8. The strokes are the reviewer's, and they do not outlive the session

The strokes live in the app's state, per drawing, and a re-render — a zoom, a switch away and
back, a change to the drawing — does not lose them. A reload does: the strokes are not saved
state, and the saved pictures are the record of what was said.

Each drawing keeps its own strokes, because a reviewer may say something about two symbols and
save two pictures, and one drawing's ink must not end up on the other's picture.

## Consequences

- The app can now carry a judgement it could not carry before, without inventing a vocabulary
  for it. The person's hand is the interface, and the agent's eyes are the reader.
- The core is untouched: no parser change, no IR change, no schema change, no hash change. A
  sketch cannot make a project wrong, and it cannot make one right either — it is a note.
- The picture is not reproducible from the project, and it is not meant to be. If a reviewer's
  sketch matters later, it is a review record, and that is
  [ADR-0037](0037-review-records-and-attribution.md)'s subject, not this one's.
- The agent's side of the channel is the agent's own: it reads the picture and decides what to
  change in the source. The app does not translate, and there is nothing to keep in sync.
- The pen is a freehand overlay, so it inherits what freehand overlays inherit: the reviewer
  draws where the drawing is, not where a coordinate says. That is the trade this record makes
  on purpose.

## What this record does not change

- The IR and the schemas.
- The rule that a drawing is not a build input, and that the symbol and PCB shards are
  normative while the print page's is advisory.
- The ownership of the sources: the agent writes the design, the person points.
- The canonical write path, and the fact that the server owns the file system.
- The rule that a gesture says *where* and never *what*.
