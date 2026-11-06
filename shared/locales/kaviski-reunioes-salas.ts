// Fork Kaviski (KAVISKI-HUMANOS.md → "Reuniões e reservas de sala"): traduções — tipos de sala de reunião e a mobília (rooms-layout.ts, furnish-propria.ts, furnish-meet.ts).
// Uma linha por texto: [pt, en, es, fr]. Entram nos dicionários com `...KV_REUNIOES_SALAS_XX` em en.ts, es.ts e fr.ts.
const T: readonly (readonly [string, string, string, string])[] = [
];

function dict(i: 1 | 2 | 3): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const row of T) out[row[0]] = row[i];
  return out;
}

export const KV_REUNIOES_SALAS_EN = dict(1);
export const KV_REUNIOES_SALAS_ES = dict(2);
export const KV_REUNIOES_SALAS_FR = dict(3);
