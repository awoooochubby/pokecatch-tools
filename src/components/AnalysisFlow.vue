<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { NButton, NProgress } from 'naive-ui';
const p = withDefaults(defineProps<{ title: string; busy: boolean; hasResult: boolean; error?: string; stale?: boolean;
  phase?: string; phaseTestid?: string; progress?: number; resultKey?: unknown; cancelled?: boolean }>(), { error: '', stale: false, phase: '', progress: 0, cancelled: false });
const view = ref<'setup' | 'progress' | 'result'>(p.busy ? 'progress' : p.hasResult ? 'result' : 'setup');
const root = ref<HTMLElement>();
watch(view, async () => { await nextTick(); const scroll = root.value?.closest('.tab-content, .farming-content'); if (scroll) scroll.scrollTop = 0; });
const status = computed(() => p.busy ? 'running' : p.error ? 'error' : p.cancelled ? 'cancelled' : p.stale && p.hasResult ? 'stale' : p.hasResult ? 'success' : 'idle');
const labels = { idle: '尚未生成结果', running: '正在计算', success: '结果已生成', stale: '结果已过期', error: '本次计算失败', cancelled: '计算已取消' };
let startingResult: unknown;
watch(() => p.busy, (busy, before) => {
  if (busy) { startingResult = p.resultKey; view.value = 'progress'; }
  else if (before && !p.error && !p.cancelled) view.value = p.hasResult && p.resultKey !== startingResult ? 'result' : 'setup';
});
defineExpose({ showSetup() { view.value = 'setup'; }, showResults() { view.value = 'result'; } });
watch(() => p.resultKey, (value, before) => { if (value && value !== before && !p.busy) view.value = 'result'; });
</script>
<template>
  <section ref="root" class="analysis-flow" :data-analysis="title" :data-state="status">
    <div class="analysis-heading"><div><span class="eyebrow">{{ title }}</span><h2>{{ status === 'stale' ? '结果已生成' : labels[status] }}</h2></div><span class="state-pill" :class="status"><i></i>{{ labels[status] }}</span></div>
    <p v-if="phase" class="flow-phase" :data-testid="phaseTestid" aria-live="polite">{{ phase }}</p>
    <div class="flow-nav" aria-label="分析步骤">
      <button type="button" :class="{ active: view === 'setup' }" :aria-pressed="view === 'setup'" @click="view = 'setup'"><span>01</span> 任务设置</button>
      <button type="button" :class="{ active: view === 'progress' }" :aria-pressed="view === 'progress'" @click="view = 'progress'"><span>02</span> 计算进度</button>
      <button type="button" :class="{ active: view === 'result' }" :aria-pressed="view === 'result'" @click="view = 'result'"><span>03</span> 分析结果 <i v-if="hasResult" class="result-dot"></i></button>
    </div>
    <div v-if="error" class="flow-message error" role="alert"><strong>本次没有成功完成</strong><p>{{ error }}</p><small v-if="hasResult">保留的旧结果不能代表本次请求。</small></div>
    <div v-else-if="stale && hasResult" class="flow-message stale" role="status">队伍、目标或计算条件已变化。结果页保留的是上次快照，请重新计算。</div>
    <div v-if="view === 'setup'" class="flow-setup"><slot name="setup" /></div>
    <div v-if="view === 'progress'" class="flow-progress">
      <div class="progress-summary"><span class="state-pill" :class="status">{{ labels[status] }}</span><h3>{{ busy ? `${title} · 任务执行中` : hasResult ? '本次任务已结束，可查看报告' : '等待提交计算任务' }}</h3><NProgress v-if="busy" type="line" :percentage="Math.round(Math.min(100, Math.max(0, progress)))" :show-indicator="true" /></div>
      <slot name="progress" />
      <NButton v-if="!busy && hasResult" type="primary" secondary block @click="view = 'result'">查看分析结果 →</NButton>
      <NButton v-else-if="!busy" secondary block @click="view = 'setup'">返回设置任务</NButton>
    </div>
    <div v-if="view === 'result'" class="flow-result">
      <template v-if="hasResult"><div class="result-heading"><span>{{ stale ? '上次结果 · 已过期' : busy ? '已有结果 · 本次计算尚未完成' : error || cancelled ? '上次结果 · 本次未完成' : '计算完成 · 分析报告' }}</span><NButton size="tiny" secondary @click="view = 'setup'">调整任务</NButton></div><slot name="result" /></template>
      <div v-else class="empty-result"><span>◇</span><h3>{{ busy ? '结果正在生成' : '这里还没有分析结果' }}</h3><p>{{ busy ? '计算完成后会自动打开本页。' : '先设置目标并开始计算，成功生成后会在这里展示。' }}</p><NButton secondary @click="view = busy ? 'progress' : 'setup'">{{ busy ? '查看计算进度' : '去设置任务' }}</NButton></div>
    </div>
  </section>
</template>
