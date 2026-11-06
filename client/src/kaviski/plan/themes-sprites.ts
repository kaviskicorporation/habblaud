// Fork Kaviski (KAVISKI-HUMANOS.md → "Planta livre", frente C): os itens em pixel art das salas temáticas que a arte
// original não tem (balcão do RH, caixa de correio, púlpito, maquete, quadro de presença, organograma...). Puro (sem
// DOM): desenha em PixelBuf com o mesmo kit dos móveis do Habblaud (topo claro com aresta brilhante, frente na cor
// base, lado direito mais escuro, contorno e sombra de contato), então dá para testar em Node. Medidas em
// themes-dims.ts; o gancho que entrega estes sprites ao mundo fica em themes-art.ts.
import { TILE } from '../../art/api';
import { ramp, shade, type Ramp } from '../../art/core/color';
import type { PixelBuf } from '../../art/core/pixbuf';
import { floorSheet, rectAt, trim, wallSheet, type BufFurniture, type BufSprite } from '../../art/core/sprite';
import { ACCENTS, contact, frontFace, glass, M, monitorBack, papers, rngOf, topFace, woodGrain } from '../../art/furniture/kit';
import { KV_MEET_BUILD } from './meet-sprites';
import type { KvSpriteKey } from './themes-dims';

const INK = '#2b2540';
const SHADOW = 'rgba(30,34,52,0.16)';
const stone = ramp('#efede8', 0.04);

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

/** Caixinha 3/4 (tampa clara, frente na cor, direita escura). */
function box3(b: PixelBuf, x: number, y: number, w: number, h: number, c: string, top = 2): void {
  const m = ramp(c, 0.08);
  b.rect(x, y, w, top, m.lt);
  b.hline(x, x + w - 1, y + top - 1, m.hi);
  b.rect(x, y + top, w, h - top, m.base);
  b.vline(x + w - 1, y + top, y + h - 1, m.dk);
  b.hline(x, x + w - 1, y + h - 1, m.dd);
}

/** Bonequinho de organograma: cabeça + ombros. */
function bust(b: PixelBuf, x: number, y: number, c: string): void {
  b.rect(x + 1, y, 2, 2, '#f1c9a5');
  b.rect(x, y + 2, 4, 2, c);
}

/** Envelope fechado (6x4) com o selo. */
function envelope(b: PixelBuf, x: number, y: number, c: string, seal = '#e05a5a'): void {
  b.rect(x, y, 6, 4, c);
  b.hline(x, x + 5, y + 3, shade(c, -0.18));
  b.set(x + 1, y + 1, shade(c, -0.12));
  b.set(x + 4, y + 1, shade(c, -0.12));
  b.set(x + 2, y + 2, shade(c, -0.15));
  b.set(x + 3, y + 2, seal);
}

function finish(s: BufSprite, shadow?: [number, number, number, number]): BufFurniture {
  s.buf.outline();
  if (shadow) contact(s.buf, ...shadow, 0.22);
  return { base: trim(s) };
}

// =================================================================== chão

/** Balcão do RH (3x1): madeira com faixa laranja, a ficha na prancheta, carimbo, crachás e o monitor de costas. */
function hrDesk(seed: number): BufFurniture {
  const s = floorSheet(3, 1, 18);
  const b = s.buf;
  topFace(b, 1, -10, 46, 6, M.white);
  monitorBack(b, 30, -15, 13, 7);
  frontFace(b, 0, -2, 48, 18, M.oak);
  woodGrain(b, 1, -1, 46, 14, M.oak, seed, true);
  b.rect(0, 5, 48, 3, '#f08a3c');
  b.hline(0, 47, 5, '#f7ad6b');
  b.hline(0, 47, 7, '#c96a24');
  b.rect(0, 14, 48, 2, M.oak.dd);
  // coração com gente (o símbolo do RH) na frente
  b.stamp(['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'], 20, 0, { '#': '#fff3e8' });
  topFace(b, -1, -6, 50, 5, stone);
  b.hline(-1, 48, -2, stone.dk);
  // a ficha: prancheta com foto e linhas
  b.rect(6, -11, 9, 8, '#9a6b3f');
  b.rect(7, -10, 7, 6, '#fbfaf6');
  b.rect(9, -12, 3, 2, '#c3c9d2');
  b.rect(8, -9, 2, 2, '#f08a3c');
  b.hline(11, 13, -9, '#93a0b4');
  b.hline(11, 12, -7, '#93a0b4');
  b.hline(8, 13, -5, '#b9c2d0');
  // carimbo e almofada
  b.rect(19, -5, 5, 2, '#3f7fd8');
  b.rect(20, -8, 3, 3, M.walnut.base);
  b.set(21, -9, M.walnut.lt);
  // crachás coloridos
  for (let i = 0; i < 3; i++) {
    b.rect(25 + i * 3, -5, 2, 3, ACCENTS[(i + 2) % ACCENTS.length]);
    b.set(25 + i * 3, -5, '#ffffff');
  }
  papers(b, 37, -5, 6, 3);
  return finish(s, [-1, 13, 50, 4]);
}

