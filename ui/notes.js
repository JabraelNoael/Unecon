// Notes: recordings library + Obsidian-style link graph (by subject and by topics found in the words).
(() => {
const R = window.R, { $, $$, esc, fmt, toast, phone } = R;
let notes = [], openId = null, sel = null;

/* ---------- text analysis: TF-IDF topics, cosine links, PCA map ---------- */
const STOP = new Set(('the and but then that this these those with from have has had will would could should may might just also very really about into over than too more most some any all each other such only own same both few many much like get got going gone lets said say says think know want need make made thing things one two well okay yeah maybe today are was were been being its your our their there here what which who when where why how not does did done for you she they them him her his hers ours mine can').split(' '));
const words = t => t.toLowerCase().match(/[a-z][a-z'-]+/g) || [];
function terms(text) {
  const w = words(text), m = new Map(), add = k => m.set(k, (m.get(k) || 0) + 1);
  w.forEach((x, i) => {
    const ok = x.length > 3 && !STOP.has(x); if (ok) add(x);
    if (i && x.length > 2 && !STOP.has(x) && w[i - 1].length > 2 && !STOP.has(w[i - 1])) add(w[i - 1] + ' ' + x);   // "machine learning"
  });
  return m;
}
function analyze() {
  const n = notes.length, docs = notes.map(x => terms(x.text || '')), df = new Map();
  docs.forEach(d => d.forEach((_, k) => df.set(k, (df.get(k) || 0) + 1)));
  const covered = new Set();                                           // a word that only ever appears inside a phrase is redundant
  df.forEach((c, k) => { if (k.includes(' ') && c >= 2) k.split(' ').forEach(w => df.get(w) === c && covered.add(w)); });
  const idf = k => Math.log((1 + n) / (1 + df.get(k))) + 1;
  const topics = [...df].filter(([k, c]) => c >= 2 && !covered.has(k))
    .map(([k, c]) => ({ k, c, s: c * idf(k) * (k.includes(' ') ? 1.4 : 1) })).sort((a, b) => b.s - a.s).slice(0, 16).map(t => t.k);
  const vecs = docs.map(d => topics.map(k => (d.get(k) || 0) * idf(k)));
  return { docs, topics, vecs, df };
}
const cos = (a, b) => { let d = 0, x = 0, y = 0; a.forEach((v, i) => { d += v * b[i]; x += v * v; y += b[i] * b[i]; }); return x && y ? d / Math.sqrt(x * y) : 0; };
function pca(vecs) {                                                  // top-2 principal components via power iteration on the n×n Gram matrix
  const n = vecs.length, d = vecs[0] ? vecs[0].length : 0; if (n < 3 || d < 2) return null;
  const mean = Array(d).fill(0); vecs.forEach(v => v.forEach((x, j) => { mean[j] += x / n; }));
  const X = vecs.map(v => v.map((x, j) => x - mean[j]));
  const Gm = X.map(a => X.map(b => a.reduce((s, x, j) => s + x * b[j], 0))), out = [];
  for (let c = 0; c < 2; c++) {
    let v = Array.from({ length: n }, (_, i) => Math.sin(i * 1.7 + c + 1)), lam = 0;
    for (let it = 0; it < 80; it++) { const w = Gm.map(r => r.reduce((s, x, j) => s + x * v[j], 0)); lam = Math.hypot(...w) || 1; v = w.map(x => x / lam); }
    out.push(v.map(x => x * Math.sqrt(lam)));
    Gm.forEach((r, i) => r.forEach((_, j) => { r[j] -= lam * v[i] * v[j]; }));
  }
  const m = out.map(c => Math.max(1e-9, ...c.map(Math.abs)));          // each axis fills its own range
  return X.map((_, i) => [out[0][i] / m[0], out[1][i] / m[1]]);
}

/* ---------- graph ---------- */
const cv = $('#graph'), wrap = $('#graphWrap'), g = cv.getContext('2d');
const G = { nodes: [], links: [], by: {}, alpha: 1, layout: 'force', v: { x: 0, y: 0, k: 1 }, w: 300, h: 300, dirty: true };
const size = () => { const dpr = devicePixelRatio || 1; G.w = wrap.clientWidth; G.h = wrap.clientHeight; cv.width = G.w * dpr; cv.height = G.h * dpr; G.dirty = true; };
new ResizeObserver(size).observe(wrap);

function buildGraph() {
  const { docs, topics, vecs } = analyze(), old = G.by, nodes = [], links = [], by = {};
  const R0 = Math.min(G.w, G.h) * .36;
  const mk = (id, o) => { const p = old[id]; const n = Object.assign({ id, x: p ? p.x : (Math.random() - .5) * R0, y: p ? p.y : (Math.random() - .5) * R0, vx: 0, vy: 0, tx: 0, ty: 0 }, o); nodes.push(n); by[id] = n; return n; };
  notes.forEach(x => { const c = R.subjectColor(x.subject); mk('n:' + x.id, { type: 'note', label: x.title, color: c, r: 7 + Math.min(5, x.dur / 900), note: x }); });
  [...new Set(notes.map(x => x.subject))].forEach(s => mk('s:' + s, { type: 'subject', label: s, color: R.subjectColor(s), r: 13 }));
  topics.forEach(k => mk('t:' + k, { type: 'topic', label: k, color: '#5fd2c8', r: 6 }));
  notes.forEach((x, i) => {
    links.push({ a: by['n:' + x.id], b: by['s:' + x.subject], kind: 's', w: 1 });
    topics.forEach(k => docs[i].has(k) && links.push({ a: by['n:' + x.id], b: by['t:' + k], kind: 't', w: 1 }));
    for (let j = i + 1; j < notes.length; j++) { const s = cos(vecs[i], vecs[j]); if (s > .22) links.push({ a: by['n:' + x.id], b: by['n:' + notes[j].id], kind: 'x', w: s }); }
  });
  Object.assign(G, { nodes, links, by, alpha: 1, dirty: true });
  const pts = pca(vecs);                                              // PCA targets: notes at their coordinates, hubs at the centroid of their notes
  G.pcaOK = !!pts;
  if (pts) {
    const cnt = {}; notes.forEach((x, i) => { const a = by['n:' + x.id], zero = !vecs[i].some(Boolean); a.nx = zero ? Math.cos(x.id) * .15 : pts[i][0]; a.ny = zero ? Math.sin(x.id) * .15 : pts[i][1]; });
    nodes.filter(n => n.type !== 'note').forEach(h => { const ls = links.filter(l => l.b === h && l.a.type === 'note'); h.nx = ls.reduce((s, l) => s + l.a.nx, 0) / (ls.length || 1); h.ny = ls.reduce((s, l) => s + l.a.ny, 0) / (ls.length || 1); });
  }
  if (sel && !by[sel.id]) sel = null; else if (sel) sel = by[sel.id];
  info();
}
function step() {
  const N = G.nodes; if (G.layout === 'pca' && G.pcaOK) { let moving = 0; const S = Math.min(G.w, G.h) * .44; N.forEach(n => { n.tx = n.nx * S; n.ty = n.ny * S; }); N.forEach(n => { if (n.pin) return; n.x += (n.tx - n.x) * .12; n.y += (n.ty - n.y) * .12; moving += Math.abs(n.tx - n.x) + Math.abs(n.ty - n.y); }); G.dirty = moving > .5 || G.dirty; return; }
  if (G.alpha < .02) return;
  for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
    const a = N[i], b = N[j]; let dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy + 60, f = 2600 / d2, d = Math.sqrt(d2);
    dx = dx / d * f; dy = dy / d * f; a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
  }
  G.links.forEach(l => {
    const len = { s: 70, t: 85, x: 120 }[l.kind], k = { s: .05, t: .035, x: .02 * l.w * 4 }[l.kind];
    const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, d = Math.hypot(dx, dy) || 1, f = (d - len) * k, fx = dx / d * f, fy = dy / d * f;
    l.a.vx += fx; l.a.vy += fy; l.b.vx -= fx; l.b.vy -= fy;
  });
  N.forEach(n => { n.vx -= n.x * .012; n.vy -= n.y * .012; if (n.pin) { n.vx = n.vy = 0; return; } n.vx *= .8; n.vy *= .8; n.x += n.vx * G.alpha; n.y += n.vy * G.alpha; });
  G.alpha *= .985; G.dirty = true;
}
const near = n => !sel || n === sel || G.links.some(l => (l.a === sel && l.b === n) || (l.b === sel && l.a === n));
function draw() {
  const dpr = devicePixelRatio || 1, { x, y, k } = G.v;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, G.w, G.h);
  g.setTransform(dpr * k, 0, 0, dpr * k, dpr * (G.w / 2 + x), dpr * (G.h / 2 + y));
  G.links.forEach(l => {
    const on = !sel || l.a === sel || l.b === sel; g.globalAlpha = on ? 1 : .08; g.beginPath(); g.moveTo(l.a.x, l.a.y); g.lineTo(l.b.x, l.b.y);
    if (l.kind === 's') { g.strokeStyle = l.b.color + '88'; g.lineWidth = 1.4; g.setLineDash([]); }
    else if (l.kind === 't') { g.strokeStyle = '#5fd2c855'; g.lineWidth = 1; g.setLineDash([3, 4]); }
    else { g.strokeStyle = `rgba(165,131,234,${.25 + l.w * .6})`; g.lineWidth = 1 + l.w * 3; g.setLineDash([]); }
    g.stroke();
  });
  g.setLineDash([]);
  G.nodes.forEach(n => {
    g.globalAlpha = near(n) ? 1 : .15; g.fillStyle = n.color; g.strokeStyle = n.color;
    if (n.type === 'note') { g.shadowColor = n.color; g.shadowBlur = n === sel ? 22 : 8; g.beginPath(); g.arc(n.x, n.y, n.r, 0, 6.3); g.fill(); g.shadowBlur = 0; }
    else if (n.type === 'subject') { g.lineWidth = 2.5; g.beginPath(); g.roundRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2, 5); g.fillStyle = '#110e16'; g.fill(); g.stroke(); }
    else { g.beginPath(); g.moveTo(n.x, n.y - n.r); g.lineTo(n.x + n.r, n.y); g.lineTo(n.x, n.y + n.r); g.lineTo(n.x - n.r, n.y); g.closePath(); g.fill(); }
    if (n === sel) { g.lineWidth = 1.5; g.strokeStyle = '#f3d48c'; g.beginPath(); g.arc(n.x, n.y, n.r + 5, 0, 6.3); g.stroke(); }
    if (n.type === 'subject' || near(n) && (sel || k > 1.15 || n.type === 'topic' && k > .8)) {
      g.fillStyle = n.type === 'subject' ? '#f3d48c' : '#ebe2cf'; g.font = `${n.type === 'subject' ? 700 : 500} ${(n.type === 'subject' ? 12 : 11) / Math.max(k, .7)}px Alegreya Sans, sans-serif`; g.textAlign = 'center';
      g.fillText(n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label, n.x, n.y + n.r + 13 / Math.max(k, .7));
    }
  });
  g.globalAlpha = 1; G.dirty = false;
  if (!G.nodes.length) { g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#877d90'; g.font = '15px Alegreya Sans, sans-serif'; g.textAlign = 'center'; g.fillText('Nothing here yet', G.w / 2, G.h / 2); }
}
(function loop() {
  const p = parseFloat(phone.style.getPropertyValue('--p')) || 2;
  if (Math.abs(p - 4) < 1.05) { step(); if (G.dirty) draw(); }
  requestAnimationFrame(loop);
})();

/* pan, drag, tap, pinch, wheel */
const ptrs = new Map(); let gest = null;
const world = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left - G.w / 2 - G.v.x) / G.v.k, (e.clientY - r.top - G.h / 2 - G.v.y) / G.v.k]; };
const hit = e => { const [wx, wy] = world(e); let best = null, bd = 1e9; G.nodes.forEach(n => { const d = Math.hypot(n.x - wx, n.y - wy); if (d < n.r + 10 / G.v.k && d < bd) { best = n; bd = d; } }); return best; };
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 1) gest = { n: hit(e), sx: e.clientX, sy: e.clientY, t: performance.now(), moved: 0, vx: G.v.x, vy: G.v.y };
  else { const [a, b] = [...ptrs.values()]; gest = { pinch: true, d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: G.v.k }; }
});
cv.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, [e.clientX, e.clientY]); if (!gest) return;
  if (gest.pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; G.v.k = Math.min(3, Math.max(.4, gest.k * Math.hypot(a[0] - b[0], a[1] - b[1]) / gest.d)); G.dirty = true; return; }
  if (gest.pinch) return;
  const dx = e.clientX - gest.sx, dy = e.clientY - gest.sy; gest.moved = Math.max(gest.moved, Math.hypot(dx, dy));
  if (gest.n && gest.moved > 4) { const [wx, wy] = world(e); gest.n.x = gest.n.tx = wx; gest.n.y = gest.n.ty = wy; gest.n.pin = true; G.alpha = Math.max(G.alpha, .5); }
  else if (!gest.n) { G.v.x = gest.vx + dx; G.v.y = gest.vy + dy; }
  G.dirty = true;
});
const up = e => {
  ptrs.delete(e.pointerId); if (!gest) return;
  if (!gest.pinch && gest.moved < 5 && performance.now() - gest.t < 400) { sel = gest.n && gest.n !== sel ? gest.n : null; info(); }
  if (gest.n) gest.n.pin = false; if (!ptrs.size) gest = null; G.dirty = true;
};
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
cv.addEventListener('wheel', e => { e.preventDefault(); G.v.k = Math.min(3, Math.max(.4, G.v.k * Math.exp(-e.deltaY * .0015))); G.dirty = true; }, { passive: false });
$('#seg').onclick = e => { const b = e.target.closest('button'); if (!b) return; G.layout = b.dataset.l; $$('#seg button').forEach(x => x.classList.toggle('on', x === b)); G.alpha = 1; G.dirty = true; if (G.layout === 'pca' && !G.pcaOK) toast('Map needs 3+ notes with shared topics'); };

