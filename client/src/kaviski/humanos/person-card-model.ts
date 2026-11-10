// Fork Kaviski (KAVISKI-HUMANOS.md → "Cartão da pessoa"): as partes puras do cartão (person-card.ts), sem DOM, para
// testar — onde ele abre, limitar a posição na tela ao arrastar, lembrar a posição (e se está fixado) entre aberturas,
// quando vira folha embaixo (celular), quais ações são as principais, "online há X" e a pasta compartilhada só entre
// duas pessoas (o "Enviar arquivo" do cartão usa a Sala de Arquivos).
import { tr } from '../../../../shared/i18n';

export interface KvXY {
  x: number;
  y: number;
}

export interface KvSize {
  w: number;
  h: number;
}

/** Margem mínima até a borda da tela (px). */
export const KV_CARD_MARGIN = 8;
/** Abaixo da barra do topo (px): o cartão não cobre os botões dela ao abrir perto do clique. */
export const KV_CARD_TOP = 70;
/** Tela mais estreita que isto: o cartão vira uma folha embaixo, sem arrastar. */
export const KV_CARD_SHEET_MAX = 560;
/** Quanto do cartão (px) tem que ficar dentro da tela ao arrastar (a faixa precisa continuar alcançável). */
export const KV_CARD_KEEP = 64;

export const KV_CARD_STORE = 'habblaud.kv.personCard';

/** Celular (ou janela bem estreita): folha embaixo. */
export function kvCardIsSheet(viewW: number): boolean {
  return viewW < KV_CARD_SHEET_MAX;
}

/**
 * Limita a posição para o cartão inteiro caber na tela (se ele for maior que a tela, o topo fica visível). `top` = o
 * mínimo de cima (a barra do topo fica por cima do cartão: a faixa dele não pode sumir embaixo dela).
 */
export function kvClampCard(pos: KvXY, size: KvSize, view: KvSize, top = KV_CARD_MARGIN, margin = KV_CARD_MARGIN): KvXY {
  const minY = Math.max(margin, Math.min(top, view.h - KV_CARD_KEEP));
  const maxX = Math.max(margin, view.w - size.w - margin);
  const maxY = Math.max(minY, view.h - size.h - margin);
  return { x: Math.round(Math.min(maxX, Math.max(margin, pos.x))), y: Math.round(Math.min(maxY, Math.max(minY, pos.y))) };
}

/** Onde abrir sem posição lembrada: perto do clique (centrado nele, logo abaixo) ou no meio da tela. */
export function kvCardDefaultPos(at: KvXY | undefined, size: KvSize, view: KvSize, top = KV_CARD_MARGIN): KvXY {
  if (!at) return kvClampCard({ x: (view.w - size.w) / 2, y: (view.h - size.h) / 2 }, size, view, top);
  const p = kvClampCard({ x: at.x - size.w / 2, y: at.y + 16 }, size, view, top);
  return { x: p.x, y: Math.max(Math.min(Math.max(KV_CARD_TOP, top), Math.max(KV_CARD_MARGIN, view.h - size.h - KV_CARD_MARGIN)), p.y) };
}

/** Posição durante o arraste: onde o cartão começou + quanto o ponteiro andou, limitada à tela. */
export function kvDragCard(start: KvXY, from: KvXY, now: KvXY, size: KvSize, view: KvSize, top = KV_CARD_MARGIN): KvXY {
  return kvClampCard({ x: start.x + now.x - from.x, y: start.y + now.y - from.y }, size, view, top);
}


/** O que fica lembrado neste navegador. `pos` ausente = lugar padrão (perto do clique). */
export interface KvCardMemory {
  pos?: KvXY;
  /** Fixado: não fecha ao clicar fora (vira um painel). */
  pinned: boolean;
}

type KvStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): KvStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 100_000;

/** Lê a memória (formato estranho = padrão). */
export function kvLoadCardMemory(s: KvStore | null = storage()): KvCardMemory {
  try {
    const raw = s?.getItem(KV_CARD_STORE);
    if (!raw) return { pinned: false };
    const v = JSON.parse(raw) as Record<string, unknown>;
    const p = v?.pos as Record<string, unknown> | undefined;
    const pos = p && finite(p.x) && finite(p.y) ? { x: Math.round(p.x), y: Math.round(p.y) } : undefined;
    return { ...(pos ? { pos } : {}), pinned: v?.pinned === true };
  } catch {
    return { pinned: false };
  }
}

/** Grava a memória (padrão = apaga). */
export function kvSaveCardMemory(m: KvCardMemory, s: KvStore | null = storage()): void {
  try {
    if (!m.pos && !m.pinned) s?.removeItem(KV_CARD_STORE);
    else s?.setItem(KV_CARD_STORE, JSON.stringify({ ...(m.pos ? { pos: { x: Math.round(m.pos.x), y: Math.round(m.pos.y) } } : {}), pinned: m.pinned }));
  } catch {
    // sem localStorage (aba privada cheia...): só não lembra
  }
}

/** As ações que viram botões grandes (o resto vai para "Mais"). */
export const KV_CARD_MAIN: readonly string[] = ['mensagem', 'chamar', 'cumprimentar', 'ir-ate'];

/** Separa as ações (já em ordem) em principais e "Mais"; `group` da ação vence a lista padrão. */
export function kvSplitActions<T extends { id: string; group?: 'main' | 'more' }>(list: readonly T[]): { main: T[]; more: T[] } {
  const main: T[] = [];
  const more: T[] = [];
  for (const a of list) ((a.group ?? (KV_CARD_MAIN.includes(a.id) ? 'main' : 'more')) === 'main' ? main : more).push(a);
  return { main, more };
}

/** "agora mesmo", "há 5 min", "há 2 h", "há 1 h 20 min", "há 3 dias". */
export function kvSinceText(since: number, now: number): string {
  const min = Math.floor(Math.max(0, now - since) / 60_000);
  if (min < 1) return tr('agora mesmo');
  if (min < 60) return tr('há {0} min', [min]);
  const hours = Math.floor(min / 60);
  if (hours < 24) return min % 60 ? tr('há {0} h {1} min', [hours, min % 60]) : tr('há {0} h', [hours]);
  const days = Math.floor(hours / 24);
  return days === 1 ? tr('há 1 dia') : tr('há {0} dias', [days]);
}

/** Pasta como o cartão precisa vê-la (KvFolderView). */
export interface KvCardFolder {
  id: string;
  parent: string | null;
  access: string;
  people: readonly string[];
  by: { id: string };
  at: number;
}

/** A pasta "só nós dois": na raiz, acesso "pessoas escolhidas" e exatamente estas duas pessoas (quem criou conta). */
export function kvSharedFolder<F extends KvCardFolder>(folders: readonly F[], me: string, other: string): F | undefined {
  if (!me || !other || me === other) return undefined;
  return folders
    .filter((f) => {
      if (f.parent !== null || f.access !== 'pessoas') return false;
      const who = new Set([f.by.id, ...f.people]);
      return who.size === 2 && who.has(me) && who.has(other);
    })
    .sort((a, b) => a.at - b.at)[0];
}

/** Primeiro nome (para títulos curtos). */
export function kvFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}
