import { EventBus } from './events';
import type { Damage, GameEvents, GameSave } from './types';
import xpModel from '../data/experience.json';

export function parseSave(raw: string | null): GameSave | null {
  if (!raw) return null;
  const s = JSON.parse(raw);
  if (!s || !Array.isArray(s.mons) || !Array.isArray(s.team) || !Number.isFinite(s.adv?.runs)
    || !s.mons.every((m: unknown) => m && typeof m === 'object' && 'uid' in m && 'id' in m && 'level' in m && 'xp' in m
      && [m.id, m.level, m.xp].every(Number.isFinite))
    || (s.adv.battle && !Array.isArray(s.adv.battle.enemies))) throw new Error('当前存档结构不支持');
  return s;
}

export class GameAdapter {
  readonly bus = new EventBus<GameEvents>();
  private observer?: MutationObserver;
  private timer?: ReturnType<typeof setInterval>;
  private seen = new WeakSet<Element>();
  private lastSeen = Date.now();
  private lastLog = '';
  private interrupted = false;
  constructor(private doc: Document = document) {}
  auditedExperienceRules() {
    const hashes = [...this.doc.scripts].map(s => /\/bundle\/app\.([a-f0-9]+)\.js(?:[?#]|$)/.exec(s.src)?.[1]).filter(Boolean);
    return hashes.length > 0 && hashes.every(hash => hash!.length >= 10 && xpModel.hash.startsWith(hash!));
  }
  teamRow(uid: string | number) { return [...this.doc.querySelectorAll<HTMLElement>('#team-rail .tr-row[data-uid]')].find(n => n.dataset.uid === String(uid)); }
  monName(uid: string | number, id?: number) { return this.teamRow(uid)?.title.split('—')[0].trim() || `精灵 #${id ?? '?'}`; }
  xpPercent(uid: string | number) { return parseFloat(this.teamRow(uid)?.querySelector<HTMLElement>('.tr-xp i')?.style.width || ''); }
  enemyVisible(uid: string | number, hp: number) {
    const nodes = [...this.doc.querySelectorAll<HTMLElement>('#enemy-slot .enemy[data-uid]')];
    return nodes.length ? nodes.some(n => n.dataset.uid === String(uid)) : hp > 0;
  }
  enemyKo(id: number | undefined, save: GameSave | null) {
    return [...this.doc.querySelectorAll<HTMLElement>('#enemy-slot .enemy.ko')].some(n => save?.adv.battle?.enemies.some(e => String(e.uid) === n.dataset.uid && e.id === id));
  }
  hasAlly(name: string) { return [...this.doc.querySelectorAll<HTMLElement>('#team-rail .tr-row')].some(n => normalize(n.title.split('—')[0]) === normalize(name)); }
  private visibility = () => { if (this.doc.hidden) this.interrupted = true; };
  private sample = () => {
    try {
      const save = parseSave(localStorage.getItem('gachamon-save-v1'));
      if (!save) { this.interrupted = true; this.bus.emit('status', '等待游戏首次保存'); return; }
      const now = Date.now(), gap = this.interrupted || now - this.lastSeen > 15000;
      this.lastSeen = now; this.interrupted = false;
      this.bus.emit('sample', { save, now, gap, visible: !this.doc.hidden });
      this.bus.emit('status', this.doc.hidden ? '页面在后台 · 可能漏采' : save.adv.paused ? '游戏已暂停 · 时长继续累计' : gap ? '采样已恢复 · 存在缺失' : '正在采集');
    } catch (e) { this.interrupted = true; this.bus.emit('status', `读取失败：${(e as Error).message}`); }
  };
  private log() {
    const text = this.doc.querySelector('#battle-log')?.textContent?.trim();
    if (text && text !== '…' && text !== this.lastLog) { this.lastLog = text; this.bus.emit('log', text); }
  }
  private float(node: HTMLElement) {
    if (this.seen.has(node) || !node.closest('#arena-fx')) return;
    this.seen.add(node);
    const match = /^([+−-])(\d[\d\s,.]*)(!)?$/.exec(node.textContent?.trim() || '');
    if (!match) return;
    const value = Number(match[2].replace(/[\s,.]/g, ''));
    if (!(value > 0)) return;
    const x = parseFloat(node.style.left), y = parseFloat(node.style.top);
    const arena = this.doc.querySelector('#arena')?.getBoundingClientRect();
    const near = arena && Number.isFinite(x) && Number.isFinite(y) ? [...this.doc.querySelectorAll<HTMLElement>('#ally-slots .ally[data-uid],#enemy-slot .enemy[data-uid]')].map(n => {
      const r = (n.querySelector('.wrap > img') || n).getBoundingClientRect();
      return { n, distance: Math.hypot(r.left + r.width / 2 - arena.left - x, r.top + r.height / 2 - arena.top - y - 50) };
    }).sort((a, b) => a.distance - b.distance)[0] : null;
    const target = near && near.distance <= 110 ? near.n : null;
    const damage: Damage = { value, healing: match[1] === '+' || node.classList.contains('heal'), status: node.classList.contains('st-float'),
      critical: !!match[3] || node.classList.contains('crit'), side: target ? target.classList.contains('ally') ? 'ally' : 'enemy' : null,
      victim: target ? this.monName(target.dataset.uid!) : null };
    this.bus.emit('damage', damage);
  }
  start() {
    if (this.timer) return;
    this.observer = new MutationObserver(records => {
      for (const r of records) {
        const target = r.target instanceof Element ? r.target : r.target.parentElement;
        if (target?.closest('#battle-log')) this.log();
        for (const n of r.addedNodes) {
          if (!(n instanceof HTMLElement)) continue;
          for (const el of [n, ...n.querySelectorAll<HTMLElement>('.dmg,.defeat-screen,.heal-fx')]) {
            if (el.matches('.dmg')) this.float(el);
            if (el.matches('.defeat-screen') && el.closest('#arena')) this.bus.emit('defeat', /僵局|stalemate|stalled|bloqué/i.test(el.textContent || '') ? '战斗僵局' : '全队倒下');
            if (el.matches('.heal-fx') && el.closest('#arena')) this.bus.emit('center', el.querySelector('.hm-title')?.textContent || '宝可梦中心');
          }
        }
      }
    });
    this.observer.observe(this.doc.body, { childList: true, subtree: true, characterData: true });
    this.doc.addEventListener('visibilitychange', this.visibility);
    this.sample(); this.log(); this.timer = setInterval(this.sample, 1000);
  }
  stop() { clearInterval(this.timer); this.timer = undefined; this.observer?.disconnect(); this.doc.removeEventListener('visibilitychange', this.visibility); this.bus.clear(); }
}
export function normalize(text: string) { return text.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }
