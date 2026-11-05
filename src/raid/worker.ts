import { predictRaid } from './engine';
import type { RaidInput } from './types';
import { optimizeRaid } from './planner';
import type { RaidEntry } from './types';
self.onmessage = async (event: MessageEvent<{ source: string; save: string; now: number; input: RaidInput; trials: number; optimize?: RaidEntry }>) => {
  try {
    const req = event.data;
    if (req.optimize) {
      const plan = await optimizeRaid(req.source, req.save, req.now, req.optimize, undefined, (done, total) => self.postMessage({ type: 'progress', done, total }));
      self.postMessage({ type: 'optimized', plan }); return;
    }
    const report = await predictRaid(req.source, req.save, req.now, req.input, req.trials, (done, total) => self.postMessage({ type: 'progress', done, total }));
    self.postMessage({ type: 'done', report });
  } catch (e) { self.postMessage({ type: 'error', message: (e as Error).message }); }
};
