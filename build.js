// One-shot collector for static hosting (GitHub Pages, Netlify, Cloudflare Pages…).
// Runs every source that is due, translates new items, analyses, then writes
// dist/ = the UI + data.json. A scheduled CI job runs this every ~20 minutes, so
// the published site stays fresh without any server or local computer.
//
//   node build.js            → dist/ (uses and updates data/ as its cache)
//   node build.js --all      → ignore intervals and fetch every source
//   node build.js --offline  → no fetching, just rebuild dist/ from the cache
import { readFileSync, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.js';
import { Scheduler } from './lib/scheduler.js';
import { buildJobs } from './lib/jobs.js';
import { analyze } from './lib/analyze.js';
import { Secrets } from './lib/secrets.js';
import { Briefer } from './lib/brief.js';
import { Translator } from './lib/translate.js';
import { About } from './lib/about.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.SINYAL_DATA_DIR ? path.resolve(process.env.SINYAL_DATA_DIR) : path.join(ROOT, 'data');
const DIST = path.join(ROOT, 'dist');
const ALL = process.argv.includes('--all');
const OFFLINE = process.argv.includes('--offline');
const BRIEF_HOURS = Number(process.env.BRIEF_AUTO_HOURS || 12);
const VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s]`, ...a);

const sources = JSON.parse(readFileSync(path.join(ROOT, 'config', 'sources.json'), 'utf8'));
const store = new Store(DATA);
store.load();
const jobs = buildJobs(sources);
store.migrate(jobs);
const secrets = new Secrets(DATA);

// 1. Fetch what is due (a source's own interval, minus a little slack for CI jitter).
const now = Date.now();
const due = OFFLINE ? [] : jobs.filter(j => {
  const st = store.jobs[j.id];
  return ALL || !st?.lastOk || now - st.lastRun >= (j.every - 3) * 60e3;
});
log(`${due.length}/${jobs.length} kaynak taranacak · önbellekte ${store.items.size} haber`);
if (due.length) {
  const scheduler = new Scheduler(due, store, { secrets }, { concurrency: 6 });
  let fresh = 0;
  scheduler.on('result', r => { fresh += r.fresh.length; });
  await new Promise(resolve => {
    scheduler.on('idle', resolve);
    for (const j of due) j.nextRun = 0;
    scheduler.tick();
  });
  clearInterval(scheduler.timer);
  const failed = due.filter(j => store.jobs[j.id]?.ok === false).map(j => `${j.id} (${store.jobs[j.id].error})`);
  log(`tarama bitti · ${fresh} yeni haber${failed.length ? ` · hatalı: ${failed.join(', ')}` : ''}`);
}

// 1b. What new repositories and models are, in their own words (a capped number per run).
const about = new About(store, secrets);
if (!OFFLINE) {
  const learned = await about.refresh({ max: 80 });
  log(`açıklama: ${learned.length} araç ve model`);
}

// 2. Analyse, then translate (paced inside the translator): the multi-source stories the
//    front page features go first, so a big backlog never leaves the headlines in English.
const TRANSLATE_MAX = process.env.TRANSLATE_MAX !== undefined ? Number(process.env.TRANSLATE_MAX) : 400;
const analysis = analyze(store.list());
const translator = new Translator(store);
const translated = await translator.run({ max: TRANSLATE_MAX, first: analysis.clusters.flatMap(c => c.ids) });
const describedTr = await translator.runAbout({ max: TRANSLATE_MAX });
log(`çeviri: ${translated} haber, ${describedTr} açıklama${translator.lastError ? ` · durdu: ${translator.lastError}` : ''}`);

// 3. (Optionally) brief.
const briefer = new Briefer(DATA, secrets);
if (secrets.anthropicKey && briefer.isStale(BRIEF_HOURS)) {
  try {
    await briefer.generate(store.list({ days: 2 }), analysis, {});
    log('AI brifing yenilendi');
  } catch (e) {
    log('AI brifing atlandı:', e.message);
  }
}

// 4. Publish: the UI plus one data file.
await store.save();
await fs.rm(DIST, { recursive: true, force: true });
await fs.cp(path.join(ROOT, 'public'), DIST, { recursive: true });
const scheduler = new Scheduler(jobs, store, { secrets });
const eventsFile = path.join(ROOT, 'config', 'events.json');
const snapshot = {
  meta: {
    version: VERSION,
    mode: 'static',
    public: true,
    generatedAt: Date.now(),
    flags: { public: true, anthropic: !!secrets.anthropicKey },
    translation: translator.status(),
  },
  items: store.list({ days: 8 }),
  boards: store.boards,
  about: about.snapshot(),
  analysis,
  sources: scheduler.snapshot().map(s => ({ ...s, running: false, queued: false })),
  events: existsSync(eventsFile) ? JSON.parse(readFileSync(eventsFile, 'utf8')).events || [] : [],
  brief: briefer.latest,
};
await fs.writeFile(path.join(DIST, 'data.json'), JSON.stringify(snapshot));
await fs.writeFile(path.join(DIST, '.nojekyll'), '');
// Tell the page it is a static copy so it reads data.json directly (no failed API probe).
const indexFile = path.join(DIST, 'index.html');
const html = await fs.readFile(indexFile, 'utf8');
await fs.writeFile(indexFile, html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta name="sinyal-mode" content="static">'));
log(`dist/ hazır · ${snapshot.items.length} haber · ${(JSON.stringify(snapshot).length / 1e6).toFixed(1)} MB`);
process.exit(0);
