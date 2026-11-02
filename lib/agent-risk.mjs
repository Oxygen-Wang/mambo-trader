import {valuation} from '../public/engine.mjs';
export function assertAgentBudget(a,input,quotes){
 if(input.side!=='BUY')return;
 const v=valuation(a,quotes),symbol=String(input.symbol).toLowerCase(),amount=Number(input.qty)*Number(input.limit);
 if(!Number.isFinite(amount)||amount<=0)throw new Error('无效虚拟委托金额');
 if(v.missing.length)throw new Error('持仓缺报价，暂停 Agent 加仓');
 const pending=a.orders.filter(o=>o.side==='BUY'&&o.status==='pending');
 const single=(v.positions.find(p=>p.symbol===symbol)?.marketValue||0)+pending.filter(o=>o.symbol===symbol).reduce((sum,o)=>sum+o.qty*o.limit,0)+amount;
 const all=v.marketValue+pending.reduce((sum,o)=>sum+o.qty*o.limit,0)+amount;
 if(single>v.equity*.2+.001)throw new Error('patient-v1：含待成交买单，单只目标仓位不可超过20%');
 if(all>v.equity*.6+.001)throw new Error('patient-v1：含待成交买单，总仓位不可超过60%');
}
