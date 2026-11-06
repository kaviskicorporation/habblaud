// Fork Kaviski (KAVISKI-HUMANOS.md): pessoas no escritório, lado da página. Pergunta ao servidor quem está aqui
// (GET /api/kaviski/humanos/me; 404 = HABBLAUD_HUMANOS desligado e nada muda) e:
// - mostra "Nome · papel" na linha de status do topo, que abre quem está online (online.ts) e liga a presença ao vivo
//   (presence.ts) e o meu boneco andando no escritório (world.ts);
// - para quem é admin (ou pela porta local, no próprio computador), o botão Pessoas no grupo de painéis.
// O filtro das salas é do servidor: a página só mostra o que recebe.
import type { KvMe } from '../../../../shared/kaviski-humanos';
import { tr } from '../../../../shared/i18n';
import { iconButton } from '../../ui/dom';
import { pixelIcon } from '../../ui/icons';
import { PeopleDialog } from './people';
import { KvOnline } from './online';
import { KvPresenceClient } from './presence';
import { kvStartMedia } from './media';
import { kvPeople } from './world';
import type { OfficeStore } from '../../net/store';
import './humanos.css';

const PEOPLE_ICON = pixelIcon(['..##....##..', '.####..####.', '.####..####.', '..##....##..', '............', '.####..####.', '######.#####', '######.#####', '######.#####']);

let me: KvMe | null = null;

/** Quem está nesta página (null até o servidor responder ou com HABBLAUD_HUMANOS desligado). */
export function kvMe(): KvMe | null {
  return me;
}

export async function kvLoadMe(fetchImpl: typeof fetch = fetch): Promise<KvMe | null> {
  try {
    const res = await fetchImpl('/api/kaviski/humanos/me', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as KvMe;
    return body?.enabled ? body : null;
  } catch {
    return null;
  }
}

export function kvStartHumanos(store: OfficeStore, root: ParentNode = document): void {
  void kvLoadMe().then((m) => {
    me = m;
    if (!m) return;
    const status = root.querySelector('.ui-topbar__status');
    if (m.person && status) {
      // Presença ao vivo (fase 1b): o chip do topo abre a lista de quem está online.
      const client = new KvPresenceClient();
      kvPeople.client = client;
      Object.assign((window as { habblaud?: object }).habblaud ?? {}, { kvPeople });
      const online = new KvOnline(m, store);
      status.append(online.chip);
      client.on((s) => online.setState(s));
      client.start();
      void kvStartMedia(); // voz e vídeo (fase 1c), só com o LiveKit configurado no servidor
    }
    if (m.person?.role === 'cliente') {
      // O servidor recusa o timelapse e o Meu dia ao cliente (são da empresa toda): os botões somem.
      const day = tr('Meu dia: para onde foi o tempo (M)');
      root.querySelectorAll<HTMLElement>('.ui-btn-timelapse, .ui-topbar button[aria-label]').forEach((b) => {
        if (b.classList.contains('ui-btn-timelapse') || b.getAttribute('aria-label') === day) b.hidden = true;
      });
    }
    const admin = m.local || m.person?.role === 'admin';
    const group = root.querySelector('.ui-btn-feed')?.parentElement;
    if (admin && group) {
      let dialog: PeopleDialog | null = null;
      const btn = iconButton(PEOPLE_ICON, tr('Pessoas: contas, papéis e salas'), () => void (dialog ??= new PeopleDialog()).open(), 'kv-btn-people');
      btn.setAttribute('aria-haspopup', 'dialog');
      group.prepend(btn);
    }
  });
}
