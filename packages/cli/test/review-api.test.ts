// The review app's write routes, over HTTP (ADR-0042 D3, D9).
//
// The browser never touches the file system: it asks the server, the server owns the files. These
// tests therefore talk to a real server -- the same command a person runs -- and check what comes
// back and what lands on disk: a plan that writes nothing, a commit that writes exactly one file,
// a draft that is drawn without being written, a save that refuses a source that does not parse,
// and a request for a page the project does not have. The sketch route has its own file
// (`review-sketch.test.ts`).
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseView } from "@texteda/parser";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const referenceProject = join(repoRoot, "examples", "reference-project");
const cli = join(repoRoot, "packages", "cli", "scripts", "texteda.ts");

const pageFile = "views/buck-5v.view.teda";

/** The scratch copies this file made, so they can be taken away when it is done. */
const scratches: string[] = [];

/** A copy of the reference project, so a test can write into it. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "texteda-review-api-test-"));
  cpSync(referenceProject, dir, { recursive: true });
  // The reference project is module-first; these page-route tests use the historical detail page
  // kept as a fixture.
  writeFileSync(join(dir, "views", "buck-5v.view.teda"), readFileSync(join(import.meta.dir, "fixtures", "legacy-buck.view.teda")));
  scratches.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

function expectC1At118(text: string): void {
  const parsed = parseView(text, { file: pageFile });
  expect(parsed.ok).toBe(true);
  expect(parsed.ir?.place!.find((place) => place.instance_id === "M2.C1")).toMatchObject({
    x_nm: 118_000_000,
    y_nm: 95_000_000,
    rot_mdeg: 90_000,
  });
}

interface Server {
  url: string;
  stop: () => void;
}

/** Start the review app on a free port and wait for it to say where it listens. */
async function serve(dir: string): Promise<Server> {
  const child = Bun.spawn(["bun", "run", cli, "review", dir, "--port", "0"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  let found: RegExpExecArray | null = null;
  while (found === null) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error(`the server stopped before it said where it listens: ${seen}`);
    seen += decoder.decode(chunk.value, { stream: true });
    found = /http:\/\/[^\s]+/.exec(seen);
  }
  const url = found[0].replace(/\/$/, "");
  return {
    url,
    stop: () => {
      child.kill();
    },
  };
}

/** POST a JSON body and answer with the status and the parsed payload. */
async function post(
  server: Server,
  path: string,
  body: unknown,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const response = await fetch(`${server.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: (await response.json()) as Record<string, unknown> };
}

interface ReviewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ReviewField {
  instance_id: string;
  name: "Reference" | "Value";
  text: string;
  x: number;
  y: number;
  anchor?: "start" | "middle" | "end";
  manual: boolean;
  box: ReviewBox;
}

interface FieldPosition {
  instance_id: string;
  name: "Reference" | "Value";
  x: number;
  y: number;
  anchor?: "start" | "middle" | "end";
}

/** Turn the baseline's local field anchors into the absolute sheet positions expected by layout. */
async function automaticFieldPositions(server: Server): Promise<{ fields: ReviewField[]; positions: FieldPosition[] }> {
  const preview = await post(server, "/api/layout", {
    board: "main",
    page: "buck-5v",
    places: [],
    automatic_fields: true,
  });
  expect(preview.status).toBe(200);
  const fields = preview.payload["fields"] as ReviewField[];

  const document = await (await fetch(server.url)).text();
  const embedded = /window\.__TEXTEDA_REVIEW__ = (.*);<\/script>/.exec(document);
  expect(embedded).not.toBeNull();
  const model = JSON.parse(embedded?.[1] ?? "{}") as {
    drawings?: { file?: string; places?: { instance_id: string; x: number; y: number; rot: number }[] }[];
  };
  const page = model.drawings?.find((drawing) => drawing.file === pageFile);
  const places = new Map((page?.places ?? []).map((place) => [place.instance_id, place]));
  const positions = fields.filter((field) => !field.manual).map((field): FieldPosition => {
    const place = places.get(field.instance_id);
    expect(place).toBeDefined();
    const rotation = ((place!.rot % 360) + 360) % 360;
    const sheet = rotation === 90
      ? { x: place!.x + field.y, y: place!.y + field.x }
      : rotation === 180
        ? { x: place!.x - field.x, y: place!.y + field.y }
        : rotation === 270
          ? { x: place!.x - field.y, y: place!.y - field.x }
          : { x: place!.x + field.x, y: place!.y - field.y };
    return {
      instance_id: field.instance_id,
      name: field.name,
      ...sheet,
      ...(field.anchor === undefined ? {} : { anchor: field.anchor }),
    };
  });
  return { fields, positions };
}

function boxesOverlap(a: ReviewBox, b: ReviewBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function expectBoxWithinMillimetreConversion(actual: ReviewBox, expected: ReviewBox): void {
  for (const key of ["x", "y", "w", "h"] as const) {
    expect(Math.abs(actual[key] - expected[key])).toBeLessThanOrEqual(0.002);
  }
}
describe("the review app's write routes", () => {
  test("the layout route moves a module drawing without writing a page", async () => {
    const dir = scratch();
    const moduleFile = "views/modules/buck-5v.module-view.teda";
    const beforeModule = readFileSync(join(dir, moduleFile), "utf8");
    const beforePage = readFileSync(join(dir, "views/main.view.teda"), "utf8");
    const server = await serve(dir);
    try {
      const request = { module: "buck-5v", places: [{ instance_id: "C1", x: 18, y: 11.5, rot: 90 }] };
      const preview = await post(server, "/api/layout", request);
      expect(preview.status).toBe(200);
      expect(readFileSync(join(dir, moduleFile), "utf8")).toBe(beforeModule);

      const commit = await post(server, "/api/layout", { ...request, commit: true });
      expect(commit.status).toBe(200);
      expect(commit.payload["changed"]).toBe(true);
      const written = readFileSync(join(dir, moduleFile), "utf8");
      expect(written).toContain("C1  [18.0,11.5]");
      // A module drawing is advisory source: editing it does not touch the page or the project.
      expect(readFileSync(join(dir, "views/main.view.teda"), "utf8")).toBe(beforePage);
    } finally {
      server.stop();
    }
  });

  test("the layout route plans a change without writing it", async () => {
    const dir = scratch();
    const before = readFileSync(join(dir, pageFile), "utf8");
    const server = await serve(dir);
    try {
      const response = await post(server, "/api/layout", {
        board: "main",
        page: "buck-5v",
        places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
        commit: false,
      });
      expect(response.status).toBe(200);
      expect(response.payload["changed"]).toBe(true);
      expect(String(response.payload["svg"] ?? "")).toContain("<svg");
      // The plan is a picture, not a file: the page on disk is still the one that was there.
      expect(readFileSync(join(dir, pageFile), "utf8")).toBe(before);
    } finally {
      server.stop();
    }
  });


  test("the layout route commits a zero-degree rotation instead of retaining the old angle", async () => {
    const dir = scratch();
    const server = await serve(dir);
    try {
      const response = await post(server, "/api/layout", {
        board: "main",
        page: "buck-5v",
        places: [{ instance_id: "M2.C4", x: 218, y: 105.5, rot: 0 }],
        commit: true,
      });
      expect(response.status).toBe(200);
      expect(response.payload["changed"]).toBe(true);
      const parsed = parseView(readFileSync(join(dir, pageFile), "utf8"), { file: pageFile });
      expect(parsed.ok).toBe(true);
      expect(parsed.ir?.place!.find((place) => place.instance_id === "M2.C4")?.rot_mdeg).toBeUndefined();
    } finally {
      server.stop();
    }
  });
  test("the layout route writes the page when it is asked to commit", async () => {
    const dir = scratch();
    const server = await serve(dir);
    try {
      const response = await post(server, "/api/layout", {
        board: "main",
        page: "buck-5v",
        places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
        commit: true,
      });
      expect(response.status).toBe(200);
      expect(response.payload["changed"]).toBe(true);
      expectC1At118(readFileSync(join(dir, pageFile), "utf8"));
    } finally {
      server.stop();
    }
  });

  // The data-loss path (ADR-0042 D6): the editor holds text that was never saved, and a move writes the
  // page back. Without the draft in the request, the write is the file on disk and the edit is
  // gone.
  test("the layout route keeps the editor's unsaved text", async () => {
    const dir = scratch();
    const text = readFileSync(join(dir, pageFile), "utf8");
    const draft = text.replace(
      "Every net of this module is drawn here",
      "Every net of this module is drawn here (edited)",
    );
    const server = await serve(dir);
    try {
      const response = await post(server, "/api/layout", {
        board: "main",
        page: "buck-5v",
        places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
        commit: true,
        text: draft,
      });
      expect(response.status).toBe(200);
      expect(response.payload["changed"]).toBe(true);
      const written = readFileSync(join(dir, pageFile), "utf8");
      // The edit is still there, and so is the move.
      expect(written).toContain("Every net of this module is drawn here (edited)");
      expectC1At118(written);
    } finally {
      server.stop();
    }
  });

  test("the layout route refuses a draft that does not parse, and writes nothing", async () => {
    const dir = scratch();
    const before = readFileSync(join(dir, pageFile), "utf8");
    const server = await serve(dir);
    try {
      const response = await post(server, "/api/layout", {
        board: "main",
        page: "buck-5v",
        places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
        commit: true,
        text: "version 0.14.0\nview buck-5v\n\nplace\n  M2.C1  118.0\n",
      });
      expect(response.status).toBe(400);
      // The draft's place row writes a point as two cells, which the language does not allow.
      expect(String(response.payload["error"] ?? "")).toContain("syntax.invalid-literal");
      expect(readFileSync(join(dir, pageFile), "utf8")).toBe(before);
    } finally {
      server.stop();
    }
  });

  test("the layout route refuses a board or a page the project does not have", async () => {
    const dir = scratch();
    const server = await serve(dir);
    try {
      const board = await post(server, "/api/layout", { board: "nope", page: "buck-5v", places: [] });
      expect(board.status).toBe(400);
      expect(String(board.payload["error"] ?? "")).toContain("no such board");
      const page = await post(server, "/api/layout", { board: "main", page: "nope", places: [] });
      expect(page.status).toBe(400);
      expect(String(page.payload["error"] ?? "")).toContain("no such print page");
    } finally {
      server.stop();
    }
  });

  test("the layout route previews and commits a field override without writing the preview", async () => {
    const dir = scratch();
    const before = readFileSync(join(dir, pageFile), "utf8");
    const draft = before.replace("version 0.14.0", "version 0.14.1");
    const server = await serve(dir);
    try {
      const preview = await post(server, "/api/layout", {
        board: "main",
        page: "buck-5v",
        places: [],
        fields: [{ instance_id: "M2.C1", name: "Value", x: 0, y: 0 }],
        text: draft,
        commit: false,
      });
      expect(preview.status).toBe(200);
      expect(preview.payload["changed"]).toBe(true);
      expect(readFileSync(join(dir, pageFile), "utf8")).toBe(before);

      const commit = await post(server, "/api/layout", {
        board: "main",
        page: "buck-5v",
        places: [],
        fields: [{ instance_id: "M2.C1", name: "Value", x: 0, y: 0 }],
        text: draft,
        commit: true,
      });
      expect(commit.status).toBe(200);
      const document = await (await fetch(server.url)).text();
      const embedded = /window\.__TEXTEDA_REVIEW__ = (.*);<\/script>/.exec(document);
      expect(embedded).not.toBeNull();
      const model = JSON.parse(embedded?.[1] ?? "{}") as {
        drawings?: { file?: string; fields?: { instance_id: string; name: string; text: string; x: number; y: number; manual: boolean }[] }[];
      };
      const page = model.drawings?.find((drawing) => drawing.file === pageFile);
      expect(page?.fields?.find((field) => field.instance_id === "M2.C1" && field.name === "Value")).toMatchObject({
        text: "10uF",
        x: 0,
        y: 0,
        manual: true,
      });
      const parsed = parseView(readFileSync(join(dir, pageFile), "utf8"), { file: pageFile });
      expect(parsed.ir?.field?.filter((field) => field.instance_id === "M2.C1")).toEqual([
        { instance_id: "M2.C1", name: "Value", x_nm: 0, y_nm: 0 },
      ]);
    } finally {
      server.stop();
    }
  });

  test("automatic field positions retain the preview geometry when a manual field moves", async () => {
    const dir = scratch();
    const before = readFileSync(join(dir, pageFile), "utf8");
    const server = await serve(dir);
    try {
      const baseline = await automaticFieldPositions(server);
      const request = {
        board: "main",
        page: "buck-5v",
        places: [],
        automatic_fields: true,
        field_positions: baseline.positions,
        fields: [{ instance_id: "M2.C4", name: "Value", x: 0, y: 20 }],
      };

      const preview = await post(server, "/api/layout", request);
      expect(preview.status).toBe(200);
      expect(readFileSync(join(dir, pageFile), "utf8")).toBe(before);
      const baselineByKey = new Map(baseline.fields.map((field) => [`${field.instance_id}:${field.name}`, field]));
      const previewFields = preview.payload["fields"] as ReviewField[];
      const moved = previewFields.find((field) => field.instance_id === "M2.C4" && field.name === "Value");
      expect(moved?.manual).toBe(true);
      for (const field of previewFields) {
        if (field.instance_id === "M2.C4" && field.name === "Value") continue;
        const original = baselineByKey.get(`${field.instance_id}:${field.name}`);
        expect(original).toBeDefined();
        expect(field.anchor).toBe(original!.anchor);
        expectBoxWithinMillimetreConversion(field.box, original!.box);
      }

      const commit = await post(server, "/api/layout", { ...request, commit: true });
      expect(commit.status).toBe(200);
      expect(commit.payload["changed"]).toBe(true);
      const parsed = parseView(readFileSync(join(dir, pageFile), "utf8"), { file: pageFile });
      expect(parsed.ok).toBe(true);
      expect(parsed.ir?.field).toEqual([
        { instance_id: "M2.C4", name: "Reference", x_nm: -2_000_000, y_nm: 1_500_000 },
        { instance_id: "M2.C4", name: "Value", x_nm: 0, y_nm: 20_000_000 },
      ]);
    } finally {
      server.stop();
    }
  });

  test("automatic fields avoid a manual field that obstructs their saved position", async () => {
    const dir = scratch();
    const server = await serve(dir);
    try {
      const baseline = await automaticFieldPositions(server);
      const before = baseline.fields.find((field) => field.instance_id === "M2.C3" && field.name === "Value");
      expect(before).toBeDefined();
      // Put the manual C4 field where the automatic C3 field sits. C4 is placed at [218,105.5]
      // with a quarter turn, so the sheet-to-symbol conversion is (x, y) = (sheetY - 105.5, sheetX - 218).
      const sheetX = before!.box.x + before!.box.w / 2;
      const sheetY = before!.box.y + before!.box.h / 2;
      const response = await post(server, "/api/layout", {
        board: "main",
        page: "buck-5v",
        places: [],
        automatic_fields: true,
        field_positions: baseline.positions,
        fields: [{ instance_id: "M2.C4", name: "Value", x: Math.round((sheetY - 105.5) * 100) / 100, y: Math.round((sheetX - 218) * 100) / 100 }],
      });
      expect(response.status).toBe(200);
      const fields = response.payload["fields"] as ReviewField[];
      const after = fields.find((field) => field.instance_id === "M2.C3" && field.name === "Value");
      const obstacle = fields.find((field) => field.instance_id === "M2.C4" && field.name === "Value");
      expect(after).toBeDefined();
      expect(obstacle?.manual).toBe(true);
      expect(boxesOverlap(before!.box, obstacle!.box)).toBe(true);
      expect(boxesOverlap(after!.box, obstacle!.box)).toBe(false);
      expect(after!.box).not.toEqual(before!.box);
    } finally {
      server.stop();
    }
  });

  test("the layout route rejects malformed, unknown, and conflicting field operations", async () => {
    const dir = scratch();
    const before = readFileSync(join(dir, pageFile), "utf8");
    const draft = before.replace("version 0.14.0", "version 0.14.1");
    const server = await serve(dir);
    try {
      const malformed = await post(server, "/api/layout", {
        board: "main",
        page: "buck-5v",
        places: [],
        fields: [{ instance_id: "M2.C1", name: "Value", x: "0", y: 0 }],
      });
      expect(malformed.status).toBe(400);
      expect(String(malformed.payload["error"] ?? "")).toContain("finite numbers");
      const malformedPositions = await post(server, "/api/layout", {
        board: "main",
        page: "buck-5v",
        places: [],
        field_positions: "not-an-array",
      });
      expect(malformedPositions.status).toBe(400);
      expect(String(malformedPositions.payload["error"] ?? "")).toContain("field_positions must be an array");
      const invalidAnchor = await post(server, "/api/layout", {
        board: "main",
        page: "buck-5v",
        places: [],
        field_positions: [{ instance_id: "M2.C3", name: "Value", x: 10.25, y: 20.5, anchor: "center" }],
      });
      expect(invalidAnchor.status).toBe(400);
      expect(String(invalidAnchor.payload["error"] ?? "")).toContain("anchor must be start, middle, or end");
      const invalidAutomaticFields = await post(server, "/api/layout", {
        board: "main",
        page: "buck-5v",
        places: [],
        automatic_fields: "false",
      });
      expect(invalidAutomaticFields.status).toBe(400);
      expect(String(invalidAutomaticFields.payload["error"] ?? "")).toContain("automatic_fields must be a boolean");

      const invalidReanchorWires = await post(server, "/api/layout", {
        board: "main",
        page: "buck-5v",
        places: [],
        reanchor_wires: 0,
      });
      expect(invalidReanchorWires.status).toBe(400);
      expect(String(invalidReanchorWires.payload["error"] ?? "")).toContain("reanchor_wires must be a boolean");

      const unknown = await post(server, "/api/layout", {
        board: "main",
        page: "buck-5v",
        places: [],
        fields: [{ instance_id: "M2.UNKNOWN", name: "Value", x: 0, y: 0 }],
        text: draft,
      });
      expect(unknown.status).toBe(400);
      expect(String(unknown.payload["error"] ?? "")).toContain("does not place M2.UNKNOWN");

      const conflicting = await post(server, "/api/layout", {
        board: "main",
        page: "buck-5v",
        places: [],
        fields: [{ instance_id: "M2.C1", name: "Value", x: 0, y: 0 }],
        remove_fields: [{ instance_id: "M2.C1", name: "Value" }],
        text: draft,
      });
      expect(conflicting.status).toBe(400);
      expect(String(conflicting.payload["error"] ?? "")).toContain("duplicate field operation");
      expect(readFileSync(join(dir, pageFile), "utf8")).toBe(before);
    } finally {
      server.stop();
    }
  });
  test("the source route draws a draft and says which row each object came from", async () => {
    const dir = scratch();
    const text = readFileSync(join(dir, pageFile), "utf8");
    const server = await serve(dir);
    try {
      const response = await post(server, "/api/source", { file: pageFile, text, save: false });
      expect(response.status).toBe(200);
      expect(response.payload["errors"]).toEqual([]);
      expect(String(response.payload["svg"] ?? "")).toContain("<svg");
      const anchors = response.payload["anchors"] as { key: string; kind: string; line: number }[];
      const place = anchors.find((anchor) => anchor.key === "M2.C1");
      expect(place?.kind).toBe("place");
      // The line the row is on: the place row of M2.C1 in the file.
      expect(text.split("\n")[place!.line - 1]).toContain("M2.C1");
    } finally {
      server.stop();
    }
  });
  test("the source route can suppress automatic page fields without changing source rows", async () => {
    const dir = scratch();
    const text = readFileSync(join(dir, pageFile), "utf8");
    // The moved value blocks the reference, so enabling collision placement must have an effect.
    const draft = text.replace("\nfield\n", "\nfield\n  M2.C1  Value  [0.0,2.5]\n");
    const server = await serve(dir);
    try {
      const automatic = await post(server, "/api/source", { file: pageFile, text: draft, save: false });
      const disabled = await post(server, "/api/source", {
        file: pageFile,
        text: draft,
        save: false,
        automatic_fields: false,
      });
      expect(automatic.status).toBe(200);
      expect(disabled.status).toBe(200);
      expect(disabled.payload["geometry"]).not.toEqual(automatic.payload["geometry"]);
      expect(readFileSync(join(dir, pageFile), "utf8")).toBe(text);
    } finally {
      server.stop();
    }
  });

  test("the source route saves the page in the formatter's form", async () => {
    const dir = scratch();
    const text = readFileSync(join(dir, pageFile), "utf8");
    const draft = text.replace(
      /^([ \t]*)M2\.C1[ \t]+\[117\.5,96\.5\][ \t]+90$/m,
      "$1M2.C1  [118.0,95.0]  90",
    );
    expect(draft).not.toBe(text);
    const server = await serve(dir);
    try {
      const response = await post(server, "/api/source", {
        file: pageFile,
        text: draft,
        save: true,
      });
      expect(response.status).toBe(200);
      expect(response.payload["changed"]).toBe(true);
      expectC1At118(readFileSync(join(dir, pageFile), "utf8"));
    } finally {
      server.stop();
    }
  });

  test("the source route refuses a source that does not parse, and writes nothing", async () => {
    const dir = scratch();
    const before = readFileSync(join(dir, pageFile), "utf8");
    const server = await serve(dir);
    try {
      const response = await post(server, "/api/source", {
        file: pageFile,
        text: "version 0.14.0\npcb charger-buck\n",
        save: true,
      });
      expect(response.status).toBe(400);
      expect((response.payload["errors"] as string[]).length).toBeGreaterThan(0);
      expect(readFileSync(join(dir, pageFile), "utf8")).toBe(before);
    } finally {
      server.stop();
    }
  });

  test("the source route refuses a file the project does not have", async () => {
    const dir = scratch();
    const server = await serve(dir);
    try {
      const response = await post(server, "/api/source", {
        file: "views/../../../../etc/passwd",
        text: "",
        save: true,
      });
      expect(response.status).toBe(400);
      expect(String(response.payload["error"] ?? "")).toContain("no such print page");
    } finally {
      server.stop();
    }
  });
});
