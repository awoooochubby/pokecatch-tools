import { describe, it, expect } from 'vitest';
import { berryPlan, normalizeBerries } from '../src/tracker/berries';
import type { HuntBerry } from '../src/tracker/types';
const berries: HuntBerry[] = [
  { key: 'razz-berry', name: '蔓莓果', family: 'capture', mult: 1.25, minutes: 60, stock: 2 },
  { key: 'golden-razz-berry', name: '金色蔓莓果', family: 'capture', mult: 1.5, minutes: 60, stock: 2 },
  { key: 'pinap-berry', name: '凰梨果', family: 'xp', mult: 1.25, minutes: 60, stock: 1 },
];
describe('追踪自动吃果计划', () => {
  it('同类只保留最后选择的一种，忽略未知果子', () => {
    expect(normalizeBerries(['razz-berry', 'pinap-berry', 'golden-razz-berry', 'unknown'], berries)).toEqual(['golden-razz-berry', 'pinap-berry']);
  });
  it('只消费已选择且有库存、同类效果已到期的果子', () => {
    const s = { items: { 'razz-berry': 2, 'pinap-berry': 0 }, buffs: { capture: { key: 'golden-razz-berry', until: 1001 } } };
    expect(berryPlan(['razz-berry', 'pinap-berry'], berries, s, 1000).map(p => p.eat)).toEqual([false, false]);
    expect(berryPlan(['razz-berry', 'pinap-berry'], berries, s, 1001).map(p => p.eat)).toEqual([true, false]);
    s.items['pinap-berry'] = 1;
    expect(berryPlan(['pinap-berry'], berries, s, 1001)[0].eat).toBe(true);
  });
  it('不会提前叠时长或覆盖强弱不同的有效同类效果', () => {
    for (const key of ['razz-berry', 'golden-razz-berry']) {
      const s = { items: { 'razz-berry': 5, 'golden-razz-berry': 5 }, buffs: { capture: { key, until: 9999 } } };
      expect(berryPlan(['razz-berry'], berries, s, 1000)[0].eat).toBe(false);
      expect(berryPlan(['golden-razz-berry'], berries, s, 1000)[0].eat).toBe(false);
    }
  });
  it('保留原生地区效果有效性，不把旧地区隐藏效果视为当前生效', () => {
    const s = { items: { 'razz-berry': 2 }, buffs: { capture: { key: 'razz-berry', until: 9999, side: 'from' } }, link: { side: 'to' } };
    expect(berryPlan(['razz-berry'], berries, s, 1000)[0].eat).toBe(true);
    s.link.side = 'from'; expect(berryPlan(['razz-berry'], berries, s, 1000)[0].eat).toBe(false);
  });
});
