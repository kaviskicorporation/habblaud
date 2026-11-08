// Fork Kaviski (KAVISKI-HUMANOS.md → "Sala de Arquivos"): a janela dos arquivos da empresa. À esquerda as vistas
// (Todos, Recentes, Favoritos, Meus, Documentos, Das reuniões, Lixeira), a árvore de pastas e o espaço usado; no meio a
// barra (caminho, busca, tipo, ordem, grade/lista) e os arquivos (arrastar e soltar envia); à direita os detalhes do
// arquivo escolhido: prévia, descrição, etiquetas, reuniões ligadas, versões e as ações. Documentos do Voxtrin abrem no
// editor (files-editor.ts). Tudo o que muda passa pelo servidor (files.ts), que decide quem vê e quem pode.
import { kvFileIsText, kvFileSize, kvMarkdown, type KvFilesState, type KvFileView, type KvFolderView } from '../../../../../shared/kaviski-files';
import { tr } from '../../../../../shared/i18n';
import { copyText, h } from '../../../ui/dom';
import { KvModal, kvConfirm } from '../ui/modal';
import { kvBtn, kvEmpty, kvIconBtn, kvInput, kvTitle, KV_ICONS } from '../ui/kit';
import { kvToast } from '../ui/toast';
import { kvMeetings, kvMeetLabel, kvMeetRoom, kvReloadMeetings } from '../meetings-api';
import { kvMeId } from '../meetings-ui';
import { kvFiles, kvFilesLoaded, kvFilesPost, kvFileText, kvFileUrl, kvOnFiles, kvReloadFiles, kvUploadFile } from './files-api';
import { kvAtaTemplate, kvByMeeting, kvFolderCount, kvFolderPath, kvSubfolders, kvVisibleFiles, type KvFilesNav, type KvFilesQuery, type KvFilesSort, type KvKindFilter } from './files-model';
import {
  ACT_PIX,
  CLOCK_PIX,
  DOC_PIX,
  DOWN_PIX,
  FILES_ICON,
  FOLDER_PIX,
  GRID_PIX,
  HISTORY_PIX,
  KIND_COLOR,
  LINK_PIX,
  LIST_PIX,
  MEET_PIX,
  MOVE_PIX,
  NEWFOLDER_PIX,
  STAR_PIX,
  TRASH_PIX,
  UPLOAD_PIX,
  USER_PIX,
  kvAccessIcon,
  kvAccessName,
  kvActivityText,
  kvDateTime,
  kvKindFilters,
  kvKindIcon,
  kvKindName,
  kvWhen,
} from './files-ui';
import { kvEditFolder, kvMoveTo, kvOpenDocEditor } from './files-editor';
import './files.css';

export interface KvOpenFilesOpts {
  folder?: string | null;
  meeting?: string;
  nav?: KvFilesNav;
  file?: string;
}

let dialog: KvFilesDialog | null = null;

export function kvOpenFiles(opts: KvOpenFilesOpts = {}): void {
  dialog ??= new KvFilesDialog();
  dialog.open(opts);
}

export function kvFilesOpen(): boolean {
  return !!dialog?.isOpen;
}

const pix = (svg: string, cls = 'kv-ui-ico') => {
  const s = h('span', { class: cls, attrs: { 'aria-hidden': 'true' } });
  s.innerHTML = svg;
  return s;
};

function kindBadge(f: Pick<KvFileView, 'kind'>, cls = 'kv-files-kind'): HTMLElement {
  const el = pix(kvKindIcon(f.kind), cls);
  el.style.setProperty('--kind', KIND_COLOR[f.kind]);
  return el;
}

function meetWhen(t: number): string {
  return kvDateTime(t);
}

class KvFilesDialog {
  private readonly modal: KvModal;
  private readonly nav: HTMLElement;
  private readonly tree: HTMLElement;
  private readonly usage: HTMLElement;
  private readonly crumbs: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly content: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly search: ReturnType<typeof kvInput>;
  private readonly kindSel: HTMLSelectElement;
  private readonly sortSel: HTMLSelectElement;
  private readonly viewBtn: HTMLButtonElement;
  private q: KvFilesQuery = { nav: 'pasta', folder: null, text: '', kind: 'todos', sort: 'nome', me: '' };
  private grid = localStorage.getItem('kv-files-view') !== 'lista';
  private selected: string | null = null;
  private unsub: (() => void) | null = null;
  private previewToken = 0;
  private openTree = new Set<string>();

