// Fork Kaviski (KAVISKI-HUMANOS.md → "Reuniões e reservas de sala"): os itens em pixel art das salas de reunião que a
// arte original não tem — mesa redonda, mesa longa do conselho, mesinha de chamada, painel acústico, mesa de
// treinamento, mesa alta, flip chart, aparador com café, totem e painel de reserva da porta (estilo Teams Rooms, LED
// verde = livre, vermelho = ocupada), tela de projeção, mural de post-its e painéis acústicos de parede. Puro (sem DOM),
// no mesmo kit dos itens `kv-*` das salas temáticas (themes-sprites.ts): topo claro com aresta brilhante, frente na cor,
// lado direito mais escuro, contorno e sombra de contato. Medidas em themes-dims.ts; entram no despacho do
// themes-sprites.ts (`...KV_MEET_BUILD`).
import { ramp, shade, type Ramp } from '../../art/core/color';
import type { PixelBuf } from '../../art/core/pixbuf';
import { floorSheet, trim, wallSheet, type BufFurniture, type BufSprite } from '../../art/core/sprite';
import { ACCENTS, contact, frontFace, M, monitorFront, mug, papers, rngOf, staticScreen, topFace, woodGrain } from '../../art/furniture/kit';

const SHADOW = 'rgba(30,34,52,0.16)';
const LED_FREE = '#5ce08a';
const LED_BUSY = '#ff5a5a';

function wallShadow(b: PixelBuf, x: number, y: number, w: number, h: number): void {
  for (let yy = y + 1; yy <= y + h; yy++) b.under(x + w, yy, SHADOW);
  for (let xx = x + 1; xx <= x + w; xx++) b.under(xx, y + h, SHADOW);
}

/** Moldura em 3D (luz em cima/esquerda, sombra embaixo/direita) com miolo `inner`. */
function frame(b: PixelBuf, x: number, y: number, w: number, h: number, m: Ramp, inner: string): void {
  b.rect(x, y, w, h, m.base);
  b.hline(x, x + w - 1, y, m.hi);
  b.vline(x, y, y + h - 1, m.lt);
  b.hline(x, x + w - 1, y + h - 1, m.dd);
  b.vline(x + w - 1, y, y + h - 1, m.dk);
  b.rect(x + 1, y + 1, w - 2, h - 2, inner);
}

function finish(s: BufSprite, shadow?: [number, number, number, number]): BufFurniture {
  s.buf.outline();
  if (shadow) contact(s.buf, ...shadow, 0.22);
  return { base: trim(s) };
}

/** Copo d'água (2x3). */
function water(b: PixelBuf, x: number, y: number): void {
  b.rect(x, y, 2, 3, 'rgba(190,225,245,0.9)');
  b.set(x, y, '#ffffff');
}

/** Notebook aberto, de frente (tela para a câmera) ou de costas. */
function laptop(b: PixelBuf, x: number, y: number, facing: 'up' | 'down', seed: number): void {
  if (facing === 'down') {
    b.rect(x, y, 9, 5, '#3a404d');
    b.hline(x, x + 8, y, '#4d5464');
    staticScreen(b, { x: x + 1, y: y + 1, w: 7, h: 3 }, seed % 2 ? 'ide' : 'sheet', seed + x);
    b.rect(x - 1, y + 5, 11, 2, '#c9ced6');
    b.hline(x - 1, x + 9, y + 6, '#9aa1ad');
  } else {
    b.rect(x - 1, y, 11, 2, '#c9ced6');
    b.rect(x, y + 2, 9, 4, '#aeb5c0');
    b.hline(x, x + 8, y + 2, '#d6dbe2');
    b.set(x + 4, y + 4, '#eef1f5');
  }
}

/** Post-it (3x3) com a dobrinha. */
function postit(b: PixelBuf, x: number, y: number, c: string): void {
  b.rect(x, y, 3, 3, c);
  b.set(x + 2, y + 2, shade(c, -0.2));
  b.hline(x, x + 1, y + 1, shade(c, -0.12));
}

const POSTIT = ['#fff07a', '#ffb3d1', '#9be7ff', '#b8f28c', '#ffcf80'] as const;

// =================================================================== chão

