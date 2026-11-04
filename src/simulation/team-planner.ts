import { createSimulator, orderCandidates } from './engine';
import { createTraining } from './training';
import type { Catalog, Formation, PlanOptions, PlanReport, RouteResult, Target, TeamPlan } from './types';

export const NEW_MEMBER_MINUTES = 20;
export const ORDER_CHANGE_MINUTES = 1;
export const PLAN_SCREEN_LIMIT = 49;
const SCREEN_TRIALS=128, VERIFY_TRIALS=512, MIN_WIN=.95;
const key=(f:Formation)=>JSON.stringify([f.order,f.order.map(uid=>f.levels[uid])]);
export function changeCost(original:string[], order:string[]) {
  const added=order.filter(uid=>!original.includes(uid)),removed=original.filter(uid=>!order.includes(uid));
  const kept=order.filter(uid=>original.includes(uid));
  const reordered=JSON.stringify(kept)!==JSON.stringify(original.filter(uid=>order.includes(uid)));
  return {added,removed,reordered};
}
export function planScore(seconds:number|null, added:number, reordered:boolean):number|null {
  return seconds===null?null:seconds/60+NEW_MEMBER_MINUTES*added+(reordered?ORDER_CHANGE_MINUTES:0);
}
function threatFor(catalog:Catalog,route:RouteResult):Target|undefined {
  const key=route.failures?.[0]?.targetKey||route.threats?.[0]?.targetKey;
  return catalog.targets.find(t=>t.key===key);
}
/** Bounded two-stage search. Combat and training callbacks use separate native
 * engine instances; search samples are never presented as final validation. */
