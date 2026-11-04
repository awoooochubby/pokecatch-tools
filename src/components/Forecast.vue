<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NAlert, NButton, NCollapse, NCollapseItem, NInputNumber, NProgress, NSelect, NSwitch, NTag } from 'naive-ui';
import type { Runtime } from '../core/runtime';
import { pokemonName } from '../core/pokemon';
import { number, duration, time } from '../core/format';
import type { ForecastOptions } from '../simulation/forecast-types';
const { runtime: r } = defineProps<{ runtime: Runtime }>();
const s = r.forecast.state;
const saved = r.store.get<Record<string, unknown>>('forecastPreferences', {});
const chapters = ref<number[]>(Array.isArray(saved.chapters) ? saved.chapters.filter(Number.isInteger) : []);
const trials = ref(typeof saved.trials === 'number' && Number.isInteger(saved.trials) && saved.trials >= 128 && saved.trials <= 2048 ? saved.trials : 256);
const full = ref(saved.full !== false), selected = ref(typeof saved.selected === 'string' ? saved.selected : '');
watch([chapters, trials, full, selected], () => r.store.set('forecastPreferences', { chapters: chapters.value, trials: trials.value, full: full.value, selected: selected.value }), { deep: true });
const labels: Record<string, string> = { 'QG Galaxie': '银河队基地', 'Badge Phare': '灯塔徽章', 'Badge Glaçon': '冰雪徽章', 'Monde Distorsion': '毁坏的世界', 'Route Victoire': '冠军之路',
  'Badge Charbon': '煤炭徽章', 'Badge Forêt': '森林徽章', 'Badge Fantôme': '遗迹徽章', 'Badge Pavé': '圆石徽章', 'Badge Palustre': '湿地徽章', 'Badge Mine': '矿山徽章', 'Les Lacs': '湖泊事件',
  'Conseil 4 : Aaron': '四天王：阿柳', 'Conseil 4 : Terry': '四天王：菊野', 'Conseil 4 : Adrien': '四天王：大叶', 'Conseil 4 : Lucio': '四天王：悟松', 'Maître de la Ligue': '联盟冠军', 'Mont Abrupt': '严酷山' };
const name = (text: string) => labels[text] || text;
watch(() => s.catalog, catalog => {
  if (!catalog) return;
  const valid = chapters.value.filter(id => catalog.chapters.some(ch => ch.id === id));
  chapters.value = valid.length ? valid : [...new Set([catalog.current, ...catalog.chapters.filter(ch => ['QG Galaxie', 'Badge Phare', 'Route Victoire'].includes(ch.name)).map(ch => ch.id)])].slice(0, 4);
  if (selected.value && !catalog.team.some(m => m.uid === selected.value)) selected.value = '';
}, { immediate: true });
const chapterOptions = computed(() => s.catalog?.chapters.map(ch => ({ label: `${name(ch.name)}${ch.id === s.catalog!.current ? '（当前）' : ''}`, value: ch.id })) || []);
const memberOptions = computed(() => [{ label: '整队经验合计', value: '' }, ...(s.report?.catalog || s.catalog)?.team.map(m => ({ label: `${pokemonName(m.id)} Lv.${m.level} · ${m.uid.slice(-6)}`, value: m.uid })) || []]);
const rows = computed(() => (s.report?.rows || []).map(row => ({ ...row, metric: selected.value ? row.members[selected.value] : row }))
  .sort((a, b) => a.error ? 1 : b.error ? -1 : (b.metric?.rate.mean || 0) - (a.metric?.rate.mean || 0)));
const best = computed(() => !s.busy && !s.stale ? rows.value.find(row => !row.error && row.metric && row.metric.rate.mean > 0) : null);
const overBudget = computed(() => chapters.value.length * trials.value > 8192 || chapters.value.length > 16);
const validTrials = computed(() => Number.isInteger(trials.value) && trials.value >= 128 && trials.value <= 2048);
const buddyLabel = computed(() => { const mon = s.catalog?.team.find(m => m.uid === s.catalog?.buddy); return mon ? pokemonName(mon.id) : s.catalog?.buddy ? '不在出战队伍' : '未指定'; });
const changed = computed(() => s.report && (JSON.stringify(s.report.options.chapters) !== JSON.stringify(chapters.value) || s.report.options.start !== (full.value ? 'full' : 'current') || s.report.options.trials !== trials.value));
function run() { const options: ForecastOptions = { chapters: [...chapters.value], trials: trials.value, seed: 1729, start: full.value ? 'full' : 'current' }; r.forecast.run(options); }
function exportReport() {
  if (!s.report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(s.report, null, 2)], { type: 'application/json' })), a = document.createElement('a');
  a.href = url; a.download = 'pokecatch-experience-forecast.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>