/** Mesa redonda (3x2): tampo oval de madeira com a coluna central, canecas, notebook e papéis. */
function roundTable(seed: number): BufFurniture {
  const s = floorSheet(3, 2, 8);
  const b = s.buf;
  const m = M.oak;
  const r = rngOf(seed, 41);
  // coluna e base em cruz
  b.rect(21, 18, 6, 10, M.steelDark.base);
  b.vline(21, 18, 27, M.steelDark.lt);
  b.vline(26, 18, 27, M.steelDark.dk);
  b.ellipse(24, 29, 12, 2.5, M.steelDark.dk);
  // espessura do tampo (frente) e tampo
  b.ellipse(24, 10, 23.5, 11, m.dk);
  b.ellipse(24, 8, 23.5, 11, m.lt);
  b.ellipse(24, 8, 21, 9, shade(m.lt, 0.04));
  for (let x = 6; x < 44; x += 7) b.hline(x, x + 3, 6 + ((x * 3) % 5), m.base);
  b.ellipse(24, 8, 6, 3, m.base);
  // objetos
  laptop(b, 9, -1, 'down', seed);
  mug(b, 33, 1, ACCENTS[Math.floor(r() * ACCENTS.length)]!);
  mug(b, 16, 12, ACCENTS[Math.floor(r() * ACCENTS.length)]!);
  papers(b, 28, 10, 6, 4);
  water(b, 38, 6);
  return finish(s, [2, 26, 44, 5]);
}

/**
 * Mesa do conselho (3x2): tampo de nogueira com o filete de couro, as pontas cortadas reto (vários lado a lado viram
 * uma mesa longa), microfones de mesa, copos d'água e pastas.
 */
function boardTable(seed: number): BufFurniture {
  const s = floorSheet(3, 2, 10);
  const b = s.buf;
  const m = M.walnut;
  const r = rngOf(seed, 43);
  // pés em painel escuro
  for (const x of [6, 39]) {
    b.rect(x, 21, 3, 10, '#3a2d26');
    b.vline(x, 21, 30, '#5a4638');
  }
  topFace(b, 0, -4, 48, 24, m);
  b.rect(0, 20, 48, 3, m.base);
  b.hline(0, 47, 22, m.dd);
  woodGrain(b, 1, -3, 46, 22, m, seed);
  // filete de couro no meio, com costura
  b.rect(0, 4, 48, 6, '#2f3a4a');
  b.hline(0, 47, 4, '#435167');
  for (let x = 1; x < 48; x += 3) b.set(x, 7, '#5d6c82');
  // microfones de mesa e copos
  for (const x of [10, 34]) {
    b.rect(x, 1, 3, 2, '#23262f');
    b.line(x + 1, 0, x + 2, -4, '#5a6070');
    b.set(x + 2, -5, r() < 0.5 ? LED_FREE : '#e05a5a');
  }
  water(b, 20, -2);
  water(b, 28, 13);
  papers(b, 4, 12, 7, 5, 'light');
  b.rect(38, 12, 7, 5, '#3f2f28');
  b.hline(38, 44, 12, '#6b4f40');
  b.set(41, 14, '#e0b030');
  return finish(s, [-1, 28, 50, 4]);
}

/** Mesinha da cabine de chamada (2x1): monitor com a câmera em cima, anel de luz, fone e caneca. */
function callDesk(seed: number): BufFurniture {
  const s = floorSheet(2, 1, 22);
  const b = s.buf;
  for (const x of [2, 29]) b.vline(x, 4, 15, '#5a6070');
  b.hline(2, 29, 12, '#5a6070');
  topFace(b, 0, -2, 32, 6, M.white);
  frontFace(b, 0, 4, 32, 3, ramp('#3f4b63', 0.07));
  // monitor de frente com a chamada (duas carinhas)
  const scr = monitorFront(b, 8, -16, 16, 11);
  b.rect(scr.x, scr.y, scr.w, scr.h, '#1d2a44');
  b.rect(scr.x + 1, scr.y + 1, 6, scr.h - 2, '#3b5c8f');
  b.rect(scr.x + 8, scr.y + 1, scr.w - 9, scr.h - 2, '#4c7a5f');
  b.rect(scr.x + 3, scr.y + 2, 2, 2, '#f1c9a5');
  b.rect(scr.x + 10, scr.y + 2, 2, 2, '#c99a72');
  // câmera em cima do monitor
  b.rect(14, -18, 4, 2, '#23262f');
  b.set(15, -17, LED_FREE);
  // anel de luz no braço
  b.vline(28, -12, -2, '#5a6070');
  b.ellipse(28, -15, 3.5, 3.5, '#fff3a3');
  b.ellipse(28, -15, 1.6, 1.6, '#c9ced6');
  // fone e caneca
  b.rect(2, -3, 4, 2, '#23262f');
  b.set(3, -4, '#23262f');
  b.set(5, -4, '#23262f');
  mug(b, 25, -3, ACCENTS[seed % ACCENTS.length]!);
  return finish(s, [0, 13, 32, 4]);
}

