import { parse } from 'acorn';
import version from './version.json' with { type: 'json' };
export const ENGINE_HASH = version.hash;
export const ENGINE_URL = version.url;
export const BOOT_URL = version.boot;
export const ENGINE_TIMER = version.timer;
// Keep all worker bootstraps on the same audited data dependency list.
export const ENGINE_DATA_NAMES = ['POKEDEX', 'MOVES', 'TYPE_CHART', 'CONFIG', 'EVOLUTIONS', 'TYPES', 'BASE_EXP', 'FORMS', 'UNOWN', 'STORY', 'LEAGUE_TEAMS', 'STATUS', 'ENCOUNTERS', 'HABITATS', 'SPECIALS', 'SCENES', 'DAYTIME', 'WEATHER'] as const;
export async function verifySource(source: string) {
  const bytes = new TextEncoder().encode(source);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
  if (hash !== ENGINE_HASH) throw new Error('游戏引擎版本未经验证，已停止计算。请更新助手适配，不能沿用旧规则。');
}

// This is a version-pinned adapter, not a general interpreter for unknown code.
// Game code is evaluated only in a disposable Worker, never in the game window.
export function extractProgram(source: string, extras: readonly string[] = []): { root: string; expressions: Record<string, string>; factories: string[] } {
  // Acorn's recursive AST intentionally crosses the dynamic vendor-code boundary.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ast = parse(source, { ecmaVersion: 'latest' }) as any;
  const names = new Set<string>(ENGINE_DATA_NAMES);
  const expressions: Record<string, string> = {}, factories: Record<string, string> = {};
  let root = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function walk(n: any, ancestors: any[]) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'AssignmentExpression' && n.operator === '=' && n.left.type === 'MemberExpression' && !n.left.computed && n.left.object.type === 'Identifier') {
      const name = n.left.property.name;
      if (!root && name === 'POKEDEX' && n.right.type === 'ArrayExpression') root = n.left.object.name;
      if (n.left.object.name === root) {
        if (extras.includes(name) && !factories[name]) {
          if (n.right.type === 'CallExpression') factories[name] = source.slice(n.start, n.end) + ';';
          else if (n.right.type === 'ObjectExpression') {
            const fn = [...ancestors].reverse().find(a => a.type === 'FunctionExpression');
            if (fn) factories[name] = '(' + source.slice(fn.start, fn.end) + ')();';
          }
        }
        if (names.has(name) && !expressions[name]) expressions[name] = source.slice(n.right.start, n.right.end);
        if (['Game', 'Adventure'].includes(name) && n.right.type === 'ObjectExpression' && !factories[name]) {
          const fn = [...ancestors].reverse().find(a => a.type === 'FunctionExpression');
          if (fn) {
            let text = source.slice(fn.start, fn.end);
            if (name === 'Adventure') {
              const edits: Array<{ start: number; end: number; text: string }> = [{ start: n.right.start + 1, end: n.right.start + 1, text: `__choose:${version.helpers.choose},__damage:${version.helpers.damage},__finisher:${version.helpers.finisher},` }];
              function recordEvents(node: any) {
                if (!node || typeof node.type !== 'string') return;
                if (node.type === 'ObjectExpression' && node.properties.some((p: any) => p.key?.name === 'hp') &&
                  (node.properties.some((p: any) => p.type === 'SpreadElement' && version.eventSpreads.includes(p.argument.name)) ||
                   node.properties.some((p: any) => p.key?.name === 'type' && ['attack', 'status'].includes(p.value?.value)))) {
                  edits.push({ start: node.start, end: node.end, text: `${root}.__record(${source.slice(node.start, node.end)})` });
                  return;
                }
                for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(recordEvents); else if (value && typeof value === 'object') recordEvents(value);
              }
              recordEvents(fn.body);
              for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start - fn.start) + edit.text + text.slice(edit.end - fn.start);
              if (!Object.values(version.helpers).every(name => text.includes('function ' + name + '('))) throw new Error('战斗接口不匹配');
            }
            factories[name] = '(' + text + ')();';
          }
        }
      }
    }
    for (const value of Object.values(n)) {
      if (Array.isArray(value)) for (const child of value) walk(child, [...ancestors, n]);
      else if (value && typeof value === 'object') walk(value, [...ancestors, n]);
    }
  }
  walk(ast, []);
  for (const name of names) if (!expressions[name]) throw new Error('缺少引擎数据：' + name);
  if (!root || !factories.Game || !factories.Adventure) throw new Error('无法定位独立战斗引擎');
  for (const name of extras) if (!factories[name]) throw new Error('缺少追踪接口：' + name);
  return { root, expressions, factories: [factories.Game, factories.Adventure, ...extras.map(name => factories[name])] };
}
