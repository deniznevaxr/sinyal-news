// Relevance filtering, domain/topic routing, flags, spam detection and entity matching.
// Everything is keyword based so it runs offline and instantly.
//
// Taxonomy: three domains (audio / music / visual), each with a few topics. An item
// gets one primary topic plus up to two secondary ones, and every domain those touch.

// ---------- Relevance ----------------------------------------------------------
// STRONG terms make a headline relevant on their own; WEAK terms only count when
// backed by other evidence (they are common figurative words: "sounds good").
const SPEECH = 'speech (?:recognition|synthesis|models?|ai|to[- ](?:text|speech)|generation|data(?:sets?)?|enhancement|translation|tech\\w*|interfaces?|agents?)|text[- ]to[- ]speech|speech[- ]to[- ]text|spoken language';
const AUDIO_MUSIC_STRONG = new RegExp(`\\b(audio\\w*|music\\w*|musician\\w*|songs?|songwrit\\w*|singers?|singing|vocals|${SPEECH}|text[- ]to[- ](?:music|audio|song)|tts|asr|voice[- ]?(?:ai|agents?|clon\\w*|models?|synth\\w*|chang\\w*|assistants?|mode|actors?|over\\w*|generat\\w*|design|conversion|cloning)|synths?|synthesi[sz]ers?|(?:sound|audio|vocal) synthesis|midi|daws?|vsts?3?|vsti|audio plug-?ins?|podcast\\w*|spotify|soundcloud|bandcamp|deezer|suno|udio|eleven ?labs|stable audio|musicgen|lyria|headphones?|earbuds?|airpods|loudspeakers?|smart speakers?|soundbars?|microphones?|acoustic\\w*|dolby|atmos|spatial audio|hearing aids?|karaoke|beatmak\\w*|drum machines?|samplers?|guitars?|pianos?|ableton|logic pro|fl studio|pro tools|transcri(?:be|bes|bing|ption|ptions)|dubbing|audiobooks?|soundtracks?|soundscapes?|sound design|noise[- ]cancel\\w*|stem separation|source separation|vocoders?|eurorack|record labels?)\\b`, 'i');
const VISUAL_STRONG = /\b(image generat\w*|video generat\w*|text[- ]to[- ](?:image|video|3d)|image[- ]to[- ](?:video|3d|image)|ai[- ](?:images?|video|art|artwork|filmmaking|animation)|generative (?:video|image)|midjourney|stable diffusion|sdxl|flux(?:\.\d|[- ]\d|[- ](?:dev|pro|schnell|kontext|klein))|black forest labs|dall-?e|imagen \d|gpt-image|ideogram|recraft|krea ai|firefly|nano banana|seedream|qwen-image|hidream|sora|veo \d|runway(?:ml)?|kling|pika labs|luma ai|dream machine|hailuo|seedance|hunyuanvideo|ltx-?(?:video|\d)|wan ?2\.\d|comfyui|controlnet|inpainting|ai upscal\w*|photoshop|lightroom|premiere pro|after effects|davinci resolve|final cut|capcut|figma|canva|procreate|blender|unreal engine|houdini|cinema 4d|zbrush|gaussian splat\w*|nerfstudio|neural radiance fields?|vfx|visual effects|motion graphics|motion design|3d (?:model\w*|generat\w*|animation|scan\w*)|video edit\w*|colou?r grading|graphic design|cinematograph\w*|filmmak\w*)\b/i;
const WEAK = /\b(sound|sounds|voice|voices|vocal|speaker|speakers|whisper|tidal|beat|beats|noise|hearing|stems?|mixing|mastering|record|recording|studio|listen\w*|ears?|loud\w*|tone|pitch|rhythm|melod\w*|tune|tunes|radio|concert|album|artist|artists|label|labels|band|bands|image|images|video|videos|photo\w*|camera\w*|design\w*|render\w*|visual\w*|art|artwork|film\w*|movie\w*|creative|creator\w*)\b/gi;

const count = (re, s) => (s.match(new RegExp(re.source, 'gi')) || []).length;
const strong = s => count(AUDIO_MUSIC_STRONG, s) + count(VISUAL_STRONG, s);

export function isRelevant(title, summary = '') {
  if (AUDIO_MUSIC_STRONG.test(title) || VISUAL_STRONG.test(title)) return true;
  const weakTitle = count(WEAK, title);
  const strongBody = strong(summary);
  if (weakTitle >= 1 && strongBody >= 1) return true;
  if (strongBody >= 2 && weakTitle + count(WEAK, summary) >= 1) return true;
  return false;
}
// Kept for older call sites.
export const isAudioRelevant = isRelevant;

