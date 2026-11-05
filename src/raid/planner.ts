import { isolatedEngine, type Vendor } from '../simulation/isolated';
import { createRaidRunner } from './engine';
import type { RaidEntry, RaidInput, RaidReport, RaidOffer } from './types';
import { validateTeam } from '../core/teams';
import { clearTimeScore } from './time';

export interface RaidSearchOptions { mode: 'balanced' | 'exhaustive'; ownLimit: number; }
export interface RaidCandidateAnalysis { key: string; picks: string[]; names?: string[]; baseline?: boolean; screening: RaidReport; validation?: RaidReport; }
export interface RaidPlan { region: string; boss: number; date: string; picks: string[]; report: RaidReport; candidates: number; context: string; analysis: RaidCandidateAnalysis[]; ownCount: number; allyPairCount: number; chosenKey: string;
  coverage: { mode: string; friends: number; npcs: number; friendsRead: boolean; box: number; pool: number; ownOrders: number; fullCross: number; testedCross: number; allyPairsTested: number; exhaustive: boolean }; }
export const raidIds: Record<string, number> = { kanto: -1, johto: -2, hoenn: -3, sinnoh: -4 };
export function raidPlanContext(raw: string, entry: RaidEntry) {
  const s = JSON.parse(raw);
  return JSON.stringify({ region: entry.region, boss: entry.boss, date: entry.date, done: entry.done,
    mons: s.mons.map((m: any) => [m.uid, m.id, m.level, m.rank, m.shiny, m.statMult]),
    ownTeam: s.eventTeams?.[`raid:${entry.region}`], picked: s.raids?.pick?.[entry.region],
    offers: entry.offers, bots: s.raids?.bots?.[entry.region], buffs: s.buffs, speed: s.adv.speed, autoSwitch: s.autoSwitch });
}
export function allyPairs(offers: RaidOffer[]) {
  const pairs: Array<{ keys: string[]; names: string[]; mons: RaidInput['allies']; alternate?: RaidInput['allies'] }> = [];
  for (let i = 0; i < offers.length; i++) for (let j = i + 1; j < offers.length; j++) {
    const a = offers[i], b = offers[j];
    const ordered = b.before.includes(a.key) ? [b, a] : [a, b];
    const unknown = !a.before.includes(b.key) && !b.before.includes(a.key);
    pairs.push({ keys: ordered.map(g => g.key), names: ordered.map(g => g.name), mons: ordered.flatMap(g => g.mons),
      alternate: unknown ? [...ordered[1].mons, ...ordered[0].mons] : undefined });
  }
  return pairs;
}
// Conservative interval for E[attempt moves]/P(win), used only to decide which
// candidates need fresh samples. It is not advertised as a ratio confidence CI.
const lowerCost = (r: RaidReport) => r.moves.total.low / r.win.high;
const upperCost = (r: RaidReport) => r.win.low > 0 ? r.moves.total.high / r.win.low : Infinity;
export async function optimizeRaid(source: string, raw: string, now: number, entry: RaidEntry, fixed: string[] | undefined,
  progress: (done: number, total: number) => void = () => {}, onCandidate: (candidate: RaidCandidateAnalysis) => void = () => {},
  options: RaidSearchOptions = { mode: 'balanced', ownLimit: 8 }): Promise<RaidPlan> {
  if (entry.done || !entry.boss) throw new Error('今日团战已结束或首领尚未揭晓');
  if (!['balanced', 'exhaustive'].includes(options.mode) || ![8, 16, 0].includes(options.ownLimit)) throw new Error('无效的搜索范围');
  const original = JSON.parse(raw);
  const { t } = await isolatedEngine(source, now, () => .5, undefined, ['Raids', 'LegendZones']);
  const g = t.Game, s = Object.assign(g.freshState(), structuredClone(original));
  if (entry.date !== t.Raids.dateKey(now)) throw new Error('团战已跨日，请重新读取');
  let own: string[][] = [], weather: string | null = null, poolSize = 0;
  g.sandbox(s, () => {
    s.adv = { ...s.adv, zone: null, tower: null, event: { raid: true, reg: entry.region, id: entry.boss, level: 100 } };
    weather = t.Raids.sceneOf(entry.boss, entry.region, entry.date).weather || null;
    if (fixed?.length) { validateTeam(original, fixed, 2); own = [[...fixed]]; poolSize = fixed.length; }
    else {
      const foe = { id: entry.boss, level: 100, boss: true };
      const pool = [...s.mons].sort((a: Vendor, b: Vendor) => t.Adventure.counterParts(b, foe).value - t.Adventure.counterParts(a, foe).value).slice(0, options.ownLimit || s.mons.length);
      poolSize = pool.length;
      const beings = new Map<string, number>();
      for (const mon of pool) { const key = String(g.beingOf(mon)); beings.set(key, (beings.get(key) || 0) + 1); }
      if (pool.length ** 2 - [...beings.values()].reduce((n, count) => n + count ** 2, 0) > 20000) throw new Error('己方合法顺序超过 20,000 种，请缩小候选范围');
      const native = t.Adventure.counterTeam(pool.map((m: Vendor) => ({ uid: String(m.uid), ...t.Adventure.counterParts(m, foe) })), 2);
      if (native.length) own.push(native);
      for (const a of pool) for (const b of pool) if (g.beingOf(a) !== g.beingOf(b)) own.push([String(a.uid), String(b.uid)]);
      if (pool.length === 1) own.push([String(pool[0].uid)]);
      const configured = entry.input?.mine;
      if (configured?.length && configured.length <= 2) own.push(configured.map(String));
      own = own.filter((ts, i) => own.findIndex(x => x.join('|') === ts.join('|')) === i);
    }
  });
  if (!own.length) throw new Error('没有可用的团战参战精灵');
  // Production callers always supply both native pickers. The NPC-only fallback
  // supports offline snapshots and is explicitly marked incomplete in results.
  const bots = original.raids?.bots?.[entry.region] || [];
  const offers: RaidOffer[] = entry.offers || bots.map((b: Vendor, i: number) => ({ ...b, friend: false, before: bots.slice(i + 1).map((x: Vendor) => x.key) }));
  const pairs = allyPairs(offers);
  if (!pairs.length) throw new Error('没有两名可用队友，请刷新原生团战列表');
  const fullCross = own.length * pairs.length;
  if (options.mode === 'exhaustive' && fullCross > 20000 || pairs.length > 10000) throw new Error(`搜索范围达 ${fullCross.toLocaleString()} 组，超出本次安全计算预算；请缩小己方候选范围或使用分轮搜索`);
  const maxScreen = options.mode === 'exhaustive' ? fullCross : Math.min(fullCross, pairs.length * 3 + own.length * 3);
  if (maxScreen > 20000) throw new Error(`本次预计比较多达 ${maxScreen.toLocaleString()} 组，超出计算预算；请缩小己方范围`);
  const run = await createRaidRunner(source, raw, now);
  const analysis: RaidCandidateAnalysis[] = [], seen = new Set<string>(), ownSeen = new Set<string>(), pairSeen = new Set<string>();
  let baseline: RaidCandidateAnalysis | undefined;
  const test = async (mine: string[], pair: typeof pairs[number]) => {
    const key = JSON.stringify([mine, pair.keys]);
    if (seen.has(key)) return;
    seen.add(key); ownSeen.add(mine.join('|')); pairSeen.add(pair.keys.join('|'));
    const input: RaidInput = { region: entry.region, boss: entry.boss, date: entry.date, mine, allies: pair.mons, alternateAllies: pair.alternate, weather, source: 'configured' };
    const report = await run(input, 128);
    const row: RaidCandidateAnalysis = { key: `candidate-${analysis.length + 1}`, picks: pair.keys, names: pair.names, screening: report };
    analysis.push(row); onCandidate(row); progress(analysis.length, maxScreen + 9);
  };
  // Baseline is always independently validated; it cannot disappear because it
  // ranked poorly in a short screening or fell outside the own-pool limit.
  if (entry.input && (!fixed?.length || JSON.stringify(entry.input.mine) === JSON.stringify(fixed))) {
    const keys: string[] = original.raids?.pick?.[entry.region] || [];
    const pair = pairs.find(p => p.keys.length === keys.length && p.keys.every(k => keys.includes(k)));
    if (pair) {
      await test(entry.input.mine.map(String), pair);
      baseline = analysis[0]; baseline.baseline = true; onCandidate(baseline);
    }
  }
  if (options.mode === 'exhaustive') {
    for (const mine of own) for (const pair of pairs) await test(mine, pair);
  } else {
    // Round 1: EVERY ally pair against the same native own baseline.
    for (const pair of pairs) await test(own[0], pair);
    const sorted = () => [...analysis].sort((a, b) => clearTimeScore(a.screening) - clearTimeScore(b.screening));
    const topPairs = sorted().filter((r, i, all) => all.findIndex(x => x.picks.join('|') === r.picks.join('|')) === i).slice(0, 3)
      .map(r => pairs.find(p => p.keys.join('|') === r.picks.join('|'))!);
    // Round 2: every legal own order in the declared pool, against top 3 pairs.
    for (const mine of own) for (const pair of topPairs) await test(mine, pair);
    const bestOwn = sorted().filter((r, i, all) => all.findIndex(x => x.screening.input.mine.join('|') === r.screening.input.mine.join('|')) === i).slice(0, 2).map(r => r.screening.input.mine.map(String));
    // Round 3: reopen EVERY ally pair after improving own members/order.
    for (const mine of bestOwn) for (const pair of pairs) await test(mine, pair);
  }
  const ranked = [...analysis].sort((a, b) => clearTimeScore(a.screening) - clearTimeScore(b.screening));
  const bestUpper = Math.min(...ranked.map(r => upperCost(r.screening)));
  const uncertain = ranked.filter(r => lowerCost(r.screening) <= bestUpper);
  // Include statistically competitive candidates up to the explicit 8-finalist
  // budget, plus the current setup. Same fresh seeds permit fair comparisons.
  const finalists = [...new Set([...ranked.slice(0, 3), ...uncertain.slice(0, 8), ...(baseline ? [baseline] : [])])];
  let completed = analysis.length;
  for (const row of finalists) {
    row.validation = await run(row.screening.input, 1024, () => {}, 9835491);
    onCandidate(row); progress(++completed, analysis.length + finalists.length);
  }
  finalists.sort((a, b) => clearTimeScore(a.validation!) - clearTimeScore(b.validation!));
  const best = finalists[0]; progress(completed, completed);
  return { region: entry.region, boss: entry.boss, date: entry.date, picks: best.picks, report: best.validation!, candidates: analysis.length,
    context: raidPlanContext(raw, entry), analysis, ownCount: ownSeen.size, allyPairCount: pairs.length, chosenKey: best.key,
    coverage: { mode: options.mode, friends: offers.filter(o => o.friend).length, npcs: offers.filter(o => !o.friend).length, friendsRead: !!entry.offers,
      box: original.mons.length, pool: poolSize, ownOrders: own.length, fullCross, testedCross: seen.size, allyPairsTested: pairSeen.size, exhaustive: seen.size >= fullCross && options.mode === 'exhaustive' } };
}
