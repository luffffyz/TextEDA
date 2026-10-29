// The MCP server: the verbs over a transport a host can speak.
//
// The server is an adapter, not a second implementation (ADR-0143 D5): the tools it lists are the
// catalogue's entries, and the value a tool returns is the value the command line prints with
// `--json`, field for field (ADR-0144 D5).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { MCP_PROTOCOL_VERSIONS, handleMcpRequest, mcpTools } from "../src/mcp.ts";
import { toolCatalogue } from "../src/tools.ts";

const script = join(import.meta.dir, "../scripts/texteda.ts");
const project = join(import.meta.dir, "../../../examples/reference-project");

/** One JSON-RPC answer, as the test reads it. */
interface Rpc {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/** Ask the server something, the way a client does: one JSON object on one line. */
function ask(request: unknown): Rpc | null {
  return handleMcpRequest(request) as Rpc | null;
}

/** A field of an answer, read without trusting its shape. */
function field(value: unknown, name: string): unknown {
  if (typeof value !== "object" || value === null || !(name in value)) return undefined;
  return (value as { [key: string]: unknown })[name];
}

/** The tools an answer lists, with their names and their input schemas. */
function toolsOf(result: Record<string, unknown> | undefined): { name: string; inputSchema: unknown }[] {
  const tools = field(result, "tools");
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => ({
    name: typeof field(tool, "name") === "string" ? (field(tool, "name") as string) : "",
    inputSchema: field(tool, "inputSchema"),
  }));
}

describe("the MCP server", () => {
  test("initialize answers with the version the client asked for", () => {
    const response = ask({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect(field(response?.result, "protocolVersion")).toBe("2025-06-18");
    expect(field(field(response?.result, "serverInfo"), "name")).toBe("texteda");
    expect(field(response?.result, "capabilities")).toBeDefined();
  });

  test("initialize without a known version answers with the newest one", () => {
    const response = ask({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect(field(response?.result, "protocolVersion")).toBe(MCP_PROTOCOL_VERSIONS[0]);
  });

  test("a request for a version the server does not speak is refused", () => {
    const response = ask({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { _meta: { "io.modelcontextprotocol/protocolVersion": "1999-01-01" } },
    });
    expect(response?.error?.code).toBe(-32022);
    expect(JSON.stringify(response?.error)).toContain("2026-07-28");
  });

  test("server/discover lists the versions the server speaks", () => {
    const response = ask({ jsonrpc: "2.0", id: 1, method: "server/discover" });
    expect(field(response?.result, "supportedVersions")).toEqual([...MCP_PROTOCOL_VERSIONS]);
  });

  test("tools/list is the catalogue", () => {
    const response = ask({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = toolsOf(response?.result);
    expect(tools.map((tool) => tool.name)).toEqual(toolCatalogue().map((tool) => tool.name));
    expect(tools[0]?.inputSchema).toEqual(toolCatalogue()[0]?.parameters);
  });

  test("the tool list is what the MCP projection of the catalogue holds", () => {
    expect(mcpTools().length).toBe(toolCatalogue().length);
  });

  test("the results that list things carry the cache fields the newer revision requires", () => {
    for (const method of ["tools/list", "server/discover"]) {
      const response = ask({ jsonrpc: "2.0", id: 1, method });
      expect(field(response?.result, "ttlMs")).toBe(3_600_000);
      expect(field(response?.result, "cacheScope")).toBe("public");
    }
  });

  test("a notification gets no answer", () => {
    expect(ask({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });

  test("an unknown method is a protocol error", () => {
    const response = ask({ jsonrpc: "2.0", id: 1, method: "tools/nope" });
    expect(response?.error?.code).toBe(-32601);
  });

  test("an unknown tool is a protocol error", () => {
    const response = ask({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "texteda_nope" } });
    expect(response?.error?.code).toBe(-32602);
  });

  test("a tool that cannot do its work is a tool execution error", () => {
    const response = ask({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "texteda_view_metrics", arguments: {} },
    });
    expect(field(response?.result, "isError")).toBe(true);
    expect(JSON.stringify(field(response?.result, "content"))).toContain("required");
  });

  test("a check that found errors hands the diagnostics back", () => {
    const response = ask({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "texteda_check",
        arguments: { project_dir: join(import.meta.dir, "../../..") },
      },
    });
    expect(field(response?.result, "isError")).toBe(true);
    expect(JSON.stringify(field(response?.result, "content"))).toContain("diagnostics");
  });

  test("a tool's value is the same value the command line prints", async () => {
    const proc = Bun.spawn(["bun", "run", script, "view", "metrics", project, "charger-buck/buck-5v", "--json"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const response = ask({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "texteda_view_metrics",
        arguments: { project_dir: project, board: "charger-buck", page: "buck-5v" },
      },
    });
    expect(field(response?.result, "structuredContent")).toEqual(JSON.parse(stdout));
  });
});

describe("texteda mcp", () => {
  test("the server answers on stdio", async () => {
    const proc = Bun.spawn(["bun", "run", script, "mcp"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    proc.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })}\n`,
    );
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
    proc.stdin.end();
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const lines = stdout.trim().split("\n").map((line) => JSON.parse(line) as Rpc);
    expect(lines).toHaveLength(2);
    expect(field(lines[0]?.result, "protocolVersion")).toBe("2025-06-18");
    expect(toolsOf(lines[1]?.result).length).toBeGreaterThan(0);
  });
});
