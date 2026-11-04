import {referenceEngine} from './reference-engine';
export function leagueFixture(source:string,now=Date.UTC(2026,10,4,12)) {
  const t=referenceEngine(source,now),g=t.Game,s:any=g.freshState();
  s.travel={to:['sinnoh']};s.trainer={};s.mons=[398,445,392,460,94,462].map((id,i)=>({id,uid:String(i),level:95,xp:0,reg:'sinnoh',shiny:true,rank:10}));
  s.team=s.mons.map((m:any)=>m.uid);s.road=[...s.team];
  s.adv={chapter:60,unlocked:65,runs:100,speed:4,layout:6,gifts:{},badges:[],kept:{},loops:[],nodes:[],node:0,battle:null,pending:null};
  g.sandbox(s,()=>t.Adventure.buildChapter(60));
  const entry=JSON.parse(JSON.stringify(s)),next=JSON.parse(JSON.stringify(s));
  g.sandbox(next,()=>t.Adventure.buildChapter(61));next.adv.runs++;
  return {entry,next};
}
