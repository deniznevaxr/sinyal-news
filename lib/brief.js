// Optional AI brief: Claude reads the strongest items of the last 24 hours and
// writes a Turkish, action-oriented daily brief covering sound, music and visual
// technology. Needs an Anthropic API key and the @anthropic-ai/sdk package
// (installed by BASLAT.bat / `npm install`).
import { promises as fs, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const MODEL = 'claude-opus-5-5';
const DAY = 86400e3;

const DOMAIN_TR = { audio: 'ses', music: 'müzik', visual: 'görsel' };
const TOPIC_TR = {
  voice: 'ses yapay zekâsı', audiotech: 'ses teknolojisi', audiogear: 'ses donanımı',
  musicai: 'yapay zekâ müzik', production: 'prodüksiyon', instruments: 'synth ve enstrüman', industry: 'müzik sektörü',
  imageai: 'yapay zekâ görsel', videoai: 'yapay zekâ video', design: 'tasarım ve kurgu', '3d': '3D ve VFX',
};

let sdk = null;
async function loadSdk() {
  if (sdk) return sdk;
  try {
    sdk = (await import('@anthropic-ai/sdk')).default;
  } catch {
    sdk = null;
  }
  return sdk;
}

export async function sdkInstalled() {
  return !!(await loadSdk());
}

const SYSTEM = `Sen SİNYAL'in baş editörüsün. SİNYAL; ses, müzik ve görsel teknolojilerdeki gelişmeleri onlarca kaynaktan (haber siteleri, GitHub, Hugging Face, arXiv, Hacker News, Reddit, YouTube) canlı toplayan bir haber panelidir.

Okuyucun bu alanları yakından takip eden bir içerik üreticisi: müzik prodüksiyonu, yapay zekâ ile ses/müzik/görsel/video üretimi, tasarım ve kurgu araçları ile sektör gelişmeleriyle ilgileniyor. Önemli hiçbir gelişmeyi kaçırmak istemiyor ve zamanı kısıtlı.

Görevin: sana verilen numaralı haber listesinden Türkçe, sade, yoğun ve eyleme dönük bir günlük brifing yazmak.

Kurallar:
- Yalnızca listedeki bilgilere dayan. Listede olmayan ayrıntı, rakam veya tarih ekleme; bir başlık belirsizse bunu söyle.
- Her iddianın sonunda kaynağını [#numara] biçiminde göster; birden çok kaynak varsa [#3, #12].
- Ürün, model, şirket ve kişi adlarını orijinal yazımıyla bırak.
- Aynı olayı anlatan birden çok haberi tek maddede birleştir.
- Kısa cümleler kur; jargonu gerekirse bir iki kelimeyle açıkla.
- Biçim (Markdown, başlıklar ## ile):
  ## Bugünün özeti — 2-3 cümle, günün ana teması.
  ## Öne çıkanlar — en önemli 5-7 gelişme. Her madde: **kısa kalın başlık** — ne oldu + neden önemli (1-2 cümle).
  ## Ses
  ## Müzik
  ## Görsel
  ## Takip et — önümüzdeki günlerde izlenecek 3 somut şey.
- Listede karşılığı olmayan bölümü tamamen atla. Dolgu cümlesi yazma.`;

export class Briefer {
  constructor(dir, secrets) {
    this.dir = dir;
    this.file = path.join(dir, 'brief.json');
    this.secrets = secrets;
    this.running = false;
    this.latest = null;
    if (existsSync(this.file)) {
      try { this.latest = JSON.parse(readFileSync(this.file, 'utf8')); } catch { this.latest = null; }
    }
  }

  // Strongest items of the last 24h, scored the way the UI scores them, balanced across topics.
  select(items, analysis, now = Date.now()) {
    const clusterOf = new Map();
    for (const c of analysis?.clusters || []) for (const id of c.ids) clusterOf.set(id, c);
    const ranked = items
      .filter(i => now - i.published < DAY && i.kind !== 'trend')
      .map(i => {
        const c = clusterOf.get(i.id);
        const heat = Math.min(1, (i.eng || 0.4) + (c ? Math.min(0.45, 0.18 * (c.sources - 1)) : 0));
        const recency = Math.exp(-(now - i.published) / 3.6e6 / 20);
        return { i, c, s: (0.45 * recency + 0.55 * heat) * (0.75 + 0.25 * (i.weight || 1)) };
      })
      .sort((a, b) => b.s - a.s);
    const out = [];
    const perTopic = new Map();
    const seenCluster = new Set();
    for (const { i, c } of ranked) {
      if (c && seenCluster.has(c.id)) continue;
      const key = i.topic || i.domains?.[0] || 'other';
      if ((perTopic.get(key) || 0) >= 10) continue; // keep the brief balanced
      if (c) seenCluster.add(c.id);
      perTopic.set(key, (perTopic.get(key) || 0) + 1);
      out.push({ item: i, coverage: c ? c.sourceNames : null });
      if (out.length >= 80) break;
    }
    return out;
  }

  buildPrompt(selected, { watchlist = [], now = Date.now() }) {
    const lines = selected.map(({ item: i, coverage }, n) => {
      const ageH = Math.max(0, Math.round((now - i.published) / 3.6e6));
      const m = i.metrics || {};
      const stats = [m.points && `${m.points} HN puanı`, m.stars && `${m.stars}★`, m.starsPeriod && `+${m.starsPeriod}★`, m.upvotes && `${m.upvotes} oy`, m.views && `${m.views} izlenme`, m.trending && `HF trend ${m.trending}`].filter(Boolean).join(', ');
      const where = [(i.domains || []).map(d => DOMAIN_TR[d]).join('/'), TOPIC_TR[i.topic]].filter(Boolean).join(' · ');
      const cov = coverage && coverage.length > 1 ? ` · ${coverage.length} kaynakta: ${coverage.join(', ')}` : '';
      return `#${n + 1} [${i.sourceName} · ${where || 'genel'} · ${ageH} sa önce${stats ? ' · ' + stats : ''}${cov}]\n${i.title}\n${(i.summary || '').slice(0, 280)}`;
    });
    const profile = this.secrets.profile ? `\nOkuyucu kendini şöyle tanımlıyor: "${this.secrets.profile}". Brifingi buna göre önceliklendir.` : '';
    const watch = watchlist.length ? `\nOkuyucunun takip listesi: ${watchlist.join(', ')}. Bunlarla ilgili haber varsa öne çıkar.` : '';
    const date = new Date(now).toLocaleString('tr-TR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
    return `Tarih: ${date} (İstanbul saati).${profile}${watch}\n\nSon 24 saatin en güçlü ${lines.length} haberi:\n\n${lines.join('\n\n')}`;
  }

  isStale(hours) {
    return !this.latest?.createdAt || Date.now() - this.latest.createdAt > hours * 3600e3;
  }

  // Streams the brief: onDelta(text) per chunk; resolves with the saved brief.
  async generate(items, analysis, { watchlist = [], onDelta = () => {} } = {}) {
    const key = this.secrets.anthropicKey;
    if (!key) throw Object.assign(new Error('Anthropic API anahtarı tanımlı değil.'), { code: 'NO_KEY' });
    const Anthropic = await loadSdk();
    if (!Anthropic) throw Object.assign(new Error('@anthropic-ai/sdk paketi kurulu değil. Proje klasöründe "npm install" çalıştır (BASLAT.bat bunu otomatik yapar).'), { code: 'NO_SDK' });
    if (this.running) throw Object.assign(new Error('Bir brifing zaten hazırlanıyor.'), { code: 'BUSY' });

    const now = Date.now();
    const selected = this.select(items, analysis, now);
    if (selected.length < 5) throw Object.assign(new Error('Son 24 saatte brifing için yeterli haber yok; tarama bitince tekrar dene.'), { code: 'EMPTY' });

    this.running = true;
    try {
      const client = new Anthropic({ apiKey: key });
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: SYSTEM,
        messages: [{ role: 'user', content: this.buildPrompt(selected, { watchlist, now }) }],
      });
      stream.on('text', delta => onDelta(delta));
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') {
        throw Object.assign(new Error('Model bu isteği yanıtlamayı reddetti. Biraz sonra tekrar dene.'), { code: 'REFUSAL' });
      }
      const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      const brief = {
        createdAt: now,
        model: message.model,
        text,
        refs: selected.map(({ item }) => ({ id: item.id, title: item.title, url: item.url, source: item.sourceName })),
        usage: { input: message.usage?.input_tokens || 0, output: message.usage?.output_tokens || 0 },
        truncated: message.stop_reason === 'max_tokens',
      };
      this.latest = brief;
      await fs.mkdir(this.dir, { recursive: true });
      await fs.writeFile(this.file, JSON.stringify(brief));
      return brief;
    } catch (e) {
      if (e.code) throw e;
      throw Object.assign(new Error(describeApiError(Anthropic, e)), { code: 'API' });
    } finally {
      this.running = false;
    }
  }
}

function describeApiError(Anthropic, e) {
  if (e instanceof Anthropic.AuthenticationError) return 'API anahtarı geçersiz (401). Ayarlardan kontrol et.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Bu anahtarın modele erişim izni yok (403).';
  if (e instanceof Anthropic.RateLimitError) return 'Hız sınırına takıldı (429). Bir dakika sonra tekrar dene.';
  if (e instanceof Anthropic.BadRequestError) return `İstek reddedildi (400): ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Anthropic API’ye bağlanılamadı. İnternet bağlantını kontrol et.';
  if (e instanceof Anthropic.APIError) return `API hatası ${e.status ?? ''}: ${e.message}`;
  return String(e?.message || e);
}
