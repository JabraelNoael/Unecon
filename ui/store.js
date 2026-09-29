// Recordings live in IndexedDB (audio blobs are too big for localStorage). Subjects are small, so they stay in localStorage.
// While recording, every audio chunk is also written to the 'chunks' store so a closed app can be recovered on next launch.
(() => {
const R = window.R;
const open = new Promise((res, rej) => {
  const q = indexedDB.open('rowan', 3);
  q.onupgradeneeded = () => {
    const d = q.result;
    if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' });
    if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks', { keyPath: 'k' });
    if (!d.objectStoreNames.contains('memory')) d.createObjectStore('memory', { keyPath: 'id' });
  };
  q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
});
const run = (store, mode, f) => open.then(d => new Promise((res, rej) => {
  const t = d.transaction(store, mode), r = f(t.objectStore(store));
  t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error);
}));
R.db = {
  all: () => run('notes', 'readonly', s => s.getAll()),
  put: n => run('notes', 'readwrite', s => s.put(n)),
  del: id => run('notes', 'readwrite', s => s.delete(id)),
  mem: { all: () => run('memory', 'readonly', s => s.getAll()), put: m => run('memory', 'readwrite', s => s.put(m)), del: id => run('memory', 'readwrite', s => s.delete(id)) },
  addChunk: c => run('chunks', 'readwrite', s => s.put(c)),
  chunks: () => run('chunks', 'readonly', s => s.getAll()),
  dropChunks: sid => run('chunks', 'readwrite', s => { s.openCursor().onsuccess = e => { const c = e.target.result; if (c) { if (c.value.sid === sid) c.delete(); c.continue(); } }; }),
};
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();   // ask the browser not to evict recordings

const SUBJECTS = [['Unsorted', '#877d90']];
const PALETTE = ['#d4a94e', '#66bb72', '#6db8ec', '#cf4d4d', '#a583ea', '#5fd2c8', '#e5793c'];
R.subjects = () => R.store.get('subjects', SUBJECTS.map(([name, color]) => ({ name, color })));
R.subjectColor = name => (R.subjects().find(s => s.name === name) || { color: '#877d90' }).color;
R.addSubject = name => { const l = R.subjects(); if (!l.some(s => s.name === name)) { l.splice(l.length - 1, 0, { name, color: PALETTE[l.length % PALETTE.length] }); R.store.set('subjects', l); } };
})();
