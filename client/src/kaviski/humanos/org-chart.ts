// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre" → "Organograma e agentes fixos"): o organograma da empresa.
//
// Árvore com cartões em pixel (boneco de verdade, nome, cargo, área na cor dela, status ao vivo), linhas em degrau,
// agrupada por hierarquia ou por área, filtros Pessoas / Agentes / Todos, busca, zoom e arrastar, recolher equipes,
// exportar como PNG. Clicar num cartão abre o detalhe (cartão da pessoa, mensagem, ver o agente no escritório, editar).
// Agentes ao vivo que não são fixos aparecem como "equipe de IA" do projeto. Celular (ou o botão Lista): lista
// recolhível em vez da árvore.
//
// `kvOpenOrgChart()` abre a janela (o quadro da sala do RH/diretoria usa, pela ação 'organograma'); `KvOrgView` é a peça
// que a tela Pessoas embute na aba Organograma.
import type { AgentInfo, OfficeSnapshot } from '../../../../shared/types';
import type { KvPresencePerson } from '../../../../shared/kaviski-presence';
import { kvOrgLayout, kvOrgTree, type KvLiveAgent, type KvOrgDoc, type KvOrgLayout, type KvOrgNode } from '../../../../shared/kaviski-org';
import { hash32 } from '../../../../shared/hash';
import { tr } from '../../../../shared/i18n';
import type { OfficeStore } from '../../net/store';
import { h } from '../../ui/dom';
import { kvDept, kvLoadOrg, kvOnOrg, kvOrg, kvOrgName } from './org-api';
import { KV_DEPT_ICON_SVG, KV_ORG_ICONS } from './org-icons';
import { kvPeople, STATUS_LABEL } from './world';
import { kvOpenPersonCard } from './person-card';
import { kvOpenDirect } from './chat';
import { KV_ICONS, kvAvatar, kvBtn, kvCap, kvEmpty, kvIconBtn, kvInput, kvTitle } from './ui/kit';
import { kvSeg } from './ui/section';
import { KvModal } from './ui/modal';
import { kvToast } from './ui/toast';
import './org-chart.css';

const CARD_W = 200;
const CARD_H = 86;
const GROUP_H = 58;

type Group = 'hierarquia' | 'area';
type Show = 'todos' | 'pessoas' | 'agentes';

let store: OfficeStore | null = null;
/** Quem abre o editor de um agente fixo e a tela Pessoas (registrados por fixed-agents.ts e people.ts). */
export const kvOrgHooks: { editAgent?: (id: string) => void; editPerson?: (id: string) => void; newAgent?: () => void } = {};

export function kvSetOrgStore(s: OfficeStore): void {
  store = s;
}

const AGENT_STATUS: Record<string, () => string> = {
  working: () => tr('trabalhando'),
  waiting: () => tr('esperando você'),
  shell: () => tr('esperando um comando'),
  idle: () => tr('à toa'),
  done: () => tr('terminou'),
  offline: () => tr('fora'),
};

const LS_GROUP = 'habblaud.kv.org.group';
const LS_SHOW = 'habblaud.kv.org.show';

function lsGet<T extends string>(k: string, ok: readonly T[], d: T): T {
  try {
    const v = localStorage.getItem(k) as T | null;
    return v && ok.includes(v) ? v : d;
  } catch {
    return d;
  }
}
function lsSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    // sem armazenamento: só não lembra
  }
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase();
}

function liveAgents(snap: OfficeSnapshot | null): { list: KvLiveAgent[]; byId: Map<string, AgentInfo> } {
  const byId = new Map<string, AgentInfo>();
  const list: KvLiveAgent[] = [];
  for (const a of snap?.agents ?? []) {
    if (a.status === 'offline') continue;
    byId.set(a.id, a);
    list.push({ id: a.id, roomId: a.roomId, name: a.name, kind: a.kind, ...(a.provider ? { provider: a.provider } : {}), ...(a.parentId ? { parentId: a.parentId } : {}), ...(a.title ? { title: a.title } : {}) });
  }
  return { list, byId };
}

export class KvOrgView {
  readonly el: HTMLElement;
  private readonly vp: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly lines: SVGSVGElement;
  private readonly listBox: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly zoomLabel: HTMLElement;
  private readonly search;
  private readonly legend: HTMLElement;
  private readonly count: HTMLElement;
  private group: Group = lsGet<Group>(LS_GROUP, ['hierarquia', 'area'], 'hierarquia');
  private show: Show = lsGet<Show>(LS_SHOW, ['todos', 'pessoas', 'agentes'], 'todos');
  private listMode = false;
  private collapsed = new Set<string>();
  private nodes: KvOrgNode[] = [];
  private layout: KvOrgLayout | null = null;
  private cards = new Map<string, HTMLElement>();
  private z = 1;
  private tx = 0;
  private ty = 0;
  private fitted = false;
  private sig = '';
  private selected: string | null = null;
  private timer = 0;

