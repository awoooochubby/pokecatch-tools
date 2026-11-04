import { createSimulator } from './engine';
import type { Request, Response } from './types';
let simulator: Awaited<ReturnType<typeof createSimulator>> | null = null;
const send = (value: Response) => self.postMessage(value);
self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    const req = event.data;
    if (req.type === 'load') {
      simulator = await createSimulator(req.source, req.save, req.now);
      send({ type: 'catalog', catalog: simulator.catalog });
    } else {
      if (!simulator) throw new Error('请先读取本地 box');
      const report = await simulator.run(req.options, (completed, total, result, route) => send({ type: 'progress', completed, total, result, route }), req.custom);
      send({ type: 'done', report });
    }
  } catch (e) { send({ type: 'error', message: (e as Error).message, fatal: event.data.type === 'load' }); }
};
