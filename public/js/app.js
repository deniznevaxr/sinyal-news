// SİNYAL — client bootstrap. Works in two modes:
//   live   — talking to server.js (local or hosted): Server-Sent Events push new stories
//   static — a published copy (GitHub Pages…): data.json is re-read every few minutes
import { $, $$, esc, debounce, storage, copyText, safeUrl, HOUR, DAY } from './util.js';
import { t, lang, setLang } from './i18n.js';
import { ago, agoLong } from './fmt.js';
import { S, SECTIONS, persist, setItems, addItems, applyTranslations, setAnalysis, compileWatch, watchHits, getItem, visible, needsTranslation, titleOf } from './model.js';
import { toast } from './ui.js';
import { renderChrome, renderSections, renderStatus, renderSavedBadge, renderDomains } from './chrome.js';
import { renderMain, refreshNewsList, showMore, boardItem } from './views.js';
import {
  openDrawer, refreshDrawer, closeDrawer, openPalette, paletteOpen, paletteKey, paletteClick, openModal, closeModal, modalOpen, settingsBody, keysBody,
  openSheet, closeSheet, sheetOpen, moreBody, layers, anyLayerOpen, closeTopLayer,
} from './overlays.js';
import { generateBrief, copyBrief, refreshBrief, toggleBrief } from './brief.js';
import { probeDeviceTranslator, deviceTranslatorState, translateOnDevice } from './translate.js';
import { phone, platform, autoHideHeader, pullToRefresh } from './mobile.js';

const sessionStart = Date.now();
let sel = -1;
let unseen = 0;

// ------------------------------------------------------------------ prefs
function resolvedTheme() {
  if (S.prefs.theme === 'system') return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return S.prefs.theme === 'light' ? 'light' : 'dark';
}
function applyPrefs() {
  document.documentElement.dataset.theme = resolvedTheme();
  document.documentElement.lang = lang;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme() === 'light' ? '#eef0f2' : '#0c0d10');
  window.sinyalDesktop?.setTheme(S.prefs.theme); // Windows app: the title bar follows the theme
}
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => S.prefs.theme === 'system' && applyPrefs());

// ------------------------------------------------------------------ data
const getJSON = async url => {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) throw new Error(`${url} → ${r.status}`);
  return r.json();
};

function applyState(state) {
  setItems(state.items || []);
  S.boards = state.boards || {};
  S.transient.clear();
  setAnalysis(state.analysis);
  S.sources = state.sources || [];
  S.events = state.events || [];
  S.meta = state.meta || {};
  S.busy = state.meta?.busy || S.busy;
  S.brief = state.brief || null;
}

const STATIC_BUILD = document.querySelector('meta[name="sinyal-mode"]')?.content === 'static';

async function loadAll() {
  try {
    if (STATIC_BUILD) throw new Error('static');
    const state = await getJSON('api/state');
    S.mode = 'live';
    applyState(state);
    S.settings = await getJSON('api/settings').catch(() => ({ public: state.meta?.public }));
  } catch {
    const state = await getJSON(`data.json?t=${Date.now()}`);
    S.mode = 'static';
    applyState(state);
    S.settings = { public: true, ...(state.meta?.flags || {}) };
    S.connected = 'live';
  }
}

function renderAll({ keepScroll = false } = {}) {
  renderChrome();
  renderInstall();
  renderMain({ keepScroll });
  autoTranslate();
}

// ------------------------------------------------------------------ installable app (PWA)
// Installed, SİNYAL opens in its own window with its own icon — no browser tab, no address bar.
// The Windows app (desktop/) counts as installed too.
let installPrompt = null;
const isStandalone = () => platform.standalone() || !!window.sinyalDesktop;
S.app = { canInstall: false, standalone: isStandalone() };

