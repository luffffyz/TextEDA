// `texteda lib import <name> --from <dir> --rev <rev> [--only <id>,…]`: copy a library's assets into
// the project and make them the project's own files (ADR-0133).
//
// The command is the only place a library enters a project, and it is deliberately one-way:
//
// - the copied device is written under its **bare id**, with the `<name>:` qualifier rewritten to
//   the destination library, so that nothing in the project resolves through a library at build time.
// - every copied file gets a header comment naming the origin and the revision. That comment is the
//   only record of where the file came from: it is visible in a diff, it never enters the IR, and
//   nothing verifies it afterwards (there is no anchor to verify against).
// - a copied device declares `provenance generated`, because a transcription is not a review; a human
//   compares it with the datasheet and edits that line in place (ADR-0133 decision 5).
//
// A subset is legal (`--only`) and is closed under references: the symbols and footprints the chosen
// devices name are pulled in with them. A device without its geometry cannot be drawn or matched
// against a land pattern, so the closure is not a convenience.
import { lstatSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  formatVersion,
  parseComponent,
  REV_RE,
  SECTIONS as FOOTPRINT_SECTIONS,
  SUPPORTED_LANGUAGE,
  SYMBOL_SECTIONS,
} from "@texteda/parser";
import { readLibraryManifest, type TrustEntry } from "./library-manifest.ts";
import { readTrustTable, type ConsumerTrustEntry } from "./trust-table.ts";
import { covers, type TrustItem, type TrustRow } from "./trust-record.ts";

export interface LibImportOptions {
  /** Project root. */
  root: string;
  /** Library name: the qualifier the template's files use. */
  name: string;
  /** The template directory. */
  from: string;
  /** The revision being copied (a tag or a commit hash). */
  rev: string;
  /** Device ids to copy; empty means every device the template provides. */
  only: readonly string[];
  /** Destination directory under `assets/symbols/` and `assets/footprints/`; defaults to `name`. */
  dest?: string;
  /**
   * The consumer's trust table (ADR-0133): what this organisation vouches for about libraries it
   * does not own. Named explicitly; nothing discovers it, and the file never enters a build.
   */
  trust?: string;
  /** Replace files that already exist. */
  force: boolean;
}

const LIB_NAME = /^[a-z][a-z0-9_-]*$/;
const DEVICE_ID = /^[a-z][a-z0-9-]*$/;

/** What a template may contain: the asset groups a library owns. Nothing else. */
const ASSET_DIRS = ["components", "symbols", "footprints"] as const;

/** Sections a component file may open; a `provenance` scalar goes before the first one. */
const COMPONENT_SECTIONS = new Set(["params", "pins", "ratings"]);

/**
 * The version line every copied file carries: the language has one version number, and a copy is
 * written against the language the tool implements (ADR-0101 D2). Derived from the parser, so it
 * cannot drift from the version the tool accepts.
 */
const LANGUAGE_VERSION = formatVersion(SUPPORTED_LANGUAGE);

interface LibraryFile {
  /** Path relative to the template directory, e.g. `components/power/tps7a02.teda`. */
  readonly relativePath: string;
  /** The id: the file name without `.teda`. */
  readonly id: string;
  /** The asset group it lives in. */
  readonly group: (typeof ASSET_DIRS)[number];
}

/** A refusal: the message is printed and the command exits with code 2 (nothing was written). */
class UsageError extends Error {}

