// Fork Kaviski (KAVISKI-HUMANOS.md → "Organograma e agentes fixos"): editar o organograma ali mesmo — o painel do
// cartão (cargo, área, a quem responde), arrastar um cartão sobre outro (gestor) ou sobre uma área, fixar um agente
// ao vivo com um clique (ele vira agente fixo e pode ficar debaixo de uma pessoa) e a personalização da vista
// (tamanho dos cartões, status, empilhar equipes, agentes soltos), guardada no navegador.
import type { KvLiveAgent, KvOrgAgent, KvOrgDoc, KvOrgInfo } from '../../../../shared/kaviski-org';
import { kvWouldCycle } from '../../../../shared/kaviski-org';
import { hash32 } from '../../../../shared/hash';
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { kvDept, kvSaveFixedAgent, kvSaveOrgPerson } from './org-api';
import { KV_ORG_ICONS } from './org-icons';
import { kvDeptBadge } from './org-people';
import { KV_ICONS, kvAvatar, kvBtn, kvField, kvInput } from './ui/kit';
import { KvSelect, type KvOption } from './ui/select';
import { kvToast } from './ui/toast';

// ------------------------------------------------------------------ personalização da vista

export type KvOrgSize = 'compacto' | 'normal' | 'grande';

export interface KvOrgPrefs {
  size: KvOrgSize;
  /** Mostra o status ao vivo (trabalhando, disponível…) nos cartões. */
  status: boolean;
  /** Equipes grandes sem subequipes viram coluna empilhada. */
  stack: boolean;
  /** Agentes ao vivo que não são fixos (as "equipes de IA" dos projetos). */
  live: boolean;
  /** Pinta o fundo do cartão com a cor da área. */
  tint: boolean;
}

const LS_PREFS = 'habblaud.kv.org.prefs';
const DEFAULT_PREFS: KvOrgPrefs = { size: 'normal', status: true, stack: true, live: true, tint: false };

export const KV_ORG_SIZES: Record<KvOrgSize, { w: number; h: number; gapX: number; gapY: number }> = {
  compacto: { w: 168, h: 62, gapX: 16, gapY: 34 },
  normal: { w: 200, h: 86, gapX: 22, gapY: 46 },
  grande: { w: 236, h: 104, gapX: 28, gapY: 56 },
};

