// Lightweight RSS 2.0 / Atom parser. Feeds in the wild are messy, so this works on
// tolerant regex extraction per <item>/<entry> block rather than a strict XML tree.

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', sbquo: '‚', bdquo: '„', laquo: '«', raquo: '»',
  bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', deg: '°', times: '×', divide: '÷',
  eacute: 'é', egrave: 'è', ecirc: 'ê', aacute: 'á', agrave: 'à', acirc: 'â', iacute: 'í', oacute: 'ó',
  uacute: 'ú', ntilde: 'ñ', ouml: 'ö', uuml: 'ü', auml: 'ä', Ouml: 'Ö', Uuml: 'Ü', Auml: 'Ä', ccedil: 'ç',
  Ccedil: 'Ç', szlig: 'ß', oslash: 'ø', aring: 'å', euro: '€', pound: '£', yen: '¥', cent: '¢',
  prime: '′', Prime: '″', shy: '', zwj: '', zwnj: '', lrm: '', rlm: '', thinsp: ' ', ensp: ' ', emsp: ' ',
  frac12: '½', frac14: '¼', frac34: '¾', micro: 'µ', para: '¶', sect: '§', minus: '−', larr: '←', rarr: '→',
};

export function decodeEntities(s) {
  if (!s || s.indexOf('&') === -1) return s || '';
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}

export const stripCdata = s => (s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

const BOILERPLATE = [
  /The post .{3,300}? appeared first on .{2,120}?\.?$/i,
  /\b(Continue reading|Read more|Read the full (?:story|article))\b.*$/i,
  /\[(?:…|\.\.\.|&hellip;)\]\s*$/,
  /submitted by\s+\/u\/\S+.*$/i,
];

export function htmlToText(html) {
  let s = stripCdata(html || '');
  if (/&lt;\/?[a-z!]/i.test(s)) s = decodeEntities(s); // entity-escaped HTML (common in RSS)
  s = s
    .replace(/<(script|style|noscript|iframe|svg|figcaption)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h\d|tr|blockquote)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s).replace(/\s+/g, ' ').trim();
  for (const re of BOILERPLATE) s = s.replace(re, '').trim();
  return s;
}

export function clip(s, n) {
  if (!s || s.length <= n) return s || '';
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–—-]+$/, '') + '…';
}

const esc = name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function inner(block, name) {
  const m = block.match(new RegExp(`<${esc(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc(name)}>`, 'i'));
  return m ? stripCdata(m[1]).trim() : '';
}

function attrOf(block, name, attr) {
  const m = block.match(new RegExp(`<${esc(name)}\\s[^>]*?\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return m ? decodeEntities(m[1]) : '';
}

function allTags(block, name) {
  return [...block.matchAll(new RegExp(`<${esc(name)}(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${esc(name)}>)`, 'gi'))]
    .map(m => ({ attrs: m[1] || '', body: stripCdata(m[2] || '').trim() }));
}

const attrIn = (attrs, name) => {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? decodeEntities(m[1]) : '';
};

function atomLink(block) {
  const links = allTags(block, 'link').map(l => ({ href: attrIn(l.attrs, 'href'), rel: attrIn(l.attrs, 'rel'), type: attrIn(l.attrs, 'type') }));
  const pick = links.find(l => l.href && (!l.rel || l.rel === 'alternate') && (!l.type || l.type.includes('html'))) || links.find(l => l.href);
  return pick ? pick.href : '';
}

const BAD_IMG = /(feedburner|pixel|tracking|gravatar|emoji|wp-includes|\/smilies\/|1x1|spacer|doubleclick|badge|logo)/i;

function findImage(block, html) {
  const candidates = [
    attrOf(block, 'media:thumbnail', 'url'),
    ...allTags(block, 'media:content')
      .filter(t => /image/.test(attrIn(t.attrs, 'medium') + attrIn(t.attrs, 'type')) || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(attrIn(t.attrs, 'url')))
      .map(t => attrIn(t.attrs, 'url')),
    ...allTags(block, 'enclosure').filter(t => /image/.test(attrIn(t.attrs, 'type'))).map(t => attrIn(t.attrs, 'url')),
  ];
  const decoded = /&lt;img/i.test(html) ? decodeEntities(html) : html;
  for (const m of decoded.matchAll(/<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    if (/\bwidth=["']?1["']?\b/.test(m[0])) continue;
    candidates.push(decodeEntities(m[1]));
  }
  return candidates.find(u => u && /^https?:\/\//.test(u) && !BAD_IMG.test(u)) || '';
}

export function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(s.trim());
  return Number.isFinite(t) ? t : null;
}

// Returns [{ title, link, guid, date, summary, html, author, categories, image, raw }]
export function parseFeed(xml) {
  const text = xml.replace(/^﻿/, '');
  const isAtom = /<feed[\s>]/i.test(text.slice(0, 2000)) && !/<rss[\s>]/i.test(text.slice(0, 2000));
  const blocks = text.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];

  return blocks.map(block => {
    const title = htmlToText(inner(block, 'title'));
    const html = inner(block, 'content:encoded') || inner(block, 'content') || inner(block, 'description') || inner(block, 'summary') || inner(block, 'media:description');
    const summaryHtml = inner(block, 'description') || inner(block, 'summary') || inner(block, 'media:description') || html;
    let link = isAtom ? atomLink(block) : decodeEntities(inner(block, 'link'));
    if (!link) {
      const guid = inner(block, 'guid');
      if (/^https?:\/\//.test(guid)) link = decodeEntities(guid);
    }
    const authorBlock = inner(block, 'author');
    const author = htmlToText(inner(block, 'dc:creator') || (authorBlock.includes('<name') ? inner(authorBlock, 'name') : authorBlock));
    const categories = allTags(block, 'category')
      .map(c => htmlToText(c.body || attrIn(c.attrs, 'label') || attrIn(c.attrs, 'term')))
      .filter(Boolean);
    const date = parseDate(inner(block, 'pubDate') || inner(block, 'published') || inner(block, 'dc:date') || inner(block, 'updated'));
    return {
      title,
      link: link.trim(),
      guid: decodeEntities(inner(block, 'guid') || inner(block, 'id')),
      date,
      summary: htmlToText(summaryHtml),
      html,
      author,
      categories,
      image: findImage(block, html + summaryHtml),
      raw: block,
    };
  });
}

export { inner as xmlInner, attrOf as xmlAttr, allTags as xmlAll };
