import { extractProgram, ENGINE_TIMER } from '../src/simulation/program';
// Test/analysis harness: original factories, no combat or reward substitutions.
export function referenceEngine(source: string, now = Date.UTC(2026, 10, 4, 12), seed = 123456789, extras: readonly string[] = []) {
  const program = extractProgram(source, extras);
  const math = Object.create(Math);
  math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const t: Record<string, any> = { Clock: { now: () => now }, addEventListener() {}, dispatchEvent() {}, __record: (e: unknown) => e };
  const evaluate = (code: string) => new Function(program.root, 'e', ENGINE_TIMER, 'Math', 'localStorage', 'fetch', code)(t, (s: string) => s, () => 0, math, undefined, undefined);
  for (const [key, value] of Object.entries(program.expressions)) evaluate(`${program.root}.${key}=(${value});`);
  for (const factory of program.factories) evaluate(factory);
  for (const r of t.STORY.REGIONS) if (r.key) r.open = true;
  return t;
}
