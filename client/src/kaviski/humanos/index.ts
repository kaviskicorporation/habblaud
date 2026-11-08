// Fork Kaviski (KAVISKI-HUMANOS.md): pessoas no escritório, lado da página. Pergunta ao servidor quem está aqui
// (GET /api/kaviski/humanos/me; 404 = HABBLAUD_HUMANOS desligado e nada muda) e:
// - mostra "Nome · papel" na linha de status do topo, que abre quem está online (online.ts) e liga a presença ao vivo
//   (presence.ts) e o meu boneco andando no escritório (world.ts);
// - para quem é admin (ou pela porta local, no próprio computador), o botão Pessoas no grupo de painéis.
// O filtro das salas é do servidor: a página só mostra o que recebe.
import { kvRestricted, type KvMe } from '../../../../shared/kaviski-humanos';
import { tr } from '../../../../shared/i18n';
import { iconButton } from '../../ui/dom';
import { pixelIcon } from '../../ui/icons';
import { kvOpenPeople } from './people';
import { KvOnline } from './online';
import { KvPresenceClient } from './presence';
import { kvStartMedia } from './media';
import { KvBar } from './bar';
import { KvChatPanel } from './chat';
import { KvPersonCard, kvRegisterBasicActions } from './person-card';
import { kvTopButton } from './topbar';
import { kvStartAgentExtras } from './agent';
import { kvStartSocial } from './social';
import { kvPeople } from './world';
import { kvStartW1 } from './w1';
import { kvStartSalas } from './salas';
import { kvStartOrg } from './org-start';
import { kvStartPlan } from '../plan';
import type { OfficeStore } from '../../net/store';
import { kvStartExtras } from './extras';
import { kvAutoEnhance } from './ui/enhance';
import { kvStartTopGroups } from '../topbar-groups';
import { kvStartGoAndDo } from '../plan/go-and-do';
import { kvStartUx } from '../ux';
import { kvStartMeetings } from './meetings';
import { kvStartFiles } from './files';
import './humanos.css';

const PEOPLE_ICON = pixelIcon(['..##....##..', '.####..####.', '.####..####.', '..##....##..', '............', '.####..####.', '######.#####', '######.#####', '######.#####']);

const CHAT_TOP_ICON = pixelIcon(['.########.', '#........#', '#.##.##..#', '#........#', '#.#####..#', '#........#', '.###.####.', '...##.....', '...#......']);

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
    // W6: os <select> nativos das telas das pessoas viram o select do kit (ui/enhance.ts)
    kvAutoEnhance((document.querySelector('.ui-root') as HTMLElement | null) ?? document.body);
    const status = root.querySelector('.ui-topbar__status');
    if (m.person && status) {
      // Com pessoas no escritório, a tela "O escritório está vazio — Ver demonstração" (sem agentes) não cobre mais tudo.
      document.documentElement.classList.add('kv-humanos');
      // Presença ao vivo (fase 1b): o chip do topo abre a lista de quem está online.
      const client = new KvPresenceClient();
      kvPeople.client = client;
      Object.assign((window as { habblaud?: object }).habblaud ?? {}, { kvPeople });
      const w1 = kvStartW1(store, root); // boneco, mesa, móveis, modo foco, toque
      const online = new KvOnline(m, store);
      status.append(online.chip);
      client.on((s) => online.setState(s));
      client.start();
      // Barra do topo (área, conversa) e o painel de conversa (fase 2); voz e vídeo (fase 1c) só com o LiveKit ligado.
      let chat: KvChatPanel | null = null;
      const bar = new KvBar(store, () => chat?.toggle());
      chat = new KvChatPanel(client, bar, store);
      // Conversas sempre à mão no topo (com as não lidas), o cartão de pessoa e as ações básicas dele.
      chat.attachTopButton(kvTopButton(CHAT_TOP_ICON, tr('Conversas'), () => chat?.toggle(), 'kv-btn-chat', 15, root));
      new KvPersonCard(client, store);
      kvRegisterBasicActions(chat);
      // Fase 3: "Chamar até mim" na gaveta do agente e o agente andando até quem chamou.
      kvStartAgentExtras((text) => bar.warn(text));
      client.onEvent<{ agentId: string; to: string; name: string }>('summon', (e) => kvPeople.summon?.(e.agentId, e.to === client.state?.me ? null : e.to, e.name));
      void kvStartMedia(bar);
      w1.ready((text) => bar.warn(text));
      // W2: status com nota, avisos fora da aba, Chamar, reações, trancar sala e roda privada (social.ts)
      kvStartSocial(client, bar, store, m);
      kvStartSalas(m, client); // salas próprias, quadro branco, mural e links
      kvStartOrg(m, store, root); // planta livre: organograma, áreas e agentes de IA fixos
      kvStartPlan(m, client, store); // planta livre: a planta gravada e o editor da empresa
      kvStartMeetings(m, client, root); // reuniões e reservas de sala (estilo Teams)
      kvStartFiles(m, client, root); // Sala de Arquivos: pastas, documentos, versões e arquivos das reuniões
    }
    if (kvRestricted(m.person)) {
      // O servidor recusa o timelapse, o Meu dia e o terminal ao cliente (são da empresa toda): os botões somem e os
      // atalhos L, M e T também (o atalho do original ignora a tecla já tratada: defaultPrevented).
      const day = tr('Meu dia: para onde foi o tempo (M)');
      root.querySelectorAll<HTMLElement>('.ui-btn-timelapse, .ui-topbar button[aria-label]').forEach((b) => {
        if (b.classList.contains('ui-btn-timelapse') || b.getAttribute('aria-label') === day) b.hidden = true;
      });
      document.addEventListener(
        'keydown',
        (e) => {
          const t = e.target as HTMLElement | null;
          if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
          if (/^[lmtLMT]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault();
        },
        true,
      );
    }
    const admin = m.local || m.person?.role === 'admin';
    const group = root.querySelector('.ui-btn-feed')?.parentElement;
    if (admin && group) {
      const btn = iconButton(PEOPLE_ICON, tr('Pessoas: contas, papéis e salas'), () => kvOpenPeople(), 'kv-btn-people');
      btn.setAttribute('aria-haspopup', 'dialog');
      group.prepend(btn);
    }
    // Convites por link, agenda, modo foco, mini-mapa, atalhos e boas-vindas (extras.ts).
    kvStartExtras(m, store, root);
    kvStartUx(store, m, root); // Busca rápida (Ctrl+K), saudação do dia e o resumo de quando você volta
    kvStartTopGroups(); // topo em grupos com divisórias; os pouco usados e o que não cabe vão para o menu "Mais"
    if (m.person) kvStartGoAndDo(); // planta livre: cada função tem um lugar no escritório e o boneco vai até lá
  });
}