/** Mesa dos convites (2x1): pilhas de envelopes com selo, um presente com laço e a caneta. */
function inviteDesk(): BufFurniture {
  const s = floorSheet(2, 1, 10);
  const b = s.buf;
  const leg = '#5a6070';
  for (const x of [2, 29]) b.vline(x, 4, 15, leg);
  b.hline(2, 29, 12, leg);
  topFace(b, 0, -2, 32, 6, M.white);
  frontFace(b, 0, 4, 32, 3, ramp('#e05aa0', 0.07));
  for (let i = 0; i < 3; i++) envelope(b, 3 + i, -3 - i * 2, i % 2 ? '#fff3a3' : '#f2c14e');
  envelope(b, 12, -1, '#ffc9de', '#8d66cf');
  envelope(b, 13, -3, '#bfe3ff', '#e05a5a');
  // presente
  box3(b, 21, -6, 7, 7, '#4cae6a');
  b.vline(24, -6, 0, '#f2c14e');
  b.hline(21, 27, -3, '#f2c14e');
  b.stamp(['#.#', '.#.'], 23, -8, { '#': '#f2c14e' });
  b.line(16, -1, 19, -2, INK);
  return finish(s, [0, 13, 32, 4]);
}

/** Caixa de correio (1x1) num poste, com a bandeirinha levantada e uma carta saindo. */
function mailbox(): BufFurniture {
  const s = floorSheet(1, 1, 14);
  const b = s.buf;
  b.rect(7, 1, 2, 14, '#5a6070');
  b.set(7, 1, '#7d8696');
  const m = ramp('#d9583b', 0.08);
  b.rect(2, -9, 12, 11, m.base);
  b.hline(3, 12, -10, m.lt);
  b.rect(2, -9, 12, 3, m.lt);
  b.hline(3, 12, -10, m.hi);
  b.vline(13, -8, 1, m.dk);
  b.hline(2, 13, 1, m.dd);
  b.rect(4, -5, 8, 5, m.dk);
  b.rect(5, -4, 6, 3, m.base);
  b.hline(5, 10, -6, '#2b2540');
  // carta saindo da boca
  b.rect(6, -9, 5, 3, '#fbfaf6');
  b.set(8, -8, '#e05a5a');
  // bandeirinha
  b.vline(14, -11, -3, '#c3c9d2');
  b.rect(14, -12, 3, 3, '#f2c14e');
  return finish(s, [2, 13, 12, 4]);
}

/** Púlpito (1x1): madeira escura, painel vermelho com estrela dourada e o microfone. */
function podium(): BufFurniture {
  const s = floorSheet(1, 1, 22);
  const b = s.buf;
  const w = M.walnut;
  for (let y = -6; y <= 15; y++) {
    const inset = y < 0 ? 1 : 0;
    b.hline(1 + inset, 14 - inset, y, w.base);
    b.set(14 - inset, y, w.dk);
  }
  b.hline(1, 14, 15, w.dd);
  b.rect(3, -2, 10, 10, '#d94a4a');
  b.hline(3, 12, -2, '#ef7a6e');
  b.hline(3, 12, 7, '#a83434');
  b.stamp(['..#..', '.###.', '#####', '.###.', '.#.#.'], 6, 0, { '#': '#f2c14e' });
  // tampo inclinado
  b.rect(0, -9, 16, 3, w.lt);
  b.hline(0, 15, -9, w.hi);
  b.hline(0, 15, -7, w.dk);
  papers(b, 3, -11, 5, 2);
  // microfone no pescoço de ganso
  b.line(10, -9, 11, -13, '#5a6070');
  b.line(11, -13, 10, -16, '#5a6070');
  b.rect(9, -19, 3, 3, '#3a3f4b');
  b.set(9, -19, '#7d8696');
  return finish(s, [0, 13, 16, 4]);
}

/** Maquete da empresa (3x2): mesa branca com o prédio em miniatura, ruas, árvores e um guindaste. */
function model(seed: number): BufFurniture {
  const s = floorSheet(3, 2, 14);
  const b = s.buf;
  const leg = '#6d7583';
  for (const x of [2, 45]) b.vline(x, 20, 31, leg);
  topFace(b, 0, -2, 48, 24, M.white);
  frontFace(b, 0, 22, 48, 4, ramp('#5aa9e6', 0.07));
  // base verde com ruas
  b.rect(3, 0, 42, 19, '#8fd18a');
  b.hline(3, 44, 9, '#b9c0ca');
  b.hline(3, 44, 10, '#9aa2ae');
  b.vline(24, 0, 18, '#b9c0ca');
  const r = rngOf(seed, 9);
  const blocks: [number, number, number, number][] = [
    [5, 1, 7, 6],
    [14, 2, 8, 5],
    [27, 0, 6, 7],
    [35, 2, 8, 5],
    [6, 12, 9, 5],
    [27, 12, 7, 6],
    [36, 12, 7, 5],
  ];
  blocks.forEach(([x, y, w, h], i) => {
    const hgt = 3 + Math.floor(r() * 6);
    box3(b, x, y - hgt + h - 2, w, hgt + 2, ACCENTS[(i * 3 + Math.floor(seed)) % ACCENTS.length], 2);
    // janelinhas
    for (let wx = x + 1; wx < x + w - 2; wx += 2) b.set(wx, y + h - 2, '#fff3a3');
  });
  for (const [x, y] of [[17, 13], [20, 15], [16, 16], [44, 7]] as const) {
    b.rect(x, y, 2, 2, '#2f7044');
    b.set(x, y, '#4c9a55');
  }
  // guindaste da obra
  b.vline(19, -10, 6, '#e0b030');
  b.hline(15, 27, -10, '#e0b030');
  b.vline(26, -9, -5, INK);
  b.rect(25, -5, 3, 2, '#f08a3c');
  return finish(s, [0, 29, 48, 4]);
}

