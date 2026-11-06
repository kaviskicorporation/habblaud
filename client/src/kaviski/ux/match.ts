// Fork Kaviski (KAVISKI.md, "Detalhes de UX"): busca da Busca rápida (Ctrl+K) — sem diferença de acento nem de
// maiúscula, a palavra que começa vale mais que o meio, e as letras na ordem ("cfe" acha "café") ainda acham. Puro.

/** "Café da Manhã" → "cafe da manha". */
export function kvFold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Nota de `text` para a busca `q` (0 = não serve). Começo do texto 100, começo de palavra 70, no meio 40, letras na
 * ordem 10; textos mais curtos ganham um pouco. Cada palavra da busca precisa achar algo.
 */
export function kvMatchScore(q: string, text: string): number {
  const t = kvFold(text);
  const words = kvFold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  let total = 0;
  for (const w of words) {
    let s = 0;
    if (t.startsWith(w)) s = 100;
    else if (new RegExp(`(^|[\\s·/()\\-_.,:])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)) s = 70;
    else if (t.includes(w)) s = 40;
    else if (subsequence(w, t)) s = 10;
    if (!s) return 0;
    total += s;
  }
  return total / words.length + Math.max(0, 20 - t.length / 4);
}

/** As letras de `w` aparecem em `t` na ordem e perto umas das outras ("cfe" em "cafe"; não "caf" em "company floor"). */
function subsequence(w: string, t: string): boolean {
  if (w.length < 2) return false;
  for (let start = t.indexOf(w[0]!); start >= 0; start = t.indexOf(w[0]!, start + 1)) {
    let i = 1;
    let j = start + 1;
    for (; j < t.length && i < w.length && j - start <= w.length * 2; j++) if (t[j] === w[i]) i++;
    if (i >= w.length) return true;
  }
  return false;
}

/** Onde marcar a busca no texto (início/fim em `text`), ou null. Só o primeiro trecho contínuo. */
export function kvMatchRange(q: string, text: string): [number, number] | null {
  const w = kvFold(q).split(/\s+/).filter(Boolean)[0];
  if (!w) return null;
  // o texto dobrado tem o mesmo tamanho do original para letras latinas comuns (o acento sai do NFD, não da letra)
  const folded = [...text].map((c) => kvFold(c) || c).join('');
  const i = folded.indexOf(w);
  return i < 0 || folded.length !== text.length ? null : [i, i + w.length];
}