// ---------- Domains & topics -----------------------------------------------------
export const DOMAINS = ['audio', 'music', 'visual'];

export const TOPICS = {
  voice: 'audio', audiotech: 'audio', audiogear: 'audio',
  musicai: 'music', production: 'music', instruments: 'music', industry: 'music',
  imageai: 'visual', videoai: 'visual', design: 'visual', '3d': 'visual',
};

const RULES = {
  musicai: /\b(suno|udio|ai[- ](?:music|songs?|tracks?|artists?|bands?|singers?|covers?|generated (?:music|songs?|tracks?)|slop)|music (?:generat\w*|models?|ai)|song generat\w*|text[- ]to[- ](?:music|song)|lyria|musicgen|stable audio|audiocraft|riffusion|mubert|aiva|soundraw|beatoven|mureka|minimax[- ]music|yue2?|ace-?step|diffrhythm|songgen|generative music)\b/i,
  voice: new RegExp(`\\b(tts|${SPEECH}|asr|stt|transcri(?:be|bes|bing|ption|ptions)|voice[- ]?(?:ai|agents?|clon\\w*|models?|synth\\w*|chang\\w*|assistants?|mode|actors?|over\\w*|generat\\w*|design|conversion)|vocal clon\\w*|dubbing|lip[- ]?sync|whisper(?:x|\\.cpp)?|diari[sz]ation|speaker (?:recognition|verification|diari[sz]ation)|kokoro|f5-?tts|xtts|piper tts|cosyvoice|fish ?speech|fish audio|chatterbox|orpheus|sesame|moshi|vibevoice|chattts|index-?tts|voxcpm|eleven ?labs|audiobooks?|narrat(?:or|ors|ion))\\b`, 'i'),
  videoai: /\b(video generat\w*|text[- ]to[- ]video|image[- ]to[- ]video|ai[- ]videos?|ai filmmaking|generative video|sora|veo(?: \d)?|runway(?:ml)?|gen-[345]|kling|pika(?: labs)?|luma (?:ai|ray)|dream machine|hailuo|seedance|vidu|higgsfield|hunyuanvideo|ltx-?(?:video|\d)|wan ?2\.\d|heygen|synthesia|ai avatars?)\b/i,
  imageai: /\b(image generat\w*|text[- ]to[- ]image|image[- ]to[- ]image|ai[- ](?:images?|art|artwork|illustrations?)|generative (?:image|art)|midjourney|stable diffusion|sdxl|sd ?3(?:\.5)?|flux(?:\.\d|[- ]\d|[- ](?:dev|pro|schnell|kontext|klein))|black forest labs|dall-?e|imagen(?: \d)?|gpt-image|ideogram|recraft|krea ai|leonardo ai|firefly|nano banana|seedream|qwen-image|hidream|comfyui|automatic1111|invokeai|fooocus|controlnet|(?:sdxl|flux|image|style|character) loras?|inpainting|outpainting|upscal(?:e|er|ers|ing)|background remov\w*)\b/i,
  instruments: /\b(synths?|synthesi[sz]ers?|drum machines?|grooveboxe?s?|samplers?|sequencers?|eurorack|modular synth\w*|modular (?:system|case|rack|format|patch\w*)|midi controllers?|keyboard controllers?|pianos?|guitars?|bass guitars?|guitar pedals?|effects? pedals?|pedals?|stompboxe?s?|amp sims?|moog|korg|roland|yamaha|elektron|teenage engineering|op-1|op-xy|op-z|novation|akai|mpc|maschine|behringer|arturia|oberheim|sequential (?:prophet|take|pro)|prophet-?\d+|polyend|make noise|intellijel|erica synths|nord (?:lead|stage|electro|wave)|dreadbox|fender|gibson|strymon|chase bliss|eventide|kemper|neural dsp|quad cortex|line 6|wavetable synth\w*|analog synth\w*)\b/i,
  production: /\b(daws?|ableton|live 1[2-4]|push 3|logic pro|fl studio|pro tools|cubase|nuendo|bitwig|reaper|studio one|fender studio|garageband|reason studios|renoise|tracktion|max for live|sample (?:librar(?:y|ies)|packs?)|(?:drum|audio|sample|music|vocal|guitar) loops?|loop packs?|kontakt|serum|vital synth|splice|beatmak\w*|music production|music producers?|songwriting|virtual instruments?|softsynths?|synth presets?|preset packs?|soundbanks?|vsti)\b/i,
  audiotech: /\b((?:audio|vst3?|au|aax|clap|reverb|delay|eq|compressor|limiter|synth|effects?|mixing|mastering|vocal) plug-?ins?|plug-?ins? for (?:audio|music|mixing|mastering)|vsts?3?|aax|lv2|audio units?|dsp (?:chips?|plug-?ins?|effects?|algorithms?|processing)|digital signal processing|reverbs?|compressors?|limiters?|eqs?|equali[sz]ers?|saturat(?:ion|or)|distortion|chorus|flanger|phaser|vocoders?|pitch[- ]correct\w*|auto-?tune|melodyne|mixing|mastering|loudness|noise (?:reduction|removal)|denois\w*|audio restoration|stem separation|source separation|spatial audio|dolby atmos|atmos|binaural|ambisonics?|immersive audio|audio codecs?|lossless (?:audio|music|streaming)|hi-?res audio|izotope|fabfilter|soundtoys|valhalla|waves (?:audio|plugins?)|acoustics|room correction|sound design|foley|audacity|channel strip|tape emulation)\b/i,
  audiogear: /\b(microphones?|mics?|audio interfaces?|preamps?|studio monitors?|headphones?|earbuds?|iems?|airpods|loudspeakers?|(?:bluetooth|smart|wireless|studio|bookshelf|portable|computer|desktop|floorstanding|party|surround) speakers?|soundbars?|dacs?|(?:headphone|stereo|integrated|power) amp(?:lifier)?s?|turntables?|hearing aids?|noise[- ]cancel\w*|bluetooth audio|le audio|auracast|focusrite|rme|apogee|universal audio|uad|apollo (?:twin|x\d|solo)|neumann|shure|sennheiser|audio-technica|røde|genelec|adam audio|sonos|bose|jbl|bang & olufsen|beyerdynamic|audeze)\b/i,
  '3d': /\b(blender|unreal engine|unreal|unity (?:engine|6|technologies)|houdini|cinema 4d|c4d|autodesk maya|maya \d{4}|3ds max|zbrush|substance (?:painter|designer|3d)|gaussian splat\w*|nerfstudio|neural radiance fields?|3d (?:model\w*|generat\w*|animation|printing|scan\w*|assets?|artists?)|renderers?|render engines?|octane|redshift|v-?ray|vfx|visual effects|cgi|motion capture|mocap|virtual production|game art|grease pencil)\b/i,
  design: /\b(photoshop|lightroom|illustrator|premiere(?: pro)?|after effects|indesign|adobe|creative cloud|davinci resolve|final cut|capcut|figma|canva|affinity (?:photo|designer|publisher)|procreate|gimp|krita|inkscape|obs studio|colou?r grading|video edit\w*|editing software|motion graphics|motion design|typography|graphic design|ui design|thumbnails?|illustrations?|cameras?|lenses|mirrorless|cinema camera|filmmak\w*|cinematograph\w*|photograph\w*|animat(?:ion|ed|or|ors))\b/i,
  // Music-business vocabulary only: generic "funding" or "CEO" news is not the music industry.
  industry: /\b(spotify|apple music|youtube music|amazon music|deezer|soundcloud|bandcamp|tiktok music|music streaming|streaming (?:services?|platforms?|royalt\w*|payouts?)|royalt(?:y|ies)|(?:music|song|songwriter|artist|sync|master|publishing) (?:rights|licens\w*|catalog\w*|deals?)|(?:record|major|indie|music) labels?|label groups?|umg|universal music|sony music|warner music|wmg|riaa|ifpi|gema|mlc|ascap|bmi|sesac|prs for music|soundexchange|music publish\w*|catalog acquisitions?|distrokid|tunecore|cd baby|unitedmasters|kobalt|bmg|believe digital|live nation|ticketmaster|music (?:industry|business|copyright|lawsuits?)|artists? (?:pay|payouts?|royalt\w*))\b/i,
};

