export const number = (n: number) => Math.round(Number.isFinite(n) ? n : 0).toLocaleString();
export function duration(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}小时${Math.floor(s % 3600 / 60)}分` : `${Math.floor(s / 60)}分${s % 60}秒`;
}
export const time = (n: number) => new Date(n).toLocaleTimeString();
