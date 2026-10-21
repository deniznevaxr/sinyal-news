// Page renderers for each section. Rows carry data-nav for keyboard travel.
import { $, esc, safeUrl, storage, DAY, HOUR } from './util.js';
import { t } from './i18n.js';
import { ago, agoLong, compact, dayMonth } from './fmt.js';
import {
  S, DOMAINS, TOPICS_BY_DOMAIN, RANGES, feedItems, score, visible, inDomain, boardVisible, queryTerms,
  topicCounts, titleOf, summaryOf, watchHits, needsTranslation,
} from './model.js';
import { item, mini, video, empty, icon, kicker, tags, domainOf, installCard } from './ui.js';
import { briefBlock } from './brief.js';
import { deviceTranslatorState } from './translate.js';
import { phone } from './mobile.js';

const PAGE = 60;
let limit = PAGE;

export function renderMain({ keepScroll = false } = {}) {
  const y = window.scrollY;
  if (!keepScroll) limit = PAGE;
  $('#main').innerHTML = (PAGES[S.section] || PAGES.home)();
  if (keepScroll) window.scrollTo(0, y);
}

export function showMore() {
  limit += PAGE;
  renderMain({ keepScroll: true });
}

const head = (title, note, tools = '') => `
  <div class="page-head"><div><h1 class="page-title">${esc(title)}</h1>${note ? `<p class="page-note">${esc(note)}</p>` : ''}</div>${tools ? `<div class="page-tools">${tools}</div>` : ''}</div>`;

const seg = (action, options, current) => `<div class="seg" role="group">${options.map(([v, label]) => `<button type="button" data-action="${action}" data-v="${esc(v)}" aria-pressed="${v === current}">${esc(label)}</button>`).join('')}</div>`;

const blockHead = (title, { note = '', more = '' } = {}) => `<div class="block-head"><h2 class="block-title">${esc(title)}</h2>${note ? `<span class="block-note">${esc(note)}</span>` : ''}${more}</div>`;

const moreLink = (section, extra = '') => `<button class="block-more" type="button" data-action="section" data-v="${section}"${extra}>${esc(t('home.seeAll'))} →</button>`;

function chips() {
  const counts = topicCounts(S.domain);
  const topics = S.domain === 'all' ? [] : TOPICS_BY_DOMAIN[S.domain];
  const list = [[null, t('topic.all')], ...topics.map(tp => [tp, t(`topic.${tp}`)]), ['deal', t('topic.deal')]];
  return `<div class="chips" role="group">${list.map(([v, label]) => `
    <button class="chip-btn${v === 'deal' ? ' deal' : ''}" type="button" data-action="topic" data-v="${v || ''}" aria-pressed="${(S.topic || null) === v}">${esc(label)}${v && counts[v] ? `<span class="n">${counts[v]}</span>` : ''}</button>`).join('')}</div>`;
}

function translationNotice(list) {
  if (deviceTranslatorState() === 'unavailable') return '';
  const n = list.filter(needsTranslation).length;
  if (n < 3) return '';
  return `<div class="notice">${icon('translate')}<span>${esc(t('tr.pending', { n }))}</span><button class="btn sm" type="button" data-action="device-translate">${esc(deviceTranslatorState() === 'working' ? t('tr.deviceWorking') : t('tr.device'))}</button></div>`;
}

const listOrEmpty = (rows, fallback) => (rows.length ? rows.join('') : fallback);
const loading = () => empty(t('empty.loading'), t('empty.loadingSub'), true);
const nothing = () => (S.list.length ? empty(t('empty.none'), t('empty.noneSub')) : loading());

