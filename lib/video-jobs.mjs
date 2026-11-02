import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createVideo} from './video.mjs';
import {findConcat} from './concat.mjs';
export function videoJobs(dataDirectory){
 const base=path.join(dataDirectory,'videos');fs.mkdirSync(base,{recursive:true});let active=null;
 const valid=id=>/^[0-9a-f-]{36}$/.test(id);
 function read(id){if(!valid(id))throw new Error('视频 ID 无效');const p=path.join(base,id,'job.json');if(!fs.existsSync(p))throw new Error('视频任务不存在');let job=JSON.parse(fs.readFileSync(p));if(job.status==='running'&&id!==active)job={...job,status:'interrupted',step:'上次服务中断，请重新生成'};return job;}
 const save=job=>{const file=path.join(base,job.id,'job.json');fs.writeFileSync(file+'.tmp',JSON.stringify(job,null,2));fs.renameSync(file+'.tmp',file);};
 return {
  info(){const jobs=fs.readdirSync(base).filter(valid).map(id=>{try{return read(id);}catch{return null;}}).filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,12);return {available:!!findConcat(),voice:'必剪内置曼波（在线生成，之后缓存）',active,jobs};},
  read,
  saveToDownloads(id){const job=read(id);if(job.status!=='completed')throw new Error('视频还没完成');const folder=path.join(os.homedir(),'Downloads','大A整活实验室-成片');fs.mkdirSync(folder,{recursive:true});const output=path.join(folder,`大A整活实验室-${id.slice(0,8)}.mp4`);if(!fs.existsSync(output))fs.copyFileSync(path.join(base,id,'daily.mp4'),output,fs.constants.COPYFILE_EXCL);return {saved:true,path:output,bytes:fs.statSync(output).size,note:'文件已保存到运行本地服务的电脑。'};},
  file(id,name){read(id);if(!['daily.mp4','cover.png','preview.png','voice.wav','captions.srt','narration.txt','publish.txt','story.json','input-snapshot.json','manifest.json'].includes(name))throw new Error('文件不存在');const p=path.join(base,id,name);if(!fs.existsSync(p))throw new Error('文件尚未生成');return p;},
  start(account,analyses,{episode=1}={}){
    if(active)throw new Error('已有视频正在生成，请等待完成');if(!findConcat())throw new Error('需要先安装 Concat');
    const id=crypto.randomUUID(),directory=path.join(base,id);fs.mkdirSync(directory);const job={id,status:'running',episode,progress:1,step:'准备账本与口播',accountId:account.id,accountName:account.name,createdAt:new Date().toISOString()};save(job);active=id;
    createVideo({directory,account:structuredClone(account),analyses:structuredClone(analyses),episode,onProgress:update=>{Object.assign(job,update);save(job);}}).then(manifest=>{Object.assign(job,{status:'completed',progress:100,step:'MP4、字幕、配音与工程已完成',manifest,completedAt:new Date().toISOString()});save(job);}).catch(e=>{Object.assign(job,{status:'failed',step:e.message,error:e.message});save(job);}).finally(()=>{active=null;});return job;
  }
 };
}
