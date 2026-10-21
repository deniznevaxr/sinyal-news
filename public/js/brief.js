// "Günün özeti": a plain-language local summary that always works, plus the optional
// Claude-written Turkish brief (streamed live in local mode, prepared automatically online).
import { $, esc, copyText, DAY } from './util.js';
import { t } from './i18n.js';
import { agoLong } from './fmt.js';
import { S, TOPIC_DOMAIN, visible, titleOf } from './model.js';
import { icon, toast } from './ui.js';

let streaming = null; // { text } while a brief is being written
let expanded = false;

export function briefBlock() {
  return `<section class="brief" id="brief-block">${briefInner()}</section>`;
}

export function refreshBrief() {
  const el = $('#brief-block');
  if (el) el.innerHTML = briefInner();
}

export const toggleBrief = () => { expanded = !expanded; refreshBrief(); };

function localLine() {
  const now = Date.now();
  const counts = {};
  let n = 0;
  for (const it of S.list) {
    if (now - it.published > DAY) break;
    if (it.kind === 'trend' || !visible(it)) continue;
    n++;
    if (it.topic) counts[it.topic] = (counts[it.topic] || 0) + 1;
  }
  const [topTopic] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [];
  const story = (S.analysis.clusters || []).find(c => { const lead = S.items.get(c.lead); return lead && visible(lead); });
  const lead = story ? S.items.get(story.lead) : null;
  return `<p class="brief-local">${esc(t('brief.local', { n, topic: '§T§', story: '§S§' }))
    .replace('§T§', topTopic ? `<b>${esc(t(`topic.${topTopic}`))}</b>` : '—')
    .replace('§S§', lead ? `<a href="#" data-action="open" data-id="${esc(lead.id)}"><b>${esc(titleOf(lead))}</b></a>` : '—')}</p>`;
}

function briefInner() {
  const st = S.settings || {};
  const b = S.brief;
  const pub = S.mode === 'static' || st.public;
  const canGenerate = !pub && st.anthropic && st.sdk;
  let body, actions = '', sub = '';

  if (streaming) {
    body = `<div class="brief-text">${md(streaming.text, null)}<span class="cursor"></span></div>`;
    sub = t('brief.writing');
  } else if (b?.text) {
    body = `<div class="brief-text${expanded ? '' : ' clamped'}">${md(b.text, b.refs)}</div>`;
    sub = t('brief.by', { t: agoLong(b.createdAt) });
    actions = `<button class="btn sm" type="button" data-action="brief-toggle">${esc(expanded ? t('act.readLess') : t('act.readMore'))}</button>
      <button class="btn sm ghost" type="button" data-action="brief-copy">${icon('copy')}${esc(t('brief.copy'))}</button>
      ${canGenerate ? `<button class="btn sm ghost" type="button" data-action="brief-generate">${icon('bolt')}${esc(t('brief.regen'))}</button>` : ''}`;
  } else {
    body = localLine();
    if (canGenerate) actions = `<button class="btn sm primary" type="button" data-action="brief-generate">${icon('bolt')}${esc(t('brief.generate'))}</button><span class="brief-note">${esc(t('brief.turkishOnly'))}</span>`;
    else if (!pub && st.anthropic && !st.sdk) actions = `<span class="brief-note">${esc(t('brief.needSdk'))}</span>`;
    else if (!pub && st && !st.anthropic) actions = `<span class="brief-note">${esc(t('brief.needKey'))}</span>`;
  }
  return `<div class="brief-head"><h2 class="block-title">${esc(t('brief.title'))}</h2>${sub ? `<span class="brief-sub">${esc(sub)}</span>` : ''}</div>
    ${b?.text || streaming ? '' : ''}${body}${actions ? `<div class="brief-actions">${actions}</div>` : ''}`;
}

// Minimal, safe Markdown: text is escaped first, then a handful of patterns are re-enabled.
export function md(text, refs) {
  const inline = s => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[(#\d+(?:\s*,\s*#\d+)*)\]/g, (_, group) => group.split(/\s*,\s*/).map(r => {
      const n = Number(r.slice(1));
      const ref = refs?.[n - 1];
      return ref ? `<a class="ref" data-action="open" data-id="${esc(ref.id)}" title="${esc(ref.source)}: ${esc(ref.title)}">${n}</a>` : `<span class="ref">${n}</span>`;
    }).join(''));
  const lines = esc(text).split('\n');
  let html = '', list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{1,4}\s/.test(line)) { close(); html += `<h3>${inline(line.replace(/^#{1,4}\s+/, ''))}</h3>`; continue; }
    const li = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if (li) {
      const type = /^\s*\d+\./.test(line) ? 'ol' : 'ul';
      if (list !== type) { close(); html += `<${type}>`; list = type; }
      html += `<li>${inline(li[1])}</li>`;
      continue;
    }
    if (!line.trim()) { close(); continue; }
    close();
    html += `<p>${inline(line)}</p>`;
  }
  close();
  return html;
}

export async function generateBrief() {
  if (streaming) return;
  streaming = { text: '' };
  expanded = true;
  refreshBrief();
  let paint = 0;
  try {
    const res = await fetch('api/brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ watchlist: S.watch }) });
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = (chunk.match(/^event: (.+)$/m) || [])[1];
        const data = (chunk.match(/^data: (.+)$/m) || [])[1];
        if (!event || !data) continue;
        const payload = JSON.parse(data);
        if (event === 'delta') {
          streaming.text += payload.text;
          if (Date.now() - paint > 90) { paint = Date.now(); refreshBrief(); }
        } else if (event === 'done') {
          S.brief = payload.brief;
        } else if (event === 'error') {
          throw new Error(payload.message);
        }
      }
    }
  } catch (e) {
    toast(t('toast.briefFail'), e.message, { bad: true, ttl: 9000 });
  } finally {
    streaming = null;
    refreshBrief();
  }
}

export function copyBrief() {
  if (!S.brief?.text) return;
  const refs = S.brief.refs || [];
  const text = S.brief.text.replace(/\[(#\d+(?:\s*,\s*#\d+)*)\]/g, (_, g) => g.split(/\s*,\s*/).map(r => {
    const ref = refs[Number(r.slice(1)) - 1];
    return ref ? `[${r.slice(1)}](${ref.url})` : r;
  }).join(' '));
  copyText(`# SİNYAL · ${t('brief.title')} — ${new Date(S.brief.createdAt).toLocaleDateString('tr-TR', { dateStyle: 'long' })}\n\n${text}\n`)
    .then(() => toast(t('toast.copied')));
}

export { TOPIC_DOMAIN };
