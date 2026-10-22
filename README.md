# SİNYAL — Ses, Müzik ve Görsel Teknoloji Haberleri

Ses, müzik ve görsel teknolojilerdeki gelişmeleri **90 kaynaktan** (51 haber sitesi, 29 YouTube kanalı, 18 subreddit, Hacker News, arXiv, Hugging Face, GitHub) toplayan, aynı haberi yazan kaynakları birleştiren, öne çıkanları seçen ve **Türkçeye çeviren** bir haber paneli.

İki şekilde kullanılır:

| | Kendi bilgisayarında | İnternette (arkadaşına link) |
|---|---|---|
| Nasıl açılır | `BASLAT.bat` → kendi uygulama penceresinde açılır | https://deniznevaxr.github.io/sinyal-news/ → **Uygulamayı yükle** |
| Güncelleme | anlık (yeni haber düştüğü an) | ~20 dakikada bir, otomatik |
| Bilgisayarın açık olmalı mı | evet | hayır |
| Kim görebilir | yalnızca sen | linki olan herkes (telefonda da) |

---

## Uygulama olarak yükle (önerilen)

SİNYAL bir web uygulamasıdır: bir kez yükleyince masaüstünde ve Başlat menüsünde kendi simgesiyle durur, adres çubuğu olmadan kendi penceresinde açılır. Haberleri internetten alır; bilgisayarında hiçbir sunucu çalıştırman gerekmez ve son haberler internet yokken de okunabilir.

- **Bilgisayar (Chrome / Edge):** https://deniznevaxr.github.io/sinyal-news/ adresini aç → sayfadaki **Uygulamayı yükle** düğmesine ya da adres çubuğunun sağındaki yükle simgesine bas.
- **Android (Chrome):** adresi aç → Gündem'deki kartta **Yükle**'ye bas (ya da menü ⋮ → **Uygulamayı yükle**).
- **iPhone (Safari):** adresi Safari'de aç → **Paylaş** → **Ana Ekrana Ekle**. Gündem'deki kart adımları gösterir.

Arkadaşına da yalnızca bu adresi göndermen yeterli.

### Telefonda

Telefonda SİNYAL bir telefon uygulaması gibi çalışır:
- Altta **Gündem · Haberler · Videolar · Araçlar · Daha** menüsü bulunur. Makaleler, Topluluk, Kaydedilenler, dil, tema ve ayarlar **Daha**'nın altındadır.
- Haber ayrıntısı, arama ve ayarlar alttan açılan sayfalardır; aşağı kaydırınca kapanırlar.
- Android'de geri hareketi önce açık sayfayı kapatır, sonra Gündem'e döner.
- **Paylaş** düğmesi haberi WhatsApp ve Mesajlar gibi uygulamalarla Türkçe başlığıyla gönderir.
- Okurken üst kısım gizlenerek yer açar.
- Ana ekrandan açınca sayfayı aşağı çekip yenileyebilirsin; uygulamaya her dönüşte haberler de kendiliğinden yenilenir.
- iPhone'un çentiğine ve alt çizgisine uyar, açık ve koyu temada çalışır, açılışta kendi ekranını gösterir.

### Windows uygulaması (.exe)

**İndir:** https://github.com/deniznevaxr/sinyal-news/releases/latest/download/SINYAL-Kurulum.exe (~98 MB). Bu link her zaman en son sürümü indirir; arkadaşına dosya yerine bunu da gönderebilirsin.

Çift tıklayınca birkaç saniyede kurulur, masaüstüne ve Başlat menüsüne **SİNYAL** simgesini ekler ve uygulamayı açar. Yönetici izni istemez; kaldırmak için **Ayarlar → Uygulamalar → SİNYAL → Kaldır**.

