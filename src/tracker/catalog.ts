import { isolatedEngine, type Vendor } from '../simulation/isolated';
import { dex } from '../core/pokemon';
import type { Destination, HuntCatalog, HuntTarget } from './types';
import { berryNames } from './berries';

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export async function createHuntCatalog(source: string) {
  const engine = await isolatedEngine(source, Date.now(), () => 0.5, undefined, ['Roaming', 'LegendZones']);
  const t = engine.t, g = t.Game, a = t.Adventure, story = t.STORY;
  t.UI = { fmt: (value: number) => String(value) };
  const weatherKeys = new Set(Object.keys(t.CONFIG.WEATHER.TYPES));
  const name = (id: number) => dex[id]?.name || g.DEX[id]?.name || `#${id}`;
  return (raw: string, now: number): HuntCatalog => {
    const original = JSON.parse(raw);
    if (!Array.isArray(original.mons) || !Array.isArray(original.team) || !Number.isInteger(original.adv?.chapter)) throw new Error('请先进入冒险并等待游戏保存');
    engine.setTime(now);
    for (const r of story.REGIONS) if (r.key && r.key !== 'kanto') r.open = (original.travel?.to || []).includes(r.key);
    const s = Object.assign(g.freshState(), copy(original));
    s.stats = { ...g.freshState().stats, ...s.stats }; s.dex ||= {}; s.items ||= {}; s.buffs ||= {};
    s.adv.gifts ||= {}; s.adv.badges ||= []; s.adv.kept ||= {};
    return g.sandbox(s, () => {
      // Positions come exclusively from the live save. Never predict a roamer's
      // next random map using this isolated copy of the engine.
      const positions: Vendor[] = Object.entries(s.roam?.at || {}).map(([id, pos]) => ({ id: +id, ...(pos as Vendor) }))
        .filter((p: Vendor) => p.until > now && t.Roaming.free(p.id));
      t.Roaming.here = (ch: number) => positions.find(p => p.ch === ch) || null;
      t.Roaming.at = (ch: number) => t.Roaming.here(ch)?.id ?? null;
      t.Roaming.weatherAt = (ch: number) => t.CONFIG.ROAMING.WEATHER[t.Roaming.at(ch)] || null;
      const team = (s.road?.length ? s.road : s.team).map(String);
      const blockedRegion = (region: string) => team.some((uid: string) => g.can(s.mons.find((m: Vendor) => String(m.uid) === uid), 'region', region));
      const destination = (ch: number): Destination => ({ chapter: ch, region: story.regionOf(ch).key, name: story.CHAPTERS[ch].name });
      const targets: HuntTarget[] = [];
      for (const group of t.CONFIG.ROAMING.GROUPS) for (const id of group.ids) {
        const owned = g.owns(id) || !!s.roam?.caught?.includes(id), free = t.Roaming.free(id);
        const pos = positions.find(p => p.id === id), d = pos ? { ...destination(pos.ch), until: pos.until } : null;
        targets.push({ id, name: name(id), kind: 'roaming', owned,
          status: owned ? '已捕获' : !free ? '尚未解锁游走条件' : !d ? '等待游戏刷新游走位置' : blockedRegion(d.region) ? '当前队伍受地区限制' : '可追踪',
          destinations: d && !blockedRegion(d.region) && !owned ? [d] : [] });
      }
      for (const z of t.LegendZones.ZONES) {
        // Weekly forms, riddles and world bosses require separate interactions.
        if (z.forms || z.wb) continue;
        const owned = g.owns(z.id), state = t.LegendZones.state(z);
        const at = t.LegendZones.atChapter(z) ?? story.chaptersOf(z.region).filter((ch: number) => ch <= s.adv.unlocked).at(-1);
        const unlocked = Number.isInteger(at) && story.regionUnlocked(z.region, s.adv);
        const specialTeam = g.zoneTeam(z.id).map(String);
        const teamDiffers = specialTeam.length && JSON.stringify(specialTeam) !== JSON.stringify(s.team.map(String));
        const ready = !owned && state === 'open' && unlocked && !blockedRegion(z.region) && !teamDiffers;
        targets.push({ id: z.id, name: name(z.id), kind: 'zone', owned,
          status: owned ? '已捕获' : teamDiffers ? '该神兽有独立队伍，请先与当前队伍对齐' : !unlocked ? '地点未解锁' : blockedRegion(z.region) ? '当前队伍受地区限制' : state === 'open' ? '可挑战' : state === 'closed' ? '等待时段／月相' : state === 'sealed' ? '需要先手动解谜' : '捕捉条件未满足',
          destinations: ready ? [{ ...destination(at), zone: z.id, name: z.zone }] : [] });
      }
      const weather = new Map<number, HuntTarget>();
      const weatherTarget = (id: number) => {
        let target = weather.get(id);
        if (!target) { target = { id, name: name(id), kind: 'weather', owned: g.owns(id), status: '等待对应天气／前置条件', destinations: [] }; weather.set(id, target); }
        return target;
      };
      for (let ch = 0; ch <= s.adv.unlocked && ch < story.CHAPTERS.length; ch++) {
        const chapter = story.CHAPTERS[ch], region = story.regionOf(ch).key;
        if (chapter.league || !story.regionUnlocked(region, s.adv) || blockedRegion(region)) continue;
        const routes = chapter.steps.filter((step: Vendor) => step.kind === 'route');
        for (const [i, step] of routes.entries()) {
          if (!step.wild || step.tide && (step.tide === 'low') !== story.lowTide()) continue;
          const node = { ...step, type: 'wild', ch, lv: step.lv || story.routeBand(ch, i, routes.length) };
          if (step.veil && !s.adv.gifts[step.veil.after]) { node.veil = step.veil.types || []; node.veilIds = step.veil.ids; }
          const currentWeather = t.WEATHER.current(node);
          for (const p of a.zonePool(node, ch, true, null, true, false)) {
            if (!p.when?.some((key: string) => weatherKeys.has(key))) continue;
            const target = weatherTarget(p.id);
            if (target.owned || !p.on || !p.when.includes(currentWeather)) continue;
            const change = t.WEATHER.forecast(node, 24);
            const existing = target.destinations.find(d => d.chapter === ch);
            const habitat = a.habitatKey(node) || node.name;
            if (existing) { if (!existing.habitats!.includes(habitat)) existing.habitats!.push(habitat); existing.chance = Math.max(existing.chance || 0, p.pct); }
            else target.destinations.push({ ...destination(ch), weather: currentWeather, until: change?.at, chance: p.pct, habitats: [habitat] });
            target.status = '天气已到，可捕捉';
          }
        }
        for (const step of chapter.steps.filter((step: Vendor) => step.kind === 'static' && step.skies?.length)) {
          const target = weatherTarget(step.id), node = { ...step, ch };
          if (target.owned || step.once && s.adv.gifts[step.once] || step.after && !s.adv.gifts[step.after]
            || step.caught && !step.caught.every((id: number) => s.dex[id])
            || step.needs && g.itemCount(step.needs) < (step.needN || 1)
            || step.night && t.DAYTIME.phase().key !== 'night' || step.day && t.DAYTIME.phase().key === 'night') continue;
          const currentWeather = t.WEATHER.current(node);
          if (!step.skies.includes(currentWeather)) continue;
          target.destinations.push({ ...destination(ch), staticId: step.id, weather: currentWeather,
            until: t.WEATHER.forecast(node, 24)?.at, chance: step.chance || 1 });
          target.status = '天气已到，可捕捉';
        }
      }
      for (const target of weather.values()) { if (target.owned) target.status = '已拥有'; targets.push(target); }
      const berries = Object.entries(t.CONFIG.BUFF_BERRIES).map(([key, value]) => {
        const b = value as Vendor;
        return { key, name: berryNames[key] || b.name, family: b.family, mult: b.mult, minutes: t.CONFIG.BUFF_MIN, stock: g.itemCount(key) };
      });
      return { now, targets, chapter: s.adv.chapter, team, berries };
    });
  };
}
