import { reactive } from 'vue';
import type { GameAdapter } from '../core/game';
import type { Store } from '../core/storage';

const MANUAL_COOLDOWN = 15 * 60_000;
const successToasts = new Set(['进度已在线保存！', 'Partie sauvegardée en ligne !', 'Game saved online!', 'Progress saved online!']);
interface Checkpoint { user: string; base: string; confirmedAt: number; }
interface CloudMeta { user: string; base: string; print: string; }
function metadata(): CloudMeta | null {
  // Audited public save metadata, never authentication tokens/credentials.
  try {
    const m = JSON.parse(localStorage.getItem('pokecatch-cloud-user') || 'null');
    return typeof m?.user === 'string' && typeof m.base === 'string' && Number.isFinite(Date.parse(m.base)) && typeof m.print === 'string' ? m : null;
  } catch { return null; }
}
export function saveFingerprint(raw: string) {
  const ignored = new Set(['lastTick', 'updatedAt', 'playMs', 'awayMs']);
  const text = JSON.stringify(JSON.parse(raw), (key, value) => ignored.has(key) ? undefined : value);
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = hash * 31 + text.charCodeAt(i) | 0;
  return `${text.length}:${hash}`;
}
export function createCloudSaver(game: GameAdapter, store: Store, doc: Document = document) {
  const saved = store.get<{ enabled?: boolean; minutes?: number; checkpoint?: Checkpoint }>('cloudSave', {});
  const prefs = reactive({ enabled: saved.enabled !== false, minutes: Number.isFinite(saved.minutes) ? Math.max(15, Math.min(120, Math.round(saved.minutes!))) : 15 });
  const state = reactive({ waiting: false, phase: prefs.enabled ? '等待游戏云保存入口' : '定期云保存已关闭', short: prefs.enabled ? '等待检查' : '定期保存关闭', issue: false,
    confirmedAt: 0, serverAt: 0, nextAt: Date.now() + 5000, attemptedAt: 0 });
  let checkpoint = saved.checkpoint, pending: { user: string | null; base: string | null; stamp: number; until: number; toasts: Set<Element> } | null = null;
  let disposed = false, retry = 60_000;
  const stamp = () => Number(localStorage.getItem('pokecatch-save-btn')) || 0;
  function persist() { store.set('cloudSave', { ...prefs, checkpoint }); }
  function problem(message: string, short: string) { state.issue = true; state.phase = message; state.short = short; }
  function confirm(meta: CloudMeta, uploaded: boolean) {
    checkpoint = { user: meta.user, base: meta.base, confirmedAt: Date.now() };
    state.confirmedAt = checkpoint.confirmedAt; state.serverAt = Date.parse(meta.base); state.issue = false; state.short = '已确认在线';
    state.phase = uploaded ? '上传已确认：游戏已收到服务端保存回执' : '已确认云端已有同一进度，本次无需重复上传';
    state.waiting = false; pending = null; retry = 60_000; state.nextAt = Date.now() + prefs.minutes * 60_000; persist();
  }
  function fail(message: string) {
    pending = null; state.waiting = false; problem(message, '上传未确认');
    state.nextAt = Date.now() + retry; retry = Math.min(5 * 60_000, retry * 2);
  }
  function checkReceipt() {
    const meta = metadata(), button = doc.querySelector<HTMLElement>('#save-btn');
    if (checkpoint && (!meta || checkpoint.user !== meta.user)) {
      checkpoint = undefined; state.confirmedAt = state.serverAt = 0;
      problem('账号信息已变化，当前账号的云端存档尚未确认', '尚未确认');
      if (prefs.enabled) state.nextAt = Date.now() + 5000;
      persist();
    } else if (checkpoint && !state.confirmedAt) {
      state.confirmedAt = checkpoint.confirmedAt; state.serverAt = Date.parse(checkpoint.base);
      state.short = '上次已确认';
    }
    if (!pending) return;
    if (meta && pending.user && meta.user !== pending.user) { fail('保存期间账号已变化，尚未确认当前账号的上传'); return; }
    // The native manual-save stamp advances ONLY after saveNow() receives an
    // acknowledged upload. A local save, busy->ok transition or click is not proof.
    if (meta && meta.base !== pending.base && stamp() > pending.stamp && button?.dataset.state === 'ok') { confirm(meta, true); return; }
    const freshSuccess = [...doc.querySelectorAll('#toasts .toast')].some(el => !pending!.toasts.has(el) && successToasts.has(el.textContent?.trim() || ''));
    if (freshSuccess && meta && button?.dataset.state === 'ok') {
      const raw = localStorage.getItem('gachamon-save-v1');
      if (raw && meta.print === saveFingerprint(raw)) { confirm(meta, false); return; }
    }
    if (button?.dataset.state === 'error' || button?.dataset.state === 'lost' || button?.dataset.state === 'off') { fail('原生云保存失败、未登录或连接过期；尚未确认上传成功'); return; }
    if (Date.now() >= pending.until) fail('等待服务端上传回执超时，尚未确认成功；稍后会重试');
  }
  function attempt(manual = false) {
    if (disposed || state.waiting || !manual && !prefs.enabled) return;
    const button = doc.querySelector<HTMLButtonElement>('#save-btn');
    if (!game.auditedExperienceRules()) { problem('当前游戏版本未验证，暂不自动操作保存按钮', '版本待适配'); return; }
    if (doc.hidden) { state.phase = '游戏标签页已隐藏，恢复可见后再尝试云保存'; return; }
    if (!button || doc.querySelector('.title-screen')) { state.phase = '等待进入游戏后定期云保存'; return; }
    if (navigator.onLine === false) { problem('当前离线，尚未确认云端保存；恢复网络后重试', '离线'); return; }
    if (button.dataset.state === 'off' || button.dataset.state === 'lost') {
      problem(button.dataset.state === 'lost' ? '游戏登录连接已过期，请在游戏内重新连接后再保存' : '云保存未就绪：请先登录，并确认当前窗口拥有游戏控制权', button.dataset.state === 'lost' ? '连接过期' : '未登录／不可用'); return;
    }
    if (button.dataset.state === 'busy' || button.disabled || doc.querySelector('.modal, .tab-modal, #evt-pick.open')) { state.phase = '等待游戏当前上传／弹窗结束，再检查云保存'; return; }
    if (!['ok', 'error'].includes(button.dataset.state || '')) { problem('无法识别游戏的云保存状态，尚未确认上传', '状态未知'); return; }
    const allowedAt = stamp() + MANUAL_COOLDOWN;
    if (allowedAt > Date.now() || button.classList.contains('wait')) {
      state.nextAt = Math.max(Date.now() + 30_000, allowedAt);
      state.phase = '游戏手动保存冷却中，到期后自动尝试；上次确认时间见下方'; return;
    }
    const meta = metadata();
    pending = { user: meta?.user || null, base: meta?.base || null, stamp: stamp(), until: Date.now() + 60_000, toasts: new Set(doc.querySelectorAll('#toasts .toast')) };
    state.waiting = true; state.attemptedAt = Date.now(); state.issue = false; state.short = '等待上传回执'; state.phase = '已点击游戏保存，等待服务端确认';
    try { button.click(); checkReceipt(); } catch { fail('游戏保存按钮操作失败，尚未确认上传'); }
  }
  function tick() {
    if (disposed) return;
    try { checkReceipt(); if (prefs.enabled && !state.waiting && Date.now() >= state.nextAt) attempt(); }
    catch { fail('云保存状态读取失败，尚未确认上传成功'); }
  }
  const off = game.bus.on('sample', tick);
  return { prefs, state, saveNow: () => attempt(true),
    configure(enabled: boolean, minutes = prefs.minutes) {
      prefs.enabled = enabled; prefs.minutes = Math.max(15, Math.min(120, Math.round(minutes || 15)));
      state.nextAt = Date.now() + 1000; persist();
      if (!enabled && !state.waiting) { state.phase = '定期云保存已关闭'; state.short = '定期保存关闭'; state.issue = false; }
    },
    dispose() { disposed = true; off(); pending = null; state.waiting = false; },
  };
}
