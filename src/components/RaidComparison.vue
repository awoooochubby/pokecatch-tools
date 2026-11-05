<script setup lang="ts">
import { computed, ref } from 'vue';
import { NButton } from 'naive-ui';
import type { RaidCandidateAnalysis, RaidPlan } from '../raid/planner';
import { clearTimeScore } from '../raid/time';
const p = defineProps<{ plan?: RaidPlan; candidates?: RaidCandidateAnalysis[]; busy?: boolean }>();
const selected = ref('');
const rows = computed(() => [...(p.plan?.analysis || p.candidates || [])].sort((a, b) => Number(!!b.validation) - Number(!!a.validation) || clearTimeScore(a.validation || a.screening) - clearTimeScore(b.validation || b.screening)));
const report = (row: RaidCandidateAnalysis) => row.validation || row.screening;
const team = (row: RaidCandidateAnalysis, ally: boolean) => report(row).team.filter(m => m.ally === ally).map(m => `${m.name}${m.shiny ? ' ★' : ''} Lv.${m.level}`).join(' / ');
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const moves = (n: number | null) => n === null ? '暂无成功样本' : n.toFixed(1);
const detail = computed(() => rows.value.find(row => row.key === selected.value));
const second = computed(() => rows.value.find(row => row.validation && row.key !== p.plan?.chosenKey && row.validation.expectedClearMoves !== null));
const reason = computed(() => {
  if (!p.plan) return '';
  const best = p.plan.report;
  if (best.expectedClearMoves === null) return '复核中没有成功样本，不能可靠估计通关开销，暂不建议用这批阵容挂机。';
  const other = second.value?.validation;
  return `推荐队伍复核胜率 ${pct(best.win.mean)}，平均我方 ${best.moves.ally.mean.toFixed(1)} 次、敌方 ${best.moves.enemy.mean.toFixed(1)} 次出招；把失败重试也计入后，期望成功通关需 ${best.expectedClearMoves.toFixed(1)} 次出招。` +
    (other?.expectedClearMoves != null ? ` 比下一支已复核候选少 ${(other.expectedClearMoves - best.expectedClearMoves).toFixed(1)} 次。` : '') + ' 选择依据是已复核候选中的期望总出招数，胜率同时列出供你判断风险。';
});
</script>
<template>
  <section class="raid-comparison" data-testid="raid-comparison">
    <div class="section-heading"><h3>{{ busy ? '候选正在逐组计算' : '配队比较与选择依据' }}</h3><span class="state-pill">{{ rows.length }} 组候选</span></div>
    <p v-if="plan" class="hint">{{ plan.ownCount }} 种己方组合 × {{ plan.allyPairCount }} 种 NPC 队友组合 → 每组初测 32 次 → 前 {{ Math.min(3, plan.candidates) }} 组各独立复核 512 次 → 按期望总出招数选择。</p>
    <div v-if="plan" class="decision-note" data-testid="raid-selection-reason"><strong>{{ plan.report.expectedClearMoves === null ? '这次未找到有成功样本的方案' : '为什么推荐这支队伍' }}</strong><p>{{ reason }}</p></div>
    <details v-if="plan" class="analysis-method"><summary>候选队伍怎样进入比较？</summary><p class="hint">先按游戏原生对策评分从 Box 中筛选，再比较最多 4 种己方组合；NPC 从原生评分靠前的实际队友里两两组合。固定了己方精灵的追踪任务只比较队友。每组先做 32 次初筛，期望出招较少的前几组再各做 512 次独立复核。下表保留所有实际测试过的组合，未复核候选只作初筛记录。</p></details>
    <div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>方案／阶段</th><th>自己的精灵</th><th>队友精灵</th><th>胜率</th><th>双方出招／次</th><th>期望通关出招</th><th>明细</th></tr></thead><tbody>
      <tr v-for="row in rows" :key="row.key" :class="{ recommended: row.key === plan?.chosenKey }" data-testid="raid-candidate">
        <td><strong>{{ row.key === plan?.chosenKey ? '推荐方案' : `候选 ${row.key.split('-').at(-1)}` }}</strong><small>{{ row.validation ? '已复核 · 512 次' : '初测 · 32 次' }}</small></td>
        <td>{{ team(row, false) }}</td><td>{{ team(row, true) }}</td>
        <td>{{ pct(report(row).win.mean) }}<small>{{ pct(report(row).win.low) }}–{{ pct(report(row).win.high) }}</small></td>
        <td>{{ report(row).moves.ally.mean.toFixed(1) }} ＋ {{ report(row).moves.enemy.mean.toFixed(1) }}<small>我方 ＋ 敌方</small></td>
        <td><strong>{{ moves(report(row).expectedClearMoves) }}</strong><small>{{ row.validation ? '包含失败重试' : '仅初筛估计' }}</small></td>
        <td><NButton size="tiny" quaternary @click="selected = selected === row.key ? '' : row.key">{{ selected === row.key ? '收起' : '查看' }}</NButton></td>
      </tr>
    </tbody></table></div>
    <div v-if="detail" class="candidate-detail" data-testid="raid-candidate-detail"><h3>候选 {{ detail.key.split('-').at(-1) }} · 计算明细</h3><div class="comparison-stages"><div v-for="(entry, index) in [detail.screening, detail.validation].filter(Boolean)" :key="index" class="metric-card"><small>{{ index ? '独立复核' : '初步筛选' }} · {{ entry!.trials }} 次模拟</small><strong>{{ pct(entry!.win.mean) }} 胜率</strong><p>获胜 {{ entry!.wins }}/{{ entry!.trials }} 次<br>总出招均值估计区间 {{ entry!.moves.total.low.toFixed(1) }}–{{ entry!.moves.total.high.toFixed(1) }}<br>我方 {{ entry!.moves.ally.mean.toFixed(1) }} 次 ＋ 敌方 {{ entry!.moves.enemy.mean.toFixed(1) }} 次<br>期望通关 {{ moves(entry!.expectedClearMoves) }} 次出招</p></div></div><p v-if="!detail.validation" class="hint">此候选没有进入前三名复核；它的初测精度较低，不能与 512 次复核视作同等可信。</p></div>
    <p class="hint">候选很接近时，排序也可能受抽样波动影响。有限候选搜索，不保证全局最优。群攻的一次招式计一次；道中、未命中、状态招式、反击、怒气技和失败重试都计入。期望通关出招＝每次尝试的平均双方出招 ÷ 胜率。</p>
  </section>
</template>
