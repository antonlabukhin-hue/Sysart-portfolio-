const prefix='kp.contractDraft.';
export function readDraft(storage,id){
  try{const value=JSON.parse(storage.getItem(prefix+id));return value?.version===1&&value.quote?.id===id&&value.form&&typeof value.form==='object'?value:null;}catch{return null;}
}
export function writeDraft(storage,{quote,form,step}){
  try{storage.setItem(prefix+quote.id,JSON.stringify({version:1,quote,form,step,updated:Date.now()}));return true;}catch{return false;}
}
