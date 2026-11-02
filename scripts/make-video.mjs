const base=process.env.ARENA_URL||'http://127.0.0.1:4173',headers={'Content-Type':'application/json',...(process.env.ARENA_TOKEN?{Authorization:'Bearer '+process.env.ARENA_TOKEN}:{})};
async function api(route,input){const r=await fetch(base+'/api/'+route,{method:input?'POST':'GET',headers,body:input?JSON.stringify(input):undefined});const v=await r.json();if(!r.ok)throw new Error(v.error);return v;}
const state=await api('state'),a=process.argv[2]?state.accounts.find(a=>a.id===process.argv[2]):state.accounts.find(a=>a.mode==='live');if(!a)throw new Error('账户不存在');
const job=await api('videos',{accountId:a.id});console.log('视频任务：'+job.id);let status;
do{await new Promise(r=>setTimeout(r,2000));status=await api('videos/'+job.id);console.log(status.progress+'% '+status.step);}while(status.status==='running');
if(status.status!=='completed')throw new Error(status.error||status.step);console.log('成片：'+base+'/api/videos/'+job.id+'/daily.mp4');console.log('工程：'+status.manifest.project);
