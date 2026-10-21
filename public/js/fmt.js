// Language-aware formatting: relative times, dates and numbers.
import { t, lang } from './i18n.js';
import { MIN, HOUR, DAY } from './util.js';

const locale = () => (lang === 'en' ? 'en-GB' : 'tr-TR');

// Compact relative time for dense lists: "şimdi", "8 dk", "3 sa", "2 g", "14 Eki".
export function ago(ts, now = Date.now()) {
  const d = Math.max(0, now - ts);
  if (d < MIN) return t('time.now');
  if (d < HOUR) return t('time.m', { n: Math.floor(d / MIN) });
  if (d < DAY) return t('time.h', { n: Math.floor(d / HOUR) });
  if (d < 7 * DAY) return t('time.d', { n: Math.floor(d / DAY) });
  return dayMonth(ts);
}

export function agoLong(ts, now = Date.now()) {
  const d = Math.max(0, now - ts);
  if (d < MIN) return t('time.now');
  if (d < HOUR) return t('time.minutesAgo', { n: Math.floor(d / MIN) });
  if (d < DAY) return t('time.hoursAgo', { n: Math.floor(d / HOUR) });
  if (d < 2 * DAY) return t('time.yesterday');
  if (d < 7 * DAY) return t('time.daysAgo', { n: Math.floor(d / DAY) });
  return dayMonth(ts, true);
}

export const dayMonth = (ts, year = false) =>
  new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });

export const fullDate = ts =>
  new Date(ts).toLocaleString(locale(), { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const num = n => new Intl.NumberFormat(locale()).format(n || 0);
export const compact = n => (Math.abs(n) < 10000 ? num(n) : new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n));
