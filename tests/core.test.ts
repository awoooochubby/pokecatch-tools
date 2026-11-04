import { describe, it, expect, vi } from 'vitest';
import { Store, STORAGE_KEY } from '../src/core/storage';
import { EventBus } from '../src/core/events';
import { parseSave } from '../src/core/game';
import { effectiveness, dex } from '../src/core/pokemon';
import { emptySession, sampleSession, validSession, createExperience } from '../src/modules/experience';
import { createEnemies, identifySpecies } from '../src/modules/enemies';
import type { GameSave, GameEvents } from '../src/core/types';
import type { GameAdapter } from '../src/core/game';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
const save = (xp = 100, level = 5): GameSave => ({ team: ['a'], mons: [{ uid: 'a', id: 25, level, xp }], adv: { runs: 1, chapter: 1, battle: null }, stats: { battles: 0 } });
function setup() {
  const bus = new EventBus<GameEvents>();
  const game = { bus, monName: () => '皮卡丘', enemyVisible: () => true, enemyKo: () => false, hasAlly: (s: string) => s === '皮卡丘' } as unknown as GameAdapter;
  const storage = new MemoryStorage(), store = new Store(storage);
  return { game, bus, store, storage };
}

describe('non-destructive migration', () => {
  it('copies all old records once and leaves original keys untouched', () => {
    const storage = new MemoryStorage();
    storage.setItem('pc-stat-v1', JSON.stringify({ history: [{ run: 4 }] }));
    storage.setItem('pc-stat-session-v1', JSON.stringify({ ...emptySession(), total: 400 }));
    storage.setItem('pc-enemies-center-history', JSON.stringify({ current: { name: '旧路段', rows: {}, battles: [], unknown: 0 } }));
    const original = storage.getItem('pc-stat-v1');
    const store = new Store(storage);
    expect(store.get('stats', {})).toEqual({ history: [{ run: 4 }] });
    expect(store.get<{ total: number }>('session', { total: 0 }).total).toBe(400);
    expect(storage.getItem('pc-stat-v1')).toBe(original);
    store.set('stats', { history: [] });
    expect(new Store(storage).get('stats', null)).toEqual({ history: [] });
    expect(store.export().legacy['pc-stat-v1']).toEqual({ history: [{ run: 4 }] });
  });
  it('preserves unsupported future schemas', () => {
    const storage = new MemoryStorage(), future = JSON.stringify({ schema: 3, data: { important: 123 } });
    storage.setItem(STORAGE_KEY, future);
    const store = new Store(storage); store.set('settings', {});
    expect(store.error).toContain('数据版本不支持');
    expect(storage.getItem(STORAGE_KEY)).toBe(future);
    expect(store.export()).toMatchObject({ unsupportedData: JSON.parse(future) });
  });
  it('tolerates invalid JSON and reports quota failures', () => {
    const storage = new MemoryStorage(); storage.setItem('pc-stat-v1', '{');
    const store = new Store(storage);
    expect(store.get('stats', {})).toEqual({});
    vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    store.set('x', 12); expect(store.error).toContain('存储已满'); expect(store.get('x', 0)).toBe(12);
  });
  it.each(['{', '{"schema":1,"data":[]}', 'null', 'false'])('preserves malformed root storage for recovery: %s', raw => {
    const storage = new MemoryStorage(); storage.setItem(STORAGE_KEY, raw);
    const store = new Store(storage); store.set('settings', { enabled:true });
    expect(storage.getItem(STORAGE_KEY)).toBe(raw);
    expect(store.export()).toMatchObject({ unsupportedRaw:raw });
  });
});

describe('experience accounting', () => {
  it('accumulates repeated rewards without counting initial XP or duplicate samples', () => {
    const session = emptySession();
    sampleSession(session, save(100), 1000); sampleSession(session, save(140), 2000);
    sampleSession(session, save(140), 3000); sampleSession(session, save(150), 4000);
    expect(session.total).toBe(50); expect(session.mons.a.total).toBe(50); expect(session.start).toBe(1000);
  });
  it('keeps confirmed XP on level-up, lower-bound flags and reload', () => {
    let session = emptySession(); sampleSession(session, save(100), 1000); sampleSession(session, save(140), 2000);
    sampleSession(session, save(20, 6), 3000);
    session = JSON.parse(JSON.stringify(session)); sampleSession(session, save(25, 6), 4000);
    expect(session.total).toBe(65); expect(session.partial).toBe(true); expect(session.start).toBe(1000);
    expect(validSession(session)).toBe(true);
  });
  it('marks backwards XP and roster gaps without negative totals', () => {
    const session = emptySession(); sampleSession(session, save(140), 1000); sampleSession(session, save(100), 2000);
    expect(session.total).toBe(0); expect(session.partial).toBe(true);
  });
  it('records full and zero-reward battles, marks interruption, and does not duplicate subscriptions', () => {
    const { game, bus, store } = setup(), m = createExperience(game, store); m.start(); m.start();
    const emit = (s: GameSave, now: number, gap = false) => bus.emit('sample', { save: s, now, gap });
    emit(save(), 1000);
    const active = save(); active.stats!.battles = 1; active.adv.battle = { enemies: [] };
    emit(active, 2000);
    const rewarded = save(150); rewarded.stats!.battles = 1; emit(rewarded, 3000);
    expect(m.state.battles[0]).toMatchObject({ total: 50, partial: false });
    const zero = save(150); zero.stats!.battles = 2; zero.adv.battle = { enemies: [] }; emit(zero, 4000);
    zero.adv.battle = null; emit(structuredClone(zero), 5000);
    expect(m.state.battles[1]).toMatchObject({ total: 0, partial: false });
    emit(save(155), 30000, true); expect(m.state.session.partial).toBe(true);
    m.stop(); const total = m.state.session.total; emit(save(160), 31000); expect(m.state.session.total).toBe(total);
    m.start(); m.reset(); emit(save(160), 32000); expect(m.state.session.total).toBe(0);
    emit(save(165), 33000); expect(m.state.session.total).toBe(5);
  });
  it('ignores XP earned while disabled, including a reload before enabling', () => {
    const {game,bus,store}=setup(), m=createExperience(game,store);m.start();
    bus.emit('sample',{save:save(100),now:1000,gap:false});bus.emit('sample',{save:save(120),now:2000,gap:false});
    m.stop();bus.emit('sample',{save:save(500),now:3000,gap:false});
    store.set('settings',{experience:false});
    const reloaded=createExperience(game,store);reloaded.start();
    bus.emit('sample',{save:save(600),now:4000,gap:false});expect(reloaded.state.session.total).toBe(20);
    bus.emit('sample',{save:save(610),now:5000,gap:false});expect(reloaded.state.session.total).toBe(30);
  });
  it('counts the actual road instead of a pending planned party', () => {
    const session=emptySession(), first=save();first.road=['a'];first.team=['b'];first.mons.push({uid:'b',id:6,level:5,xp:0});
    sampleSession(session,first,1000);
    const next=structuredClone(first);next.mons[0].xp=150;next.mons[1].xp=1000;
    sampleSession(session,next,2000);expect(session.total).toBe(50);expect(session.mons.b).toBeUndefined();
  });
});

