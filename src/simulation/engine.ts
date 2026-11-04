import { extractProgram, verifySource, ENGINE_HASH, ENGINE_TIMER, ENGINE_DATA_NAMES } from './program';
import type { Catalog, CombatFacts, Options, Report, Target, MatchResult, RouteResult, RouteThreat, RouteFailure } from './types';
import { Moments, wilson, qualifies } from './statistics';
import { SAMPLE_BUDGET } from './planning';

// The audited vendor API is dynamic. All values stay inside the isolated engine;
// application code receives the explicit serializable protocol in types.ts.
type Vendor = Record<string, any>;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
class Terminal extends Error { constructor(readonly won: boolean) { super('terminal'); } }
export function orderCandidates(order: string[]): { orders: string[][]; search: string } {
  if (order.length <= 4) {
    const permute = (xs: string[]): string[][] => xs.length ? xs.flatMap((x, i) => permute(xs.filter((_, j) => i !== j)).map(rest => [x, ...rest])) : [[]];
    return { orders: permute(order), search: '枚举全部排序；按模拟期望比较，不保证有限抽样下的数学最优' };
  }
  const orders = [order];
  for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
    const next = [...order]; [next[i], next[j]] = [next[j], next[i]]; orders.push(next);
  }
  return { orders, search: '比较原顺序及全部两两换位（局部搜索，不声称全排列最优）' };
}

