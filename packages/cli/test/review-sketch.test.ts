// The sketch route: a reviewer's freehand picture, written outside the project.
//
// A sketch is a message to the agent, not a change to the design (ADR-0043 D5). So the route has
// two jobs and no more: refuse a picture the project does not have a drawing for, and put the
// picture where the reviewer can hand over its path. It never touches the project.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SketchError, nextSketchIndex, saveSketchPicture } from "../src/sketch.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const referenceProject = join(repoRoot, "examples", "reference-project");
const cli = join(repoRoot, "packages", "cli", "scripts", "texteda.ts");

/** A real one-pixel PNG, base64-encoded, as the browser sends it. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

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

describe("saving a picture", () => {
  test("the picture lands in the folder, and the path says where", () => {
    const dir = scratch();
    const saved = saveSketchPicture({ drawing: "symbol/indicators:led", png: PNG }, dir);
    expect(saved.path).toBe(join(dir, "indicators-led-1.png"));
    expect(saved.drawing).toBe("symbol/indicators:led");
    expect(readFileSync(saved.path).subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  test("the second picture of the same drawing is the second one", () => {
    const dir = scratch();
    const first = saveSketchPicture({ drawing: "symbol/indicators:led", png: PNG }, dir);
    const second = saveSketchPicture({ drawing: "symbol/indicators:led", png: PNG }, dir);
    expect(first.path).toBe(join(dir, "indicators-led-1.png"));
    expect(second.path).toBe(join(dir, "indicators-led-2.png"));
    written.push(first.path, second.path);
  });

  test("two drawings keep their own numbers", () => {
    const dir = scratch();
    const led = saveSketchPicture({ drawing: "symbol/indicators:led", png: PNG }, dir);
    const resistor = saveSketchPicture({ drawing: "symbol/passives:r", png: PNG }, dir);
    expect(resistor.path).toBe(join(dir, "passives-r-1.png"));
    written.push(led.path, resistor.path);
  });

  test("the number is read off the folder, so a gap stays a gap", () => {
    const dir = scratch();
    saveSketchPicture({ drawing: "symbol/indicators:led", png: PNG }, dir);
    saveSketchPicture({ drawing: "symbol/indicators:led", png: PNG }, dir);
    expect(nextSketchIndex(dir, "indicators-led")).toBe(3);
  });

  test("something that is not a picture is refused", () => {
    const dir = scratch();
    expect(() => saveSketchPicture({ drawing: "symbol/indicators:led", png: "not a picture" }, dir)).toThrow(
      SketchError,
    );
    expect(() => saveSketchPicture({ drawing: "symbol/indicators:led", png: "" }, dir)).toThrow(SketchError);
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
      const response = await post(server, "/api/sketch", { drawing: "symbol/indicators:led", png: PNG });
      expect(response.status).toBe(200);
      const path = String(response.payload["path"] ?? "");
      expect(path).toContain("indicators-led-");
      expect(path.endsWith(".png")).toBe(true);
      expect(existsSync(path)).toBe(true);
      written.push(path);
    } finally {
      server.stop();
    }
  });

  test("it refuses a drawing the project does not have, and writes nothing", async () => {
    const server = await serve(referenceProject);
    try {
      const response = await post(server, "/api/sketch", { drawing: "symbol/nope:nope", png: PNG });
      expect(response.status).toBe(400);
      expect(String(response.payload["error"] ?? "")).toContain("no such drawing");
    } finally {
      server.stop();
    }
  });

  test("it refuses a picture that is not a picture", async () => {
    const server = await serve(referenceProject);
    try {
      const response = await post(server, "/api/sketch", { drawing: "symbol/indicators:led", png: "nope" });
      expect(response.status).toBe(400);
      expect(String(response.payload["error"] ?? "")).toContain("not a PNG");
    } finally {
      server.stop();
    }
  });

  test("it leaves the project alone: a sketch is a message, not a record", async () => {
    const server = await serve(referenceProject);
    const before = readFileSync(join(referenceProject, "assets", "symbols", "indicators", "led.teda"), "utf8");
    try {
      const response = await post(server, "/api/sketch", { drawing: "symbol/indicators:led", png: PNG });
      expect(response.status).toBe(200);
      written.push(String(response.payload["path"] ?? ""));
      const after = readFileSync(join(referenceProject, "assets", "symbols", "indicators", "led.teda"), "utf8");
      expect(after).toBe(before);
    } finally {
      server.stop();
    }
  });
});
