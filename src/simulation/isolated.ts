import { extractProgram, verifySource, ENGINE_TIMER, ENGINE_DATA_NAMES } from './program';

// Dynamic vendor objects stay inside the disposable worker / engine tests.
export type Vendor = Record<string, any>;
export async function isolatedEngine(source: string, now: number, random: () => number, record: (event: Vendor) => Vendor = event => event, extras: readonly string[] = []) {
  await verifySource(source);
  const program = extractProgram(source, extras), math = Object.create(Math);
  math.random = random;
  let time = now;
  const t: Vendor = { Clock: { now: () => time }, addEventListener() {}, dispatchEvent() {}, __record: record };
  const evaluate = (code: string) => new Function(program.root, 'e', ENGINE_TIMER, 'Math', 'localStorage', 'fetch', 'XMLHttpRequest', 'WebSocket', code)(
    t, (text: string) => text, () => 0, math, undefined, undefined, undefined, undefined);
  for (const name of ENGINE_DATA_NAMES) {
    evaluate(`${program.root}.${name}=(${program.expressions[name]});`);
  }
  for (const factory of program.factories) evaluate(factory);
  return { t, setTime(value: number) { time = value; } };
}
