import { predictRaid } from './engine';
import type { RaidInput } from './types';
self.onmessage = async (event: MessageEvent<{ source: string; save: string; now: number; input: RaidInput; trials: number }>) => {
  try {
    const req = event.data;
    const report = await predictRaid(req.source, req.save, req.now, req.input, req.trials, done => self.postMessage({ type: 'progress', done }));
    self.postMessage({ type: 'done', report });
  } catch (e) { self.postMessage({ type: 'error', message: (e as Error).message }); }
};
