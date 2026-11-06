// Fork Kaviski (KAVISKI.md, "Detalhes de UX"): o escritório que lembra de você.
// - Saudação do dia: a primeira vez que a pessoa abre o escritório no dia, "Bom dia, Ana ☀️" com o resumo de agora
//   (agentes trabalhando, quem pede você, pessoas online). Uma vez por dia neste navegador; nunca junto do tour.
// - Enquanto você estava fora: voltando para a aba depois de AWAY_MS, um aviso só com o que mudou (agentes que
//   terminaram, que passaram a pedir você, que chegaram). Nada mudou, nada aparece.
import type { KvMe } from '../../../../shared/kaviski-humanos';
import { tr } from '../../../../shared/i18n';
import type { OfficeStore } from '../../net/store';
import type { WorldApi } from '../../world/api';
import { kvToast } from '../humanos/ui/toast';
import { kvWelcomeSeen } from '../humanos/welcome';
import { kvPeople } from '../humanos/world';
import { kvAwaySummary, kvGreeting } from './brief-model';

const DAY_KEY = 'habblaud.kv.saudacao';
const GREET = { 'Bom dia': () => tr('Bom dia'), 'Boa tarde': () => tr('Boa tarde'), 'Boa noite': () => tr('Boa noite') };
/** Fora da aba por pelo menos isto para ganhar o resumo. */
const AWAY_MS = 4 * 60_000;
/** Espera o primeiro snapshot e a presença antes da saudação. */
const GREET_DELAY_MS = 2500;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function select(id: string): void {
  (window as { habblaud?: { world?: WorldApi } }).habblaud?.world?.select({ type: 'agent', id }, { focus: true });
}

function names(list: { name: string }[], max = 2): string {
  const shown = list.slice(0, max).map((a) => a.name);
  const more = list.length - shown.length;
  return more > 0 ? tr('{0} e mais {1}', [shown.join(', '), more]) : shown.join(tr(' e '));
}

export function kvStartBrief(store: OfficeStore, me: KvMe): void {
  const person = me.person;
  if (!person) return;

  // ---- saudação do dia
  setTimeout(() => {
    let seen = '';
    try {
      seen = localStorage.getItem(`${DAY_KEY}.${person.id}`) ?? '';
    } catch {
      return;
    }
    if (seen === today() || !kvWelcomeSeen(person.id)) return;
    try {
      localStorage.setItem(`${DAY_KEY}.${person.id}`, today());
    } catch {
      // segue
    }
    const agents = store.snapshot?.agents ?? [];
    const working = agents.filter((a) => a.status === 'working' || a.status === 'shell').length;
    const waiting = agents.filter((a) => a.status === 'waiting');
    const online = (kvPeople.client?.state?.people ?? []).filter((p) => p.id !== person.id).length;
    const parts = [
      working === 1 ? tr('1 agente trabalhando') : working ? tr('{0} agentes trabalhando', [working]) : tr('nenhum agente trabalhando'),
      waiting.length === 1 ? tr('1 pede você') : waiting.length ? tr('{0} pedem você', [waiting.length]) : '',
      online === 1 ? tr('1 pessoa online') : online ? tr('{0} pessoas online', [online]) : '',
    ].filter(Boolean);
    const g = kvGreeting();
    const first = person.name.split(/\s+/)[0] || person.name;
    kvToast(parts.join(' · '), {
      kind: 'info',
      title: `${GREET[g.text]()}, ${first} ${g.icon}`,
      key: 'kv-greeting',
      ms: 7000,
      action: waiting[0] ? { label: tr('Ver quem pede'), run: () => select(waiting[0]!.id) } : undefined,
    });
  }, GREET_DELAY_MS);

  // ---- enquanto você estava fora
  let hiddenAt = 0;
  let before = new Map<string, string>();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      before = new Map((store.snapshot?.agents ?? []).map((a) => [a.id, a.status]));
      return;
    }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    if (away < AWAY_MS || !before.size) return;
    const s = kvAwaySummary(before, store.snapshot?.agents ?? []);
    const lines = [
      s.waiting.length ? (s.waiting.length === 1 ? tr('🔔 {0} pede você', [names(s.waiting)]) : tr('🔔 {0} pedem você', [names(s.waiting)])) : '',
      s.finished.length ? (s.finished.length === 1 ? tr('✅ {0} terminou', [names(s.finished)]) : tr('✅ {0} terminaram', [names(s.finished)])) : '',
      s.arrived.length ? (s.arrived.length === 1 ? tr('✨ {0} chegou', [names(s.arrived)]) : tr('✨ {0} chegaram', [names(s.arrived)])) : '',
    ].filter(Boolean);
    if (!lines.length) return;
    const go = s.waiting[0] ?? s.finished[0];
    kvToast(lines.join('  ·  '), {
      kind: s.waiting.length ? 'warn' : 'ok',
      title: tr('Enquanto você estava fora ({0} min)', [Math.round(away / 60_000)]),
      key: 'kv-away',
      ms: 12_000,
      action: go ? { label: s.waiting[0] ? tr('Responder') : tr('Ver'), run: () => select(go.id) } : undefined,
    });
  });
}
