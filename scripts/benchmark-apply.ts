// A print page big enough to show how Apply's cost grows.
//
// Apply is not a diff against the file: it parses the page, computes the geometry of every symbol
// twice, re-anchors the wires whose pins moved, reseats what sat on the disturbed nets, rewrites
// the rows that changed, and draws the page again. The page here is built so that one move
// disturbs one net that carries many wires and many labels — the shape that made a single move
// cost time proportional to (labels on the net) × (wires on the page).
//
// The generator is deterministic: the same size gives the same page, byte for byte.
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A page with `n` symbols, `w` wires and `l` labels, all on one net. */
export function benchPage(n: number, w: number, l: number): string {
  const places: string[] = [];
  const wires: string[] = [];
  const labels: string[] = [];
  const cols = Math.ceil(Math.sqrt(n));
  const at = (i: number): { x: number; y: number } => ({
    x: 20 + (i % cols) * 12,
    y: 20 + Math.floor(i / cols) * 12,
  });
  for (let i = 0; i < n; i++) {
    const { x, y } = at(i);
    places.push(`  M2.R${i + 1}  ${x.toFixed(1)}  ${y.toFixed(1)}  0`);
  }
  for (let k = 0; k < w; k++) {
    const a = at(k % n);
    const b = at((k + 1) % n);
    wires.push(`  NET  M2.R${(k % n) + 1}.1  M2.R${((k + 1) % n) + 1}.1  ${a.x.toFixed(1)} ${a.y.toFixed(1)}  ${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
  }
  for (let k = 0; k < l; k++) {
    labels.push(`  NET  ${(25 + (k % 30) * 3).toFixed(1)}  ${(35 + Math.floor(k / 30) * 3).toFixed(1)}`);
  }
  return [
    "version 0.10",
    "view bench",
    "",
    "sheet 2000 2000",
    "",
    "place",
    ...places,
    "",
    "wire",
    ...wires,
    "",
    "label",
    ...labels,
    "",
  ].join("\n");
}

/** The request that moves one symbol on the benchmark page. */
export const BENCH_REQUEST = {
  board: "charger-buck",
  page: "bench",
  places: [{ instance_id: "M2.R1", x: 21.0, y: 21.0, rot: 0 }],
} as const;

/** Write the benchmark page into a copy of the reference project, and return the project's root. */
export function makeBenchProject(referenceProject: string, n: number, w: number, l: number): string {
  const dir = mkdtempSync(join(tmpdir(), "texteda-apply-bench-"));
  cpSync(referenceProject, dir, { recursive: true });
  writeFileSync(join(dir, "views/charger-buck/bench.view.teda"), benchPage(n, w, l));
  return dir;
}
