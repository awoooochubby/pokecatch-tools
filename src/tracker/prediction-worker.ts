import { predictHunt } from './predict';
import { optimizeRaid } from '../raid/planner';
self.onmessage = async (event: MessageEvent) => {
  const r = event.data;
  try {
    const progress = (done: number, total: number) => self.postMessage({ type: 'progress', done, total });
    const report = r.raid ? await optimizeRaid(r.source, r.save, r.now, r.raid, r.team, progress)
      : await predictHunt(r.source, r.save, r.now, r.job, r.team, r.trials || 256, progress);
    self.postMessage({ type: 'done', report });
  } catch (e) { self.postMessage({ type: 'error', message: (e as Error).message }); }
};