export function kvOrgPrefs(): KvOrgPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_PREFS) ?? '{}') as Partial<KvOrgPrefs>;
    return {
      size: raw.size && raw.size in KV_ORG_SIZES ? raw.size : DEFAULT_PREFS.size,
      status: typeof raw.status === 'boolean' ? raw.status : DEFAULT_PREFS.status,
      stack: typeof raw.stack === 'boolean' ? raw.stack : DEFAULT_PREFS.stack,
      live: typeof raw.live === 'boolean' ? raw.live : DEFAULT_PREFS.live,
      tint: typeof raw.tint === 'boolean' ? raw.tint : DEFAULT_PREFS.tint,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function kvSaveOrgPrefs(p: KvOrgPrefs): void {
  try {
    localStorage.setItem(LS_PREFS, JSON.stringify(p));
  } catch {
    // sem armazenamento: vale só agora
  }
}

/** O painel "Personalizar" (abre debaixo do botão). `paint()` repinta as escolhas. */
export function kvOrgPrefsPanel(get: () => KvOrgPrefs, set: (p: KvOrgPrefs) => void): { el: HTMLElement; paint: () => void } {
  const marks: [HTMLButtonElement, () => boolean][] = [];
  const choice = <T extends string>(items: [T, string][], cur: () => T, pick: (v: T) => void): HTMLButtonElement[] =>
    items.map(([v, label]) => {
      const b = h('button', { class: 'kv-orgp__opt', type: 'button', text: label, on: { click: () => (pick(v), paint()) } });
      marks.push([b, () => cur() === v]);
      return b;
    });
  const onOff = (k: 'status' | 'stack' | 'live' | 'tint') => choice<'1' | '0'>([['1', tr('Sim')], ['0', tr('Não')]], () => (get()[k] ? '1' : '0'), (v) => set({ ...get(), [k]: v === '1' }));
  const row = (label: string, ctrl: HTMLElement[]) => h('div', { class: 'kv-orgp__row' }, h('span', { class: 'kv-orgp__label', text: label }), h('div', { class: 'kv-orgp__ctrl' }, ...ctrl));
  const paint = () => {
    for (const [b, on] of marks) b.setAttribute('aria-pressed', String(on()));
  };
  const el = h(
    'div',
    { class: 'kv-orgp', hidden: true, attrs: { role: 'dialog', 'aria-label': tr('Personalizar o organograma') } },
    h('strong', { class: 'kv-orgp__title', text: tr('Personalizar') }),
    row(tr('Tamanho dos cartões'), choice<KvOrgSize>([['compacto', tr('Compacto')], ['normal', tr('Normal')], ['grande', tr('Grande')]], () => get().size, (v) => set({ ...get(), size: v }))),
    row(tr('Mostrar o status ao vivo'), onOff('status')),
    row(tr('Empilhar equipes grandes'), onOff('stack')),
    row(tr('Agentes ao vivo sem lugar fixo'), onOff('live')),
    row(tr('Fundo na cor da área'), onOff('tint')),
    h('p', { class: 'kv-orgp__hint', text: tr('Fica guardado neste navegador.') }),
  );
  paint();
  return { el, paint };
}

// ------------------------------------------------------------------ gravar

/** "A quem responde" de todo mundo no organograma (para não deixar fazer ciclo). */
function bossMap(doc: KvOrgDoc): Map<string, string | undefined> {
  const m = new Map<string, string | undefined>();
  for (const p of doc.people) m.set(`u:${p.id}`, p.reportsTo);
  for (const a of doc.agents) m.set(`a:${a.id}`, a.reportsTo);
  return m;
}

/** `boss` pode ser gestor de `key`? (existe, não é ele mesmo, não fecha ciclo). */
export function kvCanBoss(doc: KvOrgDoc, key: string, boss: string): boolean {
  const m = bossMap(doc);
  return key !== boss && m.has(boss) && !kvWouldCycle((k) => m.get(k), key, boss);
}

/** Quem pode mexer em qual cartão: pessoas só o admin; agentes (fixos e ao vivo) a equipe toda. */
export function kvCanEditNode(doc: KvOrgDoc, key: string): boolean {
  if (key.startsWith('u:')) return doc.can === 'admin';
  if (key.startsWith('a:') || key.startsWith('l:')) return !!doc.can;
  return false;
}

/** Grava cargo/área/gestor de uma pessoa (`u:`) ou de um agente fixo (`a:`). Devolve o erro ou null. */
export async function kvSaveOrgNode(doc: KvOrgDoc, key: string, info: KvOrgInfo): Promise<string | null> {
  const clean: KvOrgInfo = {};
  if (info.title) clean.title = info.title;
  if (info.dept) clean.dept = info.dept;
  if (info.reportsTo) clean.reportsTo = info.reportsTo;
  if (key.startsWith('u:')) return kvSaveOrgPerson(key.slice(2), clean);
  const a = doc.agents.find((x) => `a:${x.id}` === key);
  if (!a) return tr('agente fixo não encontrado');
  const next: Partial<KvOrgAgent> = { ...a };
  delete next.title;
  delete next.dept;
  delete next.reportsTo;
  const r = await kvSaveFixedAgent({ ...next, ...clean });
  return r.error ?? null;
}

/** Muda só uma coisa (o gestor ou a área) mantendo o resto. */
export function kvPatchOrgNode(doc: KvOrgDoc, key: string, patch: Partial<Record<keyof KvOrgInfo, string | null>>): Promise<string | null> {
  const cur: KvOrgInfo = key.startsWith('u:') ? { ...(doc.people.find((p) => `u:${p.id}` === key) ?? {}) } : { ...(doc.agents.find((a) => `a:${a.id}` === key) ?? {}) };
  const info: KvOrgInfo = { title: cur.title, dept: cur.dept, reportsTo: cur.reportsTo };
  for (const [k, v] of Object.entries(patch) as [keyof KvOrgInfo, string | null][]) info[k] = v ?? undefined;
  return kvSaveOrgNode(doc, key, info);
}

/**
 * Fixa um agente ao vivo: vira agente fixo daquela sala (o principal pelo provedor; subagente pelo nome), já com o
 * gestor ou a área, se vierem. Devolve o agente gravado ou o erro.
 */
export async function kvFixLiveAgent(a: KvLiveAgent, extra: KvOrgInfo = {}): Promise<{ agent?: KvOrgAgent; error?: string }> {
  const match = a.parentId ? `name:${a.name.slice(0, 40)}` : `provider:${a.provider === 'codex' ? 'codex' : 'claude'}`;
  const draft: Partial<KvOrgAgent> = { name: a.name.slice(0, 40), room: a.roomId, match };
  if (a.title) draft.title = a.title.slice(0, 60);
  if (extra.title) draft.title = extra.title;
  if (extra.dept) draft.dept = extra.dept;
  if (extra.reportsTo) draft.reportsTo = extra.reportsTo;
  return kvSaveFixedAgent(draft);
}

// ------------------------------------------------------------------ painel do cartão

function bossOptions(doc: KvOrgDoc, self: string): KvOption<string>[] {
  const ok = (k: string) => kvCanBoss(doc, self, k);
  return [
    { value: '', label: tr('Ninguém (topo do organograma)'), icon: KV_ORG_ICONS.org },
    ...doc.people.filter((p) => ok(`u:${p.id}`)).map((p) => ({ value: `u:${p.id}`, label: p.name, hint: p.title ?? tr('pessoa'), keywords: p.title, icon: kvAvatar({ id: p.id, name: p.name, look: p.look && typeof p.look.seed === 'number' ? (p.look as never) : undefined }, 'xs') })),
    ...doc.agents.filter((a) => ok(`a:${a.id}`)).map((a) => ({ value: `a:${a.id}`, label: a.name, hint: a.title ?? tr('agente de IA'), keywords: a.title, icon: kvAvatar({ id: a.id, name: a.name, look: { seed: a.look?.seed ?? hash32(`a:${a.id}`), look: 'f', color: kvDept(a.dept)?.color ?? '#9b7bff' } }, 'xs') })),
  ];
}

/**
 * O formulário curto do cartão em modo edição: cargo, área e a quem responde. Para um agente ao vivo (`l:`), salvar
 * fixa o agente antes. `live` só vem para `l:`.
 */
export function kvOrgEditForm(doc: KvOrgDoc, key: string, opts: { live?: KvLiveAgent; onSaved?: (key: string) => void; more?: HTMLElement[] }): HTMLElement {
  const cur: KvOrgInfo = key.startsWith('u:') ? (doc.people.find((p) => `u:${p.id}` === key) ?? {}) : key.startsWith('a:') ? (doc.agents.find((a) => `a:${a.id}` === key) ?? {}) : { title: opts.live?.title };
  const title = kvInput({ placeholder: key.startsWith('u:') ? tr('ex.: Diretora de projetos') : tr('ex.: Desenvolvedor front-end'), value: cur.title ?? '', maxlength: 60 });
  title.input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') void save();
  });
  const dept = new KvSelect<string>({ label: tr('Área'), value: cur.dept ?? '', options: [{ value: '', label: tr('Sem área'), icon: kvDeptBadge(undefined) }, ...doc.depts.map((d) => ({ value: d.id, label: d.name, icon: kvDeptBadge(d) }))] });
  // agente ao vivo ainda não tem chave de fixo: confere o ciclo como se fosse um nó novo (qualquer um serve)
  const boss = new KvSelect<string>({ label: tr('Responde a'), value: cur.reportsTo ?? '', search: true, options: bossOptions(doc, key.startsWith('l:') ? '\u0000novo' : key) });
  const err = h('p', { class: 'kv-org__eerr', attrs: { role: 'alert' }, hidden: true });
  const btn = kvBtn(key.startsWith('l:') ? tr('Fixar e salvar') : tr('Salvar'), { variant: 'primary', icon: KV_ICONS.check, size: 'sm', onClick: () => void save() });
  const save = async () => {
    btn.disabled = true;
    err.hidden = true;
    const info: KvOrgInfo = { title: title.input.value.trim() || undefined, dept: dept.value || undefined, reportsTo: boss.value || undefined };
    let e: string | null;
    let savedKey = key;
    if (key.startsWith('l:')) {
      const r = opts.live ? await kvFixLiveAgent(opts.live, info) : { error: tr('agente não encontrado') };
      e = r.error ?? null;
      if (r.agent) savedKey = `a:${r.agent.id}`;
    } else e = await kvSaveOrgNode(doc, key, info);
    btn.disabled = false;
    if (e) {
      err.textContent = e;
      err.hidden = false;
      return;
    }
    kvToast(tr('Organograma salvo.'), { kind: 'ok' });
    opts.onSaved?.(savedKey);
  };
  return h(
    'div',
    { class: 'kv-org__edit' },
    key.startsWith('l:') ? h('p', { class: 'kv-org__ehint', text: tr('Este agente ainda não tem lugar fixo. Salvar o fixa no organograma (e ele pode ficar debaixo de uma pessoa).') }) : null,
    kvField(tr('Cargo'), title.el, { optional: true }).el,
    kvField(tr('Área'), dept.el, { optional: true }).el,
    kvField(tr('Responde a'), boss.el, { optional: true, hint: tr('Pessoas e agentes de IA podem responder um ao outro.') }).el,
    err,
    h('div', { class: 'kv-org__dacts' }, btn, ...(opts.more ?? [])),
  );
}
