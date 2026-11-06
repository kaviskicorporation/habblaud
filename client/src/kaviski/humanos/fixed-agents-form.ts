// Fork Kaviski (KAVISKI-HUMANOS.md → "Organograma e agentes fixos"): o formulário de um agente de IA fixo — nome,
// sala, qual agente senta ali (o principal, o Claude, o Codex, um subagente ou pelo nome), a cadeira (escolhida no
// escritório), cargo/área/gestor e a aparência opcional (as peças do editor de personagem).
import type { KvOrgAgent } from '../../../../shared/kaviski-org';
import { kvWouldCycle } from '../../../../shared/kaviski-org';
import { hash32 } from '../../../../shared/hash';
import { tr } from '../../../../shared/i18n';
import { appearanceFromSeed } from '../../art';
import type { OfficeStore } from '../../net/store';
import { AppearanceFields } from '../../ui/appearance-fields';
import { changedParts } from '../../ui/character-model';
import { h } from '../../ui/dom';
import { kvDept, kvOrg, kvRemoveFixedAgent, kvSaveFixedAgent } from './org-api';
import { KV_ORG_ICONS } from './org-icons';
import { kvDeptBadge } from './org-people';
import { kvFixedRoomId, kvPickSeat, kvSeatOf } from './fixed-agents';
import { kvOwnRooms } from './rooms';
import { kvRandomSeed } from './world';
import { KV_ICONS, kvAvatar, kvBtn, kvField, kvInput, kvToggle } from './ui/kit';
import { KvSelect, type KvOption } from './ui/select';
import { KvModal, kvConfirm } from './ui/modal';
import { kvSection } from './ui/section';
import { kvToast } from './ui/toast';

type MatchKind = 'main' | 'provider:claude' | 'provider:codex' | 'sub' | 'name';

export class KvFixedAgentForm {
  private readonly modal: KvModal;
  private readonly name;
  private readonly title;
  private readonly matchText;
  private readonly room: KvSelect<string>;
  private readonly match: KvSelect<MatchKind>;
  private readonly dept: KvSelect<string>;
  private readonly boss: KvSelect<string>;
  private readonly seatText: HTMLElement;
  private readonly seatClear: HTMLButtonElement;
  private readonly lookOn;
  private readonly fields = new AppearanceFields();
  private readonly lookBox: HTMLElement;
  private readonly error: HTMLElement;
  private readonly delBtn: HTMLButtonElement;
  private readonly fName;
  private readonly fMatchText;
  private draft: Partial<KvOrgAgent> = {};
  private seed = 0;
  private look: 'f' | 'm' = 'f';

