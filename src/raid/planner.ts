import { isolatedEngine, type Vendor } from '../simulation/isolated';
import { predictRaid } from '../raid/engine';
import type { RaidEntry, RaidInput, RaidReport } from '../raid/types';
import { validateTeam } from '../core/teams';
import { clearTimeScore } from './time';

export interface RaidPlan { region: string; boss: number; date: string; picks: string[]; report: RaidReport; candidates: number; context: string; }
export const raidIds: Record<string, number> = { kanto: -1, johto: -2, hoenn: -3, sinnoh: -4 };
export function raidPlanContext(raw: string, entry: RaidEntry) {
  const s = JSON.parse(raw);
  return JSON.stringify({ region: entry.region, boss: entry.boss, date: entry.date, done: entry.done,
    mons: s.mons.map((m: any) => [m.uid, m.id, m.level, m.rank, m.shiny, m.statMult]),
    bots: s.raids?.bots?.[entry.region], buffs: s.buffs, speed: s.adv.speed, autoSwitch: s.autoSwitch });
}
export async function optimizeRaid(source: string, raw: string, now: number, entry: RaidEntry, fixed: string[] | undefined,
  progress: (done: number, total: number) => void = () => {}) : Promise<RaidPlan> {
  if (entry.done || !entry.boss) throw new Error('今日团战已结束或首领尚未揭晓');
  const original = JSON.parse(raw);
  const { t } = await isolatedEngine(source, now, () => .5, undefined, ['Raids', 'LegendZones']);
  const g = t.Game, s = Object.assign(g.freshState(), structuredClone(original));
  if (entry.date !== t.Raids.dateKey(now)) throw new Error('团战已跨日，请重新读取');
  let own: string[][] = [], pairs: Array<{ keys: string[]; mons: RaidInput['allies'] }> = [];
  let weather: string | null = null;
  g.sandbox(s, () => {
    s.adv = { ...s.adv, zone: null, tower: null, event: { raid: true, reg: entry.region, id: entry.boss, level: 100 } };
    weather = t.Raids.sceneOf(entry.boss, entry.region, entry.date).weather || null;
    const foe = { id: entry.boss, level: 100, boss: true };
    const score = (m: Vendor) => t.Adventure.counterParts(m, foe).value;
    if (fixed?.length) { validateTeam(original, fixed, 2); own = [[...fixed]]; }
    else {
      const pool = [...s.mons].sort((a: Vendor, b: Vendor) => score(b) - score(a)).slice(0, 8);
      const native = t.Adventure.counterTeam(pool.map((m: Vendor) => ({ uid: String(m.uid), ...t.Adventure.counterParts(m, foe) })), 2);
      if (native.length) own.push(native);
      const configured = original.eventTeams?.[`raid:${entry.region}`];
      if (configured?.length && configured.length <= 2 && configured.every((uid: string) => original.mons.some((m: Vendor) => String(m.uid) === String(uid)))) own.push(configured.map(String));
      for (let i = 0; i < Math.min(3, pool.length); i++) for (let j = i + 1; j < Math.min(4, pool.length); j++) {
        if (g.beingOf(pool[i]) === g.beingOf(pool[j])) continue;
        own.push([String(pool[i].uid), String(pool[j].uid)]);
      }
      own = own.filter((ts, i) => own.findIndex(x => x.join('|') === ts.join('|')) === i).slice(0, 4);
    }
    const bots = original.raids?.bots?.[entry.region] || [];
    if (bots.length < 2) throw new Error('原生团战 NPC 队友尚未生成，请重新读取今日团战');
    const candidates = bots.map((b: Vendor, i: number) => ({ ...b, index: i, value: (b.mons || []).reduce((n: number, m: Vendor) => n + score(m), 0) }))
      .sort((a: Vendor, b: Vendor) => b.value - a.value).slice(0, 3);
    for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
      const groups = [candidates[i], candidates[j]].sort((a, b) => a.index - b.index);
      pairs.push({ keys: groups.map(b => b.key), mons: groups.flatMap(b => structuredClone(b.mons)) });
    }
  });
  if (!own.length) throw new Error('没有可用的团战参战精灵');
  const choices: Array<{ report: RaidReport; keys: string[] }> = [];
  const total = own.length * pairs.length + Math.min(3, own.length * pairs.length);
  for (const mine of own) for (const pair of pairs) {
    const input: RaidInput = { region: entry.region, boss: entry.boss, date: entry.date, mine, allies: pair.mons, weather, source: 'configured' };
    choices.push({ keys: pair.keys, report: await predictRaid(source, raw, now, input, 32) }); progress(choices.length, total);
  }
  choices.sort((a, b) => clearTimeScore(a.report) - clearTimeScore(b.report));
  // Re-evaluate the fastest three with fresh seeds. The cost is animated moves
  // from both sides including failed runs: E[moves to win] = E[attempt]/P(win).
  const finalists = [];
  for (const [index, candidate] of choices.slice(0, 3).entries()) {
    finalists.push({ keys: candidate.keys, report: await predictRaid(source, raw, now, candidate.report.input, 512, () => {}, 9835491 + index * 104729) });
    progress(choices.length + index + 1, total);
  }
  finalists.sort((a, b) => clearTimeScore(a.report) - clearTimeScore(b.report));
  const best = finalists[0], report = best.report;
  progress(total, total);
  return { region: entry.region, boss: entry.boss, date: entry.date, picks: best.keys, report, candidates: choices.length, context: raidPlanContext(raw, entry) };
}
