// Fork Kaviski (KAVISKI-HUMANOS.md, W2): POST para as rotas de server/kaviski/humanos/social.ts.
import { tr } from '../../../../shared/i18n';

export interface KvPostResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
  /** A mensagem de erro do servidor (ou "sem conexão"). */
  error: string;
}

export async function kvSocialPost(path: 'ring' | 'react' | 'lock' | 'knock' | 'knock/answer' | 'bubble', body: unknown): Promise<KvPostResult> {
  try {
    const res = await fetch(`/api/kaviski/humanos/${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, body: b, error: res.ok ? '' : typeof b.error === 'string' ? b.error : String(res.status) };
  } catch {
    return { ok: false, status: 0, body: {}, error: tr('Sem conexão com o Habblaud.') };
  }
}