export function runLibImport(options: LibImportOptions): number {
  try {
    return importLibrary(options);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
}

function importLibrary(options: LibImportOptions): number {
  const { root, name, from, force } = options;
  const dest = options.dest ?? name;
  if (!LIB_NAME.test(name)) usage(`not a library name: ${name} (^[a-z][a-z0-9_-]*$)`);
  if (!LIB_NAME.test(dest)) usage(`not a library directory: ${dest} (^[a-z][a-z0-9_-]*$)`);
  const revision = options.rev.trim();
  if (revision.length === 0) {
    usage("--rev must be a tag or a commit hash, not an empty string");
  }
  if (/^(main|master|head|develop|trunk|latest)$/i.test(revision)) {
    usage(
      `--rev must be a tag or a commit hash, not ${JSON.stringify(options.rev)}: a branch describes an instant, not a revision`,
    );
  }
  if (!REV_RE.test(revision)) {
    usage(`--rev must be a tag or a commit hash without whitespace or "#", not ${JSON.stringify(options.rev)}`);
  }
  // A template is the asset groups plus its manifest, not a checkout: `.git`, notes and build output
  // are not content, and copying them would put things in the project that no reader can use.
  for (const entry of readDirectory(from, "--from")) {
    if (entry === MANIFEST || (ASSET_DIRS as readonly string[]).includes(entry)) continue;
    usage(`${from} contains ${entry}, which is not part of a library (${ASSET_DIRS.join(" / ")} / ${MANIFEST})`);
  }


  const files = listLibraryFiles(from);
  if (files.length === 0) {
    usage(`${from} contains none of ${ASSET_DIRS.join(" / ")}: a library template carries its own assets`);
  }

  // A file is named by its id alone — in a device's reference, in a trust item, in the copy's own
  // path — so two files of one id in one group cannot be told apart: only one of them could be
  // imported, and the closure would pick it by directory order.
  const byId = new Map<string, LibraryFile>();
  for (const file of files) {
    const duplicate = byId.get(chosenKey(file));
    if (duplicate !== undefined) {
      usage(
        `${from} provides two ${file.group} with the id ${file.id}: ${duplicate.relativePath} and ${file.relativePath}`,
      );
    }
    byId.set(chosenKey(file), file);
  }

  // The library's own record of what a human checked. It is the one place a reviewer writes to; the
  // copy carries the resulting per-file claim (ADR-0133 D5).
  // A library that ships without `library.toml` vests no trust records — that is a fact about the
  // library, not a failure — so the manifest is read only when present.
  const manifestPath = join(from, MANIFEST);
  const trustEntries = existsSync(manifestPath)
    ? readTrust(readTextFile(manifestPath, `--from: ${MANIFEST}`), `the library manifest in ${from}`)
    : [];

  // The consumer's record about libraries it does not own (ADR-0133): an upstream library will not
  // carry our manifest, so the vouching act has to live on the consuming side. Both records use the
  // same shape (ADR-0133 decision 10): a row is one act, and every item names `id@rev`. Which record
  // decides is therefore not a precedence question — it is decided per item, and two records saying
  // different things about the same item are a conflict a person resolves.
  const consumer = options.trust === undefined ? [] : readConsumerTrust(options.trust).filter((entry) => entry.library === name);
  // Which record a consumer entry points at is what a reader will see in the origin header (ADR-0133).
  // The path is resolved from the importer's root so the header names a path the reader can find.
  const trustLabel: string = options.trust === undefined
    ? "the library's trust record"
    : relative(root, options.trust) || options.trust;
  const records: TrustRecord[] =
    options.trust === undefined
      ? [{ rows: trustEntries, source: "the library's trust record" }]
      : [
          { rows: trustEntries, source: "the library's trust record" },
          { rows: consumer, source: trustLabel },
        ];

  // A record is about ids the library actually provides: an entry naming a file that is not there
  // vouches for something nobody can read, and a table that cannot be read vouches for nothing.
  for (const entry of trustEntries) checkIds(files, entry, MANIFEST);
  for (const entry of consumer) checkIds(files, entry, options.trust!);

  const devices = files.filter((file) => file.group === "components");
  const only = options.only.filter((id) => id.length > 0);
  for (const id of only) {
    if (!DEVICE_ID.test(id)) usage(`not a device id: ${id} (^[a-z][a-z0-9-]*$)`);
    if (!devices.some((device) => device.id === id)) usage(`${id} is not a device this template provides`);
  }

  // The selection: the requested devices (or all of them) plus the geometry they name.
  const wanted = only.length === 0 ? devices : devices.filter((device) => only.includes(device.id));
  const chosen = new Map<string, LibraryFile>(wanted.map((file) => [chosenKey(file), file]));
  const unresolved: string[] = [];
  for (const device of wanted) {
    const text = readFileSync(join(from, device.relativePath), "utf8");
    const parsed = parseComponent(text, { file: device.relativePath });
    // Anything the copy would carry into the project as an error is refused here instead: import is
    // verbatim, so a broken template device would arrive broken in `assets/` with the blame on the
    // wrong file. `value.provenance-invalid` lands here too: a `reviewed` claim without an
    // attribution is not inherited into someone else's project.
    const broken = parsed.diagnostics.find((diagnostic) => diagnostic.severity === "error");
    if (!parsed.component || broken !== undefined) {
      usage(
        `${device.relativePath} is not a valid component: ${broken?.message ?? parsed.diagnostics[0]?.message ?? "it does not compile"}`,
      );
    }
    const references: [string, (typeof ASSET_DIRS)[number]][] = [
      [parsed.component.symbol, "symbols"],
      [parsed.component.footprint, "footprints"],
    ];
    for (const [reference, group] of references) {
      const [qualifier, id] = splitReference(reference);
      if (qualifier !== name) {
        usage(
          `${device.relativePath} names ${reference}: a template's devices must name their own assets as ${name}:<id>`,
        );
      }
      const asset = files.find((file) => file.id === id && file.group === group);
      if (asset === undefined) {
        unresolved.push(`${device.id} → ${reference}`);
        continue;
      }
      chosen.set(chosenKey(asset), asset);
    }
  }
  if (unresolved.length > 0) {
    usage(
      `the selection is not closed under references (a device without its geometry cannot be drawn):\n  ${unresolved.join(
        "\n  ",
      )}`,
    );
  }

  // Nothing is written before every collision is known: a half-imported library is worse than none.
  // A device id is one namespace (spec/teda.md §2): the category directory is a filing choice, so
  // an id the project already holds under another one collides too, and `--force` cannot merge two
  // files of one id into one.
  const deviceAt = new Map<string, string>();
  const walkDevices = (path: string): void => {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walkDevices(full);
      else if (entry.name.endsWith(".teda")) deviceAt.set(entry.name.slice(0, -".teda".length), full);
    }
  };
  walkDevices(join(root, "assets", "components"));
  const elsewhere = [...chosen.values()].filter(
    (file) =>
      file.group === "components" &&
      deviceAt.get(file.id) !== undefined &&
      deviceAt.get(file.id) !== targetPath(root, file, dest),
  );
  if (elsewhere.length > 0) {
    usage(
      `the project already holds these device ids under another category directory (a device id is one namespace):\n  ${elsewhere
        .map((file) => `${file.id} at ${relative(root, deviceAt.get(file.id)!)}`)
        .join("\n  ")}\n  move or delete the project's file: two files of one id cannot both be read`,
    );
  }
  // A target that is not a regular file — a directory, or a dangling symlink — cannot be copied:
  // the entry is not the file the import would write. A dangling symlink is caught here via lstat
  // (rather than later statSync, which throws) and applies with `--force` too: `--force` replaces
  // an existing regular file, it does not turn a directory or a symlink into one.
  for (const file of chosen.values()) {
    const target = targetPath(root, file, dest);
    const stats = lstatSync(target, { throwIfNoEntry: false });
    if (stats !== undefined && !stats.isFile()) {
      usage(
        `${target} is not a regular file (a directory or a symlink): move it away, then import\n` +
          `  --force replaces a regular file, not a directory or symlink`,
      );
    }
  }
  const collisions = [...chosen.values()]
    .map((file) => targetPath(root, file, dest))
    .filter((target) => existsSync(target));
  if (collisions.length > 0 && !force) {
    usage(
      `these files already exist (a device id belongs to the project: overwriting it loses a correction):\n  ${collisions
        .map((target) => relative(root, target))
        .join("\n  ")}\n  pass --force to replace them`,
    );
  }

  const stamp = today();
  const ordered = [...chosen.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  // The whole selection is resolved before the first byte is written: a claim can be refused (two
  // records stating one item, one author), and a refusal after some copies had landed would leave
  // half a library in the project while the command reported a failure.
  const plan = ordered.map((file) => {
    const template = readFileSync(join(from, file.relativePath), "utf8");
    const target = targetPath(root, file, dest);
    const previous = existsSync(target) ? readFileSync(target, "utf8") : undefined;
    // The revision a claim is matched against is the one the copy will carry (ADR-0133 decision 12):
    // the file's own `rev` when it states one; otherwise the revision the copy already carries, as
    // long as the template's facts did not move — a release that touched another file must not
    // re-stamp this one (decision 5); otherwise the revision being imported.
    const own = fileRev(template, file.group);
    const sameFacts = previous !== undefined && factsOf(previous, name, dest) === factsOf(template, name, dest);
    const previousRev = previous === undefined ? undefined : fileRev(previous, file.group);
    // A copy marked `+local.N` claims its facts diverged from the library. When they did not (the
    // edit was reverted, or the marker outlived it), the copy rejoins the base revision — the marker
    // is a statement about the facts, and this comparison is the check of that statement. A newer
    // import tag must not re-stamp unchanged facts and lose the revision the record vouches for.
    const previousBase = previousRev?.replace(/\+local\.\d+$/, "");
    const effective = own ?? (sameFacts ? previousBase : undefined) ?? revision;
    return {
      file,
      template,
      target,
      previous,
      sameFacts,
      previousRev,
      effective,
      own,
      claim: claimFor(file, effective, records),
    };
  });

  const unvouched = plan
    .filter((entry) => entry.claim === undefined)
    .map((entry) => `${entry.file.group}/${entry.file.id}`);
  let unchanged = 0;
  for (const entry of plan) {
    const { file, template, target, previous, sameFacts, previousRev, effective, own, claim } = entry;
    if (previous !== undefined && sameFacts && previousRev === effective) {
      // The same facts at the same revision: the copy keeps the day it arrived, its claim and its
      // date, and is not written at all. The comparison is the facts, not the text: the text also
      // carries the claim the import derives, and a review a human wrote into the copy is the
      // copy's own (ADR-0133 decision 5) — a re-import of unchanged facts has no business
      // withdrawing it.
      unchanged += 1;
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, rewrite(template, file, name, dest, revision, effective, stamp, claim, own === undefined));
  }
  if (records.length > 0 && unvouched.length > 0) {
    console.log(`${unvouched.length} of ${ordered.length} file(s) are not vouched for by the record(s) in use: ${unvouched.join(", ")}`);
  }
  if (unchanged > 0) {
    console.log(`${unchanged} file(s) were unchanged and kept their imported revision`);
  }

  console.log(`Imported ${ordered.length - unchanged} file(s) from ${name}@${revision} into ${relative(root, join(root, "assets")) || "assets"}`);
  console.log("These are the project's own files now: edit them in place, and review them before manufacturing.");
  return 0;
}

/** The library's manifest file name: the one non-asset entry a template may carry. */
const MANIFEST = "library.toml";

/** The library's trust records; a manifest this importer cannot read refuses the whole import. */
function readTrust(text: string, label: string): TrustEntry[] {
  const read = readLibraryManifest(text, MANIFEST);
  if (read.errors.length > 0) {
    usage(`${label}: ${MANIFEST} is not a manifest this importer accepts:\n  ${read.errors.join("\n  ")}`);
  }
  return read.manifest === undefined ? [] : [...read.manifest.trust];
}

/** The consumer's trust table (ADR-0133); a table that cannot be read vouches for nothing. */
function readConsumerTrust(file: string): readonly ConsumerTrustEntry[] {
  const text = readTextFile(file, `--trust: ${file}`);
  const read = readTrustTable(text, file);
  if (read.errors.length > 0) {
    usage(`${file} is not a trust table this importer accepts:\n  ${read.errors.join("\n  ")}`);
  }
  return read.entries ?? [];
}


/** One trust record and the name a reader will see in the origin header. */
interface TrustRecord {
  readonly rows: readonly TrustRow[];
  readonly source: string;
}

/** What a record says about one file: who checked it, on which day, and which record said so. */
interface Claim {
  readonly by: string;
  readonly on: string;
  readonly source: string;
}

/**
 * The claim a file's revision carries, whichever record states it.
 *
 * A record answers per item: the item must name this id **and** the revision the copy will carry
 * (ADR-0133 decision 10). Ids one record covers and the other does not are not a problem — each is
 * vouched for by the record that lists it. Two records stating the same item with different
 * attribution is a conflict: one act, one author, and the importer picks neither
 * (ADR-0133 decision 11).
 */
function claimFor(file: LibraryFile, rev: string, records: readonly TrustRecord[]): Claim | undefined {
  const hits: Claim[] = [];
  for (const record of records) {
    for (const row of record.rows) {
      if (covers(row, file.group, file.id, rev)) {
        hits.push({ by: row.by, on: row.on, source: record.source });
      }
    }
  }
  const first = hits[0];
  if (first === undefined) return undefined;
  const disagree = hits.find((hit) => hit.by !== first.by || hit.on !== first.on);
  if (disagree !== undefined) {
    usage(
      `${file.group}/${file.id}@${rev} is vouched for twice, by different authors:\n` +
        `  ${first.by} on ${first.on} (${first.source})\n` +
        `  ${disagree.by} on ${disagree.on} (${disagree.source})\n` +
        `  one act has one author: correct whichever record is wrong (ADR-0133 decision 11)`,
    );
  }
  return first;
}

/** Every id a record lists must exist in the library, or the record vouches for a file nobody has. */
function checkIds(files: readonly LibraryFile[], row: TrustRow, source: string): void {
  for (const group of ASSET_DIRS) {
    const known = files.filter((file) => file.group === group).map((file) => file.id);
    const unknown = row[group].filter((item: TrustItem) => !known.includes(item.id)).map((item) => item.id);
    if (unknown.length > 0) {
      usage(`${source}: [[trust]] lists ${group} that the library does not provide: ${unknown.join(", ")}`);
    }
  }
}

/** A file's identity in the selection: the group and the id, which is how a reference names it. */
function chosenKey(file: LibraryFile): string {
  return `${file.group}/${file.id}`;
}

/** Every `.teda` under the asset groups of a template, with its id and group. */
function listLibraryFiles(from: string): LibraryFile[] {
  const out: LibraryFile[] = [];
  for (const group of ASSET_DIRS) {
    const base = join(from, group);
    if (!existsSync(base)) continue;
    const walk = (path: string): void => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const full = join(path, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".teda")) {
          out.push({
            relativePath: relative(from, full),
            id: entry.name.slice(0, -".teda".length),
            group,
          });
        }
      }
    };
    walk(base);
  }
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/** `lib:id` → `[lib, id]`; a bare id has an empty qualifier. */
function splitReference(reference: string): [string, string] {
  const at = reference.indexOf(":");
  return at < 0 ? ["", reference] : [reference.slice(0, at), reference.slice(at + 1)];
}