function renderInstall() {
  S.app = { canInstall: !!installPrompt, standalone: isStandalone() };
  const btn = $('#install-btn');
  btn.hidden = !installPrompt || S.app.standalone;
  btn.querySelector('span').textContent = t('app.install');
  btn.setAttribute('aria-label', t('app.install'));
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  renderInstall();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  renderInstall();
  toast(t('app.installed'), t('app.installedText'));
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* the app still works without it */ });
  // A tapped notification asks the open window to show its story.
  navigator.serviceWorker.addEventListener('message', e => { if (e.data?.open) openDrawer(e.data.open); });
}

// ------------------------------------------------------------------ live mode (SSE)
let es = null;
function connect() {
  es?.close();
  es = new EventSource('api/stream');
  es.addEventListener('hello', async e => {
    const meta = JSON.parse(e.data);
    const wasDown = S.connected === 'retry' || S.connected === 'offline';
    S.connected = 'live';
    S.busy = meta.busy || S.busy;
    renderStatus();
    if (wasDown) {
      try { await loadAll(); renderAll({ keepScroll: true }); } catch { /* next hello retries */ }
    }
  });
  es.addEventListener('status', e => {
    const { source, busy } = JSON.parse(e.data);
    const i = S.sources.findIndex(s => s.id === source.id);
    if (i >= 0) S.sources[i] = source; else S.sources.push(source);
    S.busy = busy;
    statusSoon();
  });
  es.addEventListener('busy', e => { S.busy = JSON.parse(e.data); statusSoon(); });
  es.addEventListener('items', e => {
    const { items, backfill } = JSON.parse(e.data);
    onItems(addItems(items), backfill);
  });
  es.addEventListener('boards', e => {
    Object.assign(S.boards, JSON.parse(e.data));
    S.transient.clear();
    viewSoon(['home', 'tools']);
  });
  es.addEventListener('analysis', e => { setAnalysis(JSON.parse(e.data)); viewSoon(['home']); });
  es.addEventListener('tr', e => {
    applyTranslations(JSON.parse(e.data));
    if (lang === 'tr') { viewSoon([S.section]); refreshDrawer(); }
  });
  es.addEventListener('brief', e => { S.brief = JSON.parse(e.data); refreshBrief(); });
  es.addEventListener('meta', e => {
    const m = JSON.parse(e.data);
    if (m.flags) S.settings = { ...(S.settings || {}), ...m.flags };
  });
  es.onerror = () => {
    S.connected = navigator.onLine === false ? 'offline' : 'retry';
    renderStatus();
  };
}

// ------------------------------------------------------------------ static mode (polling)
// Returns how many new stories arrived (0: nothing new, -1: could not reach the site).
let lastPoll = 0;
async function poll({ quiet = false } = {}) {
  lastPoll = Date.now();
  try {
    const state = await getJSON(`data.json?t=${Date.now()}`);
    if ((state.meta?.generatedAt || 0) <= (S.meta.generatedAt || 0)) return 0;
    const known = new Set(S.items.keys());
    const fresh = (state.items || []).filter(it => !known.has(it.id));
    applyState(state);
    onItems(fresh, quiet || !known.size);
    renderStatus();
    viewSoon([S.section]);
    return fresh.length;
  } catch {
    return -1; // try again next round
  }
}

// Pull-to-refresh in the installed phone app.
async function pullRefresh() {
  if (S.mode === 'live') { await refreshAll(); return; }
  const n = await poll({ quiet: true });
  if (n < 0) toast(t('toast.offline'), t('toast.offlineText'), { bad: true });
  else if (n > 0) toast(t('toast.new', { n }));
  else toast(t('ptr.uptodate'), `${t('status.static', { t: agoLong(S.meta.generatedAt) })} · ${t('ptr.next')}`);
}

// ------------------------------------------------------------------ incremental updates
const statusSoon = debounce(() => { renderStatus(); renderSections(); }, 400);
const pendingViews = new Set();
const flushViews = debounce(() => {
  if (pendingViews.has(S.section) || pendingViews.has('*')) {
    if (S.section === 'news') updateNewsLive();
    else renderMain({ keepScroll: true });
    autoTranslate();
  }
  pendingViews.clear();
}, 900);
function viewSoon(sections) {
  for (const s of sections) pendingViews.add(s);
  flushViews();
}

