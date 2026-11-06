// Fork Kaviski (KAVISKI-HUMANOS.md): boas-vindas de quem entra pela primeira vez — um tour curto de 3 a 4 passos
// (escolher o boneco, no caso do visitante; andar; conversar; E para usar as coisas; modo foco), lembrado neste
// navegador por pessoa. A janela de Atalhos tem "Ver o tour de novo".
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';

const KEY = 'habblaud.kv.boasvindas';

interface Step {
  icon: string;
  title: string;
  text: string;
  action?: { label: string; run: () => void };
}

export function kvWelcomeSeen(personId: string): boolean {
  try {
    return localStorage.getItem(`${KEY}.${personId}`) === '1';
  } catch {
    return true;
  }
}

function markSeen(personId: string): void {
  try {
    localStorage.setItem(`${KEY}.${personId}`, '1');
  } catch {
    // sem localStorage
  }
}

export function kvShowWelcome(opts: { personId: string; name: string; visitor: boolean; restricted: boolean; openProfile: () => void; openKeys: () => void }): void {
  document.querySelector('.kv-welcome')?.remove();
  const steps: Step[] = [];
  if (opts.visitor) {
    steps.push({ icon: '🧑‍🎨', title: tr('Olá, {0}! Escolha o seu avatar', [opts.name]), text: tr('É assim que os outros vão ver você no escritório. Dá para trocar depois em “Meu avatar”, no seu nome lá em cima.'), action: { label: tr('Escolher o avatar'), run: opts.openProfile } });
  }
  steps.push(
    { icon: '🚶', title: opts.visitor ? tr('Andar pelo escritório') : tr('Bem-vindo ao escritório, {0}!', [opts.name]), text: tr('O seu avatar chega pelo elevador da recepção. Ande com as setas ou W A S D (Shift corre) ou clique no chão. O mini-mapa no canto (tecla N) mostra onde está todo mundo.') },
    { icon: '💬', title: tr('Conversar'), text: tr('Enter abre a conversa da área onde você está: quem está perto lê. Chegue perto de alguém para falar por voz; G manda um cumprimento. Clique numa pessoa para ver o cartão dela.') },
    { icon: '🪑', title: tr('E para usar as coisas'), text: opts.restricted ? tr('Perto de uma cadeira, quadro ou mural aparece a dica “E · …”: aperte E. Chegue perto de um agente de IA para ver o que ele está fazendo.') : tr('Perto de uma cadeira, quadro ou mural aparece a dica “E · …”: aperte E. Chegue perto de um agente de IA para abrir o painel dele (conversa, aprovar, terminal).') },
  );
  if (!opts.visitor) steps.push({ icon: '🎧', title: tr('Modo foco e agenda'), text: tr('O botão dos fones no topo liga um foco de 25 ou 50 min (“🎧 Focado até…”). O calendário lê a sua agenda do Google ou do Outlook e põe “📅 Em reunião” sozinho.') });
  let i = 0;
  const icon = h('div', { class: 'kv-welcome__icon', attrs: { 'aria-hidden': 'true' } });
  const title = h('h2', { class: 'kv-welcome__title', attrs: { id: 'kv-welcome-title' } });
  const text = h('p', { class: 'kv-welcome__text' });
  const dots = h('div', { class: 'kv-welcome__dots', attrs: { 'aria-hidden': 'true' } });
  const action = h('button', { class: 'ui-btn ui-btn--sm', type: 'button' });
  const back = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Voltar'), on: { click: () => go(i - 1) } });
  const next = h('button', { class: 'ui-btn ui-btn--sm ui-btn--primary', type: 'button', on: { click: () => (i < steps.length - 1 ? go(i + 1) : done()) } });
  const skip = h('button', { class: 'kv-welcome__skip', type: 'button', text: tr('Pular'), on: { click: () => done() } });
  const keys = h('button', { class: 'kv-welcome__skip', type: 'button', text: tr('Ver todas as teclas'), on: { click: () => (done(), opts.openKeys()) } });
  const box = h(
    'div',
    { class: 'kv-welcome', attrs: { role: 'dialog', 'aria-labelledby': 'kv-welcome-title', 'aria-live': 'polite' } },
    icon,
    title,
    text,
    action,
    h('div', { class: 'kv-welcome__foot' }, dots, h('div', { class: 'kv-welcome__nav' }, back, next)),
    h('div', { class: 'kv-welcome__links' }, skip, keys),
  );
  (document.querySelector('.ui-root') ?? document.body).append(box);

  function go(n: number): void {
    i = Math.max(0, Math.min(steps.length - 1, n));
    const s = steps[i]!;
    icon.textContent = s.icon;
    title.textContent = s.title;
    text.textContent = s.text;
    action.hidden = !s.action;
    if (s.action) {
      action.textContent = s.action.label;
      action.onclick = s.action.run;
    }
    back.hidden = i === 0;
    next.textContent = i < steps.length - 1 ? tr('Próximo') : tr('Começar');
    dots.replaceChildren(...steps.map((_s, k) => h('span', { class: k === i ? 'is-on' : '' })));
    next.focus({ preventScroll: true });
  }

  function done(): void {
    markSeen(opts.personId);
    box.remove();
  }

  go(0);
}
