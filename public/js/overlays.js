// Detail drawer, search palette and modals (settings, shortcuts).
import { $, $$, esc, safeUrl, hostOf, translateUrl, DAY } from './util.js';
import { t, lang } from './i18n.js';
import { ago, agoLong, fullDate, compact, num } from './fmt.js';
import { S, getItem, persist, titleOf, summaryOf, isTranslated, queryTerms, textMatch, score, inDomain } from './model.js';
import { icon, kicker, tags, stat, domainOf } from './ui.js';
import { tokensOf } from './text.js';

// ------------------------------------------------------------------ drawer
let lastFocus = null;

export function openDrawer(id) {
  const it = getItem(id);
  if (!it) return;
  S.drawerId = id;
  if (!S.read.has(id)) {
    S.read.add(id);
    persist('read');
    for (const el of $$(`[data-id="${CSS.escape(id)}"]`)) el.classList.add('read');
  }
  const d = $('#drawer');
  d.innerHTML = drawerHTML(it);
  d.classList.add('open');
  d.setAttribute('aria-hidden', 'false');
  $('#scrim').hidden = false;
  lastFocus = document.activeElement;
  d.querySelector('.drawer-body').scrollTop = 0;
  d.querySelector('[data-action="close-drawer"]')?.focus({ preventScroll: true });
}

export function refreshDrawer() {
  if (S.drawerId && $('#drawer').classList.contains('open')) {
    const it = getItem(S.drawerId);
    if (it) $('#drawer').innerHTML = drawerHTML(it);
  }
}

export function closeDrawer() {
  const d = $('#drawer');
  if (!d.classList.contains('open')) return false;
  d.classList.remove('open');
  d.setAttribute('aria-hidden', 'true');
  $('#scrim').hidden = true;
  S.drawerId = null;
  lastFocus?.focus?.({ preventScroll: true });
  return true;
}

function related(it) {
  const c = S.clusterOf.get(it.id);
  const same = c ? c.ids.filter(x => x !== it.id).map(getItem).filter(Boolean) : [];
  const mine = new Set(tokensOf(it.title));
  const ents = new Set(it.entities || []);
  const skip = new Set([it.id, ...same.map(x => x.id)]);
  const now = Date.now();
  const scored = [];
  for (const o of S.list) {
    if (skip.has(o.id) || now - o.published > 7 * DAY) continue;
    let s = 0;
    for (const tk of tokensOf(o.title)) if (mine.has(tk)) s += 1;
    for (const e of o.entities || []) if (ents.has(e)) s += 1.5;
    if (s >= 2) scored.push([s, o]);
  }
  scored.sort((a, b) => b[0] - a[0] || b[1].published - a[1].published);
  return { same, similar: scored.slice(0, 5).map(x => x[1]) };
}

const relList = list => `<ul class="d-related">${list.map(o => `<li><button type="button" data-action="open" data-id="${esc(o.id)}"><span class="t">${esc(titleOf(o))}</span><span class="s">${esc(o.sourceName)} · ${esc(ago(o.published))}</span></button></li>`).join('')}</ul>`;

