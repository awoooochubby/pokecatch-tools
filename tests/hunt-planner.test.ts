import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { expectedClearMoves, clearTimeScore } from '../src/raid/time';
import { completionQueue, huntTeam } from '../src/tracker/teams';
import { trackerFixture } from './tracker-fixture';
import { referenceEngine } from './reference-engine';
import { createHuntCatalog } from '../src/tracker/catalog';
import { predictHunt } from '../src/tracker/predict';
import { optimizeRaid } from '../src/raid/planner';
import type { TrackerPrefs, HuntJob } from '../src/tracker/types';

describe('统一队列与出招目标', () => {
  it('较快但胜率稍低的阵容，期望双方总出招可能更少；零胜率没有有限结果', () => {
    expect(expectedClearMoves(18, .9)).toBe(20);
    expect(expectedClearMoves(30, 1)).toBe(30);
    expect(clearTimeScore({ expectedClearMoves: expectedClearMoves(18, .9) })).toBeLessThan(clearTimeScore({ expectedClearMoves: expectedClearMoves(30, 1) }));
    expect(expectedClearMoves(9, 0)).toBeNull();
    // 80% of runs cost 10 moves, 20% fail after 30 moves: E = 14/.8.
    expect(expectedClearMoves(.8 * 10 + .2 * 30, .8)).toBe(17.5);
  });
  it('补图鉴是一次性去重快照，只加入缺少且当前可捕捉的种类', () => {
    const t = (id: number, owned = false, ready = true, dexMissing = true): any => ({ id, owned, dexMissing, destinations: ready ? [{}] : [] });
    const targets = [t(1), t(2, true), t(3, false, false), t(-1, false, true, false), t(4)];
    const result = completionQueue(targets, [243, 1]);
    expect(result).toEqual([243, 1, 4]); targets.push(t(5)); expect(result).not.toContain(5);
  });
  it('天气插队后目标使用各自预设；默认队与独立神兽队分开解析', () => {
    const s = { team: ['weather'], eventTeams: { 'zone:150': ['zone'] } };
    const prefs: TrackerPrefs = { targets: [], berries: [], weather: null, mode: 'ordered', defaultTeam: ['original'], teams: { 243: ['beast'] } };
    const job: HuntJob = { id: 243, kind: 'roaming', interrupt: false, destination: { chapter: 17, region: 'johto', name: '' } };
    expect(huntTeam(s, prefs, job)).toEqual(['beast']);
    expect(huntTeam(s, prefs, { ...job, id: 144 })).toEqual(['original']);
    expect(huntTeam(s, prefs, { ...job, id: 150, kind: 'zone', destination: { ...job.destination, zone: 150 } })).toEqual(['zone']);
  });
});

describe.skipIf(!existsSync('.cache/engine.js'))('原生追踪模拟与共享团战搜索', () => {
  const now = Date.UTC(2026, 10, 4, 12), source = readFileSync('.cache/engine.js', 'utf8');
  const fixture = () => {
    const s = trackerFixture(source, now), native = referenceEngine(source, now, 1, ['Raids', 'LegendZones']);
    s.mons.forEach((m: any) => { m.rank = 5; m.shiny = true; });
    s.adv.gifts = Object.fromEntries(native.STORY.CHAPTERS.flatMap((c: any) => c.steps).filter((n: any) => n.kind === 'gift' && n.gift?.key).map((n: any) => [n.gift.key, true]));
    return { s, native };
  };
  it('完整原生道中＋游走首领和普通缺失目标均可模拟，真实存档不变', async () => {
    const { s } = fixture(), raw = JSON.stringify(s), catalog = (await createHuntCatalog(source))(raw, now);
    const raikou = catalog.targets.find(t => t.id === 243)!;
    const report = await predictHunt(source, raw, now, { id: 243, kind: 'roaming', interrupt: false, destination: raikou.destinations[0] }, s.team, 8);
    expect(report.win.mean).toBe(1); expect(report.reach.mean).toBe(1);
    const wild = catalog.targets.find(t => t.id === 16)!;
    expect(wild.kind).toBe('wild'); expect(wild.destinations.length).toBeGreaterThan(0);
    const normal = await predictHunt(source, raw, now, { id: 16, kind: 'wild', interrupt: false, destination: wild.destinations[0] }, s.team, 4);
    expect(normal.win.mean).toBe(1); expect(JSON.stringify(s)).toBe(raw);
    const weak = structuredClone(s); weak.mons = [{ uid: 'weak', id: 129, level: 1, xp: 0, reg: 'sinnoh' }]; weak.team = ['weak'];
    const loss = await predictHunt(source, JSON.stringify(weak), now, { id: 243, kind: 'roaming', interrupt: false, destination: raikou.destinations[0] }, ['weak'], 4);
    expect(loss.win.mean).toBe(0); expect(loss.loss).toBeGreaterThan(0);
  }, 30000);
  it('补全使用实际原生池，不将进化／蛋／交换当捕捉地点', async () => {
    const { s } = fixture(), catalog = (await createHuntCatalog(source))(JSON.stringify(s), now);
    expect(catalog.targets.find(t => t.id === 16)?.destinations.length).toBeGreaterThan(0);
    expect(catalog.targets.find(t => t.id === 175)?.destinations || []).toEqual([]);
    s.mons.push({ uid: 'owned-16', id: 16, level: 10, xp: 0, reg: 'kanto' });
    const withOwned = (await createHuntCatalog(source))(JSON.stringify(s), now);
    const owned = withOwned.targets.find(t => t.id === 16)!; expect(owned.owned).toBe(true); expect(owned.dexMissing).toBe(false);
    const onlyFirst = structuredClone(s); onlyFirst.adv.unlocked = 0;
    const limited = (await createHuntCatalog(source))(JSON.stringify(onlyFirst), now);
    expect(limited.targets.filter(t => t.kind === 'wild').every(t => t.destinations.every(d => d.chapter === 0))).toBe(true);
  });
  it('共享团战搜索使用真实 NPC，在候选间按期望出招排序，并独立验证', async () => {
    const { s, native } = fixture(); s.adv.badges.push('Maître Kanto');
    const mons = [445, 376, 130, 143, 392, 462];
    s.raids = { bots: { sinnoh: [0, 1, 2].map(i => ({ key: `b-test-${i}`, name: `NPC ${i}`, mons: mons.slice(i * 2, i * 2 + 2).map((id, j) => ({ id, uid: `bot-${i}-${j}`, level: 100, xp: 0, bot: true, statMult: .85 })) })) }, pick: {}, done: {}, botsV: 3, timesV: 1, pityV: 1, paceV: 1 };
    const raw = JSON.stringify(s);
    const plan = await optimizeRaid(source, raw, now, { region: 'sinnoh', boss: 25, date: native.Raids.dateKey(now), done: false, input: null, error: '' }, s.team.slice(0, 2));
    expect(plan.candidates).toBe(3); expect(plan.report.trials).toBe(512);
    expect(plan.report.moves.total.mean).toBeGreaterThan(0); expect(plan.report.moves.enemy.mean).toBeGreaterThan(0);
    expect(plan.report.expectedClearMoves).toBeCloseTo(plan.report.moves.total.mean / plan.report.win.mean);
    expect(plan.picks).toHaveLength(2); expect(JSON.stringify(s)).toBe(raw);
  }, 60000);
});
