// Fork Kaviski (KAVISKI-HUMANOS.md → "Reuniões e reservas de sala"): a mobília da sala de reunião (sala própria
// `reuniao`) no prédio original — a casca 16x12 de sempre (rooms-layout.ts) — por layout (`meet.layout`):
//   cabine      = duas cabines de chamada (mesinha com monitor, duas poltronas, painéis acústicos) e a espera;
//   bate-papo   = mesa redonda com quatro cadeiras e o sofá de frente para a TV, aparador com café;
//   reuniao     = mesa grande com banquetas em volta (a de sempre);
//   conselho    = mesa longa de nogueira com cadeiras executivas e poltronas nas pontas, TV, aparador, estante;
//   treinamento = fileiras de mesas de frente para o quadro e a TV, púlpito do instrutor;
//   criativa    = roda de puffs, mesa alta com banquetas, sofá, flip charts, mural de post-its e tapetes coloridos.
// A sala pode estar no norte (porta embaixo, x 7–8) ou no sul (porta em cima): nada entra na passagem da porta
// (colunas 6–9 nas linhas 8–10 ou 2–3), nem na frente do quadro (x 1–4), da placa e do mural (x 9–13) na linha 2.
// Parede: quadro branco (1–4), painel de reservas (5–6, ao lado da porta das salas do sul), placa (9–12), mural (12–13)
// e a TV/painel acústico/mural de post-its em 13–15. Os assentos são só "da sala" (nook, stool, desk). Puro (sem DOM).
import type { Dir, FurnitureKind, RoomTheme } from '../../art/api';
import type { KvMeetLayout } from '../../../../shared/kaviski-meetings';
import { TILE } from '../../world/constants';
import type { AreaBuilder } from '../../world/layout/builder';

/** A ação "ir e fazer" do painel de reservas da sala (a mesma da planta livre: plan/furnish-meet.ts). */
const ACTION = 'reunioes';

export interface KvMeetRoomCtx {
  b: AreaBuilder;
  theme: RoomTheme;
  seed: number;
  north: boolean;
  pick: <T>(arr: readonly T[]) => T;
  /** Recebe o item marcado com a ação `reunioes` (id do item -> ações). */
  tags: Map<string, string[]>;
}

const PLANTS_TALL = ['palm', 'ficus', 'monstera', 'bonsai'] as const;
const PLANTS_SMALL = ['fern', 'succulent', 'flower'] as const;

