// Header chrome: field tabs, section tabs, language switch and the live status line.
import { $, $$, esc } from './util.js';
import { t, lang } from './i18n.js';
import { agoLong } from './fmt.js';
import { S, DOMAINS, SECTIONS, isNew, inDomain } from './model.js';

export function renderChrome() {
  $('#tagline').textContent = t('tagline');
  $('#search-btn span').textContent = t('search.button');
  $('#saved-btn').setAttribute('aria-label', t('section.saved'));
  $('#theme-btn').setAttribute('aria-label', t('settings.theme'));
  $('#settings-btn').setAttribute('aria-label', t('settings.title'));
  for (const b of $$('.lang button')) b.setAttribute('aria-pressed', String(b.dataset.v === lang));
  renderDomains();
  renderSections();
  renderStatus();
  renderSavedBadge();
}

export function renderDomains() {
  $('#domains').innerHTML = ['all', ...DOMAINS].map(d => `
    <button class="domain-btn" type="button" data-action="domain" data-v="${d}" aria-pressed="${S.domain === d}">
      ${d === 'all' ? '' : `<span class="dot d-${d}"></span>`}${esc(t(`domain.${d}`))}
    </button>`).join('');
}

export function renderSections() {
  let fresh = 0;
  for (const it of S.list) if (isNew(it) && !S.read.has(it.id) && inDomain(it)) fresh++;
  $('#sections').innerHTML = SECTIONS.map(s => {
    const count = s === 'news' && fresh ? `<span class="count hot">${fresh > 99 ? '99+' : fresh}</span>` : '';
    return `<button class="section-btn" type="button" data-action="section" data-v="${s}" ${S.section === s ? 'aria-current="page"' : ''}>${esc(t(`section.${s}`))}${count}</button>`;
  }).join('');
}

export function renderSavedBadge() {
  const btn = $('#saved-btn');
  btn.querySelector('.badge')?.remove();
  if (S.saved.size) btn.insertAdjacentHTML('beforeend', `<span class="badge">${S.saved.size > 99 ? '99+' : S.saved.size}</span>`);
  btn.toggleAttribute('aria-current', S.section === 'saved');
}

export function renderStatus() {
  const el = $('#status');
  const text = el.querySelector('.status-text');
  if (S.mode === 'static') {
    el.dataset.state = 'live';
    text.textContent = t('status.static', { t: S.meta.generatedAt ? agoLong(S.meta.generatedAt) : '—' });
    return;
  }
  const { active, queued } = S.busy;
  if (S.connected !== 'live') {
    el.dataset.state = S.connected === 'offline' ? 'offline' : 'retry';
    text.textContent = t('status.offline');
    return;
  }
  if (active + queued > 0) {
    el.dataset.state = 'busy';
    text.textContent = t('status.updating');
    return;
  }
  el.dataset.state = 'live';
  const last = Math.max(0, ...S.sources.map(s => s.lastOk || 0));
  text.textContent = `${t('status.live')} · ${last ? t('status.updated', { t: agoLong(last) }) : ''}`;
}
