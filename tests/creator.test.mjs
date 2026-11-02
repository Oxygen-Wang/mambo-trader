import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {newAccount,valuation} from '../public/engine.mjs';
import {buildStory,OPENING,DISCLAIMER} from '../lib/story.mjs';
import {captionChunks} from '../lib/video.mjs';
import {synthesizeMambo,wavDuration} from '../lib/bcut.mjs';
import {toolDefinitions} from '../mcp-server.mjs';
import {assertAgentBudget} from '../lib/agent-risk.mjs';
import {allocateEpisode} from '../lib/episodes.mjs';

test('口播固定开头与声明，缺分析不编造模型和预测，演示明确标记',()=>{
 const a=newAccount();a.valuation=valuation(a,{});const s=buildStory(a,[]);assert.equal(s.scenes[0].voice,OPENING);assert.ok(s.scenes.at(-1).voice.endsWith(DISCLAIMER));assert.match(s.scenes[1].voice,/尚未/);assert.match(s.scenes[2].voice,/预测暂缺/);assert.match(s.scenes[3].voice,/还没开仓/);a.mode='demo';assert.match(buildStory(a,[]).scenes[0].voice,/演示合成行情/);
});
test('已有分析保留身份与日期，不把主观情景混入实际盈亏',()=>{
 const a=newAccount();a.valuation=valuation(a,{});const s=buildStory(a,[{id:'analysis-1',accountId:a.id,requestedModel:'actual-agent',createdAt:'2026-11-01T08:00:00Z',summary:'有时间戳的研究',candidates:[{symbol:'sh600036',forecast:{low:-5,base:2,high:7,horizonTradingDays:5}}]}]);assert.equal(s.model,'actual-agent');assert.match(s.scenes[1].lines[0],/2026/);assert.equal(s.analysisId,'analysis-1');assert.match(s.scenes[2].voice,/主观情景/);assert.match(s.scenes[3].voice,/累计0元/);
});
test('字幕保持全部原文且限制长度',()=>{const s='这里是大A整活实验室！'+OPENING+DISCLAIMER;const chunks=captionChunks(s);assert.equal(chunks.join(''),s);assert.ok(chunks.every(s=>s.length<=20));});
test('字幕不把百分比与金额拆成两句',()=>{const chunks=captionChunks('当前资产10,000,000.25元，累计收益率+0.25%。');assert.ok(chunks.some(s=>s.includes('10,000,000.25')));assert.ok(chunks.some(s=>s.includes('+0.25%')));});
test('曼波适配选择接口真实音色、有限轮询、验证音频，不替换声音',async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'arena-voice-')),file=path.join(root,'voice.wav');
 const wav=Buffer.alloc(44+9600);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(9600,40);
 const respond=v=>new Response(JSON.stringify({code:0,data:v}),{headers:{'Content-Type':'application/json'}});let payload,polls=0;
 const fetcher=async(url,opts)=>{url=String(url);if(url.includes('/tts/list'))return respond({categories:[{title:'特色',materials:[{name:'曼波',voice:'real-test-id',voice_engine:'test-engine'}]}]});if(url.includes('/task/result')){polls++;return respond(polls===1?{state:1}:{state:0,result:JSON.stringify({audio_url:'https://audio.hdslb.com/test.wav'})});}if(url.includes('/rubick-interface/task')){payload=JSON.parse(opts.body);return respond({task_id:'test'});}return new Response(wav);};
 try{const result=await synthesizeMambo('只做接口测试',file,{fetcher,sleep:async()=>{},maxPolls:3});assert.equal(result.voice,'曼波');assert.equal(result.duration,.1);assert.equal(JSON.parse(payload.params).raw_params.voice,'real-test-id');assert.equal(wavDuration(readFileSync(file)),.1);await assert.rejects(synthesizeMambo('测试',file,{fetcher:async()=>respond({categories:[]})}),/未提供曼波/);await assert.rejects(synthesizeMambo('测试',file,{fetcher:async(u,o)=>String(u).includes('/task/result')?respond({state:1}):fetcher(u,o),sleep:async()=>{},maxPolls:2}),/超时/);}finally{const resolved=path.resolve(root),parent=path.resolve(os.tmpdir())+path.sep;if(!resolved.startsWith(parent)||!path.basename(resolved).startsWith('arena-voice-'))throw new Error('拒绝清理非测试目录');rmSync(resolved,{recursive:true,force:true});}
});
test('MCP 暴露 Agent 分析、模拟交易与视频闭环，不需要付费模型接口',()=>{for(const name of ['market_state','research_context','record_analysis','place_paper_order','generate_daily_video','video_job_status'])assert.ok(toolDefinitions.some(t=>t.name===name));assert.equal(toolDefinitions.find(t=>t.name==='market_state').annotations.readOnlyHint,true);assert.equal(toolDefinitions.find(t=>t.name==='record_analysis').inputSchema.required.includes('model'),true);});
test('Agent 仓位限制包含待成交委托与已有持仓',()=>{const a=newAccount();assert.doesNotThrow(()=>assertAgentBudget(a,{symbol:'sh600036',side:'BUY',qty:10000,limit:40},{}));assert.throws(()=>assertAgentBudget(a,{symbol:'sh600036',side:'BUY',qty:60000,limit:40},{}),/20%/);a.orders=[{status:'pending',side:'BUY',symbol:'sh600036',qty:40000,limit:40}];assert.throws(()=>assertAgentBudget(a,{symbol:'sh600036',side:'BUY',qty:20000,limit:40},{}),/20%/);a.orders=[{status:'pending',side:'BUY',symbol:'sh600036',qty:50000,limit:40},{status:'pending',side:'BUY',symbol:'sh600519',qty:20000,limit:100}];assert.throws(()=>assertAgentBudget(a,{symbol:'sh600900',side:'BUY',qty:50000,limit:40.01},{}),/20%|60%/);});
test('同一交易日重做不增加集数，次日递增且可手动指定',()=>{const r=[];assert.equal(allocateEpisode(r,'a','2026-11-02'),1);assert.equal(allocateEpisode(r,'a','2026-11-02'),1);assert.equal(allocateEpisode(r,'a','2026-11-03'),2);assert.equal(allocateEpisode(r,'a','2026-11-04',8),8);assert.throws(()=>allocateEpisode(r,'a','2026-11-05',8),/其他日期/);assert.throws(()=>allocateEpisode(r,'a','2026-11-06',0),/集数/);});
test('公开视频省略缺失模型身份占位，仍保留策略和结论',()=>{const a=newAccount();a.valuation=valuation(a,{});const record={id:'a',accountId:a.id,requestedModel:'Codex Agent（底层模型ID未提供）',createdAt:new Date().toISOString(),summary:'保持现金观察',candidates:[]};const s=buildStory(a,[record]);assert.doesNotMatch(JSON.stringify(s),/Codex Agent|底层模型ID未提供/);assert.match(s.scenes[1].voice,/保持现金观察/);assert.equal(record.requestedModel,'Codex Agent（底层模型ID未提供）');});