/** Prancheta de arquiteto (2x1): mesa inclinada com a planta azul, régua e luminária. */
function drafting(): BufFurniture {
  const s = floorSheet(2, 1, 26);
  const b = s.buf;
  const leg = '#5a6070';
  b.line(6, 2, 3, 15, leg);
  b.line(25, 2, 28, 15, leg);
  b.hline(5, 26, 10, leg);
  // tampo inclinado (mais alto atrás)
  for (let y = -14; y <= 2; y++) {
    const x0 = 2 + Math.floor((y + 14) / 6);
    b.hline(x0, 31 - x0, y, '#2f6fb8');
  }
  b.hline(2, 29, -14, '#5b95d8');
  b.hline(4, 27, 2, '#9a6b3f');
  b.hline(4, 27, 3, '#7a5a45');
  // planta desenhada em branco
  b.stamp(['##########', '#....#...#', '#....#...#', '#.####...#', '#........#', '###.####.#', '#........#', '##########'], 9, -12, { '#': 'rgba(255,255,255,0.85)' });
  b.line(21, -8, 27, -2, '#f2c14e');
  // luminária
  b.line(28, -14, 30, -20, '#7d8696');
  b.line(30, -20, 26, -23, '#7d8696');
  b.rect(23, -24, 4, 3, '#e05a5a');
  b.set(24, -21, '#fff3a3');
  return finish(s, [2, 13, 28, 4]);
}

/** Terminal dos agentes (1x1): console escuro com a tela de texto verde e a faixa turquesa. */
function terminal(): BufFurniture {
  const s = floorSheet(1, 1, 18);
  const b = s.buf;
  const g = M.graphite;
  b.rect(2, -12, 12, 27, g.base);
  b.hline(2, 13, -12, g.hi);
  b.vline(13, -12, 14, g.dk);
  b.hline(2, 13, 14, g.dd);
  b.rect(3, -10, 10, 8, '#0f1a24');
  b.hline(3, 12, -10, '#2fb3b0');
  b.hline(4, 8, -8, '#5ce08a');
  b.hline(4, 10, -6, '#5ce08a');
  b.hline(4, 6, -4, '#5ce08a');
  b.set(7, -4, '#ffffff');
  // teclado
  b.rect(2, -1, 12, 3, '#d9dce2');
  for (let x = 3; x < 13; x += 2) b.set(x, 0, '#f4f5f7');
  b.hline(2, 13, 1, '#a9aeb8');
  // faixa de luz e o "+" do novo agente
  b.rect(3, 4, 10, 2, '#2fb3b0');
  b.hline(3, 12, 4, '#7fe0dc');
  b.stamp(['.#.', '###', '.#.'], 7, 8, { '#': '#7fe0dc' });
  return finish(s, [1, 13, 14, 4]);
}

/** Rack de servidores (1x1): alto, com luzinhas e grade de ventilação. */
function rack(): BufFurniture {
  const s = floorSheet(1, 1, 22);
  const b = s.buf;
  b.rect(2, -20, 12, 35, '#2a2e38');
  b.hline(2, 13, -20, '#4a5060');
  b.vline(13, -19, 14, '#1c1f27');
  const leds = ['#5ce08a', '#f2c14e', '#5ce08a', '#4aa3f0', '#5ce08a'];
  for (let i = 0; i < 5; i++) {
    const y = -18 + i * 6;
    b.rect(3, y, 10, 5, '#3a3f4b');
    b.hline(3, 12, y, '#4a5060');
    for (let x = 6; x < 12; x += 2) b.set(x, y + 2, '#232732');
    b.set(4, y + 2, leds[i]);
    b.set(4, y + 3, i % 2 ? '#e05a5a' : '#5ce08a');
  }
  b.hline(2, 13, 14, '#15171d');
  return finish(s, [1, 13, 14, 4]);
}

