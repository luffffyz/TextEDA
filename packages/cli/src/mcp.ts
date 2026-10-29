// The MCP server: the same verbs, over a transport a host can speak.
//
// MCP is a transport, not a second implementation (ADR-0143 D5). The tools here are the
// catalogue's entries and nothing else: the server maps a call onto the same function the command
// line calls, and hands back the same value the command line prints with `--json`.
//
// The server is written here rather than taken from the SDK, because the slice we need is three
// methods and a line of JSON (ADR-0144 D1). The stdio transport is newline-delimited JSON on
// stdin and stdout; nothing goes to stderr but the server's own complaints.
//
// It speaks both eras of the protocol: the `initialize` handshake of the older revisions, and the
// `server/discover` probe of the newer one (ADR-0144 D2).
import { SUPPORTED_LANGUAGE, formatVersion } from "@texteda/parser";
import { findTool, toolCatalogue } from "./tools.ts";

/** The protocol revisions this server speaks, newest first. */
export const MCP_PROTOCOL_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

/** The JSON-RPC error codes this server uses. */
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
/** The modern revision's code for "I do not speak that version". */
const UNSUPPORTED_VERSION = -32022;

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

/** The server's identity: the name a host shows, and the version of the language it speaks. */
export function serverInfo(): { name: string; version: string } {
  return { name: "texteda", version: formatVersion(SUPPORTED_LANGUAGE) };
}

/** The tools as an MCP client sees them: the catalogue, under the names MCP uses. */
export function mcpTools(): unknown[] {
  return toolCatalogue().map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
  }));
}

/** The protocol version a request carries in its metadata; the newer revision's way of saying it. */
function requestedVersion(request: JsonRpcRequest): string | undefined {
  const params = request.params as { _meta?: Record<string, unknown> } | undefined;
  const meta = params?._meta?.["io.modelcontextprotocol/protocolVersion"];
  return typeof meta === "string" ? meta : undefined;
}

/** The protocol version the older revision's handshake asks for. */
function handshakeVersion(request: JsonRpcRequest): string | undefined {
  const params = request.params as { protocolVersion?: unknown } | undefined;
  return typeof params?.protocolVersion === "string" ? params.protocolVersion : undefined;
}

