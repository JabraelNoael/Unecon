(() => {
const DEMO = location.search.includes('demo'), N = 5, HOME = 2;                 // pages: Lab, Actions, Listen, Schedule, Notes
const R = window.R = { sessionStamps: [], rec: false };
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const phone = $('#phone'), pager = $('#pager'), pages = $$('.page');
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem('rowan.' + k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('rowan.' + k, JSON.stringify(v)); } catch {} },
};
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ================= pager + scroll-driven parallax ================= */
let p = HOME, W = pager.clientWidth, raf = 0;
function apply() {
  raf = 0;
  W = pager.clientWidth || 1;
  p = pager.scrollLeft / W;
  phone.style.setProperty('--p', p.toFixed(4));
  phone.style.setProperty('--a', Math.min(1, Math.abs(p - HOME)).toFixed(3));
  pages.forEach((pg, i) => { const d = i - p; pg.style.setProperty('--d', d.toFixed(3)); pg.style.setProperty('--ad', Math.min(1, Math.abs(d)).toFixed(3)); });
  $$('#titles span').forEach((s, i) => {
    const d = i - p, o = Math.max(0, 1 - Math.abs(d) * 3);
    s.style.opacity = o; s.style.transform = `translateX(${d * 46}px)`;
  });
  $$('#dock button').forEach((b, i) => b.classList.toggle('act', Math.round(p) === i));
}
const queue = () => raf || (raf = requestAnimationFrame(apply));
pager.addEventListener('scroll', queue, { passive: true });
const go = i => pager.scrollTo({ left: i * pager.clientWidth, behavior: 'smooth' });
$$('#dock button').forEach(b => b.onclick = () => go(+b.dataset.go));
addEventListener('resize', () => { pager.scrollLeft = Math.round(p) * pager.clientWidth; queue(); });
addEventListener('keydown', e => { if (e.target.matches('input,textarea')) return; if (e.key === 'ArrowLeft') go(Math.max(0, Math.round(p) - 1)); if (e.key === 'ArrowRight') go(Math.min(N - 1, Math.round(p) + 1)); });

// mouse drag-to-swipe for desktop preview (touch already swipes natively)
let drag = null, moved = false;
pager.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' || e.target.closest('button,input,textarea,.strip')) return; drag = { x: e.clientX, l: pager.scrollLeft }; moved = false; });
addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x; if (Math.abs(dx) > 6) { moved = true; pager.classList.add('dragging'); } if (moved) pager.scrollLeft = drag.l - dx; });
addEventListener('pointerup', () => { if (!drag) return; drag = null; if (moved) { pager.classList.remove('dragging'); go(Math.max(0, Math.min(N - 1, Math.round(p)))); } });
pager.addEventListener('click', e => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);

/* ================= listening: clock, orb, transcript ================= */
const scriptLines = [
  ['you', "Okay, today's lecture is on gradient descent, and the professor said it will be on the midterm."],
  ['rowan', "Got it. I'm flagging gradient descent as exam-relevant. Want a stamp on this moment?"],
  ['you', "Yeah. He also said machine learning is basically function approximation."],
  ['rowan', "Noted. That links to your Tuesday notes on supervised learning."],
  ['you', "Remind me to review the loss function slides tonight."],
  ['rowan', "Added for 8:00 PM. I'll ping you 15 minutes early."],
  ['you', "And where did I leave my charger? I think the desk drawer."],
  ['rowan', "Saved: charger, desk drawer, left today at 2:14 PM."],
];
const tEl = $('#transcript'), msgs = [];
let listening = true, elapsed = 0, level = 0, target = 0, speaking = false, cursor = 0, seq = 0;
const fmt = s => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
if (DEMO) {
setInterval(() => { if (listening) { elapsed++; $('#clock').textContent = fmt(elapsed); } }, 1000);
(function loop() { level += (target - level) * .18; phone.style.setProperty('--lvl', (listening ? level : 0).toFixed(3)); requestAnimationFrame(loop); })();
setInterval(() => { target = !listening ? 0 : speaking ? .25 + Math.random() * .75 : .04 + Math.random() * .08; }, 110);
const toggleListen = () => { listening = !listening; phone.classList.toggle('paused', !listening); toast(listening ? 'Listening' : 'Paused'); if (listening) run(); };
$('#orb').onclick = toggleListen; $('#orb').onkeydown = e => (e.key === 'Enter' || e.key === ' ') && toggleListen();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pin = () => tEl.scrollTo({ top: tEl.scrollHeight, behavior: 'smooth' });
function addMsg(who, live) {
  const el = document.createElement('div'); el.className = `msg ${who}${live ? ' live' : ''}`; el.dataset.id = ++seq;
  el.innerHTML = `<small>${who === 'you' ? 'You' : 'Rowan'}</small><p></p>`; tEl.appendChild(el);
  while (tEl.children.length > 60) tEl.firstElementChild.remove();
  return el;
}
async function say(who, text) {
  if (who === 'rowan') {
    const t = document.createElement('div'); t.className = 'msg rowan think'; t.innerHTML = '<small>Rowan</small><p><i></i><i></i><i></i></p>'; tEl.appendChild(t); pin(); await sleep(900); t.remove();
  }
  const el = addMsg(who, true), p = $('p', el), words = text.split(' ');
  speaking = who === 'you'; let out = '';
  for (const w of words) { if (!listening) { await waitResume(); } out += (out ? ' ' : '') + w; p.textContent = out; pin(); await sleep(who === 'you' ? 190 : 75); }
  el.classList.remove('live'); speaking = false; msgs.push({ id: el.dataset.id, who, text, t: elapsed }); await sleep(who === 'you' ? 600 : 1500);
}
let resumeWaiters = [];
const waitResume = () => new Promise(r => resumeWaiters.push(r));
let running = false;
async function run() {
  if (running) { resumeWaiters.splice(0).forEach(r => r()); return; }
  running = true;
  while (true) { const [w, t] = scriptLines[cursor++ % scriptLines.length]; await say(w, t); }
}
// restore a stamp marker inline when created
function markInline(st) { const m = document.createElement('div'); m.className = 'mark'; m.textContent = `◆ STAMP ${fmt(st.rec)}`; tEl.appendChild(m); pin(); }

/* ================= sheets, toast ================= */
const sheet = $('#sheet'), scrim = $('#scrim');
function openSheet(html) { sheet.innerHTML = '<div class="grab"></div>' + html; sheet.scrollTop = 0; sheet.classList.add('on'); scrim.classList.add('on'); }
function closeSheet() { sheet.classList.remove('on'); scrim.classList.remove('on'); }
scrim.onclick = closeSheet;
let toastT; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1700); }
const chipGroup = (name, opts, cur) => `<div class="chips" data-g="${name}">${opts.map(([v, l]) => `<button type="button" class="chip ${v == cur ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
sheet.addEventListener('click', e => { const c = e.target.closest('.chip'); if (c) { $$('.chip', c.parentElement).forEach(x => x.classList.remove('on')); c.classList.add('on'); } });
const chosen = g => { const el = $(`[data-g="${g}"] .chip.on`, sheet); return el ? el.dataset.v : null; };

