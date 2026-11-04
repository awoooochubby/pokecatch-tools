import {buildDungeon,dungeonIdentity} from './dungeon';
import { isolatedEngine, type Vendor } from './isolated';
import { ENGINE_HASH } from './program';
import { Moments, wilson } from './statistics';
import type { ForecastCatalog, ForecastOptions, ForecastReport, ForecastRow, NodeForecastOptions, NodeForecastReport, NodeForecastMetric } from './forecast-types';
import type { Estimate } from './types';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const FORECAST_BUDGET = 8192;
export interface RateSample { xp: number; ms: number }
interface Attempt { complete: boolean; ms: number; steps: number; battles: number; faints: number;
  xp: Record<string, number>; levels: Record<string, number>; capped: Record<string, boolean>;
  nodes:Array<{xp:Record<string,number>;reached:boolean;complete:boolean}>;blocked?:{index:number;reason:string} }
// A ratio of totals, including failures. Mean(XP/time) would over-weight short
// losing attempts and can recommend a different map than total XP / total time.
export function forecastRate(samples: RateSample[]): Estimate {
  const ms = samples.reduce((sum, s) => sum + s.ms, 0), xp = samples.reduce((sum, s) => sum + s.xp, 0);
  if (!samples.length || ms <= 0) throw new Error('模拟耗时无效');
  const ratio = xp / ms, residual = new Moments();
  samples.forEach(s => residual.add(s.xp - ratio * s.ms));
  const radius = samples.length > 1 ? 1.96 * Math.sqrt(residual.m2 / (samples.length - 1) / samples.length) / (ms / samples.length) : Infinity;
  return { mean: ratio * 60000, low: Math.max(0, (ratio - radius) * 60000), high: (ratio + radius) * 60000 };
}

