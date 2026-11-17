import {SUPPLIERS,initialForm,specification,validate,contractData,format,fingerprint} from './contract-core.mjs?v=2026111801';
import {buildContract,escapeHtml as esc,printStyles} from './contract-export.mjs?v=2026111801';
const $=s=>document.querySelector(s);
let quote=null,form=null,step=0,pendingCompany=null,busy=false,prepared=null,sourceFingerprint='';
const channel=location.hash.slice(1),origin=location.origin;
const fields={
  parties:[
    ['buyerName','Полное наименование покупателя','wide'],['buyerInn','ИНН · организация','', '10 цифр'],['buyerKpp','КПП','', '9 цифр'],['buyerOgrn','ОГРН','wide','13 цифр'],
    ['buyerAddress','Юридический адрес','wide'],['buyerPostal','Почтовый адрес · если отличается','wide'],
    ['signer','ФИО подписанта · для подписи','','Иванов Иван Иванович'],['title','Должность · для подписи','','Генеральный директор'],
    ['signerGen','ФИО в родительном падеже','','Иванова Ивана Ивановича'],['titleGen','Должность в родительном падеже','','генерального директора'],
    ['powers','Основание полномочий · для преамбулы','wide','Устава / доверенности № … от …'],
    ['buyerBank','Наименование банка','wide'],['buyerAccount','Расчётный счёт','','20 цифр'],['buyerBic','БИК','','9 цифр'],['buyerCorrespondent','Корреспондентский счёт','wide','20 цифр'],
    ['buyerEmail','Email','','Для обмена документами','email'],['buyerPhone','Телефон',''],['buyerEdo','Идентификатор ЭДО · при наличии','wide']
  ],
  conditions:[
    ['number','Номер договора','','Например: 64'],['date','Дата договора','','','date'],['object','Объект · из КП','wide'],['scope','Наименование поставки / работ','wide'],
    ['deliveryCity','Город доставки',''],['delivery','Срок производства и поставки',''],['deliveryStart','От какого события считать срок','wide'],
    ['shipping','Доставка по РФ · срок, место и оплата','wide','','textarea'],['advance','Предоплата, %','','','number'],['balance','Окончательный платёж, %','','','number'],
    ['balanceEvent','Условие окончательного расчёта','wide'],['validDays','Цена действительна · календарных дней','','','number'],['validUntil','Договор действует до','','','date']
  ]
};
function fieldHtml([key,label,cls='',placeholder='',type='text']){
  const value=esc(form[key]??'');
  const input=type==='textarea'?`<textarea id="f-${key}" name="${key}" placeholder="${esc(placeholder)}">${value}</textarea>`:`<input id="f-${key}" name="${key}" type="${type}" value="${value}" placeholder="${esc(placeholder)}" ${type==='number'?'min="0" step="1"':''} ${/Inn|Kpp|Ogrn|Bic|Account|Correspondent/.test(key)?'inputmode="numeric"':''}>`;
  return `<label class="field ${cls}" for="f-${key}"><span>${esc(label)}</span>${input}<span class="error" id="err-${key}"></span></label>`;
}
function supplierHtml(){
  const p=SUPPLIERS[form.company];
  return `<div class="companies">${Object.values(SUPPLIERS).map(s=>`<button type="button" class="company ${s.id===form.company?'active':''}" data-company="${s.id}" aria-pressed="${s.id===form.company}"><strong>${esc(s.short)}</strong><span class="pill">${s.vat?'С НДС':'Без НДС'}</span><em>${esc(s.city)} · ${esc(s.signer)}</em></button>`).join('')}</div>
  ${pendingCompany?`<div class="alert" role="status">В КП и договоре будут разные режимы НДС. Итого по текущему КП: <strong>${format(quote.total)} ₽</strong>. В договоре после пересчёта: <strong>${format(specification(quote,pendingCompany).total)} ₽</strong>. Исходное КП останется без изменений.<div class="pending-actions"><button type="button" data-apply-company="${pendingCompany}" class="primary">Пересчитать и выбрать</button><button type="button" id="cancelCompany">Отмена</button></div></div>`:''}
  <div class="supplier"><strong>Реквизиты Поставщика заполнены автоматически</strong><p>ИНН ${p.inn} · КПП ${p.kpp}<br>${esc(p.title)} — ${esc(p.signer)}<br>Основание полномочий — ${esc(p.powers)}</p><details><summary>Проверить адрес и банковские реквизиты</summary><p>${esc(p.address)}<br>Почтовый адрес: ${esc(p.postal)}<br>ОГРН ${p.ogrn}<br>${esc(p.bank)}<br>БИК ${p.bic}<br>р/с ${p.account}<br>к/с ${p.correspondent}<br>${esc(p.email)}</p></details></div>`;
}
function summary(){
  const s=specification(quote,form.company),p=SUPPLIERS[form.company];
  $('#summary').innerHTML=`<span class="badge">ИЗ КП № ${esc(quote.meta.number)}</span><h3 style="margin-top:18px">${esc(form.object||'Объект не указан')}</h3><p class="note">${esc(form.buyerName||'Покупатель не указан')}</p><div class="row"><span>Поставщик</span><strong>${esc(p.short)}</strong></div><div class="row"><span>Позиции</span><strong>${s.items.length}</strong></div><div class="row"><span>Гарантия</span><strong>${quote.warrantyYears===5?'5 лет':'3 года'}</strong></div><div class="total">${format(s.total)} ₽</div><p class="note">${s.vat?'В том числе НДС '+s.vatPercent+'%: '+format(s.tax)+' ₽':'Без НДС'}</p>${p.vat!==quote.vat?'<p class="alert">Спецификация пересчитана для выбранного Поставщика. Исходное КП не изменено.</p>':''}<hr style="border:0;border-top:1px solid var(--line);margin:18px 0"><h3>Комплект документов</h3><div class="check">✓ Договор поставки<br>✓ Спецификация<br>✓ Единые реквизиты сторон</div><p class="note">Word — для корректировок<br>PDF — через «Сохранить как PDF»</p><p class="note">Данные заполняются для покупателя-организации.</p>`;
}
function render(){
  document.querySelectorAll('[data-step]').forEach(b=>{b.classList.toggle('active',+b.dataset.step===step);b.setAttribute('aria-current',+b.dataset.step===step?'step':'false');});
  $('#next').hidden=step===3;
  $('#fields').innerHTML=step===0?`<h2>Поставщик и покупатель</h2>${supplierHtml()}<div class="fields">${fields.parties.map(fieldHtml).join('')}</div><p class="hint">ФИО и должность в родительном падеже используются в преамбуле. Эти поля вводятся отдельно, чтобы избежать ошибок склонения.</p>`:
  step===1?`<h2>Объект и условия договора</h2><div class="fields">${fields.conditions.map(fieldHtml).join('')}<div class="field"><span>Гарантия · из КП</span><div class="readonly">${quote.warrantyYears===5?'5 лет':'3 года'}</div></div><label class="field"><span>Обмен документами</span><select name="exchange"><option value="originals" ${form.exchange==='originals'?'selected':''}>Почта и оригиналы</option><option value="edo" ${form.exchange==='edo'?'selected':''}>ЭДО и электронная почта</option></select></label></div><p class="hint">Условия из КП можно уточнить для договора. Выбранная гарантия и итоговые цены уже перенесены.</p>`:
  step===2?`<h2>Спецификация из КП</h2><p class="hint">Характеристики, количество и конечные цены взяты из текущего КП. Для изменения позиций вернитесь в конструктор, затем обновите данные договора.</p>${specHtml()}<button type="button" id="reloadQuote">Обновить из КП</button>`:
  `<h2>Проверка перед выгрузкой</h2><div id="checkStatus"></div><label class="review"><input type="checkbox" name="reviewed" ${form.reviewed?'checked':''}><span>Реквизиты сторон, спецификация, сроки и условия проверены.</span></label><div class="export-actions"><button type="button" id="exportWord" class="primary">Скачать Word</button><button type="button" id="exportPdf">Скачать PDF</button></div><p class="status" id="exportStatus" role="status"></p><details class="preview" open><summary>Предпросмотр договора и спецификации</summary><div id="documentPreview" class="doc">Подготавливаем предпросмотр…</div></details>`;
  summary();$('#errors').innerHTML='';
  if(step===3)preparePreview();
}
function specHtml(){const s=specification(quote,form.company);return `<div class="quote-table"><table><thead><tr><th>№</th><th>Наименование</th><th>Ед.</th><th>Кол-во</th><th>Цена, ₽</th><th>Сумма, ₽</th></tr></thead><tbody>${s.items.map((l,i)=>`<tr><td>${i+1}</td><td>${esc(l.name)}</td><td>${esc(l.unit)}</td><td>${esc(l.qty)}</td><td>${format(l.price)}</td><td>${format(l.sum)}</td></tr>`).join('')}</tbody></table></div><div class="row"><span>Итого</span><strong>${format(s.total)} ₽</strong></div><p class="hint">${s.vat?'В том числе НДС '+s.vatPercent+'%: '+format(s.tax)+' ₽':'Без НДС'}. Гарантия: ${quote.warrantyYears===5?'5 лет':'3 года'}.</p>`;}
function collect(){
  document.querySelectorAll('#fields [name]').forEach(input=>{form[input.name]=input.type==='checkbox'?input.checked:input.value.trim();});
}
function showErrors(errors){
  const list=Object.entries(errors);$('#errors').innerHTML=list.length?'<strong>Проверьте данные:</strong>'+list.map(([k,v])=>`<button type="button" data-error="${esc(k)}">${esc(v)}</button>`).join(''):'';
  for(const [key,error]of list){const input=document.getElementById('f-'+key),msg=document.getElementById('err-'+key);if(input)input.setAttribute('aria-invalid','true');if(msg)msg.textContent=error;}
}
let previewRequest=0;
async function preparePreview(){
  const request=++previewRequest;
  const errors=validate(form,quote,{review:false});
  if(Object.keys(errors).length){$('#checkStatus').innerHTML='<p class="alert">Не все данные заполнены. Нажмите на ошибку ниже, чтобы перейти к полю.</p>';$('#documentPreview').textContent='Полный договор появится после заполнения обязательных полей.';showErrors(errors);return;}
  $('#checkStatus').innerHTML='<p class="review-status">✓ Обязательные поля заполнены<br>✓ Единый покупатель в договоре и спецификации<br>✓ Гарантия и сумма перенесены из КП</p>';
  try{const result=await buildContract(contractData(form,quote));if(request!==previewRequest||step!==3)return;prepared=result;$('#documentPreview').innerHTML=result.html;}
  catch(e){if(request===previewRequest&&step===3)$('#documentPreview').textContent='Не удалось открыть предпросмотр. '+e.message;}
}
const waiters=new Map();let messageId=0;
function requestSource(type='ready'){
  return new Promise((resolve,reject)=>{
    if(!window.opener||window.opener.closed){reject(Error('Откройте договор из текущего КП в конструкторе.'));return;}
    const requestId=String(++messageId),timer=setTimeout(()=>{waiters.delete(requestId);reject(Error('Нет связи с КП. Оставьте вкладку конструктора открытой.'));},12000);
    waiters.set(requestId,{resolve,reject,timer});window.opener.postMessage({type:'sysart:contract:'+type,channel,requestId},origin);
  });
}
window.addEventListener('message',e=>{
  if(e.origin!==origin||e.source!==window.opener||e.data?.channel!==channel)return;
  const entry=waiters.get(e.data.requestId);if(!entry)return;clearTimeout(entry.timer);waiters.delete(e.data.requestId);
  if(e.data.error)entry.reject(Error(e.data.error));else if(e.data.type==='sysart:contract:data')entry.resolve(e.data.quote);
});
async function freshSource(){
  const current=await requestSource('check');
  if(fingerprint(current)!==sourceFingerprint)throw Error('КП изменилось. Вернитесь на шаг «Спецификация» и нажмите «Обновить из КП», затем проверьте договор ещё раз.');
}
async function exportFile(formatName){
  if(busy)return;collect();const errors=validate(form,quote);showErrors(errors);if(Object.keys(errors).length)return;
  busy=true;const buttons=[$('#exportWord'),$('#exportPdf')];buttons.forEach(b=>b.disabled=true);$('#exportStatus').textContent='Проверяем актуальность КП…';
  try{
    await freshSource();
    const output=await buildContract(contractData(form,quote));prepared=output;
    const name=('Договор поставки № '+form.number+' — '+form.buyerName).replace(/[\\/:*?"<>|]/g,'').slice(0,160);
    if(formatName==='word'){
      const url=URL.createObjectURL(output.blob),a=document.createElement('a');a.href=url;a.download=name+'.docx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      $('#exportStatus').textContent='Word подготовлен: договор и спецификация в одном файле.';
    }else{
      const old=$('#contractPrint');if(old)old.remove();
      const iframe=document.createElement('iframe');iframe.id='contractPrint';iframe.title='Договор для печати';iframe.style.cssText='position:fixed;width:1px;height:1px;bottom:0;left:0;border:0;';document.body.append(iframe);
      const doc=iframe.contentDocument;doc.open();doc.write('<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>'+esc(name)+'</title><style>'+printStyles+'</style></head><body>'+output.html+'</body></html>');doc.close();
      await iframe.contentDocument.fonts.ready;iframe.contentWindow.focus();iframe.contentWindow.print();
      $('#exportStatus').textContent='В окне печати выберите «Сохранить как PDF». Договор и спецификация включены в документ.';
    }
  }catch(e){$('#exportStatus').textContent=e.message||'Не удалось подготовить документ.';}
  finally{busy=false;buttons.forEach(b=>b.disabled=false);}
}
$('#fields').addEventListener('input',e=>{
  if(!e.target.name)return;collect();if(e.target.name!=='reviewed'){form.reviewed=false;prepared=null;}
  const msg=document.getElementById('err-'+e.target.name);if(msg)msg.textContent='';e.target.removeAttribute('aria-invalid');
  if(['buyerName','object'].includes(e.target.name))summary();
});
$('#fields').addEventListener('change',()=>{collect();prepared=null;});
$('#workspace').addEventListener('click',async e=>{
  const button=e.target.closest('button');if(!button||busy)return;
  if(button.dataset.step!=null){collect();step=+button.dataset.step;render();return;}
  if(button.dataset.company){
    collect();const next=button.dataset.company;if(next===form.company)return;
    if(SUPPLIERS[next].vat!==SUPPLIERS[form.company].vat){pendingCompany=next;render();return;}
  }
  if(button.id==='cancelCompany'){pendingCompany=null;render();return;}
  if(button.dataset.applyCompany){form.company=button.dataset.applyCompany;form.exchange=SUPPLIERS[form.company].vat?'originals':'edo';form.reviewed=false;pendingCompany=null;prepared=null;render();return;}
  if(button.dataset.error){const key=button.dataset.error;step=fields.parties.some(f=>f[0]===key)?0:key==='reviewed'?3:1;render();document.getElementById('f-'+key)?.focus();return;}
  if(button.id==='next'){collect();step=Math.min(3,step+1);render();return;}
  if(button.id==='exportWord'||button.id==='exportPdf'){await exportFile(button.id==='exportWord'?'word':'pdf');return;}
  if(button.id==='reloadQuote'){
    collect();try{const fresh=await requestSource('check');quote=fresh;sourceFingerprint=fingerprint(fresh);form.company=fresh.vat?'vat':'no-vat';form.object=fresh.meta.object||form.object;form.reviewed=false;pendingCompany=null;prepared=null;render();$('#errors').textContent='Данные КП обновлены. Проверьте спецификацию и условия.';}catch(err){$('#errors').textContent=err.message;}
  }
});
function back(e){if(window.opener&&!window.opener.closed){e.preventDefault();window.opener.focus();}}
$('#back').addEventListener('click',e=>{back(e);if(!window.opener||window.opener.closed)location.href='./';});$('#backLink').addEventListener('click',back);
(async()=>{
  try{if(!channel)throw Error('Откройте текущее КП и нажмите «Подготовить договор».');quote=await requestSource();if(!quote.items?.length)throw Error('В КП нет позиций.');sourceFingerprint=fingerprint(quote);form=initialForm(quote);$('#boot').hidden=true;$('#workspace').hidden=false;render();}
  catch(e){$('#boot').textContent=e.message;}
})();
