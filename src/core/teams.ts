export function validateTeam(save: any, uids: string[], size = 6) {
  if (!uids.length || uids.length > size || new Set(uids).size !== uids.length) throw new Error(`队伍需要 1–${size} 只不同的精灵`);
  const beings = new Set<string>();
  for (const uid of uids) {
    const m = save.mons.find((m: any) => String(m.uid) === uid);
    if (!m) throw new Error('预设中的精灵已不在 BOX，请重新选择队伍');
    const key = `${m.id}:${!!m.shiny}`;
    if (beings.has(key)) throw new Error('同种同色精灵不能同时加入队伍');
    beings.add(key);
  }
}
