import { reactive } from 'vue';
import { GameAdapter } from './game';
import { Store } from './storage';
import { createExperience } from '../modules/experience';
import { createEnemies } from '../modules/enemies';
import { createCounters } from '../modules/counters';
import { createFarming } from '../modules/farming';
import { createForecastModule } from '../modules/forecast';
import type { FeatureModule } from './types';

export function createRuntime() {
  const store = new Store(localStorage), game = new GameAdapter();
  const settings = reactive({ folded: false, experience: true, enemies: true, farming: true, farmingVisible: true, farmingFolded: false, ...store.get<Record<string, boolean>>('settings', {}) });
  const status = reactive({ text: '等待游戏存档', now: Date.now(), storage: store.error });
  const experience = createExperience(game, store), enemies = createEnemies(game, store);
  const counters = createCounters();
  const farming = createFarming(game, store);
  const forecast = createForecastModule(game);
  const modules: Record<'experience' | 'enemies' | 'farming', FeatureModule> = { experience, enemies, farming };
  function setEnabled(id: 'experience' | 'enemies' | 'farming', enabled: boolean) {
    settings[id] = enabled;
    modules[id][enabled ? 'start' : 'stop']();
    store.set('settings', settings);
  }
  game.bus.on('status', text => { status.text = text; status.now = Date.now(); status.storage = store.error; });
  for (const id of ['experience', 'enemies', 'farming'] as const) if (settings[id]) modules[id].start();
  game.start();
  const flush = () => { experience.persist(); farming.persist(); };
  window.addEventListener('pagehide', flush);
  return { store, game, settings, status, experience, enemies, counters, farming, forecast, setEnabled,
    saveSettings() { store.set('settings', settings); },
    dispose() { experience.stop(); enemies.stop(); farming.stop(); forecast.dispose(); game.stop(); counters.dispose(); window.removeEventListener('pagehide', flush); },
  };
}
export type Runtime = ReturnType<typeof createRuntime>;
