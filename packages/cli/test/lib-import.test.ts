// Contract tests for `texteda lib import` (ADR-0034: an external library is a template).
//
// Covers the four properties the command claims: the copy is bare-id and editable, a subset is
// legal but closed under references, the origin travels as a header comment, and a device declares
// `provenance generated` until a human says otherwise.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { analyzeProject, checkProject } from "../src/check.ts";
import { runLibImport } from "../src/lib-import.ts";

const LIBRARY_PROJECT = `[project]
name = "demo"
version = "0.1.0"
format = "0.9.1"
`;

const TEMPLATE_DEVICE = `version 0.1.5
component tps7a02

kind         part
mpn          TPS7A02PDBVR
manufacturer Texas Instruments
symbol       vendor:tps7a02
footprint    vendor:sot-23-5

pins
  1  IN     power_in
  2  GND    power_in
`;

const TEMPLATE_SYMBOL = `version 0.5
symbol tps7a02

pins
  1   -5.08  0  0
  2    5.08  0  180
`;

const TEMPLATE_FOOTPRINT = `version 0.4.1
footprint sot-23-5
package_code SOT-23-5
`;

/** A template directory shaped like a library: components / symbols / footprints, nothing else. */
function makeTemplate(): string {
  const dir = mkdtempSync(join(tmpdir(), "texteda-template-"));
  mkdirSync(join(dir, "components/power"), { recursive: true });
  mkdirSync(join(dir, "symbols"), { recursive: true });
  mkdirSync(join(dir, "footprints"), { recursive: true });
  writeFileSync(join(dir, "components/power/tps7a02.teda"), TEMPLATE_DEVICE);
  writeFileSync(join(dir, "symbols/tps7a02.teda"), TEMPLATE_SYMBOL);
  writeFileSync(join(dir, "footprints/sot-23-5.teda"), TEMPLATE_FOOTPRINT);
  return dir;
}

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "texteda-import-"));
  writeFileSync(join(root, "project.toml"), LIBRARY_PROJECT);
  mkdirSync(join(root, "assets/components"), { recursive: true });
  mkdirSync(join(root, "design/sch"), { recursive: true });
  return root;
}

