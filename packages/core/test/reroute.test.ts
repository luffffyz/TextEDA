// `rerouteWire`: bringing a wire back onto its pins from the file alone.
//
// The app's re-anchor needs the before-state (it is the app's job, after a drag). The command
// line's rewire has only the page as it stands: the corners say which way the ends have to leave,
// and the pins say where they have to arrive.
import { describe, expect, test } from "bun:test";
import { isLegalRun, reanchorWire, rerouteWire, simplifyRun } from "../src/view/reroute.ts";

const corner = (x: number, y: number) => ({ x_nm: x, y_nm: y });

describe("rerouteWire", () => {
  test("a wire that is already orthogonal is left alone", () => {
    const result = rerouteWire({
      net: "GND",
      from_pin: "U1.1",
      to_pin: "U2.2",
      points: [corner(100, 0)],
      from: corner(0, 0),
      to: corner(100, 50),
    });
    expect(result.changed).toBe(false);
    expect(result.conflict).toBeUndefined();
    expect(result.points).toEqual([corner(100, 0)]);
  });

  test("a moved pin pulls the end of the wire with it", () => {
    // The wire ran down from the pin and across to the corner; the pin moved 10 to the right.
    const result = rerouteWire({
      net: "GND",
      from_pin: "U1.1",
      to_pin: "U2.2",
      points: [corner(0, 50)],
      from: corner(10, 0),
      to: corner(100, 50),
    });
    expect(result.changed).toBe(true);
    // The segment next to the corner is horizontal, so the end has to leave vertically.
    expect(result.points).toEqual([corner(10, 50)]);
  });

  test("a wire with no corner gets the bend the spec asks for", () => {
    const result = rerouteWire({
      net: "GND",
      from_pin: "U1.1",
      to_pin: "U2.2",
      points: [],
      from: corner(0, 0),
      to: corner(30, 40),
    });
    expect(result.changed).toBe(true);
    expect(result.points).toEqual([corner(0, 40)]);
  });

  test("a wire with one corner reaches both pins", () => {
    const result = rerouteWire({
      net: "GND",
      from_pin: "U1.1",
      to_pin: "U2.2",
      points: [corner(5, 5)],
      from: corner(0, 0),
      to: corner(30, 40),
    });
    expect(result.changed).toBe(true);
    expect(result.points).toEqual([corner(0, 40)]);
  });

  test("the interior corners keep their coordinates", () => {
    const result = rerouteWire({
      net: "GND",
      from_pin: "U1.1",
      to_pin: "U2.2",
      points: [corner(0, 50), corner(80, 50)],
      from: corner(10, 0),
      to: corner(80, 90),
    });
    expect(result.changed).toBe(true);
    expect(result.points[1]).toEqual(corner(80, 50));
  });

  test("a wire whose interior is broken is reported, not redrawn", () => {
    const result = rerouteWire({
      net: "GND",
      from_pin: "U1.1",
      to_pin: "U2.2",
      points: [corner(0, 50), corner(80, 70)],
      from: corner(10, 0),
      to: corner(80, 90),
    });
    expect(result.conflict).toBe("not-orthogonal");
    expect(result.changed).toBe(false);
    expect(result.points).toEqual([corner(0, 50), corner(80, 70)]);
  });
});

// After the shape is kept, the corners the move introduced are read back. A corner that landed on
// its neighbour, or that doubles back along the run it came from, is not a corner: it draws a
// zero-length segment and a reversal, and the renderer counts that reversal as a third arm — which
// manufactures a junction dot the drawing never declared.
describe("reanchorWire after a pin moves past a corner", () => {
  const reanchor = async (input: Parameters<typeof import("../src/view/reroute.ts").reanchorWire>[0]) =>
    (await import("../src/view/reroute.ts")).reanchorWire(input);

  test("a duplicated bend is dropped, not carried", async () => {
    // The page's own data already carried `200.5 107.0  200.5 109.5  200.5 109.5`: the third point
    // sits on the second, so the run doubles back on itself before it reaches the pin.
    const result = await reanchor({
      net: "VFB",
      from_pin: "R1.2",
      to_pin: "R2.1",
      points: [corner(200.5, 107), corner(200.5, 109.5), corner(200.5, 109.5)],
      from: corner(200.5, 107),
      to: corner(200.5, 109.5),
      newFrom: corner(200.5, 107),
      newTo: corner(200.5, 105.5),
    });
    expect(result.conflict).toBeUndefined();
    // One bend at the corner the run shares, and nothing else: the path is two segments.
    expect(result.points).toEqual([corner(200.5, 107)]);
  });

  test("a reversal collapses instead of adding an arm", async () => {
    // The pin moved above the corner, so keeping the old corner would run down and straight back
    // up. The two segments share a line, so the corner is not a corner.
    const result = await reanchor({
      net: "VFB",
      from_pin: "R1.2",
      to_pin: "R2.1",
      points: [corner(200.5, 109.5)],
      from: corner(200.5, 107),
      to: corner(200.5, 113),
      newFrom: corner(200.5, 107),
      newTo: corner(200.5, 105.5),
    });
    expect(result.points).toEqual([]);
  });

  test("both ends stay where the move put them", async () => {
    // Whatever tidy removes, it never moves an end: the run starts and finishes at the pins.
    const result = await reanchor({
      net: "GND",
      from_pin: "D1.2",
      to_pin: "R2.2",
      points: [corner(200, 121), corner(200, 117.5)],
      from: corner(177.5, 121),
      to: corner(200, 117.5),
      newFrom: corner(177.5, 121),
      newTo: corner(200, 117.5),
    });
    expect(result.points).toEqual([corner(200, 121)]);
  });

  test("a hand-drawn detour is still a detour", async () => {
    // tidy removes redundant corners; it does not straighten a shape the person drew.
    const result = await reanchor({
      net: "GND",
      from_pin: "A.1",
      to_pin: "B.1",
      points: [corner(10, 20), corner(60, 20), corner(60, 60)],
      from: corner(10, 0),
      to: corner(90, 60),
      newFrom: corner(15, 0),
      newTo: corner(90, 60),
    });
    expect(result.points).toEqual([corner(15, 20), corner(60, 20), corner(60, 60)]);
  });
});

