import { reactive } from 'vue';
import Worker from '../tracker/worker?worker&inline';
import { fetchEngineSource } from '../simulation/source';
import { chooseHunt, needsReentry } from '../tracker/scheduler';
import { HuntNavigation } from '../tracker/navigation';
import type { HuntCatalog, HuntJob, TrackerLog, TrackerPrefs } from '../tracker/types';
import type { GameAdapter } from '../core/game';
import type { Store } from '../core/storage';
import { berryPlan, normalizeBerries } from '../tracker/berries';

export function createTracker(game: GameAdapter, store: Store, navigation = new HuntNavigation()) {
  const saved = store.get<Partial<TrackerPrefs>>('tracker', {});
  const prefs = reactive<TrackerPrefs>({ targets: Array.isArray(saved.targets) ? saved.targets.filter(Number.isInteger) : [],
    mode: saved.mode === 'interrupt' ? 'interrupt' : 'ordered', weather: Array.isArray(saved.weather) ? saved.weather.filter(Number.isInteger) : null,
    berries: Array.isArray(saved.berries) ? saved.berries.filter(key => typeof key === 'string') : [] });
  const state = reactive({ running: false, busy: false, catalog: null as HuntCatalog | null, job: null as HuntJob | null,
    phase: '选好队伍与目标，开始后自动追踪和切图', error: '', berryStatus: '', logs: [] as TrackerLog[] });
  let worker: globalThis.Worker | null = null, controller: AbortController | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined, serial = 0, lastRequest = 0, lastTravel = 0;
  let team = '', disposed = false;
  const completed = new Set<number>();
  const knownBox = new Set<string>();
  const berryAttempts = new Map<string, number>();
  const now = () => Math.max(Date.now(), Number(localStorage.getItem('pokecatch.clock')) || 0);
  const rawSave = () => { const raw = localStorage.getItem('gachamon-save-v1'); if (!raw) throw new Error('尚无游戏存档'); return raw; };
  const teamKey = (s: any) => JSON.stringify(s.team.map(String));
  function log(text: string) { state.logs.unshift({ time: Date.now(), text }); state.logs.splice(60); }
  function persist() { store.set('tracker', prefs); }
  function stop(reason = '已停止自动切图，游戏继续按原规则运行') {
    state.running = false; state.phase = reason; state.job = null; state.berryStatus = '自动吃果已停止';
  }
  function fail(message: string) { state.error = message; stop('追踪已暂停'); log(message); }
  function cancelWorker() { controller?.abort(); controller = null; worker?.terminate(); worker = null; clearTimeout(timeout); state.busy = false; serial++; }
  function acceptTeam(s: any) {
    if (teamKey(s) === team) return true;
    const previous: string[] = JSON.parse(team), current: string[] = s.team.map(String), extra = current.slice(previous.length);
    // Native capture fills empty team slots. Preserve that legitimate append
    // while still pausing on removal, reordering or replacing configured mons.
    if (extra.length && previous.every((uid, i) => current[i] === uid)
      && extra.every(uid => !knownBox.has(uid) && s.mons.some((m: any) => String(m.uid) === uid))) {
      team = teamKey(s); extra.forEach(uid => knownBox.add(uid)); log('游戏已将新捕获精灵加入队伍空位，继续追踪'); return true;
    }
    return false;
  }
  function eatBerries() {
    const berries = state.catalog?.berries || [];
    if (!prefs.berries.length) { state.berryStatus = '未选择自动吃的果子'; return; }
    let s = JSON.parse(rawSave());
    for (const item of berryPlan(prefs.berries, berries, s, now())) {
      if (!item.eat || Date.now() - (berryAttempts.get(item.berry.key) || 0) < 10000) continue;
      berryAttempts.set(item.berry.key, Date.now());
      if (!navigation.eatBerry(item.berry.key)) { state.berryStatus = '等待果子栏刷新后自动续吃'; return; }
      const after = JSON.parse(rawSave()), buff = after.buffs?.[item.berry.family];
      if (!buff || buff.key !== item.berry.key || buff.until <= now()) { state.berryStatus = '本次吃果未生效，稍后自动重试'; return; }
      log(`自动吃果：${item.berry.name} · 库存 ${Number(after.items?.[item.berry.key]) || 0}`); s = after;
    }
    const plan = berryPlan(prefs.berries, berries, s, now());
    const missing = plan.filter(item => item.stock <= 0).map(item => item.berry.name);
    state.berryStatus = missing.length ? `库存不足：${missing.join('、')}；追踪继续，补货后自动续吃` : '自动续吃已启用 · 同类效果到期后续吃';
  }
  function drive() {
    if (!state.running || !state.catalog) return;
    if (document.hidden) { state.phase = '游戏标签页已隐藏；恢复可见后自动继续追踪'; return; }
    navigation.dismissCaptureNotice();
    const catalog = state.catalog;
    const s = JSON.parse(rawSave());
    if (!acceptTeam(s)) { fail('队伍配置已改变，请确认新队伍后重新开始'); return; }
    for (const target of catalog.targets) if (target.owned && !completed.has(target.id)) {
      completed.add(target.id);
      if (prefs.targets.includes(target.id) || state.job?.id === target.id) log(`已捕获 ${target.name}，自动处理下一个目标`);
    }
    const pending = prefs.targets.filter(id => !catalog.targets.find(t => t.id === id)?.owned);
    if (!pending.length) { log('所选目标已全部捕获'); stop('全部目标已捕获，已停止自动切图'); return; }
    if (s.adv.pending) { state.phase = '等待你处理当前赠礼／解谜选择，完成后自动继续'; return; }
    if (navigation.blocked()) { state.phase = '等待游戏弹窗关闭，随后自动继续'; return; }
    const job = chooseHunt(catalog, prefs, state.job);
    if (!job) { state.job = null; state.phase = '等待目标出现或解锁条件满足；会自动重试'; state.berryStatus = '等待可执行目标，暂不消耗果子'; return; }
    const target = catalog.targets.find(t => t.id === job.id)!;
    const currentZone = s.adv.zone?.id;
    const inPlace = job.kind === 'zone' ? currentZone === job.destination.zone
      : s.adv.chapter === job.destination.chapter && !s.adv.zone && !s.adv.event && !s.adv.tower;
    const reenter = inPlace && needsReentry(job, s.adv);
    if (inPlace && !reenter) { state.job = job; eatBerries(); state.phase = `${job.interrupt ? '天气插队 · ' : ''}正在捕捉 ${target.name}`; return; }
    // Preserve all capture/reward animations and the current battle, including
    // its final KO. A new job is committed only at a battle-free boundary.
    if (!s.adv.battle && !s.adv.pending && !navigation.blocked()) navigation.showAdventure();
    if (s.adv.battle || s.adv.pending || navigation.blocked() || navigation.battleVisible()) { state.phase = `等待当前战斗／弹窗结算，随后前往 ${target.name}`; return; }
    if (Date.now() - lastTravel < 4000) return;
    if (job.destination.until && job.destination.until <= now()) { state.phase = '位置／天气刚刚变化，正在重新确认'; return; }
    navigation.travel(job.destination, reenter);
    lastTravel = Date.now();
    const after = JSON.parse(rawSave());
    const arrived = job.kind === 'zone' ? after.adv.zone?.id === job.destination.zone
      : after.adv.chapter === job.destination.chapter && !after.adv.zone && !after.adv.event && !after.adv.tower;
    if (!arrived) throw new Error('游戏没有进入目标地图，已暂停，请检查地图条件');
    if (!acceptTeam(after)) throw new Error('切图后队伍发生变化，已暂停，请检查地区／独立队伍设置');
    eatBerries();
    const changed = !state.job || state.job.id !== job.id || state.job.destination.chapter !== job.destination.chapter;
    state.job = job;
    if (changed || reenter) log(`${job.interrupt ? '天气插队：' : '自动追踪：'}${target.name} → ${job.destination.name}${reenter ? '（继续尝试捕获）' : ''}`);
    state.phase = `${job.interrupt ? '天气插队 · ' : ''}正在捕捉 ${target.name}`;
  }
  function request() {
    if (!worker || state.busy) return;
    const raw = rawSave(), time = now();
    state.busy = true; lastRequest = Date.now(); const requestSerial = ++serial;
    timeout = setTimeout(() => { cancelWorker(); fail('读取目标超时，请重新读取'); }, 20000);
    try { worker.postMessage({ save: raw, now: time, serial: requestSerial }); }
    catch (e) { cancelWorker(); throw e; }
  }
  async function load() {
    stop('正在读取目标和自然天气'); cancelWorker(); state.error = ''; state.catalog = null; state.busy = true;
    const abort = controller = new AbortController();
    timeout = setTimeout(() => { cancelWorker(); fail('读取目标超时，请重试'); }, 30000);
    try {
      if (!game.auditedExperienceRules()) throw new Error(game.compatibilityMessage());
      const raw = rawSave();
      const source = await fetchEngineSource(abort.signal);
      if (abort.signal.aborted || disposed) return;
      const activeWorker = worker = new Worker();
      activeWorker.onmessage = (event: MessageEvent<{ serial: number; catalog?: HuntCatalog; error?: string }>) => {
        if (worker !== activeWorker || event.data.serial !== serial || disposed) return;
        clearTimeout(timeout); state.busy = false;
        if (event.data.error) { cancelWorker(); fail(event.data.error); return; }
        state.catalog = event.data.catalog!;
        if (!state.running) state.phase = '目标已就绪，选择后点击开始挂机';
        else try { drive(); } catch (e) { fail((e as Error).message); }
      };
      activeWorker.onerror = () => { cancelWorker(); fail('目标读取进程失败，请重试'); };
      lastRequest = Date.now(); activeWorker.postMessage({ source, save: raw, now: now(), serial: ++serial });
    } catch (e) { if (!abort.signal.aborted) { cancelWorker(); fail((e as Error).message); } }
  }
  function start() {
    try {
      if (!state.catalog || !worker) throw new Error('请先读取目标');
      if (!prefs.targets.length) throw new Error('请先选择至少一个目标');
      if (prefs.targets.some(id => !state.catalog!.targets.some(t => t.id === id))) throw new Error('部分目标不在当前可追踪列表，请重新选择');
      const s = JSON.parse(rawSave());
      if (!game.auditedExperienceRules()) throw new Error(game.compatibilityMessage());
      if (!s.team.length) throw new Error('请先配好冒险队伍');
      if (s.adv.event || s.adv.tower) throw new Error('请先退出活动／高塔，再开始自动捕捉');
      if (s.adv.paused) throw new Error('游戏处于暂停状态，请先恢复游戏');
      if (s.road?.length && JSON.stringify(s.road.map(String)) !== teamKey(s)) throw new Error('新队伍尚未上场，请等待队伍切换完成再开始');
      team = teamKey(s); completed.clear();
      berryAttempts.clear(); prefs.berries = normalizeBerries(prefs.berries, state.catalog.berries || []); persist();
      knownBox.clear(); s.mons.forEach((m: any) => knownBox.add(String(m.uid)));
      state.catalog.targets.filter(t => t.owned).forEach(t => completed.add(t.id));
      state.error = ''; state.running = true; state.job = null; state.phase = '正在确认最新位置和天气';
      log(`开始挂机 · ${prefs.mode === 'interrupt' ? '允许天气插队' : '不允许插队'}`);
      navigation.showAdventure();
      if (!s.adv.battle && !s.adv.pending && !navigation.battleVisible()) navigation.refreshPositions();
      request();
    } catch (e) { fail((e as Error).message); }
  }
  const off = game.bus.on('sample', () => {
    if (!state.running || state.busy) return;
    try {
      if (document.hidden) { state.phase = '游戏标签页已隐藏；恢复可见后自动继续追踪'; return; }
      if (Date.now() - lastRequest >= 2000) request();
    } catch (e) { fail((e as Error).message); }
  });
  const lostTab = (e: StorageEvent) => { if (e.key === 'pokecatch-tab' && state.running) stop('游戏切换到了另一个标签页，请在该页开始追踪'); };
  window.addEventListener('storage', lostTab);
  return { state, prefs, load, start, stop() { log('手动停止'); stop(); }, persist,
    setBerries(keys: string[]) { prefs.berries = normalizeBerries(keys, state.catalog?.berries || []); persist(); },
    dispose() { disposed = true; stop(); cancelWorker(); off(); window.removeEventListener('storage', lostTab); } };
}
