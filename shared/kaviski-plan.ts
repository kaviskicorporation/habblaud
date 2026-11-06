// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): a planta da empresa, desenhada no editor do escritório e igual
// para todo mundo. Sem planta salva (ou com `on: false`) o prédio é o original (núcleo + corredor + 2 fileiras).
//
// Contrato comum das frentes (motor do prédio, editor, salas temáticas, organograma). Puro: sem DOM nem Node.
//
// Coordenadas em tiles (TILE px), origem no canto de cima à esquerda da planta. Cada item é um retângulo que não se
// sobrepõe a outro. Salas têm paredes próprias, como as do original: as 2 primeiras linhas são a face da parede norte,
// a última linha é a parede sul e as colunas das pontas são as paredes laterais (0,5 tile cada). Portas ficam nas
// paredes; um corredor (ou outra área aberta) encostado na porta é o caminho até ela.
import { kvPathKey } from './kaviski';

export const KV_PLAN_VERSION = 1;
/** Tamanho máximo da planta (tiles). */
export const KV_PLAN_MAX_W = 320;
export const KV_PLAN_MAX_H = 200;
/** Itens no máximo (salas, corredores, áreas). */
export const KV_PLAN_MAX_ITEMS = 400;
/** Versões guardadas no servidor (desfazer/voltar). */
export const KV_PLAN_HISTORY = 40;

/**
 * O que é cada item da planta:
 * - `projeto`: a sala de um projeto (ref = `kvPlanRoomRef(caminho)`; compare sempre com `kvPlanRoomRef(room.id)`);
 * - `propria`: uma sala própria (W4: pessoal, reunião, descanso, outra; ref = `kvsala-...`);
 * - `tema`: sala temática fixa e interativa (RH, recepção de convites, provador...; ref = chave de `KV_THEME_KEYS`);
 * - `nucleo`: uma área comum do original, com tamanho fixo (ref = `KvCoreRef`);
 * - `corredor`: piso aberto de passagem (sem paredes), de qualquer tamanho;
 * - `jardim`: área verde/pátio dentro da planta (sem paredes, caminhável, decorativa);
 * - `vaga`: lugar reservado para uma sala de projeto que chegar sem lugar marcado (as salas automáticas ocupam as
 *   vagas na ordem de `order`; sem vaga livre, vão para a faixa automática, `KvPlan.auto`).
 */
export type KvPlanKind = 'projeto' | 'propria' | 'tema' | 'nucleo' | 'corredor' | 'jardim' | 'vaga';
export const KV_PLAN_KINDS: readonly KvPlanKind[] = ['projeto', 'propria', 'tema', 'nucleo', 'corredor', 'jardim', 'vaga'];

/** As áreas comuns do original (tamanho fixo 16x12; porta para o corredor embaixo nas duas de cima e em cima nas de baixo). */
export type KvCoreRef = 'recepcao' | 'copa' | 'lounge' | 'banheiros';
export const KV_CORE_REFS: readonly KvCoreRef[] = ['recepcao', 'copa', 'lounge', 'banheiros'];

/**
 * Salas temáticas: cada função do sistema tem um lugar físico com um item interativo (o boneco vai até lá e a ação
 * acontece). A mobília de cada uma é registrada pela frente das salas temáticas (`client/src/kaviski/plan/furnish.ts`);
 * o motor usa uma sala genérica para chave sem mobília registrada.
 */
export type KvThemeKey =
  | 'rh' // Pessoas: contas, convites, registro; organograma na parede
  | 'diretoria' // organograma grande, visão da empresa
  | 'reuniao' // agenda, reuniões (sala de reunião temática)
  | 'recepcao' // balcão de convites para visitantes, mural de avisos
  | 'provador' // espelho: Meu avatar (aparência, crachá)
  | 'foco' // cabines de foco: pomodoro
  | 'auditorio' // palco/megafone: falar para o andar inteiro
  | 'agentes' // central dos agentes: novo agente, timelapse, meu dia, histórico
  | 'ti' // configurações: avisos, atalhos, voz e vídeo
  | 'arquitetura' // a maquete/planta: abre o editor da empresa e as salas próprias
  | 'correio' // conversas e mensagens
  | 'descanso'; // modo clássico (descansar), jogos
