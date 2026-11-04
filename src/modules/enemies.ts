import { reactive } from 'vue';
import { normalize, type GameAdapter } from '../core/game';
import { dex, pokemonName } from '../core/pokemon';
import type { Store } from '../core/storage';
import type { Damage, GameSave } from '../core/types';

export interface EnemyBattle { at: number; foes: number[]; kos: Array<{ victim: string; cause: string; damage: number }>; lines: string[]; result: string | null }
export interface Stage { name: string; end?: string; rows: Record<string, { damage: number; hits: number }>; unknown: number; battles: EnemyBattle[] }
const newStage = (name: string): Stage => ({ name, rows: {}, unknown: 0, battles: [] });
function validStage(value: Stage | null | undefined): Stage | null {
  if (!value || typeof value.name !== 'string' || !value.rows || typeof value.rows !== 'object') return null;
  return { ...value, unknown: Number.isFinite(value.unknown) ? value.unknown : 0, battles: Array.isArray(value.battles) ? value.battles : [] };
}
const aliases = Object.entries(dex).flatMap(([id, d]) => [d.name, d.fr, d.key].map(name => ({ alias: normalize(name), id: Number(id) }))).sort((a, b) => b.alias.length - a.alias.length);
export function identifySpecies(text: string, enemies: number[] = []): number | undefined {
  const normalized = normalize(text), id = aliases.find(a => normalized.includes(a.alias))?.id;
  if (!id || dex[id]?.base) return id;
  const matching = [...new Set(enemies.filter(e => e === id || dex[e]?.base === id))];
  return matching.length === 1 ? matching[0] : id;
}

export function createEnemies(game: GameAdapter, store: Store) {
  const saved = store.get<{ current?: Stage; previous?: Stage }>('enemies', {});
  const legacy = store.get<Partial<Stage>>('legacyStage', {});
  const state = reactive({ current: validStage(saved.current) || { ...newStage('途中接入 · 等待宝可梦中心'), rows: legacy.rows || {}, unknown: legacy.unknown || 0 },
    previous: validStage(saved.previous), enemies: [] as Array<{ uid: string | number; id: number; hp: number }>,
    selected: null as number | null, pinned: false, showPrevious: false });
  for (const entry of state.current.battles) if (!entry.result) entry.result = '记录中断';
  let save: GameSave | null = null, battle: EnemyBattle | null = null, attack: { id: number; move: string } | null = null;
  let centerVisit: string | null = null, unsub: Array<() => void> = [], dirty = false;
  const hits = new Map<string, { cause: string; damage: number }>();
  const persist = () => { if (dirty) { store.set('enemies', { current: state.current, previous: state.previous }); dirty = false; } };
  function finish(result: string) { if (battle) { battle.result = result; dirty = true; } battle = null; attack = null; hits.clear(); }
  function startBattle() {
    finish('已结束'); centerVisit = null;
    const entry: EnemyBattle = { at: Date.now(), foes: [], kos: [], lines: [], result: null };
    state.current.battles.push(entry); state.current.battles = state.current.battles.slice(-50);
    battle = state.current.battles.at(-1)!; dirty = true;
    return battle;
  }
  function line(text: string) { if (battle) { battle.lines.push(text); battle.lines = battle.lines.slice(-32); dirty = true; } }
  function center(label: string) {
    label = label.trim() || '宝可梦中心';
    if (centerVisit === label) return;
    centerVisit = label; finish('已结束');
    if (state.current.battles.length || Object.keys(state.current.rows).length || state.current.unknown) {
      state.current.end = label; state.previous = state.current;
    }
    state.current = newStage(label); dirty = true; persist();
  }
  const species = (text: string) => identifySpecies(text, state.enemies.map(e => e.id));
  function log(text: string) {
    if (/^(?:Centre Pokémon(?: de .+)?|.*宝可梦中心|Pokémon Center(?: .+)?)$|：你的队伍已恢复健康| : ton équipe est soignée|your team (?:was|is) healed/i.test(text)) {
      center(text.replace(/(?:\s*[：:]\s*(?:你的队伍已恢复健康|ton équipe est soignée|your team.*)).*$/i, '')); return;
    }
    if (/野生的.+出现了|发起了对战|sauvage apparaît|veut se battre|wild .+ appeared|wants to battle/i.test(text)) {
      const b = startBattle(), id = species(text); if (id) b.foes.push(id); persist(); return;
    }
    const use = /(使出(?:了)?|使用(?:了)?|\sutilise\s|\suses?\s|\sused\s)/i.exec(text);
    if (use) {
      const prefix = text.slice(0, use.index), id = species(prefix), hostile = /野生|敌方|对方|对手|敌人|sauvage|ennemi|\bwild\b|\bfoe\b|\benemy\b/i.test(prefix);
      if (!battle) startBattle(); hits.clear();
      attack = hostile && id ? { id, move: text.slice(use.index + use[0].length).split(/[！!。]/)[0].trim() } : null;
      if (attack && !battle!.foes.includes(id!)) battle!.foes.push(id!);
      line(text); persist(); return;
    }
    if (/倒下了|est K\.O\.|\bfainted\b/i.test(text) && battle) {
      const victim = text.split(/倒下了|\sest K\.O\.|\sfainted/i)[0].trim(), key = normalize(victim), hit = hits.get(key);
      if (hit || !game.enemyKo(species(victim), save) && game.hasAlly(victim)) {
        battle.kos.push({ victim, cause: hit?.cause || '来源未识别', damage: hit?.damage || 0 }); hits.delete(key); dirty = true;
      }
    } else if (/已捕获|est capturé|was caught/i.test(text)) finish('捕获');
    else if (/中毒.*(?:伤害|受伤)|灼伤.*(?:伤害|受伤)|混乱.*伤|souffre|se blesse|hurt by/i.test(text)) attack = null;
    persist();
  }
  function damage(d: Damage) {
    if (d.healing || d.side !== 'ally') return;
    if (!battle) startBattle();
    const cause = d.status ? '状态伤害' : attack ? pokemonName(attack.id) + (attack.move ? ' · ' + attack.move : '') : '来源未识别';
    const key = normalize(d.victim || ''), last = hits.get(key);
    if (key) hits.set(key, { cause, damage: (last?.cause === cause ? last.damage : 0) + d.value });
    line(`${d.victim || '我方'}受到 ${d.value} 伤害 · ${cause}`);
    if (!d.status) {
      if (attack) { const r = state.current.rows[attack.id] ??= { damage: 0, hits: 0 }; r.damage += d.value; r.hits++; }
      else state.current.unknown += d.value;
    }
    dirty = true; persist();
  }
  return { id: 'enemies', state,
    select(id: number) { state.selected = id; state.pinned = true; },
    follow() { state.pinned = false; state.selected = state.enemies[0]?.id ?? null; },
    clear() { if (!state.showPrevious) { state.current.rows = {}; state.current.unknown = 0; dirty = true; persist(); } },
    start() {
      if (unsub.length) return;
      unsub = [game.bus.on('sample', event => {
        save = event.save;
        if (event.gap) finish('采样中断');
        state.enemies = (save.adv.battle?.enemies || []).filter(e => game.enemyVisible(e.uid, e.hp));
        if (!state.pinned) state.selected = state.enemies[0]?.id ?? null;
        if (!save.adv.battle && battle) finish('已结束');
        persist();
      }), game.bus.on('log', log), game.bus.on('damage', damage), game.bus.on('center', center),
      game.bus.on('defeat', result => { if (!battle) startBattle(); finish(result); persist(); })];
    },
    stop() { unsub.forEach(off => off()); unsub = []; finish('记录中断'); persist(); },
  };
}
