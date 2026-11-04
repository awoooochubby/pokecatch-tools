import type { Destination } from './types';

// Game modules are private. Use the same native buttons as manual play, without
// patching the game bundle, timers, save data, RNG or team selection.
export class HuntNavigation {
  constructor(private doc: Document = document) {}
  blocked() { return !!this.doc.querySelector('.modal, .title-screen, .tab-modal'); }
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
