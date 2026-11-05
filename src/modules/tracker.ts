import { reactive } from 'vue';
import Worker from '../tracker/worker?worker&inline';
import PredictionWorker from '../tracker/prediction-worker?worker&inline';
import { fetchEngineSource } from '../simulation/source';
import { chooseHunt, needsReentry } from '../tracker/scheduler';
import { HuntNavigation } from '../tracker/navigation';
import type { HuntCatalog, HuntJob, HuntPrediction, TrackerLog, TrackerPrefs } from '../tracker/types';
import type { GameAdapter } from '../core/game';
import type { Store } from '../core/storage';
import { berryPlan, normalizeBerries } from '../tracker/berries';
import { completionQueue, huntContext, huntTeam, validateTeam } from '../tracker/teams';
import { raidIds, raidPlanContext, type RaidPlan, type RaidCandidateAnalysis } from '../raid/planner';
import { readRaidCatalog, raidDate } from '../raid/read';
import { pokemonName } from '../core/pokemon';
import type { RaidEntry } from '../raid/types';

export function createTracker(game: GameAdapter, store: Store, navigation = new HuntNavigation()) {
  const saved = store.get<Partial<TrackerPrefs>>('tracker', {});
  const prefs = reactive<TrackerPrefs>({ targets: Array.isArray(saved.targets) ? saved.targets.filter(Number.isInteger) : [],
    mode: saved.mode === 'interrupt' ? 'interrupt' : 'ordered', weather: Array.isArray(saved.weather) ? saved.weather.filter(Number.isInteger) : null,
    berries: Array.isArray(saved.berries) ? saved.berries.filter(key => typeof key === 'string') : [],
    ...(saved.teams ? { teams: Object.fromEntries(Object.entries(saved.teams).filter(([, ts]) => Array.isArray(ts) && ts.length > 0 && ts.length <= 6 && ts.every(uid => typeof uid === 'string'))) } : {}) });
  const state = reactive({ running: false, busy: false, catalog: null as HuntCatalog | null, job: null as HuntJob | null,
    phase: '选好队伍与目标，开始后自动追踪和切图', error: '', berryStatus: '', logs: [] as TrackerLog[],
    raidCandidates: [] as RaidCandidateAnalysis[], analysing: false, progress: '', predictions: {} as Record<number, HuntPrediction>, raids: [] as RaidEntry[],
    raidPlans: {} as Record<string, RaidPlan>, notice: '', raidBusy: false });
  let worker: globalThis.Worker | null = null, controller: AbortController | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined, serial = 0, lastRequest = 0, lastTravel = 0;
  let team = '', disposed = false, acting = false, source = '', actionEpoch = 0;
  let predictor: globalThis.Worker | null = null, predictionTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectPrediction: ((e: Error) => void) | null = null;
  const refusedRaids = new Map<string, string>();
  const completed = new Set<number>();
  const knownBox = new Set<string>();
  const berryAttempts = new Map<string, number>();
  const now = () => Math.max(Date.now(), Number(localStorage.getItem('pokecatch.clock')) || 0);
  const rawSave = () => { const raw = localStorage.getItem('gachamon-save-v1'); if (!raw) throw new Error('尚无游戏存档'); return raw; };
  const teamKey = (s: any) => JSON.stringify(s.team.map(String));
  function log(text: string) { state.logs.unshift({ time: Date.now(), text }); state.logs.splice(60); }
  function persist() { store.set('tracker', prefs); }
  function cancelPrediction() { predictor?.terminate(); predictor = null; clearTimeout(predictionTimer); state.analysing = false;
    rejectPrediction?.(new Error('模拟已取消')); rejectPrediction = null; }
  function stop(reason = '已停止自动切图，游戏继续按原规则运行') {
    actionEpoch++; cancelPrediction();
    state.running = false; state.phase = reason; state.job = null; state.berryStatus = '自动吃果已停止';
  }
  function fail(message: string) { state.error = message; stop('追踪已暂停'); log(message); }
  function cancelWorker() { controller?.abort(); controller = null; worker?.terminate(); worker = null; clearTimeout(timeout); state.busy = false; serial++; }
  function mergeRaids(catalog: HuntCatalog) {
    const save = JSON.parse(rawSave()), date = raidDate(now());
    for (const raid of state.raids) {
      if (raid.date !== date) continue;
      const doneBoss = save.raids?.doneBoss?.[`${raid.region}|${raid.date}`];
      const done = raid.done || !!save.raids?.done?.[`${raid.region}|${raid.date}`] && (doneBoss == null || doneBoss === raid.boss);
      const missing = !save.mons.some((m: any) => m.id === raid.boss) && !save.pension?.mons?.some((p: any) => p.mon?.id === raid.boss)
        && !(save.under?.slots || []).some((slot: any) => slot?.mons?.some((m: any) => m.id === raid.boss));
      const regionName = ({ kanto: '关都', johto: '城都', hoenn: '丰缘', sinnoh: '神奥' } as Record<string, string>)[raid.region] || raid.region;
      catalog.targets.push({ id: raidIds[raid.region], name: `${regionName}团战 · ${pokemonName(raid.boss)}`, kind: 'raid', owned: done, dexMissing: missing,
        status: done ? '今日已捕获' : '轮到时模拟并配队', destinations: done ? [] : [{ chapter: save.adv.chapter, region: raid.region,
          name: `${regionName} · 今日团战`, raid: raid.region, date: raid.date, boss: raid.boss }] });
    }
  }
  async function loadRaids() {
    if (state.running || state.raidBusy || !state.catalog) return;
    state.raidBusy = true; state.error = ''; const epoch = actionEpoch;
    try {
      await navigation.openRaids(() => !disposed && epoch === actionEpoch);
      state.raids = readRaidCatalog(document, rawSave(), now());
      state.notice = `已读取 ${state.raids.length} 场今日团战；任务轮到时再配置自己的精灵和 NPC 队友`;
      state.catalog.targets = state.catalog.targets.filter(t => t.kind !== 'raid'); mergeRaids(state.catalog);
    } catch (e) { state.error = (e as Error).message; }
    finally { state.raidBusy = false; navigation.showAdventure(); }
  }
  function prediction<T>(payload: Record<string, unknown>): Promise<T> {
    cancelPrediction(); state.raidCandidates = []; state.analysing = true; state.progress = '正在启动原生战斗模拟';
    return new Promise((resolve, reject) => {
      rejectPrediction = reject; const active = predictor = new PredictionWorker();
      const finish = () => { clearTimeout(predictionTimer); active.terminate(); if (predictor === active) predictor = null; state.analysing = false; rejectPrediction = null; };
      predictionTimer = setTimeout(() => { finish(); reject(new Error('模拟超时，请减少候选或重新读取')); }, 180000);
      active.onerror = () => { finish(); reject(new Error('战斗模拟进程失败')); };
      active.onmessage = event => {
        if (predictor !== active || disposed) return;
        if (event.data.type === 'candidate') { const i = state.raidCandidates.findIndex(c => c.key === event.data.candidate.key); if (i < 0) state.raidCandidates.push(event.data.candidate); else state.raidCandidates[i] = event.data.candidate; return; }
        if (event.data.type === 'progress') { state.progress = `模拟进度 ${event.data.done}/${event.data.total}`; return; }
        finish(); if (event.data.type === 'error') reject(new Error(event.data.message)); else resolve(event.data.report);
      };
      active.postMessage(JSON.parse(JSON.stringify({ source, save: rawSave(), now: now(), ...payload })));
    });
  }
  function jobFor(id: number): HuntJob {
    const job = state.catalog && chooseHunt(state.catalog, { ...prefs, targets: [id], mode: 'ordered' }, null);
    if (!job) throw new Error('目标目前不可捕捉，请等待位置／天气或解锁条件');
    return job;
  }
  async function predict(id: number) {
    if (state.running || state.analysing || !source) return;
    state.error = '';
    try {
      const job = jobFor(id), s = JSON.parse(rawSave());
      if (job.kind === 'raid') {
        const entry = state.raids.find(r => r.region === job.destination.raid)!;
        state.raidPlans[entry.region] = await prediction<RaidPlan>({ raid: JSON.parse(JSON.stringify(entry)), team: prefs.teams?.[id] });
      } else {
        const selected = huntTeam(s, prefs, job); validateTeam(s, selected);
        state.predictions[id] = await prediction<HuntPrediction>({ job, team: selected });
      }
    } catch (e) { if (!disposed) state.error = (e as Error).message; }
  }
  async function runRaid(job: HuntJob) {
    const reg = job.destination.raid!, epoch = actionEpoch, active = () => state.running && actionEpoch === epoch && !disposed;
    let s = JSON.parse(rawSave());
    if (s.adv.event?.raid && s.adv.event.reg === reg && s.adv.event.id === job.destination.boss && s.adv.event.date === job.destination.date) {
      state.job = job; eatBerries(); state.phase = `团战挂机 · ${pokemonName(job.destination.boss!)}，捕获后自动继续队列`; return;
    }
    await navigation.openRaids(active);
    if (!active()) return;
    const entry = readRaidCatalog(document, rawSave(), now()).find(r => r.region === reg);
    if (!entry || entry.boss !== job.destination.boss || entry.date !== job.destination.date) throw new Error('今日团战目标已变化，请停止后重新读取');
    if (entry.done) { state.raids = state.raids.map(r => r.region === reg ? entry : r); return; }
    let plan = state.raidPlans[reg], context = raidPlanContext(rawSave(), entry);
    if (refusedRaids.get(reg) === context) { state.phase = '该团战阵容尚未达标，等待队伍升级或条件变化'; return; }
    if (!plan || plan.context !== context || JSON.stringify(prefs.teams?.[job.id] || []) !== JSON.stringify(plan.report.input.mine) && prefs.teams?.[job.id]?.length) {
      state.phase = `正在为 ${pokemonName(entry.boss)} 模拟团战阵容`;
      plan = await prediction<RaidPlan>({ raid: JSON.parse(JSON.stringify(entry)), team: prefs.teams?.[job.id] });
      if (!active()) return;
      state.raidPlans[reg] = plan;
    }
    if (plan.report.expectedClearMoves === null) {
      refusedRaids.set(reg, context); log(`${pokemonName(entry.boss)} 团战验证没有成功样本，暂不入场`);
      state.phase = '团战阵容尚无成功样本，暂时跳过'; navigation.showAdventure(); return;
    }
    if (raidPlanContext(rawSave(), entry) !== plan.context) { state.phase = '模拟期间阵容或效果变化，稍后重新验证'; return; }
    s = JSON.parse(rawSave());
    if (s.adv.battle || navigation.battleVisible()) { navigation.showAdventure(); state.phase = '团战方案已就绪，等待当前战斗结算后配置'; return; }
    await navigation.applyEventTeam(`raid:${reg}`, plan.report.input.mine.map(String), job.destination, active);
    if (!active()) return;
    await navigation.pickRaidAllies(reg, plan.picks, active);
    if (!active()) return;
    // Re-read the exact native slots before entry. In particular, NPC order is
    // generation order, not the visual pick order. Never enter a guessed lineup.
    const exact = readRaidCatalog(document, rawSave(), now()).find(r => r.region === reg)?.input;
    if (!exact || JSON.stringify(exact.mine.map(String)) !== JSON.stringify(plan.report.input.mine.map(String))
      || JSON.stringify(exact.allies) !== JSON.stringify(plan.report.input.allies)) throw new Error('团战实际配置与验证阵容不同，请重新读取');
    s = JSON.parse(rawSave());
    if (s.adv.battle) { navigation.showAdventure(); state.phase = '队伍已配好，等待当前战斗结算后进入团战'; return; }
    navigation.enterRaid(reg);
    const e = JSON.parse(rawSave()).adv.event;
    if (!e?.raid || e.reg !== reg || e.id !== entry.boss) throw new Error('游戏没有进入团战，请检查在线状态与原生入场条件');
    state.job = job; eatBerries(); log(`自动团战：${pokemonName(entry.boss)} · 验证胜率 ${(plan.report.win.mean * 100).toFixed(1)}% · 抓到后继续下一任务`);
  }
  function acceptTeam(s: any) {
    if (teamKey(s) === team) return true;
    const previous: string[] = JSON.parse(team), current: string[] = s.team.map(String), extra = current.slice(previous.length);
    // Native capture fills empty team slots. Preserve that legitimate append
    // while still pausing on removal, reordering or replacing configured mons.
    if (extra.length && previous.every((uid, i) => current[i] === uid)
      && extra.every(uid => !knownBox.has(uid) && s.mons.some((m: any) => String(m.uid) === uid))) {
      if (JSON.stringify(prefs.defaultTeam) === JSON.stringify(previous)) prefs.defaultTeam = [...current];
      if (state.job && !['zone', 'raid'].includes(state.job.kind) && JSON.stringify(prefs.teams?.[state.job.id]) === JSON.stringify(previous)) {
        prefs.teams = { ...prefs.teams, [state.job.id]: [...current] }; persist();
      }
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
  async function drive() {
    if (!state.running || !state.catalog || acting) return;
    try {
    if (document.hidden) { state.phase = '游戏标签页已隐藏；恢复可见后自动继续追踪'; return; }
    navigation.dismissCaptureNotice();
    const catalog = state.catalog;
    const s = JSON.parse(rawSave());
    if (prefs.targets.some(id => id < 0) && state.raids.some(r => prefs.targets.includes(raidIds[r.region]) && r.date !== raidDate(now()))) {
      fail('所选团战已跨日，今天的首领可能不同；请重新读取今日团战并确认队列'); return;
    }
    if (!acceptTeam(s)) { fail('队伍配置已改变，请确认新队伍后重新开始'); return; }
    for (const target of catalog.targets) if (target.owned && !completed.has(target.id)) {
      completed.add(target.id);
      if (prefs.targets.includes(target.id) || state.job?.id === target.id) log(`已捕获 ${target.name}，自动处理下一个目标`);
    }
    const pending = prefs.targets.filter(id => !catalog.targets.find(t => t.id === id)?.owned);
    if (!pending.length) { log('所选目标已全部捕获'); stop('全部目标已捕获，已停止自动切图'); return; }
    if (s.adv.pending) { state.phase = '等待你处理当前赠礼／解谜选择，完成后自动继续'; return; }
    if (navigation.blocked()) { state.phase = '等待游戏弹窗关闭，随后自动继续'; return; }
    const filtered = { ...catalog, targets: catalog.targets.map(t => t.kind === 'raid' && refusedRaids.get(t.destinations[0]?.raid || '') ===
      (state.raids.find(r => r.region === t.destinations[0]?.raid) ? raidPlanContext(rawSave(), state.raids.find(r => r.region === t.destinations[0]?.raid)!) : '') ? { ...t, destinations: [] } : t) };
    const job = chooseHunt(filtered, prefs, state.job);
    if (!job) { state.job = null; state.phase = '等待目标出现或解锁条件满足；会自动重试'; state.berryStatus = '等待可执行目标，暂不消耗果子'; return; }
    const target = catalog.targets.find(t => t.id === job.id)!;
    if (job.kind === 'raid' && s.adv.event?.raid && s.adv.event.reg === job.destination.raid) {
      state.job = job; eatBerries(); state.phase = `团战挂机 · ${target.name}，捕获后自动继续队列`; return;
    }
    const selectedTeam = huntTeam(s, prefs, job);
    const currentZone = s.adv.zone?.id;
    const configured = job.kind === 'zone' ? s.eventTeams?.[`zone:${job.destination.zone}`] || s.team : s.team;
    const teamReady = JSON.stringify(configured.map(String)) === JSON.stringify(selectedTeam);
    const inPlace = job.kind === 'zone' ? currentZone === job.destination.zone
      : s.adv.chapter === job.destination.chapter && !s.adv.zone && !s.adv.event && !s.adv.tower;
    const reenter = inPlace && needsReentry(job, s.adv);
    if (inPlace && !reenter && teamReady) { state.job = job; eatBerries(); state.phase = `${job.interrupt ? '天气插队 · ' : ''}正在捕捉 ${target.name}`; return; }
    // Preserve all capture/reward animations and the current battle, including
    // its final KO. A new job is committed only at a battle-free boundary.
    if (!s.adv.battle && !s.adv.pending && !navigation.blocked()) navigation.showAdventure();
    if (s.adv.battle || s.adv.pending || navigation.blocked() || navigation.battleVisible()) { state.phase = `等待当前战斗／弹窗结算，随后前往 ${target.name}`; return; }
    if (job.kind === 'raid') {
      acting = true;
      try { await runRaid(job); } finally { acting = false; }
      return;
    }
    if (Date.now() - lastTravel < 4000) return;
    if (job.destination.until && job.destination.until <= now()) { state.phase = '位置／天气刚刚变化，正在重新确认'; return; }
    validateTeam(s, selectedTeam);
    if (!teamReady) {
      acting = true; const epoch = actionEpoch;
      try {
        if (job.kind === 'zone') await navigation.applyEventTeam(`zone:${job.destination.zone}`, selectedTeam, job.destination, () => state.running && epoch === actionEpoch && !disposed);
        else navigation.applyAdventureTeam(selectedTeam);
        if (!state.running || epoch !== actionEpoch) return;
        team = teamKey(JSON.parse(rawSave()));
        log(`切换 ${target.name} 的队伍：${selectedTeam.map(uid => catalog.box?.find(m => m.uid === uid)?.name || uid).join('、')}`);
      } finally { acting = false; }
      const afterConfig = JSON.parse(rawSave());
      if (afterConfig.adv.battle || navigation.battleVisible()) { navigation.showAdventure(); state.phase = '队伍已配置，等待当前战斗结算后切图'; return; }
    }
    // Reenter after changing the adventure roster: native road teams only adopt
    // the new selection at a heal/entry, not immediately on the BOX screen.
    navigation.travel(job.destination, reenter || inPlace && !teamReady);
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
    } catch (e) { if (state.running && !disposed) fail((e as Error).message); }
  }
  function request() {
    if (!worker || state.busy) return;
    const raw = rawSave(), time = now();
    state.busy = true; lastRequest = Date.now(); const requestSerial = ++serial;
    timeout = setTimeout(() => { cancelWorker(); fail('读取目标超时，请重新读取'); }, 20000);
    try { worker.postMessage({ save: raw, now: time, serial: requestSerial, prefs: JSON.parse(JSON.stringify(prefs)) }); }
    catch (e) { cancelWorker(); throw e; }
  }
  async function load() {
    stop('正在读取目标和自然天气'); cancelWorker(); state.error = ''; state.catalog = null; state.busy = true;
    const abort = controller = new AbortController();
    timeout = setTimeout(() => { cancelWorker(); fail('读取目标超时，请重试'); }, 30000);
    try {
      if (!game.auditedExperienceRules()) throw new Error(game.compatibilityMessage());
      const raw = rawSave(); prefs.defaultTeam = JSON.parse(raw).team.map(String);
      source = await fetchEngineSource(abort.signal);
      if (abort.signal.aborted || disposed) return;
      const activeWorker = worker = new Worker();
      activeWorker.onmessage = (event: MessageEvent<{ serial: number; catalog?: HuntCatalog; error?: string }>) => {
        if (worker !== activeWorker || event.data.serial !== serial || disposed) return;
        clearTimeout(timeout); state.busy = false;
        if (event.data.error) { cancelWorker(); fail(event.data.error); return; }
        state.catalog = event.data.catalog!; mergeRaids(state.catalog);
        if (!state.running) state.phase = '目标已就绪，选择后点击开始挂机';
        else drive().catch(e => { if (state.running && !disposed) fail((e as Error).message); });
      };
      activeWorker.onerror = () => { cancelWorker(); fail('目标读取进程失败，请重试'); };
      lastRequest = Date.now(); activeWorker.postMessage({ source, save: raw, now: now(), serial: ++serial, prefs: JSON.parse(JSON.stringify(prefs)) });
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
      if (s.adv.capture?.on === false && prefs.targets.some(id => id > 0)) throw new Error('请先在游戏里开启自动捕捉，再开始挂机补图鉴／追踪');
      if (s.adv.event && !(s.adv.event.raid && prefs.targets.includes(raidIds[s.adv.event.reg])) || s.adv.tower) throw new Error('请先退出活动／高塔，再开始自动捕捉');
      if (s.adv.paused) throw new Error('游戏处于暂停状态，请先恢复游戏');
      if (s.road?.length && JSON.stringify(s.road.map(String)) !== teamKey(s)) throw new Error('新队伍尚未上场，请等待队伍切换完成再开始');
      team = teamKey(s); completed.clear(); refusedRaids.clear(); actionEpoch++;
      // Snapshot once per session. Returning from a weather interruption restores
      // this default, rather than inheriting the previous target's special team.
      prefs.defaultTeam = s.team.map(String);
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
    if (!state.running || state.busy || acting) return;
    try {
      if (document.hidden) { state.phase = '游戏标签页已隐藏；恢复可见后自动继续追踪'; return; }
      if (Date.now() - lastRequest >= 2000) request();
    } catch (e) { fail((e as Error).message); }
  });
  const lostTab = (e: StorageEvent) => { if (e.key === 'pokecatch-tab' && state.running) stop('游戏切换到了另一个标签页，请在该页开始追踪'); };
  window.addEventListener('storage', lostTab);
  return { state, prefs, load, loadRaids, start, predict, cancelPrediction, stop() { log('手动停止'); stop(); }, persist,
    addMissing() { if (state.running || !state.catalog) return;
      const before = prefs.targets.length; prefs.targets = completionQueue(state.catalog.targets, prefs.targets); persist();
      state.notice = `已新增 ${prefs.targets.length - before} 个当前可捕捉的缺失目标；这是一次性补全队列，未加入未解锁／仅进化、孵蛋、交换获得的精灵`; },
    setTeam(id: number, selected: string[] | null) { if (state.running) return;
      const next = { ...prefs.teams }; if (selected?.length) { validateTeam(JSON.parse(rawSave()), selected, id < 0 ? 2 : 6); next[id] = [...selected]; } else delete next[id];
      prefs.teams = next; delete state.predictions[id]; if (id < 0) { const reg = Object.keys(raidIds).find(k => raidIds[k] === id); if (reg) delete state.raidPlans[reg]; } persist(); },
    predictionStale(id: number) { const p = state.predictions[id]; if (!p) return false;
      try { const job = jobFor(id); return huntContext(rawSave(), huntTeam(JSON.parse(rawSave()), prefs, job), job) !== p.context; } catch { return true; } },
    setBerries(keys: string[]) { prefs.berries = normalizeBerries(keys, state.catalog?.berries || []); persist(); },
    dispose() { disposed = true; stop(); cancelWorker(); off(); window.removeEventListener('storage', lostTab); } };
}