/** Bancada de voz e vídeo (2x1): anel de luz, câmera no tripé, fone e microfone. */
function avDesk(): BufFurniture {
  const s = floorSheet(2, 1, 24);
  const b = s.buf;
  for (const x of [2, 29]) b.vline(x, 4, 15, '#5a6070');
  topFace(b, 0, -2, 32, 6, M.white);
  frontFace(b, 0, 4, 32, 3, ramp('#5b6f99', 0.07));
  // anel de luz
  b.vline(9, -10, -2, '#5a6070');
  b.ellipse(9, -15, 5, 5, '#fff3a3');
  b.ellipse(9, -15, 3, 3, undefined);
  for (let a = 0; a < 24; a++) {
    const x = Math.round(9 + Math.cos((a / 24) * Math.PI * 2) * 3);
    const y = Math.round(-15 + Math.sin((a / 24) * Math.PI * 2) * 3);
    b.clear(x, y);
  }
  b.rect(8, -16, 3, 3, '#2b2540');
  b.set(9, -15, '#4aa3f0');
  // fone de ouvido
  b.line(18, -4, 18, -8, '#3a3f4b');
  b.line(18, -8, 21, -10, '#3a3f4b');
  b.line(21, -10, 24, -8, '#3a3f4b');
  b.line(24, -8, 24, -4, '#3a3f4b');
  b.rect(17, -5, 2, 3, '#2fb3b0');
  b.rect(24, -5, 2, 3, '#2fb3b0');
  // microfone de mesa
  b.vline(28, -7, -2, '#7d8696');
  b.rect(27, -10, 3, 4, '#3a3f4b');
  b.set(27, -10, '#7d8696');
  return finish(s, [0, 13, 32, 4]);
}

/** Escaninho das entregas (2x1): estante de nichos com caixas, envelopes e um tubo. */
function cubbies(seed: number): BufFurniture {
  const s = floorSheet(2, 1, 22);
  const b = s.buf;
  const w = M.oak;
  b.rect(0, -20, 32, 35, w.base);
  b.hline(0, 31, -20, w.hi);
  b.vline(31, -20, 14, w.dk);
  b.hline(0, 31, 14, w.dd);
  const r = rngOf(seed, 5);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x = 2 + col * 10;
      const y = -18 + row * 11;
      b.rect(x, y, 8, 9, '#5e4433');
      b.hline(x, x + 7, y, '#4a3528');
      const k = Math.floor(r() * 4);
      if (k === 0) box3(b, x + 1, y + 3, 6, 6, '#c99a5e');
      else if (k === 1) {
        envelope(b, x + 1, y + 4, '#fbfaf6');
        envelope(b, x + 2, y + 2, '#fff3a3', '#3f7fd8');
      } else if (k === 2) {
        b.rect(x + 1, y + 6, 6, 3, '#e05a5a');
        b.hline(x + 1, x + 6, y + 6, '#ef7a6e');
      } else box3(b, x + 2, y + 4, 4, 5, ACCENTS[(row * 3 + col) % ACCENTS.length]);
    }
  }
  return finish(s, [0, 13, 32, 4]);
}

/** Mesinha com o telefone (1x1): telefone vermelho antigo e um bloquinho. */
function phone(): BufFurniture {
  const s = floorSheet(1, 1, 10);
  const b = s.buf;
  b.vline(7, 0, 14, '#5a6070');
  b.hline(4, 11, 14, '#5a6070');
  topFace(b, 1, -3, 14, 5, M.walnut);
  b.rect(1, 2, 14, 2, M.walnut.dk);
  const m = ramp('#d94a4a', 0.08);
  b.rect(4, -6, 8, 4, m.base);
  b.hline(4, 11, -6, m.lt);
  b.rect(3, -8, 10, 2, m.dk);
  b.hline(3, 12, -8, m.base);
  b.set(8, -4, '#fbfaf6');
  b.rect(12, -3, 3, 3, '#fff3a3');
  return finish(s, [1, 13, 14, 4]);
}

/** Rede de descanso (3x1) entre dois postes, listrada, com almofada. */
function hammock(): BufFurniture {
  const s = floorSheet(3, 1, 18);
  const b = s.buf;
  const w = M.walnut;
  for (const x of [1, 45]) {
    b.rect(x, -14, 2, 30, w.base);
    b.set(x, -14, w.lt);
    b.vline(x + 1, -13, 15, w.dk);
  }
  const stripes = ['#7fae2c', '#f2c14e', '#fbfaf6', '#ec8a3c'];
  for (let x = 6; x <= 41; x++) {
    const t = (x - 23.5) / 18;
    const y = Math.round(2 - (1 - t * t) * -4) - 4;
    for (let k = 0; k < 5; k++) b.set(x, y + k, stripes[(Math.floor(x / 3) + k) % stripes.length]);
    b.set(x, y + 5, 'rgba(60,40,40,0.3)');
  }
  b.line(3, -12, 6, -4, '#c99a5e');
  b.line(44, -12, 41, -4, '#c99a5e');
  // almofada
  b.rect(8, -4, 6, 3, '#e47aa8');
  b.hline(8, 13, -4, '#f2a3c4');
  b.shadow(24, 12, 15, 2);
  return finish(s);
}

/** Totem de informações (1x1): coluna branca com o "i" dourado e a tela de ajuda. */
function info(): BufFurniture {
  const s = floorSheet(1, 1, 22);
  const b = s.buf;
  b.rect(3, -18, 10, 33, M.white.base);
  b.hline(3, 12, -18, M.white.hi);
  b.vline(12, -17, 14, M.white.dk);
  b.hline(3, 12, 14, M.white.dd);
  b.ellipse(8, -14, 4, 4, '#e0b030');
  b.rect(7, -16, 2, 1, '#ffffff');
  b.rect(7, -14, 2, 4, '#ffffff');
  b.rect(4, -7, 8, 8, '#22324f');
  b.stamp(['.##.', '#..#', '..#.', '.#..', '....', '.#..'], 6, -6, { '#': '#4aa3f0' });
  b.rect(4, 4, 8, 2, '#e0b030');
  return finish(s, [2, 13, 12, 4]);
}

