export const SUPPLIERS = {
  vat: {
    id:'vat', vat:true, short:'ООО «СТК „Система Арт СПБ“»',
    full:'Общество с ограниченной ответственностью «Свето-техническая компания „Система Арт СПБ“»', city:'Санкт-Петербург',
    signer:'Родюк Андрей Леонтьевич', signerGen:'Родюка Андрея Леонтьевича', title:'Генеральный директор', titleGen:'генерального директора', powers:'Устава',
    address:'188651, Ленинградская область, м. р-н Всеволожский, г.п. Сертоловское, г. Сертолово, мкр. Чёрная Речка, ул. Любимая, д. 5, кв. 24',
    postal:'188632, Ленинградская область, м. р-н Всеволожский, г.п. Сертоловское, г. Сертолово, мкр. Чёрная Речка, а/я № 4',
    inn:'4706055778', kpp:'470601001', ogrn:'1234700001062', bank:'Филиал «Центральный» Банка ВТБ (ПАО)', bic:'044525411', account:'40702810726740000653', correspondent:'30101810145250000411', email:'info@sysart.ru',
    exchange:'Стороны договорились использовать для обмена информацией и документами по договору электронную почту, указанную в реквизитах Сторон, с обязательной досылкой оригиналов.'
  },
  'no-vat': {
    id:'no-vat', vat:false, short:'ООО СТК «Система Арт»',
    full:'Общество с ограниченной ответственностью «Свето-техническая компания „Система Арт“»', city:'Владивосток',
    signer:'Клементьев Андрей Анатольевич', signerGen:'Клементьева Андрея Анатольевича', title:'Исполнительный директор', titleGen:'исполнительного директора', powers:'доверенности № 2 от 09.01.2024',
    address:'690089, Приморский край, г. Владивосток, ул. Днепровская, д. 29, офис 1', postal:'690089, Приморский край, г. Владивосток, ул. Днепровская, д. 29, офис 1',
    inn:'2543125743',kpp:'254301001',ogrn:'1182536016948',okpo:'28687062',bank:'Филиал «Центральный» Банка ВТБ (ПАО)',bic:'044525411',account:'40702810913540000116',correspondent:'30101810145250000411',email:'info@sysart.ru',
    exchange:'Стороны договорились использовать для обмена информацией и документами по договору систему электронного документооборота и электронную почту, указанную в реквизитах Сторон.'
  }
};
export const format = n => new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(n);
export const today = () => { const d=new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); };
export function longDate(value) {
  const [y,m,d]=String(value).split('-').map(Number);
  const months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  return `«${String(d).padStart(2,'0')}» ${months[m-1]} ${y} г.`;
}
export function initialForm(quote) {
  const date=today();
  const payment=quote.meta.payment || '';
  const percentages=[...payment.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map(x=>Number(x[1].replace(',','.')));
  const split=percentages.length===1&&percentages[0]===100?[100,0]:percentages.length===2&&percentages[0]+percentages[1]===100?percentages:['',''];
  return {
    number:'',date,validUntil:date.slice(0,4)+'-12-31',company:quote.vat?'vat':'no-vat',
    buyerName:quote.meta.client||'',buyerAddress:'',buyerPostal:'',buyerInn:'',buyerKpp:'',buyerOgrn:'',buyerBank:'',buyerBic:'',buyerAccount:'',buyerCorrespondent:'',buyerEmail:'',buyerPhone:'',buyerEdo:'',
    signer:'',signerGen:'',title:'Генеральный директор',titleGen:'генерального директора',powers:'Устава',
    object:quote.meta.object||'',scope:'Оборудование для архитектурного освещения',deliveryCity:'',delivery:quote.meta.delivery||'',deliveryStart:'с даты поступления предоплаты',shipping:'До склада транспортной компании в городе доставки; за счёт Поставщика.',
    advance:split[0],balance:split[1],balanceEvent:'перед отгрузкой из г. Владивостока',validDays:quote.vat?'10':'3',exchange:quote.vat?'originals':'edo',reviewed:false
  };
}
export function specification(quote,company) {
  const target=SUPPLIERS[company];
  if(!target)throw Error('Выберите поставщика.');
  const factor=Number(quote.vatCoef)||1.22;
  const ratio=target.vat===quote.vat?1:target.vat?factor:1/factor;
  const items=quote.items.map(l=>{const price=Math.round(l.price*ratio);return {...l,price,sum:Math.round(price*l.qty)};});
  const total=items.reduce((s,l)=>s+l.sum,0);
  const vatPercent=Math.round((factor-1)*100);
  return {items,total,tax:target.vat?Math.round(total*(factor-1)/factor):0,vatPercent,vat:target.vat};
}
const fieldNames={number:'Номер договора',date:'Дата договора',validUntil:'Срок действия договора',buyerName:'Наименование покупателя',buyerAddress:'Юридический адрес',buyerInn:'ИНН покупателя',buyerKpp:'КПП покупателя',buyerOgrn:'ОГРН покупателя',buyerBank:'Банк',buyerBic:'БИК',buyerAccount:'Расчётный счёт',buyerCorrespondent:'Корреспондентский счёт',signer:'ФИО подписанта',signerGen:'ФИО в родительном падеже',title:'Должность',titleGen:'Должность в родительном падеже',powers:'Основание полномочий',object:'Объект',scope:'Наименование поставки',deliveryCity:'Город доставки',delivery:'Срок поставки',deliveryStart:'Начало отсчёта срока',shipping:'Условия доставки'};
export function validate(form,quote,{review=true}={}) {
  const errors={};
  for(const [key,label] of Object.entries(fieldNames)) if(!String(form[key]??'').trim())errors[key]=`Заполните: ${label.toLowerCase()}.`;
  const digits={buyerInn:10,buyerKpp:9,buyerOgrn:13,buyerBic:9,buyerAccount:20,buyerCorrespondent:20};
  for(const [key,length] of Object.entries(digits)) if(form[key]&&!new RegExp('^\\d{'+length+'}$').test(form[key])) errors[key]=`${fieldNames[key]}: ${length} цифр без пробелов.`;
  const inn=String(form.buyerInn||'');
  if(/^\d{10}$/.test(inn)){
    const weights=[2,4,10,3,5,9,4,6,8];
    const checksum=weights.reduce((sum,w,i)=>sum+w*Number(inn[i]),0)%11%10;
    if(checksum!==Number(inn[9])||/^0+$/.test(inn))errors.buyerInn='Проверьте ИНН: контрольная цифра не совпадает.';
  }
  const ogrn=String(form.buyerOgrn||'');
  if(/^\d{13}$/.test(ogrn)&&Number(BigInt(ogrn.slice(0,12))%11n%10n)!==Number(ogrn[12]))errors.buyerOgrn='Проверьте ОГРН: контрольная цифра не совпадает.';
  for(const key of ['date','validUntil']){
    const v=String(form[key]||''),d=new Date(v+'T12:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(+d)||d.toISOString().slice(0,10)!==v)errors[key]='Укажите корректную дату.';
  }
  if(form.validUntil<form.date)errors.validUntil='Срок действия не может закончиться раньше даты договора.';
  const a=Number(form.advance),b=Number(form.balance);
  if(form.advance===''||form.balance===''||!Number.isFinite(a+b)||a<0||b<0||a>100||b>100||Math.abs(a+b-100)>0.0001) errors.advance='Предоплата и остаток должны давать 100%.';
  if(b>0&&!String(form.balanceEvent||'').trim())errors.balanceEvent='Укажите условие окончательного платежа.';
  if(!/^\d+$/.test(String(form.validDays))||+form.validDays<1||+form.validDays>365)errors.validDays='Укажите срок действия цены от 1 до 365 дней.';
  if(form.buyerEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.buyerEmail))errors.buyerEmail='Проверьте email.';
  if(!SUPPLIERS[form.company])errors.company='Выберите поставщика.';
  if(!quote?.items?.length)errors.spec='В КП нет позиций.';
  else if(quote.items.some(l=>!Number.isFinite(l.price)||l.price<0||!Number.isFinite(l.qty)||l.qty<=0||!String(l.name||'').trim()))errors.spec='Проверьте наименования, количества и цены в КП.';
  if(review&&!form.reviewed)errors.reviewed='Подтвердите проверку данных на последнем шаге.';
  return errors;
}
function partyLines(p,buyer=false) {
  const values=buyer?{
    name:p.buyerName,address:p.buyerAddress,postal:p.buyerPostal||p.buyerAddress,inn:p.buyerInn,kpp:p.buyerKpp,ogrn:p.buyerOgrn,bank:p.buyerBank,bic:p.buyerBic,account:p.buyerAccount,correspondent:p.buyerCorrespondent,email:p.buyerEmail,phone:p.buyerPhone,edo:p.buyerEdo,title:p.title,signer:p.signer
  }:{...p,name:p.short};
  return [(buyer?'ПОКУПАТЕЛЬ:':'ПОСТАВЩИК:'),values.name,'Юридический адрес: '+values.address,values.postal!==values.address?'Почтовый адрес: '+values.postal:'','ИНН: '+values.inn,'КПП: '+values.kpp,'ОГРН: '+values.ogrn,values.okpo?'ОКПО: '+values.okpo:'','Расчётный счёт: '+values.account,'Банк: '+values.bank,'БИК: '+values.bic,'Корреспондентский счёт: '+values.correspondent,values.email?'Email: '+values.email:'',values.phone?'Телефон: '+values.phone:'',values.edo?'ЭДО: '+values.edo:'',values.title,'________________________',values.signer].filter(Boolean);
}
export function contractData(form,quote) {
  const p=SUPPLIERS[form.company],spec=specification(quote,form.company);
  const warranty=quote.warrantyYears===5?'5 лет':'3 года';
  const days=+form.validDays;
  const daysText=days%10===1&&days%100!==11?'календарного дня':days%10>=2&&days%10<=4&&(days%100<12||days%100>14)?'календарных дней':'календарных дней';
  const preamble=`${p.full}, именуемое в дальнейшем «Поставщик», в лице ${p.titleGen} ${p.signerGen}, действующего на основании ${p.powers}, с одной стороны, и ${form.buyerName}, именуемое в дальнейшем «Покупатель», в лице ${form.titleGen} ${form.signerGen} (на основании ${form.powers}), с другой стороны, совместно именуемые «Стороны», заключили настоящий договор о нижеследующем:`;
  const payment=+form.balance===0?'Предоплата за оборудование — 100%.':`Предоплата за оборудование — ${form.advance}%. Окончательный расчёт — ${form.balance}% ${form.balanceEvent}.`;
  const exchange=form.exchange==='edo'?SUPPLIERS['no-vat'].exchange:SUPPLIERS.vat.exchange;
  const tokens={number:form.number,city:p.city,dateLong:longDate(form.date),preamble,warrantyMonths:quote.warrantyYears===5?'60 (шестьдесят)':'36 (тридцать шесть)',validUntil:longDate(form.validUntil).replace(/\.$/,''),exchange,
    buyerBlock:partyLines(form,true),supplierBlock:partyLines(p),taxCaption:spec.vat?'с НДС':'без НДС',taxLabel:spec.vat?`В том числе НДС ${spec.vatPercent}%`:'НДС',taxAmount:spec.vat?format(spec.tax):'Без НДС',total:format(spec.total),object:form.object,scope:form.scope,deliveryCity:form.deliveryCity,delivery:form.delivery.replace(/[.\s]+$/,''),deliveryStart:form.deliveryStart.replace(/[.\s]+$/,''),shipping:form.shipping,payment,warranty,validDaysText:days+' '+daysText};
  return {company:form.company,tokens,items:spec.items.map((l,i)=>({index:String(i+1),name:l.name,unit:l.unit,qty:String(l.qty).replace('.',','),price:format(l.price),sum:format(l.sum)})),spec};
}
export function fingerprint(q){return JSON.stringify({id:q.id,vat:q.vat,vatCoef:q.vatCoef,warrantyYears:q.warrantyYears,rate:q.rate,items:q.items,meta:q.meta});}
