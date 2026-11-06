// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): os modelos do "Monte a sua empresa" — funções puras que geram
// uma planta válida (sem sobreposição, toda sala com porta para um corredor e caminho até a recepção) a partir do
// nome da empresa, quantas pessoas, as salas temáticas escolhidas, quantas reuniões e vagas, e o estilo:
// - Clássico: o prédio de hoje (núcleo à esquerda, corredor no meio, salas em 2 fileiras);
// - Campus: blocos em volta de um pátio com jardim, corredor em anel;
// - Torre: compacto, um corredor vertical com salas dos dois lados, alas lado a lado quando cresce;
// - Galeria: corredor em L (ou em U, com muitas salas) com um jardim no canto de dentro.
// As salas de projeto que existem hoje e as salas próprias entram nos lugares; sobrando, viram vagas.
// Testado em templates.test.ts.
import {
  KV_PLAN_MAX_H,
  KV_PLAN_MAX_W,
  KV_PLAN_VERSION,
  type KvCoreRef,
  type KvDoorSide,
  type KvPlan,
  type KvPlanItem,
  type KvPlanKind,
  type KvThemeKey,
} from '../../../../shared/kaviski-plan';

export type KvTemplateStyle = 'classico' | 'campus' | 'torre' | 'galeria';
export const KV_TEMPLATE_STYLES: readonly KvTemplateStyle[] = ['classico', 'campus', 'torre', 'galeria'];

export interface KvCompanyOpts {
  name?: string;
  /** Quantas pessoas (decide os padrões do assistente; aqui só desempata o tamanho). */
  people?: number;
  themes: readonly KvThemeKey[];
  /** Salas de reunião (temáticas 'reuniao' a mais, numeradas). */
  meetings: number;
  /** Vagas para salas de projeto novas. */
  vacancies: number;
  style: KvTemplateStyle;
  /** Salas de projeto que existem (ref = kvPlanRoomRef(caminho)). */
  projects?: readonly { ref: string; name?: string; fixed?: boolean }[];
  /** Salas próprias (W4). */
  own?: readonly { id: string; name?: string }[];
  /** Nomes das salas temáticas (padrão: o do tema) e das reuniões ("Reunião {n}"). */
  names?: { theme?: (k: KvThemeKey) => string | undefined; meeting?: (n: number) => string };
}

/** As salas temáticas marcadas por padrão no assistente. */
export const KV_DEFAULT_THEMES: readonly KvThemeKey[] = ['rh', 'reuniao', 'recepcao', 'agentes', 'arquitetura', 'foco', 'descanso'];

/** Padrões do assistente a partir de quantas pessoas. */
export function kvCompanyDefaults(people: number): { meetings: number; vacancies: number } {
  const n = Math.max(1, Math.round(people));
  return { meetings: n <= 4 ? 0 : Math.min(6, Math.ceil(n / 8)), vacancies: Math.min(12, Math.max(2, Math.ceil(n / 4))) };
}

interface Unit {
  kind: KvPlanKind;
  ref?: string;
  name?: string;
  fixed?: boolean;
}

/** As salas a pôr, na ordem: temáticas, reuniões, salas próprias, projetos, vagas. */
export function kvTemplateUnits(o: KvCompanyOpts): Unit[] {
  const out: Unit[] = [];
  const themes = [...new Set(o.themes)];
  for (const k of themes) {
    const name = o.names?.theme?.(k);
    out.push({ kind: 'tema', ref: k, ...(name ? { name } : {}) });
  }
  const meetings = Math.max(0, Math.min(12, Math.round(o.meetings)));
  // "reuniao" marcada já é a primeira; as outras são numeradas
  const first = themes.includes('reuniao') ? 2 : 1;
  for (let i = 0; i < meetings; i++) {
    const n = first + i;
    out.push({ kind: 'tema', ref: 'reuniao', name: o.names?.meeting?.(n) ?? `Reunião ${n}` });
  }
  if (first === 2 && meetings > 0) {
    const r = out.find((u) => u.kind === 'tema' && u.ref === 'reuniao' && !u.name);
    if (r) r.name = o.names?.meeting?.(1) ?? 'Reunião 1';
  }
  for (const r of o.own ?? []) out.push({ kind: 'propria', ref: r.id, ...(r.name ? { name: r.name } : {}) });
  const seen = new Set<string>();
  for (const p of o.projects ?? []) {
    if (seen.has(p.ref)) continue;
    seen.add(p.ref);
    out.push({ kind: 'projeto', ref: p.ref, ...(p.name ? { name: p.name } : {}), ...(p.fixed ? { fixed: true } : {}) });
  }
  for (let i = 0; i < Math.max(0, Math.min(40, Math.round(o.vacancies))); i++) out.push({ kind: 'vaga' });
  return out;
}