  constructor() {
    this.fileInput = h('input', { type: 'file', hidden: true, attrs: { multiple: true } });
    this.fileInput.addEventListener('change', () => {
      const list = [...(this.fileInput.files ?? [])];
      this.fileInput.value = '';
      void this.upload(list);
    });
    this.nav = h('nav', { class: 'kv-files__views', attrs: { 'aria-label': tr('Vistas') } });
    this.tree = h('div', { class: 'kv-files__tree', role: 'tree' });
    this.usage = h('div', { class: 'kv-files__usage' });
    const side = h(
      'aside',
      { class: 'kv-files__side' },
      this.nav,
      h('div', { class: 'kv-files__side-head' }, kvTitle('span', tr('Pastas'), 'kv-files__side-title')),
      this.tree,
      this.usage,
    );
    this.crumbs = h('div', { class: 'kv-files__crumbs' });
    this.search = kvInput({ placeholder: tr('Buscar por nome, etiqueta, reunião…'), icon: KV_ICONS.search, onInput: (v) => ((this.q.text = v.trim()), this.render()) });
    this.search.el.classList.add('kv-files__search');
    this.kindSel = h('select', { class: 'kv-files__sel', attrs: { 'aria-label': tr('Tipo') } }, ...kvKindFilters().map((k) => h('option', { attrs: { value: k.value }, text: k.label })));
    this.kindSel.addEventListener('change', () => ((this.q.kind = this.kindSel.value as KvKindFilter), this.render()));
    this.sortSel = h(
      'select',
      { class: 'kv-files__sel', attrs: { 'aria-label': tr('Ordem') } },
      h('option', { attrs: { value: 'nome' }, text: tr('Nome') }),
      h('option', { attrs: { value: 'recente' }, text: tr('Mais recentes') }),
      h('option', { attrs: { value: 'tamanho' }, text: tr('Maiores') }),
      h('option', { attrs: { value: 'tipo' }, text: tr('Tipo') }),
    );
    this.sortSel.addEventListener('change', () => ((this.q.sort = this.sortSel.value as KvFilesSort), this.render()));
    this.viewBtn = kvIconBtn(GRID_PIX, tr('Grade ou lista'), () => {
      this.grid = !this.grid;
      localStorage.setItem('kv-files-view', this.grid ? 'grade' : 'lista');
      this.render();
    });
    this.actions = h('div', { class: 'kv-files__actions' });
    this.content = h('div', { class: 'kv-files__content', tabIndex: -1 });
    this.progress = h('div', { class: 'kv-files__progress', hidden: true, attrs: { role: 'status' } });
    const main = h(
      'section',
      { class: 'kv-files__main' },
      h('div', { class: 'kv-files__bar' }, this.crumbs, h('div', { class: 'kv-files__tools' }, this.search.el, this.kindSel, this.sortSel, this.viewBtn)),
      this.actions,
      this.progress,
      this.content,
    );
    this.detail = h('aside', { class: 'kv-files__detail', hidden: true });
    this.modal = new KvModal({
      title: tr('Sala de Arquivos'),
      subtitle: tr('Arquivos e documentos da empresa, das pastas às atas de reunião'),
      icon: FILES_ICON,
      width: 1240,
      cls: 'kv-files',
      onClose: () => this.stop(),
    });
    this.modal.body.append(h('div', { class: 'kv-files__layout' }, side, main, this.detail), this.fileInput);
    main.dataset.drop = tr('Solte para enviar');
    this.dropZone(main);
    this.modal.el.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f')) {
        e.preventDefault();
        this.search.input.focus();
      }
      if (e.key === 'Delete' && this.selected) {
        const f = kvFiles().files.find((x) => x.id === this.selected);
        if (f?.canEdit) void this.trash(f);
      }
    });
  }

  get isOpen(): boolean {
    return this.modal.open;
  }

  open(o: KvOpenFilesOpts): void {
    this.q.me = kvMeId();
    if (o.meeting) {
      this.q = { ...this.q, nav: 'reunioes', meeting: o.meeting, text: '' };
    } else if (o.nav) this.q = { ...this.q, nav: o.nav, meeting: undefined };
    if (o.folder !== undefined) this.q = { ...this.q, nav: 'pasta', folder: o.folder, meeting: undefined };
    this.selected = o.file ?? null;
    this.search.input.value = this.q.text;
    this.unsub ??= kvOnFiles(() => this.render());
    this.render();
    this.modal.show();
    void kvReloadFiles();
    void kvReloadMeetings();
  }

  private stop(): void {
    this.unsub?.();
    this.unsub = null;
    this.previewToken++;
  }

  // ------------------------------------------------------------------ desenho

  private go(q: Partial<KvFilesQuery>): void {
    this.q = { ...this.q, meeting: undefined, ...q };
    this.selected = null;
    this.render();
    this.content.scrollTop = 0;
  }

  private render(): void {
    const s = kvFiles();
    if (this.q.folder && !s.folders.some((f) => f.id === this.q.folder) && kvFilesLoaded()) this.q.folder = null;
    this.renderNav(s);
    this.renderTree(s);
    this.renderUsage(s);
    this.renderCrumbs(s);
    this.renderActions(s);
    this.renderContent(s);
    this.renderDetail(s);
    this.viewBtn.innerHTML = '';
    this.viewBtn.append(pix(this.grid ? LIST_PIX : GRID_PIX));
    this.viewBtn.title = this.grid ? tr('Ver em lista') : tr('Ver em grade');
  }

  private renderNav(s: KvFilesState): void {
    const items: { nav: KvFilesNav; label: string; icon: string; n?: number }[] = [
      { nav: 'pasta', label: tr('Todos os arquivos'), icon: FOLDER_PIX },
      { nav: 'recentes', label: tr('Recentes'), icon: CLOCK_PIX },
      { nav: 'favoritos', label: tr('Favoritos'), icon: STAR_PIX, n: s.files.filter((f) => f.star).length },
      { nav: 'meus', label: tr('Meus arquivos'), icon: USER_PIX },
      { nav: 'docs', label: tr('Documentos'), icon: DOC_PIX },
      { nav: 'reunioes', label: tr('Das reuniões'), icon: MEET_PIX, n: s.files.filter((f) => f.meetings.length).length },
      { nav: 'lixeira', label: tr('Lixeira'), icon: TRASH_PIX, n: s.trash.length },
    ];
    this.nav.replaceChildren(
      ...items.map((it) =>
        h(
          'button',
          {
            class: `kv-files__view${this.q.nav === it.nav && (it.nav !== 'pasta' || this.q.folder === null) ? ' is-on' : ''}`,
            type: 'button',
            on: { click: () => this.go({ nav: it.nav, folder: null, text: this.q.text }) },
          },
          pix(it.icon),
          h('span', { text: it.label }),
          it.n ? h('span', { class: 'kv-files__count', text: String(it.n) }) : null,
        ),
      ),
    );
  }

  private renderTree(s: KvFilesState): void {
    const open = new Set(this.openTree);
    for (const f of kvFolderPath(this.q.folder, s.folders)) open.add(f.id);
    const node = (f: KvFolderView, depth: number): HTMLElement => {
      const kids = kvSubfolders(f.id, s.folders);
      const isOpen = open.has(f.id);
      const on = this.q.nav === 'pasta' && this.q.folder === f.id;
      const toggle = h('button', { class: `kv-files__twisty${kids.length ? '' : ' is-leaf'}`, type: 'button', attrs: { 'aria-label': isOpen ? tr('Fechar') : tr('Abrir'), tabindex: -1 }, text: kids.length ? (isOpen ? '▾' : '▸') : '' });
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.openTree.has(f.id)) this.openTree.delete(f.id);
        else this.openTree.add(f.id);
        this.render();
      });
      const row = h(
        'div',
        { class: `kv-files__node${on ? ' is-on' : ''}`, role: 'treeitem', tabIndex: 0, style: `--depth:${depth};${f.color ? `--fc:${f.color}` : ''}`, attrs: { 'aria-expanded': kids.length ? String(isOpen) : undefined, title: kvAccessName(f.access) } },
        toggle,
        pix(FOLDER_PIX, 'kv-ui-ico kv-files__node-ico'),
        h('span', { class: 'kv-files__node-name', text: f.name }),
        f.access !== 'equipe' ? pix(kvAccessIcon(f.access), 'kv-ui-ico kv-files__node-acc') : null,
      );
      const goTo = () => this.go({ nav: 'pasta', folder: f.id });
      row.addEventListener('click', goTo);
      row.addEventListener('keydown', (e) => e.key === 'Enter' && goTo());
      this.dropOnFolder(row, f.id);
      return h('div', { class: 'kv-files__branch' }, row, isOpen && kids.length ? h('div', { role: 'group' }, ...kids.map((k) => node(k, depth + 1))) : null);
    };
    const roots = kvSubfolders(null, s.folders);
    this.tree.replaceChildren(...(roots.length ? roots.map((f) => node(f, 0)) : [h('p', { class: 'kv-files__muted', text: s.canFolder ? tr('Nenhuma pasta ainda.') : tr('Nenhuma pasta liberada para você.') })]));
  }

  private renderUsage(s: KvFilesState): void {
    const pct = Math.min(100, (s.usage.used / Math.max(1, s.usage.max)) * 100);
    this.usage.replaceChildren(
      h('div', { class: 'kv-files__usage-bar' }, h('i', { style: `width:${pct.toFixed(1)}%`, class: pct > 90 ? 'is-full' : '' })),
      h('span', { text: tr('{0} de {1} usados', [kvFileSize(s.usage.used), kvFileSize(s.usage.max)]) }),
    );
  }

  private navTitle(): string {
    switch (this.q.nav) {
      case 'recentes':
        return tr('Recentes');
      case 'favoritos':
        return tr('Favoritos');
      case 'meus':
        return tr('Meus arquivos');
      case 'docs':
        return tr('Documentos');
      case 'reunioes':
        return tr('Das reuniões');
      case 'lixeira':
        return tr('Lixeira');
      default:
        return tr('Todos os arquivos');
    }
  }

  private renderCrumbs(s: KvFilesState): void {
    const parts: HTMLElement[] = [h('button', { class: 'kv-files__crumb', type: 'button', text: this.navTitle(), on: { click: () => this.go({ folder: null, meeting: undefined }) } })];
    if (this.q.nav === 'pasta') {
      for (const f of kvFolderPath(this.q.folder, s.folders)) {
        parts.push(h('span', { class: 'kv-files__sep', text: '›' }));
        const b = h('button', { class: 'kv-files__crumb', type: 'button', text: f.name, on: { click: () => this.go({ nav: 'pasta', folder: f.id }) } });
        this.dropOnFolder(b, f.id);
        parts.push(b);
      }
      const cur = s.folders.find((f) => f.id === this.q.folder);
      if (cur) parts.push(h('span', { class: `kv-files__acc kv-files__acc--${cur.access}`, title: kvAccessName(cur.access) }, pix(kvAccessIcon(cur.access)), h('span', { text: kvAccessName(cur.access) })));
    }
    if (this.q.nav === 'reunioes' && this.q.meeting) {
      const g = kvByMeeting(s.files, this.q.meeting)[0];
      const m = kvMeetings().meetings.find((x) => x.id === this.q.meeting);
      parts.push(h('span', { class: 'kv-files__sep', text: '›' }), h('span', { class: 'kv-files__crumb is-last', text: m ? kvMeetLabel(m) : (g?.title ?? tr('Reunião')) }));
    }
    this.crumbs.replaceChildren(...parts);
  }

  private renderActions(s: KvFilesState): void {
    const btns: HTMLElement[] = [];
    const inFolder = this.q.nav === 'pasta';
    const folder = s.folders.find((f) => f.id === this.q.folder);
    const canHere = s.canUpload && (this.q.folder !== null || s.canFolder);
    if (this.q.nav === 'lixeira') {
      btns.push(h('p', { class: 'kv-files__hint', text: tr('Os arquivos ficam {0} dias na lixeira e depois somem de vez.', [30]) }));
    } else if (inFolder || this.q.nav === 'docs' || this.q.nav === 'meus' || this.q.nav === 'recentes') {
      // fora de uma pasta, o envio vai para a raiz: só a equipe
      if (inFolder ? canHere : s.canFolder) {
        if (s.canUpload) btns.push(kvBtn(tr('Enviar arquivos'), { variant: 'primary', icon: UPLOAD_PIX, onClick: () => this.pick() }));
        if (s.canUpload) btns.push(kvBtn(tr('Novo documento'), { icon: DOC_PIX, onClick: () => void this.newDoc() }));
      }
      if (inFolder && (s.canFolder || (folder && s.canUpload))) btns.push(kvBtn(tr('Nova pasta'), { icon: NEWFOLDER_PIX, onClick: () => kvEditFolder(null, this.q.folder) }));
      if (inFolder && folder?.canEdit) btns.push(kvBtn(tr('Pasta: nome e acesso'), { variant: 'ghost', icon: KV_ICONS.edit, onClick: () => kvEditFolder(folder, folder.parent) }));
      if (s.canUpload) btns.push(h('span', { class: 'kv-files__hint', text: tr('ou arraste arquivos para cá') }));
    } else if (this.q.nav === 'reunioes') {
      btns.push(h('p', { class: 'kv-files__hint', text: tr('Pautas, apresentações e atas ligadas às reuniões. Quem é da reunião vê os arquivos dela.') }));
    }
    this.actions.replaceChildren(...btns);
    this.actions.hidden = !btns.length;
  }

  private renderContent(s: KvFilesState): void {
    if (!kvFilesLoaded()) {
      this.content.replaceChildren(h('div', { class: 'kv-files__loading', text: tr('Carregando…') }));
      return;
    }
    if (this.q.nav === 'reunioes') return this.renderMeetings(s);
    const files = kvVisibleFiles(s, this.q);
    const folders = this.q.nav === 'pasta' && !this.q.text ? kvSubfolders(this.q.folder, s.folders) : [];
    const blocks: HTMLElement[] = [];
    if (folders.length) blocks.push(h('div', { class: 'kv-files__folders' }, ...folders.map((f) => this.folderCard(f, s))));
    if (files.length) blocks.push(this.fileList(files));
    if (this.q.nav === 'pasta' && !this.q.text && this.q.folder === null && s.activity.length) blocks.push(this.activityBlock(s));
    if (!folders.length && !files.length) {
      const empty =
        this.q.text || this.q.kind !== 'todos'
          ? kvEmpty(KV_ICONS.search, tr('Nada encontrado'), tr('Tente outra palavra ou outro tipo.'))
          : this.q.nav === 'lixeira'
            ? kvEmpty(TRASH_PIX, tr('A lixeira está vazia'))
            : this.q.nav === 'favoritos'
              ? kvEmpty(STAR_PIX, tr('Nenhum favorito'), tr('Marque a estrela de um arquivo para achar rápido aqui.'))
              : kvEmpty(FILES_ICON, tr('Nenhum arquivo aqui'), s.canUpload ? tr('Envie arquivos, arraste do computador ou crie um documento.') : '');
      blocks.unshift(h('div', { class: 'kv-files__empty' }, empty));
    }
    this.content.replaceChildren(...blocks);
  }

  private folderCard(f: KvFolderView, s: KvFilesState): HTMLElement {
    const n = kvFolderCount(f.id, s);
    const card = h(
      'button',
      { class: 'kv-files-folder', type: 'button', style: f.color ? `--fc:${f.color}` : '', title: kvAccessName(f.access) },
      pix(FOLDER_PIX, 'kv-ui-ico kv-files-folder__ico'),
      h('span', { class: 'kv-files-folder__name', text: f.name }),
      h('span', { class: 'kv-files-folder__meta' }, pix(kvAccessIcon(f.access)), h('span', { text: n === 1 ? tr('1 arquivo') : tr('{0} arquivos', [n]) })),
    );
    card.addEventListener('click', () => this.go({ nav: 'pasta', folder: f.id }));
    this.dropOnFolder(card, f.id);
    return card;
  }

  private fileList(files: KvFileView[]): HTMLElement {
    const now = Date.now();
    const s = kvFiles();
    const folderName = (id: string | null) => (id ? (s.folders.find((f) => f.id === id)?.name ?? '') : '');
    const showFolder = this.q.nav !== 'pasta' || !!this.q.text;
    if (this.grid) {
      return h(
        'ul',
        { class: 'kv-files__grid' },
        ...files.map((f) => {
          const li = h(
            'li',
            { class: `kv-files-card${this.selected === f.id ? ' is-on' : ''}`, tabIndex: 0, style: `--kind:${KIND_COLOR[f.kind]}`, attrs: { 'aria-selected': String(this.selected === f.id) } },
            h('div', { class: 'kv-files-card__thumb' }, f.kind === 'imagem' && f.size < 6_000_000 ? h('img', { attrs: { src: kvFileUrl(f), alt: '', loading: 'lazy', draggable: 'false' } }) : kindBadge(f, 'kv-files-kind kv-files-kind--lg')),
            f.star ? pix(STAR_PIX, 'kv-ui-ico kv-files-card__star') : null,
            h('strong', { class: 'kv-files-card__name', text: f.name, title: f.name }),
            h('span', { class: 'kv-files-card__meta', text: [kvFileSize(f.size), kvWhen(f.updated, now)].join(' · ') }),
            showFolder && folderName(f.folder) ? h('span', { class: 'kv-files-card__folder' }, pix(FOLDER_PIX), h('span', { text: folderName(f.folder) })) : null,
            f.meetings.length ? h('span', { class: 'kv-files-card__meet' }, pix(MEET_PIX), h('span', { text: f.meetings[0]!.title })) : null,
          );
          this.bindFile(li, f);
          return li;
        }),
      );
    }
    return h(
      'table',
      { class: 'kv-files__table' },
      h('thead', {}, h('tr', {}, h('th', { text: tr('Nome') }), h('th', { text: tr('Tipo') }), h('th', { text: tr('Tamanho') }), h('th', { text: tr('Alterado') }), h('th', { text: tr('Por') }))),
      h(
        'tbody',
        {},
        ...files.map((f) => {
          const tr_ = h(
            'tr',
            { class: this.selected === f.id ? 'is-on' : '', tabIndex: 0, style: `--kind:${KIND_COLOR[f.kind]}` },
            h(
              'td',
              { class: 'kv-files__tname' },
              kindBadge(f),
              h('span', { text: f.name, title: f.name }),
              f.star ? pix(STAR_PIX, 'kv-ui-ico kv-files-card__star is-inline') : null,
              f.meetings.length ? pix(MEET_PIX, 'kv-ui-ico kv-files__tmeet') : null,
              showFolder && folderName(f.folder) ? h('small', { text: folderName(f.folder) }) : null,
            ),
            h('td', { text: kvKindName(f.kind) }),
            h('td', { text: kvFileSize(f.size) }),
            h('td', { text: kvWhen(f.updated, now) }),
            h('td', { text: f.updatedBy.name }),
          );
          this.bindFile(tr_, f);
          return tr_;
        }),
      ),
    );
  }

  private bindFile(el: HTMLElement, f: KvFileView): void {
    el.addEventListener('click', () => {
      this.selected = this.selected === f.id ? null : f.id;
      this.render();
    });
    el.addEventListener('dblclick', () => this.openFile(f));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.openFile(f);
      if (e.key === ' ') {
        e.preventDefault();
        this.selected = f.id;
        this.render();
      }
    });
    if (f.canEdit && !f.trashed) {
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('application/x-kv-file', f.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
    }
  }

  private activityBlock(s: KvFilesState): HTMLElement {
    const now = Date.now();
    const byId = new Map(s.files.map((f) => [f.id, f]));
    return h(
      'section',
      { class: 'kv-files__activity' },
      h('header', {}, pix(ACT_PIX), kvTitle('h3', tr('Atividade recente'))),
      h(
        'ul',
        {},
        ...s.activity.slice(0, 8).map((a) => {
          const f = a.file ? byId.get(a.file) : undefined;
          const name = h(f ? 'button' : 'span', { class: 'kv-files__act-name', text: a.name, ...(f ? { type: 'button', on: { click: () => this.select(f) } } : {}) });
          return h('li', {}, h('strong', { text: a.who.name }), h('span', { text: ` ${kvActivityText(a.action)} ` }), name, h('time', { text: kvWhen(a.at, now) }));
        }),
      ),
    );
  }

  private select(f: KvFileView): void {
    if (f.trashed) this.q = { ...this.q, nav: 'lixeira' };
    else if (this.q.nav === 'pasta' && f.folder !== this.q.folder) this.q = { ...this.q, folder: f.folder, text: '' };
    this.selected = f.id;
    this.render();
  }

  // ------------------------------------------------------------------ das reuniões

  private renderMeetings(s: KvFilesState): void {
    const now = Date.now();
    const groups = kvByMeeting(kvVisibleFiles(s, { ...this.q, nav: 'reunioes' }), this.q.meeting);
    const blocks: HTMLElement[] = [];
    // as minhas reuniões de ontem até os próximos dias: criar a ata, enviar a pauta
    const mine = kvMeetings()
      .meetings.filter((m) => m.mine && !m.released && m.end > now - 2 * 86_400_000 && (!this.q.meeting || m.id === this.q.meeting))
      .sort((a, b) => Math.abs(a.start - now) - Math.abs(b.start - now))
      .slice(0, 8);
    if (mine.length) {
      blocks.push(
        h(
          'section',
          { class: 'kv-files__meets' },
          h('header', {}, pix(MEET_PIX), kvTitle('h3', this.q.meeting ? tr('Esta reunião') : tr('Minhas reuniões'))),
          h(
            'ul',
            {},
            ...mine.map((m) => {
              const n = s.files.filter((f) => f.meetings.some((x) => x.id === m.id)).length;
              const room = kvMeetRoom(m.room);
              const live = m.start <= now && m.end > now;
              return h(
                'li',
                { class: `kv-files-meet${live ? ' is-live' : ''}` },
                h('div', { class: 'kv-files-meet__when' }, h('strong', { text: kvWhen(m.start, now) }), live ? h('span', { class: 'kv-ui-state kv-ui-state--ok', text: tr('agora') }) : null),
                h('div', { class: 'kv-files-meet__main' }, h('strong', { text: kvMeetLabel(m) }), h('span', { text: [room?.name, n === 1 ? tr('1 arquivo') : tr('{0} arquivos', [n])].filter(Boolean).join(' · ') })),
                h(
                  'div',
                  { class: 'kv-files-meet__act' },
                  s.canFolder ? kvBtn(tr('Ata'), { size: 'sm', icon: DOC_PIX, title: tr('Criar a ata desta reunião'), onClick: () => void this.newAta(m.id) }) : null,
                  s.canFolder ? kvBtn(tr('Enviar'), { size: 'sm', icon: UPLOAD_PIX, title: tr('Enviar arquivos para esta reunião'), onClick: () => this.pick(m.id) }) : null,
                  !this.q.meeting && n ? kvIconBtn(FILES_ICON, tr('Só os arquivos desta reunião'), () => this.go({ nav: 'reunioes', meeting: m.id }), { size: 'sm' }) : null,
                ),
              );
            }),
          ),
        ),
      );
    }
    for (const g of groups) {
      blocks.push(
        h(
          'section',
          { class: 'kv-files__mgroup' },
          h('header', {}, pix(MEET_PIX), h('strong', { text: g.title }), h('span', { text: meetWhen(g.start) }), h('span', { class: 'kv-files__count', text: String(g.files.length) })),
          this.fileList(g.files),
        ),
      );
    }
    if (!groups.length && !mine.length) blocks.push(h('div', { class: 'kv-files__empty' }, kvEmpty(MEET_PIX, tr('Nenhum arquivo de reunião'), tr('Ligue um arquivo a uma reunião nos detalhes dele, ou crie a ata pela reunião.'))));
    else if (!groups.length) blocks.push(h('p', { class: 'kv-files__muted kv-files__pad', text: tr('Ainda não há arquivos ligados a reuniões.') }));
    this.content.replaceChildren(...blocks);
  }

  // ------------------------------------------------------------------ detalhes

  private renderDetail(s: KvFilesState): void {
    const f = [...s.files, ...s.trash].find((x) => x.id === this.selected);
    this.detail.hidden = !f;
    this.modal.el.classList.toggle('has-detail', !!f);
    if (!f) {
      this.detail.replaceChildren();
      return;
    }
    if (this.detail.dataset.id === `${f.id}:${f.version}:${f.updated}:${f.star}:${f.meetings.length}:${f.tags.join()}:${f.desc ?? ''}:${f.name}:${f.trashed ? 1 : 0}`) return;
    this.detail.dataset.id = `${f.id}:${f.version}:${f.updated}:${f.star}:${f.meetings.length}:${f.tags.join()}:${f.desc ?? ''}:${f.name}:${f.trashed ? 1 : 0}`;
    const now = Date.now();
    const preview = h('div', { class: 'kv-files-prev', style: `--kind:${KIND_COLOR[f.kind]}` });
    this.fillPreview(preview, f);
    const head = h(
      'header',
      { class: 'kv-files-det__head' },
      kindBadge(f),
      h('div', {}, h('strong', { class: 'kv-files-det__name', text: f.name }), h('span', { text: `${kvKindName(f.kind)} · ${kvFileSize(f.size)} · v${f.version}` })),
      kvIconBtn(KV_ICONS.close, tr('Fechar detalhes'), () => ((this.selected = null), this.render()), { size: 'sm' }),
    );
    const star = kvIconBtn(STAR_PIX, f.star ? tr('Tirar dos favoritos') : tr('Favoritar'), () => void kvFilesPost(`/${f.id}`, { star: !f.star }), { size: 'sm', cls: f.star ? 'kv-files-star is-on' : 'kv-files-star' });
    const main: HTMLElement[] = [];
    if (f.trashed) {
      main.push(
        h('p', { class: 'kv-files-det__warn', text: tr('Na lixeira desde {0} ({1}).', [kvWhen(f.trashed.at, now), f.trashed.by.name]) }),
        h(
          'div',
          { class: 'kv-files-det__btns' },
          kvBtn(tr('Restaurar'), { variant: 'primary', icon: HISTORY_PIX, onClick: () => void this.call(`/${f.id}/restore`, {}, tr('{0} voltou da lixeira.', [f.name])) }),
          kvBtn(tr('Apagar de vez'), { variant: 'danger', icon: KV_ICONS.trash, onClick: () => void this.purge(f) }),
        ),
      );
    } else {
      main.push(
        h(
          'div',
          { class: 'kv-files-det__btns' },
          f.type === 'doc' ? kvBtn(f.canEdit ? tr('Editar') : tr('Abrir'), { variant: 'primary', icon: f.canEdit ? KV_ICONS.edit : KV_ICONS.eye, onClick: () => this.openFile(f) }) : kvBtn(tr('Abrir'), { variant: 'primary', icon: KV_ICONS.eye, onClick: () => this.openFile(f) }),
          h('a', { class: 'kv-ui-btn kv-ui-btn--secondary kv-ui-btn--md', attrs: { href: kvFileUrl(f, { dl: true }), download: f.name } }, pix(DOWN_PIX), h('span', { class: 'kv-ui-btn__label', text: tr('Baixar') })),
          star,
          kvIconBtn(LINK_PIX, tr('Copiar link'), () => void this.copyLink(f), { size: 'sm' }),
        ),
      );
    }
    // descrição e etiquetas
    const desc = h('textarea', { class: 'kv-files-det__desc', attrs: { rows: 2, maxlength: 600, placeholder: f.canEdit ? tr('Adicionar uma descrição…') : '' } });
    desc.value = f.desc ?? '';
    desc.disabled = !f.canEdit || !!f.trashed;
    desc.addEventListener('change', () => void kvFilesPost(`/${f.id}`, { desc: desc.value }));
    const tags = h('div', { class: 'kv-files-det__tags' }, ...f.tags.map((t) => h('span', { class: 'kv-files-tag' }, h('span', { text: `#${t}` }), f.canEdit && !f.trashed ? h('button', { type: 'button', text: '×', attrs: { 'aria-label': tr('Tirar {0}', [t]) }, on: { click: () => void kvFilesPost(`/${f.id}`, { tags: f.tags.filter((x) => x !== t) }) } }) : null)));
    if (f.canEdit && !f.trashed && f.tags.length < 8) {
      const add = h('input', { class: 'kv-files-det__tag-in', attrs: { placeholder: tr('+ etiqueta'), maxlength: 24 } });
      add.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !add.value.trim()) return;
        e.preventDefault();
        void kvFilesPost(`/${f.id}`, { tags: [...f.tags, add.value] });
      });
      tags.append(add);
    }
    // reuniões
    const meets = h('div', { class: 'kv-files-det__meets' });
    for (const m of f.meetings) {
      meets.append(
        h(
          'div',
          { class: 'kv-files-det__meet' },
          pix(MEET_PIX),
          h('button', { type: 'button', class: 'kv-files-det__meet-name', text: m.title, title: meetWhen(m.start), on: { click: () => this.go({ nav: 'reunioes', meeting: m.id }) } }),
          h('small', { text: kvWhen(m.start, now) }),
          f.canEdit && !f.trashed ? h('button', { type: 'button', class: 'kv-files-det__x', text: '×', attrs: { 'aria-label': tr('Desligar da reunião') }, on: { click: () => void kvFilesPost(`/${f.id}/link`, { meeting: m.id, on: false }) } }) : null,
        ),
      );
    }
    if (f.canEdit && !f.trashed) {
      const options = kvMeetings()
        .meetings.filter((m) => (m.mine || m.canEdit) && !m.released && !f.meetings.some((x) => x.id === m.id))
        .sort((a, b) => a.start - b.start);
      if (options.length) {
        const sel = h('select', { class: 'kv-files__sel', attrs: { 'aria-label': tr('Ligar a uma reunião') } }, h('option', { attrs: { value: '' }, text: tr('Ligar a uma reunião…') }), ...options.map((m) => h('option', { attrs: { value: m.id }, text: `${kvMeetLabel(m)} · ${kvWhen(m.start, now)}` })));
        sel.addEventListener('change', () => sel.value && void this.call(`/${f.id}/link`, { meeting: sel.value, on: true }, tr('Arquivo ligado à reunião.')));
        meets.append(sel);
      } else if (!f.meetings.length) meets.append(h('p', { class: 'kv-files__muted', text: tr('Nenhuma reunião sua por agora.') }));
    }
    // versões
    const versions = h(
      'ul',
      { class: 'kv-files-det__versions' },
      h('li', { class: 'is-current' }, h('strong', { text: `v${f.version}` }), h('span', { text: `${f.updatedBy.name} · ${kvWhen(f.updated, now)}` }), h('small', { text: tr('atual') })),
      ...f.versions.map((v) =>
        h(
          'li',
          {},
          h('strong', { text: `v${v.n}` }),
          h('span', { text: `${v.by.name} · ${kvWhen(v.at, now)} · ${kvFileSize(v.size)}` }),
          h('a', { class: 'kv-files-det__vlink', attrs: { href: kvFileUrl(f, { v: v.n, dl: true }), download: v.name, title: tr('Baixar esta versão') }, text: '↓' }),
          f.canEdit && !f.trashed ? h('button', { type: 'button', class: 'kv-files-det__vlink', text: '↺', attrs: { title: tr('Voltar para esta versão') }, on: { click: () => void this.revert(f, v.n) } }) : null,
        ),
      ),
    );
    const sec = (title: string, ...kids: (HTMLElement | null)[]) => h('section', { class: 'kv-files-det__sec' }, h('h4', { text: title }), ...kids);
    const tail: HTMLElement[] = [];
    if (f.canEdit && !f.trashed) {
      tail.push(
        h(
          'div',
          { class: 'kv-files-det__btns kv-files-det__btns--end' },
          kvBtn(tr('Renomear'), { size: 'sm', variant: 'ghost', icon: KV_ICONS.edit, onClick: () => void this.rename(f) }),
          kvBtn(tr('Mover'), { size: 'sm', variant: 'ghost', icon: MOVE_PIX, onClick: () => kvMoveTo(f) }),
          f.type === 'arquivo' ? kvBtn(tr('Nova versão'), { size: 'sm', variant: 'ghost', icon: UPLOAD_PIX, onClick: () => this.pickVersion(f) }) : null,
          kvBtn(tr('Lixeira'), { size: 'sm', variant: 'ghost', icon: KV_ICONS.trash, cls: 'kv-files-del', onClick: () => void this.trash(f) }),
        ),
      );
    }
    this.detail.replaceChildren(
      head,
      preview,
      ...main,
      sec(tr('Descrição'), desc),
      sec(tr('Etiquetas'), tags),
      sec(tr('Reuniões'), meets),
      sec(tr('Versões'), versions),
      sec(
        tr('Informações'),
        h(
          'dl',
          { class: 'kv-files-det__info' },
          h('dt', { text: tr('Enviado por') }),
          h('dd', { text: `${f.by.name} · ${kvDateTime(f.at)}` }),
          h('dt', { text: tr('Alterado') }),
          h('dd', { text: `${f.updatedBy.name} · ${kvDateTime(f.updated)}` }),
          h('dt', { text: tr('Pasta') }),
          h('dd', { text: kvFolderPath(f.folder, s.folders).map((x) => x.name).join(' › ') || tr('Raiz (só a equipe)') }),
        ),
      ),
      ...tail,
    );
  }

  private fillPreview(box: HTMLElement, f: KvFileView): void {
    const token = ++this.previewToken;
    const url = kvFileUrl(f);
    if (f.kind === 'imagem') box.append(h('img', { attrs: { src: url, alt: f.name } }));
    else if (f.kind === 'video') box.append(h('video', { attrs: { src: url, controls: true, preload: 'metadata' } }));
    else if (f.kind === 'audio') box.append(kindBadge(f, 'kv-files-kind kv-files-kind--lg'), h('audio', { attrs: { src: url, controls: true, preload: 'metadata' } }));
    else if (kvFileIsText(f.kind, f.name) && f.size < 400_000) {
      const pre = h('div', { class: f.type === 'doc' || /\.md$/i.test(f.name) ? 'kv-files-prev__md kv-md' : 'kv-files-prev__text' });
      box.append(pre);
      void kvFileText(f).then((text) => {
        if (token !== this.previewToken || text === null) return;
        if (pre.classList.contains('kv-md')) pre.innerHTML = kvMarkdown(text.slice(0, 6000));
        else pre.textContent = text.slice(0, 4000);
      });
    } else box.append(kindBadge(f, 'kv-files-kind kv-files-kind--xl'), h('span', { class: 'kv-files-prev__label', text: kvKindName(f.kind) }));
  }

  // ------------------------------------------------------------------ ações

  private openFile(f: KvFileView): void {
    if (f.trashed) return;
    if (f.type === 'doc') return kvOpenDocEditor(f);
    kvOpenViewer(f);
  }

  private async copyLink(f: KvFileView): Promise<void> {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('arquivo', f.id);
    const ok = await copyText(u.toString());
    kvToast(ok ? tr('Link copiado: quem tem acesso abre o arquivo direto.') : tr('Não deu para copiar o link.'), { kind: ok ? 'ok' : 'error' });
  }

  private async call(path: string, body: unknown, okText?: string): Promise<boolean> {
    const r = await kvFilesPost(path, body);
    if (!r.ok) kvToast(r.body.error ?? tr('Não deu certo.'), { kind: 'error' });
    else if (okText) kvToast(okText, { kind: 'ok' });
    return r.ok;
  }

  private async trash(f: KvFileView): Promise<void> {
    if (await this.call(`/${f.id}/trash`, {})) {
      this.selected = null;
      kvToast(tr('{0} foi para a lixeira.', [f.name]), { kind: 'info', action: { label: tr('Desfazer'), run: () => void kvFilesPost(`/${f.id}/restore`, {}) } });
    }
  }

  private async purge(f: KvFileView): Promise<void> {
    const yes = await kvConfirm({ title: tr('Apagar {0} de vez?', [f.name]), text: tr('O arquivo e todas as versões somem e não dá para desfazer.'), ok: tr('Apagar de vez'), danger: true });
    if (!yes) return;
    const r = await kvFilesPost(`/${f.id}`, {}, 'DELETE');
    if (!r.ok) kvToast(r.body.error ?? tr('Não deu certo.'), { kind: 'error' });
    else this.selected = null;
  }

  private async revert(f: KvFileView, n: number): Promise<void> {
    const yes = await kvConfirm({ title: tr('Voltar {0} para a versão {1}?', [f.name, n]), text: tr('A versão atual continua guardada no histórico.'), ok: tr('Voltar') });
    if (yes) await this.call(`/${f.id}/revert`, { version: n }, tr('Pronto: a versão {0} virou a atual.', [n]));
  }

  private async rename(f: KvFileView): Promise<void> {
    const name = await kvAsk(tr('Renomear'), f.name);
    if (name && name !== f.name) await this.call(`/${f.id}`, { name });
  }

  private pickMeeting: string | undefined;
  private pickReplace: string | undefined;

  private pick(meeting?: string): void {
    this.pickMeeting = meeting;
    this.pickReplace = undefined;
    this.fileInput.multiple = true;
    this.fileInput.click();
  }

  private pickVersion(f: KvFileView): void {
    this.pickMeeting = undefined;
    this.pickReplace = f.id;
    this.fileInput.multiple = false;
    this.fileInput.click();
  }

  /** Pasta onde envio agora (nas vistas sem pasta: a raiz; o cliente, sem raiz, precisa abrir uma pasta). */
  private targetFolder(): string | null {
    return this.q.nav === 'pasta' ? this.q.folder : null;
  }

  private async upload(list: File[], folder: string | null = this.pickMeeting ? 'reunioes' : this.targetFolder(), meeting = this.pickMeeting): Promise<void> {
    const replace = this.pickReplace;
    this.pickMeeting = undefined;
    this.pickReplace = undefined;
    if (!list.length) return;
    const target = folder;
    const done: string[] = [];
    let lastId = '';
    for (let i = 0; i < list.length; i++) {
      const file = list[i]!;
      this.progress.hidden = false;
      this.progress.replaceChildren(h('span', { class: 'kv-files__spin' }), h('span', { text: tr('Enviando {0} ({1} de {2})…', [file.name, i + 1, list.length]) }));
      const r = await kvUploadFile(file, { folder: target, ...(meeting ? { meeting } : {}), ...(replace ? { replace } : {}) });
      if (r.error) kvToast(r.error, { kind: 'error', ms: 8000 });
      else {
        done.push(file.name);
        lastId = r.file?.id ?? lastId;
      }
    }
    this.progress.hidden = true;
    if (done.length) {
      kvToast(replace ? tr('Nova versão enviada.') : done.length === 1 ? tr('{0} enviado.', [done[0]!]) : tr('{0} arquivos enviados.', [done.length]), { kind: 'ok' });
      if (done.length === 1 && lastId) this.selected = lastId;
      await kvReloadFiles();
    }
  }

  private async newDoc(): Promise<void> {
    const name = await kvAsk(tr('Novo documento'), tr('Documento sem título'));
    if (!name) return;
    const r = await kvFilesPost<{ file: KvFileView }>('/doc', { name, folder: this.targetFolder(), text: `# ${name.replace(/\.md$/i, '')}\n\n` });
    if (!r.ok) return void kvToast(r.body.error ?? tr('Não deu certo.'), { kind: 'error' });
    this.selected = r.body.file.id;
    kvOpenDocEditor(r.body.file);
  }

  private async newAta(meetingId: string): Promise<void> {
    const m = kvMeetings().meetings.find((x) => x.id === meetingId);
    if (!m) return;
    const room = kvMeetRoom(m.room);
    const when = kvDateTime(m.start);
    const text = kvAtaTemplate(
      { title: kvMeetLabel(m), when, room: room?.name, by: m.by?.name, people: (m.people ?? []).map((p) => p.name), note: m.note },
      {
        ata: tr('Ata'),
        date: tr('Data'),
        room: tr('Sala'),
        by: tr('Organizador'),
        people: tr('Participantes'),
        agenda: tr('Pauta'),
        notes: tr('Anotações'),
        decisions: tr('Decisões'),
        next: tr('Próximos passos'),
        who: tr('quem'),
        until: tr('até'),
      },
    );
    const date = new Date(m.start).toISOString().slice(0, 10);
    const r = await kvFilesPost<{ file: KvFileView }>('/doc', { name: `${tr('Ata')} - ${kvMeetLabel(m)} - ${date}`, folder: kvFiles().canFolder ? 'reunioes' : this.targetFolder(), text, meeting: m.id });
    if (!r.ok) return void kvToast(r.body.error ?? tr('Não deu certo.'), { kind: 'error' });
    kvToast(tr('Ata criada na pasta Reuniões e ligada à reunião.'), { kind: 'ok' });
    kvOpenDocEditor(r.body.file);
  }

  // ------------------------------------------------------------------ arrastar

  private dropZone(el: HTMLElement): void {
    let depth = 0;
    const has = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    el.addEventListener('dragenter', (e) => {
      if (!has(e) || !kvFiles().canUpload) return;
      e.preventDefault();
      depth++;
      el.classList.add('is-drop');
    });
    el.addEventListener('dragover', (e) => {
      if (!has(e) || !kvFiles().canUpload) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    el.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) el.classList.remove('is-drop');
    });
    el.addEventListener('drop', (e) => {
      depth = 0;
      el.classList.remove('is-drop');
      if (!has(e) || !kvFiles().canUpload) return;
      e.preventDefault();
      const meeting = this.q.nav === 'reunioes' ? this.q.meeting : undefined;
      if (this.q.nav !== 'pasta' && !kvFiles().canFolder) return void kvToast(tr('Abra uma pasta para enviar arquivos.'), { kind: 'warn' });
      void this.upload([...(e.dataTransfer?.files ?? [])], meeting ? 'reunioes' : this.targetFolder(), meeting);
    });
  }

  /** Soltar um arquivo (da lista) numa pasta move; soltar do computador envia para lá. */
  private dropOnFolder(el: HTMLElement, folder: string): void {
    el.addEventListener('dragover', (e) => {
      const types = [...(e.dataTransfer?.types ?? [])];
      if (!types.includes('application/x-kv-file') && !types.includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('is-target');
    });
    el.addEventListener('dragleave', () => el.classList.remove('is-target'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('is-target');
      const id = e.dataTransfer?.getData('application/x-kv-file');
      if (id) {
        e.preventDefault();
        e.stopPropagation();
        void this.call(`/${id}`, { folder }, tr('Arquivo movido.'));
        return;
      }
      if (e.dataTransfer?.files.length) {
        e.preventDefault();
        e.stopPropagation();
        void this.upload([...e.dataTransfer.files], folder);
      }
    });
  }
}

