// Fork Kaviski (KAVISKI-HUMANOS.md → "Sala de Arquivos"): os arquivos nesta página. Busca GET
// /api/kaviski/humanos/files (já filtrado pelo servidor: só o que eu vejo), relê no evento `files` do fluxo de presença
// e avisa quem ouve. Envio em base64 dentro do JSON (a borda do servidor só aceita JSON: barreira contra CSRF).
import { KV_FILE_MAX, kvFileSize, type KvFilesState, type KvFileView } from '../../../../../shared/kaviski-files';
import { tr } from '../../../../../shared/i18n';
import type { KvPresenceClient } from '../presence';

export const FILES_API = '/api/kaviski/humanos/files';

const EMPTY: KvFilesState = { now: Date.now(), folders: [], files: [], trash: [], activity: [], canUpload: false, canFolder: false, usage: { used: 0, max: 1 } };
let state: KvFilesState = EMPTY;
let loaded = false;
const listeners = new Set<(s: KvFilesState) => void>();
let loading: Promise<void> | null = null;

export function kvFiles(): KvFilesState {
  return state;
}

export function kvFilesLoaded(): boolean {
  return loaded;
}

export function kvOnFiles(cb: (s: KvFilesState) => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

export function kvReloadFiles(): Promise<void> {
  loading ??= (async () => {
    try {
      const res = await fetch(FILES_API, { credentials: 'same-origin', cache: 'no-store' });
      if (res.ok) {
        state = (await res.json()) as KvFilesState;
        loaded = true;
        for (const cb of listeners) cb(state);
      }
    } catch {
      // sem rede: fica o que já tinha
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export function kvStartFilesStore(client: KvPresenceClient): void {
  client.onEvent('files', () => void kvReloadFiles());
}

export interface KvFilesCall<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  body: T & { error?: string };
}

export async function kvFilesPost<T = Record<string, unknown>>(path: string, body: unknown, method: 'POST' | 'DELETE' = 'POST'): Promise<KvFilesCall<T>> {
  try {
    const res = await fetch(FILES_API + path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (res.ok) void kvReloadFiles();
    return { ok: res.ok, status: res.status, body: data };
  } catch {
    return { ok: false, status: 0, body: { error: tr('sem conexão com o escritório') } as T & { error?: string } };
  }
}

/** Endereço do conteúdo (prévia ou download). */
export function kvFileUrl(f: Pick<KvFileView, 'id'>, o: { v?: number; dl?: boolean } = {}): string {
  const q = new URLSearchParams();
  if (o.v) q.set('v', String(o.v));
  if (o.dl) q.set('dl', '1');
  const s = q.toString();
  return `${FILES_API}/${encodeURIComponent(f.id)}/raw${s ? `?${s}` : ''}`;
}

export async function kvFileText(f: Pick<KvFileView, 'id'>, v?: number): Promise<string | null> {
  try {
    const res = await fetch(kvFileUrl(f, { v }), { credentials: 'same-origin', cache: 'no-store' });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

function base64(file: Blob): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? '');
      ok(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => fail(r.error);
    r.readAsDataURL(file);
  });
}

/** Envia um arquivo (novo, ou nova versão de `replace`). Devolve o erro em texto, ou null. */
export async function kvUploadFile(file: File, o: { folder: string | null; meeting?: string; replace?: string }): Promise<{ error: string | null; file?: KvFileView }> {
  if (file.size > KV_FILE_MAX) return { error: tr('{0} é grande demais (até {1}).', [file.name, kvFileSize(KV_FILE_MAX)]) };
  let data: string;
  try {
    data = await base64(file);
  } catch {
    return { error: tr('Não deu para ler {0}.', [file.name]) };
  }
  const r = await kvFilesPost<{ file: KvFileView }>('/upload', { name: file.name, mime: file.type, data, folder: o.folder, ...(o.meeting ? { meeting: o.meeting } : {}), ...(o.replace ? { replace: o.replace } : {}) });
  return r.ok ? { error: null, file: r.body.file } : { error: r.body.error ?? tr('Não deu para enviar {0}.', [file.name]) };
}