class Draw {
  items: KvPlanItem[] = [];
  private n = 0;
  private vagas = 0;

  add(kind: KvPlanKind, x: number, y: number, w: number, h: number, extra: Partial<KvPlanItem> = {}): KvPlanItem {
    const it: KvPlanItem = { id: `el-m${(this.n++).toString(36)}`, kind, x, y, w, h, ...extra };
    if (kind === 'vaga') it.order = this.vagas++;
    this.items.push(it);
    return it;
  }

  core(ref: KvCoreRef, x: number, y: number): void {
    this.add('nucleo', x, y, 16, 12, { ref });
  }

  /** Uma sala (unidade) num retângulo com a porta no lado pedido. Vaga e projeto 16×12 só cabem em células 16×12. */
  unit(u: Unit, x: number, y: number, w: number, h: number, side: KvDoorSide, at: number): void {
    const doors = u.kind === 'nucleo' ? undefined : [{ side, at }];
    const extra: Partial<KvPlanItem> = { ...(u.ref ? { ref: u.ref } : {}), ...(u.name ? { name: u.name } : {}), ...(u.fixed ? { fixed: true } : {}), ...(doors ? { doors } : {}) };
    this.add(u.kind, x, y, w, h, extra);
  }

  /** Jardins de até 120 de lado (o limite do tipo), lado a lado. */
  garden(x: number, y: number, w: number, h: number): void {
    if (w < 2 || h < 2) return;
    for (let gx = 0; gx < w; gx += 120) for (let gy = 0; gy < h; gy += 120) this.add('jardim', x + gx, y + gy, Math.min(120, w - gx), Math.min(120, h - gy));
  }

  /** Corredores de qualquer tamanho. */
  corridor(x: number, y: number, w: number, h: number): void {
    if (w > 0 && h > 0) this.add('corredor', x, y, w, h);
  }
}

function finish(d: Draw, o: KvCompanyOpts, auto: KvPlan['auto'], margin: { e: number; s: number }): KvPlan {
  // o que passar do limite da planta fica de fora (as salas de projeto sem lugar vão para a faixa automática)
  for (const it of d.items) {
    if (it.kind !== 'corredor' && it.kind !== 'jardim') continue;
    it.w = Math.min(it.w, KV_PLAN_MAX_W - it.x);
    it.h = Math.min(it.h, KV_PLAN_MAX_H - it.y);
  }
  d.items = d.items.filter((it) => it.w >= 2 && it.h >= 2).filter((it) => it.x + it.w <= KV_PLAN_MAX_W && it.y + it.h <= KV_PLAN_MAX_H);
  let w = 16;
  let h = 12;
  for (const it of d.items) {
    w = Math.max(w, it.x + it.w);
    h = Math.max(h, it.y + it.h);
  }
  const plan: KvPlan = {
    v: KV_PLAN_VERSION,
    on: true,
    w: Math.min(KV_PLAN_MAX_W, Math.max(w + margin.e, auto.x + (auto.dir === 'e' ? 32 : 37))),
    h: Math.min(KV_PLAN_MAX_H, Math.max(h + margin.s, auto.y + (auto.dir === 'e' ? 29 : 24))),
    items: d.items,
    auto,
  };
  const name = o.name?.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (name) plan.name = name;
  return plan;
}

/** Clássico: núcleo 2×2 à esquerda, corredor de 5, salas 16×12 em pares (norte com porta embaixo, sul com porta em cima). */
export function kvTemplateClassic(o: KvCompanyOpts): KvPlan {
  const units = kvTemplateUnits(o);
  const d = new Draw();
  d.core('recepcao', 0, 0);
  d.core('copa', 16, 0);
  d.core('banheiros', 0, 17);
  d.core('lounge', 16, 17);
  units.forEach((u, i) => {
    const col = 2 + Math.floor(i / 2);
    if (i % 2 === 0) d.unit(u, col * 16, 0, 16, 12, 's', 7);
    else d.unit(u, col * 16, 17, 16, 12, 'n', 7);
  });
  const cols = 2 + Math.ceil(units.length / 2);
  d.corridor(0, 12, cols * 16, 5);
  return finish(d, o, { x: cols * 16, y: 0, dir: 'e' }, { e: 8, s: 4 });
}