export async function createForecast(source: string, rawSave: string, now: number) {
  const original: Vendor = JSON.parse(rawSave);
  if (!Array.isArray(original.mons) || !Array.isArray(original.team) || !Number.isInteger(original.adv?.chapter)) throw new Error('请先进入普通冒险并等待保存');
  if (original.adv.event || original.adv.zone || original.adv.tower) throw new Error('请回到普通冒险后再比较刷图效率');
  let seed = 1, hp = new Map<string, number>(), recording = false, faints = 0;
  const isolated = await isolatedEngine(source, now, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }, event => {
    if (recording && typeof event.hp === 'number') {
      const uid = String(event.type === 'attack' ? event.target : event.uid), previous = hp.get(uid);
      if (previous !== undefined) { if (previous > 0 && event.hp <= 0) faints++; hp.set(uid, event.hp); }
    }
    return event;
  });
  const { t } = isolated, g = t.Game, a = t.Adventure, cfg = t.CONFIG;
  for (const key of original.travel?.to || []) { const r = t.STORY.REGIONS.find((r: Vendor) => r.key === key); if (r) r.open = true; }
  const region = t.STORY.regionOf(original.adv.chapter);
  if (!region?.open) throw new Error('存档缺少当前地区解锁信息');
  function clean() {
    const s = Object.assign(g.freshState(), clone(original));
    s.stats = { ...g.freshState().stats, ...s.stats }; s.buffs ||= {}; s.items ||= {}; s.dex ||= {}; s.seen ||= {}; s.seenShiny ||= {}; s.trainer ||= {};
    s.adv.gifts ||= {}; s.adv.badges ||= []; s.adv.kept ||= {}; s.adv.loops ||= []; s.adv.layout ??= 6; s.adv.paused = false;
    return s;
  }
  const base = clean();
  const dungeon=buildDungeon(t,base);
  let catalog!: ForecastCatalog;
  g.sandbox(base, () => {
    if (g.currentRegion().key !== region.key) throw new Error('跨地区钱包切换暂未适配，请在当前钱包地区比较地图');
    const team = g.teamMons();
    if (!team.length || team.length > cfg.TEAM_SIZE) throw new Error('当前没有可用的出战队伍');
    for (const m of team) if (!g.DEX[m.id] || g.can(m) || m.level > g.capFor(m)) throw new Error('出战队伍包含未知、不可用或超过地区等级上限的精灵');
    const speedValue = +base.adv.speed || 1;
    base.adv.speed = cfg.SPEEDS.includes(speedValue) ? speedValue : Math.max(1, ...cfg.SPEEDS.filter((n: number) => n <= speedValue));
    catalog = { version: ENGINE_HASH.slice(0, 10), capturedAt: now, current: base.adv.chapter,
      chapters: t.STORY.CHAPTERS.flatMap((ch: Vendor, id: number) => id <= (base.adv.unlocked || 0) && t.STORY.regionOf(id).key === region.key ? [{ id, name: ch.name,entry:dungeonIdentity(t.STORY,id).chapters[0],dungeonName:dungeonIdentity(t.STORY,id).name }] : []),
      team: team.map((m: Vendor) => ({ uid: String(m.uid), id: m.id, level: m.level, xp: m.xp, cap: g.capFor(m), hp: g.curHp(m), maxHp: g.maxHp(m), status: m.status || '', rank: g.rankOf(m) })),
      autoSwitch: base.autoSwitch !== false, speed: a.speed(), stepMs: Math.max(cfg.ACTION_MS, cfg.STEP_MS) / a.speed(), buddy: base.buddy?.uid == null ? null : String(base.buddy.uid), xpBoost: g.buffMult('xp') };
    catalog.nodeIndex=dungeon.info.current;catalog.nodes=dungeon.info.nodes;catalog.dungeon=dungeon.info;
  });
  let ledger: Record<string, number> = {};

  function attempt(chapter: number, start: ForecastOptions['start'], scope?:NodeForecastOptions['scope'],wholeDungeon=false): Attempt {
    const s = clean(), party = catalog.team.map(m => s.mons.find((mon: Vendor) => String(mon.uid) === m.uid));
    s.team = party.map((m: Vendor) => m.uid); s.road = [...s.team];
    ledger = Object.fromEntries(catalog.team.map(m => [m.uid, 0])); hp = new Map(); faints = 0;
    let steps = 0, battles = 0, complete = false;
    let activeNode=scope==='remaining'?dungeon.info.current:0,blocked:Attempt['blocked'];
    const nodes:Attempt['nodes']=scope?dungeon.info.nodes.map(()=>({xp:Object.fromEntries(catalog.team.map(m=>[m.uid,0])),reached:false,complete:false})):[];
    isolated.setTime(now);
    return g.sandbox(s, () => {
      const league:number[]|null=!scope&&wholeDungeon?t.STORY.leagueOf(chapter):null;
      if(!scope)a.buildChapter(chapter);else dungeon.prepare(s,scope==='full');
      // Map selection normally heals. Restore the requested initial state after
      // building; centers encountered during the route still heal natively.
      for (const m of party) {
        const old = base.mons.find((old: Vendor) => String(old.uid) === String(m.uid));
        for (const key of Object.keys(m)) delete m[key];
        Object.assign(m, clone(old));
        if (start === 'full') { t.STATUS.clear(m); m.hp = g.maxHp(m); }
        hp.set(String(m.uid), g.curHp(m));
      }
      recording = true;
      try {
        for (; steps < 20000;) {
          activeNode=scope?dungeon.index(s):s.adv.node;
          const node=nodes[activeNode];if(node)node.reached=true;
          if(scope&&s.adv.battle&&(s.adv.battle.boss||s.adv.battle.roam))throw new Error('该节点包含尚未适配的特殊首领');
          const saved=s.adv.nodes[s.adv.node];
          if(scope==='full'&&!s.adv.battle&&saved&&s.adv.gifts[saved.gift?.key||saved.once||saved.find?.once]){node.complete=true;s.adv.node++;s.adv.pending=null;continue;}
          if (s.adv.pending) throw new Error('该图含需手动确认的赠送或选择，请先在游戏中完成');
          if (!s.adv.battle && (scope?dungeon.finished(s):s.adv.node>=s.adv.nodes.length&&(!league||s.adv.chapter===league.at(-1)))) { complete = true; steps++; break; }
          // Native buddy/duplicate rewards call private XP helpers directly;
          // comparing the entire step also captures those and cap overflow.
          const before = party.map((m: Vendor) => ({ level: m.level, xp: m.xp }));
          const events: Vendor[] = a.step(); steps++;
          for (const [i, m] of party.entries()) {
            let actual = m.xp - before[i].xp;
            for (let level = before[i].level; level < m.level; level++) actual += g.xpForNext(level, m);
            if (!Number.isSafeInteger(actual) || actual < 0 || m.level < before[i].level) throw new Error('实际经验无法确认，已停止该图模拟');
            ledger[String(m.uid)] += actual;
            if(node)node.xp[String(m.uid)]+=actual;
          }
          isolated.setTime(now + steps * catalog.stepMs);
          a.addTime(Math.max(cfg.ACTION_MS, cfg.STEP_MS));
          if(node&&!events.some(event=>event.type==='defeat')&&(events.some(event=>event.type==='chapterEnd')||dungeon.index(s)>activeNode))node.complete=true;
          for (const event of events) {
            if (event.type === 'battleStart') battles++;
            if(event.type==='defeat')return finish();
            if(event.type==='chapterEnd'){if(scope)dungeon.advance(s);else if(!league){complete=true;return finish();}}
            if (event.type === 'waiting' || event.type === 'gift') throw new Error('该图含需手动确认的赠送或选择，请先在游戏中完成');
            if (event.roam || event.raid || event.type === 'zoneLoop') throw new Error('该图出现尚未适配的特殊首领，已停止估算');
          }
          for (const m of party) hp.set(String(m.uid), g.curHp(m));
        }
        if (!complete) throw new Error('该图超过行动上限，未完成样本不参与排名');
        return finish();
      } catch(e) {
        if(!scope)throw e;
        blocked={index:Math.min(activeNode,nodes.length-1),reason:(e as Error).message};return finish();
      } finally { recording = false; }
      function finish() {
        return { complete, ms: steps * catalog.stepMs, steps, battles, faints, xp: { ...ledger },nodes,blocked,
          levels: Object.fromEntries(party.map((m: Vendor, i: number) => [String(m.uid), m.level - catalog.team[i].level])),
          capped: Object.fromEntries(party.map((m: Vendor) => [String(m.uid), g.capped(m)])) };
      }
    });
  }
  async function run(options: ForecastOptions, progress: (completed: number, total: number, row?: ForecastRow) => void): Promise<ForecastReport> {
    const opts = clone(options);
    if (!Array.isArray(opts.chapters) || !opts.chapters.length || opts.chapters.length > 16 || new Set(opts.chapters).size !== opts.chapters.length
      || opts.chapters.some(id => !catalog.chapters.some(ch => ch.id === id))) throw new Error('请选择当前地区已解锁的地图，最多 16 张');
    if (!Number.isInteger(opts.trials) || opts.trials < 128 || opts.trials > 2048 || opts.chapters.length * opts.trials > FORECAST_BUDGET) throw new Error('模拟次数需为 128–2048，合计最多 8192 轮');
    if (!Number.isInteger(opts.seed) || !['full', 'current'].includes(opts.start)) throw new Error('模拟参数无效');
    const report: ForecastReport = { catalog: clone(catalog), options: opts, rows: [], generatedAt: now, assumptions: [
      '无需实战采集；随机遭遇、命中、暴击等在独立状态中重复模拟，显示近似 95% 抽样区间。',
      '从所选章开头模拟一轮，实际先后手、招式、状态、治疗、升级、等级上限、伙伴和捕获奖励采用原引擎。只统计快照出战成员的实得经验，不自动确认进化或使用道具。',
      '预计耗时采用在线非冒险页面的标准行动节奏 max(ACTION_MS, STEP_MS) / 游戏速度；不等同于前台动画的实测秒数，不包含手动停顿和首次图鉴弹窗。',
      '失败尝试在原引擎回城治疗后结束，其已得经验和耗时均计入；XP/分采用总经验/总时间，非只取通关样本。',
      opts.unit==='dungeon'?'一轮按完整副本执行；联盟包含各位四天王和冠军、道中及原生阶段交接治疗，允许副本内自然推进进度，在离开副本前停止。每个样本仍从相同快照开始。':'一轮结束前停止，不提高快照的章节进度上限；每个样本从相同等级、经验、队伍顺序和加成开始，独立模拟该轮中途升级。',
      '模拟时钟按标准节奏推进，包含增益到期和昼夜天气变化。置信区间仅含抽样误差，不含动画和计时模型误差。',
      '仅支持当前地区已解锁的普通章节；未接入漫游首领生成和其他系统的被动收益。需要手动确认的赠送或选择会标记该图暂不能计算，不按零收益参与排名。',
    ] };
    let completed = 0; const total = opts.chapters.length * opts.trials;
    for (const chapter of opts.chapters) {
      const xp = new Moments(), seconds = new Moments(), steps = new Moments(), battles = new Moments(), faints = new Moments(), rates: RateSample[] = [];
      const members = Object.fromEntries(catalog.team.map(m => [m.uid, { xp: new Moments(), levels: new Moments(), rates: [] as RateSample[], capped: 0 }]));
      let wins = 0, error = '';
      for (let i = 0; i < opts.trials; i++) {
        seed = (opts.seed + Math.imul(i + 1, 2654435761)) >>> 0;
        try {
          const r = attempt(chapter, opts.start,undefined,opts.unit==='dungeon'), totalXp = Object.values(r.xp).reduce((a, b) => a + b, 0);
          wins += +r.complete; xp.add(totalXp); seconds.add(r.ms / 1000); steps.add(r.steps); battles.add(r.battles); faints.add(r.faints); rates.push({ xp: totalXp, ms: r.ms });
          for (const [uid, m] of Object.entries(members)) { m.xp.add(r.xp[uid]); m.levels.add(r.levels[uid]); m.rates.push({ xp: r.xp[uid], ms: r.ms }); m.capped += +r.capped[uid]; }
        } catch (e) { error = (e as Error).message; break; }
        if ((i + 1) % 16 === 0) { progress(completed + i + 1, total); await new Promise(resolve => setTimeout(resolve, 0)); }
      }
      completed += opts.trials;
      const empty = { mean: 0, low: 0, high: 0 }, ch = catalog.chapters.find(ch => ch.id === chapter)!,name=opts.unit==='dungeon'?ch.dungeonName||ch.name:ch.name;
      const row: ForecastRow = error ? { chapter, name, trials: xp.n, error, complete: empty, seconds: empty, steps: empty, battles: empty, faints: empty, xp: empty, rate: empty, members: {} }
        : { chapter, name, trials: opts.trials, complete: wilson(wins, opts.trials), seconds: seconds.interval([0, Infinity]), steps: steps.interval([0, Infinity]), battles: battles.interval([0, Infinity]),
          faints: faints.interval([0, Infinity]), xp: xp.interval([0, Infinity]), rate: forecastRate(rates),
          members: Object.fromEntries(Object.entries(members).map(([uid, m]) => [uid, { xp: m.xp.interval([0, Infinity]), levels: m.levels.interval([0, Infinity]), capped: m.capped / opts.trials, rate: forecastRate(m.rates) }])) };
      report.rows.push(row); progress(completed, total, row); await new Promise(resolve => setTimeout(resolve, 0));
    }
    return report;
  }
  async function runNodes(options:NodeForecastOptions,progress:(completed:number,total:number)=>void):Promise<NodeForecastReport> {
    const opts=clone(options),meta=catalog.nodes||[];
    if(!original.adv.nodes?.length||!meta.length||!Number.isInteger(original.adv.node)||original.adv.node<0||original.adv.node>original.adv.nodes.length)throw new Error('当前没有已保存的章节节点，请进入冒险地图并等待保存');
    if(!Number.isInteger(opts.trials)||opts.trials<128||opts.trials>2048||!Number.isInteger(opts.seed)||!['full','remaining'].includes(opts.scope))throw new Error('节点模拟参数无效；次数需为 128–2048');
    const fromNode=opts.scope==='remaining'?dungeon.info.current:0,samples:Attempt[]=[];
    for(let i=0;i<opts.trials;i++) {
      seed=(opts.seed+Math.imul(i+1,2654435761))>>>0;
      samples.push(attempt(catalog.current,opts.scope==='full'?'full':'current',opts.scope));
      if((i+1)%16===0){progress(i+1,opts.trials);await new Promise(resolve=>setTimeout(resolve,0));}
    }
    const firstBlock=samples.flatMap(s=>s.blocked?[s.blocked]:[]).sort((a,b)=>a.index-b.index)[0];
    const knownEnd=firstBlock?.index??meta.length;
    const sums=new Moments(),totals=Object.fromEntries(catalog.team.map(m=>[m.uid,new Moments()]));
    const rowMoments=meta.map(()=>({xp:new Moments(),conditional:new Moments(),cumulative:new Moments(),reached:0,complete:0,
      members:Object.fromEntries(catalog.team.map(m=>[m.uid,{xp:new Moments(),conditional:new Moments(),cumulative:new Moments()}]))}));
    for(const sample of samples) {
      let cumulative=0;const memberSums=Object.fromEntries(catalog.team.map(m=>[m.uid,0]));
      for(let index=fromNode;index<meta.length;index++) {
        const result=sample.nodes[index],stats=rowMoments[index];
        stats.reached+=+result.reached;stats.complete+=+result.complete;
        if(index>=knownEnd)continue;
        const xp=Object.values(result.xp).reduce((a,b)=>a+b,0);cumulative+=xp;
        stats.xp.add(xp);stats.cumulative.add(cumulative);if(result.reached)stats.conditional.add(xp);
        for(const [uid,m]of Object.entries(stats.members)) {
          memberSums[uid]+=result.xp[uid];m.xp.add(result.xp[uid]);m.cumulative.add(memberSums[uid]);if(result.reached)m.conditional.add(result.xp[uid]);
        }
      }
      sums.add(cumulative);for(const [uid,m]of Object.entries(totals))m.add(memberSums[uid]);
    }
    const metric=(m:{xp:Moments;conditional:Moments;cumulative:Moments}):NodeForecastMetric=>({xp:m.xp.interval([0,Infinity]),cumulative:m.cumulative.interval([0,Infinity]),conditionalXp:m.conditional.n?{mean:m.conditional.mean,samples:m.conditional.n}:null});
    const rows:NodeForecastReport['rows']=meta.map((node,index)=>{
      const m=rowMoments[index],state=index<fromNode?'past':index>=knownEnd?'unavailable':'computed';
      return {...node,state,reached:wilson(m.reached,opts.trials),complete:wilson(m.complete,opts.trials),
        metric:state==='computed'?metric(m):null,members:state==='computed'?Object.fromEntries(Object.entries(m.members).map(([uid,v])=>[uid,metric(v)])):{},
        ...state==='unavailable'?{reason:index===knownEnd?firstBlock!.reason:`前面的第 ${knownEnd+1} 处无法完成模拟，后续经验未知`}:{}};
    });
    progress(opts.trials,opts.trials);
    return {catalog:clone(catalog),options:opts,rows,trials:opts.trials,fromNode,xp:sums.interval([0,Infinity]),
      members:Object.fromEntries(Object.entries(totals).map(([uid,m])=>[uid,m.interval([0,Infinity])])),
      complete:firstBlock?null:wilson(samples.filter(s=>s.complete).length,opts.trials),generatedAt:now,assumptions:[
        '普通副本使用当前存档节点；联盟把当前实际节点及保存的联盟计划组合为完整副本。所有四天王、冠军、道中和原生阶段治疗都在同一流程内，同名节点分开统计。',
        opts.scope==='full'?'整图重打：用当前等级、经验和伙伴进度，从副本入口满血出发。各战斗按节点原规则重新遭遇，不将当前敌方残血带回章首。已领取的一次性节点跳过。':'剩余路线：保留当前节点、我方 HP／状态、在场敌方 HP 和已有行动队列；已通过节点不回算，也不显示成零经验。',
        '每个行动之前记录所属节点，再读取成员的实际经验变化，包含跨级、伙伴累计奖励、重复捕获；奖励归入触发的原节点，不串到下一个节点。触顶溢出不计入。',
        '每节点期望按全部模拟计算；中途战败后的未到达节点贡献记零。同时提供到达概率及到达后平均收益，避免把未到达误认为该节点本身没奖励。',
        '需要手动选择或存在未适配机制时，该节点及后续标记未知；合计仅包含已能确认的前缀，未知经验不冒充零收益。',
        '每只队伍成员及整队的节点期望相加，与本次已计算路线总期望一致。伙伴不在出战队伍时，其 Box 经验不计入整队总数。',
        '采用原引擎先后手、命中、伤害、升级和等级上限；样本从同一快照出发，不累积上一样本的升级。显示近似 95% 均值区间，不是必胜或精确解析期望。',
        '时钟按标准行动节奏推进，包含加成到期与天气变化；只在独立 Worker 中执行，不写游戏存档。',
      ]};
  }
  return { catalog, run, runNodes };
}
