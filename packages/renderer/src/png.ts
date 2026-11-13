// Encode a raster picture as a PNG file.
//
// The encoder is ours, on purpose: the renderer package has to run in a browser and in a Node host
// without pulling in a native dependency, so the deflate stream and the chunks are written here
// (spec/rendering.md §2, ADR-0072). The output is an ordinary 8-bit truecolour PNG with a single
// IDAT chunk — every viewer reads it.
//
// Deterministic (invariant 18): the same pixels always produce the same bytes.
import type { RasterImage } from "./raster.ts";

/** Bytes per pixel in the picture: RGB, no alpha. */
const BYTES_PER_PIXEL = 3;

/** The deflate length codes: the smallest length each code stands for, and its extra bits. */
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];

/** The deflate distance codes: the smallest distance each code stands for, and its extra bits. */
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

/** The deflate window: how far back a match may reach. */
const WINDOW = 32768;
/** The longest match deflate can encode. */
const MAX_MATCH = 258;
/** How many candidates a hash chain is walked through; more costs time and rarely pays off. */
const MAX_CHAIN = 64;

/** A bit writer: the deflate stream packs bits into bytes starting at the least significant bit. */
class BitWriter {
  private readonly bytes: number[] = [];
  private buffer = 0;
  private count = 0;

  /** Write `count` bits of `value`, least significant bit first (deflate's extra bits). */
  writeBits(value: number, count: number): void {
    for (let bit = 0; bit < count; bit++) {
      this.buffer |= ((value >>> bit) & 1) << this.count;
      this.count++;
      if (this.count === 8) {
        this.bytes.push(this.buffer & 0xff);
        this.buffer = 0;
        this.count = 0;
      }
    }
  }

  /** Write a Huffman code, most significant bit first (deflate's codes are written this way). */
  writeCode(code: number, count: number): void {
    for (let bit = count - 1; bit >= 0; bit--) {
      this.buffer |= ((code >>> bit) & 1) << this.count;
      this.count++;
      if (this.count === 8) {
        this.bytes.push(this.buffer & 0xff);
        this.buffer = 0;
        this.count = 0;
      }
    }
  }

  finish(): Uint8Array {
    if (this.count > 0) {
      this.bytes.push(this.buffer & 0xff);
      this.buffer = 0;
      this.count = 0;
    }
    return Uint8Array.from(this.bytes);
  }
}

/** A literal byte, in the fixed Huffman code of RFC 1951 §3.2.6. */
function writeLiteral(writer: BitWriter, literal: number): void {
  if (literal < 144) writer.writeCode(0x30 + literal, 8);
  else writer.writeCode(0x190 + literal - 144, 9);
}

/** The end-of-block symbol (256) and the other codes above 256, in the fixed Huffman code. */
function writeSymbol(writer: BitWriter, symbol: number): void {
  if (symbol < 280) writer.writeCode(symbol - 256, 7);
  else writer.writeCode(0xc0 + symbol - 280, 8);
}

function writeLength(writer: BitWriter, length: number): void {
  let index = LENGTH_BASE.length - 1;
  while (index > 0 && LENGTH_BASE[index]! > length) index--;
  writeSymbol(writer, 257 + index);
  writer.writeBits(length - LENGTH_BASE[index]!, LENGTH_EXTRA[index]!);
}

function writeDistance(writer: BitWriter, distance: number): void {
  let index = DISTANCE_BASE.length - 1;
  while (index > 0 && DISTANCE_BASE[index]! > distance) index--;
  writer.writeCode(index, 5);
  writer.writeBits(distance - DISTANCE_BASE[index]!, DISTANCE_EXTRA[index]!);
}

/**
 * Compress with deflate, using the fixed Huffman code and a hash chain over three-byte prefixes.
 *
 * The pictures this writes are mostly background with a few strokes in it, so the long runs of
 * equal bytes are what has to compress well.
 */
