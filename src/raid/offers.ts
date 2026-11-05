import { sprite, type RaidOffer } from './read';

/** Read both native pickers without selecting/removing an ally. Each picker
 * hides the other slot's pick, so their union (and order constraints) matters. */
export async function collectRaidOffers(doc: Document, region: string, raw: string, active: () => boolean): Promise<RaidOffer[]> {
  if (doc.querySelector('.modal, .evt-pick')) throw new Error('请先关闭游戏弹窗，再读取全部团战队友');
  const save = JSON.parse(raw), bots = save.raids?.bots?.[region] || [];
  const offers = new Map<string, RaidOffer>();
  const lists: string[][] = [];
  for (let slot = 0; slot < 2; slot++) {
    if (!active()) throw new Error('已取消读取队友');
    const button = doc.querySelector<HTMLElement>(`#raid-root [data-raid-slot="${region}|${slot}"]`);
    if (!button) throw new Error('本场团战没有可读取的队友选择入口');
    button.click();
    let dialog: HTMLElement | null = null;
    try {
      const deadline = Date.now() + 10000;
      while (!(dialog = doc.querySelector<HTMLElement>('.raid-dlg'))) {
        if (!active()) throw new Error('已取消读取队友');
        if (Date.now() > deadline) throw new Error('原生团战队友列表读取超时');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const keys: string[] = [];
      for (const row of dialog.querySelectorAll<HTMLElement>('.raid-pick[data-pick]')) {
        const key = row.dataset.pick!;
        if (!/^[\w-]+$/.test(key)) throw new Error('原生队友标识格式变化，请更新适配');
        const name = row.querySelector('.nm b')?.textContent?.trim() || key;
        const native = bots.find((b: any) => b.key === key);
        const mons = [...row.querySelectorAll<HTMLElement>('.rt-mons .rt-mon')].map((el, index) => {
          const display = sprite(el.querySelector('img'));
          const lv = el.querySelector('.rt-lv')?.cloneNode(true) as HTMLElement | undefined;
          lv?.querySelectorAll('s').forEach(s => s.remove());
          const match = /(\d+)\s*$/.exec(lv?.textContent || '');
          if (!match || +match[1] < 1 || +match[1] > 100) throw new Error('无法精确读取队友等级');
          if (native) {
            const mon = native.mons?.[index];
            if (!mon || mon.id !== display.id || Math.min(mon.level, 100) !== +match[1] || !!mon.shiny !== display.shiny) throw new Error('原生 NPC 列表与存档不一致，请重新读取');
            return structuredClone(mon);
          }
          if (!key.startsWith('f-')) throw new Error('无法确认团战队友来源');
          return { uid: `${key}-${index}`, ...display, level: +match[1], xp: 0, bot: true, owner: name };
        });
        if (!mons.length || mons.length > 2 || native && native.mons.length !== mons.length) throw new Error('原生队友精灵数量不完整');
        const offer: RaidOffer = { key, name, friend: !native, mons, before: [] };
        const previous = offers.get(key);
        if (previous && JSON.stringify(previous.mons) !== JSON.stringify(mons)) throw new Error('读取期间队友队伍发生变化，请重试');
        offers.set(key, offer); keys.push(key);
      }
      lists.push(keys);
    } finally {
      // Close only the picker we opened, using native Cancel. Never change picks.
      dialog?.querySelector<HTMLElement>('.dc-x')?.click();
      if (dialog?.isConnected) throw new Error('原生队友弹窗未关闭，请手动关闭后重试');
    }
  }
  if (bots.some((b: any) => !offers.has(b.key))) throw new Error('未完整读取全部 NPC 队友，请重试');
  const picked: string[] = save.raids?.pick?.[region] || [];
  if (picked.some(key => !offers.has(key))) throw new Error('已选队友不在可用列表中，请刷新原生团战配置');
  // Transitive closure preserves native order even when a selected friend is
  // hidden in one picker. Unresolved order is simulated in both directions.
  const edges = new Map([...offers.keys()].map(key => [key, new Set<string>()]));
  for (const list of lists) for (let i = 0; i < list.length; i++) for (const after of list.slice(i + 1)) edges.get(list[i])!.add(after);
  for (const mid of offers.keys()) for (const before of offers.keys()) if (edges.get(before)!.has(mid)) for (const after of edges.get(mid)!) edges.get(before)!.add(after);
  for (const offer of offers.values()) {
    if (edges.get(offer.key)!.has(offer.key)) throw new Error('读取期间好友顺序发生变化，请重新读取');
    offer.before = [...edges.get(offer.key)!].sort();
  }
  if (!active()) throw new Error('已取消读取队友');
  return [...offers.values()].sort((a, b) => a.key.localeCompare(b.key));
}