  constructor(private readonly opts: { onClose?: () => void; embedded?: boolean } = {}) {
    const groupSeg = kvSeg<Group>(
      [
        { value: 'hierarquia', label: tr('Hierarquia'), icon: KV_ORG_ICONS.org },
        { value: 'area', label: tr('Por área'), icon: KV_ORG_ICONS.tree },
      ],
      this.group,
      (v) => {
        this.group = v;
        lsSet(LS_GROUP, v);
        this.fitted = false;
        this.render(true);
      },
      tr('Agrupar'),
    );
    const showSeg = kvSeg<Show>(
      [
        { value: 'todos', label: tr('Todos') },
        { value: 'pessoas', label: tr('Pessoas'), icon: KV_ICONS.users },
        { value: 'agentes', label: tr('Agentes'), icon: KV_ORG_ICONS.robot },
      ],
      this.show,
      (v) => {
        this.show = v;
        lsSet(LS_SHOW, v);
        this.fitted = false;
        this.render(true);
      },
      tr('Mostrar'),
    );
    this.search = kvInput({ placeholder: tr('Buscar nome, cargo ou área'), icon: KV_ICONS.search, type: 'search', onInput: () => this.highlight(true) });
    this.search.input.addEventListener('keydown', (e) => e.stopPropagation());
    this.zoomLabel = h('span', { class: 'kv-org__zoom-n', text: '100%' });
    const zoom = h(
      'div',
      { class: 'kv-org__zoom', role: 'group', attrs: { 'aria-label': tr('Zoom') } },
      kvIconBtn(KV_ORG_ICONS.zoomOut, tr('Afastar'), () => this.zoomBy(1 / 1.25), { size: 'sm' }),
      this.zoomLabel,
      kvIconBtn(KV_ORG_ICONS.zoomIn, tr('Aproximar'), () => this.zoomBy(1.25), { size: 'sm' }),
      kvIconBtn(KV_ORG_ICONS.fit, tr('Encaixar tudo na tela'), () => this.fit(), { size: 'sm' }),
    );
    const listBtn = kvIconBtn(KV_ORG_ICONS.list, tr('Ver como lista'), () => {
      this.listMode = !this.listMode;
      listBtn.setAttribute('aria-pressed', String(this.listMode));
      this.render(true);
    }, { size: 'sm', cls: 'kv-org__listbtn' });
    const png = kvBtn(tr('Imagem'), { icon: KV_ORG_ICONS.image, size: 'sm', title: tr('Exportar o organograma como imagem (PNG)'), onClick: () => void this.exportPng() });
    this.count = h('span', { class: 'kv-org__count' });
    this.legend = h('div', { class: 'kv-org__legend' });
    this.vp = h('div', { class: 'kv-org__vp', tabIndex: 0, attrs: { 'aria-label': tr('Organograma: arraste para mover, roda para o zoom') } });
    this.lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.lines.classList.add('kv-org__lines');
    this.stage = h('div', { class: 'kv-org__stage' });
    this.stage.append(this.lines);
    this.vp.append(this.stage);
    this.listBox = h('div', { class: 'kv-org__listview', hidden: true });
    this.detail = h('aside', { class: 'kv-org__detail', hidden: true, attrs: { 'aria-live': 'polite' } });
    this.el = h(
      'div',
      { class: `kv-org${opts.embedded ? ' is-embedded' : ''}` },
      h('div', { class: 'kv-org__bar' }, groupSeg.el, showSeg.el, h('div', { class: 'kv-org__search' }, this.search.el), h('span', { class: 'kv-org__spacer' }), this.count, listBtn, zoom, png),
      this.legend,
      h('div', { class: 'kv-org__main' }, this.vp, this.listBox, this.detail),
    );
    this.bindPan();
    kvOnOrg(() => this.render());
    store?.on('snapshot', () => this.soon());
    kvPeople.client?.on(() => this.soon());
  }

