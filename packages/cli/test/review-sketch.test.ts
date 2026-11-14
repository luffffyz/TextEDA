// The sketch route: a reviewer's freehand picture, written outside the project.
//
// A sketch is a message to the agent, not a change to the design (ADR-0043 D5). So the route has
// two jobs and no more: refuse a picture the project does not have a drawing for, and put the
// picture where the reviewer can hand over its path. It never touches the project.
//
// What lands is a pair — the picture for the agent's eyes, the ink's own millimetres beside it
// for the agent's hands. The second half is what makes the message usable: a hand-drawn stroke
// cannot say precisely where it points, so without the numbers the agent would have to measure the
// picture to find out what the reviewer already knew.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SketchError, nextSketchIndex, saveSketch } from "../src/sketch.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const referenceProject = join(repoRoot, "examples", "reference-project");
const cli = join(repoRoot, "packages", "cli", "scripts", "texteda.ts");

/** A real one-pixel PNG, base64-encoded, as the browser sends it. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** The ink of a stroke that says "the cap's edge should be here". */
const INK: { points: [number, number][] }[] = [
  { points: [[2.72, 3.27], [3.7, 2.45], [2.72, 1.63]] },
];

/** The scratch folders and files this file made, so they can be taken away when it is done. */
const scratches: string[] = [];
const written: string[] = [];

afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
  for (const file of written) rmSync(file, { force: true });
});

/** An empty folder to save pictures into. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "texteda-sketch-test-"));
  scratches.push(dir);
  return dir;
}

/** A request for the symbol the reference project has. */
function request(overrides: Partial<Parameters<typeof saveSketch>[0]> = {}): Parameters<typeof saveSketch>[0] {
  return {
    drawing: "symbol/indicators:led",
    kind: "symbol",
    label: "led",
    png: PNG,
    ink: INK,
    source_hash: "e8cee2cb",
    tool_version: "0.1.0",
    saved_at: "2026-11-14T12:47:12.000Z",
    ...overrides,
  };
}

