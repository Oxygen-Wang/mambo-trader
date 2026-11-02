import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep,basename} from 'node:path';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {once} from 'node:events';

test('完整服务：认证、模型结论留档、不自动下单、密钥不落账本', {timeout:30000}, async()=>{
  const dir=mkdtempSync(join(tmpdir(),'paper-arena-test-'));
  const mock=http.createServer(async(req,res)=>{
    let body='';for await(const c of req)body+=c;
    const parsed=JSON.parse(body);assert.equal(parsed.model,'fixture-model');
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({model:'fixture-model',choices:[{message:{content:JSON.stringify({summary:'离线接口验收数据，非投资结论',candidates:[{symbol:'sh600036',action:'HOLD',weightPct:0,forecast:{low:-2,base:0,high:2},reason:'接口测试'}],risk:'测试',joke:'只测接口，不测运气'})}}]}));
  });mock.listen(0,'127.0.0.1');await once(mock,'listening');
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:dir,APP_PASSWORD:'fixture-password',APP_API_TOKEN:'fixture-token'},stdio:['ignore','pipe','pipe']});
  try{
    const base=await new Promise((resolve,reject)=>{let out='';const timeout=setTimeout(()=>reject(new Error('启动超时')),5000);child.stdout.on('data',d=>{out+=d;const m=out.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(m){clearTimeout(timeout);resolve('http://127.0.0.1:'+m[1]);}});child.once('error',reject);});
    assert.equal((await fetch(base+'/api/state')).status,401);
    const headers={Authorization:'Bearer fixture-token','Content-Type':'application/json'};
    const s=await (await fetch(base+'/api/state',{headers})).json();
    const id=s.accounts[0].id;
    assert.equal(s.accounts[0].cash,10000000);
    const r=await fetch(base+'/api/analyze',{method:'POST',headers,body:JSON.stringify({accountId:id,baseUrl:`http://127.0.0.1:${mock.address().port}`,model:'fixture-model',apiKey:'fake-test-key-never-save',strategyVersion:'fixture-v1'})});
    const analysis=await r.json();assert.equal(r.status,200,JSON.stringify(analysis));assert.equal(analysis.executed,false);assert.equal(analysis.candidates[0].forecast.horizonTradingDays,5);
    const exportData=await(await fetch(base+'/api/export',{headers})).json();assert.equal(exportData.accounts[0].trades.length,0);assert.equal(exportData.analyses.length,1);
    assert.equal(readFileSync(join(dir,'ledger.json'),'utf8').includes('fake-test-key-never-save'),false);
    const denied=await fetch(base+'/api/accounts',{method:'POST',headers:{...headers,Origin:'https://untrusted.example'},body:'{}'});assert.equal(denied.status,400);
    const ctx=await(await fetch(base+'/api/research-context?accountId='+id,{headers})).json();
    const agentInput={accountId:id,contextId:ctx.id,model:'Agent fixture（底层模型ID未提供）',summary:'只验证MCP留档，保持空仓',candidates:[]};
    const bad=await fetch(base+'/api/agent-analysis',{method:'POST',headers,body:JSON.stringify({...agentInput,candidates:[{symbol:'sh600036',action:'BUY',weightPct:21,forecast:{low:-1,base:0,high:1}}]})});assert.equal(bad.status,400);
    const agent=await(await fetch(base+'/api/agent-analysis',{method:'POST',headers,body:JSON.stringify(agentInput)})).json();assert.equal(agent.analysisSource,'agent-mcp');assert.equal(agent.identityVerified,false);assert.equal(agent.executed,false);assert.deepEqual(agent.inputSnapshot.quotes,ctx.quotes);
    const reused=await fetch(base+'/api/agent-analysis',{method:'POST',headers,body:JSON.stringify(agentInput)});assert.equal(reused.status,400);
    assert.equal((await(await fetch(base+'/api/export',{headers})).json()).accounts[0].orders.length,0);
    const traversal=await fetch(base+'/api/videos/not-an-id/ledger.json',{headers});assert.equal(traversal.status,400);
  }finally{child.kill();await once(child,'exit').catch(()=>{});mock.close();const resolved=resolve(dir);if(!resolved.startsWith(resolve(tmpdir())+sep)||!basename(resolved).startsWith('paper-arena-test-'))throw new Error('拒绝清理非测试目录');rmSync(resolved,{recursive:true,force:true});}
});
