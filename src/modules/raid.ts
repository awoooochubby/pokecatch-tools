import { reactive } from 'vue';
import Worker from '../raid/worker?worker&inline';
import { fetchEngineSource } from '../simulation/source';
import { readRaids, raidDate } from '../raid/read';
import type { RaidInput, RaidReport } from '../raid/types';
import type { GameAdapter } from '../core/game';

export function raidContext(raw: string, input: RaidInput, now: number) {
  const s = JSON.parse(raw);
  return JSON.stringify({ date: raidDate(now), region: input.region, boss: input.boss, weather: input.weather,
    mine: (s.eventTeams?.[`raid:${input.region}`] || []).map((uid: string | number) => {
      const m = s.mons.find((m: any) => m.uid === uid); return m && { uid, id: m.id, level: m.level, rank: m.rank, shiny: m.shiny, statMult: m.statMult };
    }), allies: input.allies.map(m => ({ uid: m.uid, id: m.id, level: m.level, rank: m.rank, shiny: m.shiny, statMult: m.statMult, bot: m.bot })),
    buffs: s.buffs, autoSwitch: s.autoSwitch, speed: s.adv.speed });
}
export function createRaidPredictor(game: GameAdapter) {
  const state = reactive({ inputs: [] as RaidInput[], selected: '', busy: false, done: 0, total: 512, report: null as RaidReport | null,
    error: '', phase: '读取游戏里已配置的异色团体战，预测从入口打败首领的成功率', stale: false });
  let worker: globalThis.Worker | null = null, controller: AbortController | null = null, timer: ReturnType<typeof setTimeout> | undefined, context = '';
  const now = () => Math.max(Date.now(), Number(localStorage.getItem('pokecatch.clock')) || 0);
  const rawSave = () => { const raw = localStorage.getItem('gachamon-save-v1'); if (!raw) throw new Error('尚无游戏存档'); return raw; };
  function stop() { controller?.abort(); controller = null; worker?.terminate(); worker = null; clearTimeout(timer); state.busy = false; }
  function fail(message: string) { stop(); state.error = message; state.phase = '预测未完成'; }
  async function snapshot(signal: AbortSignal) {
    if (!game.auditedExperienceRules()) throw new Error('当前游戏版本尚未适配团体战预测');
    if (!JSON.parse(rawSave()).adv?.event?.raid) {
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
        if (Date.now() >= deadline) throw new Error('尚未读取到今日异色团体战，请先在游戏里登录并配置队伍和队友');
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
    if (signal.aborted) return null;
    const raw = rawSave(), time = now();
    return { raw, time, inputs: readRaids(document, raw, time) };
  }
  async function load(run = false) {
    if (state.busy) return;
    stop(); context = ''; state.error = ''; state.busy = true; state.done = 0; state.stale = false; state.report = null;
    state.phase = '读取团体战首领、自己的精灵与两名队友';
    const abort = controller = new AbortController();
    timer = setTimeout(() => fail('团体战读取超时，请重试'), 30000);
    try {
      const data = await snapshot(abort.signal);
      if (!data || abort.signal.aborted) return;
      const selected = state.selected;
      state.inputs = data.inputs;
      state.selected = data.inputs.some(i => i.region === selected) ? selected : data.inputs[0].region;
      if (!run) { clearTimeout(timer); state.busy = false; state.phase = '配置已就绪，选择团体战后预测'; return; }
      if (selected && selected !== state.selected) throw new Error('所选团体战配置已改变，请重新选择');
      const input = data.inputs.find(i => i.region === state.selected)!;
      const source = await fetchEngineSource(abort.signal);
      if (abort.signal.aborted) return;
      context = raidContext(data.raw, input, data.time);
      worker = new Worker();
      worker.onmessage = (event: MessageEvent<{ type: string; done?: number; report?: RaidReport; message?: string }>) => {
        if (abort.signal.aborted) return;
        const msg = event.data;
        if (msg.type === 'progress') state.done = msg.done!;
        if (msg.type === 'error') fail(msg.message!);
        if (msg.type === 'done') { clearTimeout(timer); state.busy = false; state.report = msg.report!; state.phase = '预测完成'; worker?.terminate(); worker = null; }
      };
      worker.onerror = () => fail('团体战模拟进程失败，请重试');
      clearTimeout(timer); timer = setTimeout(() => fail('预测超过两分钟，已停止'), 120000);
      state.phase = '用原引擎连续模拟道中、中心和首领';
      worker.postMessage({ source, save: data.raw, now: data.time, input: JSON.parse(JSON.stringify(input)), trials: state.total });
    } catch (e) { if (!abort.signal.aborted) fail((e as Error).message); }
  }
  const off = game.bus.on('sample', () => {
    if (!context) return;
    const input = state.report?.input || state.inputs.find(i => i.region === state.selected);
    if (!input) return;
    try {
      const time = now(), raw = rawSave();
      state.stale = raidContext(raw, input, time) !== context;
      if (document.querySelector('#raid-root .rc-card[data-rc]') || JSON.parse(raw).adv?.event?.raid) {
        const live = readRaids(document, raw, time).find(i => i.region === input.region);
        if (!live || raidContext(raw, live, time) !== context) state.stale = true;
      }
    } catch { state.stale = true; }
  });
  return { state, load: () => load(), run: () => load(true),
    select(region: string) { state.selected = region; state.report = null; state.stale = false; context = ''; state.phase = '配置已就绪，点击预测成功率'; },
    cancel() { stop(); state.phase = '已取消预测'; }, dispose() { stop(); off(); } };
}
