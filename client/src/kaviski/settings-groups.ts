// Fork Kaviski (KAVISKI.md): grupos do fork no painel Configurações. Cada módulo registra o seu grupo (um
// <div class="ui-set-group"> com <h3>) e o settings.ts do original põe todos juntos logo depois de "Aparência"
// (um gancho só). `render` é chamado toda vez que o painel abre (para reler o estado).
export interface KvSettingsGroup {
  el: HTMLElement;
  render?: () => void;
}

const builders: (() => KvSettingsGroup)[] = [];
let built: KvSettingsGroup[] | null = null;

/** Registra um grupo. Chame ao importar o módulo (antes de o painel ser montado, no createUI). */
export function kvRegisterSettingsGroup(build: () => KvSettingsGroup): void {
  builders.push(build);
}

/** Os grupos do fork, montados uma vez (o settings.ts chama ao montar o painel). */
export function kvSettingsGroups(): HTMLElement[] {
  if (!built) built = builders.map((b) => b());
  return built.map((g) => g.el);
}

/** Relê o estado de cada grupo (o settings.ts chama quando o painel abre). */
export function kvRenderSettingsGroups(): void {
  for (const g of built ?? []) g.render?.();
}
