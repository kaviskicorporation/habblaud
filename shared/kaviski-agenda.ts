// Fork Kaviski (KAVISKI-HUMANOS.md): agenda por ICS — o que o servidor (server/kaviski/humanos/agenda.ts) manda à página.

export interface KvAgendaEventOut {
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  busy: boolean;
  location?: string;
  room?: { id: string; name: string; area: string };
}

export interface KvAgendaState {
  configured: boolean;
  hint?: string;
  fetchedAt?: number;
  error?: string;
  events: KvAgendaEventOut[];
}

/** Ocupação de uma sala (agenda/rooms). */
export interface KvRoomBooking {
  roomId: string;
  area: string;
  start: number;
  end: number;
}
