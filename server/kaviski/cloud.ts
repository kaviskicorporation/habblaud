// Fork Kaviski (Voxtrin Cloud, repositório 05.Voxtrin_Cloud): no ambiente de um cliente da nuvem, o plano limita
// quantas pessoas entram no escritório. HABBLAUD_MAX_PESSOAS = total do plano, contando a conta do .env (a dona);
// sem a variável vale o limite de sempre.

export interface KvMaxPessoas {
  /** Contas que podem existir em users.json (fora a conta do .env). */
  contas: number;
  /** O número que a pessoa vê na mensagem (o total do plano). */
  total: number;
}

export function kvMaxPessoas(padrao: number, env: NodeJS.ProcessEnv = process.env): KvMaxPessoas {
  const n = Number(env.HABBLAUD_MAX_PESSOAS?.trim());
  if (!Number.isInteger(n) || n < 1) return { contas: padrao, total: padrao };
  return { contas: Math.min(padrao, n - 1), total: Math.min(padrao + 1, n) };
}
