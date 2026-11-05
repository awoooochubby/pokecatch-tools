import { isolatedEngine, type Vendor } from '../simulation/isolated';
import { wilson } from '../simulation/statistics';
import { huntContext, validateTeam } from './teams';
import type { HuntJob, HuntPrediction } from './types';

class Victory extends Error {}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
// Every battle, including the journey and the boss's rage/counter moves, runs
// inside the same audited native Adventure engine as the live game.
export async function predictHunt(source: string, raw: string, now: number, job: HuntJob, team: string[], trials = 256,
  progress: (done: number, total: number) => void = () => {}, baseSeed = 294831) : Promise<HuntPrediction> {
  if (job.kind === 'raid') throw new Error('团战需要当天队友，轮到任务时使用团战配队模拟');
  if (!Number.isInteger(trials) || trials < 1 || trials > 4096) throw new Error('模拟次数应为 1–4096');
  const original = JSON.parse(raw); validateTeam(original, team);
  let seed = baseSeed >>> 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const dead = new Set<string>();
  const { t, setTime } = await isolatedEngine(source, now, random, e => {
    if (e.hp <= 0) { if (e.type === 'attack' && e.side === 'enemy' && e.target) dead.add(String(e.target));
      else if (e.type === 'status' && e.side === 'ally') dead.add(String(e.uid)); }
    return e;
  }, ['Roaming', 'LegendZones']);
  const g = t.Game, a = t.Adventure;
  t.UI = { fmt: (n: number) => String(n) };
  for (const r of t.STORY.REGIONS) if (r.key) r.open = r.key === 'kanto' || original.travel?.to?.includes(r.key);
  // Read real positions only. No simulated future roaming relocations.
  const positions = original.roam?.at || {};
  t.Roaming.here = (ch: number) => Object.entries(positions).map(([id, p]): Vendor => ({ id: +id, ...(p as Vendor) })).find(p => p.ch === ch && p.until > now && t.Roaming.free(p.id)) || null;
  t.Roaming.at = (ch: number) => t.Roaming.here(ch)?.id ?? null;
  t.Roaming.weatherAt = (ch: number) => t.CONFIG.ROAMING.WEATHER[t.Roaming.at(ch)] || null;
  let targetIndex = -1, wins = 0, reached = 0, loss = 0;
  const earn = g.earn;
  g.earn = (...args: unknown[]) => {
    const b = g.S.adv.battle;
    if (g.S.adv.node === targetIndex && b?.enemies?.some((m: Vendor) => m.id === job.id) && b.enemies.every((m: Vendor) => g.curHp(m) <= 0)) throw new Victory();
    return earn(...args);
  };
  for (let trial = 0; trial < trials; trial++) {
    seed = (baseSeed + Math.imul(trial + 1, 2654435761)) >>> 0; setTime(now); dead.clear();
    const s = Object.assign(g.freshState(), copy(original));
    s.stats = { ...g.freshState().stats, ...s.stats }; s.dex ||= {}; s.items ||= {}; s.buffs ||= {}; s.seen ||= {};
    s.adv = { ...s.adv, event: null, zone: null, tower: null, pending: null, battle: null, node: 0, paused: false, loops: [] };
    s.team = team.map(uid => s.mons.find((m: Vendor) => String(m.uid) === uid).uid); s.road = null;
    const result = g.sandbox(s, () => {
      if (team.some(uid => g.can(g.getMon(uid), 'region', job.destination.region))) throw new Error('所选队伍受地区限制');
      if (job.kind === 'zone') {
        a.buildChapter(job.destination.chapter);
        s.eventTeams = { ...s.eventTeams, [`zone:${job.destination.zone}`]: [...s.team] };
        if (!a.startZone(job.destination.zone) || s.adv.zone?.riddle) throw new Error('神兽地点尚未开放或需要手动解谜');
      } else {
        a.buildChapter(job.destination.chapter); g.healTeam();
      }
      const nodes = s.adv.nodes;
      const candidates = nodes.flatMap((n: Vendor, i: number) => {
        if (job.kind === 'zone' || job.destination.staticId != null) return n.type === 'static' && n.id === job.id ? [i] : [];
        if (job.kind === 'roaming') return n.roamer === job.id ? [i] : [];
        return n.type === 'wild' && !n.roamer && job.destination.habitats?.includes(a.habitatKey(n) || n.name)
          && a.zonePool(n, job.destination.chapter, false, null, true, true).some((p: Vendor) => p.id === job.id && p.on && p.pct > 0) ? [i] : [];
      });
      // Conservative placement: include every preceding encounter before the
      // last possible target node, instead of assuming a freshly healed duel.
      targetIndex = candidates.at(-1) ?? -1;
      if (targetIndex < 0) throw new Error('本轮未生成目标节点，请刷新位置／天气后重试');
      const stepMs = Math.max(t.CONFIG.ACTION_MS, t.CONFIG.STEP_MS) / a.speed();
      let didReach = false;
      try {
        for (let step = 0; step < 20000; step++) {
          setTime(now + step * stepMs); a.addTime(Math.max(t.CONFIG.ACTION_MS, t.CONFIG.STEP_MS));
          if (!s.adv.battle && s.adv.node === targetIndex && !didReach) {
            didReach = true; reached++;
            if (job.kind === 'wild' || job.kind === 'weather' && job.destination.staticId == null) {
              // Rejection sampling of native spawns conditions ONLY the target
              // encounter on its species. Native level, shiny, sleep, HP scaling
              // and battle formation remain unchanged; no real save is touched.
              const before = copy(s);
              let found = false;
              for (let attempt = 0; attempt < 50000; attempt++) {
                Object.assign(s, copy(before)); a.step();
                if (s.adv.battle?.enemies?.[0]?.id === job.id) { found = true; break; }
              }
              if (!found) throw new Error('目标原生遭遇概率过低或环境已变化，无法可靠模拟');
            }
          }
          const events: Vendor[] = a.step();
          if (events.some(e => e.type === 'defeat' || e.type === 'fled' && e.enemy?.hp > 0)) return false;
          if (s.adv.pending) throw new Error('道中有尚未处理的赠礼／解谜，请在游戏中处理后再模拟');
          if (events.some(e => ['noTeam', 'waiting'].includes(e.type)) || s.adv.chapter !== job.destination.chapter && job.kind !== 'zone' || s.adv.node > targetIndex) throw new Error('目标战斗未正常结算，无法可靠预测');
        }
        throw new Error('模拟触及行动上限，无法可靠预测');
      } catch (e) { if (e instanceof Victory) return true; throw e; }
      finally { loss += dead.size; }
    });
    if (result) wins++;
    if ((trial + 1) % 16 === 0 || trial + 1 === trials) { progress(trial + 1, trials); await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  return { id: job.id, team, destination: job.destination, trials, win: wilson(wins, trials), reach: wilson(reached, trials), loss: loss / trials,
    encounters: reached, generatedAt: now, context: huntContext(raw, team, job) };
}