/* ================= actions: ingredients, stamps ================= */
const INGR = [
  { id: 'loc', m: 'Lo', l: 'Location', b: 'Where you are, via GPS / maps lookup', c: 'var(--verdant)' },
  { id: 'time', m: 'Tm', l: 'Time of day', b: 'Clock time, date, weekday', c: 'var(--gold)' },
  { id: 'rec', m: 'Rc', l: 'Position in recording', b: 'Offset into this session', c: 'var(--blood)' },
  { id: 'ctx', m: 'Cx', l: 'Context window', b: 'Last messages + embedding vector', c: 'var(--arcane)' },
  { id: 'net', m: 'Wf', l: 'Connectivity', b: 'Wi-Fi, signal, network type', c: 'var(--aether)' },
  { id: 'why', m: 'Rs', l: 'Reason', b: 'Your note or a quick tag', c: 'var(--ember)' },
];
let on = store.get('ingr', Object.fromEntries(INGR.map(i => [i.id, true])));
const tileHTML = (o, cls = '') => `<button class="tile ${cls}" data-id="${o.id}" style="--c:${o.c}"><span class="mono-g">${o.m}</span><span><b>${o.l}</b><small>${o.b}</small></span><span class="state"></span></button>`;
$('#ingredients').innerHTML = INGR.map(i => tileHTML(i, on[i.id] ? 'on' : '')).join('');
$('#ingredients').onclick = e => { const t = e.target.closest('.tile'); if (!t) return; on[t.dataset.id] = !on[t.dataset.id]; t.classList.toggle('on', on[t.dataset.id]); t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop'); store.set('ingr', on); };

const DO = [
  { id: 'hl', m: 'Hl', l: 'Highlight', b: 'Mark what was just said', c: 'var(--gold)' },
  { id: 'sum', m: 'Sm', l: 'Summarize', b: 'Rolling summary as I go', c: 'var(--arcane)' },
  { id: 'exam', m: 'Ex', l: 'Flag for exam', b: 'Watch for "on the test" cues', c: 'var(--blood)' },
  { id: 'link', m: 'Ln', l: 'Link topics', b: 'Connect to older notes', c: 'var(--aether)' },
  { id: 'obj', m: 'Ob', l: 'Track objects', b: 'Remember where things are', c: 'var(--verdant)' },
  { id: 'save', m: 'Sv', l: 'Save recording', b: 'Keep audio + transcript', c: 'var(--frost)' },
];
let doOn = store.get('do', { exam: true, link: true, save: true });
$('#doTiles').innerHTML = DO.map(i => tileHTML(i, doOn[i.id] ? 'on' : '')).join('');
$('#doTiles').onclick = e => { const t = e.target.closest('.tile'); if (!t) return; doOn[t.dataset.id] = !doOn[t.dataset.id]; t.classList.toggle('on', doOn[t.dataset.id]); store.set('do', doOn); toast(`${DO.find(x => x.id === t.dataset.id).l} ${doOn[t.dataset.id] ? 'on' : 'off'}`); };

// cheap deterministic stand-in for a real embedding
const vec = text => { let h = 2166136261; return Array.from({ length: 8 }, (_, i) => { for (const c of text + i) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return +(((h >>> 0) % 2000) / 1000 - 1).toFixed(3); }); };
let stamps = store.get('stamps', []);
function snapshot(reason) {
  const now = new Date(), last = msgs.slice(-3), s = { id: Date.now(), rec: elapsed, reason: reason || '' };
  if (on.time) s.time = now.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  s.iso = now.toISOString();
  if (on.loc && R.lastPos) s.loc = R.lastPos;                                   // real GPS fix, only if permission was granted
  if (R.refreshPos) R.refreshPos();
  if (on.net) { const c = navigator.connection || {}; s.net = { online: navigator.onLine, type: c.type || c.effectiveType || 'unknown', downlink: c.downlink }; }   // browsers don't expose Wi-Fi name or signal
  if (on.ctx) s.ctx = { msgIds: last.map(m => m.id), last: last.map(m => `${m.who}: ${m.text}`), vec: vec(last.map(m => m.text).join(' ')) };
  return s;
}
function renderStamps() {
  $('#stampCount').textContent = stamps.length;
  $('#stamps').innerHTML = stamps.length ? stamps.map(s => {
    const rows = [['recording', fmt(s.rec)], s.time && ['time', s.time], s.loc && ['location', `${s.loc.lat}, ${s.loc.lng} (±${s.loc.acc} m)`], s.net && ['network', `${s.net.online ? 'online' : 'offline'} · ${s.net.type}`], s.reason && ['reason', s.reason], s.ctx && ['context', s.ctx.last.join('\n           ')], s.ctx && ['vector', `[${s.ctx.vec.join(', ')}]`]].filter(Boolean);
    return `<div class="stamp" data-id="${s.id}"><button><span class="t">${fmt(s.rec)}</span><span class="n">${s.reason ? esc(s.reason) : '<em>no note</em>'}</span><span class="chev">›</span></button><div class="body"><div><pre>${rows.map(([k, v]) => `<b>${k.padEnd(9)}</b> ${esc(v)}`).join('\n')}</pre></div></div></div>`;
  }).join('') : '<div class="empty">No stamps yet. Tap the gold button to drop one.</div>';
}
$('#stamps').onclick = e => { const s = e.target.closest('.stamp'); if (s) s.classList.toggle('open'); };
function commitStamp(reason) {
  if (!DEMO && !R.rec) { toast('Start listening first'); return; }
  const s = snapshot(reason); stamps.unshift(s); R.sessionStamps.push(s); store.set('stamps', stamps); renderStamps(); markInline(s);
  const f = document.createElement('div'); f.className = 'flash'; phone.appendChild(f); setTimeout(() => f.remove(), 800);
  const b = $('#stampBtn'); b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 600);
  toast(`◆ Stamped ${fmt(s.rec)}`); if (navigator.vibrate) navigator.vibrate(18);
}
function noteSheet() {
  const s = snapshot('');
  openSheet(`<h2>Stamp with a note</h2>
    <label class="field"><span>Reason</span><textarea class="inp" id="note" placeholder="Why does this moment matter?"></textarea></label>
    <div class="field"><span>Quick tag</span>${chipGroup('tag', [['', 'None'], ['Exam', 'On the exam'], ['Confusing', 'Confusing'], ['Idea', 'Idea'], ['Todo', 'To-do']], '')}</div>
    <div class="field"><span>Will be saved with</span><div class="snap">
      <div><b>recording</b> ${fmt(s.rec)}</div>${s.time ? `<div><b>time</b> ${s.time}</div>` : ''}${s.loc ? `<div><b>location</b> ${s.loc.lat}, ${s.loc.lng}</div>` : ''}${s.net ? `<div><b>network</b> ${s.net.online ? 'online' : 'offline'} · ${s.net.type}</div>` : ''}${s.ctx ? `<div><b>context</b> last ${s.ctx.msgIds.length} messages + vector</div>` : ''}</div></div>
    <div class="actions-row"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Stamp</button></div>`);
  $('[data-x]', sheet).onclick = closeSheet;
  $('[data-ok]', sheet).onclick = () => { const tag = chosen('tag'), n = $('#note').value.trim(); commitStamp([tag, n].filter(Boolean).join(': ')); closeSheet(); };
}
{ const b = $('#stampBtn'); let t, held = false;
  b.addEventListener('pointerdown', () => { held = false; b.classList.add('hold'); t = setTimeout(() => { held = true; b.classList.remove('hold'); noteSheet(); }, 520); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, () => { clearTimeout(t); b.classList.remove('hold'); }));
  b.addEventListener('click', () => { if (!held) commitStamp(''); }); }

