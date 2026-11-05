import type { Destination } from './types';
import { dex } from '../core/pokemon';

// Game modules are private. Use the same native buttons as manual play, without
// patching the game bundle, timers, save data, RNG or team selection.
export class HuntNavigation {
  constructor(private doc: Document = document) {}
  blocked() { return !!this.doc.querySelector('.modal, .title-screen, .tab-modal, #evt-pick.open'); }
  battleVisible() { return !!this.doc.querySelector('#enemy-slot .enemy:not(.ko), .capture-sequence'); }
  showAdventure() {
    if (!this.doc.querySelector('#screen-adventure.active') && !this.blocked()) this.click('#tabs [data-screen="adventure"]');
  }
  eatBerry(key: string) {
    if (!/^[a-z-]+-berry$/.test(key) || this.blocked() || this.doc.hidden) return false;
    this.showAdventure();
    const button = this.doc.querySelector<HTMLButtonElement>(`#bag-panel .bag-cell.berry[data-k="${key}"]`);
    if (!button || button.disabled) return false;
    button.click(); return true;
  }
  dismissCaptureNotice() {
    // Automatic capture cards have no close/nav controls and one harmless result
    // acknowledgement. A manually opened dex/mon card is left untouched.
    const modal = this.doc.querySelector<HTMLElement>('#modal-root > .modal.dexcard-modal');
    if (!modal || modal.className.trim() !== 'modal dexcard-modal' || !modal.querySelector('.dexcard .dc-new')
      || modal.querySelector('.dc-x, .dc-nav, input, select')) return false;
    const buttons = modal.querySelectorAll<HTMLButtonElement>(':scope > .modal-actions > button');
    if (buttons.length !== 1 || !buttons[0].classList.contains('gold') || buttons[0].disabled) return false;
    buttons[0].click(); return true;
  }
  private click(selector: string) {
    const el = this.doc.querySelector<HTMLButtonElement>(selector);
    if (!el || el.disabled || el.classList.contains('locked')) throw new Error('游戏地图入口不可用，已暂停自动切图');
    el.click();
  }
  private raw() { return JSON.parse(localStorage.getItem('gachamon-save-v1') || 'null'); }
  private pointerClick(el: HTMLElement) {
    const w = this.doc.defaultView!, r = el.getBoundingClientRect();
    for (const type of ['pointerdown', 'pointerup']) el.dispatchEvent(new w.PointerEvent(type, { bubbles: true, pointerId: 91, pointerType: 'mouse', button: 0, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
  }
  applyAdventureTeam(team: string[]) {
    const s = this.raw(), same = (ts: unknown[]) => JSON.stringify(ts.map(String)) === JSON.stringify(team);
    if (same(s.team)) return;
    const index = (s.teamSets?.list || []).findIndex((ts: string[] | null) => ts && same(ts));
    if (index < 0) throw new Error('这套冒险队已不在游戏的 5 个预设中，请先保存该队再绑定目标');
    this.click('#tabs [data-screen="team"]');
    this.click(`#team-sets [data-set="${index}"]`);
    if (!same(this.raw().team)) throw new Error('游戏未能完整切换预设队伍，请检查地区限制');
    this.showAdventure();
  }
  async applyEventTeam(key: string, team: string[], destination: Destination, active: () => boolean) {
    const same = () => JSON.stringify((this.raw().eventTeams?.[key] || []).map(String)) === JSON.stringify(team);
    if (same()) return;
    if (key.startsWith('raid:')) { await this.openRaids(active); this.click(`[data-raid-edit="${destination.raid}"]`); }
    else { this.openMap(destination.region); this.click(`#map-root .mp-row[data-ch="Z${destination.zone}"]`); this.click(`[data-lz-team="${destination.zone}"]`); }
    try {
      if (!this.doc.querySelector('#evt-pick.open')) throw new Error('游戏没有打开独立队伍配置');
      const search = this.doc.querySelector<HTMLInputElement>('#evt-search')!;
      const eff = this.doc.querySelector<HTMLElement>('#evt-eff.on'); eff?.click();
      const clearSearch = () => { search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); };
      clearSearch();
      // Configure through the native event selector. Independent teams are
      // committed on entry/heal by the game, never by writing its save.
      for (const uid of [...(this.raw().eventTeams?.[key] || [])]) {
        if (!active()) throw new Error('操作已取消');
        const cell = this.doc.querySelector<HTMLElement>(`#evt-team .slot[data-uid="${CSS.escape(String(uid))}"]`);
        if (!cell) throw new Error('无法读取独立队伍成员');
        this.pointerClick(cell);
      }
      for (const uid of team) {
        if (!active()) throw new Error('操作已取消');
        const mon = this.raw().mons.find((m: any) => String(m.uid) === uid);
        if (!mon) throw new Error('预设成员已不在 BOX');
        let cell: HTMLElement | null = null;
        for (const name of [dex[mon.id]?.fr, dex[mon.id]?.name, '']) {
          search.value = name || ''; search.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(resolve => setTimeout(resolve, 50));
          if (!active()) throw new Error('操作已取消');
          cell = this.doc.querySelector<HTMLElement>(`#evt-pc .pc-cell[data-uid="${CSS.escape(uid)}"]`);
          if (cell) break;
        }
        if (!cell || cell.classList.contains('evt-lock')) throw new Error('原生队伍选择器找不到可用成员，请检查借出／地区限制');
        this.pointerClick(cell);
      }
      if (!same()) throw new Error('原生独立队伍与预设不一致，已暂停');
    } finally { this.doc.querySelector<HTMLElement>('#evt-pick.open [data-evt-close]')?.click(); }
  }
  async openRaids(active: () => boolean = () => true) {
    if (this.blocked()) throw new Error('请先关闭游戏弹窗');
    if (!this.doc.querySelector('#screen-raid.active')) this.click('#tabs [data-screen="raid"]');
    const deadline = Date.now() + 15000;
    while (active()) {
      const draw = this.doc.querySelector<HTMLElement>('#raid-root [data-raid-draw]');
      if (draw) draw.click();
      this.doc.querySelector<HTMLElement>('#raid-root [data-raid-page="chroma"]')?.click();
      if (this.doc.querySelector('#raid-root .rc-card[data-rc]')) return;
      if (Date.now() >= deadline) throw new Error('没有读取到今日团战，请先在游戏中登录并解锁团战');
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('操作已取消');
  }
  async pickRaidAllies(region: string, picks: string[], active: () => boolean) {
    await this.openRaids(active);
    if (JSON.stringify(this.raw().raids?.pick?.[region] || []) !== JSON.stringify(picks)) {
      // A selected group is hidden from the other slot. Clear the old choices
      // first so swapping slots cannot look like a missing NPC.
      for (let i = 0; i < 2; i++) {
        if (!active()) throw new Error('操作已取消');
        if (!this.raw().raids?.pick?.[region]?.[i]) continue;
        this.click(`[data-raid-slot="${region}|${i}"]`);
        await new Promise(resolve => setTimeout(resolve, 30));
        if (!active()) { this.doc.querySelector<HTMLElement>('.raid-dlg .dc-x')?.click(); throw new Error('操作已取消'); }
        this.click('.raid-dlg > .modal-actions > button.ghost');
        await new Promise(resolve => setTimeout(resolve, 30));
      }
    }
    for (let i = 0; i < 2; i++) {
      if (!active()) throw new Error('操作已取消');
      if (this.raw().raids?.pick?.[region]?.[i] === picks[i]) continue;
      this.click(`[data-raid-slot="${region}|${i}"]`);
      await new Promise(resolve => setTimeout(resolve, 30));
      if (!active()) { this.doc.querySelector<HTMLElement>('.raid-dlg .dc-x')?.click(); throw new Error('操作已取消'); }
      const button = this.doc.querySelector<HTMLElement>(`.raid-dlg [data-pick="${CSS.escape(picks[i])}"]`);
      if (!button) { this.doc.querySelector<HTMLElement>('.raid-dlg .dc-x')?.click(); throw new Error('团战队友已刷新，请重新规划'); }
      button.click(); await new Promise(resolve => setTimeout(resolve, 30));
    }
  }
  enterRaid(region: string) { this.click(`[data-raid-go="${region}"]`); }
  refreshPositions() {
    if (this.blocked()) return false;
    // Rendering the native map updates all unlocked roaming groups at once.
    if (!this.doc.querySelector('#screen-adventure.active')) this.click('#tabs [data-screen="adventure"]');
    this.click('#chapter-btn');
    this.click('#tabs [data-screen="adventure"]');
    return true;
  }
  private openMap(region: string) {
    if (!this.doc.querySelector('#screen-adventure.active')) this.click('#tabs [data-screen="adventure"]');
    this.click('#chapter-btn');
    this.click(`#map-root .rg.open[data-rg="${region}"]`);
  }
  private go(destination: Destination) {
    this.openMap(destination.region);
    const key = destination.zone == null ? String(destination.chapter) : `Z${destination.zone}`;
    this.click(`#map-root .mp-row[data-ch="${key}"]`);
    this.click(destination.zone == null ? `#map-root .mp-go[data-go="${destination.chapter}"]` : `#map-root .mp-go[data-zone="${destination.zone}"]`);
  }
  travel(destination: Destination, reenter: boolean) {
    if (this.blocked()) throw new Error('请先处理游戏弹窗，再继续追踪');
    if (reenter) {
      this.openMap(destination.region);
      const unlocked = JSON.parse(localStorage.getItem('gachamon-save-v1') || 'null')?.adv?.unlocked;
      const alternate = [...this.doc.querySelectorAll<HTMLButtonElement>('#map-root .mp-row[data-ch]')]
        .find(el => /^\d+$/.test(el.dataset.ch || '') && +el.dataset.ch! !== destination.chapter && +el.dataset.ch! <= unlocked && !el.disabled);
      if (!alternate) throw new Error('没有可用的中转章节，暂不能重新进入当前地图');
      alternate.click();
      this.click(`#map-root .mp-go[data-go="${alternate.dataset.ch}"]`);
    }
    this.go(destination);
  }
}
