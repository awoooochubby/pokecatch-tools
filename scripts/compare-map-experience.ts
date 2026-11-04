import { readFileSync, writeFileSync } from 'node:fs';
import { verifySource, ENGINE_HASH } from '../src/simulation/program';
import { referenceEngine } from '../tests/reference-engine';

const source=readFileSync('.cache/engine.js','utf8'); await verifySource(source);
const now=Date.UTC(2026,10,4,12), t=referenceEngine(source,now,0x521ab19), g=t.Game, a=t.Adventure;
const count=Number(process.env.MAP_SAMPLES || 50000);
if(!Number.isInteger(count)||count<100||count>200000)throw new Error('Invalid sample count');
const chapters=(process.env.MAP_CHAPTERS || '56,58').split(',').map(Number);
if(!chapters.length||chapters.some(i=>!Number.isInteger(i)||!t.STORY.CHAPTERS[i]))throw new Error('Invalid chapter indices');
const summaries=[];
for(const chapter of chapters) {
  const ch=t.STORY.CHAPTERS[chapter],title=ch.name;
  console.log(JSON.stringify({chapter,title,band:t.STORY.bandOf(chapter),ace:t.STORY.aceOf(chapter),steps:ch.steps}));
  for(const repeat of (process.env.MAP_REPEAT_ONLY==='true'?[true]:[false,true])) {
    const s=g.freshState();s.travel={to:['johto','hoenn','sinnoh']};s.mons=[{uid:'analysis',id:493,level:100,xp:0,reg:'sinnoh'}];s.team=['analysis'];s.road=['analysis'];
    s.adv={chapter,unlocked:Math.max(58,chapter),runs:1,layout:6,gifts:{},badges:[],kept:{},loops:[],nodes:[],node:0,pending:null,battle:null,capture:{on:false},paused:false};
    // Both routes are fully accessible. Repeats omit one-time kept leaders.
    for(const c of t.STORY.CHAPTERS)for(const step of c.steps){if(step.once)s.adv.gifts[step.once]=true;if(step.gift?.key)s.adv.gifts[step.gift.key]=true;}
    if(repeat)s.adv.kept[chapter]=ch.steps.filter((s:any)=>s.keep).map((s:any)=>s.leader);
    const groups:Record<string,{battles:number;enemies:number;levels:number;xp:number;active:number;min:number;max:number}>={};
    let sumBattles=0,sumEnemies=0,sumLevels=0,sumXp=0,sumActive=0,sumRouteXp2=0,sumBattles2=0,sumXpBattles=0;
    g.sandbox(s,()=>{
      for(let run=0;run<count;run++) {
        a.buildChapter(chapter);const adv=s.adv;let routeXp=0,routeBattles=0;
        for(let index=0;index<adv.nodes.length;index++) {
          const node=adv.nodes[index];if(!['wild','trainer','gym','static'].includes(node.type))continue;
          adv.node=index;adv.battle=null;adv.pending=null;a.step();
          const b=adv.battle;if(!b)throw new Error('Encounter failed to spawn '+JSON.stringify(node));
          const key=node.gymTrainer?'gymTrainer':b.kind;
          const v=groups[key]??={battles:0,enemies:0,levels:0,xp:0,active:0,min:Infinity,max:0};v.battles++;sumBattles++;routeBattles++;
          for(const enemy of b.enemies) {
            const raw=g.levelXp(enemy.level)/t.CONFIG.XP_WINS_PER_LEVEL*Math.sqrt((t.BASE_EXP[enemy.id]||t.CONFIG.XP_BASE_REF)/t.CONFIG.XP_BASE_REF)*(['trainer','gym'].includes(b.kind)?1.5:1);
            const xp=Math.round(raw),active=Math.round(raw*t.CONFIG.XP_ACTIVE_BONUS);
            v.enemies++;v.levels+=enemy.level;v.xp+=xp;v.active+=active;v.min=Math.min(v.min,enemy.level);v.max=Math.max(v.max,enemy.level);
            sumEnemies++;sumLevels+=enemy.level;sumXp+=xp;sumActive+=active;routeXp+=xp;
          }
          adv.battle=null;
        }
        sumRouteXp2+=routeXp**2;
        sumBattles2+=routeBattles**2;sumXpBattles+=routeXp*routeBattles;
      }
    });
    const routeMean=sumXp/count,routeSE=Math.sqrt(Math.max(0,(sumRouteXp2-count*routeMean**2)/(count-1))/count);
    const ratio=sumXp/sumBattles,ratioSE=Math.sqrt(Math.max(0,(sumRouteXp2-2*ratio*sumXpBattles+ratio**2*sumBattles2)/(count-1)/count))/(sumBattles/count);
    const result={chapter,title,repeat,samples:count,phase:t.DAYTIME.phase().key,groups:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,{battlesPerRun:v.battles/count,enemiesPerRun:v.enemies/count,meanLevel:v.levels/v.enemies,minLevel:v.min,maxLevel:v.max,xpPerBattle:v.xp/v.battles,activeXpPerBattle:v.active/v.battles,xpPerRun:v.xp/count}])),
      battlesPerRun:sumBattles/count,enemiesPerRun:sumEnemies/count,meanEnemyLevel:sumLevels/sumEnemies,xpPerBattle:sumXp/sumBattles,activeXpPerBattle:sumActive/sumBattles,xpPerRun:routeMean,
      routeXp95:[routeMean-1.96*routeSE,routeMean+1.96*routeSE],xpPerBattle95:[ratio-1.96*ratioSE,ratio+1.96*ratioSE]};
    summaries.push(result);console.log(JSON.stringify(result));
  }
}
writeFileSync(process.env.MAP_OUTPUT || 'docs/map-experience-comparison.json',JSON.stringify({engine:ENGINE_HASH,at:new Date(now).toISOString(),
  assumptions:['原引擎随机遭遇抽样，非解析精确期望','在线，无伙伴/经验增益，未触顶；每只精灵分别四舍五入','仅击倒奖励，不含捕获/伙伴糖果/道具；单场训练家按整队敌人算一场','满血成功清完整章；不推测战斗耗时；固定时刻的昼夜/天气/每日热点','repeat=false 保留剧情首领；repeat=true 跳过已被永久清除的 keep 首领'],summaries},null,2)+'\n');
