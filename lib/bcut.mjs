import fs from 'node:fs/promises';
const BASE='https://member.bilibili.com/x/creative-tool';
const HEADERS={'Content-Type':'application/json','User-Agent':'Mozilla/5.0'};
async function api(route,options={},fetcher=fetch){
  const r=await fetcher(BASE+route,{...options,headers:HEADERS,signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw new Error('必剪服务 HTTP '+r.status);
  const v=await r.json();if(v.code!==0)throw new Error('必剪服务：'+(v.message||v.code));return v.data;
}
export async function listVoices(fetcher=fetch){const data=await api('/bcut/pc/tts/list',{},fetcher);return (data.categories||[]).flatMap(c=>(c.materials||[]).map(v=>({name:v.name,voice:v.voice,engine:v.voice_engine,category:c.title})));}
export function wavDuration(b){
  if(b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE')throw new Error('配音不是有效 WAV');
  let rate=0,size=0;for(let i=12;i+8<=b.length;){const tag=b.toString('ascii',i,i+4),len=b.readUInt32LE(i+4);if(tag==='fmt '&&len>=16)rate=b.readUInt32LE(i+16);if(tag==='data')size=Math.min(len,b.length-i-8);i+=8+len+(len%2);}
  if(!rate||!size)throw new Error('无法读取配音时长');return size/rate;
}
export async function synthesizeMambo(text,output,{fetcher=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),maxPolls=60}={}){
  if(typeof text!=='string'||!text.trim()||text.length>1500)throw new Error('口播需为 1–1500 字');
  const voice=(await listVoices(fetcher)).find(v=>v.name==='曼波');if(!voice)throw new Error('必剪当前未提供曼波音色，不会用其他声音替代');
  const task=await api('/rubick-interface/task',{method:'POST',body:JSON.stringify({model_id:'tts_common_bcut_pc',params:JSON.stringify({expect_mark:0,raw_data:text,raw_params:{pitch_rate:0,sample_rate:24000,speech_rate:0,voice:voice.voice,voice_engine:voice.engine,volume:50}})})},fetcher);
  if(!task.task_id)throw new Error('必剪没有返回任务 ID');
  for(let i=0;i<maxPolls;i++){
    if(i)await sleep(1500);
    const data=await api('/rubick-interface/task/result?model_id=tts_common_bcut_pc&task_id='+encodeURIComponent(task.task_id),{},fetcher);
    if(data.state!==0){if(data.state!==1)throw new Error('必剪配音失败：'+(data.remark||data.state));continue;}
    const result=typeof data.result==='string'?JSON.parse(data.result):data.result;
    if(!result?.audio_url)throw new Error('必剪没有返回音频');
    const u=new URL(result.audio_url);if(u.protocol!=='https:'||!['bilibili.com','bilivideo.com','bilivideo.cn','biliapi.net','hdslb.com'].some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))throw new Error('必剪返回未知音频域名');
    const r=await fetcher(u,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('配音下载失败 HTTP '+r.status);
    const declared=Number(r.headers?.get('content-length')||0);if(declared>50_000_000)throw new Error('配音文件过大');
    const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>50_000_000)throw new Error('配音文件过大');
    const duration=wavDuration(bytes);await fs.writeFile(output,bytes);
    return {voice:voice.name,voiceId:voice.voice,engine:voice.engine,duration,bytes:bytes.length};
  }
  throw new Error('必剪配音等待超时，请稍后重试');
}