function onItems(fresh, backfill) {
  for (const it of fresh) S.sessionNew.add(it.id);
  if (!fresh.length) return;
  if (!backfill) alerts(fresh);
  if (S.section === 'news') S.pendingNew += fresh.filter(visible).length;
  statusSoon();
  viewSoon(['home', 'news', 'videos', 'papers', 'community']);
}

function updateNewsLive() {
  if (window.scrollY < 300) {
    refreshNewsList();
    S.pendingNew = 0;
    const pill = $('#newpill');
    if (pill) pill.innerHTML = '';
  } else if (S.pendingNew) {
    const pill = $('#newpill');
    if (pill) pill.innerHTML = `<button type="button" data-action="newpill">↑ ${esc(t('toast.new', { n: S.pendingNew }))}</button>`;
  }
}

// On-device translation for whatever the server has not translated yet.
let autoBusy = false;
async function autoTranslate() {
  if (lang !== 'tr' || autoBusy || deviceTranslatorState() !== 'available') return;
  const todo = [...$$('#main [data-id]')].map(el => getItem(el.dataset.id)).filter(it => it && needsTranslation(it)).slice(0, 40);
  if (!todo.length) return;
  autoBusy = true;
  await translateOnDevice(todo, debounce(() => renderMain({ keepScroll: true }), 300));
  autoBusy = false;
}

// ------------------------------------------------------------------ alerts
let audio = null;
function blip(kind = 'new') {
  if (!S.prefs.sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audio.currentTime;
    const notes = kind === 'watch' ? [880, 1318.5] : [880]; // A5 (+E6) — the local server listens on :4400
    notes.forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t0 + i * 0.11);
      g.gain.setValueAtTime(0.0001, t0 + i * 0.11);
      g.gain.exponentialRampToValueAtTime(0.16, t0 + i * 0.11 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.11 + 0.32);
      o.connect(g).connect(audio.destination);
      o.start(t0 + i * 0.11);
      o.stop(t0 + i * 0.11 + 0.35);
    });
  } catch { /* audio unavailable */ }
}

let batch = [];
const flushBatch = debounce(() => {
  const list = batch.filter(visible);
  batch = [];
  if (!list.length) return;
  const hits = list.filter(it => watchHits(it).length);
  if (hits.length) {
    blip('watch');
    for (const it of hits.slice(0, 3)) {
      const terms = watchHits(it).join(', ');
      toast(t('toast.watch', { terms }), titleOf(it), { onClick: () => openDrawer(it.id), ttl: 12000 });
      if (S.prefs.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        notify(`SİNYAL · ${terms}`, `${titleOf(it)}\n${it.sourceName}`, it.id);
      }
    }
  } else {
    blip('new');
    if (!(S.section === 'news' && window.scrollY < 300)) {
      toast(t('toast.new', { n: list.length }), titleOf(list[0]), { onClick: () => setSection('news') });
    }
  }
  if (document.hidden) {
    unseen += list.length;
    document.title = `(${unseen}) SİNYAL`;
  }
}, 8000);

function alerts(fresh) {
  // Only genuinely recent stories alert (a feed re-surfacing old posts should stay quiet).
  batch.push(...fresh.filter(it => Date.now() - it.published < 12 * HOUR));
  flushBatch();
}

// Through the service worker where possible: Android only allows notifications from there.
async function notify(title, body, id) {
  const opts = { body, tag: id, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { id } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.showNotification(title, opts); return; }
    const n = new Notification(title, opts);
    n.onclick = () => { window.focus(); openDrawer(id); n.close(); };
  } catch { /* notifications blocked */ }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    unseen = 0;
    document.title = 'SİNYAL — Ses, Müzik ve Görsel Teknoloji Haberleri';
    // Phones freeze background apps: catch up as soon as SİNYAL is back on screen.
    if (S.mode === 'static' && Date.now() - lastPoll > 60e3) poll();
  } else rememberVisit();
});
window.addEventListener('pagehide', rememberVisit);
function rememberVisit() {
  // Quick reloads keep the old baseline so "new" markers don't vanish on F5.
  if (Date.now() - sessionStart > 120e3) storage.set('lastSeen', Date.now());
}

