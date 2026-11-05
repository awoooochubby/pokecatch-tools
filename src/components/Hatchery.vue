<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NSwitch, NTag } from 'naive-ui';
import type { Runtime } from '../core/runtime';
import { pokemonName } from '../core/pokemon';
const { runtime: r } = defineProps<{ runtime: Runtime }>();
const h = r.hatchery, s = h.state;
const ready = computed(() => s.eggs.filter(e => e.ready).length);
const shiny = computed(() => s.eggs.filter(e => e.shiny === true).length);
const blocked = computed(() => s.busy || r.raid.state.busy || !r.tracker.uiAvailable());
const duration = (ms: number) => { const sec = Math.ceil(ms / 1000); return sec >= 3600 ? `${Math.floor(sec / 3600)}时${Math.ceil(sec % 3600 / 60)}分` : sec >= 60 ? `${Math.floor(sec / 60)}分${sec % 60}秒` : `${sec}秒`; };
const time = (t: number) => new Date(t).toLocaleString('zh-CN', { hour12: false });
</script>
<template>
  <section data-testid="hatchery">
    <div class="section-heading"><div><span class="eyebrow">培育屋</span><h3>孵蛋与自动领取</h3></div><NTag size="small" :type="h.prefs.enabled ? 'success' : 'default'">{{ h.prefs.enabled ? '自动收蛋已开启' : '手动领取' }}</NTag></div>
    <p class="hint">闪光在生蛋时已确定，孵化沿用原值。这里直接读取现有蛋数据；新生蛋由游戏自动放入孵蛋栏。</p>
    <div class="result-metrics"><div class="metric-card"><small>正在孵的蛋</small><strong>{{ s.eggs.length }}</strong><span>{{ ready }} 枚成熟可领</span></div><div class="metric-card emphasis"><small>其中闪光蛋</small><strong data-testid="egg-shiny-count">{{ shiny }}</strong><span>未孵化也能确认</span></div></div>
    <div class="form-section"><div class="split"><label for="auto-eggs">成熟后自动收蛋</label><NSwitch id="auto-eggs" :value="h.prefs.enabled" aria-label="成熟后自动收蛋" @update:value="h.setEnabled" /></div><p class="hint">在战斗间隙领取全部成熟蛋，确认结果后返回原页面，可以与自动追踪一起使用。重复精灵按游戏原规则转为家族经验。</p><NButton type="primary" block :disabled="blocked || !ready" :loading="s.busy" data-testid="eggs-collect" @click="h.collect()">一键领取成熟蛋{{ ready ? `（${ready}）` : '' }}</NButton></div>
    <NButton v-if="s.waiting" size="small" secondary @click="h.cancel">取消预约收蛋</NButton>
    <p class="flow-message" :class="s.error ? 'stale' : ''" data-testid="eggs-status" role="status">{{ s.phase }}</p><p v-if="s.error" class="storage-error" role="alert">{{ s.error }}</p>
    <div class="raid-setup-list">
      <div v-for="egg in s.eggs" :key="egg.uid" class="task-card egg-card" :class="{ 'shiny-egg': egg.shiny }" data-testid="egg-row" :data-egg="egg.uid">
        <div class="split"><strong>{{ pokemonName(egg.id) }}</strong><NTag size="small" :type="egg.shiny === true ? 'warning' : egg.shiny === null ? 'error' : 'default'" data-testid="egg-shiny">{{ egg.shiny === true ? '★ 闪光蛋' : egg.shiny === false ? '普通蛋' : '闪光信息缺失' }}</NTag></div>
        <p>{{ egg.ready ? '已成熟 · 可以领取' : `剩余 ${duration(egg.remaining)}` }}</p><small class="hint">生蛋 {{ time(egg.laidAt) }}<br>成熟 {{ time(egg.hatchAt) }}</small>
        <div v-if="egg.ready" class="actions"><NButton size="small" secondary :disabled="blocked" @click="h.collect(egg.uid)">领取这枚蛋</NButton></div>
      </div>
    </div>
    <p v-if="!s.eggs.length" class="empty">目前没有正在孵化的蛋。游戏保存后会自动更新。</p>
    <p v-if="s.lastReceived" class="hint">最近领取 {{ time(s.lastReceived) }} · 本次运行累计 {{ s.received }} 枚</p>
  </section>
</template>