/** Where a template file lands in the project. Devices keep their category directory. */
function targetPath(root: string, file: LibraryFile, dest: string): string {
  if (file.group === "components") {
    const tail = file.relativePath.slice("components/".length);
    const directory = tail.includes("/") ? tail.slice(0, tail.lastIndexOf("/") + 1) : "";
    return join(root, "assets", "components", directory, `${file.id}.teda`);
  }
  return join(root, "assets", file.group, dest, `${file.id}.teda`);
}

/**
 * The copied text: qualifiers rewritten to the destination library, the origin header added, and a
 * component's provenance declared.
 *
 * The rewrite is textual and otherwise verbatim, so a template's comments and layout survive: the
 * person who reads the copy reads what the library said.
 */
function rewrite(
  text: string,
  file: LibraryFile,
  name: string,
  dest: string,
  originRev: string,
  fileRev: string,
  stamp: string,
  reviewed: Claim | undefined,
  stampRev: boolean,
): string {
  const isComponent = file.group === "components";
  // The header states what the library says about itself, not what the importer assumes: a
  // reviewed template arrives reviewed (its own claim travels with the verbatim copy), and the
  // header must not contradict the file below it.
  const claim = templateClaim(text);
  const header = claim.reviewed
    ? `# imported from ${name}@${originRev} on ${stamp}: the template declares provenance reviewed${claim.by === undefined ? "" : ` (${claim.by})`}`
    : reviewed !== undefined
      ? `# imported from ${name}@${originRev} on ${stamp}: reviewed (${reviewed.by}, ${reviewed.on}) as ${reviewed.source} says`
      : `# imported from ${name}@${originRev} on ${stamp}: verify before manufacturing, the template was not human-reviewed`;
  let out: string[] = [];
  let headerWritten = false;
  let provenanceWritten = false;
  let sawType = false;
  let inSection = false;
  for (const raw of text.split("\n")) {
    const line = raw;
    const trimmed = line.trim();
    const isComment = trimmed.startsWith("#");
    const cells = trimmed.split(/\s+/).filter(Boolean);
    if (!isComment && COMPONENT_SECTIONS.has(trimmed)) inSection = true;
    const isProvenance = isComponent && !isComment && !inSection && /^provenance\s/.test(trimmed);
    if (!isComment && /^version\s/.test(trimmed)) {
      // Every copied file carries the language's one version number (ADR-0101 D2): the copy is
      // written against the language this tool implements, whichever type it is.
      out.push(`version ${LANGUAGE_VERSION}`);
    } else if (isProvenance && reviewed !== undefined && cells[1] === "generated") {
      // The record is newer information than the transcription marker it replaces: `generated` says
      // a machine copied the file, not that nobody has looked at it since.
      out.push(`provenance reviewed`, `verified_by ${reviewed.by}`, `verified_on ${reviewed.on}`);
      provenanceWritten = true;
    } else {
      out.push(isComment ? line : line.replaceAll(`${name}:`, `${dest}:`));
      if (isProvenance) provenanceWritten = true;
    }
    if (!sawType && !isComment && cells.length > 0 && !/^version\s/.test(trimmed)) {
      // The type line: everything after it is content, so the origin comment goes right below it,
      // and the stamped revision (when the template states none) opens the scalars.
      sawType = true;
      if (!headerWritten) {
        out.push(header);
        headerWritten = true;
        if (stampRev) out.push(`rev ${fileRev}`);
      }
    }
  }
  if (isComponent && !provenanceWritten) {
    // Insert before the first section (or at the end when the file has none): a scalar belongs
    // before the sections (teda.md §6.1).
    const sectionAt = out.findIndex((line) => COMPONENT_SECTIONS.has(line.trim()));
    let at = sectionAt < 0 ? out.length : sectionAt;
    // The scalars end where the blank line before the first section begins: the new scalar joins
    // them rather than sitting on its own after the gap.
    while (at > 0 && out[at - 1]!.trim() === "") at--;
    out.splice(
      at,
      0,
      ...(reviewed === undefined
        ? ["provenance generated"]
        : ["provenance reviewed", `verified_by ${reviewed.by}`, `verified_on ${reviewed.on}`]),
    );
  }
  return out.join("\n");
}

