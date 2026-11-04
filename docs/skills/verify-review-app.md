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
4. Mouse up → `move kept locally; Apply to write it`.
5. Press **Apply** → `applied: N symbols moved, … written`.

`Escape` cancels the transaction and restores the move without touching the unrelated pending
edits. **Until `Apply`, nothing is written** — the page's old wires keep their now-stale bends,
which is why `view.wire-diagonal` / `view.wire-crosses-pin` appear after the write.

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

## 6. Apply is a write — verify the file

After `Apply`, diff the scratch page against the original. A correct move:

- changes only the moved `place` row and the endpoints of the wires and ports that touch the
  moved pin;
- keeps the same segment count and the same directions;
- lands both coordinates on the grid.

Then re-run the check on the scratch copy:

```sh
bun run texteda check /tmp/texteda-review-smoke
```

A moved symbol must not introduce a `view.*` finding. `view metrics` reports
`No wire needed re-anchoring.` when nothing is stale.

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
- Do not leave a server or a browser process behind.

## 9. References

- [`docs/guides/review-app.md`](../guides/review-app.md): the app's bindings, the one-surface rule,
  and what the app may write.
- [ADR-0056](../adr/09-view/0056-the-review-app-has-one-interaction-surface.md): one interaction
  surface.
- [ADR-0059](../adr/09-view/0059-print-page-coordinates-anchor-on-the-half-millimetre-lattice.md) D1:
  every stored coordinate is a `0.5 mm` lattice point.
- [`docs/skills/README.md`](README.md): the index of the procedures.
