// The raster backend: the same drawing commands, painted into pixels (spec/rendering.md §2).
//
// What is checked here: that the picture has the drawing's colours where the drawing puts them,
// that it is deterministic (invariant 18), and that the PNG we write is a PNG a reader can decode.
// The deflate stream is checked against Node's own inflate, so a mistake in the encoder cannot
// pass unnoticed.
import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { encodePng, rasterize, type SvgDoc } from "../src/index.ts";

/** A drawing with one horizontal stroke: the simplest thing that has an ink pixel and a margin. */
const lineDoc: SvgDoc = {
  kind: "symbol",
  title: "one line",
  orientation: "y-up",
  primitives: [
    { kind: "line", x1: 0, y1: 0, x2: 10_000_000, y2: 0, widthNm: 1_000_000, layer: "symbol" },
  ],
};

function pixel(image: { data: Uint8Array; width: number }, x: number, y: number): [number, number, number] {
  const index = (y * image.width + x) * 3;
  return [image.data[index]!, image.data[index + 1]!, image.data[index + 2]!];
}

function chunks(png: Uint8Array): { type: string; data: Uint8Array }[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: { type: string; data: Uint8Array }[] = [];
  let offset = 8; // the signature
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(png[offset + 4]!, png[offset + 5]!, png[offset + 6]!, png[offset + 7]!);
    out.push({ type, data: png.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return out;
}

describe("rasterizing a drawing", () => {
  test("the stroke is painted where the drawing puts it, the rest stays background", () => {
    // The drawing area is the line plus the 2 mm margin on every side: 14 mm × 4 mm.
    const image = rasterize(lineDoc, { widthPx: 140 });
    expect(image.width).toBe(140);
    expect(image.height).toBe(40);
    // The stroke sits at y = 0, which is 2 mm below the top edge: 20 pixels down.
    const onStroke = pixel(image, 70, 20);
    expect(onStroke[0]).toBeLessThan(80);
    expect(onStroke[2]).toBeLessThan(80);
    const offStroke = pixel(image, 70, 5);
    expect(offStroke).toEqual([255, 255, 255]);
  });

  test("the same drawing always paints the same bytes", () => {
    const first = encodePng(rasterize(lineDoc, { widthPx: 200 }));
    const second = encodePng(rasterize(lineDoc, { widthPx: 200 }));
    expect(Array.from(first)).toEqual(Array.from(second));
  });

  test("a crop paints only the cropped part of the drawing", () => {
    const whole = rasterize(lineDoc, { widthPx: 140 });
    const cropped = rasterize(lineDoc, {
      widthPx: 140,
      crop: { x0: 0, y0: -1_000_000, x1: 2_000_000, y1: 1_000_000 },
    });
    expect(cropped.width).toBe(140);
    // 2 mm of drawing at 70 pixels per millimetre.
    expect(cropped.height).toBe(140);
    // The stroke is inside the crop, so it is still there.
    expect(pixel(cropped, 70, 70)[0]).toBeLessThan(80);
    expect(whole.height).toBe(40);
  });
});

describe("the PNG encoder", () => {
  test("writes a PNG: the signature, the header, the image data and the end marker", () => {
    const png = encodePng(rasterize(lineDoc, { widthPx: 64 }));
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const parts = chunks(png);
    expect(parts.map((part) => part.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    const view = new DataView(parts[0]!.data.buffer, parts[0]!.data.byteOffset, parts[0]!.data.byteLength);
    expect(view.getUint32(0)).toBe(64);
    expect(view.getUint32(4)).toBe(18);
    expect(parts[0]!.data[8]).toBe(8); // bit depth
    expect(parts[0]!.data[9]).toBe(2); // colour type: truecolour
  });

  test("the compressed image data inflates back to the rows of pixels", () => {
    const image = rasterize(lineDoc, { widthPx: 64 });
    const png = encodePng(image);
    const parts = chunks(png);
    const inflated = new Uint8Array(inflateSync(parts[1]!.data));
    const stride = image.width * 3;
    expect(inflated.length).toBe(image.height * (stride + 1));
    // Undo the row filters and compare with the picture that was encoded.
    let previous = new Uint8Array(stride);
    for (let y = 0; y < image.height; y++) {
      const filter = inflated[y * (stride + 1)]!;
      const row = new Uint8Array(stride);
      for (let i = 0; i < stride; i++) {
        const raw = inflated[y * (stride + 1) + 1 + i]!;
        const left = i >= 3 ? row[i - 3]! : 0;
        const above = previous[i]!;
        const value = filter === 0 ? raw : filter === 1 ? raw + left : raw + above;
        row[i] = value & 0xff;
      }
      expect(Array.from(row)).toEqual(Array.from(image.data.subarray(y * stride, (y + 1) * stride)));
      previous = row;
    }
  });
});