/** Sections per group: a scalar sits before them, so the scan for `rev` stops at the first one. */
const SECTION_HEADS: Record<LibraryFile["group"], ReadonlySet<string>> = {
  components: COMPONENT_SECTIONS,
  symbols: SYMBOL_SECTIONS,
  footprints: FOOTPRINT_SECTIONS,
};

/**
 * The revision a template file states for itself (`rev`, ADR-0133 decision 6), or `undefined`.
 *
 * Read as text on purpose: a symbol or footprint that does not compile still has to be importable
 * (import is verbatim), and the parsers would reject it before we ever reach this. A `rev` after
 * the first section is not a scalar and is ignored here — the parsers report it as an error.
 */
function fileRev(text: string, group: LibraryFile["group"]): string | undefined {
  const heads = SECTION_HEADS[group];
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const cells = trimmed.split(/\s+/).filter(Boolean);
    const head = cells[0];
    if (head === undefined) continue;
    if (cells.length === 1 && heads.has(head)) return undefined;
    if (head === "rev" && cells.length > 1) return cells[1];
  }
  return undefined;
}

/**
 * The copy's facts: its lines with everything an import rewrites taken out.
 *
 * The importer rewrites exactly four things — the origin header, the stamped `rev`, the `version`
 * (every copy carries the language's one number, ADR-0101 D2), and the provenance block it derives
 * from a record — plus the library qualifier of self-authored assets. Everything else is verbatim, so
 * what remains is the library's content.
 *
 * Comparing two texts this way answers "did this release touch this file" without a hash: a comment
 * edit or a pin change is a new revision, a re-stamp is not (ADR-0133 decision 13).
 */
