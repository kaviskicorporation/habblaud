// Fork Kaviski (KAVISKI-HUMANOS.md): "Modo clássico" — o Habblaud como o original (teclado e câmera normais, a câmera não
// segue o meu boneco, cliques não andam com ele), mas o boneco não some: vai sozinho descansar no lounge e fica
// sentado lá; os outros o veem com o selo DESCANSANDO. Desligar: ele levanta, volta para a minha mesa (ou para onde
// estava) e as teclas voltam para ele. Substitui o antigo "Andar/Sair do escritório": a escolha fica no navegador
// (`habblaud.kv.classico`); quem tinha saído do escritório (`habblaud.kv.andar` = '0') começa no modo clássico.
// Não confundir com o "Modo foco" (pomodoro, `focus.ts`).
//
// kvPeople.inside = andando (controles, barra, conversa e chamada de voz); kvPeople.resting = descansando.
import { tr } from '../../../../shared/i18n';
import { pixelIcon } from '../../ui/icons';
import { kvTopButton } from './topbar';
import { kvPeople } from './world';

const CLASSIC_KEY = 'habblaud.kv.classico';
const WALK_KEY = 'habblaud.kv.andar';
const ICON = pixelIcon(['...####...', '..##..##..', '.##.......', '.#........', '.#........', '.##.......', '..##..##..', '...####...', '..........', '##########']);

const listeners = new Set<(on: boolean) => void>();
let person = false;
let btn: HTMLButtonElement | null = null;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    // sem localStorage
  }
}

/** O modo clássico está ligado? */
export function kvClassicOn(): boolean {
  return kvPeople.resting;
}

/** Liga ou desliga o modo clássico (lembrado neste navegador). */
export function kvSetClassic(on: boolean): void {
  if (!person) return;
  kvPeople.resting = on;
  kvPeople.inside = !on;
  write(CLASSIC_KEY, on ? '1' : '0');
  write(WALK_KEY, on ? '0' : '1');
  paint();
  for (const cb of listeners) cb(on);
}

/** Avisa quando o modo clássico muda. */
export function kvOnClassic(cb: (on: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function paint(): void {
  if (!btn) return;
  const on = kvPeople.resting;
  const label = on ? tr('Modo clássico ligado: o seu avatar descansa no lounge. Clique para voltar ao escritório.') : tr('Modo clássico: o Habblaud como o original e o seu avatar descansando no lounge');
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-pressed', String(on));
  btn.classList.toggle('is-on', on);
}

/** Começa: lê a escolha guardada e põe o botão no topo. Sem pessoa (porta local de outro Host), não faz nada. */
export function kvStartClassic(hasPerson: boolean, root: ParentNode = document): void {
  person = hasPerson;
  if (!person) {
    kvPeople.inside = false;
    kvPeople.resting = false;
    return;
  }
  const saved = read(CLASSIC_KEY);
  const on = saved !== null ? saved === '1' : read(WALK_KEY) === '0';
  kvPeople.resting = on;
  kvPeople.inside = !on;
  btn = kvTopButton(ICON, '', () => kvSetClassic(!kvPeople.resting), 'kv-btn-classic', 12, root);
  paint();
}