function drawerHTML(it) {
  const x = it.extra || {};
  const url = safeUrl(it.url);
  const img = safeUrl(it.image);
  const saved = S.saved.has(it.id);
  const translated = isTranslated(it);
  const showingOriginal = S.showOriginal.has(it.id);
  const isTr = (it.flags || []).includes('tr');
  const sum = summaryOf(it);
  const links = [
    url && `<a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('ext')}${esc(t('act.open'))}</a>`,
    safeUrl(x.discussion) && x.discussion !== it.url && `<a class="btn" href="${esc(safeUrl(x.discussion))}" target="_blank" rel="noopener noreferrer">${icon('chat')}${esc(t('act.discussion'))}</a>`,
    safeUrl(x.code) && `<a class="btn" href="${esc(safeUrl(x.code))}" target="_blank" rel="noopener noreferrer">${icon('code')}${esc(t('act.code'))}</a>`,
    safeUrl(x.demo) && `<a class="btn" href="${esc(safeUrl(x.demo))}" target="_blank" rel="noopener noreferrer">${icon('play')}${esc(t('act.demo'))}</a>`,
    safeUrl(x.pdf) && `<a class="btn" href="${esc(safeUrl(x.pdf))}" target="_blank" rel="noopener noreferrer">${icon('doc')}${esc(t('act.pdf'))}</a>`,
    `<button class="btn" type="button" data-action="save" data-id="${esc(it.id)}">${icon('saved')}${esc(saved ? t('act.saved') : t('act.save'))}</button>`,
    `<button class="btn ghost" type="button" data-action="copy" data-id="${esc(it.id)}">${icon('copy')}${esc(t('act.copy'))}</button>`,
  ].filter(Boolean).join('');

  const st = stat(it);
  const facts = [
    [t('drawer.source'), `${esc(it.sourceName)}${url ? ` · ${esc(hostOf(url))}` : ''}`],
    [t('drawer.published'), esc(`${fullDate(it.published)} (${agoLong(it.published)})`)],
    it.author && [t('drawer.author'), esc(it.author)],
    st && ['', esc(st)],
  ].filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('');

  const { same, similar } = related(it);
  const trNote = translated
    ? `<div class="d-note">${icon('translate')}<span>${esc(t('drawer.translatedBy'))}</span><button type="button" data-action="toggle-original" data-id="${esc(it.id)}">${esc(t('act.original'))}</button>${url ? `<a href="${esc(translateUrl(url))}" target="_blank" rel="noopener noreferrer" style="text-decoration:underline;text-underline-offset:3px">Google Translate ↗</a>` : ''}</div>`
    : showingOriginal ? `<div class="d-note"><button type="button" data-action="toggle-original" data-id="${esc(it.id)}">${esc(t('act.translated'))}</button></div>`
    : lang === 'tr' && !isTr && url ? `<div class="d-note">${icon('translate')}<a href="${esc(translateUrl(url))}" target="_blank" rel="noopener noreferrer" style="text-decoration:underline;text-underline-offset:3px">Google Translate ↗</a></div>` : '';

  return `<div class="drawer-top">${kicker(it, { withKind: true })}
      <button class="icon-btn" type="button" data-action="close-drawer" aria-label="${esc(t('act.close'))}">${icon('close', 'i')}</button></div>
    <div class="drawer-body">
      <h2 class="d-title">${esc(titleOf(it))}</h2>
      ${trNote}
      ${img ? `<figure class="d-img"><img src="${esc(img)}" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></figure>` : ''}
      ${sum ? `<p class="d-sum">${esc(sum)}</p>` : ''}
      <div class="d-actions">${links}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:-8px 0 18px">${tags(it)}</div>
      <dl class="d-facts">${facts}</dl>
      ${same.length ? `<div class="d-section"><h4>${esc(t('drawer.related'))}</h4>${relList(same)}</div>` : ''}
      ${similar.length ? `<div class="d-section"><h4>${esc(t('drawer.similar'))}</h4>${relList(similar)}</div>` : ''}
    </div>`;
}

// ------------------------------------------------------------------ search palette
let pal = { open: false, results: [], sel: 0 };

export function openPalette(initial = '') {
  const p = $('#palette');
  p.innerHTML = `<div class="pal-box" role="document">
    <div class="pal-input">${icon('search', 'i')}<input id="pal-q" type="text" placeholder="${esc(t('search.placeholder'))}" autocomplete="off" spellcheck="false" value="${esc(initial)}"><kbd>Esc</kbd></div>
    <div class="pal-list" id="pal-list" role="listbox"></div>
    <div class="pal-foot">${esc(t('search.hint'))}</div></div>`;
  p.hidden = false;
  pal = { open: true, results: [], sel: 0 };
  const input = $('#pal-q');
  input.addEventListener('input', () => { pal.sel = 0; paletteSearch(input.value); });
  input.focus();
  paletteSearch(initial);
}

export function closePalette() {
  if (!pal.open) return false;
  $('#palette').hidden = true;
  pal.open = false;
  return true;
}
export const paletteOpen = () => pal.open;

