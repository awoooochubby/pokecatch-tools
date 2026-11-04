<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NCard, NEmpty, NTag } from 'naive-ui';
import type { Runtime } from '../core/runtime';
import { duration, number } from '../core/format';
import { dex, effectiveness, pokemonName } from '../core/pokemon';
const { runtime: r } = defineProps<{ runtime: Runtime }>();
defineEmits<{ navigate: [tab: string] }>();
const session = computed(() => r.experience.state.session);
const elapsed = computed(() => session.value.start === null ? 0 : Math.max(0, r.status.now - session.value.start));
const rate = computed(() => elapsed.value > 0 ? session.value.total * 60000 / elapsed.value : 0);
const threat = computed(() => {
  const e = r.enemies.state.enemies[0];
  return e ? { name: pokemonName(e.id), weak: dex[e.id] ? effectiveness(dex[e.id].types).filter(x => x.value > 1) : [] } : null;
});
const latestKo = computed(() => [...r.enemies.state.current.battles, ...(r.enemies.state.previous?.battles || [])].flatMap(b => b.kos.map(k => ({ ...k, at: b.at }))).sort((a, b) => b.at - a.at)[0]);
</script>
<template>
  <div class="eyebrow">本次冒险 · 效率概览</div>
  <div class="hero-stat" data-testid="xp-rate">{{ session.partial ? '≥ ' : '' }}{{ number(rate) }}<span>XP / 分钟</span></div>
  <div class="stat-grid"><div><small>累计经验</small><strong data-testid="xp-total">{{ number(session.total) }} XP</strong></div><div><small>累计时长</small><strong>{{ duration(elapsed) }}</strong></div></div>
  <p class="hint">{{ r.settings.experience ? '含等待、暂停与关闭页面的时长。跨级和漏采仅计已确认经验。' : '经验模块已暂停；恢复后将标记采样缺失。' }}</p>
  <NCard size="small" title="当前敌情" class="section-card">
    <template v-if="r.settings.enemies && threat"><div class="card-title">{{ threat.name }}</div><div class="chips"><NTag v-for="t in threat.weak" :key="t.type" size="small" :bordered="false" type="warning">{{ t.label }} ×{{ t.value }}</NTag></div><p class="hint">优先参考弱点属性；这里只计算属性相克，不包含招式、等级和临时效果。</p></template>
    <NEmpty v-else size="small" :description="r.settings.enemies ? '等待下一场战斗' : '敌情模块已暂停'" />
    <template #action><NButton text type="primary" @click="$emit('navigate', 'enemies')">查看完整敌情 →</NButton></template>
  </NCard>
  <NCard v-if="latestKo" size="small" title="最近倒下的队员" class="section-card"><strong>{{ latestKo.victim }}</strong><p>{{ latestKo.cause }} <span class="damage">{{ latestKo.damage ? '−' + number(latestKo.damage) : '' }}</span></p><NButton text type="primary" @click="$emit('navigate', 'review')">查看战斗回顾 →</NButton></NCard>
  <div class="tip"><span>探索建议</span><p>连续倒下时先查看伤害来源，再调整队伍属性；不要只凭经验总量判断刷图效率。</p></div>
</template>
