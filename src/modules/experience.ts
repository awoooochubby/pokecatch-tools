import { reactive } from 'vue';
import type { GameAdapter } from '../core/game';
import type { Store } from '../core/storage';
import type { GameSave, Mon } from '../core/types';
import { activeTeam } from '../core/game';

export interface Session { start: number | null; total: number; partial: boolean; mons: Record<string, { start: number; total: number; partial: boolean }>; previous: { team: GameSave['team']; mons: Mon[] } | null }
interface Battle { count: number; start: number; measuredFrom: number; end?: number; efficiencyMs?: number; partial: boolean; total: number; mons: Record<string, { name: string; xp: number }> }
interface Round { start: number; end?: number; run: number; chapter?: number | string; partial: boolean; logs: string[]; xp: Record<string, number>; levels: Record<string, number>; battles: string[]; note?: string }
export const emptySession = (): Session => ({ start: null, total: 0, partial: false, mons: {}, previous: null });
export function validSession(s: Session): boolean {
  return !!s && (s.start === null || Number.isFinite(s.start) && s.start <= Date.now()) && Number.isFinite(s.total) && s.total >= 0
    && !!s.mons && typeof s.mons === 'object' && Object.values(s.mons).every(m => m && Number.isFinite(m.total) && Number.isFinite(m.start))
    && (s.previous === null || Array.isArray(s.previous?.mons) && Array.isArray(s.previous?.team));
}
export function sampleSession(session: Session, s: GameSave, now: number) {
  session.start ??= now;
  const old = session.previous;
  for (const uid of new Set([...activeTeam(s), ...(old?.team || [])])) {
    const m = s.mons.find(x => x.uid === uid), o = old?.mons.find(x => x.uid === uid);
    if (!m) { session.partial = true; continue; }
    const entry = session.mons[uid] ??= { start: now, total: 0, partial: false };
    if (!o) { if (old) session.partial = true; continue; }
    let gain = 0;
    if (m.level === o.level && m.xp >= o.xp) gain = m.xp - o.xp;
    else if (m.level > o.level) { gain = Math.max(0, m.xp); entry.partial = session.partial = true; }
    else { entry.partial = session.partial = true; }
    if (Number.isFinite(gain)) { entry.total += gain; session.total += gain; }
  }
  session.previous = { team: [...activeTeam(s)], mons: s.mons.map(m => ({ ...m })) };
}

