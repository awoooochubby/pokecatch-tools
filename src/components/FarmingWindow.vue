<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useDraggable, useWindowSize } from '@vueuse/core';
import { NButton, NSelect, NTag, NCollapse, NCollapseItem } from 'naive-ui';
import type { Runtime } from '../core/runtime';
import { mapRate } from '../modules/farming';
import { duration, number } from '../core/format';
import Forecast from './Forecast.vue';
const { runtime: r } = defineProps<{ runtime: Runtime }>();
const s = r.farming.state, handle = ref<HTMLElement>(), { width, height } = useWindowSize();
const saved = r.store.get<{ x: number; y: number } | null>('farmingPosition', null);
const view = ref(r.store.get<string>('farmingView', 'forecast') === 'observed' ? 'observed' : 'forecast');
watch(view, value => r.store.set('farmingView', value));
const { x, y } = useDraggable(handle, { initialValue: saved || { x: 16, y: 100 }, preventDefault: true,
  onEnd(p) { r.store.set('farmingPosition', p); } });
const compact = ref(false);
const folded = computed(() => r.settings.farmingFolded || width.value < 600 && !compact.value);
const style = computed(() => {
  const top = width.value < 600 && folded.value ? Math.max(0, height.value - 66) : Math.max(0, Math.min(y.value, height.value - (folded.value ? 60 : 250)));
  return { left: Math.max(0, Math.min(x.value, width.value - Math.min(360, width.value - 16))) + 'px', top: top + 'px', maxHeight: height.value - top - 8 + 'px' };
});
watch(() => [r.settings.farmingFolded, r.settings.farmingVisible], () => r.saveSettings());
const current = computed(() => s.records.find(row => row.key === s.currentKey));
const options = computed(() => {
  const members = new Map<string, string>();
  for (const row of s.records) for (const [uid, m] of Object.entries(row.mons)) members.set(uid, m.name);
  for (const m of s.team) members.set(m.uid, m.name);
  return [{ label: '整队实际经验合计', value: '' }, ...[...members].map(([value, label]) => ({ value, label: `${label} · ${value.slice(-6)}` }))];
});
const rows = computed(() => s.records.filter(row => !s.selected || row.mons[s.selected])
  .map(row => ({ ...row, rate: mapRate(row, s.selected), metric: s.selected ? row.mons[s.selected] : row }))
  .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1)));