function info() {
  const el = $('#ginfo'); G.dirty = true;
  if (!sel) { el.innerHTML = notes.length ? 'Tap a node. Pinch or scroll to zoom, drag to pan.' : 'Your recordings will appear here as connected nodes, linked by subject and by the topics in their words.'; return; }
  const nb = G.links.filter(l => l.a === sel || l.b === sel).map(l => (l.a === sel ? l.b : l.a));
  if (sel.type === 'note') el.innerHTML = `<b>${esc(sel.label)}</b> · ${esc(sel.note.subject)}<br>${nb.filter(n => n.type === 'topic').map(n => `<span class="tag">${esc(n.label)}</span>`).join('') || '<span class="muted">No topics yet. Add a transcript to link it by words.</span>'}<br><button class="btn" style="height:30px;margin-top:6px" data-open="${sel.note.id}">Open recording</button>`;
  else if (sel.type === 'topic') el.innerHTML = `<b>${esc(sel.label)}</b> appears in ${nb.length} notes:<br>${nb.map(n => esc(n.label)).join(' · ')}`;
  else el.innerHTML = `<b>${esc(sel.label)}</b> · ${nb.length} note${nb.length === 1 ? '' : 's'}`;
}
$('#ginfo').onclick = e => { const b = e.target.closest('[data-open]'); if (b) { openId = +b.dataset.open; renderList(); const el = $(`.note[data-id="${openId}"]`); el && el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } };

/* ---------- library ---------- */
const ext = m => (/mp4/.test(m) ? 'm4a' : /ogg/.test(m) ? 'ogg' : 'webm');
function renderList() {
  $('#noteCount').textContent = notes.length;
  const subs = R.subjects();
  $('#noteList').innerHTML = notes.length ? notes.map((n, i) => {
    const topics = G.by['n:' + n.id] ? G.links.filter(l => l.a.note === n && l.kind === 't').map(l => l.b.label) : [];
    return `<div class="note ${n.id === openId ? 'open' : ''}" data-id="${n.id}" style="animation-delay:${Math.min(i, 8) * 40}ms">
      <button class="hd"><span class="dotc" style="background:${R.subjectColor(n.subject)}"></span><span class="nt"><b>${esc(n.title)}</b><small>${esc(n.subject)} · ${new Date(n.created).toLocaleDateString([], { month: 'short', day: 'numeric' })}</small></span><span class="dur">${fmt(Math.round(n.dur))}</span></button>
      <div class="body"><div><div class="in">
        <audio controls preload="none"></audio>
        <select class="inp" data-subj>${subs.map(s => `<option ${s.name === n.subject ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        <div>${topics.map(t => `<span class="tag">${esc(t)}</span>`).join('') || '<span class="hint">No shared topics yet.</span>'}</div>
        <textarea class="inp" data-text placeholder="Transcript (automatic transcription comes later; paste or type to link this note by its words)">${esc(n.text || '')}</textarea>
        <div class="tools"><button class="btn primary" data-save>Save transcript</button><button class="btn" data-dl>Download</button><button class="btn danger" data-rm>Delete</button></div>
      </div></div></div></div>`;
  }).join('') : '<div class="empty">No recordings yet. Open Listen and tap Rowan.</div>';
  const o = $(`.note.open audio`); const n = notes.find(x => x.id === openId); if (o && n) o.src = URL.createObjectURL(n.blob);
}
$('#noteList').onclick = async e => {
  const el = e.target.closest('.note'); if (!el) return;
  const n = notes.find(x => x.id == el.dataset.id);
  if (e.target.closest('.hd')) { openId = openId === n.id ? null : n.id; if (openId) sel = G.by['n:' + n.id] || null; renderList(); info(); }
  else if (e.target.closest('[data-save]')) { n.text = $('[data-text]', el).value; await R.db.put(n); toast('Transcript saved'); load(); if (R.memory) R.memory.ingest(n); }
  else if (e.target.closest('[data-dl]')) { const a = document.createElement('a'); a.href = URL.createObjectURL(n.blob); a.download = `${n.title.replace(/[^\w -]+/g, '')}.${ext(n.mime)}`; a.click(); }
  else if (e.target.closest('[data-rm]')) { const b = e.target.closest('[data-rm]'); if (b.dataset.sure) { await R.db.del(n.id); openId = null; toast('Deleted'); load(); } else { b.dataset.sure = 1; b.textContent = 'Really delete?'; } }
};
$('#noteList').onchange = async e => { if (!e.target.matches('[data-subj]')) return; const n = notes.find(x => x.id == e.target.closest('.note').dataset.id); n.subject = e.target.value; await R.db.put(n); load(); };

async function load() { notes = (await R.db.all()).sort((a, b) => b.created - a.created); buildGraph(); renderList(); if (R.onNotes) R.onNotes(); }
R.notesChanged = load;
R.analyze = () => ({ ...analyze(), notes });
load();
})();
