// Biblioteca no próprio aparelho (IndexedDB). Só músicas SALVAS ficam aqui; as temporárias vivem na memória.
import { encodeWav16, decodeWav16 } from './wav.js';

let dbp = null;
function open() {
  dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open('separador-de-vozes', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('songs', { keyPath: 'id' });
      db.createObjectStore('stems', { keyPath: 'key' });
      db.createObjectStore('recordings', { keyPath: 'id' }).createIndex('songId', 'songId');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

const wrap = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

async function run(store, mode, fn) {
  const db = await open();
  const tx = db.transaction(store, mode);
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Não deu para gravar (talvez falte espaço).'));
  });
  const out = await fn(tx);
  await done;
  return out;
}

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** stems: { nome: {left,right} }. Grava as faixas primeiro e a música por último. */
export async function saveSong(meta, stems, sampleRate = 44100, onProgress) {
  const names = Object.keys(stems);
  let bytes = 0;
  let i = 0;
  for (const name of names) {
    const wav = encodeWav16(stems[name].left, stems[name].right, sampleRate);
    bytes += wav.byteLength;
    await run('stems', 'readwrite', (tx) => wrap(tx.objectStore('stems').put({ key: `${meta.id}/${name}`, songId: meta.id, name, wav })));
    onProgress?.(++i / names.length);
  }
  const full = { ...meta, stemNames: names, bytes, saved: true };
  await run('songs', 'readwrite', (tx) => wrap(tx.objectStore('songs').put(full)));
  try {
    await navigator.storage?.persist?.();
  } catch {
    // tudo bem se o navegador não deixar
  }
  return full;
}

export async function listSongs() {
  const all = await run('songs', 'readonly', (tx) => wrap(tx.objectStore('songs').getAll()));
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function loadSong(id) {
  const meta = await run('songs', 'readonly', (tx) => wrap(tx.objectStore('songs').get(id)));
  if (!meta) throw new Error('Esta música não está mais salva.');
  const stems = {};
  for (const name of meta.stemNames) {
    const row = await run('stems', 'readonly', (tx) => wrap(tx.objectStore('stems').get(`${id}/${name}`)));
    if (!row) throw new Error(`Falta a faixa "${name}" desta música.`);
    const { left, right } = decodeWav16(row.wav);
    stems[name] = { left, right };
  }
  return { meta, stems };
}

export async function updateSong(meta) {
  await run('songs', 'readwrite', (tx) => wrap(tx.objectStore('songs').put(meta)));
}

export async function deleteSong(id) {
  const meta = await run('songs', 'readonly', (tx) => wrap(tx.objectStore('songs').get(id)));
  if (!meta) return;
  for (const name of meta.stemNames ?? []) {
    await run('stems', 'readwrite', (tx) => wrap(tx.objectStore('stems').delete(`${id}/${name}`)));
  }
  for (const r of await listRecordings(id)) await deleteRecording(r.id);
  await run('songs', 'readwrite', (tx) => wrap(tx.objectStore('songs').delete(id)));
}

export async function saveRecording(rec) {
  await run('recordings', 'readwrite', (tx) => wrap(tx.objectStore('recordings').put(rec)));
}
export async function listRecordings(songId) {
  return run('recordings', 'readonly', (tx) => wrap(tx.objectStore('recordings').index('songId').getAll(songId)));
}
export async function deleteRecording(id) {
  await run('recordings', 'readwrite', (tx) => wrap(tx.objectStore('recordings').delete(id)));
}

export async function usage() {
  try {
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return { usage: 0, quota: 0 };
  }
}