/** Luneta (1x1) num tripé, apontada para o alto, com uma estrelinha. */
function telescope(): BufFurniture {
  const s = floorSheet(1, 1, 18);
  const b = s.buf;
  b.line(8, -2, 3, 15, '#5a6070');
  b.line(8, -2, 13, 15, '#5a6070');
  b.line(8, -2, 8, 15, '#7d8696');
  b.line(2, 0, 13, -10, '#c9922e', 3);
  b.line(3, -1, 13, -10, '#f2c14e');
  b.rect(12, -13, 3, 3, '#7a5a45');
  b.rect(1, -1, 3, 3, '#3a3f4b');
  b.stamp(['.#.', '###', '.#.'], 12, -18, { '#': '#fff3a3' });
  return finish(s, [2, 13, 12, 4]);
}

/** Relógio do pomodoro (1x1): tomate grande num pedestal. */
function timer(): BufFurniture {
  const s = floorSheet(1, 1, 16);
  const b = s.buf;
  b.rect(5, 0, 6, 15, M.white.base);
  b.vline(10, 0, 14, M.white.dk);
  b.hline(3, 12, 14, M.white.dd);
  b.rect(3, -1, 10, 2, M.white.lt);
  b.ellipse(8, -6, 6, 5, '#c93c3c');
  b.ellipse(7, -7, 5, 4, '#e05a5a');
  b.set(5, -9, '#ffc9c9');
  b.set(6, -10, '#ffc9c9');
  b.stamp(['#.#.#', '.###.', '..#..'], 6, -13, { '#': '#4cae6a' });
  b.hline(6, 10, -5, '#fbfaf6');
  b.set(8, -6, '#2b2540');
  b.set(8, -4, '#2b2540');
  return finish(s, [2, 13, 12, 4]);
}

/** Arara de roupas (2x1): camisetas coloridas nos cabides. */
function clothes(): BufFurniture {
  const s = floorSheet(2, 1, 24);
  const b = s.buf;
  const steel = M.steelDark;
  for (const x of [2, 29]) b.vline(x, -20, 13, steel.base);
  b.hline(2, 29, -20, steel.lt);
  b.hline(1, 30, 13, steel.dk);
  for (const x of [1, 30]) b.rect(x - 1, 14, 3, 2, '#2b2540');
  const shirts = ['#e05a5a', '#3f7fd8', '#f2c14e', '#4cae6a', '#8d66cf', '#e47aa8'];
  shirts.forEach((c, i) => {
    const x = 4 + i * 4;
    b.set(x + 1, -19, '#c3c9d2');
    const m = ramp(c, 0.08);
    b.rect(x - 1, -17, 5, 2, m.lt);
    b.rect(x, -15, 3, 9, m.base);
    b.vline(x + 2, -15, -7, m.dk);
  });
  // caixa de sapatos embaixo
  box3(b, 8, 4, 10, 6, '#c99a5e');
  return finish(s, [0, 13, 32, 4]);
}

/** Espelho de corpo inteiro (1x1): moldura dourada com lâmpadas de camarim. */
function standMirror(): BufFurniture {
  const s = floorSheet(1, 1, 26);
  const b = s.buf;
  frame(b, 2, -22, 12, 34, ramp('#d9a42e', 0.07), '#cfe6f2');
  glass(b, 3, -21, 10, 32, { alpha: 0.5 });
  b.line(10, -20, 4, 8, 'rgba(255,255,255,0.7)');
  for (let y = -20; y <= 8; y += 6) {
    b.set(1, y, '#fff3a3');
    b.set(14, y, '#fff3a3');
  }
  b.rect(3, 12, 3, 3, '#7a5a45');
  b.rect(10, 12, 3, 3, '#7a5a45');
  return finish(s, [1, 13, 14, 4]);
}

/** Arquivo do registro (1x1): gaveteiro com etiquetas coloridas e uma gaveta aberta com fichas. */
function archive(): BufFurniture {
  const s = floorSheet(1, 1, 14);
  const b = s.buf;
  const m = ramp('#8a6a4f', 0.07);
  topFace(b, 1, -9, 14, 4, m);
  frontFace(b, 1, -5, 14, 21, m);
  for (let i = 0; i < 3; i++) {
    const y = -3 + i * 6;
    b.hline(2, 13, y + 4, m.dd);
    b.rect(5, y, 6, 2, ACCENTS[i * 2]);
    b.set(5, y, '#ffffff');
  }
  // gaveta de cima aberta, com fichas
  b.rect(2, -12, 12, 4, '#fbfaf6');
  for (let x = 3; x < 13; x += 2) b.vline(x, -13, -10, x % 4 === 1 ? '#f2c14e' : '#bfe3ff');
  return finish(s, [1, 13, 14, 4]);
}

/** Cavalete (1x1) com uma folha grande: organograma, calendário ou gráfico (quando a parede não tem lugar). */
function easel(kind: 'org' | 'cal' | 'chart'): BufFurniture {
  const s = floorSheet(1, 1, 26);
  const b = s.buf;
  const w = M.oakDark;
  b.line(4, -6, 1, 15, w.dk);
  b.line(11, -6, 14, 15, w.dk);
  b.line(8, -2, 8, 13, w.base);
  frame(b, 1, -22, 14, 17, ramp('#c3cad4', 0.06), '#fbfaf6');
  b.rect(1, -6, 14, 2, w.base);
  b.hline(1, 14, -6, w.lt);
  if (kind === 'org') {
    b.rect(6, -20, 4, 3, '#f2c14e');
    b.vline(7, -17, -15, INK);
    b.hline(3, 12, -15, INK);
    for (const [x, c] of [[2, '#3f7fd8'], [6, '#4cae6a'], [10, '#e47aa8']] as const) b.rect(x, -14, 4, 3, c);
  } else if (kind === 'cal') {
    b.rect(2, -21, 12, 3, '#e05a5a');
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) b.rect(3 + c * 3, -17 + r * 3, 2, 2, r === 1 && c === 2 ? '#3f7fd8' : '#d6d2c8');
  } else {
    [4, 7, 5, 9].forEach((h, i) => b.rect(3 + i * 3, -8 - h, 2, h, ACCENTS[i]!));
  }
  return finish(s, [1, 13, 14, 4]);
}

// =================================================================== parede

/** Organograma (3 ou 4 tiles): quadro branco com a árvore de cargos colorida. */
function orgchart(tiles: 2 | 3 | 4): BufFurniture {
  const s = wallSheet(tiles);
  const b = s.buf;
  const W = tiles * TILE;
  const x = 1;
  const y = -30;
  const w = W - 2;
  const h = 22;
  frame(b, x, y, w, h, ramp('#c3cad4', 0.06), '#fbfaf6');
  b.rect(x + 1, y + 1, w - 2, 3, '#8d66cf');
  b.hline(x + 1, x + w - 2, y + 1, '#ab8ee0');
  const cx = Math.floor(W / 2);
  box3(b, cx - 4, y + 5, 8, 5, '#f2c14e', 1);
  bust(b, cx - 2, y + 5, '#c9922e');
  b.vline(cx, y + 10, y + 12, INK);
  const kids = tiles === 4 ? 4 : tiles === 3 ? 3 : 2;
  const span = Math.floor((w - 12) / (kids - 1));
  const x0 = x + 6;
  b.hline(x0 + 3, x0 + span * (kids - 1) + 3, y + 12, INK);
  for (let i = 0; i < kids; i++) {
    const kx = x0 + i * span;
    b.vline(kx + 3, y + 12, y + 13, INK);
    box3(b, kx, y + 14, 7, 5, [ '#3f7fd8', '#4cae6a', '#e47aa8', '#2fb3b0'][i]!, 1);
    bust(b, kx + 2, y + 14, '#2b2540');
  }
  b.outline();
  wallShadow(b, x - 1, y - 1, w + 2, h + 2);
  return { base: trim(s) };
}

/** Quadro de presença (2): lousa escura com quem está, a bolinha do status e o nome. */
function presence(): BufFurniture {
  const s = wallSheet(2);
  const b = s.buf;
  frame(b, 1, -30, 30, 22, M.walnut, '#2c3a3a');
  b.rect(2, -29, 28, 3, '#4cae6a');
  b.hline(2, 29, -29, '#7bd394');
  const dots = ['#5ce08a', '#f2c14e', '#e05a5a', '#5ce08a'];
  for (let i = 0; i < 4; i++) {
    const yy = -24 + i * 4;
    b.rect(4, yy, 2, 2, dots[i]!);
    b.rect(8, yy, 3, 2, ACCENTS[(i * 3) % ACCENTS.length]);
    b.hline(13, 13 + 8 + (i % 2) * 5, yy + 1, '#c9d6d6');
  }
  b.outline();
  wallShadow(b, 0, -31, 32, 24);
  return { base: trim(s) };
}

/** Mapa do prédio (3): moldura de madeira com as salas coloridas e o "você está aqui". */
function map(): BufFurniture {
  const s = wallSheet(3);
  const b = s.buf;
  frame(b, 1, -30, 46, 22, M.oak, '#f6f1e3');
  b.rect(4, -27, 40, 16, '#e8e2d0');
  b.rect(4, -20, 40, 2, '#c3c9d2');
  const rooms: [number, number, number, number][] = [
    [5, -26, 7, 5],
    [13, -26, 9, 5],
    [23, -26, 7, 5],
    [31, -26, 12, 5],
    [5, -17, 10, 5],
    [16, -17, 8, 5],
    [25, -17, 9, 5],
    [35, -17, 8, 5],
  ];
  rooms.forEach(([x, y, w, h], i) => {
    b.rect(x, y, w, h, ACCENTS[i % ACCENTS.length]);
    b.hline(x, x + w - 1, y, shade(ACCENTS[i % ACCENTS.length], 0.18));
  });
  b.rect(19, -21, 3, 3, '#e05a5a');
  b.set(20, -22, '#e05a5a');
  b.set(20, -20, '#ffffff');
  b.outline();
  wallShadow(b, 0, -31, 48, 24);
  return { base: trim(s) };
}

/** Calendário de parede (2): argolas, cabeçalho vermelho e o dia da reunião marcado. */
function calendar(): BufFurniture {
  const s = wallSheet(2);
  const b = s.buf;
  frame(b, 4, -29, 24, 21, ramp('#e9e8e4', 0.04), '#ffffff');
  b.rect(5, -28, 22, 5, '#e05a5a');
  b.hline(5, 26, -28, '#ef7a6e');
  for (const x of [9, 22]) {
    b.vline(x, -31, -27, '#7d8696');
    b.set(x, -31, '#c3c9d2');
  }
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 6; c++) {
      const x = 6 + c * 3 + Math.floor(c / 2);
      const y = -21 + r * 4;
      b.rect(x, y, 2, 2, r === 1 && c === 3 ? '#3f7fd8' : '#d6d2c8');
    }
  }
  b.outline();
  wallShadow(b, 3, -30, 26, 23);
  return { base: trim(s) };
}

/** Quadro do "meu dia" (3): gráfico de barras colorido com a linha da semana. */
function chart(): BufFurniture {
  const s = wallSheet(3);
  const b = s.buf;
  frame(b, 1, -30, 46, 22, ramp('#c3cad4', 0.06), '#fbfaf6');
  b.hline(5, 43, -11, '#93a0b4');
  b.vline(5, -27, -11, '#93a0b4');
  const hs = [6, 9, 5, 12, 8, 14, 10];
  hs.forEach((h, i) => {
    const x = 8 + i * 5;
    const c = ACCENTS[i % ACCENTS.length];
    b.rect(x, -11 - h, 3, h, c);
    b.vline(x + 2, -11 - h, -12, shade(c, -0.15));
    b.set(x, -11 - h, shade(c, 0.2));
  });
  b.line(8, -16, 18, -22, '#2b2540');
  b.line(18, -22, 28, -19, '#2b2540');
  b.line(28, -19, 40, -26, '#2b2540');
  b.outline();
  wallShadow(b, 0, -31, 48, 24);
  return { base: trim(s) };
}

/** TV grande (3) com moldura fina; a tela (rects.tv) recebe a programação do mundo. */
function bigTv(): BufFurniture {
  const s = wallSheet(3);
  const b = s.buf;
  const x = 1;
  const y = -30;
  const w = 46;
  const h = 24;
  b.rect(x, y, w, h, '#23262f');
  b.hline(x, x + w - 1, y, '#3a3f4b');
  b.hline(x, x + w - 1, y + h - 1, '#15171d');
  b.rect(x + 1, y + 1, w - 2, h - 3, '#151b26');
  b.set(x + w - 3, y + h - 2, '#5ce08a');
  b.outline();
  wallShadow(b, x - 1, y - 1, w + 2, h + 2);
  s.rects = { tv: rectAt(s, x + 1, y + 1, w - 2, h - 3) };
  return { base: s };
}

/** Painel dos avisos (1): sino dourado com o selo vermelho. */
function bell(): BufFurniture {
  const s = wallSheet(1);
  const b = s.buf;
  frame(b, 1, -28, 14, 15, ramp('#5b6f99', 0.07), '#e9eef8');
  b.stamp(['...##...', '..####..', '.######.', '.######.', '.######.', '########', '...##...'], 4, -25, { '#': '#e0b030' });
  b.set(6, -23, '#fff3a3');
  b.rect(11, -27, 4, 4, '#e05a5a');
  b.set(12, -26, '#ffffff');
  b.set(12, -25, '#ffffff');
  b.outline();
  wallShadow(b, 0, -29, 16, 17);
  return { base: trim(s) };
}

/** Engrenagem das configurações (1): plaquinha com a engrenagem. */
function gear(): BufFurniture {
  const s = wallSheet(1);
  const b = s.buf;
  frame(b, 1, -28, 14, 15, ramp('#3a3f4b', 0.08), '#2c313d');
  b.stamp(['..#..#..', '.######.', '.##..##.', '##....##', '##....##', '.##..##.', '.######.', '..#..#..'], 4, -25, { '#': '#c9d6ee' });
  b.outline();
  wallShadow(b, 0, -29, 16, 17);
  return { base: trim(s) };
}

const GLYPH: Record<string, string[]> = {
  E: ['###', '#..', '##.', '#..', '###'],
  '?': ['###', '..#', '.##', '...', '.#.'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  up: ['.#.', '###', '.#.', '.#.', '...'],
};

/** Teclas na parede (2): pôster com teclas em 3D (E, ?, N, G e a seta). */
function keys(): BufFurniture {
  const s = wallSheet(2);
  const b = s.buf;
  frame(b, 1, -30, 30, 22, ramp('#2fb3b0', 0.07), '#e8f6f6');
  const caps = ['E', '?', 'O', 'G', 'up'];
  caps.forEach((k, i) => {
    const x = 3 + (i % 3) * 9;
    const y = -27 + Math.floor(i / 3) * 9;
    box3(b, x, y, 8, 8, i === 0 ? '#f2c14e' : '#fbfaf6', 1);
    b.stamp(GLYPH[k]!, x + 2, y + 2, { '#': INK });
  });
  b.outline();
  wallShadow(b, 0, -31, 32, 24);
  return { base: trim(s) };
}

/** Espelho de camarim (1): moldura rosa com lâmpadas; o vidro (rects.glass) mostra o reflexo. */
function vanity(): BufFurniture {
  const s = wallSheet(1);
  const b = s.buf;
  const x = 1;
  const y = -30;
  const w = 14;
  const h = 18;
  frame(b, x, y, w, h, ramp('#e47aa8', 0.07), '#cfe6f2');
  glass(b, x + 2, y + 2, w - 4, h - 4, { alpha: 0.5 });
  b.line(x + 9, y + 2, x + 4, y + h - 3, 'rgba(255,255,255,0.75)');
  for (const yy of [y + 2, y + 8, y + 14]) {
    b.set(x, yy, '#fff3a3');
    b.set(x + w - 1, yy, '#fff3a3');
  }
  b.outline();
  wallShadow(b, x - 1, y - 1, w + 2, h + 2);
  s.rects = { glass: rectAt(s, x + 2, y + 2, w - 4, h - 4) };
  return { base: s };
}

/** Planta da empresa emoldurada (2): papel azul com as linhas brancas. */
function blueprint(): BufFurniture {
  const s = wallSheet(2);
  const b = s.buf;
  frame(b, 1, -30, 30, 21, ramp('#e9e8e4', 0.04), '#2f6fb8');
  b.stamp(
    ['########################', '#.......#......#.......#', '#.......#......#.......#', '#.......#..............#', '####.####......####.####', '#......................#', '#.........#####........#', '#.........#...#........#', '########################'],
    4,
    -27,
    { '#': 'rgba(255,255,255,0.85)' },
  );
  b.hline(4, 27, -15, '#f2c14e');
  b.outline();
  wallShadow(b, 0, -31, 32, 23);
  return { base: trim(s) };
}

/** Painel de voz e vídeo (2): ondas de som, câmera e o "ao vivo". */
function avPanel(): BufFurniture {
  const s = wallSheet(2);
  const b = s.buf;
  frame(b, 1, -30, 30, 20, ramp('#3a3f4b', 0.08), '#1d2433');
  const hs = [2, 5, 8, 4, 9, 6, 3, 7, 4, 2];
  hs.forEach((h, i) => b.rect(4 + i * 2, -20 - h / 2, 1, h, i % 3 ? '#4aa3f0' : '#5ce08a'));
  b.rect(25, -24, 4, 3, '#c3c9d2');
  b.set(26, -23, '#2b2540');
  b.rect(22, -15, 7, 3, '#e05a5a');
  b.hline(23, 27, -14, '#ffffff');
  b.outline();
  wallShadow(b, 0, -31, 32, 22);
  return { base: trim(s) };
}

// =================================================================== despacho

const BUILD: Record<KvSpriteKey, (seed: number) => BufFurniture> = {
  'kv-hr-desk': hrDesk,
  'kv-invite-desk': inviteDesk,
  'kv-mailbox': mailbox,
  'kv-podium': podium,
  'kv-model': model,
  'kv-drafting': drafting,
  'kv-terminal': terminal,
  'kv-rack': rack,
  'kv-av-desk': avDesk,
  'kv-cubbies': cubbies,
  'kv-phone': phone,
  'kv-hammock': hammock,
  'kv-info': info,
  'kv-telescope': telescope,
  'kv-timer': timer,
  'kv-clothes': clothes,
  'kv-stand-mirror': standMirror,
  'kv-archive': archive,
  'kv-orgchart': () => orgchart(3),
  'kv-orgchart-big': () => orgchart(4),
  'kv-orgchart-small': () => orgchart(2),
  'kv-easel-org': () => easel('org'),
  'kv-easel-cal': () => easel('cal'),
  'kv-easel-chart': () => easel('chart'),
  'kv-presence': presence,
  'kv-map': map,
  'kv-calendar': calendar,
  'kv-chart': chart,
  'kv-bigtv': bigTv,
  'kv-bell': bell,
  'kv-keys': keys,
  'kv-vanity': vanity,
  'kv-blueprint': blueprint,
  'kv-av-panel': avPanel,
  'kv-gear': gear,
  ...KV_MEET_BUILD, // salas de reunião (meet-sprites.ts)
};

/** Sprite (em buffer) de um item nosso; null se a variante não é nossa. */
export function kvBuildSprite(variant: string, seed = 0): BufFurniture | null {
  const f = (BUILD as Record<string, ((seed: number) => BufFurniture) | undefined>)[variant];
  return f ? f(Math.abs(Math.floor(seed)) % 4) : null;
}

export const KV_SPRITE_KEYS = Object.keys(BUILD) as KvSpriteKey[];