// ------------------------------------------------------------------ navigation
function setSection(s) {
  closeSheet();
  S.section = [...SECTIONS, 'saved'].includes(s) ? s : 'home';
  persist('section');
  sel = -1;
  S.pendingNew = 0;
  renderSections();
  renderSavedBadge();
  renderMain();
  window.scrollTo(0, 0);
  autoTranslate();
  syncBack();
}

// ------------------------------------------------------------------ back button / gesture
// One extra history entry stands for "there is something to go back from": an open sheet,
// or a section other than Gündem. The phone's back gesture then stays inside SİNYAL —
// it closes the sheet, then returns to Gündem, and only then leaves.
let trapped = !!history.state?.sinyal;
let skipPop = 0;
let syncQueued = false;
function syncBack() {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => { // after the whole action, so open-then-close never costs two entries
    syncQueued = false;
    const want = anyLayerOpen() || S.section !== 'home';
    if (want && !trapped) { history.pushState({ sinyal: 1 }, ''); trapped = true; }
    else if (!want && trapped) { trapped = false; skipPop++; history.back(); }
  });
}
layers.onChange = syncBack;
window.addEventListener('popstate', () => {
  if (skipPop) { skipPop--; return; }
  trapped = false;
  if (!closeTopLayer() && S.section !== 'home') setSection('home');
  syncBack();
});

function setDomain(d) {
  S.domain = d;
  S.topic = null;
  persist('domain', 'topic');
  sel = -1;
  renderDomains();
  renderSections();
  renderMain();
  window.scrollTo(0, 0);
  autoTranslate();
}

function navItems() { return $$('#main [data-nav]'); }
function moveSel(d) {
  const list = navItems();
  if (!list.length) return;
  list[sel]?.setAttribute('aria-selected', 'false');
  sel = Math.max(0, Math.min(list.length - 1, sel + d));
  const el = list[sel];
  el.setAttribute('aria-selected', 'true');
  el.scrollIntoView({ block: 'nearest' });
  if ($('#drawer').classList.contains('open')) activate(el);
}
const selected = () => navItems()[sel] || null;
function activate(el) {
  if (!el) return;
  if (el.dataset.action === 'open' && el.dataset.id) openDrawer(el.dataset.id);
  else el.click();
}
function selectedItem() {
  if (S.drawerId) return getItem(S.drawerId);
  const el = selected();
  if (!el) return null;
  if (el.dataset.id) return getItem(el.dataset.id);
  if (el.dataset.board) return boardItem(el.dataset.board, el.dataset.key);
  return null;
}

// ------------------------------------------------------------------ actions
function toggleSave(id) {
  const it = getItem(id);
  if (!it) return;
  if (S.saved.has(id)) { S.saved.delete(id); toast(t('toast.unsaved'), titleOf(it)); }
  else { S.saved.set(id, it); toast(t('toast.saved'), titleOf(it)); }
  persist('saved');
  refreshDrawer();
  renderSavedBadge();
  if (S.section === 'saved') renderMain({ keepScroll: true });
}

function copyLink(id) {
  const it = getItem(id);
  if (it) copyText(`${titleOf(it)} — ${it.url}`).then(() => toast(t('toast.copied'), t('toast.copiedText')));
}

// The phone's own share sheet (WhatsApp, Messages, copy…), with the Turkish headline.
async function shareItem(id) {
  const it = getItem(id);
  const url = it && safeUrl(it.url);
  if (!url) return;
  try {
    await navigator.share({ title: titleOf(it), text: titleOf(it), url });
  } catch (e) {
    if (e?.name !== 'AbortError') copyLink(id);
  }
}