export async function planTeam(source:string, rawSave:string, now:number, options:PlanOptions,
  progress:(phase:string,completed:number,total:number)=>void,existing?:Awaited<ReturnType<typeof createSimulator>>):Promise<PlanReport> {
  if(!Number.isFinite(options.seed))throw new Error('配队随机种子无效');
  if(options.goal.from!=='chapter')throw new Error('目标配队从本章开头满血出发；当前战斗请使用路线诊断');
  const engine=existing??await createSimulator(source,rawSave,now),catalog=engine.catalog,original=[...catalog.activeOrder];
  if(!original.length||original.length>6||original.some(uid=>!catalog.candidates.some(m=>m.uid===uid&&m.eligible)))throw new Error('当前出战队伍不可用，请先在游戏中调整到等级上限内');
  const candidate=(uid:string)=>catalog.candidates.find(m=>m.uid===uid)!;
  const formation=(order:string[],levels:Record<string,number>={}):Formation=>({order:[...order],levels:Object.fromEntries(order.map(uid=>[uid,levels[uid]??candidate(uid).level]))});
  async function evaluate(instance:typeof engine,f:Formation,trials:number,seed:number):Promise<RouteResult> {
    const report=await instance.run({mode:'route',start:'full',goal:options.goal,levels:f.levels,candidateUids:f.order,targetKeys:[],scanLevels:false,sequence:false,
      trials,seed,minWin:MIN_WIN,maxLoss:1,autoSwitch:'current'},()=>{});
    return report.routes[0];
  }
  const searched=new Map<string,{formation:Formation;route:RouteResult;xp:number}>();
  const xpFor=(f:Formation)=>Object.fromEntries(f.order.map(uid=>[uid,engine.trainingXp(uid,f.levels[uid])]));
  async function screen(f:Formation) {
    const k=key(f);if(searched.has(k)||searched.size>=PLAN_SCREEN_LIMIT)return;
    const route=await evaluate(engine,f,SCREEN_TRIALS,options.seed);
    searched.set(k,{formation:f,route,xp:Object.values(xpFor(f)).reduce((a,b)=>a+b,0)});
    progress('搜索少换人、少练级的方案',searched.size,PLAN_SCREEN_LIMIT);
  }
  const start=formation(original);await screen(start);
  const baseline=searched.get(key(start))!.route;
  const pass=(route:RouteResult)=>route.win.low>=MIN_WIN;
  const ranked=()=>[...searched.values()].sort((a,b)=>Number(pass(b.route))-Number(pass(a.route))||b.route.win.low-a.route.win.low||
    changeCost(original,a.formation.order).added.length-changeCost(original,b.formation.order).added.length||a.xp-b.xp||a.route.wear.mean-b.route.wear.mean);

  // A team that already meets the requested goal needs no disruption at all.
  if(!pass(baseline)) {
    for(const order of orderCandidates(original).orders)await screen(formation(order));
    const target=threatFor(catalog,baseline);
    const strength=(uid:string,level:number,t=target)=>{
      if(!t)return level;
      const f=engine.candidateFacts(uid,level,t);
      return f.damage[0]/Math.max(1,f.enemyHp)*(f.speed>f.enemySpeed?1.6:f.speed===f.enemySpeed?1.15:1);
    };
    const slots=[...original.keys()].sort((a,b)=>strength(original[a],candidate(original[a]).level)-strength(original[b],candidate(original[b]).level)).slice(0,2);
    // Two existing members may both need one level. Include modest shared
    // training instead of assuming every improvement needs a new teammate.
    for(const step of [1,3])await screen(formation(original,Object.fromEntries(original.map(uid=>[uid,Math.min(candidate(uid).cap,candidate(uid).level+step)]))));
    // Modest upgrades first, while still testing a cap-level rescue option.
    for(const step of [1,3,5,Infinity]) {
      for(const uid of original) {
        const m=candidate(uid),level=Math.min(m.cap,m.level+step);
        if(level>m.level)await screen(formation(original,{[uid]:level}));
      }
      if(searched.size>=25)break;
    }
    type Choice={uid:string;level:number;power:number;xp:number};
    const choices:Choice[]=[];
    for(const m of catalog.candidates.filter(m=>m.eligible&&!original.includes(m.uid))) {
      for(const level of new Set([m.level,Math.min(m.cap,m.level+1),Math.min(m.cap,m.level+3),Math.min(m.cap,m.level+5),m.cap]))
        choices.push({uid:m.uid,level,power:strength(m.uid,level),xp:engine.trainingXp(m.uid,level)});
    }
    const distinct=(xs:Choice[])=>xs.filter((x,i)=>xs.findIndex(y=>y.uid===x.uid&&y.level===x.level)===i);
    const shortlist=distinct([
      ...choices.filter(c=>c.xp===0).sort((a,b)=>b.power-a.power).slice(0,5),
      ...choices.filter(c=>c.power>=1).sort((a,b)=>a.xp-b.xp||b.power-a.power).slice(0,5),
      ...choices.sort((a,b)=>b.power-a.power).slice(0,5),
    ]).slice(0,12);
    for(const c of shortlist) {
      const order=[...original];if(order.length<6)order.push(c.uid);else order[slots[0]]=c.uid;
      await screen(formation(order,{[c.uid]:c.level}));
      if(searched.size>=37)break;
    }
    // One more local improvement around promising teams; at most two incoming
    // members. Retained members keep their order unless a tested swap helps.
    for(const base of ranked().slice(0,3)) {
      for(const c of shortlist) {
        if(base.formation.order.includes(c.uid))continue;
        const order=[...base.formation.order];
        const slot=slots.find(i=>original.includes(order[i]))??0;
        if(order.length<6)order.push(c.uid);else order[slot]=c.uid;
        if(changeCost(original,order).added.length<=2)await screen(formation(order,{...base.formation.levels,[c.uid]:c.level}));
        if(searched.size>=PLAN_SCREEN_LIMIT)break;
      }
      if(searched.size>=PLAN_SCREEN_LIMIT)break;
    }
  }
  const successful=ranked().filter(p=>pass(p.route));
  // Preserve alternatives with few swaps, little XP, and strong route safety.
  // XP is only a shortlist heuristic; the final score uses simulated minutes.
  const few=[...successful].sort((a,b)=>changeCost(original,a.formation.order).added.length-changeCost(original,b.formation.order).added.length||a.xp-b.xp);
  const cheap=[...successful].sort((a,b)=>a.xp-b.xp||changeCost(original,a.formation.order).added.length-changeCost(original,b.formation.order).added.length);
  const short=[few[0],cheap[0],few[1],cheap[1],successful[0]].filter((x,i,xs):x is NonNullable<typeof x>=>!!x&&xs.findIndex(y=>y&&key(y.formation)===key(x.formation))===i).slice(0,4);
  const training=short.some(p=>p.xp>0)?await createTraining(source,rawSave,now):null;
  const plans:TeamPlan[]=[];
  let verified=0;
  for(const [index,p]of short.entries()) {
    progress('模拟练级时间并独立复核目标',index,short.length);
    let trainingCompleted=0;
    const estimates=p.xp>0&&training?await training.estimate(p.formation,options.seed^0x7f4a7c15,()=>progress(`模拟方案 ${index+1} 的练级时间`,++trainingCompleted,training.maps.length*8)):[];
    const best=estimates.filter(e=>e.seconds!==null).sort((a,b)=>a.seconds!.mean-b.seconds!.mean)[0];
    const seconds=p.xp===0?{mean:0,low:0,high:0}:best?.seconds??null;
    // Training can expire buffs or change weather. Re-evaluate at the estimated
    // departure time, with fresh seeds and no rewards/level-ups during the goal.
    const departure=seconds?.mean?await createSimulator(source,rawSave,now+Math.ceil(seconds.mean*1000)):engine;
    progress(`独立复核方案 ${index+1}`,index,short.length);
    const route=await evaluate(departure,p.formation,VERIFY_TRIALS,(options.seed^0x51ed270b)>>>0);verified++;
    const changes=changeCost(original,p.formation.order);
    plans.push({formation:p.formation,route,...changes,xp:xpFor(p.formation),training:estimates,trainingSeconds:seconds,
      trainingMap:best?.name,score:planScore(seconds?.mean??null,changes.added.length,changes.reordered)});
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  plans.sort((a,b)=>Number(pass(b.route))-Number(pass(a.route))||Number(a.score===null)-Number(b.score===null)||(a.score??Infinity)-(b.score??Infinity)||a.route.wear.mean-b.route.wear.mean);
  return {catalog,options,baseline,plans,searched:searched.size,verified,generatedAt:now,assumptions:[
    '按读取时保存的本章路线，从章首满血出发；重新出发时游戏可能重新生成节点。目标节点按下拉列表编号识别。',
    '先要求目标通过率的 Wilson 95% 下界达到 95%；筛选每组 128 次，最终用不同种子独立复核 512 次。有限样本不是必胜保证。',
    `最多筛选 ${PLAN_SCREEN_LIMIT} 支队伍、换入两名成员；这是有预算的局部搜索，不承诺全局最优。单挑伤害和速度只用于挑选候选，结论由连续路线模拟验证。`,
    '评分 = 预计练级分钟 + 20 × 新成员数 +（保留成员改变相对顺序时加 1）。20 分钟是减少配置改动的偏好权重，并非实际换人耗时。',
    '练级用拟议队伍的当前等级连续刷最多三张已解锁普通地图，保留当前伙伴、捕捉设置及经验加成。所有需练成员一起达到目标才停止，不把各自时间相加。',
    '每张练级地图模拟 8 次，每次最多两小时；未全部达到目标或需人工选择时标为无法估时，不按零成本处理。估时只比较这些地图，非全地图最优。',
    '耗时使用游戏标准行动节奏；前台动画、停顿会影响实际时间。计入失败重打与伙伴奖励，不消耗糖果、不假设进化或更换伙伴。',
    '目标路线按建议等级固定，排除途中升级奖励，按标准行动节奏推进时钟；训练结束的其他成员可能也已升级。训练后按预计出发时刻复核，天气和加成到期仍有估时不确定性。',
    '只给出可手动执行的建议，不修改游戏存档。',
  ]};
}
