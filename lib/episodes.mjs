export const COLLECTION='给AI一千万，看它交学费';
export function allocateEpisode(records,accountId,date,requested){
 const existing=records.find(x=>x.accountId===accountId&&x.date===date),all=records.filter(x=>x.accountId===accountId);
 const number=requested===undefined?(existing?.number||Math.max(0,...all.map(x=>x.number))+1):Number(requested);
 if(!Number.isSafeInteger(number)||number<1||number>9999)throw new Error('集数需为1–9999的整数');
 if(all.some(x=>x.date!==date&&x.number===number))throw new Error('该集数已用于其他日期，请换一个');
 if(existing)existing.number=number;else records.push({accountId,date,number});return number;
}
