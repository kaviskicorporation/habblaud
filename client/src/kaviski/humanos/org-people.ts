// Fork Kaviski (KAVISKI-HUMANOS.md → "Organograma e agentes fixos"): o organograma dentro da tela Pessoas.
// - `kvOrgFormSection()`: a seção "Organograma" do formulário da conta (cargo, área com a cor, gestor com o boneco);
// - `KvDeptsPane`: a aba Áreas (nome, cor, ícone, área-mãe, responsável), gravada de uma vez;
// - `KvAgentsPane`: a aba Agentes fixos (lista, novo, editar, apagar, ir até a mesa).
import { KV_DEPT_COLORS, KV_DEPT_ICONS, kvNewOrgId, kvWouldCycle, type KvDept, type KvDeptIcon, type KvOrgAgent, type KvOrgDoc, type KvOrgInfo } from '../../../../shared/kaviski-org';
import { hash32 } from '../../../../shared/hash';
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { kvDept, kvLoadOrg, kvOnOrg, kvOrg, kvOrgName, kvSaveDepts, kvSaveOrgPerson } from './org-api';
import { KV_DEPT_ICON_SVG, KV_ORG_ICONS, kvDeptIconLabel } from './org-icons';
import { KV_ICONS, kvAvatar, kvBtn, kvEmpty, kvField, kvIconBtn, kvInput, kvTitle } from './ui/kit';
import { KvSelect, type KvOption } from './ui/select';
import { kvConfirm } from './ui/modal';
import { kvToast } from './ui/toast';
import { kvSection } from './ui/section';
import './org.css';

/** O quadradinho colorido com o ícone da área (select, cartões, lista). */
export function kvDeptBadge(d: Pick<KvDept, 'color' | 'icon'> | undefined, size: 'sm' | 'md' = 'sm'): HTMLElement {
  const el = h('span', { class: `kv-dept-badge kv-dept-badge--${size}`, attrs: { 'aria-hidden': 'true' } });
  if (d) {
    el.innerHTML = KV_DEPT_ICON_SVG[d.icon];
    el.style.setProperty('--c', d.color);
  } else el.classList.add('is-none');
  return el;
}

/** Chip "área" na cor dela (cartões da tela Pessoas, cartão da pessoa, lista de online). */
export function kvDeptChip(id: string | undefined): HTMLElement | null {
  const d = kvDept(id);
  if (!d) return null;
  const el = h('span', { class: 'kv-dept-chip', title: d.name }, kvDeptBadge(d), h('span', { text: d.name }));
  el.style.setProperty('--c', d.color);
  return el;
}

function deptOptions(doc: KvOrgDoc | null): KvOption<string>[] {
  return [
    { value: '', label: tr('Sem área'), icon: kvDeptBadge(undefined) },
    ...(doc?.depts ?? []).map((d) => ({ value: d.id, label: d.name, icon: kvDeptBadge(d), ...(d.parent ? { hint: kvDept(d.parent)?.name } : {}) })),
  ];
}

/** Gestores possíveis para `self` (sem quem fecharia um ciclo). */
function bossOptions(doc: KvOrgDoc | null, self: string | null): KvOption<string>[] {
  const boss = new Map<string, string | undefined>();
  for (const p of doc?.people ?? []) boss.set(`u:${p.id}`, p.reportsTo);
  for (const a of doc?.agents ?? []) boss.set(`a:${a.id}`, a.reportsTo);
  const ok = (key: string) => key !== self && !(self && kvWouldCycle((k) => boss.get(k), self, key));
  const opts: KvOption<string>[] = [{ value: '', label: tr('Ninguém (topo do organograma)'), icon: KV_ORG_ICONS.org }];
  for (const p of doc?.people ?? []) {
    const key = `u:${p.id}`;
    if (!ok(key)) continue;
    opts.push({ value: key, label: p.name, hint: [p.title, kvDept(p.dept)?.name].filter(Boolean).join(' · ') || undefined, icon: kvAvatar({ id: p.id, name: p.name, look: p.look && typeof p.look.seed === 'number' ? (p.look as never) : undefined }, 'xs') });
  }
  for (const a of doc?.agents ?? []) {
    const key = `a:${a.id}`;
    if (!ok(key)) continue;
    opts.push({ value: key, label: a.name, hint: [tr('agente de IA'), a.title].filter(Boolean).join(' · '), icon: kvAvatar({ id: key, name: a.name, look: { seed: a.look?.seed ?? hash32(key), look: 'f', color: kvDept(a.dept)?.color ?? '#9b7bff' } }, 'xs') });
  }
  return opts;
}

