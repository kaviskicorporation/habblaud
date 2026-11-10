// Fork Kaviski (KAVISKI-HUMANOS.md): o que dá para fazer com outra pessoa — "Ir até", "Seguir", "Mensagem", "Chamar"...
// Cada módulo registra as suas ações aqui; a lista de online e o menu ao clicar no boneco mostram todas, na ordem.
import type { KvPresencePerson } from '../../../../shared/kaviski-presence';

export interface KvPersonAction {
  id: string;
  /** Texto do botão, já traduzido. */
  label: string;
  /** Emoji ou ícone curto (opcional). */
  icon?: string;
  /** Ícone em pixel (SVG, como os de KV_ICONS); vence o `icon` no cartão. */
  svg?: string;
  /** No cartão: botão grande ('main') ou no grupo "Mais" ('more'). Padrão: person-card-model.ts KV_CARD_MAIN. */
  group?: 'main' | 'more';
  /** Não fecha o cartão ao clicar (a ação continua nele, ex.: "Mensagem urgente"). */
  keepOpen?: boolean;
  /** Menor fica antes. */
  order: number;
  /** Mostra só quando devolver true (padrão: sempre). */
  when?(p: KvPresencePerson): boolean;
  run(p: KvPresencePerson): void;
}

const actions = new Map<string, KvPersonAction>();
const listeners = new Set<() => void>();

/** Registra (ou troca, pelo id) uma ação; devolve a função que a remove. */
export function kvRegisterPersonAction(a: KvPersonAction): () => void {
  actions.set(a.id, a);
  listeners.forEach((f) => f());
  return () => {
    if (actions.get(a.id) === a) actions.delete(a.id);
    listeners.forEach((f) => f());
  };
}

/** As ações que valem para esta pessoa, em ordem. */
export function kvPersonActions(p: KvPresencePerson): KvPersonAction[] {
  return [...actions.values()].filter((a) => !a.when || a.when(p)).sort((a, b) => a.order - b.order);
}

/** Avisa quando a lista de ações muda (para redesenhar). */
export function kvOnPersonActions(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Avisa que o `when` de alguma ação pode ter mudado (ex.: a Sala de Arquivos carregou): o cartão confere de novo. */
export function kvNotifyPersonActions(): void {
  listeners.forEach((f) => f());
}