// ------------------------------------------------------------------ GÜNDEM / OVERVIEW
function home() {
  const now = Date.now();
  const day = S.list.filter(i => now - i.published < DAY && i.kind !== 'trend' && visible(i));
  const top = day.map(i => [score(i, now), i]).sort((a, b) => b[0] - a[0]);
  const used = new Set();

  // Top stories: multi-source clusters first, then the strongest single items.
  const stories = [];
  for (const c of S.analysis.clusters || []) {
    if (stories.length >= 4) break;
    const lead = S.items.get(c.lead);
    if (!lead || !visible(lead)) continue;
    stories.push({ it: lead, c });
    c.ids.forEach(id => used.add(id));
  }
  for (const [, it] of top) {
    if (stories.length >= 4) break;
    if (used.has(it.id) || it.kind === 'repo' || it.kind === 'model') continue;
    stories.push({ it, c: null });
    used.add(it.id);
  }
  const storyCard = ({ it, c }, lead) => {
    const img = safeUrl(it.image || c?.image);
    const outlets = c ? c.sourceNames.slice(0, 3).join(', ') + (c.sourceNames.length > 3 ? '…' : '') : it.sourceName;
    return `<article class="story${lead ? ' lead' : ''}" data-action="open" data-id="${esc(it.id)}" data-nav>
      ${lead && img ? `<div class="story-img"><img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></div>` : ''}
      <div class="story-body">${kicker(it, { withNew: false })}
        <h3 class="story-title">${esc(titleOf(it))}</h3>
        ${lead && summaryOf(it) ? `<p class="story-sum">${esc(summaryOf(it))}</p>` : ''}
        <div class="story-sources">${c ? `<span class="tag cov">${esc(t('meta.sources', { n: c.sources }))}</span>` : ''}<span>${esc(outlets)}</span><span data-ts="${it.published}">${esc(ago(it.published, now))}</span></div>
      </div></article>`;
  };

  const latest = S.list.filter(i => i.kind !== 'trend' && visible(i) && !used.has(i.id)).slice(0, 8);
  latest.forEach(i => used.add(i.id));
  const popular = top.map(x => x[1]).filter(i => !used.has(i.id)).slice(0, 8);
  const vids = S.list.filter(i => i.kind === 'video' && visible(i) && !(i.extra?.short)).slice(0, 4);

  const main = `
    ${phone.matches && !storage.get('installHidden', false) ? installCard({ dismissable: true }) : ''}
    ${briefBlock()}
    ${translationNotice([...stories.map(s => s.it), ...latest, ...popular])}
    ${chips()}
    <section class="block">${blockHead(t('home.top'), { note: t('home.topNote') })}
      ${stories.length ? `<div class="stories">${stories.map((s, i) => storyCard(s, i === 0)).join('')}</div>` : nothing()}</section>
    <section class="block">${blockHead(t('home.latest'), { more: moreLink('news') })}
      <ul class="mini">${listOrEmpty(latest.map(i => mini(i, now)), '')}</ul></section>
    <section class="block">${blockHead(t('home.popular'))}
      <div class="list">${listOrEmpty(popular.map(i => item(i, { now })), '')}</div></section>
    ${vids.length ? `<section class="block">${blockHead(t('home.videos'), { more: moreLink('videos') })}<div class="videos">${vids.map(v => video(v, now)).join('')}</div></section>` : ''}`;

  return `<div class="home"><div>${main}</div><aside class="aside">${aside(now)}</aside></div>`;
}

