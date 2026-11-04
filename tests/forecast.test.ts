import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createForecast, forecastRate } from '../src/simulation/forecast';
import type { ForecastOptions } from '../src/simulation/forecast-types';
import { referenceEngine } from './reference-engine';
const now = Date.UTC(2026, 10, 4, 12), hasEngine = existsSync('.cache/engine.js');
const integration = hasEngine ? describe : describe.skip;
const source = hasEngine ? readFileSync('.cache/engine.js', 'utf8') : '';
describe('forecast rates', () => {
  it('uses all experience divided by all time, including short failures', () => {
    const value = forecastRate([{xp:100,ms:10000},{xp:0,ms:1000}]);
    expect(value.mean).toBeCloseTo(100*60000/11000);
    expect(value.mean).not.toBe(300); expect(value.low).toBeLessThan(value.mean); expect(value.high).toBeGreaterThan(value.mean);
  });
  it('returns zero for capped zero-XP runs and rejects zero-duration input', () => {
    expect(forecastRate([{xp:0,ms:10},{xp:0,ms:20}])).toEqual({mean:0,low:0,high:0});
    expect(()=>forecastRate([])).toThrow();
  });
});
integration('native full-chapter XP forecast', () => {
  function snapshot(level=68, ids=[398,445,392,460,94,462]) {
    const t=referenceEngine(source,now), gifts:Record<string,boolean>={};
    for(const ch of t.STORY.CHAPTERS)for(const step of ch.steps){if(step.once)gifts[step.once]=true;if(step.gift?.key)gifts[step.gift.key]=true;}
    return {travel:{to:['sinnoh']},trainer:{},mons:ids.map((id,i)=>({uid:String(i),id,level,xp:0,reg:'sinnoh'})),team:ids.map((_,i)=>String(i)),road:ids.map((_,i)=>String(i)),
      stats:{battles:0},adv:{chapter:59,unlocked:59,runs:1,speed:1,layout:6,gifts,badges:[],kept:{},loops:[],nodes:[],node:0,battle:null,pending:null}};
  }
  const options = (changes: Partial<ForecastOptions> = {}):ForecastOptions => ({chapters:[48],trials:128,seed:1729,start:'full',...changes});
  it('simulates native rewards and centers, repeats seeds, and leaves the original save untouched', async () => {
    const s=snapshot(), raw=JSON.stringify(s), engine=await createForecast(source,raw,now);
    expect(engine.catalog.chapters.some(ch=>ch.id===59)).toBe(true);expect(engine.catalog.stepMs).toBe(2800);
    const a=await engine.run(options(),()=>{}), b=await engine.run(options(),()=>{});
    expect(a).toEqual(b);expect(a.rows[0].error).toBeUndefined();expect(a.rows[0].complete.mean).toBe(1);
    expect(a.rows[0].xp.mean).toBeGreaterThan(0);expect(a.rows[0].rate.mean).toBeCloseTo(a.rows[0].xp.mean*60/a.rows[0].seconds.mean);
    expect(Object.values(a.rows[0].members).reduce((sum,m)=>sum+m.xp.mean,0)).toBeCloseTo(a.rows[0].xp.mean);
    expect(JSON.stringify(s)).toBe(raw);
  },60000);
  it('counts the one XP needed to level to cap and discards every overflow reward', async () => {
    const s=snapshot(71), t=referenceEngine(source,now), g=t.Game, state=Object.assign(g.freshState(),JSON.parse(JSON.stringify(s)));
    g.sandbox(state,()=>{for(const m of s.mons)m.xp=g.xpForNext(71,m)-1;});
    const engine=await createForecast(source,JSON.stringify(s),now), report=await engine.run(options(),()=>{}), row=report.rows[0];
    expect(row.error).toBeUndefined();expect(row.xp.mean).toBe(6);expect(row.complete.mean).toBe(1);
    for(const m of Object.values(row.members)){expect(m.xp.mean).toBe(1);expect(m.levels.mean).toBe(1);expect(m.capped).toBe(1);}
  },60000);
  it('includes defeated attempts and their elapsed action time', async () => {
    const engine=await createForecast(source,JSON.stringify(snapshot(5,[129])),now), report=await engine.run(options({chapters:[59]}),()=>{}), row=report.rows[0];
    expect(row.error).toBeUndefined();expect(row.complete.mean).toBe(0);expect(row.faints.mean).toBeGreaterThan(0);
    expect(row.seconds.mean).toBeGreaterThan(0);expect(row.xp.mean).toBe(0);expect(row.rate.mean).toBe(0);
  },60000);
  it('uses the native buddy candy/private XP path as well as the 1.3 multiplier', async () => {
    const s:any=snapshot(68,[398]);s.buddy={uid:'0',ko:49};
    const withBuddy=await createForecast(source,JSON.stringify(s),now), a=await withBuddy.run(options(),()=>{});
    delete s.buddy;
    const withoutBuddy=await createForecast(source,JSON.stringify(s),now), b=await withoutBuddy.run(options(),()=>{});
    expect(a.rows[0].error).toBeUndefined();expect(b.rows[0].error).toBeUndefined();
    // Buddy candy uses private gainXp and is absent from direct battle XP events.
    expect(a.rows[0].xp.mean).toBeGreaterThan(b.rows[0].xp.mean*1.4);
  },60000);
  it('rejects locked chapters and budgets, then allows another request', async () => {
    const engine=await createForecast(source,JSON.stringify(snapshot(72)),now);
    await expect(engine.run(options({chapters:[65]}),()=>{})).rejects.toThrow('已解锁');
    await expect(engine.run(options({trials:8192}),()=>{})).rejects.toThrow('2048');
    const report=await engine.run(options(),()=>{});expect(report.rows[0].error).toBeUndefined();expect(report.rows[0].xp.mean).toBe(0);
  },60000);
  it('applies the game speed pacing rather than multiplying advertised speed directly', async () => {
    const s:any=snapshot(68,[398]);
    const first=await createForecast(source,JSON.stringify(s),now), a=await first.run(options(),()=>{});
    s.adv.speed=4;
    const fast=await createForecast(source,JSON.stringify(s),now), b=await fast.run(options(),()=>{});
    expect(fast.catalog.speed).toBe(2.5);expect(fast.catalog.stepMs).toBe(1120);
    expect(b.rows[0].steps.mean).toBe(a.rows[0].steps.mean);
    expect(b.rows[0].seconds.mean).toBeCloseTo(a.rows[0].seconds.mean/2.5);
    expect(b.rows[0].rate.mean).toBeCloseTo(a.rows[0].rate.mean*2.5);
  },60000);
  it('restores requested current HP after map entry instead of silently making both modes full health', async () => {
    const s:any=snapshot(68,[445]);s.mons[0].hp=1;
    const engine=await createForecast(source,JSON.stringify(s),now);
    const current=await engine.run(options({chapters:[59],start:'current'}),()=>{});
    const full=await engine.run(options({chapters:[59],start:'full'}),()=>{});
    expect(current.rows[0].error).toBeUndefined();expect(full.rows[0].error).toBeUndefined();
    expect(current.rows[0].seconds.mean).toBeLessThan(full.rows[0].seconds.mean);
    expect(s.mons[0].hp).toBe(1);
  },60000);
});
