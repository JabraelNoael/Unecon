// Voice lab: run one piece of audio through many transcribers and many speaker-splitters, then compare.
// Transcribing and splitting are independent (both read the raw audio); they are joined afterwards by timestamps.
// "Split first" is the other order: cut the audio by speaker, then transcribe each piece. That can change the words.
(() => {
const R = window.R, { $, $$, esc, store, toast, fmt, openSheet, closeSheet } = R;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const SPK = ['#d4a94e', '#a583ea', '#5fd2c8', '#e5793c', '#6db8ec'];
const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

const ASR = [
  { id: 'webspeech', name: 'Browser speech', note: 'built in · live mic only', live: true },
  { id: 'w-tiny', name: 'Whisper tiny.en', note: 'on-device · ~40 MB', model: 'Xenova/whisper-tiny.en' },
  { id: 'w-base', name: 'Whisper base.en', note: 'on-device · ~80 MB', model: 'Xenova/whisper-base.en' },
  { id: 'w-small', name: 'Whisper small.en', note: 'on-device · ~250 MB', model: 'Xenova/whisper-small.en' },
  { id: 'moon', name: 'Moonshine tiny', note: 'on-device · ~30 MB · no timestamps', model: 'onnx-community/moonshine-tiny-ONNX' },
  { id: 'deepgram', name: 'Deepgram nova-3', note: 'cloud · needs key', cloud: true },
  { id: 'openai', name: 'OpenAI whisper-1', note: 'cloud · needs key', cloud: true },
  { id: 'assembly', name: 'AssemblyAI', note: 'cloud · needs key', cloud: true },
];
const DIAR = [
  { id: 'base', name: 'Baseline', note: 'built in · pitch + voice color' },
  { id: 'pyannote', name: 'pyannote segmentation', note: 'on-device · ~6 MB' },
  { id: 'deepgram', name: 'Deepgram', note: 'cloud · needs key', cloud: true },
  { id: 'assembly', name: 'AssemblyAI', note: 'cloud · needs key', cloud: true },
];
let sel = store.get('labSel', { asr: { webspeech: 1, 'w-tiny': 1, 'w-base': 1 }, diar: { base: 1, pyannote: 1 }, first: 0 });
let src = null, audioData = null, running = false, rc = null, res = { asr: {}, diar: {}, comb: [] }, cloud = {}, pipes = {}, tjs = null, st = { asr: {}, diar: {} }, pending = '';
const audio = $('#labAudio'), keys = () => store.get('keys', {});
const dur = () => (audio.duration && isFinite(audio.duration) ? audio.duration : audioData ? audioData.length / 16000 : 0);
const sec = ms => (ms / 1000).toFixed(1) + 's';

/* ---------- source ---------- */
$('#labSrc').innerHTML = `
  <button class="tile" data-src="clip" style="--c:var(--blood)"><span class="mono-g">●</span><span><b id="clipLabel">Record a test clip</b><small>Also runs the browser’s live speech at the same time</small></span></button>
  <button class="tile" data-src="note" style="--c:var(--gold)"><span class="mono-g">Nt</span><span><b>Pick a saved recording</b><small>From your Notes</small></span></button>
  <button class="tile" data-src="file" style="--c:var(--aether)"><span class="mono-g">Up</span><span><b>Upload an audio file</b><small>Any format your phone can play</small></span></button>
  <input type="file" id="labFile" accept="audio/*" hidden>`;
$('#labSrc').onclick = e => { const b = e.target.closest('[data-src]'); if (!b) return; ({ clip: toggleClip, note: pickNote, file: () => $('#labFile').click() })[b.dataset.src](); };
$('#labFile').onchange = e => { const f = e.target.files[0]; if (f) setSource(f, f.name, ''); e.target.value = ''; };

function setSource(blob, name, live, fromNote) {
  src = { blob, name, live, fromNote }; audioData = null; res = { asr: {}, diar: {}, comb: [] }; cloud = {}; st = { asr: {}, diar: {} };
  audio.src = URL.createObjectURL(blob); audio.style.display = 'block';
  $('#labSrcInfo').textContent = `${name} · ${(blob.size / 1024).toFixed(0)} KB${live ? ' · has a live transcript' : ''}`;
  renderAll(); toast('Audio ready');
}
async function toggleClip() {
  if (rc) return stopClip();
  if (R.rec) { toast('Stop the current recording first'); return; }
  let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { toast('Microphone blocked'); return; }
  const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), chunks = []; mr.ondataavailable = e => e.data.size && chunks.push(e.data); mr.start();
  const c = { mr, stream, chunks, text: '', sr: null };
  if (SR) {
    const sr = c.sr = new SR(); sr.continuous = true; sr.interimResults = false; sr.lang = navigator.language || 'en-US';
    sr.onresult = e => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) c.text += (c.text ? ' ' : '') + e.results[i][0].transcript.trim(); };
    sr.onend = () => { if (rc === c) try { sr.start(); } catch {} };
    try { sr.start(); } catch {}
  }
  rc = c; $('#clipLabel').textContent = 'Stop clip'; c.timer = setTimeout(stopClip, 90000);
}
function stopClip() {
  const c = rc; if (!c) return; rc = null; clearTimeout(c.timer); $('#clipLabel').textContent = 'Record a test clip';
  try { c.sr && c.sr.stop(); } catch {}
  c.mr.onstop = () => { c.stream.getTracks().forEach(t => t.stop()); setTimeout(() => setSource(new Blob(c.chunks, { type: c.mr.mimeType }), 'Test clip', c.text), 700); };
  c.mr.stop();
}
async function pickNote() {
  const ns = (await R.db.all()).filter(n => n.blob).sort((a, b) => b.created - a.created);
  openSheet('<h2>Pick a recording</h2>' + (ns.length ? ns.map(n => `<button class="tile" data-n="${n.id}" style="margin-bottom:10px"><span><b>${esc(n.title)}</b><small>${fmt(Math.round(n.dur))}</small></span></button>`).join('') : '<div class="empty">No saved recordings yet.</div>'));
  $('#sheet').onclick = e => { const b = e.target.closest('[data-n]'); if (!b) return; const n = ns.find(x => x.id == b.dataset.n); closeSheet(); setSource(n.blob, n.title, n.text || '', true); };
}
async function pcm() {                                        // decode to 16 kHz mono, what every model wants
  if (audioData) return audioData;
  const buf = await src.blob.arrayBuffer(), ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  const a = await ctx.decodeAudioData(buf); ctx.close();
  const out = new Float32Array(a.length); for (let c = 0; c < a.numberOfChannels; c++) { const d = a.getChannelData(c); for (let i = 0; i < a.length; i++) out[i] += d[i] / a.numberOfChannels; }
  return (audioData = out);
}

