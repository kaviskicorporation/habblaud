// Fork Kaviski (KAVISKI.md): o nome do produto na tela é "Voxtrin". Os textos do original continuam escritos com
// "Habblaud" (são as chaves das traduções e o que os testes do original conferem); tr() passa a saída por kvProduto,
// então a troca vale para a interface, as respostas do servidor e os quatro idiomas sem mexer em cada texto.
// Fica de fora:
// - "Habblaud World": é o nome de um serviço de terceiros (com Termos de Uso próprios), como "Claude Code";
// - nomes técnicos (HABBLAUD_*, ~/.habblaud, npm run …, mod habblaud): têm outra grafia e não casam com a troca.
// Nos testes (VITEST) a troca fica desligada, para os textos do original seguirem iguais; KV_PRODUTO_TEST=1 liga.

export const KV_PRODUTO = 'Voxtrin';

const ORIGINAL = /Habblaud(?! World)/g;

function ligado(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return !env?.VITEST || env.KV_PRODUTO_TEST === '1';
}

const ATIVO = ligado();

/** Troca "Habblaud" pelo nome do produto (menos "Habblaud World"). Sem "Habblaud" no texto, devolve o mesmo texto. */
export function kvProduto(text: string, ativo: boolean = ATIVO): string {
  return ativo && text.includes('Habblaud') ? text.replace(ORIGINAL, KV_PRODUTO) : text;
}
