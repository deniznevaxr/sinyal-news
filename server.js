// SİNYAL — ses, müzik ve görsel teknoloji haber paneli.
// Zero-dependency server: collects sources on a schedule, translates them to Turkish,
// serves the UI and pushes new items to open browsers over Server-Sent Events.
//
// Local:   node server.js            → http://localhost:4400 (only this computer)
// Online:  PUBLIC=1 node server.js   → listens on 0.0.0.0:$PORT for a hosted deployment
import http from 'node:http';
import { readFileSync, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { Store } from './lib/store.js';
import { Scheduler } from './lib/scheduler.js';
import { buildJobs } from './lib/jobs.js';
import { analyze } from './lib/analyze.js';
import { Secrets } from './lib/secrets.js';
import { Briefer, sdkInstalled } from './lib/brief.js';
import { Translator } from './lib/translate.js';
import { About } from './lib/about.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// SINYAL_DATA_DIR and SINYAL_NO_SWEEP exist for testing a second instance against a copy of the cache.
const DATA = process.env.SINYAL_DATA_DIR ? path.resolve(process.env.SINYAL_DATA_DIR) : path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PUBLIC = process.env.PUBLIC === '1' || process.env.SINYAL_PUBLIC === '1';
const HOST = process.env.HOST || (PUBLIC ? '0.0.0.0' : '127.0.0.1');
const PORT = Number(process.env.PORT) || 4400; // A4 = 440 Hz
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const BRIEF_AUTO_HOURS = Number(process.env.BRIEF_AUTO_HOURS || (PUBLIC ? 12 : 0));
const VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const sources = JSON.parse(readFileSync(path.join(ROOT, 'config', 'sources.json'), 'utf8'));
const store = new Store(DATA);
store.load();
const jobs = buildJobs(sources);
store.migrate(jobs);
const secrets = new Secrets(DATA);
const briefer = new Briefer(DATA, secrets);
const translator = new Translator(store);
const about = new About(store, secrets);
const scheduler = new Scheduler(jobs, store, { secrets }, { concurrency: 6 });

// ------------------------------------------------------------------ analysis + translation
let analysis = analyze(store.list());
let analysisTimer = null;
function scheduleAnalysis() {
  clearTimeout(analysisTimer);
  analysisTimer = setTimeout(() => {
    const t0 = Date.now();
    analysis = analyze(store.list());
    analysis.ms = Date.now() - t0;
    broadcast('analysis', analysis);
    translateSoon();
  }, 2500);
}
setInterval(scheduleAnalysis, 10 * 60e3); // day buckets roll over even when quiet

let translateTimer = null;
function translateSoon() {
  clearTimeout(translateTimer);
  translateTimer = setTimeout(async () => {
    await translator.run({
      max: 150,
      first: analysis.clusters.flatMap(c => c.ids), // featured stories before the rest
      onBatch: changed => broadcast('tr', changed),
    });
    await translator.runAbout({ max: 120, onBatch: changed => broadcast('about', slimAbout(Object.keys(changed))) });
  }, 1500);
}

// "What is this" for repos and models: read new ones shortly after the boards change.
const slimAbout = keys => Object.fromEntries(keys.map(k => [k, store.about[k]]).filter(([, a]) => a).map(([k, a]) => [k, { en: a.en || '', tr: a.tr || '', meta: a.meta || {} }]));
let aboutTimer = null;
function aboutSoon() {
  clearTimeout(aboutTimer);
  aboutTimer = setTimeout(async () => {
    const changed = await about.refresh({ max: 40 }).catch(() => []);
    if (changed.length) { broadcast('about', slimAbout(changed)); translateSoon(); }
  }, 20e3);
}
setInterval(aboutSoon, 15 * 60e3);
setInterval(translateSoon, 3 * 60e3);

// ------------------------------------------------------------------ SSE hub
const clients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}
setInterval(() => broadcast('ping', { now: Date.now() }), 25e3);

// Started from BASLAT.bat (--open), the server belongs to its app window: once the last
// window has stayed closed for a little while it stops, so nothing keeps running in the
// background. (A reload reconnects within seconds and keeps it alive.)
const APP_SESSION = !PUBLIC && process.argv.includes('--open');
let everConnected = false;
let idleTimer = null;
function watchClients() {
  if (!APP_SESSION) return;
  clearTimeout(idleTimer);
  if (clients.size) { everConnected = true; return; }
  if (everConnected) idleTimer = setTimeout(() => { if (!clients.size) shutdown('uygulama penceresi kapandı'); }, 25e3);
}

