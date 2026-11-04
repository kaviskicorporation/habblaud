// Fork Kaviski (KAVISKI.md): cor e grupo (cliente) por sala, persistidos por pasta em <dataDir>/room-styles.json.
// A chave é o caminho da pasta do projeto: vale também para salas que ainda não existem. Mesmo formato de gravação de
// model/room-aliases.ts (arquivo temporário + rename).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { errMsg, log } from '../log';
import { tr } from '../../shared/i18n';
import { kvColor, kvGroup, kvPathKey, KV_PATH_MAX, KV_ROOMS_MAX, type KvRoomStyle } from '../../shared/kaviski';

export type ParsedStyles = { rooms: Map<string, KvRoomStyle> } | { error: string };

/**
 * Valida o corpo de POST /api/rooms/style: `{"rooms": {"<caminho>": {"color": "#rrggbb", "group": "Nome"}}}`.
 * Cor inválida, caminho vazio/longo demais ou muitas salas -> erro; grupo é limpo e cortado em KV_GROUP_MAX; entrada sem
 * cor nem grupo é ignorada.
 */
export function parseRoomStyles(body: unknown): ParsedStyles {
  const rooms = body && typeof body === 'object' ? (body as { rooms?: unknown }).rooms : undefined;
  if (!rooms || typeof rooms !== 'object' || Array.isArray(rooms)) return { error: tr('esperado {rooms: {"<caminho>": {color, group}}}') };
  const entries = Object.entries(rooms as Record<string, unknown>);
  if (entries.length > KV_ROOMS_MAX) return { error: tr('salas demais (máximo {0})', [KV_ROOMS_MAX]) };
  const out = new Map<string, KvRoomStyle>();
  for (const [path, raw] of entries) {
    const key = kvPathKey(path);
    if (!key || path.length > KV_PATH_MAX) return { error: tr('caminho de sala inválido: {0}', [path.slice(0, 80)]) };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: tr('estilo inválido para {0}', [path.slice(0, 80)]) };
    const r = raw as { color?: unknown; group?: unknown };
    const style: KvRoomStyle = {};
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
    if (style.color || style.group) out.set(key, style);
  }
  return { rooms: out };
}

export class RoomStyles {
  private styles = new Map<string, KvRoomStyle>();

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

  get(path: string): KvRoomStyle | undefined {
    return this.styles.get(kvPathKey(path));
  }

  /** O mapa inteiro, chave = caminho comparável. */
  all(): Record<string, KvRoomStyle> {
    return Object.fromEntries(this.styles);
  }

  /** Troca o mapa inteiro e grava. */
  replace(rooms: Map<string, KvRoomStyle>): void {
    this.styles = new Map(rooms);
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
