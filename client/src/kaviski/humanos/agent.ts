// Fork Kaviski (KAVISKI-HUMANOS.md): pessoa + agente (fase 3) na gaveta do agente.
//
// "Chamar até mim": o agente levanta e anda até o meu boneco em toda página que o vê (o servidor manda o evento
// `summon` só a quem pode ver aquele agente), fica perto por até 45 s e volta sozinho. O botão entra logo depois do
// "Abrir no TwiCC" (client/src/kaviski/twicc.ts chama kvAgentExtras.update a cada render da gaveta: nenhum gancho novo
// no drawer.ts original).
import type { AgentInfo } from '../../../../shared/types';
import { tr } from '../../../../shared/i18n';
import { h } from '../../ui/dom';
import { kvPeople } from './world';

export const kvAgentExtras: {
  update?: (anchor: HTMLElement, agent: AgentInfo | undefined) => void;
} = {};

/** Liga o botão "Chamar até mim" (só com pessoas ligadas). */
export function kvStartAgentExtras(warn: (text: string) => void): void {
  const btn = h('button', { class: 'ui-btn kv-summon-btn', type: 'button', hidden: true }, h('span', { text: `🙋 ${tr('Chamar até mim')}` }));
  let agentId = '';
  btn.addEventListener('click', async () => {
    if (!agentId) return;
    btn.disabled = true;
    try {
      const res = await fetch('/api/kaviski/humanos/summon', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });
      if (!res.ok) warn(((await res.json().catch(() => ({}))) as { error?: string }).error ?? tr('Não deu para chamar o agente.'));
    } catch {
      warn(tr('Sem conexão com o Habblaud.'));
    } finally {
      setTimeout(() => (btn.disabled = false), 2_000);
    }
  });
  btn.title = tr('O agente vem até você e fica um pouco por perto (todos veem).');
  kvAgentExtras.update = (anchor, agent) => {
    if (btn.previousElementSibling !== anchor) anchor.after(btn);
    agentId = agent?.id ?? '';
    btn.hidden = !agent || !kvPeople.inside || agent.status === 'offline' || agent.status === 'done';
  };
}
