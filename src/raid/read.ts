import type { RaidAlly, RaidInput } from './types';
const regions = new Set(['kanto', 'johto', 'hoenn', 'sinnoh']);
export const raidDate = (now: number) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
function sprite(el: Element | null) {
  const path = el?.getAttribute('src') || '';
  const match = /\/pokemon\/(?:art\/)?(shiny\/)?(?:still\/)?(\d+)\.(?:png|gif)(?:[?#]|$)/.exec(path);
  if (!match) throw new Error('团体战精灵图片格式发生变化，请更新适配');
  return { id: +match[2], shiny: !!match[1] };
}
export function readRaids(doc: Document, raw: string, now: number): RaidInput[] {
  const save = JSON.parse(raw), date = raidDate(now), current = save.adv?.event;
  if (current?.raid) {
    if (current.date !== date) throw new Error('当前团体战已跨日，请先在游戏里重新进入');
    const mine = save.eventTeams?.[`raid:${current.reg}`] || [], allies = save.raids?.allies;
    if (!mine.length || !Array.isArray(allies) || !allies.length) throw new Error('当前团体战队伍信息不完整');
    const boss = save.adv.nodes?.find((n: any) => n.raid && n.type === 'static');
    if (!boss || boss.id !== current.id) throw new Error('当前团体战首领节点不完整');
    return [{ region: current.reg, boss: current.id, date, mine: [...mine], allies: structuredClone(allies), weather: boss.weather || null, source: 'active' }];
  }
  const inputs: RaidInput[] = [];
  for (const card of doc.querySelectorAll<HTMLElement>('#raid-root .rc-card[data-rc]')) {
    const region = card.dataset.rc!;
    if (!regions.has(region) || card.classList.contains('done')) continue;
    const mine = save.eventTeams?.[`raid:${region}`] || [];
    if (!mine.length) continue;
    const slots = [...card.querySelectorAll<HTMLElement>('[data-raid-slot]')];
    if (slots.length !== 2 || slots.some(slot => slot.classList.contains('free'))) continue;
    const picks = save.raids?.pick?.[region] || [];
    if (picks.length !== 2 || picks.some((key: unknown) => typeof key !== 'string' || !/^[\w-]+$/.test(key))) throw new Error('团体战队友选择尚未保存，请稍后重新读取');
    if (picks.every((key: string) => key.startsWith('f-'))) throw new Error('选择两名好友时，需要先进入团体战并等待保存，再读取实际出场顺序；预测仍从入口满血开始');
    const allies: RaidAlly[] = [];
    for (const [i, slot] of slots.entries()) {
      if (slot.dataset.raidSlot !== `${region}|${i}`) throw new Error('团体战队友顺序无法确认');
      const bot = save.raids?.bots?.[region]?.find((bot: any) => bot.key === picks[i]);
      const cards = [...slot.querySelectorAll<HTMLElement>('.rc-mon:not(.free)')];
      if (!cards.length || cards.length > 2) throw new Error('团体战队友精灵信息不完整');
      for (const [j, mon] of cards.entries()) {
        const display = sprite(mon.querySelector('img')), match = /(?:·|・).*?(\d+)\s*$/.exec(mon.title);
        if (!match || +match[1] < 1 || +match[1] > 100) throw new Error('无法精确读取队友精灵等级');
        const level = +match[1];
        if (bot) {
          const original = bot.mons?.[j];
          if (!original || original.id !== display.id || Math.min(original.level, 100) !== level || !!original.shiny !== display.shiny) throw new Error('团体战界面与存档不一致，请重新读取');
          allies.push(structuredClone(original));
        } else {
          // The audited native friend adapter deliberately uses id/level/shiny,
          // bot=true, and no rank or NPC stat multiplier (Raids.ua).
          if (!picks[i].startsWith('f-')) throw new Error('找不到已选择的 NPC 队友，请重新读取');
          allies.push({ ...display, uid: `${picks[i]}-${j}`, level, xp: 0, bot: true, owner: slot.title });
        }
      }
    }
    // Native prepare() filters the offer list, rather than following slot order:
    // friends first, then NPCs in their saved generation order. This affects
    // counter selection and ties, so never use the visual slot order here.
    const bots = save.raids?.bots?.[region] || [];
    const order = (mon: RaidAlly) => {
      const botIndex = bots.findIndex((bot: any) => bot.mons?.some((m: any) => m.uid === mon.uid));
      return botIndex < 0 ? -1 : botIndex;
    };
    allies.sort((a, b) => order(a) - order(b));
    inputs.push({ region, boss: sprite(card.querySelector('.boss img')).id, date, mine: [...mine], allies,
      weather: card.querySelector<HTMLElement>('.mp-chips [data-cond]')?.dataset.cond || null, source: 'configured' });
  }
  if (!inputs.length) throw new Error('请先在游戏的异色团体战页面选好自己的精灵和两名队友，再读取预测');
  return inputs;
}