function aside(now) {
  const trends = (S.analysis.trends?.[S.domain] || S.analysis.trends?.all || []).slice(0, 8);
  const trendRows = trends.map((x, i) => `<button class="trend-row" type="button" data-action="search" data-v="${esc(x.label)}">
      <span class="trend-rank">${i + 1}</span><span class="trend-name">${esc(x.label)}</span><span class="trend-count">${x.today}</span><span class="trend-up">↑${x.ratio}×</span></button>`).join('');

  const repos = (S.boards.ghRising7 || []).filter(boardVisible).slice(0, 3).map(r => ({ kind: 'repo', name: r.full_name, sub: r.description, val: `${compact(r.stars)} ★`, board: 'repo', key: r.full_name, d: r.domains?.[0] }));
  const models = Object.values(S.boards.hfModels || {}).flat().filter(m => boardVisible(m) && m.createdAt && now - m.createdAt < 21 * DAY)
    .sort((a, b) => b.trending - a.trending).slice(0, 3).map(m => ({ kind: 'model', name: m.id, sub: m.topic ? t(`topic.${m.topic}`) : m.task || '', val: `${t('tools.trendScore')} ${m.trending}`, board: 'model', key: m.id, d: m.domain }));
  const tools = [...models, ...repos].map(x => `<button class="tool-row" type="button" data-action="open-board" data-board="${x.board}" data-key="${esc(x.key)}">
      <span style="min-width:0"><span class="tool-name">${esc(x.name)}</span><span class="tool-sub">${x.d ? `<span class="dot d-${x.d}"></span>` : ''}${esc(x.sub || '')}</span></span><span class="tool-val">${esc(x.val)}</span></button>`).join('');

  const counts = Object.fromEntries(S.watch.map(w => [w, 0]));
  for (const it of S.list) {
    if (now - it.published > DAY) break;
    for (const w of watchHits(it)) if (w in counts) counts[w]++;
  }
  const watch = S.watch.map(w => `<span class="wchip${counts[w] ? ' hit' : ''}"><span class="name" data-action="search" data-v="${esc(w)}">${esc(w)}</span>${counts[w] ? `<span class="n">${counts[w]}</span>` : ''}<button class="x" type="button" data-action="watch-remove" data-v="${esc(w)}" aria-label="${esc(t('act.remove'))}">${icon('close')}</button></span>`).join('');

  return `
    ${trendRows ? `<section class="side-block">${blockHead(t('home.trends'))}${trendRows}</section>` : ''}
    ${tools ? `<section class="side-block">${blockHead(t('home.tools'), { more: moreLink('tools') })}${tools}</section>` : ''}
    <section class="side-block">${blockHead(t('home.watch'))}
      <form class="watch-form" data-form="watch"><input class="field" name="term" placeholder="${esc(t('watch.placeholder'))}" maxlength="40" autocomplete="off"><button class="btn sm" type="submit">${icon('plus')}${esc(t('act.add'))}</button></form>
      <div class="watch-list">${watch || `<span class="brief-note">${esc(t('watch.empty'))}</span>`}</div>
      <p class="watch-hint">${esc(t('watch.hint'))} <button type="button" class="block-more" style="margin:0" data-action="notify-toggle">${esc(S.prefs.notify ? t('watch.notifyOn') : t('watch.notifyOff'))}</button></p></section>
    ${eventsBlock()}`;
}

function eventsBlock() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t0 = today.getTime();
  const list = (S.events || [])
    .filter(e => S.domain === 'all' || !e.domains || e.domains.includes(S.domain))
    .map(e => ({ ...e, s: new Date(`${e.start}T00:00:00`).getTime(), e2: new Date(`${e.end || e.start}T23:59:59`).getTime() }))
    .filter(e => e.e2 >= t0).sort((a, b) => a.s - b.s).slice(0, 5);
  if (!list.length) return '';
  const rows = list.map(e => {
    const now = e.s <= Date.now() && e.e2 >= Date.now();
    const days = Math.round((e.s - t0) / DAY);
    return `<a class="event-row${now ? ' now' : ''}" href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener noreferrer" title="${esc(e.note || e.name)}">
      <span class="event-when">${now ? `<b>●</b><span>${esc(t('time.ongoing'))}</span>` : `<b>${days}</b><span>${esc(t('time.days'))}</span>`}</span>
      <span style="min-width:0"><span class="event-name">${esc(e.name)}</span><span class="event-sub">${esc(dayMonth(e.s))} · ${esc(e.city)}</span></span></a>`;
  }).join('');
  return `<section class="side-block">${blockHead(t('home.events'))}${rows}</section>`;
}