/** Campus: fileiras em cima e embaixo (núcleo nelas), salas de 12×16 nas laterais, anel de corredor e pátio no meio. */
export function kvTemplateCampus(o: KvCompanyOpts): KvPlan {
  const units = kvTemplateUnits(o);
  // laterais (12×16): temáticas, reuniões e salas próprias; fileiras (16×12): projetos, vagas e o que sobrar
  const sideOk = (u: Unit) => u.kind === 'tema' || u.kind === 'propria';
  const sideCand = units.filter(sideOk);
  const L = Math.max(1, Math.min(5, Math.ceil(sideCand.length / 2)));
  const side = sideCand.slice(0, 2 * L);
  const rows = units.filter((u) => !side.includes(u));
  const T = Math.max(3, Math.ceil((rows.length + 4) / 2));
  const SW = 12;
  const x0 = SW;
  const IW = T * 16;
  const CH = L * 16;
  const d = new Draw();
  // fileira de cima: recepção, copa, ...; de baixo: banheiros, lounge, ...
  const topCells = T - 2;
  const top = rows.slice(0, Math.ceil(rows.length / 2));
  const bottom = rows.slice(top.length);
  d.core('recepcao', x0, 0);
  d.core('copa', x0 + 16, 0);
  top.forEach((u, i) => d.unit(u, x0 + (2 + i) * 16, 0, 16, 12, 's', 7));
  const by = 20 + CH;
  d.core('banheiros', x0, by);
  d.core('lounge', x0 + 16, by);
  bottom.forEach((u, i) => d.unit(u, x0 + (2 + i) * 16, by, 16, 12, 'n', 7));
  // células vazias das fileiras viram jardinzinho (o prédio fica fechado e bonito)
  for (let i = top.length; i < topCells; i++) d.garden(x0 + (2 + i) * 16, 0, 16, 12);
  for (let i = bottom.length; i < topCells; i++) d.garden(x0 + (2 + i) * 16, by, 16, 12);
  // anel de corredor (4 de largura) e o pátio
  d.corridor(x0, 12, IW, 4);
  d.corridor(x0, 16 + CH, IW, 4);
  d.corridor(x0, 16, 4, CH);
  d.corridor(x0 + IW - 4, 16, 4, CH);
  d.garden(x0 + 4, 16, IW - 8, CH);
  // laterais: esquerda com porta a leste, direita com porta a oeste
  side.forEach((u, i) => {
    const left = i % 2 === 0;
    const k = Math.floor(i / 2);
    if (left) d.unit(u, 0, 16 + k * 16, SW, 16, 'e', 7);
    else d.unit(u, x0 + IW, 16 + k * 16, SW, 16, 'w', 7);
  });
  const leftN = Math.ceil(side.length / 2);
  const rightN = Math.floor(side.length / 2);
  for (let k = leftN; k < L; k++) d.garden(0, 16 + k * 16, SW, 16);
  for (let k = rightN; k < L; k++) d.garden(x0 + IW, 16 + k * 16, SW, 16);
  // cantos com jardim; a faixa automática começa à direita, ligada pelo corredor de cima
  d.garden(0, 0, SW, 12);
  d.garden(0, by, SW, 12);
  d.garden(x0 + IW, by, SW, 12);
  d.garden(x0 + IW, 0, SW, 12);
  d.corridor(x0 + IW, 12, SW, 4);
  d.corridor(x0 + IW + SW, 12, 4, 5);
  return finish(d, o, { x: x0 + IW + SW + 4, y: 0, dir: 'e' }, { e: 8, s: 4 });
}

