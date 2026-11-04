import {describe,it,expect} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {createSimulator} from '../src/simulation/engine';
import {planTeam,changeCost,planScore,PLAN_SCREEN_LIMIT} from '../src/simulation/team-planner';
import {createTraining} from '../src/simulation/training';
import {referenceEngine} from './reference-engine';
import type {Options} from '../src/simulation/types';

describe('team preparation tradeoffs',()=>{
  it('balances disruption against training without assigning unknown training a zero cost',()=>{
    expect(planScore(600,0,false)).toBe(10);
    expect(planScore(300,1,false)).toBe(25);
    expect(planScore(3600,0,false)).toBe(60);
    expect(planScore(null,0,false)).toBeNull();
    expect(changeCost(['a','b','c'],['a','d','c'])).toEqual({added:['d'],removed:['b'],reordered:false});
    expect(changeCost(['a','b','c'],['c','a','d']).reordered).toBe(true);
  });
});
const native=existsSync('.cache/engine.js')?describe:describe.skip;
const now=new Date(2026,10,4,12).getTime();
native('goal-directed native team planning',()=>{
  const source=existsSync('.cache/engine.js')?readFileSync('.cache/engine.js','utf8'):'';
  function snapshot(ids=[136],levels=ids.map(()=>52)) {
    const t=referenceEngine(source,now),s:any=t.Game.freshState();
    s.travel={to:['sinnoh']};s.trainer={};s.adv={gifts:{},badges:[],kept:{},loops:[],layout:6,speed:1};s.mons=ids.map((id,i)=>({id,uid:String(i),level:levels[i],xp:0,reg:'sinnoh',shiny:false,rank:0}));
    s.team=['0'];s.road=['0'];s.adv.chapter=55;s.adv.unlocked=55;s.adv.runs=1;
    s.adv.nodes=[{type:'trainer',name:'测试训练家',trainer:'测试训练家',sprite:'youngster',bg:'prairie',team:[[478,52]]},{type:'heal',name:'Frimapic',bg:'town'}];
    s.adv.node=0;s.adv.battle=null;s.adv.pending=null;
    for(const ch of t.STORY.CHAPTERS)for(const step of ch.steps||[]){if(step.gift?.key)s.adv.gifts[step.gift.key]=true;if(step.once)s.adv.gifts[step.once]=true;}
    return s;
  }
  const options=(changes:Partial<Options>={}):Options=>({mode:'route',start:'full',trials:128,seed:1729,candidateUids:['0'],targetKeys:[],scanLevels:false,sequence:false,minWin:.95,maxLoss:1,autoSwitch:'current',...changes});
  it('stops exactly at the target boundary and does not borrow a later center heal',async()=>{
    const engine=await createSimulator(source,JSON.stringify(snapshot()),now);
    const before=await engine.run(options({goal:{node:1,objective:'reach',from:'chapter'}}),()=>{});
    const after=await engine.run(options({goal:{node:1,objective:'clear',from:'chapter'}}),()=>{});
    expect(before.routes[0].win.mean).toBe(1);expect(before.routes[0].loss.mean).toBeGreaterThan(0);
    expect(after.routes[0].loss.mean).toBe(0);
    const empty=await engine.run(options({goal:{node:0,objective:'reach',from:'chapter'}}),()=>{});
    expect(empty.routes[0].wear.mean).toBe(0);
  },30000);
  it('applies per-member levels within the original cap and replays from the chapter start',async()=>{
    const s=snapshot([136],[51]);s.adv.node=1;
    const engine=await createSimulator(source,JSON.stringify(s),now);
    const current=await engine.run(options(),()=>{});
    const replay=await engine.run(options({levels:{'0':52},goal:{node:0,objective:'clear',from:'chapter'}}),()=>{});
    expect(current.routes[0].wear.mean).toBe(0);expect(replay.routes[0].wear.mean).toBeGreaterThan(0);
    expect(engine.trainingXp('0',52)).toBeGreaterThan(0);
    await expect(engine.run(options({levels:{'0':53}}),()=>{})).rejects.toThrow('上限');
    await expect(engine.run(options({levels:{'0':50}}),()=>{})).rejects.toThrow('上限');
    await expect(engine.run(options({goal:{node:2,objective:'clear',from:'chapter'}}),()=>{})).rejects.toThrow('目标无效');
  },30000);
  it('advances the goal clock so expired encounter buffs cannot improve a later node',async()=>{
    const s=snapshot();s.dex={10:1,11:1,12:1};s.buffs={dex:{key:'enigma-berry',until:now+1}};
    s.adv.nodes=[{type:'heal',name:'Frimapic',bg:'town'},
      {type:'wild',name:'洞穴测试',bg:'cave',indoor:true,weather:null,pool:[{id:10,min:52,max:52,w:1},{id:478,min:52,max:52,w:1}]}];
    const engine=await createSimulator(source,JSON.stringify(s),now),goal={node:1,objective:'clear',from:'chapter'} as const;
    const elapsed=await engine.run(options({goal}),()=>{}),frozen=await engine.run(options(),()=>{});
    delete s.buffs.dex;
    const reference=await createSimulator(source,JSON.stringify(s),now),plain=await reference.run(options({goal}),()=>{});
    expect(elapsed.routes[0]).toEqual(plain.routes[0]);
    expect(frozen.routes[0].wear.mean).not.toBe(plain.routes[0].wear.mean);
  },30000);
  it('keeps a sufficient original team with no training or unnecessary changes and verifies fresh samples',async()=>{
    const save=JSON.stringify(snapshot([136,392])),report=await planTeam(source,save,now,{goal:{node:1,objective:'clear',from:'chapter'},seed:1729},()=>{});
    expect(report.searched).toBe(1);expect(report.plans[0].formation.order).toEqual(['0']);
    expect(report.plans[0].score).toBe(0);expect(report.plans[0].trainingSeconds?.mean).toBe(0);
    expect(report.baseline.trials).toBe(128);expect(report.plans[0].route.trials).toBe(512);
    expect(report.plans[0].route.win.low).toBeGreaterThanOrEqual(.95);
    expect(JSON.stringify(JSON.parse(save))).toBe(save);
  },30000);
  it('finds a ready Box member for a failing team without training the whole roster',async()=>{
    const save=JSON.stringify(snapshot([129,136],[5,52])),engine=await createSimulator(source,save,now);
    const report=await planTeam(source,save,now,{goal:{node:1,objective:'clear',from:'chapter'},seed:1729},()=>{},engine);
    expect(report.baseline.win.mean).toBe(0);expect(report.searched).toBeLessThanOrEqual(PLAN_SCREEN_LIMIT);
    const plan=report.plans.find(p=>p.route.win.low>=.95&&p.trainingSeconds?.mean===0)!;
    expect(plan).toBeDefined();expect(plan.added).toEqual(['1']);expect(plan.formation.order).toEqual(['0','1']);
    expect(plan.score).toBe(20);expect(plan.route.trials).toBe(512);
    const target=report.catalog.targets.find(t=>t.source==='diagnostic')!;
    const followUp=await engine.run(options({mode:'matrix',targetKeys:[target.key],candidateUids:['1']}),()=>{});
    expect(followUp.results[0].targetId).toBe(target.id);
  },90000);
  it('freezes private buddy candy as well as ordinary XP during goal verification',async()=>{
    const s=snapshot([136],[50]),t=referenceEngine(source,now);
    t.Game.sandbox(s,()=>{s.mons[0].xp=t.Game.xpForNext(50,s.mons[0])-1;s.buddy={uid:'0',ko:t.Game.buddyGoal(s.mons[0])-1};});
    s.adv.nodes=[{type:'trainer',name:'多目标训练家',trainer:'训练家',sprite:'youngster',bg:'prairie',team:[[10,1],[478,52]]}];
    const engine=await createSimulator(source,JSON.stringify(s),now);
    await expect(engine.run(options(),()=>{})).resolves.toHaveProperty('routes');
  },30000);
  it('measures the first actual level-up step, including buddy candy, rather than a whole capped round',async()=>{
    const s=snapshot([136,392],[51,51]);s.team=['0','1'];s.road=['0','1'];
    const t=referenceEngine(source,now,1);let expected=0;
    t.Game.sandbox(s,()=>{for(const m of s.mons)m.xp=t.Game.xpForNext(m.level,m)-1;s.buddy={uid:'0',ko:t.Game.buddyGoal(s.mons[0])-1};});
    const saved=JSON.stringify(s),training=await createTraining(source,saved,now),map=training.maps[0];
    expect(map).toBeDefined();
    t.Game.sandbox(s,()=>{
      t.Adventure.buildChapter(map.id);t.Game.healTeam();
      for(let step=1;step<20000;step++){
        t.Adventure.step();t.Adventure.addTime(Math.max(t.CONFIG.ACTION_MS,t.CONFIG.STEP_MS));
        if(s.mons[0].level>=52&&s.mons[1].level>=52){expected=step*Math.max(t.CONFIG.ACTION_MS,t.CONFIG.STEP_MS)/t.Adventure.speed()/1000;break;}
      }
    });
    const actual=training.attempt({order:['0','1'],levels:{'0':52,'1':52}},map.id,1);
    expect(actual).toBeGreaterThan(0);expect(actual).toBeLessThan(90);
    // Both reach the next level on the first KO, despite XP arriving by two
    // reward paths. They train together; their durations must not be summed.
    expect(actual).toBe(expected);
    const estimates=await training.estimate({order:['0','1'],levels:{'0':52,'1':52}},1729);
    expect(estimates.some(e=>e.completed===8&&e.seconds!==null)).toBe(true);
    expect(s.adv.unlocked).toBe(55);
  },30000);
  it('keeps censored training sessions unknown instead of reporting zero or averaging only successes',async()=>{
    const training=await createTraining(source,JSON.stringify(snapshot([129],[5])),now);
    const estimates=await training.estimate({order:['0'],levels:{'0':6}},1729);
    expect(estimates[0].completed).toBe(0);expect(estimates[0].seconds).toBeNull();
    expect(estimates[0].limitSeconds).toBe(7200);
    expect(estimates.every(e=>e.seconds===null)).toBe(true);
  },60000);
});
