import { isolatedEngine, type Vendor } from './isolated';
import { Moments } from './statistics';
import type { Formation, TrainingEstimate } from './types';

const clone = <T>(v:T):T => JSON.parse(JSON.stringify(v));
export const TRAINING_LIMIT_SECONDS = 7200;
export const TRAINING_TRIALS = 8;

/** Time to reach all requested levels together, with native XP and buddy candy.
 * This is a continuous training session, not XP / a capped whole-round rate. */
export async function createTraining(source:string, rawSave:string, now:number) {
  const original:Vendor=JSON.parse(rawSave);
  let seed=1;
  const isolated=await isolatedEngine(source,now,()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;},e=>e);
  const {t}=isolated,g=t.Game,a=t.Adventure,cfg=t.CONFIG;
  for(const key of original.travel?.to||[]) {const region=t.STORY.REGIONS.find((r:Vendor)=>r.key===key);if(region)region.open=true;}
  const region=t.STORY.regionOf(original.adv.chapter)?.key;
  const available=t.STORY.CHAPTERS.flatMap((ch:Vendor,id:number)=>id<=original.adv.unlocked&&t.STORY.regionOf(id)?.key===region&&!ch.league&&ch.steps.some((s:Vendor)=>s.kind==='route')?[{id,name:ch.name}]:[]);
  // Compare a small spread of unlocked maps. This is deliberately bounded;
  // training-map selection is not claimed to be globally optimal either.
  const maps=[available.at(-1),available.at(-4),available[Math.floor(available.length/2)]]
    .filter((ch,index,all):ch is {id:number;name:string}=>!!ch&&all.findIndex(x=>x?.id===ch.id)===index);
  function clean():Vendor {
    const fresh=g.freshState(),s=Object.assign(fresh,clone(original));
    s.stats={...g.freshState().stats,...s.stats};s.buffs||={};s.items||={};s.dex||={};s.seen||={};s.seenShiny||={};s.trainer||={};
    s.adv.gifts||={};s.adv.badges||=[];s.adv.kept||={};s.adv.loops=[];s.adv.layout??=6;s.adv.paused=false;s.adv.pending=null;
    const speed=+s.adv.speed||1;s.adv.speed=cfg.SPEEDS.includes(speed)?speed:Math.max(1,...cfg.SPEEDS.filter((n:number)=>n<=speed));
    return s;
  }
  function attempt(formation:Formation,chapter:number,trialSeed:number):number|null {
    if(!available.some((map:{id:number})=>map.id===chapter))throw new Error('练级地图不是当前地区已解锁的普通地图');
    seed=trialSeed>>>0;isolated.setTime(now);
    const s=clean(),party=formation.order.map(uid=>s.mons.find((m:Vendor)=>String(m.uid)===uid));
    if(!party.length||party.some((m:Vendor)=>!m)||new Set(formation.order).size!==party.length||party.length>cfg.TEAM_SIZE)throw new Error('练级队伍无效');
    s.team=party.map((m:Vendor)=>m.uid);s.road=[...s.team];
    return g.sandbox(s,()=>{
      for(const m of party)if(g.can(m)||m.level>g.capFor(m))throw new Error('练级队伍包含不可用的精灵');
      for(const [uid,level]of Object.entries(formation.levels)) {
        const m=party.find((m:Vendor)=>String(m.uid)===uid);
        if(!m||!Number.isInteger(level)||level<m.level||level>g.capFor(m))throw new Error('练级目标超过当前上限或不在队伍中');
      }
      const reached=()=>party.every((m:Vendor)=>m.level>=(formation.levels[String(m.uid)]||m.level));
      if(reached())return 0;
      a.buildChapter(chapter);g.healTeam();
      const stepMs=Math.max(cfg.ACTION_MS,cfg.STEP_MS)/a.speed();
      const limit=Math.min(20000,Math.floor(TRAINING_LIMIT_SECONDS*1000/stepMs));
      for(let step=0;step<limit;step++) {
        if(s.adv.pending)throw new Error('练级地图含未确认的赠送或选择');
        if(!s.adv.battle&&s.adv.node>=s.adv.nodes.length) {
          // Re-enter this repeatable map without unlocking another chapter or
          // raising the original cap. Rebuilding and healing cost one step.
          s.adv.runs=(s.adv.runs||0)+1;a.buildChapter(chapter);g.healTeam();
        } else {
          const events:Vendor[]=a.step();
          for(const event of events) {
            if(['waiting','gift'].includes(event.type))throw new Error('练级地图含未确认的赠送或选择');
            if(event.roam||event.raid||event.type==='zoneLoop')throw new Error('练级地图出现未适配的特殊首领');
            if(event.type==='defeat'&&s.adv.chapter!==chapter){a.buildChapter(chapter);g.healTeam();}
            if(event.type==='chapterEnd')throw new Error('练级时发生意外章节切换');
          }
        }
        const elapsed=(step+1)*stepMs;isolated.setTime(now+elapsed);a.addTime(Math.max(cfg.ACTION_MS,cfg.STEP_MS));
        if(reached())return elapsed/1000;
      }
      return null;
    });
  }
  async function estimate(formation:Formation,trialSeed:number,progress?:()=>void):Promise<TrainingEstimate[]> {
    const results:TrainingEstimate[]=[];
    for(const map of maps) {
      const seconds=new Moments();let completed=0,error:string|undefined;
      for(let i=0;i<TRAINING_TRIALS;i++) {
        try {const elapsed=attempt(formation,map.id,(trialSeed+Math.imul(i+1,2654435761))>>>0);if(elapsed!==null){seconds.add(elapsed);completed++;}}
        catch(e){error=(e as Error).message;break;}
        progress?.();await new Promise(resolve=>setTimeout(resolve,0));
      }
      // Censored sessions must never look cheaper by averaging successes only.
      results.push({chapter:map.id,name:map.name,trials:TRAINING_TRIALS,completed,limitSeconds:TRAINING_LIMIT_SECONDS,
        seconds:!error&&completed===TRAINING_TRIALS?seconds.interval([0,Infinity]):null,...error?{error}:{}});
    }
    return results;
  }
  return {maps,estimate,attempt};
}