function factsOf(text: string, name: string, dest: string): string {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("# imported from ")) continue;
    if (/^(?:rev|version|provenance|verified_by|verified_on)\s/.test(trimmed)) continue;
    out.push(name === dest ? line : line.replaceAll(`${dest}:`, `${name}:`));
  }
  return out.join("\n");
}

/**
 * What a template component says about its own review, read from the scalars before the first
 * section (`provenance` / `verified_by` are scalars, teda.md §6.1).
 *
 * Only the shape import needs: whether the file claims a review, and who it attributes it to. The
 * claim itself is not re-checked here — the parser already refused a malformed one.
 */
function templateClaim(text: string): { reviewed: boolean; by?: string } {
  let reviewed = false;
  let by: string | undefined;
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const cells = trimmed.split(/\s+/).filter(Boolean);
    const head = cells[0];
    if (head === undefined) continue;
    if (COMPONENT_SECTIONS.has(head)) break;
    if (head === "version" || head === "component") continue;
    if (head === "provenance" && cells[1] === "reviewed") reviewed = true;
    if (head === "verified_by" && cells.length > 1) by = cells.slice(1).join(" ");
  }
  return { reviewed, ...(by === undefined ? {} : { by }) };
}

function today(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}-${day}`;
}

/** What a path is, as an actionable refusal rather than a thrown exception: a missing path, a
 *  directory, or an unreadable file are all the same failure to report with a message a person
 *  can act on. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Read a file as text, refusing a path that is not a regular file (missing, directory, ...) or
 *  that cannot be read (permission, a file the process cannot open). */
function readTextFile(path: string, label: string): string {
  try {
    const stats = statSync(path, { throwIfNoEntry: false });
    if (stats === undefined || !stats.isFile()) {
      usage(`${label}: ${path} is not a regular file (it is missing or a directory)`);
    }
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof UsageError) throw error;
    usage(`${label}: ${path} cannot be read: ${describeError(error)}`);
  }
}

/** Read a directory listing, refusing a path that is not a directory (missing, a file, ...) or
 *  that cannot be listed (permission). */
function readDirectory(path: string, label: string): readonly string[] {
  try {
    const stats = statSync(path, { throwIfNoEntry: false });
    if (stats === undefined || !stats.isDirectory()) {
      usage(`${label}: ${path} is not a directory (it is missing or a file)`);
    }
    return readdirSync(path);
  } catch (error) {
    if (error instanceof UsageError) throw error;
    usage(`${label}: ${path} cannot be listed: ${describeError(error)}`);
  }
}

function usage(message: string): never {
  throw new UsageError(message);
}
