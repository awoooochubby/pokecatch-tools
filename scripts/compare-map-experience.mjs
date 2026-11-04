import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
await build({entryPoints:['scripts/compare-map-experience.ts'],outfile:'.cache/map-experience.mjs',bundle:true,platform:'node',format:'esm',target:'es2022'});
await import(pathToFileURL(process.cwd()+'/.cache/map-experience.mjs').href);