function deflateRaw(data: Uint8Array): Uint8Array {
  const writer = new BitWriter();
  writer.writeBits(1, 1); // the last block
  writer.writeBits(1, 2); // fixed Huffman codes

  const head = new Map<number, number>();
  const previous = new Int32Array(data.length).fill(-1);
  const hashAt = (index: number): number =>
    index + 2 < data.length ? (((data[index]! << 10) ^ (data[index + 1]! << 5) ^ data[index + 2]!) & 0xffff) : -1;

  let index = 0;
  while (index < data.length) {
    let bestLength = 0;
    let bestDistance = 0;
    const hash = hashAt(index);
    if (hash >= 0) {
      let candidate = head.get(hash) ?? -1;
      let chain = 0;
      const limit = Math.min(MAX_MATCH, data.length - index);
      while (candidate >= 0 && chain < MAX_CHAIN) {
        const distance = index - candidate;
        if (distance > WINDOW) break;
        let length = 0;
        while (length < limit && data[candidate + length] === data[index + length]) length++;
        if (length > bestLength) {
          bestLength = length;
          bestDistance = distance;
          if (length === limit) break;
        }
        candidate = previous[candidate] ?? -1;
        chain++;
      }
    }

    if (bestLength >= 3) {
      writeLength(writer, bestLength);
      writeDistance(writer, bestDistance);
      for (let step = 0; step < bestLength; step++) {
        const position = index + step;
        const hash = hashAt(position);
        if (hash < 0) continue;
        previous[position] = head.get(hash) ?? -1;
        head.set(hash, position);
      }
      index += bestLength;
    } else {
      writeLiteral(writer, data[index]!);
      if (hash >= 0) {
        previous[index] = head.get(hash) ?? -1;
        head.set(hash, index);
      }
      index++;
    }
  }

  writeSymbol(writer, 256);
  return writer.finish();
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The zlib wrapper around a deflate stream: a two-byte header and the Adler-32 of the data. */
function zlib(data: Uint8Array): Uint8Array {
  const compressed = deflateRaw(data);
  const out = new Uint8Array(compressed.length + 6);
  out[0] = 0x78; // deflate, a 32 KiB window
  out[1] = 0x01; // no preset dictionary, fastest compression
  out.set(compressed, 2);
  const checksum = adler32(data);
  const view = new DataView(out.buffer);
  view.setUint32(out.length - 4, checksum);
  return out;
}

/**
 * Filter one row of pixels.
 *
 * PNG filters a row against itself or against the row above, which is what makes the strokes
 * compress instead of the background. The filter with the smallest absolute sum wins (the
 * heuristic PNG's own reference encoder uses).
 */
function filterRow(row: Uint8Array, previous: Uint8Array | null): { filter: number; data: Uint8Array } {
  const candidates: { filter: number; data: Uint8Array; score: number }[] = [];
  const none = new Uint8Array(row.length);
  none.set(row);
  candidates.push({ filter: 0, data: none, score: scoreBytes(none) });

  const sub = new Uint8Array(row.length);
  for (let i = 0; i < row.length; i++) {
    sub[i] = (row[i]! - (i >= BYTES_PER_PIXEL ? row[i - BYTES_PER_PIXEL]! : 0)) & 0xff;
  }
  candidates.push({ filter: 1, data: sub, score: scoreBytes(sub) });

  if (previous) {
    const up = new Uint8Array(row.length);
    for (let i = 0; i < row.length; i++) up[i] = (row[i]! - previous[i]!) & 0xff;
    candidates.push({ filter: 2, data: up, score: scoreBytes(up) });
  }

  let best = candidates[0]!;
  for (const candidate of candidates) if (candidate.score < best.score) best = candidate;
  return { filter: best.filter, data: best.data };
}

function scoreBytes(data: Uint8Array): number {
  let score = 0;
  for (let i = 0; i < data.length; i++) {
    const value = data[i]!;
    score += value < 128 ? value : 256 - value;
  }
  return score;
}

/** One PNG chunk: its length, its type, its data and its CRC. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * Encode a picture as a PNG file.
 *
 * The bytes are deterministic: the same picture always produces the same file.
 */
export function encodePng(image: RasterImage): Uint8Array {
  const { width, height, data } = image;
  const stride = width * BYTES_PER_PIXEL;
  const raw = new Uint8Array(height * (stride + 1));
  let previous: Uint8Array | null = null;
  for (let y = 0; y < height; y++) {
    const row = data.subarray(y * stride, (y + 1) * stride);
    const filtered = filterRow(row, previous);
    raw[y * (stride + 1)] = filtered.filter;
    raw.set(filtered.data, y * (stride + 1) + 1);
    previous = row;
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  header[10] = 0; // compression: deflate
  header[11] = 0; // filter method: adaptive
  header[12] = 0; // no interlacing

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
