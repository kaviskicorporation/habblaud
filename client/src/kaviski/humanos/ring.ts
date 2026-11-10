// Fork Kaviski (KAVISKI-HUMANOS.md, W2): "Chamar" (o wave/ring do Gather) — cutucar uma pessoa esteja onde estiver.
// Quem é chamado ouve um toque, recebe a notificação do sistema (com o Voxtrin fora da frente; botões Responder e Ir
// até no Windows/Chrome) e um aviso com "Ir até" e "Responder" (abre a conversa 1:1). Quem está em não perturbe não
// recebe: quem chamou vê "Fulano está em não perturbe". O limite de frequência é do servidor (social.ts).
import type { KvPresencePerson } from '../../../../shared/kaviski-presence';
import type { KvRingEvent } from '../../../../shared/kaviski-social';
import { tr } from '../../../../shared/i18n';
import type { KvBar } from './bar';
import { kvAlert, kvGoToPerson, kvToast } from './alerts';
import { kvRegisterPersonAction } from './person-actions';
import type { KvPresenceClient } from './presence';
import { kvSocialPost } from './social-api';
import { kvPeople } from './world';

/** Chama a pessoa; o resultado aparece num aviso curto (chamando / não perturbe / espere). */
export async function kvRing(p: Pick<KvPresencePerson, 'id' | 'name'>): Promise<boolean> {
  const r = await kvSocialPost('ring', { to: p.id });
  const title = r.ok ? tr('Chamando {0}…', [p.name]) : r.body.dnd ? tr('{0} está em não perturbe.', [p.name]) : r.error;
  kvToast({ key: 'ring-out', icon: r.body.dnd ? '🔕' : '🔔', title, ms: 5_000 });
  return r.ok;
}

export function kvStartRing(client: KvPresenceClient, bar: KvBar): void {
  kvRegisterPersonAction({
    id: 'chamar',
    label: tr('Chamar'),
    icon: '🔔',
    order: 50,
    when: (p) => p.id !== client.state?.me,
    run: (p) => void kvRing(p),
  });
  client.onEvent<KvRingEvent>('ring', (e) => {
    if (!e?.from) return;
    const name = e.from.name;
    kvAlert({
      kind: 'chamadas',
      key: `ring:${e.from.id}`,
      icon: '🔔',
      title: tr('{0} está te chamando', [name]),
      body: tr('Clique para responder.'),
      tone: 'ring',
      attention: tr('🔔 {0} te chamou', [name]),
      urgent: true,
      needsAnswer: true,
      toast: { ms: 45_000 },
      actions: [
        { id: 'responder', label: tr('Responder'), primary: true, run: () => (kvPeople.openDirect ? kvPeople.openDirect(e.from.id) : bar.chatBtn.click()) },
        { id: 'ir', label: tr('Ir até'), run: () => kvGoToPerson(e.from.id) },
      ],
    });
  });
}
