import { HuntNavigation } from '../tracker/navigation';
import { readEggs, type Egg } from './eggs';

const wait = () => new Promise(resolve => setTimeout(resolve, 100));
/** Only native mature-egg buttons; no writes to save, RNG or hatch clocks. */
export class HatcheryNavigation {
  constructor(private doc: Document = document, private storage: Storage = localStorage) {}
  private raw() { const raw = this.storage.getItem('gachamon-save-v1'); if (!raw) throw new Error('尚无游戏存档'); return raw; }
  dismissCaptureNotice() { return new HuntNavigation(this.doc).dismissCaptureNotice(); }
  safe() {
    const s = JSON.parse(this.raw());
    return !this.doc.hidden && !s.adv?.battle?.enemies?.some((m: any) => m.hp > 0) && !s.adv?.pending
      && !this.doc.querySelector('.modal, .rc-fx, .capture-sequence, .title-screen, .tab-modal, #evt-pick.open, #enemy-slot .enemy:not(.ko)');
  }
  async collect(egg: Egg, active: () => boolean): Promise<void> {
    if (!active()) throw new Error('收蛋已停止');
    const time = () => Math.max(Date.now(), Number(this.storage.getItem('pokecatch.clock')) || 0);
    const live = readEggs(this.raw(), time()).find(e => e.uid === egg.uid);
    if (!live?.ready) throw new Error('该蛋尚未成熟或已被领取，请刷新');
    const button = [...this.doc.querySelectorAll<HTMLButtonElement>('#pen-eggs .pen-egg.ready[data-egg]')].find(el => el.dataset.egg === egg.uid);
    if (!button || button.disabled || button.classList.contains('hatching')) throw new Error('游戏未显示可领取的成熟蛋，请稍后重试');
    const before = new Set(JSON.parse(this.raw()).mons.map((m: any) => String(m.uid)));
    button.click();
    const deadline = Date.now() + 45000;
    let removed = false, clearSince = 0;
    while (Date.now() < deadline) {
      if (!active()) throw new Error('收蛋已停止；当前原生结果请手动确认');
      const s = JSON.parse(this.raw());
      removed = !s.pension?.eggs?.some((e: any) => e.uid === egg.uid);
      if (!removed) {
        // Native hatchEgg is synchronous. A remaining egg after its UI handler
        // ran signals e.g. a full PC. Do not retry continuously or drop the egg.
        throw new Error('游戏未领取这枚蛋：请检查 PC 空位和原生提示；自动收蛋已暂停');
      }
      const animation = this.doc.querySelector<HTMLElement>('.lk-hatch');
      if (animation) {
        const tap = animation.querySelector<HTMLElement>('.rc-tap');
        // Native st() exposes this only AFTER the full hatch animation/text.
        if (tap && tap.style.opacity !== '0' && Number(this.doc.defaultView!.getComputedStyle(tap).opacity) > .8) {
          animation.dispatchEvent(new this.doc.defaultView!.PointerEvent('pointerdown', { bubbles: true, pointerId: 94, pointerType: 'mouse', button: 0 }));
        }
        clearSince = 0;
      } else {
        const modal = this.doc.querySelector<HTMLElement>('#modal-root > .modal.dexcard-modal');
        if (modal) {
          const actions = modal.querySelectorAll<HTMLButtonElement>(':scope > .modal-actions > button');
          const newMons = s.mons.filter((m: any) => !before.has(String(m.uid)));
          const matching = [...modal.querySelectorAll<HTMLImageElement>('img')].some(img => newMons.some((m: any) => new RegExp(`/pokemon/(?:art/)?(?:shiny/)?(?:still/)?${m.id}\\.(?:png|gif)`).test(img.getAttribute('src') || '')));
          if (modal.className.trim() !== 'modal dexcard-modal' || !matching || modal.querySelector('.dc-x, .dc-nav, input, select') || actions.length !== 1 || !actions[0].classList.contains('gold') || actions[0].disabled) throw new Error('收蛋结果需要手动确认，自动领取已暂停');
          actions[0].click(); clearSince = 0;
        } else if (this.doc.querySelector('.modal, .rc-fx')) throw new Error('游戏打开了其他弹窗，请手动处理后再收蛋');
        else {
          clearSince ||= Date.now();
          if (Date.now() - clearSince >= 400) return;
        }
      }
      await wait();
    }
    throw new Error('收蛋结果确认超时；请查看原生页面后重试');
  }
  async visit(active: () => boolean) {
    if (!this.safe()) throw new Error('等待当前战斗或游戏弹窗结束后收蛋');
    const previous = this.doc.querySelector<HTMLElement>('#tabs [data-screen].on, #tabs [data-screen].active')?.dataset.screen
      || this.doc.querySelector<HTMLElement>('[id^="screen-"].active')?.id.replace('screen-', '');
    if (!this.doc.querySelector('#screen-pension.active')) {
      const nav = this.doc.querySelector<HTMLButtonElement>('#tabs [data-screen="pension"]');
      if (!nav || nav.disabled || nav.classList.contains('locked')) throw new Error('请先在游戏中解锁培育屋');
      nav.click();
    }
    const deadline = Date.now() + 10000;
    while (!this.doc.querySelector('#screen-pension.active #pen-eggs')) {
      if (!active()) throw new Error('收蛋已停止');
      if (Date.now() > deadline) throw new Error('培育屋读取超时');
      await wait();
    }
    this.doc.querySelector<HTMLElement>('#pen-tabs [data-pen-tab="egg"]')?.click();
    return () => {
      // Restore only if our page is still active and there are no result dialogs.
      if (previous && previous !== 'pension' && this.doc.querySelector('#screen-pension.active') && !this.doc.querySelector('.modal, .rc-fx')) this.doc.querySelector<HTMLElement>(`#tabs [data-screen="${CSS.escape(previous)}"]`)?.click();
    };
  }
}
