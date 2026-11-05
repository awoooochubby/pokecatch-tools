<script setup lang="ts">
import { useSelectTarget } from '../ui/select-target';
const overlayTarget = useSelectTarget();
import { computed, ref, watch } from 'vue';
import { NButton, NSelect, NRadioGroup, NRadioButton, NCheckbox, NTag } from 'naive-ui';
import type { Runtime } from '../core/runtime';
import { chapterLabel } from '../core/chapters';
import { berryEffects } from '../tracker/berries';
import { raidIds } from '../raid/planner';
import { formatRaidMoves } from '../raid/time';
import Hatchery from './Hatchery.vue';
import RaidComparison from './RaidComparison.vue';
const { runtime: r } = defineProps<{ runtime: Runtime }>();
const t = r.tracker, s = t.state, prefs = t.prefs;
const view = ref<'setup'|'reports'|'monitor'|'eggs'>('setup');
const resultTargets = computed(() => (s.catalog?.targets || []).filter(target => s.predictions[target.id] || target.kind === 'raid' && raidPlan(target.id)));
async function predict(id: number) { view.value = 'reports'; await t.predict(id); }
function start() { t.start(); if (s.running) view.value = 'monitor'; }
watch(() => s.analysing, analysing => { if (analysing && !s.running) view.value = 'reports'; });
const kinds = { roaming: '游走神兽', zone: '定点神兽', weather: '天气稀有怪', wild: '野生／定点捕捉', raid: '今日团体战' };
const options = computed(() => ['roaming', 'zone', 'weather', 'wild', 'raid'].map(kind => ({ type: 'group' as const, label: kinds[kind as keyof typeof kinds], key: kind,
  children: (s.catalog?.targets || []).filter(target => target.kind === kind).map(target => ({ value: target.id, label: `${target.name} · ${target.status}` })) })));