export interface KvOrgForm {
  el: HTMLElement;
  /** Preenche com o organograma da pessoa (null = conta nova). */
  load(personId: string | null): void;
  /** Grava se mudou. Devolve o erro ou null. */
  save(personId: string): Promise<string | null>;
}

/** A seção "Organograma" do formulário da conta. */
export function kvOrgFormSection(): KvOrgForm {
  let self: string | null = null;
  let loaded: KvOrgInfo = {};
  const title = kvInput({ placeholder: tr('ex.: Desenvolvedora sênior'), maxlength: 60 });
  const dept = new KvSelect<string>({ label: tr('Área'), options: deptOptions(kvOrg()), value: '', search: false });
  const boss = new KvSelect<string>({ label: tr('Responde a'), options: bossOptions(kvOrg(), null), value: '', search: true });
  const fTitle = kvField(tr('Cargo'), title.el, { optional: true });
  const fDept = kvField(tr('Área'), dept.el, { optional: true });
  const fBoss = kvField(tr('Responde a'), boss.el, { optional: true, hint: tr('A pessoa (ou agente de IA) que é gestora dela.') });
  const el = kvSection(KV_ORG_ICONS.org, tr('Organograma'), tr('Cargo, área e gestor: aparecem no cartão e no organograma.'), h('div', { class: 'kv-pp__row' }, fTitle.el, fDept.el), fBoss.el);
  el.classList.add('kv-org-form');
  const sync = () => {
    const doc = kvOrg();
    dept.setOptions(deptOptions(doc));
    boss.setOptions(bossOptions(doc, self ? `u:${self}` : null));
  };
  kvOnOrg(sync);
  return {
    el,
    load(personId) {
      self = personId;
      const p = personId ? kvOrg()?.people.find((x) => x.id === personId) : undefined;
      loaded = { ...(p?.title ? { title: p.title } : {}), ...(p?.dept ? { dept: p.dept } : {}), ...(p?.reportsTo ? { reportsTo: p.reportsTo } : {}) };
      sync();
      title.input.value = loaded.title ?? '';
      dept.value = loaded.dept ?? '';
      boss.value = loaded.reportsTo ?? '';
      el.hidden = !kvOrg();
    },
    async save(personId) {
      const info: KvOrgInfo = {};
      const t = title.input.value.trim();
      if (t) info.title = t;
      if (dept.value) info.dept = dept.value;
      if (boss.value) info.reportsTo = boss.value;
      if (JSON.stringify(info) === JSON.stringify(loaded) && self === personId) return null;
      const err = await kvSaveOrgPerson(personId, info);
      if (!err) loaded = info;
      return err;
    },
  };
}

// ------------------------------------------------------------------ aba Áreas

export class KvDeptsPane {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly note: HTMLElement;
  private draft: KvDept[] = [];
  private dirty = false;

