import { isolatedEngine, type Vendor } from './isolated';
import { ENGINE_HASH } from './program';
import { Moments, wilson } from './statistics';
import type { ForecastCatalog, ForecastOptions, ForecastReport, ForecastRow } from './forecast-types';
import type { Estimate } from './types';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const FORECAST_BUDGET = 8192;
export interface RateSample { xp: number; ms: number }
interface Attempt { complete: boolean; ms: number; steps: number; battles: number; faints: number;
  xp: Record<string, number>; levels: Record<string, number>; capped: Record<string, boolean> }
// A ratio of totals, including failures. Mean(XP/time) would over-weight short
// losing attempts and can recommend a different map than total XP / total time.
export function forecastRate(samples: RateSample[]): Estimate {
  const ms = samples.reduce((sum, s) => sum + s.ms, 0), xp = samples.reduce((sum, s) => sum + s.xp, 0);
  if (!samples.length || ms <= 0) throw new Error('模拟耗时无效');
  const ratio = xp / ms, residual = new Moments();
  samples.forEach(s => residual.add(s.xp - ratio * s.ms));
  const radius = samples.length > 1 ? 1.96 * Math.sqrt(residual.m2 / (samples.length - 1) / samples.length) / (ms / samples.length) : Infinity;
  return { mean: ratio * 60000, low: Math.max(0, (ratio - radius) * 60000), high: (ratio + radius) * 60000 };
}

