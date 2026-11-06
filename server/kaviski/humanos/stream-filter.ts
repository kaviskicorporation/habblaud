// Fork Kaviski (KAVISKI-HUMANOS.md): o /api/stream de um cliente só leva as salas dele.
//
// O Hub (http/sse.ts) escreve o mesmo pedaço de texto ("event: X\ndata: JSON\n\n") para todas as páginas. Para a página
// de um cliente, o `res.write` é embrulhado: cada evento é lido, filtrado (snapshot, feed, aviso) e reescrito. O mesmo
// pedaço chega a vários clientes com as mesmas regras: a última conversão fica guardada por conjunto de regras.
// Nenhuma linha do sse.ts muda.
import type { ServerResponse } from 'node:http';
import type { FeedItem, Notice, OfficeSnapshot } from '../../../shared/types';
import { kvAllowedRoomIds, kvFilterFeed, kvFilterSnapshot, kvNoticeAllowed } from '../../../shared/kaviski-humanos';

interface Cached {
  chunk: string;
  out: string;
  ids: Set<string>;
}
const cache = new Map<string, Cached>();

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Converte um pedaço do fluxo para quem tem as `rules`. `ids` = salas liberadas no último snapshot visto (para o feed e
 * os avisos). Devolve o texto a escrever ('' = nada) e as salas liberadas atualizadas.
 */
export function kvFilterChunk(chunk: string, rules: readonly string[], ids: Set<string>): { out: string; ids: Set<string> } {
  if (!chunk.startsWith('event: ')) return { out: chunk, ids }; // retry, ping
  const nl = chunk.indexOf('\ndata: ');
  if (nl < 0) return { out: '', ids };
  const event = chunk.slice(7, nl);
  let data: unknown;
  try {
    data = JSON.parse(chunk.slice(nl + 7));
  } catch {
    return { out: '', ids };
  }
  if (event === 'snapshot') {
    const snap = data as OfficeSnapshot;
    const next = kvAllowedRoomIds(snap, rules);
    return { out: sse('snapshot', kvFilterSnapshot(snap, rules)), ids: next };
  }
  if (event === 'feed') {
    const list = kvFilterFeed((data as FeedItem[]) ?? [], ids);
    return { out: list.length ? sse('feed', list) : '', ids };
  }
  if (event === 'notice') return { out: kvNoticeAllowed(data as Notice, ids) ? sse('notice', data) : '', ids };
  return { out: '', ids }; // evento novo do original: na dúvida, o cliente não recebe
}

/** Embrulha o `write` da resposta SSE de um cliente (chamar antes do hub.attach). */
export function kvFilterStream(res: ServerResponse, rules: readonly string[]): void {
  const key = rules.join('\0');
  const write = res.write.bind(res) as (chunk: string) => boolean;
  let ids = new Set<string>();
  (res as { write: unknown }).write = (chunk: unknown): boolean => {
    if (typeof chunk !== 'string') return true; // o Hub só escreve texto
    const c = cache.get(key);
    let out: string;
    if (c && c.chunk === chunk) {
      out = c.out;
      if (chunk.startsWith('event: snapshot')) ids = c.ids;
    } else {
      const r = kvFilterChunk(chunk, rules, ids);
      out = r.out;
      // Só o snapshot é guardado (o feed depende das salas de cada conexão, que vêm do mesmo snapshot).
      if (chunk.startsWith('event: snapshot')) {
        cache.set(key, { chunk, out, ids: r.ids });
        if (cache.size > 64) cache.delete(cache.keys().next().value!);
      }
      ids = r.ids;
    }
    return out ? write(out) : true;
  };
}
