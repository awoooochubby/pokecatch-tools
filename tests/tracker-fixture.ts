import { referenceEngine } from './reference-engine';
export function trackerFixture(source: string, now: number) {
  const t = referenceEngine(source, now), s = t.Game.freshState();
  s.travel = { to: ['johto', 'hoenn', 'sinnoh'] };
  s.mons = [445, 376, 143, 130, 392, 462].map((id, i) => ({ id, uid: `test-${i}`, level: 100, xp: 0, reg: 'sinnoh' }));
  s.team = s.mons.map((m: any) => m.uid); s.road = [...s.team];
  s.adv = { chapter: 0, unlocked: 65, runs: 100, badges: ['Maître Johto', 'Maître Hoenn', 'Maître Sinnoh'],
    gifts: {}, kept: {}, loops: [], layout: 6, speed: 4, nodes: [], node: 0, battle: null, pending: null };
  s.roam = { at: { 243: { ch: 17, until: now + 600000 }, 244: { ch: 18, until: now + 600000 } }, caught: [] };
  return s;
}