describe("reanchorWire when the kept shape would cross itself", () => {
  test("a reversed run is rebuilt as a straight line and reported", async () => {
    // The page carried `198.5 107 → 198.5 109.5 → 197 109.5`, and the pin moved above its corner.
    // Keeping all three corners now runs back across the leg the wire starts from: a shape nobody
    // drew, so it is lost, and the run between two ends on one axis is a straight line.
      const result = reanchorWire({
      net: "VFB",
      from_pin: "R1.2",
      to_pin: "R2.1",
      points: [corner(198.5, 107), corner(198.5, 109.5), corner(197, 109.5)],
      from: corner(197, 107),
      to: corner(197, 109.5),
      newFrom: corner(197, 107),
      newTo: corner(197, 99.5),
    });
    expect(result.conflict).toBe("shape-lost");
    expect(result.points).toEqual([]);
  });

  test("a run whose ends are on different axes gets one elbow, and no crossing", async () => {
    // An ordinary move: the shape is kept, and no conflict is reported.
      const result = reanchorWire({
      net: "VFB",
      from_pin: "R1.2",
      to_pin: "R2.1",
      points: [corner(198.5, 107), corner(198.5, 109.5)],
      from: corner(197, 107),
      to: corner(200.5, 109.5),
      newFrom: corner(197, 107),
      newTo: corner(200.5, 105.5),
    });
    expect(result.conflict).toBeUndefined();
    expect(result.points).toEqual([corner(198.5, 107), corner(198.5, 105.5)]);
  });
});

// Shortening a moved run: the corners it does not need go, the corners it does need stay.
describe("simplifyRun", () => {
  const box = (min_x: number, min_y: number, max_x: number, max_y: number) => ({
    min_x_nm: min_x,
    max_x_nm: max_x,
    min_y_nm: min_y,
    max_y_nm: max_y,
  });
  const symbol = (instance_id: string, body: ReturnType<typeof box>, pins: Record<string, [number, number]>) => ({
    instance_id,
    box: body,
    pins: new Map(Object.entries(pins).map(([n, [x, y]]) => [n, corner(x, y)])),
  });

  test("a corner the run does not need is dropped", () => {
    // L1.2 moved above C3's pin; the four-corner detour it used to need is now redundant.
    const result = simplifyRun(
      [corner(197, 92.5), corner(211, 92.5), corner(211, 95), corner(214.5, 95), corner(214.5, 102.5), corner(211, 102.5)],
      { symbols: [], ends: ["L1.2", "C3.1"] },
    );
    expect(result.changed).toBe(true);
    expect(result.path).toEqual([corner(197, 92.5), corner(211, 92.5), corner(211, 102.5)]);
  });

  test("a corner the run needs stays, because removing it would cross a body", () => {
    // The detour runs around R1's body; the straight drawing would go through it.
    const r1 = symbol("R1", box(196, 100.5, 198, 105.5), { "1": [197, 99], "2": [197, 107] });
    const result = simplifyRun(
      [corner(211, 102.5), corner(214.5, 102.5), corner(214.5, 97), corner(197, 97), corner(197, 99)],
      { symbols: [r1], ends: ["C3.1", "R1.1"] },
    );
    expect(result.changed).toBe(false);
    expect(result.path).toEqual([
      corner(211, 102.5),
      corner(214.5, 102.5),
      corner(214.5, 97),
      corner(197, 97),
      corner(197, 99),
    ]);
  });

  test("a bus keeps its line, because the shortcut would move it", () => {
    // The GND bus was drawn at y = 121; the pins are at 99 and 112.5. A two-corner shortcut exists
    // on the pins' own coordinates, but it is a different line on the sheet, not a shorter one.
    const result = simplifyRun(
      [corner(118, 99), corner(118, 121), corner(139, 121), corner(139, 112.5)],
      { symbols: [], ends: ["C1.2", "U1.6"] },
    );
    expect(result.changed).toBe(false);
    expect(result.path).toEqual([corner(118, 99), corner(118, 121), corner(139, 121), corner(139, 112.5)]);
  });

  test("a slanted candidate is never legal, however few corners it has", () => {
    expect(isLegalRun([corner(0, 0), corner(10, 10)], { symbols: [], ends: [] })).toBe(false);
    expect(isLegalRun([corner(0, 0), corner(10, 0)], { symbols: [], ends: [] })).toBe(true);
  });

  test("a straight run with no corners is left alone", () => {
    const result = simplifyRun([corner(0, 0), corner(100, 0)], { symbols: [], ends: [] });
    expect(result.changed).toBe(false);
    expect(result.path).toEqual([corner(0, 0), corner(100, 0)]);
  });

  test("the ends never move", () => {
    const result = simplifyRun(
      [corner(10, 20), corner(10, 50), corner(80, 50), corner(80, 90), corner(50, 90)],
      { symbols: [], ends: [] },
    );
    expect(result.path[0]).toEqual(corner(10, 20));
    expect(result.path[result.path.length - 1]).toEqual(corner(50, 90));
  });
});
