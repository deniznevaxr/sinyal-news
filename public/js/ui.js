// Shared render helpers: icons, kickers, list rows, cards and toasts.
import { $, esc, safeUrl, highlight } from './util.js';
import { t, hasT } from './i18n.js';
import { ago, compact } from './fmt.js';
import { S, TOPIC_DOMAIN, titleOf, summaryOf, isNew, watchHits } from './model.js';
import { platform, shareGlyph } from './mobile.js';

const ICONS = {
  ext: '<path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 9.5v4H2.5V4h4"/>',
  close: '<path d="m4 4 8 8M12 4l-8 8"/>',
  copy: '<rect x="5" y="5" width="8.5" height="8.5" rx="1.2"/><path d="M3 10.5V3h7.5"/>',
  saved: '<path d="M4 2.5h8v11l-4-2.8-4 2.8z"/>',
  chat: '<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/>',
  code: '<path d="m5.5 4.5-3 3.5 3 3.5M10.5 4.5l3 3.5-3 3.5"/>',
  play: '<path d="M5 3.5v9l7.5-4.5z"/>',
  doc: '<path d="M4 2h6l3 3v9H4z"/><path d="M10 2v3h3"/>',
  translate: '<path d="M2 3.5h7M5.5 2v1.5M3.5 3.5s.5 4 4 6M7.5 3.5s-.5 4-5 6.5M9 14l2.5-6 2.5 6M9.8 12.2h3.4"/>',
  bolt: '<path d="M9 1.5 3.5 9h4l-1 5.5L12.5 7h-4z"/>',
  bell: '<path d="M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8z"/><path d="M6.5 14h3"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  search: '<circle cx="7" cy="7" r="4.75"/><path d="M10.5 10.5 14 14"/>',
  refresh: '<path d="M13.5 8A5.5 5.5 0 1 1 11.9 4.1"/><path d="M13.6 2.2v3.1h-3.1"/>',
  star: '<path d="m8 2 1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z"/>',
  home: '<path d="M2.5 7 8 2.5 13.5 7v6.5H9.8v-4H6.2v4H2.5z"/>',
  news: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.8"/><path d="M5 5.6h6M5 8h6M5 10.4h3.6"/>',
  video: '<rect x="1.8" y="3.5" width="12.4" height="9" rx="2"/><path d="m6.8 6.2 3.1 1.8-3.1 1.8z"/>',
  cube: '<path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5z"/><path d="M2.5 5 8 8.2 13.5 5M8 8.2v6"/>',
  dots: '<circle cx="3.3" cy="8" r="1.15" fill="currentColor"/><circle cx="8" cy="8" r="1.15" fill="currentColor"/><circle cx="12.7" cy="8" r="1.15" fill="currentColor"/>',
  share: '<path d="M8 1.8v8.2M5.2 4.4 8 1.6l2.8 2.8"/><path d="M5.6 6.6H4.2v7.6h7.6V6.6h-1.4"/>',
  chev: '<path d="m6 3.5 4.5 4.5L6 12.5"/>',
  sliders: '<path d="M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7"/><circle cx="10.5" cy="4.5" r="1.6"/><circle cx="5.5" cy="11.5" r="1.6"/>',
  download: '<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>',
  power: '<path d="M8 2v5.5"/><path d="M4.6 4.2a5 5 0 1 0 6.8 0"/>',
};
export const icon = (name, cls = 'i sm') => `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true">${ICONS[name] || ''}</svg>`;

export function domainOf(it) {
  return it.topic ? TOPIC_DOMAIN[it.topic] : (it.domains || [])[0] || null;
}

// "● Müzik · Synth & enstrüman" — the one line that says what a story is about.
export function kicker(it, { withNew = true, withKind = false } = {}) {
  const d = domainOf(it);
  const parts = [];
  if (d) parts.push(`<span class="dot d-${d}"></span><span>${esc(t(`domain.${d}`))}</span>`);
  if (it.topic) parts.push(`${d ? '<span class="sep">·</span>' : ''}<span>${esc(t(`topic.${it.topic}`))}</span>`);
  if (withKind && it.kind !== 'news') parts.push(`<span class="sep">·</span><span>${esc(t(`kind.${it.kind}`))}</span>`);
  if (withNew && isNew(it) && !S.read.has(it.id)) parts.push(`<span class="new">${esc(t('meta.new').toLocaleUpperCase(document.documentElement.lang))}</span>`);
  return `<div class="kicker">${parts.join('')}</div>`;
}

export function tags(it) {
  const out = [];
  const c = S.clusterOf.get(it.id);
  if (c && c.sources > 1) out.push(`<span class="tag cov" title="${esc(c.sourceNames.join(', '))}">${esc(t('meta.sources', { n: c.sources }))}</span>`);
  if ((it.flags || []).includes('deal')) out.push(`<span class="tag deal">${esc(t('meta.deal'))}</span>`);
  for (const w of watchHits(it).slice(0, 2)) out.push(`<span class="tag watch">${esc(w)}</span>`);
  return out.join('');
}

export function stat(it) {
  const m = it.metrics || {};
  if (m.points) return t('meta.points', { n: compact(m.points) });
  if (m.starsPeriod) return `+${compact(m.starsPeriod)} ★`;
  if (m.stars) return `${compact(m.stars)} ★`;
  if (m.upvotes) return t('meta.votes', { n: compact(m.upvotes) });
  if (m.views) return t('meta.views', { n: compact(m.views) });
  if (m.trending) return `${t('tools.trendScore')} ${m.trending}`;
  return '';
}