describe("texteda lib import", () => {
  test("copies the devices under bare ids, rewrites the qualifier, and stamps the origin", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      const code = runLibImport({ root, name: "vendor", from, rev: "v2.1.0", only: [], force: false });
      expect(code).toBe(0);

      const device = readFileSync(join(root, "assets/components/power/tps7a02.teda"), "utf8");
      expect(device).toContain("# imported from vendor@v2.1.0 on ");
      expect(device).toContain("symbol       vendor:tps7a02");
      expect(device).toContain("provenance generated");
      // the copy carries the language's one version number (ADR-0002 D2)
      expect(device.startsWith("version 0.9.1\ncomponent tps7a02\n# imported from vendor@v2.1.0 on ")).toBe(true);
      expect(device).toContain("\nrev v2.1.0\n");

      expect(existsSync(join(root, "assets/symbols/vendor/tps7a02.teda"))).toBe(true);
      expect(existsSync(join(root, "assets/footprints/vendor/sot-23-5.teda"))).toBe(true);
      // nothing is vendored: the build never reads external/libs
      expect(existsSync(join(root, "external"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("a subset is legal and pulls in the geometry it references", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      const code = runLibImport({ root, name: "vendor", from, rev: "abc1234", only: ["tps7a02"], force: false });
      expect(code).toBe(0);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(true);
      expect(existsSync(join(root, "assets/symbols/vendor/tps7a02.teda"))).toBe(true);
      expect(existsSync(join(root, "assets/footprints/vendor/sot-23-5.teda"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("an existing device stops the import unless --force is given", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      expect(runLibImport({ root, name: "vendor", from, rev: "v1", only: [], force: false })).toBe(0);
      const before = readFileSync(join(root, "assets/components/power/tps7a02.teda"), "utf8");

      // A correction the project made: it must not be lost to a second import by accident.
      writeFileSync(join(root, "assets/components/power/tps7a02.teda"), before.replace("power_in", "power_in"));
      const rewritten = `${before}\n# corrected by hand\n`;
      writeFileSync(join(root, "assets/components/power/tps7a02.teda"), rewritten);

      expect(runLibImport({ root, name: "vendor", from, rev: "v2", only: [], force: false })).toBe(2);
      expect(readFileSync(join(root, "assets/components/power/tps7a02.teda"), "utf8")).toBe(rewritten);

      expect(runLibImport({ root, name: "vendor", from, rev: "v2", only: [], force: true })).toBe(0);
      expect(readFileSync(join(root, "assets/components/power/tps7a02.teda"), "utf8")).not.toContain("corrected by hand");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("a device id the project already holds under another category stops the import", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      // The id is the namespace, the category directory is a filing choice (spec/teda.md §2). The
      // template files its device under `components/power/`; the project already has that id at the
      // root of `assets/components/`, so the copy would be a second file of the same id.
      writeFileSync(join(root, "assets/components/tps7a02.teda"), TEMPLATE_DEVICE);
      expect(runLibImport({ root, name: "vendor", from, rev: "v1", only: [], force: false })).toBe(2);
      // `--force` replaces a file; it cannot merge two files of one id, so the second copy is refused
      // as well rather than silently shadowing the project's own device.
      expect(runLibImport({ root, name: "vendor", from, rev: "v1", only: [], force: true })).toBe(2);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
      expect(readFileSync(join(root, "assets/components/tps7a02.teda"), "utf8")).toBe(TEMPLATE_DEVICE);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("refuses a device that names its geometry without the qualifier", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      // A symbol reference is `lib:name` (spec/teda.md §6.1). A bare id resolves to nothing in
      // `assets/symbols/`, so the copy would arrive unable to draw, with the error pointing at the
      // copy instead of at the template it was copied from.
      writeFileSync(
        join(from, "components/power/tps7a02.teda"),
        TEMPLATE_DEVICE.replace("symbol       vendor:tps7a02", "symbol       tps7a02"),
      );
      expect(runLibImport({ root, name: "vendor", from, rev: "v1", only: [], force: false })).toBe(2);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("refuses a template that provides two files of one id", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      // A reference, a trust item and the copy's own path all name a file by its id alone, so two
      // files of one id in one group cannot be told apart: one of them would be dropped silently.
      mkdirSync(join(from, "components/analog"), { recursive: true });
      writeFileSync(join(from, "components/analog/tps7a02.teda"), TEMPLATE_DEVICE);
      expect(runLibImport({ root, name: "vendor", from, rev: "v1", only: [], force: false })).toBe(2);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
      expect(existsSync(join(root, "assets/components/analog/tps7a02.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("refuses a template whose devices name somebody else's assets", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      writeFileSync(
        join(from, "components/power/tps7a02.teda"),
        TEMPLATE_DEVICE.replace("vendor:tps7a02", "someone:tps7a02"),
      );
      expect(runLibImport({ root, name: "vendor", from, rev: "v1", only: [], force: false })).toBe(2);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("a reviewed device needs an attribution, and a generated one takes none", () => {
    const root = makeProject();
    try {
      mkdirSync(join(root, "assets/symbols/project"), { recursive: true });
      mkdirSync(join(root, "assets/footprints/project"), { recursive: true });
      writeFileSync(join(root, "assets/symbols/project/r.teda"), "version 0.5\nsymbol r\n\npins\n  1  -5.08  0  0\n  2   5.08  0  180\n");
      writeFileSync(join(root, "assets/footprints/project/chip-0402.teda"), "version 0.4.1\nfootprint chip-0402\npackage_code 0402\n");
      writeFileSync(join(root, "design/sch/b.teda"), "version 0.3\nschematic b\n\ninstances\n  R1  res-thick-0402  10k  ±1%\n\nnets\n  GND:  R1.1\n  SIG:  R1.2\n");

      const base = `version 0.1.6
component res-thick-0402

kind         generic
category     resistor
construction thick
polarized    no
symbol       project:r
footprint    project:chip-0402
`;
      const body = `

params
  value      resistance  required
  tolerance  percent     required

pins
  1  A  passive
  2  B  passive
`;

      writeFileSync(
        join(root, "assets/components/res-thick-0402.teda"),
        `${base}provenance   reviewed\nverified_by  tz\nverified_on  2026-10-24${body}`,
      );
      expect(analyzeProject(root).diagnostics.filter((d) => d.code === "value.provenance-invalid")).toEqual([]);

      writeFileSync(
        join(root, "assets/components/res-thick-0402.teda"),
        `${base}provenance   reviewed${body}`,
      );
      expect(checkProject(root).diagnostics.some((d) => d.severity === "error")).toBe(true);
      expect(analyzeProject(root).diagnostics.map((d) => d.code)).toContain("value.provenance-invalid");

      writeFileSync(
        join(root, "assets/components/res-thick-0402.teda"),
        `${base}provenance   generated\nverified_by  tz${body}`,
      );
      expect(analyzeProject(root).diagnostics.map((d) => d.code)).toContain("value.provenance-invalid");

      writeFileSync(join(root, "assets/components/res-thick-0402.teda"), `${base}provenance   generated${body}`);
      expect(analyzeProject(root).diagnostics.filter((d) => d.code === "value.provenance-invalid")).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a tree left under external/libs is an error, and nothing is resolved from it", () => {
    const root = makeProject();
    try {
      mkdirSync(join(root, "external/libs/vendor/components"), { recursive: true });
      writeFileSync(join(root, "external/libs/vendor/components/tps7a02.teda"), TEMPLATE_DEVICE);
      const diagnostics = analyzeProject(root).diagnostics;
      const found = diagnostics.find((d) => d.code === "ref.library-in-tree");
      expect(found).toBeDefined();
      expect(found!.message).toContain("external/libs/vendor");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// A template that was reviewed upstream arrives reviewed: the copy is verbatim, so its claim travels
// with it, and the origin header must state what the template said rather than assume the worst
// (ADR-0034 D5).
describe("texteda lib import: an inherited review", () => {
  const REVIEWED = TEMPLATE_DEVICE.replace(
    "pins\n",
    "provenance   reviewed\nverified_by  tz\nverified_on  2026-10-24\n\npins\n",
  );

  test("a reviewed template arrives reviewed, with its attribution intact", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      writeFileSync(join(from, "components/power/tps7a02.teda"), REVIEWED);
      expect(runLibImport({ root, name: "vendor", from, rev: "v2.1.0", only: [], force: false })).toBe(0);

      const device = readFileSync(join(root, "assets/components/power/tps7a02.teda"), "utf8");
      expect(device).toContain("provenance   reviewed");
      expect(device).toContain("verified_by  tz");
      expect(device).toContain("verified_on  2026-10-24");
      // the header repeats the template's claim; it does not call a reviewed file unreviewed
      expect(device).toContain("the template declares provenance reviewed (tz)");
      expect(device).not.toContain("not human-reviewed");
      // and the project accepts it
      expect(checkProject(root).diagnostics.filter((d) => d.code === "value.provenance-invalid")).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("a reviewed claim without an attribution is refused, nothing is written", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      writeFileSync(
        join(from, "components/power/tps7a02.teda"),
        TEMPLATE_DEVICE.replace("pins\n", "provenance   reviewed\n\npins\n"),
      );
      expect(runLibImport({ root, name: "vendor", from, rev: "v1", only: [], force: false })).toBe(2);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });
});

// The trust record: one statement per library revision, listing the ids a human compared with their
// sources. It is read at import time and becomes the copy's own per-file claim — the record is the
// table, the copies are the (explicit) rows (ADR-0001: generators live outside the language).
describe("texteda lib import: the library's trust record", () => {
  const MANIFEST = `[library]
name = "vendor"
source = "https://example.invalid/vendor"

[[trust]]
by = "tz"
on = "2026-10-24"
components = ["tps7a02@v2.1.0"]
symbols = ["tps7a02@v2.1.0"]
footprints = ["sot-23-5@v2.1.0"]
`;

  test("a trusted id arrives reviewed, with the record's attribution", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      writeFileSync(join(from, "library.toml"), MANIFEST);
      expect(runLibImport({ root, name: "vendor", from, rev: "v2.1.0", only: [], force: false })).toBe(0);

      const device = readFileSync(join(root, "assets/components/power/tps7a02.teda"), "utf8");
      expect(device).toContain("provenance reviewed");
      expect(device).toContain("verified_by tz");
      expect(device).toContain("verified_on 2026-10-24");
      expect(device).toContain("as the library's trust record says");
      // geometry has no IR field for a claim: the header carries it instead
      const footprint = readFileSync(join(root, "assets/footprints/vendor/sot-23-5.teda"), "utf8");
      expect(footprint).toContain("reviewed (tz, 2026-10-24) as the library's trust record says");
      // a device the record does not list is not vouched for
      expect(checkProject(root).diagnostics.filter((d) => d.code === "value.provenance-invalid")).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("the record replaces a transcription marker, it does not fight a file's own claim", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      // The private library was itself imported once, so its files say `generated`.
      writeFileSync(
        join(from, "components/power/tps7a02.teda"),
        TEMPLATE_DEVICE.replace("pins\n", "provenance generated\n\npins\n"),
      );
      writeFileSync(join(from, "library.toml"), MANIFEST);
      expect(runLibImport({ root, name: "vendor", from, rev: "v2.1.0", only: [], force: false })).toBe(0);
      const device = readFileSync(join(root, "assets/components/power/tps7a02.teda"), "utf8");
      expect(device).toContain("provenance reviewed");
      expect(device).not.toContain("provenance generated");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("a record for another revision does not cover this import", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      writeFileSync(join(from, "library.toml"), MANIFEST);
      expect(runLibImport({ root, name: "vendor", from, rev: "v3.0.0", only: [], force: false })).toBe(0);
      const device = readFileSync(join(root, "assets/components/power/tps7a02.teda"), "utf8");
      expect(device).toContain("provenance generated");
      expect(device).not.toContain("verified_by");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("a record that names something the library does not provide is refused", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      writeFileSync(join(from, "library.toml"), MANIFEST.replace('footprints = ["sot-23-5@v2.1.0"]', 'footprints = ["sot-23-6@v2.1.0"]'));
      expect(runLibImport({ root, name: "vendor", from, rev: "v2.1.0", only: [], force: false })).toBe(2);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("a record without an attribution is refused", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      writeFileSync(join(from, "library.toml"), MANIFEST.replace('by = "tz"\n', ""));
      expect(runLibImport({ root, name: "vendor", from, rev: "v2.1.0", only: [], force: false })).toBe(2);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });
});

// The consumer's trust table (ADR-0034): an upstream library will not carry our manifest, so the
// statement "we looked at these ids at this revision" lives on the consuming side. It is a file the
// importer is given; the copies carry the result, and the table itself never enters a build.
describe("texteda lib import: the consumer's trust table", () => {
  const TABLE = `[[trust]]
library = "vendor"
by = "company-reviewer"
on = "2026-10-20"
components = ["tps7a02@v2.1.0"]
symbols = ["tps7a02@v2.1.0"]
footprints = ["sot-23-5@v2.1.0"]
`;

  /** A table outside the project: the importer is told where it is, it never discovers one. */
  function makeTable(text: string): string {
    const dir = mkdtempSync(join(tmpdir(), "texteda-trust-"));
    const file = join(dir, "trust.toml");
    writeFileSync(file, text);
    return file;
  }

  test("a vouched id arrives reviewed, attributed to the consumer's record", () => {
    const root = makeProject();
    const from = makeTemplate();
    const table = makeTable(TABLE);
    try {
      const code = runLibImport({ root, name: "vendor", from, rev: "v2.1.0", only: [], force: false, trust: table });
      expect(code).toBe(0);

      const device = readFileSync(join(root, "assets/components/power/tps7a02.teda"), "utf8");
      expect(device).toContain("provenance reviewed");
      expect(device).toContain("verified_by company-reviewer");
      expect(device).toContain("verified_on 2026-10-20");
      // the header names the deciding record, so a reader can tell it from the library's own claim
      expect(device).toContain(`as ${relative(root, table)} says`);
      const footprint = readFileSync(join(root, "assets/footprints/vendor/sot-23-5.teda"), "utf8");
      expect(footprint).toContain(`reviewed (company-reviewer, 2026-10-20) as ${relative(root, table)} says`);
      // the project accepts the inherited claim
      expect(checkProject(root).diagnostics.filter((d) => d.code === "value.provenance-invalid")).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
      rmSync(join(table, ".."), { recursive: true, force: true });
    }
  });

  test("there is no whole-library form: `all` is an unknown key", () => {
    const root = makeProject();
    const from = makeTemplate();
    // A row states what was verified. "I did not look, but I will ship it" is a decision about a
    // board, not a fact about a library, so the record has no way to say it (ADR-0034 decision 9).
    const table = makeTable(
      `[[trust]]\nlibrary = "vendor"\nby = "company-reviewer"\non = "2026-10-20"\nall = true\n`,
    );
    try {
      expect(runLibImport({ root, name: "vendor", from, rev: "v2.1.0", only: [], force: false, trust: table })).toBe(2);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
      rmSync(join(table, ".."), { recursive: true, force: true });
    }
  });

  test("two records compose across items, and disagreeing about one item is a conflict", () => {
    const root = makeProject();
    const from = makeTemplate();
    const table = makeTable(
      `[[trust]]\nlibrary = "vendor"\nby = "company-reviewer"\non = "2026-10-20"\nfootprints = ["sot-23-5@v2.1.0"]\n`,
    );
    try {
      // The library vouches for its device, the consumer for the geometry: different items, so both
      // apply and each copy names the record that decided for it (ADR-0034 decision 11).
      writeFileSync(
        join(from, "library.toml"),
        `[[trust]]\nby = "upstream"\non = "2026-01-01"\ncomponents = ["tps7a02@v2.1.0"]\nsymbols = ["tps7a02@v2.1.0"]\n`,
      );
      expect(runLibImport({ root, name: "vendor", from, rev: "v2.1.0", only: [], force: false, trust: table })).toBe(0);
      const device = readFileSync(join(root, "assets/components/power/tps7a02.teda"), "utf8");
      expect(device).toContain("verified_by upstream");
      expect(device).toContain("as the library's trust record says");
      const footprint = readFileSync(join(root, "assets/footprints/vendor/sot-23-5.teda"), "utf8");
      expect(footprint).toContain(`as ${relative(root, table)} says`);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
      rmSync(join(table, ".."), { recursive: true, force: true });
    }
  });

  test("two records vouching for one item with different authors is refused", () => {
    const root = makeProject();
    const from = makeTemplate();
    const table = makeTable(TABLE);
    try {
      // One act cannot have two authors: the importer refuses rather than picking one, because
      // picking would silently discard an attribution (ADR-0034 decision 11).
      writeFileSync(
        join(from, "library.toml"),
        `[[trust]]\nby = "upstream"\non = "2026-01-01"\ncomponents = ["tps7a02@v2.1.0"]\n`,
      );
      const code = runLibImport({ root, name: "vendor", from, rev: "v2.1.0", only: [], force: false, trust: table });
      expect(code).toBe(2);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
      rmSync(join(table, ".."), { recursive: true, force: true });
    }
  });

  test("a conflict about a file that sorts late still writes nothing", () => {
    const root = makeProject();
    const from = makeTemplate();
    // The footprints sort after the components, so a refusal raised while that file is claimed used
    // to leave the device behind even though the command reported the failure.
    const table = makeTable(
      `[[trust]]\nlibrary = "vendor"\nby = "company-reviewer"\non = "2026-10-20"\nfootprints = ["sot-23-5@v1"]\n`,
    );
    try {
      writeFileSync(
        join(from, "library.toml"),
        `[[trust]]\nby = "upstream"\non = "2026-01-01"\nfootprints = ["sot-23-5@v1"]\n`,
      );
      expect(runLibImport({ root, name: "vendor", from, rev: "v1", only: [], force: false, trust: table })).toBe(2);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
      expect(existsSync(join(root, "assets/symbols/vendor/tps7a02.teda"))).toBe(false);
      expect(existsSync(join(root, "assets/footprints/vendor/sot-23-5.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
      rmSync(join(table, ".."), { recursive: true, force: true });
    }
  });

  test("an entry for another revision does not cover this import", () => {
    const root = makeProject();
    const from = makeTemplate();
    const table = makeTable(TABLE);
    try {
      expect(runLibImport({ root, name: "vendor", from, rev: "v3.0.0", only: [], force: false, trust: table })).toBe(0);
      const device = readFileSync(join(root, "assets/components/power/tps7a02.teda"), "utf8");
      expect(device).toContain("provenance generated");
      expect(device).not.toContain("verified_by");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
      rmSync(join(table, ".."), { recursive: true, force: true });
    }
  });

  test("an entry for another library does not apply", () => {
    const root = makeProject();
    const from = makeTemplate();
    const table = makeTable(TABLE.replace('library = "vendor"', 'library = "kicad-passives"'));
    try {
      expect(runLibImport({ root, name: "vendor", from, rev: "v2.1.0", only: [], force: false, trust: table })).toBe(0);
      const device = readFileSync(join(root, "assets/components/power/tps7a02.teda"), "utf8");
      expect(device).toContain("provenance generated");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
      rmSync(join(table, ".."), { recursive: true, force: true });
    }
  });

  test("an entry that lists no ids is refused: it would vouch for nothing", () => {
    const root = makeProject();
    const from = makeTemplate();
    const empty = makeTable(`[[trust]]\nlibrary = "vendor"\nby = "tz"\non = "2026-10-20"\n`);
    try {
      expect(runLibImport({ root, name: "vendor", from, rev: "v2.1.0", only: [], force: false, trust: empty })).toBe(2);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
      rmSync(join(empty, ".."), { recursive: true, force: true });
    }
  });

  test("a table naming an id the library does not provide is refused, nothing is written", () => {
    const root = makeProject();
    const from = makeTemplate();
    const table = makeTable(TABLE.replace('footprints = ["sot-23-5@v2.1.0"]', 'footprints = ["sot-23-6@v2.1.0"]'));
    try {
      expect(runLibImport({ root, name: "vendor", from, rev: "v2.1.0", only: [], force: false, trust: table })).toBe(2);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
      rmSync(join(table, ".."), { recursive: true, force: true });
    }
  });

  test("a table without an attribution is refused, nothing is written", () => {
    const root = makeProject();
    const from = makeTemplate();
    const table = makeTable(TABLE.replace('by = "company-reviewer"\n', ""));
    try {
      expect(runLibImport({ root, name: "vendor", from, rev: "v2.1.0", only: [], force: false, trust: table })).toBe(2);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
      rmSync(join(table, ".."), { recursive: true, force: true });
    }
  });

  test("a missing table is refused rather than ignored", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      const code = runLibImport({ root, name: "vendor", from, rev: "v2.1.0", only: [], force: false, trust: join(root, "nope.toml") });
      expect(code).toBe(2);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });
  test("the same id@rev under two libraries is two acts, not a duplicate", () => {
    const root = makeProject();
    const from = makeTemplate();
    const table = makeTable(
      `[[trust]]
library = "vendor-b"
by = "company-b"
on = "2026-10-20"
components = ["tps7a02@v2.1.0"]

[[trust]]
library = "vendor-c"
by = "company-c"
on = "2026-10-21"
components = ["tps7a02@v2.1.0"]
`,
    );
    try {
      // A table vouches for several libraries (ADR-0034): the same id at the same revision under
      // two libraries is two distinct acts, so neither is a duplicate (this used to be refused).
      expect(runLibImport({ root, name: "vendor", from, rev: "v2.1.0", only: [], force: false, trust: table })).toBe(0);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
      rmSync(join(table, ".."), { recursive: true, force: true });
    }
  });

  test("the same id@rev under one library is still one act, still a duplicate", () => {
    const root = makeProject();
    const from = makeTemplate();
    const table = makeTable(
      `[[trust]]
library = "vendor"
by = "company-reviewer"
on = "2026-10-20"
components = ["tps7a02@v2.1.0"]

[[trust]]
library = "vendor"
by = "company-reviewer-2"
on = "2026-10-21"
components = ["tps7a02@v2.1.0"]
`,
    );
    try {
      // Same library, same id at the same revision, two authors: still one act, so refused.
      expect(runLibImport({ root, name: "vendor", from, rev: "v2.1.0", only: [], force: false, trust: table })).toBe(2);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
      rmSync(join(table, ".."), { recursive: true, force: true });
    }
  });

});

// ADR-0034: a file carries its own revision, a trust row is one act, and every item names the
// revision it was checked at. What these tests pin down is the consequence the shape exists for:
// a release that touches one file does not withdraw trust from the files it did not touch.
describe("texteda lib import: per-file revisions", () => {
  const VERSIONED_DEVICE = TEMPLATE_DEVICE.replace("component tps7a02\n", "component tps7a02\nrev          9.9.9\n");

  test("one act covers files at three revisions: one row, one attribution", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      // Each file states the release its own facts are at; an item names that string.
      writeFileSync(join(from, "components/power/tps7a02.teda"), TEMPLATE_DEVICE.replace("component tps7a02\n", "component tps7a02\nrev          1.0.0\n"));
      writeFileSync(join(from, "symbols/tps7a02.teda"), TEMPLATE_SYMBOL.replace("symbol tps7a02\n", "symbol tps7a02\nrev 2.0.0\n"));
      writeFileSync(join(from, "footprints/sot-23-5.teda"), TEMPLATE_FOOTPRINT.replace("footprint sot-23-5\n", "footprint sot-23-5\nrev 3.0.0\n"));
      writeFileSync(join(from, "library.toml"), `[library]
name = "vendor"

[[trust]]
by = "tz"
on = "2026-10-24"
components = ["tps7a02@1.0.0"]
symbols = ["tps7a02@2.0.0"]
footprints = ["sot-23-5@3.0.0"]
`);
      expect(runLibImport({ root, name: "vendor", from, rev: "v9", only: [], force: false })).toBe(0);

      const device = readFileSync(join(root, "assets/components/power/tps7a02.teda"), "utf8");
      expect(device).toContain("provenance reviewed");
      expect(device).toContain("verified_on 2026-10-24");
      // the revision the item names is the one the file states, not the release being imported
      expect(device).toContain("rev          1.0.0");
      expect(device).not.toContain("rev v9");

      const symbol = readFileSync(join(root, "assets/symbols/vendor/tps7a02.teda"), "utf8");
      expect(symbol).toContain("rev 2.0.0");
      expect(symbol).toContain("reviewed (tz, 2026-10-24)");
      const footprint = readFileSync(join(root, "assets/footprints/vendor/sot-23-5.teda"), "utf8");
      expect(footprint).toContain("rev 3.0.0");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("a file that states its own revision keeps it, whatever the import is called", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      writeFileSync(join(from, "components/power/tps7a02.teda"), VERSIONED_DEVICE);
      writeFileSync(
        join(from, "library.toml"),
        `[[trust]]\nby = "tz"\non = "2026-10-24"\ncomponents = ["tps7a02@9.9.9"]\n`,
      );
      expect(runLibImport({ root, name: "vendor", from, rev: "v1", only: [], force: false })).toBe(0);
      const device = readFileSync(join(root, "assets/components/power/tps7a02.teda"), "utf8");
      expect(device).toContain("# imported from vendor@v1 on ");
      expect(device).not.toContain("vendor@9.9.9");
      expect(device).toContain("rev          9.9.9");
      expect(device).not.toContain("rev v1");
      expect(device).toContain("provenance reviewed");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("a release that touches one file leaves the others at the revision they were imported at", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      // One act reviewed everything at v1.
      writeFileSync(join(from, "library.toml"), `[[trust]]
by = "tz"
on = "2026-10-01"
components = ["tps7a02@v1"]
symbols = ["tps7a02@v1"]
footprints = ["sot-23-5@v1"]
`);
      expect(runLibImport({ root, name: "vendor", from, rev: "v1", only: [], force: false })).toBe(0);
      const symbolPath = join(root, "assets/symbols/vendor/tps7a02.teda");
      const devicePath = join(root, "assets/components/power/tps7a02.teda");
      expect(readFileSync(symbolPath, "utf8")).toContain("# imported from vendor@v1");
      expect(readFileSync(devicePath, "utf8")).toContain("rev v1");

      // v2 changes the device only; a second act vouches for the new device.
      writeFileSync(join(from, "components/power/tps7a02.teda"), `${TEMPLATE_DEVICE}# pin 3 is NC on this reel\n`);
      writeFileSync(join(from, "library.toml"), `[[trust]]
by = "tz"
on = "2026-10-01"
components = ["tps7a02@v1"]
symbols = ["tps7a02@v1"]
footprints = ["sot-23-5@v1"]

[[trust]]
by = "tz"
on = "2026-10-24"
components = ["tps7a02@v2"]
`);
      expect(runLibImport({ root, name: "vendor", from, rev: "v2", only: [], force: true })).toBe(0);

      // The device moved and is reviewed at its new revision...
      const device = readFileSync(devicePath, "utf8");
      expect(device).toContain("rev v2");
      expect(device).toContain("verified_on 2026-10-24");
      expect(device).toContain("# pin 3 is NC on this reel");
      // ...while the geometry, untouched, keeps the revision it was imported at, and its claim.
      const symbol = readFileSync(symbolPath, "utf8");
      expect(symbol).toContain("rev v1");
      expect(symbol).toContain("# imported from vendor@v1");
      expect(symbol).toContain("reviewed (tz, 2026-10-01)");
      expect(symbol).not.toContain("rev v2");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("a copy marked +local is not vouched for, and a re-import of unchanged facts rejoins the library", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      writeFileSync(join(from, "library.toml"), `[[trust]]\nby = "tz"\non = "2026-10-24"\ncomponents = ["tps7a02@v1"]\n`);
      expect(runLibImport({ root, name: "vendor", from, rev: "v1", only: [], force: false })).toBe(0);

      const devicePath = join(root, "assets/components/power/tps7a02.teda");
      const forked = readFileSync(devicePath, "utf8").replace("rev v1", "rev v1+local.1");
      writeFileSync(devicePath, forked);
      // The upstream item names `v1`; `v1+local.1` is an exact string and matches nothing.
      // Re-importing a newer tree with the same facts must not re-stamp the copy to v2 and lose
      // the review: it rejoins the base revision the record vouches for.
      expect(runLibImport({ root, name: "vendor", from, rev: "v2", only: [], force: true })).toBe(0);
      const back = readFileSync(devicePath, "utf8");
      expect(back).toContain("# imported from vendor@v2 on ");
      expect(back).toContain("rev v1\n");
      expect(back).not.toContain("+local");
      expect(back).toContain("provenance reviewed");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("a review written into the copy survives a re-import of unchanged facts", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      expect(runLibImport({ root, name: "vendor", from, rev: "v1", only: [], force: false })).toBe(0);
      const devicePath = join(root, "assets/components/power/tps7a02.teda");
      // The guide's own workflow: the copy arrives `generated`, a human compares it with the
      // datasheet and flips the claim inside the copy (ADR-0034 decision 5).
      writeFileSync(
        devicePath,
        readFileSync(devicePath, "utf8").replace(
          "provenance generated",
          "provenance reviewed\nverified_by tz\nverified_on 2026-10-24",
        ),
      );

      // v2 touches the symbol only, so the device's facts did not move and it is not written at all.
      writeFileSync(join(from, "symbols/tps7a02.teda"), TEMPLATE_SYMBOL.replace("-5.08", "-6.35"));
      expect(runLibImport({ root, name: "vendor", from, rev: "v2", only: [], force: true })).toBe(0);
      expect(readFileSync(join(root, "assets/symbols/vendor/tps7a02.teda"), "utf8")).toContain("rev v2");

      const device = readFileSync(devicePath, "utf8");
      // The claim is the copy's: withdrawing it would make the run say "unchanged" and hand back an
      // unreviewed file.
      expect(device).toContain("provenance reviewed");
      expect(device).toContain("verified_by tz");
      expect(device).not.toContain("provenance generated");
      expect(device).toContain("rev v1");
      expect(device).not.toContain("rev v2");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("`[library] rev` is refused: a tree-level revision cannot be true", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      writeFileSync(join(from, "library.toml"), `[library]\nname = "vendor"\nrev = "v1"\n`);
      expect(runLibImport({ root, name: "vendor", from, rev: "v1", only: [], force: false })).toBe(2);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("a row-level `rev` is refused: the item names its revision", () => {
    const root = makeProject();
    const from = makeTemplate();
    const dir = mkdtempSync(join(tmpdir(), "texteda-trust-"));
    const table = join(dir, "trust.toml");
    try {
      writeFileSync(table, `[[trust]]\nlibrary = "vendor"\nrev = "v1"\nby = "tz"\non = "2026-10-24"\ncomponents = ["tps7a02"]\n`);
      expect(runLibImport({ root, name: "vendor", from, rev: "v1", only: [], force: false, trust: table })).toBe(2);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
describe("`--rev`, path reads, and target preflight", () => {
  test("`--rev` refuses a branch name, only a tag or commit hash is accepted", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      for (const branch of ["main", "master", "head", "develop", "trunk", "latest"]) {
        expect(runLibImport({ root, name: "vendor", from, rev: branch, only: [], force: false })).toBe(2);
      }
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("`--rev` rejects whitespace and trims surrounding spaces", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      for (const bad of ["v1 hotfix", "v1#x"]) {
        expect(runLibImport({ root, name: "vendor", from, rev: bad, only: [], force: false })).toBe(2);
      }
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);

      expect(runLibImport({ root, name: "vendor", from, rev: " v1 ", only: [], force: false })).toBe(0);
      const device = readFileSync(join(root, "assets/components/power/tps7a02.teda"), "utf8");
      expect(device).toContain("# imported from vendor@v1 on ");
      expect(device).toContain("\nrev v1\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("a --trust path that is a directory is an actionable refusal", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      const trust = join(root, "trust-dir");
      mkdirSync(trust);
      expect(runLibImport({ root, name: "vendor", from, rev: "v1", only: [], force: false, trust })).toBe(2);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("--from that is not a directory and library.toml that is a directory are refusals", () => {
    const root = makeProject();
    const from = makeTemplate();
    const file = join(root, "not-a-dir");
    writeFileSync(file, "");
    try {
      expect(runLibImport({ root, name: "vendor", from: file, rev: "v1", only: [], force: false })).toBe(2);
      mkdirSync(join(from, "library.toml"), { recursive: true });
      expect(runLibImport({ root, name: "vendor", from, rev: "v1", only: [], force: false })).toBe(2);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("a target that is a directory is refused, even with --force", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      mkdirSync(join(root, "assets/components/power/tps7a02.teda"), { recursive: true });
      expect(runLibImport({ root, name: "vendor", from, rev: "v1", only: [], force: true })).toBe(2);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(true);
      expect(existsSync(join(root, "assets/symbols/vendor/tps7a02.teda"))).toBe(false);
      expect(existsSync(join(root, "assets/footprints/vendor/sot-23-5.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("a dangling symlink target is refused, not followed", () => {
    const root = makeProject();
    const from = makeTemplate();
    try {
      mkdirSync(join(root, "assets/symbols/vendor"), { recursive: true });
      const outside = join(root, "outside.teda");
      symlinkSync(outside, join(root, "assets/symbols/vendor/tps7a02.teda"));
      expect(runLibImport({ root, name: "vendor", from, rev: "v1", only: [], force: false })).toBe(2);
      expect(existsSync(outside)).toBe(false);
      expect(existsSync(join(root, "assets/components/power/tps7a02.teda"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });

  test("the origin header names the consumer trust file the reader can find", () => {
    const root = makeProject();
    const from = makeTemplate();
    const trust = join(root, "trust.txt");
    writeFileSync(trust, `[[trust]]\nlibrary = "vendor"\nby = "tz"\non = "2026-10-24"\ncomponents = ["tps7a02@v1"]\n`);
    try {
      expect(runLibImport({ root, name: "vendor", from, rev: "v1", only: [], force: false, trust })).toBe(0);
      const device = readFileSync(join(root, "assets/components/power/tps7a02.teda"), "utf8");
      expect(device).toContain(`as trust.txt says`);
      expect(device).toContain("provenance reviewed");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(from, { recursive: true, force: true });
    }
  });
});
