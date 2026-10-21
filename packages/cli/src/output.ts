// Writing command output to disk.
//
// The CLI is the only layer that touches the file system (ADR-0009 decision 1); `ir` / `parser` /
// `core` never do.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Write a file, creating the parent directory when it does not exist.
 *
 * `texteda init` does not create `dist/` — the contract says the export commands create it — so
 * `--out dist/schematic.json` has to work on a fresh project instead of dying with a raw ENOENT
 * that names neither the command nor the file.
 */
export function writeOut(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
