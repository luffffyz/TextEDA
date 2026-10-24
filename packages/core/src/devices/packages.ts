// The power a chip resistor's package gives it (ADR-0045).
//
// Device engineering knowledge, not language structure — the same reasoning that keeps the
// construction vocabulary here (ADR-0038 D7). The numbers are the **standard, thick-film** ratings
// of the JEDEC chip sizes, which is the lowest grade a part of that size is sold at: every other
// film of the same size is rated the same or higher. That is what makes the number usable as a
// floor — a dissipation above it is above what *any* part of the size is guaranteed to take, so a
// violation is certain, never a false alarm caused by the check guessing a part.
//
// The floor is consulted only when neither the design nor the part narrowed the part class
// (`checkDissipation`): a line that requires `power 1W` on a 2010 bought a 1W part, and the
// package convention does not get to second-guess it.
//
// Spellings are JEDEC (imperial) only: `0402`, not the IEC metric `1005`
// (`spec/footprint.md` §2). An IEC spelling is not an error — it is simply a package this table
// does not know, and an unknown package is counted as "not compared", never as a pass.

/** Microwatts, the canonical unit for power (ADR-0008 decision 4). */
const CHIP_RESISTOR_POWER: Readonly<Record<string, number>> = {
  "0201": 50_000, // 1/20 W
  "0402": 62_500, // 1/16 W
  "0603": 100_000, // 1/10 W
  "0805": 125_000, // 1/8 W
  "1206": 250_000, // 1/4 W
  "1210": 500_000, // 1/2 W
  "2010": 750_000, // 3/4 W
  "2512": 1_000_000, // 1 W
};

/** The constructions a chip resistor is sold in; only these have a package floor. */
const CHIP_RESISTOR_CONSTRUCTIONS: readonly string[] = ["thick", "thin"];

/**
 * The floor a chip resistor's package guarantees, in microwatts.
 *
 * `undefined` means "this table does not know that package": either the construction is not a
 * chip resistor (a 0402 MLCC has no power rating) or the code is not a JEDEC size this table
 * carries. The caller counts it as not compared.
 */
export function packagePowerRating(
  construction: string | undefined,
  packageCode: string | undefined,
): number | undefined {
  if (construction === undefined || packageCode === undefined) return undefined;
  if (!CHIP_RESISTOR_CONSTRUCTIONS.includes(construction)) return undefined;
  return CHIP_RESISTOR_POWER[packageCode];
}

/** The package codes the floor is stated for, in size order (for diagnostics and docs). */
export function chipResistorPackages(): readonly string[] {
  return Object.keys(CHIP_RESISTOR_POWER);
}
