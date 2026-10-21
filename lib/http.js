// Polite HTTP client: timeouts, retries with backoff, and per-host pacing so
// rate-limited hosts (Reddit, GitHub, arXiv) never see bursts from us.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Sinyal/1.0';

// Minimum gap between request *starts* to the same host, in ms.
const HOST_INTERVAL = {
  'www.reddit.com': 2600,
  'github.com': 700,
  'www.youtube.com': 250,
  'export.arxiv.org': 3500,
  'huggingface.co': 150,
};

const gates = new Map();
export const sleep = ms => new Promise(r => setTimeout(r, ms));

function gate(host) {
  const interval = HOST_INTERVAL[host];
  if (!interval) return Promise.resolve();
  const g = gates.get(host) || { chain: Promise.resolve(), last: 0 };
  const turn = g.chain.then(async () => {
    const wait = g.last + interval - Date.now();
    if (wait > 0) await sleep(wait);
    g.last = Date.now();
  });
  g.chain = turn.catch(() => {});
  gates.set(host, g);
  return turn;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Human-readable (Turkish) reason for the source health panel.
export function describeError(e) {
  if (e instanceof HttpError) {
    if (e.status === 429) return 'HTTP 429 · hız sınırı';
    if (e.status === 403) return 'HTTP 403 · erişim engellendi';
    if (e.status === 404) return 'HTTP 404 · bulunamadı';
    return `HTTP ${e.status}`;
  }
  const code = e?.cause?.code || e?.code || e?.name;
  if (code === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'AbortError') return 'zaman aşımı';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS çözümlenemedi';
  if (code === 'ECONNRESET' || code === 'ECONNREFUSED') return 'bağlantı reddedildi';
  if (e instanceof SyntaxError) return 'yanıt çözümlenemedi';
  return String(e?.message || e).slice(0, 80);
}

export async function request(url, { timeout = 20000, retries = 2, headers = {}, accept = '*/*', method = 'GET', body } = {}) {
  const host = new URL(url).host;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await gate(host);
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method,
        body,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
        headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9', ...headers },
      });
      const text = await res.text();
      if (!res.ok) {
        const err = new HttpError(res.status, `HTTP ${res.status}`);
        err.body = text.slice(0, 500);
        err.headers = res.headers;
        throw err;
      }
      return { text, status: res.status, headers: res.headers, ms: Date.now() - t0, url: res.url };
    } catch (e) {
      lastErr = e;
      const retryable = !(e instanceof HttpError) || e.status === 429 || e.status >= 500;
      if (!retryable || attempt === retries) break;
      await sleep(e.status === 429 ? 4000 * (attempt + 1) : 700 * (attempt + 1) ** 2);
    }
  }
  throw lastErr;
}

export async function getJSON(url, opts = {}) {
  const res = await request(url, { accept: 'application/json', ...opts });
  return { ...res, json: JSON.parse(res.text) };
}
