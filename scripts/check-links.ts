#!/usr/bin/env bun
// Repository-level cross-reference checker: every Markdown link must resolve, every ADR number must point at a
// real decision record, and the ADR index must stay in sync with the decision records on disk.
//
// Usage:
//   bun run check:links
//
// Checks:
//   1. every relative Markdown link target exists (resolved relative to the file that contains it);
//   2. every ADR-NNNN mentioned in Markdown resolves to docs/adr/NNNN-*.md, or is a reserved number declared in
//      the index (a number that is planned but not written yet);
//   3. the ADR number in the link text matches the decision record the link points at;
//   4. docs/adr/README.md lists every decision record on disk exactly once, with matching title, status and date,
//      and reserves only numbers that have no file;
//   5. every decision record file name matches its H1 number, and carries exactly one Status and one Date header;
//   6. (R1) every appendix/addendum/amendment heading is dated;
//   7. (R2) a retired decision record keeps no body heading;
//   8. (R3) a retired decision record's Status line names its superseding record;
//   9. (R4) no appendix/addendum/amendment block exceeds 40% of the record (a warning);
//
// Exit code 1 if there is any error. R4 warnings never change the exit code.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const adrDir = join(repoRoot, "docs", "adr");
const adrIndexPath = join(adrDir, "README.md");

const skipDirs = new Set([".git", "node_modules", "dist", ".cache"]);
const problems: string[] = [];
const warnings: string[] = [];

/** The closed status vocabulary of a decision record (see AGENTS.md §12). */
const statusWords = new Set(["Accepted", "Proposed"]);

function fail(where: string, message: string): void {
  problems.push(`${where}: ${message}`);
}

function warn(where: string, message: string): void {
  warnings.push(`${where}: ${message}`);
}

function listMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listMarkdownFiles(full));
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out;
}

