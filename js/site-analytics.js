(() => {
    const counter = 113787422;
    const fields = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'yclid', 'gclid'];
    const storageKey = 'sysart-attribution-v1';
    const now = Date.now();
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch {}
    if (!saved.updated || now - saved.updated > 90 * 86400000) saved = {};

    const params = new URLSearchParams(location.search);
    const tags = Object.fromEntries(fields.filter(key => params.has(key)).map(key => [key, params.get(key).slice(0, 500)]));
    let referrer = '';
    try {
        const url = new URL(document.referrer);
        if (url.origin !== location.origin) referrer = url.origin;
    } catch {}
    const visit = { landing: location.origin + location.pathname, referrer, ...tags };
    saved.first ||= visit;
    if (Object.keys(tags).length || referrer || !saved.last) saved.last = visit;
    saved.updated = now;
    try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch {}

    window.sysartAnalytics = {
        goal(name, data = {}) {
            if (typeof window.ym === 'function') window.ym(counter, 'reachGoal', name, data);
        },
        attribution() {
            return { first: saved.first, last: saved.last, page: location.origin + location.pathname };
        }
    };

    // Local previews do not send visits to the production counter.
    if (!['sysartspb.com', 'www.sysartspb.com'].includes(location.hostname)) return;
    if (!window.ym) {
        window.ym = function () { (window.ym.a = window.ym.a || []).push(arguments); };
        window.ym.l = now;
        const script = document.createElement('script');
        script.async = true;
        script.src = 'https://mc.yandex.ru/metrika/tag.js?id=' + counter;
        document.head.append(script);
        window.ym(counter, 'init', { webvisor: true, clickmap: true, accurateTrackBounce: true, trackLinks: true });
    }
    document.addEventListener('click', event => {
        const link = event.target.closest('a[href]');
        if (!link) return;
        const href = link.getAttribute('href');
        if (href.startsWith('tel:')) window.sysartAnalytics.goal('phone');
        else if (href.startsWith('mailto:')) window.sysartAnalytics.goal('email');
        else if (href.includes('wa.me/')) window.sysartAnalytics.goal('whatsapp');
        else if (href.includes('max.ru/')) window.sysartAnalytics.goal('max');
        else if (/\.pdf(?:[?#]|$)/i.test(href)) window.sysartAnalytics.goal('catalog_pdf');
        else if (link.dataset.goal) window.sysartAnalytics.goal(link.dataset.goal);
    });
})();
