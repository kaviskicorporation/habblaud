// Fork Kaviski (KAVISKI-HUMANOS.md → "Sala de Arquivos"): o editor dos documentos do Voxtrin (Markdown com barra de
// formatação e prévia ao lado; Ctrl+S salva, sai avisando se há algo não salvo), a janela da pasta (nome, cor e quem
// vê) e o "mover para".
import { KV_FOLDER_ACCESS, kvMarkdown, type KvFileView, type KvFolderAccess, type KvFolderView } from '../../../../../shared/kaviski-files';
import { tr } from '../../../../../shared/i18n';
import { h } from '../../../ui/dom';
import { KvModal, kvConfirm } from '../ui/modal';
import { kvBtn, kvInput, KV_ICONS } from '../ui/kit';
import { kvToast } from '../ui/toast';
import { kvFiles, kvFilesPost, kvFileText } from './files-api';
import { kvFolderPath, kvSubfolders } from './files-model';
import { DOC_PIX, FOLDER_PIX, MOVE_PIX, kvAccessIcon, kvAccessName, kvWhen } from './files-ui';

const pix = (svg: string, cls = 'kv-ui-ico') => {
  const s = h('span', { class: cls, attrs: { 'aria-hidden': 'true' } });
  s.innerHTML = svg;
  return s;
};

// ------------------------------------------------------------------ documento

const TOOLS: { label: string; text: string; wrap?: [string, string]; line?: string }[] = [
  { label: 'H1', text: '', line: '# ' },
  { label: 'H2', text: '', line: '## ' },
  { label: 'B', text: '', wrap: ['**', '**'] },
  { label: 'I', text: '', wrap: ['*', '*'] },
  { label: 'S', text: '', wrap: ['~~', '~~'] },
  { label: '•', text: '', line: '- ' },
  { label: '1.', text: '', line: '1. ' },
  { label: '☐', text: '', line: '- [ ] ' },
  { label: '❝', text: '', line: '> ' },
  { label: '</>', text: '', wrap: ['`', '`'] },
  { label: '—', text: '\n---\n' },
];

export function kvOpenDocEditor(f: KvFileView): void {
  const editable = f.canEdit && !f.trashed;
  let saved = '';
  let dirty = false;
  let saving = false;
  const area = h('textarea', { class: 'kv-files-doc__area', attrs: { spellcheck: 'true', placeholder: tr('Escreva aqui. Use # para títulos, - para listas, - [ ] para tarefas.') } });
  area.disabled = true;
  area.readOnly = !editable;
  const prev = h('div', { class: 'kv-files-doc__prev kv-md' });
  const status = h('span', { class: 'kv-files-doc__status', attrs: { role: 'status' } });
  const name = kvInput({ value: f.name.replace(/\.md$/i, ''), maxlength: 115 });
  name.input.disabled = !editable;
  name.el.classList.add('kv-files-doc__name');
  const render = () => (prev.innerHTML = kvMarkdown(area.value) || `<p class="kv-files__muted">${tr('A prévia aparece aqui.')}</p>`);
  const setDirty = (v: boolean) => {
    dirty = v;
    status.textContent = v ? tr('Não salvo') : saved !== null ? tr('Salvo') : '';
    status.classList.toggle('is-dirty', v);
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  area.addEventListener('input', () => {
    setDirty(area.value !== saved);
    if (timer) clearTimeout(timer);
    timer = setTimeout(render, 120);
  });
  const insert = (t: (typeof TOOLS)[number]) => {
    const { selectionStart: a, selectionEnd: b, value } = area;
    if (t.wrap) {
      const sel = value.slice(a, b) || tr('texto');
      area.setRangeText(`${t.wrap[0]}${sel}${t.wrap[1]}`, a, b, 'end');
    } else if (t.line) {
      const start = value.lastIndexOf('\n', a - 1) + 1;
      area.setRangeText(t.line, start, start, 'end');
    } else area.setRangeText(t.text, a, b, 'end');
    area.focus();
    area.dispatchEvent(new Event('input'));
  };
  const tools = h('div', { class: 'kv-files-doc__tools', role: 'toolbar', hidden: !editable }, ...TOOLS.map((t) => h('button', { type: 'button', class: 'kv-files-doc__tool', text: t.label, on: { click: () => insert(t) } })));
  const save = async (): Promise<boolean> => {
    if (!editable || saving) return false;
    saving = true;
    status.textContent = tr('Salvando…');
    const body: Record<string, unknown> = { text: area.value };
    const nm = name.input.value.trim();
    if (nm && `${nm}.md` !== f.name && nm !== f.name) body.name = nm;
    const r = await kvFilesPost<{ file: KvFileView }>(`/${f.id}`, body);
    saving = false;
    if (!r.ok) {
      status.textContent = '';
      kvToast(r.body.error ?? tr('Não deu para salvar.'), { kind: 'error' });
      return false;
    }
    f = r.body.file;
    saved = area.value;
    setDirty(false);
    status.textContent = tr('Salvo {0}', [kvWhen(Date.now())]);
    return true;
  };
  const m = new KvModal({ title: editable ? tr('Editar documento') : tr('Documento'), subtitle: f.meetings.length ? tr('Ligado à reunião {0}', [f.meetings[0]!.title]) : undefined, icon: DOC_PIX, width: 1180, cls: 'kv-files-doc', onClose: () => m.el.remove() });
  // fechar com algo não salvo pergunta antes
  m.el.addEventListener('cancel', (e) => {
    if (!dirty) return;
    e.preventDefault();
    void askClose();
  });
  const askClose = async () => {
    const yes = await kvConfirm({ title: tr('Sair sem salvar?'), text: tr('O que você escreveu desde a última vez que salvou se perde.'), ok: tr('Sair sem salvar'), danger: true });
    if (yes) {
      dirty = false;
      m.close();
    }
  };
  m.el.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
    }
  });
  const views = h('div', { class: 'kv-files-doc__split' }, area, prev);
  const modeBtn = (label: string, mode: string) =>
    h('button', {
      type: 'button',
      class: 'kv-files-doc__mode',
      text: label,
      on: {
        click: () => {
          views.dataset.mode = mode;
          for (const b of modes.children) b.classList.toggle('is-on', (b as HTMLElement).textContent === label);
          if (mode !== 'prev') area.focus();
        },
      },
    });
  const modes = h('div', { class: 'kv-files-doc__modes' }, modeBtn(tr('Escrever'), 'edit'), modeBtn(tr('Lado a lado'), 'split'), modeBtn(tr('Prévia'), 'prev'));
  views.dataset.mode = editable ? 'split' : 'prev';
  for (const b of modes.children) b.classList.toggle('is-on', (b as HTMLElement).textContent === (editable ? tr('Lado a lado') : tr('Prévia')));
  m.body.append(h('div', { class: 'kv-files-doc__top' }, name.el, modes), tools, views);
  m.setFoot(
    status,
    kvBtn(tr('Fechar'), { onClick: () => (dirty ? void askClose() : m.close()) }),
    editable ? kvBtn(tr('Salvar'), { variant: 'primary', icon: KV_ICONS.check, title: 'Ctrl+S', onClick: () => void save() }) : null,
  );
  // o X do cabeçalho também pergunta
  m.el.querySelector('.kv-ui-modal__head-actions button:last-child')?.addEventListener(
    'click',
    (e) => {
      if (!dirty) return;
      e.stopImmediatePropagation();
      void askClose();
    },
    true,
  );
  m.show();
  void kvFileText(f).then((t) => {
    saved = t ?? '';
    area.value = saved;
    area.disabled = false;
    setDirty(false);
    status.textContent = tr('Versão {0} · {1}', [f.version, f.updatedBy.name]);
    render();
    if (editable) {
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    }
  });
}