/** Mobilia a sala de reunião 16x12 no layout pedido. */
export function kvMeetRoom16(c: KvMeetRoomCtx, layout: KvMeetLayout): void {
  const { b, theme, pick } = c;
  const seed = c.seed;
  const seat = (spot: 'nook' | 'stool' | 'desk', fk: FurnitureKind, lx: number, ly: number, dir: Dir, variant?: string, o: { dx?: number; order?: number; deskId?: string } = {}) => b.seat(spot, fk, lx, ly, dir, variant, { order: 0.6, ...o });
  const furn = (fk: FurnitureKind, lx: number, ly: number, variant?: string, order = 0.4) => b.furn(fk, lx, ly, variant, { order });

  // painel de reservas na parede (ao lado da porta nas salas do sul; na parede do fundo nas do norte)
  const panel = b.wall('clock', 5.5, 'kv-room-panel', { order: 0.85 });
  c.tags.set(panel, [ACTION]);

  switch (layout) {
    case 'cabine': {
      b.floor('carpet', 0, 0, 16, 12, seed, '#c3cbdc', '#b7c0d3');
      b.wall('shelf_wall', 14.2, 'kv-acoustic-wall', { order: 0.5 });
      // duas cabines: painéis acústicos dos lados, mesinha com o monitor da chamada e duas poltronas
      for (const x of [1, 10]) {
        b.rug(x + 0.6, 3.6, 2.8, 2.8, '#5b6f99', seed + x);
        furn('coffee_table', x + 1, 4, 'kv-call-desk');
        seat('nook', 'armchair', x + 1, 5, 'up', 'up');
        seat('nook', 'armchair', x + 2, 5, 'up', 'up', { order: 0.61 });
        for (const [px, py] of [[x, 4], [x, 5], [x + 3, 4], [x + 3, 5]] as const) furn('filing_cabinet', px, py, 'kv-acoustic', 0.45);
      }
      // espera: duas poltronas com a mesinha, água, plantas
      b.rug(0.8, 7.6, 4.4, 1.8, theme.carpet2, seed + 3);
      seat('nook', 'armchair', 1, 8, 'right', 'right');
      furn('coffee_table', 2, 8, undefined, 0.45);
      seat('nook', 'armchair', 4, 8, 'left', 'left');
      furn('water_cooler', 14, 8, undefined, 0.3);
      furn('plant_tall', 14, 10, pick(PLANTS_TALL), 0.2);
      furn('plant_small', 1, 10, pick(PLANTS_SMALL), 0.21);
      furn('floor_lamp', 12, 10, undefined, 0.3);
      b.spot('stand', 12, 8, 'left');
      break;
    }
    case 'bate-papo': {
      b.floor('wood', 0, 0, 16, 12, seed);
      b.wall('tv', 14.2, undefined, { order: 0.6 });
      // mesa redonda com quatro cadeiras
      b.rug(1.6, 3.6, 5.8, 4.8, theme.carpet, seed + 2);
      furn('meeting_table', 3, 5, 'kv-round-table');
      seat('stool', 'cafe_chair', 4, 4, 'down', 'down');
      seat('stool', 'cafe_chair', 4, 7, 'up', 'up', { order: 0.62 });
      seat('stool', 'cafe_chair', 2, 5, 'right', 'right');
      seat('stool', 'cafe_chair', 6, 5, 'left', 'left');
      // sofá de frente para a TV, mesinha e poltrona
      b.rug(10.6, 3.2, 5, 4.2, theme.carpet2, seed + 3);
      const sofa = furn('sofa', 12, 6, 'up', 0.5);
      for (let i = 0; i < 3; i++) b.seat('nook', 'sofa', 12 + i, 6, 'up', 'up', { noFurniture: true, furnitureId: sofa });
      b.furn('coffee_table', 12, 4, undefined, { dx: TILE / 2, order: 0.45 });
      b.block(14, 4, 1, 1);
      seat('nook', 'armchair', 11, 4, 'right', 'right');
      furn('bookshelf', 12, 10, 'kv-coffee-bar', 0.3);
      furn('plant_tall', 1, 10, pick(PLANTS_TALL), 0.2);
      furn('plant_small', 14, 10, pick(PLANTS_SMALL), 0.21);
      furn('floor_lamp', 1, 8, undefined, 0.3);
      b.spot('stand', 10, 8, 'down');
      break;
    }
    case 'conselho': {
      b.floor('wood', 0, 0, 16, 12, seed, '#a98466', '#9c7a5e');
      b.wall('tv', 14.2, undefined, { order: 0.6 });
      // mesa longa (três peças) com cadeiras executivas uma sim, uma não, e poltronas nas pontas
      b.rug(1.6, 3.4, 11.8, 5.2, '#5e3b3b', seed + 2);
      for (let i = 0; i < 3; i++) furn('meeting_table', 3 + i * 3, 5, 'kv-board-table', 0.4 + i * 0.01);
      for (let x = 3; x <= 11; x += 2) {
        seat('stool', 'office_chair_front', x, 4, 'down', 'black');
        seat('stool', 'office_chair', x, 7, 'up', 'black', { order: 0.62 });
      }
      for (const y of [5, 6]) {
        seat('nook', 'armchair', 2, y, 'right', 'right');
        seat('nook', 'armchair', 12, y, 'left', 'left');
      }
      furn('bookshelf', 12, 10, 'kv-coffee-bar', 0.3);
      furn('bookshelf', 1, 10, undefined, 0.3);
      furn('plant_tall', 14, 4, pick(PLANTS_TALL), 0.2);
      furn('plant_tall', 14, 10, pick(PLANTS_TALL), 0.21);
      furn('plant_small', 1, 3, pick(PLANTS_SMALL), 0.22);
      furn('floor_lamp', 14, 7, undefined, 0.3);
      b.spot('stand', 13, 8, 'left');
      break;
    }
    case 'treinamento': {
      b.floor('carpet', 0, 0, 16, 12, seed, theme.carpet, theme.carpet2);
      b.wall('tv', 14.2, undefined, { order: 0.6 });
      furn('filing_cabinet', 14, 3, 'kv-podium', 0.4);
      // fileiras de mesas (dois lugares cada) de frente para o quadro e a TV, com corredores
      const row = (y: number, xs: readonly number[]) => {
        b.rug(0.7, y - 0.3, 14.6, 2.6, theme.carpet2, seed + y);
        for (const x of xs) {
          furn('coffee_table', x, y, 'kv-train-desk');
          seat('stool', 'stool', x, y + 1, 'up');
          seat('stool', 'stool', x + 1, y + 1, 'up', undefined, { order: 0.61 });
        }
      };
      row(4, [1, 3, 6, 8, 10, 12]);
      row(7, [1, 3, 10, 12]);
      furn('water_cooler', 13, 10, undefined, 0.3);
      furn('plant_tall', 14, 10, pick(PLANTS_TALL), 0.2);
      furn('plant_small', 1, 10, pick(PLANTS_SMALL), 0.21);
      b.spot('stand', 13, 3, 'down');
      break;
    }
    case 'criativa': {
      b.floor('wood', 0, 0, 16, 12, seed, '#e6cfa8', '#dcc39a');
      b.wall('shelf_wall', 14.2, 'kv-postit-small', { order: 0.55 });
      // roda de puffs num tapete colorido
      b.rug(1.2, 3.7, 4.6, 3.6, '#f2c14e', seed + 2);
      furn('coffee_table', 2, 5, undefined, 0.45);
      (['red', 'blue', 'yellow', 'green'] as const).forEach((v, i) => seat('nook', 'beanbag', 2 + (i % 2), i < 2 ? 4 : 6, i < 2 ? 'down' : 'up', v, { order: 0.6 + i * 0.01 }));
      // mesa alta com banquetas
      b.rug(10.2, 3.7, 3.6, 3.6, '#e47aa8', seed + 3);
      furn('coffee_table', 11, 5, 'kv-high-table', 0.45);
      for (const [x, y, d] of [[11, 4, 'down'], [12, 4, 'down'], [11, 6, 'up'], [12, 6, 'up']] as const) seat('stool', 'stool', x, y, d);
      // flip charts, sofá olhando para a sala, puff, plantas
      furn('filing_cabinet', 6, 4, 'kv-flipchart', 0.4);
      furn('filing_cabinet', 14, 5, 'kv-flipchart', 0.41);
      b.rug(1.4, 8.6, 4.2, 2.2, '#36b0b0', seed + 4);
      const sofa = furn('sofa', 2, 9, 'up', 0.5);
      for (let i = 0; i < 3; i++) b.seat('nook', 'sofa', 2 + i, 9, 'up', 'up', { noFurniture: true, furnitureId: sofa });
      seat('nook', 'beanbag', 12, 9, 'up', pick(['red', 'blue', 'yellow', 'green'] as const));
      furn('plant_tall', 14, 10, pick(PLANTS_TALL), 0.2);
      furn('plant_small', 1, 3, pick(PLANTS_SMALL), 0.21);
      furn('floor_lamp', 13, 10, undefined, 0.3);
      b.spot('stand', 10, 8, 'up');
      break;
    }
    default: {
      // reunião: mesa grande (duas mesas de reunião lado a lado) com banquetas em volta
      b.rug(2.6, 3.6, 8.8, 4.8, theme.carpet, seed + 2);
      furn('meeting_table', 4, 5);
      furn('meeting_table', 7, 5, undefined, 0.41);
      for (let i = 0; i < 6; i++) {
        seat('stool', 'stool', 4 + i, 4, 'down', undefined, { order: 0.6 + i * 0.01 });
        seat('stool', 'stool', 4 + i, 7, 'up', undefined, { order: 0.66 + i * 0.01 });
      }
      seat('stool', 'stool', 3, 5, 'right');
      seat('stool', 'stool', 3, 6, 'right');
      seat('stool', 'stool', 10, 5, 'left');
      seat('stool', 'stool', 10, 6, 'left');
      furn('water_cooler', 14, 4, undefined, 0.3);
      furn('plant_tall', 14, 9, pick(PLANTS_TALL), 0.2);
      furn('plant_tall', 1, 10, pick(PLANTS_TALL), 0.21);
      furn('plant_small', 13, 10, pick(PLANTS_SMALL), 0.22);
      furn('floor_lamp', 14, 6, undefined, 0.3);
      b.spot('stand', 12, 5, 'left');
      b.spot('stand', 12, 7, 'left');
    }
  }
}
