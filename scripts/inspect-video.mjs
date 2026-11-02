import fs from 'node:fs/promises';
import path from 'node:path';
import {ConcatClient} from '../lib/concat.mjs';
const id=process.argv[2];if(!/^[a-f0-9-]{36}$/.test(id||''))throw new Error('传入视频任务ID');
const dir=path.resolve('data/videos',id),m=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'));
const c=new ConcatClient({roots:[dir]});
try{await c.initialize();await c.tool('project_open',{path:m.project});for(const [label,time] of [['forecast',m.scenes[2].start+1],['actual',m.scenes[3].start+3],['ending',m.scenes[4].start+2]]){const output=path.join(dir,'check-'+label+'.png');await c.tool('preview_frame',{path:m.project,time,output});console.log(output);}await c.tool('project_close',{path:m.project,save:false});}finally{c.close();}
