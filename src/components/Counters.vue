<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NAlert, NButton, NCollapse, NCollapseItem, NInput, NInputNumber, NProgress, NSelect, NSwitch, NTag } from 'naive-ui';
import type { Runtime } from '../core/runtime';
import type { Options, Estimate } from '../simulation/types';
import { pokemonName } from '../core/pokemon';
import { estimateWork, parseCustomTargets, SAMPLE_BUDGET } from '../simulation/planning';
const { runtime: r } = defineProps<{ runtime: Runtime }>();
const c = r.counters, s = c.state;
type Preferences = { mode: string; candidates: string[]; targets: string[]; custom: string; trials: number; seed: number; full: boolean; maxLoss: number; minWin: number; auto: Options['autoSwitch']; snapshotAt: number };
const saved = r.store.get<Partial<Preferences>>('counterPreferences', {});
const strings = (v: unknown): string[] => Array.isArray(v) && v.every(x => typeof x === 'string') ? v : [];
const numeric = (v: unknown, fallback: number, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
const mode = ref(['matrix','levels','route','order'].includes(saved.mode || '') ? saved.mode! : 'matrix');
const candidates = ref(strings(saved.candidates)), targets = ref(strings(saved.targets)), custom = ref(typeof saved.custom === 'string' ? saved.custom : '');
const trials = ref(Math.floor(numeric(saved.trials, 1024, 128, 8192))), seed = ref(Math.floor(numeric(saved.seed, 1729, 0, 4294967295)));
const full = ref(saved.full !== false), maxLoss = ref(numeric(saved.maxLoss, 30, 0, 100)), minWin = ref(numeric(saved.minWin, 95, 0, 100));
const auto = ref<Options['autoSwitch']>(['current','on','off'].includes(saved.auto || '') ? saved.auto! : 'current');
const snapshotAt = ref(saved.snapshotAt || 0);
watch([mode,candidates,targets,custom,trials,seed,full,maxLoss,minWin,auto,snapshotAt], () => {
  r.store.set('counterPreferences', { mode:mode.value,candidates:candidates.value,targets:targets.value,custom:custom.value,trials:trials.value,seed:seed.value,full:full.value,maxLoss:maxLoss.value,minWin:minWin.value,auto:auto.value,snapshotAt:snapshotAt.value });
}, {deep:true});
const modes = [{ label: 'Box 对各敌人的战损', value: 'matrix' }, { label: '逐级寻找升级门槛', value: 'levels' }, { label: '剩余路线连续战', value: 'route' }, { label: '全局队伍排序比较', value: 'order' }];
const candidateLabel = (uid: string) => {
  const m = (s.report?.catalog || s.catalog)?.candidates.find(m => m.uid === uid);
  return m ? `${pokemonName(m.id)} Lv.${m.level}${m.shiny ? ' ✦' : ''}${m.rank ? ' 地下+' + m.rank : ''}` : '未知精灵';
};
const statusLabels: Record<string,string> = {burn:'灼伤',poison:'中毒',sleep:'睡眠',freeze:'冰冻',paralysis:'麻痹'};
const candidateOptions = computed(() => (s.catalog?.candidates || []).map(m => ({ label: `${candidateLabel(m.uid)} · HP ${m.hp}/${m.maxHp}${m.status ? ' · ' + (statusLabels[m.status] || m.status) : ''}${m.reason ? ' · ' + m.reason : ''}`, value: m.uid, disabled: !m.eligible })));
const targetOptions = computed(() => (s.catalog?.targets || []).map(t => ({ label: t.label.replace(/· ([^·]+) Lv\./, `· ${pokemonName(t.id)} Lv.`), value: t.key })));
watch(() => s.catalog, catalog => {
  if (!catalog) return;
  if (snapshotAt.value === catalog.capturedAt) return;
  candidates.value = candidates.value.filter(uid => catalog.candidates.some(m => m.uid === uid && m.eligible));
  if (!candidates.value.length) candidates.value = catalog.activeOrder.filter(uid => catalog.candidates.some(m => m.uid === uid && m.eligible));
  if (!candidates.value.length) candidates.value = catalog.candidates.filter(m => m.eligible).slice(0, 6).map(m => m.uid);
  targets.value = targets.value.filter(key => catalog.targets.some(t => t.key === key));
  if (!targets.value.length && !custom.value.trim()) targets.value = catalog.targets.filter(t => t.key.startsWith('current:')).map(t => t.key);
  if (!targets.value.length && !custom.value.trim() && catalog.targets.length) targets.value = [catalog.targets[0].key];
  snapshotAt.value = catalog.capturedAt;
}, {immediate:true});
const routeMode = computed(() => ['route', 'order'].includes(mode.value));
function move(i: number, offset: number) { const xs = [...candidates.value], j = i + offset; if (j < 0 || j >= xs.length) return; [xs[i], xs[j]] = [xs[j], xs[i]]; candidates.value = xs; }
function options(): Options {
  return { mode: routeMode.value ? mode.value as 'route' | 'order' : 'matrix', candidateUids: candidates.value, targetKeys: targets.value,
    trials: trials.value, seed: seed.value, start: full.value ? 'full' : 'current', scanLevels: mode.value === 'levels', sequence: false,
    autoSwitch: auto.value, maxLoss: maxLoss.value / 100, minWin: minWin.value / 100 };
}
const workload = computed(() => {
  if (!s.catalog) return null;
  try { return estimateWork(s.catalog, options(), routeMode.value ? 0 : parseCustomTargets(custom.value).length); }
  catch { return null; }
});
function submit() { try { c.run(options(), routeMode.value ? [] : parseCustomTargets(custom.value)); } catch (e) { s.error = (e as Error).message; } }
const pct = (n: number) => (100 * n).toFixed(1) + '%';
const interval = (e: Estimate) => `${pct(e.mean)}（${pct(e.low)}–${pct(e.high)}）`;
const results = computed(() => {
  const all = s.report?.results || [];
  if (!s.report?.options.scanLevels) return [...all].sort((a, b) => Number(b.qualified) - Number(a.qualified) || b.win.low - a.win.low || a.loss.high - b.loss.high);
  const groups = new Map<string, typeof all>();
  for (const row of all) { const key = JSON.stringify([row.uid,row.target]); groups.set(key, [...(groups.get(key) || []), row]); }
  return [...groups.values()].map(rows => rows.find(r => r.qualified) || rows.at(-1)!);
});
const routes = computed(() => [...s.report?.routes || []].sort((a, b) => Number(b.qualified) - Number(a.qualified) || b.win.low - a.win.low || a.wear.mean - b.wear.mean || a.kos.mean - b.kos.mean));
function exportReport() {
  if (!s.report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(s.report, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'pokecatch-counter-analysis.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>
<template>
  <h2>对策与全局战损</h2>
  <p class="hint">读取本机 box，在独立进程运行游戏原引擎。确定的速度和伤害逐项计算，完整战损期望附抽样误差。</p>
  <div class="actions"><NButton type="primary" secondary :disabled="s.busy" data-testid="load-box" @click="c.load">读取当前 Box</NButton><NButton v-if="s.busy" size="small" @click="c.cancel">取消</NButton></div>
  <NAlert v-if="s.error" type="error" :show-icon="false" style="margin:12px 0">{{ s.error }}</NAlert>
  <template v-if="s.catalog">
    <p class="hint">{{ s.catalog.chapter }} · 上限 {{ s.catalog.cap }} · {{ s.catalog.candidates.length }} 只 · 引擎 {{ s.catalog.version }}<br>快照：{{ new Date(s.catalog.capturedAt).toLocaleString() }}，游戏变化后请重新读取。</p>
    <NSelect v-model:value="mode" :options="modes" :to="false" :disabled="s.busy" aria-label="分析模式" />
    <h3>候选精灵（{{ candidates.length }}）</h3>
    <NSelect v-model:value="candidates" :options="candidateOptions" multiple filterable :to="false" :disabled="s.busy" aria-label="候选精灵" />
    <NButton text size="small" :disabled="s.busy" @click="candidates = s.catalog!.candidates.filter(m => m.eligible).map(m => m.uid)">选择全部可用 Box</NButton>
    <NButton text size="small" :disabled="s.busy" data-testid="restore-team" @click="candidates = s.catalog!.activeOrder.filter(uid => s.catalog!.candidates.some(m => m.uid === uid && m.eligible)); auto = 'current'">恢复当前出战队伍</NButton>
    <template v-if="routeMode"><p class="hint">以下为测试队伍顺序。它对应出战队伍，不是仓库排序；最多六只。</p><div v-for="(uid, i) in candidates" :key="uid" class="split"><span>{{ i + 1 }}. {{ pokemonName(s.catalog.candidates.find(m => m.uid === uid)!.id) }}</span><div class="actions"><NButton size="tiny" :disabled="i === 0 || s.busy" @click="move(i, -1)">上移</NButton><NButton size="tiny" :disabled="i === candidates.length - 1 || s.busy" @click="move(i, 1)">下移</NButton></div></div><p class="hint">按实际剩余节点连续作战，保留血量和状态，中心节点正常治疗；不额外回城。未确认的赠送或特殊战斗会明确停止。</p><NSelect v-if="mode === 'route'" v-model:value="auto" :to="false" :options="[{label:'保持游戏自动切换设置',value:'current'},{label:'假设开启自动切换',value:'on'},{label:'假设关闭自动切换',value:'off'}]" /></template>
    <template v-else><h3>环境敌人</h3><NSelect v-model:value="targets" :options="targetOptions" multiple filterable :to="false" :disabled="s.busy" aria-label="环境敌人" /><NButton text size="small" :disabled="s.busy" @click="targets = s.catalog!.targets.map(t => t.key)">选择全部道中目标</NButton><h3>另指定野生目标（可选）</h3><NInput v-model:value="custom" placeholder="图鉴编号:等级，例如 478:52, 460:50" :disabled="s.busy" /><p class="hint">指定目标按普通野生倍率；道馆目标请从列表选择，保留原队伍规模和道馆倍率。单挑列表相互独立，不等于连续清图。</p></template>
    <div class="setting-row"><span>我方从满血且无异常开始</span><NSwitch v-model:value="full" :disabled="s.busy" aria-label="满血开始" /></div><p class="hint">关闭则使用我方实际血量和异常。当前目标保留敌人的实际血量；单挑重新建立行动队列，路线模式保留已有队列。排序假设从当前位置生效，实际调整可能要下次出发才生效。</p>
    <div class="setting-row"><span>每组样本数</span><NInputNumber v-model:value="trials" :min="128" :max="8192" :step="128" :precision="0" style="width:145px" :disabled="s.busy" /></div>
    <div class="setting-row"><span>要求胜率至少（%）</span><NInputNumber v-model:value="minWin" :min="0" :max="100" style="width:120px" :disabled="s.busy" /></div><div class="setting-row"><span>可接受期望损失（%）</span><NInputNumber v-model:value="maxLoss" :min="0" :max="100" style="width:120px" :disabled="s.busy" /></div>
    <p v-if="mode === 'levels'" class="hint">逐整数等级测到当前上限，不假设战损随等级单调下降。优先看第一个有置信余量的达标等级；建议每次选择 1–3 只。</p>
    <p v-if="workload" class="hint" data-testid="workload">预计 {{ workload.groups.toLocaleString() }} 组 · {{ workload.samples.toLocaleString() }} 条样本</p>
    <NAlert v-if="workload?.overBudget" type="warning" :show-icon="false">超过每批 {{ SAMPLE_BUDGET.toLocaleString() }} 条样本；请减少候选、目标或样本数后开始。</NAlert>
    <NButton block type="primary" :disabled="s.busy || workload?.overBudget" data-testid="run-counters" @click="submit">{{ mode === 'order' ? '比较当前策略与换位策略' : '开始计算' }}</NButton>
  </template>
  <p v-if="s.busy || s.phase.startsWith('已取消')" class="hint">{{ s.phase }}<template v-if="s.busy"> · {{ s.completed }}/{{ s.total || '?' }}</template></p><NProgress v-if="s.busy && s.total" type="line" :percentage="Math.round(100 * s.completed / s.total)" />
  <template v-if="s.report">
    <NAlert v-if="s.phase !== '计算完成'" type="warning" :show-icon="false" style="margin-top:12px">只展示已完成的组；本次分析尚未完整结束，不能据此判断全量最优。</NAlert>
    <div class="section-heading"><h2>分析结果</h2><NButton size="small" @click="exportReport">导出完整报告</NButton></div>
    <p class="hint">战损为结束时缺失 HP 占初始最大 HP 的比例，失败同样计入；路线同时报告累计承伤，避免治疗把成本掩盖。区间为 95% 抽样区间，不是保证。</p>
    <p v-if="s.report.search" class="hint">{{ s.report.search }}</p>
    <NCollapse><NCollapseItem v-for="(row, i) in results" :key="`${row.uid}-${row.target}-${row.level}`" :name="i" :title="`${pokemonName(row.id)} Lv.${row.level} · ${row.qualified ? '达到门槛' : '未达到门槛'}`"><p>{{ row.target }}</p><p v-if="row.trainingXp" class="hint">升到此等级还需 {{ row.trainingXp.toLocaleString() }} XP（按当前存档经验表，保持物种不变）。</p><p>胜率 {{ interval(row.win) }}<br>期望战损 {{ interval(row.loss) }}</p><NTag size="small" :bordered="false">{{ row.facts.order }} · {{ row.facts.speed }} / {{ row.facts.enemySpeed }}</NTag><p class="hint">伤害招式 {{ row.facts.move }}：非暴击命中 {{ row.facts.damage.join('–') }}，敌 HP {{ row.facts.enemyHp }}。实际行动仍可能使用状态招式。</p><p class="hint">获胜样本中命中次数：{{ Object.entries(row.hits).map(([hits, count]) => `${hits} 下 ${count} 次`).join('；') }}。总样本 {{ row.trials }}，平均攻击行动 {{ row.actions.mean.toFixed(2) }}。</p></NCollapseItem></NCollapse>
    <NCollapse><NCollapseItem v-for="(row, i) in routes" :key="`${row.order.join(',')}:${row.autoSwitch}`" :name="i" :title="`${row.baseline ? '测试基线 · ' : ''}自动切换${row.autoSwitch ? '开' : '关'} · 通过 ${pct(row.win.mean)} · ${row.qualified ? '达标' : '未达标'}`"><p>{{ row.order.map(candidateLabel).join(' → ') }}</p><p>通过率 {{ interval(row.win) }}<br>最终期望战损 {{ interval(row.loss) }}<br>累计承伤 {{ interval(row.wear) }}<br>累计倒下期望 {{ row.kos.mean.toFixed(2) }} 次</p><p class="hint">{{ row.trials }} 条随机路线样本。各方案使用相同初始种子；概率相近且区间重叠时，不认定优劣。排序不会自动写入游戏。</p></NCollapseItem></NCollapse>
    <NCollapse style="margin-top:16px"><NCollapseItem title="计算条件与边界" name="assumptions"><p v-for="line in s.report.assumptions" :key="line" class="hint">{{ line }}</p></NCollapseItem></NCollapse>
  </template>
</template>
