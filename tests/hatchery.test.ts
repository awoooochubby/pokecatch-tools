import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { readEggs } from '../src/hatchery/eggs';
import { createHatchery } from '../src/modules/hatchery';
import { EventBus } from '../src/core/events';
import { Store } from '../src/core/storage';
import { referenceEngine } from './reference-engine';
const now = Date.UTC(2026, 10, 5, 12);
const eggs = [{ uid: 'shiny', id: 175, shiny: true, laidAt: now - 60000, hatchAt: now - 1 }, { uid: 'normal', id: 172, shiny: false, laidAt: now - 60000, hatchAt: now + 60000 }, { uid: 'old', id: 173, laidAt: now - 60000, hatchAt: now - 1 }];
describe('蛋数据读取', () => {
  it('生蛋值决定显示，明确区分普通和未知；成熟边界精确到时间戳', () => {
    const raw = JSON.stringify({ pension: { eggs } }), rows = readEggs(raw, now);
    expect(rows.map(e => e.shiny)).toEqual([true, false, null]);
    expect(rows.map(e => e.ready)).toEqual([true, false, true]); expect(rows[1].remaining).toBe(60000);
    expect(readEggs(raw, now + 60000)[1].ready).toBe(true); expect(JSON.parse(raw).pension.eggs).toEqual(eggs);
  });
  it('空栏可读取，坏时间戳和重复 UID 会拒绝自动领取', () => {
    expect(readEggs('{}', now)).toEqual([]);
    expect(() => readEggs(JSON.stringify({ pension: { eggs: [{ ...eggs[0], hatchAt: 'tomorrow' }] } }), now)).toThrow();
    expect(() => readEggs(JSON.stringify({ pension: { eggs: [eggs[0], eggs[0]] } }), now)).toThrow('重复');
  });
});
describe('收蛋调度', () => {
  let h: ReturnType<typeof createHatchery>, bus: EventBus<any>, nav: any, coordinator: any, storage: Storage;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const values = new Map<string, string>(); storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); }, key: i => [...values.keys()][i] ?? null, clear: () => values.clear(), get length() { return values.size; } };
    vi.stubGlobal('localStorage', storage); vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
    storage.setItem('gachamon-save-v1', JSON.stringify({ pension: { eggs } }));
    bus = new EventBus();
    nav = { dismissCaptureNotice: vi.fn(() => false), safe: vi.fn(() => true), visit: vi.fn(async () => () => {}), collect: vi.fn(async (egg: any) => {
      const save = JSON.parse(storage.getItem('gachamon-save-v1')!); save.pension.eggs = save.pension.eggs.filter((e: any) => e.uid !== egg.uid); storage.setItem('gachamon-save-v1', JSON.stringify(save));
    }) };
    coordinator = { available: vi.fn(() => true), withUI: vi.fn((fn: () => Promise<void>) => fn()) };
    h = createHatchery({ bus, auditedExperienceRules: () => true } as any, new Store(storage), coordinator, nav);
  });
  afterEach(() => { h.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('默认不自动领取；一键只领成熟蛋并使用界面操作互斥', async () => {
    bus.emit('sample', {}); expect(nav.collect).not.toHaveBeenCalled();
    await h.collect(); expect(nav.collect.mock.calls.map((args: any[]) => args[0].uid)).toEqual(['shiny', 'old']);
    expect(h.state.eggs.map(e => e.uid)).toEqual(['normal']); expect(h.state.received).toBe(2); expect(coordinator.withUI).toHaveBeenCalledTimes(1);
  });
  it('开关持久化；战斗或追踪器操作期间等待，空闲后自动领取', async () => {
    h.setEnabled(true); nav.safe.mockReturnValue(false); bus.emit('sample', {}); expect(nav.collect).not.toHaveBeenCalled();
    nav.safe.mockReturnValue(true); coordinator.available.mockReturnValue(false); bus.emit('sample', {}); expect(nav.collect).not.toHaveBeenCalled();
    coordinator.available.mockReturnValue(true); bus.emit('sample', {}); await vi.runAllTimersAsync(); expect(h.state.received).toBe(2);
    expect(JSON.parse(storage.getItem('pc-tools-v1')!).data.hatchery.enabled).toBe(true);
  });
  it('单次预约在战斗结束后只领指定蛋，不会暗中开启自动模式；预约可取消', async () => {
    nav.safe.mockReturnValue(false); await h.collect('shiny'); expect(h.state.waiting).toBe(true); expect(h.prefs.enabled).toBe(false);
    bus.emit('sample', {}); expect(nav.collect).not.toHaveBeenCalled();
    nav.safe.mockReturnValue(true); bus.emit('sample', {}); await vi.runAllTimersAsync();
    expect(nav.collect.mock.calls.map((args: any[]) => args[0].uid)).toEqual(['shiny']); expect(h.state.waiting).toBe(false);
    nav.safe.mockReturnValue(false); await h.collect('old'); h.cancel(); nav.safe.mockReturnValue(true); bus.emit('sample', {});
    expect(nav.collect).toHaveBeenCalledTimes(1);
  });
  it('领取失败停用自动模式，保留蛋，不持续重试', async () => {
    h.setEnabled(true); nav.collect.mockRejectedValue(new Error('PC 满')); bus.emit('sample', {}); await vi.runAllTimersAsync();
    expect(h.prefs.enabled).toBe(false); expect(h.state.error).toBe('PC 满'); expect(h.state.eggs).toHaveLength(3);
    bus.emit('sample', {}); expect(nav.collect).toHaveBeenCalledTimes(1);
  });
});
describe.skipIf(!existsSync('.cache/engine.js'))('核对原生孵化规则', () => {
  it('原生孵化沿用每枚蛋的 shiny，不在孵化时重抽；未成熟不能领取', () => {
    const t = referenceEngine(readFileSync('.cache/engine.js', 'utf8'), now), g = t.Game, s = g.freshState();
    s.pension = { mons: [], eggs: structuredClone(eggs) };
    g.sandbox(s, () => {
      expect(g.hatchEgg('normal')).toBeNull();
      const result = g.hatchEgg('shiny'); expect(result.mon.id).toBe(175); expect(result.mon.shiny).toBe(true);
      s.pension.eggs[0].hatchAt = now; const ordinary = g.hatchEgg('normal'); expect(ordinary.mon.shiny).toBe(false);
      expect(s.pension.eggs.map((e: any) => e.uid)).toEqual(['old']);
    });
  });
});
