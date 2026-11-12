const xml = value => String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
  .replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const ns = 'http://schemas.openxmlformats.org';
const word = ns + '/wordprocessingml/2006/main';
const rel = ns + '/officeDocument/2006/relationships';
const pack = ns + '/package/2006/relationships';
const para = (text, size = 22, bold = false, color = '111111') => '<w:p><w:r><w:rPr>' + (bold ? '<w:b/>' : '') +
  '<w:color w:val="' + color + '"/><w:sz w:val="' + size + '"/></w:rPr>' + String(text ?? '').split('\n').map((line, i) =>
    (i ? '<w:br/>' : '') + '<w:t xml:space="preserve">' + xml(line) + '</w:t>').join('') + '</w:r></w:p>';
const page = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

let zipReady;
function loadZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!zipReady) zipReady = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'jszip.min.js';
    script.onload = () => resolve(window.JSZip);
    script.onerror = () => { zipReady = null; script.remove(); reject(new Error('Не удалось загрузить экспорт Word')); };
    document.head.append(script);
  });
  return zipReady;
}

async function jpeg(url, limit, background = '#fff') {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Изображение недоступно');
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .89));
    if (!blob) throw new Error('Не удалось обработать изображение');
    return { bytes: await blob.arrayBuffer(), width: canvas.width, height: canvas.height };
  } finally { bitmap.close(); }
}

