import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from 'acorn';
import version from '../src/simulation/version.json' with { type: 'json' };

// Extract only the XP constants and map names from the checksum-pinned engine.
const source = readFileSync('.cache/engine.js', 'utf8');
if (createHash('sha256').update(source).digest('hex') !== version.hash) throw new Error('Engine checksum mismatch');
const expressions = {};
function walk(n) {
  if (!n || typeof n.type !== 'string') return;
  if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' && n.left.object.name === 't'
    && ['POKEDEX', 'BASE_EXP', 'CONFIG', 'UNOWN', 'STORY'].includes(n.left.property.name) && !expressions[n.left.property.name]) expressions[n.left.property.name] = source.slice(n.right.start, n.right.end);
  for (const value of Object.values(n)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
}
walk(parse(source, { ecmaVersion: 'latest' }));
const t = {};
for (const key of ['POKEDEX', 'BASE_EXP', 'CONFIG', 'UNOWN', 'STORY']) new Function('t', `t.${key}=(${expressions[key]})`)(t);
const c = t.CONFIG, story = t.STORY;
const model = { hash: version.hash, scale: c.XP_SCALE, growthFrom: c.XP_GROWTH_FROM, growthExtra: c.XP_GROWTH_EXTRA,
  timeRatio: c.CHAPTER_TIME_RATIO, rankMax: c.UNDERGROUND.RANK_MAX, rankXp: c.UNDERGROUND.RANK_XP,
  regions: story.REGIONS.filter(r => r.key).map(r => ({ key: r.key, name: r.name, open: !!r.open, base: r.base || 0, step: r.ace[1], xp: c.REGION_XP?.[r.key] ?? r.xp ?? 1 })),
  chapters: story.CHAPTERS.map((ch, i) => ({ name: ch.name, region: story.regionOf(i).key })) };
const json = JSON.stringify(model, null, 2) + '\n', path = 'src/data/experience.json';
if (process.argv.includes('--check')) { if (readFileSync(path, 'utf8') !== json) throw new Error('Experience metadata is stale'); }
else writeFileSync(path, json);
console.log('Verified XP metadata ' + version.hash.slice(0, 10));