/** Painel acústico de pé (1x1): feltro alto com gomos, numa base de metal (divisória das cabines). */
function acoustic(seed: number): BufFurniture {
  const s = floorSheet(1, 1, 26);
  const b = s.buf;
  const felt = ramp(['#5b6f99', '#4c8a7a', '#8a5b7a', '#6b6f78'][seed % 4]!, 0.06);
  b.rect(2, -24, 12, 37, felt.base);
  b.hline(2, 13, -24, felt.hi);
  b.vline(2, -23, 12, felt.lt);
  b.vline(13, -23, 12, felt.dk);
  // gomos verticais do feltro
  for (const x of [5, 8, 11]) b.vline(x, -22, 11, felt.dk);
  for (const x of [4, 7, 10]) b.vline(x, -22, 11, felt.lt);
  b.hline(2, 13, 12, felt.dd);
  // base
  b.rect(1, 13, 14, 2, M.steelDark.base);
  b.hline(1, 14, 13, M.steelDark.lt);
  return finish(s, [0, 13, 16, 4]);
}

/** Mesa de treinamento (2x1): tampo branco com dois cadernos, canetas e o cabo da tomada. */
function trainDesk(seed: number): BufFurniture {
  const s = floorSheet(2, 1, 8);
  const b = s.buf;
  const r = rngOf(seed, 47);
  for (const x of [1, 30]) b.vline(x, 4, 15, M.steelDark.base);
  b.hline(1, 30, 11, M.steelDark.base);
  topFace(b, 0, -2, 32, 6, M.white);
  frontFace(b, 0, 4, 32, 3, ramp('#c9ced6', 0.06));
  for (const x of [3, 19]) {
    const c = ACCENTS[Math.floor(r() * ACCENTS.length)]!;
    b.rect(x, -2, 8, 4, c);
    b.vline(x, -2, 1, shade(c, -0.2));
    b.rect(x + 1, -2, 6, 3, '#fbfaf6');
    b.hline(x + 2, x + 5, -1, '#b9c2d0');
    b.line(x + 9, 0, x + 10, -2, '#2b2540');
  }
  b.rect(15, 1, 2, 1, '#3a3f4b');
  return finish(s, [0, 13, 32, 4]);
}

/** Mesa alta (2x1): tampo de madeira em pés altos de metal, com a garrafa e canecas (para as banquetas). */
function highTable(seed: number): BufFurniture {
  const s = floorSheet(2, 1, 16);
  const b = s.buf;
  const m = M.oakDark;
  for (const x of [4, 27]) {
    b.vline(x, -4, 15, M.graphite.base);
    b.vline(x + 1, -4, 15, M.graphite.dk);
  }
  b.hline(4, 28, 9, M.graphite.base);
  topFace(b, 0, -10, 32, 6, m);
  frontFace(b, 0, -4, 32, 3, m);
  woodGrain(b, 1, -9, 30, 4, m, seed);
  mug(b, 6, -12, ACCENTS[(seed + 1) % ACCENTS.length]!);
  mug(b, 22, -11, ACCENTS[(seed + 4) % ACCENTS.length]!);
  b.rect(14, -15, 3, 6, '#4cae6a');
  b.rect(15, -17, 1, 2, '#2f7044');
  b.set(14, -15, '#7bd394');
  return finish(s, [2, 13, 28, 4]);
}

/** Flip chart (1x1): cavalete com o bloco de folhas, ideias rabiscadas e post-its. */
function flipchart(seed: number): BufFurniture {
  const s = floorSheet(1, 1, 28);
  const b = s.buf;
  const leg = M.steelDark;
  b.line(4, -6, 1, 15, leg.base);
  b.line(11, -6, 14, 15, leg.base);
  b.line(8, -4, 9, 14, leg.dk);
  b.rect(1, -25, 14, 3, '#3a3f4b');
  b.rect(1, -22, 14, 17, '#fbfaf6');
  b.hline(1, 14, -6, '#d6d2c8');
  b.vline(14, -22, -6, '#d6d2c8');
  const c = ACCENTS[seed % ACCENTS.length]!;
  b.line(3, -19, 7, -17, c);
  b.line(7, -17, 11, -20, c);
  b.hline(3, 9, -14, '#93a0b4');
  b.hline(3, 7, -12, '#93a0b4');
  b.line(9, -13, 13, -10, '#e05a5a');
  postit(b, 10, -9, POSTIT[seed % POSTIT.length]!);
  return finish(s, [1, 13, 14, 4]);
}