const weatherOptions = computed(() => (s.catalog?.targets || []).filter(target => (target.kind === 'weather' || target.destinations.some(d => d.weather)) && !target.owned).map(target => ({ value: target.id, label: target.name })));
const selected = computed(() => prefs.targets.map(id => s.catalog?.targets.find(target => target.id === id)).filter(target => !!target));
const page = ref(0), pageSize = 12;
const pageStart = computed(() => Math.min(page.value, Math.max(0, Math.ceil(selected.value.length / pageSize) - 1)) * pageSize);
const pageTargets = computed(() => selected.value.slice(pageStart.value, pageStart.value + pageSize));
const wx = { snow: '雪天', storm: '雷暴雨', rain: '雨天', sun: '晴天', blizzard: '暴风雪', fog: '雾天', sand: '沙暴', ash: '火山灰', breeze: '微风' } as Record<string, string>;
const opportunities = computed(() => (s.catalog?.targets || []).filter(target => !target.owned && target.destinations.some(d => d.weather) && (prefs.weather === null || prefs.weather.includes(target.id))));
const berryOptions = computed(() => (s.catalog?.berries || []).map(b => ({ value: b.key, label: `${b.name} · ${berryEffects[b.family] || b.family} ×${b.mult} · 库存 ${b.stock}` })));
function updateTargets(ids: number[]) { prefs.targets = ids; t.persist(); }
function move(index: number, delta: number) { const ids = [...prefs.targets]; [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; updateTargets(ids); }
const time = (value: number) => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
const teamOptions = computed(() => [{ value: '', label: '默认：挂机前的冒险队／该神兽原有独立队' }, ...(s.catalog?.presets || []).map(p => ({ value: JSON.stringify(p.team), label: `${p.name} · ${p.team.map(uid => s.catalog?.box?.find(m => m.uid === uid)?.name || uid).join('、')}` }))]);
const monOptions = computed(() => (s.catalog?.box || []).map(m => ({ value: m.uid, label: `${m.name}${m.shiny ? ' ★' : ''} Lv.${m.level}` })));
const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
const raidPlan = (id: number) => s.raidPlans[Object.keys(raidIds).find(key => raidIds[key] === id) || ''];
function setTeam(id: number, value: string) { t.setTeam(id, value ? JSON.parse(value) : null); }
function raidTeam(id: number, value: string[]) { if (value.length > 2) { s.error = '团战最多选自己的两只精灵'; return; } t.setTeam(id, value); }
</script>
<template>
  <div class="analysis-heading"><div><span class="eyebrow">自动捕捉</span><h2>挂机任务台</h2></div><span class="state-pill" :class="s.running ? 'running' : 'idle'">{{ s.running ? '挂机运行中' : '尚未启动' }}</span></div>
  <div class="flow-nav tracker-views"><button :class="{active:view==='setup'}" @click="view='setup'">01 队列设置</button><button :class="{active:view==='reports'}" @click="view='reports'">02 模拟报告 <i v-if="resultTargets.length" class="result-dot"></i></button><button :class="{active:view==='monitor'}" @click="view='monitor'">03 挂机状态</button><button :class="{active:view==='eggs'}" data-testid="hatchery-tab" @click="view='eggs'">孵蛋 <i v-if="r.hatchery.state.eggs.some(e => e.shiny)" class="result-dot"></i></button></div>
  <Hatchery v-if="view==='eggs'" :runtime="r" />
  <div v-show="view==='setup'">
  <p class="hint">神兽、补图鉴、天气怪和团战共用一个队列。每个目标可绑定队伍；抓到后自动换目标，游走位置变化后自动跟随。</p>
  <NButton block secondary :loading="s.busy && !s.catalog" :disabled="s.running || r.hatchery.state.busy || s.busy || s.analysing || s.raidBusy" data-testid="tracker-load" @click="t.load">读取目标与天气</NButton>
  <template v-if="s.catalog">
    <div class="actions" style="margin-top: 10px"><NButton size="small" :disabled="s.running || r.hatchery.state.busy || s.busy || s.analysing" data-testid="tracker-fill-dex" @click="t.addMissing">一键加入可抓的缺失图鉴</NButton><NButton size="small" :loading="s.raidBusy" :disabled="s.running || s.analysing || r.hatchery.state.busy || r.raid.state.busy" data-testid="tracker-raids" @click="t.loadRaids">读取今日团战</NButton></div>
    <p v-if="s.notice" class="hint" role="status">{{ s.notice }}</p>
    <h3>想抓哪些？</h3>
    <NSelect :value="prefs.targets" :options="options" multiple :max-tag-count="3" filterable :to="overlayTarget" :disabled="s.running || s.analysing" placeholder="搜索神兽、野生怪或今日团战" aria-label="自动捕捉目标" @update:value="updateTargets" />
    <div v-if="selected.length > pageSize" class="actions"><NButton size="tiny" :disabled="pageStart === 0" @click="page = Math.max(0, pageStart / pageSize - 1)">上一页</NButton><small>{{ pageStart + 1 }}–{{ Math.min(pageStart + pageSize, selected.length) }} / {{ selected.length }} 个目标</small><NButton size="tiny" :disabled="pageStart + pageSize >= selected.length" @click="page = pageStart / pageSize + 1">下一页</NButton></div>
    <div v-for="(target, localIndex) in pageTargets" :key="target.id" class="hunt-config">
    <div class="hunt-target" data-testid="hunt-target">
      <div><strong>{{ pageStart + localIndex + 1 }}. {{ target.name }}</strong><small>{{ target.status }}</small><small v-if="target.destinations[0]">{{ chapterLabel(target.destinations[0].name) }}<template v-if="target.destinations[0].until"> · 约至 {{ time(target.destinations[0].until) }}</template></small></div>
      <div v-if="!s.running" class="actions"><NButton size="tiny" :disabled="pageStart + localIndex === 0 || s.analysing" :aria-label="`上移${target.name}`" @click="move(pageStart + localIndex, -1)">↑</NButton><NButton size="tiny" :disabled="pageStart + localIndex === selected.length - 1 || s.analysing" :aria-label="`下移${target.name}`" @click="move(pageStart + localIndex, 1)">↓</NButton></div>
      <NTag v-else-if="target.owned" size="small" type="success">已完成</NTag>
    </div>
    <NSelect v-if="target.kind !== 'raid'" :value="prefs.teams?.[target.id] ? JSON.stringify(prefs.teams[target.id]) : ''" :options="teamOptions" :to="overlayTarget" :disabled="s.running || s.analysing" size="small" :aria-label="`${target.name}的队伍`" @update:value="setTeam(target.id, $event)" />
    <NSelect v-else :value="prefs.teams?.[target.id] || []" :options="monOptions" :to="overlayTarget" multiple filterable :disabled="s.running || s.analysing" size="small" placeholder="自动挑自己的两只精灵；也可指定 1–2 只" :aria-label="`${target.name}的队伍`" @update:value="raidTeam(target.id, $event)" />
    <NButton v-if="!target.owned" size="tiny" secondary :disabled="s.running || s.analysing || !target.destinations.length || r.raid.state.busy" :data-testid="`hunt-predict-${target.id}`" @click="predict(target.id)">{{ target.kind === 'raid' ? '模拟并挑选团战阵容' : '模拟这套队伍能否打过' }}</NButton>
    </div>
    <p class="hint">先在游戏的 5 个队伍格里保存队伍，再绑定目标；未绑定则沿用挂机前冒险队或该神兽已有独立队。队伍切换后通过重新进图正式上场。停止挂机会保留当前队伍。</p>
    <p class="hint">团战按期望成功通关的双方总出招数选队，失败出招也计入；没有成功样本的方案暂时跳过。打赢后仍按游戏捕获率继续尝试，直到抓到才切换；天气插队只在战斗结算后进行。尚未读取的团战不会加入补图鉴队列。</p>
    <p v-if="s.analysing" role="status">{{ s.progress }} <NButton size="tiny" :disabled="s.running" @click="t.cancelPrediction">取消模拟</NButton></p>
    <h3>自动吃哪些果子？</h3>
    <NSelect :value="prefs.berries" :options="berryOptions" multiple :to="overlayTarget" :disabled="s.running" placeholder="不选择就不自动消耗果子" aria-label="追踪自动吃果" @update:value="t.setBerries" />
    <p class="hint">只吃你选的果子；同类一次只选一种，新选会替换旧选。已有同类效果时等到期再续吃，缺货后继续追踪，补货后自动恢复。没有可执行的目标时暂不吃。</p>
    <small v-if="s.berryStatus" data-testid="berry-status">{{ s.berryStatus }}</small>
    <h3>天气到了，是否插队？</h3>
    <NRadioGroup v-model:value="prefs.mode" name="hunt-mode" :disabled="s.running" @update:value="t.persist"><NRadioButton value="ordered">不允许插队</NRadioButton><NRadioButton value="interrupt">允许插队</NRadioButton></NRadioGroup>
    <p class="hint">{{ prefs.mode === 'interrupt' ? '优先抓当前天气出现、你还没拥有的稀有怪。抓到或天气结束后，自动回到原目标。' : '持续追踪你选中的目标，不会为天气稀有怪切图。' }}</p>
    <template v-if="prefs.mode === 'interrupt'">
      <NCheckbox :checked="prefs.weather === null" :disabled="s.running" @update:checked="prefs.weather = $event ? null : []; t.persist()">关注所有未拥有的天气稀有怪</NCheckbox>
      <NSelect v-if="prefs.weather !== null" :value="prefs.weather" :options="weatherOptions" multiple filterable :to="overlayTarget" :disabled="s.running" placeholder="只为这些天气怪插队" aria-label="天气插队目标" @update:value="prefs.weather = $event; t.persist()" />
      <div v-if="opportunities.length" class="hunt-weather" data-testid="hunt-weather"><strong>当前天气机会</strong><small v-for="target in opportunities.slice(0, 8)" :key="target.id">{{ target.name }} · {{ wx[target.destinations[0].weather!] || '特殊天气' }} · {{ chapterLabel(target.destinations[0].name) }}</small><small v-if="opportunities.length > 8">还有 {{ opportunities.length - 8 }} 个候选，抓到后会继续挑选</small></div>
      <p v-else class="hint">目前没有关注中的天气机会；挂机时会持续检查。</p>
    </template>
    <NButton v-if="!s.running" block type="primary" :disabled="!prefs.targets.length || s.busy || s.analysing || s.raidBusy || r.hatchery.state.busy || r.raid.state.busy" data-testid="tracker-start" @click="start">开始挂机捕捉</NButton>
    <p class="hint">挂机时让游戏标签页保持可见，可放在独立窗口。隐藏标签页后，游戏离线结算不会遇到游走神兽；恢复可见会自动继续。刷新后需重新开始。</p>
  </template>
  </div>
  <section v-show="view==='reports'" class="tracker-reports">
    <div class="result-heading"><strong>{{ s.analysing ? '正在生成模拟报告' : s.error ? '本次模拟未完成' : resultTargets.length ? '模拟报告已生成' : '尚未生成模拟报告' }}</strong><span class="state-pill" :class="s.analysing?'running':s.error?'error':resultTargets.length?'success':'idle'">{{ s.analysing ? s.progress : `${resultTargets.length} 份结果` }}</span></div>
    <p v-if="s.error && !s.analysing" class="flow-message error">本次请求没有成功生成新报告；以下保留的旧报告不代表本次请求。</p>
    <div v-if="s.analysing" class="progress-summary"><h3>{{ s.progress }}</h3><NButton size="small" :disabled="s.running" @click="t.cancelPrediction">取消模拟</NButton><RaidComparison v-if="s.raidCandidates.length" :candidates="s.raidCandidates" busy /></div>
    <div v-if="!resultTargets.length && !s.analysing" class="empty-result"><span>◇</span><h3>先选择目标和队伍</h3><p>在队列设置中点击目标下的模拟按钮，结果会单独显示在这里。</p><NButton secondary @click="view='setup'">返回队列设置</NButton></div>
    <article v-for="target in resultTargets" :key="target.id" class="task-card hunt-report"><div class="report-title"><h3>{{ target.name }}</h3><span class="state-pill" :class="t.predictionStale(target.id)?'stale':'success'">{{ t.predictionStale(target.id)?'条件已变化':'结果已生成' }}</span></div>
    <div v-if="s.predictions[target.id]" class="hint" :data-testid="`hunt-result-${target.id}`">
      <strong>含道中击败目标 {{ percent(s.predictions[target.id].win.mean) }}</strong> · 95% 区间 {{ percent(s.predictions[target.id].win.low) }}–{{ percent(s.predictions[target.id].win.high) }}<br>
      走到目标 {{ percent(s.predictions[target.id].reach.mean) }} · 平均倒下 {{ s.predictions[target.id].loss.toFixed(2) }} 只 · {{ s.predictions[target.id].trials }} 次模拟<br>
      {{ t.predictionStale(target.id) ? '⚠ 配置、位置或条件已变化，请重新模拟。' : '按最后可遭遇节点测，含此前道中；条件为已遇见该目标，刷新率和捕获率另计。' }}
    </div>
    <div v-if="target.kind === 'raid' && raidPlan(target.id)" class="hint"><strong>完整团战胜率 {{ percent(raidPlan(target.id).report.win.mean) }}</strong> · 95% 区间 {{ percent(raidPlan(target.id).report.win.low) }}–{{ percent(raidPlan(target.id).report.win.high) }}<br>期望成功通关 {{ formatRaidMoves(raidPlan(target.id).report.expectedClearMoves) }}（双方出招均计入）<br>自己的精灵：{{ raidPlan(target.id).report.team.filter(m => !m.ally).map(m => `${m.name} Lv.${m.level}`).join('、') }}<br>队友精灵：{{ raidPlan(target.id).report.team.filter(m => m.ally).map(m => m.name).join('、') }}<br>比较 {{ raidPlan(target.id).candidates }} 组阵容，对前几组各做 512 次验证；轮到任务时核对当天阵容。</div>

      <RaidComparison v-if="target.kind==='raid' && raidPlan(target.id)" :plan="raidPlan(target.id)" />
      <NButton size="small" secondary @click="view='setup'">调整该目标的队伍</NButton>
    </article>
  </section>
  <div class="hunt-status" role="status" data-testid="tracker-status"><NTag v-if="s.running" type="success" size="small">挂机中</NTag><strong>{{ s.phase }}</strong><small v-if="s.job">目标地点：{{ chapterLabel(s.job.destination.name) }}</small><small v-if="s.berryStatus">{{ s.berryStatus }}</small></div>
  <NButton v-if="s.running && s.analysing" size="small" secondary @click="view='reports'">查看当前配队计算 →</NButton>
  <NButton v-if="s.running" block type="warning" data-testid="tracker-stop" @click="t.stop">停止自动切图</NButton>
  <p v-if="s.error" class="storage-error" role="alert">{{ s.error }}</p>
  <template v-if="view==='monitor' && s.logs.length"><h3>运行记录</h3><div v-for="(entry, index) in s.logs.slice(0, 20)" :key="index" class="hunt-log"><small>{{ time(entry.time) }}</small> {{ entry.text }}</div></template>
</template>
