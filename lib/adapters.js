// Source adapters. Each takes a job (+ shared context) and resolves to
// { items: RawItem[], boards?: { [name]: any[] }, note?: string }.
import { request, getJSON, sleep, HttpError } from './http.js';
import { parseFeed, htmlToText, clip, xmlInner, xmlAttr, xmlAll, decodeEntities } from './xml.js';
import { isRelevant, isSpamRepo, isNsfw, classify } from './classify.js';

const DAY = 86400e3;
const log10 = x => Math.log10(Math.max(0, x) + 1);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

function mk(job, f) {
  return {
    kind: f.kind || 'news',
    source: job.id,
    sourceName: f.sourceName || job.name,
    short: f.short || job.short,
    group: job.group,
    title: clip(f.title || '(başlıksız)', 240),
    url: f.url,
    summary: clip(f.summary || '', 440),
    author: f.author || '',
    image: f.image || '',
    published: f.published || null,
    metrics: f.metrics || {},
    extra: f.extra || {},
    eng: clamp(f.eng ?? 0.4),
    weight: job.weight ?? 1,
    // Classification hints from the source: fallback topics, flags and domain.
    sourceTags: f.sourceTags || [...(job.topics || []), ...(job.tags || [])],
    sourceFlags: f.sourceFlags || job.flags || [],
    sourceDomain: f.sourceDomain !== undefined ? f.sourceDomain : job.domain || null,
    key: f.key || f.url,
  };
}

// Board rows (repos, models) carry their own domain/topic so the UI can filter them.
const routeOf = (text, hint = {}) => {
  const c = classify(text, { sourceTags: hint.topics || [], sourceDomain: hint.domain || null });
  return { domains: c.domains, topic: c.topic };
};