// A setting changed while a sheet shows it: redraw that sheet in place.
function refreshOverlays() {
  if (modalOpen()) openModal(t('settings.title'), settingsBody());
  if (sheetOpen()) openSheet(moreBody());
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
  return j;
}

async function refreshAll() {
  if (S.mode !== 'live') { poll(); return; }
  try {
    const res = await post('api/refresh');
    S.busy = res.busy;
    renderStatus();
    toast(t('toast.refresh'), t('toast.refreshText'));
  } catch (e) {
    toast(e.status === 429 ? t('toast.refreshTooSoon') : t('toast.offline'), e.status === 429 ? '' : e.message, { bad: e.status !== 429 });
  }
}

async function toggleNotify() {
  if (typeof Notification === 'undefined') return;
  if (S.prefs.notify) { S.prefs.notify = false; persist('prefs'); toast(t('toast.notifyOff')); }
  else {
    const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (p !== 'granted') { toast(t('toast.notifyDenied'), '', { bad: true }); return; }
    S.prefs.notify = true;
    persist('prefs');
    toast(t('toast.notifyOn'), t('watch.hint'));
  }
  if (modalOpen()) openSettings(); else renderMain({ keepScroll: true });
}

async function openSettings() {
  closeSheet();
  if (S.mode === 'live') { try { S.settings = await getJSON('api/settings'); } catch { /* keep last */ } }
  openModal(t('settings.title'), settingsBody());
}

function changeLang(l) {
  setLang(l);
  applyPrefs();
  renderAll({ keepScroll: true });
  refreshDrawer();
  refreshOverlays();
}

const ACTIONS = {
  open: el => el.dataset.id && openDrawer(el.dataset.id),
  'open-board': el => { const it = boardItem(el.dataset.board, el.dataset.key); if (it) openDrawer(it.id); },
  'close-drawer': () => closeDrawer(),
  home: () => setSection('home'),
  domain: el => setDomain(el.dataset.v),
  section: el => {
    // Tapping the tab you are already on scrolls back to the top, as in native apps.
    if (el.classList.contains('tab') && S.section === el.dataset.v && !sheetOpen()) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setSection(el.dataset.v);
  },
  'more-sheet': () => { if (!closeSheet()) openSheet(moreBody()); },
  share: el => shareItem(el.dataset.id),
  'install-dismiss': () => { storage.set('installHidden', true); renderMain({ keepScroll: true }); },
  topic: el => { S.topic = el.dataset.v || null; persist('topic'); renderMain({ keepScroll: true }); autoTranslate(); },
  lang: el => changeLang(el.dataset.v),
  theme: () => { S.prefs.theme = resolvedTheme() === 'dark' ? 'light' : 'dark'; persist('prefs'); applyPrefs(); },
  'set-theme': el => { S.prefs.theme = el.dataset.v; persist('prefs'); applyPrefs(); refreshOverlays(); },
  palette: () => openPalette(),
  search: el => { S.feed.q = el.dataset.v; S.topic = null; if (S.feed.range === '1d') S.feed.range = '3d'; setSection('news'); },
  range: el => { S.feed.range = el.dataset.v; persist('feed'); renderMain(); },
  sort: el => { S.feed.sort = el.dataset.v; persist('feed'); renderMain(); },
  'tools-tab': el => { S.tabs.tools = el.dataset.v; persist('tabs'); renderMain(); },
  'papers-tab': el => { S.tabs.papers = el.dataset.v; persist('tabs'); renderMain(); },
  'community-tab': el => { S.tabs.community = el.dataset.v; persist('tabs'); renderMain(); },
  more: () => { showMore(); autoTranslate(); },
  save: el => toggleSave(el.dataset.id),
  copy: el => copyLink(el.dataset.id),
  'toggle-original': el => { const id = el.dataset.id; S.showOriginal.has(id) ? S.showOriginal.delete(id) : S.showOriginal.add(id); refreshDrawer(); renderMain({ keepScroll: true }); },
  'watch-remove': el => { S.watch = S.watch.filter(w => w !== el.dataset.v); persist('watch'); compileWatch(); renderMain({ keepScroll: true }); },
  'notify-toggle': () => toggleNotify(),
  sound: () => {
    S.prefs.sound = !S.prefs.sound;
    persist('prefs');
    if (S.prefs.sound) blip('watch');
    refreshOverlays();
  },
  settings: () => openSettings(),
  keys: () => openModal(t('keys.title'), keysBody()),
  'close-modal': () => closeModal(),
  refresh: () => refreshAll(),
  'mark-read': () => {
    S.baseline = Date.now();
    storage.set('lastSeen', S.baseline);
    S.sessionNew.clear();
    renderSections();
    if (!modalOpen()) renderMain({ keepScroll: true });
    toast(t('toast.markRead'));
  },
  'clear-read': () => { S.read.clear(); persist('read'); renderMain({ keepScroll: true }); },
  'brief-generate': () => generateBrief(),
  'brief-toggle': () => toggleBrief(),
  'brief-copy': () => copyBrief(),
  'device-translate': async () => {
    const todo = [...$$('#main [data-id]')].map(el => getItem(el.dataset.id)).filter(it => it && needsTranslation(it)).slice(0, 60);
    await translateOnDevice(todo, debounce(() => renderMain({ keepScroll: true }), 300));
  },
  newpill: () => { window.scrollTo({ top: 0, behavior: 'smooth' }); S.pendingNew = 0; refreshNewsList(); $('#newpill').innerHTML = ''; },
  install: async () => {
    if (!installPrompt) { openSettings(); return; }
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    renderInstall();
    refreshOverlays();
    renderMain({ keepScroll: true });
  },
};

