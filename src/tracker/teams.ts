import type { HuntJob, TrackerPrefs } from './types';
export { validateTeam } from '../core/teams';
export function huntTeam(save: any, prefs: TrackerPrefs, job: HuntJob): string[] {
  const chosen = prefs.teams?.[job.id];
  if (chosen?.length) return [...chosen];
  const independent = job.kind === 'zone' ? save.eventTeams?.[`zone:${job.destination.zone}`] : null;
  return (independent?.length ? independent : prefs.defaultTeam?.length ? prefs.defaultTeam : save.team).map(String);
}
export function huntContext(raw: string, team: string[], job: HuntJob) {
  const s = JSON.parse(raw);
  return JSON.stringify({ id: job.id, kind: job.kind, destination: job.destination, team: team.map(uid => {
    const m = s.mons.find((m: any) => String(m.uid) === uid);
    return m && { uid, id: m.id, level: m.level, xp: m.xp, rank: m.rank, shiny: m.shiny, statMult: m.statMult };
  }), buffs: s.buffs, buddy: s.buddy, autoSwitch: s.autoSwitch, badges: s.adv.badges, gifts: s.adv.gifts, speed: s.adv.speed,
  // Weather and roaming positions are part of the destination; never reuse a
  // readiness result for a moved target or a different time window.
  cap: s.adv.unlocked, link: s.link?.side });
}
export function completionQueue(targets: import('./types').HuntTarget[], existing: number[]) {
  return [...new Set([...existing, ...targets.filter(t => !t.owned && t.dexMissing !== false && t.destinations.length).map(t => t.id)])];
}
