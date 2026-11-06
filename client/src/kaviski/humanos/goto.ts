// Fork Kaviski (KAVISKI-HUMANOS.md): ações sobre outra pessoa do meu boneco (registro comum em person-actions.ts; o
// cartão da pessoa e a lista de online as desenham): Seguir (vai atrás até eu andar ou apertar Esc), Teleportar
// (aparece ao lado) e Ir até a mesa (de quem tem mesa fixa). Só com o meu boneco andando e a pessoa visível aqui: o
// servidor já não manda a posição (nem a mesa) de quem está numa sala que eu não vejo.
import { tr } from '../../../../shared/i18n';
import type { KvPresencePerson } from '../../../../shared/kaviski-presence';
import { h } from '../../ui/dom';
import { kvRegisterPersonAction } from './person-actions';
import { kvPeople } from './world';

const here = (p: KvPresencePerson) => kvPeople.inside && !!p.pos && !!kvPeople.locate?.(p.id);

export function kvStartGoto(warn: (text: string) => void): void {
  kvRegisterPersonAction({
    id: 'seguir',
    label: tr('Seguir'),
    icon: '👣',
    order: 40,
    when: (p) => here(p) && kvPeople.following?.id !== p.id,
    run: (p) => void (kvPeople.followPerson?.(p.id, p.name) || warn(tr('Não deu para seguir {0}.', [p.name]))),
  });
  kvRegisterPersonAction({
    id: 'teleportar',
    label: tr('Teleportar'),
    icon: '✨',
    order: 45,
    when: here,
    run: (p) => void (kvPeople.teleportTo?.(p.id) || warn(tr('Não há lugar livre perto de {0}.', [p.name]))),
  });
  kvRegisterPersonAction({
    id: 'ir-mesa',
    label: tr('Ir até a mesa'),
    icon: '🪑',
    order: 46,
    when: (p) => kvPeople.inside && !!p.desk,
    run: (p) => void (kvPeople.goDesk?.(p.id) || warn(tr('A mesa de {0} não está neste prédio.', [p.name]))),
  });

  // "Seguindo Fulano · Esc para parar"
  const stop = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Parar'), on: { click: () => kvPeople.stopMe?.() } });
  const text = h('span');
  const chip = h('div', { class: 'kv-following', hidden: true, attrs: { role: 'status' } }, text, stop);
  (document.querySelector('.ui-root') ?? document.body).append(chip);
  let last = '';
  setInterval(() => {
    const f = kvPeople.following;
    const t = f ? tr('Seguindo {0} · Esc para parar', [f.name]) : '';
    if (t === last) return;
    last = t;
    text.textContent = t;
    chip.hidden = !f;
  }, 200);
}