export const KV_THEME_KEYS: readonly KvThemeKey[] = ['rh', 'diretoria', 'reuniao', 'recepcao', 'provador', 'foco', 'auditorio', 'agentes', 'ti', 'arquitetura', 'correio', 'descanso'];

export type KvDoorSide = 'n' | 's' | 'e' | 'w';
export const KV_DOOR_SIDES: readonly KvDoorSide[] = ['n', 's', 'e', 'w'];

/** Porta numa parede da sala: `at` = distância (tiles) do começo da parede (esquerda em n/s, topo em e/w). */
export interface KvPlanDoor {
  side: KvDoorSide;
  at: number;
  /** Largura (tiles), 2 por padrão (como as portas do original). */
  w?: number;
}

export interface KvPlanItem {
  /** Id estável do item (`el-` + até 16 letras/dígitos). */
  id: string;
  kind: KvPlanKind;
  /** projeto: id da sala; propria: id da sala própria; tema: KvThemeKey; nucleo: KvCoreRef. */
  ref?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Portas (salas: pelo menos uma; `nucleo` ignora: as portas são as do original). */
  doors?: KvPlanDoor[];
  /** Nome na placa (vence o nome da sala; tema sem nome usa o nome padrão do tema). */
  name?: string;
  /**
   * Sala fixa: existe sempre, mesmo vazia (apagada até alguém chegar), como `pinned` do mapa de estilos.
   * Só vale para `projeto` (as outras já existem sempre).
   */
  fixed?: boolean;
  /** Travado no editor: não se arrasta nem se redimensiona sem destravar. */
  locked?: boolean;
  /** Paleta do tema da sala (0..9, as 10 paletas das salas próprias); ausente = a da semente. */
  palette?: number;
  /** Cor da placa (#rgb ou #rrggbb). */
  color?: string;
  /** Variação de mobília (o furnisher decide o que é; ex.: 'ilhas', 'baias', 'aberto'). */
  style?: string;
  /** Ordem das vagas (`vaga`) e desempate geral. */
  order?: number;
}

/**
 * Agente de IA fixo: um lugar marcado para um agente de um projeto. O primeiro agente vivo daquela sala que bate com
 * `match` senta sempre ali; sem nenhum, a mesa fica com a plaquinha "mesa de <nome>". Também entra no organograma.
 */
export interface KvFixedAgent {
  id: string;
  /** Nome no organograma e na plaquinha (ex.: "Claude · Site"). */
  name: string;
  /** Sala (id da sala de projeto, ou de sala própria/temática do plano). */
  room: string;
  /** Qual agente: 'main' (o principal da sala), 'sub' (subagente), `provider:claude|codex`, `name:<texto>`. */
  match: string;
  /** A cadeira (posição relativa à sala, como a mesa fixa das pessoas: shared/kaviski-desk.ts). */
  seat?: { x: number; y: number };
  /** Organograma. */
  title?: string;
  dept?: string;
  /** A quem responde: id de pessoa (`u:<id>`) ou de outro agente fixo (`a:<id>`). */
  reportsTo?: string;
}

export interface KvPlan {
  v: typeof KV_PLAN_VERSION;
  /** Ligada: o prédio é a planta. false = guardada, mas o prédio é o original. */
  on: boolean;
  /** Nome da empresa (aparece no editor e na fachada). */
  name?: string;
  w: number;
  h: number;
  items: KvPlanItem[];
  /**
   * Faixa automática: salas de projeto sem lugar e sem vaga livre entram ali, em pares (norte/sul) dos dois lados de
   * um corredor gerado, crescendo para `dir`. (x, y) = canto de cima à esquerda da faixa.
   */
  auto: { x: number; y: number; dir: 'e' | 's' };
  /** Quem edita além do admin. */
  editors?: 'admin' | 'equipe';
  /** Agentes fixos (frente do organograma). */
  agents?: KvFixedAgent[];
}