// ------------------------------------------------------------------ pasta

const COLORS = ['#7cc8ff', '#4fd18b', '#ff9a3d', '#ff5a6a', '#a98bff', '#f4d35d', '#5ee1ff', '#f06fc6'];

/** Nova pasta (folder null) dentro de `parent`, ou a pasta para mudar. */
export function kvEditFolder(folder: KvFolderView | null, parent: string | null): void {
  const s = kvFiles();
  const restricted = !s.canFolder;
  const name = kvInput({ value: folder?.name ?? '', maxlength: 120, placeholder: tr('Nome da pasta') });
  let access: KvFolderAccess = folder?.access ?? (parent ? (s.folders.find((f) => f.id === parent)?.access ?? 'equipe') : 'equipe');
  const people = new Set(folder?.people ?? []);
  let color = folder?.color ?? '';
  const accBox = h('div', { class: 'kv-files-acc' });
  const peopleBox = h('div', { class: 'kv-files-people' });
  const filter = kvInput({ placeholder: tr('Buscar pessoa'), icon: KV_ICONS.search, onInput: () => drawPeople() });
  const drawPeople = () => {
    const q = filter.input.value.trim().toLowerCase();
    peopleBox.replaceChildren(
      ...(s.people ?? [])
        .filter((p) => !q || p.name.toLowerCase().includes(q))
        .map((p) => {
          const cb = h('input', { type: 'checkbox' });
          cb.checked = people.has(p.id);
          cb.addEventListener('change', () => (cb.checked ? people.add(p.id) : people.delete(p.id)));
          return h('label', { class: 'kv-files-people__row' }, cb, h('span', { text: p.name }), h('small', { text: p.role }));
        }),
    );
  };
  const drawAccess = () => {
    accBox.replaceChildren(
      ...KV_FOLDER_ACCESS.map((a) =>
        h(
          'button',
          { type: 'button', class: `kv-files-acc__opt${access === a ? ' is-on' : ''}`, attrs: { 'aria-pressed': String(access === a) }, on: { click: () => ((access = a), drawAccess()) } },
          pix(kvAccessIcon(a)),
          h('strong', { text: kvAccessName(a) }),
          h('small', { text: a === 'todos' ? tr('Clientes com conta também veem e enviam') : a === 'pessoas' ? tr('Você, os admins e quem você marcar') : tr('Admins e equipe; clientes não veem') }),
        ),
      ),
    );
    pickWrap.hidden = access !== 'pessoas';
  };
  const pickWrap = h('div', { class: 'kv-files-people__wrap' }, filter.el, peopleBox);
  const swatches = h(
    'div',
    { class: 'kv-files-colors' },
    ...['', ...COLORS].map((c) => {
      const b = h('button', { type: 'button', class: `kv-files-colors__c${color === c ? ' is-on' : ''}`, style: c ? `--c:${c}` : '', attrs: { 'aria-label': c || tr('Sem cor') } });
      b.addEventListener('click', () => {
        color = c;
        for (const x of swatches.children) x.classList.toggle('is-on', x === b);
      });
      return b;
    }),
  );
  const m = new KvModal({ title: folder ? tr('Pasta: nome e acesso') : tr('Nova pasta'), subtitle: parent ? tr('Dentro de {0}', [kvFolderPath(parent, s.folders).map((f) => f.name).join(' › ')]) : undefined, icon: FOLDER_PIX, width: 560, cls: 'kv-files-fold', onClose: () => m.el.remove() });
  const field = (label: string, el: HTMLElement) => h('div', { class: 'kv-files-fold__field' }, h('span', { class: 'kv-files-fold__label', text: label }), el);
  m.body.append(field(tr('Nome'), name.el), field(tr('Cor'), swatches));
  if (!restricted) m.body.append(field(tr('Quem vê'), h('div', {}, accBox, pickWrap)));
  else m.body.append(h('p', { class: 'kv-files__muted', text: tr('A pasta fica com o mesmo acesso da pasta de cima.') }));
  drawAccess();
  drawPeople();
  const submit = async () => {
    const body = { name: name.input.value, color, ...(restricted ? {} : { access, people: [...people] }), ...(folder ? {} : { parent }) };
    const r = await kvFilesPost(folder ? `/folders/${folder.id}` : '/folders', body);
    if (!r.ok) return void kvToast(r.body.error ?? tr('Não deu certo.'), { kind: 'error' });
    m.close();
  };
  name.input.addEventListener('keydown', (e) => e.key === 'Enter' && void submit());
  const del = folder
    ? kvBtn(tr('Apagar pasta'), {
        variant: 'danger',
        icon: KV_ICONS.trash,
        onClick: async () => {
          if (!(await kvConfirm({ title: tr('Apagar a pasta {0}?', [folder.name]), text: tr('Só dá para apagar uma pasta vazia.'), ok: tr('Apagar'), danger: true }))) return;
          const r = await kvFilesPost(`/folders/${folder.id}`, {}, 'DELETE');
          if (!r.ok) kvToast(r.body.error ?? tr('Não deu certo.'), { kind: 'error' });
          else m.close();
        },
      })
    : null;
  m.setFoot(del, h('span', { class: 'kv-files__grow' }), kvBtn(tr('Cancelar'), { onClick: () => m.close() }), kvBtn(folder ? tr('Salvar') : tr('Criar pasta'), { variant: 'primary', onClick: () => void submit() }));
  m.show();
  name.input.focus();
}

