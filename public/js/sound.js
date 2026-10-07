/* Bullsy sound effects and toasts (unchanged from the earlier version). */
const $ = s => document.querySelector(s);
/* ================= Sound ================= */
let actx = null, muted = false;
function tone(f, d, type, when, vol) {
  if (muted) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime + (when || 0), o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(vol || .07, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + d);
  } catch (e) {}
}
const sfx = {
  buy: () => { tone(660, .08); tone(990, .14, 'triangle', .08); },
  sell: () => { tone(440, .08); tone(330, .14, 'triangle', .08); },
  up: () => [523, 659, 784].forEach((f, i) => tone(f, .16, 'triangle', i * .1)),
  down: () => [392, 330, 247].forEach((f, i) => tone(f, .2, 'sawtooth', i * .12, .04)),
  level: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, .18, 'square', .3 + i * .09, .04)),
  tap: () => tone(700, .04, 'square', 0, .025)
};
function toast(text, big) {
  const d = document.createElement('div'); d.className = 'toast' + (big ? ' big' : ''); d.textContent = text;
  $('#toasts').appendChild(d); setTimeout(() => d.remove(), 2300);
}


/* ================= Voice-over ================= */
/* Reads the market flashes and Bullsy's lines aloud with the browser's own voice. */
let voiceOn = true; const spoken = [];
const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
function speak(text, flush) {
  if (!voiceOn || !text) return;
  const clean = String(text).replace(/\p{Extended_Pictographic}|️/gu, '').replace(/-₹\s?([\d,]+)/g, 'minus $1 rupees').replace(/₹\s?([\d,]+)/g, '$1 rupees').replace(/\s+/g, ' ').trim();
  spoken.push(clean); if (spoken.length > 50) spoken.shift();
  if (!canSpeak) return;
  try {
    if (flush) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean), vs = speechSynthesis.getVoices();
    u.voice = vs.find(v => v.lang === 'en-IN') || vs.find(v => /^en/i.test(v.lang)) || null; u.lang = u.voice ? u.voice.lang : 'en-IN'; u.rate = 1; u.pitch = 1;
    speechSynthesis.speak(u);
  } catch (e) {}
}
function stopSpeaking() { try { if (canSpeak) speechSynthesis.cancel(); } catch (e) {} }