// Turkish sources: JS \b is ASCII-only, so these use Unicode letter lookarounds.
const tr = src => new RegExp(`(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])`, 'iu');
const TR_RULES = {
  musicai: tr('yapay zek[aâ] (?:müzi\\p{L}*|şarkı\\p{L}*)|yz müzik'),
  voice: tr('seslendirme\\p{L}*|ses klonlama|konuşma tanıma|metinden sese|dublaj\\p{L}*'),
  videoai: tr('yapay zek[aâ] (?:video\\p{L}*|film\\p{L}*)'),
  imageai: tr('yapay zek[aâ] (?:görsel\\p{L}*|resim\\p{L}*|çizim\\p{L}*)'),
  instruments: tr('sentezleyici\\p{L}*|davul makine\\p{L}*|enstrüman\\p{L}*|gitar\\p{L}*|piyano\\p{L}*'),
  production: tr('prodüksiyon\\p{L}*|prodüktör\\p{L}*|eklenti\\p{L}*'),
  audiogear: tr('kulaklı\\p{L}*|mikrofon\\p{L}*|hoparlör\\p{L}*'),
  industry: tr('telif\\p{L}*|dava(?:sı|lar|ları|yı|ya)?|plak şirket\\p{L}*|anlaşma\\p{L}*|yatırım\\p{L}*|satın al\\p{L}*|lisans\\p{L}*'),
  design: tr('tasarım\\p{L}*|kurgu\\p{L}*|fotoğraf\\p{L}*'),
};