scheduler.on('status', st => broadcast('status', { source: st, busy: scheduler.busy }));
scheduler.on('queue', () => broadcast('busy', scheduler.busy));
scheduler.on('result', ({ job, fresh, boards, backfill }) => {
  if (fresh.length) broadcast('items', { items: fresh, backfill, source: job.id });
  if (boards.length) { broadcast('boards', Object.fromEntries(boards.map(b => [b, store.boards[b]]))); aboutSoon(); }
  scheduleAnalysis();
});

function meta() {
  return {
    version: VERSION,
    mode: 'live',
    public: PUBLIC,
    now: Date.now(),
    startedAt,
    busy: scheduler.busy,
    flags: { ...secrets.flags(), public: PUBLIC },
    brief: { running: briefer.running, latestAt: briefer.latest?.createdAt || null },
    translation: translator.status(),
  };
}

// Optional scheduled brief (hosted deployments): visitors never trigger spending.
if (BRIEF_AUTO_HOURS > 0) {
  setInterval(async () => {
    if (!secrets.anthropicKey || briefer.running || !briefer.isStale(BRIEF_AUTO_HOURS)) return;
    try {
      const brief = await briefer.generate(store.list({ days: 2 }), analysis, { watchlist: [] });
      broadcast('brief', brief);
    } catch (e) {
      console.warn('  ! otomatik brifing:', e.message);
    }
  }, 15 * 60e3);
}

// ------------------------------------------------------------------ helpers
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

