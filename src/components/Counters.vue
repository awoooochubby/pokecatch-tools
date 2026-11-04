<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { NAlert, NButton, NCollapse, NCollapseItem, NInput, NInputNumber, NProgress, NSelect, NSwitch, NTag } from 'naive-ui';
import type { Runtime } from '../core/runtime';
import type { Options, Estimate } from '../simulation/types';
import { dex, pokemonName } from '../core/pokemon';
import { chapterLabel } from '../core/chapters';
import { estimateWork, parseCustomTargets, SAMPLE_BUDGET } from '../simulation/planning';
const { runtime: r } = defineProps<{ runtime: Runtime }>();
const c = r.counters, s = c.state;
type Preferences = { mode: string; candidates: string[]; targets: string[]; custom: string; trials: number; seed: number; full: boolean; maxLoss: number; minWin: number; auto: Options['autoSwitch']; snapshotAt: number; snapshotChapter?: number; enemySource?: string };
const saved = r.store.get<Partial<Preferences>>('counterPreferences', {});
const strings = (v: unknown): string[] => Array.isArray(v) && v.every(x => typeof x === 'string') ? v : [];
const numeric = (v: unknown, fallback: number, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
const mode = ref(['matrix','levels','route','order'].includes(saved.mode || '') ? saved.mode! : 'matrix');
const candidates = ref(strings(saved.candidates)), targets = ref(strings(saved.targets)), custom = ref(typeof saved.custom === 'string' ? saved.custom : '');
const trials = ref(Math.floor(numeric(saved.trials, 256, 128, 8192))), seed = ref(Math.floor(numeric(saved.seed, 1729, 0, 4294967295)));
const full = ref(saved.full !== false), maxLoss = ref(numeric(saved.maxLoss, 30, 0, 100)), minWin = ref(numeric(saved.minWin, 95, 0, 100));
const auto = ref<Options['autoSwitch']>(['current','on','off'].includes(saved.auto || '') ? saved.auto! : 'current');
const snapshotAt = ref(saved.snapshotAt || 0), snapshotChapter = ref(saved.snapshotChapter);
const enemySource=ref(['current','chapter','manual','diagnostic'].includes(saved.enemySource || '')?saved.enemySource!:'current');
const manualId=ref<number|null>(null), manualLevel=ref(50);
const advanced=ref(false);
const pickEl=ref<HTMLElement>(),reasonEl=ref<HTMLElement>(),routeHeadingEl=ref<HTMLElement>();
watch(()=>s.phase,async phase=>{if(phase!=='计算完成')return;await nextTick();if(s.phase==='计算完成')(s.report?.options.mode==='matrix'?pickEl.value:reasonEl.value||routeHeadingEl.value)?.scrollIntoView({block:'start',behavior:'smooth'});});
watch([mode,candidates,targets,custom,trials,seed,full,maxLoss,minWin,auto,snapshotAt,snapshotChapter,enemySource], () => {
  r.store.set('counterPreferences', { mode:mode.value,candidates:candidates.value,targets:targets.value,custom:custom.value,trials:trials.value,seed:seed.value,full:full.value,maxLoss:maxLoss.value,minWin:minWin.value,auto:auto.value,snapshotAt:snapshotAt.value,snapshotChapter:snapshotChapter.value,enemySource:enemySource.value });
}, {deep:true});
const modes = [{ label: 'Box 对各敌人的战损', value: 'matrix' }, { label: '逐级寻找升级门槛', value: 'levels' }, { label: '剩余路线连续战', value: 'route' }, { label: '全局队伍排序比较', value: 'order' }];
const candidateLabel = (uid: string) => {
  const m = (s.report?.catalog || s.catalog)?.candidates.find(m => m.uid === uid);
  return m ? `${pokemonName(m.id)} Lv.${m.level}${m.shiny ? ' ✦' : ''}${m.rank ? ' 地下+' + m.rank : ''}` : '未知精灵';
};
const statusLabels: Record<string,string> = {burn:'灼伤',poison:'中毒',sleep:'睡眠',freeze:'冰冻',paralysis:'麻痹'};
const candidateOptions = computed(() => (s.catalog?.candidates || []).map(m => ({ label: `${candidateLabel(m.uid)} · HP ${m.hp}/${m.maxHp}${m.status ? ' · ' + (statusLabels[m.status] || m.status) : ''}${m.reason ? ' · ' + m.reason : ''}`, value: m.uid, disabled: !m.eligible })));
const currentTargets=computed(()=>(s.catalog?.targets||[]).filter(t=>t.source==='current'));
const availableTargets=computed(()=>(s.catalog?.targets||[]).filter(t=>enemySource.value==='diagnostic'?t.source==='diagnostic':enemySource.value==='current'&&currentTargets.value.length?t.source==='current':t.source!=='current'&&t.source!=='diagnostic'));
const targetOptions=computed(()=>availableTargets.value.map(t=>({value:t.key,label:`${t.source==='current'?'本场':t.source==='wild'?'可能遇到':t.source==='diagnostic'?'路线反例':t.kind==='trainer'?'训练家':'首领'}${t.nodeIndex!==undefined&&t.source!=='current'?` 第${t.nodeIndex+1}段`:''} · ${pokemonName(t.id)} Lv.${t.level}${t.source==='wild'?'（区域上限）':''}`})));
const speciesOptions=Object.entries(dex).map(([id,m])=>({value:Number(id),label:`${m.name} · #${id}`}));
watch(() => s.catalog, catalog => {
  if (!catalog) return;
  if (snapshotAt.value === catalog.capturedAt) return;
  candidates.value = candidates.value.filter(uid => catalog.candidates.some(m => m.uid === uid && m.eligible));
  if (!candidates.value.length) candidates.value = catalog.activeOrder.filter(uid => catalog.candidates.some(m => m.uid === uid && m.eligible));
  if (!candidates.value.length) candidates.value = catalog.candidates.filter(m => m.eligible).slice(0, 6).map(m => m.uid);
  const changedChapter=snapshotChapter.value!==catalog.chapterIndex;
  targets.value = changedChapter?[]:targets.value.filter(key => catalog.targets.some(t => t.key === key));
  if(enemySource.value==='current')targets.value=catalog.targets.filter(t=>t.source==='current').slice(0,1).map(t=>t.key);
  if (!targets.value.length && !custom.value.trim()) targets.value = catalog.targets.filter(t => t.key.startsWith('current:')).map(t => t.key);
  if (!targets.value.length && !custom.value.trim() && catalog.targets.length) targets.value = [catalog.targets[0].key];
  snapshotAt.value = catalog.capturedAt;snapshotChapter.value=catalog.chapterIndex;manualLevel.value=catalog.cap;
}, {immediate:true});
const routeMode = computed(() => ['route', 'order'].includes(mode.value));
function move(i: number, offset: number) { const xs = [...candidates.value], j = i + offset; if (j < 0 || j >= xs.length) return; [xs[i], xs[j]] = [xs[j], xs[i]]; candidates.value = xs; }
function options(): Options {
  return { mode: routeMode.value ? mode.value as 'route' | 'order' : 'matrix', candidateUids: candidates.value, targetKeys: enemySource.value==='manual'?[]:targets.value,
    trials: trials.value, seed: seed.value, start: full.value ? 'full' : 'current', scanLevels: mode.value === 'levels', sequence: false,
    autoSwitch: auto.value, maxLoss: maxLoss.value / 100, minWin: minWin.value / 100 };
}
const workload = computed(() => {
  if (!s.catalog) return null;
  try { return estimateWork(s.catalog, options(), routeMode.value ? 0 : enemySource.value==='manual'?1:advanced.value?parseCustomTargets(custom.value).length:0); }
  catch { return null; }
});
function submit() { try { if(s.stale){s.error='敌情已变化，请先点“更新本章敌情”再计算，避免沿用旧敌人。';return;} c.run(options(), routeMode.value ? [] : enemySource.value==='manual'?(manualId.value===null?[]:[{id:manualId.value,level:manualLevel.value}]):advanced.value?parseCustomTargets(custom.value):[]); } catch (e) { s.error = (e as Error).message; } }
const pct = (n: number) => (100 * n).toFixed(1) + '%';
const interval = (e: Estimate) => `${pct(e.mean)}（${pct(e.low)}–${pct(e.high)}）`;
const results = computed(() => {
  const all = s.report?.results || [];
  if (!s.report?.options.scanLevels) return [...all].sort((a, b) => Number(b.qualified) - Number(a.qualified) || (a.qualified&&b.qualified?a.loss.high-b.loss.high:b.win.low-a.win.low) || a.actions.mean-b.actions.mean);
  const groups = new Map<string, typeof all>();
  for (const row of all) { const key = JSON.stringify([row.uid,row.target]); groups.set(key, [...(groups.get(key) || []), row]); }
  return [...groups.values()].map(rows => rows.find(r => r.qualified) || rows.at(-1)!).sort((a,b)=>Number(b.qualified)-Number(a.qualified)||a.trainingXp-b.trainingXp||a.loss.high-b.loss.high);
});
const routes = computed(() => [...s.report?.routes || []].sort((a, b) => Number(b.qualified) - Number(a.qualified) || b.win.low - a.win.low || a.wear.mean - b.wear.mean || a.kos.mean - b.kos.mean));
function exportReport() {
  if (!s.report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(s.report, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'pokecatch-counter-analysis.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
watch(enemySource,()=>{if(enemySource.value!=='manual'){const allowed=availableTargets.value;targets.value=allowed.length?[allowed[0].key]:[];}},{flush:'sync'});
const selectedTarget=computed(()=>s.catalog?.targets.find(t=>t.key===targets.value[0]));
const recommendation=computed(()=>results.value[0]);
const route=computed(()=>s.routeReport?.routes.find(row=>row.baseline)||s.routeReport?.routes[0]);
const culprit=computed(()=>route.value?.failures?.[0]);
const bottleneck=computed(()=>{if(!culprit.value)return null;const from=Math.max(s.catalog?.nodeIndex||0,...(s.catalog?.centers||[]).filter(center=>center.node<culprit.value!.node).map(center=>center.node+1));return route.value?.threats?.find(threat=>threat.id!==undefined&&threat.node>=from&&threat.node<=culprit.value!.node)||null;});
const counterThreatKey=computed(()=>bottleneck.value?.targetKey&&s.catalog?.targets.some(t=>t.key===bottleneck.value?.targetKey)?bottleneck.value.targetKey:culprit.value?.targetKey);
const commonHits=(row:typeof results.value[number])=>Object.entries(row.hits).sort((a,b)=>b[1]-a[1])[0]?.[0];
function diagnose(){if(!s.catalog||s.stale)return;const order=s.catalog.activeOrder.filter(uid=>s.catalog!.candidates.some(m=>m.uid===uid&&m.eligible));c.run({...options(),mode:'route',candidateUids:order,start:'current',autoSwitch:'current'},[]);}
function counterForFailure(){const key=counterThreatKey.value;if(!key||!s.catalog?.targets.some(t=>t.key===key))return;enemySource.value='diagnostic';mode.value='matrix';targets.value=[key];candidates.value=s.catalog.candidates.filter(m=>m.eligible).map(m=>m.uid);custom.value='';full.value=true;}
const baseline=computed(()=>(s.report?.results||[]).filter(row=>row.target===recommendation.value?.target&&s.catalog?.activeOrder.includes(row.uid)&&row.level===s.catalog.candidates.find(m=>m.uid===row.uid)?.level).sort((a,b)=>b.win.low-a.win.low||a.loss.high-b.loss.high)[0]);
</script>
<template>
  <h2>本章怎么打更省血</h2>
  <p class="hint">先读取你正在打的章节。可以检查队伍能否撑到下个中心，也可以给这场战斗找一只更稳的对策。</p>
  <div class="actions"><NButton type="primary" secondary :disabled="s.busy" data-testid="load-box" @click="c.load">{{ s.catalog ? '更新本章敌情' : '读取本章敌情与 Box' }}</NButton><NButton v-if="s.busy" size="small" @click="c.cancel">取消</NButton></div>
  <NAlert v-if="s.error" type="error" :show-icon="false" style="margin:12px 0">{{ s.error }}</NAlert>
  <NAlert v-if="s.stale" type="warning" :show-icon="false" style="margin-top:12px" data-testid="counter-stale">游戏中的敌人或队伍已变化。下面是读取时的快照，请更新本章敌情后再算。</NAlert>
  <template v-if="s.catalog">
    <div class="counter-context section-card"><strong data-testid="counter-chapter">{{ chapterLabel(s.catalog.chapter) }}</strong><small>{{ chapterLabel(s.catalog.nodeName || '正在走图') }} · 等级上限 {{ s.catalog.cap }} · 读取于 {{ new Date(s.catalog.capturedAt).toLocaleTimeString() }}</small></div>
    <NButton block secondary :disabled="s.busy || s.stale" data-testid="diagnose-route" @click="diagnose">检查当前队伍：能否撑到下个中心？</NButton>
    <template v-if="route">
      <h3 ref="routeHeadingEl">{{ route.win.mean === 1 ? '这批模拟均走完了剩余章节' : '这支队伍存在中途战败风险' }}</h3>
      <p class="hint">{{ route.order.map(candidateLabel).join(' / ') }}<br>{{ route.trials }} 次模拟，走完剩余章节约 {{ pct(route.win.mean) }}。{{ s.routeReport?.options.start==='current'?'使用读取时的 HP 和状态。':'使用满血、无异常状态。' }}途中中心照常治疗，等级保持读取时状态。</p>
      <div v-if="culprit" ref="reasonEl" class="counter-reason" data-testid="route-reason"><strong>最常见战败位置：{{ culprit.id ? pokemonName(culprit.id) : culprit.label }}</strong><p>{{ route.trials }} 次模拟中，有 {{ culprit.count }} 次在这里战败。<template v-if="culprit.nextCenter">没能到达下一处中心（{{ chapterLabel(culprit.nextCenter) }}），后面还隔着 {{ culprit.battlesToCenter }} 场战斗。</template><template v-else>没能走到本章结束；后面没有其他宝可梦中心。</template></p><p v-if="bottleneck">这段路最耗血的是 {{ pokemonName(bottleneck.id!) }}，平均累计消耗队伍 {{ pct(bottleneck.wear) }} 的最大 HP。<template v-if="bottleneck.node!==culprit.node">建议优先降低它造成的战损，给后面的战斗留出血量。</template></p><NButton v-if="s.catalog.targets.some(t=>t.key===counterThreatKey)" size="small" type="primary" secondary :disabled="s.busy" data-testid="counter-culprit" @click="counterForFailure">为耗血来源找低损对策 →</NButton></div>
      <div v-for="threat in route.threats?.slice(0,3)" :key="`${threat.node}:${threat.id}`" class="split"><span>{{ threat.id ? pokemonName(threat.id) : threat.label }}</span><small>平均消耗队伍 {{ pct(threat.wear) }} 的最大 HP</small></div>
    </template>
    <h3>给哪只敌人找对策</h3>
    <div class="actions"><NButton size="small" :type="enemySource==='current'?'primary':'default'" :disabled="s.busy" @click="enemySource='current';mode='matrix'">这场战斗</NButton><NButton size="small" :type="enemySource==='chapter'?'primary':'default'" :disabled="s.busy" @click="enemySource='chapter';mode='matrix'">本章后续</NButton><NButton size="small" :type="enemySource==='manual'?'primary':'default'" :disabled="s.busy" @click="enemySource='manual';mode='matrix'">指定精灵</NButton></div>
    <template v-if="enemySource==='manual'"><NSelect v-model:value="manualId" :options="speciesOptions" filterable :to="false" :disabled="s.busy" placeholder="输入名字，例如雪妖女" aria-label="指定精灵名称" style="margin-top:10px" /><div class="setting-row"><span>敌人等级</span><NInputNumber v-model:value="manualLevel" :min="1" :max="100" :precision="0" style="width:120px" /></div></template>
    <template v-else><NSelect :value="targets[0] || null" :options="targetOptions" :to="false" :disabled="s.busy" placeholder="选择本章敌人" aria-label="本章对策目标" style="margin-top:10px" @update:value="targets=[$event];mode='matrix'" /><p class="hint" data-testid="enemy-context">{{ enemySource==='current' && currentTargets.length ? '来自读取时正在进行的这一场战斗，按其 HP 重新开战单挑。' : '这里是本章后续可能遭遇，不是当前已经在场的敌人。野怪按区域最高等级做准备。' }}<template v-if="s.catalog.randomTrainers">另有 {{ s.catalog.randomTrainers }} 场随机训练家，尚未交战时不能确定队伍；上面的整章检查会按游戏规则生成。</template></p></template>
    <div class="split"><strong>在哪些精灵里找</strong><small>{{ candidates.length }} 只候选</small></div>
    <div class="actions" style="margin:10px 0"><NButton size="small" :disabled="s.busy" data-testid="restore-team" @click="candidates=s.catalog.activeOrder.filter(uid=>s.catalog!.candidates.some(m=>m.uid===uid&&m.eligible));auto='current'">当前出战队伍</NButton><NButton size="small" :disabled="s.busy" @click="candidates=s.catalog.candidates.filter(m=>m.eligible).map(m=>m.uid)">整个 Box</NButton><NButton size="small" :disabled="s.busy" @click="mode=mode==='levels'?'matrix':'levels'">{{ mode==='levels'?'只看当前等级':'看看升几级会更稳' }}</NButton></div>
    <div class="setting-row"><span>满血比较对策</span><NSwitch v-model:value="full" :disabled="s.busy" aria-label="满血开始" /></div><p class="hint">{{ full ? '单挑按满血、无异常；路线检查始终用当前 HP 和状态。' : '单挑使用读取时的 HP 与状态，已倒下的成员也照实计算。' }}</p>
    <p v-if="mode==='levels'" class="hint">逐级检查到当前上限，给出第一个达到低损条件的等级。建议每次挑少量精灵。</p>
    <NAlert v-if="workload?.overBudget" type="warning" :show-icon="false">这次范围太大。请减少候选、目标或模拟次数。</NAlert>
    <NButton block type="primary" :disabled="s.busy || s.stale || workload?.overBudget || !candidates.length || enemySource==='manual'&&!manualId || !routeMode&&enemySource!=='manual'&&!targets.length" data-testid="run-counters" @click="submit">{{ routeMode ? '运行高级路线比较' : mode==='levels'?'寻找低损升级门槛':'找一只更稳、更省血的对策' }}</NButton>
    <NButton text style="margin-top:16px" :aria-expanded="advanced" @click="advanced=!advanced">高级设置与自选候选 {{ advanced ? '收起' : '展开' }}</NButton><div v-if="advanced">
      <NSelect v-model:value="mode" :options="modes" :to="false" :disabled="s.busy" aria-label="分析模式" />
      <h3>候选精灵</h3><NSelect v-model:value="candidates" :options="candidateOptions" multiple filterable :to="false" :disabled="s.busy" aria-label="候选精灵" />
      <template v-if="routeMode"><div v-for="(uid,i) in candidates" :key="uid" class="split"><span>{{ i+1 }}. {{ candidateLabel(uid) }}</span><div class="actions"><NButton size="tiny" :disabled="i===0||s.busy" @click="move(i,-1)">上移</NButton><NButton size="tiny" :disabled="i===candidates.length-1||s.busy" @click="move(i,1)">下移</NButton></div></div><NSelect v-model:value="auto" :to="false" :options="[{label:'保持游戏自动切换',value:'current'},{label:'开启自动切换',value:'on'},{label:'关闭自动切换',value:'off'}]" /></template>
      <template v-else><h3>批量目标</h3><NSelect v-model:value="targets" :options="targetOptions" multiple filterable :to="false" :disabled="s.busy" /><NInput v-model:value="custom" placeholder="图鉴编号:等级，例如 478:52, 460:50" :disabled="s.busy" /></template>

      <div class="setting-row"><span>每组样本数</span><NInputNumber v-model:value="trials" :min="128" :max="8192" :precision="0" style="width:120px" :disabled="s.busy" /></div>
      <div class="setting-row"><span>要求胜率至少（%）</span><NInputNumber v-model:value="minWin" :min="0" :max="100" style="width:120px" :disabled="s.busy" /></div><div class="setting-row"><span>允许损血上限（%）</span><NInputNumber v-model:value="maxLoss" :min="0" :max="100" style="width:120px" :disabled="s.busy" /></div>
      <p v-if="workload" class="hint" data-testid="workload">预计 {{ workload.groups.toLocaleString() }} 组 · {{ workload.samples.toLocaleString() }} 条样本</p>
    </div>
  </template>
  <p v-if="s.phase" class="hint" data-testid="counter-phase">{{ s.phase }}<template v-if="s.busy"> · {{ s.completed }}/{{ s.total || '?' }}</template></p><NProgress v-if="s.busy && s.total" type="line" :percentage="Math.round(100*s.completed/s.total)" />
  <template v-if="s.report?.options.mode==='matrix' && recommendation">
    <h2>推荐对策</h2><NAlert v-if="s.phase!=='计算完成'" type="warning" :show-icon="false">正在计算，下面还不是完整候选的最终比较。</NAlert>
    <div ref="pickEl" class="counter-pick section-card" data-testid="counter-recommendation"><NTag size="small" :type="recommendation.qualified?'success':'warning'">{{ recommendation.qualified?'满足本次低损条件':'未找到满足要求的方案，以下仅为备选' }}</NTag><p>针对 {{ recommendation.targetId?pokemonName(recommendation.targetId):recommendation.target }} Lv.{{ recommendation.targetLevel }}</p><h3>{{ pokemonName(recommendation.id) }} · Lv.{{ recommendation.level }}</h3><strong>{{ recommendation.facts.order }} · 预计损血 {{ pct(recommendation.loss.mean) }}</strong><p>模拟胜率 {{ pct(recommendation.win.mean) }}<template v-if="commonHits(recommendation)">；获胜时最常见 {{ commonHits(recommendation) }} 次命中攻击</template>。</p>
      <p data-testid="counter-reason">{{ recommendation.facts.order==='速度先手'?'速度高于目标，通常可以先发动攻击，减少先挨一击的风险。':recommendation.facts.order==='同速随机'?'与目标同速，谁先出手有随机性，不能当成稳定先手。':'速度低于目标，通常需要先承受攻击。' }}<template v-if="baseline && baseline.uid!==recommendation.uid">与当前队伍中对这只敌人表现最好的 {{ pokemonName(baseline.id) }} 相比，两者的模拟平均损血分别为 {{ pct(baseline.loss.mean) }} 和 {{ pct(recommendation.loss.mean) }}。</template><template v-else>这是本次候选按胜率门槛和损血保守上界比较得到的方案。</template></p>
      <p v-if="recommendation.trainingXp" class="hint">建议升到 Lv.{{ recommendation.level }}，还需约 {{ recommendation.trainingXp.toLocaleString() }} XP；不超过当前上限。</p>
      <p v-if="culprit" class="hint">本章路线模拟已发现 {{ culprit.id?pokemonName(culprit.id):culprit.label }} 处的战败风险。单挑更省血不等于整队一定能撑到中心；调整队伍后可再检查本章路线。</p>
    </div>
  </template>
  <template v-if="s.report">
    <div class="section-heading"><h2>分析结果</h2><NButton size="small" @click="exportReport">导出完整报告</NButton></div>
    <p class="hint">结论来自本机独立模拟，不是保证。详细误差、敌方 HP、攻击次数与计算条件可展开查看。</p>
    <NCollapse><NCollapseItem v-for="(row,i) in results" :key="`${row.uid}-${row.target}-${row.level}`" :name="i" :title="`${pokemonName(row.id)} Lv.${row.level} · ${row.qualified?'达到门槛':'未达到门槛'}`"><p>{{ row.target }}</p><p>胜率 {{ interval(row.win) }}<br>期望战损 {{ interval(row.loss) }}</p><NTag size="small">{{ row.facts.order }} · {{ row.facts.speed }} / {{ row.facts.enemySpeed }}</NTag><p class="hint">命中时伤害 {{ row.facts.damage.join('–') }}，敌 HP {{ row.facts.enemyHp }}。获胜样本的命中攻击次数：{{ Object.entries(row.hits).map(([hits,count])=>`${hits} 次攻击 ${count} 次`).join('；') }}。</p></NCollapseItem></NCollapse>
    <NCollapse><NCollapseItem v-for="(row,i) in routes" :key="`${row.order.join(',')}:${row.autoSwitch}`" :name="i" :title="`${row.baseline?'测试基线 · ':''}自动切换${row.autoSwitch?'开':'关'} · 通过 ${pct(row.win.mean)} · ${row.qualified?'达标':'未达标'}`"><p>{{ row.order.map(candidateLabel).join(' → ') }}</p><p>走完概率 {{ interval(row.win) }}<br>最终期望战损 {{ interval(row.loss) }}<br>累计承伤 {{ interval(row.wear) }}<br>累计倒下 {{ row.kos.mean.toFixed(2) }} 次</p></NCollapseItem></NCollapse>
    <NCollapse style="margin-top:16px"><NCollapseItem title="计算条件与边界" name="assumptions"><p v-for="line in s.report.assumptions" :key="line" class="hint">{{ line }}</p></NCollapseItem></NCollapse>
  </template>
</template>