// ---------------------------------------------------------------- RSS news
export async function rss(job) {
  const res = await request(job.url, { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.5' });
  const entries = parseFeed(res.text).slice(0, job.max || 40);
  const items = [];
  for (const e of entries) {
    if (!e.title || !e.link) continue;
    if (job.filter && !isRelevant(e.title, `${e.summary} ${e.categories.join(' ')}`)) continue;
    items.push(mk(job, {
      title: e.title, url: e.link, summary: e.summary, author: e.author, image: e.image, published: e.date,
      extra: e.categories.length ? { categories: e.categories.slice(0, 6) } : {},
      eng: 0.4,
    }));
  }
  return { items, note: `${entries.length} girdi, ${items.length} alındı` };
}

// ---------------------------------------------------------------- Hacker News
export async function hackerNews(job) {
  const since = Math.floor((Date.now() - job.windowDays * DAY) / 1000);
  const hits = new Map();
  for (const q of job.queries) {
    const url = `https://hn.algolia.com/api/v1/search_by_date?tags=story&query=${encodeURIComponent(q)}&typoTolerance=false&hitsPerPage=60&numericFilters=${encodeURIComponent(`created_at_i>${since},points>=${job.minPoints}`)}`;
    try {
      const { json } = await getJSON(url, { retries: 1 });
      for (const h of json.hits || []) if (!hits.has(h.objectID)) hits.set(h.objectID, h);
    } catch { /* one failing query should not sink the rest */ }
  }
  const items = [];
  for (const h of hits.values()) {
    if (!h.title || !isRelevant(h.title)) continue;
    const discussion = `https://news.ycombinator.com/item?id=${h.objectID}`;
    items.push(mk(job, {
      kind: 'post',
      key: `hn:${h.objectID}`,
      title: h.title,
      url: h.url || discussion,
      summary: h.story_text ? htmlToText(h.story_text) : '',
      author: h.author,
      published: h.created_at_i * 1000,
      metrics: { points: h.points || 0, comments: h.num_comments || 0 },
      extra: { discussion, host: h.url ? new URL(h.url).hostname.replace(/^www\./, '') : '' },
      eng: log10(h.points) / 2.7 + Math.min(0.1, log10(h.num_comments) / 25),
    }));
  }
  return { items, note: `${hits.size} hikâye tarandı, ${items.length} ilgili` };
}

// ---------------------------------------------------------------- Reddit (Atom; JSON is blocked without OAuth)
// Unauthenticated Reddit allows only a couple of requests per minute, so subreddits
// are fetched as a few multireddits ("a+b+c") spaced well apart.
const REDDIT_UA = 'windows:sinyal-radar:1.0 (personal news dashboard)';

export async function reddit(job) {
  const meta = new Map(job.groups.flatMap(g => g.subs).map(s => [s.name.toLowerCase(), s]));
  const items = [];
  let ok = 0, lastErr = null;
  for (const [gi, group] of job.groups.entries()) {
    if (gi) await sleep(job.gap || 35000);
    const url = `https://www.reddit.com/r/${group.subs.map(s => s.name).join('+')}/top/.rss?t=day&limit=60`;
    let res = null;
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
      try {
        res = await request(url, { retries: 0, accept: 'application/atom+xml, application/xml', headers: { 'User-Agent': REDDIT_UA } });
      } catch (e) {
        lastErr = e;
        if (!(e instanceof HttpError && e.status === 429) || attempt) break;
        const reset = Number(e.headers?.get('x-ratelimit-reset')) || 60;
        await sleep(Math.min(90, reset + 2) * 1000);
      }
    }
    if (!res) continue;
    ok++;
    const rankBySub = new Map();
    for (const e of parseFeed(res.text)) {
      if (!e.title || !e.link) continue;
      const subName = (e.raw.match(/<category[^>]*term="([^"]+)"/) || [])[1] || '';
      const s = meta.get(subName.toLowerCase());
      if (!s) continue;
      const rank = (rankBySub.get(s.name) || 0) + 1;
      rankBySub.set(s.name, rank);
      if (s.filter && !isRelevant(e.title, e.summary)) continue;
      const image = /thumbs\.redditmedia|preview\.redd|i\.redd\.it|external-preview/.test(e.image) ? e.image : '';
      items.push(mk(job, {
        kind: 'post',
        sourceName: `r/${s.name}`,
        short: s.short,
        title: e.title,
        url: e.link,
        summary: e.summary.replace(/\s*\[link\]\s*\[comments\]\s*$/i, ''),
        author: e.author.replace(/^\/u\//, 'u/'),
        image,
        published: e.date,
        metrics: { rank },
        extra: { sub: s.name, discussion: e.link },
        sourceTags: s.topics || [],
        sourceFlags: s.flags || [],
        sourceDomain: s.domain || null,
        eng: 0.3 + 0.5 * Math.max(0, 1 - (rank - 1) / 15),
      }));
    }
  }
  if (!ok) throw lastErr || new Error('Reddit yanıt vermedi');
  return { items, note: `${ok}/${job.groups.length} grup alındı` };
}

// ---------------------------------------------------------------- YouTube channel feeds
export async function youtube(job) {
  const res = await request(`https://www.youtube.com/feeds/videos.xml?channel_id=${job.channelId}`, { accept: 'application/atom+xml, application/xml' });
  const entries = parseFeed(res.text);
  const items = [];
  for (const e of entries) {
    const desc = htmlToText(xmlInner(e.raw, 'media:description'));
    if (job.filter && !isRelevant(e.title, desc)) continue;
    const videoId = xmlInner(e.raw, 'yt:videoId');
    const views = Number(xmlAttr(e.raw, 'media:statistics', 'views')) || 0;
    items.push(mk(job, {
      kind: 'video',
      sourceName: job.name,
      title: e.title,
      url: e.link,
      summary: desc,
      author: job.name,
      image: videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : e.image,
      published: parseDateSafe(xmlInner(e.raw, 'published')) || e.date,
      metrics: { views },
      extra: { videoId, channel: job.name, short: /\/shorts\//.test(e.link) },
      eng: log10(views) / 5.6,
    }));
  }
  return { items };
}

const parseDateSafe = s => { const t = Date.parse(s); return Number.isFinite(t) ? t : null; };

// ---------------------------------------------------------------- arXiv
const LINK_RE = /https?:\/\/[^\s)<>\]"']+/g;
function researchLinks(text) {
  const links = (text.match(LINK_RE) || []).map(u => u.replace(/[.,;:]+$/, ''));
  return {
    code: links.find(u => /github\.com\/[\w.-]+\/[\w.-]+|gitlab\.com\//i.test(u)) || '',
    demo: links.find(u => /github\.io|demo|sample|listen|\.page|huggingface\.co\/spaces|soundcloud/i.test(u) && !/github\.com\//i.test(u)) || '',
    model: links.find(u => /huggingface\.co\/(?!spaces)/i.test(u)) || '',
  };
}

export async function arxiv(job) {
  const q = job.query.split(/\s+/).map(encodeURIComponent).join('+');
  const res = await request(`https://export.arxiv.org/api/query?search_query=${q}&sortBy=submittedDate&sortOrder=descending&max_results=${job.max}`, { timeout: 75000, accept: 'application/atom+xml' });
  const entries = parseFeed(res.text);
  const items = entries.map(e => {
    const authors = xmlAll(e.raw, 'author').map(a => htmlToText(xmlInner(`<x>${a.body}</x>`, 'name'))).filter(Boolean);
    const comment = htmlToText(xmlInner(e.raw, 'arxiv:comment'));
    const primary = xmlAttr(e.raw, 'arxiv:primary_category', 'term');
    const pdf = (e.raw.match(/<link[^>]+title=["']pdf["'][^>]*href=["']([^"']+)["']/i) || e.raw.match(/<link[^>]+href=["']([^"']+)["'][^>]*title=["']pdf["']/i) || [])[1] || '';
    const links = researchLinks(`${e.summary} ${comment}`);
    const absUrl = (e.guid || e.link).replace(/^http:/, 'https:').replace(/v\d+$/, '');
    return mk(job, {
      kind: 'paper',
      key: absUrl,
      title: e.title.replace(/\s+/g, ' '),
      url: absUrl,
      summary: e.summary,
      author: authors.slice(0, 3).join(', ') + (authors.length > 3 ? ` +${authors.length - 3}` : ''),
      published: parseDateSafe(xmlInner(e.raw, 'published')) || e.date,
      extra: { pdf: pdf.replace(/^http:/, 'https:'), category: primary, comment: clip(comment, 160), ...links },
      eng: 0.3 + (links.code ? 0.15 : 0) + (links.demo ? 0.12 : 0),
    });
  });
  return { items };
}

// ---------------------------------------------------------------- Hugging Face daily papers
export async function hfPapers(job) {
  // The undated call returns the latest daily list; dated calls must not be in HF's future.
  const urls = ['https://huggingface.co/api/daily_papers?limit=100', ...[1, 2].map(d => `https://huggingface.co/api/daily_papers?date=${new Date(Date.now() - d * DAY).toISOString().slice(0, 10)}&limit=100`)];
  const seen = new Map();
  for (const [n, url] of urls.entries()) {
    try {
      const { json } = await getJSON(url, { retries: 1 });
      for (const p of Array.isArray(json) ? json : []) if (p?.paper?.id && !seen.has(p.paper.id)) seen.set(p.paper.id, p);
    } catch (e) { if (!n) throw e; }
  }
  const items = [];
  for (const p of seen.values()) {
    const paper = p.paper;
    const kw = (paper.ai_keywords || []).join(' ');
    if (!isRelevant(paper.title, `${paper.summary} ${kw}`)) continue;
    items.push(mk(job, {
      kind: 'paper',
      key: `hfp:${paper.id}`,
      title: paper.title,
      url: `https://huggingface.co/papers/${paper.id}`,
      summary: paper.ai_summary || paper.summary,
      author: (paper.authors || []).slice(0, 3).map(a => a.name).filter(Boolean).join(', '),
      image: p.thumbnail || '',
      published: parseDateSafe(p.publishedAt) || parseDateSafe(paper.submittedOnDailyAt) || parseDateSafe(paper.publishedAt),
      metrics: { upvotes: paper.upvotes || 0, comments: p.numComments || 0 },
      extra: { arxiv: `https://arxiv.org/abs/${paper.id}`, code: paper.githubRepo || '', demo: paper.projectPage || '', keywords: (paper.ai_keywords || []).slice(0, 6) },
      eng: 0.3 + log10(paper.upvotes) / 2.2,
    }));
  }
  return { items, note: `${seen.size} makale tarandı, ${items.length} ilgili` };
}

// ---------------------------------------------------------------- Hugging Face models & spaces
export async function hfModels(job) {
  const board = {};
  const items = [];
  const now = Date.now();
  for (const task of job.tasks) {
    try {
      const { json } = await getJSON(`https://huggingface.co/api/models?pipeline_tag=${task.tag}&sort=trendingScore&limit=30`);
      board[task.tag] = json
        .filter(m => !isNsfw(m.id, (m.tags || []).join(' ')))
        .map(m => ({
          id: m.id,
          url: `https://huggingface.co/${m.id}`,
          likes: m.likes || 0,
          downloads: m.downloads || 0,
          trending: m.trendingScore || 0,
          createdAt: parseDateSafe(m.createdAt),
          library: m.library_name || '',
          license: (m.tags || []).find(t => t.startsWith('license:'))?.slice(8) || '',
          langs: (m.tags || []).filter(t => /^[a-z]{2}$/.test(t)).slice(0, 8),
          task: task.tag,
          domain: task.domain,
          topic: task.topic,
        }));
      for (const m of board[task.tag]) {
        if (!m.createdAt || now - m.createdAt > 21 * DAY || m.trending < 3) continue;
        items.push(mk(job, {
          kind: 'model',
          key: `hf:${m.id}`,
          title: m.id,
          url: m.url,
          summary: '',
          author: m.id.split('/')[0],
          published: m.createdAt,
          metrics: { likes: m.likes, downloads: m.downloads, trending: m.trending },
          extra: { task: task.tag, library: m.library, license: m.license },
          eng: log10(m.trending) / 2.4,
          sourceTags: [task.topic],
          sourceDomain: task.domain,
        }));
      }
    } catch (e) { if (task === job.tasks[0]) throw e; }
  }
  return { items, boards: { hfModels: board } };
}

const SPACE_DOMAIN = { tts: 'audio', voice: 'audio', speech: 'audio', audio: 'audio', music: 'music', song: 'music', video: 'visual', image: 'visual', flux: 'visual', '3d': 'visual' };

export async function hfSpaces(job) {
  const spaces = new Map();
  for (const q of job.queries) {
    try {
      const { json } = await getJSON(`https://huggingface.co/api/spaces?search=${encodeURIComponent(q)}&sort=trendingScore&limit=25`);
      for (const s of json) if (!spaces.has(s.id) && !isNsfw(s.id)) spaces.set(s.id, { ...s, _domain: SPACE_DOMAIN[q] || null });
    } catch { /* keep partial */ }
  }
  const list = [...spaces.values()]
    .map(s => ({ id: s.id, url: `https://huggingface.co/spaces/${s.id}`, likes: s.likes || 0, trending: s.trendingScore || 0, sdk: s.sdk || '', createdAt: parseDateSafe(s.createdAt), domains: s._domain ? [s._domain] : [] }))
    .filter(s => s.trending > 0)
    .sort((a, b) => b.trending - a.trending || b.likes - a.likes)
    .slice(0, 80);
  return { items: [], boards: { hfSpaces: list }, note: `${list.length} demo` };
}

// ---------------------------------------------------------------- GitHub search (rising new repos)
function ghHeaders(token) {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function githubSearch(job, ctx) {
  const token = ctx.secrets.githubToken;
  const gap = token ? 2300 : 6700; // search API: 30/min with a token, 10/min without
  const d7 = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10);
  const d30 = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  const queries = [
    ...job.ghTopics.map(t => ({ q: `topic:${t} created:>${d7}`, win: 7 })),
    ...job.keywordQueries.map(k => ({ q: `${k} created:>${d7} stars:>=8`, win: 7, strict: true })),
    ...(job.monthlyTopics || []).map(t => ({ q: `topic:${t} created:>${d30} stars:>=60`, win: 30 })),
  ];
  const repos = new Map();
  let done = 0, limited = false;
  for (const [i, { q, win, strict }] of queries.entries()) {
    if (i) await sleep(gap);
    try {
      const { json } = await getJSON(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=40`, { headers: ghHeaders(token), retries: 0 });
      done++;
      for (const r of json.items || []) {
        if (isSpamRepo(r) || isNsfw(r.full_name, r.description || '')) continue;
        if (strict && !isRelevant(`${r.name.replace(/[-_]/g, ' ')} ${r.description || ''} ${(r.topics || []).join(' ')}`)) continue;
        const prev = repos.get(r.full_name);
        repos.set(r.full_name, { r, win: prev ? Math.min(prev.win, win) : win });
      }
    } catch (e) {
      if (e instanceof HttpError && (e.status === 403 || e.status === 429)) { limited = true; break; }
    }
  }
  if (!done) throw new Error('GitHub arama yanıt vermedi' + (limited ? ' (hız sınırı)' : ''));

  const now = Date.now();
  const rows = [...repos.values()].map(({ r, win }) => {
    const created = Date.parse(r.created_at);
    const ageDays = Math.max(0.5, (now - created) / DAY);
    return {
      full_name: r.full_name,
      url: r.html_url,
      description: r.description || '',
      stars: r.stargazers_count,
      forks: r.forks_count,
      lang: r.language || '',
      topics: (r.topics || []).slice(0, 8),
      created,
      pushed: Date.parse(r.pushed_at),
      license: r.license?.spdx_id && r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id : '',
      avatar: r.owner?.avatar_url ? `${r.owner.avatar_url}&s=64` : '',
      velocity: +(r.stargazers_count / ageDays).toFixed(1),
      win,
      ...routeOf(`${r.name.replace(/[-_]/g, ' ')} ${r.description || ''} ${(r.topics || []).join(' ')}`),
    };
  });
  const rising7 = rows.filter(r => now - r.created <= 7.5 * DAY).sort((a, b) => b.stars - a.stars).slice(0, 100);
  const rising30 = rows.filter(r => now - r.created <= 31 * DAY).sort((a, b) => b.stars - a.stars).slice(0, 100);

  const items = rows.filter(r => r.stars >= 30 && now - r.created <= 14 * DAY).map(r => mk(job, {
    kind: 'repo',
    key: `gh:${r.full_name}`,
    title: r.full_name,
    url: r.url,
    summary: r.description,
    author: r.full_name.split('/')[0],
    image: r.avatar,
    published: r.created,
    metrics: { stars: r.stars, forks: r.forks, velocity: r.velocity },
    extra: { lang: r.lang, topics: r.topics, license: r.license },
    eng: log10(r.stars) / 3.3,
  }));
  return { items, boards: { ghRising7: rising7, ghRising30: rising30 }, note: `${done}/${queries.length} sorgu${limited ? ' · hız sınırına takıldı' : ''}` };
}

// ---------------------------------------------------------------- GitHub trending (HTML)
function parseTrending(html) {
  const out = [];
  for (const art of html.match(/<article class="Box-row">[\s\S]*?<\/article>/g) || []) {
    const full = (art.match(/<h2[^>]*>\s*<a[^>]*href="\/([^"]+)"/) || [])[1];
    if (!full) continue;
    const desc = htmlToText((art.match(/<p class="col-9[^"]*">([\s\S]*?)<\/p>/) || [])[1] || '');
    const lang = htmlToText((art.match(/itemprop="programmingLanguage">([^<]+)</) || [])[1] || '');
    const num = s => Number(String(s || '0').replace(/[^\d]/g, '')) || 0;
    const stars = num((art.match(/href="\/[^"]+\/stargazers"[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)/) || [])[1]);
    const forks = num((art.match(/href="\/[^"]+\/forks"[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)/) || [])[1]);
    const today = num((art.match(/([\d,]+)\s+stars?\s+(today|this week|this month)/) || [])[1]);
    out.push({ full_name: full.trim(), url: `https://github.com/${full.trim()}`, description: decodeEntities(desc), lang, stars, forks, starsPeriod: today });
  }
  return out;
}

export async function githubTrending(job) {
  const found = new Map();
  const pages = [...job.languages.map(l => ({ l, since: 'daily' })), { l: '', since: 'weekly' }, { l: 'python', since: 'weekly' }];
  let ok = 0;
  for (const { l, since } of pages) {
    try {
      const res = await request(`https://github.com/trending${l ? '/' + encodeURIComponent(l) : ''}?since=${since}`, { accept: 'text/html', retries: 1 });
      ok++;
      for (const r of parseTrending(res.text)) {
        const text = `${r.full_name.replace(/[-_/]/g, ' ')} ${r.description}`;
        if (!isRelevant(text) || isSpamRepo(r) || isNsfw(text)) continue;
        const prev = found.get(r.full_name);
        if (!prev || (since === 'daily' && prev.since !== 'daily')) found.set(r.full_name, { ...r, since, ...routeOf(text) });
      }
    } catch { /* partial is fine */ }
  }
  if (!ok) throw new Error('GitHub trend sayfaları alınamadı');
  const list = [...found.values()].sort((a, b) => (a.since === b.since ? b.starsPeriod - a.starsPeriod : a.since === 'daily' ? -1 : 1));
  const items = list.map(r => mk(job, {
    kind: 'trend',
    key: `ghtr:${r.full_name}`,
    title: r.full_name,
    url: r.url,
    summary: r.description,
    author: r.full_name.split('/')[0],
    published: null, // first time we saw it trending
    metrics: { stars: r.stars, forks: r.forks, starsPeriod: r.starsPeriod },
    extra: { lang: r.lang, since: r.since },
    eng: log10(r.starsPeriod) / 2.6,
  }));
  return { items, boards: { ghTrending: list }, note: `${ok}/${pages.length} sayfa, ${list.length} ilgili repo` };
}

// ---------------------------------------------------------------- GitHub releases (Atom, no API quota)
const NOISE_RELEASE = /\b(nightly|continuous|tmp-|snapshot|dev build|latest build|ci build)\b/i;

// Release notes rarely say what a project *is*, so route by repository name.
const RELEASE_HINTS = [
  [/comfyui|invokeai|diffusers|swarmui|krita-ai|kohya|chainner/i, ['imageai'], 'visual'],
  [/blender/i, ['3d'], 'visual'],
  [/obs-studio|shotcut|darktable/i, ['design'], 'visual'],
  [/whisper|tts|speech|voice|asr|sherpa|piper|coqui|f5-|chatterbox|cosyvoice|fish-speech|rvc|pyannote|moshi|index-tts|voxcpm|chattts|nemo/i, ['voice'], 'audio'],
  [/audiocraft|yue|ace-step|magenta/i, ['musicai'], 'music'],
  [/separat|vocalremover|music-source/i, ['audiotech'], 'audio'],
  [/juce|faust|clap|pedalboard|plugdata|cardinal|carla/i, ['audiotech'], 'audio'],
  [/surge|dexed|odin|vcvrack|rack/i, ['instruments'], 'music'],
  [/audacity|tenacity/i, ['audiotech'], 'audio'],
  [/lmms|musescore|mixxx|zrythm|hydrogen|ossia|sonic-pi|supercollider|chuck|csound|pure-data|tidal|tone\.js|bespoke|sonobus|fluidsynth|beets|librosa/i, ['production'], 'music'],
];
const releaseHint = repo => RELEASE_HINTS.find(([re]) => re.test(repo)) || [null, [], null];

export async function githubReleases(job) {
  const latest = [];
  const items = [];
  const now = Date.now();
  let ok = 0;
  for (const repo of job.repos) {
    try {
      const res = await request(`https://github.com/${repo}/releases.atom`, { accept: 'application/atom+xml', retries: 1 });
      ok++;
      const entries = parseFeed(res.text).filter(e => e.title && !NOISE_RELEASE.test(e.title) && e.date);
      if (!entries.length) continue;
      const [, topics, domain] = releaseHint(repo);
      const name = repo.split('/')[1];
      const top = entries[0];
      latest.push({ repo, version: top.title, url: top.link, date: top.date, notes: clip(htmlToText(top.html), 300), domains: domain ? [domain] : [], topic: topics[0] || null });
      for (const e of entries.slice(0, 3)) {
        if (now - e.date > 45 * DAY) continue;
        items.push(mk(job, {
          kind: 'release',
          key: e.link,
          title: `${name} ${e.title.startsWith(name) ? e.title.slice(name.length).trim() : e.title}`.trim(),
          url: e.link,
          summary: htmlToText(e.html),
          author: repo,
          published: e.date,
          extra: { repo, version: e.title },
          sourceTags: topics,
          sourceDomain: domain,
          eng: 0.45 + (/\b(\d+)\.0(\.0)?\b/.test(e.title) ? 0.15 : 0),
        }));
      }
    } catch { /* missing repos are skipped */ }
  }
  if (!ok) throw new Error('sürüm akışlarına erişilemedi');
  latest.sort((a, b) => b.date - a.date);
  return { items, boards: { releases: latest }, note: `${ok}/${job.repos.length} repo izlendi` };
}