/* ---------- engine picker ---------- */
const tile = (kind, e, c) => `<button class="tile ${sel[kind][e.id] ? 'on' : ''}" data-k="${kind}" data-id="${e.id}" style="--c:${c}"><span class="mono-g">${e.cloud ? '☁' : e.name.slice(0, 2)}</span><span><b>${e.name}</b><small>${e.note}</small></span><span class="state"></span></button>`;
$('#labAsr').innerHTML = ASR.map(e => tile('asr', e, e.cloud ? 'var(--frost)' : 'var(--gold)')).join('');
$('#labDiar').innerHTML = DIAR.map(e => tile('diar', e, e.cloud ? 'var(--frost)' : 'var(--arcane)')).join('');
$('#labDiar').insertAdjacentHTML('afterend', `<label class="field" style="margin-top:12px"><span>Speakers for the baseline</span><div class="chips" data-g="k">${['auto', 2, 3, 4].map(n => `<button type="button" class="chip ${String(n) === String(store.get('labK', 'auto')) ? 'on' : ''}" data-v="${n}">${n === 'auto' ? 'Count for me' : n}</button>`).join('')}</div></label>`);
document.querySelector('[data-g="k"]').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; $$('.chip', c.parentElement).forEach(x => x.classList.toggle('on', x === c)); store.set('labK', c.dataset.v === 'auto' ? 'auto' : +c.dataset.v); };
const flip = e => { const t = e.target.closest('.tile[data-k]'); if (!t) return; const m = sel[t.dataset.k]; m[t.dataset.id] = m[t.dataset.id] ? 0 : 1; t.classList.toggle('on', !!m[t.dataset.id]); store.set('labSel', sel); runLabel(); };
$('#labAsr').onclick = flip; $('#labDiar').onclick = flip;
$('#labFirst').classList.toggle('on', !!sel.first); $('#labFirst').onclick = () => { sel.first = sel.first ? 0 : 1; $('#labFirst').classList.toggle('on', !!sel.first); store.set('labSel', sel); };
['deepgram', 'openai', 'assembly'].forEach(k => { const el = $('#k-' + k); el.value = keys()[k] || ''; el.oninput = () => store.set('keys', { ...keys(), [k]: el.value.trim() }); });
const runLabel = () => { const n = Object.values(sel.asr).filter(Boolean).length + Object.values(sel.diar).filter(Boolean).length; $('#labRun').textContent = running ? 'Running…' : `Run ${n} selected`; };
runLabel();

