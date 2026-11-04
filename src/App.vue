<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useDraggable, useWindowSize } from '@vueuse/core';
import { NConfigProvider, NButton, NTag, NTabs, NTabPane, darkTheme, zhCN } from 'naive-ui';
import type { Runtime } from './core/runtime';
import Overview from './components/Overview.vue';
import Experience from './components/Experience.vue';
import Enemies from './components/Enemies.vue';
import Review from './components/Review.vue';
import Settings from './components/Settings.vue';
import Counters from './components/Counters.vue';
import FarmingWindow from './components/FarmingWindow.vue';
import pkg from '../package.json';

const props = defineProps<{ runtime: Runtime; styleTarget: ShadowRoot }>();
const r = props.runtime;
const tab = ref('overview'), handle = ref<HTMLElement>();
const tabs = ['overview', 'experience', 'enemies', 'counters', 'review', 'settings'];
function tabProps(name: string) {
  return { role: 'tab', tabindex: tab.value === name ? 0 : -1, 'aria-selected': tab.value === name,
    onKeydown(e: KeyboardEvent) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tab.value = name; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault(); tab.value = tabs[(tabs.indexOf(name) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        (e.currentTarget as HTMLElement).parentElement?.parentElement?.querySelector<HTMLElement>(`[data-name="${tab.value}"]`)?.focus();
      }
    }, 'data-name': name };
}
const { width, height } = useWindowSize();
const savedPosition = r.store.get<{ x: number; y: number } | null>('position', null);
const { x, y } = useDraggable(handle, {
  initialValue: savedPosition || { x: Math.max(0, window.innerWidth - 440), y: 60 },
  preventDefault: true,
  onEnd(position) { r.store.set('position', position); },
});
const position = computed(() => {
  const top = Math.max(0, Math.min(y.value, height.value - (r.settings.folded ? 84 : 240)));
  return { left: Math.max(0, Math.min(x.value, width.value - Math.min(408, width.value - 16))) + 'px',
    top: top + 'px', '--available-height': Math.max(200, height.value - top - 8) + 'px' };
});
watch(() => r.settings.folded, () => r.saveSettings());
const themes = { common: { primaryColor: '#87d9b1', primaryColorHover: '#a6ecc8', borderRadius: '10px', fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif' }, Tabs: { tabFontWeight: '600' } };
</script>

<template>
  <NConfigProvider :theme="darkTheme" :locale="zhCN" :theme-overrides="themes" :style-mount-target="styleTarget" preflight-style-disabled>
    <aside class="assistant" :class="{ folded: r.settings.folded }" :style="position" aria-label="PokeCatch 游戏助手">
      <header class="app-header">
        <div ref="handle" class="drag-handle" title="拖动移动助手"><span class="brand-icon">P</span><div><strong>PokeCatch</strong><small>游戏助手 <span class="version">v{{ pkg.version }}</span></small></div></div>
        <div class="actions"><NButton size="small" quaternary data-testid="open-farming" @click="r.settings.farmingVisible = true; r.settings.farmingFolded = false; r.saveSettings()">刷图</NButton><NButton size="small" quaternary data-testid="fold" :aria-expanded="!r.settings.folded" @click="r.settings.folded = !r.settings.folded">{{ r.settings.folded ? '展开' : '收起' }}</NButton></div>
      </header>
      <template v-if="!r.settings.folded">
        <div class="connection"><span class="status-dot" :class="{ warning: !r.status.text.startsWith('正在') }"></span><span data-testid="status">{{ r.status.text }}</span><NTag v-if="r.experience.state.session.partial" size="small" :bordered="false" type="warning">部分数据</NTag></div>
        <div v-if="r.status.storage" class="storage-error" role="alert">{{ r.status.storage }}</div>
        <NTabs v-model:value="tab" type="line" animated :tabs-padding="20" pane-class="tab-content" size="small">
          <NTabPane name="overview" tab="概览" :tab-props="tabProps('overview')"><Overview :runtime="r" @navigate="tab = $event" /></NTabPane>
          <NTabPane name="experience" tab="经验" :tab-props="tabProps('experience')"><Experience :runtime="r" /></NTabPane>
          <NTabPane name="enemies" tab="敌情" :tab-props="tabProps('enemies')"><Enemies :runtime="r" /></NTabPane>
          <NTabPane name="counters" tab="对策" :tab-props="tabProps('counters')"><Counters :runtime="r" /></NTabPane>
          <NTabPane name="review" tab="回顾" :tab-props="tabProps('review')"><Review :runtime="r" /></NTabPane>
          <NTabPane name="settings" tab="设置" :tab-props="tabProps('settings')"><Settings :runtime="r" /></NTabPane>
        </NTabs>
        <footer>只读游戏数据 <span>仅保存在本机</span></footer>
      </template>
    </aside>
    <FarmingWindow :runtime="r" />
  </NConfigProvider>
</template>
