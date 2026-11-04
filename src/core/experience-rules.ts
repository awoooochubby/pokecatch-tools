import data from '../data/experience.json';
import type { GameSave, Mon } from './types';
export const experienceModel = data;

// Same operations, ordering and rounding as the checksum-pinned Game.xpForNext.
// Region is the progression/wallet region, not the low-level map being farmed.
export function xpRegion(s: GameSave): string {
  if (s.link?.side === 'from' && s.link.from) return s.link.from;
  let chapter = s.adv.unlocked || 0;
  if (!Number.isInteger(chapter) || chapter < 0 || chapter >= data.chapters.length) return '';
  const open = (key: string) => data.regions.some(r => r.key === key && (r.open || s.travel?.to?.includes(key)));
  while (chapter > 0 && !open(data.chapters[chapter].region)) chapter--;
  return data.chapters[chapter].region;
}
export function xpForNext(level: number, rank: number | undefined, region: string): number {
  const r = data.regions.find(r => r.key === region);
  if (!r || !Number.isInteger(level) || level < 1 || level > 100) return NaN;
  const steps = [{ from: data.growthFrom, step: data.regions[0].step }, ...data.regions.filter(r => r.base)
    .map(r => ({ from: r.base, step: r.step })).sort((a, b) => a.from - b.from)];
  let growth = 1;
  steps.forEach((step, i) => {
    const end = Math.min(level, steps[i + 1]?.from ?? Infinity);
    if (end > step.from) growth *= (data.timeRatio ** (1 / step.step) * data.growthExtra) ** (end - step.from);
  });
  const normalizedRank = Math.min(data.rankMax, Math.max(0, Math.floor(+rank! || 0)));
  return Math.floor(Math.floor(.8 * Math.pow(level, 2.4) + 10) * growth * data.scale * r.xp * data.rankXp ** normalizedRank);
}
export function earnedXp(before: Mon, after: Mon, region: string, trusted: boolean): number | null {
  if (![before.xp, after.xp, before.level, after.level].every(Number.isSafeInteger) || before.xp < 0 || after.xp < 0
    || before.level < 1 || after.level > 100 || after.level < before.level || (before.rank || 0) !== (after.rank || 0)) return null;
  if (before.level === after.level) return after.xp >= before.xp ? after.xp - before.xp : null;
  if (!trusted) return null;
  let total = after.xp - before.xp;
  for (let level = before.level; level < after.level; level++) total += xpForNext(level, before.rank, region);
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}
