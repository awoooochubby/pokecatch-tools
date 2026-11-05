import { isolatedEngine, type Vendor } from '../simulation/isolated';
import { Moments, wilson } from '../simulation/statistics';
import { pokemonName } from '../core/pokemon';
import type { RaidInput, RaidReport } from './types';
import { expectedClearMoves } from './time';

class Victory extends Error {}
export async function predictRaid(source: string, raw: string, now: number, input: RaidInput, trials = 512,
  progress: (done: number, total: number) => void = () => {}, baseSeed = 8349271): Promise<RaidReport> {
  return (await createRaidRunner(source, raw, now))(input, trials, progress, baseSeed);
}

/** One private engine per search; fresh native save, clock and RNG per trial. */
export async function createRaidRunner(source: string, raw: string, now: number) {
  let seed = 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  let allyMoves = 0, enemyMoves = 0;
  const { t, setTime } = await isolatedEngine(source, now, random, event => {
    // Native zoneFollow events are extra victims of one AoE animation. Misses,
    // status moves, counters and rage each count as one move when animated.
    if (event.type === 'attack' && !event.zoneFollow) {
      if (event.side === 'ally') allyMoves++; else enemyMoves++;
    }
    return event;
  }, ['Raids', 'LegendZones']);
  const g = t.Game, a = t.Adventure, cfg = t.CONFIG.RAID, original = JSON.parse(raw);
  async function run(input: RaidInput, trials = 512, progress: (done: number, total: number) => void = () => {}, baseSeed = 8349271): Promise<RaidReport> {
    if (!Number.isInteger(trials) || trials < 1 || trials > 4096) throw new Error('模拟次数应为 1–4096');
    if (input.alternateAllies) {
      const signature = (mons: typeof input.allies) => JSON.stringify([...mons].sort((a, b) => a.uid.localeCompare(b.uid)));
      if (signature(input.allies) !== signature(input.alternateAllies)) throw new Error('备选出场顺序的参战成员不一致');
      const first = await run({ ...input, alternateAllies: undefined }, trials, done => progress(done, trials * 2), baseSeed);
      const second = await run({ ...input, allies: input.alternateAllies, alternateAllies: undefined }, trials, done => progress(trials + done, trials * 2), baseSeed);
      const worst = (first.expectedClearMoves ?? Infinity) >= (second.expectedClearMoves ?? Infinity) ? first : second;
      return { ...worst, input, orderResults: [first.win, second.win],
        win: { mean: worst.win.mean, low: Math.min(first.win.low, second.win.low), high: Math.max(first.win.high, second.win.high) } };
    }
    if (!Array.isArray(original.mons) || !Number.isInteger(original.adv?.chapter) || !t.STORY.REGIONS.some((r: Vendor) => r.key === input.region)
      || !g.DEX[input.boss] || input.date !== t.Raids.dateKey(now)) throw new Error('团体战快照已失效，请重新读取');
    if (!input.mine.length || input.mine.length > cfg.MINE || input.mine.some(uid => !original.mons.some((m: Vendor) => m.uid === uid))
      || !input.allies.length || input.allies.length > cfg.MINE * cfg.ALLIES) throw new Error('团体战参战队伍不完整');
    if (new Set([...input.mine.map(String), ...input.allies.map(m => String(m.uid))]).size !== input.mine.length + input.allies.length
      || input.allies.some(m => !g.DEX[m.id] || !Number.isFinite(m.level) || m.level < 1 || m.level > 100 || !m.bot)) throw new Error('团体战队友信息无效');
    for (const r of t.STORY.REGIONS) if (r.key) r.open = r.key === 'kanto' || original.travel?.to?.includes(r.key);
    // Native result() is reached only after the raid boss is defeated. Stop at
    // that outcome, irrespective of the subsequent 1% catch roll. This wrapper
    // lives exclusively in the disposable engine, never on the game page.
    t.Raids.result = () => { throw new Victory(); };
    const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
    let wins = 0; const ally = new Moments(), enemy = new Moments(), total = new Moments();
    for (let trial = 0; trial < trials; trial++) {
      seed = (baseSeed + Math.imul(trial + 1, 2654435761)) >>> 0; setTime(now);
      const s = Object.assign(g.freshState(), copy(original));
      s.stats = { ...g.freshState().stats, ...s.stats }; s.dex ||= {}; s.seen ||= {}; s.items ||= {}; s.buffs ||= {};
      s.eventTeams = { ...s.eventTeams, [`raid:${input.region}`]: [...input.mine] };
      s.raids = { ...s.raids, allies: copy(input.allies), botsV: 3, timesV: 1, pityV: 1, paceV: 1 };
      s.adv = { ...s.adv, zone: null, tower: null, pending: null, node: 0, battle: null,
        event: { raid: true, reg: input.region, date: input.date, id: input.boss, seq: `R:${input.region}:${input.date}`, level: cfg.LEVEL, back: s.adv.chapter, loops: 0 } };
      s.road = null;
      allyMoves = 0; enemyMoves = 0; let stepMs = 0;
      try {
        const outcome = g.sandbox(s, () => {
          s.adv.nodes = t.Raids.buildRun(s.adv.event);
          const weather = s.adv.nodes.find((n: Vendor) => n.raid)?.weather || null;
          if (weather !== input.weather) throw new Error('团体战天气与快照不一致，请重新读取；暂不能使用这套环境推算');
          g.healTeam();
          if (g.teamMons().length !== input.mine.length + input.allies.length) throw new Error('原生参战队伍与读取配置不一致，无法可靠预测');
          stepMs = Math.max(t.CONFIG.ACTION_MS, t.CONFIG.STEP_MS) / a.speed();
          for (let step = 0; step < 20000; step++) {
            setTime(now + step * stepMs); a.addTime(Math.max(t.CONFIG.ACTION_MS, t.CONFIG.STEP_MS));
            const events: Vendor[] = a.step();
            if (events.some(e => e.type === 'defeat')) return false;
            if (events.some(e => ['noTeam', 'waiting', 'raidOver'].includes(e.type))) throw new Error('原生团体战未能正常结算，无法可靠预测');
          }
          throw new Error('模拟触及行动上限，无法可靠给出胜率');
        });
        if (outcome) wins++;
      } catch (e) { if (e instanceof Victory) wins++; else throw e; }
      ally.add(allyMoves); enemy.add(enemyMoves); total.add(allyMoves + enemyMoves);
      if ((trial + 1) % 32 === 0 || trial + 1 === trials) { progress(trial + 1, trials); await new Promise(resolve => setTimeout(resolve, 0)); }
    }
    const team = [...input.mine.map(uid => original.mons.find((m: Vendor) => m.uid === uid)), ...input.allies]
      .map((m, i) => ({ id: m.id, name: pokemonName(m.id), level: Math.min(m.level, cfg.LEVEL), shiny: !!m.shiny, ally: i >= input.mine.length }));
    return { input, trials, wins, win: wilson(wins, trials), generatedAt: now, team, moves: { ally: ally.interval(), enemy: enemy.interval(), total: total.interval() },
      expectedClearMoves: expectedClearMoves(total.mean, wins / trials) };
  }
  return run;
}
