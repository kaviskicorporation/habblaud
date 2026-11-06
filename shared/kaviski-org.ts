// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre" → "Organograma e agentes fixos"): o organograma da empresa —
// áreas (departamentos), cargo/área/gestor de cada pessoa e os agentes de IA fixos (com mesa marcada). Puro: usado
// pelo servidor (validação, filtro por papel) e pela página (árvore, desenho).
//
// Chaves dos nós: `u:<id da conta>` (pessoa), `a:<id do agente fixo>` (KvFixedAgent), `l:<id do agente ao vivo>`
// (agente do snapshot que não é fixo), `d:<id da área>` e `p:<id da sala>` (grupos do desenho).
import { kvNormFixedAgents, type KvFixedAgent, type KvPlanProblem } from './kaviski-plan';
import { kvPathKey } from './kaviski';

export const KV_DEPTS_MAX = 40;
export const KV_ORG_TITLE_MAX = 60;

/** Ícones das áreas (desenhados em pixel na página: client/src/kaviski/humanos/org-icons.ts). */
export const KV_DEPT_ICONS = ['coroa', 'codigo', 'pincel', 'grafico', 'fone', 'engrenagem', 'pessoas', 'robo', 'megafone', 'moeda', 'escudo', 'estrela', 'livro', 'foguete'] as const;
export type KvDeptIcon = (typeof KV_DEPT_ICONS)[number];

/** Cores sugeridas (a área aceita qualquer #rgb/#rrggbb). */
export const KV_DEPT_COLORS = ['#f2b33d', '#4aa3ff', '#e86fb4', '#3fcf8e', '#ff8a4c', '#9b7bff', '#35c7d6', '#e85d5d', '#a3c94a', '#c0a080'] as const;

export interface KvDept {
  /** `dp-` + até 16 letras/dígitos. */
  id: string;
  name: string;
  color: string;
  icon: KvDeptIcon;
  /** Responsável: `u:<pessoa>` ou `a:<agente fixo>`. */
  lead?: string;
  /** Área-mãe (ex.: "Front-end" dentro de "Desenvolvimento"). */
  parent?: string;
  order?: number;
}

/** O que a pessoa tem no organograma (guardado em `profile.org` da conta, users.json). */
export interface KvOrgInfo {
  title?: string;
  dept?: string;
  /** A quem responde: `u:<pessoa>` ou `a:<agente fixo>`. */
  reportsTo?: string;
}

/** Aparência opcional de um agente fixo (a mesma do editor de personagem: semente + peças). */
export interface KvOrgLook {
  seed: number;
  parts?: Record<string, unknown>;
}

/** Agente fixo como o organograma guarda (org.json): o contrato da planta + o lado da sala e a aparência. */
export interface KvOrgAgent extends KvFixedAgent {
  /** De que lado do corredor a sala estava quando a cadeira foi escolhida (espelha o y no outro lado). */
  seatSide?: 'n' | 's';
  look?: KvOrgLook;
}

/** Uma pessoa no organograma (o que a página recebe: sem usuário nem papel para quem é de fora). */
export interface KvOrgPerson extends KvOrgInfo {
  id: string;
  name: string;
  /** Só para a equipe (cliente/visitante não recebe). */
  role?: string;
  look?: { seed: number; look?: unknown; parts?: unknown; color?: string };
}

/** GET /api/kaviski/humanos/org */
export interface KvOrgDoc {
  depts: KvDept[];
  agents: KvOrgAgent[];
  people: KvOrgPerson[];
  /** O que quem pediu pode mexer: 'admin' (tudo), 'equipe' (agentes fixos), null (só ver). */
  can: 'admin' | 'equipe' | null;
  /** Áreas ainda nunca gravadas (as padrão). */
  defaults?: boolean;
}

const DEPT_ID = /^dp-[a-z0-9]{1,16}$/;
const REF_RE = /^(u|a):[A-Za-z0-9_.@-]{1,64}$/;
const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || undefined;
}

