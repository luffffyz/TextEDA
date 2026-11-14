// The pen's own arithmetic: what a stroke turns into, and what a picture is called.
//
// A sketch is the one thing a reviewer says by hand, so the parts that decide what the agent will
// see — the ink's weight, the path's shape, the caption, the file's name — are pure functions, and
// they are checked here without a browser.
import { describe, expect, test } from "bun:test";
import {
  SKETCH_STROKE,
  SKETCH_STROKE_WIDTH_MM,
  canSketch,
  sketchCaption,
  sketchFileName,
  sketchFileStem,
  sketchInk,
  sketchNotes,
  sketchNotesFileName,
  sketchNotesJson,
  sketchOverlayMarkup,
  sketchPathData,
  sketchSourceInk,
  sketchSvg,
  type SketchStroke,
} from "../src/sketch.ts";

/** A stroke through three points. */
const stroke: SketchStroke = { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }] };

describe("the pen is offered on the drawings whose subject is geometry", () => {
  test("a library symbol is offered the pen", () => {
    expect(canSketch("symbol")).toBe(true);
  });

  test("nothing else is", () => {
    for (const kind of ["sch", "pcb", "footprint", "module"]) {
      expect(canSketch(kind)).toBe(false);
    }
  });
});

describe("the ink", () => {
  test("the pen's weight is the drawing's own", () => {
    expect(SKETCH_STROKE_WIDTH_MM).toBe(0.25);
  });

  test("the ink is grey, so it is never the drawing's own lines", () => {
    expect(SKETCH_STROKE).toBe("#7f7f7f");
  });
});

describe("the strokes become one path", () => {
  test("a stroke is a move and a chain of lines", () => {
    expect(sketchPathData([stroke])).toBe("M 1 2 L 3 4 L 5 6");
  });

  test("two strokes are two moves", () => {
    expect(sketchPathData([stroke, stroke])).toBe("M 1 2 L 3 4 L 5 6 M 1 2 L 3 4 L 5 6");
  });

  test("a stroke with no points is left out rather than drawn as a dot", () => {
    expect(sketchPathData([{ points: [] }])).toBe("");
    expect(sketchPathData([])).toBe("");
  });

  test("the overlay is one object, and it carries the pen's weight and colour", () => {
    const markup = sketchOverlayMarkup([stroke]);
    expect(markup).toContain(`stroke-width="${SKETCH_STROKE_WIDTH_MM}"`);
    expect(markup).toContain(`stroke="${SKETCH_STROKE}"`);
    expect(markup).toContain("<path");
    expect(markup.match(/<path/g)).toHaveLength(1);
  });

  test("nothing drawn is no overlay at all", () => {
    expect(sketchOverlayMarkup([])).toBe("");
  });
});

describe("the picture says what it is", () => {
  test("the caption names the kind, the drawing and the day", () => {
    expect(sketchCaption("symbol", "led", "2026-11-13")).toBe("symbol · led · 2026-11-13");
  });

  test("the drawing's own name comes first, so a folder sorts by what it is about", () => {
    expect(sketchFileStem("symbol/indicators/led")).toBe("indicators-led");
    expect(sketchFileName("symbol/indicators/led", 1)).toBe("indicators-led-1.png");
  });

  test("the number keeps the order the pictures were drawn in", () => {
    expect(sketchFileName("symbol/indicators/led", 2)).toBe("indicators-led-2.png");
  });

  test("a name with nothing usable in it still gets a name", () => {
    expect(sketchFileStem("symbol/")).toBe("sketch");
  });
});

describe("the ink goes on top of the drawing", () => {
  const drawing = '<svg width="10mm" height="10mm"><g class="body"/></svg>';

  test("the overlay is painted after the drawing, not under it", () => {
    const withInk = sketchSvg(drawing, [stroke]);
    expect(withInk).toContain('class="body"');
    expect(withInk.indexOf('class="body"')).toBeLessThan(withInk.indexOf("sketch-ink"));
    expect(withInk.endsWith("</svg>")).toBe(true);
  });

  test("a drawing with nothing drawn on it is the drawing", () => {
    expect(sketchSvg(drawing, [])).toBe(drawing);
  });

  test("a document that is not a drawing is left alone", () => {
    expect(sketchSvg("not svg", [stroke])).toBe("not svg");
  });
});

describe("the ink travels as numbers", () => {
  test("a stroke becomes a list of points", () => {
    expect(sketchInk([stroke])).toEqual([{ points: [[1, 2], [3, 4], [5, 6]] }]);
  });

  test("nothing drawn is no ink", () => {
    expect(sketchInk([])).toEqual([]);
  });
});

describe("the sidecar says what the sketch is", () => {
  const notes = sketchNotes({
    drawing: "symbol/indicators:led",
    kind: "symbol",
    label: "led",
    ink: sketchInk([{ points: [{ x: 1.23456, y: -2.98765 }] }]),
    source_hash: "e8cee2cb",
    tool_version: "0.1.0",
    saved_at: "2026-11-14T12:47:12.000Z",
  });

  test("it names the drawing and the build it was drawn on", () => {
    expect(notes.drawing).toBe("symbol/indicators:led");
    expect(notes.kind).toBe("symbol");
    expect(notes.label).toBe("led");
    expect(notes.source_hash).toBe("e8cee2cb");
    expect(notes.tool_version).toBe("0.1.0");
    expect(notes.saved_at).toBe("2026-11-14T12:47:12.000Z");
  });

  test("the ink is measured in the drawing's own millimetres, and says so", () => {
    expect(notes.space).toBe("source-millimetres");
  });

  test("the ink is rounded to the micrometre, because the file is read", () => {
    expect(notes.strokes).toEqual([{ points: [[1.235, -2.988]] }]);
  });

  test("there is no field that says what to change", () => {
    expect(Object.keys(notes).sort()).toEqual([
      "drawing",
      "kind",
      "label",
      "saved_at",
      "source_hash",
      "space",
      "strokes",
      "tool_version",
    ]);
  });

  test("the file is the notes, and ends with a newline", () => {
    const text = sketchNotesJson(notes);
    expect(text.endsWith("}\n")).toBe(true);
    expect(JSON.parse(text)).toEqual(notes);
  });

  test("the numbers sit beside the picture", () => {
    expect(sketchNotesFileName("symbol/indicators:led", 2)).toBe("indicators-led-2.json");
    expect(sketchFileName("symbol/indicators:led", 2)).toBe("indicators-led-2.png");
  });
});

describe("the ink is written in the drawing's own frame", () => {
  test("a symbol's source has y up, so the ink's y is turned back", () => {
    // The drawing on the screen is y-down — that is what SVG is. A symbol's source is y-up.
    expect(sketchSourceInk("symbol", [{ points: [{ x: 2.72, y: -3.27 }] }])).toEqual([
      { points: [[2.72, 3.27]] },
    ]);
  });

  test("a footprint and a page are y-down already, so nothing turns", () => {
    for (const kind of ["footprint", "pcb", "sch", "module"]) {
      expect(sketchSourceInk(kind, [{ points: [{ x: 2.72, y: -3.27 }] }])).toEqual([
        { points: [[2.72, -3.27]] },
      ]);
    }
  });

  test("the ink itself is untouched: it is the frame that differs", () => {
    expect(sketchInk([stroke])).toEqual([{ points: [[1, 2], [3, 4], [5, 6]] }]);
  });
});
