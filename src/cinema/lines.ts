/**
 * A spoken line shown as `n` subtitles one after another (the camera cuts between them, owner 2026-10-18). The full line
 * stays the caption's text, so its translation is looked up whole and split in the reader's language.
 */
export function splitLine(text: string, n: number): string[] {
  if (n <= 1) return [text];
  const sentences = text.split(/(?<=[.!?。])\s+/).filter(Boolean);
  if (sentences.length >= n) {
    // Consecutive groups of about equal length.
    const total = text.length;
    const out: string[] = [];
    let cur: string[] = [];
    let done = 0;
    for (const [i, s] of sentences.entries()) {
      cur.push(s);
      done += s.length;
      const left = sentences.length - i - 1;
      const need = n - out.length - 1;
      if (need > 0 && (done >= (total * (out.length + 1)) / n || left === need)) {
        out.push(cur.join(' '));
        cur = [];
      }
    }
    if (cur.length) out.push(cur.join(' '));
    return out;
  }
  // Fewer sentences than pieces: the longest piece splits at the comma (else the space) nearest its middle.
  const out = [...sentences];
  while (out.length < n) {
    let i = 0;
    for (let k = 1; k < out.length; k += 1) if (out[k]!.length > out[i]!.length) i = k;
    const s = out[i]!;
    const mid = s.length / 2;
    let at = -1;
    for (const re of [/[,，、;]\s*/g, /\s+/g]) {
      for (const m of s.matchAll(re)) if (m.index! > 2 && m.index! < s.length - 3 && (at < 0 || Math.abs(m.index! - mid) < Math.abs(at - mid))) at = m.index! + m[0].length;
      if (at > 0) break;
    }
    if (at < 0) break;
    out.splice(i, 1, s.slice(0, at).trim(), s.slice(at).trim());
  }
  return out;
}