/** Como o servidor guarda e devolve a planta. */
export interface KvPlanDoc {
  plan: KvPlan | null;
  /** Número da versão (sobe a cada gravação; 0 = nunca gravada). */
  version: number;
  updatedAt: number;
  /** Nome de quem gravou. */
  by?: string;
}

/** Uma versão antiga (lista do "voltar a uma versão"). */
export interface KvPlanVersionInfo {
  version: number;
  at: number;
  by?: string;
  items: number;
  note?: string;
}

/** Tamanho mínimo/máximo de cada tipo (tiles). `nucleo` tem tamanho fixo. */
export const KV_PLAN_SIZE: Record<KvPlanKind, { minW: number; minH: number; maxW: number; maxH: number }> = {
  projeto: { minW: 10, minH: 9, maxW: 48, maxH: 32 },
  propria: { minW: 8, minH: 8, maxW: 40, maxH: 28 },
  tema: { minW: 8, minH: 8, maxW: 48, maxH: 32 },
  nucleo: { minW: 16, minH: 12, maxW: 16, maxH: 12 },
  corredor: { minW: 2, minH: 2, maxW: KV_PLAN_MAX_W, maxH: KV_PLAN_MAX_H },
  jardim: { minW: 2, minH: 2, maxW: 120, maxH: 120 },
  vaga: { minW: 16, minH: 12, maxW: 16, maxH: 12 },
};

/** Tamanho de uma sala de projeto do original (a faixa automática e as vagas usam). */
export const KV_ROOM_W = 16;
export const KV_ROOM_H = 12;

/** Tipos com paredes (os outros são abertos). */
export function kvPlanWalled(kind: KvPlanKind): boolean {
  return kind === 'projeto' || kind === 'propria' || kind === 'tema' || kind === 'nucleo' || kind === 'vaga';
}

/** O ref de uma sala de projeto (mesma chave do id da sala no snapshot). */
export function kvPlanRoomRef(path: string): string {
  return kvPathKey(path);
}

const ID_RE = /^el-[a-z0-9]{1,16}$/;
const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function kvPlanNewId(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 10; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rand() * 36) % 36];
  return `el-${s}`;
}

function int(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n < min || n > max ? null : n;
}

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  return s || undefined;
}

/** Os dois retângulos se sobrepõem (encostar não conta). */
export function kvRectsOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Comprimento da parede de um lado (onde a porta pode ficar). */
export function kvWallLen(item: Pick<KvPlanItem, 'w' | 'h'>, side: KvDoorSide): number {
  return side === 'n' || side === 's' ? item.w : item.h;
}

/** Portas válidas de uma sala: dentro da parede, longe dos cantos (1 tile), sem sobrepor outra porta. */
export function kvNormDoors(item: Pick<KvPlanItem, 'w' | 'h'>, doors: unknown): KvPlanDoor[] {
  if (!Array.isArray(doors)) return [];
  const out: KvPlanDoor[] = [];
  for (const d of doors.slice(0, 8)) {
    if (!d || typeof d !== 'object') continue;
    const side = (d as KvPlanDoor).side;
    if (!KV_DOOR_SIDES.includes(side)) continue;
    const w = int((d as KvPlanDoor).w ?? 2, 1, 6);
    const len = kvWallLen(item, side);
    // e/w: a face da parede norte (2 linhas) e a parede sul (1) não têm porta lateral
    const lo = side === 'e' || side === 'w' ? 2 : 1;
    const hi = side === 'e' || side === 'w' ? len - 1 : len - 1;
    const at = int((d as KvPlanDoor).at, lo, Math.max(lo, hi - (w ?? 2)));
    if (w === null || at === null || at + w > hi) continue;
    if (out.some((o) => o.side === side && at < o.at + (o.w ?? 2) && o.at < at + w)) continue;
    out.push(w === 2 ? { side, at } : { side, at, w });
  }
  return out;
}

