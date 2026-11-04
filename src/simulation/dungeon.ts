import type {Vendor} from './isolated';
import {chapterLabel} from '../core/chapters';
export interface DungeonNode {index:number;key:string;name:string;type:string;chapter:number;localIndex:number;stageName:string}
export interface DungeonInfo {id:string;name:string;chapters:number[];stages:Array<{chapter:number;name:string}>;nodes:DungeonNode[];current:number;stage:number}
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
export function dungeonIdentity(story:Vendor,chapter:number){
  const chapters:number[]=story.leagueOf(chapter)||[chapter],region=story.regionOf(chapter).key;
  const regions:Record<string,string>={kanto:'关都',johto:'城都',hoenn:'丰缘',sinnoh:'神奥'};
  return {id:chapters.length>1?`league:${region}`:`chapter:${chapter}`,name:chapters.length>1?`${regions[region]||region}联盟`:story.CHAPTERS[chapter].name,chapters};
}
/** Native league chapters are stages of one dungeon, not separate objectives. */
export function buildDungeon(t:Vendor,base:Vendor) {
  const g=t.Game,a=t.Adventure,story=t.STORY,currentChapter=base.adv.chapter;
  const identity=dungeonIdentity(story,currentChapter),{chapters}=identity;
  const stageNodes:Record<number,Vendor[]>={},offsets:Record<number,number>={},rawNodes:Vendor[]=[],nodes:DungeonNode[]=[];
  for(const chapter of chapters) {
    if(chapter===currentChapter&&base.adv.nodes?.length)stageNodes[chapter]=copy(base.adv.nodes);
    else if(chapters.length===1)stageNodes[chapter]=copy(base.adv.nodes||[]);
    else {
      const s=copy(base);s.trainer||={};
      g.sandbox(s,()=>a.buildChapter(chapter));
      stageNodes[chapter]=copy(s.adv.nodes);
      // Building the first league stage renews its plan. Preserve the saved
      // entry plan's trainer classes when replaying an already-running dungeon.
      let trainer=0;
      for(const node of stageNodes[chapter])if(node.type==='trainer'&&node.league){const sprite=base.adv.leaguePlan?.[chapter]?.[trainer++];if(sprite)node.sprite=sprite;}
    }
    offsets[chapter]=nodes.length;
    const counts=new Map<string,number>(),stageName=story.CHAPTERS[chapter].name;
    for(const [localIndex,node]of stageNodes[chapter].entries()) {
      const identity=JSON.stringify([chapter,node.type,node.name||node.type]),ordinal=counts.get(identity)||0;counts.set(identity,ordinal+1);
      nodes.push({index:nodes.length,key:`${identity}:${ordinal}`,name:node.name||node.type,type:node.type,chapter,localIndex,stageName});rawNodes.push(copy(node));
    }
    if(chapter!==chapters.at(-1)) {
      const name=`${chapterLabel(stageName)} → ${chapterLabel(story.CHAPTERS[chapter+1].name)}`;
      nodes.push({index:nodes.length,key:`transition:${chapter}`,name,type:'transition',chapter,localIndex:stageNodes[chapter].length,stageName});rawNodes.push({type:'transition',name});
    }
  }
  const info:DungeonInfo={...identity,stages:chapters.map(chapter=>({chapter,name:story.CHAPTERS[chapter].name})),nodes,current:(offsets[currentChapter]||0)+(base.adv.node||0),stage:currentChapter};
  function prepare(s:Vendor,full:boolean){if(full){s.adv.chapter=chapters[0];s.adv.nodes=copy(stageNodes[chapters[0]]);s.adv.node=0;s.adv.battle=null;s.adv.pending=null;}}
  function index(s:Vendor){const offset=offsets[s.adv.chapter];if(offset===undefined)throw new Error('模拟离开了选定副本');return offset+s.adv.node;}
  function finished(s:Vendor){return s.adv.chapter===chapters.at(-1)&&s.adv.node>=s.adv.nodes.length&&!s.adv.battle;}
  function advance(s:Vendor){if(!chapters.includes(s.adv.chapter))throw new Error('副本过场进入了意外章节');s.adv.nodes=copy(stageNodes[s.adv.chapter]);s.adv.node=0;s.adv.battle=null;s.adv.pending=null;}
  return {info,stageNodes,offsets,rawNodes,prepare,index,finished,advance};
}
