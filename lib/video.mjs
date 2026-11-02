import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {synthesizeMambo} from './bcut.mjs';
import {ConcatClient,findConcat} from './concat.mjs';
import {buildStory} from './story.mjs';
import {renderCard,renderCover} from './cards.mjs';

const timestamp=s=>{const ms=Math.round(s*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
export function captionChunks(text,max=18){const result=[];let line='';const tokens=String(text).match(/[+-]?\d[\d,.]*%?|[A-Za-z][A-Za-z0-9_.-]*|[\s\S]/g)||[];for(let token of tokens){while(token.length>max){if(line){result.push(line);line='';}result.push(token.slice(0,max));token=token.slice(max);}if(line.length+token.length>max){result.push(line);line='';}line+=token;if(/[。！？；]$/.test(token)){result.push(line);line='';}}if(line)result.push(line);return result.filter(s=>s.trim());}
function cuesFor(text,start,duration){const chunks=captionChunks(text),total=chunks.reduce((a,x)=>a+x.length,0);let pos=start;return chunks.map((text,i)=>{const end=i===chunks.length-1?start+duration:pos+duration*text.length/total;const c={text,start:pos,end};pos=end;return c;});}
function audioParts(bytes){let fmt,data;for(let p=12;p+8<=bytes.length;){const len=bytes.readUInt32LE(p+4),tag=bytes.toString('ascii',p,p+4);if(tag==='fmt ')fmt=bytes.subarray(p+8,p+8+len);if(tag==='data')data=bytes.subarray(p+8,p+8+len);p+=8+len+(len%2);}if(!fmt||!data)throw new Error('配音 WAV 结构无效');return {fmt,data};}
async function voiceFile(output,segments,pad){const parts=await Promise.all(segments.map(async s=>audioParts(await fs.readFile(s.audioFile))));const fmt=parts[0].fmt;if(!parts.every(p=>p.fmt.equals(fmt)))return null;const silence=Buffer.alloc(Math.round(fmt.readUInt32LE(8)*pad/2)*2),data=Buffer.concat(parts.flatMap(p=>[p.data,silence]));const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(36+data.length,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);fmt.copy(h,20,0,16);h.write('data',36);h.writeUInt32LE(data.length,40);await fs.writeFile(output,Buffer.concat([h,data]));return output;}
export async function createVideo({directory,account,analyses,episode=1,onProgress=()=>{}}){
 if(!findConcat())throw new Error('未找到 Concat。请先安装并设置 CONCAT_BIN。');
 directory=path.resolve(directory);await fs.mkdir(directory,{recursive:true});
 const story=buildStory(account,analyses,{episode}),assetDir=path.join(directory,'assets'),cacheDir=path.join(directory,'..','..','voice-cache');
 await fs.mkdir(assetDir,{recursive:true});await fs.mkdir(cacheDir,{recursive:true});
 await fs.writeFile(path.join(directory,'story.json'),JSON.stringify(story,null,2));
 await fs.writeFile(path.join(directory,'narration.txt'),story.scenes.map(s=>s.voice).join('\n\n'));
 await fs.writeFile(path.join(directory,'publish.txt'),story.title+'\n\n'+story.description+'\n\n标签：AI，模拟炒股，曼波，大A整活实验室');
 await fs.writeFile(path.join(directory,'input-snapshot.json'),JSON.stringify({account,analyses:analyses.filter(r=>r.accountId===account.id)},null,2));
 const scenes=[],captions=[];let cursor=0;const pad=.35;
 for(let i=0;i<story.scenes.length;i++){
   const scene=story.scenes[i];onProgress({progress:5+i*11,step:`曼波配音与画面 ${i+1}/${story.scenes.length}`});
   const imageFile=path.join(assetDir,`${i+1}-${scene.key}.png`),audioFile=path.join(assetDir,`${i+1}-${scene.key}.wav`);
   await fs.writeFile(imageFile,renderCard(scene,story,i));
   const hash=createHash('sha256').update('mambo-v1:'+scene.voice).digest('hex'),cached=path.join(cacheDir,hash+'.wav'),metaFile=path.join(cacheDir,hash+'.json');
   let voice;try{voice=JSON.parse(await fs.readFile(metaFile,'utf8'));await fs.copyFile(cached,audioFile);}catch{voice=await synthesizeMambo(scene.voice,audioFile);await fs.copyFile(audioFile,cached);await fs.writeFile(metaFile,JSON.stringify(voice));}
   const duration=Math.ceil((voice.duration+pad)*24)/24;
   captions.push(...cuesFor(scene.voice,cursor,voice.duration));scenes.push({...scene,imageFile,audioFile,voice,start:cursor,duration});cursor+=duration;
 }
 await fs.writeFile(path.join(directory,'cover.png'),renderCover(story));
 await voiceFile(path.join(directory,'voice.wav'),scenes,pad);
 await fs.writeFile(path.join(directory,'captions.srt'),captions.map((c,i)=>`${i+1}\n${timestamp(c.start)} --> ${timestamp(c.end)}\n${c.text}\n`).join('\n'));
 const c=new ConcatClient({roots:[directory],timeout:60000}),projectName='大A日报-'+story.date,projectPath=path.join(directory,projectName),output=path.join(directory,'daily.mp4');
 try{
   onProgress({progress:62,step:'Concat 建立可编辑工程'});await c.initialize();const version=await c.tool('concat_version');
   const created=await c.tool('project_create',{location:directory,name:projectName,video:{width:720,height:1280,rateNum:24,rateDen:1}});
   const tracks=created.timeline.tracks;
   for(const scene of scenes){
     const image=await c.tool('media_import',{path:projectPath,file:scene.imageFile});
     const clip=await c.tool('clip_add',{path:projectPath,mediaId:image.createdId,trackId:tracks[0].id,start:scene.start});
     await c.tool('clip_trim',{path:projectPath,clipId:clip.createdId,edge:'end',delta:scene.duration-5});
     const audio=await c.tool('media_import',{path:projectPath,file:scene.audioFile});
     await c.tool('clip_add',{path:projectPath,mediaId:audio.createdId,trackId:tracks[1].id,start:scene.start});
   }
   await c.tool('captions_add',{path:projectPath,captions,offsetY:.285,style:{fontFamily:'"Microsoft YaHei"',fontSize:.021,fontWeight:600,color:'#ffffff',background:'#102d24eb',maxWidth:.86,shadow:false,backgroundPaddingY:.009}});
   await c.tool('project_save',{path:projectPath});
   onProgress({progress:73,step:'Concat 渲染 MP4（含曼波与字幕）'});
   const job=await c.tool('export_start',{path:projectPath,output,codec:'h264',crf:21,preset:'fast'});
   let status;const exportDeadline=Date.now()+15*60*1000;
   do{status=await c.tool('export_wait',{job:job.job,timeoutSeconds:20},30000);onProgress({progress:Math.min(96,75+Math.round(Number(status.progress||0)*20)),step:'正在合成画面、字幕和曼波音轨'});if(Date.now()>exportDeadline)throw new Error('视频导出超过15分钟，请检查 Concat。');}while(status.state==='running'||status.status==='running');
   const stat=await fs.stat(output).catch(()=>null);if(!stat||stat.size<10000)throw new Error('Concat 未产生完整 MP4：'+JSON.stringify(status));
   onProgress({progress:97,step:'验证视频尺寸、时长与音轨'});
   const probe=await c.tool('media_probe',{path:output});
   if(!probe.audio||!probe.video||probe.video.width!==720||probe.video.height!==1280||Math.abs(probe.duration-cursor)>.5)throw new Error('视频验证失败：'+JSON.stringify(probe));
   await c.tool('preview_frame',{path:projectPath,time:Math.min(1,cursor/2),output:path.join(directory,'preview.png')});
   await c.tool('project_close',{path:projectPath,save:true});
   const manifest={createdAt:new Date().toISOString(),title:story.title,episode:story.episode,collection:story.collection,virtualOnly:true,voice:'必剪 / 曼波',concat:version.concat,project:projectPath,duration:probe.duration,expectedDuration:cursor,probe,captionTiming:'按句长估算，非逐字强制对齐',scenes:scenes.map(s=>({key:s.key,start:s.start,duration:s.duration,voiceDuration:s.voice.duration})),files:['daily.mp4','cover.png','preview.png','voice.wav','captions.srt','narration.txt','publish.txt','story.json','input-snapshot.json']};
   await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2));
   return manifest;
 }finally{c.close();}
}
