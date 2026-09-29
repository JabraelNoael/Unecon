// Microphone recording, live transcription, voice commands ("Rowan stop"), and crash recovery.
// Audio chunks are written to IndexedDB every second, so closing the app never loses more than the last moment.
(() => {
if (location.search.includes('demo')) return;
const R = window.R, { $, phone, toast, fmt, openSheet, closeSheet, chipGroup, chosen, esc } = R;
const orb = $('#orb'), clock = $('#clock'), stopBtn = $('#stopBtn'), tEl = $('#transcript'), sheetEl = $('#sheet');
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

let st = 'idle', naming = false, pending = null;           // st: idle | rec | pause.  naming: recording stopped, waiting for a name
let stream, mr, chunks = [], sid = 0, ci = 0, actx, an, buf, elapsed = 0, timer, wake, lvl = 0, lastHist = 0, segs = [];
let sr, wantSR = false, live = null, lastCmd = { verb: '', t: 0 }, muteUntil = 0, home = 1;
const hist = Array(56).fill(0);

/* ---------- transcript helpers ---------- */
const pin = () => tEl.scrollTo({ top: tEl.scrollHeight, behavior: 'smooth' });
const card = (h, p) => { tEl.innerHTML = `<div class="live-card"><canvas></canvas><h4>${h}</h4><p>${p}</p></div>`; };
const dropCard = () => { const c = tEl.querySelector('.live-card'); if (c) c.remove(); };
function bubble(who, text, cls = '') {
  dropCard(); const el = document.createElement('div'); el.className = `msg ${who} ${cls}`;
  el.innerHTML = `<small>${who === 'you' ? 'You' : 'Rowan'}</small><p></p>`; el.querySelector('p').textContent = text; tEl.appendChild(el); pin(); return el;
}
function ui() {
  phone.classList.toggle('idle', st === 'idle'); phone.classList.toggle('paused', st === 'pause');
  clock.textContent = naming ? 'NAMING' : st === 'idle' ? 'READY' : (st === 'pause' ? 'PAUSED ' : '') + fmt(elapsed);
}
ui();

// Prefer the most natural installed voice (iOS "Enhanced"/"Premium" voices sound far less robotic than the default)
function bestVoice() {
  const lang = (navigator.language || 'en').slice(0, 2), rank = v => (/premium|enhanced|neural|natural/i.test(v.name) ? 2 : 0) + (v.localService ? 1 : 0);
  return speechSynthesis.getVoices().filter(v => v.lang.startsWith(lang)).sort((a, b) => rank(b) - rank(a))[0];
}
// Rowan speaks a line (and shows it). Listening is muted while he talks so he doesn't hear himself.
function say(text) {
  bubble('rowan', text);
  if (!window.speechSynthesis) { muteUntil = Date.now() + 1200; return; }
  const u = new SpeechSynthesisUtterance(text), v = bestVoice(); if (v) u.voice = v;
  const done = () => { muteUntil = Date.now() + 600; };
  u.onend = u.onerror = done; muteUntil = Date.now() + 9000; speechSynthesis.cancel(); speechSynthesis.speak(u);
}

/* ---------- live transcription + voice commands ---------- */
const WAKE = '(?:rowan|rohan|roan|rowen|ro ?when|owen)';
const REMEMBER = new RegExp(`\\b${WAKE}[, ]+(?:please )?remember (?:that )?(.+)`, 'i');
const CMD = new RegExp(`\\b${WAKE}[, ]+(stop|end|finish|save|pause|resume|continue|stamp|mark)\\b`);
function parse(text) { const t = text.toLowerCase().replace(/[.,!?]/g, ''), m = t.match(CMD); return m ? { verb: m[1], rest: t.slice(0, m.index).trim() } : null; }
function commit(text) {
  if (live) { live.remove(); live = null; }
  text = text.trim(); if (!text) return;
  bubble('you', text); segs.push({ t: elapsed, text }); R.store.set('live', { sid, segs });
}
function runCmd(v) {
  if (/stop|end|finish|save/.test(v)) stop();
  else if (v === 'pause' && st === 'rec') pause();
  else if (/resume|continue/.test(v) && st === 'pause') resume();
  else if (/stamp|mark/.test(v) && st !== 'idle') R.stamp('');
}
function heard(text, final) {
  if (Date.now() < muteUntil) return;
  if (naming) { if (final) nameHeard(text); return; }
  const rem = text.match(REMEMBER);                            // “Rowan, remember that …” goes straight to long-term memory
  if (rem) { if (final && R.memory) { R.memory.add(rem[1], { via: 'you', source: sid }); if (live) { live.remove(); live = null; } say('Got it. I’ll remember that.'); } return; }
  const c = parse(text);
  if (c) {                                                   // a command utterance never lands in the transcript twice
    if (c.verb !== lastCmd.verb || Date.now() - lastCmd.t > 2500) { lastCmd = { verb: c.verb, t: Date.now() }; commit(c.rest); runCmd(c.verb); }
    if (live) { live.remove(); live = null; } return;
  }
  if (st !== 'rec') return;                                  // while paused, only commands are heard
  if (final) commit(text);
  else { if (!live) live = bubble('you', '', 'live'); live.querySelector('p').textContent = text; pin(); }
}
function startSR() {
  if (!SR) return false;
  sr = new SR(); sr.continuous = true; sr.interimResults = true; sr.lang = navigator.language || 'en-US'; wantSR = true;
  sr.onresult = e => { for (let i = e.resultIndex; i < e.results.length; i++) heard(e.results[i][0].transcript, e.results[i].isFinal); };
  sr.onend = () => { if (wantSR) setTimeout(() => { try { sr.start(); } catch {} }, 300); };   // the browser ends recognition after silence; keep it going
  sr.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { wantSR = false; toast('Live transcription blocked'); } };
  try { sr.start(); } catch { return false; } return true;
}
const stopSR = () => { wantSR = false; try { sr.stop(); } catch {} };

/* ---------- recording ---------- */
async function start() {
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || typeof MediaRecorder === 'undefined') { toast('Recording needs https + a mic'); return; }
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { toast('Microphone blocked'); return; }
  const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); chunks = []; sid = Date.now(); ci = 0; segs = [];
  mr.ondataavailable = e => {
    if (!e.data.size) return; chunks.push(e.data);
    R.db.addChunk({ k: `${sid}:${String(ci++).padStart(6, '0')}`, sid, blob: e.data, mime: mr.mimeType });   // crash-safe copy
  };
  mr.start(1000);
  actx = new (window.AudioContext || window.webkitAudioContext)(); an = actx.createAnalyser(); an.fftSize = 1024;
  actx.createMediaStreamSource(stream).connect(an); buf = new Uint8Array(an.fftSize);
  hist.fill(0); elapsed = 0; R.setElapsed(0); R.sessionStamps = []; R.rec = true; st = 'rec'; R.store.set('live', { sid, segs });
  if (R.refreshPos) R.refreshPos();
  timer = setInterval(() => { if (st === 'rec') { R.setElapsed(++elapsed); ui(); if (elapsed % 30 === 0 && R.refreshPos) R.refreshPos(); } }, 1000);
  keepAwake();
  const sp = startSR();
  card('Listening', sp ? 'Say “Rowan stop” when you’re done, or tap Rowan to pause.' : 'Live transcription isn’t available in this browser. Audio is still being saved.');
  ui(); toast('Listening');
}
async function keepAwake() { try { wake = await navigator.wakeLock.request('screen'); } catch {} }
const pause = () => { mr.pause(); st = 'pause'; ui(); toast('Paused · say “Rowan resume”'); };
const resume = () => { mr.resume(); st = 'rec'; ui(); toast('Listening'); };

