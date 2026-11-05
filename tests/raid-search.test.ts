import { describe, it, expect } from 'vitest';
import { allyPairs, raidPlanContext } from '../src/raid/planner';
import type { RaidOffer } from '../src/raid/types';
describe('团战队友枚举', () => {
  const offers: RaidOffer[] = Array.from({ length: 10 }, (_, i) => ({ key: i < 4 ? `f-${i}` : `b-${i}`, name: `队友${i}`, friend: i < 4,
    mons: [{ uid: `mon-${i}`, id: 25, level: 100, shiny: false, xp: 0, bot: true }], before: Array.from({ length: 9 - i }, (_, j) => j + i + 1).map(j => j < 4 ? `f-${j}` : `b-${j}`) }));
  it('完整包含 4 个好友、6 个 NPC 的 45 种组合，按原生顺序而非输入排序', () => {
    const pairs = allyPairs([...offers].reverse());
    expect(pairs).toHaveLength(45);
    expect(pairs.filter(p => p.keys.every(k => k.startsWith('f-')))).toHaveLength(6);
    expect(pairs.filter(p => p.keys.every(k => k.startsWith('b-')))).toHaveLength(15);
    expect(pairs.filter(p => p.keys.some(k => k.startsWith('f-')) && p.keys.some(k => k.startsWith('b-')))).toHaveLength(24);
    expect(pairs.every(p => !p.alternate)).toBe(true);
    expect(pairs.find(p => p.keys.includes('b-9') && p.keys.includes('f-0'))?.mons.map(m => m.uid)).toEqual(['mon-0', 'mon-9']);
  });
  it('原队配置和可用好友队伍改变会使搜索快照过期', () => {
    const s = { mons: [{ uid: 'a', id: 25, level: 100 }], adv: { speed: 4 }, eventTeams: { 'raid:kanto': ['a'] }, raids: { pick: { kanto: ['f-0', 'b-4'] } } };
    const entry = { region: 'kanto', boss: 25, date: '2026-11-05', done: false, input: null, error: '', offers: structuredClone(offers) };
    const key = raidPlanContext(JSON.stringify(s), entry);
    s.eventTeams['raid:kanto'] = ['b']; expect(raidPlanContext(JSON.stringify(s), entry)).not.toBe(key);
    s.eventTeams['raid:kanto'] = ['a']; entry.offers[0].mons[0].level = 99; expect(raidPlanContext(JSON.stringify(s), entry)).not.toBe(key);
  });
  it('无法确定的两个好友顺序同时模拟；不修改原始完整属性', () => {
    const a = structuredClone(offers[0]), b = structuredClone(offers[1]); a.before = []; b.before = [];
    a.mons[0].shiny = true; b.mons[0].statMult = .9;
    const pair = allyPairs([a, b])[0];
    expect(pair.mons).toEqual([...a.mons, ...b.mons]); expect(pair.alternate).toEqual([...b.mons, ...a.mons]);
  });
});
