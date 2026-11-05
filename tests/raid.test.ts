import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { referenceEngine } from './reference-engine';
import { predictRaid } from '../src/raid/engine';
import { raidDate } from '../src/raid/read';
import { raidContext } from '../src/modules/raid';
import type { RaidInput } from '../src/raid/types';
import { vi } from 'vitest';
vi.mock('../src/raid/worker?worker&inline', () => ({ default: class {} }));

describe('团体战快照口径', () => {
  it('使用游戏的巴黎日界线', () => {
    expect(raidDate(Date.UTC(2026, 10, 4, 22, 59))).toBe('2026-11-04');
    expect(raidDate(Date.UTC(2026, 10, 4, 23, 1))).toBe('2026-11-05');
  });
  it('配置过期只比较影响战斗的字段，忽略即时 HP 和普通路线进度', () => {
    const s: any = { mons: [{ id: 445, uid: 'a', level: 100, xp: 0, hp: 5 }], eventTeams: { 'raid:sinnoh': ['a'] }, adv: { chapter: 60, node: 0, speed: 4 }, buffs: {} };
    const input: RaidInput = { region: 'sinnoh', boss: 25, date: '2026-11-04', mine: ['a'], allies: [{ id: 130, uid: 'b', level: 100, xp: 0, hp: 5, bot: true } as any], weather: 'storm', source: 'active' };
    const now = Date.UTC(2026, 10, 4, 12), key = raidContext(JSON.stringify(s), input, now);
    s.mons[0].hp = 100; s.adv.chapter++; s.adv.node++; s.mons[0].xp = 999;
    (input.allies[0] as any).hp = 100;
    expect(raidContext(JSON.stringify(s), input, now)).toBe(key);
    input.allies[0].statMult = .5;
    expect(raidContext(JSON.stringify(s), input, now)).not.toBe(key);
    input.allies[0].statMult = undefined; s.mons[0].rank = 1;
    expect(raidContext(JSON.stringify(s), input, now)).not.toBe(key);
  });
});