export function kvOrgRef(v: unknown): string | undefined {
  return typeof v === 'string' && REF_RE.test(v) ? v : undefined;
}

export function kvNewOrgId(prefix: 'dp' | 'ag', rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 10; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rand() * 36) % 36];
  return `${prefix}-${s}`;
}

/** As áreas de uma empresa nova (aparecem até alguém gravar as suas). Os nomes vêm traduzidos de quem chama. */
export function kvDefaultDepts(name: (pt: string) => string = (s) => s): KvDept[] {
  return [
    { id: 'dp-diretoria', name: name('Diretoria'), color: '#f2b33d', icon: 'coroa', order: 0 },
    { id: 'dp-dev', name: name('Desenvolvimento'), color: '#4aa3ff', icon: 'codigo', order: 1 },
    { id: 'dp-design', name: name('Design'), color: '#e86fb4', icon: 'pincel', order: 2 },
    { id: 'dp-comercial', name: name('Comercial'), color: '#3fcf8e', icon: 'grafico', order: 3 },
    { id: 'dp-atendimento', name: name('Atendimento'), color: '#ff8a4c', icon: 'fone', order: 4 },
    { id: 'dp-ia', name: name('Agentes de IA'), color: '#9b7bff', icon: 'robo', order: 5 },
  ];
}

/** Áreas válidas: id, nome, cor e ícone; área-mãe sem ciclo; nomes repetidos ficam (a cor diferencia). */
export function kvNormDepts(v: unknown, problems: KvPlanProblem[] = []): KvDept[] {
  if (!Array.isArray(v)) return [];
  const out: KvDept[] = [];
  const ids = new Set<string>();
  for (const raw of v.slice(0, KV_DEPTS_MAX)) {
    if (!raw || typeof raw !== 'object') continue;
    const d = raw as KvDept;
    const id = typeof d.id === 'string' && DEPT_ID.test(d.id) && !ids.has(d.id) ? d.id : null;
    const name = text(d.name, 40);
    if (!id || !name) {
      problems.push({ id: id ?? undefined, msg: 'área inválida' });
      continue;
    }
    const dept: KvDept = {
      id,
      name,
      color: typeof d.color === 'string' && COLOR_RE.test(d.color) ? d.color.toLowerCase() : KV_DEPT_COLORS[out.length % KV_DEPT_COLORS.length]!,
      icon: (KV_DEPT_ICONS as readonly string[]).includes(d.icon) ? d.icon : 'pessoas',
    };
    const lead = kvOrgRef(d.lead);
    if (lead) dept.lead = lead;
    if (typeof d.parent === 'string' && DEPT_ID.test(d.parent) && d.parent !== id) dept.parent = d.parent;
    if (typeof d.order === 'number' && Number.isFinite(d.order)) dept.order = Math.round(d.order);
    ids.add(id);
    out.push(dept);
  }
  // área-mãe que não existe ou que fecha um ciclo: sai
  const byId = new Map(out.map((d) => [d.id, d]));
  for (const d of out) {
    if (d.parent && !byId.has(d.parent)) delete d.parent;
    if (d.parent && kvWouldCycle((k) => byId.get(k)?.parent, d.id, d.parent)) {
      problems.push({ id: d.id, msg: 'área-mãe em ciclo' });
      delete d.parent;
    }
  }
  return out;
}

/** Cargo/área/gestor limpos (área precisa existir; gestor no formato `u:`/`a:` e diferente de si). */
export function kvNormOrgInfo(v: unknown, self: string, deptIds?: ReadonlySet<string>): KvOrgInfo {
  const b = (v && typeof v === 'object' ? v : {}) as KvOrgInfo;
  const out: KvOrgInfo = {};
  const title = text(b.title, KV_ORG_TITLE_MAX);
  if (title) out.title = title;
  if (typeof b.dept === 'string' && DEPT_ID.test(b.dept) && (!deptIds || deptIds.has(b.dept))) out.dept = b.dept;
  const rt = kvOrgRef(b.reportsTo);
  if (rt && rt !== self) out.reportsTo = rt;
  return out;
}

