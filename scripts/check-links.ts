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

/** The closed status vocabulary of a decision record (see AGENTS.md §12). */
const statusWords = new Set(["Accepted", "Proposed"]);

const skipDirs = new Set([".git", "node_modules", "dist", ".cache"]);

// ---------------------------------------------------------------- pure helpers (all take `root`; every path is derived from it)

/** Recursively list Markdown files under `root` (skipping the directory skip list). */
function listMarkdownFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    if (skipDirs.has(entry)) continue;
    const full = join(root, entry);
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

// Section references. The filename may sit inside an inline code span (`spec/pcb.md` §4.9), so the
// section checks run on the line with the backtick characters removed: blanking a code span instead
// would erase the very filename the reference needs.
const qualifiedSectionPattern = /([A-Za-z0-9_./-]+\.md)\s*§\s*([0-9]+(?:\.[0-9]+)*)/g;
const bareSectionPattern = /§\s*([0-9]+(?:\.[0-9]+)*)/g;

// Backlog item references (F12, F49). Checked on the line with inline code blanked, because
// ADR-0016's retired numeric diagnostic codes (`F200`, `F100`) also look like item numbers.
const backlogItemPattern = /(?<![A-Za-z0-9_])F(\d{1,3})(?![A-Za-z0-9_])/g;

const amendmentHeadingPattern = /^#{2,3} /;
const amendmentWordPattern = /Appendix|Addendum|Amendment/;
const datedHeadingPattern = /\d{4}-\d{2}-\d{2}/;
const retiredLinePattern = /^> \*\*Retired \d{4}-\d{2}-\d{2}/;
const retiredHeadingPattern = /^#{2,3} /;
const retiredSupersessionPattern = /superseded by ADR-\d{4}|withdrawn/;
const statusNamePattern = /ADR-(\d{4})/g;

// ---------------------------------------------------------------- ADR on disk

function adrDir(root: string): string {
  return join(root, "docs", "adr");
}

function adrIndexPath(root: string): string {
  return join(adrDir(root), "README.md");
}

/**
 * Scan docs/adr for decision-record files, mapping number -> path relative to the corpus root.
 * The corpus is topic-foldered, so a record lives at `<topic>/NNNN-slug.md`; the map keeps the
 * relative path (POSIX separators) because the index and the link checks compare that string.
 */
function scanAdrFiles(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      if (statSync(full).isDirectory()) {
        walk(full, rel);
        continue;
      }
      const match = /^(\d{4})-.+\.md$/.exec(entry);
      if (match) out.set(match[1], rel);
    }
  };
  walk(adrDir(root), "");
  return out;
}

type IndexRow = { title: string; status: string; date: string; target: string };

type IndexResult = {
  text: string;
  missing: boolean;
  rows: Map<string, IndexRow>;
  reserved: Map<string, { file: string; item: string }>;
};

