// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre", "ir e fazer"): preferências da pessoa que valem em qualquer
// navegador em que ela entrar. Guardadas no perfil da conta (`profile.prefs` no users.json), lidas e gravadas só pela
// própria pessoa em GET/POST /api/kaviski/humanos/prefs. Sem conta, a página guarda no navegador.

export const KV_PREFS_PATH = '/api/kaviski/humanos/prefs';

export interface KvPersonPrefs {
  /**
   * "Ir e fazer": true = o boneco anda até o item e a janela só abre quando ele chega; false (padrão) = a janela abre
   * na hora e o boneco vai andando até lá (fechar a janela antes de ele chegar para o boneco).
   */
  abrirAoChegar: boolean;
}

export const KV_PREFS_DEFAULT: Readonly<KvPersonPrefs> = { abrirAoChegar: false };

const BOOL_KEYS = ['abrirAoChegar'] as const satisfies readonly (keyof KvPersonPrefs)[];

/**
 * Só as preferências conhecidas e com o tipo certo (o resto some). `undefined` = não era um objeto, ou tinha uma chave
 * conhecida com valor inválido (o servidor recusa o pedido inteiro).
 */
export function kvParsePrefs(raw: unknown): Partial<KvPersonPrefs> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: Partial<KvPersonPrefs> = {};
  for (const k of BOOL_KEYS) {
    if (!(k in src)) continue;
    if (typeof src[k] !== 'boolean') return undefined;
    out[k] = src[k] as boolean;
  }
  return out;
}

/** As preferências completas (padrão no que faltar ou estiver estragado). */
export function kvPrefsOf(raw: unknown): KvPersonPrefs {
  return { ...KV_PREFS_DEFAULT, ...(kvParsePrefs(raw) ?? {}) };
}
