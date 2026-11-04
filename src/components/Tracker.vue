<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NSelect, NRadioGroup, NRadioButton, NCheckbox, NTag } from 'naive-ui';
import type { Runtime } from '../core/runtime';
import { chapterLabel } from '../core/chapters';
import { berryEffects } from '../tracker/berries';
const { runtime: r } = defineProps<{ runtime: Runtime }>();
const t = r.tracker, s = t.state, prefs = t.prefs;
const kinds = { roaming: '游走神兽', zone: '定点神兽', weather: '天气稀有怪' };
const options = computed(() => ['roaming', 'zone', 'weather'].map(kind => ({ type: 'group' as const, label: kinds[kind as keyof typeof kinds], key: kind,
  children: (s.catalog?.targets || []).filter(target => target.kind === kind).map(target => ({ value: target.id, label: `${target.name} · ${target.status}` })) })));
const weatherOptions = computed(() => (s.catalog?.targets || []).filter(target => target.kind === 'weather' && !target.owned).map(target => ({ value: target.id, label: target.name })));
const selected = computed(() => prefs.targets.map(id => s.catalog?.targets.find(target => target.id === id)).filter(target => !!target));
const wx = { snow: '雪天', storm: '雷暴雨', rain: '雨天', sun: '晴天', blizzard: '暴风雪', fog: '雾天', sand: '沙暴', ash: '火山灰', breeze: '微风' } as Record<string, string>;
const opportunities = computed(() => (s.catalog?.targets || []).filter(target => target.kind === 'weather' && !target.owned && target.destinations.length && (prefs.weather === null || prefs.weather.includes(target.id))));
const berryOptions = computed(() => (s.catalog?.berries || []).map(b => ({ value: b.key, label: `${b.name} · ${berryEffects[b.family] || b.family} ×${b.mult} · 库存 ${b.stock}` })));
function updateTargets(ids: number[]) { prefs.targets = ids; t.persist(); }
function move(index: number, delta: number) { const ids = [...prefs.targets]; [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; updateTargets(ids); }
const time = (value: number) => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
</script>
<template>
  <h2>神兽自动追踪</h2>
  <p class="hint">配好冒险队伍，选中目标，剩下的交给追踪器。抓到后自动换目标；没抓到就继续追，位置变化后自动跟随。</p>
  <NButton block secondary :loading="s.busy && !s.catalog" :disabled="s.running || s.busy" data-testid="tracker-load" @click="t.load">读取目标与天气</NButton>
  <template v-if="s.catalog">
    <h3>想抓哪些？</h3>
    <NSelect :value="prefs.targets" :options="options" multiple filterable :to="false" :disabled="s.running" placeholder="搜索并选择神兽／天气稀有怪" aria-label="自动捕捉目标" @update:value="updateTargets" />
    <div v-for="(target, index) in selected" :key="target.id" class="hunt-target" data-testid="hunt-target">
      <div><strong>{{ index + 1 }}. {{ target.name }}</strong><small>{{ target.status }}</small><small v-if="target.destinations[0]">{{ chapterLabel(target.destinations[0].name) }}<template v-if="target.destinations[0].until"> · 约至 {{ time(target.destinations[0].until) }}</template></small></div>
      <div v-if="!s.running" class="actions"><NButton size="tiny" :disabled="index === 0" :aria-label="`上移${target.name}`" @click="move(index, -1)">↑</NButton><NButton size="tiny" :disabled="index === selected.length - 1" :aria-label="`下移${target.name}`" @click="move(index, 1)">↓</NButton></div>
      <NTag v-else-if="target.owned" size="small" type="success">已完成</NTag>
    </div>
    <p class="hint">按顺序处理能抓的目标，未解锁的先等候。神兽独立队伍若与冒险队伍不同，需要先在游戏里配成一致。</p>
    <h3>自动吃哪些果子？</h3>
    <NSelect :value="prefs.berries" :options="berryOptions" multiple :to="false" :disabled="s.running" placeholder="不选择就不自动消耗果子" aria-label="追踪自动吃果" @update:value="t.setBerries" />
    <p class="hint">只吃你选的果子；同类一次只选一种，新选会替换旧选。已有同类效果时等到期再续吃，缺货后继续追踪，补货后自动恢复。没有可执行的目标时暂不吃。</p>
    <small v-if="s.berryStatus" data-testid="berry-status">{{ s.berryStatus }}</small>
    <h3>天气到了，是否插队？</h3>
    <NRadioGroup v-model:value="prefs.mode" name="hunt-mode" :disabled="s.running" @update:value="t.persist"><NRadioButton value="ordered">不允许插队</NRadioButton><NRadioButton value="interrupt">允许插队</NRadioButton></NRadioGroup>
    <p class="hint">{{ prefs.mode === 'interrupt' ? '优先抓当前天气出现、你还没拥有的稀有怪。抓到或天气结束后，自动回到原目标。' : '持续追踪你选中的目标，不会为天气稀有怪切图。' }}</p>
    <template v-if="prefs.mode === 'interrupt'">
      <NCheckbox :checked="prefs.weather === null" :disabled="s.running" @update:checked="prefs.weather = $event ? null : []; t.persist()">关注所有未拥有的天气稀有怪</NCheckbox>
      <NSelect v-if="prefs.weather !== null" :value="prefs.weather" :options="weatherOptions" multiple filterable :to="false" :disabled="s.running" placeholder="只为这些天气怪插队" aria-label="天气插队目标" @update:value="prefs.weather = $event; t.persist()" />
      <div v-if="opportunities.length" class="hunt-weather" data-testid="hunt-weather"><strong>当前天气机会</strong><small v-for="target in opportunities.slice(0, 8)" :key="target.id">{{ target.name }} · {{ wx[target.destinations[0].weather!] || '特殊天气' }} · {{ chapterLabel(target.destinations[0].name) }}</small><small v-if="opportunities.length > 8">还有 {{ opportunities.length - 8 }} 个候选，抓到后会继续挑选</small></div>
      <p v-else class="hint">目前没有关注中的天气机会；挂机时会持续检查。</p>
    </template>
    <div class="hunt-status" role="status" data-testid="tracker-status"><NTag v-if="s.running" type="success" size="small">挂机中</NTag><strong>{{ s.phase }}</strong><small v-if="s.job">目标地点：{{ chapterLabel(s.job.destination.name) }}</small></div>
    <NButton v-if="!s.running" block type="primary" :disabled="!prefs.targets.length || s.busy || r.raid.state.busy" data-testid="tracker-start" @click="t.start">开始挂机捕捉</NButton>
    <NButton v-else block type="warning" data-testid="tracker-stop" @click="t.stop">停止自动切图</NButton>
    <p class="hint">挂机时让游戏标签页保持可见，可放在独立窗口。隐藏标签页后，游戏离线结算不会遇到游走神兽；恢复可见会自动继续。刷新后需重新开始。</p>
  </template>
  <p v-if="s.error" class="storage-error" role="alert">{{ s.error }}</p>
  <template v-if="s.logs.length"><h3>追踪记录</h3><div v-for="(entry, index) in s.logs.slice(0, 20)" :key="index" class="hunt-log"><small>{{ time(entry.time) }}</small> {{ entry.text }}</div></template>
</template>
