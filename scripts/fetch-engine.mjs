import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import version from '../src/simulation/version.json' with { type: 'json' };
const source = execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '45', version.url], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
if (createHash('sha256').update(source).digest('hex') !== version.hash) throw new Error('Engine checksum mismatch');
mkdirSync('.cache', { recursive: true });
writeFileSync('.cache/engine.js', source);
console.log('Verified public engine fixture ' + version.hash.slice(0, 10));
