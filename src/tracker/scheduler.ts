import type { HuntCatalog, HuntJob, HuntTarget, TrackerPrefs } from './types';

function job(target: HuntTarget, catalog: HuntCatalog, interrupt: boolean, current: HuntJob | null): HuntJob | null {
  const candidates = target.destinations.filter(d => !d.until || d.until > catalog.now);
  const destination = candidates.find(d => current?.id === target.id && d.chapter === current.destination.chapter)
    || [...candidates].sort((a, b) => Number(b.chapter === catalog.chapter) - Number(a.chapter === catalog.chapter) || (b.chance || 0) - (a.chance || 0))[0];
  return destination ? { id: target.id, kind: target.kind, destination, interrupt } : null;
}
export function chooseHunt(catalog: HuntCatalog, prefs: TrackerPrefs, current: HuntJob | null): HuntJob | null {
  const pending = prefs.targets.map(id => catalog.targets.find(t => t.id === id)).filter((t): t is HuntTarget => !!t && !t.owned);
  if (!pending.length) return null;
  if (prefs.mode === 'interrupt') {
    const weather = catalog.targets.filter(t => t.kind === 'weather' && !t.owned && (prefs.weather === null || prefs.weather.includes(t.id)));
    const sticky = weather.find(t => current?.interrupt && t.id === current.id);
    if (sticky) { const next = job(sticky, catalog, true, current); if (next) return next; }
    const available = weather.flatMap(t => { const next = job(t, catalog, true, current); return next ? [next] : []; });
    available.sort((a, b) => (a.destination.until || Infinity) - (b.destination.until || Infinity)
      || Number(b.destination.chapter === catalog.chapter) - Number(a.destination.chapter === catalog.chapter)
      || (b.destination.chance || 0) - (a.destination.chance || 0) || a.id - b.id);
    if (available[0]) return available[0];
  }
  const sticky = pending.find(t => current && !current.interrupt && t.id === current.id);
  if (sticky) { const next = job(sticky, catalog, false, current); if (next) return next; }
  for (const target of pending) { const next = job(target, catalog, false, current); if (next) return next; }
  return null;
}
export function needsReentry(job: HuntJob, adv: Record<string, any>): boolean {
  if (job.kind === 'zone' || adv.chapter !== job.destination.chapter) return false;
  const nodes = adv.nodes || [], start = adv.node || 0;
  if (job.kind === 'roaming') return !nodes.slice(start).some((n: any) => n.roamer === job.id);
  if (job.destination.staticId != null) return !nodes.slice(start).some((n: any) => n.type === 'static' && n.id === job.destination.staticId);
  return !nodes.slice(start).some((n: any) => n.type === 'wild' && job.destination.habitats?.includes(n.habitat || (n.areas?.length ? `${n.name}|${n.areas.join('+')}` : n.name)));
}