/** Parse the ADR index. `problems` collects duplicate-index problems (passed in for ordering). */
function parseIndex(root: string, problems: string[]): IndexResult {
  const indexPath = adrIndexPath(root);
  const indexText = existsSync(indexPath) ? readFileSync(indexPath, "utf-8") : "";
  const result: IndexResult = {
    text: indexText,
    missing: !indexText,
    rows: new Map(),
    reserved: new Map(),
  };
  if (!indexText) return result;
  for (const line of indexText.split("\n")) {
    const row = /^\|\s*\[ADR-(\d{4})\]\(([^)]+)\)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$/.exec(line);
    if (row) {
      const [, number, target, title, status, date] = row;
      if (result.rows.has(number)) {
        problems.push(`${relative(root, indexPath)}: ADR-${number} is listed twice`);
      }
      result.rows.set(number, { title, status, date, target });
      continue;
    }
    const reservedRow = /^\|\s*ADR-(\d{4})\s*\|\s*`([^`]+)`\s*\|\s*(\S+)\s*\|\s*$/.exec(line);
    if (reservedRow) {
      const [, number, file, item] = reservedRow;
      if (result.reserved.has(number)) {
        problems.push(`${relative(root, indexPath)}: ADR-${number} is reserved twice`);
      }
      result.reserved.set(number, { file, item });
    }
  }
  return result;
}

/** Read and validate the header of every decision-record file on disk (number -> header). */
function adrHeader(
  root: string,
  adrDir: string,
  adrFiles: Map<string, string>,
  problems: string[],
): Map<string, { title: string; status: string; date: string }> {
  const out = new Map<string, { title: string; status: string; date: string }>();
  for (const [number, file] of adrFiles) {
    const full = join(adrDir, file);
    const lines = readFileSync(full, "utf-8").split("\n");
    const where = relative(root, full);

    const h1 = /^#\s+ADR-(\d{4}):\s*(.+?)\s*$/.exec(lines[0] ?? "");
    if (!h1) fail(problems, where, "the first line must be `# ADR-NNNN: Title`");
    else if (h1[1] !== number) fail(problems, where, `the H1 says ADR-${h1[1]} but the file name says ADR-${number}`);

    const statusLines = lines.filter((line) => /^Status:/.test(line));
    const dateLines = lines.filter((line) => /^Date:/.test(line));
    if (statusLines.length !== 1) fail(problems, where, `expected exactly one "Status:" header line, found ${statusLines.length}`);
    if (dateLines.length !== 1) fail(problems, where, `expected exactly one "Date:" header line, found ${dateLines.length}`);

    const status = (statusLines[0] ?? "").replace(/^Status:\s*/, "").trim();
    const date = (dateLines[0] ?? "").replace(/^Date:\s*/, "").trim();

    // A record in a topic folder declares its scope: what it decides and what it does not. A record
    // that lives at the corpus root predates the topic folders and carries no scope line.
    if (file.includes("/")) {
      const scopeLines = lines.filter((line) => /^Scope:/.test(line));
      if (scopeLines.length !== 1) {
        fail(problems, where, `expected exactly one "Scope:" header line, found ${scopeLines.length}`);
      } else {
        const scope = scopeLines[0].replace(/^Scope:\s*/, "");
        if (!scope.includes("Decides:")) {
          fail(problems, where, 'the "Scope:" line must say what the record decides ("Decides:")');
        }
        if (!scope.includes("Does not decide:")) {
          fail(problems, where, 'the "Scope:" line must say what the record does not decide ("Does not decide:")');
        }
      }
    }

    // The status vocabulary is closed: the word before any parenthetical revision note.
    const statusWord = status.split(/[\s(]/)[0];
    if (status && !statusWords.has(statusWord)) {
      fail(problems, where, `unknown status word "${statusWord}"; use one of ${[...statusWords].join(", ")}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(problems, where, `the date must be YYYY-MM-DD, found "${date}"`);

    out.set(number, { title: h1 ? h1[2].trim() : "", status, date });
  }
  return out;
}

function fail(problems: string[], where: string, message: string): void {
  problems.push(`${where}: ${message}`);
}

function warn(warnings: string[], where: string, message: string): void {
  warnings.push(`${where}: ${message}`);
}

// ---------------------------------------------------------------- ADR record shape rules (R1-R4)

function adrRecordRules(
  problems: string[],
  warnings: string[],
  root: string,
  adrDir: string,
  adrFiles: Map<string, string>,
  adrHeader: Map<string, { title: string; status: string; date: string }>,
): void {
  for (const [number, file] of adrFiles) {
    const full = join(adrDir, file);
    const where = relative(root, full);
    const lines = readFileSync(full, "utf-8").split("\n");

    // R1: every appendix/addendum/amendment heading carries a date.
    for (const line of lines) {
      if (!amendmentHeadingPattern.exec(line) || !amendmentWordPattern.test(line)) continue;
      if (!datedHeadingPattern.test(line)) {
        fail(problems, where, `amendment heading "${line.trim()}" is missing a date; add a YYYY-MM-DD date to it`);
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
          fail(problems, where, "a retired record keeps no body; the decision text belongs in git history");
          break;
        }
      }
      // R3: the Status line must name the supersession, and any named ADR must exist.
      const status = adrHeader.get(number)!.status;
      if (!retiredSupersessionPattern.test(status)) {
        fail(problems, where, 'a retired record\'s Status line must contain "superseded by ADR-NNNN" or "withdrawn"');
      }
      const statusNames = status.matchAll(statusNamePattern).map((match) => match[1]);
      for (const name of statusNames) {
        if (!adrFiles.has(name)) {
          fail(problems, where, `a retired record's Status line names ADR-${name}, which is not a decision record`);
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
          warnings,
          where,
          `${(share * 100).toFixed(1)}% of ${total} lines (${blockLines} lines from the amendment heading to EOF): ` +
            "consolidate on the next rewrite: a status block is ≤10 lines, a new rule is a new record, a wholesale supersession is a retirement",
        );
      }
    }
  }
}

