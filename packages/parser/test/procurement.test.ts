// Unit tests for `procurement` parsing.
//
// The positive case is a real procurement file; the negative cases break exactly one thing each
// and the diagnostic code must line up.
import { describe, expect, test } from "bun:test";
import { validate } from "@texteda/ir";
import { formatProcurement } from "../src/fmt-procurement.ts";
import { parseProcurement, parseProcurementDocument } from "../src/procurement.ts";
import type { ComponentResolver } from "../src/schematic.ts";

const file = "assets/procurement/primary/charger-buck.teda";

/** The generic the selection rows name: value, tolerance, power (the last one optional). */
const generic = {
  params: [
    { name: "value", type: "resistance" as const, required: true, line: 1, col: 1 },
    { name: "tolerance", type: "percent" as const, required: true, line: 2, col: 1 },
    { name: "power", type: "power" as const, required: false, line: 3, col: 1 },
  ],
  pins: [],
};

const components: ComponentResolver = {
  resolve: (id) => (id === "res-thick-0402" ? generic : undefined),
};

const SOURCE = `version 0.9
procurement charger-buck
role primary

selections
  res-thick-0402 10k ±1% -> rc0402fr-0710kl
`;

describe("procurement parsing", () => {
  test("parses a procurement file into the IR shard", () => {
    const result = parseProcurement(SOURCE, {
      file,
      board: "charger-buck",
      role: "primary",
      components,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    const ir = result.ir!;
    expect(ir.ir_version).toBe("0.9");
    expect(ir.format).toBe("0.9");
    expect(ir.procurement.board).toBe("charger-buck");
    expect(ir.procurement.role).toBe("primary");
    expect(ir.procurement.selections).toHaveLength(1);
    const selection = ir.procurement.selections[0]!;
    expect(selection.generic).toBe("res-thick-0402");
    expect(selection.part).toBe("rc0402fr-0710kl");
    // The values are typed by the generic's declared parameters: 10kΩ in µΩ, 1% in ppm.
    expect(selection.params).toEqual([
      { name: "value", value: 10_000_000_000 },
      { name: "tolerance", value: 10_000 },
    ]);
    expect(validate("procurement", ir).ok).toBe(true);
  });

  test("a line that needs nothing bought carries the reserved target", () => {
    // `not-required` is not a device id: it says there is nothing to order for the line, which is
    // different from "nobody has ordered it yet" (ADR-0030, 2026-10-22b appendix).
    const text = SOURCE.replace("-> rc0402fr-0710kl", "-> not-required");
    const result = parseProcurement(text, {
      file,
      board: "charger-buck",
      role: "primary",
      components,
    });
    expect(result.diagnostics).toEqual([]);
    const selection = result.ir!.procurement.selections[0]!;
    expect(selection.part).toBeUndefined();
    expect(selection.not_required).toBe(true);
    expect(validate("procurement", result.ir!).ok).toBe(true);
  });

  test("the row keeps the requirement, not the part's own values", () => {
    // The left side is what the design needs; the right side is what is bought. The two are
    // different facts and the IR keeps them apart (spec/procurement.md §3.3).
    const result = parseProcurement(SOURCE, {
      file,
      board: "charger-buck",
      role: "primary",
      components,
    });
    const selection = result.ir!.procurement.selections[0]!;
    expect(selection.params?.map((p) => p.name)).toEqual(["value", "tolerance"]);
  });

  test("a library-qualified part id is kept as written", () => {
    const result = parseProcurement(
      `version 0.9
procurement charger-buck
role alternatives

selections
  res-thick-0402 10k ±1% -> vishay:rc0402fr-0710kl
`,
      { file, board: "charger-buck", role: "alternatives", components },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.ir!.procurement.selections[0]!.part).toBe("vishay:rc0402fr-0710kl");
  });

  test("rejects a file whose version is below the type's", () => {
    const result = parseProcurement(
      `version 0.8
procurement charger-buck
role primary
`,
      { file, board: "charger-buck", role: "primary", components },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("format.unsupported-version");
  });

  test("rejects a role that disagrees with the position", () => {
    const result = parseProcurement(
      `version 0.9
procurement charger-buck
role alternatives
`,
      { file, board: "charger-buck", role: "primary", components },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("format.role-invalid");
  });

  test("rejects a role that is not a role", () => {
    const result = parseProcurement(
      `version 0.9
procurement charger-buck
role secondary
`,
      { file, board: "charger-buck", role: "primary", components },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("format.role-invalid");
  });

  test("rejects a board id that disagrees with the file name", () => {
    const result = parseProcurement(
      `version 0.9
procurement mcu-board
role primary
`,
      { file, board: "charger-buck", role: "primary", components },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("ref.board-id-mismatch");
  });

  test("rejects a row without the arrow", () => {
    const result = parseProcurement(
      `version 0.9
procurement charger-buck
role primary

selections
  res-thick-0402 10k ±1% rc0402fr-0710kl
`,
      { file, board: "charger-buck", role: "primary", components },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("syntax.selection-invalid");
  });

  test("rejects a row with two arrows", () => {
    const result = parseProcurement(
      `version 0.9
procurement charger-buck
role primary

selections
  res-thick-0402 10k -> -> rc0402fr-0710kl
`,
      { file, board: "charger-buck", role: "primary", components },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("syntax.selection-invalid");
  });

  test("rejects a generic that does not resolve", () => {
    const result = parseProcurement(
      `version 0.9
procurement charger-buck
role primary

selections
  res-thin-0402 10k ±1% -> rc0402fr-0710kl
`,
      { file, board: "charger-buck", role: "primary", components },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("ref.unknown-generic");
  });

  test("rejects a row with more parameter columns than the generic declares", () => {
    const result = parseProcurement(
      `version 0.9
procurement charger-buck
role primary

selections
  res-thick-0402 10k ±1% 100mW 1W -> rc0402fr-0710kl
`,
      { file, board: "charger-buck", role: "primary", components },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("value.param-count-mismatch");
  });

  test("rejects a required parameter column that is missing", () => {
    const result = parseProcurement(
      `version 0.9
procurement charger-buck
role primary

selections
  res-thick-0402 10k -> rc0402fr-0710kl
`,
      { file, board: "charger-buck", role: "primary", components },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("value.param-count-mismatch");
  });

  test("rejects the same BOM line twice in the primary file", () => {
    const result = parseProcurement(
      `version 0.9
procurement charger-buck
role primary

selections
  res-thick-0402 10k ±1% -> rc0402fr-0710kl
  res-thick-0402 10k ±1% -> crc0402fr-0710kl
`,
      { file, board: "charger-buck", role: "primary", components },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("syntax.duplicate-key");
  });

  test("the same BOM line twice is what the alternatives file is for", () => {
    const result = parseProcurement(
      `version 0.9
procurement charger-buck
role alternatives

selections
  res-thick-0402 10k ±1% -> rc0402fr-0710kl
  res-thick-0402 10k ±1% -> crc0402fr-0710kl
`,
      { file, board: "charger-buck", role: "alternatives", components },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.ir!.procurement.selections).toHaveLength(2);
  });

  test("rejects an unknown section", () => {
    const result = parseProcurement(
      `version 0.9
procurement charger-buck
role primary

bom
  res-thick-0402 10k ±1% -> rc0402fr-0710kl
`,
      { file, board: "charger-buck", role: "primary", components },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe("syntax.unknown-section");
  });
});

describe("procurement canonical form", () => {
  test("sorts the rows by the left key as text and keeps the columns unaligned", () => {
    // The key is compared as text, so "100k" comes before "10k" (spec/procurement.md §6). The IR
    // sorts the resolved values numerically, so the two may order the rows differently.
    const result = formatProcurement(
      `version 0.9
procurement charger-buck
role primary

selections
  res-thick-0402 10k ±1% -> rc0402fr-0710kl
  res-thick-0402 100k ±1% -> rc0402fr-0710kl
`,
      { file },
    );
    expect(result.ok).toBe(true);
    expect(result.text).toBe(
      `version 0.9
procurement charger-buck
role primary

selections
  res-thick-0402 100k ±1% -> rc0402fr-0710kl
  res-thick-0402 10k ±1% -> rc0402fr-0710kl
`,
    );
  });

  test("is idempotent", () => {
    const first = formatProcurement(SOURCE, { file });
    expect(first.ok).toBe(true);
    const second = formatProcurement(first.text!, { file });
    expect(second.ok).toBe(true);
    expect(second.text).toBe(first.text);
  });

  test("produces no output for a file with errors", () => {
    const result = formatProcurement(
      `version 0.9
procurement charger-buck
role primary

selections
  res-thick-0402 10k ±1% rc0402fr-0710kl
`,
      { file },
    );
    expect(result.ok).toBe(false);
    expect(result.text).toBeUndefined();
  });
});

describe("the document level", () => {
  test("reads the rows as they are written, without the project around them", () => {
    const result = parseProcurementDocument(SOURCE, { file });
    expect(result.ok).toBe(true);
    expect(result.document!.board).toBe("charger-buck");
    expect(result.document!.role).toBe("primary");
    expect(result.document!.selections[0]!.paramCells).toEqual(["10k", "±1%"]);
  });
});
