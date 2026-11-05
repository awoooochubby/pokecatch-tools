<script setup lang="ts">
import { useSelectTarget } from '../ui/select-target';
const overlayTarget = useSelectTarget();
import { computed } from 'vue';
import { NButton, NSelect, NTag, NCollapse, NCollapseItem } from 'naive-ui';
import type { Runtime } from '../core/runtime';
import { pokemonName } from '../core/pokemon';
import { formatRaidMoves } from '../raid/time';
import AnalysisFlow from './AnalysisFlow.vue';
import RaidComparison from './RaidComparison.vue';
const { runtime: r } = defineProps<{ runtime: Runtime }>();
const raid = r.raid, s = raid.state;
const regions: Record<string, string> = { kanto: '关都', johto: '城都', hoenn: '丰缘', sinnoh: '神奥' };
const options = computed(() => s.entries.map(i => ({ value: i.region, label: `${regions[i.region]} · ${i.boss ? pokemonName(i.boss) : '首领未读取'}` })));
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const orderRange = (report: NonNullable<typeof s.report>) => report.orderResults ? `${pct(Math.min(...report.orderResults.map(r => r.mean)))}–${pct(Math.max(...report.orderResults.map(r => r.mean)))}` : pct(report.win.mean);
const blocked = computed(() => s.busy || r.tracker.state.running || r.tracker.state.analysing || r.tracker.state.raidBusy);
const reports = computed(() => Object.values(s.reports));
function download() { if (!reports.value.length) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify({ reports: s.reports, plans: s.plans }, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'pokecatch-raid-analysis.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>
<template>
  <AnalysisFlow title="团体战分析" :busy="s.busy && s.task !== 'loading'" :has-result="reports.length > 0" :result-key="s.finishedAt" :error="s.error" :stale="s.stale" :cancelled="s.phase.includes('取消')" :phase="s.phase" phase-testid="raid-phase" :progress="s.sampleTotal ? s.done / s.sampleTotal * 100 : 0">
    <template #setup>
      <div class="task-intro"><h3>选一场团战，比较怎样打得更快</h3><p>按双方总出招数衡量开销，失败重试也计入。可以预测原配队，也可以让助手搜索一支期望出招更少的队伍。</p></div>
      <NButton block secondary :loading="s.busy && s.task === 'loading'" :disabled="blocked" data-testid="raid-load" @click="raid.load">{{ s.entries.length ? '刷新今日团战与原生队伍' : '读取今日团战' }}</NButton>
      <p v-if="r.tracker.state.running" class="flow-message stale">先停止自动追踪，再读取团战配置。</p>
      <p class="hint" v-if="s.task === 'loading'">{{ s.phase }}</p>
      <div v-if="s.entries.length" class="raid-setup-list">
        <div v-for="entry in s.entries" :key="entry.region" class="task-card" data-testid="raid-row" :data-region="entry.region">
          <div class="split"><strong>{{ regions[entry.region] }} · {{ entry.boss ? pokemonName(entry.boss) : '首领未读取' }}</strong><NTag size="tiny" :type="entry.done ? 'default' : entry.input ? 'success' : 'warning'">{{ entry.done ? '今日已捕获' : entry.input ? '原配队已就绪' : '待配置' }}</NTag></div>
          <p class="hint">{{ entry.error || (entry.input ? '可以直接预测原配队；自动搜索会另行比较己方与 NPC 组合。' : '自动搜索可从 Box 和实际 NPC 中选队。') }}</p>
          <NButton size="small" secondary :disabled="blocked || entry.done" :data-testid="`raid-optimize-${entry.region}`" @click="raid.optimize(entry.region)">搜索更快的配队 →</NButton>
        </div>
        <div class="form-section"><label>预测原配队</label><NSelect :value="s.selected" :options="options" :to="overlayTarget" :disabled="s.busy" aria-label="团体战预测目标" @update:value="raid.select" /><div class="actions"><NButton type="primary" :disabled="blocked || !s.inputs.some(input => input.region === s.selected)" @click="raid.runOne">预测所选场次</NButton><NButton secondary :disabled="blocked || !s.inputs.length" data-testid="raid-run" @click="raid.run">预测全部团体战</NButton></div></div>
      </div>
    </template>
    <template #progress>
      <p class="hint">{{ s.task==='optimize' ? '初筛与独立复核按组推进，下表会逐组更新。' : `已计算 ${s.completed}/${s.count} 场 · 当前场次 ${s.done}/${s.sampleTotal} 次模拟` }}</p>
      <NButton v-if="s.busy" size="small" secondary @click="raid.cancel">取消预测</NButton>
      <RaidComparison v-if="s.candidates.length" :candidates="s.candidates" :busy="s.busy" />
      <p v-else class="hint">读取快照 → 连续模拟道中与首领 → 汇总胜率和双方出招。完整结果生成前，候选不会被标记为最终推荐。</p>
    </template>
    <template #result>
      <div class="section-heading"><div><h3>团战分析报告</h3><small>{{ s.phase }}<template v-if="s.finishedAt"> · {{ new Date(s.finishedAt).toLocaleTimeString('zh-CN', { hour12: false }) }}</template></small></div><NButton size="small" secondary data-testid="export-raid" @click="download">导出报告</NButton></div>
      <div class="raid-result-grid"><button v-for="entry in s.entries" :key="entry.region" class="raid-result-card" :class="{ selected: s.selected === entry.region }" data-testid="raid-result-row" :data-region="entry.region" @click="raid.select(entry.region)"><small>{{ regions[entry.region] }} · {{ pokemonName(entry.boss) }}</small><template v-if="s.reports[entry.region]"><strong>{{ orderRange(s.reports[entry.region]) }}</strong><span>成功率 · 期望 {{ formatRaidMoves(s.reports[entry.region].expectedClearMoves) }}</span></template><template v-else><strong>未生成结果</strong><span>{{ s.failures[entry.region] || entry.error || '本次未计算' }}</span></template></button></div>
      <template v-if="s.report">
        <div class="report-title"><div><span class="eyebrow">{{ s.plans[s.selected] ? '自动配队 · 最终复核' : '原配队 · 模拟结果' }}</span><h3>{{ regions[s.report.input.region] }} · {{ pokemonName(s.report.input.boss) }}</h3></div><span class="state-pill" :class="s.stale ? 'stale' : 'success'">{{ s.stale ? '快照已过期' : '报告已生成' }}</span></div>
        <div class="result-metrics"><div class="metric-card"><small>预计成功率</small><strong data-testid="raid-win">{{ orderRange(s.report) }}</strong><span>95% 区间 {{ pct(s.report.win.low) }}–{{ pct(s.report.win.high) }}</span></div><div class="metric-card emphasis"><small>期望成功通关开销</small><strong>{{ formatRaidMoves(s.report.expectedClearMoves) }}</strong><span>双方出招 · 包含失败重试</span></div></div>
        <p class="hint" data-testid="raid-moves">平均每次：我方 {{ s.report.moves.ally.mean.toFixed(1) }} ＋ 敌方 {{ s.report.moves.enemy.mean.toFixed(1) }} ＝ {{ s.report.moves.total.mean.toFixed(1) }} 次出招。期望成功通关出招数＝平均每次双方出招数 ÷ 成功率。{{ s.report.trials }} 次模拟，获胜 {{ s.report.wins }} 次。</p>
        <div class="lineup-grid"><div class="task-card"><span class="eyebrow">自己的精灵</span><div v-for="(mon,index) in s.report.team.filter(m => !m.ally)" :key="index" class="hunt-target"><strong>{{ mon.name }}{{ mon.shiny ? ' ★' : '' }}</strong><small>Lv.{{ mon.level }}</small></div></div><div class="task-card"><span class="eyebrow">队友精灵 · 实际出场顺序</span><div v-for="(mon,index) in s.report.team.filter(m => m.ally)" :key="index" class="hunt-target"><span>{{ mon.name }}{{ mon.shiny ? ' ★' : '' }}</span><small>Lv.{{ mon.level }}</small></div></div></div>
        <RaidComparison v-if="s.plans[s.selected]" :plan="s.plans[s.selected]" />
        <NCollapse><NCollapseItem title="这份报告怎么算，以及有哪些边界" name="method"><p class="hint">从入口满血重打，连续模拟道中、中心与首领。成功指击败首领，捕获概率另计。双方普通攻击、状态招式、未命中、反击和怒气技都计入；群攻一次只计一次，走路、毒烧扣血和换人不计作出招。</p><p class="hint">{{ s.report.orderResults ? '好友顺序未保存，穷举两种顺序；上方显示胜率范围，下方配置取期望出招更多的顺序。' : '保留原生等级、异色、阶级与 NPC 加成。' }}副本过程由经过构建校验的游戏原引擎计算；这里仅生成方案，实际入场由追踪器另行核对。</p></NCollapseItem></NCollapse>
      </template>
      <p v-else class="flow-message stale">所选场次没有结果。请在上方选择已完成的场次，或返回任务设置补齐阵容后计算。</p>
    </template>
  </AnalysisFlow>
</template>
