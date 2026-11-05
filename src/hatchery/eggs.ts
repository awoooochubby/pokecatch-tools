export interface Egg { uid: string; id: number; shiny: boolean | null; laidAt: number; hatchAt: number; ready: boolean; remaining: number; reg?: string; }
export function readEggs(raw: string, now: number): Egg[] {
  const eggs = JSON.parse(raw).pension?.eggs || [];
  if (!Array.isArray(eggs)) throw new Error('当前蛋数据格式不支持');
  const result = eggs.map((e: any): Egg => {
    if (typeof e.uid !== 'string' || !e.uid || (!Number.isInteger(e.id) || e.id < 1) || !Number.isFinite(e.laidAt) || !Number.isFinite(e.hatchAt) || e.hatchAt < e.laidAt) throw new Error('当前蛋数据不完整，暂不自动领取');
    return { uid: e.uid, id: e.id, shiny: typeof e.shiny === 'boolean' ? e.shiny : null, laidAt: e.laidAt, hatchAt: e.hatchAt,
      ready: now >= e.hatchAt, remaining: Math.max(0, e.hatchAt - now), reg: e.reg };
  });
  if (new Set(result.map(e => e.uid)).size !== result.length) throw new Error('蛋的标识重复，暂不自动领取');
  return result;
}
