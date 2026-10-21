#!/usr/bin/env bun
// Footprint IR → KiCad artifacts.
//
// Usage:
//   bun run scripts/export-footprint.ts <footprint.json> [--out <dir>] [--inline <x> <y>]
//
//   --out <dir>   Write <dir>/<name>.kicad_mod (drop the directory into a .pretty folder and it is a KiCad library)
//   --inline x y  Instead emit an inline footprint block for a board file (coordinates in mm)
// Without --out, print to stdout.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { validate } from "@texteda/ir";
import type { Footprint } from "@texteda/ir/footprint";
import { footprintModule, footprintInline, type FootprintBody } from "../src/footprint.ts";

/** Narrow the type after validation: ajv checked against the schema, but TS does not know that. */
function isFootprintDoc(value: unknown): value is Footprint {
  return typeof value === "object" && value !== null && "footprint" in value;
}

const args = process.argv.slice(2);
const file = args[0];
if (!file) {
  console.error("Usage: bun run scripts/export-footprint.ts <footprint.json> [--out <dir>] [--inline <x> <y>]");
  process.exit(2);
}

const doc = JSON.parse(readFileSync(file, "utf8"));
const result = validate("footprint", doc);
if (!result.ok) {
  for (const e of result.errors) console.error(`${e.path || "/"}: ${e.message}`);
  process.exit(1);
}
if (!isFootprintDoc(doc)) {
  console.error("Not a footprint shard");
  process.exit(1);
}
const fp: FootprintBody = doc.footprint;

const outIdx = args.indexOf("--out");
const inlineIdx = args.indexOf("--inline");

if (inlineIdx >= 0) {
  const xMm = Number(args[inlineIdx + 1]);
  const yMm = Number(args[inlineIdx + 2]);
  process.stdout.write(
    footprintInline(fp, { xNm: Math.round(xMm * 1e6), yNm: Math.round(yMm * 1e6), reference: "U1" }),
  );
} else if (outIdx >= 0) {
  const dir = args[outIdx + 1];
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `${fp.name}.kicad_mod`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, footprintModule(fp));
  console.log(`wrote ${target}`);
} else {
  process.stdout.write(footprintModule(fp));
}