/** Split a file into text lines and the fenced code regions they belong to (code is not prose, so it is not checked). */
function splitCodeRegions(lines: string[]): { text: string; code: boolean }[] {
  const out: { text: string; code: boolean }[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const match = /^\s*(```+|~~~+)/.exec(line);
    if (fence === null && match) {
      fence = match[1][0];
      out.push({ text: line, code: true });
      continue;
    }
    if (fence !== null) {
      out.push({ text: line, code: true });
      if (match && match[1][0] === fence) fence = null;
      continue;
    }
    out.push({ text: line, code: false });
  }
  return out;
}

/** Replace inline code spans with blanks, keeping character offsets intact. */
function blankInlineCode(line: string): string {
  return line.replace(/`[^`\n]*`/g, (span) => " ".repeat(span.length));
}

const linkPattern = /\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
// Placeholder targets used by the policy docs' contract examples (a retired-pointer
// `XXXX-*.md` and a bare `…` citation) are not real links; they are forms to show, not
// links to resolve.
const placeholderTargetPattern = /^(?:…|XXXX-.*)$/;

const adrPattern = /\bADR-(\d{4})\b/g;

const adrFiles = new Map<string, string>(); // number -> file name
for (const entry of readdirSync(adrDir)) {
  const match = /^(\d{4})-.+\.md$/.exec(entry);
  if (match) adrFiles.set(match[1], entry);
}

// ---------------------------------------------------------------- index parsing

const indexText = existsSync(adrIndexPath) ? readFileSync(adrIndexPath, "utf-8") : "";
if (!indexText) fail(relative(repoRoot, adrIndexPath), "the ADR index is missing");

const indexRows = new Map<string, { title: string; status: string; date: string; target: string }>();
const reserved = new Map<string, { file: string; item: string }>();

for (const line of indexText.split("\n")) {
  const row = /^\|\s*\[ADR-(\d{4})\]\(([^)]+)\)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$/.exec(line);
  if (row) {
    const [, number, target, title, status, date] = row;
    if (indexRows.has(number)) fail(relative(repoRoot, adrIndexPath), `ADR-${number} is listed twice`);
    indexRows.set(number, { title, status, date, target });
    continue;
  }
  const reservedRow = /^\|\s*ADR-(\d{4})\s*\|\s*`([^`]+)`\s*\|\s*(\S+)\s*\|\s*$/.exec(line);
  if (reservedRow) {
    const [, number, file, item] = reservedRow;
    if (reserved.has(number)) fail(relative(repoRoot, adrIndexPath), `ADR-${number} is reserved twice`);
    reserved.set(number, { file, item });
  }
}

// ---------------------------------------------------------------- ADR headers

const adrHeader = new Map<string, { title: string; status: string; date: string }>();

for (const [number, file] of adrFiles) {
  const full = join(adrDir, file);
  const lines = readFileSync(full, "utf-8").split("\n");
  const where = relative(repoRoot, full);

  const h1 = /^#\s+ADR-(\d{4}):\s*(.+?)\s*$/.exec(lines[0] ?? "");
  if (!h1) fail(where, "the first line must be `# ADR-NNNN: Title`");
  else if (h1[1] !== number) fail(where, `the H1 says ADR-${h1[1]} but the file name says ADR-${number}`);

  const statusLines = lines.filter((line) => /^Status:/.test(line));
  const dateLines = lines.filter((line) => /^Date:/.test(line));
  if (statusLines.length !== 1) fail(where, `expected exactly one "Status:" header line, found ${statusLines.length}`);
  if (dateLines.length !== 1) fail(where, `expected exactly one "Date:" header line, found ${dateLines.length}`);

  const status = (statusLines[0] ?? "").replace(/^Status:\s*/, "").trim();
  const date = (dateLines[0] ?? "").replace(/^Date:\s*/, "").trim();

  // The status vocabulary is closed: the word before any parenthetical revision note.
  const statusWord = status.split(/[\s(]/)[0];
  if (status && !statusWords.has(statusWord)) {
    fail(where, `unknown status word "${statusWord}"; use one of ${[...statusWords].join(", ")}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(where, `the date must be YYYY-MM-DD, found "${date}"`);

  adrHeader.set(number, { title: h1 ? h1[2].trim() : "", status, date });
}

// ---------------------------------------------------------------- index <-> disk

for (const [number, file] of adrFiles) {
  if (!indexRows.has(number)) fail(relative(repoRoot, adrIndexPath), `ADR-${number} (${file}) is not listed`);
}
for (const [number, row] of indexRows) {
  if (!adrFiles.has(number)) {
    fail(relative(repoRoot, adrIndexPath), `ADR-${number} is listed but has no file in docs/adr/`);
    continue;
  }
  const expected = adrFiles.get(number)!;
  if (row.target !== expected) {
    fail(relative(repoRoot, adrIndexPath), `ADR-${number} points at ${row.target}, the file is ${expected}`);
  }
  const header = adrHeader.get(number)!;
  if (row.title !== header.title) {
    fail(relative(repoRoot, adrIndexPath), `ADR-${number} title differs from the file: "${row.title}" vs "${header.title}"`);
  }
  const statusWord = header.status.split(/[\s(]/)[0];
  if (row.status !== statusWord) {
    fail(relative(repoRoot, adrIndexPath), `ADR-${number} status differs from the file: "${row.status}" vs "${statusWord}"`);
  }
  if (row.date !== header.date) {
    fail(relative(repoRoot, adrIndexPath), `ADR-${number} date differs from the file: "${row.date}" vs "${header.date}"`);
  }
}
for (const [number, entry] of reserved) {
  if (adrFiles.has(number)) {
    fail(relative(repoRoot, adrIndexPath), `ADR-${number} is reserved but the file docs/adr/${entry.file} exists`);
  }
}

// ---------------------------------------------------------------- ADR records
// Decision-record shape checks for the SHARED CONTRACT (R1-R4). R1, R2 and R3 are hard problems;
// R4 is advisory: it is a warning that never changes the exit code.

const amendmentHeadingPattern = /^#{2,3} /;
const amendmentWordPattern = /Appendix|Addendum|Amendment/;
const datedHeadingPattern = /\d{4}-\d{2}-\d{2}/;
const retiredLinePattern = /^> \*\*Retired \d{4}-\d{2}-\d{2}/;
const retiredHeadingPattern = /^#{2,3} /;
const retiredSupersessionPattern = /superseded by ADR-\d{4}|withdrawn/;
const statusNamePattern = /ADR-(\d{4})/g;

for (const [number, file] of adrFiles) {
  const full = join(adrDir, file);
  const where = relative(repoRoot, full);
  const lines = readFileSync(full, "utf-8").split("\n");

  // R1: every appendix/addendum/amendment heading carries a date.
  for (const line of lines) {
    if (!amendmentHeadingPattern.exec(line) || !amendmentWordPattern.test(line)) continue;
    if (!datedHeadingPattern.test(line)) {
      fail(where, `amendment heading "${line.trim()}" is missing a date; add a YYYY-MM-DD date to it`);
    }
  }

  // R2 + R3: a retired record keeps no body heading, and names its superseding record.
  let retiredFrom = -1;
  for (let index = 0; index < lines.length; index++) {
    if (retiredLinePattern.test(lines[index])) {
      retiredFrom = index;
      break;
    }
  }
  if (retiredFrom >= 0) {
    // R2: no heading-level heading may appear after the retired line.
    for (let index = retiredFrom + 1; index < lines.length; index++) {
      if (retiredHeadingPattern.test(lines[index])) {
        fail(where, "a retired record keeps no body; the decision text belongs in git history");
        break;
      }
    }
    // R3: the Status line must name the supersession, and any named ADR must exist.
    const status = adrHeader.get(number)!.status;
    if (!retiredSupersessionPattern.test(status)) {
      fail(where, 'a retired record\'s Status line must contain "superseded by ADR-NNNN" or "withdrawn"');
    }
    const statusNames = status.matchAll(statusNamePattern).map((match) => match[1]);
    for (const name of statusNames) {
      if (!adrFiles.has(name)) {
        fail(where, `a retired record's Status line names ADR-${name}, which is not a decision record`);
      }
    }
  }

  // R4: an appendix/addendum/amendment block may not exceed 40% of the record (advisory — a warning).
  let firstAmendmentHeading = -1;
  for (let index = 0; index < lines.length; index++) {
    if (amendmentHeadingPattern.test(lines[index]) && amendmentWordPattern.test(lines[index])) {
      firstAmendmentHeading = index;
      break;
    }
  }
  if (firstAmendmentHeading >= 0) {
    const total = lines.length;
    const blockLines = total - firstAmendmentHeading; // lines from the amendment heading to EOF, heading line excluded
    const share = blockLines / total;
    if (share > 0.4) {
      warn(
        where,
        `${(share * 100).toFixed(1)}% of ${total} lines (${blockLines} lines from the amendment heading to EOF): ` +
          "consolidate on the next rewrite: a status block is ≤10 lines, a new rule is a new record, a wholesale supersession is a retirement",
      );
    }
  }
}


