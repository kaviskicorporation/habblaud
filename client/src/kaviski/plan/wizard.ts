// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): o assistente "Monte a sua empresa" — nome, quantas pessoas, as
// salas temáticas, reuniões, vagas e o estilo do prédio (Clássico, Campus, Torre, Galeria), com a prévia ao vivo de cada
// estilo. Aplica no rascunho do editor (nada muda no escritório até gravar). Os modelos são de templates.ts.
import { tr } from '../../../../shared/i18n';
import { KV_THEME_KEYS, type KvPlan, type KvThemeKey } from '../../../../shared/kaviski-plan';
import { h as hh } from '../../ui/dom';
import { kvBtn, kvInput, kvToggle } from '../humanos/ui/kit';
import { KvModal } from '../humanos/ui/modal';
import { kvDrawThumb } from './editor-draw';
import { kvIcon } from './editor-kinds';
import { KV_DEFAULT_THEMES, KV_TEMPLATE_STYLES, kvCompanyDefaults, kvMakeCompany, type KvCompanyOpts, type KvTemplateStyle } from './templates';
import { kvThemeInfo } from './themes-info';

export interface KvWizardOpts {
  /** Primeira vez (sem planta gravada): mostra "Começar do prédio de hoje". */
  first?: boolean;
  name?: string;
  projects?: { ref: string; name: string }[];
  loadProjects?: () => Promise<{ ref: string; name: string }[]>;
  own: { id: string; name: string }[];
  onApply: (plan: KvPlan) => void;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, p: NonNullable<Parameters<typeof hh>[1]> & { html?: string } = {}, ...c: Parameters<typeof hh>[2][]): HTMLElementTagNameMap[K] {
  const { html, ...rest } = p;
  const e = hh(tag, rest, ...c);
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function styleText(s: KvTemplateStyle): { name: string; desc: string } {
  switch (s) {
    case 'classico':
      return { name: tr('Clássico'), desc: tr('O prédio de hoje: um corredor e as salas em 2 fileiras') };
    case 'campus':
      return { name: tr('Campus'), desc: tr('Blocos em volta de um pátio com jardim, corredor em anel') };
    case 'torre':
      return { name: tr('Torre'), desc: tr('Compacto: um corredor vertical com salas dos dois lados') };
    case 'galeria':
      return { name: tr('Galeria'), desc: tr('Corredor em L (ou U) com um jardim no canto de dentro') };
  }
}

export async function kvOpenWizard(o: KvWizardOpts): Promise<void> {
  let projects = o.projects ?? [];
  const state = {
    name: o.name ?? '',
    people: 8,
    style: 'campus' as KvTemplateStyle,
    themes: new Set<KvThemeKey>(KV_DEFAULT_THEMES),
    meetings: kvCompanyDefaults(8).meetings,
    vacancies: kvCompanyDefaults(8).vacancies,
    withProjects: true,
    withOwn: true,
    touched: { meetings: false, vacancies: false },
  };
  const opts = (style: KvTemplateStyle): KvCompanyOpts => ({
    name: state.name,
    people: state.people,
    style,
    themes: KV_THEME_KEYS.filter((k) => state.themes.has(k)),
    meetings: state.meetings,
    vacancies: state.vacancies,
    projects: state.withProjects ? projects : [],
    own: state.withOwn ? o.own : [],
    names: { theme: (k) => kvThemeInfo(k).name, meeting: (n) => tr('Reunião {0}', [n]) },
  });

  const m = new KvModal({
    title: tr('Monte a sua empresa'),
    subtitle: tr('Escolha um modelo, as salas e o estilo. Tudo vira um rascunho que você ajusta à vontade antes de gravar.'),
    icon: kvIcon('modelos'),
    width: 1040,
    cls: 'kv-pw',
    onClose: () => m.el.remove(),
  });

  // ---- formulário
  const name = kvInput({ placeholder: tr('Ex.: Kaviski Corporation'), value: state.name, maxlength: 60 });
  name.input.addEventListener('input', () => {
    state.name = name.input.value;
    redraw();
  });
  const peopleOut = h('output', { class: 'kv-pw__people-n', text: String(state.people) });
  const people = h('input', { class: 'kv-pw__range', type: 'range', attrs: { min: 1, max: 80, value: state.people, 'aria-label': tr('Quantas pessoas') } });
  people.addEventListener('input', () => {
    state.people = Number(people.value);
    peopleOut.textContent = String(state.people);
    const d = kvCompanyDefaults(state.people);
    if (!state.touched.meetings) meet.set(d.meetings);
    if (!state.touched.vacancies) vac.set(d.vacancies);
    redraw();
  });
  const stepper = (label: string, value: number, max: number, onChange: (v: number) => void) => {
    let v = value;
    const out = h('output', { class: 'kv-pw__step-n', text: String(v) });
    const set = (n: number) => {
      v = Math.max(0, Math.min(max, n));
      out.textContent = String(v);
      onChange(v);
    };
    const el = h(
      'div',
      { class: 'kv-pw__step' },
      h('span', { class: 'kv-pw__label', text: label }),
      h('button', { type: 'button', class: 'kv-pw__step-btn', text: '−', attrs: { 'aria-label': tr('Menos') }, on: { click: () => (set(v - 1), redraw()) } }),
      out,
      h('button', { type: 'button', class: 'kv-pw__step-btn', text: '+', attrs: { 'aria-label': tr('Mais') }, on: { click: () => (set(v + 1), redraw()) } }),
    );
    return { el, set };
  };
  const meet = stepper(tr('Salas de reunião a mais'), state.meetings, 8, (v) => {
    state.meetings = v;
  });
  const vac = stepper(tr('Vagas para projetos novos'), state.vacancies, 16, (v) => {
    state.vacancies = v;
  });
  meet.el.addEventListener('click', () => (state.touched.meetings = true));
  vac.el.addEventListener('click', () => (state.touched.vacancies = true));

  const chips = h('div', { class: 'kv-pw__themes' });
  for (const k of KV_THEME_KEYS) {
    const info = kvThemeInfo(k);
    const b = h(
      'button',
      { type: 'button', class: `kv-pw__theme${state.themes.has(k) ? ' is-on' : ''}`, style: `--c:${info.color}`, title: info.desc, attrs: { 'aria-pressed': String(state.themes.has(k)) } },
      h('span', { class: 'kv-pw__theme-icon', html: info.icon }),
      h('span', { class: 'kv-pw__theme-name', text: info.name }),
    );
    b.addEventListener('click', () => {
      if (state.themes.has(k)) state.themes.delete(k);
      else state.themes.add(k);
      b.classList.toggle('is-on', state.themes.has(k));
      b.setAttribute('aria-pressed', String(state.themes.has(k)));
      redraw();
    });
    chips.append(b);
  }
  const allBtn = kvBtn(tr('Todas'), { size: 'sm', variant: 'ghost', onClick: () => setThemes(KV_THEME_KEYS) });
  const mainBtn = kvBtn(tr('As principais'), { size: 'sm', variant: 'ghost', onClick: () => setThemes(KV_DEFAULT_THEMES) });
  const noneBtn = kvBtn(tr('Nenhuma'), { size: 'sm', variant: 'ghost', onClick: () => setThemes([]) });
  const setThemes = (keys: readonly KvThemeKey[]) => {
    state.themes = new Set(keys);
    chips.querySelectorAll<HTMLButtonElement>('.kv-pw__theme').forEach((b, i) => {
      const on = state.themes.has(KV_THEME_KEYS[i]);
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    redraw();
  };

  const projToggle = kvToggle(tr('Pôr os projetos que existem hoje ({0})', [projects.length]), {
    checked: true,
    onChange: (v) => {
      state.withProjects = v;
      redraw();
    },
  });
  const ownToggle = kvToggle(tr('Pôr as salas próprias ({0})', [o.own.length]), {
    checked: true,
    onChange: (v) => {
      state.withOwn = v;
      redraw();
    },
  });
  const projLabel = () => {
    const l = projToggle.el.querySelector('.kv-ui-toggle__label');
    if (l) l.textContent = tr('Pôr os projetos que existem hoje ({0})', [projects.length]);
  };
  projLabel();

  // ---- estilos com miniatura
  const styleCards = h('div', { class: 'kv-pw__styles', role: 'radiogroup', attrs: { 'aria-label': tr('Estilo do prédio') } });
  const thumbs = new Map<KvTemplateStyle, HTMLCanvasElement>();
  for (const s of KV_TEMPLATE_STYLES) {
    const t = styleText(s);
    const c = h('canvas', { class: 'kv-pw__style-thumb' });
    thumbs.set(s, c);
    const card = h(
      'button',
      { type: 'button', class: `kv-pw__style${s === state.style ? ' is-on' : ''}`, attrs: { role: 'radio', 'aria-checked': String(s === state.style), 'data-style': s } },
      c,
      h('span', { class: 'kv-pw__style-name kv-ui-px', text: t.name }),
      h('span', { class: 'kv-pw__style-desc', text: t.desc }),
    );
    card.addEventListener('click', () => {
      state.style = s;
      styleCards.querySelectorAll<HTMLElement>('.kv-pw__style').forEach((b) => {
        const on = b.dataset.style === s;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', String(on));
      });
      redraw();
    });
    styleCards.append(card);
  }
  const big = h('canvas', { class: 'kv-pw__preview' });
  const summary = h('p', { class: 'kv-pw__summary' });

  const redraw = () => {
    for (const [s, c] of thumbs) kvDrawThumb(c, kvMakeCompany(opts(s)), { pad: 6 });
    const plan = kvMakeCompany(opts(state.style));
    kvDrawThumb(big, plan, { pad: 14 });
    const n = (k: string) => plan.items.filter((i) => i.kind === k).length;
    summary.textContent = tr('{0} salas temáticas · {1} projetos · {2} salas próprias · {3} vagas · {4}×{5} tiles', [n('tema'), n('projeto'), n('propria'), n('vaga'), plan.w, plan.h]);
  };

  const col = (...els: (HTMLElement | null)[]) => h('div', { class: 'kv-pw__col' }, ...els);
  const sec = (title: string, ...els: (HTMLElement | null)[]) => h('section', { class: 'kv-pw__sec' }, h('h3', { class: 'kv-pw__sec-title', text: title }), ...els);
  m.body.append(
    h(
      'div',
      { class: 'kv-pw__grid' },
      col(
        sec(tr('A empresa'), h('label', { class: 'kv-pw__field' }, h('span', { class: 'kv-pw__label', text: tr('Nome') }), name.el), h('label', { class: 'kv-pw__field' }, h('span', { class: 'kv-pw__label', text: tr('Quantas pessoas trabalham aqui') }), h('div', { class: 'kv-pw__people' }, people, peopleOut))),
        sec(tr('Salas temáticas'), h('p', { class: 'kv-pw__hint', text: tr('Cada função do escritório tem uma sala com um item para usar (o seu avatar vai até lá).') }), chips, h('div', { class: 'kv-pw__row' }, mainBtn, allBtn, noneBtn)),
        sec(tr('Mais salas'), meet.el, vac.el, projToggle.el, o.own.length ? ownToggle.el : null),
      ),
      col(sec(tr('Estilo do prédio'), styleCards), h('div', { class: 'kv-pw__preview-wrap' }, big, summary)),
    ),
  );
  const apply = kvBtn(tr('Aplicar no rascunho'), {
    variant: 'primary',
    icon: kvIcon('modelos'),
    onClick: () => {
      o.onApply(kvMakeCompany(opts(state.style)));
      m.close();
    },
  });
  m.setFoot(o.first ? kvBtn(tr('Começar do prédio de hoje'), { variant: 'ghost', onClick: () => m.close(), title: tr('Editar a partir do escritório como ele está') }) : kvBtn(tr('Cancelar'), { onClick: () => m.close() }), apply);
  m.show();
  requestAnimationFrame(redraw);
  if (!o.projects && o.loadProjects) {
    projects = await o.loadProjects().catch(() => []);
    projLabel();
    redraw();
  }
}