/* ---------- models ---------- */
async function T() { if (!tjs) { tjs = await import(TJS); tjs.env.allowLocalModels = false; } return tjs; }
const prog = (kind, id) => p => { if (p.status === 'progress' && p.total > 1e6) setSt(kind, id, `Downloading ${Math.round(p.progress)}%`); else if (p.status === 'ready') setSt(kind, id, 'Loading…'); };
async function pipe(e) {
  if (pipes[e.id]) return pipes[e.id];
  const { pipeline } = await T(); setSt('asr', e.id, 'Loading model…');
  return (pipes[e.id] = await pipeline('automatic-speech-recognition', e.model, { dtype: 'q8', device: 'wasm', progress_callback: prog('asr', e.id) }));
}

/* ---------- transcribers ---------- */
async function asrImpl(e) {
  if (e.live) return src.live ? { text: src.live, words: [], ms: null, note: src.fromNote ? 'transcript saved with that recording' : 'live, while you spoke' } : { text: '', note: 'This engine only hears a live mic. Use “Record a test clip”.' };
  if (e.cloud) return (await cloudCall(e.id)).asr;
  const p = await pipe(e), a = await pcm(); setSt('asr', e.id, 'Transcribing…');
  const t0 = performance.now(), opt = { chunk_length_s: 30, stride_length_s: 5 };
  let out, words = [];
  if (e.id === 'moon') out = await p(a);
  else { try { out = await p(a, { ...opt, return_timestamps: 'word' }); } catch { out = await p(a, { ...opt, return_timestamps: true }); } }
  words = (out.chunks || []).map(c => ({ w: c.text.trim(), s: c.timestamp[0], e: c.timestamp[1] == null ? c.timestamp[0] + .3 : c.timestamp[1] })).filter(x => x.w);
  return { text: (out.text || '').trim(), words, ms: performance.now() - t0 };
}
function cloudCall(id) {
  if (cloud[id]) return cloud[id];
  const key = keys()[id]; if (!key) return Promise.reject(new Error('Add your key under “Cloud keys”'));
  const group = (words) => { const segs = []; words.forEach(w => { const l = segs[segs.length - 1]; if (l && l.spk === w.spk && w.s - l.e < .8) l.e = w.e; else segs.push({ spk: w.spk, s: w.s, e: w.e }); }); return segs; };
  const t0 = performance.now();
  return (cloud[id] = (async () => {
    if (id === 'deepgram') {
      const r = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&diarize=true&punctuate=true', { method: 'POST', headers: { Authorization: 'Token ' + key, 'Content-Type': src.blob.type || 'audio/*' }, body: src.blob });
      const j = await r.json(); if (!r.ok) throw new Error(j.err_msg || r.status);
      const alt = j.results.channels[0].alternatives[0], words = alt.words.map(w => ({ w: w.punctuated_word || w.word, s: w.start, e: w.end, spk: w.speaker })), ms = performance.now() - t0;
      return { asr: { text: alt.transcript, words, ms }, diar: { segs: group(words), ms } };
    }
    if (id === 'openai') {
      const fd = new FormData(); fd.append('file', src.blob, 'clip.' + (/mp4/.test(src.blob.type) ? 'm4a' : 'webm')); fd.append('model', 'whisper-1'); fd.append('response_format', 'verbose_json'); fd.append('timestamp_granularities[]', 'word');
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd });
      const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || r.status);
      return { asr: { text: j.text, words: (j.words || []).map(w => ({ w: w.word, s: w.start, e: w.end })), ms: performance.now() - t0 } };
    }
    const H = { authorization: key };                              // AssemblyAI: upload, start, poll
    const up = await (await fetch('https://api.assemblyai.com/v2/upload', { method: 'POST', headers: H, body: src.blob })).json();
    let j = await (await fetch('https://api.assemblyai.com/v2/transcript', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ audio_url: up.upload_url, speaker_labels: true }) })).json();
    while (j.status !== 'completed') { if (j.status === 'error' || j.error) throw new Error(j.error); await new Promise(r => setTimeout(r, 2000)); j = await (await fetch('https://api.assemblyai.com/v2/transcript/' + j.id, { headers: H })).json(); }
    const words = j.words.map(w => ({ w: w.text, s: w.start / 1000, e: w.end / 1000, spk: w.speaker })), ms = performance.now() - t0;
    return { asr: { text: j.text, words, ms }, diar: { segs: group(words), ms } };
  })());
}

/* ---------- speaker splitters ---------- */
const order = segs => { const m = {}; let n = 0; return segs.sort((a, b) => a.s - b.s).map(s => ({ ...s, spk: m[s.spk] ?? (m[s.spk] = n++) })); };
async function diarImpl(d) {
  if (d.cloud) { const r = await cloudCall(d.id); if (!r.diar) throw new Error('No speaker labels from this provider'); return { segs: order(r.diar.segs), ms: r.diar.ms }; }
  const a = await pcm(), t0 = performance.now();
  if (d.id === 'base') { const K = store.get('labK', 'auto'), r = baseline(a, K); return { segs: order(r.segs), ms: performance.now() - t0, note: K === 'auto' ? `counted ${r.k} speaker${r.k === 1 ? '' : 's'} on its own${r.scores ? ` · separation by count ${r.scores}` : ''}` : '' }; }
  const { AutoProcessor, AutoModelForAudioFrameClassification } = await T(), id = 'onnx-community/pyannote-segmentation-3.0';
  setSt('diar', d.id, 'Loading model…');
  const proc = await AutoProcessor.from_pretrained(id), model = await AutoModelForAudioFrameClassification.from_pretrained(id, { device: 'wasm', dtype: 'fp32', progress_callback: prog('diar', d.id) });
  setSt('diar', d.id, 'Splitting…'); const t1 = performance.now();
  const { logits } = await model(await proc(a)), out = proc.post_process_speaker_diarization(logits, a.length)[0], names = model.config.id2label || {};
  const segs = out.filter(s => !/NO_SPEAKER/i.test(names[s.id] || '') && (names[s.id] || s.id !== 0)).map(s => ({ spk: s.id, s: s.start, e: s.end }));
  return { segs: order(segs), ms: performance.now() - t1, note: 'labels are only reliable within short windows (no voice matching across the clip)' };
}
// Baseline: find speech by loudness, describe each 1.2 s chunk (MFCC voice color + pitch), cluster with k-means.
function fft(re, im) {
  const n = re.length; for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) { const k = i + j + len / 2, ur = re[i + j], ui = im[i + j], vr = re[k] * cr - im[k] * ci, vi = re[k] * ci + im[k] * cr; re[i + j] = ur + vr; im[i + j] = ui + vi; re[k] = ur - vr; im[k] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
}
const mel = f => 2595 * Math.log10(1 + f / 700), imel = m => 700 * (10 ** (m / 2595) - 1);
const FB = (() => { const nf = 20, pts = Array.from({ length: nf + 2 }, (_, i) => imel(mel(80) + (mel(4000) - mel(80)) * i / (nf + 1))), bins = pts.map(f => Math.floor(f / 31.25)); return Array.from({ length: nf }, (_, m) => ({ a: bins[m], b: bins[m + 1], c: bins[m + 2] })); })();
const AUTO_MIN = .35;                                             // one voice on its own scores ~.3; two real voices score ~.4+
function baseline(a, K) {
  const hop = 320, win = 640, nF = Math.floor((a.length - win) / hop); if (nF < 20) return { segs: [], k: 0 };
  const en = new Float32Array(nF); for (let f = 0; f < nF; f++) { let s = 0; for (let i = 0; i < win; i++) { const x = a[f * hop + i]; s += x * x; } en[f] = Math.sqrt(s / win); }
  const sorted = [...en].sort((x, y) => x - y), thr = Math.max(sorted[Math.floor(nF * .1)] * 3, sorted[Math.floor(nF * .95)] * .08);
  const sp = Array.from(en, v => v > thr);
  for (let i = 0; i < nF;) { if (sp[i]) { i++; continue; } let j = i; while (j < nF && !sp[j]) j++; if (i > 0 && j < nF && j - i < 15) for (let k = i; k < j; k++) sp[k] = true; i = j; }   // bridge gaps under 300 ms
  const runs = []; for (let i = 0; i < nF;) { if (!sp[i]) { i++; continue; } let j = i; while (j < nF && sp[j]) j++; if (j - i >= 10) runs.push([i, j]); i = j; }
  const wins = []; runs.forEach(([s, e]) => { for (let f = s; f < e; f += 60) { const g = Math.min(e, f + 60); if (g - f >= 25) wins.push([f, g]); } });
  if (wins.length < 2) return { segs: wins.map(([s, e]) => ({ spk: 0, s: s * hop / 16000, e: e * hop / 16000 })), k: wins.length };
  const feats = wins.map(([f0, f1]) => {
    const lm = new Float32Array(20), pit = []; let cnt = 0;
    for (let f = f0; f < f1; f++) {
      if (en[f] <= thr) continue; cnt++;
      const re = new Float64Array(512), im = new Float64Array(512); for (let i = 0; i < 512; i++) re[i] = a[f * hop + i] * (.5 - .5 * Math.cos(2 * Math.PI * i / 511));
      fft(re, im); const pw = k => re[k] * re[k] + im[k] * im[k];
      FB.forEach((b, m) => { let s = 0; for (let k = b.a; k < b.c; k++) s += pw(k) * (k < b.b ? (k - b.a) / Math.max(1, b.b - b.a) : (b.c - k) / Math.max(1, b.c - b.b)); lm[m] += Math.log(s + 1e-9); });
      let best = 0, bl = 0, e0 = 0; for (let i = 0; i < win; i++) e0 += a[f * hop + i] ** 2;
      for (let l = 40; l < 228; l++) { let r = 0; for (let i = 0; i < win - l; i++) r += a[f * hop + i] * a[f * hop + i + l]; r /= e0 + 1e-9; if (r > best) { best = r; bl = l; } }
      if (best > .35) pit.push(16000 / bl);
    }
    const mf = []; for (let k = 1; k <= 12; k++) { let s = 0; for (let n = 0; n < 20; n++) s += (lm[n] / Math.max(cnt, 1)) * Math.cos(Math.PI * k * (n + .5) / 20); mf.push(s); }
    pit.sort((x, y) => x - y); return [...mf, pit.length >= 3 ? Math.log(pit[pit.length >> 1]) : NaN];
  });
  const d = feats[0].length, mean = Array(d).fill(0), sd = Array(d).fill(0);
  for (let j = 0; j < d; j++) { const v = feats.map(f => f[j]).filter(x => !isNaN(x)); mean[j] = v.reduce((s, x) => s + x, 0) / (v.length || 1); sd[j] = Math.sqrt(v.reduce((s, x) => s + (x - mean[j]) ** 2, 0) / (v.length || 1)) || 1; }
  const X = feats.map(f => f.map((x, j) => (isNaN(x) ? 0 : (x - mean[j]) / sd[j]) * (j === d - 1 ? 2.5 : 1)));
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, dist = (p, q) => p.reduce((s, x, i) => s + (x - q[i]) ** 2, 0);
  const kmeans = K => {
    let bestLab = null, bestIn = Infinity;
    for (let rs = 0; rs < 8; rs++) {
      const C = [X[Math.floor(rnd() * X.length)]]; while (C.length < K) { const ds = X.map(x => Math.min(...C.map(c => dist(x, c)))), tot = ds.reduce((s, x) => s + x, 0); let r = rnd() * tot, i = 0; for (; i < ds.length - 1 && (r -= ds[i]) > 0; i++); C.push(X[i]); }
      let lab = [];
      for (let it = 0; it < 30; it++) { lab = X.map(x => C.reduce((b, c, i) => (dist(x, c) < dist(x, C[b]) ? i : b), 0)); C.forEach((_, ci) => { const m = X.filter((_, i) => lab[i] === ci); if (m.length) C[ci] = m[0].map((_, j) => m.reduce((s, x) => s + x[j], 0) / m.length); }); }
      const inert = X.reduce((s, x, i) => s + dist(x, C[lab[i]]), 0); if (inert < bestIn) { bestIn = inert; bestLab = lab; }
    }
    return bestLab;
  };
  const silhouette = lab => {                                     // 1 = tight, well separated clusters; ~0 = arbitrary split
    const ks = [...new Set(lab)]; if (ks.length < 2) return -1; let tot = 0;
    X.forEach((x, i) => { const d = {}; ks.forEach(k => { d[k] = [0, 0]; }); X.forEach((y, j) => { if (i !== j) { d[lab[j]][0] += Math.sqrt(dist(x, y)); d[lab[j]][1]++; } });
      const own = d[lab[i]][1] ? d[lab[i]][0] / d[lab[i]][1] : 0, other = Math.min(...ks.filter(k => k !== lab[i]).map(k => (d[k][1] ? d[k][0] / d[k][1] : Infinity)));
      tot += (other - own) / Math.max(own, other, 1e-9); });
    return tot / X.length;
  };
  let bestLab, sil = null, scores = '';
  if (K === 'auto') {                                             // try 2..5 speakers, keep the split that separates best; if none does, it's one speaker
    const tries = []; for (let k = 2; k <= Math.min(5, X.length - 1); k++) { const l = kmeans(k), sizes = Array.from({ length: k }, (_, c) => l.filter(v => v === c).length); if (Math.min(...sizes) >= Math.max(2, X.length * .08)) tries.push({ k, l, s: silhouette(l) }); }   // ignore splits that only carve off a couple of odd windows
    const top = tries.length ? Math.max(...tries.map(t => t.s)) : -1, pick = tries.find(t => t.s >= top * .9);   // prefer fewer speakers unless more is clearly better
    sil = top; scores = tries.map(t => `${t.k}:${t.s.toFixed(2)}`).join(' '); bestLab = pick && pick.s >= AUTO_MIN ? pick.l : X.map(() => 0);
  } else bestLab = kmeans(K);
  const lab = bestLab.map((l, i) => { const nb = [bestLab[i - 1], l, bestLab[i + 1]].filter(v => v !== undefined); return nb.sort((x, y) => nb.filter(v => v === y).length - nb.filter(v => v === x).length)[0]; });   // median-ish smoothing
  const segs = []; wins.forEach(([f0, f1], i) => { const s = f0 * hop / 16000, e = f1 * hop / 16000, l = segs[segs.length - 1]; if (l && l.spk === lab[i] && s - l.e < .5) l.e = e; else segs.push({ spk: lab[i], s, e }); });
  return { segs, k: new Set(lab).size, sil, scores };
}

/* ---------- joining ---------- */
function merge(words, segs) {
  const lines = []; let last = 0;
  words.forEach(w => {
    const mid = (w.s + w.e) / 2; let hit = segs.find(s => mid >= s.s && mid <= s.e);
    if (!hit) { const near = segs.reduce((b, s) => { const d = Math.min(Math.abs(mid - s.s), Math.abs(mid - s.e)); return d < b.d ? { d, s } : b; }, { d: 1e9 }); hit = near.d < 1.2 ? near.s : null; }
    const spk = hit ? hit.spk : last; last = spk; const l = lines[lines.length - 1];
    if (l && l.spk === spk) l.text += ' ' + w.w; else lines.push({ spk, s: w.s, text: w.w });
  });
  return lines;
}
async function splitFirst(e, d) {
  const p = await pipe(e), a = await pcm(), turns = [];
  res.diar[d.id].segs.forEach(s => { const l = turns[turns.length - 1]; if (l && l.spk === s.spk && s.s - l.e < .5) l.e = s.e; else turns.push({ ...s }); });
  const lines = [], t0 = performance.now();
  for (const [i, t] of turns.entries()) {
    if (t.e - t.s < .5) continue; pending = `${e.name} × ${d.name}: piece ${i + 1} of ${turns.length}…`; renderComb();
    const out = await p(a.slice(Math.max(0, Math.floor((t.s - .15) * 16000)), Math.min(a.length, Math.ceil((t.e + .15) * 16000))), e.id === 'moon' ? {} : { chunk_length_s: 30 });
    const text = (out.text || '').trim(); if (text) lines.push({ spk: t.spk, s: t.s, text });
  }
  return { title: `${e.name} × ${d.name}`, tag: 'split first', lines, ms: performance.now() - t0 };
}
const norm = t => t.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
function wer(ref, hyp) {
  const r = norm(ref), h = norm(hyp); if (!r.length) return null;
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]); for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return d[r.length][h.length] / r.length;
}
const werTag = (text) => { const w = wer($('#labRef').value, text); return w == null ? '' : `<span class="wer ${w < .15 ? '' : w < .35 ? 'mid' : 'bad'}">${Math.round(w * 100)}% off</span>`; };

/* ---------- rendering ---------- */
function setSt(kind, id, text, cls) { st[kind][id] = [text, cls]; const el = document.querySelector(`[data-row="${kind}:${id}"] .st`); if (el) { el.textContent = text; el.className = 'st ' + (cls || ''); } }
const play = (s, e) => { audio.currentTime = s; audio.play(); clearTimeout(play.t); play.t = setTimeout(() => audio.pause(), Math.max(400, (e - s) * 1000)); };
function renderAsr() {
  const list = ASR.filter(e => sel.asr[e.id]);
  $('#resAsr').innerHTML = !src || !list.length ? '<div class="empty">Pick audio and engines, then Run.</div>' : list.map(e => {
    const r = res.asr[e.id], s = st.asr[e.id] || ['Waiting', ''], body = r ? (r.error ? `<p class="dim">${esc(r.error)}</p>` : r.text ? `<p>${esc(r.text)}</p>` : `<p class="dim">${esc(r.note || 'No text')}</p>`) : '<p class="dim">…</p>';
    const meta = r && r.ms ? `${sec(r.ms)} · ${(r.ms / 1000 / Math.max(dur(), .1)).toFixed(2)}× realtime` : r && r.note && r.text ? r.note : e.note;
    return `<div class="erow" data-row="asr:${e.id}"><div class="eh"><b>${e.name}</b><small>${meta}</small>${r && r.text ? werTag(r.text) : ''}<span class="st ${r ? (r.error ? 'err' : 'ok') : ''}">${r ? (r.error ? 'Failed' : r.text ? 'Done' : 'Skipped') : s[0]}</span></div>${body}</div>`;
  }).join('');
}
function renderDiar() {
  const list = DIAR.filter(e => sel.diar[e.id]), D = dur() || 1;
  $('#resDiar').innerHTML = !src || !list.length ? '<div class="empty">Pick audio and engines, then Run.</div>' : list.map(e => {
    const r = res.diar[e.id], s = st.diar[e.id] || ['Waiting', '']; let body = '<p class="dim">…</p>';
    if (r && r.error) body = `<p class="dim">${esc(r.error)}</p>`;
    else if (r) { const n = new Set(r.segs.map(x => x.spk)).size; body = `<div class="tl">${r.segs.map(x => `<i data-s="${x.s}" data-e="${x.e}" style="left:${x.s / D * 100}%;width:${Math.max(.6, (x.e - x.s) / D * 100)}%;background:${SPK[x.spk % 5]}" title="Speaker ${x.spk + 1}"></i>`).join('')}</div><div class="legend2">${[...new Set(r.segs.map(x => x.spk))].sort().map(k => `<span><b style="background:${SPK[k % 5]}"></b>Speaker ${k + 1}</span>`).join('')}<span>${r.segs.length} turns · ${n} speaker${n === 1 ? '' : 's'}</span></div>${r.note ? `<p class="dim" style="margin-top:6px;font-size:13px">${esc(r.note)}</p>` : ''}`; }
    return `<div class="erow" data-row="diar:${e.id}"><div class="eh"><b>${e.name}</b><small>${r && r.ms ? sec(r.ms) : e.note}</small><span class="st ${r ? (r.error ? 'err' : 'ok') : ''}">${r ? (r.error ? 'Failed' : 'Done') : s[0]}</span></div>${body}</div>`;
  }).join('');
}
function renderComb() {
  const cards = res.comb.map(c => `<div class="erow"><div class="eh"><b>${esc(c.title)}</b><span class="ctag">${c.tag}</span><small>${new Set(c.lines.map(l => l.spk)).size} speakers${c.ms ? ' · ' + sec(c.ms) : ''}</small>${werTag(c.lines.map(l => l.text).join(' '))}</div>${c.lines.map((l, i) => `<div class="cline" data-s="${l.s}" data-e="${c.lines[i + 1] ? c.lines[i + 1].s : l.s + 6}"><em style="background:${SPK[l.spk % 5]}26;color:${SPK[l.spk % 5]}">S${l.spk + 1} · ${fmt(Math.floor(l.s))}</em><span>${esc(l.text)}</span></div>`).join('') || '<p class="dim">No text</p>'}</div>`).join('');
  $('#resComb').innerHTML = (cards || '') + (pending ? `<div class="erow"><p class="dim">${esc(pending)}</p></div>` : '') || '<div class="empty">Needs at least one of each.</div>';
}
const renderAll = () => { renderAsr(); renderDiar(); renderComb(); };
$('#pg-lab').addEventListener('click', e => { const t = e.target.closest('.tl i, .cline'); if (t) play(+t.dataset.s, +t.dataset.e); });

/* ---------- run ---------- */
async function attempt(kind, e, fn) {
  setSt(kind, e.id, 'Working…');
  try { res[kind][e.id] = await fn(e); } catch (err) { res[kind][e.id] = { error: String((err && err.message) || err) }; }
  kind === 'asr' ? renderAsr() : renderDiar();
}
async function run() {
  if (!src) { toast('Add audio first'); return; } if (running) return;
  running = true; runLabel(); res = { asr: {}, diar: {}, comb: [] }; cloud = {}; st = { asr: {}, diar: {} }; pending = ''; renderAll();
  const A = ASR.filter(e => sel.asr[e.id]), D = DIAR.filter(e => sel.diar[e.id]);
  try {
    await pcm();
    for (const e of A) await attempt('asr', e, asrImpl);
    for (const d of D) await attempt('diar', d, diarImpl);
    for (const e of A) for (const d of D) {
      const a = res.asr[e.id], s = res.diar[d.id];
      if (a && a.words && a.words.length && s && s.segs) res.comb.push({ title: `${e.name} × ${d.name}`, tag: 'merged by time', lines: merge(a.words, s.segs) });
    }
    renderComb();
    if (sel.first) for (const e of A.filter(x => x.model)) for (const d of D) if (res.diar[d.id] && res.diar[d.id].segs) { try { res.comb.push(await splitFirst(e, d)); } catch (err) { res.comb.push({ title: `${e.name} × ${d.name}`, tag: 'split first', lines: [{ spk: 0, s: 0, text: 'Failed: ' + ((err && err.message) || err) }] }); } pending = ''; renderComb(); }
  } catch (err) { toast('Could not read that audio'); }
  for (const p of Object.values(pipes)) { try { await p.dispose(); } catch {} } pipes = {};
  running = false; pending = ''; runLabel(); renderComb(); toast('Lab run finished');
}
$('#labRun').onclick = run;
$('#labRef').oninput = () => { renderAsr(); renderComb(); };
R.lab = { setSource, run };
renderAll();
})();
