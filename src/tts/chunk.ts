// Split text into sentences, then pack sentences into groups of about 300
// characters for Kokoro (spec: "sentence groups of about 300 characters").

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e', 'cf', 'al', 'fig', 'no', 'vol',
  'ch', 'p', 'pp', 'approx', 'u.s', 'u.k', 'inc', 'ltd', 'co', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug',
  'sep', 'sept', 'oct', 'nov', 'dec',
]);

export function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const out: string[] = [];
  const re = /[.!?…]+["'”’)\]]*(?=\s+|$)/g;
  let start = 0;
  for (let m = re.exec(clean); m; m = re.exec(clean)) {
    const end = m.index + m[0].length;
    const before = clean.slice(start, m.index);
    const lastWord = before.split(/\s/).pop()?.toLowerCase() ?? '';
    const next = clean.slice(end).trimStart();
    const isAbbrev = m[0] === '.' && (ABBREVIATIONS.has(lastWord) || /^[a-z]$/i.test(lastWord));
    const nextLooksLikeContinuation = /^[a-z0-9,;:]/.test(next);
    if ((isAbbrev || nextLooksLikeContinuation) && next) continue;
    out.push(clean.slice(start, end).trim());
    start = end;
  }
  const rest = clean.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** Packs sentences into groups no longer than `max` characters, never splitting a sentence that fits. */
export function packGroups(sentences: string[], max = 300): string[] {
  const out: string[] = [];
  let cur = '';
  for (const s of sentences.flatMap((x) => (x.length > max ? splitLong(x, max) : [x]))) {
    if (cur && cur.length + 1 + s.length > max) {
      out.push(cur);
      cur = s;
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Breaks an over-long sentence at ; then , then spaces. */
function splitLong(sentence: string, max: number): string[] {
  for (const sep of [/(?<=;)\s+/, /(?<=,)\s+/, /\s+/]) {
    const parts = sentence.split(sep);
    if (parts.length < 2) continue;
    const out: string[] = [];
    let cur = '';
    for (const p of parts) {
      if (cur && cur.length + 1 + p.length > max) {
        out.push(cur);
        cur = p;
      } else {
        cur = cur ? `${cur} ${p}` : p;
      }
    }
    if (cur) out.push(cur);
    if (out.every((x) => x.length <= max)) return out;
    return out.flatMap((x) => (x.length > max ? splitLong(x, max) : [x]));
  }
  // One enormous "word" (a URL, say): hard cut.
  const out: string[] = [];
  for (let i = 0; i < sentence.length; i += max) out.push(sentence.slice(i, i + max));
  return out;
}

export function textToGroups(text: string, max = 300): string[] {
  return packGroups(splitSentences(text), max);
}