- Uygulama, yukarıdaki internet sürümünü kendi penceresinde açar. Haberler ve arayüz güncellemeleri internetten gelir; .exe'yi yeniden göndermen gerekmez.
- Dosya dijital olarak imzalı olmadığı için Windows ilk açılışta “Windows bilgisayarınızı korudu” diyebilir: **Ek bilgi → Yine de çalıştır**. Tarayıcı indirirken uyarırsa **Sakla**'yı seç.
- Dosyayı yeniden üretmek için `desktop` klasöründe `npm install`, ardından `npm run dist` → `desktop/dist/SINYAL-Kurulum-<sürüm>.exe`. Yeni sürümü yayınlarken GitHub'da **Releases → Draft a new release** ile **SINYAL-Kurulum.exe** adıyla yükle; yukarıdaki link bu ad sayesinde hep en son sürümü gösterir.

## 1. Kendi bilgisayarında çalıştır

1. **`BASLAT.bat`** dosyasına çift tıkla (Node.js 18.17+ gerekir; bu bilgisayarda kurulu).
2. SİNYAL ayrı bir uygulama penceresinde açılır. Tarama, görev çubuğunda küçültülmüş bir pencerede çalışır. İlk tarama birkaç dakika sürer; haberler geldikçe ekran dolar.
3. **Kapatmak için** sağ üstteki **⏻ Kapat** düğmesine bas ya da uygulama penceresini kapat. Pencereyi kapatırsan yarım dakika içinde tarama da kendiliğinden durur; arka planda hiçbir şey çalışmaz. Veriler `data/` klasöründe kalır.

Yerel sürümün farkı: haberler 20 dakika beklemeden, düştüğü an gelir ve yapay zekâ özetini istediğin an oluşturabilirsin.

### Bilgisayarım kapalıyken ne olur, bir şey harcar mı?

- **İnternetteki site ve telefondaki uygulama** GitHub'ın sunucularında çalışır. Senin bilgisayarın kapalıyken de link açılır ve haberler yaklaşık 20 dakikada bir güncellenir.
- **Ücret ya da token yok.** GitHub herkese açık projeler için bu hizmeti ücretsiz veriyor, çeviri de ücretsiz bir servisle yapılıyor.
- Claude (Anthropic) API anahtarı eklenmediği sürece hiçbir token harcanmaz. Anahtar yalnızca isteğe bağlı "yapay zekâ özeti" için gerekir.
- **Windows uygulaması (.exe) ve telefona yüklenen uygulama** kapatınca tamamen kapanır; arka planda bir şey bırakmaz.
- **GitHub'daki otomatik güncellemeyi** de durdurmak istersen repoda **Actions** → *SİNYAL — güncelle ve yayınla* → **⋯ → Disable workflow**. Bu durumda site son haliyle kalır.

## 2. İnternette yayınla (arkadaşın linkten açsın)

Site GitHub'ın **GitHub Pages** hizmetinde yayınlanır: https://github.com/deniznevaxr/sinyal-news. GitHub her 20 dakikada bir kaynakları kendi sunucularında tarar, Türkçeye çevirir ve siteyi günceller.

- **Adres:** https://deniznevaxr.github.io/sinyal-news/ — arkadaşına bunu gönder.
- **Elle güncelleme:** repoda **Actions** sekmesi → *SİNYAL — güncelle ve yayınla* → **Run workflow**.
- **Kodda değişiklik yaptıysan:** bu klasörde `git add -A`, `git commit -m "güncelleme"`, `git push` — site birkaç dakika içinde yenilenir.
- Pages ayarı: repoda **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Notlar:
- Repo ve site herkese açıktır; içinde yalnızca kod ve haberler bulunur. `data/` klasörün (önbellek, varsa kaydettiğin API anahtarları) `.gitignore` sayesinde yüklenmez.
- GitHub, 60 gün boyunca repoda hiç değişiklik olmazsa zamanlanmış çalışmayı durdurur. İş akışı bunu önlemek için günde bir kez kendini yeniden etkinleştirir; yine de bir gün GitHub'dan “scheduled workflow disabled” e-postası gelirse **Actions** sekmesinden **Enable workflow** demen yeterli.
- Yayındaki sürümde ziyaretçiler ayarları ve API anahtarlarını göremez veya değiştiremez.