export function createExperience(game: GameAdapter, store: Store) {
  const saved = store.get<Session>('session', emptySession());
  const stats = store.get<{ limit?: number; history?: Round[]; battleHistory?: Battle[] }>('stats', {});
  const state = reactive({ session: validSession(saved) ? saved : emptySession(), limit: Math.min(100, Math.max(1, stats.limit || 20)),
    history: Array.isArray(stats.history) ? stats.history : [] as Round[],
    battles: Array.isArray(stats.battleHistory) ? stats.battleHistory.slice(-50) : [] as Battle[],
    current: null as Round | null, active: null as Battle | null, now: Date.now(), save: null as GameSave | null });
  if (store.get<Record<string, unknown>>('settings', {}).experience === false) state.session.previous = null;
  let previous: GameSave | null = null, battlePrevious: GameSave | null = null, cycleStart: number | null = null;
  let unsub: Array<() => void> = [];
  function persist() {
    state.history = state.history.slice(-state.limit);
    store.set('session', state.session);
    store.set('stats', { limit: state.limit, history: state.history, battleHistory: state.battles });
  }
  function closeRound(note: string) {
    if (!state.current) return;
    state.current.end = state.now; state.current.note = note;
    state.history.push(state.current); state.current = null;
  }
  function finishBattle(partial = false) {
    if (!state.active) return;
    state.active.partial ||= partial; state.active.end = state.now;
    state.active.efficiencyMs = Math.max(0, state.now - state.active.measuredFrom);
    state.battles.push(state.active); state.battles = state.battles.slice(-50);
    state.active = null; cycleStart = state.now;
  }
  function append(text: string) {
    if (!state.current) return;
    if (state.current.logs.length < 3000) state.current.logs.push(new Date(state.now).toLocaleTimeString() + ' | ' + text);
    else state.current.partial = true;
  }
  function sample(s: GameSave, now: number, gap: boolean) {
    state.now = now; state.save = s;
    if (gap) {
      state.session.partial = true; finishBattle(true);
      if (state.current) state.current.partial = true;
      closeRound('页面休眠/采样中断'); previous = battlePrevious = null; cycleStart = null;
    }
    sampleSession(state.session, s, now);
    if (previous && (s.adv.runs !== previous.adv.runs || s.adv.chapter !== previous.adv.chapter)) {
      if (state.current && (s.adv.runs - previous.adv.runs !== 1 || s.adv.chapter !== previous.adv.chapter)) state.current.partial = true;
      closeRound('换轮或切换章节');
    }
    state.current ??= { start: now, run: s.adv.runs, chapter: s.adv.chapter, partial: !previous || s.adv.chapter !== previous.adv.chapter || s.adv.runs - previous.adv.runs !== 1, logs: [], xp: {}, levels: {}, battles: [] };
    if (previous && s.adv.runs === previous.adv.runs && s.adv.chapter === previous.adv.chapter) {
      for (const m of s.mons) {
        const o = previous.mons.find(x => x.uid === m.uid);
        if (!o) continue;
        if (m.level === o.level && m.xp >= o.xp) state.current.xp[m.uid] = (state.current.xp[m.uid] || 0) + m.xp - o.xp;
        else if (m.level > o.level) { state.current.levels[m.uid] = (state.current.levels[m.uid] || 0) + m.level - o.level; state.current.partial = true; }
      }
    }
    const count = s.stats?.battles, old = battlePrevious, same = old && old.stats?.battles === count;
    cycleStart ??= now;
    if (Number.isFinite(count)) {
      if (state.active && (!same || state.active.count !== count)) finishBattle(true);
      if (!state.active && s.adv.battle) {
        const clean = old && !old.adv.battle && count === (old.stats?.battles ?? -1) + 1 && s.adv.chapter === old.adv.chapter
          && JSON.stringify(activeTeam(s)) === JSON.stringify(activeTeam(old)) && activeTeam(s).every(uid => {
            const m = s.mons.find(x => x.uid === uid), o = old.mons.find(x => x.uid === uid);
            return m && o && m.level === o.level && m.xp === o.xp;
          });
        state.active = { count: count!, start: now, measuredFrom: cycleStart, partial: !clean, total: 0, mons: {} };
      }
      if (state.active && same && old) {
        if (JSON.stringify(activeTeam(old)) !== JSON.stringify(activeTeam(s))) state.active.partial = true;
        for (const uid of new Set([...activeTeam(old), ...activeTeam(s)])) {
          const m = s.mons.find(x => x.uid === uid), o = old.mons.find(x => x.uid === uid);
          if (!m || !o || m.level !== o.level || m.xp < o.xp) { state.active.partial = true; continue; }
          const xp = m.xp - o.xp;
          if (xp > 0) { (state.active.mons[uid] ??= { name: game.monName(uid, m.id), xp: 0 }).xp += xp; state.active.total += xp; }
        }
      }
      if (!s.adv.battle) finishBattle();
    }
    if (s.adv.battle) {
      const id = JSON.stringify([s.adv.node, s.adv.battle.kind, s.adv.battle.enemies.map(e => e.uid)]);
      if (!state.current.battles.includes(id)) state.current.battles.push(id);
    }
    previous = battlePrevious = s; persist();
  }
  return { id: 'experience', state, persist,
    reset() { state.session = emptySession(); if (previous && state.save) sampleSession(state.session, state.save, Date.now()); persist(); },
    start() {
      if (unsub.length) return;
      unsub = [game.bus.on('sample', ({ save, now, gap }) => sample(save, now, gap)), game.bus.on('log', append),
        game.bus.on('damage', d => append(`${d.healing ? '恢复 +' : '伤害 −'}${d.value}${d.critical ? ' · 暴击' : ''}${d.status ? ' · 状态效果' : ''}`))];
    },
    stop() { unsub.forEach(off => off()); unsub = []; finishBattle(true); if (state.current) state.current.partial = true; closeRound('模块停止'); state.session.partial = true; state.session.previous = null; previous = battlePrevious = null; cycleStart = null; persist(); },
  };
}
