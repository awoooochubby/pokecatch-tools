import { createApp } from 'vue';
import App from './App.vue';
import css from './style.css?inline';
import { createRuntime } from './core/runtime';

declare global { interface Window { __pcStatsDispose?: () => void; __pcToolsDispose?: () => void } }
if (window.top === window.self && !document.getElementById('pc-tools')) {
  window.__pcStatsDispose?.();
  const host = document.createElement('div'); host.id = 'pc-tools';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = css;
  const mount = document.createElement('div'); shadow.append(style, mount); document.body.append(host);
  const runtime = createRuntime();
  const app = createApp(App, { runtime, styleTarget: shadow }); app.mount(mount);
  window.__pcToolsDispose = () => { runtime.dispose(); app.unmount(); host.remove(); delete window.__pcToolsDispose; };
}
