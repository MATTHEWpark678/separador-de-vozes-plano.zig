// Fala com o worker. Uma separação por vez.
let worker = null;

function getWorker() {
  if (!worker) worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  return worker;
}

function resetWorker() {
  worker?.terminate();
  worker = null;
}

function talk(message, transfer, { onStatus, onProgress, finish }) {
  const w = getWorker();
  let cancel = () => {};
  const promise = new Promise((resolve, reject) => {
    const done = (fn) => (v) => {
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
      fn(v);
    };
    const ok = done(resolve);
    const fail = done(reject);
    function onMsg(e) {
      const m = e.data;
      if (m.type === 'status') onStatus?.(m.text);
      else if (m.type === 'progress') onProgress?.(m.frac);
      else if (m.type === 'error') {
        const err = new Error(m.message);
        err.name = m.name;
        if (m.name !== 'AbortError') resetWorker();
        fail(err);
      } else {
        const r = finish(m);
        if (r !== undefined) ok(r);
      }
    }
    function onErr(e) {
      resetWorker();
      fail(new Error(e.message || 'O motor de separação parou de funcionar (talvez por falta de memória).'));
    }
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    cancel = () => w.postMessage({ type: 'cancel' });
    w.postMessage(message, transfer);
  });
  promise.cancel = () => cancel();
  return promise;
}

/** Separa. Os buffers de left/right são transferidos (não servem mais depois). */
export function runSeparation({ left, right, targets, overlap, restore, onStatus, onProgress }) {
  return talk(
    { type: 'run', left, right, targets, overlap, restore },
    [left.buffer, right.buffer],
    { onStatus, onProgress, finish: (m) => (m.type === 'done' ? { stems: m.stems, report: m.report } : undefined) },
  );
}

export function runBenchmark(onStatus) {
  return talk({ type: 'bench' }, [], { onStatus, finish: (m) => (m.type === 'bench' ? m.seconds : undefined) });
}

export function giveModelFile(buffer, onStatus) {
  return talk({ type: 'model-file', buffer }, [buffer], { onStatus, finish: (m) => (m.type === 'model-cached' ? true : undefined) });
}
