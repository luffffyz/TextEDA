#!/usr/bin/env bun
// End-to-end smoke: the DSH plugin's two halves → bundles → what a host registers.
//
// The host itself is not here, so both sides of it are stood in for. The host half is copied next
// to a stub `@deepseek-ai/dsh-tools`, applied to a context that records the tools and the routes it
// registers. The client half is evaluated the way DSH evaluates a client module: a
// `window.__ModuleLoader__` collects the factory, a stub `require` supplies React, and the factory's
// exports are handed to a context that records the tab type and the slot registration.
//
// What this proves is the local half of the contract: both bundles load, both apply, the tools are
// the catalogue's, the routes are the two exact paths, the client half exports `inject` and
// `apply`, and the body it registers is a component the slot can call.
//
// Usage: bun run scripts/smoke-dsh-plugin.ts
// Artifacts are written under /tmp/texteda-dsh-smoke/.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DshTool } from "../packages/cli/src/dsh-tools.ts";
import { toolCatalogue } from "../packages/cli/src/tools.ts";

const root = resolve(import.meta.dir, "..");
const work = "/tmp/texteda-dsh-smoke";
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "node_modules/@deepseek-ai/dsh-tools"), { recursive: true });

const externals = ["@deepseek-ai/cordis", "@deepseek-ai/dsh-tools"];

// 0) build both halves, into the host half's shape and the client half's shape
const hostBuild = await Bun.build({
  entrypoints: [join(root, "plugins/dsh-texteda/host.ts")],
  outdir: join(work, "plugin"),
  target: "node",
  format: "esm",
  external: externals,
  naming: "host.mjs",
});
if (!hostBuild.success) {
  for (const log of hostBuild.logs) console.error(String(log));
  console.error("the host half did not build");
  process.exit(1);
}
console.log(`[0] host half: ${hostBuild.outputs[0]?.path} — ${hostBuild.outputs[0]?.size} bytes`);

const clientBuild = await Bun.build({
  entrypoints: [join(root, "plugins/dsh-texteda/client.ts")],
  outdir: join(work, "client"),
  target: "browser",
  format: "cjs",
  external: ["react", "react/jsx-runtime", ...externals],
  naming: "client.js",
  intro: "var module = { exports: {} }; var exports = module.exports;",
  banner: 'window.__ModuleLoader__.load({ id: "@texteda/dsh-plugin", factory: (require) => {',
  footer: "return module.exports; } });",
});
if (!clientBuild.success) {
  for (const log of clientBuild.logs) console.error(String(log));
  console.error("the client half did not build");
  process.exit(1);
}
console.log(`[1] client half: ${clientBuild.outputs[0]?.path} — ${clientBuild.outputs[0]?.size} bytes`);

// 1) stand in for the host's package
writeFileSync(
  join(work, "node_modules/@deepseek-ai/dsh-tools/package.json"),
  JSON.stringify({ name: "@deepseek-ai/dsh-tools", version: "0.0.0", type: "module", main: "index.js" }),
);
writeFileSync(
  join(work, "node_modules/@deepseek-ai/dsh-tools/index.js"),
  "export const defineTool = (definition) => definition;\n",
);

// 2) apply the host half to a context that records the registrations
// The bundle lives in a temporary directory, so it can only be reached by a runtime path.
// The bundle is the artifact a host loads, and it carries the constants the client half must
// agree with: read them from there, not from the source, so the smoke checks what ships.
const plugin = (await import(join(work, "plugin/host.mjs"))) as {
  MODEL_PATH: string;
  PLACES_PATH: string;
  inject: readonly string[];
  apply: (ctx: unknown) => void;
};
const MODEL_PATH = plugin.MODEL_PATH;
const PLACES_PATH = plugin.PLACES_PATH;
const hostInject = plugin.inject;
const registered: DshTool[] = [];
const routes: { path: string; methods: readonly string[]; requestBody: string }[] = [];
const disposers: (() => void)[] = [];
const hostContext = {
  effect: (callback: () => () => void, _label: string) => {
    disposers.push(callback());
  },
  tools: { register: (definition: DshTool) => registered.push(definition) },
  sessions: { get: (_id: string) => undefined },
  connection: {
    fetch: {
      register: (route: { path: string; methods: readonly string[]; requestBody: string }) => {
        routes.push(route);
        return () => {};
      },
    },
  },
};
plugin.apply(hostContext);

const catalogue = toolCatalogue();
const names = registered.map((tool) => tool.name);
const expected = catalogue.map((tool) => tool.name);
if (JSON.stringify(names) !== JSON.stringify(expected)) {
  console.error(`the plugin registered ${names.join(", ")}; the catalogue holds ${expected.join(", ")}`);
  process.exit(1);
}
console.log(`[2] tools: ${names.join(", ")}`);

// The routes: exactly the two the client half posts to, one method each, both exact paths.
const paths = routes.map((route) => route.path);
if (JSON.stringify(paths) !== JSON.stringify([MODEL_PATH, PLACES_PATH])) {
  console.error(`the plugin registered ${paths.join(", ")}; the client half posts to ${MODEL_PATH}, ${PLACES_PATH}`);
  process.exit(1);
}
const methodOf = (path: string) => routes.find((route) => route.path === path)?.methods;
if (JSON.stringify(methodOf(MODEL_PATH)) !== JSON.stringify(["GET"])) {
  console.error(`${MODEL_PATH} answers ${JSON.stringify(methodOf(MODEL_PATH))}; it must be GET only`);
  process.exit(1);
}
if (JSON.stringify(methodOf(PLACES_PATH)) !== JSON.stringify(["POST"])) {
  console.error(`${PLACES_PATH} answers ${JSON.stringify(methodOf(PLACES_PATH))}; it must be POST only`);
  process.exit(1);
}
// Every segment must match DSH's endpoint pattern, which has no wildcard: the session travels in
// the query string instead of the path (`/^[A-Za-z0-9_$.-]+$/` per segment).
for (const path of paths) {
  for (const segment of path.split("/").slice(1)) {
    if (!/^[A-Za-z0-9_$.-]+$/.test(segment)) {
      console.error(`${path} has the segment "${segment}", which DSH's exact-route pattern refuses`);
      process.exit(1);
    }
  }
}
console.log(`[3] routes: ${paths.map((path) => `${methodOf(path)?.join("|")} ${path}`).join(", ")}`);