/** Agentes fixos válidos (o contrato da planta) + lado da sala e aparência. */
export function kvNormOrgAgents(v: unknown, problems: KvPlanProblem[] = [], deptIds?: ReadonlySet<string>): KvOrgAgent[] {
  const base = kvNormFixedAgents(v, problems);
  const raws = Array.isArray(v) ? (v as Partial<KvOrgAgent>[]) : [];
  return base.map((a) => {
    const raw = raws.find((r) => r && r.id === a.id) ?? {};
    const out: KvOrgAgent = { ...a };
    if (out.reportsTo === `a:${a.id}`) delete out.reportsTo;
    if (out.dept && deptIds && !deptIds.has(out.dept)) delete out.dept;
    if (raw.seatSide === 's' || raw.seatSide === 'n') out.seatSide = raw.seatSide;
    const look = raw.look as KvOrgLook | undefined;
    if (look && typeof look === 'object' && typeof look.seed === 'number' && Number.isFinite(look.seed)) {
      out.look = { seed: look.seed >>> 0 };
      if (look.parts && typeof look.parts === 'object' && JSON.stringify(look.parts).length <= 2000) out.look.parts = look.parts;
    }
    return out;
  });
}

/**
 * Pôr `parent` como gestor de `key` fecha um ciclo? (sobe a cadeia de gestores a partir de `parent`; para em 500
 * passos, o que também conta como ciclo).
 */
export function kvWouldCycle(parentOf: (key: string) => string | undefined, key: string, parent: string | undefined): boolean {
  let cur = parent;
  for (let i = 0; cur && i < 500; i++) {
    if (cur === key) return true;
    cur = parentOf(cur);
  }
  return !!cur;
}

/** Quebra os ciclos de uma relação "a quem responde": quem fecha o ciclo fica sem gestor. Devolve as chaves cortadas. */
export function kvBreakCycles(parents: Map<string, string | undefined>): string[] {
  const cut: string[] = [];
  for (const key of [...parents.keys()].sort()) {
    const p = parents.get(key);
    if (p && kvWouldCycle((k) => parents.get(k), key, p)) {
      parents.set(key, undefined);
      cut.push(key);
    }
  }
  return cut;
}

// ------------------------------------------------------------------ agentes fixos x agentes ao vivo

/** O pedaço do agente do snapshot que a regra de um agente fixo olha. */
export interface KvLiveAgent {
  id: string;
  roomId: string;
  name: string;
  kind?: string;
  provider?: string;
  parentId?: string;
  title?: string;
}

function sameRoom(a: string, b: string): boolean {
  return a === b || kvPathKey(a) === kvPathKey(b);
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase();
}

/** O agente ao vivo bate com a regra (`main`, `sub`, `provider:claude|codex`, `name:<texto>`)? */
export function kvFixedMatches(match: string, a: KvLiveAgent): boolean {
  if (match === 'main') return !a.parentId;
  if (match === 'sub') return !!a.parentId;
  if (match.startsWith('provider:')) return (a.provider ?? 'claude') === match.slice(9) && !a.parentId;
  if (match.startsWith('name:')) {
    const q = fold(match.slice(5).trim());
    return !!q && (fold(a.name).includes(q) || fold(a.title ?? '').includes(q));
  }
  return false;
}

/** Quanto a regra é específica (as mais específicas escolhem primeiro). */
function specificity(match: string): number {
  return match.startsWith('name:') ? 3 : match.startsWith('provider:') ? 2 : match === 'sub' ? 1 : 0;
}

/**
 * Qual agente ao vivo senta em cada agente fixo: na sala certa, batendo com a regra, um agente para cada fixo (as
 * regras mais específicas escolhem primeiro; empate: a ordem da lista). Devolve fixo → agente ao vivo.
 */
