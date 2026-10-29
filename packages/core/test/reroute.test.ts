// `rerouteWire`: bringing a wire back onto its pins from the file alone.
//
// The app's re-anchor needs the before-state (it is the app's job, after a drag). The command
// line's rewire has only the page as it stands: the corners say which way the ends have to leave,
// and the pins say where they have to arrive.
import { describe, expect, test } from "bun:test";
import { rerouteWire } from "../src/view/reroute.ts";

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
