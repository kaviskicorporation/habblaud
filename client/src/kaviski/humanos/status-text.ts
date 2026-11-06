// Fork Kaviski (KAVISKI-HUMANOS.md, W2): textos curtos do status (sem DOM, para o selo do boneco e os testes).

/** A nota encurtada para o selo do boneco (o emoji sempre fica). */
export function kvShortNote(note: string, max = 18): string {
  const chars = [...note.trim()];
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : chars.join('');
}

/** "até 15:30" (hoje) ou "até 12/11 15:30" para o "até" do status. */
export function kvUntilText(until: number, now = Date.now(), locale?: string): string {
  const d = new Date(until);
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const same = new Date(now).toDateString() === d.toDateString();
  return same ? time : `${d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })} ${time}`;
}

/** Fim do dia de hoje (23:59) para o "até: hoje". */
export function kvEndOfDay(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(23, 59, 0, 0);
  return d.getTime() <= now ? now + 60_000 : d.getTime();
}