  constructor() {
    this.list = h('ul', { class: 'kv-depts__list' });
    this.note = h('p', { class: 'kv-depts__note' });
    this.saveBtn = kvBtn(tr('Salvar as áreas'), { variant: 'primary', icon: KV_ICONS.check, onClick: () => void this.save() });
    const add = kvBtn(tr('Nova área'), { icon: KV_ICONS.plus, onClick: () => this.add() });
    this.el = h(
      'div',
      { class: 'kv-pp__pane kv-depts' },
      h('div', { class: 'kv-depts__head' }, h('div', {}, kvTitle('strong', tr('Áreas da empresa')), h('p', { class: 'kv-pp__muted', text: tr('Departamentos com cor e ícone. Cada pessoa e agente de IA fica numa área; o organograma pode agrupar por elas.') })), add),
      this.list,
      h('div', { class: 'kv-depts__foot' }, this.note, this.saveBtn),
    );
    kvOnOrg(() => {
      if (!this.dirty) this.reset();
    });
  }

  async open(): Promise<void> {
    await kvLoadOrg();
    this.reset();
  }

  private reset(): void {
    const doc = kvOrg();
    this.draft = (doc?.depts ?? []).map((d) => ({ ...d }));
    this.dirty = false;
    this.note.textContent = doc?.defaults ? tr('Estas são as áreas sugeridas: mude o que quiser e salve.') : '';
    this.render();
  }

  private touch(): void {
    this.dirty = true;
    this.note.textContent = tr('Há mudanças não salvas.');
  }

  private add(): void {
    this.draft.push({ id: kvNewOrgId('dp'), name: tr('Nova área'), color: KV_DEPT_COLORS[this.draft.length % KV_DEPT_COLORS.length]!, icon: 'estrela', order: this.draft.length });
    this.touch();
    this.render();
    this.list.querySelector<HTMLInputElement>('li:last-child input')?.select();
  }

  private render(): void {
    const doc = kvOrg();
    const leadOpts = bossOptions(doc, null).map((o) => (o.value === '' ? { ...o, label: tr('Sem responsável') } : o));
    const counts = new Map<string, number>();
    for (const p of doc?.people ?? []) if (p.dept) counts.set(p.dept, (counts.get(p.dept) ?? 0) + 1);
    for (const a of doc?.agents ?? []) if (a.dept) counts.set(a.dept, (counts.get(a.dept) ?? 0) + 1);
    this.list.replaceChildren(
      ...this.draft.map((d, i) => {
        const name = kvInput({ value: d.name, maxlength: 40, onInput: (v) => ((d.name = v), this.touch()) });
        const badge = kvDeptBadge(d, 'md');
        const color = h('input', { class: 'kv-depts__color', type: 'color', attrs: { 'aria-label': tr('Cor de {0}', [d.name]) } });
        color.value = d.color.length === 4 ? `#${[...d.color.slice(1)].map((c) => c + c).join('')}` : d.color;
        color.addEventListener('input', () => {
          d.color = color.value;
          badge.style.setProperty('--c', d.color);
          row.style.setProperty('--c', d.color);
          this.touch();
        });
        const swatches = h(
          'div',
          { class: 'kv-depts__swatches' },
          ...KV_DEPT_COLORS.map((c) =>
            h('button', {
              class: `kv-depts__sw${c === d.color ? ' is-on' : ''}`,
              type: 'button',
              title: c,
              style: `--c:${c}`,
              on: { click: () => ((d.color = c), this.touch(), this.render()) },
            }),
          ),
          color,
        );
        const icon = new KvSelect<KvDeptIcon>({
          label: tr('Ícone'),
          value: d.icon,
          options: KV_DEPT_ICONS.map((k) => ({ value: k, label: kvDeptIconLabel(k), icon: kvDeptBadge({ icon: k, color: d.color }) })),
          onChange: (v) => ((d.icon = v), this.touch(), this.render()),
        });
        const parent = new KvSelect<string>({
          label: tr('Dentro de'),
          value: d.parent ?? '',
          options: [{ value: '', label: tr('Área principal') }, ...this.draft.filter((x) => x.id !== d.id && !kvWouldCycle((k) => this.draft.find((y) => y.id === k)?.parent, d.id, x.id)).map((x) => ({ value: x.id, label: x.name, icon: kvDeptBadge(x) }))],
          onChange: (v) => {
            if (v) d.parent = v;
            else delete d.parent;
            this.touch();
          },
        });
        const lead = new KvSelect<string>({
          label: tr('Responsável'),
          value: d.lead ?? '',
          search: true,
          options: leadOpts,
          onChange: (v) => {
            if (v) d.lead = v;
            else delete d.lead;
            this.touch();
          },
        });
        const up = kvIconBtn(KV_ICONS.chevron, tr('Subir'), () => this.move(i, -1), { size: 'sm', cls: 'kv-depts__up' });
        const down = kvIconBtn(KV_ICONS.chevron, tr('Descer'), () => this.move(i, 1), { size: 'sm' });
        up.disabled = i === 0;
        down.disabled = i === this.draft.length - 1;
        const del = kvIconBtn(KV_ICONS.trash, tr('Apagar {0}', [d.name]), () => void this.remove(i), { size: 'sm', cls: 'kv-pp__card-del' });
        const n = counts.get(d.id) ?? 0;
        const row = h(
          'li',
          { class: 'kv-depts__item' },
          badge,
          h(
            'div',
            { class: 'kv-depts__main' },
            h('div', { class: 'kv-depts__line' }, name.el, h('span', { class: 'kv-depts__n', text: n ? tr('{0} na área', [n]) : tr('vazia') })),
            swatches,
            h('div', { class: 'kv-depts__line kv-depts__selects' }, kvField(tr('Ícone'), icon.el).el, kvField(tr('Dentro de'), parent.el).el, kvField(tr('Responsável'), lead.el).el),
          ),
          h('div', { class: 'kv-depts__acts' }, up, down, del),
        );
        row.style.setProperty('--c', d.color);
        return row;
      }),
    );
    if (!this.draft.length) this.list.append(h('li', {}, kvEmpty(KV_ORG_ICONS.org, tr('Nenhuma área'), tr('Crie a primeira: Diretoria, Desenvolvimento, Design…'))));
  }

