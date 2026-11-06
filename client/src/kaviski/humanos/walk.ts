// Fork Kaviski (KAVISKI-HUMANOS.md): levar o meu boneco (ou a câmera) a um lugar — usado pelo mini-mapa e pelo "Ir para
// a reunião". Prefere o que o boneco expõe (kvPeople.walkTo em tiles, kvPeople.goArea: levantam antes, se sentado) e,
// se não der, usa o andar por clique do próprio Sim (visitorWalkTo).
import { TILE } from '../../world/constants';
import { FREE } from '../../world/path/grid';
import { VISITOR_ID } from '../../world/sim/visitor';
import { kvPeople } from './world';

/** Anda até o tile (com o boneco no escritório; longe, correndo) ou leva a câmera até lá. */
export function kvWalkTile(tx: number, ty: number): boolean {
  const sim = kvPeople.sim?.();
  const cam = kvPeople.camera;
  if (kvPeople.inside && sim?.visitor) {
    const v = sim.visitor;
    const run = Math.hypot(v.x / TILE - tx, v.y / TILE - ty) > 12;
    if (kvPeople.walkTo?.(tx, ty, run)) return true;
    const t = freeNear(tx, ty);
    if (t && sim.visitorWalkTo(t.x, t.y, run)) {
      if (cam) cam.follow = VISITOR_ID;
      return true;
    }
  }
  if (!cam) return false;
  cam.follow = null;
  cam.animateTo((tx + 0.5) * TILE, (ty + 0.5) * TILE, Math.max(cam.zoom, 2), performance.now(), 450);
  return true;
}

/** Vai até uma área (`r:<sala>`, `a:core:xxx`, `c`): entra na sala perto da porta, ou o centro dela. */
export function kvGoArea(area: string): boolean {
  if (kvPeople.inside && kvPeople.goArea?.(area)) return true;
  const rect = kvAreaRect(area);
  if (!rect) return false;
  // perto da porta (do lado do corredor), já dentro da sala
  const room = area.startsWith('r:') ? kvPeople.sim?.().rooms.get(area.slice(2)) : undefined;
  const ty = room ? (room.layout.side === 'south' ? rect.y + 2 : rect.y + rect.h - 3) : rect.y + Math.floor(rect.h / 2);
  return kvWalkTile(rect.x + Math.floor(rect.w / 2), ty);
}

/** Retângulo (tiles) de uma área no prédio desta página. */
export function kvAreaRect(area: string): { x: number; y: number; w: number; h: number } | null {
  const sim = kvPeople.sim?.();
  if (!sim) return null;
  if (area.startsWith('r:')) return sim.rooms.get(area.slice(2))?.layout.rect ?? null;
  if (area.startsWith('a:')) return sim.building.core.find((a) => a.id === area.slice(2))?.rect ?? null;
  if (area === 'c') return sim.building.corridor.rect;
  return null;
}

/** O tile livre mais perto (espiral curta). */
function freeNear(tx: number, ty: number): { x: number; y: number } | null {
  const grid = kvPeople.sim?.().building.grid;
  if (!grid) return null;
  for (let r = 0; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (grid.get(tx + dx, ty + dy) === FREE) return { x: tx + dx, y: ty + dy };
      }
    }
  }
  return null;
}