// ------------------------------------------------------------------ HABERLER / NEWS
function news() {
  const f = S.feed;
  const list = feedItems();
  const now = Date.now();
  const terms = queryTerms(f.q);
  const tools = `
    <input class="field" id="feed-q" data-input="q" type="search" placeholder="${esc(t('search.inList'))}" value="${esc(f.q)}" style="width:220px">
    <select class="field" data-input="kind" aria-label="${esc(t('kind.all'))}">${['all', 'news', 'post', 'video', 'code', 'model', 'paper'].map(k => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${esc(t(`kind.${k === 'code' ? 'code' : k}`))}</option>`).join('')}</select>
    ${seg('range', Object.keys(RANGES).map(r => [r, t(`range.${r}`)]), f.range)}
    ${seg('sort', [['time', t('sort.time')], ['score', t('sort.score')]], f.sort)}`;
  return `${head(t('section.news'), `${list.length} · ${t(`domain.${S.domain}`)}`, tools)}
    ${translationNotice(list.slice(0, limit))}
    ${chips()}
    <div class="newpill" id="newpill"></div>
    <div class="list" id="feed">${list.length ? list.slice(0, limit).map(i => item(i, { now, terms })).join('') : nothing()}</div>
    ${list.length > limit ? `<div class="list-more"><button class="btn" type="button" data-action="more">${esc(t('act.more'))}</button></div>` : ''}`;
}

export function refreshNewsList() {
  const feed = $('#feed');
  if (!feed) return;
  limit = PAGE;
  const list = feedItems();
  const now = Date.now();
  const terms = queryTerms(S.feed.q);
  feed.innerHTML = list.length ? list.slice(0, limit).map(i => item(i, { now, terms })).join('') : nothing();
  const note = $('.page-note');
  if (note) note.textContent = `${list.length} · ${t(`domain.${S.domain}`)}`;
}

// ------------------------------------------------------------------ VİDEOLAR
function videos() {
  const now = Date.now();
  const all = S.list.filter(i => i.kind === 'video' && visible(i));
  const channels = [...new Set(all.map(v => v.sourceName))].sort((a, b) => a.localeCompare(b, 'tr'));
  const ch = channels.includes(S.tabs.videos) ? S.tabs.videos : 'all';
  const list = (ch === 'all' ? all : all.filter(v => v.sourceName === ch)).slice(0, limit);
  const select = `<select class="field" data-input="video-channel"><option value="all">${esc(t('videos.allChannels'))} (${all.length})</option>${channels.map(c => `<option value="${esc(c)}" ${c === ch ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`;
  return `${head(t('section.videos'), '', select)}${translationNotice(list)}${chips()}
    ${list.length ? `<div class="videos">${list.map(v => video(v, now)).join('')}</div>` : nothing()}
    ${all.length > limit ? `<div class="list-more"><button class="btn" type="button" data-action="more">${esc(t('act.more'))}</button></div>` : ''}`;
}

// ------------------------------------------------------------------ ARAÇLAR & MODELLER / TOOLS
const TOOL_TABS = ['repos', 'trending', 'models', 'releases', 'demos'];

function tools() {
  const tab = TOOL_TABS.includes(S.tabs.tools) ? S.tabs.tools : 'repos';
  const now = Date.now();
  let body = '';
  if (tab === 'repos' || tab === 'trending') {
    const rows = (tab === 'repos' ? S.boards.ghRising7 : S.boards.ghTrending) || [];
    const list = rows.filter(boardVisible).slice(0, limit);
    body = list.map(r => {
      const owner = r.full_name.split('/')[0];
      const av = safeUrl(r.avatar) || `https://github.com/${owner}.png?size=80`;
      const d = r.domains?.[0];
      return `<div class="tool-item" data-action="open-board" data-board="${tab === 'repos' ? 'repo' : 'trend'}" data-key="${esc(r.full_name)}" data-nav>
        <span class="avatar"><img src="${esc(av)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></span>
        <div style="min-width:0"><div class="tool-item-name"><span class="owner">${esc(owner)}/</span>${esc(r.full_name.split('/')[1])}</div>
          <div class="tool-item-desc">${esc(r.description || '')}</div>
          <div class="tool-item-meta">${d ? `<span class="kicker"><span class="dot d-${d}"></span>${esc(r.topic ? t(`topic.${r.topic}`) : t(`domain.${d}`))}</span>` : ''}${r.lang ? `<span>${esc(r.lang)}</span>` : ''}${r.created ? `<span>${esc(agoLong(r.created, now))}</span>` : ''}</div></div>
        <div class="tool-stats"><b>${compact(r.stars)} ★</b>${tab === 'repos' ? `<span class="up">+${compact(r.velocity)}${esc(t('tools.perDay'))}</span>` : `<span class="up">+${compact(r.starsPeriod)} ${esc(r.since === 'daily' ? t('tools.today') : t('tools.week'))}</span>`}</div>
      </div>`;
    }).join('');
  } else if (tab === 'models') {
    const list = Object.values(S.boards.hfModels || {}).flat().filter(boardVisible)
      .sort((a, b) => b.trending - a.trending).filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i).slice(0, limit);
    body = list.map(m => {
      const fresh = m.createdAt && now - m.createdAt < 14 * DAY;
      return `<div class="tool-item" data-action="open-board" data-board="model" data-key="${esc(m.id)}" data-nav>
        <span class="avatar">${esc(m.id[0].toUpperCase())}</span>
        <div style="min-width:0"><div class="tool-item-name"><span class="owner">${esc(m.id.split('/')[0])}/</span>${esc(m.id.split('/').slice(1).join('/'))}</div>
          <div class="tool-item-meta">${m.topic ? `<span class="kicker"><span class="dot d-${m.domain}"></span>${esc(t(`topic.${m.topic}`))}</span>` : `<span>${esc(m.task || '')}</span>`}${m.library ? `<span>${esc(m.library)}</span>` : ''}${m.license ? `<span>${esc(m.license)}</span>` : ''}${fresh ? `<span class="tag cov">${esc(t('tools.new'))}</span>` : ''}${m.createdAt ? `<span>${esc(agoLong(m.createdAt, now))}</span>` : ''}</div></div>
        <div class="tool-stats"><b>♥ ${compact(m.likes)}</b><span>${compact(m.downloads)} ${esc(t('tools.downloads'))}</span><span class="up">${esc(t('tools.trendScore'))} ${m.trending}</span></div>
      </div>`;
    }).join('');
  } else if (tab === 'releases') {
    const list = (S.boards.releases || []).filter(boardVisible).slice(0, limit);
    body = list.map(r => `
      <a class="tool-item" href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener noreferrer" data-nav>
        <span class="avatar">${esc(r.repo.split('/')[1][0].toUpperCase())}</span>
        <div style="min-width:0"><div class="tool-item-name"><span class="owner">${esc(r.repo.split('/')[0])}/</span>${esc(r.repo.split('/')[1])}</div>
          <div class="tool-item-desc">${esc(r.notes || '')}</div>
          <div class="tool-item-meta">${r.domains?.[0] ? `<span class="kicker"><span class="dot d-${r.domains[0]}"></span>${esc(r.topic ? t(`topic.${r.topic}`) : t(`domain.${r.domains[0]}`))}</span>` : ''}</div></div>
        <div class="tool-stats"><b>${esc(r.version)}</b><span>${esc(agoLong(r.date, now))}</span></div>
      </a>`).join('');
  } else {
    const list = (S.boards.hfSpaces || []).filter(boardVisible).slice(0, limit);
    body = `<div class="demos">${list.map(s => `
      <a class="demo" href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer" data-nav>
        <span class="demo-name">${esc(s.id.split('/')[1] || s.id)}</span>
        <span class="demo-sub">${s.domains?.[0] ? `<span class="dot d-${s.domains[0]}"></span>` : ''}<span>${esc(s.id.split('/')[0])}</span><span>♥ ${compact(s.likes)}</span></span>
      </a>`).join('')}</div>`;
  }
  const tabs = seg('tools-tab', TOOL_TABS.map(x => [x, t(`tools.${x}`)]), tab);
  return `${head(t('section.tools'), t(`tools.note.${tab}`), tabs)}
    ${body.replace(/<div class="demos"><\/div>/, '') || nothing()}`;
}