  constructor(private readonly store: OfficeStore) {
    this.modal = new KvModal({ title: tr('Agente de IA fixo'), subtitle: tr('Um lugar marcado para um agente: ele senta sempre ali e entra no organograma.'), icon: KV_ORG_ICONS.robot, width: 760, cls: 'kv-faf' });
    this.name = kvInput({ placeholder: tr('ex.: Claude · Site'), maxlength: 40 });
    this.title = kvInput({ placeholder: tr('ex.: Desenvolvedor front-end'), maxlength: 60 });
    this.matchText = kvInput({ placeholder: tr('parte do nome ou do título da sessão'), maxlength: 40 });
    this.room = new KvSelect<string>({ label: tr('Sala'), options: [], search: true, placeholder: tr('Escolha a sala'), onChange: () => this.suggestName() });
    this.match = new KvSelect<MatchKind>({
      label: tr('Qual agente'),
      value: 'main',
      options: [
        { value: 'main', label: tr('O agente principal da sala'), hint: tr('o primeiro que estiver trabalhando ali') },
        { value: 'provider:claude', label: tr('O Claude Code da sala') },
        { value: 'provider:codex', label: tr('O Codex da sala') },
        { value: 'sub', label: tr('Um subagente da sala'), hint: tr('Explore, Plan e outros que o principal chamar') },
        { value: 'name', label: tr('Pelo nome'), hint: tr('o agente com um texto no nome ou no título') },
      ],
      onChange: () => this.syncMatch(),
    });
    this.dept = new KvSelect<string>({ label: tr('Área'), options: [], value: '' });
    this.boss = new KvSelect<string>({ label: tr('Responde a'), options: [], value: '', search: true });
    this.seatText = h('span', { class: 'kv-faf__seat-text' });
    const pick = kvBtn(tr('Escolher no escritório'), { icon: KV_ORG_ICONS.chair, onClick: () => void this.pickSeat() });
    this.seatClear = kvBtn(tr('Sem cadeira'), { variant: 'ghost', onClick: () => ((this.draft.seat = undefined), (this.draft.seatSide = undefined), this.paintSeat()) });
    this.lookOn = kvToggle(tr('Aparência própria'), { hint: tr('Sem isso, o agente usa o boneco que já tem.'), onChange: (v) => (this.lookBox.hidden = !v) });
    const roll = kvBtn(tr('Sortear'), { icon: KV_ICONS.dice, onClick: () => this.roll() });
    this.lookBox = h('div', { class: 'kv-faf__look ui-char', hidden: true }, h('div', { class: 'ui-char__top kv-pf__top' }, this.fields.preview, h('div', { class: 'kv-pf__side' }, roll)), this.fields.groups);
    this.error = h('p', { class: 'kv-pp__error', attrs: { role: 'alert' }, hidden: true });
    this.fName = kvField(tr('Nome'), this.name.el, { hint: tr('Aparece no organograma e na plaquinha da mesa.') });
    this.fMatchText = kvField(tr('Texto no nome'), this.matchText.el);
    this.modal.body.append(
      kvSection(KV_ORG_ICONS.robot, tr('Quem é'), null, h('div', { class: 'kv-pp__row' }, this.fName.el, kvField(tr('Cargo'), this.title.el, { optional: true }).el), h('div', { class: 'kv-pp__row' }, kvField(tr('Sala'), this.room.el).el, kvField(tr('Qual agente senta aqui'), this.match.el).el), this.fMatchText.el),
      kvSection(KV_ORG_ICONS.chair, tr('Mesa'), tr('A cadeira de sempre. Sem cadeira, o agente fica no organograma e senta onde o Habblaud escolher.'), h('div', { class: 'kv-faf__seat' }, this.seatText, pick, this.seatClear)),
      kvSection(KV_ORG_ICONS.org, tr('Organograma'), null, h('div', { class: 'kv-pp__row' }, kvField(tr('Área'), this.dept.el, { optional: true }).el, kvField(tr('Responde a'), this.boss.el, { optional: true }).el)),
      kvSection(KV_ICONS.user, tr('Aparência'), null, this.lookOn.el, this.lookBox),
      this.error,
    );
    this.delBtn = kvBtn(tr('Apagar'), { variant: 'ghost', icon: KV_ICONS.trash, cls: 'kv-pp__del', onClick: () => void this.remove() });
    this.modal.setFoot(this.delBtn, h('span', { class: 'kv-pp__spacer' }), kvBtn(tr('Cancelar'), { onClick: () => this.modal.close() }), kvBtn(tr('Salvar'), { variant: 'primary', icon: KV_ICONS.check, onClick: () => void this.save() }));
  }

