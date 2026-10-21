// Turns config/sources.json into schedulable jobs.
import * as A from './adapters.js';

const slug = s => s.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');

export function buildJobs(cfg) {
  const jobs = [];
  const d = cfg.defaults || {};

  for (const f of cfg.news || []) {
    jobs.push({ ...f, group: 'news', every: f.every || d.newsEvery || 10, max: f.max || d.maxPerFeed || 40, run: A.rss });
  }

  const hn = cfg.hackernews;
  if (hn) jobs.push({ id: 'hn', name: 'Hacker News', short: 'HN', group: 'community', every: hn.every, weight: 1.0, queries: hn.queries, minPoints: hn.minPoints, windowDays: hn.windowDays, run: A.hackerNews });

  if (cfg.reddit?.groups?.length) {
    jobs.push({ id: 'reddit', name: 'Reddit', short: 'r/', group: 'community', every: cfg.reddit.every, weight: 0.8, groups: cfg.reddit.groups, gap: (cfg.reddit.gapSeconds || 35) * 1000, run: A.reddit });
  }

  for (const c of cfg.youtube?.channels || []) {
    jobs.push({ id: `yt-${slug(c.name)}`, name: c.name, short: 'YT', group: 'video', every: cfg.youtube.every, weight: 0.75, channelId: c.id, domain: c.domain, topics: c.topics, tags: c.tags, flags: c.flags, filter: c.filter, run: A.youtube });
  }

  const arxivList = Array.isArray(cfg.arxiv) ? cfg.arxiv : cfg.arxiv ? [{ id: 'arxiv', name: 'arXiv', ...cfg.arxiv }] : [];
  for (const a of arxivList) {
    jobs.push({ id: a.id, name: a.name, short: 'ARXV', group: 'research', every: a.every || 60, weight: 0.75, tags: ['research'], domain: a.domain || null, query: a.query, max: a.max || 60, run: A.arxiv });
  }
  jobs.push({ id: 'hfpapers', name: 'Hugging Face · Günün makaleleri', short: 'HFP', group: 'research', every: 60, weight: 0.85, tags: ['research'], run: A.hfPapers });

  const hf = cfg.huggingface;
  if (hf) {
    jobs.push({ id: 'hfmodels', name: 'Hugging Face · Modeller', short: 'HF', group: 'models', every: hf.every, weight: 0.95, tasks: hf.tasks, run: A.hfModels });
    jobs.push({ id: 'hfspaces', name: 'Hugging Face · Demolar', short: 'HFS', group: 'models', every: hf.every, weight: 0.8, queries: hf.spaceQueries, run: A.hfSpaces });
  }

  const gh = cfg.github;
  if (gh) {
    jobs.push({ id: 'ghsearch', name: 'GitHub · Yeni repolar', short: 'GH', group: 'github', every: gh.searchEvery, weight: 0.9, flags: ['oss'], ghTopics: gh.topics, monthlyTopics: gh.monthlyTopics, keywordQueries: gh.keywordQueries, run: A.githubSearch });
    jobs.push({ id: 'ghtrending', name: 'GitHub · Trend', short: 'GHTR', group: 'github', every: gh.trendingEvery, weight: 0.9, flags: ['oss'], languages: gh.trendingLanguages, run: A.githubTrending });
    jobs.push({ id: 'ghreleases', name: 'GitHub · Sürümler', short: 'REL', group: 'github', every: gh.releasesEvery, weight: 0.85, flags: ['oss'], repos: gh.releases, run: A.githubReleases });
  }
  return jobs;
}
