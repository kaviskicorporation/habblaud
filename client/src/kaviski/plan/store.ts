// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre"): a planta gravada no servidor, lado da página. Um só lugar que
// busca e guarda o documento (GET /api/kaviski/humanos/plan, já filtrado por quem vê) e recarrega sozinho no evento
// `plan` do fluxo de presença. O motor do prédio (engine*.ts) monta o prédio com `kvPlanDoc()`; o editor grava por aqui.
// Sem HABBLAUD_HUMANOS a rota não existe (404): `kvPlanDoc()` fica null e nada muda.
import type { KvPlan, KvPlanDoc, KvPlanProblem, KvPlanVersionInfo } from '../../../../shared/kaviski-plan';
import { tr } from '../../../../shared/i18n';

export const PLAN_API = '/api/kaviski/humanos/plan';

export type KvPlanDocView = KvPlanDoc & { canEdit: boolean };

let doc: KvPlanDocView | null = null;
let loading: Promise<KvPlanDocView | null> | null = null;
const listeners = new Set<(d: KvPlanDocView | null) => void>();

/** O documento gravado (null até carregar, ou sem pessoas no escritório). */
export function kvPlanDoc(): KvPlanDocView | null {
  return doc;
}

/** A planta gravada e ligada (null = prédio original). */
export function kvSavedPlan(): KvPlan | null {
  return doc?.plan && doc.plan.on ? doc.plan : null;
}

/** Avisa quando o documento muda (carregou, alguém gravou). Devolve a função que para de ouvir. */
export function kvOnPlanDoc(cb: (d: KvPlanDocView | null) => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

function set(d: KvPlanDocView | null): void {
  const same = doc && d && doc.version === d.version && doc.canEdit === d.canEdit && JSON.stringify(doc.plan) === JSON.stringify(d.plan);
  doc = d;
  if (same) return;
  for (const f of [...listeners]) {
    try {
      f(d);
    } catch (err) {
      console.error('[habblaud] planta:', err);
    }
  }
}

/** Busca (de novo) a planta no servidor. Chamadas juntas viram uma só. */
export function kvLoadPlan(fetchImpl: typeof fetch = fetch): Promise<KvPlanDocView | null> {
  loading ??= (async () => {
    try {
      const res = await fetchImpl(PLAN_API, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return doc;
      const d = (await res.json()) as KvPlanDocView;
      set(d && typeof d.version === 'number' ? d : null);
      return doc;
    } catch {
      return doc;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export type KvPlanSaveOutcome =
  | { ok: true; doc: KvPlanDocView; problems: KvPlanProblem[] }
  | { ok: false; conflict?: KvPlanDocView; error: string };

async function post(path: string, body: unknown): Promise<KvPlanSaveOutcome> {
  try {
    const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as Partial<KvPlanDocView> & { error?: string; doc?: KvPlanDocView; problems?: KvPlanProblem[] };
    if (res.status === 409 && j.doc) return { ok: false, conflict: j.doc, error: j.error ?? tr('a planta mudou enquanto você editava') };
    if (!res.ok) return { ok: false, error: j.error ?? tr('não deu para gravar a planta ({0})', [res.status]) };
    const d = j as KvPlanDocView;
    set({ plan: d.plan ?? null, version: d.version ?? 0, updatedAt: d.updatedAt ?? 0, ...(d.by ? { by: d.by } : {}), canEdit: !!d.canEdit });
    return { ok: true, doc: doc!, problems: j.problems ?? [] };
  } catch {
    return { ok: false, error: tr('Sem conexão com o servidor.') };
  }
}

/** Grava a planta (`base` = a versão que o editor abriu; 409 = outra pessoa gravou no meio). */
export function kvSavePlan(plan: KvPlan, base: number, o: { note?: string; paths?: string[] } = {}): Promise<KvPlanSaveOutcome> {
  return post(PLAN_API, { plan, base, ...(o.note ? { note: o.note } : {}), ...(o.paths?.length ? { paths: o.paths } : {}) });
}

/** Volta para uma versão antiga (vira uma versão nova). */
export function kvRestorePlan(version: number, base: number): Promise<KvPlanSaveOutcome> {
  return post(`${PLAN_API}/restore`, { version, base });
}

/** As versões guardadas (a mais nova primeiro); null = sem permissão ou sem conexão. */
export async function kvPlanVersions(): Promise<KvPlanVersionInfo[] | null> {
  try {
    const res = await fetch(`${PLAN_API}/versions`, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return null;
    return ((await res.json()) as { versions?: KvPlanVersionInfo[] }).versions ?? [];
  } catch {
    return null;
  }
}

/** Liga a planta na página: busca agora e de novo a cada evento `plan` (alguém gravou). */
export function kvStartPlanStore(client: { onEvent<T>(name: string, cb: (data: T) => void): () => void } | null): void {
  void kvLoadPlan();
  client?.onEvent<{ version: number; refilter?: boolean }>('plan', (e) => {
    // refilter: a mesma versão, mas mudou o que eu vejo dela (convidado de uma reunião, frente das reuniões)
    if (!doc || e?.version !== doc.version || e?.refilter) void kvLoadPlan();
  });
}
