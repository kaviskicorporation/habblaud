// Fork Kaviski (KAVISKI-HUMANOS.md → "Convites"): o avatar não entra na sala sem acesso.
//
// A planta de um cliente/visitante traz as salas que ele não pode ver como itens anônimos `blocked` (o servidor decide,
// server/kaviski/humanos/plan.ts); o motor desenha a sala fechada (plan/engine-blocked.ts) e nenhum tile dela é
// caminhável. Aqui, como as salas trancadas de locks.ts: chegar na porta avisa "Você não tem acesso a esta sala" e, se
// o avatar aparecer lá dentro (planta trocada embaixo dele, convite editado), ele volta para a frente da porta.
import { tr } from '../../../../shared/i18n';
import type { KvPlanItem } from '../../../../shared/kaviski-plan';
import { TILE } from '../../world/constants';
import type { TileRect } from '../../world/layout/types';
import type { Sim } from '../../world/sim/sim';
import { kvPlanWorld } from '../plan/api';
import { kvBlockedDoors, kvBlockedItems } from '../plan/engine-blocked';
import type { KvBar } from './bar';
import { kvPeople } from './world';

const inRect = (r: TileRect, tx: number, ty: number) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h;
/** Frente da porta um pouco maior (1 tile de folga para os lados e para fora). */
const near = (r: TileRect): TileRect => ({ x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 });

export class KvBlocked {
  private warnedAt = 0;
  /** A porta em cuja frente o avatar já está (avisa uma vez por chegada). */
  private atDoor: string | null = null;

  constructor(private readonly bar: KvBar) {
    kvPeople.onFrame.add(() => this.check());
  }

  private sim(): Sim | null {
    try {
      return kvPeople.sim?.() ?? null;
    } catch {
      return null;
    }
  }

  private warn(): void {
    const t = Date.now();
    if (t - this.warnedAt < 2_500) return;
    this.warnedAt = t;
    this.bar.warn(tr('🔒 Você não tem acesso a esta sala.'));
  }

  private check(): void {
    const items: KvPlanItem[] = kvPeople.inside && kvPlanWorld.plan ? kvBlockedItems(kvPlanWorld.plan.items) : [];
    if (!items.length) {
      this.atDoor = null;
      return;
    }
    const sim = this.sim();
    const v = sim?.visitor;
    if (!sim || !v || v.gone) return;
    const tx = Math.floor(v.x / TILE);
    const ty = Math.floor(v.y / TILE);
    let door: string | null = null;
    for (const it of items) {
      const doors = kvBlockedDoors(it);
      if (inRect(it, tx, ty)) {
        // dentro (não devia): volta para a frente da porta mais perto e para de andar
        const best = doors.map((d) => ({ d, dist: Math.hypot(d.front.x + d.front.w / 2 - tx, d.front.y + d.front.h / 2 - ty) })).sort((a, b) => a.dist - b.dist)[0];
        if (!best) continue;
        kvPeople.stopMe?.();
        v.queue.length = 0;
        v.step = null;
        const f = best.d.front;
        const ox = best.d.side === 'w' ? -1 : best.d.side === 'e' ? 1 : 0;
        const oy = best.d.side === 'n' ? -1 : best.d.side === 's' ? 1 : 0;
        v.x = (f.x + f.w / 2 + ox * 0.5) * TILE;
        v.y = (f.y + f.h / 2 + oy * 0.5) * TILE;
        v.tx = Math.floor(v.x / TILE);
        v.ty = Math.floor(v.y / TILE);
        v.setPose('stand');
        this.warn();
        return;
      }
      for (const d of doors) if (inRect(near(d.front), tx, ty) || inRect(d.door, tx, ty)) door = `${it.id}:${d.door.x}:${d.door.y}`;
    }
    if (door && door !== this.atDoor) this.warn();
    this.atDoor = door;
  }
}
