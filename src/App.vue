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
import Tracker from './components/Tracker.vue';
import Raid from './components/Raid.vue';
import pkg from '../package.json';
import { usePanelSize } from './ui/panel-size';

const props = defineProps<{ runtime: Runtime; styleTarget: ShadowRoot }>();
const r = props.runtime;
const tab = ref('overview'), handle = ref<HTMLElement>();
const panel = usePanelSize(r.store, 'panelSize', { width: 440, height: 760 });
const desk = ref(r.store.get<boolean>('deskMode', false) === true);
watch(desk, value => r.store.set('deskMode', value));
function openDesk(name = tab.value) { desk.value = true; r.settings.folded = false; tab.value = name; }
function openFarming() { if (desk.value || width.value < 600) { openDesk('farming'); return; } r.settings.farmingVisible = true; r.settings.farmingFolded = false; r.saveSettings(); }
function closeDesk() { desk.value = false; if (tab.value === 'farming') tab.value = 'overview'; }
const tabs = computed(() => ['overview', 'experience', 'enemies', 'counters', 'tracker', 'raid', 'review', ...(desk.value ? ['farming'] : []), 'settings']);
function tabProps(name: string) {
  return { role: 'tab', tabindex: tab.value === name ? 0 : -1, 'aria-selected': tab.value === name,
    onKeydown(e: KeyboardEvent) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tab.value = name; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault(); tab.value = tabs.value[(tabs.value.indexOf(name) + (e.key === 'ArrowRight' ? 1 : tabs.value.length - 1)) % tabs.value.length];
        (e.currentTarget as HTMLElement).parentElement?.parentElement?.querySelector<HTMLElement>(`[data-name="${tab.value}"]`)?.focus();
      }
    }, 'data-name': name };
}
const { width, height } = useWindowSize();
const savedPosition = r.store.get<{ x: number; y: number } | null>('position', null);
const { x, y } = useDraggable(handle, {
  initialValue: savedPosition || { x: Math.max(0, window.innerWidth - 440), y: 60 },
  preventDefault: true, disabled: desk,
  onEnd(position) { r.store.set('position', position); },
});
const position = computed(() => {
  if (desk.value && !r.settings.folded) return { left: '12px', top: '12px', width: Math.max(280, width.value - 24) + 'px', height: Math.max(250, height.value - 24) + 'px', '--available-height': height.value - 24 + 'px' };
  const top = Math.max(0, Math.min(y.value, height.value - (r.settings.folded ? 84 : panel.size.value.height) - 8));
  return { left: Math.max(0, Math.min(x.value, width.value - panel.size.value.width - 8)) + 'px',
    top: top + 'px', width: panel.size.value.width + 'px', height: r.settings.folded ? 'auto' : panel.size.value.height + 'px', '--available-height': panel.size.value.height + 'px' };
});
watch(() => r.settings.folded, () => r.saveSettings());
const themes = { common: { primaryColor: '#87d9b1', primaryColorHover: '#a6ecc8', borderRadius: '10px', fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif' }, Tabs: { tabFontWeight: '600', tabGapSmallLine: '12px' } };
</script>

<template>
  <NConfigProvider :theme="darkTheme" :locale="zhCN" :theme-overrides="themes" :style-mount-target="styleTarget" preflight-style-disabled>
    <aside class="assistant" :class="{ folded: r.settings.folded, 'analysis-desk': desk }" :style="position" aria-label="PokeCatch 游戏助手">
      <header class="app-header">
        <div ref="handle" class="drag-handle" title="拖动移动助手"><span class="brand-icon">P</span><div><strong>PokeCatch</strong><small>游戏助手 <span class="version">v{{ pkg.version }}</span></small></div></div>
        <div class="actions"><NButton size="small" secondary data-testid="open-desk" @click="desk ? closeDesk() : openDesk()">{{ desk ? '回到浮窗' : '分析台 ↗' }}</NButton><NButton size="small" quaternary data-testid="open-farming" @click="openFarming">刷图</NButton><NButton size="small" quaternary data-testid="fold" :aria-expanded="!r.settings.folded" @click="r.settings.folded = !r.settings.folded">{{ r.settings.folded ? '展开' : '收起' }}</NButton></div>
      </header>
      <template v-if="!r.settings.folded">
        <div class="connection"><span class="status-dot" :class="{ warning: !r.status.text.startsWith('正在') }"></span><span data-testid="status">{{ r.status.text }}</span><NTag v-if="r.experience.state.session.partial" size="small" :bordered="false" type="warning">部分数据</NTag></div>
        <div v-if="r.status.storage" class="storage-error" role="alert">{{ r.status.storage }}</div>
        <NTabs v-model:value="tab" type="line" animated :tabs-padding="16" pane-class="tab-content" size="small">
          <NTabPane name="overview" tab="概览" :tab-props="tabProps('overview')"><Overview :runtime="r" @navigate="tab = $event" /></NTabPane>
          <NTabPane name="experience" tab="经验" :tab-props="tabProps('experience')"><Experience :runtime="r" /></NTabPane>
          <NTabPane name="enemies" tab="敌情" :tab-props="tabProps('enemies')"><Enemies :runtime="r" /></NTabPane>
          <NTabPane name="counters" tab="对策" :tab-props="tabProps('counters')"><Counters :runtime="r" /></NTabPane>
          <NTabPane name="tracker" tab="追踪" :tab-props="tabProps('tracker')"><Tracker :runtime="r" /></NTabPane>
          <NTabPane name="raid" tab="团战" :tab-props="tabProps('raid')"><Raid :runtime="r" /></NTabPane>
          <NTabPane name="review" tab="回顾" :tab-props="tabProps('review')"><Review :runtime="r" /></NTabPane>
          <NTabPane v-if="desk" name="farming" tab="刷图" :tab-props="tabProps('farming')"><FarmingWindow :runtime="r" embedded /></NTabPane>
          <NTabPane name="settings" tab="设置" :tab-props="tabProps('settings')"><Settings :runtime="r" @open-farming="openFarming" /></NTabPane>
        </NTabs>
        <footer>{{ r.tracker.state.running ? '自动捕捉运行中' : '自动捕捉未运行' }} <span :title="r.cloudSave.state.phase" :style="r.cloudSave.state.issue ? 'color:#f1c897' : ''" data-testid="cloud-save-summary">云存档：{{ r.cloudSave.state.short }}</span></footer>
      </template>
      <button v-if="!r.settings.folded && !desk" class="panel-resize resize-left" aria-label="从左侧调整助手大小" title="拖动向左扩宽；方向键微调" @pointerdown="panel.resize($event, true)" @keydown="panel.keyboard">⌞</button>
      <button v-if="!r.settings.folded && !desk" class="panel-resize" aria-label="调整助手大小" title="拖动调整宽高；方向键微调" @pointerdown="panel.resize" @keydown="panel.keyboard">⌟</button>
    </aside>
    <FarmingWindow v-if="!desk && (width >= 600 || r.settings.folded)" :runtime="r" @open-desk="openDesk('farming')" />
  </NConfigProvider>
</template>
