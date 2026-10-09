// Simple maths read as words: "x^2" → "x squared", "a/b" → "a over b",
// "≤" → "less than or equal to", "π" → "pi", "50%" → "50 percent".
// Full LaTeX/MathML is out of scope; this covers what shows up in lecture notes.

const SYMBOLS: [RegExp, string][] = [
  [/\s*≤\s*/g, ' less than or equal to '],
  [/\s*≥\s*/g, ' greater than or equal to '],
  [/\s*≠\s*/g, ' not equal to '],
  [/\s*≈\s*/g, ' approximately '],
  [/\s*±\s*/g, ' plus or minus '],
  [/\s*×\s*/g, ' times '],
  [/\s*÷\s*/g, ' divided by '],
  [/\s*→\s*/g, ' leads to '],
  [/∞/g, 'infinity'],
  [/π/g, 'pi'],
  [/Σ\s*/g, 'the sum of '],
  [/Δ\s*/g, 'the change in '],
  [/√\s*\(([^)]+)\)/g, 'the square root of $1'],
  [/√\s*(\w+)/g, 'the square root of $1'],
  [/(\d)\s*%/g, '$1 percent'],
];

const POWERS: Record<string, string> = { '2': 'squared', '3': 'cubed' };

export function mathToWords(text: string): string {
  let s = text;
  // Powers: x^2, (a+b)^3, e^-x, 10^6
  s = s.replace(/([\w)\]]+)\s*\^\s*\(?(-?[\w.]+)\)?/g, (_m, base: string, exp: string) => (POWERS[exp] ? `${base} ${POWERS[exp]}` : `${base} to the power of ${exp.replace(/^-/, 'minus ')}`));
  s = s.replace(/([\w)])²/g, '$1 squared').replace(/([\w)])³/g, '$1 cubed');
  for (const [re, words] of SYMBOLS) s = s.replace(re, words);
  // Comparisons and equals written with spaces around them (so URLs and arrows like "->" are left alone).
  s = s.replace(/ <= /g, ' less than or equal to ').replace(/ >= /g, ' greater than or equal to ');
  s = s.replace(/ = /g, ' equals ').replace(/ < /g, ' is less than ').replace(/ > /g, ' is greater than ');
  // Fractions between single letters or short numbers: "a/b", "1/2", "MC/MR". Not dates (1/2/2026) or words (and/or).
  // Only numbers, single letters or capital abbreviations count, so units like km/h stay as written.
  const term = /^(?:\d{1,3}(?:\.\d+)?|[A-Za-z]|[A-Z]{2})$/;
  s = s.replace(/(^|[^\w/])((?:\d{1,3}(?:\.\d+)?|[A-Za-z]{1,2}))\/((?:\d{1,3}(?:\.\d+)?|[A-Za-z]{1,2}))(?![\w/])/g, (m, pre: string, a: string, b: string) =>
    term.test(a) && term.test(b) ? `${pre}${a} over ${b}` : m,
  );
  return s.replace(/\s{2,}/g, ' ');
}

/** "Year 2020: GDP 1.2 trillion; Inflation 3 percent." for a table row with headers. */
export function tableRowWithHeaders(headers: string[], cells: string[]): string {
  if (!headers.length || headers.every((h) => !h.trim())) return cells.filter(Boolean).join(', ');
  return cells
    .map((c, i) => (c.trim() ? (headers[i]?.trim() ? `${headers[i].trim()}: ${c.trim()}` : c.trim()) : ''))
    .filter(Boolean)
    .join('; ');
}