// ---------------------------------------------------------------- section and item references

/** The numbered headings a file declares (`## 4. Foo` -> "4", `### 4.9 Bar` -> "4.9"). */
const headingCache = new Map<string, Set<string>>();
function headingNumbers(full: string): Set<string> {
  const cached = headingCache.get(full);
  if (cached) return cached;
  const out = new Set<string>();
  for (const line of readFileSync(full, "utf-8").split("\n")) {
    const match = /^#{1,6}\s+([0-9]+(?:\.[0-9]+)*)\.?(?:\s|$)/.exec(line);
    if (match) out.add(match[1]);
  }
  headingCache.set(full, out);
  return out;
}

/**
 * Where a `foo.md` reference is looked up, in order: the referring file's own directory, the
 * repository root, `spec/`, then `docs/`. The last two exist because the prose has always shortened
 * `spec/teda.md` to `teda.md` inside `spec/` and next to the decision records; a bare file name
 * that resolves in none of the four is reported rather than guessed.
 */
function resolveReference(root: string, fromDir: string, name: string): string | null {
  for (const base of [fromDir, root, join(root, "spec"), join(root, "docs")]) {
    const candidate = resolve(base, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** A decision record or a trial-run log is a record of the past: its dead pointers are advisory. */
function isHistoricalDoc(where: string): boolean {
  return where.startsWith("docs/adr/") || where.startsWith("docs/trial-run/");
}

/** Backlog items that are done are removed from the list and recorded as closed in the preamble. */
function backlogItems(root: string): { open: Set<string>; closed: Set<string> } {
  const path = join(root, "docs", "backlog.md");
  const open = new Set<string>();
  const closed = new Set<string>();
  if (!existsSync(path)) return { open, closed };
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const heading = /^##\s+(F\d+)\./.exec(line);
    if (heading) open.add(heading[1]);
    // `**F2（…）已关闭**` — the closure list in the preamble is what makes a removed number a valid reference.
    for (const mention of line.matchAll(/\*\*(F\d+)[（(][^*]{0,120}?已关闭\*\*/g)) closed.add(mention[1]);
  }
  for (const item of open) closed.delete(item);
  return { open, closed };
}

/**
 * Which files declare which numbered heading, so a bare `§N` can be told apart from one that no
 * document owns. The key is the section number; the value is the files that declare it.
 */
function allHeadingNumbers(root: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const full of listMarkdownFiles(root)) {
    for (const number of headingNumbers(full)) {
      const owners = out.get(number);
      if (owners) owners.push(relative(root, full));
      else out.set(number, [relative(root, full)]);
    }
  }
  return out;
}

/**
 * Where a document that lives outside this repository is named, so the section numbers that follow
 * it can be left alone: `SBVS348H §4 pin functions, §5.3 recommended operating conditions` cites
 * one datasheet twice, and neither number is a pointer into this tree.
 *
 * The name is a part number (letters and digits, like `SBVS348H`) or a phrase that names the kind
 * of document (`datasheet`, `approval sheet`). A `.md` file is not one of those: it is a document
 * that does live here, and its sections are checked.
 */
function externalDocumentAt(text: string, at: number): { start: number; end: number } | null {
  const before = text.slice(Math.max(0, at - 60), at);
  const part = /(?<![A-Za-z0-9_.])(\d*[A-Z]{2,}[A-Z0-9-]*\d+[A-Z0-9-]*)\s*$/.exec(before);
  if (part) {
    const start = Math.max(0, at - 60) + part.index;
    return { start, end: start + part[1].length };
  }
  const named = /\b(datasheet|data sheet|approval sheet|spec sheet|user manual|application note)\s*$/i.exec(before);
  if (named) {
    const start = Math.max(0, at - 60) + named.index;
    return { start, end: start + named[1].length };
  }
  return null;
}

/**
 * Check the prose references that are not links: `file.md §N`, a bare `§N`, and a backlog item `F12`.
 *
 * A `file.md` binds only to the `§N` that follows it with nothing but separators in between, so a
 * list such as `teda.md §7, §7.5` binds both numbers while `spec/pcb.md … （§13.4` does not steal a
 * section number that belongs to another file. A bound reference is resolved against the named file;
 * a bare one is accepted if any file in the tree declares that number.
 *
 * `docs/adr/` and `docs/trial-run/` are records of what was true when they were written, so a dead
 * pointer there is a warning. Everywhere else it is an error: a live document that points at a
 * section nobody has is the drift this check exists to catch.
 */
function referenceRules(
  problems: string[],
  warnings: string[],
  root: string,
  full: string,
  where: string,
  lineNumber: number,
  line: string,
  declared: Map<string, string[]>,
  backlog: { open: Set<string>; closed: Set<string> },
): void {
  const report = isHistoricalDoc(where) ? warnings : problems;
  const at = `${where}:${lineNumber}`;

  // A link target names the file as clearly as a plain file name does, so `[a.md](spec/a.md) §9.2`
  // binds §9.2 to that file. The target text is kept for binding; the parentheses are replaced by
  // spaces so that every offset in this string matches the one in the original line.
  const withTargets = line.replace(/\]\(([^)\s]*)\)/g, (whole, target: string) =>
    `]${target.padEnd(whole.length - 1 - target.length)}`,
  );

  // A reference written inside one code span is a sample of the notation rather than a pointer: the
  // rule that says "write `a.md §4.7`, not `§4.7`" has to be able to quote both forms without the
  // check resolving the samples. A file name in its own span followed by a number outside it is a
  // real reference, so only a span holding the whole thing is a sample.
  const samples: { start: number; end: number }[] = [];
  for (const match of withTargets.matchAll(/`[^`\n]*`/g)) {
    const start = match.index ?? 0;
    const inner = match[0].slice(1, -1);
    if (qualifiedSectionPattern.test(inner)) {
      samples.push({ start: start + 1, end: start + match[0].length - 1 });
    }
    qualifiedSectionPattern.lastIndex = 0;
  }

  // The backticks go next, so `` `spec/pcb.md` §4.9 `` reads as one reference. Removing them
  // shifts the offsets, so the samples are matched on the same string the events are found in:
  // the backticks are replaced by spaces instead of being deleted.
  const text = withTargets.replace(/`/g, " ");

  // A qualified reference already carries its section number, so the bare scan skips the spans it covers.
  type Event = { start: number; end: number; file: string | null; section: string };
  const events: Event[] = [];
  const covered: { start: number; end: number }[] = [];
  for (const match of text.matchAll(qualifiedSectionPattern)) {
    const start = match.index ?? 0;
    events.push({ start, end: start + match[0].length, file: match[1], section: match[2] });
    covered.push({ start, end: start + match[0].length });
  }
  for (const match of text.matchAll(bareSectionPattern)) {
    const start = match.index ?? 0;
    if (covered.some((span) => start >= span.start && start < span.end)) continue;
    events.push({ start, end: start + match[0].length, file: null, section: match[1] });
  }
  events.sort((a, b) => a.start - b.start);

  const own = headingNumbers(full);
  let cursor = 0;
  let pending: string | null = null; // the file the following section numbers belong to
  let pendingExternal = false; // the numbers that follow belong to a document outside the tree

  // Resolve one `file.md §N`. The reference may have meant this file rather than the one named before
  // it, so a missing section is only an error when this file does not declare it either.
  const checkBound = (file: string, section: string): void => {
    const target = resolveReference(root, dirname(full), file);
    if (target === null) {
      report.push(`${at}: ${file} §${section} — there is no such file`);
      return;
    }
    if (!headingNumbers(target).has(section) && !own.has(section)) {
      report.push(`${at}: ${file} §${section} — ${relative(root, target)} has no such section`);
    }
  };

  for (const event of events) {
    const gap = text.slice(cursor, event.start);
    cursor = event.end;
    // A quoted sample shows the notation; it is not a pointer.
    if (samples.some((span) => event.start >= span.start && event.end <= span.end)) continue;
    // A list keeps its file for the following numbers. The separators are the ones a list is written
    // with: a comma, a Chinese enumeration comma, a colon, a slash, a dash of either width, or the
    // word "and". Anything else ends the binding.
    if (!/^[\s,:;/、。–—-]*(?:and\s+)?$/i.test(gap)) {
      pending = null;
      // A document outside the tree keeps the numbers that follow it for the rest of the sentence:
      // `SBVS348H §4 pin functions, §5.3 recommended operating conditions` is one datasheet.
      if (!/^[^.。;；|]*$/.test(gap)) pendingExternal = false;
    }

    if (event.file !== null) {
      pending = event.file;
      checkBound(event.file, event.section);
      continue;
    }
    // A number introduced by a document that is not in this repository — a datasheet, an approval
    // sheet — points outside the tree, so there is nothing here to resolve. The name binds the
    // numbers that follow it, the way a file name does: `SBVS348H §4 …, §5.3 …` is one document.
    const external = externalDocumentAt(text, event.start);
    if (external !== null) {
      pendingExternal = true;
      continue;
    }
    if (pendingExternal) continue;
    if (pending !== null) {
      checkBound(pending, event.section);
      continue;
    }
    if (own.has(event.section)) continue; // a self-reference: the file says it
    const owners = declared.get(event.section);
    if (!owners) {
      report.push(`${at}: §${event.section} is declared by no document in the tree`);
      continue;
    }
    // The number exists, but not here, and the reader has no way to tell which file it means. The
    // writing rule asks for the qualified form; the number of existing occurrences is too large to
    // make this a failure on the day the check lands, so it is reported as a warning.
    if (owners.length === 1) {
      warnings.push(`${at}: §${event.section} is declared by ${owners[0]}, not by this file`);
    } else {
      warnings.push(`${at}: §${event.section} is declared by ${owners.length} files, not by this one`);
    }
  }

  // Backlog items: an item still in the list has a heading; a closed one is named in the preamble.
  const codeBlanked = line.replace(/`[^`\n]*`/g, (span) => " ".repeat(span.length));
  for (const match of codeBlanked.matchAll(backlogItemPattern)) {
    const item = `F${match[1]}`;
    if (backlog.open.has(item) || backlog.closed.has(item)) continue;
    report.push(`${at}: ${item} is neither an open backlog item nor recorded as closed`);
  }
}

// ---------------------------------------------------------------- prose checks

function proseRules(
  problems: string[],
  warnings: string[],
  root: string,
  adrDir: string,
  adrFiles: Map<string, string>,
  reserved: Map<string, string>,
): void {
  const declared = allHeadingNumbers(root);
  const backlog = backlogItems(root);
  for (const full of listMarkdownFiles(root)) {
    const where = relative(root, full);
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
          fail(problems, `${where}:${lineNumber}`, `link target does not exist: ${target}`);
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
            fail(problems, `${where}:${lineNumber}`, `ADR-${number} is linked but there is no docs/adr/**/${number}-*.md`);
            continue;
          }
          const expected = adrFiles.get(number)!;
          const resolved = resolve(dirname(full), target);
          if (resolved !== join(adrDir, expected)) {
            fail(problems, `${where}:${lineNumber}`, `ADR-${number} links to ${target}, the decision record is ${expected}`);
          }
          continue;
        }

        if (!adrFiles.has(number) && !reserved.has(number)) {
          fail(
            problems,
            `${where}:${lineNumber}`,
            `ADR-${number} is mentioned but there is no decision record for it and it is not reserved in docs/adr/README.md`,
          );
        }
      }

      referenceRules(problems, warnings, root, full, where, lineNumber, line, declared, backlog);
    });
  }
}

/** What `checkRepo` saw, so the CLI tail can print the ok summary without rescanning the tree. */
export type CheckResult = {
  problems: string[];
  warnings: string[];
  counts: { records: number; indexed: number; reserved: number; markdownFiles: number };
};

/** Run every check under `root` and return the collected problems, advisory warnings and counts. */
export function checkRepo(root: string): CheckResult {
  const problems: string[] = [];
  const warnings: string[] = [];
  // A tree may be checked twice in one process (a test, or a caller that re-runs after an edit);
  // the heading cache is keyed by path, so it has to be dropped rather than reused across runs.
  headingCache.clear();

  const adrDirPath = adrDir(root);
  const indexPath = adrIndexPath(root);

  const adrFiles = scanAdrFiles(root);
  const index = parseIndex(root, problems);
  if (index.missing) {
    fail(problems, relative(root, indexPath), "the ADR index is missing");
  }
  const adrHeaderMap = adrHeader(root, adrDirPath, adrFiles, problems);

  // index <-> disk
  for (const [number, file] of adrFiles) {
    if (!index.rows.has(number)) {
      fail(problems, relative(root, indexPath), `ADR-${number} (${file}) is not listed`);
    }
  }
  for (const [number, row] of index.rows) {
    if (!adrFiles.has(number)) {
      fail(problems, relative(root, indexPath), `ADR-${number} is listed but has no file in docs/adr/`);
      continue;
    }
    const expected = adrFiles.get(number)!;
    if (row.target !== expected) {
      fail(problems, relative(root, indexPath), `ADR-${number} points at ${row.target}, the file is ${expected}`);
    }
    const header = adrHeaderMap.get(number)!;
    if (row.title !== header.title) {
      fail(problems, relative(root, indexPath), `ADR-${number} title differs from the file: "${row.title}" vs "${header.title}"`);
    }
    const statusWord = header.status.split(/[\s(]/)[0];
    if (row.status !== statusWord) {
      fail(problems, relative(root, indexPath), `ADR-${number} status differs from the file: "${row.status}" vs "${statusWord}"`);
    }
    if (row.date !== header.date) {
      fail(problems, relative(root, indexPath), `ADR-${number} date differs from the file: "${row.date}" vs "${header.date}"`);
    }
  }
  for (const [number, entry] of index.reserved) {
    if (adrFiles.has(number)) {
      fail(problems, relative(root, indexPath), `ADR-${number} is reserved but the file docs/adr/${entry.file} exists`);
    }
  }

  // Counts come from the structures already built above; recomputing them would rescan the tree.
  const counts = {
    records: adrFiles.size,
    indexed: index.rows.size,
    reserved: index.reserved.size,
    markdownFiles: listMarkdownFiles(root).length,
  };

  adrRecordRules(problems, warnings, root, adrDirPath, adrFiles, adrHeaderMap);
  proseRules(problems, warnings, root, adrDirPath, adrFiles, index.reserved);

  return { problems, warnings, counts };
}

// ---------------------------------------------------------------- CLI tail (only runs when the file is executed, not imported)

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const { problems, warnings, counts } = checkRepo(root);

  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error(`\n${problems.length} cross-reference problem(s)`);
    process.exit(1);
  }

  for (const warning of warnings) console.warn(`warning: ${warning}`);

  let okSummary =
    `check:links ok — ${counts.records} decision records, ${counts.indexed} indexed, ${counts.reserved} reserved, ` +
    `${counts.markdownFiles} Markdown files`;
  if (warnings.length > 0) okSummary += `, ${warnings.length} warning(s)`;
  console.log(okSummary);
}
