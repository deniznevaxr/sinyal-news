// In-memory item store with dedupe, classification on ingest and atomic JSON persistence.
import { createHash } from 'node:crypto';
import { promises as fs, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { classify, matchEntities } from './classify.js';

const DAY = 86400e3;
const RETAIN_DAYS = 21;
const MAX_ITEMS = 12000;

const hashId = s => createHash('sha1').update(s).digest('base64url').slice(0, 14);

// (Re)derive domains, topics, flags and entities; run on ingest and on load so
// rule changes apply to cached items too.
function tag(item) {
  const text = `${item.title} ${item.summary} ${(item.extra?.topics || []).join(' ')} ${(item.extra?.categories || []).join(' ')}`;
  Object.assign(item, classify(text, { sourceTags: item.stags || [], sourceFlags: item.sflags || [], sourceDomain: item.sdomain || null }));
  item.entities = matchEntities(`${item.title} ${String(item.summary).slice(0, 220)}`);
  delete item.channel; // pre-domain taxonomy
  delete item.tags;
  return item;
}

export function normUrl(u) {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|ref$|source$)/i.test(k)) url.searchParams.delete(k);
    url.hash = '';
    return (url.host.replace(/^www\./, '') + url.pathname.replace(/\/+$/, '') + (url.search || '')).toLowerCase();
  } catch {
    return String(u || '').toLowerCase();
  }
}

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'store.json');
    this.items = new Map();
    this.boards = {};
    this.jobs = {};
    this.meta = {};
    this.about = {}; // "what is this" for repos and models (lib/about.js)
    this.saveTimer = null;
  }

  load() {
    if (!existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8'));
      for (const it of data.items || []) this.items.set(it.id, tag(it));
      this.boards = data.boards || {};
      this.jobs = data.jobs || {};
      this.meta = data.meta || {};
      this.about = data.about || {};
      this.prune();
    } catch (e) {
      console.warn('  ! önbellek okunamadı, sıfırdan başlanıyor:', e.message);
    }
  }

  // Items cached before the domain taxonomy existed get their source hints from
  // the current config, then are re-tagged.
  migrate(jobs) {
    // Boards and job states from the old schema lack domains: refetch everything once.
    if ((this.meta.schema || 1) < 2) {
      this.jobs = {};
      this.meta.schema = 2;
    }
    const byId = new Map(jobs.map(j => [j.id, j]));
    const subs = new Map((byId.get('reddit')?.groups || []).flatMap(g => g.subs).map(s => [s.name.toLowerCase(), s]));
    let n = 0;
    for (const it of this.items.values()) {
      if (it.sdomain !== undefined) continue;
      const job = byId.get(it.source);
      if (!job) continue;
      if (it.source === 'reddit') {
        const s = subs.get(String(it.extra?.sub || '').toLowerCase()) || {};
        Object.assign(it, { sdomain: s.domain || null, stags: s.topics || [], sflags: s.flags || [] });
      } else if (it.kind === 'model') {
        const task = (job.tasks || []).find(t => t.tag === it.extra?.task);
        Object.assign(it, { sdomain: task?.domain || null, stags: task ? [task.topic] : [] });
      } else {
        Object.assign(it, { sdomain: job.domain || null, stags: [...(job.topics || []), ...(job.tags || [])], sflags: job.flags || [] });
      }
      tag(it);
      n++;
    }
    return n;
  }

  // Merge a job result. Returns the items that were not known before.
  ingest(job, result) {
    const now = Date.now();
    const fresh = [];
    const seen = new Set();
    for (const raw of result.items || []) {
      if (!raw.url) continue;
      const id = hashId(`${job.id}|${raw.key || normUrl(raw.url)}`);
      if (seen.has(id)) continue;
      seen.add(id);
      const prev = this.items.get(id);
      const { key, sourceTags, sourceFlags, sourceDomain, ...rest } = raw;
      let published = raw.published || prev?.published || prev?.firstSeen || now;
      if (published > now + 3600e3) published = now; // feeds that time-travel
      const item = {
        id,
        ...rest,
        stags: sourceTags,
        sflags: sourceFlags,
        sdomain: sourceDomain,
        published,
        firstSeen: prev?.firstSeen || now,
      };
      // A translation stays valid while the text it was made from is unchanged.
      if (prev?.tr && prev.title === item.title && prev.summary === item.summary) item.tr = prev.tr;
      tag(item);
      this.items.set(id, item);
      if (!prev && now - published < RETAIN_DAYS * DAY) fresh.push(item);
    }
    for (const [name, value] of Object.entries(result.boards || {})) {
      // hfModels arrives per-task; merge so one failed task keeps its last snapshot
      this.boards[name] = name === 'hfModels' ? { ...(this.boards[name] || {}), ...value } : value;
    }
    this.scheduleSave();
    return fresh;
  }

  prune() {
    const cutoff = Date.now() - RETAIN_DAYS * DAY;
    for (const [id, it] of this.items) if (it.published < cutoff) this.items.delete(id);
    // Descriptions nobody has needed for three months go too.
    for (const [key, a] of Object.entries(this.about)) if (!a.at || a.at < Date.now() - 90 * DAY) delete this.about[key];
    if (this.items.size > MAX_ITEMS) {
      const sorted = [...this.items.values()].sort((a, b) => b.published - a.published);
      this.items = new Map(sorted.slice(0, MAX_ITEMS).map(i => [i.id, i]));
    }
  }

  list({ days = 8 } = {}) {
    const cutoff = Date.now() - days * DAY;
    return [...this.items.values()].filter(i => i.published >= cutoff).sort((a, b) => b.published - a.published);
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save().catch(e => console.warn('  ! kayıt hatası:', e.message)), 8000);
  }

  async save() {
    clearTimeout(this.saveTimer);
    this.prune();
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = this.file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify({ version: 2, savedAt: Date.now(), items: [...this.items.values()], boards: this.boards, jobs: this.jobs, meta: this.meta, about: this.about }));
    await fs.rename(tmp, this.file);
  }
}