function paletteSearch(q) {
  const terms = queryTerms(q);
  const now = Date.now();
  let results = [];
  if (terms.length) {
    results = S.list.filter(it => textMatch(it, terms)).map(it => [score(it, now) + (inDomain(it) ? 15 : 0), it]).sort((a, b) => b[0] - a[0]).slice(0, 30)
      .map(([, it]) => ({ type: 'item', id: it.id, title: titleOf(it), sub: `${it.sourceName} · ${ago(it.published, now)}`, d: domainOf(it), url: it.url }));
    const boards = [
      ...(S.boards.ghRising7 || []).map(r => ({ type: 'board', board: 'repo', key: r.full_name, title: r.full_name, sub: `GitHub · ${compact(r.stars)} ★`, d: r.domains?.[0], url: r.url, hay: `${r.full_name} ${r.description}` })),
      ...Object.values(S.boards.hfModels || {}).flat().map(m => ({ type: 'board', board: 'model', key: m.id, title: m.id, sub: `Hugging Face · ${m.topic ? t(`topic.${m.topic}`) : m.task}`, d: m.domain, url: m.url, hay: `${m.id} ${m.task} ${m.library}` })),
    ].filter(b => terms.every(x => b.hay.toLocaleLowerCase('tr').includes(x)));
    const seen = new Set(results.map(r => r.title));
    results.push(...boards.filter(b => !seen.has(b.title) && seen.add(b.title)).slice(0, 10));
  } else {
    results = S.list.filter(it => inDomain(it) && it.kind !== 'trend').slice(0, 10).map(it => ({ type: 'item', id: it.id, title: titleOf(it), sub: `${it.sourceName} · ${ago(it.published, now)}`, d: domainOf(it), url: it.url }));
  }
  pal.results = results;
  const list = $('#pal-list');
  if (!results.length) { list.innerHTML = `<div class="empty" style="padding:30px">${esc(t('search.empty'))}</div>`; return; }
  list.innerHTML = `<div class="pal-group">${esc(terms.length ? t('search.results') : t('search.latest'))}</div>` + results.map((r, i) => `
    <button class="pal-item" type="button" role="option" data-pal="${i}" aria-selected="${i === pal.sel}">
      <span style="min-width:0"><span class="t" style="display:block">${esc(r.title)}</span><span class="s">${r.d ? `<span class="dot d-${r.d}"></span>` : ''}${esc(r.sub)}</span></span></button>`).join('');
}

export function paletteKey(e, run) {
  if (e.key === 'Escape') { closePalette(); return true; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!pal.results.length) return true;
    pal.sel = (pal.sel + (e.key === 'ArrowDown' ? 1 : -1) + pal.results.length) % pal.results.length;
    $$('.pal-item').forEach(el => el.setAttribute('aria-selected', String(Number(el.dataset.pal) === pal.sel)));
    $(`.pal-item[data-pal="${pal.sel}"]`)?.scrollIntoView({ block: 'nearest' });
    return true;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const r = pal.results[pal.sel];
    closePalette();
    if (r) run(r, e.shiftKey);
    return true;
  }
  return false;
}

export function paletteClick(e, run) {
  const btn = e.target.closest('.pal-item');
  if (!btn) { if (e.target.id === 'palette') closePalette(); return; }
  const r = pal.results[Number(btn.dataset.pal)];
  closePalette();
  if (r) run(r, e.shiftKey);
}

