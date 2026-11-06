import { describe, expect, it } from 'vitest';
import { KV_TOP_COMFORT_STEPS, KV_TOP_GROUPS, KV_TOP_SLOTS, KV_TOP_STEPS, kvTopSlotOf, kvTopTip } from './topbar-model';

const fake = (cls: string[], label: string | null = null) => ({
  classList: { contains: (c: string) => cls.includes(c) },
  getAttribute: (n: string) => (n === 'aria-label' ? label : null),
});

describe('topo em grupos (topbar-model)', () => {
  it('acha o lugar pela classe ou pelo rótulo', () => {
    expect(kvTopSlotOf(fake(['ui-icon-btn', 'kv-btn-org']))?.group).toBe('empresa');
    expect(kvTopSlotOf(fake(['ui-icon-btn'], 'Meu dia: para onde foi o tempo (M)'))?.key).toBe('M');
    expect(kvTopSlotOf(fake(['ui-icon-btn'], 'Botão novo do original'))).toBeNull();
  });

  it('todo grupo existe e cada "drop" é único e tem passo', () => {
    const groups = new Set(KV_TOP_GROUPS.map((g) => g.key));
    for (const s of KV_TOP_SLOTS) expect(groups.has(s.group)).toBe(true);
    const drops = KV_TOP_SLOTS.filter((s) => s.drop).map((s) => s.drop);
    expect(new Set(drops).size).toBe(drops.length);
    const stepDrops = KV_TOP_STEPS.filter((s) => s.drop).map((s) => s.drop);
    expect([...stepDrops].sort((a, b) => a! - b!)).toEqual([...drops].sort((a, b) => a! - b!));
    expect(KV_TOP_COMFORT_STEPS).toBeLessThan(KV_TOP_STEPS.length);
  });

  it('o que mora no "Mais" nunca tem drop; Configurações e Ajuda nunca saem', () => {
    for (const s of KV_TOP_SLOTS) if (s.more) expect(s.drop).toBeUndefined();
    expect(KV_TOP_SLOTS.filter((s) => s.group === 'sistema' && !s.cls).every((s) => !s.drop && !s.more)).toBe(true);
  });

  it('dica com o atalho só quando o rótulo ainda não diz', () => {
    const feed = kvTopSlotOf(fake(['ui-btn-feed']));
    expect(kvTopTip('Feed de atividade ( ] )', feed)).toBe('Feed de atividade ( ] )');
    const chat = kvTopSlotOf(fake(['kv-btn-chat']));
    expect(kvTopTip('Conversas', chat)).toBe('Conversas · atalho: Enter');
    expect(kvTopTip('Avisos: sons e notificações', kvTopSlotOf(fake(['kv-btn-alerts'])))).toBe('Avisos: sons e notificações');
  });
});
