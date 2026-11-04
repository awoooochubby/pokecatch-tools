import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { EventBus } from '../src/core/events';
import { Store } from '../src/core/storage';
import { earnedXp, xpForNext, xpRegion } from '../src/core/experience-rules';
import { createFarming, mapRate } from '../src/modules/farming';
import type { GameEvents, GameSave } from '../src/core/types';
import type { GameAdapter } from '../src/core/game';
import { referenceEngine } from './reference-engine';
function setup(trusted = true, initial = {}) {
  const bus = new EventBus<GameEvents>(), data = new Map<string, string>();
  const store = new Store({ getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); },
    clear: () => data.clear(), key: (i: number) => [...data.keys()][i] ?? null, removeItem: (k: string) => { data.delete(k); }, length: 0 });
  store.set('farming', initial);
  const game = { bus, auditedExperienceRules: () => trusted, monName: () => '火伊布' } as unknown as GameAdapter;
  const module = createFarming(game, store); module.start();
  const save = (xp: number, chapter = 56, level = 50): GameSave => ({ mons: [{uid:'a',id:136,level,xp}],team:['a'],road:['a'],
    travel: {to:['sinnoh']}, adv:{chapter,unlocked:58,runs:1,paused:false,battle:null} });
  const sample = (xp: number, now: number, changes: Partial<GameEvents['sample']> = {}, chapter = 56, level = 50) => bus.emit('sample', {save:save(xp,chapter,level),now,gap:false,visible:true,...changes});
  return { module, save, sample, store };
}
describe('actual map experience', () => {
  it('uses progression region while farming a lower map', () => {
    const {save} = setup(); const s=save(0,1);
    expect(xpRegion(s)).toBe('sinnoh'); s.link={side:'from',from:'johto'}; expect(xpRegion(s)).toBe('johto');
  });
  it('reconstructs multiple level-ups and excludes discarded cap overflow', () => {
    const before={uid:'a',id:136,level:50,xp:100}, after={...before,level:52,xp:0};
    expect(earnedXp(before,after,'sinnoh',true)).toBe(xpForNext(50,0,'sinnoh')+xpForNext(51,0,'sinnoh')-100);
    expect(earnedXp(before,after,'sinnoh',false)).toBeNull();
    expect(earnedXp(after,{...after,xp:0},'sinnoh',true)).toBe(0);
  });
  it('counts actual XP/time including idle/heal travel and ranks maps by rate', () => {
    const {module:m,sample}=setup(); sample(100,1000); sample(200,11000); sample(200,21000);
    expect(m.state.records[0].xp).toBe(100); expect(mapRate(m.state.records[0])).toBe(300);
    sample(900,22000,{},58); sample(1100,32000,{},58);
    expect(m.state.records.map(r=>r.xp)).toEqual([100,200]); expect(mapRate(m.state.records[1],'a')).toBe(1200);
    expect(m.recentRate()).toBe(1200);
  });
  it('excludes background/offline/paused/boundary intervals without shifting their XP into the next one', () => {
    const {module:m,sample,save}=setup(); sample(0,1000); sample(10,2000);
    sample(200,3000,{visible:false}); sample(300,4000,{visible:false}); sample(400,5000); sample(410,6000);
    sample(500,100000,{gap:true}); sample(510,101000);
    const paused=save(700);paused.adv.paused=true;sample(700,102000,{save:paused});sample(800,103000);sample(810,104000);
    expect(m.state.records[0].xp).toBe(40); expect(m.state.records[0].ms).toBe(4000);
    m.stop();m.start();sample(9999,200000);sample(10009,201000);expect(m.state.records[0].xp).toBe(50);
  });
  it('uses the road team and individual exposure time, not the planned party or entire box', () => {
    const {module:m,sample,save}=setup();const s=save(0);s.team=['b'];s.mons.push({uid:'b',id:25,level:5,xp:0});
    sample(0,1000,{save:structuredClone(s)});s.mons[0].xp=25;s.mons[1].xp=1000;sample(0,2000,{save:s});
    expect(m.state.records[0].xp).toBe(25);expect(m.state.records[0].mons.b).toBeUndefined();
    expect(mapRate(m.state.records[0],'a')).toBe(1500);
  });
  it('excludes unknown cross-level intervals and recovers at the next baseline', () => {
    const {module:m,sample}=setup(false);sample(100,1000);sample(20,2000,{},56,51);sample(30,3000,{},56,51);
    expect(m.state.records[0].xp).toBe(10);expect(m.state.records[0].ms).toBe(1000);expect(m.state.records[0].skipped).toBe(1);
  });
  it('keeps history across reload without counting offline XP or time and resets only current map', () => {
    const {module:m,sample}=setup();sample(0,1000);sample(100,2000);sample(100,3000,{},58);sample(200,4000,{},58);
    const reload=setup(true,{records:JSON.parse(JSON.stringify(m.state.records)),selected:'a'});
    reload.sample(9000,100000,{},58);reload.sample(9010,101000,{},58);
    expect(reload.module.state.records[1].xp).toBe(110);expect(reload.module.state.selected).toBe('a');
    reload.module.resetCurrent();expect(reload.module.state.records.map(r=>r.key)).toEqual(['56']);
  });
});
const integration = existsSync('.cache/engine.js') ? describe : describe.skip;
integration('pinned XP formula parity', () => {
  it('matches original Game.xpForNext at every level, region and rank', () => {
    const t=referenceEngine(readFileSync('.cache/engine.js','utf8')), g=t.Game, s=g.freshState();
    s.adv={unlocked:58};
    g.sandbox(s,()=>{
      for(const region of ['kanto','johto','hoenn','sinnoh']) {
        s.link={side:'from',from:region};
        for(let level=1;level<=100;level++)for(let rank=0;rank<=5;rank++) expect(xpForNext(level,rank,region)).toBe(g.xpForNext(level,{rank}));
      }
    });
  });
});