async function stop() {
  if (st === 'idle' || naming) return;
  clearInterval(timer);
  if (live) commit(live.querySelector('p').textContent);
  const done = new Promise(r => { mr.onstop = r; }); if (mr.state !== 'inactive') mr.stop(); await done;
  stream.getTracks().forEach(t => t.stop()); actx.close(); if (wake) wake.release();
  const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' }), d = new Date();
  const note = { id: sid, title: `Untitled · ${d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`, subject: 'Unsorted', created: d.getTime(), dur: elapsed, blob, mime: blob.type, stamps: R.sessionStamps, text: segs.map(s => s.text).join('\n'), segs };
  await R.db.put(note); await R.db.dropChunks(sid); R.store.set('live', null); if (R.memory) R.memory.ingest(note);   // saved for good; the crash copy is no longer needed
  st = 'idle'; R.rec = false; R.sessionStamps = []; naming = true; pending = note; ui();
  if (R.notesChanged) R.notesChanged();
  nameSheet(note, 'Recording saved'); say('What would you like to call this recording?');
}

/* ---------- naming: Rowan always asks, never names it for you ---------- */
function nameSheet(note, heading) {
  openSheet(`<h2>${heading}</h2>
    <p class="hint" style="margin-top:-8px">${fmt(note.dur)} · ${(note.blob.size / 1024).toFixed(0)} KB · ${note.stamps.length} stamp${note.stamps.length === 1 ? '' : 's'}${note.text ? ' · transcribed' : ''}</p>
    <label class="field"><span>Name</span><input class="inp" id="n-title" placeholder="Say a name to Rowan, or type one"></label>
    <div class="field"><span>Subject</span>${chipGroup('subj', R.subjects().map(s => [s.name, s.name]), 'Unsorted')}
      <input class="inp" id="n-new" placeholder="or create a new subject (a class, a trip, ...)" style="margin-top:10px"></div>
    <div class="actions-row"><button class="btn danger" data-del>Discard</button><button class="btn primary" data-ok>Save</button></div>`);
  const del = $('[data-del]', sheetEl);
  del.onclick = async () => { if (del.dataset.sure) { naming = false; await R.db.del(note.id); closeSheet(); endNaming(); R.notesChanged && R.notesChanged(); toast('Discarded'); } else { del.dataset.sure = 1; del.textContent = 'Really discard?'; } };
  $('[data-ok]', sheetEl).onclick = () => finish(note);
}
function nameHeard(text) {
  const t = text.trim().replace(/[.!?]+$/, ''); if (!t) return;
  const skip = /^(skip|never ?mind|no name|cancel|nothing)$/i.test(t);
  if (!skip) { $('#n-title').value = t[0].toUpperCase() + t.slice(1); bubble('you', t); }
  say(skip ? 'Okay, I’ll leave it untitled.' : `Saved as “${$('#n-title').value}”.`);
  setTimeout(() => pending && finish(pending), 1700);
}
async function finish(note) {
  if (!naming) return; naming = false;
  const fresh = ($('#n-new') || {}).value ? $('#n-new').value.trim() : ''; if (fresh) R.addSubject(fresh);
  const title = ($('#n-title') || {}).value ? $('#n-title').value.trim() : '';
  if (title) note.title = title; note.subject = fresh || chosen('subj') || 'Unsorted';
  await R.db.put(note); closeSheet(); R.notesChanged && R.notesChanged(); toast('Saved to Notes'); setTimeout(endNaming, 1200);
}
function endNaming() { naming = false; pending = null; stopSR(); if (live) { live.remove(); live = null; } tEl.innerHTML = ''; ui(); }
new MutationObserver(() => { if (naming && !sheetEl.classList.contains('on')) { naming = false; endNaming(); } }).observe(sheetEl, { attributes: true, attributeFilter: ['class'] });   // dismissed the sheet: keep the untitled name