// ---------------------------------------------------------------- prose

for (const full of listMarkdownFiles(repoRoot)) {
  const where = relative(repoRoot, full);
  const lines = readFileSync(full, "utf-8").split("\n");
  const regions = splitCodeRegions(lines);

  regions.forEach((region, index) => {
    if (region.code) return;
    const lineNumber = index + 1;
    const line = region.text;
    const prose = blankInlineCode(line);

    // link targets
    const linkSpans: { start: number; end: number; text: string; target: string }[] = [];
    for (const match of prose.matchAll(linkPattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const [, text, target] = match;
      linkSpans.push({ start, end, text, target });

      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue; // external, mailto, anchor
      const [path] = target.split("#");
      if (!path) continue;
      if (path.startsWith("/")) continue; // root-relative link, not resolvable from the file
      if (placeholderTargetPattern.test(path)) continue; // a contract-example placeholder, not a real link
      if (!existsSync(resolve(dirname(full), path))) {
        fail(`${where}:${lineNumber}`, `link target does not exist: ${target}`);
      }
    }

    // ADR numbers
    for (const match of prose.matchAll(adrPattern)) {
      const number = match[1];
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const inLink = linkSpans.find((span) => start >= span.start && end <= span.end);

      if (inLink) {
        const target = inLink.target.split("#")[0];
        if (!adrFiles.has(number)) {
          fail(`${where}:${lineNumber}`, `ADR-${number} is linked but there is no docs/adr/${number}-*.md`);
          continue;
        }
        const expected = adrFiles.get(number)!;
        const resolved = resolve(dirname(full), target);
        if (resolved !== join(adrDir, expected)) {
          fail(`${where}:${lineNumber}`, `ADR-${number} links to ${target}, the decision record is ${expected}`);
        }
        continue;
      }

      if (!adrFiles.has(number) && !reserved.has(number)) {
        fail(
          `${where}:${lineNumber}`,
          `ADR-${number} is mentioned but there is no decision record for it and it is not reserved in docs/adr/README.md`,
        );
      }
    }
  });
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`\n${problems.length} cross-reference problem(s)`);
  process.exit(1);
}

// Advisory warnings (R4) go to stderr before the ok line; they never change the exit code.
for (const entry of warnings) console.warn(`warning: ${entry}`);

let okSummary =
  `check:links ok — ${adrFiles.size} decision records, ${indexRows.size} indexed, ${reserved.size} reserved, ` +
    `${listMarkdownFiles(repoRoot).length} Markdown files`;
if (warnings.length > 0) okSummary += `, ${warnings.length} warning(s)`;
console.log(okSummary);