describe("saving a sketch", () => {
  test("the picture lands in the folder, and the path says where", () => {
    const dir = scratch();
    const saved = saveSketch(request(), dir);
    expect(saved.path).toBe(join(dir, "indicators-led-1.png"));
    expect(saved.drawing).toBe("symbol/indicators:led");
    expect(readFileSync(saved.path).subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    written.push(saved.path);
  });

  test("the ink's numbers land beside the picture", () => {
    const dir = scratch();
    const saved = saveSketch(request(), dir);
    expect(saved.notes).toBe(join(dir, "indicators-led-1.json"));
    const notes = JSON.parse(readFileSync(saved.notes, "utf8")) as {
      drawing: string;
      kind: string;
      label: string;
      space: string;
      strokes: { points: number[][] }[];
      source_hash: string;
      tool_version: string;
      saved_at: string;
    };
    expect(notes.drawing).toBe("symbol/indicators:led");
    expect(notes.kind).toBe("symbol");
    expect(notes.label).toBe("led");
    // The ink is measured in the drawing's own millimetres, and says so.
    expect(notes.space).toBe("source-millimetres");
    expect(notes.strokes).toEqual([{ points: [[2.72, 3.27], [3.7, 2.45], [2.72, 1.63]] }]);
    // The file says which build the reviewer was looking at.
    expect(notes.source_hash).toBe("e8cee2cb");
    expect(notes.tool_version).toBe("0.1.0");
    expect(notes.saved_at).toBe("2026-11-14T12:47:12.000Z");
    written.push(saved.path, saved.notes);
  });

  test("the second picture of the same drawing is the second one", () => {
    const dir = scratch();
    const first = saveSketch(request(), dir);
    const second = saveSketch(request(), dir);
    expect(first.path).toBe(join(dir, "indicators-led-1.png"));
    expect(second.path).toBe(join(dir, "indicators-led-2.png"));
    expect(second.notes).toBe(join(dir, "indicators-led-2.json"));
    written.push(first.path, first.notes, second.path, second.notes);
  });

  test("two drawings keep their own numbers", () => {
    const dir = scratch();
    const led = saveSketch(request(), dir);
    const resistor = saveSketch(request({ drawing: "symbol/passives:r", label: "r" }), dir);
    expect(resistor.path).toBe(join(dir, "passives-r-1.png"));
    written.push(led.path, led.notes, resistor.path, resistor.notes);
  });

  test("the number is read off the folder, so a gap stays a gap", () => {
    const dir = scratch();
    saveSketch(request(), dir);
    saveSketch(request(), dir);
    expect(nextSketchIndex(dir, "indicators-led")).toBe(3);
  });

  test("something that is not a picture is refused", () => {
    const dir = scratch();
    expect(() => saveSketch(request({ png: "not a picture" }), dir)).toThrow(SketchError);
    expect(() => saveSketch(request({ png: "" }), dir)).toThrow(SketchError);
    // Nothing was written.
    expect(readdirSync(dir)).toEqual([]);
  });
});

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

describe("the sketch route", () => {
  test("it saves a picture of a drawing the project has, and says where", async () => {
    const server = await serve(referenceProject);
    try {
      const response = await post(server, "/api/sketch", {
        drawing: "symbol/indicators:led",
        png: PNG,
        ink: INK,
      });
      expect(response.status).toBe(200);
      const path = String(response.payload["path"] ?? "");
      expect(path).toContain("indicators-led-");
      expect(path.endsWith(".png")).toBe(true);
      expect(existsSync(path)).toBe(true);
      written.push(path);
      // The numbers come back too, so the reviewer can be told where they are.
      const notes = String(response.payload["notes"] ?? "");
      expect(notes.endsWith(".json")).toBe(true);
      expect(existsSync(notes)).toBe(true);
      written.push(notes);
    } finally {
      server.stop();
    }
  });

  test("the ink it is given is the ink it writes", async () => {
    const server = await serve(referenceProject);
    try {
      const response = await post(server, "/api/sketch", {
        drawing: "symbol/indicators:led",
        png: PNG,
        ink: INK,
      });
      expect(response.status).toBe(200);
      const notes = String(response.payload["notes"] ?? "");
      written.push(String(response.payload["path"] ?? ""), notes);
      const parsed = JSON.parse(readFileSync(notes, "utf8")) as { strokes: { points: number[][] }[] };
      expect(parsed.strokes).toEqual([{ points: [[2.72, 3.27], [3.7, 2.45], [2.72, 1.63]] }]);
    } finally {
      server.stop();
    }
  });

  test("it refuses a drawing the project does not have, and writes nothing", async () => {
    const server = await serve(referenceProject);
    try {
      const response = await post(server, "/api/sketch", { drawing: "symbol/nope:nope", png: PNG, ink: INK });
      expect(response.status).toBe(400);
      expect(String(response.payload["error"] ?? "")).toContain("no such drawing");
    } finally {
      server.stop();
    }
  });

  test("it refuses a picture that is not a picture", async () => {
    const server = await serve(referenceProject);
    try {
      const response = await post(server, "/api/sketch", {
        drawing: "symbol/indicators:led",
        png: "nope",
        ink: INK,
      });
      expect(response.status).toBe(400);
      expect(String(response.payload["error"] ?? "")).toContain("not a PNG");
    } finally {
      server.stop();
    }
  });

  test("it refuses an ink that is not an ink", async () => {
    const server = await serve(referenceProject);
    try {
      const response = await post(server, "/api/sketch", {
        drawing: "symbol/indicators:led",
        png: PNG,
        ink: [{ points: [[1, 2, 3]] }],
      });
      expect(response.status).toBe(400);
      expect(String(response.payload["error"] ?? "")).toContain("[x, y]");
    } finally {
      server.stop();
    }
  });

  test("it leaves the project alone: a sketch is a message, not a record", async () => {
    const server = await serve(referenceProject);
    const before = readFileSync(join(referenceProject, "assets", "symbols", "indicators", "led.teda"), "utf8");
    try {
      const response = await post(server, "/api/sketch", {
        drawing: "symbol/indicators:led",
        png: PNG,
        ink: INK,
      });
      expect(response.status).toBe(200);
      written.push(String(response.payload["path"] ?? ""), String(response.payload["notes"] ?? ""));
      const after = readFileSync(join(referenceProject, "assets", "symbols", "indicators", "led.teda"), "utf8");
      expect(after).toBe(before);
    } finally {
      server.stop();
    }
  });
});
