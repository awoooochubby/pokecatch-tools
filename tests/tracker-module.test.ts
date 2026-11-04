import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { EventBus } from '../src/core/events';
import { Store } from '../src/core/storage';
import { createTracker } from '../src/modules/tracker';
import type { GameAdapter } from '../src/core/game';
import type { GameEvents } from '../src/core/types';
import type { HuntNavigation } from '../src/tracker/navigation';

const mocks = vi.hoisted(() => ({ workers: [] as any[] }));
vi.mock('../src/simulation/source', () => ({ fetchEngineSource: vi.fn(async () => 'verified source') }));
vi.mock('../src/tracker/worker?worker&inline', () => ({ default: class {
  onmessage: any; onerror: any; sent: any[] = []; terminated = false;
  constructor() { mocks.workers.push(this); }
  postMessage(message: any) { this.sent.push(message); }
  terminate() { this.terminated = true; }
  reply(catalog: any) { this.onmessage({ data: { serial: this.sent.at(-1).serial, catalog: structuredClone(catalog) } }); }
} }));
let tracker: ReturnType<typeof createTracker>, storage: Storage, bus: EventBus<GameEvents>, save: any, nav: any, catalog: any;
const write = () => storage.setItem('gachamon-save-v1', JSON.stringify(save));
const poll = () => { vi.advanceTimersByTime(2100); bus.emit('sample', { save, now: Date.now(), gap: false }); };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T12:00:00Z')); mocks.workers.length = 0;
  const values = new Map<string, string>();
  storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, clear: () => values.clear(), key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; } };
  vi.stubGlobal('localStorage', storage); vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', { hidden: false });
  save = { mons: [{ id: 445, uid: 'a', level: 100, xp: 0 }], team: ['a'], adv: { chapter: 0, unlocked: 50, nodes: [], node: 0, battle: null, runs: 0 } }; write();
  catalog = { now: Date.now(), chapter: 0, team: ['a'], targets: [243, 244, 361].map((id, i) => ({ id, name: String(id), kind: i === 2 ? 'weather' : 'roaming', owned: false,
    status: '', destinations: [{ chapter: 20 + i, region: 'johto', name: `map-${20 + i}`, until: Date.now() + 600000 }] })) };
  bus = new EventBus<GameEvents>();
  nav = { blocked: vi.fn(() => false), battleVisible: vi.fn(() => false), showAdventure: vi.fn(), eatBerry: vi.fn(() => false), dismissCaptureNotice: vi.fn(() => false), refreshPositions: vi.fn(() => true),
    travel: vi.fn((d: any) => { save.adv.chapter = d.chapter; save.adv.nodes = [{ roamer: 243 + d.chapter - 20 }]; write(); }) };
  tracker = createTracker({ bus, auditedExperienceRules: () => true } as unknown as GameAdapter, new Store(storage), nav as HuntNavigation);
  tracker.prefs.targets = [243, 244];
});
afterEach(() => { tracker.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function ready() { await tracker.load(); mocks.workers.at(-1).reply(catalog); }
const reply = () => mocks.workers.at(-1).reply(catalog);
describe('追踪器生命周期与自动操作', () => {
  it('明确开始后才切图，捕获后自动切换到下一只，全部完成后停止', async () => {
    await ready(); expect(nav.travel).not.toHaveBeenCalled();
    tracker.start(); reply(); expect(nav.travel).toHaveBeenLastCalledWith(expect.objectContaining({ chapter: 20 }), false);
    save.mons.push({ id: 243, uid: 'caught', level: 100, xp: 0 }); write(); catalog.targets[0].owned = true;
    vi.advanceTimersByTime(4100); poll(); reply();
    expect(nav.travel).toHaveBeenLastCalledWith(expect.objectContaining({ chapter: 21 }), false);
    catalog.targets[1].owned = true; poll(); reply();
    expect(tracker.state.running).toBe(false); expect(tracker.state.phase).toContain('全部目标已捕获');
    expect(save.team).toEqual(['a']);
  });
  it('存档或原生界面仍在战斗／捕获动画时不切走', async () => {
    await ready(); save.adv.battle = { enemies: [{ id: 243, hp: 10 }] }; write();
    tracker.start(); reply(); expect(nav.travel).not.toHaveBeenCalled();
    save.adv.battle = null; write(); nav.battleVisible.mockReturnValue(true); poll(); reply(); expect(nav.travel).not.toHaveBeenCalled();
    nav.battleVisible.mockReturnValue(false); poll(); reply(); expect(nav.travel).toHaveBeenCalledTimes(1);
  });
  it('允许天气插队，完成后回到主目标；停止后迟到的结果不能切图', async () => {
    await ready(); tracker.prefs.mode = 'interrupt'; tracker.start(); reply();
    expect(nav.travel).toHaveBeenLastCalledWith(expect.objectContaining({ chapter: 22 }), false);
    catalog.targets[2].owned = true; vi.advanceTimersByTime(4100); poll(); reply();
    expect(nav.travel).toHaveBeenLastCalledWith(expect.objectContaining({ chapter: 20 }), false);
    poll(); const calls = nav.travel.mock.calls.length; tracker.stop(); catalog.targets[0].destinations[0].chapter = 23; reply();
    expect(nav.travel).toHaveBeenCalledTimes(calls);
  });
  it('手动改队或切图失败会暂停，不继续循环点击', async () => {
    await ready(); tracker.start(); save.team = []; write(); reply();
    expect(tracker.state.running).toBe(false); expect(tracker.state.error).toContain('队伍配置已改变'); expect(nav.travel).not.toHaveBeenCalled();
    save.team = ['a']; write(); nav.travel.mockImplementation(() => {}); tracker.start(); reply();
    expect(tracker.state.running).toBe(false); expect(tracker.state.error).toContain('没有进入目标地图');
  });
  it('隐藏标签页时等待，恢复后继续；配置保存但运行状态不自动恢复', async () => {
    await ready(); tracker.persist(); tracker.start();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true }); reply(); expect(nav.travel).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true }); poll(); reply(); expect(nav.travel).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.getItem('pc-tools-v1')!).data.tracker).toEqual({ targets: [243, 244], mode: 'ordered', weather: null, berries: [] });
    tracker.dispose(); tracker = createTracker({ bus, auditedExperienceRules: () => true } as unknown as GameAdapter, new Store(storage), nav);
    expect(tracker.state.running).toBe(false); expect(tracker.prefs.targets).toEqual([243, 244]);
  });
  it('卸载会终止读取任务，过期结果不能恢复自动操作', async () => {
    await ready(); tracker.start(); tracker.dispose(); reply();
    expect(nav.travel).not.toHaveBeenCalled(); expect(mocks.workers.at(-1).terminated).toBe(true);
  });
  it('原生捕获自动填入空队位后，仍会切换下一目标', async () => {
    await ready(); tracker.start(); reply();
    save.mons.push({ id: 243, uid: 'new-capture', level: 100, xp: 0 }); save.team.push('new-capture'); write();
    catalog.targets[0].owned = true; vi.advanceTimersByTime(4100); poll(); reply();
    expect(tracker.state.running).toBe(true);
    expect(nav.travel).toHaveBeenLastCalledWith(expect.objectContaining({ chapter: 21 }), false);
    expect(tracker.state.logs.some(entry => entry.text.includes('空位'))).toBe(true);
  });
  it('切图保存时才写入的新捕获空位成员不会被误判为手动换队', async () => {
    await ready();
    nav.travel.mockImplementation((d: any) => {
      save.adv.chapter = d.chapter; save.mons.push({ id: 19, uid: 'late-capture', level: 3, xp: 0 }); save.team.push('late-capture'); write();
    });
    tracker.start(); reply();
    expect(tracker.state.running).toBe(true); expect(tracker.state.error).toBe('');
  });
  it('自动吃所选果子，到期续吃、缺货恢复和手动停止均生效', async () => {
    catalog.berries = [{ key: 'pinap-berry', family: 'xp', name: '凰梨果', minutes: 60, mult: 1.25, stock: 2 }];
    save.items = { 'pinap-berry': 2 }; save.buffs = {}; write();
    nav.eatBerry.mockImplementation((key: string) => { save.items[key]--; save.buffs.xp = { key, until: Date.now() + 3600000 }; write(); return true; });
    await ready(); tracker.setBerries(['pinap-berry']); tracker.start(); reply();
    expect(nav.eatBerry).toHaveBeenCalledTimes(1); expect(save.items['pinap-berry']).toBe(1);
    poll(); reply(); expect(nav.eatBerry).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3600001); poll(); reply(); expect(nav.eatBerry).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(3600001); poll(); reply(); expect(nav.eatBerry).toHaveBeenCalledTimes(2);
    expect(tracker.state.berryStatus).toContain('库存不足'); expect(tracker.state.running).toBe(true);
    save.items['pinap-berry'] = 1; write(); poll(); reply(); expect(nav.eatBerry).toHaveBeenCalledTimes(3);
    tracker.stop(); vi.advanceTimersByTime(3600001); poll(); expect(nav.eatBerry).toHaveBeenCalledTimes(3);
  });
  it('没有可执行目标时不浪费果子，未勾选时不消耗', async () => {
    catalog.berries = [{ key: 'pinap-berry', family: 'xp', name: '凰梨果', minutes: 60, mult: 1.25, stock: 2 }];
    save.items = { 'pinap-berry': 2 }; write();
    await ready(); tracker.start(); reply(); expect(nav.eatBerry).not.toHaveBeenCalled();
    tracker.stop(); tracker.setBerries(['pinap-berry']); catalog.targets.forEach((t: any) => { t.destinations = []; });
    tracker.start(); reply(); expect(nav.eatBerry).not.toHaveBeenCalled(); expect(tracker.state.berryStatus).toContain('暂不消耗');
  });
});