**Anlık güncellenen bir sunucu istersen:** klasördeki `Dockerfile` ile Render, Fly.io veya Hugging Face Spaces (Docker) gibi bir hizmette `server.js` yayın modunda (`PUBLIC=1`) çalışır.

---

## Ekranın parçaları

- **Alanlar:** üstte **Tümü · Ses · Müzik · Görsel**. Her alanın konuları var:
  - **Ses:** Ses yapay zekâsı (TTS, ses klonlama, konuşma tanıma) · Ses teknolojisi (miks, mastering, plugin, uzamsal ses) · Ses donanımı (mikrofon, kulaklık, hoparlör)
  - **Müzik:** Yapay zekâ müzik (Suno, Udio…) · Prodüksiyon & DAW · Synth & enstrüman · Müzik sektörü (streaming, telif, plak şirketleri)
  - **Görsel:** Yapay zekâ görsel (Midjourney, Flux, Stable Diffusion…) · Yapay zekâ video (Sora, Veo, Kling…) · Tasarım & kurgu (Adobe, DaVinci, CapCut…) · 3D & VFX (Blender, Unreal…)
  - Her alanda ayrıca **Fırsatlar** (indirimler, ücretsiz eklentiler).
- **Bölümler:** Gündem · Haberler · Videolar · Araçlar & modeller (GitHub + Hugging Face) · Makaleler · Topluluk (Hacker News + Reddit).
- **“Bu nedir?”:** GitHub projeleri, Hugging Face modelleri ve demolar adlarının altında ne işe yaradıklarını Türkçe olarak söyler.
  - Açıklama, projenin kendi sayfasından alınıp çevrilir.
  - Modellerde ayrıca “Yazılı tariften müzik ya da ses üreten model” gibi sade bir tür etiketi vardır.
  - Ayrıntı ekranında LoRA, MCP, GGUF gibi terimler **Terimler** başlığı altında kısaca açıklanır.
- **Gündem:** günün özeti, *öne çıkanlar* (birden çok kaynağın aynı anda yazdığı haberler), son dakika, en çok konuşulanlar, son videolar; yanda yükselen konular, yeni araçlar ve modeller, takip listen ve yaklaşan etkinlikler.
- **Takip listesi:** marka, model ya da kelime ekle (varsayılan: Suno, ElevenLabs, Udio, Sora, Midjourney). Yeni bir haberde geçtiğinde panelde, istersen masaüstü bildirimiyle ve sesli uyarıyla haber verir.
- **Kaydedilenler:** üstteki yer imi simgesi.

### Türkçe / English

Sağ üstteki **TR / EN** düğmesi arayüzü ve haberleri değiştirir:
- **TR:** başlıklar ve özetler otomatik çeviriyle Türkçe gösterilir. Bir haberi açınca **“Orijinalini göster”** ile İngilizcesine dönebilirsin.
- **EN:** her şey orijinal dilinde.

Çeviri, GitHub'daki güncellemede Google'ın ücretsiz çeviri servisiyle yapılır ve saklanır. Çeviriler otomatiktir; ürün adlarında ara sıra tuhaflıklar olabilir.

- **Bilgisayardaki sürüm (BASLAT.bat)** çevirileri önce yayındaki siteden alır. Google'a yalnızca sitede henüz olmayan yeni haberler için gider. Bazı ağlar Google'a giden bağlantıları bozabiliyor, Google da bir internet adresine geçici sınır koyabiliyor; bu sayede iki durumda da Türkçe gelmeye devam eder.
- Google bir süre yanıt vermezse Chrome tarayıcısının kendi cihaz içi çevirmeni devreye girer (**“Bu cihazda çevir”**).

### Klavye

