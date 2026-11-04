import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createSimulator, orderCandidates } from '../src/simulation/engine';
import { verifySource } from '../src/simulation/program';
import { Moments, wilson, qualifies } from '../src/simulation/statistics';
import type { Options } from '../src/simulation/types';
import { estimateWork, parseCustomTargets } from '../src/simulation/planning';
import { referenceEngine } from './reference-engine';

describe('simulation statistics and bounded searches', () => {
  it('does not label a finite all-win sample as guaranteed', () => { const e = wilson(1024, 1024); expect(e.mean).toBe(1); expect(e.low).toBeLessThan(1); expect(e.low).toBeGreaterThan(.99); });
  it('includes losing samples and uses uncertainty for qualification', () => {
    const m = new Moments(); m.add(.2); m.add(.4); m.add(1);
    expect(m.interval([0, 1]).mean).toBeCloseTo(1.6 / 3);
    expect(qualifies(wilson(128, 128), m.interval([0, 1]), .95, .3)).toBe(false);
    const constant = new Moments(); for (let i = 0; i < 128; i++) constant.add(0);
    expect(constant.interval([0, 1]).high).toBeGreaterThan(0);
  });
  it('enumerates small teams and explicitly bounds larger searches', () => {
    expect(orderCandidates(['a', 'b', 'c']).orders).toHaveLength(6);
    const xs = orderCandidates(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(xs.orders).toHaveLength(16); expect(xs.search).toContain('局部搜索');
  });
  it('rejects a different remote engine instead of silently using stale rules', async () => { await expect(verifySource('wrong version')).rejects.toThrow('未经验证'); });
  it('parses custom lists and rejects invalid entries before running', () => {
    expect(parseCustomTargets('478:52, 460@50;\n')).toEqual([{id:478,level:52},{id:460,level:50}]);
    expect(() => parseCustomTargets('雪妖女')).toThrow('图鉴编号');
  });
});

const hasEngine = existsSync('.cache/engine.js');
const integration = hasEngine ? describe : describe.skip;
const now = new Date(2026, 10, 4, 12).getTime();
function snapshot(ids = [136, 392]) {
  return { travel: { to: ['sinnoh'] }, mons: ids.map((id, i) => ({ id, uid: String(i), level: 52, xp: 0, shiny: false, rank: 0, reg: 'sinnoh' })), team: ids.map((_, i) => String(i)),
    adv: { chapter: 55, unlocked: 55, runs: 1, layout: 6, gifts: {}, badges: [], kept: {}, loops: [], pending: null, node: 0,
      nodes: [{ type: 'wild', name: '测试路段', bg: 'prairie', pool: [{ id: 478, min: 52, max: 52, w: 1 }] },
        { type: 'gym', name: '冰雪道馆', bg: 'gym-ice', gym: { leader: 'Gladys', type: 'ice', reward: 4700, power: .97, team: [[215, 40], [221, 40], [460, 42], [478, 44]] } }], battle: null } };
}
const options = (changes: Partial<Options> = {}): Options => ({ trials: 128, seed: 1729, start: 'full', targetKeys: [], candidateUids: ['0'], scanLevels: false, sequence: false,
  maxLoss: .3, minWin: .95, mode: 'matrix', autoSwitch: 'current', ...changes });
integration('audited current game engine', () => {
  const source = hasEngine ? readFileSync('.cache/engine.js', 'utf8') : '';
  it('keeps current surviving enemies separate from future nodes and excludes already defeated members', async () => {
    const s:any=snapshot();s.adv.nodes[0]={type:'trainer',name:'本场训练家',trainer:'训练家',sprite:'youngster',team:[[10,1],[478,52]]};
    s.adv.battle={kind:'trainer',enemies:[{uid:'dead',id:10,level:1,hp:0},{uid:'alive',id:478,level:52,hp:80}]};
    const engine=await createSimulator(source,JSON.stringify(s),now);
    expect(engine.catalog.targets.filter(t=>t.source==='current').map(t=>t.id)).toEqual([478]);
    expect(engine.catalog.targets.filter(t=>t.source!=='current').every(t=>t.nodeIndex!==0)).toBe(true);
  });
  it('lists native fixed league trainers in the correct chapter and preserves their HP model', async () => {
    const t=referenceEngine(source,now),s:any=Object.assign(t.Game.freshState(),snapshot([136]));s.adv.chapter=60;s.adv.unlocked=65;
    let hp=0;
    t.Game.sandbox(s,()=>{t.Adventure.buildChapter(60);t.Adventure.step();t.Adventure.step();hp=t.Game.curHp(s.adv.battle.enemies[0]);});
    const saved=JSON.parse(JSON.stringify(s));saved.adv.battle=null;saved.adv.node=0;
    const engine=await createSimulator(source,JSON.stringify(saved),now);
    expect(engine.catalog.chapterIndex).toBe(60);expect(engine.catalog.targets.filter(t=>t.source==='trainer'&&t.chapterIndex===60)).toHaveLength(10);
    const target=engine.catalog.targets.find(t=>t.source==='trainer'&&t.id===279)!;
    expect(target.level).toBe(74);
    const report=await engine.run(options({targetKeys:[target.key]}),()=>{});expect(report.results[0].facts.enemyHp).toBe(hp);
  },30000);
  it('explains an actual defeat before the next center and keeps a usable counter target', async () => {
    const s:any=snapshot([129]);s.mons[0].level=5;
    s.adv.nodes=[{type:'trainer',name:'危险训练家',trainer:'测试训练家',sprite:'youngster',bg:'cave',team:[[478,52]]},
      {type:'trainer',name:'后续训练家',trainer:'测试训练家',sprite:'youngster',bg:'cave',team:[[10,1]]},{type:'heal',name:'Frimapic',bg:'town'}];
    const engine=await createSimulator(source,JSON.stringify(s),now),report=await engine.run(options({mode:'route'}),()=>{}),route=report.routes[0];
    expect(route.win.mean).toBe(0);expect(route.failures?.[0]).toMatchObject({node:0,id:478,count:128,nextCenter:'Frimapic',battlesToCenter:1});
    expect(route.threats?.[0]).toMatchObject({id:478,wear:1,kos:1});
    const key=route.failures![0].targetKey!,target=report.catalog.targets.find(t=>t.key===key)!;
    expect(target.source).toBe('diagnostic');expect(target.foes[0].hp).toBeGreaterThan(0);
    const counter=await engine.run(options({targetKeys:[key]}),()=>{});
    expect(counter.results[0].facts.enemyHp).toBe(target.foes[0].hp);
  },30000);
  it('does not invent a before-center defeat when the route is completed', async () => {
    const s:any=snapshot([136]);s.adv.nodes=[{type:'trainer',name:'容易的训练家',trainer:'测试训练家',sprite:'youngster',bg:'cave',team:[[10,1]]},{type:'heal',name:'Frimapic',bg:'town'}];
    const engine=await createSimulator(source,JSON.stringify(s),now),report=await engine.run(options({mode:'route'}),()=>{});
    expect(report.routes[0].win.mean).toBe(1);expect(report.routes[0].failures).toEqual([]);
  },30000);
  it('uses the real engine for final-hit counting, repeatability and no snapshot writes', async () => {
    const save = JSON.stringify(snapshot()), engine = await createSimulator(source, save, now);
    expect(engine.catalog.cap).toBe(52); expect(engine.catalog.targets.length).toBeGreaterThan(0);
    const opts = options({ targetKeys: ['gym:1:3'] });
    const a = await engine.run(opts, () => {}), b = await engine.run(opts, () => {});
    expect(a).toEqual(b); expect(a.results[0].facts.damage).toEqual([258, 304]);
    // The terminal hit must count: it was easily lost when the engine stopped
    // before rewards. No non-critical Flareon hit can remove 399 HP alone.
    expect(Object.keys(a.results[0].hits).some(n => Number(n) >= 2)).toBe(true);
    expect(Object.values(a.results[0].hits).reduce((n, count) => n + count, 0)).toBe(a.results[0].wins);
    expect(save).toBe(JSON.stringify(snapshot()));
  }, 30000);
  it('rejects over-cap candidates, preserves HP/status and evaluates each integer training level', async () => {
    const s = snapshot([461]); s.mons[0].level = 51;
    const engine = await createSimulator(source, JSON.stringify(s), now);
    const report = await engine.run(options({ targetKeys: [engine.catalog.targets[0].key], scanLevels: true }), () => {});
    expect(report.results.map(x => x.level)).toEqual([51, 52]);
    expect(report.results[0].trainingXp).toBe(0);
    expect(report.results[1].trainingXp).toBeGreaterThan(0);
    s.mons[0].level = 53;
    const capped = await createSimulator(source, JSON.stringify(s), now); expect(capped.catalog.candidates[0].eligible).toBe(false);
  }, 30000);
  it('compares real consecutive route orders with both auto-switch policies', async () => {
    const engine = await createSimulator(source, JSON.stringify(snapshot()), now);
    const report = await engine.run(options({ candidateUids: ['0', '1'], mode: 'order' }), () => {});
    expect(report.routes).toHaveLength(4); expect(report.routes.some(r => r.baseline)).toBe(true);
    expect(report.routes.every(r => r.win.mean >= 0 && r.wear.mean >= 0)).toBe(true);
  }, 60000);
  it('preserves current paralysis/burn and a fainted ally, but explicitly clears them in full-health mode', async () => {
    const s: any = snapshot([136]); s.mons[0].status = 'burn'; s.mons[0].hp = 200;
    const engine = await createSimulator(source, JSON.stringify(s), now), key = 'gym:1:3';
    const current = await engine.run(options({ start: 'current', targetKeys: [key] }), () => {});
    const full = await engine.run(options({ start: 'full', targetKeys: [key] }), () => {});
    expect(current.results[0].facts.damage[0]).toBeLessThan(full.results[0].facts.damage[0]);
    s.mons[0].hp = 0;
    const fainted = await createSimulator(source, JSON.stringify(s), now);
    const dead = await fainted.run(options({ start: 'current', targetKeys: [key] }), () => {});
    expect(dead.results[0].wins).toBe(0); expect(dead.results[0].loss.mean).toBe(1);
    expect(dead.results[0].actions.mean).toBe(0);
  }, 30000);
  it('keeps the exact speed boundary: level 52 Infernape is slower, Weavile faster, Gengar ties', async () => {
    const s = snapshot([392, 461, 94]), engine = await createSimulator(source, JSON.stringify(s), now);
    const report = await engine.run(options({ candidateUids:['0','1','2'], targetKeys:['gym:1:3'] }), () => {});
    expect(report.results.map(r=>r.facts.order)).toEqual(['速度后手','速度先手','同速随机']);
    expect(report.results.map(r=>r.facts.speed)).toEqual([117,135,119]);
    expect(report.results.every(r=>r.facts.enemyHp===399)).toBe(true);
  }, 30000);
  it('freezes XP after intermediate KOs in multi-enemy fights', async () => {
    const s: any = snapshot([136]); s.mons[0].level=50;
    const costs=await createSimulator(source,JSON.stringify(s),now);
    const costReport=await costs.run(options({scanLevels:true,targetKeys:[costs.catalog.targets[0].key]}),()=>{});
    s.mons[0].xp=costReport.results.find(r=>r.level===51)!.trainingXp-1;
    s.adv.nodes=[{type:'trainer',name:'测试训练家',trainer:'测试训练家',sprite:'youngster',bg:'prairie',team:[[10,1],[478,52]]}];
    const engine=await createSimulator(source,JSON.stringify(s),now);
    // The in-engine invariant rejects any level change. Before the fix, the
    // first Caterpie reward silently raised this nearly-levelled ally to cap.
    const report=await engine.run(options({mode:'route'}),()=>{});
    expect(report.routes[0].win.mean).toBeGreaterThan(0);
  },30000);
  it('counts repeated faints across healing centers rather than only ending KOs', async () => {
    const s: any=snapshot([129,136]);s.mons[0].level=5;s.autoSwitch=false;
    const wild={type:'wild',name:'重复路线',bg:'prairie',pool:[{id:478,min:52,max:52,w:1}]};
    s.adv.nodes=[wild,{type:'heal',name:'Frimapic',bg:'town'},wild,{type:'heal',name:'Frimapic',bg:'town'},wild];
    const engine=await createSimulator(source,JSON.stringify(s),now);
    const report=await engine.run(options({mode:'route',candidateUids:['0','1'],autoSwitch:'off'}),()=>{});
    expect(report.routes[0].kos.mean).toBeGreaterThan(2.5);
    expect(report.routes[0].kos.high).toBeGreaterThan(2);
  },30000);
  it('allows a healing center to revive an initially fainted party outside combat', async () => {
    const s:any=snapshot([136]);s.mons[0].hp=0;
    s.adv.nodes=[{type:'heal',name:'Frimapic',bg:'town'}];
    const engine=await createSimulator(source,JSON.stringify(s),now);
    const report=await engine.run(options({mode:'route',start:'current'}),()=>{});
    expect(report.routes[0].win.mean).toBe(1);expect(report.routes[0].loss.mean).toBe(0);expect(report.routes[0].kos.mean).toBe(0);
  },30000);
  it('ignores unused custom targets in route mode and retains a usable engine after input errors',async()=>{
    const engine=await createSimulator(source,JSON.stringify(snapshot()),now);
    await expect(engine.run(options({candidateUids:[]}),()=>{})).rejects.toThrow('请选择');
    const report=await engine.run(options({mode:'route',targetKeys:['obsolete']}),()=>{},[{id:999999,level:0}]);
    expect(report.routes).toHaveLength(1);
    expect(estimateWork(engine.catalog,options({scanLevels:true,targetKeys:['gym:1:3']})).groups).toBe(1);
  },30000);
});
