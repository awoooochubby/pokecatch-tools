import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const built = readFileSync(resolve(root, 'dist/pokecatch-tools.user.js'), 'utf8');
if (!built.includes(`@version`) || !new RegExp(`@version\\s+${pkg.version.replaceAll('.', '\\.')}(?:\\s|$)`).test(built)) throw new Error('Build version differs from package.json');
const header = built.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)[0];
const entries = [
  ['pokecatch-tools', 'PokeCatch 游戏助手', 'local.pokecatch.tools'],
  ['pokecatch-stats', 'PokeCatch 经验与整轮日志', 'local.pokecatch.stats'],
  ['pokecatch-enemies', 'PokeCatch 敌情与伤害排行', 'local.pokecatch.enemies'],
];
for (const [stem, name, namespace] of entries) {
  const nextHeader = header.replace(/(@name\s+).*/, `$1${name}`).replace(/(@namespace\s+).*/, `$1${namespace}`).replaceAll('pokecatch-tools.meta.js', `${stem}.meta.js`).replaceAll('pokecatch-tools.user.js', `${stem}.user.js`);
  for (const [suffix, contents] of [['.user.js', built.replace(header, nextHeader)], ['.meta.js', nextHeader + '\n']]) {
    const path = resolve(root, stem + suffix);
    if (process.argv.includes('--check')) { if (readFileSync(path, 'utf8') !== contents) throw new Error(`Stale release artifact: ${stem + suffix}; run npm run build`); }
    else writeFileSync(path, contents);
  }
}
console.log(`${process.argv.includes('--check') ? 'Verified' : 'Generated'} three installation entries and metadata at v${pkg.version}`);