export async function createSimulator(source: string, rawSave: string, now: number) {
  await verifySource(source);
  const original: Vendor = JSON.parse(rawSave);
  if (!Array.isArray(original.mons) || !Array.isArray(original.team) || !Number.isInteger(original.adv?.chapter)) throw new Error('请先进入普通冒险章节并等待游戏保存');
  if (original.adv.event || original.adv.zone || original.adv.tower) throw new Error('当前为特殊战斗，普通路线分析不适用；请回到冒险章节');
  const program = extractProgram(source);
  let seed = 1;
  const rng = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  // Each instance has its own Math object, clock and in-memory save. It cannot
  // access the browser's game objects, localStorage, DOM or injected credentials.
  const math = Object.create(Math); math.random = rng;
  const clock = { now: () => now };
  let capture: ((event: Vendor) => void) | null = null;
  const captured = new WeakSet<object>();
  const t: Vendor = { Clock: clock, addEventListener() {}, dispatchEvent() {}, __record(event: Vendor) { captured.add(event); capture?.(event); return event; } };
  const evaluate = (code: string) => new Function(program.root, 'e', ENGINE_TIMER, 'Math', 'localStorage', 'fetch', 'XMLHttpRequest', 'WebSocket', code)(
    t, (s: string) => s, () => 0, math, undefined, undefined, undefined, undefined);
  for (const name of ENGINE_DATA_NAMES) {
    evaluate(`${program.root}.${name}=(${program.expressions[name]});`);
  }
  for (const factory of program.factories) evaluate(factory);
  // Game.load normally restores these flags from travel.to. We never call load
  // (it touches storage/migrations), so replay only this read-only hydration.
  for (const key of original.travel?.to || []) {
    const region = t.STORY.REGIONS.find((r: Vendor) => r.key === key);
    if (region) region.open = true;
  }
  if (!t.STORY.regionOf(original.adv.chapter)?.open) throw new Error('存档缺少当前地区的解锁信息，请从游戏页面重新读取完整存档');
  const g = t.Game, a = t.Adventure, cfg = t.CONFIG;
  let active: Vendor | null = null;
  let combatDefeated = false;
  // Stop at the combat outcome, before rewards, evolution or returning to town.
  // Damage, drain, status and fainting have already occurred. No combat code is
  // replaced. These wrappers exist solely on this private engine instance.
  for (const key of ['gainXp', 'enterRegion', 'healTeam']) {
    const fn = g[key];
    g[key] = (...args: unknown[]) => {
      if (active) {
        const allies = g.teamMons();
        if ((active.adv.battle || combatDefeated) && allies.length && allies.every((m: Vendor) => g.curHp(m) <= 0)) throw new Terminal(false);
        const foes = g.S.adv.battle?.enemies;
        if (key === 'gainXp' && foes?.length && foes.every((m: Vendor) => g.curHp(m) <= 0)) throw new Terminal(true);
        // Intermediate KOs in trainer/gym battles also award XP. Freeze every
        // reward, not just the final KO, or low-level trials can level/evolve.
        if (key === 'gainXp') return { levels: 0, evolve: null };
      }
      return fn(...args);
    };
  }
  const clean = (): Vendor => {
    const s = Object.assign(g.freshState(), copy(original));
    s.stats = { ...g.freshState().stats, ...s.stats }; s.buffs ||= {}; s.items ||= {}; s.dex ||= {}; s.seen ||= {}; s.seenShiny ||= {};
    s.adv.gifts ||= {}; s.adv.badges ||= []; s.adv.kept ||= {}; s.adv.loops ||= []; s.adv.capture = { on: false, target: 'new', shiny: true }; s.adv.layout ??= 6;
    return s;
  };
  const base = clean();
  let catalog!: Catalog;
  g.sandbox(base, () => {
    const cap = g.levelCap();
    const candidates = base.mons.map((m: Vendor) => {
      const known = !!g.DEX[m.id], candidateCap = known ? Math.min(cap, g.capFor(m)) : cap;
      let reason = '';
      if (!known) reason = '未知物种';
      else if (m.level > candidateCap) reason = '超过当前等级上限';
      else reason = g.can(m) || '';
      return { uid: String(m.uid), id: m.id, name: g.DEX[m.id]?.name || `#${m.id}`, level: m.level, cap: candidateCap,
        hp: known ? g.curHp(m) : 0, maxHp: known ? g.maxHp(m) : 0, status: m.status || '', shiny: !!m.shiny, rank: g.rankOf(m), eligible: !reason, reason };
    });
    const targets: Target[] = [];
    const current = base.adv.battle;
    if (current) {
      if (current.boss || current.roam) throw new Error('特殊首领的机制尚未适配');
      current.enemies.forEach((m: Vendor, i: number) => { if (m.hp > 0) targets.push({ key: `current:${i}`, label: `当前 · ${g.DEX[m.id].name} Lv.${m.level}`, kind: current.kind, id: m.id, level: m.level,
        node: copy(base.adv.nodes[base.adv.node]), foes: copy(current.enemies), selected: i, gym: current.gym, power: current.power, source: 'current', nodeIndex: base.adv.node, preserveHp: true }); });
    }
    const chapter = t.STORY.CHAPTERS[base.adv.chapter];
    for (const [index, node] of (base.adv.nodes || []).entries()) {
      if (index < base.adv.node || current && index === base.adv.node) continue;
      if (node.type === 'wild') {
        for (const p of a.zonePool(node, base.adv.chapter, false, null, true, true)) {
          if (!p.on || !g.DEX[p.id] || !Number.isInteger(p.max)) continue;
          targets.push({ key: `wild:${index}:${p.id}`, label: `${node.name} · ${g.DEX[p.id].name} Lv.${p.max}（可能遭遇，按区域上限）`, kind: 'wild', id: p.id, level: p.max, node: copy(node), foes: [{ id: p.id, level: p.max, foe: true, shiny: false }], source: 'wild', nodeIndex: index, levelRange: [p.min,p.max] });
        }
      } else if (node.type === 'gym') {
        const foes = t.STORY.gymTeam(base.adv.chapter, node.gym).map(([id, level]: number[]) => ({ id, level, foe: true, shiny: false }));
        for (const [i, m] of foes.entries()) targets.push({ key: `gym:${index}:${i}`, label: `${node.name} · ${g.DEX[m.id].name} Lv.${m.level}`, kind: 'gym', id: m.id, level: m.level, node: copy(node), foes, selected: i, gym: copy(node.gym), source: 'boss', nodeIndex: index });
      } else if (node.type === 'trainer' && node.team?.length) {
        const foes = node.team.map(([id,level]:number[]) => ({ id, level, foe:true, shiny:false, ...node.statMult > 1 ? {statMult:node.statMult} : {} }));
        for (const [i,m] of foes.entries()) targets.push({key:`trainer:${index}:${i}`,label:`训练家 · ${g.DEX[m.id].name} Lv.${m.level}`,kind:'trainer',id:m.id,level:m.level,node:copy(node),foes,selected:i,power:node.gymTrainer ? cfg.GYM_TRAINERS.damage : undefined,source:'trainer',nodeIndex:index});
      }
    }
    catalog = { version: ENGINE_HASH.slice(0, 10), cap, candidates, targets, chapter: chapter.name, chapterIndex:base.adv.chapter,nodeIndex:base.adv.node,nodeName:base.adv.nodes?.[base.adv.node]?.name || '',randomTrainers:(base.adv.nodes||[]).filter((node:Vendor,i:number)=>(i>base.adv.node||i===base.adv.node&&!current)&&node.type==='trainer'&&!node.team?.length).length, capturedAt: now,
      activeOrder: g.activeTeam().map(String), autoSwitch: base.autoSwitch !== false,centers:(base.adv.nodes||[]).flatMap((node:Vendor,i:number)=>node.type==='heal'?[{node:i,name:node.name}]:[]),
      warnings: ['道中单挑列表按区域最高等级；整段路线模式按游戏实际遭遇概率生成敌人。', '完整战斗期望为抽样估计，显示误差；不会把抽样全胜称为必胜。', '当前版本的招式优先度不参与行动排序；原引擎按速度处理。'] };
  });

  function arrange(s: Vendor, order: string[], level?: number, start: Options['start'] = 'full') {
    const mons = order.map(uid => s.mons.find((m: Vendor) => String(m.uid) === uid));
    if (mons.some((m: Vendor) => !m)) throw new Error('所选精灵不在本次存档快照中');
    s.team = mons.map((m: Vendor) => m.uid); s.road = [...s.team];
    g.sandbox(s, () => {
      for (const m of mons) {
        if (level !== undefined) m.level = level;
        const cap = catalog.candidates.find(candidate => candidate.uid === String(m.uid))?.cap;
        if (cap === undefined || m.level > cap || g.can(m)) throw new Error('候选不可用或超过其地区等级上限');
        if (start === 'full') { t.STATUS.clear(m); m.hp = g.maxHp(m); }
      }
    });
  }
  function setupTarget(s: Vendor, target: Target) {
    const foes: Vendor[] = copy(target.foes).map((m: Vendor, i: number) => ({ ...m, uid: `sim-foe:${i}`, foe: true }));
    const slots = a.fieldSize(target.kind, foes.length, target.gym?.double);
    const hpMult = (slots >= cfg.TEAM_SIZE ? 1 + cfg.ENEMY_HP_PER_ALLY * (cfg.TEAM_SIZE - 1) : 1)
      * (target.kind === 'gym' ? cfg.GYM_HP_MULT * Number(target.gym?.power || 1) * Math.max(1, cfg.TEAM_SIZE / foes.length) ** cfg.GYM_TEAM_EXP : 1) * (target.power ?? 1);
    for (const [i, m] of foes.entries()) {
      // A live target snapshot already contains its original HP multipliers.
      if (!target.preserveHp && !target.key.startsWith('current:')) { m.hpMult = hpMult; m.hp = g.maxHp(m); }
      if (target.selected !== undefined && target.selected !== i) m.hp = 0;
    }
    s.adv.nodes = [copy(target.node)]; s.adv.node = 0; s.adv.pending = null;
    s.adv.battle = { kind: target.kind, gym: target.gym, power: target.power, enemies: foes, slots, turn: 0, calm: 0, allies: [], foes: [], queue: [] };
    return foes[target.selected ?? 0];
  }
  function facts(s: Vendor, target: Target): CombatFacts {
    return g.sandbox(s, () => {
      const foe = setupTarget(s, target), mon = g.teamMons()[0];
      const finisher = a.__finisher(s.adv.battle, mon, foe, true);
      const attacker = finisher?.att || (mon.id === 132 && foe.id !== 132 ? { ...mon, id: foe.id } : mon);
      const move = finisher?.mv || a.__choose(attacker, foe), eff = move.typeless ? 1 : a.effectiveness(move.type, g.DEX[foe.id].types);
      const powers = cfg.MULTI_HIT[move.key], raw = t.MOVES[move.key]?.power || 0;
      const minP: number[] = powers === '2-5' ? [raw, raw] : Array.isArray(powers) ? powers : powers ? Array(powers).fill(raw) : [move.power];
      const maxP: number[] = powers === '2-5' ? Array(5).fill(raw) : minP;
      const sum = (ps: number[], roll: number) => eff === 0 || move.power <= 0 ? 0 : ps.reduce((n, power) => n + a.__damage(attacker, foe, { ...move, power }, eff, false, roll), 0);
      const speed = g.statsOf(mon).spe * (mon.status === 'paralysis' ? .25 : 1), enemySpeed = g.statsOf(foe).spe * (foe.status === 'paralysis' ? .25 : 1);
      return { order: speed > enemySpeed ? '速度先手' : speed < enemySpeed ? '速度后手' : '同速随机', move: `${move.name} (${move.key})`, damage: [sum(minP, .85), sum(maxP, 1)], enemyHp: g.curHp(foe), speed, enemySpeed };
    });
  }
  function trial(s: Vendor, route: boolean) {
    const result = { won: false, loss: 1, wear: 0, kos: 0, actions: 0, hits: 0, threats:[] as RouteThreat[], failure:undefined as RouteFailure | undefined };
    const routeNodes=copy(s.adv.nodes), costs=new Map<string,RouteThreat>(), encounters=new Map<string,Target[]>();
    let lastHurt:RouteThreat|undefined;
    const party = s.mons.filter((m: Vendor) => s.team.includes(m.uid));
    const initialLevels = party.map((m: Vendor) => m.level);
    let totalHp = 0, terminal: boolean | undefined;
    const previousHp = new Map<string, number>();
    g.sandbox(s, () => {
      for (const m of party) { totalHp += g.maxHp(m); previousHp.set(String(m.uid), g.curHp(m)); }
      const finish = (won: boolean) => {
        result.won = won;
        const remaining = party.reduce((n: number, m: Vendor) => n + g.curHp(m), 0);
        result.loss = Math.max(0, Math.min(1, 1 - remaining / totalHp));
        if (party.some((m: Vendor, i: number) => m.level !== initialLevels[i])) throw new Error('模拟等级发生变化，已拒绝输出不符合固定等级条件的结果');
        result.threats=[...costs.values()];
        if (!won && lastHurt) {
          const center=routeNodes.findIndex((node:Vendor,i:number)=>i>lastHurt!.node&&node.type==='heal');
          const until=center<0?routeNodes.length:center;
          result.failure={node:lastHurt.node,id:lastHurt.id,label:lastHurt.label,count:1,nextCenter:center<0?null:routeNodes[center].name,
            battlesToCenter:routeNodes.filter((node:Vendor,i:number)=>i>lastHurt!.node&&i<until&&['wild','trainer','gym','static'].includes(node.type)).length,targetKey:lastHurt.targetKey};
        }
      };
      const processEvent = (event: Vendor) => {
        if (event.type === 'attack' && event.side === 'ally') { result.actions++; if (event.damage > 0) result.hits++; }
        const uid = String(event.type === 'attack' ? event.target : event.uid);
        if (previousHp.has(uid) && typeof event.hp === 'number') {
          const previous = previousHp.get(uid)!;
          const hurt=Math.max(0,previous-event.hp), knockout=previous>0&&event.hp<=0;
          if (route && hurt>0) {
            const battle=s.adv.battle, foe=event.type==='attack'&&event.side==='enemy'?battle?.enemies.find((m:Vendor)=>String(m.uid)===String(event.uid)):null;
            const key=`${s.adv.node}:${foe?.id??'status'}`,label=foe?g.DEX[foe.id].name:'状态伤害／其他伤害';
            let cost=costs.get(key);if(!cost){cost={node:s.adv.node,id:foe?.id,label,wear:0,kos:0,samples:1};costs.set(key,cost);}
            cost.wear+=hurt/totalHp;cost.kos+=+knockout;lastHurt=cost;
            if (foe) {
              const encounterKey=JSON.stringify([s.adv.node,battle.kind,battle.enemies.map((m:Vendor)=>[m.id,m.level])]);
              if (!encounters.has(encounterKey)) encounters.set(encounterKey,battle.enemies.map((m:Vendor,i:number)=>({key:`diagnostic:${encounterKey}:${i}`,label:`路线遇敌 · ${g.DEX[m.id].name} Lv.${m.level}`,kind:battle.kind,id:m.id,level:m.level,node:copy(routeNodes[s.adv.node]),foes:copy(battle.enemies).map((mon:Vendor,j:number)=>{mon.uid=`diagnostic-foe:${j}`;delete mon.caughtAt;return mon;}),selected:i,gym:copy(battle.gym??null),power:battle.power,source:'diagnostic',nodeIndex:s.adv.node,preserveHp:true})));
              cost.targetKey=encounters.get(encounterKey)![battle.enemies.findIndex((m:Vendor)=>String(m.uid)===String(event.uid))]?.key;
            }
          }
          if (previous > 0 && event.hp <= 0) result.kos++;
          result.wear += Math.max(0, previous - event.hp) / totalHp;
          previousHp.set(uid, event.hp);
        }
        // Drain can heal the attacker before its own end-of-turn poison tick.
        // Refresh non-victims now, so that later DOT isn't undercounted.
        for (const m of party) if (String(m.uid) !== uid) previousHp.set(String(m.uid), g.curHp(m));
        if (s.adv.battle && party.every((m: Vendor) => g.curHp(m) <= 0)) combatDefeated = true;
      };
      active = s; combatDefeated = false; capture = processEvent;
      try {
        for (let step = 0; step < 20000; step++) {
          if (route && s.adv.node >= s.adv.nodes.length && !s.adv.battle) { terminal = true; break; }
          if (s.adv.pending) throw new Error('剩余路线含未确认的赠送或选择，请在游戏中处理后重新读取');
          // Capture full enemy HP before anyone acts; reasons and follow-up
          // counter searches must not use a partly defeated sampled target.
          if(route&&s.adv.battle){const b=s.adv.battle,k=JSON.stringify([s.adv.node,b.kind,b.enemies.map((m:Vendor)=>[m.id,m.level])]);
            if(!encounters.has(k)) encounters.set(k,b.enemies.map((m:Vendor,i:number)=>({key:`diagnostic:${k}:${i}`,label:`路线遇敌 · ${g.DEX[m.id].name} Lv.${m.level}`,kind:b.kind,id:m.id,level:m.level,node:copy(routeNodes[s.adv.node]),foes:copy(b.enemies).map((mon:Vendor,j:number)=>{mon.uid=`diagnostic-foe:${j}`;delete mon.caughtAt;return mon;}),selected:i,gym:copy(b.gym??null),power:b.power,source:'diagnostic',nodeIndex:s.adv.node,preserveHp:true})));}
          let events: Vendor[];
          try { events = a.step(); }
          catch (e) {
            if (!(e instanceof Terminal)) throw e;
            if (!route || !e.won) { terminal = e.won; break; }
            // The exact last hit, drain and faint have happened; continue to the
            // next stored node without adding XP, capture or currency rewards.
            s.adv.battle = null; s.adv.node++; continue;
          }
          for (const event of events) {
            if (!captured.has(event)) processEvent(event);
            if (event.type === 'chapterEnd') { terminal = true; break; }
            if (event.type === 'defeat') { terminal = false; break; }
          }
          // Heal nodes and drain are reflected in the engine's actual state.
          for (const m of party) previousHp.set(String(m.uid), g.curHp(m));
          if (terminal !== undefined) break;
          if (!route && !s.adv.battle) throw new Error('战斗以逃离或特殊机制结束，不能当作胜利');
        }
        if (terminal === undefined) throw new Error('战斗超过行动上限，未完成的样本不会计为失败或胜利');
        finish(terminal);
        const useful=new Set([result.failure?.targetKey,...[...result.threats].sort((a,b)=>b.wear-a.wear).slice(0,2).map(t=>t.targetKey)]);
        let diagnosticCount=catalog.targets.filter(t=>t.source==='diagnostic').length;
        for(const target of [...encounters.values()].flat()) if(useful.has(target.key)) {
          if(diagnosticCount<128&&!catalog.targets.some(t=>t.key===target.key)){catalog.targets.push(target);diagnosticCount++;}
        }
      } finally { active = null; combatDefeated = false; capture = null; }
    });
    return result;
  }

  async function run(options: Options, progress: (completed: number, total: number, result?: MatchResult, route?: RouteResult) => void, custom: { id: number; level: number }[] = []): Promise<Report> {
    const opts = copy(options), selected = opts.candidateUids;
    if (!Number.isInteger(opts.trials) || opts.trials < 128 || opts.trials > 8192 || !selected.length || new Set(selected).size !== selected.length) throw new Error('请选择候选，样本数需为 128–8192 的整数');
    if (!Number.isFinite(opts.seed) || !Number.isFinite(opts.maxLoss) || !Number.isFinite(opts.minWin) || opts.maxLoss < 0 || opts.maxLoss > 1 || opts.minWin < 0 || opts.minWin > 1) throw new Error('模拟参数不合法');
    for (const uid of selected) if (!catalog.candidates.some(m => m.uid === uid && m.eligible)) throw new Error('候选不可用，请重新读取存档');
    const targets = opts.mode === 'matrix' ? opts.targetKeys.map(key => { const t = catalog.targets.find(t => t.key === key); if (!t) throw new Error('目标已失效'); return t; }) : [];
    for (const [i, c] of (opts.mode === 'matrix' ? custom : []).entries()) {
      if (!g.DEX[c.id] || !Number.isInteger(c.level) || c.level < 1 || c.level > cfg.MAX_LEVEL) throw new Error('指定目标的物种或等级无效');
      targets.push({ key: `custom:${i}`, label: `指定野生 · ${g.DEX[c.id].name} Lv.${c.level}`, kind: 'wild', id: c.id, level: c.level, node: { type: 'wild', name: '指定野生目标', bg: 'prairie' }, foes: [{ id: c.id, level: c.level, foe: true, shiny: false }] });
    }
    const report: Report = { catalog: copy(catalog), options: opts, results: [], routes: [], generatedAt: now,
      assumptions: ['使用读取时刻的时间与天气，分析期间冻结时钟。', '保留闪光、地下等级、地区限制、招式重排与继承；不使用原作特性或招式优先度。', '战斗在独立状态中执行，终局后跳过经验、进化、捕获和货币奖励；路线中等级固定。', '当前敌人单挑保留其存档 HP，但重新建立行动队列；不是对当前战斗下一回合的精确续算。路线模式保留已有队列。', '先手与伤害区间按原引擎确定；胜率用 Wilson 95% 区间，期望缺血用有界经验 Bernstein 95% 区间，累计承伤与行动数用近似区间。', '区间为单组置信范围，不保证多方案筛选后的整体最优或整体 95% 覆盖。', '排序假设所选队伍从当前节点起生效；游戏中的待更新队伍可能在下次出发才生效。', '排序只影响当前出战队伍，不改变 box 的显示顺序，也不会自动修改存档。'] };
    let completed = 0;
    if (opts.mode !== 'matrix') {
      if (selected.length > cfg.TEAM_SIZE) throw new Error('路线排序最多选择六只精灵');
      if (base.adv.event || base.adv.zone || base.adv.tower || !(base.adv.nodes?.length)) throw new Error('没有可用的普通冒险路线');
      const search = opts.mode === 'order' ? orderCandidates(selected) : { orders: [selected], search: '按选定顺序连续执行剩余章节节点' };
      report.search = search.search;
      const modes = opts.mode === 'order' ? [catalog.autoSwitch, !catalog.autoSwitch] : [opts.autoSwitch === 'current' ? catalog.autoSwitch : opts.autoSwitch === 'on'];
      const total = search.orders.length * modes.length;
      if (total * opts.trials > SAMPLE_BUDGET) throw new Error('本次计算量过大，请降低样本数或减少排序成员');
      for (const order of search.orders) for (const autoSwitch of modes) {
        const loss = new Moments(), wear = new Moments(), kos = new Moments(); let wins = 0;
        const threats=new Map<string,RouteThreat>(),failures=new Map<string,RouteFailure>();
        for (let i = 0; i < opts.trials; i++) {
          seed = (opts.seed + Math.imul(i + 1, 2654435761)) >>> 0;
          const s = clean(); arrange(s, order, undefined, opts.start); s.autoSwitch = autoSwitch;
          const r = trial(s, true); wins += +r.won; loss.add(r.loss); wear.add(r.wear); kos.add(r.kos);
          for(const item of r.threats){const key=`${item.node}:${item.id??'status'}`,old=threats.get(key);if(old){old.wear+=item.wear;old.kos+=item.kos;old.samples++;}else threats.set(key,{...item});}
          if(r.failure){const key=`${r.failure.node}:${r.failure.id??'status'}`,old=failures.get(key);if(old)old.count++;else failures.set(key,{...r.failure});}
        }
        const win = wilson(wins, opts.trials), damage = loss.interval([0, 1]);
        const route = { order, autoSwitch, trials: opts.trials, win, loss: damage, wear: wear.interval([0, Infinity]), kos: kos.interval([0, Infinity]),
          qualified: qualifies(win, damage, opts.minWin, opts.maxLoss), baseline: autoSwitch === catalog.autoSwitch && JSON.stringify(order) === JSON.stringify(selected),
          threats:[...threats.values()].map(t=>({...t,wear:t.wear/opts.trials,kos:t.kos/opts.trials})).sort((a,b)=>b.wear-a.wear),failures:[...failures.values()].sort((a,b)=>b.count-a.count) };
        report.routes.push(route); progress(++completed, total, undefined, route); await new Promise(resolve => setTimeout(resolve, 0));
      }
      report.catalog=copy(catalog);return report;
    }
    if (!targets.length) throw new Error('请选择道中目标或指定物种和等级');
    const jobs = selected.flatMap(uid => targets.flatMap(target => {
      const candidate = catalog.candidates.find(m => m.uid === uid)!;
      const last = opts.scanLevels ? candidate.cap : candidate.level;
      return Array.from({ length: last - candidate.level + 1 }, (_, i) => ({ uid, target, level: candidate.level + i }));
    }));
    if (jobs.length * opts.trials > SAMPLE_BUDGET) throw new Error(`需要 ${jobs.length} 组模拟；请减少候选或目标，升级扫描建议每次选择 1–3 只`);
    for (const job of jobs) {
      const initial = clean(); arrange(initial, [job.uid], job.level, opts.start);
      const trainingXp = g.sandbox(initial, () => {
        const mon = base.mons.find((m: Vendor) => String(m.uid) === job.uid);
        let need = 0;
        for (let level = mon.level; level < job.level; level++) need += g.xpForNext(level, mon);
        return job.level === mon.level ? 0 : Math.max(0, Math.ceil(need - mon.xp));
      });
      const info = facts(initial, job.target), loss = new Moments(), actions = new Moments(), hits: Record<string, number> = {}; let wins = 0;
      for (let i = 0; i < opts.trials; i++) {
        seed = (opts.seed + Math.imul(i + 1, 2654435761)) >>> 0;
        const s = clean(); arrange(s, [job.uid], job.level, opts.start); s.autoSwitch = false;
        g.sandbox(s, () => setupTarget(s, job.target));
        const r = trial(s, false); wins += +r.won; loss.add(r.loss); actions.add(r.actions);
        if (r.won) hits[r.hits] = (hits[r.hits] || 0) + 1;
      }
      const win = wilson(wins, opts.trials), damage = loss.interval([0, 1]);
      const result = { uid: job.uid, id: catalog.candidates.find(m => m.uid === job.uid)!.id, target: job.target.label,targetId:job.target.id,targetLevel:job.target.level, level: job.level, trials: opts.trials, wins,
        win, loss: damage, actions: actions.interval([0, Infinity]), hits, facts: info, qualified: qualifies(win, damage, opts.minWin, opts.maxLoss), trainingXp };
      report.results.push(result); progress(++completed, jobs.length, result); await new Promise(resolve => setTimeout(resolve, 0));
    }
    return report;
  }
  return { catalog, run };
}
