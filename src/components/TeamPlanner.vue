<script setup lang="ts">
import {computed,ref,watch,nextTick} from 'vue';
import {NAlert,NButton,NCollapse,NCollapseItem,NSelect,NTag} from 'naive-ui';
import type {Runtime} from '../core/runtime';
import type {TeamPlan} from '../simulation/types';
import {pokemonName} from '../core/pokemon';
import {chapterLabel} from '../core/chapters';
const {runtime:r}=defineProps<{runtime:Runtime}>(),s=r.counters.state;
const prefs=r.store.get<{signature?:string;node?:number;objective?:string}>('teamPlanPreferences',{});
const node=ref<number|null>(null),objective=ref<'reach'|'clear'>(prefs.objective==='reach'?'reach':'clear'),heading=ref<HTMLElement>();
const signature=computed(()=>JSON.stringify([s.catalog?.chapterIndex,s.catalog?.nodes]));
watch(signature,()=>{
  const nodes=s.catalog?.nodes||[];
  if(signature.value===prefs.signature&&nodes.some(n=>n.index===prefs.node)){node.value=prefs.node!;return;}
  const current=s.catalog?.nodeIndex||0;
  const battle=nodes.find(n=>n.index>=current&&['wild','trainer','gym','static'].includes(n.type));
  node.value=nodes.find(n=>n.type==='heal'&&n.index>(battle?.index??current))?.index??nodes.at(-1)?.index??null;
},{immediate:true});
watch([node,objective],()=>r.store.set('teamPlanPreferences',{signature:signature.value,node:node.value,objective:objective.value}));
watch(()=>s.phase,async phase=>{if(phase==='配队完成'){await nextTick();heading.value?.scrollIntoView({block:'start',behavior:'smooth'});}});
const kinds:Record<string,string>={heal:'宝可梦中心',wild:'野怪路段',trainer:'训练家',gym:'首领',static:'固定遭遇',gift:'赠送',item:'道具',berry:'治疗树果'};
const goals=computed(()=>(s.catalog?.nodes||[]).map(n=>({value:n.index,label:`第 ${n.index+1} 处 · ${chapterLabel(n.name)} · ${kinds[n.type]||'事件'}`})));
const report=computed(()=>s.planReport);
const showAlternatives=ref(false);
const visiblePlans=computed(()=>report.value?.plans.slice(0,showAlternatives.value?3:1)||[]);
watch(report,()=>{showAlternatives.value=false;});
const reportedNode=computed(()=>{const report=s.planReport;return chapterLabel(report?.catalog.nodes?.find(n=>n.index===report.options.goal.node)?.name||'');});
const optionsChanged=computed(()=>!!report.value&&(report.value.options.goal.node!==node.value||report.value.options.goal.objective!==objective.value));
const name=(uid:string)=>{const m=s.catalog?.candidates.find(m=>m.uid===uid);return m?`${pokemonName(m.id)}${m.shiny?' ✦':''}`:'未知精灵';};
const level=(uid:string)=>s.catalog?.candidates.find(m=>m.uid===uid)?.level;
const pct=(v:number)=>(v*100).toFixed(1)+'%';
const duration=(seconds:number)=>seconds<60?`${Math.ceil(seconds)} 秒`:`${(seconds/60).toFixed(1)} 分钟`;
const safe=(plan:TeamPlan)=>plan.route.win.low>=.95;
const cause=computed(()=>report.value?.baseline.failures?.[0]);
function submit(){if(node.value===null)return;r.counters.plan({goal:{node:node.value,objective:objective.value,from:'chapter'},seed:1729});}
function exportPlan(){if(!report.value)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report.value,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='pokecatch-team-plan.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
</script>
<template>
  <div class="section-card goal-planner" data-testid="team-planner">
    <h3>指定目标，少换人、少练级</h3>
    <p class="hint">按本次保存的路线，从本章开头满血出发，找一支比较好用的队伍。先试原队伍，再考虑换位、练级和最多两名替补。</p>
    <NSelect v-model:value="node" :options="goals" :to="false" :disabled="s.busy" aria-label="配队目标节点" data-testid="plan-goal" />
    <NSelect v-model:value="objective" :options="[{label:'打完该节点（若为中心，包含治疗）',value:'clear'},{label:'到达该节点前停下',value:'reach'}]" :to="false" :disabled="s.busy" aria-label="配队目标条件" style="margin:10px 0" />
    <p class="hint">{{ objective==='clear'?'会打完所选位置，再检查队伍是否撑住。':'只检查走到所选位置前，尚未打该处敌人，也未使用该处中心。' }}练级时间会模拟候选队伍实际刷图，保留当前伙伴与经验加成。</p>
    <NButton block type="primary" secondary :disabled="s.busy||node===null" data-testid="run-team-plan" @click="submit">为这个目标找一个实用配队</NButton>
    <p class="hint">计算时会自动更新已过期的队伍快照；如果章节或整轮路线已改变，会请你重选目标。</p>
    <p class="hint">默认取舍：达到通过率要求后，比较“练级分钟 + 换入人数 × 20 + 换位成本 1”。因此愿意多练一点来少换人，也不会为了保留原队而无限练级。</p>
    <template v-if="report">
      <h3 ref="heading">{{ report.plans.some(p=>safe(p)&&p.score!==null)?'建议这样准备后再出发':'这次还没有找到能完整确认的方案' }}</h3>
      <NAlert v-if="optionsChanged" type="warning" :show-icon="false">下面仍是上次目标的结果，请重新计算新的目标。</NAlert>
      <p data-testid="plan-baseline">上次目标：{{ report.options.goal.objective==='clear'?'打完':'到达' }}第 {{ report.options.goal.node+1 }} 处（{{ reportedNode }}）。原队伍 {{ report.baseline.trials }} 次初测通过 {{ pct(report.baseline.win.mean) }}。<template v-if="cause">最常在 {{ cause.id?pokemonName(cause.id):chapterLabel(cause.label) }} 处战败（{{ cause.count }} 次），需要减少这里及之前路段的战损。</template></p>
      <p v-if="!report.plans.length" class="hint">已测试 {{ report.searched }} 支队伍，尚未找到通过率保守下界达到 95% 的方案。可以先缩短到下一个中心，或扩充 Box；这不代表其他配队一定无解。</p>
      <div v-for="(plan,index) in visiblePlans" :key="index" class="plan-option" data-testid="team-plan-result">
        <NTag size="small" :type="safe(plan)&&plan.score!==null?'success':'warning'">{{ !safe(plan)?'复核未达标，仅供排查':plan.score===null?'通过目标，训练耗时待确认':index===0?'综合建议':'可选方案' }}</NTag>
        <p><strong>{{ plan.added.length?`换入 ${plan.added.length} 名成员`:'保留原有成员' }}</strong> · {{ plan.reordered?'调整保留成员顺序':'保留成员顺序不变' }}<br><template v-if="plan.removed.length">换下：{{ plan.removed.map(name).join('、') }}。<br></template><template v-if="plan.added.length">换上：{{ plan.added.map(name).join('、') }}。</template></p>
        <div v-for="(uid,i) in plan.formation.order" :key="uid" class="split"><span>{{ i+1 }}. {{ name(uid) }} <small v-if="plan.added.includes(uid)">（换入）</small></span><span>Lv.{{ level(uid) }}<template v-if="plan.formation.levels[uid]!==level(uid)"> → <strong>{{ plan.formation.levels[uid] }}</strong></template></span></div>
        <p v-if="plan.trainingSeconds?.mean===0"><strong>无需练级，可以直接照此配队。</strong></p>
        <p v-else-if="plan.trainingSeconds"><strong>全队一起练，预计 {{ duration(plan.trainingSeconds.mean) }}</strong><br>刷 {{ chapterLabel(plan.trainingMap||'') }}；均值估计区间 {{ duration(plan.trainingSeconds.low) }}–{{ duration(plan.trainingSeconds.high) }}。<span v-for="(xp,uid) in plan.xp" :key="uid"><template v-if="xp"><br>{{ name(String(uid)) }} 还需 {{ xp.toLocaleString() }} XP。</template></span></p>
        <NAlert v-else type="warning" :show-icon="false">目标战斗已验证，但练级地图存在人工选择、超时或不可用，暂时无法估计配置成本。不要把这个方案当成最快准备方案。</NAlert>
        <p>目标通过 {{ pct(plan.route.win.mean) }}（95% 区间 {{ pct(plan.route.win.low) }}–{{ pct(plan.route.win.high) }}，独立复核 {{ plan.route.trials }} 次）。平均倒下 {{ plan.route.kos.mean.toFixed(2) }} 次，累计承伤相当于队伍总 HP 的 {{ pct(plan.route.wear.mean) }}。</p>
        <p v-if="plan.score!==null" class="hint">配置成本 {{ plan.score.toFixed(1) }} 分：练级 {{ ((plan.trainingSeconds?.mean||0)/60).toFixed(1) }} + 换入 {{ plan.added.length*20 }} + 换位 {{ plan.reordered?1:0 }}。换入权重是便利性偏好，不是实际耗时。</p>
        <NCollapse v-if="plan.training.length"><NCollapseItem title="练级地图与未完成原因" :name="index"><p v-for="map in plan.training" :key="map.chapter" class="hint">{{ chapterLabel(map.name) }}：{{ map.seconds?duration(map.seconds.mean):map.error||`两小时内完成 ${map.completed}/${map.trials} 次，无法可靠估时` }}。</p></NCollapseItem></NCollapse>
      </div>
      <NButton v-if="report.plans.length>1" size="small" text @click="showAlternatives=!showAlternatives">{{ showAlternatives?'收起其他方案':`查看其他已测试方案（${Math.min(2,report.plans.length-1)} 个）` }}</NButton>
      <p class="hint">筛选 {{ report.searched }} 个方案，独立复核 {{ report.verified }} 个。这里只推荐已测试的可行解，不保证全局最优；不会修改你的游戏队伍。</p>
      <NButton size="small" @click="exportPlan">导出配队报告</NButton>
      <NCollapse style="margin-top:12px"><NCollapseItem title="取舍方式、训练假设与计算边界" name="assumptions"><p v-for="line in report.assumptions" :key="line" class="hint">{{ line }}</p></NCollapseItem></NCollapse>
    </template>
  </div>
</template>
<style scoped>
.goal-planner{margin:16px 0}.goal-planner h3{margin-top:0}.plan-option{border-top:1px solid var(--pc-border,#ddd);padding-top:16px;margin-top:16px}.plan-option .split{gap:10px;margin:8px 0}.plan-option .split>span:last-child{white-space:nowrap}
</style>