// Most specific first: this decides the primary topic.
const PRIORITY = ['musicai', 'voice', 'videoai', 'imageai', 'instruments', 'production', 'audiotech', 'audiogear', '3d', 'design', 'industry'];

const FLAG_RULES = {
  // Bare "deal" is usually business ("inks a deal with…"), so only shopping phrasings count.
  deal: /\b((?:best|top|daily|weekend|flash|plugin|vst|software|gear|hardware|holiday|prime day|black friday|cyber monday|early|exclusive) deals?|deals? (?:on|of the|alert|roundup|ends?)|on sale|(?:flash|summer|winter|spring|anniversary|birthday|holiday|group[- ]buy) sale|sale (?:on|ends?|price)|discount(?:ed|s)?|\d{1,2}\s?% off|up to \d{1,2}\s?%|black friday|cyber monday|giveaways?|freebies?|coupons?|promo codes?|price drop|intro(?:ductory)? (?:price|offer)|limited[- ]time|free (?:plugins?|vsts?|samples?|sample packs?|packs?|downloads?|synths?|reverbs?|presets?|instruments?|kontakt|librar(?:y|ies)|soundbanks?|effects?|update|expansion|loops|luts?|fonts?|brushes|textures|assets)|(?:is|now|goes|for|get it|download it) free|price cut|save (?:up to )?\d+|(?:mega|plugin|vst|sample) bundle|(?:only|just|for) \$\d)\b/i,
  oss: /\b(open[- ]source[sd]?|github|gitlab|mit license|apache[- ]2(?:\.0)?|gpl\w*|foss|self-?host\w*|open[- ]weights?)\b/i,
  launch: /\b(announc(?:es|ed|ing|ement)|launch(?:es|ed|ing)?|unveil(?:s|ed|ing)?|introduc(?:es|ed|ing)|releas(?:es|ed|ing)|now available|out now|available now|debuts?|reveals?)\b/i,
};
const TR_DEAL = tr('ücretsiz|bedava|[iİ]ndirim\\p{L}*|kampanya\\p{L}*');

export function classify(text, { sourceTags = [], sourceFlags = [], sourceDomain = null } = {}) {
  // What the item says beats where it came from; the source's hints are the fallback.
  const found = new Set(PRIORITY.filter(t => RULES[t].test(text) || TR_RULES[t]?.test(text)));
  for (const t of sourceTags) if (TOPICS[t] && !found.size) found.add(t);
  let topics = PRIORITY.filter(t => found.has(t));
  // A secondary topic may only pull in another field when the source is general:
  // "animated display" in a synth review must not file it under Visual.
  if (topics.length && sourceDomain) {
    const primaryDomain = TOPICS[topics[0]];
    topics = topics.filter((t, i) => !i || TOPICS[t] === primaryDomain || TOPICS[t] === sourceDomain);
  }
  const domains = [...new Set(topics.map(t => TOPICS[t]))];
  if (!domains.length && sourceDomain) domains.push(sourceDomain);
  const flags = new Set(sourceFlags);
  for (const [f, re] of Object.entries(FLAG_RULES)) if (re.test(text)) flags.add(f);
  if (TR_DEAL.test(text)) flags.add('deal');
  if (sourceTags.includes('research')) flags.add('research');
  return { topic: topics[0] || null, topics: topics.slice(0, 3), domains, flags: [...flags] };
}

