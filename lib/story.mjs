import {bjTime} from '../public/engine.mjs';
import {COLLECTION} from './episodes.mjs';
export const OPENING='这里是大A整活实验室！给 AI 一千万，看看它先财富自由，还是先交学费。全程虚拟资金。';
export const DISCLAIMER='本视频仅为 AI 模拟炒股与娱乐实验，全程虚拟资金，不构成投资建议。';
export const pct=n=>(Math.abs(n)<.005?'0.00':(n>0?'+':'')+n.toFixed(2))+'%';
export const money=n=>Number(n||0).toLocaleString('zh-CN',{maximumFractionDigits:2});
export function buildStory(account,analyses,{now=new Date(),episode=1}={}){
 const v=account.valuation,r=[...analyses].filter(x=>x.accountId===account.id).at(-1),date=bjTime(now).date;
 const mode=account.mode==='demo'?'演示合成行情 · 非市场业绩':'真实参考行情 · 虚拟交易';
 const clean=s=>String(s||'').replace(/[<>]/g,'').replace(/\s+/g,' ').trim();
 const summary=r?clean(r.summary).slice(0,95):'尚未收到 Agent 分析。本期先验收软件，不编造选股结论。';
 const rawModel=r?clean(r.requestedModel):'',model=/Codex Agent|底层模型.*未提供|模型.*未知/i.test(rawModel)?'':rawModel;
 const f=r?.candidates?.[0],q=f&&(account.quotes?.[f.symbol]);
 const forecast=f?`${q?.name||f.symbol}：未来${f.forecast.horizonTradingDays||5}个交易日，悲观${pct(f.forecast.low)}，基准${pct(f.forecast.base)}，乐观${pct(f.forecast.high)}。这是主观情景，不是承诺。`:'预测暂缺。没有事前预测，就不在涨了以后说早知道。';
 const actual=`今日模拟盈亏${money(v.dailyProfit)}元，累计${money(v.profit)}元，累计收益率${pct(v.returnPct)}。`;
 const joke=!v.tradeCount?'今天还没开仓。主打一个：我不出手，手续费都拿我没办法。':v.profit<0?'AI说长期主义，账本说先别急，手续费已经先实现了财务自由。':'先记账，再庆祝。毕竟截图跑赢大盘，不等于账户跑赢大盘。';
 const scenes=[
  {key:'opening',eyebrow:'固定片头 / EPISODE '+String(episode).padStart(3,'0'),title:'给 AI 一千万',big:'财富自由？',lines:['还是，先交学费。',mode],voice:OPENING,kind:'opening'},
  {key:'model',eyebrow:'01 / 模型交作业',title:'今天的策略',big:model||'先看它怎么说',lines:[r?'分析时间 '+new Date(r.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚无分析记录',summary],voice:`${model?'本次分析来自'+model+'。':''}${summary}`,kind:'model'},
  {key:'forecast',eyebrow:'02 / 先立下 FLAG',title:'模型嘴上的收益',big:f?pct(f.forecast.base):'暂无预测',lines:[forecast,'主观预测 ≠ 已实现收益'],voice:forecast,kind:'forecast',forecast:f?.forecast},
  {key:'actual',eyebrow:'03 / 账本来验收',title:'市场怎么说',big:pct(v.returnPct),lines:[`总资产 ¥${money(v.equity)}`,`今日 ¥${money(v.dailyProfit)} · 累计 ¥${money(v.profit)}`,`${v.tradeCount} 笔模拟成交 · 费用 ¥${money(v.fees)}`],voice:actual+' '+joke,kind:'actual',valuation:v},
  {key:'ending',eyebrow:'下期继续 / 不删亏损记录',title:'模型负责自信',big:'账本负责记住',lines:[joke,DISCLAIMER],voice:'下一期，继续看模型交作业，市场来批卷。'+DISCLAIMER,kind:'ending'}
 ];
 scenes[1].voice=`这是第${episode}期。`+scenes[1].voice;
 if(account.mode==='demo')scenes[0].voice='以下是演示合成行情，不代表真实市场业绩。'+scenes[0].voice;
 return {date,mode,episode,collection:COLLECTION,accountId:account.id,accountName:account.name,virtualOnly:true,opening:OPENING,disclaimer:DISCLAIMER,analysisId:r?.id||null,model,scenes,title:`第${String(episode).padStart(3,'0')}期｜给AI一千万｜${!v.tradeCount?'首日空仓，先保住本金':`模拟累计${pct(v.returnPct)}`}`,description:`合集：${COLLECTION}\n第${episode}期 · ${date} · ${mode}\n${model}\n${actual}\n${DISCLAIMER}`,retentionDesign:['固定身份与反差开场','预测和结果分开呈现','用账本兑现悬念','自嘲式结尾，不伪造战绩']};
}