function runPalette(r, newTab) {
  if (newTab && safeUrl(r.url)) return window.open(safeUrl(r.url), '_blank', 'noopener');
  if (r.type === 'item') return openDrawer(r.id);
  if (r.type === 'board') { const it = boardItem(r.board, r.key); if (it) openDrawer(it.id); }
}

// ------------------------------------------------------------------ DOM wiring
document.addEventListener('click', e => {
  if (paletteOpen()) { paletteClick(e, runPalette); return; }
  if (e.target.id === 'scrim') { closeDrawer(); return; }
  if (e.target.id === 'modal') { closeModal(); return; }
  if (e.target.id === 'sheet') { closeSheet(); return; }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const link = e.target.closest('a[href]');
  if (link && link !== el && !link.dataset.action) return; // real links inside clickable rows open normally
  if (el.tagName === 'A' && (el.getAttribute('href') === '#' || el.dataset.action === 'home')) e.preventDefault();
  const fn = ACTIONS[el.dataset.action];
  if (!fn) return;
  const nav = el.closest('[data-nav]');
  if (nav) { const list = navItems(); const i = list.indexOf(nav); if (i >= 0) { list[sel]?.setAttribute('aria-selected', 'false'); sel = i; } }
  fn(el, e);
});

document.addEventListener('submit', async e => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === 'watch') {
    const term = form.term.value.trim().replace(/\s+/g, ' ');
    if (term.length < 2) return;
    if (!S.watch.some(w => w.toLocaleLowerCase('tr') === term.toLocaleLowerCase('tr'))) {
      S.watch = [...S.watch, term].slice(-30);
      persist('watch');
      compileWatch();
      toast(t('toast.watchAdded', { t: term }), t('toast.watchAddedText'));
    }
    renderMain({ keepScroll: true });
  }
  if (form.dataset.form === 'settings') {
    const body = { profile: form.profile?.value || '' };
    if (form.githubToken?.value.trim()) body.githubToken = form.githubToken.value.trim();
    if (form.anthropicKey?.value.trim()) body.anthropicKey = form.anthropicKey.value.trim();
    try {
      S.settings = await post('api/settings', body);
      closeModal();
      toast(t('toast.settingsSaved'));
      refreshBrief();
    } catch (err) {
      toast(t('toast.offline'), err.message, { bad: true });
    }
  }
});