export async function createForecast(source: string, rawSave: string, now: number) {
  const original: Vendor = JSON.parse(rawSave);
  if (!Array.isArray(original.mons) || !Array.isArray(original.team) || !Number.isInteger(original.adv?.chapter)) throw new Error('请先进入普通冒险并等待保存');
  if (original.adv.event || original.adv.zone || original.adv.tower) throw new Error('请回到普通冒险后再比较刷图效率');
  let seed = 1, hp = new Map<string, number>(), recording = false, faints = 0;
  const isolated = await isolatedEngine(source, now, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }, event => {
    if (recording && typeof event.hp === 'number') {
      const uid = String(event.type === 'attack' ? event.target : event.uid), previous = hp.get(uid);
      if (previous !== undefined) { if (previous > 0 && event.hp <= 0) faints++; hp.set(uid, event.hp); }
    }
    return event;
  });
  const { t } = isolated, g = t.Game, a = t.Adventure, cfg = t.CONFIG;
  for (const key of original.travel?.to || []) { const r = t.STORY.REGIONS.find((r: Vendor) => r.key === key); if (r) r.open = true; }
  const region = t.STORY.regionOf(original.adv.chapter);
  if (!region?.open) throw new Error('存档缺少当前地区解锁信息');
  function clean() {
    const s = Object.assign(g.freshState(), clone(original));
    s.stats = { ...g.freshState().stats, ...s.stats }; s.buffs ||= {}; s.items ||= {}; s.dex ||= {}; s.seen ||= {}; s.seenShiny ||= {}; s.trainer ||= {};
    s.adv.gifts ||= {}; s.adv.badges ||= []; s.adv.kept ||= {}; s.adv.loops ||= []; s.adv.layout ??= 6; s.adv.paused = false;
    return s;
  }
  const base = clean();
  let catalog!: ForecastCatalog;
  g.sandbox(base, () => {
    if (g.currentRegion().key !== region.key) throw new Error('跨地区钱包切换暂未适配，请在当前钱包地区比较地图');
    const team = g.teamMons();
    if (!team.length || team.length > cfg.TEAM_SIZE) throw new Error('当前没有可用的出战队伍');
    for (const m of team) if (!g.DEX[m.id] || g.can(m) || m.level > g.capFor(m)) throw new Error('出战队伍包含未知、不可用或超过地区等级上限的精灵');
    const speedValue = +base.adv.speed || 1;
    base.adv.speed = cfg.SPEEDS.includes(speedValue) ? speedValue : Math.max(1, ...cfg.SPEEDS.filter((n: number) => n <= speedValue));
    catalog = { version: ENGINE_HASH.slice(0, 10), capturedAt: now, current: base.adv.chapter,
      chapters: t.STORY.CHAPTERS.flatMap((ch: Vendor, id: number) => id <= (base.adv.unlocked || 0) && t.STORY.regionOf(id).key === region.key ? [{ id, name: ch.name }] : []),
      team: team.map((m: Vendor) => ({ uid: String(m.uid), id: m.id, level: m.level, xp: m.xp, cap: g.capFor(m), hp: g.curHp(m), maxHp: g.maxHp(m), status: m.status || '', rank: g.rankOf(m) })),
      autoSwitch: base.autoSwitch !== false, speed: a.speed(), stepMs: Math.max(cfg.ACTION_MS, cfg.STEP_MS) / a.speed(), buddy: base.buddy?.uid == null ? null : String(base.buddy.uid), xpBoost: g.buffMult('xp') };
  });
  let ledger: Record<string, number> = {};

  function attempt(chapter: number, start: ForecastOptions['start']): Attempt {
    const s = clean(), party = catalog.team.map(m => s.mons.find((mon: Vendor) => String(mon.uid) === m.uid));
    s.team = party.map((m: Vendor) => m.uid); s.road = [...s.team];
    ledger = Object.fromEntries(catalog.team.map(m => [m.uid, 0])); hp = new Map(); faints = 0;
    let steps = 0, battles = 0, complete = false;
    isolated.setTime(now);
    return g.sandbox(s, () => {
      a.buildChapter(chapter);
      // Map selection normally heals. Restore the requested initial state after
      // building; centers encountered during the route still heal natively.
      for (const m of party) {
        const old = base.mons.find((old: Vendor) => String(old.uid) === String(m.uid));
        for (const key of Object.keys(m)) delete m[key];
        Object.assign(m, clone(old));
        if (start === 'full') { t.STATUS.clear(m); m.hp = g.maxHp(m); }
        hp.set(String(m.uid), g.curHp(m));
      }
      recording = true;
      try {
        for (; steps < 20000;) {
          if (s.adv.pending) throw new Error('该图含需手动确认的赠送或选择，请先在游戏中完成');
          if (!s.adv.battle && s.adv.node >= s.adv.nodes.length) { complete = true; steps++; break; }
          // Native buddy/duplicate rewards call private XP helpers directly;
          // comparing the entire step also captures those and cap overflow.
          const before = party.map((m: Vendor) => ({ level: m.level, xp: m.xp }));
          const events: Vendor[] = a.step(); steps++;
          for (const [i, m] of party.entries()) {
            let actual = m.xp - before[i].xp;
            for (let level = before[i].level; level < m.level; level++) actual += g.xpForNext(level, m);
            if (!Number.isSafeInteger(actual) || actual < 0 || m.level < before[i].level) throw new Error('实际经验无法确认，已停止该图模拟');
            ledger[String(m.uid)] += actual;
          }
          isolated.setTime(now + steps * catalog.stepMs);
          a.addTime(Math.max(cfg.ACTION_MS, cfg.STEP_MS));
          for (const event of events) {
            if (event.type === 'battleStart') battles++;
            if (['defeat', 'chapterEnd'].includes(event.type)) { complete = event.type === 'chapterEnd'; return finish(); }
            if (event.type === 'waiting' || event.type === 'gift') throw new Error('该图含需手动确认的赠送或选择，请先在游戏中完成');
            if (event.roam || event.raid || event.type === 'zoneLoop') throw new Error('该图出现尚未适配的特殊首领，已停止估算');
          }
          for (const m of party) hp.set(String(m.uid), g.curHp(m));
        }
        if (!complete) throw new Error('该图超过行动上限，未完成样本不参与排名');
        return finish();
      } finally { recording = false; }
      function finish() {
        return { complete, ms: steps * catalog.stepMs, steps, battles, faints, xp: { ...ledger },
          levels: Object.fromEntries(party.map((m: Vendor, i: number) => [String(m.uid), m.level - catalog.team[i].level])),
          capped: Object.fromEntries(party.map((m: Vendor) => [String(m.uid), g.capped(m)])) };
      }
    });
  }
  async function run(options: ForecastOptions, progress: (completed: number, total: number, row?: ForecastRow) => void): Promise<ForecastReport> {
    const opts = clone(options);
    if (!Array.isArray(opts.chapters) || !opts.chapters.length || opts.chapters.length > 16 || new Set(opts.chapters).size !== opts.chapters.length
      || opts.chapters.some(id => !catalog.chapters.some(ch => ch.id === id))) throw new Error('请选择当前地区已解锁的地图，最多 16 张');
    if (!Number.isInteger(opts.trials) || opts.trials < 128 || opts.trials > 2048 || opts.chapters.length * opts.trials > FORECAST_BUDGET) throw new Error('模拟次数需为 128–2048，合计最多 8192 轮');
    if (!Number.isInteger(opts.seed) || !['full', 'current'].includes(opts.start)) throw new Error('模拟参数无效');
    const report: ForecastReport = { catalog: clone(catalog), options: opts, rows: [], generatedAt: now, assumptions: [
      '无需实战采集；随机遭遇、命中、暴击等在独立状态中重复模拟，显示近似 95% 抽样区间。',
      '从所选章开头模拟一轮，实际先后手、招式、状态、治疗、升级、等级上限、伙伴和捕获奖励采用原引擎。只统计快照出战成员的实得经验，不自动确认进化或使用道具。',
      '预计耗时采用在线非冒险页面的标准行动节奏 max(ACTION_MS, STEP_MS) / 游戏速度；不等同于前台动画的实测秒数，不包含手动停顿和首次图鉴弹窗。',
      '失败尝试在原引擎回城治疗后结束，其已得经验和耗时均计入；XP/分采用总经验/总时间，非只取通关样本。',
      '一轮结束前停止，不提高快照的章节进度上限；每个样本从相同等级、经验、队伍顺序和加成开始，独立模拟该轮中途升级。',
      '模拟时钟按标准节奏推进，包含增益到期和昼夜天气变化。置信区间仅含抽样误差，不含动画和计时模型误差。',
      '仅支持当前地区已解锁的普通章节；未接入漫游首领生成和其他系统的被动收益。需要手动确认的赠送或选择会标记该图暂不能计算，不按零收益参与排名。',
    ] };
    let completed = 0; const total = opts.chapters.length * opts.trials;
    for (const chapter of opts.chapters) {
      const xp = new Moments(), seconds = new Moments(), steps = new Moments(), battles = new Moments(), faints = new Moments(), rates: RateSample[] = [];
      const members = Object.fromEntries(catalog.team.map(m => [m.uid, { xp: new Moments(), levels: new Moments(), rates: [] as RateSample[], capped: 0 }]));
      let wins = 0, error = '';
      for (let i = 0; i < opts.trials; i++) {
        seed = (opts.seed + Math.imul(i + 1, 2654435761)) >>> 0;
        try {
          const r = attempt(chapter, opts.start), totalXp = Object.values(r.xp).reduce((a, b) => a + b, 0);
          wins += +r.complete; xp.add(totalXp); seconds.add(r.ms / 1000); steps.add(r.steps); battles.add(r.battles); faints.add(r.faints); rates.push({ xp: totalXp, ms: r.ms });
          for (const [uid, m] of Object.entries(members)) { m.xp.add(r.xp[uid]); m.levels.add(r.levels[uid]); m.rates.push({ xp: r.xp[uid], ms: r.ms }); m.capped += +r.capped[uid]; }
        } catch (e) { error = (e as Error).message; break; }
        if ((i + 1) % 16 === 0) { progress(completed + i + 1, total); await new Promise(resolve => setTimeout(resolve, 0)); }
      }
      completed += opts.trials;
      const empty = { mean: 0, low: 0, high: 0 }, name = catalog.chapters.find(ch => ch.id === chapter)!.name;
      const row: ForecastRow = error ? { chapter, name, trials: xp.n, error, complete: empty, seconds: empty, steps: empty, battles: empty, faints: empty, xp: empty, rate: empty, members: {} }
        : { chapter, name, trials: opts.trials, complete: wilson(wins, opts.trials), seconds: seconds.interval([0, Infinity]), steps: steps.interval([0, Infinity]), battles: battles.interval([0, Infinity]),
          faints: faints.interval([0, Infinity]), xp: xp.interval([0, Infinity]), rate: forecastRate(rates),
          members: Object.fromEntries(Object.entries(members).map(([uid, m]) => [uid, { xp: m.xp.interval([0, Infinity]), levels: m.levels.interval([0, Infinity]), capped: m.capped / opts.trials, rate: forecastRate(m.rates) }])) };
      report.rows.push(row); progress(completed, total, row); await new Promise(resolve => setTimeout(resolve, 0));
    }
    return report;
  }
  return { catalog, run };
}