/** Aparador com café (2x1): móvel baixo de madeira, garrafa térmica, xícaras e a bandeja de biscoitos. */
function coffeeBar(seed: number): BufFurniture {
  const s = floorSheet(2, 1, 18);
  const b = s.buf;
  const m = M.walnut;
  topFace(b, 0, -4, 32, 5, M.stone);
  frontFace(b, 0, 1, 32, 14, m);
  woodGrain(b, 1, 2, 30, 11, m, seed, true);
  b.vline(16, 2, 13, m.dd);
  for (const x of [7, 24]) b.rect(x, 7, 2, 1, '#c9a24a');
  // garrafa térmica
  b.rect(4, -14, 5, 11, '#3a3f4b');
  b.hline(4, 8, -14, '#5a6070');
  b.rect(5, -16, 3, 2, '#23262f');
  b.vline(9, -11, -8, '#3a3f4b');
  // xícaras
  for (let i = 0; i < 3; i++) mug(b, 11 + i * 4, -7, ['#fbfaf6', '#e9e8e4', '#fbfaf6'][i]!);
  // bandeja com biscoitos
  b.rect(23, -6, 7, 3, '#c3c9d2');
  for (const x of [24, 26, 28]) b.set(x, -6, '#c99a5e');
  b.set(25, -7, '#c99a5e');
  return finish(s, [-1, 13, 34, 4]);
}

/** Totem de reserva (1x1): o painel da sala num pé, para quando não há parede livre perto da porta. */
function roomTotem(): BufFurniture {
  const s = floorSheet(1, 1, 26);
  const b = s.buf;
  b.rect(6, -4, 4, 17, M.steelDark.base);
  b.vline(6, -4, 12, M.steelDark.lt);
  b.rect(3, 12, 10, 3, M.steelDark.dk);
  b.hline(3, 12, 12, M.steelDark.base);
  panelFace(b, 1, -24, 14, 20, LED_FREE);
  return finish(s, [2, 13, 12, 4]);
}

/** A tela do painel de reserva: LED dos lados, nome, hora e a agenda do dia. */
function panelFace(b: PixelBuf, x: number, y: number, w: number, h: number, led: string): void {
  b.rect(x, y, w, h, '#23262f');
  b.hline(x, x + w - 1, y, '#3a3f4b');
  b.vline(x, y, y + h - 1, led);
  b.vline(x + w - 1, y, y + h - 1, led);
  b.rect(x + 2, y + 2, w - 4, h - 4, '#141a26');
  b.hline(x + 3, x + w - 5, y + 3, '#c9d6ee');
  b.rect(x + 3, y + 5, 4, 2, led);
  b.hline(x + 8, x + w - 4, y + 6, '#7d8696');
  for (let i = 0; i < 3 && y + 9 + i * 3 < y + h - 3; i++) {
    b.rect(x + 3, y + 9 + i * 3, 2, 2, i === 0 ? led : '#4aa3f0');
    b.hline(x + 6, x + w - 4 - (i % 2) * 2, y + 10 + i * 3, '#5a6378');
  }
}

// =================================================================== parede

/** Painel de reserva da porta (1), estilo Teams Rooms: LED verde (livre) ou vermelho (ocupada). */
function roomPanel(busy: boolean): BufFurniture {
  const s = wallSheet(1);
  const b = s.buf;
  panelFace(b, 1, -26, 14, 18, busy ? LED_BUSY : LED_FREE);
  b.outline();
  wallShadow(b, 0, -27, 16, 20);
  // brilho do LED na parede
  for (let yy = -25; yy <= -10; yy += 2) {
    b.under(0, yy, busy ? 'rgba(255,90,90,0.35)' : 'rgba(92,224,138,0.35)');
    b.under(15, yy, busy ? 'rgba(255,90,90,0.35)' : 'rgba(92,224,138,0.35)');
  }
  return { base: trim(s) };
}