// ---------- GitHub spam ----------------------------------------------------------
// Search results are polluted by SEO/malware repos ("x-crack-2026", year topics,
// "recovery-helper" utilities). Score obvious signals and drop them.
const SPAM_WORDS = /\b(crack(?:ed)?|keygen|activator|activation[- ]key|serial[- ]key|license[- ]key|free[- ]download|full[- ]version|premium[- ]unlock\w*|unlocked|cheats?|aimbot|spoofer|executor|injector|mod[- ]?menu|hwid|bypass|loader)\b/i;

export function isSpamRepo(r) {
  let s = 0;
  const topics = r.topics || [];
  const name = r.full_name || r.name || '';
  const desc = r.description || '';
  if (topics.some(t => /^20\d\d$/.test(t))) s += 2;
  if (topics.includes('desktop-utility') || topics.includes('windows-tool')) s += 1;
  if (SPAM_WORDS.test(name)) s += 2;
  if (SPAM_WORDS.test(desc)) s += 1;
  if (/(recovery|profile)[- ]?(helper|manager)/i.test(name) && /windows/i.test(name + desc)) s += 2;
  if (!desc.trim()) s += 0.5;
  return s >= 2;
}

// A shareable dashboard should not surface adult model uploads.
const NSFW = /\b(nsfw|uncensored|porn\w*|hentai|nud(?:e|es|ity)|lewd|erotic\w*|xxx|onlyfans|heretic)\b/i;
export const isNsfw = (...parts) => NSFW.test(parts.join(' '));

// ---------- Entities (brand pulse) --------------------------------------------
export const ENTITIES = [
  ['Suno', /\bsuno\b/i], ['Udio', /\budio\b/i], ['ElevenLabs', /\beleven ?labs\b/i], ['Stability AI', /\bstability ?(?:\.|)ai\b|\bstable (?:audio|diffusion)\b/i],
  ['Google', /\b(?:google|deepmind|gemini|lyria|veo|imagen)\b/i], ['OpenAI', /\bopenai\b|\bchatgpt\b|\bsora\b|\bgpt-[\w.]+/i], ['Meta', /\bmeta\b(?!\s?data)|\baudiocraft\b/i],
  ['Microsoft', /\bmicrosoft\b|\bvibevoice\b/i], ['NVIDIA', /\bnvidia\b/i], ['Apple', /\bapple\b|\bairpods\b|\blogic pro\b|\bfinal cut\b/i],
  ['Adobe', /\badobe\b|\bphotoshop\b|\bpremiere\b|\bafter effects\b|\bfirefly\b/i], ['Midjourney', /\bmidjourney\b/i], ['Runway', /\brunway(?:ml)?\b/i],
  ['Black Forest Labs', /\bblack forest labs\b|\bflux(?:\.\d)?\b/i], ['Kling', /\bkling\b/i], ['Blender', /\bblender\b/i], ['Canva', /\bcanva\b/i], ['Figma', /\bfigma\b/i],
  ['Blackmagic', /\bblackmagic\b|\bdavinci resolve\b/i], ['Epic Games', /\bepic games\b|\bunreal engine\b/i],
  ['Alibaba / Qwen', /\balibaba\b|\bqwen[\w.-]*/i], ['ByteDance', /\bbytedance\b|\bseed(?:ance|ream)\b|\bcapcut\b/i], ['MiniMax', /\bminimax\b|\bhailuo\b/i],
  ['Spotify', /\bspotify\b/i], ['YouTube', /\byoutube\b/i], ['TikTok', /\btiktok\b/i], ['Deezer', /\bdeezer\b/i], ['SoundCloud', /\bsoundcloud\b/i],
  ['UMG', /\bumg\b|\buniversal music\b/i], ['Sony Music', /\bsony music\b/i], ['Warner Music', /\bwarner music\b|\bwmg\b/i], ['DistroKid', /\bdistrokid\b/i],
  ['Splice', /\bsplice\b/i], ['iZotope', /\bizotope\b/i], ['Native Instruments', /\bnative instruments\b|\bkontakt\b|\bkomplete\b/i], ['Ableton', /\bableton\b/i],
  ['FL Studio', /\bfl studio\b|\bimage-line\b/i], ['Steinberg', /\bsteinberg\b|\bcubase\b|\bnuendo\b/i], ['Avid', /\bavid\b|\bpro tools\b/i],
  ['Universal Audio', /\buniversal audio\b|\buad\b/i], ['Arturia', /\barturia\b/i], ['Moog', /\bmoog\b/i], ['Korg', /\bkorg\b/i], ['Roland', /\broland\b/i],
  ['Yamaha', /\byamaha\b/i], ['Elektron', /\belektron\b/i], ['Teenage Engineering', /\bteenage engineering\b|\bop-(?:1|xy|z)\b/i], ['Behringer', /\bbehringer\b/i],
  ['Sony', /\bsony\b(?!\s+music)/i], ['Sennheiser', /\bsennheiser\b/i], ['Dolby', /\bdolby\b/i], ['Sonos', /\bsonos\b/i],
];

