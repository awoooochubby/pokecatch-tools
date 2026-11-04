<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NSelect, NTag } from 'naive-ui';
import type { Runtime } from '../core/runtime';
import { pokemonName } from '../core/pokemon';
const { runtime: r } = defineProps<{ runtime: Runtime }>();
const raid = r.raid, s = raid.state;
const regions: Record<string, string> = { kanto: '关都', johto: '城都', hoenn: '丰缘', sinnoh: '神奥' };
const options = computed(() => s.inputs.map(i => ({ value: i.region, label: `${regions[i.region]} · ${pokemonName(i.boss)}` })));
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
</script>
<template>
  <h2>团体战成功率</h2>
  <p class="hint">先在游戏的异色团体战里选好自己的精灵和两名队友。读取后，按这套配置从入口完整模拟，包含道中、中心和首领战。</p>
  <NButton block secondary :loading="s.busy && !s.inputs.length" :disabled="s.busy || r.tracker.state.running" data-testid="raid-load" @click="raid.load">读取团体战配置</NButton>
  <p v-if="r.tracker.state.running" class="hint">先停止自动追踪，再读取团体战，避免挂机切图打断配置读取。</p>
  <template v-if="s.inputs.length">
    <NSelect :value="s.selected" :options="options" :to="false" :disabled="s.busy" aria-label="团体战预测目标" style="margin:12px 0" @update:value="raid.select" />
    <NButton v-if="!s.busy" block type="primary" :disabled="r.tracker.state.running" data-testid="raid-run" @click="raid.run">预测成功率</NButton>
  </template>
  <p class="hint" data-testid="raid-phase">{{ s.phase }}<template v-if="s.busy && s.done"> · {{ s.done }}/{{ s.total }}</template></p>
  <NButton v-if="s.busy" size="small" secondary @click="raid.cancel">取消预测</NButton>
  <p v-if="s.error" class="storage-error" role="alert">{{ s.error }}</p>
  <template v-if="s.report">
    <NTag v-if="s.stale" type="warning" size="small">配置或日期已变化，请重新预测</NTag>
    <h3>{{ regions[s.report.input.region] }} · {{ pokemonName(s.report.input.boss) }}</h3>
    <div class="forecast-rate" data-testid="raid-win">{{ pct(s.report.win.mean) }} <small>预计成功率</small></div>
    <p class="hint">95% 抽样区间 {{ pct(s.report.win.low) }}–{{ pct(s.report.win.high) }}<br>{{ s.report.trials }} 次模拟 · 成功 {{ s.report.wins }} 次</p>
    <h3>本次参战配置</h3>
    <div v-for="(mon, index) in s.report.team" :key="index" class="hunt-target"><span>{{ mon.ally ? '队友' : '自己' }} · {{ mon.name }}{{ mon.shiny ? ' ✨' : '' }}</span><small>Lv.{{ mon.level }}</small></div>
    <p class="hint">成功指本次出发打败首领；首领的捕获概率单独结算，不计入胜率。先后手、命中、暴击、异常状态、首领怒气和队友能力均由原引擎计算。</p>
    <p class="hint">从入口满血重打；即使已经进入团体战，也按这一口径预测。使用读取时的队友配置，保留真实等级、异色、阶级及 NPC 加成；加成到期按游戏标准行动节奏结算。</p>
  </template>
</template>