// ------------------------------------------------------------------ mover

export function kvMoveTo(f: KvFileView): void {
  const s = kvFiles();
  let target: string | null = f.folder;
  const list = h('div', { class: 'kv-files-move', role: 'radiogroup' });
  const row = (id: string | null, label: string, depth: number) => {
    const b = h('button', { type: 'button', class: `kv-files-move__row${target === id ? ' is-on' : ''}`, style: `--depth:${depth}`, attrs: { role: 'radio', 'aria-checked': String(target === id) } }, pix(FOLDER_PIX), h('span', { text: label }));
    b.addEventListener('click', () => {
      target = id;
      for (const x of list.children) {
        x.classList.toggle('is-on', x === b);
        x.setAttribute('aria-checked', String(x === b));
      }
    });
    b.addEventListener('dblclick', () => void go());
    return b;
  };
  if (s.canFolder) list.append(row(null, tr('Raiz (só a equipe)'), 0));
  const walk = (parent: string | null, depth: number) => {
    for (const fd of kvSubfolders(parent, s.folders)) {
      list.append(row(fd.id, fd.name, depth));
      walk(fd.id, depth + 1);
    }
  };
  walk(null, s.canFolder ? 1 : 0);
  const m = new KvModal({ title: tr('Mover {0}', [f.name]), subtitle: tr('Quem vê o arquivo passa a ser quem vê a pasta nova.'), icon: MOVE_PIX, width: 480, cls: 'kv-files-movebox', onClose: () => m.el.remove() });
  const go = async () => {
    if (target === f.folder) return m.close();
    const r = await kvFilesPost(`/${f.id}`, { folder: target });
    if (!r.ok) return void kvToast(r.body.error ?? tr('Não deu certo.'), { kind: 'error' });
    kvToast(tr('Arquivo movido.'), { kind: 'ok' });
    m.close();
  };
  m.body.append(list);
  m.setFoot(kvBtn(tr('Cancelar'), { onClick: () => m.close() }), kvBtn(tr('Mover aqui'), { variant: 'primary', onClick: () => void go() }));
  m.show();
}