  private move(i: number, d: number): void {
    const j = i + d;
    if (j < 0 || j >= this.draft.length) return;
    [this.draft[i], this.draft[j]] = [this.draft[j]!, this.draft[i]!];
    this.draft.forEach((x, k) => (x.order = k));
    this.touch();
    this.render();
  }

  private async remove(i: number): Promise<void> {
    const d = this.draft[i];
    if (!d) return;
    const ok = await kvConfirm({ title: tr('Apagar a área {0}?', [d.name]), text: tr('Quem está nela fica sem área (dá para escolher outra depois). Só vale ao salvar.'), ok: tr('Apagar área'), danger: true });
    if (!ok) return;
    this.draft.splice(i, 1);
    for (const x of this.draft) if (x.parent === d.id) delete x.parent;
    this.touch();
    this.render();
  }

  private async save(): Promise<void> {
    this.draft.forEach((x, k) => (x.order = k));
    this.saveBtn.disabled = true;
    const err = await kvSaveDepts(this.draft);
    this.saveBtn.disabled = false;
    if (err) return void kvToast(err, { kind: 'error' });
    this.dirty = false;
    kvToast(tr('Áreas salvas.'), { kind: 'ok' });
    await kvLoadOrg();
    this.reset();
  }
}

// ------------------------------------------------------------------ aba Agentes fixos

export const MATCH_LABEL = (m: string): string =>
  m === 'main' ? tr('o agente principal da sala') : m === 'sub' ? tr('um subagente da sala') : m === 'provider:claude' ? tr('o Claude Code da sala') : m === 'provider:codex' ? tr('o Codex da sala') : m.startsWith('name:') ? tr('o agente com "{0}" no nome', [m.slice(5)]) : m;

export class KvAgentsPane {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;