// ------------------------------------------------------------------ visualizador e pergunta

/** Abre o arquivo grande: imagem, PDF, vídeo, áudio e texto dentro do Voxtrin; o resto baixa. */
export function kvOpenViewer(f: KvFileView): void {
  const url = kvFileUrl(f);
  const m = new KvModal({ title: f.name, subtitle: `${kvKindName(f.kind)} · ${kvFileSize(f.size)} · v${f.version}`, icon: kvKindIcon(f.kind), width: 1100, cls: 'kv-files-viewer', onClose: () => m.el.remove() });
  const body = h('div', { class: 'kv-files-viewer__body' });
  if (f.kind === 'imagem') body.append(h('img', { attrs: { src: url, alt: f.name } }));
  else if (f.kind === 'pdf') body.append(h('iframe', { attrs: { src: url, title: f.name } }));
  else if (f.kind === 'video') body.append(h('video', { attrs: { src: url, controls: true, autoplay: true } }));
  else if (f.kind === 'audio') body.append(h('audio', { attrs: { src: url, controls: true, autoplay: true } }));
  else if (kvFileIsText(f.kind, f.name) && f.size < 2_000_000) {
    const md = /\.md$/i.test(f.name);
    const pre = h('div', { class: md ? 'kv-md kv-files-viewer__md' : 'kv-files-viewer__text', text: tr('Carregando…') });
    body.append(pre);
    void kvFileText(f).then((t) => {
      if (t === null) pre.textContent = tr('Não deu para abrir.');
      else if (md) pre.innerHTML = kvMarkdown(t);
      else pre.textContent = t;
    });
  } else {
    body.append(h('div', { class: 'kv-files-viewer__none' }, kindBadge(f, 'kv-files-kind kv-files-kind--xl'), h('p', { text: tr('Este tipo de arquivo não abre aqui. Baixe para abrir no computador.') })));
  }
  m.body.append(body);
  m.setFoot(
    h('a', { class: 'kv-ui-btn kv-ui-btn--primary kv-ui-btn--md', attrs: { href: kvFileUrl(f, { dl: true }), download: f.name } }, pix(DOWN_PIX), h('span', { class: 'kv-ui-btn__label', text: tr('Baixar') })),
    kvBtn(tr('Fechar'), { onClick: () => m.close() }),
  );
  m.show();
}

/** Pergunta um texto (nome) numa caixa do kit; null = cancelou. */
export function kvAsk(title: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => {
    let answer: string | null = null;
    const input = kvInput({ value, maxlength: 120 });
    const m = new KvModal({ title, width: 440, cls: 'kv-files-ask', onClose: () => (m.el.remove(), resolve(answer)) });
    const ok = () => {
      answer = input.input.value.trim() || null;
      m.close();
    };
    input.input.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), ok()));
    m.body.append(input.el);
    m.setFoot(kvBtn(tr('Cancelar'), { onClick: () => m.close() }), kvBtn(tr('Salvar'), { variant: 'primary', onClick: ok }));
    m.show();
    input.input.focus();
    const dot = value.lastIndexOf('.');
    input.input.setSelectionRange(0, dot > 0 ? dot : value.length);
  });
}
