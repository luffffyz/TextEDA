# Skill: Verify the Review App in a Browser

> **Audience**: agents and engineers who changed the review app's behaviour and need to prove it
> in the real app.
> **Scope**: `packages/viewer` interaction — drag, move, rotate, field anchors, selection,
> highlight, Apply.
> **Not in scope**: drawing a page's geometry (that is
> [`draw-print-page.md`](draw-print-page.md) / [`repair-print-page.md`](repair-print-page.md));
> the app's bindings and modes are described in
> [`docs/guides/review-app.md`](../guides/review-app.md).

Index: [`docs/skills/README.md`](README.md) lists the procedures and when to read which.

## 0. What this skill is for

Tests alone are not proof here. The review app's surface is **interaction** — a drag, a keypress,
a click on a hotspot — and none of it is covered by a unit test. This skill says how to drive the
real app in a real browser, and how to prove that what the app did is what it claims.

**`Apply` writes files.** Always work on a copy.

## 1. Copy the project first

```sh
rm -rf /tmp/texteda-review-smoke
cp -r examples/reference-project /tmp/texteda-review-smoke
```

Every write the app makes — a moved symbol, a rotated one, a moved label — goes into this copy.
The source tree is never the target of a smoke test.

## 2. Start the server and wait for it to answer

```sh
bun run packages/cli/scripts/texteda.ts review /tmp/texteda-review-smoke --port 4791 \
  > /tmp/review-server.log 2>&1 &
sleep 6
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4791/
```

Do not drive the browser until the server answers `200`. The log prints
`<project> at http://127.0.0.1:4791/` and `<boards> boards, <n> diagnostics` — read both: a board
count of zero means the project failed to load, and the page will show an error instead of a
drawing.

## 3. The bundled Chromium does not run here

The **managed** browser — the one the harness bundles under its own cache directory — exits
127 with `libglib-2.0.so.0: not found` on a NixOS host: there is no FHS loader path for it. Pass
the **system** browser explicitly instead. On this class of host it lives under the per-user
profile's `bin/`, so resolve it rather than hard-coding it:

```js
const tab = await browser.open({
  name: "review-grid",
  url: "http://127.0.0.1:4791/",
  viewport: { width: 1400, height: 1000 },
  app: { path: SYSTEM_CHROMIUM, relay: false, tern: false },
});
```

