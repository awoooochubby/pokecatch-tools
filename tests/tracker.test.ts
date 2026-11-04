import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHuntCatalog } from '../src/tracker/catalog';
import { chooseHunt, needsReentry } from '../src/tracker/scheduler';
import type { HuntCatalog, HuntTarget, TrackerPrefs } from '../src/tracker/types';
import { referenceEngine } from './reference-engine';

const target = (id: number, kind: HuntTarget['kind'], ch: number): HuntTarget => ({ id, name: String(id), kind, owned: false, status: '', destinations: [{ chapter: ch, region: 'johto', name: String(ch), until: 1000 }] });
const prefs: TrackerPrefs = { targets: [243, 244], mode: 'ordered', weather: null, berries: [] };
const catalog = (targets = [target(243, 'roaming', 20), target(244, 'roaming', 21), target(361, 'weather', 22)]): HuntCatalog => ({ now: 100, chapter: 0, team: ['a'], targets });
describe('挂机调度', () => {
  it('按用户顺序追踪，只有实际捕获后才换目标', () => {
    const c = catalog(), first = chooseHunt(c, prefs, null)!;
    expect(first.id).toBe(243);
    expect(chooseHunt(c, prefs, first)!.id).toBe(243);
    c.targets[0].owned = true;
    expect(chooseHunt(c, prefs, first)!.id).toBe(244);
    c.targets[1].owned = true;
    expect(chooseHunt(c, { ...prefs, mode: 'interrupt' }, first)).toBeNull();
  });
  it('跟随原目标的新位置，失效位置不再可用', () => {
    const c = catalog(), current = chooseHunt(c, prefs, null)!;
    c.targets[0].destinations[0].chapter = 23;
    expect(chooseHunt(c, prefs, current)!.destination.chapter).toBe(23);
    c.now = 1001;
    expect(chooseHunt(c, prefs, current)).toBeNull();
  });
  it('天气插队后回到原任务；关闭插队不受天气干扰', () => {
    const c = catalog(), current = chooseHunt(c, prefs, null)!;
    expect(chooseHunt(c, prefs, current)!.id).toBe(243);
    const interruptPrefs = { ...prefs, mode: 'interrupt' as const };
    const interrupt = chooseHunt(c, interruptPrefs, current)!;
    expect(interrupt).toMatchObject({ id: 361, interrupt: true });
    c.targets[2].owned = true;
    expect(chooseHunt(c, interruptPrefs, interrupt)!.id).toBe(243);
    c.targets[2].owned = false; c.targets[2].destinations = [];
    expect(chooseHunt(c, interruptPrefs, interrupt)!.id).toBe(243);
  });
  it('保持正在捕捉的天气目标，尊重自选天气关注名单', () => {
    const c = catalog(); c.targets.push(target(36101, 'weather', 24));
    const p = { ...prefs, mode: 'interrupt' as const, weather: [36101] };
    const current = chooseHunt(c, p, null)!;
    expect(current.id).toBe(36101);
    c.targets[2].destinations[0].until = 200;
    expect(chooseHunt(c, { ...p, weather: null }, current)!.id).toBe(36101);
    expect(chooseHunt(c, { ...p, weather: [] }, current)!.id).toBe(243);
    expect(chooseHunt(c, prefs, current)!.interrupt).toBe(false);
  });
  it('跳过尚未解锁目标，并优先处理即将结束的天气机会', () => {
    const c = catalog(); c.targets[0].destinations = [];
    expect(chooseHunt(c, prefs, null)!.id).toBe(244);
    c.targets.push(target(25, 'weather', 24)); c.targets[3].destinations[0].until = 200;
    expect(chooseHunt(c, { ...prefs, mode: 'interrupt' }, null)!.id).toBe(25);
  });
  it('只在游走节点已错过／尚未生成时重进；天气节点仍在道中则继续', () => {
    const c = catalog(), roaming = chooseHunt(c, prefs, null)!;
    const adv = { chapter: 20, node: 1, nodes: [{}, { type: 'wild', roamer: 243 }] };
    expect(needsReentry(roaming, adv)).toBe(false);
    expect(needsReentry(roaming, { ...adv, node: 2 })).toBe(true);
    expect(needsReentry(roaming, { ...adv, nodes: [{ type: 'wild' }] })).toBe(true);
    const wx = chooseHunt(c, { ...prefs, mode: 'interrupt' }, null)!;
    wx.destination.habitats = ['Route|area'];
    expect(needsReentry(wx, { chapter: 22, node: 0, nodes: [{ type: 'wild', name: 'Route', areas: ['area'] }] })).toBe(false);
    expect(needsReentry(wx, { chapter: 22, node: 1, nodes: [{ type: 'wild', name: 'Route', areas: ['area'] }] })).toBe(true);
  });
});

