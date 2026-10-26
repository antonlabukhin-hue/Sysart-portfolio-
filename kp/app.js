// Конфигуратор КП «Система Арт»: каталог из зашифрованного прайса → настройка модели → КП → PDF.
(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } },
    del(k) { try { localStorage.removeItem(k); } catch { } },
  };
  const uid = () => Math.random().toString(36).slice(2, 10);
  const today = () => new Date().toISOString().slice(0, 10);
  const fmt = n => n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ');
  const fmtDate = s => s ? s.split('-').reverse().join('.') : '';

  let DATA = null;
  let PROD = {};

  const DEFAULT_TERMS = [
    'Отгрузка со склада в г. Владивостоке.',
    'Доставка оптовых партий по РФ до региона заказчика авто/ж-д — за счёт поставщика.',
    'В гарантию входит запас 3 % от количества поставки за счёт поставщика.',
    'Проектирование засчитывается в сумму договора поставки.',
  ].join('\n');

  const S = Object.assign({
    rate: null, vat: true, adjust: 0, round: 100,
    manager: { name: 'Антон Андреевич Лабухин', title: 'Директор по развитию', phone: '+7 914 970-40-00', email: 'info@sysart.ru' },
    company: 'ООО «Светотехническая компания «Система Арт», Санкт-Петербург',
    terms: DEFAULT_TERMS,
  }, store.get('kp.settings', {}));
  const saveSettings = () => store.set('kp.settings', S);

  // ---------- Расшифровка прайса ----------
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function decrypt(pass) {
    const enc = await (await fetch('data.enc.json', { cache: 'no-cache' })).json();
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(enc.salt), iterations: enc.iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // Фото, добавленные после сборки прайса: photos.json { "маркировка" | "категория:id": "файл.webp" }
  const slug = s => s.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-|-$/g, '');
  async function applyPhotoOverrides() {
    let map = {};
    try { map = await (await fetch('photos.json', { cache: 'no-cache' })).json(); } catch { return; }
    for (const [key, file] of Object.entries(map)) {
      if (PROD[key]) PROD[key].photo = file;
      else DATA.products.filter(p => slug(p.sku) === key).forEach(p => { p.photo = file; });
    }
  }

  async function unlock(pass, remember) {
    try {
      DATA = await decrypt(pass);
    } catch {
      return false;
    }
    if (remember) store.set('kp.pass', pass);
    try { sessionStorage.setItem('kp.pass', pass); } catch { }
    DATA.products.forEach(p => { PROD[p.id] = p; });
    await applyPhotoOverrides();
    if (!S.rate) S.rate = DATA.general.rate;
    start();
    return true;
  }

  $('#lockForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.textContent = 'Открываю…';
    const ok = await unlock($('#lockPass').value, $('#lockRemember').checked);
    btn.textContent = 'Открыть';
    $('#lockErr').hidden = ok;
  });

  (async () => {
    let saved = null;
    try { saved = sessionStorage.getItem('kp.pass'); } catch { }
    saved = saved || store.get('kp.pass', null);
    if (saved && !(await unlock(saved, false))) store.del('kp.pass');
  })();

  // ---------- Расчёт цены ----------
  const isFlex = p => p.perMeter && (/SFTL/i.test(p.sku) || /гибк/i.test(p.group));
  const isRigid = p => p.perMeter && !isFlex(p);
  const isSimple = p => p.cat === 'control';
  const catOf = p => DATA.categories.find(c => c.id === p.cat);
  const coef = () => DATA.general.baseCoef * (S.vat ? DATA.general.vatCoef : 1);
  const rub = usd => usd * S.rate * coef();
  const roundTo = n => { const r = +S.round || 1; return Math.round(n / r) * r; };
  const adjusted = n => roundTo(n * (1 + (+S.adjust || 0) / 100));

  // Коэффициент к цене 1 м для линейных (правило от 26.10.2026):
  // до 300 мм ×0,55; 301–512 мм ×0,75; 513–1010 мм ×1 (1004 и 1008,6 из таблицы длин — как метр);
  // длиннее — длина в метрах с округлением вверх до 0,1 (1100 → 1,1; 1120 → 1,2; 1220 → 1,3);
  // 1501–1510 мм (1500,9 из таблицы) — как 1,5 м
  function lengthFactor(mm) {
    if (mm <= 300) return 0.55;
    if (mm <= 512) return 0.75;
    if (mm <= 1010) return 1;
    if (mm > 1500 && mm <= 1510) return 1.5;
    return Math.ceil(Math.round(mm) / 100) / 10;
  }
  const fmtK = f => String(f).replace('.', ',');

  function priceCol(p, c) {
    if (c.color === 'RGB') return 'dmx';
    if (c.color === 'RGBW') return 'rgbw';
    return c.dmx ? 'dmx' : (p.usd.mono != null ? 'mono' : 'dmx');
  }

  // Допустимые длины жёстких линейных светильников, мм — таблица производства (26.10.2026).
  // Контурные — все жёсткие, кроме гибкого неона и ленты; заливающие — все жёсткие.
  const LENGTHS = {
    contour: {
      24: [143, 163.5, 184, 204.5, 225, 245.5, 266, 286.5, 307, 327.5, 348, 368.5, 389, 409.5, 430, 450.5, 471, 491.5, 512, 532.5,
        553, 573.5, 594, 614.5, 635, 655.5, 676, 696.5, 717, 737.5, 758, 778.5, 799, 819.5, 840, 860.5, 881, 901.5, 922, 942.5,
        963, 983.5, 1004, 1024.5, 1045, 1065.5, 1086, 1106.5, 1127, 1147.5, 1168, 1188.5, 1209, 1229.5, 1250, 1270.5, 1291, 1311.5,
        1332, 1352.5, 1373, 1393.5, 1414, 1434.5, 1455, 1475.5, 1496],
      48: [143, 184, 225, 266, 307, 348, 389, 430, 471, 512, 553, 594, 635, 676, 717, 758, 799, 840, 881, 922, 963, 1004, 1045,
        1086, 1127, 1168, 1209, 1250, 1291, 1332, 1373, 1414, 1455, 1496],
    },
    washer: {
      24: [188.1, 215.5, 242.8, 270.2, 297.5, 324.9, 352.2, 379.6, 406.9, 434.3, 461.6, 489, 516.3, 543.7, 571, 598.4, 625.7, 653.1,
        680.4, 707.8, 735.1, 762.5, 789.8, 817.2, 844.5, 871.9, 899.2, 926.6, 953.9, 981.3, 1008.6, 1036, 1063.3, 1090.7, 1118,
        1145.4, 1172.7, 1200.1, 1227.4, 1254.8, 1282.1, 1309.5, 1336.8, 1364.2, 1391.5, 1418.9, 1446.2, 1473.6, 1500.9],
      48: [188.1, 242.8, 297.5, 352.2, 406.9, 461.6, 516.3, 571, 625.7, 680.4, 735.1, 789.8, 844.5, 899.2, 953.9, 1008.6, 1063.3,
        1118, 1172.7, 1227.4, 1282.1, 1336.8, 1391.5, 1446.2, 1500.9],
    },
  };
  // Список длин для выбранного напряжения или null — тогда длины из прайса и «другая»
  const lengthTable = (p, v) => (isRigid(p) && LENGTHS[p.cat] && LENGTHS[p.cat][v]) || null;
  const nearest = (list, x) => list.reduce((a, b) => Math.abs(b - x) < Math.abs(a - x) ? b : a);
  const fmtLen = l => String(l).replace('.', ',');

  // Текст «Параметры» из прайса без 36 В в строке «Напряжение питания 24/36/48/220 В»
  const paramsText = p => String(p.params || '').replace(/(Напряжение питания[:\s]*)([\d\/\s,DCВ]+)/i, (m, a, b) =>
    a + b.replace(/(^|\/)\s*36\s*(?=\/|\s|В|$)/g, '$1').replace(/\/{2,}/g, '/').replace(/^\//, '').replace(/\/(\s*В)/, '$1'));

  function voltagesOf(p) {
    if (p.markups.v220 === 'only220') return [220];
    // 36 В не предлагаем (решение 26.10.2026) — ни в выборе, ни в тексте характеристик (paramsText)
    const v = (p.voltages || []).filter(x => x !== 36);
    // По таблице длин у жёстких контурных и заливающих есть исполнение 48 В
    if (lengthTable(p, 48) && v.includes(24) && !v.includes(48)) v.splice(v.indexOf(24) + 1, 0, 48);
    if (typeof p.markups.v220 === 'number' && !v.includes(220)) v.push(220);
    return v;
  }

  function colorsOf(p) {
    if (isSimple(p)) return { temps: [], mono: [], rgb: [] };
    const list = p.temps && p.temps.length >= 2 ? p.temps : (p.cat === 'landscape' ? [] : DATA.general.stdTemps);
    const hasMono = p.usd.mono != null || p.usd.dmx != null;
    const white = p.onlyWhite || p.cat === 'landscape';
    return {
      temps: hasMono ? list : [],
      mono: hasMono && !white ? ['R', 'G', 'B', 'Cyan'] : [],
      rgb: white ? [] : [p.usd.dmx != null ? 'RGB' : null, p.usd.rgbw != null ? 'RGBW' : null].filter(Boolean),
    };
  }

  const POWER_STEPS = [1, 3, 5, 6, 9, 12, 15, 18, 24, 30, 36, 48, 54, 60, 72, 90, 100, 120, 150, 200, 300, 400];
  function powersOf(p) {
    if (!p.power) return [];
    const list = POWER_STEPS.filter(v => v < p.power);
    return [...list.slice(-5), p.power];
  }

  function defaults(p) {
    const cat = catOf(p);
    const col = colorsOf(p);
    const v = voltagesOf(p);
    const tbl = lengthTable(p, v[0]);
    return {
      length: !isRigid(p) ? null : tbl ? nearest(tbl, 1000) : (cat.lengths?.includes(1000) ? 1000 : cat.lengths?.[0] || 1000),
      color: col.temps.includes(3000) ? 3000 : (col.temps[0] ?? col.rgb[0] ?? null),
      dmx: p.usd.mono == null && p.usd.dmx != null,
      angle: p.angles?.[0] ?? null,
      power: p.power ?? null,
      voltage: v[0] ?? null,
      paint: false, ral: '',
      visor: false,
    };
  }

  function basePrice(p, c) {
    const usd = p.usd[priceCol(p, c)];
    if (usd == null) return null;
    let r = rub(usd);
    if (isRigid(p) && c.length) r *= lengthFactor(c.length);
    const m = p.markups;
    if (c.voltage === 220 && typeof m.v220 === 'number') r += m.v220;
    if (c.paint && typeof m.paint === 'number') r += m.paint;
    if (c.visor && typeof m.visor === 'number') r += m.visor;
    return r;
  }

  const COLOR_NAMES = { R: 'красный', G: 'зелёный', B: 'синий', Cyan: 'циан' };
  function lineName(p, c) {
    if (isSimple(p)) return `${p.type} ${p.sku}`.replace(/\s+/g, ' ');
    const parts = [`Светильник светодиодный ${p.sku}`];
    if (c.power) {
      if (isRigid(p) && c.length) parts.push(`до ${Math.round(c.power * c.length / 1000)}Вт`);
      else parts.push(`до ${c.power}${p.powerUnit === 'Вт/м' ? 'Вт/м' : 'Вт'}`);
    }
    if (c.angle) parts.push(`${c.angle}град`);
    if (c.color != null) parts.push(typeof c.color === 'number' ? `${c.color}К` : (COLOR_NAMES[c.color] || c.color));
    const col = priceCol(p, c);
    if (col !== 'mono') parts.push(/PWM/i.test(p.sku) ? 'PWM' : 'DMX');
    if (c.voltage) parts.push(`${c.voltage}В`);
    if (isRigid(p) && c.length) parts.push(`${fmtLen(c.length)}мм`);
    if (p.ip) parts.push(p.ip);
    if (c.paint) parts.push(`окраска RAL ${c.ral || '(по согласованию)'}`);
    if (c.visor) parts.push('с козырьком');
    return parts.join(', ');
  }

  function fromPrice(p) {
    const c = defaults(p);
    c.dmx = p.usd.mono == null;
    c.color = null;
    c.voltage = voltagesOf(p).find(v => v !== 220) ?? c.voltage;
    if (isRigid(p)) c.length = 1000;
    const b = basePrice(p, c);
    return b == null ? null : adjusted(isRigid(p) ? rub(p.usd[priceCol(p, c)]) : b);
  }

  // ---------- КП: хранение ----------
  let KP = null;
  const allKp = () => store.get('kp.saved', {});
  function newKp() {
    const d = new Date();
    const num = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    return {
      id: uid(), created: Date.now(), updated: Date.now(),
      meta: { client: '', object: '', number: num, date: today(), delivery: 'от 40 дней до склада во Владивостоке', warranty: '3 года, до 5 лет по запросу', payment: 'предоплата 70 %, 30 % перед отгрузкой', terms: S.terms, note: '' },
      lines: [],
    };
  }
  function saveKp() {
    KP.updated = Date.now();
    const all = allKp();
    all[KP.id] = KP;
    store.set('kp.saved', all);
    store.set('kp.currentId', KP.id);
  }
  function loadKp() {
    const all = allKp();
    KP = all[store.get('kp.currentId', '')] || newKp();
  }

  function lineUnitPrice(l) {
    if (l.manual != null && l.manual !== '') return +l.manual;
    const p = PROD[l.pid];
    if (!p) return 0;
    const b = basePrice(p, l.cfg);
    return b == null ? 0 : adjusted(b);
  }
  const lineTitle = l => (l.nameEdited || !PROD[l.pid]) ? l.name : lineName(PROD[l.pid], l.cfg);
  const lineSum = l => lineUnitPrice(l) * (+l.qty || 0);
  const kpTotal = () => KP.lines.reduce((s, l) => s + lineSum(l), 0);
  const kpWeight = () => KP.lines.reduce((s, l) => {
    const p = PROD[l.pid];
    if (!p || !p.weight) return s;
    const w = isRigid(p) && l.cfg.length ? p.weight * l.cfg.length / 1000 : p.weight;
    return s + w * (+l.qty || 0);
  }, 0);

  // ---------- Каталог ----------
  let curCat = 'all';
  let query = '';

  function start() {
    $('#lock').hidden = true;
    $('#app').hidden = false;
    $('#priceDate').textContent = 'Прайс с 01.05.2026 · ' + DATA.products.length + ' моделей';
    $('#setRate').value = S.rate;
    $('#setVat').checked = S.vat;
    $('#setAdjust').value = S.adjust;
    loadKp();
    renderCats();
    renderGrid();
    updateCount();
    if (!S.profileDone) askProfile();
  }

  // ---------- Кто собирает КП ----------
  // Поля пустые: на чужом устройстве не должно стоять подписи Антона по умолчанию
  function askProfile() {
    $('#profile').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('#profileForm').name.focus(), 50);
  }
  $('#profileForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const v = k => f[k].value.trim();
    S.manager = { name: v('name'), title: v('title'), phone: v('phone'), email: v('email') };
    S.company = v('company');
    S.profileDone = true;
    saveSettings();
    $('#profile').hidden = true;
    document.body.style.overflow = '';
    toast(`Готово, ${S.manager.name.split(' ')[0]}! Можно собирать КП`);
  });

  function renderCats() {
    const count = id => DATA.products.filter(p => p.cat === id).length;
    $('#cats').innerHTML = [`<button data-cat="all" class="${curCat === 'all' ? 'active' : ''}">Все<i>${DATA.products.length}</i></button>`]
      .concat(DATA.categories.map(c => `<button data-cat="${c.id}" class="${curCat === c.id ? 'active' : ''}">${esc(c.name)}<i>${count(c.id)}</i></button>`)).join('');
  }

  function tagsOf(p) {
    const t = [];
    const col = colorsOf(p);
    if (p.power) t.push(`${p.power} ${p.powerUnit}`);
    t.push(...col.rgb);
    if (!col.rgb.length && p.usd.dmx != null) t.push('DMX');
    if (p.ip) t.push(p.ip);
    if (p.angles?.length) t.push(p.angles.length > 1 ? `${p.angles[0]}–${p.angles[p.angles.length - 1]}°` : `${p.angles[0]}°`);
    return t;
  }

  function renderGrid() {
    const q = query.trim().toLowerCase();
    const list = DATA.products.filter(p => (curCat === 'all' || p.cat === curCat) &&
      (!q || `${p.sku} ${p.type} ${p.group} ${p.params} ${p.note}`.toLowerCase().includes(q)));
    $('#found').textContent = q ? `найдено: ${list.length}` : '';
    let html = '';
    let lastGroup = null;
    for (const p of list) {
      const g = (curCat === 'all' ? catOf(p).name : '') + (p.group ? (curCat === 'all' ? ' · ' : '') + p.group : '');
      if (g !== lastGroup && (g || lastGroup)) { html += `<div class="group-title">${esc(g || catOf(p).name)}</div>`; lastGroup = g; }
      const fp = fromPrice(p);
      html += `<button class="card" data-pid="${esc(p.id)}">
        <div class="card-img">${p.photo ? `<img src="img/${p.photo}" alt="" loading="lazy">` : '<span class="noimg">нет фото</span>'}</div>
        <div class="card-body">
          <div class="card-sku">${esc(p.sku)}</div>
          <div class="card-type">${esc(p.type)}</div>
          <div class="tags">${tagsOf(p).map(t => `<span>${esc(t)}</span>`).join('')}</div>
          <div class="card-price"><b>${fp == null ? '—' : 'от ' + fmt(fp) + ' ₽'}</b><small>${isRigid(p) || isFlex(p) ? 'за 1 м' : 'за шт.'}</small></div>
        </div>
        <span class="card-add">+</span>
      </button>`;
    }
    $('#grid').innerHTML = html || '<div class="empty">Ничего не найдено</div>';
  }

  $('#cats').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    curCat = b.dataset.cat;
    renderCats();
    renderGrid();
    window.scrollTo({ top: 0 });
  });
  let searchT;
  $('#search').addEventListener('input', e => {
    clearTimeout(searchT);
    searchT = setTimeout(() => { query = e.target.value; renderGrid(); }, 120);
  });
  $('#grid').addEventListener('click', e => {
    const c = e.target.closest('.card');
    if (c) openCfg(c.dataset.pid);
  });

  // Настройки расчёта в шапке
  $('#setRate').addEventListener('change', e => { S.rate = +e.target.value || DATA.general.rate; saveSettings(); refreshPrices(); });
  $('#setVat').addEventListener('change', e => { S.vat = e.target.checked; saveSettings(); refreshPrices(); });
  $('#setAdjust').addEventListener('change', e => { S.adjust = +e.target.value || 0; saveSettings(); refreshPrices(); });
  function refreshPrices() {
    renderGrid();
    updateCount();
    if (!$('#kp').hidden) renderKp();
    if (!$('#cfg').hidden) renderCfg();
    toast(`Курс ${S.rate} · ${S.vat ? 'с НДС' : 'без НДС'} · ${S.adjust > 0 ? '+' : ''}${S.adjust} %`);
  }

  // ---------- Панели ----------
  function openSheet(id) { $(id).hidden = false; document.body.style.overflow = 'hidden'; }
  function closeSheet(el) {
    el.hidden = true;
    if ([...document.querySelectorAll('.sheet')].every(s => s.hidden)) document.body.style.overflow = '';
  }
  document.querySelectorAll('.sheet').forEach(s => s.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(s); }));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.sheet')].filter(s => !s.hidden && s.id !== 'profile').pop();
    if (open) closeSheet(open);
  });

  // ---------- Конфигуратор ----------
  let CFG = null; // { p, c, qty, editIndex }

  function openCfg(pid, editIndex = null) {
    const p = PROD[pid];
    if (!p) return;
    const line = editIndex != null ? KP.lines[editIndex] : null;
    CFG = { p, c: line ? { ...line.cfg } : defaults(p), qty: line ? line.qty : (isFlex(p) ? 100 : 1), editIndex };
    renderCfg();
    openSheet('#cfg');
    $('#cfg .sheet-panel').scrollTop = 0;
  }

  function chip(key, val, label, on, extra = '', disabled = false) {
    return `<button data-k="${key}" data-v="${esc(JSON.stringify(val))}" class="${on ? 'on' : ''}" ${disabled ? 'disabled' : ''}>${label}${extra ? `<small>${extra}</small>` : ''}</button>`;
  }

  function renderCfg() {
    const { p, c } = CFG;
    const cat = catOf(p);
    const cols = colorsOf(p);
    const rows = [];

    // У жёстких линейных напряжение идёт перед длиной: от него зависит список длин
    const vs = voltagesOf(p);
    const voltageRow = ['Напряжение', `<div class="chips">${vs.map(v => chip('voltage', v, v + ' В', c.voltage === v,
      v === 220 && typeof p.markups.v220 === 'number' ? '+' + fmt(p.markups.v220) + ' ₽' : '')).join('')}</div>`];
    if (isRigid(p)) {
      if (vs.length) rows.push(voltageRow);
      const tbl = lengthTable(p, c.voltage);
      if (tbl) {
        rows.push(['Длина, мм', `<div class="len-pick"><select data-sel="length" aria-label="Длина светильника">${tbl.map(l =>
          `<option value="${l}" ${l === c.length ? 'selected' : ''}>${fmtLen(l)} мм · ×${fmtK(lengthFactor(l))}</option>`).join('')}</select>
          <small class="muted">${tbl.length} вариантов для ${c.voltage} В, от ${fmtLen(tbl[0])} до ${fmtLen(tbl[tbl.length - 1])} мм</small></div>`]);
      } else {
        const lens = cat.lengths || [];
        rows.push(['Длина, мм', `<div class="chips">${lens.map(l => chip('length', l, l, c.length === l, '×' + fmtK(lengthFactor(l)))).join('')}
          <span class="chip-sep"></span><input type="number" data-in="length" min="50" max="3000" step="1" placeholder="другая" value="${lens.includes(c.length) ? '' : c.length}"></div>`]);
      }
    }
    if (cols.temps.length || cols.mono.length || cols.rgb.length) {
      rows.push(['Цвет свечения', `<div class="chips">${cols.temps.map(t => chip('color', t, t + 'K', c.color === t)).join('')}
        ${cols.mono.length ? '<span class="chip-sep"></span>' + cols.mono.map(t => chip('color', t, COLOR_NAMES[t], c.color === t)).join('') : ''}
        ${cols.rgb.length ? '<span class="chip-sep"></span>' + cols.rgb.map(t => chip('color', t, t, c.color === t, 'DMX')).join('') : ''}</div>`]);
    }
    const rgbChosen = c.color === 'RGB' || c.color === 'RGBW';
    if (!isSimple(p) && p.usd.dmx != null && !rgbChosen) {
      rows.push(['Управление', `<div class="chips">${chip('dmx', false, 'Без управления', !c.dmx, '', p.usd.mono == null)}${chip('dmx', true, 'DMX', c.dmx)}</div>`]);
    }
    if (p.angles?.length) rows.push(['Угол, °', `<div class="chips">${p.angles.map(a => chip('angle', a, a, c.angle === a)).join('')}</div>`]);
    const pw = powersOf(p);
    if (pw.length) {
      rows.push([`Мощность, ${p.powerUnit}`, `<div class="chips">${pw.map(w => chip('power', w, 'до ' + w, c.power === w,
        isRigid(p) && c.length ? `≈${Math.round(w * c.length / 1000)} Вт` : '')).join('')}</div>`]);
    }
    if (vs.length && !isRigid(p)) rows.push(voltageRow);
    if (typeof p.markups.paint === 'number') {
      rows.push(['Окраска', `<div class="chips">${chip('paint', false, 'Стандартная', !c.paint)}${chip('paint', true, 'RAL', c.paint, '+' + fmt(p.markups.paint) + ' ₽')}
        ${c.paint ? `<input type="text" data-in="ral" placeholder="№ RAL" value="${esc(c.ral)}">` : ''}</div>`]);
    }
    if (typeof p.markups.visor === 'number') {
      rows.push(['Козырёк', `<div class="chips">${chip('visor', false, 'Без козырька', !c.visor)}${chip('visor', true, 'С козырьком', c.visor, '+' + fmt(p.markups.visor) + ' ₽')}</div>`]);
    } else if (p.markups.visor === 'included') {
      rows.push(['Козырёк', '<div class="chips muted" style="padding-top:8px">в комплекте</div>']);
    }

    const base = basePrice(p, c);
    const unit = base == null ? null : adjusted(base);
    const unitName = isFlex(p) ? 'м' : 'шт.';
    const lenNote = isRigid(p) && c.length ? `<div class="cfg-note muted">Длина ${fmtLen(c.length)} мм → ×${fmtK(lengthFactor(c.length))} от цены 1 м</div>` : '';
    const minNote = isFlex(p) ? '<div class="cfg-note">Гибкие светильники — заказ от 100 метров.</div>' : '';

    $('#cfgBody').innerHTML = `
      <div class="cfg-top">
        <div class="cfg-img">${p.photo ? `<img src="img/${p.photo}" alt="">` : ''}</div>
        <div>
          <span class="eyebrow">${esc(cat.name)}${p.group ? ' · ' + esc(p.group) : ''}</span>
          <h2>${esc(p.sku)}</h2>
          <div class="muted">${esc(p.type)}</div>
          ${p.note ? `<div class="cfg-note">${esc(p.note)}</div>` : ''}
          <details class="cfg-params" ${innerWidth > 600 ? 'open' : ''}><summary>Характеристики</summary>${esc(paramsText(p))}</details>
        </div>
      </div>
      ${rows.map(([t, h]) => `<div class="opt"><b>${t}</b>${h}</div>`).join('')}
      ${lenNote}${minNote}
      <div class="cfg-sum">
        <div class="cfg-name">${esc(lineName(p, c))}</div>
        <div class="cfg-price"><b>${unit == null ? 'нет цены' : fmt(unit) + ' ₽'}</b><small>за ${unitName} · ${S.vat ? 'с НДС' : 'без НДС'}${S.adjust ? ` · ${S.adjust > 0 ? '+' : ''}${S.adjust} %` : ''}</small></div>
        <div class="cfg-buy">
          <div class="qty"><button data-step="-1" aria-label="Меньше">−</button><input type="number" inputmode="numeric" data-in="qty" min="1" step="1" value="${CFG.qty}" aria-label="Количество"><button data-step="1" aria-label="Больше">+</button></div>
          <button class="btn btn-main" id="cfgAdd" ${unit == null ? 'disabled' : ''}>${CFG.editIndex != null ? 'Сохранить' : 'В КП'}</button>
        </div>
      </div>`;
  }

  $('#cfgBody').addEventListener('click', e => {
    const b = e.target.closest('button[data-k]');
    if (b) {
      const k = b.dataset.k;
      const v = JSON.parse(b.dataset.v);
      CFG.c[k] = v;
      if (k === 'color' && (v === 'RGB' || v === 'RGBW')) CFG.c.dmx = true;
      // Сменили напряжение — длину переводим на ближайшую допустимую для него
      if (k === 'voltage') {
        const tbl = lengthTable(CFG.p, v);
        if (tbl && !tbl.includes(CFG.c.length)) {
          const was = CFG.c.length;
          CFG.c.length = nearest(tbl, was || 1000);
          if (was) toast(`Для ${v} В длина ${fmtLen(was)} мм недоступна — выбрана ${fmtLen(CFG.c.length)} мм`);
        }
      }
      renderCfg();
      return;
    }
    const st = e.target.closest('[data-step]');
    if (st) {
      const q = $('#cfgBody [data-in="qty"]');
      CFG.qty = Math.max(1, (+q.value || 0) + +st.dataset.step * (isFlex(CFG.p) && CFG.qty >= 100 ? 10 : 1));
      q.value = CFG.qty;
      return;
    }
    if (e.target.id === 'cfgAdd') addToKp();
  });
  $('#cfgBody').addEventListener('input', e => {
    if (e.target.dataset.in === 'qty') CFG.qty = Math.max(1, +e.target.value || 1);
  });
  $('#cfgBody').addEventListener('change', e => {
    const k = e.target.dataset.in;
    if (!k) return;
    if (k === 'length') { const v = Math.round(+e.target.value); if (v > 0) CFG.c.length = v; renderCfg(); }
  });
  $('#cfgBody').addEventListener('change', e => {
    if (e.target.dataset.sel === 'length') { CFG.c.length = +e.target.value; renderCfg(); }
    if (k === 'ral') { CFG.c.ral = e.target.value.trim(); renderCfg(); }
    if (k === 'qty') CFG.qty = Math.max(1, +e.target.value || 1);
  });

  function addToKp() {
    const qtyIn = $('#cfgBody [data-in="qty"]');
    CFG.qty = Math.max(1, +qtyIn.value || 1);
    const { p, c, qty, editIndex } = CFG;
    const line = { id: uid(), pid: p.id, cfg: { ...c }, name: lineName(p, c), nameEdited: false, unit: isFlex(p) ? 'м' : 'шт.', qty, manual: null };
    if (editIndex != null) {
      const old = KP.lines[editIndex];
      KP.lines[editIndex] = { ...line, id: old.id, manual: old.manual };
      toast('Позиция обновлена');
      closeSheet($('#cfg'));
      renderKp();
    } else {
      // Такая же конфигурация уже есть — увеличиваем количество
      const same = KP.lines.find(l => l.pid === p.id && JSON.stringify(l.cfg) === JSON.stringify(c) && !l.nameEdited && l.manual == null);
      if (same) same.qty = (+same.qty || 0) + qty;
      else KP.lines.push(line);
      toast(`Добавлено в КП: ${p.sku} × ${qty}`);
      closeSheet($('#cfg'));
    }
    saveKp();
    updateCount();
  }

  function updateCount() {
    $('#kpCount').textContent = KP.lines.length;
    // Панель КП внизу (на телефоне)
    const n = KP.lines.length;
    $('#dock').hidden = !n;
    document.body.classList.toggle('has-dock', !!n);
    if (n) {
      $('#dockSum').textContent = fmt(kpTotal()) + ' ₽';
      $('#dockInfo').textContent = `позиций: ${n} · ${S.vat ? 'с НДС' : 'без НДС'}`;
    }
  }
  $('#dock').addEventListener('click', e => { if (e.target.closest('button')) { renderKp(); openSheet('#kp'); } });

  // ---------- Экран КП ----------
  $('#openKp').addEventListener('click', () => { renderKp(); openSheet('#kp'); });

  const META_FIELDS = [
    ['client', 'Заказчик', 'wide', 'Компания или ФИО'],
    ['object', 'Объект', 'wide', 'Название объекта'],
    ['number', '№ КП', '', ''],
    ['date', 'Дата', '', '', 'date'],
    ['delivery', 'Срок поставки', 'wide', ''],
    ['warranty', 'Гарантия', '', ''],
    ['payment', 'Оплата', '', ''],
  ];

  function renderKp() {
    const m = KP.meta;
    $('#kpTitle').innerHTML = esc(m.client || 'Новое КП') + (m.object ? ` <em>· ${esc(m.object)}</em>` : '');
    $('#kpMeta').innerHTML = META_FIELDS.map(([k, label, cls, ph, type]) =>
      `<label class="field ${cls}"><span>${label}</span><input type="${type || 'text'}" data-meta="${k}" value="${esc(m[k])}" placeholder="${ph}"></label>`).join('') +
      `<label class="field wide"><span>Условия (каждое с новой строки)</span><textarea data-meta="terms" rows="4">${esc(m.terms)}</textarea></label>
       <label class="field wide"><span>Примечание к КП</span><textarea data-meta="note" rows="4" placeholder="Например: цены действительны 14 дней">${esc(m.note)}</textarea></label>`;

    if (!KP.lines.length) {
      $('#kpLines').innerHTML = '<div class="kp-empty">Пока пусто. Выберите светильники в каталоге и нажмите «В КП».</div>';
    } else {
      $('#kpLines').innerHTML = `<div class="kp-row head"><span>№</span><span></span><span>Наименование</span><span class="unit">Ед.</span><span>Кол-во</span><span>Цена, ₽</span><span class="sum">Сумма, ₽</span><span></span></div>` +
        KP.lines.map((l, i) => {
          const p = PROD[l.pid];
          const manual = l.manual != null && l.manual !== '';
          return `<div class="kp-row" data-i="${i}">
            <span class="n">${i + 1}</span>
            <div class="ph ${p?.photo ? '' : 'none'}">${p?.photo ? `<img src="img/${p.photo}" alt="">` : ''}</div>
            <textarea class="name" data-f="name" rows="3">${esc(lineTitle(l))}</textarea>
            <input class="unit" type="text" data-f="unit" value="${esc(l.unit)}" style="text-align:center">
            <input class="qty" data-f="qty" type="number" min="0" step="1" value="${l.qty}">
            <div class="price-cell ${manual ? 'manual' : ''}"><input data-f="manual" type="number" min="0" step="10" value="${lineUnitPrice(l)}">${manual && p ? '<small data-act="reset" title="Вернуть цену по прайсу">по прайсу ↺</small>' : ''}</div>
            <span class="sum">${fmt(lineSum(l))}</span>
            <div class="tools">
              ${p ? '<button data-act="edit" title="Изменить параметры">✎</button>' : ''}
              <button data-act="up" title="Выше">↑</button>
              <button data-act="del" title="Удалить">×</button>
            </div>
          </div>`;
        }).join('');
    }
    renderTotal();
  }

  function renderTotal() {
    updateCount();
    const t = kpTotal();
    const w = kpWeight();
    $('#kpTotal').innerHTML = `<div class="big">${fmt(t)} ₽</div>
      <div class="sub">${S.vat ? `в т.ч. НДС 22 %: ${fmt(t * 22 / 122)} ₽` : 'без НДС'} · позиций: ${KP.lines.length}${w ? ` · вес ≈ ${fmt(w)} кг` : ''}<br>
      курс $ ${S.rate}${S.adjust ? ` · ${S.adjust > 0 ? 'наценка' : 'скидка'} ${Math.abs(S.adjust)} %` : ''}</div>`;
  }

  $('#kpMeta').addEventListener('input', e => {
    const k = e.target.dataset.meta;
    if (!k) return;
    KP.meta[k] = e.target.value;
    if (k === 'client' || k === 'object') $('#kpTitle').innerHTML = esc(KP.meta.client || 'Новое КП') + (KP.meta.object ? ` <em>· ${esc(KP.meta.object)}</em>` : '');
    saveKp();
  });

  $('#kpLines').addEventListener('input', e => {
    const row = e.target.closest('.kp-row');
    const f = e.target.dataset.f;
    if (!row || !f) return;
    const l = KP.lines[+row.dataset.i];
    if (f === 'name') { l.name = e.target.value; l.nameEdited = true; }
    if (f === 'unit') l.unit = e.target.value;
    if (f === 'qty') l.qty = e.target.value;
    if (f === 'manual') l.manual = e.target.value === '' ? null : +e.target.value;
    row.querySelector('.sum').textContent = fmt(lineSum(l));
    renderTotal();
    saveKp();
  });
  $('#kpLines').addEventListener('change', e => {
    if (e.target.dataset.f === 'manual') renderKp();
  });
  $('#kpLines').addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const i = +a.closest('.kp-row').dataset.i;
    const act = a.dataset.act;
    if (act === 'del') KP.lines.splice(i, 1);
    if (act === 'up' && i > 0) [KP.lines[i - 1], KP.lines[i]] = [KP.lines[i], KP.lines[i - 1]];
    if (act === 'reset') KP.lines[i].manual = null;
    if (act === 'edit') { openCfg(KP.lines[i].pid, i); return; }
    saveKp();
    updateCount();
    renderKp();
  });

  $('#kpAddCustom').addEventListener('click', () => {
    KP.lines.push({ id: uid(), pid: null, cfg: null, name: 'Пусконаладочные работы', nameEdited: true, unit: 'компл.', qty: 1, manual: 0 });
    saveKp();
    updateCount();
    renderKp();
    const last = [...document.querySelectorAll('#kpLines textarea')].pop();
    last?.focus();
    last?.select();
  });

  $('#kpNew').addEventListener('click', () => {
    KP = newKp();
    saveKp();
    updateCount();
    renderKp();
    toast('Создано новое КП, прошлое — в «Сохранённых»');
  });

  // ---------- Сохранённые ----------
  $('#kpSaved').addEventListener('click', () => { renderSaved(); openSheet('#saved'); });
  function renderSaved() {
    const list = Object.values(allKp()).sort((a, b) => b.updated - a.updated);
    $('#savedBody').innerHTML = list.length ? list.map(k => `<div class="saved-item" data-id="${k.id}">
      <div><b>${esc(k.meta.client || 'Без названия')}${k.meta.object ? ' · ' + esc(k.meta.object) : ''}</b>
      <small>№ ${esc(k.meta.number)} · ${fmtDate(k.meta.date)} · позиций: ${k.lines.length}${k.id === KP.id ? ' · открыто' : ''}</small></div>
      <button data-act="open">Открыть</button><button data-act="copy">Копия</button><button data-act="del">×</button></div>`).join('')
      : '<p class="muted">Сохранённых КП нет.</p>';
  }
  $('#savedBody').addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const id = a.closest('.saved-item').dataset.id;
    const all = allKp();
    if (a.dataset.act === 'open') { KP = all[id]; store.set('kp.currentId', id); closeSheet($('#saved')); renderKp(); updateCount(); }
    if (a.dataset.act === 'copy') {
      const c = JSON.parse(JSON.stringify(all[id]));
      const fresh = newKp();
      Object.assign(c, { id: fresh.id, created: Date.now() });
      c.meta.number = fresh.meta.number;
      c.meta.date = today();
      KP = c; saveKp(); closeSheet($('#saved')); renderKp(); updateCount();
      toast('Копия КП открыта');
    }
    if (a.dataset.act === 'del') {
      if (!confirm('Удалить это КП с устройства?')) return;
      delete all[id];
      store.set('kp.saved', all);
      if (id === KP.id) { KP = newKp(); saveKp(); renderKp(); updateCount(); }
      renderSaved();
    }
  });

  // ---------- Настройки ----------
  $('#openSettings').addEventListener('click', () => { renderSettings(); openSheet('#settings'); });
  function renderSettings() {
    const f = (k, label, v, type = 'text') => `<label class="field"><span>${label}</span><input type="${type}" data-s="${k}" value="${esc(v)}"></label>`;
    $('#settingsBody').innerHTML = `<div class="settings-grid">
      ${f('rate', 'Курс продажи доллара, ₽', S.rate, 'number')}
      <label class="field"><span>Округление цены</span><select data-s="round">${[1, 10, 50, 100].map(r => `<option value="${r}" ${+S.round === r ? 'selected' : ''}>до ${r} ₽</option>`).join('')}</select></label>
      <p class="muted" style="font-size:12px;margin:0">Цена = цена в $ × курс × 1,1${S.vat ? ' × 1,22 (НДС)' : ''} × длина по правилу прайса + наценки, затем ± % из шапки и округление.</p>
      <h3>Подпись в КП</h3>
      ${f('manager.name', 'ФИО', S.manager.name)}
      ${f('manager.title', 'Должность', S.manager.title)}
      ${f('manager.phone', 'Телефон', S.manager.phone)}
      ${f('manager.email', 'E-mail', S.manager.email)}
      ${f('company', 'Компания', S.company)}
      <label class="field"><span>Условия по умолчанию для новых КП</span><textarea data-s="terms" rows="5">${esc(S.terms)}</textarea></label>
      <button class="btn btn-line" id="logout" type="button">Выйти и забыть пароль</button>
    </div>`;
  }
  $('#settingsBody').addEventListener('change', e => {
    const k = e.target.dataset.s;
    if (!k) return;
    let v = e.target.value;
    if (k === 'rate' || k === 'round') v = +v || (k === 'rate' ? DATA.general.rate : 1);
    if (k.startsWith('manager.')) S.manager[k.split('.')[1]] = v; else S[k] = v;
    saveSettings();
    $('#setRate').value = S.rate;
    refreshPrices();
  });
  $('#settingsBody').addEventListener('click', e => {
    if (e.target.id !== 'logout') return;
    store.del('kp.pass');
    try { sessionStorage.removeItem('kp.pass'); } catch { }
    location.reload();
  });

  // ---------- Excel ----------
  // ExcelJS грузим только по нажатию: библиотека ~1 МБ
  function loadExcelJS() {
    if (window.ExcelJS) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  // Excel не читает webp — перерисовываем фото в png через canvas
  function photoPng(file, size = 160) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, 0, 0, size, size);
        res(c.toDataURL('image/png'));
      };
      img.onerror = () => res(null);
      img.src = 'img/' + file;
    });
  }

  function kpFileName(ext) {
    const m = KP.meta;
    return ['КП Система Арт', m.client, m.object, fmtDate(m.date)].filter(Boolean).join(' — ').replace(/[\\/:*?"<>|]/g, '') + ext;
  }

  async function buildXlsx() {
    await loadExcelJS();
    const m = KP.meta;
    const mg = S.manager;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('КП', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } } });
    ws.columns = [{ width: 5 }, { width: 11 }, { width: 58 }, { width: 8 }, { width: 9 }, { width: 13 }, { width: 15 }];
    const font = { name: 'Arial', size: 10 };
    const red = 'FFEF3B36', ink = 'FF0A0A0A', grey = 'FF8C8B86', line = 'FFE6E4DF';
    const money = '#,##0';

    // Шапка: тёмная полоса с логотипом и контактами
    ws.mergeCells('A1:G1');
    ws.getRow(1).height = 46;
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ink } };
    ws.getCell('A1').value = [mg.phone, mg.email, 'sysartspb.com'].filter(Boolean).join('   ·   ');
    ws.getCell('A1').font = { ...font, size: 9, color: { argb: 'FFCFCBC3' } };
    ws.getCell('A1').alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
    const logo = await fetch('logo.png').then(r => r.arrayBuffer()).catch(() => null);
    if (logo) ws.addImage(wb.addImage({ buffer: logo, extension: 'png' }), { tl: { col: 0.15, row: 0.12 }, ext: { width: 120, height: 54 } });
    ws.getRow(1).height = 48;

    ws.mergeCells('A2:G2');
    ws.getCell('A2').value = 'Коммерческое предложение';
    ws.getCell('A2').font = { ...font, size: 18, bold: true };
    ws.getRow(2).height = 34;
    ws.getCell('A2').alignment = { vertical: 'middle' };

    let r = 3;
    const info = [['Заказчик', m.client || '—'], ['Объект', m.object || '—'], ['№ КП', m.number], ['Дата', fmtDate(m.date)]];
    for (const [k, v] of info) {
      ws.mergeCells(`A${r}:B${r}`);
      ws.mergeCells(`C${r}:G${r}`);
      ws.getCell(`A${r}`).value = k;
      ws.getCell(`A${r}`).font = { ...font, size: 9, color: { argb: grey } };
      ws.getCell(`C${r}`).value = v;
      ws.getCell(`C${r}`).font = { ...font, bold: true };
      r++;
    }
    r++;

    // Таблица позиций
    const head = ['№', '', 'Наименование', 'Ед.', 'Кол-во', 'Цена, ₽', S.vat ? 'Стоимость, ₽ с НДС' : 'Стоимость, ₽'];
    ws.getRow(r).values = head;
    ws.getRow(r).height = 28;
    ws.getRow(r).eachCell(c => {
      c.font = { ...font, size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ink } };
      c.alignment = { vertical: 'middle', horizontal: c.col >= 4 ? 'center' : 'left', wrapText: true };
    });
    const first = r + 1;
    for (let i = 0; i < KP.lines.length; i++) {
      const l = KP.lines[i];
      r++;
      const row = ws.getRow(r);
      row.values = [i + 1, '', lineTitle(l), l.unit, +l.qty || 0, lineUnitPrice(l), { formula: `E${r}*F${r}`, result: lineSum(l) }];
      row.height = 50;
      row.eachCell({ includeEmpty: true }, c => {
        c.font = font;
        c.alignment = { vertical: 'middle', wrapText: c.col === 3, horizontal: c.col === 1 || c.col === 4 ? 'center' : undefined };
        c.border = { bottom: { style: 'thin', color: { argb: line } } };
      });
      row.getCell(6).numFmt = money;
      row.getCell(7).numFmt = money;
      row.getCell(7).font = { ...font, bold: true };
      const p = PROD[l.pid];
      const png = p?.photo ? await photoPng(p.photo) : null;
      if (png) ws.addImage(wb.addImage({ base64: png, extension: 'png' }), { tl: { col: 1.08, row: r - 1 + 0.06 }, ext: { width: 60, height: 60 } });
    }
    const last = r;
    r += 2;
    const total = kpTotal();
    if (S.vat) {
      ws.mergeCells(`C${r}:F${r}`);
      ws.getCell(`C${r}`).value = 'В том числе НДС 22 %';
      ws.getCell(`C${r}`).alignment = { horizontal: 'right' };
      ws.getCell(`C${r}`).font = font;
      ws.getCell(`G${r}`).value = { formula: `ROUND(G${r + 1}*22/122,0)`, result: Math.round(total * 22 / 122) };
      ws.getCell(`G${r}`).numFmt = money;
      ws.getCell(`G${r}`).font = font;
      r++;
    }
    ws.mergeCells(`C${r}:F${r}`);
    ws.getCell(`C${r}`).value = 'ИТОГО';
    ws.getCell(`C${r}`).alignment = { horizontal: 'right' };
    ws.getCell(`C${r}`).font = { ...font, size: 13, bold: true };
    ws.getCell(`G${r}`).value = { formula: `SUM(G${first}:G${last})`, result: total };
    ws.getCell(`G${r}`).numFmt = money;
    ws.getCell(`G${r}`).font = { ...font, size: 13, bold: true, color: { argb: red } };
    ws.getCell(`G${r}`).border = { top: { style: 'medium', color: { argb: ink } } };

    // Условия, примечание, подпись
    r += 2;
    const block = (title, rows) => {
      ws.getCell(`A${r}`).value = title;
      ws.getCell(`A${r}`).font = { ...font, size: 9, bold: true, color: { argb: red } };
      r++;
      for (const t of rows) {
        ws.mergeCells(`A${r}:G${r}`);
        ws.getCell(`A${r}`).value = t;
        ws.getCell(`A${r}`).font = font;
        ws.getCell(`A${r}`).alignment = { wrapText: true, vertical: 'top' };
        r++;
      }
      r++;
    };
    block('УСЛОВИЯ', docTerms().map(t => '• ' + t));
    if (m.note) block('ПРИМЕЧАНИЕ', [m.note]);
    block('С УВАЖЕНИЕМ', [mg.name, mg.title, S.company, [mg.phone, mg.email].filter(Boolean).join(' · ')].filter(Boolean));

    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  $('#kpXlsx').addEventListener('click', async e => {
    if (!KP.lines.length) { toast('В КП нет позиций'); return; }
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = 'Готовлю…';
    // Скачивание может оборвать ещё не завершённую отправку письма (браузер показывает ошибку,
    // хотя письмо дошло) — поэтому сначала ждём ответ почты, но не дольше 6 секунд
    const mail = sendKpMail();
    try {
      const blob = await buildXlsx();
      await Promise.race([mail, new Promise(r => setTimeout(r, 6000))]);
      download(blob, kpFileName('.xlsx'));
    } catch (err) {
      console.error(err);
      toast('Не удалось собрать Excel, проверьте интернет');
    }
    b.disabled = false;
    b.textContent = 'Скачать Excel';
  });

  // ---------- PDF ----------
  $('#kpPdf').addEventListener('click', async () => {
    if (!KP.lines.length) { toast('В КП нет позиций'); return; }
    sendKpMail();
    buildDoc();
    const imgs = [...document.querySelectorAll('#print img')];
    await Promise.all(imgs.map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })));
    await document.fonts?.ready;
    const old = document.title;
    const m = KP.meta;
    document.title = ['КП Система Арт', m.client, m.object, fmtDate(m.date)].filter(Boolean).join(' — ');
    window.print();
    document.title = old;
  });

  // ---------- Копия КП на почту ----------
  // Web3Forms, те же ключи, что у формы заявки на сайте: antonlabukhin@gmail.com и info@sysart.ru
  // (третий ключ сайта — zayavki@ для лидов Bitrix24 — сюда не подключаем).
  const MAIL_KEYS = ['77dab5cc-b9f0-42d1-8365-e3fca0012b0c', 'bc2f0043-368f-439b-8681-7884b82a4c61'];

  function kpText() {
    const m = KP.meta;
    const t = kpTotal();
    const mg = S.manager;
    const lines = KP.lines.map((l, i) =>
      `${i + 1}. ${lineTitle(l)}\n   ${fmt(+l.qty || 0)} ${l.unit} × ${fmt(lineUnitPrice(l))} ₽ = ${fmt(lineSum(l))} ₽${l.manual != null && l.manual !== '' ? ' (цена изменена вручную)' : ''}`);
    return [
      `КП № ${m.number} от ${fmtDate(m.date)}`,
      `Заказчик: ${m.client || '—'}`,
      `Объект: ${m.object || '—'}`,
      '',
      `Подготовил: ${[mg.name, mg.title, S.company].filter(Boolean).join(', ')}`,
      `Контакты: ${[mg.phone, mg.email].filter(Boolean).join(', ') || '—'}`,
      `Расчёт: курс $ ${S.rate}, ${S.vat ? 'с НДС' : 'без НДС'}, ${S.adjust ? (S.adjust > 0 ? 'наценка ' : 'скидка ') + Math.abs(S.adjust) + ' %' : 'по прайсу'}`,
      '',
      'Позиции:',
      ...lines,
      '',
      `ИТОГО: ${fmt(t)} ₽${S.vat ? ` (в т.ч. НДС 22 %: ${fmt(t * 22 / 122)} ₽)` : ' (без НДС)'}`,
      kpWeight() ? `Вес ≈ ${fmt(kpWeight())} кг` : '',
      '',
      `Срок поставки: ${m.delivery || '—'}`,
      `Гарантия: ${m.warranty || '—'}`,
      `Оплата: ${m.payment || '—'}`,
      m.terms ? 'Условия:\n' + m.terms : '',
      m.note ? 'Примечание: ' + m.note : '',
    ].join('\n').replace(/\n{3,}/g, '\n\n');
  }

  // Отправляем при скачивании PDF; повторно — только если КП изменилось
  async function sendKpMail() {
    const text = kpText();
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    if (KP.mailedHash === h) return;
    const m = KP.meta;
    const subject = `КП с сайта (${S.company || S.manager.name || 'без подписи'}): ${m.client || 'без заказчика'}${m.object ? ' — ' + m.object : ''} — ${fmt(kpTotal())} ₽`;
    const results = await Promise.allSettled(MAIL_KEYS.map(key => fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      keepalive: true,
      // Пустой email не передаём: сервис может счесть его ошибкой
      body: JSON.stringify(Object.assign({ access_key: key, subject, from_name: 'Конфигуратор КП sysartspb.com', name: S.manager.name, message: text }, S.manager.email ? { email: S.manager.email } : {})),
    }).then(r => r.json())));
    const ok = results.some(r => r.status === 'fulfilled' && r.value && r.value.success);
    // Ошибку показываем, только если сервис явно ответил отказом. Обрыв ответа (сеть, скачивание файла)
    // не значит, что письмо не ушло — повторно такое КП не шлём, чтобы не было дублей
    const refused = results.every(r => r.status === 'fulfilled' && !(r.value && r.value.success));
    if (!refused) {
      KP.mailedHash = h;
      saveKp();
    }
    if (ok) toast('Копия КП отправлена на почту');
    else if (refused) toast('Не удалось отправить копию КП на почту');
    return ok;
  }

  function docTerms() {
    const m = KP.meta;
    return [
      m.delivery && `Срок поставки: ${m.delivery}`,
      m.warranty && `Гарантия: ${m.warranty}`,
      m.payment && `Оплата: ${m.payment}`,
      ...String(m.terms || '').split('\n').map(s => s.trim()).filter(Boolean),
    ].filter(Boolean);
  }

  function buildDoc() {
    const m = KP.meta;
    const t = kpTotal();
    const terms = docTerms();
    const mg = S.manager;
    $('#print').innerHTML = `<div class="doc">
      <div class="doc-head">
        <div class="doc-head-row">
          <img src="logo.png" alt="Система Арт">
          <div class="doc-contacts">${[mg.phone, mg.email, 'sysartspb.com'].filter(Boolean).map(esc).join('<br>')}</div>
        </div>
        <div class="doc-kicker">Архитектурное освещение · с 2009 года</div>
        <h1>Коммерческое <em>предложение</em></h1>
      </div>
      <div class="doc-info">
        <div><span>Заказчик</span><b>${esc(m.client || '—')}</b></div>
        <div><span>Объект</span><b>${esc(m.object || '—')}</b></div>
        <div><span>№ КП</span><b>${esc(m.number)}</b></div>
        <div><span>Дата</span><b>${fmtDate(m.date)}</b></div>
      </div>
      <div class="doc-body">
        <table>
          <thead><tr><th>№</th><th></th><th>Наименование</th><th class="c">Ед.</th><th class="num">Кол-во</th><th class="num">Цена, ₽</th><th class="num">Сумма, ₽</th></tr></thead>
          <tbody>${KP.lines.map((l, i) => {
            const p = PROD[l.pid];
            return `<tr>
              <td class="i">${i + 1}</td>
              <td class="ph">${p?.photo ? `<div><img src="img/${p.photo}" alt=""></div>` : ''}</td>
              <td class="nm">${esc(lineTitle(l))}</td>
              <td class="c">${esc(l.unit)}</td>
              <td class="num">${fmt(+l.qty || 0)}</td>
              <td class="num">${fmt(lineUnitPrice(l))}</td>
              <td class="num sum">${fmt(lineSum(l))}</td></tr>`;
          }).join('')}</tbody>
        </table>
        <div class="doc-total"><table>
          ${S.vat ? `<tr><td>В том числе НДС 22 %</td><td class="num">${fmt(t * 22 / 122)} ₽</td></tr>` : '<tr><td>НДС</td><td class="num">не облагается</td></tr>'}
          <tr class="grand"><td>Итого</td><td class="num">${fmt(t)} ₽</td></tr>
        </table></div>
        <div class="doc-terms ${m.note ? '' : 'single'}">
          <div><h4>Условия</h4><ul>${terms.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>
          <div>${m.note ? `<h4>Примечание</h4><p>${esc(m.note)}</p>` : ''}</div>
        </div>
        <div class="doc-sign">
          <p>С уважением,<br>${[`<b>${esc(mg.name)}</b>`, esc(mg.title), esc(S.company), [mg.phone, mg.email].filter(Boolean).map(esc).join(' · ')].filter(x => x && x !== '<b></b>').join('<br>')}</p>
          <span class="site">Портфолио объектов: sysartspb.com</span>
        </div>
      </div>
    </div>`;
  }

  // ---------- Уведомления ----------
  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }
})();