/** Torre: alas de 36 de largura (salas dos dois lados de um corredor vertical), halls em cima e embaixo ligando tudo. */
export function kvTemplateTower(o: KvCompanyOpts): KvPlan {
  const units = kvTemplateUnits(o);
  const FLOORS = 7; // pares de salas por ala
  const d = new Draw();
  const wings: Unit[][] = [];
  // ala 0: o núcleo ocupa as pontas; as outras alas usam as pontas para salas também
  let rest = [...units];
  const first = rest.splice(0, FLOORS * 2);
  wings.push(first);
  while (rest.length) wings.push(rest.splice(0, FLOORS * 2 + 4));
  const n = Math.max(2, Math.min(FLOORS, Math.ceil(first.length / 2)));
  const hallB = 16 + n * 12;
  wings.forEach((wing, w) => {
    const x = w * 40;
    let list = [...wing];
    if (w === 0) {
      d.core('recepcao', x, 0);
      d.core('copa', x + 20, 0);
      d.core('banheiros', x, hallB + 4);
      d.core('lounge', x + 20, hallB + 4);
    } else {
      // pontas da ala: duas em cima (porta embaixo) e duas embaixo (porta em cima)
      const ends = list.splice(0, 4);
      const spots: [number, number, KvDoorSide][] = [
        [x, 0, 's'],
        [x + 20, 0, 's'],
        [x, hallB + 4, 'n'],
        [x + 20, hallB + 4, 'n'],
      ];
      spots.forEach(([sx, sy, side], i) => {
        const u = ends[i];
        if (u) d.unit(u, sx, sy, 16, 12, side, 7);
        else d.garden(sx, sy, 16, 12);
      });
    }
    d.garden(x + 16, 0, 4, 12);
    d.garden(x + 16, hallB + 4, 4, 12);
    d.corridor(x + 16, 16, 4, n * 12);
    for (let k = 0; k < n; k++) {
      const a = list[k * 2];
      const b = list[k * 2 + 1];
      if (a) d.unit(a, x, 16 + k * 12, 16, 12, 'e', 5);
      else d.garden(x, 16 + k * 12, 16, 12);
      if (b) d.unit(b, x + 20, 16 + k * 12, 16, 12, 'w', 5);
      else d.garden(x + 20, 16 + k * 12, 16, 12);
    }
    list = list.slice(n * 2);
    // o que não coube (não acontece com FLOORS fixo, mas por garantia) fica para a faixa automática
  });
  const W = wings.length * 40 - 4;
  d.corridor(0, 12, W, 4);
  d.corridor(0, hallB, W, 4);
  d.corridor(W, 12, 4, 5);
  return finish(d, o, { x: W + 4, y: 0, dir: 'e' }, { e: 8, s: 4 });
}

/**
 * Galeria: braço de cima como o clássico (núcleo à esquerda), braço vertical no fim com salas dos dois lados; com
 * muitas salas, um braço de baixo volta para oeste (U). O canto de dentro vira jardim.
 */
