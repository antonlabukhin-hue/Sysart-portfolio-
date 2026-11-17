const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const children=(node,name)=>Array.from(node.children||node.childNodes||[]).filter(n=>n.nodeType===1&&n.localName===name&&n.namespaceURI===W);
const all=(node,name)=>Array.from(node.getElementsByTagNameNS(W,name));
const text=node=>all(node,'t').map(n=>n.textContent).join('');
export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function replaceText(node,tokens) {
  for(const t of all(node,'t'))t.textContent=t.textContent.replace(/\{\{([^{}]+)\}\}/g,(match,key)=>Object.hasOwn(tokens,key)?String(tokens[key]):match);
}
export async function buildContract(data,{Zip=window.JSZip,template}={}) {
  const bytes=template||await fetch('contract-templates/'+data.company+'.docx',{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('Шаблон договора недоступен.');return r.arrayBuffer();});
  const zip=await Zip.loadAsync(bytes);
  const doc=new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'),'application/xml');
  if(doc.getElementsByTagName('parsererror').length)throw Error('Не удалось прочитать шаблон договора.');
  const itemRow=all(doc,'tr').find(row=>text(row).includes('{{item.index}}'));
  if(!itemRow)throw Error('В шаблоне отсутствует строка спецификации.');
  for(const item of data.items){const row=itemRow.cloneNode(true);replaceText(row,Object.fromEntries(Object.entries(item).map(([k,v])=>['item.'+k,v])));itemRow.parentNode.insertBefore(row,itemRow);}
  itemRow.remove();
  for(const p of [...all(doc,'p')]){
    const value=text(p),key=value.match(/^\{\{(buyerBlock|supplierBlock)\}\}$/)?.[1];
    if(!key)continue;
    for(const line of data.tokens[key]){const clone=p.cloneNode(true);replaceText(clone,{[key]:line});p.parentNode.insertBefore(clone,p);}
    p.remove();
  }
  replaceText(doc,data.tokens);
  const xml=new XMLSerializer().serializeToString(doc);
  if(/\{\{[^{}]+\}\}/.test(text(doc)))throw Error('В договоре остались незаполненные поля.');
  zip.file('word/document.xml',xml);
  const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
  return {blob,xml,html:documentHtml(doc)};
}
function paragraphHtml(p){
  const value=text(p),pr=children(p,'pPr')[0];
  const align=pr&&children(pr,'jc')[0]?.getAttributeNS(W,'val');
  const heading=/^\d\. [А-ЯЁ .]+$/.test(value);
  const appendix=value==='Приложение № 1';
  const title=value.startsWith('ДОГОВОР ПОСТАВКИ №');
  const runs=children(p,'r').map(r=>{
    let content=Array.from(r.childNodes).map(n=>n.localName==='t'?escapeHtml(n.textContent):n.localName==='br'?'<br>':n.localName==='tab'?' &emsp; ':'').join('');
    const rp=children(r,'rPr')[0];
    if(rp&&children(rp,'b').some(n=>n.getAttributeNS(W,'val')!=='0'))content='<strong>'+content+'</strong>';
    return content;
  }).join('');
  const cls=title?'contract-title':appendix?'appendix-title':heading?'clause-heading':'';
  return `<p class="${cls}"${align==='center'||align==='right'?` style="text-align:${align}"`:''}>${runs||'&nbsp;'}</p>`;
}
function tableHtml(table){
  const rows=children(table,'tr');
  return '<table>'+rows.map(row=>{
    const pr=children(row,'trPr')[0],header=pr&&children(pr,'tblHeader').length;
    return '<'+(header?'thead':'tbody')+'><tr>'+children(row,'tc').map(cell=>{
      const cp=children(cell,'tcPr')[0],span=cp&&children(cp,'gridSpan')[0]?.getAttributeNS(W,'val');
      return `<${header?'th':'td'}${span?` colspan="${Number(span)}"`:''}>`+children(cell,'p').map(paragraphHtml).join('')+`</${header?'th':'td'}>`;
    }).join('')+'</tr></'+(header?'thead':'tbody')+'>';
  }).join('')+'</table>';
}
export function documentHtml(doc){
  const body=all(doc,'body')[0];
  return Array.from(body.children||body.childNodes).filter(n=>n.nodeType===1).map(n=>n.localName==='p'?paragraphHtml(n):n.localName==='tbl'?tableHtml(n):'').join('');
}
export const printStyles=`
@page{size:A4;margin:18mm 17mm 18mm 22mm}*{box-sizing:border-box}body{color:#000;background:#fff;margin:0;font-family:'Times New Roman',serif;font-size:11pt;line-height:1.15}p{margin:0 0 3pt;text-align:justify;overflow-wrap:anywhere}strong{font-weight:bold}.contract-title{text-align:center!important;font-size:14pt;font-weight:bold;margin:0 0 12pt}.clause-heading{font-weight:bold;margin-top:8pt;break-after:avoid}.appendix-title{break-before:page;text-align:right!important;font-weight:bold}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:8pt 0}td,th{border:1px solid #d9d9d9;padding:5pt;vertical-align:top;font-size:10pt;overflow-wrap:anywhere}th{background:#eee;color:#000;font-weight:bold}td p,th p{font-size:inherit;margin:0 0 3pt;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}table:has(th) th:nth-child(1){width:5%}table:has(th) th:nth-child(2){width:47%}table:has(th) th:nth-child(3){width:7%}table:has(th) th:nth-child(4){width:10%}table:has(th) th:nth-child(5){width:14%}table:has(th) th:nth-child(6){width:17%}table:not(:has(th)) tr{break-inside:auto}table:not(:has(th)) td{width:50%}table:not(:has(th)){margin:5pt 0}table:not(:has(th)) td{font-size:9pt;padding:4pt}table:not(:has(th)) td p{break-inside:avoid;margin:0;line-height:1.1}
`;
