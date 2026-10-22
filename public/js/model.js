// Client state, taxonomy metadata, scoring, filtering and display text (original or Turkish).
import { storage, termRegex, DAY, HOUR } from './util.js';
import { lang } from './i18n.js';

export const DOMAINS = ['audio', 'music', 'visual'];
export const TOPICS_BY_DOMAIN = {
  audio: ['voice', 'audiotech', 'audiogear'],
  music: ['musicai', 'production', 'instruments', 'industry'],
  visual: ['imageai', 'videoai', 'design', '3d'],
};
export const TOPIC_DOMAIN = Object.fromEntries(Object.entries(TOPICS_BY_DOMAIN).flatMap(([d, ts]) => ts.map(tp => [tp, d])));
export const SECTIONS = ['home', 'news', 'videos', 'tools', 'papers', 'community'];
export const RANGES = { '1d': DAY, '3d': 3 * DAY, '7d': 7 * DAY };
// "all" means every story; repositories and models live in their own section unless asked for.
export const KIND_FILTERS = {
  all: ['news', 'post', 'video', 'paper', 'release'], news: ['news'], post: ['post'], video: ['video'], code: ['repo', 'trend', 'release'], model: ['model'], paper: ['paper'],
};

const DEFAULT_WATCH = ['Suno', 'ElevenLabs', 'Udio', 'Sora', 'Midjourney'];

export const S = {
  items: new Map(),
  list: [],
  boards: {},
  about: {},
  analysis: { trends: {}, entities: [], clusters: [] },
  sources: [],
  events: [],
  meta: {},
  brief: null,
  settings: null,
  mode: 'live',
  connected: 'connecting',
  busy: { active: 0, queued: 0, total: 0 },
  clusterOf: new Map(),
  clusterById: new Map(),
  transient: new Map(),
  localTr: new Map(),
  sessionNew: new Set(),
  pendingNew: 0,
  showOriginal: new Set(),

  domain: storage.get('domain', 'all'),
  topic: storage.get('topic', null),
  section: storage.get('section', 'home'),
  feed: { range: '3d', sort: 'time', kind: 'all', q: '', ...storage.get('feed', {}) },
  tabs: { tools: 'repos', papers: 'all', community: 'all', videos: 'all', ...storage.get('tabs', {}) },
  saved: new Map(storage.get('saved', []).map(i => [i.id, i])),
  read: new Set(storage.get('read', [])),
  watch: storage.get('watch', DEFAULT_WATCH),
  prefs: { theme: 'dark', sound: false, notify: false, ...storage.get('prefs', {}) },
  baseline: storage.get('lastSeen', Date.now() - 6 * HOUR),
};
S.feed.q = '';
if (!['all', ...DOMAINS].includes(S.domain)) S.domain = 'all';
if (![...SECTIONS, 'saved'].includes(S.section)) S.section = 'home';

export function persist(...keys) {
  for (const k of keys) {
    if (k === 'feed') storage.set('feed', { range: S.feed.range, sort: S.feed.sort, kind: S.feed.kind });
    else if (k === 'saved') storage.set('saved', [...S.saved.values()].slice(-500));
    else if (k === 'read') storage.set('read', [...S.read].slice(-5000));
    else storage.set(k, S[k]);
  }
}

// ------------------------------------------------------------------ data
export function setItems(list) {
  S.items = new Map(list.map(i => [i.id, i]));
  reindex();
}

export function addItems(list) {
  const fresh = [];
  for (const it of list) {
    if (!S.items.has(it.id)) fresh.push(it);
    S.items.set(it.id, it);
  }
  reindex();
  return fresh;
}

export function applyTranslations(map) {
  for (const [id, tr] of Object.entries(map)) {
    const it = S.items.get(id);
    if (it) it.tr = tr;
  }
}

export function reindex() {
  S.list = [...S.items.values()].sort((a, b) => b.published - a.published);
}

export function setAnalysis(a) {
  S.analysis = a || { trends: {}, entities: [], clusters: [] };
  if (Array.isArray(S.analysis.trends)) S.analysis.trends = { all: S.analysis.trends };
  S.clusterOf = new Map();
  S.clusterById = new Map();
  for (const c of S.analysis.clusters || []) {
    S.clusterById.set(c.id, c);
    for (const id of c.ids) S.clusterOf.set(id, c);
  }
}

export function getItem(id) {
  return S.items.get(id) || S.transient.get(id) || S.saved.get(id) || null;
}

// ------------------------------------------------------------------ display text
const isTurkishSource = it => (it.flags || []).includes('tr');

export function titleOf(it) {
  if (lang !== 'tr' || isTurkishSource(it) || S.showOriginal.has(it.id)) return it.title;
  return it.tr?.t || S.localTr.get(it.id)?.t || it.title;
}

export function summaryOf(it) {
  const own = lang !== 'tr' || isTurkishSource(it) || S.showOriginal.has(it.id)
    ? it.summary || ''
    : it.tr?.s || S.localTr.get(it.id)?.s || it.summary || '';
  // Repositories and models often come without a summary: use what their own page says.
  return own || aboutText(aboutKeyOf(it), S.showOriginal.has(it.id));
}

