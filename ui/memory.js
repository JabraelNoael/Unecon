// Long-term memory about the user.
//   1. Candidate facts come from what you say (rules for now; swap `extract` for Gemma later).
//   2. Every fact is embedded as a vector, so a repeat in different words merges into the same memory.
//   3. Facts you state explicitly, pin, or repeat across recordings become long-term; the rest are just watched.
//   4. Topics you keep coming back to across notes become long-term automatically.
//   5. `context(query)` returns the relevant memories as a text block for the model's prompt.
(() => {
const R = window.R, { $, esc, toast } = R;
const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';
let items = [], ext = null;
const now = () => Date.now();

/* ---------- embeddings (small model, runs on the phone, ~23 MB once) ---------- */
async function embed(texts) {
  if (!ext) { const { pipeline, env } = await import(TJS); env.allowLocalModels = false; ext = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8', device: 'wasm' }); }
  return (await ext(texts, { pooling: 'mean', normalize: true })).tolist().map(v => Float32Array.from(v));
}
const cos = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };   // vectors are unit length

/* ---------- what counts as worth remembering ---------- */
const KINDS = [
  ['person', /\bmy (mom|mother|dad|father|sister|brother|roommate|friend|girlfriend|boyfriend|partner|wife|husband|professor|teacher|boss|dog|cat|kid|son|daughter)\b/i],
  ['object', /\bi (?:put|left|kept|placed|stored|parked|hid) (?:my |the |a )?.{2,40}? (?:in|on|at|under|behind|near|inside) .{2,40}/i],
  ['about', /\bi(?:'m| am) (?:allergic|afraid|scared|studying|majoring|from|living|working|training|learning|vegetarian|vegan|left-handed|diabetic)|\bi (?:live|work|study) (?:in|at|on|near)\b|\bmy (?:favorite|name|birthday|major|address|school|car|phone|schedule)\b/i],
  ['preference', /\bi (?:really )?(?:like|love|hate|prefer|enjoy|can't stand|always|never|usually)\b/i],
  ['goal', /\bi (?:want|need|plan|hope|am trying|'m trying) to\b/i],
];
function extract(text) {                                          // -> [{text, kind}]
  return text.split(/[\n.!?]+/).map(s => s.trim().replace(/\s+/g, ' ')).filter(s => s.length > 8 && s.split(' ').length <= 28)
    .map(s => { const k = KINDS.find(([, re]) => re.test(s)); return k ? { text: s[0].toUpperCase() + s.slice(1), kind: k[0] } : null; }).filter(Boolean);
}

/* ---------- storing, merging, promoting ---------- */
const promote = m => { m.mentions = m.sources.length; m.status = m.explicit || m.pinned || (m.kind === 'topic' ? m.mentions >= 3 : m.mentions >= 2) ? 'long' : 'watching'; };
async function save(m) { const { vec, ...rest } = m; await R.db.mem.put({ ...rest, vec }); }
async function upsert(cands, source, explicit) {                  // cands: [{text, kind}]
  if (!cands.length) return;
  let vecs = []; try { vecs = await embed(cands.map(c => c.text)); } catch { vecs = cands.map(() => null); }   // offline: keep the text, embed later
  for (const [i, c] of cands.entries()) {
    const v = vecs[i], hit = v && items.filter(m => m.vec && m.kind !== 'topic').map(m => [m, cos(v, m.vec)]).sort((a, b) => b[1] - a[1])[0];
    if (hit && hit[1] >= .86) {                                    // same fact, maybe different words
      const m = hit[0]; if (source != null && !m.sources.includes(source)) m.sources.push(source); m.last = now(); m.explicit = m.explicit || explicit; promote(m); await save(m);
    } else {
      const m = { id: 'm' + now() + i, text: c.text, kind: c.kind, vec: v, sources: source != null ? [source] : [], explicit: !!explicit, pinned: false, first: now(), last: now(), via: explicit ? 'you' : 'heard' };
      promote(m); items.push(m); await save(m);
    }
  }
  render();
}
async function ingest(note) { if (note && note.text) await upsert(extract(note.text), note.id, false); }
async function add(text, o = {}) { text = text.trim(); if (!text) return; await upsert([{ text: text[0].toUpperCase() + text.slice(1), kind: extractKind(text) }], o.source != null ? o.source : 'manual', true); toast('Remembered'); }
const extractKind = t => { const k = KINDS.find(([, re]) => re.test(t)); return k ? k[0] : 'fact'; };

async function syncTopics() {                                     // themes you return to across recordings
  const a = R.analyze(); if (!a.notes.length) return;
  const seen = new Set();
  const found = a.topics.map(t => ({ t, ids: a.notes.filter((_, i) => a.docs[i].has(t)).map(n => n.id) })).filter(x => x.ids.length >= 2);
  let vecs = []; try { vecs = found.length ? await embed(found.map(x => `Often talks about ${x.t}`)) : []; } catch { vecs = found.map(() => null); }
  for (const [i, { t, ids }] of found.entries()) {
    const id = 'topic:' + t; seen.add(id); let m = items.find(x => x.id === id);
    if (!m) { m = { id, text: `Often talks about “${t}”`, kind: 'topic', vec: vecs[i], sources: [], explicit: false, pinned: false, first: now(), via: 'heard' }; items.push(m); }
    m.sources = ids; m.last = now(); if (!m.vec) m.vec = vecs[i]; promote(m); await save(m);
  }
  for (const m of items.filter(x => x.kind === 'topic' && !seen.has(x.id))) { items = items.filter(x => x !== m); await R.db.mem.del(m.id); }   // theme faded away
  render();
}

/* ---------- recall: what to hand the model ---------- */
async function recall(query, k = 5) {
  const usable = items.filter(m => m.vec); if (!query.trim() || !usable.length) return [];
  const q = (await embed([query]))[0];
  return usable.map(m => ({ m, score: cos(q, m.vec) * (m.status === 'long' ? 1.08 : 1) * (1 + .05 * Math.log(1 + m.mentions)) + (m.pinned ? .05 : 0) }))
    .filter(x => x.score > .3).sort((a, b) => b.score - a.score).slice(0, k);
}
async function context(query, k = 5) {                            // paste this into the model's prompt
  const r = await recall(query, k); return r.length ? 'What you know about the user:\n' + r.map(x => '- ' + x.m.text).join('\n') : '';
}

/* ---------- UI ---------- */
function render() {
  const list = $('#memList'); if (!list) return;
  $('#memCount').textContent = items.length;
  const row = m => `<div class="mem ${m.status}" data-id="${m.id}"><p>${esc(m.text)}</p><div class="mb"><button class="pin ${m.pinned ? 'on' : ''}" title="Pin" data-a="pin">★</button><button title="Forget" data-a="del">✕</button></div><div class="mm"><span class="kd">${m.kind}</span><span>${m.status === 'long' ? 'long-term' : 'watching'}</span><span>${m.mentions} recording${m.mentions === 1 ? '' : 's'}${m.explicit ? ' · told' : ''}</span>${m.vec ? '' : '<span>not embedded yet</span>'}</div></div>`;
  const by = s => items.filter(m => m.status === s).sort((a, b) => b.last - a.last);
  list.innerHTML = items.length ? (by('long').map(row).join('') + (by('watching').length ? `<h3 style="margin:14px 0 8px">Watching</h3>` + by('watching').map(row).join('') : '')) : '<div class="empty">Nothing yet. Say “Rowan, remember that…” or type it above.</div>';
}
$('#memList').onclick = async e => {
  const b = e.target.closest('[data-a]'); if (!b) return; const m = items.find(x => x.id === b.closest('.mem').dataset.id);
  if (b.dataset.a === 'del') { items = items.filter(x => x !== m); await R.db.mem.del(m.id); } else { m.pinned = !m.pinned; promote(m); await save(m); }
  render();
};
$('#memAdd').onclick = async () => { const el = $('#memIn'); await add(el.value); el.value = ''; };
$('#memIn').onkeydown = e => e.key === 'Enter' && $('#memAdd').click();
const go = async () => {
  const q = $('#memQ').value, out = $('#memOut'); if (!q.trim()) return; out.innerHTML = '<div class="hint">Thinking…</div>';
  try { const r = await recall(q); out.innerHTML = r.length ? r.map(x => `<div class="mem ${x.m.status}"><p>${esc(x.m.text)}</p><div class="mm"><span class="kd">${x.m.kind}</span><span class="sc">match ${(x.score * 100).toFixed(0)}%</span></div></div>`).join('') + `<pre class="ctx">${esc(await context(q))}</pre>` : '<div class="empty">Nothing relevant. Rowan wouldn’t add any context.</div>'; }
  catch { out.innerHTML = '<div class="empty">Couldn’t load the memory model. Check your connection once; it caches afterward.</div>'; }
};
$('#memGo').onclick = go; $('#memQ').onkeydown = e => e.key === 'Enter' && go();

R.memory = { ingest, add, recall, context, syncTopics, extract, all: () => items };
R.onNotes = () => syncTopics();
R.db.mem.all().then(a => { items = a; render(); });
})();