export function kvMatchFixedAgents(fixed: readonly Pick<KvFixedAgent, 'id' | 'room' | 'match'>[], live: readonly KvLiveAgent[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  const order = fixed.map((f, i) => ({ f, i })).sort((x, y) => specificity(y.f.match) - specificity(x.f.match) || x.i - y.i);
  for (const { f } of order) {
    const a = live.find((x) => !taken.has(x.id) && sameRoom(x.roomId, f.room) && kvFixedMatches(f.match, x));
    if (!a) continue;
    taken.add(a.id);
    out.set(f.id, a.id);
  }
  return out;
}

// ------------------------------------------------------------------ árvore

export type KvOrgKind = 'person' | 'agent' | 'live' | 'dept' | 'project';

export interface KvOrgNode {
  key: string;
  kind: KvOrgKind;
  name: string;
  title?: string;
  dept?: string;
  parent: string | null;
  /** Agente fixo: o agente ao vivo sentado nele agora (ausente = apagado). */
  liveId?: string;
}

export interface KvOrgTreeOpts {
  /** 'hierarquia' (gestor → equipe) ou 'area' (cada área um grupo, a hierarquia dentro dela). */
  group: 'hierarquia' | 'area';
  show: 'todos' | 'pessoas' | 'agentes';
  /** Nome da sala (para os grupos de agentes ao vivo). */
  roomName?: (roomId: string) => string | undefined;
  /** Rótulos dos grupos sintéticos (traduzidos por quem chama). */
  labels?: { noDept?: string; liveTeam?: string };
}

/**
 * Os nós do organograma, já com o pai de cada um (sem ciclos: quem fecharia o ciclo vira raiz).
 * - Pessoas e agentes fixos: o pai é o gestor (se aparece); no agrupamento por área, o gestor só vale dentro da mesma
 *   área — senão o pai é a área.
 * - Agentes ao vivo que não são fixos: a "equipe de IA" do projeto (`p:<sala>`), pendurada no agente fixo principal
 *   daquela sala, se houver; subagentes debaixo do agente que os chamou.
 */
export function kvOrgTree(doc: Pick<KvOrgDoc, 'depts' | 'agents' | 'people'>, live: readonly KvLiveAgent[], opts: KvOrgTreeOpts): KvOrgNode[] {
  const nodes: KvOrgNode[] = [];
  const showPeople = opts.show !== 'agentes';
  const showAgents = opts.show !== 'pessoas';
  const matched = kvMatchFixedAgents(doc.agents, live);
  const liveOfFixed = new Map([...matched].map(([f, l]) => [l, f]));
  if (showPeople) for (const p of doc.people) nodes.push({ key: `u:${p.id}`, kind: 'person', name: p.name, ...(p.title ? { title: p.title } : {}), ...(p.dept ? { dept: p.dept } : {}), parent: p.reportsTo ?? null });
  if (showAgents) {
    for (const a of doc.agents) {
      const lid = matched.get(a.id);
      nodes.push({ key: `a:${a.id}`, kind: 'agent', name: a.name, ...(a.title ? { title: a.title } : {}), ...(a.dept ? { dept: a.dept } : {}), parent: a.reportsTo ?? null, ...(lid ? { liveId: lid } : {}) });
    }
    // agentes ao vivo soltos, em equipes por projeto
    const rooms = new Map<string, KvLiveAgent[]>();
    for (const a of live) {
      if (liveOfFixed.has(a.id)) continue;
      const list = rooms.get(a.roomId) ?? [];
      list.push(a);
      rooms.set(a.roomId, list);
    }
    for (const [roomId, list] of rooms) {
      const lead = doc.agents.find((f) => sameRoom(f.room, roomId) && matched.has(f.id) && f.match !== 'sub');
      const pkey = `p:${roomId}`;
      nodes.push({ key: pkey, kind: 'project', name: opts.roomName?.(roomId) ?? roomId.split('/').filter(Boolean).pop() ?? roomId, ...(opts.labels?.liveTeam ? { title: opts.labels.liveTeam } : {}), parent: lead ? `a:${lead.id}` : null });
      for (const a of list) {
        const parentFixed = a.parentId ? liveOfFixed.get(a.parentId) : undefined;
        const parent = a.parentId && list.some((x) => x.id === a.parentId) ? `l:${a.parentId}` : parentFixed ? `a:${parentFixed}` : pkey;
        nodes.push({ key: `l:${a.id}`, kind: 'live', name: a.name, ...(a.title ? { title: a.title } : {}), parent });
      }
    }
  }
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  // gestor que não aparece aqui (filtrado, apagado): vira raiz
  for (const n of nodes) if (n.parent && !byKey.has(n.parent)) n.parent = null;
  if (opts.group === 'area') {
    const deptIds = new Set(doc.depts.map((d) => d.id));
    const used = new Set<string>();
    for (const n of nodes) {
      if (n.kind !== 'person' && n.kind !== 'agent') continue;
      const dept = n.dept && deptIds.has(n.dept) ? n.dept : '';
      const boss = n.parent ? byKey.get(n.parent) : undefined;
      const bossDept = boss && (boss.kind === 'person' || boss.kind === 'agent') ? (boss.dept && deptIds.has(boss.dept) ? boss.dept : '') : null;
      if (bossDept === dept) continue; // responde a alguém da mesma área: fica debaixo dele
      n.parent = `d:${dept || '-'}`;
      used.add(dept || '-');
    }
    // projetos sem agente fixo que os lidere: no grupo da equipe de IA
    for (const n of nodes) {
      if (n.kind === 'project' && !n.parent) {
        n.parent = 'd:ia';
        used.add('ia');
      }
    }
    const deptNodes: KvOrgNode[] = [];
    const sorted = [...doc.depts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
    // áreas-mãe também aparecem (com as filhas dentro)
    const need = new Set(used);
    for (const id of [...used]) {
      let cur = doc.depts.find((d) => d.id === id)?.parent;
      for (let i = 0; cur && i < KV_DEPTS_MAX; i++) {
        need.add(cur);
        cur = doc.depts.find((d) => d.id === cur)?.parent;
      }
    }
    for (const d of sorted) if (need.has(d.id)) deptNodes.push({ key: `d:${d.id}`, kind: 'dept', name: d.name, dept: d.id, parent: d.parent && need.has(d.parent) ? `d:${d.parent}` : null });
    if (need.has('ia')) deptNodes.push({ key: 'd:ia', kind: 'dept', name: opts.labels?.liveTeam ?? 'IA', parent: null });
    if (need.has('-')) deptNodes.push({ key: 'd:-', kind: 'dept', name: opts.labels?.noDept ?? '—', parent: null });
    nodes.unshift(...deptNodes);
  }
  const parents = new Map(nodes.map((n) => [n.key, n.parent ?? undefined]));
  for (const k of kvBreakCycles(parents)) byKey.get(k)!.parent = null;
  return nodes;
}

// ------------------------------------------------------------------ desenho (posições e linhas em degrau)

export interface KvOrgLayoutOpts {
  /** Tamanho de cada cartão (px). */
  w: number;
  h: number;
  /** Espaço entre irmãos (horizontal) e entre níveis (vertical). */
  gapX: number;
  gapY: number;
  /** Folhas (sem filhos) de um mesmo pai, a partir de quantas viram coluna empilhada (economiza largura). */
  stackFrom?: number;
  /** Grupos (área/projeto) mais baixos que os cartões. */
  groupH?: number;
}

export interface KvOrgPlaced {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface KvOrgLayout {
  boxes: KvOrgPlaced[];
  /** Linhas em degrau: pontos [x, y] em sequência (pai → filho). */
  edges: { from: string; to: string; pts: [number, number][] }[];
  width: number;
  height: number;
}

/**
 * Árvore de cima para baixo: cada pai centralizado sobre os filhos; filhos que são todos folhas (e muitos) ficam numa
 * coluna empilhada, ligados por uma linha vertical ao lado. Linhas em "degrau": desce do pai, anda na horizontal e desce
 * até o filho. Puro (para testar e para exportar como imagem).
 */
export function kvOrgLayout(nodes: readonly Pick<KvOrgNode, 'key' | 'parent' | 'kind'>[], o: KvOrgLayoutOpts): KvOrgLayout {
  const stackFrom = o.stackFrom ?? 4;
  const kids = new Map<string | null, string[]>();
  const kindOf = new Map(nodes.map((n) => [n.key, n.kind]));
  for (const n of nodes) {
    const p = n.parent && kindOf.has(n.parent) ? n.parent : null;
    const list = kids.get(p) ?? [];
    list.push(n.key);
    kids.set(p, list);
  }
  const hOf = (k: string) => (kindOf.get(k) === 'dept' || kindOf.get(k) === 'project' ? (o.groupH ?? o.h) : o.h);
  const stacked = (k: string) => {
    const c = kids.get(k) ?? [];
    return c.length >= stackFrom && c.every((x) => !(kids.get(x)?.length));
  };
  const width = new Map<string, number>();
  const measure = (k: string): number => {
    const c = kids.get(k) ?? [];
    let w = o.w;
    if (c.length && stacked(k)) w = Math.max(o.w, o.w * 0.5 + o.gapX + o.w);
    else if (c.length) w = Math.max(o.w, c.reduce((s, x) => s + measure(x), 0) + o.gapX * (c.length - 1));
    width.set(k, w);
    return w;
  };
  const boxes: KvOrgPlaced[] = [];
  const edges: KvOrgLayout['edges'] = [];
  const pos = new Map<string, KvOrgPlaced>();
  let maxY = 0;
  const place = (k: string, left: number, y: number): void => {
    const w = width.get(k) ?? o.w;
    const c = kids.get(k) ?? [];
    const bh = hOf(k);
    const isStack = c.length > 0 && stacked(k);
    // pai de coluna empilhada fica à esquerda; os outros, no meio dos filhos
    const bx = isStack ? left : left + (w - o.w) / 2;
    const box = { key: k, x: Math.round(bx), y: Math.round(y), w: o.w, h: bh };
    boxes.push(box);
    pos.set(k, box);
    maxY = Math.max(maxY, y + bh);
    if (!c.length) return;
    const cy = y + bh + o.gapY;
    if (isStack) {
      const spine = Math.round(bx + o.w * 0.25);
      const cx = Math.round(bx + o.w * 0.5 + o.gapX);
      c.forEach((ck, i) => {
        const yy = cy + i * (o.h + o.gapY * 0.5);
        const b = { key: ck, x: cx, y: Math.round(yy), w: o.w, h: o.h };
        boxes.push(b);
        pos.set(ck, b);
        maxY = Math.max(maxY, yy + o.h);
        edges.push({ from: k, to: ck, pts: [[spine, box.y + bh], [spine, Math.round(yy + o.h / 2)], [cx, Math.round(yy + o.h / 2)]] });
      });
      return;
    }
    let x = left;
    const mid = Math.round(y + bh + o.gapY / 2);
    for (const ck of c) {
      place(ck, x, cy);
      const b = pos.get(ck)!;
      const px = Math.round(box.x + o.w / 2);
      const cx = Math.round(b.x + o.w / 2);
      edges.push({ from: k, to: ck, pts: px === cx ? [[px, box.y + bh], [cx, b.y]] : [[px, box.y + bh], [px, mid], [cx, mid], [cx, b.y]] });
      x += (width.get(ck) ?? o.w) + o.gapX;
    }
  };
  let x = 0;
  for (const r of kids.get(null) ?? []) {
    measure(r);
    place(r, x, 0);
    x += (width.get(r) ?? o.w) + o.gapX * 2;
  }
  return { boxes, edges, width: Math.max(0, x - o.gapX * 2), height: maxY };
}