// ------------------------------------------------------------------ modals
export function openModal(title, body) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-box"><div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" type="button" data-action="close-modal" aria-label="${esc(t('act.close'))}">${icon('close', 'i')}</button></div><div class="modal-body">${body}</div></div>`;
  m.hidden = false;
  m.setAttribute('aria-label', title);
  m.querySelector('button, input, select')?.focus();
}
export function closeModal() {
  const m = $('#modal');
  if (m.hidden) return false;
  m.hidden = true;
  m.innerHTML = '';
  return true;
}
export const modalOpen = () => !$('#modal').hidden;

export function settingsBody() {
  const st = S.settings || {};
  const pub = S.mode === 'static' || st.public;
  const state = (on, env) => (on ? `<span class="ok">● ${esc(t('settings.set'))}${env ? ` (${esc(t('settings.fromEnv'))})` : ''}</span>` : `<span class="no">○ ${esc(t('settings.notSet'))}</span>`);
  const ok = S.sources.filter(s => s.ok).length;
  const now = Date.now();
  const sources = [...S.sources].sort((a, b) => (a.ok === false ? -1 : 0) - (b.ok === false ? -1 : 0) || a.name.localeCompare(b.name, 'tr')).map(s => {
    const st2 = s.running || s.queued ? 'run' : s.ok ? 'ok' : s.ok === false ? 'err' : 'wait';
    return `<li><span class="led" data-s="${st2}"></span><span style="min-width:0">${esc(s.name)}${s.error ? `<span class="err">${esc(s.error)}</span>` : ''}</span><span class="meta">${s.count != null ? esc(t('src.items', { n: s.count })) + ' · ' : ''}${s.lastRun ? esc(agoLong(s.lastRun, now)) : '—'}</span></li>`;
  }).join('');

  const seg = (action, opts, cur) => `<div class="seg">${opts.map(([v, l]) => `<button type="button" data-action="${action}" data-v="${v}" aria-pressed="${cur === v}">${esc(l)}</button>`).join('')}</div>`;

  return `<form data-form="settings" autocomplete="off">
    <div class="set-row"><div class="set-label">${esc(t('settings.language'))}</div>
      <div>${seg('lang', [['tr', 'Türkçe'], ['en', 'English']], lang)}</div></div>
    <div class="set-row"><div class="set-label">${esc(t('settings.theme'))}</div>
      <div>${seg('set-theme', [['dark', t('settings.dark')], ['light', t('settings.light')], ['system', t('settings.system')]], S.prefs.theme)}</div></div>
    <div class="set-row"><div class="set-label">${esc(t('settings.alerts'))}</div>
      <div class="set-flex">
        <button class="btn sm" type="button" data-action="sound">${icon('bell')}${esc(S.prefs.sound ? t('settings.soundOn') : t('settings.soundOff'))}</button>
        <button class="btn sm" type="button" data-action="notify-toggle">${icon('bell')}${esc(S.prefs.notify ? t('watch.notifyOn') : t('watch.notifyOff'))}</button>
      </div><p>${esc(t('watch.hint'))}</p></div>
    <div class="set-row"><div class="set-label">${esc(t('settings.sources'))}<small>${esc(t('settings.sourcesNote', { ok, n: S.sources.length, items: num(S.items.size) }))}</small></div>
      <div>${S.mode === 'live' ? `<button class="btn sm" type="button" data-action="refresh">${icon('refresh')}${esc(t('settings.refresh'))}</button>` : ''}<ul class="src-list">${sources}</ul></div></div>
    ${pub ? `<div class="set-row"><div class="set-label">${esc(t('settings.advanced'))}</div><div><p style="margin-top:7px">${esc(t('settings.publicNote'))}</p></div></div>` : `
    <div class="set-row"><div class="set-label">${esc(t('settings.github'))}<small>${state(st.github, st.githubFromEnv)}</small></div>
      <div><input class="field" type="password" name="githubToken" placeholder="ghp_…"><p>${esc(t('settings.githubNote'))}</p></div></div>
    <div class="set-row"><div class="set-label">${esc(t('settings.anthropic'))}<small>${state(st.anthropic, st.anthropicFromEnv)}</small></div>
      <div><input class="field" type="password" name="anthropicKey" placeholder="sk-ant-…"><p>${esc(t('settings.anthropicNote'))}</p></div></div>
    <div class="set-row"><div class="set-label">${esc(t('settings.profile'))}</div>
      <div><textarea class="field" name="profile" maxlength="600" placeholder="${esc(t('settings.profilePh'))}">${esc(st.profile || '')}</textarea><p>${esc(t('settings.profileNote'))}</p></div></div>`}
    <div class="set-row"><div class="set-label">${esc(t('settings.data'))}</div>
      <div class="set-flex"><button class="btn sm" type="button" data-action="mark-read">${esc(t('settings.markRead'))}</button><button class="btn sm ghost" type="button" data-action="clear-read">${esc(t('settings.clearRead'))}</button><button class="btn sm ghost" type="button" data-action="keys">${esc(t('settings.keys'))}</button></div></div>
    <div class="set-row"><div class="set-label">${esc(t('settings.about'))}</div><div><p style="margin-top:7px">${esc(t('settings.aboutText', { n: S.sources.length }))}</p></div></div>
    ${pub ? '' : `<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px"><button class="btn ghost" type="button" data-action="close-modal">${esc(t('settings.cancel'))}</button><button class="btn primary" type="submit">${esc(t('settings.save'))}</button></div>`}
  </form>`;
}

export function keysBody() {
  const keys = [['J', t('keys.next')], ['K', t('keys.prev')], ['Enter', t('keys.open')], ['Shift + O', t('keys.link')], ['S', t('keys.save')],
    ['/  ·  Ctrl K', t('keys.search')], ['1 – 6', t('keys.sections')], ['L', t('keys.lang')], ['Esc', t('keys.close')]];
  return `<div class="keys">${keys.map(([k, d]) => `<div><span>${esc(d)}</span><kbd>${esc(k)}</kbd></div>`).join('')}</div>`;
}
