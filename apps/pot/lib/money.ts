/**
 * Test Rupee has 2 decimals: 1 unit = 1 paisa, so ₹1,200 is 120000 units.
 * Everything in the UI is rupees; everything on the wire is paise.
 */
export const PAISE = 100n;

/** "1200" or "1200.50" (user input, rupees) -> paise. Throws on nonsense. */
export function rupeesToPaise(input: string): bigint {
  const cleaned = input.replace(/[₹,\s]/g, "");
  if (!/^\d*(\.\d{0,2})?$/.test(cleaned) || cleaned === "" || cleaned === ".") {
    throw new Error("Enter an amount like 1200 or 1200.50");
  }
  const [whole, frac = ""] = cleaned.split(".");
  return BigInt(whole || "0") * PAISE + BigInt(frac.padEnd(2, "0"));
}

/** paise -> "₹1,200" / "₹1,200.50" (paise shown only when non-zero). */
export function formatRupees(paise: bigint): string {
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const whole = abs / PAISE;
  const frac = abs % PAISE;
  const grouped = whole.toLocaleString("en-IN");
  const tail = frac === 0n ? "" : `.${frac.toString().padStart(2, "0")}`;
  return `${neg ? "-" : ""}₹${grouped}${tail}`;
}

/** Plain number of rupees, for inputs that round-trip. */
export function paiseToRupeeString(paise: bigint): string {
  const whole = paise / PAISE;
  const frac = paise % PAISE;
  return frac === 0n
    ? whole.toString()
    : `${whole}.${frac.toString().padStart(2, "0")}`;
}
