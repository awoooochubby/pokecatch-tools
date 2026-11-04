import type { Catalog, Options } from './types';
export const SAMPLE_BUDGET = 150000;
export function estimateWork(catalog: Catalog, options: Options, customCount = 0) {
  const n = options.candidateUids.length;
  let groups: number;
  if (options.mode === 'order') {
    const orders = n <= 4 ? Array.from({ length: n }, (_, i) => i + 1).reduce((a, b) => a * b, 1) : 1 + n * (n - 1) / 2;
    groups = n ? orders * 2 : 0;
  } else if (options.mode === 'route') groups = n ? 1 : 0;
  else {
    const levels = options.candidateUids.reduce((sum, uid) => {
      const m = catalog.candidates.find(m => m.uid === uid);
      return sum + (m ? options.scanLevels ? Math.max(0, m.cap - m.level + 1) : 1 : 0);
    }, 0);
    groups = levels * (options.targetKeys.length + customCount);
  }
  return { groups, samples: groups * options.trials, overBudget: groups * options.trials > SAMPLE_BUDGET };
}
export function parseCustomTargets(text: string) {
  return text.trim() ? text.split(/[,，;；\n]+/).filter(s => s.trim()).map(text => {
    const m = /^\s*(\d+)\s*[:：@]\s*(\d+)\s*$/.exec(text);
    if (!m) throw new Error('指定目标请填“图鉴编号:等级”，例如 478:52；多个用逗号分隔');
    return { id: Number(m[1]), level: Number(m[2]) };
  }) : [];
}