/** Tela de projeção (4): tela branca enrolada no tubo, com o slide projetado (título e gráfico). */
function screen(seed: number): BufFurniture {
  const s = wallSheet(4);
  const b = s.buf;
  const x = 2;
  const w = 60;
  // tubo
  b.rect(x - 1, -31, w + 2, 3, '#d9dce2');
  b.hline(x - 1, x + w, -31, '#f4f5f7');
  b.hline(x - 1, x + w, -29, '#9aa1ad');
  // tela
  b.rect(x, -28, w, 22, '#fbfaf6');
  b.vline(x + w - 1, -28, -7, '#e2dfd6');
  b.hline(x, x + w - 1, -7, '#d6d2c8');
  b.rect(x + 3, -6, w - 6, 1, '#3a3f4b');
  b.rect(x + w / 2 - 1, -5, 2, 2, '#3a3f4b');
  // slide
  b.rect(x + 4, -26, w - 8, 3, '#3f7fd8');
  b.hline(x + 6, x + 22, -25, '#ffffff');
  const hs = [5, 8, 6, 11, 9];
  hs.forEach((h, i) => {
    const c = ACCENTS[(i + seed) % ACCENTS.length]!;
    b.rect(x + 6 + i * 5, -10 - h, 3, h, c);
    b.set(x + 6 + i * 5, -10 - h, shade(c, 0.2));
  });
  b.hline(x + 5, x + 31, -10, '#93a0b4');
  for (let i = 0; i < 4; i++) {
    b.rect(x + 36, -21 + i * 3, 2, 2, ACCENTS[(i + 2) % ACCENTS.length]!);
    b.hline(x + 40, x + 52 - (i % 2) * 4, -20 + i * 3, '#b9c2d0');
  }
  b.outline();
  wallShadow(b, x - 2, -32, w + 4, 28);
  return { base: trim(s) };
}

/** Mural de post-its (2 ou 3): quadro de cortiça com colunas de notas coloridas e os fios ligando as ideias. */
function postitWall(seed: number, tiles: 2 | 3): BufFurniture {
  const s = wallSheet(tiles);
  const b = s.buf;
  const W = tiles * 16 - 2;
  frame(b, 1, -30, W, 22, M.oakDark, '#c9a06a');
  const r = rngOf(seed, 53);
  for (let y = -28; y < -10; y += 3) for (let x = 3; x < W - 1; x += 4) if (r() < 0.25) b.set(x + (y % 2), y, '#b88c5e');
  const cols = Math.floor((W - 4) / 11);
  for (let c = 0; c < cols; c++) {
    b.hline(4 + c * 11, 11 + c * 11, -27, '#fbfaf6');
    for (let i = 0; i < 3; i++) if (r() < 0.85) postit(b, 4 + c * 11 + (i % 2) * 4, -24 + i * 5, POSTIT[(c + i + seed) % POSTIT.length]!);
  }
  b.line(9, -19, 20, -14, '#e05a5a');
  if (tiles === 3) b.line(31, -20, 39, -13, '#e05a5a');
  b.outline();
  wallShadow(b, 0, -31, W + 2, 24);
  return { base: trim(s) };
}

/** Painéis acústicos de parede (2): hexágonos de feltro em três tons. */
function acousticWall(seed: number): BufFurniture {
  const s = wallSheet(2);
  const b = s.buf;
  const tones = [['#5b6f99', '#7d90b8', '#3f4f75'], ['#4c8a7a', '#6fb0a0', '#2f6a5a'], ['#8a5b7a', '#b07fa0', '#6a3f5a']][seed % 3]!;
  const hex = ['.####.', '######', '######', '######', '.####.'];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      const x = 1 + col * 6 + (row % 2) * 3;
      if (x + 6 > 31) continue;
      const c = tones[(row * 2 + col + seed) % 3]!;
      b.stamp(hex, x, -27 + row * 6, { '#': c });
      b.hline(x + 1, x + 4, -27 + row * 6, shade(c, 0.15));
    }
  }
  b.outline();
  wallShadow(b, 0, -28, 32, 20);
  return { base: trim(s) };
}

// =================================================================== despacho

export const KV_MEET_BUILD = {
  'kv-round-table': roundTable,
  'kv-board-table': boardTable,
  'kv-call-desk': callDesk,
  'kv-acoustic': acoustic,
  'kv-train-desk': trainDesk,
  'kv-high-table': highTable,
  'kv-flipchart': flipchart,
  'kv-coffee-bar': coffeeBar,
  'kv-room-totem': () => roomTotem(),
  'kv-room-panel': () => roomPanel(false),
  'kv-room-panel-busy': () => roomPanel(true),
  'kv-screen': screen,
  'kv-postit-wall': (seed: number) => postitWall(seed, 3),
  'kv-postit-small': (seed: number) => postitWall(seed, 2),
  'kv-acoustic-wall': acousticWall,
} as const satisfies Record<string, (seed: number) => BufFurniture>;