<template>
  <p class="hint">无需先去地图挂机。用当前出战队伍，直接模拟整章战斗、实得经验和升级，比较哪张图更适合练级。</p>
  <div class="actions"><NButton size="small" secondary :disabled="s.busy" data-testid="load-forecast" @click="r.forecast.load">{{ s.catalog ? '重新读取当前队伍' : '读取当前队伍' }}</NButton><NButton v-if="s.busy" size="small" data-testid="cancel-forecast" @click="r.forecast.cancel">取消模拟</NButton></div>
  <p class="hint" data-testid="forecast-phase">{{ s.phase }}</p>
  <NAlert v-if="s.error" type="error" :show-icon="false">{{ s.error }}</NAlert>
  <template v-if="s.catalog">
    <small>{{ s.catalog.team.map(m => `${pokemonName(m.id)} Lv.${m.level}`).join(' / ') }}<br>自动切换{{ s.catalog.autoSwitch ? '开启' : '关闭' }} · 标准节奏每步 {{ number(s.catalog.stepMs) }}ms · 增益 ×{{ s.catalog.xpBoost }}<br>快照 {{ time(s.catalog.capturedAt) }} · 伙伴 {{ buddyLabel }}</small>
    <h2>比较地图</h2><NSelect v-model:value="chapters" :options="chapterOptions" multiple :to="false" :disabled="s.busy" aria-label="模拟比较地图" />
    <div class="setting-row"><span>每图模拟次数</span><NInputNumber v-model:value="trials" :min="128" :max="2048" :precision="0" :disabled="s.busy" style="width:115px" aria-label="每图模拟次数" /></div>
    <div class="setting-row"><span>满血从章首出发</span><NSwitch v-model:value="full" :disabled="s.busy" aria-label="模拟满血出发" /></div>
    <p class="hint">{{ full ? '按切图后满血出发；途中中心按原规则治疗。' : '把快照的 HP／状态带到章首，途中治疗照常。' }}本轮升级、触顶以及失败前经验都会计入。每次开算会自动刷新队伍快照。</p>
    <NAlert v-if="overBudget" type="warning" :show-icon="false">最多 16 张图、合计 8192 轮，请减少地图或次数。</NAlert>
    <NButton block type="primary" :disabled="s.busy || !chapters.length || overBudget || !validTrials" data-testid="run-forecast" @click="run">模拟比较 {{ chapters.length }} 张图</NButton>
  </template>
  <NProgress v-if="s.busy && s.total" style="margin-top:12px" type="line" :percentage="Math.round(s.completed / s.total * 100)" />
  <NAlert v-if="s.stale" style="margin-top:12px" type="warning" :show-icon="false">队伍、经验或加成已变化，结果对应读取时快照；重新读取后再比较。</NAlert>
  <p v-if="changed" class="hint">比较条件已改变，下面仍显示上一次条件的结果，请重新模拟。</p>
  <template v-if="s.report?.rows.length">
    <h2>预测效率排行 <small>{{ s.busy ? '计算中，结果尚不完整' : '标准行动节奏' }}</small></h2>
    <NSelect v-model:value="selected" :options="memberOptions" :to="false" aria-label="模拟经验比较对象" size="small" />
    <p v-if="best && !changed" class="hint accent" data-testid="forecast-best">预计最高：{{ name(best.name) }}。接近的结果可提高模拟次数再比较。</p>
    <NAlert v-if="!s.busy && rows.some(row => !row.error) && rows.filter(row => !row.error).every(row => !row.metric?.xp.mean)" type="info" :show-icon="false">所选对象在这些模拟中没有经验增长；可检查等级上限及是否能击倒敌人。</NAlert>
    <div v-for="row in rows" :key="row.chapter" class="map-row" data-testid="forecast-row">
      <div class="split"><strong>{{ name(row.name) }}</strong><NTag v-if="!row.error" size="small" :type="row.complete.mean < .9 ? 'warning' : 'success'">完成 {{ number(row.complete.mean * 100) }}%</NTag></div>
      <p v-if="row.error" class="hint">暂不能计算：{{ row.error }}</p>
      <template v-else-if="row.metric"><div class="forecast-rate accent">{{ number(row.metric.rate.mean) }} <small>预计 XP/分钟</small></div><small>抽样区间 {{ number(row.metric.rate.low) }}–{{ number(row.metric.rate.high) }} · {{ row.trials }} 次模拟<br>每轮 {{ number(row.metric.xp.mean) }} XP · {{ duration(row.seconds.mean * 1000) }} · {{ number(row.steps.mean) }} 行动步<br>完成率区间 {{ number(row.complete.low * 100) }}–{{ number(row.complete.high * 100) }}%<br>平均倒下 {{ row.faints.mean.toFixed(2) }} 次 · 失败样本已计入</small><small v-if="selected && row.members[selected]">本轮平均升级 {{ row.members[selected].levels.mean.toFixed(2) }} 级 · {{ number(row.members[selected].capped * 100) }}% 的模拟结束时触顶</small></template>
    </div>
    <p class="hint">XP 和战斗过程用原引擎计算。耗时采用游戏切到其他页面时的标准行动节奏；前台动画、手动停顿会改变实际 XP/分钟。抽样区间不包含计时模型误差。暂不包含漫游首领。</p>
    <NButton size="small" secondary block data-testid="export-forecast" @click="exportReport">导出预测报告</NButton>
    <NCollapse><NCollapseItem title="本次模拟的完整口径" name="assumptions"><p v-for="line in s.report.assumptions" :key="line" class="hint">{{ line }}</p></NCollapseItem></NCollapse>
  </template>
</template>
