import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import monkey from 'vite-plugin-monkey';
import pkg from './package.json';

export default defineConfig({
  plugins: [vue(), monkey({
    entry: 'src/main.ts',
    userscript: {
      name: 'PokeCatch 游戏助手', namespace: 'local.pokecatch.tools', version: pkg.version,
      description: '可缩放分析台、经验与战斗报告、图鉴捕捉队列、团战配队比较及云保存确认',
      match: ['https://pokecatch-online.netlify.app/*', 'https://pokecatch-online.pages.dev/*'],
      noframes: true, grant: 'none', 'run-at': 'document-idle',
      updateURL: 'https://raw.githubusercontent.com/awoooochubby/pokecatch-tools/main/pokecatch-tools.meta.js',
      downloadURL: 'https://raw.githubusercontent.com/awoooochubby/pokecatch-tools/main/pokecatch-tools.user.js',
    },
    build: { fileName: 'pokecatch-tools.user.js' },
  })],
  build: { target: 'es2022', minify: 'esbuild' },
  test: { include: ['tests/**/*.test.ts'] },
});
