// Fallback for stories the server has not translated yet: the browser's own
// on-device Translator API (Chrome desktop). Nothing leaves the device.
import { S, needsTranslation } from './model.js';

let state = 'unknown'; // unknown | unavailable | downloadable | available | working
let translator = null;

export const deviceTranslatorState = () => state;

export async function probeDeviceTranslator() {
  if (!('Translator' in self)) return (state = 'unavailable');
  try {
    const a = await self.Translator.availability({ sourceLanguage: 'en', targetLanguage: 'tr' });
    state = a === 'unavailable' ? 'unavailable' : a === 'available' ? 'available' : 'downloadable';
  } catch {
    state = 'unavailable';
  }
  return state;
}

// Translates the given stories in place (S.localTr); onProgress re-renders as it goes.
// A first run may download the language model, which browsers only allow after a click.
export async function translateOnDevice(items, onProgress) {
  if (state === 'unavailable' || state === 'working') return 0;
  const before = state;
  state = 'working';
  onProgress?.();
  let n = 0;
  try {
    translator ||= await self.Translator.create({ sourceLanguage: 'en', targetLanguage: 'tr' });
    for (const it of items) {
      if (!needsTranslation(it)) continue;
      const tr = {};
      if (it.title && !['repo', 'trend', 'model'].includes(it.kind)) tr.t = await translator.translate(it.title);
      if (it.summary) tr.s = await translator.translate(String(it.summary).slice(0, 320));
      S.localTr.set(it.id, tr);
      if (++n % 6 === 0) onProgress?.();
    }
    state = 'available';
  } catch {
    state = before === 'available' ? 'available' : 'downloadable';
  }
  onProgress?.();
  return n;
}
