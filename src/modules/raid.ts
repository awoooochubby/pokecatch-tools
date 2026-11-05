import { reactive } from 'vue';
import Worker from '../raid/worker?worker&inline';
import { fetchEngineSource } from '../simulation/source';
import { readRaidCatalog, raidDate } from '../raid/read';
import type { RaidInput, RaidReport, RaidEntry } from '../raid/types';
import type { GameAdapter } from '../core/game';
import { raidPlanContext, type RaidPlan, type RaidCandidateAnalysis } from '../raid/planner';

export function raidContext(raw: string, input: RaidInput, now: number) {
  const s = JSON.parse(raw);
  return JSON.stringify({ date: raidDate(now), region: input.region, boss: input.boss, weather: input.weather,
    mine: (s.eventTeams?.[`raid:${input.region}`] || []).map((uid: string | number) => {
      const m = s.mons.find((m: any) => m.uid === uid); return m && { uid, id: m.id, level: m.level, rank: m.rank, shiny: m.shiny, statMult: m.statMult };
    }), allies: input.allies.map(m => ({ uid: m.uid, id: m.id, level: m.level, rank: m.rank, shiny: m.shiny, statMult: m.statMult, bot: m.bot })),
    alternateAllies: input.alternateAllies?.map(m => m.uid),
    buffs: s.buffs, autoSwitch: s.autoSwitch, speed: s.adv.speed });
}
export function createRaidPredictor(game: GameAdapter) {
  const state = reactive({ inputs: [] as RaidInput[], entries: [] as RaidEntry[], reports: {} as Record<string, RaidReport>, failures: {} as Record<string, string>,
    selected: '', busy: false, done: 0, total: 512, sampleTotal: 512, completed: 0, count: 0, current: '', report: null as RaidReport | null,
    error: '', phase: '预测团战胜率与耗时，或搜索期望通关时间较短的阵容', stale: false,
    plans: {} as Record<string, RaidPlan>, optimizing: false, candidates: [] as RaidCandidateAnalysis[], task: 'idle' as 'idle' | 'loading' | 'forecast' | 'optimize', finishedAt: 0 });
  let worker: globalThis.Worker | null = null, controller: AbortController | null = null, timer: ReturnType<typeof setTimeout> | undefined, context = '';
  const now = () => Math.max(Date.now(), Number(localStorage.getItem('pokecatch.clock')) || 0);
  const rawSave = () => { const raw = localStorage.getItem('gachamon-save-v1'); if (!raw) throw new Error('尚无游戏存档'); return raw; };
  function stop() { controller?.abort(); controller = null; worker?.terminate(); worker = null; clearTimeout(timer); state.busy = false; state.optimizing = false; }
  function fail(message: string) { stop(); state.error = message; state.phase = '预测未完成'; }
  async function snapshot(signal: AbortSignal) {
    if (!game.auditedExperienceRules()) throw new Error(game.compatibilityMessage());
    {
      if (!document.querySelector('#screen-raid.active')) {
        const nav = document.querySelector<HTMLElement>('#tabs [data-screen="raid"]');
        if (!nav || nav.classList.contains('locked')) throw new Error('请先解锁游戏中的异色团体战');
        if (document.querySelector('.modal')) throw new Error('请先关闭游戏弹窗，再读取团体战');
        nav.click();
      }
      const link = document.querySelector<HTMLElement>('#raid-root [data-raid-page="chroma"]');
      link?.click();
      const deadline = Date.now() + 15000;
      while (!document.querySelector('#raid-root .rc-card[data-rc]')) {
        if (signal.aborted) return null;
        if (document.querySelector('#raid-root [data-raid-draw], .rd-fx')) throw new Error('游戏新增每日团战抽签，请先在游戏里揭晓今日团战结果，再读取预测');
        if (Date.now() >= deadline) throw new Error('尚未读取到今日异色团体战，请先在游戏里登录并配置队伍和队友');
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
    if (signal.aborted) return null;
    const raw = rawSave(), time = now();
    const entries = readRaidCatalog(document, raw, time);
    if (!entries.length) throw new Error('没有读取到已解锁的团体战，请先在游戏里打开今日团体战');
    return { raw, time, entries, inputs: entries.flatMap(entry => entry.input ? [entry.input] : []) };
  }
  async function load(run: 'all' | 'one' | false = false) {
    if (state.busy) return;
    stop(); context = ''; state.error = ''; state.busy = true; state.done = 0; state.stale = false; state.report = null;
    state.reports = {}; state.plans = {}; state.failures = {}; state.completed = 0; state.count = 0;
    state.task = run ? 'forecast' : 'loading'; state.finishedAt = 0; state.candidates = [];
    state.phase = '读取团体战首领、自己的精灵与两名队友';
    const abort = controller = new AbortController();
    timer = setTimeout(() => fail('团体战读取超时，请重试'), 30000);
    try {
      const data = await snapshot(abort.signal);
      if (!data || abort.signal.aborted) return;
      const selected = state.selected;
      state.inputs = data.inputs; state.entries = data.entries;
      state.selected = data.entries.some(i => i.region === selected) ? selected : data.entries[0].region;
      if (!run) { clearTimeout(timer); state.busy = false; state.phase = `已读取 ${data.entries.length} 场团体战，${data.inputs.length} 场配置完整`; return; }
      const queue = run === 'all' ? [...data.inputs] : data.inputs.filter(input => input.region === selected);
      if (!queue.length) throw new Error(run === 'all' ? '全部场次均缺少完整阵容，请按列表提示补齐配置' : '本场阵容不完整，请按列表提示补齐配置');
      state.count = queue.length;
      const source = await fetchEngineSource(abort.signal);
      if (abort.signal.aborted) return;
      const contexts: Record<string, string> = {};
      const next = () => {
        const input = queue.shift();
        if (!input) {
          clearTimeout(timer); state.busy = false; state.current = ''; state.phase = `预测完成 · ${Object.keys(state.reports).length}/${data.entries.length} 场已计算`;
          state.finishedAt = Date.now(); state.report = state.reports[state.selected] || null; worker?.terminate(); worker = null; return;
        }
        state.current = input.region; state.done = 0; state.sampleTotal = input.alternateAllies ? state.total * 2 : state.total;
        contexts[input.region] = raidContext(data.raw, input, data.time);
        context = JSON.stringify(contexts);
        clearTimeout(timer); timer = setTimeout(() => { state.failures[input.region] = '本场预测超时'; fail('本场预测超过两分钟，已停止；已完成的场次保留'); }, 120000);
        worker!.postMessage({ source, save: data.raw, now: data.time, input: JSON.parse(JSON.stringify(input)), trials: state.total });
      };
      worker = new Worker();
      worker.onmessage = (event: MessageEvent<{ type: string; done?: number; total?: number; report?: RaidReport; message?: string }>) => {
        if (abort.signal.aborted) return;
        const msg = event.data;
        if (msg.type === 'progress') { state.done = msg.done!; state.sampleTotal = msg.total || state.total; }
        if (msg.type === 'error') { state.failures[state.current] = msg.message!; state.completed++; next(); }
        if (msg.type === 'done') { state.reports[msg.report!.input.region] = msg.report!; state.completed++;
          state.report = state.reports[state.selected] || null; next(); }
      };
      worker.onerror = () => fail('团体战模拟进程失败，请重试');
      state.phase = '用原引擎连续模拟道中、中心和首领';
      next();
    } catch (e) { if (!abort.signal.aborted) fail((e as Error).message); }
  }
  async function optimize(region: string) {
    if (state.busy) return;
    stop(); state.busy = true; state.optimizing = true; state.error = ''; state.done = 0; state.current = region; state.task = 'optimize'; state.candidates = []; state.finishedAt = 0;
    state.phase = '筛选自己的精灵与实际 NPC 队友，按双方期望总出招数比较';
    const abort = controller = new AbortController();
    try {
      timer = setTimeout(() => fail('团战配队搜索超时，请重试'), 180000);
      const data = await snapshot(abort.signal);
      if (!data || abort.signal.aborted) return;
      state.entries = data.entries; state.inputs = data.inputs; state.selected = region;
      const entry = data.entries.find(e => e.region === region);
      if (!entry) throw new Error('今天没有这场团战，请重新读取');
      const source = await fetchEngineSource(abort.signal);
      if (abort.signal.aborted) return;
      worker = new Worker(); worker.onerror = () => fail('团战配队搜索进程失败');
      worker.onmessage = event => {
        if (abort.signal.aborted) return;
        const msg = event.data;
        if (msg.type === 'progress') { state.done = msg.done; state.sampleTotal = msg.total; }
        if (msg.type === 'error') fail(msg.message);
        if (msg.type === 'candidate') {
          const i = state.candidates.findIndex(c => c.key === msg.candidate.key);
          if (i < 0) state.candidates.push(msg.candidate); else state.candidates[i] = msg.candidate;
          state.phase = msg.candidate.validation ? `正在独立复核候选 · 已完成 ${state.candidates.filter(c => c.validation).length} 组，每组 512 次` : `正在初步筛选 · 已完成 ${state.candidates.length} 组，每组 32 次`;
        }
        if (msg.type === 'optimized') {
          const plan: RaidPlan = msg.plan;
          state.finishedAt = Date.now(); state.plans[region] = plan; state.reports[region] = plan.report; state.report = plan.report;
          stop(); state.stale = raidPlanContext(rawSave(), entry) !== plan.context;
          state.phase = `搜索完成 · 比较 ${plan.candidates} 组阵容，按包含失败重试的期望出招数排序`;
        }
      };
      worker.postMessage(JSON.parse(JSON.stringify({ source, save: data.raw, now: data.time, optimize: entry })));
    } catch (e) { if (!abort.signal.aborted) fail((e as Error).message); }
  }
  const off = game.bus.on('sample', () => {
    if (state.plans[state.selected] && !state.busy) {
      try { const entry = state.entries.find(e => e.region === state.selected)!;
        state.stale = raidPlanContext(rawSave(), entry) !== state.plans[state.selected].context;
      } catch { state.stale = true; }
      return;
    }
    if (!context) return;
    try {
      const time = now(), raw = rawSave();
      const contexts: Record<string, string> = JSON.parse(context), live = readRaidCatalog(document, raw, time);
      state.stale = false;
      for (const [region, key] of Object.entries(contexts)) {
        const input = live.find(entry => entry.region === region)?.input;
        if (!input || raidContext(raw, input, time) !== key) state.stale = true;
      }
    } catch { state.stale = true; }
  });
  return { state, load: () => load(), run: () => load('all'), runOne: () => load('one'), optimize,
    select(region: string) { state.selected = region; state.report = state.reports[region] || null; },
    cancel() { stop(); state.phase = '已取消预测'; }, dispose() { stop(); off(); } };
}
