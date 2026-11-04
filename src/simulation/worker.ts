import { createSimulator } from './engine';
import { planTeam } from './team-planner';
import type { Request, Response } from './types';
let simulator: Awaited<ReturnType<typeof createSimulator>> | null = null;
let snapshot:{source:string;save:string;now:number}|null=null;
const send = (value: Response) => self.postMessage(value);
self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    const req = event.data;
    if (req.type === 'load') {
      simulator = await createSimulator(req.source, req.save, req.now);
      snapshot={source:req.source,save:req.save,now:req.now};
      send({ type: 'catalog', catalog: simulator.catalog });
    } else if(req.type==='plan') {
      if(!simulator||!snapshot)throw new Error('请先读取本地 Box');
      const report=await planTeam(snapshot.source,snapshot.save,snapshot.now,req.options,(phase,completed,total)=>send({type:'plan-progress',phase,completed,total}),simulator);
      send({type:'plan-done',report});
    } else {
      if (!simulator) throw new Error('请先读取本地 box');
      const report = await simulator.run(req.options, (completed, total, result, route) => send({ type: 'progress', completed, total, result, route }), req.custom);
      send({ type: 'done', report });
    }
  } catch (e) { send({ type: 'error', message: (e as Error).message, fatal: event.data.type === 'load' }); }
};
