// Fork Kaviski (KAVISKI-HUMANOS.md): partes puras das conversas (chat.ts): links clicáveis e seguros, rótulos de dia,
// agrupamento de falas seguidas e a lista de salas em que estive. Sem DOM, para testar.
import { tr } from '../../../../shared/i18n';

export type KvTextPart = { t: 'text'; v: string } | { t: 'link'; v: string; href: string };

// http(s)://... ou www.... até um espaço; pontuação final (.,;:!?) e parêntese sem par ficam de fora do link
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

/** Divide o texto em pedaços de texto e links. Só http(s) vira link (nada de javascript:, data:...). */
export function kvLinkify(text: string): KvTextPart[] {
  const out: KvTextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let raw = m[0];
    // tira a pontuação do fim ("veja https://x.com." → o ponto não entra)
    while (/[.,;:!?)\]}]$/.test(raw)) {
      if (raw.endsWith(')') && (raw.match(/\(/g)?.length ?? 0) >= (raw.match(/\)/g)?.length ?? 0)) break;
      raw = raw.slice(0, -1);
    }
    if (raw.length < 5) continue;
    const href = /^www\./i.test(raw) ? `https://${raw}` : raw;
    let ok = false;
    try {
      const u = new URL(href);
      ok = (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
    } catch {
      ok = false;
    }
    if (!ok) continue;
    const at = m.index!;
    if (at > last) out.push({ t: 'text', v: text.slice(last, at) });
    out.push({ t: 'link', v: raw, href });
    last = at + raw.length;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "Hoje", "Ontem", "segunda-feira, 3 de novembro" (ou com o ano, se não é deste ano). */
export function kvDayLabel(at: number, now = Date.now()): string {
  const diff = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (diff === 0) return tr('Hoje');
  if (diff === 1) return tr('Ontem');
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** Mesma pessoa, mesmo dia e até 5 min depois: a fala entra no mesmo grupo (sem repetir nome e avatar). */
export function kvSameGroup(prev: { from: string; at: number } | null, next: { from: string; at: number }): boolean {
  return !!prev && prev.from === next.from && next.at - prev.at < 5 * 60_000 && startOfDay(prev.at) === startOfDay(next.at);
}

/** Hora curta (14:05). */
export function kvTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** "agora", "14:05", "ontem" ou "03/11" para a lista de conversas. */
export function kvWhen(at: number, now = Date.now()): string {
  if (now - at < 60_000) return tr('agora');
  const diff = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (diff === 0) return kvTime(at);
  if (diff === 1) return tr('ontem');
  return new Date(at).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
}

/** Salas de projeto em que estive (as mais recentes primeiro, sem repetir, no máximo `max`). */
export function kvRememberRoom(list: readonly { area: string; at: number }[], area: string, at: number, max = 12): { area: string; at: number }[] {
  if (!area.startsWith('r:')) return [...list];
  return [{ area, at }, ...list.filter((x) => x.area !== area)].slice(0, max);
}

/** Lê a lista guardada (localStorage) sem confiar no formato. */
export function kvParseRooms(raw: string | null): { area: string; at: number }[] {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is { area: string; at: number } => !!x && typeof x.area === 'string' && x.area.startsWith('r:') && typeof x.at === 'number').slice(0, 12);
  } catch {
    return [];
  }
}

/** Emojis do seletor da conversa (os mais usados no trabalho). */
export const KV_EMOJIS = ['👍', '👏', '🙌', '🎉', '✅', '❤️', '😄', '😂', '😉', '😅', '🤔', '😮', '🙏', '💪', '👀', '🔥', '🚀', '⭐', '☕', '🍕', '💡', '📌', '📎', '🐛', '⚠️', '❌', '⏰', '📅', '👋', '🤝', '😴', '🎧'];
