<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NSelect, NTag } from 'naive-ui';
import type { Runtime } from '../core/runtime';
import { pokemonName } from '../core/pokemon';
const { runtime: r } = defineProps<{ runtime: Runtime }>();
const raid = r.raid, s = raid.state;
const regions: Record<string, string> = { kanto: '关都', johto: '城都', hoenn: '丰缘', sinnoh: '神奥' };
const options = computed(() => s.entries.map(i => ({ value: i.region, label: `${regions[i.region]} · ${i.boss ? pokemonName(i.boss) : '首领未读取'}` })));
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const orderRange = (report: NonNullable<typeof s.report>) => report.orderResults ? `${pct(Math.min(...report.orderResults.map(r => r.mean)))}–${pct(Math.max(...report.orderResults.map(r => r.mean)))}` : pct(report.win.mean);
</script>
<template>
  <h2>团体战成功率</h2>
  <p class="hint">读取全部已解锁的今日团体战，一键比较各场胜率。每场使用各自已配置的精灵和队友，从入口连续模拟道中、中心和首领；正在打某场也能比较其他场。</p>
  <NButton block secondary :loading="s.busy && !s.inputs.length" :disabled="s.busy || r.tracker.state.running" data-testid="raid-load" @click="raid.load">读取团体战配置</NButton>
  <p v-if="r.tracker.state.running" class="hint">先停止自动追踪，再读取团体战，避免挂机切图打断配置读取。</p>
  <NTag v-if="s.stale" type="warning" size="small">配置或日期已变化，请重新预测</NTag>
  <template v-if="s.entries.length">
    <div v-for="entry in s.entries" :key="entry.region" class="map-row" data-testid="raid-row" :data-region="entry.region">
      <div class="setting-row"><strong>{{ regions[entry.region] }} · {{ entry.boss ? pokemonName(entry.boss) : '首领未读取' }}</strong><NButton size="tiny" quaternary @click="raid.select(entry.region)">详情</NButton></div>
      <small v-if="entry.done">今日已捕获</small>
      <template v-if="s.reports[entry.region]"><strong>{{ orderRange(s.reports[entry.region]) }} 成功率</strong><small v-if="s.reports[entry.region].orderResults">好友顺序未保存 · 两种顺序各模拟 {{ s.reports[entry.region].trials }} 次</small><small>95% 区间 {{ pct(s.reports[entry.region].win.low) }}–{{ pct(s.reports[entry.region].win.high) }}<template v-if="!s.reports[entry.region].orderResults"> · {{ s.reports[entry.region].trials }} 次模拟</template></small></template>
      <small v-else-if="entry.error || s.failures[entry.region]">暂不能计算：{{ entry.error || s.failures[entry.region] }}</small>
      <small v-else>{{ s.busy && s.current === entry.region ? `正在模拟 ${s.done}/${s.sampleTotal}` : '配置完整，等待模拟' }}</small>
    </div>
    <NSelect :value="s.selected" :options="options" :to="false" :disabled="s.busy" aria-label="团体战预测目标" style="margin:12px 0" @update:value="raid.select" />
    <NButton v-if="!s.busy" block type="primary" :disabled="r.tracker.state.running || !s.inputs.length" data-testid="raid-run" @click="raid.run">预测全部团体战</NButton>
    <NButton v-if="!s.busy" block secondary :disabled="r.tracker.state.running || !s.inputs.some(input => input.region === s.selected)" style="margin-top:8px" @click="raid.runOne">只预测所选场次</NButton>
  </template>
  <p class="hint" data-testid="raid-phase">{{ s.phase }}<template v-if="s.busy && s.count"> · {{ s.completed }}/{{ s.count }} 场</template></p>
  <NButton v-if="s.busy" size="small" secondary @click="raid.cancel">取消预测</NButton>
  <p v-if="s.error" class="storage-error" role="alert">{{ s.error }}</p>
  <template v-if="s.report">
    <h3>{{ regions[s.report.input.region] }} · {{ pokemonName(s.report.input.boss) }}</h3>
    <div class="forecast-rate" data-testid="raid-win">{{ orderRange(s.report) }} <small>预计成功率</small></div>
    <p class="hint">95% 抽样区间 {{ pct(s.report.win.low) }}–{{ pct(s.report.win.high) }}<br><template v-if="s.report.orderResults">两种好友顺序各模拟 {{ s.report.trials }} 次；显示两种结果范围，无需先开战。</template><template v-else>{{ s.report.trials }} 次模拟 · 成功 {{ s.report.wins }} 次</template></p>
    <p v-if="s.report.orderResults" class="hint">下方展示较低胜率对应的顺序；已开战的场次会直接使用实际顺序。</p>
    <h3>本次参战配置</h3>
    <div v-for="(mon, index) in s.report.team" :key="index" class="hunt-target"><span>{{ mon.ally ? '队友' : '自己' }} · {{ mon.name }}{{ mon.shiny ? ' ✨' : '' }}</span><small>Lv.{{ mon.level }}</small></div>
    <p class="hint">成功指本次出发打败首领；首领的捕获概率单独结算，不计入胜率。先后手、命中、暴击、异常状态、首领怒气和队友能力均由原引擎计算。</p>
    <p class="hint">从入口满血重打；即使已经进入团体战，也按这一口径预测。使用读取时的队友配置，保留真实等级、异色、阶级及 NPC 加成；加成到期按游戏标准行动节奏结算。</p>
  </template>
</template>
