import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { newState, newAccount, symbolOf, bjTime, tradingTime, placeOrder, matchOrders, cancelOrder, valuation, snapshot } from './public/engine.mjs';
import {videoJobs} from './lib/video-jobs.mjs';
import {assertAgentBudget} from './lib/agent-risk.mjs';
import {allocateEpisode} from './lib/episodes.mjs';
import {publisher} from './lib/publisher.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const password = process.env.APP_PASSWORD || '';
const apiToken = process.env.APP_API_TOKEN || '';
if (!['127.0.0.1','localhost','::1'].includes(host) && !password) throw new Error('外网监听必须设置 APP_PASSWORD。默认仅监听 127.0.0.1。');
const dir = path.resolve(process.env.DATA_DIR || path.join(root,'data')); fs.mkdirSync(dir,{recursive:true});
const file = path.join(dir,'ledger.json');
const videos=videoJobs(dir),researchContexts=new Map();
const publishing=publisher(dir,videos);
let state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : newState();
let queue = Promise.resolve(), quoteError = '', lastFetch = 0, quoteFlight;
function save() { fs.writeFileSync(file+'.tmp', JSON.stringify(state,null,2)); fs.renameSync(file+'.tmp',file); }
save();
function serial(fn) { const p=queue.then(fn); queue=p.catch(()=>{}); return p; }
function json(res, code, value) { res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); }
function equal(a,b) { const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y); }
function authenticated(req) {
  if(apiToken && equal(req.headers.authorization || '',`Bearer ${apiToken}`)) return true;
  if(!password) return true;
  const auth=req.headers.authorization || '';
  if(!auth.startsWith('Basic ')) return false;
  const decoded=Buffer.from(auth.slice(6),'base64').toString();
  return equal(decoded.slice(decoded.indexOf(':')+1),password);
}
function demoQuotes() {
  const p={sh600519:['贵州茅台',1400],sh600036:['招商银行',40],sh600900:['长江电力',28],sh601318:['中国平安',55],sz000333:['美的集团',75],sz000858:['五粮液',120]};
  return Object.fromEntries(state.watchlist.map((symbol,i)=>{const [name,price]=p[symbol]||['演示股票',20+i];return [symbol,{symbol,name,price,previousClose:price/1.01,open:price/1.005,changePct:1,high:price*1.02,low:price*.98,volume:10000000,turnover:price*1000000000,timestamp:bjTime().stamp,source:'DEMO 合成行情',demo:true}];}));
}
function quotesFor(a) { return a.mode==='demo'?demoQuotes():state.quotes; }
async function refreshQuotes(force=false) {
  if(!force && Date.now()-lastFetch<15000)return;
  if(quoteFlight)return quoteFlight;
  quoteFlight=(async()=>{
    const symbols=[...new Set([...state.watchlist,...state.accounts.flatMap(a=>[...Object.keys(a.positions),...a.orders.filter(o=>o.status==='pending').map(o=>o.symbol)]),'sh000001','sh000300'])];
    try {
      const response=await fetch('https://qt.gtimg.cn/q='+symbols.join(','),{signal:AbortSignal.timeout(12000),headers:{'User-Agent':'AI-Paper-Arena/0.1'}});
      if(!response.ok)throw new Error('行情服务 HTTP '+response.status);
      const text=new TextDecoder('gb18030').decode(await response.arrayBuffer());
      let count=0;
      for(const m of text.matchAll(/v_((?:sh|sz|bj)\d{6})="([^"]*)"/g)){
        const v=m[2].split('~');if(v.length<40||!/^\d{14}$/.test(v[30])||!(+v[3]>0))continue;
        const q={symbol:m[1],name:v[1],price:+v[3],previousClose:+v[4],open:+v[5],volume:+v[6],timestamp:v[30],changePct:+v[32],high:+v[33],low:+v[34],turnover:+v[37]*10000,limitUp:+v[47]||null,limitDown:+v[48]||null,source:'腾讯财经参考行情',fetchedAt:new Date().toISOString(),demo:false};
        if(['sh000001','sh000300'].includes(q.symbol))state.indices[q.symbol]=q;else state.quotes[q.symbol]=q; count++;
      }
      if(!count)throw new Error('行情响应中没有有效价格与时间戳');
      quoteError='';lastFetch=Date.now();
    }catch(e){quoteError='实时行情暂不可用：'+e.message;}
  })().finally(()=>{quoteFlight=null;});
  return quoteFlight;
}
function view() {
  return {...state, accounts:state.accounts.map(a=>({...a,valuation:valuation(a,quotesFor(a)),quotes:quotesFor(a)})), market:{time:bjTime(),continuousTrading:tradingTime(),error:quoteError,source:'https://qt.gtimg.cn',note:'免费参考行情可能延迟；休市/陈旧行情不撮合。模型服务与行情数据由用户自行配置。'}, server:true};
}
async function body(req) { let s='';for await(const chunk of req){s+=chunk;if(Buffer.byteLength(s)>100000)throw new Error('请求过大');}return s?JSON.parse(s):{}; }
function account(id) {const a=state.accounts.find(a=>a.id===id);if(!a)throw new Error('账户不存在');return a;}
function publicExport() {return {exportedAt:new Date().toISOString(),virtualOnly:true,fees:state.fees,accounts:view().accounts,analyses:state.analyses,indices:state.indices,market:view().market};}
function researchContext(accountId){
  const a=account(accountId),id=crypto.randomUUID();
  for(const [key,v] of researchContexts)if(Date.now()-v.savedAt>1800000)researchContexts.delete(key);
  const context={id,savedAt:Date.now(),accountId:a.id,time:bjTime(),mode:a.mode,account:valuation(a,quotesFor(a)),quotes:Object.values(quotesFor(a)).filter(q=>state.watchlist.includes(q.symbol)),universe:[...state.watchlist],policy:{strategyVersion:'patient-v1',maxSingleWeightPct:20,maxTotalWeightPct:60,allowHoldCash:true,tradeMode:'virtual-only',rules:['仅主板普通股票可模拟交易','T+1、整手、费用与新鲜行情规则仍生效','资料不足可以空仓','不得捏造新闻、财报、收益或模型身份','预测只记录事前主观情景，未经统计校准']}};
  researchContexts.set(id,context);return context;
}
function recordAgent(input){
 const a=account(input.accountId),context=researchContexts.get(input.contextId);
 if(!context||context.accountId!==a.id||Date.now()-context.savedAt>1800000)throw new Error('请先通过 research_context 获取30分钟内的账户与行情快照。');
 const model=String(input.model||'').trim();if(!model||model.length>160)throw new Error('请填写真实模型标识；不可得时明确写“底层模型 ID 未提供”。');
 const summary=String(input.summary||'').trim();if(!summary||summary.length>3000)throw new Error('请提供有效分析结论（最多3000字）。');
 if(!Array.isArray(input.candidates)||input.candidates.length>3)throw new Error('候选需为数组，最多3只；可以为空仓意见提供空数组。');
 let total=0;
 const candidates=input.candidates.map(c=>{const symbol=symbolOf(c.symbol),quote=context.quotes.find(q=>q.symbol===symbol);if(!quote)throw new Error('候选必须属于所取快照且存在报价。');if(!['BUY','HOLD','SELL'].includes(c.action))throw new Error('无效方向');const weightPct=Number(c.weightPct);if(!Number.isFinite(weightPct)||weightPct<0||weightPct>20)throw new Error('单只目标仓位需在0–20%');total+=weightPct;const f=c.forecast||{},low=Number(f.low),base=Number(f.base),high=Number(f.high);if(![low,base,high].every(Number.isFinite)||low>base||base>high||low< -100||high>100)throw new Error('需提供有序的5交易日主观收益情景');return {symbol,action:c.action,weightPct,forecast:{low,base,high,horizonTradingDays:5},reason:String(c.reason||'').slice(0,1600),referencePrice:quote.price,referenceTimestamp:quote.timestamp};});
 if(total>60)throw new Error('总目标仓位不可超过60%');
 const record={id:crypto.randomUUID(),accountId:a.id,accountName:a.name,mode:a.mode,createdAt:new Date().toISOString(),requestedModel:model,responseModel:model,provider:'外部 Agent / MCP（模型身份由提交方自报）',identityVerified:false,analysisSource:'agent-mcp',strategyVersion:String(input.strategyVersion||'patient-v1').slice(0,60),elapsedMs:0,usage:null,summary,risk:String(input.risk||'资料仅供模拟研究').slice(0,2000),joke:String(input.joke||'').slice(0,300),candidates,inputSnapshot:structuredClone(context),sources:(Array.isArray(input.sources)?input.sources:[]).slice(0,20).map(s=>({title:String(s.title||'').slice(0,150),url:String(s.url||'').slice(0,1000)})).filter(s=>/^https?:\/\//.test(s.url)),executed:false};
 state.analyses.push(record);a.predictions.push(record.id);a.model=model;researchContexts.delete(input.contextId);save();return record;
}
async function analyze(input) {
  const a=account(input.accountId),base=new URL(input.baseUrl);
  const local=['localhost','127.0.0.1','[::1]'].includes(base.hostname);
  if(base.protocol!=='https:' && !(base.protocol==='http:'&&local&&['127.0.0.1','localhost','::1'].includes(host)))throw new Error('模型服务使用 HTTPS；本机模式也支持 localhost HTTP 模型。');
  if(base.username||base.password||base.search||base.hash)throw new Error('模型地址不能包含凭据、查询或片段。');
  if(!local && (/^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(base.hostname)||base.hostname==='0.0.0.0'||base.hostname.endsWith('.local')))throw new Error('不支持内网模型地址，请使用本机或公开 HTTPS 服务。');
  const model=String(input.model||'').trim();if(!model||model.length>160)throw new Error('请填写模型 ID。');
  await refreshQuotes();
  const qs=Object.values(quotesFor(a)).filter(q=>state.watchlist.includes(q.symbol));
  if(!qs.length)throw new Error('没有行情，不能生成分析。');
  const context={time:bjTime(),mode:a.mode,account:valuation(a,quotesFor(a)),quotes:qs,universe:state.watchlist,strategyVersion:String(input.strategyVersion||'v1').slice(0,60)};
  const system='你是 A 股虚拟炒股比赛的研究选手，只能操作虚拟账户。只根据提供的带时间戳快照分析，不能捏造财报、新闻、历史指标。资料不足可以 HOLD。只研究 universe 中的 A 股。观察池可以包含主板、创业板、科创板和北交所；当前软件只能对主板模拟交易，其他板块的观点仅供观察。不能借钱、做空或违反 T+1。给未来5个交易日的主观收益情景，绝非经校准的统计预测。用中文，最终只返回JSON：{"summary":"结论","candidates":[{"symbol":"sh600519","action":"BUY/HOLD/SELL","weightPct":10,"forecast":{"low":-5,"base":0,"high":5,"horizonTradingDays":5},"reason":"引用数据和局限"}],"risk":"风险","joke":"一句自嘲，不得编造已实现收益"}。最多3个候选，单股目标仓位不超20%，总目标仓位不超60%。';
  const endpoint=base.href.replace(/\/$/,'')+'/chat/completions';
  const started=Date.now();
  const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),headers:{'Content-Type':'application/json',...(input.apiKey?{Authorization:'Bearer '+input.apiKey}:{})},body:JSON.stringify({model,messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(context)}],temperature:0.3,max_tokens:2500})});
  if(!response.ok)throw new Error('模型请求失败 HTTP '+response.status+'。请检查模型 ID、地址与额度。');
  const payload=await response.json(); const raw=payload.choices?.[0]?.message?.content;
  if(typeof raw!=='string')throw new Error('模型未返回可解析的文本。首版使用 Chat Completions 兼容接口。');
  let parsed;try{parsed=JSON.parse(raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw new Error('模型没有返回有效 JSON；没有保存或执行交易。');}
  const candidates=(Array.isArray(parsed.candidates)?parsed.candidates:[]).slice(0,3).map(c=>{
    const symbol=symbolOf(c.symbol);if(!state.watchlist.includes(symbol))throw new Error('模型返回了自选池外股票，已拒绝。');
    const f=c.forecast||{};const low=Number(f.low),mid=Number(f.base),high=Number(f.high);
    if(![low,mid,high].every(Number.isFinite)||low>mid||mid>high||low < -100||high>100)throw new Error('预测情景格式无效，已拒绝保存。');
    return {symbol,action:['BUY','HOLD','SELL'].includes(c.action)?c.action:'HOLD',weightPct:Math.max(0,Math.min(20,Number(c.weightPct)||0)),forecast:{low,base:mid,high,horizonTradingDays:5},reason:String(c.reason||'').slice(0,1600),referencePrice:quotesFor(a)[symbol]?.price,referenceTimestamp:quotesFor(a)[symbol]?.timestamp};
  });
  const record={id:crypto.randomUUID(),accountId:a.id,accountName:a.name,mode:a.mode,createdAt:new Date().toISOString(),requestedModel:model,responseModel:String(payload.model||model),provider:base.origin,strategyVersion:context.strategyVersion,elapsedMs:Date.now()-started,usage:payload.usage||null,summary:String(parsed.summary||'').slice(0,3000),risk:String(parsed.risk||'').slice(0,2000),joke:String(parsed.joke||'').slice(0,300),candidates,inputSnapshot:context,executed:false};
  state.analyses.push(record);a.predictions.push(record.id);a.model=model;save();return record;
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
  if(!authenticated(req)){res.writeHead(401,{'WWW-Authenticate':'Basic realm="AI Paper Arena"'});res.end('需要你的应用密码');return;}
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')){
      if(!['GET','HEAD'].includes(req.method)){
        if(!String(req.headers['content-type']||'').includes('application/json'))throw new Error('仅支持 JSON 请求。');
        const origin=req.headers.origin;if(origin && origin!==`http://${req.headers.host}` && origin!==`https://${req.headers.host}`)throw new Error('不接受跨站写入。');
      }
      if(req.method==='GET'&&url.pathname==='/api/state'){await serial(async()=>{await refreshQuotes();for(const a of state.accounts){matchOrders(a,quotesFor(a),new Date(),a.mode==='demo');snapshot(a,quotesFor(a));}save();});json(res,200,view());return;}
      if(req.method==='GET'&&url.pathname==='/api/export'){json(res,200,publicExport());return;}
      if(req.method==='GET'&&url.pathname==='/api/health'){json(res,200,{ok:true,virtualOnly:true});return;}
      if(req.method==='GET'&&url.pathname==='/api/publisher'){json(res,200,publishing.status());return;}
      if(req.method==='GET'&&url.pathname==='/api/publisher/preview'){json(res,200,publishing.preview(url.searchParams.get('id')));return;}
      if(req.method==='GET'&&url.pathname==='/api/research-context'){await serial(()=>refreshQuotes());json(res,200,researchContext(url.searchParams.get('accountId')));return;}
      if(req.method==='GET'&&url.pathname==='/api/videos'){json(res,200,{...videos.info(),suggestedEpisodes:Object.fromEntries(state.accounts.map(a=>[a.id,allocateEpisode(structuredClone(state.videoEpisodes||[]),a.id,bjTime().date)]))});return;}
      if(req.method==='GET'&&/^\/api\/videos\/[^/]+$/.test(url.pathname)){json(res,200,videos.read(url.pathname.split('/')[3]));return;}
      if(['GET','HEAD'].includes(req.method)&&/^\/api\/videos\/[^/]+\/[^/]+$/.test(url.pathname)){
        const [, , ,id,name]=url.pathname.split('/'),target=videos.file(id,name),stat=fs.statSync(target),mime={'.mp4':'video/mp4','.wav':'audio/wav','.png':'image/png','.json':'application/json; charset=utf-8','.srt':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};
        let start=0,end=stat.size-1,code=200;const range=req.headers.range;
        if(range){const m=/^bytes=(\d+)-(\d*)$/.exec(range);if(!m||Number(m[1])>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return;}start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),end):end;if(end<start){res.writeHead(416);res.end();return;}code=206;}
        const attachment=url.searchParams.get('download')==='1';
        res.writeHead(code,{'Content-Type':mime[path.extname(name)]||'application/octet-stream','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(attachment?{'Content-Disposition':`attachment; filename="arena-${id.slice(0,8)}-${name}"; filename*=UTF-8''${encodeURIComponent('大A整活-'+name)}`} : {}),...(code===206?{'Content-Range':`bytes ${start}-${end}/${stat.size}`}:{})});if(req.method==='HEAD')res.end();else fs.createReadStream(target,{start,end}).pipe(res);return;
      }
      if(req.method==='POST'){
        const input=await body(req);
        const result=await serial(async()=>{
          switch(url.pathname){
            case '/api/accounts':{if(state.accounts.length>=20)throw new Error('首版最多20个账户。');const a=newAccount(String(input.name||'新选手').slice(0,60),input.mode==='demo'?'demo':'live');state.accounts.push(a);save();return a;}
            case '/api/watchlist':{const symbol=symbolOf(input.symbol);if(state.watchlist.length>=30&&!state.watchlist.includes(symbol))throw new Error('首版自选池最多30只。');if(!state.watchlist.includes(symbol))state.watchlist.push(symbol);await refreshQuotes(true);save();return {symbol};}
            case '/api/orders':{const a=account(input.accountId);await refreshQuotes(true);input.symbol=symbolOf(input.symbol);if(String(input.source||'').startsWith('mcp/'))assertAgentBudget(a,input,quotesFor(a));const o=placeOrder(a,input,quotesFor(a)[input.symbol]);matchOrders(a,quotesFor(a),new Date(),a.mode==='demo');snapshot(a,quotesFor(a));save();return o;}
            case '/api/cancel':{const o=cancelOrder(account(input.accountId),input.orderId);save();return o;}
            case '/api/analyze':return analyze(input);
            case '/api/agent-analysis':return recordAgent(input);
            case '/api/videos':{const a=view().accounts.find(a=>a.id===input.accountId);if(!a)throw new Error('账户不存在');if(videos.info().active)throw new Error('已有视频正在生成');state.videoEpisodes||=[];const episode=allocateEpisode(state.videoEpisodes,a.id,bjTime().date,input.episode);const job=videos.start(a,state.analyses,{episode});save();return job;}
            case '/api/save-video':return videos.saveToDownloads(String(input.id||''));
            case '/api/publisher/login':return publishing.beginLogin();
            case '/api/publisher/auto':return publishing.setAuto(input.enabled);
            case '/api/publisher/upload':return publishing.upload(String(input.id||''),{confirmed:input.confirmed===true});
            case '/api/publisher/sync':return publishing.syncSubmissions();
            default:throw new Error('接口不存在');
          }
        });json(res,200,result);return;
      }
      json(res,404,{error:'接口不存在'});return;
    }
    const name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const target=path.resolve(root,'public',name),publicRoot=path.join(root,'public')+path.sep;
    if(!target.startsWith(publicRoot)||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404);res.end('Not found');return;}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
    res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache'});fs.createReadStream(target).pipe(res);
  }catch(e){json(res,400,{error:e.message||'操作失败'});}
});
server.listen(port,host,()=>console.log(`AI Paper Arena ready: http://${host}:${server.address().port} (virtual funds only)`));
const timer=setInterval(()=>serial(async()=>{if(!state.accounts.some(a=>a.orders.some(o=>o.status==='pending')))return;await refreshQuotes(true);for(const a of state.accounts){matchOrders(a,quotesFor(a),new Date(),a.mode==='demo');snapshot(a,quotesFor(a));}save();}).catch(()=>{}),60000);timer.unref();
