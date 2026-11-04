import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import monkey from 'vite-plugin-monkey';
import pkg from './package.json';

export default defineConfig({
  plugins: [vue(), monkey({
    entry: 'src/main.ts',
    userscript: {
      name: 'PokeCatch 游戏助手', namespace: 'local.pokecatch.tools', version: pkg.version,
      description: '经验效率、敌情、战斗回顾与 Box 对策模拟，统一的只读游戏助手',
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