// ------------------------------------------------------------------ MAKALELER / PAPERS
function papers() {
  const mode = S.tabs.papers || 'all';
  let list = S.list.filter(i => i.kind === 'paper' && visible(i));
  if (mode === 'code') list = list.filter(p => p.extra?.code);
  if (mode === 'demo') list = list.filter(p => p.extra?.demo);
  const now = Date.now();
  const rows = list.slice(0, limit).map(p => {
    const x = p.extra || {};
    const links = [[x.code, t('act.code'), true], [x.demo, t('act.demo'), true], [x.pdf, t('act.pdf')], [x.arxiv, 'arXiv']]
      .filter(([u]) => safeUrl(u)).map(([u, l, hl]) => `<a class="linkchip${hl ? ' hl' : ''}" href="${esc(safeUrl(u))}" target="_blank" rel="noopener noreferrer">${esc(l)}</a>`).join('');
    return `<article class="item nothumb${S.read.has(p.id) ? ' read' : ''}" data-action="open" data-id="${esc(p.id)}" data-nav>
      <div>${kicker(p)}
        <h3 class="item-title">${esc(titleOf(p))}</h3>
        <p class="item-sum">${esc(summaryOf(p))}</p>
        <div class="item-meta"><span class="src">${esc(p.sourceName)}</span><span>${esc(p.author || '')}</span><span data-ts="${p.published}">${esc(ago(p.published, now))}</span>${p.metrics?.upvotes ? `<span>${esc(t('meta.votes', { n: p.metrics.upvotes }))}</span>` : ''}</div>
        ${links ? `<div class="paper-links">${links}</div>` : ''}</div></article>`;
  });
  const tools = seg('papers-tab', [['all', t('papers.all')], ['code', t('papers.code')], ['demo', t('papers.demo')]], mode);
  return `${head(t('section.papers'), `${list.length}`, tools)}${translationNotice(list.slice(0, limit))}${chips()}
    <div class="list">${rows.length ? rows.join('') : nothing()}</div>
    ${list.length > limit ? `<div class="list-more"><button class="btn" type="button" data-action="more">${esc(t('act.more'))}</button></div>` : ''}`;
}

