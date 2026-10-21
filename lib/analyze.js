// Cross-source analysis: rising terms (overall and per domain), brand pulse and
// multi-source story clusters.
import { tokens, terms as termsOf, DOMAINS } from './classify.js';
import { normUrl } from './store.js';

const DAY = 86400e3;
const TREND_KINDS = new Set(['news', 'post', 'video', 'paper', 'release', 'repo', 'model']);
const CLUSTER_KINDS = new Set(['news', 'post', 'video']);

export function analyze(items, now = Date.now()) {
  const week = items.filter(i => now - i.published < 8 * DAY && i.published <= now + 3600e3);
  const trendable = week.filter(i => TREND_KINDS.has(i.kind));
  const trends = { all: risingTerms(trendable, now) };
  for (const d of DOMAINS) trends[d] = risingTerms(trendable.filter(i => (i.domains || []).includes(d)), now, 3);
  return {
    computedAt: now,
    trends,
    entities: entityPulse(week, now),
    clusters: storyClusters(week.filter(i => CLUSTER_KINDS.has(i.kind) && now - i.published < 3 * DAY)),
  };
}

const dayIndex = (now, t) => Math.floor((now - t) / DAY);

function displayForm(term, titles) {
  const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}\\b`, 'i');
  const forms = new Map();
  for (const t of titles) {
    const m = t.match(re);
    if (m) forms.set(m[0], (forms.get(m[0]) || 0) + 1);
  }
  let best = term, n = 0;
  for (const [f, c] of forms) if (c > n || (c === n && /[A-Z]/.test(f))) { best = f; n = c; }
  return best;
}

function risingTerms(items, now, minToday = 3) {
  const stats = new Map();
  for (const it of items) {
    const d = dayIndex(now, it.published);
    if (d < 0 || d > 7) continue;
    for (const term of termsOf(it.title)) {
      let s = stats.get(term);
      if (!s) stats.set(term, (s = { days: new Array(8).fill(0), sources: new Set(), ids: [] }));
      s.days[d]++;
      if (d === 0) {
        s.sources.add(it.source);
        if (s.ids.length < 40) s.ids.push(it.id);
      }
    }
  }
  const scored = [];
  for (const [term, s] of stats) {
    const today = s.days[0];
    // Single words need wider agreement than phrases to count as a trend.
    if (today < minToday || s.sources.size < (term.includes(' ') ? 2 : 3)) continue;
    const prevAvg = s.days.slice(1).reduce((a, b) => a + b, 0) / 7;
    const ratio = (today + 0.5) / (prevAvg + 0.5);
    if (ratio < 1.6) continue;
    scored.push({ term, today, prevAvg: +prevAvg.toFixed(2), ratio: +ratio.toFixed(1), sources: s.sources.size, spark: s.days.slice().reverse(), ids: s.ids, score: ratio * Math.log2(today + 1) * Math.sqrt(s.sources.size) * (term.includes(' ') ? 1.25 : 1) });
  }
  scored.sort((a, b) => b.score - a.score);

  // A unigram that only appears inside a stronger bigram is redundant ("stable" vs "stable audio").
  const picked = [];
  for (const t of scored) {
    if (picked.length >= 24) break;
    const words = t.term.split(' ');
    const covered = picked.some(p => {
      const pw = p.term.split(' ');
      return pw.length > words.length && words.every(w => pw.includes(w)) && p.today >= t.today * 0.6;
    });
    if (covered) continue;
    for (const p of picked) {
      const pw = p.term.split(' ');
      if (words.length > pw.length && pw.every(w => words.includes(w)) && t.today >= p.today * 0.6) p.drop = true;
    }
    picked.push(t);
  }
  const byId = new Map(items.map(i => [i.id, i]));
  return picked.filter(p => !p.drop).slice(0, 14).map(({ score, drop, ...t }) => ({
    ...t,
    label: displayForm(t.term, t.ids.map(id => byId.get(id)?.title || '')),
  }));
}

function entityPulse(items, now) {
  const map = new Map();
  for (const it of items) {
    const d = dayIndex(now, it.published);
    if (d < 0 || d > 7) continue;
    for (const name of it.entities || []) {
      let s = map.get(name);
      if (!s) map.set(name, (s = { name, days: new Array(8).fill(0), ids: [] }));
      s.days[d]++;
      if (s.ids.length < 60) s.ids.push(it.id);
    }
  }
  return [...map.values()]
    .map(s => {
      const prevAvg = s.days.slice(1).reduce((a, b) => a + b, 0) / 7;
      return { name: s.name, today: s.days[0], week: s.days.slice(0, 7).reduce((a, b) => a + b, 0), prevAvg: +prevAvg.toFixed(2), spark: s.days.slice().reverse(), ids: s.ids };
    })
    .filter(s => s.week >= 2)
    .sort((a, b) => b.today - a.today || b.week - a.week)
    .slice(0, 30);
}

function storyClusters(items) {
  const n = items.length;
  const sig = items.map(it => new Set(tokens(it.title)));
  const index = new Map();
  sig.forEach((set, i) => {
    for (const t of set) {
      let a = index.get(t);
      if (!a) index.set(t, (a = []));
      a.push(i);
    }
  });
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };

  const byUrl = new Map();
  items.forEach((it, i) => {
    const u = normUrl(it.url);
    if (byUrl.has(u)) union(byUrl.get(u), i);
    else byUrl.set(u, i);
  });

  // "Gearnews" the site and "Gearnews" the YouTube channel are one outlet.
  const outlet = it => (it.sourceName || it.source).toLowerCase().replace(/\s*[—·-].*$/, '');
  for (let i = 0; i < n; i++) {
    const shared = new Map();
    for (const t of sig[i]) {
      const list = index.get(t);
      if (list.length > 45) continue; // too common to be evidence
      for (const j of list) if (j > i) shared.set(j, (shared.get(j) || 0) + 1);
    }
    for (const [j, k] of shared) {
      if (outlet(items[i]) === outlet(items[j])) continue;
      if (Math.abs(items[i].published - items[j].published) > 2.5 * DAY) continue;
      const minLen = Math.min(sig[i].size, sig[j].size);
      if ((k >= 3 && k / minLen >= 0.5) || (k >= 2 && minLen <= 3 && k / minLen >= 0.67)) union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(items[i]);
  }
  const clusters = [];
  for (const members of groups.values()) {
    const sources = new Set(members.map(outlet));
    if (sources.size < 2 || members.length > 25) continue;
    members.sort((a, b) => (b.weight || 1) * (1 + b.eng) - (a.weight || 1) * (1 + a.eng) || a.published - b.published);
    const lead = members[0];
    clusters.push({
      id: `c-${lead.id}`,
      lead: lead.id,
      title: lead.title,
      ids: members.map(m => m.id),
      sources: sources.size,
      sourceNames: [...new Set(members.map(m => m.sourceName))].slice(0, 8),
      first: Math.min(...members.map(m => m.published)),
      last: Math.max(...members.map(m => m.published)),
      topic: lead.topic,
      domains: [...new Set(members.flatMap(m => m.domains || []))],
      image: members.find(m => m.image)?.image || '',
    });
  }
  return clusters.sort((a, b) => b.sources - a.sources || b.last - a.last).slice(0, 40);
}