export function item(it, { now = Date.now(), terms = [] } = {}) {
  const img = safeUrl(it.image);
  const read = S.read.has(it.id);
  const sum = summaryOf(it);
  const st = stat(it);
  return `<article class="item${img ? '' : ' nothumb'}${read ? ' read' : ''}" data-action="open" data-id="${esc(it.id)}" data-nav>
    <div>
      ${kicker(it, { withKind: true })}
      <h3 class="item-title">${highlight(titleOf(it), [...terms, ...watchHits(it)])}</h3>
      ${sum ? `<p class="item-sum">${esc(sum)}</p>` : ''}
      <div class="item-meta"><span class="src">${esc(it.sourceName)}</span><span data-ts="${it.published}">${esc(ago(it.published, now))}</span>${st ? `<span>${esc(st)}</span>` : ''}${tags(it)}</div>
    </div>
    ${img ? `<div class="item-thumb"><img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.item').classList.add('nothumb');this.parentNode.remove()"></div>` : ''}
  </article>`;
}

export function mini(it, now = Date.now()) {
  const d = domainOf(it);
  return `<li class="mini-item${S.read.has(it.id) ? ' read' : ''}" data-action="open" data-id="${esc(it.id)}" data-nav>
    <span class="mini-time" data-ts="${it.published}">${esc(ago(it.published, now))}</span>
    <span><span class="mini-title">${esc(titleOf(it))}</span><span class="mini-sub">${d ? `<span class="dot d-${d}"></span>` : ''}${esc(it.sourceName)}</span></span>
  </li>`;
}

export function video(v, now = Date.now()) {
  const img = safeUrl(v.image);
  return `<article class="video${S.read.has(v.id) ? ' read' : ''}" data-action="open" data-id="${esc(v.id)}" data-nav>
    <div class="video-thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<span class="play"></span></div>
    <div class="video-title">${esc(titleOf(v))}</div>
    <div class="video-meta"><span>${esc(v.sourceName)}</span><span data-ts="${v.published}">${esc(ago(v.published, now))}</span>${v.metrics?.views ? `<span>${esc(t('meta.views', { n: compact(v.metrics.views) }))}</span>` : ''}</div>
  </article>`;
}

// "Add SİNYAL to your home screen", told the way this phone's browser does it.
// bare: just the steps (Settings); dismissable: with a "later" button (the Gündem card).
export function installCard({ dismissable = false, bare = false } = {}) {
  const app = S.app || {};
  if (app.standalone) return '';
  const action = app.canInstall && !bare ? `<button class="btn primary" type="button" data-action="install">${icon('download')}${esc(t('install.button'))}</button>` : '';
  let help = '';
  if (!app.canInstall) {
    if (platform.inApp) help = `<p>${esc(t('install.inApp'))}</p>`;
    else if (platform.ios) help = `<ol class="install-steps"><li>${esc(t(platform.iosSafari ? 'install.ios1' : 'install.iosOther', { icon: '§' })).replace('§', shareGlyph())}</li><li>${esc(t('install.ios2'))}</li></ol>`;
    else if (platform.android) help = `<p>${esc(t('install.android'))}</p>`;
  }
  if (bare) return help;
  if (!action && !help) return ''; // computers: the header button and Settings cover it
  const later = dismissable ? `<button class="btn ghost" type="button" data-action="install-dismiss">${esc(t(action ? 'install.later' : 'install.ok'))}</button>` : '';
  return `<section class="install-card"><img class="app-ico" src="icons/icon-192.png" alt="" width="48" height="48">
    <div><h3>${esc(t('install.title'))}</h3><p>${esc(t('install.text'))}</p>${help}${action || later ? `<div class="install-actions">${action}${later}</div>` : ''}</div></section>`;
}

// One plain line that says what a repository, model or demo is ("Yazılı tariften müzik
// üreten model · LoRA eki…"), from the facts lib/about.js read off its page.
export function whatLabel(kind, about, { task = '', codeLang = '' } = {}) {
  const m = about?.meta || {};
  const k = m.kind || kind;
  if (k === 'space') return t('what.space');
  if (k === 'model') {
    const base = String(m.base || '').split('/').pop();
    if (m.lora) return base ? t('what.lora', { base }) : t('what.loraNoBase');
    const tk = m.task || task;
    const parts = [tk && hasT(`what.task.${tk}`) ? t(`what.task.${tk}`) : t('what.model')];
    if (m.gguf) parts.push(t('what.gguf'));
    else if (m.quant) parts.push(t('what.quant'));
    if (base) parts.push(t('what.base', { base }));
    return parts.join(' · ');
  }
  const l = m.lang || codeLang;
  return l ? t('what.repoLang', { lang: l }) : t('what.repo');
}

export function empty(title, sub, loading = false) {
  return `<div class="empty">${loading ? '<div class="eq"><i></i><i></i><i></i><i></i><i></i></div>' : ''}<div class="empty-title">${esc(title)}</div><div>${esc(sub)}</div></div>`;
}

export function toast(title, text = '', { bad = false, onClick, ttl = 6000 } = {}) {
  const el = document.createElement('div');
  el.className = `toast${bad ? ' bad' : ''}`;
  el.innerHTML = `<b>${esc(title)}</b>${text ? `<p>${esc(text)}</p>` : ''}`;
  el.addEventListener('click', () => { onClick?.(); el.remove(); });
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ttl);
  const all = $('#toasts').children;
  if (all.length > 4) all[0].remove();
}