// The host half's inject list names the services the apply above actually used.
if (!Array.isArray(hostInject) || !["tools", "sessions", "connection"].every((name) => hostInject.includes(name))) {
  console.error(`the host half injects ${JSON.stringify(hostInject)}; it needs tools, sessions and connection`);
  process.exit(1);
}
console.log(`[4] host inject: ${hostInject.join(", ")}`);

// 3) the tools take the catalogue's arguments and answer with its values
const check = registered.find((tool) => tool.name === "texteda_check");
if (check === undefined) {
  console.error("the plugin did not register texteda_check");
  process.exit(1);
}
const required = Object.entries(check.parameters)
  .filter(([, spec]) => spec.required === true)
  .map(([name]) => name);
if (JSON.stringify(required) !== JSON.stringify(catalogue[0]?.parameters.required)) {
  console.error(`the check tool requires ${required.join(", ")}; the catalogue requires ${catalogue[0]?.parameters.required?.join(", ")}`);
  process.exit(1);
}
console.log(`[5] arguments: texteda_check requires ${required.join(", ")}`);

const value = await check.execute({ project_dir: join(root, "examples/reference-project") });
if (typeof value !== "object" || value === null || !("diagnostics" in value)) {
  console.error("the check tool did not hand back the diagnostics");
  process.exit(1);
}
const diagnostics = value.diagnostics;
console.log(`[6] value: ${Array.isArray(diagnostics) ? diagnostics.length : 0} diagnostics`);

// 4) evaluate the client half the way the host does, and apply it
const loader = { loaded: undefined as { id: string; factory: (require: (specifier: string) => unknown) => unknown } | undefined };
(globalThis as { window?: unknown }).window = {
  __ModuleLoader__: {
    load: (entry: { id: string; factory: (require: (specifier: string) => unknown) => unknown }) => {
      loader.loaded = entry;
    },
  },
} as never;

// A stub React: one object with what the client half calls, so the bundle's `require("react")`
// resolves to it and nothing else is reachable.
const reactStub = {
  createElement: (type: string, props: unknown, ...children: unknown[]) => ({ type, props, children }),
  useEffect: () => {},
  useRef: (initial: unknown) => ({ current: initial ?? null }),
  useState: (initial: unknown) => [initial, () => {}],
};
const requireStub = (specifier: string): unknown => {
  if (specifier === "react") return reactStub;
  throw new Error(`the client half required "${specifier}", which the smoke does not supply`);
};
await import(join(work, "client/client.js"));
if (loader.loaded === undefined) {
  console.error("the client bundle did not register itself with the module loader");
  process.exit(1);
}
const client = loader.loaded.factory(requireStub) as {
  inject?: unknown;
  apply?: unknown;
};
if (!Array.isArray(client.inject) || !client.inject.includes("slots") || !client.inject.includes("sidebarRightTabs")) {
  console.error(`the client half injects ${JSON.stringify(client.inject)}; it needs slots and sidebarRightTabs`);
  process.exit(1);
}
if (typeof client.apply !== "function") {
  console.error("the client half does not export apply");
  process.exit(1);
}

const tabTypes: { id: string; kind: string }[] = [];
const slotRegistrations: { name: string; key: string; component: unknown }[] = [];
const clientContext = {
  effect: (callback: () => () => void, _label: string) => {
    disposers.push(callback());
  },
  sidebarRightTabs: {
    register: (definition: { id: string; kind: string }) => {
      tabTypes.push(definition);
      return () => {};
    },
  },
  slots: {
    inject: (_name: string, register: () => () => void) => register(),
    register: (options: { name: string; key: string }, component: unknown) => {
      slotRegistrations.push({ name: options.name, key: options.key, component });
      return () => {};
    },
  },
};
(client.apply as (ctx: unknown) => void)(clientContext);

if (tabTypes.length !== 1) {
  console.error(`the client half registered ${tabTypes.length} tab types; it must register one`);
  process.exit(1);
}
const tab = tabTypes[0]!;
if (tab.kind === "" || tab.id === "") {
  console.error("the client half registered a tab type with an empty id or kind");
  process.exit(1);
}
const body = slotRegistrations.find((registration) => registration.name === "sidebar.right.pane.tab");
if (body === undefined) {
  console.error("the client half did not register a sidebar.right.pane.tab body");
  process.exit(1);
}
// The body's seat must carry the tab type's own identity: a chip whose body is registered under
// another key renders nothing.
if (body.key !== tab.id) {
  console.error(`the body registers under "${body.key}" but the tab type is "${tab.id}"`);
  process.exit(1);
}
console.log(`[7] client: tab ${tab.kind} (${tab.id}), body under ${body.name}/${body.key}`);

// The body is a component: calling it with the session props a tab body receives must not throw,
// and it must hand back an element to draw into.
const rendered = (body.component as (props: { sessionId: string }) => unknown)({ sessionId: "session-1" });
if (typeof rendered !== "object" || rendered === null || (rendered as { type?: unknown }).type !== "div") {
  console.error("the tab body did not return a host element to draw into");
  process.exit(1);
}
console.log("[8] body renders a host element");

console.log("smoke ok");