describe('game adapter and species', () => {
  it('rejects malformed saves, accepts empty game saves and does not evaluate save text', () => {
    expect(parseSave(null)).toBeNull(); expect(parseSave(JSON.stringify(save()))).toEqual(save());
    expect(() => parseSave('{')).toThrow(); expect(() => parseSave(JSON.stringify({ mons: [] }))).toThrow();
  });
  it.each([null,{}, {uid:'e',id:6,hp:'bad'}])('rejects malformed enemy records before module dispatch: %j', enemy => {
    const s=save();s.adv.battle={enemies:[enemy as never]};expect(()=>parseSave(JSON.stringify(s))).toThrow('结构不支持');
  });
  it('accepts the native null road used during region transitions', () => {
    const s={...save(),road:null};expect(parseSave(JSON.stringify(s))).toEqual(s);
  });
  it('calculates double weaknesses, resistance and immunity', () => {
    const chart = effectiveness(dex[6].types);
    expect(chart.find(x => x.type === 'rock')?.value).toBe(4);
    expect(chart.find(x => x.type === 'ground')?.value).toBe(0);
    expect(effectiveness(['bug', 'steel']).find(x => x.type === 'grass')?.value).toBe(.25);
  });
  it('recognizes multilingual aliases and unambiguous alternate forms', () => {
    expect(identifySpecies('野生喷火龙使用了火花')).toBe(6);
    expect(identifySpecies('Wild Charizard uses Ember')).toBe(6);
    expect(identifySpecies('洛托姆使用了电击', [47902])).toBe(47902);
    expect(identifySpecies('不存在的种类')).toBeUndefined();
  });
});

describe('module event isolation', () => {
  it('continues dispatching to healthy modules when another module throws', () => {
    const errors:unknown[]=[], bus=new EventBus<{sample:number}>((error,key)=>errors.push({error,key})), seen:number[]=[];
    bus.on('sample',()=>{throw new Error('broken module');});bus.on('sample',n=>seen.push(n));
    bus.emit('sample',1);bus.emit('sample',2);expect(seen).toEqual([1,2]);expect(errors).toHaveLength(2);
  });
});

describe('enemy events and lifecycle', () => {
  it('attributes direct hits, keeps status damage out of rank, and records deaths', () => {
    const { game, bus, store } = setup(), m = createEnemies(game, store); m.start(); m.start();
    bus.emit('log', '野生喷火龙使用了火花！');
    bus.emit('damage', { value: 37, side: 'ally', victim: '皮卡丘', healing: false, status: false, critical: false });
    bus.emit('log', '皮卡丘倒下了');
    expect(m.state.current.rows['6'].damage).toBe(37);
    expect(m.state.current.battles[0].kos[0]).toMatchObject({ victim: '皮卡丘', damage: 37 });
    bus.emit('damage', { value: 5, side: 'ally', victim: '皮卡丘', healing: false, status: true, critical: false });
    expect(m.state.current.rows['6'].damage).toBe(37);
    m.stop(); bus.emit('damage', { value: 50, side: 'ally', victim: '皮卡丘', healing: false, status: false, critical: false });
    expect(m.state.current.rows['6'].damage).toBe(37);
  });
  it('moves completed stages to previous, deduplicates center signals and preserves across reload', () => {
    const { game, bus, store } = setup(), m = createEnemies(game, store); m.start();
    bus.emit('damage', { value: 10, side: 'ally', victim: '皮卡丘', healing: false, status: false, critical: false });
    bus.emit('center', '宝可梦中心'); bus.emit('center', '宝可梦中心');
    expect(m.state.previous?.unknown).toBe(10); expect(m.state.current.unknown).toBe(0);
    expect(createEnemies(game, store).state.previous?.unknown).toBe(10);
    m.state.showPrevious = true; m.clear(); expect(m.state.previous?.unknown).toBe(10);
  });
});
