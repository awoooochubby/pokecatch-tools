<script setup lang="ts">
import { computed } from 'vue';
import { NCollapse, NCollapseItem, NEmpty, NTag } from 'naive-ui';
import type { Runtime } from '../core/runtime';
import { pokemonName } from '../core/pokemon';
import { number, time } from '../core/format';
const { runtime: r } = defineProps<{ runtime: Runtime }>();
const battles = computed(() => [...r.enemies.state.current.battles].reverse());
</script>
<template>
  <h2>战斗与倒下回顾</h2><p class="hint">当前路段最近 50 场。仅记录实际观察到的消息与飘字，离线过程无法补录。</p>
  <NCollapse><NCollapseItem v-for="(b, index) in battles" :key="`${b.at}-${index}`" :name="index" :title="`${time(b.at)} · ${b.result || '进行中'}`"><p>{{ b.foes.map(pokemonName).join('、') || '敌人未识别' }}</p><div v-for="(k, i) in b.kos" :key="i" class="ko"><NTag size="small" type="error" :bordered="false">{{ k.victim }}倒下</NTag><p>{{ k.cause }} <span class="damage">{{ k.damage ? '−' + number(k.damage) : '' }}</span></p></div><p v-for="(line, i) in b.lines" :key="i" class="log-line">{{ line }}</p></NCollapseItem></NCollapse>
  <NEmpty v-if="!battles.length" size="small" description="尚无当前路段战斗记录" />
  <h2>本轮日志</h2><div class="log-feed"><p v-for="(line, i) in r.experience.state.current?.logs.slice().reverse()" :key="i" class="log-line">{{ line }}</p><p v-if="!r.experience.state.current?.logs.length" class="hint">等待战斗消息</p></div>
  <h2>历史整轮日志</h2><NCollapse><NCollapseItem v-for="(round, i) in [...r.experience.state.history].reverse()" :key="`${round.start}-${i}`" :name="i" :title="`${time(round.start)} · 第 ${round.run} 轮${round.partial ? ' · 部分记录' : ''}`"><p class="hint">{{ round.note }}</p><p v-for="(line, j) in round.logs" :key="j" class="log-line">{{ line }}</p></NCollapseItem></NCollapse>
  <NEmpty v-if="!r.experience.state.history.length" size="small" description="完成整轮后保存历史" />
</template>
