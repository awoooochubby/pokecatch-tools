import { reactive } from 'vue';
import type { GameAdapter } from '../core/game';
import type { Store } from '../core/storage';
import type { GameSave, Mon } from '../core/types';
import { earnedXp, experienceModel, xpRegion } from '../core/experience-rules';
import { activeTeam } from '../core/game';

interface Member { name: string; xp: number; ms: number; minLevel: number; maxLevel: number }
export interface MapRecord { key: string; chapter: number; name: string; region: string; xp: number; ms: number; intervals: number;
  skipped: number; updatedAt: number; mons: Record<string, Member> }
interface Point { key: string; at: number; ms: number; xp: Record<string, number> }
function mapOf(s: GameSave) {
  const chapter = s.adv.chapter;
  if (!Number.isInteger(chapter) || s.adv.event || s.adv.zone || s.adv.tower) return null;
  const meta = experienceModel.chapters[chapter as number];
  return meta ? { key: String(chapter), chapter: chapter as number, name: meta.name, region: meta.region } : null;
}
function road(s: GameSave): Mon[] {
  const ids = new Set(activeTeam(s).map(String));
  return s.mons.filter(m => ids.has(String(m.uid)));
}
export function mapRate(row: MapRecord, uid = '') {
  const m = uid ? row.mons[uid] : row;
  return m && m.ms > 0 ? m.xp * 60000 / m.ms : null;
}
function validRecord(row: MapRecord): boolean {
  return !!row && typeof row.key === 'string' && typeof row.name === 'string' && Number.isInteger(row.chapter)
    && [row.xp, row.ms, row.intervals, row.skipped, row.updatedAt].every(n => Number.isFinite(n) && n >= 0)
    && !!row.mons && typeof row.mons === 'object' && !Array.isArray(row.mons)
    && Object.values(row.mons).every(m => m && typeof m.name === 'string' && [m.xp, m.ms, m.minLevel, m.maxLevel].every(n => Number.isFinite(n) && n >= 0));
}
export function createFarming(game: GameAdapter, store: Store) {
  const saved = store.get<{ records?: MapRecord[]; selected?: string }>('farming', {});
  const state = reactive({ records: Array.isArray(saved.records) ? saved.records.filter(validRecord).slice(-100) : [] as MapRecord[],
    selected: typeof saved.selected === 'string' ? saved.selected : '', currentKey: '', currentNode: '',
    now: Date.now(), status: '等待游戏存档', trusted: false, team: [] as Array<{ uid: string; name: string; level: number }>,
    recent: [] as Point[] });
  let previous: { save: GameSave; now: number; visible: boolean } | null = null;
  let unsub: (() => void) | null = null;
  function persist() { store.set('farming', { records: state.records, selected: state.selected }); }
  function ensure(s: GameSave, now: number) {
    const map = mapOf(s); if (!map) return null;
    let row = state.records.find(r => r.key === map.key);
    if (!row) {
      row = { ...map, xp: 0, ms: 0, intervals: 0, skipped: 0, updatedAt: now, mons: {} };
      state.records.push(row); state.records = state.records.slice(-100);
      row = state.records.find(r => r.key === map.key)!;
    }
    return row;
  }
  function sample({ save: s, now, gap, visible = true }: { save: GameSave; now: number; gap: boolean; visible?: boolean }) {
    state.now = now; state.trusted = game.auditedExperienceRules();
    const row = ensure(s, now), old = previous, oldMap = old && mapOf(old.save);
    state.currentKey = row?.key || ''; state.currentNode = s.adv.nodes?.[s.adv.node ?? 0]?.name || '';
    state.team = road(s).map(m => ({ uid: String(m.uid), name: game.monName(m.uid, m.id), level: m.level }));
    state.recent = state.recent.filter(p => now - p.at <= 60000);
    const ms = old ? now - old.now : 0;
    const continuous = !!(old && row && oldMap?.key === row.key && old.visible && visible && !gap && ms > 0 && ms <= 15000
      && !s.adv.paused && !old.save.adv.paused && xpRegion(old.save) === xpRegion(s)
      && road(old.save).map(m => String(m.uid)).sort().join('|') === road(s).map(m => String(m.uid)).sort().join('|'));
    if (continuous && row && old) {
      const gains: Record<string, number> = {};
      for (const before of road(old.save)) {
        const after = s.mons.find(m => String(m.uid) === String(before.uid));
        const gain = after ? earnedXp(before, after, xpRegion(old.save), state.trusted) : null;
        if (gain === null) continue;
        gains[String(before.uid)] = gain;
      }
      // Exclude the whole interval if any member cannot be reconstructed, so
      // an unknown level-up never silently depresses a map's XP/min ranking.
      if (Object.keys(gains).length === road(old.save).length && Object.keys(gains).length > 0) {
        row.ms += ms; row.intervals++; row.updatedAt = now;
        for (const m of road(s)) {
          const uid = String(m.uid), gain = gains[uid];
          const member = row.mons[uid] ??= { name: game.monName(m.uid, m.id), xp: 0, ms: 0, minLevel: m.level, maxLevel: m.level };
          const before = old.save.mons.find(o => String(o.uid) === uid)!;
          member.xp += gain; member.ms += ms; member.minLevel = Math.min(member.minLevel, before.level); member.maxLevel = Math.max(member.maxLevel, m.level);
          member.name = game.monName(m.uid, m.id); row.xp += gain;
        }
        state.recent.push({ key: row.key, at: now, ms, xp: gains });
        state.status = '正在统计';
      } else { row.skipped++; state.status = '经验变化无法确认，已排除此段'; }
    } else {
      if (row && old) row.skipped++;
      state.status = !row ? '特殊区域暂不参与普通图比较' : !visible || gap ? '后台或采样中断，已排除此段'
        : s.adv.paused ? '游戏暂停，计时已停止' : old ? '地图／队伍／地区变化，重新采样' : '已建立基线，等待经验变化';
    }
    previous = { save: s, now, visible }; persist();
  }
  return { id: 'farming', state, persist,
    recentRate(uid = '') {
      const points = state.recent.filter(p => p.key === state.currentKey && (!uid || uid in p.xp));
      const ms = points.reduce((sum, p) => sum + p.ms, 0);
      const xp = points.reduce((sum, p) => sum + (uid ? p.xp[uid] : Object.values(p.xp).reduce((a, b) => a + b, 0)), 0);
      return ms >= 10000 ? xp * 60000 / ms : null;
    },
    resetCurrent() { state.records = state.records.filter(r => r.key !== state.currentKey); state.recent = []; previous = null; persist(); },
    select(uid: string) { state.selected = uid; persist(); },
    start() { if (!unsub) unsub = game.bus.on('sample', sample); },
    stop() { unsub?.(); unsub = null; previous = null; state.recent = []; state.status = '统计已关闭'; persist(); },
  };
}
