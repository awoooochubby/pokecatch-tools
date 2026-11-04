import { reactive } from 'vue';
import Worker from '../simulation/worker?worker&inline';
import { fetchEngineSource } from '../simulation/source';
import type { Catalog, Options, Report, Response } from '../simulation/types';
import type { GameAdapter } from '../core/game';
import type { GameSave } from '../core/types';
export function counterContext(s: GameSave) {
  return JSON.stringify({chapter:s.adv.chapter,node:s.adv.node,team:s.road?.length?s.road:s.team,battle:s.adv.battle,
    mons:s.mons.map(m=>[m.uid,m.level,m.hp,(m as typeof m&{status?:string}).status])});
}

export function createCounters(game?:GameAdapter) {
  const state = reactive({ catalog: null as Catalog | null, report: null as Report | null, routeReport:null as Report|null,error: '', busy: false, completed: 0, total: 0, phase: '',stale:false });
  let worker: globalThis.Worker | null = null, fetchController: AbortController | null = null, timeout: ReturnType<typeof setTimeout> | undefined;
  let pendingOptions: Options | null = null;
  let sourceCache='',context='',generation=0;
  const off=game?.bus.on('sample',({save})=>{
    if(!context||!state.catalog)return;
    state.stale=counterContext(save)!==context;
    const changedChapter=state.catalog.chapterIndex!==save.adv.chapter;
    const oldBattle=state.catalog.targets.filter(t=>t.source==='current').map(t=>t.foes[t.selected||0]?.uid).map(String).sort().join('|');
    const newBattle=(save.adv.battle?.enemies||[]).filter(m=>m.hp>0).map(m=>String(m.uid)).sort().join('|');
    if(!state.busy&&(changedChapter||!state.report&&oldBattle!==newBattle))void load(true);
  });
  function stop() { generation++;fetchController?.abort(); fetchController = null; worker?.terminate(); worker = null; clearTimeout(timeout); state.busy = false; }
  function fail(message: string) { stop(); state.error = message; }
  async function load(cached=false) {
    stop(); const token=generation;state.error = ''; state.report = null;state.routeReport=null; state.catalog = null; state.busy = true;state.stale=false; state.phase = '读取当前章节、正在打的敌人与 Box';
    const controller = fetchController = new AbortController();
    timeout = setTimeout(() => fail('读取引擎超时，请稍后重试'), 30000);
    try {
      const save = localStorage.getItem('gachamon-save-v1');
      const capturedAt = Date.now();
      if (!save) throw new Error('尚无游戏存档，请先进入游戏并等待保存');
      context=counterContext(JSON.parse(save));
      const source = cached&&sourceCache?sourceCache:await fetchEngineSource(controller.signal);
      if (controller.signal.aborted) return;
      sourceCache=source;
      worker = new Worker();
      worker.onmessage = (event: MessageEvent<Response>) => {
        const msg = event.data;
        if(token!==generation)return;
        if (msg.type === 'error') {
          if (msg.fatal) fail(msg.message);
          else { clearTimeout(timeout); state.error = msg.message; state.busy = false; state.phase = '计算未完成'; }
          return;
        }
        if (msg.type === 'catalog') { clearTimeout(timeout); state.catalog = msg.catalog; state.busy = false; state.phase = '已读取快照'; }
        if (msg.type === 'progress') {
          state.completed = msg.completed; state.total = msg.total;
          if (!state.report && state.catalog && pendingOptions) state.report = { catalog: state.catalog, options: pendingOptions, results: [], routes: [], generatedAt: Date.now(), assumptions: ['计算尚未完成；这里只包含已完成的组，不代表全量最优。'] };
          if (msg.result) state.report?.results.push(msg.result);
          if (msg.route) state.report?.routes.push(msg.route);
        }
        if (msg.type === 'done') { clearTimeout(timeout); state.report = msg.report;state.catalog=msg.report.catalog;if(msg.report.options.mode!=='matrix')state.routeReport=msg.report; state.busy = false; state.phase = '计算完成'; }
      };
      worker.onerror = () => fail('独立模拟进程失败，可能被浏览器安全策略阻止；没有在游戏页面执行引擎');
      worker.postMessage({ type: 'load', source, save, now: capturedAt });
    } catch (e) { if (!controller.signal.aborted) fail((e as Error).message); }
  }
  function run(options: Options, custom: { id: number; level: number }[] = []) {
    if (!worker || !state.catalog) { state.error = '请先读取本地 box'; return; }
    if (state.busy) return;
    state.error = ''; state.busy = true; state.report = null; state.phase = '独立模拟中 · 可随时取消'; state.completed = 0; state.total = 0;
    pendingOptions = JSON.parse(JSON.stringify(options));
    timeout = setTimeout(() => fail('计算超过十分钟，已停止；未完成样本没有计入结果，请缩小范围'), 600000);
    worker.postMessage({ type: 'run', options: JSON.parse(JSON.stringify(options)), custom });
  }
  return { state, load:()=>load(), run, cancel() { stop(); state.catalog = null; state.report = null;state.routeReport=null; state.phase = '已取消，请重新读取快照'; }, dispose(){stop();off?.();} };
}
