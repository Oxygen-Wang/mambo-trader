import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export function findConcat(){
  const choices=[process.env.CONCAT_BIN,process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Programs','Concat','concat.exe'),process.env.ProgramFiles&&path.join(process.env.ProgramFiles,'Concat','concat.exe'),process.platform==='darwin'&&'/Applications/Concat.app/Contents/MacOS/concat',process.platform!=='win32'&&'/usr/bin/concat'].filter(Boolean);
  return choices.find(p=>fs.existsSync(p))||null;
}
export class ConcatClient{
  constructor({roots=[],binary=findConcat(),args=['--mcp','headless'],timeout=60000}={}){
    if(!binary)throw new Error('未找到 Concat，请安装官方版本或设置 CONCAT_BIN。');
    this.pending=new Map();this.seq=0;this.stderr='';this.timeout=timeout;
    this.process=spawn(binary,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,CONCAT_MCP_ROOTS:roots.map(p=>path.resolve(p)).join(path.delimiter)}});
    this.process.stderr.on('data',b=>{this.stderr=(this.stderr+b.toString()).slice(-12000);});
    readline.createInterface({input:this.process.stdout}).on('line',line=>{
      let msg;try{msg=JSON.parse(line);}catch{return;}
      const task=this.pending.get(msg.id);if(!task)return;
      this.pending.delete(msg.id);clearTimeout(task.timer);
      if(msg.error)task.reject(new Error('Concat: '+msg.error.message));else task.resolve(msg.result);
    });
    this.process.on('error',e=>this.fail(e));
    this.process.on('exit',code=>this.fail(new Error(`Concat 退出 (${code})：${this.stderr.slice(-1200)}`)));
    this.process.stdin.on('error',e=>this.fail(e));
  }
  fail(error){for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(error);}this.pending.clear();}
  request(method,params={},timeout=this.timeout){return new Promise((resolve,reject)=>{const id=++this.seq;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Concat 操作超时：'+method));},timeout);this.pending.set(id,{resolve,reject,timer});this.process.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
  async initialize(){const info=await this.request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'ai-paper-arena',version:'0.2.0'}});this.process.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');return info;}
  async tool(name,args={},timeout){const r=await this.request('tools/call',{name,arguments:args},timeout);if(r.isError)throw new Error('Concat '+name+': '+r.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n'));if(r.structuredContent)return r.structuredContent;const text=r.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n');try{return JSON.parse(text);}catch{return text||r;}}
  close(){this.process.stdin.end();this.process.kill();this.fail(new Error('Concat 会话已关闭'));}
}
