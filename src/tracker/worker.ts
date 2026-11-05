import { createHuntCatalog } from './catalog';
import type { TrackerPrefs } from './types';
let catalog: Awaited<ReturnType<typeof createHuntCatalog>> | null = null;
self.onmessage = async (event: MessageEvent<{ source?: string; save: string; now: number; serial: number; prefs?: TrackerPrefs }>) => {
  const req = event.data;
  try {
    if (req.source) catalog = await createHuntCatalog(req.source);
    if (!catalog) throw new Error('追踪器尚未读取游戏规则');
    self.postMessage({ serial: req.serial, catalog: catalog(req.save, req.now, req.prefs) });
  } catch (e) { self.postMessage({ serial: req.serial, error: (e as Error).message }); }
};
