import { reactive } from 'vue';
import type { GameAdapter } from '../core/game';
import type { Store } from '../core/storage';
import { readEggs, type Egg } from '../hatchery/eggs';
import { HatcheryNavigation } from '../hatchery/navigation';

interface Coordinator { available(): boolean; withUI<T>(fn: () => Promise<T>): Promise<T>; }
export function createHatchery(game: GameAdapter, store: Store, coordinator: Coordinator, navigation = new HatcheryNavigation()) {
  const prefs = reactive({ enabled: store.get<{ enabled?: boolean }>('hatchery', {}).enabled === true });
  const state = reactive({ eggs: [] as Egg[], busy: false, error: '', phase: '新蛋会自动进入孵蛋栏；成熟后可以一键领取', received: 0, lastReceived: 0, waiting: false });
  let disposed = false, epoch = 0, pendingUid: string | undefined;
  const raw = () => { const s = localStorage.getItem('gachamon-save-v1'); if (!s) throw new Error('尚无游戏存档'); return s; };
  function refresh() { state.eggs = readEggs(raw(), Math.max(Date.now(), Number(localStorage.getItem('pokecatch.clock')) || 0)); }
  function persist() { store.set('hatchery', { enabled: prefs.enabled }); }
  function setEnabled(value: boolean) { prefs.enabled = value; persist(); if (!value) { epoch++; state.waiting = false; pendingUid = undefined; } state.error = ''; state.phase = value ? '自动收蛋已开启，成熟后在战斗间隙领取' : '自动收蛋已关闭'; }
  async function collect(uid?: string) {
    if (state.busy || disposed) return;
    state.error = '';
    const token = epoch, active = () => !disposed && token === epoch;
    try {
      if (!game.auditedExperienceRules()) throw new Error(game.compatibilityMessage());
      refresh();
      const eggs = state.eggs.filter(e => e.ready && (!uid || e.uid === uid));
      if (!eggs.length) { state.waiting = false; state.phase = '当前没有可领取的成熟蛋'; return; }
      if (!coordinator.available()) { state.waiting = true; pendingUid = uid; state.phase = '已预约收蛋，等待助手完成界面操作'; return; }
      navigation.dismissCaptureNotice();
      if (!navigation.safe()) { state.waiting = true; pendingUid = uid; state.phase = '已预约收蛋，等待当前战斗或游戏弹窗结束'; return; }
      state.waiting = false; pendingUid = undefined;
      state.busy = true;
      await coordinator.withUI(async () => {
        const restore = await navigation.visit(active);
        try {
          for (const egg of eggs) {
            if (!active()) break;
            state.phase = `正在领取${egg.shiny ? '闪光' : ''}蛋，等待原生动画和结果确认`;
            await navigation.collect(egg, active);
            state.received++; state.lastReceived = Date.now(); refresh();
          }
          if (active()) state.phase = `领取完成 · 本次运行累计 ${state.received} 枚`;
        } finally { restore(); }
      });
    } catch (e) {
      if (!disposed) { state.error = (e as Error).message; state.phase = '收蛋已暂停'; state.waiting = false; prefs.enabled = false; persist(); }
    } finally { state.busy = false; try { refresh(); } catch {} }
  }
  const off = game.bus.on('sample', () => {
    if (disposed) return;
    try {
      refresh();
      if (state.waiting && !state.busy && !state.eggs.some(e => e.ready && (!pendingUid || e.uid === pendingUid))) { state.waiting = false; pendingUid = undefined; state.phase = '预约的蛋已被领取'; }
      if ((prefs.enabled || state.waiting) && !state.busy && state.eggs.some(e => e.ready)) {
        if (coordinator.available()) navigation.dismissCaptureNotice();
        if (!coordinator.available() || !navigation.safe()) { state.phase = '蛋已成熟，等待战斗／界面操作结束后自动领取'; return; }
        void collect(state.waiting ? pendingUid : undefined);
      }
    } catch (e) { state.waiting = false; state.error = (e as Error).message; if (prefs.enabled) { prefs.enabled = false; persist(); } }
  });
  const lostTab = (e: StorageEvent) => { if (e.key === 'pokecatch-tab') { prefs.enabled = false; state.waiting = false; epoch++; persist(); state.phase = '游戏切到另一个标签页，自动收蛋已停止'; } };
  window.addEventListener('storage', lostTab);
  return { state, prefs, collect, setEnabled, refresh, cancel() { epoch++; state.waiting = false; pendingUid = undefined; state.phase = '已取消本次收蛋'; }, dispose() { disposed = true; epoch++; off(); window.removeEventListener('storage', lostTab); } };
}