// ------------------------------------------------------------------ TOPLULUK / COMMUNITY
function community() {
  const mode = S.tabs.community || 'all';
  const now = Date.now();
  let list = S.list.filter(i => i.kind === 'post' && now - i.published < 4 * DAY && visible(i));
  if (mode === 'hn') list = list.filter(i => i.source === 'hn');
  if (mode === 'reddit') list = list.filter(i => i.source === 'reddit');
  list = list.map(i => [score(i, now), i]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  const tools = seg('community-tab', [['all', t('community.all')], ['hn', t('community.hn')], ['reddit', t('community.reddit')]], mode);
  return `${head(t('section.community'), `${list.length}`, tools)}${translationNotice(list.slice(0, limit))}${chips()}
    <div class="list">${list.length ? list.slice(0, limit).map(i => item(i, { now })).join('') : nothing()}</div>
    ${list.length > limit ? `<div class="list-more"><button class="btn" type="button" data-action="more">${esc(t('act.more'))}</button></div>` : ''}`;
}

// ------------------------------------------------------------------ KAYDEDİLENLER / SAVED
function saved() {
  const now = Date.now();
  const list = [...S.saved.values()].reverse();
  return `${head(t('section.saved'), `${list.length}`)}
    <div class="list">${list.length ? list.map(i => item(i, { now })).join('') : empty(t('empty.saved'), t('empty.savedSub'))}</div>`;
}

const PAGES = { home, news, videos, tools, papers, community, saved };

// ------------------------------------------------------------------ board rows → pseudo items
export function boardItem(board, key) {
  const id = `b:${board}:${key}`;
  if (S.transient.has(id)) return S.transient.get(id);
  let it = null;
  if (board === 'repo' || board === 'trend') {
    const r = [...(S.boards.ghRising7 || []), ...(S.boards.ghRising30 || []), ...(S.boards.ghTrending || [])].find(x => x.full_name === key);
    if (!r) return null;
    const existing = S.list.find(i => (i.kind === 'repo' || i.kind === 'trend') && i.title === key);
    if (existing) return existing;
    it = {
      id, kind: board, source: board === 'trend' ? 'ghtrending' : 'ghsearch', sourceName: 'GitHub', short: 'GH',
      title: r.full_name, url: r.url, summary: r.description, author: r.full_name.split('/')[0], image: r.avatar || '',
      published: r.created || Date.now(), firstSeen: Date.now(), topic: r.topic || null, topics: r.topic ? [r.topic] : [], domains: r.domains || [], flags: ['oss'], entities: [],
      metrics: { stars: r.stars, forks: r.forks, velocity: r.velocity, starsPeriod: r.starsPeriod }, extra: { lang: r.lang, topics: r.topics, license: r.license }, eng: 0.5, weight: 0.9,
    };
  } else if (board === 'model') {
    const m = Object.values(S.boards.hfModels || {}).flat().find(x => x.id === key);
    if (!m) return null;
    const existing = S.list.find(i => i.kind === 'model' && i.title === key);
    if (existing) return existing;
    it = {
      id, kind: 'model', source: 'hfmodels', sourceName: 'Hugging Face', short: 'HF', title: m.id, url: m.url, summary: '',
      author: m.id.split('/')[0], published: m.createdAt || Date.now(), firstSeen: Date.now(), topic: m.topic, topics: [m.topic], domains: [m.domain], flags: [], entities: [],
      metrics: { likes: m.likes, downloads: m.downloads, trending: m.trending }, extra: { task: m.task, library: m.library, license: m.license }, eng: 0.5, weight: 0.95,
    };
  }
  if (it) S.transient.set(id, it);
  return it;
}

export { domainOf, tags, HOUR };