/** Porta padrão de uma sala nova: no meio da parede sul. */
export function kvDefaultDoor(item: Pick<KvPlanItem, 'w' | 'h'>): KvPlanDoor {
  return { side: 's', at: Math.max(1, Math.floor(item.w / 2) - 1) };
}

export interface KvPlanProblem {
  id?: string;
  msg: string;
}

/**
 * Limpa uma planta vinda de fora (corpo do POST, arquivo, editor). Item inválido sai (com o motivo em `problems`);
 * itens sobrepostos: fica o primeiro. Nunca lança.
 */
export function kvNormPlan(body: unknown): { plan: KvPlan | null; problems: KvPlanProblem[] } {
  const problems: KvPlanProblem[] = [];
  if (!body || typeof body !== 'object') return { plan: null, problems: [{ msg: 'planta vazia' }] };
  const b = body as Partial<KvPlan>;
  const w = int(b.w, 16, KV_PLAN_MAX_W) ?? 120;
  const h = int(b.h, 12, KV_PLAN_MAX_H) ?? 60;
  const items: KvPlanItem[] = [];
  const ids = new Set<string>();
  const refs = new Set<string>();
  for (const raw of Array.isArray(b.items) ? b.items.slice(0, KV_PLAN_MAX_ITEMS) : []) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as KvPlanItem;
    const id = typeof r.id === 'string' && ID_RE.test(r.id) && !ids.has(r.id) ? r.id : null;
    if (!id) {
      problems.push({ msg: 'item sem id válido' });
      continue;
    }
    if (!KV_PLAN_KINDS.includes(r.kind)) {
      problems.push({ id, msg: 'tipo desconhecido' });
      continue;
    }
    const lim = KV_PLAN_SIZE[r.kind];
    const iw = int(r.w, lim.minW, lim.maxW);
    const ih = int(r.h, lim.minH, lim.maxH);
    const ix = int(r.x, 0, w - (iw ?? 1));
    const iy = int(r.y, 0, h - (ih ?? 1));
    if (iw === null || ih === null || ix === null || iy === null) {
      problems.push({ id, msg: 'fora da planta ou tamanho inválido' });
      continue;
    }
    const it: KvPlanItem = { id, kind: r.kind, x: ix, y: iy, w: iw, h: ih };
    let ref: string | undefined;
    if (r.kind === 'projeto') ref = typeof r.ref === 'string' && r.ref.trim() ? kvPlanRoomRef(r.ref).slice(0, 1024) : undefined;
    else if (r.kind === 'propria') ref = typeof r.ref === 'string' && /^kvsala-[A-Za-z0-9_-]{1,32}$/.test(r.ref) ? r.ref : undefined;
    else if (r.kind === 'tema') ref = KV_THEME_KEYS.includes(r.ref as KvThemeKey) ? r.ref : undefined;
    else if (r.kind === 'nucleo') ref = KV_CORE_REFS.includes(r.ref as KvCoreRef) ? r.ref : undefined;
    if ((r.kind === 'projeto' || r.kind === 'propria' || r.kind === 'tema' || r.kind === 'nucleo') && !ref) {
      problems.push({ id, msg: 'sala sem referência' });
      continue;
    }
    // a mesma sala (ou área do núcleo) em dois lugares: fica a primeira
    const refKey = ref && r.kind !== 'tema' ? `${r.kind}:${ref}` : '';
    if (refKey && refs.has(refKey)) {
      problems.push({ id, msg: 'sala repetida' });
      continue;
    }
    if (ref) it.ref = ref;
    if (kvPlanWalled(r.kind) && r.kind !== 'nucleo') {
      const doors = kvNormDoors(it, r.doors);
      it.doors = doors.length ? doors : [kvDefaultDoor(it)];
    }
    const name = text(r.name, 40);
    if (name) it.name = name;
    if (r.kind === 'projeto' && r.fixed === true) it.fixed = true;
    if (r.locked === true) it.locked = true;
    const pal = int(r.palette, 0, 9);
    if (pal !== null && r.palette !== undefined) it.palette = pal;
    if (typeof r.color === 'string' && COLOR_RE.test(r.color)) it.color = r.color.toLowerCase();
    const style = text(r.style, 24);
    if (style && /^[a-z0-9_-]+$/.test(style)) it.style = style;
    const order = int(r.order, -1e6, 1e6);
    if (order !== null && r.order !== undefined) it.order = order;
    const hit = items.find((o) => kvRectsOverlap(o, it));
    if (hit) {
      problems.push({ id, msg: `sobrepõe ${hit.id}` });
      continue;
    }
    ids.add(id);
    if (refKey) refs.add(refKey);
    items.push(it);
  }
  const ad = (b.auto ?? {}) as Partial<KvPlan['auto']>;
  const auto: KvPlan['auto'] = { x: int(ad.x, 0, KV_PLAN_MAX_W) ?? w, y: int(ad.y, 0, KV_PLAN_MAX_H) ?? 0, dir: ad.dir === 's' ? 's' : 'e' };
  const plan: KvPlan = { v: KV_PLAN_VERSION, on: b.on !== false, w, h, items, auto };
  const name = text(b.name, 60);
  if (name) plan.name = name;
  if (b.editors === 'equipe') plan.editors = 'equipe';
  const agents = kvNormFixedAgents(b.agents, problems);
  if (agents.length) plan.agents = agents;
  return { plan, problems };
}

