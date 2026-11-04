<script setup lang="ts">
import { NButton, NInputNumber, NSwitch } from 'naive-ui';
import type { Runtime } from '../core/runtime';
import pkg from '../../package.json';
const { runtime: r } = defineProps<{ runtime: Runtime }>();
function exportData() {
  const blob = new Blob([JSON.stringify({ version: pkg.version, ...r.store.export(), currentRound: r.experience.state.current }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'pokecatch-tools-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function limit(value: number | null) { r.experience.state.limit = Math.max(1, Math.min(100, Math.floor(value || 20))); r.experience.persist(); }
</script>
<template>
  <h2>功能模块</h2><div class="setting-row"><div><strong>经验统计</strong><small>队伍效率、升级估算与整轮日志</small></div><NSwitch :value="r.settings.experience" aria-label="经验统计" @update:value="r.setEnabled('experience', $event)" /></div><div class="setting-row"><div><strong>敌情与战斗回顾</strong><small>属性弱点、伤害排行与倒下来源</small></div><NSwitch :value="r.settings.enemies" aria-label="敌情与战斗回顾" @update:value="r.setEnabled('enemies', $event)" /></div>
  <p class="hint">关闭模块会停止相应统计，保留历史。重新启用从当前状态采集，缺失过程不会猜测补录。</p>
  <div class="setting-row"><div><strong>刷图效率实测</strong><small>控制实测采集；模拟选图可单独使用</small></div><NSwitch :value="r.settings.farming" aria-label="刷图效率统计" @update:value="r.setEnabled('farming', $event)" /></div>
  <NButton size="small" secondary @click="r.settings.farmingVisible = true; r.settings.farmingFolded = false; r.saveSettings()">打开刷图经验浮窗</NButton>
  <h2>数据管理</h2><div class="setting-row"><span>保留整轮历史</span><NInputNumber :value="r.experience.state.limit" :min="1" :max="100" :precision="0" style="width:120px" aria-label="保留整轮历史" @update:value="limit" /></div><NButton block secondary data-testid="export" @click="exportData">导出记录与备份</NButton>
  <p class="hint">旧版存储在首次升级时复制，原数据不会删除。备份不包含游戏存档。</p>
  <h2>关于助手</h2><div class="setting-row"><span>PokeCatch Tools</span><strong>v{{ pkg.version }}</strong></div><p class="hint">经验、敌情与安装包使用统一版本。统计和模拟只读取数据；追踪器在你点击开始后自动操作游戏地图。不上传记录。</p><p class="hint">重新加载页面后，追踪任务保留，需要重新点击开始。</p>
</template>