/** Whether this server speaks a version. */
function speaks(version: string): boolean {
  return (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(version);
}

/** The error for a request whose version this server does not speak. */
function unsupportedVersion(requested: string): JsonRpcError {
  return {
    code: UNSUPPORTED_VERSION,
    message: "Unsupported protocol version",
    data: { supported: [...MCP_PROTOCOL_VERSIONS], requested },
  };
}

/** What a `tools/call` produced: an error the protocol reports, or a result the model reads. */
type ToolOutcome =
  | { readonly kind: "protocol-error"; readonly error: JsonRpcError }
  | { readonly kind: "result"; readonly result: Record<string, unknown> };

/** The result of `tools/call`: the tool's value, as text and as data. */
function callTool(name: unknown, args: unknown): ToolOutcome {
  if (typeof name !== "string") {
    return { kind: "protocol-error", error: { code: INVALID_PARAMS, message: "The tool name is missing" } };
  }
  const tool = findTool(name);
  if (tool === undefined) {
    return { kind: "protocol-error", error: { code: INVALID_PARAMS, message: `Unknown tool: ${name}` } };
  }
  const arguments_ = args !== undefined && args !== null && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const result = tool.run(arguments_);
  if (!result.ok) {
    // A tool that could not do its work is a tool execution error: the model can read it and try
    // again with different arguments.
    return {
      kind: "result",
      result: {
        content: [{ type: "text", text: result.error ?? "The tool could not do its work" }],
        isError: true,
      },
    };
  }
  const value = result.value;
  return {
    kind: "result",
    result: {
      content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
      structuredContent: value,
      isError: false,
    },
  };
}

/**
 * Handle one request.
 *
 * Returns the response, or nothing for a notification — a notification has no id and gets no
 * answer.
 */
export function handleMcpRequest(request: unknown): JsonRpcResponse | null {
  if (typeof request !== "object" || request === null) {
    return { jsonrpc: "2.0", id: null, error: { code: INVALID_PARAMS, message: "Not a JSON-RPC request" } };
  }
  const message = request as JsonRpcRequest;
  const id = (typeof message.id === "string" || typeof message.id === "number" ? message.id : null) as
    | string
    | number
    | null;
  const method = typeof message.method === "string" ? message.method : undefined;
  if (method === undefined) {
    return { jsonrpc: "2.0", id, error: { code: INVALID_PARAMS, message: "The request has no method" } };
  }
  // A notification carries no id; it gets no answer.
  if (message.id === undefined) return null;

  // The newer revision puts the version in the request's metadata and refuses a version it does
  // not speak; the older revision's handshake asks for one and is answered with another.
  const asked = requestedVersion(message);
  if (asked !== undefined && !speaks(asked)) {
    return { jsonrpc: "2.0", id, error: unsupportedVersion(asked) };
  }

  const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown; cursor?: unknown };
  switch (method) {
    case "initialize": {
      // The older revisions open with a handshake; the server answers with the version it will
      // speak: the one the client asked for when it is one we know, the newest we know otherwise.
      const wanted = handshakeVersion(message);
      const protocolVersion = wanted !== undefined && speaks(wanted) ? wanted : MCP_PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: "2.0",
        id,
        result: {
          resultType: "complete",
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: serverInfo(),
        },
      };
    }
    case "server/discover": {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          resultType: "complete",
          supportedVersions: [...MCP_PROTOCOL_VERSIONS],
          capabilities: { tools: { listChanged: false } },
          _meta: { "io.modelcontextprotocol/serverInfo": serverInfo() },
          instructions:
            "TextEDA's verbs: validate a project, measure a print page, draw it, repair its wiring, read the IR, the connectivity, the BOM, and write the manufacturing files. The skills in docs/skills say when each one is the right move.",
        },
      };
    }
    case "tools/list": {
      return { jsonrpc: "2.0", id, result: { resultType: "complete", tools: mcpTools() } };
    }
    case "tools/call": {
      const outcome = callTool(params.name, params.arguments);
      if (outcome.kind === "protocol-error") return { jsonrpc: "2.0", id, error: outcome.error };
      return { jsonrpc: "2.0", id, result: { resultType: "complete", ...outcome.result } };
    }
    case "ping": {
      return { jsonrpc: "2.0", id, result: { resultType: "complete" } };
    }
    default: {
      return { jsonrpc: "2.0", id, error: { code: METHOD_NOT_FOUND, message: `Unknown method: ${method}` } };
    }
  }
}

/**
 * Run the server: read requests from stdin, write answers to stdout.
 *
 * One JSON object per line, in and out. The line is the frame — the stdio transport has no
 * headers and no length prefix.
 */
export async function runMcp(): Promise<number> {
  let buffer = "";
  const write = (response: JsonRpcResponse): void => {
    process.stdout.write(`${JSON.stringify(response)}\n`);
  };
  const answer = (line: string): void => {
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: INVALID_PARAMS, message: "Not JSON" } });
      return;
    }
    try {
      const response = handleMcpRequest(request);
      if (response !== null) write(response);
    } catch (error) {
      write({
        jsonrpc: "2.0",
        id: null,
        error: { code: INTERNAL_ERROR, message: error instanceof Error ? error.message : String(error) },
      });
    }
  };

  process.stdin.setEncoding("utf8");
  await new Promise<void>((resolve) => {
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) answer(line);
        newline = buffer.indexOf("\n");
      }
    });
    process.stdin.on("end", () => {
      const rest = buffer.trim();
      if (rest.length > 0) answer(rest);
      resolve();
    });
  });
  return 0;
}
