// Title tokenizer for client-side "related signals" (mirrors the server's trend tokenizer, lighter).
const STOP = new Set(`the and for with from into over about after this that these those your you are was were has have had will can
new now how why what who its it's our out off all more most just than then them they their there here when where which while
best top review hands test tested first look video watch guide tips free deal sale price update updates version edition
news music audio sound sounds plugin plugins synth synths synthesizer launches launched release released releases announces
announced introduces introducing available show reddit post day days week year today makes made using use get gets got
voice studio record recording song songs artist artists album live`.split(/\s+/));

export function tokensOf(text) {
  return [...new Set((String(text).toLowerCase().match(/[a-z0-9À-ɏ]+(?:[-.+'][a-z0-9À-ɏ]+)*/g) || [])
    .filter(t => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t)))];
}
