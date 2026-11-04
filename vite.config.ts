import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import monkey from 'vite-plugin-monkey';
import pkg from './package.json';

export default defineConfig({
  plugins: [vue(), monkey({
    entry: 'src/main.ts',
    userscript: {
      name: 'PokeCatch 游戏助手', namespace: 'local.pokecatch.tools', version: pkg.version,
      description: '经验效率、Box 对策、神兽挂机追踪与团体战胜率预测，支持天气稀有怪插队捕捉',
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
