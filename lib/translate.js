// Turkish translations of titles and summaries, cached on the items themselves
// (item.tr = { t, s, at }). Uses Google's free web translation endpoint in batches;
// on rate limits or errors it backs off and the UI falls back to the browser's own
// on-device translator or the original text.
import { request, sleep } from './http.js';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=tr&dt=t';
const MAX_CHARS = 3600;      // per request, well under the endpoint's limits
const GAP_MS = 2500;         // pause between requests
const SUMMARY_CHARS = 320;   // the UI shows two lines of summary at most

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

export class Translator {
  constructor(store) {
    this.store = store;
    this.running = false;
    this.pausedUntil = 0;
    this.total = 0;
    this.lastError = null;
  }

  status() {
    return { total: this.total, pausedUntil: this.pausedUntil || null, lastError: this.lastError, running: this.running };
  }

  // Recent items still lacking Turkish: the ids in `first` (the stories the front page
  // features) ahead of the rest, then newest first.
  pending(limit, first = []) {
    const out = [];
    if (limit <= 0) return out;
    const seen = new Set();
    for (const it of [...first.map(id => this.store.items.get(id)), ...this.store.list({ days: 7 })]) {
      if (!it || it.tr || seen.has(it.id) || (it.flags || []).includes('tr')) continue;
      seen.add(it.id);
      out.push(it);
      if (out.length >= limit) break;
    }
    return out;
  }

  segments(it) {
    // Repository and model titles are identifiers, not prose.
    const titleIsName = it.kind === 'repo' || it.kind === 'trend' || it.kind === 'model';
    const segs = [];
    if (!titleIsName && clean(it.title)) segs.push(['t', clean(it.title)]);
    const sum = clean(it.summary).slice(0, SUMMARY_CHARS);
    if (sum) segs.push(['s', sum]);
    return segs;
  }

  // Translates up to `max` items, `first` ahead of the rest; onBatch({ id: tr }) fires after each request.
  async run({ max = 150, first = [], onBatch } = {}) {
    if (this.running || Date.now() < this.pausedUntil) return 0;
    this.running = true;
    let count = 0;
    try {
      let batch = [];
      let chars = 0;
      const flush = async () => {
        if (!batch.length) return;
        const lines = batch.flatMap(b => b.segs.map(([, text]) => text));
        const out = await this.translateLines(lines);
        const changed = {};
        let k = 0;
        for (const b of batch) {
          const tr = { at: Date.now() };
          for (const [field] of b.segs) tr[field] = out[k++] || '';
          b.item.tr = tr;
          changed[b.item.id] = tr;
        }
        count += batch.length;
        onBatch?.(changed);
        batch = [];
        chars = 0;
        await sleep(GAP_MS);
      };
      for (const it of this.pending(max, first)) {
        const segs = this.segments(it);
        if (!segs.length) { it.tr = { at: Date.now() }; continue; }
        const len = segs.reduce((a, [, t]) => a + t.length + 1, 0);
        if (chars + len > MAX_CHARS) await flush();
        batch.push({ item: it, segs });
        chars += len;
      }
      await flush();
      this.lastError = null;
    } catch (e) {
      this.fail(e);
    } finally {
      this.running = false;
      this.total += count;
      if (count) this.store.scheduleSave();
    }
    return count;
  }

  // Translations the published copy already made. GitHub builds it from the same sources,
  // so items share ids; copying its Turkish means this computer rarely has to ask Google,
  // which helps on networks or IPs where Google's endpoint is unreliable or rate-limited.
  // Returns { items: { id: tr }, about: [keys] } of what changed.
  async borrow(siteUrl) {
    const none = { items: {}, about: [] };
    if (!siteUrl) return none;
    let site;
    try {
      const res = await fetch(new URL('data.json', siteUrl), {
        headers: this.siteEtag ? { 'If-None-Match': this.siteEtag } : {},
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return none; // 304: nothing new since last time
      site = await res.json();
      this.siteEtag = res.headers.get('etag');
    } catch {
      return none;
    }
    const items = {};
    for (const s of site.items || []) {
      const it = this.store.items.get(s.id);
      // Only when the text matches exactly what was translated there.
      if (!s.tr || !it || it.tr || it.title !== s.title || (it.summary || '') !== (s.summary || '')) continue;
      it.tr = s.tr;
      items[it.id] = s.tr;
    }
    const about = [];
    const now = Date.now();
    for (const [key, a] of Object.entries(site.about || {})) {
      if (!a.tr) continue;
      const mine = this.store.about[key];
      if (!mine) this.store.about[key] = { en: a.en, tr: a.tr, meta: a.meta, at: now, trAt: now };
      else if (!mine.tr && mine.en === a.en) Object.assign(mine, { tr: a.tr, trAt: now });
      else continue;
      about.push(key);
    }
    const n = Object.keys(items).length + about.length;
    if (n) {
      this.total += n;
      this.store.scheduleSave();
    }
    return { items, about };
  }

  // Turkish for the "what is this" descriptions of repositories and models (lib/about.js).
  async runAbout({ max = 200, onBatch } = {}) {
    if (this.running || Date.now() < this.pausedUntil) return 0;
    const todo = Object.entries(this.store.about).filter(([, a]) => a.en && !a.tr).slice(0, max);
    if (!todo.length) return 0;
    this.running = true;
    let count = 0;
    try {
      let batch = [];
      let chars = 0;
      const flush = async () => {
        if (!batch.length) return;
        const out = await this.translateLines(batch.map(([, a]) => a.en));
        const changed = {};
        batch.forEach(([key, a], i) => {
          a.tr = out[i] || '';
          a.trAt = Date.now();
          changed[key] = a;
        });
        count += batch.length;
        onBatch?.(changed);
        batch = [];
        chars = 0;
        await sleep(GAP_MS);
      };
      for (const entry of todo) {
        const len = entry[1].en.length + 1;
        if (chars + len > MAX_CHARS) await flush();
        batch.push(entry);
        chars += len;
      }
      await flush();
      this.lastError = null;
    } catch (e) {
      this.fail(e);
    } finally {
      this.running = false;
      this.total += count;
      if (count) this.store.scheduleSave();
    }
    return count;
  }

  fail(e) {
    this.lastError = String(e?.message || e).slice(0, 120);
    // Circuit breaker: a rate limit gets a long rest, a flaky connection a short one.
    this.pausedUntil = Date.now() + (e?.status === 429 ? 30 : e?.status ? 10 : 2) * 60e3;
  }

  async translateLines(lines) {
    const out = await this.post(lines.join('\n'));
    const parts = out.split('\n');
    if (parts.length === lines.length) return parts.map(s => s.trim());
    // Rare: the service merged or split lines. Retry this batch one line at a time.
    const each = [];
    for (const line of lines) {
      each.push((await this.post(line)).trim());
      await sleep(700);
    }
    return each;
  }

  async post(text) {
    const res = await request(ENDPOINT, {
      method: 'POST',
      body: new URLSearchParams({ q: text }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      accept: 'application/json',
      retries: 4,
      timeout: 20000,
    });
    const j = JSON.parse(res.text);
    return (j?.[0] || []).map(seg => seg?.[0] || '').join('');
  }
}
