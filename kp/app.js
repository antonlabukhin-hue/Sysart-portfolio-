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
  // до 300 мм ×0,55; 301–512 мм ×0,75; 513–1000 мм ×1;
  // длиннее 1000 мм — длина в метрах с округлением вверх до 0,1 (1100 → 1,1; 1120 → 1,2; 1220 → 1,3)
  function lengthFactor(mm) {
    if (mm <= 300) return 0.55;
    if (mm <= 512) return 0.75;
    if (mm <= 1000) return 1;
    return Math.ceil(Math.round(mm) / 100) / 10;
  }
  const fmtK = f => String(f).replace('.', ',');

  function priceCol(p, c) {
    if (c.color === 'RGB') return 'dmx';
    if (c.color === 'RGBW') return 'rgbw';
    return c.dmx ? 'dmx' : (p.usd.mono != null ? 'mono' : 'dmx');
  }

  function voltagesOf(p) {
    if (p.markups.v220 === 'only220') return [220];
    const v = [...(p.voltages || [])];
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
    return {
      length: isRigid(p) ? (cat.lengths?.includes(1000) ? 1000 : cat.lengths?.[0] || 1000) : null,
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
    if (isRigid(p) && c.length) parts.push(`${c.length}мм`);
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
  }

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
    const open = [...document.querySelectorAll('.sheet')].filter(s => !s.hidden).pop();
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

    if (isRigid(p)) {
      const lens = cat.lengths || [];
      rows.push(['Длина, мм', `<div class="chips">${lens.map(l => chip('length', l, l, c.length === l, '×' + fmtK(lengthFactor(l)))).join('')}
        <span class="chip-sep"></span><input type="number" data-in="length" min="50" max="3000" step="1" placeholder="другая" value="${lens.includes(c.length) ? '' : c.length}"></div>`]);
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
    const vs = voltagesOf(p);
    if (vs.length) {
      rows.push(['Напряжение', `<div class="chips">${vs.map(v => chip('voltage', v, v + ' В', c.voltage === v,
        v === 220 && typeof p.markups.v220 === 'number' ? '+' + fmt(p.markups.v220) + ' ₽' : '')).join('')}</div>`]);
    }
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
    const lenNote = isRigid(p) && c.length ? `<div class="cfg-note muted">Длина ${c.length} мм → ×${fmtK(lengthFactor(c.length))} от цены 1 м</div>` : '';
    const minNote = isFlex(p) ? '<div class="cfg-note">Гибкие светильники — заказ от 100 метров.</div>' : '';

    $('#cfgBody').innerHTML = `
      <div class="cfg-top">
        <div class="cfg-img">${p.photo ? `<img src="img/${p.photo}" alt="">` : ''}</div>
        <div>
          <span class="eyebrow">${esc(cat.name)}${p.group ? ' · ' + esc(p.group) : ''}</span>
          <h2>${esc(p.sku)}</h2>
          <div class="muted">${esc(p.type)}</div>
          ${p.note ? `<div class="cfg-note">${esc(p.note)}</div>` : ''}
          <details class="cfg-params" ${innerWidth > 600 ? 'open' : ''}><summary>Характеристики</summary>${esc(p.params)}</details>
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

  // ---------- PDF ----------
  $('#kpPdf').addEventListener('click', async () => {
    if (!KP.lines.length) { toast('В КП нет позиций'); return; }
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

  function buildDoc() {
    const m = KP.meta;
    const t = kpTotal();
    const terms = [
      m.delivery && `Срок поставки: ${m.delivery}`,
      m.warranty && `Гарантия: ${m.warranty}`,
      m.payment && `Оплата: ${m.payment}`,
      ...String(m.terms || '').split('\n').map(s => s.trim()).filter(Boolean),
    ].filter(Boolean);
    const mg = S.manager;
    $('#print').innerHTML = `<div class="doc">
      <div class="doc-head">
        <div class="doc-head-row">
          <img src="logo.png" alt="Система Арт">
          <div class="doc-contacts">${esc(mg.phone)}<br>${esc(mg.email)}<br>sysartspb.com</div>
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
          <p>С уважением,<br><b>${esc(mg.name)}</b><br>${esc(mg.title)}<br>${esc(S.company)}<br>${esc(mg.phone)} · ${esc(mg.email)}</p>
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