  /** Abre com um agente (editar) ou um rascunho (novo: sala e cadeira já escolhidas pelo menu da cadeira). */
  open(a: Partial<KvOrgAgent>): void {
    this.draft = { ...a };
    this.error.hidden = true;
    this.fName.setError('');
    this.modal.setTitle(a.id ? tr('Agente fixo: {0}', [a.name ?? '']) : tr('Novo agente de IA fixo'));
    this.name.input.value = a.name ?? '';
    this.title.input.value = a.title ?? '';
    this.room.setOptions(this.roomOptions());
    this.room.value = a.room ? kvFixedRoomId(a.room) : null;
    const m = a.match ?? 'main';
    this.match.value = (m.startsWith('name:') ? 'name' : m) as MatchKind;
    this.matchText.input.value = m.startsWith('name:') ? m.slice(5) : '';
    this.syncMatch();
    this.syncOrg();
    this.dept.value = a.dept ?? '';
    this.boss.value = a.reportsTo ?? '';
    this.lookOn.checked = !!a.look;
    this.lookBox.hidden = !a.look;
    this.seed = a.look?.seed ?? kvRandomSeed();
    this.look = a.look?.look ?? (this.seed & 1 ? 'f' : 'm');
    this.fields.set({ ...appearanceFromSeed(this.seed, { look: this.look }), ...((a.look?.parts as object) ?? {}) });
    this.delBtn.hidden = !a.id;
    this.paintSeat();
    if (!a.name) this.suggestName();
    this.modal.show();
    this.name.input.focus();
  }

  private roomOptions(): KvOption<string>[] {
    const snap = this.store.liveSnapshot;
    const opts: KvOption<string>[] = (snap?.rooms ?? []).map((r) => ({ value: r.id, label: r.name, hint: r.path, icon: KV_ICONS.door, keywords: r.path }));
    for (const r of kvOwnRooms()) if (!opts.some((o) => o.value === r.id)) opts.push({ value: r.id, label: r.name, hint: tr('sala própria'), icon: KV_ICONS.door });
    // a sala guardada, mesmo que não esteja no prédio agora
    const cur = this.draft.room ? kvFixedRoomId(this.draft.room) : '';
    if (cur && !opts.some((o) => o.value === cur)) opts.push({ value: cur, label: cur.split('/').filter(Boolean).pop() ?? cur, hint: tr('fora do prédio agora'), icon: KV_ICONS.door });
    return opts;
  }

  private syncMatch(): void {
    this.fMatchText.el.hidden = this.match.value !== 'name';
    this.suggestName();
  }

  private syncOrg(): void {
    const doc = kvOrg();
    this.dept.setOptions([{ value: '', label: tr('Sem área'), icon: kvDeptBadge(undefined) }, ...(doc?.depts ?? []).map((d) => ({ value: d.id, label: d.name, icon: kvDeptBadge(d) }))]);
    const self = this.draft.id ? `a:${this.draft.id}` : null;
    const boss = new Map<string, string | undefined>();
    for (const p of doc?.people ?? []) boss.set(`u:${p.id}`, p.reportsTo);
    for (const a of doc?.agents ?? []) boss.set(`a:${a.id}`, a.reportsTo);
    const ok = (k: string) => k !== self && !(self && kvWouldCycle((x) => boss.get(x), self, k));
    this.boss.setOptions([
      { value: '', label: tr('Ninguém (topo do organograma)'), icon: KV_ORG_ICONS.org },
      ...(doc?.people ?? []).filter((p) => ok(`u:${p.id}`)).map((p) => ({ value: `u:${p.id}`, label: p.name, hint: p.title, icon: kvAvatar({ id: p.id, name: p.name, look: p.look && typeof p.look.seed === 'number' ? (p.look as never) : undefined }, 'xs') })),
      ...(doc?.agents ?? []).filter((a) => ok(`a:${a.id}`)).map((a) => ({ value: `a:${a.id}`, label: a.name, hint: tr('agente de IA'), icon: kvAvatar({ id: a.id, name: a.name, look: { seed: a.look?.seed ?? hash32(`a:${a.id}`), look: 'f', color: kvDept(a.dept)?.color ?? '#9b7bff' } }, 'xs') })),
    ]);
  }

  /** Nome sugerido ("Claude · Site") enquanto a pessoa não escreveu outro. */
  private suggestName(): void {
    const room = this.store.liveSnapshot?.rooms.find((r) => r.id === this.room.value)?.name ?? kvOwnRooms().find((r) => r.id === this.room.value)?.name;
    if (!room) return;
    const who = this.match.value === 'provider:codex' ? 'Codex' : this.match.value === 'sub' ? tr('Ajudante') : 'Claude';
    const sug = `${who} · ${room}`;
    if (!this.name.input.value || this.name.input.dataset.suggested === this.name.input.value) {
      this.name.input.value = sug;
      this.name.input.dataset.suggested = sug;
    }
  }

