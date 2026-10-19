/** How a table lays itself out, from its data alone. */

const NUMBER = /^[+−-]?\d[\d,.]*\s*(%|°)?$/;

/** A column of numbers (or numbers written as text, like "-4" or "12%"), set right-aligned. */
export function isNumericColumn(rows: (string | number)[][], c: number): boolean {
  const cells = rows.map((r) => r[c]).filter((v) => v !== undefined && v !== '');
  return cells.length > 0 && cells.every((v) => typeof v === 'number' || NUMBER.test(v!.trim()));
}

/** Whether the first column is already the row's position: 1, 2, 3… under "Pos", "#" or similar. */
export function ranksItself(header: string, rows: (string | number)[][]): boolean {
  const ordinal = rows.every((r, i) => String(r[0]).trim().replace(/\.$/, '') === String(i + 1));
  return ordinal && /^(#|no\.?|pos(ition)?|rank|place|)$/i.test(header.trim());
}
