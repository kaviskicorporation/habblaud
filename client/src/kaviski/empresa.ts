// Fork Kaviski (KAVISKI.md): grupo "Empresa" nas Configurações. Quem é admin (ou abre pelo próprio computador) troca o
// nome da empresa, que vai no título da aba, na tela de login, nos convites e nas notificações; os outros só veem. O
// servidor grava em <dataDir>/kaviski/empresa.json (server/kaviski/empresa.ts) e manda o nome novo no snapshot.
import { tr } from '../../../shared/i18n';
import { KV_BRAND_MAX } from '../../../shared/kaviski';
import { h } from '../ui/dom';
import { kvBrandName, kvOnBrand } from './brand';
import { kvRegisterSettingsGroup } from './settings-groups';

const API = '/api/kaviski/empresa';

interface EmpresaState {
  nome: string;
  padrao: string;
  pode: boolean;
}

async function call(init?: RequestInit): Promise<EmpresaState> {
  const res = await fetch(API, { credentials: 'same-origin', ...init });
  const data = (await res.json().catch(() => ({}))) as Partial<EmpresaState> & { error?: string };
  if (!res.ok) throw new Error(data.error || tr('não foi possível falar com o servidor ({0})', [res.status]));
  return { nome: data.nome ?? '', padrao: data.padrao ?? '', pode: !!data.pode };
}

function build(): { el: HTMLElement; render: () => void } {
  const input = h('input', {
    class: 'kv-empresa__input',
    attrs: { type: 'text', maxlength: String(KV_BRAND_MAX), placeholder: tr('Nome da empresa'), 'aria-label': tr('Nome da empresa'), autocomplete: 'organization' },
  }) as HTMLInputElement;
  const save = h('button', { class: 'ui-btn kv-empresa__save', type: 'button', text: tr('Salvar') }) as HTMLButtonElement;
  const status = h('span', { class: 'ui-set__hint kv-empresa__status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const hint = h('span', { class: 'ui-set__hint', text: tr('Aparece no título da aba, na tela de login, nos convites e nas notificações. Em branco, vale o nome da instalação.') });
  let state: EmpresaState | null = null;
  let busy = false;

  const paint = (): void => {
    const pode = !!state?.pode;
    input.disabled = !pode || busy;
    save.disabled = !pode || busy || input.value.trim() === (state?.nome ?? '');
    if (state && !pode) status.textContent = tr('Só quem é admin muda o nome da empresa.');
  };

  const load = async (): Promise<void> => {
    try {
      state = await call();
      if (document.activeElement !== input) input.value = state.nome;
      status.textContent = '';
    } catch (err) {
      state = null;
      input.value = kvBrandName() ?? '';
      status.textContent = (err as Error).message;
    }
    paint();
  };

  const submit = async (): Promise<void> => {
    if (!state?.pode || busy) return;
    busy = true;
    status.textContent = tr('Salvando…');
    paint();
    try {
      state = await call({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: input.value }) });
      input.value = state.nome;
      status.textContent = state.nome ? tr('Salvo.') : state.padrao ? tr('Voltou ao nome da instalação.') : tr('Sem nome de empresa.');
    } catch (err) {
      status.textContent = (err as Error).message;
    } finally {
      busy = false;
      paint();
    }
  };

  input.addEventListener('input', paint);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  });
  save.addEventListener('click', () => void submit());
  kvOnBrand((b) => {
    if (document.activeElement !== input && state) {
      state = { ...state, nome: b ?? '' };
      input.value = state.nome;
      paint();
    }
  });

  const el = h(
    'div',
    { class: 'ui-set-group kv-empresa' },
    h('h3', { text: tr('Empresa') }),
    h('div', { class: 'ui-set ui-set--stack' }, h('div', { class: 'kv-empresa__row' }, input, save), hint, status),
  );
  return { el, render: () => void load() };
}

kvRegisterSettingsGroup(build);
