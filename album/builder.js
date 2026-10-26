// Сборка PDF-альбома в браузере (pdf-lib + fontkit).
// Стиль и размеры перенесены из сборщика «Альбом26/_tools/build.mjs» и map.mjs:
// A4 альбомная, тёмный фон, фото слева, панель с описанием справа, футер с номером страницы.
// Координаты — pt, начало в левом нижнем углу (как в PDF).
(function () {
    const { PDFDocument, rgb } = PDFLib;
    const W = 841.8898, H = 595.2756;
    const hex = h => rgb(...[1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255));
    const C = {
        bg: hex('#0A0A0A'), panel: hex('#1D1D1D'), card: hex('#262626'), red: hex('#E63946'), white: hex('#FFFFFF'),
        text: hex('#F8F9FA'), muted: hex('#ADB5BD'), line: hex('#3A3A3A'), footer: hex('#2A2A2A'), dots: hex('#3A3A3A'),
    };
    const PANEL = { x: 578.1543, y: 34.01575, w: 258.0661, h: 527.2441 };
    const TX = 595.1622, TEXT_W = 819.2126 - 595.1622;
    const PHOTO = { w: 572.485, h: 309.2529 };      // стандартный кадр 1.85:1
    const FOOT = 34.01575, LEFT = 42.51969;
    const PX_PER_PT = 3.2;                           // ~1830 px на ширину кадра: чётко и в печати, и на экране

    // Тексты стандартных страниц. Цифры — только подтверждённые (память проекта sysart-confirmed-facts).
    const BRAND = {
        name: 'Система Арт',
        site: 'sysartspb.com',
        phone: '+7 914 970 40 00',
        email: 'info@sysart.ru',
        cities: 'Санкт-Петербург  ·  Владивосток',
    };

    function wrap(text, font, size, maxW) {
        const lines = [];
        for (const para of String(text || '').split('\n')) {
            let cur = '';
            for (const word of para.split(/\s+/).filter(Boolean)) {
                const t = cur ? cur + ' ' + word : word;
                if (cur && font.widthOfTextAtSize(t, size) > maxW) { lines.push(cur); cur = word; } else cur = t;
            }
            lines.push(cur);
        }
        return lines;
    }

    const loadImage = src => new Promise((ok, fail) => {
        const im = new Image();
        im.onload = () => ok(im);
        im.onerror = () => fail(new Error('Не загрузилось фото ' + src));
        im.src = src;
    });

    // Кадрирование «cover» по центру и пережатие в JPEG; заодно убирает EXIF исходника
    // shade — затемнение снизу (для обложки): доля высоты, где оно заканчивается
    async function coverJpeg(src, wPt, hPt, shade) {
        const im = await loadImage(src);
        const w = Math.round(wPt * PX_PER_PT), h = Math.round(hPt * PX_PER_PT);
        const s = Math.max(w / im.naturalWidth, h / im.naturalHeight);
        const sw = w / s, sh = h / s;
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const g = cv.getContext('2d');
        g.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 2, sw, sh, 0, 0, w, h);
        if (shade) {
            const gr = g.createLinearGradient(0, h, 0, h * (1 - shade));
            gr.addColorStop(0, 'rgba(5,5,5,.92)'); gr.addColorStop(.45, 'rgba(5,5,5,.7)'); gr.addColorStop(1, 'rgba(5,5,5,0)');
            g.fillStyle = gr; g.fillRect(0, 0, w, h);
            const left = g.createLinearGradient(0, 0, w * .6, 0);
            left.addColorStop(0, 'rgba(5,5,5,.45)'); left.addColorStop(1, 'rgba(5,5,5,0)');
            g.fillStyle = left; g.fillRect(0, 0, w, h);
        }
        const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.84));
        return new Uint8Array(await blob.arrayBuffer());
    }

    async function roundPng(src, px) {
        const im = await loadImage(src);
        const cv = document.createElement('canvas');
        cv.width = cv.height = px;
        const g = cv.getContext('2d');
        g.beginPath(); g.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2); g.clip();
        const s = Math.max(px / im.naturalWidth, px / im.naturalHeight);
        g.drawImage(im, (px - im.naturalWidth * s) / 2, (px - im.naturalHeight * s) / 2, im.naturalWidth * s, im.naturalHeight * s);
        const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
        return new Uint8Array(await blob.arrayBuffer());
    }

    const fetchBytes = async url => new Uint8Array(await (await fetch(url)).arrayBuffer());

    // opts: { objects: [{name, city, year, category, description, photos[]}], logo: bool,
    //         dealer: {company, phone, email, site}, map: {points, objCount, cityCount, dots}, cover, onProgress }
    async function buildAlbum(opts) {
        const { objects, logo, map } = opts;
        const dealer = opts.dealer || {};
        const progress = opts.onProgress || (() => {});
        const doc = await PDFDocument.create();
        doc.registerFontkit(fontkit);
        const [regBytes, boldBytes] = await Promise.all([fetchBytes('lib/NotoSans-Regular.ttf'), fetchBytes('lib/NotoSans-Bold.ttf')]);
        const regular = await doc.embedFont(regBytes, { subset: true });
        const bold = await doc.embedFont(boldBytes, { subset: true });
        const logoImg = logo ? await doc.embedPng(await fetchBytes('lib/logo.png')) : null;

        // Подпись в футере и на панели: свой бренд или данные дилера (если он их указал)
        const footLine = logo
            ? `${BRAND.site}  ·  ${BRAND.cities}`
            : [dealer.site, dealer.phone].filter(Boolean).join('  ·  ') || dealer.company || '';
        const signature = logo ? BRAND.name.toUpperCase() : (dealer.company || '').toUpperCase();

        const total = objects.length + 5;
        const numRight = 778.5061 + regular.widthOfTextAtSize('3 / 23', 8);
        const years = objects.map(o => +o.year).filter(Boolean);
        const span = years.length ? (Math.min(...years) === Math.max(...years) ? `${Math.min(...years)}` : `${Math.min(...years)} — ${Math.max(...years)}`) : '';

        const text = (page, s, x, y, size, font, color, extra) => page.drawText(String(s), { x, y, size, font, color, ...extra });
        const textRight = (page, s, xr, y, size, font, color) => text(page, s, xr - font.widthOfTextAtSize(String(s), size), y, size, font, color);

        function footer(page, n) {
            page.drawRectangle({ x: 0, y: 0, width: W, height: FOOT, color: C.footer });
            if (footLine) text(page, footLine, LEFT, 12.75591, 8, regular, C.muted);
            textRight(page, `${n} / ${total}`, numRight, 12.75591, 8, regular, C.muted);
        }
        function drawLogo(page) {
            if (!logoImg) return;
            const h = 32, w = logoImg.width * h / logoImg.height;
            page.drawImage(logoImg, { x: LEFT, y: H - 14 - h, width: w, height: h });
        }
        function newPage() {
            const p = doc.addPage([W, H]);
            p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.bg });
            return p;
        }
        // Заголовок стандартной страницы — как «Наши услуги» в альбоме
        function heading(page, title, sub) {
            text(page, title, 70.86614, 500, 24, bold, C.white);
            page.drawRectangle({ x: 70.86614, y: 482, width: 70.86614, height: 4.251969, color: C.red });
            if (sub) text(page, sub, 70.86614, 460, 10, regular, C.muted);
        }

        // --- 1. Обложка ---
        progress('Обложка');
        {
            const page = doc.addPage([W, H]);
            const img = await doc.embedJpg(await coverJpeg(opts.cover, W, H, 0.62));
            page.drawImage(img, { x: 0, y: 0, width: W, height: H });
            page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: C.red });
            const title = logo ? 'СИСТЕМА АРТ' : (dealer.company || 'АРХИТЕКТУРНОЕ ОСВЕЩЕНИЕ').toUpperCase();
            const tLines = wrap(title, bold, 38, 660);
            const y = 196 + (tLines.length - 1) * 44;
            page.drawRectangle({ x: 56.6929, y: y + 50, width: 127.5591, height: 5.669291, color: C.red });
            tLines.forEach((l, i) => text(page, l, 56.6929, y - i * 44, 38, bold, C.white));
            if (logo || dealer.company) text(page, 'АРХИТЕКТУРНОЕ LED-ОСВЕЩЕНИЕ', 56.6929, 164, 13, regular, hex('#E2E2E2'));
            text(page, `Альбом реализованных проектов${span ? '   ' + span : ''}`, 56.6929, 126, 12, regular, C.white);
            text(page, 'Проектирование  ·  Поставка  ·  Монтаж  ·  Медиафасады', 56.6929, 52, 8, regular, C.muted);
            const site = logo ? BRAND.site : dealer.site;
            if (site) textRight(page, site, W - 56.6929, 52, 8, regular, C.muted);
        }

        // --- 2. О компании ---
        progress('О компании');
        {
            const page = newPage();
            page.drawRectangle({ x: 0, y: FOOT, width: 17, height: H - FOOT, color: C.red });
            const paras = logo ? [
                'Группа компаний «Система Арт» — архитектурное и художественное\nLED-освещение. На рынке с 1993 года, архитектурным освещением\nзанимаемся с 2009-го.',
                'Полный цикл работ: от концепции и светотехнического проекта\nдо поставки оборудования, монтажа и пусконаладки «под ключ».',
                'Собственное производство и проверенные партнёры.\nГарантия — 3 года, до 5 лет по запросу.',
                `${map.objCount} ${plural(map.objCount, 'объект', 'объекта', 'объектов')} в ${map.cityCount} ${plural(map.cityCount, 'городе', 'городах', 'городах')} — от Калининграда до Камчатки.`,
            ] : [
                'Архитектурное и художественное освещение зданий и общественных\nпространств.',
                'Полный цикл работ: от концепции и светотехнического проекта\nдо поставки оборудования, монтажа и пусконаладки «под ключ».',
                'Наши решения подчёркивают архитектуру, создают узнаваемый ночной\nоблик зданий и формируют комфортную городскую среду.',
            ];
            heading(page, logo ? 'О компании' : 'Архитектурное освещение');
            let y = 430;
            for (const p of paras) {
                const lines = p.split('\n');
                lines.forEach((l, i) => text(page, l, 70.86614, y - i * 19, 11, regular, C.text));
                y -= lines.length * 19 + 14;
            }
            const cards = [
                ['Проектирование', 'Светотехнические расчёты,\n3D-визуализация, концепции'],
                ['Поставка', logo ? 'Собственное производство\nи проверенные партнёры' : 'LED-оборудование\nс гарантией'],
                ['Монтаж', 'Монтаж, шеф-монтаж\nи пусконаладка'],
                ['Медиафасады', 'Динамические сценарии\nи медиаконтент'],
            ];
            cards.forEach(([t, d], i) => {
                const x = 70.86614 + i * 144.5;
                page.drawRectangle({ x, y: 128, width: 127.5, height: 90, color: C.card });
                text(page, t, x + 11, 190, 10, bold, C.red);
                d.split('\n').forEach((l, j) => text(page, l, x + 11, 166 - j * 13, 8, regular, C.muted));
            });
            drawLogo(page);
            footer(page, 2);
        }

        // --- 3…: объекты ---
        for (const [i, o] of objects.entries()) {
            progress(`Объект ${i + 1} из ${objects.length}`, i + 1, objects.length);
            const page = newPage();
            const imgs = o.photos.slice(0, 4);
            const gap = 3, cols = imgs.length === 1 ? 1 : 2, rows = imgs.length > 2 ? 2 : 1;
            const cw = (PHOTO.w - gap * (cols - 1)) / cols, ch = (PHOTO.h - gap * (rows - 1)) / rows;
            const y0 = (H - PHOTO.h) / 2;
            for (const [k, src] of imgs.entries()) {
                // 3 фото: третье на всю ширину нижнего ряда
                const wide = imgs.length === 3 && k === 2;
                const w = wide ? PHOTO.w : cw;
                const im = await doc.embedJpg(await coverJpeg(src, w, ch));
                const c = k % cols, r = Math.floor(k / cols);
                page.drawImage(im, { x: wide ? 0 : c * (cw + gap), y: y0 + (rows - 1 - r) * (ch + gap), width: w, height: ch });
            }
            page.drawRectangle({ x: PANEL.x, y: PANEL.y, width: PANEL.w, height: PANEL.h, color: C.panel });
            page.drawRectangle({ x: PANEL.x, y: 552.7559, width: PANEL.w, height: 8.503937, color: C.red });
            text(page, (o.category || '').toUpperCase(), TX, 510.2362, 8, regular, C.red);
            const titleLines = wrap(o.name, bold, 14, TEXT_W);
            titleLines.forEach((l, k) => text(page, l, TX, 476.2205 - k * 22.6772, 14, bold, C.white));
            const shift = (titleLines.length - 1) * 22.6772;
            text(page, [o.city, o.year].filter(Boolean).join('  ·  '), TX, 447.874 - shift, 10, regular, C.muted);
            page.drawLine({ start: { x: TX, y: 430.8661 - shift }, end: { x: 819.2126, y: 430.8661 - shift }, thickness: 0.5, color: C.line });
            wrap(o.description, regular, 9, TEXT_W).forEach((l, k) =>
                text(page, l, TX, 402.5197 - shift - k * 14.1732, 9, regular, C.text));
            if (signature) text(page, signature, TX, 62.3622, 7, regular, C.muted);
            drawLogo(page);
            footer(page, 3 + i);
        }

        // --- Наши услуги ---
        progress('Услуги');
        {
            const page = newPage();
            heading(page, 'Наши услуги');
            const items = [
                ['Концепция и дизайн', 'Разработка световых сценариев, 3D-визуализация,\nподбор цветовых температур и динамических эффектов.'],
                ['Светотехническое проектирование', 'Расчёты освещённости, рабочие чертежи, спецификации\nоборудования, согласование с заказчиком.'],
                ['Поставка оборудования', logo ? 'LED-светильники, контроллеры, кабели, крепёж.\nСобственное производство и проверенные партнёры.' : 'LED-светильники, контроллеры, кабели, крепёж.\nОборудование с гарантией.'],
                ['Монтаж и пусконаладка', 'Монтаж и шеф-монтаж, программирование\nсценариев, обучение персонала.'],
                ['Медиафасады и динамика', 'Линейные и точечные медиасистемы, видеоконтент,\nинтеграция с системами управления.'],
                ['Сервис и гарантия', logo ? 'Гарантия 3 года, до 5 лет по запросу.\nТехническая поддержка после сдачи объекта.' : 'Гарантийное обслуживание и техническая\nподдержка после сдачи объекта.'],
            ];
            items.forEach(([t, d], i) => {
                const x = i % 2 ? 450 : 70.86614, y = 400 - Math.floor(i / 2) * 110;
                text(page, String(i + 1).padStart(2, '0'), x, y, 10, bold, C.red);
                text(page, t, x + 32, y, 11, bold, C.white);
                d.split('\n').forEach((l, j) => text(page, l, x + 32, y - 24 - j * 13, 8.5, regular, C.muted));
            });
            drawLogo(page);
            footer(page, objects.length + 3);
        }

        // --- География: всегда все города портфолио, как карта на сайте ---
        progress('Карта');
        {
            const page = newPage();
            heading(page, 'География проектов', logo ? 'Города, где реализованы проекты «Система Арт»' : 'Города, где реализованы проекты');
            textRight(page, `${map.objCount} ${plural(map.objCount, 'объект', 'объекта', 'объектов')}  ·  ${map.cityCount} ${plural(map.cityCount, 'город', 'города', 'городов')}`, 790, 500, 14, bold, C.white);
            textRight(page, 'от Калининграда до Камчатки', 790, 484, 8, regular, C.muted);
            // Карта сайта нарисована в рамке 800×440 — вписываем её под заголовок
            const k = 0.86, ox = (W - 800 * k) / 2, oy = 440;  // oy — верх карты; низ карты над футером
            const P = (x, y) => [ox + x * k, oy - y * k];
            const r = 1.7;
            // drawSvgPath: y вниз от точки привязки; одной строкой — тысячи точек одним путём
            const dots = map.dots.map(([x, y]) => `M${(ox + x * k - r).toFixed(1)} ${(H - oy + y * k).toFixed(1)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`).join('');
            page.drawSvgPath(dots, { x: 0, y: H, color: C.dots });
            const thumbs = {};
            for (const p of map.points) if (p.big && !thumbs[p.photo]) thumbs[p.photo] = await doc.embedPng(await roundPng(p.photo, 160));
            for (const p of map.points) {
                const [x, y] = P(p.x, p.y), rr = p.r * k;
                page.drawCircle({ x, y, size: (p.big ? rr * 1.45 : rr * 2.2), color: C.red, opacity: 0.16 });
                if (p.big) {
                    page.drawImage(thumbs[p.photo], { x: x - rr, y: y - rr, width: 2 * rr, height: 2 * rr });
                    page.drawCircle({ x, y, size: rr, borderColor: C.red, borderWidth: 1.4 });
                } else {
                    page.drawCircle({ x, y, size: rr, color: C.red, borderColor: C.bg, borderWidth: 0.8 });
                }
                if (p.label) {
                    const name = p.label + ' ', cnt = String(p.n);
                    const wName = bold.widthOfTextAtSize(name, 7.5), wAll = wName + regular.widthOfTextAtSize(cnt, 7);
                    const lx = p.right ? x + rr + 5 : x - rr - 5 - wAll, ly = y - 2.6;
                    text(page, name, lx, ly, 7.5, bold, hex('#D9D5CE'));
                    text(page, cnt, lx + wName, ly, 7, regular, C.red);
                }
            }
            drawLogo(page);
            footer(page, objects.length + 4);
        }

        // --- Контакты ---
        progress('Контакты');
        {
            const page = newPage();
            page.drawRectangle({ x: 0, y: FOOT, width: 17, height: H - FOOT, color: C.red });
            text(page, 'Давайте создадим', 70.86614, 420, 26, bold, C.white);
            text(page, 'новый световой образ', 70.86614, 388, 26, bold, C.white);
            text(page, 'Готовы обсудить ваш проект архитектурного освещения.', 70.86614, 352, 10, regular, C.muted);
            const cards = logo
                ? [['Телефон', BRAND.phone], ['E-mail', BRAND.email], ['Сайт', BRAND.site]]
                : [['Компания', dealer.company], ['Телефон', dealer.phone], ['E-mail', dealer.email], ['Сайт', dealer.site]].filter(c => c[1]);
            cards.forEach(([t, v], i) => {
                const x = 70.86614 + i * 172;
                page.drawRectangle({ x, y: 228, width: 156, height: 74, color: C.card });
                page.drawRectangle({ x, y: 299, width: 156, height: 3, color: C.red });
                text(page, t, x + 12, 278, 9, bold, C.red);
                wrap(v, regular, 10, 132).slice(0, 2).forEach((l, j) => text(page, l, x + 12, 256 - j * 14, 10, regular, C.white));
            });
            if (logo) text(page, '© Группа компаний «Система Арт»', 70.86614, 62, 7, regular, C.muted);
            drawLogo(page);
            footer(page, total);
        }

        // Метаданные файла: без логотипа — без упоминаний бренда
        doc.setTitle(logo ? 'Альбом реализованных проектов — Система Арт' : `Альбом реализованных проектов${dealer.company ? ' — ' + dealer.company : ''}`);
        doc.setAuthor(logo ? BRAND.name : (dealer.company || ''));
        doc.setCreator(logo ? BRAND.site : '');
        doc.setProducer('');
        progress('Сохраняем файл');
        return doc.save();
    }

    function plural(n, one, few, many) {
        return n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many;
    }

    window.buildAlbum = buildAlbum;
    window.albumPlural = plural;
})();
