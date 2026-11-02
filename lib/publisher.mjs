import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import QRCode from 'qrcode';
const project=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export function findBiliup(){return [process.env.BILIUP_BIN,path.join(project,'..','tools','biliup','node_modules','@biliup','win32-x64','bin','biliup.exe')].filter(Boolean).find(p=>fs.existsSync(p))||null;}
export function publisher(directory,videos){
 const root=path.resolve(directory),settingsFile=path.join(root,'publisher.json'),uploadsFile=path.join(root,'uploads.json');
 let settings=fs.existsSync(settingsFile)?JSON.parse(fs.readFileSync(settingsFile)):{};
 let uploads=fs.existsSync(uploadsFile)?JSON.parse(fs.readFileSync(uploadsFile)):[];
 let login={status:'idle'},service,starting,inFlight=null;
 const base='http://127.0.0.1:19159';
 const save=()=>{fs.writeFileSync(settingsFile,JSON.stringify(settings,null,2));fs.writeFileSync(uploadsFile,JSON.stringify(uploads,null,2));};
 async function serviceApi(route,input,timeout=12000){const r=await fetch(base+route,{method:input?'POST':'GET',headers:input?{'Content-Type':'application/json'}:{},body:input?JSON.stringify(input):undefined,signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error('biliup 接口失败 HTTP '+r.status);return r.json();}
 async function ensureService(){
  try{const users=await serviceApi('/v1/users',undefined,1000);if(Array.isArray(users))return;}catch{}
  if(starting)return starting;
  starting=(async()=>{const binary=findBiliup();if(!binary)throw new Error('未找到 biliup，请先安装或设置 BILIUP_BIN');service=spawn(binary,['server','--bind','127.0.0.1','--port','19159'],{cwd:root,windowsHide:true,stdio:'ignore'});service.on('error',()=>{});for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,250));try{await serviceApi('/v1/users',undefined,1000);return;}catch{}}throw new Error('biliup 服务未能启动');})().finally(()=>{starting=null;});return starting;
 }
 function credentials(){const p=settings.cookieFile&&path.resolve(root,settings.cookieFile);return p&&p.startsWith(root+path.sep)&&fs.existsSync(p)?p:null;}
 function status(){return {installed:!!findBiliup(),loggedIn:!!credentials(),account:settings.account||null,autoPublish:settings.autoPublish===true,login:{status:login.status,svg:login.status==='waiting'?login.svg:undefined,error:login.error},uploads:uploads.map(({stdout,...u})=>u).slice(-12),defaults:{collection:'给AI一千万，看它交学费',tags:'AI,模拟炒股,曼波,大A整活实验室,虚拟炒股',tid:95}};}
 async function beginLogin(){
  await ensureService();if(login.status==='waiting'&&Date.now()-login.startedAt<250000)return status().login;
  const qr=await serviceApi('/v1/get_qrcode');if(qr.code!==0||!qr.data?.url)throw new Error('B站未返回登录二维码');
  const url=new URL(qr.data.url);if(url.protocol!=='https:'||url.hostname!=='passport.bilibili.com')throw new Error('二维码地址不属于B站登录域名');
  const current={status:'waiting',startedAt:Date.now(),svg:await QRCode.toString(url.href,{type:'svg',width:240,margin:2})};login=current;
  serviceApi('/v1/login_by_qrcode',qr,310000).then(async result=>{
    const p=path.resolve(root,String(result.filename||''));if(!p.startsWith(root+path.sep)||!fs.existsSync(p)||path.extname(p)!=='.json')throw new Error('biliup 没有保存有效凭据');
    settings.cookieFile=path.relative(root,p);settings.account=path.basename(p,'.json');settings.loggedInAt=new Date().toISOString();save();
    await serviceApi('/v1/users',{value:settings.cookieFile}).catch(()=>{});if(login===current)login={status:'completed'};
  }).catch(()=>{if(login===current)login={status:'failed',error:'二维码过期或登录未成功，请重新扫码'};});
  return status().login;
 }
 function preview(id){const job=videos.read(id);if(job.status!=='completed')throw new Error('视频尚未完成');const story=JSON.parse(fs.readFileSync(videos.file(id,'story.json')));return {jobId:id,episode:job.episode||1,title:story.title,description:story.description+'\n\n脚本、配音和部分画面由AI辅助生成；数据来自虚拟模拟账本。',tags:status().defaults.tags,tid:95,cover:'/api/videos/'+id+'/cover.png',video:'/api/videos/'+id+'/daily.mp4',collection:story.collection||status().defaults.collection};}
 async function syncSubmissions(){
   if(!credentials())return status();await ensureService();
   const users=await serviceApi('/v1/users'),user=users.find(u=>path.resolve(root,String(u.value||''))===credentials());if(!user)return status();
   const page=await serviceApi('/v1/users/'+user.id+'/archives?max_pages=1');
   const records=[];function walk(o){if(!o||typeof o!=='object')return;if(o.title&&o.bvid&&o.aid)records.push(o);for(const value of Object.values(o))if(typeof value==='object')walk(value);}walk(page);
   for(const u of uploads.filter(u=>u.status==='submitted'&&!u.bvid)){const match=records.find(a=>a.title===u.title);if(match){u.bvid=match.bvid;u.aid=match.aid;u.platformState=match.state;}}
   save();return status();
 }
 function upload(id,{confirmed=false}={}){
  if(!confirmed&&!settings.autoPublish)throw new Error('请先预览并点击确认投稿，或开启无人值守投稿');
  const cookie=credentials();if(!findBiliup())throw new Error('未找到biliup程序');if(!cookie)throw new Error('请先用B站App扫码登录');if(inFlight)throw new Error('已有稿件正在上传');
  const existing=uploads.find(u=>u.jobId===id&&['uploading','submitted'].includes(u.status));if(existing)return existing;
  const item=preview(id),videoJob=videos.read(id),date=videoJob.createdAt.slice(0,10);
  if(uploads.some(u=>['submitted','uploading'].includes(u.status)&&u.accountId===videoJob.accountId&&u.episode===item.episode&&u.date===date))throw new Error('本日这一集已上传或提交，请先检查B站稿件列表，避免重复');
  const record={id:crypto.randomUUID(),jobId:id,title:item.title,accountId:videoJob.accountId,date,episode:item.episode,status:'uploading',createdAt:new Date().toISOString()};uploads.push(record);inFlight=record.id;save();
  const args=['-u',cookie,'upload','--submit','web','--copyright','1','--tid',String(item.tid),'--title',item.title,'--desc',item.description,'--tag',item.tags,'--cover',videos.file(id,'cover.png'),videos.file(id,'daily.mp4')];
  const child=spawn(findBiliup(),args,{cwd:root,windowsHide:true,env:{...process.env,RUST_LOG:'warn'},stdio:['ignore','pipe','pipe']});let out='';const capture=b=>{out=(out+b.toString()).slice(-16000);};child.stdout.on('data',capture);child.stderr.on('data',capture);let finished=false;
  const finish=(ok,error)=>{if(finished)return;finished=true;clearTimeout(timer);record.status=ok?'submitted':'failed';record.completedAt=new Date().toISOString();record.bvid=out.match(/BV[0-9A-Za-z]{10}/)?.[0]||null;if(error)record.error=error;inFlight=null;save();if(ok&&!record.bvid)syncSubmissions().catch(()=>{});};
  const timer=setTimeout(()=>{child.kill();finish(false,'上传超过20分钟，请先检查B站稿件列表再重试，避免重复');},1200000);timer.unref();child.on('error',()=>finish(false,'无法启动 biliup'));child.on('exit',code=>finish(code===0,code===0?null:'biliup 上传失败，请检查登录与网络；未自动重试，避免重复投稿'));
  return record;
 }
 return {status,beginLogin,preview,upload,syncSubmissions,setAuto(enabled){settings.autoPublish=enabled===true;save();return status();},close(){service?.kill();}};
}
