// "What is this?" for tools. A list of repositories and models only shows names such as
// micknoisemachine/mimetic-a0. This reads each project's own words once (the GitHub
// description or README, the Hugging Face model or Space card), keeps a short plain
// summary plus a few facts (task, base model, LoRA…) and refreshes them now and then.
// The translator turns the summaries into Turkish like everything else.
import { request, getJSON, HttpError } from './http.js';
import { decodeEntities } from './xml.js';

const DAY = 864e5;
const REFRESH_DAYS = 30;   // descriptions rarely change
const RETRY_DAYS = 3;      // a card that could not be read is tried again later
const MAX_CHARS = 320;

export const aboutKeys = {
  model: id => `hf:${id}`,
  space: id => `hfs:${id}`,
  repo: name => `gh:${name}`,
};

// ------------------------------------------------------------------ text from READMEs
// Cards often open with YAML, banners, badges and link rows; the first real sentence
// comes after them.
const BOILERPLATE = /model ?card (aims|for|has been)|more information needed|provide a (quick|longer) summary|configuration reference|this is the model card|automatically generated|pushed (on|to) the hub|consider (switching|upgrading)|buy me a coffee|join (our|the) discord|give (us|it) a star|^(table of contents|contents|citation|license|installation|usage|quick ?start)\b/i;