const metric = computed(() => current.value && (s.selected ? current.value.mons[s.selected] : current.value));
const rate = computed(() => current.value ? mapRate(current.value, s.selected) : null);
const recent = computed(() => r.farming.recentRate(s.selected));
const labels: Record<string, string> = { 'QG Galaxie': '银河队基地', 'Badge Phare': '灯塔徽章', 'Badge Glaçon': '冰雪徽章', 'Monde Distorsion': '毁坏的世界' };
const name = (n: string) => labels[n] || n;
function toggle() { if (width.value < 600) { compact.value = folded.value; r.settings.farmingFolded = false; } else r.settings.farmingFolded = !r.settings.farmingFolded; }
function exportRecords() {
  const blob = new Blob([JSON.stringify({ kind: 'map-experience', exportedAt: new Date().toISOString(), metric: 'actual-save-xp-growth',
    includes: '战斗、重复捕获和道具的实际入账经验；排除触顶溢出、暂停、后台、离线和边界区间', records: s.records }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'pokecatch-map-experience.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>
<template>
  <aside v-if="r.settings.farmingVisible" class="farming-window" :style="style" aria-label="刷图经验浮窗" data-testid="farming-window">
    <header class="farming-header"><div ref="handle" class="farming-drag" title="拖动移动浮窗"><strong>刷图经验</strong><small>{{ current ? name(current.name) : '等待普通冒险' }}</small></div><div class="actions"><NButton size="tiny" quaternary aria-label="折叠刷图浮窗" @click="toggle">{{ folded ? '＋' : '－' }}</NButton><NButton size="tiny" quaternary aria-label="关闭刷图浮窗" @click="r.settings.farmingVisible = false">×</NButton></div></header>
    <div v-if="!folded" class="farming-content">
      <div class="actions"><NButton size="small" :type="view === 'forecast' ? 'primary' : 'default'" :aria-pressed="view === 'forecast'" @click="view = 'forecast'">模拟选图</NButton><NButton size="small" :type="view === 'observed' ? 'primary' : 'default'" :aria-pressed="view === 'observed'" @click="view = 'observed'">实测记录</NButton></div>
      <Forecast v-if="view === 'forecast'" :runtime="r" />
      <template v-else>
      <div class="split"><small>{{ s.currentNode || '按整章地图累计，多轮合并' }}</small><NTag size="small" :type="r.settings.farming ? 'success' : 'warning'">{{ r.settings.farming ? '实测' : '已关闭' }}</NTag></div>
      <NSelect :value="s.selected" :options="options" :to="false" size="small" aria-label="经验比较对象" style="margin-top:12px" @update:value="r.farming.select($event)" />
      <div class="eyebrow">本图实际入账经验</div><div class="hero-stat" data-testid="map-xp">{{ number(metric?.xp || 0) }}<span>XP</span></div>
      <div class="stat-grid"><div><small>本图 XP/分钟</small><strong data-testid="map-rate">{{ rate === null ? '—' : number(rate) }}</strong></div><div><small>最近 60 秒 XP/分钟</small><strong>{{ recent === null ? '采样中' : number(recent) }}</strong></div><div><small>有效观测时长</small><strong>{{ duration(metric?.ms || 0) }}</strong></div><div><small>折合 XP/小时</small><strong>{{ rate === null ? '—' : number(rate * 60) }}</strong></div></div>
      <p class="hint">{{ s.status }}{{ current?.skipped ? ` · 已排除 ${current.skipped} 个不完整区间` : '' }}。{{ s.trusted ? '已核对当前版本的跨级经验公式。' : '游戏版本未核实，跨级区间将排除。' }}</p>
      <div class="section-heading"><h2>已实测地图排行</h2><NButton size="tiny" secondary data-testid="export-farming" @click="exportRecords">导出</NButton></div>
      <div v-for="row in rows" :key="row.key" class="map-row" data-testid="map-ranking"><div class="split"><strong>{{ row.key === s.currentKey ? '● ' : '' }}{{ name(row.name) }}</strong><span class="accent">{{ row.rate === null ? '—' : number(row.rate) }} XP/分</span></div><small>{{ number(row.metric.xp) }} XP · {{ duration(row.metric.ms) }} · {{ Object.keys(row.mons).length }} 只{{ row.metric.ms < 60000 ? ' · 不足 1 分钟' : '' }}{{ row.skipped ? ' · 含采样排除' : '' }}</small><small v-if="s.selected && row.mons[s.selected]">Lv.{{ row.mons[s.selected].minLevel }}–{{ row.mons[s.selected].maxLevel }}</small></div>
      <p v-if="!rows.length" class="hint">去一张地图战斗后会开始积累记录。未观测的地图不会填入推测值。</p>
      <NCollapse><NCollapseItem title="计算口径与经验规则" name="formula"><p class="hint">击倒奖励 = levelXp(敌方等级) ÷ 15 × √(种族基础经验 ÷ 60)，再乘训练家／道馆 1.5、上场成员 1.1、伙伴 1.3 和经验增益；离线倍率为 0.5。逐只四舍五入。活动／高塔不适用普通奖励规则。</p><p class="hint">这里统计出战队伍存档的实际经验净增长，跨级补上消耗的升级经验，触顶溢出不计。重复捕获、伙伴糖果和战斗期间手动喂道具也可能增加经验，不能据此拆出纯击倒收益。</p><p class="hint">时间包括战斗、治疗和走图，排除暂停、后台、关闭页面、换图／换队边界及无法确认的区间。每张图指一个冒险章节。排行是实测记录，建议同队伍、等级和加成各测几轮，并用指定精灵比较练级速度。</p></NCollapseItem></NCollapse>
      <NButton size="tiny" quaternary block data-testid="reset-map" @click="r.farming.resetCurrent()">重新测量当前图（保留其他图）</NButton>
      </template>
    </div>
  </aside>
</template>