const onQuery = debounce(v => { S.feed.q = v; refreshNewsList(); autoTranslate(); }, 220);
document.addEventListener('input', e => {
  if (e.target.dataset.input === 'q') onQuery(e.target.value);
});
document.addEventListener('change', e => {
  const k = e.target.dataset.input;
  if (k === 'video-channel') { S.tabs.videos = e.target.value; persist('tabs'); renderMain(); }
  if (k === 'kind') { S.feed.kind = e.target.value; persist('feed'); renderMain(); }
});

document.addEventListener('keydown', e => {
  if (paletteOpen()) { paletteKey(e, runPalette); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (e.key === 'Escape') { if (closeTopLayer()) return; document.activeElement?.blur?.(); return; }
  const tg = e.target;
  if (tg.closest?.('input, textarea, select, [contenteditable="true"]') || modalOpen()) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (/^[1-6]$/.test(k)) { setSection(SECTIONS[Number(k) - 1]); return; }
  switch (k) {
    case '/': e.preventDefault(); openPalette(); break;
    case '?': openModal(t('keys.title'), keysBody()); break;
    // Arrow keys keep scrolling the page; J/K travel between stories.
    case 'j': e.preventDefault(); moveSel(1); break;
    case 'k': e.preventDefault(); moveSel(-1); break;
    case 'Enter': if (tg.closest?.('button, a[href]')) break; if (selected()) { e.preventDefault(); activate(selected()); } break;
    case 'o': if (selected()) { e.preventDefault(); activate(selected()); } break;
    case 'O': { const it = selectedItem(); if (it && safeUrl(it.url)) window.open(safeUrl(it.url), '_blank', 'noopener'); break; }
    case 's': { const it = selectedItem(); if (it) toggleSave(it.id); break; }
    case 'c': { const it = selectedItem(); if (it) copyLink(it.id); break; }
    case 'l': changeLang(lang === 'tr' ? 'en' : 'tr'); break;
    case 't': ACTIONS.theme(); break;
    default: break;
  }
});

window.addEventListener('online', () => S.mode === 'live' && connect());

// ------------------------------------------------------------------ boot
async function boot() {
  applyPrefs();
  // App shortcuts (manifest) open straight into a section: ./?section=news; a tapped
  // notification opens its story: ./?open=<id>. The address is tidied up afterwards.
  const params = new URLSearchParams(location.search);
  const wanted = params.get('section');
  const openId = params.get('open');
  if ([...SECTIONS, 'saved'].includes(wanted)) S.section = wanted;
  if (location.search) history.replaceState(history.state, '', location.pathname + location.hash);
  renderChrome();
  renderInstall();
  renderMain();
  syncBack();

  // Phones: the header tucks away while reading; pull down to refresh in the installed app.
  const header = $('.top');
  autoHideHeader(header);
  new ResizeObserver(() => document.documentElement.style.setProperty('--head-h', `${header.offsetHeight}px`)).observe(header);
  pullToRefresh(pullRefresh, { blocked: anyLayerOpen, labels: { pull: () => t('ptr.pull'), release: () => t('ptr.release'), loading: () => t('ptr.loading') } });
  phone.addEventListener?.('change', () => { renderMain({ keepScroll: true }); refreshDrawer(); });

  try {
    await loadAll();
  } catch {
    S.connected = 'offline';
    toast(t('toast.offline'), t('toast.offlineText'), { bad: true, ttl: 15000 });
  }
  renderAll();
  if (openId) openDrawer(openId);
  if (S.mode === 'live') connect();
  else { lastPoll = Date.now(); setInterval(poll, 5 * 60e3); }
  probeDeviceTranslator().then(() => { if (lang === 'tr') renderMain({ keepScroll: true }); autoTranslate(); });
  // Relative times and the status line drift with the clock.
  setInterval(() => {
    const now = Date.now();
    for (const el of $$('[data-ts]')) el.textContent = ago(Number(el.dataset.ts), now);
    renderStatus();
  }, 30e3);
}

boot();
