// Small DOM, storage and text helpers shared by every module (language-neutral).

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const MIN = 6e4;
export const HOUR = 36e5;
export const DAY = 864e5;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
// Everything that comes from a feed is untrusted: escape before it touches innerHTML.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

// Only absolute http(s) links from feeds are allowed; anything else (empty, relative, javascript:) is dropped.
export function safeUrl(u) {
  if (!u || typeof u !== 'string') return '';
  try {
    const x = new URL(u);
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '';
  } catch {
    return '';
  }
}

export function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// localStorage can be missing or throw (private mode, blocked storage): never let it break the UI.
export const storage = {
  get(k, def) {
    try {
      const v = localStorage.getItem(`sinyal.${k}`);
      return v == null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(k, v) {
    try { localStorage.setItem(`sinyal.${k}`, JSON.stringify(v)); } catch { /* ignore */ }
  },
};

export const reEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Word-ish match that also respects Turkish letters (JS \b is ASCII only).
export function termRegex(term, flags = 'iu') {
  return new RegExp(`(?<![\\p{L}\\p{N}])${reEscape(term.trim()).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, flags);
}

// Escape text and wrap matches of any term in <mark> — one pass, so inserted tags are never re-matched.
export function highlight(text, terms) {
  const safe = esc(text);
  const list = (terms || []).map(t => (t || '').trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!list.length) return safe;
  const alt = list.map(t => reEscape(esc(t)).replace(/\s+/g, '\\s+')).join('|');
  return safe.replace(new RegExp(`(?<![\\p{L}\\p{N}&#])(?:${alt})(?![\\p{L}\\p{N};])`, 'giu'), m => `<mark>${m}</mark>`);
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  return Promise.resolve();
}

export const translateUrl = (u, tl = 'tr') => `https://translate.google.com/translate?sl=auto&tl=${tl}&u=${encodeURIComponent(u)}`;