export const isTranslated = it => lang === 'tr' && !isTurkishSource(it)
  && !!(it.tr?.t || it.tr?.s || S.localTr.has(it.id) || (!it.summary && aboutOf(aboutKeyOf(it))?.tr));

// ------------------------------------------------------------------ "what is this" (repos, models, demos)
// Keys match lib/about.js: gh:owner/repo, hf:org/model, hfs:org/space.
export function aboutKeyOf(it) {
  if (!it) return '';
  if (it.kind === 'repo' || it.kind === 'trend') return `gh:${it.title}`;
  if (it.kind === 'model') return `hf:${it.title}`;
  if (it.kind === 'release' && it.extra?.repo) return `gh:${it.extra.repo}`;
  return '';
}
export const aboutOf = key => (key && S.about?.[key]) || null;
export function aboutText(key, original = false) {
  const a = aboutOf(key);
  if (!a) return '';
  return lang === 'tr' && !original ? a.tr || a.en || '' : a.en || '';
}
export const needsTranslation = it => lang === 'tr' && !isTurkishSource(it) && !it.tr && !S.localTr.has(it.id) && !!(it.title || it.summary);

// ------------------------------------------------------------------ watchlist
let watchRes = [];
const watchCache = new Map();
export function compileWatch() {
  watchRes = S.watch.map(w => [w, termRegex(w)]);
  watchCache.clear();
}
compileWatch();

export function watchHits(it) {
  let hit = watchCache.get(it.id);
  if (hit) return hit;
  const text = `${it.title} ${it.summary || ''} ${it.tr?.t || ''}`;
  hit = watchRes.filter(([, re]) => re.test(text)).map(([w]) => w);
  watchCache.set(it.id, hit);
  return hit;
}

// ------------------------------------------------------------------ scoring
// 0–100: freshness × engagement × cross-source coverage × source weight.
export function score(it, now = Date.now()) {
  const c = S.clusterOf.get(it.id);
  const heat = Math.min(1, (it.eng ?? 0.4) + (c ? Math.min(0.45, 0.18 * (c.sources - 1)) : 0));
  const rec = Math.exp(-Math.max(0, (now - it.published) / HOUR) / 20);
  const w = 0.75 + 0.25 * (it.weight ?? 1);
  const general = it.topic ? 1 : 0.85;
  return Math.round(Math.min(1, (0.45 * rec + 0.55 * heat) * w * general + (watchHits(it).length ? 0.12 : 0)) * 100);
}

// ------------------------------------------------------------------ filtering
export const isNew = it => (S.sessionNew.has(it.id) || it.firstSeen > S.baseline) && it.published > S.baseline - 3 * HOUR;

export function inDomain(it, domain = S.domain) {
  return domain === 'all' || (it.domains || []).includes(domain);
}

export function inTopic(it, topic = S.topic) {
  if (!topic) return true;
  if (topic === 'deal') return (it.flags || []).includes('deal');
  return (it.topics || []).includes(topic);
}

export const visible = it => inDomain(it) && inTopic(it);

export function queryTerms(q) {
  return (q || '').toLocaleLowerCase('tr').split(/\s+/).filter(x => x.length > 1);
}

export function textMatch(it, terms) {
  if (!terms.length) return true;
  const hay = `${it.title} ${it.summary || ''} ${it.tr?.t || ''} ${it.tr?.s || ''} ${it.sourceName || ''} ${(it.extra?.topics || []).join(' ')}`.toLocaleLowerCase('tr');
  return terms.every(x => hay.includes(x));
}

export function feedItems({ range, kind, q, sort } = S.feed, now = Date.now()) {
  const ms = RANGES[range] || RANGES['3d'];
  const kinds = KIND_FILTERS[kind] || null;
  const terms = queryTerms(q);
  let out = S.list.filter(it => now - it.published <= ms && (!kinds || kinds.includes(it.kind)) && visible(it) && textMatch(it, terms));
  if (sort === 'score') out = out.map(it => [score(it, now), it]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  return out;
}

export function domainCounts(windowMs = DAY, now = Date.now()) {
  const c = { all: 0, audio: 0, music: 0, visual: 0 };
  for (const it of S.list) {
    if (now - it.published > windowMs) break;
    if (it.kind === 'trend') continue;
    c.all++;
    for (const d of it.domains || []) c[d]++;
  }
  return c;
}

export function topicCounts(domain, windowMs = 3 * DAY, now = Date.now()) {
  const c = {};
  for (const it of S.list) {
    if (now - it.published > windowMs) break;
    if (!inDomain(it, domain)) continue;
    for (const tp of it.topics || []) c[tp] = (c[tp] || 0) + 1;
    if ((it.flags || []).includes('deal')) c.deal = (c.deal || 0) + 1;
  }
  return c;
}

// Board rows (repos, models, releases, demos) filtered by the current field.
export const boardVisible = row => S.domain === 'all' || (row.domains || (row.domain ? [row.domain] : [])).includes(S.domain);
