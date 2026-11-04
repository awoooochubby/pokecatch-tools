import { reactive } from 'vue';
import Worker from '../simulation/forecast-worker?worker&inline';
import { fetchEngineSource } from '../simulation/source';
import type { ForecastCatalog, ForecastOptions, ForecastReport, ForecastResponse, NodeForecastOptions, NodeForecastReport } from '../simulation/forecast-types';
import type { GameAdapter } from '../core/game';
import type { GameSave } from '../core/types';

export function forecastContext(s: GameSave) {
  const raw = s as GameSave & Record<string, unknown>;
  return JSON.stringify({ mons: s.mons, team: s.team, road: s.road, travel: s.travel, link: s.link, buddy: raw.buddy, buffs: raw.buffs,
    autoSwitch: raw.autoSwitch, speed: (s.adv as typeof s.adv & { speed?: number }).speed, chapter: s.adv.chapter, unlocked: s.adv.unlocked,
    badges: (s.adv as unknown as Record<string, unknown>).badges, items: raw.items,nodes:s.adv.nodes,node:s.adv.node,runs:s.adv.runs,battle:s.adv.battle,
    gifts:(s.adv as unknown as Record<string,unknown>).gifts,kept:(s.adv as unknown as Record<string,unknown>).kept,dex:raw.dex });
}
export function createForecastModule(game: GameAdapter) {
  const state = reactive({ catalog: null as ForecastCatalog | null, report: null as ForecastReport | null, nodeReport:null as NodeForecastReport|null,error: '', busy: false,
    phase: '无需实战采集，读取队伍后即可模拟选图', completed: 0, total: 0, stale: false });
  let worker: globalThis.Worker | null = null, controller: AbortController | null = null, timer: ReturnType<typeof setTimeout> | undefined;
  let pending: ForecastOptions | null = null, context = '';
  const off = game.bus.on('sample', ({ save }) => { if (context) state.stale = forecastContext(save) !== context; });
  function stop() { controller?.abort(); controller = null; worker?.terminate(); worker = null; clearTimeout(timer); state.busy = false; }
  function fail(message: string) { stop(); state.error = message; state.phase = '模拟未完成'; }
  async function load(autoRun?: {type:'maps';options:ForecastOptions}|{type:'nodes';options:NodeForecastOptions}) {
    stop(); state.catalog = null; state.report = null;state.nodeReport=null; state.error = ''; state.busy = true; state.stale = false; state.phase = '读取当前队伍与游戏规则';
    const request = controller = new AbortController();
    timer = setTimeout(() => fail('读取超时，请重试'), 30000);
    try {
      const save = localStorage.getItem('gachamon-save-v1'), now = Date.now();
      if (!save) throw new Error('尚无游戏存档，请先进入普通冒险');
      context = forecastContext(JSON.parse(save));
      const source = await fetchEngineSource(request.signal);
      if (request.signal.aborted) return;
      worker = new Worker();
      worker.onmessage = (event: MessageEvent<ForecastResponse>) => {
        if(request.signal.aborted)return;
        const msg = event.data;
        if (msg.type === 'error') {
          if (msg.fatal) fail(msg.message);
          else { clearTimeout(timer); state.busy = false; state.error = msg.message; state.phase = '模拟未完成'; }
        }
        if (msg.type === 'catalog') {
          clearTimeout(timer); state.catalog = msg.catalog; state.busy = false; state.phase = '队伍已就绪，选择地图后开始比较';
          if (autoRun) {if(autoRun.type==='maps')run(autoRun.options);else runNodes(autoRun.options);}
        }
        if (msg.type === 'progress') {
          state.completed = msg.completed; state.total = msg.total;
          if (msg.row && state.report) state.report.rows.push(msg.row);
        }
        if (msg.type === 'done') { clearTimeout(timer); state.report = msg.report; state.busy = false; state.phase = '比较完成'; }
        if(msg.type==='nodes-done'){clearTimeout(timer);state.nodeReport=msg.report;state.busy=false;state.phase='节点计算完成';}
      };
      worker.onerror = () => fail('独立模拟进程失败，请重新读取队伍');
      worker.postMessage({ type: 'load', source, save, now });
    } catch (e) { if (!request.signal.aborted) fail((e as Error).message); }
  }
  function run(options: ForecastOptions) {
    if (state.busy) return;
    if (!worker || !state.catalog) { state.error = '请先读取当前队伍'; return; }
    pending = JSON.parse(JSON.stringify(options)); state.error = ''; state.busy = true; state.completed = 0; state.total = options.chapters.length * options.trials;
    state.report = { catalog: state.catalog, options: pending!, rows: [], assumptions: [], generatedAt: state.catalog.capturedAt };
    state.phase = '模拟整章战斗与经验 · 可随时取消';
    timer = setTimeout(() => fail('模拟超过十分钟，已停止，请减少地图或模拟次数'), 600000);
    worker.postMessage({ type: 'run', options: pending });
  }
  function runNodes(options:NodeForecastOptions) {
    if(!worker||!state.catalog||state.busy)return;
    state.error='';state.busy=true;state.nodeReport=null;state.completed=0;state.total=options.trials;state.phase='模拟本图每个节点的经验 · 可随时取消';
    timer=setTimeout(()=>fail('节点模拟超过十分钟，已停止，请减少模拟次数'),600000);
    worker.postMessage({type:'nodes',options});
  }
  return { state, load: () => load(), run(options: ForecastOptions) { if (!state.busy) void load({type:'maps',options:JSON.parse(JSON.stringify(options))}); },
    runNodes(options:NodeForecastOptions){if(!state.busy)void load({type:'nodes',options:JSON.parse(JSON.stringify(options))});},
    cancel() { stop(); state.catalog = null; state.report = null;state.nodeReport=null; state.phase = '已取消，请重新读取队伍'; }, dispose() { stop(); off(); } };
}
