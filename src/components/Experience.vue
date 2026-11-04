<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NCard, NCollapse, NCollapseItem, NEmpty, NProgress, NTag } from 'naive-ui';
import type { Runtime } from '../core/runtime';
import { duration, number, time } from '../core/format';
import { activeTeam } from '../core/game';
const { runtime: r } = defineProps<{ runtime: Runtime }>();
const state = r.experience.state;
const mons = computed(() => (state.save ? activeTeam(state.save) : []).flatMap(uid => {
  const m = state.save?.mons.find(x => x.uid === uid); if (!m) return [];
  const entry = state.session.mons[uid], elapsed = entry ? state.now - entry.start : 0;
  const rate = entry && elapsed >= 10000 ? entry.total * 60000 / elapsed : 0;
  const pct = r.game.xpPercent(uid), remaining = pct > 0 && pct < 100 ? m.xp * (100 / pct - 1) : NaN;
  return [{ ...m, name: r.game.monName(uid, m.id), pct: Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : null, rate, partial: entry?.partial,
    eta: state.save?.adv.paused ? '已暂停' : m.level >= 100 || pct === 100 ? '满级或等级上限' : rate > 0 && Number.isFinite(remaining) ? '约 ' + duration(remaining * 60000 / rate) : '采样中 / 暂无经验增长' }];
}));
const battles = computed(() => [ ...(state.active ? [state.active] : []), ...state.battles.slice().reverse() ]);
function reset() { r.store.set('previousSession', { total: state.session.total, elapsed: state.session.start === null ? 0 : state.now - state.session.start, partial: state.session.partial }); r.experience.reset(); }
const comparison = computed(() => {
  // Depend on current session so a reset refreshes the stored baseline.
  const now = state.now, current = state.session;
  const prev = r.store.get<{ total: number; elapsed: number; partial: boolean } | null>('previousSession', null);
  if (!prev || prev.elapsed <= 0 || prev.total <= 0 || current.start === null || now <= current.start) return null;
  return { percent: ((current.total * 60000 / (now - current.start)) / (prev.total * 60000 / prev.elapsed) - 1) * 100, partial: prev.partial || current.partial };
});
</script>
<template>
  <div class="section-heading"><div><h2>队伍经验</h2><small>逐只查看当前等级进度</small></div><NTag v-if="!r.settings.experience" type="warning">已暂停</NTag></div>
  <NCard v-for="m in mons" :key="m.uid" size="small" class="section-card"><div class="split"><strong>{{ m.name }}</strong><small>Lv.{{ m.level }}</small></div><NProgress v-if="m.pct !== null" type="line" :percentage="m.pct" :show-indicator="false" :height="5" color="#87d9b1" class="xp-progress" /><div class="split"><span>{{ number(m.xp) }} XP</span><span class="accent">{{ m.partial ? '≥ ' : '' }}{{ number(m.rate) }} XP/分</span></div><p class="hint">下一级：{{ m.eta }}{{ m.partial ? ' · 根据已确认经验估算' : '' }}</p></NCard>
  <NEmpty v-if="!mons.length" description="等待队伍存档" />
  <p v-if="comparison" class="hint" data-testid="comparison">比上次统计{{ comparison.percent >= 0 ? '提高' : '降低' }} {{ number(Math.abs(comparison.percent)) }}%{{ comparison.partial ? '（含下界数据，仅供参考）' : '' }}。不同队伍和等级会影响对比。</p>
  <div class="actions"><NButton size="small" data-testid="reset-rate" @click="reset">开始新一次统计</NButton></div>
  <p class="hint">手动重置累计经验和计时，保留战斗历史。非战斗来源经验也可能计入。</p>
  <h2>最近 50 场经验</h2>
  <NCollapse><NCollapseItem v-for="b in battles" :key="b.start" :name="b.start" :title="`${b.end ? time(b.end) : '本场进行中'} · ${b.partial ? '至少 ' : '+'}${number(b.total)} XP`"><div v-for="(m, uid) in b.mons" :key="uid" class="split"><span>{{ m.name }}</span><span>+{{ number(m.xp) }} XP</span></div><p class="hint">{{ b.partial ? '中途接入、跨级或采样缺失；无法确认完整单场。' : '完整采样' }}</p></NCollapseItem></NCollapse>
  <NEmpty v-if="!battles.length" size="small" description="完成战斗后显示每场经验" />
</template>