/* ---------- controls ---------- */
const onOrb = () => { if (naming) return; if (st === 'idle') start(); else if (st === 'rec') pause(); else resume(); };
orb.onclick = onOrb; orb.onkeydown = e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOrb());
stopBtn.onclick = stop;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || st === 'idle') return;
  keepAwake(); if (mr && mr.state === 'inactive') stop();     // the OS ended the recording while we were away: save what we have
});

/* ---------- recover a recording if the app was closed mid-session ---------- */
(async () => {
  const all = await R.db.chunks(); if (!all.length) return;
  const by = {}; all.forEach(c => (by[c.sid] || (by[c.sid] = [])).push(c));
  const draft = R.store.get('live', null); let last = null;
  for (const s of Object.keys(by)) {
    const cs = by[s].sort((a, b) => (a.k < b.k ? -1 : 1)), blob = new Blob(cs.map(c => c.blob), { type: cs[0].mime || 'audio/mp4' }), sg = draft && draft.sid == s ? draft.segs : [];
    last = { id: +s, title: `Recovered · ${new Date(+s).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`, subject: 'Unsorted', created: +s, dur: cs.length, blob, mime: blob.type, stamps: [], text: sg.map(x => x.text).join('\n'), segs: sg };
    await R.db.put(last); await R.db.dropChunks(+s);
  }
  R.store.set('live', null); R.notesChanged && R.notesChanged();
  if (last) { naming = false; nameSheet(last, 'Recovered a recording'); $('[data-ok]', sheetEl).onclick = async () => { const t = $('#n-title').value.trim(), f = $('#n-new').value.trim(); if (f) R.addSubject(f); if (t) last.title = t; last.subject = f || chosen('subj') || 'Unsorted'; await R.db.put(last); closeSheet(); R.notesChanged(); }; }
})();

/* ---------- frame loop: level meter, waveform, and Rowan's home <-> docked animation ---------- */
(function frame(t) {
  if (st === 'rec') {
    an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) { const x = (v - 128) / 128; s += x * x; }
    lvl += (Math.min(1, Math.sqrt(s / buf.length) * 5) - lvl) * .25;
    if (t - lastHist > 60) { hist.push(lvl); hist.shift(); lastHist = t; }
  } else lvl *= .9;
  phone.style.setProperty('--lvl', lvl.toFixed(3));
  const goal = st === 'idle' && !naming ? Math.max(0, 1 - (parseFloat(phone.style.getPropertyValue('--a')) || 0) * 2.2) : 0;
  home += (goal - home) * .13; if (Math.abs(goal - home) < .002) home = goal;
  phone.style.setProperty('--home', home.toFixed(4));
  const cv = tEl.querySelector('canvas');
  if (cv) {
    const w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1;
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const bw = w / hist.length; c.fillStyle = st === 'pause' ? '#877d90' : '#d4a94e';
    hist.forEach((v, i) => { const bh = 3 + v * (h - 6); c.globalAlpha = .25 + i / hist.length * .75; c.fillRect(i * bw + 1, (h - bh) / 2, bw - 2, bh); });
  }
  requestAnimationFrame(frame);
})(0);
})();
