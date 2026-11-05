import { createApp } from 'vue';
import App from './App.vue';
import css from './style.css?inline';
import { createRuntime } from './core/runtime';
import { selectTargetKey } from './ui/select-target';

declare global { interface Window { __pcStatsDispose?: () => void; __pcToolsDispose?: () => void } }
if (window.top === window.self && !document.getElementById('pc-tools')) {
  window.__pcStatsDispose?.();
  const host = document.createElement('div'); host.id = 'pc-tools';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = css;
  const mount = document.createElement('div'), overlays = document.createElement('div'); overlays.className = 'pc-overlays'; shadow.append(style, mount, overlays); document.body.append(host);
  const runtime = createRuntime();
  const app = createApp(App, { runtime, styleTarget: shadow }); app.provide(selectTargetKey, overlays); app.mount(mount);
  window.__pcToolsDispose = () => { runtime.dispose(); app.unmount(); host.remove(); delete window.__pcToolsDispose; };
}
