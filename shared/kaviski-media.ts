// Fork Kaviski (KAVISKI-HUMANOS.md, "Voz e vídeo — onda Gather"): o que servidor e página trocam sobre o palco
// (megafone): uma pessoa da equipe fala para o andar inteiro, numa chamada à parte que todo mundo assina só para ouvir.

/** Evento `stage` do fluxo de presença e resposta de GET /api/kaviski/humanos/stage. */
export interface KvStageState {
  active: boolean;
  /** Quem está no palco (só com active). */
  by?: { id: string; name: string };
  /** Desde quando (epoch ms); muda a cada palco aberto (a chamada é outra). */
  since?: number;
}

/** Resposta de POST /api/kaviski/humanos/stage/token. */
export interface KvStageToken {
  url: string;
  room: string;
  token: string;
  /** Só quem está no palco publica (microfone); os outros só ouvem. */
  canPublish: boolean;
  since: number;
}
