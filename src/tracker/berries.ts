import type { HuntBerry } from './types';
export const berryNames: Record<string, string> = { 'razz-berry': '蔓莓果', 'golden-razz-berry': '金色蔓莓果', 'nanab-berry': '蕉香果', 'enigma-berry': '谜芝果', 'pinap-berry': '凰梨果', 'lansat-berry': '兰萨果', 'starf-berry': '星桃果' };
export const berryEffects: Record<string, string> = { capture: '捕获概率', rare: '稀有遭遇', dex: '未收录遭遇', xp: '经验', money: '金币', shiny: '异色概率' };
export function normalizeBerries(keys: string[], berries: HuntBerry[]) {
  const families = new Map<string, string>();
  for (const key of keys) { const berry = berries.find(b => b.key === key); if (berry) families.set(berry.family, key); }
  return [...families.values()];
}
export function berryPlan(keys: string[], berries: HuntBerry[], save: any, now: number) {
  return normalizeBerries(keys, berries).map(key => {
    const berry = berries.find(b => b.key === key)!, active = save.buffs?.[berry.family];
    const valid = active && active.until > now && berries.some(b => b.key === active.key)
      && !(active.side === 'from' && save.link?.side === 'to');
    const stock = Number(save.items?.[key]) || 0;
    return { berry, stock, until: valid ? active.until as number : 0, eat: !valid && stock > 0 };
  });
}
