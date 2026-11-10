// Fork Kaviski (KAVISKI-HUMANOS.md → "Convites"): o acesso do convite valendo ao vivo, no servidor.
//
// - Salas temáticas bloqueadas pelo convite: a área `a:kv:<item>` da sala (voz, chat, presença) é recusada ao visitante
//   (`areaGuard`, composto com o guarda do social.ts em index.ts) e a planta dele leva o lugar fechado (`blocksTheme`
//   no kvPlanFor).
// - Voz/vídeo e chat da sala: `voice`/`chat` desligados no convite recusam o token do LiveKit e o POST do chat.
// - Convite editado (`edited`): quem já entrou recebe o acesso novo na hora — a presença passa a filtrar com as regras
//   novas, as páginas recarregam a planta e as salas próprias (eventos `plan` com refilter e `rooms`) e, se mudaram as
//   salas de projeto, o /api/stream dele fecha (a página reconecta sozinha e o snapshot já vem com o filtro novo).
//   Convite que deixou de valer derruba quem está online.
import type { ServerResponse } from 'node:http';
import type { KvPerson } from '../../../shared/kaviski-humanos';
import type { KvInviteEditResult, KvInvites } from './invites';
import type { KvPresence } from './presence';
import type { KvPlanStore } from './plan';

export interface KvInviteLiveDeps {
  invites: Pick<KvInvites, 'person'>;
  presence: Pick<KvPresence, 'refresh' | 'emit'>;
  plan: Pick<KvPlanStore, 'plan' | 'doc'>;
}

export class KvInviteLive {
  /** /api/stream abertos de cada visitante (para fechar quando as salas dele mudam). */
  private readonly streams = new Map<string, Set<ServerResponse>>();

  constructor(private readonly deps: KvInviteLiveDeps) {}

  /** Guarda o /api/stream de um visitante enquanto está aberto. */
  trackStream(person: KvPerson, res: ServerResponse): void {
    if (person.role !== 'visitante') return;
    let set = this.streams.get(person.id);
    if (!set) this.streams.set(person.id, (set = new Set()));
    set.add(res);
    res.on('close', () => {
      set.delete(res);
      if (!set.size && this.streams.get(person.id) === set) this.streams.delete(person.id);
    });
  }

  /** Fecha os /api/stream do visitante (a página reconecta com o filtro novo). */
  closeStreams(id: string): void {
    for (const res of [...(this.streams.get(id) ?? [])]) res.end();
  }

  /** A sala temática (chave) da área `a:kv:<item>` da planta atual, se for uma. */
  themeOfArea(area: string): string | undefined {
    if (!area.startsWith('a:kv:')) return undefined;
    const id = area.slice(5);
    const it = this.deps.plan.plan()?.items.find((x) => x.id === id);
    return it?.kind === 'tema' ? it.ref : undefined;
  }

  /** A sala temática está bloqueada para a pessoa (só visitante; o resto entra em todas). */
  blocksTheme(key: string, person: KvPerson): boolean {
    return person.role === 'visitante' && !!person.guest?.blocked.includes(key);
  }

  /** Guarda de área (como o do social.ts): null = recusa; undefined = segue as outras regras. */
  areaGuard(area: string, person: KvPerson): null | undefined {
    if (person.role !== 'visitante') return undefined;
    const key = this.themeOfArea(area);
    return key && this.blocksTheme(key, person) ? null : undefined;
  }

  /** O convite tirou a voz e o vídeo. */
  noVoice(person: KvPerson): boolean {
    return person.role === 'visitante' && person.guest?.voice === false;
  }

  /** O convite tirou o chat da sala (escrever). */
  noChat(person: KvPerson): boolean {
    return person.role === 'visitante' && person.guest?.chat === false;
  }

  /** Convite editado: leva o acesso novo (ou o fim da visita) a quem já entrou. */
  edited(r: Extract<KvInviteEditResult, { ok: true }>): void {
    const ids = new Set<string>();
    for (const vid of r.visitors) {
      const p = this.deps.invites.person(vid);
      if (!p) {
        this.deps.presence.refresh(undefined, vid);
        this.closeStreams(vid);
        continue;
      }
      this.deps.presence.refresh(p, vid);
      if (r.roomsChanged) this.closeStreams(vid);
      ids.add(vid);
    }
    if (!ids.size) return;
    const at = Date.now();
    this.deps.presence.emit('rooms', { at }, (viewer) => ids.has(viewer.id));
    this.deps.presence.emit('plan', { version: this.deps.plan.doc().version, refilter: true, at }, (viewer) => ids.has(viewer.id));
  }
}