export async function buildFullWord(data) {
  const Zip = await loadZip();
  const zip = new Zip();
  const links = [];
  let imageId = 0;
  async function picture(url, width, height, name, limit = 1600, background = '#fff') {
    if (!url) return '';
    const pic = await jpeg(url, limit, background);
    const n = ++imageId;
    const file = 'photo' + n + '.jpg';
    zip.file('word/media/' + file, pic.bytes);
    links.push('<Relationship Id="rId' + n + '" Type="' + rel + '/image" Target="media/' + file + '"/>');
    const scale = Math.min(width / pic.width, height / pic.height);
    const dimensions = ' cx="' + Math.round(pic.width * scale) + '" cy="' + Math.round(pic.height * scale) + '"';
    return '<w:p><w:r><w:drawing><wp:inline><wp:extent' + dimensions + '/><wp:docPr id="' + n +
      '" name="' + xml(name) + '"/><a:graphic><a:graphicData uri="' + ns + '/drawingml/2006/picture">' +
      '<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="' + xml(name) + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="rId' + n + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext' + dimensions + '/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }
  const widths = [430, 1930, 3670, 720, 950, 1040, 1150];
  const row = (cells, head = false) => '<w:tr><w:trPr><w:cantSplit/>' + (head ? '<w:tblHeader/>' : '') +
    '</w:trPr>' + cells.map((cell, i) => '<w:tc><w:tcPr><w:tcW w:w="' + widths[i] +
      '" w:type="dxa"/>' + (head ? '<w:shd w:fill="EEE9E4"/>' : '') +
      '<w:vAlign w:val="center"/></w:tcPr>' + (cell || '<w:p/>') + '</w:tc>').join('') + '</w:tr>';
  let table = '<w:tbl><w:tblPr><w:tblW w:w="9890" w:type="dxa"/>' +
    '<w:tblBorders><w:insideH w:val="single" w:sz="4" w:color="DDD6D0"/></w:tblBorders>' +
    '<w:tblLayout w:type="fixed"/></w:tblPr>' +
    '<w:tblGrid>' + widths.map(w => '<w:gridCol w:w="' + w + '"/>').join('') + '</w:tblGrid>';
  table += row(['№', 'Фото', 'Наименование и характеристики', 'Ед.', 'Кол-во', 'Цена, ₽', 'Сумма, ₽'].map(t => para(t, 17, true)), true);
  for (const [i, item] of data.items.entries()) {
    table += row([para(i + 1, 18), await picture(item.photo, 1090000, 910000, item.name, 500),
      para(item.name, 19), para(item.unit, 18), para(item.qty, 18), para(item.price, 18), para(item.sum, 18)]);
  }
  table += '</w:tbl>';
  const visuals = data.visuals || (data.visual ? [data.visual] : []);
  const headerLogo = data.partner ? para(data.company, 30, true, 'FFFFFF') :
    await picture('logo.png', 1550000, 680000, 'Логотип компании', 500, '#0a0a0a');
  const contacts = (data.contacts || []).concat(data.partner ? [] : ['sysartspb.com']);
  const headerCell = content => '<w:tc><w:tcPr><w:shd w:fill="0A0A0A"/><w:tcMar><w:top w:w="220" w:type="dxa"/><w:left w:w="220" w:type="dxa"/><w:bottom w:w="220" w:type="dxa"/><w:right w:w="220" w:type="dxa"/></w:tcMar></w:tcPr>' + content + '</w:tc>';
  const header = '<w:tbl><w:tblPr><w:tblW w:w="9890" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="6200"/><w:gridCol w:w="3690"/></w:tblGrid><w:tr>' +
    headerCell(headerLogo + para('АРХИТЕКТУРНОЕ ОСВЕЩЕНИЕ', 15, false, 'EF3B36') + para('Коммерческое предложение', 36, true, 'FFFFFF')) +
    headerCell(contacts.map(value => para(value, 17, false, 'CFCBC3')).join('') || '<w:p/>') + '</w:tr></w:tbl>';
  const object = data.object?.trim() || '';
  const visualTitle = object ? 'Визуализация: ' + object : 'Визуализация';
  let body = '';
  for (const [index, visual] of (visuals.length ? visuals : ['']).entries()) {
    if (index) body += page;
    const pageHeader = header.replace(/<wp:docPr id="\d+"/, '<wp:docPr id="' + (++imageId) + '"');
    body += pageHeader + para('КП № ' + data.number + ' · ' + data.date, 19) +
      (data.client ? para('Заказчик: ' + data.client, 20) : '') +
      para(visualTitle + (visuals.length > 1 ? ' · ' + (index + 1) + ' / ' + visuals.length : ''), 26, true) +
      (visual ? await picture(visual, 6100000, 5300000, 'Визуализация объекта ' + (index + 1)) : para('Место для визуализации объекта', 22, false, '8C8B86'));
  }
  body += page + para('02 / Спецификация светильников', 34, true) + table +
    para('Итого: ' + data.total + ' ₽', 26, true) + para(data.tax) +
    data.terms.map(t => para(t, 19)).join('') + (data.note ? para(data.note, 19) : '') +
    data.signature.map(t => para(t, 19)).join('');
  if (data.projects.length) {
    body += page + para('03 / Примеры выполненных работ', 34, true);
    for (const project of data.projects) {
      body += '<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>' +
        xml(project.name) + '</w:t></w:r></w:p>' +
        await picture(project.photo, 6100000, 2200000, project.name) +
        para([project.city, project.year].filter(Boolean).join(' · '), 19);
    }
  }
  zip.file('[Content_Types].xml', '<Types xmlns="' + ns + '/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="jpg" ContentType="image/jpeg"/>' +
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="' + pack + '"><Relationship Id="rId1" Type="' + rel +
    '/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="' + pack + '">' + links.join('') + '<Relationship Id="rIdFooter" Type="' + rel + '/footer" Target="footer1.xml"/></Relationships>');
  zip.file('word/footer1.xml', '<w:ftr xmlns:w="' + word + '"><w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="6" w:color="EF3B36"/></w:pBdr><w:spacing w:before="90"/><w:tabs><w:tab w:val="right" w:pos="9800"/></w:tabs></w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="77716D"/></w:rPr><w:t>' + xml(data.company) + '</w:t><w:tab/><w:t>КП № ' + xml(data.number) + ' · </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>');
  zip.file('word/document.xml', '<w:document xmlns:w="' + word + '" xmlns:r="' + rel + '" xmlns:wp="' + ns +
    '/drawingml/2006/wordprocessingDrawing" xmlns:a="' + ns + '/drawingml/2006/main" xmlns:pic="' + ns +
    '/drawingml/2006/picture"><w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:footerReference w:type="default" r:id="rIdFooter"/><w:pgMar w:top="880" w:right="970" w:bottom="880" w:left="970" w:header="400" w:footer="400" w:gutter="0"/>' +
    '</w:sectPr></w:body></w:document>');
  return zip.generateAsync({type:'blob', compression:'DEFLATE',
    mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}
