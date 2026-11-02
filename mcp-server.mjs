import readline from 'node:readline';
const base=new URL(process.env.ARENA_URL||'http://127.0.0.1:4173');
if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw new Error('本地 MCP 只连接回环地址。');
const token=process.env.ARENA_TOKEN||'';
async function api(route,input){const r=await fetch(new URL('/api/'+route,base),{method:input?'POST':'GET',headers:{...(input?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:input?JSON.stringify(input):undefined,signal:AbortSignal.timeout(30000)});const value=await r.json();if(!r.ok)throw new Error(value.error||'应用 HTTP '+r.status);return value;}
const str=description=>({type:'string',description});
const accountId=str('market_state 返回的账户 ID；仅虚拟账户');
const tools=[
 {name:'publisher_status',description:'查看biliup是否安装、账号扫码状态、无人值守开关与近期稿件；不返回凭据。',properties:{},required:[],readOnly:true,run:()=>api('publisher')},
 {name:'publish_daily_video',description:'将已验收成片按保存模板交给biliup公开投稿。只有用户已经在应用开启无人值守且扫码登录后才能执行；不绕过开关，不自动重试失败稿件。返回上传任务，需用publisher_status等到完成并检查BV。',properties:{jobId:str('已完成的视频任务ID')},required:['jobId'],run:a=>api('publisher/upload',{id:a.jobId})},
 {name:'market_state',description:'读取模拟账户、真实参考行情时间、自选池、持仓、历史收益与模型记录。DEMO为独立合成数据。',properties:{},required:[],readOnly:true,run:()=>api('state')},
 {name:'research_context',description:'分析前必须获取不可变快照及 contextId。有效30分钟，提交一次；只根据可核验的资料研究，可以保持空仓。',properties:{accountId},required:['accountId'],readOnly:true,run:a=>api('research-context?accountId='+encodeURIComponent(a.accountId))},
 {name:'add_watch_stock',description:'加入沪深北 A 股观察池；模拟交易暂只支持沪深主板。',properties:{symbol:str('六位 A 股代码')},required:['symbol'],run:a=>api('watchlist',a)},
 {name:'record_analysis',description:'直接保存本 Agent 的结论与主观预测，不需要模型 API，不自动下单。必须如实填写实际模型身份；不可得时注明未提供，禁止猜型号。预测未到期不得声称已兑现。',properties:{accountId,contextId:str('research_context 的快照 ID'),model:str('实际模型或 Agent 标识；底层型号不可得时注明底层模型ID未提供'),strategyVersion:str('本次策略版本'),summary:str('中文结论与资料局限，最多3000字'),risk:str('风险与不确定性'),joke:str('基于已记录事实的自嘲，不编造业绩'),candidates:{type:'array',maxItems:3,description:'可以为空数组，表示保持现金或资料不足；单只≤20%，合计≤60%',items:{type:'object',properties:{symbol:str('快照中有报价的股票代码'),action:{enum:['BUY','HOLD','SELL'],type:'string'},weightPct:{type:'number',minimum:0,maximum:20},forecast:{type:'object',properties:{low:{type:'number'},base:{type:'number'},high:{type:'number'}},required:['low','base','high']},reason:str('引用资料、时间与局限')},required:['symbol','action','weightPct','forecast','reason']}},sources:{type:'array',maxItems:20,items:{type:'object',properties:{title:str('资料名称'),url:str('实际阅读过的来源 URL')},required:['title','url']}}},required:['accountId','contextId','model','summary','candidates'],run:a=>api('agent-analysis',a)},
 {name:'place_paper_order',description:'仅提交虚拟限价委托；无任何真实券商连接。先读取 market_state 并检查 T+1、整手、费用、有效时段与仓位。休市不会追记成交。',properties:{accountId,symbol:str('沪深主板股票代码'),side:{type:'string',enum:['BUY','SELL']},qty:{type:'integer',minimum:100,multipleOf:100},limit:{type:'number',exclusiveMinimum:0},source:str('实际 Agent / 策略版本')},required:['accountId','symbol','side','qty','limit'],run:a=>api('orders',{...a,source:'mcp/'+String(a.source||'patient-v1').slice(0,80)})},
 {name:'cancel_paper_order',description:'撤销尚未成交的虚拟委托，释放冻结资金或股份。',properties:{accountId,orderId:str('订单ID')},required:['accountId','orderId'],run:a=>api('cancel',a)},
 {name:'generate_daily_video',description:'根据已记录的账户和分析生成固定片头、曼波配音、主观预测与实际收益分开的视频；结尾声明不构成投资建议。口播发送到必剪在线合成，Concat本地渲染MP4；只生成文件，不上传B站。返回任务ID，需轮询 video_job_status。',properties:{accountId},required:['accountId'],run:a=>api('videos',a)},
 {name:'video_job_status',description:'查看视频生成任务进度；完成后返回本机素材文件和工程信息。',properties:{jobId:str('省略返回所有近期任务；提供ID返回单个任务')},required:[],readOnly:true,run:a=>api(a.jobId?'videos/'+encodeURIComponent(a.jobId):'videos')}
];
export const toolDefinitions=tools.map(({run,properties,required,readOnly,...t})=>({...t,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:!!readOnly,destructiveHint:false,openWorldHint:true}}));
const reply=o=>process.stdout.write(JSON.stringify(o)+'\n');
async function handle(msg){if(msg.id===undefined)return;
 try{
  let result;
  if(msg.method==='initialize')result={protocolVersion:['2025-11-25','2025-06-18','2025-03-26','2024-11-05'].includes(msg.params?.protocolVersion)?msg.params.protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'ai-paper-arena',version:'0.2.0'},instructions:'只做虚拟交易。先取快照，再分析留档，再按需要委托与生成视频。保持现金是合法结果。模型身份必须如实自报，不允许捏造收益或新闻。策略见项目 docs/AGENT_WORKFLOW.md。'};
  else if(msg.method==='ping')result={};
  else if(msg.method==='tools/list')result={tools:toolDefinitions};
  else if(msg.method==='tools/call'){const tool=tools.find(t=>t.name===msg.params?.name);if(!tool)throw new Error('工具不存在');try{const args=msg.params.arguments||{};for(const key of tool.required)if(args[key]===undefined)throw new Error('缺少参数 '+key);const value=await tool.run(args);result={content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value};}catch(e){result={isError:true,content:[{type:'text',text:e.message}]};}}
  else{reply({jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found'}});return;}
  reply({jsonrpc:'2.0',id:msg.id,result});
 }catch(e){reply({jsonrpc:'2.0',id:msg.id,error:{code:-32603,message:e.message}});}
}
if(process.argv[1]&&import.meta.url===(await import('node:url')).pathToFileURL(process.argv[1]).href){readline.createInterface({input:process.stdin}).on('line',line=>{if(line.length>1000000){reply({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Message too large'}});return;}try{handle(JSON.parse(line));}catch{reply({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});}});}