export function matchEntities(text) {
  const out = [];
  for (const [name, re] of ENTITIES) if (re.test(text)) out.push(name);
  return out;
}

// ---------- Tokens (trends + clustering) -----------------------------------------
export const STOP = new Set(`a an the and or but if then else of to in on at by for with from into onto over under about after before
between through during without within against among across per via vs versus is are was were be been being am do does did done
has have had having can could should would will shall may might must not no nor so too very just than that this these those
there here where when why how what which who whom whose it its it's itself they them their theirs we us our ours you your yours
he him his she her hers i me my mine one two three first second new now get gets got make makes made use uses using used
out up down off more most less least much many some any all each every other another such only own same also still yet even
ever never always again back well way like via let lets says said say week weeks day days today year years month months time
times best top review reviews hands-on guide tips how-to watch video videos thing things really here's what's that's it's
you're we're they're isn't don't doesn't can't won't i'm i've ve ll re s t d m new latest big small good great free full
part vs available announced announces launch launches launched release released releases introduces introducing update updates
music audio sound sounds plugin plugins synth synths synthesizer show hn ask reddit r post posts thread discussion question help
looking anyone need want know think feel trying try tried first-ever via feat ft official version edition news pro series
track tracks recommendations line lines model models deal bundle sale off price prices review tested test explained look hands
vst vst3 sample samples pack packs library libraries tool tools app apps feature features based brings adds gets every finally
ever just make watch listen played play playing plays using inside around back down voice voices studio studios record records
recording songs song artist artists album albums live january february march april may june july august september
october november december monday tuesday wednesday thursday friday saturday sunday tutorial explained deep dive part guide
save saves saving synthesis instrument instruments effect effects software hardware control controls controller controllers
mode modes system systems kit kits device devices mix mixes beat beats bass drum drums vocal vocals plus pro max mini ultra one
image images photo photos ai generation generator generated create creating creates design designs art artwork video's
next production productions halloween christmas holiday holidays thanksgiving prime early late real big little world
contest contests competition affordable cheap cheaper cheapest food budget premium ultimate complete essential essentials
put puts putting take takes taking took turn turns set sets setting share shares sharing shared character characters give gives
keep keeps find finds run runs running start starts started end ends open opens close closes work works working need needs
help helps call calls tell tells feel feels leave leaves mean means become becomes begin begins seem seems talk talks hand high
low large long short old young right left place case company companies number group problem fact point home hour hours
people person team life story stories idea ideas reason reasons sound-alike come comes coming going goes went gone see sees
seen look looks looking want wants wanted love loves loved know knows known think thinks thought something anything everything
nothing someone everyone lot lots kind sort piece pieces step steps level levels side sides key line-up today's tonight
edit edits editing superstar star stars professional pro's support supports buy buying sold sell sells expands expand expanded
digital analog workflow workflows tips tricks free-to-use powerful simple easy fast faster better improved improve improves
improvement player players global virtual lead leads leading startup startups publishing announcement update's latest-ever
already almost really actually maybe soon later ago since while though although because without within across behind beyond
recorded limited unlimited built build builds teams partner partners partnership deals offer offers discount launching
`.split(/\s+/).filter(Boolean));

const keep = t => t.length >= 3 && !STOP.has(t) && !/^\d+(?:[.,]\d+)*$/.test(t) && !/^\d+(?:k|m|hz|khz|db|ms|p|fps)$/.test(t);
const rawTokens = text => (text.toLowerCase().match(/[a-z0-9À-ɏ]+(?:[-.+'][a-z0-9À-ɏ]+)*/g) || []).map(t => t.replace(/'s$/, ''));

export function tokens(text) {
  return rawTokens(text).filter(keep);
}

// Unigrams plus bigrams of words that are actually adjacent in the text
// ("East of Eden" must not produce "east eden").
export function terms(text) {
  const raw = rawTokens(text);
  const out = new Set(raw.filter(keep));
  for (let i = 0; i < raw.length - 1; i++) if (keep(raw[i]) && keep(raw[i + 1])) out.add(`${raw[i]} ${raw[i + 1]}`);
  return out;
}