  /** Redesenha logo (a presença chega ~10 vezes por segundo: junta). */
  private soon(): void {
    if (this.timer || !this.el.isConnected) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.render();
    }, 400);
  }

  async refresh(): Promise<void> {
    this.listMode = this.listMode || window.innerWidth < 720;
    if (!kvOrg()) this.vp.replaceChildren(h('div', { class: 'kv-org__loading', text: tr('Carregando…') }));
    await kvLoadOrg();
    this.vp.replaceChildren(this.stage);
    this.fitted = false;
    this.render(true);
  }

  focus(key: string): void {
    this.selected = key;
    this.render(true);
    this.centerOn(key);
    this.openDetail(key);
  }

  // ------------------------------------------------------------------ dados

  private presence(): Map<string, KvPresencePerson> {
    return new Map((kvPeople.client?.state?.people ?? []).map((p) => [p.id, p]));
  }

  private build(doc: KvOrgDoc): { nodes: KvOrgNode[]; byLive: Map<string, AgentInfo> } {
    const snap = store?.liveSnapshot ?? null;
    const { list, byId } = liveAgents(snap);
    const roomName = (id: string) => snap?.rooms.find((r) => r.id === id)?.name;
    const nodes = kvOrgTree(doc, list, { group: this.group, show: this.show, roomName, labels: { noDept: tr('Sem área'), liveTeam: tr('Equipe de IA') } });
    return { nodes, byLive: byId };
  }

  /** Esconde os filhos das equipes recolhidas. */
  private visible(nodes: KvOrgNode[]): KvOrgNode[] {
    if (!this.collapsed.size) return nodes;
    const byKey = new Map(nodes.map((n) => [n.key, n]));
    const hidden = (n: KvOrgNode): boolean => {
      let p = n.parent;
      for (let i = 0; p && i < 500; i++) {
        if (this.collapsed.has(p)) return true;
        p = byKey.get(p)?.parent ?? null;
      }
      return false;
    };
    return nodes.filter((n) => !hidden(n));
  }

  // ------------------------------------------------------------------ desenho

  render(force = false): void {
    const doc = kvOrg();
    if (!doc) return;
    const { nodes, byLive } = this.build(doc);
    const pres = this.presence();
    const sig = JSON.stringify([this.group, this.show, this.listMode, [...this.collapsed], nodes.map((n) => [n.key, n.parent, n.name, n.title, n.dept, n.liveId]), [...pres.values()].map((p) => [p.id, p.status]), [...byLive.values()].map((a) => [a.id, a.status])]);
    if (!force && sig === this.sig) return;
    this.sig = sig;
    this.nodes = nodes;
    const people = nodes.filter((n) => n.kind === 'person').length;
    const agents = nodes.filter((n) => n.kind === 'agent' || n.kind === 'live').length;
    this.count.textContent = tr('{0} pessoas · {1} agentes', [people, agents]);
    this.renderLegend(doc);
    const kids = new Map<string, number>();
    for (const n of nodes) if (n.parent) kids.set(n.parent, (kids.get(n.parent) ?? 0) + 1);
    if (!nodes.length) {
      this.vp.hidden = false;
      this.listBox.hidden = true;
      this.vp.replaceChildren(kvEmpty(KV_ORG_ICONS.org, tr('Organograma vazio'), doc.can === 'admin' ? tr('Na tela Pessoas, dê um cargo, uma área e um gestor a cada pessoa.') : tr('Ainda não há ninguém aqui.')));
      return;
    }
    if (this.vp.firstElementChild !== this.stage) this.vp.replaceChildren(this.stage);
    this.vp.hidden = this.listMode;
    this.listBox.hidden = !this.listMode;
    if (this.listMode) return this.renderList(nodes, kids, byLive, pres);
    const vis = this.visible(nodes);
    const L = kvOrgLayout(vis, { w: CARD_W, h: CARD_H, gapX: 22, gapY: 46, stackFrom: 4, groupH: GROUP_H });
    this.layout = L;
    const pad = 40;
    this.stage.style.width = `${L.width + pad * 2}px`;
    this.stage.style.height = `${L.height + pad * 2}px`;
    // linhas em degrau
    this.lines.setAttribute('width', String(L.width + pad * 2));
    this.lines.setAttribute('height', String(L.height + pad * 2));
    const byKey = new Map(vis.map((n) => [n.key, n]));
    const paths = L.edges.map((e) => {
      const d = e.pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x + pad} ${y + pad}`).join(' ');
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      const to = byKey.get(e.to);
      const color = kvDept(to?.dept)?.color;
      if (color) p.style.setProperty('--c', color);
      if (to?.kind === 'live' || to?.kind === 'project') p.classList.add('is-ai');
      p.dataset.to = e.to;
      p.dataset.from = e.from;
      return p;
    });
    this.lines.replaceChildren(...paths);
    // cartões
    const keep = new Set<string>();
    for (const b of L.boxes) {
      const n = byKey.get(b.key)!;
      keep.add(n.key);
      const card = this.card(n, kids.get(n.key) ?? 0, byLive, pres, doc);
      card.style.transform = `translate(${b.x + pad}px, ${b.y + pad}px)`;
      card.style.width = `${b.w}px`;
      card.style.height = `${b.h}px`;
      const old = this.cards.get(n.key);
      if (old) old.replaceWith(card);
      else this.stage.append(card);
      this.cards.set(n.key, card);
    }
    for (const [k, el] of this.cards) {
      if (keep.has(k)) continue;
      el.remove();
      this.cards.delete(k);
    }
    if (!this.fitted) {
      this.fitted = true;
      requestAnimationFrame(() => this.fit());
    }
    this.highlight(false);
  }

  private renderLegend(doc: KvOrgDoc): void {
    const used = new Set(this.nodes.map((n) => n.dept).filter(Boolean));
    const chips = doc.depts
      .filter((d) => used.has(d.id))
      .map((d) => {
        const ico = h('span', { class: 'kv-org__chip-ico', attrs: { 'aria-hidden': 'true' } });
        ico.innerHTML = KV_DEPT_ICON_SVG[d.icon];
        const b = h('button', { class: 'kv-org__chip', type: 'button', title: tr('Destacar {0}', [d.name]), on: { click: () => ((this.search.input.value = d.name), this.highlight(true)) } }, ico, h('span', { text: d.name }));
        b.style.setProperty('--c', d.color);
        return b;
      });
    this.legend.replaceChildren(
      ...chips,
      h('span', { class: 'kv-org__key' }, h('span', { class: 'kv-org__key-dot is-live' }), tr('ao vivo')),
      h('span', { class: 'kv-org__key' }, h('span', { class: 'kv-org__key-dot is-off' }), tr('apagado: fora agora')),
    );
  }

  private avatarFor(n: KvOrgNode, byLive: Map<string, AgentInfo>, pres: Map<string, KvPresencePerson>, doc: KvOrgDoc, size: 'sm' | 'md' | 'lg'): HTMLElement {
    if (n.kind === 'person') {
      const id = n.key.slice(2);
      const p = pres.get(id);
      const look = p?.look ?? (doc.people.find((x) => x.id === id)?.look as KvPresencePerson['look'] | undefined);
      return kvAvatar({ id, name: n.name, look: look && typeof look.seed === 'number' ? look : undefined }, size, p ? p.status : 'off');
    }
    const liveId = n.kind === 'live' ? n.key.slice(2) : n.liveId;
    const live = liveId ? byLive.get(liveId) : undefined;
    const fixed = n.kind === 'agent' ? doc.agents.find((a) => `a:${a.id}` === n.key) : undefined;
    const seed = fixed?.look?.seed ?? live?.seed ?? hash32(n.key);
    const look = { seed, look: (live?.look ?? (seed % 2 ? 'f' : 'm')) as 'f' | 'm', parts: (fixed?.look?.parts ?? live?.parts) as KvPresencePerson['look']['parts'], color: kvDept(n.dept)?.color ?? '#9b7bff' };
    const el = kvAvatar({ id: n.key, name: n.name, look }, size, null);
    el.classList.add('is-ai');
    el.append(h('span', { class: `kv-org__ai-st kv-org__st--${live?.status ?? 'off'}`, title: live ? kvCap(AGENT_STATUS[live.status]?.() ?? live.status) : tr('apagado: fora agora') }));
    return el;
  }

  private card(n: KvOrgNode, kids: number, byLive: Map<string, AgentInfo>, pres: Map<string, KvPresencePerson>, doc: KvOrgDoc): HTMLElement {
    const dept = kvDept(n.dept);
    const color = dept?.color ?? (n.kind === 'project' || n.kind === 'live' ? '#9b7bff' : '#7a8499');
    const isGroup = n.kind === 'dept' || n.kind === 'project';
    const toggle =
      kids > 0
        ? h(
            'button',
            {
              class: `kv-org__kids${this.collapsed.has(n.key) ? ' is-closed' : ''}`,
              type: 'button',
              title: this.collapsed.has(n.key) ? tr('Mostrar a equipe ({0})', [kids]) : tr('Recolher a equipe ({0})', [kids]),
              on: {
                click: (e: Event) => {
                  e.stopPropagation();
                  if (this.collapsed.has(n.key)) this.collapsed.delete(n.key);
                  else this.collapsed.add(n.key);
                  this.render(true);
                },
                pointerdown: (e: Event) => e.stopPropagation(),
              },
            },
            h('span', { text: String(kids) }),
          )
        : null;
    let el: HTMLElement;
    if (isGroup) {
      const ico = h('span', { class: 'kv-org__group-ico', attrs: { 'aria-hidden': 'true' } });
      ico.innerHTML = n.kind === 'project' ? KV_ORG_ICONS.robot : dept ? KV_DEPT_ICON_SVG[dept.icon] : n.key === 'd:ia' ? KV_DEPT_ICON_SVG.robo : KV_DEPT_ICON_SVG.pessoas;
      const lead = dept?.lead ? kvOrgName(dept.lead) : undefined;
      el = h(
        'div',
        { class: `kv-org__card is-group is-${n.kind}`, attrs: { 'data-key': n.key } },
        ico,
        h('div', { class: 'kv-org__who' }, kvTitle('strong', n.name, 'kv-org__name'), h('span', { class: 'kv-org__title', text: n.kind === 'project' ? tr('Equipe de IA') : lead ? tr('Responsável: {0}', [lead]) : tr('Área') })),
        toggle,
      );
    } else {
      const live = n.kind === 'live' ? byLive.get(n.key.slice(2)) : n.liveId ? byLive.get(n.liveId) : undefined;
      const off = n.kind === 'person' ? !pres.has(n.key.slice(2)) : !live;
      const p = n.kind === 'person' ? pres.get(n.key.slice(2)) : undefined;
      const sub =
        n.kind === 'person'
          ? p
            ? kvCap(STATUS_LABEL[p.status])
            : ''
          : live
            ? kvCap(AGENT_STATUS[live.status]?.() ?? live.status)
            : '';
      const deptChip = dept ? h('span', { class: 'kv-org__dept', text: dept.name }) : null;
      const tag = n.kind === 'agent' ? h('span', { class: 'kv-org__tag', text: tr('IA fixo') }) : n.kind === 'live' ? h('span', { class: 'kv-org__tag is-live', text: tr('IA') }) : null;
      el = h(
        'div',
        { class: `kv-org__card is-${n.kind}${off ? ' is-off' : ''}`, attrs: { 'data-key': n.key } },
        this.avatarFor(n, byLive, pres, doc, 'md'),
        h(
          'div',
          { class: 'kv-org__who' },
          h('strong', { class: 'kv-org__name', text: n.name }),
          h('span', { class: 'kv-org__title', text: n.title || (n.kind === 'live' ? (live?.role ?? '') : '') || '—' }),
          h('span', { class: 'kv-org__meta' }, deptChip, tag, sub ? h('span', { class: 'kv-org__sub', text: sub }) : null),
        ),
        toggle,
      );
    }
    el.style.setProperty('--c', color);
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', [n.name, n.title, dept?.name].filter(Boolean).join(', '));
    if (this.selected === n.key) el.classList.add('is-sel');
    el.addEventListener('click', () => this.openDetail(n.key));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.openDetail(n.key);
      }
    });
    return el;
  }

  private renderList(nodes: KvOrgNode[], kids: Map<string, number>, byLive: Map<string, AgentInfo>, pres: Map<string, KvPresencePerson>): void {
    const doc = kvOrg()!;
    const children = new Map<string | null, KvOrgNode[]>();
    for (const n of nodes) {
      const k = n.parent;
      children.set(k, [...(children.get(k) ?? []), n]);
    }
    const item = (n: KvOrgNode, depth: number): HTMLElement => {
      const c = children.get(n.key) ?? [];
      const dept = kvDept(n.dept);
      const row = h(
        'div',
        { class: `kv-org__lrow is-${n.kind}`, role: 'button', tabIndex: 0, on: { click: () => this.openDetail(n.key) } },
        n.kind === 'dept' || n.kind === 'project' ? h('span', { class: 'kv-org__lgroup' }) : this.avatarFor(n, byLive, pres, doc, 'sm'),
        h('span', { class: 'kv-org__lwho' }, h('strong', { text: n.name }), h('span', { text: [n.title, dept?.name].filter(Boolean).join(' · ') || ' ' })),
      );
      row.style.setProperty('--c', dept?.color ?? '#7a8499');
      if (!c.length) return h('li', {}, row);
      const det = h('details', { class: 'kv-org__ldet' }, h('summary', {}, row, h('span', { class: 'kv-org__lcount', text: String(kids.get(n.key) ?? c.length) })), h('ul', {}, ...c.map((x) => item(x, depth + 1))));
      det.open = depth < 1;
      return h('li', {}, det);
    };
    this.listBox.replaceChildren(h('ul', { class: 'kv-org__list' }, ...(children.get(null) ?? []).map((n) => item(n, 0))));
  }

  /** Busca: destaca quem bate e apaga o resto; leva a câmera ao primeiro. */
  private highlight(move: boolean): void {
    const q = fold(this.search.input.value.trim());
    let first: string | null = null;
    for (const n of this.nodes) {
      const el = this.cards.get(n.key);
      if (!el) continue;
      const hit = !!q && fold(`${n.name} ${n.title ?? ''} ${kvDept(n.dept)?.name ?? ''}`).includes(q);
      el.classList.toggle('is-hit', hit);
      el.classList.toggle('is-dim', !!q && !hit);
      if (hit && !first) first = n.key;
    }
    this.lines.classList.toggle('is-dim', !!q);
    if (move && first) this.centerOn(first);
  }

  // ------------------------------------------------------------------ detalhe

  private openDetail(key: string): void {
    const doc = kvOrg();
    const n = this.nodes.find((x) => x.key === key);
    if (!doc || !n) return;
    this.selected = key;
    for (const [k, el] of this.cards) el.classList.toggle('is-sel', k === key);
    if (n.kind === 'dept' || n.kind === 'project') {
      if (this.collapsed.has(key)) this.collapsed.delete(key);
      this.centerOn(key);
      this.detail.hidden = true;
      return;
    }
    const snap = store?.liveSnapshot ?? null;
    const { byId } = liveAgents(snap);
    const pres = this.presence();
    const dept = kvDept(n.dept);
    const team = this.nodes.filter((x) => x.parent === key && x.kind !== 'dept' && x.kind !== 'project').length;
    const boss = this.nodes.find((x) => x.key === n.parent && (x.kind === 'person' || x.kind === 'agent'));
    const facts: [string, string][] = [];
    if (dept) facts.push([tr('Área'), dept.name]);
    if (boss) facts.push([tr('Responde a'), boss.name]);
    if (team) facts.push([tr('Equipe'), tr('{0} pessoa(s) ou agente(s)', [team])]);
    const actions: HTMLElement[] = [];
    const close = () => this.opts.onClose?.();
    if (n.kind === 'person') {
      const id = key.slice(2);
      const p = pres.get(id);
      const me = kvPeople.client?.state?.me;
      if (p) facts.push([tr('Agora'), kvCap(STATUS_LABEL[p.status])]);
      if (p && id !== me) actions.push(kvBtn(tr('Abrir o cartão'), { variant: 'primary', icon: KV_ICONS.user, onClick: () => (close(), kvOpenPersonCard(id)) }));
      if (id !== me) actions.push(kvBtn(tr('Mensagem'), { icon: KV_ICONS.chat, onClick: () => (close(), kvOpenDirect(id)) }));
      if (doc.can === 'admin' && kvOrgHooks.editPerson) actions.push(kvBtn(tr('Editar'), { icon: KV_ICONS.edit, onClick: () => kvOrgHooks.editPerson!(id) }));
    } else {
      const fixed = n.kind === 'agent' ? doc.agents.find((a) => `a:${a.id}` === key) : undefined;
      const liveId = n.kind === 'live' ? key.slice(2) : n.liveId;
      const live = liveId ? byId.get(liveId) : undefined;
      const room = snap?.rooms.find((r) => r.id === (live?.roomId ?? fixed?.room) || r.id.toLowerCase() === fixed?.room);
      if (room) facts.push([tr('Sala'), room.name]);
      facts.push([tr('Agora'), live ? kvCap(AGENT_STATUS[live.status]?.() ?? live.status) : tr('apagado: fora agora')]);
      if (live && fixed) facts.push([tr('Quem está sentado'), live.name]);
      if (fixed) facts.push([tr('Mesa'), fixed.seat ? tr('cadeira marcada') : tr('o Habblaud escolhe')]);
      if (live) actions.push(kvBtn(tr('Ver no escritório'), { variant: 'primary', icon: KV_ICONS.walk, onClick: () => (close(), selectAgent(live.id)) }));
      if (fixed && doc.can && kvOrgHooks.editAgent) actions.push(kvBtn(tr('Editar'), { icon: KV_ICONS.edit, onClick: () => kvOrgHooks.editAgent!(fixed.id) }));
    }
    const dl = h('dl', { class: 'kv-org__facts' }, ...facts.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v }))));
    const big = this.avatarFor(n, byId, pres, doc, 'lg');
    this.detail.replaceChildren(
      h('div', { class: 'kv-org__dhead' }, big, h('div', {}, h('strong', { class: 'kv-org__dname', text: n.name }), h('span', { class: 'kv-org__dtitle', text: n.title ?? '' }))),
      dl,
      h('div', { class: 'kv-org__dacts' }, ...actions),
      kvIconBtn(KV_ICONS.close, tr('Fechar'), () => ((this.detail.hidden = true), (this.selected = null), this.render(true)), { size: 'sm', cls: 'kv-org__dclose' }),
    );
    if (dept) this.detail.style.setProperty('--c', dept.color);
    else this.detail.style.removeProperty('--c');
    this.detail.hidden = false;
  }

  // ------------------------------------------------------------------ câmera do organograma

  private apply(): void {
    this.stage.style.transform = `translate(${Math.round(this.tx)}px, ${Math.round(this.ty)}px) scale(${this.z})`;
    this.zoomLabel.textContent = `${Math.round(this.z * 100)}%`;
  }

  fit(): void {
    if (!this.layout || this.listMode) return;
    const r = this.vp.getBoundingClientRect();
    if (!r.width) return;
    const w = this.layout.width + 80;
    const hh = this.layout.height + 80;
    // tudo na tela, mas sem ficar ilegível: abaixo de 60% começa no topo e o resto se vê arrastando
    this.z = Math.max(0.6, Math.min(1.05, r.width / w, r.height / hh));
    this.tx = (r.width - w * this.z) / 2;
    this.ty = hh * this.z > r.height ? 8 : (r.height - hh * this.z) / 2;
    this.apply();
  }

  private zoomBy(f: number, cx?: number, cy?: number): void {
    const r = this.vp.getBoundingClientRect();
    const x = cx ?? r.width / 2;
    const y = cy ?? r.height / 2;
    const nz = Math.max(0.2, Math.min(2.5, this.z * f));
    this.tx = x - ((x - this.tx) * nz) / this.z;
    this.ty = y - ((y - this.ty) * nz) / this.z;
    this.z = nz;
    this.apply();
  }

  private centerOn(key: string): void {
    const b = this.layout?.boxes.find((x) => x.key === key);
    if (!b) return;
    const r = this.vp.getBoundingClientRect();
    if (this.z < 0.7) this.z = 0.85;
    this.tx = r.width / 2 - (b.x + 40 + b.w / 2) * this.z;
    this.ty = r.height / 2 - (b.y + 40 + b.h / 2) * this.z;
    this.stage.classList.add('is-moving');
    this.apply();
    setTimeout(() => this.stage.classList.remove('is-moving'), 400);
  }

  private bindPan(): void {
    const pts = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinch = 0;
    this.vp.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
      this.vp.setPointerCapture(e.pointerId);
      this.vp.classList.add('is-grab');
    });
    this.vp.addEventListener('pointermove', (e) => {
      const last = pts.get(e.pointerId);
      if (!last) return;
      if (pts.size === 2) {
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const r = this.vp.getBoundingClientRect();
        if (pinch) this.zoomBy(d / pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        pinch = d;
        moved += 10;
        return;
      }
      this.tx += e.clientX - last.x;
      this.ty += e.clientY - last.y;
      moved += Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.apply();
    });
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (!pts.size) this.vp.classList.remove('is-grab');
      pinch = 0;
    };
    this.vp.addEventListener('pointerup', up);
    this.vp.addEventListener('pointercancel', up);
    // arrastou: o clique no fim não abre o cartão
    this.vp.addEventListener('click', (e) => {
      if (moved > 6) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);
    this.vp.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = this.vp.getBoundingClientRect();
        if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) this.zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
        else {
          this.tx -= e.deltaX;
          this.apply();
        }
      },
      { passive: false },
    );
    this.vp.addEventListener('keydown', (e) => {
      const step = 60;
      if (e.key === '+' || e.key === '=') this.zoomBy(1.2);
      else if (e.key === '-') this.zoomBy(1 / 1.2);
      else if (e.key === 'ArrowLeft') this.tx += step;
      else if (e.key === 'ArrowRight') this.tx -= step;
      else if (e.key === 'ArrowUp') this.ty += step;
      else if (e.key === 'ArrowDown') this.ty -= step;
      else if (e.key === '0') this.fit();
      else return;
      e.preventDefault();
      e.stopPropagation();
      this.apply();
    });
  }

  // ------------------------------------------------------------------ PNG

  private async exportPng(): Promise<void> {
    const L = this.layout;
    const doc = kvOrg();
    if (!L || !doc || this.listMode) {
      kvToast(tr('Abra a árvore (não a lista) para exportar.'), { kind: 'error' });
      return;
    }
    const pad = 40;
    const scale = 2;
    const head = 70;
    const c = document.createElement('canvas');
    c.width = (L.width + pad * 2) * scale;
    c.height = (L.height + pad * 2 + head) * scale;
    const g = c.getContext('2d')!;
    g.scale(scale, scale);
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#141821';
    g.fillRect(0, 0, c.width, c.height);
    // xadrez em pixel no fundo
    g.fillStyle = 'rgba(255,255,255,0.025)';
    for (let y = 0; y < c.height / scale; y += 16) for (let x = (y / 16) % 2 ? 16 : 0; x < c.width / scale; x += 32) g.fillRect(x, y, 16, 16);
    g.fillStyle = '#e8ecf5';
    g.font = '600 22px "Pixelify Sans", system-ui, sans-serif';
    g.fillText(tr('Organograma'), pad, 40);
    g.font = '13px system-ui, sans-serif';
    g.fillStyle = '#9aa4b8';
    g.fillText(`${this.count.textContent ?? ''} · ${new Date().toLocaleDateString()}`, pad, 60);
    g.translate(0, head);
    const byKey = new Map(this.nodes.map((n) => [n.key, n]));
    g.lineWidth = 2;
    for (const e of L.edges) {
      g.strokeStyle = kvDept(byKey.get(e.to)?.dept)?.color ?? '#5b6478';
      g.globalAlpha = 0.7;
      g.beginPath();
      e.pts.forEach(([x, y], i) => (i ? g.lineTo(x + pad, y + pad) : g.moveTo(x + pad, y + pad)));
      g.stroke();
    }
    g.globalAlpha = 1;
    const imgs = await Promise.all(
      L.boxes.map(async (b) => {
        const img = this.cards.get(b.key)?.querySelector<HTMLImageElement>('.ui-avatar img');
        if (img && !img.complete) await new Promise((ok) => img.addEventListener('load', ok, { once: true }));
        return img;
      }),
    );
    L.boxes.forEach((b, i) => {
      const n = byKey.get(b.key)!;
      const dept = kvDept(n.dept);
      const color = dept?.color ?? (n.kind === 'project' || n.kind === 'live' ? '#9b7bff' : '#7a8499');
      const x = b.x + pad;
      const y = b.y + pad;
      const group = n.kind === 'dept' || n.kind === 'project';
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.fillRect(x, y + 3, b.w, b.h);
      g.fillStyle = group ? color : '#232938';
      g.fillRect(x, y, b.w, b.h);
      g.fillStyle = color;
      g.fillRect(x, y, b.w, 4);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(x, y + 4, b.w, 1);
      const img = imgs[i];
      let tx = x + 12;
      if (img && !group) {
        const s = Math.min(40 / img.naturalHeight, 1.5);
        g.drawImage(img, x + 10, y + (b.h - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
        tx = x + 58;
      }
      g.fillStyle = group ? '#11141b' : '#e8ecf5';
      g.font = `700 ${group ? 14 : 13}px system-ui, sans-serif`;
      g.fillText(clip(g, n.name, x + b.w - tx - 8), tx, y + (group ? 26 : 30));
      g.font = '12px system-ui, sans-serif';
      g.fillStyle = group ? 'rgba(17,20,27,0.75)' : '#9aa4b8';
      const sub = group ? (n.kind === 'project' ? tr('Equipe de IA') : tr('Área')) : n.title ?? '';
      g.fillText(clip(g, sub, x + b.w - tx - 8), tx, y + (group ? 44 : 48));
      if (dept && !group) {
        g.fillStyle = color;
        g.font = '600 11px system-ui, sans-serif';
        g.fillText(clip(g, dept.name, x + b.w - tx - 8), tx, y + 66);
      }
    });
    const url = c.toDataURL('image/png');
    const a = h('a', { attrs: { href: url, download: `organograma-${new Date().toISOString().slice(0, 10)}.png` } });
    document.body.append(a);
    a.click();
    a.remove();
    kvToast(tr('Imagem do organograma baixada.'), { kind: 'ok' });
  }
}

function clip(g: CanvasRenderingContext2D, s: string, max: number): string {
  if (g.measureText(s).width <= max) return s;
  let t = s;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** Seleciona o agente no escritório (abre a gaveta e leva a câmera). */
function selectAgent(id: string): void {
  const w = (window as { habblaud?: { world?: { select(sel: { type: 'agent'; id: string }, o?: { focus?: boolean }): void } } }).habblaud?.world;
  w?.select({ type: 'agent', id }, { focus: true });
}

let modal: KvModal | null = null;
let view: KvOrgView | null = null;

/** Abre a janela do organograma (opcional: já com alguém destacado, `u:<id>` ou `a:<id>`). */
export function kvOpenOrgChart(opts: { focus?: string } = {}): void {
  if (!modal) {
    modal = new KvModal({ title: tr('Organograma'), subtitle: tr('Quem é quem na empresa: pessoas e agentes de IA.'), icon: KV_ORG_ICONS.org, width: 1320, cls: 'kv-orgm' });
    view = new KvOrgView({ onClose: () => modal?.close() });
    modal.body.append(view.el);
  }
  modal.show();
  void view!.refresh().then(() => {
    if (opts.focus) view!.focus(opts.focus);
  });
}