`SYSTEM_CHROMIUM` is whatever `which chromium` (or the host's equivalent) resolves to. The point
is that the bundled browser does not run here, so the path has to be supplied — the exact path is
this host's, and it is not written down in the repository.

## 4. Driving the app

- `tab.evaluate(fn)` runs in the page. `tab.run(fn)` does **not** get a `document` — inside
  `tab.run`, use `page.evaluate(...)`.
- `page.waitForTimeout` does not exist. `tab.run(({ page, wait }) => …)` gives you `wait(ms)`.
- Hotspots carry `data-ref`: `[data-ref="instance:M2.C1"]`, `[data-ref="field:…"]`,
  `[data-ref="text:…"]`. A selected hotspot carries `.selected`; the marks are `.mark`.
- **Click the element, not the coordinate.** A raw `page.mouse.down` / `up` at a hotspot's centre
  can miss. Use a handle:

  ```js
  const handle = await page.evaluateHandle(
    () => Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Apply"),
  );
  await handle.asElement().click();
  ```

- Status text lives in `.status`; the stage element carries the class `stage`, plus `moving` or
  `dragging` while a transaction is open.

### 4.1 The move flow, end to end

1. Select a symbol hotspot.
2. `page.keyboard.press("m")` → the status becomes
   `move preview: click to keep it, Escape to cancel`.
3. Move the pointer → the status becomes `M2.C1 → x, y mm · not applied yet`.
4. Mouse up → `move kept locally; Apply to write it`, and the moved symbol **stays selected**.
5. Press **Apply** → `applied: N symbols moved, … written`.

`Escape` cancels the transaction and restores the move without touching the unrelated pending
edits. **Until `Apply`, nothing is written** — the page's old wires keep their now-stale bends,
which is why `view.wire-diagonal` / `view.wire-crosses-pin` appear after the write.

### 4.2 A completed move keeps its object selected

This is the check that catches the move that cannot be moved again. After the mouse-up, the
selection must survive, and a second `m` must open a second transaction:

```js
const afterMove = await page.evaluate(() => ({
  selected: document.querySelector(".selected")?.getAttribute("data-ref") ?? null,
  moving: document.querySelector(".stage")?.classList.contains("moving") ?? null,
}));
await page.keyboard.press("m");
const secondMove = await page.evaluate(() =>
  document.querySelector(".stage")?.classList.contains("moving") ?? null,
);
```

After the mouse-up: `selected` is the moved object and `moving` is `false`. After the second `m`:
`moving` is `true`. If `selected` came back `null` after the mouse-up, the second `m` did nothing
— the selection was cleared and the object can no longer be moved (ADR-0056 D5).

### 4.3 The keyboard hint is up without asking for it

The hint sits in the sheet's top-left corner and is **resident**: it is there on load, before any
key is pressed. Read it straight from the DOM:

```js
const hint = await page.evaluate(() => {
  const box = document.querySelector(".keys-hint");
  return {
    visible: box !== null && getComputedStyle(box).display !== "none",
    radius: box === null ? null : getComputedStyle(box).borderRadius,
    rows: document.querySelectorAll(".key-row").length,
    keys: Array.from(document.querySelectorAll(".key-cap")).map((cap) => cap.textContent),
  };
});
```

`visible` is `true` on load and `radius` is a rounded value (`8px`). `?` folds it away and brings
it back. The rows name the keys that answer *now*: with nothing selected there is no `M`, `R` or
`Enter`; with a symbol selected all three are there (ADR-0056 D6).

The hint's content is derived, so it must be re-read after the state changes — a hint that still
names `M` while a move is in flight is wrong.

### 4.4 A pending port does not pull the committed wire

Use a port that is a wire endpoint, such as `VOUT` on the reference project's `buck-5v` module drawing.
Keep this check on the scratch copy and do not press Apply.

1. Before moving the port, capture the geometry and transforms of every
   `.sheet-svg g[data-ref^="net:"]` group and the solid port's screen bounding box.
2. Select the port hotspot, press `m`, move the pointer, and finish the move. The grey copy must
   appear at the pending position; compare the solid port's box and wire geometry with the capture.
3. Toggle Auto fields and Re-anchor wires while the port is pending. Neither control may replace
   the committed wire geometry or start a server layout preview for that pending placement.
4. Move the same port again and cancel with Escape. The first pending copy must return without
   moving the solid port or wires. Revert must remove the copy without changing those primitives.
5. Check the asynchronous case separately: with no pending placement, hold a real `/api/layout`
   request triggered by a layout control, then move the port before releasing that request. After
   its response arrives, the pending copy must survive and the captured wire geometry and solid
   port position must still match. Use the actual server response, not a replacement SVG.

Compare vector geometry as well as screenshots: a solid port remaining in place does not prove
that its wire stayed there. The late-response check catches a stale server preview replacing the
local drawing after the port move.

### 4.5 Wire controls do not change field placement

1. Start from a fresh scratch page with Auto fields off. Capture every
   `.sheet-svg g[data-ref^="field:"]` group's vector geometry, transform and screen bounding box.
2. Toggle Re-anchor wires on and off. Compare fields immediately after each click and after the
   real `/api/layout` response. Record DOM mutations as well as the final geometry so a temporary
   fallback layout cannot pass the check.
3. Enable Auto fields and wait for its response. Capture this deliberately different layout as
   the new baseline, then repeat the wire-toggle check.
4. Hold one real layout request, toggle the wire control again, and release the older request
   after the newer response. Neither the waiting period nor the late response may alter fields.
5. On the scratch copy only, move a field and Apply. The selected Auto fields policy must survive
   the rebuilt model; compare the field layout immediately before and after the commit response.

### 4.6 A field drag keeps unrelated automatic fields stable

Use the scratch copy's `buck-5v` module drawing with C3's fields automatic. Enable Auto fields and wait
for the real layout response before capturing C3's Reference and Value vector geometry, transforms
and screen boxes. Derive field positions from the current SVG rather than hard-coding coordinates.

1. Select C4's Value, press `m`, and move it into free space that does not obstruct C3. Hold a
   real `/api/layout` request while moving again. Observe DOM mutations throughout: C3 must not
   briefly return to its default-off layout. The dragged field must follow the pointer from its
   displayed automatic position, not from the initial model's field anchor.
2. Release the response and compare C3 again. Move and cancel with Escape after another response
   has arrived; the entire pre-transaction field layout must return immediately. Release an older
   request after cancellation to prove that it cannot restore the cancelled move.
3. Keep a field move locally, move that field a second time and cancel. The first pending position
   must survive. Move back to the transaction's starting point and check that no stale local
   transform remains. Repeat with C4's Reference and with Auto fields off.
4. Revert pending edits and wait for the selected policy's layout response; no pending manual
   field may remain visible. Restore a manual field with Backspace and check the same condition.
5. On the scratch copy only, Apply a kept move while an older preview response is held. The
   committed geometry must survive that late response, Auto fields must remain on, and only the
   intended field rows may differ from the copied source.

Do not assert that automatic fields can never move: separately move a manual field into an
automatic field's space and verify that collision avoidance still runs. Never replace a held
response with synthetic SVG; this check needs the server's actual geometry.

### 4.7 The pen draws on the picture

The pen is offered on library symbol drawings only ([ADR-0073](../adr/09-view/0073-the-review-app-has-a-freehand-pen.md) D7).

1. Open a symbol drawing from the sidebar — the reference project's `led`, say.
2. `page.keyboard.press("b")` → the action bar reads `Pen: on`, the status reads
   `pen armed: drag to draw on the drawing`, and the keyboard hint offers `Esc` instead of `B`.
3. Drag across the sheet → the ink appears as a `.sketch-overlay .sketch-ink` path, and the status
   reads `1 stroke drawn · save the picture to send it`. Read the path **before** the mouse comes
   up: the line must be there while the button is still down, or the reviewer is drawing blind.
   The cursor is a nib while the pen is armed (`getComputedStyle(stage).cursor` names a `url(...)`),
   and the hand that pans it is not.
4. `Ctrl+Z` drops the last stroke. `Escape` (or `b` again) puts the pen away, and a drag pans again.
5. Switch to a print page → the pen must be put away by itself: the stage carries no `pen-armed`
   class, the cursor is the panning hand again, and the action bar has no pen.
6. Press **Save sketch** → the status reads `sketch saved: /tmp/texteda-sketches/…png · numbers in
   …json`, and both files are there:

   ```sh
   ls -l /tmp/texteda-sketches/
   cat /tmp/texteda-sketches/*.json
   ```

   The numbers file is the ink's own millimetres, in the drawing's own frame — the half of the
   message a machine can read ([ADR-0073](../adr/09-view/0073-the-review-app-has-a-freehand-pen.md)
   D2). A sketch without it would leave the agent to measure the picture.

A sketch is a message, not a change: diff the scratch copy against the original and nothing has
changed. The strokes live in the browser and are gone on a reload — the picture on disk is what
survives.

## 5. Proving the snap grid numerically

Do not trust that a drag "looked snapped". Measure it.

1. **Zoom until one screen pixel is below the grid step.** Otherwise every drag lands on the same
   snapped point and the sweep proves nothing. Four `+` presses took `getScreenCTM().a` from
   0.98 to 1.92 px/mm — still ≈0.52 mm per pixel, i.e. still coarser than the grid. Read the CTM
   before trusting a sweep.
2. Sweep one pixel at a time and collect the distinct readouts:

   ```js
   const m = /→ ([\d.-]+), ([\d.-]+) mm/.exec(statusText);
   ```

3. Assert every readout is an integer multiple of the grid constant (`0.5` mm,
   `VIEW_GRID_MM`). Off-grid readouts mean the constant did not reach `snapPlacement` — not that
   the drag was wrong.
4. A single long drag may report only one or two distinct points. **That is correct** for a coarse
   grid; the sweep is what proves the constant.

After `Apply`, diff the scratch page against the original. Verify the action-bar controls first:

- `Auto fields: off` and `Re-anchor wires: off` are the initial labels.
- Clicking Auto fields changes only that label to `on`; Re-anchor wires remains `off`.
- Clicking Re-anchor wires then changes only that label to `on`.
- Reloading the page restores both defaults to `off`.

A correct move with Re-anchor wires **off** changes the moved `place` row and the affected wire
endpoint rows. The endpoint rows use visible `@x,y` coordinates at the old pin positions, so the
wire keeps its segment count, bends and directions. The affected nets are reported stale. A correct
move with Re-anchor wires **on** keeps pin endpoint references and applies the existing re-anchor
and path-simplification behavior. Auto fields is independent: with it off, field anchors remain
symbol-local; with it on, only the page-level field collision placement pass is enabled.

Coordinate endpoints are ordinary source-visible drawing geometry. They do not create or alter
schematic connectivity and are not pin-membership evidence.

Then re-run the check on the scratch copy:

```sh
bun run texteda check /tmp/texteda-review-smoke
```

A moved symbol must not silently alter the schematic net model. If Re-anchor wires is off, the
expected stale wire findings are the intentional report for the preserved drawing; if it is on,
inspect the returned conflicts and the resulting page instead.

### 6.1 The bytes the write replaced are kept

The write keeps what it replaced under `dist/backups/`, mirroring the page's own path. After the
Apply above:

```sh
ls /tmp/texteda-review-smoke/dist/backups/views/
diff /tmp/texteda-review-smoke/dist/backups/views/modules/buck-5v.module-view.teda \
     examples/reference-project/views/modules/buck-5v.module-view.teda
```

The backup holds the page **as it was before the write**, so the diff against the original shows
no change. The backup is a local undo, not a source: it lives under `dist/`, which is gitignored
(ADR-0060).

### 6.2 Only the rows that changed were written

The Apply recomputes the page, but it must not rewrite the whole drawing. Check which rows
actually moved:

```sh
diff examples/reference-project/views/modules/buck-5v.module-view.teda \
     /tmp/texteda-review-smoke/views/modules/buck-5v.module-view.teda
```

With Re-anchor wires off, a single moved symbol changes its `place` row and the affected wire rows;
the changed endpoint cells are explicit `@x,y` coordinates at the old pin positions. With
Re-anchor wires on, the affected wire endpoints remain pin references and the existing re-anchor
pass decides any bend changes. Every unrelated row is byte-identical.

A label the reviewer placed **away** from the wiring must not be carried onto it by a move
elsewhere on the same net (ADR-0061 D1). If a diff shows a label jumping to the wire, the page
had a label that was on the wiring and the reviewer did not intend it to move — check the
`reseated` list the app reports.

### 6.3 The cost grows with the page, not faster

A move on a big page must not cost the square of a move on a small one. The benchmark builds the
shape that shows it — one net carrying many wires and many labels, so one move changes many rows:

```sh
bun test packages/cli/test/benchmark-apply.test.ts
```

The test asserts the *growth rate*, not an absolute time, because a slower machine is allowed to
be slower. It fails if the page is rescanned once per changed row.

## 7. Clean up

Never leave the server running.

```sh
rm -rf /tmp/texteda-review-smoke /tmp/review-server.log
```

Close the tab with `browser.close({ name })` so the spawned Chromium does not stay alive.

## 8. What not to do

- Do not drive the **source** project. Copy it first; `Apply` writes files.
- Do not start driving before the server answers `200`.
- Do not rely on the managed Chromium here; it does not run on this host.
- Do not conclude the snap grid works from one drag.
- Do not expect the pen's strokes to survive a reload: they are not saved state, and the saved
  picture is what survives.
- Do not leave a server or a browser process behind.

## 9. References

- [`docs/guides/review-app.md`](../guides/review-app.md): the app's bindings, the one-surface rule,
  and what the app may write.
- [ADR-0056](../adr/09-view/0056-the-review-app-has-one-interaction-surface.md): one interaction
  surface; D5 a completed move keeps its object selected, D6 the keyboard hint is resident.
- [ADR-0059](../adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D1:
  every stored coordinate is a `0.5 mm` lattice point.
- [ADR-0060](../adr/03-project/0060-a-write-keeps-the-bytes-it-replaced.md): a write keeps the bytes
  it replaced, under `dist/backups/`.
- [ADR-0061](../adr/09-view/0061-a-move-carries-only-what-belonged-to-the-net.md): a move carries
  only what belonged to the net; its cost grows with the page, not faster.
- [ADR-0073](../adr/09-view/0073-the-review-app-has-a-freehand-pen.md): the freehand pen, and a
  sketch as a message to the agent rather than a fact about the design.
- [`docs/skills/README.md`](README.md): the index of the procedures.
