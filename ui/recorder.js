// Real microphone recording -> saved to IndexedDB. Transcription is backfilled later.
(() => {
if (location.search.includes('demo')) return;
const R = window.R, { $, phone, toast, fmt, openSheet, closeSheet, chipGroup, chosen, esc } = R;
const head = $('.head'), orb = $('#orb'), clock = $('#clock'), stopBtn = $('#stopBtn'), tEl = $('#transcript');
let st = 'idle', stream, mr, chunks = [], actx, an, buf, elapsed = 0, timer, wake, lvl = 0, lastHist = 0;
const hist = Array(56).fill(0);

const card = (h, p) => { tEl.innerHTML = `<div class="live-card"><canvas></canvas><h4>${h}</h4><p>${p}</p></div>`; };
const idleCard = () => { tEl.innerHTML = ''; };
function ui() {
  phone.classList.toggle('idle', st === 'idle'); phone.classList.toggle('paused', st === 'pause');
  clock.textContent = st === 'idle' ? 'READY' : fmt(elapsed) + (st === 'pause' ? ' ❚❚' : '');
  stopBtn.hidden = st === 'idle';
}
idleCard(); ui();

async function start() {
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || typeof MediaRecorder === 'undefined') { toast('Recording needs https + a mic'); return; }
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { toast('Microphone blocked'); return; }
  const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); chunks = [];
  mr.ondataavailable = e => e.data.size && chunks.push(e.data);
  mr.start(1000);
  actx = new (window.AudioContext || window.webkitAudioContext)(); an = actx.createAnalyser(); an.fftSize = 1024;
  actx.createMediaStreamSource(stream).connect(an); buf = new Uint8Array(an.fftSize);
  hist.fill(0); elapsed = 0; R.setElapsed(0); R.sessionStamps = []; R.rec = true; st = 'rec';
  timer = setInterval(() => { if (st === 'rec') { R.setElapsed(++elapsed); ui(); } }, 1000);
  keepAwake(); card('Listening', 'Keep this screen open while recording. Stamps you drop are saved with the recording.'); ui(); toast('Listening');
}
async function keepAwake() { try { wake = await navigator.wakeLock.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (st !== 'idle' && document.visibilityState === 'visible') keepAwake(); });

const pause = () => { mr.pause(); st = 'pause'; ui(); toast('Paused'); };
const resume = () => { mr.resume(); st = 'rec'; ui(); toast('Listening'); };

async function stop() {
  clearInterval(timer);
  const done = new Promise(r => { mr.onstop = r; }); mr.stop(); await done;
  stream.getTracks().forEach(t => t.stop()); actx.close(); if (wake) wake.release();
  const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' }), d = new Date();
  const note = { id: Date.now(), title: `Recording · ${d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`, subject: 'Unsorted', created: d.getTime(), dur: elapsed, blob, mime: blob.type, stamps: R.sessionStamps, text: '' };
  await R.db.put(note);                     // persisted immediately; the sheet below only edits metadata
  st = 'idle'; R.rec = false; R.sessionStamps = []; lvl = 0; phone.style.setProperty('--lvl', 0); ui(); idleCard();
  if (R.notesChanged) R.notesChanged();
  saveSheet(note);
}
function saveSheet(note) {
  const subs = R.subjects();
  openSheet(`<h2>Recording saved</h2>
    <p class="hint" style="margin-top:-8px">${fmt(note.dur)} · ${(note.blob.size / 1024).toFixed(0)} KB · ${note.stamps.length} stamp${note.stamps.length === 1 ? '' : 's'}</p>
    <label class="field"><span>Title</span><input class="inp" id="n-title" value="${esc(note.title)}"></label>
    <div class="field"><span>Subject</span>${chipGroup('subj', subs.map(s => [s.name, s.name]), 'Unsorted')}
      <input class="inp" id="n-new" placeholder="or create a new subject (a class, a trip, ...)" style="margin-top:10px"></div>
    <div class="actions-row"><button class="btn danger" data-del>Discard</button><button class="btn primary" data-ok>Save</button></div>`);
  const del = $('[data-del]', $('#sheet'));
  del.onclick = async () => { if (del.dataset.sure) { await R.db.del(note.id); closeSheet(); R.notesChanged && R.notesChanged(); toast('Discarded'); } else { del.dataset.sure = 1; del.textContent = 'Really discard?'; } };
  $('[data-ok]', $('#sheet')).onclick = async () => {
    const fresh = $('#n-new').value.trim(); if (fresh) R.addSubject(fresh);
    note.title = $('#n-title').value.trim() || note.title; note.subject = fresh || chosen('subj') || 'Unsorted';
    await R.db.put(note); closeSheet(); R.notesChanged && R.notesChanged(); toast('Saved to Notes');
  };
}

const onOrb = () => (st === 'idle' ? start() : st === 'rec' ? pause() : resume());
orb.onclick = onOrb; orb.onkeydown = e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOrb());
let home = 1;                                   // 1 = Rowan fills the screen (idle, on the Listen page), 0 = docked in the top 15%
stopBtn.onclick = stop;

(function frame(t) {
  if (st === 'rec') {
    an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) { const x = (v - 128) / 128; s += x * x; }
    lvl += (Math.min(1, Math.sqrt(s / buf.length) * 5) - lvl) * .25;
    if (t - lastHist > 60) { hist.push(lvl); hist.shift(); lastHist = t; }
  } else lvl *= .9;
  phone.style.setProperty('--lvl', lvl.toFixed(3));
  const goal = st === 'idle' ? Math.max(0, 1 - (parseFloat(phone.style.getPropertyValue('--a')) || 0) * 2.2) : 0;
  home += (goal - home) * .13; if (Math.abs(goal - home) < .002) home = goal;
  phone.style.setProperty('--home', home.toFixed(4));
  const cv = tEl.querySelector('canvas');
  if (cv && (st !== 'idle' || cv.dataset.d !== '1')) {
    const w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1;
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const bw = w / hist.length; c.fillStyle = st === 'pause' ? '#877d90' : '#d4a94e';
    hist.forEach((v, i) => { const bh = 3 + v * (h - 6); c.globalAlpha = .25 + i / hist.length * .75; c.fillRect(i * bw + 1, (h - bh) / 2, bw - 2, bh); });
    if (st === 'idle') cv.dataset.d = '1';
  }
  requestAnimationFrame(frame);
})(0);
})();