describe.skipIf(!existsSync('.cache/engine.js'))('原生引擎追踪条件', () => {
  let read: Awaited<ReturnType<typeof createHuntCatalog>>, save: any, t: Record<string, any>;
  const now = Date.UTC(2026, 10, 4, 12);
  beforeAll(async () => {
    const source = readFileSync('.cache/engine.js', 'utf8');
    read = await createHuntCatalog(source); t = referenceEngine(source, now);
    save = t.Game.freshState(); save.travel = { to: ['johto', 'hoenn', 'sinnoh'] };
    save.mons = [{ id: 445, uid: 'a', level: 100, xp: 0, reg: 'sinnoh' }]; save.team = ['a'];
    save.adv = { chapter: 66, unlocked: t.STORY.CHAPTERS.length - 1, nodes: [], node: 0, battle: null, runs: 100, layout: 6,
      badges: ['Maître Johto', 'Maître Hoenn', 'Maître Sinnoh'], gifts: {}, kept: {}, loops: [] };
    save.roam = { at: { 243: { ch: 23, until: now + 600000 } }, caught: [] };
  });
  it('读取实际游走位置与解锁条件，不生成虚构的下一个地点', () => {
    const raw = JSON.stringify(save), c = read(raw, now);
    expect(c.targets.find(t => t.id === 243)).toMatchObject({ destinations: [{ chapter: 23, until: now + 600000 }] });
    expect(c.targets.find(t => t.id === 244)!.destinations).toEqual([]);
    expect(read(raw, now + 600001).targets.find(t => t.id === 243)!.destinations).toEqual([]);
    const locked = JSON.parse(raw); locked.adv.badges = [];
    expect(read(JSON.stringify(locked), now).targets.find(t => t.id === 243)!.destinations).toEqual([]);
    expect(JSON.stringify(save)).toBe(raw);
  });
  it('所有权包含寄养精灵；神兽捕获记录结束重复追踪', () => {
    const s = structuredClone(save); s.pension = { mons: [{ mon: { id: 243, uid: 'p', level: 100, xp: 0 } }], eggs: [] };
    expect(read(JSON.stringify(s), now).targets.find(t => t.id === 243)!.owned).toBe(true);
    s.pension.mons = []; s.roam.caught.push(243);
    expect(read(JSON.stringify(s), now).targets.find(t => t.id === 243)).toMatchObject({ owned: true, destinations: [] });
  });
  it('天气机会使用原生遭遇池和天气，不把普通属性克制当成稀有条件', () => {
    const c = read(JSON.stringify(save), now), wx = c.targets.filter(t => t.kind === 'weather');
    expect(wx.length).toBeGreaterThan(20);
    const native = t.Game;
    native.sandbox(structuredClone(save), () => {
      const node = { ...t.STORY.CHAPTERS[23].steps.find((step: any) => step.name === 'Route 44'), type: 'wild', ch: 23 };
      // Raikou's live position gives this map a native storm. The catalog must
      // expose actual weather-only entries, not all water/electric Pokémon.
      expect(wx.some(target => target.destinations.some(d => d.chapter === 23 && d.weather === 'storm'))).toBe(true);
    });
    expect(c.targets.some(t => t.id === 150 && t.kind === 'zone')).toBe(true);
    expect(wx.every(t => t.destinations.every(d => d.chance! > 0 && !!d.weather && d.habitats!.length > 0))).toBe(true);
  });
  it('地区限制和神兽独立队伍会阻止悄悄更换已配置队伍', () => {
    const s = structuredClone(save); s.link = { to: 'sinnoh', from: 'kanto', side: 'to', stash: { team: [] } };
    expect(read(JSON.stringify(s), now).targets.find(t => t.id === 243)!.destinations).toEqual([]);
    const z = structuredClone(save); z.mons.push({ id: 143, uid: 'b', level: 100, xp: 0, reg: 'sinnoh' });
    z.eventTeams = { 'zone:150': ['b'] };
    expect(read(JSON.stringify(z), now).targets.find(t => t.id === 150)).toMatchObject({ destinations: [], status: '该神兽有独立队伍，请先与当前队伍对齐' });
  });
  it('包含天气限定的定点形态，保留原生前置捕获和一次性条件', () => {
    const s = structuredClone(save); s.dex[479] = { caught: 1 };
    const target = read(JSON.stringify(s), now).targets.find(t => t.id === 47904)!;
    expect(target.destinations).toContainEqual(expect.objectContaining({ chapter: 49, weather: 'storm', staticId: 47904, chance: 0.04 }));
    expect(read(JSON.stringify(save), now).targets.find(t => t.id === 47904)!.destinations).toEqual([]);
    const step = t.STORY.CHAPTERS[49].steps.find((step: any) => step.id === 47904); s.adv.gifts[step.once] = true;
    expect(read(JSON.stringify(s), now).targets.find(t => t.id === 47904)!.destinations).toEqual([]);
    const j = { id: 47904, kind: 'weather' as const, destination: target.destinations[0], interrupt: true };
    expect(needsReentry(j, { chapter: 49, nodes: [{ type: 'static', id: 47904 }], node: 0 })).toBe(false);
    expect(needsReentry(j, { chapter: 49, nodes: [], node: 0 })).toBe(true);
  });
});