describe.skipIf(!existsSync('.cache/engine.js'))('原生团体战胜率', () => {
  let source: string, s: any, input: RaidInput, native: Record<string, any>;
  const now = Date.UTC(2026, 10, 4, 12), seed = 8349271;
  beforeAll(() => {
    source = readFileSync('.cache/engine.js', 'utf8'); native = referenceEngine(source, now, 1, ['Raids', 'LegendZones']);
    s = native.Game.freshState(); s.travel = { to: ['johto', 'hoenn', 'sinnoh'] };
    s.mons = [445, 376].map((id, i) => ({ id, uid: `mine-${i}`, level: 100, xp: 0, reg: 'sinnoh', shiny: true, rank: 5 }));
    s.team = s.mons.map((m: any) => m.uid); s.eventTeams = { 'raid:sinnoh': [...s.team] };
    s.adv = { chapter: 65, unlocked: 65, runs: 5, badges: ['Maître Kanto', 'Maître Sinnoh'], gifts: {}, kept: {}, loops: [], layout: 6, nodes: [], node: 0, battle: null, speed: 4 };
    input = { region: 'sinnoh', boss: 25, date: native.Raids.dateKey(now), mine: [...s.team],
      allies: [445, 376, 130, 143].map((id, i) => ({ id, uid: `bot-${i}`, level: 100, xp: 0, bot: true, statMult: .85 })),
      weather: native.Raids.sceneOf(25, 'sinnoh', native.Raids.dateKey(now)).weather || null, source: 'configured' };
  });
  it('强队可击倒首领，成功率不被首领的低捕获率压低，且有抽样区间', async () => {
    const raw = JSON.stringify(s), previous = JSON.stringify(input), progress: number[] = [];
    const report = await predictRaid(source, raw, now, input, 32, n => progress.push(n));
    expect(report.wins).toBe(32); expect(report.win.mean).toBe(1); expect(report.win.low).toBeLessThan(1); expect(report.win.high).toBe(1);
    expect(report.team).toHaveLength(6); expect(report.team.filter(m => !m.ally)).toHaveLength(2);
    expect(progress.at(-1)).toBe(32); expect(JSON.stringify(s)).toBe(raw); expect(JSON.stringify(input)).toBe(previous);
  });
  it('弱队可能在道中失败，不能只模拟满血首领战', async () => {
    const weak = structuredClone(s), group = structuredClone(input);
    for (const m of weak.mons) { m.id = 129; m.level = 1; m.rank = 0; m.shiny = false; }
    for (const m of group.allies) { m.id = 129; m.level = 1; m.statMult = .85; }
    const report = await predictRaid(source, JSON.stringify(weak), now, group, 8);
    expect(report.wins).toBe(0); expect(report.win.mean).toBe(0); expect(report.win.high).toBeGreaterThan(0);
  });
  it('与未改写原引擎的完整道中＋首领结算逐种子一致', async () => {
    const trials = 16, teamSave = structuredClone(s), group = structuredClone(input);
    for (const m of teamSave.mons) { m.rank = 3; m.shiny = false; }
    group.boss = 130; group.weather = native.Raids.sceneOf(130, group.region, group.date).weather || null;
    const report = await predictRaid(source, JSON.stringify(teamSave), now, group, trials, () => {}, seed);
    expect(report.wins).toBeGreaterThan(0); expect(report.wins).toBeLessThan(trials);
    let wins = 0, allyMoves = 0, enemyMoves = 0;
    for (let i = 0; i < trials; i++) {
      const t = referenceEngine(source, now, (seed + Math.imul(i + 1, 2654435761)) >>> 0, ['Raids', 'LegendZones']), g = t.Game, copy = structuredClone(teamSave);
      copy.raids = { allies: structuredClone(group.allies), done: {}, last: [], bots: {}, pick: {}, byBoss: {}, botsV: 3, timesV: 1, pityV: 1, paceV: 1 };
      copy.adv.event = { raid: true, reg: group.region, date: group.date, id: group.boss, seq: `R:${group.region}:${group.date}`, level: t.CONFIG.RAID.LEVEL, back: 65, loops: 0 };
      let won = false;
      g.sandbox(copy, () => {
        copy.adv.nodes = t.Raids.buildRun(copy.adv.event); g.healTeam();
        expect(copy.adv.nodes.map((n: any) => n.type)).toEqual(['wild', 'trainer', 'wild', 'trainer', 'heal', 'static']);
        expect(g.teamMons().map((m: any) => m.uid)).toEqual([...group.mine, ...group.allies.map(m => m.uid)]);
        for (let step = 0; step < 20000; step++) {
          const boss = !!copy.adv.battle?.raid, events = t.Adventure.step();
          for (const e of events) if (e.type === 'attack' && !e.zoneFollow) {
            if (e.side === 'ally') allyMoves++; else enemyMoves++;
          }
          if (boss && events.some((e: any) => e.type === 'victory' && e.kind === 'static')) { won = true; break; }
          if (events.some((e: any) => e.type === 'defeat')) break;
        }
      });
      if (won) wins++;
    }
    expect(report.wins).toBe(wins);
    expect(report.moves.ally.mean).toBeCloseTo(allyMoves / trials, 10);
    expect(report.moves.enemy.mean).toBeCloseTo(enemyMoves / trials, 10);
    expect(report.moves.total.mean).toBeCloseTo((allyMoves + enemyMoves) / trials, 10);
    expect(report.expectedClearMoves).toBeCloseTo((allyMoves + enemyMoves) / wins, 10);
  }, 30000);
  it('缺少队友、重复参战 UID、天气不一致与跨日快照均拒绝推算', async () => {
    const raw = JSON.stringify(s);
    await expect(predictRaid(source, raw, now, { ...input, allies: [] }, 1)).rejects.toThrow('不完整');
    await expect(predictRaid(source, raw, now, { ...input, allies: [{ ...input.allies[0], uid: String(input.mine[0]) }] }, 1)).rejects.toThrow('无效');
    await expect(predictRaid(source, raw, now, { ...input, weather: 'snow' }, 1)).rejects.toThrow('天气与快照不一致');
    await expect(predictRaid(source, raw, now, { ...input, date: '2026-11-03' }, 1)).rejects.toThrow('快照已失效');
  });
  it('好友顺序未知时穷举两种真实阵容顺序，不猜概率权重', async () => {
    const raw = JSON.stringify(s), alternateAllies = [...input.allies.slice(2), ...input.allies.slice(0, 2)], progress: number[][] = [];
    const report = await predictRaid(source, raw, now, { ...input, alternateAllies }, 4, (done, total) => progress.push([done, total]));
    expect(report.orderResults).toHaveLength(2);
    expect(report.win.mean).toBe(Math.min(...report.orderResults!.map(r => r.mean)));
    expect(report.win.low).toBe(Math.min(...report.orderResults!.map(r => r.low)));
    expect(report.win.high).toBe(Math.max(...report.orderResults!.map(r => r.high)));
    expect(progress.at(-1)).toEqual([8, 8]);
    expect(JSON.stringify(s)).toBe(raw);
  });
});
