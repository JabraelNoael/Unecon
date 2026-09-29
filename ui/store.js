// Recordings live in IndexedDB (audio blobs are too big for localStorage). Subjects are small, so they stay in localStorage.
(() => {
const R = window.R;
const open = new Promise((res, rej) => {
  const q = indexedDB.open('rowan', 1);
  q.onupgradeneeded = () => q.result.createObjectStore('notes', { keyPath: 'id' });
  q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
});
const run = (mode, f) => open.then(d => new Promise((res, rej) => {
  const t = d.transaction('notes', mode), r = f(t.objectStore('notes'));
  t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error);
}));
R.db = { all: () => run('readonly', s => s.getAll()), put: n => run('readwrite', s => s.put(n)), del: id => run('readwrite', s => s.delete(id)) };
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();   // ask the browser not to evict recordings

const SUBJECTS = [['Unsorted', '#877d90']];
const PALETTE = ['#d4a94e', '#66bb72', '#6db8ec', '#cf4d4d', '#a583ea', '#5fd2c8', '#e5793c'];
R.subjects = () => R.store.get('subjects', SUBJECTS.map(([name, color]) => ({ name, color })));
R.subjectColor = name => (R.subjects().find(s => s.name === name) || { color: '#877d90' }).color;
R.addSubject = name => { const l = R.subjects(); if (!l.some(s => s.name === name)) { l.splice(l.length - 1, 0, { name, color: PALETTE[l.length % PALETTE.length] }); R.store.set('subjects', l); } };

})();