/** Agentes fixos válidos (até 200). */
export function kvNormFixedAgents(v: unknown, problems: KvPlanProblem[] = []): KvFixedAgent[] {
  if (!Array.isArray(v)) return [];
  const out: KvFixedAgent[] = [];
  const ids = new Set<string>();
  for (const raw of v.slice(0, 200)) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as KvFixedAgent;
    const id = typeof a.id === 'string' && /^ag-[a-z0-9]{1,16}$/.test(a.id) && !ids.has(a.id) ? a.id : null;
    const name = text(a.name, 40);
    const room = typeof a.room === 'string' && a.room.trim() ? (a.room.startsWith('/') ? kvPlanRoomRef(a.room) : a.room.trim()).slice(0, 1024) : null;
    const match = typeof a.match === 'string' && /^(main|sub|provider:(claude|codex)|name:.{1,40})$/.test(a.match) ? a.match : null;
    if (!id || !name || !room || !match) {
      problems.push({ id: id ?? undefined, msg: 'agente fixo inválido' });
      continue;
    }
    const fa: KvFixedAgent = { id, name, room, match };
    if (a.seat && typeof a.seat === 'object') {
      const sx = int(a.seat.x, -2000, 2000);
      const sy = int(a.seat.y, -2000, 2000);
      if (sx !== null && sy !== null) fa.seat = { x: sx, y: sy };
    }
    const title = text(a.title, 60);
    if (title) fa.title = title;
    const dept = text(a.dept, 40);
    if (dept) fa.dept = dept;
    if (typeof a.reportsTo === 'string' && /^(u|a):[A-Za-z0-9_.@-]{1,64}$/.test(a.reportsTo)) fa.reportsTo = a.reportsTo;
    ids.add(id);
    out.push(fa);
  }
  return out;
}

/** O retângulo que cobre todos os itens (para centralizar a câmera e o mini-mapa). */
export function kvPlanBounds(plan: Pick<KvPlan, 'items'>): { x: number; y: number; w: number; h: number } | null {
  if (!plan.items.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const it of plan.items) {
    x0 = Math.min(x0, it.x);
    y0 = Math.min(y0, it.y);
    x1 = Math.max(x1, it.x + it.w);
    y1 = Math.max(y1, it.y + it.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
