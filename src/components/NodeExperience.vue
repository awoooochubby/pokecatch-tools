<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import {NAlert,NButton,NCollapse,NCollapseItem,NInputNumber,NProgress,NSelect} from 'naive-ui';
import type {Runtime} from '../core/runtime';
import type {NodeForecastOptions,NodeForecastRow} from '../simulation/forecast-types';
import {chapterLabel} from '../core/chapters';
import {pokemonName} from '../core/pokemon';
const {runtime:r}=defineProps<{runtime:Runtime}>(),c=r.nodeExperience,s=c.state;
const saved=r.store.get<{scope?:string;trials?:number;selected?:string}>('nodeExperiencePreferences',{});
const scope=ref<NodeForecastOptions['scope']>(saved.scope==='remaining'?'remaining':'full');
const trials=ref(typeof saved.trials==='number'&&Number.isInteger(saved.trials)&&saved.trials>=128&&saved.trials<=2048?saved.trials:256),selected=ref(saved.selected||'');
watch([scope,trials,selected],()=>r.store.set('nodeExperiencePreferences',{scope:scope.value,trials:trials.value,selected:selected.value}));
const report=computed(()=>s.nodeReport),changed=computed(()=>report.value&&report.value.options.scope!==scope.value);
const chapter=computed(()=>{const catalog=report.value?.catalog||s.catalog;return chapterLabel(catalog?.dungeon?.name||catalog?.chapters.find(ch=>ch.id===catalog.current)?.name||'当前副本');});
const members=computed(()=>[{label:'整队实际入账经验合计',value:''},...(report.value?.catalog.team||[]).map(m=>({label:`${pokemonName(m.id)} · ${m.uid.slice(-6)}`,value:m.uid}))]);
watch(report,()=>{if(report.value&&selected.value&&!report.value.catalog.team.some(m=>m.uid===selected.value))selected.value='';});
const metric=(node:NodeForecastRow)=>selected.value?node.members[selected.value]:node.metric;
const total=computed(()=>selected.value?report.value?.members[selected.value]:report.value?.xp);
const partial=computed(()=>report.value?.rows.some(n=>n.state==='unavailable'));
const number=(n:number)=>n.toLocaleString('zh-CN',{maximumFractionDigits:1}),pct=(n:number)=>(n*100).toFixed(1)+'%';
const kinds:Record<string,string>={wild:'野怪',trainer:'训练家',gym:'首领',heal:'中心',transition:'过场治疗',berry:'树果',item:'道具',gift:'赠送',static:'固定遭遇',unlock:'解锁'};
function run(){c.runNodes({scope:scope.value,trials:trials.value,seed:1729});}
function download(){if(!report.value)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report.value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='pokecatch-node-experience.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
</script>
<template>
  <h2>本图每个节点能拿多少经验</h2>
  <p class="hint">按副本统计每个节点的实得 XP。联盟包含四天王、冠军和全部道中；奖励计入触发它的节点。</p>
  <NSelect v-model:value="scope" :options="[{label:'整副本重打预估：从入口满血出发',value:'full'},{label:'剩余副本预估：保留当前 HP 和这场战斗',value:'remaining'}]" :to="false" :disabled="s.busy" aria-label="节点经验计算范围" />
  <p class="hint">{{ scope==='full'?'使用当前等级、经验和伙伴进度重打完整副本；敌人按节点规则重新遭遇，已过节点的结果也只是预估。':'从当前节点继续，保留在场敌人的血量与队列，计算后续所有阶段；已经过去的节点不回算。' }}</p>
  <div class="setting-row"><span>模拟次数</span><NInputNumber v-model:value="trials" :min="128" :max="2048" :precision="0" :disabled="s.busy" aria-label="节点经验模拟次数" style="width:110px" /></div>
  <div class="actions"><NButton type="primary" secondary :disabled="s.busy||!Number.isInteger(trials)||trials<128||trials>2048" data-testid="run-node-xp" @click="run">计算本图节点经验</NButton><NButton v-if="s.busy" size="small" @click="c.cancel">取消</NButton></div>
  <p class="hint" data-testid="node-xp-phase">{{ s.phase.startsWith('无需实战采集')?'不用先打图采样，点击即可计算。':s.phase }}<template v-if="s.busy&&s.total"> · {{ s.completed }}/{{ s.total }}</template></p>
  <NProgress v-if="s.busy&&s.total" type="line" :percentage="Math.round(100*s.completed/s.total)" />
  <NAlert v-if="s.error" type="error" :show-icon="false">{{ s.error }}</NAlert>
  <NAlert v-if="s.stale" type="warning" :show-icon="false" data-testid="node-xp-stale">路线、战斗或队伍已变化，下面是读取时快照；重新计算会自动更新。</NAlert>
  <template v-if="report">
    <h3 data-testid="node-xp-chapter">{{ chapter }}</h3>
    <p class="hint">{{ report.options.scope==='full'?'整图重打':'从当前状态继续' }} · 读取时第 {{ (report.catalog.nodeIndex||0)+1 }} 处 · {{ report.trials }} 次模拟</p>
    <NAlert v-if="changed" type="warning" :show-icon="false">范围已改变，下面仍是上一次结果，请重新计算。</NAlert>
    <NSelect v-model:value="selected" :options="members" :to="false" aria-label="节点经验查看对象" />
    <div class="forecast-rate accent" data-testid="node-xp-total">{{ number(total?.mean||0) }} <small>{{ partial?'已知节点期望 XP':'路线期望 XP' }}</small></div>
    <p class="hint">{{ selected?'所选成员实际入账':'整队成员实际入账合计' }}，不是所有成员各拿这么多。<template v-if="report.complete">走完计算路线约 {{ pct(report.complete.mean) }}。</template>各节点期望相加与这里的合计一致，显示值有四舍五入。</p>
    <NAlert v-if="partial" type="warning" :show-icon="false">有节点暂不能计算，后续标为未知，合计只含可确认的前面节点。</NAlert>
    <div class="node-xp-list" data-testid="node-xp-list">
      <div v-for="node in report.rows" :key="node.index" class="node-xp-row" data-testid="node-xp-row" :data-node-index="node.index">
        <small v-if="(report.catalog.dungeon?.chapters.length||0)>1">{{ chapterLabel(node.stageName) }}</small>
        <div class="split"><strong>{{ node.index+1 }}. {{ chapterLabel(node.name) }}</strong><small>{{ kinds[node.type]||'事件' }}{{ node.index===report.catalog.nodeIndex?' · 读取时所在':'' }}</small></div>
        <p v-if="node.state==='past'" class="hint">已通过，本次未回算经验。</p>
        <p v-else-if="node.state==='unavailable'" class="hint">经验未知：{{ node.reason }}</p>
        <template v-else-if="metric(node)">
          <div class="split"><strong class="accent" data-testid="node-xp-value">+{{ number(metric(node)!.xp.mean) }} XP</strong><small>累计 {{ number(metric(node)!.cumulative.mean) }} XP</small></div>
          <p class="hint" v-if="node.reached.mean<1">到达概率 {{ pct(node.reached.mean) }}。{{ node.reached.mean===0?'这批模拟均未到达；本节点自身收益不能据此当成零。':`到达后的平均入账 ${number(metric(node)!.conditionalXp?.mean||0)} XP。` }}</p>
          <small v-else>{{ metric(node)!.xp.mean===0?(node.type==='heal'?'中心治疗，直接经验为 0。':'此节点没有给所选对象带来入账经验；已触顶时也会为 0。'):`均值估计区间 ${number(metric(node)!.xp.low)}–${number(metric(node)!.xp.high)} XP` }}</small>
        </template>
      </div>
    </div>
    <NButton size="small" secondary block style="margin-top:12px" data-testid="export-node-xp" @click="download">导出节点经验明细</NButton>
    <NCollapse style="margin-top:12px"><NCollapseItem title="经验口径与计算边界" name="assumptions"><p v-for="line in report.assumptions" :key="line" class="hint">{{ line }}</p></NCollapseItem></NCollapse>
  </template>
</template>
<style scoped>.node-xp-list{margin-top:12px}.node-xp-row{padding:12px 0;border-bottom:1px solid #ffffff12}.node-xp-row>.split{margin-bottom:5px}.node-xp-row .hint{margin:6px 0}.node-xp-row strong{overflow-wrap:anywhere}.node-xp-row small{flex-shrink:0}</style>
