// First-run permissions: one screen, one "Allow all" button (browsers still show their own prompt for each item, one after another).
(() => {
const R = window.R, { $, $$, store, openSheet, closeSheet, toast } = R;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const LIST = [
  { id: 'mic', name: 'Microphone', why: 'Record your voice', can: () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    ask: async () => { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(t => t.stop()); } },
  { id: 'speech', name: 'Speech recognition', why: 'Live transcript and “Rowan stop”', can: () => !!SR,
    ask: () => new Promise((res, rej) => { const r = new SR(); r.onstart = () => setTimeout(() => { try { r.abort(); } catch {} res(); }, 400); r.onerror = e => e.error !== 'aborted' && rej(e.error); try { r.start(); } catch (e) { rej(e); } }) },
  { id: 'loc', name: 'Location', why: 'Stamp where you were', can: () => !!navigator.geolocation,
    ask: () => new Promise((res, rej) => navigator.geolocation.getCurrentPosition(p => { keep(p); res(); }, e => rej(e.message), { timeout: 15000 })) },
  { id: 'notif', name: 'Notifications', why: 'Event reminders', can: () => 'Notification' in window, hint: 'iPhone: add Rowan to the Home Screen first',
    ask: async () => { if ((await Notification.requestPermission()) !== 'granted') throw 'denied'; } },
  { id: 'store', name: 'Keep recordings safe', why: 'Stop the browser clearing them', can: () => !!(navigator.storage && navigator.storage.persist),
    ask: async () => { if (!(await navigator.storage.persist())) throw 'not granted'; } },
];
const keep = p => { R.lastPos = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) }; };
R.refreshPos = () => { if (store.get('perms', {}).loc === 'granted') navigator.geolocation.getCurrentPosition(keep, () => {}, { maximumAge: 60000, timeout: 8000 }); };

let state = store.get('perms', {});                             // id -> granted | denied
const label = p => (!p.can() ? 'Not available here' : state[p.id] === 'granted' ? 'Allowed' : state[p.id] === 'denied' ? 'Blocked · tap to retry' : p.hint || 'Not asked yet');
async function syncStates() {                                   // where the browser can tell us the truth, trust it over our memory
  for (const [id, name] of [['mic', 'microphone'], ['loc', 'geolocation'], ['notif', 'notifications']]) {
    try { const q = await navigator.permissions.query({ name }); if (q.state === 'granted') state[id] = 'granted'; else if (q.state === 'denied') state[id] = 'denied'; else if (state[id] === 'granted') delete state[id]; } catch {}
  }
  store.set('perms', state);
}
async function askOne(p) {
  if (!p.can()) return;
  try { await p.ask(); state[p.id] = 'granted'; } catch { state[p.id] = 'denied'; }
  store.set('perms', state);
}
function summary() {
  const ok = LIST.filter(p => p.can() && state[p.id] === 'granted').length, all = LIST.filter(p => p.can()).length;
  $('#permsSummary').textContent = `${ok} of ${all} allowed · tap to review`;
}
function render() {
  $$('[data-perm]', $('#sheet')).forEach(el => {
    const p = LIST.find(x => x.id === el.dataset.perm);
    el.classList.toggle('on', state[p.id] === 'granted'); $('small', el).textContent = `${p.why} · ${label(p)}`;
  }); summary();
}
async function open() {
  await syncStates();
  openSheet(`<h2>Rowan needs a few things</h2>
    <p class="hint" style="margin-top:-6px">Allow everything now so nothing interrupts you later, like while you’re driving. Your phone shows one prompt per item, one after another. You can change any of these in Settings.</p>
    <div class="tiles" style="margin-bottom:18px">${LIST.map(p => `<button class="tile" data-perm="${p.id}" style="--c:var(--gold)"><span class="mono-g">${p.name.slice(0, 2)}</span><span><b>${p.name}</b><small></small></span><span class="state"></span></button>`).join('')}</div>
    <div class="actions-row"><button class="btn ghost" data-later>Not now</button><button class="btn primary" data-all>Allow all</button></div>`);
  render();
  const sh = $('#sheet');
  sh.onclick = async e => { const t = e.target.closest('[data-perm]'); if (t) { await askOne(LIST.find(x => x.id === t.dataset.perm)); render(); } };
  $('[data-later]', sh).onclick = () => { store.set('onboarded', true); closeSheet(); };
  $('[data-all]', sh).onclick = async () => {
    for (const p of LIST) if (state[p.id] !== 'granted') { await askOne(p); render(); }
    store.set('onboarded', true);
    const missed = LIST.filter(p => p.can() && state[p.id] !== 'granted');
    toast(missed.length ? `${missed.length} still need a tap` : 'All set'); if (!missed.length) setTimeout(closeSheet, 700);
  };
}
R.permsSheet = open;
$('#permsBtn').onclick = open;
syncStates().then(summary);
if (!store.get('onboarded', false)) setTimeout(open, 700);
})();