function inline(s) {
  return decodeEntities(String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/:[a-z_]+:/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function clipSentences(s, n = MAX_CHARS) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (end > n * 0.45) return cut.slice(0, end + 1);
  return cut.replace(/\s+\S*$/, '').replace(/[\s,.;:–—-]+$/, '') + '…';
}

export function firstParagraph(md) {
  let s = String(md || '').replace(/\r/g, '');
  s = s.replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/<!--[\s\S]*?-->/g, '\n\n')
    .replace(/```[\s\S]*?```/g, '\n\n')
    .replace(/<(audio|video|picture|table|details|script|style|div align)[\s\S]*?<\/(audio|video|picture|table|details|script|style|div)>/gi, '\n\n');
  for (const block of s.split(/\n\s*\n/)) {
    const raw = block.trim();
    if (!raw || /^(#|\||>|!\[|\[!\[|<img|<h\d|[-=*_]{3,}|\[!)/.test(raw)) continue;
    if (/^([-*+]|\d+[.)])\s/.test(raw)) continue;
    const text = inline(raw);
    const words = text.split(/\s+/).filter(w => /\p{L}{2,}/u.test(w)).length;
    const links = (raw.match(/\]\(|<a\s|https?:\/\//g) || []).length;
    if (words < 8 || (links >= 2 && words < 16) || BOILERPLATE.test(text)) continue;
    return clipSentences(text);
  }
  return '';
}

// The handful of front-matter fields we need (no YAML library).
export function frontMatter(md) {
  const m = String(md || '').replace(/\r/g, '').match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  const unquote = v => v.trim().replace(/^['"]|['"]$/g, '');
  let key = null;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      const v = kv[2].trim();
      out[key] = !v ? [] : v.startsWith('[') ? v.slice(1, -1).split(',').map(unquote).filter(Boolean) : unquote(v);
      continue;
    }
    const li = line.match(/^\s+-\s*(.+)$/) || line.match(/^-\s*(.+)$/);
    if (li && key && Array.isArray(out[key])) out[key].push(unquote(li[1]));
  }
  return out;
}

const list = v => (Array.isArray(v) ? v : v ? [v] : []);

// ------------------------------------------------------------------ fetchers
async function readme(url) {
  try {
    return (await request(url, { accept: 'text/plain', retries: 1, timeout: 15000 })).text;
  } catch (e) {
    if (e instanceof HttpError && [401, 403, 404, 410].includes(e.status)) return ''; // gated or no card
    throw e;
  }
}

// Gated models hide the raw README, but their public page still shows the card.
async function cardFromPage(id) {
  try {
    const html = (await request(`https://huggingface.co/${id}`, { accept: 'text/html', retries: 1, timeout: 20000 })).text;
    const at = html.indexOf('model-card-content');
    if (at < 0) return '';
    const paragraphs = [...html.slice(at, at + 60000).matchAll(/<p>([\s\S]*?)<\/p>/g)].map(m => m[1]);
    return firstParagraph(paragraphs.join('\n\n'));
  } catch {
    return '';
  }
}

async function model(id, row) {
  const md = await readme(`https://huggingface.co/${id}/raw/main/README.md`);
  const fm = frontMatter(md);
  const tags = list(fm.tags).map(t => String(t).toLowerCase());
  const base = list(fm.base_model)[0] || '';
  const relation = String(fm.base_model_relation || '');
  const lora = tags.includes('lora') || /lora/i.test(id) || relation === 'adapter';
  const gguf = tags.includes('gguf') || /gguf/i.test(id);
  const quant = !gguf && (relation === 'quantized' || /(^|[-_.])(awq|gptq|int4|int8|fp8|4bit|8bit|mlx|bnb)([-_.]|$)/i.test(id));
  return {
    en: md ? firstParagraph(md) : await cardFromPage(id),
    meta: {
      kind: 'model', task: fm.pipeline_tag || row.task || '', base, lora, gguf, quant,
      license: String(fm.license || row.license || ''), library: String(fm.library_name || row.library || ''),
    },
  };
}

async function space(id) {
  const md = await readme(`https://huggingface.co/spaces/${id}/raw/main/README.md`);
  const fm = frontMatter(md);
  return {
    en: clipSentences(inline(fm.short_description || '')) || firstParagraph(md),
    meta: { kind: 'space', sdk: String(fm.sdk || ''), title: String(fm.title || '') },
  };
}

async function repo(name, row, token) {
  let desc = String(row.description || '').trim();
  const meta = { kind: 'repo', lang: row.lang || '', license: row.license || '' };
  if (desc.length < 25 && !row.described) {
    // No description in the list (release feeds, empty profiles): ask GitHub, then the README.
    if (token) {
      try {
        const { json } = await getJSON(`https://api.github.com/repos/${name}`, { headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }, retries: 1 });
        desc = json.description || desc;
        meta.lang ||= json.language || '';
        meta.license ||= json.license?.spdx_id && json.license.spdx_id !== 'NOASSERTION' ? json.license.spdx_id : '';
      } catch { /* fall through to the README */ }
    }
    if (desc.length < 25) {
      const md = await readme(`https://raw.githubusercontent.com/${name}/HEAD/README.md`);
      desc = firstParagraph(md) || desc;
    }
  }
  return { en: clipSentences(inline(desc)), meta };
}

// ------------------------------------------------------------------ the cache
export class About {
  constructor(store, secrets) {
    this.store = store;
    this.secrets = secrets;
    this.running = false;
  }

  // Everything the panel can show, roughly in the order people see it.
  wanted() {
    const b = this.store.boards;
    const out = new Map();
    const add = (key, job) => { if (!out.has(key)) out.set(key, job); };
    const models = Object.values(b.hfModels || {}).flat().sort((x, y) => (y.trending || 0) - (x.trending || 0));
    const repoJob = r => ({ type: 'repo', id: r.full_name, row: { ...r, described: (r.description || '').length >= 25 } });
    for (const r of b.ghRising7 || []) add(aboutKeys.repo(r.full_name), repoJob(r));
    for (const r of b.ghTrending || []) add(aboutKeys.repo(r.full_name), repoJob(r));
    for (const m of models.slice(0, 60)) add(aboutKeys.model(m.id), { type: 'model', id: m.id, row: m });
    for (const r of b.releases || []) add(aboutKeys.repo(r.repo), { type: 'repo', id: r.repo, row: { description: '' } });
    for (const s of b.hfSpaces || []) add(aboutKeys.space(s.id), { type: 'space', id: s.id, row: s });
    for (const m of models.slice(60)) add(aboutKeys.model(m.id), { type: 'model', id: m.id, row: m });
    for (const r of b.ghRising30 || []) add(aboutKeys.repo(r.full_name), repoJob(r));
    for (const it of this.store.items.values()) {
      if (it.kind === 'model') add(aboutKeys.model(it.title), { type: 'model', id: it.title, row: { task: it.extra?.task } });
    }
    return out;
  }

  // Reads up to `max` missing or stale descriptions. Returns the keys that changed.
  async refresh({ max = 80 } = {}) {
    if (this.running) return [];
    this.running = true;
    const about = this.store.about;
    const now = Date.now();
    const changed = [];
    let fetched = 0;
    try {
      for (const [key, job] of this.wanted()) {
        const cur = about[key];
        const fresh = cur && now - cur.at < (cur.failed ? RETRY_DAYS : REFRESH_DAYS) * DAY;
        // Repositories that came with a good description need no request at all.
        if (fresh && !(job.type === 'repo' && job.row.described && inline(job.row.description) !== cur.src)) continue;
        if (job.type !== 'repo' || !job.row.described) {
          if (fetched >= max) continue;
          fetched++;
        }
        let next;
        try {
          next = job.type === 'model' ? await model(job.id, job.row)
            : job.type === 'space' ? await space(job.id)
            : await repo(job.id, job.row, this.secrets?.githubToken);
        } catch {
          about[key] = { ...(cur || {}), at: now, failed: true }; // unreachable for now: try again in a few days
          continue;
        }
        const entry = { en: next.en, meta: next.meta, at: now, src: job.type === 'repo' ? inline(job.row.description || '') : undefined };
        // Keep the Turkish text while the English stays the same.
        if (cur?.tr && cur.en === entry.en) { entry.tr = cur.tr; entry.trAt = cur.trAt; }
        about[key] = entry;
        if (!cur || cur.en !== entry.en || JSON.stringify(cur.meta) !== JSON.stringify(entry.meta)) changed.push(key);
      }
    } finally {
      this.running = false;
    }
    if (changed.length) this.store.scheduleSave();
    return changed;
  }

  // The descriptions the published snapshot needs (only what the boards and items show).
  snapshot() {
    const keys = this.wanted().keys();
    const out = {};
    for (const key of keys) {
      const a = this.store.about[key];
      if (a && (a.en || a.meta)) out[key] = { en: a.en || '', tr: a.tr || '', meta: a.meta || {} };
    }
    return out;
  }
}
