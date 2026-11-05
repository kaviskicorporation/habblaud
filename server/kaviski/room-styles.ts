// Fork Kaviski (KAVISKI.md): cor, grupo (cliente), sala fixa e nome por sala, persistidos por pasta em
// <dataDir>/room-styles.json. A chave é o caminho da pasta do projeto: vale também para salas que ainda não existem (e a
// sala fixa existe sempre, mesmo vazia). A ordem do mapa é guardada: é a ordem das salas fixas no prédio. Mesmo formato
// de gravação de model/room-aliases.ts (arquivo temporário + rename).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { errMsg, log } from '../log';
import { tr } from '../../shared/i18n';
import { kvColor, kvGroup, kvPathKey, kvRoomName, kvRoomPath, KV_PATH_MAX, KV_ROOMS_MAX, type KvRoomEntry } from '../../shared/kaviski';

export type ParsedStyles = { rooms: Map<string, KvRoomEntry> } | { error: string };

/**
 * Valida o corpo de POST /api/rooms/style:
 * `{"rooms": {"<caminho>": {"color": "#rrggbb", "group": "Nome", "pinned": true, "name": "Nome da sala"}}}`.
 * Cor inválida, `pinned` que não é booleano, caminho vazio/longo demais ou muitas salas -> erro; grupo e nome são limpos
 * e cortados (KV_GROUP_MAX, KV_NAME_MAX); entrada sem nenhum campo é ignorada. Chave repetida (sem diferença de
 * maiúsculas): vale a última. `path` na entrada (o arquivo gravado) devolve as maiúsculas do caminho.
 */
export function parseRoomStyles(body: unknown): ParsedStyles {
  const rooms = body && typeof body === 'object' ? (body as { rooms?: unknown }).rooms : undefined;
  if (!rooms || typeof rooms !== 'object' || Array.isArray(rooms)) return { error: tr('esperado {rooms: {"<caminho>": {color, group}}}') };
  const entries = Object.entries(rooms as Record<string, unknown>);
  if (entries.length > KV_ROOMS_MAX) return { error: tr('salas demais (máximo {0})', [KV_ROOMS_MAX]) };
  const out = new Map<string, KvRoomEntry>();
  for (const [path, raw] of entries) {
    const key = kvPathKey(path);
    if (!key || path.length > KV_PATH_MAX) return { error: tr('caminho de sala inválido: {0}', [path.slice(0, 80)]) };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: tr('estilo inválido para {0}', [path.slice(0, 80)]) };
    const r = raw as { color?: unknown; group?: unknown; pinned?: unknown; name?: unknown; path?: unknown; hidden?: unknown };
    const style: KvRoomEntry = {};
    if (r.color !== undefined && r.color !== null && r.color !== '') {
      const color = kvColor(r.color);
      if (!color) return { error: tr('cor inválida para {0} (use #rgb ou #rrggbb)', [path.slice(0, 80)]) };
      style.color = color;
    }
    if (r.group !== undefined && r.group !== null) {
      if (typeof r.group !== 'string') return { error: tr('grupo inválido para {0}', [path.slice(0, 80)]) };
      const group = kvGroup(r.group);
      if (group) style.group = group;
    }
    if (r.pinned !== undefined && r.pinned !== null) {
      if (typeof r.pinned !== 'boolean') return { error: tr('pinned inválido para {0} (use true ou false)', [path.slice(0, 80)]) };
      if (r.pinned) style.pinned = true;
    }
    if (r.name !== undefined && r.name !== null) {
      if (typeof r.name !== 'string') return { error: tr('nome inválido para {0}', [path.slice(0, 80)]) };
      const name = kvRoomName(r.name);
      if (name) style.name = name;
    }
    if (r.hidden !== undefined && r.hidden !== null) {
      if (typeof r.hidden !== 'boolean') return { error: tr('hidden inválido para {0} (use true ou false)', [path.slice(0, 80)]) };
      if (r.hidden) style.hidden = true;
    }
    if (style.hidden) {
      // Escondida vence o resto: não faz sentido cor, nome ou sala fixa de uma sala que não aparece.
      out.delete(key);
      out.set(key, { hidden: true });
      continue;
    }
    if (!style.color && !style.group && !style.pinned && !style.name) continue;
    if (style.pinned) {
      // A sala fixa vazia usa o caminho como id: as maiúsculas da chave, ou as do `path` gravado (a chave do arquivo
      // já está em minúsculas).
      style.path = typeof r.path === 'string' && kvPathKey(r.path) === key ? kvRoomPath(r.path) : kvRoomPath(path);
      if (!/^(\/|[A-Za-z]:\/)/.test(style.path)) return { error: tr('sala fixa precisa de caminho absoluto: {0}', [path.slice(0, 80)]) };
    }
    out.delete(key);
    out.set(key, style);
  }
  return { rooms: out };
}

export class RoomStyles {
  private styles = new Map<string, KvRoomEntry>();
  /** Muda a cada troca do mapa (o fork recalcula as salas fixas). */
  version = 0;

  /** `file` null = só em memória (testes). */
  constructor(private readonly file: string | null) {}

  load(): void {
    if (!this.file) return;
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      const r = parseRoomStyles(j);
      if ('error' in r) log.warn(tr('room-styles.json ilegível ({0}); sem cores de sala.', [r.error]));
      else this.styles = r.rooms;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(tr('room-styles.json ilegível ({0}); sem cores de sala.', [errMsg(err)]));
    }
  }

  get size(): number {
    return this.styles.size;
  }

  get(path: string): KvRoomEntry | undefined {
    return this.styles.get(kvPathKey(path));
  }

  /** Entradas na ordem do mapa (chave = caminho comparável). */
  entries(): [string, KvRoomEntry][] {
    return [...this.styles];
  }

  /** O mapa inteiro, chave = caminho comparável (na ordem). */
  all(): Record<string, KvRoomEntry> {
    return Object.fromEntries(this.styles);
  }

  /** Troca o mapa inteiro e grava. */
  replace(rooms: Map<string, KvRoomEntry>): void {
    this.styles = new Map(rooms);
    this.version++;
    this.save();
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: 1, rooms: this.all() }, null, 2));
      renameSync(`${this.file}.tmp`, this.file);
    } catch (err) {
      log.warn(tr('Não consegui gravar {0}: {1}', [this.file, errMsg(err)]));
    }
  }
}