function send(req, res, status, body, type = 'application/json; charset=utf-8') {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  if (buf.length > 1400 && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && !/^image\/(png|x-icon)/.test(type)) {
    buf = gzipSync(buf);
    headers['Content-Encoding'] = 'gzip';
  }
  headers['Content-Length'] = buf.length;
  res.writeHead(status, headers);
  res.end(buf);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw new Error('istek çok büyük');
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

// Local mode: only this machine, only our own page (blocks DNS rebinding and
// cross-site requests). Public mode: anyone may read, but writes stay same-origin JSON.
function allowed(req) {
  const host = (req.headers.host || '').toLowerCase();
  if (!PUBLIC && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin;
    if (origin && origin.replace(/^https?:\/\//, '').toLowerCase() !== host) return false;
    if (!/application\/json/.test(req.headers['content-type'] || '')) return false;
  }
  return true;
}

const isAdmin = req => !PUBLIC || (ADMIN_TOKEN && req.headers['x-admin-token'] === ADMIN_TOKEN);

function sseOpen(res) {
  res.on('error', () => {}); // a tab closing mid-stream must not take the server down
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 4000\n\n');
}

let lastPublicRefresh = 0;

// ------------------------------------------------------------------ routes
async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/state' && req.method === 'GET') {
    const days = Math.min(21, Math.max(1, Number(url.searchParams.get('days')) || 8));
    return send(req, res, 200, { meta: meta(), items: store.list({ days }), boards: store.boards, about: about.snapshot(), analysis, sources: scheduler.snapshot(), events: readEvents(), brief: briefer.latest });
  }

  if (p === '/api/stream' && req.method === 'GET') {
    sseOpen(res);
    res.write(`event: hello\ndata: ${JSON.stringify(meta())}\n\n`);
    clients.add(res);
    watchClients();
    req.on('close', () => { clients.delete(res); watchClients(); });
    return;
  }

  // The app's power button (this computer only): stop scanning and quit.
  if (p === '/api/shutdown' && req.method === 'POST') {
    if (PUBLIC) return send(req, res, 403, { error: 'Yayındaki sürüm buradan kapatılamaz.' });
    send(req, res, 200, { ok: true });
    broadcast('bye', {}); // every other open window shows "closed" too
    setTimeout(() => shutdown('Kapat düğmesi'), 300);
    return;
  }

  if (p === '/api/refresh' && req.method === 'POST') {
    if (!isAdmin(req)) {
      if (Date.now() - lastPublicRefresh < 3 * 60e3) return send(req, res, 429, { error: 'Az önce tarandı, birkaç dakika sonra tekrar dene.' });
      lastPublicRefresh = Date.now();
      scheduler.runNow();
      return send(req, res, 202, { ok: true, busy: scheduler.busy });
    }
    const body = await readJson(req);
    const ids = Array.isArray(body.ids) && body.ids.length ? body.ids.map(String) : null;
    scheduler.runNow(ids);
    return send(req, res, 202, { ok: true, busy: scheduler.busy });
  }

  if (p === '/api/settings' && req.method === 'GET') {
    return send(req, res, 200, { ...secrets.flags(), public: PUBLIC, sdk: await sdkInstalled() });
  }

  if (p === '/api/settings' && req.method === 'POST') {
    if (PUBLIC) return send(req, res, 403, { error: 'Yayındaki sürümde ayarlar sunucu ortam değişkenleriyle yapılır.' });
    const body = await readJson(req);
    const hadToken = !!secrets.githubToken;
    secrets.update(body);
    if (!hadToken && secrets.githubToken) scheduler.runNow(['ghsearch']);
    broadcast('meta', meta());
    return send(req, res, 200, { ...secrets.flags(), public: PUBLIC, sdk: await sdkInstalled() });
  }

  if (p === '/api/brief' && req.method === 'GET') {
    return send(req, res, 200, { brief: briefer.latest, running: briefer.running });
  }

  if (p === '/api/brief' && req.method === 'POST') {
    if (!isAdmin(req)) return send(req, res, 403, { error: 'Brifing bu sürümde otomatik hazırlanıyor.' });
    const body = await readJson(req);
    const watchlist = (Array.isArray(body.watchlist) ? body.watchlist : []).map(String).slice(0, 30);
    sseOpen(res);
    const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    broadcast('meta', { ...meta(), brief: { running: true } });
    try {
      emit('start', { at: Date.now() });
      const brief = await briefer.generate(store.list({ days: 2 }), analysis, { watchlist, onDelta: text => emit('delta', { text }) });
      emit('done', { brief });
      broadcast('brief', brief);
    } catch (e) {
      emit('error', { message: e.message, code: e.code || 'ERR' });
    }
    res.end();
    broadcast('meta', meta());
    return;
  }

  if (p.startsWith('/api/')) return send(req, res, 404, { error: 'bulunamadı' });

  // static files
  const rel = decodeURIComponent(p === '/' ? '/index.html' : p);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(req, res, 403, 'yasak', 'text/plain');
  try {
    const buf = await fs.readFile(file);
    return send(req, res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream');
  } catch {
    return send(req, res, 404, 'bulunamadı', 'text/plain; charset=utf-8');
  }
}

function readEvents() {
  const f = path.join(ROOT, 'config', 'events.json');
  if (!existsSync(f)) return [];
  try { return JSON.parse(readFileSync(f, 'utf8')).events || []; } catch { return []; }
}

const startedAt = Date.now();
const server = http.createServer((req, res) => {
  if (!allowed(req)) return send(req, res, 403, { error: 'izin verilmeyen istek' });
  route(req, res).catch(e => {
    if (!res.headersSent) send(req, res, 500, { error: e.message });
    else res.end();
  });
});

function listen(port, attempt = 0) {
  server.once('error', e => {
    if (e.code === 'EADDRINUSE' && attempt < 10 && !PUBLIC) listen(port + 1, attempt + 1);
    else { console.error(e); process.exit(1); }
  });
  server.listen(port, HOST, () => {
    const url = PUBLIC ? `http://${HOST}:${port}` : `http://localhost:${port}`;
    console.log(`\n  ▌SİNYAL ${VERSION}  ·  ses, müzik ve görsel teknoloji haberleri${PUBLIC ? '  ·  YAYIN MODU' : ''}`);
    console.log(`  ▌${jobs.length} kaynak izleniyor  ·  önbellekte ${store.items.size} haber`);
    console.log(`  ▌Panel: ${url}\n`);
    if (process.argv.includes('--open') && !process.env.SINYAL_NO_BROWSER) openBrowser(url);
    if (!process.env.SINYAL_NO_SWEEP) scheduler.start();
    translateSoon();
    aboutSoon();
  });
}

// Opens SİNYAL in its own chromeless app window (Edge ships with Windows) rather than a browser tab.
async function openBrowser(url) {
  const { spawn } = await import('node:child_process');
  const cmd = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', 'msedge', `--app=${url}`, '--window-size=1440,920']]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
}

async function shutdown(reason) {
  console.log(`\n  ▌kapatılıyor${typeof reason === 'string' ? ` (${reason})` : ''}, önbellek kaydediliyor…`);
  try { await store.save(); } catch { /* best effort */ }
  process.exit(0);
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

listen(PORT);