  private paintSeat(): void {
    const room = this.store.liveSnapshot?.rooms.find((r) => r.id === kvFixedRoomId(this.draft.room ?? ''))?.name;
    this.seatText.textContent = this.draft.seat ? tr('Cadeira marcada{0}.', [room ? ` (${room})` : '']) : tr('Nenhuma cadeira: o Habblaud escolhe.');
    this.seatText.classList.toggle('is-on', !!this.draft.seat);
    this.seatClear.hidden = !this.draft.seat;
  }

  private async pickSeat(): Promise<void> {
    this.modal.close();
    kvToast(tr('Clique numa cadeira de uma sala para a mesa do agente.'), { kind: 'info' });
    const s = await kvPickSeat();
    const seat = s ? kvSeatOf(s) : null;
    if (seat) {
      this.draft = { ...this.draft, ...seat };
      this.room.setOptions(this.roomOptions());
      this.room.value = seat.room;
      this.suggestName();
    } else if (s) kvToast(tr('Essa cadeira não está numa sala.'), { kind: 'error' });
    this.paintSeat();
    this.modal.show();
  }

  private roll(): void {
    this.seed = kvRandomSeed();
    this.look = this.seed & 1 ? 'f' : 'm';
    this.fields.set(appearanceFromSeed(this.seed, { look: this.look }));
  }

  private async save(): Promise<void> {
    const name = this.name.input.value.trim();
    if (!name) return this.fName.setError(tr('Dê um nome ao agente.'));
    this.fName.setError('');
    const room = this.room.value;
    if (!room) return this.fail(tr('Escolha a sala do agente.'));
    const mk = this.match.value ?? 'main';
    const match = mk === 'name' ? `name:${this.matchText.input.value.trim()}` : mk;
    if (match === 'name:') return this.fail(tr('Escreva o texto do nome do agente.'));
    // a sala mudou e a cadeira era da outra: a cadeira sai
    const seatOk = this.draft.seat && this.draft.room && kvFixedRoomId(this.draft.room) === room;
    const a: Partial<KvOrgAgent> = {
      ...(this.draft.id ? { id: this.draft.id } : {}),
      name,
      room,
      match,
      ...(seatOk ? { seat: this.draft.seat, seatSide: this.draft.seatSide } : {}),
      ...(this.title.input.value.trim() ? { title: this.title.input.value.trim() } : {}),
      ...(this.dept.value ? { dept: this.dept.value } : {}),
      ...(this.boss.value ? { reportsTo: this.boss.value } : {}),
    };
    if (this.lookOn.checked) {
      const draft = this.fields.value;
      const parts = draft ? changedParts(appearanceFromSeed(this.seed, { look: this.look }), draft) : {};
      a.look = { seed: this.seed, look: this.look, ...(Object.keys(parts).length ? { parts: parts as Record<string, unknown> } : {}) };
    }
    const r = await kvSaveFixedAgent(a);
    if (r.error) return this.fail(r.error);
    this.modal.close();
    kvToast(this.draft.id ? tr('Agente fixo {0} salvo.', [name]) : tr('Pronto: {0} tem mesa fixa.', [name]), { kind: 'ok' });
  }

  private fail(msg: string): void {
    this.error.textContent = msg;
    this.error.hidden = false;
  }

  private async remove(): Promise<void> {
    const id = this.draft.id;
    if (!id) return;
    const ok = await kvConfirm({ title: tr('Apagar o agente fixo {0}?', [this.draft.name ?? '']), text: tr('A mesa fica livre e ele sai do organograma (o agente de verdade continua trabalhando).'), ok: tr('Apagar'), danger: true });
    if (!ok) return;
    const err = await kvRemoveFixedAgent(id);
    if (err) return this.fail(err);
    this.modal.close();
    kvToast(tr('Agente fixo apagado.'), { kind: 'ok' });
  }
}
