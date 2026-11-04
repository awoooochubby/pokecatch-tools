<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NEmpty, NTag, NProgress } from 'naive-ui';
import type { Runtime } from '../core/runtime';
import { dex, effectiveness, pokemonName, TYPES } from '../core/pokemon';
import { number } from '../core/format';
const { runtime: r } = defineProps<{ runtime: Runtime }>();
const state = r.enemies.state;
const selected = computed(() => state.selected === null ? null : dex[state.selected]);
const groups = computed(() => selected.value ? [4, 2, .5, .25, 0, 1].map(value => ({ value, types: effectiveness(selected.value!.types).filter(x => x.value === value) })).filter(x => x.types.length) : []);
const stage = computed(() => state.showPrevious ? state.previous : state.current);
const ranks = computed(() => Object.entries(stage.value?.rows || {}).sort((a, b) => b[1].damage - a[1].damage));
</script>
<template>
  <div class="section-heading"><h2>当前敌人</h2><NButton text size="small" type="primary" @click="r.enemies.follow">{{ state.pinned ? '恢复跟随战斗' : '正在跟随战斗' }}</NButton></div>
  <p v-if="!r.settings.enemies" class="hint">模块已暂停，当前展示最后采集的数据。</p>
  <div class="chips"><NButton v-for="e in state.enemies" :key="e.uid" size="small" :type="e.id === state.selected ? 'primary' : 'default'" secondary @click="r.enemies.select(e.id)">{{ pokemonName(e.id) }}</NButton></div>
  <template v-if="selected"><h3>{{ selected.name }} <small>{{ selected.types.map(t => TYPES[t]).join(' / ') }}</small></h3><p class="hint">受到各属性攻击时的倍率</p><div v-for="g in groups" :key="g.value" class="type-row" data-testid="type-group"><span class="multiplier">×{{ g.value }}</span><div class="chips"><NTag v-for="t in g.types" :key="t.type" :type="g.value > 1 ? 'warning' : g.value === 0 ? 'info' : 'success'" :bordered="false" size="small">{{ t.label }}</NTag></div></div><p class="hint">仅属性相克；不包含天气、招式、等级和临时效果。未知种类不推测属性。</p></template>
  <NEmpty v-else size="small" description="选择一个敌人查看抗性" />
  <div class="section-heading"><h2>路段伤害排行</h2><div class="actions"><NButton size="tiny" :type="!state.showPrevious ? 'primary' : 'default'" @click="state.showPrevious = false">本段</NButton><NButton size="tiny" :type="state.showPrevious ? 'primary' : 'default'" @click="state.showPrevious = true">上一段</NButton></div></div>
  <p class="hint">{{ stage?.name || '还没有上一段记录' }}{{ stage?.end ? ' → ' + stage.end : '' }}</p>
  <div v-for="([id, row], i) in ranks" :key="id" class="rank" data-testid="rank"><NButton text block @click="r.enemies.select(Number(id))"><span class="rank-line"><span><small>{{ String(i + 1).padStart(2, '0') }}</small> {{ pokemonName(Number(id)) }}</span><strong class="damage">{{ number(row.damage) }}</strong></span></NButton><NProgress type="line" :percentage="row.damage / (ranks[0]?.[1].damage || 1) * 100" :show-indicator="false" :height="3" color="#f0b18b" /></div>
  <NEmpty v-if="!ranks.length" size="small" description="记录到敌方直接伤害后显示排行" />
  <p class="hint">两个中心之间累计，包含溢出伤害。状态伤害不推测来源。未归属：{{ number(stage?.unknown || 0) }}。</p>
  <NButton size="small" :disabled="state.showPrevious" @click="r.enemies.clear">清空本段排行</NButton>
</template>
