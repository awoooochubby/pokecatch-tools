import { createForecast } from './forecast';
import type { ForecastRequest, ForecastResponse } from './forecast-types';
let simulator: Awaited<ReturnType<typeof createForecast>> | null = null;
const send = (message: ForecastResponse) => self.postMessage(message);
self.onmessage = async (event: MessageEvent<ForecastRequest>) => {
  try {
    const req = event.data;
    if (req.type === 'load') { simulator = await createForecast(req.source, req.save, req.now); send({ type: 'catalog', catalog: simulator.catalog }); }
    else {
      if (!simulator) throw new Error('请先读取当前队伍');
      const report = await simulator.run(req.options, (completed, total, row) => send({ type: 'progress', completed, total, row }));
      send({ type: 'done', report });
    }
  } catch (e) { send({ type: 'error', message: (e as Error).message, fatal: event.data.type === 'load' }); }
};
