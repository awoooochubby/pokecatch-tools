import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudSaver, saveFingerprint } from '../src/modules/cloud-save';
import { Store } from '../src/core/storage';
import type { GameAdapter } from '../src/core/game';
import { EventBus } from '../src/core/events';
import type { GameEvents } from '../src/core/types';

let saver: ReturnType<typeof createCloudSaver>, storage: Storage, button: any, toasts: any[], doc: any, audited: boolean;
let sampling: ReturnType<typeof setInterval>;
const meta = (base: number, print = 'snapshot') => storage.setItem('pokecatch-cloud-user', JSON.stringify({ user: 'test-account', base: new Date(base).toISOString(), print }));
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T12:00:00Z')); const values = new Map<string, string>();
  storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); }, clear: () => values.clear(), key: i => [...values.keys()][i] ?? null, get length() { return values.size; } };
  vi.stubGlobal('localStorage', storage); vi.stubGlobal('navigator', { onLine: true });
  button = { dataset: { state: 'ok' }, disabled: false, classList: { contains: () => false }, click: vi.fn() }; toasts = []; audited = true;
  doc = { hidden: false, querySelector: (selector: string) => selector === '#save-btn' ? button : null, querySelectorAll: () => toasts };
  meta(Date.now() - 3600000); storage.setItem('gachamon-save-v1', JSON.stringify({ mons: [], money: 100 }));
  const bus = new EventBus<GameEvents>(); sampling = setInterval(() => bus.emit('sample', { save: {} as any, now: Date.now(), gap: false }), 1000);
  saver = createCloudSaver({ bus, auditedExperienceRules: () => audited } as GameAdapter, new Store(storage), doc);
});
afterEach(() => { saver.dispose(); clearInterval(sampling); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('原生云保存确认', () => {
  it('只有服务端存档回执与原生成功标记同时变化才确认上传；普通本地保存不算', () => {
    saver.saveNow(); expect(button.click).toHaveBeenCalledTimes(1); expect(saver.state.waiting).toBe(true);
    storage.setItem('gachamon-save-v1', JSON.stringify({ mons: [], money: 200 }));
    vi.advanceTimersByTime(1000); expect(saver.state.confirmedAt).toBe(0);
    meta(Date.now()); vi.advanceTimersByTime(1000); expect(saver.state.confirmedAt).toBe(0);
    storage.setItem('pokecatch-save-btn', String(Date.now())); vi.advanceTimersByTime(1000);
    expect(saver.state.confirmedAt).toBeGreaterThan(0); expect(saver.state.phase).toContain('服务端保存回执'); expect(saver.state.waiting).toBe(false);
    vi.advanceTimersByTime(14 * 60000); expect(button.click).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61000); expect(button.click).toHaveBeenCalledTimes(2);
  });
  it('点击或 busy→ok 不等于成功，超时明确未确认并延迟重试', () => {
    saver.saveNow(); button.dataset.state = 'busy'; vi.advanceTimersByTime(1000); button.dataset.state = 'ok';
    vi.advanceTimersByTime(60000); expect(saver.state.confirmedAt).toBe(0); expect(saver.state.phase).toContain('超时'); expect(saver.state.issue).toBe(true);
    expect(button.click).toHaveBeenCalledTimes(1); vi.advanceTimersByTime(60000); expect(button.click).toHaveBeenCalledTimes(2);
  });
  it('原生 same 成功提示必须是新出现且存档指纹匹配，才确认云端已存在该进度', () => {
    const raw = storage.getItem('gachamon-save-v1')!; meta(Date.now() - 10000, saveFingerprint(raw));
    toasts.push({ textContent: '进度已在线保存！' }); saver.saveNow();
    vi.advanceTimersByTime(1000); expect(saver.state.confirmedAt).toBe(0);
    toasts.push({ textContent: '进度已在线保存！' }); vi.advanceTimersByTime(1000);
    expect(saver.state.phase).toContain('无需重复上传'); expect(saver.state.confirmedAt).toBeGreaterThan(0);
  });
  it('尊重原生 15 分钟冷却，离线／会话过期／未登录不触发登录或重复点击', () => {
    storage.setItem('pokecatch-save-btn', String(Date.now())); saver.saveNow(); expect(button.click).not.toHaveBeenCalled();
    expect(saver.state.phase).toContain('冷却'); vi.advanceTimersByTime(14 * 60000); expect(button.click).not.toHaveBeenCalled();
    button.dataset.state = 'lost'; vi.advanceTimersByTime(61000); expect(button.click).not.toHaveBeenCalled(); expect(saver.state.short).toBe('连接过期');
    button.dataset.state = 'off'; saver.saveNow(); expect(button.click).not.toHaveBeenCalled(); expect(saver.state.short).toContain('未登录');
    button.dataset.state = 'ok'; Object.defineProperty(navigator, 'onLine', { value: false }); saver.saveNow(); expect(button.click).not.toHaveBeenCalled(); expect(saver.state.short).toBe('离线');
  });
  it('关闭、隐藏页、未适配版本和卸载不自动点击；切换账号会清掉旧账号确认', () => {
    saver.configure(false); vi.advanceTimersByTime(6000); expect(button.click).not.toHaveBeenCalled();
    saver.configure(true); doc.hidden = true; vi.advanceTimersByTime(2000); expect(button.click).not.toHaveBeenCalled();
    doc.hidden = false; audited = false; vi.advanceTimersByTime(1000); expect(button.click).not.toHaveBeenCalled();
    audited = true; saver.saveNow(); meta(Date.now()); storage.setItem('pokecatch-save-btn', String(Date.now())); vi.advanceTimersByTime(1000);
    expect(saver.state.confirmedAt).toBeGreaterThan(0);
    storage.setItem('pokecatch-cloud-user', JSON.stringify({ user: 'other-account', base: new Date().toISOString(), print: 'other' })); vi.advanceTimersByTime(1000);
    expect(saver.state.confirmedAt).toBe(0); expect(saver.state.short).toBe('尚未确认'); saver.dispose(); vi.advanceTimersByTime(3600000); expect(button.click).toHaveBeenCalledTimes(1);
  });
});
