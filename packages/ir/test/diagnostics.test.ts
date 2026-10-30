// Contract test of the diagnostics payload (ADR-0003).
//
// The payload is for agent consumption: stable shape, default fields omitted (never null), counted by severity.
import { describe, expect, test } from "bun:test";
import { diagnosticsToPayload, formatDiagnostic, stageOf, type Diagnostic } from "../src/diagnostics/index.ts";
import { DIAGNOSTIC_CODE_IDS } from "../src/diagnostics/codes.ts";

const withLocation: Diagnostic = {
  code: "net.pin-in-two-nets",
  severity: "error",
  message: "U1.3 belongs to both net A and net B",
  location: { file: "sch/b.teda", line: 42, col: 12 },
};

describe("diagnostics payload", () => {
  test("default fields are omitted, never null", () => {
    const payload = diagnosticsToPayload([withLocation]);
    expect(Object.keys(payload.diagnostics[0]!)).not.toContain("expected");
    expect(Object.keys(payload.diagnostics[0]!)).not.toContain("data");
  });

  test("fix hint is filled in from the registry (ADR-0003)", () => {
    const payload = diagnosticsToPayload([withLocation]);
    expect(payload.diagnostics[0]!.hint).toBe("A pin may belong to only one net; remove the extra member");
  });

  test("a more specific hint from the call site wins", () => {
    const payload = diagnosticsToPayload([
      { ...withLocation, hint: "Remove this pin from net B" },
    ]);
    expect(payload.diagnostics[0]!.hint).toBe("Remove this pin from net B");
  });

  test("counts by severity", () => {
    const payload = diagnosticsToPayload([
      withLocation,
      { code: "net.pin-unassigned", severity: "warning", message: "not connected" },
      { code: "drc.single-member-net", severity: "note", message: "only one member" },
    ]);
    expect(payload.errorCount).toBe(1);
    expect(payload.warningCount).toBe(1);
    expect(payload.noteCount).toBe(1);
  });

  test("human-readable format: file:line:col when a location exists, none otherwise", () => {
    expect(formatDiagnostic(withLocation)).toBe(
      "sch/b.teda:42:12: error net.pin-in-two-nets: U1.3 belongs to both net A and net B",
    );
    expect(formatDiagnostic({ code: "contract.schema-violation", severity: "error", message: "x" })).toBe(
      "error contract.schema-violation: x",
    );
  });
});

describe("stage classification (F19)", () => {
  test("the domain decides the stage: parse / contract / design", () => {
    expect(stageOf("syntax.row-too-short")).toBe("parse");
    expect(stageOf("ref.unknown-component")).toBe("parse");
    expect(stageOf("value.length-invalid")).toBe("parse");
    expect(stageOf("contract.schema-violation")).toBe("contract");
    expect(stageOf("net.pin-in-two-nets")).toBe("semantic");
    expect(stageOf("drc.single-member-net")).toBe("semantic");
  });

  test("payload counts by stage, all three keys always present", () => {
    const payload = diagnosticsToPayload([
      withLocation,
      { code: "syntax.row-too-short", severity: "error", message: "not enough columns" },
      { code: "net.pin-unassigned", severity: "warning", message: "not connected" },
    ]);
    expect(payload.countsByStage).toEqual({ parse: 1, contract: 0, semantic: 2 });
  });

  test("every code has a stage", () => {
    for (const code of DIAGNOSTIC_CODE_IDS) {
      expect(["parse", "contract", "semantic"]).toContain(stageOf(code));
    }
  });
});
