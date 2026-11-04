import { reactive } from 'vue';
import Worker from '../simulation/worker?worker&inline';
import { fetchEngineSource } from '../simulation/source';
import type { Catalog, Options, Report, Response, PlanOptions, PlanReport } from '../simulation/types';
import type { GameAdapter } from '../core/game';
import type { GameSave } from '../core/types';
export function counterContext(s: GameSave) {
  const config=s as GameSave&Record<string,unknown>,adv=s.adv as GameSave['adv']&Record<string,unknown>;
  return JSON.stringify({chapter:adv.chapter,node:adv.node,runs:adv.runs,nodes:adv.nodes,unlocked:adv.unlocked,gifts:adv.gifts,badges:adv.badges,kept:adv.kept,
    team:s.team,road:s.road,battle:adv.battle,mons:s.mons,autoSwitch:config.autoSwitch,buddy:config.buddy,buffs:config.buffs,items:config.items,link:s.link,travel:s.travel,dex:config.dex});
}

export function createCounters(game?:GameAdapter) {
  const state = reactive({ catalog: null as Catalog | null, report: null as Report | null, routeReport:null as Report|null,planReport:null as PlanReport|null,error: '', busy: false, completed: 0, total: 0, phase: '',stale:false });
  let worker: globalThis.Worker | null = null, fetchController: AbortController | null = null, timeout: ReturnType<typeof setTimeout> | undefined;
  let pendingOptions: Options | null = null;
  let sourceCache='',context='',generation=0;
  const off=game?.bus.on('sample',({save})=>{
    if(!context||!state.catalog)return;
    state.stale=counterContext(save)!==context;
    const changedChapter=state.catalog.chapterIndex!==save.adv.chapter;
    const oldBattle=state.catalog.targets.filter(t=>t.source==='current').map(t=>t.foes[t.selected||0]?.uid).map(String).sort().join('|');
    const newBattle=(save.adv.battle?.enemies||[]).filter(m=>m.hp>0).map(m=>String(m.uid)).sort().join('|');
    if(!state.busy&&(changedChapter||!state.report&&!state.planReport&&oldBattle!==newBattle))void load(true);
  });
  function stop() { generation++;fetchController?.abort(); fetchController = null; worker?.terminate(); worker = null; clearTimeout(timeout); state.busy = false; }
  function fail(message: string) { stop(); state.error = message; }
  function routeContext(){if(!context)return '';const s=JSON.parse(context);return JSON.stringify([s.chapter,s.runs,s.nodes]);}
  async function load(cached=false,pendingPlan?:{options:PlanOptions;route:string}) {
    stop(); const token=generation;state.error = ''; state.report = null;state.routeReport=null;state.planReport=null; state.catalog = null; state.busy = true;state.stale=false; state.phase = '读取当前章节、正在打的敌人与 Box';
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
        if (msg.type === 'catalog') {
          clearTimeout(timeout); state.catalog = msg.catalog; state.busy = false; state.phase = '已读取快照';
          if(pendingPlan){
            if(pendingPlan.route!==routeContext())state.error='章节或整轮路线已变化，已更新敌情；请重新选择目标节点。';
            else plan(pendingPlan.options);
          }
        }
        if (msg.type === 'progress') {
          state.completed = msg.completed; state.total = msg.total;
          if (!state.report && state.catalog && pendingOptions) state.report = { catalog: state.catalog, options: pendingOptions, results: [], routes: [], generatedAt: Date.now(), assumptions: ['计算尚未完成；这里只包含已完成的组，不代表全量最优。'] };
          if (msg.result) state.report?.results.push(msg.result);
          if (msg.route) state.report?.routes.push(msg.route);
        }
        if (msg.type === 'done') { clearTimeout(timeout); state.report = msg.report;state.catalog=msg.report.catalog;if(msg.report.options.mode!=='matrix')state.routeReport=msg.report; state.busy = false; state.phase = '计算完成'; }
        if(msg.type==='plan-progress'){state.phase=msg.phase;state.completed=msg.completed;state.total=msg.total;}
        if(msg.type==='plan-done'){clearTimeout(timeout);state.planReport=msg.report;state.catalog=msg.report.catalog;state.busy=false;state.phase='配队完成';state.completed=state.total;}
      };
      worker.onerror = () => fail('独立模拟进程失败，可能被浏览器安全策略阻止；没有在游戏页面执行引擎');
      worker.postMessage({ type: 'load', source, save, now: capturedAt });
    } catch (e) { if (!controller.signal.aborted) fail((e as Error).message); }
  }
  function run(options: Options, custom: { id: number; level: number }[] = []) {
    if (!worker || !state.catalog) { state.error = '请先读取本地 box'; return; }
    if (state.busy) return;
    if(state.stale){state.error='快照已变化，请先更新本章敌情';return;}
    state.error = ''; state.busy = true; state.report = null; state.phase = '独立模拟中 · 可随时取消'; state.completed = 0; state.total = 0;
    pendingOptions = JSON.parse(JSON.stringify(options));
    timeout = setTimeout(() => fail('计算超过十分钟，已停止；未完成样本没有计入结果，请缩小范围'), 600000);
    worker.postMessage({ type: 'run', options: JSON.parse(JSON.stringify(options)), custom });
  }
  function plan(options:PlanOptions) {
    if(!worker||!state.catalog){state.error='请先读取本章敌情与 Box';return;}
    if(state.busy)return;
    if(state.stale){void load(true,{options,route:routeContext()});return;}
    state.error='';state.busy=true;state.planReport=null;state.report=null;state.routeReport=null;pendingOptions=null;state.completed=0;state.total=0;state.phase='先检查原队伍是否能到达目标';
    timeout=setTimeout(()=>fail('配队计算超过十分钟，已停止；请缩短目标路线后重试'),600000);
    worker.postMessage({type:'plan',options:JSON.parse(JSON.stringify(options))});
  }
  return { state, load:()=>load(), run, plan, cancel() { stop(); state.catalog = null; state.report = null;state.routeReport=null;state.planReport=null; state.phase = '已取消，请重新读取快照'; }, dispose(){stop();off?.();} };
}