export function kvTemplateGallery(o: KvCompanyOpts): KvPlan {
  const units = kvTemplateUnits(o);
  const N = units.length;
  const u = N >= 14;
  // colunas do braço de cima (pares de salas)
  const C = Math.max(2, Math.ceil(N / (u ? 3 : 2) / 2));
  const topUnits = units.slice(0, C * 2);
  const rest = units.slice(topUnits.length);
  // braço de baixo (U): no máximo uma sala por coluna do braço de cima
  const bottomUnits = u ? rest.splice(rest.length - Math.min(2 + C, Math.floor(rest.length / 2))) : [];
  // braço vertical: oeste (abaixo da fileira sul) e leste
  const vm = Math.max(1, Math.ceil(rest.length / 2));
  const d = new Draw();
  d.core('recepcao', 0, 0);
  d.core('copa', 16, 0);
  d.core('banheiros', 0, 17);
  d.core('lounge', 16, 17);
  topUnits.forEach((t, i) => {
    const col = 2 + Math.floor(i / 2);
    if (i % 2 === 0) d.unit(t, col * 16, 0, 16, 12, 's', 7);
    else d.unit(t, col * 16, 17, 16, 12, 'n', 7);
  });
  const X = (2 + C) * 16;
  d.corridor(0, 12, X, 5);
  // vertical: x X..X+5, de y 0 até o fim
  const vTop = 29;
  const vEnd = vTop + vm * 12;
  const west = rest.filter((_, i) => i % 2 === 0);
  const east = rest.filter((_, i) => i % 2 === 1);
  west.forEach((t, k) => d.unit(t, X - 16, vTop + k * 12, 16, 12, 'e', 5));
  for (let k = west.length; k < vm; k++) d.garden(X - 16, vTop + k * 12, 16, 12);
  // leste começa embaixo do corredor que leva à faixa automática
  east.forEach((t, k) => d.unit(t, X + 5, 17 + k * 12, 16, 12, 'w', 5));
  const eastEnd = 17 + east.length * 12;
  let bottomY = Math.max(vEnd, eastEnd);
  d.corridor(X, 0, 5, bottomY + (u ? 5 : 0));
  d.garden(X + 5, 0, 16, 12);
  d.corridor(X + 5, 12, 16, 5);
  if (eastEnd < bottomY) d.garden(X + 5, eastEnd, 16, bottomY - eastEnd);
  if (u) {
    // braço de baixo: corredor de oeste até o vertical, salas embaixo dele (porta em cima)
    d.corridor(0, bottomY, X, 5);
    const cols = Math.max(1, Math.ceil(X / 16));
    bottomUnits.forEach((t, i) => d.unit(t, X - 16 - i * 16, bottomY + 5, 16, 12, 'n', 7));
    for (let i = bottomUnits.length; i < cols; i++) if (X - 16 - i * 16 >= 0) d.garden(X - 16 - i * 16, bottomY + 5, 16, 12);
    d.garden(X + 5, bottomY, 16, 17);
    bottomY += 17;
  }
  // canto de dentro: jardim entre a fileira sul, o braço vertical e (no U) o braço de baixo
  const innerBottom = u ? bottomY - 17 : vEnd;
  if (X - 16 > 0 && innerBottom > vTop) d.garden(0, vTop, X - 16, innerBottom - vTop);
  return finish(d, o, { x: X + 21, y: 0, dir: 'e' }, { e: 8, s: 4 });
}

export function kvMakeCompany(o: KvCompanyOpts): KvPlan {
  switch (o.style) {
    case 'campus':
      return kvTemplateCampus(o);
    case 'torre':
      return kvTemplateTower(o);
    case 'galeria':
      return kvTemplateGallery(o);
    default:
      return kvTemplateClassic(o);
  }
}

/**
 * O prédio de hoje como planta (para começar a editar sem "pular"): núcleo, corredor e as salas de projeto nos lugares
 * delas (slot par = norte, ímpar = sul), as salas próprias depois. Faixa automática no fim.
 */
export function kvPlanFromClassic(rooms: readonly { ref: string; slot: number; name?: string; fixed?: boolean }[], own: readonly { id: string; name?: string }[] = []): KvPlan {
  const d = new Draw();
  d.core('recepcao', 0, 0);
  d.core('copa', 16, 0);
  d.core('banheiros', 0, 17);
  d.core('lounge', 16, 17);
  let maxSlot = -1;
  const used = new Set<number>();
  const seen = new Set<string>();
  for (const r of [...rooms].sort((a, b) => a.slot - b.slot)) {
    if (seen.has(r.ref)) continue;
    let slot = Math.max(0, Math.round(r.slot));
    while (used.has(slot)) slot++;
    used.add(slot);
    seen.add(r.ref);
    maxSlot = Math.max(maxSlot, slot);
    const col = 2 + Math.floor(slot / 2);
    const u: Unit = { kind: 'projeto', ref: r.ref, ...(r.name ? { name: r.name } : {}), ...(r.fixed ? { fixed: true } : {}) };
    if (slot % 2 === 0) d.unit(u, col * 16, 0, 16, 12, 's', 7);
    else d.unit(u, col * 16, 17, 16, 12, 'n', 7);
  }
  let slot = maxSlot + 1;
  for (const r of own) {
    while (used.has(slot)) slot++;
    used.add(slot);
    const col = 2 + Math.floor(slot / 2);
    const u: Unit = { kind: 'propria', ref: r.id, ...(r.name ? { name: r.name } : {}) };
    if (slot % 2 === 0) d.unit(u, col * 16, 0, 16, 12, 's', 7);
    else d.unit(u, col * 16, 17, 16, 12, 'n', 7);
    maxSlot = slot;
  }
  const cols = 2 + Math.max(1, Math.ceil((maxSlot + 1) / 2));
  d.corridor(0, 12, cols * 16, 5);
  return finish(d, {} as KvCompanyOpts, { x: cols * 16, y: 0, dir: 'e' }, { e: 8, s: 4 });
}