`1–6` bölümler · `J / K` sonraki / önceki haber · `Enter` haberi aç · `Shift+O` kaynağı yeni sekmede aç · `S` kaydet · `/` veya `Ctrl+K` ara · `L` dil · `T` tema · `Esc` kapat

---

## İsteğe bağlı: yapay zekâ özeti ve daha hızlı GitHub taraması

- **Kendi bilgisayarında:** sağ üstteki **Ayarlar** → *Anthropic API anahtarı* ve *GitHub token*. Anahtarlar yalnızca bu bilgisayarda `data/secrets.json` içinde durur.
- **İnternetteki sürümde:** repoda **Settings → Secrets and variables → Actions → New repository secret** → ad `ANTHROPIC_API_KEY`. Özet her 12 saatte bir otomatik hazırlanır (değiştirmek için iş akışına `BRIEF_AUTO_HOURS` ekle). GitHub taraması için ek token gerekmez.
- Özet, Claude (`claude-opus-5-5`) ile son 24 saatin en güçlü ~80 haberinden Türkçe ve kaynak numaralı yazılır. Her özet yaklaşık 8–12 bin token kullanır (12 saatte bir → günde 2 özet).

## Özelleştirme

- **Kaynak eklemek:** `config/sources.json` → `news` dizisine bir satır:
  ```json
  { "id": "benimblog", "name": "Benim Blogum", "short": "BLOG", "url": "https://ornek.com/feed/", "domain": "music" }
  ```
  `domain`: `audio` (ses), `music` (müzik), `visual` (görsel). Genel teknoloji sitelerinde `"filter": true` yalnızca ilgili yazıları alır. YouTube kanalları, subreddit'ler, GitHub konuları ve izlenen repolar, Hugging Face görevleri de aynı dosyada.
- **Etkinlik takvimi:** `config/events.json` (tarihler organizatör sayfalarından 21.10.2026'da doğrulandı).
- Yerelde değişiklikten sonra sunucuyu yeniden başlat; internetteki sürüm bir sonraki çalıştırmada güncellenir.

## Sorun giderme

| Belirti | Çözüm |
|---|---|
| Bir kaynak çalışmıyor | Ayarlar → Kaynaklar listesinde hata yazar; geçici hatalar birkaç dakika içinde kendiliğinden yeniden denenir. |
| Bazı başlıklar İngilizce kaldı | Çok yeni haberler bir sonraki site güncellemesinde (~20 dk) Türkçeleşir; acelen varsa “Bu cihazda çevir” (Chrome). |
| Reddit “HTTP 429” | Reddit oturumsuz isteklere sıkı sınır koyuyor; bir sonraki turda düzelir. |
| Port meşgul | Sunucu otomatik olarak 4401, 4402… dener; konsolda gerçek adres yazar. |

---

## Mimari (kısaca)

```
server.js            canlı sunucu: zamanlayıcı, çeviri, API, Server-Sent Events (yerel ya da PUBLIC=1 ile yayın)
build.js             statik derleyici: tek seferde tara + çevir + analiz et → dist/ (GitHub Pages için)
lib/adapters.js      RSS/Atom, Hacker News, Reddit, YouTube, arXiv, Hugging Face, GitHub (arama, trend, sürüm)
lib/classify.js      ilgi filtresi, Ses/Müzik/Görsel alanları ve konuları, fırsat tespiti, spam/uygunsuz içerik eleme
lib/analyze.js       yükselen konular, çok kaynaklı haber kümeleri
lib/about.js         “Bu nedir?”: repo, model ve demoların kendi açıklamaları (README, model kartı)
lib/translate.js     Türkçe çeviri (önbellekli, hız sınırına saygılı)
lib/brief.js         isteğe bağlı Claude özeti
public/              arayüz — derleme adımı yok, saf ES modülleri
desktop/             Windows uygulaması: yayındaki siteyi açan Electron kabuğu → SINYAL-Kurulum.exe
config/              kaynak listesi ve etkinlik takvimi
.github/workflows/   GitHub Pages'e otomatik yayın
```