/* ================= schedule ================= */
const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date(); today.setHours(0, 0, 0, 0);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const COL = ['var(--gold)', 'var(--arcane)', 'var(--aether)', 'var(--ember)', 'var(--verdant)', 'var(--frost)'];
const LEAD = [[0, 'At time'], [5, '5 min'], [15, '15 min'], [30, '30 min'], [60, '1 hour'], [1440, '1 day']];
const REP = [['none', 'Never'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly'], ['monthly', 'Monthly']];
const ALERTS = [[1, 'Once'], [2, 'Twice'], [0, 'Until I respond']];
let events = store.get('events', []).filter(e => e.id > 5);   // ids 1-5 were removed demo events that early builds may have saved
let selDay = new Date(today);
function occursOn(e, d) {
  const s = new Date(e.date + 'T00:00'); if (d < s) return false;
  const dw = d.getDay();
  return { none: dkey(d) === e.date, daily: true, weekdays: dw > 0 && dw < 6, weekly: dw === s.getDay(), monthly: d.getDate() === s.getDate() }[e.repeat];
}
const on_ = d => events.filter(e => occursOn(e, d)).sort((a, b) => a.time.localeCompare(b.time));
const t12 = t => { const [h, m] = t.split(':'); return `${+h % 12 || 12}:${m}`; }, ap = t => (+t.split(':')[0] < 12 ? 'AM' : 'PM');
const leadL = m => (LEAD.find(l => l[0] === m) || [0, 'At time'])[1];
function evtHTML(e, d, i) {
  const rep = e.repeat !== 'none' ? `<span class="pill rep">↻ ${REP.find(r => r[0] === e.repeat)[1].toLowerCase()}</span>` : '';
  const bell = e.notify ? `<span class="pill bell">🔔 ${leadL(e.lead).toLowerCase()}${e.alerts === 2 ? ' · 2×' : e.alerts === 0 ? ' · until seen' : ''}</span>` : '<span class="pill">muted</span>';
  return `<button class="evt" data-id="${e.id}" style="animation-delay:${i * 45}ms"><div class="tm">${t12(e.time)}<small>${ap(e.time)}</small></div><div class="card" style="--c:${COL[e.color % 6]}"><b>${esc(e.title)}</b><div class="meta">${bell}${rep}</div></div></button>`;
}
function renderCal() {
  $('#monthLabel').textContent = selDay.toLocaleString([], { month: 'long', year: 'numeric' });
  $('#strip').innerHTML = Array.from({ length: 21 }, (_, i) => {
    const d = addDays(today, i - 1), n = Math.min(3, on_(d).length);
    return `<button class="day ${dkey(d) === dkey(today) ? 'today' : ''} ${dkey(d) === dkey(selDay) ? 'sel' : ''}" data-d="${dkey(d)}"><small>${d.toLocaleString([], { weekday: 'short' })}</small><b>${d.getDate()}</b><i>${'<u></u>'.repeat(n)}</i></button>`;
  }).join('');
  const isToday = dkey(selDay) === dkey(today), list = on_(selDay), nowT = `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
  $('#dayLabel').textContent = isToday ? 'Today' : selDay.toLocaleString([], { weekday: 'long', month: 'short', day: 'numeric' });
  let html = '', shown = false;
  list.forEach((e, i) => { if (isToday && !shown && e.time > nowT) { html += `<div class="now">now · ${nowT}</div>`; shown = true; } html += evtHTML(e, selDay, i); });
  if (isToday && !shown && list.length) html += `<div class="now">now · ${nowT}</div>`;
  $('#agenda').innerHTML = html || '<div class="empty">Nothing planned. Tap + Event.</div>';
  const up = []; for (let i = 1; i <= 14 && up.length < 5; i++) { const d = addDays(selDay, i); on_(d).forEach(e => up.length < 5 && up.push([d, e])); }
  $('#upcoming').innerHTML = up.length ? up.map(([d, e], i) => `<div><div class="update">${d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric' })}</div>${evtHTML(e, d, i)}</div>`).join('') : '<div class="empty">Clear for two weeks.</div>';
}
$('#strip').onclick = e => { const b = e.target.closest('.day'); if (!b) return; selDay = new Date(b.dataset.d + 'T00:00'); renderCal(); const s = $('.day.sel'); s && s.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); };
$('#pg-schedule').onclick = e => { const b = e.target.closest('.evt'); if (b) editEvent(events.find(x => x.id == b.dataset.id)); };
$('#addEvt').onclick = () => editEvent(null);
function editEvent(ev) {
  const e = ev || { id: 0, title: '', date: dkey(selDay), time: '09:00', repeat: 'none', notify: true, lead: 15, alerts: 1, color: 0 };
  openSheet(`<h2>${ev ? 'Edit event' : 'New event'}</h2>
    <label class="field"><span>Title</span><input class="inp" id="e-title" value="${esc(e.title)}" placeholder="What's happening?"></label>
    <div class="row2 field"><label><span style="display:block;font:600 11px var(--f-display);letter-spacing:.18em;text-transform:uppercase;color:var(--text-3);margin-bottom:7px">Date</span><input class="inp" type="date" id="e-date" value="${e.date}"></label>
      <label><span style="display:block;font:600 11px var(--f-display);letter-spacing:.18em;text-transform:uppercase;color:var(--text-3);margin-bottom:7px">Time</span><input class="inp" type="time" id="e-time" value="${e.time}"></label></div>
    <div class="field"><span>Repeats</span>${chipGroup('rep', REP, e.repeat)}</div>
    <button class="switch ${e.notify ? 'on' : ''}" id="e-notify"><b>Notify me</b><i></i></button>
    <div class="sub ${e.notify ? 'on' : ''}" id="e-sub"><div>
      <div class="field"><span>How early</span>${chipGroup('lead', LEAD, e.lead)}</div>
      <div class="field"><span>How often</span>${chipGroup('alerts', ALERTS, e.alerts)}</div></div></div>
    <div class="field"><span>Color</span><div class="chips" data-g="color">${COL.map((c, i) => `<button type="button" class="chip ${i == e.color ? 'on' : ''}" data-v="${i}" style="color:${c};width:38px;padding:7px 0">●</button>`).join('')}</div></div>
    <div class="actions-row">${ev ? '<button class="btn danger" data-del>Delete</button>' : '<button class="btn ghost" data-x>Cancel</button>'}<button class="btn primary" data-ok>Save</button></div>`);
  let notify = e.notify;
  $('#e-notify', sheet).onclick = ev2 => { notify = !notify; ev2.currentTarget.classList.toggle('on', notify); $('#e-sub', sheet).classList.toggle('on', notify); };
  const x = $('[data-x]', sheet); if (x) x.onclick = closeSheet;
  const del = $('[data-del]', sheet); if (del) del.onclick = () => { events = events.filter(v => v.id !== e.id); save(); closeSheet(); toast('Event deleted'); };
  $('[data-ok]', sheet).onclick = () => {
    const title = $('#e-title').value.trim(); if (!title) { $('#e-title').focus(); return; }
    const n = { id: e.id || Date.now(), title, date: $('#e-date').value || dkey(selDay), time: $('#e-time').value || '09:00', repeat: chosen('rep'), notify, lead: +chosen('lead'), alerts: +chosen('alerts'), color: +chosen('color') };
    events = ev ? events.map(v => v.id === e.id ? n : v) : [...events, n]; selDay = new Date(n.date + 'T00:00'); save(); closeSheet(); toast(ev ? 'Saved' : 'Event added');
  };
}
function save() { store.set('events', events); renderCal(); }

/* ================= boot ================= */
renderStamps(); renderCal();
Object.assign(R, { $, $$, store, pad, esc, fmt, toast, openSheet, closeSheet, chipGroup, chosen, phone, pager, go, stamp: commitStamp, setElapsed: v => { elapsed = v; }, addSys: null });
pager.scrollLeft = HOME * pager.clientWidth; apply();
if (DEMO) run();
})();