  constructor(
    private readonly hooks: { edit: (a: KvOrgAgent | null) => void; goSeat: (a: KvOrgAgent) => void; roomName: (id: string) => string | undefined; live: (a: KvOrgAgent) => { name: string; seed: number; look: 'f' | 'm'; parts?: unknown } | undefined },
  ) {
    this.list = h('ul', { class: 'kv-fa__list' });
    this.el = h(
      'div',
      { class: 'kv-pp__pane kv-fa' },
      h(
        'div',
        { class: 'kv-depts__head' },
        h('div', {}, kvTitle('strong', tr('Agentes de IA fixos')), h('p', { class: 'kv-pp__muted', text: tr('Um lugar marcado para um agente: quem bate com a regra senta sempre na mesma cadeira e entra no organograma. Dica: clique numa cadeira de sala com o boneco e escolha "Fixar um agente aqui".') })),
        kvBtn(tr('Novo agente fixo'), { variant: 'primary', icon: KV_ICONS.plus, onClick: () => hooks.edit(null) }),
      ),
      this.list,
    );
    kvOnOrg(() => this.render());
  }

  async open(): Promise<void> {
    await kvLoadOrg();
    this.render();
  }

  render(): void {
    const doc = kvOrg();
    const agents = doc?.agents ?? [];
    this.list.replaceChildren(
      ...agents.map((a) => {
        const dept = kvDept(a.dept);
        const ag = this.hooks.live(a);
        const live = ag?.name;
        const key = `a:${a.id}`;
        const seed = a.look?.seed ?? ag?.seed ?? hash32(key);
        const av = kvAvatar({ id: key, name: a.name, look: { seed, look: a.look?.look ?? ag?.look ?? (seed & 1 ? 'f' : 'm'), parts: (a.look?.parts ?? ag?.parts) as never, color: dept?.color ?? '#9b7bff' } }, 'md', null);
        av.classList.add('is-ai');
        const row = h(
          'li',
          { class: `kv-fa__item${live ? ' is-live' : ''}` },
          av,
          h(
            'div',
            { class: 'kv-fa__main' },
            h('div', { class: 'kv-pp__card-top' }, h('strong', { class: 'kv-pp__name', text: a.name }), a.title ? h('span', { class: 'kv-pp__muted', text: a.title }) : null, kvDeptChip(a.dept)),
            h('div', { class: 'kv-fa__meta' }, h('span', { text: tr('Sala: {0}', [this.hooks.roomName(a.room) ?? a.room.split('/').filter(Boolean).pop() ?? a.room]) }), h('span', { text: MATCH_LABEL(a.match) }), a.reportsTo ? h('span', { text: tr('responde a {0}', [kvOrgName(a.reportsTo) ?? '—']) }) : null),
            h('div', { class: 'kv-fa__state' }, h('span', { class: `kv-fa__dot${live ? ' is-on' : ''}` }), h('span', { text: live ? tr('Sentado agora: {0}', [live]) : tr('Sem agente agora: a mesa fica com a plaquinha') }), h('span', { class: 'kv-pp__muted', text: a.seat ? tr('· cadeira marcada') : tr('· sem cadeira marcada') })),
          ),
          h('div', { class: 'kv-pp__card-actions' }, a.seat ? kvIconBtn(KV_ICONS.walk, tr('Ir até a mesa de {0}', [a.name]), () => this.hooks.goSeat(a), { size: 'sm' }) : null, kvIconBtn(KV_ICONS.edit, tr('Editar {0}', [a.name]), () => this.hooks.edit(a), { size: 'sm' })),
        );
        if (dept) row.style.setProperty('--c', dept.color);
        return row;
      }),
    );
    if (!agents.length) this.list.append(h('li', {}, kvEmpty(KV_ORG_ICONS.robot, tr('Nenhum agente fixo ainda'), tr('Fixe o agente principal de cada projeto numa mesa: ele senta sempre ali e aparece no organograma.'), kvBtn(tr('Novo agente fixo'), { variant: 'primary', icon: KV_ICONS.plus, onClick: () => this.hooks.edit(null) }))));
  }
}
